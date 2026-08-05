import { NextRequest, NextResponse } from 'next/server';
import { findProviderById } from '@/lib/server-api-config';
import { buildDisplay3DDecomposePrompt } from '@/lib/display3d-prompts';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { validateApiInputs } from '@/lib/api-validator';
import sharp from 'sharp';

type JsonRecord = Record<string, unknown>;

interface DecompositionResult {
  components: Array<{
    id: string;
    index: number;
    name: string;
    sizeSuggestion: string;
    material: string;
    craft: string;
  }>;
  materials: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  bom: Array<{
    id: string;
    name: string;
    count: number;
    estimatedPrice: string;
  }>;
  floorPlanZones: Array<{
    name: string;
    description: string;
  }>;
  notes: string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractBalancedJson(source: string): string | null {
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidates = fenced ? [fenced[1], source] : [source];

  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    if (start < 0) continue;

    let depth = 0;
    let quote = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
      const char = candidate[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quote = false;
        continue;
      }
      if (char === '"') quote = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return candidate.slice(start, index + 1);
      }
    }
  }
  return null;
}

function normalizeDecomposition(value: unknown): DecompositionResult | null {
  if (!isRecord(value)) return null;
  const requiredFields = ['components', 'materials', 'bom', 'floorPlanZones', 'notes'] as const;
  if (!requiredFields.every(key => Array.isArray(value[key]))) return null;

  const components = Array.isArray(value.components)
    ? value.components.flatMap((item, index) => {
        if (!isRecord(item)) return [];
        const name = readString(item.name);
        if (!name) return [];
        const requestedIndex = Number(item.index);
        return [{
          id: readString(item.id) || `component-${index + 1}`,
          index: Number.isFinite(requestedIndex) && requestedIndex > 0 ? Math.floor(requestedIndex) : index + 1,
          name,
          sizeSuggestion: readString(item.sizeSuggestion),
          material: readString(item.material),
          craft: readString(item.craft),
        }];
      })
    : [];

  const materials = Array.isArray(value.materials)
    ? value.materials.flatMap((item, index) => {
        if (!isRecord(item)) return [];
        const name = readString(item.name);
        if (!name) return [];
        return [{
          id: readString(item.id) || `material-${index + 1}`,
          name,
          description: readString(item.description),
        }];
      })
    : [];

  const bom = Array.isArray(value.bom)
    ? value.bom.flatMap((item, index) => {
        if (!isRecord(item)) return [];
        const name = readString(item.name);
        if (!name) return [];
        const numericCount = Number(item.count);
        return [{
          id: readString(item.id) || `bom-${index + 1}`,
          name,
          count: Number.isFinite(numericCount) && numericCount > 0 ? Math.floor(numericCount) : 1,
          estimatedPrice: String(item.estimatedPrice ?? '').trim(),
        }];
      })
    : [];

  const floorPlanZones = Array.isArray(value.floorPlanZones)
    ? value.floorPlanZones.flatMap(item => {
        if (!isRecord(item)) return [];
        const name = readString(item.name);
        if (!name) return [];
        return [{ name, description: readString(item.description) }];
      })
    : [];

  const notes = Array.isArray(value.notes)
    ? value.notes.map(readString).filter(Boolean)
    : [];

  return { components, materials, bom, floorPlanZones, notes };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const validationError = validateApiInputs(body, { imageUrl: 'optionalImageUrl' });
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const { brandName = '', sceneType = 'pop_up_store', dimensions, imageUrl, model, providerId } = body as JsonRecord;
    if (!imageUrl && !brandName) {
      return NextResponse.json({ error: '请提供效果图或品牌名称' }, { status: 400 });
    }
    if (typeof providerId !== 'string' || !providerId.trim() || typeof model !== 'string' || !model.trim()) {
      return NextResponse.json({ error: '请选择已授权的聊天模型后再进行拆解' }, { status: 400 });
    }

    const provider = await findProviderById(providerId);
    const supportsChat = provider?.modelType === 'chat' || provider?.modelType === 'universal' || provider?.modelType === 'general';
    if (!provider || !supportsChat || !provider.isEnabled || !provider.apiKey) {
      return NextResponse.json({ error: '所选聊天模型提供商不可用或未配置凭证' }, { status: 403 });
    }
    if (!provider.selectedModels?.includes(model)) {
      return NextResponse.json({ error: '所选模型未获得该提供商授权' }, { status: 403 });
    }

    const prompt = buildDisplay3DDecomposePrompt({
      brandName: readString(brandName),
      sceneType: readString(sceneType),
      dimensions: isRecord(dimensions)
        ? {
            length: Number(dimensions.length) || 9000,
            width: Number(dimensions.width) || 6000,
            height: Number(dimensions.height) || 4500,
            unit: 'mm',
          }
        : { length: 9000, width: 6000, height: 4500, unit: 'mm' },
    });
    const { apiModelName: selectedModel } = normalizeModelForApi(model, {
      providerModels: provider.selectedModels,
    });

    const sessionUser = await getSessionUser(request).catch(() => null);
    const taskId = `d3d_dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'display3d-decompose', `3D展陈拆解: ${readString(brandName)}`, sessionUser?.id);

    void (async (): Promise<void> => {
      try {
        updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '正在拆解方案...' });

        // Composite transparent PNG onto white background so the vision model
        // sees the actual subject instead of a checkerboard pattern.
        let processedImageUrl = typeof imageUrl === 'string' && imageUrl ? imageUrl : '';
        if (processedImageUrl) {
          try {
            let imgBuffer: Buffer | null = null;
            if (processedImageUrl.startsWith('data:')) {
              const commaIdx = processedImageUrl.indexOf(',');
              if (commaIdx > 0) {
                imgBuffer = Buffer.from(processedImageUrl.slice(commaIdx + 1), 'base64');
              }
            } else if (processedImageUrl.startsWith('http')) {
              const imgResp = await fetch(processedImageUrl, { signal: AbortSignal.timeout(15000) });
              if (imgResp.ok) {
                imgBuffer = Buffer.from(await imgResp.arrayBuffer());
              }
            }
            if (imgBuffer) {
              const meta = await sharp(imgBuffer).metadata();
              if (meta.hasAlpha) {
                const composited = await sharp(imgBuffer)
                  .flatten({ background: '#ffffff' })
                  .png()
                  .toBuffer();
                processedImageUrl = `data:image/png;base64,${composited.toString('base64')}`;
                console.log(`[display-3d/decompose] Flattened transparent image (${meta.width}x${meta.height}) onto white background`);
              }
            }
          } catch (imgErr) {
            console.warn('[display-3d/decompose] Image preprocessing failed, using original:', imgErr instanceof Error ? imgErr.message : imgErr);
          }
        }

        const messages: Array<{ role: string; content: unknown }> = [{
          role: 'user',
          content: processedImageUrl
            ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: processedImageUrl } }]
            : prompt,
        }];
        let apiBase = provider.baseUrl.replace(/\/+$/, '');
        if (apiBase.endsWith('/v1')) apiBase = apiBase.slice(0, -3);

        const response = await fetchWithV1Retry(apiBase, '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
          body: JSON.stringify({ model: selectedModel, messages, max_tokens: 4096, stream: false }),
        });
        if (!response.ok) {
          const errText = await response.text();
          console.error(`[display-3d/decompose] API error: ${response.status}`, errText.substring(0, 500));
          updateTaskProgress(taskId, { status: 'failed', error: `API错误: ${response.status} ${errText.substring(0, 200)}` });
          return;
        }

        const responseText = await response.text();
        let apiResponse: { choices?: Array<{ message?: { content?: unknown } }> };
        try {
          apiResponse = JSON.parse(responseText);
        } catch {
          console.error(`[display-3d/decompose] Non-JSON response (first 200 chars):`, responseText.substring(0, 200));
          updateTaskProgress(taskId, { status: 'failed', error: `API 返回非 JSON 格式: ${responseText.substring(0, 100)}` });
          return;
        }
        const content = readString(apiResponse.choices?.[0]?.message?.content);
        const jsonText = extractBalancedJson(content);
        if (!jsonText) {
          updateTaskProgress(taskId, { status: 'failed', error: '分析模型未返回有效的 JSON 拆解结果' });
          return;
        }

        let decomposition: DecompositionResult | null = null;
        try {
          decomposition = normalizeDecomposition(JSON.parse(jsonText));
        } catch {
          decomposition = null;
        }
        if (!decomposition) {
          updateTaskProgress(taskId, { status: 'failed', error: '拆解结果不符合结构化数据契约' });
          return;
        }

        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          result: { decomposition, rawAnalysis: content, type: 'display3d-decompose' },
        });
      } catch (error) {
        updateTaskProgress(taskId, { status: 'failed', error: error instanceof Error ? error.message : '拆解失败' });
      }
    })();

    return NextResponse.json({ success: true, taskId, status: 'running' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '服务器错误' }, { status: 500 });
  }
}
