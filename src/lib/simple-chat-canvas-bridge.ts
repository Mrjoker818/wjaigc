import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { CanvasAssetCommand, DocumentAssetCommandResult } from '@/lib/collaboration/canvas-asset-command';
import { z } from 'zod';
import { parseDocumentMediaDirectory } from '@/lib/collaboration/document-media-sync';

export interface CanvasBridgeScope { actorId: string; projectId: string }
export interface CanvasBridgeItem {
  assetVersionId: string; placementId: string; entityId?: string; slot: number;
  idempotencyKey: string; command: Extract<CanvasAssetCommand, { action: 'attach' }>;
  state: 'pending' | 'accepted' | 'confirmed' | 'superseded';
  documentAttempted?: true;
  receipt?: DocumentAssetCommandResult;
}
export interface CanvasBridgeJournal extends CanvasBridgeScope {
  version: 2; items: CanvasBridgeItem[];
}
export interface EnqueueCanvasBridgeInput extends CanvasBridgeScope {
  storage: Storage; locks: LockManager | undefined; isCurrent: () => boolean;
  references: readonly WorkspaceAssetReference[];
}
export interface ConsumeCanvasBridgeInput extends CanvasBridgeScope {
  storage: Storage; locks: LockManager | undefined; isCurrent: () => boolean;
  authority: 'document' | 'legacy'; fetcher?: typeof fetch;
  refreshMedia: (scope: { projectId: string; documentSequence: number }) => Promise<Array<{
    placementId?: string; assetVersionId?: string;
  }>>;
  resolveReference: (scope: { projectId: string; assetVersionId: string; placementId: string }) => Promise<WorkspaceAssetReference>;
  mergeLegacy: (references: Array<WorkspaceAssetReference & { bridgeSlot: number }>) => boolean | Promise<boolean>;
}
export interface CanvasBridgeConsumption {
  status: 'waiting' | 'consumed'; confirmed: number; superseded: number;
}
export interface MigrateLegacyCanvasBridgeInput extends CanvasBridgeScope {
  storage: Storage; locks: LockManager | undefined; isCurrent: () => boolean;
  resolveReference: ConsumeCanvasBridgeInput['resolveReference'];
}

const identifier = z.string().min(1).max(256)
  .refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value));
const managedId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u)
  .refine(value => !/^(?:data|blob|https?|processing)(?:[:_-]|$)/iu.test(value));
const scopeSchema = z.object({ actorId: identifier, projectId: identifier }).strict();
const pointerSchema = z.object({ assetVersionId: managedId, placementId: managedId, entityId: identifier.optional() });
const transformSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  width: z.literal(512), height: z.literal(512), rotation: z.literal(0), zIndex: z.literal(1),
}).strict();
const receiptSchema = z.object({
  placementId: managedId, assetVersionId: managedId,
  documentSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
const itemSchema = z.object({
  assetVersionId: managedId, placementId: managedId, entityId: identifier.optional(),
  slot: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  idempotencyKey: z.string().regex(/^chat-bridge:[a-f0-9]{64}$/u),
  command: z.object({ action: z.literal('attach'), assetVersionId: managedId, transform: transformSchema }).strict(),
  state: z.enum(['pending', 'accepted', 'confirmed', 'superseded']), receipt: receiptSchema.optional(),
  documentAttempted: z.literal(true).optional(),
}).strict().refine(item => item.command.assetVersionId === item.assetVersionId
  && item.command.transform.x === 200 + (item.slot % 5) * 220
  && item.command.transform.y === 200 + Math.floor(item.slot / 5) * 220
  && (item.state !== 'accepted' || item.receipt !== undefined)
  && (item.state !== 'pending' || item.receipt === undefined)
  && (!item.receipt || item.receipt.assetVersionId === item.assetVersionId));
const journalSchema = scopeSchema.extend({ version: z.literal(2), items: z.array(itemSchema) }).strict();

function checkedScope(scope: CanvasBridgeScope): CanvasBridgeScope {
  const parsed = scopeSchema.safeParse({ actorId: scope.actorId, projectId: scope.projectId });
  if (!parsed.success) throw new Error('CANVAS_BRIDGE_SCOPE_INVALID');
  return parsed.data;
}
function assertCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Error('CANVAS_BRIDGE_SCOPE_CHANGED');
}
function itemIdentity(item: Pick<CanvasBridgeItem, 'assetVersionId' | 'placementId'>): string {
  return JSON.stringify([item.assetVersionId, item.placementId]);
}
function checkedJournal(value: unknown, scope: CanvasBridgeScope): CanvasBridgeJournal {
  const parsed = journalSchema.safeParse(value);
  if (!parsed.success || parsed.data.actorId !== scope.actorId || parsed.data.projectId !== scope.projectId) {
    throw new Error('CANVAS_BRIDGE_JOURNAL_INVALID');
  }
  const identities = new Set<string>();
  const keys = new Set<string>();
  let previousSlot = -1;
  for (const item of parsed.data.items) {
    const identity = itemIdentity(item);
    if (item.slot <= previousSlot || identities.has(identity) || keys.has(item.idempotencyKey)) {
      throw new Error('CANVAS_BRIDGE_JOURNAL_INVALID');
    }
    previousSlot = item.slot;
    identities.add(identity);
    keys.add(item.idempotencyKey);
  }
  return parsed.data;
}
export function canvasBridgeStorageKey(scope: CanvasBridgeScope): string {
  const frozen = checkedScope(scope);
  return 'wujie:canvas-bridge:v2:' + encodeURIComponent(JSON.stringify([frozen.actorId, frozen.projectId]));
}
export function readCanvasBridgeJournal(storage: Storage, scope: CanvasBridgeScope): CanvasBridgeJournal | null {
  const frozen = checkedScope(scope);
  const raw = storage.getItem(canvasBridgeStorageKey(frozen));
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('CANVAS_BRIDGE_JOURNAL_CORRUPT'); }
  return checkedJournal(parsed, frozen);
}
async function attachKey(scope: CanvasBridgeScope, reference: Pick<CanvasBridgeItem, 'assetVersionId' | 'placementId'>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([scope.projectId, reference.assetVersionId, reference.placementId]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'chat-bridge:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function assertJournalKeys(journal: CanvasBridgeJournal, isCurrent: () => boolean): Promise<void> {
  for (const item of journal.items) {
    assertCurrent(isCurrent);
    const expected = await attachKey(journal, item);
    assertCurrent(isCurrent);
    if (item.idempotencyKey !== expected) throw new Error('CANVAS_BRIDGE_JOURNAL_INVALID');
  }
}
function saveJournal(storage: Storage, journal: CanvasBridgeJournal, isCurrent: () => boolean): void {
  const checked = checkedJournal(journal, journal);
  const key = canvasBridgeStorageKey(checked);
  const raw = JSON.stringify(checked);
  assertCurrent(isCurrent);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error('CANVAS_BRIDGE_SAVE_UNCONFIRMED');
  assertCurrent(isCurrent);
}
export async function enqueueCanvasBridgeReferences(input: EnqueueCanvasBridgeInput): Promise<CanvasBridgeJournal> {
  const scope = checkedScope(input);
  assertCurrent(input.isCurrent);
  if (!input.locks?.request) throw new Error('CANVAS_BRIDGE_LOCK_UNAVAILABLE');
  // Snapshot selected identities before waiting; URL and credentials never enter the journal.
  const references = input.references.map(reference => {
    const parsed = pointerSchema.safeParse({ assetVersionId: reference.assetVersionId,
      placementId: reference.placementId, entityId: reference.entityId });
    if (!parsed.success) throw new Error('CANVAS_BRIDGE_REFERENCE_INVALID');
    return parsed.data;
  });
  return input.locks.request(canvasBridgeStorageKey(scope), async () => {
    assertCurrent(input.isCurrent);
    const journal = readCanvasBridgeJournal(input.storage, scope) ?? { ...scope, version: 2 as const, items: [] };
    await assertJournalKeys(journal, input.isCurrent);
    const identities = new Set(journal.items.map(itemIdentity));
    let slot = journal.items.reduce((maximum, item) => Math.max(maximum, item.slot), -1) + 1;
    for (const reference of references) {
      if (identities.has(itemIdentity(reference))) continue;
      assertCurrent(input.isCurrent);
      const idempotencyKey = await attachKey(scope, reference);
      assertCurrent(input.isCurrent);
      journal.items.push({ ...reference, slot, idempotencyKey, state: 'pending',
        command: { action: 'attach', assetVersionId: reference.assetVersionId,
          transform: { x: 200 + (slot % 5) * 220, y: 200 + Math.floor(slot / 5) * 220,
            width: 512, height: 512, rotation: 0, zIndex: 1 } } });
      identities.add(itemIdentity(reference));
      slot += 1;
    }
    saveJournal(input.storage, journal, input.isCurrent);
    return journal;
  });
}

function consumptionResult(journal: CanvasBridgeJournal, status: CanvasBridgeConsumption['status']): CanvasBridgeConsumption {
  return { status, confirmed: journal.items.filter(item => item.state === 'confirmed').length,
    superseded: journal.items.filter(item => item.state === 'superseded').length };
}
function checkedReference(reference: WorkspaceAssetReference, item: Pick<CanvasBridgeItem, 'assetVersionId' | 'placementId' | 'entityId'>): WorkspaceAssetReference {
  if (!reference.url?.trim() || reference.assetVersionId !== item.assetVersionId
    || reference.placementId !== item.placementId || (item.entityId !== undefined && reference.entityId !== item.entityId)) {
    throw new Error('CANVAS_BRIDGE_REFERENCE_INVALID');
  }
  return reference;
}
async function consumeLegacyJournal(input: ConsumeCanvasBridgeInput, journal: CanvasBridgeJournal): Promise<CanvasBridgeConsumption> {
  const pending = journal.items.filter(item => item.state === 'pending' || item.state === 'accepted');
  // A missing response or failed accepted write does not mean the document command never committed.
  if (pending.some(item => item.state === 'accepted' || item.documentAttempted)) {
    throw new Error('CANVAS_BRIDGE_AUTHORITY_CHANGED');
  }
  const references: Array<WorkspaceAssetReference & { bridgeSlot: number }> = [];
  for (const item of pending) {
    assertCurrent(input.isCurrent);
    const reference = await input.resolveReference({ projectId: journal.projectId,
      assetVersionId: item.assetVersionId, placementId: item.placementId });
    assertCurrent(input.isCurrent);
    references.push({ ...checkedReference(reference, item), bridgeSlot: item.slot });
  }
  if (pending.length > 0) {
    assertCurrent(input.isCurrent);
    const merged = await input.mergeLegacy(references);
    assertCurrent(input.isCurrent);
    if (merged !== true) return consumptionResult(journal, 'waiting');
    for (const item of pending) item.state = 'confirmed';
    saveJournal(input.storage, journal, input.isCurrent);
  }
  return consumptionResult(journal, 'consumed');
}
async function readBridgeResponse(input: ConsumeCanvasBridgeInput, url: string, init: RequestInit): Promise<{
  status: number; payload: unknown;
}> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('DOCUMENT_BRIDGE_REQUEST_TIMEOUT'));
    }, 10_000);
  });
  const read = async (): Promise<{ status: number; payload: unknown }> => {
    assertCurrent(input.isCurrent);
    const response = await (input.fetcher ?? fetch)(url, { ...init, signal: controller.signal });
    assertCurrent(input.isCurrent);
    if (controller.signal.aborted) throw new Error('DOCUMENT_BRIDGE_REQUEST_TIMEOUT');
    const payload: unknown = await response.json();
    assertCurrent(input.isCurrent);
    if (controller.signal.aborted) throw new Error('DOCUMENT_BRIDGE_REQUEST_TIMEOUT');
    return { status: response.status, payload };
  };
  try { return await Promise.race([read(), timeout]); }
  finally { clearTimeout(timer); }
}
async function consumeDocumentItem(input: ConsumeCanvasBridgeInput, journal: CanvasBridgeJournal, item: CanvasBridgeItem): Promise<void> {
  assertCurrent(input.isCurrent);
  const key = await attachKey(journal, item);
  assertCurrent(input.isCurrent);
  if (key !== item.idempotencyKey) throw new Error('CANVAS_BRIDGE_JOURNAL_INVALID');
  if (!item.documentAttempted) {
    item.documentAttempted = true;
    saveJournal(input.storage, journal, input.isCurrent);
  }
  assertCurrent(input.isCurrent);
  const response = await readBridgeResponse(input, '/api/collaboration/document-assets', {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': journal.actorId },
    body: JSON.stringify({ projectId: journal.projectId, idempotencyKey: item.idempotencyKey, command: item.command }),
  });
  assertCurrent(input.isCurrent);
  const payload = response.payload;
  const value = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  if (response.status !== 200 || value.success !== true) {
    const code = typeof value.code === 'string' && /^[A-Z][A-Z_0-9]{0,79}$/u.test(value.code)
      ? value.code : 'DOCUMENT_BRIDGE_ATTACH_UNCONFIRMED';
    throw new Error(code);
  }
  const parsed = receiptSchema.safeParse({ placementId: value.placementId,
    assetVersionId: value.assetVersionId, documentSequence: value.documentSequence });
  if (!parsed.success || parsed.data.assetVersionId !== item.assetVersionId) {
    throw new Error('DOCUMENT_BRIDGE_ATTACH_UNCONFIRMED');
  }
  const receipt = parsed.data;
  if (item.receipt && (item.receipt.placementId !== receipt.placementId
    || item.receipt.documentSequence !== receipt.documentSequence)) {
    throw new Error('DOCUMENT_BRIDGE_RECEIPT_CHANGED');
  }
  item.receipt = receipt;
  item.state = 'accepted';
  saveJournal(input.storage, journal, input.isCurrent);
  const images = await input.refreshMedia({ projectId: journal.projectId, documentSequence: receipt.documentSequence });
  assertCurrent(input.isCurrent);
  if (!Array.isArray(images)) throw new Error('DOCUMENT_BRIDGE_READBACK_UNCONFIRMED');
  // refreshMedia follows the active Y.Doc, including unacknowledged local edits.
  // Only the existing server directory may prove deletion/replacement.
  const directoryResponse = await readBridgeResponse(input,
    `/api/collaboration/document-project?projectId=${encodeURIComponent(journal.projectId)}`, {
      method: 'GET', credentials: 'include', cache: 'no-store',
      headers: { 'x-wujie-expected-actor-id': journal.actorId },
    });
  assertCurrent(input.isCurrent);
  if (directoryResponse.status !== 200) throw new Error('DOCUMENT_BRIDGE_READBACK_UNCONFIRMED');
  const directory = parseDocumentMediaDirectory(directoryResponse.payload, journal.projectId);
  if (directory.readOnly || directory.sequence < receipt.documentSequence) {
    throw new Error('DOCUMENT_BRIDGE_READBACK_UNCONFIRMED');
  }
  const placement = directory.projection.placements[receipt.placementId];
  item.state = placement && !placement.deleted && placement.assetVersionId === item.assetVersionId
    ? 'confirmed' : 'superseded';
  saveJournal(input.storage, journal, input.isCurrent);
}
export async function consumeCanvasBridgeJournal(input: ConsumeCanvasBridgeInput): Promise<CanvasBridgeConsumption> {
  const scope = checkedScope(input);
  assertCurrent(input.isCurrent);
  if (!input.locks?.request) throw new Error('CANVAS_BRIDGE_LOCK_UNAVAILABLE');
  return input.locks.request(canvasBridgeStorageKey(scope), async () => {
    assertCurrent(input.isCurrent);
    const journal = readCanvasBridgeJournal(input.storage, scope);
    if (!journal) return { status: 'waiting', confirmed: 0, superseded: 0 };
    await assertJournalKeys(journal, input.isCurrent);
    if (input.authority === 'legacy') return consumeLegacyJournal(input, journal);
    if (input.authority !== 'document') throw new Error('CANVAS_BRIDGE_AUTHORITY_CHANGED');
    for (const item of journal.items) {
      assertCurrent(input.isCurrent);
      if (item.state === 'confirmed' || item.state === 'superseded') continue;
      await consumeDocumentItem(input, journal, item);
      assertCurrent(input.isCurrent);
    }
    return consumptionResult(journal, 'consumed');
  });
}

export async function migrateLegacyCanvasBridge(input: MigrateLegacyCanvasBridgeInput): Promise<'absent' | 'waiting' | 'migrated'> {
  const scope = checkedScope(input);
  assertCurrent(input.isCurrent);
  if (!input.locks?.request) throw new Error('CANVAS_BRIDGE_LOCK_UNAVAILABLE');
  // One-way lock order: legacy -> scoped enqueue. Consumers never acquire this lock.
  return input.locks.request('wujie:canvas-bridge:legacy', async () => {
    assertCurrent(input.isCurrent);
    const oldKey = 'wujie_canvas_bridge';
    const raw = input.storage.getItem(oldKey);
    if (raw === null) return 'absent';
    let payload: unknown;
    try { payload = JSON.parse(raw); }
    catch { throw new Error('CANVAS_BRIDGE_LEGACY_INVALID'); }
    const envelope = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown> : null;
    if (envelope && Object.hasOwn(envelope, 'projectId') && envelope.projectId !== scope.projectId) return 'waiting';
    const parsed = z.array(pointerSchema).min(1).safeParse(Array.isArray(payload) ? payload : envelope?.images);
    if (!parsed.success) throw new Error('CANVAS_BRIDGE_LEGACY_INVALID');
    const references: WorkspaceAssetReference[] = [];
    for (const pointer of parsed.data) {
      assertCurrent(input.isCurrent);
      const canonical = await input.resolveReference({ projectId: scope.projectId,
        assetVersionId: pointer.assetVersionId, placementId: pointer.placementId });
      assertCurrent(input.isCurrent);
      references.push(checkedReference(canonical, pointer));
    }
    if (input.storage.getItem(oldKey) !== raw) return 'waiting';
    await enqueueCanvasBridgeReferences({ ...scope, storage: input.storage, locks: input.locks,
      isCurrent: input.isCurrent, references });
    assertCurrent(input.isCurrent);
    if (input.storage.getItem(oldKey) !== raw) return 'waiting';
    input.storage.removeItem(oldKey);
    if (input.storage.getItem(oldKey) !== null) throw new Error('CANVAS_BRIDGE_LEGACY_REMOVE_UNCONFIRMED');
    assertCurrent(input.isCurrent);
    return 'migrated';
  });
}
