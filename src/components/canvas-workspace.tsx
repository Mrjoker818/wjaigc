'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { getResumedTaskPollingOutcome, RESUMED_TASK_MAX_POLL_ATTEMPTS, shouldStartResumedTaskPolling } from '@/lib/resumed-task-polling';
import { hasDirectVideoPollingTimedOut } from '@/lib/video-task-polling';
import {
  buildVideoFailureProcessing,
  createVideoRetryPayload,
} from '@/lib/video-processing-state';
import {
  applyCanvasTaskEventToProcessingPlaceholders,
  applyGenerationSlotsToProcessingPlaceholders,
  applyTaskIdsToProcessingPlaceholders,
  mergeLocalCompletedTaskProjection,
  preserveLocalCanvasTaskSlotOrder,
  shouldPersistProcessingPlaceholder,
} from '@/lib/canvas-task-placeholders';
import {
  createCanvasTaskEventError,
  type CanvasTaskEvent,
} from '@/lib/canvas-kernel/task-projection';
import {
  normalizeGenerationSubmitSlots,
  resolveGenerationSlotIndex,
} from '@/lib/task-core/generation-batch';
import {
  findUniqueLegacyTaskMatch,
  getLegacyRecoveryRetryAt,
  type RecoverableLegacyTask,
} from '@/lib/legacy-task-recovery';
import type { CanvasImage, ImageGroup } from '@/components/infinite-canvas';
import {
  restoreAnnotations,
  serializeAnnotations,
} from '@/features/annotations/annotation-persistence';
import { buildAnnotationSourceVersionId } from '@/features/annotations/annotation-source-version';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';
import { IncrementalHistoryManager } from '@/lib/canvas-incremental-history';
import {
  canvasSnapshotToNodes,
  createCanvasDocumentSnapshot,
  executeCanvasCommand,
  isCanvasTaskProjectionChange,
  rebaseCanvasSnapshotChanges,
  replayQueuedCanvasSnapshotChange,
} from '@/lib/canvas-kernel/commands';
import {
  CanvasPersistenceScheduler,
  prepareCanvasPersistenceSnapshot,
  type CanvasPersistenceSnapshot,
} from '@/lib/canvas-kernel/persistence';
import {
  isCanvasHistoryTransitionCurrent,
  type CanvasHistoryTransitionToken,
} from '@/lib/canvas-kernel/history';
import { TreeHistoryManager, type VersionNode } from '@/lib/canvas-tree-history';
import { createAutoConnection, type ConnectionRelationType } from '@/lib/canvas-connections';
import type { GenerationParams, CtrlRefSelection } from '@/components/generation-panel';
import type { VideoGenerationPanelHandle } from '@/components/video-generation-panel';
import type { QuickCreateCompileViewState, QuickCreateRequest } from '@/components/quick-create-panel';
import type { VectorDesignAsset } from '@/components/vector-design/vector-editor-dialog';
import {
  resolveQuickCreateModel,
  type QuickCreateModelCandidate,
  type ResolvedQuickCreateModel,
} from '@/lib/model-defaults';
import {
  createQuickCreateFallbackResult,
  shouldFallbackQuickCreateCompile,
  type QuickCreateModelSource,
  type QuickCreateCompileResult,
  type QuickCreateCompileSseEvent,
} from '@/lib/quick-create-compile';
import {
  flushQuickCreateSseBuffer,
  parseQuickCreateSseChunk,
} from '@/lib/quick-create-sse';

import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Image as ImageIcon, MessageSquare, Sparkles, ChevronLeft, ChevronRight, X, Bell } from 'lucide-react';
import { type Workflow, type WorkspaceAssetReference } from '@/lib/workflow-engine';
import { taskEventsClient } from '@/lib/task-events-client';
import { waitForTaskPollInterval } from '@/lib/task-polling-wait';
import type { WorkflowCanvasInsertionItem } from '@/lib/asset-core/workspace-transfer';
import {
  consumeSimpleChatCanvasBridge,
  resolveSimpleChatCanvasReference,
} from '@/components/simple-chat/simple-chat-types';

interface FavoriteItem {
  id: number;
  user_id: string;
  username: string;
  image_url: string;
  prompt: string;
  negative_prompt: string;
  model: string;
  model_name: string;
  aspect_ratio: string;
  quality: string;
  image_width: number;
  image_height: number;
  original_width: number;
  original_height: number;
  api_provider: string;
  api_base_url: string;
  source_type: string;
  created_at: number;
}
import { User, Project, ImageGroupData, CanvasImage as PersistableCanvasImage } from '@/lib/user-types';
import { UserManager as UserManagerCore } from '@/lib/user-manager';
import {
  hydrateCanvasPlacements,
  selectCanvasPlacementSnapshot,
  serializeCanvasWorkspacePlacements,
  shouldPersistCanvasPlacement,
  shouldRetainCanvasPlacementDuringMerge,
} from '@/lib/asset-core/canvas-adapter';
import {
  canvasEntityIdForTransferredReference,
  prepareCanvasAssetForChat,
} from '@/lib/asset-core/workspace-transfer';
import {
  reconcileImageBatchDeletion,
  reconcileManagedPlacementHistoryTransition,
  reconcileSelectedImageAfterBatchDeletion,
} from '@/lib/asset-core/batch-placement-delete';
import { normalizeCanvasViewState } from '@/lib/canvas-view-state';
import { buildProjectWorkspaceUrl } from '@/lib/project-workspace-url';
import { toStableImageUrl, awaitStableImageUrl } from '@/lib/stable-image-url';
import { APP_FULL_VERSION_LABEL, APP_NAME } from '@/config/app-meta';
import { fetchSessionPayload, resolveSessionUser } from '@/lib/auth-session';
import { workflowFromProjectMetadata } from '@/lib/project-workflow';
import {
  consumeCanvasPendingMediaRecovery,
  consumePreparedCanvasUnloadSnapshot,
  consumeCanvasHydrationGuard,
  createCanvasHydrationGuard,
  persistPreparedCanvasUnloadSnapshot,
  reconcileRecoveredCanvasImages,
  shouldConsumeCanvasHydrationGuard,
  type CanvasHydrationGuard,
} from '@/lib/canvas-autosave-guard';
import { shouldInitiallyCollapseWorkspacePanel } from '@/lib/workspace-panel-layout';
import { sendUserDataRecord } from '@/lib/user-data-record-client';

import { LoginPanel } from '@/components/dashboard/login-panel';

// Heavy components — lazy-loaded to keep initial JS bundle small.
const InfiniteCanvas = dynamic(() => import('@/components/infinite-canvas').then(m => m.InfiniteCanvas), { loading: () => null });
const GenerationPanel = dynamic(() => import('@/components/generation-panel').then(m => m.GenerationPanel), { loading: () => null });
const VideoGenerationPanel = dynamic(() => import('@/components/video-generation-panel'), { loading: () => null });
const ImagePreview = dynamic(() => import('@/components/image-preview').then(m => m.ImagePreview), { loading: () => null });
const ChatPanel = dynamic(() => import('@/components/chat-panel').then(m => m.ChatPanel), { loading: () => null });
const QuickCreatePanel = dynamic(() => import('@/components/quick-create-panel').then(m => m.QuickCreatePanel), { loading: () => null });
const VectorDesignPanel = dynamic(() => import('@/components/vector-design/vector-design-panel').then(m => m.VectorDesignPanel), { loading: () => null });
const PromptEquation = dynamic(() => import('@/components/prompt-equation').then(m => m.PromptEquation), { loading: () => null });
const NodeEditor = dynamic(() => import('@/components/node-editor'), { loading: () => null });
const WorkflowHub = dynamic(() => import('@/components/workflow-hub'), { loading: () => null });
const DashboardView = dynamic(() => import('@/components/dashboard/dashboard-view'), { loading: () => null });
const ImageEditor = dynamic(() => import('@/components/image-editor').then(m => m.ImageEditor), { loading: () => null });
const ProjectDataPanel = dynamic(() => import('@/components/project-data-panel').then(m => m.ProjectDataPanel), { loading: () => null });
const HelpGuide = dynamic(() => import('@/components/help-guide').then(m => m.HelpGuide), { loading: () => null });
const FavoritesPanel = dynamic(() => import('@/components/favorites-panel').then(m => m.FavoritesPanel), { loading: () => null });
const PromptTemplatePanel = dynamic(() => import('@/components/prompt-template-panel'), { loading: () => null });

type ThemeStyle = 'gold' | 'monochrome';
type ActivePanel = 'generate' | 'video' | 'chat';
type CreateMode = 'quick' | 'professional' | 'vector';

interface QuickCreateModelPolicy {
  autoModelRouting: boolean;
  globalDefault: string;
  quickCreateDefault: string;
}

interface QuickCreateModelsResponse {
  success?: boolean;
  error?: string;
  providers?: Array<{ id: string; name?: string; displayName?: string }>;
  models?: Array<{
    id: string;
    name?: string;
    providerId: string;
    providerName?: string;
    isDefault?: boolean;
  }>;
  quickCreatePolicy?: Partial<QuickCreateModelPolicy>;
}

const EMPTY_QUICK_CREATE_MODEL_POLICY: QuickCreateModelPolicy = {
  autoModelRouting: true,
  globalDefault: '',
  quickCreateDefault: '',
};

const EMPTY_QUICK_CREATE_COMPILE_STATE: QuickCreateCompileViewState = {
  phase: null,
  statusMessage: '',
  streamText: '',
  result: null,
  error: '',
  isCompiling: false,
};

const USER_DATA_RECORD_KEEPALIVE_BYTES = 60 * 1024;
let recordUserDataQueue: Promise<void> = Promise.resolve();

function getInitialProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('projectId');
}

function getInitialLoginMode(): 'canvas' | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('loginMode') === 'canvas' && !params.has('error') ? 'canvas' : null;
}

type WorkspaceMode = 'canvas' | 'node' | 'workflow-hub' | 'dashboard';

function getInitialWorkspaceMode(): WorkspaceMode {
  if (typeof window === 'undefined') return 'dashboard';
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'dashboard') return 'dashboard';
  if (params.has('projectId')) return 'canvas';
  if (params.get('loginMode') === 'canvas' && !params.has('error')) return 'canvas';
  return 'dashboard';
}

function normalizeQuickCreateModels(data: QuickCreateModelsResponse): QuickCreateModelCandidate[] {
  const providerNames = new Map(
    (data.providers ?? []).map(provider => [
      provider.id,
      provider.displayName || provider.name || provider.id,
    ])
  );

  return (data.models ?? []).map(model => ({
    id: `${model.providerId}::${model.id}`,
    providerId: model.providerId,
    modelId: model.id,
    name: model.name || model.id,
    providerName: model.providerName || providerNames.get(model.providerId) || model.providerId,
    isDefault: model.isDefault,
  }));
}

function normalizeQuickCreatePolicy(data: QuickCreateModelsResponse): QuickCreateModelPolicy {
  return {
    autoModelRouting: data.quickCreatePolicy?.autoModelRouting ?? true,
    globalDefault: data.quickCreatePolicy?.globalDefault ?? '',
    quickCreateDefault: data.quickCreatePolicy?.quickCreateDefault ?? '',
  };
}

function extractGeneratedImageUrls(payload: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const pushValue = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) {
      urls.push(value.startsWith('data:') || value.startsWith('http') || value.startsWith('/') ? value : `data:image/png;base64,${value}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      pushValue(item.url || item.image_url || item.imageUrl || item.b64_json);
    }
  };
  const result = payload.result as Record<string, unknown> | undefined;
  pushValue(payload.imageUrls);
  pushValue(result?.imageUrls);
  pushValue(payload.image_urls);
  pushValue(result?.image_urls);
  pushValue(payload.images);
  pushValue(result?.images);
  pushValue(result?.data);
  pushValue(payload.output);
  pushValue(result?.output);
  pushValue(payload.imageUrl || result?.imageUrl || result?.image);
  return Array.from(new Set(urls));
}

function recordUserData(input: {
  userId?: string;
  area: 'images' | 'chat' | 'projects' | 'uploads' | 'layers' | 'exports' | '3d';
  type: string;
  filename?: string;
  content?: string;
  dataUrl?: string;
  metadata?: Record<string, unknown>;
  payload?: unknown;
}) {
  if (!input.userId) return;
  const requestBody = JSON.stringify(input);
  const keepAliveAcrossNavigation = new Blob([requestBody]).size <= USER_DATA_RECORD_KEEPALIVE_BYTES;
  if (keepAliveAcrossNavigation) {
    void sendUserDataRecord({ requestBody, keepalive: keepAliveAcrossNavigation })
      .catch((error: unknown) => {
        console.warn('[activity] user-data record failed', error instanceof Error ? error.message : 'unknown error');
      });
    return;
  }
  recordUserDataQueue = recordUserDataQueue
    .catch(() => undefined)
    .then(() => sendUserDataRecord({ requestBody, keepalive: keepAliveAcrossNavigation }))
    .catch((error: unknown) => {
      console.warn('[activity] user-data record failed', error instanceof Error ? error.message : 'unknown error');
    })
    .finally(() => undefined);
}

function getCanvasImageDisplaySize(naturalWidth: number, naturalHeight: number) {
  const safeWidth = Math.max(1, naturalWidth || 512);
  const safeHeight = Math.max(1, naturalHeight || 512);
  const maxDisplaySide = 420;
  const scale = Math.min(maxDisplaySide / safeWidth, maxDisplaySide / safeHeight, 1);

  return {
    width: Math.round(safeWidth * scale),
    height: Math.round(safeHeight * scale),
  };
}

function loadCanvasImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 512, height: 512 });
    img.src = url;
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Blob 读取失败'));
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

async function persistCanvasSnapshotMedia(
  images: ReadonlyArray<PersistableCanvasImage>,
  userId: string,
): Promise<{ urlMapping: Record<string, string>; failedUrls: string[] }> {
  const pendingUrls = [...new Set(images
    .map(image => image.url)
    .filter(url => url.startsWith('data:') || url.startsWith('blob:')))];
  const results = await Promise.allSettled(pendingUrls.map(async (sourceUrl) => {
    let imageUrl = sourceUrl;
    if (sourceUrl.startsWith('blob:')) {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`Blob 读取失败: ${response.status}`);
      imageUrl = await blobToDataUrl(await response.blob());
    }
    const response = await fetch('/api/save-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, userId, sourceUrl }),
    });
    const payload = await response.json().catch(() => null) as { success?: boolean; url?: string; error?: string } | null;
    if (!response.ok || !payload?.success || !payload.url) {
      throw new Error(payload?.error || `图片持久化失败: ${response.status}`);
    }
    return { sourceUrl, persistedUrl: payload.url };
  }));

  const urlMapping: Record<string, string> = {};
  const failedUrls: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      urlMapping[result.value.sourceUrl] = result.value.persistedUrl;
    } else {
      failedUrls.push(pendingUrls[index]);
    }
  });
  return { urlMapping, failedUrls };
}

interface CanvasWorkspaceProps {
  initialUser: User;
  onLoggedOut: () => void;
}

type CanvasHistoryIntent = 'record' | 'skip';

interface CanvasImageChangeOptions {
  history?: CanvasHistoryIntent;
}

function rebaseCanvasImages(
  target: CanvasImage[],
  before: CanvasImage[],
  latest: CanvasImage[],
): CanvasImage[] {
  return canvasSnapshotToNodes(rebaseCanvasSnapshotChanges(
    createCanvasDocumentSnapshot(target),
    createCanvasDocumentSnapshot(before),
    createCanvasDocumentSnapshot(latest),
  )) as CanvasImage[];
}

export function CanvasWorkspace({ initialUser, onLoggedOut }: CanvasWorkspaceProps) {
  const requestCanvasTaskPoll = useCallback(
    (payload: Record<string, unknown>, options?: { signal?: AbortSignal }) => fetch('/api/poll-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }),
    [],
  );
  const [images, setImagesRaw] = useState<CanvasImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<CanvasImage | null>(null);

  // ====== Incremental Diff Undo (Ctrl+Z) / Redo (Ctrl+Shift+Z) History ======
  // Uses IncrementalHistoryManager for O(changes) memory instead of O(n) full snapshots.
  // Dragging one image records only {x, y} change, not the entire image array.
  const incrementalHistoryRef = useRef<IncrementalHistoryManager<CanvasImage>>(new IncrementalHistoryManager<CanvasImage>(50));
  const recentlyDeletedIdsRef = useRef<Set<string>>(new Set());
  const historyLifecyclePendingRef = useRef(false);
  const [historyTransitionPending, setHistoryTransitionPending] = useState(false);
  const historyTransitionEpochRef = useRef(0);
  const activeHistoryTransitionRef = useRef<CanvasHistoryTransitionToken | null>(null);
  const queuedCanvasHistoryChangeRef = useRef<{
    projectId: string | null;
    before: CanvasImage[];
    after: CanvasImage[];
  } | null>(null);
  const historyProjectIdRef = useRef<string | null>(null);
  const latestImagesRef = useRef(images);
  latestImagesRef.current = images;
  const isMountedRef = useRef(true);
  const prevImagesRef = useRef<CanvasImage[]>([]);
  // ★ 跳过历史记录标记：项目加载/服务器同步等非用户操作不记录 undo diff
  // 防止 Ctrl+Z 撤销到项目加载前的空画布状态
  const skipHistoryRef = useRef(false);

  // ====== Tree History (Version History Panel) ======
  // 树状版本历史，支持分支和任意节点回溯
  const treeHistoryRef = useRef<TreeHistoryManager>(new TreeHistoryManager({ maxNodes: 50 }));
  const [, ] = useState<VersionNode[]>([]);

  // P2-1: 画布连线状态
  const [canvasConnections, setCanvasConnections] = useState<import('@/lib/canvas-connections').CanvasConnection[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      quickCreateCompileControllerRef.current?.abort();
      quickCreateCompileControllerRef.current = null;
    };
  }, []);

  // Apply changes against the latest ref synchronously so pointerup can commit
  // the same explicit history transaction in the current event boundary.
  const setImages = useCallback((
    action: React.SetStateAction<CanvasImage[]>,
    options: CanvasImageChangeOptions = {},
  ) => {
      const prev = latestImagesRef.current;
      const queued = queuedCanvasHistoryChangeRef.current;
      const projectId = historyProjectIdRef.current;
      const actionBase = historyLifecyclePendingRef.current && queued?.projectId === projectId
        ? queued.after
        : prev;
      const next = typeof action === 'function' ? action(actionBase) : action;
      const historyIntent = options.history ?? (isCanvasTaskProjectionChange(actionBase, next) ? 'skip' : 'record');
      if (historyLifecyclePendingRef.current && historyIntent === 'record') {
        queuedCanvasHistoryChangeRef.current = queued?.projectId === projectId
          ? { ...queued, after: next }
          : { projectId, before: prev, after: next };
        return;
      }

      // ★ 检测被删除的图片ID，注册到 UserManagerCore 防止服务器同步恢复
      // 仅在非服务器同步期间检测，避免误将服务器端删除注册为本地删除
      if (next.length < prev.length && historyIntent !== 'skip') {
        const nextIdSet = new Set(next.map(img => img.id));
        const deletedIds = prev.filter(img => !nextIdSet.has(img.id)).map(img => img.id).filter(Boolean);
        if (deletedIds.length > 0) {
          try {
            UserManagerCore.getInstance().recordDeletedImageIds(deletedIds);
          } catch { /* non-blocking */ }
        }
      }

      // Record diff: always use the actual React state `prev` as the base.
      // ★ 修复：之前当 prevImagesRef 过期时（如 setImagesRaw 直接调用未更新 ref），
      // 会使用过期的 prevImagesRef.current（可能为 []）作为基准，
      // 导致 recordChange([], allImages) 被记录，Ctrl+Z 时所有图片被移除。
      // 现在始终使用 prev（真实 React 状态）作为基准，确保 diff 计算正确。
      // ★ 跳过非用户操作（项目加载/服务器同步）的 diff 记录，防止 Ctrl+Z 撤销到空画布
      if (historyIntent === 'skip') {
        // Hydration, server reconciliation and transient task progress do not
        // represent user-editable commands.
      } else if (!skipHistoryRef.current) {
        // 安全防护：如果 prev 为空但 next 包含多张图片，可能是项目加载未被 skipHistory 拦截
        // 这种情况下跳过 diff 记录，避免记录"从空到全部图片"的错误 diff
        const isBulkLoad = prev.length === 0 && next.length > 1;
        if (!isBulkLoad && (prev.length > 0 || next.length > 0)) {
          incrementalHistoryRef.current.recordChange(prev, next);
        }
      }

      prevImagesRef.current = next;
      latestImagesRef.current = next;
      setImagesRaw(next);
  }, []);

  const projectWorkspaceTaskEvent = useCallback((event: CanvasTaskEvent) => {
    setImages((current) => applyCanvasTaskEventToProcessingPlaceholders(current, event));
  }, [setImages]);

  const flushQueuedCanvasHistoryChange = useCallback(() => {
    const queued = queuedCanvasHistoryChangeRef.current;
    queuedCanvasHistoryChangeRef.current = null;
    if (!queued) return;
    const replayed = replayQueuedCanvasSnapshotChange(
      historyProjectIdRef.current,
      createCanvasDocumentSnapshot(latestImagesRef.current),
      {
        projectId: queued.projectId,
        before: createCanvasDocumentSnapshot(queued.before),
        after: createCanvasDocumentSnapshot(queued.after),
      },
    );
    if (replayed) setImages(canvasSnapshotToNodes(replayed) as CanvasImage[]);
  }, [setImages]);

  const isActiveCanvasHistoryTransition = useCallback((transition: CanvasHistoryTransitionToken): boolean => (
    activeHistoryTransitionRef.current === transition
      && isCanvasHistoryTransitionCurrent(
        transition,
        historyProjectIdRef.current,
        historyTransitionEpochRef.current,
      )
  ), []);

  const beginCanvasHistoryTransaction = useCallback((id: string) => {
    incrementalHistoryRef.current.beginTransaction(id);
  }, []);

  const commitCanvasHistoryTransaction = useCallback((id: string) => {
    incrementalHistoryRef.current.commitTransaction(id);
  }, []);

  const rollbackCanvasHistoryTransaction = useCallback((id: string) => {
    const current = latestImagesRef.current;
    const rolledBack = incrementalHistoryRef.current.rollbackTransaction(id, current);
    if (rolledBack !== current) {
      prevImagesRef.current = rolledBack;
      latestImagesRef.current = rolledBack;
      setImagesRaw(rolledBack);
    }
  }, []);

  const syncAssetV3HistoryTransition = useCallback(async (
    before: CanvasImage[],
    after: CanvasImage[],
  ): Promise<void> => {
    const manager = UserManagerCore.getInstance();
    if (manager.getAssetGraphMode() !== 'asset-v3') return;
    const projectId = historyProjectIdRef.current;
    if (!projectId) throw new Error('当前项目不存在');
    const readRevision = async (response: Response): Promise<void> => {
      const payload = await response.json().catch(() => null) as { projectRevision?: number; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || '素材图谱历史同步失败');
      if (Number.isSafeInteger(payload?.projectRevision)) {
        manager.advanceProjectSyncRevision(Number(payload?.projectRevision));
      }
    };
    const restorePlacement = async (image: CanvasImage & { assetId: string; placementId: string }): Promise<void> => {
      const response = await fetch(`/api/assets/${encodeURIComponent(image.assetId)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, placementId: image.placementId }),
      });
      await readRevision(response);
    };
    const trashPlacement = async (image: CanvasImage & { assetId: string; placementId: string }): Promise<void> => {
      const response = await fetch(`/api/assets/placements/${encodeURIComponent(image.placementId)}?projectId=${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
      });
      await readRevision(response);
    };
    const commitSnapshot = (items: readonly CanvasImage[]): void => {
      manager.updateProject(projectId, {
        canvasImages: serializeCanvasWorkspacePlacements([...items]),
      });
    };

    await reconcileManagedPlacementHistoryTransition(before, after, {
      restorePlacement,
      trashPlacement,
      commitSnapshot,
    });
    const beforeIds = new Set(before.map((image) => image.id));
    const restoredIds = after.filter((image) => !beforeIds.has(image.id)).map((image) => image.id);
    restoredIds.forEach((id) => recentlyDeletedIdsRef.current.delete(id));
    manager.clearRecentlyDeletedImageIds(restoredIds);
  }, []);

  const handleUndo = useCallback(async () => {
    if (!incrementalHistoryRef.current.canUndo() || historyLifecyclePendingRef.current) return;
    const previous = latestImagesRef.current;
    const result = incrementalHistoryRef.current.undo(previous);
    if (result === previous) return;
    if (result.length === 0 && previous.length > 1) {
      incrementalHistoryRef.current.redo(result);
      console.warn('[Undo] 阻止了清空所有图片的撤销操作, prev count:', previous.length);
      return;
    }
    historyLifecyclePendingRef.current = true;
    const transition: CanvasHistoryTransitionToken = {
      projectId: historyProjectIdRef.current,
      epoch: historyTransitionEpochRef.current,
    };
    activeHistoryTransitionRef.current = transition;
    setHistoryTransitionPending(true);
    try {
      if (UserManagerCore.getInstance().getAssetGraphMode() === 'asset-v3') {
        await syncAssetV3HistoryTransition(previous, result);
      }
      if (!isActiveCanvasHistoryTransition(transition)) return;
      const committed = rebaseCanvasImages(result, previous, latestImagesRef.current);
      prevImagesRef.current = committed;
      latestImagesRef.current = committed;
      setImagesRaw(committed);
    } catch (error) {
      if (!isActiveCanvasHistoryTransition(transition)) return;
      incrementalHistoryRef.current.redo(result);
      toast.error(error instanceof Error ? error.message : '撤销失败');
    } finally {
      if (isActiveCanvasHistoryTransition(transition)) {
        activeHistoryTransitionRef.current = null;
        historyLifecyclePendingRef.current = false;
        setHistoryTransitionPending(false);
        flushQueuedCanvasHistoryChange();
      }
    }
  }, [flushQueuedCanvasHistoryChange, isActiveCanvasHistoryTransition, syncAssetV3HistoryTransition]);

  const handleRedo = useCallback(async () => {
    if (!incrementalHistoryRef.current.canRedo() || historyLifecyclePendingRef.current) return;
    const previous = latestImagesRef.current;
    const result = incrementalHistoryRef.current.redo(previous);
    if (result === previous) return;
    historyLifecyclePendingRef.current = true;
    const transition: CanvasHistoryTransitionToken = {
      projectId: historyProjectIdRef.current,
      epoch: historyTransitionEpochRef.current,
    };
    activeHistoryTransitionRef.current = transition;
    setHistoryTransitionPending(true);
    try {
      if (UserManagerCore.getInstance().getAssetGraphMode() === 'asset-v3') {
        await syncAssetV3HistoryTransition(previous, result);
      }
      if (!isActiveCanvasHistoryTransition(transition)) return;
      const committed = rebaseCanvasImages(result, previous, latestImagesRef.current);
      prevImagesRef.current = committed;
      latestImagesRef.current = committed;
      setImagesRaw(committed);
    } catch (error) {
      if (!isActiveCanvasHistoryTransition(transition)) return;
      incrementalHistoryRef.current.undo(result);
      toast.error(error instanceof Error ? error.message : '重做失败');
    } finally {
      if (isActiveCanvasHistoryTransition(transition)) {
        activeHistoryTransitionRef.current = null;
        historyLifecyclePendingRef.current = false;
        setHistoryTransitionPending(false);
        flushQueuedCanvasHistoryChange();
      }
    }
  }, [flushQueuedCanvasHistoryChange, isActiveCanvasHistoryTransition, syncAssetV3HistoryTransition]);
  const [activeGenerationCount, setActiveGenerationCount] = useState(0);
  const [previewImage, setPreviewImage] = useState<CanvasImage | null>(null);
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>('gold');
  const themeStyleRef = useRef(themeStyle);
  themeStyleRef.current = themeStyle;
  const [panelCollapsed, setPanelCollapsed] = useState(() => (
    typeof window !== 'undefined' && shouldInitiallyCollapseWorkspacePanel(window.innerWidth)
  ));
  const [activePanel, setActivePanel] = useState<ActivePanel>('generate');
  const [createMode, setCreateMode] = useState<CreateMode>('quick');
  const [quickCreateImageModels, setQuickCreateImageModels] = useState<QuickCreateModelCandidate[]>([]);
  const [quickCreateChatModels, setQuickCreateChatModels] = useState<QuickCreateModelCandidate[]>([]);
  const [quickCreateImagePolicy, setQuickCreateImagePolicy] = useState<QuickCreateModelPolicy>(EMPTY_QUICK_CREATE_MODEL_POLICY);
  const [quickCreateChatPolicy, setQuickCreateChatPolicy] = useState<QuickCreateModelPolicy>(EMPTY_QUICK_CREATE_MODEL_POLICY);
  const [quickCreateModelsLoading, setQuickCreateModelsLoading] = useState(false);
  const [quickCreateModelsError, setQuickCreateModelsError] = useState('');
  const [quickCreateCompileState, setQuickCreateCompileState] = useState<QuickCreateCompileViewState>(EMPTY_QUICK_CREATE_COMPILE_STATE);
  const quickCreateCompileControllerRef = useRef<AbortController | null>(null);
  // 从工作台加载指定项目
  const loadProjectById = useCallback(async (projectId: string) => {
    try {
      // ★ 加载项目前：清空 undo 历史 + 跳过 diff 记录，防止 Ctrl+Z 撤销到空画布
      skipHistoryRef.current = true;
      historyTransitionEpochRef.current += 1;
      activeHistoryTransitionRef.current = null;
      historyLifecyclePendingRef.current = false;
      setHistoryTransitionPending(false);
      queuedCanvasHistoryChangeRef.current = null;
      historyProjectIdRef.current = projectId;
      incrementalHistoryRef.current.clear();
      prevImagesRef.current = [];
      quickCreateCompileControllerRef.current?.abort();
      quickCreateCompileControllerRef.current = null;
      setQuickCreateCompileState(EMPTY_QUICK_CREATE_COMPILE_STATE);

      const userMgr = UserManagerCore.getInstance();
      const projects = userMgr.getProjects();
      const storedProject = projects.find((p: Project) => p.id === projectId);
      if (storedProject) {
        const recoveryOwnerId = userMgr.getUser()?.id ?? '';
        const recoveredCanvasSnapshot = consumePreparedCanvasUnloadSnapshot(
          storedProject.id,
          userMgr.getProjectSyncRevision(),
          localStorage,
          recoveryOwnerId,
        );
        const pendingMediaMarker = consumeCanvasPendingMediaRecovery(
          storedProject.id,
          localStorage,
          recoveryOwnerId,
        );
        const hadPendingMedia = Boolean(recoveredCanvasSnapshot && pendingMediaMarker);
        const recoveredMedia = recoveredCanvasSnapshot
          ? reconcileRecoveredCanvasImages(recoveredCanvasSnapshot.images, storedProject.canvasImages)
          : null;
        const targetProject = recoveredCanvasSnapshot
          ? {
              ...storedProject,
              canvasImages: [...(recoveredMedia?.images ?? recoveredCanvasSnapshot.images)],
              metadata: recoveredCanvasSnapshot.metadata,
              updatedAt: Date.now(),
            }
          : storedProject;
        if (recoveredCanvasSnapshot) {
          userMgr.updateProject(targetProject.id, {
            canvasImages: targetProject.canvasImages,
            metadata: targetProject.metadata,
          });
        }
        if (hadPendingMedia) {
          toast.warning(recoveredMedia?.discardedBlobIds.length
            ? '部分临时图片在页面关闭前未完成上传，请重新上传缺失图片。'
            : '临时图片已从本地恢复，正在继续保存。');
        }
        hydrationAutosaveGuardRef.current = createCanvasHydrationGuard(
          targetProject.id,
          hydrateCanvasPlacements(targetProject.canvasImages || []),
        );
        window.history.replaceState(
          null,
          '',
          buildProjectWorkspaceUrl(window.location, targetProject.id),
        );
        setCurrentProject(targetProject);
        setNodeWorkflow(workflowFromProjectMetadata(targetProject.metadata));
        const restoredViewState = normalizeCanvasViewState(targetProject.metadata?.viewState);
        viewStateRef.current = restoredViewState;
        setViewState(restoredViewState);
        // ★ 调试日志：追踪项目加载
        console.log('[page] loadProjectById:', targetProject.id, targetProject.name, 'canvasImages:', targetProject.canvasImages?.length || 0);
        if (targetProject.canvasImages && targetProject.canvasImages.length > 0) {
          setImages(hydrateCanvasPlacements(targetProject.canvasImages).map(img => ({
            ...img,
            id: img.id,
            url: img.url,
            prompt: img.prompt || '',
            modifyPrompt: img.modifyPrompt || '',
            model: img.model || '',
            quality: img.quality || '',
            aspectRatio: img.aspectRatio || '',
            stylePreset: img.stylePreset || '',
            category: img.category || '',
            size: img.size || '',
            groupId: img.groupId || '',
            threeDModelUrl: img.threeDModelUrl || '',
            threeDModelUrls: img.threeDModelUrls || undefined,
            x: img.x,
            y: img.y,
            width: img.width || 256,
            height: img.height || 256,
            originalWidth: img.originalWidth || 512,
            originalHeight: img.originalHeight || 512,
            svgDataUrl: img.svgDataUrl || undefined,
            // Video fields — must be preserved to avoid data loss on project load
            videoUrl: img.videoUrl || undefined,
            videoDuration: img.videoDuration || undefined,
            videoThumbnailUrl: img.videoThumbnailUrl || undefined,
            mediaType: img.mediaType || undefined,
            isPlaying: img.isPlaying || false,
            // Metadata fields — must be preserved for display
            modelName: img.modelName || undefined,
            apiProviderId: img.apiProviderId || undefined,
            apiProvider: img.apiProvider || undefined,
            generationRouteAudit: img.generationRouteAudit || undefined,
            generatedFromImageId: img.generatedFromImageId || undefined,
            relationType: img.relationType || undefined,
            isProcessingPlaceholder: img.isProcessingPlaceholder || false,
            processing: img.processing ? { ...img.processing, isResumed: true } : undefined,
          })) as CanvasImage[], { history: 'skip' });
        } else {
          setImages([], { history: 'skip' });
        }
        if (targetProject.metadata?.groups) {
          groupsRef.current = targetProject.metadata.groups as ImageGroupData[];
        }
      }

      // ★ 加载完成后恢复 diff 记录（延迟，确保 setImages 的回调已执行完毕）
      setTimeout(() => { skipHistoryRef.current = false; }, 0);
    } catch (e) {
      skipHistoryRef.current = false;
      console.error('加载项目失败:', e);
    }
  }, [setImages]);

  const [appMode, setAppMode] = useState<WorkspaceMode>(getInitialWorkspaceMode);
  const [pendingModeSwitch, setPendingModeSwitch] = useState<'node' | 'workflow-hub' | 'dashboard' | null>(null);
  // Start with true so SSR renders the login panel (not a blank spinner).
  // The useEffect below will update currentUser if a valid session exists.
  const [authChecked, setAuthChecked] = useState(true);
  const initialProjectIdRef = useRef(getInitialProjectId());
  const initialLoginModeRef = useRef(getInitialLoginMode());

  const [showProjectData, setShowProjectData] = useState(false);
  const [navigateToImageId, setNavigateToImageId] = useState<string | null>(null);
  const [showHelpGuide, setShowHelpGuide] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showPromptTemplate, setShowPromptTemplate] = useState(false);
  const [favoriteParams, setFavoriteParams] = useState<{
    prompt: string;
    negativePrompt?: string;
    model?: string;
    aspectRatio?: string;
    quality?: string;
  } | null>(null);
  const [initialGroups, setInitialGroups] = useState<ImageGroup[]>([]);
  const [, setViewState] = useState<{ offsetX: number; offsetY: number; zoom: number } | null>(null);
  const viewStateRef = useRef<{ offsetX: number; offsetY: number; zoom: number } | null>(null);
  const [ctrlRefSelections, setCtrlRefSelections] = useState<CtrlRefSelection[]>([]);
  // Alt+Click inline reference markers (displayed as numbered tags in the prompt textarea)
  const [altRefMarkers, setAltRefMarkers] = useState<Array<{id: string; url: string; number: number}>>([]);
  const [showPromptEquation, setShowPromptEquation] = useState(false);
  const [announcement, setAnnouncement] = useState<{ text: string; type: string; id: string; displayMode?: string } | null>(null);
  const [showAnnouncement, setShowAnnouncement] = useState(true);
  const dismissedAnnouncementsRef = useRef<Set<string>>(new Set());

  // Language-based image editing state
  const [showImageEditor, setShowImageEditor] = useState(false);
  const [editingImage, setEditingImage] = useState<CanvasImage | null>(null);

  // Floating video panel state
  const [showVideoPanel, setShowVideoPanel] = useState(false);
  const [externalVideoPrompt, setExternalVideoPrompt] = useState<string>();
  const [externalVideoMode, setExternalVideoMode] = useState<'generate' | 'extend'>('generate');

  useEffect(() => {
    const openVideoPanel = () => {
      setShowImageEditor(false);
      setShowVideoPanel(true);
    };
    window.addEventListener('wujie:open-video-panel', openVideoPanel);
    return () => window.removeEventListener('wujie:open-video-panel', openVideoPanel);
  }, []);

  useEffect(() => {
    const closeExternalToolPanels = () => {
      setShowImageEditor(false);
      setShowVideoPanel(false);
    };
    window.addEventListener('wujie:canvas-tool-opened', closeExternalToolPanels);
    return () => window.removeEventListener('wujie:canvas-tool-opened', closeExternalToolPanels);
  }, []);

  // Chat panel integration states
  const [chatInitialImage, setChatInitialImage] = useState<CanvasImage | null>(null);
  const [chatTabOpen, setChatTabOpen] = useState(false);

  // Current chat model info from ChatPanel (used for vision-prompt)
  const [currentChatModelInfo, setCurrentChatModelInfo] = useState<{
    model: string; providerId: string; providerPreset?: string;
  } | null>(null);

  // ★ 检测画布中是否有进行中的生图任务
  const hasActiveCanvasTasks = images.some(img => shouldPersistProcessingPlaceholder(img) || img.processing?.status === 'processing');

  // 安全切换模式：有进行中任务时弹窗确认
  const safeSwitchMode = useCallback((targetMode: 'node' | 'workflow-hub' | 'dashboard') => {
    if (hasActiveCanvasTasks) {
      setPendingModeSwitch(targetMode);
    } else {
      setAppMode(targetMode);
    }
  }, [hasActiveCanvasTasks]);

  const confirmModeSwitch = useCallback(() => {
    // 不移除占位框 — 轮询在后台继续运行，结果通过 setImages 持久化
    // 切换回画布时即可看到已完成的结果
    setPendingModeSwitch(null);
    if (pendingModeSwitch) {
      setAppMode(pendingModeSwitch);
    }
  }, [pendingModeSwitch]);

  const cancelModeSwitch = useCallback(() => {
    setPendingModeSwitch(null);
  }, []);

  // Oh My Prompt - Vision Prompt state
  const [visionPromptEnabled, setVisionPromptEnabled] = useState(false);
  const [isVisionAnalyzing, setIsVisionAnalyzing] = useState(false);
  const [visionResult, setVisionResult] = useState<import('@/components/oh-my-prompt').VisionApiResultData | null>(null);

  // Fetch system announcement
  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        const dismissed = localStorage.getItem('dismissed_announcements');
        if (dismissed) {
          dismissedAnnouncementsRef.current = new Set(JSON.parse(dismissed));
        }
        const res = await fetch('/api/announcement', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json() as { success: boolean; announcement?: { text: string; type: string; enabled: boolean; displayMode?: string } };
          if (data.success && data.announcement?.enabled && data.announcement.text?.trim()) {
            const displayMode = data.announcement.displayMode || 'banner';
            const id = `${displayMode}:${data.announcement.text.slice(0, 64)}`;
            if (!dismissedAnnouncementsRef.current.has(id)) {
              setAnnouncement({ text: data.announcement.text, type: data.announcement.type || 'info', id, displayMode });
              setShowAnnouncement(true);
            }
          }
        }
      } catch { /* ignore */ }
    };
    fetchAnnouncement();
  }, []);

  const dismissAnnouncement = useCallback(() => {
    if (!announcement) return;
    dismissedAnnouncementsRef.current.add(announcement.id);
    localStorage.setItem('dismissed_announcements', JSON.stringify([...dismissedAnnouncementsRef.current]));
    setShowAnnouncement(false);
  }, [announcement]);

  // Initialize current user and admin UI state
  useEffect(() => {
    let cancelled = false;
    const initCurrentUser = async () => {
      try {
        const data = await fetchSessionPayload() as { success?: boolean; user?: User | null };
        if (cancelled) return;
        const sessionResolution = resolveSessionUser(initialUser, data);
        if (sessionResolution.status === 'indeterminate') {
          console.warn('[auth] session revalidation was indeterminate; preserving authenticated workspace');
          setAuthChecked(true);
          return;
        }
        if (sessionResolution.status === 'unauthenticated') {
          void Promise.resolve()
            .then(() => UserManagerCore.getInstance().logout())
            .catch((error: unknown) => {
              console.warn('[auth] background local session cleanup failed', error);
            });
          setAuthChecked(true);
          onLoggedOut();
          return;
        }

        if (sessionResolution.status === 'authenticated') {
          const sessionUser = sessionResolution.user;

          const projectId = initialProjectIdRef.current;
          if (!projectId) {
            setCurrentUser(sessionUser);
            setAuthChecked(true);
            const sessionInitialMode = initialLoginModeRef.current === 'canvas'
              ? 'canvas'
              : 'dashboard';
            setAppMode(currentMode => (
              currentMode === 'dashboard' ? sessionInitialMode : currentMode
            ));
            return;
          }

          const userMgr = UserManagerCore.getInstance();
          const hydratedUser = await userMgr.upsertUserFromServer(sessionUser);
          setCurrentUser(hydratedUser);
          await userMgr.waitForProjectHydration(hydratedUser.id);

          // 检查 URL 中是否有 projectId 参数（从工作台跳转过来）
          if (projectId) {
            // ★ 初始化加载项目：跳过 diff 记录，防止 Ctrl+Z 撤销到空画布
            skipHistoryRef.current = true;
            incrementalHistoryRef.current.clear();
            prevImagesRef.current = [];

            // 从工作台跳转过来，加载指定项目
            try {
              const projects = userMgr.getProjects();
              const storedProject = projects.find((p: Project) => p.id === projectId);
              if (storedProject) {
                const recoveredCanvasSnapshot = consumePreparedCanvasUnloadSnapshot(
                  storedProject.id,
                  userMgr.getProjectSyncRevision(),
                  localStorage,
                  hydratedUser.id,
                );
                const pendingMediaMarker = consumeCanvasPendingMediaRecovery(
                  storedProject.id,
                  localStorage,
                  hydratedUser.id,
                );
                const hadPendingMedia = Boolean(recoveredCanvasSnapshot && pendingMediaMarker);
                const recoveredMedia = recoveredCanvasSnapshot
                  ? reconcileRecoveredCanvasImages(recoveredCanvasSnapshot.images, storedProject.canvasImages)
                  : null;
                const targetProject = recoveredCanvasSnapshot
                  ? {
                      ...storedProject,
                      canvasImages: [...(recoveredMedia?.images ?? recoveredCanvasSnapshot.images)],
                      metadata: recoveredCanvasSnapshot.metadata,
                      updatedAt: Date.now(),
                    }
                  : storedProject;
                if (recoveredCanvasSnapshot) {
                  userMgr.updateProject(targetProject.id, {
                    canvasImages: targetProject.canvasImages,
                    metadata: targetProject.metadata,
                  });
                }
                if (hadPendingMedia) {
                  toast.warning(recoveredMedia?.discardedBlobIds.length
                    ? '部分临时图片在页面关闭前未完成上传，请重新上传缺失图片。'
                    : '临时图片已从本地恢复，正在继续保存。');
                }
                hydrationAutosaveGuardRef.current = createCanvasHydrationGuard(
                  targetProject.id,
                  hydrateCanvasPlacements(targetProject.canvasImages || []),
                );
                setCurrentProject(targetProject);
                setNodeWorkflow(workflowFromProjectMetadata(targetProject.metadata));
                if (targetProject.canvasImages && targetProject.canvasImages.length > 0) {
                setImages(hydrateCanvasPlacements(targetProject.canvasImages).map(img => ({
                  ...img,
                    id: img.id,
                    url: img.url,
                    prompt: img.prompt || '',
                    modifyPrompt: img.modifyPrompt || '',
                    model: img.model || '',
                    quality: img.quality || '',
                    aspectRatio: img.aspectRatio || '',
                    stylePreset: img.stylePreset || '',
                    category: img.category || '',
                    size: img.size || '',
                    groupId: img.groupId || '',
                    threeDModelUrl: img.threeDModelUrl || '',
                    threeDModelUrls: img.threeDModelUrls || undefined,
                    x: img.x,
                    y: img.y,
                    width: img.width || 256,
                    height: img.height || 256,
                    originalWidth: img.originalWidth || 512,
                    originalHeight: img.originalHeight || 512,
                    createdAt: img.createdAt || Date.now(),
                    modelName: img.modelName || '',
                    apiProviderId: img.apiProviderId || '',
                    apiProvider: img.apiProvider || '',
                    apiBaseUrl: img.apiBaseUrl || '',
                    generationRouteAudit: img.generationRouteAudit || undefined,
                    // Video fields — must be preserved to avoid data loss on project load
                    videoUrl: img.videoUrl || undefined,
                    videoDuration: img.videoDuration || undefined,
                    videoThumbnailUrl: img.videoThumbnailUrl || undefined,
                    mediaType: img.mediaType || undefined,
                    isPlaying: img.isPlaying || false,
                    svgDataUrl: img.svgDataUrl || undefined,
                    generatedFromImageId: img.generatedFromImageId || undefined,
                    relationType: img.relationType || undefined,
                    isProcessingPlaceholder: img.isProcessingPlaceholder || false,
                    processing: img.processing ? { ...img.processing, isResumed: true } : undefined,
                  })) as CanvasImage[]);
                  // 恢复分组数据
                  const metaGroups = targetProject.metadata?.groups;
                  let restoredGroups: Array<{id: string; name: string; note: string; imageIds: string[]; x: number; y: number; collapsed: boolean}> = [];
                  if (metaGroups && metaGroups.length > 0) {
                    restoredGroups = metaGroups.map(g => ({
                      id: g.id,
                      name: g.name,
                      note: g.note || '',
                      imageIds: g.imageIds,
                      x: g.x || 0,
                      y: g.y || 0,
                      collapsed: g.collapsed || false,
                    }));
                  } else {
                    try {
                      const lsGroups = localStorage.getItem(`wujie-groups-${targetProject.id}`);
                      if (lsGroups) restoredGroups = JSON.parse(lsGroups);
                    } catch {}
                  }
                  setInitialGroups(restoredGroups);
                  // 恢复视图状态
                  const metaViewState = targetProject.metadata?.viewState;
                  if (metaViewState && typeof metaViewState === 'object' && 'offsetX' in metaViewState) {
                    setViewState(metaViewState as { offsetX: number; offsetY: number; zoom: number });
                    viewStateRef.current = metaViewState as { offsetX: number; offsetY: number; zoom: number };
                  }
                }
              }
            } catch { /* non-blocking */ }
            // ★ 初始化项目加载完成，恢复 diff 记录
            setTimeout(() => { skipHistoryRef.current = false; }, 0);
          } else {
            // 无 projectId → 显示工作台视图（在画布页面内部）
            setAuthChecked(true);
            setAppMode('dashboard');
            return;
          }
          setAuthChecked(true);
          return;
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[auth] session revalidation failed; preserving authenticated workspace', error);
          setAuthChecked(true);
        }
      }
    };
    void initCurrentUser();
    return () => {
      cancelled = true;
    };
  }, [initialUser, onLoggedOut, setImages]);
  const [currentUser, setCurrentUser] = useState<User | null>(initialUser);
  const cacheHydrationUserIdRef = useRef<string | null>(null);

  // Hydrate the local project cache only after the authenticated workspace has rendered.
  useEffect(() => {
    if (!authChecked || !currentUser || initialProjectIdRef.current) return;
    if (cacheHydrationUserIdRef.current === currentUser.id) return;

    cacheHydrationUserIdRef.current = currentUser.id;
    let cancelled = false;
    void UserManagerCore.getInstance().upsertUserFromServer(currentUser)
      .then((hydratedUser) => {
        if (!cancelled) setCurrentUser(hydratedUser);
      })
      .catch((error: unknown) => {
        console.warn('[auth] background client hydration failed', error);
      });

    return () => {
      cancelled = true;
    };
  }, [authChecked, currentUser]);

  const quickCreateUserId = currentUser?.id;
  const quickCreateModelAccessSignature = useMemo(() => JSON.stringify({
    id: currentUser?.id ?? '',
    role: currentUser?.role ?? 'user',
    groupId: currentUser?.groupId ?? '',
    chatModels: [...(currentUser?.chatModels ?? [])].sort(),
    imageModels: [...(currentUser?.imageModels ?? [])].sort(),
    apiPermissions: Object.entries(currentUser?.apiPermissions ?? {}).sort(([left], [right]) => (
      left.localeCompare(right)
    )),
  }), [currentUser]);
  useEffect(() => {
    if (!authChecked || !quickCreateUserId) {
      setQuickCreateImageModels([]);
      setQuickCreateChatModels([]);
      setQuickCreateImagePolicy(EMPTY_QUICK_CREATE_MODEL_POLICY);
      setQuickCreateChatPolicy(EMPTY_QUICK_CREATE_MODEL_POLICY);
      setQuickCreateModelsError('');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const loadQuickCreateModels = async (): Promise<void> => {
      setQuickCreateModelsLoading(true);
      setQuickCreateModelsError('');

      try {
        const [imageResponse, chatResponse] = await Promise.all([
          fetch('/api/models?type=image', { signal: controller.signal }),
          fetch('/api/models?type=chat', { signal: controller.signal }),
        ]);
        const [imageData, chatData] = await Promise.all([
          imageResponse.json() as Promise<QuickCreateModelsResponse>,
          chatResponse.json() as Promise<QuickCreateModelsResponse>,
        ]);

        if (!imageResponse.ok || imageData.success === false) {
          throw new Error(imageData.error || '图像模型加载失败');
        }
        if (!chatResponse.ok || chatData.success === false) {
          throw new Error(chatData.error || 'LLM 模型加载失败');
        }
        if (cancelled) return;

        setQuickCreateImageModels(normalizeQuickCreateModels(imageData));
        setQuickCreateChatModels(normalizeQuickCreateModels(chatData));
        setQuickCreateImagePolicy(normalizeQuickCreatePolicy(imageData));
        setQuickCreateChatPolicy(normalizeQuickCreatePolicy(chatData));
      } catch (error) {
        if (controller.signal.aborted || cancelled) return;
        setQuickCreateImageModels([]);
        setQuickCreateChatModels([]);
        setQuickCreateImagePolicy(EMPTY_QUICK_CREATE_MODEL_POLICY);
        setQuickCreateChatPolicy(EMPTY_QUICK_CREATE_MODEL_POLICY);
        setQuickCreateModelsError(error instanceof Error ? error.message : '快速创作模型加载失败');
      } finally {
        if (!cancelled) setQuickCreateModelsLoading(false);
      }
    };

    void loadQuickCreateModels();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authChecked, quickCreateUserId, quickCreateModelAccessSignature]);

  const [ohMyPromptOpen, setOhMyPromptOpen] = useState(false);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  historyProjectIdRef.current = currentProject?.id ?? null;
  const currentProjectRef = useRef(currentProject);
  currentProjectRef.current = currentProject;
  const hydrationAutosaveGuardRef = useRef<CanvasHydrationGuard | null>(null);
  const immediateSaveGuardRef = useRef<CanvasHydrationGuard | null>(null);

  const resolveCanvasImageForChat = useCallback(async (image: CanvasImage): Promise<CanvasImage> => {
    return prepareCanvasAssetForChat(image, async () => {
      if (!currentProject?.id) throw new Error('Missing target project');
        const response = await fetch('/api/assets/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceVersion: image.assetVersionId,
            targetProject: currentProject.id,
            targetWorkspace: `embedded-chat:${currentProject.id}`,
            entityType: 'chat-attachment',
            entityId: image.id,
            idempotencyKey: `canvas-chat:${currentProject.id}:${image.id}:${image.assetVersionId}`,
            metadata: { name: image.prompt?.slice(0, 80) || '画布图片', source: 'canvas' },
          }),
        });
      if (!response.ok) throw new Error(`Asset transfer failed (${response.status})`);
      return response.json() as Promise<WorkspaceAssetReference>;
    });
  }, [currentProject?.id]);

  const handleSendCanvasImageToChat = useCallback(async (image: CanvasImage) => {
    const transferredImage = await resolveCanvasImageForChat(image);
    setChatInitialImage(transferredImage);
    setChatTabOpen(true);
  }, [resolveCanvasImageForChat]);

  const videoPanelRef = useRef<VideoGenerationPanelHandle>(null);
  const shotTaskIdMapRef = useRef<Map<string, string>>(new Map());
  const groupsRef = useRef<ImageGroupData[]>([]);
  const [annotationRevision, setAnnotationRevision] = useState(0);

  const stabilizeCanvasImages = useCallback((items: Array<{ id: string; url: string }>) => {
    const toStabilize = items.filter(({ url }) => url && !url.startsWith('data:'));
    if (toStabilize.length === 0) return;

    // 批量并发稳定化所有 URL，然后一次性更新状态，避免 N 次 React 重渲染
    void Promise.all(
      toStabilize.map(async ({ id, url }) => {
        try {
          const stableUrl = await toStableImageUrl(url);
          return { id, stableUrl: stableUrl !== url ? stableUrl : null };
        } catch {
          return { id, stableUrl: null };
        }
      })
    ).then(results => {
      const updates = new Map<string, string>();
      for (const { id, stableUrl } of results) {
        if (stableUrl) updates.set(id, stableUrl);
      }
      if (updates.size === 0) return;
      setImages(prev => prev.map(img => {
        const newUrl = updates.get(img.id);
        return newUrl ? { ...img, url: newUrl } : img;
      }), { history: 'skip' });
    });
  }, [setImages]);

  // 从 simple-chat 传来的图片桥接
  useEffect(() => {
    if (!currentProject?.id) return;
    const bridgeKey = 'wujie_canvas_bridge';
    let cancelled = false;
    try {
      const raw = localStorage.getItem(bridgeKey);
      if (!raw) return;
      const data = JSON.parse(raw) as unknown;
      void consumeSimpleChatCanvasBridge({
        payload: data,
        currentProjectId: currentProject.id,
        resolveReference: resolveSimpleChatCanvasReference,
        merge: references => {
          if (cancelled) throw new Error('BRIDGE_CONSUMPTION_CANCELLED');
          const timestamp = Date.now();
          setImages(prev => {
            const existingPlacementIds = new Set(prev.flatMap(image => image.placementId ? [image.placementId] : []));
            const existingEntityIds = new Set(prev.map(image => image.id));
            const uniqueReferences = references.filter(reference => (
              (!reference.placementId || !existingPlacementIds.has(reference.placementId))
              && (!reference.entityId || !existingEntityIds.has(reference.entityId))
            ));
            const newImages: CanvasImage[] = uniqueReferences.map((reference, idx) => ({
            id: canvasEntityIdForTransferredReference(reference, `chat-bridge-${timestamp}-${idx}`),
            url: reference.url,
            prompt: reference.name || '',
            model: '',
            quality: 'standard',
            aspectRatio: '1:1',
            stylePreset: '',
            category: 'general',
            size: '1024x1024',
            x: 200 + (idx % 5) * 220,
            y: 200 + Math.floor(idx / 5) * 220,
            width: 512,
            height: 512,
            originalWidth: 1024,
            originalHeight: 1024,
            isAiGenerated: true,
            ...(reference.assetId ? { assetId: reference.assetId } : {}),
            ...(reference.assetVersionId ? { assetVersionId: reference.assetVersionId } : {}),
            ...(reference.placementId ? { placementId: reference.placementId } : {}),
            }));
      // ★ 修复：使用 setImages 包装器而非直接 setImagesRaw，确保 prevImagesRef 同步更新
      // 之前直接调用 setImagesRaw 导致 prevImagesRef 过期，后续 setImages 调用会使用过期的基准计算 diff
            return [...prev, ...newImages];
          });
        },
        remove: () => localStorage.removeItem(bridgeKey),
      }).catch(() => {
        // Keep the bridge payload for a later successful hydrated merge.
      });
    } catch {
      // ignore parse errors
    }
    return () => { cancelled = true; };
  }, [currentProject?.id, setImages]);

  // 应用主题
  useEffect(() => {
    const root = document.documentElement;
    if (themeStyle === 'monochrome') {
      root.style.setProperty('--theme-accent', '#ffffff');
      root.style.setProperty('--theme-accent-light', '#333333');
      root.style.setProperty('--theme-accent-dark', '#1a1a1a');
      root.classList.add('theme-monochrome');
      root.classList.remove('theme-gold');
    } else {
      root.style.setProperty('--theme-accent', '#d4af37');
      root.style.setProperty('--theme-accent-light', '#daa520');
      root.style.setProperty('--theme-accent-dark', '#b8860b');
      root.classList.add('theme-gold');
      root.classList.remove('theme-monochrome');
    }
  }, [themeStyle]);

  // 自动保存画布图片到当前项目
  const canvasPersistenceRevisionRef = useRef(0);
  const canvasPersistenceProjectRef = useRef<string | null>(null);
  const canvasPersistenceSchedulerRef = useRef<CanvasPersistenceScheduler | null>(null);
  // 项目切换中标记：防止自动保存回调用旧闭包数据覆盖刚保存的新数据
  const switchingProjectRef = useRef(false);
  // 服务器同步合并中标记：防止自动保存用旧闭包数据覆盖刚从服务器合并的新数据
  const serverSyncMergeRef = useRef(false);
  const serverSyncMergeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [serverSyncMergeRevision, setServerSyncMergeRevision] = useState(0);
  // ★ 近期删除的图片 ID 集合：防止服务器同步把刚删除的图片恢复回来
  const pendingCanvasDeleteIdsRef = useRef<Set<string>>(new Set());
  const nextCanvasPersistenceRevision = useCallback(() => {
    canvasPersistenceRevisionRef.current += 1;
    return canvasPersistenceRevisionRef.current;
  }, []);
  const buildCanvasPersistenceSnapshot = useCallback((
    nextImages: CanvasImage[],
    project: Project,
  ): CanvasPersistenceSnapshot => ({
    ownerId: project.userId,
    projectId: project.id,
    baseProjectRevision: UserManagerCore.getInstance().getProjectSyncRevision(),
    revision: nextCanvasPersistenceRevision(),
    // CanvasImage is normalized to the durable placement contract during the
    // scheduler's idle prepare phase; this cast keeps the interaction commit
    // structurally shared and free of an O(n) serialization pass.
    images: nextImages as unknown as ReadonlyArray<PersistableCanvasImage>,
    metadata: {
      ...(project.metadata || {}),
      groups: groupsRef.current,
      viewState: viewStateRef.current,
      annotationsV2: annotationRecordsRef.current,
    },
  }), [nextCanvasPersistenceRevision]);

  if (!canvasPersistenceSchedulerRef.current) {
    const prepareCanvasWorkspaceSnapshot = (snapshot: CanvasPersistenceSnapshot) => {
      const normalizedSnapshot: CanvasPersistenceSnapshot = {
        ...snapshot,
        images: serializeCanvasWorkspacePlacements(
          snapshot.images as unknown as CanvasImage[],
        ),
      };
      const prepared = prepareCanvasPersistenceSnapshot(normalizedSnapshot);
      const manager = UserManagerCore.getInstance();
      const userId = currentUserRef.current?.id;
      if (!userId) return prepared;
      const beaconPayload = JSON.stringify({
        key: 'projects',
        projectRevision: manager.getProjectSyncRevision(),
        value: manager.getProjects().map(project => ({
          id: project.id,
          schemaVersion: project.schemaVersion ?? 3,
          name: project.name,
          description: project.description,
          canvasImages: project.id === normalizedSnapshot.projectId
            ? normalizedSnapshot.images
            : project.canvasImages,
          metadata: project.id === normalizedSnapshot.projectId
            ? normalizedSnapshot.metadata
            : project.metadata,
          settings: project.settings,
          createdAt: project.createdAt,
          updatedAt: project.id === normalizedSnapshot.projectId ? Date.now() : project.updatedAt,
          userId,
        })),
      });
      return {
        ...prepared,
        beaconPayload,
        beaconByteLength: new TextEncoder().encode(beaconPayload).byteLength,
      };
    };
    canvasPersistenceSchedulerRef.current = new CanvasPersistenceScheduler({
      prepare: prepareCanvasWorkspaceSnapshot,
      prepareForUnload: prepareCanvasWorkspaceSnapshot,
      writer: async (snapshot) => {
        const scheduler = canvasPersistenceSchedulerRef.current;
        if (!scheduler) return;
        const userId = currentUserRef.current?.id;
        if (!userId) throw new Error('当前用户不存在，无法保存画布');

        if (snapshot.hasPendingMedia) {
          const { urlMapping, failedUrls } = await persistCanvasSnapshotMedia(snapshot.images, userId);
          if (!scheduler.isSnapshotActive(snapshot.projectId, snapshot.revision)) return;
          if (Object.keys(urlMapping).length === 0) {
            throw new Error(`未持久化媒体保存失败: ${failedUrls.length}`);
          }
          if (currentProjectRef.current?.id !== snapshot.projectId) return;
          const resolvedImages = latestImagesRef.current.map(image => (
            urlMapping[image.url]
              ? { ...image, url: urlMapping[image.url], sourceUrl: image.sourceUrl || image.url }
              : image
          ));
          setImages(resolvedImages, { history: 'skip' });
          scheduler.schedule(buildCanvasPersistenceSnapshot(
            resolvedImages,
            currentProjectRef.current,
          ));
          return;
        }

        const manager = UserManagerCore.getInstance();
        manager.updateProject(snapshot.projectId, {
          canvasImages: [...snapshot.images],
          metadata: snapshot.metadata,
        });
        recordUserData({
          userId,
          area: 'projects',
          type: 'autosave',
          filename: `${snapshot.projectId}.json`,
          content: snapshot.serialized,
          metadata: { projectId: snapshot.projectId, imageCount: snapshot.images.length },
        });
      },
    });
  }
  const canvasPersistenceScheduler = canvasPersistenceSchedulerRef.current;

  const persistCanvasImagesNow = useCallback((
    nextImages: CanvasImage[],
    persistenceHint: 'schedule' | 'immediate' | 'skip' = 'immediate',
  ) => {
    if (persistenceHint === 'skip') return;
    const project = currentProjectRef.current;
    if (!project) return;
    immediateSaveGuardRef.current = createCanvasHydrationGuard(project.id, nextImages);
    const snapshot = buildCanvasPersistenceSnapshot(nextImages, project);
    canvasPersistenceScheduler.schedule(snapshot);
    if (persistenceHint === 'immediate') {
      void canvasPersistenceScheduler.flush('immediate').catch(() => undefined);
    }
  }, [buildCanvasPersistenceSnapshot, canvasPersistenceScheduler]);

  const handleDeleteCanvasImages = useCallback(async (imageIds: string[]): Promise<string[]> => {
    if (historyLifecyclePendingRef.current) return [];
    const activeProjectId = currentProject?.id;
    if (!activeProjectId) throw new Error('当前项目不存在');
    const uniqueImageIds = [...new Set(imageIds)]
      .filter((id) => !pendingCanvasDeleteIdsRef.current.has(id));
    if (uniqueImageIds.length === 0) return [];
    uniqueImageIds.forEach((id) => pendingCanvasDeleteIdsRef.current.add(id));
    let deletedIds: string[] = [];
    try {
      const selected = latestImagesRef.current
        .filter((image) => uniqueImageIds.includes(image.id))
        .map((image) => ({ ...image, projectId: activeProjectId }));
      const result = await reconcileImageBatchDeletion(
        selected,
        async (image) => {
          const response = await fetch(`/api/assets/placements/${image.placementId}?projectId=${encodeURIComponent(image.projectId)}`, {
            method: 'DELETE',
          });
          if (!response.ok) throw new Error('素材删除失败');
          const payload = await response.json().catch(() => null) as { projectRevision?: number } | null;
          if (Number.isSafeInteger(payload?.projectRevision)) {
            UserManagerCore.getInstance().advanceProjectSyncRevision(Number(payload?.projectRevision));
          }
        },
        () => undefined,
      );
      deletedIds = result.deletedIds;
      if (result.deletedIds.length > 0) {
        const currentImages = latestImagesRef.current;
        const currentIds = new Set(currentImages.map((image) => image.id));
        const commandIds = result.deletedIds.filter((id) => currentIds.has(id));
        if (commandIds.length === 0) return result.deletedIds;
        const commandResult = executeCanvasCommand(
          createCanvasDocumentSnapshot(currentImages),
          { type: 'delete', ids: commandIds },
        );
        const remainingImages = canvasSnapshotToNodes(commandResult.next) as CanvasImage[];
        setImages(remainingImages);
        persistCanvasImagesNow(remainingImages, commandResult.persistence);
        setSelectedImage((current) => reconcileSelectedImageAfterBatchDeletion(current, result.deletedIds));
      }
      if ('error' in result) {
        toast.error(result.error instanceof Error ? result.error.message : '素材删除失败');
      }
      return result.deletedIds;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '素材删除同步失败');
      return deletedIds;
    } finally {
      uniqueImageIds.forEach((id) => pendingCanvasDeleteIdsRef.current.delete(id));
    }
  }, [currentProject?.id, persistCanvasImagesNow, setImages]);
  const initialCanvasAnnotations = useMemo(() => {
    if (!currentProject) return [];
    const sources = currentProject.canvasImages
      .filter((image) => Boolean(image.id && image.url))
      .map((image) => ({
        imageId: image.id,
        url: image.url,
        versionId: image.annotationVersionId
          || buildAnnotationSourceVersionId(
            image.id,
            image.createdAt,
            image.url,
          ),
      }));
    return restoreAnnotations(
      currentProject.metadata?.annotationsV2,
      {
        projectId: currentProject.id,
        sources,
      },
    );
  }, [currentProject]);
  const annotationRecordsRef = useRef<CanvasAnnotationV2[]>(
    initialCanvasAnnotations,
  );
  const annotationSignatureRef = useRef('');
  const annotationProjectIdRef = useRef<string | null>(currentProject?.id ?? null);
  const annotationsDirtyRef = useRef(false);
  useEffect(() => {
    const nextProjectId = currentProject?.id ?? null;
    const projectChanged = annotationProjectIdRef.current !== nextProjectId;
    if (!projectChanged && annotationsDirtyRef.current) return;

    annotationProjectIdRef.current = nextProjectId;
    annotationsDirtyRef.current = false;
    annotationRecordsRef.current = initialCanvasAnnotations;
    annotationSignatureRef.current = JSON.stringify(initialCanvasAnnotations);
  }, [currentProject?.id, initialCanvasAnnotations]);
  const handleAnnotationsChange = useCallback(
    (annotations: CanvasAnnotationV2[]) => {
      const serialized = serializeAnnotations(annotations);
      const signature = JSON.stringify(serialized);
      if (signature === annotationSignatureRef.current) return;
      annotationRecordsRef.current = serialized;
      annotationSignatureRef.current = signature;
      annotationsDirtyRef.current = true;
      setAnnotationRevision((revision) => revision + 1);
    },
    [],
  );
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const resumedTaskIdsRef = useRef<Set<string>>(new Set());
  const resumedTaskPollingGenerationRef = useRef(0);
  const legacyRecoveryAttemptedRef = useRef<Set<string>>(new Set());
  const legacyRecoveryInFlightRef = useRef<Set<string>>(new Set());
  const legacyRecoveryRetryAtRef = useRef<Map<string, number>>(new Map());
  const legacyRecoveryRetryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [legacyRecoveryRevision, setLegacyRecoveryRevision] = useState(0);
  useEffect(() => () => {
    for (const timer of legacyRecoveryRetryTimersRef.current.values()) {
      clearTimeout(timer);
    }
    legacyRecoveryRetryTimersRef.current.clear();
    legacyRecoveryRetryAtRef.current.clear();
  }, [currentProject?.id]);
  useEffect(() => {
    if (!currentProject?.id) return;

    const placeholders = images.filter((image) => (
      image.isProcessingPlaceholder
      && !image.processing?.taskId
      && Boolean(image.prompt?.trim())
      && Boolean(image.model?.trim())
    ));
    const keys = placeholders
      .map((image) => `${currentProject.id}:${image.id}`)
      .filter((key) => (
        !legacyRecoveryAttemptedRef.current.has(key)
        && !legacyRecoveryInFlightRef.current.has(key)
        && (legacyRecoveryRetryAtRef.current.get(key) || 0) <= Date.now()
      ));
    if (keys.length === 0) return;

    const scheduleRetry = (key: string, retryAt: number) => {
      legacyRecoveryRetryAtRef.current.set(key, retryAt);
      const existing = legacyRecoveryRetryTimersRef.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        legacyRecoveryRetryTimersRef.current.delete(key);
        setLegacyRecoveryRevision((revision) => revision + 1);
      }, Math.max(0, retryAt - Date.now()));
      legacyRecoveryRetryTimersRef.current.set(key, timer);
    };

    keys.forEach((key) => legacyRecoveryInFlightRef.current.add(key));
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/tasks/recover?projectId=${encodeURIComponent(currentProject.id)}&includeLegacyUnassigned=1`);
        const data = await response.json() as {
          success?: boolean;
          tasks?: RecoverableLegacyTask[];
          retryAfterMs?: number;
        };
        const retryAt = getLegacyRecoveryRetryAt({
          retryAfterMs: data.retryAfterMs,
        });
        keys.forEach((key) => scheduleRetry(key, retryAt));
        if (!response.ok || !data.success || !Array.isArray(data.tasks) || cancelled) return;

        const keyByImageId = new Map(placeholders.map((image) => [image.id, `${currentProject.id}:${image.id}`]));
        setImages((current) => current.map((image) => {
          const match = findUniqueLegacyTaskMatch(image, data.tasks || []);
          if (!match || !image.processing) return image;
          const key = keyByImageId.get(image.id);
          if (key) legacyRecoveryAttemptedRef.current.add(key);
          return {
            ...image,
            model: image.model || match.model,
            apiProviderId: image.apiProviderId || match.providerId,
            processing: {
              ...image.processing,
              taskId: match.id,
              isResumed: true,
              status: 'processing',
              progress: Math.max(image.processing.progress || 0, match.progress || 10),
              label: match.label || '已恢复，等待生成',
            },
          };
        }), { history: 'skip' });
      } catch {
        const retryAt = getLegacyRecoveryRetryAt({ requestFailed: true });
        keys.forEach((key) => scheduleRetry(key, retryAt));
      } finally {
        keys.forEach((key) => legacyRecoveryInFlightRef.current.delete(key));
      }
    })();

    return () => { cancelled = true; };
  }, [currentProject?.id, images, legacyRecoveryRevision, setImages]);

  useEffect(() => {
    resumedTaskPollingGenerationRef.current += 1;
    resumedTaskIdsRef.current.clear();
    return () => {
      resumedTaskPollingGenerationRef.current += 1;
    };
  }, [currentProject?.id]);

  useEffect(() => {
    const pending = images.filter((image) => image.isProcessingPlaceholder && image.processing?.taskId);
    const pollingGeneration = resumedTaskPollingGenerationRef.current;

    for (const image of pending) {
      const taskId = image.processing?.taskId;
      if (!taskId) continue;
      const wasStarted = Boolean(taskId && resumedTaskIdsRef.current.has(taskId));
      if (!shouldStartResumedTaskPolling({
        taskId,
        status: image.processing?.status,
        wasStarted,
        isResumed: image.processing?.isResumed === true,
      })) continue;
      resumedTaskIdsRef.current.add(taskId);

      void (async () => {
        for (let attempt = 0; attempt < RESUMED_TASK_MAX_POLL_ATTEMPTS && pollingGeneration === resumedTaskPollingGenerationRef.current; attempt += 1) {
          try {
            const response = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: image.model || image.modelName, providerId: image.apiProviderId }),
            });
            const data = await response.json();
            const videoUrl = data.videoUrl || data.result?.videoUrl;
            const imageUrl = data.imageUrl || data.result?.imageUrl;
            if (data.status === 'completed' && (videoUrl || imageUrl)) {
              projectWorkspaceTaskEvent({
                taskId,
                outputIndex: image.processing?.outputIndex ?? 0,
                status: 'completed',
                progress: 100,
                source: 'recovery',
                providerId: image.apiProviderId,
                modelId: image.model || image.modelName,
                providerName: data.providerName,
                modelName: data.modelName,
                result: {
                  url: videoUrl || imageUrl,
                  metadata: {
                    videoUrl: videoUrl || undefined,
                    mediaType: videoUrl ? 'video' : image.mediaType,
                  },
                },
              });
              return;
            }
            if (data.status === 'failed' || data.status === 'cancelled') {
              projectWorkspaceTaskEvent({
                taskId,
                outputIndex: image.processing?.outputIndex ?? 0,
                status: data.status,
                progress: data.progress || image.processing?.progress || 0,
                source: 'recovery',
                error: createCanvasTaskEventError(data.error, {
                  code: data.status === 'cancelled' ? 'TASK_CANCELLED' : 'TASK_FAILED',
                  message: data.error || (data.status === 'cancelled' ? '任务已取消' : '生成失败'),
                  source: 'provider',
                  retryable: false,
                }),
              });
              return;
            }
            projectWorkspaceTaskEvent({
              taskId,
              outputIndex: image.processing?.outputIndex ?? 0,
              status: data.status === 'queued' || data.status === 'uploading' || data.status === 'submitting'
                ? data.status
                : 'processing',
              progress: Math.max(image.processing?.progress || 0, data.progress || 0),
              label: data.label || image.processing?.label || '生成中',
              source: 'recovery',
            });
          } catch { /* transient polling errors are retried */ }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        if (pollingGeneration === resumedTaskPollingGenerationRef.current) {
          const outcome = getResumedTaskPollingOutcome(RESUMED_TASK_MAX_POLL_ATTEMPTS, true);
          if (outcome) {
            projectWorkspaceTaskEvent({
              taskId,
              outputIndex: image.processing?.outputIndex ?? 0,
              status: 'timeout',
              progress: image.processing?.progress || 0,
              label: outcome.label,
              source: 'recovery',
              error: createCanvasTaskEventError(outcome.label, {
                code: 'TASK_POLL_TIMEOUT',
                message: outcome.label,
                source: 'network',
                retryable: true,
              }),
            });
          }
        }
      })();
    }
  }, [images, projectWorkspaceTaskEvent]);

  // ★ 追踪图片删除：当 images 减少时，记录被删除的 ID，5 秒后自动清除
  const prevImageIdsRef2 = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(images.map(img => img.id));
    const prevIds = prevImageIdsRef2.current;
    // 找出被删除的 ID（上一轮有、这一轮没有的）
    const deleted = new Set<string>();
    prevIds.forEach(id => {
      if (!currentIds.has(id)) deleted.add(id);
    });
    if (deleted.size > 0) {
      deleted.forEach(id => recentlyDeletedIdsRef.current.add(id));
      // 5 秒后清除（足够让自动保存完成并同步到服务器）
      setTimeout(() => {
        deleted.forEach(id => recentlyDeletedIdsRef.current.delete(id));
      }, 5000);
    }
    prevImageIdsRef2.current = currentIds;
  }, [images]);

  useEffect(() => {
    const previousProjectId = canvasPersistenceProjectRef.current;
    const nextProjectId = currentProject?.id ?? null;
    if (previousProjectId && previousProjectId !== nextProjectId) {
      canvasPersistenceScheduler.cancel(previousProjectId);
    }
    canvasPersistenceProjectRef.current = nextProjectId;
  }, [canvasPersistenceScheduler, currentProject?.id]);

  useEffect(() => {
    if (!currentProject?.id) return;
    // 项目切换进行中时，跳过自动保存，避免旧闭包数据覆盖
    if (switchingProjectRef.current) return;
    // 服务器同步合并中，跳过自动保存，避免旧闭包数据覆盖刚合并的服务器数据
    if (serverSyncMergeRef.current) return;
    const immediateSaveGuard = consumeCanvasHydrationGuard(
      immediateSaveGuardRef.current,
      currentProject.id,
      images,
    );
    immediateSaveGuardRef.current = immediateSaveGuard.nextGuard;
    if (immediateSaveGuard.suppress) return;
    if (shouldConsumeCanvasHydrationGuard(
      hydrationAutosaveGuardRef.current,
      currentProject.id,
      images,
    )) {
      hydrationAutosaveGuardRef.current = null;
      return;
    }
    if (hydrationAutosaveGuardRef.current?.projectId === currentProject.id) {
      hydrationAutosaveGuardRef.current = null;
    }
    const snapshot = buildCanvasPersistenceSnapshot(images, currentProject);
    canvasPersistenceScheduler.schedule(snapshot);
  }, [
    annotationRevision,
    images,
    currentProject,
    currentUser?.id,
    serverSyncMergeRevision,
    buildCanvasPersistenceSnapshot,
    canvasPersistenceScheduler,
  ]);

  // 页面关闭/刷新前同步保存（localStorage + sendBeacon到服务器）
  // 使用 ref 避免每次 images 变化都重建 beforeunload 监听器
  const currentProjectRef2 = useRef(currentProject);
  currentProjectRef2.current = currentProject;
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const proj = currentProjectRef2.current;
      if (!proj) return;
      try {
        if (!currentUserRef.current?.id) return;
        if (!canvasPersistenceScheduler.hasPendingSnapshot(proj.id)) return;
        const prepared = canvasPersistenceScheduler.preparePendingSnapshotForUnload(proj.id);
        if (!prepared) return;
        if (prepared.hasPendingMedia) {
          event.preventDefault();
          event.returnValue = '';
        }
        persistPreparedCanvasUnloadSnapshot(prepared, {
          storage: localStorage,
          sendBeacon: navigator.sendBeacon.bind(navigator),
        });
      } catch (error) {
        event.preventDefault();
        event.returnValue = '';
        console.warn('[canvas] unload recovery snapshot failed', error instanceof Error ? error.message : 'unknown error');
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [canvasPersistenceScheduler]);

  // 定期从服务器同步项目数据（跨设备/跨浏览器数据同步）
  useEffect(() => {
    if (!currentUser) return;
    const syncInterval = setInterval(async () => {
      try {
        const userMgr = UserManagerCore.getInstance();
        await userMgr.loadProjectsFromServer();
      } catch { /* best effort */ }
    }, 30000); // 每30秒同步一次
    return () => clearInterval(syncInterval);
  }, [currentUser]);

  // 监听服务器项目数据变化（周期同步/跨设备同步触发的更新）
  useEffect(() => {
    if (!currentUser) return;
    const userMgr = UserManagerCore.getInstance();
    const unsubscribe = userMgr.onProjectsChanged(() => {
      try {
        // ★ 数据隔离保护：验证当前用户身份，防止跨用户数据污染
        const currentUserId = UserManagerCore.getInstance().getUser()?.id;
        if (!currentUserId || currentUserId !== currentUserRef.current?.id) return;
        // 标记服务器同步合并中，防止自动保存用旧闭包数据覆盖
        serverSyncMergeRef.current = true;
        const projects = userMgr.getProjects();
        const curProjectId = currentProjectRef.current?.id;
        if (curProjectId) {
          const latest = projects.find(p => p.id === curProjectId);
          if (latest) {
            setCurrentProject(latest);
            if (latest.canvasImages) {
              // 保留当前正在处理的占位框（isProcessingPlaceholder），避免服务器同步覆盖导致加载框消失
              const processingPlaceholders = latestImagesRef.current.filter(shouldPersistProcessingPlaceholder);
              // 去重：避免服务器数据中已包含占位框 id 时重复添加
              const serverIds = new Set(latest.canvasImages.map(img => img.id));
              const uniquePlaceholders = processingPlaceholders.filter(
                img => !serverIds.has(img.id)
              );
              // 清理无效图片框：没有 url 且不是处理中占位框的图片（可能是之前生成失败残留）
              // ★ BUG3 修复：如果服务器数据中 URL 为空但本地有有效 URL，不从 validImages 中移除
              // 后续 enrichment 会从 localImgMap 恢复 URL
              const validImages = latest.canvasImages.filter(
                (img) => shouldRetainCanvasPlacementDuringMerge(img) || img._needsPersist
              );
              // ★ 过滤近期删除的图片：防止服务器同步把刚删除的图片恢复回来
              const afterDeletedFilter = validImages.filter(
                (img) => !recentlyDeletedIdsRef.current.has(img.id)
              );
              // ★ 数据隔离：仅从过滤后的服务器图片 ID 集合查找本地补充数据
              const serverImgIdSet = new Set(afterDeletedFilter.map(img => img.id));
              const previousProjectImageIds = new Set(
                (currentProjectRef.current?.canvasImages ?? []).map(img => img.id),
              );
              const localImgMap = new Map<string, CanvasImage>();
              for (const li of latestImagesRef.current) {
                // 仅纳入服务器也有的图片 ID，排除不属于当前项目的图片
                if (li.id && serverImgIdSet.has(li.id)) localImgMap.set(li.id, li);
              }
              // ★ BUG3 修复：保留本地独有的图片（服务器尚未同步的新生成图片）
              // 如果本地有图片但服务器没有（syncToServer 还没跑），不要丢失这些图片
              const localOnlyImages = latestImagesRef.current.filter(
                li => li.id && !serverImgIdSet.has(li.id)
                  && !previousProjectImageIds.has(li.id)
                  && !recentlyDeletedIdsRef.current.has(li.id)
                  && !li.isProcessingPlaceholder
                  && shouldRetainCanvasPlacementDuringMerge(li)
              );
              const enrichedImages = afterDeletedFilter.map((img) => {
                const localImg = localImgMap.get(img.id);
                const enriched = mergeLocalCompletedTaskProjection({ ...img }, localImg);
                // 回填：历史数据 modelName 为空但 model 有值时，用 model 补充
                if ((!enriched.modelName || enriched.modelName === '') && enriched.model) {
                  enriched.modelName = enriched.model;
                }
                // ★ BUG3 关键修复：从本地恢复被 trimDataUrls 清空的 URL
                // 当 localStorage 配额溢出时，trimDataUrls 会将 data:/blob: URL 清空为 ''
                // 服务器同步下来的数据也会有空 URL，必须从本地内存数据恢复
                if ((!enriched.url || enriched.url === '') && localImg?.url) {
                  enriched.url = localImg.url;
                  // 清除 _needsPersist 标记（URL 已恢复）
                  if (enriched._needsPersist) {
                    delete (enriched as Record<string, unknown>)._needsPersist;
                  }
                }
                // ★ 关键修复：保留本地的位置信息（x, y, width, height）
                // 用户可能在本地拖动了图片，但服务器还没同步到最新位置
                // 优先使用本地的位置数据，避免图片"回位"
                if (localImg) {
                  if (localImg.x !== undefined) enriched.x = localImg.x;
                  if (localImg.y !== undefined) enriched.y = localImg.y;
                  if (localImg.width !== undefined) enriched.width = localImg.width;
                  if (localImg.height !== undefined) enriched.height = localImg.height;
                }
                // 逐字段检查，从本地补充服务器缺失的字段
                if ((!enriched.modelName || enriched.modelName === '') && localImg?.modelName) {
                  enriched.modelName = localImg.modelName;
                }
                if ((!enriched.apiProvider || enriched.apiProvider === '') && localImg?.apiProvider) {
                  enriched.apiProvider = localImg.apiProvider;
                }
                if ((!enriched.originalWidth) && localImg?.originalWidth) {
                  enriched.originalWidth = localImg.originalWidth;
                }
                if ((!enriched.originalHeight) && localImg?.originalHeight) {
                  enriched.originalHeight = localImg.originalHeight;
                }
                if ((!enriched.model || enriched.model === '') && localImg?.model) {
                  enriched.model = localImg.model;
                }
                if ((!enriched.apiBaseUrl || enriched.apiBaseUrl === '') && localImg?.apiBaseUrl) {
                  enriched.apiBaseUrl = localImg.apiBaseUrl;
                }
                // ★ 视频字段回填：服务器同步时保留本地的视频元数据
                if (!enriched.mediaType && localImg?.mediaType) {
                  enriched.mediaType = localImg.mediaType;
                }
                if ((!enriched.videoUrl || enriched.videoUrl === '') && localImg?.videoUrl) {
                  enriched.videoUrl = localImg.videoUrl;
                }
                if (!enriched.videoDuration && localImg?.videoDuration) {
                  enriched.videoDuration = localImg.videoDuration;
                }
                if ((!enriched.videoThumbnailUrl || enriched.videoThumbnailUrl === '') && localImg?.videoThumbnailUrl) {
                  enriched.videoThumbnailUrl = localImg.videoThumbnailUrl;
                }
                // ★ SVG字段回填：保留本地的SVG数据
                if ((!enriched.svgDataUrl || enriched.svgDataUrl === '') && localImg?.svgDataUrl) {
                  enriched.svgDataUrl = localImg.svgDataUrl;
                }
                if ((!enriched.svgUrl || enriched.svgUrl === '') && localImg?.svgUrl) {
                  enriched.svgUrl = localImg.svgUrl;
                }
                // ★ 源图URL和连线关系回填
                if ((!enriched.sourceUrl || enriched.sourceUrl === '') && localImg?.sourceUrl) {
                  enriched.sourceUrl = localImg.sourceUrl;
                }
                if ((!enriched.generatedFromImageId || enriched.generatedFromImageId === '') && localImg?.generatedFromImageId) {
                  enriched.generatedFromImageId = localImg.generatedFromImageId;
                }
                return enriched;
              });
              const legacyMergedImages = preserveLocalCanvasTaskSlotOrder([
                ...(enrichedImages as CanvasImage[]),
                ...(localOnlyImages as CanvasImage[]),
                ...uniquePlaceholders,
              ], latestImagesRef.current);
              setImages(selectCanvasPlacementSnapshot(
                userMgr.getAssetGraphMode(),
                hydrateCanvasPlacements(latest.canvasImages, 'asset-v3'),
                () => legacyMergedImages,
              ), { history: 'skip' });
              // ★ 调试日志：追踪图片恢复
              console.log('[page] onProjectsChanged: setImages total=', enrichedImages.length + localOnlyImages.length + uniquePlaceholders.length,
                'enriched=', enrichedImages.length, 'localOnly=', localOnlyImages.length, 'placeholders=', uniquePlaceholders.length);
            }
          }
        }
        // 项目列表可能变化（如其他设备新建了项目）
        setCurrentUser({ ...currentUser }); // 触发 UI 刷新
        // 延迟清除同步合并标记，确保 setImages 引起的自动保存跳过本轮。
        // 历史隔离由上方的 { history: 'skip' } 精确控制，不得全局屏蔽用户操作。
        if (serverSyncMergeTimerRef.current) clearTimeout(serverSyncMergeTimerRef.current);
        serverSyncMergeTimerRef.current = setTimeout(() => {
          serverSyncMergeRef.current = false;
          serverSyncMergeTimerRef.current = null;
          setServerSyncMergeRevision(revision => revision + 1);
        }, 2000);
      } catch { /* best effort */ serverSyncMergeRef.current = false; }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      if (serverSyncMergeTimerRef.current) {
        clearTimeout(serverSyncMergeTimerRef.current);
        serverSyncMergeTimerRef.current = null;
      }
      serverSyncMergeRef.current = false;
    };
  }, [currentUser?.id, currentProject?.id, setImages]);

  // ★ 异步持久化 data:/blob: URL：页面加载后自动检测并持久化临时 URL
  // 解决刷新后图片消失的问题：data: URL 在 normalizeImageUrls 中不再被清空，
  // 但需要尽快转换为服务器 URL 以确保跨会话可用
  const persistedDataUrlIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pendingImages = images.filter(img =>
      img.url && (img.url.startsWith('data:') || img.url.startsWith('blob:'))
      && !persistedDataUrlIdsRef.current.has(img.id)
    );
    if (pendingImages.length === 0) return;

    // 标记为正在处理，避免重复提交
    for (const img of pendingImages) {
      persistedDataUrlIdsRef.current.add(img.id);
    }

    const persistDataUrls = async () => {
      const urlMapping: Record<string, string> = {};
      for (const img of pendingImages) {
        try {
          let urlToSave = img.url;
          // blob: 先转 data:
          if (urlToSave.startsWith('blob:')) {
            try {
              const resp = await fetch(urlToSave);
              const blob = await resp.blob();
              urlToSave = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
            } catch { continue; }
          }
          const saveResp = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: urlToSave, userId: currentUser?.id }),
          });
          if (!saveResp.ok) {
            console.warn(`[persistPendingDataUrls] save-image returned ${saveResp.status} for image ${img.id}`);
            continue;
          }
          const saveData = await saveResp.json();
          if (saveData.success && saveData.url) {
            urlMapping[img.id] = saveData.url;
          }
        } catch (error) {
          console.warn(`[persistPendingDataUrls] Failed to persist image ${img.id}:`, error);
        }
      }
      // 更新 images 状态中的非持久化 URL
      if (Object.keys(urlMapping).length > 0) {
        setImages(prev => prev.map(img =>
          urlMapping[img.id] ? { ...img, url: urlMapping[img.id] } : img
        ), { history: 'skip' });
      }
    };

    // Start persistence immediately so temporary media spends the shortest possible time in memory only.
    void persistDataUrls();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  // ★ SSE 连接：实时推送任务完成事件，避免轮询延迟
  useEffect(() => {
    taskEventsClient.connect();
    return () => { taskEventsClient.disconnect(); };
  }, []);

  useEffect(() => taskEventsClient.onTaskEvent((event) => {
    const status = event.task.status === 'pending' ? 'submitting' : event.task.status;
    const resultRecord = event.task.result && typeof event.task.result === 'object'
      ? event.task.result as Record<string, unknown>
      : {};
    const nestedResult = resultRecord.result && typeof resultRecord.result === 'object'
      ? resultRecord.result as Record<string, unknown>
      : {};
    const resultUrl = extractGeneratedImageUrls(resultRecord)[0];
    projectWorkspaceTaskEvent({
      taskId: event.taskId,
      outputIndex: 0,
      status,
      progress: event.task.progress,
      label: event.task.label,
      source: 'sse',
      ...(status === 'completed' && resultUrl ? {
        result: {
          url: resultUrl,
          sourceUrl: resultUrl,
          assetId: typeof resultRecord.assetId === 'string'
            ? resultRecord.assetId
            : typeof nestedResult.assetId === 'string' ? nestedResult.assetId : undefined,
          assetVersionId: typeof resultRecord.assetVersionId === 'string'
            ? resultRecord.assetVersionId
            : typeof nestedResult.assetVersionId === 'string' ? nestedResult.assetVersionId : undefined,
          placementId: typeof resultRecord.placementId === 'string'
            ? resultRecord.placementId
            : typeof nestedResult.placementId === 'string' ? nestedResult.placementId : undefined,
        },
      } : {}),
      ...((status === 'failed' || status === 'cancelled' || status === 'timeout') ? {
        error: createCanvasTaskEventError(event.task.error, {
          code: status === 'timeout'
            ? 'TASK_TIMEOUT'
            : status === 'cancelled' ? 'TASK_CANCELLED' : 'TASK_FAILED',
          message: event.task.error || (status === 'timeout'
            ? '任务超时'
            : status === 'cancelled' ? '任务已取消' : '任务执行失败'),
          source: 'wujie',
          retryable: status !== 'cancelled',
        }),
      } : {}),
    });
  }), [projectWorkspaceTaskEvent]);

  const handleGenerate = useCallback(async (params: GenerationParams) => {
    // 增加活跃任务计数
    setActiveGenerationCount(prev => prev + 1);
    // 获取生图数量，默认为1
    const outputCount = params.outputCount || 1;

    // 【调整1】在画布上创建进度占位框
    const placeholderBaseSize = 400;
    const aspectRatio = params.aspectRatio || '1:1';
    const [arW, arH] = aspectRatio.split(':').map(Number);
    const arRatio = (arW || 1) / (arH || 1);
    const phWidth = arRatio >= 1 ? placeholderBaseSize : Math.round(placeholderBaseSize * arRatio);
    const phHeight = arRatio >= 1 ? Math.round(placeholderBaseSize / arRatio) : placeholderBaseSize;

    const placeholderIds: string[] = [];
    // 计算视口中心位置用于放置占位框
    const canvasEl = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
    const viewportWidth = canvasEl ? canvasEl.clientWidth : 1200;
    const viewportHeight = canvasEl ? canvasEl.clientHeight : 800;
    let viewOffsetX = 0, viewOffsetY = 0, currentZoom = 1;
    const transformLayer = canvasEl?.querySelector('[style*="transform"]') as HTMLElement | null;
    if (transformLayer) {
      const match = transformLayer.style.transform?.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/);
      if (match) { viewOffsetX = parseFloat(match[1]); viewOffsetY = parseFloat(match[2]); currentZoom = parseFloat(match[3]); }
    }
    const canvasCenterX = (viewportWidth / 2 - viewOffsetX) / currentZoom;
    const canvasCenterY = (viewportHeight / 2 - viewOffsetY) / currentZoom;
    const totalPhWidth = outputCount * phWidth + (outputCount - 1) * 20;
    const phStartX = canvasCenterX - totalPhWidth / 2;
    const phStartY = canvasCenterY - phHeight / 2;

    for (let i = 0; i < outputCount; i++) {
      const phId = `gen-ph-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
      placeholderIds.push(phId);
      const offsetX = i * (phWidth + 20);
      const placeholderPosition = { x: phStartX + offsetX, y: phStartY };
      setImages(prev => [...prev, {
        id: phId,
        url: '',
        x: placeholderPosition.x, y: placeholderPosition.y,
        width: phWidth, height: phHeight,
        originalWidth: phWidth * 2, originalHeight: phHeight * 2,
        isProcessingPlaceholder: true,
        processing: {
          label: '生成中',
          status: 'submitting',
          progress: 5,
          startTime: Date.now(),
        },
        aspectRatio: params.aspectRatio,
        model: params.model,
        quality: params.quality,
        prompt: params.prompt,
        createdAt: Date.now(),
      }]);
    }

    try {
      // 开始处理 - 提交任务

      // 检查是否使用第三方模型
      const isThirdParty = !!(params as GenerationParams & { universalBaseUrl?: string }).universalBaseUrl;
      const apiEndpoint = isThirdParty ? '/api/universal-generate' : '/api/generate';

      // 提交生成请求（带超时保护，避免网络异常导致无限等待）
      // 超时需匹配后端 maxDuration (600s=10分钟)，部分第三方API出图可达90秒+
      const submitController = new AbortController();
      const submitTimeout = setTimeout(() => submitController.abort(), 600000); // 10分钟超时，匹配后端maxDuration

      let response: Response;
      try {
        // ★ submitOnly模式：后端立即返回taskId，前端轮询等待结果
        response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, userId: currentUserRef.current?.id, projectId: currentProject?.id, submitOnly: true }),
          signal: submitController.signal,
        });
      } finally {
        clearTimeout(submitTimeout);
      }

      const data = await response.json();

      // === HTTP 错误处理 ===
      if (!response.ok) {
        console.error('[生成] API HTTP错误:', response.status, data);
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
        toast.error('生成失败', {
          description: data.error || `服务器错误 (${response.status})，请稍后重试`,
          className: 'bg-[#141414] border border-red-900 text-white',
          duration: 5000,
        });
        return;
      }

      // === 提交失败处理 ===
      if (!data.success) {
        console.error('[生成] API提交失败:', data.error, data);
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
        toast.error('生成失败', {
          description: data.error || 'API提交失败，请检查模型和提示词后重试',
          className: 'bg-[#141414] border border-red-900 text-white',
          duration: 5000,
        });
        return;
      }

      // === 直接返回模式：API 直接返回图片URL ===
      if (data.mode === 'direct') {
        const { imageUrls, model, prompt: enhancedPrompt, originalPrompt, category, style, modelName, providerName, apiBaseUrl } = data;

        // 并行持久化所有需要持久化的图片URL（跳过已经是本地路径的URL）
        const savedUrls = await Promise.all(imageUrls.map(async (imageUrl: string) => {
          // 已经是本地路径（serve-upload/本地文件），无需再次持久化
          if (imageUrl.startsWith('/api/serve-upload/') || imageUrl.startsWith('/uploads/') || imageUrl.startsWith('blob:')) {
            return imageUrl;
          }
          // data: URL 或远程 HTTP URL 需要持久化
          let savedUrl = imageUrl;
          try {
            const saveRes = await fetch('/api/save-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl }),
            });
            if (saveRes.ok) {
              const saveData = await saveRes.json();
              if (saveData.success && saveData.savedUrl) savedUrl = saveData.savedUrl;
            }
          } catch {}
          return savedUrl;
        }));

        // 加载每张图片的真实像素尺寸（第三方API可能返回与请求不同的尺寸）
        const loadActualSize = (url: string, retries = 2): Promise<{ w: number; h: number }> => {
          return new Promise(resolve => {
            const img = new window.Image();
            const timeout = setTimeout(() => {
              img.src = '';
              if (retries > 0) {
                resolve(loadActualSize(url, retries - 1));
              } else {
                resolve({ w: 0, h: 0 });
              }
            }, 15000); // 15秒超时，4K大图可能需要更长时间加载
            img.onload = () => { clearTimeout(timeout); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
            img.onerror = () => {
              clearTimeout(timeout);
              if (retries > 0) {
                resolve(loadActualSize(url, retries - 1));
              } else {
                resolve({ w: 0, h: 0 }); // 加载失败时返回0，后续使用fallback
              }
            };
            img.src = url;
          });
        };
        const actualSizes = await Promise.all(savedUrls.map(url => loadActualSize(url)));

        for (let i = 0; i < savedUrls.length; i++) {
          const savedUrl = savedUrls[i];
          const actualSize = actualSizes[i];

          // 从请求参数推算像素尺寸作为fallback
          let imgW = 1024, imgH = 1024;
          if (params.size?.includes('x') || params.size?.includes('×')) {
            const [sw, sh] = params.size.replace(/×/g, 'x').split('x');
            const pw = parseInt(sw), ph = parseInt(sh);
            // 像素格式 (如 "2304x4096")
            if (pw > 100 && ph > 100) {
              imgW = pw; imgH = ph;
            }
          }
          // 如果无法从size解析像素，尝试从quality和aspectRatio推算
          if (imgW <= 100 && params.aspectRatio) {
            const [aw, ah] = params.aspectRatio.replace(/×/g, ':').split(':').map(Number);
            if (aw > 0 && ah > 0) {
              const basePixels: Record<string, number> = {
                '1K': 1024, '2K': 2048, '3K': 3072, '4K': 4096,
              };
              const base = basePixels[params.quality || '2K'] || 2048;
              const longEdge = base;
              if (aw >= ah) { imgW = longEdge; imgH = Math.round(longEdge * ah / aw); }
              else { imgH = longEdge; imgW = Math.round(longEdge * aw / ah); }
            }
          }
          // 优先使用图片真实像素尺寸，fallback到请求尺寸
          const finalW = actualSize.w > 0 ? actualSize.w : imgW;
          const finalH = actualSize.h > 0 ? actualSize.h : imgH;

          // 替换对应的占位框
          const phId = placeholderIds[i];
          if (phId) {
            setImages(prev => prev.map(img =>
              img.id === phId ? {
                ...img,
                id: `gen-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
                url: savedUrl,
                prompt: enhancedPrompt || originalPrompt || params.prompt,
                model: model,
                quality: params.quality,
                aspectRatio: params.aspectRatio,
                stylePreset: style,
                category: category,
                size: params.size,
                width: finalW * 0.5, height: finalH * 0.5,
                originalWidth: finalW, originalHeight: finalH,
                isProcessingPlaceholder: false,
                processing: undefined,
                createdAt: Date.now(),
                modelName: modelName || model,
                apiProvider: providerName || '',
                apiBaseUrl: apiBaseUrl || '',
                generationRouteAudit: data.generationRouteAudit,
              } : img
            ));
          }
        }
        // 移除多余的占位框（outputCount > imageUrls.length 时）
        const usedPlaceholderIds = new Set(placeholderIds.slice(0, imageUrls.length));
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id) || usedPlaceholderIds.has(img.id)));

        toast.success('生成完成', {
          description: `${data.modelName || model} 已生成 ${imageUrls.length} 张图片`,
          className: themeStyle === 'monochrome' ? 'bg-white border border-blue-200 text-gray-900' : 'bg-[#141414] border border-[#d4af37]/30 text-white',
          duration: 3000,
        });
        return;
      }

      // === 轮询模式：API返回任务ID，前端轮询结果 ===
      if (data.mode === 'polling') {
        const { estimatedTime, prompt: enhancedPrompt, modelName: pollingModelName, providerName: pollingProviderName, apiBaseUrl: pollingApiBaseUrl } = data;
        const submittedSlots = normalizeGenerationSubmitSlots(data);
        const taskIds = submittedSlots.map(slot => slot.taskId);

        // Persist task IDs before the first poll so an autosave/reload can resume them.
        setImages((previous) => {
          let next = submittedSlots.length > 0
            ? applyGenerationSlotsToProcessingPlaceholders(previous, submittedSlots, placeholderIds)
            : applyTaskIdsToProcessingPlaceholders(previous, placeholderIds, taskIds);
          submittedSlots.forEach((slot) => {
            const submittedUrl = extractGeneratedImageUrls(slot.result || {})[0];
            next = applyCanvasTaskEventToProcessingPlaceholders(next, {
              taskId: slot.taskId,
              batchId: slot.batchId,
              slotId: slot.slotId,
              slotIndex: slot.slotIndex,
              outputIndex: 0,
              status: slot.status,
              progress: slot.status === 'completed' ? 100 : 10,
              source: 'submit',
              providerId: params.providerId,
              providerName: pollingProviderName,
              modelId: params.model,
              modelName: pollingModelName,
              ...(submittedUrl ? {
                result: {
                  url: submittedUrl,
                  sourceUrl: submittedUrl,
                  assetId: typeof slot.result?.assetId === 'string' ? slot.result.assetId : undefined,
                  assetVersionId: typeof slot.result?.assetVersionId === 'string'
                    ? slot.result.assetVersionId
                    : undefined,
                  placementId: typeof slot.result?.placementId === 'string'
                    ? slot.result.placementId
                    : undefined,
                  metadata: {
                    prompt: enhancedPrompt || params.prompt,
                    quality: params.quality,
                    aspectRatio: params.aspectRatio,
                    stylePreset: params.stylePreset,
                    size: params.size,
                    apiBaseUrl: pollingApiBaseUrl || '',
                    generationRouteAudit: data.generationRouteAudit,
                    createdAt: Date.now(),
                  },
                },
              } : {}),
              ...(slot.error ? {
                error: createCanvasTaskEventError(slot.error, {
                  code: 'GENERATION_SUBMIT_FAILED',
                  message: '图像生成任务提交失败',
                  source: 'provider',
                  retryable: false,
                }),
              } : {}),
            });
          });
          return next;
        });

        // 自适应轮询间隔策略（优化版）
        // 前期更快探测，后期适度延长避免浪费请求
        const getPollInterval = (pollCount: number, estTime: number) => {
          // 优化：更激进的初始轮询（300ms起），快速检测任务完成
          // 后端已完成时，前端应在 <1s 内感知到
          const baseInterval = estTime <= 20 ? 300 : estTime <= 60 ? 500 : 800;
          if (pollCount > 50) return baseInterval + 2000;
          if (pollCount > 30) return baseInterval + 1000;
          if (pollCount > 15) return baseInterval + 300;
          return baseInterval;
        };

        // 最大轮询时间：预估时间 * 6 + 120秒（兜底），最少180秒，最多1800秒（30分钟，兼容极慢API如token link）
        // ★ 每个任务独立计算超时：避免串行任务时前期任务消耗掉后期任务的时间预算
        // 全局最大时间：预估时间 * 6 + 120秒（兜底），最少180秒，最多1800秒（30分钟）
        // 单任务最大时间：预估时间 * 4 + 120秒，最少120秒，最多600秒（10分钟）
        const globalMaxPollTime = Math.min(1800, Math.max(180, estimatedTime * 6 + 120)) * 1000;
        const perTaskMaxPollTime = Math.min(600, Math.max(120, estimatedTime * 4 + 120)) * 1000;
        const globalStartTime = Date.now();

        const completedImages: Array<{
          id: string;
          slotIndex: number;
          url: string;
          prompt: string;
          model?: string;
          quality?: string;
          aspectRatio?: string;
          stylePreset?: string;
          category?: string;
          size?: string;
          sourceUrl?: string;
          modelName?: string;
          apiProvider?: string;
          generationRouteAudit?: CanvasImage['generationRouteAudit'];
        }> = [];
        const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'timeout']);
        const activeSubmittedSlots = submittedSlots.filter(slot => !terminalStatuses.has(slot.status));
        let terminalTaskCount = submittedSlots.length - activeSubmittedSlots.length;
        submittedSlots.forEach((submittedSlot) => {
          if (submittedSlot.status !== 'completed') return;
          const completedImageUrls = extractGeneratedImageUrls(submittedSlot.result || {});
          completedImageUrls.forEach((rawImageUrl, imageIdx) => {
            const completedImage = {
              id: placeholderIds[submittedSlot.slotIndex]
                || `${Date.now()}-${submittedSlot.slotIndex}-${imageIdx}`,
              slotIndex: submittedSlot.slotIndex,
              url: rawImageUrl,
              prompt: enhancedPrompt || params.prompt,
              model: params.model,
              quality: params.quality,
              aspectRatio: params.aspectRatio,
              stylePreset: params.stylePreset,
              category: (params.imageCategory && params.imageCategory !== 'none')
                ? params.imageCategory
                : ((params.productCategory && params.productCategory !== 'none')
                  ? params.productCategory
                  : undefined),
              size: params.size,
              sourceUrl: rawImageUrl,
              modelName: pollingModelName || undefined,
              apiProvider: pollingProviderName || params.providerId || undefined,
            };
            completedImages.push(completedImage);
          });
        });

        const updateBatchProgress = (): void => {
          const completedSlots = Math.min(completedImages.length, placeholderIds.length);
          const remainingSlots = Math.max(placeholderIds.length - completedSlots, 0);
          const terminalProgress = taskIds.length > 0
            ? Math.round((terminalTaskCount / taskIds.length) * 100)
            : 100;

          setImages(prev => prev.map((img): CanvasImage => {
            if (!img.isProcessingPlaceholder || !img.processing || !placeholderIds.includes(img.id)) {
              return img;
            }
            if (terminalStatuses.has(img.processing.status)) return img;
            return {
              ...img,
              processing: {
                ...img.processing,
                label: remainingSlots > 0
                  ? `已完成 ${completedSlots}/${placeholderIds.length}，剩余 ${remainingSlots} 张`
                  : '正在整理生成结果',
                progress: terminalProgress,
              },
            };
          }));
        };

        await Promise.all(activeSubmittedSlots.map(async (submittedSlot) => {
          const currentTaskId = submittedSlot.taskId;
          let pollCount = 0;
          let taskCompleted = false;
          let consecutiveErrors = 0;
          const taskStartTime = Date.now(); // ★ 每个任务独立的开始时间

          while (!taskCompleted && isMountedRef.current) {
            const taskElapsed = Date.now() - taskStartTime;
            const globalElapsed = Date.now() - globalStartTime;
            // 检查是否超时：单任务超时 或 全局超时
            if (taskElapsed > perTaskMaxPollTime || globalElapsed > globalMaxPollTime) {
              console.warn(`[生成轮询] 超时退出 taskId=${currentTaskId}, 任务耗时=${Math.round(taskElapsed / 1000)}s, 全局耗时=${Math.round(globalElapsed / 1000)}s, perTaskMax=${perTaskMaxPollTime / 1000}s, globalMax=${globalMaxPollTime / 1000}s`);
              projectWorkspaceTaskEvent({
                taskId: currentTaskId,
                batchId: submittedSlot.batchId,
                slotId: submittedSlot.slotId,
                slotIndex: submittedSlot.slotIndex,
                outputIndex: 0,
                status: 'timeout',
                progress: 0,
                source: 'poll',
                error: createCanvasTaskEventError('生成任务轮询超时', {
                  code: 'GENERATION_POLL_TIMEOUT',
                  message: '生成时间过长，请稍后重试或降低分辨率',
                  source: 'network',
                  retryable: true,
                }),
              });
              terminalTaskCount++;
              updateBatchProgress();
              toast.error('生成超时', {
                description: `${data.modelName} 生成时间过长（已等待${Math.round(taskElapsed / 1000)}秒）。可能原因：API排队中、模型负载高、提示词复杂度高。请稍后重试或降低分辨率`,
                className: 'bg-[#141414] border border-red-900 text-white',
                duration: 10000,
              });
              taskCompleted = true;
              break;
            }

            const interval = getPollInterval(pollCount, estimatedTime);
            await waitForTaskPollInterval({
              taskId: currentTaskId,
              intervalMs: interval,
              isConnected: () => taskEventsClient.isConnected(),
              onTaskEvent: callback => taskEventsClient.onTaskEvent(callback),
            });
            pollCount++;

            try {
              const pollResponse = await fetch('/api/poll-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: currentTaskId, model: params.model, providerId: params.providerId, userId: currentUserRef.current?.id }),              });

              const pollData = await pollResponse.json();
              console.log(`[poll] #${pollCount} taskId=${currentTaskId} success=${pollData.success} status=${pollData.status} retryable=${pollData.retryable} progress=${pollData.progress} taskElapsed=${Math.round((Date.now()-taskStartTime)/1000)}s`);

              if (!pollData.success && !pollData.retryable) {
                // 不可重试的错误
                console.error(`[poll] taskId=${currentTaskId} NON-RETRYABLE error after ${Math.round((Date.now()-taskStartTime)/1000)}s, pollCount=${pollCount}`, pollData.error);
                projectWorkspaceTaskEvent({
                  taskId: currentTaskId,
                  batchId: submittedSlot.batchId,
                  slotId: submittedSlot.slotId,
                  slotIndex: submittedSlot.slotIndex,
                  outputIndex: 0,
                  status: 'failed',
                  progress: pollData.progress || 0,
                  revision: typeof pollData.revision === 'number' ? pollData.revision : undefined,
                  source: 'poll',
                  error: createCanvasTaskEventError(pollData.error, {
                    code: pollData.code || 'GENERATION_FAILED',
                    message: typeof pollData.error === 'string' ? pollData.error : '任务执行失败',
                    source: 'provider',
                    retryable: false,
                  }),
                });
                terminalTaskCount++;
                updateBatchProgress();
                toast.error('生成失败', {
                  description: pollData.error || '任务执行失败',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;
                break;
              }

              // 可重试的错误（如模型返回文本而非图像、API临时429/500等）
              // 根据单任务最大轮询时间动态计算最大重试次数（间隔按3s估算），确保不会过早放弃
              if (!pollData.success && pollData.retryable && pollCount > Math.floor(perTaskMaxPollTime / 3000)) {
                console.warn(`[生成] 可重试错误已达 ${pollCount} 次 (上限 ${Math.floor(perTaskMaxPollTime / 3000)})，最后错误: ${pollData.error}`);
                projectWorkspaceTaskEvent({
                  taskId: currentTaskId,
                  batchId: submittedSlot.batchId,
                  slotId: submittedSlot.slotId,
                  slotIndex: submittedSlot.slotIndex,
                  outputIndex: 0,
                  status: 'failed',
                  progress: pollData.progress || 0,
                  revision: typeof pollData.revision === 'number' ? pollData.revision : undefined,
                  source: 'poll',
                  error: createCanvasTaskEventError(pollData.error, {
                    code: pollData.code || 'GENERATION_RETRY_EXHAUSTED',
                    message: typeof pollData.error === 'string'
                      ? pollData.error
                      : '多次重试后仍未生成图像，建议稍后重试',
                    source: 'provider',
                    retryable: true,
                  }),
                });
                terminalTaskCount++;
                updateBatchProgress();
                toast.error('生成失败', {
                  description: pollData.error || '多次重试后仍未生成图像，建议稍后在画布查看',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;
                break;
              }
              // 可重试错误时短暂等待后继续（不消耗正常轮询间隔）
              if (!pollData.success && pollData.retryable) {
                await new Promise(r => setTimeout(r, 3000));
                continue;
              }

              const completedImageUrls = extractGeneratedImageUrls(pollData as Record<string, unknown>);
              if (pollData.status === 'completed' && completedImageUrls.length > 0) {
                const completedSlotIndex = resolveGenerationSlotIndex(
                  submittedSlot,
                  pollData as Record<string, unknown>,
                );
                completedImageUrls.forEach((rawImageUrl, imageIdx) => {
                  completedImages.push({
                    id: placeholderIds[completedSlotIndex]
                      || `${Date.now()}-${completedSlotIndex}-${imageIdx}`,
                    slotIndex: completedSlotIndex,
                    url: rawImageUrl,
                    prompt: enhancedPrompt || params.prompt,
                    model: params.model,
                    quality: params.quality,
                    aspectRatio: params.aspectRatio,
                    stylePreset: params.stylePreset,
                    category: (params.imageCategory && params.imageCategory !== 'none') ? params.imageCategory : ((params.productCategory && params.productCategory !== 'none') ? params.productCategory : undefined),
                    size: params.size,
                    sourceUrl: rawImageUrl,
                    modelName: pollData.modelName || undefined,
                    apiProvider: pollData.providerName || params.providerId || undefined,
                    generationRouteAudit: pollData.generationRouteAudit,
                  });
                });
                const completedSlotImage = completedImages.find(image => image.slotIndex === completedSlotIndex);
                if (completedSlotImage) {
                  projectWorkspaceTaskEvent({
                    taskId: currentTaskId,
                    batchId: submittedSlot.batchId,
                    slotId: submittedSlot.slotId,
                    slotIndex: completedSlotIndex,
                    outputIndex: 0,
                    status: 'completed',
                    progress: 100,
                    revision: typeof pollData.revision === 'number' ? pollData.revision : undefined,
                    source: 'poll',
                    providerId: pollData.providerId || params.providerId,
                    providerName: pollData.providerName || pollingProviderName,
                    modelId: pollData.usedModel || params.model,
                    modelName: pollData.modelName || pollingModelName,
                    result: {
                      url: completedSlotImage.url,
                      sourceUrl: completedSlotImage.sourceUrl,
                      assetVersionId: pollData.assetVersionId || pollData.result?.assetVersionId,
                      placementId: pollData.placementId || pollData.result?.placementId,
                      metadata: {
                        prompt: completedSlotImage.prompt,
                        quality: completedSlotImage.quality,
                        aspectRatio: completedSlotImage.aspectRatio,
                        stylePreset: completedSlotImage.stylePreset,
                        category: completedSlotImage.category,
                        size: completedSlotImage.size,
                        apiBaseUrl: pollingApiBaseUrl || '',
                        generationRouteAudit: completedSlotImage.generationRouteAudit,
                        createdAt: Date.now(),
                      },
                    },
                  });
                }
                taskCompleted = true;
                consecutiveErrors = 0;
                terminalTaskCount++;
                updateBatchProgress();

              } else if (pollData.status === 'failed') {
                console.warn(`[poll] taskId=${currentTaskId} FAILED after ${Math.round((Date.now()-taskStartTime)/1000)}s, pollCount=${pollCount}`, pollData.error);
                projectWorkspaceTaskEvent({
                  taskId: currentTaskId,
                  batchId: submittedSlot.batchId,
                  slotId: submittedSlot.slotId,
                  slotIndex: submittedSlot.slotIndex,
                  outputIndex: 0,
                  status: 'failed',
                  progress: pollData.progress || 0,
                  revision: typeof pollData.revision === 'number' ? pollData.revision : undefined,
                  source: 'poll',
                  error: createCanvasTaskEventError(pollData.error, {
                    code: pollData.code || 'GENERATION_FAILED',
                    message: typeof pollData.error === 'string' ? pollData.error : '图像生成任务失败',
                    source: 'provider',
                    retryable: pollData.retryable === true,
                  }),
                });
                terminalTaskCount++;
                updateBatchProgress();
                toast.error('生成失败', {
                  description: pollData.error || '图像生成任务失败',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;

              } else if (pollData.status === 'cancelled') {
                projectWorkspaceTaskEvent({
                  taskId: currentTaskId,
                  batchId: submittedSlot.batchId,
                  slotId: submittedSlot.slotId,
                  slotIndex: submittedSlot.slotIndex,
                  outputIndex: 0,
                  status: 'cancelled',
                  progress: pollData.progress || 0,
                  revision: typeof pollData.revision === 'number' ? pollData.revision : undefined,
                  source: 'poll',
                  error: createCanvasTaskEventError(pollData.error, {
                    code: 'TASK_CANCELLED',
                    message: typeof pollData.error === 'string' ? pollData.error : '图像生成任务被取消',
                    source: 'provider',
                    retryable: false,
                  }),
                });
                terminalTaskCount++;
                updateBatchProgress();
                toast.error('任务已取消', {
                  description: pollData.error || '图像生成任务被取消',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;

              } else {
                // pending / processing - 更新进度（根据API返回的estimatedTime动态调整）
                projectWorkspaceTaskEvent({
                  taskId: currentTaskId,
                  batchId: submittedSlot.batchId,
                  slotId: submittedSlot.slotId,
                  slotIndex: submittedSlot.slotIndex,
                  outputIndex: 0,
                  status: pollData.status === 'queued' || pollData.status === 'uploading' || pollData.status === 'submitting'
                    ? pollData.status
                    : 'processing',
                  progress: typeof pollData.progress === 'number' ? pollData.progress : Math.min(95, pollCount * 2),
                  revision: typeof pollData.revision === 'number' ? pollData.revision : undefined,
                  label: pollData.label,
                  source: 'poll',
                });
                if (pollData.estimatedTime && pollCount === 1) {
                  console.log(`Task ${currentTaskId} estimated time: ${pollData.estimatedTime}s`);
                }
                consecutiveErrors = 0;
              }

            } catch (pollError) {
              consecutiveErrors++;
              console.error(`Poll error (consecutive: ${consecutiveErrors}):`, pollError);

              if (consecutiveErrors >= 5) {
                projectWorkspaceTaskEvent({
                  taskId: currentTaskId,
                  batchId: submittedSlot.batchId,
                  slotId: submittedSlot.slotId,
                  slotIndex: submittedSlot.slotIndex,
                  outputIndex: 0,
                  status: 'failed',
                  progress: 0,
                  source: 'poll',
                  error: createCanvasTaskEventError(pollError, {
                    code: 'TASK_POLL_NETWORK_FAILURE',
                    message: '连续多次查询失败，请检查网络连接',
                    source: 'network',
                    retryable: true,
                  }),
                });
                terminalTaskCount++;
                updateBatchProgress();
                toast.error('轮询失败', {
                  description: '连续多次查询失败，请检查网络连接',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;
              }
              // 否则继续轮询
            }
          }
        }));

        // 处理完成的图片 - 自动排列布局
        if (completedImages.length > 0) {
          // 持久化 data: URL（base64 图片保存到服务器，避免刷新丢失）— 并行化
          const persistPromises = completedImages
            .filter(img => img.url.startsWith('data:'))
            .map(async (img) => {
              try {
                const saveResp = await fetch('/api/save-image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageUrl: img.url, userId: currentUserRef.current?.id, sourceUrl: img.sourceUrl }),
                });
                const saveData = await saveResp.json();
                if (saveData.success && saveData.url) {
                  img.url = saveData.url;
                  img.sourceUrl = img.sourceUrl || saveData.sourceUrl;
                }
              } catch { /* save failed, keep data URL */ }
            });
          await Promise.all(persistPromises);

          const getDisplaySize = (size: string) => {
            let originalWidth = 1024;
            let originalHeight = 1024;
            if (size && (size.includes('x') || size.includes('×'))) {
              const parts = size.replace(/×/g, 'x').split('x');
              originalWidth = parseInt(parts[0]) || 1024;
              originalHeight = parseInt(parts[1]) || 1024;
            }
            return { w: originalWidth, h: originalHeight };
          };

          const loadActualSize = (url: string): Promise<{ w: number; h: number }> => {
            return new Promise(resolve => {
              const img = new window.Image();
              img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
              img.onerror = () => resolve({ w: 0, h: 0 });
              img.src = url;
            });
          };
          const actualSizes = await Promise.all(completedImages.map(img => loadActualSize(img.url)));

          const displayScale = 0.5;
          const completedCanvasImages = completedImages.map((img, idx) => {
            const displaySize = getDisplaySize(params.size);
            // 优先使用图片真实像素尺寸，fallback到请求尺寸
            const finalW = actualSizes[idx]?.w > 0 ? actualSizes[idx].w : displaySize.w;
            const finalH = actualSizes[idx]?.h > 0 ? actualSizes[idx].h : displaySize.h;
            return {
              slotIndex: img.slotIndex,
              image: {
              id: img.id,
              url: img.url,
              prompt: img.prompt,
              modifyPrompt: undefined,
              model: img.model,
              quality: img.quality,
              aspectRatio: img.aspectRatio,
              stylePreset: img.stylePreset,
              category: img.category,
              size: img.size,
              x: 0,
              y: 0,
              width: finalW * displayScale,
              height: finalH * displayScale,
              originalWidth: finalW,
              originalHeight: finalH,
              createdAt: Date.now(),
              modelName: img.modelName || pollingModelName || img.model,
              apiProvider: img.apiProvider || pollingProviderName || params.providerId || '',
              apiBaseUrl: pollingApiBaseUrl || '',
              generationRouteAudit: img.generationRouteAudit,
              },
            };
          });

          // Terminal identity is owned by projectWorkspaceTaskEvent. This pass
          // only enriches already-completed slots with the decoded pixel size.
          setImages(prev => {
            const dimensionsByPlaceholderId = new Map(
              completedCanvasImages.flatMap(({ slotIndex, image }) => {
                const placeholderId = placeholderIds[slotIndex];
                return placeholderId ? [[placeholderId, image] as const] : [];
              }),
            );
            const updated = prev.map((existing) => {
              const completed = dimensionsByPlaceholderId.get(existing.id);
              if (!completed || existing.taskProjection?.status !== 'completed') return existing;
              const displayHeight = existing.height;
              const displayWidth = completed.originalHeight > 0
                ? Math.round(displayHeight * completed.originalWidth / completed.originalHeight)
                : existing.width;
              return {
                ...existing,
                width: displayWidth,
                height: displayHeight,
                originalWidth: completed.originalWidth,
                originalHeight: completed.originalHeight,
              };
            });
            stabilizeCanvasImages(updated.map(img => ({ id: img.id, url: img.url })));
            return updated;
          });

          toast.success(`生成成功`, {
            description: `已生成 ${completedImages.length} 张图片`,
            className: 'bg-[#141414] border-[#2a2a2a] text-white',
          });
          try { UserManagerCore.getInstance().recordUsage('image'); } catch { /* non-blocking */ }
        } else {
          // 本批次没有任何成功结果时，统一移除本批次占位框，避免失败/取消/超时后残留加载态。
          setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
        }

      // === 旧模式兼容：直接返回结果 - 自动排列布局 ===
      } else if (data.success && data.images) {
        // 持久化 data: URL — 并行化
        const persistPromises = (data.images as Array<{ url: string; sourceUrl?: string }>)
          .filter(img => img.url.startsWith('data:'))
          .map(async (img) => {
            try {
              const saveResp = await fetch('/api/save-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: img.url, userId: currentUserRef.current?.id, sourceUrl: img.sourceUrl }),
              });
              const saveData = await saveResp.json();
              if (saveData.success && saveData.url) {
                img.url = saveData.url;
                img.sourceUrl = img.sourceUrl || saveData.sourceUrl;
              }
            } catch { /* save failed, keep data URL */ }
          });
        await Promise.all(persistPromises);

        const getDisplaySize = (size: string) => {
          let originalWidth = 1024;
          let originalHeight = 1024;
          if (size && (size.includes('x') || size.includes('×'))) {
            const parts = size.replace(/×/g, 'x').split('x');
            originalWidth = parseInt(parts[0]) || 1024;
            originalHeight = parseInt(parts[1]) || 1024;
          }
          return { w: originalWidth, h: originalHeight };
        };

        // 加载每张图片的真实像素尺寸
        const loadActualSize = (url: string): Promise<{ w: number; h: number }> => {
          return new Promise(resolve => {
            const img = new window.Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ w: 0, h: 0 });
            img.src = url;
          });
        };
        const legacyActualSizes = await Promise.all(
          (data.images as Array<{ url: string }>).map((img: { url: string }) => loadActualSize(img.url))
        );

        const displayScale = 0.5;
        const legacyImages: CanvasImage[] = data.images.map((img: { id: string; url: string; prompt: string }, idx: number) => {
          const displaySize = getDisplaySize(params.size);
          const finalW = legacyActualSizes[idx]?.w > 0 ? legacyActualSizes[idx].w : displaySize.w;
          const finalH = legacyActualSizes[idx]?.h > 0 ? legacyActualSizes[idx].h : displaySize.h;
          return {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            url: img.url,
            prompt: img.prompt,
            model: params.model,
            quality: params.quality,
            aspectRatio: params.aspectRatio,
            stylePreset: params.stylePreset,
            category: (params.imageCategory && params.imageCategory !== 'none') ? params.imageCategory : ((params.productCategory && params.productCategory !== 'none') ? params.productCategory : undefined),
            size: params.size,
            x: 0,
            y: 0,
            width: finalW * displayScale,
            height: finalH * displayScale,
            originalWidth: finalW,
            originalHeight: finalH,
            createdAt: Date.now(),
          };
        });

        setImages(prev => {
          let updated = [...prev];
          for (let i = 0; i < legacyImages.length; i++) {
            const phId = placeholderIds[i];
            if (phId) {
              const phIdx = updated.findIndex(img => img.id === phId);
              if (phIdx >= 0) {
                updated[phIdx] = { ...legacyImages[i], x: updated[phIdx].x, y: updated[phIdx].y };
              } else {
                updated.push(legacyImages[i]);
              }
            } else {
              updated.push(legacyImages[i]);
            }
          }
          const usedPlaceholderIds = new Set(placeholderIds.slice(0, legacyImages.length));
          updated = updated.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id) || usedPlaceholderIds.has(img.id));
          stabilizeCanvasImages(updated.map(img => ({ id: img.id, url: img.url })));
          return updated;
        });
        toast.success(`生成成功`, {
          description: `已生成 ${data.images.length} 张图片`,
          className: 'bg-[#141414] border-[#2a2a2a] text-white',
        });
        try { UserManagerCore.getInstance().recordUsage('image'); } catch { /* non-blocking */ }

      // === 错误处理 ===
      } else if (data.requiresApiKey) {
        toast.warning(`${data.modelName || '当前模型'} 需要配置 API Key`, {
          description: '请联系管理员在后台配置可用的 API Key',
          action: data.docsUrl ? {
            label: '查看文档',
            onClick: () => window.open(data.docsUrl, '_blank')
          } : undefined,
          className: 'bg-[#141414] border border-amber-700 text-white',
        });
      } else if (data.networkError) {
        // 清理占位框
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
        toast.error('网络连接失败', {
          description: data.error || '无法访问 API 服务',
          className: 'bg-[#141414] border border-red-900 text-white',
          duration: 8000,
        });
      } else {
        // 清理占位框
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
        toast.error('生成失败', {
          description: data.error || '未知错误',
          className: 'bg-[#141414] border border-red-900 text-white',
        });
      }
    } catch (error) {
      // 清理占位框
      setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
      console.error('Generation error:', error);
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      toast.error('生成失败', {
        description: isAbort ? '请求超时，请检查网络后重试' : '网络错误，请重试',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
    } finally {
      setActiveGenerationCount(prev => Math.max(0, prev - 1));
    }
  }, [projectWorkspaceTaskEvent, setImages, stabilizeCanvasImages, themeStyle]);

  // 添加参考图到画布
  const handleAddToCanvas = useCallback(async (imageUrl: string) => {
    // 检查图片是否已存在于画布中（使用ref避免闭包过期）
    if (latestImagesRef.current.some(img => img.url === imageUrl)) {
      toast.info('图片已在画布中', {
        description: '该参考图已经添加到画布',
        className: 'bg-[#141414] border-[#2a2a2a] text-white',
      });
      return;
    }
    const { width: natW, height: natH } = await loadCanvasImageSize(imageUrl);
    const displaySize = getCanvasImageDisplaySize(natW, natH);
    const newImage: CanvasImage = {
      id: `ref-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      url: imageUrl,
      prompt: '',
      x: Math.random() * 400 + 100,
      y: Math.random() * 400 + 100,
      width: displaySize.width,
      height: displaySize.height,
      originalWidth: natW,
      originalHeight: natH,
      createdAt: Date.now(),
    };
    setImages(prev => [...prev, newImage]);
    recordUserData({
      userId: currentUserRef.current?.id,
      area: 'images',
      type: 'add-to-canvas',
      filename: `${newImage.id}.json`,
      content: JSON.stringify(newImage, null, 2),
      metadata: { source: 'canvas', imageUrl },
    });
    stabilizeCanvasImages([{ id: newImage.id, url: imageUrl }]);
    toast.success('已添加到画布', {
      description: '参考图已成功添加到画布',
      className: 'bg-[#141414] border-[#2a2a2a] text-white',
    });
  }, [setImages, stabilizeCanvasImages]); // 使用 latestImagesRef/currentUserRef 避免 images 闭包

  // 自动排列布局：横向顶对齐，间距10px，超出视口宽度换行
  const autoLayoutImages = useCallback((existingImages: CanvasImage[], newImages: CanvasImage[]): CanvasImage[] => {
    const GAP = 10;

    // 计算当前视口中心（画布坐标系）
    const canvasEl = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
    const viewportWidth = canvasEl ? canvasEl.clientWidth : 1200;
    const viewportHeight = canvasEl ? canvasEl.clientHeight : 800;

    // 从 DOM 上读取当前 viewOffset 和 zoom（通过 CSS transform）
    let viewOffsetX = 0;
    let viewOffsetY = 0;
    let currentZoom = 1;
    const transformLayer = canvasEl?.querySelector('[style*="transform"]') as HTMLElement | null;
    if (transformLayer) {
      const style = transformLayer.style;
      const match = style.transform?.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/);
      if (match) {
        viewOffsetX = parseFloat(match[1]);
        viewOffsetY = parseFloat(match[2]);
        currentZoom = parseFloat(match[3]);
      }
    }

    // 视口中心在画布坐标中的位置
    const canvasCenterX = (viewportWidth / 2 - viewOffsetX) / currentZoom;
    const canvasCenterY = (viewportHeight / 2 - viewOffsetY) / currentZoom;

    // 收集所有已有图片的边界框
    let maxRight = 0;
    let maxBottom = 0;
    for (const img of existingImages) {
      const r = img.x + img.width;
      const b = img.y + img.height;
      if (r > maxRight) maxRight = r;
      if (b > maxBottom) maxBottom = b;
    }

    // 新图片的起始位置
    let startX: number;
    let startY: number;

    if (existingImages.length > 0) {
      // 有已有图片时，从最右侧追加
      startX = maxRight + GAP;
      startY = 0;
    } else {
      // 没有已有图片时，在视口中心开始
      // 先计算所有新图片的总宽度，用于居中
      const totalWidth = newImages.reduce((sum, img) => sum + img.width + GAP, -GAP);
      const totalHeight = newImages.length > 0 ? Math.max(...newImages.map(img => img.height)) : 0;
      startX = canvasCenterX - totalWidth / 2;
      startY = canvasCenterY - totalHeight / 2;
    }

    // 行布局
    let currentX = startX;
    let currentY = startY;
    let rowHeight = 0;
    const laidOut: CanvasImage[] = [];

    for (const img of newImages) {
      // 如果当前行超出视口右边，换行
      if (currentX + img.width > startX + viewportWidth / currentZoom && currentX > startX) {
        currentX = startX;
        currentY += rowHeight + GAP;
        rowHeight = 0;
      }

      laidOut.push({
        ...img,
        x: currentX,
        y: currentY,
      });

      rowHeight = Math.max(rowHeight, img.height);
      currentX += img.width + GAP;
    }

    return laidOut;
  }, []);

  // 加载图片真实尺寸
  // 添加多张图片到画布（自动排列布局）
  const handleAddImages = useCallback(async (imageInputs: Array<string | WorkflowCanvasInsertionItem>, sourceImageId?: string, meta?: { modelName?: string; apiProvider?: string; relationType?: ConnectionRelationType }) => {
    const newImages: CanvasImage[] = [];

    // Find source image for positioning if provided
    const sourceImg = sourceImageId ? images.find(img => img.id === sourceImageId) : null;

    // ★ 确定模型信息：优先使用 meta 参数，其次从源图继承
    const effectiveModelName = meta?.modelName || sourceImg?.modelName || '';
    const effectiveApiProvider = meta?.apiProvider || sourceImg?.apiProvider || '';

    for (let i = 0; i < imageInputs.length; i++) {
      const insertionItem = typeof imageInputs[i] === 'string'
        ? undefined
        : imageInputs[i] as WorkflowCanvasInsertionItem;
      let rawUrl = insertionItem?.url || imageInputs[i] as string;
      const transferredReference = insertionItem?.assetReference;
      if (transferredReference) rawUrl = transferredReference.url;
      // 将 blob: URL 转为 data URL（blob: 在页面刷新后失效）
      if (rawUrl.startsWith('blob:')) {
        try {
          const blobResp = await fetch(rawUrl);
          const blob = await blobResp.blob();
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          rawUrl = dataUrl;
        } catch { /* conversion failed, keep blob URL */ }
      }

      // 将 data: URL 和外部 HTTP URL 持久化到服务器（避免数据丢失和外部 URL 过期）
      if (!transferredReference && (rawUrl.startsWith('data:') || rawUrl.startsWith('http'))) {
        try {
          const saveResp = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: rawUrl, userId: currentUser?.id }),
          });
          if (!saveResp.ok) {
            console.warn(`[handleAddImages] save-image returned ${saveResp.status} for image, keeping original URL`);
          } else {
            const saveData = await saveResp.json();
            if (saveData.success && saveData.url) {
              rawUrl = saveData.url;
            } else {
              console.warn('[handleAddImages] save-image returned non-success:', saveData.error || 'unknown');
            }
          }
        } catch (err) {
          console.warn('[handleAddImages] save-image failed, keeping original URL:', err);
        }
      }

      // 跳过已存在的图片
      if (!transferredReference && (images.some(img => img.url === rawUrl) || newImages.some(img => img.url === rawUrl))) {
        continue;
      }
      // 先获取图片真实尺寸
      const { width: natW, height: natH } = await loadCanvasImageSize(rawUrl);
      const displaySize = getCanvasImageDisplaySize(natW, natH);

      const fallbackId = insertionItem?.outputNodeId || `ref-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const tempId = transferredReference
        ? canvasEntityIdForTransferredReference(transferredReference, fallbackId)
        : fallbackId;
      // If source image exists, position generated images to its right
      const offsetX = sourceImg ? sourceImg.x + sourceImg.width + 30 : 0;
      const offsetY = sourceImg ? sourceImg.y + i * (displaySize.height + 20) : 0;

      newImages.push({
        id: tempId,
        url: rawUrl,
        prompt: '',
        x: offsetX,
        y: offsetY,
        width: displaySize.width,
        height: displaySize.height,
        originalWidth: natW,
        originalHeight: natH,
        createdAt: Date.now(),
        generatedFromImageId: sourceImageId,
        ...(transferredReference?.assetId ? { assetId: transferredReference.assetId } : {}),
        ...(transferredReference?.assetVersionId ? { assetVersionId: transferredReference.assetVersionId } : {}),
        ...(transferredReference?.placementId ? { placementId: transferredReference.placementId } : {}),
        // ★ 保留模型信息和API提供商信息
        ...(effectiveModelName ? { modelName: effectiveModelName } : {}),
        ...(effectiveApiProvider ? { apiProvider: effectiveApiProvider } : {}),
      });
    }

    if (newImages.length > 0) {
      const previousImages = latestImagesRef.current;
      const insertedImages = sourceImg
        ? newImages
        : autoLayoutImages(previousImages, newImages);
      const nextImages = [...previousImages, ...insertedImages];
      latestImagesRef.current = nextImages;
      setImages(nextImages);
      if (!sourceImg) {
        stabilizeCanvasImages(insertedImages.map(img => ({ id: img.id, url: img.url })));
      }
      // ★ 自动连线：当有源图片时，为新图片自动创建连线
      if (sourceImageId && newImages.length > 0) {
        const relationType = meta?.relationType || 'variant';
        setCanvasConnections(prev => {
          const newConns = newImages.map(img =>
            createAutoConnection(sourceImageId, img.id, relationType)
          );
          return [...prev, ...newConns];
        });
      }
      recordUserData({
        userId: currentUser?.id,
        area: 'images',
        type: 'canvas-add-batch',
        filename: `canvas-images-${Date.now()}.json`,
        content: JSON.stringify(newImages, null, 2),
        metadata: { imageCount: newImages.length },
      });
      if (insertedImages.some(image => image.assetVersionId && image.placementId)) {
        persistCanvasImagesNow(nextImages);
        await UserManagerCore.getInstance().flushProjectsToServer();
      }
      if (sourceImg && newImages.length > 1) {
        toast.success(`已生成 ${newImages.length} 张图片，已与原图连线`, {
          description: '图片组已自动排列在原图右侧',
          className: 'bg-[#141414] border-[#2a2a2a] text-white',
        });
      } else {
        toast.success(`已添加 ${newImages.length} 张图片到画布`, {
          description: '图片已自动排列到画布',
          className: 'bg-[#141414] border-[#2a2a2a] text-white',
        });
      }
    } else if (imageInputs.length > 0) {
      toast.info('图片已在画布中', {
        description: '所有图片已经存在于画布',
        className: 'bg-[#141414] border-[#2a2a2a] text-white',
      });
    }
  }, [images, currentUser?.id, setImages, autoLayoutImages, stabilizeCanvasImages, persistCanvasImagesNow]);

  const handleAddEmbeddedChatImage = useCallback(async (
    reference: WorkspaceAssetReference,
    meta?: { modelName?: string; apiProvider?: string; sourceImageId?: string },
  ) => {
    if (!currentProject?.id || !reference.assetVersionId) {
      await handleAddImages([reference.url], meta?.sourceImageId, meta);
      return;
    }
    const requestNonce = Date.now();
    const response = await fetch('/api/assets/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceVersion: reference.assetVersionId,
        targetProject: currentProject.id,
        targetWorkspace: `canvas:${currentProject.id}`,
        entityType: 'canvas-image',
        entityId: `embedded-chat:${requestNonce}`,
        idempotencyKey: `embedded-chat-canvas:${currentProject.id}:${reference.assetVersionId}:${requestNonce}`,
        metadata: { source: 'embedded-chat' },
      }),
    });
    if (!response.ok) throw new Error(`Asset transfer failed (${response.status})`);
    const transferred = await response.json() as WorkspaceAssetReference;
    if (!transferred.assetVersionId || !transferred.placementId) {
      throw new Error('Asset transfer returned an incomplete reference');
    }
    await handleAddImages([{
      outputNodeId: `embedded-chat:${transferred.placementId}`,
      url: transferred.url,
      assetReference: transferred,
    }], meta?.sourceImageId, meta);
  }, [currentProject?.id, handleAddImages]);

  const handleUploadEffectReverseSource = useCallback(async (file: File): Promise<CanvasImage> => {
    if (!currentProject?.id) {
      throw new Error('请先保存或选择一个项目');
    }

    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/save-image', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    const payload = await response.json().catch(() => null) as {
      success?: boolean;
      url?: string;
      error?: string;
    } | null;
    if (!response.ok || !payload?.success || !payload.url) {
      throw new Error(payload?.error || `源图保存失败 (${response.status})`);
    }

    const { width: naturalWidth, height: naturalHeight } = await loadCanvasImageSize(payload.url);
    const displaySize = getCanvasImageDisplaySize(naturalWidth, naturalHeight);
    const createdAt = Date.now();
    const imageId = `effect-reverse-source-${createdAt}-${Math.random().toString(36).slice(2, 9)}`;
    const baseImage: CanvasImage = {
      id: imageId,
      url: payload.url,
      prompt: '',
      name: file.name,
      x: 0,
      y: 0,
      width: displaySize.width,
      height: displaySize.height,
      originalWidth: naturalWidth,
      originalHeight: naturalHeight,
      createdAt,
      annotationVersionId: buildAnnotationSourceVersionId(imageId, createdAt, payload.url),
    };
    const previousImages = latestImagesRef.current;
    const uploaded = autoLayoutImages(previousImages, [baseImage])[0] || baseImage;
    const nextImages = [...previousImages, uploaded];
    const persistableCanvasImages = serializeCanvasWorkspacePlacements(nextImages).map((image) => ({
      ...image,
      id: image.id,
      url: image.url,
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
      originalWidth: image.originalWidth || image.width,
      originalHeight: image.originalHeight || image.height,
      rotation: image.rotation ?? 0,
      zIndex: image.zIndex ?? 0,
      createdAt: image.createdAt || Date.now(),
      prompt: image.prompt || '',
      ...(image.annotationVersionId ? { annotationVersionId: image.annotationVersionId } : {}),
    }));

    latestImagesRef.current = nextImages;
    setImages(nextImages);
    const manager = UserManagerCore.getInstance();
    manager.updateProject(currentProject.id, {
      canvasImages: persistableCanvasImages,
      metadata: {
        ...(currentProject.metadata || {}),
        groups: groupsRef.current,
        viewState: viewStateRef.current,
        annotationsV2: annotationRecordsRef.current,
      },
    });

    try {
      await UserManagerCore.getInstance().flushProjectsToServer();
    } catch (error) {
      latestImagesRef.current = previousImages;
      setImages(previousImages);
      manager.updateProject(currentProject.id, {
        canvasImages: serializeCanvasWorkspacePlacements(previousImages).map((image) => ({
          ...image,
          id: image.id,
          url: image.url,
          x: image.x,
          y: image.y,
          width: image.width,
          height: image.height,
          originalWidth: image.originalWidth || image.width,
          originalHeight: image.originalHeight || image.height,
          rotation: image.rotation ?? 0,
          zIndex: image.zIndex ?? 0,
          createdAt: image.createdAt || Date.now(),
          prompt: image.prompt || '',
          ...(image.annotationVersionId ? { annotationVersionId: image.annotationVersionId } : {}),
        })),
      });
      throw new Error(error instanceof Error ? error.message : '项目同步失败，源图未加入反拆任务');
    }

    stabilizeCanvasImages([{ id: uploaded.id, url: uploaded.url }]);
    setSelectedImage(uploaded);
    toast.success('源图已保存到项目并载入反向拆图');
    return uploaded;
  }, [autoLayoutImages, currentProject, getCanvasImageDisplaySize, loadCanvasImageSize, setImages, stabilizeCanvasImages]);

  const handleAddVectorAsset = useCallback(async (asset: VectorDesignAsset, sourceImageId?: string) => {
    const sourceImage = sourceImageId ? latestImagesRef.current.find(img => img.id === sourceImageId) : undefined;
    const baseSize = sourceImage
      ? await loadCanvasImageSize(sourceImage.url)
      : { width: asset.width, height: asset.height };
    const display = getCanvasImageDisplaySize(baseSize.width, baseSize.height);
    const baseX = sourceImage ? sourceImage.x + sourceImage.width + 20 : 0;
    const baseY = sourceImage ? sourceImage.y : 0;
    const newImage: CanvasImage = {
      id: `vector-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      url: asset.previewUrl,
      svgUrl: asset.svgUrl,
      svgDataUrl: asset.svg,
      prompt: 'AI 矢量设计',
      x: baseX,
      y: baseY,
      width: display.width,
      height: display.height,
      originalWidth: baseSize.width,
      originalHeight: baseSize.height,
      createdAt: Date.now(),
      modelName: asset.model || 'AI 矢量设计',
      apiProvider: asset.providerName || asset.providerId,
      generatedFromImageId: sourceImage?.id,
    };
    setImages(prev => [...prev, newImage]);
    if (sourceImage) {
      setCanvasConnections(prev => [...prev, createAutoConnection(sourceImage.id, newImage.id, 'edit', 'AI 矢量')]);
    }
    stabilizeCanvasImages([{ id: newImage.id, url: newImage.url }]);
    recordUserData({
      userId: currentUser?.id,
      area: 'images',
      type: 'vector-design-add',
      metadata: { model: asset.model, provider: asset.providerName || asset.providerId },
    });
    toast.success('矢量图已插入画布', {
      description: 'PNG 预览用于画布展示，SVG 原件已保存，可在矢量面板继续编辑或下载',
      className: 'bg-[#141414] border-[#2a2a2a] text-white',
    });
  }, [currentUser?.id, getCanvasImageDisplaySize, loadCanvasImageSize, setCanvasConnections, setImages, stabilizeCanvasImages]);

  // 提取图片关键词
  const handleExtractPrompt = useCallback(async (imageUrl: string) => {
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageUrl, category: 'general' }),
      });
      const data = await response.json();
      if (data.success && data.prompt) {
        // 创建带有关键词的新图片
        const newImage: CanvasImage = {
          id: `extracted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          url: imageUrl,
          prompt: data.prompt,
          x: Math.random() * 400 + 100,
          y: Math.random() * 400 + 100,
          width: 256,
          height: 256,
          originalWidth: 512,
          originalHeight: 512,
          createdAt: Date.now(),
        };
        setImages(prev => [...prev, newImage]);
        // 同时复制到剪贴板
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(data.prompt);
        }
        toast.success('关键词已提取并复制', {
          description: data.prompt.substring(0, 50) + '...',
          className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
        });
        return data.prompt;
      }
    } catch (error) {
      console.error('Extract prompt error:', error);
      toast.error('提取失败', {
        description: '关键词提取失败，请重试',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
    }
    return null;
  }, [setImages, themeStyle]);

  useCallback(async (params: GenerationParams & { originalImage: CanvasImage }) => {
        // 如果有原图，使用原图作为参考
        if (params.originalImage.url) {
          params.referenceImages = [params.originalImage.url];
          params.referenceMode = 'style';
        }

        setActiveGenerationCount(prev => prev + 1);

        try {

          const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...params, userId: currentUserRef.current?.id, submitOnly: true }),      });

          const data = await response.json();

          // === 新模式：前端轮询 ===
          if (data.success && data.mode === 'polling') {
            const { taskIds, estimatedTime, prompt: enhancedPrompt } = data;

            const getPollInterval = (pollCount: number, estTime: number) => {
              // 优化：更激进的初始轮询
              const baseInterval = estTime <= 20 ? 300 : estTime <= 60 ? 500 : 800;
              if (pollCount > 50) return baseInterval + 2000;
              if (pollCount > 30) return baseInterval + 1000;
              if (pollCount > 15) return baseInterval + 300;
              return baseInterval;
            };

            // ★ 每个任务独立计算超时：避免串行任务时前期任务消耗掉后期任务的时间预算
            // 全局最大时间：预估时间 * 5 + 120秒，最少180秒，最多1800秒（30分钟）
            // 单任务最大时间：预估时间 * 4 + 120秒，最少120秒，最多600秒（10分钟）
            const globalMaxPollTime = Math.min(1800, Math.max(180, estimatedTime * 5 + 120)) * 1000;
            const perTaskMaxPollTime = Math.min(600, Math.max(120, estimatedTime * 4 + 120)) * 1000;
            const globalStartTime = Date.now();

            const completedImages: Array<{ id: string; url: string; prompt: string; model?: string; quality?: string; aspectRatio?: string; stylePreset?: string; category?: string; size?: string; sourceUrl?: string; modelName?: string; apiProvider?: string }> = [];        let consecutiveErrors = 0;

            for (let taskIdx = 0; taskIdx < taskIds.length; taskIdx++) {
              const currentTaskId = taskIds[taskIdx];
              let pollCount = 0;
              let taskCompleted = false;
              const taskStartTime = Date.now(); // ★ 每个任务独立的开始时间

              while (!taskCompleted && isMountedRef.current) {
                const taskElapsed = Date.now() - taskStartTime;
                const globalElapsed = Date.now() - globalStartTime;
                if (taskElapsed > perTaskMaxPollTime || globalElapsed > globalMaxPollTime) {
                  toast.error('生成超时', {
                    description: `已等待${Math.round(taskElapsed / 1000)}秒，请尝试降低分辨率或简化提示词后重试`,
                    className: 'bg-[#141414] border border-red-900 text-white',
                  });
                  break;
                }

                const interval = getPollInterval(pollCount, estimatedTime);
                await waitForTaskPollInterval({
                  taskId: currentTaskId,
                  intervalMs: interval,
                  isConnected: () => taskEventsClient.isConnected(),
                  onTaskEvent: callback => taskEventsClient.onTaskEvent(callback),
                });
                pollCount++;

                try {
                  const pollResponse = await fetch('/api/poll-task', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId: currentTaskId, model: params.model, providerId: params.providerId, userId: currentUserRef.current?.id }),
                  });

                  const pollData = await pollResponse.json();

                  if (!pollData.success && !pollData.retryable) {
                    toast.error('生成失败', {
                      description: pollData.error || '任务执行失败',
                      className: 'bg-[#141414] border border-red-900 text-white',
                    });
                    taskCompleted = true;
                    break;
                  }

                  const completedImageUrls = extractGeneratedImageUrls(pollData as Record<string, unknown>);
                  if (pollData.status === 'completed' && completedImageUrls.length > 0) {
                    completedImageUrls.forEach((imageUrl, imageIdx) => {
                      completedImages.push({
                        id: `${Date.now()}-${taskIdx}-${imageIdx}`,
                        url: imageUrl,
                        prompt: enhancedPrompt || params.prompt,
                        model: params.model,
                        quality: params.quality,
                        aspectRatio: params.aspectRatio,
                        stylePreset: params.stylePreset,
                        category: (params.imageCategory && params.imageCategory !== 'none') ? params.imageCategory : ((params.productCategory && params.productCategory !== 'none') ? params.productCategory : undefined),
                        size: params.size,
                        sourceUrl: imageUrl,
                        modelName: pollData.modelName || '',
                        apiProvider: pollData.providerName || '',
                      });
                    });
                    taskCompleted = true;
                    consecutiveErrors = 0;
                  } else if (pollData.status === 'failed' || pollData.status === 'cancelled') {
                    toast.error('生成失败', {
                      description: pollData.error || '任务失败',
                      className: 'bg-[#141414] border border-red-900 text-white',
                    });
                    taskCompleted = true;
                  } else {
                    consecutiveErrors = 0;
                  }
                } catch {
                  consecutiveErrors++;
                  if (consecutiveErrors >= 5) {
                    toast.error('轮询失败', {
                      description: '连续多次查询失败，请检查网络',
                      className: 'bg-[#141414] border border-red-900 text-white',
                    });
                    taskCompleted = true;
                  }
                }
              }
            }

            if (completedImages.length > 0) {
              const originalImg = params.originalImage;
              const newImages: CanvasImage[] = completedImages.map((img) => ({
                id: img.id,
                url: img.url,
                prompt: img.prompt,
                model: img.model,
                quality: img.quality,
                aspectRatio: img.aspectRatio,
                stylePreset: img.stylePreset,
                category: img.category,
                size: img.size,
                x: 0,
                y: 0,
                width: originalImg.width,
                height: originalImg.height,
                originalWidth: originalImg.originalWidth,
                originalHeight: originalImg.originalHeight,
                modelName: img.modelName,
                apiProvider: img.apiProvider,
                createdAt: Date.now(),
              }));

              setImages(prev => {
                const laidOut = autoLayoutImages(prev, newImages);
                stabilizeCanvasImages(laidOut.map(img => ({ id: img.id, url: img.url })));
                return [...prev, ...laidOut];
              });

              toast.success(`变体生成成功`, {
                description: `已生成 ${completedImages.length} 张变体图片`,
                className: 'bg-[#141414] border-[#2a2a2a] text-white',
              });
              try { UserManagerCore.getInstance().recordUsage('image'); } catch { /* non-blocking */ }
            }

          // === 旧模式兼容 ===
          } else if (data.success && data.images) {
            const newImageUrls: string[] = data.images.map((img: { id: string; url: string; prompt: string }) => img.url);

            await handleAddImages(newImageUrls);

            toast.success(`变体生成成功`, {
              description: `已生成 ${data.images.length} 张变体图片`,
              className: 'bg-[#141414] border-[#2a2a2a] text-white',
            });
            try { UserManagerCore.getInstance().recordUsage('image'); } catch { /* non-blocking */ }
          } else {
            toast.error('生成失败', {
              description: data.error || '未知错误',
              className: 'bg-[#141414] border border-red-900 text-white',
            });
          }
        } catch (error) {
          console.error('Variation generation error:', error);
          toast.error('生成失败', {
            description: '网络错误，请重试',
            className: 'bg-[#141414] border border-red-900 text-white',
          });
        } finally {
          setActiveGenerationCount(prev => Math.max(0, prev - 1));
        }
      }, [autoLayoutImages, handleAddImages, setImages, stabilizeCanvasImages]);

  const handlePreview = useCallback((image: CanvasImage) => {
    setPreviewImage(image);
  }, []);

  // 视频生成处理
  const handleVideoGenerate = useCallback(async (params: {
    prompt: string;
    model: string;
    imageUrl?: string;
    mode: 'text2video' | 'image2video-first' | 'image2video-firstlast' | 'image2video-ref' | 'video-extend' | 'multi-shot';
    aspectRatio: string;
    duration: number;
    quality: string;
    videoUrl?: string;
    extendDuration?: number;
    generateAudio?: boolean;
    providerId?: string;
    firstFrameUrl?: string;
    lastFrameUrl?: string;
    referenceImages?: string[];
    resolution?: string;
    // 新增高级参数
    cameraControl?: { type: string; angle?: number; speed?: number };
    motionBrush?: { maskDataUrl: string; trajectories: Array<{ startX: number; startY: number; endX: number; endY: number; speed?: number }> };
    characterReferences?: string[];
    motionStrength?: number;
    seed?: number;
    negativePrompt?: string;
    multiShotScenes?: Array<{ id: string; prompt: string; duration: number; cameraControl?: { type: string; angle?: number; speed?: number } }>;
    chainContinuity?: boolean;
    useGlobalReferences?: boolean;
    // 导演增强
    useDirector?: boolean;
    directorStyle?: string;
    compiledPrompt?: string;
    compiledNegative?: string;
    shotPlan?: unknown[];
    shotId?: string;
    shotIndex?: number;
    directorMode?: boolean;
    directorIntent?: string;
    _vgenReqId?: string;
  }) => {
    const markVideoPlaceholderFailed = (
      placeholderId: string,
      message: string | null | undefined,
      label = '视频生成失败',
    ) => {
      setImages(prev => prev.map((image): CanvasImage => (
        image.id === placeholderId
          ? {
            ...image,
            isProcessingPlaceholder: true,
            processing: buildVideoFailureProcessing(image.processing, message, label),
          }
          : image
      )));
    };

    // ★ 链式多片段生成：当 chainContinuity=true 且有多个场景时，顺序生成每个片段
    if (params.chainContinuity && params.multiShotScenes && params.multiShotScenes.length > 1) {
      console.log(`[handleVideoGenerate] Chain mode: ${params.multiShotScenes.length} scenes`);
      setActiveGenerationCount(prev => prev + 1);

      // 辅助：从视频URL提取最后一帧（优先使用后端 ffmpeg 抽帧 API，降级用前端 video 元素）
      const extractLastFrame = async (videoUrl: string): Promise<string | null> => {
        // 1) 优先后端 ffmpeg（稳定、无跨域、画质好）
        try {
          const resp = await fetch('/api/video/extract-frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl, frame: 'last' }),
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.imageUrl) return data.imageUrl;
          }
        } catch (e) {
          console.warn('[extractLastFrame] backend ffmpeg failed:', e);
        }
        // 2) 降级：前端 video 元素 canvas 截帧
        try {
          const video = document.createElement('video');
          video.crossOrigin = 'anonymous';
          video.muted = true;
          video.preload = 'auto';
          video.src = videoUrl;
          await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve();
            video.onerror = () => reject(new Error('Video load failed'));
            setTimeout(() => reject(new Error('Video load timeout')), 15000);
          });
          video.currentTime = Math.max(0, video.duration - 0.1);
          await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            setTimeout(() => reject(new Error('Seek timeout')), 5000);
          });
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.drawImage(video, 0, 0);
          return canvas.toDataURL('image/jpeg', 0.92);
        } catch (e) {
          console.warn('[extractLastFrame] frontend fallback failed:', e);
          return null;
        }
      };

      // 辅助：保存 data URL 到服务器并获取本地路径
      const saveFrameToServer = async (dataUrl: string): Promise<string | null> => {
        try {
          const resp = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageData: dataUrl }),
          });
          if (resp.ok) {
            const data = await resp.json();
            return data.url || null;
          }
        } catch (e) {
          console.warn('[saveFrameToServer] Failed:', e);
        }
        return null;
      };

      // 顺序生成每个场景
      const chainResults: Array<{ sceneIndex: number; videoUrl: string }> = [];
      let prevVideoUrl: string | null = null;

      for (let i = 0; i < params.multiShotScenes.length; i++) {
        const scene = params.multiShotScenes[i];
        const isFirstScene = i === 0;
        const sceneLabel = `场景 ${i + 1}/${params.multiShotScenes.length}`;

        // 链式首帧：非第一个场景使用上一个场景视频的最后一帧
        let chainFirstFrame: string | undefined;
        if (!isFirstScene && prevVideoUrl) {
          const lastFrame = await extractLastFrame(prevVideoUrl);
          if (lastFrame) {
            const savedUrl = await saveFrameToServer(lastFrame);
            chainFirstFrame = savedUrl || lastFrame;
          }
        }

        // 构建场景请求
        const sceneRequest: Record<string, unknown> = {
          prompt: scene.prompt,
          model: params.model,
          imageUrl: chainFirstFrame || (isFirstScene ? (params.firstFrameUrl || params.imageUrl) : undefined),
          lastFrameImageUrl: undefined,
          referenceImages: params.useGlobalReferences ? params.referenceImages : undefined,
          characterReferences: params.useGlobalReferences ? params.characterReferences : undefined,
          mode: 'image2video-first',
          aspectRatio: params.aspectRatio,
          duration: scene.duration || params.duration,
          quality: params.quality,
          generateAudio: params.generateAudio,
          providerId: params.providerId,
          cameraControl: scene.cameraControl,
          motionStrength: params.motionStrength,
          seed: params.seed,
          negativePrompt: params.negativePrompt,
          useDirector: params.useDirector,
          directorStyle: params.directorStyle,
        };

        // 创建占位符
        const aspectRatio = params.aspectRatio || '16:9';
        const [arW, arH] = aspectRatio.split(':').map(Number);
        const arRatio = (arW || 16) / (arH || 9);
        const phWidth = arRatio >= 1 ? 400 : Math.round(400 * arRatio);
        const phHeight = arRatio >= 1 ? Math.round(400 / arRatio) : 400;
        const phId = `vid-chain-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;

        const canvasEl = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
        const viewportWidth = canvasEl ? canvasEl.clientWidth : 1200;
        const viewportHeight = canvasEl ? canvasEl.clientHeight : 800;
        let viewOffsetX = 0, viewOffsetY = 0, currentZoom = 1;
        const transformLayer = canvasEl?.querySelector('[style*="transform"]') as HTMLElement | null;
        if (transformLayer) {
          const match = transformLayer.style.transform?.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/);
          if (match) { viewOffsetX = parseFloat(match[1]); viewOffsetY = parseFloat(match[2]); currentZoom = parseFloat(match[3]); }
        }
        const offsetX = i * (phWidth + 60);
        const canvasCenterX = (viewportWidth / 2 - viewOffsetX) / currentZoom + offsetX;
        const canvasCenterY = (viewportHeight / 2 - viewOffsetY) / currentZoom;

        setImages(prev => [...prev, {
          id: phId,
          url: '',
          x: canvasCenterX - phWidth / 2,
          y: canvasCenterY - phHeight / 2,
          width: phWidth, height: phHeight,
          originalWidth: phWidth * 2, originalHeight: phHeight * 2,
          isProcessingPlaceholder: true,
          processing: {
            label: `${sceneLabel} · 视频生成中`,
            status: 'submitting',
            progress: 5,
            startTime: Date.now(),
            retryPayload: createVideoRetryPayload({
              ...params,
              prompt: scene.prompt,
              imageUrl: chainFirstFrame || (isFirstScene ? (params.firstFrameUrl || params.imageUrl) : undefined),
              firstFrameUrl: undefined,
              lastFrameUrl: undefined,
              referenceImages: params.useGlobalReferences ? params.referenceImages : undefined,
              characterReferences: params.useGlobalReferences ? params.characterReferences : undefined,
              mode: 'image2video-first',
              duration: scene.duration || params.duration,
              cameraControl: scene.cameraControl,
              multiShotScenes: undefined,
              chainContinuity: false,
            }),
          },
          aspectRatio: params.aspectRatio,
          model: params.model,
          prompt: scene.prompt,
          createdAt: Date.now(),
          mediaType: 'video' as const,
        }]);

        try {
          // 提交场景请求
          const submitResp = await fetch('/api/video/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sceneRequest),
          });
          const submitData = await submitResp.json();
          if (!submitResp.ok || submitData.error) {
            throw new Error(submitData.error || '场景提交失败');
          }

          const taskId = submitData.taskId;
          setImages(prev => prev.map(img =>
            img.id === phId ? {
              ...img,
              processing: { ...img.processing, status: 'processing' as const, progress: 10, taskId },
            } as CanvasImage : img
          ));

          // 轮询场景结果
          const sceneResult = await new Promise<{ videoUrl: string | null; error: string | null }>((resolve) => {
            const maxPollTime = 25 * 60 * 1000;
            const startTime = Date.now();
            let attempts = 0;

            const poll = async () => {
              if (attempts > 500 || Date.now() - startTime > maxPollTime) {
                resolve({ videoUrl: null, error: '超时' });
                return;
              }
              const interval = attempts < 3 ? 1000 : attempts < 8 ? 1500 : attempts < 20 ? 2000 : 3000;
              if (attempts > 0) await new Promise(r => setTimeout(r, interval));

              try {
                const pollResp = await fetch('/api/poll-task', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId, model: params.model, providerId: params.providerId }),
                });
                const pollData = await pollResp.json();

                if (pollData.status === 'completed') {
                  const videoUrl = pollData.videoUrl || pollData.result?.videoUrl;
                  resolve({ videoUrl: videoUrl || null, error: videoUrl ? null : '未获取到视频地址' });
                } else if (pollData.status === 'failed') {
                  resolve({ videoUrl: null, error: pollData.error || '生成失败' });
                } else {
                  const progress = pollData.progress || 0;
                  setImages(prev => prev.map(img =>
                    img.id === phId ? {
                      ...img,
                      processing: { ...img.processing, progress: Math.max(10, progress), status: 'processing' as const, label: `${sceneLabel} · ${pollData.label || '生成中'}` },
                    } as CanvasImage : img
                  ));
                  attempts++;
                  poll();
                }
              } catch {
                attempts++;
                poll();
              }
            };
            poll();
          });

          if (sceneResult.videoUrl) {
            // 持久化视频
            let persistedUrl = sceneResult.videoUrl;
            try {
              const persistResp = await fetch('/api/save-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: sceneResult.videoUrl, isVideo: true }),
              });
              if (persistResp.ok) {
                const persistData = await persistResp.json();
                if (persistData.url) persistedUrl = persistData.url;
              }
            } catch { /* 持久化失败用原URL */ }

            chainResults.push({ sceneIndex: i, videoUrl: persistedUrl });
            prevVideoUrl = persistedUrl;

            // 更新占位符为完成状态
            setImages(prev => prev.map(img =>
              img.id === phId ? {
                ...img,
                url: persistedUrl,
                mediaType: 'video' as const,
                videoUrl: persistedUrl,
                originalWidth: 1920,
                originalHeight: 1080,
                isProcessingPlaceholder: false,
                processing: undefined,
                prompt: scene.prompt,
                modelName: params.model,
                apiProvider: params.providerId || undefined,
              } as CanvasImage : img
            ));

            try { UserManagerCore.getInstance().recordUsage('video'); } catch {}
          } else {
            // 场景失败，移除占位符
            markVideoPlaceholderFailed(phId, sceneResult.error, `${sceneLabel} 视频生成失败`);
            toast.error(`${sceneLabel}生成失败`, { description: sceneResult.error || '未知错误', className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
            // 链式生成：一个场景失败后停止后续场景
            break;
          }
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : '场景生成失败';
          markVideoPlaceholderFailed(phId, errorMsg, `${sceneLabel} 视频生成失败`);
          toast.error(`${sceneLabel}生成失败`, { description: errorMsg, className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
          break;
        }
      }

      setActiveGenerationCount(prev => Math.max(0, prev - 1));
      if (chainResults.length > 0) {
        toast.success(`链式生成完成`, { description: `成功生成 ${chainResults.length}/${params.multiShotScenes.length} 个场景`, className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
      }
      return; // 链式模式不走常规单视频生成逻辑
    }

    setActiveGenerationCount(prev => prev + 1);

    const placeholderBaseSize = 400;
    const aspectRatio = params.aspectRatio || '16:9';
    const [arW, arH] = aspectRatio.split(':').map(Number);
    const arRatio = (arW || 16) / (arH || 9);
    const phWidth = arRatio >= 1 ? placeholderBaseSize : Math.round(placeholderBaseSize * arRatio);
    const phHeight = arRatio >= 1 ? Math.round(placeholderBaseSize / arRatio) : placeholderBaseSize;

    const phId = `vid-ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const canvasEl = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
    const viewportWidth = canvasEl ? canvasEl.clientWidth : 1200;
    const viewportHeight = canvasEl ? canvasEl.clientHeight : 800;
    let viewOffsetX = 0, viewOffsetY = 0, currentZoom = 1;
    const transformLayer = canvasEl?.querySelector('[style*="transform"]') as HTMLElement | null;
    if (transformLayer) {
      const match = transformLayer.style.transform?.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/);
      if (match) { viewOffsetX = parseFloat(match[1]); viewOffsetY = parseFloat(match[2]); currentZoom = parseFloat(match[3]); }
    }
    const canvasCenterX = (viewportWidth / 2 - viewOffsetX) / currentZoom;
    const canvasCenterY = (viewportHeight / 2 - viewOffsetY) / currentZoom;

    setImages(prev => [...prev, {
      id: phId,
      url: '',
      x: canvasCenterX - phWidth / 2,
      y: canvasCenterY - phHeight / 2,
      width: phWidth, height: phHeight,
      originalWidth: phWidth * 2, originalHeight: phHeight * 2,
      isProcessingPlaceholder: true,
      processing: {
        label: params.mode === 'video-extend' ? '视频延长中' : '视频生成中',
        status: 'submitting',
        progress: 5,
        startTime: Date.now(),
        retryPayload: createVideoRetryPayload(params),
      },
      aspectRatio: params.aspectRatio,
      model: params.model,
      prompt: params.prompt,
      createdAt: Date.now(),
      mediaType: 'video' as const,
    }]);

    try {
      // 视频延长使用 /api/video/extend，其他使用 /api/video/generate
      const isExtend = params.mode === 'video-extend';
      const apiEndpoint = isExtend ? '/api/video/extend' : '/api/video/generate';
      const requestBody = isExtend ? {
        videoUrl: params.videoUrl,
        prompt: params.prompt,
        model: params.model,
        extendDuration: params.extendDuration || params.duration,
        generateAudio: params.generateAudio,
        providerId: params.providerId,
        useDirector: params.useDirector,
        directorStyle: params.directorStyle || params.directorMode,
        negativePrompt: params.compiledNegative || params.negativePrompt,
        cameraControl: params.cameraControl,
        seed: params.seed,
        directorIntent: params.directorIntent,
      } : {
        prompt: params.compiledPrompt || params.prompt,
        model: params.model,
        imageUrl: params.firstFrameUrl || params.imageUrl,
        lastFrameImageUrl: params.lastFrameUrl,
        referenceImages: params.referenceImages,
        mode: params.mode,
        aspectRatio: params.aspectRatio,
        duration: params.duration,
        quality: params.quality,
        generateAudio: params.generateAudio,
        providerId: params.providerId,
        resolution: params.resolution,
        cameraControl: params.cameraControl,
        motionBrush: params.motionBrush,
        characterReferences: params.characterReferences,
        motionStrength: params.motionStrength,
        seed: params.seed,
        negativePrompt: params.compiledNegative || params.negativePrompt,
        multiShotScenes: params.multiShotScenes,
        chainContinuity: params.chainContinuity,
        useGlobalReferences: params.useGlobalReferences,
        useDirector: params.useDirector,
        directorMode: params.directorStyle || params.directorMode,
        directorIntent: params.directorIntent,
        shotId: params.shotId,
        _vgenReqId: phId,
      };

      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || '视频生成提交失败');
      }

      const taskId = data.taskId;
      if (params.shotId && taskId) {
        shotTaskIdMapRef.current.set(params.shotId, taskId);
      }
      setImages(prev => prev.map(img =>
        img.id === phId ? {
          ...img,
          processing: { ...img.processing, status: 'processing' as const, progress: 10, taskId },
        } as CanvasImage : img
      ));

      // 渐进式轮询视频任务（与图片生成一致，SSE加速 + 渐进间隔）
      const videoPollStartTime = Date.now();
      const pollVideoResult = async (attempt = 0): Promise<void> => {
        // ★ 组件卸载后立即终止递归轮询
        if (!isMountedRef.current) return;
        if (hasDirectVideoPollingTimedOut(attempt, Date.now() - videoPollStartTime)) {
          markVideoPlaceholderFailed(phId, '已超过最大等待时间', '视频生成超时');
          toast.error('视频生成超时', { description: '已超过最大等待时间', className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
          if (isMountedRef.current) setActiveGenerationCount(prev => Math.max(0, prev - 1));
          return;
        }
        // 渐进式间隔：1s → 1.5s → 2s → 3s（视频生成通常较慢，间隔不宜过短）
        const getVideoPollInterval = (a: number) => {
          if (a < 3) return 1000;    // 前3次：1秒（快速检测早期完成）
          if (a < 8) return 1500;    // 3-8次：1.5秒
          if (a < 20) return 2000;   // 8-20次：2秒
          return 3000;               // 20次后：3秒
        };

        try {
          // 首次轮询立即执行（不等待间隔），后续轮询SSE加速 + 渐进间隔
          if (attempt > 0) {
            // SSE加速：同时等待SSE事件和定时器，哪个先到用哪个
            const ssePromise = new Promise<void>((resolve) => {
              let resolved = false;
              const handler = (event: { taskId?: string; task?: { status?: string } }) => {
                if (event.taskId === taskId && !resolved) {
                  resolved = true;
                  unsub();
                  resolve();
                }
              };
              const unsub = taskEventsClient.onTaskEvent(handler);
              // 5秒后移除监听，避免内存泄漏
              setTimeout(() => {
                if (!resolved) { resolved = true; unsub(); resolve(); }
              }, 5000);
            });

            const pollPromise = (async () => {
              const interval = getVideoPollInterval(attempt);
              await new Promise(r => setTimeout(r, interval));
            })();

            await Promise.race([ssePromise, pollPromise]);
          }

          const pollRes = await fetch('/api/poll-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, model: params.model, providerId: params.providerId }),
          });
          const pollData = await pollRes.json();

          if (pollData.status === 'completed') {
            if (!isMountedRef.current) return; // 组件已卸载，停止轮询
            const rawVideoUrl = pollData.videoUrl || pollData.url;
            const rawThumbnailUrl = pollData.thumbnailUrl || pollData.url;
            if (rawVideoUrl) {
              // ★ 持久化远程URL到本地，防止过期后图片/视频消失
              const [stableThumbnail, stableVideo] = await Promise.all([
                awaitStableImageUrl(rawThumbnailUrl, 30000, { isVideo: false }),
                awaitStableImageUrl(rawVideoUrl, 120000, { isVideo: true }),
              ]);
              if (!isMountedRef.current) return; // 持久化期间组件可能卸载
              setImages(prev => prev.map(img =>
                img.id === phId ? {
                  ...img,
                  url: stableThumbnail || '',
                  videoUrl: stableVideo,
                  videoDuration: params.duration,
                  mediaType: 'video' as const,
                  originalWidth: pollData.width || 1920,
                  originalHeight: pollData.height || 1080,
                  isProcessingPlaceholder: false,
                  processing: undefined,
                  prompt: params.prompt,
                  modelName: params.model,
                  apiProvider: params.providerId || undefined,
                } as CanvasImage : img
              ));
              // Track video usage
              try { UserManagerCore.getInstance().recordUsage('video'); } catch {}
              // 通知视频面板回填镜头结果（用于多镜头尾帧接力串行流水线）
              try {
                const shotId = params.shotId;
                if (shotId && videoPanelRef.current?.notifyShotVideoGenerated) {
                  videoPanelRef.current.notifyShotVideoGenerated({
                    shotId,
                    videoUrl: stableVideo || rawVideoUrl,
                    thumbnailUrl: stableThumbnail || rawThumbnailUrl || undefined,
                  });
                }
              } catch {}
            } else {
              markVideoPlaceholderFailed(phId, '未获取到视频地址');
              toast.error('视频生成失败', { description: '未获取到视频地址', className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
            }
            if (isMountedRef.current) setActiveGenerationCount(prev => Math.max(0, prev - 1));
          } else if (pollData.status === 'failed') {
            markVideoPlaceholderFailed(phId, pollData.error || '未知错误');
            toast.error('视频生成失败', { description: pollData.error || '未知错误', className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
            if (isMountedRef.current) setActiveGenerationCount(prev => Math.max(0, prev - 1));
            // 通知视频面板：shot 失败（解开 waitForShotTask 的等待）
            try {
                const shotId = params.shotId;
              if (shotId && videoPanelRef.current?.notifyShotVideoFailed) {
                videoPanelRef.current.notifyShotVideoFailed({ shotId, error: pollData.error || '视频生成失败' });
              }
            } catch {}
          } else {
            // 更新进度，继续轮询
            if (!isMountedRef.current) return;
            const progress = pollData.progress || 0;
            setImages(prev => prev.map(img =>
              img.id === phId ? {
                ...img,
                processing: { ...img.processing, progress: Math.max(10, progress), status: 'processing' as const, label: pollData.label || '视频生成中' },
              } as CanvasImage : img
            ));
            // 递归继续轮询
            if (isMountedRef.current) pollVideoResult(attempt + 1);
          }
        } catch {
          // 轮询错误，继续尝试
          if (isMountedRef.current) pollVideoResult(attempt + 1);
        }
      };

      // 立即开始第一次轮询（不等待间隔）
      pollVideoResult(0);

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '视频生成失败';
      markVideoPlaceholderFailed(phId, errorMsg);
      toast.error('视频生成失败', {
        description: errorMsg,
        className: themeStyle === 'monochrome'
          ? 'bg-white border border-gray-200 text-gray-900'
          : 'bg-[#141414] border-[#2a2a2a] text-white',
      });
      if (isMountedRef.current) setActiveGenerationCount(prev => Math.max(0, prev - 1));
    }
  }, [setImages, themeStyle]);

  const handleRetryVideoProcessing = useCallback((image: CanvasImage) => {
    const retryPayload = image.processing?.retryPayload;
    if (!retryPayload) {
      toast.error('无法重新生成', { description: '该任务没有可恢复的原始参数' });
      return;
    }

    setImages(prev => prev.filter(candidate => candidate.id !== image.id));
    void handleVideoGenerate(retryPayload);
  }, [handleVideoGenerate, setImages]);

  const handleAnalyzeImage = useCallback(async (imageData: string): Promise<string> => {
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, category: 'general' }),
      });

      const data = await response.json();

      if (data.success && data.prompt) {
        return data.prompt;
      } else {
        throw new Error(data.error || '分析失败');
      }
    } catch (error) {
      console.error('Image analysis error:', error);
      throw error;
    }
  }, []);

  // 图片融合
  const handleFusion = useCallback(async (params: {
    prompt: string;
    aspectRatio: string;
    quality: string;
    count: number;
    referenceImages: string[];
  }) => {
    setActiveGenerationCount(prev => prev + 1);

    try {
      const ratioToSize: Record<string, string> = {
        '1:1': '1024x1024',
        '4:3': '1366x1024',
        '3:4': '1024x1366',
        '16:9': '1820x1024',
        '9:16': '1024x1820',
        '3:2': '1536x1024',
        '2:3': '1024x1536',
      };

      const size = ratioToSize[params.aspectRatio] || '1024x1024';

      // 根据画质添加提示词后缀
      let qualityPrompt = '';
      switch (params.quality) {
        case 'ultra': qualityPrompt = ', ultra detailed, extremely high quality'; break;
        case '2k': qualityPrompt = ', 2K resolution, high detail'; break;
        case '4k': qualityPrompt = ', 4K resolution, ultra detailed'; break;
        case 'hd': qualityPrompt = ', high quality, detailed'; break;
        default: qualityPrompt = ', high quality';
      }

      const fullPrompt = params.prompt + qualityPrompt;

      // ★ 获取当前选择的模型和提供商
      const currentModelRaw = typeof window !== 'undefined' ? localStorage.getItem('wujie_selected_model') : null;
      let fusionModel: string | undefined;
      let fusionProviderId: string | undefined;
      if (currentModelRaw) {
        try {
          const wsm = JSON.parse(currentModelRaw);
          fusionModel = wsm.model;
          fusionProviderId = wsm.providerId;
        } catch {}
      }

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: fullPrompt,
          size,
          model: fusionModel,
          providerId: fusionProviderId,
          referenceImages: params.referenceImages,
          referenceMode: 'blend',
          imageCategory: 'general',
          productCategory: 'none',
          aspectRatio: params.aspectRatio,
          stylePreset: 'auto',
          outputCount: params.count,
          submitOnly: true,
          userId: currentUser?.id,
        }),
      });

      const data = await response.json();

      if (!data.success || !data.taskIds || data.taskIds.length === 0) {
        toast.error('融合失败', {
          description: data.error || '提交任务失败',
          className: 'bg-[#141414] border border-red-900 text-white',
        });
        setActiveGenerationCount(prev => Math.max(0, prev - 1));
        return;
      }

      const newImageUrls: string[] = [];

      for (let i = 0; i < data.taskIds.length; i++) {
        const taskId = data.taskIds[i];
        let pollAttempts = 0;
        const maxAttempts = 180;

        while (pollAttempts < maxAttempts) {
          // ★ 检查组件是否已卸载，避免僵尸轮询
          if (!isMountedRef.current) break;
          await new Promise(resolve => setTimeout(resolve, 2000));
          pollAttempts++;

          try {
            const pollRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: fusionModel, providerId: fusionProviderId }),
            });
            const pollData = await pollRes.json();

            if (pollData.status === 'completed') {
              const resultUrl = pollData.imageUrl || pollData.result?.url || pollData.result?.imageUrl || pollData.result?.image?.url || (pollData.result?.images && pollData.result.images[0]?.url) || (pollData.images && pollData.images[0]?.url);
              if (resultUrl) {
                newImageUrls.push(resultUrl);
              }
              break;
            } else if (pollData.status === 'failed') {
              console.error('融合任务失败:', pollData.error);
              break;
            }
          } catch (pollErr) {
            console.error('轮询错误:', pollErr);
          }
        }
      }

      if (newImageUrls.length > 0) {
        await handleAddImages(newImageUrls);

        toast.success('融合成功', {
          description: `已生成 ${newImageUrls.length} 张融合图片`,
          className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
        });
      } else {
        toast.error('融合失败', {
          description: '生成超时或失败，请重试',
          className: 'bg-[#141414] border border-red-900 text-white',
        });
      }
    } catch (error) {
      console.error('Fusion error:', error);
      toast.error('融合失败', {
        description: '网络错误，请重试',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
    } finally {
      setActiveGenerationCount(prev => Math.max(0, prev - 1));
    }
  }, [currentUser?.id, handleAddImages, themeStyle]);

  // 画布Ctrl+点击参考图片选择
  const handleCanvasReferenceSelect = useCallback((image: CanvasImage) => {
    setCtrlRefSelections(prev => {
      const exists = prev.find(r => r.id === image.id);
      if (exists) {
        // 取消选择 - 移除并重新编号
        const filtered = prev.filter(r => r.id !== image.id);
        return filtered.map((r, i) => ({ ...r, number: i + 1 }));
      }
      // 添加新选择，分配编号
      return [...prev, { url: image.url, id: image.id, number: prev.length + 1, keyword: '' }];
    });
  }, []);

  // 更新参考图片关键词
  const handleUpdateCtrlRefKeyword = useCallback((id: string, keyword: string) => {
    setCtrlRefSelections(prev => prev.map(r => r.id === id ? { ...r, keyword } : r));
  }, []);

  // 移除单个参考选择
  const handleRemoveCtrlRef = useCallback((id: string) => {
    setCtrlRefSelections(prev => {
      const filtered = prev.filter(r => r.id !== id);
      return filtered.map((r, i) => ({ ...r, number: i + 1 }));
    });
  }, []);

  // Alt+Click 标记参考图 - 添加到创意描述文本框的数字标记
  const handleAltMarkReference = useCallback((image: CanvasImage) => {
    setAltRefMarkers(prev => {
      const exists = prev.find(r => r.id === image.id);
      if (exists) {
        // 已标记则取消标记
        const filtered = prev.filter(r => r.id !== image.id);
        return filtered.map((r, i) => ({ ...r, number: i + 1 }));
      }
      // 添加新标记
      return [...prev, { id: image.id, url: image.url, number: prev.length + 1 }];
    });
  }, []);

  // 移除单个 Alt 标记
  const handleRemoveAltRefMarker = useCallback((id: string) => {
    setAltRefMarkers(prev => {
      const filtered = prev.filter(r => r.id !== id);
      return filtered.map((r, i) => ({ ...r, number: i + 1 }));
    });
  }, []);

  // 融合生成
  const handleFusionGenerate = useCallback((refs: CtrlRefSelection[], fusionPrompt: string) => {
    const refKeywords = refs.map(r => r.keyword).filter(Boolean);
    // 构建融合提示词：清晰描述参考图关系 + 融合目标
    let combinedPrompt = '';
    if (refKeywords.length > 0) {
      combinedPrompt += refs.map((r) => `[参考${r.number}: ${r.keyword}]`).join(' ');
    }
    if (fusionPrompt) {
      combinedPrompt += (combinedPrompt ? ' → ' : '') + fusionPrompt;
    }
    if (!combinedPrompt) {
      combinedPrompt = '将参考图片融合成统一、完整的创意构图';
    }
    // 同时设置参考图片
    const refUrls = refs.map(r => r.url);
    // 调用生成 - 使用支持图生图的 Gemini 模型
    handleGenerate({
      prompt: combinedPrompt,
      size: '1024x1024',
      referenceImages: refUrls,
      referenceMode: 'fusion' as const,
      imageCategory: 'none',
      productCategory: 'none',
      aspectRatio: '1:1',
      stylePreset: 'none',
      outputCount: 1,
      model: 'gemini-2.5-flash-image-preview',
      quality: '1K',
    });
  }, [handleGenerate]);

  // 一键提取关键词（从画布图片提取）
  useCallback(async (image: { id: string; url: string }) => {
        try {
          // 使用管理员配置的视觉模型（与"灵感提示词"功能共用模型选择逻辑）
          let visionModel = '';
          let providerId: string | undefined;
          let providerPreset: string | undefined;

          // Priority 1: Use the currently selected chat model
          if (currentChatModelInfo) {
            if (currentChatModelInfo.providerId) {
              visionModel = currentChatModelInfo.model;
              providerId = currentChatModelInfo.providerId;
              providerPreset = currentChatModelInfo.providerPreset;
            } else {
              visionModel = currentChatModelInfo.model;
            }
          }

          // Priority 2: Fallback - search for a vision-capable model (chat + VLM)
          if (!visionModel) {
            try {
              // Search both chat and VLM model types
              const [chatRes, vlmRes] = await Promise.all([
                fetch('/api/models?type=chat').then(r => r.json()).catch(() => ({ providers: [], models: [] })),
                fetch('/api/models?type=vlm').then(r => r.json()).catch(() => ({ providers: [], models: [] })),
              ]);
              const providers = [
                ...(Array.isArray(chatRes.providers) ? chatRes.providers : []),
                ...(Array.isArray(vlmRes.providers) ? vlmRes.providers : []),
              ];
              const models = [
                ...(Array.isArray(chatRes.models) ? chatRes.models : []),
                ...(Array.isArray(vlmRes.models) ? vlmRes.models : []),
              ];
              const visionModelPatterns = [
                /gpt-4o/i, /gpt-4-turbo/i, /gpt-4\./i, /gpt-5/i,
                /claude-3/i, /claude-4/i, /claude-3\.5/i,
                /gemini/i,
                /qwen-vl/i, /qwen2-vl/i, /qwen2\.5-vl/i, /qvq/i,
                /glm-4v/i, /glm-4\.6v/i,
                /internvl/i, /llava/i, /cogvlm/i, /doubao/i, /seed/i,
              ];
              const foundModel = models.find((model: { id?: string; name?: string; providerId?: string }) => {
                const haystack = `${model.id || ''} ${model.name || ''}`;
                return visionModelPatterns.some(pat => pat.test(haystack));
              });
              if (foundModel?.id) {
                const provider = providers.find((item: { id?: string; providerPreset?: string }) => item.id === foundModel.providerId);
                visionModel = foundModel.id;
                providerId = foundModel.providerId;
                providerPreset = provider?.providerPreset;
              }
            } catch {}
          }

          if (!visionModel) {
            toast.error('未找到支持图片理解的模型', {
              description: '请在智能对话面板中选择一个支持视觉的模型',
              className: 'bg-[#141414] border border-red-900 text-white',
            });
            return;
          }

          const response = await fetch('/api/vision-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageUrl: image.url,
              model: visionModel,
              providerId,
              providerPreset,
              userId: currentUser?.id,
            }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `API 调用失败: ${response.status}`);
          }

          const result = await response.json();
          const prompt = result?.data?.bilingual || result?.data?.english || result?.data?.chinese || result?.prompt || '';

          if (prompt) {
            // 直接填充到图像生成面板的提示词输入框
            setExternalPrompt(prompt);
            toast.success('关键词已提取并填入描述区', {
              description: prompt.substring(0, 80) + (prompt.length > 80 ? '...' : ''),
              className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
            });
          } else {
            toast.error('提取结果为空', {
              description: '模型未返回有效关键词',
              className: 'bg-[#141414] border border-red-900 text-white',
            });
          }
        } catch (error) {
          console.error('Extract keywords error:', error);
          toast.error('提取失败', {
            description: '关键词提取失败，请重试',
            className: 'bg-[#141414] border border-red-900 text-white',
          });
        }
      }, [currentChatModelInfo, currentUser, themeStyle]);

  // 提示词大师 - 从chat-panel传递到generation-panel
  const [externalPrompt, setExternalPrompt] = useState<string | undefined>(undefined);
  const [externalChatPrompt, setExternalChatPrompt] = useState<string | undefined>(undefined);
  const [externalReferenceImage, setExternalReferenceImage] = useState<{ url: string; description?: string } | null>(null);

  // Oh My Prompt - Vision Prompt handler
  const handleVisionPrompt = useCallback(async (imageUrl: string) => {
    // Use the same model/API as the chat panel (智能对话)
    let visionModel = '';
    let providerId: string | undefined;
    let providerPreset: string | undefined;

    // Priority 1: Use the currently selected chat model from ChatPanel
    if (currentChatModelInfo) {
      if (currentChatModelInfo.providerId) {
        // Third-party chat model
        visionModel = currentChatModelInfo.model;
        providerId = currentChatModelInfo.providerId;


        providerPreset = currentChatModelInfo.providerPreset;
      } else {
        // Server-managed model
        visionModel = currentChatModelInfo.model;
      }
    }

    // Priority 2: Fallback - search for a vision-capable model from server-managed providers
    if (!visionModel) {
      try {
        const response = await fetch('/api/models?type=chat', { cache: 'no-store' });
        const data = await response.json();
        const providers = Array.isArray(data.providers) ? data.providers : [];
        const models = Array.isArray(data.models) ? data.models : [];

        const visionModelPatterns = [
          /gpt-4o/i, /gpt-4-turbo/i, /gpt-4\./i,
          /claude-3/i, /claude-4/i, /claude-3\.5/i,
          /gemini/i,
          /qwen-vl/i, /qwen2-vl/i, /qwen2\.5-vl/i, /qvq/i,
          /glm-4v/i, /glm-4\.6v/i,
          /internvl/i, /llava/i, /cogvlm/i, /moondream/i, /kosmos/i, /fuyu/i,
        ];

        const foundModel = models.find((model: { id?: string; name?: string; providerId?: string }) => {
          const haystack = `${model.id || ''} ${model.name || ''}`;
          return visionModelPatterns.some(pat => pat.test(haystack));
        });

        if (foundModel?.id) {
          const provider = providers.find((item: { id?: string; providerPreset?: string }) => item.id === foundModel.providerId);
          visionModel = foundModel.id;
          providerId = foundModel.providerId;
          providerPreset = provider?.providerPreset;
        } else {
          for (const provider of providers as Array<{ id?: string; selectedModels?: string[]; providerPreset?: string }>) {
            const found = provider.selectedModels?.find((modelId: string) => visionModelPatterns.some(pat => pat.test(modelId)));
            if (found) {
              visionModel = found;
              providerId = provider.id;
              providerPreset = provider.providerPreset;
              break;
            }
          }
        }
      } catch {}
    }

    if (!visionModel) {
      toast.error('未找到支持图片理解的模型', {
        description: '请在智能对话面板中选择一个支持视觉的模型',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
      return;
    }

    setIsVisionAnalyzing(true);
    try {
      toast.info('正在分析图片...', {
        description: '灵感提示词库正在生成双语提示词',
        className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
        duration: 5000,
      });

      const response = await fetch('/api/vision-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          model: visionModel,
              providerId,


          providerPreset,
          userId: currentUser?.id,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `API 调用失败: ${response.status}`);
      }

      const result = await response.json();

      if (result.success && result.data) {
        const data = result.data;
        // Store structured vision result for OhMyPrompt component (user picks category there)
        setVisionResult(data);

        const hasContent = data.zh?.prompt || data.en?.prompt || data.zh_style_tags?.length || data.en_style_tags?.length || data.raw;
        if (hasContent) {
          toast.success('识词完成', {
            description: data.zh?.title || data.en?.title || '关键词已生成，请在灵感工坊中选择发送',
            className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
          });
        } else {
          toast.warning('分析结果为空', {
            description: '模型未能生成有效的提示词',
            className: 'bg-[#141414] border border-yellow-900 text-white',
          });
        }
      } else {
        throw new Error(result.error || '分析失败');
      }
    } catch (error) {
      console.error('Vision prompt error:', error);
      toast.error('图片分析失败', {
        description: error instanceof Error ? error.message : '请重试',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
    } finally {
      setIsVisionAnalyzing(false);
    }
  }, [currentChatModelInfo, currentUser?.id, themeStyle]);

  // 右键提取关键词 - 打开oh-my-prompt识词面板并显示进度
  const handleCanvasExtractKeywords = useCallback((image: { id: string; url: string }) => {
    // 打开oh-my-prompt面板并自动触发识词
    setOhMyPromptOpen(true);
    setVisionPromptEnabled(true);
    // 显示提取中提示
    toast.loading('正在识别图片关键词...', {
      className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
    });
    // 调用识词API
    handleVisionPrompt(image.url);
  }, [handleVisionPrompt, themeStyle]);

  const handleAddToPrompt = useCallback((optimizedPrompt: string) => {
    setExternalPrompt(optimizedPrompt);
    setCreateMode('professional');
    setActivePanel('generate');
  }, []);

  const handleExternalPromptConsumed = useCallback(() => {
    setExternalPrompt(undefined);
  }, []);

  const getCurrentImageModel = useCallback((): { model: string; providerId?: string } => {
    let model = '';
    let providerId: string | undefined;
    // SSR guard: useMemo executes during server render where localStorage is undefined
    if (typeof window === 'undefined') return { model, providerId };
    try {
      const rawModel = localStorage.getItem('wujie_selected_model');
      if (rawModel) {
        const modelInfo = JSON.parse(rawModel) as { model?: string; providerId?: string };
        model = modelInfo.model || '';
        providerId = modelInfo.providerId || undefined;
      }
      if (!model) {
        const currentUserId = localStorage.getItem('unbounded_ai_current_user');
        const raw = localStorage.getItem('unbounded_ai_user_data');
        if (raw && currentUserId) {
          const data = JSON.parse(raw) as { userData?: Record<string, { selectedModel?: string }> };
          const selectedModel = data.userData?.[currentUserId]?.selectedModel;
          if (selectedModel?.includes('::')) {
            const parts = selectedModel.split('::');
            providerId = parts[0];
            model = parts.slice(1).join('::');
          } else if (selectedModel) {
            model = selectedModel;
          }
        }
      }
    } catch (error) {
      console.warn('[quick-create] failed to read selected image model', error);
    }
    return { model, providerId };
  }, []);

  const recentQuickCreateImageModel = useMemo((): string => {
    if (typeof window === 'undefined') return '';
    const { model, providerId } = getCurrentImageModel();
    if (model.includes('::')) return model;
    return model && providerId ? `${providerId}::${model}` : '';
  }, [getCurrentImageModel, quickCreateImageModels]);

  const resolvedQuickCreateImageModel = useMemo<ResolvedQuickCreateModel>(() => (
    resolveQuickCreateModel({
      quickCreateDefault: quickCreateImagePolicy.quickCreateDefault,
      globalDefault: quickCreateImagePolicy.autoModelRouting
        ? quickCreateImagePolicy.globalDefault
        : undefined,
      recentSelection: quickCreateImagePolicy.autoModelRouting
        ? recentQuickCreateImageModel
        : undefined,
      models: quickCreateImageModels,
      allowFirstAvailable: quickCreateImagePolicy.autoModelRouting,
    })
  ), [quickCreateImageModels, quickCreateImagePolicy, recentQuickCreateImageModel]);

  const recentQuickCreateChatModel = useMemo((): string => {
    if (!currentChatModelInfo?.model) return '';
    if (currentChatModelInfo.model.includes('::')) return currentChatModelInfo.model;
    return currentChatModelInfo.providerId
      ? `${currentChatModelInfo.providerId}::${currentChatModelInfo.model}`
      : currentChatModelInfo.model;
  }, [currentChatModelInfo]);

  const resolvedQuickCreateChatModel = useMemo<ResolvedQuickCreateModel>(() => (
    resolveQuickCreateModel({
      quickCreateDefault: quickCreateChatPolicy.quickCreateDefault,
      globalDefault: quickCreateChatPolicy.autoModelRouting
        ? quickCreateChatPolicy.globalDefault
        : undefined,
      recentSelection: quickCreateChatPolicy.autoModelRouting
        ? recentQuickCreateChatModel
        : undefined,
      models: quickCreateChatModels,
      allowFirstAvailable: quickCreateChatPolicy.autoModelRouting,
    })
  ), [quickCreateChatModels, quickCreateChatPolicy, recentQuickCreateChatModel]);

  const notifyMissingImageModel = useCallback((): void => {
    toast.error('未选择图像生成模型', {
      description: '请先在专业创作中选择模型',
      className: themeStyle === 'monochrome'
        ? 'bg-white border border-gray-200 text-gray-900'
        : 'bg-[#141414] border border-yellow-900 text-white',
    });
  }, [themeStyle]);

  const notifyMissingQuickCreateImageModel = useCallback((): void => {
    toast.error('当前账号没有可用的图像模型', {
      description: '请联系管理员启用模型、配置服务端凭证并分配图像模型权限',
      className: themeStyle === 'monochrome'
        ? 'bg-white border border-gray-200 text-gray-900'
        : 'bg-[#141414] border border-yellow-900 text-white',
    });
  }, [themeStyle]);

  const handleQuickGenerate = useCallback(async (request: QuickCreateRequest): Promise<boolean> => {
    const resolvedImageModel = resolveQuickCreateModel({
      taskOverride: request.imageModelOverride,
      quickCreateDefault: quickCreateImagePolicy.quickCreateDefault,
      globalDefault: quickCreateImagePolicy.autoModelRouting
        ? quickCreateImagePolicy.globalDefault
        : undefined,
      recentSelection: quickCreateImagePolicy.autoModelRouting
        ? recentQuickCreateImageModel
        : undefined,
      models: quickCreateImageModels,
      allowFirstAvailable: quickCreateImagePolicy.autoModelRouting,
    });
    const quickCreateImageModel = resolvedImageModel.model;
    if (!quickCreateImageModel) {
      notifyMissingQuickCreateImageModel();
      return false;
    }

    quickCreateCompileControllerRef.current?.abort();
    const controller = new AbortController();
    quickCreateCompileControllerRef.current = controller;
    setQuickCreateCompileState({
      phase: 'validating',
      statusMessage: '正在校验创作需求与模型权限',
      streamText: '',
      result: null,
      error: '',
      isCompiling: true,
    });

    let compileResult: QuickCreateCompileResult | null = null;
    let compileError = '';
    let compileErrorCode: string | null = null;
    let compileTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const submitTransportFallback = (): boolean => {
      const fallbackChatModel = resolvedQuickCreateChatModel.model;
      const fallbackModelSource: QuickCreateModelSource = resolvedQuickCreateChatModel.source === 'none'
        ? 'first-available'
        : resolvedQuickCreateChatModel.source;
      const finalResult = createQuickCreateFallbackResult(request, {
        model: fallbackChatModel?.modelId || 'compiler-unavailable',
        providerId: fallbackChatModel?.providerId || 'client-fallback',
        providerName: fallbackChatModel?.providerName || '本地降级',
        modelSource: fallbackModelSource,
      });

      setQuickCreateCompileState((current: QuickCreateCompileViewState) => ({
        ...current,
        phase: 'ready',
        statusMessage: '专业提示词编译暂不可用，已按原始需求提交图片生成。',
        result: finalResult,
        error: '',
        isCompiling: false,
      }));

      void handleGenerate({
        prompt: finalResult.positivePrompt,
        outputCount: finalResult.outputCount,
        aspectRatio: finalResult.aspectRatio,
        size: '',
        referenceImages: request.referenceImages,
        referenceMode: 'style',
        imageCategory: '',
        productCategory: '',
        stylePreset: '',
        quality: finalResult.quality,
        model: quickCreateImageModel.modelId,
        providerId: quickCreateImageModel.providerId,
      });
      return true;
    };

    const handleCompileEvent = (event: QuickCreateCompileSseEvent): void => {
      if (event.type === 'status') {
        setQuickCreateCompileState((current: QuickCreateCompileViewState) => ({
          ...current,
          phase: event.phase,
          statusMessage: event.message,
        }));
        return;
      }
      if (event.type === 'delta') {
        setQuickCreateCompileState((current: QuickCreateCompileViewState) => ({
          ...current,
          streamText: `${current.streamText}${event.content}`,
        }));
        return;
      }
      if (event.type === 'result') {
        compileResult = event.result;
        setQuickCreateCompileState((current: QuickCreateCompileViewState) => ({
          ...current,
          result: event.result,
        }));
        return;
      }
      if (event.type === 'error') {
        compileError = event.message;
        compileErrorCode = event.code || null;
        setQuickCreateCompileState((current: QuickCreateCompileViewState) => ({
          ...current,
          error: event.message,
        }));
      }
    };

    try {
      // ★ 添加超时保护：SSE 流最多等待 120 秒，防止 LLM 卡住导致面板永远停在"正在编译"
      const compileTimeoutMs = 120000;
      const timeoutController = new AbortController();
      compileTimeoutId = setTimeout(
        () => timeoutController.abort(),
        compileTimeoutMs,
      );
      // 将超时 abort 和用户手动 abort 合并
      const combinedController = new AbortController();
      controller.signal.addEventListener('abort', () => combinedController.abort());
      timeoutController.signal.addEventListener('abort', () => {
        if (!controller.signal.aborted) {
          combinedController.abort(new Error('快速创作编译超时，请检查网络或更换模型后重试'));
        }
      });

      const response = await fetch('/api/quick-create/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          quality: request.quality,
          outputCount: request.outputCount,
          referenceImages: request.referenceImages,
          chatModelOverride: request.chatModelOverride,
          recentChatModel: recentQuickCreateChatModel || undefined,
        }),
        signal: combinedController.signal,
      });
      clearTimeout(compileTimeoutId);
      compileTimeoutId = null;

      if (!response.body) {
        throw new Error('快速创作服务未返回可读取的流');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const parsed = parseQuickCreateSseChunk(sseBuffer, decoder.decode(value, { stream: true }));
        sseBuffer = parsed.buffer;
        parsed.events.forEach(handleCompileEvent);
      }

      const trailingText = decoder.decode();
      if (trailingText) {
        const parsed = parseQuickCreateSseChunk(sseBuffer, trailingText);
        sseBuffer = parsed.buffer;
        parsed.events.forEach(handleCompileEvent);
      }
      flushQuickCreateSseBuffer(sseBuffer).forEach(handleCompileEvent);

      if (!response.ok && !compileError) {
        throw new Error(`快速创作编译失败（HTTP ${response.status}）`);
      }
      if (compileError) throw new Error(compileError);
      if (!compileResult) throw new Error('快速创作服务未返回结构化创作方案');

      // TypeScript narrowing: compileResult is non-null after the throw above
      const finalResult: QuickCreateCompileResult = compileResult;
      const compiledPrompt = finalResult.negativePrompt
        ? `${finalResult.positivePrompt}\n\n[negative: ${finalResult.negativePrompt}]`
        : finalResult.positivePrompt;

      setQuickCreateCompileState((current: QuickCreateCompileViewState) => ({
        ...current,
        phase: 'ready',
        statusMessage: '专业创作方案已完成，正在提交图片生成任务',
        result: finalResult,
        error: '',
        isCompiling: false,
      }));

      void handleGenerate({
        prompt: compiledPrompt,
        outputCount: finalResult.outputCount,
        aspectRatio: finalResult.aspectRatio,
        size: '',
        referenceImages: request.referenceImages,
        referenceMode: 'style',
        imageCategory: '',
        productCategory: '',
        stylePreset: '',
        quality: finalResult.quality,
        model: quickCreateImageModel.modelId,
        providerId: quickCreateImageModel.providerId,
      });
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      if (shouldFallbackQuickCreateCompile(error, compileErrorCode)) {
        return submitTransportFallback();
      }
      let message = error instanceof Error ? error.message : '快速创作编译失败，请重试';
      // 处理超时 abort
      if (message.includes('aborted') || message.includes('超时')) {
        message = '快速创作编译超时（120秒），请检查网络或更换模型后重试';
      }
      setQuickCreateCompileState((current: QuickCreateCompileViewState) => ({
        ...current,
        error: message,
        statusMessage: '',
        isCompiling: false,
      }));
      return false;
    } finally {
      if (compileTimeoutId) clearTimeout(compileTimeoutId);
      if (quickCreateCompileControllerRef.current === controller) {
        quickCreateCompileControllerRef.current = null;
      }
    }
  }, [
    handleGenerate,
    notifyMissingQuickCreateImageModel,
    quickCreateImageModels,
    quickCreateImagePolicy,
    resolvedQuickCreateChatModel,
    recentQuickCreateChatModel,
    recentQuickCreateImageModel,
  ]);

  // AI聊天中的图像生成回调 - 当AI建议生成图片时直接触发
  const handleChatGenerateImage = useCallback((prompt: string, outputCount?: number, aspectRatio?: string, quality?: string) => {
    const { model, providerId } = getCurrentImageModel();
    if (!model) {
      notifyMissingImageModel();
      return;
    }

    void handleGenerate({
      prompt,
      outputCount: outputCount || 1,
      aspectRatio: aspectRatio || '1:1',
      size: '',
      referenceImages: [],
      referenceMode: 'style',
      imageCategory: '',
      productCategory: '',
      stylePreset: '',
      quality: quality || 'standard',
      model,
      providerId,
    });
  }, [getCurrentImageModel, handleGenerate, notifyMissingImageModel]);

  // 适配 InfiniteCanvas 的简单回调函数
  const handleCanvasGenerateVariation = useCallback((image: CanvasImage) => {
    setExternalReferenceImage({ url: image.url, description: image.prompt || '' });
  }, []);

  const handleCanvasFusion = useCallback((images: CanvasImage[]) => {
    handleFusion({
      prompt: '',
      aspectRatio: '1:1',
      quality: 'standard',
      count: 1,
      referenceImages: images.map(img => img.url)
    });
  }, [handleFusion]);

  // Canvas img2img handler - reuses handleGenerate for reliable submission + polling
  // Language-based image editing handler
  const handleEditImage = useCallback((image: CanvasImage | null) => {
    window.dispatchEvent(new Event('wujie:close-canvas-tool-panels'));
    setShowVideoPanel(false);
    setEditingImage(image);
    setShowImageEditor(true);
  }, []);

  const handleOpenVideoPanel = useCallback((prompt?: string, mode: 'generate' | 'extend' = 'generate') => {
    window.dispatchEvent(new Event('wujie:close-canvas-tool-panels'));
    setShowImageEditor(false);
    setExternalVideoPrompt(prompt?.trim() || undefined);
    setExternalVideoMode(mode);
    setShowVideoPanel(true);
  }, []);

  const handleOpenQuickProfessional = useCallback((prompt?: string): void => {
    if (prompt?.trim()) setExternalPrompt(prompt.trim());
    setCreateMode('professional');
    setActivePanel('generate');
  }, []);

  const handleOpenQuickChat = useCallback((prompt?: string): void => {
    setExternalChatPrompt(prompt?.trim() || undefined);
    setChatTabOpen(true);
    setActivePanel('chat');
  }, []);

  const handleEditCancel = useCallback(() => {
    setShowImageEditor(false);
    setEditingImage(null);
  }, []);

  // Add image to favorites
  // localStorage 兜底：数据库不可用时用本地存储
  const getLocalFavorites = useCallback((): FavoriteItem[] => {
    try {
      const raw = localStorage.getItem('wujie-favorites-local');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }, []);

  const saveLocalFavorites = useCallback((items: FavoriteItem[]) => {
    try { localStorage.setItem('wujie-favorites-local', JSON.stringify(items)); } catch { /* ignore */ }
  }, []);

  const handleAddToFavorites = useCallback(async (image: CanvasImage) => {
    if (!currentUser) {
      toast.error('请先登录后再收藏');
      return;
    }
    const userId = currentUser.id || currentUser.name;
    const currentModel = localStorage.getItem('wujie-current-image-model') || '';
    const currentProvider = localStorage.getItem('wujie-current-api-provider') || '';
    const favData = {
      userId,
      username: currentUser.name || '',
      imageUrl: image.url,
      prompt: image.prompt || '',
      negativePrompt: image.negativePrompt || '',
      model: currentModel,
      modelName: currentModel,
      aspectRatio: image.width && image.height ? `${image.width}:${image.height}` : '',
      imageWidth: image.width,
      imageHeight: image.height,
      originalWidth: image.originalWidth,
      originalHeight: image.originalHeight,
      apiProvider: currentProvider,
      sourceType: 'generated',
    };
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(favData),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || '已添加到收藏夹');
        // 同步到本地缓存
        const local = getLocalFavorites();
        if (!local.find(f => f.image_url === image.url)) {
          local.unshift({
            id: data.id || Date.now(),
            user_id: userId,
            username: favData.username,
            image_url: image.url,
            prompt: favData.prompt,
            negative_prompt: favData.negativePrompt,
            model: favData.model,
            model_name: favData.modelName,
            aspect_ratio: favData.aspectRatio,
            quality: '',
            image_width: favData.imageWidth || 0,
            image_height: favData.imageHeight || 0,
            original_width: favData.originalWidth || 0,
            original_height: favData.originalHeight || 0,
            api_provider: favData.apiProvider,
            api_base_url: '',
            source_type: 'generated',
            created_at: Date.now(),
          });
          saveLocalFavorites(local);
        }
      } else {
        // API返回错误 → localStorage兜底
        const local = getLocalFavorites();
        if (!local.find(f => f.image_url === image.url)) {
          local.unshift({
            id: Date.now(),
            user_id: userId,
            username: favData.username,
            image_url: image.url,
            prompt: favData.prompt,
            negative_prompt: favData.negativePrompt,
            model: favData.model,
            model_name: favData.modelName,
            aspect_ratio: favData.aspectRatio,
            quality: '',
            image_width: favData.imageWidth || 0,
            image_height: favData.imageHeight || 0,
            original_width: favData.originalWidth || 0,
            original_height: favData.originalHeight || 0,
            api_provider: favData.apiProvider,
            api_base_url: '',
            source_type: 'generated',
            created_at: Date.now(),
          });
          saveLocalFavorites(local);
        }
        toast.success('已添加到收藏夹（本地）');
      }
    } catch (err) {
      // 网络错误 → localStorage兜底
      console.error('[Favorites] add error, falling back to localStorage:', err);
      const local = getLocalFavorites();
      if (!local.find(f => f.image_url === image.url)) {
        local.unshift({
          id: Date.now(),
          user_id: userId,
          username: favData.username,
          image_url: image.url,
          prompt: favData.prompt,
          negative_prompt: favData.negativePrompt,
          model: favData.model,
          model_name: favData.modelName,
          aspect_ratio: favData.aspectRatio,
          quality: '',
          image_width: favData.imageWidth || 0,
          image_height: favData.imageHeight || 0,
          original_width: favData.originalWidth || 0,
          original_height: favData.originalHeight || 0,
          api_provider: favData.apiProvider,
          api_base_url: '',
          source_type: 'generated',
          created_at: Date.now(),
        });
        saveLocalFavorites(local);
      }
      toast.success('已添加到收藏夹（本地）');
    }
  }, [currentUser, getLocalFavorites, saveLocalFavorites]);

  // Workflow state for node mode
  const [nodeWorkflow, setNodeWorkflow] = useState<Workflow | null>(null);

  // CanvasWorkspace is only mounted when authenticated, so no auth gate here.

  // Mode switching - early return for non-canvas modes
  if (appMode === 'node') {
    const currentAnnotationModel = getCurrentImageModel();
    const preferredAnnotationModelId = currentAnnotationModel.model.includes('::')
      ? currentAnnotationModel.model
      : currentAnnotationModel.providerId && currentAnnotationModel.model
        ? `${currentAnnotationModel.providerId}::${currentAnnotationModel.model}`
        : currentAnnotationModel.model;
    return (
      <NodeEditor
        workflow={nodeWorkflow}
        userId={currentUser?.id}
        projectId={currentProject?.id}
        onBack={() => setAppMode('canvas')}
        onWorkflowChange={setNodeWorkflow}
        onOpenWorkflowHub={() => setAppMode('workflow-hub')}
        canvasImages={images.map(img => ({
          id: img.id,
          url: img.url,
          name: img.prompt?.slice(0, 30) || '图片',
          description: img.prompt || '',
          width: img.width,
          height: img.height,
          versionId: img.annotationVersionId || buildAnnotationSourceVersionId(
            img.id,
            img.createdAt,
            img.url,
          ),
          assetId: img.assetId,
          assetVersionId: img.assetVersionId,
          placementId: img.placementId,
          projectId: currentProject?.id,
        }))}
        themeStyle={themeStyle}
        preferredAnnotationModelId={preferredAnnotationModelId}
        onAddImages={(urls, meta) => handleAddImages(urls, undefined, meta)}
      />
    );
  }
  if (appMode === 'workflow-hub') {
    return <WorkflowHub userId={currentUser?.id} onBack={() => setAppMode('canvas')} onEditWorkflow={(wf) => { setNodeWorkflow(wf); setAppMode('node'); }} themeStyle={themeStyle} />;
  }

  if (appMode === 'dashboard') {
    return (
      <>
      <DashboardView
        key={currentUser?.id || 'no-user'}
        isMonochrome={themeStyle === 'monochrome'}
        user={currentUser!}
        onOpenProject={(project) => {
          setAppMode('canvas');
          loadProjectById(project.id);
        }}
        onSetFavoriteParams={(params) => {
          setFavoriteParams(params);
        }}
        onNewProject={async () => {
          try {
            const mgr = UserManagerCore.getInstance();
            const newProject = await mgr.createProject('未命名项目');
            loadProjectById(newProject.id);
            setAppMode('canvas');
          } catch (e) {
            console.error('创建项目失败:', e);
          }
        }}
        onLogout={async () => {
          // 退出前同步保存当前项目数据
          try {
            if (currentProject && images.length > 0) {
              const mgr = UserManagerCore.getInstance();
              const urlMapping: Record<string, string> = {};
              const nonPersistent = images.filter(img => img.url.startsWith('data:') || img.url.startsWith('blob:'));
              if (nonPersistent.length > 0) {
                const results = await Promise.allSettled(nonPersistent.map(async (img) => {
                  let urlToSave = img.url;
                  if (urlToSave.startsWith('blob:')) {
                    try {
                      const resp = await fetch(urlToSave);
                      const blob = await resp.blob();
                      urlToSave = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.readAsDataURL(blob);
                      });
                    } catch { return null; }
                  }
                  const saveResp = await fetch('/api/save-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageUrl: urlToSave, userId: currentUser?.id, sourceUrl: img.url }),
                  });
                  const saveData = await saveResp.json();
                  if (saveData.success && saveData.url) return { original: img.url, persisted: saveData.url };
                  return null;
                }));
                for (const r of results) {
                  if (r.status === 'fulfilled' && r.value) urlMapping[r.value.original] = r.value.persisted;
                }
              }
              const persistableCanvasImages = serializeCanvasWorkspacePlacements(images.map((img) => ({
                ...img,
                url: urlMapping[img.url] || img.url,
              })))
                .map(img => ({
                  ...img,
                  id: img.id,
                  url: img.url,
                  x: img.x, y: img.y, width: img.width, height: img.height,
                  originalWidth: img.originalWidth || img.width * 2,
                  originalHeight: img.originalHeight || img.height * 2,
                  rotation: img.rotation ?? 0, zIndex: img.zIndex ?? 0, createdAt: img.createdAt || Date.now(),
                  prompt: img.prompt || '', modifyPrompt: img.modifyPrompt || '',
                  model: img.model || '', quality: img.quality || '',
                  aspectRatio: img.aspectRatio || '', stylePreset: img.stylePreset || '',
                  category: img.category || '', size: img.size || '',
                  groupId: img.groupId || '', threeDModelUrl: img.threeDModelUrl || '',
                  threeDModelUrls: img.threeDModelUrls || undefined,
                  modelName: img.modelName || '', apiProviderId: img.apiProviderId || '', apiProvider: img.apiProvider || '',
                  apiBaseUrl: img.apiBaseUrl || '',
                  generationRouteAudit: img.generationRouteAudit || undefined,
                  sourceUrl: img.sourceUrl || '',
                  generatedFromImageId: img.generatedFromImageId || '',
                  annotationVersionId: img.annotationVersionId || '',
                  annotationSourceImageId: img.annotationSourceImageId || '',
                  annotationSourceVersionId: img.annotationSourceVersionId || '',
                  annotationBundleId: img.annotationBundleId || '',
                  annotationIds: img.annotationIds || undefined,
                  svgDataUrl: img.svgDataUrl || '',
                  svgUrl: img.svgUrl || '',
                  mediaType: img.mediaType || undefined,
                  videoUrl: img.videoUrl || '',
                  videoDuration: img.videoDuration || undefined,
                  videoThumbnailUrl: img.videoThumbnailUrl || '',
                  isProcessingPlaceholder: img.isProcessingPlaceholder || false,
                  processing: img.processing,
                }))
                .filter(image => shouldPersistCanvasPlacement(image) || shouldPersistProcessingPlaceholder(image)) as PersistableCanvasImage[];
              mgr.updateProject(currentProject.id, {
                canvasImages: persistableCanvasImages,
              metadata: {
                ...(currentProject.metadata || {}),
                groups: groupsRef.current,
                viewState: viewStateRef.current,
                annotationsV2: annotationRecordsRef.current,
                },
              });
            }
          } catch { /* save failed - non-blocking */ }
          const userMgr = UserManagerCore.getInstance();
          await userMgr.logout();
          setCurrentProject(null);
          // ★ 清空 undo 历史，防止退出登录后残留历史
          incrementalHistoryRef.current.clear();
          prevImagesRef.current = [];
          setImages([]);
          latestImagesRef.current = []; // 立即清除 ref，防止残留图片数据
          setInitialGroups([]);
          toast.info('已退出登录', {
            description: '已返回入口选择页',
            className: themeStyle === 'monochrome'
              ? 'bg-white border border-gray-200 text-gray-900'
              : 'bg-[#141414] border border-[#2a2a2a] text-white',
          });
          onLoggedOut();
        }}
      />
    </>
    );
  }

  return (
    <div className={`h-screen w-screen relative overflow-clip ${themeStyle === 'monochrome' ? 'bg-gradient-to-br from-blue-50 via-white to-purple-50/30' : 'bg-[#0a0a0a]'}`}>
      {/* System Announcement - Banner mode (top bar) */}
      {announcement && showAnnouncement && announcement.displayMode !== 'popup' && announcement.displayMode !== 'sidebar' && (
        <div className={`fixed top-0 left-0 right-0 z-[400] flex items-center justify-center gap-2 px-4 py-2 text-sm ${
          announcement.type === 'warning'
            ? 'bg-amber-500 text-amber-950'
            : announcement.type === 'danger'
              ? 'bg-red-500 text-white'
              : themeStyle === 'monochrome'
                ? 'bg-blue-600 text-white'
                : 'bg-[#d4af37] text-[#0a0a0a]'
        }`}>
          <Bell className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 text-center">{announcement.text}</span>
          <button onClick={dismissAnnouncement} className="p-1 hover:opacity-70 transition-opacity flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* System Announcement - Popup mode (center modal) */}
      {announcement && showAnnouncement && announcement.displayMode === 'popup' && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`max-w-md w-[90vw] mx-4 rounded-xl shadow-2xl ${
            themeStyle === 'monochrome' ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-[#333]'
          }`}>
            <div className={`flex items-center gap-3 px-5 py-4 border-b ${
              themeStyle === 'monochrome' ? 'border-gray-100' : 'border-[#2a2a2a]'
            }`}>
              <div className={`p-2 rounded-lg ${
                announcement.type === 'warning'
                  ? 'bg-amber-100 text-amber-600'
                  : announcement.type === 'danger'
                    ? 'bg-red-100 text-red-600'
                    : themeStyle === 'monochrome'
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-[#d4af37]/20 text-[#d4af37]'
              }`}>
                <Bell className="w-5 h-5" />
              </div>
              <h3 className={`font-semibold text-lg ${
                themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'
              }`}>系统公告</h3>
              <button onClick={dismissAnnouncement} className={`ml-auto p-1.5 rounded-lg transition-colors ${
                themeStyle === 'monochrome' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-[#2a2a2a] text-gray-500'
              }`}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-6">
              <p className={`text-base leading-relaxed whitespace-pre-wrap ${
                themeStyle === 'monochrome' ? 'text-gray-700' : 'text-gray-300'
              }`}>{announcement.text}</p>
            </div>
            <div className={`flex justify-end gap-3 px-5 py-4 border-t ${
              themeStyle === 'monochrome' ? 'border-gray-100' : 'border-[#2a2a2a]'
            }`}>
              <button onClick={dismissAnnouncement} className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                themeStyle === 'monochrome'
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-[#d4af37] text-[#0a0a0a] hover:bg-[#c4a030]'
              }`}>我知道了</button>
            </div>
          </div>
        </div>
      )}
      {/* System Announcement - Sidebar/Toast mode (right side notification) */}
      {announcement && showAnnouncement && announcement.displayMode === 'sidebar' && (
        <div className={`fixed top-20 right-4 z-[450] max-w-sm w-80 rounded-xl shadow-2xl animate-in slide-in-from-right duration-300 ${
          themeStyle === 'monochrome' ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-[#333]'
        }`}>
          <div className={`flex items-start gap-3 p-4`}>
            <div className={`p-2 rounded-lg flex-shrink-0 ${
              announcement.type === 'warning'
                ? 'bg-amber-100 text-amber-600'
                : announcement.type === 'danger'
                  ? 'bg-red-100 text-red-600'
                  : themeStyle === 'monochrome'
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-[#d4af37]/20 text-[#d4af37]'
            }`}>
              <Bell className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`font-semibold text-sm mb-1 ${
                themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'
              }`}>系统通知</div>
              <p className={`text-sm leading-relaxed whitespace-pre-wrap ${
                themeStyle === 'monochrome' ? 'text-gray-600' : 'text-gray-400'
              }`}>{announcement.text}</p>
            </div>
            <button onClick={dismissAnnouncement} className={`p-1 rounded flex-shrink-0 transition-colors ${
              themeStyle === 'monochrome' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-[#2a2a2a] text-gray-500'
            }`}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {/* ★ 模式切换确认对话框：有进行中生图任务时弹出 */}
      {pendingModeSwitch && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className={`max-w-md rounded-xl p-6 shadow-2xl ${themeStyle === 'monochrome' ? 'bg-white border border-blue-200' : 'bg-[#1a1a1a] border border-[#d4af37]/30'}`}>
            <h3 className={`text-lg font-semibold mb-3 ${themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'}`}>
              切换模式确认
            </h3>
            <p className={`text-sm mb-2 ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-gray-300'}`}>
              当前画布有正在进行的生图任务，切换模式后进度显示将暂时隐藏。
            </p>
            <p className={`text-xs mb-5 ${themeStyle === 'monochrome' ? 'text-gray-500' : 'text-gray-400'}`}>
              任务将在后台继续执行，切换回画布模式后可查看生成结果。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelModeSwitch}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  themeStyle === 'monochrome'
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-[#2a2a2a] text-gray-300 hover:bg-[#3a3a3a]'
                }`}
              >
                继续等待
              </button>
              <button
                onClick={confirmModeSwitch}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                确认切换
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Canvas - 全屏 */}
      <div className="absolute inset-0">
        <InfiniteCanvas
          key={currentProject?.id || 'canvas-local'}
          images={images}
          onImagesChange={setImages}
          onHistoryTransactionBegin={beginCanvasHistoryTransaction}
          onHistoryTransactionCommit={commitCanvasHistoryTransaction}
          onHistoryTransactionRollback={rollbackCanvasHistoryTransaction}
          isHistoryTransitionPending={historyTransitionPending}
          onDeleteImages={handleDeleteCanvasImages}
          onUndo={handleUndo}
          onRedo={handleRedo}

          selectedImage={selectedImage}
          onSelectImage={setSelectedImage}
          onPreviewImage={handlePreview}
          onGenerateVariation={handleCanvasGenerateVariation}
          onExtractKeywords={handleCanvasExtractKeywords}
          onFusion={handleCanvasFusion}
          onAddImages={handleAddImages}
          onUploadEffectReverseSource={handleUploadEffectReverseSource}
          onReferenceSelect={handleCanvasReferenceSelect}
          referenceIds={ctrlRefSelections.map(r => r.id)}
          altRefMarkerIds={altRefMarkers.map(r => r.id)}
          onAltMarkReference={handleAltMarkReference}
          themeStyle={themeStyle}
          onVisionPrompt={handleVisionPrompt}
          visionPromptEnabled={visionPromptEnabled}
          onToggleVisionPrompt={() => {
            setVisionPromptEnabled(prev => !prev);
            setOhMyPromptOpen(prev => !prev);
          }}
          ohMyPromptOpen={ohMyPromptOpen}
          onCloseOhMyPrompt={() => { setOhMyPromptOpen(false); setVisionPromptEnabled(false); }}
          onToggleOhMyPrompt={() => setOhMyPromptOpen(prev => !prev)}
          onInsertPrompt={(prompt: string) => setExternalPrompt(prompt)}
          ohMyPromptThemeStyle={themeStyle === 'monochrome' ? 'default' : 'gold'}
          isVisionAnalyzing={isVisionAnalyzing}
          visionResult={visionResult}
          onToggleSettings={() => setPanelCollapsed(prev => !prev)}
          onToggleTheme={() => setThemeStyle(prev => prev === 'gold' ? 'monochrome' : 'gold')}
          onToggleUserManager={() => setAppMode('dashboard')}
          onToggleAdminSystem={() => setAppMode('dashboard')}
          isAdmin={currentUser?.role === 'admin'}
          onToggleProjectData={() => setShowProjectData(prev => !prev)}
          onToggleHelp={() => setShowHelpGuide(true)}
          onAddToFavorites={handleAddToFavorites}
          onToggleFavorites={() => setShowFavorites(true)}
          onTogglePromptTemplate={() => setShowPromptTemplate(true)}
          brandProject={currentProject ? {
            id: currentProject.id,
            brandName: currentProject.name || '',
            description: currentProject.description || '',
            targetAudience: '',
            tone: '',
            brandDna: null,
          } : null}
          projectId={currentProject?.id}
          initialAnnotations={initialCanvasAnnotations}
          onAnnotationsChange={handleAnnotationsChange}
          onRequestTaskPoll={requestCanvasTaskPoll}
          onSwitchToNodeMode={() => safeSwitchMode('node')}
          onSwitchToWorkflowHub={() => safeSwitchMode('workflow-hub')}
          onSwitchToDashboard={() => safeSwitchMode('dashboard')}
          initialViewState={viewStateRef.current || undefined}
          isPanelCollapsed={panelCollapsed}
          navigateToImageId={navigateToImageId}
          onNavigateToImageComplete={() => setNavigateToImageId(null)}
          onGroupsChange={(groups) => {
            groupsRef.current = groups;
            // 额外持久化分组到 localStorage，防止竞态条件下数据丢失
            try {
              if (currentProject?.id) {
                localStorage.setItem(`wujie-groups-${currentProject.id}`, JSON.stringify(groups));
              }
            } catch {}
          }}
          initialGroups={initialGroups}
          onViewStateChange={(vs) => {
            viewStateRef.current = vs;
            setViewState(vs);
          }}
          onForceSave={(nextImages) => {
            try {
              persistCanvasImagesNow(nextImages);
            } catch {}
          }}
          onEditImage={handleEditImage}
          onSendToChat={(image) => { void handleSendCanvasImageToChat(image); }}
          connections={canvasConnections}
          onConnectionsChange={setCanvasConnections}
          versionHistoryManager={treeHistoryRef.current}
          onOpenVideoPanel={handleOpenVideoPanel}
          onRetryProcessing={handleRetryVideoProcessing}
        />
      </div>

      {/* Language-based Image Editor */}
      {showImageEditor && (
        <ImageEditor
          image={editingImage}
          canvasImages={images}
          onClose={handleEditCancel}
          themeStyle={themeStyle}
          onConfirm={(result) => {
            // Always add a new image to canvas (preserve the original)
            const ar = result.aspectRatio || '1:1';
            const [arW, arH] = ar.split(':').map(Number);
            const baseSize = 400;
            let imgW: number, imgH: number;
            if (arW >= arH) {
              imgW = baseSize;
              imgH = Math.round(baseSize * arH / arW);
            } else {
              imgH = baseSize;
              imgW = Math.round(baseSize * arW / arH);
            }
            // Position new image to the right of the original if editing existing
            let newX = 100 + Math.random() * 200;
            let newY = 100 + Math.random() * 200;
            if (editingImage) {
              newX = editingImage.x + editingImage.width + 20;
              newY = editingImage.y;
            }
            const newImg: CanvasImage = {
              id: `lang-edit-${Date.now()}`,
              url: result.url,
              prompt: result.prompt,
              x: newX,
              y: newY,
              width: imgW,
              height: imgH,
            };
            setImages(prev => [...prev, newImg]);
            setShowImageEditor(false);
            setEditingImage(null);
          }}
        />
      )}

      {/* Right Panel - with vertical collapse strip */}
      <div data-workspace-right-panel className={`fixed top-0 right-0 bottom-0 z-[70] flex transition-all duration-300 ease-in-out ${panelCollapsed ? '' : ''}`} style={{ width: panelCollapsed ? '20px' : 'min(480px, 100vw)' }}>
        {/* Vertical collapse strip */}
        <button
          onClick={() => setPanelCollapsed(prev => !prev)}
          className={`w-5 flex items-center justify-center cursor-pointer transition-all duration-200 shrink-0 ${themeStyle === 'monochrome' ? 'bg-gray-100 hover:bg-gray-200 border-r border-gray-200' : 'bg-[#0F1117] hover:bg-[#1a1d26] border-r border-white/[0.06]'}`}
          style={{ borderRadius: '4px 0 0 4px' }}
          title={panelCollapsed ? '展开面板' : '收起面板'}
          aria-label={panelCollapsed ? '展开面板' : '收起面板'}
        >
          {panelCollapsed ? (
            <ChevronLeft size={14} className={themeStyle === 'monochrome' ? 'text-gray-500' : 'text-gold-muted'} />
          ) : (
            <ChevronRight size={14} className={themeStyle === 'monochrome' ? 'text-gray-500' : 'text-gold-muted'} />
          )}
        </button>

        {/* Panel Content */}
        {!panelCollapsed && (
        <div className={`flex-1 flex flex-col ${themeStyle === 'monochrome' ? 'bg-white border-l border-gray-200' : 'bg-[#141418] border-l border-white/[0.06]'} overflow-hidden`}>
          {/* 软件标题 */}
          <div className="px-4 py-2.5 flex-shrink-0 flex items-center">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className={`text-lg font-bold leading-tight tracking-tight ${themeStyle === 'monochrome' ? 'text-gray-900' : 'text-foreground'}`}>
                  {APP_NAME}
                </h1>
                <div className={`w-1.5 h-1.5 rounded-full ${themeStyle === 'monochrome' ? 'bg-blue-500' : 'bg-gold shadow-[0_0_6px_rgba(200,164,92,0.5)]'}`} />
              </div>
              <span className={`text-[10px] leading-tight font-mono ${themeStyle === 'monochrome' ? 'text-gray-400' : 'text-gold-muted'}`}>
                {APP_FULL_VERSION_LABEL}
              </span>
            </div>
          </div>
          <div className={`h-px ${themeStyle === 'monochrome' ? 'bg-gray-200' : 'bg-gradient-to-r from-transparent via-gold/15 to-transparent'}`} />

          {/* Panel Tabs - 紧凑化 */}
          <div className="flex flex-shrink-0">
            <button
              onClick={() => { setActivePanel('chat'); setChatTabOpen(true); }}
              className={`flex-1 py-2 px-3 flex items-center justify-center gap-1.5 transition-all text-sm relative ${
                activePanel === 'chat'
                  ? themeStyle === 'monochrome' ? 'text-blue-600 font-semibold' : 'text-gold font-semibold'
                  : themeStyle === 'monochrome' ? 'text-gray-500 hover:text-gray-800 hover:bg-gray-50' : 'text-gold-muted hover:text-text-bright hover:bg-white/5'
              }`}
            >
              <MessageSquare size={15} />
              <span className="text-sm">AI聊天</span>
              {activePanel === 'chat' && (
                <span className={`absolute bottom-0 left-2 right-2 h-[2px] rounded-full ${themeStyle === 'monochrome' ? 'bg-blue-500' : 'bg-gold shadow-[0_0_6px_rgba(200,164,92,0.5)]'}`} />
              )}
            </button>
            <button
              onClick={() => { setActivePanel('generate'); setChatTabOpen(false); }}
              className={`flex-1 py-2 px-3 flex items-center justify-center gap-1.5 transition-all text-sm relative ${
                activePanel === 'generate'
                  ? themeStyle === 'monochrome' ? 'text-blue-600 font-semibold' : 'text-gold font-semibold'
                  : themeStyle === 'monochrome' ? 'text-gray-500 hover:text-gray-800 hover:bg-gray-50' : 'text-gold-muted hover:text-text-bright hover:bg-white/5'
              }`}
            >
              <ImageIcon size={15} />
              <span className="text-sm">图像生成</span>
              {activePanel === 'generate' && (
                <span className={`absolute bottom-0 left-2 right-2 h-[2px] rounded-full ${themeStyle === 'monochrome' ? 'bg-blue-500' : 'bg-gold shadow-[0_0_6px_rgba(200,164,92,0.5)]'}`} />
              )}
            </button>
            {/* Video generation is now a floating panel accessible from bottom toolbar */}
          </div>
          <div className={`h-px ${themeStyle === 'monochrome' ? 'bg-gray-200' : 'bg-gradient-to-r from-transparent via-gold/15 to-transparent'}`} />

          {/* Panel Content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className={activePanel === 'generate' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <div className="flex flex-shrink-0 gap-1 px-4 py-2">
                <button
                  type="button"
                  onClick={() => setCreateMode('quick')}
                  className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-semibold transition-colors ${createMode === 'quick' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                >
                  快速创作
                </button>
                <button
                  type="button"
                  onClick={() => setCreateMode('professional')}
                  className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-semibold transition-colors ${createMode === 'professional' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                >
                  专业创作
                </button>
                <button
                  type="button"
                  onClick={() => setCreateMode('vector')}
                  className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-semibold transition-colors ${createMode === 'vector' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                >
                  AI 矢量
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth" style={{
                scrollbarWidth: 'thin',
                scrollbarColor: themeStyle === 'monochrome' ? '#d1d5db transparent' : '#444 transparent'
              }}>
                {createMode === 'quick' ? (
                  <QuickCreatePanel
                    themeStyle={themeStyle}
                    selectedImage={selectedImage ? { id: selectedImage.id, url: selectedImage.url, prompt: selectedImage.prompt } : null}
                    imageModels={quickCreateImageModels}
                    chatModels={quickCreateChatModels}
                    resolvedImageModel={resolvedQuickCreateImageModel}
                    resolvedChatModel={resolvedQuickCreateChatModel}
                    compileState={quickCreateCompileState}
                    modelsLoading={quickCreateModelsLoading}
                    modelsError={quickCreateModelsError}
                    onGenerate={handleQuickGenerate}
                    onOpenProfessional={handleOpenQuickProfessional}
                    onOpenChat={handleOpenQuickChat}
                    onOpenVideo={handleOpenVideoPanel}
                  />
                ) : createMode === 'vector' ? (
                  <VectorDesignPanel
                    themeStyle={themeStyle}
                    selectedImage={selectedImage ? {
                      id: selectedImage.id,
                      url: selectedImage.url,
                      svgUrl: selectedImage.svgUrl,
                      svgDataUrl: selectedImage.svgDataUrl,
                    } : null}
                    onAddVector={handleAddVectorAsset}
                  />
                ) : (
                  <GenerationPanel
                    onGenerate={handleGenerate}
                    onAnalyzeImage={handleAnalyzeImage}
                    onAddToCanvas={handleAddToCanvas}
                    onExtractPrompt={handleExtractPrompt}
                    externalPrompt={externalPrompt}
                    onExternalPromptConsumed={handleExternalPromptConsumed}
                    ctrlRefSelections={ctrlRefSelections}
                    onRemoveCtrlRef={handleRemoveCtrlRef}
                    onUpdateCtrlRefKeyword={handleUpdateCtrlRefKeyword}
                    onFusionGenerate={handleFusionGenerate}
                    altRefMarkers={altRefMarkers}
                    onRemoveAltRefMarker={handleRemoveAltRefMarker}
                    themeStyle={themeStyle}
                    externalReferenceImage={externalReferenceImage}
                    onExternalReferenceImageConsumed={() => setExternalReferenceImage(null)}
                    onOpenPromptEquation={() => setShowPromptEquation(true)}
                    applyFavoriteParams={favoriteParams}
                    onFavoriteParamsApplied={() => setFavoriteParams(null)}
                    selectedImageUrl={selectedImage?.url}
                    onError={(error: string) => {
                      toast.error('生成失败', {
                        description: error,
                        className: themeStyle === 'monochrome'
                          ? 'bg-white border border-gray-200 text-gray-900'
                          : 'bg-[#141414] border-[#2a2a2a] text-white',
                      });
                      setActiveGenerationCount(prev => Math.max(0, prev - 1));
                    }}
                  />
                )}
              </div>
            </div>
            <div className={activePanel === 'chat' ? 'flex-1 overflow-hidden' : 'hidden'}>
              <ChatPanel themeStyle={themeStyle} projectId={currentProject?.id} onAddToPrompt={handleAddToPrompt} onAddImages={handleAddImages} onAddGeneratedImage={handleAddEmbeddedChatImage} canvasImages={images} selectedCanvasImage={selectedImage} onResolveCanvasImageForChat={resolveCanvasImageForChat} onChatModelChange={setCurrentChatModelInfo} chatInitialImage={chatInitialImage} onChatInitialImageConsumed={() => setChatInitialImage(null)} chatTabOpen={chatTabOpen} onChatTabOpenChange={setChatTabOpen} onNavigateToImage={(id: string) => setNavigateToImageId(id)} onGenerateImage={handleChatGenerateImage} externalPrompt={externalChatPrompt} onExternalPromptConsumed={() => setExternalChatPrompt(undefined)} />
            </div>

            {/* 固定在底部的开始生成按钮 */}
            {activePanel === 'generate' && createMode === 'professional' && (
              <div className="px-4 py-3 flex-shrink-0">
                <div className={`h-px mb-3 ${themeStyle === 'monochrome' ? 'bg-gray-200' : 'bg-gradient-to-r from-transparent via-gold/15 to-transparent'}`} />
                <button
                  onClick={() => document.dispatchEvent(new CustomEvent('trigger-generate'))}
                  className={`btn-press w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${themeStyle === 'monochrome' ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-md hover:shadow-lg active:shadow-sm' : 'bg-gradient-to-r from-gold to-gold-dark text-black hover:from-gold-light hover:to-gold shadow-md hover:shadow-lg active:shadow-sm'}`}
                >
                  <Sparkles className="h-4 w-4" />
                  <span>开始生成</span>
                </button>
              </div>
            )}
            </div>
          </div>
        )}
      </div>
      {/* End Right Panel */}


      {/* 提示词方程式 */}
      <PromptEquation
        open={showPromptEquation}
        onClose={() => setShowPromptEquation(false)}
        onSendToPrompt={(text) => {
          setExternalPrompt(text);
          setShowPromptEquation(false);
        }}
        chatModel={currentChatModelInfo?.model || ''}
        isMonochrome={themeStyle === 'monochrome'}
      />

      {/* Preview */}
      <ImagePreview
        image={previewImage}
        onClose={() => setPreviewImage(null)}
        themeStyle={themeStyle}
        onEditImage={(img) => { setPreviewImage(null); handleEditImage(img); }}
      />

      {/* Floating Video Generation Panel */}
      {showVideoPanel && (
        <VideoGenerationPanel
          ref={videoPanelRef}
          floating
          onVideoGenerate={async (params) => {
            await handleVideoGenerate(params);
            return {};
          }}
          onAddImages={(urls: string[]) => handleAddImages(urls)}
          onClose={() => setShowVideoPanel(false)}
          externalPrompt={externalVideoPrompt}
          externalPromptMode={externalVideoMode}
          onExternalPromptConsumed={() => {
            setExternalVideoPrompt(undefined);
            setExternalVideoMode('generate');
          }}
          onError={(error: string) => {
            toast.error('视频生成失败', {
              description: error,
              className: themeStyle === 'monochrome'
                ? 'bg-white border border-gray-200 text-gray-900'
                : 'bg-[#141414] border-[#2a2a2a] text-white',
            });
          }}
          themeStyle={themeStyle}
          selectedImageUrl={selectedImage?.mediaType !== 'video' ? selectedImage?.url : undefined}
          selectedVideoUrl={selectedImage?.mediaType === 'video' ? selectedImage?.videoUrl : undefined}
        />
      )}

      {/* Toast */}
      <Toaster
        position="top-center"
        toastOptions={{
          className: themeStyle === 'monochrome'
            ? 'bg-white border border-gray-200 text-gray-900 shadow-lg shadow-gray-200/50'
            : 'bg-[#1a1a1a] border border-[#2a2a2a] text-white shadow-lg shadow-black/30',
          style: {
            borderRadius: '12px',
            fontSize: '13px',
          },
        }}
      />

      {/* Help Guide Modal */}
      <HelpGuide
        isOpen={showHelpGuide}
        onClose={() => setShowHelpGuide(false)}
        themeStyle={themeStyle}
      />

      {/* Favorites Panel */}
      {showFavorites && currentUser && (
        <FavoritesPanel
          userId={currentUser.id || currentUser.name}
          onClose={() => setShowFavorites(false)}
          isMonochrome={themeStyle === 'monochrome'}
          onApplyParams={(item) => {
            // ★ 修复：尝试为收藏夹中的纯 modelId 构建 providerId::modelId 复合键
            let favModel = item.model || '';
            if (favModel && !favModel.includes('::')) {
              try {
                const wsmStr = localStorage.getItem('wujie_selected_model');
                if (wsmStr) {
                  const wsm = JSON.parse(wsmStr);
                  if (wsm.providerId && wsm.model === favModel) {
                    favModel = `${wsm.providerId}::${favModel}`;
                  }
                }
              } catch {}
            }
            setFavoriteParams({
              prompt: item.prompt || '',
              negativePrompt: item.negativePrompt || '',
              model: favModel,
              aspectRatio: item.aspectRatio || '',
              quality: item.quality || '',
            });
            setShowFavorites(false);
          }}
        />
      )}

      {/* Prompt Template Panel */}
      <PromptTemplatePanel
        isOpen={showPromptTemplate}
        onClose={() => setShowPromptTemplate(false)}
        isMonochrome={themeStyle === 'monochrome'}
        isAdmin={currentUser?.role === 'admin'}
        onUseTemplate={(content: string) => {
          setExternalPrompt(content);
          setShowPromptTemplate(false);
        }}
      />

      {/* Project Data Panel */}
      <ProjectDataPanel
        isOpen={showProjectData && !!currentUser}
        onClose={() => setShowProjectData(false)}
        projectName={currentProject?.name || ''}
        projectDescription={currentProject?.description || ''}
        images={images.map(img => ({
          id: img.id,
          url: img.url,
          x: img.x,
          y: img.y,
          width: img.width,
          height: img.height,
          prompt: img.prompt,
          model: img.model,
          quality: img.quality,
          aspectRatio: img.aspectRatio,
          stylePreset: img.stylePreset,
          category: img.category,
          size: img.size,
          createdAt: img.createdAt,
          negativePrompt: img.negativePrompt,
          modelName: img.modelName,
          apiProvider: img.apiProvider,
          assetId: img.assetId,
          placementId: img.placementId,
          mediaAvailability: img.mediaAvailability,
        }))}
        onDeleteImages={async (ids) => {
          const deletedIds = await handleDeleteCanvasImages(ids);
          if (deletedIds.length === ids.length) setSelectedImage(null);
        }}
        onNavigateToImage={(imageId) => {
          setNavigateToImageId(imageId);
          setShowProjectData(false);
        }}
        onMakeSame={(img) => {
          // ★ 修复：构建包含 providerId 的复合键，避免多提供商同名模型选错
          // img.apiProvider 存的是提供商名称，需要反查 providerId
          let modelValue = img.model || '';
          if (img.model && img.apiProvider && !img.model.includes('::')) {
            // 尝试从画布模型列表反查 providerId
            const canvasModelsStr = localStorage.getItem('wujie_canvas_gen_models');
            if (canvasModelsStr) {
              try {
                const canvasModels: unknown = JSON.parse(canvasModelsStr);
                const match = Array.isArray(canvasModels)
                  ? canvasModels.find((entry): entry is { id: string; providerName?: string; providerId?: string } =>
                    typeof entry === 'object' && entry !== null &&
                    typeof (entry as { id?: unknown }).id === 'string' &&
                    (entry as { id: string; providerName?: string }).id === img.model &&
                    (entry as { providerName?: string }).providerName === img.apiProvider,
                  )
                  : undefined;
                if (match?.providerId) {
                  modelValue = `${match.providerId}::${img.model}`;
                }
              } catch {}
            }
            // 如果反查失败，尝试从 wujie_selected_model 读取
            if (!modelValue.includes('::')) {
              try {
                const wsmStr = localStorage.getItem('wujie_selected_model');
                if (wsmStr) {
                  const wsm = JSON.parse(wsmStr);
                  if (wsm.providerId && wsm.model === img.model) {
                    modelValue = `${wsm.providerId}::${img.model}`;
                  }
                }
              } catch {}
            }
          }
          setFavoriteParams({
            prompt: img.prompt || '',
            model: modelValue,
            aspectRatio: img.aspectRatio,
            quality: img.quality,
            negativePrompt: img.negativePrompt,
          });
          setShowProjectData(false);
        }}
        isMonochrome={themeStyle === 'monochrome'}
      />

    </div>
  );
}
