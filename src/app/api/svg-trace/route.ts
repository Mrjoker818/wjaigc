import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getServerDataRoot, saveImageFile } from '@/lib/server-data-root';
import { uploadImageToS3, isS3Available } from '@/lib/s3-storage';

// ─── Types ──────────────────────────────────────────────

type TraceMode = 'color' | 'bw' | 'compress' | 'thumbnail';
type VtracerHierarchical = 'stacked' | 'cutout';
type VtracerCurveMode = 'polygon' | 'spline';
type QualityPreset = 'fast' | 'balanced' | 'high' | 'max';

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
    colorPrecision: 4,
    filterSpeckle: 8,
    cornerThreshold: 1,
    lengthThreshold: 8,
    spliceThreshold: 45,
    pathPrecision: 2,
    hierarchical: 'stacked',
    curveMode: 'polygon',
    layerDifference: 16,
    maxIterations: 1,
  },
  balanced: {
    colorPrecision: 6,
    filterSpeckle: 4,
    cornerThreshold: 1,
    lengthThreshold: 4,
    spliceThreshold: 45,
    pathPrecision: 5,
    hierarchical: 'stacked',
    curveMode: 'polygon',
    layerDifference: 8,
    maxIterations: 3,
  },
  high: {
    colorPrecision: 8,
    filterSpeckle: 2,
    cornerThreshold: 1,
    lengthThreshold: 2,
    spliceThreshold: 45,
    pathPrecision: 8,
    hierarchical: 'stacked',
    curveMode: 'spline',
    layerDifference: 4,
    maxIterations: 6,
  },
  max: {
    colorPrecision: 10,
    filterSpeckle: 1,
    cornerThreshold: 1,
    lengthThreshold: 1,
    spliceThreshold: 45,
    pathPrecision: 8,
    hierarchical: 'cutout',
    curveMode: 'spline',
    layerDifference: 1,
    maxIterations: 10,
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
      const filePath = path.join(dataRoot, serveUploadMatch[1]);
      if (existsSync(filePath)) {
        return require('fs').readFileSync(filePath);
      }
    }

    // Try public directory
    const publicPath = path.join(workspacePath, 'public', imageUrl);
    if (existsSync(publicPath)) {
      return require('fs').readFileSync(publicPath);
    }

    // Try data root
    const dataPath = path.join(dataRoot, imageUrl.replace(/^\//, ''));
    if (existsSync(dataPath)) {
      return require('fs').readFileSync(dataPath);
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

  // Adaptive max size: high quality presets can handle larger inputs
  const maxSize = params.colorPrecision >= 8 ? 4096 : 3072;

  let pipeline = sharp(inputBuffer);

  // Step 1: Resize if too large (preserve quality, don't enlarge)
  if (srcWidth > maxSize || srcHeight > maxSize) {
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

  // Step 3: For low colorPrecision, pre-quantize with sharp to help VTracer
  // This dramatically reduces output path count for faster/balanced presets
  if (params.colorPrecision <= 5) {
    // Quantize to fewer colors: 2^(colorPrecision*0.8) approximate unique colors
    const numColors = Math.min(256, Math.max(8, Math.round(Math.pow(2, params.colorPrecision * 0.8))));
    pipeline = pipeline.png({
      quality: 100,
      compressionLevel: 0,  // Fast write, we don't need small file
      palette: true,
      colors: numColors,
      effort: 7,
    });
  } else {
    pipeline = pipeline.png({
      quality: 100,
      compressionLevel: 0,
      effort: 1,  // Speed for high quality (VTracer does the real work)
    });
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

    // Scale timeout with quality: max preset may take much longer
    const timeout = params.colorPrecision >= 8 ? 300000 : 120000;

    await new Promise<void>((resolve, reject) => {
      execFile('python3', args, { timeout }, (error, _stdout, stderr) => {
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

    const svgContent = require('fs').readFileSync(outputPath, 'utf-8');
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

    let svgContent = require('fs').readFileSync(outputPath, 'utf-8');

    // Sanitize for Illustrator
    svgContent = sanitizeSvgForIllustrator(svgContent, meta.width, meta.height);

    return svgContent;
  } finally {
    try { await unlink(inputPath); } catch { /* ignore */ }
    try { await unlink(pbmPath); } catch { /* ignore */ }
    try { await unlink(outputPath); } catch { /* ignore */ }
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

// ─── POST handler ──────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: TraceRequest = await req.json();
    const { imageUrl, mode = 'color' } = body;

    if (!imageUrl) {
      return NextResponse.json({ success: false, error: '缺少 imageUrl' }, { status: 400 });
    }

    const validModes: TraceMode[] = ['color', 'bw', 'compress', 'thumbnail'];
    if (!validModes.includes(mode)) {
      return NextResponse.json({ success: false, error: `无效模式: ${mode}，支持: ${validModes.join('/')}` }, { status: 400 });
    }

    console.log(`[svg-trace] mode=${mode}, preset=${body.qualityPreset || 'balanced'}, imageUrl=${imageUrl.substring(0, 100)}`);

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

        const filename = `svg-color-${uid}.svg`;
        const { url } = await saveResult(svgContent, filename, 'svg-trace', 'image/svg+xml');

        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        const pathCount = (svgContent.match(/<path/g) || []).length;
        const groupCount = (svgContent.match(/<g\b/g) || []).length;

        return NextResponse.json({
          success: true,
          mode: 'color',
          engine: 'vtracer',
          svg: svgContent,
          url,
          dataUrl: svgDataUrl,
          stats: {
            svgSize: new Blob([svgContent]).size,
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
        const svgContent = await runPotrace(inputBuffer, {
          threshold: body.threshold,
          turdSize: body.turdSize,
          alphaMax: body.alphaMax,
          optCurve: body.optCurve,
          optCurveVal: body.optCurveVal,
          invert: body.invert,
        });

        const filename = `svg-bw-${uid}.svg`;
        const { url } = await saveResult(svgContent, filename, 'svg-trace', 'image/svg+xml');

        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        return NextResponse.json({
          success: true,
          mode: 'bw',
          engine: 'potrace',
          svg: svgContent,
          url,
          dataUrl: svgDataUrl,
          stats: {
            svgSize: new Blob([svgContent]).size,
            pathCount: (svgContent.match(/<path/g) || []).length,
          },
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
