import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_SESSIONS_STORAGE_KEY, persistChatSessions } from '@/lib/chat-session-storage';

type Stored = Record<string, string>;

interface StorageShim {
  store: Stored;
  maxPayloadLength: number | null;
  failAll: boolean;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
}

function createStorageShim(): StorageShim {
  const shim: StorageShim = {
    store: {},
    maxPayloadLength: null,
    failAll: false,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(shim.store, key) ? shim.store[key] : null;
    },
    setItem(key: string, value: string) {
      if (shim.failAll) {
        throw new DOMException('mocked quota error', 'QuotaExceededError');
      }
      if (shim.maxPayloadLength !== null && value.length > shim.maxPayloadLength) {
        throw new DOMException('mocked quota error', 'QuotaExceededError');
      }
      shim.store[key] = value;
    },
    removeItem(key: string) {
      delete shim.store[key];
    },
    clear() {
      shim.store = {};
    },
    key(index: number) {
      return Object.keys(shim.store)[index] ?? null;
    },
    get length() {
      return Object.keys(shim.store).length;
    },
  };
  return shim;
}

function bigDataUrl(sizeKB: number): string {
  return `data:image/png;base64,${'A'.repeat(sizeKB * 1024)}`;
}

function makeSession(id: string, updatedAt: number, messageCount: number, withHeavyImage = false) {
  return {
    id,
    title: `session-${id}`,
    updatedAt,
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: `${id}-msg-${index}`,
      role: 'user',
      content: `message ${index}`,
      imageUrl: withHeavyImage ? bigDataUrl(200) : undefined,
    })),
  };
}

describe('chat session local storage persistence', () => {
  let shim: StorageShim;

  beforeEach(() => {
    shim = createStorageShim();
    vi.stubGlobal('localStorage', shim);
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sanitizes heavy data URLs, blob URLs and oversized text on save', () => {
    const sessions = [
      {
        id: 's1',
        updatedAt: 1,
        messages: [
          { id: 'm1', role: 'user', content: bigDataUrl(200) },
          { id: 'm2', role: 'user', content: 'blob:https://example.com/abc-123', imageUrl: 'blob:https://example.com/img' },
          { id: 'm3', role: 'user', content: 'x'.repeat(64 * 1024) },
          { id: 'm4', role: 'user', content: bigDataUrl(8) },
        ],
      },
    ];

    expect(persistChatSessions(sessions)).toBe(true);

    const parsed = JSON.parse(shim.store[CHAT_SESSIONS_STORAGE_KEY]) as Array<{
      messages: Array<{ id: string; content: string; imageUrl?: string }>;
    }>;
    const messages = parsed[0].messages;
    expect(messages[0].content).toContain('已从本地缓存移除');
    expect(messages[1].content).toContain('已失效');
    expect(messages[1].imageUrl).toContain('已失效');
    expect(messages[2].content.length).toBeLessThan(30 * 1024);
    expect(messages[3].content.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('degrades progressively when quota is exceeded and still persists', () => {
    const sessions = [
      makeSession('old', 1, 60, true),
      makeSession('mid', 2, 60, true),
      makeSession('new', 3, 60, true),
    ];
    shim.maxPayloadLength = 4000;

    expect(persistChatSessions(sessions)).toBe(true);

    const parsed = JSON.parse(shim.store[CHAT_SESSIONS_STORAGE_KEY]) as Array<{
      id: string;
      messages: unknown[];
    }>;
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.length).toBeLessThanOrEqual(3);
    const messageCounts = parsed.map((session) => session.messages.length);
    expect(Math.max(...messageCounts)).toBeLessThan(60);
  });

  it('returns false without throwing when every write fails', () => {
    shim.failAll = true;
    expect(() => persistChatSessions([makeSession('s', 1, 5)])).not.toThrow();
    expect(persistChatSessions([makeSession('s', 1, 5)])).toBe(false);
    expect(shim.store[CHAT_SESSIONS_STORAGE_KEY]).toBeUndefined();
  });

  it('is a no-op when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => persistChatSessions([makeSession('s', 1, 5)])).not.toThrow();
    expect(persistChatSessions([makeSession('s', 1, 5)])).toBe(false);
  });
});
