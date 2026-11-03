import 'server-only';
import type { NextRequest } from 'next/server';
import { DocumentExchangeError } from './document-exchange-access';
import { getDocumentExecutionScope } from './document-execution-scope';

/** Own the body reader, byte ceiling and deadline. */
export async function readDocumentExchangeBytes(request: NextRequest, limit: number): Promise<Uint8Array> {
  const execution = getDocumentExecutionScope();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_048_577) {
    throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID');
  }
  if (declared !== null && Number(declared) > limit) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_TOO_LARGE');
  if (request.signal.aborted || execution?.signal.aborted) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_REQUEST_CANCELLED');
  execution?.assertActive();
  if (!request.body) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID');
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = request.body.getReader(); } catch { throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID'); }
  const chunks: Uint8Array[] = []; let total = 0;
  let stopReason: DocumentExchangeError | undefined;
  let rejectStop: (reason: DocumentExchangeError) => void = () => {};
  let cancellation: Promise<void> | undefined;
  const cancelReader = (): void => {
    if (cancellation) return;
    try { cancellation = reader.cancel(); }
    catch (error) { cancellation = Promise.reject(error); }
    void cancellation.catch(() => undefined);
    execution?.observeCleanup(cancellation);
  };
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  void stopped.catch(() => undefined);
  const stop = (error: DocumentExchangeError): void => {
    if (stopReason) return;
    stopReason = error; rejectStop(error);
    cancelReader();
  };
  const timer = setTimeout(() => stop(new DocumentExchangeError('DOCUMENT_EXCHANGE_REQUEST_TIMEOUT')), 5_000);
  const abort = (): void => stop(new DocumentExchangeError('DOCUMENT_EXCHANGE_REQUEST_CANCELLED'));
  request.signal.addEventListener('abort', abort, { once: true });
  execution?.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted || execution?.signal.aborted) abort();
  try {
    while (true) {
      execution?.assertActive();
      const reading = reader.read();
      // read() has already started. Account its completion even when the root
      // deadline crosses between dispatch and registration.
      const next = await Promise.race([execution ? execution.observeCleanup(reading) : reading, stopped]);
      if (stopReason) throw stopReason;
      if (request.signal.aborted || execution?.signal.aborted) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_REQUEST_CANCELLED');
      execution?.assertActive();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_TOO_LARGE');
      chunks.push(next.value);
    }
  } catch (error) {
    cancelReader();
    if (error instanceof DocumentExchangeError) throw error;
    throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID', error);
  } finally {
    clearTimeout(timer); request.signal.removeEventListener('abort', abort); execution?.signal.removeEventListener('abort', abort);
    try { reader.releaseLock(); } catch { /* Original read/cancel completion remains observed. */ }
  }
  const bytes = new Uint8Array(total); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}

/** Session metadata preserves its smaller 64 KiB ceiling. */
export async function readDocumentExchangeJson(request: NextRequest): Promise<unknown> {
  const bytes = await readDocumentExchangeBytes(request, 64 * 1024);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID'); }
}
