import { describe, expect, it } from 'vitest';
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
  validateSimpleChatProjects,
} from '@/lib/simple-chat-project-sync';
import type { SimpleChatSyncOperation } from '@/lib/simple-chat-project-sync';
import {
  op,
  project,
  task,
  taskWithMessages,
} from '@/__tests__/fixtures/simple-chat-sync';

const MIB = 1024 * 1024;
const MAX_REQUEST_BYTES = 20 * MIB;

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

function graph(): SimpleChatProject {
  const chatTask = task('t1', '基线对话');
  chatTask.messages = [message('m1', '基线消息', [artifact('a1')])];
  return project('p1', [chatTask]);
}

function cloneProject(value: SimpleChatProject): SimpleChatProject {
  return structuredClone(value);
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

function projectWithEntityCount(total: number): SimpleChatProject[] {
  const taskCount = 100;
  let messagesRemaining = total - 1 - taskCount;
  const tasks = Array.from({ length: taskCount }, (_, taskIndex) => {
    const messageCount = Math.min(1_000, messagesRemaining);
    messagesRemaining -= messageCount;
    const nextTask = task(`t-${taskIndex}`);
    nextTask.messages = minimalMessages(messageCount);
    return nextTask;
  });
  const value = project('p-total', tasks);
  value.agents = [];
  value.knowledgeItems = [];
  return [value];
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
      now: () => 400,
    });

    expect(validateSimpleChatProjects(result.projects)).toEqual({ success: true });
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
      interleaved,
      {
        ...finalDelete,
        baseValue: first.baseValue,
      },
    ]);
  }, 1_000);

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
    ['total entities', () => projectWithEntityCount(100_000)],
    ['JSON depth', () => {
      const value = project('p1');
      (value as unknown as Record<string, unknown>).metadata = nestedObject(14);
      return [value];
    }],
    ['request bytes', () => payloadAtJsonBytes(MAX_REQUEST_BYTES)],
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
    ['entities', () => projectWithEntityCount(100_001)],
    ['depth', () => {
      const value = project('p1');
      (value as unknown as Record<string, unknown>).metadata = nestedObject(15);
      return [value];
    }],
    ['requestBytes', () => payloadAtJsonBytes(MAX_REQUEST_BYTES + 1)],
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
