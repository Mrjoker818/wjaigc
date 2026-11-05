import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as execution from './document-execution-scope';
import { documentTransportMode } from './document-transport-mode';

export type DocumentTransportMode = 'ws' | 'http';
export interface DocumentTransportTransition { readonly epoch: number; readonly target: DocumentTransportMode; readonly drained: Promise<void> }
type Participant = { closeDocumentSockets: () => Promise<void> };
interface Admission { epoch: number }
interface PendingTransition {
  handle: DocumentTransportTransition;
  pending: number;
  ready: boolean;
  failed: boolean;
  resolve: () => void;
  reject: (reason: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}
interface Registry {
  version: 1;
  phase: 'open' | 'draining';
  mode: DocumentTransportMode;
  epoch: number;
  participants: Set<Participant>;
  als: AsyncLocalStorage<Admission>;
  transition?: PendingTransition;
}
const REGISTRY = Symbol.for('wujie.documentTransportGate.v1');
const ERROR = Symbol.for('wujie.documentTransportUnavailable.v1');
class DocumentTransportUnavailable extends Error {
  readonly [ERROR] = true;
  constructor() { super('DOCUMENT_TRANSPORT_DRAINING'); this.name = 'DocumentTransportUnavailable'; }
}
function unavailable(): DocumentTransportUnavailable { return new DocumentTransportUnavailable(); }
export function isDocumentTransportUnavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { [ERROR]?: unknown })[ERROR] === true;
}
function registry(): Registry {
  const global = globalThis as unknown as Record<symbol, unknown>;
  const existing = global[REGISTRY];
  if (existing === undefined) {
    const created: Registry = { version: 1, phase: 'open', mode: documentTransportMode(), epoch: 0, participants: new Set(), als: new AsyncLocalStorage() };
    global[REGISTRY] = created; return created;
  }
  const value = existing as Partial<Registry>;
  if (!value || value.version !== 1 || (value.phase !== 'open' && value.phase !== 'draining')
      || (value.mode !== 'ws' && value.mode !== 'http') || !Number.isSafeInteger(value.epoch)
      || !(value.participants instanceof Set) || !(value.als instanceof AsyncLocalStorage)
      || (value.phase === 'draining' && !value.transition)) throw unavailable();
  return value as Registry;
}
function inspect(state: Registry, pending: PendingTransition): void {
  if (state.transition !== pending || state.phase !== 'draining' || pending.failed || pending.ready) return;
  if (pending.pending === 0 && execution.getDocumentExecutionStats().activeScopes === 0) {
    pending.ready = true; pending.resolve(); return;
  }
  if (!pending.timer) {
    pending.timer = setTimeout(() => { pending.timer = undefined; inspect(state, pending); }, 10);
    pending.timer.unref?.();
  }
}
function begin(state: Registry, target: DocumentTransportMode): DocumentTransportTransition {
  if (target !== 'ws' && target !== 'http') throw unavailable();
  if (state.phase === 'draining') {
    if (state.transition?.handle.target !== target) throw unavailable();
    return state.transition.handle;
  }
  if (target === state.mode) throw unavailable();
  let resolve!: () => void; let reject!: (reason: Error) => void;
  const drained = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  void drained.catch(() => undefined);
  const handle: DocumentTransportTransition = Object.freeze({ epoch: state.epoch + 1, target, drained });
  const participants = [...state.participants];
  const pending: PendingTransition = { handle, pending: participants.length, ready: false, failed: false, resolve, reject };
  state.epoch = handle.epoch; state.phase = 'draining'; state.transition = pending;
  for (const participant of participants) {
    try {
      const closing = participant.closeDocumentSockets();
      if (!closing || typeof closing.then !== 'function') throw unavailable();
      void Promise.resolve(closing).then(() => { pending.pending--; inspect(state, pending); }, () => {
        if (!pending.failed) { pending.failed = true; pending.reject(unavailable()); }
      });
    } catch {
      if (!pending.failed) { pending.failed = true; pending.reject(unavailable()); }
    }
  }
  inspect(state, pending);
  return handle;
}
function synchronize(state: Registry): void {
  if (state.phase === 'open') {
    const desired = documentTransportMode();
    if (desired !== state.mode) begin(state, desired);
  }
}
export function documentTransportCanStart(mode: DocumentTransportMode): boolean {
  const state = registry(); synchronize(state); return state.phase === 'open' && state.mode === mode;
}
export function withDocumentHttpAdmission<T>(start: () => Promise<T>): Promise<T> {
  try {
    const state = registry(); synchronize(state); if (state.phase !== 'open') throw unavailable();
    return state.als.run({ epoch: state.epoch }, start);
  } catch (error) { return Promise.reject(error); }
}
export function withDocumentWebSocketAdmission<T>(kind: 'handshake' | 'operation', work: () => Promise<T>): Promise<T> {
  try {
    const state = registry(); synchronize(state);
    if (state.phase !== 'open' || state.mode !== 'ws' || (kind !== 'handshake' && kind !== 'operation')) throw unavailable();
    const run = (execution as unknown as { runIndependentDocumentWebSocketExecution?: <R>(work: () => Promise<R>) => Promise<R> }).runIndependentDocumentWebSocketExecution;
    if (typeof run !== 'function') throw unavailable();
    return state.als.run({ epoch: state.epoch }, () => run(() => { assertDocumentTransportAdmission(); return work(); }));
  } catch (error) { return Promise.reject(error); }
}
export function assertDocumentTransportAdmission(): void {
  const state = registry(); synchronize(state); const admission = state.als.getStore();
  if (!admission || state.phase !== 'open' || admission.epoch !== state.epoch) throw unavailable();
}
export function registerDocumentTransportGateway(participant: Participant): () => void {
  const state = registry(); synchronize(state);
  if (state.phase !== 'open' || !participant || typeof participant.closeDocumentSockets !== 'function' || state.participants.has(participant)) throw unavailable();
  state.participants.add(participant); let registered = true;
  return (): void => { if (registered) { registered = false; state.participants.delete(participant); } };
}
export function beginDocumentTransportTransition(target: DocumentTransportMode): DocumentTransportTransition {
  const state = registry(); synchronize(state); return begin(state, target);
}
export function finishDocumentTransportTransition(handle: DocumentTransportTransition): void {
  const state = registry(); synchronize(state); const pending = state.transition;
  if (state.phase !== 'draining' || !pending || pending.handle !== handle || pending.failed || !pending.ready
      || handle.epoch !== state.epoch || handle.target !== documentTransportMode()
      || pending.pending !== 0 || execution.getDocumentExecutionStats().activeScopes !== 0) throw unavailable();
  if (pending.timer) clearTimeout(pending.timer);
  state.mode = handle.target; state.phase = 'open'; state.transition = undefined;
}
