import 'server-only';

interface SketchObservationIdentity {
  requestId?: string; taskId?: string; providerId?: string; modelId?: string;
}
interface SketchRuntimeEvent {
  event: 'request-start' | 'response-headers' | 'body-complete' | 'attempt-error' | 'query-result'
    | 'worker-start' | 'worker-return' | 'worker-throw' | 'phase-state-start' | 'phase-state-confirmed'
    | 'phase-state-unconfirmed' | 'compute-error' | 'publication-start' | 'publication-return'
    | 'publication-refused' | 'publication-rejected' | 'publication-commit-unknown';
  phase: 'analysis' | 'reconstruction' | 'image-submit' | 'image-query' | 'code-worker' | 'image-worker' | 'publication';
  responseId?: string; remoteTaskId?: string; status?: string; reason?: string;
  httpStatus?: number; elapsedMs?: number; aborted?: boolean; confirmed?: boolean;
}
export type SketchRuntimeObserver = (value: SketchRuntimeEvent) => void;

/** Diagnostic output only: no task state, storage, transport, timers or retries.
 * Never spread a runtime, request, response, admission, draft or error object.
 * A failed sink must not alter execution or turn an unknown commit into failure.
 */
function buildObserver(identity: SketchObservationIdentity,
  secrets: readonly string[]): SketchRuntimeObserver {
  const privateValues = secrets.filter(value => typeof value === 'string' && value.length > 0);
  const token = (value: unknown, model = false): string | undefined => {
    if (typeof value !== 'string' || value.includes('://')
      || /^(?:https?|wss?|s?ftp|file|data|blob|javascript|about|mailto|tel):/i.test(value)
      // Colon-delimited phase correlations are IDs, not arbitrary URL schemes.
      || !model && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
        && !/^[A-Za-z0-9._-]+:(?:analysis|reconstruction|image|image-submit|image-query)$/.test(value)
      || !(model ? /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/ : /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).test(value)) return undefined;
    return privateValues.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
  };
  const context = { requestId: token(identity.requestId), taskId: token(identity.taskId),
    providerId: token(identity.providerId), modelId: token(identity.modelId, true) };
  let emitted = 0;
  return value => {
    // Per-boundary ceiling, not an alternate task authority. Query callers also
    // suppress repeated pending polls, retaining the first GET and state changes.
    if (emitted++ >= 32) return;
    try {
      const status = ['pending', 'processing', 'completed', 'failed', 'skipped', 'deferred', 'cancelled', 'timeout', 'unknown'].includes(value.status || '')
        ? value.status : undefined;
      const reason = typeof value.reason === 'string' && /^SKETCH_[A-Z0-9_]{1,96}$/.test(value.reason)
        ? token(value.reason) : undefined;
      console.info('[SketchRuntime]', JSON.stringify({ version: 1, ...context,
        event: value.event, phase: value.phase, responseId: token(value.responseId), remoteTaskId: token(value.remoteTaskId),
        status, reason,
        httpStatus: Number.isInteger(value.httpStatus) && value.httpStatus! >= 100 && value.httpStatus! <= 599 ? value.httpStatus : undefined,
        elapsedMs: Number.isFinite(value.elapsedMs) && value.elapsedMs! >= 0 && value.elapsedMs! <= 3_600_000 ? Math.floor(value.elapsedMs!) : undefined,
        aborted: typeof value.aborted === 'boolean' ? value.aborted : undefined,
        confirmed: typeof value.confirmed === 'boolean' ? value.confirmed : undefined,
      }));
    } catch { /* Observability is never execution or settlement authority. */ }
  };
}

export function createSketchRuntimeObserver(identity: SketchObservationIdentity,
  secrets: readonly string[] = []): SketchRuntimeObserver {
  try { return buildObserver(identity, secrets); }
  catch { return (): void => undefined; }
}
