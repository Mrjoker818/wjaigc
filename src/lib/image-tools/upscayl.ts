// ============================================================
// Image Tools — Upscale Engine
//
// 放大策略:
//   1. CPU 放大 (ONNX Real-ESRGAN fp16, Python 子进程) — 无需 GPU，纯 CPU 推理
//   2. AI 云端放大 (由 image-edit route 处理) — AI 模型生成，需 API Key
// ============================================================

import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import sharp from 'sharp';
import {
  UPSCALE_OUTPUT_DIR,
  UPSCALE_DEFAULT_SCALE,
  IMAGE_MAX_EDGE,
  PYTHON_BIN,
} from './config';
import { ensureOutputDirs, generateFilename } from './file';

// 默认超时（5 分钟），动态计算时可能覆盖
const UPSCALE_TIMEOUT_MS = 5 * 60 * 1000;

// ============================================================
// Upscale 参数和结果类型
// ============================================================

/** 放大参数 */
export interface UpscaleParams {
  imageUrl: string;
  model?: string;
  scale?: number; // 支持 2~16 倍放大
  tileSize?: number;
  outputFormat?: 'png' | 'jpg' | 'webp';
  compression?: number;
}

/** 放大结果 */
export interface UpscaleResult {
  success: boolean;
  imageUrl?: string;
  originalSize?: { width: number; height: number };
  outputSize?: { width: number; height: number };
  model?: string;
  scale?: number;
  error?: string;
}

// ============================================================
// ONNX CPU 放大 (Real-ESRGAN fp16, Python 子进程)
// ============================================================

/** ONNX 模型目录 */
function getOnnxModelsDir(): string {
  return process.env.ONNX_MODELS_DIR ||
    path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'onnx-models');
}

/** 检查 ONNX 放大是否可用 */
export async function isOnnxUpscaleAvailable(): Promise<{
  available: boolean;
  model?: string;
  error?: string;
}> {
  const modelsDir = getOnnxModelsDir();
  if (!fs.existsSync(modelsDir)) {
    return { available: false, error: 'ONNX 模型目录不存在' };
  }

  // 检查 fp16 模型文件（唯一支持动态尺寸的模型）
  const fp16Model = path.join(modelsDir, 'realesrgan-x4plus-fp16.onnx');
  if (!fs.existsSync(fp16Model)) {
    return { available: false, error: '未找到 realesrgan-x4plus-fp16.onnx 模型文件' };
  }

  // 检查 Python 和 onnxruntime 可用性
  const scriptPath = getUpscaleOnnxScriptPath();
  if (!fs.existsSync(scriptPath)) {
    return { available: false, error: 'upscale_onnx.py 脚本未找到' };
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
  // 目标：每个 tile 推理内存 < 200MB (fp16, 4x 模型)
  // 128x128 tile → 512x512 output ≈ 3MB float16，非常安全
  // 256x256 tile → 1024x1024 output ≈ 12MB float16，安全
  // 384x384 tile → 1536x1536 output ≈ 27MB float16，可能 OOM
  // 512x512 tile → 2048x2048 output ≈ 48MB float16，风险高
  const pixels = width * height;

  if (pixels > 1024 * 1024) return 128;   // 大图/超大图：小 tile，避免 OOM
  if (pixels >= 512 * 512) return 192;     // 中大图
  if (pixels >= 256 * 256) return 256;     // 中图
  return Math.min(width, 256);             // 小图：用图片尺寸或 256，避免 tile > 图片
}

/** 动态计算超时：根据图片尺寸和 tile 数量 */
export function calcTimeoutMs(width: number, height: number, tileSize: number): number {
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const totalTiles = cols * rows;
  // 每个tile 约 4-6 秒 (128x128)，大 tile 更慢
  const secondsPerTile = tileSize <= 128 ? 5 : tileSize <= 256 ? 8 : 12;
  const estimatedSeconds = totalTiles * secondsPerTile;
  // 取估算的 2 倍 + 30s 启动开销，最少 5 分钟，最多 30 分钟
  return Math.min(30 * 60 * 1000, Math.max(5 * 60 * 1000, (estimatedSeconds * 2 + 30) * 1000));
}

/**
 * 调用 Python ONNX 子进程执行放大
 *
 * 支持两种模式：
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

  const inputObj: Record<string, unknown> = {
    scale,
    tileSize,
    model,
  };

  // 文件模式优先（大图场景）
  if (inputFile && fs.existsSync(inputFile)) {
    inputObj.inputFile = inputFile;
    if (outputFile) {
      inputObj.outputFile = outputFile;
    }
  } else {
    inputObj.image = imageBase64;
  }

  const effectiveTimeout = timeoutMs || UPSCALE_TIMEOUT_MS;

  return new Promise((resolve) => {
    const input = JSON.stringify(inputObj);

    const proc = spawn(PYTHON_BIN, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ONNX_MODELS_DIR: onnxModelsDir,
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    // 动态超时保护
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        resolve({
          success: false,
          error: `ONNX 放大超时 (${Math.round(effectiveTimeout / 1000)}s)`,
        });
      }
    }, effectiveTimeout);

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          success: false,
          error: `Python 脚本启动失败: ${err.message}`,
        });
      }
    });

    proc.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0 && !stdout.trim()) {
        const errMsg = stderr.trim() || `进程退出码 ${code}`;
        console.error(`[upscayl] ONNX script error: ${errMsg}`);
        resolve({
          success: false,
          error: `脚本执行失败: ${errMsg.substring(0, 300)}`,
        });
        return;
      }

      try {
        const result: OnnxUpscaleResult = JSON.parse(stdout.trim());
        if (result.success === undefined) {
          result.success = code === 0;
        }
        resolve(result);
      } catch {
        console.error(`[upscayl] Failed to parse ONNX output: ${stdout.substring(0, 200)}`);
        resolve({
          success: false,
          error: '脚本输出解析失败',
        });
      }
    });

    // 写入输入数据
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

/**
 * 执行 ONNX CPU 无损放大 (优先路径)
 *
 * 两种模式自动选择：
 * - 小图 (≤512x512): base64 传输，简单高效
 * - 大图 (>512x512): 文件 I/O，避免内存峰值
 *
 * 不对原图做 resizeIfTooLarge 缩放 — ONNX 分块处理天然支持任意尺寸
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

  // 校验 scale (支持 2~16 倍放大)
  const scaleNum = Math.max(2, Math.min(16, Math.round(scale)));
  if (scaleNum < 2) {
    return { success: false, error: `不支持的放大倍率: ${scale}，最小 2 倍` };
  }

  // 检查 ONNX 可用性
  const onnxAvailable = await isOnnxUpscaleAvailable();
  if (!onnxAvailable.available) {
    return {
      success: false,
      error: onnxAvailable.error || 'ONNX 放大不可用',
    };
  }

  ensureOutputDirs();

  // 临时目录用于文件模式
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onnx-upscale-'));

  try {
    // 读取图片尺寸信息（不加载全部像素到内存）
    const { readImageToBuffer } = await import('./file');
    const { buffer: inputBuffer, width: origW, height: origH } =
      await readImageToBuffer(inputImageUrl);

    // 关键：不做 resizeIfTooLarge！ONNX 分块处理天然支持大图
    // 只对超大图 (>4096px) 做限制，避免内存溢出
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

    // 动态计算 tileSize 和超时
    const tileSize = params.tileSize || calcOptimalTileSize(procW, procH, scale);
    const timeoutMs = calcTimeoutMs(procW, procH, tileSize);

    // 判断使用 base64 还是文件模式
    const isLargeImage = procW * procH > 512 * 512;
    let imageBase64 = '';
    let inputFile = '';
    let outputFile = '';

    if (isLargeImage) {
      // 文件模式：保存到临时文件，Python 直接读写文件
      const tmpInput = path.join(tmpDir, 'input.png');
      fs.writeFileSync(tmpInput, processBuffer);
      inputFile = tmpInput;

      const filename = generateFilename('upscale', 'png');
      outputFile = path.join(UPSCALE_OUTPUT_DIR, filename);

      console.log(`[upscayl] ONNX CPU upscale (file mode): ${procW}x${procH} -> ${scale}x, tileSize=${tileSize}, timeout=${Math.round(timeoutMs/1000)}s`);
    } else {
      // base64 模式：小图直接传 stdin
      imageBase64 = processBuffer.toString('base64');
      console.log(`[upscayl] ONNX CPU upscale (base64 mode): ${procW}x${procH} -> ${scale}x, tileSize=${tileSize}`);
    }

    // 调用 Python ONNX 子进程
    const result = await callOnnxUpscale(
      imageBase64,
      scale,
      tileSize,
      'realesrgan-x4plus-fp16',
      inputFile,
      outputFile,
      timeoutMs,
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'ONNX 放大未返回结果',
      };
    }

    // 文件模式：Python 已直接写入输出文件
    if (result.outputFile && fs.existsSync(result.outputFile)) {
      let finalBuffer: Buffer = await fs.promises.readFile(result.outputFile);
      const outW = result.outputSize?.[0] ?? procW * scale;
      const outH = result.outputSize?.[1] ?? procH * scale;

      // 转换输出格式
      if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
        finalBuffer = Buffer.from(await sharp(finalBuffer).jpeg({ quality: compression }).toBuffer());
      } else if (outputFormat === 'webp') {
        finalBuffer = Buffer.from(await sharp(finalBuffer).webp({ quality: compression }).toBuffer());
      }

      // 如果格式不是 PNG，需要重命名
      const filename = generateFilename('upscale', outputFormat === 'png' ? 'png' : outputFormat as string);
      const finalOutputPath = path.join(UPSCALE_OUTPUT_DIR, filename);

      if (finalOutputPath !== result.outputFile) {
        fs.writeFileSync(finalOutputPath, finalBuffer);
        // 删除 Python 写的 PNG 原始文件
        try { fs.unlinkSync(result.outputFile); } catch {}
      }

      const imageUrl = `/outputs/upscale/${filename}`;
      console.log(`[upscayl] ONNX CPU upscale complete (file): ${procW}x${procH} -> ${outW}x${outH} (${result.elapsed}s)`);

      return {
        success: true,
        imageUrl,
        originalSize: { width: origW, height: origH },
        outputSize: { width: outW, height: outH },
        model: result.model || 'realesrgan-x4plus-fp16',
        scale,
      };
    }

    // base64 模式：从返回的 base64 解码
    if (!result.image) {
      return {
        success: false,
        error: result.error || 'ONNX 放大未返回结果',
      };
    }

    const outputBuffer = Buffer.from(result.image, 'base64');
    const outputMeta = await sharp(outputBuffer).metadata();
    const outW = outputMeta.width || (result.outputSize?.[0] ?? procW * scale);
    const outH = outputMeta.height || (result.outputSize?.[1] ?? procH * scale);

    // 转换输出格式
    let finalBuffer: Buffer = outputBuffer;
    if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
      finalBuffer = await sharp(outputBuffer).jpeg({ quality: compression }).toBuffer();
    } else if (outputFormat === 'webp') {
      finalBuffer = await sharp(outputBuffer).webp({ quality: compression }).toBuffer();
    }

    // 保存最终输出
    const filename = generateFilename('upscale', outputFormat);
    const outputPath = path.join(UPSCALE_OUTPUT_DIR, filename);
    fs.writeFileSync(outputPath, finalBuffer);

    const imageUrl = `/outputs/upscale/${filename}`;

    console.log(`[upscayl] ONNX CPU upscale complete: ${procW}x${procH} -> ${outW}x${outH} (${result.elapsed}s)`);

    return {
      success: true,
      imageUrl,
      originalSize: { width: origW, height: origH },
      outputSize: { width: outW, height: outH },
      model: result.model || 'realesrgan-x4plus-fp16',
      scale,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `ONNX 放大失败: ${msg}`,
    };
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

// ============================================================
// 统一入口：CPU 放大 (ONNX Real-ESRGAN)
// ============================================================

/**
 * 执行 CPU 无损放大 — 使用 ONNX Real-ESRGAN
 *
 * 仅提供 CPU 放大路径，AI 云端放大由 image-edit route 独立处理
 */
export async function performUpscaleAuto(
  params: UpscaleParams,
): Promise<UpscaleResult & { engine?: string }> {
  const onnxAvailable = await isOnnxUpscaleAvailable();
  if (onnxAvailable.available) {
    console.log('[upscale] Using ONNX CPU upscale...');
    const result = await performOnnxUpscale(params);
    if (result.success) {
      return { ...result, engine: 'onnx-cpu' };
    }
    console.log(`[upscale] ONNX CPU failed: ${result.error}`);
  }

  return {
    success: false,
    error: 'CPU 放大引擎不可用 (ONNX Real-ESRGAN)',
  };
}
