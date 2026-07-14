/** 标准画面比例列表（与后端 SUPPORTED_RATIOS 一致） */
export const STANDARD_RATIOS = ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9'] as const;
export type StandardRatio = typeof STANDARD_RATIOS[number];

/** 将任意宽高比化简为最接近的标准比例字符串，如 768:1024 → "3:4" */
export function findClosestStandardRatio(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '1:1';
  const ratio = w / h;
  let best = '1:1';
  let bestDiff = Infinity;
  for (const r of STANDARD_RATIOS) {
    const [rw, rh] = r.split(':').map(Number);
    const diff = Math.abs(ratio - rw / rh);
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  }
  return best;
}

/** 统一解析轮询API返回的图片URL（兼容多种返回格式） */
export function extractPollImageUrl(pollData: unknown): string | null {
  if (!pollData || typeof pollData !== 'object') return null;
  const d = pollData as Record<string, unknown>;
  if (typeof d.imageUrl === 'string' && d.imageUrl) return d.imageUrl;
  if (typeof d.url === 'string' && d.url) return d.url;
  const r = d.result as Record<string, unknown> | undefined;
  if (r) {
    if (typeof r.imageUrl === 'string' && r.imageUrl) return r.imageUrl;
    if (typeof r.url === 'string' && r.url) return r.url;
    const img = r.image as Record<string, unknown> | undefined;
    if (img && typeof img.url === 'string' && img.url) return img.url as string;
    const imgs = r.images as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(imgs) && imgs.length > 0 && typeof imgs[0]?.url === 'string') return imgs[0].url as string;
  }
  return null;
}

/** 统一解析轮询API返回的蒙版图URL */
export function extractPollMaskUrl(pollData: unknown): string | null {
  if (!pollData || typeof pollData !== 'object') return null;
  const d = pollData as Record<string, unknown>;
  if (typeof d.maskUrl === 'string' && d.maskUrl) return d.maskUrl;
  const r = d.result as Record<string, unknown> | undefined;
  if (r && typeof r.maskUrl === 'string' && r.maskUrl) return r.maskUrl as string;
  return null;
}
