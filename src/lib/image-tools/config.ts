// ============================================================
// Image Tools — Configuration
// ============================================================

import { accessSync } from 'fs';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'path';
import { getServerDataRoot } from '../server-data-root';

/** 项目根目录下的 public 目录（开发模式HMR用） */
export const PUBLIC_DIR = path.join(process.cwd(), 'public');

/**
 * 统一输出目录 — 生产环境使用持久化 uploads/，开发环境使用 public/outputs/
 * 返回 [实际存储目录, URL前缀]
 */
function resolveOutputDir(subdir: string): { dir: string; urlPrefix: string } {
  const isProd = process.env.COZE_PROJECT_ENV === 'PROD';
  if (isProd) {
    const dir = path.join(/* turbopackIgnore: true */ getServerDataRoot(), 'uploads', subdir);
    return { dir, urlPrefix: `/api/serve-upload/uploads/${subdir}` };
  }
  // 开发环境：写 public/outputs，Next.js HMR 直接访问
  const dir = path.join(PUBLIC_DIR, 'outputs', subdir);
  return { dir, urlPrefix: `/outputs/${subdir}` };
}

/** 放大输出目录 */
const _upscaleDir = resolveOutputDir('upscale');
export const UPSCALE_OUTPUT_DIR = _upscaleDir.dir;
export const UPSCALE_OUTPUT_URL_PREFIX = _upscaleDir.urlPrefix;


/** 修复输出目录 */
const _inpaintDir = resolveOutputDir('inpaint');
export const INPAINT_OUTPUT_DIR = _inpaintDir.dir;
export const INPAINT_OUTPUT_URL_PREFIX = _inpaintDir.urlPrefix;

/** 临时文件目录 */
const _tempDir = resolveOutputDir('temp');
export const TEMP_DIR = _tempDir.dir;

/** 最大上传文件大小 MB */
export const IMAGE_MAX_SIZE_MB = parseInt(
  process.env.IMAGE_MAX_SIZE_MB || '20',
  10,
);

/** 最大图片边长 px */
export const IMAGE_MAX_EDGE = parseInt(
  process.env.IMAGE_MAX_EDGE || '2048',
  10,
);

/** Python 解释器路径（优先使用 /space 持久化虚拟环境，再检查项目 .venv，最后回退系统 python3） */
const SPACE_VENV_PYTHON = '/space/python-venv/bin/python3';
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')
  : path.join(process.cwd(), '.venv', 'bin', 'python3');
const SYSTEM_PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const VENV_EXISTS = (() => {
  try {
    accessSync(VENV_PYTHON);
    return true;
  } catch {
    return false;
  }
})();
const SPACE_VENV_EXISTS = (() => {
  try {
    accessSync(SPACE_VENV_PYTHON);
    return true;
  } catch {
    return false;
  }
})();
export const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  (SPACE_VENV_EXISTS ? SPACE_VENV_PYTHON : VENV_EXISTS ? VENV_PYTHON : SYSTEM_PYTHON);

export const LOCAL_AI_ENABLED = process.env.LOCAL_AI_ENABLED === 'true';
export const ONNX_MODELS_DIR = path.resolve(/* turbopackIgnore: true */ process.env.ONNX_MODELS_DIR || 'onnx-models');
export const ONNX_MODEL_SHA256 = process.env.ONNX_MODEL_SHA256?.trim() ?? '';
export const ONNX_MODEL = 'realesrgan-x4plus';
export const ONNX_WORKER = process.env.ONNX_WORKER?.trim()
  || path.join(process.cwd(), 'scripts', 'upscale_onnx.py');
export const ONNX_WORKER_ENV = {
  LOCAL_AI_ENABLED: 'true',
  ONNX_MODELS_DIR,
  ONNX_MODEL_SHA256,
};
export const IOPAINT_WORKER = process.env.IOPAINT_WORKER?.trim() ?? '';
export const IOPAINT_MODELS_DIR = process.env.IOPAINT_MODELS_DIR?.trim() ?? '';
export const REMBG_WORKER = process.env.REMBG_WORKER?.trim() ?? '';
export const REMOVEBG_MODELS_DIR = process.env.REMOVEBG_MODELS_DIR?.trim() ?? '';
export const LOCAL_WORKER_MAX_PNG_BYTES = 32 * 1024 * 1024;

export async function hasLocalFile(file: string): Promise<boolean> {
  if (!path.isAbsolute(file)) return false;
  const info = await stat(/* turbopackIgnore: true */ file).catch(() => null);
  return Boolean(info?.isFile() && info.size > 0);
}

export async function isOnnxConfigured(): Promise<boolean> {
  return LOCAL_AI_ENABLED && /^[a-f0-9]{64}$/i.test(ONNX_MODEL_SHA256)
    && await hasLocalFile(ONNX_WORKER)
    && await hasLocalFile(path.join(ONNX_MODELS_DIR, `${ONNX_MODEL}.onnx`));
}

let inferenceActive = false;

/** Share one bounded CPU worker slot across tools and readiness probes. */
export async function runLocalPython(
  args: string[],
  options: { timeout: number; input?: string; env?: Record<string, string>; maxBuffer?: number },
): Promise<string> {
  if (!LOCAL_AI_ENABLED || inferenceActive) throw new Error('Local inference is disabled or busy');
  inferenceActive = true;
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = execFile(PYTHON_BIN, args, {
        timeout: options.timeout,
        killSignal: 'SIGKILL',
        maxBuffer: options.maxBuffer ?? 128 * 1024,
        encoding: 'utf8',
        windowsHide: true,
        env: {
          NODE_ENV: process.env.NODE_ENV || 'production',
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          TMPDIR: process.env.TMPDIR,
          PYTHONUTF8: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          OMP_NUM_THREADS: '4',
          MKL_NUM_THREADS: '4',
          OPENBLAS_NUM_THREADS: '4',
          ...options.env,
        },
      }, (error, stdout) => {
        if (error) reject(new Error('Local inference process failed'));
        else resolve(stdout);
      });
      child.stdin?.on('error', () => { /* A worker can exit before consuming stdin. */ });
      child.stdin?.end(options.input);
    });
  } finally {
    inferenceActive = false;
  }
}
