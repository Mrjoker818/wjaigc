import type { RegisteredWorkspaceAssetReference } from '@/lib/asset-core/types';
import { binaryExtensions, MAX_ASSET_VIDEO_BYTES } from '@/lib/asset-core/binary-media-contract';

export interface DocumentCanvasUploadInput {
  file: File;
  expectedActorId?: string;
  projectId: string;
  idempotencyKey: string;
  transform: { x: number; y: number; width: number; height: number; rotation: number; zIndex: number };
  signal?: AbortSignal;
}

export interface DocumentCanvasUploadResult {
  placementId: string;
  assetVersionId: string;
  documentSequence: number;
  assetReference: RegisteredWorkspaceAssetReference;
}

export async function loadDocumentCanvasVideoSize(file: File, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  assertNotAborted(signal);
  validateMediaFile(file);
  if (!file.type.startsWith('video/')) throw new DocumentCanvasUploadError('unsupported');
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    return await new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', loaded);
        video.removeEventListener('error', failed);
        signal?.removeEventListener('abort', aborted);
      };
      const failed = (): void => { cleanup(); reject(new DocumentCanvasUploadError('unsupported')); };
      const aborted = (): void => { cleanup(); reject(new DocumentCanvasUploadError('cancelled')); };
      const loaded = (): void => {
        if (signal?.aborted) { aborted(); return; }
        if (!Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight)
          || video.videoWidth <= 0 || video.videoHeight <= 0) { failed(); return; }
        cleanup(); resolve({ width: video.videoWidth, height: video.videoHeight });
      };
      const timer = setTimeout(failed, 10_000);
      video.addEventListener('loadedmetadata', loaded);
      video.addEventListener('error', failed);
      signal?.addEventListener('abort', aborted, { once: true });
      video.preload = 'metadata'; video.muted = true; video.src = url;
    });
  } finally { video.removeAttribute('src'); URL.revokeObjectURL(url); }
}

export interface CanvasImageFileDelivery {
  files: File[];
  authority: 'unknown' | 'legacy' | 'document';
  documentUpload?: (files: File[]) => Promise<void>;
  legacyUpload: (files: File[]) => Promise<void>;
}

export async function deliverCanvasImageFiles(input: CanvasImageFileDelivery): Promise<void> {
  if (input.files.length === 0) return;
  if (input.authority === 'unknown') throw new DocumentCanvasUploadError('authority-unresolved');
  if (input.authority === 'document') {
    if (!input.documentUpload) throw new DocumentCanvasUploadError('failed');
    await input.documentUpload(input.files);
    return;
  }
  await input.legacyUpload(input.files);
}

export interface CommitDocumentCanvasFileInput extends Omit<DocumentCanvasUploadInput, 'idempotencyKey'> {
  refreshMedia: (documentSequence: number, result: DocumentCanvasUploadResult) => Promise<unknown>;
  isCurrentProject?: () => boolean;
  isWritableProject?: () => boolean;
}

export async function commitDocumentCanvasFile(input: CommitDocumentCanvasFileInput): Promise<DocumentCanvasUploadResult> {
  assertNotAborted(input.signal);
  if (input.isCurrentProject?.() === false) throw new DocumentCanvasUploadError('stale-project');
  validateMediaFile(input.file);
  const slot = await uploadIntentSlot(input.projectId, input.file);
  assertNotAborted(input.signal);
  const key = getOrCreateUploadIntent(slot);
  const intent = readUploadIntent(slot);
  if (!intent || intent.key !== key) throw new DocumentCanvasUploadError('failed');
  const transform = intent.transform ?? input.transform;
  if (!intent.transform) sessionStorage.setItem(slot, JSON.stringify({ key, transform } satisfies StoredUploadIntent));
  assertNotAborted(input.signal);
  if (input.isCurrentProject?.() === false) throw new DocumentCanvasUploadError('stale-project');
  assertWritable(input.isWritableProject);
  const result = await uploadDocumentCanvasFile({ ...input, idempotencyKey: key, transform });
  assertNotAborted(input.signal);
  if (input.isCurrentProject?.() === false) throw new DocumentCanvasUploadError('stale-project');
  // The just-published placement can arrive over WebSocket before its media
  // directory, making the current projection temporarily unavailable. Refresh
  // is an authorized read, not another write; keep the final writable fence.
  await waitForRefresh(input.refreshMedia(result.documentSequence, result), input.signal);
  assertNotAborted(input.signal);
  if (input.isCurrentProject?.() === false) throw new DocumentCanvasUploadError('stale-project');
  assertWritable(input.isWritableProject);
  clearUploadIntent(slot, key);
  return result;
}

export type DocumentCanvasUploadErrorCode = 'unsupported' | 'too-large' | 'unauthenticated' | 'forbidden'
  | 'conflict' | 'busy' | 'network' | 'invalid-response' | 'stale-project' | 'not-writable'
  | 'authority-unresolved' | 'cancelled' | 'failed';

export class DocumentCanvasUploadError extends Error {
  constructor(readonly code: DocumentCanvasUploadErrorCode) {
    super(code);
    this.name = 'DocumentCanvasUploadError';
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DocumentCanvasUploadError('cancelled');
}

function assertWritable(isWritableProject?: () => boolean): void {
  if (isWritableProject?.() === false) throw new DocumentCanvasUploadError('not-writable');
}

function waitForRefresh<T>(refresh: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return refresh;
  assertNotAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DocumentCanvasUploadError('cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    void refresh.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

async function fileFingerprint(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new DocumentCanvasUploadError('failed');
  const read = (blob: Blob): Promise<ArrayBuffer> => new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new DocumentCanvasUploadError('failed'));
    reader.readAsArrayBuffer(blob);
  });
  const digest = async (bytes: ArrayBuffer): Promise<string> => Array.from(
    new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('');
  // Preserve existing image intents. Videos use a versioned, size-bound digest
  // of all ordered chunk hashes so a 512 MiB file never needs a whole-file copy.
  if (!file.type.startsWith('video/')) return digest(await read(file));
  const chunkBytes = 2 * 1024 * 1024;
  const chunks: string[] = [];
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    chunks.push(await digest(await read(file.slice(offset, offset + chunkBytes))));
  }
  return `chunks-v1:${await digest(new TextEncoder().encode(JSON.stringify([file.size, chunks])).buffer)}`;
}

async function uploadIntentSlot(projectId: string, file: File): Promise<string> {
  return `wujie-document-canvas-upload-v2:${JSON.stringify([projectId, file.name.normalize('NFC'),
    file.type, await fileFingerprint(file)])}`;
}

interface StoredUploadIntent {
  key: string;
  transform?: DocumentCanvasUploadInput['transform'];
}

function readUploadIntent(slot: string): StoredUploadIntent | null {
  const raw = sessionStorage.getItem(slot);
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new DocumentCanvasUploadError('failed'); }
  const record = asRecord(value);
  if (!record || typeof record.key !== 'string' || !/^canvas-upload-[a-f0-9]{32}$/u.test(record.key)) {
    throw new DocumentCanvasUploadError('failed');
  }
  if (record.transform !== undefined) {
    const transform = asRecord(record.transform);
    if (!transform || !['x', 'y', 'width', 'height', 'rotation', 'zIndex']
      .every(field => typeof transform[field] === 'number' && Number.isFinite(transform[field]))) {
      throw new DocumentCanvasUploadError('failed');
    }
  }
  return record as unknown as StoredUploadIntent;
}

function getOrCreateUploadIntent(slot: string): string {
  const existing = readUploadIntent(slot);
  if (existing) return existing.key;
  const random = crypto.getRandomValues(new Uint8Array(16));
  const key = `canvas-upload-${Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  sessionStorage.setItem(slot, JSON.stringify({ key } satisfies StoredUploadIntent));
  return key;
}

export async function getDocumentCanvasUploadIntent(projectId: string, file: File): Promise<string> {
  validateMediaFile(file);
  return getOrCreateUploadIntent(await uploadIntentSlot(projectId, file));
}

function clearUploadIntent(slot: string, key: string): void {
  if (readUploadIntent(slot)?.key === key) sessionStorage.removeItem(slot);
}

export async function clearDocumentCanvasUploadIntent(projectId: string, file: File, key: string): Promise<void> {
  clearUploadIntent(await uploadIntentSlot(projectId, file), key);
}

export interface DocumentCanvasFileBatch {
  files: File[];
  rejected: Array<{ file: File; code: DocumentCanvasUploadErrorCode }>;
}

export async function uniqueDocumentCanvasFiles(files: File[]): Promise<DocumentCanvasFileBatch> {
  const seen = new Set<string>();
  const unique: File[] = [];
  const rejected: DocumentCanvasFileBatch['rejected'] = [];
  for (const file of files) {
    try {
      validateMediaFile(file);
      const identity = JSON.stringify([file.name.normalize('NFC'), file.type, await fileFingerprint(file)]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      unique.push(file);
    } catch (error) {
      rejected.push({ file, code: error instanceof DocumentCanvasUploadError ? error.code : 'failed' });
    }
  }
  return { files: unique, rejected };
}

const IMAGE_LIMIT = 32 * 1024 * 1024;
const SAFE_FILENAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

function uploadFilename(file: File, extensions: readonly string[]): string {
  const name = file.name.normalize('NFC');
  const extension = name.split('.').pop()?.toLowerCase();
  if (name.length <= 200 && !/[. ]$/u.test(name) && SAFE_FILENAME.test(name)
    && extension && extensions.includes(extension)) return name;
  return `image-upload.${extensions[0]}`;
}

function encodeMetadata(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength > 6144) throw new DocumentCanvasUploadError('unsupported');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim();
}

function parseResult(value: unknown, kind: 'image' | 'video'): DocumentCanvasUploadResult {
  const result = asRecord(value);
  const reference = asRecord(result?.assetReference);
  if (result?.success !== true || !nonempty(result.placementId) || !nonempty(result.assetVersionId)
    || !Number.isSafeInteger(result.documentSequence) || (result.documentSequence as number) < 0
    || !reference || !nonempty(reference.assetId) || !nonempty(reference.assetVersionId)
    || !nonempty(reference.placementId) || !nonempty(reference.entityId) || !nonempty(reference.url)
    || reference.kind !== kind || reference.assetVersionId !== result.assetVersionId
    || reference.placementId !== result.placementId) throw new DocumentCanvasUploadError('invalid-response');
  return {
    placementId: result.placementId,
    assetVersionId: result.assetVersionId,
    documentSequence: result.documentSequence as number,
    assetReference: reference as unknown as RegisteredWorkspaceAssetReference,
  };
}

export async function uploadDocumentCanvasFile(input: DocumentCanvasUploadInput): Promise<DocumentCanvasUploadResult> {
  assertNotAborted(input.signal);
  const extensions = validateMediaFile(input.file);
  if (!nonempty(input.projectId) || !nonempty(input.idempotencyKey)) throw new DocumentCanvasUploadError('failed');
  const metadata = { projectId: input.projectId, idempotencyKey: input.idempotencyKey,
    filename: uploadFilename(input.file, extensions), command: { action: 'attach', transform: input.transform } };
  let response: Response;
  try {
    response = await fetch('/api/collaboration/document-assets/upload', {
      method: 'POST', credentials: 'include', cache: 'no-store', signal: input.signal,
      headers: { 'Content-Type': input.file.type, 'x-wujie-asset-import': encodeMetadata(metadata),
        ...(input.expectedActorId ? { 'x-wujie-expected-actor-id': input.expectedActorId } : {}) },
      body: input.file,
    });
  } catch {
    assertNotAborted(input.signal);
    throw new DocumentCanvasUploadError('network');
  }
  assertNotAborted(input.signal);
  if (!response.ok) {
    const errors: Partial<Record<number, DocumentCanvasUploadErrorCode>> = {
      401: 'unauthenticated', 403: 'forbidden', 409: 'conflict', 413: 'too-large', 503: 'busy',
    };
    throw new DocumentCanvasUploadError(errors[response.status] ?? 'failed');
  }
  const payload: unknown = await response.json().catch(() => null);
  assertNotAborted(input.signal);
  return parseResult(payload, input.file.type.startsWith('video/') ? 'video' : 'image');
}

export function isDocumentCanvasMediaFile(file: Pick<File, 'type'>): boolean {
  return /^(image|video)\//u.test(file.type) && !!binaryExtensions(file.type);
}

function validateMediaFile(file: File): readonly string[] {
  const extensions = isDocumentCanvasMediaFile(file) ? binaryExtensions(file.type) : undefined;
  if (!extensions || !file.size) throw new DocumentCanvasUploadError('unsupported');
  if (file.size > (file.type.startsWith('video/') ? MAX_ASSET_VIDEO_BYTES : IMAGE_LIMIT)) throw new DocumentCanvasUploadError('too-large');
  return extensions;
}
