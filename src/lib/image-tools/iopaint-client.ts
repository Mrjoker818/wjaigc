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

// ============================================================
// 擦除模型列表 (与 IOPaint 最新版一致)
// ============================================================

export const ERASE_MODELS = [
  { id: 'lama' as const, label: 'LaMa 通用擦除', description: '默认推荐，精准抹除与智能修复', recommended: true, files: ['big-lama.pt'] },
  { id: 'zits' as const, label: 'ZITS 结构保持', description: '结构感知修复，保持线条和结构更好', files: ['zits-inpaint-0717.pt', 'zits-edge-line-0717.pt', 'zits-structure-upsample-0717.pt', 'zits-wireframe-0717.pt'] },
  { id: 'anime-lama' as const, label: 'Anime LaMa', description: '动漫专用擦除，适合二次元图片', files: ['anime-manga-big-lama.pt'] },
];

export type EraseModelId = (typeof ERASE_MODELS)[number]['id'];
export const DEFAULT_ERASE_MODEL: EraseModelId = 'lama';
export const VALID_ERASE_MODELS: readonly string[] = ERASE_MODELS.map((m) => m.id);

/** LaMa 模型文件路径 */
const LAMA_MODEL_PATH = path.join(
  process.env.HOME || '/root',
  '.cache/torch/hub/checkpoints/big-lama.pt',
);

/**
 * IOPaint RemoveBG 支持的模型 (精简为 3 个，覆盖通用/轻量/人像场景)
 * - birefnet-general-lite: 精度最高，通用去背景首选 (224MB ONNX)
 * - u2netp: 极轻量快速备选 (4.5MB ONNX)
 * - silueta: 轻量人像备选 (45MB ONNX)
 */
export const REMOVEBG_MODELS = [
  { id: 'birefnet-general-lite', label: 'BiRefNet 通用', group: 'recommended', description: '精度最高，需要大内存(≥16GB)', size: '224MB' },
  { id: 'u2netp', label: 'U2Net 轻量', group: 'lightweight', recommended: true, description: '速度快内存低，适合日常使用', size: '4.5MB' },
  { id: 'silueta', label: 'Silueta 人像', group: 'portrait', description: '轻量人像去背景', size: '45MB' },
] as const;

/** 默认 RemoveBG 模型 */
export const DEFAULT_REMOVEBG_MODEL = 'u2netp';

/** 检查 Python + 依赖是否可用（比仅检查模型文件更准确） */
let _pythonEnvChecked = false;
let _pythonEnvAvailable = false;

async function checkPythonEnv(): Promise<boolean> {
  if (_pythonEnvChecked) return _pythonEnvAvailable;
  _pythonEnvChecked = true;

  try {
    const { execSync } = await import('child_process');
    // 检查 python3 是否存在
    execSync('which python3', { stdio: 'ignore', timeout: 3000 });
    // 检查 torch 是否安装
    execSync('python3 -c "import torch"', { stdio: 'ignore', timeout: 10000 });
    // 检查 iopaint 是否安装
    execSync('python3 -c "import iopaint"', { stdio: 'ignore', timeout: 10000 });
    _pythonEnvAvailable = true;
    console.log('[IOPaint] Python environment check passed (python3 + torch + iopaint available)');
  } catch {
    _pythonEnvAvailable = false;
    console.log('[IOPaint] Python environment check failed (python3/torch/iopaint not available), skipping local IOPaint');
  }
  return _pythonEnvAvailable;
}

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
 * 调用 Python 脚本执行 IOPaint 擦除（支持 lama / zits / anime-lama 模型）
 * 优点：无需启动额外服务，模型按需加载
 * 缺点：首次调用需要加载模型（~5-15秒 CPU），后续调用更快
 */
export async function eraseWithLama(
  imageBuffer: Buffer,
  maskBuffer: Buffer,
  imageWidth: number,
  imageHeight: number,
  eraseModel: string = 'lama',
): Promise<InpaintResult> {
  if (!LOCAL_AI_ENABLED) {
    return { success: false, error: 'LOCAL_AI_ENABLED 未启用' };
  }

  // ★ 先检查 Python 环境（比检查模型文件更准确）
  const pythonAvailable = await checkPythonEnv();
  if (!pythonAvailable) {
    return {
      success: false,
      error: 'Python 环境不可用（缺少 python3/torch/iopaint），无法使用本地 LaMa 擦除，请使用 AI 模型',
    };
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

    // 调用 Python 脚本（传递 model 参数）
    const validModel = ERASE_MODELS.find(m => m.id === eraseModel) ? eraseModel : 'lama';
    const result = await callPythonScript(ERASE_SCRIPT, {
      image: imageBase64,
      mask: maskBase64,
      model: validModel,
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
      engine: `iopaint-${validModel}`,
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
  model: string = DEFAULT_REMOVEBG_MODEL,
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

    // 确保 RemoveBG 结果是 RGBA 格式（有透明通道）
    let finalBuffer = resultBuffer;
    if (outputMeta.channels && outputMeta.channels < 4) {
      console.log(`[iopaint-removebg] Output has ${outputMeta.channels} channels, converting to RGBA`);
      finalBuffer = Buffer.from(await sharp(resultBuffer).ensureAlpha().png().toBuffer());
    }

    const imageUrl = saveOutputBuffer(
      finalBuffer,
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
  model?: string;
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
      // ★ 不使用 spawn 的 timeout 选项（某些 Node 版本行为不一致），
      // 改用手动 setTimeout + proc.kill() 确保超时必杀
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    // ★ 手动超时保护
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        resolve({
          success: false,
          error: `Python 脚本超时 (${Math.round(IOPAINT_TIMEOUT_MS / 1000)}s)`,
        });
      }
    }, IOPAINT_TIMEOUT_MS);

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
        reject(new Error(`Python 脚本启动失败: ${err.message}`));
      }
    });

    proc.on('close', (code: number | null) => {
      if (settled) return; // 已被超时处理
      settled = true;
      clearTimeout(timer);

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
  params: InpaintParams & { eraseModel?: string },
): Promise<InpaintResult> {
  const { imageBuffer, maskBuffer, prompt, imageWidth, imageHeight, eraseModel } = params;

  // 优先使用 Python 子进程模式
  const pythonResult = await eraseWithLama(
    imageBuffer,
    maskBuffer,
    imageWidth,
    imageHeight,
    eraseModel,
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
  model: string = DEFAULT_REMOVEBG_MODEL,
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
