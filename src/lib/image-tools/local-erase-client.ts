import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { PYTHON_BIN } from './config';

const ERASE_SCRIPT = path.join(process.cwd(), 'scripts', 'iopaint_erase.py');

export const ERASE_MODELS = [
  { id: 'lama' as const, label: '本地擦除', description: '基于 OpenCV 的本地擦除', recommended: true, files: [] },
];

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
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve('');
      else reject(new Error(stderr || `local erase exited with ${code}`));
    });
  });
}

export async function eraseWithLama(
  imageBuffer: Buffer,
  maskBuffer: Buffer,
  _imageWidth: number,
  _imageHeight: number,
  _eraseModel: string = 'lama',
): Promise<InpaintResult> {
  void _eraseModel;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-erase-'));
  const imagePath = path.join(tempDir, 'input.png');
  const maskPath = path.join(tempDir, 'mask.png');
  const outputPath = path.join(tempDir, 'output.png');

  try {
    await Promise.all([writeFile(imagePath, imageBuffer), writeFile(maskPath, maskBuffer)]);
    await runPython([ERASE_SCRIPT, imagePath, maskPath, outputPath]);
    const result = await readFile(outputPath);
    return {
      success: true,
      imageUrl: `data:image/png;base64,${result.toString('base64')}`,
      engine: 'opencv-telea',
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '本地擦除失败' };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function checkLocalEraseHealth(): Promise<{ available: boolean; baseUrl: string; model: string; error?: string }> {
  try {
    await runPython(['-c', 'import cv2; import numpy']);
    return { available: true, baseUrl: 'local-process', model: 'opencv-telea' };
  } catch (error) {
    return { available: false, baseUrl: 'local-process', model: 'opencv-telea', error: error instanceof Error ? error.message : 'Python 环境不可用' };
  }
}
