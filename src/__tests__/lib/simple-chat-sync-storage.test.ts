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
  existingStoreKeyPath?: unknown;
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
  operationCalls: { delete: number; get: number; put: number };
  closeCalls(): number;
  blockedHandlerThrew(): boolean;
} {
  const records = new Map<string, SimpleChatSyncEnvelopeV1>();
  const openCalls: Array<{ name: string; version?: number }> = [];
  const createdStores: Array<{ name: string; keyPath: string | string[] | null }> = [];
  const operationCalls = { delete: 0, get: 0, put: 0 };
  const hasExistingStore = Object.prototype.hasOwnProperty.call(options, 'existingStoreKeyPath');
  let initialized = hasExistingStore;
  let blockedHandlerThrew = false;
  let closeCalls = 0;

  const database = {
    close: () => {
      closeCalls += 1;
    },
    objectStoreNames: {
      contains: (name: string) => (
        (hasExistingStore && name === 'envelopes')
        || createdStores.some(store => store.name === name)
      ),
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
          const keyPath = hasExistingStore
            ? options.existingStoreKeyPath
            : createdStores.find(store => store.name === 'envelopes')?.keyPath ?? null;
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
            keyPath,
            get: (userId: string) => execute(() => {
              operationCalls.get += 1;
              const value = records.get(userId);
              return value === undefined ? undefined : structuredClone(value);
            }),
            put: (value: SimpleChatSyncEnvelopeV1) => execute(() => {
              operationCalls.put += 1;
              records.set(value.userId, structuredClone(value));
              return value.userId;
            }, true),
            delete: (userId: string) => execute(() => {
              operationCalls.delete += 1;
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
    operationCalls,
    closeCalls: () => closeCalls,
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

  it('uses an existing envelopes store only when its key path is exactly userId', async () => {
    const indexedDb = createScriptedIndexedDb({ existingStoreKeyPath: 'userId' });
    const store = createIndexedDbSimpleChatEnvelopeStore(indexedDb.factory);

    await store.put(envelope('user-a'));

    expect(indexedDb.createdStores).toEqual([]);
    expect(indexedDb.operationCalls).toEqual({ delete: 0, get: 0, put: 1 });
    expect(await store.get('user-a')).toMatchObject({ userId: 'user-a' });
  });

  it.each([
    ['a different string key path', 'projectId'],
    ['an array key path', ['userId']],
    ['a null key path', null],
    ['an unexpected key path shape', { field: 'userId' }],
  ])('fails closed for an existing envelopes store with %s', async (_label, keyPath) => {
    const indexedDb = createScriptedIndexedDb({ existingStoreKeyPath: keyPath });
    const store = createIndexedDbSimpleChatEnvelopeStore(indexedDb.factory);

    await expect(store.get('user-a')).rejects.toMatchObject({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    });
    await expect(store.put(envelope('user-a'))).rejects.toMatchObject({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    });
    await expect(store.delete('user-a')).rejects.toMatchObject({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    });

    expect(indexedDb.operationCalls).toEqual({ delete: 0, get: 0, put: 0 });
    expect(indexedDb.closeCalls()).toBe(3);
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

  it('processes a legacy source created after an earlier source-free migration check', () => {
    const raw = '[{"id":"later-legacy"}]';
    const storage = memoryLocalStorage();

    expect(backupLegacySimpleChatProjects(storage)).toEqual({ backedUp: false, invalid: false });
    storage.setItem('wujie_chat_projects', raw);
    expect(backupLegacySimpleChatProjects(storage)).toEqual({ backedUp: true, invalid: false });

    expect(storage.getItem('wujie_chat_projects')).toBeNull();
    expect(storage.getItem('wujie_chat_projects:legacy-backup')).toBe(raw);
  });

  it('backs up a marker-accompanied legacy source when no backup exists', () => {
    const raw = '[{"id":"marker-legacy"}]';
    const storage = memoryLocalStorage({
      wujie_chat_projects: raw,
      'wujie_chat_projects:legacy-migrated': '1',
    });

    expect(backupLegacySimpleChatProjects(storage)).toEqual({ backedUp: true, invalid: false });
    expect(storage.getItem('wujie_chat_projects')).toBeNull();
    expect(storage.getItem('wujie_chat_projects:legacy-backup')).toBe(raw);
  });

  it('removes a marker-accompanied legacy source matching the existing backup', () => {
    const raw = '[{"id":"marker-legacy"}]';
    const storage = memoryLocalStorage({
      wujie_chat_projects: raw,
      'wujie_chat_projects:legacy-backup': raw,
      'wujie_chat_projects:legacy-migrated': '1',
    });

    expect(backupLegacySimpleChatProjects(storage)).toEqual({ backedUp: false, invalid: false });
    expect(storage.getItem('wujie_chat_projects')).toBeNull();
    expect(storage.getItem('wujie_chat_projects:legacy-backup')).toBe(raw);
  });

  it('fails closed for a marker-accompanied source conflicting with its backup', () => {
    const raw = '[{"id":"new-legacy"}]';
    const backup = '[{"id":"old-legacy"}]';
    const storage = memoryLocalStorage({
      wujie_chat_projects: raw,
      'wujie_chat_projects:legacy-backup': backup,
      'wujie_chat_projects:legacy-migrated': '1',
    });

    expect(() => backupLegacySimpleChatProjects(storage)).toThrow(expect.objectContaining({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    }));
    expect(storage.getItem('wujie_chat_projects')).toBe(raw);
    expect(storage.getItem('wujie_chat_projects:legacy-backup')).toBe(backup);
  });

  it('preserves invalid marker-accompanied legacy text when the backup was missing', () => {
    const raw = '{not valid json';
    const storage = memoryLocalStorage({
      wujie_chat_projects: raw,
      'wujie_chat_projects:legacy-migrated': 'unexpected-marker-state',
    });

    expect(backupLegacySimpleChatProjects(storage)).toEqual({ backedUp: true, invalid: true });
    expect(storage.getItem('wujie_chat_projects')).toBeNull();
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
