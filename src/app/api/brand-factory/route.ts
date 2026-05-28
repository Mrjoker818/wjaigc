/**
 * 品牌工厂 API
 * POST /api/brand-factory  — 操作(action)
 * GET  /api/brand-factory  — 获取项目列表
 *
 * 支持的 action:
 *   create-project, delete-project, archive-project,
 *   analyze-dna, generate-directions, generate-kv,
 *   batch-generate, consistency-check, save-version,
 *   generate-chinese-title
 */

import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderForFeature } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile, buildPollUrl, extractImageUrl } from '@/lib/api-compatibility';
import type { ApiCompatProfile } from '@/lib/api-compatibility';
import type { ApiProvider } from '@/lib/universal-api-types';
import { dbGetUserData, dbSetUserData } from '@/lib/db-storage';

// ─── 内存项目存储 ────────────────────────────────────────────────────
const BRAND_PROJECTS_KEY = 'brand_factory_projects';
const projectsStore = new Map<string, Record<string, unknown>>();

/** 获取所有项目（内存 → 数据库） */
async function loadProjects(): Promise<Record<string, unknown>[]> {
  if (projectsStore.size > 0) {
    return Array.from(projectsStore.values());
  }
  try {
    const data = await dbGetUserData('__system__', BRAND_PROJECTS_KEY);
    if (data && typeof data === 'object') {
      const arr = (data as { projects?: Record<string, unknown>[] }).projects || [];
      for (const p of arr) {
        const id = (p.id as string) || '';
        if (id) projectsStore.set(id, p);
      }
    }
  } catch { /* ignore */ }
  return Array.from(projectsStore.values());
}

/** 持久化所有项目到数据库 */
async function persistProjects(): Promise<void> {
  try {
    const projects = Array.from(projectsStore.values());
    await dbSetUserData('__system__', BRAND_PROJECTS_KEY, { projects });
  } catch (e) {
    console.error('[brand-factory] persist error:', e);
  }
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 模型调用辅助 ────────────────────────────────────────────────────

async function getImageProvider(imageModel?: string): Promise<ApiProvider | null> {
  if (imageModel) {
    const provider = await findProviderForModel(imageModel, 'image');
    if (provider) return provider;
  }
  return findProviderForFeature('imageEdit');
}

async function getLLMProvider(llmModel?: string): Promise<ApiProvider | null> {
  if (llmModel) {
    const provider = await findProviderForModel(llmModel, 'chat');
    if (provider) return provider;
  }
  return findProviderForFeature('chat');
}

async function callLLM(
  prompt: string,
  systemPrompt: string,
  llmModel?: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<{ success: boolean; content?: string; error?: string }> {
  const provider = await getLLMProvider(llmModel);
  if (!provider) {
    return { success: false, error: '未找到可用的LLM模型提供商，请在管理员后台配置' };
  }

  const model = llmModel || provider.selectedModels?.[0] || 'gpt-4o';
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');

  try {
    const response = await fetchWithV1Retry(baseUrl, '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { success: false, error: `LLM调用失败(${response.status}): ${errText.slice(0, 200)}` };
    }

    const contentType = response.headers.get('content-type') || '';
    let content = '';

    if (contentType.includes('text/event-stream')) {
      const readController = new AbortController();
      const readTimeout = setTimeout(() => readController.abort(), 120_000);
      let text = '';
      try {
        const reader = response.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            if (text.includes('[DONE]')) break;
          }
        } else {
          text = await response.text();
        }
      } catch { /* timeout */ } finally {
        clearTimeout(readTimeout);
      }
      const lines = text.split('\n');
      let accumulated = '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const chunk = JSON.parse(jsonStr);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) accumulated += delta;
          } catch { /* skip */ }
        }
      }
      content = accumulated;
    } else {
      const data = await response.json();
      content = data.choices?.[0]?.message?.content || '';
    }

    return { success: true, content };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `LLM调用异常: ${message}` };
  }
}

/** 从原始API响应中提取图片URL（兜底） */
function extractImageUrlsFromRaw(data: Record<string, unknown>): string[] {
  const urls: string[] = [];
  // 检查 data.images[].url
  const images = data.images || (data.data as Record<string, unknown>)?.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === 'object' && img !== null) {
        const url = (img as Record<string, unknown>).url || (img as Record<string, unknown>).b64_json;
        if (typeof url === 'string') urls.push(url);
      } else if (typeof img === 'string') {
        urls.push(img);
      }
    }
  }
  // 检查 data.output.image_urls[]
  const output = data.output || (data.data as Record<string, unknown>)?.output;
  if (typeof output === 'object' && output !== null) {
    const imageUrls = (output as Record<string, unknown>).image_urls;
    if (Array.isArray(imageUrls)) {
      for (const u of imageUrls) { if (typeof u === 'string') urls.push(u); }
    }
  }
  return urls;
}

async function generateImage(
  prompt: string,
  imageModel?: string,
  options?: { size?: string; quality?: string; n?: number }
): Promise<{ success: boolean; imageUrl?: string; imageUrls?: string[]; taskId?: string; error?: string }> {
  const provider = await getImageProvider(imageModel);
  if (!provider) {
    return { success: false, error: '未找到可用的图像模型提供商，请在管理员后台配置' };
  }

  const model = imageModel || provider.selectedModels?.[0] || 'dall-e-3';
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const profile = resolveCompatProfile(provider);

  try {
    const rawBody: Record<string, unknown> = {
      model,
      prompt,
      n: options?.n ?? 1,
      size: options?.size ?? '1024x1024',
    };
    if (options?.quality) rawBody.quality = options.quality;

    const { body, endpoint } = adjustRequestForProfile(rawBody, profile, {});

    const response = await fetchWithV1Retry(baseUrl, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { success: false, error: `图像生成失败(${response.status}): ${errText.slice(0, 200)}` };
    }

    const data = await response.json();

    if (data.data && Array.isArray(data.data)) {
      const firstItem = data.data[0] as Record<string, unknown> | undefined;
      if (firstItem?.task_id) {
        return { success: true, taskId: firstItem.task_id as string };
      }
      const urls = data.data
        .map((item: Record<string, unknown>) => item.url || item.b64_json)
        .filter(Boolean) as string[];
      if (urls.length > 0) {
        return { success: true, imageUrl: urls[0], imageUrls: urls };
      }
    }

    if (data.task_id || data.id) {
      return { success: true, taskId: (data.task_id || data.id) as string };
    }

    if (data.images && Array.isArray(data.images)) {
      const urls = data.images.map((img: Record<string, unknown>) => img.url || img).filter(Boolean) as string[];
      if (urls.length > 0) {
        return { success: true, imageUrl: urls[0], imageUrls: urls };
      }
    }

    return { success: false, error: '图像生成返回格式异常' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `图像生成异常: ${message}` };
  }
}

/** 轮询异步任务结果（最多60秒） */
async function pollTaskResult(
  taskId: string,
  providerInfo: { baseUrl: string; apiKey: string; profile: ApiCompatProfile },
  maxMs = 60000
): Promise<{ success: boolean; imageUrl?: string; imageUrls?: string[]; error?: string }> {
  const pollUrl = buildPollUrl(providerInfo.baseUrl, taskId, providerInfo.profile);
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const resp = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${providerInfo.apiKey}` },
      });
      if (!resp.ok) continue;
      const pollData = await resp.json() as Record<string, unknown>;
      // 检查任务状态
      const taskStatus = (pollData.status || pollData.data && typeof pollData.data === 'object' && (pollData.data as Record<string, unknown>).status) as string;
      if (taskStatus === 'completed' || taskStatus === 'success') {
        // 使用 parseResponseForProfile 提取图片URL
        const parsed = parseResponseForProfile(pollData, providerInfo.profile);
        const urls = parsed.directImageUrls;
        if (urls && urls.length > 0) {
          return { success: true, imageUrl: urls[0], imageUrls: urls };
        }
        // 尝试从原始数据中手动提取URL
        const rawUrls = extractImageUrlsFromRaw(pollData);
        if (rawUrls.length > 0) {
          return { success: true, imageUrl: rawUrls[0], imageUrls: rawUrls };
        }
        return { success: false, error: '任务完成但未返回图片URL' };
      }
      if (taskStatus === 'failed') {
        return { success: false, error: '异步任务失败' };
      }
    } catch { /* continue polling */ }
  }
  return { success: false, error: '轮询超时，请稍后查看结果' };
}

/** 生成图片（自动轮询异步任务） */
async function generateImageWithPoll(
  prompt: string,
  imageModel?: string,
  options?: { size?: string; quality?: string; n?: number }
): Promise<{ success: boolean; imageUrl?: string; imageUrls?: string[]; error?: string }> {
  const result = await generateImage(prompt, imageModel, options);
  if (!result.success) return result;
  // 如果同步返回了图片URL，直接返回
  if (result.imageUrl || result.imageUrls) return result;
  // 异步任务，需要轮询
  if (result.taskId) {
    const provider = await getImageProvider(imageModel);
    if (!provider) return { success: false, error: '未找到提供商' };
    const profile = resolveCompatProfile(provider);
    return pollTaskResult(result.taskId, {
      baseUrl: provider.baseUrl.replace(/\/+$/, ''),
      apiKey: provider.apiKey,
      profile,
    });
  }
  return result;
}

// ─── Prompt 构建 ─────────────────────────────────────────────────────

function buildAnalyzeDNAPrompt(body: Record<string, unknown>): { system: string; user: string } {
  const brandName = body.brandName as string || '';
  const industry = body.industry as string || '';
  const tone = body.tone as string || '';
  const keywords = body.keywords as string[] || [];
  const hasLogo = !!(body.logoUrl as string);
  const hasProduct = !!(body.productUrl as string);
  const hasIP = !!(body.ipUrl as string);

  return {
    system: `You are a senior brand strategy consultant. Analyze the brand information and output a BrandDNA JSON object. Output ONLY valid JSON, no markdown, no explanation.`,
    user: `Analyze this brand and generate a BrandDNA:
Brand: ${brandName}
Industry: ${industry}
Tone: ${tone}
Keywords: ${keywords.join(', ')}
Has Logo: ${hasLogo}, Has Product: ${hasProduct}, Has IP: ${hasIP}

Output JSON schema:
{
  "brandKeywords": ["keyword1", "keyword2", ...], (5-8 brand-defining keywords)
  "mainColors": ["#hex1", "#hex2"], (2-3 primary brand colors)
  "secondaryColors": ["#hex3", "#hex4"], (2-3 secondary/auxiliary colors)
  "fontStyle": "description of typography style",
  "visualTone": "description of overall visual direction",
  "logoRules": ["rule1", "rule2"], (3-5 logo usage guidelines)
  "productRules": ["rule1", "rule2"], (3-5 product photography/display rules)
  "ipRules": ["rule1", "rule2"], (3-5 IP character usage rules, if applicable)
  "forbiddenRules": ["rule1", "rule2"], (3-5 things to avoid)
  "recommendedMaterials": ["material1", "material2"] (5-8 recommended material types)
}`,
  };
}

function buildGenerateDirectionsPrompt(brandDna: Record<string, unknown>, count: number): { system: string; user: string } {
  return {
    system: `You are a creative director specializing in brand campaigns. Based on the BrandDNA, generate creative directions. Output ONLY valid JSON array, no markdown, no explanation.`,
    user: `Based on this BrandDNA, generate ${count} creative directions:
${JSON.stringify(brandDna, null, 2)}

Output JSON array schema:
[
  {
    "id": "dir_1",
    "name": "方向名称",
    "concept": "核心理念描述(50字以内)",
    "slogan": "广告语/口号",
    "visualKeywords": ["关键词1", "关键词2", "关键词3"],
    "colorPlan": ["#hex1", "#hex2", "#hex3"],
    "fontPlan": "字体方案描述",
    "prompt": "A detailed English image generation prompt for this creative direction, suitable for AI image generation",
    "previewImages": []
  }
]`,
  };
}

function buildKVImagePrompt(
  brandDna: Record<string, unknown> | null,
  body: Record<string, unknown>
): string {
  const theme = body.theme as string || '';
  const slogan = body.slogan as string || '';
  const ratio = body.ratio as string || '16:9';
  const direction = body.direction as string || '';

  const dnaContext = brandDna
    ? `Brand DNA: keywords=${(brandDna.brandKeywords as string[] || []).join(',')}, colors=${(brandDna.mainColors as string[] || []).join(',')}, tone=${brandDna.visualTone || ''}`
    : '';

  return `Professional brand Key Visual (KV) design, ${dnaContext}, theme: ${theme}, slogan: "${slogan}", creative direction: ${direction}, ratio: ${ratio}, high-end commercial quality, clean composition, premium visual impact`;
}

function buildBatchMaterialPrompt(
  brandDna: Record<string, unknown> | null,
  materialType: string,
  item: string
): string {
  const dnaContext = brandDna
    ? `Brand colors: ${(brandDna.mainColors as string[] || []).join(',')}, style: ${brandDna.visualTone || ''}`
    : '';
  return `Professional ${materialType} material design: ${item}, ${dnaContext}, high-quality commercial design, clean and professional`;
}

function buildConsistencyCheckPrompt(
  brandName: string,
  brandDna: Record<string, unknown>,
  materials: unknown[]
): { system: string; user: string } {
  return {
    system: `You are a brand consistency auditor. Evaluate how well the generated materials match the brand DNA. Output ONLY valid JSON, no markdown.`,
    user: `Brand: ${brandName}
BrandDNA: ${JSON.stringify(brandDna, null, 2)}
Materials to evaluate (${materials.length} items): ${JSON.stringify(materials).slice(0, 2000)}

Evaluate consistency and output:
{
  "overallScore": 0-100,
  "colorConsistency": 0-100,
  "styleConsistency": 0-100,
  "toneConsistency": 0-100,
  "suggestions": ["improvement suggestion 1", "suggestion 2"]
}`,
  };
}

function buildChineseTitlePrompt(
  text: string,
  scene: string,
  style: string,
  brandDna: Record<string, unknown> | null
): string {
  const dnaContext = brandDna
    ? `Brand style: ${brandDna.visualTone || ''}, colors: ${(brandDna.mainColors as string[] || []).join(',')}`
    : '';
  return `Chinese typography design, text "${text}", scene: ${scene}, style: ${style}, ${dnaContext}, artistic Chinese character rendering, professional commercial design quality`;
}

// ─── GET: 获取项目列表 ────────────────────────────────────────────────

export async function GET() {
  try {
    const projects = await loadProjects();
    return NextResponse.json({ success: true, projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[brand-factory] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST: 操作 ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;
    const imageModel = body.imageModel as string | undefined;
    const llmModel = body.llmModel as string | undefined;

    switch (action) {
      // ─── 项目管理 ─────────────────────────────────────
      case 'create-project': {
        const id = genId('bf');
        const now = new Date().toISOString();
        const project: Record<string, unknown> = {
          id,
          project_name: body.projectName || body.brandName || '',
          brand_name: body.brandName || '',
          industry: body.industry || '',
          project_type: body.projectType || '',
          tone: body.tone || '',
          keywords: JSON.stringify(body.keywords || []),
          target_audience: body.targetAudience || '',
          description: body.description || '',
          logo_url: '',
          product_url: '',
          ip_url: '',
          reference_urls: JSON.stringify([]),
          brand_dna: null,
          creative_directions: null,
          kv_image_url: '',
          batch_results: null,
          consistency_scores: null,
          status: 'draft',
          is_archived: false,
          created_at: now,
          updated_at: now,
        };
        projectsStore.set(id, project);
        await persistProjects();
        return NextResponse.json({ success: true, project });
      }

      case 'update-project': {
        const id = body.id as string;
        if (!id) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
        const proj = projectsStore.get(id);
        if (!proj) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
        // camelCase → snake_case 字段映射（前端发送camelCase，存储用snake_case）
        const fieldMap: Record<string, string> = {
          brandName: 'brand_name',
          projectName: 'project_name',
          projectType: 'project_type',
          targetAudience: 'target_audience',
          logoUrl: 'logo_url',
          productUrl: 'product_url',
          ipUrl: 'ip_url',
          referenceUrls: 'reference_urls',
          brandDna: 'brand_dna',
          creativeDirections: 'creative_directions',
          generatedMaterials: 'generated_materials',
          isArchived: 'is_archived',
          kvImageUrl: 'kv_image_url',
          batchResults: 'batch_results',
          consistencyScores: 'consistency_scores',
        };
        const updatableFields = [
          'brand_name', 'industry', 'project_type', 'tone', 'keywords',
          'target_audience', 'description', 'logo_url', 'product_url',
          'ip_url', 'reference_urls', 'brand_dna', 'creative_directions',
          'status', 'generated_materials', 'versions', 'project_name', 'is_archived',
          'kv_image_url', 'batch_results', 'consistency_scores',
        ];
        for (const field of updatableFields) {
          // 支持前端发送的 camelCase 和存储用的 snake_case
          const camelKey = Object.entries(fieldMap).find(([, v]) => v === field)?.[0];
          const value = body[field] ?? (camelKey ? body[camelKey] : undefined);
          if (value !== undefined) {
            (proj as Record<string, unknown>)[field] = typeof value === 'object' ? JSON.stringify(value) : value;
          }
        }
        proj.updated_at = new Date().toISOString();
        projectsStore.set(id, proj);
        await persistProjects();
        return NextResponse.json({ success: true, project: proj });
      }

      case 'delete-project': {
        const id = body.id as string;
        if (!id) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
        projectsStore.delete(id);
        await persistProjects();
        return NextResponse.json({ success: true });
      }

      case 'archive-project': {
        const id = body.id as string;
        if (!id) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
        const proj = projectsStore.get(id);
        if (proj) {
          proj.is_archived = true;
          proj.updated_at = new Date().toISOString();
          projectsStore.set(id, proj);
          await persistProjects();
        }
        return NextResponse.json({ success: true });
      }

      // ─── 品牌DNA分析 ───────────────────────────────────
      case 'analyze-dna': {
        const projectId = body.projectId as string;
        if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

        const { system, user } = buildAnalyzeDNAPrompt(body);
        const result = await callLLM(user, system, llmModel, { maxTokens: 4096, temperature: 0.7 });

        if (!result.success || !result.content) {
          return NextResponse.json({ error: result.error || '品牌DNA分析失败' }, { status: 500 });
        }

        // 解析LLM返回的JSON
        let brandDna: Record<string, unknown> | null = null;
        try {
          // 尝试从返回内容中提取JSON
          const content = result.content;
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            brandDna = JSON.parse(jsonMatch[0]);
          }
        } catch {
          // JSON解析失败，返回原始内容作为参考
          brandDna = {
            brandKeywords: [],
            mainColors: [],
            secondaryColors: [],
            fontStyle: '',
            visualTone: result.content.slice(0, 200),
            logoRules: [],
            productRules: [],
            ipRules: [],
            forbiddenRules: [],
            recommendedMaterials: [],
            _rawContent: result.content,
          };
        }

        // 更新项目
        const proj = projectsStore.get(projectId);
        if (proj) {
          proj.brand_dna = JSON.stringify(brandDna);
          proj.status = 'active';
          proj.updated_at = new Date().toISOString();
          projectsStore.set(projectId, proj);
          await persistProjects();
        }

        return NextResponse.json({ success: true, brandDna });
      }

      // ─── 生成创意方向 ───────────────────────────────────
      case 'generate-directions': {
        const projectId = body.projectId as string;
        const brandDnaRaw = body.brandDna as Record<string, unknown> | undefined;
        const count = (body.count as number) || 3;

        if (!projectId || !brandDnaRaw) {
          return NextResponse.json({ error: '缺少项目ID或品牌DNA' }, { status: 400 });
        }

        const { system, user } = buildGenerateDirectionsPrompt(brandDnaRaw, count);
        const result = await callLLM(user, system, llmModel, { maxTokens: 4096, temperature: 0.8 });

        if (!result.success || !result.content) {
          return NextResponse.json({ error: result.error || '创意方向生成失败' }, { status: 500 });
        }

        let directions: Record<string, unknown>[] = [];
        try {
          const content = result.content;
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            directions = JSON.parse(jsonMatch[0]);
            // 确保每个方向都有id
            directions = directions.map((d, i) => ({
              id: d.id || `dir_${i + 1}`,
              previewImages: [],
              ...d,
            }));
          }
        } catch {
          directions = [{
            id: 'dir_1',
            name: '创意方向',
            concept: result.content.slice(0, 50),
            slogan: '',
            visualKeywords: [],
            colorPlan: [],
            fontPlan: '',
            prompt: result.content,
            previewImages: [],
          }];
        }

        // 更新项目
        const proj = projectsStore.get(projectId);
        if (proj) {
          proj.creative_directions = JSON.stringify(directions);
          proj.updated_at = new Date().toISOString();
          projectsStore.set(projectId, proj);
          await persistProjects();
        }

        return NextResponse.json({ success: true, directions });
      }

      // ─── 生成KV图 ──────────────────────────────────────
      case 'generate-kv': {
        const kvProjectId = body.projectId as string | undefined;
        const brandDna = body.brandDna as Record<string, unknown> | null;
        const prompt = buildKVImagePrompt(brandDna, body);

        const result = await generateImageWithPoll(prompt, imageModel, {
          size: body.ratio === '9:16' ? '1024x1536' : body.ratio === '1:1' ? '1024x1024' : '1536x1024',
        });

        if (!result.success) {
          return NextResponse.json({ error: result.error || 'KV图生成失败' }, { status: 500 });
        }

        // 保存KV图URL到项目
        if (kvProjectId && result.imageUrl) {
          const proj = projectsStore.get(kvProjectId);
          if (proj) {
            proj.kv_image_url = result.imageUrl;
            proj.updated_at = new Date().toISOString();
            await persistProjects();
          }
        }

        return NextResponse.json({
          success: true,
          imageUrl: result.imageUrl,
          imageUrls: result.imageUrls,
        });
      }

      // ─── 批量生成素材 ──────────────────────────────────
      case 'batch-generate': {
        const projectId = body.projectId as string;
        const materialType = body.materialType as string || '通用';
        const items = body.items as string[] || [];
        const brandDna = body.brandDna as Record<string, unknown> | null;

        if (!items.length) {
          return NextResponse.json({ error: '请选择至少一个素材类型' }, { status: 400 });
        }

        // 逐个生成（简化版，实际可并行）
        const results: { item: string; imageUrl?: string; error?: string }[] = [];
        for (const item of items) {
          const prompt = buildBatchMaterialPrompt(brandDna, materialType, item);
          const result = await generateImageWithPoll(prompt, imageModel, { size: '1024x1024' });
          results.push({
            item,
            imageUrl: result.imageUrl,
            error: result.success ? undefined : (result.error || '生成失败'),
          });
        }

        // 保存到项目
        const proj = projectsStore.get(projectId);
        if (proj) {
          const existingMaterials = (proj.generated_materials as string) || '[]';
          let materials: Record<string, unknown>[] = [];
          try { materials = JSON.parse(existingMaterials); } catch { /* ignore */ }
          for (const r of results) {
            if (r.imageUrl) {
              materials.push({
                id: genId('mat'),
                projectId,
                directionId: '',
                type: materialType,
                title: r.item,
                ratio: '1:1',
                imageUrl: r.imageUrl,
                prompt: buildBatchMaterialPrompt(brandDna, materialType, r.item),
                score: 0,
                status: 'draft',
                createdAt: new Date().toISOString(),
              });
            }
          }
          proj.batch_results = JSON.stringify(results.filter(r => r.imageUrl).map(r => ({
            item: r.item,
            imageUrl: r.imageUrl,
          })));
          proj.updated_at = new Date().toISOString();
          projectsStore.set(projectId, proj);
          await persistProjects();
        }

        return NextResponse.json({
          success: true,
          results,
          materials: results.filter(r => r.imageUrl).map(r => ({
            id: genId('mat'),
            projectId,
            type: materialType,
            title: r.item,
            imageUrl: r.imageUrl,
          })),
        });
      }

      // ─── 一致性检查 ────────────────────────────────────
      case 'consistency-check': {
        const brandName = body.brandName as string || '';
        const brandDna = body.brandDna as Record<string, unknown>;
        const materials = body.materials as unknown[] || [];

        if (!brandDna) {
          return NextResponse.json({ error: '请先分析品牌DNA' }, { status: 400 });
        }

        const { system, user } = buildConsistencyCheckPrompt(brandName, brandDna, materials);
        const result = await callLLM(user, system, llmModel, { maxTokens: 2048, temperature: 0.3 });

        if (!result.success || !result.content) {
          return NextResponse.json({ error: result.error || '一致性检查失败' }, { status: 500 });
        }

        let scores: Record<string, unknown> = {};
        try {
          const content = result.content;
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            scores = JSON.parse(jsonMatch[0]);
          }
        } catch {
          scores = { overallScore: 0, error: '解析失败', rawContent: result.content };
        }

        return NextResponse.json({ success: true, scores });
      }

      // ─── 保存版本 ──────────────────────────────────────
      case 'save-version': {
        const projectId = body.projectId as string;
        if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

        // 版本记录保存到项目数据中
        const proj = projectsStore.get(projectId);
        if (proj) {
          const existingVersions = (proj.versions as string) || '[]';
          let versions: Record<string, unknown>[] = [];
          try { versions = JSON.parse(existingVersions); } catch { /* ignore */ }
          versions.push({
            id: genId('ver'),
            projectId,
            targetType: body.targetType || 'proposal',
            targetId: body.targetId || projectId,
            versionName: body.versionName || 'V1',
            note: body.note || '',
            snapshot: body.snapshot || {},
            createdBy: 'user',
            createdAt: new Date().toISOString(),
          });
          proj.versions = JSON.stringify(versions);
          proj.updated_at = new Date().toISOString();
          projectsStore.set(projectId, proj);
          await persistProjects();
        }

        return NextResponse.json({ success: true });
      }

      // ─── 生成中文标题 ──────────────────────────────────
      case 'generate-chinese-title': {
        const text = body.text as string;
        const scene = body.scene as string || '海报';
        const style = body.style as string || '现代';
        const brandDna = body.brandDna as Record<string, unknown> | null;

        if (!text) return NextResponse.json({ error: '请输入标题文字' }, { status: 400 });

        const prompt = buildChineseTitlePrompt(text, scene, style, brandDna);
        const result = await generateImageWithPoll(prompt, imageModel, { size: '1536x1024' });

        if (!result.success) {
          return NextResponse.json({ error: result.error || '标题图生成失败' }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          result: {
            imageUrl: result.imageUrl,
            text,
            scene,
            style,
          },
        });
      }

      default:
        return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[brand-factory] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
