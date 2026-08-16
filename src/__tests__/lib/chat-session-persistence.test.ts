import { describe, expect, it } from 'vitest';
import { normalizePersistedChatSessions } from '@/lib/chat-session-persistence';

describe('normalizePersistedChatSessions', () => {
  it('rejects project records accidentally returned for the chat_sessions key', () => {
    expect(normalizePersistedChatSessions([{
      id: 'project-1',
      canvasImages: [],
      updatedAt: 2,
    }])).toEqual([]);
  });

  it('keeps structurally valid persisted chat sessions', () => {
    const session = {
      id: 'session-1',
      title: 'hello',
      messages: [{
        id: 'message-1',
        role: 'user',
        content: 'hello',
        timestamp: 1,
      }],
      model: 'provider::model',
      systemPrompt: '',
      createdAt: 1,
      updatedAt: 2,
    };

    expect(normalizePersistedChatSessions([session])).toEqual([session]);
  });

  it('preserves a real Agent run ID inside a recovered canvas-chat message', () => {
    const session = {
      id: 'session-agent',
      title: 'agent',
      messages: [{
        id: 'message-agent', role: 'assistant', content: 'working', timestamp: 1,
        agentRunId: 'durable-task-1',
      }],
      model: 'provider::model', systemPrompt: '', createdAt: 1, updatedAt: 2,
    };

    expect(normalizePersistedChatSessions<typeof session>([session])[0]
      ?.messages[0].agentRunId).toBe('durable-task-1');
  });
});
