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

// ─── Types ──────────────────────────────────────────────

type TraceMode = 'color' | 'bw' | 'cutting' | 'engraving' | 'lineart' | 'compress' | 'thumbnail';
type VtracerHierarchical = 'stacked' | 'cutout';
type VtracerCurveMode = 'polygon' | 'spline';
type QualityPreset = 'fast' | 'balanced' | 'high' | 'max' | 'print';

interface TraceRequest {
  imageUrl: string;
  mode: TraceMode;
  // Quality preset (overrides individual params with optimal defaults)
  qualityPreset?: QualityPreset;
  // Color vectorization params (VTracer)
  colorPrecision?: number;       // 2-12, default depends on preset
  filterSpeckle?: number;        // 0-20, default depends on preset
  cornerThreshold?: number;      // 0-10, default 1
  lengthThreshold?: number;      // 1-20, default depends on preset
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
  fast: {
    colorPrecision: 7,        // 128色: 快速同时保留主要色彩（丹青AI均衡策略）
    filterSpeckle: 8,         // 适度去噪，保留细节
    cornerThreshold: 1,
    lengthThreshold: 8,
    spliceThreshold: 45,
    pathPrecision: 4,
    hierarchical: 'cutout',   // cutout: 精确裁切，边缘更干净（丹青AI同款策略）
    curveMode: 'spline',      // spline: 贝塞尔曲线比 polygon 直边更平滑
    layerDifference: 14,
    maxIterations: 2,
  },
  balanced: {
    colorPrecision: 8,          // 256色: vtracer最大支持值，配合预处理实现更高质量
    filterSpeckle: 4,           // 保留更多细节
    cornerThreshold: 1,
    lengthThreshold: 4,
    spliceThreshold: 45,
    pathPrecision: 6,
    hierarchical: 'cutout',     // cutout: 精确裁切模式，边缘更干净（丹青AI同款策略）
    curveMode: 'spline',
    layerDifference: 8,
    maxIterations: 4,
  },
  high: {
    colorPrecision: 8,          // 256色: vtracer最大值 + 预处理深度量化实现高保真
    filterSpeckle: 2,
    cornerThreshold: 1,
    lengthThreshold: 3,
    spliceThreshold: 45,
    pathPrecision: 8,
    hierarchical: 'cutout',     // cutout: 精确裁切，边缘无锯齿
    curveMode: 'spline',
    layerDifference: 4,
    maxIterations: 6,
  },
  max: {
    colorPrecision: 8,          // 256色: vtracer最大值 + 最精细预处理实现极致还原
    filterSpeckle: 1,
    cornerThreshold: 1,
    lengthThreshold: 2,
    spliceThreshold: 45,
    pathPrecision: 10,
    hierarchical: 'cutout',
    curveMode: 'spline',
    layerDifference: 2,
    maxIterations: 10,
  },
  print: {
    colorPrecision: 8,          // 256色: vtracer最大值 + 印刷级预处理
    filterSpeckle: 1,           // 保留所有细节，印刷不允许丢失
    cornerThreshold: 0.5,       // 更锐利的角落
    lengthThreshold: 2,
    spliceThreshold: 30,        // 更精细的路径拼接
    pathPrecision: 10,          // 最高坐标精度
    hierarchical: 'cutout',     // cutout: 印刷需要精确边缘
    curveMode: 'spline',
    layerDifference: 2,         // 最小层差，保留最多色彩层
    maxIterations: 12,
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
    lengthThreshold: body.lengthThreshold ?? base.lengthThreshold,
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

  // Adaptive max size: high quality presets can handle larger inputs
  const maxSize = params.colorPrecision >= 8 ? 4096 : 3072;

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

  // Step 3: Denoise pipeline — median filter + light blur
  // Median filter removes salt-and-pepper noise and small artifacts.
  // Light gaussian blur smooths color gradients for cleaner quantization.
  // Reference: Figma-design sharp median(1) + blur(0.18)
  pipeline = pipeline.median(1).blur(0.3);

  // Step 4: Smart color quantization preprocessing (inspired by Danqing AI)
  // This dramatically improves SVG quality by giving VTracer cleaner, fewer colors
  //
  // Key insight: VTracer's internal quantizer treats every pixel independently,
  // causing color noise in photos. Sharp's palette quantizer produces clean,
  // well-dithered colors that VTracer can trace precisely.
  //
  // 丹青AI关键技巧：先让sharp预量化到VTracer色彩预算的70%，
  // 这样VTracer专注于路径生成而非颜色决策，SVG更干净
  // VTracer max color_precision=8 (256 colors)
  const vtracerMaxColors = Math.pow(2, Math.min(8, params.colorPrecision));
  const targetColors = Math.max(16, Math.round(vtracerMaxColors * 0.7));

  // sharp调色板量化 — 比VTracer内部量化器更干净
  pipeline = pipeline.png({
    quality: 100,
    compressionLevel: 0,
    palette: true,
    colors: targetColors,
    effort: params.colorPrecision >= 8 ? 10 : 7,  // 高精度预设用最大努力
    dither: params.colorPrecision >= 8 ? 0.6 : 0.9,  // 高精度低抖动，低精度高抖动
  });

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

    // Scale timeout with quality: max preset may take much longer
    const timeout = params.colorPrecision >= 8 ? 300000 : 120000;

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
  // VTracer uses translate on each <path> for stacking; Illustrator sometimes fails to parse these.
  // We inline the translation directly into path data so no transform remains.
  svg = svg.replace(/<path\s+([^>]*)\/>/g, (_match: string, attrs: string) => {
    const transformMatch = attrs.match(/transform="translate\(([^,]+),([^)]+)\)"/);
    if (!transformMatch) return _match; // no transform, keep as-is

    const tx = parseFloat(transformMatch[1]);
    const ty = parseFloat(transformMatch[2]);
    if (Number.isNaN(tx) || Number.isNaN(ty) || (tx === 0 && ty === 0)) {
      // Zero or invalid transform, just remove the attribute
      const cleanAttrs = attrs.replace(/\s*transform="translate\([^)]+\)"/, '');
      return `<path ${cleanAttrs}/>`;
    }

    // Bake translate into the d attribute coordinates
    const dMatch = attrs.match(/d="([^"]+)"/);
    if (!dMatch) return _match; // no d attribute, keep as-is

    const newD = bakeTranslateIntoPath(dMatch[1], tx, ty);
    const cleanAttrs = attrs
      .replace(/d="[^"]+"/, `d="${newD}"`)
      .replace(/\s*transform="translate\([^)]+\)"/, '');

    return `<path ${cleanAttrs}/>`;
  });

  // ─── Convert style="fill:#xxx" to fill="#xxx" (Illustrator prefers presentation attributes) ───
  svg = convertStyleToPresentationAttrs(svg);

  // ─── Group paths by fill color for better AI layer organization ───
  svg = groupPathsByFill(svg);

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
  let lastIndex = 0;

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
  let groupIdx = 0;
  let insertOffset = 0;
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

  let pipeline = sharp(inputBuffer);
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


async function tryDesignVectorizeFallback(req: NextRequest, imageUrl: string, mode: TraceMode): Promise<NextResponse | null> {
  try {
    const fallbackMode = mode === 'bw' ? 'line-art' : 'logo';
    const res = await fetch(getInternalApiUrl('/api/design/vectorize'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') || '' },
      body: JSON.stringify({ imageUrl, mode: fallbackMode, layerId: `svg-trace-${Date.now()}` }),
      signal: AbortSignal.timeout(90000),
    });
    const data = await res.json().catch(() => null) as { success?: boolean; svg?: string; engine?: string; error?: string } | null;
    if (!res.ok || !data?.success || !data.svg) return null;

    let svgContent = sanitizeSvgForIllustrator(String(data.svg));
    // AI 生成 SVG 安全过滤
    const safetyResult = sanitizeAIGeneratedSvg(svgContent);
    if (!safetyResult.safe) {
      console.warn('[svg-trace] AI SVG 安全过滤拒绝:', safetyResult.reason);
      return null;
    }
    svgContent = safetyResult.sanitized || svgContent;
    // SVG 标准化
    svgContent = normalizeVectorSvg(svgContent, 0, 0);
    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
    let pngPreviewUrl: string | undefined;
    try {
      const pngBuffer = await sharp(Buffer.from(svgContent)).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).png({ quality: 90 }).toBuffer();
      pngPreviewUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    } catch {}
    return NextResponse.json({
      success: true,
      mode,
      engine: data.engine || 'design-vectorize-fallback',
      svg: svgContent,
      dataUrl: pngPreviewUrl || svgDataUrl,
      svgDataUrl,
      isSvgPreview: !!pngPreviewUrl,
      fallback: true,
      stats: { svgSize: Buffer.byteLength(svgContent, 'utf-8'), pathCount: (svgContent.match(/<path/g) || []).length },
    });
  } catch (e) {
    console.warn('[svg-trace] design/vectorize fallback failed:', e instanceof Error ? e.message : String(e));
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

    // Pre-check tool availability for trace modes
    if (mode === 'color') {
      const vtracerCheck = await new Promise<boolean>((resolve) => {
        execFile(PYTHON_BIN, ['-c', 'import vtracer'], { timeout: 5000 }, (error) => {
          resolve(!error);
        });
      });
      if (!vtracerCheck) {
        const fallback = await tryDesignVectorizeFallback(req, imageUrl, mode);
        if (fallback) return fallback;
        return NextResponse.json({
          success: false,
          error: 'VTracer 未安装，且AI矢量化兜底不可用。请安装: pip3 install vtracer，或在管理员系统配置可视觉理解的LLM/矢量模型。',
        }, { status: 503 });
      }
    } else if (mode === 'bw' || mode === 'cutting' || mode === 'engraving' || mode === 'lineart') {
      const potraceCheck = await new Promise<boolean>((resolve) => {
        execFile('which', ['potrace'], { timeout: 5000 }, (error) => {
          resolve(!error);
        });
      });
      if (!potraceCheck) {
        const fallback = await tryDesignVectorizeFallback(req, imageUrl, mode);
        if (fallback) return fallback;
        return NextResponse.json({
          success: false,
          error: 'Potrace 未安装，且AI矢量化兜底不可用。请安装: apt-get install potrace，或在管理员系统配置可视觉理解的LLM/矢量模型。',
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
      // ─── 彩色矢量化：Sharp预处理 + VTracer + Illustrator清洗 ───
      case 'color': {
        const vtracerParams = resolveVtracerParams(body);

        // Preprocess image for optimal VTracer input
        const { buffer: preprocessed, width: imgW, height: imgH } = await preprocessForVTracer(
          inputBuffer,
          vtracerParams,
        );

        let svgContent = await runVTracer(preprocessed, vtracerParams);

        // Sanitize SVG for Adobe Illustrator compatibility
        svgContent = sanitizeSvgForIllustrator(svgContent, imgW, imgH);

        // 温和颜色合并：仅合并视觉上无法区分的近色
        svgContent = mergeSvgColors(svgContent);

        // 标准化 SVG（统一 viewBox / width / height）
        svgContent = normalizeVectorSvg(svgContent, imgW, imgH);

        // 路径数质量控制：过多路径建议保留 PNG
        const pathCountCheck = (svgContent.match(/<path/g) || []).length;
        if (pathCountCheck === 0) {
          return NextResponse.json({
            success: false,
            error: '没有检测到可转换的 SVG 路径，该素材不适合矢量化',
          });
        }
        if (pathCountCheck > 3000) {
          return NextResponse.json({
            success: false,
            error: `路径数量过多(${pathCountCheck}条)，该素材更适合保留为 PNG 格式`,
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
        let pngPreviewUrl: string | undefined;
        try {
          const sharp = require('sharp');
          const pngBuffer = await sharp(Buffer.from(svgContent))
            .resize(Math.min(imgW, 2048), Math.min(imgH, 2048), { fit: 'inside', withoutEnlargement: true })
            .png({ quality: 90 })
            .toBuffer();
          const pngBase64 = pngBuffer.toString('base64');
          pngPreviewUrl = `data:image/png;base64,${pngBase64}`;
        } catch (pngErr) {
          console.warn('[svg-trace] PNG preview generation failed, falling back to SVG dataUrl:', pngErr);
        }

        const pathCount = (svgContent.match(/<path/g) || []).length;
        const groupCount = (svgContent.match(/<g\b/g) || []).length;

        return NextResponse.json({
          success: true,
          mode: 'color',
          engine: 'vtracer',
          svg: svgContent,
          url,
          dataUrl: pngPreviewUrl || svgDataUrl,
          svgDataUrl,
          isSvgPreview: !!pngPreviewUrl,
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

        // 标准化 SVG（统一 viewBox / width / height）
        svgContent = normalizeVectorSvg(svgContent, bwImgW, bwImgH);

        // 路径数质量控制
        const bwPathCount = (svgContent.match(/<path/g) || []).length;
        if (bwPathCount === 0) {
          return NextResponse.json({
            success: false,
            error: '没有检测到可转换的 SVG 路径，该素材不适合黑白描摹',
          });
        }
        if (bwPathCount > 2000) {
          return NextResponse.json({
            success: false,
            error: `路径数量过多(${bwPathCount}条)，该素材更适合保留为 PNG 格式`,
            stats: { pathCount: bwPathCount },
          });
        }
        if (bwPathCount > 700) {
          console.warn(`[svg-trace] BW路径数量较多: ${bwPathCount}条`);
        }

        const filename = `svg-bw-${uid}.svg`;
        const { url } = await saveResult(svgContent, filename, 'svg-trace', 'image/svg+xml');

        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        // 生成 PNG 预览图
        let pngPreviewUrl: string | undefined;
        try {
          const sharp = require('sharp');
          const pngBuffer = await sharp(Buffer.from(svgContent))
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .png({ quality: 90 })
            .toBuffer();
          const pngBase64 = pngBuffer.toString('base64');
          pngPreviewUrl = `data:image/png;base64,${pngBase64}`;
        } catch (pngErr) {
          console.warn('[svg-trace] BW PNG preview generation failed:', pngErr);
        }

        return NextResponse.json({
          success: true,
          mode: 'bw',
          engine: 'potrace',
          svg: svgContent,
          url,
          dataUrl: pngPreviewUrl || svgDataUrl,
          svgDataUrl,
          isSvgPreview: !!pngPreviewUrl,
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

        svgContent = normalizeVectorSvg(svgContent, cutImgW, cutImgH);

        const cutPathCount = (svgContent.match(/<path/g) || []).length;
        if (cutPathCount === 0) {
          return NextResponse.json({ success: false, error: '没有检测到可切割的轮廓路径' });
        }

        const cutFilename = `svg-cutting-${uid}.svg`;
        const { url: cutUrl } = await saveResult(svgContent, cutFilename, 'svg-trace', 'image/svg+xml');
        const cutSvgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        let cutPngPreview: string | undefined;
        try {
          const pngBuf = await sharp(Buffer.from(svgContent))
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .png().toBuffer();
          cutPngPreview = `data:image/png;base64,${pngBuf.toString('base64')}`;
        } catch {}

        return NextResponse.json({
          success: true,
          mode: 'cutting',
          engine: 'potrace',
          svg: svgContent,
          url: cutUrl,
          dataUrl: cutPngPreview || cutSvgDataUrl,
          svgDataUrl: cutSvgDataUrl,
          isSvgPreview: !!cutPngPreview,
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

        svgContent = normalizeVectorSvg(svgContent, engImgW, engImgH);

        const engPathCount = (svgContent.match(/<path/g) || []).length;
        if (engPathCount === 0) {
          return NextResponse.json({ success: false, error: '没有检测到可雕刻的轮廓路径' });
        }

        const engFilename = `svg-engraving-${uid}.svg`;
        const { url: engUrl } = await saveResult(svgContent, engFilename, 'svg-trace', 'image/svg+xml');
        const engSvgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        let engPngPreview: string | undefined;
        try {
          const pngBuf = await sharp(Buffer.from(svgContent))
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .png().toBuffer();
          engPngPreview = `data:image/png;base64,${pngBuf.toString('base64')}`;
        } catch {}

        return NextResponse.json({
          success: true,
          mode: 'engraving',
          engine: 'potrace',
          svg: svgContent,
          url: engUrl,
          dataUrl: engPngPreview || engSvgDataUrl,
          svgDataUrl: engSvgDataUrl,
          isSvgPreview: !!engPngPreview,
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

        svgContent = normalizeVectorSvg(svgContent, laImgW, laImgH);

        const laPathCount = (svgContent.match(/<path/g) || []).length;
        if (laPathCount === 0) {
          return NextResponse.json({ success: false, error: '没有检测到线条路径' });
        }

        const laFilename = `svg-lineart-${uid}.svg`;
        const { url: laUrl } = await saveResult(svgContent, laFilename, 'svg-trace', 'image/svg+xml');
        const laSvgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        let laPngPreview: string | undefined;
        try {
          const pngBuf = await sharp(Buffer.from(svgContent))
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .png().toBuffer();
          laPngPreview = `data:image/png;base64,${pngBuf.toString('base64')}`;
        } catch {}

        return NextResponse.json({
          success: true,
          mode: 'lineart',
          engine: 'potrace',
          svg: svgContent,
          url: laUrl,
          dataUrl: laPngPreview || laSvgDataUrl,
          svgDataUrl: laSvgDataUrl,
          isSvgPreview: !!laPngPreview,
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
