const BARE_BASE64_IMAGE = /^[A-Za-z0-9+/=\r\n]+$/;

export function normalizeBrandFactoryImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('data:image/')) return trimmed || undefined;

  const compact = trimmed.replace(/\s/g, '');
  if (compact.length >= 64 && BARE_BASE64_IMAGE.test(compact)) {
    return `data:image/png;base64,${compact}`;
  }
  return trimmed;
}

export function normalizeBrandFactoryImageUrls(urls: string[]): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map(u => normalizeBrandFactoryImageUrl(u) || '');
}
