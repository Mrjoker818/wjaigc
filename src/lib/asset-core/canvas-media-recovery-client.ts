export interface CanvasMediaRecoveryResult {
  recovered: boolean;
  availability: 'ready' | 'recovering' | 'missing' | 'unrecoverable';
  deferred?: boolean;
  url?: string;
  error?: string;
}

type Fetcher = typeof fetch;
const DEFAULT_RECOVERY_POLL_ATTEMPTS = 300;
const RECOVERY_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RECOVERY_MAX_DURATION_MS = 5 * 60_000;
const activeRecoveryPolls = new Map<string, Promise<CanvasMediaRecoveryResult>>();
const recoverySignalIds = new WeakMap<AbortSignal, number>();
let nextRecoverySignalId = 0;

function recoveryAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Media recovery cancelled', 'AbortError');
}

function throwIfRecoveryAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw recoveryAbortReason(signal);
}

async function waitForRecovery(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) { void promise.catch(() => undefined); throw recoveryAbortReason(signal); }
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => { signal.removeEventListener('abort', onAbort); reject(recoveryAbortReason(signal)); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(() => { signal.removeEventListener('abort', onAbort); resolve(); }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}

interface CanvasMediaRecoveryIdentity {
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
}

export type CanvasMediaRecoveryIdentityState = 'legacy' | 'incomplete' | 'complete';

export function getCanvasMediaRecoveryIdentityState(
  image: CanvasMediaRecoveryIdentity,
): CanvasMediaRecoveryIdentityState {
  const identities = [image.assetId, image.assetVersionId, image.placementId];
  const populated = identities.filter(value => Boolean(value?.trim())).length;
  if (populated === 0) return 'legacy';
  return populated === identities.length ? 'complete' : 'incomplete';
}

export async function recoverCanvasMedia<TImage extends CanvasMediaRecoveryIdentity>(input: {
  projectId: string;
  image: TImage;
  fetcher?: Fetcher;
  statusOnly?: boolean;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<CanvasMediaRecoveryResult> {
  const { assetId, assetVersionId, placementId } = input.image;
  if (!input.projectId || !assetId || !assetVersionId || !placementId) {
    throw new Error('ASSET_RECOVERY_IDENTITY_MISSING');
  }

  const query = new URLSearchParams({ projectId: input.projectId, assetId, assetVersionId, placementId });
  throwIfRecoveryAborted(input.signal);
  const timeoutSignal = AbortSignal.timeout(input.requestTimeoutMs ?? RECOVERY_REQUEST_TIMEOUT_MS);
  const controller = input.signal ? new AbortController() : null;
  const onScopeAbort = (): void => { if (input.signal) controller?.abort(recoveryAbortReason(input.signal)); };
  const onTimeout = (): void => { controller?.abort(recoveryAbortReason(timeoutSignal)); };
  input.signal?.addEventListener('abort', onScopeAbort, { once: true });
  timeoutSignal.addEventListener('abort', onTimeout, { once: true });
  try {
    throwIfRecoveryAborted(input.signal);
    const response = await (input.fetcher ?? fetch)(input.statusOnly
      ? `/api/assets/media/recover?${query}`
      : '/api/assets/media/recover', {
      method: input.statusOnly ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(input.statusOnly ? {} : { body: JSON.stringify({
        projectId: input.projectId,
        assetId,
        assetVersionId,
        placementId,
      }) }),
      signal: controller?.signal ?? timeoutSignal,
    });
    throwIfRecoveryAborted(input.signal);
    throwIfRecoveryAborted(timeoutSignal);
    const data = await response.json().catch(() => ({})) as CanvasMediaRecoveryResult;
    throwIfRecoveryAborted(input.signal);
    throwIfRecoveryAborted(timeoutSignal);
    if (!response.ok) {
      throw new Error(data.error || `ASSET_RECOVERY_FAILED_${response.status}`);
    }
    return data;
  } finally {
    input.signal?.removeEventListener('abort', onScopeAbort);
    timeoutSignal.removeEventListener('abort', onTimeout);
  }
}

export async function recoverCanvasMediaUntilTerminal<TImage extends CanvasMediaRecoveryIdentity>(input: {
  projectId: string;
  actorId?: string;
  signal?: AbortSignal;
  image: TImage;
  fetcher?: Fetcher;
  wait?: (delayMs: number) => Promise<void>;
  pollIntervalMs?: number;
  maxAttempts?: number;
  maxDurationMs?: number;
  now?: () => number;
}): Promise<CanvasMediaRecoveryResult> {
  const { assetId, assetVersionId, placementId } = input.image;
  throwIfRecoveryAborted(input.signal);
  let signalId: number | null = null;
  if (input.signal) {
    signalId = recoverySignalIds.get(input.signal) ?? ++nextRecoverySignalId;
    recoverySignalIds.set(input.signal, signalId);
  }
  const pollKey = assetVersionId ? JSON.stringify([input.actorId ?? null, input.projectId, assetId ?? null, assetVersionId, placementId ?? null, signalId]) : '';
  const existing = pollKey ? activeRecoveryPolls.get(pollKey) : undefined;
  if (existing) return existing;

  const polling = (async () => {
    const wait = input.wait ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
    const pollIntervalMs = input.pollIntervalMs ?? 1_000;
    const maxAttempts = input.maxAttempts ?? DEFAULT_RECOVERY_POLL_ATTEMPTS;
    const now = input.now ?? Date.now;
    const deadline = now() + (input.maxDurationMs ?? DEFAULT_RECOVERY_MAX_DURATION_MS);
    let result: CanvasMediaRecoveryResult | undefined;
    for (let attempt = 0; attempt < maxAttempts && now() <= deadline; attempt += 1) {
      throwIfRecoveryAborted(input.signal);
      const requestBudgetMs = Math.min(RECOVERY_REQUEST_TIMEOUT_MS, Math.max(1, deadline - now()));
      result = await recoverCanvasMedia({
        ...input,
        statusOnly: attempt > 0,
        requestTimeoutMs: requestBudgetMs,
      });
      if (result.availability !== 'recovering' || !result.deferred) return result;
      const remainingMs = deadline - now();
      if (attempt < maxAttempts - 1 && remainingMs > 0) await waitForRecovery(wait(Math.min(pollIntervalMs, remainingMs)), input.signal);
    }
    return result ?? { recovered: false, availability: 'recovering', deferred: true };
  })();
  if (pollKey) activeRecoveryPolls.set(pollKey, polling);
  try {
    return await polling;
  } finally {
    if (pollKey && activeRecoveryPolls.get(pollKey) === polling) activeRecoveryPolls.delete(pollKey);
  }
}
