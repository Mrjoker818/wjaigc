'use client';

export interface CanvasShareViewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface CanvasShareReadinessFailure {
  itemIndex: number;
  display?: { label?: string; altText?: string };
  code: string;
  message: string;
}

export interface CanvasSharePreflightResult {
  projectName: string;
  projectRevision: number;
  itemCount: number;
  viewport: CanvasShareViewport;
  readiness: {
    ready: boolean;
    failures: CanvasShareReadinessFailure[];
  };
}

export interface CanvasShareOwnerRecord {
  shareId: string;
  title: string;
  status: 'active' | 'revoked' | 'expired';
  projectRevision: number;
  itemCount: number;
  expiresAt: string | null;
  allowDownload: boolean;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CanvasShareCreateResult {
  shareUrl: string;
  shareId: string;
  expiresAt: string | null;
  allowDownload: boolean;
  snapshot: {
    title: string;
    status: CanvasShareOwnerRecord['status'];
    projectRevision: number;
    itemCount: number;
    createdAt: string;
  };
}

export interface CanvasShareCreatedAccess {
  shareId: string;
  shareUrl: string;
}

export interface CanvasSharePreflightInput {
  projectId: string;
  requestedViewport?: Partial<CanvasShareViewport> | null;
}

export interface CanvasShareCreateInput {
  projectId: string;
  title: string;
  requestedViewport?: Partial<CanvasShareViewport> | null;
  expiresAt?: string | null;
  allowDownload: boolean;
}

export interface CanvasSharePolicyPatch {
  expiresAt?: string | null;
  allowDownload?: boolean;
}

export class CanvasShareApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;

  constructor(code: string, status: number, requestId?: string) {
    super('画布分享请求失败');
    this.name = 'CanvasShareApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  if (!isRecord(payload)) {
    throw new CanvasShareApiError('CANVAS_SHARE_RESPONSE_INVALID', response.status);
  }
  if (!response.ok || payload.success !== true) {
    throw new CanvasShareApiError(
      typeof payload.code === 'string' ? payload.code : 'CANVAS_SHARE_REQUEST_FAILED',
      response.status,
      typeof payload.requestId === 'string' ? payload.requestId : undefined,
    );
  }
  return payload;
}

async function requestJson(
  input: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(input, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: init?.body === undefined
      ? init?.headers
      : { 'Content-Type': 'application/json', ...init.headers },
  });
  return readPayload(response);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function trustedShareUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    if (!/^\/shared\/canvas\/[A-Za-z0-9_-]+$/u.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parsePreflight(payload: Record<string, unknown>): CanvasSharePreflightResult {
  const viewport = isRecord(payload.viewport) ? payload.viewport : null;
  const readiness = isRecord(payload.readiness) ? payload.readiness : null;
  const projectRevision = finiteNumber(payload.projectRevision);
  const itemCount = finiteNumber(payload.itemCount);
  const offsetX = finiteNumber(viewport?.offsetX);
  const offsetY = finiteNumber(viewport?.offsetY);
  const zoom = finiteNumber(viewport?.zoom);
  if (
    projectRevision === null
    || itemCount === null
    || typeof payload.projectName !== 'string'
    || !payload.projectName.trim()
    || offsetX === null
    || offsetY === null
    || zoom === null
    || typeof readiness?.ready !== 'boolean'
    || !Array.isArray(readiness.failures)
  ) throw new CanvasShareApiError('CANVAS_SHARE_RESPONSE_INVALID', 502);

  const failures = readiness.failures.flatMap((entry): CanvasShareReadinessFailure[] => {
    if (!isRecord(entry) || typeof entry.code !== 'string' || typeof entry.message !== 'string') {
      return [];
    }
    const itemIndex = finiteNumber(entry.itemIndex);
    if (itemIndex === null) return [];
    const display = isRecord(entry.display) ? entry.display : null;
    return [{
      itemIndex,
      ...(display ? {
        display: {
          ...(typeof display.label === 'string' ? { label: display.label } : {}),
          ...(typeof display.altText === 'string' ? { altText: display.altText } : {}),
        },
      } : {}),
      code: entry.code,
      message: entry.message,
    }];
  });
  if (failures.length !== readiness.failures.length) {
    throw new CanvasShareApiError('CANVAS_SHARE_RESPONSE_INVALID', 502);
  }
  return {
    projectName: payload.projectName.trim(),
    projectRevision,
    itemCount,
    viewport: { offsetX, offsetY, zoom },
    readiness: { ready: readiness.ready, failures },
  };
}

function parseOwnerRecord(value: unknown): CanvasShareOwnerRecord {
  if (!isRecord(value)) throw new CanvasShareApiError('CANVAS_SHARE_RESPONSE_INVALID', 502);
  const status = value.status;
  const projectRevision = finiteNumber(value.projectRevision);
  const itemCount = finiteNumber(value.itemCount);
  const viewCount = finiteNumber(value.viewCount);
  if (
    typeof value.shareId !== 'string'
    || typeof value.title !== 'string'
    || !['active', 'revoked', 'expired'].includes(String(status))
    || projectRevision === null
    || itemCount === null
    || viewCount === null
    || (value.expiresAt !== null && typeof value.expiresAt !== 'string')
    || typeof value.allowDownload !== 'boolean'
    || (value.lastViewedAt !== null && typeof value.lastViewedAt !== 'string')
    || typeof value.createdAt !== 'string'
    || (value.revokedAt !== null && typeof value.revokedAt !== 'string')
  ) throw new CanvasShareApiError('CANVAS_SHARE_RESPONSE_INVALID', 502);
  return {
    shareId: value.shareId,
    title: value.title,
    status: status as CanvasShareOwnerRecord['status'],
    projectRevision,
    itemCount,
    expiresAt: value.expiresAt as string | null,
    allowDownload: value.allowDownload,
    viewCount,
    lastViewedAt: value.lastViewedAt as string | null,
    createdAt: value.createdAt,
    revokedAt: value.revokedAt as string | null,
  };
}

export async function preflightCanvasShare(
  input: CanvasSharePreflightInput,
  signal?: AbortSignal,
): Promise<CanvasSharePreflightResult> {
  const payload = await requestJson('/api/canvas-shares/preflight', {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
  return parsePreflight(payload);
}

export async function createCanvasShare(
  input: CanvasShareCreateInput,
  signal?: AbortSignal,
): Promise<CanvasShareCreateResult> {
  const payload = await requestJson('/api/canvas-shares', {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
  const snapshot = isRecord(payload.snapshot) ? payload.snapshot : null;
  const shareUrl = trustedShareUrl(payload.shareUrl);
  if (
    !shareUrl
    || typeof payload.shareId !== 'string'
    || (payload.expiresAt !== null && typeof payload.expiresAt !== 'string')
    || typeof payload.allowDownload !== 'boolean'
    || !snapshot
    || typeof snapshot.title !== 'string'
    || !['active', 'revoked', 'expired'].includes(String(snapshot.status))
    || finiteNumber(snapshot.projectRevision) === null
    || finiteNumber(snapshot.itemCount) === null
    || typeof snapshot.createdAt !== 'string'
  ) throw new CanvasShareApiError('CANVAS_SHARE_RESPONSE_INVALID', 502);
  return {
    shareUrl,
    shareId: payload.shareId,
    expiresAt: payload.expiresAt as string | null,
    allowDownload: payload.allowDownload,
    snapshot: {
      title: snapshot.title,
      status: snapshot.status as CanvasShareOwnerRecord['status'],
      projectRevision: snapshot.projectRevision as number,
      itemCount: snapshot.itemCount as number,
      createdAt: snapshot.createdAt,
    },
  };
}

export async function listCanvasShares(
  projectId: string,
  signal?: AbortSignal,
): Promise<CanvasShareOwnerRecord[]> {
  const payload = await requestJson(
    `/api/canvas-shares?projectId=${encodeURIComponent(projectId)}`,
    { signal },
  );
  if (!Array.isArray(payload.shares)) {
    throw new CanvasShareApiError('CANVAS_SHARE_RESPONSE_INVALID', 502);
  }
  return payload.shares.map(parseOwnerRecord);
}

export async function patchCanvasSharePolicy(
  shareId: string,
  patch: CanvasSharePolicyPatch,
  signal?: AbortSignal,
): Promise<CanvasShareOwnerRecord> {
  const payload = await requestJson(`/api/canvas-shares/${encodeURIComponent(shareId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    signal,
  });
  return parseOwnerRecord(payload.share);
}

export async function revokeCanvasShare(
  shareId: string,
  signal?: AbortSignal,
): Promise<CanvasShareOwnerRecord> {
  const payload = await requestJson(
    `/api/canvas-shares/${encodeURIComponent(shareId)}/revoke`,
    { method: 'POST', body: '{}', signal },
  );
  return parseOwnerRecord(payload.share);
}
