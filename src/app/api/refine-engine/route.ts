import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getPublicModels, getPublicApiProviders } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, isEditsEndpointRejected, stripEditsOnlyFields } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';

// ─── Persist result image to local server ───
// External API URLs may expire or be CORS-blocked; persisting locally ensures reliability
async function persistResultImage(imageUrl: string): Promise<string> {
  try {
    // If already a local URL, no need to persist
    if (imageUrl.startsWith('/api/serve-upload/') || imageUrl.startsWith('/uploads/')) {
      return imageUrl;
    }
    // If data URL, upload to save-image API
    if (imageUrl.startsWith('data:')) {
      const resp = await fetch('http://localhost:5000/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.url) return data.url;
      }
      return imageUrl;  // Fallback to original
    }
    // If external HTTP URL, download and persist
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
      if (imgResp.ok) {
        const contentType = imgResp.headers.get('content-type') || 'image/png';
        const buffer = Buffer.from(await imgResp.arrayBuffer());
        const base64 = `data:${contentType};base64,${buffer.toString('base64')}`;
        const resp = await fetch('http://localhost:5000/api/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: base64 }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.url) return data.url;
        }
      }
      return imageUrl;  // Fallback to original
    }
    return imageUrl;
  } catch (err) {
    console.warn('[refine-engine] Failed to persist result image:', err);
    return imageUrl;  // Always fallback to original URL
  }
}

// ─── Global Result Cache (shared across routes in dev mode) ───
interface RefineResult {
  directImageUrls: string[];
  completedAt: number;
}
function getGlobalRefineResults(): Map<string, RefineResult> {
  if (!(globalThis as Record<string, unknown>).__wujie_refine_results__) {
    (globalThis as Record<string, unknown>).__wujie_refine_results__ = new Map<string, RefineResult>();
  }
  return (globalThis as Record<string, unknown>).__wujie_refine_results__ as Map<string, RefineResult>;
}
function setRefineResult(taskId: string, result: RefineResult) {
  getGlobalRefineResults().set(taskId, result);
}
export function getRefineResult(taskId: string): RefineResult | undefined {
  return getGlobalRefineResults().get(taskId);
}

// ─── Material Library ───
const MATERIAL_LIBRARY: Record<string, { material: string; reflectIndex: number; renderFocus: string }> = {
  alcohol: {
    material: 'Ultra-clear glass',
    reflectIndex: 0.9,
    renderFocus: 'Internal amber light flow, translucent refraction through bottle body, rim lighting to outline contour, crystal-clear liquid visibility',
  },
  gift_box: {
    material: 'Matte textured paper',
    reflectIndex: 0.2,
    renderFocus: 'Fiber texture quality, raised gold-foil stamping depth, minimalist zen lighting, premium craft feel',
  },
  metal_tech: {
    material: 'Brushed aluminum alloy',
    reflectIndex: 0.7,
    renderFocus: 'Precision chamfer highlights, razor-sharp seam edges, flawless mirror finish, cool metallic sheen',
  },
  cosmetic: {
    material: 'Frosted glass with metallic cap',
    reflectIndex: 0.5,
    renderFocus: 'Soft gradient sheen on frosted surface, precise cap alignment, luxurious specular highlights, clean pump mechanism',
  },
  food: {
    material: 'Natural organic texture',
    reflectIndex: 0.3,
    renderFocus: 'Appetizing color saturation, natural texture detail, steam or freshness cues, clean ingredient visibility',
  },
  fabric: {
    material: 'Premium woven textile',
    reflectIndex: 0.15,
    renderFocus: 'Thread-level weave detail, accurate drape and fold, color-rich fabric depth, wrinkle-free presentation',
  },
  jewelry: {
    material: 'Polished precious metal and gemstone',
    reflectIndex: 0.95,
    renderFocus: 'Facet-perfect gem refraction, mirror-polished metal surface, prong-setting precision, fire and brilliance display',
  },
  electronics: {
    material: 'Sleek composite material',
    reflectIndex: 0.4,
    renderFocus: 'Screen clarity, port alignment, button precision, seamless body joints, LED indicator accuracy',
  },
  ceramic: {
    material: 'High-fired glazed ceramic',
    reflectIndex: 0.35,
    renderFocus: 'Glaze depth and richness, symmetrical form, clean base, hand-painted detail precision',
  },
  leather: {
    material: 'Full-grain leather',
    reflectIndex: 0.25,
    renderFocus: 'Natural grain pattern, stitch precision, edge finishing, patina depth, hardware alignment',
  },
  toy: {
    material: 'High-density ABS plastic',
    reflectIndex: 0.3,
    renderFocus: 'Vibrant color accuracy, mold-line elimination, joint precision, surface smoothness, safety certification marks',
  },
  sports: {
    material: 'Performance composite',
    reflectIndex: 0.2,
    renderFocus: 'Aerodynamic form precision, texture grip detail, brand logo clarity, structural integrity display',
  },
  default: {
    material: 'Premium commercial product material',
    reflectIndex: 0.4,
    renderFocus: 'Professional product presentation, material authenticity, brand detail clarity, commercial photography standard',
  },
};

// ─── Lighting Library ───
const LIGHT_LIBRARY: Record<string, string> = {
  soft_studio: 'Museum-grade soft studio light, even illumination across all surfaces, zero harsh shadows, gentle gradient transitions',
  rim_lighting: 'Dramatic rim lighting with dark side, 3/4 back-light creating luminous edge contour, deep shadow on opposite side',
  cool_gradient: 'Cool-tone gradient light, blue-white spectrum, precision highlight on metallic surfaces, clean modern feel',
  warm_ambient: 'Warm ambient lighting with golden hour glow, soft shadows, inviting and luxurious atmosphere',
  dramatic_dark: 'Low-key dramatic lighting, deep shadows with selective spotlight, cinematic mood, high contrast',
  natural_day: 'Natural daylight simulation, soft directional light from upper-left, gentle fill on shadow side, authentic appearance',
  high_key: 'High-key lighting, over-bright white environment, shadowless presentation, clinical precision feel',
};

// ─── View Angles ───
const VIEW_ANGLES: Record<string, string> = {
  front: 'Front-facing orthographic view, centered and symmetrical, zero perspective distortion',
  three_quarter: 'Three-quarter perspective view, slight depth showing product volume, natural viewing angle',
  top_down: 'Top-down flat lay view, bird-eye perspective, perfectly aligned and centered',
  side: 'Side profile view, clean silhouette, structural edge visibility',
  dynamic: 'Dynamic angled view, lifestyle perspective, engaging composition',
};

// ─── Core Constraints ───
const BASE_CONSTRAINTS = 'Strict geometric normalization, perfectly symmetrical, zero distortion, factory-perfect condition, 8K resolution, vector-sharp logos and text, pure white background RGB(255,255,255), no fingerprints/watermarks/dust/scratches.';

// ─── Mode labels for task display ───
const MODE_LABELS: Record<string, string> = {
  standard: '标准精修',
  expert: '专家精修',
};

// ─── Product Refinement Prompt Generator ───
function generateRefinePrompt(params: {
  productCategory: string;
  productName: string;
  materialType: string;
  reflectIndex: number | undefined;
  lightingPreset: string;
  viewAngle: string;
  customInstructions: string;
  mode: string;
}): string {
  const categoryKey = params.productCategory || 'default';
  const matInfo = MATERIAL_LIBRARY[categoryKey] || MATERIAL_LIBRARY.default;
  const light = LIGHT_LIBRARY[params.lightingPreset] || LIGHT_LIBRARY.soft_studio;
  const view = VIEW_ANGLES[params.viewAngle] || VIEW_ANGLES.front;
  const material = params.materialType || matInfo.material;
  const reflectIdx = params.reflectIndex ?? matInfo.reflectIndex;

  let prompt = '';

  if (params.mode === 'expert') {
    // Expert mode: more detailed and customizable
    prompt = `Commercial-grade product refinement: ${params.productName || 'Product'}.
${BASE_CONSTRAINTS}

Material Analysis: ${material} (Reflectance: ${reflectIdx}).
Lighting Design: ${light}.
Camera Angle: ${view}.
Render Priorities: ${matInfo.renderFocus}.
${params.customInstructions ? `Custom Directives: ${params.customInstructions}.` : ''}

Output: Pixel-perfect, publication-ready product image with absolute commercial fidelity.`;
  } else {
    // Standard mode
    prompt = `${params.productName || 'Product'} commercial product photography on pure white background. ${BASE_CONSTRAINTS} Material: ${material}. Reflectance index: ${reflectIdx}. Lighting: ${light}. View: ${view}. ${matInfo.renderFocus}. Absolute sharp details.`;
  }

  return prompt;
}

// ─── Category / Lighting / View display names ───
function getCategoryName(key: string): string {
  const names: Record<string, string> = {
    alcohol: '高端酒类',
    gift_box: '新中式礼盒',
    metal_tech: '工业金属',
    cosmetic: '美妆护肤',
    food: '食品生鲜',
    fabric: '纺织服饰',
    jewelry: '珠宝首饰',
    electronics: '数码电子',
    ceramic: '陶瓷器皿',
    leather: '皮具箱包',
    toy: '玩具潮玩',
    sports: '运动户外',
    default: '通用商品',
  };
  return names[key] || key;
}

function getLightingName(key: string): string {
  const names: Record<string, string> = {
    soft_studio: '全域柔光',
    rim_lighting: '侧逆轮廓光',
    cool_gradient: '冷调渐变',
    warm_ambient: '暖色氛围',
    dramatic_dark: '戏剧性暗调',
    natural_day: '自然日光',
    high_key: '高调白光',
  };
  return names[key] || key;
}

function getViewAngleName(key: string): string {
  const names: Record<string, string> = {
    front: '正视',
    three_quarter: '3/4视角',
    top_down: '俯视',
    side: '侧视',
    dynamic: '动态角度',
  };
  return names[key] || key;
}

// ─── GET: Return presets ───
export async function GET() {
  return NextResponse.json({
    success: true,
    categories: Object.entries(MATERIAL_LIBRARY).map(([key, val]) => ({
      id: key,
      name: getCategoryName(key),
      material: val.material,
      reflectIndex: val.reflectIndex,
      renderFocus: val.renderFocus,
    })),
    lightings: Object.entries(LIGHT_LIBRARY).map(([key, val]) => ({
      id: key,
      name: getLightingName(key),
      description: val,
    })),
    viewAngles: Object.entries(VIEW_ANGLES).map(([key, val]) => ({
      id: key,
      name: getViewAngleName(key),
      description: val,
    })),
  });
}

  // ─── Helper: Get image provider ───
async function getImageProvider(model?: string): Promise<ApiProvider | null> {
  if (model) {
    const p = await findProviderForModel(model);
    if (p) return p;
  }
  // fallback: find any image provider
  const p = await findProviderForModel('', 'image');
  return p;
}

// ─── Helper: Aspect ratio to size ───
function getAspectSize(ratio: string): string {
  const sizes: Record<string, string> = {
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '16:9': '1024x576',
    '9:16': '576x1024',
    '3:2': '1024x683',
    '2:3': '683x1024',
  };
  return sizes[ratio] || '1024x1024';
}

// ─── POST: Generate refined image ───
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'presets') {
      return NextResponse.json({
        success: true,
        categories: Object.entries(MATERIAL_LIBRARY).map(([key, val]) => ({
          id: key,
          name: getCategoryName(key),
          material: val.material,
          reflectIndex: val.reflectIndex,
          renderFocus: val.renderFocus,
        })),
        lightings: Object.entries(LIGHT_LIBRARY).map(([key, val]) => ({
          id: key,
          name: getLightingName(key),
          description: val,
        })),
        viewAngles: Object.entries(VIEW_ANGLES).map(([key, val]) => ({
          id: key,
          name: getViewAngleName(key),
          description: val,
        })),
      });
    }

    if (action === 'models') {
      const models = await getPublicModels('image');
      const providers = await getPublicApiProviders();
      const imageProviders = providers.filter(p => p.isEnabled && (p.modelType === 'image' || p.modelType === 'universal' || p.modelType === 'general'));
      return NextResponse.json({ success: true, models, providers: imageProviders });
    }

    if (action === 'refine') {
      const {
        imageUrl,
        productCategory,
        productName,
        materialType,
        reflectIndex,
        lightingPreset,
        viewAngle,
        customInstructions,
        mode,
        model,
        aspectRatio,
      } = body;

      if (!imageUrl) {
        return NextResponse.json({ error: '请提供产品图片' }, { status: 400 });
      }

      if (!model) {
        return NextResponse.json({ error: '请选择生图模型' }, { status: 400 });
      }

      // Find provider for the model
      const provider = await getImageProvider(model);
      if (!provider) {
        return NextResponse.json({ error: `未找到模型 ${model} 对应的API提供商` }, { status: 400 });
      }

      const selectedModel = model || provider.selectedModels?.[0];

      // Generate the refinement prompt (standard / expert mode)
      const refineMode = (mode === 'expert') ? 'expert' : 'standard';
      const prompt = generateRefinePrompt({
        productCategory: productCategory || 'default',
        productName: productName || '',
        materialType: materialType || '',
        reflectIndex: reflectIndex ?? undefined,
        lightingPreset: lightingPreset || 'soft_studio',
        viewAngle: viewAngle || 'front',
        customInstructions: customInstructions || '',
        mode: refineMode,
      });

      // Register task
      const taskId = `refine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      registerTask(taskId, 'refine-engine', `精修: ${productName || MODE_LABELS[refineMode] || '产品'}`);

      // Register task in global registry so poll-task can find it
      registerTask(taskId, 'refine-engine', '精修处理中');

      // Fire-and-forget: process in background, store result in task-registry
      // Frontend polls /api/poll-task to get progress and results
      processRefine(taskId, {
        imageUrl: imageUrl,
        prompt,
        model: selectedModel,
        provider,
        aspectRatio: aspectRatio || '1:1',
      }).catch((err: Error) => {
        updateTaskProgress(taskId, { status: 'failed', error: err.message });
      });

      // Return taskId immediately for polling
      return NextResponse.json({ success: true, taskId });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Async refine processing ───
async function processRefine(
  taskId: string,
  params: {
    imageUrl: string;
    prompt: string;
    model: string;
    provider: ApiProvider;
    aspectRatio: string;
  }
): Promise<{ directImageUrls: string[] }> {
  console.log(`[refine-engine] processRefine START taskId=${taskId}`);
  updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '构建精修提示词...' });

  const compatProfile = resolveCompatProfile(params.provider);

  updateTaskProgress(taskId, { progress: 20, label: '准备参考图片...' });

  // Build request body
  const rawBody: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: 1,
    size: getAspectSize(params.aspectRatio),
  };

  // ─── Prepare image for API ───
  // Follow the same pattern as /api/generate: provide both image_urls (accessible URLs)
  // and image (base64 for /images/edits endpoint)
  if (params.imageUrl) {
    let imageAsBase64: string | undefined;

    // 1) Local path: read from filesystem and convert to base64
    if (params.imageUrl.startsWith('/api/serve-upload/') || params.imageUrl.startsWith('/uploads/')) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
        const publicDir = path.join(workspacePath, 'public');
        let filePath = '';
        if (params.imageUrl.startsWith('/api/serve-upload/')) {
          const fileName = params.imageUrl.replace('/api/serve-upload/', '');
          filePath = path.join(publicDir, 'uploads', fileName);
        } else {
          filePath = path.join(publicDir, params.imageUrl.replace(/^\//, ''));
        }
        const resolved = path.resolve(filePath);
        if (resolved.startsWith(publicDir)) {
          const imgBuf = await fs.readFile(resolved);
          const ext = path.extname(resolved).toLowerCase();
          const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
          const mime = mimeMap[ext] || 'image/png';
          imageAsBase64 = `data:${mime};base64,${imgBuf.toString('base64')}`;
        }
      } catch (localErr) {
        console.warn('[refine-engine] Failed to read local image:', localErr);
      }
    }
    // 2) HTTP URL: download and convert to base64
    else if (params.imageUrl.startsWith('http://') || params.imageUrl.startsWith('https://')) {
      try {
        const imgResp = await fetch(params.imageUrl, { signal: AbortSignal.timeout(15000) });
        if (imgResp.ok) {
          const imgBuf = Buffer.from(await imgResp.arrayBuffer());
          const contentType = imgResp.headers.get('content-type') || 'image/png';
          imageAsBase64 = `data:${contentType};base64,${imgBuf.toString('base64')}`;
        }
      } catch (imgErr) {
        console.warn('[refine-engine] Failed to download image:', imgErr);
      }
    }
    // 3) Already base64 data URL
    else if (params.imageUrl.startsWith('data:')) {
      imageAsBase64 = params.imageUrl;
    }

    // Compress large base64 images (>1MB) to reduce API request size
    if (imageAsBase64 && imageAsBase64.length > 1_000_000) {
      try {
        const sharp = (await import('sharp')).default;
        const base64Data = imageAsBase64.split(',')[1];
        const imgBuf = Buffer.from(base64Data, 'base64');
        const compressed = await sharp(imgBuf)
          .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toBuffer();
        imageAsBase64 = `data:image/jpeg;base64,${compressed.toString('base64')}`;
      } catch (compressErr) {
        console.warn('[refine-engine] Image compression failed:', compressErr);
      }
    }

    // Provide both fields for maximum compatibility:
    // - image (base64): Required by /images/edits, AI must process this as source image
    // - image_urls (HTTP URLs): Required by /images/generations (APImart etc.) for reference-based generation
    if (imageAsBase64) {
      rawBody.image = imageAsBase64;
    }
    // image_urls MUST be an HTTP-accessible URL for providers like APImart
    if (params.imageUrl.startsWith('http')) {
      rawBody.image_urls = [params.imageUrl];
    } else if (imageAsBase64) {
      // For local/data images, upload to our server to get an HTTP URL for image_urls field
      try {
        const saveRes = await fetch('http://localhost:5000/api/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: imageAsBase64.startsWith('data:') ? imageAsBase64 : `data:image/png;base64,${imageAsBase64}` }),
        });
        if (saveRes.ok) {
          const saveData = await saveRes.json();
          if (saveData.url) {
            rawBody.image_urls = [saveData.url];
            console.log('[refine-engine] Uploaded image for image_urls:', saveData.url);
          }
        }
      } catch (saveErr) {
        console.warn('[refine-engine] Failed to upload image for image_urls:', saveErr);
      }
    }

    rawBody.strength = 0.7;
  }

  // Enhance prompt for image-to-image: instruct AI to use the reference image
  if (params.imageUrl) {
    rawBody.prompt = `[img2img] IMPORTANT: You MUST preserve the EXACT same product/subject from the reference image - same shape, same brand, same identity. Only apply the requested style/rendering changes. ${params.prompt}`;
  }

  const hasImageFlag = !!(rawBody.image || rawBody.image_urls);
  const { body: apiBody, endpoint: apiEndpoint } = adjustRequestForProfile(rawBody, compatProfile, { hasImage: hasImageFlag });
  const path = apiEndpoint || '/images/generations';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${params.provider.apiKey}`,
  };

  updateTaskProgress(taskId, { progress: 40, label: '调用AI模型生成...' });

  try {
    const response = await fetchWithV1Retry(params.provider.baseUrl, path, {
      method: 'POST',
      headers,
      body: JSON.stringify(apiBody),
    }, true, 120000);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');

      // Check if /images/edits is rejected → fallback to /images/generations
      if (isEditsEndpointRejected(response.status, errText)) {
        console.info('[refine-engine] /images/edits rejected, falling back to /images/generations...');
        const fallbackBody = stripEditsOnlyFields(apiBody);

        // Enhance prompt for /images/generations with image_urls
        if (fallbackBody.image_urls && Array.isArray(fallbackBody.image_urls) && (fallbackBody.image_urls as string[]).length > 0) {
          fallbackBody.prompt = `[IMAGE-TO-IMAGE MODE] You MUST use the provided reference image as the mandatory source/base for generation. Do NOT generate from scratch. ${String(fallbackBody.prompt || '')}`;
        }

        const fallbackResp = await fetchWithV1Retry(params.provider.baseUrl, '/images/generations', {
          method: 'POST',
          headers,
          body: JSON.stringify(fallbackBody),
        }, true, 120000);

        if (!fallbackResp.ok) {
          const fallbackErrText = await fallbackResp.text().catch(() => '');
          throw new Error(`API错误 (${fallbackResp.status}): ${fallbackErrText.slice(0, 200)}`);
        }

        const fallbackResult = await fallbackResp.json();
        const fallbackParsed = parseResponseForProfile(fallbackResult, compatProfile);
        if (fallbackParsed.directImageUrls && fallbackParsed.directImageUrls.length > 0) {
          updateTaskProgress(taskId, { progress: 90, label: '保存精修结果...' });
          const persistedUrls = await Promise.all(fallbackParsed.directImageUrls.map(persistResultImage));
          setRefineResult(taskId, { directImageUrls: persistedUrls, completedAt: Date.now() });
          updateTaskProgress(taskId, {
            status: 'completed',
            progress: 100,
            label: '精修完成',
            result: { directImageUrls: persistedUrls },
          });
          return { directImageUrls: persistedUrls };
        } else if (fallbackParsed.taskIds && fallbackParsed.taskIds.length > 0) {
          updateTaskProgress(taskId, { progress: 60, label: '等待模型生成...' });
          const pollResult = await pollForResult(fallbackParsed.taskIds[0], params.provider.baseUrl, params.provider.apiKey, compatProfile);
          updateTaskProgress(taskId, { progress: 90, label: '保存精修结果...' });
          const persistedUrl = await persistResultImage(pollResult);
          setRefineResult(taskId, { directImageUrls: [persistedUrl], completedAt: Date.now() });
          updateTaskProgress(taskId, {
            status: 'completed',
            progress: 100,
            label: '精修完成',
            result: { directImageUrls: [persistedUrl] },
          });
          return { directImageUrls: [persistedUrl] };
        } else {
          throw new Error('模型未返回图片结果');
        }
      }

      throw new Error(`API错误 (${response.status}): ${errText.slice(0, 200)}`);
    }

    updateTaskProgress(taskId, { progress: 70, label: '解析生成结果...' });

    const result = await response.json();
    const parsed = parseResponseForProfile(result, compatProfile);

    if (parsed.directImageUrls && parsed.directImageUrls.length > 0) {
      updateTaskProgress(taskId, { progress: 90, label: '保存精修结果...' });
      const persistedUrls = await Promise.all(parsed.directImageUrls.map(persistResultImage));
      setRefineResult(taskId, { directImageUrls: persistedUrls, completedAt: Date.now() });
      updateTaskProgress(taskId, {
        status: 'completed',
        progress: 100,
        label: '精修完成',
        result: { directImageUrls: persistedUrls },
      });
      return { directImageUrls: persistedUrls };
    } else if (parsed.taskIds && parsed.taskIds.length > 0) {
      // Poll for async result
      updateTaskProgress(taskId, { progress: 50, label: '等待模型生成...' });
      const pollResult = await pollForResult(parsed.taskIds[0], params.provider.baseUrl, params.provider.apiKey, compatProfile);
      updateTaskProgress(taskId, { progress: 90, label: '保存精修结果...' });
      const persistedUrl = await persistResultImage(pollResult);
      setRefineResult(taskId, { directImageUrls: [persistedUrl], completedAt: Date.now() });
      updateTaskProgress(taskId, {
        status: 'completed',
        progress: 100,
        label: '精修完成',
        result: { directImageUrls: [persistedUrl] },
      });
      return { directImageUrls: [persistedUrl] };
    } else {
      throw new Error('模型未返回图片结果');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    updateTaskProgress(taskId, { status: 'failed', error: message });
    throw err; // Re-throw so the POST handler can return the error
  }
}

async function pollForResult(
  taskId: string,
  baseUrl: string,
  apiKey: string,
  profile: ReturnType<typeof resolveCompatProfile>
): Promise<string> {
  // ★ 增加轮询超时：部分模型生成耗时较长（如213秒），需要足够长的轮询时间
  const maxAttempts = 120;  // 120 × 3s = 360s (6 minutes)
  const interval = 3000;
  for (let i = 0; i < maxAttempts; i++) {
    if (isTaskCancelled(taskId)) throw new Error('任务已取消');
    await new Promise(r => setTimeout(r, interval));
    try {
      const pollUrl = `${baseUrl}/tasks/${taskId}`;
      const resp = await fetchWithV1Retry(baseUrl, `/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }, true, 15000);
      if (resp.ok) {
        const data = await resp.json();
        const parsed = parseResponseForProfile(data, profile);
        if (parsed.directImageUrls && parsed.directImageUrls.length > 0) {
          return parsed.directImageUrls[0];
        }
        if (parsed.taskIds && parsed.taskIds.length > 0) {
          continue;
        }
      }
    } catch {
      // Continue polling
    }
  }
  throw new Error('轮询超时，请稍后重试');
}
