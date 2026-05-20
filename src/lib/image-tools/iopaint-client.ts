// ============================================================
// Image Tools — IOPaint Client (LaMa 擦除 + RemoveBG 去背景)
// ============================================================
// 两种调用方式:
// 1. Python 子进程模式 (推荐): 直接调用 Python 脚本，无需启动 IOPaint 服务
// 2. HTTP 服务模式 (兼容): 调用本地 IOPaint REST API

import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import sharp from 'sharp';
import {
  IOPAINT_BASE_URL,
  IOPAINT_TIMEOUT_MS,
  INPAINT_OUTPUT_DIR,
  IMAGE_MAX_EDGE,
  LOCAL_AI_ENABLED,
} from './config';
import {
  ensureOutputDirs,
  generateFilename,
  readImageToBuffer,
  saveOutputBuffer,
} from './file';
import { validateAndNormalizeMask } from './mask';

/** Python 脚本目录 */
const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');
const ERASE_SCRIPT = path.join(SCRIPTS_DIR, 'iopaint_erase.py');
const REMOVEBG_SCRIPT = path.join(SCRIPTS_DIR, 'iopaint_removebg.py');

/** LaMa 模型文件路径 */
const LAMA_MODEL_PATH = path.join(
  process.env.HOME || '/root',
  '.cache/torch/hub/checkpoints/big-lama.pt',
);

/** 检查 LaMa 模型文件是否存在且有效 (>1MB) */
function isLamaModelAvailable(): boolean {
  try {
    if (!fs.existsSync(LAMA_MODEL_PATH)) return false;
    const stat = fs.statSync(LAMA_MODEL_PATH);
    return stat.size > 1_000_000; // > 1MB (real model is ~200MB)
  } catch {
    return false;
  }
}

/** 擦除结果 */
export interface InpaintResult {
  success: boolean;
  imageUrl?: string;
  originalSize?: { width: number; height: number };
  outputSize?: { width: number; height: number };
  engine?: string;
  error?: string;
}

/** 去背景结果 */
export interface RemoveBgResult {
  success: boolean;
  imageUrl?: string;
  originalSize?: { width: number; height: number };
  outputSize?: { width: number; height: number };
  engine?: string;
  error?: string;
}

// ============================================================
// Python 子进程模式
// ============================================================

/**
 * 调用 Python 脚本执行 IOPaint LaMa 擦除
 * 优点：无需启动额外服务，模型按需加载
 * 缺点：首次调用需要加载模型（~5-15秒 CPU），后续调用更快
 */
export async function eraseWithLama(
  imageBuffer: Buffer,
  maskBuffer: Buffer,
  imageWidth: number,
  imageHeight: number,
): Promise<InpaintResult> {
  if (!LOCAL_AI_ENABLED) {
    return { success: false, error: 'LOCAL_AI_ENABLED 未启用' };
  }

  if (!isLamaModelAvailable()) {
    return {
      success: false,
      error: 'LaMa 模型文件不存在或无效，请运行 bash scripts/download-iopaint-models.sh 下载',
    };
  }

  if (!fs.existsSync(ERASE_SCRIPT)) {
    return {
      success: false,
      error: `擦除脚本不存在: ${ERASE_SCRIPT}`,
    };
  }

  ensureOutputDirs();

  try {
    // 归一化蒙版
    const normalizedMask = await validateAndNormalizeMask(
      maskBuffer,
      imageWidth,
      imageHeight,
    );

    // 转为 base64
    const imageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    const maskBase64 = `data:image/png;base64,${normalizedMask.toString('base64')}`;

    // 调用 Python 脚本
    const result = await callPythonScript(ERASE_SCRIPT, {
      image: imageBase64,
      mask: maskBase64,
    });

    if (!result.success || !result.image) {
      return {
        success: false,
        error: result.error || 'LaMa 擦除失败',
      };
    }

    // 解码结果图片
    const resultBuffer = Buffer.from(result.image, 'base64');
    const outputMeta = await sharp(resultBuffer).metadata();
    const imageUrl = saveOutputBuffer(
      resultBuffer,
      'inpaint',
      'png',
      INPAINT_OUTPUT_DIR,
    );

    return {
      success: true,
      imageUrl,
      originalSize: { width: imageWidth, height: imageHeight },
      outputSize: {
        width: outputMeta.width || imageWidth,
        height: outputMeta.height || imageHeight,
      },
      engine: 'iopaint-lama',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `LaMa 擦除失败: ${msg}`,
    };
  }
}

/**
 * 调用 Python 脚本执行 IOPaint RemoveBG 去背景
 * 首次调用会自动下载 rembg 模型 (u2net, ~176MB)
 */
export async function removeBgWithIOPaint(
  imageBuffer: Buffer,
  imageWidth: number,
  imageHeight: number,
  model: string = 'u2net',
): Promise<RemoveBgResult> {
  if (!LOCAL_AI_ENABLED) {
    return { success: false, error: 'LOCAL_AI_ENABLED 未启用' };
  }

  if (!fs.existsSync(REMOVEBG_SCRIPT)) {
    return {
      success: false,
      error: `去背景脚本不存在: ${REMOVEBG_SCRIPT}`,
    };
  }

  ensureOutputDirs();

  try {
    const imageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;

    const result = await callPythonScript(REMOVEBG_SCRIPT, {
      image: imageBase64,
      model,
    });

    if (!result.success || !result.image) {
      return {
        success: false,
        error: result.error || 'RemoveBG 去背景失败',
      };
    }

    const resultBuffer = Buffer.from(result.image, 'base64');
    const outputMeta = await sharp(resultBuffer).metadata();
    const imageUrl = saveOutputBuffer(
      resultBuffer,
      'removebg',
      'png',
      INPAINT_OUTPUT_DIR,
    );

    return {
      success: true,
      imageUrl,
      originalSize: { width: imageWidth, height: imageHeight },
      outputSize: {
        width: outputMeta.width || imageWidth,
        height: outputMeta.height || imageHeight,
      },
      engine: 'iopaint-removebg',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `RemoveBG 去背景失败: ${msg}`,
    };
  }
}

// ============================================================
// Python 脚本调用通用方法
// ============================================================

interface PythonScriptResult {
  success: boolean;
  image?: string;
  error?: string;
}

/**
 * 调用 Python 脚本，通过 stdin 传入 JSON，从 stdout 读取 JSON 结果
 */
function callPythonScript(
  scriptPath: string,
  input: Record<string, string>,
): Promise<PythonScriptResult> {
  return new Promise((resolve, reject) => {
    const inputData = JSON.stringify(input);

    const proc = spawn('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: IOPAINT_TIMEOUT_MS,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err: Error) => {
      reject(new Error(`Python 脚本启动失败: ${err.message}`));
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        const errMsg = stderr.trim() || `进程退出码 ${code}`;
        console.error(`[IOPaint] Python script error (${scriptPath}): ${errMsg}`);
        resolve({
          success: false,
          error: `脚本执行失败: ${errMsg.substring(0, 300)}`,
        });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim()) as PythonScriptResult;
        resolve(result);
      } catch {
        console.error(`[IOPaint] Failed to parse Python output: ${stdout.substring(0, 200)}`);
        resolve({
          success: false,
          error: `脚本输出解析失败`,
        });
      }
    });

    // 写入输入数据
    proc.stdin.write(inputData);
    proc.stdin.end();
  });
}

// ============================================================
// HTTP 服务模式 (兼容旧版)
// ============================================================

/** 检查 IOPaint 服务是否可用 */
export async function checkIOPaintHealth(): Promise<{
  available: boolean;
  baseUrl: string;
  model?: string;
  error?: string;
}> {
  if (!LOCAL_AI_ENABLED) {
    return {
      available: false,
      baseUrl: IOPAINT_BASE_URL,
      error: 'LOCAL_AI_ENABLED 未启用',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(`${IOPAINT_BASE_URL}/api/v1/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        available: true,
        baseUrl: IOPAINT_BASE_URL,
        model: (data.model as string) || 'lama',
      };
    }
    return {
      available: false,
      baseUrl: IOPAINT_BASE_URL,
      error: `IOPaint 返回状态码 ${resp.status}`,
    };
  } catch {
    return {
      available: false,
      baseUrl: IOPAINT_BASE_URL,
      error:
        '本地 LaMa 修图服务未启动，请先启动 IOPaint：iopaint start --model=lama --device=cpu --port=8080',
    };
  }
}

/** Inpaint 参数 */
export interface InpaintParams {
  imageBuffer: Buffer;
  maskBuffer: Buffer;
  prompt?: string;
  imageWidth: number;
  imageHeight: number;
}

/**
 * 执行本地 IOPaint 修复 (HTTP 服务模式)
 */
export async function performInpaint(
  params: InpaintParams,
): Promise<InpaintResult> {
  const { imageBuffer, maskBuffer, prompt, imageWidth, imageHeight } = params;

  // 优先使用 Python 子进程模式
  const pythonResult = await eraseWithLama(
    imageBuffer,
    maskBuffer,
    imageWidth,
    imageHeight,
  );
  if (pythonResult.success) return pythonResult;

  // Python 子进程失败时，尝试 HTTP 服务模式
  console.log('[IOPaint] Python subprocess failed, trying HTTP service mode...');

  const health = await checkIOPaintHealth();
  if (!health.available) {
    return {
      success: false,
      error: health.error || 'IOPaint 服务不可用',
    };
  }

  ensureOutputDirs();

  const normalizedMask = await validateAndNormalizeMask(
    maskBuffer,
    imageWidth,
    imageHeight,
  );

  const imageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
  const maskBase64 = `data:image/png;base64,${normalizedMask.toString('base64')}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      IOPAINT_TIMEOUT_MS,
    );

    const resp = await fetch(`${IOPAINT_BASE_URL}/api/v1/inpaint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageBase64,
        mask: maskBase64,
        prompt: prompt || '',
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        success: false,
        error: `IOPaint 返回错误 ${resp.status}: ${text.substring(0, 200)}`,
      };
    }

    const contentType = resp.headers.get('content-type') || '';
    let resultBuffer: Buffer;

    if (contentType.includes('image/')) {
      resultBuffer = Buffer.from(await resp.arrayBuffer());
    } else {
      const json = (await resp.json()) as Record<string, unknown>;

      if (json.image) {
        const imgData = json.image as string;
        const base64 = imgData.startsWith('data:')
          ? imgData.split(',')[1]
          : imgData;
        resultBuffer = Buffer.from(base64, 'base64');
      } else if (json.error) {
        return {
          success: false,
          error: `IOPaint 错误: ${json.error}`,
        };
      } else {
        return {
          success: false,
          error: 'IOPaint 返回格式无法识别',
        };
      }
    }

    const outputMeta = await sharp(resultBuffer).metadata();
    const imageUrl = saveOutputBuffer(
      resultBuffer,
      'inpaint',
      'png',
      INPAINT_OUTPUT_DIR,
    );

    return {
      success: true,
      imageUrl,
      originalSize: { width: imageWidth, height: imageHeight },
      outputSize: {
        width: outputMeta.width || imageWidth,
        height: outputMeta.height || imageHeight,
      },
      engine: 'iopaint-lama-http',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort')) {
      return {
        success: false,
        error: 'IOPaint 修复操作超时，请检查服务是否正常运行',
      };
    }
    return {
      success: false,
      error: `修复失败: ${msg}`,
    };
  }
}

/**
 * 通过 imageUrl + mask dataUrl 执行修复（便捷方法）
 */
export async function inpaintFromUrls(
  imageUrl: string,
  maskDataUrl: string,
  prompt?: string,
): Promise<InpaintResult> {
  const { buffer: imageBuffer, width, height } =
    await readImageToBuffer(imageUrl);

  const { buffer: processBuffer, width: procW, height: procH } =
    await (await import('./file')).resizeIfTooLarge(
      imageBuffer,
      IMAGE_MAX_EDGE,
    );

  const maskBase64 = maskDataUrl.split(',')[1];
  if (!maskBase64) {
    return { success: false, error: '无效的蒙版数据' };
  }
  const maskBuffer = Buffer.from(maskBase64, 'base64');

  return performInpaint({
    imageBuffer: processBuffer,
    maskBuffer,
    prompt,
    imageWidth: procW,
    imageHeight: procH,
  });
}

/**
 * 通过 imageUrl 执行去背景（便捷方法）
 */
export async function removeBgFromUrl(
  imageUrl: string,
  model: string = 'u2net',
): Promise<RemoveBgResult> {
  const { buffer: imageBuffer, width, height } =
    await readImageToBuffer(imageUrl);

  const { buffer: processBuffer, width: procW, height: procH } =
    await (await import('./file')).resizeIfTooLarge(
      imageBuffer,
      IMAGE_MAX_EDGE,
    );

  return removeBgWithIOPaint(processBuffer, procW, procH, model);
}
