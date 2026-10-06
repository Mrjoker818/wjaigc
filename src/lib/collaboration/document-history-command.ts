import type { CanvasAssetCommand, DocumentAssetCommandResult, DocumentPlacementRemovalSnapshot } from './canvas-asset-command';
import { parseDocumentAssetCommandRequest, parseDocumentAssetCommandResult } from './canvas-asset-command';
import { parseDocumentMediaDirectory } from './document-media-sync';
import { restoreCanvasDocumentAnnotationIdentity } from './canvas-document-image-bridge';
import { z } from 'zod';

export interface DocumentHistoryCommandScope { actorId: string; projectId: string }
export type DocumentHistoryCommand = Extract<CanvasAssetCommand, { action: 'remove' | 'attach' }>;
export interface DocumentHistoryRestorationBinding {
  removalOperationId: string;
  annotationIds: Record<string, string>;
}
export interface DocumentHistoryCommandItem {
  operationId: string;
  idempotencyKey: string;
  command: DocumentHistoryCommand;
  state: 'pending' | 'accepted' | 'confirmed' | 'superseded';
  attempted?: true;
  receipt?: DocumentAssetCommandResult;
  restoration?: DocumentHistoryRestorationBinding;
  /** Past completion checkpoint for scheduling only, never authorization. */
  metadataConfirmedSequence?: number;
}
export interface DocumentHistoryCommandJournal extends DocumentHistoryCommandScope {
  version: 1;
  items: DocumentHistoryCommandItem[];
}
export interface DocumentHistoryCommandBoundary extends DocumentHistoryCommandScope {
  storage: Storage;
  locks: LockManager | undefined;
  isCurrent: () => boolean;
  fetcher?: typeof fetch;
  refreshMedia: (scope: { projectId: string; documentSequence: number }) => Promise<unknown>;
}
export interface RunDocumentHistoryCommandInput extends DocumentHistoryCommandBoundary {
  operationId: string;
  command: DocumentHistoryCommand;
}
export interface RunDocumentHistoryRestorationInput extends DocumentHistoryCommandBoundary {
  operationId: string;
  removalOperationId: string;
  annotationIds?: Record<string, string>;
}
export interface DocumentHistoryRestorationResult {
  item: DocumentHistoryCommandItem;
  removalSnapshot: DocumentPlacementRemovalSnapshot;
  annotationIds: Record<string, string>;
}
export interface ConfirmDocumentHistoryRestorationMetadataInput extends RunDocumentHistoryRestorationInput {
  documentSequence: number;
}
export interface RecoverDocumentHistoryCommandsInput extends DocumentHistoryCommandBoundary {
  /** Fresh-page consumer: apply through the real session and return its ACK. */
  restoreMetadata?: (restored: DocumentHistoryRestorationResult) => Promise<number>;
}
const identifier = z.string().min(1).max(256)
  .refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value));
const managedId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u)
  .refine(value => !/^(?:data|blob|https?|processing)(?:[:_-]|$)/iu.test(value));
const annotationMappingSchema = z.record(z.string(), managedId.refine(value => !['__proto__', 'constructor', 'prototype'].includes(value)));
const restorationSchema = z.object({ removalOperationId: managedId, annotationIds: annotationMappingSchema }).strict();
const scopeSchema = z.object({ actorId: identifier, projectId: identifier }).strict();
const itemSchema = z.object({ operationId: managedId,
  idempotencyKey: z.string().regex(/^document-history:[a-f0-9]{64}$/u), command: z.unknown(),
  state: z.enum(['pending', 'accepted', 'confirmed', 'superseded']), attempted: z.literal(true).optional(),
  receipt: z.unknown().optional(), restoration: restorationSchema.optional(),
  metadataConfirmedSequence: z.number().int().nonnegative().refine(Number.isSafeInteger).optional() }).strict();
const journalSchema = scopeSchema.extend({ version: z.literal(1), items: z.array(itemSchema) }).strict();

function checkedScope(scope: DocumentHistoryCommandScope): DocumentHistoryCommandScope {
  const parsed = scopeSchema.safeParse({ actorId: scope.actorId, projectId: scope.projectId });
  if (!parsed.success) throw new Error('DOCUMENT_HISTORY_SCOPE_INVALID');
  return parsed.data;
}
function assertCurrent(input: DocumentHistoryCommandBoundary): void {
  if (!input.isCurrent()) throw new Error('DOCUMENT_HISTORY_SCOPE_CHANGED');
}
function checkedCommand(command: unknown): DocumentHistoryCommand {
  try {
    const parsed = parseDocumentAssetCommandRequest({ projectId: 'validation', idempotencyKey: 'validation', command }).command;
    if (parsed.action !== 'replace') return parsed;
  } catch { /* reject noncanonical commands without rewriting stored data */ }
  throw new Error('DOCUMENT_HISTORY_COMMAND_INVALID');
}
function versionOf(command: DocumentHistoryCommand): string {
  return command.action === 'attach' ? command.assetVersionId : command.expectedAssetVersionId;
}
function receiptMatches(command: DocumentHistoryCommand, receipt: DocumentAssetCommandResult): boolean {
  return receipt.assetVersionId === versionOf(command)
    && (command.action === 'attach' || receipt.placementId === command.placementId);
}
function canonicalMapping(ids: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(ids).sort().map(id => [id, ids[id]]));
}
function restorationCommand(snapshot: DocumentPlacementRemovalSnapshot): DocumentHistoryCommand {
  const { assetVersionId, x, y, width, height, rotation, zIndex } = snapshot.placement;
  return checkedCommand({ action: 'attach', assetVersionId, transform: { x, y, width, height, rotation, zIndex } });
}
function checkedMapping(snapshot: DocumentPlacementRemovalSnapshot, ids: Record<string, string>): Record<string, string> {
  const parsed = annotationMappingSchema.safeParse(ids);
  const sources = Object.keys(snapshot.annotationRecords);
  if (!parsed.success || Object.keys(parsed.data).length !== sources.length || sources.some(id => !Object.hasOwn(parsed.data, id))
      || new Set(Object.values(parsed.data)).size !== sources.length || Object.values(parsed.data).some(id => sources.includes(id))) {
    throw new Error('DOCUMENT_HISTORY_RESTORATION_INVALID');
  }
  return canonicalMapping(parsed.data);
}
function checkedJournal(value: unknown, scope: DocumentHistoryCommandScope): DocumentHistoryCommandJournal {
  const parsed = journalSchema.safeParse(value);
  if (!parsed.success || parsed.data.actorId !== scope.actorId || parsed.data.projectId !== scope.projectId) {
    throw new Error('DOCUMENT_HISTORY_JOURNAL_INVALID');
  }
  const operations = new Set<string>(), keys = new Set<string>();
  const items = parsed.data.items.map((item): DocumentHistoryCommandItem => {
    let command: DocumentHistoryCommand;
    try { command = checkedCommand(item.command); } catch { throw new Error('DOCUMENT_HISTORY_JOURNAL_INVALID'); }
    let receipt: DocumentAssetCommandResult | undefined;
    try {
      if (item.receipt !== undefined) receipt = parseDocumentAssetCommandResult(item.receipt, { projectId: scope.projectId, command });
    } catch { throw new Error('DOCUMENT_HISTORY_JOURNAL_INVALID'); }
    if (operations.has(item.operationId) || keys.has(item.idempotencyKey)
      || (item.state === 'pending' ? receipt !== undefined : !receipt || !item.attempted)
      || (receipt && !receiptMatches(command, receipt))
      || (item.metadataConfirmedSequence !== undefined && (!item.restoration || !receipt
        || item.metadataConfirmedSequence < receipt.documentSequence))
      || (command.action === 'remove' && item.state === 'superseded')) throw new Error('DOCUMENT_HISTORY_JOURNAL_INVALID');
    operations.add(item.operationId); keys.add(item.idempotencyKey);
    return { ...item, command, receipt, ...(item.restoration ? { restoration: {
      removalOperationId: item.restoration.removalOperationId, annotationIds: canonicalMapping(item.restoration.annotationIds),
    } } : {}) };
  });
  const targets = new Set<string>(), retiredIds = new Set<string>();
  for (const [index, item] of items.entries()) {
    for (const id of Object.keys(item.receipt?.removeSnapshot?.annotationRecords ?? {})) retiredIds.add(id);
    if (!item.restoration) continue;
    const removalIndex = items.findIndex(candidate => candidate.operationId === item.restoration!.removalOperationId);
    const removal = items[removalIndex], snapshot = removal?.receipt?.removeSnapshot;
    if (removalIndex < 0 || removalIndex >= index || removal.command.action !== 'remove' || !snapshot
        || item.command.action !== 'attach' || JSON.stringify(item.command) !== JSON.stringify(restorationCommand(snapshot))) {
      throw new Error('DOCUMENT_HISTORY_JOURNAL_INVALID');
    }
    try { checkedMapping(snapshot, item.restoration.annotationIds); }
    catch { throw new Error('DOCUMENT_HISTORY_JOURNAL_INVALID'); }
    for (const id of Object.values(item.restoration.annotationIds)) {
      // An earlier target becomes an old identity in a later redo/remove cycle.
      // Reject only old identities at this binding's time, not legitimate later snapshots.
      if (targets.has(id) || retiredIds.has(id)) throw new Error('DOCUMENT_HISTORY_JOURNAL_INVALID');
      targets.add(id);
    }
  }
  return { ...parsed.data, items };
}
export function documentHistoryCommandStorageKey(scope: DocumentHistoryCommandScope): string {
  const frozen = checkedScope(scope);
  return 'wujie:document-history:v1:' + encodeURIComponent(JSON.stringify([frozen.actorId, frozen.projectId]));
}
/** Inspection only: structural validation, not authorization, locking, or digest proof.
 * History consumers must use run/recover's locked, digest-checked server results. */
export function readDocumentHistoryCommandJournal(storage: Storage, scope: DocumentHistoryCommandScope): DocumentHistoryCommandJournal | null {
  const frozen = checkedScope(scope);
  const raw = storage.getItem(documentHistoryCommandStorageKey(frozen));
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('DOCUMENT_HISTORY_JOURNAL_CORRUPT'); }
  return checkedJournal(value, frozen);
}
async function commandKey(scope: DocumentHistoryCommandScope, operationId: string, command: DocumentHistoryCommand): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([scope.actorId, scope.projectId, operationId, command]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'document-history:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function checkKeys(input: DocumentHistoryCommandBoundary, journal: DocumentHistoryCommandJournal): Promise<void> {
  for (const item of journal.items) {
    assertCurrent(input);
    const expected = await commandKey(journal, item.operationId, item.command);
    assertCurrent(input);
    if (expected !== item.idempotencyKey) throw new Error('DOCUMENT_HISTORY_JOURNAL_INVALID');
  }
}
function assertNoUncertainSave(input: DocumentHistoryCommandBoundary): void {
  assertCurrent(input);
  if (input.storage.getItem(documentHistoryCommandStorageKey(input) + ':saving') !== null) {
    throw new Error('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
  }
}
function readLockedJournal(input: DocumentHistoryCommandBoundary): DocumentHistoryCommandJournal | null {
  assertNoUncertainSave(input);
  const journal = readDocumentHistoryCommandJournal(input.storage, input);
  const backup = input.storage.getItem(documentHistoryCommandStorageKey(input) + ':previous');
  if (backup !== null) {
    let previous: DocumentHistoryCommandJournal;
    try { previous = checkedJournal(JSON.parse(backup) as unknown, input); }
    catch { throw new Error('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED'); }
    // Backups produced before the durable save fence was added also cannot be
    // silently discarded if a legal-looking primary has lost an old operation.
    for (const before of previous.items) {
      const after = journal?.items.find(item => item.operationId === before.operationId);
      if (!after || (before.receipt && JSON.stringify(after.receipt) !== JSON.stringify(before.receipt))) {
        throw new Error('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
      }
      if (before.restoration && JSON.stringify(after.restoration) !== JSON.stringify(before.restoration)) {
        throw new Error('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
      }
      if (before.metadataConfirmedSequence !== undefined && after.metadataConfirmedSequence !== before.metadataConfirmedSequence) {
        throw new Error('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
      }
      if (after.idempotencyKey !== before.idempotencyKey || JSON.stringify(after.command) !== JSON.stringify(before.command)) {
        throw new Error('DOCUMENT_HISTORY_JOURNAL_INVALID');
      }
    }
  }
  assertCurrent(input);
  return journal;
}
function clearSaveFence(input: DocumentHistoryCommandBoundary): void {
  assertCurrent(input);
  const key = documentHistoryCommandStorageKey(input) + ':saving';
  input.storage.removeItem(key);
  if (input.storage.getItem(key) !== null) throw new Error('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
  assertCurrent(input);
}
function save(input: DocumentHistoryCommandBoundary, journal: DocumentHistoryCommandJournal): void {
  const checked = checkedJournal(journal, input);
  const key = documentHistoryCommandStorageKey(checked), raw = JSON.stringify(checked);
  assertNoUncertainSave(input);
  const previous = input.storage.getItem(key);
  // Preserve an independently readable prior raw before overwriting it. Storage
  // may refuse rollback too; callers must still have the previous durable intent.
  if (previous !== null) {
    checkedJournal(JSON.parse(previous) as unknown, input);
    assertCurrent(input);
    input.storage.setItem(key + ':previous', previous);
    if (input.storage.getItem(key + ':previous') !== previous) throw new Error('DOCUMENT_HISTORY_SAVE_UNCONFIRMED');
  }
  assertCurrent(input);
  input.storage.setItem(key + ':saving', 'pending');
  if (input.storage.getItem(key + ':saving') !== 'pending') throw new Error('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
  assertCurrent(input);
  try {
    input.storage.setItem(key, raw);
    if (input.storage.getItem(key) !== raw) throw new Error('DOCUMENT_HISTORY_SAVE_UNCONFIRMED');
    assertCurrent(input);
    clearSaveFence(input);
  } catch (error) {
    try {
      // Never write an old actor's scope after the UI has moved. The backup
      // remains available if the original key cannot safely be restored.
      assertCurrent(input);
      if (previous === null) input.storage.removeItem(key);
      else input.storage.setItem(key, previous);
      if (input.storage.getItem(key) !== previous) throw new Error('rollback unconfirmed');
      assertCurrent(input);
      clearSaveFence(input);
    } catch { throw new Error('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED', { cause: error }); }
    throw error;
  }
}
async function readResponse(input: DocumentHistoryCommandBoundary, url: string, init: RequestInit): Promise<{ status: number; payload: unknown }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject): void => {
    timer = setTimeout((): void => {
      controller.abort(); reject(new Error('DOCUMENT_HISTORY_REQUEST_TIMEOUT'));
    }, 10_000);
  });
  const read = async (): Promise<{ status: number; payload: unknown }> => {
    assertCurrent(input);
    const response = await (input.fetcher ?? fetch)(url, { ...init, signal: controller.signal });
    assertCurrent(input);
    if (controller.signal.aborted) throw new Error('DOCUMENT_HISTORY_REQUEST_TIMEOUT');
    const payload: unknown = await response.json();
    assertCurrent(input);
    if (controller.signal.aborted) throw new Error('DOCUMENT_HISTORY_REQUEST_TIMEOUT');
    return { status: response.status, payload };
  };
  try { return await Promise.race([read(), timeout]); }
  finally { clearTimeout(timer); }
}
async function refreshWithDeadline(input: DocumentHistoryCommandBoundary, receipt: DocumentAssetCommandResult): Promise<void> {
  assertCurrent(input);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject): void => {
    timer = setTimeout((): void => reject(new Error('DOCUMENT_HISTORY_REFRESH_TIMEOUT')), 10_000);
  });
  try {
    await Promise.race([input.refreshMedia({ projectId: input.projectId, documentSequence: receipt.documentSequence }), timeout]);
    assertCurrent(input);
  } finally { clearTimeout(timer); }
}
async function executeItem(input: DocumentHistoryCommandBoundary, journal: DocumentHistoryCommandJournal, item: DocumentHistoryCommandItem): Promise<DocumentHistoryCommandItem> {
  assertCurrent(input);
  if (!item.attempted) { item.attempted = true; save(input, journal); }
  const response = await readResponse(input, '/api/collaboration/document-assets', {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': journal.actorId },
    body: JSON.stringify({ projectId: journal.projectId, idempotencyKey: item.idempotencyKey, command: item.command }),
  });
  assertCurrent(input);
  if (response.status !== 200) throw new Error(`DOCUMENT_HISTORY_COMMAND_REJECTED:${response.status}`);
  const payload = response.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('DOCUMENT_HISTORY_RECEIPT_INVALID');
  const envelope = payload as Record<string, unknown>;
  let receipt: DocumentAssetCommandResult;
  try {
    if (envelope.success !== true) throw new Error('not successful');
    receipt = parseDocumentAssetCommandResult({ placementId: envelope.placementId, assetVersionId: envelope.assetVersionId,
      documentSequence: envelope.documentSequence,
      ...(Object.hasOwn(envelope, 'removeSnapshot') ? { removeSnapshot: envelope.removeSnapshot } : {}) },
    { projectId: journal.projectId, command: item.command });
    if (item.receipt && JSON.stringify(item.receipt) !== JSON.stringify(receipt)) throw new Error('receipt changed');
  } catch { throw new Error('DOCUMENT_HISTORY_RECEIPT_INVALID'); }
  const wasSuperseded = item.state === 'superseded';
  item.receipt = receipt; item.state = wasSuperseded ? 'superseded' : 'accepted';
  save(input, journal);
  await refreshWithDeadline(input, receipt);
  assertCurrent(input);
  // The local Y.Doc can contain pending edits. Only an independent, complete server directory proves the command outcome.
  const canonical = await readResponse(input, '/api/collaboration/document-project?projectId=' + encodeURIComponent(journal.projectId), {
    method: 'GET', credentials: 'include', cache: 'no-store', headers: { 'x-wujie-expected-actor-id': journal.actorId },
  });
  assertCurrent(input);
  if (canonical.status !== 200) throw new Error(`DOCUMENT_HISTORY_DIRECTORY_REJECTED:${canonical.status}`);
  const directory = parseDocumentMediaDirectory(canonical.payload, journal.projectId);
  if (directory.readOnly || directory.sequence < receipt.documentSequence) throw new Error('DOCUMENT_HISTORY_DIRECTORY_UNCONFIRMED');
  const placement = directory.projection.placements[receipt.placementId];
  if (item.command.action === 'remove') {
    if (!placement?.deleted || placement.assetVersionId !== versionOf(item.command)) throw new Error('DOCUMENT_HISTORY_DIRECTORY_UNCONFIRMED');
    item.state = 'confirmed';
  } else {
    item.state = !wasSuperseded && placement && !placement.deleted && placement.assetVersionId === item.command.assetVersionId
      ? 'confirmed' : 'superseded';
  }
  save(input, journal);
  return structuredClone(item);
}
async function replayRemovalForRestoration(
  input: DocumentHistoryCommandBoundary, journal: DocumentHistoryCommandJournal, operationId: string,
): Promise<DocumentPlacementRemovalSnapshot> {
  const removal = journal.items.find(item => item.operationId === operationId);
  if (!removal || removal.command.action !== 'remove' || !removal.receipt?.removeSnapshot) {
    throw new Error('DOCUMENT_HISTORY_REMOVAL_SNAPSHOT_REQUIRED');
  }
  const authorized = await executeItem(input, journal, removal);
  assertCurrent(input);
  if (authorized.state !== 'confirmed' || !authorized.receipt?.removeSnapshot) throw new Error('DOCUMENT_HISTORY_DIRECTORY_UNCONFIRMED');
  return authorized.receipt.removeSnapshot;
}
async function executeHistoryItem(
  input: DocumentHistoryCommandBoundary, journal: DocumentHistoryCommandJournal, item: DocumentHistoryCommandItem,
): Promise<DocumentHistoryCommandItem> {
  // All public entry points share the bound attach prerequisite, without
  // recursively acquiring this actor/project's Web Lock.
  if (item.restoration) await replayRemovalForRestoration(input, journal, item.restoration.removalOperationId);
  assertCurrent(input);
  return executeItem(input, journal, item);
}
export async function runDocumentHistoryCommand(input: RunDocumentHistoryCommandInput): Promise<DocumentHistoryCommandItem> {
  const scope = checkedScope(input), boundary = { ...input, ...scope };
  const operationId = managedId.safeParse(input.operationId);
  if (!operationId.success) throw new Error('DOCUMENT_HISTORY_OPERATION_INVALID');
  const command = checkedCommand(input.command);
  assertCurrent(boundary);
  if (!boundary.locks?.request) throw new Error('DOCUMENT_HISTORY_LOCK_UNAVAILABLE');
  const result = await boundary.locks.request(documentHistoryCommandStorageKey(scope), async (): Promise<DocumentHistoryCommandItem> => {
    assertCurrent(boundary);
    const journal = readLockedJournal(boundary) ?? { ...scope, version: 1 as const, items: [] };
    await checkKeys(boundary, journal);
    let item = journal.items.find(candidate => candidate.operationId === operationId.data);
    if (item && JSON.stringify(item.command) !== JSON.stringify(command)) throw new Error('DOCUMENT_HISTORY_COMMAND_CHANGED');
    if (!item) {
      const idempotencyKey = await commandKey(scope, operationId.data, command);
      assertCurrent(boundary);
      item = { operationId: operationId.data, idempotencyKey, command, state: 'pending' };
      journal.items.push(item);
    }
    const completed = await executeHistoryItem(boundary, journal, item);
    assertCurrent(boundary);
    return completed;
  });
  assertCurrent(boundary);
  return result;
}
export async function recoverDocumentHistoryCommands(input: RecoverDocumentHistoryCommandsInput): Promise<DocumentHistoryCommandItem[]> {
  const scope = checkedScope(input), boundary = { ...input, ...scope };
  const restoreMetadata = input.restoreMetadata;
  assertCurrent(boundary);
  if (!boundary.locks?.request) throw new Error('DOCUMENT_HISTORY_LOCK_UNAVAILABLE');
  if (restoreMetadata) {
    // Snapshot eligible identities under the existing lock, but do not nest the
    // public run/confirmation locks. Every replay rechecks digest and authority.
    const items = await boundary.locks.request(documentHistoryCommandStorageKey(scope), async (): Promise<DocumentHistoryCommandItem[]> => {
      const journal = readLockedJournal(boundary);
      if (!journal) return [];
      await checkKeys(boundary, journal); assertCurrent(boundary);
      return structuredClone(journal.items.filter(item => item.state !== 'superseded'
        && (item.restoration ? item.metadataConfirmedSequence === undefined : item.state !== 'confirmed')));
    });
    assertCurrent(boundary);
    const completed: DocumentHistoryCommandItem[] = [];
    for (const item of items) {
      assertCurrent(boundary);
      if (!item.restoration) {
        completed.push(await runDocumentHistoryCommand({ ...boundary, operationId: item.operationId, command: item.command }));
      } else {
        const restorationInput = { ...boundary, operationId: item.operationId,
          removalOperationId: item.restoration.removalOperationId, annotationIds: item.restoration.annotationIds };
        const restored = await runDocumentHistoryRestoration(restorationInput);
        assertCurrent(boundary);
        if (restored.item.state === 'superseded') { completed.push(restored.item); continue; }
        const proof = await readRestorationMetadata(boundary, restored, restored.item.receipt!.documentSequence);
        assertCurrent(boundary);
        if (proof.state === 'conflict') throw new Error('DOCUMENT_HISTORY_METADATA_CONFLICT');
        if (proof.state === 'complete') {
          completed.push((await checkpointRestorationMetadata(boundary, restored, proof.sequence)).item);
        } else {
          // The metadata GET can be newer than the attach receipt. Catch the
          // real session up before merging current group properties/members.
          await refreshWithDeadline(boundary, { ...restored.item.receipt!, documentSequence: proof.sequence });
          assertCurrent(boundary);
          const currentProof = await readRestorationMetadata(boundary, restored, proof.sequence);
          assertCurrent(boundary);
          if (currentProof.state === 'conflict') throw new Error('DOCUMENT_HISTORY_METADATA_CONFLICT');
          if (currentProof.state === 'complete') {
            completed.push((await checkpointRestorationMetadata(boundary, restored, currentProof.sequence)).item);
            continue;
          }
          if (currentProof.sequence > proof.sequence) {
            await refreshWithDeadline(boundary, { ...restored.item.receipt!, documentSequence: currentProof.sequence });
            assertCurrent(boundary);
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          const deadline = new Promise<never>((_resolve, reject): void => {
            timer = setTimeout((): void => reject(new Error('DOCUMENT_HISTORY_METADATA_TIMEOUT')), 10_000);
          });
          let sequence: number;
          try { sequence = await Promise.race([restoreMetadata(restored), deadline]); }
          finally { clearTimeout(timer); }
          assertCurrent(boundary);
          completed.push((await confirmDocumentHistoryRestorationMetadata({ ...restorationInput, documentSequence: sequence })).item);
        }
      }
      assertCurrent(boundary);
    }
    assertCurrent(boundary);
    return completed;
  }
  const result = await boundary.locks.request(documentHistoryCommandStorageKey(scope), async (): Promise<DocumentHistoryCommandItem[]> => {
    assertCurrent(boundary);
    const journal = readLockedJournal(boundary);
    if (!journal) return [];
    await checkKeys(boundary, journal);
    const completed: DocumentHistoryCommandItem[] = [];
    for (const item of journal.items) {
      assertCurrent(boundary);
      if (item.state === 'confirmed' || item.state === 'superseded') continue;
      const result = await executeHistoryItem(boundary, journal, item);
      assertCurrent(boundary);
      completed.push(result);
    }
    return completed;
  });
  assertCurrent(boundary);
  return result;
}

export async function runDocumentHistoryRestoration(input: RunDocumentHistoryRestorationInput): Promise<DocumentHistoryRestorationResult> {
  const scope = checkedScope(input), boundary = { ...input, ...scope };
  assertCurrent(boundary);
  const operationId = managedId.safeParse(input.operationId), removalOperationId = managedId.safeParse(input.removalOperationId);
  const supplied = input.annotationIds === undefined ? undefined : annotationMappingSchema.safeParse(input.annotationIds);
  if (!operationId.success || !removalOperationId.success || operationId.data === removalOperationId.data || (supplied && !supplied.success)) {
    throw new Error('DOCUMENT_HISTORY_RESTORATION_INVALID');
  }
  // Detach caller-owned data before the first await, including waiting for the lock.
  const requestedMapping = supplied?.success ? canonicalMapping(supplied.data) : undefined;
  if (!boundary.locks?.request) throw new Error('DOCUMENT_HISTORY_LOCK_UNAVAILABLE');
  const result = await boundary.locks.request(documentHistoryCommandStorageKey(scope), async (): Promise<DocumentHistoryRestorationResult> => {
    assertCurrent(boundary);
    const journal = readLockedJournal(boundary);
    if (!journal) throw new Error('DOCUMENT_HISTORY_REMOVAL_SNAPSHOT_REQUIRED');
    await checkKeys(boundary, journal);
    assertCurrent(boundary);
    const removal = journal.items.find(item => item.operationId === removalOperationId.data);
    const snapshot = removal?.receipt?.removeSnapshot;
    if (!removal || removal.command.action !== 'remove' || !snapshot) throw new Error('DOCUMENT_HISTORY_REMOVAL_SNAPSHOT_REQUIRED');
    let item = journal.items.find(candidate => candidate.operationId === operationId.data);
    if (item && (!item.restoration || item.restoration.removalOperationId !== removalOperationId.data
        || (requestedMapping && JSON.stringify(requestedMapping) !== JSON.stringify(item.restoration.annotationIds)))) {
      throw new Error('DOCUMENT_HISTORY_RESTORATION_CHANGED');
    }
    if (!item && requestedMapping === undefined) throw new Error('DOCUMENT_HISTORY_RESTORATION_INVALID');
    const annotationIds = checkedMapping(snapshot, item?.restoration?.annotationIds ?? requestedMapping ?? {});
    if (!item) {
      const usedTargets = new Set(journal.items.flatMap(candidate => Object.values(candidate.restoration?.annotationIds ?? {})));
      const oldIds = new Set(journal.items.flatMap(candidate => Object.keys(candidate.receipt?.removeSnapshot?.annotationRecords ?? {})));
      if (Object.values(annotationIds).some(id => usedTargets.has(id) || oldIds.has(id))) throw new Error('DOCUMENT_HISTORY_RESTORATION_INVALID');
    }
    // Inspection data is never authority: even a terminal removal is replayed
    // under the current server session before creating/returning its restoration.
    const authorizedSnapshot = await replayRemovalForRestoration(boundary, journal, removal.operationId);
    assertCurrent(boundary);
    const command = restorationCommand(authorizedSnapshot);
    if (!item) {
      const idempotencyKey = await commandKey(scope, operationId.data, command);
      assertCurrent(boundary);
      item = { operationId: operationId.data, idempotencyKey, command, state: 'pending',
        restoration: { removalOperationId: removalOperationId.data, annotationIds } };
      journal.items.push(item);
      save(boundary, journal);
    }
    const completed = await executeItem(boundary, journal, item);
    assertCurrent(boundary);
    return structuredClone({ item: completed, removalSnapshot: authorizedSnapshot, annotationIds });
  });
  assertCurrent(boundary);
  return result;
}

export async function confirmDocumentHistoryRestorationMetadata(
  input: ConfirmDocumentHistoryRestorationMetadataInput,
): Promise<DocumentHistoryRestorationResult> {
  const scope = checkedScope(input), boundary = { ...input, ...scope };
  const documentSequence = input.documentSequence;
  if (!Number.isSafeInteger(documentSequence) || documentSequence < 0) {
    throw new Error('DOCUMENT_HISTORY_METADATA_SEQUENCE_INVALID');
  }
  assertCurrent(boundary);
  // Reuse the journal's digest-checked, locked authorization path. A caller's
  // ACK sequence and an inspection reader are not authority for any identity.
  const restored = await runDocumentHistoryRestoration(boundary);
  assertCurrent(boundary);
  const proof = await readRestorationMetadata(boundary, restored, documentSequence);
  if (proof.state !== 'complete') throw new Error('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
  return checkpointRestorationMetadata(boundary, restored, proof.sequence);
}

async function readRestorationMetadata(
  boundary: DocumentHistoryCommandBoundary, restored: DocumentHistoryRestorationResult, documentSequence: number,
): Promise<{ state: 'complete' | 'pristine' | 'conflict'; sequence: number }> {
  const scope = checkedScope(boundary);
  const receipt = restored.item.receipt;
  if (restored.item.state !== 'confirmed' || !receipt) throw new Error('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
  const response = await readResponse(boundary,
    '/api/collaboration/document-project?projectId=' + encodeURIComponent(scope.projectId), {
      method: 'GET', credentials: 'include', cache: 'no-store', headers: { 'x-wujie-expected-actor-id': scope.actorId },
    });
  assertCurrent(boundary);
  if (response.status !== 200) throw new Error(`DOCUMENT_HISTORY_DIRECTORY_REJECTED:${response.status}`);
  let directory: ReturnType<typeof parseDocumentMediaDirectory>;
  try { directory = parseDocumentMediaDirectory(response.payload, scope.projectId); }
  catch (cause) { throw new Error('DOCUMENT_HISTORY_METADATA_UNCONFIRMED', { cause }); }
  if (directory.readOnly || directory.sequence < Math.max(documentSequence, receipt.documentSequence)) {
    throw new Error('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
  }
  const projection = directory.projection, snapshot = restored.removalSnapshot;
  const previous = projection.placements[snapshot.placementId], next = projection.placements[receipt.placementId];
  if (!previous?.deleted || previous.assetVersionId !== receipt.assetVersionId
      || !next || next.deleted || next.assetVersionId !== receipt.assetVersionId) {
    throw new Error('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
  }
  let complete = true, pristine = true;
  if (Object.hasOwn(snapshot.placement, 'annotation') && next.annotation !== snapshot.placement.annotation) {
    complete = false;
  }
  if (Object.hasOwn(next, 'annotation')) pristine = false;
  if (Object.hasOwn(snapshot.placement, 'groupId')) {
    const originalGroupId = snapshot.placement.groupId;
    // A real concurrent group deletion clears its placement assignments. Its
    // tombstone remains authoritative, not a reason to restore the old group.
    const groupDeleted = typeof originalGroupId === 'string' && projection.groupTombstones?.[originalGroupId] === true;
    if (groupDeleted ? next.groupId !== null && next.groupId !== undefined : next.groupId !== originalGroupId) {
      complete = false;
    }
  }
  if (Object.hasOwn(next, 'groupId')) pristine = false;
  for (const id of snapshot.groupIds) {
    // Remote group tombstones remain authoritative; do not demand resurrection
    // or replace its current name, note, geometry, or other members.
    if (projection.groupTombstones?.[id]) continue;
    const group = projection.groupDefinitions?.[id];
    if (!group || group.imageIds.includes(snapshot.placementId)) { complete = false; pristine = false; }
    else if (!group.imageIds.includes(receipt.placementId)) complete = false;
    else pristine = false;
  }
  for (const [oldId, record] of Object.entries(snapshot.annotationRecords)) {
    const newId = restored.annotationIds[oldId];
    if (!projection.annotationTombstones?.[oldId] || !sameMetadataRecord(projection.annotationRecords?.[oldId], record)) {
      complete = false; pristine = false;
    }
    if (projection.annotationTombstones?.[newId]) { complete = false; pristine = false; }
    const restoredRecord = projection.annotationRecords?.[newId];
    const expected = restoreCanvasDocumentAnnotationIdentity(record, newId, receipt.placementId);
    // An already committed frame from the old client has no order key. Accept
    // that exact legacy shape only when the frozen source also lacked a key;
    // never discard a missing/changed explicit key to manufacture confirmation.
    const legacyComplete = record.orderKey === undefined && restoredRecord?.orderKey === undefined
      && sameMetadataRecord(restoredRecord, { ...record, id: newId, sourceImageId: receipt.placementId });
    if (!sameMetadataRecord(restoredRecord, expected) && !legacyComplete) complete = false;
    if (Object.hasOwn(projection.annotationRecords ?? {}, newId)) pristine = false;
  }
  assertCurrent(boundary);
  return { state: complete ? 'complete' : pristine ? 'pristine' : 'conflict', sequence: directory.sequence };
}

async function checkpointRestorationMetadata(
  boundary: DocumentHistoryCommandBoundary, restored: DocumentHistoryRestorationResult, sequence: number,
): Promise<DocumentHistoryRestorationResult> {
  if (!boundary.locks?.request) throw new Error('DOCUMENT_HISTORY_LOCK_UNAVAILABLE');
  const result = await boundary.locks.request(documentHistoryCommandStorageKey(boundary), async (): Promise<DocumentHistoryRestorationResult> => {
    const journal = readLockedJournal(boundary);
    if (!journal) throw new Error('DOCUMENT_HISTORY_JOURNAL_INVALID');
    await checkKeys(boundary, journal); assertCurrent(boundary);
    const item = journal.items.find(candidate => candidate.operationId === restored.item.operationId);
    if (!item || item.state !== 'confirmed' || item.idempotencyKey !== restored.item.idempotencyKey
        || !sameMetadataRecord(item.receipt, restored.item.receipt) || !sameMetadataRecord(item.restoration, restored.item.restoration)) {
      throw new Error('DOCUMENT_HISTORY_RESTORATION_CHANGED');
    }
    if (item.metadataConfirmedSequence === undefined) { item.metadataConfirmedSequence = sequence; save(boundary, journal); }
    assertCurrent(boundary);
    return structuredClone({ ...restored, item });
  });
  assertCurrent(boundary);
  return result;
}

function orderedMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedMetadataValue);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, orderedMetadataValue((value as Record<string, unknown>)[key])]),
  );
  return value;
}
function sameMetadataRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(orderedMetadataValue(left)) === JSON.stringify(orderedMetadataValue(right));
}
