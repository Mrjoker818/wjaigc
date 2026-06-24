// ============================================================
// Image Tools — Configuration
// ============================================================

import fs from 'fs';
import path from 'path';

let _serverDataRootCache: string | null = null;
function getServerDataRootSync(): string {
  if (_serverDataRootCache) return _serverDataRootCache;
  // 服务器持久化目录，与 getServerDataRoot() 保持一致
  const env = process.env.COZE_PROJECT_ENV;
  if (env === 'PROD') {
    _serverDataRootCache = process.env.SERVER_DATA_ROOT || '/space/wujie-data';
  } else {
    _serverDataRootCache = process.env.COZE_WORKSPACE_PATH
      ? path.join(process.env.COZE_WORKSPACE_PATH, '.wujie-data')
      : path.join(process.cwd(), '.wujie-data');
  }
  return _serverDataRootCache;
}

/** 项目根目录下的 public 目录（开发模式HMR用） */
export const PUBLIC_DIR = path.join(process.cwd(), 'public');

/**
 * 统一输出目录 — 生产环境使用持久化 uploads/，开发环境使用 public/outputs/
 * 返回 [实际存储目录, URL前缀]
 */
function resolveOutputDir(subdir: string): { dir: string; urlPrefix: string } {
  const isProd = process.env.COZE_PROJECT_ENV === 'PROD';
  if (isProd) {
    const dir = path.join(getServerDataRootSync(), 'uploads', subdir);
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

/** 放大模型目录 (优先使用 /space 持久存储，不受沙箱重启影响) */
export const UPSCAYL_MODELS_DIR =
  process.env.UPSCAYL_MODELS_DIR ||
  (fs.existsSync('/space/upscayl-models')
    ? '/space/upscayl-models'
    : path.join(process.cwd(), 'models', 'upscayl'));

/** IOPaint / LaMa / RemoveBG 模型根目录 (优先使用 /space 持久存储) */
export const IOPAINT_MODELS_DIR =
  process.env.IOPAINT_MODELS_DIR ||
  (fs.existsSync('/space/iopaint-models')
    ? '/space/iopaint-models'
    : path.join(process.cwd(), 'models', 'iopaint'));

/** RemoveBG 模型目录 (优先使用 /space 持久存储) */
export const REMOVEBG_MODELS_DIR =
  process.env.REMOVEBG_MODELS_DIR ||
  (fs.existsSync('/space/removebg-models')
    ? '/space/removebg-models'
    : path.join(process.cwd(), 'models', 'removebg'));

/** IOPaint 基础 URL */
export const IOPAINT_BASE_URL =
  process.env.IOPAINT_BASE_URL || 'http://127.0.0.1:8080';

/** IOPaint 超时（ms） */
export const IOPAINT_TIMEOUT_MS = parseInt(
  process.env.IOPAINT_TIMEOUT_MS || '300000',
  10,
);

/** 是否启用本地 AI (IOPaint)
 *  未显式配置 LOCAL_AI_ENABLED 时：
 *  - 生产环境 (COZE_PROJECT_ENV=PROD)：默认关闭，避免低配云主机启动本地模型
 *  - 开发环境：默认开启，方便本地调试
 */
export const LOCAL_AI_ENABLED = process.env.LOCAL_AI_ENABLED
  ? process.env.LOCAL_AI_ENABLED === 'true'
  : process.env.COZE_PROJECT_ENV !== 'PROD';

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

/** 放大默认倍率 */
export const UPSCALE_DEFAULT_SCALE = parseInt(
  process.env.UPSCALE_DEFAULT_SCALE || '2',
  10,
) as 2 | 4;

/** 放大最大倍率 */
export const UPSCALE_MAX_SCALE = parseInt(
  process.env.UPSCALE_MAX_SCALE || '4',
  10,
);

/** 放大超时（ms） */
export const UPSCALE_TIMEOUT_MS = parseInt(
  process.env.UPSCALE_TIMEOUT_MS || '300000',
  10,
);

/** Python 解释器路径（优先使用 /space 持久化虚拟环境，再检查项目 .venv，最后回退系统 python3） */
const SPACE_VENV_PYTHON = '/space/python-venv/bin/python3';
const VENV_PYTHON = path.join(process.cwd(), '.venv', 'bin', 'python3');
const SYSTEM_PYTHON = 'python3';
const VENV_EXISTS = (() => {
  try {
    require('fs').accessSync(VENV_PYTHON);
    return true;
  } catch {
    return false;
  }
})();
const SPACE_VENV_EXISTS = (() => {
  try {
    require('fs').accessSync(SPACE_VENV_PYTHON);
    return true;
  } catch {
    return false;
  }
})();
export const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  (SPACE_VENV_EXISTS ? SPACE_VENV_PYTHON : VENV_EXISTS ? VENV_PYTHON : SYSTEM_PYTHON);
