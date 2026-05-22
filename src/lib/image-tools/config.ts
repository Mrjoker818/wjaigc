// ============================================================
// Image Tools — Configuration
// ============================================================

import path from 'path';

/** 项目根目录下的 public 目录 */
export const PUBLIC_DIR = path.join(process.cwd(), 'public');

/** 放大输出目录 */
export const UPSCALE_OUTPUT_DIR = path.join(PUBLIC_DIR, 'outputs', 'upscale');

/** 修复输出目录 */
export const INPAINT_OUTPUT_DIR = path.join(PUBLIC_DIR, 'outputs', 'inpaint');

/** 临时文件目录 */
export const TEMP_DIR = path.join(PUBLIC_DIR, 'outputs', 'temp');

/** 放大模型目录 (项目持久化目录，不受沙箱重启影响) */
export const UPSCAYL_MODELS_DIR =
  process.env.UPSCAYL_MODELS_DIR ||
  path.join(process.cwd(), 'models', 'upscayl');

/** IOPaint / LaMa / RemoveBG 模型根目录 (项目持久化目录) */
export const IOPAINT_MODELS_DIR =
  process.env.IOPAINT_MODELS_DIR ||
  path.join(process.cwd(), 'models', 'iopaint');

/** RemoveBG 模型目录 (项目持久化目录) */
export const REMOVEBG_MODELS_DIR =
  process.env.REMOVEBG_MODELS_DIR ||
  path.join(process.cwd(), 'models', 'removebg');

/** IOPaint 基础 URL */
export const IOPAINT_BASE_URL =
  process.env.IOPAINT_BASE_URL || 'http://127.0.0.1:8080';

/** IOPaint 超时（ms） */
export const IOPAINT_TIMEOUT_MS = parseInt(
  process.env.IOPAINT_TIMEOUT_MS || '300000',
  10,
);

/** 是否启用本地 AI (upscayl / IOPaint)
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

/** Python 解释器路径（优先使用 .venv 持久化虚拟环境） */
export const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  path.join(process.cwd(), '.venv', 'bin', 'python3');
