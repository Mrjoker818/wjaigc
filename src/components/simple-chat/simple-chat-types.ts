// ========== 项目化聊天类型定义 (对齐开发文档) ==========

import type { ReasoningEffort, ResponseSpeed, ResolvedChatControls } from '@/lib/chat-generation-controls';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import {
  bindWorkspaceSourceTraceToChat,
  parseWorkspaceSourceTrace,
  type SimpleChatWorkspaceSourceTrace,
  type WorkspaceSourceTrace,
} from '@/lib/asset-core/source-trace';
import type {
  SimpleChatFailure,
  SimpleChatMessageStatus,
  SimpleChatRetryContextV1,
} from '@/lib/simple-chat-retry';
import { recoverInterruptedSimpleChatMessages } from '@/lib/simple-chat-retry';

export type { WorkspaceAssetReference } from '@/lib/asset-core/types';

export interface SimpleChatProject {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  createdAt: number;
  updatedAt: number;
  tasks: SimpleChatTask[];
  agents: SimpleChatAgent[];
  knowledgeItems: ProjectKnowledgeItem[];
  instructions?: ProjectInstructions;
}

export interface SimpleChatTask {
  id: string;
  projectId: string;
  name: string;
  messages: SimpleChatMessage[];
  model: string;
  providerId: string;
  imageModel?: string;
  imageProviderId?: string;
  reasoningEffort?: ReasoningEffort;
  responseSpeed?: ResponseSpeed;
  appliedChatControls?: Pick<ResolvedChatControls, 'appliedReasoningEffort' | 'appliedResponseSpeed' | 'degraded' | 'notices'>;
  activeAgentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SimpleChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'search';
  content: string;
  images?: string[];
  imageRefs?: WorkspaceAssetReference[];
  attachments?: ChatAttachment[];
  artifacts?: ChatArtifact[];
  model?: string;
  providerId?: string;
  parentMessageId?: string;
  branchId?: string;
  agentRunId?: string;
  multiPlatformExportRunId?: string;
  multiPlatformExportProjectId?: string;
  status?: SimpleChatMessageStatus;
  error?: SimpleChatFailure;
  retryContext?: SimpleChatRetryContextV1;
  createdAt: number;
}

export interface SimpleChatAgent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  emoji?: string;
  tools: SimpleAgentTool[];
  defaultChatModel?: string;
  defaultChatProviderId?: string;
  defaultImageModel?: string;
  defaultImageProviderId?: string;
  allowWebSearch?: boolean;
  allowDeepResearch?: boolean;
  allowImageGeneration?: boolean;
  allowImageEdit?: boolean;
  knowledgeScope?: 'none' | 'project' | 'selected';
  createdAt: number;
  updatedAt: number;
}

export type SimpleAgentTool =
  | 'web_search'
  | 'generate_image'
  | 'edit_image'
  | 'analyze_image'
  | 'analyze_file'
  | 'deep_research';

export interface ProjectKnowledgeItem {
  id: string;
  projectId: string;
  type: 'file' | 'image' | 'url' | 'note';
  name: string;
  mimeType?: string;
  url?: string;
  textContent?: string;
  summary?: string;
  tags: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectInstructions {
  projectBackground: string;
  userPreference: string;
  outputFormat: string;
  styleRules: string;
  forbiddenRules: string;
  language: 'zh-CN' | 'en' | 'auto';
}

export interface ChatAttachment {
  id: string;
  type: 'file' | 'image';
  name: string;
  mimeType: string;
  url?: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  textContent?: string;
  summary?: string;
}

export function recoverInterruptedSimpleChatProjects(
  projects: SimpleChatProject[],
): SimpleChatProject[] {
  return projects.map(project => ({
    ...project,
    tasks: project.tasks.map(task => ({
      ...task,
      messages: recoverInterruptedSimpleChatMessages(task.messages || []),
    })),
  }));
}

export function selectInitialSimpleChatProject<T extends { id: string; tasks: Array<{ id: string }> }>(
  projects: T[],
  requestedProjectId: string | null | undefined,
  requestedTaskId?: string | null,
): { projectId: string; taskId: string | null } | null {
  const project = projects.find(candidate => candidate.id === requestedProjectId) || projects[0];
  if (!project) return null;
  const task = project.tasks.find(candidate => candidate.id === requestedTaskId) || project.tasks[0];
  return { projectId: project.id, taskId: task?.id ?? null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toWorkspaceAssetReference(value: unknown): WorkspaceAssetReference | null {
  if (typeof value === 'string') {
    return value ? { url: value } : null;
  }
  if (!isRecord(value)) return null;
  const url = typeof value.url === 'string' ? value.url : '';
  const hasManagedPointer = typeof value.assetVersionId === 'string'
    && typeof value.placementId === 'string';
  if (!url && !hasManagedPointer) return null;
  const sourceTrace = parseWorkspaceSourceTrace(value.sourceTrace);
  return {
    url,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.assetId === 'string' ? { assetId: value.assetId } : {}),
    ...(typeof value.assetVersionId === 'string' ? { assetVersionId: value.assetVersionId } : {}),
    ...(typeof value.placementId === 'string' ? { placementId: value.placementId } : {}),
    ...(typeof value.entityId === 'string' ? { entityId: value.entityId } : {}),
    ...(sourceTrace ? { sourceTrace } : {}),
  };
}

const CANVAS_BRIDGE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export function serializeSimpleChatCanvasBridgePayload(
  projectId: string,
  references: WorkspaceAssetReference[],
): {
  projectId: string;
  images: Array<{ assetVersionId: string; placementId: string; entityId?: string }>;
} {
  if (!CANVAS_BRIDGE_ID.test(projectId)) throw new Error('CANVAS_BRIDGE_PROJECT_INVALID');
  return {
    projectId,
    images: references.flatMap(reference => {
      if (
        !reference.assetVersionId || !CANVAS_BRIDGE_ID.test(reference.assetVersionId)
        || !reference.placementId || !CANVAS_BRIDGE_ID.test(reference.placementId)
        || (reference.entityId !== undefined && !CANVAS_BRIDGE_ID.test(reference.entityId))
      ) return [];
      return [{
        assetVersionId: reference.assetVersionId,
        placementId: reference.placementId,
        ...(reference.entityId ? { entityId: reference.entityId } : {}),
      }];
    }),
  };
}

export function parseSimpleChatCanvasBridgePayload(value: unknown): WorkspaceAssetReference[] {
  const images = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.images)
      ? value.images
      : [];
  return images
    .map(toWorkspaceAssetReference)
    .filter((reference): reference is WorkspaceAssetReference => reference !== null);
}

export function readSimpleChatStreamAssetReference(
  value: unknown,
): WorkspaceAssetReference | null {
  if (!isRecord(value)) return null;
  return toWorkspaceAssetReference(value);
}

function bridgeReferenceIdentity(reference: WorkspaceAssetReference): string {
  if (reference.placementId) return `placement:${reference.placementId}`;
  if (reference.entityId) return `entity:${reference.entityId}`;
  if (reference.assetVersionId) return `version:${reference.assetVersionId}`;
  return `url:${reference.url}`;
}

export function mergeSimpleChatCanvasBridgeReferences(
  existing: WorkspaceAssetReference[],
  incoming: WorkspaceAssetReference[],
): WorkspaceAssetReference[] {
  const merged = new Map<string, WorkspaceAssetReference>();
  for (const reference of [...existing, ...incoming]) {
    merged.set(bridgeReferenceIdentity(reference), reference);
  }
  return [...merged.values()];
}

export function hasManagedAssetIdentity(
  reference: WorkspaceAssetReference | null | undefined,
): reference is WorkspaceAssetReference & { assetVersionId: string; placementId: string } {
  return Boolean(reference?.assetVersionId && reference.placementId);
}

export function canSendSimpleChatMessageToNodeMode(message: SimpleChatMessage): boolean {
  return Boolean(
    message.content.trim()
    || message.images?.some((imageUrl, index) => {
      const reference = message.imageRefs?.[index];
      return Boolean(
        imageUrl
        && reference?.url === imageUrl
        && hasManagedAssetIdentity(reference),
      );
    }),
  );
}

export function buildSimpleChatCanvasBridgeImages(
  references: WorkspaceAssetReference[],
  timestamp: number,
): Array<{
  id: string;
  url: string;
  prompt: string;
  model: string;
  quality: string;
  aspectRatio: string;
  stylePreset: string;
  category: string;
  size: string;
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  isAiGenerated: boolean;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  sourceTrace?: WorkspaceSourceTrace;
}> {
  return references.map((reference, index) => {
    const sourceTrace = parseWorkspaceSourceTrace(reference.sourceTrace);
    return {
      id: reference.entityId || `chat-bridge-${timestamp}-${index}`,
      url: reference.url,
      prompt: reference.name || '',
      model: '',
      quality: 'standard',
      aspectRatio: '1:1',
      stylePreset: '',
      category: 'general',
      size: '1024x1024',
      x: 200 + (index % 5) * 220,
      y: 200 + Math.floor(index / 5) * 220,
      width: 512,
      height: 512,
      originalWidth: 1024,
      originalHeight: 1024,
      isAiGenerated: true,
      ...(reference.assetId ? { assetId: reference.assetId } : {}),
      ...(reference.assetVersionId ? { assetVersionId: reference.assetVersionId } : {}),
      ...(reference.placementId ? { placementId: reference.placementId } : {}),
      ...(sourceTrace ? { sourceTrace } : {}),
    };
  });
}

export function buildSimpleChatMessageSourceTrace(input: {
  project: SimpleChatProject;
  task: SimpleChatTask;
  message: SimpleChatMessage;
}): SimpleChatWorkspaceSourceTrace | undefined {
  const generationTaskIds = [...new Set(
    (input.message.imageRefs || []).flatMap(reference => (
      (() => {
        const trace = parseWorkspaceSourceTrace(reference.sourceTrace);
        return trace?.source === 'simple-chat' ? trace.generationTaskIds || [] : [];
      })()
    )),
  )].slice(0, 16);
  const sourceTrace = parseWorkspaceSourceTrace({
    source: 'simple-chat',
    chatProjectId: input.project.id,
    chatTaskId: input.task.id,
    messageId: input.message.id,
    modelId: input.message.model || input.task.model || undefined,
    providerId: input.message.providerId || input.task.providerId || undefined,
    generationTaskIds,
    agentRunId: input.message.agentRunId,
    createdAt: new Date(input.message.createdAt).toISOString(),
  });
  return sourceTrace?.source === 'simple-chat' ? sourceTrace : undefined;
}

function bridgeReferenceError(message: string, status?: number, code?: string): Error {
  return Object.assign(new Error(message), {
    ...(status === undefined ? {} : { status }),
    ...(code ? { code } : {}),
  });
}

function isExplicitAssetNotFound(error: unknown): boolean {
  return isRecord(error)
    && error.status === 404
    && error.code === 'ASSET_NOT_FOUND';
}

export async function resolveSimpleChatCanvasReference(
  input: { projectId: string; assetVersionId: string; placementId: string },
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceAssetReference> {
  const response = await fetcher('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw bridgeReferenceError('ASSET_REFERENCE_INVALID', response.status);
  }

  if (!response.ok) {
    if (
      response.status === 404
      && isRecord(payload)
      && payload.error === 'ASSET_NOT_FOUND'
    ) {
      throw bridgeReferenceError('ASSET_NOT_FOUND', 404, 'ASSET_NOT_FOUND');
    }
    throw bridgeReferenceError('ASSET_REFERENCE_RESOLVE_FAILED', response.status);
  }

  const reference = toWorkspaceAssetReference(payload);
  if (
    !hasManagedAssetIdentity(reference)
    || reference.assetVersionId !== input.assetVersionId
    || reference.placementId !== input.placementId
  ) {
    throw bridgeReferenceError('ASSET_REFERENCE_INVALID', response.status);
  }
  return reference;
}

export function alignSimpleChatMediaSlots(
  attachments: ChatAttachment[],
  registrations: Array<WorkspaceAssetReference | null>,
): {
  images: string[];
  imageRefs: WorkspaceAssetReference[];
  attachments: ChatAttachment[];
} {
  const alignedAttachments: ChatAttachment[] = [];
  const images: string[] = [];
  const imageRefs: WorkspaceAssetReference[] = [];

  attachments.forEach((attachment, index) => {
    const fallbackUrl = attachment.url || '';
    const registered = registrations[index];
    const reference = hasManagedAssetIdentity(registered)
      ? registered
      : { url: fallbackUrl };
    const legacyAttachment = { ...attachment };
    delete legacyAttachment.assetId;
    delete legacyAttachment.assetVersionId;
    delete legacyAttachment.placementId;
    images.push(reference.url);
    imageRefs.push(reference);
    alignedAttachments.push(hasManagedAssetIdentity(reference) ? {
      ...legacyAttachment,
      url: reference.url,
      ...(reference.assetId ? { assetId: reference.assetId } : {}),
      assetVersionId: reference.assetVersionId,
      placementId: reference.placementId,
    } : {
      ...legacyAttachment,
      url: fallbackUrl,
    });
  });

  return { images, imageRefs, attachments: alignedAttachments };
}

export function buildSimpleChatManagedAttachmentSelection(
  references: readonly WorkspaceAssetReference[],
): { sourceVersionIds: string[]; selectedEntityIds: string[] } {
  return {
    sourceVersionIds: [...new Set(references.flatMap(reference => (
      reference.assetVersionId ? [reference.assetVersionId] : []
    )))],
    selectedEntityIds: [...new Set(references.flatMap(reference => (
      reference.assetVersionId && reference.placementId && reference.entityId
        ? [reference.entityId]
        : []
    )))],
  };
}

export async function sendSimpleChatMediaToCanvas(input: {
  images: string[];
  imageRefs: WorkspaceAssetReference[];
  targetProjectId: string;
  sourceTrace: SimpleChatWorkspaceSourceTrace;
  transfer: (input: {
    sourceVersionId: string;
    targetProjectId: string;
    index: number;
    sourceTrace?: WorkspaceAssetReference['sourceTrace'];
  }) => Promise<WorkspaceAssetReference>;
  writeBridge: (references: WorkspaceAssetReference[]) => void;
}): Promise<{
  ok: boolean;
  references: WorkspaceAssetReference[];
  reason?: 'UNMANAGED_IMAGE_SLOT';
}> {
  if (!input.targetProjectId || !canTransferSimpleChatMedia(input.images, input.imageRefs)) {
    return { ok: false, references: [], reason: 'UNMANAGED_IMAGE_SLOT' };
  }

  const references: WorkspaceAssetReference[] = [];
  const parsedSourceTrace = parseWorkspaceSourceTrace(input.sourceTrace);
  const sourceTrace = parsedSourceTrace?.source === 'simple-chat' ? parsedSourceTrace : undefined;
  for (const [index, reference] of input.imageRefs.entries()) {
    if (!hasManagedAssetIdentity(reference)) {
      return { ok: false, references: [], reason: 'UNMANAGED_IMAGE_SLOT' };
    }
    const imageSourceTrace = sourceTrace
      ? bindWorkspaceSourceTraceToChat(reference.sourceTrace, sourceTrace)
      : undefined;
    const transferred = await input.transfer({
      sourceVersionId: reference.assetVersionId,
      targetProjectId: input.targetProjectId,
      index,
      ...(imageSourceTrace ? { sourceTrace: imageSourceTrace } : {}),
    });
    if (!hasManagedAssetIdentity(transferred)) {
      throw new Error('ASSET_TRANSFER_INVALID');
    }
    references.push(transferred);
  }
  input.writeBridge(references);
  return { ok: true, references };
}

export async function sendSimpleChatExportToCanvas(input: {
  runProjectId: string;
  imageRefs: WorkspaceAssetReference[];
  sourceTrace: SimpleChatWorkspaceSourceTrace;
  transfer: (input: {
    sourceVersionId: string;
    targetProjectId: string;
    index: number;
    sourceTrace?: WorkspaceAssetReference['sourceTrace'];
  }) => Promise<WorkspaceAssetReference>;
  writeBridge: (references: WorkspaceAssetReference[]) => void;
}): Promise<{
  ok: boolean;
  references: WorkspaceAssetReference[];
  reason?: 'UNMANAGED_IMAGE_SLOT';
}> {
  return sendSimpleChatMediaToCanvas({
    images: input.imageRefs.map(reference => reference.url),
    imageRefs: input.imageRefs,
    targetProjectId: input.runProjectId,
    sourceTrace: input.sourceTrace,
    transfer: async transferInput => {
      const reference = await input.transfer(transferInput);
      if (reference.assetVersionId !== transferInput.sourceVersionId) {
        throw new Error('EXPORT_ASSET_VERSION_MISMATCH');
      }
      return reference;
    },
    writeBridge: input.writeBridge,
  });
}

export function canTransferSimpleChatMedia(
  images: string[],
  imageRefs: WorkspaceAssetReference[],
): boolean {
  return images.length > 0
    && images.length === imageRefs.length
    && imageRefs.every((reference, index) => (
      reference.url === images[index]
      && hasManagedAssetIdentity(reference)
    ));
}

export async function consumeSimpleChatCanvasBridge(input: {
  payload: unknown;
  currentProjectId: string | null;
  resolveReference: (input: {
    projectId: string;
    assetVersionId: string;
    placementId: string;
  }) => Promise<WorkspaceAssetReference>;
  merge: (references: WorkspaceAssetReference[]) => void | Promise<void>;
  remove: () => void;
}): Promise<{
  status: 'waiting' | 'consumed';
  references: WorkspaceAssetReference[];
}> {
  if (!input.currentProjectId) return { status: 'waiting', references: [] };
  const bridgeProjectId = isRecord(input.payload) && typeof input.payload.projectId === 'string'
    ? input.payload.projectId
    : null;
  if (bridgeProjectId && bridgeProjectId !== input.currentProjectId) {
    return { status: 'waiting', references: [] };
  }

  const references: WorkspaceAssetReference[] = [];
  const candidates = mergeSimpleChatCanvasBridgeReferences(
    [],
    parseSimpleChatCanvasBridgePayload(input.payload),
  );
  for (const candidate of candidates) {
    if (hasManagedAssetIdentity(candidate)) {
      try {
        const canonical = await input.resolveReference({
          projectId: input.currentProjectId,
          assetVersionId: candidate.assetVersionId,
          placementId: candidate.placementId,
        });
        if (
          !hasManagedAssetIdentity(canonical)
          || canonical.assetVersionId !== candidate.assetVersionId
          || canonical.placementId !== candidate.placementId
          || (candidate.entityId && canonical.entityId !== candidate.entityId)
        ) {
          throw bridgeReferenceError('ASSET_REFERENCE_INVALID');
        }
        references.push(canonical);
      } catch (error) {
        if (isExplicitAssetNotFound(error)) continue;
        throw error;
      }
      continue;
    }
    // Legacy URL-only entries are parseable for cleanup, but are never trusted as
    // canvas media. Only server-resolved managed references may reach merge.
  }

  const uniqueReferences = mergeSimpleChatCanvasBridgeReferences([], references);
  await input.merge(uniqueReferences);
  input.remove();
  return { status: 'consumed', references: uniqueReferences };
}

export interface ChatArtifact {
  id: string;
  projectId: string;
  taskId: string;
  title: string;
  type: 'markdown' | 'html' | 'table' | 'json' | 'prompt' | 'code' | 'document';
  content: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface DeepResearchTask {
  id: string;
  projectId: string;
  chatTaskId: string;
  topic: string;
  status: 'planning' | 'searching' | 'writing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  steps: Array<{
    title: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    summary?: string;
  }>;
  sources: Array<{ title: string; url: string; snippet: string }>;
  reportMarkdown?: string;
  createdAt: number;
  updatedAt: number;
}

// ========== localStorage 持久化 ==========

const PROJECTS_KEY = 'wujie_chat_projects';

/** @deprecated Migration compatibility only. New sync consumers use the user-scoped envelope store. */
export function loadProjects(): SimpleChatProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** @deprecated Migration compatibility only. New sync consumers use the user-scoped envelope store. */
export function saveProjects(projects: SimpleChatProject[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // quota exceeded, ignore
  }
}

// ========== 预设 Skills（办公13 + 设计3 = 16个） ==========

export interface PresetSkill {
  id: string;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  icon: string;
  tags: string[];
}

export { SIMPLE_CHAT_PRESET_SKILLS as PRESET_SKILLS } from '@/lib/skill-runtime/simple-chat-presets';
