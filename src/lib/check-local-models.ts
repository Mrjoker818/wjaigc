import {
  isOnnxConfigured, LOCAL_AI_ENABLED, ONNX_MODEL, ONNX_WORKER, ONNX_WORKER_ENV, runLocalPython,
} from './image-tools/config';
import { checkLocalEraseHealth, LOCAL_ERASE_MODEL } from './image-tools/local-erase-client';
import { checkRembgHealth, LOCAL_REMBG_MODEL } from './image-tools/rembg-client';

async function checkOnnxHealth(): Promise<boolean> {
  if (!await isOnnxConfigured()) return false;
  try {
    const output = JSON.parse(await runLocalPython([ONNX_WORKER, '--check'],
      { timeout: 15_000, env: ONNX_WORKER_ENV }));
    return output?.success === true && output.model === ONNX_MODEL;
  } catch {
    return false;
  }
}

export async function checkLocalModels() {
  // These share a single CPU slot. Probe them sequentially.
  return {
    localAiEnabled: LOCAL_AI_ENABLED,
    upscale: { onnx: { available: await checkOnnxHealth(), model: ONNX_MODEL } },
    localErase: { available: await checkLocalEraseHealth(), model: LOCAL_ERASE_MODEL },
    removebg: { available: await checkRembgHealth(), model: LOCAL_REMBG_MODEL },
  };
}
