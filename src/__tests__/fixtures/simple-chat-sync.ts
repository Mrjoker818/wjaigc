import type {
  ChatArtifact,
  ProjectKnowledgeItem,
  SimpleChatAgent,
  SimpleChatMessage,
  SimpleChatProject,
  SimpleChatTask,
} from '@/components/simple-chat/simple-chat-types';
import type {
  SimpleChatSyncEnvelopeV1,
  SimpleChatSyncOperation,
} from '@/lib/simple-chat-project-sync';

const fetchPostCounts = new WeakMap<typeof fetch, number>();

function createMessage(id: string, index: number): SimpleChatMessage {
  const artifact: ChatArtifact = {
    id: `artifact-${id}-${index}`,
    projectId: 'project-id',
    taskId: id,
    title: `artifact-${index}`,
    type: 'markdown',
    content: `content-${index}`,
    version: 1,
    createdAt: index,
    updatedAt: index,
  };

  return {
    id: `message-${id}-${index}`,
    role: 'user',
    content: `message-${index}`,
    artifacts: [artifact],
    createdAt: index,
  };
}

export function task(id: string, name = '对话'): SimpleChatTask {
  return {
    id,
    projectId: 'project-id',
    name,
    messages: [],
    model: 'chat-model',
    providerId: 'provider-id',
    createdAt: 1,
    updatedAt: 1,
  };
}

export function taskWithMessages(id: string, count: number): SimpleChatTask {
  return {
    ...task(id),
    messages: Array.from({ length: count }, (_, index) => createMessage(id, index + 1)),
  };
}

function defaultAgent(projectId: string): SimpleChatAgent {
  return {
    id: `agent-${projectId}`,
    name: 'Agent',
    description: 'fixture agent',
    systemPrompt: 'You are a fixture.',
    tools: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function defaultKnowledgeItem(projectId: string): ProjectKnowledgeItem {
  return {
    id: `knowledge-${projectId}`,
    projectId,
    type: 'note',
    name: 'fixture knowledge',
    textContent: 'fixture knowledge',
    tags: [],
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

export function project(id: string, tasks: SimpleChatTask[] = []): SimpleChatProject {
  const projectId = id;
  return {
    id: projectId,
    name: `项目-${projectId}`,
    createdAt: 1,
    updatedAt: 1,
    tasks: tasks.map(item => ({ ...item, projectId })),
    agents: [defaultAgent(projectId)],
    knowledgeItems: [defaultKnowledgeItem(projectId)],
    instructions: {
      projectBackground: '',
      userPreference: '',
      outputFormat: '',
      styleRules: '',
      forbiddenRules: '',
      language: 'zh-CN',
    },
  };
}

export function op(operationId: string, sequence: number): SimpleChatSyncOperation {
  return {
    operationId,
    sequence,
    kind: 'upsert',
    entityType: 'task',
    projectId: 'p1',
    taskId: 't1',
    entityId: 't1',
    baseValue: { id: 't1', name: 'base' },
    value: { id: 't1', name: 'current' },
  };
}

export function envelope(userId: string): SimpleChatSyncEnvelopeV1 {
  return {
    schemaVersion: 1,
    userId,
    baseRevision: 1,
    baseProjects: [],
    currentProjects: [],
    pendingOperations: [],
    updatedAt: 1,
  };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function sequenceFetch(...responses: Array<Response | Promise<Response>>): typeof fetch {
  let index = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
      fetchPostCounts.set(fetchImpl, (fetchPostCounts.get(fetchImpl) ?? 0) + 1);
    }

    const candidate = responses[index];
    index += 1;
    if (!candidate) {
      throw new Error(`No queued response for request ${String(input)}`);
    }
    return await candidate;
  };

  fetchPostCounts.set(fetchImpl, 0);
  return fetchImpl;
}

export function countPostRequests(fetchImpl: typeof fetch): number {
  return fetchPostCounts.get(fetchImpl) ?? 0;
}
