import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { unlink, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { getInternalApiUrl } from '@/lib/api-helpers';
import path from 'path';
import { getServerDataRoot, saveImageFile } from '@/lib/server-data-root';
import { uploadImageToS3, isS3Available } from '@/lib/s3-storage';
import { PYTHON_BIN } from '@/lib/image-tools/config';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits } from '@/lib/credits';
import { optimize as runSvgoOptimize } from 'svgo';
import { vectorizePipeline, type VectorizeEngine, type VectorizeQuality as PipelineQuality } from '@/lib/vectorize-pipeline';
import { analyzeWithSharp } from '@/lib/vectorize-analyzer';

// ─── Types ──────────────────────────────────────────────

type TraceMode = 'color' | 'bw' | 'cutting' | 'engraving' | 'lineart' | 'compress' | 'thumbnail';
type VtracerHierarchical = 'stacked' | 'cutout';
type VtracerCurveMode = 'polygon' | 'spline';
type QualityPreset = 'fast' | 'balanced' | 'high' | 'max' | 'print' | 'print-pro';

interface TraceRequest {
  imageUrl: string;
  mode: TraceMode;
  // Engine selection: auto = pipeline auto-selects, vectorize-api/vtracer/vlm = force specific engine
  engine?: 'auto' | 'vectorize-api' | 'vtracer' | 'vlm' | 'wasm-vtracer';
  // Quality preset (overrides individual params with optimal defaults)
  qualityPreset?: QualityPreset;
  // Color vectorization params (VTracer)
  colorPrecision?: number;       // 2-12, default depends on preset
  filterSpeckle?: number;        // 0-20, default depends on preset
  cornerThreshold?: number;      // 0-10, default 1
  lengthThreshold?: number;      // 3.5-10.0 (WASM constraint), default depends on preset
  spliceThreshold?: number;      // 0-90, default 45
  pathPrecision?: number;        // 1-8, default depends on preset
  hierarchical?: VtracerHierarchical;  // 'stacked' or 'cutout', default depends on preset
  curveMode?: VtracerCurveMode;        // 'polygon' or 'spline', default depends on preset
  layerDifference?: number;      // 1-80, default depends on preset
  maxIterations?: number;        // 1-50, default depends on preset
  // B&W trace params (Potrace)
  threshold?: number;            // 0-100, default 50
  turdSize?: number;             // 1-100, default 2
  alphaMax?: number;             // 0-1.334, default 1
  optCurve?: boolean;            // default true
  optCurveVal?: number;         // 0-5, default 2
  invert?: boolean;              // invert B&W output
  // Compress params
  quality?: number;              // 1-100, default 80
  compressFormat?: 'jpeg' | 'webp' | 'png'; // default webp
  // Force SVG output even if path count exceeds threshold
  forceSvg?: boolean;
  // Thumbnail params
  thumbnailWidth?: number;       // default 200
  thumbnailHeight?: number;      // default 200
  thumbnailFit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'; // default cover
}

// ─── Quality Presets ────────────────────────────────────
// Tuned for best visual output + Illustrator compatibility

interface VtracerParams {
  colorPrecision: number;
  filterSpeckle: number;
  cornerThreshold: number;
  lengthThreshold: number;
  spliceThreshold: number;
  pathPrecision: number;
  hierarchical: VtracerHierarchical;
  curveMode: VtracerCurveMode;
  layerDifference: number;
  maxIterations: number;
}

const QUALITY_PRESETS: Record<QualityPreset, VtracerParams> = {
  // ★ 关键参数说明：Python vtracer 的 color_precision 是【颜色数量】(2-256)，不是位深度！
  // 之前误用6-8的值导致只有6-8种颜色，效果极差。修正后使用实际颜色数。
  // ★ 预设设计原则：
  //   - cornerThreshold 不超过120：180是Photo预设值，会把卡通尖角全部磨圆
  //   - layerDifference 不超过24：48/64太粗会把白色和浅色归入同一层，颜色串层
  //   - filterSpeckle 不超过8：过大会删除小细节（眼睛、文字等）
  fast: {
    colorPrecision: 64,       // 64色: 快速出图，适合简单图形/图标
    filterSpeckle: 4,         // 官方默认
    cornerThreshold: 60,      // 官方默认
    lengthThreshold: 4.0,
    spliceThreshold: 45,
    pathPrecision: 2,
    hierarchical: 'stacked',  // 官方默认: stacked无层间间隙，视觉效果最佳
    curveMode: 'spline',      // 官方默认: 贝塞尔曲线平滑
    layerDifference: 16,      // 官方默认
    maxIterations: 10,        // 官方默认
  },
  balanced: {
    colorPrecision: 128,      // 128色: 适合大多数图片，色彩丰富且路径可控
    filterSpeckle: 4,
    cornerThreshold: 60,
    lengthThreshold: 4.0,
    spliceThreshold: 45,
    pathPrecision: 3,
    hierarchical: 'stacked',
    curveMode: 'spline',
    layerDifference: 16,
    maxIterations: 10,
  },
  high: {
    colorPrecision: 200,      // 200色: 高色彩精度，适合色彩丰富的插画
    filterSpeckle: 6,         // 适度去噪
    cornerThreshold: 90,      // 保留更多角点细节
    lengthThreshold: 4.0,
    spliceThreshold: 45,
    pathPrecision: 4,
    hierarchical: 'stacked',
    curveMode: 'spline',
    layerDifference: 20,      // 适中层区分
    maxIterations: 10,
  },
  max: {
    colorPrecision: 256,      // 256色: 最高色彩精度
    filterSpeckle: 8,         // 适度去噪，不会删除小细节
    cornerThreshold: 120,     // 平滑角点但不至于磨平所有尖角
    lengthThreshold: 4.0,
    spliceThreshold: 45,
    pathPrecision: 3,
    hierarchical: 'stacked',
    curveMode: 'spline',
    layerDifference: 24,      // 适中层区分，避免浅色区域合并
    maxIterations: 12,
  },
  print: {
    colorPrecision: 256,      // 256色: 最高色彩精度
    filterSpeckle: 2,         // 印刷级保留细节
    cornerThreshold: 60,      // 默认精度，保留角落
    lengthThreshold: 3.5,     // 更精细路径 (WASM min=3.5)
    spliceThreshold: 45,
    pathPrecision: 5,         // 高坐标精度
    hierarchical: 'stacked',
    curveMode: 'spline',
    layerDifference: 16,      // 精细层区分
    maxIterations: 12,        // 更多迭代
  },
  // ★ 丹青AI 对标预设: 极致还原，接近丹青AI全彩模式质量
  // 核心差异: 256色最高精度 + 适度去噪 + 中等角点平滑 + 精细层区分
  // 注意：不像VTracer Photo预设那样用cornerThreshold=180/layerDifference=48，
  // 那些参数适用于渐变摄影图，但会严重破坏卡通/插画的清晰边缘和色彩分层
  'print-pro': {
    colorPrecision: 256,      // 256色: 最高色彩精度
    filterSpeckle: 6,         // 适度去噪，保留小细节
    cornerThreshold: 100,     // 中等角点平滑，保留卡通尖角
    lengthThreshold: 3.5,     // 更精细路径 (WASM min=3.5)
    spliceThreshold: 45,      // 官方默认
    pathPrecision: 5,         // 高坐标精度
    hierarchical: 'stacked',  // 官方默认: stacked无层间间隙
    curveMode: 'spline',      // 贝塞尔曲线平滑
    layerDifference: 20,      // 适中层区分，避免白色被归入浅色层
    maxIterations: 15,        // 更多迭代，颜色匹配更精确
  },
};

function resolveVtracerParams(body: TraceRequest): VtracerParams {
  const preset = body.qualityPreset || 'balanced';
  const base = QUALITY_PRESETS[preset];

  // Individual params override preset values when explicitly provided
  return {
    colorPrecision: body.colorPrecision ?? base.colorPrecision,
    filterSpeckle: body.filterSpeckle ?? base.filterSpeckle,
    cornerThreshold: body.cornerThreshold ?? base.cornerThreshold,
    lengthThreshold: Math.max(3.5, Math.min(10.0, body.lengthThreshold ?? base.lengthThreshold)),
    spliceThreshold: body.spliceThreshold ?? base.spliceThreshold,
    pathPrecision: body.pathPrecision ?? base.pathPrecision,
    hierarchical: body.hierarchical ?? base.hierarchical,
    curveMode: body.curveMode ?? base.curveMode,
    layerDifference: body.layerDifference ?? base.layerDifference,
    maxIterations: body.maxIterations ?? base.maxIterations,
  };
}

// ─── Image URL resolution ──────────────────────────────

async function resolveImageUrl(imageUrl: string): Promise<Buffer> {
  // data: URL
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL format');
    return Buffer.from(match[1], 'base64');
  }

  // blob: URL - cannot be resolved server-side
  if (imageUrl.startsWith('blob:')) {
    throw new Error('Blob URLs cannot be resolved server-side. Please save the image first.');
  }

  // Local path
  if (imageUrl.startsWith('/')) {
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    const dataRoot = getServerDataRoot();

    // Try /api/serve-upload/ path → data root uploads
    const serveUploadMatch = imageUrl.match(/^\/api\/serve-upload\/(.+)$/);
    if (serveUploadMatch) {
      const filePath = path.normalize(path.join(dataRoot, serveUploadMatch[1]));
      if (filePath.startsWith(path.normalize(dataRoot)) && existsSync(filePath)) {
        return await readFile(filePath);
      }
    }

    // Try public directory
    const publicPath = path.normalize(path.join(workspacePath, 'public', imageUrl));
    const publicRoot = path.normalize(path.join(workspacePath, 'public'));
    if (publicPath.startsWith(publicRoot) && existsSync(publicPath)) {
      return await readFile(publicPath);
    }

    // Try data root
    const dataPath = path.normalize(path.join(dataRoot, imageUrl.replace(/^\//, '')));
    if (dataPath.startsWith(path.normalize(dataRoot)) && existsSync(dataPath)) {
      return await readFile(dataPath);
    }

    // Fallback: fetch from localhost
    const port = process.env.DEPLOY_RUN_PORT || 5000;
    const response = await fetch(`http://localhost:${port}${imageUrl}`, { signal: AbortSignal.timeout(10000) });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    throw new Error(`Cannot resolve local image: ${imageUrl}`);
  }

  // External URL
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// ─── Sharp Preprocessing ───────────────────────────────
// Optimized pipeline for best VTracer output quality

async function preprocessForVTracer(
  inputBuffer: Buffer,
  params: VtracerParams,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const meta = await sharp(inputBuffer).metadata();
  const srcWidth = meta.width || 512;
  const srcHeight = meta.height || 512;
  const hasAlpha = meta.channels === 4;
  const maxEdge = Math.max(srcWidth, srcHeight);

  // Adaptive max size: high color count presets can handle larger inputs
  const maxSize = params.colorPrecision >= 128 ? 4096 : 3072;

  let pipeline = sharp(inputBuffer);

  // Step 1: Upscale small images for better VTracer output
  // Small images have too few pixels for accurate contour tracing.
  // Upscaling with lanczos3 interpolation gives VTracer more data to work with.
  // Reference: Figma-design preprocessImageForVectorization
  const minEdgeForTrace = 384;
  const upscaleTarget = 768;
  if (maxEdge < minEdgeForTrace) {
    const scale = upscaleTarget / maxEdge;
    const newW = Math.round(srcWidth * scale);
    const newH = Math.round(srcHeight * scale);
    pipeline = pipeline.resize(newW, newH, {
      kernel: 'lanczos3',  // Best quality for upscaling
      fit: 'fill',
    });
  } else if (srcWidth > maxSize || srcHeight > maxSize) {
    // Step 1b: Resize if too large (preserve quality, don't enlarge)
    pipeline = pipeline.resize(maxSize, maxSize, {
      fit: 'inside',
      withoutEnlargement: true,
      kernel: 'lanczos3',  // Best quality downsampling
    });
  }

  // Step 2: Remove alpha channel (VTracer works best with RGB)
  // Composite onto white background to preserve visual appearance
  if (hasAlpha) {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
  }

  // Step 3: 丹青AI级别预处理 — 边缘平滑去锯齿
  // 核心原则：VTracer沿像素边界追踪轮廓，输入边缘越平滑→输出路径越圆滑
  // 策略：使用轻微高斯模糊平滑像素级锯齿，VTracer的spline模式会生成圆滑贝塞尔曲线
  // 注意：不要锐化！锐化会放大像素锯齿→VTracer追踪出锯齿路径
  if (params.colorPrecision >= 200) {
    // ★ 高色数预设：0.8px高斯模糊平滑渐变+锯齿
    pipeline = pipeline.blur(0.8);
  } else if (params.colorPrecision >= 128) {
    // ★ 中等色数预设：0.5px高斯模糊平滑锯齿
    pipeline = pipeline.blur(0.5);
  } else {
    // ★ 低色数预设：中值滤波去椒盐噪，保留锐利边缘
    pipeline = pipeline.median(1);
  }

  // Step 4: 跳过锐化
  // ★ 重要：不使用sharpen！锐化会在像素边界产生振铃伪影，
  //   VTracer追踪这些伪影导致输出路径边缘锯齿感严重。
  //   边缘平滑由Step3的blur/median负责，VTracer内部filter_speckle负责去噪

  // Step 5: Color pre-quantization — only for very low color count presets
  // colorPrecision is now the ACTUAL number of colors (2-256)
  // For presets with >= 64 colors, VTracer handles quantization well internally
  if (params.colorPrecision <= 32) {
    // Very low color count (fast/icon mode): sharp pre-quantize to clean palette
    pipeline = pipeline.png({
      quality: 100,
      compressionLevel: 0,
      palette: true,
      colors: params.colorPrecision,
      effort: 10,
      dither: 0.3,
    });
  } else {
    // 64+ colors: let VTracer handle color decisions — it does better quantization
    pipeline = pipeline.png({ quality: 100, compressionLevel: 0 });
  }

  const buf = await pipeline.toBuffer();
  const outMeta = await sharp(buf).metadata();

  return {
    buffer: buf,
    width: outMeta.width || srcWidth,
    height: outMeta.height || srcHeight,
  };
}

// ─── VTracer (Color Vectorization) via Python ──────────

async function runVTracer(
  inputBuffer: Buffer,
  params: VtracerParams,
): Promise<string> {
  const tmpDir = path.join(getServerDataRoot(), 'svg-trace-tmp');
  if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });

  const uid = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const inputPath = path.join(tmpDir, `input-${uid}.png`);
  const outputPath = path.join(tmpDir, `output-${uid}.svg`);

  try {
    // Ensure input is PNG
    await sharp(inputBuffer).png().toFile(inputPath);

    // Build VTracer Python call with all optimized parameters
    // Ensure all numeric params are integers where VTracer expects them
    const p = {
      cp: Math.round(params.colorPrecision),
      fs: Math.round(params.filterSpeckle),
      ct: params.cornerThreshold,   // float OK (0-5 step 0.5)
      lt: Math.round(params.lengthThreshold),
      st: Math.round(params.spliceThreshold),
      pp: Math.round(params.pathPrecision),
      ld: Math.round(params.layerDifference),
      mi: Math.round(params.maxIterations),
    };
    const pythonCode = [
      'import vtracer',
      `vtracer.convert_image_to_svg_py("${inputPath}", "${outputPath}"`,
      `, colormode="color"`,
      `, hierarchical="${params.hierarchical}"`,
      `, mode="${params.curveMode}"`,
      `, filter_speckle=${p.fs}`,
      `, color_precision=${p.cp}`,
      `, corner_threshold=${p.ct}`,
      `, length_threshold=${p.lt}`,
      `, splice_threshold=${p.st}`,
      `, path_precision=${p.pp}`,
      `, layer_difference=${p.ld}`,
      `, max_iterations=${p.mi}`,
      ')',
    ].join('\n');

    const args = ['-c', pythonCode];

    // Scale timeout with quality: high color count + high filter takes much longer
    // colorPrecision is now actual color count (64-256), higher values = more processing
    const timeout = params.colorPrecision >= 200 && params.filterSpeckle >= 10
      ? 300000   // print-pro / max: 5min (high quality, complex processing)
      : params.colorPrecision >= 128
        ? 180000  // balanced/high: 3min
        : 120000; // fast: 2min

    await new Promise<void>((resolve, reject) => {
      execFile(PYTHON_BIN, args, { timeout }, (error, _stdout, stderr) => {
        if (error) {
          console.error('[svg-trace] VTracer error:', stderr || error.message);
          reject(new Error(`VTracer failed: ${stderr || error.message}`));
        } else {
          resolve();
        }
      });
    });

    if (!existsSync(outputPath)) {
      throw new Error('VTracer did not produce output');
    }

    const svgContent = await readFile(outputPath, 'utf-8');
    return svgContent;
  } finally {
    try { await unlink(inputPath); } catch { /* ignore */ }
    try { await unlink(outputPath); } catch { /* ignore */ }
  }
}

// ─── WASM VTracer (Node.js native, no Python dependency) ─────

let wasmVtracerModule: any = null;

async function getWasmVtracer(): Promise<any> {
  if (wasmVtracerModule) return wasmVtracerModule;
  try {
    const vtracer = await import('wasm_vtracer');
    const fs = await import('fs');
    const pathModule = await import('path');
    const wasmPath = pathModule.join(
      process.cwd(), 'node_modules/wasm_vtracer/wasm_vtracer_bg.wasm'
    );
    const wasmBuffer = fs.readFileSync(wasmPath);
    await vtracer.init();
    wasmVtracerModule = vtracer;
    console.log('[svg-trace] WASM vtracer initialized successfully');
    return vtracer;
  } catch (err) {
    console.error('[svg-trace] WASM vtracer init failed:', (err as Error).message);
    throw new Error('WASM vtracer not available: ' + (err as Error).message);
  }
}

async function runWasmVTracer(
  inputBuffer: Buffer,
  params: VtracerParams,
  mode: 'color' | 'bw' = 'color',
): Promise<string> {
  const vtracer = await getWasmVtracer();

  // Decode image to raw RGBA pixels using sharp
  const image = sharp(inputBuffer);
  const metadata = await image.metadata();
  const { data, info } = await image
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const width = info.width;
  const height = info.height;

  // Create config
  const config = new vtracer.TracerConfig();
  config.setColorMode(
    mode === 'bw'
      ? vtracer.ColorMode.Binary
      : vtracer.ColorMode.Color
  );
  config.setHierarchical(
    params.hierarchical === 'cutout'
      ? vtracer.Hierarchical.Cutout
      : vtracer.Hierarchical.Stacked
  );
  config.setFilterSpeckle(Math.round(params.filterSpeckle));
  // ★ WASM vtracer 的 colorPrecision 是位深度(1-8)，不是颜色数量
  // Python vtracer 预设中 colorPrecision 是颜色数量(2-4096)，需要转换
  // 位深度 → 颜色数 = 2^depth，所以颜色数 → 位深度 = ceil(log2(colorCount))
  const wasmColorPrecision = Math.min(8, Math.max(1, Math.ceil(Math.log2(Math.max(2, params.colorPrecision)))));
  config.setColorPrecision(wasmColorPrecision);
  config.setCornerThreshold(params.cornerThreshold);
  config.setPathPrecision(Math.round(params.pathPrecision));
  config.setLayerDifference(Math.round(params.layerDifference));
  config.setMaxIterations(Math.round(params.maxIterations));

  console.log(`[svg-trace] WASM vtracer: ${width}x${height}, colorPrecision=${params.colorPrecision}, filterSpeckle=${params.filterSpeckle}`);

  const svg = vtracer.convertImageToSvg(pixels, width, height, config);
  if (!svg || svg.length < 50) {
    throw new Error('WASM vtracer produced empty or invalid output');
  }

  return svg;
}

// ─── Potrace (B&W Trace) via ImageMagick + Potrace ─────

async function runPotrace(
  inputBuffer: Buffer,
  params: {
    threshold?: number;
    turdSize?: number;
    alphaMax?: number;
    optCurve?: boolean;
    optCurveVal?: number;
    invert?: boolean;
  }
): Promise<string> {
  const tmpDir = path.join(getServerDataRoot(), 'svg-trace-tmp');
  if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });

  const uid = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const inputPath = path.join(tmpDir, `bw-input-${uid}.png`);
  const pbmPath = path.join(tmpDir, `bw-mono-${uid}.pbm`);
  const outputPath = path.join(tmpDir, `bw-output-${uid}.svg`);

  try {
    // Step 1: Preprocess — flatten alpha + adaptive resize
    const meta = await sharp(inputBuffer).metadata();
    let pipeline = sharp(inputBuffer);

    // Remove alpha (flatten to white)
    if (meta.channels === 4) {
      pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    // Resize if too large
    if (meta.width && meta.width > 4096) {
      pipeline = pipeline.resize(4096, null, {
        withoutEnlargement: true,
        kernel: 'lanczos3',
      });
    }

    // Convert to high-quality PNG for ImageMagick
    await pipeline.png({ quality: 100, compressionLevel: 0 }).toFile(inputPath);

    // Step 2: ImageMagick → threshold + monochrome PBM
    const threshold = params.threshold ?? 50;
    const imArgs = [
      inputPath,
      '-colorspace', 'Gray',  // Convert to grayscale first for cleaner thresholding
      '-threshold', `${threshold}%`,
      '-monochrome',
      pbmPath,
    ];

    await new Promise<void>((resolve, reject) => {
      execFile('convert', imArgs, { timeout: 60000 }, (error, _stdout, stderr) => {
        if (error) {
          console.error('[svg-trace] ImageMagick error:', stderr || error.message);
          reject(new Error(`ImageMagick failed: ${stderr || error.message}`));
        } else {
          resolve();
        }
      });
    });

    // Step 3: Potrace → SVG with optimized parameters
    const potraceArgs = [
      pbmPath,
      '-s',                           // SVG output
      '-o', outputPath,
      '-u', '1',                      // SVG unit: 1 px per unit (clean coordinates)
      '-t', String(params.turdSize ?? 2),  // suppress speckles
      '-a', String(params.alphaMax ?? 1),  // corner threshold
      '-k', '0.5',                    // black color fill
    ];

    if (params.optCurve !== false) {
      // Optimize bezier curve smoothing (higher = smoother)
      potraceArgs.push('-O', String(params.optCurveVal ?? 2));
    } else {
      potraceArgs.push('-n');  // no curve optimization
    }

    if (params.invert) {
      potraceArgs.push('-i');  // invert
    }

    await new Promise<void>((resolve, reject) => {
      execFile('potrace', potraceArgs, { timeout: 60000 }, (error, _stdout, stderr) => {
        if (error) {
          console.error('[svg-trace] Potrace error:', stderr || error.message);
          reject(new Error(`Potrace failed: ${stderr || error.message}`));
        } else {
          resolve();
        }
      });
    });

    if (!existsSync(outputPath)) {
      throw new Error('Potrace did not produce output');
    }

    let svgContent = await readFile(outputPath, 'utf-8');

    // Sanitize for Illustrator
    svgContent = sanitizeSvgForIllustrator(svgContent, meta.width, meta.height);

    return svgContent;
  } finally {
    try { await unlink(inputPath); } catch { /* ignore */ }
    try { await unlink(pbmPath); } catch { /* ignore */ }
    try { await unlink(outputPath); } catch { /* ignore */ }
  }
}

// ─── SVG Color Merging ──────────────────────────────────
// Merge similar colors to reduce color count and produce cleaner output.
// Especially important for line art: all dark colors → pure black #000000.

interface ColorInfo {
  hex: string;
  r: number;
  g: number;
  b: number;
  count: number;  // number of paths using this color
}

/**
 * 合并 SVG 中的相似颜色，减少色块数量
 * 1. 所有暗色（亮度 < 50）合并为纯黑 #000000
 * 2. 亮度差 < threshold 的颜色合并
 * 3. 保留使用最多的颜色作为代表色
 */
function mergeSvgColors(svg: string, mergeThreshold: number = 12): string {
  // 参考Vector Magic的理念：保留真实颜色，只合并视觉上完全无法区分的颜色
  // 不做激进的暗色合并或颜色数限制——那会破坏色彩还原度

  // 1. 提取所有 fill 颜色
  const fillRegex = /fill="(#[0-9a-fA-F]{3,8})"/g;
  const colorMap = new Map<string, ColorInfo>();
  let match: RegExpExecArray | null;

  while ((match = fillRegex.exec(svg)) !== null) {
    const hex = match[1].toLowerCase();
    if (!colorMap.has(hex)) {
      const rgb = hexToRgb(hex);
      if (rgb) {
        colorMap.set(hex, { hex, ...rgb, count: 1 });
      }
    } else {
      colorMap.get(hex)!.count++;
    }
  }

  if (colorMap.size <= 1) return svg;

  // 2. 仅合并 RGB 距离极近的颜色（阈值 12，约 5% 差异）
  // 这是视觉上几乎完全相同的颜色，合并后用户看不出差别
  const mergeMap = new Map<string, string>(); // old hex → new hex
  const colors = Array.from(colorMap.values());

  // 按使用次数降序排序（使用多的颜色优先保留）
  colors.sort((a, b) => b.count - a.count);

  const kept: ColorInfo[] = []; // 保留的代表色

  for (const c of colors) {
    if (mergeMap.has(c.hex)) continue;

    // 在已保留的颜色中找最近的
    let bestMatch: ColorInfo | null = null;
    let bestDist = Infinity;
    for (const rep of kept) {
      const dist = colorDistance(c, rep);
      if (dist < mergeThreshold && dist < bestDist) {
        bestDist = dist;
        bestMatch = rep;
      }
    }

    if (bestMatch) {
      // 合并到已有的代表色
      mergeMap.set(c.hex, bestMatch.hex);
    } else {
      // 保留此颜色作为新的代表色
      kept.push(c);
    }
  }

  // 3. 应用合并映射
  if (mergeMap.size === 0) return svg;

  let result = svg;
  for (const [oldHex, newHex] of mergeMap) {
    // 替换所有 fill="oldHex" 为 fill="newHex"
    const re = new RegExp(`fill="${oldHex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'gi');
    result = result.replace(re, `fill="${newHex}"`);
  }

  console.log(`[svg-trace] Color merge: ${colorMap.size} → ${colorMap.size - mergeMap.size} colors merged, ${mergeMap.size} replacements`);

  return result;
}

/**
 * Validate and fix common SVG XML errors that prevent rendering.
 * Handles: orphaned slashes in tags, unclosed tags, malformed attributes.
 */
function fixSvgXml(svg: string): string {
  let fixed = svg;

  // Fix orphaned slashes inside opening tags: <path fill="red" / d="..."/> → <path fill="red" d="..."/>
  // This happens when attributes are stripped from self-closing tags
  fixed = fixed.replace(/<(\w+)\s+([^>]*?)\s+\/\s+([^>]*?)>/g, '<$1 $2 $3>');

  // Fix double slashes: <path //> → <path/>
  fixed = fixed.replace(/<(\w+)\s+([^>]*?)\/\/>/g, '<$1 $2/>');

  // Fix paths with trailing slash before closing bracket but after attrs: <path fill="red" />  (this is valid)
  // But <path fill="red" / d="M"/> is not — already handled above

  // Remove incomplete attribute names (e.g., stroke- with no value: stroke-="..." or stroke- )
  // These cause XML parse errors: "Specification mandates value for attribute stroke-"
  // Key: a valid attr like stroke-width has \w after the hyphen; an invalid one has > or space or =
  fixed = fixed.replace(/\s+[a-zA-Z][\w]*-=(?:"[^"]*"|'[^']*')?/g, '');  // e.g., stroke-="..." or stroke-=
  fixed = fixed.replace(/\s+[a-zA-Z][\w]*-(?=[\s>])/g, ' ');  // e.g., stroke-> or stroke- fill=

  // Remove completely empty path elements (no d attribute)
  fixed = fixed.replace(/<path\s*(?:\/>)?>/g, '');

  // Fix unclosed path tags: <path d="..." > should be <path d="..."/>
  // Only for path elements that have attributes but no self-closing
  fixed = fixed.replace(/<path\s+([^>]*[^/])>(?!\s*<\/path)/g, '<path $1/>');

  return fixed;
}

/** 将 hex 颜色转为 RGB */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  if (h.length === 4) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]+h[3]+h[3]; // with alpha
  if (h.length >= 6) {
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  }
  return null;
}

/** 计算两个颜色的欧几里得距离 */
function colorDistance(a: ColorInfo, b: ColorInfo): number {
  return Math.sqrt(
    (a.r - b.r) ** 2 +
    (a.g - b.g) ** 2 +
    (a.b - b.b) ** 2
  );
}

// ─── SVG Path Simplification ──────────────────────────────
// 丹青AI 核心卖点: "锚点精准可调" — 减少冗余锚点，保持图形保真
// Remove collinear intermediate points from SVG path data.

function areCollinear(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  tolerance: number = 0.5
): boolean {
  const cross = Math.abs((x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1));
  const dist = Math.sqrt((x3 - x1) ** 2 + (y3 - y1) ** 2);
  if (dist === 0) return true;
  return cross / dist < tolerance;
}

function simplifySvgPaths(svg: string): string {
  return svg.replace(/d="([^"]+)"/g, (_match: string, d: string) => {
    return 'd="' + simplifyPathData(d) + '"';
  });
}

function simplifyPathData(d: string): string {
  const commands: Array<{ cmd: string; coords: number[] }> = [];
  let i = 0;
  let currentCmd = '';

  function skipWS() {
    while (i < d.length && (d[i] === ' ' || d[i] === ',' || d[i] === '\t' || d[i] === '\n')) i++;
  }
  function readNum(): number {
    skipWS();
    let s = '';
    if (i < d.length && (d[i] === '-' || d[i] === '+')) { s += d[i]; i++; }
    while (i < d.length && ((d[i] >= '0' && d[i] <= '9') || d[i] === '.')) { s += d[i]; i++; }
    return s ? parseFloat(s) : NaN;
  }

  while (i < d.length) {
    const ch = d[i];
    if ('MLCSQTAHVmlcsqtahv'.includes(ch)) {
      currentCmd = ch;
      commands.push({ cmd: ch, coords: [] });
      i++;
    } else if (ch === 'Z' || ch === 'z') {
      commands.push({ cmd: ch, coords: [] });
      i++;
    } else if ((ch >= '0' && ch <= '9') || ch === '-' || ch === '+' || ch === '.') {
      if (!commands.length || !currentCmd) { i++; continue; }
      const num = readNum();
      if (!Number.isNaN(num)) {
        commands[commands.length - 1].coords.push(num);
      }
    } else {
      i++;
    }
  }

  // Simplify consecutive L commands: remove collinear intermediate points
  const simplified: Array<{ cmd: string; coords: number[] }> = [];
  let prevX = 0, prevY = 0;

  for (let ci = 0; ci < commands.length; ci++) {
    const c = commands[ci];

    if (c.cmd === 'M') {
      simplified.push(c);
      if (c.coords.length >= 2) {
        prevX = c.coords[c.coords.length - 2];
        prevY = c.coords[c.coords.length - 1];
      }
    } else if (c.cmd === 'L' && c.coords.length >= 2) {
      const points: Array<{ x: number; y: number }> = [{ x: prevX, y: prevY }];
      for (let j = 0; j < c.coords.length - 1; j += 2) {
        points.push({ x: c.coords[j], y: c.coords[j + 1] });
      }

      if (points.length >= 3) {
        const filtered: Array<{ x: number; y: number }> = [points[0]];
        for (let k = 1; k < points.length - 1; k++) {
          const prev = filtered[filtered.length - 1];
          const curr = points[k];
          const next = points[k + 1];
          if (!areCollinear(prev.x, prev.y, curr.x, curr.y, next.x, next.y, 0.5)) {
            filtered.push(curr);
          }
        }
        filtered.push(points[points.length - 1]);

        if (filtered.length < points.length) {
          const newCoords: number[] = [];
          for (let k = 1; k < filtered.length; k++) {
            newCoords.push(filtered[k].x, filtered[k].y);
          }
          simplified.push({ cmd: 'L', coords: newCoords });
          prevX = filtered[filtered.length - 1].x;
          prevY = filtered[filtered.length - 1].y;
        } else {
          simplified.push(c);
          prevX = c.coords[c.coords.length - 2];
          prevY = c.coords[c.coords.length - 1];
        }
      } else {
        simplified.push(c);
        prevX = c.coords[c.coords.length - 2];
        prevY = c.coords[c.coords.length - 1];
      }
    } else {
      simplified.push(c);
      if (c.cmd === 'L' || c.cmd === 'C' || c.cmd === 'S' || c.cmd === 'Q' || c.cmd === 'T') {
        if (c.coords.length >= 2) {
          prevX = c.coords[c.coords.length - 2];
          prevY = c.coords[c.coords.length - 1];
        }
      } else if (c.cmd === 'H') {
        if (c.coords.length >= 1) prevX = c.coords[c.coords.length - 1];
      } else if (c.cmd === 'V') {
        if (c.coords.length >= 1) prevY = c.coords[c.coords.length - 1];
      }
    }
  }

  let result = '';
  for (const c of simplified) {
    if (c.cmd === 'Z' || c.cmd === 'z') {
      result += c.cmd;
    } else {
      result += c.cmd;
      for (let j = 0; j < c.coords.length; j++) {
        if (j > 0 && j % 2 === 0) result += ' ';
        else if (j > 0) result += ',';
        const val = Math.round(c.coords[j] * 100) / 100;
        result += String(val);
      }
    }
  }
  return result;
}

// ─── SVG Semantic Layer Naming ──────────────────────────────
// 丹青AI 核心卖点: "多层元素独立可拖动"
// Replace layer_N_COLORHEX with semantic names (background / subject / detail / accent)

function optimizeSvgLayers(svg: string): string {
  const gIdRegex = /<g\s+id="layer_(\d+)_([0-9a-fA-F]{3,8})"/g;
  const colorBrightness = new Map<string, number>();

  let match: RegExpExecArray | null;
  while ((match = gIdRegex.exec(svg)) !== null) {
    const hex = match[2];
    if (!colorBrightness.has(hex)) {
      const rgb = hexToRgb(hex);
      if (rgb) {
        const brightness = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
        colorBrightness.set(hex, brightness);
      }
    }
  }

  if (colorBrightness.size === 0) return svg;

  const sorted = Array.from(colorBrightness.entries())
    .sort((a, b) => b[1] - a[1]);

  const labelMap = new Map<string, string>();
  const total = sorted.length;

  for (let idx = 0; idx < total; idx++) {
    const [hex, brightness] = sorted[idx];
    let label: string;

    if (total <= 2) {
      label = idx === 0 ? 'background' : 'foreground';
    } else if (total <= 4) {
      const labels = ['background', 'subject', 'detail', 'accent'];
      label = labels[idx] || `layer-${idx + 1}`;
    } else {
      if (brightness >= 220) label = 'bg-light';
      else if (brightness >= 160) label = 'bg-mid';
      else if (brightness >= 100) label = 'subject-mid';
      else if (brightness >= 50) label = 'subject-dark';
      else label = 'detail-shadow';

      const existing = Array.from(labelMap.values()).filter(l => l === label).length;
      if (existing > 0) label = `${label}-${existing + 1}`;
    }
    labelMap.set(hex, label);
  }

  let result = svg;
  for (const [hex, label] of labelMap) {
    const escapedHex = hex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<g\\s+id="layer_\\d+_${escapedHex}"`, 'g');
    result = result.replace(regex, `<g id="${label}"`);
  }
  return result;
}

// ─── SVG Same-Color Path Merging ──────────────────────────────
// 丹青AI: "在保证图形保真的前提下压缩文件体积"

function mergeSameColorPaths(svg: string): string {
  const svgTagMatch = svg.match(/(<svg[^>]*>)([\s\S]*?)(<\/svg>)/);
  if (!svgTagMatch) return svg;

  const [, svgOpen, content, svgClose] = svgTagMatch;

  const pathRegex = /<path\s+([^>]*)\/>/g;
  const paths: Array<{ fill: string; xml: string; d: string }> = [];

  let pathMatch: RegExpExecArray | null;
  while ((pathMatch = pathRegex.exec(content)) !== null) {
    const attrs = pathMatch[1];
    const fillMatch = attrs.match(/fill="([^"]*)"/);
    const dMatch = attrs.match(/d="([^"]+)"/);
    const fill = fillMatch ? fillMatch[1] : 'none';
    const d = dMatch ? dMatch[1] : '';
    paths.push({ fill, xml: pathMatch[0], d });
  }

  if (paths.length < 5) return svg;

  const colorGroups = new Map<string, Array<{ d: string; xml: string }>>();
  for (const p of paths) {
    if (!colorGroups.has(p.fill)) {
      colorGroups.set(p.fill, []);
    }
    colorGroups.get(p.fill)!.push({ d: p.d, xml: p.xml });
  }

  let mergedCount = 0;
  let newContent = content;

  for (const [fill, group] of colorGroups) {
    if (group.length < 3) continue;

    const mergeableCount = Math.min(group.length, 20);
    if (mergeableCount < 2) continue;

    const mergedD = group.slice(0, mergeableCount)
      .map(p => p.d)
      .join(' Z M ');

    const mergedPath = `<path fill="${fill}" d="M ${mergedD} Z"/>`;

    for (let i = 0; i < mergeableCount; i++) {
      newContent = newContent.replace(group[i].xml, '');
      mergedCount++;
    }
    newContent = mergedPath + newContent;
  }

  if (mergedCount > 0) {
    console.log(`[svg-trace] Path merge: ${mergedCount} paths merged into compound paths`);
    return svgOpen + newContent + svgClose;
  }
  return svg;
}

// ─── SVG Comprehensive Post-Processing Pipeline ──────────────
// 丹青AI级别 SVG 后处理管线

async function postProcessSvg(svg: string): Promise<string> {
  // NOTE: 不做路径简化(simplifySvgPaths)——对path d属性的字符串级解析可能破坏复杂命令序列,
  // 导致SVG格式错误(Illustrator/Figma无法打开)。VTracer输出本身已是优化过的路径。
  // NOTE: 不做同色路径合并(mergeSameColorPaths)——stacked模式下路径有严格的z-order层叠顺序，
  // 合并后放到前面会破坏覆盖关系，导致颜色串层。
  // NOTE: 不做图层分组(groupPathsByFill)——索引计算在路径删除后可能偏移，产生格式错误SVG。
  // 保留optimizeSvgLayers仅做id重命名(安全操作)。
  svg = optimizeSvgLayers(svg);
  // SVGO专业级优化：路径精简、坐标精度、弧线拟合、冗余移除
  svg = await optimizeWithSvgo(svg);
  return svg;
}

// ─── SVGO Professional Post-Processing ──────────────
// 使用 SVGO 进行专业级SVG优化：路径精简、坐标精度、冗余移除
// 与手写字符串级处理不同，SVGO基于AST操作，安全且不破坏SVG结构

async function optimizeWithSvgo(svg: string): Promise<string> {
  try {
    const { optimize } = await import('svgo');
    const result = optimize(svg, {
      plugins: [
        // 清理：移除冗余属性
        'removeDoctype',
        'removeXMLProcInst',
        'removeComments',
        'removeMetadata',
        'removeEditorsNSData',
        'cleanupAttrs',
        'mergeStyles',
        'inlineStyles',
        'minifyStyles',
        'cleanupIds',
        'removeUselessDefs',
        'cleanupNumericValues',
        
        // 路径优化：核心质量提升
        {
          name: 'convertPathData',
          params: {
            // 使用最短路径命令（相对/绝对混合）
            makeArcs: {
              threshold: 2.5,    // 弧线拟合容差，越低越精确
              tolerance: 0.5,   // 弧线偏移容差
            },
            // 精度：保留2位小数（足够精度，减少文件体积）
            floatPrecision: 2,
            // 转换为相对坐标（更短路径数据）
            transformPrecision: 3,
            // 移除无用的路径命令
            removeUseless: true,
            // 合并连续的相同命令
            collapseRepeated: true,
            // 转换直线为更短的命令
            lineShorthands: true,
            // 曲线平滑：将直线段转为平滑曲线
            curveSmoothShorthands: true,
            // 转换二次贝塞尔为三次贝塞尔（更广泛兼容）
            convertToQ: false,
            // 负偏移（更短的负数坐标）
            negativeExtraSpace: true,
            // 强制绝对坐标（Illustrator兼容）
            forceAbsolutePath: false,
            // 移除路径首尾的冗余Z/M命令
            smartArcRounding: true,
          }
        },
        
        // 合并相邻路径（相同fill/stroke的路径合并为一个<path>）
        {
          name: 'mergePaths',
          params: {
            force: false,       // 不强制合并不同风格的路径
            noSpaceAfterFlags: true, // 路径命令标志后无空格（更短）
          }
        },
        
        // 转换变换矩阵为简短属性
        'convertTransform',
        
        // 移除空容器和不可见元素
        'removeEmptyContainers',
        'removeHiddenElems',
        
        // 移除默认值的属性
        'removeEmptyAttrs',
        
        // 移除非空<use>和嵌套<svg>
        'removeNonInheritableGroupAttrs',
        
        // 移除空白
        'removeDesc',
        'removeTitle',
        // 保留viewBox（SVG缩放必需，不能移除）
        // 'removeViewBox' 已禁用 — viewBox 是正确缩放的关键
        
        // 形状优化
        'convertShapeToPath',
        'convertEllipseToCircle',
        
        // 排序属性（更好的可读性）
        'sortAttrs',
        'sortDefsChildren',
      ],
      // 保留SVG结构完整性
      multipass: true,  // 多轮优化，确保最佳结果
    });
    
    if (result.data && result.data.length > 0) {
      console.log(`[svg-trace] SVGO optimized: ${svg.length} → ${result.data.length} bytes (${Math.round((1 - result.data.length / svg.length) * 100)}% reduction)`);
      return result.data;
    }
    return svg;
  } catch (err) {
    console.warn('[svg-trace] SVGO optimization failed, using raw SVG:', (err as Error).message);
    return svg;
  }
}

// ─── SVG Sanitization for Adobe Illustrator ─────────────
//
// Comprehensive cleanup for Illustrator compatibility:
// 1. Remove DOCTYPE / external DTD (causes "missing links" in AI)
// 2. Remove XML processing instructions (re-add clean one)
// 3. Remove <metadata> blocks (can confuse AI)
// 4. Remove comments (AI import issues)
// 5. Fix Potrace coordinate transforms → inline screen-pixel coords
// 6. Fix Potrace pt units → px
// 7. Ensure viewBox exists
// 8. Ensure xmlns is present (exactly once)
// 9. Remove preserveAspectRatio (let AI use default)
// 10. Convert style attributes to inline presentation attributes
// 11. Group paths by fill color (better AI layer organization)
// 12. Add id attributes to <g> groups
// 13. Remove VTracer generator comments (unnecessary)
// 14. Round coordinate precision for cleaner SVG

function sanitizeSvgForIllustrator(svg: string, sourceWidth?: number, sourceHeight?: number): string {
  // 1. Remove DOCTYPE (multi-line)
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>\s*/g, '');

  // 2. Remove XML processing instruction
  svg = svg.replace(/<\?xml[^?]*\?>\s*/g, '');

  // 3. Remove <metadata> blocks
  svg = svg.replace(/<metadata[\s\S]*?<\/metadata>\s*/g, '');

  // 4. Remove XML comments (including VTracer generator comments)
  svg = svg.replace(/<!--[\s\S]*?-->\s*/g, '');

  // 5. Remove standalone="no"
  svg = svg.replace(/\s+standalone="no"/g, '');

  // ─── Potrace-specific: transform path coords to screen pixels ───
  const negScaleMatch = svg.match(/transform="translate\(([^,]+),([^)]+)\)\s+scale\(([^,]+),-([^)]+)\)"/);
  if (negScaleMatch) {
    const tx = parseFloat(negScaleMatch[1]);
    const ty = parseFloat(negScaleMatch[2]);
    const sx = parseFloat(negScaleMatch[3]);
    const sy = parseFloat(negScaleMatch[4]);

    svg = svg.replace(/d="([^"]+)"/g, (_match: string, d: string) => {
      return 'd="' + transformPotracePath(d, tx, ty, sx, sy) + '"';
    });

    // Remove the transform from <g>
    svg = svg.replace(
      /transform="translate\([^)]+\)\s+scale\([^)]+\)"/,
      ''
    );
  }

  // ─── Potrace pt units → px ───
  const ptWidth = svg.match(/width="([\d.]+)pt"/);
  const ptHeight = svg.match(/height="([\d.]+)pt"/);
  if (ptWidth) svg = svg.replace(/width="[\d.]+pt"/, `width="${parseFloat(ptWidth[1])}"`);
  if (ptHeight) svg = svg.replace(/height="[\d.]+pt"/, `height="${parseFloat(ptHeight[1])}"`);

  // ─── VTracer-specific: bake transform="translate(x,y)" into path coordinates ───
  // VTracer stacked mode outputs each path starting at (0,0) with a translate to its actual position.
  // Simply removing the transform would break positioning — we must bake the offset into the path data.
  svg = svg.replace(/<path\s+([^>]*)\/>/g, (_match: string, attrs: string) => {
    const transformMatch = attrs.match(/transform="translate\(([^,]+),([^)]+)\)"/);
    if (!transformMatch) return _match; // no transform, keep as-is
    const tx = parseFloat(transformMatch[1]);
    const ty = parseFloat(transformMatch[2]);
    // Skip if translate is (0,0) — just remove the attribute
    if (tx === 0 && ty === 0) {
      const cleanAttrs = attrs.replace(/\s*transform="translate\([^)]+\)"/, '');
      return `<path ${cleanAttrs}/>`;
    }
    // Bake translate into path d coordinates: add (tx,ty) to all coordinate pairs
    const dMatch = attrs.match(/d="([^"]+)"/);
    if (!dMatch) {
      // No d attribute, just remove transform (shouldn't happen for VTracer output)
      const cleanAttrs = attrs.replace(/\s*transform="translate\([^)]+\)"/, '');
      return `<path ${cleanAttrs}/>`;
    }
    const bakedD = bakeTranslateIntoPath(dMatch[1], tx, ty);
    const newAttrs = attrs
      .replace(/d="[^"]+"/, `d="${bakedD}"`)
      .replace(/\s*transform="translate\([^)]+\)"/, '');
    return `<path ${newAttrs}/>`;
  });

  // ─── Convert style="fill:#xxx" to fill="#xxx" (Illustrator prefers presentation attributes) ───
  svg = convertStyleToPresentationAttrs(svg);

  // ─── Group paths by fill color: DISABLED ───
  // NOTE: groupPathsByFill 在路径删除后使用原始索引插入，导致索引偏移产生格式错误SVG。
  // VTracer stacked输出本身已按颜色分组，无需二次分组。
  // svg = groupPathsByFill(svg);

  // ─── Ensure viewBox exists ───
  if (!svg.includes('viewBox=')) {
    const wMatch = svg.match(/width="([\d.]+)"/);
    const hMatch = svg.match(/height="([\d.]+)"/);
    if (wMatch && hMatch) {
      const w = parseFloat(wMatch[1]);
      const h = parseFloat(hMatch[1]);
      svg = svg.replace(
        /height="[\d.]+"/,
        `height="${h}" viewBox="0 0 ${w} ${h}"`
      );
    } else if (sourceWidth && sourceHeight) {
      svg = svg.replace(/<svg\b/, `<svg viewBox="0 0 ${sourceWidth} ${sourceHeight}"`);
    }
  }

  // ─── Ensure xmlns is present (exactly once) ───
  if (!svg.includes('xmlns=')) {
    svg = svg.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const xmlnsCount = (svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g) || []).length;
  if (xmlnsCount > 1) {
    svg = svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
    svg = svg.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // ─── Add xmlns:xlink for Illustrator compatibility (some AI versions expect it) ───
  if (!svg.includes('xmlns:xlink=')) {
    svg = svg.replace(
      /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/,
      'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    );
  }

  // Remove preserveAspectRatio (let AI use default)
  svg = svg.replace(/\s+preserveAspectRatio="[^"]*"/g, '');

  // ─── Round coordinate precision to 2 decimal places ───
  // Only in path d attributes to keep SVG clean but precise
  svg = svg.replace(/d="([^"]+)"/g, (_match: string, d: string) => {
    return 'd="' + roundPathCoords(d) + '"';
  });

  // Clean up multiple blank lines and extra spaces
  svg = svg.replace(/\n{3,}/g, '\n');
  svg = svg.replace(/\s{2,}/g, ' ');

  // Re-add clean XML declaration
  svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;

  return svg;
}

/**
 * Convert CSS style attributes to inline SVG presentation attributes.
 * Illustrator handles presentation attributes better than style strings.
 * e.g. style="fill:#ff0000;stroke:#000" → fill="#ff0000" stroke="#000"
 */
function convertStyleToPresentationAttrs(svg: string): string {
  return svg.replace(/style="([^"]+)"/g, (_match: string, styleContent: string) => {
    const attrs: string[] = [];
    // Parse CSS properties
    for (const prop of styleContent.split(';')) {
      const trimmed = prop.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const propKey = trimmed.substring(0, colonIdx).trim();
      const propVal = trimmed.substring(colonIdx + 1).trim();

      // Map CSS properties to SVG presentation attributes
      const svgAttr = cssToSvgAttr(propKey);
      if (svgAttr) {
        attrs.push(`${svgAttr}="${propVal}"`);
      }
    }
    return attrs.join(' ');
  });
}

/** Map common CSS properties to SVG presentation attributes */
function cssToSvgAttr(cssProp: string): string | null {
  const mapping: Record<string, string> = {
    'fill': 'fill',
    'stroke': 'stroke',
    'stroke-width': 'stroke-width',
    'stroke-linecap': 'stroke-linecap',
    'stroke-linejoin': 'stroke-linejoin',
    'stroke-dasharray': 'stroke-dasharray',
    'stroke-dashoffset': 'stroke-dashoffset',
    'stroke-miterlimit': 'stroke-miterlimit',
    'stroke-opacity': 'stroke-opacity',
    'fill-opacity': 'fill-opacity',
    'fill-rule': 'fill-rule',
    'clip-rule': 'clip-rule',
    'opacity': 'opacity',
    'transform': 'transform',
    'font-family': 'font-family',
    'font-size': 'font-size',
    'font-style': 'font-style',
    'font-weight': 'font-weight',
    'text-anchor': 'text-anchor',
    'text-decoration': 'text-decoration',
    'letter-spacing': 'letter-spacing',
    'word-spacing': 'word-spacing',
  };
  return mapping[cssProp] || null;
}

/**
 * Group adjacent <path> elements with the same fill color into <g> elements.
 * This creates meaningful layer groups in Illustrator's layers panel.
 */
function groupPathsByFill(svg: string): string {
  // Only group direct children paths with fill attributes
  // Find the content between <svg...> and </svg>
  const svgTagMatch = svg.match(/(<svg[^>]*>)([\s\S]*?)(<\/svg>)/);
  if (!svgTagMatch) return svg;

  const [fullMatch, svgOpen, content, svgClose] = svgTagMatch;

  // Extract all top-level elements (paths, groups, etc.)
  const elements: Array<{ fill: string; xml: string }> = [];
  const pathRegex = /<path\s+([^>]*)\/>/g;
  let match: RegExpExecArray | null;
  const lastIndex = 0;

  // Simple approach: find all paths with their fill, group consecutive same-fill paths
  const paths: Array<{ fill: string; xml: string; index: number }> = [];
  while ((match = pathRegex.exec(content)) !== null) {
    const attrs = match[1];
    const fillMatch = attrs.match(/fill="([^"]*)"/);
    const fill = fillMatch ? fillMatch[1] : 'none';
    paths.push({
      fill,
      xml: match[0],
      index: match.index,
    });
  }

  if (paths.length < 3) return svg; // Too few paths to bother grouping

  // Group consecutive paths with same fill
  const groups: Array<{ fill: string; paths: string[] }> = [];
  let currentGroup: { fill: string; paths: string[] } | null = null;

  for (const p of paths) {
    if (currentGroup && currentGroup.fill === p.fill) {
      currentGroup.paths.push(p.xml);
    } else {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { fill: p.fill, paths: [p.xml] };
    }
  }
  if (currentGroup) groups.push(currentGroup);

  // If all paths have the same fill, no need to group
  if (groups.length <= 1) return svg;

  // Build grouped content: replace individual paths with <g> groups
  let newContent = content;

  // Replace from end to start to preserve indices
  for (let i = paths.length - 1; i >= 0; i--) {
    const p = paths[i];
    // Only remove the path, we'll insert groups separately
    newContent = newContent.substring(0, p.index) + newContent.substring(p.index + p.xml.length);
  }

  // Insert grouped paths
  const groupIdx = 0;
  const insertOffset = 0;
  const insertPoint = paths[0].index;

  const groupXml = groups.map((g, idx) => {
    const colorName = g.fill.startsWith('#')
      ? g.fill.substring(1, 7).toUpperCase()
      : g.fill.replace(/[^a-zA-Z0-9]/g, '_');
    const id = `layer_${idx + 1}_${colorName}`;
    const inner = g.paths.join('\n');
    if (g.paths.length === 1) {
      return g.paths[0]; // Single path, no need for group wrapper
    }
    return `<g id="${id}">\n${inner}\n</g>`;
  }).join('\n');

  newContent = newContent.substring(0, insertPoint) + groupXml + newContent.substring(insertPoint);

  return svgOpen + newContent + svgClose;
}

/**
 * Sanitize AI-generated SVG content for security.
 * Rejects dangerous elements and attributes, validates structure.
 * Returns { safe, reason?, sanitized? }
 */
function sanitizeAIGeneratedSvg(svg: string): { safe: boolean; reason?: string; sanitized?: string } {
  let content = svg;

  // Remove markdown code fences
  content = content.replace(/^```(?:svg|xml|html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // Must contain <svg> tag
  if (!/<svg[\s>]/i.test(content)) {
    return { safe: false, reason: '未检测到 <svg> 标签' };
  }

  // Reject dangerous elements
  const dangerousElements = ['script', 'foreignObject', 'iframe', 'embed', 'object', 'applet'];
  for (const tag of dangerousElements) {
    const regex = new RegExp(`<${tag}[\\s>]`, 'i');
    if (regex.test(content)) {
      return { safe: false, reason: `包含不安全的 <${tag}> 元素` };
    }
  }

  // Reject <image> with external href (data: URI is ok for some cases but we prefer no images)
  const imageExternalMatch = content.match(/<image[^>]*href\s*=\s*["'](?!data:)[^"']*["']/i);
  if (imageExternalMatch) {
    return { safe: false, reason: '包含外部图片引用，仅支持纯矢量路径' };
  }

  // Detect and strip <text> elements — they cause garbled rendering due to font dependency
  const textElementCount = (content.match(/<text[\s>]/gi) || []).length;
  if (textElementCount > 0) {
    console.warn(`[svg-trace] SVG 包含 ${textElementCount} 个 <text> 元素，将尝试移除`);
    // Remove <text> elements but keep a warning in the SVG as a comment
    const strippedContent = content.replace(/<text[^>]*>[\s\S]*?<\/text>/gi, '').replace(/<text[^>]*\/>/gi, '');
    if (strippedContent !== content) {
      content = strippedContent;
      console.warn('[svg-trace] 已移除 <text> 元素，文字内容可能丢失');
    }
  }

  // Reject event handlers (onclick, onload, onerror, etc.)
  if (/\bon\w+\s*=/i.test(content)) {
    return { safe: false, reason: '包含事件处理器脚本' };
  }

  // Reject javascript: URLs
  if (/javascript\s*:/i.test(content)) {
    return { safe: false, reason: '包含 JavaScript 链接' };
  }

  // Reject base64 embedded images in <image> tags (SVG should be pure vector)
  if (/<image[^>]*href\s*=\s*["']data:image/i.test(content)) {
    // Remove the image element rather than reject entirely
    content = content.replace(/<image[^>]*>/gi, '');
  }

  // Validate viewBox exists
  if (!/viewBox\s*=/i.test(content)) {
    return { safe: false, reason: '缺少 viewBox 属性' };
  }

  // Count graphic elements
  const pathCount = (content.match(/<path[\s>]/gi) || []).length;
  const circleCount = (content.match(/<circle[\s>]/gi) || []).length;
  const rectCount = (content.match(/<rect[\s>]/gi) || []).length;
  const lineCount = (content.match(/<line[\s>]/gi) || []).length;
  const polylineCount = (content.match(/<polyline[\s>]/gi) || []).length;
  const polygonCount = (content.match(/<polygon[\s>]/gi) || []).length;
  const ellipseCount = (content.match(/<ellipse[\s>]/gi) || []).length;
  const totalElements = pathCount + circleCount + rectCount + lineCount + polylineCount + polygonCount + ellipseCount;

  if (totalElements === 0) {
    return { safe: false, reason: '没有检测到可转换的 SVG 路径' };
  }

  if (totalElements > 900) {
    return { safe: false, reason: `路径数量过多(${totalElements}个)，建议保留 PNG 格式` };
  }

  if (totalElements > 400) {
    console.warn(`[svg-trace] AI 生成 SVG 路径数量较多: ${totalElements}个，可能影响性能`);
  }

  return { safe: true, sanitized: content };
}

/**
 * Aggressively simplify SVG paths when path count exceeds thresholds.
 * Strategy:
 * 1. Merge paths with identical fill+stroke+opacity (biggest win)
 * 2. Remove tiny/invisible paths (area < threshold)
 * 3. Run aggressive SVGO pass with lower precision
 * Returns simplified SVG string.
 */
async function aggressivelySimplifyPaths(svg: string): Promise<string> {
  let result = svg;

  // Step 1: Merge paths with identical visual properties
  // Group <path> elements by their fill+stroke+opacity+stroke-width combination
  // Match <path .../> or <path ...> — capture attributes only (not trailing /)
  const pathRegex = /<path\s+((?:(?!\/?>).)*?)(?:\s*\/?)>/g;
  const pathGroups = new Map<string, { attrs: string; d: string[] }>();

  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(result)) !== null) {
    const attrs = match[1];
    const dMatch = attrs.match(/d="([^"]*)"/);
    if (!dMatch) continue;

    const fill = (attrs.match(/fill="([^"]*)"/)?.[1] || 'none');
    const stroke = (attrs.match(/stroke="([^"]*)"/)?.[1] || 'none');
    const opacity = (attrs.match(/opacity="([^"]*)"/)?.[1] || '1');
    const strokeWidth = (attrs.match(/stroke-width="([^"]*)"/)?.[1] || '1');
    const fillOpacity = (attrs.match(/fill-opacity="([^"]*)"/)?.[1] || '1');
    const strokeOpacity = (attrs.match(/stroke-opacity="([^"]*)"/)?.[1] || '1');

    const key = `${fill}|${stroke}|${opacity}|${strokeWidth}|${fillOpacity}|${strokeOpacity}`;
    const group = pathGroups.get(key);
    if (group) {
      group.d.push(dMatch[1]);
    } else {
      pathGroups.set(key, {
        // Remove d attribute and any trailing slash from self-closing tags
        // to prevent "Forward-slash in opening tag not followed by >" XML errors
        attrs: attrs.replace(/d="[^"]*"/, '').replace(/\/\s*$/, '').replace(/\s+/g, ' ').trim(),
        d: [dMatch[1]],
      });
    }
  }

  if (pathGroups.size > 0) {
    // Rebuild SVG with merged paths
    const mergedPaths: string[] = [];
    for (const [, group] of pathGroups) {
      if (group.d.length > 1) {
        // Merge multiple paths with same visual properties into one
        const mergedD = group.d.join(' ');
        mergedPaths.push(`<path ${group.attrs} d="${mergedD}"/>`);
      } else {
        mergedPaths.push(`<path ${group.attrs} d="${group.d[0]}"/>`);
      }
    }

    // Only apply if we actually reduced path count
    const originalCount = (result.match(/<path/g) || []).length;
    if (mergedPaths.length < originalCount) {
      // Remove all existing <path> elements (both self-closing and non-self-closing)
      result = result.replace(/<path\s+[^>]*?(?:\s*\/?)>/g, '');
      // Insert merged paths before closing </svg> or </g>
      const insertPos = result.lastIndexOf('</svg>');
      if (insertPos > -1) {
        result = result.substring(0, insertPos) + mergedPaths.join('\n') + '\n' + result.substring(insertPos);
      }
      console.log(`[svg-trace] Merged ${originalCount} paths → ${mergedPaths.length} (saved ${originalCount - mergedPaths.length})`);
    }
  }

  // Step 2: Remove tiny paths (likely noise/artifacts)
  // A path with very short d attribute is probably a speck
  result = result.replace(/<path\s+([^>]*?)d="([MZLHVCSQTAzmzlhvcsqta\s.,+\-\d]+)"\s*\/?>/g, (_full, attrs: string, d: string) => {
    // Rough estimate: count coordinate numbers as proxy for path complexity
    const coordCount = (d.match(/[\d.]+/g) || []).length;
    if (coordCount < 4) {
      return ''; // Remove paths with fewer than 2 points
    }
    return _full;
  });

  // Step 3: Aggressive SVGO pass with lower precision
  try {
    const svgoResult = await runSvgoOptimize(result, {
      plugins: [
        'removeDoctype', 'removeXMLProcInst', 'removeComments', 'removeMetadata',
        'removeEditorsNSData', 'cleanupAttrs', 'mergeStyles', 'inlineStyles',
        'minifyStyles', 'cleanupIds', 'removeUselessDefs',
        {
          name: 'convertPathData',
          params: {
            floatPrecision: 1,         // Lower precision (was 2)
            transformPrecision: 2,     // Lower transform precision
            makeArcs: { threshold: 5, tolerance: 1 }, // More aggressive arc fitting
            removeUseless: true,
            collapseRepeated: true,
            lineShorthands: true,
            curveSmoothShorthands: true,
            convertToQ: true,          // Convert cubic to quadratic (shorter)
            negativeExtraSpace: true,
            smartArcRounding: true,
          }
        },
        { name: 'mergePaths', params: { force: true, noSpaceAfterFlags: true } }, // Force merge
        'convertTransform', 'removeEmptyContainers', 'removeHiddenElems',
        'removeEmptyAttrs', 'removeNonInheritableGroupAttrs',
        'removeDesc', 'removeTitle',
        'convertShapeToPath', 'convertEllipseToCircle',
      ],
      multipass: true,
    });
    if (svgoResult.data) {
      const beforePaths = (result.match(/<path/g) || []).length;
      const afterPaths = (svgoResult.data.match(/<path/g) || []).length;
      console.log(`[svg-trace] Aggressive SVGO: ${beforePaths} → ${afterPaths} paths, ${result.length} → ${svgoResult.data.length} bytes`);
      result = svgoResult.data;
    }
  } catch (err) {
    console.warn('[svg-trace] Aggressive SVGO failed:', (err as Error).message);
  }

  return result;
}

/**
 * Normalize SVG dimensions: ensure width, height, viewBox are consistent
 * with the original image dimensions.
 */
function normalizeVectorSvg(svg: string, width: number, height: number): string {
  // Extract existing viewBox
  const viewBoxMatch = svg.match(/viewBox\s*=\s*"([^"]*)"/i);
  const existingViewBox = viewBoxMatch ? viewBoxMatch[1] : null;

  // If no viewBox, add one based on width/height
  if (!existingViewBox) {
    const vb = `0 0 ${width} ${height}`;
    svg = svg.replace(/<svg/i, `<svg viewBox="${vb}"`);
  }

  // Force width and height attributes to match original image
  // Remove existing width/height first, then add new ones
  let normalized = svg
    .replace(/\s*width\s*=\s*"[^"]*"/i, '')
    .replace(/\s*height\s*=\s*"[^"]*"/i, '');

  // Insert width and height after <svg tag
  normalized = normalized.replace(/<svg/i, `<svg width="${width}" height="${height}"`);

  return normalized;
}

/**
 * Count total graphic elements in an SVG string.
 */
function countSvgElements(svg: string): number {
  const tags = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'];
  let count = 0;
  for (const tag of tags) {
    const regex = new RegExp(`<${tag}[\\s>]`, 'gi');
    count += (svg.match(regex) || []).length;
  }
  return count;
}

/**
 * Round numeric values in path data to 2 decimal places.
 * Keeps SVG file size manageable while preserving visual precision.
 */
function roundPathCoords(d: string): string {
  return d.replace(/([\d.]+)/g, (numStr: string) => {
    const num = parseFloat(numStr);
    if (Number.isNaN(num)) return numStr;
    // Round to 2 decimal places, strip trailing zeros
    const rounded = Math.round(num * 100) / 100;
    return rounded.toString();
  });
}

/**
 * Transform Potrace path data from Potrace coordinate space to screen pixels.
 * Potrace: screen_x = tx + path_x * sx, screen_y = ty - path_y * sy
 */
function transformPotracePath(d: string, tx: number, ty: number, sx: number, sy: number): string {
  let result = '';
  let i = 0;
  let currentCmd = '';

  function skipWS() {
    while (i < d.length && (d[i] === ' ' || d[i] === ',' || d[i] === '\t' || d[i] === '\n')) i++;
  }
  function readNum(): number {
    skipWS();
    let s = '';
    if (i < d.length && (d[i] === '-' || d[i] === '+')) { s += d[i]; i++; }
    while (i < d.length && ((d[i] >= '0' && d[i] <= '9') || d[i] === '.')) { s += d[i]; i++; }
    return s ? parseFloat(s) : NaN;
  }
  function r(n: number): string {
    return Number.isNaN(n) ? '0' : (Math.round(n * 100) / 100).toString();
  }
  function tX(x: number): number { return tx + x * sx; }
  function tY(y: number): number { return ty - y * sy; }

  while (i < d.length) {
    const ch = d[i];

    if ('MLCSQTA'.includes(ch) || 'mlcsqta'.includes(ch)) {
      currentCmd = ch;
      result += ch;
      i++;
    } else if (ch === 'H') {
      currentCmd = ch; result += ch; i++;
      result += r(tX(readNum()));
    } else if (ch === 'h') {
      currentCmd = ch; result += ch; i++;
      result += r(readNum() * sx);
    } else if (ch === 'V') {
      currentCmd = ch; result += ch; i++;
      result += r(tY(readNum()));
    } else if (ch === 'v') {
      currentCmd = ch; result += ch; i++;
      result += r(-readNum() * sy);
    } else if (ch === 'Z' || ch === 'z') {
      result += ch; i++;
    } else if ((ch >= '0' && ch <= '9') || ch === '-' || ch === '+' || ch === '.') {
      if (currentCmd === 'M' || currentCmd === 'L') {
        const x = readNum(), y = readNum();
        result += r(tX(x)) + ',' + r(tY(y));
      } else if (currentCmd === 'm' || currentCmd === 'l') {
        const dx = readNum(), dy = readNum();
        result += r(dx * sx) + ',' + r(-dy * sy);
      } else if (currentCmd === 'C') {
        const x1 = readNum(), y1 = readNum(), x2 = readNum(), y2 = readNum(), x = readNum(), y = readNum();
        result += r(tX(x1))+','+r(tY(y1))+' '+r(tX(x2))+','+r(tY(y2))+' '+r(tX(x))+','+r(tY(y));
      } else if (currentCmd === 'c') {
        const dx1=readNum(),dy1=readNum(),dx2=readNum(),dy2=readNum(),dx=readNum(),dy=readNum();
        result += r(dx1*sx)+','+r(-dy1*sy)+' '+r(dx2*sx)+','+r(-dy2*sy)+' '+r(dx*sx)+','+r(-dy*sy);
      } else if (currentCmd === 'S') {
        const x2=readNum(),y2=readNum(),x=readNum(),y=readNum();
        result += r(tX(x2))+','+r(tY(y2))+' '+r(tX(x))+','+r(tY(y));
      } else if (currentCmd === 's') {
        const dx2=readNum(),dy2=readNum(),dx=readNum(),dy=readNum();
        result += r(dx2*sx)+','+r(-dy2*sy)+' '+r(dx*sx)+','+r(-dy*sy);
      } else if (currentCmd === 'Q') {
        const x1=readNum(),y1=readNum(),x=readNum(),y=readNum();
        result += r(tX(x1))+','+r(tY(y1))+' '+r(tX(x))+','+r(tY(y));
      } else if (currentCmd === 'q') {
        const dx1=readNum(),dy1=readNum(),dx=readNum(),dy=readNum();
        result += r(dx1*sx)+','+r(-dy1*sy)+' '+r(dx*sx)+','+r(-dy*sy);
      } else if (currentCmd === 'T') {
        const x=readNum(),y=readNum();
        result += r(tX(x))+','+r(tY(y));
      } else if (currentCmd === 't') {
        const dx=readNum(),dy=readNum();
        result += r(dx*sx)+','+r(-dy*sy);
      } else if (currentCmd === 'A') {
        const rx=readNum(),ry=readNum(),angle=readNum(),la=readNum(),sw=readNum(),x=readNum(),y=readNum();
        result += r(rx*sx)+','+r(ry*sy)+' '+angle+' '+la+' '+sw+' '+r(tX(x))+','+r(tY(y));
      } else if (currentCmd === 'a') {
        const rx=readNum(),ry=readNum(),angle=readNum(),la=readNum(),sw=readNum(),dx=readNum(),dy=readNum();
        result += r(rx*sx)+','+r(ry*sy)+' '+angle+' '+la+' '+sw+' '+r(dx*sx)+','+r(-dy*sy);
      }
    } else {
      result += ch; i++;
    }
  }
  return result;
}

/**
 * Bake a simple translate(x,y) transform into SVG path data coordinates.
 * This eliminates transform attributes that Illustrator sometimes fails to parse.
 *
 * For absolute commands (M, L, H, V, C, S, Q, T, A) we add tx/ty to x and y coords.
 * For relative commands (m, l, h, v, c, s, q, t, a) we leave coords unchanged
 * (relative coords are already relative to the previous point, so translate is implicitly applied).
 */
function bakeTranslateIntoPath(d: string, tx: number, ty: number): string {
  let result = '';
  let i = 0;
  let currentCmd = '';

  const isAbs = (cmd: string) => 'MLHVCSQTA'.includes(cmd);
  const isRel = (cmd: string) => 'mlhvcsqta'.includes(cmd);

  const r = (v: number) => {
    const rounded = Math.round(v * 100) / 100;
    return String(rounded);
  };

  while (i < d.length) {
    const ch = d[i];

    if (isAbs(ch) || isRel(ch)) {
      currentCmd = ch;
      result += ch;
      i++;
    } else if (ch === 'Z' || ch === 'z') {
      result += ch;
      i++;
    } else if ((ch >= '0' && ch <= '9') || ch === '-' || ch === '+' || ch === '.') {
      // Parse a number (possibly negative, with decimal)
      const numStart = i;
      if (d[i] === '-' || d[i] === '+') i++;
      while (i < d.length && ((d[i] >= '0' && d[i] <= '9') || d[i] === '.')) i++;
      const num = parseFloat(d.slice(numStart, i));

      if (isAbs(currentCmd)) {
        // For absolute commands, add translate offset to coordinates
        if ('MLCSQTA'.includes(currentCmd)) {
          // These commands come in (x,y) pairs — the number we just read is x
          result += r(num + tx);
          // Skip separator
          while (i < d.length && (d[i] === ',' || d[i] === ' ')) { result += d[i]; i++; }
          // Read y
          const yStart = i;
          if (d[i] === '-' || d[i] === '+') i++;
          while (i < d.length && ((d[i] >= '0' && d[i] <= '9') || d[i] === '.')) i++;
          const y = parseFloat(d.slice(yStart, i));
          result += r(y + ty);
        } else if (currentCmd === 'H') {
          // Horizontal: only x coordinate
          result += r(num + tx);
        } else if (currentCmd === 'V') {
          // Vertical: only y coordinate
          result += r(num + ty);
        } else {
          result += r(num);
        }
      } else {
        // Relative commands: no translation needed (coords are deltas)
        result += r(num);
      }
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}

// ─── Sharp: Image Compression ──────────────────────────

async function compressImage(
  inputBuffer: Buffer,
  params: {
    quality?: number;
    format?: 'jpeg' | 'webp' | 'png';
  }
): Promise<{ buffer: Buffer; format: string; mimeType: string; width: number; height: number; size: number }> {
  const quality = params.quality ?? 80;
  const format = params.format || 'webp';

  const pipeline = sharp(inputBuffer);
  const metadata = await sharp(inputBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  let outputBuffer: Buffer;
  let mimeType: string;

  switch (format) {
    case 'jpeg':
      outputBuffer = await pipeline.jpeg({ quality }).toBuffer();
      mimeType = 'image/jpeg';
      break;
    case 'webp':
      outputBuffer = await pipeline.webp({ quality }).toBuffer();
      mimeType = 'image/webp';
      break;
    case 'png':
      outputBuffer = await pipeline.png({ quality: Math.round(quality), compressionLevel: 9 }).toBuffer();
      mimeType = 'image/png';
      break;
    default:
      outputBuffer = await pipeline.webp({ quality }).toBuffer();
      mimeType = 'image/webp';
  }

  return {
    buffer: outputBuffer,
    format,
    mimeType,
    width,
    height,
    size: outputBuffer.length,
  };
}

// ─── Sharp: Thumbnail Generation ───────────────────────

async function generateThumbnail(
  inputBuffer: Buffer,
  params: {
    width?: number;
    height?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  }
): Promise<{ buffer: Buffer; width: number; height: number; size: number }> {
  const thumbWidth = params.width || 200;
  const thumbHeight = params.height || 200;
  const fit = params.fit || 'cover';

  const outputBuffer = await sharp(inputBuffer)
    .resize(thumbWidth, thumbHeight, { fit })
    .webp({ quality: 85 })
    .toBuffer();

  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    width: meta.width || thumbWidth,
    height: meta.height || thumbHeight,
    size: outputBuffer.length,
  };
}

// ─── Save result to storage ────────────────────────────

async function saveResult(
  data: Buffer | string,
  filename: string,
  subDir: string,
  mimeType: string
): Promise<{ url: string; s3Key: string | null }> {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;

  const url = saveImageFile(buffer, filename, subDir);

  let s3Key: string | null = null;
  if (isS3Available()) {
    try {
      s3Key = await uploadImageToS3(buffer, filename, mimeType);
    } catch (e) {
      console.warn('[svg-trace] S3 upload failed:', e instanceof Error ? e.message : String(e));
    }
  }

  return { url, s3Key };
}


async function tryDesignVectorizeFallback(req: NextRequest, imageUrl: string, mode: TraceMode, forcedEngine?: VectorizeEngine): Promise<NextResponse | null> {
  try {
    // 使用统一矢量化管线替代旧 design/vectorize fallback
    const inputBuffer = await resolveImageUrl(imageUrl);
    if (!inputBuffer || inputBuffer.length === 0) return null;

    const pipelineResult = await vectorizePipeline({
      imageBuffer: inputBuffer,
      imageUrl,
      engine: forcedEngine || undefined,
      mode: (mode === 'bw' || mode === 'cutting' || mode === 'engraving' || mode === 'lineart') ? 'lineart' : 'color',
    });

    if (!pipelineResult.success || !pipelineResult.svg) return null;

    let svgContent = sanitizeSvgForIllustrator(String(pipelineResult.svg));
    // AI 生成 SVG 安全过滤
    const safetyResult = sanitizeAIGeneratedSvg(svgContent);
    if (!safetyResult.safe) {
      console.warn('[svg-trace] AI SVG 安全过滤拒绝:', safetyResult.reason);
      return null;
    }
    svgContent = safetyResult.sanitized || svgContent;
    // 丹青AI级别后处理
    svgContent = await postProcessSvg(svgContent);
    // SVG 标准化
    svgContent = normalizeVectorSvg(svgContent, 0, 0);
    svgContent = fixSvgXml(svgContent);
    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
    let pngPreviewUrl: string | undefined;
    let pngServerUrl: string | undefined;
    try {
      const pngBuffer = await sharp(Buffer.from(svgContent)).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).png({ quality: 90 }).toBuffer();
      const fbTimestamp = Date.now();
      const fbRandom = Math.random().toString(36).substring(2, 8);
      const pngSaveResult = await saveResult(pngBuffer, `svg-fallback-${fbTimestamp}-${fbRandom}-preview.png`, 'svg-trace', 'image/png');
      pngServerUrl = pngSaveResult.url;
      pngPreviewUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    } catch (pngErr) {
      console.warn('[svg-trace] Fallback PNG preview failed:', (pngErr as Error).message);
    }
    return NextResponse.json({
      success: true,
      mode,
      engine: pipelineResult.engine || 'pipeline-fallback',
      dataUrl: pngServerUrl || pngPreviewUrl || svgDataUrl,
      ...(svgDataUrl.length < 200000 ? { svgDataUrl } : {}),
      isSvgPreview: !!(pngServerUrl || pngPreviewUrl),
      fallback: true,
      stats: { svgSize: Buffer.byteLength(svgContent, 'utf-8'), pathCount: (svgContent.match(/<path/g) || []).length },
    });
  } catch (e) {
    console.warn('[svg-trace] vectorize pipeline fallback failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ─── POST handler ──────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: TraceRequest = await req.json();
    const { imageUrl, mode = 'color' } = body;

    if (!imageUrl) {
      return NextResponse.json({ success: false, error: '缺少 imageUrl' }, { status: 400 });
    }

    const validModes: TraceMode[] = ['color', 'bw', 'cutting', 'engraving', 'lineart', 'compress', 'thumbnail'];
    if (!validModes.includes(mode)) {
      return NextResponse.json({ success: false, error: `无效模式: ${mode}，支持: ${validModes.join('/')}` }, { status: 400 });
    }

    console.log(`[svg-trace] mode=${mode}, preset=${body.qualityPreset || 'balanced'}, imageUrl=${imageUrl.substring(0, 100)}`);

    // 积分检查与扣除
    const sessionUser = await getSessionUser(req);
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'svg_trace');
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
    }

    // Pre-check tool availability for trace modes
    // NOTE: color mode now uses unified pipeline (Recraft/VLM → WASM-vtracer/Python-vtracer), so Python vtracer is not required
    if (mode === 'color') {
      const vtracerCheck = await new Promise<boolean>((resolve) => {
        execFile(PYTHON_BIN, ['-c', 'import vtracer'], { timeout: 5000 }, (error) => {
          resolve(!error);
        });
      });
      if (!vtracerCheck && (body.engine === 'vtracer')) {
        // Python vtracer not installed, but WASM vtracer is always available as fallback
        console.log('[svg-trace] Python vtracer not available, falling back to WASM vtracer');
      }
      // If vtracer not available but engine is auto/vectorize-api/vlm/wasm-vtracer, the pipeline will handle it
    } else if (mode === 'bw' || mode === 'cutting' || mode === 'engraving' || mode === 'lineart') {
      const potraceCheck = await new Promise<boolean>((resolve) => {
        execFile('which', ['potrace'], { timeout: 5000 }, (error) => {
          resolve(!error);
        });
      });
      if (!potraceCheck) {
        // 尝试统一管线作为黑白模式兜底
        const fallback = await tryDesignVectorizeFallback(req, imageUrl, mode);
        if (fallback) return fallback;
        return NextResponse.json({
          success: false,
          error: 'Potrace 未安装，且矢量化管线兜底不可用。请安装: apt-get install potrace，或在管理员系统配置矢量模型。',
        }, { status: 503 });
      }
    }

    // Resolve image to buffer
    const inputBuffer = await resolveImageUrl(imageUrl);
    if (!inputBuffer || inputBuffer.length === 0) {
      return NextResponse.json({ success: false, error: '无法获取图片数据' }, { status: 400 });
    }

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const uid = `${timestamp}-${random}`;

    switch (mode) {
      // ─── 彩色矢量化：统一管线(Recraft/VLM) → VTracer → ImageTracer.js ───
      case 'color': {
        const requestedEngine = body.engine || 'auto';

        // ─── P0: 统一矢量化管线 (Recraft Vectorize → VLM → WASM VTracer → vtracer spline) ───
        let pipelineFallbackWarning: string | undefined;
        if (requestedEngine === 'auto' || requestedEngine === 'vectorize-api' || requestedEngine === 'vlm') {
          console.log(`[svg-trace] Pipeline starting, requestedEngine=${requestedEngine}, qualityPreset=${body.qualityPreset || 'balanced'}`);
          try {
            const inputBufferForPipeline = await resolveImageUrl(imageUrl);
            if (inputBufferForPipeline && inputBufferForPipeline.length > 0) {
              // 获取图片尺寸用于管线分析和后续处理
              let imgWidth = 0, imgHeight = 0;
              try {
                const meta = await sharp(inputBufferForPipeline).metadata();
                imgWidth = meta.width || 0;
                imgHeight = meta.height || 0;
              } catch { /* metadata not critical */ }

              const pipelineResult = await vectorizePipeline({
                imageUrl,
                imageBuffer: inputBufferForPipeline,
                imageDataUrl: `data:image/png;base64,${inputBufferForPipeline.toString('base64')}`,
                width: imgWidth,
                height: imgHeight,
                engine: requestedEngine !== 'auto' ? requestedEngine as VectorizeEngine : undefined,
                mode: 'color',
                quality: (body.qualityPreset as PipelineQuality) || 'balanced',
              });

              console.log(`[svg-trace] Pipeline result: success=${pipelineResult.success}, engine=${pipelineResult.engine}, enginesTried=[${pipelineResult.enginesTried?.join(',') || ''}], hasSvg=${!!pipelineResult.svg}, error=${pipelineResult.error || 'none'}`);

              if (pipelineResult.success && pipelineResult.svg) {
                let svgContent = String(pipelineResult.svg);
                // AI生成SVG安全过滤
                const safetyCheck = sanitizeAIGeneratedSvg(svgContent);
                if (safetyCheck.safe && safetyCheck.sanitized) {
                  svgContent = safetyCheck.sanitized;
                }
                // 丹青AI级别后处理
                svgContent = await postProcessSvg(svgContent);
                // 标准化
                svgContent = normalizeVectorSvg(svgContent, imgWidth, imgHeight);

                const pathCountCheck = (svgContent.match(/<path/g) || []).length;
                if (pathCountCheck > 0 && pathCountCheck <= 3000) {
                  // Fix any SVG XML errors from path merging before saving
                  svgContent = fixSvgXml(svgContent);

                  const filename = `svg-color-${uid}.svg`;
                  const { url } = await saveResult(svgContent, filename, 'svg-trace', 'image/svg+xml');
                  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

                  let pngPreviewUrl: string | undefined;
                  let pngServerUrl: string | undefined;
                  try {
                    const imgW = imgWidth || 1024;
                    const imgH = imgHeight || 1024;
                    const pngBuffer = await sharp(Buffer.from(svgContent))
                      .resize(Math.min(imgW, 2048), Math.min(imgH, 2048), { fit: 'inside', withoutEnlargement: true })
                      .png({ quality: 90 }).toBuffer();
                    const pngFilename = `svg-color-${uid}-preview.png`;
                    const pngSaveResult = await saveResult(pngBuffer, pngFilename, 'svg-trace', 'image/png');
                    pngServerUrl = pngSaveResult.url;
                    pngPreviewUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
                  } catch (pngErr) {
                    console.warn('[svg-trace] Pipeline PNG preview failed (attempt 1):', (pngErr as Error).message);
                    // Retry with cairosvg
                    try {
                      const { execFile } = await import('child_process');
                      const tmpSvgPath = `/tmp/svg-pipe-${uid}.svg`;
                      const tmpPngPath = `/tmp/svg-pipe-${uid}-preview.png`;
                      const fs = await import('fs/promises');
                      await fs.writeFile(tmpSvgPath, svgContent);
                      await new Promise<void>((resolve, reject) => {
                        execFile('cairosvg', [tmpSvgPath, '-o', tmpPngPath], { timeout: 30000 }, (err) => {
                          if (err) reject(err); else resolve();
                        });
                      });
                      const pngBuffer = await fs.readFile(tmpPngPath);
                      const pngFilename = `svg-color-${uid}-preview.png`;
                      const pngSaveResult = await saveResult(pngBuffer, pngFilename, 'svg-trace', 'image/png');
                      pngServerUrl = pngSaveResult.url;
                      pngPreviewUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
                      fs.unlink(tmpSvgPath).catch(() => {});
                      fs.unlink(tmpPngPath).catch(() => {});
                      console.log('[svg-trace] Pipeline PNG preview generated via cairosvg fallback');
                    } catch (retryErr) {
                      console.warn('[svg-trace] Pipeline PNG preview failed (cairosvg fallback):', (retryErr as Error).message);
                    }
                  }

                  return NextResponse.json({
                    success: true,
                    mode: 'color',
                    engine: pipelineResult.engine,
                    url,
                    dataUrl: pngServerUrl || pngPreviewUrl || url,
                    // 仅小型SVG附带svgDataUrl(前端用于离线下载), 大型SVG通过url下载
                    ...(svgDataUrl.length < 200000 ? { svgDataUrl } : {}),
                    isSvgPreview: !!(pngServerUrl || pngPreviewUrl),
                    stats: {
                      svgSize: Buffer.byteLength(svgContent, 'utf-8'),
                      pathCount: pathCountCheck,
                      groupCount: (svgContent.match(/<g\b/g) || []).length,
                      preset: body.qualityPreset || 'balanced',
                      engineUsed: pipelineResult.engine,
                      imageType: pipelineResult.analysis?.isSimpleGraphic ? 'simple' : pipelineResult.analysis?.isCartoon ? 'cartoon' : 'general',
                    },
                  });
                }

                // Pipeline returned SVG but path count out of range — fall through to vtracer
                console.log(`[svg-trace] Pipeline SVG path count ${pathCountCheck} out of range (1-3000), falling back to local engine`);
                pipelineFallbackWarning = pathCountCheck === 0
                  ? 'AI矢量模型生成结果为空，已降级到本地描摹引擎'
                  : `AI矢量模型生成路径数过多(${pathCountCheck})，已降级到本地描摹引擎`;
              }
            }
          } catch (pipelineErr) {
            const errMsg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
            console.warn('[svg-trace] Pipeline failed, falling back to vtracer:', errMsg);
            pipelineFallbackWarning = `AI矢量模型不可用(${errMsg})，已降级到本地描摹引擎，质量可能较低`;
          }
        }

        // ─── P1: VTracer 彩色矢量化 (本地引擎) ───
        console.log(`[svg-trace] Entering P1 local engine, pipelineFallbackWarning=${pipelineFallbackWarning || 'none'}`);
        const vtracerParams = resolveVtracerParams(body);

        // Preprocess image for optimal VTracer input
        const { buffer: preprocessed, width: imgW, height: imgH } = await preprocessForVTracer(
          inputBuffer,
          vtracerParams,
        );

        let svgContent = '';
        let usedEngine = 'wasm-vtracer';

        // 优先尝试 WASM vtracer（纯 Node.js，无 Python 依赖，性能更好）
        if (requestedEngine === 'wasm-vtracer' || requestedEngine === 'vtracer' || requestedEngine === 'auto') {
          try {
            svgContent = await runWasmVTracer(preprocessed, vtracerParams);
            if (svgContent && svgContent.trim().length > 50) {
              usedEngine = 'wasm-vtracer';
              console.log('[svg-trace] WASM vtracer 成功，路径数:', (svgContent.match(/<path/g) || []).length);
            } else {
              svgContent = '';
            }
          } catch (wasmErr) {
            const wasmErrMsg = wasmErr instanceof Error ? wasmErr.message : String(wasmErr);
            console.warn('[svg-trace] WASM vtracer 失败:', wasmErrMsg);
            svgContent = '';
          }
        }

        // WASM 失败时，尝试 Python vtracer
        if (!svgContent) {
          try {
            svgContent = await runVTracer(preprocessed, vtracerParams);
            if (svgContent && svgContent.trim().length > 50) {
              usedEngine = 'vtracer';
            } else {
              svgContent = '';
            }
          } catch (pyErr) {
            console.warn('[svg-trace] Python vtracer 失败:', pyErr instanceof Error ? pyErr.message : String(pyErr));
            svgContent = '';
          }
        }

        // VTracer全部失败时使用 ImageTracer.js 作为高质量JS兜底
        if (!svgContent || svgContent.trim().length < 50) {
          console.warn('[svg-trace] VTracer输出为空，尝试ImageTracer.js兜底');
          try {
            const ImageTracer = require('imagetracerjs');
            const sharp = require('sharp');
            const pngBuffer = await sharp(preprocessed).png().toBuffer();
            const base64Data = pngBuffer.toString('base64');
            const dataUri = `data:image/png;base64,${base64Data}`;
            svgContent = ImageTracer.imageToSVG(dataUri, {
              numberofcolors: vtracerParams.colorPrecision >= 8 ? 64 : 32,
              pathomit: 8,
              rcorner: 1,
              ltres: 1,
              qtres: 1,
              scale: 1,
              roundcoords: 2,
              desc: false,
              viewbox: false,
              colorsampling: 2,
              blurradius: 1,
              strokewidth: 1,
              linefilter: true,
              lcpr: 0,
              qcpr: 0,
            });
            usedEngine = 'imagetracerjs';
            console.log('[svg-trace] ImageTracer.js兜底成功，路径数:', (svgContent.match(/<path/g) || []).length);
          } catch (itrErr) {
            console.warn('[svg-trace] ImageTracer.js兜底失败:', itrErr);
          }
        }

        // Sanitize SVG for Adobe Illustrator compatibility
        svgContent = sanitizeSvgForIllustrator(svgContent, imgW, imgH);

        // 温和颜色合并：仅合并视觉上无法区分的近色
        svgContent = mergeSvgColors(svgContent);

        // 丹青AI级别后处理：路径简化 + 语义化图层命名 + 同色路径合并 + SVGO优化
        svgContent = await postProcessSvg(svgContent);

        // 标准化 SVG（统一 viewBox / width / height）
        svgContent = normalizeVectorSvg(svgContent, imgW, imgH);

        // 路径数质量控制：过多路径时尝试激进简化
        let pathCountCheck = (svgContent.match(/<path/g) || []).length;
        if (pathCountCheck === 0) {
          return NextResponse.json({
            success: false,
            error: '没有检测到可转换的 SVG 路径，该素材不适合矢量化',
          });
        }

        // Soft limit: try aggressive simplification first
        const COLOR_SOFT_LIMIT = 5000;
        const COLOR_HARD_LIMIT = 10000;
        if (pathCountCheck > COLOR_SOFT_LIMIT && !body.forceSvg) {
          console.log(`[svg-trace] Path count ${pathCountCheck} > soft limit ${COLOR_SOFT_LIMIT}, applying aggressive simplification...`);
          svgContent = await aggressivelySimplifyPaths(svgContent);
          svgContent = normalizeVectorSvg(svgContent, imgW, imgH);
          pathCountCheck = (svgContent.match(/<path/g) || []).length;
          console.log(`[svg-trace] After simplification: ${pathCountCheck} paths`);
        }

        // Hard limit: refuse unless forceSvg
        if (pathCountCheck > COLOR_HARD_LIMIT && !body.forceSvg) {
          return NextResponse.json({
            success: false,
            error: `路径数量过多(${pathCountCheck}条)，已尝试自动简化但仍超过${COLOR_HARD_LIMIT}条上限。该素材更适合保留为 PNG 格式，或在面板中勾选"强制输出SVG"`,
            stats: { pathCount: pathCountCheck },
          });
        }
        if (pathCountCheck > 900) {
          console.warn(`[svg-trace] 路径数量较多: ${pathCountCheck}条，SVG文件可能较大`);
        }

        const filename = `svg-color-${uid}.svg`;
        const { url } = await saveResult(svgContent, filename, 'svg-trace', 'image/svg+xml');

        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        // 生成 PNG 预览图用于画布显示（SVG data URL 在 <img> 中渲染有限制）
        // 策略: 优先生成PNG预览并保存到服务器(返回服务器URL), 失败时尝试修复SVG重试, 最终降级到data URL
        let pngPreviewUrl: string | undefined;
        let pngServerUrl: string | undefined;
        try {
          const pngBuffer = await sharp(Buffer.from(svgContent))
            .resize(Math.min(imgW, 2048), Math.min(imgH, 2048), { fit: 'inside', withoutEnlargement: true })
            .png({ quality: 90 })
            .toBuffer();
          // 保存PNG预览到服务器，避免前端加载超大data URL
          const pngFilename = `svg-color-${uid}-preview.png`;
          const pngSaveResult = await saveResult(pngBuffer, pngFilename, 'svg-trace', 'image/png');
          pngServerUrl = pngSaveResult.url;
          // 同时生成data URL作为备用
          const pngBase64 = pngBuffer.toString('base64');
          pngPreviewUrl = `data:image/png;base64,${pngBase64}`;
        } catch (pngErr) {
          console.warn('[svg-trace] PNG preview generation failed (attempt 1):', (pngErr as Error).message);
          // Retry: try with cairosvg as fallback for SVG→PNG conversion
          try {
            const { execFile } = await import('child_process');
            const tmpSvgPath = `/tmp/svg-trace-${uid}.svg`;
            const tmpPngPath = `/tmp/svg-trace-${uid}-preview.png`;
            const fs = await import('fs/promises');
            await fs.writeFile(tmpSvgPath, svgContent);
            await new Promise<void>((resolve, reject) => {
              execFile('cairosvg', [tmpSvgPath, '-o', tmpPngPath, '--output-width', String(Math.min(imgW, 2048)), '--output-height', String(Math.min(imgH, 2048))], { timeout: 30000 }, (err) => {
                if (err) reject(err); else resolve();
              });
            });
            const pngBuffer = await fs.readFile(tmpPngPath);
            const pngFilename = `svg-color-${uid}-preview.png`;
            const pngSaveResult = await saveResult(pngBuffer, pngFilename, 'svg-trace', 'image/png');
            pngServerUrl = pngSaveResult.url;
            pngPreviewUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            // Cleanup temp files
            fs.unlink(tmpSvgPath).catch(() => {});
            fs.unlink(tmpPngPath).catch(() => {});
            console.log('[svg-trace] PNG preview generated via cairosvg fallback');
          } catch (retryErr) {
            console.warn('[svg-trace] PNG preview generation failed (cairosvg fallback):', (retryErr as Error).message);
          }
        }

        const pathCount = (svgContent.match(/<path/g) || []).length;
        const groupCount = (svgContent.match(/<g\b/g) || []).length;

        return NextResponse.json({
          success: true,
          mode: 'color',
          engine: usedEngine,
          engineFallbackWarning: pipelineFallbackWarning,
          url,
          // 优先返回PNG服务器URL(最可靠), 其次PNG data URL, 最后SVG服务器URL
          dataUrl: pngServerUrl || pngPreviewUrl || url,
          ...(svgDataUrl.length < 200000 ? { svgDataUrl } : {}),
          isSvgPreview: !!(pngServerUrl || pngPreviewUrl),
          stats: {
            svgSize: Buffer.byteLength(svgContent, 'utf-8'),
            pathCount,
            groupCount,
            preset: body.qualityPreset || 'balanced',
            hierarchical: vtracerParams.hierarchical,
            curveMode: vtracerParams.curveMode,
          },
        });
      }

      // ─── 黑白描摹：ImageMagick + Potrace + Illustrator清洗 ───
      case 'bw': {
        // 获取原始图片尺寸用于 SVG 标准化
        let bwImgW = 0, bwImgH = 0;
        try {
          const sharp = require('sharp');
          const meta = await sharp(inputBuffer).metadata();
          bwImgW = meta.width || 0;
          bwImgH = meta.height || 0;
        } catch { /* ignore metadata errors */ }

        let svgContent = await runPotrace(inputBuffer, {
          threshold: body.threshold,
          turdSize: body.turdSize,
          alphaMax: body.alphaMax,
          optCurve: body.optCurve,
          optCurveVal: body.optCurveVal,
          invert: body.invert,
        });

        // 专业后处理（SVGO路径优化+曲线平滑）
        svgContent = await postProcessSvg(svgContent);

        // 标准化 SVG（统一 viewBox / width / height）
        svgContent = normalizeVectorSvg(svgContent, bwImgW, bwImgH);

        // 路径数质量控制
        let bwPathCount = (svgContent.match(/<path/g) || []).length;
        if (bwPathCount === 0) {
          return NextResponse.json({
            success: false,
            error: '没有检测到可转换的 SVG 路径，该素材不适合黑白描摹',
          });
        }

        // Soft limit: try aggressive simplification first
        const BW_SOFT_LIMIT = 4000;
        const BW_HARD_LIMIT = 8000;
        if (bwPathCount > BW_SOFT_LIMIT && !body.forceSvg) {
          console.log(`[svg-trace] BW path count ${bwPathCount} > soft limit ${BW_SOFT_LIMIT}, applying aggressive simplification...`);
          svgContent = await aggressivelySimplifyPaths(svgContent);
          svgContent = normalizeVectorSvg(svgContent, bwImgW, bwImgH);
          bwPathCount = (svgContent.match(/<path/g) || []).length;
        }

        if (bwPathCount > BW_HARD_LIMIT && !body.forceSvg) {
          return NextResponse.json({
            success: false,
            error: `路径数量过多(${bwPathCount}条)，已尝试自动简化但仍超过${BW_HARD_LIMIT}条上限。该素材更适合保留为 PNG 格式，或在面板中勾选"强制输出SVG"`,
            stats: { pathCount: bwPathCount },
          });
        }
        if (bwPathCount > 700) {
          console.warn(`[svg-trace] BW路径数量较多: ${bwPathCount}条`);
        }

        // Fix any SVG XML errors from path merging before saving
        svgContent = fixSvgXml(svgContent);

        const filename = `svg-bw-${uid}.svg`;
        const { url } = await saveResult(svgContent, filename, 'svg-trace', 'image/svg+xml');

        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        // 生成 PNG 预览图并保存到服务器
        let pngPreviewUrl: string | undefined;
        let pngServerUrl: string | undefined;
        try {
          const pngBuffer = await sharp(Buffer.from(svgContent))
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .png({ quality: 90 })
            .toBuffer();
          const pngFilename = `svg-bw-${uid}-preview.png`;
          const pngSaveResult = await saveResult(pngBuffer, pngFilename, 'svg-trace', 'image/png');
          pngServerUrl = pngSaveResult.url;
          const pngBase64 = pngBuffer.toString('base64');
          pngPreviewUrl = `data:image/png;base64,${pngBase64}`;
        } catch (pngErr) {
          console.warn('[svg-trace] BW PNG preview generation failed (attempt 1):', (pngErr as Error).message);
          // Retry with cairosvg
          try {
            const { execFile } = await import('child_process');
            const tmpSvgPath = `/tmp/svg-bw-${uid}.svg`;
            const tmpPngPath = `/tmp/svg-bw-${uid}-preview.png`;
            const fs = await import('fs/promises');
            await fs.writeFile(tmpSvgPath, svgContent);
            await new Promise<void>((resolve, reject) => {
              execFile('cairosvg', [tmpSvgPath, '-o', tmpPngPath, '--output-width', String(Math.min(bwImgW || 2048, 2048)), '--output-height', String(Math.min(bwImgH || 2048, 2048))], { timeout: 30000 }, (err) => {
                if (err) reject(err); else resolve();
              });
            });
            const pngBuffer = await fs.readFile(tmpPngPath);
            const pngFilename = `svg-bw-${uid}-preview.png`;
            const pngSaveResult = await saveResult(pngBuffer, pngFilename, 'svg-trace', 'image/png');
            pngServerUrl = pngSaveResult.url;
            pngPreviewUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            fs.unlink(tmpSvgPath).catch(() => {});
            fs.unlink(tmpPngPath).catch(() => {});
            console.log('[svg-trace] BW PNG preview generated via cairosvg fallback');
          } catch (retryErr) {
            console.warn('[svg-trace] BW PNG preview generation failed (cairosvg fallback):', (retryErr as Error).message);
          }
        }

        return NextResponse.json({
          success: true,
          mode: 'bw',
          engine: 'potrace',
          url,
          dataUrl: pngServerUrl || pngPreviewUrl || url,
          ...(svgDataUrl.length < 200000 ? { svgDataUrl } : {}),
          isSvgPreview: !!(pngServerUrl || pngPreviewUrl),
          stats: {
            svgSize: Buffer.byteLength(svgContent, 'utf-8'),
            pathCount: (svgContent.match(/<path/g) || []).length,
          },
        });
      }

      // ─── 切割模式：适合激光切割的封闭路径 ───
      // Optimized for laser cutting: closed paths, no fills, clean outlines
      case 'cutting': {
        let cutImgW = 0, cutImgH = 0;
        try {
          const meta = await sharp(inputBuffer).metadata();
          cutImgW = meta.width || 0;
          cutImgH = meta.height || 0;
        } catch { /* ignore */ }

        // Preprocess: high contrast threshold + edge detection
        const cutPreprocessed = await sharp(inputBuffer)
          .grayscale()
          .normalize()
          .sharpen({ sigma: 1.5 })
          .linear(1.5, -0.25 * 255) // Increase contrast
          .threshold(128, { grayscale: false }) // Binary threshold
          .png()
          .toBuffer();

        let svgContent = await runPotrace(cutPreprocessed, {
          threshold: 128,
          turdSize: 10,   // Remove small specks (important for clean cuts)
          alphaMax: 0,     // Smooth corners
          optCurve: true,
          optCurveVal: 1.0,
          invert: false,
        });

        // Remove fills (laser cutting needs stroke-only paths)
        svgContent = svgContent.replace(/fill="[^"]*"/g, 'fill="none"');
        svgContent = svgContent.replace(/<path/g, '<path stroke="#000" stroke-width="1"');

        // 丹青AI级别后处理（切割模式：路径简化减少切割路径）
        svgContent = simplifySvgPaths(svgContent);

        svgContent = normalizeVectorSvg(svgContent, cutImgW, cutImgH);
        svgContent = fixSvgXml(svgContent);

        const cutPathCount = (svgContent.match(/<path/g) || []).length;
        if (cutPathCount === 0) {
          return NextResponse.json({ success: false, error: '没有检测到可切割的轮廓路径' });
        }

        const cutFilename = `svg-cutting-${uid}.svg`;
        const { url: cutUrl } = await saveResult(svgContent, cutFilename, 'svg-trace', 'image/svg+xml');
        const cutSvgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        let cutPngPreview: string | undefined;
        let cutPngServerUrl: string | undefined;
        try {
          const pngBuf = await sharp(Buffer.from(svgContent))
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .png().toBuffer();
          const cutPngFilename = `svg-cutting-${uid}-preview.png`;
          const cutPngSaveResult = await saveResult(pngBuf, cutPngFilename, 'svg-trace', 'image/png');
          cutPngServerUrl = cutPngSaveResult.url;
          cutPngPreview = `data:image/png;base64,${pngBuf.toString('base64')}`;
        } catch (e) { console.warn('[svg-trace] Cutting PNG preview failed:', (e as Error).message); }

        return NextResponse.json({
          success: true,
          mode: 'cutting',
          engine: 'potrace',
          url: cutUrl,
          dataUrl: cutPngServerUrl || cutPngPreview || cutUrl,
          ...(cutSvgDataUrl && cutSvgDataUrl.length < 200000 ? { svgDataUrl: cutSvgDataUrl } : {}),
          isSvgPreview: !!(cutPngServerUrl || cutPngPreview),
          stats: { svgSize: Buffer.byteLength(svgContent, 'utf-8'), pathCount: cutPathCount },
        });
      }

      // ─── 雕刻模式：适合激光雕刻的细线轮廓 ───
      // Optimized for laser engraving: thin lines, detail preservation
      case 'engraving': {
        let engImgW = 0, engImgH = 0;
        try {
          const meta = await sharp(inputBuffer).metadata();
          engImgW = meta.width || 0;
          engImgH = meta.height || 0;
        } catch { /* ignore */ }

        // Preprocess: edge detection + contrast enhancement for fine lines
        const engPreprocessed = await sharp(inputBuffer)
          .grayscale()
          .normalize()
          .sharpen({ sigma: 2.0 })
          .linear(1.8, -0.4 * 255) // Strong contrast for fine line detection
          .threshold(100, { grayscale: false }) // Lower threshold captures more detail
          .png()
          .toBuffer();

        let svgContent = await runPotrace(engPreprocessed, {
          threshold: 100,
          turdSize: 2,    // Keep tiny details for engraving
          alphaMax: 1.0,   // Preserve sharp corners for fine detail
          optCurve: true,
          optCurveVal: 0.5, // Less aggressive optimization to keep detail
          invert: false,
        });

        // 丹青AI级别后处理（雕刻模式：路径简化）
        svgContent = simplifySvgPaths(svgContent);

        svgContent = normalizeVectorSvg(svgContent, engImgW, engImgH);
        svgContent = fixSvgXml(svgContent);
        const engPathCount = (svgContent.match(/<path/g) || []).length;
        if (engPathCount === 0) {
          return NextResponse.json({ success: false, error: '没有检测到可雕刻的轮廓路径' });
        }

        const engFilename = `svg-engraving-${uid}.svg`;
        const { url: engUrl } = await saveResult(svgContent, engFilename, 'svg-trace', 'image/svg+xml');
        const engSvgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        let engPngPreview: string | undefined;
        let engPngServerUrl: string | undefined;
        try {
          const pngBuf = await sharp(Buffer.from(svgContent))
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .png().toBuffer();
          const engPngFilename = `svg-engraving-${uid}-preview.png`;
          const engPngSaveResult = await saveResult(pngBuf, engPngFilename, 'svg-trace', 'image/png');
          engPngServerUrl = engPngSaveResult.url;
          engPngPreview = `data:image/png;base64,${pngBuf.toString('base64')}`;
        } catch (e) { console.warn('[svg-trace] Engraving PNG preview failed:', (e as Error).message); }

        return NextResponse.json({
          success: true,
          mode: 'engraving',
          engine: 'potrace',
          url: engUrl,
          dataUrl: engPngServerUrl || engPngPreview || engUrl,
          ...(engSvgDataUrl && engSvgDataUrl.length < 200000 ? { svgDataUrl: engSvgDataUrl } : {}),
          isSvgPreview: !!(engPngServerUrl || engPngPreview),
          stats: { svgSize: Buffer.byteLength(svgContent, 'utf-8'), pathCount: engPathCount },
        });
      }

      // ─── 线稿模式：提取线条轮廓，纯线条SVG ───
      // Like bw but optimized for line art / sketches
      case 'lineart': {
        let laImgW = 0, laImgH = 0;
        try {
          const meta = await sharp(inputBuffer).metadata();
          laImgW = meta.width || 0;
          laImgH = meta.height || 0;
        } catch { /* ignore */ }

        // Preprocess: adaptive threshold for line art (handles varying brightness)
        const laPreprocessed = await sharp(inputBuffer)
          .grayscale()
          .normalise()
          .sharpen({ sigma: 1.0 })
          .linear(1.3, -0.15 * 255) // Moderate contrast
          .png()
          .toBuffer();

        let svgContent = await runPotrace(laPreprocessed, {
          threshold: body.threshold, // User can override
          turdSize: body.turdSize ?? 5,
          alphaMax: body.alphaMax ?? 1.0, // Keep corners for line art
          optCurve: body.optCurve ?? true,
          optCurveVal: body.optCurveVal ?? 0.8,
          invert: body.invert ?? false,
        });

        // 丹青AI级别后处理（线稿模式：路径简化）
        svgContent = simplifySvgPaths(svgContent);

        svgContent = normalizeVectorSvg(svgContent, laImgW, laImgH);
        svgContent = fixSvgXml(svgContent);

        const laPathCount = (svgContent.match(/<path/g) || []).length;
        if (laPathCount === 0) {
          return NextResponse.json({ success: false, error: '没有检测到线条路径' });
        }

        const laFilename = `svg-lineart-${uid}.svg`;
        const { url: laUrl } = await saveResult(svgContent, laFilename, 'svg-trace', 'image/svg+xml');
        const laSvgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        let laPngPreview: string | undefined;
        let laPngServerUrl: string | undefined;
        try {
          const pngBuf = await sharp(Buffer.from(svgContent))
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .png().toBuffer();
          const laPngFilename = `svg-lineart-${uid}-preview.png`;
          const laPngSaveResult = await saveResult(pngBuf, laPngFilename, 'svg-trace', 'image/png');
          laPngServerUrl = laPngSaveResult.url;
          laPngPreview = `data:image/png;base64,${pngBuf.toString('base64')}`;
        } catch (e) { console.warn('[svg-trace] Lineart PNG preview failed:', (e as Error).message); }

        return NextResponse.json({
          success: true,
          mode: 'lineart',
          engine: 'potrace',
          url: laUrl,
          dataUrl: laPngServerUrl || laPngPreview || laUrl,
          ...(laSvgDataUrl && laSvgDataUrl.length < 200000 ? { svgDataUrl: laSvgDataUrl } : {}),
          isSvgPreview: !!(laPngServerUrl || laPngPreview),
          stats: { svgSize: Buffer.byteLength(svgContent, 'utf-8'), pathCount: laPathCount },
        });
      }

      // ─── 图片压缩：Sharp ───
      case 'compress': {
        const result = await compressImage(inputBuffer, {
          quality: body.quality,
          format: body.compressFormat,
        });

        const ext = result.format === 'jpeg' ? 'jpg' : result.format;
        const filename = `compressed-${uid}.${ext}`;
        const { url } = await saveResult(result.buffer, filename, 'svg-trace', result.mimeType);

        const base64 = result.buffer.toString('base64');
        const dataUrl = `data:${result.mimeType};base64,${base64}`;

        const originalSize = inputBuffer.length;
        const savedBytes = originalSize - result.size;
        const savedPercent = Math.round((savedBytes / originalSize) * 100);

        return NextResponse.json({
          success: true,
          mode: 'compress',
          engine: 'sharp',
          url,
          dataUrl,
          stats: {
            originalSize,
            compressedSize: result.size,
            savedBytes: Math.max(0, savedBytes),
            savedPercent: Math.max(0, savedPercent),
            format: result.format,
            width: result.width,
            height: result.height,
          },
        });
      }

      // ─── 缩略图生成：Sharp ───
      case 'thumbnail': {
        const result = await generateThumbnail(inputBuffer, {
          width: body.thumbnailWidth,
          height: body.thumbnailHeight,
          fit: body.thumbnailFit,
        });

        const filename = `thumb-${uid}.webp`;
        const { url } = await saveResult(result.buffer, filename, 'svg-trace', 'image/webp');

        const base64 = result.buffer.toString('base64');
        const dataUrl = `data:image/webp;base64,${base64}`;

        return NextResponse.json({
          success: true,
          mode: 'thumbnail',
          engine: 'sharp',
          url,
          dataUrl,
          stats: {
            width: result.width,
            height: result.height,
            size: result.size,
          },
        });
      }

      default:
        return NextResponse.json({ success: false, error: `不支持的模式: ${mode}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[svg-trace] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
