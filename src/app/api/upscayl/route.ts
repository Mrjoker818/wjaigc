import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { saveImageFile } from '@/lib/server-data-root';
import sharp from 'sharp';

// Upscayl 模型描述信息 (基于 upscayl/upscayl-ncnn Real-ESRGAN)
const UPSCAYL_MODELS: Record<string, { name: string; description: string; scale: number }> = {
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
  'realesrnet-x4plus': {
    name: '降噪修复',
    description: '适合有噪点、压缩伪影的图片',
    scale: 4,
  },
  'realesrgan-x4plus-anime': {
    name: '动漫增强',
    description: '动漫、插画、二次元图片专用',
    scale: 4,
  },
  'realesr-animevideov3': {
    name: '视频帧增强',
    description: '适合视频截图和动画帧放大',
    scale: 2,
  },
  'remacri': {
    name: 'Remacri 高保真',
    description: '高保真细节恢复，适合纹理丰富的图片',
    scale: 4,
  },
  'ultrasharp': {
    name: 'UltraSharp 锐利',
    description: '极致锐利细节增强，适合文字和线条',
    scale: 4,
  },
  'ultramix-balanced': {
    name: 'UltraMix 均衡',
    description: '均衡放大，兼顾清晰度和自然感',
    scale: 4,
  },
  'hfa2k': {
    name: 'HFA2k 艺术',
    description: '高保真艺术风格放大，适合绘画和设计',
    scale: 4,
  },
};

// 查找 upscayl-ncnn 二进制文件路径
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

// 查找模型目录
function getModelsPath(): string {
  const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';

  // 优先级1: 项目 upscayl-models 目录
  const modelsDir = path.join(workspacePath, 'upscayl-models');
  if (fs.existsSync(modelsDir)) {
    const files = fs.readdirSync(modelsDir);
    if (files.some(f => f.endsWith('.param'))) return modelsDir;
  }

  // 优先级2: upscayl-node 包内嵌的模型
  const nodeModulesPath = path.join(workspacePath, 'node_modules', '.pnpm');
  if (fs.existsSync(nodeModulesPath)) {
    const dirs = fs.readdirSync(nodeModulesPath).filter(d => d.startsWith('upscayl-node'));
    for (const dir of dirs) {
      const bundled = path.join(
        nodeModulesPath, dir, 'node_modules', 'upscayl-node',
        'dist', 'upscaler', 'sub-classes', 'model-manager', 'models'
      );
      if (fs.existsSync(bundled)) return bundled;
    }
  }

  return '';
}

// 缓存可用性检测结果
let cachedAvailable: boolean | null = null;
let cachedAvailableTime = 0;
const AVAILABILITY_CACHE_MS = 60000; // 1分钟缓存

// 检测 upscayl 是否可用
async function isUpscaylAvailable(): Promise<boolean> {
  // 使用缓存
  const now = Date.now();
  if (cachedAvailable !== null && (now - cachedAvailableTime) < AVAILABILITY_CACHE_MS) {
    return cachedAvailable;
  }

  const binPath = getUpscaylBinPath();
  if (!binPath) { cachedAvailable = false; cachedAvailableTime = now; return false; }
  const modelsPath = getModelsPath();
  if (!modelsPath) { cachedAvailable = false; cachedAvailableTime = now; return false; }

  // 检查是否有至少一个 .param 模型文件
  try {
    const files = fs.readdirSync(modelsPath);
    if (!files.some(f => f.endsWith('.param'))) {
      cachedAvailable = false; cachedAvailableTime = now; return false;
    }
  } catch {
    cachedAvailable = false; cachedAvailableTime = now; return false;
  }

  // 检查二进制是否可执行
  try {
    const result = await new Promise<boolean>((resolve) => {
      const proc = spawn(binPath, ['-h']);
      const timeout = setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 5000);
      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
      proc.on('close', (code) => {
        clearTimeout(timeout);
        resolve(true); // 只要能执行就说明可用
      });
    });
    cachedAvailable = result;
    cachedAvailableTime = now;
    return result;
  } catch {
    cachedAvailable = false;
    cachedAvailableTime = now;
    return false;
  }
}

// 获取实际可用的模型列表
function getAvailableModels(): string[] {
  const modelsPath = getModelsPath();
  if (!modelsPath) return [];
  try {
    const files = fs.readdirSync(modelsPath);
    const paramFiles = files.filter(f => f.endsWith('.param'));
    return paramFiles.map(f => f.replace('.param', ''));
  } catch {
    return [];
  }
}

// 运行 upscayl 放大
async function runUpscayl(
  inputPath: string,
  outputPath: string,
  modelName: string,
  scale: number,
  tileSize: number,
  customWidth?: number,
  compression: number = 90,
): Promise<string> {
  const binPath = getUpscaylBinPath();
  const modelsPath = getModelsPath();

  if (!binPath) throw new Error('Upscayl binary not found');
  if (!modelsPath) throw new Error('Upscayl models not found');

  const modelInfo = UPSCAYL_MODELS[modelName];
  const modelScale = modelInfo?.scale || 4;
  // 如果请求的 scale 和模型原生 scale 不同，需要显式指定 -s
  const includeScale = modelScale !== scale && !customWidth;

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

  if (customWidth) {
    args.push('-w', customWidth.toString());
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

    // 超时（5分钟）
    setTimeout(() => {
      proc.kill();
      if (fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error('Upscayl timed out after 5 minutes'));
      }
    }, 300000);
  });
}

// 下载图片到临时文件 - 支持多种URL类型
async function downloadImageToTemp(imageUrl: string, tmpDir: string): Promise<{ inputPath: string; isLocal: boolean }> {
  // data URL
  if (imageUrl.startsWith('data:')) {
    const matches = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (matches) {
      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      const inputPath = path.join(tmpDir, `input.${ext}`);
      fs.writeFileSync(inputPath, buffer);
      return { inputPath, isLocal: false };
    }
    throw new Error('Invalid data URL format');
  }

  // blob URL (blob:...) - 无法在服务器端访问
  if (imageUrl.startsWith('blob:')) {
    throw new Error('Blob URLs cannot be processed server-side. Please provide an accessible image URL.');
  }

  // 本地路径 (/upscayl/..., /uploads/..., etc.)
  if (imageUrl.startsWith('/')) {
    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    // 尝试多种路径映射
    const possiblePaths = [
      path.join(workspacePath, 'public', imageUrl),
      path.join(workspacePath, imageUrl),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const ext = path.extname(p).slice(1) || 'png';
        const inputPath = path.join(tmpDir, `input.${ext}`);
        fs.copyFileSync(p, inputPath);
        return { inputPath, isLocal: true };
      }
    }
    // 尝试作为 URL 下载 (localhost)
    try {
      const fullUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}`;
      const resp = await fetch(fullUrl, { signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const buffer = Buffer.from(await resp.arrayBuffer());
        const ext = imageUrl.split('.').pop()?.toLowerCase() || 'png';
        const inputPath = path.join(tmpDir, `input.${ext}`);
        fs.writeFileSync(inputPath, buffer);
        return { inputPath, isLocal: false };
      }
    } catch {
      // fall through
    }
    throw new Error(`Cannot access local image: ${imageUrl}`);
  }

  // 外部 URL
  const ext = imageUrl.split('.').pop()?.split('?')[0]?.toLowerCase() || 'png';
  const inputPath = path.join(tmpDir, `input.${ext === 'jpeg' ? 'jpg' : ext}`);
  const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`Failed to download image: HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(inputPath, buffer);
  return { inputPath, isLocal: false };
}

// GET: 获取可用模型和状态
export async function GET() {
  const upscaylEndpoint = process.env.UPSCAYL_ENDPOINT || '';

  // 优先检查外部 Upscayl 服务
  if (upscaylEndpoint) {
    try {
      const resp = await fetch(`${upscaylEndpoint}/health`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const health = await resp.json() as { upscayl_available?: boolean; available_models?: string[] };
        if (health.upscayl_available) {
          // 从外部服务获取模型列表
          try {
            const modelsResp = await fetch(`${upscaylEndpoint}/models`, { signal: AbortSignal.timeout(5000) });
            if (modelsResp.ok) {
              const modelsData = await modelsResp.json() as { models: Array<{ id: string; name: string; description: string; scale: number }> };
              return NextResponse.json({
                available: true,
                models: modelsData.models,
                source: 'external',
                endpoint: upscaylEndpoint,
              });
            }
          } catch { /* fall back to local models */ }

          // 使用外部服务但用本地模型描述
          const availableModelIds = health.available_models || Object.keys(UPSCAYL_MODELS);
          const models = availableModelIds.map(id => {
            const info = UPSCAYL_MODELS[id];
            return {
              id,
              name: info?.name || id,
              description: info?.description || '',
              scale: info?.scale || 4,
            };
          });
          return NextResponse.json({
            available: true,
            models,
            source: 'external',
            endpoint: upscaylEndpoint,
          });
        }
      }
    } catch { /* external service not reachable, fall through to local */ }
  }

  // 本地 Upscayl
  const available = await isUpscaylAvailable();
  const availableModelIds = getAvailableModels();

  const models = availableModelIds.map(id => {
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
    source: 'local',
    binPath: getUpscaylBinPath() || null,
    modelsPath: getModelsPath() || null,
  });
}

// POST: 执行放大
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageUrl, model, scale, tileSize, customWidth, compression, outputFormat } = body as {
      imageUrl: string;
      model?: string;
      scale?: number;
      tileSize?: number;
      customWidth?: number;
      compression?: number;
      outputFormat?: string;
    };

    if (!imageUrl) {
      return NextResponse.json({ error: '缺少图片URL' }, { status: 400 });
    }

    const modelName = model || 'realesrgan-x4fast';
    const upscaleScale = scale || 2;
    const tile = tileSize || 0;
    const compress = compression ?? 90;
    const format = outputFormat || 'png';

    // 优先使用外部 Upscayl 服务
    const upscaylEndpoint = process.env.UPSCAYL_ENDPOINT || '';
    if (upscaylEndpoint) {
      try {
        const resp = await fetch(`${upscaylEndpoint}/upscale`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: imageUrl,
            model: modelName,
            scale: upscaleScale,
            tile_size: tile,
            output_format: format,
            compression: compress,
          }),
          signal: AbortSignal.timeout(300000), // 5分钟超时
        });
        if (resp.ok) {
          const result = await resp.json() as {
            success: boolean;
            image_url?: string;
            original_size?: { width: number; height: number };
            upscaled_size?: { width: number; height: number };
            error?: string;
          };
          if (result.success && result.image_url) {
            // 如果外部服务返回的是相对路径，拼接完整URL
            let resultImageUrl = result.image_url;
            if (resultImageUrl.startsWith('/')) {
              resultImageUrl = `${upscaylEndpoint}${resultImageUrl}`;
            }
            return NextResponse.json({
              success: true,
              imageUrl: resultImageUrl,
              originalSize: result.original_size || null,
              upscaledSize: result.upscaled_size || null,
              model: modelName,
              scale: upscaleScale,
              source: 'external',
            });
          }
          // 外部服务返回失败，继续尝试本地
          console.log('[upscayl] External service returned failure, falling back to local');
        }
      } catch (err) {
        console.log('[upscayl] External service not reachable, falling back to local:', err instanceof Error ? err.message : err);
      }
    }

    // 本地 Upscayl
    const available = await isUpscaylAvailable();
    if (!available) {
      return NextResponse.json({
        error: 'Upscayl NCNN 不可用，请确保已安装 Vulkan 运行时或 Mesa 驱动',
        fallback: true,
      }, { status: 503 });
    }

    // 创建临时目录
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upscayl-'));

    try {
      // 下载原始图片
      const { inputPath } = await downloadImageToTemp(imageUrl, tmpDir);

      // 获取原始图片尺寸
      const imageBuffer = await fs.promises.readFile(inputPath);
      const metadata = await sharp(imageBuffer).metadata();
      const origWidth = metadata.width || 0;
      const origHeight = metadata.height || 0;

      // 如果图片太大，先缩小到合理范围再放大（NCNN CPU模式处理大图很慢）
      const MAX_INPUT_DIM = 2048;
      let processInputPath = inputPath;
      if (origWidth > MAX_INPUT_DIM || origHeight > MAX_INPUT_DIM) {
        const ratio = Math.min(MAX_INPUT_DIM / origWidth, MAX_INPUT_DIM / origHeight);
        const newW = Math.round(origWidth * ratio);
        const newH = Math.round(origHeight * ratio);
        const resizedPath = path.join(tmpDir, 'input_resized.png');
        await sharp(imageBuffer).resize(newW, newH).png().toFile(resizedPath);
        processInputPath = resizedPath;
      }

      // 执行放大
      const outputPath = path.join(tmpDir, `output.${format}`);
      const effectiveWidth = customWidth || undefined;
      const resultPath = await runUpscayl(
        processInputPath,
        outputPath,
        modelName,
        upscaleScale,
        tile,
        effectiveWidth,
        compress,
      );

      // 读取结果
      if (!fs.existsSync(resultPath)) {
        throw new Error('Upscayl output file not found');
      }

      const resultBuffer = await fs.promises.readFile(resultPath);
      const resultMetadata = await sharp(resultBuffer).metadata();

      // 转换输出格式（如果需要）
      let finalBuffer: Buffer = resultBuffer;
      if (format === 'jpg' || format === 'jpeg') {
        finalBuffer = await sharp(resultBuffer).jpeg({ quality: compress }).toBuffer();
      } else if (format === 'webp') {
        finalBuffer = await sharp(resultBuffer).webp({ quality: compress }).toBuffer();
      }

      // 保存结果文件
      const outputFilename = `upscayl_${Date.now()}_${modelName}_${upscaleScale}x.${format}`;
      const imageUrlResult = await saveImageFile(finalBuffer, outputFilename, 'upscayl');

      // 清理临时文件
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

      return NextResponse.json({
        success: true,
        imageUrl: imageUrlResult,
        originalSize: { width: origWidth, height: origHeight },
        upscaledSize: { width: resultMetadata.width, height: resultMetadata.height },
        model: modelName,
        scale: upscaleScale,
      });
    } catch (innerError) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      throw innerError;
    }
  } catch (error: unknown) {
    console.error('[upscayl] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: `Upscayl 放大失败: ${message}`,
      fallback: message.includes('not found') || message.includes('不可用') || message.includes('Blob'),
    }, { status: 500 });
  }
}
