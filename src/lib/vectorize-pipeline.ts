/**
 * 统一矢量化管线 — 位图→SVG 的多引擎降级链
 * 
 * 管线策略（按优先级）：
 * 1. Recraft Vectorize API — 专业矢量模型，语义分组可编辑SVG，质量最高
 * 2. vtracer — 传统描摹引擎（spline 彩色 / potrace 黑白），稳定可靠
 * 3. VLM 视觉模型 — AI "看图重绘" SVG，适合简单图形/图标
 * 
 * 每个引擎有独立的适配器文件：
 * - vectorize-recraft.ts — Recraft API 适配
 * - vectorize-vlm.ts — VLM 视觉模型适配
 * - vectorize-analyzer.ts — 图像预分析
 */
import { recraftVectorize, findRecraftProvider, type RecraftVectorizeResult } from './vectorize-recraft';
import { vlmVectorize, findVlmProvider, type VlmVectorizeResult } from './vectorize-vlm';
import { analyzeFromMetadata, analyzeWithSharp, type ImageAnalysis } from './vectorize-analyzer';

/** 矢量化引擎类型 */
export type VectorizeEngine = 'recraft' | 'vtracer' | 'vtracer-bw' | 'vlm';

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
  const [recraftProvider, vlmProvider] = await Promise.all([
    findRecraftProvider().catch(() => null),
    findVlmProvider().catch(() => null),
  ]);

  return {
    recraft: !!recraftProvider,
    vtracer: true, // vtracer 始终可用（内置）
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

  const avail = availability || { recraft: true, vtracer: true, 'vtracer-bw': true, vlm: true };

  // 黑白模式：优先 potrace
  if (mode === 'bw' || mode === 'cutting' || mode === 'engraving' || mode === 'lineart') {
    const chain: VectorizeEngine[] = ['vtracer-bw'];
    if (avail.recraft) chain.push('recraft');
    return chain;
  }

  // 彩色模式 / 自动模式
  const chain: VectorizeEngine[] = [];
  if (avail.recraft) chain.push('recraft');
  chain.push('vtracer');
  if (avail.vlm) chain.push('vlm');
  
  // 至少保证一个引擎
  if (chain.length === 0) {
    chain.push('vtracer');
  }

  return chain;
}

/**
 * 执行 vtracer 矢量化（调用 /api/svg-trace 的核心逻辑复用）
 * 注意：vtracer 的实际执行在 svg-trace route 中，
 * 这里作为一个标识告诉上层使用 vtracer 引擎
 */
export function isVtracerEngine(engine: VectorizeEngine): boolean {
  return engine === 'vtracer' || engine === 'vtracer-bw';
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
      const result = await vlmVectorize({
        imageUrl,
        imageDataUrl,
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
