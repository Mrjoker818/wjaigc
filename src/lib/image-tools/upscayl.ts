// ============================================================
// Image Tools — Upscayl Engine
// ============================================================

import path from 'path';
import fs from 'fs';
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

/** 可用的 upscayl 模型列表 */
export async function listUpscaylModels(): Promise<string[]> {
  if (!fs.existsSync(UPSCAYL_MODELS_DIR)) {
    return [];
  }
  const entries = fs.readdirSync(UPSCAYL_MODELS_DIR);
  // upscayl 模型目录下每个子目录是一个模型
  const models: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(UPSCAYL_MODELS_DIR, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      // 检查目录内是否有 .param 文件 (NCNN 模型)
      const files = fs.readdirSync(fullPath);
      if (files.some((f) => f.endsWith('.param'))) {
        models.push(entry);
      }
    }
  }
  return models;
}

/** 检查 upscayl 是否可用 */
export async function isUpscaylAvailable(): Promise<{
  available: boolean;
  models: string[];
  error?: string;
}> {
  try {
    // 检查 upscayl-node 是否可导入
    const upscayl = await import('upscayl-node');
    if (!upscayl) {
      return {
        available: false,
        models: [],
        error: 'upscayl-node 模块未安装',
      };
    }

    const models = await listUpscaylModels();
    if (models.length === 0) {
      return {
        available: false,
        models: [],
        error:
          '未找到 upscayl 模型文件，请下载模型到 upscayl-models/ 目录',
      };
    }

    return { available: true, models };
  } catch (e) {
    return {
      available: false,
      models: [],
      error:
        '本地无损放大引擎不可用，请检查 upscayl-node、Vulkan/Mesa 驱动或 upscayl-models 模型目录。',
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

/**
 * 执行无损放大
 */
export async function performUpscale(
  params: UpscaleParams,
): Promise<UpscaleResult> {
  const {
    imageUrl,
    model: requestedModel,
    scale = UPSCALE_DEFAULT_SCALE,
    outputFormat = 'png',
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
  const modelName =
    requestedModel || availability.models[0] || 'realesrgan-x4plus';
  const modelDir = path.join(UPSCAYL_MODELS_DIR, modelName);

  if (!fs.existsSync(modelDir)) {
    return { success: false, error: `模型不存在: ${modelName}` };
  }

  ensureOutputDirs();

  // 读取并处理图片
  const { readImageToBuffer } = await import('./file');
  const { buffer: inputBuffer, width: origW, height: origH } =
    await readImageToBuffer(imageUrl);

  // 大图先缩放
  const { buffer: processBuffer, width: procW, height: procH } =
    await resizeIfTooLarge(inputBuffer, IMAGE_MAX_EDGE);

  // 保存临时输入文件 (upscayl 需要文件路径)
  const tmpInput = path.join(
    UPSCALE_OUTPUT_DIR,
    `tmp-input-${Date.now()}.png`,
  );
  fs.writeFileSync(tmpInput, processBuffer);

  const tmpOutput = path.join(
    UPSCALE_OUTPUT_DIR,
    `tmp-output-${Date.now()}.png`,
  );

  try {
    // 调用 upscayl-node
    const upscaylModule = await import('upscayl-node');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const UpscaylClass = (upscaylModule.default || upscaylModule) as any;
    const upscayl = new UpscaylClass({
      modelDir: modelDir,
      model: modelName,
      scale: scale,
      gpuId: 0,
      saveImage: true,
      outputDir: UPSCALE_OUTPUT_DIR,
    });

    // 设置超时
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('放大操作超时')),
        UPSCALE_TIMEOUT_MS,
      );
    });

    await Promise.race([
      upscayl.upscale(tmpInput, tmpOutput),
      timeoutPromise,
    ]);

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
    if (outputFormat !== 'png') {
      const pipeline = sharp(outputBuffer);
      if (outputFormat === 'jpg') {
        finalBuffer = await pipeline
          .jpeg({ quality: compression })
          .toBuffer();
      } else if (outputFormat === 'webp') {
        finalBuffer = await pipeline
          .webp({ quality: compression })
          .toBuffer();
      }
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
    // 清理临时文件
    try {
      if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput);
      if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
    } catch {
      // 忽略清理错误
    }
  }
}
