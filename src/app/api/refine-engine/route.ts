import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel, findProviderById, getPublicModels, getPublicApiProviders } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';
import { calculateActualPixelsFromRatio } from '@/app/api/generate/route';
import { fetchWithV1Retry, getInternalApiUrl } from '@/lib/api-helpers';
import { translateApiError } from '@/lib/api-error-translate';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits } from '@/lib/credits';
import { identifyImageSubject } from '@/lib/identify-subject';

// ─── Persist result image to local server ───
async function persistResultImage(imageUrl: string): Promise<string> {
  try {
    if (imageUrl.startsWith('/api/serve-upload/') || imageUrl.startsWith('/uploads/')) {
      return imageUrl;
    }
    if (imageUrl.startsWith('data:')) {
      const resp = await fetch(getInternalApiUrl('/api/save-image'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.url) return data.url;
      }
      return imageUrl;
    }
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
      if (imgResp.ok) {
        const contentType = imgResp.headers.get('content-type') || 'image/png';
        const buffer = Buffer.from(await imgResp.arrayBuffer());
        const base64 = `data:${contentType};base64,${buffer.toString('base64')}`;
        const resp = await fetch(getInternalApiUrl('/api/save-image'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: base64 }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.url) return data.url;
        }
      }
      return imageUrl;
    }
    return imageUrl;
  } catch (err) {
    console.warn('[refine-engine] Failed to persist result image:', err);
    return imageUrl;
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

// 定期清理过期结果 + 上限保护
const MAX_REFINE_RESULTS = 200;
const REFINE_RESULT_TTL = 30 * 60 * 1000; // 30分钟
if (typeof setInterval !== 'undefined') {
  const refineCleanupTimer = setInterval(() => {
    const store = getGlobalRefineResults();
    const now = Date.now();
    for (const [id, r] of store) {
      if (now - r.completedAt > REFINE_RESULT_TTL) {
        store.delete(id);
      }
    }
    // 超上限时淘汰最老
    if (store.size > MAX_REFINE_RESULTS) {
      const entries = Array.from(store.entries())
        .sort((a, b) => a[1].completedAt - b[1].completedAt);
      const excess = store.size - MAX_REFINE_RESULTS;
      for (let i = 0; i < excess; i++) {
        store.delete(entries[i][0]);
      }
    }
  }, 5 * 60 * 1000);
  if (refineCleanupTimer && typeof refineCleanupTimer === 'object' && 'unref' in refineCleanupTimer) {
    refineCleanupTimer.unref();
  }
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

// ─── Angle to description converter ───
// Converts azimuth/elevation into concise photography language matching VIEW_ANGLES style
// AI image models respond best to authoritative, concise camera direction statements
function angleToViewDescription(azimuth: number, elevation: number): string {
  const a = ((azimuth % 360) + 360) % 360;

  // ── Horizontal: determine 8 cardinal + intercardinal directions ──
  let horizName = '';
  let horizDetail = '';
  if (a < 22.5 || a >= 337.5) {
    horizName = 'front';
    horizDetail = 'facing the viewer directly';
  } else if (a < 67.5) {
    horizName = 'front-right';
    horizDetail = 'facing the viewer, angled slightly to the right, revealing the right side';
  } else if (a < 112.5) {
    horizName = 'right side';
    horizDetail = 'turned to the right, showing the right profile and side depth';
  } else if (a < 157.5) {
    horizName = 'back-right';
    horizDetail = 'turned away, angled slightly to the right, showing the back and right side';
  } else if (a < 202.5) {
    horizName = 'back';
    horizDetail = 'turned away from the viewer, showing the back';
  } else if (a < 247.5) {
    horizName = 'back-left';
    horizDetail = 'turned away, angled slightly to the left, showing the back and left side';
  } else if (a < 292.5) {
    horizName = 'left side';
    horizDetail = 'turned to the left, showing the left profile and side depth';
  } else {
    horizName = 'front-left';
    horizDetail = 'facing the viewer, angled slightly to the left, revealing the left side';
  }

  // ── Vertical: determine camera height ──
  // Use both English and Chinese for maximum AI model comprehension
  let vertName = '';
  let vertDetail = '';
  let vertCn = ''; // Chinese description for models that understand Chinese better
  if (elevation <= 5) {
    vertName = 'eye-level';
    vertDetail = 'camera at subject height, straight-on view, no tilt';
    vertCn = '平视角度，镜头与产品同高';
  } else if (elevation <= 20) {
    vertName = 'slightly elevated';
    vertDetail = 'camera slightly above the product, shooting downward at a gentle angle, can see a bit of the top surface';
    vertCn = '略俯视，镜头略高于产品，微微向下拍摄，可见少许顶面';
  } else if (elevation <= 40) {
    vertName = 'high angle';
    vertDetail = 'camera clearly above the product, shooting downward, top surface of the product is visible';
    vertCn = '俯视角度，镜头高于产品向下拍摄，产品顶面可见';
  } else if (elevation <= 60) {
    vertName = 'steep overhead';
    vertDetail = 'camera well above the product, steep downward angle, top surface is the dominant visible face';
    vertCn = '大俯视角度，镜头在产品上方大幅向下拍摄，顶面为主要可见面';
  } else if (elevation <= 80) {
    vertName = 'near top-down';
    vertDetail = 'camera nearly directly above the product, almost top-down view, mainly seeing the top surface';
    vertCn = '接近正俯视，镜头几乎在产品正上方，主要看到顶面';
  } else {
    vertName = 'bird-eye top-down';
    vertDetail = 'camera directly overhead, fully top-down bird-eye view, only top surface visible';
    vertCn = '正俯视鸟瞰，镜头在正上方，只看到顶面';
  }

  // ── Compose: concise authoritative statement ──
  // Build result with both English and Chinese for maximum AI comprehension
  let result = `${vertName} ${horizName} view, ${horizDetail}, ${vertDetail}`;

  // Add Chinese description — many image models understand Chinese photography terms better
  result += `. ${vertCn}`;

  // Add composition emphasis for specific angle ranges
  if (elevation > 15 && horizName.includes('front')) {
    result += ', top surface and front face both visible / 可同时看到顶面和正面';
  }
  if (horizName.includes('right') && !horizName.includes('back')) {
    result += ', right side depth clearly shown / 右侧面深度清晰可见';
  }
  if (horizName.includes('left') && !horizName.includes('back')) {
    result += ', left side depth clearly shown / 左侧面深度清晰可见';
  }

  // Add a very explicit camera direction instruction that AI models cannot misinterpret
  if (elevation > 5) {
    result += '. IMPORTANT: The camera is ABOVE the product looking DOWN, do NOT generate a low-angle looking-up shot / 重要：镜头在产品上方向下拍摄，不要生成仰视角度';
  }

  return result;
}

// ─── Product Refinement Prompt Generator ───
function generateRefinePrompt(params: {
  productCategory: string;
  productName: string;
  materialType: string;
  reflectIndex: number | undefined;
  lightingPreset: string;
  viewAngle: string;
  customAzimuth?: number;
  customElevation?: number;
  customInstructions: string;
  mode: string;
}): string {
  const categoryKey = params.productCategory || 'default';
  const matInfo = MATERIAL_LIBRARY[categoryKey] || MATERIAL_LIBRARY.default;
  const light = LIGHT_LIBRARY[params.lightingPreset] || LIGHT_LIBRARY.soft_studio;
  // Use custom angle description when dynamic + azimuth/elevation provided
  const view = (params.viewAngle === 'dynamic' && params.customAzimuth !== undefined && params.customElevation !== undefined)
    ? angleToViewDescription(params.customAzimuth, params.customElevation)
    : (VIEW_ANGLES[params.viewAngle] || VIEW_ANGLES.front);
  const material = params.materialType || matInfo.material;
  const reflectIdx = params.reflectIndex ?? matInfo.reflectIndex;

  let prompt = '';

  // For custom 3D angle views, add strong emphasis on camera angle
  const isCustomAngle = params.viewAngle === 'dynamic' && params.customAzimuth !== undefined && params.customElevation !== undefined;
  const viewEmphasis = isCustomAngle
    ? `IMPORTANT: The camera MUST be positioned at this exact angle - do NOT default to a front view. ${view}`
    : view;

  if (params.mode === 'expert') {
    prompt = `Commercial-grade product refinement: ${params.productName || 'Product'}.
${BASE_CONSTRAINTS}

Material Analysis: ${material} (Reflectance: ${reflectIdx}).
Lighting Design: ${light}.
Camera Angle: ${viewEmphasis}.
Render Priorities: ${matInfo.renderFocus}.
${params.customInstructions ? `Custom Directives: ${params.customInstructions}.` : ''}

Output: Pixel-perfect, publication-ready product image with absolute commercial fidelity.`;
  } else {
    prompt = `${params.productName || 'Product'} commercial product photography on pure white background. ${BASE_CONSTRAINTS} Material: ${material}. Reflectance index: ${reflectIdx}. Lighting: ${light}. View: ${viewEmphasis}. ${matInfo.renderFocus}. Absolute sharp details.`;
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
    dynamic: '动态视角',
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
async function getImageProvider(model?: string, providerId?: string): Promise<ApiProvider | null> {
  // providerId 优先匹配
  if (providerId) {
    const p = await findProviderById(providerId);
    if (p) {
      console.log(`[refine-engine] 提供商选择: providerId="${providerId}", 匹配="${p.displayName || p.name}" (id=${p.id}), baseUrl="${p.baseUrl}"`);
      return p;
    }
    console.warn(`[refine-engine] ⚠️ providerId="${providerId}" 未找到匹配的提供商，回退到模型匹配`);
  }
  if (model) {
    const p = await findProviderForModel(model);
    if (p) return p;
  }
  const p = await findProviderForModel('', 'image');
  return p;
}

// ─── Helper: Aspect ratio to size (respects quality/resolution) ───
function getAspectSize(ratio: string, model?: string, quality?: string): string {
  const pixelSize = calculateActualPixelsFromRatio(ratio, quality, model);
  if (pixelSize) return pixelSize;
  // fallback: use 1K as minimum
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

// ─── submitRefineToApi: Submit to API, return direct results or remote taskId ───
// This function ONLY does the initial API call — no polling!
// For async providers (APImart etc.), returns remoteTaskId so /api/poll-task handles it
async function submitRefineToApi(
  taskId: string,
  params: {
    imageUrl: string;
    prompt: string;
    model: string;
    provider: ApiProvider;
    aspectRatio: string;
    quality?: string;
  }
): Promise<{ directImageUrls?: string[]; remoteTaskId?: string }> {
  console.log(`[refine-engine] submitRefineToApi START taskId=${taskId}`);
  updateTaskProgress(taskId, { status: 'processing', progress: 10, label: '构建精修请求...' });

  const compatProfile = resolveProfileForModel(params.model, params.provider);
  const isGeminiImageRoute = compatProfile.id === 'gemini-image';
  updateTaskProgress(taskId, { progress: 20, label: '准备参考图片...' });

  // Build request body
  const rawBody: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: 1,
    size: getAspectSize(params.aspectRatio, params.model, params.quality),
  };

  if (params.quality && params.quality !== 'standard' && params.quality !== 'auto') {
    rawBody.quality = params.quality;
  }

  // ─── Prepare image for API ───
  if (params.imageUrl) {
    let imageAsBase64: string | undefined;

    // 1) Local path → base64
    if (params.imageUrl.startsWith('/api/serve-upload/') || params.imageUrl.startsWith('/uploads/')) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
        const publicDir = path.join(workspacePath, 'public');
        let filePath = '';
        if (params.imageUrl.startsWith('/api/serve-upload/')) {
          // serve-upload 路径：从数据目录读取，而非 public
          const relativePath = params.imageUrl.replace('/api/serve-upload/', '');
          try {
            const { getServerDataRoot } = await import('@/lib/server-data-root');
            const dataRoot = getServerDataRoot();
            const path1 = path.join(dataRoot, 'uploads', relativePath);
            const path2 = path.join(dataRoot, relativePath);
            try { await fs.access(path1); filePath = path1; } catch {
              try { await fs.access(path2); filePath = path2; } catch {
                filePath = path.join(publicDir, relativePath);
              }
            }
          } catch {
            filePath = path.join(publicDir, relativePath);
          }
        } else {
          // 直接路径如 /uploads/xxx.jpg：先尝试 publicDir，再尝试 dataRoot
          const relativePath = params.imageUrl.replace(/^\//, '');
          filePath = path.join(publicDir, relativePath);
          try { await fs.access(filePath); } catch {
            try {
              const { getServerDataRoot } = await import('@/lib/server-data-root');
              const dataRoot = getServerDataRoot();
              const altPath = path.join(dataRoot, relativePath);
              await fs.access(altPath);
              filePath = altPath;
            } catch {
              // 保持 publicDir 路径，后续安全校验会处理
            }
          }
        }
        const resolved = path.resolve(filePath);
        // 安全校验：允许 publicDir 和 dataRoot 两个合法目录
        const { getServerDataRoot } = await import('@/lib/server-data-root');
        const dataRoot = getServerDataRoot();
        if (resolved.startsWith(publicDir) || resolved.startsWith(dataRoot)) {
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
    // 2) HTTP URL → download → base64
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

    // Compress large base64 images
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

    // Provide both fields for maximum compatibility
    if (imageAsBase64) {
      rawBody.image = imageAsBase64;
    }
    if (params.imageUrl.startsWith('http')) {
      rawBody.image_urls = [params.imageUrl];
    } else if (imageAsBase64) {
      // Prefer base64 data URL in image_urls — most providers support it
      // and it avoids issues with relative paths that APIs can't reach
      rawBody.image_urls = [imageAsBase64];
    }

    rawBody.strength = 0.55;
  }

  // Identify image subject via AI vision to anchor identity
  let identifiedSubject = '';
  if (params.imageUrl) {
    updateTaskProgress(taskId, { progress: 25, label: '识别图片主体...' });
    try {
      const subjectResult = await identifyImageSubject(params.imageUrl, 12000);
      if (subjectResult) {
        identifiedSubject = subjectResult.en;
        const subjectZh = subjectResult.zh;
        console.info(`[refine-engine] Identified subject: "${identifiedSubject}" (zh: "${subjectZh}")`);
      }
    } catch (err) {
      console.warn('[refine-engine] Subject identification failed (non-critical):', err);
    }
  }

  // Enhance prompt for image-to-image - concise instruction to avoid confusing the model
  if (params.imageUrl) {
    const subjectHint = identifiedSubject
      ? `The reference image shows a "${identifiedSubject}". `
      : '';
    rawBody.prompt = `[img2img] ${subjectHint}Preserve the exact same subject/product from the reference image — same identity, shape, and proportions. Only apply the requested changes without altering the core subject. ${params.prompt}`;
  }

  const hasImageFlag = !!(rawBody.image || rawBody.image_urls);

  // ★ Gemini 图像模型专用路由：通过 /chat/completions 生图
  // 某些中转站（如4SAPI）的 Gemini 图像模型仅支持 /chat/completions 端点
  if (isGeminiImageRoute) {
    console.info(`[refine-engine] Gemini image route for model="${params.model}", using /chat/completions`);
    const chatRequestBody = buildGeminiChatImageRequest(rawBody);

    updateTaskProgress(taskId, { progress: 40, label: '调用AI模型生成...' });

    const chatController = new AbortController();
    const chatTimeoutId = setTimeout(() => chatController.abort(), 600000);

    try {
      const chatResponse = await fetchWithV1Retry(
        params.provider.baseUrl, '/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${params.provider.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chatRequestBody),
          signal: chatController.signal,
        },
        true, 600000
      );

      clearTimeout(chatTimeoutId);

      if (!chatResponse.ok) {
        const errorText = await chatResponse.text().catch(() => '');
        console.error('[refine-engine] Gemini chat/completions error:', chatResponse.status, errorText);
        let errorMsg = `Gemini API 请求失败 (${chatResponse.status})`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) errorMsg = errorJson.error.message;
        } catch { /* ignore */ }
        throw new Error(errorMsg);
      }

      const chatResponseText = await chatResponse.text();
      let chatResult: Record<string, unknown>;
      try {
        chatResult = JSON.parse(chatResponseText);
      } catch {
        console.error('[refine-engine] Gemini chat returned non-JSON, first 200 chars:', chatResponseText.substring(0, 200));
        throw new Error('Gemini API 返回了非 JSON 响应');
      }

      const extractedImageUrls = parseGeminiChatImageResponse(chatResult);
      if (extractedImageUrls.length > 0) {
        console.info(`[refine-engine] Gemini image route: extracted ${extractedImageUrls.length} images`);
        updateTaskProgress(taskId, { progress: 90, label: '保存精修结果...' });
        const persistedUrls = await Promise.all(extractedImageUrls.map(persistResultImage));
        setRefineResult(taskId, { directImageUrls: persistedUrls, completedAt: Date.now() });
        updateTaskProgress(taskId, {
          status: 'completed',
          progress: 100,
          label: '精修完成',
          result: { directImageUrls: persistedUrls },
        });
        return { directImageUrls: persistedUrls };
      }

      throw new Error('Gemini 图像模型未返回图片结果');
    } finally {
      clearTimeout(chatTimeoutId);
    }
  }

  const { body: apiBody, endpoint: apiEndpoint } = adjustRequestForProfile(rawBody, compatProfile, { hasImage: hasImageFlag });
  const path = apiEndpoint || '/images/generations';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${params.provider.apiKey}`,
  };

  updateTaskProgress(taskId, { progress: 40, label: '调用AI模型生成...' });

  // ★ Call the API — only once! Return direct results or remoteTaskId
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
      if (fallbackBody.image_urls && Array.isArray(fallbackBody.image_urls) && (fallbackBody.image_urls as string[]).length > 0) {
        fallbackBody.prompt = `[IMAGE-TO-IMAGE MODE] You MUST use the provided reference image as the mandatory source/base for generation. Do NOT generate from scratch. ${String(fallbackBody.prompt || '')}`;
      }

      // ★ Use shorter timeout (30s) for /images/generations when /images/edits already failed with channel error
      // If /images/generations also fails or times out, we'll try /chat/completions
      let fallbackResp: Response;
      try {
        fallbackResp = await fetchWithV1Retry(params.provider.baseUrl, '/images/generations', {
          method: 'POST',
          headers,
          body: JSON.stringify(fallbackBody),
        }, true, 30000); // 30s timeout instead of 120s
      } catch (fallbackFetchErr: unknown) {
        // /images/generations timed out → try /chat/completions immediately
        const isTimeout = fallbackFetchErr instanceof Error && (fallbackFetchErr.name === 'AbortError' || /timeout|aborted/i.test(fallbackFetchErr.message));
        if (isTimeout) {
          console.info('[refine-engine] /images/generations timed out, trying /chat/completions fallback...');
          try {
            updateTaskProgress(taskId, { progress: 45, label: '尝试备用通道...' });
            const chatImageUrls = await tryChatCompletionsImageFallback({
              baseUrl: params.provider.baseUrl,
              apiKey: params.provider.apiKey,
              model: rawBody.model as string,
              prompt: String(rawBody.prompt || ''),
              imageBase64: (rawBody.image as string) || undefined,
              imageUrls: (rawBody.image_urls as string[]) || undefined,
              size: rawBody.size as string | undefined,
              originalError: 'images/generations timeout',
              requestIdPrefix: 'refine-engine',
              skipChannelCheck: true,
            });
            if (chatImageUrls && chatImageUrls.length > 0) {
              console.log(`[refine-engine] /chat/completions fallback succeeded (after generations timeout), got ${chatImageUrls.length} images`);
              updateTaskProgress(taskId, { progress: 90, label: '保存精修结果...' });
              const persistedUrls = await Promise.all(chatImageUrls.map(persistResultImage));
              setRefineResult(taskId, { directImageUrls: persistedUrls, completedAt: Date.now() });
              updateTaskProgress(taskId, {
                status: 'completed',
                progress: 100,
                label: '精修完成',
                result: { directImageUrls: persistedUrls },
              });
              return { directImageUrls: persistedUrls };
            }
          } catch (chatFallbackErr) {
            console.warn('[refine-engine] /chat/completions fallback error (after generations timeout):', chatFallbackErr);
          }
          throw new Error(`/images/generations timed out and /chat/completions fallback also failed`);
        }
        throw fallbackFetchErr;
      }

      if (!fallbackResp.ok) {
        const fallbackErrText = await fallbackResp.text().catch(() => '');

        // ★ Third fallback: try /chat/completions (for API proxies that only support models via chat)
        if (isChannelUnavailableError(`${fallbackErrText} ${fallbackResp.status}`)) {
          console.info('[refine-engine] /images/generations also failed with channel error, trying /chat/completions fallback...');
          try {
            updateTaskProgress(taskId, { progress: 45, label: '尝试备用通道...' });
            const chatImageUrls = await tryChatCompletionsImageFallback({
              baseUrl: params.provider.baseUrl,
              apiKey: params.provider.apiKey,
              model: rawBody.model as string,
              prompt: String(rawBody.prompt || ''),
              imageBase64: (rawBody.image as string) || undefined,
              imageUrls: (rawBody.image_urls as string[]) || undefined,
              size: rawBody.size as string | undefined,
              originalError: fallbackErrText,
              requestIdPrefix: 'refine-engine',
              skipChannelCheck: true,
            });
            if (chatImageUrls && chatImageUrls.length > 0) {
              console.log(`[refine-engine] /chat/completions fallback succeeded, got ${chatImageUrls.length} images`);
              updateTaskProgress(taskId, { progress: 90, label: '保存精修结果...' });
              const persistedUrls = await Promise.all(chatImageUrls.map(persistResultImage));
              setRefineResult(taskId, { directImageUrls: persistedUrls, completedAt: Date.now() });
              updateTaskProgress(taskId, {
                status: 'completed',
                progress: 100,
                label: '精修完成',
                result: { directImageUrls: persistedUrls },
              });
              return { directImageUrls: persistedUrls };
            }
          } catch (chatFallbackErr) {
            console.warn('[refine-engine] /chat/completions fallback error:', chatFallbackErr);
          }
          console.warn('[refine-engine] /chat/completions fallback also failed, throwing original error');
        }

        throw new Error(`API错误 (${fallbackResp.status}): ${fallbackErrText.slice(0, 200)}`);
      }

      const fallbackResult = await fallbackResp.json();
      console.log(`[refine-engine] Fallback API response for taskId=${taskId}:`, JSON.stringify(fallbackResult).slice(0, 500));
      return handleApiResponse(fallbackResult, compatProfile, taskId, params);
    }

    throw new Error(`API错误 (${response.status}): ${errText.slice(0, 200)}`);
  }

  const result = await response.json();
  console.log(`[refine-engine] API raw response for taskId=${taskId}:`, JSON.stringify(result).slice(0, 500));
  return handleApiResponse(result, compatProfile, taskId, params);
}

// ─── Handle API response: extract directImageUrls or remoteTaskId ───
async function handleApiResponse(
  result: unknown,
  compatProfile: ReturnType<typeof resolveCompatProfile>,
  taskId: string,
  _params: { imageUrl: string; prompt: string; model: string; provider: ApiProvider; aspectRatio: string; quality?: string }
): Promise<{ directImageUrls?: string[]; remoteTaskId?: string }> {
  const parsed = parseResponseForProfile(result as Record<string, unknown>, compatProfile);
  console.log(`[refine-engine] Parsed response for taskId=${taskId}: directImageUrls=${parsed.directImageUrls?.length || 0}, taskIds=${parsed.taskIds?.length || 0}`);

  // Case 1: API returned images directly (synchronous providers)
  if (parsed.directImageUrls && parsed.directImageUrls.length > 0) {
    updateTaskProgress(taskId, { progress: 90, label: '保存精修结果...' });
    const persistedUrls = await Promise.all(parsed.directImageUrls.map(persistResultImage));
    console.log(`[refine-engine] Persisted ${persistedUrls.length} direct URLs for taskId=${taskId}:`, persistedUrls);
    setRefineResult(taskId, { directImageUrls: persistedUrls, completedAt: Date.now() });
    updateTaskProgress(taskId, {
      status: 'completed',
      progress: 100,
      label: '精修完成',
      result: { directImageUrls: persistedUrls },
    });
    console.log(`[refine-engine] Task ${taskId} completed with direct images`);
    return { directImageUrls: persistedUrls };
  }

  // Case 2: API returned taskIds (async providers like APImart)
  // ★ Don't poll here! Return remoteTaskId so /api/poll-task handles polling
  if (parsed.taskIds && parsed.taskIds.length > 0) {
    const remoteTaskId = parsed.taskIds[0];
    console.log(`[refine-engine] Got async taskIds=${parsed.taskIds}, remoteTaskId=${remoteTaskId} for taskId=${taskId}`);
    // We do NOT update to 'completed' — the task stays 'processing' until /api/poll-task gets the result
    return { remoteTaskId };
  }

  // Case 3: No images or taskIds — unexpected response
  console.error(`[refine-engine] No directImageUrls or taskIds in response for taskId=${taskId}. Raw:`, JSON.stringify(result).slice(0, 300));
  throw new Error('模型未返回图片结果');
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
        customAzimuth,
        customElevation,
        customInstructions,
        mode,
        model,
        aspectRatio,
        providerId,
      } = body;

      if (!imageUrl) {
        return NextResponse.json({ error: '请提供产品图片' }, { status: 400 });
      }

      // 积分检查与扣除
      const sessionUser = await getSessionUser(request).catch(() => null);
      if (sessionUser) {
        const creditResult = await consumeCredits(sessionUser.id, 'image_retouch', undefined, undefined, model);
        if (!creditResult.success) {
          return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
        }
      }

      if (!model) {
        return NextResponse.json({ error: '请选择生图模型' }, { status: 400 });
      }

      const provider = await getImageProvider(model, providerId);
      if (!provider) {
        return NextResponse.json({ error: `未找到模型 ${model} 对应的API提供商${providerId ? ` (providerId: ${providerId})` : ''}` }, { status: 400 });
      }

      const selectedModel = model || provider.selectedModels?.[0];

      const refineMode = (mode === 'expert') ? 'expert' : 'standard';
      const prompt = generateRefinePrompt({
        productCategory: productCategory || 'default',
        productName: productName || '',
        materialType: materialType || '',
        reflectIndex: reflectIndex ?? undefined,
        lightingPreset: lightingPreset || 'soft_studio',
        viewAngle: viewAngle || 'front',
        customAzimuth: typeof customAzimuth === 'number' ? customAzimuth : undefined,
        customElevation: typeof customElevation === 'number' ? customElevation : undefined,
        customInstructions: customInstructions || '',
        mode: refineMode,
      });

      const taskId = `refine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      registerTask(taskId, 'refine-engine', `精修: ${productName || MODE_LABELS[refineMode] || '产品'}`, sessionUser?.id);

      try {
        const apiResult = await submitRefineToApi(taskId, {
          imageUrl: imageUrl,
          prompt,
          model: selectedModel,
          provider,
          aspectRatio: aspectRatio || '1:1',
          quality: body.quality || 'standard',
        });

        if (apiResult.directImageUrls && apiResult.directImageUrls.length > 0) {
          // ★ Synchronous provider: images returned directly
          console.log(`[refine-engine] Direct result for taskId=${taskId}, urls:`, apiResult.directImageUrls.length);
          return NextResponse.json({
            success: true,
            taskId,
            directImageUrls: apiResult.directImageUrls,
          });
        }

        // ★ Async provider (APImart): return taskId + provider info so /api/poll-task handles it
        console.log(`[refine-engine] Async taskId=${taskId}, remoteTaskId=${apiResult.remoteTaskId}, providerId=${provider.id}`);
        // Store provider info in task registry so /api/poll-task can find it
        updateTaskProgress(taskId, {
          status: 'processing',
          progress: 30,
          label: '已提交到API，等待结果...',
          result: {
            apiBaseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            advancedParams: provider.advancedParams || {},
            usedModel: selectedModel,
            providerId: provider.id,
            remoteTaskId: apiResult.remoteTaskId,
          },
        });

        return NextResponse.json({
          success: true,
          taskId,
          providerId: provider.id,
          model: selectedModel,
          engine: 'refine-engine',
        });
      } catch (procErr) {
        const errMsg = procErr instanceof Error ? procErr.message : String(procErr);
        console.error(`[refine-engine] submitRefineToApi FAILED taskId=${taskId}:`, errMsg);
        updateTaskProgress(taskId, { status: 'failed', error: translateApiError(errMsg) });
        return NextResponse.json({
          success: false,
          taskId,
          error: errMsg,
        });
      }
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
