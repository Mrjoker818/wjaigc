import { downloadPublicImage } from '@/lib/safe-image-download';

/** Result URLs are untrusted even when the provider endpoint is administrator-configured. */
export async function downloadVectorizeResultSvg(url: string, callerSignal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(15_000);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const result = await downloadPublicImage(url, {
    maxBytes: 25 * 1024 * 1024,
    timeoutMs: 15_000,
    signal,
    allowedMimeTypes: ['image/svg+xml', 'application/xml', 'text/xml'],
  });
  signal.throwIfAborted();
  return result.buffer.toString('utf-8');
}
