import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';

// Upscayl 模型描述信息
const UPSCAYL_MODELS: Record<string, { name: string; description: string; scale: number }> = {
  'realesrgan-x4plus': {
    name: '通用高清(4x)',
    description: '适合照片和插画，画质全面提升',
    scale: 4,
  },
  'realesrgan-x4fast': {
    name: '快速放大(4x)',
    description: '速度优先，快速出图',
    scale: 4,
  },
  'realesrnet-x4plus': {
    name: '降噪修复(4x)',
    description: '适合有噪点、压缩伪影的图片',
    scale: 4,
  },
  'realesrgan-x4plus-anime': {
    name: '动漫增强(4x)',
    description: '动漫、插画、二次元图片专用',
    scale: 4,
  },
  'realesr-animevideov3': {
    name: '视频帧增强(2x)',
    description: '适合视频截图和动画帧放大',
    scale: 2,
  },
};

// 放大服务器地址
const UPSCALE_SERVER = process.env.UPSCALE_SERVER || 'http://localhost:8081';

// 缓存可用性检测结果
let cachedAvailable: boolean | null = null;
let cachedAvailableTime = 0;
const AVAILABILITY_CACHE_MS = 60000; // 1分钟缓存

// 检测放大服务器是否可用
async function isUpscaleServerAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cachedAvailable !== null && (now - cachedAvailableTime) < AVAILABILITY_CACHE_MS) {
    return cachedAvailable;
  }

  try {
    const resp = await fetch(`${UPSCALE_SERVER}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const result = resp.ok;
    cachedAvailable = result;
    cachedAvailableTime = now;
    return result;
  } catch {
    cachedAvailable = false;
    cachedAvailableTime = now;
    return false;
  }
}

// 下载图片到 Buffer
async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  // data URL
  if (imageUrl.startsWith('data:')) {
    const matches = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (matches) {
      return Buffer.from(matches[2], 'base64');
    }
    throw new Error('Invalid data URL format');
  }

  // blob URL
  if (imageUrl.startsWith('blob:')) {
    throw new Error('Blob URLs cannot be processed server-side');
  }

  // 本地路径
  if (imageUrl.startsWith('/')) {
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    const possiblePaths = [
      path.join(workspacePath, 'public', imageUrl),
      path.join(workspacePath, imageUrl),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p);
      }
    }
    // 尝试通过 localhost 下载
    try {
      const fullUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}`;
      const resp = await fetch(fullUrl, { signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        return Buffer.from(await resp.arrayBuffer());
      }
    } catch {
      // fall through
    }
    throw new Error(`Cannot access local image: ${imageUrl}`);
  }

  // 外部 URL
  const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`Failed to download image: HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

// GET: 获取可用模型和状态
export async function GET() {
  const available = await isUpscaleServerAvailable();

  // 从放大服务器获取模型列表
  let serverModels: string[] = [];
  if (available) {
    try {
      const resp = await fetch(`${UPSCALE_SERVER}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json() as { models?: string[] };
        serverModels = data.models || [];
      }
    } catch {
      // ignore
    }
  }

  // 使用服务器返回的模型列表，补充描述信息
  const models = (serverModels.length > 0 ? serverModels : Object.keys(UPSCAYL_MODELS)).map(id => {
    const info = UPSCAYL_MODELS[id];
    return {
      id,
      name: info?.name || id,
      description: info?.description || '',
      scale: info?.scale || 4,
    };
  });

  return NextResponse.json({
    available,
    models,
    engine: 'upscayl-ncnn-local',
  });
}

// POST: 执行放大
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageUrl, model, scale, customWidth, outputFormat } = body as {
      imageUrl: string;
      model?: string;
      scale?: number;
      customWidth?: number;
      outputFormat?: string;
    };

    if (!imageUrl) {
      return NextResponse.json({ error: '缺少图片URL' }, { status: 400 });
    }

    const modelName = model || 'realesrgan-x4fast';
    const modelInfo = UPSCAYL_MODELS[modelName];
    const upscaleScale = scale || modelInfo?.scale || 4;
    const format = outputFormat || 'png';

    // 检查放大服务器可用性
    const serverAvailable = await isUpscaleServerAvailable();
    if (!serverAvailable) {
      return NextResponse.json({
        error: 'Upscayl NCNN 本地引擎不可用，请确认放大服务已启动',
        fallback: true,
      }, { status: 503 });
    }

    // 获取原始图片
    const imageBuffer = await fetchImageBuffer(imageUrl);
    const metadata = await sharp(imageBuffer).metadata();
    const origWidth = metadata.width || 0;
    const origHeight = metadata.height || 0;

    // 如果图片太大，先缩小（放大服务器处理大图很慢）
    const MAX_INPUT_DIM = 2048;
    let processBuffer = imageBuffer;
    if (origWidth > MAX_INPUT_DIM || origHeight > MAX_INPUT_DIM) {
      const ratio = Math.min(MAX_INPUT_DIM / origWidth, MAX_INPUT_DIM / origHeight);
      const newW = Math.round(origWidth * ratio);
      const newH = Math.round(origHeight * ratio);
      processBuffer = await sharp(imageBuffer).resize(newW, newH).png().toBuffer();
    }

    // 将图片转为 base64 发送给放大服务器
    const base64Image = processBuffer.toString('base64');

    // 调用放大服务器
    const upscaleResp = await fetch(`${UPSCALE_SERVER}/api/v1/upscale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64Image,
        model: modelName,
        scale: upscaleScale,
      }),
      signal: AbortSignal.timeout(300000), // 5分钟超时
    });

    if (!upscaleResp.ok) {
      const errorText = await upscaleResp.text();
      throw new Error(`Upscale server error: ${errorText}`);
    }

    const upscaleResult = await upscaleResp.json() as {
      image?: string;
      originalSize?: { width: number; height: number };
      upscaledSize?: { width: number; height: number };
      engine?: string;
      elapsed?: number;
    };

    if (!upscaleResult.image) {
      throw new Error('Upscale server returned no image');
    }

    // 解码结果图片
    let resultBuffer: Buffer = Buffer.from(upscaleResult.image, 'base64');

    // 如果有自定义宽度，调整大小
    if (customWidth && customWidth > 0) {
      const resultMeta = await sharp(resultBuffer).metadata();
      const resultW = resultMeta.width || 1;
      const resultH = resultMeta.height || 1;
      const targetW = customWidth;
      const targetH = Math.round(resultH * (targetW / resultW));
      resultBuffer = await sharp(resultBuffer).resize(targetW, targetH).png().toBuffer();
    }

    // 转换输出格式
    if (format === 'jpg' || format === 'jpeg') {
      resultBuffer = await sharp(resultBuffer).jpeg({ quality: 90 }).toBuffer();
    } else if (format === 'webp') {
      resultBuffer = await sharp(resultBuffer).webp({ quality: 90 }).toBuffer();
    }

    // 保存到 public 目录
    const uploadsDir = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', 'upscayl');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const outputFilename = `upscayl_${Date.now()}_${modelName}_${upscaleScale}x.${format}`;
    const outputFilePath = path.join(uploadsDir, outputFilename);
    fs.writeFileSync(outputFilePath, resultBuffer);

    // 获取结果尺寸
    const resultMetadata = await sharp(resultBuffer).metadata();

    return NextResponse.json({
      success: true,
      imageUrl: `/upscayl/${outputFilename}`,
      originalSize: { width: origWidth, height: origHeight },
      upscaledSize: { width: resultMetadata.width, height: resultMetadata.height },
      model: modelName,
      scale: upscaleScale,
      engine: upscaleResult.engine || 'unknown',
      elapsed: upscaleResult.elapsed,
    });
  } catch (error: unknown) {
    console.error('[upscayl] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: `Upscayl 放大失败: ${message}`,
      fallback: message.includes('不可用') || message.includes('not found') || message.includes('Blob'),
    }, { status: 500 });
  }
}
