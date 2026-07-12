type UnknownRecord = Record<string, unknown>;

function firstUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (!Array.isArray(value)) return undefined;

  for (const item of value) {
    const url = firstUrl(item) || (item && typeof item === 'object'
      ? firstUrl((item as UnknownRecord).url)
      : undefined);
    if (url) return url;
  }
  return undefined;
}

/** Extract the first image URL from the task response shapes used by providers. */
export function extractTaskResultImageUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const root = payload as UnknownRecord;
  const result = root.result && typeof root.result === 'object'
    ? root.result as UnknownRecord
    : undefined;
  const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
    ? root.data as UnknownRecord
    : undefined;
  const output = result?.output && typeof result.output === 'object' && !Array.isArray(result.output)
    ? result.output as UnknownRecord
    : undefined;

  return firstUrl(root.imageUrl)
    || firstUrl(root.url)
    || firstUrl(root.directImageUrls)
    || firstUrl(root.images)
    || firstUrl(root.data)
    || firstUrl(result?.imageUrl)
    || firstUrl(result?.url)
    || firstUrl(result?.image)
    || firstUrl(result?.directImageUrls)
    || firstUrl(result?.images)
    || firstUrl(result?.data)
    || firstUrl(result?.output)
    || firstUrl(output?.image_urls)
    || firstUrl(output?.images)
    || firstUrl(data?.imageUrl)
    || firstUrl(data?.url)
    || firstUrl(data?.directImageUrls)
    || firstUrl(data?.images)
    || firstUrl(data?.data)
    || firstUrl(data?.result);
}
