import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/image-tools/local-erase-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/image-tools/local-erase-client')>();
  return {
    ...actual,
    checkLocalEraseHealth: async () => ({ available: false, baseUrl: 'local-process', model: 'opencv-telea' }),
  };
});
vi.mock('@/lib/image-tools/rembg-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/image-tools/rembg-client')>();
  return { ...actual, checkRembgHealth: async () => ({ available: false }) };
});
vi.mock('@/lib/image-tools/onnx-health', () => ({
  isOnnxUpscaleAvailable: async () => ({ available: false, error: 'test runtime unavailable' }),
}));

const originalModelsDir = process.env.IOPAINT_MODELS_DIR;
let testModelsDir: string | undefined;

afterEach(async () => {
  if (originalModelsDir === undefined) delete process.env.IOPAINT_MODELS_DIR;
  else process.env.IOPAINT_MODELS_DIR = originalModelsDir;
  vi.resetModules();
  if (testModelsDir) {
    await rm(testModelsDir, { recursive: true, force: true });
    testModelsDir = undefined;
  }
});

it('reports a valid LaMa model in the hub checkpoints directory', async () => {
  testModelsDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-health-models-'));
  const checkpointsDir = path.join(testModelsDir, 'hub', 'checkpoints');
  await mkdir(checkpointsDir, { recursive: true });
  const modelPath = path.join(checkpointsDir, 'big-lama.pt');
  await writeFile(modelPath, Buffer.alloc(1_000_001));
  process.env.IOPAINT_MODELS_DIR = testModelsDir;
  vi.resetModules();

  const { GET } = await import('@/app/api/image/health/route');
  const response = await GET();
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.lamaModel).toMatchObject({ available: true, path: modelPath, size: '1.0MB' });
  expect(body.eraseModels.find((model: { id: string }) => model.id === 'lama')).toMatchObject({
    available: true,
    path: modelPath,
    size: 1_000_001,
  });
});
