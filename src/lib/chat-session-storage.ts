/**
 * chat-sessions 本地存储保护层。
 *
 * 背景：会话消息可能携带超大 base64 数据图、失效 blob 链接与超长文本，
 * 直接整体 JSON.stringify 写入 localStorage 时极易超出约 5MB 配额，
 * 触发 "Failed to execute 'setItem' on 'Storage'" 未捕获异常。
 *
 * 策略：
 * - 写入前统一瘦身：超大 data: URL、blob: URL、超长文本替换为占位符；
 * - 配额超限时逐级降级：先裁剪每条会话消息数，再裁剪保留会话数，最后仅保留会话元数据；
 * - 服务器同步（scheduleChatSync）仍接收完整数据，云端记录不受本地瘦身影响；
 * - 任何情况下不向调用方抛出异常。
 */

export const CHAT_SESSIONS_STORAGE_KEY = 'chat-sessions';

const MAX_PERSISTED_DATA_URL_LENGTH = 48 * 1024;
const MAX_PERSISTED_TEXT_LENGTH = 24 * 1024;
const MAX_WALK_DEPTH = 12;

const HEAVY_IMAGE_PLACEHOLDER = '[大体积图片已从本地缓存移除，云端记录不受影响]';
const BLOB_URL_PLACEHOLDER = '[临时图片链接已失效]';
const TRUNCATED_TEXT_SUFFIX = '\n[超长内容已截断存储]';

export interface ChatSessionLike {
  id: string;
  updatedAt?: number;
  messages?: unknown[];
  [key: string]: unknown;
}

function sanitizeString(value: string): string {
  if (value.startsWith('data:')) {
    return value.length <= MAX_PERSISTED_DATA_URL_LENGTH ? value : HEAVY_IMAGE_PLACEHOLDER;
  }
  if (value.startsWith('blob:')) return BLOB_URL_PLACEHOLDER;
  if (value.length > MAX_PERSISTED_TEXT_LENGTH) {
    return `${value.slice(0, MAX_PERSISTED_TEXT_LENGTH)}${TRUNCATED_TEXT_SUFFIX}`;
  }
  return value;
}

function sanitizeNode(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (!value || typeof value !== 'object') return value;
  if (depth >= MAX_WALK_DEPTH) return null;
  if (Array.isArray(value)) {
    return value.map(item => sanitizeNode(item, depth + 1));
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    out[key] = sanitizeNode(item, depth + 1);
  }
  return out;
}

export function sanitizeChatSessionsForStorage<T>(value: T): T {
  return sanitizeNode(value, 0) as T;
}

const trimMessagesTo = (count: number) => (sessions: ChatSessionLike[]): ChatSessionLike[] =>
  sessions.map(session => ({
    ...session,
    messages: Array.isArray(session.messages) ? session.messages.slice(-count) : session.messages,
  }));

const keepRecentSessions = (count: number) => (sessions: ChatSessionLike[]): ChatSessionLike[] =>
  [...sessions]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, count);

const SHRINK_STEPS: Array<(sessions: ChatSessionLike[]) => ChatSessionLike[]> = [
  trimMessagesTo(40),
  keepRecentSessions(30),
  trimMessagesTo(16),
  keepRecentSessions(15),
  trimMessagesTo(6),
  keepRecentSessions(8),
  trimMessagesTo(2),
  keepRecentSessions(3),
  sessions => sessions.map(session => ({ ...session, messages: [] })),
];

function asSessionList(sessions: readonly unknown[]): ChatSessionLike[] {
  return sessions.filter((session): session is ChatSessionLike =>
    Boolean(session) && typeof session === 'object' && typeof (session as ChatSessionLike).id === 'string',
  );
}

function tryWrite(sessions: readonly unknown[]): boolean {
  try {
    localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sanitizeChatSessionsForStorage(sessions)));
    return true;
  } catch {
    return false;
  }
}

/**
 * 写入聊天会话到 localStorage。
 * 优先完整写入；配额超限时按 SHRINK_STEPS 逐级降级重试；
 * 全部失败时清空该键并返回 false，保证调用方永不受配额异常影响。
 */
export function persistChatSessions(sessions: readonly unknown[]): boolean {
  if (typeof localStorage === 'undefined') return false;
  if (tryWrite(sessions)) return true;

  let degraded = asSessionList(sessions);
  for (const step of SHRINK_STEPS) {
    degraded = step(degraded);
    if (tryWrite(degraded)) return true;
  }

  try {
    localStorage.removeItem(CHAT_SESSIONS_STORAGE_KEY);
  } catch {
    // ignore
  }
  return false;
}
