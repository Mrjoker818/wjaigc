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
  baseProjects: SimpleChatSyncedProject[];
  currentProjects: SimpleChatSyncedProject[];
  pendingOperations: SimpleChatSyncOperation[];
  updatedAt: number;
}

export interface SimpleChatConflictSourceReferences {
  activeAgentId?: string;
  parentMessageId?: string;
  retryContext?: SimpleChatMessage['retryContext'];
}

export interface SimpleChatConflictMetadata {
  operationId: string;
  sourceEntityType: SimpleChatEntityType;
  sourceEntityId: string;
  sourceProjectId: string;
  sourceTaskId?: string;
  sourceMessageId?: string;
  sourceReferences?: SimpleChatConflictSourceReferences;
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

interface RemappedRetryContext {
  value?: SimpleChatMessage['retryContext'];
  danglingSource?: SimpleChatMessage['retryContext'];
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
      sanitizeConflictEntityReferences(context, current, originalOperation, operation);
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
    const projectResult = validateProjectEntity(project);
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
      const agentResult = validateAgentEntity(agent);
      if (agentResult) return agentResult;
    }
    for (const knowledgeItem of project.knowledgeItems) {
      if (!isRecord(knowledgeItem)) return invalidValidation('knowledgeItems');
      const knowledgeResult = validateKnowledgeItemEntity(knowledgeItem);
      if (knowledgeResult) return knowledgeResult;
    }

    for (const task of project.tasks) {
      if (!isRecord(task)) return invalidValidation('tasks');
      const taskResult = validateTaskEntity(task);
      if (taskResult) return taskResult;
      if (!Array.isArray(task.messages)) return invalidValidation('messages');
      if (task.messages.length > SIMPLE_CHAT_SYNC_LIMITS.messagesPerTask) {
        return limitValidation('messages', SIMPLE_CHAT_SYNC_LIMITS.messagesPerTask, task.messages.length);
      }
      for (const chatMessage of task.messages) {
        if (!isRecord(chatMessage)) return invalidValidation('messages');
        const messageResult = validateMessageEntity(chatMessage);
        if (messageResult) return messageResult;
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
          const attachmentResult = validateAttachmentEntity(item);
          if (attachmentResult) return attachmentResult;
        }
        for (const item of artifacts) {
          if (!isRecord(item)) return invalidValidation('artifacts');
          const artifactResult = validateArtifactEntity(item);
          if (artifactResult) return artifactResult;
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

  const activeAgentId = remapAgentReference(
    context,
    operation.projectId,
    targetProjectId,
    source.activeAgentId,
  );
  const taskCopy: SimpleChatTask = {
    ...source,
    id: copyId,
    projectId: targetProjectId,
    name: withConflictSuffix(source.name),
    ...(activeAgentId === undefined ? {} : { activeAgentId }),
    messages,
    updatedAt: timestamp,
  };
  if (activeAgentId === undefined) delete taskCopy.activeAgentId;
  tagConflictEntity(taskCopy, metadataFor(operation, 'task', originalTaskId, timestamp));
  if (source.activeAgentId !== undefined && activeAgentId === undefined) {
    retainConflictSourceReferences(taskCopy, { activeAgentId: source.activeAgentId });
  }
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
    targetProjectId,
    targetTaskId,
    source.parentMessageId,
  );
  const remappedRetryContext = remapRetryContext(
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
    ...(remappedRetryContext.value === undefined ? {} : { retryContext: remappedRetryContext.value }),
    artifacts,
    createdAt: timestamp,
  };
  if (parentMessageId === undefined) delete messageCopy.parentMessageId;
  if (remappedRetryContext.value === undefined) delete messageCopy.retryContext;
  tagConflictEntity(messageCopy, metadataFor(operation, 'message', originalMessageId, timestamp));
  const danglingReferences: SimpleChatConflictSourceReferences = {};
  if (source.parentMessageId !== undefined && parentMessageId === undefined) {
    danglingReferences.parentMessageId = source.parentMessageId;
  }
  if (remappedRetryContext.danglingSource !== undefined) {
    danglingReferences.retryContext = remappedRetryContext.danglingSource;
  }
  retainConflictSourceReferences(messageCopy, danglingReferences);
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

function sanitizeConflictEntityReferences(
  context: ReplayContext,
  reference: EntityReference,
  original: SimpleChatSyncOperation,
  resolved: SimpleChatSyncOperation,
): void {
  const entity = reference.collection[reference.index];
  if (!isRecord(entity) || !isRecord(entity.syncConflict)) return;
  if (reference.entityType === 'task') {
    const activeAgentId = readString(entity.activeAgentId);
    if (activeAgentId === undefined) return;
    const remapped = remapAgentReference(context, original.projectId, resolved.projectId, activeAgentId);
    if (remapped === undefined) {
      delete entity.activeAgentId;
      retainConflictSourceReferences(entity, { activeAgentId });
    } else {
      entity.activeAgentId = remapped;
    }
    return;
  }
  if (reference.entityType !== 'message') return;

  const parentMessageId = readString(entity.parentMessageId);
  if (parentMessageId !== undefined) {
    const remapped = remapMessageReference(
      context,
      original.projectId,
      original.taskId,
      resolved.projectId,
      resolved.taskId,
      parentMessageId,
    );
    if (remapped === undefined) {
      delete entity.parentMessageId;
      retainConflictSourceReferences(entity, { parentMessageId });
    } else {
      entity.parentMessageId = remapped;
    }
  }
  if (Object.prototype.hasOwnProperty.call(entity, 'retryContext')) {
    const remapped = remapRetryContext(
      context,
      entity.retryContext,
      original.projectId,
      original.taskId,
      resolved.projectId,
      resolved.taskId,
    );
    if (remapped.value === undefined) delete entity.retryContext;
    else entity.retryContext = remapped.value;
    if (remapped.danglingSource !== undefined) {
      retainConflictSourceReferences(entity, { retryContext: remapped.danglingSource });
    }
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
    const remappedActiveAgentId = remapAgentReference(
      context,
      originalProjectId,
      targetProjectId,
      activeAgentId,
    );
    if (remappedActiveAgentId !== undefined) {
      value.activeAgentId = remappedActiveAgentId;
    }
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
    const remappedParentMessageId = remapMessageReference(
      context,
      originalProjectId,
      originalTaskId,
      targetProjectId,
      targetTaskId,
      parentMessageId,
    );
    if (remappedParentMessageId !== undefined) {
      value.parentMessageId = remappedParentMessageId;
    }
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
    if (retryContext.value !== undefined) value.retryContext = retryContext.value;
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
  targetProjectId: string,
  agentId: string | undefined,
): string | undefined {
  if (agentId === undefined) return undefined;
  const remapped = context.remaps.agents.get(projectEntityMapKey(originalProjectId, agentId));
  if (remapped !== undefined) return remapped;
  const targetProject = context.projects.find(project => project.id === targetProjectId);
  return targetProject?.agents.some(agent => agent.id === agentId) ? agentId : undefined;
}

function remapMessageReference(
  context: ReplayContext,
  originalProjectId: string,
  originalTaskId: string | undefined,
  targetProjectId: string,
  targetTaskId: string | undefined,
  messageId: string | undefined,
): string | undefined {
  if (messageId === undefined) return undefined;
  const remapped = context.remaps.messages.get(messageMapKey(originalProjectId, originalTaskId, messageId));
  if (remapped !== undefined) return remapped;
  return findTask(context.projects, targetProjectId, targetTaskId)?.messages.some(
    chatMessage => chatMessage.id === messageId,
  ) ? messageId : undefined;
}

function remapRetryContext(
  context: ReplayContext,
  input: unknown,
  originalProjectId: string,
  originalTaskId: string | undefined,
  targetProjectId: string,
  targetTaskId: string | undefined,
): RemappedRetryContext {
  if (input === undefined) return {};
  if (!isRecord(input)) {
    return { value: cloneUnknown(input) as SimpleChatMessage['retryContext'] };
  }
  const value = cloneUnknown(input) as Record<string, unknown>;
  if (value.projectId === originalProjectId) value.projectId = targetProjectId;
  if (value.taskId === originalTaskId && targetTaskId !== undefined) value.taskId = targetTaskId;
  for (const key of ['userMessageId', 'assistantMessageId']) {
    const messageId = readString(value[key]);
    const remapped = remapMessageReference(
      context,
      originalProjectId,
      originalTaskId,
      targetProjectId,
      targetTaskId,
      messageId,
    );
    if (remapped === undefined) {
      return {
        danglingSource: cloneUnknown(input) as unknown as SimpleChatMessage['retryContext'],
      };
    }
    value[key] = remapped;
  }
  let removedHistoryReference = false;
  if (Array.isArray(value.historyMessageIds)) {
    value.historyMessageIds = value.historyMessageIds.flatMap(item => {
      const messageId = readString(item);
      if (messageId === undefined) return [cloneUnknown(item)];
      const remapped = remapMessageReference(
        context,
        originalProjectId,
        originalTaskId,
        targetProjectId,
        targetTaskId,
        messageId,
      );
      if (remapped === undefined) {
        removedHistoryReference = true;
        return [];
      }
      return [remapped];
    });
  }
  return {
    value: value as unknown as SimpleChatMessage['retryContext'],
    ...(removedHistoryReference
      ? { danglingSource: cloneUnknown(input) as unknown as SimpleChatMessage['retryContext'] }
      : {}),
  };
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
    || codePointLength(operationId) > SIMPLE_CHAT_SYNC_LIMITS.idCharacters
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

function retainConflictSourceReferences(
  entity: object,
  references: SimpleChatConflictSourceReferences,
): void {
  if (Object.keys(references).length === 0) return;
  const value = entity as Record<string, unknown>;
  if (!isRecord(value.syncConflict)) return;
  const existing = isRecord(value.syncConflict.sourceReferences)
    ? value.syncConflict.sourceReferences
    : {};
  value.syncConflict.sourceReferences = { ...existing, ...cloneUnknown(references) };
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

function validateProjectEntity(value: Record<string, unknown>): SimpleChatProjectValidationResult | undefined {
  return firstValidation(
    validateRequiredId(value, 'id'),
    validateRequiredName(value, 'name'),
    validateOptionalString(value, 'description'),
    validateOptionalString(value, 'emoji'),
    validateRequiredNumber(value, 'createdAt'),
    validateRequiredNumber(value, 'updatedAt'),
    validateProjectInstructions(value.instructions),
    validateConflictMetadata(value.syncConflict),
  );
}

function validateTaskEntity(value: Record<string, unknown>): SimpleChatProjectValidationResult | undefined {
  return firstValidation(
    validateRequiredId(value, 'id'),
    validateRequiredId(value, 'projectId'),
    validateRequiredName(value, 'name'),
    validateRequiredString(value, 'model'),
    validateRequiredString(value, 'providerId'),
    validateOptionalString(value, 'imageModel'),
    validateOptionalId(value, 'imageProviderId'),
    validateOptionalString(value, 'reasoningEffort'),
    validateOptionalString(value, 'responseSpeed'),
    validateOptionalId(value, 'activeAgentId'),
    validateRequiredNumber(value, 'createdAt'),
    validateRequiredNumber(value, 'updatedAt'),
    validateOptionalRecord(value, 'appliedChatControls'),
    validateConflictMetadata(value.syncConflict),
  );
}

function validateMessageEntity(value: Record<string, unknown>): SimpleChatProjectValidationResult | undefined {
  const contentResult = validateRequiredString(value, 'content');
  if (contentResult) return contentResult;
  const contentBytes = utf8Bytes(value.content as string);
  if (contentBytes > SIMPLE_CHAT_SYNC_LIMITS.messageContentBytes) {
    return limitValidation('message.content', SIMPLE_CHAT_SYNC_LIMITS.messageContentBytes, contentBytes);
  }
  return firstValidation(
    validateRequiredId(value, 'id'),
    validateRequiredEnum(value, 'role', ['user', 'assistant', 'system', 'search']),
    validateRequiredNumber(value, 'createdAt'),
    validateOptionalStringArray(value, 'images'),
    validateOptionalRecordArray(value, 'imageRefs'),
    validateOptionalString(value, 'model'),
    validateOptionalId(value, 'providerId'),
    validateOptionalId(value, 'parentMessageId'),
    validateOptionalId(value, 'branchId'),
    validateOptionalId(value, 'agentRunId'),
    validateOptionalEnum(value, 'status', ['streaming', 'completed', 'failed']),
    validateMessageFailure(value.error),
    validateRetryContext(value.retryContext),
    validateConflictMetadata(value.syncConflict),
  );
}

function validateArtifactEntity(value: Record<string, unknown>): SimpleChatProjectValidationResult | undefined {
  const contentResult = validateRequiredString(value, 'content');
  if (contentResult) return contentResult;
  const contentBytes = utf8Bytes(value.content as string);
  if (contentBytes > SIMPLE_CHAT_SYNC_LIMITS.largeTextBytes) {
    return limitValidation('artifact.content', SIMPLE_CHAT_SYNC_LIMITS.largeTextBytes, contentBytes);
  }
  return firstValidation(
    validateRequiredId(value, 'id'),
    validateRequiredId(value, 'projectId'),
    validateRequiredId(value, 'taskId'),
    validateRequiredName(value, 'title'),
    validateRequiredEnum(value, 'type', ['markdown', 'html', 'table', 'json', 'prompt', 'code', 'document']),
    validateRequiredNumber(value, 'version'),
    validateRequiredNumber(value, 'createdAt'),
    validateRequiredNumber(value, 'updatedAt'),
    validateConflictMetadata(value.syncConflict),
  );
}

function validateAgentEntity(value: Record<string, unknown>): SimpleChatProjectValidationResult | undefined {
  return firstValidation(
    validateRequiredId(value, 'id'),
    validateRequiredName(value, 'name'),
    validateRequiredString(value, 'description'),
    validateRequiredString(value, 'systemPrompt'),
    validateOptionalString(value, 'emoji'),
    validateRequiredEnumArray(value, 'tools', [
      'web_search',
      'generate_image',
      'edit_image',
      'analyze_image',
      'analyze_file',
      'deep_research',
    ]),
    validateOptionalString(value, 'defaultChatModel'),
    validateOptionalId(value, 'defaultChatProviderId'),
    validateOptionalString(value, 'defaultImageModel'),
    validateOptionalId(value, 'defaultImageProviderId'),
    validateOptionalBoolean(value, 'allowWebSearch'),
    validateOptionalBoolean(value, 'allowDeepResearch'),
    validateOptionalBoolean(value, 'allowImageGeneration'),
    validateOptionalBoolean(value, 'allowImageEdit'),
    validateOptionalEnum(value, 'knowledgeScope', ['none', 'project', 'selected']),
    validateRequiredNumber(value, 'createdAt'),
    validateRequiredNumber(value, 'updatedAt'),
    validateConflictMetadata(value.syncConflict),
  );
}

function validateKnowledgeItemEntity(value: Record<string, unknown>): SimpleChatProjectValidationResult | undefined {
  return firstValidation(
    validateRequiredId(value, 'id'),
    validateRequiredId(value, 'projectId'),
    validateRequiredEnum(value, 'type', ['file', 'image', 'url', 'note']),
    validateRequiredName(value, 'name'),
    validateOptionalString(value, 'mimeType'),
    validateOptionalString(value, 'url'),
    validateOptionalString(value, 'textContent'),
    validateOptionalString(value, 'summary'),
    validateRequiredStringArray(value, 'tags'),
    validateRequiredBoolean(value, 'enabled'),
    validateRequiredNumber(value, 'createdAt'),
    validateRequiredNumber(value, 'updatedAt'),
    validateConflictMetadata(value.syncConflict),
  );
}

function validateAttachmentEntity(value: Record<string, unknown>): SimpleChatProjectValidationResult | undefined {
  return firstValidation(
    validateRequiredId(value, 'id'),
    validateRequiredEnum(value, 'type', ['file', 'image']),
    validateRequiredName(value, 'name'),
    validateRequiredString(value, 'mimeType'),
    validateOptionalString(value, 'url'),
    validateOptionalId(value, 'assetId'),
    validateOptionalId(value, 'assetVersionId'),
    validateOptionalId(value, 'placementId'),
    validateOptionalString(value, 'textContent'),
    validateOptionalString(value, 'summary'),
  );
}

function validateProjectInstructions(value: unknown): SimpleChatProjectValidationResult | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalidValidation('value');
  return firstValidation(
    validateRequiredString(value, 'projectBackground'),
    validateRequiredString(value, 'userPreference'),
    validateRequiredString(value, 'outputFormat'),
    validateRequiredString(value, 'styleRules'),
    validateRequiredString(value, 'forbiddenRules'),
    validateRequiredEnum(value, 'language', ['zh-CN', 'en', 'auto']),
  );
}

function validateMessageFailure(value: unknown): SimpleChatProjectValidationResult | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalidValidation('value');
  return firstValidation(
    validateOptionalString(value, 'code'),
    validateRequiredString(value, 'message'),
    validateRequiredBoolean(value, 'retryable'),
  );
}

function validateRetryContext(value: unknown): SimpleChatProjectValidationResult | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalidValidation('value');
  return firstValidation(
    value.version === 1 ? undefined : invalidValidation('value'),
    validateRequiredEnum(value, 'kind', ['chat', 'deep-research']),
    validateRequiredId(value, 'projectId'),
    validateRequiredId(value, 'taskId'),
    validateRequiredId(value, 'userMessageId'),
    validateRequiredId(value, 'assistantMessageId'),
    validateRequiredString(value, 'idempotencyKey'),
    validateRequiredId(value, 'modelId'),
    validateRequiredId(value, 'providerId'),
    validateOptionalId(value, 'imageModelId'),
    validateOptionalId(value, 'imageProviderId'),
    validateRequiredBoolean(value, 'webSearch'),
    validateOptionalString(value, 'reasoningEffort'),
    validateOptionalString(value, 'responseSpeed'),
    validateOptionalId(value, 'canvasProjectId'),
    validateRequiredIdArray(value, 'sourceVersionIds'),
    validateRequiredIdArray(value, 'selectedEntityIds'),
    validateRequiredIdArray(value, 'historyMessageIds'),
    validateRetrySystemMessages(value.systemMessages),
    validateRetryKnowledgeItems(value.knowledgeItems),
    validateRetryMemories(value.memories),
    validateOptionalString(value, 'query'),
    validateOptionalBoolean(value, 'deepAnalysis'),
    validateOptionalEnum(value, 'depth', ['quick', 'standard', 'deep']),
  );
}

function validateRetrySystemMessages(value: unknown): SimpleChatProjectValidationResult | undefined {
  if (!Array.isArray(value)) return invalidValidation('value');
  for (const item of value) {
    if (!isRecord(item)) return invalidValidation('value');
    const result = firstValidation(
      item.role === 'system' ? undefined : invalidValidation('value'),
      validateRequiredString(item, 'content'),
    );
    if (result) return result;
  }
  return undefined;
}

function validateRetryKnowledgeItems(value: unknown): SimpleChatProjectValidationResult | undefined {
  if (!Array.isArray(value)) return invalidValidation('value');
  for (const item of value) {
    if (!isRecord(item)) return invalidValidation('value');
    const result = firstValidation(
      validateRequiredId(item, 'id'),
      validateRequiredString(item, 'type'),
      validateRequiredName(item, 'title'),
      validateRequiredString(item, 'content'),
    );
    if (result) return result;
  }
  return undefined;
}

function validateRetryMemories(value: unknown): SimpleChatProjectValidationResult | undefined {
  if (!Array.isArray(value)) return invalidValidation('value');
  for (const item of value) {
    if (!isRecord(item)) return invalidValidation('value');
    const result = firstValidation(
      validateRequiredString(item, 'category'),
      validateRequiredString(item, 'content'),
    );
    if (result) return result;
  }
  return undefined;
}

function validateConflictMetadata(value: unknown): SimpleChatProjectValidationResult | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalidValidation('value');
  const references = value.sourceReferences;
  let referencesResult: SimpleChatProjectValidationResult | undefined;
  if (references !== undefined) {
    if (!isRecord(references)) return invalidValidation('value');
    referencesResult = firstValidation(
      validateOptionalId(references, 'activeAgentId'),
      validateOptionalId(references, 'parentMessageId'),
      validateRetryContext(references.retryContext),
    );
  }
  return firstValidation(
    validateRequiredId(value, 'operationId'),
    validateRequiredEnum(value, 'sourceEntityType', [
      'project', 'task', 'message', 'artifact', 'agent', 'knowledge-item',
    ]),
    validateRequiredId(value, 'sourceEntityId'),
    validateRequiredId(value, 'sourceProjectId'),
    validateOptionalId(value, 'sourceTaskId'),
    validateOptionalId(value, 'sourceMessageId'),
    validateRequiredNumber(value, 'conflictedAt'),
    referencesResult,
  );
}

function validateRequiredId(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  const result = validateRequiredString(value, key);
  if (result) return result;
  return validateStringLimit(value[key] as string, 'id', SIMPLE_CHAT_SYNC_LIMITS.idCharacters);
}

function validateOptionalId(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  if (value[key] === undefined) return undefined;
  return validateRequiredId(value, key);
}

function validateRequiredName(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  const result = validateRequiredString(value, key);
  if (result) return result;
  return validateStringLimit(value[key] as string, 'name', SIMPLE_CHAT_SYNC_LIMITS.nameCharacters);
}

function validateRequiredString(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return typeof value[key] === 'string' ? undefined : invalidValidation('value');
}

function validateOptionalString(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return value[key] === undefined ? undefined : validateRequiredString(value, key);
}

function validateRequiredNumber(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return typeof value[key] === 'number' && Number.isFinite(value[key])
    ? undefined
    : invalidValidation('value');
}

function validateRequiredBoolean(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return typeof value[key] === 'boolean' ? undefined : invalidValidation('value');
}

function validateOptionalBoolean(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return value[key] === undefined ? undefined : validateRequiredBoolean(value, key);
}

function validateRequiredEnum(
  value: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): SimpleChatProjectValidationResult | undefined {
  return typeof value[key] === 'string' && allowed.includes(value[key] as string)
    ? undefined
    : invalidValidation('value');
}

function validateOptionalEnum(
  value: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): SimpleChatProjectValidationResult | undefined {
  return value[key] === undefined ? undefined : validateRequiredEnum(value, key, allowed);
}

function validateRequiredStringArray(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return Array.isArray(value[key]) && value[key].every(item => typeof item === 'string')
    ? undefined
    : invalidValidation('value');
}

function validateOptionalStringArray(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return value[key] === undefined ? undefined : validateRequiredStringArray(value, key);
}

function validateRequiredIdArray(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  const typeResult = validateRequiredStringArray(value, key);
  if (typeResult) return typeResult;
  for (const item of value[key] as string[]) {
    const limitResult = validateStringLimit(item, 'id', SIMPLE_CHAT_SYNC_LIMITS.idCharacters);
    if (limitResult) return limitResult;
  }
  return undefined;
}

function validateRequiredEnumArray(
  value: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): SimpleChatProjectValidationResult | undefined {
  return Array.isArray(value[key])
    && value[key].every(item => typeof item === 'string' && allowed.includes(item))
    ? undefined
    : invalidValidation('value');
}

function validateOptionalRecordArray(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return value[key] === undefined
    || (Array.isArray(value[key]) && value[key].every(item => isRecord(item)))
    ? undefined
    : invalidValidation('value');
}

function validateOptionalRecord(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return value[key] === undefined || isRecord(value[key]) ? undefined : invalidValidation('value');
}

function validateStringLimit(
  value: string,
  field: 'id' | 'name',
  limit: number,
): SimpleChatProjectValidationResult | undefined {
  const actual = codePointLength(value);
  return actual > limit ? limitValidation(field, limit, actual) : undefined;
}

function firstValidation(
  ...results: Array<SimpleChatProjectValidationResult | undefined>
): SimpleChatProjectValidationResult | undefined {
  return results.find(result => result !== undefined);
}

function inspectJsonValue(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  key?: string,
): JsonInspection {
  interface InspectionFrame {
    value?: unknown;
    depth: number;
    key?: string;
    exit?: object;
  }

  const stack: InspectionFrame[] = [{ value, depth, key }];
  let maxDepth = depth;
  let oversizedTextBytes: number | undefined;
  let limitViolation: JsonInspection['limitViolation'];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.exit !== undefined) {
      ancestors.delete(frame.exit);
      continue;
    }
    const item = frame.value;
    maxDepth = Math.max(maxDepth, frame.depth);
    if (frame.depth > SIMPLE_CHAT_SYNC_LIMITS.jsonDepth) {
      return { valid: true, depth: frame.depth };
    }
    if (item === null || typeof item === 'boolean') continue;
    if (typeof item === 'string') {
      const textBytes = utf8Bytes(item);
      if (textBytes > SIMPLE_CHAT_SYNC_LIMITS.largeTextBytes) {
        oversizedTextBytes = Math.max(oversizedTextBytes ?? 0, textBytes);
      }
      if (frame.key !== undefined && isIdFieldKey(frame.key)) {
        const actual = codePointLength(item);
        if (actual > SIMPLE_CHAT_SYNC_LIMITS.idCharacters) {
          limitViolation ??= {
            field: 'id',
            limit: SIMPLE_CHAT_SYNC_LIMITS.idCharacters,
            actual,
          };
        }
      }
      if (frame.key !== undefined && isNameFieldKey(frame.key)) {
        const actual = codePointLength(item);
        if (actual > SIMPLE_CHAT_SYNC_LIMITS.nameCharacters) {
          limitViolation ??= {
            field: 'name',
            limit: SIMPLE_CHAT_SYNC_LIMITS.nameCharacters,
            actual,
          };
        }
      }
      continue;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) return { valid: false, depth: frame.depth };
      continue;
    }
    if (typeof item !== 'object') return { valid: false, depth: frame.depth };
    if (ancestors.has(item)) return { valid: false, depth: frame.depth };

    if (Array.isArray(item)) {
      if (frame.key !== undefined && frame.key.endsWith('Ids')) {
        if (item.some(arrayItem => typeof arrayItem !== 'string')) {
          return { valid: false, depth: frame.depth };
        }
      }
      for (let index = 0; index < item.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(item, index)) {
          return { valid: false, depth: frame.depth };
        }
      }
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        return { valid: false, depth: frame.depth };
      }
      if (Object.keys(item).some(itemKey => UNSAFE_JSON_KEYS.has(itemKey))) {
        return { valid: false, depth: frame.depth };
      }
    }

    ancestors.add(item);
    stack.push({ depth: frame.depth, exit: item });
    const entries = Array.isArray(item)
      ? item.map(arrayItem => [frame.key, arrayItem] as const)
      : Object.entries(item);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [childKey, child] = entries[index];
      const childDepth = typeof child === 'object' && child !== null
        ? frame.depth + 1
        : frame.depth;
      stack.push({ value: child, depth: childDepth, key: childKey });
    }
  }

  return { valid: true, depth: maxDepth, oversizedTextBytes, limitViolation };
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
  if (
    value.includes(CONFLICT_MARKER)
    && codePointLength(value) <= SIMPLE_CHAT_SYNC_LIMITS.nameCharacters
  ) {
    return value;
  }
  const source = value.replace(CONFLICT_MARKER, '');
  const available = SIMPLE_CHAT_SYNC_LIMITS.nameCharacters - codePointLength(CONFLICT_MARKER);
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
  if (codePointLength(value) <= maximum) return value;
  return Array.from(value).slice(0, maximum).join('');
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

function isIdFieldKey(key: string): boolean {
  return key === 'id' || key.endsWith('Id') || key.endsWith('Ids');
}

function isNameFieldKey(key: string): boolean {
  return key === 'name' || key.endsWith('Name') || key === 'title';
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
