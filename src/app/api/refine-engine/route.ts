import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findAllProvidersForType, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { resolveCompatProfile, adjustRequestForProfile } from '@/lib/api-compatibility';
import type { ApiCompatProfile } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';

/* ================================================================
   精修引擎 API
   - 支持标准模式 (品类+强度) 和专家模式 (品类+材质+灯光+视角+强度+自定义提示词)
   - 图片处理: 上传到服务器获取可访问URL → 作为image_urls+image发送
   - API兼容层: adjustRequestForProfile + hasImage=true
   - 编辑端点回退: /images/edits → /images/generations
   ================================================================ */

// ─── 品类预设 ─────────────────────────────────────────────────
const CATEGORY_PRESETS: Record<string, { label: string; prompt: string }> = {
  electronics: { label: '电子产品', prompt: 'refined product photography of electronic device, studio lighting, clean background, premium quality, high-end commercial look' },
  fashion:     { label: '时尚服饰', prompt: 'refined fashion product photography, elegant fabric texture, professional studio lighting, luxury brand look' },
  food:        { label: '食品饮料', prompt: 'refined food photography, appetizing presentation, natural lighting, commercial food styling, premium quality' },
  beauty:      { label: '美妆护肤', prompt: 'refined beauty product photography, soft lighting, clean elegant composition, luxury skincare look' },
  home:        { label: '家居用品', prompt: 'refined home product photography, warm ambient lighting, lifestyle setting, premium quality' },
  jewelry:     { label: '珠宝首饰', prompt: 'refined jewelry photography, sparkle and shine, macro detail, luxury brand presentation' },
  toys:        { label: '玩具潮玩', prompt: 'refined toy product photography, vibrant colors, dynamic lighting, collectible quality presentation' },
  automotive:  { label: '汽车配件', prompt: 'refined automotive product photography, dramatic lighting, metallic finish, premium quality' },
};

const LIGHT_PRESETS: Record<string, { label: string; prompt: string }> = {
  studio:   { label: '影棚光', prompt: 'professional studio lighting' },
  natural:  { label: '自然光', prompt: 'soft natural window lighting' },
  dramatic: { label: '戏剧光', prompt: 'dramatic directional lighting with shadows' },
  soft:     { label: '柔光', prompt: 'soft diffused even lighting' },
  golden:   { label: '金光', prompt: 'warm golden hour lighting' },
};

const ANGLE_PRESETS: Record<string, { label: string; prompt: string }> = {
  front:     { label: '正面', prompt: 'front view' },
  '45deg':   { label: '45度', prompt: '45 degree angle view' },
  top:       { label: '俯视', prompt: 'top-down view' },
  side:      { label: '侧面', prompt: 'side profile view' },
  closeup:   { label: '特写', prompt: 'close-up detail view' },
};

// ─── 提示词生成 ─────────────────────────────────────────────────
function generateStandardPrompt(category: string, strength: number): string {
  const cat = CATEGORY_PRESETS[category] || CATEGORY_PRESETS.electronics;
  const strengthLabel = strength >= 80 ? 'maximum enhancement' : strength >= 50 ? 'moderate enhancement' : 'subtle enhancement';
  return `${cat.prompt}, ${strengthLabel}, 8k ultra detail, professional retouching`;
}

function generateExpertPrompt(
  category: string,
  material: string,
  lighting: string,
  angle: string,
  strength: number,
  customPrompt: string
): string {
  const cat = CATEGORY_PRESETS[category] || CATEGORY_PRESETS.electronics;
  const light = LIGHT_PRESETS[lighting] || LIGHT_PRESETS.studio;
  const ang = ANGLE_PRESETS[angle] || ANGLE_PRESETS.front;
  const strengthLabel = strength >= 80 ? 'maximum enhancement' : strength >= 50 ? 'moderate enhancement' : 'subtle enhancement';

  let prompt = `${cat.prompt}, ${light.prompt}, ${ang.prompt}, ${strengthLabel}`;
  if (material) prompt += `, ${material} material texture`;
  if (customPrompt) prompt += `, ${customPrompt}`;
  prompt += ', 8k ultra detail, professional retouching';
  return prompt;
}

// ─── 图片URL解析: data URL → 上传到服务器 → 获取可访问URL ────────
async function resolveImageUrl(imageUrl: string): Promise<string> {
  // 已经是 HTTP URL，直接返回
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  // data URL → 上传到 /api/save-image 获取可访问 URL
  if (imageUrl.startsWith('data:')) {
    try {
      const resp = await fetch(new URL('/api/save-image', process.env.COZE_PROJECT_DOMAIN_DEFAULT ? `https://${process.env.COZE_PROJECT_DOMAIN_DEFAULT}` : 'http://localhost:5000').toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.url) return data.url;
      }
    } catch (e) {
      console.error('[refine-engine] save-image upload failed:', e);
    }

    // 回退: 尝试相对路径
    try {
      const resp = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.url) return data.url;
      }
    } catch {
      // 忽略
    }

    // 最终回退: 返回原始 data URL (某些API可能支持)
    console.warn('[refine-engine] Could not upload image, using raw data URL');
    return imageUrl;
  }

  // 相对路径 /api/serve-upload/xxx
  if (imageUrl.startsWith('/')) {
    const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || 'localhost:5000';
    return `https://${domain}${imageUrl}`;
  }

  return imageUrl;
}

// ─── 异步任务处理 ────────────────────────────────────────────────
async function processRefineTask(
  taskId: string,
  params: {
    imageUrl: string;
    mode: string;
    category: string;
    material: string;
    lighting: string;
    angle: string;
    strength: number;
    customPrompt: string;
    model: string;
    size: string;
    quality: string;
  }
) {
  try {
    // 1. 检查取消
    if (isTaskCancelled(taskId)) {
      updateTaskProgress(taskId, { status: 'cancelled', progress: 0, label: '已取消' });
      return;
    }

    updateTaskProgress(taskId, { progress: 10, label: '解析图片...' });

    // 2. 解析图片URL → 可访问URL
    const accessibleImageUrl = await resolveImageUrl(params.imageUrl);
    console.log(`[refine-engine] Resolved image URL: ${accessibleImageUrl.substring(0, 80)}...`);

    if (isTaskCancelled(taskId)) {
      updateTaskProgress(taskId, { status: 'cancelled', progress: 0, label: '已取消' });
      return;
    }

    // 3. 查找模型提供商
    const provider = await findProviderForModel(params.model);
    if (!provider) {
      updateTaskProgress(taskId, { status: 'failed', progress: 0, label: '未找到模型提供商', error: `未找到模型 ${params.model} 的API配置` });
      return;
    }

    const apiKey = provider.apiKey;
    const baseUrl = normalizeApiBaseUrl(provider.baseUrl);
    const profile = resolveCompatProfile(provider as unknown as Record<string, unknown>);

    updateTaskProgress(taskId, { progress: 20, label: '生成提示词...' });

    // 4. 生成提示词
    const prompt = params.mode === 'expert'
      ? generateExpertPrompt(params.category, params.material, params.lighting, params.angle, params.strength, params.customPrompt)
      : generateStandardPrompt(params.category, params.strength);

    // 5. 构建请求体 (参考 /api/generate 的图生图模式)
    const strengthValue = Math.max(0.3, Math.min(1.0, params.strength / 100));

    let requestBody: Record<string, unknown> = {
      model: params.model,
      prompt,
      image: accessibleImageUrl,
      image_urls: [accessibleImageUrl],
      strength: strengthValue,
      n: 1,
    };

    if (params.size) {
      requestBody.size = params.size;
    }
    if (params.quality) {
      requestBody.quality = params.quality;
    }

    // 6. 使用API兼容层调整请求
    const adjusted = adjustRequestForProfile(requestBody, profile, { hasImage: true, isEditEndpoint: true });
    requestBody = adjusted.body;
    const endpoint = adjusted.endpoint || profile.editEndpoint || '/images/edits';

    if (isTaskCancelled(taskId)) {
      updateTaskProgress(taskId, { status: 'cancelled', progress: 0, label: '已取消' });
      return;
    }

    updateTaskProgress(taskId, { progress: 30, label: '提交精修请求...' });

    // 7. 发送请求 (先尝试编辑端点，失败回退到生成端点)
    let response: Response | null = null;
    let usedEndpoint = endpoint;
    let lastError: string | null = null;

    try {
      const url = `${baseUrl}${endpoint}`;
      console.log(`[refine-engine] Request: ${baseUrl}${endpoint}`);
      response = await fetchWithV1Retry(baseUrl, endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[refine-engine] Edit endpoint failed: ${lastError}`);
    }

    // 编辑端点失败 → 回退到生成端点
    if (!response || !response.ok) {
      if (endpoint !== '/images/generations') {
        console.log('[refine-engine] Falling back to /images/generations');
        const genEndpoint = '/images/generations';
        try {
          const url = `${baseUrl}${genEndpoint}`;
          // 生成端点可能不支持 image 字段，但保留 image_urls
          const genBody = { ...requestBody };
          // 根据profile决定是否保留image字段
          if (profile.id === 'openai') {
            // OpenAI /images/generations 不支持 image，只保留 image_urls 作为参考
            delete (genBody as Record<string, unknown>).image;
          }
          response = await fetchWithV1Retry(baseUrl, '/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(genBody),
          });
          usedEndpoint = genEndpoint;
        } catch (e: unknown) {
          lastError = e instanceof Error ? e.message : String(e);
          console.error(`[refine-engine] Generate endpoint also failed: ${lastError}`);
        }
      }
    }

    if (!response) {
      updateTaskProgress(taskId, { status: 'failed', progress: 0, label: '请求失败', error: lastError || '网络请求失败' });
      return;
    }

    if (isTaskCancelled(taskId)) {
      updateTaskProgress(taskId, { status: 'cancelled', progress: 0, label: '已取消' });
      return;
    }

    updateTaskProgress(taskId, { progress: 50, label: '等待AI处理...' });

    // 8. 解析响应
    let resultData: Record<string, unknown>;
    try {
      resultData = await response.json() as Record<string, unknown>;
    } catch {
      const text = await response.text().catch(() => '');
      updateTaskProgress(taskId, { status: 'failed', progress: 0, label: '响应解析失败', error: `API返回非JSON: ${text.substring(0, 200)}` });
      return;
    }

    if (!response.ok) {
      const errMsg = (resultData.error as Record<string, unknown>)?.message || resultData.error_description || JSON.stringify(resultData).substring(0, 200);
      updateTaskProgress(taskId, { status: 'failed', progress: 0, label: 'API错误', error: String(errMsg) });
      return;
    }

    // 9. 检查是否是异步任务 (需要轮询)
    if (resultData.taskIds || resultData.task_id || resultData.id) {
      const taskIdToPoll = Array.isArray(resultData.taskIds) ? resultData.taskIds[0] : (resultData.task_id || resultData.id);
      if (typeof taskIdToPoll === 'string') {
        updateTaskProgress(taskId, { progress: 60, label: '排队处理中...' });
        await pollForResult(taskId, taskIdToPoll, baseUrl, apiKey, profile);
        return;
      }
    }

    // 10. 直接返回结果
    const directImageUrls = extractImageUrls(resultData);
    if (directImageUrls.length > 0) {
      updateTaskProgress(taskId, {
        status: 'completed',
        progress: 100,
        label: '精修完成',
        result: { directImageUrls },
      });
    } else {
      updateTaskProgress(taskId, { status: 'failed', progress: 0, label: '无结果', error: 'API未返回图片URL' });
    }
  } catch (e: unknown) {
    console.error('[refine-engine] Task error:', e);
    updateTaskProgress(taskId, {
      status: 'failed',
      progress: 0,
      label: '处理失败',
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ─── 从API响应中提取图片URL ──────────────────────────────────────
function extractImageUrls(data: Record<string, unknown>): string[] {
  const urls: string[] = [];

  // OpenAI 格式: { data: [{ url: "..." }, { b64_json: "..." }] }
  if (Array.isArray(data.data)) {
    for (const item of data.data) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if (typeof obj.url === 'string') urls.push(obj.url);
        else if (typeof obj.b64_json === 'string') urls.push(`data:image/png;base64,${obj.b64_json}`);
      }
    }
  }

  // APImart 格式: { data: { image_urls: ["..."] } }
  if (!urls.length && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const inner = data.data as Record<string, unknown>;
    if (Array.isArray(inner.image_urls)) {
      urls.push(...inner.image_urls.filter((u: unknown) => typeof u === 'string') as string[]);
    }
    if (typeof inner.image_url === 'string') urls.push(inner.image_url);
  }

  // 简单格式: { images: ["..."] } 或 { image_urls: ["..."] }
  if (!urls.length && Array.isArray(data.images)) {
    urls.push(...data.images.filter((u: unknown) => typeof u === 'string') as string[]);
  }
  if (!urls.length && Array.isArray(data.image_urls)) {
    urls.push(...data.image_urls.filter((u: unknown) => typeof u === 'string') as string[]);
  }
  if (!urls.length && typeof data.image_url === 'string') {
    urls.push(data.image_url);
  }
  if (!urls.length && typeof data.url === 'string') {
    urls.push(data.url);
  }

  return urls;
}

// ─── 轮询异步任务结果 ──────────────────────────────────────────
async function pollForResult(
  ourTaskId: string,
  remoteTaskId: string,
  baseUrl: string,
  apiKey: string,
  profile: ApiCompatProfile,
  maxAttempts = 120,
  intervalMs = 3000,
) {
  const pollPath = profile.pollPathTemplate
    ? profile.pollPathTemplate.replace('{taskId}', remoteTaskId)
    : `/tasks/${remoteTaskId}`;

  for (let i = 0; i < maxAttempts; i++) {
    if (isTaskCancelled(ourTaskId)) {
      updateTaskProgress(ourTaskId, { status: 'cancelled', progress: 0, label: '已取消' });
      return;
    }

    await new Promise(r => setTimeout(r, intervalMs));

    const progress = Math.min(50 + Math.floor((i / maxAttempts) * 50), 95);
    updateTaskProgress(ourTaskId, { progress, label: `处理中 ${i + 1}/${maxAttempts}...` });

    try {
      const resp = await fetchWithV1Retry(baseUrl, pollPath, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!resp.ok) continue;

      const pollData = await resp.json() as Record<string, unknown>;

      // 检查任务状态
      const status = pollData.status;
      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        const urls = extractImageUrls(pollData);
        if (urls.length > 0) {
          updateTaskProgress(ourTaskId, {
            status: 'completed',
            progress: 100,
            label: '精修完成',
            result: { directImageUrls: urls },
          });
        } else {
          // 结果可能在嵌套的 result 字段中
          const result = pollData.result as Record<string, unknown> | undefined;
          if (result) {
            const resultUrls = extractImageUrls(result);
            if (resultUrls.length > 0) {
              updateTaskProgress(ourTaskId, {
                status: 'completed',
                progress: 100,
                label: '精修完成',
                result: { directImageUrls: resultUrls },
              });
            } else {
              updateTaskProgress(ourTaskId, { status: 'failed', progress: 0, label: '无结果', error: '任务完成但未返回图片' });
            }
          } else {
            updateTaskProgress(ourTaskId, { status: 'failed', progress: 0, label: '无结果', error: '任务完成但未返回图片' });
          }
        }
        return;
      }

      if (status === 'failed' || status === 'error') {
        const errMsg = pollData.error || pollData.message || '远程任务失败';
        updateTaskProgress(ourTaskId, { status: 'failed', progress: 0, label: '任务失败', error: String(errMsg) });
        return;
      }

      // 继续轮询 (status = pending/processing/running)
    } catch (e: unknown) {
      console.error(`[refine-engine] Poll error (attempt ${i + 1}):`, e);
    }
  }

  // 超时
  updateTaskProgress(ourTaskId, { status: 'failed', progress: 0, label: '超时', error: '精修任务超时，请重试' });
}

// ─── POST 处理器 ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageUrl, mode, category, material, lighting, angle, strength, customPrompt, model, size, quality } = body;

    if (!imageUrl) {
      return NextResponse.json({ error: '缺少图片' }, { status: 400 });
    }

    if (!model) {
      return NextResponse.json({ error: '缺少模型参数' }, { status: 400 });
    }

    // 注册任务
    const taskId = `refine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'refine-engine', '精修引擎');

    // 异步处理
    processRefineTask(taskId, {
      imageUrl,
      mode: mode || 'standard',
      category: category || 'electronics',
      material: material || '',
      lighting: lighting || 'studio',
      angle: angle || 'front',
      strength: strength || 70,
      customPrompt: customPrompt || '',
      model,
      size: size || '1024x1024',
      quality: quality || 'standard',
    }).catch(e => {
      console.error('[refine-engine] Unhandled error:', e);
      updateTaskProgress(taskId, {
        status: 'failed',
        progress: 0,
        label: '处理异常',
        error: e instanceof Error ? e.message : String(e),
      });
    });

    return NextResponse.json({ success: true, taskId });
  } catch (e: unknown) {
    console.error('[refine-engine] POST error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '服务器错误' },
      { status: 500 }
    );
  }
}

// ─── GET: 返回品类/灯光/视角预设 ───────────────────────────────
export async function GET() {
  return NextResponse.json({
    categories: Object.entries(CATEGORY_PRESETS).map(([key, val]) => ({ key, label: val.label })),
    lightings: Object.entries(LIGHT_PRESETS).map(([key, val]) => ({ key, label: val.label })),
    angles: Object.entries(ANGLE_PRESETS).map(([key, val]) => ({ key, label: val.label })),
  });
}
