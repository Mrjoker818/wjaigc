import { fetchWithV1Retry, shouldSkipV1Retry } from '@/lib/api-helpers';
import { tryChatCompletionsImageFallback } from '@/lib/api-compatibility';

export type ImageEditProviderIdentity = Readonly<{
  providerId: string;
  modelId: string;
  kind: 'image' | 'vision' | 'upscale';
}>;

export type ImageEditProviderAccepted =
  | Readonly<{ kind: 'image'; taskId?: string; directUrl?: string; managedExport?: true; width?: number; height?: number }>
  | Readonly<{ kind: 'vision'; text: string }>;

export interface ImageEditProviderExecution {
  transport(input: RequestInfo | URL, init: RequestInit | undefined, identity: ImageEditProviderIdentity, responseMaxBytes?: number): Promise<Response>;
  onAccepted(identity: ImageEditProviderIdentity, result: ImageEditProviderAccepted): Promise<void>;
}

export interface ImageEditProviderCallOptions {
  providerId: string;
  boundary: ImageEditProviderExecution;
  responseMaxBytes?: number;
}

export class ImageEditProviderBoundaryError extends Error {
  constructor(cause: unknown) {
    super('Image edit provider boundary stopped', { cause });
    this.name = 'ImageEditProviderBoundaryError';
  }
}

/** Bound the first response read, including rejection bodies; never return a truncated success. */
export async function bufferImageEditProviderResponse(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Response> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('Invalid provider response limit');
  const reader = response.body?.getReader();
  let cancelled = false;
  const cancel = (reason: unknown): void => {
    if (cancelled || !reader) return;
    cancelled = true;
    // Cancellation must unblock pending reads without waiting for remote cleanup to finish.
    void reader.cancel(reason).catch((): void => {});
  };
  const abort = (): void => cancel(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    if (Number(response.headers.get('content-length')) > maxBytes) {
      throw new RangeError('Provider response exceeds the byte limit');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        if (value.byteLength > maxBytes - total) throw new RangeError('Provider response exceeds the byte limit');
        total += value.byteLength;
        chunks.push(Uint8Array.from(value));
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  } catch (error) { cancel(error); throw error; }
  finally {
    signal?.removeEventListener('abort', abort);
    reader?.releaseLock();
  }
}

type ImageResult = { taskId?: string; directUrl?: string; managedExport?: true; width?: number; height?: number };
type ChatOptions = Parameters<typeof tryChatCompletionsImageFallback>[0];

interface ImageEditProviderCall {
  transport: typeof fetch;
  fetchWithV1Retry: typeof fetchWithV1Retry;
  parse<T>(operation: () => T): T;
  stop(cause: unknown): void;
  acceptImage<T extends ImageResult>(result: T): Promise<T>;
  acceptVision(text: string): Promise<string>;
  chatFallback(params: ChatOptions): Promise<string[] | null>;
}

/** Request-local only. The consumer decides whether a non-OK response is safe to return. */
export function createImageEditProviderCall(
  options: ImageEditProviderCallOptions | undefined,
  modelId: string,
  kind: ImageEditProviderIdentity['kind'],
): ImageEditProviderCall {
  // Capture methods and scalar identity before the first await; caller mutation cannot retarget a call.
  const boundary = options?.boundary;
  const dispatch = boundary?.transport.bind(boundary);
  const onAccepted = boundary?.onAccepted.bind(boundary);
  const responseMaxBytes = options?.responseMaxBytes;
  const identity: ImageEditProviderIdentity = Object.freeze({
    providerId: options?.providerId ?? '', modelId, kind,
  });
  function stop(cause: unknown): void {
    if (boundary) throw cause instanceof ImageEditProviderBoundaryError ? cause : new ImageEditProviderBoundaryError(cause);
  }
  if (boundary && (!identity.providerId.trim() || !identity.modelId.trim())) {
    stop(new Error('Missing provider identity'));
  }
  if (responseMaxBytes !== undefined && (!Number.isSafeInteger(responseMaxBytes) || responseMaxBytes <= 0)) {
    const error = new RangeError('Invalid provider response limit');
    stop(error); throw error;
  }
  function parse<T>(operation: () => T): T {
    try { return operation(); } catch (error) { stop(error); throw error; }
  }
  const transport: typeof fetch = async (input, init): Promise<Response> => {
    if (!dispatch) return fetch(input, init);
    try {
      const response = responseMaxBytes === undefined
        ? await dispatch(input, init, identity)
        : await dispatch(input, init, identity, responseMaxBytes);
      if (responseMaxBytes !== undefined) {
        const signals: AbortSignal[] = [];
        if (input instanceof Request) signals.push(input.signal);
        if (init?.signal) signals.push(init.signal);
        return await bufferImageEditProviderResponse(response, responseMaxBytes, signals.length ? AbortSignal.any(signals) : undefined);
      }
      // Read before compatibility helpers can swallow body errors or start a second POST.
      // Preserve status and headers verbatim, including SSE/HTML content types.
      const bytes = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } catch (error) { stop(error); throw error; }
  };
  const controlledFetch: typeof fetchWithV1Retry = async (
    baseUrl, path, init = {}, retryWithV1 = true, timeoutMs = 300_000,
  ): Promise<Response> => {
    if (!boundary) return fetchWithV1Retry(baseUrl, path, init, retryWithV1, timeoutMs);
    const localOptions = { ...init, transport, propagateErrors: true, skipV1Retry: true };
    const response = await fetchWithV1Retry(baseUrl, path, localOptions, false, timeoutMs);
    const cleanBase = baseUrl.replace(/\/+$/, '');
    // A 2xx response belongs to the parser/acceptance boundary even when it is SSE or HTML.
    if (response.ok || !retryWithV1 || init.skipV1Retry || shouldSkipV1Retry(cleanBase) || path.startsWith('/v1/')) return response;
    const timeout = AbortSignal.timeout(timeoutMs);
    const retryResponse = await fetchWithV1Retry(cleanBase + '/v1', path, {
      ...localOptions, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    }, false, timeoutMs);
    const contentType = retryResponse.headers.get('content-type') || '';
    return retryResponse.ok || contentType.includes('application/json') || contentType.includes('text/json')
      ? retryResponse : response;
  };
  async function accepted(result: ImageEditProviderAccepted): Promise<void> {
    if (!onAccepted) return;
    try { await onAccepted(identity, Object.freeze(result)); } catch (error) { stop(error); }
  }
  async function acceptImage<T extends ImageResult>(result: T): Promise<T> {
    if (!boundary) return result;
    const snapshot: { kind: 'image'; taskId?: string; directUrl?: string; managedExport?: true; width?: number; height?: number } = { kind: 'image' };
    if (typeof result.taskId === 'string' && result.taskId.trim()) snapshot.taskId = result.taskId;
    if (typeof result.directUrl === 'string' && result.directUrl.trim()) snapshot.directUrl = result.directUrl;
    if (result.managedExport === true) snapshot.managedExport = true;
    if (!snapshot.taskId && !snapshot.directUrl) stop(new Error('Missing image result'));
    if (typeof result.width === 'number' && Number.isFinite(result.width) && result.width > 0) snapshot.width = result.width;
    if (typeof result.height === 'number' && Number.isFinite(result.height) && result.height > 0) snapshot.height = result.height;
    await accepted(snapshot);
    return result;
  }
  async function acceptVision(text: string): Promise<string> {
    if (boundary && (typeof text !== 'string' || !text.trim())) stop(new Error('Missing vision result'));
    await accepted({ kind: 'vision', text });
    return text;
  }
  async function chatFallback(params: ChatOptions): Promise<string[] | null> {
    if (!boundary) return tryChatCompletionsImageFallback(params);
    let successfulResponse = false;
    try {
      const urls = await tryChatCompletionsImageFallback({
        ...params, propagateErrors: true,
        transport: async (input, init): Promise<Response> => {
          const response = await transport(input, init);
          successfulResponse = response.ok;
          return response;
        },
      });
      if (successfulResponse && !urls?.length) stop(new Error('Missing chat image result'));
      return urls;
    } catch (error) { stop(error); throw error; }
  }
  return { transport, fetchWithV1Retry: controlledFetch, parse, stop, acceptImage, acceptVision, chatFallback };
}
