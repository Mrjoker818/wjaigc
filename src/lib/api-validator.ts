/**
 * API 路由自动校验包装器
 * 
 * 使用方式：
 *   import { withValidation, validators } from '@/lib/api-validator';
 *   
 *   export const POST = withValidation(
 *     { imageUrl: validators.imageUrl, prompt: validators.prompt },
 *     async (req, body) => { ... }
 *   );
 * 
 * 对于不需要 body 校验的 GET 路由，直接使用 withGetValidation：
 *   export const GET = withGetValidation(
 *     { searchParam1: { required: true, validate: validators.modelName } },
 *     async (req) => { ... }
 *   );
 */

import { NextRequest, NextResponse } from 'next/server';

// ============ 校验函数 ============

type ValidateResult = string | null;
type ValidateFn = (value: unknown, fieldName?: string) => ValidateResult;

// URL 校验：允许 http/https、/uploads/ /api/ 相对路径、data:image/ base64
export function validateImageUrl(url: unknown, fieldName = 'imageUrl'): ValidateResult {
  if (!url || typeof url !== 'string') return `${fieldName} 不能为空`;
  const t = url.trim();
  if (t.length === 0) return `${fieldName} 不能为空白`;
  const isDataUrl = t.startsWith('data:image/');
  const ok = t.startsWith('http://') || t.startsWith('https://') ||
             t.startsWith('/uploads/') || t.startsWith('/api/') ||
             isDataUrl;
  if (!ok) return `${fieldName} 格式不合法`;
  if (t.startsWith('file://') || t.startsWith('javascript:')) return `${fieldName} 包含不安全的协议`;
  // base64 data URL 跳过长度限制（可达数百万字符），单独限制 20MB
  if (isDataUrl && t.length > 27_000_000) return `${fieldName} 数据过大，请压缩后重试`;
  // HTTP/相对路径URL保留长度限制
  if (!isDataUrl && t.length > 10000) return `${fieldName} 长度超出限制`;
  return null;
}

// 视频 URL 校验
export function validateVideoUrl(url: unknown, fieldName = 'videoUrl'): ValidateResult {
  if (!url || typeof url !== 'string') return `${fieldName} 不能为空`;
  const t = url.trim();
  if (t.length > 10000) return `${fieldName} 长度超出限制`;
  const ok = t.startsWith('http://') || t.startsWith('https://') ||
             t.startsWith('/uploads/') || t.startsWith('/api/');
  if (!ok) return `${fieldName} 格式不合法`;
  return null;
}

// 提示词校验
export function validatePrompt(prompt: unknown, fieldName = 'prompt', maxLength = 10000): ValidateResult {
  if (!prompt || typeof prompt !== 'string') return `${fieldName} 不能为空`;
  const t = prompt.trim();
  if (t.length === 0) return `${fieldName} 不能为空白`;
  if (t.length > maxLength) return `${fieldName} 长度超出限制`;
  return null;
}

// 可选提示词（允许为空）
export function validateOptionalPrompt(prompt: unknown, fieldName = 'prompt', maxLength = 10000): ValidateResult {
  if (!prompt || typeof prompt !== 'string') return null;
  if (prompt.trim().length > maxLength) return `${fieldName} 长度超出限制`;
  return null;
}

// 模型名称校验
export function validateModelName(model: unknown, fieldName = 'model'): ValidateResult {
  if (!model || typeof model !== 'string') return `${fieldName} 不能为空`;
  const t = model.trim();
  if (t.length === 0 || t.length > 200) return `${fieldName} 长度不合法`;
  if (!/^[a-zA-Z0-9\-._/: @]+$/.test(t)) return `${fieldName} 包含非法字符`;
  return null;
}

// 尺寸校验（数字）
export function validateSize(size: unknown, fieldName = 'size'): ValidateResult {
  if (size === undefined || size === null) return null;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) return `${fieldName} 必须是正整数`;
  if (size > 8192) return `${fieldName} 超出最大允许值`;
  return null;
}

// 画面比例校验
export function validateAspectRatio(ratio: unknown, fieldName = 'aspectRatio'): ValidateResult {
  if (!ratio || typeof ratio !== 'string') return null;
  const t = ratio.trim();
  if (!/^\d+:\d+$/.test(t)) return `${fieldName} 格式不合法`;
  return null;
}

// 强度值校验
export function validateStrength(value: unknown, fieldName = 'strength', max = 1): ValidateResult {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || isNaN(value)) return `${fieldName} 必须是数字`;
  if (value < 0 || value > max) return `${fieldName} 必须在 0-${max} 之间`;
  return null;
}

// 字符串长度校验（通用）
export function validateStringLength(value: unknown, fieldName: string, min = 0, max = 50000): ValidateResult {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return `${fieldName} 必须是字符串`;
  if (value.length > max) return `${fieldName} 长度超出限制`;
  return null;
}

// URL 通用校验（非图片场景）
export function validateUrl(url: unknown, fieldName = 'url'): ValidateResult {
  if (!url || typeof url !== 'string') return `${fieldName} 不能为空`;
  const t = url.trim();
  if (t.length > 10000) return `${fieldName} 长度超出限制`;
  if (!t.startsWith('http://') && !t.startsWith('https://') && !t.startsWith('/')) return `${fieldName} 格式不合法`;
  return null;
}

// ID 校验
export function validateId(id: unknown, fieldName = 'id'): ValidateResult {
  if (!id || typeof id !== 'string') return `${fieldName} 不能为空`;
  const t = String(id).trim();
  if (t.length === 0 || t.length > 256) return `${fieldName} 长度不合法`;
  return null;
}

// 邮箱校验
export function validateEmail(email: unknown, fieldName = 'email'): ValidateResult {
  if (!email || typeof email !== 'string') return `${fieldName} 不能为空`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email as string)) return `${fieldName} 格式不合法`;
  return null;
}

// JSON 字符串校验
export function validateJsonString(value: unknown, fieldName = 'data'): ValidateResult {
  if (!value || typeof value !== 'string') return `${fieldName} 不能为空`;
  try { JSON.parse(value); return null; } catch { return `${fieldName} 不是有效的 JSON`; }
}

// ============ 校验器集合 ============

export const validators = {
  imageUrl: validateImageUrl,
  videoUrl: validateVideoUrl,
  prompt: validatePrompt,
  optionalPrompt: validateOptionalPrompt,
  model: validateModelName,
  size: validateSize,
  aspectRatio: validateAspectRatio,
  strength: validateStrength,
  stringLength: validateStringLength,
  url: validateUrl,
  id: validateId,
  email: validateEmail,
  jsonString: validateJsonString,
};

// ============ 字段定义 ============

interface FieldDef {
  /** 校验函数 */
  validate: ValidateFn;
  /** 是否必须（默认 true） */
  required?: boolean;
  /** 自定义字段名（覆盖 body 中的 key） */
  fieldName?: string;
}

type FieldMap = Record<string, ValidateFn | FieldDef>;

// ============ POST 包装器 ============

type PostHandler = (
  req: NextRequest,
  body: Record<string, unknown>
) => Promise<NextResponse> | NextResponse;

/**
 * 包装 POST 路由处理器，自动解析和校验请求体
 * 
 * @param fields 字段校验定义
 * @param handler 校验通过后的业务处理器
 * @returns 包装后的 POST 函数
 */
export function withValidation(fields: FieldMap, handler: PostHandler) {
  return async function POST(req: NextRequest): Promise<NextResponse> {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: '请求体不是有效的 JSON' }, { status: 400 });
    }

    // 逐字段校验
    for (const [key, def] of Object.entries(fields)) {
      const validateFn = typeof def === 'function' ? def : def.validate;
      const required = typeof def === 'function' ? true : (def.required ?? true);
      const fieldName = typeof def === 'function' ? key : (def.fieldName ?? key);
      const value = body[key];

      // 非必须字段为空时跳过
      if (!required && (value === undefined || value === null || value === '')) {
        continue;
      }

      const error = validateFn(value, fieldName);
      if (error) {
        return NextResponse.json({ error }, { status: 400 });
      }
    }

    return handler(req, body);
  };
}

// ============ GET 包装器 ============

type GetHandler = (req: NextRequest) => Promise<NextResponse> | NextResponse;

/**
 * 包装 GET 路由处理器，自动校验 URL 查询参数
 */
export function withGetValidation(fields: FieldMap, handler: GetHandler) {
  return async function GET(req: NextRequest): Promise<NextResponse> {
    const { searchParams } = new URL(req.url);

    for (const [key, def] of Object.entries(fields)) {
      const validateFn = typeof def === 'function' ? def : def.validate;
      const required = typeof def === 'function' ? true : (def.required ?? true);
      const fieldName = typeof def === 'function' ? key : (def.fieldName ?? key);
      const value = searchParams.get(key);

      if (!required && !value) continue;
      const error = validateFn(value, fieldName);
      if (error) {
        return NextResponse.json({ error }, { status: 400 });
      }
    }

    return handler(req);
  };
}

// ============ 轻量级批量校验 ============

/**
 * 媒体URL格式校验（内部使用）
 * 允许: http/https, /uploads/, /api/, data:image/
 */
/** 私有IP/内网地址检测（SSRF防护） */
function isPrivateOrReservedHost(hostname: string): boolean {
  // IPv4 私有网段
  const ipv4Private = /^(127\.)|(10\.)|(172\.(1[6-9]|2\d|3[01])\.)|(192\.168\.)/;
  if (ipv4Private.test(hostname)) return true;
  // IPv4 回环/链路本地/广播
  if (/^(0\.)|(169\.254\.)/.test(hostname)) return true;
  // IPv6 回环/链路本地
  if (/^\[::1\]$|^\[fe80:/i.test(hostname)) return true;
  // localhost
  if (hostname === 'localhost') return true;
  return false;
}

function isSafePlatformMediaPath(value: string): boolean {
  if (!value.startsWith('/uploads/') && !value.startsWith('/api/serve-upload/')) return false;

  try {
    const pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    const segments = pathname.split('/').filter(Boolean);
    return segments.length > 1 && segments.every((segment) => segment !== '.' && segment !== '..');
  } catch {
    return false;
  }
}

/**
 * Validates a user-controlled video location before the server downloads it.
 * Only public HTTP(S) origins and platform media paths are accepted.
 */
export function isSafeVideoSource(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  const url = value.trim();
  if (url.length > 10_000) return false;
  if (url.startsWith('/')) return isSafePlatformMediaPath(url);

  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !isPrivateOrReservedHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isValidMediaUrl(url: string): boolean {
  // 允许的协议和路径前缀
  if (url.startsWith('/uploads/') || url.startsWith('/api/') || url.startsWith('data:image/')) return true;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  // SSRF防护：拒绝私有IP和内网地址
  try {
    const parsed = new URL(url);
    if (isPrivateOrReservedHost(parsed.hostname)) return false;
  } catch { return false; }
  return true;
}

/**
 * 轻量级 API 输入校验
 * 用于在 body 解析后快速校验关键字段，返回错误消息或 null
 * 
 * 使用方式:
 *   import { validateApiInputs } from '@/lib/api-validator';
 *   const body = await req.json();
 *   const err = validateApiInputs(body, { imageUrl: 'imageUrl', prompt: 'optionalPrompt' });
 *   if (err) return NextResponse.json({ error: err }, { status: 400 });
 * 
 * 字段类型映射:
 *   'imageUrl'      → 必须是合法的图片URL
 *   'optionalImageUrl' → 可选，有值时必须是合法图片URL
 *   'videoUrl'      → 必须是合法的视频URL
 *   'optionalVideoUrl' → 可选，有值时必须是合法视频URL
 *   'prompt'        → 必须非空字符串，长度≤10000
 *   'optionalPrompt'→ 可选，有值时长度≤10000
 *   'model'         → 可选，有值时仅允许安全字符
 *   'url'           → 必须是合法URL
 *   'optionalUrl'   → 可选，有值时必须是合法URL
 *   'string'        → 可选，有值时长度≤50000
 *   'id'            → 必须非空，长度≤256
 */
export type FieldType = 'imageUrl' | 'optionalImageUrl' | 'videoUrl' | 'optionalVideoUrl' 
  | 'prompt' | 'optionalPrompt' | 'model' | 'url' | 'optionalUrl' | 'string' | 'id';

export function validateApiInputs(
  body: unknown,
  schema: Record<string, FieldType>
): string | null {
  // 确保 body 是对象
  if (!body || typeof body !== 'object') return '请求体必须是对象';
  const bodyObj = body as Record<string, unknown>;
  
  for (const [field, type] of Object.entries(schema)) {
    const value = bodyObj[field];
    
    switch (type) {
      case 'imageUrl': {
        if (!value || typeof value !== 'string') return `${field} 不能为空`;
        if (!isValidMediaUrl(value as string)) return `${field} 格式不合法`;
        break;
      }
      case 'optionalImageUrl': {
        if (value && typeof value === 'string' && !isValidMediaUrl(value as string)) return `${field} 格式不合法`;
        break;
      }
      case 'videoUrl': {
        if (!value || typeof value !== 'string') return `${field} 不能为空`;
        if (!isSafeVideoSource(value)) return `${field} 格式不合法`;
        break;
      }
      case 'optionalVideoUrl': {
        if (value && !isSafeVideoSource(value)) return `${field} 格式不合法`;
        break;
      }
      case 'prompt': {
        if (!value || typeof value !== 'string' || (value as string).trim().length === 0) return `${field} 不能为空`;
        if ((value as string).length > 10000) return `${field} 长度超出限制`;
        break;
      }
      case 'optionalPrompt': {
        if (value && typeof value === 'string' && (value as string).length > 10000) return `${field} 长度超出限制`;
        break;
      }
      case 'model': {
        if (value && typeof value === 'string' && !/^[a-zA-Z0-9\-._/: @]+$/.test(value as string)) return `${field} 包含非法字符`;
        break;
      }
      case 'url': {
        if (!value || typeof value !== 'string') return `${field} 不能为空`;
        const u = value as string;
        if (!u.startsWith('http://') && !u.startsWith('https://') && !u.startsWith('/')) return `${field} 格式不合法`;
        break;
      }
      case 'optionalUrl': {
        if (value && typeof value === 'string') {
          const u = value as string;
          if (!u.startsWith('http://') && !u.startsWith('https://') && !u.startsWith('/')) return `${field} 格式不合法`;
        }
        break;
      }
      case 'string': {
        if (value && typeof value === 'string' && (value as string).length > 50000) return `${field} 长度超出限制`;
        break;
      }
      case 'id': {
        if (!value || typeof value !== 'string') return `${field} 不能为空`;
        if ((value as string).length > 256) return `${field} 长度超出限制`;
        break;
      }
    }
  }
  return null;
}
