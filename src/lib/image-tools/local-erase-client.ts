import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { IOPAINT_MODELS_DIR, PYTHON_BIN } from './config';
import { withLocalInferenceLock } from './concurrency-gate';

const ERASE_SCRIPT = path.join(process.cwd(), 'scripts', 'iopaint_erase.py');

export const ERASE_MODELS = [
  {
    id: 'lama' as const,
    label: 'LaMa',
    description: '深度学习通用擦除，质量优于传统算法',
    recommended: true,
    files: ['big-lama.pt'],
  },
  {
    id: 'zits' as const,
    label: 'ZITS',
    description: '结构感知修复，适合直线与几何结构',
    files: [
      'zits-wireframe-0717.pt',
      'zits-edge-line-0717.pt',
      'zits-structure-upsample-0717.pt',
      'zits-inpaint-0717.pt',
    ],
  },
  {
    id: 'anime-lama' as const,
    label: 'Anime LaMa',
    description: '动漫插画专用擦除',
    files: ['anime-manga-big-lama.pt'],
  },
] as const;

export const VALID_ERASE_MODELS: readonly string[] = ERASE_MODELS.map(model => model.id);

export interface InpaintResult {
  success: boolean;
  imageUrl?: string;
  engine?: string;
  error?: string;
}

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `local erase exited with ${code}`));
    });
  });
}

function resolveModelFile(filename: string): string | null {
  const candidates = [
    path.join(IOPAINT_MODELS_DIR, filename),
    path.join(IOPAINT_MODELS_DIR, 'hub', 'checkpoints', filename),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

async function runEraseTask(
  imageBuffer: Buffer,
  maskBuffer: Buffer,
  eraseModel: string,
): Promise<InpaintResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-erase-'));
  const imagePath = path.join(tempDir, 'input.png');
  const maskPath = path.join(tempDir, 'mask.png');
  const outputPath = path.join(tempDir, 'output.png');

  try {
    await Promise.all([writeFile(imagePath, imageBuffer), writeFile(maskPath, maskBuffer)]);
    const stdout = await runPython([ERASE_SCRIPT, imagePath, maskPath, outputPath, eraseModel]);
    const result = await readFile(outputPath);
    const methodMatch = stdout.match(/method=([a-zA-Z0-9-]+)/);
    const engine = methodMatch ? methodMatch[1] : 'opencv-telea';
    return {
      success: true,
      imageUrl: `data:image/png;base64,${result.toString('base64')}`,
      engine,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '本地擦除失败' };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function eraseWithLama(
  imageBuffer: Buffer,
  maskBuffer: Buffer,
  _imageWidth: number,
  _imageHeight: number,
  _eraseModel: string = 'lama',
): Promise<InpaintResult> {
  const model = VALID_ERASE_MODELS.includes(_eraseModel) ? _eraseModel : 'lama';
  return withLocalInferenceLock(() => runEraseTask(imageBuffer, maskBuffer, model));
}

export async function checkLocalEraseHealth(): Promise<{
  available: boolean;
  baseUrl: string;
  model: string;
  error?: string;
}> {
  const cv2Available = await runPython(['-c', 'import cv2; import numpy'])
    .then(() => true)
    .catch(() => false);
  if (!cv2Available) {
    return {
      available: false,
      baseUrl: 'local-process',
      model: 'opencv-telea',
      error: 'Python 环境缺少 opencv/numpy',
    };
  }

  const torchAvailable = await runPython([
    '-c',
    "import importlib.util, sys, os; sys.path.insert(0, '/opt/torch-site'); sys.exit(0 if os.path.isdir('/opt/torch-site/torch') and importlib.util.find_spec('torch') else 1)",
  ])
    .then(() => true)
    .catch(() => false);
  const lamaModelAvailable = resolveModelFile('big-lama.pt') !== null;
  const model = torchAvailable && lamaModelAvailable ? 'lama' : 'opencv-telea';

  return {
    available: true,
    baseUrl: 'local-process',
    model,
    ...(model === 'opencv-telea' && torchAvailable
      ? { error: 'torch 可用但 LaMa 模型文件缺失，当前使用 OpenCV 兜底' }
      : {}),
  };
}
