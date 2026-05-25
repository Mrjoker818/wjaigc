import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, getPublicModels, getPublicApiProviders } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { registerTask, updateTaskProgress, isTaskCancelled } from '@/lib/task-registry';

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

      // Start async processing
      processRefine(taskId, {
        imageUrl,
        prompt,
        model: selectedModel,
        provider,
        aspectRatio: aspectRatio || '1:1',
      }).catch((err: Error) => {
        updateTaskProgress(taskId, { status: 'failed', error: err.message });
      });

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
) {
  updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '构建精修提示词...' });

  const compatProfile = resolveCompatProfile(params.provider);

  updateTaskProgress(taskId, { progress: 30, label: '调用AI模型生成...' });

  // Build request body
  const rawBody: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: 1,
    size: getAspectSize(params.aspectRatio),
  };

  // If imageUrl is provided, add as reference image for image-to-image
  if (params.imageUrl) {
    rawBody.image = params.imageUrl;
    rawBody.strength = 0.7;
  }

  const { body: apiBody, endpoint: apiEndpoint } = adjustRequestForProfile(rawBody, compatProfile, { hasImage: !!params.imageUrl });
  const path = apiEndpoint || '/images/generations';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${params.provider.apiKey}`,
  };

  try {
    const response = await fetchWithV1Retry(params.provider.baseUrl, path, {
      method: 'POST',
      headers,
      body: JSON.stringify(apiBody),
    }, true, 120000);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`API错误 (${response.status}): ${errText.slice(0, 200)}`);
    }

    updateTaskProgress(taskId, { progress: 70, label: '解析生成结果...' });

    const result = await response.json();
    const parsed = parseResponseForProfile(result, compatProfile);

    if (parsed.directImageUrls && parsed.directImageUrls.length > 0) {
      updateTaskProgress(taskId, {
        status: 'completed',
        progress: 100,
        label: '精修完成',
        result: { directImageUrls: parsed.directImageUrls },
      });
    } else if (parsed.taskIds && parsed.taskIds.length > 0) {
      // Poll for async result
      updateTaskProgress(taskId, { progress: 50, label: '等待模型生成...' });
      const pollResult = await pollForResult(parsed.taskIds[0], params.provider.baseUrl, params.provider.apiKey, compatProfile);
      updateTaskProgress(taskId, {
        status: 'completed',
        progress: 100,
        label: '精修完成',
        result: { directImageUrls: [pollResult] },
      });
    } else {
      throw new Error('模型未返回图片结果');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    updateTaskProgress(taskId, { status: 'failed', error: message });
  }
}

async function pollForResult(
  taskId: string,
  baseUrl: string,
  apiKey: string,
  profile: ReturnType<typeof resolveCompatProfile>
): Promise<string> {
  const maxAttempts = 60;
  const interval = 3000;
  for (let i = 0; i < maxAttempts; i++) {
    if (isTaskCancelled(taskId)) throw new Error('任务已取消');
    await new Promise(r => setTimeout(r, interval));
    try {
      const pollUrl = `${baseUrl}/tasks/${taskId}`;
      const resp = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
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
