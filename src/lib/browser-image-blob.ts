export type BrowserImageFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function decodeBase64DataUrl(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('Unsupported image data URL');
  const binary = globalThis.atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1] });
}

export async function loadBrowserImageBlob(
  sourceUrl: string,
  fetcher: BrowserImageFetcher = fetch,
): Promise<Blob> {
  if (sourceUrl.startsWith('data:')) return decodeBase64DataUrl(sourceUrl);
  const response = await fetcher(sourceUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}
