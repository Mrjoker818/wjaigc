import { spawn } from 'child_process';
import path from 'path';

import { LOCAL_AI_ENABLED, PYTHON_BIN, REMOVEBG_MODELS_DIR } from './config';

export const REMBG_CPU_MODELS = [
  { id: 'birefnet-general', label: 'BiRefNet 通用', description: '完整通用模型，优先保留主体和细节', size: '约 1GB', recommended: true },
  { id: 'birefnet-portrait', label: 'BiRefNet 人像', description: '针对头发和人物边缘优化', size: '约 1GB' },
  { id: 'birefnet-massive', label: 'BiRefNet Massive', description: '复杂主体优先，CPU 处理时间更长', size: '约 1GB+' },
] as const;

export type RembgCpuModelId = (typeof REMBG_CPU_MODELS)[number]['id'];
export const DEFAULT_REMBG_MODEL: RembgCpuModelId = 'birefnet-general';

const REMBG_REMOVE_BACKGROUND_SCRIPT = path.join(process.cwd(), 'scripts', 'rembg_remove_background.py');
const REMBG_TIMEOUT_MS = 180_000;

interface RembgScriptResult {
  success: boolean;
  rgbaBase64?: string;
  maskBase64?: string;
  model?: string;
  error?: string;
}

export function isRembgCpuModel(model: string): model is RembgCpuModelId {
  return REMBG_CPU_MODELS.some(candidate => candidate.id === model);
}

export async function checkRembgHealth(): Promise<{ available: boolean; error?: string }> {
  if (!LOCAL_AI_ENABLED) return { available: false, error: 'LOCAL_AI_ENABLED 未启用' };

  return new Promise(resolve => {
    const child = spawn(PYTHON_BIN, ['-c', 'import rembg'], { stdio: 'ignore' });
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ available: false, error: 'rembg 环境检测超时' });
    }, 10_000);
    child.once('error', error => {
      clearTimeout(timeout);
      resolve({ available: false, error: error.message });
    });
    child.once('close', code => {
      clearTimeout(timeout);
      resolve(code === 0 ? { available: true } : { available: false, error: 'Python 环境缺少 rembg[cpu]' });
    });
  });
}

export async function generateRembgMask(
  imageBuffer: Buffer,
  model: string = DEFAULT_REMBG_MODEL,
): Promise<RembgScriptResult> {
  if (!LOCAL_AI_ENABLED) return { success: false, error: 'LOCAL_AI_ENABLED 未启用' };

  const modelId = isRembgCpuModel(model) ? model : DEFAULT_REMBG_MODEL;
  const input = JSON.stringify({ image: imageBuffer.toString('base64'), model: modelId });

  return new Promise(resolve => {
    const child = spawn(PYTHON_BIN, [REMBG_REMOVE_BACKGROUND_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        U2NET_HOME: REMOVEBG_MODELS_DIR,
        REMOVEBG_MODELS_DIR,
      },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: RembgScriptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ success: false, error: `CPU 去背景超时（${REMBG_TIMEOUT_MS / 1000}s）` });
    }, REMBG_TIMEOUT_MS);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => finish({ success: false, error: error.message }));
    child.once('close', code => {
      if (settled) return;
      try {
        const result = JSON.parse(stdout) as RembgScriptResult;
        finish(result.success ? result : { success: false, error: result.error || stderr || `rembg exited with ${code}` });
      } catch {
        finish({ success: false, error: stderr || `rembg returned invalid output (exit ${code})` });
      }
    });
    child.stdin.end(input);
  });
}
