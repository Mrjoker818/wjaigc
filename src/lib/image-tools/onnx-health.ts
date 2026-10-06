import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PYTHON_BIN } from './config';

export function getOnnxModelsDir(): string {
  const envDir = process.env.ONNX_MODELS_DIR;
  if (envDir && fs.existsSync(/* turbopackIgnore: true */ envDir)) return envDir;
  const persistentCandidates = [
    process.env.UPSCAYL_MODELS_DIR,
    '/space/upscayl-models',
    '/space/onnx-models',
    path.join(process.cwd(), 'onnx-models'),
  ].filter(Boolean) as string[];
  const existing = persistentCandidates.find(dir =>
    fs.existsSync(/* turbopackIgnore: true */ dir)
    && fs.readdirSync(/* turbopackIgnore: true */ dir).some(file => file.includes('realesrgan'))
  );
  if (existing) return existing;
  return path.join(process.cwd(), 'onnx-models');
}

/** 检查 ONNX 放大是否可用（模型文件 + Python + onnxruntime） */
export async function isOnnxUpscaleAvailable(): Promise<{
  available: boolean;
  model?: string;
  error?: string;
}> {
  const modelsDir = getOnnxModelsDir();
  if (!fs.existsSync(/* turbopackIgnore: true */ modelsDir)) {
    return { available: false, error: 'ONNX 模型目录不存在' };
  }

  const modelFile = 'realesrgan-x4plus-fp16.onnx';
  const altModel = 'realesrgan-x4plus.onnx';
  let foundModel = modelFile;
  if (!fs.existsSync(/* turbopackIgnore: true */ path.join(modelsDir, modelFile))) {
    if (!fs.existsSync(/* turbopackIgnore: true */ path.join(modelsDir, altModel))) {
      return { available: false, error: `ONNX 模型文件不存在 (${modelFile} / ${altModel})` };
    }
    foundModel = altModel;
  }

  try {
    const result = await new Promise<{ installed: boolean; version?: string }>((resolve) => {
      let settled = false;
      const proc = spawn(PYTHON_BIN, ['-c', 'import onnxruntime; print(onnxruntime.__version__)'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { proc.kill('SIGKILL'); } catch {}
          resolve({ installed: false });
        }
      }, 10000);
      let stdout = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', () => {});
      proc.on('close', (code: number | null) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ installed: code === 0 && Boolean(stdout.trim()), version: stdout.trim() });
        }
      });
      proc.on('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ installed: false });
        }
      });
    });

    if (!result.installed) {
      return { available: false, error: 'Python onnxruntime 未安装 (pip install onnxruntime)' };
    }
  } catch {
    return { available: false, error: 'Python 环境不可用' };
  }

  return { available: true, model: foundModel };
}
