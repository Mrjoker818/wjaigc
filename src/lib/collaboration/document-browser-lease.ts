'use client';
export interface DocumentBrowserLease {
  readonly active: boolean;
  readonly signal: AbortSignal;
  assertOwned(): void;
  release(): Promise<void>;
}
const safeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 256 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
function failure(code: string): Error { return new Error(code); }

/** Coordinates participating same-origin writers only; it cannot fence an old uncooperative page. */
export async function acquireDocumentBrowserLease(options: {
  actorId: string; projectId: string; signal?: AbortSignal;
}): Promise<DocumentBrowserLease> {
  if (!options || !safeId(options.actorId) || !safeId(options.projectId)) {
    throw failure('DOCUMENT_BROWSER_LEASE_INVALID');
  }
  let name: string;
  try { name = `wujie-canvas-document-writer-v1:${encodeURIComponent(options.actorId)}:${encodeURIComponent(options.projectId)}`; }
  catch { throw failure('DOCUMENT_BROWSER_LEASE_INVALID'); }
  const ownerSignal = options.signal;
  if (ownerSignal?.aborted) throw failure('DOCUMENT_BROWSER_LEASE_CANCELLED');
  let manager: LockManager;
  try {
    if (typeof navigator === 'undefined' || globalThis.isSecureContext !== true || typeof navigator.locks?.request !== 'function') {
      throw failure('DOCUMENT_BROWSER_LEASE_UNAVAILABLE');
    }
    manager = navigator.locks;
  } catch { throw failure('DOCUMENT_BROWSER_LEASE_UNAVAILABLE'); }
  return new Promise<DocumentBrowserLease>((resolve, reject): void => {
    let phase: 'requesting' | 'held' | 'closed' = 'requesting';
    const lost = new AbortController();
    let finishHolding: () => void = () => {};
    const holding = new Promise<void>(done => { finishHolding = done; });
    let nativeRequest: Promise<void> = Promise.resolve();
    const close = (): void => {
      if (phase === 'closed') return;
      phase = 'closed'; clearTimeout(timer); ownerSignal?.removeEventListener('abort', ownerAborted);
      lost.abort(); finishHolding();
    };
    const deny = (code: string): void => {
      if (phase !== 'requesting') return;
      close(); reject(failure(code));
    };
    const ownerAborted = (): void => {
      if (phase === 'requesting') deny('DOCUMENT_BROWSER_LEASE_CANCELLED'); else close();
    };
    const lease: DocumentBrowserLease = {
      get active(): boolean { return phase === 'held' && !ownerSignal?.aborted; },
      signal: lost.signal,
      assertOwned(): void {
        if (phase !== 'held' || ownerSignal?.aborted) { close(); throw failure('DOCUMENT_BROWSER_LEASE_LOST'); }
      },
      release(): Promise<void> { close(); return nativeRequest; },
    };
    const timer = setTimeout(() => deny('DOCUMENT_BROWSER_LEASE_TIMEOUT'), 2_000);
    ownerSignal?.addEventListener('abort', ownerAborted, { once: true });
    if (ownerSignal?.aborted) { deny('DOCUMENT_BROWSER_LEASE_CANCELLED'); return; }
    try {
      // ifAvailable and native signal are mutually exclusive. The owner listener
      // cancels admission locally; a late native callback must release immediately.
      const request = manager.request<void>(name, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (phase !== 'requesting') return;
        if (!lock) { deny('DOCUMENT_BROWSER_LEASE_BUSY'); return; }
        if (lock.name !== name || lock.mode !== 'exclusive') { deny('DOCUMENT_BROWSER_LEASE_UNAVAILABLE'); return; }
        if (ownerSignal?.aborted) { deny('DOCUMENT_BROWSER_LEASE_CANCELLED'); return; }
        phase = 'held'; clearTimeout(timer); resolve(lease);
        await holding;
      });
      nativeRequest = request.then((): void => {
        if (phase === 'requesting') deny('DOCUMENT_BROWSER_LEASE_UNAVAILABLE'); else close();
      }, (): void => {
        if (phase === 'requesting') deny('DOCUMENT_BROWSER_LEASE_UNAVAILABLE'); else close();
      });
    } catch { deny('DOCUMENT_BROWSER_LEASE_UNAVAILABLE'); }
  });
}
