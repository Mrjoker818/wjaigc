import { validSketchId, type SketchScope } from './client';
import { SketchImageReadGate } from './image-client';

export interface SketchRecoveryCandidate {
  id: string; projectId: string; type: 'sketch-to-code' | 'sketch-to-image';
  status: string; createdAt: number; updatedAt: number;
}
export const sketchRecoveryActive = (status: string): boolean => ['queued', 'pending', 'processing', 'submitting'].includes(status);
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = (value: unknown): value is string => validSketchId(value) && value !== '.' && value !== '..';

/** Discovery supplies identities only. Results and financial state must come
 * from an explicit protected client.poll, never from this projection. */
export async function discoverSketchTasks(gate: SketchImageReadGate, scope: SketchScope): Promise<SketchRecoveryCandidate[]> {
  const { status, value } = await gate.json(`/api/tasks/recover?projectId=${encodeURIComponent(scope.projectId)}`);
  if (status !== 200 || !plain(value) || value.success !== true || !Array.isArray(value.tasks) || value.tasks.length > 100) {
    throw new Error('原任务列表暂不可用，请重试读取；尚未确认取消或退款。');
  }
  const candidates: SketchRecoveryCandidate[] = [], seen = new Set<string>();
  for (const entry of value.tasks) {
    if (!plain(entry)) throw new Error('原任务列表格式无效，请重试读取。');
    if (!id(entry.id) || entry.projectId !== scope.projectId || typeof entry.type !== 'string' || !entry.type
      || typeof entry.status !== 'string' || !['queued', 'pending', 'processing', 'submitting', 'completed', 'failed', 'cancelled', 'timeout'].includes(entry.status)
      || !Number.isSafeInteger(entry.createdAt) || !Number.isSafeInteger(entry.updatedAt)
      || (entry.createdAt as number) < 0 || (entry.updatedAt as number) < (entry.createdAt as number) || (entry.updatedAt as number) > 8_640_000_000_000_000
      || seen.has(entry.id)) throw new Error('原任务身份或时间无效，请重试读取。');
    seen.add(entry.id);
    // This shared endpoint also lists unrelated task types.
    if (entry.type !== 'sketch-to-code' && entry.type !== 'sketch-to-image') continue;
    candidates.push({ id: entry.id, projectId: scope.projectId, type: entry.type, status: entry.status,
      createdAt: entry.createdAt as number, updatedAt: entry.updatedAt as number });
  }
  return candidates;
}

/** Ephemeral data only: retained across drawer close within this session.
 * No clients, authorization closures, inputs, result URLs or secrets. */
export interface SketchRecoveryMemory {
  scope: string; candidates: SketchRecoveryCandidate[]; selected?: Pick<SketchRecoveryCandidate, 'id' | 'type'>;
  checked: boolean; decided: boolean; unresolved: boolean;
  known: Map<string, { type: SketchRecoveryCandidate['type']; unresolved: boolean }>;
}
const memories = new WeakMap<object, SketchRecoveryMemory>();
export function sketchRecoveryMemory(session: object, scope: SketchScope): SketchRecoveryMemory {
  const key = JSON.stringify([scope.actorId, scope.projectId, scope.key, scope.authority]);
  let memory = memories.get(session);
  if (!memory || memory.scope !== key) {
    memory = { scope: key, candidates: [], checked: false, decided: false, unresolved: false, known: new Map() };
    memories.set(session, memory);
  }
  return memory;
}
