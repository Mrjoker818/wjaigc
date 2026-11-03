import type { SimpleChatProject } from '@/components/simple-chat/simple-chat-types';
import { validateSimpleChatProjects } from '@/lib/simple-chat-project-sync';
import { loadSimpleChatDashboardProjects } from '@/lib/simple-chat-sync-client';
import type { SimpleChatEnvelopeStore } from '@/lib/simple-chat-sync-storage';

export type DashboardReadKind = 'available' | 'local' | 'auth' | 'storage' | 'unavailable' | 'timeout' | 'cancelled';
export interface DashboardReadResult { kind: DashboardReadKind; projects: SimpleChatProject[] }
interface DashboardReadOptions { userId: string; store: SimpleChatEnvelopeStore; fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; onSlow?: () => void; loader?: typeof loadSimpleChatDashboardProjects }

/** Observe the existing loader without changing its callers or offline contract. */
export async function readDashboardProjects(options: DashboardReadOptions): Promise<DashboardReadResult> {
  const controller = new AbortController();
  let closed = false;
  let status: number | undefined;
  let local: 'none' | 'valid' | 'invalid' | 'failed' = 'none';
  let hint: 'available' | 'local' | 'unavailable' | 'identity' | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const stopped = new Promise<DashboardReadResult>(resolve => {
    cancel = () => { closed = true; controller.abort(); resolve({ kind: 'cancelled', projects: [] }); };
    timer = setTimeout(() => { if (!closed) options.onSlow?.(); }, options.timeoutMs ?? 3000);
  });
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener('abort', cancel, { once: true });
  const store: SimpleChatEnvelopeStore = {
    ...options.store,
    get: async userId => {
      if (closed) throw new Error('Dashboard read no longer active');
      try {
        const value = await options.store.get(userId);
        if (closed) throw new Error('Dashboard read no longer active');
        local = value === null ? 'invalid' : value.userId === userId && validateSimpleChatProjects(value.currentProjects).success ? 'valid' : 'invalid';
        return value;
      } catch (error) { local = 'failed'; throw error; }
    },
  };
  const observedFetch: typeof fetch = async (input, init) => {
    const response = await (options.fetchImpl ?? fetch)(input, { ...init, signal: controller.signal });
    if (String(input).includes('chat_simple_projects') || String(input).includes('/api/simple-chat/actor-bound-sync-v1')) status = response.status;
    return response;
  };
  // Newer identity-bound loader accepts onStatus; the mainline array API ignores it.
  const loaderOptions = { userId: options.userId, store, fetchImpl: observedFetch,
    onStatus: (value: 'available' | 'local' | 'unavailable' | 'identity') => { hint = value; } };
  const operation = (options.loader ?? loadSimpleChatDashboardProjects)(loaderOptions).then((projects): DashboardReadResult => {
    if (hint === 'identity' || status === 401 || status === 403 || status === 409) return { kind: 'auth', projects: [] };
    if (local === 'failed') return { kind: 'storage', projects: [] };
    if (local === 'valid') return { kind: 'local', projects };
    if (local === 'invalid' || hint === 'unavailable' || (status !== undefined && (status < 200 || status >= 300))) return { kind: 'unavailable', projects: [] };
    return { kind: 'available', projects };
  }).catch((): DashboardReadResult => ({ kind: 'unavailable', projects: [] }));
  try { return await Promise.race([operation, stopped]); }
  finally { closed = true; if (timer !== undefined) clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
}
