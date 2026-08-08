function isPersistedChatMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string'
    && (candidate.role === 'user' || candidate.role === 'assistant')
    && typeof candidate.content === 'string'
    && typeof candidate.timestamp === 'number'
  );
}

function isPersistedChatSession(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string'
    && Array.isArray(candidate.messages)
    && candidate.messages.every(isPersistedChatMessage)
    && typeof candidate.model === 'string'
    && typeof candidate.systemPrompt === 'string'
    && typeof candidate.createdAt === 'number'
    && typeof candidate.updatedAt === 'number'
  );
}

export function normalizePersistedChatSessions<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPersistedChatSession) as T[];
}
