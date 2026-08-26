import type {
  ChatArtifact,
  ProjectKnowledgeItem,
  ProjectInstructions,
  SimpleChatAgent,
  SimpleChatMessage,
  SimpleChatProject,
  SimpleChatTask,
} from '@/components/simple-chat/simple-chat-types';

export type SimpleChatEntityType =
  | 'project'
  | 'task'
  | 'message'
  | 'artifact'
  | 'agent'
  | 'knowledge-item';

export interface SimpleChatSyncOperation {
  operationId: string;
  sequence: number;
  kind: 'upsert' | 'delete';
  entityType: SimpleChatEntityType;
  projectId: string;
  taskId?: string;
  messageId?: string;
  entityId: string;
  baseValue?: unknown;
  value?: unknown;
}

export interface SimpleChatSyncEnvelopeV1 {
  schemaVersion: 1;
  userId: string;
  baseRevision: number;
  baseProjects: SimpleChatProject[];
  currentProjects: SimpleChatProject[];
  pendingOperations: SimpleChatSyncOperation[];
  updatedAt: number;
}

export interface SimpleChatReplayResult {
  projects: SimpleChatProject[];
  conflicts: Array<{
    operationId: string;
    entityType: SimpleChatEntityType;
    copyId: string;
  }>;
}

export type SimpleChatProjectValidationResult =
  | { success: true }
  | {
    success: false;
    code: 'CHAT_SYNC_LIMIT_EXCEEDED';
    field: 'messages';
    limit: number;
    actual: number;
  };

interface FlatEntity {
  entityType: SimpleChatEntityType;
  projectId: string;
  taskId?: string;
  messageId?: string;
  entityId: string;
  value: unknown;
}

interface EntityReference {
  entityType: SimpleChatEntityType;
  project: SimpleChatProject;
  task?: SimpleChatTask;
  message?: SimpleChatMessage;
  entity: unknown;
  collection: unknown[];
  index: number;
}

const MAX_SYNC_MESSAGES = 10_000;

const EMPTY_INSTRUCTIONS: ProjectInstructions = {
  projectBackground: '',
  userPreference: '',
  outputFormat: '',
  styleRules: '',
  forbiddenRules: '',
  language: 'zh-CN',
};

export function diffSimpleChatProjects(
  base: SimpleChatProject[],
  current: SimpleChatProject[],
  sequenceStart: number,
): SimpleChatSyncOperation[] {
  const baseEntities = flattenSimpleChatProjects(base);
  const currentEntities = flattenSimpleChatProjects(current);
  const baseMap = new Map(baseEntities.map(entity => [entityKey(entity), entity]));
  const currentMap = new Map(currentEntities.map(entity => [entityKey(entity), entity]));
  const operations: SimpleChatSyncOperation[] = [];
  let sequence = sequenceStart;

  for (const entity of currentEntities) {
    const key = entityKey(entity);
    const baseEntity = baseMap.get(key);
    if (!baseEntity) {
      operations.push(createOperation(sequence++, 'upsert', entity, undefined, entity.value));
      continue;
    }
    if (!deepEqual(baseEntity.value, entity.value)) {
      operations.push(createOperation(sequence++, 'upsert', entity, baseEntity.value, entity.value));
    }
  }

  for (const entity of baseEntities) {
    const key = entityKey(entity);
    if (currentMap.has(key)) continue;
    operations.push(createOperation(sequence++, 'delete', entity, entity.value, undefined));
  }

  return compactSimpleChatOperations(operations);
}

export function compactSimpleChatOperations(
  operations: SimpleChatSyncOperation[],
): SimpleChatSyncOperation[] {
  const compacted: SimpleChatSyncOperation[] = [];

  for (const operation of operations) {
    const previous = compacted[compacted.length - 1];
    if (
      previous
      && previous.kind === 'upsert'
      && operation.kind === 'upsert'
      && operationIdentity(previous) === operationIdentity(operation)
    ) {
      compacted[compacted.length - 1] = {
        ...operation,
        baseValue: previous.baseValue,
      };
      continue;
    }
    compacted.push(operation);
  }

  return compacted;
}

export function replaySimpleChatOperations(
  remote: SimpleChatProject[],
  operations: SimpleChatSyncOperation[],
  options?: { createId?: () => string; now?: () => number },
): SimpleChatReplayResult {
  const createId = options?.createId ?? (() => crypto.randomUUID());
  const now = options?.now ?? (() => Date.now());
  const projects = cloneProjects(remote);
  const conflicts: SimpleChatReplayResult['conflicts'] = [];

  for (const operation of compactSimpleChatOperations(operations)) {
    if (operation.kind === 'delete') {
      replayDelete(projects, operation);
      continue;
    }

    const current = findEntity(projects, operation);
    if (!current) {
      if (operation.baseValue !== undefined) {
        const conflict = createConflictCopy(projects, operation, createId, now);
        if (conflict) conflicts.push(conflict);
        continue;
      }
      applyUpsert(projects, operation);
      continue;
    }

    if (operation.baseValue !== undefined && deepEqual(current.entity, operation.baseValue)) {
      replaceExistingEntity(current, cloneUnknown(operation.value));
      continue;
    }

    if (deepEqual(current.entity, operation.value)) {
      continue;
    }

    const conflict = createConflictCopy(projects, operation, createId, now, current);
    if (conflict) conflicts.push(conflict);
  }

  return { projects, conflicts };
}

export function acknowledgeSimpleChatOperations(
  pending: SimpleChatSyncOperation[],
  acknowledgedIds: string[],
): SimpleChatSyncOperation[] {
  if (acknowledgedIds.length === 0) return [...pending];
  const acknowledged = new Set(acknowledgedIds);
  return pending.filter(operation => !acknowledged.has(operation.operationId));
}

export function validateSimpleChatProjects(
  projects: SimpleChatProject[],
): SimpleChatProjectValidationResult {
  const actual = projects.reduce((total, project) => (
    total + project.tasks.reduce((taskTotal, task) => taskTotal + task.messages.length, 0)
  ), 0);

  if (actual > MAX_SYNC_MESSAGES) {
    return {
      success: false,
      code: 'CHAT_SYNC_LIMIT_EXCEEDED',
      field: 'messages',
      limit: MAX_SYNC_MESSAGES,
      actual,
    };
  }

  return { success: true };
}

function replayDelete(projects: SimpleChatProject[], operation: SimpleChatSyncOperation): void {
  const current = findEntity(projects, operation);
  if (!current) return;
  if (operation.baseValue !== undefined && !deepEqual(current.entity, operation.baseValue)) {
    return;
  }
  current.collection.splice(current.index, 1);
}

function createConflictCopy(
  projects: SimpleChatProject[],
  operation: SimpleChatSyncOperation,
  createId: () => string,
  now: () => number,
  current?: EntityReference,
): { operationId: string; entityType: SimpleChatEntityType; copyId: string } | null {
  if (operation.value === undefined) return null;

  const copyId = createId();
  const entityCopy = materializeConflictEntity(operation, copyId, now());

  switch (operation.entityType) {
    case 'project': {
      const projectCopy = entityCopy as SimpleChatProject;
      projects.push(projectCopy);
      return { operationId: operation.operationId, entityType: operation.entityType, copyId };
    }
    case 'task': {
      const project = ensureProject(projects, operation.projectId, now);
      const insertAt = current && current.entityType === 'task' ? current.index + 1 : project.tasks.length;
      project.tasks.splice(insertAt, 0, entityCopy as SimpleChatTask);
      project.updatedAt = now();
      return { operationId: operation.operationId, entityType: operation.entityType, copyId };
    }
    case 'message': {
      const task = ensureTask(projects, operation.projectId, operation.taskId, now);
      if (!task) return null;
      const insertAt = current && current.entityType === 'message' ? current.index + 1 : task.messages.length;
      task.messages.splice(insertAt, 0, entityCopy as SimpleChatMessage);
      task.updatedAt = now();
      return { operationId: operation.operationId, entityType: operation.entityType, copyId };
    }
    case 'artifact': {
      const message = ensureMessage(projects, operation.projectId, operation.taskId, operation.messageId, now);
      if (!message) return null;
      const artifacts = message.artifacts ?? [];
      const insertAt = current && current.entityType === 'artifact' ? current.index + 1 : artifacts.length;
      artifacts.splice(insertAt, 0, entityCopy as ChatArtifact);
      message.artifacts = artifacts;
      return { operationId: operation.operationId, entityType: operation.entityType, copyId };
    }
    case 'agent': {
      const project = ensureProject(projects, operation.projectId, now);
      const insertAt = current && current.entityType === 'agent' ? current.index + 1 : project.agents.length;
      project.agents.splice(insertAt, 0, entityCopy as SimpleChatAgent);
      project.updatedAt = now();
      return { operationId: operation.operationId, entityType: operation.entityType, copyId };
    }
    case 'knowledge-item': {
      const project = ensureProject(projects, operation.projectId, now);
      const insertAt = current && current.entityType === 'knowledge-item'
        ? current.index + 1
        : project.knowledgeItems.length;
      project.knowledgeItems.splice(insertAt, 0, entityCopy as ProjectKnowledgeItem);
      project.updatedAt = now();
      return { operationId: operation.operationId, entityType: operation.entityType, copyId };
    }
    default:
      return null;
  }
}

function materializeConflictEntity(
  operation: SimpleChatSyncOperation,
  copyId: string,
  timestamp: number,
): unknown {
  const value = cloneUnknown(operation.value);

  if (!isRecord(value)) return value;

  switch (operation.entityType) {
    case 'project':
      return {
        ...value,
        id: copyId,
        name: withConflictSuffix(readString(value.name) ?? '未命名项目'),
        updatedAt: timestamp,
      } satisfies Partial<SimpleChatProject>;
    case 'task':
      return {
        ...value,
        id: copyId,
        projectId: operation.projectId,
        name: withConflictSuffix(readString(value.name) ?? '未命名对话'),
        updatedAt: timestamp,
      } satisfies Partial<SimpleChatTask>;
    case 'message':
      return {
        ...value,
        id: copyId,
        createdAt: timestamp,
      } satisfies Partial<SimpleChatMessage>;
    case 'artifact':
      return {
        ...value,
        id: copyId,
        projectId: operation.projectId,
        taskId: operation.taskId ?? readString(value.taskId) ?? '',
        title: withConflictSuffix(readString(value.title) ?? '未命名产物'),
        updatedAt: timestamp,
      } satisfies Partial<ChatArtifact>;
    case 'agent':
      return {
        ...value,
        id: copyId,
        name: withConflictSuffix(readString(value.name) ?? '未命名智能体'),
        updatedAt: timestamp,
      } satisfies Partial<SimpleChatAgent>;
    case 'knowledge-item':
      return {
        ...value,
        id: copyId,
        projectId: operation.projectId,
        name: withConflictSuffix(readString(value.name) ?? '未命名知识'),
        updatedAt: timestamp,
      } satisfies Partial<ProjectKnowledgeItem>;
    default:
      return value;
  }
}

function applyUpsert(projects: SimpleChatProject[], operation: SimpleChatSyncOperation): void {
  if (operation.value === undefined) return;
  const nextValue = cloneUnknown(operation.value);
  const current = findEntity(projects, operation);

  if (current) {
    replaceExistingEntity(current, nextValue);
    return;
  }

  switch (operation.entityType) {
    case 'project':
      projects.push(nextValue as SimpleChatProject);
      return;
    case 'task': {
      const project = ensureProject(projects, operation.projectId, Date.now);
      project.tasks.push(nextValue as SimpleChatTask);
      return;
    }
    case 'message': {
      const task = ensureTask(projects, operation.projectId, operation.taskId, Date.now);
      if (!task) return;
      task.messages.push(nextValue as SimpleChatMessage);
      return;
    }
    case 'artifact': {
      const message = ensureMessage(projects, operation.projectId, operation.taskId, operation.messageId, Date.now);
      if (!message) return;
      message.artifacts = [...(message.artifacts ?? []), nextValue as ChatArtifact];
      return;
    }
    case 'agent': {
      const project = ensureProject(projects, operation.projectId, Date.now);
      project.agents.push(nextValue as SimpleChatAgent);
      return;
    }
    case 'knowledge-item': {
      const project = ensureProject(projects, operation.projectId, Date.now);
      project.knowledgeItems.push(nextValue as ProjectKnowledgeItem);
      return;
    }
  }
}

function replaceExistingEntity(reference: EntityReference, nextValue: unknown): void {
  switch (reference.entityType) {
    case 'project':
      reference.collection[reference.index] = nextValue as SimpleChatProject;
      return;
    case 'task':
      reference.collection[reference.index] = nextValue as SimpleChatTask;
      return;
    case 'message':
      reference.collection[reference.index] = nextValue as SimpleChatMessage;
      return;
    case 'artifact': {
      reference.collection[reference.index] = nextValue as ChatArtifact;
      if (reference.message) {
        reference.message.artifacts = reference.collection as ChatArtifact[];
      }
      return;
    }
    case 'agent':
      reference.collection[reference.index] = nextValue as SimpleChatAgent;
      return;
    case 'knowledge-item':
      reference.collection[reference.index] = nextValue as ProjectKnowledgeItem;
      return;
  }
}

function flattenSimpleChatProjects(projects: SimpleChatProject[]): FlatEntity[] {
  const entities: FlatEntity[] = [];

  for (const project of projects) {
    entities.push({
      entityType: 'project',
      projectId: project.id,
      entityId: project.id,
      value: normalizeProject(project),
    });

    for (const task of project.tasks) {
      entities.push({
        entityType: 'task',
        projectId: project.id,
        taskId: task.id,
        entityId: task.id,
        value: normalizeTask(task),
      });

      for (const message of task.messages) {
        entities.push({
          entityType: 'message',
          projectId: project.id,
          taskId: task.id,
          messageId: message.id,
          entityId: message.id,
          value: normalizeMessage(message),
        });

        for (const artifact of message.artifacts ?? []) {
          entities.push({
            entityType: 'artifact',
            projectId: project.id,
            taskId: task.id,
            messageId: message.id,
            entityId: artifact.id,
            value: cloneUnknown(artifact),
          });
        }
      }
    }

    for (const agent of project.agents) {
      entities.push({
        entityType: 'agent',
        projectId: project.id,
        entityId: agent.id,
        value: cloneUnknown(agent),
      });
    }

    for (const knowledgeItem of project.knowledgeItems) {
      entities.push({
        entityType: 'knowledge-item',
        projectId: project.id,
        entityId: knowledgeItem.id,
        value: cloneUnknown(knowledgeItem),
      });
    }
  }

  return entities;
}

function normalizeProject(project: SimpleChatProject): Omit<SimpleChatProject, 'tasks' | 'agents' | 'knowledgeItems'> {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    emoji: project.emoji,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    instructions: project.instructions ? cloneUnknown(project.instructions) as ProjectInstructions : undefined,
  };
}

function normalizeTask(task: SimpleChatTask): Omit<SimpleChatTask, 'messages'> {
  return {
    id: task.id,
    projectId: task.projectId,
    name: task.name,
    model: task.model,
    providerId: task.providerId,
    imageModel: task.imageModel,
    imageProviderId: task.imageProviderId,
    reasoningEffort: task.reasoningEffort,
    responseSpeed: task.responseSpeed,
    appliedChatControls: task.appliedChatControls ? cloneUnknown(task.appliedChatControls) as SimpleChatTask['appliedChatControls'] : undefined,
    activeAgentId: task.activeAgentId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function normalizeMessage(message: SimpleChatMessage): Omit<SimpleChatMessage, 'artifacts'> {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    images: message.images ? [...message.images] : undefined,
    imageRefs: message.imageRefs ? cloneUnknown(message.imageRefs) as SimpleChatMessage['imageRefs'] : undefined,
    attachments: message.attachments ? cloneUnknown(message.attachments) as SimpleChatMessage['attachments'] : undefined,
    model: message.model,
    providerId: message.providerId,
    parentMessageId: message.parentMessageId,
    branchId: message.branchId,
    agentRunId: message.agentRunId,
    status: message.status,
    error: message.error ? cloneUnknown(message.error) as SimpleChatMessage['error'] : undefined,
    retryContext: message.retryContext ? cloneUnknown(message.retryContext) as SimpleChatMessage['retryContext'] : undefined,
    createdAt: message.createdAt,
  };
}

function createOperation(
  sequence: number,
  kind: 'upsert' | 'delete',
  entity: FlatEntity,
  baseValue: unknown,
  value: unknown,
): SimpleChatSyncOperation {
  return {
    operationId: `simple-chat-sync:${sequence}:${entity.entityType}:${entity.entityId}`,
    sequence,
    kind,
    entityType: entity.entityType,
    projectId: entity.projectId,
    taskId: entity.taskId,
    messageId: entity.messageId,
    entityId: entity.entityId,
    baseValue: cloneUnknown(baseValue),
    value: cloneUnknown(value),
  };
}

function operationIdentity(operation: SimpleChatSyncOperation): string {
  return [
    operation.entityType,
    operation.projectId,
    operation.taskId ?? '',
    operation.messageId ?? '',
    operation.entityId,
  ].join(':');
}

function entityKey(entity: Pick<FlatEntity, 'entityType' | 'projectId' | 'taskId' | 'messageId' | 'entityId'>): string {
  return [
    entity.entityType,
    entity.projectId,
    entity.taskId ?? '',
    entity.messageId ?? '',
    entity.entityId,
  ].join(':');
}

function findEntity(projects: SimpleChatProject[], operation: SimpleChatSyncOperation): EntityReference | undefined {
  switch (operation.entityType) {
    case 'project': {
      const index = projects.findIndex(project => project.id === operation.entityId);
      if (index === -1) return undefined;
      return {
        entityType: 'project',
        project: projects[index],
        entity: projects[index],
        collection: projects,
        index,
      };
    }
    case 'task': {
      const project = projects.find(item => item.id === operation.projectId);
      if (!project) return undefined;
      const index = project.tasks.findIndex(task => task.id === operation.entityId);
      if (index === -1) return undefined;
      return {
        entityType: 'task',
        project,
        task: project.tasks[index],
        entity: project.tasks[index],
        collection: project.tasks,
        index,
      };
    }
    case 'message': {
      const task = findTask(projects, operation.projectId, operation.taskId);
      if (!task) return undefined;
      const index = task.messages.findIndex(message => message.id === operation.entityId);
      if (index === -1) return undefined;
      const project = projects.find(item => item.id === operation.projectId)!;
      return {
        entityType: 'message',
        project,
        task,
        message: task.messages[index],
        entity: task.messages[index],
        collection: task.messages,
        index,
      };
    }
    case 'artifact': {
      const task = findTask(projects, operation.projectId, operation.taskId);
      if (!task) return undefined;
      const message = task.messages.find(item => item.id === operation.messageId);
      if (!message?.artifacts) return undefined;
      const index = message.artifacts.findIndex(artifact => artifact.id === operation.entityId);
      if (index === -1) return undefined;
      const project = projects.find(item => item.id === operation.projectId)!;
      return {
        entityType: 'artifact',
        project,
        task,
        message,
        entity: message.artifacts[index],
        collection: message.artifacts,
        index,
      };
    }
    case 'agent': {
      const project = projects.find(item => item.id === operation.projectId);
      if (!project) return undefined;
      const index = project.agents.findIndex(agent => agent.id === operation.entityId);
      if (index === -1) return undefined;
      return {
        entityType: 'agent',
        project,
        entity: project.agents[index],
        collection: project.agents,
        index,
      };
    }
    case 'knowledge-item': {
      const project = projects.find(item => item.id === operation.projectId);
      if (!project) return undefined;
      const index = project.knowledgeItems.findIndex(item => item.id === operation.entityId);
      if (index === -1) return undefined;
      return {
        entityType: 'knowledge-item',
        project,
        entity: project.knowledgeItems[index],
        collection: project.knowledgeItems,
        index,
      };
    }
  }
}

function ensureProject(
  projects: SimpleChatProject[],
  projectId: string,
  now: () => number,
): SimpleChatProject {
  const existing = projects.find(project => project.id === projectId);
  if (existing) return existing;

  const timestamp = now();
  const project: SimpleChatProject = {
    id: projectId,
    name: `项目-${projectId}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    tasks: [],
    agents: [],
    knowledgeItems: [],
    instructions: { ...EMPTY_INSTRUCTIONS },
  };
  projects.push(project);
  return project;
}

function ensureTask(
  projects: SimpleChatProject[],
  projectId: string,
  taskId: string | undefined,
  now: () => number,
): SimpleChatTask | undefined {
  if (!taskId) return undefined;
  const project = ensureProject(projects, projectId, now);
  const existing = project.tasks.find(task => task.id === taskId);
  if (existing) return existing;

  const timestamp = now();
  const task: SimpleChatTask = {
    id: taskId,
    projectId,
    name: `对话-${taskId}`,
    messages: [],
    model: 'unknown',
    providerId: 'unknown',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  project.tasks.push(task);
  project.updatedAt = timestamp;
  return task;
}

function ensureMessage(
  projects: SimpleChatProject[],
  projectId: string,
  taskId: string | undefined,
  messageId: string | undefined,
  now: () => number,
): SimpleChatMessage | undefined {
  if (!messageId) return undefined;
  const task = ensureTask(projects, projectId, taskId, now);
  if (!task) return undefined;
  const existing = task.messages.find(message => message.id === messageId);
  if (existing) return existing;

  const message: SimpleChatMessage = {
    id: messageId,
    role: 'user',
    content: '',
    createdAt: now(),
  };
  task.messages.push(message);
  task.updatedAt = message.createdAt;
  return message;
}

function findTask(
  projects: SimpleChatProject[],
  projectId: string,
  taskId: string | undefined,
): SimpleChatTask | undefined {
  if (!taskId) return undefined;
  const project = projects.find(item => item.id === projectId);
  return project?.tasks.find(item => item.id === taskId);
}

function cloneProjects(projects: SimpleChatProject[]): SimpleChatProject[] {
  return cloneUnknown(projects) as SimpleChatProject[];
}

function cloneUnknown<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return structuredClone(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withConflictSuffix(name: string): string {
  return `${name}（冲突副本）`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
