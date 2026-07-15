// ============================================================
// upscayl.ts — 无损放大引擎
// 引擎: ONNX Real-ESRGAN (Python CPU) → sharp Lanczos3 兜底
// AI 云端放大由 image-edit route / upscale-pro route 独立处理
// ============================================================

import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import sharp from 'sharp';
import { UPSCALE_DEFAULT_SCALE, UPSCALE_TIMEOUT_MS, UPSCALE_OUTPUT_DIR, UPSCALE_OUTPUT_URL_PREFIX, PYTHON_BIN } from './config';

// ---- 目录配置 ----

function getOnnxModelsDir(): string {
  const envDir = process.env.ONNX_MODELS_DIR;
  if (envDir && fs.existsSync(envDir)) return envDir;
  // 优先 /space/onnx-models（持久化目录），再 fallback 到项目内
  if (fs.existsSync('/space/onnx-models') && fs.readdirSync('/space/onnx-models').length > 0) {
    return '/space/onnx-models';
  }
  return path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'onnx-models');
}

function getUpscaleOutputDir(): string {
  return UPSCALE_OUTPUT_DIR;
}

function ensureOutputDirs() {
  const dir = getUpscaleOutputDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateFilename(prefix: string, ext: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}.${ext}`;
}

// ---- 类型定义 ----

export interface UpscaleParams {
  imageUrl: string;
  scale?: number;
  outputFormat?: string;
  compression?: number;
  tileSize?: number;
}

export interface UpscaleResult {
  success: boolean;
  imageUrl?: string;
  originalSize?: { width: number; height: number };
  outputSize?: { width: number; height: number };
  model?: string;
  scale?: number;
  error?: string;
  engine?: string;
}

// ============================================================
// ONNX CPU 放大 (Python onnxruntime + Real-ESRGAN)
// ============================================================

/** 检查 ONNX 放大是否可用（模型文件 + Python + onnxruntime） */
export async function isOnnxUpscaleAvailable(): Promise<{
  available: boolean;
  model?: string;
  error?: string;
}> {
  const modelsDir = getOnnxModelsDir();
  if (!fs.existsSync(modelsDir)) {
    return { available: false, error: 'ONNX 模型目录不存在' };
  }

  // 检查模型文件
  const modelFile = 'realesrgan-x4plus-fp16.onnx';
  if (!fs.existsSync(path.join(modelsDir, modelFile))) {
    // 也尝试不带 fp16 后缀
    const altModel = 'realesrgan-x4plus.onnx';
    if (!fs.existsSync(path.join(modelsDir, altModel))) {
      return { available: false, error: `ONNX 模型文件不存在 (${modelFile})` };
    }
  }

  // 检查 Python + onnxruntime 依赖
  try {
    const result = await new Promise<{ installed: boolean; version?: string }>((resolve) => {
      let settled = false;
      const proc = spawn(PYTHON_BIN, ['-c', 'import onnxruntime; print(onnxruntime.__version__)'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { proc.kill('SIGKILL'); } catch {}
          resolve({ installed: false });
        }
      }, 10000);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', (code: number | null) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (code === 0 && stdout.trim()) {
            resolve({ installed: true, version: stdout.trim() });
          } else {
            resolve({ installed: false });
          }
        }
      });
      proc.on('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ installed: false });
        }
      });
    });

    if (!result.installed) {
      return { available: false, error: 'Python onnxruntime 未安装 (pip install onnxruntime)' };
    }
  } catch {
    return { available: false, error: 'Python 环境不可用' };
  }

  return { available: true, model: 'realesrgan-x4plus-fp16' };
}

/** 获取 upscale_onnx.py 脚本路径 */
function getUpscaleOnnxScriptPath(): string {
  return path.join(
    process.env.COZE_WORKSPACE_PATH || '/workspace/projects',
    'scripts', 'upscale_onnx.py'
  );
}

/** ONNX Python 子进程结果 */
interface OnnxUpscaleResult {
  success: boolean;
  image?: string;        // base64 PNG (小图模式)
  outputFile?: string;   // 输出文件路径 (大图文件模式)
  engine?: string;
  originalSize?: number[];
  outputSize?: number[];
  model?: string;
  elapsed?: number;
  error?: string;
}

/** 动态计算 tileSize：根据图片尺寸和可用内存自适应 */
export function calcOptimalTileSize(width: number, height: number, scale: number): number {
  const pixels = width * height;
  if (pixels > 1024 * 1024) return 128;
  if (pixels >= 512 * 512) return 192;
  if (pixels >= 256 * 256) return 256;
  return Math.min(width, 256);
}

/** 动态计算超时：根据图片尺寸和 tile 数量 */
export function calcTimeoutMs(width: number, height: number, tileSize: number): number {
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const totalTiles = cols * rows;
  const secondsPerTile = tileSize <= 128 ? 5 : tileSize <= 256 ? 8 : 12;
  const estimatedSeconds = totalTiles * secondsPerTile;
  return Math.min(30 * 60 * 1000, Math.max(5 * 60 * 1000, (estimatedSeconds * 2 + 30) * 1000));
}

/**
 * 调用 Python ONNX 子进程执行放大
 * - 小图 (≤512x512): base64 stdin/stdout 传输
 * - 大图 (>512x512): 文件 I/O，避免 base64 膨胀和内存峰值
 */
async function callOnnxUpscale(
  imageBase64: string,
  scale: number,
  tileSize: number,
  model: string,
  inputFile?: string,
  outputFile?: string,
  timeoutMs?: number,
): Promise<OnnxUpscaleResult> {
  const scriptPath = getUpscaleOnnxScriptPath();
  const onnxModelsDir = getOnnxModelsDir();

  const inputObj: Record<string, unknown> = { scale, tileSize, model };

  if (inputFile && fs.existsSync(inputFile)) {
    inputObj.inputFile = inputFile;
    if (outputFile) inputObj.outputFile = outputFile;
  } else {
    inputObj.image = imageBase64;
  }

  const effectiveTimeout = timeoutMs || UPSCALE_TIMEOUT_MS;

  return new Promise((resolve) => {
    const input = JSON.stringify(inputObj);
    const proc = spawn(PYTHON_BIN, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ONNX_MODELS_DIR: onnxModelsDir },
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        if (proc.pid) try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
        resolve({ success: false, error: `ONNX 放大超时 (${Math.round(effectiveTimeout / 1000)}s)` });
      }
    }, effectiveTimeout);

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, error: `Python 脚本启动失败: ${err.message}` });
      }
    });

    proc.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0 && !stdout.trim()) {
        const errMsg = stderr.trim() || `进程退出码 ${code}`;
        console.error(`[upscayl] ONNX script error: ${errMsg}`);
        resolve({ success: false, error: `脚本执行失败: ${errMsg.substring(0, 300)}` });
        return;
      }

      try {
        const result: OnnxUpscaleResult = JSON.parse(stdout.trim());
        if (result.success === undefined) result.success = code === 0;
        resolve(result);
      } catch {
        console.error(`[upscayl] Failed to parse ONNX output: ${stdout.substring(0, 200)}`);
        resolve({ success: false, error: '脚本输出解析失败' });
      }
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}

/**
 * 执行 ONNX CPU 无损放大
 * 小图 base64 传输，大图文件 I/O
 * ONNX 分块处理天然支持任意尺寸，仅对超大图(>4096px)做限制
 */
export async function performOnnxUpscale(
  params: UpscaleParams,
): Promise<UpscaleResult> {
  const {
    imageUrl: inputImageUrl,
    scale = UPSCALE_DEFAULT_SCALE,
    outputFormat = 'png' as 'png' | 'jpg' | 'jpeg' | 'webp',
    compression = 90,
  } = params;

  const scaleNum = Math.max(2, Math.min(16, Math.round(scale)));
  if (scaleNum < 2) {
    return { success: false, error: `不支持的放大倍率: ${scale}，最小 2 倍` };
  }

  const onnxAvailable = await isOnnxUpscaleAvailable();
  if (!onnxAvailable.available) {
    return { success: false, error: onnxAvailable.error || 'ONNX 放大不可用' };
  }

  ensureOutputDirs();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onnx-upscale-'));

  try {
    const { readImageToBuffer } = await import('./file');
    const { buffer: inputBuffer, width: origW, height: origH } =
      await readImageToBuffer(inputImageUrl);

    const MAX_ONNX_EDGE = 4096;
    let processBuffer = inputBuffer;
    let procW = origW;
    let procH = origH;
    if (origW > MAX_ONNX_EDGE || origH > MAX_ONNX_EDGE) {
      const { resizeIfTooLarge } = await import('./file');
      const resized = await resizeIfTooLarge(inputBuffer, MAX_ONNX_EDGE);
      processBuffer = resized.buffer;
      procW = resized.width;
      procH = resized.height;
      console.log(`[upscayl] Resized超大图: ${origW}x${origH} -> ${procW}x${procH}`);
    }

    const tileSize = params.tileSize || calcOptimalTileSize(procW, procH, scale);
    const timeoutMs = calcTimeoutMs(procW, procH, tileSize);

    const isLargeImage = procW * procH > 512 * 512;
    let imageBase64 = '';
    let inputFile = '';
    let outputFile = '';

    if (isLargeImage) {
      const tmpInput = path.join(tmpDir, 'input.png');
      fs.writeFileSync(tmpInput, processBuffer);
      inputFile = tmpInput;
      const filename = generateFilename('upscale', 'png');
      outputFile = path.join(getUpscaleOutputDir(), filename);
      console.log(`[upscayl] ONNX CPU upscale (file mode): ${procW}x${procH} -> ${scale}x, tileSize=${tileSize}, timeout=${Math.round(timeoutMs/1000)}s`);
    } else {
      imageBase64 = processBuffer.toString('base64');
      console.log(`[upscayl] ONNX CPU upscale (base64 mode): ${procW}x${procH} -> ${scale}x, tileSize=${tileSize}`);
    }

    const result = await callOnnxUpscale(
      imageBase64, scale, tileSize, 'realesrgan-x4plus-fp16',
      inputFile, outputFile, timeoutMs,
    );

    if (!result.success) {
      return { success: false, error: result.error || 'ONNX 放大未返回结果' };
    }

    // 文件模式：Python 已直接写入输出文件
    if (result.outputFile && fs.existsSync(result.outputFile)) {
      let finalBuffer: Buffer = await fs.promises.readFile(result.outputFile);
      const outW = result.outputSize?.[0] ?? procW * scale;
      const outH = result.outputSize?.[1] ?? procH * scale;

      // 两步锐化恢复纹理
      finalBuffer = Buffer.from(await sharp(finalBuffer)
        .sharpen({ sigma: 1.5, m1: 1.0, m2: 0.5, x1: 2, y2: 4, y3: 10 })
        .toBuffer());
      finalBuffer = Buffer.from(await sharp(finalBuffer)
        .sharpen({ sigma: 0.3, m1: 0.6, m2: 0.2, x1: 1, y2: 2, y3: 6 })
        .toBuffer());

      if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
        finalBuffer = Buffer.from(await sharp(finalBuffer).jpeg({ quality: compression }).toBuffer());
      } else if (outputFormat === 'webp') {
        finalBuffer = Buffer.from(await sharp(finalBuffer).webp({ quality: compression }).toBuffer());
      }

      const filename = generateFilename('upscale', outputFormat === 'png' ? 'png' : outputFormat as string);
      const finalOutputPath = path.join(getUpscaleOutputDir(), filename);

      if (finalOutputPath !== result.outputFile) {
        fs.writeFileSync(finalOutputPath, finalBuffer);
        try { fs.unlinkSync(result.outputFile); } catch {}
      }

      const imageUrl = `${UPSCALE_OUTPUT_URL_PREFIX}/${filename}`;
      console.log(`[upscayl] ONNX CPU upscale complete (file): ${procW}x${procH} -> ${outW}x${outH} (${result.elapsed}s)`);

      return {
        success: true, imageUrl,
        originalSize: { width: origW, height: origH },
        outputSize: { width: outW, height: outH },
        model: result.model || 'realesrgan-x4plus-fp16',
        scale,
      };
    }

    // base64 模式
    if (!result.image) {
      return { success: false, error: result.error || 'ONNX 放大未返回结果' };
    }

    const outputBuffer = Buffer.from(result.image, 'base64');
    const outputMeta = await sharp(outputBuffer).metadata();
    const outW = outputMeta.width || (result.outputSize?.[0] ?? procW * scale);
    const outH = outputMeta.height || (result.outputSize?.[1] ?? procH * scale);

    let finalBuffer: Buffer = outputBuffer;
    if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
      finalBuffer = await sharp(outputBuffer).jpeg({ quality: compression }).toBuffer();
    } else if (outputFormat === 'webp') {
      finalBuffer = await sharp(outputBuffer).webp({ quality: compression }).toBuffer();
    }

    const filename = generateFilename('upscale', outputFormat);
    const outputPath = path.join(getUpscaleOutputDir(), filename);
    fs.writeFileSync(outputPath, finalBuffer);

    const imageUrl = `${UPSCALE_OUTPUT_URL_PREFIX}/${filename}`;
    console.log(`[upscayl] ONNX CPU upscale complete: ${procW}x${procH} -> ${outW}x${outH} (${result.elapsed}s)`);

    return {
      success: true, imageUrl,
      originalSize: { width: origW, height: origH },
      outputSize: { width: outW, height: outH },
      model: result.model || 'realesrgan-x4plus-fp16',
      scale,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `ONNX 放大失败: ${msg}` };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ============================================================
// 统一入口：CPU 无损放大
// ============================================================

/**
 * 执行 CPU 无损放大 — ONNX Real-ESRGAN 优先, sharp Lanczos3 兜底
 * AI 云端放大由 image-edit route / upscale-pro route 独立处理
 */
export async function performUpscaleAuto(
  params: UpscaleParams,
): Promise<UpscaleResult & { engine?: string }> {
  // ONNX Real-ESRGAN (Python 子进程, CPU)
  const onnxAvailable = await isOnnxUpscaleAvailable();
  if (onnxAvailable.available) {
    console.log('[upscale] Using ONNX CPU upscale...');
    const result = await performOnnxUpscale(params);
    if (result.success) {
      return { ...result, engine: 'onnx-cpu' };
    }
    console.log(`[upscale] ONNX CPU failed: ${result.error}`);
  }

  // 兜底: sharp Lanczos3 插值放大（仅保留像素，不增加细节）
  console.log('[upscale] Falling back to sharp Lanczos3 resize...');
  try {
    const { readImageToBuffer } = await import('./file');
    const { buffer: inputBuffer, width: origW, height: origH } = await readImageToBuffer(params.imageUrl);
    const scaleNum = Math.max(2, Math.min(4, Math.round(params.scale || UPSCALE_DEFAULT_SCALE)));
    const outW = origW * scaleNum;
    const outH = origH * scaleNum;

    ensureOutputDirs();

    let pipeline = sharp(inputBuffer)
      .resize(outW, outH, { kernel: 'lanczos3' })
      .sharpen({ sigma: 0.8, m1: 0.8, m2: 0.4, x1: 2, y2: 4, y3: 8 });
    const outputFormat: string = params.outputFormat || 'png';
    if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: params.compression || 90 });
    } else if (outputFormat === 'webp') {
      pipeline = pipeline.webp({ quality: params.compression || 90 });
    } else {
      pipeline = pipeline.png();
    }

    const outputBuffer = await pipeline.toBuffer();
    const filename = generateFilename('upscale', outputFormat);
    const outputPath = path.join(getUpscaleOutputDir(), filename);
    fs.writeFileSync(outputPath, outputBuffer);

    return {
      success: true,
      imageUrl: `${UPSCALE_OUTPUT_URL_PREFIX}/${filename}`,
      originalSize: { width: origW, height: origH },
      outputSize: { width: outW, height: outH },
      model: 'lanczos3',
      scale: scaleNum,
      engine: 'sharp-lanczos3',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `CPU 放大失败: ${msg}` };
  }
}
