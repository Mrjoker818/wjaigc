/**
 * 统一矢量化管线 — 位图→SVG 的多引擎降级链
 * 
 * 管线策略（按优先级）：
 * 1. Recraft Vectorize API — 专业矢量模型，语义分组可编辑SVG，质量最高
 * 2. Vectorize.AI API — 专业矢量化服务（302AI 代理），贝塞尔曲线精确还原
 * 3. VLM 视觉模型 — AI "看图重绘" SVG，适合简单图形/图标
 * 4. WASM VTracer — 浏览器端 WebAssembly 本地转换，零服务器压力
 * 5. Python vtracer — 传统后端描摹引擎（spline 彩色 / potrace 黑白）
 * 
 * 每个引擎有独立的适配器文件：
 * - vectorize-recraft.ts — Recraft API 适配
 * - vectorize-vlm.ts — VLM 视觉模型适配
 * - vectorize-analyzer.ts — 图像预分析
 */
import { recraftVectorize, findRecraftProvider, type RecraftVectorizeResult } from './vectorize-recraft';
import { vlmVectorize, findVlmProvider, type VlmVectorizeResult } from './vectorize-vlm';
import { analyzeFromMetadata, analyzeWithSharp, type ImageAnalysis } from './vectorize-analyzer';

/**
 * 查找管理员配置的 vectorize 类型提供商（如 302AI Vectorizer.AI 代理）
 * 优先级高于 VLM，因为专业矢量模型质量更高
 */
export async function findVectorizeApiProvider(): Promise<{
  baseUrl: string;
  apiKey: string;
  model: string;
} | null> {
  try {
    const { getApiProviders } = await import('./server-api-config');
    const providers = await getApiProviders();
    const vectorizeProvider = providers.find(
      (p) =>
        p.type === 'vectorize' && p.isEnabled !== false,
    );
    if (!vectorizeProvider) return null;

    const baseUrl = (vectorizeProvider.baseUrl || '').replace(/\/+$/, '');
    const apiKey = vectorizeProvider.apiKey || '';
    const model = Array.isArray(vectorizeProvider.selectedModels)
      ? String(vectorizeProvider.selectedModels[0] || '')
      : String(vectorizeProvider.selectedModel || '');

    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey, model };
  } catch {
    return null;
  }
}

/**
 * 调用 Vectorizer.AI 风格的 API（如 302AI 代理）
 * POST /vectorizer/api/v1/vectorize — multipart form-data
 */
async function vectorizeApiCall(
  provider: { baseUrl: string; apiKey: string; model: string },
  imageBuffer: Buffer,
  imageUrl: string,
): Promise<{ success: boolean; svg?: string; error?: string; pathCount?: number; svgSize?: number }> {
  const { baseUrl, apiKey, model } = provider;
  const mime = detectImageMimeFromBuffer(imageBuffer);

  // Build multipart form-data
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const parts: Buffer[] = [];

  const imageHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="image.${mime.split('/')[1]}"\r\nContent-Type: ${mime}\r\n\r\n`
  );
  parts.push(imageHeader);
  parts.push(imageBuffer);
  parts.push(Buffer.from('\r\n'));

  if (model) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
    ));
  }

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="output.type"\r\n\r\nsvg\r\n`
  ));
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  // Try different path patterns for Vectorizer.AI compatible endpoints
  const baseUrlWithoutV1 = baseUrl.replace(/\/v1\/?$/, '');
  const pathsToTry = [
    `${baseUrlWithoutV1}/vectorizer/api/v1/vectorize`,  // 302AI proxy style
    `${baseUrl}/api/v1/vectorize`,                        // Vectorizer.AI native
    `${baseUrl}/vectorize`,                                // Standard
    `${baseUrl}/v1/vectorize`,                             // With /v1 prefix
  ];

  for (const url of pathsToTry) {
    try {
      console.log(`[vectorize-api] Trying: ${url}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(120000),
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        let svgContent: string;

        if (contentType.includes('image/svg') || contentType.includes('text/xml') || contentType.includes('text/plain')) {
          svgContent = await response.text();
        } else {
          const data = await response.json() as Record<string, unknown>;
          if (data.svg) {
            svgContent = String(data.svg);
          } else if (data.data) {
            const dataList = data.data as Array<Record<string, string>>;
            if (dataList[0]?.b64_json) {
              svgContent = Buffer.from(String(dataList[0].b64_json), 'base64').toString('utf-8');
            } else if (dataList[0]?.url) {
              const svgResp = await fetch(String(dataList[0].url), { signal: AbortSignal.timeout(15000) });
              svgContent = await svgResp.text();
            } else {
              continue;
            }
          } else {
            continue;
          }
        }

        if (svgContent.includes('<svg')) {
          const pathCount = (svgContent.match(/<path\b/gi) || []).length;
          return {
            success: true,
            svg: svgContent,
            pathCount,
            svgSize: Buffer.byteLength(svgContent, 'utf-8'),
          };
        }
        console.warn('[vectorize-api] Response did not contain <svg>');
      } else {
        const errText = await response.text().catch(() => '');
        console.warn(`[vectorize-api] Non-OK: ${url} ${response.status}`, errText.substring(0, 200));
      }
    } catch (e) {
      console.warn(`[vectorize-api] Failed: ${url}`, e instanceof Error ? e.message : String(e));
    }
  }

  return { success: false, error: 'All Vectorizer.AI endpoint paths failed' };
}

/** 从 buffer 头部检测图片 MIME 类型 */
function detectImageMimeFromBuffer(buffer: Buffer): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[4] === 0x57 && buffer[5] === 0x45) return 'image/webp';
  return 'image/png';
}

/** 矢量化引擎类型 */
export type VectorizeEngine = 'recraft' | 'vectorize-api' | 'vlm' | 'wasm-vtracer' | 'vtracer' | 'vtracer-bw';

/** 矢量化模式 */
export type VectorizeMode = 'color' | 'bw' | 'cutting' | 'engraving' | 'lineart' | 'auto';

/** 矢量化质量预设 */
export type VectorizeQuality = 'fast' | 'balanced' | 'high' | 'ultra';

export interface VectorizePipelineOptions {
  /** 图片 URL */
  imageUrl: string;
  /** 图片 buffer（用于 sharp 分析） */
  imageBuffer?: Buffer;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
  /** 矢量化模式 */
  mode?: VectorizeMode;
  /** 质量预设 */
  quality?: VectorizeQuality;
  /** 强制指定引擎（跳过自动分析） */
  engine?: VectorizeEngine;
  /** 自定义 VLM 提示词 */
  customPrompt?: string;
  /** 图片 base64 data URL（VLM 使用） */
  imageDataUrl?: string;
  /** 进度回调 */
  onProgress?: (engine: VectorizeEngine, status: string) => void;
}

export interface VectorizePipelineResult {
  success: boolean;
  svg?: string;
  /** 使用的引擎 */
  engine: VectorizeEngine;
  /** 引擎列表（尝试过的） */
  enginesTried: VectorizeEngine[];
  /** 图像分析结果 */
  analysis?: ImageAnalysis;
  /** Recraft 结果 */
  recraftResult?: RecraftVectorizeResult;
  /** VLM 结果 */
  vlmResult?: VlmVectorizeResult;
  /** vtracer 结果 */
  vtracerResult?: { svg: string; engine: string };
  /** 错误信息 */
  error?: string;
  /** SVG 路径数量 */
  pathCount?: number;
  /** SVG 文件大小 */
  svgSize?: number;
}

/**
 * 检查各引擎的可用性
 */
export async function checkEngineAvailability(): Promise<Record<VectorizeEngine, boolean>> {
  const [recraftProvider, vlmProvider, vectorizeApiProvider] = await Promise.all([
    findRecraftProvider().catch(() => null),
    findVlmProvider().catch(() => null),
    findVectorizeApiProvider().catch(() => null),
  ]);

  return {
    recraft: !!recraftProvider,
    'vectorize-api': !!vectorizeApiProvider,
    'wasm-vtracer': true, // WASM vtracer 始终可用（内置，无需 Python）
    vtracer: true, // Python vtracer 始终可用（内置）
    'vtracer-bw': true, // potrace 始终可用（内置）
    vlm: !!vlmProvider,
  };
}

/**
 * 根据模式和可用性生成引擎降级链
 */
function buildEngineChain(
  mode: VectorizeMode,
  forcedEngine?: VectorizeEngine,
  availability?: Record<VectorizeEngine, boolean>,
): VectorizeEngine[] {
  // 如果强制指定引擎，直接返回
  if (forcedEngine) {
    return [forcedEngine];
  }

  const avail = availability || { recraft: true, 'vectorize-api': true, 'wasm-vtracer': true, vtracer: true, 'vtracer-bw': true, vlm: true };

  // 黑白模式：优先 potrace
  if (mode === 'bw' || mode === 'cutting' || mode === 'engraving' || mode === 'lineart') {
    const chain: VectorizeEngine[] = ['vtracer-bw'];
    if (avail.recraft) chain.push('recraft');
    return chain;
  }

  // 彩色模式 / 自动模式
  const chain: VectorizeEngine[] = [];
  if (avail.recraft) chain.push('recraft');
  if (avail['vectorize-api']) chain.push('vectorize-api');
  if (avail.vlm) chain.push('vlm');
  chain.push('wasm-vtracer');
  chain.push('vtracer');
  
  // 至少保证一个引擎
  if (chain.length === 0) {
    chain.push('wasm-vtracer');
  }

  return chain;
}

/**
 * 执行 vtracer 矢量化（调用 /api/svg-trace 的核心逻辑复用）
 * 注意：vtracer 的实际执行在 svg-trace route 中，
 * 这里作为一个标识告诉上层使用 vtracer 引擎
 */
export function isVtracerEngine(engine: VectorizeEngine): boolean {
  return engine === 'vtracer' || engine === 'vtracer-bw' || engine === 'wasm-vtracer';
}

/**
 * 统一矢量化管线 — 主入口
 * 
 * 按降级链依次尝试各引擎，返回第一个成功的结果
 */
export async function vectorizePipeline(
  options: VectorizePipelineOptions,
): Promise<VectorizePipelineResult> {
  const {
    imageUrl,
    imageBuffer,
    width,
    height,
    mode = 'color',
    quality = 'balanced',
    engine: forcedEngine,
    customPrompt,
    imageDataUrl,
    onProgress,
  } = options;

  // 1. 检查引擎可用性
  const availability = await checkEngineAvailability();

  // 2. 构建引擎降级链
  const engineChain = buildEngineChain(mode, forcedEngine, availability);

  // 3. 图像预分析（仅在有 buffer 时）
  let analysis: ImageAnalysis | undefined;
  if (imageBuffer && width && height) {
    try {
      analysis = await analyzeWithSharp(imageBuffer, width, height);
    } catch {
      // 分析失败不影响主流程
      analysis = undefined;
    }
  } else {
    // 使用元数据快速分析
    const metaAnalysis = analyzeFromMetadata(width || 0, height || 0, mode, customPrompt);
    analysis = {
      width: width || 0,
      height: height || 0,
      uniqueColors: 0,
      hasGradient: false,
      isLineArt: mode === 'bw' || mode === 'lineart',
      isSimpleGraphic: false,
      isCartoon: false,
      recommendedEngines: metaAnalysis.recommendedEngines,
      recommendationReason: metaAnalysis.recommendationReason,
    };
  }

  // 4. 依次尝试引擎
  const enginesTried: VectorizeEngine[] = [];
  const errors: string[] = [];

  for (const engine of engineChain) {
    enginesTried.push(engine);
    onProgress?.(engine, `正在使用 ${engine} 引擎矢量化...`);

    // vtracer 引擎不在管线中直接执行，而是由调用方（svg-trace route）处理
    // 这里只处理 recraft 和 vlm
    if (engine === 'vtracer' || engine === 'vtracer-bw') {
      // vtracer 由 svg-trace route 直接执行，管线不重复处理
      // 如果到达这里说明 recraft 和 vlm 都失败了，需要回退到 vtracer
      onProgress?.(engine, '回退到 vtracer 传统描摹引擎');
      return {
        success: true, // 标记为成功，由上层路由执行 vtracer
        engine,
        enginesTried,
        analysis,
        error: errors.length > 0 ? errors.join('; ') : undefined,
      };
    }

    if (engine === 'recraft') {
      onProgress?.(engine, '正在调用 Recraft 矢量模型...');
      const result = await recraftVectorize({
        imageUrl,
        imageBuffer,
      });

      if (result.success && result.svg) {
        onProgress?.(engine, 'Recraft 矢量化成功');
        return {
          success: true,
          svg: result.svg,
          engine: 'recraft',
          enginesTried,
          analysis,
          recraftResult: result,
          pathCount: result.pathCount,
          svgSize: result.svgSize,
        };
      }

      errors.push(`Recraft: ${result.error}`);
      onProgress?.(engine, `Recraft 失败: ${result.error}`);
      continue;
    }

    if (engine === 'vlm') {
      onProgress?.(engine, '正在调用 VLM 视觉模型...');
      // 确保 VLM 收到 base64 data URL（外部 API 无法访问本地路径）
      let vlmImageDataUrl = imageDataUrl;
      if (!vlmImageDataUrl && imageBuffer) {
        // 预缩小图片：VLM 不需要原始分辨率，缩小到 768px 以内可大幅减少传输量和超时风险
        let finalBuffer = imageBuffer;
        try {
          const sharp = (await import('sharp')).default;
          const metadata = await sharp(imageBuffer).metadata();
          const maxDim = 768;
          if ((metadata.width || 0) > maxDim || (metadata.height || 0) > maxDim) {
            finalBuffer = await sharp(imageBuffer)
              .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toBuffer();
            console.log(`[vectorize-pipeline] VLM: resized image from ${metadata.width}x${metadata.height} to ≤${maxDim}px`);
          }
        } catch (resizeErr) {
          console.warn('[vectorize-pipeline] VLM: pre-resize failed, using original:', resizeErr);
        }
        const mime = finalBuffer === imageBuffer ? detectImageMimeFromBuffer(imageBuffer) : 'image/jpeg';
        vlmImageDataUrl = `data:${mime};base64,${finalBuffer.toString('base64')}`;
      }
      const result = await vlmVectorize({
        imageUrl,
        imageDataUrl: vlmImageDataUrl,
        customPrompt,
        maxRetries: 1,
      });

      if (result.success && result.svg) {
        onProgress?.(engine, `VLM 矢量化成功 (模型: ${result.model})`);
        return {
          success: true,
          svg: result.svg,
          engine: 'vlm',
          enginesTried,
          analysis,
          vlmResult: result,
          pathCount: result.pathCount,
          svgSize: result.svgSize,
        };
      }

      errors.push(`VLM: ${result.error}`);
      onProgress?.(engine, `VLM 失败: ${result.error}`);
      continue;
    }

    if (engine === 'vectorize-api') {
      onProgress?.(engine, '正在调用 Vectorizer.AI 风格 API...');
      const vectorizeApiProvider = await findVectorizeApiProvider();
      if (!vectorizeApiProvider || !imageBuffer) {
        errors.push('vectorize-api: 无可用提供商或无图片数据');
        continue;
      }

      const result = await vectorizeApiCall(vectorizeApiProvider, imageBuffer, imageUrl);
      if (result.success && result.svg) {
        onProgress?.(engine, 'Vectorizer.API 矢量化成功');
        return {
          success: true,
          svg: result.svg,
          engine: 'vectorize-api',
          enginesTried,
          analysis,
          pathCount: result.pathCount,
          svgSize: result.svgSize,
        };
      }

      errors.push(`vectorize-api: ${result.error}`);
      onProgress?.(engine, `Vectorizer.API 失败: ${result.error}`);
      continue;
    }
  }

  // 所有引擎都失败
  return {
    success: false,
    engine: engineChain[engineChain.length - 1] || 'vtracer',
    enginesTried,
    analysis,
    error: `所有矢量化引擎均失败: ${errors.join('; ')}`,
  };
}
