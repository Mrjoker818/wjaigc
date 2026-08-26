import type { SimpleChatSyncEnvelopeV1 } from '@/lib/simple-chat-project-sync';

const DATABASE_NAME = 'wujie-simple-chat-sync';
const DATABASE_VERSION = 1;
const ENVELOPE_STORE_NAME = 'envelopes';
const LEGACY_PROJECTS_KEY = 'wujie_chat_projects';
const LEGACY_BACKUP_KEY = 'wujie_chat_projects:legacy-backup';
const LEGACY_MIGRATION_MARKER_KEY = 'wujie_chat_projects:legacy-migrated';

export interface SimpleChatEnvelopeStore {
  get(userId: string): Promise<SimpleChatSyncEnvelopeV1 | null>;
  put(envelope: SimpleChatSyncEnvelopeV1): Promise<void>;
  delete(userId: string): Promise<void>;
}

export class SimpleChatSyncStorageError extends Error {
  readonly code = 'CHAT_SYNC_LOCAL_STORAGE_FAILED' as const;
  readonly cause: unknown;

  constructor(cause?: unknown) {
    super('Simple chat local storage failed');
    this.name = 'SimpleChatSyncStorageError';
    this.cause = cause;
  }
}

export function createIndexedDbSimpleChatEnvelopeStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): SimpleChatEnvelopeStore {
  return {
    async get(userId) {
      const value = await runTransaction(
        factory,
        'readonly',
        objectStore => objectStore.get(userId) as IDBRequest<SimpleChatSyncEnvelopeV1 | undefined>,
      );
      return value ?? null;
    },
    async put(envelope) {
      await runTransaction(factory, 'readwrite', objectStore => objectStore.put(envelope));
    },
    async delete(userId) {
      await runTransaction(factory, 'readwrite', objectStore => objectStore.delete(userId));
    },
  };
}

export function backupLegacySimpleChatProjects(storage: Storage): {
  backedUp: boolean;
  invalid: boolean;
} {
  try {
    const raw = storage.getItem(LEGACY_PROJECTS_KEY);
    if (raw === null) {
      storage.setItem(LEGACY_MIGRATION_MARKER_KEY, '1');
      return { backedUp: false, invalid: false };
    }

    const existingBackup = storage.getItem(LEGACY_BACKUP_KEY);
    if (existingBackup !== null && existingBackup !== raw) {
      throw new DOMException('A different legacy backup already exists', 'InvalidStateError');
    }
    if (existingBackup === null) storage.setItem(LEGACY_BACKUP_KEY, raw);
    storage.removeItem(LEGACY_PROJECTS_KEY);
    storage.setItem(LEGACY_MIGRATION_MARKER_KEY, '1');

    return {
      backedUp: existingBackup === null,
      invalid: !isLegacyProjectArray(raw),
    };
  } catch (error) {
    throw toStorageError(error);
  }
}

async function openDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  if (factory === undefined) throw new SimpleChatSyncStorageError();

  return await new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let settled = false;
    const fail = (cause?: unknown) => {
      if (settled) return;
      settled = true;
      reject(toStorageError(cause));
    };

    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      fail(error);
      return;
    }

    request.onupgradeneeded = () => {
      try {
        if (!request.result.objectStoreNames.contains(ENVELOPE_STORE_NAME)) {
          request.result.createObjectStore(ENVELOPE_STORE_NAME, { keyPath: 'userId' });
        }
      } catch (error) {
        fail(error);
      }
    };
    request.onblocked = () => fail(new DOMException('IndexedDB open blocked', 'InvalidStateError'));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }

      try {
        const transaction = request.result.transaction(ENVELOPE_STORE_NAME, 'readonly');
        const keyPath = transaction.objectStore(ENVELOPE_STORE_NAME).keyPath;
        if (keyPath !== 'userId') {
          request.result.close();
          fail(new DOMException('Unexpected envelopes store key path', 'InvalidStateError'));
          return;
        }
      } catch (error) {
        request.result.close();
        fail(error);
        return;
      }

      settled = true;
      resolve(request.result);
    };
  });
}

async function runTransaction<T>(
  factory: IDBFactory | undefined,
  mode: IDBTransactionMode,
  createRequest: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase(factory);

  return await new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    let result: T;
    let settled = false;
    const fail = (cause?: unknown) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(toStorageError(cause));
    };

    try {
      transaction = database.transaction(ENVELOPE_STORE_NAME, mode);
      const request = createRequest(transaction.objectStore(ENVELOPE_STORE_NAME));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => fail(request.error ?? transaction.error);
    } catch (error) {
      fail(error);
      return;
    }

    transaction.onabort = () => fail(transaction.error);
    transaction.onerror = () => fail(transaction.error);
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(result);
    };
  });
}

function isLegacyProjectArray(raw: string): boolean {
  try {
    return Array.isArray(JSON.parse(raw));
  } catch {
    return false;
  }
}

function toStorageError(error?: unknown): SimpleChatSyncStorageError {
  return error instanceof SimpleChatSyncStorageError
    ? error
    : new SimpleChatSyncStorageError(error);
}
