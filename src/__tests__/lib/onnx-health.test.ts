import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { getOnnxModelsDir, isOnnxUpscaleAvailable } from '@/lib/image-tools/onnx-health';

const originalOnnxModelsDir = process.env.ONNX_MODELS_DIR;
let testModelsDir: string | undefined;

afterEach(async () => {
  if (originalOnnxModelsDir === undefined) delete process.env.ONNX_MODELS_DIR;
  else process.env.ONNX_MODELS_DIR = originalOnnxModelsDir;
  if (testModelsDir) {
    await rm(testModelsDir, { recursive: true, force: true });
    testModelsDir = undefined;
  }
});

it('checks the explicitly configured ONNX directory without starting Python when models are absent', async () => {
  testModelsDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-onnx-health-'));
  process.env.ONNX_MODELS_DIR = testModelsDir;

  expect(getOnnxModelsDir()).toBe(testModelsDir);
  expect(await isOnnxUpscaleAvailable()).toEqual({
    available: false,
    error: 'ONNX 模型文件不存在 (realesrgan-x4plus-fp16.onnx / realesrgan-x4plus.onnx)',
  });
});
