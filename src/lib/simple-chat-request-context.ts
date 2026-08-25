import {
  getSafeImageTypeFromDataUrl,
  getSafeMediaTypeFromResponse,
} from '@/lib/media-validation';

const MAX_IMAGE_URL_LENGTH = 4096;

export interface SimpleChatModelSelection {
  modelId: string;
  providerId: string;
}

export interface SimpleChatHistoryMessage {
  id: string;
  role: string;
  content: string;
  images?: readonly string[];
}

export interface SimpleChatHistoryRequestMessage {
  id: string;
  role: string;
  content: string;
  images?: string[];
}

export interface SimpleChatHistoryRequestContext {
  messages: SimpleChatHistoryRequestMessage[];
  images: string[];
  rejectedCount: number;
  messageIds: string[];
}

export function readSimpleChatModelSelection(
  task: { model?: string; providerId?: string } | null | undefined,
): SimpleChatModelSelection {
  return {
    modelId: task?.model?.trim() || '',
    providerId: task?.providerId?.trim() || '',
  };
}

export function applySimpleChatModelSelection<T extends { model: string; providerId: string }>(
  task: T,
  selection: SimpleChatModelSelection,
): Omit<T, 'model' | 'providerId'> & { model: string; providerId: string } {
  return {
    ...task,
    model: selection.modelId.trim(),
    providerId: selection.providerId.trim(),
  };
}

function decodeStrictDataImage(value: string): boolean {
  const safeType = getSafeImageTypeFromDataUrl(value);
  const match = value.match(/^data:image\/[\w+.-]+;base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!safeType || !match || match[1].length % 4 !== 0 || typeof globalThis.atob !== 'function') {
    return false;
  }

  try {
    const decoded = globalThis.atob(match[1]);
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    return bytes.length > 0
      && typeof globalThis.btoa === 'function'
      && globalThis.btoa(decoded) === match[1]
      && Boolean(getSafeMediaTypeFromResponse(safeType.mimeType, bytes, false));
  } catch {
    return false;
  }
}

function containsTraversal(value: string): boolean {
  let decoded = value;
  let stabilized = false;
  for (let attempt = 0; attempt < MAX_IMAGE_URL_LENGTH; attempt += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return true;
    }
    if (next === decoded) {
      stabilized = true;
      break;
    }
    decoded = next;
  }
  if (!stabilized) return true;
  return decoded.includes('..') || decoded.includes('\\');
}

function isAllowedSimpleChatImageInput(value: string): boolean {
  if (value.startsWith('data:')) return decodeStrictDataImage(value);
  if (!value || value.length > MAX_IMAGE_URL_LENGTH) return false;
  if (containsTraversal(value)) return false;

  if (value.startsWith('/api/serve-upload/') || value.startsWith('/uploads/')) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

export function filterSimpleChatImageInputs(
  values: readonly string[],
): { accepted: string[]; rejectedCount: number } {
  const accepted: string[] = [];
  let rejectedCount = 0;

  for (const rawValue of values) {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (isAllowedSimpleChatImageInput(value)) {
      accepted.push(value);
    } else {
      rejectedCount += 1;
    }
  }

  return { accepted, rejectedCount };
}

export function buildSimpleChatHistoryRequestContext(
  messages: readonly SimpleChatHistoryMessage[],
  maximumImageRounds = 3,
): SimpleChatHistoryRequestContext {
  const history = messages.filter(message => message.role !== 'search');
  const imageBearingMessages = history.filter(
    message => message.role === 'user' && (message.images?.length || 0) > 0,
  );
  const imageRoundLimit = Number.isFinite(maximumImageRounds)
    ? Math.max(0, Math.floor(maximumImageRounds))
    : maximumImageRounds === Infinity
      ? imageBearingMessages.length
      : 0;
  const recentIds = new Set(
    imageBearingMessages
      .slice(Math.max(0, imageBearingMessages.length - imageRoundLimit))
      .map(message => message.id),
  );
  let rejectedCount = 0;
  const images: string[] = [];
  const messageIds: string[] = [];
  const requestMessages = history.map(message => {
    if (message.role !== 'user' || !recentIds.has(message.id)) {
      return { id: message.id, role: message.role, content: message.content };
    }

    const filtered = filterSimpleChatImageInputs(message.images || []);
    rejectedCount += filtered.rejectedCount;
    if (!filtered.accepted.length) {
      return { id: message.id, role: message.role, content: message.content };
    }

    images.push(...filtered.accepted);
    messageIds.push(message.id);
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      images: filtered.accepted,
    };
  });

  return { messages: requestMessages, images, rejectedCount, messageIds };
}
