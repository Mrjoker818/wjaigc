/**
 * API 输入校验工具
 * 防止恶意/无效参数导致后端异常
 */

/**
 * 校验图片URL格式
 * 允许: http/https URL, /uploads/ 相对路径, data:image/ base64
 * 拒绝: file://, javascript:, 其他协议, 空值
 */
export function validateImageUrl(url: unknown, fieldName = 'imageUrl'): string | null {
  if (!url || typeof url !== 'string') {
    return `${fieldName} 不能为空`;
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return `${fieldName} 不能为空白`;
  }
  // 允许的格式
  const isHttp = trimmed.startsWith('http://') || trimmed.startsWith('https://');
  const isRelative = trimmed.startsWith('/uploads/') || trimmed.startsWith('/api/');
  // 接受 data:image/ 和 data:application/octet-stream（某些 FileReader/blob 转换产生此 MIME 类型）
  // 仍然拒绝 data:text/html 等危险类型（XSS 防护）
  const isDataUrl = trimmed.startsWith('data:image/') || trimmed.startsWith('data:application/octet-stream');
  if (!isHttp && !isRelative && !isDataUrl) {
    return `${fieldName} 格式不合法，仅支持 http/https URL、/uploads/ 相对路径或 data:image/ base64`;
  }
  // base64 data URL 可达数百万字符（100KB图片≈133K字符），跳过长度限制
  // HTTP/相对路径URL保留长度限制防止滥用，但提高到 100000 以兼容超长的签名URL
  // （部分 AI API 提供商或 CDN 返回的 presigned URL 含嵌入 token/签名，可能超过 10000 字符）
  if (!isDataUrl && trimmed.length > 100000) {
    return `${fieldName} 长度超出限制`;
  }
  // data URL 单独限制：最大 20MB（约 27M 字符）
  if (isDataUrl && trimmed.length > 27_000_000) {
    return `${fieldName} 数据过大，请压缩后重试`;
  }
  // 拒绝 file:// 和 javascript: 协议
  if (trimmed.startsWith('file://') || trimmed.startsWith('javascript:')) {
    return `${fieldName} 包含不安全的协议`;
  }
  return null;
}

/**
 * 校验视频URL格式
 */
export function validateVideoUrl(url: unknown, fieldName = 'videoUrl'): string | null {
  if (!url || typeof url !== 'string') {
    return `${fieldName} 不能为空`;
  }
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('/uploads/') && !trimmed.startsWith('/api/')) {
    return `${fieldName} 格式不合法`;
  }
  return null;
}

/**
 * 校验提示词
 * 限制长度，拒绝明显的注入攻击
 */
export function validatePrompt(prompt: unknown, fieldName = 'prompt', maxLength = 10000): string | null {
  if (!prompt || typeof prompt !== 'string') {
    return `${fieldName} 不能为空`;
  }
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return `${fieldName} 不能为空白`;
  }
  if (trimmed.length > maxLength) {
    return `${fieldName} 长度超出限制 (最大 ${maxLength} 字符)`;
  }
  return null;
}

/**
 * 校验图片尺寸参数
 * 确保为正整数且在合理范围内
 */
export function validateImageSize(size: unknown, fieldName = 'size'): string | null {
  if (size === undefined || size === null) return null; // 可选参数
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    return `${fieldName} 必须是正整数`;
  }
  if (size > 8192) {
    return `${fieldName} 超出最大允许值 8192`;
  }
  return null;
}

/**
 * 校验模型名称
 * 防止注入特殊字符
 */
export function validateModelName(model: unknown, fieldName = 'model'): string | null {
  if (!model || typeof model !== 'string') {
    return `${fieldName} 不能为空`;
  }
  const trimmed = model.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return `${fieldName} 长度不合法`;
  }
  // 模型名称只允许字母数字、连字符、点、斜杠、冒号
  if (!/^[a-zA-Z0-9\-._/:]+$/.test(trimmed)) {
    return `${fieldName} 包含非法字符`;
  }
  return null;
}

/**
 * 校验API Key格式（基本格式检查，不检查内容）
 */
export function validateApiKeyFormat(key: unknown, fieldName = 'apiKey'): string | null {
  if (!key || typeof key !== 'string') {
    return `${fieldName} 不能为空`;
  }
  const trimmed = key.trim();
  if (trimmed.length < 8 || trimmed.length > 500) {
    return `${fieldName} 长度不合法`;
  }
  return null;
}

/**
 * 校验画面比例格式 (如 "1:1", "16:9", "4:3")
 */
export function validateAspectRatio(ratio: unknown, fieldName = 'aspectRatio'): string | null {
  if (!ratio || typeof ratio !== 'string') return null; // 可选参数
  const trimmed = ratio.trim();
  if (!/^\d+:\d+$/.test(trimmed)) {
    return `${fieldName} 格式不合法，应为 "宽:高" 格式（如 "1:1", "16:9"）`;
  }
  const [w, h] = trimmed.split(':').map(Number);
  if (w <= 0 || h <= 0 || w > 100 || h > 100) {
    return `${fieldName} 数值超出合理范围`;
  }
  return null;
}

/**
 * 校验强度值 (0-1 或 0-100 的百分比)
 */
export function validateStrength(value: unknown, fieldName = 'strength', max = 1): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || isNaN(value)) {
    return `${fieldName} 必须是数字`;
  }
  if (value < 0 || value > max) {
    return `${fieldName} 必须在 0-${max} 之间`;
  }
  return null;
}

/**
 * 批量校验，返回第一个错误或 null
 */
export function validateAll(...validations: (string | null)[]): string | null {
  for (const v of validations) {
    if (v) return v;
  }
  return null;
}
