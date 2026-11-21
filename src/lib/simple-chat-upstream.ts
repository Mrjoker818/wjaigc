// Helpers for the standalone chat route. Kept outside route.ts because Next.js
// route files may only export HTTP handlers and route config.

export const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;

const LEGACY_SIZE_TO_RATIO: Record<string, string> = {
  '1024x1024': '1:1',
  '1792x1024': '16:9',
  '1024x1792': '9:16',
};

/** Normalizes the tool's aspect ratio; legacy pixel sizes from older prompts are still accepted. */
export function resolveToolAspectRatio(args: { aspect_ratio?: unknown; size?: unknown }): string {
  const ratio = typeof args.aspect_ratio === 'string' ? args.aspect_ratio.trim() : '';
  if ((IMAGE_ASPECT_RATIOS as readonly string[]).includes(ratio)) return ratio;
  const size = typeof args.size === 'string' ? args.size.trim() : '';
  return LEGACY_SIZE_TO_RATIO[size] || '1:1';
}

/** Turns an upstream chat error body into a readable message with a next step. */
export function describeUpstreamChatError(status: number, rawBody: string, model: string): string {
  let detail = rawBody.trim();
  try {
    const parsed = JSON.parse(rawBody) as { error?: unknown; message?: unknown };
    const err = parsed.error;
    if (typeof err === 'string') detail = err;
    else if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
      detail = (err as { message: string }).message;
    } else if (typeof parsed.message === 'string') detail = parsed.message;
  } catch { /* keep raw text */ }
  detail = detail.slice(0, 200) || '无响应内容';

  if (status === 401 || status === 403) return `中转站拒绝了请求（${status}）。请让管理员检查该提供商的 API Key。`;
  if (status === 402) return '中转站余额或额度不足（402）。请让管理员检查供应商余额。';
  if (status === 429) return '请求过于频繁（429）。请稍后重试。';
  if (/不支持的模型|model.*(not|un)\s*(found|support|exist)|invalid model/i.test(detail)) {
    return `中转站不支持模型「${model}」（${status}）。请切换其他模型，或让管理员从提供商的模型列表中移除它。`;
  }
  if (status >= 500) return `中转站暂时无法处理模型「${model}」（${status}）。请稍后重试或切换模型。`;
  return `中转站拒绝了请求（${status}）。请检查所选模型支持的参数，或联系管理员。`;
}
