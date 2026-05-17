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

interface TraceRequest {
  imageUrl: string;
  mode: TraceMode;
  // Color vectorization params (VTracer)
  colorPrecision?: number;    // 1-10, default 6
  filterSpeckle?: number;     // 1-20, default 4
  cornerThreshold?: number;   // 0-10, default 1
  lengthThreshold?: number;   // 1-20, default 4
  spliceThreshold?: number;   // 0-90, default 45
  pathPrecision?: number;     // 1-8, default 3
  // B&W trace params (Potrace)
  threshold?: number;         // 0-100, default 50
  turdSize?: number;          // 1-100, default 2
  alphaMax?: number;          // 0-1.334, default 1
  optCurve?: boolean;         // default true
  // Compress params
  quality?: number;           // 1-100, default 80
  compressFormat?: 'jpeg' | 'webp' | 'png'; // default webp
  // Thumbnail params
  thumbnailWidth?: number;    // default 200
  thumbnailHeight?: number;   // default 200
  thumbnailFit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'; // default cover
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

// ─── VTracer (Color Vectorization) via Python ──────────

async function runVTracer(
  inputBuffer: Buffer,
  params: {
    colorPrecision?: number;
    filterSpeckle?: number;
    cornerThreshold?: number;
    lengthThreshold?: number;
    spliceThreshold?: number;
    pathPrecision?: number;
  }
): Promise<string> {
  const tmpDir = path.join(getServerDataRoot(), 'svg-trace-tmp');
  if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });

  const uid = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const inputPath = path.join(tmpDir, `input-${uid}.png`);
  const outputPath = path.join(tmpDir, `output-${uid}.svg`);

  try {
    // Ensure input is PNG (sharp can convert any format)
    await sharp(inputBuffer).png().toFile(inputPath);

    const args = [
      '-c',
      [
        'import vtracer, sys\n',
        `vtracer.convert_image_to_svg_py("${inputPath}", "${outputPath}"`,
        `, colormode="color"`,
        `, hierarchical="stacked"`,
        `, mode="polygon"`,
        `, filter_speckle=${params.filterSpeckle || 4}`,
        `, color_precision=${params.colorPrecision || 6}`,
        `, corner_threshold=${params.cornerThreshold || 1}`,
        `, length_threshold=${params.lengthThreshold || 4}`,
        `, splice_threshold=${params.spliceThreshold || 45}`,
        `, path_precision=${params.pathPrecision || 3}`,
        ')',
      ].join(''),
    ];

    await new Promise<void>((resolve, reject) => {
      execFile('python3', args, { timeout: 120000 }, (error, stdout, stderr) => {
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
    // Cleanup temp files
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
  }
): Promise<string> {
  const tmpDir = path.join(getServerDataRoot(), 'svg-trace-tmp');
  if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });

  const uid = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const inputPath = path.join(tmpDir, `bw-input-${uid}.png`);
  const pbmPath = path.join(tmpDir, `bw-mono-${uid}.pbm`);
  const outputPath = path.join(tmpDir, `bw-output-${uid}.svg`);

  try {
    // Step 1: Sharp resize if too large (Potrace handles max ~4096 well)
    let pipeline = sharp(inputBuffer);
    const metadata = await sharp(inputBuffer).metadata();
    if (metadata.width && metadata.width > 4096) {
      pipeline = pipeline.resize(4096, null, { withoutEnlargement: true });
    }
    await pipeline.png().toFile(inputPath);

    // Step 2: ImageMagick → threshold + monochrome PBM
    const threshold = params.threshold ?? 50;
    await new Promise<void>((resolve, reject) => {
      execFile('convert', [
        inputPath,
        '-threshold', `${threshold}%`,
        '-monochrome',
        pbmPath,
      ], { timeout: 60000 }, (error, _stdout, stderr) => {
        if (error) {
          console.error('[svg-trace] ImageMagick error:', stderr || error.message);
          reject(new Error(`ImageMagick failed: ${stderr || error.message}`));
        } else {
          resolve();
        }
      });
    });

    // Step 3: Potrace → SVG
    const potraceArgs = [
      pbmPath,
      '-s',                           // SVG output
      '-o', outputPath,
      '-t', String(params.turdSize ?? 2),  // suppress speckles
      '-a', String(params.alphaMax ?? 1),  // corner threshold
    ];
    if (params.optCurve !== false) {
      potraceArgs.push('-O', String(params.optCurveVal ?? 2));  // optimize bezier curves
    } else {
      potraceArgs.push('-n');  // no curve optimization
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

    // Potrace outputs SVG with pt units and no viewBox — fix for proper scaling
    svgContent = normalizePotraceSvg(svgContent);

    return svgContent;
  } finally {
    // Cleanup
    try { await unlink(inputPath); } catch { /* ignore */ }
    try { await unlink(pbmPath); } catch { /* ignore */ }
    try { await unlink(outputPath); } catch { /* ignore */ }
  }
}

/**
 * Potrace SVG output uses pt units and may lack viewBox.
 * Normalize to use viewBox + width/height in px for web compatibility.
 */
function normalizePotraceSvg(svg: string): string {
  // Extract width/height from pt values
  const widthMatch = svg.match(/width="([\d.]+)pt"/);
  const heightMatch = svg.match(/height="([\d.]+)pt"/);
  if (widthMatch && heightMatch) {
    const w = parseFloat(widthMatch[1]);
    const h = parseFloat(heightMatch[1]);
    svg = svg
      .replace(/width="[\d.]+pt"/, `width="${w}"`)
      .replace(/height="[\d.]+pt"/, `height="${h}"`)
      .replace(/viewBox="0 0 [\d.]+ [\d.]+"/, `viewBox="0 0 ${w} ${h}"`);
  }
  // Remove DOCTYPE (causes issues in browsers)
  svg = svg.replace(/<!DOCTYPE[^>]*>\n?/g, '');
  return svg;
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

  // Save to local storage
  const url = saveImageFile(buffer, filename, subDir);

  // Upload to S3 for persistence
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

    console.log(`[svg-trace] mode=${mode}, imageUrl=${imageUrl.substring(0, 100)}`);

    // Resolve image to buffer
    const inputBuffer = await resolveImageUrl(imageUrl);
    if (!inputBuffer || inputBuffer.length === 0) {
      return NextResponse.json({ success: false, error: '无法获取图片数据' }, { status: 400 });
    }

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const uid = `${timestamp}-${random}`;

    switch (mode) {
      // ─── 彩色矢量化：Sharp预处理 + VTracer ───
      case 'color': {
        // Sharp预处理：调整过大图片、确保格式正确
        let preprocessed: Buffer = inputBuffer;
        const meta = await sharp(inputBuffer).metadata();
        if (meta.width && meta.width > 4096) {
          preprocessed = await sharp(inputBuffer)
            .resize(4096, null, { withoutEnlargement: true })
            .png()
            .toBuffer();
        } else {
          preprocessed = await sharp(inputBuffer).png().toBuffer();
        }

        const svgContent = await runVTracer(preprocessed, {
          colorPrecision: body.colorPrecision,
          filterSpeckle: body.filterSpeckle,
          cornerThreshold: body.cornerThreshold,
          lengthThreshold: body.lengthThreshold,
          spliceThreshold: body.spliceThreshold,
          pathPrecision: body.pathPrecision,
        });

        const filename = `svg-color-${uid}.svg`;
        const { url } = await saveResult(svgContent, filename, 'svg-trace', 'image/svg+xml');

        // Also save as data URL for immediate canvas display
        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;

        return NextResponse.json({
          success: true,
          mode: 'color',
          engine: 'vtracer',
          svg: svgContent,
          url,
          dataUrl: svgDataUrl,
          stats: {
            svgSize: new Blob([svgContent]).size,
            pathCount: (svgContent.match(/<path/g) || []).length,
          },
        });
      }

      // ─── 黑白描摹：ImageMagick + Potrace ───
      case 'bw': {
        const svgContent = await runPotrace(inputBuffer, {
          threshold: body.threshold,
          turdSize: body.turdSize,
          alphaMax: body.alphaMax,
          optCurve: body.optCurve,
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

        // For canvas display, we need a data URL
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
