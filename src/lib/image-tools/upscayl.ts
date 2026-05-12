// ============================================================
// Image Tools — Upscayl Engine
// ============================================================

import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import sharp from 'sharp';
import {
  UPSCAYL_MODELS_DIR,
  UPSCALE_OUTPUT_DIR,
  UPSCALE_DEFAULT_SCALE,
  UPSCALE_MAX_SCALE,
  IMAGE_MAX_EDGE,
  UPSCALE_TIMEOUT_MS,
} from './config';
import { ensureOutputDirs, generateFilename, resizeIfTooLarge } from './file';

// Upscayl 模型描述信息
const UPSCAYL_MODEL_INFO: Record<string, { name: string; description: string; scale: number }> = {
  'realesrgan-x4plus': {
    name: '通用高清',
    description: '适合照片和插画，画质全面提升',
    scale: 4,
  },
  'realesrgan-x4fast': {
    name: '快速放大',
    description: '速度优先，快速出图',
    scale: 4,
  },
};

/** 查找 upscayl-ncnn 二进制文件路径 */
function getUpscaylBinPath(): string {
  const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';

  // 优先级1: 项目 bin 目录
  const binPath = path.join(workspacePath, 'bin', 'upscayl-bin');
  if (fs.existsSync(binPath)) return binPath;

  // 优先级2: upscayl-node 包内嵌的二进制
  const nodeModulesPath = path.join(workspacePath, 'node_modules', '.pnpm');
  if (fs.existsSync(nodeModulesPath)) {
    const dirs = fs.readdirSync(nodeModulesPath).filter(d => d.startsWith('upscayl-node'));
    for (const dir of dirs) {
      const linuxBin = path.join(
        nodeModulesPath, dir, 'node_modules', 'upscayl-node',
        'dist', 'upscaler', 'sub-classes', 'driver', 'command-upscayl',
        'resources', 'linux', 'bin', 'upscayl-bin'
      );
      if (fs.existsSync(linuxBin)) return linuxBin;
    }
  }

  return '';
}

/** 查找模型目录 — 支持扁平 .param 文件和子目录两种布局 */
function findModelsDir(): string {
  const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';

  // 优先级1: 环境变量指定的目录
  if (UPSCAYL_MODELS_DIR && fs.existsSync(UPSCAYL_MODELS_DIR)) {
    const files = fs.readdirSync(UPSCAYL_MODELS_DIR);
    if (files.some(f => f.endsWith('.param'))) return UPSCAYL_MODELS_DIR;
  }

  // 优先级2: 项目 upscayl-models 目录
  const localModelsDir = path.join(workspacePath, 'upscayl-models');
  if (fs.existsSync(localModelsDir)) {
    const files = fs.readdirSync(localModelsDir);
    if (files.some(f => f.endsWith('.param'))) return localModelsDir;
  }

  // 优先级3: upscayl-node 包内嵌的模型
  const nodeModulesPath = path.join(workspacePath, 'node_modules', '.pnpm');
  if (fs.existsSync(nodeModulesPath)) {
    const dirs = fs.readdirSync(nodeModulesPath).filter(d => d.startsWith('upscayl-node'));
    for (const dir of dirs) {
      const bundled = path.join(
        nodeModulesPath, dir, 'node_modules', 'upscayl-node',
        'dist', 'upscaler', 'sub-classes', 'model-manager', 'models'
      );
      if (fs.existsSync(bundled)) {
        const files = fs.readdirSync(bundled);
        if (files.some(f => f.endsWith('.param'))) return bundled;
      }
    }
  }

  return '';
}

/** 获取实际可用的模型列表 */
export async function listUpscaylModels(): Promise<string[]> {
  const modelsPath = findModelsDir();
  if (!modelsPath) return [];

  try {
    const files = fs.readdirSync(modelsPath);
    // 扁平 .param 文件
    const flatModels = files
      .filter(f => f.endsWith('.param'))
      .map(f => f.replace('.param', ''));

    if (flatModels.length > 0) return flatModels;

    // 子目录形式
    const dirModels: string[] = [];
    for (const entry of files) {
      const fullPath = path.join(modelsPath, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        const subFiles = fs.readdirSync(fullPath);
        if (subFiles.some(f => f.endsWith('.param'))) {
          dirModels.push(entry);
        }
      }
    }
    return dirModels;
  } catch {
    return [];
  }
}

// 缓存可用性检测结果
let cachedAvailable: boolean | null = null;
let cachedAvailableTime = 0;
const AVAILABILITY_CACHE_MS = 60000;

/** 检查 upscayl 是否可用 */
export async function isUpscaylAvailable(): Promise<{
  available: boolean;
  models: string[];
  error?: string;
}> {
  const now = Date.now();
  if (cachedAvailable !== null && (now - cachedAvailableTime) < AVAILABILITY_CACHE_MS) {
    const models = await listUpscaylModels();
    return { available: cachedAvailable, models, error: cachedAvailable ? undefined : '本地无损放大引擎不可用' };
  }

  const binPath = getUpscaylBinPath();
  if (!binPath) {
    cachedAvailable = false;
    cachedAvailableTime = now;
    return { available: false, models: [], error: 'upscayl 二进制文件未找到，请检查 upscayl-node 安装' };
  }

  const modelsPath = findModelsDir();
  if (!modelsPath) {
    cachedAvailable = false;
    cachedAvailableTime = now;
    return { available: false, models: [], error: '未找到 upscayl 模型文件，请下载模型到 upscayl-models/ 目录' };
  }

  // 检查二进制是否可执行
  try {
    const result = await new Promise<boolean>((resolve) => {
      const proc = spawn(binPath, ['-h']);
      const timeout = setTimeout(() => { proc.kill(); resolve(false); }, 5000);
      proc.on('error', () => { clearTimeout(timeout); resolve(false); });
      proc.on('close', () => { clearTimeout(timeout); resolve(true); });
    });

    cachedAvailable = result;
    cachedAvailableTime = now;

    const models = await listUpscaylModels();
    if (models.length === 0) {
      cachedAvailable = false;
      return { available: false, models: [], error: '未找到 upscayl 模型文件，请下载模型到 upscayl-models/ 目录' };
    }

    return { available: result, models };
  } catch {
    cachedAvailable = false;
    cachedAvailableTime = now;
    return {
      available: false,
      models: [],
      error: '本地无损放大引擎不可用，请检查 upscayl-node、Vulkan/Mesa 驱动或 upscayl-models 模型目录。',
    };
  }
}

/** 放大参数 */
export interface UpscaleParams {
  imageUrl: string;
  model?: string;
  scale?: 2 | 4;
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

/** 运行 upscayl 放大（使用子进程） */
async function runUpscayl(
  inputPath: string,
  outputPath: string,
  modelName: string,
  scale: number,
  tileSize: number,
  compression: number,
): Promise<string> {
  const binPath = getUpscaylBinPath();
  const modelsPath = findModelsDir();

  if (!binPath) throw new Error('Upscayl binary not found');
  if (!modelsPath) throw new Error('Upscayl models not found');

  const modelInfo = UPSCAYL_MODEL_INFO[modelName];
  const modelScale = modelInfo?.scale || 4;
  const includeScale = modelScale !== scale;

  const args = [
    '-i', inputPath,
    '-o', outputPath,
    '-m', modelsPath,
    '-n', modelName,
    '-f', 'png',
    '-c', compression.toString(),
  ];

  if (includeScale) {
    args.push('-s', scale.toString());
  }

  if (tileSize > 0) {
    args.push('-t', tileSize.toString());
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, args);
    let errorMsg = '';

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text.includes('Error') || text.includes('failed')) {
        errorMsg = text;
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start upscayl: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0 || fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`Upscayl exited with code ${code}: ${errorMsg}`));
      }
    });

    // 超时
    setTimeout(() => {
      proc.kill();
      if (fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error('Upscayl timed out'));
      }
    }, UPSCALE_TIMEOUT_MS);
  });
}

/**
 * 执行无损放大
 */
export async function performUpscale(
  params: UpscaleParams,
): Promise<UpscaleResult> {
  const {
    imageUrl: inputImageUrl,
    model: requestedModel,
    scale = UPSCALE_DEFAULT_SCALE as 2 | 4,
    tileSize = 0,
    outputFormat = 'png' as 'png' | 'jpg' | 'jpeg' | 'webp',
    compression = 90,
  } = params;

  // 校验 scale
  if (scale !== 2 && scale !== 4) {
    return { success: false, error: `不支持的放大倍率: ${scale}，仅支持 2 和 4` };
  }

  // 检查 upscayl 可用性
  const availability = await isUpscaylAvailable();
  if (!availability.available) {
    return {
      success: false,
      error: availability.error || '本地无损放大引擎不可用',
    };
  }

  // 确定模型
  const modelName = requestedModel || availability.models[0] || 'realesrgan-x4plus';

  ensureOutputDirs();

  // 创建临时目录
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upscayl-'));

  try {
    // 读取并处理图片
    const { readImageToBuffer } = await import('./file');
    const { buffer: inputBuffer, width: origW, height: origH } =
      await readImageToBuffer(inputImageUrl);

    // 大图先缩放
    const { buffer: processBuffer, width: procW, height: procH } =
      await resizeIfTooLarge(inputBuffer, IMAGE_MAX_EDGE);

    // 保存临时输入文件 (upscayl 需要文件路径)
    const tmpInput = path.join(tmpDir, 'input.png');
    fs.writeFileSync(tmpInput, processBuffer);

    const tmpOutput = path.join(tmpDir, 'output.png');

    // 执行放大
    await runUpscayl(tmpInput, tmpOutput, modelName, scale, tileSize, compression);

    // 检查输出文件
    if (!fs.existsSync(tmpOutput)) {
      return { success: false, error: '放大输出文件未生成' };
    }

    let outputBuffer = fs.readFileSync(tmpOutput);
    const outputMeta = await sharp(outputBuffer).metadata();
    const outW = outputMeta.width || procW * scale;
    const outH = outputMeta.height || procH * scale;

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

    return {
      success: true,
      imageUrl,
      originalSize: { width: origW, height: origH },
      outputSize: { width: outW, height: outH },
      model: modelName,
      scale,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `放大失败: ${msg}`,
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
