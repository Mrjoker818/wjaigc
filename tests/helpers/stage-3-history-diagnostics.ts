/** Self-contained so Playwright can install it before application hydration. */
export function installStage3HistoryDiagnostics(input: { projectId: string }): () => void {
  const key = 'wujie:canvas:prepared-snapshot:v1';
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  let count = 0;
  const record = (value: unknown): Record<string, unknown> | null => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null
  );
  const revision = (value: unknown): number | null => (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  );
  const coordinate = (value: unknown): number | null => (
    typeof value === 'number' && Number.isFinite(value) ? value : null
  );
  const emit = (phase: 'boot' | 'write' | 'remove' | 'beforeunload' | 'pagehide'): void => {
    if (count > 16) return;
    const truncated = count++ === 16;
    try {
      if (truncated) {
        console.info('STAGE3_HISTORY_STORAGE {"phase":"truncated","limit":16}');
        return;
      }
      let snapshot: Record<string, unknown> | null = null;
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const stored = record(JSON.parse(raw));
          const source = record(stored?.snapshot);
          if (source?.projectId === input.projectId) {
            const image = record(Array.isArray(source.images) ? source.images[0] : null);
            snapshot = {
              version: stored?.version === 3 || stored?.version === 4 ? stored.version : null,
              base: revision(stored?.baseProjectRevision),
              max: revision(stored?.maxRecoverableProjectRevision),
              revision: revision(source.revision),
              geometry: image ? {
                x: coordinate(image.x), y: coordinate(image.y),
                width: coordinate(image.width), height: coordinate(image.height),
              } : null,
            };
            const currentOwner = localStorage.getItem('unbounded_ai_current_user');
            if (currentOwner) {
              snapshot.ownerMatches = stored?.ownerId === currentOwner;
              let adopted: Record<string, unknown> | null = null;
              try {
                adopted = record(JSON.parse(localStorage.getItem(
                  `unbounded_ai_project_adoption_commit_v2:${encodeURIComponent(currentOwner)}`,
                ) ?? 'null'));
              } catch { /* A malformed adoption envelope contributes no revision. */ }
              snapshot.persistedAdoptionRevision = revision(adopted?.revision);
            }
          }
        } catch { /* Invalid storage is opaque; the application still owns recovery. */ }
      }
      console.info(`STAGE3_HISTORY_STORAGE ${JSON.stringify({ phase, snapshot })}`);
    } catch { /* Diagnostics must never alter lifecycle or storage behavior. */ }
  };
  const observedSet: Storage['setItem'] = function (this: Storage, keyToSet: string, value: string): void {
    originalSet.call(this, keyToSet, value);
    try {
      if (this === localStorage && keyToSet === key) emit('write');
    } catch { /* A diagnostic lookup must not turn a successful native write into a failure. */ }
  };
  const observedRemove: Storage['removeItem'] = function (this: Storage, keyToRemove: string): void {
    try {
      if (this === localStorage && keyToRemove === key) emit('remove');
    } catch { /* The native removal must still run and keep its own exception semantics. */ }
    originalRemove.call(this, keyToRemove);
  };
  Storage.prototype.setItem = observedSet;
  Storage.prototype.removeItem = observedRemove;
  const beforeUnload = (): void => emit('beforeunload');
  const pageHide = (): void => emit('pagehide');
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('pagehide', pageHide);
  emit('boot');
  return (): void => {
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('pagehide', pageHide);
    if (Storage.prototype.setItem === observedSet) Storage.prototype.setItem = originalSet;
    if (Storage.prototype.removeItem === observedRemove) Storage.prototype.removeItem = originalRemove;
  };
}

export function summarizeStage3HistorySync(value: unknown, projectId: string): {
  base: number | null;
  geometry: { x: number | null; y: number | null; width: number | null; height: number | null } | null;
} | null {
  const record = (input: unknown): Record<string, unknown> | null => (
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown> : null
  );
  const body = record(value);
  if (body?.key !== 'projects' || !Array.isArray(body.value)) return null;
  const project = body.value.map(record).find(candidate => candidate?.id === projectId);
  if (!project) return null;
  const image = record(Array.isArray(project.canvasImages) ? project.canvasImages[0] : null);
  const coordinate = (input: unknown): number | null => (
    typeof input === 'number' && Number.isFinite(input) ? input : null
  );
  return {
    base: typeof body.projectRevision === 'number'
      && Number.isSafeInteger(body.projectRevision) && body.projectRevision >= 0 ? body.projectRevision : null,
    geometry: image ? {
      x: coordinate(image.x), y: coordinate(image.y),
      width: coordinate(image.width), height: coordinate(image.height),
    } : null,
  };
}
