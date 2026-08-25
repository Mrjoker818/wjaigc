export type SimpleChatMessageStatus = 'streaming' | 'completed' | 'failed';

export interface SimpleChatFailure {
  code?: string;
  message: string;
  retryable: boolean;
}

export interface SimpleChatRetrySystemMessage {
  role: 'system';
  content: string;
}

export interface SimpleChatRetryKnowledgeItem {
  id: string;
  type: string;
  title: string;
  content: string;
}

export interface SimpleChatRetryMemory {
  category: string;
  content: string;
}

export interface SimpleChatRetryContextV1 {
  version: 1;
  kind: 'chat' | 'deep-research';
  projectId: string;
  taskId: string;
  userMessageId: string;
  assistantMessageId: string;
  idempotencyKey: string;
  modelId: string;
  providerId: string;
  imageModelId?: string;
  imageProviderId?: string;
  webSearch: boolean;
  reasoningEffort?: string;
  responseSpeed?: string;
  canvasProjectId?: string;
  sourceVersionIds: string[];
  selectedEntityIds: string[];
  historyMessageIds: string[];
  systemMessages: SimpleChatRetrySystemMessage[];
  knowledgeItems: SimpleChatRetryKnowledgeItem[];
  memories: SimpleChatRetryMemory[];
  query?: string;
  deepAnalysis?: boolean;
  depth?: 'quick' | 'standard' | 'deep';
}

export type SimpleChatRetryContextInput = Omit<SimpleChatRetryContextV1, 'version'>;

interface RetryContextExpectation {
  assistantMessageId?: string;
  projectId?: string;
  taskId?: string;
}

interface RetryableMessageShape {
  id: string;
  role: string;
  content: string;
  createdAt: number;
  status?: SimpleChatMessageStatus;
  error?: SimpleChatFailure;
  retryContext?: unknown;
}

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_TEXT_LENGTH = 10_000;
const MAX_ARRAY_ITEMS = 64;
const MAX_CONTEXT_BYTES = 128 * 1024;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:._-]+$/;

export type SimpleChatIdempotencyKeyResolution =
  | { ok: true; key?: string }
  | { ok: false; status: 400 | 409; code: 'IDEMPOTENCY_KEY_INVALID' | 'IDEMPOTENCY_KEY_CONFLICT' };

function normalizeRequestIdempotencyKey(value: unknown, provided: boolean): string | null | undefined {
  if (!provided) return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > MAX_IDENTIFIER_LENGTH
    || !IDEMPOTENCY_KEY_PATTERN.test(normalized)
  ) return null;
  return normalized;
}

export function resolveSimpleChatRequestIdempotencyKey(
  headers: Pick<Headers, 'get'>,
  bodyValue: unknown,
): SimpleChatIdempotencyKeyResolution {
  const rawHeader = headers.get('idempotency-key');
  const bodyKey = normalizeRequestIdempotencyKey(bodyValue, bodyValue !== undefined);
  const headerKey = normalizeRequestIdempotencyKey(rawHeader, rawHeader !== null);
  if (bodyKey === null || headerKey === null) {
    return { ok: false, status: 400, code: 'IDEMPOTENCY_KEY_INVALID' };
  }
  if (bodyKey && headerKey && bodyKey !== headerKey) {
    return { ok: false, status: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' };
  }
  const key = bodyKey || headerKey;
  return key ? { ok: true, key } : { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readBoundedString(value: unknown, maximum = MAX_IDENTIFIER_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

function readOptionalBoundedString(value: unknown, maximum = MAX_IDENTIFIER_LENGTH): string | undefined | null {
  if (value === undefined) return undefined;
  return readBoundedString(value, maximum);
}

function readIdentifierArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) return null;
  const result: string[] = [];
  for (const item of value) {
    const identifier = readBoundedString(item);
    if (!identifier) return null;
    result.push(identifier);
  }
  return result;
}

function readSystemMessages(value: unknown): SimpleChatRetrySystemMessage[] | null {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) return null;
  const result: SimpleChatRetrySystemMessage[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.role !== 'system') return null;
    const content = readBoundedString(item.content, MAX_TEXT_LENGTH);
    if (!content) return null;
    result.push({ role: 'system', content });
  }
  return result;
}

function readKnowledgeItems(value: unknown): SimpleChatRetryKnowledgeItem[] | null {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) return null;
  const result: SimpleChatRetryKnowledgeItem[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = readBoundedString(item.id);
    const type = readBoundedString(item.type);
    const title = readBoundedString(item.title, 512);
    const content = readBoundedString(item.content, MAX_TEXT_LENGTH);
    if (!id || !type || !title || !content) return null;
    result.push({ id, type, title, content });
  }
  return result;
}

function readMemories(value: unknown): SimpleChatRetryMemory[] | null {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) return null;
  const result: SimpleChatRetryMemory[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const category = readBoundedString(item.category);
    const content = readBoundedString(item.content, MAX_TEXT_LENGTH);
    if (!category || !content) return null;
    result.push({ category, content });
  }
  return result;
}

function serializedSizeWithinLimit(value: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_CONTEXT_BYTES;
  } catch {
    return false;
  }
}

export function readSimpleChatRetryContext(
  value: unknown,
  expectation: RetryContextExpectation = {},
): SimpleChatRetryContextV1 | null {
  if (!isRecord(value) || value.version !== 1 || !serializedSizeWithinLimit(value)) return null;
  if (value.kind !== 'chat' && value.kind !== 'deep-research') return null;

  const projectId = readBoundedString(value.projectId);
  const taskId = readBoundedString(value.taskId);
  const userMessageId = readBoundedString(value.userMessageId);
  const assistantMessageId = readBoundedString(value.assistantMessageId);
  const idempotencyKey = readBoundedString(value.idempotencyKey);
  const modelId = readBoundedString(value.modelId);
  const providerId = readBoundedString(value.providerId);
  const imageModelId = readOptionalBoundedString(value.imageModelId);
  const imageProviderId = readOptionalBoundedString(value.imageProviderId);
  const reasoningEffort = readOptionalBoundedString(value.reasoningEffort);
  const responseSpeed = readOptionalBoundedString(value.responseSpeed);
  const canvasProjectId = readOptionalBoundedString(value.canvasProjectId);
  const sourceVersionIds = readIdentifierArray(value.sourceVersionIds);
  const selectedEntityIds = readIdentifierArray(value.selectedEntityIds);
  const historyMessageIds = readIdentifierArray(value.historyMessageIds);
  const systemMessages = readSystemMessages(value.systemMessages);
  const knowledgeItems = readKnowledgeItems(value.knowledgeItems);
  const memories = readMemories(value.memories);
  const query = readOptionalBoundedString(value.query, MAX_TEXT_LENGTH);

  if (
    !projectId || !taskId || !userMessageId || !assistantMessageId || !idempotencyKey
    || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey) || !modelId || !providerId
    || imageModelId === null || imageProviderId === null || reasoningEffort === null
    || responseSpeed === null || canvasProjectId === null || !sourceVersionIds
    || !selectedEntityIds || !historyMessageIds || !systemMessages || !knowledgeItems || !memories
    || query === null || (value.kind === 'deep-research' && !query)
    || typeof value.webSearch !== 'boolean'
  ) return null;

  if (expectation.assistantMessageId && expectation.assistantMessageId !== assistantMessageId) return null;
  if (expectation.projectId && expectation.projectId !== projectId) return null;
  if (expectation.taskId && expectation.taskId !== taskId) return null;

  const depth = value.depth === undefined
    ? undefined
    : value.depth === 'quick' || value.depth === 'standard' || value.depth === 'deep'
      ? value.depth
      : null;
  if (depth === null || (value.deepAnalysis !== undefined && typeof value.deepAnalysis !== 'boolean')) return null;

  return {
    version: 1,
    kind: value.kind,
    projectId,
    taskId,
    userMessageId,
    assistantMessageId,
    idempotencyKey,
    modelId,
    providerId,
    ...(imageModelId ? { imageModelId } : {}),
    ...(imageProviderId ? { imageProviderId } : {}),
    webSearch: value.webSearch,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(responseSpeed ? { responseSpeed } : {}),
    ...(canvasProjectId ? { canvasProjectId } : {}),
    sourceVersionIds,
    selectedEntityIds,
    historyMessageIds,
    systemMessages,
    knowledgeItems,
    memories,
    ...(query ? { query } : {}),
    ...(typeof value.deepAnalysis === 'boolean' ? { deepAnalysis: value.deepAnalysis } : {}),
    ...(depth ? { depth } : {}),
  };
}

export function createSimpleChatRetryContext(input: SimpleChatRetryContextInput): SimpleChatRetryContextV1 {
  const context = readSimpleChatRetryContext({ version: 1, ...input });
  if (!context) throw new TypeError('Invalid simple chat retry context');
  return context;
}

export function recoverInterruptedSimpleChatMessages<T extends RetryableMessageShape>(messages: readonly T[]): T[] {
  return messages.map(message => {
    if (message.role !== 'assistant' || message.status !== 'streaming') return message;
    const retryContext = readSimpleChatRetryContext(message.retryContext, {
      assistantMessageId: message.id,
    });
    if (!retryContext) {
      return {
        ...message,
        status: 'failed',
        retryContext: undefined,
        error: {
          message: '上次请求中断，缺少可恢复的请求信息。',
          retryable: false,
        },
      } as T;
    }
    return {
      ...message,
      status: 'failed',
      retryContext,
      error: {
        message: '上次请求中断，可重试。',
        retryable: true,
      },
    } as T;
  });
}
