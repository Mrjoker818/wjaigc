import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFailingEnvelopeStore,
  createMemorySimpleChatEnvelopeStore,
  envelope,
  memoryLocalStorage,
} from '@/__tests__/fixtures/simple-chat-sync';
import type { SimpleChatSyncEnvelopeV1 } from '@/lib/simple-chat-project-sync';
import {
  backupLegacySimpleChatProjects,
  createIndexedDbSimpleChatEnvelopeStore,
} from '@/lib/simple-chat-sync-storage';

interface ScriptedIndexedDbOptions {
  blocked?: boolean;
  openError?: DOMException;
  requestError?: DOMException;
  transactionAbort?: boolean;
}

interface MutableRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

interface MutableOpenRequest extends MutableRequest<IDBDatabase> {
  onblocked: ((event: Event) => void) | null;
  onupgradeneeded: ((event: Event) => void) | null;
}

interface MutableTransaction {
  error: DOMException | null;
  onabort: ((event: Event) => void) | null;
  oncomplete: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  objectStore(): IDBObjectStore;
}

function createScriptedIndexedDb(options: ScriptedIndexedDbOptions = {}): {
  factory: IDBFactory;
  openCalls: Array<{ name: string; version?: number }>;
  createdStores: Array<{ name: string; keyPath: string | string[] | null }>;
  blockedHandlerThrew(): boolean;
} {
  const records = new Map<string, SimpleChatSyncEnvelopeV1>();
  const openCalls: Array<{ name: string; version?: number }> = [];
  const createdStores: Array<{ name: string; keyPath: string | string[] | null }> = [];
  let initialized = false;
  let blockedHandlerThrew = false;

  const database = {
    close: () => undefined,
    objectStoreNames: {
      contains: (name: string) => createdStores.some(store => store.name === name),
    },
    createObjectStore(name: string, parameters?: IDBObjectStoreParameters) {
      createdStores.push({ name, keyPath: parameters?.keyPath ?? null });
      return {} as IDBObjectStore;
    },
    transaction() {
      const transaction: MutableTransaction = {
        error: null,
        onabort: null,
        oncomplete: null,
        onerror: null,
        objectStore() {
          const execute = <T>(operation: () => T, allowRequestError = false): IDBRequest<T> => {
            const request: MutableRequest<T> = {
              result: undefined as T,
              error: null,
              onsuccess: null,
              onerror: null,
            };
            queueMicrotask(() => {
              if (allowRequestError && options.requestError) {
                request.error = options.requestError;
                request.onerror?.(new Event('error'));
                return;
              }
              request.result = operation();
              request.onsuccess?.(new Event('success'));
              queueMicrotask(() => {
                if (options.transactionAbort) {
                  transaction.error = new DOMException('aborted', 'AbortError');
                  transaction.onabort?.(new Event('abort'));
                } else {
                  transaction.oncomplete?.(new Event('complete'));
                }
              });
            });
            return request as unknown as IDBRequest<T>;
          };

          return {
            get: (userId: string) => execute(() => {
              const value = records.get(userId);
              return value === undefined ? undefined : structuredClone(value);
            }),
            put: (value: SimpleChatSyncEnvelopeV1) => execute(() => {
              records.set(value.userId, structuredClone(value));
              return value.userId;
            }, true),
            delete: (userId: string) => execute(() => {
              records.delete(userId);
              return undefined;
            }),
          } as unknown as IDBObjectStore;
        },
      };
      return transaction as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;

  const factory = {
    open(name: string, version?: number) {
      openCalls.push({ name, version });
      const request: MutableOpenRequest = {
        result: database,
        error: null,
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
      };
      if (options.blocked) {
        let blockedErrorRead = true;
        Object.defineProperty(request, 'error', {
          configurable: true,
          get() {
            if (blockedErrorRead) {
              blockedErrorRead = false;
              throw new DOMException('Request is not finished', 'InvalidStateError');
            }
            return new DOMException('open failed', 'UnknownError');
          },
        });
      }
      queueMicrotask(() => {
        if (options.blocked) {
          try {
            request.onblocked?.(new Event('blocked'));
          } catch {
            blockedHandlerThrew = true;
            request.onerror?.(new Event('error'));
          }
          return;
        }
        if (options.openError) {
          request.error = options.openError;
          request.onerror?.(new Event('error'));
          return;
        }
        if (!initialized) {
          request.onupgradeneeded?.(new Event('upgradeneeded'));
          initialized = true;
        }
        request.onsuccess?.(new Event('success'));
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  return {
    factory,
    openCalls,
    createdStores,
    blockedHandlerThrew: () => blockedHandlerThrew,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('simple chat sync storage', () => {
  it('keys memory envelopes strictly by the authenticated user id', async () => {
    const store = createMemorySimpleChatEnvelopeStore();
    await store.put(envelope('user-a'));
    await store.put(envelope('user-b'));

    expect(await store.get('user-a')).toMatchObject({ userId: 'user-a' });
    expect(await store.get('user-b')).toMatchObject({ userId: 'user-b' });

    await store.delete('user-a');

    expect(await store.get('user-a')).toBeNull();
    expect(await store.get('user-b')).toMatchObject({ userId: 'user-b' });
  });

  it('uses the fixed database, version, store, and userId key path', async () => {
    const indexedDb = createScriptedIndexedDb();
    const store = createIndexedDbSimpleChatEnvelopeStore(indexedDb.factory);
    await store.put(envelope('user-a'));
    await store.put(envelope('user-b'));

    expect(indexedDb.openCalls).toContainEqual({
      name: 'wujie-simple-chat-sync',
      version: 1,
    });
    expect(indexedDb.createdStores).toEqual([{
      name: 'envelopes',
      keyPath: 'userId',
    }]);
    expect(await store.get('user-a')).toMatchObject({ userId: 'user-a' });
    expect(await store.get('user-b')).toMatchObject({ userId: 'user-b' });

    await store.delete('user-a');

    expect(await store.get('user-a')).toBeNull();
    expect(await store.get('user-b')).toMatchObject({ userId: 'user-b' });
  });

  it('backs up the global legacy value without assigning it to a user', () => {
    const raw = '[{"id":"legacy","name":"原始项目"}]';
    const storage = memoryLocalStorage({ wujie_chat_projects: raw });

    expect(backupLegacySimpleChatProjects(storage)).toEqual({
      backedUp: true,
      invalid: false,
    });

    expect(storage.getItem('wujie_chat_projects')).toBeNull();
    expect(storage.getItem('wujie_chat_projects:legacy-backup')).toBe(raw);
    expect(storage.getItem('wujie_chat_projects:legacy-migrated')).toBe('1');
    expect(storage.keys()).not.toContainEqual(expect.stringContaining('user-a'));
  });

  it('backs up legacy projects idempotently', () => {
    const raw = '[{"id":"legacy"}]';
    const storage = memoryLocalStorage({ wujie_chat_projects: raw });

    expect(backupLegacySimpleChatProjects(storage)).toEqual({ backedUp: true, invalid: false });
    expect(backupLegacySimpleChatProjects(storage)).toEqual({ backedUp: false, invalid: false });
    expect(storage.getItem('wujie_chat_projects:legacy-backup')).toBe(raw);
  });

  it('preserves invalid legacy text verbatim in the backup', () => {
    const raw = '{not valid json';
    const storage = memoryLocalStorage({ wujie_chat_projects: raw });

    expect(backupLegacySimpleChatProjects(storage)).toEqual({ backedUp: true, invalid: true });
    expect(storage.getItem('wujie_chat_projects')).toBeNull();
    expect(storage.getItem('wujie_chat_projects:legacy-backup')).toBe(raw);
  });

  it('maps quota failures to the stable local storage error', async () => {
    const indexedDb = createScriptedIndexedDb({
      requestError: new DOMException('quota', 'QuotaExceededError'),
    });
    const store = createIndexedDbSimpleChatEnvelopeStore(indexedDb.factory);

    await expect(store.put(envelope('user-a'))).rejects.toMatchObject({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    });
  });

  it('maps blocked database opens to the stable local storage error', async () => {
    const indexedDb = createScriptedIndexedDb({ blocked: true });
    const store = createIndexedDbSimpleChatEnvelopeStore(indexedDb.factory);

    await expect(store.get('user-a')).rejects.toMatchObject({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    });
    expect(indexedDb.blockedHandlerThrew()).toBe(false);
  });

  it('maps database open errors to the stable local storage error', async () => {
    const indexedDb = createScriptedIndexedDb({
      openError: new DOMException('open failed', 'UnknownError'),
    });
    const store = createIndexedDbSimpleChatEnvelopeStore(indexedDb.factory);

    await expect(store.get('user-a')).rejects.toMatchObject({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    });
  });

  it('maps transaction aborts to the stable local storage error', async () => {
    const indexedDb = createScriptedIndexedDb({ transactionAbort: true });
    const store = createIndexedDbSimpleChatEnvelopeStore(indexedDb.factory);

    await expect(store.delete('user-a')).rejects.toMatchObject({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    });
  });

  it('maps a missing IndexedDB environment to the stable local storage error', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = createIndexedDbSimpleChatEnvelopeStore();

    await expect(store.get('user-a')).rejects.toMatchObject({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    });
  });

  it('provides a failing memory fixture with the same stable error contract', async () => {
    const store = createFailingEnvelopeStore(new DOMException('quota', 'QuotaExceededError'));

    await expect(store.put(envelope('user-a'))).rejects.toMatchObject({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    });
  });
});
