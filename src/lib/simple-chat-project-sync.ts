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

export interface SimpleChatDiffOptions {
  createOperationId?: () => string;
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

export interface SimpleChatConflictMetadata {
  operationId: string;
  sourceEntityType: SimpleChatEntityType;
  sourceEntityId: string;
  sourceProjectId: string;
  sourceTaskId?: string;
  sourceMessageId?: string;
  conflictedAt: number;
}

export interface SimpleChatConflictTagged {
  syncConflict?: SimpleChatConflictMetadata;
}

export type SimpleChatSyncedArtifact = ChatArtifact & SimpleChatConflictTagged;
export type SimpleChatSyncedMessage = Omit<SimpleChatMessage, 'artifacts'>
  & SimpleChatConflictTagged
  & { artifacts?: SimpleChatSyncedArtifact[] };
export type SimpleChatSyncedTask = Omit<SimpleChatTask, 'messages'>
  & SimpleChatConflictTagged
  & { messages: SimpleChatSyncedMessage[] };
export type SimpleChatSyncedAgent = SimpleChatAgent & SimpleChatConflictTagged;
export type SimpleChatSyncedKnowledgeItem = ProjectKnowledgeItem & SimpleChatConflictTagged;
export type SimpleChatSyncedProject = Omit<SimpleChatProject, 'tasks' | 'agents' | 'knowledgeItems'>
  & SimpleChatConflictTagged
  & {
    tasks: SimpleChatSyncedTask[];
    agents: SimpleChatSyncedAgent[];
    knowledgeItems: SimpleChatSyncedKnowledgeItem[];
  };

export interface SimpleChatReplayResult {
  projects: SimpleChatSyncedProject[];
  conflicts: Array<{
    operationId: string;
    entityType: SimpleChatEntityType;
    copyId: string;
  }>;
}

export const SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES = 20 * 1024 * 1024;

export const SIMPLE_CHAT_SYNC_LIMITS = {
  projects: 500,
  tasksPerProject: 1_000,
  messagesPerTask: 10_000,
  artifactsPerMessage: 64,
  attachmentsPerMessage: 64,
  agentsPerProject: 1_000,
  knowledgeItemsPerProject: 1_000,
  idCharacters: 256,
  nameCharacters: 512,
  messageContentBytes: 512 * 1024,
  largeTextBytes: 2 * 1024 * 1024,
  jsonDepth: 16,
} as const;

export type SimpleChatProjectValidationResult =
  | { success: true }
  | {
    success: false;
    code: 'CHAT_SYNC_LIMIT_EXCEEDED' | 'CHAT_SYNC_INVALID_VALUE';
    field: string;
    limit?: number;
    actual?: number;
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

interface ReplayIdRemaps {
  projects: Map<string, string>;
  tasks: Map<string, string>;
  messages: Map<string, string>;
  artifacts: Map<string, string>;
  agents: Map<string, string>;
  knowledgeItems: Map<string, string>;
}

interface ReplayContext {
  projects: SimpleChatProject[];
  conflicts: SimpleChatReplayResult['conflicts'];
  createId: () => string;
  now: () => number;
  remaps: ReplayIdRemaps;
}

interface MergeResult {
  value: unknown;
  conflict: boolean;
}

interface JsonInspection {
  valid: boolean;
  depth: number;
  oversizedTextBytes?: number;
  limitViolation?: {
    field: 'id' | 'name';
    limit: number;
    actual: number;
  };
}

const EMPTY_INSTRUCTIONS: ProjectInstructions = {
  projectBackground: '',
  userPreference: '',
  outputFormat: '',
  styleRules: '',
  forbiddenRules: '',
  language: 'zh-CN',
};

const CONFLICT_MARKER = '（冲突副本）';
const MESSAGE_CONFLICT_MARKER = '【冲突副本】';
const MISSING = Symbol('missing');
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function diffSimpleChatProjects(
  base: SimpleChatProject[],
  current: SimpleChatProject[],
  sequenceStart: number,
  options?: SimpleChatDiffOptions,
): SimpleChatSyncOperation[] {
  const baseEntities = flattenSimpleChatProjects(base);
  const currentEntities = flattenSimpleChatProjects(current);
  const baseMap = new Map(baseEntities.map(entity => [entityIdentity(entity), entity]));
  const currentMap = new Map(currentEntities.map(entity => [entityIdentity(entity), entity]));
  const operations: SimpleChatSyncOperation[] = [];
  let sequence = sequenceStart;
  const createOperationId = options?.createOperationId ?? (() => crypto.randomUUID());

  for (const entity of currentEntities) {
    const baseEntity = baseMap.get(entityIdentity(entity));
    if (!baseEntity) {
      operations.push(createOperation(sequence++, 'upsert', entity, undefined, entity.value, createOperationId));
      continue;
    }
    if (!jsonEqual(comparableEntityValue(entity.entityType, baseEntity.value), comparableEntityValue(entity.entityType, entity.value))) {
      operations.push(createOperation(sequence++, 'upsert', entity, baseEntity.value, entity.value, createOperationId));
    }
  }

  for (const entity of baseEntities) {
    if (currentMap.has(entityIdentity(entity))) continue;
    operations.push(createOperation(sequence++, 'delete', entity, entity.value, undefined, createOperationId));
  }

  return compactSimpleChatOperations(operations);
}

export function compactSimpleChatOperations(
  operations: SimpleChatSyncOperation[],
): SimpleChatSyncOperation[] {
  const compacted = new Map<string, SimpleChatSyncOperation>();

  for (const operation of operations) {
    const identity = entityIdentity(operation);
    const previous = compacted.get(identity);
    if (previous) {
      compacted.set(identity, {
        ...cloneUnknown(operation),
        baseValue: cloneUnknown(previous.baseValue),
      });
      continue;
    }
    compacted.set(identity, cloneUnknown(operation));
  }

  return [...compacted.values()];
}

export function replaySimpleChatOperations(
  remote: SimpleChatProject[],
  operations: SimpleChatSyncOperation[],
  options?: { createId?: () => string; now?: () => number },
): SimpleChatReplayResult {
  const context: ReplayContext = {
    projects: cloneProjects(remote),
    conflicts: [],
    createId: options?.createId ?? (() => crypto.randomUUID()),
    now: options?.now ?? (() => Date.now()),
    remaps: createReplayIdRemaps(),
  };

  for (const originalOperation of compactSimpleChatOperations(operations)) {
    const operation = resolveOperation(context, originalOperation);
    if (operation.kind === 'delete') {
      replayDelete(context.projects, operation);
      continue;
    }

    const current = findEntity(context.projects, operation);
    const localValue = remapKnownEntityValue(context, originalOperation, operation);
    const belongsToConflictBranch = operationPathWasRemapped(originalOperation, operation);

    if (!current) {
      if (originalOperation.baseValue !== undefined || !hasRequiredParent(context.projects, operation)) {
        const conflict = createConflictCopy(context, originalOperation, localValue);
        if (conflict) context.conflicts.push(conflict);
        continue;
      }
      applyNewUpsert(context.projects, operation, localValue);
      continue;
    }

    if (belongsToConflictBranch) {
      replaceProjectedEntity(current, comparableEntityValue(operation.entityType, localValue));
      preserveConflictPresentation(current);
      continue;
    }

    if (originalOperation.baseValue === undefined) {
      if (!jsonEqual(comparableEntityValue(operation.entityType, current.entity), comparableEntityValue(operation.entityType, localValue))) {
        const conflict = createConflictCopy(context, originalOperation, localValue, current);
        if (conflict) context.conflicts.push(conflict);
      }
      continue;
    }

    const merge = mergeJsonValues(
      comparableEntityValue(originalOperation.entityType, originalOperation.baseValue),
      comparableEntityValue(originalOperation.entityType, localValue),
      comparableEntityValue(originalOperation.entityType, current.entity),
    );

    if (!merge.conflict) {
      replaceProjectedEntity(current, merge.value);
      continue;
    }

    const conflictValue = applyProjectionToValue(localValue, merge.value, originalOperation.entityType);
    const conflict = createConflictCopy(context, originalOperation, conflictValue, current);
    if (conflict) context.conflicts.push(conflict);
  }

  return { projects: context.projects, conflicts: context.conflicts };
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
  if (!Array.isArray(projects)) return invalidValidation('projects');
  if (projects.length > SIMPLE_CHAT_SYNC_LIMITS.projects) {
    return limitValidation('projects', SIMPLE_CHAT_SYNC_LIMITS.projects, projects.length);
  }

  for (const project of projects) {
    if (!isRecord(project)) return invalidValidation('projects');
    const projectResult = validateNamedEntity(project);
    if (projectResult) return projectResult;
    if (!Array.isArray(project.tasks)) return invalidValidation('tasks');
    if (!Array.isArray(project.agents)) return invalidValidation('agents');
    if (!Array.isArray(project.knowledgeItems)) return invalidValidation('knowledgeItems');
    if (project.tasks.length > SIMPLE_CHAT_SYNC_LIMITS.tasksPerProject) {
      return limitValidation('tasks', SIMPLE_CHAT_SYNC_LIMITS.tasksPerProject, project.tasks.length);
    }
    if (project.agents.length > SIMPLE_CHAT_SYNC_LIMITS.agentsPerProject) {
      return limitValidation('agents', SIMPLE_CHAT_SYNC_LIMITS.agentsPerProject, project.agents.length);
    }
    if (project.knowledgeItems.length > SIMPLE_CHAT_SYNC_LIMITS.knowledgeItemsPerProject) {
      return limitValidation(
        'knowledgeItems',
        SIMPLE_CHAT_SYNC_LIMITS.knowledgeItemsPerProject,
        project.knowledgeItems.length,
      );
    }
    for (const agent of project.agents) {
      if (!isRecord(agent)) return invalidValidation('agents');
      const agentResult = validateNamedEntity(agent);
      if (agentResult) return agentResult;
    }
    for (const knowledgeItem of project.knowledgeItems) {
      if (!isRecord(knowledgeItem)) return invalidValidation('knowledgeItems');
      const knowledgeResult = validateNamedEntity(knowledgeItem);
      if (knowledgeResult) return knowledgeResult;
    }

    for (const task of project.tasks) {
      if (!isRecord(task)) return invalidValidation('tasks');
      const taskResult = validateNamedEntity(task);
      if (taskResult) return taskResult;
      if (!Array.isArray(task.messages)) return invalidValidation('messages');
      if (task.messages.length > SIMPLE_CHAT_SYNC_LIMITS.messagesPerTask) {
        return limitValidation('messages', SIMPLE_CHAT_SYNC_LIMITS.messagesPerTask, task.messages.length);
      }
      for (const chatMessage of task.messages) {
        if (!isRecord(chatMessage)) return invalidValidation('messages');
        const messageIdResult = validateIds(chatMessage);
        if (messageIdResult) return messageIdResult;
        if (typeof chatMessage.content === 'string') {
          const contentBytes = utf8Bytes(chatMessage.content);
          if (contentBytes > SIMPLE_CHAT_SYNC_LIMITS.messageContentBytes) {
            return limitValidation(
              'message.content',
              SIMPLE_CHAT_SYNC_LIMITS.messageContentBytes,
              contentBytes,
            );
          }
        }
        if (chatMessage.artifacts !== undefined && !Array.isArray(chatMessage.artifacts)) {
          return invalidValidation('artifacts');
        }
        if (chatMessage.attachments !== undefined && !Array.isArray(chatMessage.attachments)) {
          return invalidValidation('attachments');
        }
        const artifacts = chatMessage.artifacts ?? [];
        const attachments = chatMessage.attachments ?? [];
        if (artifacts.length > SIMPLE_CHAT_SYNC_LIMITS.artifactsPerMessage) {
          return limitValidation('artifacts', SIMPLE_CHAT_SYNC_LIMITS.artifactsPerMessage, artifacts.length);
        }
        if (attachments.length > SIMPLE_CHAT_SYNC_LIMITS.attachmentsPerMessage) {
          return limitValidation('attachments', SIMPLE_CHAT_SYNC_LIMITS.attachmentsPerMessage, attachments.length);
        }
        for (const item of attachments) {
          if (!isRecord(item)) return invalidValidation('attachments');
          const attachmentResult = validateNamedEntity(item);
          if (attachmentResult) return attachmentResult;
        }
        for (const item of artifacts) {
          if (!isRecord(item)) return invalidValidation('artifacts');
          const artifactResult = validateNamedEntity(item);
          if (artifactResult) return artifactResult;
          if (typeof item.content === 'string') {
            const contentBytes = utf8Bytes(item.content);
            if (contentBytes > SIMPLE_CHAT_SYNC_LIMITS.largeTextBytes) {
              return limitValidation(
                'artifact.content',
                SIMPLE_CHAT_SYNC_LIMITS.largeTextBytes,
                contentBytes,
              );
            }
          }
        }
      }
    }
  }

  const inspection = inspectJsonValue(projects, 1, new Set<object>());
  if (!inspection.valid) return invalidValidation('value');
  if (inspection.limitViolation) {
    return limitValidation(
      inspection.limitViolation.field,
      inspection.limitViolation.limit,
      inspection.limitViolation.actual,
    );
  }
  if (inspection.depth > SIMPLE_CHAT_SYNC_LIMITS.jsonDepth) {
    return limitValidation('depth', SIMPLE_CHAT_SYNC_LIMITS.jsonDepth, inspection.depth);
  }
  if (inspection.oversizedTextBytes !== undefined) {
    return limitValidation(
      'text',
      SIMPLE_CHAT_SYNC_LIMITS.largeTextBytes,
      inspection.oversizedTextBytes,
    );
  }

  return { success: true };
}

function createReplayIdRemaps(): ReplayIdRemaps {
  return {
    projects: new Map(),
    tasks: new Map(),
    messages: new Map(),
    artifacts: new Map(),
    agents: new Map(),
    knowledgeItems: new Map(),
  };
}

function resolveOperation(context: ReplayContext, operation: SimpleChatSyncOperation): SimpleChatSyncOperation {
  const projectId = context.remaps.projects.get(operation.projectId) ?? operation.projectId;
  const taskId = operation.taskId
    ? context.remaps.tasks.get(taskMapKey(operation.projectId, operation.taskId)) ?? operation.taskId
    : undefined;
  const messageId = operation.messageId
    ? context.remaps.messages.get(messageMapKey(operation.projectId, operation.taskId, operation.messageId))
      ?? operation.messageId
    : undefined;
  let entityId = operation.entityId;

  switch (operation.entityType) {
    case 'project':
      entityId = projectId;
      break;
    case 'task':
      entityId = context.remaps.tasks.get(taskMapKey(operation.projectId, operation.entityId)) ?? operation.entityId;
      break;
    case 'message':
      entityId = context.remaps.messages.get(messageMapKey(operation.projectId, operation.taskId, operation.entityId))
        ?? operation.entityId;
      break;
    case 'artifact':
      entityId = context.remaps.artifacts.get(artifactMapKey(
        operation.projectId,
        operation.taskId,
        operation.messageId,
        operation.entityId,
      )) ?? operation.entityId;
      break;
    case 'agent':
      entityId = context.remaps.agents.get(projectEntityMapKey(operation.projectId, operation.entityId))
        ?? operation.entityId;
      break;
    case 'knowledge-item':
      entityId = context.remaps.knowledgeItems.get(projectEntityMapKey(operation.projectId, operation.entityId))
        ?? operation.entityId;
      break;
  }

  return { ...operation, projectId, taskId, messageId, entityId };
}

function operationPathWasRemapped(
  original: SimpleChatSyncOperation,
  resolved: SimpleChatSyncOperation,
): boolean {
  return original.projectId !== resolved.projectId
    || original.taskId !== resolved.taskId
    || original.messageId !== resolved.messageId
    || original.entityId !== resolved.entityId;
}

function replayDelete(projects: SimpleChatProject[], operation: SimpleChatSyncOperation): void {
  const current = findEntity(projects, operation);
  if (!current) return;
  current.collection.splice(current.index, 1);
}

function createConflictCopy(
  context: ReplayContext,
  operation: SimpleChatSyncOperation,
  inputValue: unknown,
  current?: EntityReference,
): { operationId: string; entityType: SimpleChatEntityType; copyId: string } | null {
  if (!isRecord(inputValue)) return null;
  const timestamp = context.now();

  switch (operation.entityType) {
    case 'project': {
      const projectCopy = cloneConflictProject(context, inputValue, operation, timestamp);
      const insertAt = current ? current.index + 1 : context.projects.length;
      context.projects.splice(insertAt, 0, projectCopy);
      return conflictRecord(operation, projectCopy.id);
    }
    case 'task': {
      const project = ensureConflictProject(context, operation, timestamp);
      const taskCopy = cloneConflictTask(context, inputValue, operation, project.id, timestamp);
      const insertAt = current?.entityType === 'task' && current.project.id === project.id
        ? current.index + 1
        : project.tasks.length;
      project.tasks.splice(insertAt, 0, taskCopy);
      project.updatedAt = timestamp;
      return conflictRecord(operation, taskCopy.id);
    }
    case 'message': {
      const task = ensureConflictTask(context, operation, timestamp);
      const messageCopy = cloneConflictMessage(context, inputValue, operation, task.projectId, task.id, timestamp);
      const insertAt = current?.entityType === 'message' && current.task?.id === task.id
        ? current.index + 1
        : task.messages.length;
      task.messages.splice(insertAt, 0, messageCopy);
      task.updatedAt = timestamp;
      return conflictRecord(operation, messageCopy.id);
    }
    case 'artifact': {
      const message = ensureConflictMessage(context, operation, timestamp);
      const resolvedTaskId = resolveTaskId(context, operation.projectId, operation.taskId);
      const artifactCopy = cloneConflictArtifact(
        context,
        inputValue,
        operation,
        resolveProjectId(context, operation.projectId),
        resolvedTaskId ?? '',
        timestamp,
      );
      const artifacts = message.artifacts ?? [];
      const insertAt = current?.entityType === 'artifact' && current.message?.id === message.id
        ? current.index + 1
        : artifacts.length;
      artifacts.splice(insertAt, 0, artifactCopy);
      message.artifacts = artifacts;
      return conflictRecord(operation, artifactCopy.id);
    }
    case 'agent': {
      const project = ensureConflictProject(context, operation, timestamp);
      const agentCopy = cloneConflictAgent(context, inputValue, operation, timestamp);
      const insertAt = current?.entityType === 'agent' && current.project.id === project.id
        ? current.index + 1
        : project.agents.length;
      project.agents.splice(insertAt, 0, agentCopy);
      project.updatedAt = timestamp;
      return conflictRecord(operation, agentCopy.id);
    }
    case 'knowledge-item': {
      const project = ensureConflictProject(context, operation, timestamp);
      const knowledgeCopy = cloneConflictKnowledgeItem(context, inputValue, operation, project.id, timestamp);
      const insertAt = current?.entityType === 'knowledge-item' && current.project.id === project.id
        ? current.index + 1
        : project.knowledgeItems.length;
      project.knowledgeItems.splice(insertAt, 0, knowledgeCopy);
      project.updatedAt = timestamp;
      return conflictRecord(operation, knowledgeCopy.id);
    }
  }
}

function ensureConflictProject(
  context: ReplayContext,
  operation: SimpleChatSyncOperation,
  timestamp: number,
): SimpleChatProject {
  const resolvedId = resolveProjectId(context, operation.projectId);
  const existing = context.projects.find(project => project.id === resolvedId);
  if (existing) return existing;

  const copyId = context.createId();
  context.remaps.projects.set(operation.projectId, copyId);
  const project: SimpleChatProject = {
    id: copyId,
    name: withConflictSuffix(`项目-${operation.projectId}`),
    createdAt: timestamp,
    updatedAt: timestamp,
    tasks: [],
    agents: [],
    knowledgeItems: [],
    instructions: { ...EMPTY_INSTRUCTIONS },
  };
  tagConflictEntity(project, metadataFor(operation, 'project', operation.projectId, timestamp));
  context.projects.push(project);
  return project;
}

function ensureConflictTask(
  context: ReplayContext,
  operation: SimpleChatSyncOperation,
  timestamp: number,
): SimpleChatTask {
  const project = ensureConflictProject(context, operation, timestamp);
  const originalTaskId = operation.taskId ?? operation.entityId;
  const resolvedTaskId = resolveTaskId(context, operation.projectId, originalTaskId);
  const existing = resolvedTaskId
    ? project.tasks.find(task => task.id === resolvedTaskId)
    : undefined;
  if (existing) return existing;

  const copyId = context.createId();
  context.remaps.tasks.set(taskMapKey(operation.projectId, originalTaskId), copyId);
  const task: SimpleChatTask = {
    id: copyId,
    projectId: project.id,
    name: withConflictSuffix(`对话-${originalTaskId}`),
    messages: [],
    model: 'unknown',
    providerId: 'unknown',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  tagConflictEntity(task, metadataFor(operation, 'task', originalTaskId, timestamp));
  project.tasks.push(task);
  project.updatedAt = timestamp;
  return task;
}

function ensureConflictMessage(
  context: ReplayContext,
  operation: SimpleChatSyncOperation,
  timestamp: number,
): SimpleChatMessage {
  const task = ensureConflictTask(context, operation, timestamp);
  const originalMessageId = operation.messageId ?? operation.entityId;
  const resolvedMessageId = resolveMessageId(
    context,
    operation.projectId,
    operation.taskId,
    originalMessageId,
  );
  const existing = resolvedMessageId
    ? task.messages.find(message => message.id === resolvedMessageId)
    : undefined;
  if (existing) return existing;

  const copyId = context.createId();
  context.remaps.messages.set(
    messageMapKey(operation.projectId, operation.taskId, originalMessageId),
    copyId,
  );
  const chatMessage: SimpleChatMessage = {
    id: copyId,
    role: 'user',
    content: MESSAGE_CONFLICT_MARKER,
    artifacts: [],
    createdAt: timestamp,
  };
  tagConflictEntity(chatMessage, metadataFor(operation, 'message', originalMessageId, timestamp));
  task.messages.push(chatMessage);
  task.updatedAt = timestamp;
  return chatMessage;
}

function cloneConflictProject(
  context: ReplayContext,
  value: Record<string, unknown>,
  operation: SimpleChatSyncOperation,
  timestamp: number,
): SimpleChatProject {
  const source = materializeProject(value);
  const originalProjectId = readString(source.id) ?? operation.projectId;
  const copyId = context.createId();
  context.remaps.projects.set(originalProjectId, copyId);
  reserveProjectGraphIds(context, source, originalProjectId);

  const agents = source.agents.map(agent => cloneConflictAgent(
    context,
    agent as unknown as Record<string, unknown>,
    operationForDescendant(operation, 'agent', originalProjectId, undefined, undefined, agent.id),
    timestamp,
  ));
  const knowledgeItems = source.knowledgeItems.map(item => cloneConflictKnowledgeItem(
    context,
    item as unknown as Record<string, unknown>,
    operationForDescendant(operation, 'knowledge-item', originalProjectId, undefined, undefined, item.id),
    copyId,
    timestamp,
  ));
  const tasks = source.tasks.map(item => cloneConflictTask(
    context,
    item as unknown as Record<string, unknown>,
    operationForDescendant(operation, 'task', originalProjectId, item.id, undefined, item.id),
    copyId,
    timestamp,
  ));

  const projectCopy: SimpleChatProject = {
    ...source,
    id: copyId,
    name: withConflictSuffix(source.name),
    updatedAt: timestamp,
    tasks,
    agents,
    knowledgeItems,
  };
  tagConflictEntity(projectCopy, metadataFor(operation, 'project', originalProjectId, timestamp));
  return projectCopy;
}

function cloneConflictTask(
  context: ReplayContext,
  value: Record<string, unknown>,
  operation: SimpleChatSyncOperation,
  targetProjectId: string,
  timestamp: number,
): SimpleChatTask {
  const source = materializeTask(value, targetProjectId);
  const originalTaskId = readString(value.id) ?? operation.taskId ?? operation.entityId;
  reserveTaskGraphIds(context, source, operation.projectId, originalTaskId);
  const copyId = context.remaps.tasks.get(taskMapKey(operation.projectId, originalTaskId))!;
  const messages = source.messages.map(item => cloneConflictMessage(
    context,
    item as unknown as Record<string, unknown>,
    operationForDescendant(operation, 'message', operation.projectId, originalTaskId, item.id, item.id),
    targetProjectId,
    copyId,
    timestamp,
  ));

  const activeAgentId = remapAgentReference(context, operation.projectId, source.activeAgentId);
  const taskCopy: SimpleChatTask = {
    ...source,
    id: copyId,
    projectId: targetProjectId,
    name: withConflictSuffix(source.name),
    ...(activeAgentId === undefined ? {} : { activeAgentId }),
    messages,
    updatedAt: timestamp,
  };
  tagConflictEntity(taskCopy, metadataFor(operation, 'task', originalTaskId, timestamp));
  return taskCopy;
}

function cloneConflictMessage(
  context: ReplayContext,
  value: Record<string, unknown>,
  operation: SimpleChatSyncOperation,
  targetProjectId: string,
  targetTaskId: string,
  timestamp: number,
): SimpleChatMessage {
  const source = materializeMessage(value);
  const originalMessageId = readString(value.id) ?? operation.messageId ?? operation.entityId;
  reserveMessageGraphIds(context, source, operation.projectId, operation.taskId, originalMessageId);
  const copyId = context.remaps.messages.get(
    messageMapKey(operation.projectId, operation.taskId, originalMessageId),
  )!;
  const artifacts = (source.artifacts ?? []).map(item => cloneConflictArtifact(
    context,
    item as unknown as Record<string, unknown>,
    operationForDescendant(
      operation,
      'artifact',
      operation.projectId,
      operation.taskId,
      originalMessageId,
      item.id,
    ),
    targetProjectId,
    targetTaskId,
    timestamp,
  ));
  const parentMessageId = remapMessageReference(
    context,
    operation.projectId,
    operation.taskId,
    source.parentMessageId,
  );
  const retryContext = remapRetryContext(
    context,
    source.retryContext,
    operation.projectId,
    operation.taskId,
    targetProjectId,
    targetTaskId,
  );
  const messageCopy: SimpleChatMessage = {
    ...source,
    id: copyId,
    content: withMessageConflictMarker(source.content),
    ...(parentMessageId === undefined ? {} : { parentMessageId }),
    ...(retryContext === undefined ? {} : { retryContext }),
    artifacts,
    createdAt: timestamp,
  };
  tagConflictEntity(messageCopy, metadataFor(operation, 'message', originalMessageId, timestamp));
  return messageCopy;
}

function cloneConflictArtifact(
  context: ReplayContext,
  value: Record<string, unknown>,
  operation: SimpleChatSyncOperation,
  targetProjectId: string,
  targetTaskId: string,
  timestamp: number,
): ChatArtifact {
  const source = value as unknown as ChatArtifact;
  const originalId = readString(value.id) ?? operation.entityId;
  const artifactKey = artifactMapKey(operation.projectId, operation.taskId, operation.messageId, originalId);
  const copyId = context.remaps.artifacts.get(artifactKey) ?? context.createId();
  context.remaps.artifacts.set(artifactKey, copyId);
  const artifactCopy: ChatArtifact = {
    ...cloneUnknown(source),
    id: copyId,
    projectId: targetProjectId,
    taskId: targetTaskId,
    title: withConflictSuffix(readString(value.title) ?? '未命名产物'),
    updatedAt: timestamp,
  };
  tagConflictEntity(artifactCopy, metadataFor(operation, 'artifact', originalId, timestamp));
  return artifactCopy;
}

function cloneConflictAgent(
  context: ReplayContext,
  value: Record<string, unknown>,
  operation: SimpleChatSyncOperation,
  timestamp: number,
): SimpleChatAgent {
  const source = value as unknown as SimpleChatAgent;
  const originalId = readString(value.id) ?? operation.entityId;
  const agentKey = projectEntityMapKey(operation.projectId, originalId);
  const copyId = context.remaps.agents.get(agentKey) ?? context.createId();
  context.remaps.agents.set(agentKey, copyId);
  const agentCopy: SimpleChatAgent = {
    ...cloneUnknown(source),
    id: copyId,
    name: withConflictSuffix(readString(value.name) ?? '未命名智能体'),
    updatedAt: timestamp,
  };
  tagConflictEntity(agentCopy, metadataFor(operation, 'agent', originalId, timestamp));
  return agentCopy;
}

function cloneConflictKnowledgeItem(
  context: ReplayContext,
  value: Record<string, unknown>,
  operation: SimpleChatSyncOperation,
  targetProjectId: string,
  timestamp: number,
): ProjectKnowledgeItem {
  const source = value as unknown as ProjectKnowledgeItem;
  const originalId = readString(value.id) ?? operation.entityId;
  const knowledgeKey = projectEntityMapKey(operation.projectId, originalId);
  const copyId = context.remaps.knowledgeItems.get(knowledgeKey) ?? context.createId();
  context.remaps.knowledgeItems.set(knowledgeKey, copyId);
  const knowledgeCopy: ProjectKnowledgeItem = {
    ...cloneUnknown(source),
    id: copyId,
    projectId: targetProjectId,
    name: withConflictSuffix(readString(value.name) ?? '未命名知识'),
    updatedAt: timestamp,
  };
  tagConflictEntity(knowledgeCopy, metadataFor(operation, 'knowledge-item', originalId, timestamp));
  return knowledgeCopy;
}

function applyNewUpsert(
  projects: SimpleChatProject[],
  operation: SimpleChatSyncOperation,
  value: unknown,
): void {
  if (!isRecord(value)) return;

  switch (operation.entityType) {
    case 'project':
      projects.push(materializeProject(value));
      return;
    case 'task': {
      const project = projects.find(item => item.id === operation.projectId);
      if (!project) return;
      project.tasks.push(materializeTask(value, project.id));
      return;
    }
    case 'message': {
      const task = findTask(projects, operation.projectId, operation.taskId);
      if (!task) return;
      const nextMessage = materializeMessage(value);
      nextMessage.artifacts = (nextMessage.artifacts ?? []).map(item => ({
        ...item,
        projectId: operation.projectId,
        taskId: task.id,
      }));
      task.messages.push(nextMessage);
      return;
    }
    case 'artifact': {
      const message = findMessage(projects, operation.projectId, operation.taskId, operation.messageId);
      if (!message) return;
      const artifacts = message.artifacts ?? [];
      artifacts.push({
        ...(cloneUnknown(value) as unknown as ChatArtifact),
        projectId: operation.projectId,
        taskId: operation.taskId ?? '',
      });
      message.artifacts = artifacts;
      return;
    }
    case 'agent': {
      const project = projects.find(item => item.id === operation.projectId);
      if (!project) return;
      project.agents.push(cloneUnknown(value) as unknown as SimpleChatAgent);
      return;
    }
    case 'knowledge-item': {
      const project = projects.find(item => item.id === operation.projectId);
      if (!project) return;
      project.knowledgeItems.push({
        ...(cloneUnknown(value) as unknown as ProjectKnowledgeItem),
        projectId: operation.projectId,
      });
      return;
    }
  }
}

function replaceProjectedEntity(reference: EntityReference, projection: unknown): void {
  const nextValue = applyProjectionToValue(reference.entity, projection, reference.entityType);
  reference.collection[reference.index] = nextValue;
  if (reference.entityType === 'artifact' && reference.message) {
    reference.message.artifacts = reference.collection as ChatArtifact[];
  }
}

function preserveConflictPresentation(reference: EntityReference): void {
  const entity = reference.collection[reference.index];
  if (!isRecord(entity) || !isRecord(entity.syncConflict)) return;
  switch (reference.entityType) {
    case 'project':
    case 'task':
    case 'agent':
    case 'knowledge-item':
      if (typeof entity.name === 'string') entity.name = withConflictSuffix(entity.name);
      return;
    case 'artifact':
      if (typeof entity.title === 'string') entity.title = withConflictSuffix(entity.title);
      return;
    case 'message':
      if (typeof entity.content === 'string') entity.content = withMessageConflictMarker(entity.content);
  }
}

function applyProjectionToValue(
  fullValue: unknown,
  projection: unknown,
  entityType: SimpleChatEntityType,
): unknown {
  if (!isRecord(fullValue) || !isRecord(projection)) return cloneUnknown(projection);
  const next = cloneUnknown(fullValue) as Record<string, unknown>;
  const existingProjection = comparableEntityValue(entityType, fullValue);
  if (isRecord(existingProjection)) {
    for (const key of Object.keys(existingProjection)) {
      if (key === 'syncConflict') continue;
      if (!Object.prototype.hasOwnProperty.call(projection, key)) delete next[key];
    }
  }
  for (const [key, value] of Object.entries(projection)) next[key] = cloneUnknown(value);
  return next;
}

function mergeJsonValues(base: unknown, local: unknown, remote: unknown, key?: string): MergeResult {
  if (jsonEqual(local, base)) return { value: cloneUnknown(remote), conflict: false };
  if (jsonEqual(remote, base)) return { value: cloneUnknown(local), conflict: false };
  if (jsonEqual(local, remote)) return { value: cloneUnknown(local), conflict: false };
  if (key === 'updatedAt' && typeof local === 'number' && typeof remote === 'number') {
    return { value: Math.max(local, remote), conflict: false };
  }

  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const merged: Record<string, unknown> = {};
    let conflict = false;
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const childKey of keys) {
      const baseValue = ownValue(base, childKey);
      const localValue = ownValue(local, childKey);
      const remoteValue = ownValue(remote, childKey);
      const child = mergeJsonValues(baseValue, localValue, remoteValue, childKey);
      conflict ||= child.conflict;
      if (child.value !== MISSING) merged[childKey] = child.value;
    }
    return { value: merged, conflict };
  }

  return { value: cloneUnknown(local), conflict: true };
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : MISSING;
}

function remapKnownEntityValue(
  context: ReplayContext,
  original: SimpleChatSyncOperation,
  resolved: SimpleChatSyncOperation,
): unknown {
  if (!isRecord(original.value)) return cloneUnknown(original.value);
  const value = cloneUnknown(original.value) as Record<string, unknown>;

  switch (original.entityType) {
    case 'project': {
      value.id = resolved.entityId;
      if (Array.isArray(value.tasks)) {
        value.tasks = value.tasks.map(item => remapKnownTask(context, original.projectId, resolved.projectId, item));
      }
      if (Array.isArray(value.agents)) {
        value.agents = value.agents.map(item => remapKnownProjectEntity(
          context.remaps.agents,
          original.projectId,
          item,
        ));
      }
      if (Array.isArray(value.knowledgeItems)) {
        value.knowledgeItems = value.knowledgeItems.map(item => {
          const next = remapKnownProjectEntity(context.remaps.knowledgeItems, original.projectId, item);
          if (isRecord(next)) next.projectId = resolved.projectId;
          return next;
        });
      }
      break;
    }
    case 'task':
      return remapKnownTask(context, original.projectId, resolved.projectId, value, resolved.entityId);
    case 'message':
      return remapKnownMessage(
        context,
        original.projectId,
        original.taskId,
        resolved.projectId,
        resolved.taskId,
        value,
        resolved.entityId,
      );
    case 'artifact':
      value.id = resolved.entityId;
      value.projectId = resolved.projectId;
      value.taskId = resolved.taskId ?? '';
      break;
    case 'agent':
      value.id = resolved.entityId;
      break;
    case 'knowledge-item':
      value.id = resolved.entityId;
      value.projectId = resolved.projectId;
      break;
  }
  return value;
}

function remapKnownTask(
  context: ReplayContext,
  originalProjectId: string,
  targetProjectId: string,
  input: unknown,
  forcedId?: string,
): unknown {
  if (!isRecord(input)) return cloneUnknown(input);
  const value = cloneUnknown(input) as Record<string, unknown>;
  const originalTaskId = readString(value.id) ?? '';
  const targetTaskId = forcedId
    ?? context.remaps.tasks.get(taskMapKey(originalProjectId, originalTaskId))
    ?? originalTaskId;
  value.id = targetTaskId;
  value.projectId = targetProjectId;
  const activeAgentId = readString(value.activeAgentId);
  if (activeAgentId !== undefined) {
    value.activeAgentId = remapAgentReference(context, originalProjectId, activeAgentId);
  }
  if (Array.isArray(value.messages)) {
    value.messages = value.messages.map(item => remapKnownMessage(
      context,
      originalProjectId,
      originalTaskId,
      targetProjectId,
      targetTaskId,
      item,
    ));
  }
  return value;
}

function remapKnownMessage(
  context: ReplayContext,
  originalProjectId: string,
  originalTaskId: string | undefined,
  targetProjectId: string,
  targetTaskId: string | undefined,
  input: unknown,
  forcedId?: string,
): unknown {
  if (!isRecord(input)) return cloneUnknown(input);
  const value = cloneUnknown(input) as Record<string, unknown>;
  const originalMessageId = readString(value.id) ?? '';
  const targetMessageId = forcedId
    ?? context.remaps.messages.get(messageMapKey(originalProjectId, originalTaskId, originalMessageId))
    ?? originalMessageId;
  value.id = targetMessageId;
  const parentMessageId = readString(value.parentMessageId);
  if (parentMessageId !== undefined) {
    value.parentMessageId = remapMessageReference(
      context,
      originalProjectId,
      originalTaskId,
      parentMessageId,
    );
  }
  if (Object.prototype.hasOwnProperty.call(value, 'retryContext')) {
    const retryContext = remapRetryContext(
      context,
      value.retryContext,
      originalProjectId,
      originalTaskId,
      targetProjectId,
      targetTaskId,
    );
    if (retryContext === undefined) delete value.retryContext;
    else value.retryContext = retryContext;
  }
  if (Array.isArray(value.artifacts)) {
    value.artifacts = value.artifacts.map(item => {
      if (!isRecord(item)) return cloneUnknown(item);
      const next = cloneUnknown(item) as Record<string, unknown>;
      const originalArtifactId = readString(next.id) ?? '';
      next.id = context.remaps.artifacts.get(artifactMapKey(
        originalProjectId,
        originalTaskId,
        originalMessageId,
        originalArtifactId,
      )) ?? originalArtifactId;
      next.projectId = targetProjectId;
      next.taskId = targetTaskId ?? '';
      return next;
    });
  }
  return value;
}

function reserveProjectGraphIds(
  context: ReplayContext,
  project: SimpleChatProject,
  originalProjectId: string,
): void {
  for (const agent of project.agents) {
    const key = projectEntityMapKey(originalProjectId, agent.id);
    if (!context.remaps.agents.has(key)) context.remaps.agents.set(key, context.createId());
  }
  for (const item of project.knowledgeItems) {
    const key = projectEntityMapKey(originalProjectId, item.id);
    if (!context.remaps.knowledgeItems.has(key)) context.remaps.knowledgeItems.set(key, context.createId());
  }
  for (const task of project.tasks) {
    reserveTaskGraphIds(context, task, originalProjectId, task.id);
  }
}

function reserveTaskGraphIds(
  context: ReplayContext,
  task: SimpleChatTask,
  originalProjectId: string,
  originalTaskId: string,
): void {
  const key = taskMapKey(originalProjectId, originalTaskId);
  if (!context.remaps.tasks.has(key)) context.remaps.tasks.set(key, context.createId());
  for (const chatMessage of task.messages) {
    reserveMessageGraphIds(context, chatMessage, originalProjectId, originalTaskId, chatMessage.id);
  }
}

function reserveMessageGraphIds(
  context: ReplayContext,
  chatMessage: SimpleChatMessage,
  originalProjectId: string,
  originalTaskId: string | undefined,
  originalMessageId: string,
): void {
  const key = messageMapKey(originalProjectId, originalTaskId, originalMessageId);
  if (!context.remaps.messages.has(key)) context.remaps.messages.set(key, context.createId());
  for (const item of chatMessage.artifacts ?? []) {
    const artifactKey = artifactMapKey(originalProjectId, originalTaskId, originalMessageId, item.id);
    if (!context.remaps.artifacts.has(artifactKey)) {
      context.remaps.artifacts.set(artifactKey, context.createId());
    }
  }
}

function remapAgentReference(
  context: ReplayContext,
  originalProjectId: string,
  agentId: string | undefined,
): string | undefined {
  if (agentId === undefined) return undefined;
  return context.remaps.agents.get(projectEntityMapKey(originalProjectId, agentId)) ?? agentId;
}

function remapMessageReference(
  context: ReplayContext,
  originalProjectId: string,
  originalTaskId: string | undefined,
  messageId: string | undefined,
): string | undefined {
  if (messageId === undefined) return undefined;
  return context.remaps.messages.get(messageMapKey(originalProjectId, originalTaskId, messageId)) ?? messageId;
}

function remapRetryContext(
  context: ReplayContext,
  input: unknown,
  originalProjectId: string,
  originalTaskId: string | undefined,
  targetProjectId: string,
  targetTaskId: string | undefined,
): SimpleChatMessage['retryContext'] | undefined {
  if (!isRecord(input)) return input === undefined ? undefined : cloneUnknown(input) as SimpleChatMessage['retryContext'];
  const value = cloneUnknown(input) as Record<string, unknown>;
  if (value.projectId === originalProjectId) value.projectId = targetProjectId;
  if (value.taskId === originalTaskId && targetTaskId !== undefined) value.taskId = targetTaskId;
  for (const key of ['userMessageId', 'assistantMessageId']) {
    const messageId = readString(value[key]);
    if (messageId !== undefined) {
      value[key] = remapMessageReference(context, originalProjectId, originalTaskId, messageId);
    }
  }
  if (Array.isArray(value.historyMessageIds)) {
    value.historyMessageIds = value.historyMessageIds.map(item => {
      const messageId = readString(item);
      return messageId === undefined
        ? cloneUnknown(item)
        : remapMessageReference(context, originalProjectId, originalTaskId, messageId);
    });
  }
  return value as unknown as SimpleChatMessage['retryContext'];
}

function remapKnownProjectEntity(
  remaps: Map<string, string>,
  originalProjectId: string,
  input: unknown,
): unknown {
  if (!isRecord(input)) return cloneUnknown(input);
  const value = cloneUnknown(input) as Record<string, unknown>;
  const originalId = readString(value.id) ?? '';
  value.id = remaps.get(projectEntityMapKey(originalProjectId, originalId)) ?? originalId;
  return value;
}

function hasRequiredParent(projects: SimpleChatProject[], operation: SimpleChatSyncOperation): boolean {
  switch (operation.entityType) {
    case 'project':
      return true;
    case 'task':
    case 'agent':
    case 'knowledge-item':
      return projects.some(project => project.id === operation.projectId);
    case 'message':
      return Boolean(findTask(projects, operation.projectId, operation.taskId));
    case 'artifact':
      return Boolean(findMessage(projects, operation.projectId, operation.taskId, operation.messageId));
  }
}

function flattenSimpleChatProjects(projects: SimpleChatProject[]): FlatEntity[] {
  const entities: FlatEntity[] = [];

  for (const project of projects) {
    entities.push(flatEntity('project', project.id, undefined, undefined, project.id, project));
    for (const task of project.tasks) {
      entities.push(flatEntity('task', project.id, task.id, undefined, task.id, task));
      for (const chatMessage of task.messages) {
        entities.push(flatEntity('message', project.id, task.id, chatMessage.id, chatMessage.id, chatMessage));
        for (const item of chatMessage.artifacts ?? []) {
          entities.push(flatEntity('artifact', project.id, task.id, chatMessage.id, item.id, item));
        }
      }
    }
    for (const agent of project.agents) {
      entities.push(flatEntity('agent', project.id, undefined, undefined, agent.id, agent));
    }
    for (const item of project.knowledgeItems) {
      entities.push(flatEntity('knowledge-item', project.id, undefined, undefined, item.id, item));
    }
  }
  return entities;
}

function flatEntity(
  entityType: SimpleChatEntityType,
  projectId: string,
  taskId: string | undefined,
  messageId: string | undefined,
  entityId: string,
  value: unknown,
): FlatEntity {
  return { entityType, projectId, taskId, messageId, entityId, value: cloneUnknown(value) };
}

function comparableEntityValue(entityType: SimpleChatEntityType, value: unknown): unknown {
  if (!isRecord(value)) return cloneUnknown(value);
  switch (entityType) {
    case 'project':
      return omitKeys(value, ['tasks', 'agents', 'knowledgeItems']);
    case 'task':
      return omitKeys(value, ['messages']);
    case 'message':
      return omitKeys(value, ['artifacts']);
    default:
      return cloneUnknown(value);
  }
}

function omitKeys(value: Record<string, unknown>, omitted: string[]): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  const omittedSet = new Set(omitted);
  for (const [key, item] of Object.entries(value)) {
    if (!omittedSet.has(key)) next[key] = cloneUnknown(item);
  }
  return next;
}

function createOperation(
  sequence: number,
  kind: 'upsert' | 'delete',
  entity: FlatEntity,
  baseValue: unknown,
  value: unknown,
  createOperationId: () => string,
): SimpleChatSyncOperation {
  const operationId = createOperationId();
  if (
    !UUID_PATTERN.test(operationId)
    || operationId.length > SIMPLE_CHAT_SYNC_LIMITS.idCharacters
  ) {
    throw new RangeError('createOperationId must return a valid UUID within the ID limit');
  }
  return {
    operationId,
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

function entityIdentity(
  entity: Pick<FlatEntity, 'entityType' | 'projectId' | 'taskId' | 'messageId' | 'entityId'>,
): string {
  return JSON.stringify([
    entity.entityType,
    entity.projectId,
    entity.taskId ?? null,
    entity.messageId ?? null,
    entity.entityId,
  ]);
}

function findEntity(
  projects: SimpleChatProject[],
  operation: SimpleChatSyncOperation,
): EntityReference | undefined {
  const project = projects.find(item => item.id === operation.projectId);
  if (operation.entityType === 'project') {
    const index = projects.findIndex(item => item.id === operation.entityId);
    if (index === -1) return undefined;
    return {
      entityType: 'project',
      project: projects[index],
      entity: projects[index],
      collection: projects,
      index,
    };
  }
  if (!project) return undefined;

  if (operation.entityType === 'task') {
    const index = project.tasks.findIndex(item => item.id === operation.entityId);
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
  if (operation.entityType === 'agent') {
    const index = project.agents.findIndex(item => item.id === operation.entityId);
    if (index === -1) return undefined;
    return {
      entityType: 'agent',
      project,
      entity: project.agents[index],
      collection: project.agents,
      index,
    };
  }
  if (operation.entityType === 'knowledge-item') {
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

  const task = project.tasks.find(item => item.id === operation.taskId);
  if (!task) return undefined;
  if (operation.entityType === 'message') {
    const index = task.messages.findIndex(item => item.id === operation.entityId);
    if (index === -1) return undefined;
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

  const chatMessage = task.messages.find(item => item.id === operation.messageId);
  if (!chatMessage?.artifacts) return undefined;
  const index = chatMessage.artifacts.findIndex(item => item.id === operation.entityId);
  if (index === -1) return undefined;
  return {
    entityType: 'artifact',
    project,
    task,
    message: chatMessage,
    entity: chatMessage.artifacts[index],
    collection: chatMessage.artifacts,
    index,
  };
}

function findTask(
  projects: SimpleChatProject[],
  projectId: string,
  taskId: string | undefined,
): SimpleChatTask | undefined {
  if (!taskId) return undefined;
  return projects.find(item => item.id === projectId)?.tasks.find(item => item.id === taskId);
}

function findMessage(
  projects: SimpleChatProject[],
  projectId: string,
  taskId: string | undefined,
  messageId: string | undefined,
): SimpleChatMessage | undefined {
  if (!messageId) return undefined;
  return findTask(projects, projectId, taskId)?.messages.find(item => item.id === messageId);
}

function materializeProject(value: Record<string, unknown>): SimpleChatProject {
  const source = cloneUnknown(value) as unknown as Partial<SimpleChatProject>;
  return {
    ...source,
    id: source.id ?? '',
    name: source.name ?? '未命名项目',
    createdAt: source.createdAt ?? 0,
    updatedAt: source.updatedAt ?? 0,
    tasks: Array.isArray(source.tasks) ? source.tasks : [],
    agents: Array.isArray(source.agents) ? source.agents : [],
    knowledgeItems: Array.isArray(source.knowledgeItems) ? source.knowledgeItems : [],
  };
}

function materializeTask(value: Record<string, unknown>, projectId: string): SimpleChatTask {
  const source = cloneUnknown(value) as unknown as Partial<SimpleChatTask>;
  const nextTask: SimpleChatTask = {
    ...source,
    id: source.id ?? '',
    projectId,
    name: source.name ?? '未命名对话',
    messages: Array.isArray(source.messages) ? source.messages : [],
    model: source.model ?? 'unknown',
    providerId: source.providerId ?? 'unknown',
    createdAt: source.createdAt ?? 0,
    updatedAt: source.updatedAt ?? 0,
  };
  nextTask.messages = nextTask.messages.map(item => {
    const nextMessage = materializeMessage(item as unknown as Record<string, unknown>);
    nextMessage.artifacts = (nextMessage.artifacts ?? []).map(artifact => ({
      ...artifact,
      projectId,
      taskId: nextTask.id,
    }));
    return nextMessage;
  });
  return nextTask;
}

function materializeMessage(value: Record<string, unknown>): SimpleChatMessage {
  const source = cloneUnknown(value) as unknown as Partial<SimpleChatMessage>;
  return {
    ...source,
    id: source.id ?? '',
    role: source.role ?? 'user',
    content: source.content ?? '',
    artifacts: Array.isArray(source.artifacts) ? source.artifacts : [],
    createdAt: source.createdAt ?? 0,
  };
}

function operationForDescendant(
  source: SimpleChatSyncOperation,
  entityType: SimpleChatEntityType,
  projectId: string,
  taskId: string | undefined,
  messageId: string | undefined,
  entityId: string,
): SimpleChatSyncOperation {
  return { ...source, entityType, projectId, taskId, messageId, entityId };
}

function conflictRecord(
  operation: SimpleChatSyncOperation,
  copyId: string,
): { operationId: string; entityType: SimpleChatEntityType; copyId: string } {
  return { operationId: operation.operationId, entityType: operation.entityType, copyId };
}

function metadataFor(
  operation: SimpleChatSyncOperation,
  sourceEntityType: SimpleChatEntityType,
  sourceEntityId: string,
  timestamp: number,
): SimpleChatConflictMetadata {
  const metadata: SimpleChatConflictMetadata = {
    operationId: operation.operationId,
    sourceEntityType,
    sourceEntityId,
    sourceProjectId: operation.projectId,
    conflictedAt: timestamp,
  };
  if (operation.taskId !== undefined) metadata.sourceTaskId = operation.taskId;
  if (operation.messageId !== undefined) metadata.sourceMessageId = operation.messageId;
  return metadata;
}

function tagConflictEntity(entity: object, metadata: SimpleChatConflictMetadata): void {
  (entity as Record<string, unknown>).syncConflict = metadata;
}

function resolveProjectId(context: ReplayContext, projectId: string): string {
  return context.remaps.projects.get(projectId) ?? projectId;
}

function resolveTaskId(
  context: ReplayContext,
  projectId: string,
  taskId: string | undefined,
): string | undefined {
  if (!taskId) return undefined;
  return context.remaps.tasks.get(taskMapKey(projectId, taskId)) ?? taskId;
}

function resolveMessageId(
  context: ReplayContext,
  projectId: string,
  taskId: string | undefined,
  messageId: string | undefined,
): string | undefined {
  if (!messageId) return undefined;
  return context.remaps.messages.get(messageMapKey(projectId, taskId, messageId)) ?? messageId;
}

function taskMapKey(projectId: string, taskId: string): string {
  return JSON.stringify([projectId, taskId]);
}

function messageMapKey(
  projectId: string,
  taskId: string | undefined,
  messageId: string,
): string {
  return JSON.stringify([projectId, taskId ?? null, messageId]);
}

function artifactMapKey(
  projectId: string,
  taskId: string | undefined,
  messageId: string | undefined,
  artifactId: string,
): string {
  return JSON.stringify([projectId, taskId ?? null, messageId ?? null, artifactId]);
}

function projectEntityMapKey(projectId: string, entityId: string): string {
  return JSON.stringify([projectId, entityId]);
}

function validateNamedEntity(value: Record<string, unknown>): SimpleChatProjectValidationResult | undefined {
  const idResult = validateIds(value);
  if (idResult) return idResult;
  for (const key of ['name', 'title']) {
    const text = value[key];
    if (typeof text === 'string' && text.length > SIMPLE_CHAT_SYNC_LIMITS.nameCharacters) {
      return limitValidation('name', SIMPLE_CHAT_SYNC_LIMITS.nameCharacters, text.length);
    }
  }
  return undefined;
}

function validateIds(value: Record<string, unknown>): SimpleChatProjectValidationResult | undefined {
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') continue;
    if ((key === 'id' || key.endsWith('Id')) && item.length > SIMPLE_CHAT_SYNC_LIMITS.idCharacters) {
      return limitValidation('id', SIMPLE_CHAT_SYNC_LIMITS.idCharacters, item.length);
    }
  }
  return undefined;
}

function inspectJsonValue(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  key?: string,
): JsonInspection {
  if (value === null || typeof value === 'boolean') return { valid: true, depth };
  if (typeof value === 'string') {
    const textBytes = utf8Bytes(value);
    if (key !== undefined && (key === 'id' || key.endsWith('Id')) && value.length > SIMPLE_CHAT_SYNC_LIMITS.idCharacters) {
      return {
        valid: true,
        depth,
        limitViolation: {
          field: 'id',
          limit: SIMPLE_CHAT_SYNC_LIMITS.idCharacters,
          actual: value.length,
        },
      };
    }
    if (
      key !== undefined
      && (key === 'name' || key.endsWith('Name') || key === 'title')
      && value.length > SIMPLE_CHAT_SYNC_LIMITS.nameCharacters
    ) {
      return {
        valid: true,
        depth,
        limitViolation: {
          field: 'name',
          limit: SIMPLE_CHAT_SYNC_LIMITS.nameCharacters,
          actual: value.length,
        },
      };
    }
    return {
      valid: true,
      depth,
      oversizedTextBytes: textBytes > SIMPLE_CHAT_SYNC_LIMITS.largeTextBytes ? textBytes : undefined,
    };
  }
  if (typeof value === 'number') return { valid: Number.isFinite(value), depth };
  if (typeof value !== 'object') return { valid: false, depth };
  if (ancestors.has(value)) return { valid: false, depth };

  if (Array.isArray(value)) {
    ancestors.add(value);
    let maxDepth = depth;
    let oversizedTextBytes: number | undefined;
    let limitViolation: JsonInspection['limitViolation'];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        ancestors.delete(value);
        return { valid: false, depth };
      }
      const result = inspectJsonValue(
        value[index],
        isJsonContainer(value[index]) ? depth + 1 : depth,
        ancestors,
        key,
      );
      if (!result.valid) {
        ancestors.delete(value);
        return result;
      }
      maxDepth = Math.max(maxDepth, result.depth);
      oversizedTextBytes = maxOptional(oversizedTextBytes, result.oversizedTextBytes);
      limitViolation ??= result.limitViolation;
    }
    ancestors.delete(value);
    return { valid: true, depth: maxDepth, oversizedTextBytes, limitViolation };
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return { valid: false, depth };
  ancestors.add(value);
  let maxDepth = depth;
  let oversizedTextBytes: number | undefined;
  let limitViolation: JsonInspection['limitViolation'];
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_JSON_KEYS.has(key)) {
      ancestors.delete(value);
      return { valid: false, depth };
    }
    const result = inspectJsonValue(item, isJsonContainer(item) ? depth + 1 : depth, ancestors, key);
    if (!result.valid) {
      ancestors.delete(value);
      return result;
    }
    maxDepth = Math.max(maxDepth, result.depth);
    oversizedTextBytes = maxOptional(oversizedTextBytes, result.oversizedTextBytes);
    limitViolation ??= result.limitViolation;
  }
  ancestors.delete(value);
  return { valid: true, depth: maxDepth, oversizedTextBytes, limitViolation };
}

function maxOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function isJsonContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function limitValidation(field: string, limit: number, actual: number): SimpleChatProjectValidationResult {
  return { success: false, code: 'CHAT_SYNC_LIMIT_EXCEEDED', field, limit, actual };
}

function invalidValidation(field: string): SimpleChatProjectValidationResult {
  return { success: false, code: 'CHAT_SYNC_INVALID_VALUE', field };
}

function cloneProjects(projects: SimpleChatProject[]): SimpleChatProject[] {
  return cloneUnknown(projects);
}

function cloneUnknown<T>(value: T): T {
  if (value === undefined || value === null || value === MISSING) return value;
  return structuredClone(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === MISSING || right === MISSING) return left === right;
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]));
  }
  return false;
}

function withConflictSuffix(value: string): string {
  if (value.includes(CONFLICT_MARKER) && value.length <= SIMPLE_CHAT_SYNC_LIMITS.nameCharacters) {
    return value;
  }
  const source = value.replace(CONFLICT_MARKER, '');
  const available = SIMPLE_CHAT_SYNC_LIMITS.nameCharacters - CONFLICT_MARKER.length;
  return `${truncateCharacters(source, available)}${CONFLICT_MARKER}`;
}

function withMessageConflictMarker(value: string): string {
  if (
    value.includes(MESSAGE_CONFLICT_MARKER)
    && utf8Bytes(value) <= SIMPLE_CHAT_SYNC_LIMITS.messageContentBytes
  ) {
    return value;
  }
  const source = value.replace(MESSAGE_CONFLICT_MARKER, '');
  const available = SIMPLE_CHAT_SYNC_LIMITS.messageContentBytes - utf8Bytes(MESSAGE_CONFLICT_MARKER);
  return `${MESSAGE_CONFLICT_MARKER}${truncateUtf8(source, available)}`;
}

function truncateCharacters(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  let end = maximum;
  const finalCode = value.charCodeAt(end - 1);
  if (finalCode >= 0xD800 && finalCode <= 0xDBFF) end -= 1;
  return value.slice(0, end);
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (utf8Bytes(value) <= maximumBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8Bytes(value.slice(0, middle)) <= maximumBytes) low = middle;
    else high = middle - 1;
  }
  let end = low;
  const finalCode = value.charCodeAt(end - 1);
  if (finalCode >= 0xD800 && finalCode <= 0xDBFF) end -= 1;
  return value.slice(0, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
