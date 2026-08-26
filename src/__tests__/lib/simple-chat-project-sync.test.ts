import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ChatArtifact,
  SimpleChatMessage,
  SimpleChatProject,
  SimpleChatTask,
} from '@/components/simple-chat/simple-chat-types';
import {
  acknowledgeSimpleChatOperations,
  compactSimpleChatOperations,
  diffSimpleChatProjects,
  replaySimpleChatOperations,
  SIMPLE_CHAT_SYNC_LIMITS,
  SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES,
  validateSimpleChatProjects,
} from '@/lib/simple-chat-project-sync';
import type {
  SimpleChatReplayOptions,
  SimpleChatSyncedProject,
  SimpleChatSyncEnvelopeV1,
  SimpleChatSyncOperation,
} from '@/lib/simple-chat-project-sync';
import {
  op,
  project,
  task,
  taskWithMessages,
} from '@/__tests__/fixtures/simple-chat-sync';

const MIB = 1024 * 1024;
const MAX_REQUEST_BYTES = SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES;

interface ConflictTagged {
  syncConflict?: {
    operationId: string;
    sourceEntityType: string;
    sourceEntityId: string;
    conflictedAt: number;
  };
}

function artifact(id: string, projectId = 'p1', taskId = 't1'): ChatArtifact {
  return {
    id,
    projectId,
    taskId,
    title: `Artifact ${id}`,
    type: 'markdown',
    content: 'artifact content',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function message(
  id: string,
  content = 'message content',
  artifacts: ChatArtifact[] = [],
): SimpleChatMessage {
  return {
    id,
    role: 'user',
    content,
    artifacts,
    createdAt: 1,
  };
}

function retryContext(
  userMessageId: string,
  assistantMessageId: string,
  historyMessageIds: string[],
): NonNullable<SimpleChatMessage['retryContext']> {
  return {
    version: 1,
    kind: 'chat',
    projectId: 'p1',
    taskId: 't1',
    userMessageId,
    assistantMessageId,
    idempotencyKey: 'retry-key',
    modelId: 'chat-model',
    providerId: 'provider-id',
    webSearch: false,
    sourceVersionIds: [],
    selectedEntityIds: [],
    historyMessageIds,
    systemMessages: [],
    knowledgeItems: [],
    memories: [],
  };
}

function graph(): SimpleChatProject {
  const chatTask = task('t1', '基线对话');
  chatTask.messages = [message('m1', '基线消息', [artifact('a1')])];
  return project('p1', [chatTask]);
}

function completeConflictGraph(): SimpleChatProject {
  const primaryTask = task('t-primary', '完整对话');
  primaryTask.model = 'configured-model';
  primaryTask.providerId = 'configured-provider';
  primaryTask.imageModel = 'configured-image-model';
  primaryTask.imageProviderId = 'configured-image-provider';
  primaryTask.reasoningEffort = 'high';
  primaryTask.responseSpeed = 'quality';
  primaryTask.activeAgentId = 'agent-p-complete';
  const editedMessage = message('m-edited', '编辑前', [artifact('a-edited', 'p-complete', 't-primary')]);
  editedMessage.attachments = [{
    id: 'attachment-edited',
    type: 'file',
    name: 'brief.txt',
    mimeType: 'text/plain',
    textContent: 'attachment body',
  }];
  const siblingMessage = message(
    'm-sibling',
    '未编辑兄弟消息',
    [artifact('a-sibling', 'p-complete', 't-primary')],
  );
  primaryTask.messages = [editedMessage, siblingMessage];

  const siblingTask = task('t-sibling', '未编辑兄弟任务');
  siblingTask.messages = [message('m-other', '兄弟任务消息')];
  const value = project('p-complete', [primaryTask, siblingTask]);
  value.description = '完整项目描述';
  value.instructions = {
    projectBackground: '完整背景',
    userPreference: '保留偏好',
    outputFormat: 'markdown',
    styleRules: '简洁',
    forbiddenRules: '不得丢失',
    language: 'zh-CN',
  };
  return value;
}

function cloneProject(value: SimpleChatProject): SimpleChatProject {
  return structuredClone(value);
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

function idFactory(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `generated-${index}`;
}

function validationFailure(field: string): object {
  return {
    success: false,
    code: 'CHAT_SYNC_LIMIT_EXCEEDED',
    field,
  };
}

function invalidValue(field = 'value'): object {
  return {
    success: false,
    code: 'CHAT_SYNC_INVALID_VALUE',
    field,
  };
}

function minimalMessages(count: number): SimpleChatMessage[] {
  return Array.from({ length: count }, (_, index) => message(`m-${index}`, ''));
}

function minimalTasks(count: number): SimpleChatTask[] {
  return Array.from({ length: count }, (_, index) => task(`t-${index}`));
}

function unreadCollection<T>(length: number): { values: T[]; reads: () => number } {
  let readCount = 0;
  const values = new Array<T>(length);
  Object.defineProperty(values, 0, {
    configurable: true,
    enumerable: true,
    get: () => {
      readCount += 1;
      return undefined as T;
    },
  });
  return { values, reads: () => readCount };
}

function nestedObject(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) {
    value = { next: value };
  }
  return value;
}

function payloadAtJsonBytes(targetBytes: number): SimpleChatProject[] {
  const value = project('p-bytes');
  const padding = Array.from({ length: 9 }, () => 'x'.repeat(2 * MIB));
  (value as unknown as Record<string, unknown>).padding = padding;
  const currentBytes = new TextEncoder().encode(JSON.stringify([value])).byteLength;
  const remaining = targetBytes - currentBytes - 3;
  if (remaining < 0 || remaining > 2 * MIB) {
    throw new Error(`Unable to construct ${targetBytes}-byte payload`);
  }
  padding.push('x'.repeat(remaining));
  return [value];
}

describe('simple chat project synchronization', () => {
  it('does not resurrect a remote-deleted project without a pending operation', () => {
    const base = [project('p1', [task('t1')])];
    const operations = diffSimpleChatProjects(base, base, 1);
    expect(replaySimpleChatOperations([], operations).projects).toEqual([]);
  });

  it('applies an ordinary local task edit without treating unchanged nested data as a conflict', () => {
    const beforeProject = graph();
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].name = '本地标题';

    const result = replaySimpleChatOperations(
      [cloneProject(beforeProject)],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
    );

    expect(result.conflicts).toEqual([]);
    expect(result.projects[0].tasks[0].name).toBe('本地标题');
    expect(result.projects[0].tasks[0].messages).toEqual(beforeProject.tasks[0].messages);
  });

  it('merges disjoint local and remote fields on the same entity', () => {
    const beforeProject = graph();
    const currentProject = cloneProject(beforeProject);
    const remoteProject = cloneProject(beforeProject);
    currentProject.tasks[0].name = '本地标题';
    remoteProject.tasks[0].model = 'remote-model';

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
    );

    expect(result.conflicts).toEqual([]);
    expect(result.projects[0].tasks[0]).toMatchObject({
      name: '本地标题',
      model: 'remote-model',
    });
  });

  it('ignores derived project and task timestamps when only a message changed', () => {
    const beforeProject = graph();
    const currentProject = cloneProject(beforeProject);
    currentProject.updatedAt = 20;
    currentProject.tasks[0].updatedAt = 20;
    currentProject.tasks[0].messages[0].content = '本地消息';

    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);
    const result = replaySimpleChatOperations([cloneProject(beforeProject)], operations);

    expect(operations.map(operation => operation.entityType)).toEqual(['message']);
    expect(result.conflicts).toEqual([]);
    expect(result.projects[0].tasks.map(item => item.id)).toEqual(['t1']);
    expect(result.projects[0].agents.map(item => item.id)).toEqual(['agent-p1']);
    expect(result.projects[0].knowledgeItems.map(item => item.id)).toEqual(['knowledge-p1']);
  });

  it('keeps updatedAt in complete operation values for real project and task edits', () => {
    const beforeProject = graph();
    const currentProject = cloneProject(beforeProject);
    currentProject.name = '本地项目';
    currentProject.updatedAt = 21;
    currentProject.tasks[0].name = '本地对话';
    currentProject.tasks[0].updatedAt = 22;

    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);
    const projectOperation = operations.find(operation => operation.entityType === 'project');
    const taskOperation = operations.find(operation => operation.entityType === 'task');

    expect(projectOperation?.value).toMatchObject({ updatedAt: 21 });
    expect(taskOperation?.value).toMatchObject({ updatedAt: 22 });
  });

  it('preserves the remote entity and creates a local conflict copy only for the same-field conflict', () => {
    const before = [project('p1', [task('t1', '基线')])];
    const current = [project('p1', [task('t1', '本地修改')])];
    const remote = [project('p1', [task('t1', '远端修改')])];
    remote[0].tasks[0].model = 'remote-model';
    const result = replaySimpleChatOperations(
      remote,
      diffSimpleChatProjects(before, current, 1),
      { createId: () => 'conflict-task', now: () => 100 },
    );

    expect(result.projects[0].tasks.map(item => item.name)).toEqual([
      '远端修改',
      '本地修改（冲突副本）',
    ]);
    expect(result.projects[0].tasks[1].model).toBe('remote-model');
  });

  it('replays a newly added project with its complete nested entity graph', () => {
    const added = project('p-new', [taskWithMessages('t-new', 2)]);
    const result = replaySimpleChatOperations(
      [],
      diffSimpleChatProjects([], [added], 1),
    );

    expect(result.conflicts).toEqual([]);
    expect(result.projects).toEqual([added]);
  });

  it('creates a fresh conflict parent chain when remote deleted the edited task project', () => {
    const before = [project('p1', [task('t1', '旧标题')])];
    const current = [project('p1', [task('t1', '本地标题')])];
    const result = replaySimpleChatOperations(
      [],
      diffSimpleChatProjects(before, current, 1),
      {
        createId: idFactory('conflict-project', 'conflict-task'),
        localProjects: current,
        now: () => 100,
      },
    );

    expect(result.conflicts).toHaveLength(1);
    expect(result.projects[0].id).toBe('conflict-project');
    expect(result.projects[0].id).not.toBe('p1');
    expect(result.projects[0].tasks[0].id).toBe('conflict-task');
    expect(result.projects[0].tasks[0].projectId).toBe('conflict-project');
  });

  it('does not reuse a remote-deleted task id when replaying an edited message', () => {
    const beforeProject = graph();
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地消息';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks = [];

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      {
        createId: idFactory('conflict-task', 'conflict-message', 'conflict-artifact'),
        localProjects: [currentProject],
        now: () => 200,
      },
    );

    const replayedTask = result.projects[0].tasks[0];
    expect(replayedTask.id).toBe('conflict-task');
    expect(replayedTask.id).not.toBe('t1');
    expect(replayedTask.messages[0].id).toBe('conflict-message');
    expect(replayedTask.messages[0].artifacts?.[0]).toMatchObject({
      id: 'conflict-artifact',
      projectId: 'p1',
      taskId: 'conflict-task',
    });
  });

  it('restores one complete local project graph when a message edit loses its remote project', () => {
    const beforeProject = completeConflictGraph();
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地叶子编辑';

    const result = replaySimpleChatOperations(
      [],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      {
        createId: idFactory(...Array.from({ length: 16 }, (_, index) => `project-copy-${index + 1}`)),
        localProjects: [currentProject],
      },
    );

    expect(result.conflicts).toHaveLength(1);
    expect(result.projects).toHaveLength(1);
    const copiedProject = result.projects[0];
    const copiedPrimaryTask = copiedProject.tasks.find(item => item.name.startsWith('完整对话'));
    const copiedSiblingTask = copiedProject.tasks.find(item => item.name.startsWith('未编辑兄弟任务'));
    if (!copiedPrimaryTask || !copiedSiblingTask) throw new Error('Expected the complete copied task graph');
    const copiedEditedMessage = copiedPrimaryTask.messages.find(item => item.content.includes('本地叶子编辑'));
    const copiedSiblingMessage = copiedPrimaryTask.messages.find(item => item.content.includes('未编辑兄弟消息'));

    expect(copiedProject).toMatchObject({
      description: '完整项目描述',
      instructions: beforeProject.instructions,
    });
    expect(copiedProject.id).not.toBe(beforeProject.id);
    expect(copiedProject.tasks).toHaveLength(2);
    expect(copiedProject.agents).toHaveLength(1);
    expect(copiedProject.knowledgeItems).toHaveLength(1);
    expect(copiedPrimaryTask).toMatchObject({
      model: 'configured-model',
      providerId: 'configured-provider',
      imageModel: 'configured-image-model',
      imageProviderId: 'configured-image-provider',
      reasoningEffort: 'high',
      responseSpeed: 'quality',
      activeAgentId: copiedProject.agents[0].id,
    });
    expect(copiedPrimaryTask.messages).toHaveLength(2);
    expect(copiedEditedMessage?.attachments?.[0]).toMatchObject({
      id: 'attachment-edited',
      textContent: 'attachment body',
    });
    expect(copiedEditedMessage?.artifacts).toHaveLength(1);
    expect(copiedSiblingMessage?.artifacts).toHaveLength(1);
    expect(copiedSiblingTask.messages).toHaveLength(1);
    expect(new Set(copiedProject.tasks.map(item => item.id)).size).toBe(2);
    expect(validateSimpleChatProjects(result.projects)).toEqual({ success: true });
  });

  it('restores one complete local task graph when a message edit loses its remote task', () => {
    const beforeProject = completeConflictGraph();
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地叶子编辑';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks = [remoteProject.tasks[1]];

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      {
        createId: idFactory(...Array.from({ length: 8 }, (_, index) => `task-copy-${index + 1}`)),
        localProjects: [currentProject],
      },
    );

    expect(result.conflicts).toHaveLength(1);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].tasks).toHaveLength(2);
    const copiedTask = result.projects[0].tasks.find(item => item.name.startsWith('完整对话'));
    if (!copiedTask) throw new Error('Expected a complete copied task');
    expect(copiedTask.id).not.toBe('t-primary');
    expect(copiedTask).toMatchObject({
      model: 'configured-model',
      providerId: 'configured-provider',
      imageModel: 'configured-image-model',
      imageProviderId: 'configured-image-provider',
      reasoningEffort: 'high',
      responseSpeed: 'quality',
    });
    expect(copiedTask.messages).toHaveLength(2);
    expect(copiedTask.messages.find(item => item.content.includes('本地叶子编辑'))?.attachments)
      .toHaveLength(1);
    expect(copiedTask.messages.find(item => item.content.includes('未编辑兄弟消息'))?.artifacts)
      .toHaveLength(1);
    expect(validateSimpleChatProjects(result.projects)).toEqual({ success: true });
  });

  it('restores one complete local message graph when an artifact edit loses its remote message', () => {
    const beforeProject = completeConflictGraph();
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].artifacts![0].title = '本地 Artifact 编辑';
    currentProject.tasks[0].messages[0].artifacts!.push(
      artifact('a-unedited', 'p-complete', 't-primary'),
    );
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages = [remoteProject.tasks[0].messages[1]];

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      {
        createId: idFactory('message-copy', 'artifact-copy-1', 'artifact-copy-2'),
        localProjects: [currentProject],
      },
    );

    expect(result.conflicts).toHaveLength(1);
    const replayedMessages = result.projects[0].tasks[0].messages;
    expect(replayedMessages).toHaveLength(2);
    const copiedMessage = replayedMessages.find(item => item.id === 'message-copy');
    expect(copiedMessage).toMatchObject({
      content: expect.stringContaining('编辑前'),
      attachments: [{
        id: 'attachment-edited',
        type: 'file',
        name: 'brief.txt',
        mimeType: 'text/plain',
        textContent: 'attachment body',
      }],
    });
    expect(copiedMessage?.artifacts).toHaveLength(2);
    expect(copiedMessage?.artifacts?.map(item => item.title)).toEqual(expect.arrayContaining([
      expect.stringContaining('本地 Artifact 编辑'),
      expect.stringContaining('Artifact a-unedited'),
    ]));
    expect(new Set(copiedMessage?.artifacts?.map(item => item.id))).toHaveProperty('size', 2);
    expect(copiedMessage?.artifacts?.every(item => (
      item.projectId === 'p-complete' && item.taskId === 't-primary'
    ))).toBe(true);
    expect(validateSimpleChatProjects(result.projects)).toEqual({ success: true });
  });

  it('remaps every internal reference in a copied conflict project graph', () => {
    const local = graph();
    local.name = '本地项目';
    local.tasks[0].activeAgentId = local.agents[0].id;
    const userMessage = local.tasks[0].messages[0];
    const assistantMessage = message('m2', '本地回答');
    assistantMessage.role = 'assistant';
    assistantMessage.parentMessageId = userMessage.id;
    assistantMessage.retryContext = {
      version: 1,
      kind: 'chat',
      projectId: local.id,
      taskId: local.tasks[0].id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      idempotencyKey: 'retry-key',
      modelId: 'chat-model',
      providerId: 'provider-id',
      webSearch: false,
      sourceVersionIds: [],
      selectedEntityIds: [],
      historyMessageIds: [userMessage.id, assistantMessage.id],
      systemMessages: [],
      knowledgeItems: [],
      memories: [],
    };
    local.tasks[0].messages.push(assistantMessage);
    const remote = cloneProject(local);
    remote.name = '远端项目';

    const result = replaySimpleChatOperations(
      [remote],
      diffSimpleChatProjects([], [local], 1),
      { createId: idFactory(...Array.from({ length: 16 }, (_, index) => `copy-${index + 1}`)) },
    );
    const copiedProject = result.projects.find(item => item.id !== local.id);
    if (!copiedProject) throw new Error('Expected a conflict project copy');
    const copiedTask = copiedProject.tasks[0];
    const copiedUser = copiedTask.messages.find(item => item.role === 'user');
    const copiedAssistant = copiedTask.messages.find(item => item.role === 'assistant');
    if (!copiedUser || !copiedAssistant?.retryContext) {
      throw new Error('Expected copied messages with retry context');
    }

    expect(copiedTask.activeAgentId).toBe(copiedProject.agents[0].id);
    expect(copiedAssistant.parentMessageId).toBe(copiedUser.id);
    expect(copiedAssistant.retryContext).toMatchObject({
      projectId: copiedProject.id,
      taskId: copiedTask.id,
      userMessageId: copiedUser.id,
      assistantMessageId: copiedAssistant.id,
      historyMessageIds: [copiedUser.id, copiedAssistant.id],
    });
  });

  it('remaps available leaf-conflict references and clears dangling ones while retaining their source ids', () => {
    const beforeProject = graph();
    const sourceTask = beforeProject.tasks[0];
    sourceTask.activeAgentId = 'missing-agent';
    const userMessage = sourceTask.messages[0];
    userMessage.parentMessageId = 'missing-parent';
    userMessage.retryContext = retryContext('missing-user', 'missing-assistant', ['missing-history']);
    const assistantMessage = message('m2', '本地回答');
    assistantMessage.role = 'assistant';
    assistantMessage.parentMessageId = userMessage.id;
    assistantMessage.retryContext = retryContext(
      userMessage.id,
      assistantMessage.id,
      [userMessage.id, assistantMessage.id],
    );
    sourceTask.messages.push(assistantMessage);

    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].name = '本地标题';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].name = '远端标题';
    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);

    const result = replaySimpleChatOperations(
      [remoteProject],
      operations,
      {
        createId: idFactory('copy-task', 'copy-user', 'copy-artifact', 'copy-assistant'),
        now: () => 250,
      },
    );
    const copiedTask = result.projects[0].tasks.find(item => item.id === 'copy-task');
    if (!copiedTask) throw new Error('Expected a copied conflict task');
    const copiedUser = copiedTask.messages.find(item => item.id === 'copy-user');
    const copiedAssistant = copiedTask.messages.find(item => item.id === 'copy-assistant');
    if (!copiedUser || !copiedAssistant?.retryContext) {
      throw new Error('Expected copied leaf-conflict messages');
    }

    expect(copiedTask).not.toHaveProperty('activeAgentId');
    expect(copiedTask.syncConflict?.sourceReferences?.activeAgentId).toBe('missing-agent');
    expect(copiedUser).not.toHaveProperty('parentMessageId');
    expect(copiedUser).not.toHaveProperty('retryContext');
    expect(copiedUser.syncConflict?.sourceReferences).toMatchObject({
      parentMessageId: 'missing-parent',
      retryContext: {
        userMessageId: 'missing-user',
        assistantMessageId: 'missing-assistant',
        historyMessageIds: ['missing-history'],
      },
    });
    expect(copiedAssistant.parentMessageId).toBe(copiedUser.id);
    expect(copiedAssistant.retryContext).toMatchObject({
      projectId: 'p1',
      taskId: copiedTask.id,
      userMessageId: copiedUser.id,
      assistantMessageId: copiedAssistant.id,
      historyMessageIds: [copiedUser.id, copiedAssistant.id],
    });
    expect(validateSimpleChatProjects(result.projects)).toEqual({ success: true });
  });

  it('closes a task conflict reference when its agent conflict is copied later', () => {
    const beforeProject = project('p1', [task('t1', '基线对话')]);
    beforeProject.tasks[0].activeAgentId = beforeProject.agents[0].id;
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].name = '本地对话';
    currentProject.agents[0].name = '本地 Agent';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].name = '远端对话';
    remoteProject.agents[0].name = '远端 Agent';
    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);

    expect(operations.map(operation => operation.entityType)).toEqual(['task', 'agent']);
    const result = replaySimpleChatOperations([remoteProject], operations, {
      createId: idFactory('copy-task', 'copy-agent'),
      now: () => 260,
    });

    const copiedTask = result.projects[0].tasks.find(item => item.id === 'copy-task');
    const copiedAgent = result.projects[0].agents.find(item => item.id === 'copy-agent');
    expect(copiedTask?.activeAgentId).toBe(copiedAgent?.id);
  });

  it('closes parent and retry references when the referenced message conflict is copied later', () => {
    const beforeProject = project('p1', [task('t1')]);
    const parentMessage = message('m-parent', '基线提问');
    const childMessage = message('m-child', '基线回答');
    childMessage.role = 'assistant';
    childMessage.parentMessageId = parentMessage.id;
    childMessage.retryContext = retryContext(parentMessage.id, childMessage.id, [
      parentMessage.id,
      childMessage.id,
    ]);
    beforeProject.tasks[0].messages = [parentMessage, childMessage];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地提问';
    currentProject.tasks[0].messages[1].content = '本地回答';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages[0].content = '远端提问';
    remoteProject.tasks[0].messages[1].content = '远端回答';
    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);
    const childFirst = [
      operations.find(operation => operation.entityId === 'm-child')!,
      operations.find(operation => operation.entityId === 'm-parent')!,
    ];

    const result = replaySimpleChatOperations([remoteProject], childFirst, {
      createId: idFactory('copy-child', 'copy-parent'),
      now: () => 270,
    });
    const messages = result.projects[0].tasks[0].messages;
    const copiedChild = messages.find(item => item.id === 'copy-child');
    const copiedParent = messages.find(item => item.id === 'copy-parent');

    expect(copiedChild?.parentMessageId).toBe(copiedParent?.id);
    expect(copiedChild?.retryContext).toMatchObject({
      userMessageId: copiedParent?.id,
      assistantMessageId: copiedChild?.id,
      historyMessageIds: [copiedParent?.id, copiedChild?.id],
    });
  });

  it('closes a message-restored task reference when its agent is added later', () => {
    const beforeProject = project('p1', [task('t1')]);
    const addedAgent = {
      ...beforeProject.agents[0],
      id: 'agent-added',
      name: '新增 Agent',
    };
    beforeProject.tasks[0].activeAgentId = addedAgent.id;
    beforeProject.tasks[0].messages = [message('m-child', '基线消息')];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地消息';
    currentProject.agents.push(addedAgent);
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks = [];
    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);

    expect(operations.map(operation => operation.entityType)).toEqual(['message', 'agent']);
    const result = replaySimpleChatOperations([remoteProject], operations, {
      createId: idFactory('copy-task', 'copy-message'),
      localProjects: [currentProject],
    });
    const copiedTask = result.projects[0].tasks.find(item => item.id === 'copy-task');

    expect(copiedTask?.activeAgentId).toBe(addedAgent.id);
    expect(copiedTask?.syncConflict?.sourceReferences).toBeUndefined();
  });

  it('closes a message-restored task reference when its agent conflict is copied later', () => {
    const beforeProject = project('p1', [task('t1')]);
    beforeProject.tasks[0].activeAgentId = beforeProject.agents[0].id;
    beforeProject.tasks[0].messages = [message('m-child', '基线消息')];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地消息';
    currentProject.agents[0].name = '本地 Agent';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks = [];
    remoteProject.agents[0].name = '远端 Agent';
    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);

    expect(operations.map(operation => operation.entityType)).toEqual(['message', 'agent']);
    const result = replaySimpleChatOperations([remoteProject], operations, {
      createId: idFactory('copy-task', 'copy-message', 'copy-agent'),
      localProjects: [currentProject],
    });
    const copiedTask = result.projects[0].tasks.find(item => item.id === 'copy-task');

    expect(copiedTask?.activeAgentId).toBe('copy-agent');
    expect(copiedTask?.syncConflict?.sourceReferences).toBeUndefined();
  });

  it('closes every artifact-restored message reference when its parent conflict is copied later', () => {
    const beforeProject = project('p1', [task('t1')]);
    const childMessage = message('m-child', '基线回答', [artifact('a-child')]);
    childMessage.role = 'assistant';
    childMessage.parentMessageId = 'm-parent';
    childMessage.retryContext = retryContext('m-parent', childMessage.id, [
      'm-parent',
      childMessage.id,
    ]);
    beforeProject.tasks[0].messages = [childMessage, message('m-parent', '基线提问')];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].artifacts![0].title = '本地 Artifact';
    currentProject.tasks[0].messages[1].content = '本地提问';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages = [remoteProject.tasks[0].messages[1]];
    remoteProject.tasks[0].messages[0].content = '远端提问';
    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);

    expect(operations.map(operation => operation.entityType)).toEqual(['artifact', 'message']);
    const result = replaySimpleChatOperations([remoteProject], operations, {
      createId: idFactory('copy-child', 'copy-artifact', 'copy-parent'),
      localProjects: [currentProject],
    });
    const copiedChild = result.projects[0].tasks[0].messages.find(item => item.id === 'copy-child');

    expect(copiedChild?.parentMessageId).toBe('copy-parent');
    expect(copiedChild?.retryContext).toMatchObject({
      userMessageId: 'copy-parent',
      assistantMessageId: copiedChild?.id,
      historyMessageIds: ['copy-parent', copiedChild?.id],
    });
    expect(copiedChild?.syncConflict?.sourceReferences).toBeUndefined();
  });

  it('replays an ordinary field conflict idempotently without consuming another id', () => {
    const before = [project('p1', [task('t1', '基线')])];
    const current = [project('p1', [task('t1', '本地修改')])];
    const remote = [project('p1', [task('t1', '远端修改')])];
    const operations = diffSimpleChatProjects(before, current, 1);
    let createdIds = 0;
    const options = {
      createId: () => `ordinary-copy-${++createdIds}`,
      now: () => 300,
    };

    const first = replaySimpleChatOperations(remote, operations, options);
    const idsAfterFirstReplay = createdIds;
    const second = replaySimpleChatOperations(first.projects, operations, options);

    expect(second.projects).toEqual(first.projects);
    expect(second.conflicts).toEqual(first.conflicts);
    expect(createdIds).toBe(idsAfterFirstReplay);
  });

  it('replays a leaf-restored deleted project idempotently within its complete source scope', () => {
    const beforeProject = project('p1', [task('t1')]);
    beforeProject.tasks[0].messages = [message('m1', '基线消息')];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地消息';
    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);
    let createdIds = 0;
    const options = {
      createId: () => `project-copy-${++createdIds}`,
      localProjects: [currentProject],
      now: () => 310,
    };

    const first = replaySimpleChatOperations([], operations, options);
    const idsAfterFirstReplay = createdIds;
    const second = replaySimpleChatOperations(first.projects, operations, options);

    expect(first.projects[0].syncConflict).toMatchObject({
      operationId: operations[0].operationId,
      sourceEntityType: 'project',
      sourceEntityId: 'p1',
      sourceProjectId: 'p1',
      sourceTaskId: 't1',
      sourceMessageId: 'm1',
    });
    expect(second.projects).toEqual(first.projects);
    expect(second.conflicts).toEqual(first.conflicts);
    expect(createdIds).toBe(idsAfterFirstReplay);
  });

  it('replays a leaf-restored deleted task idempotently within its complete source scope', () => {
    const beforeProject = project('p1', [task('t1')]);
    beforeProject.tasks[0].messages = [message('m1', '基线消息')];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地消息';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks = [];
    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);
    let createdIds = 0;
    const options = {
      createId: () => `task-copy-${++createdIds}`,
      localProjects: [currentProject],
      now: () => 320,
    };

    const first = replaySimpleChatOperations([remoteProject], operations, options);
    const idsAfterFirstReplay = createdIds;
    const second = replaySimpleChatOperations(first.projects, operations, options);

    expect(first.projects[0].tasks[0].syncConflict).toMatchObject({
      operationId: operations[0].operationId,
      sourceEntityType: 'task',
      sourceEntityId: 't1',
      sourceProjectId: 'p1',
      sourceTaskId: 't1',
    });
    expect(first.projects[0].tasks[0].syncConflict).not.toHaveProperty('sourceMessageId');
    expect(second.projects).toEqual(first.projects);
    expect(second.conflicts).toEqual(first.conflicts);
    expect(createdIds).toBe(idsAfterFirstReplay);
  });

  it('replays a leaf-restored deleted message idempotently within its complete source scope', () => {
    const beforeProject = project('p1', [task('t1')]);
    beforeProject.tasks[0].messages = [message('m1', '基线消息', [artifact('a1')])];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].artifacts![0].title = '本地 Artifact';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages = [];
    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);
    let createdIds = 0;
    const options = {
      createId: () => `message-copy-${++createdIds}`,
      localProjects: [currentProject],
      now: () => 330,
    };

    const first = replaySimpleChatOperations([remoteProject], operations, options);
    const idsAfterFirstReplay = createdIds;
    const second = replaySimpleChatOperations(first.projects, operations, options);

    expect(first.projects[0].tasks[0].messages[0].syncConflict).toMatchObject({
      operationId: operations[0].operationId,
      sourceEntityType: 'message',
      sourceEntityId: 'm1',
      sourceProjectId: 'p1',
      sourceTaskId: 't1',
      sourceMessageId: 'm1',
    });
    expect(second.projects).toEqual(first.projects);
    expect(second.conflicts).toEqual(first.conflicts);
    expect(createdIds).toBe(idsAfterFirstReplay);
  });

  it('keeps deduplicated ancestor context out of every serialized operation', () => {
    const beforeProject = project('p1', [taskWithMessages('t1', 3)]);
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages.forEach((chatMessage, index) => {
      chatMessage.content = `本地消息 ${index}`;
    });

    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);

    expect(operations).toHaveLength(3);
    expect(operations.every(operation => !('localProject' in operation))).toBe(true);
  });

  it('serializes many leaf edits as one project context plus linear operations', () => {
    const batch = (projectDescription: string): {
      currentProjects: SimpleChatProject[];
      pendingOperations: SimpleChatSyncOperation[];
    } => {
      const beforeProject = project('p1', [taskWithMessages('t1', 12)]);
      beforeProject.description = projectDescription;
      const currentProject = cloneProject(beforeProject);
      currentProject.tasks[0].messages.forEach((chatMessage, index) => {
        chatMessage.content = `本地叶子 ${index}`;
      });
      let operationIndex = 0;
      const pendingOperations = diffSimpleChatProjects(
        [beforeProject],
        [currentProject],
        1,
        {
          createOperationId: () => (
            `30000000-0000-4000-8000-${String(++operationIndex).padStart(12, '0')}`
          ),
        },
      );
      return { currentProjects: [currentProject], pendingOperations };
    };
    const smallBatch = batch('');
    const largeBatch = batch('x'.repeat(32 * 1024));

    expect(largeBatch.pendingOperations).toHaveLength(12);
    expect(
      serializedBytes(largeBatch.pendingOperations)
      - serializedBytes(smallBatch.pendingOperations),
    ).toBe(0);
    expect(serializedBytes(largeBatch) - serializedBytes(smallBatch)).toBe(
      serializedBytes(largeBatch.currentProjects) - serializedBytes(smallBatch.currentProjects),
    );
  });

  it('remaps a locally selected agent on an ordinary merged task when that agent is copied later', () => {
    const beforeProject = project('p1', [task('t1', '基线对话')]);
    beforeProject.agents.push({
      ...beforeProject.agents[0],
      id: 'agent-target',
      name: '目标 Agent',
    });
    beforeProject.tasks[0].activeAgentId = beforeProject.agents[0].id;
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].activeAgentId = 'agent-target';
    currentProject.agents[1].name = '本地目标 Agent';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].model = 'remote-model';
    remoteProject.agents[1].name = '远端目标 Agent';

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-agent') },
    );

    expect(result.projects[0].tasks[0].activeAgentId).toBe('copy-agent');
    expect(result.projects[0].tasks[0]).not.toHaveProperty('syncConflict');
  });

  it('keeps a remotely selected agent on an ordinary merged task when a local agent copy is created later', () => {
    const beforeProject = project('p1', [task('t1', '基线对话')]);
    beforeProject.agents.push({
      ...beforeProject.agents[0],
      id: 'agent-remote',
      name: '远端目标 Agent',
    });
    beforeProject.tasks[0].activeAgentId = beforeProject.agents[0].id;
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].name = '本地对话';
    currentProject.agents[0].name = '本地 Agent';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].activeAgentId = 'agent-remote';
    remoteProject.agents[0].name = '远端 Agent';

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-agent') },
    );

    expect(result.projects[0].tasks[0].activeAgentId).toBe('agent-remote');
  });

  it('remaps locally selected parent and retry references on an ordinary merged message', () => {
    const beforeProject = project('p1', [task('t1')]);
    const childMessage = message('m-child', '基线回答');
    childMessage.role = 'assistant';
    childMessage.parentMessageId = 'm-parent-a';
    childMessage.retryContext = retryContext('m-parent-a', childMessage.id, [
      'm-parent-a',
      childMessage.id,
    ]);
    beforeProject.tasks[0].messages = [
      childMessage,
      message('m-parent-a', '原父消息'),
      message('m-parent-b', '目标父消息'),
    ];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].parentMessageId = 'm-parent-b';
    currentProject.tasks[0].messages[0].retryContext = retryContext(
      'm-parent-b',
      childMessage.id,
      ['m-parent-b', childMessage.id],
    );
    currentProject.tasks[0].messages[2].content = '本地目标父消息';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages[0].content = '远端回答';
    remoteProject.tasks[0].messages[2].content = '远端目标父消息';

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-parent') },
    );
    const mergedChild = result.projects[0].tasks[0].messages.find(item => item.id === 'm-child');

    expect(mergedChild?.parentMessageId).toBe('copy-parent');
    expect(mergedChild?.retryContext).toMatchObject({
      userMessageId: 'copy-parent',
      assistantMessageId: 'm-child',
      historyMessageIds: ['copy-parent', 'm-child'],
    });
    expect(mergedChild).not.toHaveProperty('syncConflict');
  });

  it('keeps remotely selected parent and retry references on an ordinary merged message', () => {
    const beforeProject = project('p1', [task('t1')]);
    const childMessage = message('m-child', '基线回答');
    childMessage.role = 'assistant';
    childMessage.parentMessageId = 'm-parent-a';
    childMessage.retryContext = retryContext('m-parent-a', childMessage.id, [
      'm-parent-a',
      childMessage.id,
    ]);
    beforeProject.tasks[0].messages = [
      childMessage,
      message('m-parent-a', '本地父消息'),
      message('m-parent-b', '远端父消息'),
    ];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地回答';
    currentProject.tasks[0].messages[1].content = '本地父消息修改';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages[0].parentMessageId = 'm-parent-b';
    remoteProject.tasks[0].messages[0].retryContext = retryContext(
      'm-parent-b',
      childMessage.id,
      ['m-parent-b', childMessage.id],
    );
    remoteProject.tasks[0].messages[1].content = '远端父消息修改';

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-parent') },
    );
    const mergedChild = result.projects[0].tasks[0].messages.find(item => item.id === 'm-child');

    expect(mergedChild?.parentMessageId).toBe('m-parent-b');
    expect(mergedChild?.retryContext).toMatchObject({
      userMessageId: 'm-parent-b',
      assistantMessageId: 'm-child',
      historyMessageIds: ['m-parent-b', 'm-child'],
    });
  });

  it('keeps a remote agent reference on a task conflict copy when that agent is also copied', () => {
    const beforeProject = project('p1', [task('t1', '基线对话')]);
    beforeProject.agents.push({
      ...beforeProject.agents[0],
      id: 'agent-remote',
      name: '远端目标 Agent',
    });
    beforeProject.tasks[0].activeAgentId = beforeProject.agents[0].id;
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].name = '本地对话';
    currentProject.agents[1].name = '本地目标 Agent';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].name = '远端对话';
    remoteProject.tasks[0].activeAgentId = 'agent-remote';
    remoteProject.agents[1].name = '远端目标 Agent 修改';

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-task', 'copy-agent') },
    );
    const copiedTask = result.projects[0].tasks.find(item => item.id === 'copy-task');

    expect(copiedTask?.activeAgentId).toBe('agent-remote');
  });

  it('keeps remote parent and retry fields on a message conflict copy when that parent is copied', () => {
    const beforeProject = project('p1', [task('t1')]);
    const childMessage = message('m-child', '基线回答');
    childMessage.role = 'assistant';
    childMessage.parentMessageId = 'm-parent-a';
    childMessage.retryContext = retryContext('m-parent-a', childMessage.id, [
      'm-parent-a',
      childMessage.id,
    ]);
    beforeProject.tasks[0].messages = [
      childMessage,
      message('m-parent-a', '原父消息'),
      message('m-parent-b', '目标父消息'),
    ];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地回答';
    currentProject.tasks[0].messages[2].content = '本地目标父消息';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages[0].content = '远端回答';
    remoteProject.tasks[0].messages[0].parentMessageId = 'm-parent-b';
    remoteProject.tasks[0].messages[0].retryContext = retryContext(
      'm-parent-b',
      childMessage.id,
      ['m-parent-b', childMessage.id],
    );
    remoteProject.tasks[0].messages[2].content = '远端目标父消息';

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-child', 'copy-parent') },
    );
    const copiedChild = result.projects[0].tasks[0].messages.find(item => item.id === 'copy-child');

    expect(copiedChild?.parentMessageId).toBe('m-parent-b');
    expect(copiedChild?.retryContext).toMatchObject({
      userMessageId: 'm-parent-b',
      assistantMessageId: copiedChild?.id,
      historyMessageIds: ['m-parent-b', copiedChild?.id],
    });
  });

  it('does not overwrite a merged remote task reference while closing later conflicts', () => {
    const beforeProject = project('p1', [task('t1', '基线对话')]);
    beforeProject.agents.push({
      ...beforeProject.agents[0],
      id: 'agent-remote',
      name: '远端目标 Agent',
    });
    beforeProject.tasks[0].activeAgentId = beforeProject.agents[0].id;
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].name = '本地对话';
    currentProject.agents[0].name = '本地 Agent';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].name = '远端对话';
    remoteProject.tasks[0].activeAgentId = 'agent-remote';
    remoteProject.agents[0].name = '远端 Agent';

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-task', 'copy-agent') },
    );

    expect(result.projects[0].tasks.find(item => item.id === 'copy-task')?.activeAgentId)
      .toBe('agent-remote');
  });

  it('does not overwrite merged remote message references while closing a later parent conflict', () => {
    const beforeProject = project('p1', [task('t1')]);
    const localParent = message('m-local-parent', '基线本地父消息');
    const remoteParent = message('m-remote-parent', '远端父消息');
    const childMessage = message('m-child', '基线回答');
    childMessage.role = 'assistant';
    childMessage.parentMessageId = localParent.id;
    childMessage.retryContext = retryContext(localParent.id, childMessage.id, [
      localParent.id,
      childMessage.id,
    ]);
    beforeProject.tasks[0].messages = [localParent, remoteParent, childMessage];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地父消息';
    currentProject.tasks[0].messages[2].content = '本地回答';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages[0].content = '远端本地父消息';
    remoteProject.tasks[0].messages[2].content = '远端回答';
    remoteProject.tasks[0].messages[2].parentMessageId = remoteParent.id;
    remoteProject.tasks[0].messages[2].retryContext = retryContext(
      remoteParent.id,
      childMessage.id,
      [remoteParent.id, childMessage.id],
    );
    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);
    const childFirst = [
      operations.find(operation => operation.entityId === 'm-child')!,
      operations.find(operation => operation.entityId === 'm-local-parent')!,
    ];

    const result = replaySimpleChatOperations([remoteProject], childFirst, {
      createId: idFactory('copy-child', 'copy-local-parent'),
    });
    const copiedChild = result.projects[0].tasks[0].messages.find(item => item.id === 'copy-child');

    expect(copiedChild?.parentMessageId).toBe(remoteParent.id);
    expect(copiedChild?.retryContext).toMatchObject({
      userMessageId: remoteParent.id,
      assistantMessageId: copiedChild?.id,
      historyMessageIds: [remoteParent.id, copiedChild?.id],
    });
  });

  it('source-aware conflict references drop a dangling remote agent', () => {
    const beforeProject = project('p1', [task('t1', '基线对话')]);
    beforeProject.tasks[0].activeAgentId = beforeProject.agents[0].id;
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].name = '本地对话';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].name = '远端对话';
    remoteProject.tasks[0].activeAgentId = 'missing-remote-agent';

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-task') },
    );
    const copiedTask = result.projects[0].tasks.find(item => item.id === 'copy-task');

    expect(copiedTask).not.toHaveProperty('activeAgentId');
    expect(copiedTask?.syncConflict?.sourceReferences?.activeAgentId)
      .toBe('missing-remote-agent');
  });

  it('source-aware conflict references remap remote message self references', () => {
    const beforeProject = project('p1', [task('t1')]);
    const parentMessage = message('m-parent', '父消息');
    const childMessage = message('m-child', '基线回答');
    childMessage.role = 'assistant';
    childMessage.parentMessageId = parentMessage.id;
    childMessage.retryContext = retryContext(parentMessage.id, childMessage.id, [
      parentMessage.id,
      childMessage.id,
    ]);
    beforeProject.tasks[0].messages = [parentMessage, childMessage];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[1].content = '本地回答';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages[1].content = '远端回答';
    remoteProject.tasks[0].messages[1].parentMessageId = childMessage.id;
    remoteProject.tasks[0].messages[1].retryContext = retryContext(
      childMessage.id,
      childMessage.id,
      [childMessage.id],
    );

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-child') },
    );
    const copiedChild = result.projects[0].tasks[0].messages.find(item => item.id === 'copy-child');

    expect(copiedChild?.parentMessageId).toBe('copy-child');
    expect(copiedChild?.retryContext).toMatchObject({
      userMessageId: 'copy-child',
      assistantMessageId: 'copy-child',
      historyMessageIds: ['copy-child'],
    });
  });

  it('source-aware conflict references drop dangling remote parent and required retry references', () => {
    const beforeProject = project('p1', [task('t1')]);
    const userMessage = message('m-user', '提问');
    const childMessage = message('m-child', '基线回答');
    childMessage.role = 'assistant';
    childMessage.parentMessageId = userMessage.id;
    childMessage.retryContext = retryContext(userMessage.id, childMessage.id, [
      userMessage.id,
      childMessage.id,
    ]);
    beforeProject.tasks[0].messages = [userMessage, childMessage];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[1].content = '本地回答';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages[1].content = '远端回答';
    remoteProject.tasks[0].messages[1].parentMessageId = 'missing-remote-parent';
    remoteProject.tasks[0].messages[1].retryContext = retryContext(
      'missing-remote-user',
      'missing-remote-assistant',
      ['missing-remote-history'],
    );

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-child') },
    );
    const copiedChild = result.projects[0].tasks[0].messages.find(item => item.id === 'copy-child');

    expect(copiedChild).not.toHaveProperty('parentMessageId');
    expect(copiedChild).not.toHaveProperty('retryContext');
    expect(copiedChild?.syncConflict?.sourceReferences).toMatchObject({
      parentMessageId: 'missing-remote-parent',
      retryContext: {
        userMessageId: 'missing-remote-user',
        assistantMessageId: 'missing-remote-assistant',
        historyMessageIds: ['missing-remote-history'],
      },
    });
  });

  it('source-aware conflict references filter dangling remote retry history', () => {
    const beforeProject = project('p1', [task('t1')]);
    const userMessage = message('m-user', '提问');
    const childMessage = message('m-child', '基线回答');
    childMessage.role = 'assistant';
    childMessage.retryContext = retryContext(userMessage.id, childMessage.id, [
      userMessage.id,
      childMessage.id,
    ]);
    beforeProject.tasks[0].messages = [userMessage, childMessage];
    const currentProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[1].content = '本地回答';
    const remoteProject = cloneProject(beforeProject);
    remoteProject.tasks[0].messages[1].content = '远端回答';
    remoteProject.tasks[0].messages[1].retryContext = retryContext(
      userMessage.id,
      childMessage.id,
      [userMessage.id, 'missing-remote-history', childMessage.id],
    );

    const result = replaySimpleChatOperations(
      [remoteProject],
      diffSimpleChatProjects([beforeProject], [currentProject], 1),
      { createId: idFactory('copy-child') },
    );
    const copiedChild = result.projects[0].tasks[0].messages.find(item => item.id === 'copy-child');

    expect(copiedChild?.retryContext?.historyMessageIds).toEqual(['m-user', 'copy-child']);
    expect(copiedChild?.syncConflict?.sourceReferences?.retryContext?.historyMessageIds)
      .toEqual(['m-user', 'missing-remote-history', 'm-child']);
  });

  it('persists conflict source and time and visibly marks message copies', () => {
    const beforeProject = graph();
    const currentProject = cloneProject(beforeProject);
    const remoteProject = cloneProject(beforeProject);
    currentProject.tasks[0].messages[0].content = '本地消息';
    remoteProject.tasks[0].messages[0].content = '远端消息';

    const operations = diffSimpleChatProjects([beforeProject], [currentProject], 1);
    const result = replaySimpleChatOperations([remoteProject], operations, {
      createId: idFactory('conflict-message', 'conflict-artifact'),
      now: () => 300,
    });
    const copy = result.projects[0].tasks[0].messages[1] as SimpleChatMessage & ConflictTagged;

    expect(copy.content).toContain('冲突副本');
    expect(copy.syncConflict).toEqual({
      operationId: operations[0].operationId,
      sourceEntityType: 'message',
      sourceEntityId: 'm1',
      sourceProjectId: 'p1',
      sourceTaskId: 't1',
      sourceMessageId: 'm1',
      conflictedAt: 300,
    });
  });

  it('keeps persisted conflict copies JSON-valid', () => {
    const before = [project('p1', [task('t1', '旧标题')])];
    const current = [project('p1', [task('t1', '本地标题')])];
    const result = replaySimpleChatOperations([], diffSimpleChatProjects(before, current, 1), {
      createId: idFactory('conflict-project', 'conflict-task'),
      localProjects: current,
      now: () => 400,
    });

    expect(validateSimpleChatProjects(result.projects)).toEqual({ success: true });
  });

  it('preserves public conflict metadata while redundant child upserts replay', () => {
    const local = graph();
    local.name = '本地项目';
    const remote = cloneProject(local);
    remote.name = '远端项目';

    const result = replaySimpleChatOperations(
      [remote],
      diffSimpleChatProjects([], [local], 1),
      { createId: idFactory(...Array.from({ length: 12 }, (_, index) => `conflict-${index + 1}`)) },
    );
    const copy: SimpleChatSyncedProject | undefined = result.projects.find(item => item.id !== local.id);
    if (!copy) throw new Error('Expected a conflict project copy');

    expect(copy.syncConflict?.sourceEntityType).toBe('project');
    expect(copy.tasks[0].syncConflict?.sourceEntityType).toBe('task');
    expect(copy.tasks[0].messages[0].syncConflict?.sourceEntityType).toBe('message');
    expect(copy.tasks[0].messages[0].artifacts?.[0].syncConflict?.sourceEntityType).toBe('artifact');
    expect(copy.agents[0].syncConflict?.sourceEntityType).toBe('agent');
    expect(copy.knowledgeItems[0].syncConflict?.sourceEntityType).toBe('knowledge-item');
  });

  it('keeps every visible conflict marker within the validated string limits', () => {
    const local = graph();
    local.name = 'p'.repeat(SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);
    local.tasks[0].name = 't'.repeat(SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);
    local.tasks[0].messages[0].content = 'm'.repeat(SIMPLE_CHAT_SYNC_LIMITS.messageContentBytes);
    local.tasks[0].messages[0].artifacts![0].title = 'a'.repeat(SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);
    local.agents[0].name = 'g'.repeat(SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);
    local.knowledgeItems[0].name = 'k'.repeat(SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);
    const remote = cloneProject(local);
    remote.name = 'r'.repeat(SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);

    const result = replaySimpleChatOperations(
      [remote],
      diffSimpleChatProjects([], [local], 1),
      { createId: idFactory(...Array.from({ length: 12 }, (_, index) => `bounded-${index + 1}`)) },
    );
    const copy = result.projects.find(item => item.id !== local.id);
    if (!copy) throw new Error('Expected a conflict project copy');

    expect(copy.name).toContain('冲突副本');
    expect(copy.tasks[0].name).toContain('冲突副本');
    expect(copy.tasks[0].messages[0].content).toContain('冲突副本');
    expect(copy.tasks[0].messages[0].artifacts?.[0].title).toContain('冲突副本');
    expect(copy.agents[0].name).toContain('冲突副本');
    expect(copy.knowledgeItems[0].name).toContain('冲突副本');
    expect(validateSimpleChatProjects(result.projects)).toEqual({ success: true });
  });

  it('truncates conflict names by Unicode code point while retaining the visible marker', () => {
    const local = graph();
    local.name = '😀'.repeat(SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);
    const remote = cloneProject(local);
    remote.name = '😁'.repeat(SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);

    const result = replaySimpleChatOperations(
      [remote],
      diffSimpleChatProjects([], [local], 1),
      { createId: idFactory(...Array.from({ length: 12 }, (_, index) => `emoji-${index + 1}`)) },
    );
    const copy = result.projects.find(item => item.id !== local.id);
    if (!copy) throw new Error('Expected an emoji-named conflict project copy');

    expect(Array.from(copy.name)).toHaveLength(SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);
    expect(copy.name).toBe(`${'😀'.repeat(506)}（冲突副本）`);
    expect(validateSimpleChatProjects(result.projects)).toEqual({ success: true });
  });

  it('exposes synchronized conflict metadata through the envelope project type', () => {
    expectTypeOf<SimpleChatSyncEnvelopeV1['baseProjects'][number]>()
      .toEqualTypeOf<SimpleChatSyncedProject>();
    expectTypeOf<SimpleChatSyncEnvelopeV1['currentProjects'][number]>()
      .toEqualTypeOf<SimpleChatSyncedProject>();
    expectTypeOf<SimpleChatReplayOptions['localProjects']>()
      .toEqualTypeOf<SimpleChatProject[] | undefined>();
  });

  it.each([
    {
      entityType: 'project',
      mutateCurrent: () => [],
      mutateRemote: (value: SimpleChatProject[]) => { value[0].name = '远端项目'; },
      assertDeleted: (value: SimpleChatProject[]) => expect(value).toEqual([]),
    },
    {
      entityType: 'task',
      mutateCurrent: (value: SimpleChatProject[]) => { value[0].tasks = []; return value; },
      mutateRemote: (value: SimpleChatProject[]) => { value[0].tasks[0].name = '远端对话'; },
      assertDeleted: (value: SimpleChatProject[]) => expect(value[0].tasks).toEqual([]),
    },
    {
      entityType: 'message',
      mutateCurrent: (value: SimpleChatProject[]) => { value[0].tasks[0].messages = []; return value; },
      mutateRemote: (value: SimpleChatProject[]) => { value[0].tasks[0].messages[0].content = '远端消息'; },
      assertDeleted: (value: SimpleChatProject[]) => expect(value[0].tasks[0].messages).toEqual([]),
    },
    {
      entityType: 'artifact',
      mutateCurrent: (value: SimpleChatProject[]) => {
        value[0].tasks[0].messages[0].artifacts = [];
        return value;
      },
      mutateRemote: (value: SimpleChatProject[]) => {
        value[0].tasks[0].messages[0].artifacts![0].title = '远端产物';
      },
      assertDeleted: (value: SimpleChatProject[]) => {
        expect(value[0].tasks[0].messages[0].artifacts).toEqual([]);
      },
    },
    {
      entityType: 'agent',
      mutateCurrent: (value: SimpleChatProject[]) => { value[0].agents = []; return value; },
      mutateRemote: (value: SimpleChatProject[]) => { value[0].agents[0].name = '远端智能体'; },
      assertDeleted: (value: SimpleChatProject[]) => expect(value[0].agents).toEqual([]),
    },
    {
      entityType: 'knowledge-item',
      mutateCurrent: (value: SimpleChatProject[]) => { value[0].knowledgeItems = []; return value; },
      mutateRemote: (value: SimpleChatProject[]) => { value[0].knowledgeItems[0].name = '远端知识'; },
      assertDeleted: (value: SimpleChatProject[]) => expect(value[0].knowledgeItems).toEqual([]),
    },
  ])('applies an explicit $entityType delete to the new remote baseline', ({
    mutateCurrent,
    mutateRemote,
    assertDeleted,
  }) => {
    const before = [graph()];
    const currentInput = [cloneProject(before[0])];
    const current = mutateCurrent(currentInput) ?? currentInput;
    const remote = [cloneProject(before[0])];
    mutateRemote(remote);

    const result = replaySimpleChatOperations(
      remote,
      diffSimpleChatProjects(before, current, 1),
    );

    assertDeleted(result.projects);
  });

  it('keeps operations created after the acknowledged batch', () => {
    const operations = [op('op-1', 1), op('op-2', 2)];
    expect(acknowledgeSimpleChatOperations(operations, ['op-1']))
      .toEqual([operations[1]]);
  });

  it('uses injected UUIDs for globally unique bounded operation ids', () => {
    const operationIds = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
    ];
    let operationIndex = 0;

    const operations = diffSimpleChatProjects([], [project('p-uuid')], 1, {
      createOperationId: () => operationIds[operationIndex++],
    });

    expect(operations.map(item => item.operationId)).toEqual(operationIds);
    expect(new Set(operations.map(item => item.operationId)).size).toBe(operations.length);
    expect(operations.every(item => item.operationId.length <= SIMPLE_CHAT_SYNC_LIMITS.idCharacters)).toBe(true);
  });

  it('rejects duplicate identities in base and current before diff creates operations', () => {
    const duplicateBase = [project('p1'), project('p1')];
    const duplicateCurrentProject = project('p2', [task('t1'), task('t1')]);
    let createdOperationIds = 0;
    const options = {
      createOperationId: () => {
        createdOperationIds += 1;
        return '10000000-0000-4000-8000-000000000001';
      },
    };

    const baseError = captureError(() => {
      diffSimpleChatProjects(duplicateBase, [], 1, options);
    });
    const currentError = captureError(() => {
      diffSimpleChatProjects([], [duplicateCurrentProject], 1, options);
    });

    expect(baseError).toBeInstanceOf(Error);
    expect(baseError).toMatchObject({
      code: 'CHAT_SYNC_DUPLICATE_ID',
      snapshot: 'base',
      field: 'projects',
      entityType: 'project',
      entityId: 'p1',
    });
    expect(currentError).toBeInstanceOf(Error);
    expect(currentError).toMatchObject({
      code: 'CHAT_SYNC_DUPLICATE_ID',
      snapshot: 'current',
      field: 'tasks',
      entityType: 'task',
      entityId: 't1',
      projectId: 'p2',
    });
    expect(createdOperationIds).toBe(0);
  });

  it('keeps colon-bearing entity paths distinct during compaction', () => {
    const first: SimpleChatSyncOperation = {
      operationId: '20000000-0000-4000-8000-000000000001',
      sequence: 1,
      kind: 'upsert',
      entityType: 'artifact',
      projectId: 'a:b',
      taskId: 'c',
      messageId: 'd',
      entityId: 'e',
      value: { id: 'e', title: 'first' },
    };
    const second: SimpleChatSyncOperation = {
      ...first,
      operationId: '20000000-0000-4000-8000-000000000002',
      sequence: 2,
      projectId: 'a',
      taskId: 'b:c',
      value: { id: 'e', title: 'second' },
    };

    expect(compactSimpleChatOperations([first, second])).toEqual([first, second]);
  });

  it.each([
    {
      name: 'upsert -> upsert',
      firstKind: 'upsert' as const,
      secondKind: 'upsert' as const,
      expectedKind: 'upsert' as const,
      expectedValue: { name: 'after' },
    },
    {
      name: 'upsert -> delete',
      firstKind: 'upsert' as const,
      secondKind: 'delete' as const,
      expectedKind: 'delete' as const,
      expectedValue: undefined,
    },
    {
      name: 'delete -> upsert',
      firstKind: 'delete' as const,
      secondKind: 'upsert' as const,
      expectedKind: 'upsert' as const,
      expectedValue: { name: 'after' },
    },
  ])('compacts $name with the earliest base and latest intent', ({
    firstKind,
    secondKind,
    expectedKind,
    expectedValue,
  }) => {
    const operations: SimpleChatSyncOperation[] = [
      {
        operationId: 'op-1',
        sequence: 1,
        kind: firstKind,
        entityType: 'task',
        projectId: 'p1',
        taskId: 't1',
        entityId: 't1',
        baseValue: { name: 'before' },
        value: firstKind === 'upsert' ? { name: 'middle' } : undefined,
      },
      {
        operationId: 'op-2',
        sequence: 2,
        kind: secondKind,
        entityType: 'task',
        projectId: 'p1',
        taskId: 't1',
        entityId: 't1',
        baseValue: { name: 'middle' },
        value: secondKind === 'upsert' ? { name: 'after' } : undefined,
      },
    ];

    expect(compactSimpleChatOperations(operations)).toEqual([{
      ...operations[1],
      kind: expectedKind,
      baseValue: { name: 'before' },
      value: expectedValue,
    }]);
  });

  it('compacts the same entity across interleaved operations before replay', () => {
    const first = op('task-upsert', 1);
    const interleaved = {
      ...op('other-task-upsert', 2),
      taskId: 't2',
      entityId: 't2',
    };
    const finalDelete: SimpleChatSyncOperation = {
      ...first,
      operationId: 'task-delete',
      sequence: 3,
      kind: 'delete',
      baseValue: first.value,
      value: undefined,
    };

    expect(compactSimpleChatOperations([first, interleaved, finalDelete])).toEqual([
      {
        ...finalDelete,
        baseValue: first.baseValue,
      },
      interleaved,
    ]);
  }, 1_000);

  it('keeps a compacted parent upsert before its dependent child upserts', () => {
    const added = graph();
    const operations = diffSimpleChatProjects([], [added], 1);
    const firstProjectUpsert = operations.find(item => item.entityType === 'project');
    if (!firstProjectUpsert) throw new Error('Expected a project upsert');
    const finalProjectUpsert: SimpleChatSyncOperation = {
      ...firstProjectUpsert,
      operationId: 'final-project-upsert',
      sequence: Math.max(...operations.map(item => item.sequence)) + 1,
      baseValue: firstProjectUpsert.value,
      value: {
        ...(firstProjectUpsert.value as SimpleChatProject),
        name: '最终项目名',
      },
    };

    const result = replaySimpleChatOperations([], [...operations, finalProjectUpsert]);

    expect(result.conflicts).toEqual([]);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({ id: 'p1', name: '最终项目名' });
    expect(result.projects[0].tasks[0].id).toBe('t1');
  });

  it('stably sorts child-first operations by their replay dependencies after compaction', () => {
    const added = graph();
    const operations = diffSimpleChatProjects([], [added], 1);
    const operationOfType = (entityType: SimpleChatSyncOperation['entityType']): SimpleChatSyncOperation => {
      const operation = operations.find(item => item.entityType === entityType);
      if (!operation) throw new Error(`Expected ${entityType} operation`);
      return operation;
    };
    const childFirst = [
      operationOfType('knowledge-item'),
      operationOfType('agent'),
      operationOfType('artifact'),
      operationOfType('message'),
      operationOfType('task'),
      operationOfType('project'),
    ];

    const compacted = compactSimpleChatOperations(childFirst);
    const result = replaySimpleChatOperations([], childFirst);

    expect(compacted.map(operation => operation.entityType)).toEqual([
      'project',
      'knowledge-item',
      'agent',
      'task',
      'message',
      'artifact',
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.projects).toEqual([added]);
  });

  it('keeps an unrelated operation stable while moving a parent before its child', () => {
    const operations = diffSimpleChatProjects([], [graph()], 1);
    const projectOperation = operations.find(item => item.entityType === 'project')!;
    const taskOperation = operations.find(item => item.entityType === 'task')!;
    const unrelatedOperation: SimpleChatSyncOperation = {
      ...operations.find(item => item.entityType === 'agent')!,
      operationId: 'unrelated-agent',
      projectId: 'p2',
      entityId: 'agent-p2',
    };

    expect(compactSimpleChatOperations([
      taskOperation,
      unrelatedOperation,
      projectOperation,
    ]).map(operation => operation.operationId)).toEqual([
      'unrelated-agent',
      projectOperation.operationId,
      taskOperation.operationId,
    ]);
  });

  it('remaps fixture artifact ownership to the containing project', () => {
    const value = project('p-fixture', [taskWithMessages('t-fixture', 1)]);
    expect(value.tasks[0].messages[0].artifacts?.[0]).toMatchObject({
      projectId: 'p-fixture',
      taskId: 't-fixture',
    });
  });
});

describe('simple chat sync payload validation', () => {
  it.each([
    {
      name: 'project globally',
      projects: [project('duplicate'), project('duplicate')],
      field: 'projects',
      entityType: 'project',
      entityId: 'duplicate',
    },
    {
      name: 'task within a project',
      projects: [project('p1', [task('duplicate'), task('duplicate')])],
      field: 'tasks',
      entityType: 'task',
      entityId: 'duplicate',
    },
    {
      name: 'agent within a project',
      projects: (() => {
        const value = project('p1');
        value.agents.push(cloneProject(value).agents[0]);
        return [value];
      })(),
      field: 'agents',
      entityType: 'agent',
      entityId: 'agent-p1',
    },
    {
      name: 'knowledge item within a project',
      projects: (() => {
        const value = project('p1');
        value.knowledgeItems.push(cloneProject(value).knowledgeItems[0]);
        return [value];
      })(),
      field: 'knowledgeItems',
      entityType: 'knowledge-item',
      entityId: 'knowledge-p1',
    },
    {
      name: 'message within a task',
      projects: (() => {
        const value = project('p1', [task('t1')]);
        value.tasks[0].messages = [message('duplicate'), message('duplicate')];
        return [value];
      })(),
      field: 'messages',
      entityType: 'message',
      entityId: 'duplicate',
    },
    {
      name: 'artifact within a message',
      projects: (() => {
        const value = project('p1', [task('t1')]);
        value.tasks[0].messages = [message('m1', '', [artifact('duplicate'), artifact('duplicate')])];
        return [value];
      })(),
      field: 'artifacts',
      entityType: 'artifact',
      entityId: 'duplicate',
    },
  ])('rejects a duplicate $name identity with structured details', ({
    projects,
    field,
    entityType,
    entityId,
  }) => {
    expect(validateSimpleChatProjects(projects)).toMatchObject({
      success: false,
      code: 'CHAT_SYNC_DUPLICATE_ID',
      field,
      entityType,
      entityId,
    });
  });

  it('allows the same nested stable ids in different parent scopes', () => {
    const first = project('p1', [task('t1'), task('t2')]);
    first.tasks[0].messages = [message('m1', '', [artifact('a1')])];
    first.tasks[1].messages = [message('m1', '', [artifact('a1', 'p1', 't2')])];
    const second = project('p2', [task('t1')]);
    second.tasks[0].messages = [message('m1', '', [artifact('a1', 'p2')])];
    second.agents[0].id = first.agents[0].id;
    second.knowledgeItems[0].id = first.knowledgeItems[0].id;

    expect(validateSimpleChatProjects([first, second])).toEqual({ success: true });
  });

  it('returns a bounded depth failure for a 20,000-level value without overflowing the stack', () => {
    const value = project('p-deep');
    (value as unknown as Record<string, unknown>).metadata = nestedObject(20_000);

    expect(() => validateSimpleChatProjects([value])).not.toThrow();
    expect(validateSimpleChatProjects([value])).toMatchObject(validationFailure('depth'));
  });

  it.each([
    ['project id', (value: SimpleChatProject) => { (value as unknown as Record<string, unknown>).id = 1; }],
    ['project name', (value: SimpleChatProject) => { (value as unknown as Record<string, unknown>).name = false; }],
    ['task id', (value: SimpleChatProject) => { (value.tasks[0] as unknown as Record<string, unknown>).id = 1; }],
    ['task name', (value: SimpleChatProject) => { (value.tasks[0] as unknown as Record<string, unknown>).name = false; }],
    ['message id', (value: SimpleChatProject) => { (value.tasks[0].messages[0] as unknown as Record<string, unknown>).id = 1; }],
    ['message content', (value: SimpleChatProject) => { (value.tasks[0].messages[0] as unknown as Record<string, unknown>).content = false; }],
    ['artifact id', (value: SimpleChatProject) => { (value.tasks[0].messages[0].artifacts![0] as unknown as Record<string, unknown>).id = 1; }],
    ['artifact title', (value: SimpleChatProject) => { (value.tasks[0].messages[0].artifacts![0] as unknown as Record<string, unknown>).title = false; }],
    ['artifact content', (value: SimpleChatProject) => { (value.tasks[0].messages[0].artifacts![0] as unknown as Record<string, unknown>).content = false; }],
    ['agent id', (value: SimpleChatProject) => { (value.agents[0] as unknown as Record<string, unknown>).id = 1; }],
    ['agent name', (value: SimpleChatProject) => { (value.agents[0] as unknown as Record<string, unknown>).name = false; }],
    ['knowledge item id', (value: SimpleChatProject) => { (value.knowledgeItems[0] as unknown as Record<string, unknown>).id = 1; }],
    ['knowledge item name', (value: SimpleChatProject) => { (value.knowledgeItems[0] as unknown as Record<string, unknown>).name = false; }],
  ])('rejects an invalid required $0 scalar type', (_name, mutate) => {
    const value = graph();
    mutate(value);
    expect(validateSimpleChatProjects([value])).toMatchObject(invalidValue());
  });

  it.each([
    ['project timestamp', (value: SimpleChatProject) => { (value as unknown as Record<string, unknown>).createdAt = '1'; }],
    ['task model', (value: SimpleChatProject) => { (value.tasks[0] as unknown as Record<string, unknown>).model = 1; }],
    ['message role', (value: SimpleChatProject) => { (value.tasks[0].messages[0] as unknown as Record<string, unknown>).role = 1; }],
    ['artifact version', (value: SimpleChatProject) => { (value.tasks[0].messages[0].artifacts![0] as unknown as Record<string, unknown>).version = '1'; }],
    ['agent tools', (value: SimpleChatProject) => { (value.agents[0] as unknown as Record<string, unknown>).tools = 'web_search'; }],
    ['knowledge tags', (value: SimpleChatProject) => { (value.knowledgeItems[0] as unknown as Record<string, unknown>).tags = 'tag'; }],
    ['attachment mime type', (value: SimpleChatProject) => {
      value.tasks[0].messages[0].attachments = [{
        id: 'attachment-1',
        type: 'file',
        name: 'file',
        mimeType: 'text/plain',
      }];
      (value.tasks[0].messages[0].attachments[0] as unknown as Record<string, unknown>).mimeType = 1;
    }],
    ['retry context boolean', (value: SimpleChatProject) => {
      value.tasks[0].messages[0].retryContext = retryContext('m1', 'm1', ['m1']);
      (value.tasks[0].messages[0].retryContext as unknown as Record<string, unknown>).webSearch = 'false';
    }],
    ['retry history element', (value: SimpleChatProject) => {
      value.tasks[0].messages[0].retryContext = retryContext('m1', 'm1', ['m1']);
      (value.tasks[0].messages[0].retryContext!.historyMessageIds as unknown[])[0] = 1;
    }],
    ['image reference without url', (value: SimpleChatProject) => {
      (value.tasks[0].messages[0] as unknown as Record<string, unknown>).imageRefs = [{ assetId: 'asset-1' }];
    }],
    ['image reference id', (value: SimpleChatProject) => {
      (value.tasks[0].messages[0] as unknown as Record<string, unknown>).imageRefs = [{ url: '/image.png', assetId: 1 }];
    }],
    ['image reference name', (value: SimpleChatProject) => {
      (value.tasks[0].messages[0] as unknown as Record<string, unknown>).imageRefs = [{ url: '/image.png', name: 1 }];
    }],
    ['task reasoning effort', (value: SimpleChatProject) => {
      (value.tasks[0] as unknown as Record<string, unknown>).reasoningEffort = 'extreme';
    }],
    ['task response speed', (value: SimpleChatProject) => {
      (value.tasks[0] as unknown as Record<string, unknown>).responseSpeed = 'turbo';
    }],
    ['applied reasoning effort', (value: SimpleChatProject) => {
      (value.tasks[0] as unknown as Record<string, unknown>).appliedChatControls = {
        appliedReasoningEffort: 'extreme',
        appliedResponseSpeed: 'balanced',
        degraded: false,
        notices: [],
      };
    }],
    ['applied response speed', (value: SimpleChatProject) => {
      (value.tasks[0] as unknown as Record<string, unknown>).appliedChatControls = {
        appliedReasoningEffort: 'medium',
        appliedResponseSpeed: 'turbo',
        degraded: false,
        notices: [],
      };
    }],
    ['applied controls degraded flag', (value: SimpleChatProject) => {
      (value.tasks[0] as unknown as Record<string, unknown>).appliedChatControls = {
        appliedReasoningEffort: 'medium',
        appliedResponseSpeed: 'balanced',
        degraded: 'false',
        notices: [],
      };
    }],
    ['applied controls notices', (value: SimpleChatProject) => {
      (value.tasks[0] as unknown as Record<string, unknown>).appliedChatControls = {
        appliedReasoningEffort: 'medium',
        appliedResponseSpeed: 'balanced',
        degraded: false,
        notices: [1],
      };
    }],
  ])('rejects an invalid nested $0 type', (_name, mutate) => {
    const value = graph();
    mutate(value);
    expect(validateSimpleChatProjects([value])).toMatchObject(invalidValue());
  });

  it('accepts the real image reference and chat control runtime values', () => {
    const value = graph();
    value.tasks[0].reasoningEffort = 'maximum';
    value.tasks[0].responseSpeed = 'quality';
    value.tasks[0].appliedChatControls = {
      appliedReasoningEffort: 'model-default',
      appliedResponseSpeed: 'model-default',
      degraded: true,
      notices: ['使用模型默认设置'],
    };
    value.tasks[0].messages[0].imageRefs = [{
      url: '/image.png',
      name: '参考图',
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      placementId: 'placement-1',
      entityId: 'entity-1',
    }];

    expect(validateSimpleChatProjects([value])).toEqual({ success: true });
  });

  it('validates every identifier-array element against the ID code-point limit', () => {
    const value = graph();
    value.tasks[0].messages[0].retryContext = retryContext(
      'm1',
      'm1',
      ['😀'.repeat(SIMPLE_CHAT_SYNC_LIMITS.idCharacters + 1)],
    );

    expect(validateSimpleChatProjects([value])).toMatchObject(validationFailure('id'));
  });

  it('counts ID and name limits by Unicode code point', () => {
    const exact = project('p-exact');
    exact.id = '😀'.repeat(SIMPLE_CHAT_SYNC_LIMITS.idCharacters);
    exact.name = '😀'.repeat(SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);
    const oversized = project('p-oversized');
    oversized.id = '😀'.repeat(SIMPLE_CHAT_SYNC_LIMITS.idCharacters + 1);

    expect(validateSimpleChatProjects([exact])).toEqual({ success: true });
    expect(validateSimpleChatProjects([oversized])).toMatchObject(validationFailure('id'));
  });

  it('leaves the exact request-body byte gate to the raw stream layer', () => {
    const projects = payloadAtJsonBytes(MAX_REQUEST_BYTES + 1);

    expect(new TextEncoder().encode(JSON.stringify(projects)).byteLength).toBeGreaterThan(MAX_REQUEST_BYTES);
    expect(validateSimpleChatProjects(projects)).toEqual({ success: true });
  });

  it('does not impose an aggregate entity cap beyond the categorized limits', () => {
    const tasks = Array.from({ length: 101 }, (_, taskIndex) => {
      const value = task(`task-${taskIndex}`);
      value.messages = Array.from({ length: 1_000 }, (_, messageIndex) => (
        message(`message-${taskIndex}-${messageIndex}`, '')
      ));
      return value;
    });

    expect(validateSimpleChatProjects([project('p-many', tasks)])).toEqual({ success: true });
  });

  it.each([
    ['tasks', () => {
      const value = project('p1');
      const unread = unreadCollection<SimpleChatTask>(SIMPLE_CHAT_SYNC_LIMITS.tasksPerProject + 1);
      value.tasks = unread.values;
      return { projects: [value], reads: unread.reads };
    }],
    ['messages', () => {
      const value = project('p1', [task('t1')]);
      const unread = unreadCollection<SimpleChatMessage>(SIMPLE_CHAT_SYNC_LIMITS.messagesPerTask + 1);
      value.tasks[0].messages = unread.values;
      return { projects: [value], reads: unread.reads };
    }],
    ['artifacts', () => {
      const value = project('p1', [task('t1')]);
      value.tasks[0].messages = [message('m1')];
      const unread = unreadCollection<ChatArtifact>(SIMPLE_CHAT_SYNC_LIMITS.artifactsPerMessage + 1);
      value.tasks[0].messages[0].artifacts = unread.values;
      return { projects: [value], reads: unread.reads };
    }],
    ['attachments', () => {
      const value = project('p1', [task('t1')]);
      value.tasks[0].messages = [message('m1')];
      const unread = unreadCollection<NonNullable<SimpleChatMessage['attachments']>[number]>(
        SIMPLE_CHAT_SYNC_LIMITS.attachmentsPerMessage + 1,
      );
      value.tasks[0].messages[0].attachments = unread.values;
      return { projects: [value], reads: unread.reads };
    }],
    ['agents', () => {
      const value = project('p1');
      const unread = unreadCollection<SimpleChatProject['agents'][number]>(
        SIMPLE_CHAT_SYNC_LIMITS.agentsPerProject + 1,
      );
      value.agents = unread.values;
      return { projects: [value], reads: unread.reads };
    }],
    ['knowledgeItems', () => {
      const value = project('p1');
      const unread = unreadCollection<SimpleChatProject['knowledgeItems'][number]>(
        SIMPLE_CHAT_SYNC_LIMITS.knowledgeItemsPerProject + 1,
      );
      value.knowledgeItems = unread.values;
      return { projects: [value], reads: unread.reads };
    }],
  ])('short-circuits category limits for $0 before duplicate or field traversal', (field, createValue) => {
    const { projects, reads } = createValue();

    expect(validateSimpleChatProjects(projects)).toMatchObject(validationFailure(field));
    expect(reads()).toBe(0);
  });

  it.each([
    ['projects', () => Array.from({ length: 500 }, (_, index) => project(`p-${index}`))],
    ['tasks', () => [project('p1', minimalTasks(1_000))]],
    ['messages', () => {
      const value = task('t1');
      value.messages = minimalMessages(10_000);
      return [project('p1', [value])];
    }],
    ['artifacts', () => {
      const value = task('t1');
      value.messages = [message(
        'm1',
        '',
        Array.from({ length: 64 }, (_, index) => artifact(`a-${index}`)),
      )];
      return [project('p1', [value])];
    }],
    ['attachments', () => {
      const value = task('t1');
      const chatMessage = message('m1');
      chatMessage.attachments = Array.from({ length: 64 }, (_, index) => ({
        id: `attachment-${index}`,
        type: 'file' as const,
        name: `attachment-${index}`,
        mimeType: 'text/plain',
      }));
      value.messages = [chatMessage];
      return [project('p1', [value])];
    }],
    ['agents', () => {
      const value = project('p1');
      value.agents = Array.from({ length: 1_000 }, (_, index) => ({
        ...value.agents[0],
        id: `agent-${index}`,
      }));
      return [value];
    }],
    ['knowledge items', () => {
      const value = project('p1');
      value.knowledgeItems = Array.from({ length: 1_000 }, (_, index) => ({
        ...value.knowledgeItems[0],
        id: `knowledge-${index}`,
      }));
      return [value];
    }],
    ['id length', () => {
      const value = project('p1');
      value.id = 'x'.repeat(256);
      return [value];
    }],
    ['name length', () => {
      const value = project('p1');
      value.name = 'x'.repeat(512);
      return [value];
    }],
    ['message content length', () => {
      const value = task('t1');
      value.messages = [message('m1', 'x'.repeat(512 * 1024))];
      return [project('p1', [value])];
    }],
    ['artifact content length', () => {
      const value = task('t1');
      const exactArtifact = artifact('a1');
      exactArtifact.content = 'x'.repeat(2 * MIB);
      value.messages = [message('m1', '', [exactArtifact])];
      return [project('p1', [value])];
    }],
    ['JSON depth', () => {
      const value = project('p1');
      (value as unknown as Record<string, unknown>).metadata = nestedObject(14);
      return [value];
    }],
  ])('accepts the exact $0 boundary', (_name, createValue) => {
    expect(validateSimpleChatProjects(createValue())).toEqual({ success: true });
  });

  it.each([
    ['projects', () => Array.from({ length: 501 }, (_, index) => project(`p-${index}`))],
    ['tasks', () => [project('p1', minimalTasks(1_001))]],
    ['messages', () => {
      const value = task('t1');
      value.messages = minimalMessages(10_001);
      return [project('p1', [value])];
    }],
    ['artifacts', () => {
      const value = task('t1');
      value.messages = [message(
        'm1',
        '',
        Array.from({ length: 65 }, (_, index) => artifact(`a-${index}`)),
      )];
      return [project('p1', [value])];
    }],
    ['attachments', () => {
      const value = task('t1');
      const chatMessage = message('m1');
      chatMessage.attachments = Array.from({ length: 65 }, (_, index) => ({
        id: `attachment-${index}`,
        type: 'file' as const,
        name: `attachment-${index}`,
        mimeType: 'text/plain',
      }));
      value.messages = [chatMessage];
      return [project('p1', [value])];
    }],
    ['agents', () => {
      const value = project('p1');
      value.agents = Array.from({ length: 1_001 }, (_, index) => ({
        ...value.agents[0],
        id: `agent-${index}`,
      }));
      return [value];
    }],
    ['knowledgeItems', () => {
      const value = project('p1');
      value.knowledgeItems = Array.from({ length: 1_001 }, (_, index) => ({
        ...value.knowledgeItems[0],
        id: `knowledge-${index}`,
      }));
      return [value];
    }],
    ['id', () => {
      const value = project('p1');
      value.id = 'x'.repeat(257);
      return [value];
    }],
    ['name', () => {
      const value = project('p1');
      value.name = 'x'.repeat(513);
      return [value];
    }],
    ['message.content', () => {
      const value = task('t1');
      value.messages = [message('m1', 'x'.repeat((512 * 1024) + 1))];
      return [project('p1', [value])];
    }],
    ['artifact.content', () => {
      const value = task('t1');
      const oversizedArtifact = artifact('a1');
      oversizedArtifact.content = 'x'.repeat((2 * MIB) + 1);
      value.messages = [message('m1', '', [oversizedArtifact])];
      return [project('p1', [value])];
    }],
    ['depth', () => {
      const value = project('p1');
      (value as unknown as Record<string, unknown>).metadata = nestedObject(15);
      return [value];
    }],
  ])('rejects the first value above the $0 boundary', (field, createValue) => {
    expect(validateSimpleChatProjects(createValue())).toMatchObject(validationFailure(field));
  });

  it.each([
    ['root projects', () => ({}) as unknown as SimpleChatProject[], 'projects'],
    ['project tasks', () => {
      const value = project('p1') as unknown as Record<string, unknown>;
      value.tasks = {};
      return [value] as unknown as SimpleChatProject[];
    }, 'tasks'],
    ['task messages', () => {
      const value = project('p1', [task('t1')]);
      (value.tasks[0] as unknown as Record<string, unknown>).messages = {};
      return [value];
    }, 'messages'],
    ['message artifacts', () => {
      const value = task('t1');
      value.messages = [message('m1')];
      const containingProject = project('p1', [value]);
      (containingProject.tasks[0].messages[0] as unknown as Record<string, unknown>).artifacts = {};
      return [containingProject];
    }, 'artifacts'],
    ['message attachments', () => {
      const chatMessage = message('m1') as unknown as Record<string, unknown>;
      chatMessage.attachments = {};
      const value = task('t1');
      value.messages = [chatMessage as unknown as SimpleChatMessage];
      return [project('p1', [value])];
    }, 'attachments'],
    ['project agents', () => {
      const value = project('p1') as unknown as Record<string, unknown>;
      value.agents = {};
      return [value] as unknown as SimpleChatProject[];
    }, 'agents'],
    ['project knowledge items', () => {
      const value = project('p1') as unknown as Record<string, unknown>;
      value.knowledgeItems = {};
      return [value] as unknown as SimpleChatProject[];
    }, 'knowledgeItems'],
  ])('rejects non-array $0 collections', (_name, createValue, field) => {
    expect(validateSimpleChatProjects(createValue())).toMatchObject(invalidValue(field));
  });

  it.each([
    ['undefined', (value: Record<string, unknown>) => { value.extra = undefined; }],
    ['function', (value: Record<string, unknown>) => { value.extra = () => undefined; }],
    ['symbol', (value: Record<string, unknown>) => { value.extra = Symbol('invalid'); }],
    ['bigint', (value: Record<string, unknown>) => { value.extra = BigInt(1); }],
    ['NaN', (value: Record<string, unknown>) => { value.extra = Number.NaN; }],
    ['Infinity', (value: Record<string, unknown>) => { value.extra = Number.POSITIVE_INFINITY; }],
    ['Date', (value: Record<string, unknown>) => { value.extra = new Date(0); }],
    ['cyclic object', (value: Record<string, unknown>) => { value.extra = value; }],
    ['prototype pollution key', (value: Record<string, unknown>) => {
      value.extra = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    }],
  ])('rejects non-JSON or unsafe $0 values', (_name, mutate) => {
    const value = project('p1') as unknown as Record<string, unknown>;
    mutate(value);
    expect(validateSimpleChatProjects([value as unknown as SimpleChatProject]))
      .toMatchObject(invalidValue());
  });

  it.each([
    ['nested id', 'id', { assetId: 'x'.repeat(257) }],
    ['nested name', 'name', { displayName: 'x'.repeat(513) }],
    ['nested text', 'text', { projectBackground: 'x'.repeat((2 * MIB) + 1) }],
  ])('applies the exact string limit to a $0 field', (_name, field, nestedValue) => {
    const value = project('p1');
    (value as unknown as Record<string, unknown>).nested = nestedValue;
    expect(validateSimpleChatProjects([value])).toMatchObject(validationFailure(field));
  });
});
