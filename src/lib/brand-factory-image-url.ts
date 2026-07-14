const BARE_BASE64_IMAGE = /^[A-Za-z0-9+/=\r\n]+$/;

export function normalizeBrandFactoryImageUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('data:image/')) return trimmed;

  const compact = trimmed.replace(/\s/g, '');
  if (compact.length >= 8 && BARE_BASE64_IMAGE.test(compact)) {
    return `data:image/png;base64,${compact}`;
  }
  return trimmed;
}

export function normalizeBrandFactoryImageUrls(urls: string[]): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map(normalizeBrandFactoryImageUrl);
}
