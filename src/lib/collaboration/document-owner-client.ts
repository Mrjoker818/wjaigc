export interface OwnerClientScope { userId: string; projectId: string; generation: number; }
export interface SavedOwnerProject { projectId: string; expectedRevision: number; }
export interface OwnerProjectSync {
  flushProjectsToServerWithConflictRecovery(): Promise<{ projectIdMap: Record<string, string> }>;
  getProjectSyncRevision(): number;
}
export interface OwnerProjectStatus {
  projectId: string; featureEnabled: boolean; enabled: boolean; currentRevision: number;
}
export async function readOwnerProjectStatus(projectId: string, signal?: AbortSignal): Promise<OwnerProjectStatus> {
  const data = await requestOwnerDocument(`/api/collaboration/document-enable?projectId=${encodeURIComponent(projectId)}`, { signal });
  if (data.projectId !== projectId || typeof data.featureEnabled !== 'boolean' || typeof data.enabled !== 'boolean'
    || typeof data.currentRevision !== 'number' || !Number.isSafeInteger(data.currentRevision) || data.currentRevision < 0) {
    throw new OwnerDocumentRequestError('DOCUMENT_RESPONSE_INVALID', 200, false);
  }
  return { projectId, featureEnabled: data.featureEnabled, enabled: data.enabled, currentRevision: data.currentRevision };
}

export class OwnerDocumentRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly uncertain: boolean,
    readonly currentRevision?: number,
    readonly projectId?: string,
  ) {
    super(code);
    this.name = 'OwnerDocumentRequestError';
  }
}

export async function saveOwnerProject(projectId: string, sync: OwnerProjectSync): Promise<SavedOwnerProject> {
  const { projectIdMap } = await sync.flushProjectsToServerWithConflictRecovery();
  const persistedId = projectIdMap[projectId] ?? projectId;
  const expectedRevision = sync.getProjectSyncRevision();
  if (!persistedId.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new OwnerDocumentRequestError('DOCUMENT_SAVED_PROJECT_INVALID', 0, false);
  }
  return { projectId: persistedId, expectedRevision };
}

export function isOwnerClientScopeCurrent(expected: OwnerClientScope, current: OwnerClientScope | null): boolean {
  return current !== null && expected.userId === current.userId
    && expected.projectId === current.projectId && expected.generation === current.generation;
}

export async function requestOwnerDocument(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const mutation = !['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase());
  let response: Response;
  try {
    response = await fetch(url, { ...init, credentials: 'include', cache: 'no-store' });
  } catch {
    throw new OwnerDocumentRequestError('DOCUMENT_NETWORK_ERROR', 0, mutation);
  }
  let payload: unknown;
  try { payload = await response.json() as unknown; } catch {
    throw new OwnerDocumentRequestError('DOCUMENT_RESPONSE_INVALID', response.status,
      mutation && (response.ok || response.status >= 500));
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new OwnerDocumentRequestError('DOCUMENT_RESPONSE_INVALID', response.status,
      mutation && (response.ok || response.status >= 500));
  }
  const data = payload as Record<string, unknown>;
  if (!response.ok || data.success !== true) {
    const code = typeof data.code === 'string' ? data.code : 'DOCUMENT_RESPONSE_INVALID';
    const revision = typeof data.currentRevision === 'number' && Number.isSafeInteger(data.currentRevision)
      && data.currentRevision >= 0 ? data.currentRevision : undefined;
    throw new OwnerDocumentRequestError(code, response.status,
      mutation && (response.ok || response.status >= 500), revision);
  }
  return data;
}
export async function saveAndEnableOwnerProject(
  scope: OwnerClientScope, sync: OwnerProjectSync, currentScope: () => OwnerClientScope | null,
  signal?: AbortSignal,
): Promise<SavedOwnerProject> {
  const expected = { ...scope };
  const assertCurrent = (): void => {
    if (!isOwnerClientScopeCurrent(expected, currentScope())) {
      throw new OwnerDocumentRequestError('DOCUMENT_SCOPE_CHANGED', 0, false);
    }
  };
  assertCurrent();
  const saved = await saveOwnerProject(expected.projectId, sync);
  assertCurrent();
  let result: Record<string, unknown>;
  try {
    result = await requestOwnerDocument('/api/collaboration/document-enable', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify(saved),
    });
  } catch (error) {
    assertCurrent();
    if (error instanceof OwnerDocumentRequestError) {
      throw new OwnerDocumentRequestError(error.code, error.status, error.uncertain, error.currentRevision, saved.projectId);
    }
    throw error;
  }
  assertCurrent();
  if (result.projectId !== saved.projectId) {
    throw new OwnerDocumentRequestError('DOCUMENT_RESPONSE_INVALID', 200, true, undefined, saved.projectId);
  }
  return saved;
}
