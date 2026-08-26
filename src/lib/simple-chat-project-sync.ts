import type {
  ChatArtifact,
  ProjectKnowledgeItem,
  ProjectInstructions,
  SimpleChatAgent,
  SimpleChatMessage,
  SimpleChatProject,
  SimpleChatTask,
} from '@/components/simple-chat/simple-chat-types';
import {
  normalizeReasoningEffort,
  normalizeResponseSpeed,
} from '@/lib/chat-generation-controls';

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

export interface SimpleChatReplayOptions {
  createId?: () => string;
  now?: () => number;
  localProjects?: SimpleChatProject[];
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

export type SimpleChatConflictReferenceOrigin = 'local' | 'remote' | 'self';

export interface SimpleChatConflictRetryReferenceOrigins {
  projectId?: SimpleChatConflictReferenceOrigin;
  taskId?: SimpleChatConflictReferenceOrigin;
  userMessageId?: SimpleChatConflictReferenceOrigin;
  assistantMessageId?: SimpleChatConflictReferenceOrigin;
  historyMessageIds?: SimpleChatConflictReferenceOrigin[];
}

export interface SimpleChatConflictSourceReferenceOrigins {
  activeAgentId?: SimpleChatConflictReferenceOrigin;
  parentMessageId?: SimpleChatConflictReferenceOrigin;
  retryContext?: SimpleChatConflictRetryReferenceOrigins;
}

export interface SimpleChatConflictMetadata {
  operationId: string;
  sourceEntityType: SimpleChatEntityType;
  sourceEntityId: string;
  sourceProjectId: string;
  sourceTaskId?: string;
  sourceMessageId?: string;
  sourceReferences?: SimpleChatConflictSourceReferences;
  sourceReferenceOrigins?: SimpleChatConflictSourceReferenceOrigins;
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

export interface SimpleChatDuplicateIdentityDetails {
  code: 'CHAT_SYNC_DUPLICATE_ID';
  field: string;
  entityType: SimpleChatEntityType;
  entityId: string;
  projectId?: string;
  taskId?: string;
  messageId?: string;
}

export class SimpleChatSyncDomainError extends Error {
  readonly code: SimpleChatDuplicateIdentityDetails['code'];
  readonly field: string;
  readonly entityType: SimpleChatEntityType;
  readonly entityId: string;
  readonly projectId?: string;
  readonly taskId?: string;
  readonly messageId?: string;

  constructor(
    details: SimpleChatDuplicateIdentityDetails,
    readonly snapshot: 'base' | 'current',
  ) {
    super(`Duplicate ${details.entityType} id ${details.entityId} in ${snapshot} projects`);
    this.name = 'SimpleChatSyncDomainError';
    this.code = details.code;
    this.field = details.field;
    this.entityType = details.entityType;
    this.entityId = details.entityId;
    this.projectId = details.projectId;
    this.taskId = details.taskId;
    this.messageId = details.messageId;
  }
}

export type SimpleChatProjectValidationResult =
  | { success: true }
  | {
    success: false;
    code: 'CHAT_SYNC_LIMIT_EXCEEDED' | 'CHAT_SYNC_INVALID_VALUE';
    field: string;
    limit?: number;
    actual?: number;
  }
  | ({ success: false } & SimpleChatDuplicateIdentityDetails);

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
  existingConflictCopies: Map<string, string>;
  localProjectsById: Map<string, SimpleChatProject>;
  localReferenceClosures: LocalReferenceClosure[];
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

interface LocalRetryReferenceSources {
  projectId?: true;
  taskId?: true;
  userMessageId?: true;
  assistantMessageId?: true;
  historyMessageIds?: true;
}

interface LocalReferenceClosure {
  entity: Record<string, unknown>;
  entityType: 'task' | 'message';
  projectId: string;
  taskId?: string;
  activeAgentId?: true;
  parentMessageId?: true;
  retryContext?: LocalRetryReferenceSources;
}

type ConflictReferenceSource = SimpleChatConflictReferenceOrigin;

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
  assertUniqueSimpleChatIdentities(base, 'base');
  assertUniqueSimpleChatIdentities(current, 'current');
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

  return stableSortSimpleChatOperations([...compacted.values()]);
}

function stableSortSimpleChatOperations(
  operations: SimpleChatSyncOperation[],
): SimpleChatSyncOperation[] {
  if (operations.length < 2) return operations;

  const projectOperations = new Map<string, number>();
  const taskOperations = new Map<string, number>();
  const messageOperations = new Map<string, number>();
  operations.forEach((operation, index) => {
    switch (operation.entityType) {
      case 'project':
        projectOperations.set(operation.projectId, index);
        break;
      case 'task':
        taskOperations.set(taskMapKey(operation.projectId, operation.entityId), index);
        break;
      case 'message':
        messageOperations.set(
          messageMapKey(operation.projectId, operation.taskId, operation.entityId),
          index,
        );
        break;
      default:
        break;
    }
  });

  const indegrees = new Array<number>(operations.length).fill(0);
  const dependents = Array.from({ length: operations.length }, () => [] as number[]);
  operations.forEach((operation, index) => {
    const dependencies = new Set<number>();
    if (operation.entityType !== 'project') {
      addOperationDependency(dependencies, projectOperations.get(operation.projectId), index);
    }
    if (operation.entityType === 'message' || operation.entityType === 'artifact') {
      if (operation.taskId !== undefined) {
        addOperationDependency(
          dependencies,
          taskOperations.get(taskMapKey(operation.projectId, operation.taskId)),
          index,
        );
      }
    }
    if (operation.entityType === 'artifact' && operation.messageId !== undefined) {
      addOperationDependency(
        dependencies,
        messageOperations.get(messageMapKey(operation.projectId, operation.taskId, operation.messageId)),
        index,
      );
    }
    indegrees[index] = dependencies.size;
    for (const dependency of dependencies) dependents[dependency].push(index);
  });

  const ready: number[] = [];
  indegrees.forEach((indegree, index) => {
    if (indegree === 0) pushMinHeap(ready, index);
  });
  const sorted: SimpleChatSyncOperation[] = [];
  while (ready.length > 0) {
    const index = popMinHeap(ready);
    sorted.push(operations[index]);
    for (const dependent of dependents[index]) {
      indegrees[dependent] -= 1;
      if (indegrees[dependent] === 0) pushMinHeap(ready, dependent);
    }
  }
  return sorted;
}

function addOperationDependency(
  dependencies: Set<number>,
  dependency: number | undefined,
  operationIndex: number,
): void {
  if (dependency !== undefined && dependency !== operationIndex) dependencies.add(dependency);
}

function pushMinHeap(heap: number[], value: number): void {
  let index = heap.length;
  heap.push(value);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent] <= value) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = value;
}

function popMinHeap(heap: number[]): number {
  const first = heap[0];
  const last = heap.pop()!;
  if (heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right] < heap[left] ? right : left;
    if (heap[child] >= last) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

export function replaySimpleChatOperations(
  remote: SimpleChatProject[],
  operations: SimpleChatSyncOperation[],
  options?: SimpleChatReplayOptions,
): SimpleChatReplayResult {
  const compactedOperations = compactSimpleChatOperations(operations);
  const context: ReplayContext = {
    projects: cloneProjects(remote),
    conflicts: [],
    createId: options?.createId ?? (() => crypto.randomUUID()),
    now: options?.now ?? (() => Date.now()),
    remaps: createReplayIdRemaps(),
    existingConflictCopies: new Map(),
    localProjectsById: new Map(
      (options?.localProjects ?? []).map(project => [project.id, project]),
    ),
    localReferenceClosures: [],
  };
  indexExistingReplayConflicts(context, compactedOperations);

  for (const originalOperation of compactedOperations) {
    const operation = resolveOperation(context, originalOperation);
    if (operation.kind === 'delete') {
      replayDelete(context.projects, operation);
      continue;
    }

    const existingCopyId = existingConflictCopyId(context, originalOperation);
    if (existingCopyId !== undefined) {
      context.conflicts.push(conflictRecord(originalOperation, existingCopyId));
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
      replaceProjectedEntity(
        current,
        comparableEntityValue(operation.entityType, localValue),
        localValue,
      );
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
      replaceProjectedEntity(current, merge.value, localValue);
      trackLocallyMergedReferences(
        context,
        current.collection[current.index],
        originalOperation,
        current.entity,
      );
      continue;
    }

    const conflictValue = applyProjectionToValue(localValue, merge.value, originalOperation.entityType);
    const conflict = createConflictCopy(context, originalOperation, conflictValue, current);
    if (conflict) context.conflicts.push(conflict);
  }

  closeConflictEntityReferences(context);
  closeLocallyMergedReferences(context);
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
  const collectionLimitResult = preflightSimpleChatCollectionLimits(projects);
  if (collectionLimitResult) return collectionLimitResult;
  const duplicate = findDuplicateSimpleChatIdentity(projects);
  if (duplicate) return { success: false, ...duplicate };

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

function preflightSimpleChatCollectionLimits(
  projects: SimpleChatProject[],
): SimpleChatProjectValidationResult | undefined {
  for (const project of projects) {
    if (!isRecord(project)) return invalidValidation('projects');
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

    for (const task of project.tasks) {
      if (!isRecord(task)) return invalidValidation('tasks');
      if (!Array.isArray(task.messages)) return invalidValidation('messages');
      if (task.messages.length > SIMPLE_CHAT_SYNC_LIMITS.messagesPerTask) {
        return limitValidation('messages', SIMPLE_CHAT_SYNC_LIMITS.messagesPerTask, task.messages.length);
      }
      for (const chatMessage of task.messages) {
        if (!isRecord(chatMessage)) return invalidValidation('messages');
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
          return limitValidation(
            'attachments',
            SIMPLE_CHAT_SYNC_LIMITS.attachmentsPerMessage,
            attachments.length,
          );
        }
      }
    }
  }
  return undefined;
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

function indexExistingReplayConflicts(
  context: ReplayContext,
  operations: SimpleChatSyncOperation[],
): void {
  const operationIds = new Set(operations.map(operation => operation.operationId));
  const indexEntity = (
    entity: object,
    entityType: SimpleChatEntityType,
    copyId: string,
  ): void => {
    const metadata = (entity as SimpleChatConflictTagged).syncConflict;
    if (
      !metadata
      || metadata.sourceEntityType !== entityType
      || !operationIds.has(metadata.operationId)
    ) return;

    const scopeKey = conflictSourceScopeKey(
      metadata.operationId,
      metadata.sourceEntityType,
      metadata.sourceProjectId,
      metadata.sourceTaskId,
      metadata.sourceMessageId,
      metadata.sourceEntityId,
    );
    if (!context.existingConflictCopies.has(scopeKey)) {
      context.existingConflictCopies.set(scopeKey, copyId);
    }
    indexExistingConflictRemap(context.remaps, metadata, copyId);
  };

  for (const project of context.projects) {
    indexEntity(project, 'project', project.id);
    for (const task of project.tasks) {
      indexEntity(task, 'task', task.id);
      for (const chatMessage of task.messages) {
        indexEntity(chatMessage, 'message', chatMessage.id);
        for (const item of chatMessage.artifacts ?? []) {
          indexEntity(item, 'artifact', item.id);
        }
      }
    }
    for (const agent of project.agents) indexEntity(agent, 'agent', agent.id);
    for (const item of project.knowledgeItems) indexEntity(item, 'knowledge-item', item.id);
  }
}

function indexExistingConflictRemap(
  remaps: ReplayIdRemaps,
  metadata: SimpleChatConflictMetadata,
  copyId: string,
): void {
  switch (metadata.sourceEntityType) {
    case 'project':
      if (!remaps.projects.has(metadata.sourceEntityId)) {
        remaps.projects.set(metadata.sourceEntityId, copyId);
      }
      return;
    case 'task': {
      const key = taskMapKey(metadata.sourceProjectId, metadata.sourceEntityId);
      if (!remaps.tasks.has(key)) remaps.tasks.set(key, copyId);
      return;
    }
    case 'message': {
      const key = messageMapKey(
        metadata.sourceProjectId,
        metadata.sourceTaskId,
        metadata.sourceEntityId,
      );
      if (!remaps.messages.has(key)) remaps.messages.set(key, copyId);
      return;
    }
    case 'artifact': {
      const key = artifactMapKey(
        metadata.sourceProjectId,
        metadata.sourceTaskId,
        metadata.sourceMessageId,
        metadata.sourceEntityId,
      );
      if (!remaps.artifacts.has(key)) remaps.artifacts.set(key, copyId);
      return;
    }
    case 'agent': {
      const key = projectEntityMapKey(metadata.sourceProjectId, metadata.sourceEntityId);
      if (!remaps.agents.has(key)) remaps.agents.set(key, copyId);
      return;
    }
    case 'knowledge-item': {
      const key = projectEntityMapKey(metadata.sourceProjectId, metadata.sourceEntityId);
      if (!remaps.knowledgeItems.has(key)) remaps.knowledgeItems.set(key, copyId);
    }
  }
}

function existingConflictCopyId(
  context: ReplayContext,
  operation: SimpleChatSyncOperation,
): string | undefined {
  return context.existingConflictCopies.get(conflictSourceScopeKey(
    operation.operationId,
    operation.entityType,
    operation.projectId,
    operation.taskId,
    operation.messageId,
    operation.entityId,
  ));
}

function conflictSourceScopeKey(
  operationId: string,
  entityType: SimpleChatEntityType,
  projectId: string,
  taskId: string | undefined,
  messageId: string | undefined,
  entityId: string,
): string {
  return JSON.stringify([
    operationId,
    entityType,
    projectId,
    taskId ?? null,
    messageId ?? null,
    entityId,
  ]);
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
  const existingCopyId = existingConflictCopyId(context, operation);
  if (existingCopyId !== undefined) return conflictRecord(operation, existingCopyId);
  const timestamp = context.now();
  const restoredCopyId = restoreCompleteConflictAncestor(context, operation, timestamp);
  if (restoredCopyId !== undefined) return conflictRecord(operation, restoredCopyId);

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
      preserveRemoteConflictReferences(taskCopy, operation, current?.entity);
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
      preserveRemoteConflictReferences(messageCopy, operation, current?.entity);
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

function restoreCompleteConflictAncestor(
  context: ReplayContext,
  operation: SimpleChatSyncOperation,
  timestamp: number,
): string | undefined {
  const localProject = context.localProjectsById.get(operation.projectId);
  if (!localProject || localProject.id !== operation.projectId || operation.entityType === 'project') {
    return undefined;
  }

  const targetProjectId = resolveProjectId(context, operation.projectId);
  const targetProject = context.projects.find(project => project.id === targetProjectId);
  if (!targetProject) {
    const projectCopy = cloneConflictProject(
      context,
      localProject as unknown as Record<string, unknown>,
      operation,
      timestamp,
    );
    context.projects.push(projectCopy);
    return conflictCopyIdForOperation(context, operation);
  }

  const originalTaskId = operation.entityType === 'task' ? operation.entityId : operation.taskId;
  const sourceTask = localProject.tasks.find(task => task.id === originalTaskId);
  if (sourceTask && (operation.entityType === 'task'
    || operation.entityType === 'message'
    || operation.entityType === 'artifact')) {
    const targetTaskId = resolveTaskId(context, operation.projectId, originalTaskId);
    const targetTask = targetProject.tasks.find(task => task.id === targetTaskId);
    if (!targetTask) {
      const taskCopy = cloneConflictTask(
        context,
        sourceTask as unknown as Record<string, unknown>,
        operationForDescendant(
          operation,
          'task',
          operation.projectId,
          sourceTask.id,
          undefined,
          sourceTask.id,
        ),
        targetProject.id,
        timestamp,
      );
      targetProject.tasks.push(taskCopy);
      targetProject.updatedAt = timestamp;
      return conflictCopyIdForOperation(context, operation);
    }

    const originalMessageId = operation.entityType === 'message'
      ? operation.entityId
      : operation.messageId;
    const sourceMessage = sourceTask.messages.find(message => message.id === originalMessageId);
    if (sourceMessage && (operation.entityType === 'message' || operation.entityType === 'artifact')) {
      const targetMessageId = resolveMessageId(
        context,
        operation.projectId,
        originalTaskId,
        originalMessageId,
      );
      const targetMessage = targetTask.messages.find(message => message.id === targetMessageId);
      if (!targetMessage) {
        const messageCopy = cloneConflictMessage(
          context,
          sourceMessage as unknown as Record<string, unknown>,
          operationForDescendant(
            operation,
            'message',
            operation.projectId,
            originalTaskId,
            sourceMessage.id,
            sourceMessage.id,
          ),
          targetProject.id,
          targetTask.id,
          timestamp,
        );
        targetTask.messages.push(messageCopy);
        targetTask.updatedAt = timestamp;
        return conflictCopyIdForOperation(context, operation);
      }
    }
  }

  return undefined;
}

function conflictCopyIdForOperation(
  context: ReplayContext,
  operation: SimpleChatSyncOperation,
): string | undefined {
  switch (operation.entityType) {
    case 'project':
      return context.remaps.projects.get(operation.projectId);
    case 'task':
      return context.remaps.tasks.get(taskMapKey(operation.projectId, operation.entityId));
    case 'message':
      return context.remaps.messages.get(messageMapKey(
        operation.projectId,
        operation.taskId,
        operation.entityId,
      ));
    case 'artifact':
      return context.remaps.artifacts.get(artifactMapKey(
        operation.projectId,
        operation.taskId,
        operation.messageId,
        operation.entityId,
      ));
    case 'agent':
      return context.remaps.agents.get(projectEntityMapKey(operation.projectId, operation.entityId));
    case 'knowledge-item':
      return context.remaps.knowledgeItems.get(projectEntityMapKey(operation.projectId, operation.entityId));
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
  if (source.activeAgentId !== undefined) {
    retainConflictSourceReferenceOrigins(taskCopy, { activeAgentId: 'local' });
  }
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
  retainConflictSourceReferenceOrigins(
    messageCopy,
    localMessageReferenceOrigins(source, originalMessageId),
  );
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

function replaceProjectedEntity(
  reference: EntityReference,
  projection: unknown,
  operationValue?: unknown,
): void {
  const nextValue = applyProjectionToValue(reference.entity, projection, reference.entityType);
  preserveReplayUpdatedAt(nextValue, reference.entity, operationValue, reference.entityType);
  reference.collection[reference.index] = nextValue;
  if (reference.entityType === 'artifact' && reference.message) {
    reference.message.artifacts = reference.collection as ChatArtifact[];
  }
}

function preserveReplayUpdatedAt(
  target: unknown,
  remoteValue: unknown,
  localValue: unknown,
  entityType: SimpleChatEntityType,
): void {
  if (
    (entityType !== 'project' && entityType !== 'task')
    || !isRecord(target)
    || !isRecord(remoteValue)
    || !isRecord(localValue)
  ) return;
  const timestamps = [remoteValue.updatedAt, localValue.updatedAt].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (timestamps.length > 0) target.updatedAt = Math.max(...timestamps);
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

function closeConflictEntityReferences(
  context: ReplayContext,
): void {
  for (const project of context.projects) {
    for (const task of project.tasks) {
      const taskMetadata = (task as SimpleChatTask & SimpleChatConflictTagged).syncConflict;
      if (taskMetadata?.sourceEntityType === 'task') {
        closeTaskConflictReference(context, task, project.id, taskMetadata);
      }
      for (const chatMessage of task.messages) {
        const messageMetadata = (chatMessage as SimpleChatMessage & SimpleChatConflictTagged).syncConflict;
        if (messageMetadata?.sourceEntityType === 'message') {
          closeMessageConflictReferences(context, chatMessage, project.id, task.id, messageMetadata);
        }
      }
    }
  }
}

function closeTaskConflictReference(
  context: ReplayContext,
  task: SimpleChatTask,
  targetProjectId: string,
  source: SimpleChatConflictMetadata,
): void {
  const sourceReferences = readConflictSourceReferences(task);
  const sourceOrigins = readConflictSourceReferenceOrigins(task);
  const activeAgentId = task.activeAgentId ?? readString(sourceReferences?.activeAgentId);
  if (activeAgentId === undefined) return;
  const remapped = resolveConflictAgentReference(
    context,
    sourceOrigins?.activeAgentId ?? 'local',
    source.sourceProjectId,
    targetProjectId,
    activeAgentId,
  );
  if (remapped === undefined) {
    delete task.activeAgentId;
    retainConflictSourceReferences(task, { activeAgentId });
    return;
  }
  task.activeAgentId = remapped;
  clearConflictSourceReferences(task, ['activeAgentId']);
}

function closeMessageConflictReferences(
  context: ReplayContext,
  chatMessage: SimpleChatMessage,
  targetProjectId: string,
  targetTaskId: string,
  source: SimpleChatConflictMetadata,
): void {
  const sourceReferences = readConflictSourceReferences(chatMessage);
  const sourceOrigins = readConflictSourceReferenceOrigins(chatMessage);
  const parentMessageId = chatMessage.parentMessageId ?? readString(sourceReferences?.parentMessageId);
  if (parentMessageId !== undefined) {
    const remapped = resolveConflictMessageReference(
      context,
      sourceOrigins?.parentMessageId ?? 'local',
      source.sourceProjectId,
      source.sourceTaskId,
      targetProjectId,
      targetTaskId,
      parentMessageId,
      { originalId: source.sourceEntityId, copyId: chatMessage.id },
    );
    if (remapped === undefined) {
      delete chatMessage.parentMessageId;
      retainConflictSourceReferences(chatMessage, { parentMessageId });
    } else {
      chatMessage.parentMessageId = remapped;
      clearConflictSourceReferences(chatMessage, ['parentMessageId']);
    }
  }

  const retryContext = mergeAuditedRetryReferenceFields(
    chatMessage.retryContext,
    sourceReferences?.retryContext,
  );
  if (retryContext === undefined) return;
  const remappedRetryContext = remapRetryContext(
    context,
    retryContext,
    source.sourceProjectId,
    source.sourceTaskId,
    targetProjectId,
    targetTaskId,
    sourceOrigins?.retryContext,
    { originalId: source.sourceEntityId, copyId: chatMessage.id },
  );
  if (remappedRetryContext.value === undefined) delete chatMessage.retryContext;
  else chatMessage.retryContext = remappedRetryContext.value;
  if (remappedRetryContext.danglingSource !== undefined) {
    retainConflictSourceReferences(chatMessage, {
      retryContext: remappedRetryContext.danglingSource,
    });
  } else {
    clearConflictSourceReferences(chatMessage, ['retryContext']);
  }
}

function trackLocallyMergedReferences(
  context: ReplayContext,
  mergedEntity: unknown,
  operation: SimpleChatSyncOperation,
  remoteValue: unknown,
): void {
  if (!isRecord(mergedEntity) || !isRecord(operation.baseValue) || !isRecord(operation.value)) return;

  if (operation.entityType === 'task') {
    if (!fieldComesOnlyFromBranch(operation.baseValue, operation.value, remoteValue, 'activeAgentId')) return;
    context.localReferenceClosures.push({
      entity: mergedEntity,
      entityType: 'task',
      projectId: operation.projectId,
      activeAgentId: true,
    });
    return;
  }
  if (operation.entityType !== 'message') return;

  const retryContext = referenceSourcesFromBranch(
    operation.baseValue.retryContext,
    operation.value.retryContext,
    isRecord(remoteValue) ? remoteValue.retryContext : MISSING,
  );
  const parentMessageId = fieldComesOnlyFromBranch(
    operation.baseValue,
    operation.value,
    remoteValue,
    'parentMessageId',
  );
  if (!parentMessageId && retryContext === undefined) return;
  context.localReferenceClosures.push({
    entity: mergedEntity,
    entityType: 'message',
    projectId: operation.projectId,
    taskId: operation.taskId,
    ...(parentMessageId ? { parentMessageId: true } : {}),
    ...(retryContext === undefined ? {} : { retryContext }),
  });
}

function preserveRemoteConflictReferences(
  entity: object,
  operation: SimpleChatSyncOperation,
  remoteValue: unknown,
): void {
  if (!isRecord(operation.baseValue) || !isRecord(operation.value) || !isRecord(remoteValue)) return;
  const value = entity as Record<string, unknown>;
  const origins: SimpleChatConflictSourceReferenceOrigins = {};
  if (operation.entityType === 'task' && fieldComesOnlyFromBranch(
    operation.baseValue,
    remoteValue,
    operation.value,
    'activeAgentId',
  )) {
    const activeAgentId = readString(remoteValue.activeAgentId);
    if (activeAgentId === undefined) delete value.activeAgentId;
    else value.activeAgentId = activeAgentId;
    origins.activeAgentId = 'remote';
  }
  if (operation.entityType === 'message') {
    if (fieldComesOnlyFromBranch(operation.baseValue, remoteValue, operation.value, 'parentMessageId')) {
      const parentMessageId = readString(remoteValue.parentMessageId);
      if (parentMessageId === undefined) delete value.parentMessageId;
      else value.parentMessageId = parentMessageId;
      origins.parentMessageId = referenceOrigin(parentMessageId, operation.entityId, 'remote');
    }
    const retrySources = referenceSourcesFromBranch(
      operation.baseValue.retryContext,
      remoteValue.retryContext,
      operation.value.retryContext,
    );
    if (retrySources && isRecord(remoteValue.retryContext)) {
      const sourceReferences = readConflictSourceReferences(entity);
      const retryContext = mergeRemoteRetryReferenceFields(
        sourceReferences?.retryContext ?? value.retryContext,
        remoteValue.retryContext,
        retrySources,
      );
      value.retryContext = retryContext;
      if (sourceReferences?.retryContext !== undefined) {
        retainConflictSourceReferences(entity, { retryContext });
      }
      origins.retryContext = remoteRetryReferenceOrigins(
        remoteValue.retryContext,
        retrySources,
        operation.entityId,
      );
    }
  }
  retainConflictSourceReferenceOrigins(entity, origins);
}

function fieldComesOnlyFromBranch(
  base: unknown,
  branch: unknown,
  other: unknown,
  key: string,
): boolean {
  const baseValue = isRecord(base) ? ownValue(base, key) : MISSING;
  const branchValue = isRecord(branch) ? ownValue(branch, key) : MISSING;
  const otherValue = isRecord(other) ? ownValue(other, key) : MISSING;
  return !jsonEqual(branchValue, baseValue) && jsonEqual(otherValue, baseValue);
}

function referenceSourcesFromBranch(
  base: unknown,
  branch: unknown,
  other: unknown,
): LocalRetryReferenceSources | undefined {
  const sources: LocalRetryReferenceSources = {};
  for (const key of [
    'projectId',
    'taskId',
    'userMessageId',
    'assistantMessageId',
    'historyMessageIds',
  ] as const) {
    if (fieldComesOnlyFromBranch(base, branch, other, key)) sources[key] = true;
  }
  return Object.keys(sources).length === 0 ? undefined : sources;
}

function localMessageReferenceOrigins(
  chatMessage: SimpleChatMessage,
  originalMessageId: string,
): SimpleChatConflictSourceReferenceOrigins {
  const origins: SimpleChatConflictSourceReferenceOrigins = {};
  if (chatMessage.parentMessageId !== undefined) {
    origins.parentMessageId = referenceOrigin(chatMessage.parentMessageId, originalMessageId, 'local');
  }
  if (isRecord(chatMessage.retryContext)) {
    origins.retryContext = retryReferenceOrigins(
      chatMessage.retryContext,
      originalMessageId,
      'local',
    );
  }
  return origins;
}

function remoteRetryReferenceOrigins(
  retryContext: Record<string, unknown>,
  remoteSources: LocalRetryReferenceSources,
  originalMessageId: string,
): SimpleChatConflictRetryReferenceOrigins {
  const origins: SimpleChatConflictRetryReferenceOrigins = {};
  for (const key of ['projectId', 'taskId'] as const) {
    if (remoteSources[key]) origins[key] = 'remote';
  }
  for (const key of ['userMessageId', 'assistantMessageId'] as const) {
    if (!remoteSources[key]) continue;
    origins[key] = referenceOrigin(readString(retryContext[key]), originalMessageId, 'remote');
  }
  if (remoteSources.historyMessageIds && Array.isArray(retryContext.historyMessageIds)) {
    origins.historyMessageIds = retryContext.historyMessageIds.map(item => (
      referenceOrigin(readString(item), originalMessageId, 'remote')
    ));
  }
  return origins;
}

function retryReferenceOrigins(
  retryContext: Record<string, unknown>,
  originalMessageId: string,
  branch: 'local' | 'remote',
): SimpleChatConflictRetryReferenceOrigins {
  const origins: SimpleChatConflictRetryReferenceOrigins = {};
  for (const key of ['projectId', 'taskId'] as const) {
    if (Object.prototype.hasOwnProperty.call(retryContext, key)) origins[key] = branch;
  }
  for (const key of ['userMessageId', 'assistantMessageId'] as const) {
    if (!Object.prototype.hasOwnProperty.call(retryContext, key)) continue;
    origins[key] = referenceOrigin(readString(retryContext[key]), originalMessageId, branch);
  }
  if (Array.isArray(retryContext.historyMessageIds)) {
    origins.historyMessageIds = retryContext.historyMessageIds.map(item => (
      referenceOrigin(readString(item), originalMessageId, branch)
    ));
  }
  return origins;
}

function referenceOrigin(
  referenceId: string | undefined,
  originalMessageId: string,
  branch: 'local' | 'remote',
): SimpleChatConflictReferenceOrigin {
  return referenceId === originalMessageId ? 'self' : branch;
}

function closeLocallyMergedReferences(context: ReplayContext): void {
  for (const closure of context.localReferenceClosures) {
    if (closure.entityType === 'task') {
      const activeAgentId = readString(closure.entity.activeAgentId);
      const remapped = activeAgentId === undefined
        ? undefined
        : context.remaps.agents.get(projectEntityMapKey(closure.projectId, activeAgentId));
      if (remapped !== undefined) closure.entity.activeAgentId = remapped;
      continue;
    }

    if (closure.parentMessageId) {
      const parentMessageId = readString(closure.entity.parentMessageId);
      const remapped = parentMessageId === undefined
        ? undefined
        : context.remaps.messages.get(messageMapKey(closure.projectId, closure.taskId, parentMessageId));
      if (remapped !== undefined) closure.entity.parentMessageId = remapped;
    }
    closeLocallyMergedRetryContext(context, closure);
  }
}

function closeLocallyMergedRetryContext(
  context: ReplayContext,
  closure: LocalReferenceClosure,
): void {
  const sources = closure.retryContext;
  const retryContext = closure.entity.retryContext;
  if (!sources || !isRecord(retryContext)) return;

  if (sources.projectId) {
    const projectId = readString(retryContext.projectId);
    const remapped = projectId === undefined ? undefined : context.remaps.projects.get(projectId);
    if (remapped !== undefined) retryContext.projectId = remapped;
  }
  if (sources.taskId) {
    const taskId = readString(retryContext.taskId);
    const remapped = taskId === undefined
      ? undefined
      : context.remaps.tasks.get(taskMapKey(closure.projectId, taskId));
    if (remapped !== undefined) retryContext.taskId = remapped;
  }
  for (const key of ['userMessageId', 'assistantMessageId'] as const) {
    if (!sources[key]) continue;
    const messageId = readString(retryContext[key]);
    const remapped = messageId === undefined
      ? undefined
      : context.remaps.messages.get(messageMapKey(closure.projectId, closure.taskId, messageId));
    if (remapped !== undefined) retryContext[key] = remapped;
  }
  if (sources.historyMessageIds && Array.isArray(retryContext.historyMessageIds)) {
    retryContext.historyMessageIds = retryContext.historyMessageIds.map(messageId => (
      typeof messageId === 'string'
        ? context.remaps.messages.get(messageMapKey(closure.projectId, closure.taskId, messageId)) ?? messageId
        : messageId
    ));
  }
}

function mergeRemoteRetryReferenceFields(
  current: unknown,
  remoteValue: Record<string, unknown>,
  remoteSources: LocalRetryReferenceSources,
): SimpleChatMessage['retryContext'] {
  const retryContext = isRecord(current)
    ? cloneUnknown(current) as unknown as Record<string, unknown>
    : cloneUnknown(remoteValue);
  for (const key of [
    'projectId',
    'taskId',
    'userMessageId',
    'assistantMessageId',
    'historyMessageIds',
  ] as const) {
    if (!remoteSources[key]) continue;
    if (Object.prototype.hasOwnProperty.call(remoteValue, key)) {
      retryContext[key] = cloneUnknown(remoteValue[key]);
    } else {
      delete retryContext[key];
    }
  }
  return retryContext as unknown as SimpleChatMessage['retryContext'];
}

function mergeAuditedRetryReferenceFields(
  current: unknown,
  audited: unknown,
): SimpleChatMessage['retryContext'] | undefined {
  if (audited === undefined) {
    return current === undefined
      ? undefined
      : cloneUnknown(current) as SimpleChatMessage['retryContext'];
  }
  if (!isRecord(audited)) return cloneUnknown(audited) as SimpleChatMessage['retryContext'];
  const retryContext = isRecord(current)
    ? cloneUnknown(current) as Record<string, unknown>
    : cloneUnknown(audited);
  for (const key of [
    'projectId',
    'taskId',
    'userMessageId',
    'assistantMessageId',
    'historyMessageIds',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(audited, key)) {
      retryContext[key] = cloneUnknown(audited[key]);
    } else {
      delete retryContext[key];
    }
  }
  return retryContext as unknown as SimpleChatMessage['retryContext'];
}

function readConflictSourceReferences(entity: object): Record<string, unknown> | undefined {
  const value = entity as Record<string, unknown>;
  return isRecord(value.syncConflict) && isRecord(value.syncConflict.sourceReferences)
    ? value.syncConflict.sourceReferences
    : undefined;
}

function readConflictSourceReferenceOrigins(
  entity: object,
): SimpleChatConflictSourceReferenceOrigins | undefined {
  const value = entity as Record<string, unknown>;
  return isRecord(value.syncConflict) && isRecord(value.syncConflict.sourceReferenceOrigins)
    ? value.syncConflict.sourceReferenceOrigins as unknown as SimpleChatConflictSourceReferenceOrigins
    : undefined;
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
  for (const task of project.tasks) {
    reserveTaskGraphIds(context, task, originalProjectId, task.id);
  }
  for (const agent of project.agents) {
    const key = projectEntityMapKey(originalProjectId, agent.id);
    if (!context.remaps.agents.has(key)) context.remaps.agents.set(key, context.createId());
  }
  for (const item of project.knowledgeItems) {
    const key = projectEntityMapKey(originalProjectId, item.id);
    if (!context.remaps.knowledgeItems.has(key)) context.remaps.knowledgeItems.set(key, context.createId());
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

function resolveConflictAgentReference(
  context: ReplayContext,
  source: ConflictReferenceSource,
  originalProjectId: string,
  targetProjectId: string,
  agentId: string | undefined,
): string | undefined {
  if (agentId === undefined) return undefined;
  if (source === 'local') {
    return remapAgentReference(context, originalProjectId, targetProjectId, agentId);
  }
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

function resolveConflictMessageReference(
  context: ReplayContext,
  source: ConflictReferenceSource,
  originalProjectId: string,
  originalTaskId: string | undefined,
  targetProjectId: string,
  targetTaskId: string | undefined,
  messageId: string | undefined,
  self?: { originalId: string; copyId: string },
): string | undefined {
  if (messageId === undefined) return undefined;
  if (source === 'self') return self?.copyId;
  if (source === 'local') {
    return remapMessageReference(
      context,
      originalProjectId,
      originalTaskId,
      targetProjectId,
      targetTaskId,
      messageId,
    );
  }
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
  sourceOrigins?: SimpleChatConflictRetryReferenceOrigins,
  self?: { originalId: string; copyId: string },
): RemappedRetryContext {
  if (input === undefined) return {};
  if (!isRecord(input)) {
    return { value: cloneUnknown(input) as SimpleChatMessage['retryContext'] };
  }
  const value = cloneUnknown(input) as Record<string, unknown>;
  if (sourceOrigins?.projectId === 'remote') {
    const projectId = readString(value.projectId);
    if (projectId === undefined || !context.projects.some(project => project.id === projectId)) {
      return { danglingSource: cloneUnknown(input) as unknown as SimpleChatMessage['retryContext'] };
    }
  } else if (sourceOrigins?.projectId === 'self') {
    value.projectId = targetProjectId;
  } else if (value.projectId === originalProjectId) {
    value.projectId = targetProjectId;
  }
  if (sourceOrigins?.taskId === 'remote') {
    const taskId = readString(value.taskId);
    if (taskId === undefined || !findTask(context.projects, targetProjectId, taskId)) {
      return { danglingSource: cloneUnknown(input) as unknown as SimpleChatMessage['retryContext'] };
    }
  } else if (sourceOrigins?.taskId === 'self') {
    value.taskId = targetTaskId;
  } else if (value.taskId === originalTaskId && targetTaskId !== undefined) {
    value.taskId = targetTaskId;
  }
  for (const key of ['userMessageId', 'assistantMessageId'] as const) {
    const messageId = readString(value[key]);
    const remapped = resolveConflictMessageReference(
      context,
      sourceOrigins?.[key] ?? 'local',
      originalProjectId,
      originalTaskId,
      targetProjectId,
      targetTaskId,
      messageId,
      self,
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
    value.historyMessageIds = value.historyMessageIds.flatMap((item, index) => {
      const messageId = readString(item);
      if (messageId === undefined) return [cloneUnknown(item)];
      const remapped = resolveConflictMessageReference(
        context,
        sourceOrigins?.historyMessageIds?.[index] ?? 'local',
        originalProjectId,
        originalTaskId,
        targetProjectId,
        targetTaskId,
        messageId,
        self,
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

function assertUniqueSimpleChatIdentities(
  projects: SimpleChatProject[],
  snapshot: 'base' | 'current',
): void {
  const duplicate = findDuplicateSimpleChatIdentity(projects);
  if (duplicate) throw new SimpleChatSyncDomainError(duplicate, snapshot);
}

function findDuplicateSimpleChatIdentity(
  projects: SimpleChatProject[],
): SimpleChatDuplicateIdentityDetails | undefined {
  const projectIds = new Set<string>();
  for (const project of projects) {
    if (!isRecord(project)) continue;
    const projectId = readString(project.id);
    if (projectId !== undefined) {
      if (projectIds.has(projectId)) {
        return duplicateIdentityDetails('projects', 'project', projectId);
      }
      projectIds.add(projectId);
    }

    const taskIds = new Set<string>();
    if (Array.isArray(project.tasks)) {
      for (const task of project.tasks) {
        if (!isRecord(task)) continue;
        const taskId = readString(task.id);
        if (taskId !== undefined) {
          if (taskIds.has(taskId)) {
            return duplicateIdentityDetails('tasks', 'task', taskId, { projectId });
          }
          taskIds.add(taskId);
        }

        const messageIds = new Set<string>();
        if (!Array.isArray(task.messages)) continue;
        for (const chatMessage of task.messages) {
          if (!isRecord(chatMessage)) continue;
          const messageId = readString(chatMessage.id);
          if (messageId !== undefined) {
            if (messageIds.has(messageId)) {
              return duplicateIdentityDetails('messages', 'message', messageId, {
                projectId,
                taskId,
              });
            }
            messageIds.add(messageId);
          }

          const artifactIds = new Set<string>();
          if (!Array.isArray(chatMessage.artifacts)) continue;
          for (const artifact of chatMessage.artifacts) {
            if (!isRecord(artifact)) continue;
            const artifactId = readString(artifact.id);
            if (artifactId === undefined) continue;
            if (artifactIds.has(artifactId)) {
              return duplicateIdentityDetails('artifacts', 'artifact', artifactId, {
                projectId,
                taskId,
                messageId,
              });
            }
            artifactIds.add(artifactId);
          }
        }
      }
    }

    const agentDuplicate = findDuplicateProjectEntityId(project.agents, 'agents', 'agent', projectId);
    if (agentDuplicate) return agentDuplicate;
    const knowledgeDuplicate = findDuplicateProjectEntityId(
      project.knowledgeItems,
      'knowledgeItems',
      'knowledge-item',
      projectId,
    );
    if (knowledgeDuplicate) return knowledgeDuplicate;
  }
  return undefined;
}

function findDuplicateProjectEntityId(
  collection: unknown,
  field: 'agents' | 'knowledgeItems',
  entityType: 'agent' | 'knowledge-item',
  projectId: string | undefined,
): SimpleChatDuplicateIdentityDetails | undefined {
  if (!Array.isArray(collection)) return undefined;
  const ids = new Set<string>();
  for (const entity of collection) {
    if (!isRecord(entity)) continue;
    const entityId = readString(entity.id);
    if (entityId === undefined) continue;
    if (ids.has(entityId)) {
      return duplicateIdentityDetails(field, entityType, entityId, { projectId });
    }
    ids.add(entityId);
  }
  return undefined;
}

function duplicateIdentityDetails(
  field: string,
  entityType: SimpleChatEntityType,
  entityId: string,
  scope: { projectId?: string; taskId?: string; messageId?: string } = {},
): SimpleChatDuplicateIdentityDetails {
  return {
    code: 'CHAT_SYNC_DUPLICATE_ID',
    field,
    entityType,
    entityId,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    ...(scope.taskId === undefined ? {} : { taskId: scope.taskId }),
    ...(scope.messageId === undefined ? {} : { messageId: scope.messageId }),
  };
}

function flattenSimpleChatProjects(projects: SimpleChatProject[]): FlatEntity[] {
  const entities: FlatEntity[] = [];

  for (const project of projects) {
    entities.push(flatEntity('project', project.id, undefined, undefined, project.id, project));
    for (const task of project.tasks) {
      entities.push(flatEntity('task', project.id, task.id, undefined, task.id, task));
      for (const chatMessage of task.messages) {
        entities.push(flatEntity(
          'message',
          project.id,
          task.id,
          chatMessage.id,
          chatMessage.id,
          chatMessage,
        ));
        for (const item of chatMessage.artifacts ?? []) {
          entities.push(flatEntity(
            'artifact',
            project.id,
            task.id,
            chatMessage.id,
            item.id,
            item,
          ));
        }
      }
    }
    for (const agent of project.agents) {
      entities.push(flatEntity('agent', project.id, undefined, undefined, agent.id, agent));
    }
    for (const item of project.knowledgeItems) {
      entities.push(flatEntity(
        'knowledge-item',
        project.id,
        undefined,
        undefined,
        item.id,
        item,
      ));
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
  return {
    entityType,
    projectId,
    taskId,
    messageId,
    entityId,
    value: cloneUnknown(value),
  };
}

function comparableEntityValue(entityType: SimpleChatEntityType, value: unknown): unknown {
  if (!isRecord(value)) return cloneUnknown(value);
  switch (entityType) {
    case 'project':
      return omitKeys(value, ['tasks', 'agents', 'knowledgeItems', 'updatedAt']);
    case 'task':
      return omitKeys(value, ['messages', 'updatedAt']);
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

function retainConflictSourceReferenceOrigins(
  entity: object,
  origins: SimpleChatConflictSourceReferenceOrigins,
): void {
  if (Object.keys(origins).length === 0) return;
  const value = entity as Record<string, unknown>;
  if (!isRecord(value.syncConflict)) return;
  const existing = isRecord(value.syncConflict.sourceReferenceOrigins)
    ? value.syncConflict.sourceReferenceOrigins
    : {};
  const existingRetryContext = isRecord(existing.retryContext) ? existing.retryContext : {};
  const retryContext = origins.retryContext === undefined
    ? existing.retryContext
    : { ...existingRetryContext, ...cloneUnknown(origins.retryContext) };
  value.syncConflict.sourceReferenceOrigins = {
    ...existing,
    ...cloneUnknown(origins),
    ...(retryContext === undefined ? {} : { retryContext }),
  };
}

function clearConflictSourceReferences(
  entity: object,
  keys: Array<keyof SimpleChatConflictSourceReferences>,
): void {
  const value = entity as Record<string, unknown>;
  if (!isRecord(value.syncConflict) || !isRecord(value.syncConflict.sourceReferences)) return;
  for (const key of keys) delete value.syncConflict.sourceReferences[key];
  if (Object.keys(value.syncConflict.sourceReferences).length === 0) {
    delete value.syncConflict.sourceReferences;
  }
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
    validateOptionalReasoningEffort(value, 'reasoningEffort'),
    validateOptionalResponseSpeed(value, 'responseSpeed'),
    validateOptionalId(value, 'activeAgentId'),
    validateRequiredNumber(value, 'createdAt'),
    validateRequiredNumber(value, 'updatedAt'),
    validateAppliedChatControls(value.appliedChatControls),
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
    validateImageReferences(value.imageRefs),
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

function validateImageReferences(value: unknown): SimpleChatProjectValidationResult | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return invalidValidation('value');
  for (const reference of value) {
    if (!isRecord(reference)) return invalidValidation('value');
    const result = firstValidation(
      validateRequiredString(reference, 'url'),
      validateOptionalName(reference, 'name'),
      validateOptionalId(reference, 'assetId'),
      validateOptionalId(reference, 'assetVersionId'),
      validateOptionalId(reference, 'placementId'),
      validateOptionalId(reference, 'entityId'),
    );
    if (result) return result;
  }
  return undefined;
}

function validateAppliedChatControls(value: unknown): SimpleChatProjectValidationResult | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalidValidation('value');
  return firstValidation(
    validateRequiredReasoningEffort(value, 'appliedReasoningEffort', true),
    validateRequiredResponseSpeed(value, 'appliedResponseSpeed', true),
    validateRequiredBoolean(value, 'degraded'),
    validateRequiredStringArray(value, 'notices'),
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
  const originsResult = validateConflictSourceReferenceOrigins(value.sourceReferenceOrigins);
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
    originsResult,
  );
}

function validateConflictSourceReferenceOrigins(
  value: unknown,
): SimpleChatProjectValidationResult | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalidValidation('value');
  const allowed = ['local', 'remote', 'self'] as const;
  let retryResult: SimpleChatProjectValidationResult | undefined;
  if (value.retryContext !== undefined) {
    if (!isRecord(value.retryContext)) return invalidValidation('value');
    retryResult = firstValidation(
      validateOptionalEnum(value.retryContext, 'projectId', allowed),
      validateOptionalEnum(value.retryContext, 'taskId', allowed),
      validateOptionalEnum(value.retryContext, 'userMessageId', allowed),
      validateOptionalEnum(value.retryContext, 'assistantMessageId', allowed),
      value.retryContext.historyMessageIds === undefined
        ? undefined
        : validateRequiredEnumArray(value.retryContext, 'historyMessageIds', allowed),
    );
  }
  return firstValidation(
    validateOptionalEnum(value, 'activeAgentId', allowed),
    validateOptionalEnum(value, 'parentMessageId', allowed),
    retryResult,
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

function validateOptionalName(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return value[key] === undefined ? undefined : validateRequiredName(value, key);
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

function validateRequiredReasoningEffort(
  value: Record<string, unknown>,
  key: string,
  allowModelDefault = false,
): SimpleChatProjectValidationResult | undefined {
  const candidate = value[key];
  return candidate === 'model-default' && allowModelDefault
    || typeof candidate === 'string' && normalizeReasoningEffort(candidate) === candidate
    ? undefined
    : invalidValidation('value');
}

function validateOptionalReasoningEffort(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return value[key] === undefined ? undefined : validateRequiredReasoningEffort(value, key);
}

function validateRequiredResponseSpeed(
  value: Record<string, unknown>,
  key: string,
  allowModelDefault = false,
): SimpleChatProjectValidationResult | undefined {
  const candidate = value[key];
  return candidate === 'model-default' && allowModelDefault
    || typeof candidate === 'string' && normalizeResponseSpeed(candidate) === candidate
    ? undefined
    : invalidValidation('value');
}

function validateOptionalResponseSpeed(
  value: Record<string, unknown>,
  key: string,
): SimpleChatProjectValidationResult | undefined {
  return value[key] === undefined ? undefined : validateRequiredResponseSpeed(value, key);
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
