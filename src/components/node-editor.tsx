'use client';

import { createWorkflowFromPreset, WORKFLOW_PRESETS, type WorkflowPreset } from '@/lib/workflow-presets';
import { importWorkflowFile, isWorkflowGraph } from '@/lib/workflow-file';

import NextImage from 'next/image';
import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, useReducer } from 'react';
import {
  WorkflowNode, WorkflowConnection, Workflow as WorkflowData, NodeType, NodeCategory,
  NODE_TYPE_COLORS, NODE_TYPE_LABELS, NODE_TYPE_ICONS, NODE_CATEGORY_LABELS,
  PORT_COLORS, NodePort, PortType, PropertyField,
  createWorkflowNode, createConnection, createEmptyWorkflow,
  getNodePropertyFields, getNodeCategory, NODE_TEMPLATES, getWorkflowNodeTemplates,
  canConnectPorts, autoLayoutWorkflow, isImageGeneratingNode, getOutputNodeSize,
  mergeWorkflowNodeUpdate, resolveWorkflowOutputAssetReference, type WorkspaceAssetReference,
  configureWorkflowSkillNodePorts,
  updateWorkflowSkillModelBinding, workflowModelSupportsSkillRole,
  parseWorkflowSketchDocumentReference, resolveInlineSubgraph, type WorkflowSketchDocumentReference,
  parseWorkflowSketchImageReference,
} from '@/lib/workflow-engine';
import { planWorkflowImageExtraction } from '../lib/workflow-image-graph';
import { createWorkflowImageGridClient, type WorkflowGridClient, type WorkflowGridClientView } from '../lib/workflow-image-grid-client';
import { readWorkflowImageRetryView, beginWorkflowImageRetry, acceptWorkflowImageRetry, finishWorkflowImageRetry, readWorkflowImageRetrySnapshot, workflowImageRetryRecord, type WorkflowImageRetryView, type WorkflowImageRetryResult } from '../lib/workflow-image-retry-view';
import { SketchClient, sketchModels, DOCUMENT_PLACEMENT_REASON, SKETCH_DOCUMENT_SANDBOX, type SketchScope } from '@/lib/sketch-to-code/client';
import { sketchImageModels } from '@/lib/sketch-to-code/image-contract';
import { WorkflowSketchImageControls } from '@/components/workflow-sketch-image-controls';
import { SketchPlacement, type SketchInsert } from '@/lib/sketch-to-code/placement-client';
import {
  applyWorkflowCommand,
  createWorkflowClipboardSnapshot,
  createWorkflowEditorState,
  mergeExternalWorkflowWithPositions,
  undoWorkflowCommandHistory,
  redoWorkflowCommandHistory,
  reduceWorkflowEditorState,
  type WorkflowCommandResult,
  type WorkflowEditorTransition,
  type WorkflowClipboardSnapshot,
  type WorkflowInteractionCommand,
  type WorkflowNodePosition,
} from '@/lib/workflow-renderer/commands';
import { resolveWorkflowRendererMode, type WorkflowRendererMode } from '@/lib/workflow-renderer/mode';
import { createMinimapPointerTracker } from '@/lib/workflow-renderer/minimap-pointer';
import {
  projectLegacyRenderModel,
  projectReactFlowRenderModel,
} from '@/lib/workflow-renderer/view-model';
import { WorkflowLegacySurface, type WorkflowLegacyCardCallbacks } from '@/components/workflow/WorkflowLegacySurface';
import { WorkflowReactFlowSurface } from '@/components/workflow/WorkflowReactFlowSurface';
import { WorkflowShadowProbe } from '@/components/workflow/WorkflowShadowProbe';
import { WorkflowLibraryContent } from '@/components/workflow/WorkflowLibraryContent';
import { WorkflowContextMenu, type WorkflowMenuAction, type WorkflowMenuLocation } from '@/components/workflow/WorkflowContextMenu';
import { ImageCompareDialog } from '@/components/image-compare-dialog';
import { getModelDisplayName } from '@/lib/model-name-map';
import { readWorkflowImageInputTransform } from '../lib/workflow-image-receiver';
import { parseExactModelKey, resolvePersistedModelSelection } from '@/lib/model-defaults';
import { computePortPosition } from '@/lib/node-port-position';
import { getLegacyPortWorldPosition } from '@/lib/workflow-renderer/legacy-port-position';
import { createLegacyMobilePointerController, type LegacyMobilePointerController, type LegacyMobilePointerOptions, type LegacyPortEndpoint } from '@/lib/workflow-renderer/legacy-mobile-pointer';
import {
  createTaskModelCatalogIndex,
  taskModelKey,
  type TaskModelDescriptor,
} from '@/lib/task-core/model-capability-contract';
import type { TaskModelCatalogModel } from '@/hooks/use-task-model-catalog';
import { WorkspaceSourceTraceDetails } from '@/components/workspace-source-trace';
import { SkillInputFields } from '@/components/skill-runtime/SkillInputFields';
import { BriefToVideoApprovalCard } from '@/components/skill-runtime/BriefToVideoApprovalCard';
import { loadWorkflowSkillCatalog, loadSavedWorkflowSkillResult } from '@/lib/skill-runtime/workflow-client';
import { BRIEF_TO_VIDEO_SKILL_ID } from '@/lib/skill-runtime/brief-to-video-preset';
import type { SkillApprovalIdentity } from '@/lib/skill-runtime/approval';
import {
  isWorkflowExecutionScopeCurrent,
  resolveWorkflowExecutionScope,
} from '@/lib/workflow-execution-scope';
import type { WorkflowExecutionScope } from '@/lib/workflow-execution-scope';
import { estimateWorkflowSkills, type WorkflowSkillQuote } from '@/lib/skill-runtime/workflow-estimate-client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  requiredSkillModelRoles,
  type SkillDefinition,
  type SkillModelBinding,
} from '@/lib/skill-runtime/types';
import { getPromptTemplates, addPromptTemplate, type PromptTemplate } from '@/lib/prompt-templates';
import {
  getVisibleWorkflowNodeIds,
  resolveWorkflowCullingBounds,
} from '@/lib/node-canvas-virtualization';
import {
  CANVAS_ASSET_DRAG_MIME,
  createPendingWorkflowInputReference,
  createWorkflowInputTransferGuard,
  isWorkspaceResultScopeCurrent,
  parseCanvasAssetDragPayload,
  prepareWorkflowCanvasInsertions,
  runGuardedWorkflowInputTransfer,
  serializeCanvasAssetDragPayload,
  shouldInvalidateWorkflowInputTransfer,
  type WorkflowCanvasInsertionItem,
} from '@/lib/asset-core/workspace-transfer';
import {
  buildWorkflowChatReturnIntentUrl,
  navigateToWorkflowChatAfterPersistence,
} from '@/lib/asset-core/workflow-chat-return';
import {
  NodeAnnotationWorkspace,
  type NodeAnnotationSource,
} from '@/features/annotations/node-annotation-workspace';
import {
  collectNodeAnnotationCandidates,
  type NodeAnnotationCandidate,
} from '@/features/annotations/node-annotation-candidates';
import type { EditIntentBundle } from '@/features/annotations/annotation-types';
import {
  Image as ImageIcon, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, Save, Download, Play, Square,
  FileInput, MoreHorizontal, GitCompare,
  ChevronDown, Plus, Trash2, ZoomIn, ZoomOut, RotateCcw,
  Settings, Upload, X, Check, AlertCircle, Loader2, BoxSelect, Group,
  Search, ScanSearch,
  ArrowLeft, LayoutGrid, Sparkles, Rotate3d, Box, ShoppingBag,
  Copy, Clipboard, Film, BookOpen, Blocks, FolderOpen, ScrollText, MousePointer2,
  CopyPlus, Unlink, Shuffle, Video, FileVideo,
  Mic, Volume2, Music, Camera, Clapperboard, Scissors as CutIcon, Globe, AudioLines, Brain,
} from 'lucide-react';

// ==================== 图标映射 ====================

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Image: ImageIcon, Type, SlidersHorizontal, Wand2, Pencil, Maximize, Scissors,
  PenTool, Palette, Sun, GitBranch, GitMerge, Repeat, RefreshCw, Layers,
  Bot, MessageSquare, ImageDown, Save, Download, BoxSelect, Group,
  ScanSearch, Sparkles, Rotate3d, Box, ShoppingBag, Film, Video, FileVideo,
  Mic, Volume2, Music, Camera, Clapperboard, CutIcon, Globe, AudioLines, Brain, Blocks,
};

function getNodeIcon(type: NodeType, size = 14, className = '') {
  const iconName = NODE_TYPE_ICONS[type];
  const IconComp = ICON_MAP[iconName] || Settings;
  return <IconComp size={size} className={className} />;
}

interface ModelOption { id: string; name: string; type: string; provider: string; providerId?: string; apiDisplayName?: string; }

function sketchNodes(nodes: readonly WorkflowNode[], depth = 0): WorkflowNode[] {
  return nodes.flatMap(node => node.type === 'ai-sketch-to-code' || node.type === 'ai-sketch-to-image' ? [node]
    : node.type === 'subgraph' && depth < 3 ? sketchNodes(resolveInlineSubgraph(node)?.nodes || [], depth + 1) : []);
}
function containsSketchNode(nodes: readonly WorkflowNode[]): boolean { return sketchNodes(nodes).length > 0; }
function unavailableSketchModel(nodes: readonly WorkflowNode[], catalog: ReadonlyMap<string, TaskModelDescriptor>, loading: boolean): boolean {
  const sketches = sketchNodes(nodes);
  if (!sketches.length) return false;
  if (loading) return true;
  return sketches.some(node => {
    if (node.type === 'ai-sketch-to-image') {
      return (['vision', 'image'] as const).some(role => {
        const configured = node.config[`${role}Model`], declaredProvider = node.config[`${role}ProviderId`];
        if (typeof configured !== 'string' || !configured || typeof declaredProvider !== 'string' || !declaredProvider) return true;
        const split = configured.indexOf('::'), modelId = split < 0 ? configured : configured.slice(split + 2);
        if (split >= 0 && configured.slice(0, split) !== declaredProvider) return true;
        const descriptor = catalog.get(taskModelKey(declaredProvider, modelId));
        if (!descriptor) return true;
        try { return (role === 'vision' ? sketchModels([descriptor]) : sketchImageModels([descriptor])).length !== 1; }
        catch { return true; }
      });
    }
    const model = String(node.config.model || ''); const split = model.indexOf('::');
    const providerId = split < 0 ? String(node.config.providerId || '') : model.slice(0, split);
    const modelId = split < 0 ? model : model.slice(split + 2);
    const descriptor = catalog.get(taskModelKey(providerId, modelId));
    return !descriptor || sketchModels([descriptor]).length !== 1;
  });
}
type SketchExecutionView = { status: string; output?: Record<string, unknown>; error?: string };
function isWorkflowSkillPauseResult(value: unknown): value is Record<string, SketchExecutionView> {
  const results = workflowImageRetryRecord(value);
  if (!results) return false;
  let hasWaitingRun = false;
  for (const item of Object.values(results)) {
    const result = workflowImageRetryRecord(item);
    if (!result || typeof result.status !== 'string'
      || (result.error !== undefined && typeof result.error !== 'string')) return false;
    const output = workflowImageRetryRecord(result.output);
    if (result.output !== undefined && !output) return false;
    hasWaitingRun ||= result.status === 'waiting-approval' && typeof output?.runId === 'string' && output.runId.length > 0;
  }
  return hasWaitingRun;
}
function safeSketchExecutionResults(results: Record<string, SketchExecutionView>, nodes: readonly WorkflowNode[]): Record<string, SketchExecutionView> {
  const ids = new Set(sketchNodes(nodes).map(node => node.id));
  const imageIds = new Set(sketchNodes(nodes).filter(node => node.type === 'ai-sketch-to-image').map(node => node.id));
  return Object.fromEntries(Object.entries(results).map(([id, result]) => {
    const imageReference = parseWorkflowSketchImageReference(result.output?.sketchImageReference);
    if (imageIds.has(id) || imageReference || result.output && Object.hasOwn(result.output, 'sketchImageReference')) {
      const output: Record<string, unknown> = {};
      if (imageReference) output.sketchImageReference = imageReference;
      for (const key of ['taskId', 'projectId', 'visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId']) {
        const value = result.output?.[key];
        if (typeof value === 'string' && value && value.length <= 256 && value === value.trim() && !/\p{Cc}/u.test(value)) output[key] = value;
      }
      const taskStatus = result.output?.status, phase = result.output?.phase, progress = result.output?.progress;
      if (typeof taskStatus === 'string' && ['pending', 'processing', 'submitting', 'completed', 'failed', 'cancelled', 'timeout'].includes(taskStatus)) output.status = taskStatus;
      if (phase === 'analysis' || phase === 'generation') output.phase = phase;
      if (typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100) output.progress = progress;
      for (const key of ['reserveCredits', 'actualCredits']) {
        const value = result.output?.[key]; if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) output[key] = value;
      }
      for (const key of ['needsReconcile', 'refunded', 'dispatchPending', 'recoveryPending']) {
        const value = result.output?.[key]; if (typeof value === 'boolean') output[key] = value;
      }
      const status = ['idle', 'running', 'pending', 'success', 'failed', 'cancelled', 'timeout', 'skipped'].includes(result.status) ? result.status : 'failed';
      return [id, { status, output, ...(result.error ? { error: '草图生图任务未完成，请核对原任务。' } : {}) }];
    }
    const reference = parseWorkflowSketchDocumentReference(result.output?.documentReference);
    if (!ids.has(id) && !reference) return [id, result];
    const output: Record<string, unknown> = {};
    if (reference) output.documentReference = reference;
    for (const key of ['taskId', 'projectId', 'providerId', 'modelId', 'assetId', 'assetVersionId', 'sourceRole', 'status', 'phase']) {
      const value = result.output?.[key]; if (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value)) output[key] = value;
    }
    if (typeof result.output?.progress === 'number') output.progress = Math.max(0, Math.min(100, result.output.progress));
    for (const key of ['needsReconcile', 'refunded']) if (typeof result.output?.[key] === 'boolean') output[key] = result.output[key];
    const image = result.output?.imageUrl;
    if (typeof image === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) output.imageUrl = image;
    return [id, { status: result.status, output, ...(typeof result.error === 'string' ? { error: result.error.slice(0, 8192) } : {}) }];
  }));
}
interface WorkflowSketchDocumentControlsProps {
  scope: SketchScope; reference: WorkflowSketchDocumentReference | null; status: string; error?: string; phase?: unknown; progress?: unknown; insert?: SketchInsert;
}
function WorkflowSketchDocumentControls({ scope, reference, status, error, phase, progress, insert }: WorkflowSketchDocumentControlsProps) {
  const binding = JSON.stringify(reference);
  const client = useMemo(() => new SketchClient(scope), [scope]);
  const placement = useRef<SketchPlacement | null>(null);
  const lifecycle = useRef(0);
  const urlRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState('');
  const clearPreview = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null; setPreview(null);
  }, []);
  useEffect(() => {
    lifecycle.current += 1; placement.current = null; clearPreview(); setBusy(false); setReadError('');
    return () => {
      lifecycle.current += 1; client.stop(); placement.current?.stop();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [client, binding, status, clearPreview]);
  const perform = async (action: 'preview' | 'download' | 'place'): Promise<void> => {
    if (busy || !reference || status !== 'success' || scope.authority === 'unknown') return;
    const epoch = lifecycle.current;
    const assert = (): void => { scope.assertCurrent(); if (epoch !== lifecycle.current) throw new Error('读取已停止'); };
    setBusy(true); setReadError(''); clearPreview();
    try {
      assert(); const task = await client.poll(reference.taskId); assert();
      if (task.status !== 'completed' || Object.entries(reference).some(([key, value]) => key !== 'kind' && task[key as keyof typeof task] !== value)) throw new Error('草图结果绑定已变化，请核对原任务');
      if (action === 'place') {
        if (!insert) throw new Error('当前画布落点不可用');
        placement.current ||= new SketchPlacement(task, scope, insert);
        await placement.current.add(); assert();
      } else {
        const html = await client.document(reference.taskId); assert();
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        urlRef.current = url; setPreview(url);
        if (action === 'download') {
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sketch-${reference.taskId}.html`; anchor.click();
        }
      }
    } catch (failure) {
      if (epoch === lifecycle.current) { clearPreview(); setReadError(failure instanceof Error ? failure.message : '当前读取未确认，请重新核对任务'); }
    } finally { if (epoch === lifecycle.current) setBusy(false); }
  };
  const readable = status === 'success' && !!reference && scope.authority !== 'unknown';
  const phaseLabel = phase === 'analysis' ? '正在分析草图' : phase === 'reconstruction' ? '正在重建页面' : '';
  const progressLabel = typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100 ? ` · ${progress}%` : '';
  const placementReason = scope.authority === 'document' ? DOCUMENT_PLACEMENT_REASON : scope.authority === 'unknown' ? '项目授权未知，不能放置' : !insert ? '当前画布落点不可用' : '';
  return <div className="px-4 py-3 space-y-2 text-xs">
    <p className="text-muted-foreground">原草图PNG为输入草图，不是重建页面截图；代码按当前授权读取。</p>
    {status === 'running' && <p role="status" className="text-muted-foreground">{phaseLabel ? `${phaseLabel}${progressLabel}` : '草图处理中；受理未知时请核对原提交，不重复扣费。'}</p>}
    {(status === 'failed' || status === 'cancelled') && <p role="alert" className="text-destructive">{error || '草图任务已停止，费用以服务端终态为准。'}</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={!readable || busy} onClick={() => void perform('preview')} className="px-2 py-1.5 rounded border border-border hover:bg-muted focus-visible:outline-primary disabled:opacity-50">预览安全代码</button>
      <button disabled={!readable || busy} onClick={() => void perform('download')} className="px-2 py-1.5 rounded border border-border hover:bg-muted focus-visible:outline-primary disabled:opacity-50">下载安全HTML</button>
      <button disabled={!readable || busy || !!placementReason} title={placementReason} onClick={() => void perform('place')} className="px-2 py-1.5 rounded border border-border hover:bg-muted focus-visible:outline-primary disabled:opacity-50">添加原草图PNG到画布</button>
    </div>
    {placementReason && <p className="text-muted-foreground">{placementReason}</p>}
    {busy && <p role="status">正在核对当前授权…</p>}
    {readError && <p role="alert" className="text-destructive">{readError}</p>}
    {preview && <><button onClick={() => { client.stop(); clearPreview(); }} className="hover:text-primary">关闭代码预览</button>
      <iframe title="草图安全代码预览" sandbox={SKETCH_DOCUMENT_SANDBOX} src={preview} className="w-full h-64 border border-border rounded" /></>}
  </div>;
}

// ==================== 连线临时状态 ====================

interface DraggingConn {
  fromNodeId: string;
  fromPortId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  portType: PortType;
}

// ==================== P0: @图片引用 ====================

interface CanvasImageRef {
  id: string;
  url: string;
  name: string;
  description: string;
  label?: string;
  width?: number;
  height?: number;
  versionId?: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  projectId?: string;
}

interface NodeAnnotationSession {
  source: NodeAnnotationSource;
  anchorNodeId: string;
  connectionNodeId: string;
  connectionPortId: string;
  editingNodeId?: string;
  existingBundle?: EditIntentBundle | null;
}

interface NodeAnnotationCandidatePicker {
  sourceNodeId: string;
  candidates: NodeAnnotationCandidate[];
  existingBundle?: EditIntentBundle | null;
}

function parseAnnotationBundle(value: unknown): EditIntentBundle | null {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as EditIntentBundle;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as EditIntentBundle;
}

interface MentionPopup {
  visible: boolean;
  nodeId: string;
  fieldKey: string;
  filter: string;
  position: { top: number; left: number };
}

// ==================== P2: 提示词库 ====================

interface PromptSnippet {
  id: string;
  text: string;
  tags: string[];
  category: string;
  createdAt: number;
}

interface WorkflowExecutionLog {
  time: number;
  nodeId: string;
  label: string;
  status: string;
  message: string;
  duration?: number;
  nodeType?: string;
}

function mergeExecutionLogs(
  current: WorkflowExecutionLog[],
  incoming: WorkflowExecutionLog[],
): WorkflowExecutionLog[] {
  const seen = new Set(
    current.map(log => `${log.nodeId}\u0000${log.status}\u0000${log.message}`),
  );
  return [
    ...current,
    ...incoming.filter(log => {
      const key = `${log.nodeId}\u0000${log.status}\u0000${log.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

// ==================== 主组件 ====================

interface NodeEditorProps {
  taskModelCatalog?: TaskModelDescriptor[];
  taskModelOptions?: TaskModelCatalogModel[];
  catalogStatus?: { loading: boolean; error: string | null };
  workflow?: WorkflowData | null;
  userId?: string;
  projectId?: string;
  onBack?: () => void;
  /** Document inputs are read-only canonical references, never personal asset copies. */
  canvasDocumentMode?: boolean;
  onWorkflowChange?: (wf: WorkflowData | null) => void;
  onWorkflowSaved?: (wf: WorkflowData) => Promise<void>;
  onWorkflowSaveRequest?: (wf: WorkflowData) => Promise<void>;
  onBeforeWorkflowChatNavigation?: (reference: WorkspaceAssetReference) => Promise<void>;
  onOpenWorkflowHub?: () => void;
  /** P0: 画布图片列表，用于@图片引用 */
  canvasImages?: CanvasImageRef[];
  onCanvasImageAssetReferenceAdopted?: (
    imageId: string,
    reference: WorkspaceAssetReference,
  ) => void;
  /** 主题风格: gold(黑金) / monochrome(单色) */
  themeStyle?: 'gold' | 'monochrome';
  /** 生成图片后回调，将图片添加到项目 */
  onAddImages?: (items: WorkflowCanvasInsertionItem[], meta?: { modelName?: string; apiProvider?: string }) => void | Promise<void>;
  preferredAnnotationModelId?: string;
  rendererMode?: WorkflowRendererMode;
}

interface WorkflowDragSynchronizationOptions {
  externalWorkflow?: WorkflowData | null;
  lastEmittedWorkflowRef: React.RefObject<WorkflowData | null>;
  hydrateWorkflow: (workflow: WorkflowData) => void;
  applyDeferredWorkflow: (workflow: WorkflowData, positions: WorkflowNodePosition[]) => void;
}

export function useWorkflowDragSynchronization({
  externalWorkflow,
  lastEmittedWorkflowRef,
  hydrateWorkflow,
  applyDeferredWorkflow,
}: WorkflowDragSynchronizationOptions) {
  const isDraggingRef = useRef(false);
  const pendingExternalWorkflowRef = useRef<WorkflowData | null>(null);
  const synchronizeExternalWorkflow = useCallback((workflow: WorkflowData) => {
    if (workflow === lastEmittedWorkflowRef.current) return;
    if (isDraggingRef.current) {
      pendingExternalWorkflowRef.current = workflow;
      return;
    }
    hydrateWorkflow(workflow);
  }, [hydrateWorkflow, lastEmittedWorkflowRef]);
  useEffect(() => {
    if (externalWorkflow) synchronizeExternalWorkflow(externalWorkflow);
  }, [externalWorkflow, synchronizeExternalWorkflow]);
  const beginWorkflowDrag = useCallback(() => {
    isDraggingRef.current = true;
  }, []);
  const finishWorkflowDrag = useCallback((positions: WorkflowNodePosition[]) => {
    isDraggingRef.current = false;
    const pendingExternalWorkflow = pendingExternalWorkflowRef.current;
    pendingExternalWorkflowRef.current = null;
    if (pendingExternalWorkflow) applyDeferredWorkflow(pendingExternalWorkflow, positions);
  }, [applyDeferredWorkflow]);
  return {
    isDraggingRef,
    beginWorkflowDrag,
    finishWorkflowDrag,
    synchronizeExternalWorkflow,
  };
}

// ==================== 双主题配色 ====================
const nodeThemes = {
  gold: {
    // 侧边栏 — 与原型对齐 (#161b22)
    sidebarBg: '#161b22',
    sidebarBorder: 'rgba(212,175,55,0.15)',
    sidebarText: '#f0f6fc',
    sidebarMuted: '#8b949e',
    sidebarDimmed: '#484f58',
    // 节点 — 与原型对齐 (毛玻璃 rgba(22,27,34,0.96) + 金色强调)
    nodeBg: '#161b22',
    nodeBorder: 'rgba(212,175,55,0.3)',
    nodeSelectedBorder: 'var(--ne-accent)',
    nodeHoverBg: '#1c2128',
    nodeHeaderText: '#f0f6fc',
    nodePortText: '#8b949e',
    nodeBody: '#0d1117',
    nodeSelected: '#1c2128',
    nodeTitle: '#f0f6fc',
    portFill: '#161b22',
    portLabel: '#8b949e',
    badgeText: '#000',
    gridDot: '#21262d',
    danger: '#f85149',
    success: '#3fb950',
    arrowFill: '#484f58',
    // 强调色
    accent: '#d4af37',
    accentHover: '#c9a02e',
    accentDim: 'rgba(212,175,55,0.15)',
    accentMuted: 'rgba(212,175,55,0.25)',
    // 卡片 — 与原型对齐 (rgba(15,23,42,0.96))
    cardBg: '#1c2128',
    cardBorder: 'rgba(212,175,55,0.15)',
    border: 'rgba(48,54,61,0.6)',
    text: '#f0f6fc',
    textMuted: '#8b949e',
    // 输入框 — 与原型对齐
    inputBg: 'rgba(13,17,23,0.9)',
    inputBorder: 'rgba(48,54,61,0.8)',
    inputText: '#f0f6fc',
    inputPlaceholder: '#484f58',
    // 下拉选项
    optionBg: '#21262d',
    optionText: '#f0f6fc',
    // 按钮 — 与原型对齐
    btnBg: 'rgba(212,175,55,0.1)',
    btnHoverBg: 'rgba(212,175,55,0.2)',
    btnText: 'var(--ne-accent)',
    // 画布 — 与原型对齐 (#0d1117 点阵网格)
    canvasBg: '#0d1117',
    canvasGrid: 'rgba(48,54,61,0.3)',
    canvasDot: 'rgba(48,54,61,0.5)',
    // 连线 — 与原型对齐 (金色流动)
    connColor: '#30363d',
    connHighlight: 'var(--ne-accent)',
    // 工具栏 — 与原型对齐
    toolbarBg: '#161b22',
    toolbarBorder: 'rgba(48,54,61,0.6)',
    toolbarText: '#8b949e',
    // 标签
    tabActiveBg: 'rgba(212,175,55,0.15)',
    tabActiveText: 'var(--ne-accent)',
    tabInactiveText: '#484f58',
    // 执行状态 — 与原型对齐
    statusRunning: '#58a6ff',
    statusSuccess: '#3fb950',
    statusError: '#f85149',
    // 滚动条
    scrollbarTrack: '#111',
    scrollbarThumb: 'rgba(212,175,55,0.2)',
  },
  monochrome: {
    // 侧边栏
    sidebarBg: '#f8fafc',
    sidebarBorder: '#e2e8f0',
    sidebarText: '#1e293b',
    sidebarMuted: '#64748b',
    sidebarDimmed: '#94a3b8',
    // 节点
    nodeBg: '#ffffff',
    nodeBorder: '#cbd5e1',
    nodeSelectedBorder: '#3b82f6',
    nodeHoverBg: '#f1f5f9',
    nodeHeaderText: '#1e293b',
    nodePortText: '#64748b',
    nodeTitleText: '#334155',
    nodeBody: '#f8fafc',
    nodeSelected: '#e2e8f0',
    nodeTitle: '#334155',
    portFill: '#e2e8f0',
    portLabel: '#64748b',
    badgeText: '#ffffff',
    gridDot: '#cbd5e1',
    danger: '#ef4444',
    success: '#22c55e',
    arrowFill: '#94a3b8',
    // 强调色
    accent: '#3b82f6',
    accentHover: '#2563eb',
    accentDim: 'rgba(59,130,246,0.08)',
    accentMuted: 'rgba(59,130,246,0.15)',
    // 卡片
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    border: '#e2e8f0',
    text: '#1e293b',
    textMuted: '#64748b',
    // 输入框
    inputBg: '#f1f5f9',
    inputBorder: '#e2e8f0',
    inputText: '#1e293b',
    inputPlaceholder: '#94a3b8',
    // 下拉选项（原生option需要不透明背景）
    optionBg: '#ffffff',
    optionText: '#1e293b',
    // 按钮
    btnBg: 'rgba(59,130,246,0.08)',
    btnHoverBg: 'rgba(59,130,246,0.15)',
    btnText: '#3b82f6',
    // 画布
    canvasBg: '#f0f4f8',
    canvasGrid: 'rgba(0,0,0,0.03)',
    canvasDot: 'rgba(0,0,0,0.06)',
    // 连线
    connColor: '#94a3b8',
    connHighlight: '#3b82f6',
    // 工具栏
    toolbarBg: '#ffffff',
    toolbarBorder: '#e2e8f0',
    toolbarText: '#64748b',
    // 标签
    tabActiveBg: 'rgba(59,130,246,0.08)',
    tabActiveText: '#3b82f6',
    tabInactiveText: '#94a3b8',
    // 执行状态
    statusRunning: '#3b82f6',
    statusSuccess: '#22c55e',
    statusError: '#ef4444',
    // 滚动条
    scrollbarTrack: '#f1f5f9',
    scrollbarThumb: 'rgba(59,130,246,0.2)',
  },
} as const;


// 底部内容面板 - 显示项目图片，支持拖拽到画布创建节点

export default function NodeEditor({ taskModelCatalog = [], taskModelOptions = [], catalogStatus = { loading: false, error: null }, workflow, userId, projectId, canvasDocumentMode = false, onBack, onWorkflowChange, onWorkflowSaved, onWorkflowSaveRequest, onBeforeWorkflowChatNavigation, canvasImages, onCanvasImageAssetReferenceAdopted, themeStyle = 'gold', onAddImages, preferredAnnotationModelId = '', rendererMode = 'legacy' }: NodeEditorProps) {
  const T = nodeThemes[themeStyle];
  const projectIdRef = useRef(projectId);
  const workflowCanvasPersistenceRef = useRef<{
    executionId: string;
    settled: boolean;
    failedOutputNodeIds: Set<string>;
  } | null>(null);
  projectIdRef.current = projectId;
  // CSS自定义属性，供Tailwind中 var(--ne-xxx) 引用
  const neVars = {
    '--ne-accent': T.accent,
    '--ne-accent-hover': T.accentHover,
    '--ne-accent-dim': T.accentDim,
    '--ne-sidebar-bg': T.sidebarBg,
    '--ne-sidebar-border': T.sidebarBorder,
    '--ne-card-bg': T.cardBg,
    '--ne-card-border': T.cardBorder,
    '--ne-text': T.text,
    '--ne-text-muted': T.textMuted,
    '--ne-input-bg': T.inputBg,
    '--ne-input-border': T.inputBorder,
    '--ne-option-bg': T.optionBg,
    '--ne-option-text': T.optionText,
    '--ne-canvas-bg': T.canvasBg,
    '--ne-toolbar-bg': T.toolbarBg,
    '--ne-toolbar-border': T.toolbarBorder,
    '--ne-toolbar-text': T.toolbarText,
    '--ne-btn-bg': T.btnBg,
    '--ne-btn-hover-bg': T.btnHoverBg,
    '--ne-btn-text': T.btnText,
  } as React.CSSProperties;
  // P2: BroadcastChannel 跨标签同步
  const bcRef = useRef<BroadcastChannel | null>(null);
  const bcIgnoreRef = useRef(false); // 防止自己发的消息回触发
  const bcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [workflowEditorState, dispatchWorkflowEditorTransitionBase] = useReducer(reduceWorkflowEditorState,
    workflow || createEmptyWorkflow('新工作流'),
    createWorkflowEditorState,
  );
  // Invalidate a pending AI result synchronously when graph content may change.
  // Automatic node measurement only adjusts layout and must not invalidate it.
  const aiBuildContentEpochRef = useRef(0);
  const dispatchWorkflowEditorTransition = useCallback((transition: WorkflowEditorTransition): void => {
    if (transition.kind !== 'command' || transition.command.type !== 'node.measure') {
      aiBuildContentEpochRef.current += 1;
    }
    dispatchWorkflowEditorTransitionBase(transition);
  }, []);
  const wf = workflowEditorState.workflow;
  const workflowEditorStateRef = useRef(workflowEditorState);
  workflowEditorStateRef.current = workflowEditorState;
  const wfRef = useRef(wf);
  wfRef.current = wf;
  const editorTransactionCounterRef = useRef(0);
  const materialInsertionCentersRef = useRef(new Map<string, { guard: ReturnType<typeof createWorkflowInputTransferGuard>;
    transactionId: string; x: number; y: number; cx: number; cy: number; width: number; sourceImageId: string; geometryEpoch: number }>());
  const materialGeometryEpochRef = useRef(new Map<string, number>());
  const noteMaterialUserGeometry = useCallback((nodeId: string): void => {
    if (materialInsertionCentersRef.current.has(nodeId)) materialGeometryEpochRef.current.set(nodeId, (materialGeometryEpochRef.current.get(nodeId) ?? 0) + 1);
  }, []);
  const noteChangedMaterialGeometry = useCallback((before: WorkflowData, after: WorkflowData): void => {
    for (const nodeId of materialInsertionCentersRef.current.keys()) {
      const oldNode = before.nodes.find(node => node.id === nodeId), newNode = after.nodes.find(node => node.id === nodeId);
      if (!oldNode || !newNode || oldNode.x !== newNode.x || oldNode.y !== newNode.y || oldNode.width !== newNode.width || oldNode.height !== newNode.height) noteMaterialUserGeometry(nodeId);
    }
  }, [noteMaterialUserGeometry]);
  const [nodePromptPresets, setNodePromptPresets] = useState<{ id: string; name: string; text: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('wujie-node-presets') || '[]') as { id: string; name: string; text: string }[];
    } catch {
      return [];
    }
  });
  const workflowRendererMode = resolveWorkflowRendererMode(rendererMode);
  const broadcastWorkflow = useCallback((updatedWf: WorkflowData) => {
    if (!bcRef.current) return;
    if (bcDebounceRef.current) clearTimeout(bcDebounceRef.current);
    bcDebounceRef.current = setTimeout(() => {
      bcIgnoreRef.current = true;
      bcRef.current?.postMessage({ type: 'workflow-update', wf: updatedWf, source: 'tab' });
    }, 500);
  }, []);
  const updateWorkflow = useCallback((updater: WorkflowData | ((prev: WorkflowData) => WorkflowData)) => {
    const current = wfRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (next === current) return;
    noteChangedMaterialGeometry(current, next);
    wfRef.current = next;
    dispatchWorkflowEditorTransition({
      kind: 'user.update',
      workflow: next,
      transactionId: `editor-change:${++editorTransactionCounterRef.current}`,
    });
  }, [noteChangedMaterialGeometry]);
  const updateWorkflowSystem = useCallback((updater: (prev: WorkflowData) => WorkflowData) => {
    const workflow = updater(wfRef.current);
    if (workflow === wfRef.current) return;
    wfRef.current = workflow;
    dispatchWorkflowEditorTransition({ kind: 'system.update', workflow });
  }, []);
  const dispatchWorkflowStateCommand = useCallback((command: WorkflowInteractionCommand): WorkflowCommandResult => {
    const before = wfRef.current;
    const result = applyWorkflowCommand(before, command);
    if (command.type !== 'node.measure') noteChangedMaterialGeometry(before, result.workflow);
    wfRef.current = result.workflow;
    dispatchWorkflowEditorTransition({ kind: 'command', command });
    return result;
  }, [noteChangedMaterialGeometry]);
  const saveNodePromptPreset = useCallback((name: string, text: string) => {
    if (!name.trim() || !text.trim()) return;
    setNodePromptPresets(previous => {
      const next = [...previous, { id: `p-${Date.now()}`, name: name.trim(), text }];
      localStorage.setItem('wujie-node-presets', JSON.stringify(next));
      return next;
    });
  }, []);
  const deleteNodePromptPreset = useCallback((presetId: string) => {
    setNodePromptPresets(previous => {
      const next = previous.filter(preset => preset.id !== presetId);
      localStorage.setItem('wujie-node-presets', JSON.stringify(next));
      return next;
    });
  }, []);
  const lastBroadcastRevisionRef = useRef(workflowEditorState.broadcastRevision);
  useEffect(() => {
    if (lastBroadcastRevisionRef.current === workflowEditorState.broadcastRevision) return;
    lastBroadcastRevisionRef.current = workflowEditorState.broadcastRevision;
    broadcastWorkflow(wf);
  }, [broadcastWorkflow, wf, workflowEditorState.broadcastRevision]);
  const [workflowSyncRevision, setWorkflowSyncRevision] = useState(0);

  // BroadcastChannel 接收端
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('wujie-workflow-sync');
    bcRef.current = bc;
    bc.onmessage = (e: MessageEvent) => {
      if (bcIgnoreRef.current) { bcIgnoreRef.current = false; return; }
      const msg = e.data as { type: string; wf: WorkflowData; source: string };
      if (msg.type === 'workflow-update' && msg.wf) {
        dispatchWorkflowStateCommand({
          type: 'workflow.hydrate',
          workflow: msg.wf,
          transactionId: 'broadcast-workflow-hydrate',
        });
      }
    };
    return () => { bc.close(); bcRef.current = null; };
  }, [dispatchWorkflowStateCommand]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  // 兼容：获取单个选中节点ID
  const selectedNodeId = useMemo(() => selectedNodeIds.size > 0 ? [...selectedNodeIds][0] : null, [selectedNodeIds]);
  const lastEmittedRef = useRef<WorkflowData | null>(null);
  const aiBuildExternalWorkflowRef = useRef(workflow);
  if (aiBuildExternalWorkflowRef.current !== workflow) {
    aiBuildExternalWorkflowRef.current = workflow;
    if (workflow !== lastEmittedRef.current) aiBuildContentEpochRef.current += 1;
  }
  const hydrateExternalWorkflow = useCallback((externalWorkflow: WorkflowData) => {
    dispatchWorkflowStateCommand({
      type: 'workflow.hydrate',
      workflow: externalWorkflow,
      transactionId: 'external-workflow-hydrate',
    });
  }, [dispatchWorkflowStateCommand]);
  const applyDeferredExternalWorkflow = useCallback((
    externalWorkflow: WorkflowData,
    positions: WorkflowNodePosition[],
  ) => {
    updateWorkflowSystem(() => mergeExternalWorkflowWithPositions(externalWorkflow, positions));
  }, [updateWorkflowSystem]);
  const {
    isDraggingRef,
    beginWorkflowDrag,
    finishWorkflowDrag,
  } = useWorkflowDragSynchronization({
    externalWorkflow: workflow,
    lastEmittedWorkflowRef: lastEmittedRef,
    hydrateWorkflow: hydrateExternalWorkflow,
    applyDeferredWorkflow: applyDeferredExternalWorkflow,
  });
  // 拖动状态使用ref避免每次mousemove触发重渲染导致闪烁
  const draggingNodeRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const nodeDragInitialPositionsRef = useRef<Array<{ nodeId: string; position: { x: number; y: number } }>>([]);
  const nodeDragPositionRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const nodeDragRafRef = useRef<number | null>(null);
  const legacyNodePointerRef = useRef<{
    pointerId: number; pointerType: string; owner: HTMLElement; scope: string;
    clientX: number; clientY: number; moved: boolean;
  } | null>(null);
  const [legacyPropertiesDeferred, setLegacyPropertiesDeferred] = useState(false);
  const legacyPointerScope = JSON.stringify([userId, projectId, workflow?.id ?? wf.id, canvasDocumentMode]);
  const legacyPointerScopeRef = useRef(legacyPointerScope);
  legacyPointerScopeRef.current = legacyPointerScope;
  const [draggingConn, setDraggingConn] = useState<DraggingConn | null>(null);
  const draggingConnRef = useRef<DraggingConn | null>(null);
  const connectionScopeRef = useRef<string | null>(null);
  const legacyMobileOptionsRef = useRef<LegacyMobilePointerOptions | null>(null);
  const legacyMobilePointerRef = useRef<LegacyMobilePointerController | null>(null);
  const [portListOpen, setPortListOpen] = useState(false);
  const [portListSource, setPortListSource] = useState<{ endpoint: LegacyPortEndpoint; type: PortType; scope: string } | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.8 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, vx: 0, vy: 0 });
  const nodeViewportTransformRef = useRef<HTMLDivElement>(null);
  const svgViewportTransformRef = useRef<SVGGElement>(null);
  const nodePanPreviewRef = useRef(viewport);
  const nodePanRafRef = useRef<number | null>(null);
  const nodePanViewportSyncAtRef = useRef(0);
  const [nodePanViewport, setNodePanViewport] = useState(viewport);
  const nodeWheelDeltaRef = useRef(0);
  const nodeWheelRafRef = useRef<number | null>(null);
  const [nodeViewportSize, setNodeViewportSize] = useState({ width: 0, height: 0 });
  const [sidebarTab, setSidebarTab] = useState<'nodes' | 'props' | 'ai-build' | 'presets' | 'prompts' | 'assistant' | 'material' | 'prompt'>('nodes');
  const [pendingPreset, setPendingPreset] = useState<{ preset: WorkflowPreset; scope: string } | null>(null);
  useEffect(() => { setPendingPreset(null); }, [projectId, userId, wf.id]);
  const [searchQuery, setSearchQuery] = useState('');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const executionIdRef = useRef(executionId);
  executionIdRef.current = executionId;
  const [execStatus, setExecStatus] = useState<'idle' | 'running' | 'paused' | 'completed' | 'failed'>('idle');
  const [executionNodeIds, setExecutionNodeIds] = useState<string[]>([]);
  const executionNodeIdsRef = useRef(executionNodeIds);
  executionNodeIdsRef.current = executionNodeIds;
  const [skillEstimating, setSkillEstimating] = useState(false);
  const [skillQuote, setSkillQuote] = useState<{
    scope: WorkflowExecutionScope; quotes: WorkflowSkillQuote[]; projectId: string; expiresAt: number;
  } | null>(null);
  const skillQuoteReturnFocusRef = useRef<HTMLElement | null>(null);
  const skillEstimateController = useRef<AbortController | null>(null);
  const skillExecutionLock = useRef(false);
  const skillWorkflowRef = useRef(wf);
  skillWorkflowRef.current = wf;
  useEffect(() => {
    setSkillQuote(null);
    return () => skillEstimateController.current?.abort();
  }, [projectId]);
  useEffect(() => {
    if (skillQuote && !isWorkflowExecutionScopeCurrent(skillQuote.scope, wf.nodes, wf.connections)) {
      setSkillQuote(null);
    }
  }, [skillQuote, wf.connections, wf.nodes]);
  const [execResults, setExecResults] = useState<Record<string, { status: string; output?: Record<string, unknown>; error?: string }>>({});
  const execResultsRef = useRef(execResults);
  execResultsRef.current = execResults;
  const imageRetryViewRef = useRef<WorkflowImageRetryView | null>(null);
  const imageRetryRequestRef = useRef<{ controller: AbortController; epoch: number } | null>(null);
  const imageRetryEpochRef = useRef(0);
  const [skillObservationRevision, setSkillObservationRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showMinimap, setShowMinimap] = useState(false);
  const minimapToggleRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const syncMinimapDefault = (): void => {
      if (!media.matches) {
        const toggle = minimapToggleRef.current;
        const map = toggle?.closest('.node-editor-root')?.querySelector('[data-workflow-minimap]');
        if (toggle && map?.contains(toggle.ownerDocument.activeElement)) toggle.focus();
      }
      setShowMinimap(media.matches);
    };
    syncMinimapDefault();
    media.addEventListener('change', syncMinimapDefault);
    return (): void => media.removeEventListener('change', syncMinimapDefault);
  }, []);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === 'undefined') return;
    let resizeFrame: number | null = null;
    const keepFocusedControlVisible = (): void => {
      resizeFrame = null;
      const active = toolbar.ownerDocument.activeElement;
      if (!(active instanceof HTMLElement) || !toolbar.contains(active)) return;
      const control = active.getBoundingClientRect();
      const bounds = toolbar.getBoundingClientRect();
      const width = toolbar.clientWidth;
      if (width <= 0 || control.width <= 0) return;
      const left = bounds.left + toolbar.clientLeft;
      const right = left + width;
      const shift = control.width > width
        ? Math.floor(control.left - left)
        : control.left < left
          ? Math.floor(control.left - left) - 2
          : control.right > right ? Math.ceil(control.right - right) + 2 : 0;
      if (shift !== 0) toolbar.scrollLeft += shift;
    };
    const observer = new ResizeObserver(() => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(keepFocusedControlVisible);
    });
    observer.observe(toolbar);
    return (): void => {
      observer.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    };
  }, []);
  const minimapPointer = useMemo(createMinimapPointerTracker, []);
  useEffect(() => {
    window.addEventListener('pointerdown', minimapPointer.clear, true);
    window.addEventListener('blur', minimapPointer.clear);
    return (): void => {
      window.removeEventListener('pointerdown', minimapPointer.clear, true);
      window.removeEventListener('blur', minimapPointer.clear);
      minimapPointer.clear();
    };
  }, [minimapPointer]);
  useEffect(() => { minimapPointer.clear(); }, [minimapPointer, showMinimap]);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePreviewDownloadState, setImagePreviewDownloadState] = useState<'idle' | 'downloading' | 'error'>('idle');
  const [compareImages, setCompareImages] = useState<{ before: string; after: string } | null>(null);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const workflowInputTransferGuardRef = useRef(createWorkflowInputTransferGuard());
  const workflowInputScopeRef = useRef<string>('');
  const workflowInputScope = JSON.stringify([userId, projectId, wf.id, canvasDocumentMode]);
  if (workflowInputScopeRef.current !== workflowInputScope) {
    workflowInputScopeRef.current = workflowInputScope;
    // Replacing the guard makes every in-flight response from the previous scope stale.
    workflowInputTransferGuardRef.current = createWorkflowInputTransferGuard();
  }
  useEffect(() => () => {
    workflowInputScopeRef.current = '';
    workflowInputTransferGuardRef.current = createWorkflowInputTransferGuard();
  }, []);
  const sketchScope = useMemo<SketchScope>(() => ({ actorId: userId || '', projectId: projectId || '', key: workflowInputScope,
    authority: userId && projectId ? canvasDocumentMode ? 'document' : 'legacy' : 'unknown',
    assertCurrent: (write?: boolean) => {
      if (workflowInputScopeRef.current !== workflowInputScope || !userId || !projectId) throw new Error('项目已切换或授权未知，请在当前项目核对');
      if (write && canvasDocumentMode) throw new Error(DOCUMENT_PLACEMENT_REASON);
    } }), [userId, projectId, canvasDocumentMode, workflowInputScope]);

  const [gridClientView, setGridClientView] = useState<WorkflowGridClientView>({ phase: 'idle', message: '', canRetry: false });
  const gridClientScopeRef = useRef({ actorId: userId || '', projectId: projectId || '', workflowId: wf.id, documentMode: canvasDocumentMode });
  gridClientScopeRef.current = { actorId: userId || '', projectId: projectId || '', workflowId: wf.id, documentMode: canvasDocumentMode };
  const gridClientRef = useRef<WorkflowGridClient | null>(null);
  if (!gridClientRef.current) {
    gridClientRef.current = createWorkflowImageGridClient({
      snapshot: () => ({ ...gridClientScopeRef.current, workflow: wfRef.current, results: execResultsRef.current }),
      guard: () => workflowInputTransferGuardRef.current,
      fetcher: (input, init) => fetch(input, init),
      apply: updateWorkflow,
      onView: setGridClientView,
    });
  }
  useEffect(() => {
    const client = gridClientRef.current!;
    client.reset();
    setGridClientView({ phase: 'idle', message: '', canRetry: false });
    return () => client.reset();
  }, [workflowInputScope]);

  const toggleNodeCollapse = useCallback((nodeId: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  }, []);
  const [highlightNodeId, setHighlightNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // P2: build_mode检测 — 生产环境禁用部分开发功能
  const isBuildMode = typeof process !== 'undefined' && process.env?.COZE_PROJECT_ENV === 'PROD';

  // AI建图状态
  const [aiBuildInput, setAiBuildInput] = useState('');
  const [aiBuildLoading, setAiBuildLoading] = useState(false);
  const [aiBuildError, setAiBuildError] = useState<string | null>(null);
  const [aiBuildOpen, setAiBuildOpen] = useState(false);
  const aiBuildScope = JSON.stringify([userId, projectId, workflow?.id ?? null, wf.id, canvasDocumentMode]);
  const aiBuildScopeRef = useRef({ key: aiBuildScope, epoch: 0 });
  if (aiBuildScopeRef.current.key !== aiBuildScope) {
    aiBuildScopeRef.current = { key: aiBuildScope, epoch: aiBuildScopeRef.current.epoch + 1 };
  }
  const aiBuildEpochRef = useRef(0);
  const aiBuildPendingRef = useRef(false);
  const aiBuildMountedRef = useRef(true);
  useEffect(() => {
    aiBuildMountedRef.current = true;
    return () => { aiBuildMountedRef.current = false; aiBuildEpochRef.current += 1; };
  }, []);
  const closeAiBuild = useCallback(() => {
    aiBuildEpochRef.current += 1;
    setAiBuildOpen(false);
  }, []);

  // P1: 执行日志
  const [execLogs, setExecLogs] = useState<WorkflowExecutionLog[]>([]);
  const execLogsRef = useRef(execLogs);
  execLogsRef.current = execLogs;

  const executionViewScope = JSON.stringify([userId, projectId, wf.id]);
  const executionViewScopeRef = useRef(executionViewScope);
  executionViewScopeRef.current = executionViewScope;
  const previousExecutionViewScope = useRef(executionViewScope);
  useEffect(() => {
    imageRetryEpochRef.current += 1;
    return () => {
      imageRetryEpochRef.current += 1;
      imageRetryRequestRef.current?.controller.abort();
      imageRetryRequestRef.current = null;
      imageRetryViewRef.current = null;
    };
  }, [executionViewScope]);
  useEffect(() => {
    if (previousExecutionViewScope.current === executionViewScope) return;
    previousExecutionViewScope.current = executionViewScope;
    setExecResults({});
    setExecLogs([]);
    setExecutionNodeIds([]);
    setExecutionId(null);
    setExecStatus('idle');
  }, [executionViewScope]);
  // Unscoped legacy entries are preserved but cannot identify a safe restoration target.
  const WORKFLOW_EXEC_STATE_KEY = `wujie_workflow_exec_state:v2:${executionViewScope}`;
  useEffect(() => {
    if (!userId || !projectId) return;
    try {
      const saved = localStorage.getItem(WORKFLOW_EXEC_STATE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        const retryView = readWorkflowImageRetryView(state.imageRetry, state.executionId);
        if (Object.hasOwn(state, 'imageRetry') && !retryView) return;
        if (state.executionId && (['running', 'paused'].includes(state.execStatus)
          || retryView && ['completed', 'failed'].includes(state.execStatus))) {
          imageRetryViewRef.current = retryView;
          const restoredStatus = retryView?.pending ? 'paused'
            : retryView?.active && ['completed', 'failed'].includes(state.execStatus) ? 'running' : state.execStatus;
          const restoredLogs = (Array.isArray(state.execLogs) ? state.execLogs : []).map((log: WorkflowExecutionLog) =>
            retryView?.pending?.nodeId === log.nodeId ? { ...log, status: 'error', message: '重试回执待核对，请重试原节点' } : log);
          setExecutionId(state.executionId);
          setExecStatus(restoredStatus);
          setExecLogs(restoredLogs);
          const safeResults = safeSketchExecutionResults(state.execResults || {}, wfRef.current.nodes);
          setExecResults(safeResults);
          setExecutionNodeIds(Array.isArray(state.nodeIds) ? state.nodeIds : Object.keys(state.execResults || {}));
          if (retryView || JSON.stringify(safeResults) !== JSON.stringify(state.execResults || {})) {
            localStorage.setItem(WORKFLOW_EXEC_STATE_KEY, JSON.stringify({ ...state, execStatus: restoredStatus,
              execResults: safeResults, execLogs: restoredLogs, ...(retryView ? { imageRetry: retryView } : {}) }));
          }
          // The approval request can return before its child finishes. Keep
          // this receipt until a terminal status even across multiple reloads.
          if (state.execStatus === 'running' && !retryView && !Object.values(safeResults).some(result =>
            result.status === 'waiting-approval' && typeof result.output?.runId === 'string')) {
            localStorage.removeItem(WORKFLOW_EXEC_STATE_KEY);
          }
        }
      }
    } catch {}
  }, [WORKFLOW_EXEC_STATE_KEY, userId, projectId]);
  const persistImageRetryState = useCallback((id: string, status: 'running' | 'paused' | 'completed' | 'failed',
    results = execResultsRef.current, logs = execLogsRef.current): void => {
    const retryView = imageRetryViewRef.current;
    if (!retryView) return;
    try {
      localStorage.setItem(WORKFLOW_EXEC_STATE_KEY, JSON.stringify({ executionId: id, execStatus: status,
        execResults: results, execLogs: logs, nodeIds: executionNodeIdsRef.current, imageRetry: retryView }));
    } catch {
      setExecLogs(previous => mergeExecutionLogs(previous, [{ time: Date.now(), nodeId: 'workflow', label: '任务记录',
        status: 'error', message: '浏览器未能保存重试记录，请在刷新前保留当前任务信息' }]));
    }
  }, [WORKFLOW_EXEC_STATE_KEY]);
  const setImageRetryLog = useCallback((nodeId: string, status: string, message: string): WorkflowExecutionLog[] => {
    const entry: WorkflowExecutionLog = { time: Date.now(), nodeId, label: wfRef.current.nodes.find(node => node.id === nodeId)?.label || nodeId, status, message };
    const previous = execLogsRef.current;
    const logs = previous.some(log => log.nodeId === nodeId)
      ? previous.map(log => log.nodeId === nodeId ? { ...log, ...entry } : log) : [...previous, entry];
    execLogsRef.current = logs; setExecLogs(logs); return logs;
  }, []);
  const pauseImageRetry = useCallback((id: string, epoch: number, message: string): void => {
    const retryView = imageRetryViewRef.current;
    if (epoch !== imageRetryEpochRef.current || retryView?.active?.executionId !== id) return;
    const logs = setImageRetryLog(retryView.active.nodeId, 'error', message);
    setExecStatus('paused'); persistImageRetryState(id, 'paused', execResultsRef.current, logs);
  }, [persistImageRetryState, setImageRetryLog]);
  const applyImageRetrySnapshot = useCallback((raw: unknown, id: string, epoch: number): boolean => {
    const retryView = imageRetryViewRef.current, active = retryView?.active;
    if (epoch !== imageRetryEpochRef.current || !retryView || active?.executionId !== id) return true;
    const snapshot = readWorkflowImageRetrySnapshot(raw, id, active.nodeId);
    const result: WorkflowImageRetryResult = snapshot.result || { status: snapshot.status === 'paused' ? 'paused' : 'running' };
    const results = { ...execResultsRef.current, [active.nodeId]: result };
    execResultsRef.current = results; setExecResults(results);
    const message = result.error || snapshot.error || (snapshot.status === 'paused' ? '结果待核对'
      : result.status === 'success' ? '重试成功' : snapshot.status === 'running' ? '重试中...' : '重试未完成');
    const logStatus = ['failed', 'error', 'cancelled', 'timeout'].includes(result.status) ? 'error'
      : result.status === 'success' ? 'success' : snapshot.status === 'paused' ? 'error' : 'running';
    const logs = setImageRetryLog(active.nodeId, logStatus, message);
    if (['completed', 'failed', 'cancelled'].includes(snapshot.status)) {
      imageRetryViewRef.current = finishWorkflowImageRetry(retryView);
      const failed = snapshot.status !== 'completed' || Object.values(results).some(entry => ['failed', 'error', 'cancelled', 'timeout'].includes(entry.status));
      const status = failed ? 'failed' : 'completed';
      setExecStatus(status); persistImageRetryState(id, status, results, logs); return true;
    }
    setExecStatus(snapshot.status === 'paused' ? 'paused' : 'running');
    persistImageRetryState(id, snapshot.status === 'paused' ? 'paused' : 'running', results, logs);
    return snapshot.status === 'paused';
  }, [persistImageRetryState, setImageRetryLog]);
  const [showContentStrip, setShowContentStrip] = useState(true);
  const [compactContentExpanded, setCompactContentExpanded] = useState(false);
  const [portLegendExpanded, setPortLegendExpanded] = useState(false);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const closeDirectoryOnMobile = useCallback((): void => {
    if (window.matchMedia('(max-width: 767px)').matches) setShowLeftPanel(false);
  }, []);
  const [showExecLog, setShowExecLog] = useState(false);
  const executionDockRef = useRef<HTMLDivElement>(null);
  const executionLogPanelRef = useRef<HTMLDivElement>(null);
  useEffect((): void | (() => void) => {
    const dock = executionDockRef.current;
    const log = executionLogPanelRef.current;
    if (!showExecLog || !dock || !log) return;
    let disposed = false;
    let dockRevealFrame = 0;
    const revealLog = (): void => {
      if (disposed) return;
      cancelAnimationFrame(dockRevealFrame);
      dockRevealFrame = requestAnimationFrame((): void => {
        if (disposed || !window.matchMedia('(max-height: 400px)').matches
          || dock.clientHeight <= 0 || dock.scrollHeight <= dock.clientHeight) return;
        const dockBounds = dock.getBoundingClientRect();
        const logBounds = log.getBoundingClientRect();
        const visibleTop = dockBounds.top + dock.clientTop;
        const visibleBottom = visibleTop + dock.clientHeight;
        const logBottom = logBounds.top + Math.min(logBounds.height, dock.clientHeight);
        const delta = logBounds.top < visibleTop ? logBounds.top - visibleTop
          : logBottom > visibleBottom ? logBottom - visibleBottom : 0;
        if (Number.isFinite(delta) && delta !== 0) dock.scrollTop += delta;
      });
    };
    const observer = new ResizeObserver(revealLog);
    observer.observe(dock);
    revealLog();
    return (): void => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(dockRevealFrame);
    };
  }, [showExecLog]);
  const savedSkillRunKey = JSON.stringify(wf.nodes.filter(node => node.type === 'ai-skill' && node.config.runId)
    .map(node => [node.id, node.config.runId, node.config.skillId, node.config.version]));
  useEffect(() => {
    if (!projectId || execStatus === 'running') return;
    const lifecycle = new AbortController();
    let disposed = false;
    let observerTimer: ReturnType<typeof setTimeout> | undefined;
    const nodes = skillWorkflowRef.current.nodes.filter(node => node.type === 'ai-skill' && typeof node.config.runId === 'string');
    setExecResults(previous => {
      const stale = nodes.filter(node => previous[node.id]?.output?.runId
        && previous[node.id].output?.runId !== node.config.runId);
      if (stale.length === 0) return previous;
      const next = { ...previous };
      for (const node of stale) delete next[node.id];
      return next;
    });
    const observe = async (pendingNodes: WorkflowNode[]) => {
      const stillActive: WorkflowNode[] = [];
      for (const node of pendingNodes) {
        if (disposed) break;
        const controller = new AbortController();
        const abort = () => controller.abort();
        lifecycle.signal.addEventListener('abort', abort, { once: true });
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, 15_000);
        const runId = String(node.config.runId);
        try {
          const result = await loadSavedWorkflowSkillResult({
            runId, projectId, workflowId: wf.id, skillId: String(node.config.skillId),
            skillVersion: Number(node.config.version), signal: controller.signal,
          });
          if (controller.signal.aborted || skillWorkflowRef.current.nodes.find(item => item.id === node.id)?.config.runId !== runId) continue;
          setExecResults(previous => ({ ...previous, [node.id]: result }));
          if (['running', 'paused'].includes(result.status)) {
            stillActive.push(node);
          }
        } catch (error) {
          if (disposed || (controller.signal.aborted && !timedOut)) break;
          if (timedOut) stillActive.push(node);
          setExecLogs(previous => mergeExecutionLogs(previous, [{ time: Date.now(), nodeId: node.id, label: node.label,
            status: 'error', message: timedOut ? 'Skill 结果恢复超时，正在重试，不会重新生成或扣费'
              : error instanceof Error ? error.message : 'Skill 结果恢复失败' }]));
          setShowExecLog(true);
        } finally {
          clearTimeout(timeout);
          lifecycle.signal.removeEventListener('abort', abort);
        }
      }
      if (!disposed && stillActive.length > 0) {
        observerTimer = setTimeout(() => { void observe(stillActive); }, 2_000);
      }
    };
    void observe(nodes);
    return () => { disposed = true; lifecycle.abort(); clearTimeout(observerTimer); };
  }, [projectId, userId, wf.id, savedSkillRunKey, execStatus, skillObservationRevision]);
  const [clipboard, setClipboard] = useState<WorkflowClipboardSnapshot | null>(null);
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<WorkflowMenuLocation | null>(null);
  const [nodeAnnotationSession, setNodeAnnotationSession] = useState<NodeAnnotationSession | null>(null);
  const [nodeAnnotationError, setNodeAnnotationError] = useState<string | null>(null);
  const [blockedNodeRetryNotice, setBlockedNodeRetryNotice] = useState(false);
  const workflowInputActorRetries = useRef(new Map<string, { guard: ReturnType<typeof createWorkflowInputTransferGuard> }>());
  const [workflowInputActorSourceChanged, setWorkflowInputActorSourceChanged] = useState<string | null>(null);
  const [workflowInputActorReselectNode, setWorkflowInputActorReselectNode] = useState<string | null>(null);
  const [nodeAnnotationCandidates, setNodeAnnotationCandidates] = useState<NodeAnnotationCandidatePicker | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const applyMobileLayout = () => {
      if (!media.matches) return;
      setShowLeftPanel(false);
    };

    applyMobileLayout();
    media.addEventListener('change', applyMobileLayout);
    return () => media.removeEventListener('change', applyMobileLayout);
  }, []);

  // P2: 提示词库 - 使用统一的提示词模板系统
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>(() => getPromptTemplates());
  const [, setPromptSnippets] = useState<PromptSnippet[]>(() => {
    try {
      // 同时兼容旧的提示词库数据
      const oldSnippets: PromptSnippet[] = (() => { try { return JSON.parse(localStorage.getItem('wujie-prompt-snippets') || '[]'); } catch { return []; } })();
      // 合并：模板优先，旧数据补充
      const fromTemplates: PromptSnippet[] = promptTemplates.map(t => ({
        id: t.id,
        text: t.content,
        tags: t.tags,
        category: t.category,
        createdAt: t.createdAt,
      }));
      const fromOld = oldSnippets.filter(s => !fromTemplates.some(t => t.id === s.id));
      return [...fromTemplates, ...fromOld];
    } catch { return []; }
  });
  const [, ] = useState('');
  const [, ] = useState('');
  const [, ] = useState('');
  const [, ] = useState('通用');

  // P2: 撤销重做由命令事务直接驱动，避免 effect 和拖拽手工快照双写。
  const historyStack = workflowEditorState.history.entries;
  const historyIndex = workflowEditorState.history.index;
  const handleCascadeRunRef = useRef<(nodeId: string) => Promise<void>>(async () => {});
  const handleDeleteNodeRef = useRef<(nodeId: string) => void>(() => {});
  const getPortPositionLocalRef = useRef<(node: WorkflowNode, port: NodePort) => { x: number; y: number } | null>(() => null);

  // P2: 画布助手 (节点感知)
  const [, setAssistantMessages] = useState<{ role: 'user' | 'assistant'; content: string; suggestions?: { text: string; action: string }[] }[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [, setAssistantLoading] = useState(false);

  // P2: JSON编辑器
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);
  const [jsonEditContent, setJsonEditContent] = useState('');
  const [jsonEditorError, setJsonEditorError] = useState<string | null>(null);
  const jsonDialogRef = useRef<HTMLDivElement>(null);
  const jsonInputRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (!jsonEditorOpen) return;
    const dialog = jsonDialogRef.current;
    if (!dialog) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusInput = (): void => {
      (jsonInputRef.current ?? dialog).focus({ preventScroll: true });
    };
    const containFocus = (event: FocusEvent): void => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusInput();
    };
    const handleModalKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setJsonEditorOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
      )).filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) {
        event.preventDefault();
        focusInput();
      } else if (!dialog.contains(document.activeElement)
        || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', containFocus);
    document.addEventListener('keydown', handleModalKeyDown, true);
    focusInput();
    return () => {
      document.removeEventListener('focusin', containFocus);
      document.removeEventListener('keydown', handleModalKeyDown, true);
      const active = document.activeElement;
      if (returnFocus?.isConnected && (active === document.body || dialog.contains(active))) {
        returnFocus.focus({ preventScroll: true });
      }
    };
  }, [jsonEditorOpen]);


  // P2: 撤销/重做函数
  const invalidateBlockedInputTransfers = useCallback((direction: 'undo' | 'redo') => {
    const history = workflowEditorState.history;
    if (direction === 'undo' ? history.index <= 0 : history.index >= history.entries.length) return;
    const current = wfRef.current;
    const next = direction === 'undo'
      ? undoWorkflowCommandHistory(history, current).workflow
      : redoWorkflowCommandHistory(history, current).workflow;
    const transferIdentity = (node: WorkflowNode): string => {
      const config = node.config;
      return JSON.stringify([config.source, config.imageUrl, config.sourceImageId, config.sourceVersionId,
        config.projectId, config.assetId, config.assetVersionId, config.placementId,
        config.assetTransferPending, config.assetTransferError, config.assetTransferExpectedActorId, config.assetTransferExpectedProjectId,
        config.assetTransferExpectedSource]);
    };
    for (const node of wfRef.current.nodes) {
      if (node.type === 'input-image' && node.config.assetTransferPending === true
        && (node.config.assetTransferError === 'ACTOR_SCOPE_CHANGED' || node.config.assetTransferError === 'TRANSFER_INTERRUPTED')) {
        const restored = next.nodes.find(item => item.id === node.id);
        if (!restored || restored.type !== 'input-image' || transferIdentity(node) !== transferIdentity(restored)) {
          workflowInputTransferGuardRef.current.invalidate(node.id);
          workflowInputActorRetries.current.delete(JSON.stringify([workflowInputScope, node.id]));
        }
      }
    }
  }, [workflowEditorState.history, workflowInputScope]);
  const handleUndo = useCallback(() => {
    invalidateBlockedInputTransfers('undo');
    dispatchWorkflowEditorTransition({ kind: 'history.undo' });
  }, [invalidateBlockedInputTransfers]);

  const handleRedo = useCallback(() => {
    invalidateBlockedInputTransfers('redo');
    dispatchWorkflowEditorTransition({ kind: 'history.redo' });
  }, [invalidateBlockedInputTransfers]);

  // P2: 保存提示词到库 - 同时保存到统一的提示词模板系统
  useCallback((text: string, tags: string[], category: string) => {
        const snippet: PromptSnippet = { id: `ps-${Date.now()}`, text, tags, category, createdAt: Date.now() };
        // 保存到统一的提示词模板系统（顶层 import，避免客户端 require）
        const template = addPromptTemplate({
          name: text.slice(0, 30) + (text.length > 30 ? '...' : ''),
          content: text,
          category,
          tags,
          createdBy: 'user',
          isGlobal: false,
        });
        setPromptTemplates(previous => [...previous, template]);
        // 同时保存到旧的存储（向后兼容）
        setPromptSnippets(prev => {
          const next = [...prev, snippet];
          localStorage.setItem('wujie-prompt-snippets', JSON.stringify(next));
          return next;
        });
      }, []);

  // P2: 画布助手发送消息 (P1增强: 上游节点自动引用 + P0增强: 意图分类+操作执行+建议)
  useCallback(async () => {
        if (!assistantInput.trim()) return;
        const userMsg = assistantInput.trim();
        setAssistantInput('');
        setAssistantMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setAssistantLoading(true);
        try {
          const node = wf.nodes.find(n => n.id === selectedNodeId);
          // P1: 自动遍历上游节点构建上下文
          let contextInfo = '';
          if (node) {
            const upstreamChain: string[] = [];
            const visited = new Set<string>();
            const queue = [node.id];
            visited.add(node.id);
            while (queue.length > 0) {
              const currentId = queue.shift()!;
              const upstreamConns = wf.connections.filter(c => c.toNodeId === currentId);
              for (const conn of upstreamConns) {
                if (!visited.has(conn.fromNodeId)) {
                  visited.add(conn.fromNodeId);
                  const upNode = wf.nodes.find(n => n.id === conn.fromNodeId);
                  if (upNode) {
                    upstreamChain.push(`  → [${upNode.type}] ${upNode.label}: ${JSON.stringify(upNode.config).slice(0, 150)}`);
                    queue.push(conn.fromNodeId);
                  }
                }
              }
            }
            contextInfo = `当前选中节点: [${node.type}] ${node.label}, 配置: ${JSON.stringify(node.config).slice(0, 200)}`;
            if (upstreamChain.length > 0) {
              contextInfo += `\n上游节点链路:\n${upstreamChain.join('\n')}`;
            }
          } else {
            contextInfo = '未选中任何节点';
          }

          // P0增强: 检测操作意图并执行
          const operationKeywords = {
            execute: ['执行', '运行', '跑一下', '生成', '开始'],
            connect: ['连接', '连线', '接到', '连到'],
            add: ['添加', '新增', '创建', '增加', '加一个'],
            delete: ['删除', '移除', '去掉', '删掉'],
            modify: ['修改', '改一下', '调整', '设置', '配置']
          };

          let detectedOperation: string | null = null;
          for (const [op, keywords] of Object.entries(operationKeywords)) {
            if (keywords.some(kw => userMsg.toLowerCase().includes(kw))) {
              detectedOperation = op;
              break;
            }
          }

          // 如果检测到操作意图，先执行操作再回复
          if (detectedOperation && node) {
            let operationResult = '';
            switch (detectedOperation) {
              case 'execute':
                // 执行当前选中的节点（级联执行选中节点的下游链路）
                void handleCascadeRunRef.current(node.id);
                operationResult = `已触发执行节点 "${node.label}"，请在工作流执行面板查看进度。`;
                break;
              case 'add': {
                // 解析要添加的节点类型
                const nodeTypeKeywords: Record<string, string> = {
                  '生成': 'ai-generate', '图像': 'ai-generate', '图片': 'ai-generate',
                  '视频': 'ai-video-generate', '音频': 'ai-audio',
                  '文字': 'input-text', '输入': 'input-text', '提示词': 'input-text',
                  '条件': 'condition', '循环': 'loop',
                  '输出': 'output-image', '导出': 'output-export'
                };
                let newNodeType = 'ai-generate' as NodeType;
                for (const [kw, type] of Object.entries(nodeTypeKeywords)) {
                  if (userMsg.includes(kw)) {
                    newNodeType = type as NodeType;
                    break;
                  }
                }
                // 在选中节点右侧创建新节点
                const newNode = createWorkflowNode(newNodeType, node.x + node.width + 80, node.y);
                const selOutPort = node.ports.find(p => p.direction === 'out');
                const newInPort = newNode.ports.find(p => p.direction === 'in');
                const autoConn = (selOutPort && newInPort && canConnectPorts(selOutPort.type, newInPort.type))
                  ? [createConnection(node.id, selOutPort.id, newNode.id, newInPort.id, selOutPort.type)]
                  : [];
                updateWorkflow(prev => ({
                  ...prev,
                  nodes: [...prev.nodes, newNode],
                  connections: [...prev.connections, ...autoConn],
                }));
                setSelectedNodeIds(new Set([newNode.id]));
                operationResult = `已添加新节点 [${NODE_TYPE_LABELS[newNodeType] || newNodeType}] 并自动连线，可在右侧属性面板编辑配置。`;
                break;
              }
              case 'delete': {
                const nodeLabel = node.label;
                handleDeleteNodeRef.current(node.id);
                setSelectedNodeIds(new Set());
                operationResult = `已删除节点 "${nodeLabel}" 及其所有连线。`;
                break;
              }
              default:
                operationResult = `已识别操作意图: ${detectedOperation}，请确认具体参数。`;
            }
            setAssistantMessages(prev => [...prev, {
              role: 'assistant',
              content: `✅ ${operationResult}\n\n有什么其他需要帮助的吗？`,
              suggestions: [
                { text: '执行整个工作流', action: 'execute-all' },
                { text: '查看节点配置', action: 'view-config' },
                { text: '继续对话', action: 'chat' }
              ]
            }]);
            setAssistantLoading(false);
            return;
          }

          // P0增强: 智能系统提示词
          const enhancedSystemPrompt = `你是无界AI工作流助手，具备以下能力：
1. 节点配置指导：帮助用户理解和配置各类节点参数
2. 工作流优化建议：分析节点链路，提出效率或质量改进建议
3. 操作执行：识别用户操作意图并执行（如添加节点、连线、删除等）
4. 错误诊断：分析工作流执行失败原因并提供修复方案

当前上下文：
${contextInfo}

可用节点类型：ai-generate(图像生成), ai-video-generate(视频生成), ai-audio(音频), input-text(文字输入), condition(条件分支), loop(循环), output-image(输出图片), output-export(导出)等30+类型。

回复格式要求：
- 如果用户请求执行操作，回复格式为 "✅ [操作结果]\n\n[后续建议]"
- 如果用户询问问题，直接回答并附上"💡 建议下一步"
- 如果意图模糊，追问具体需求（如"您想添加什么类型的节点？"）`;

          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'system', content: enhancedSystemPrompt }, { role: 'user', content: userMsg }] }),
          });
          if (res.ok) {
            const data = await res.json();
            const assistantContent = data.content || data.message || '无法获取回复';

            // P0增强: 根据回复内容自动生成建议
            const suggestions: Array<{ text: string; action: string }> = [];
            if (node) {
              if (node.type.startsWith('ai-')) {
                suggestions.push({ text: '执行此节点', action: 'execute-node' });
                suggestions.push({ text: '查看参数说明', action: 'view-params' });
              }
              if (assistantContent.includes('建议') || assistantContent.includes('可以')) {
                suggestions.push({ text: '应用建议', action: 'apply-suggestion' });
              }
            }
            suggestions.push({ text: '添加相关节点', action: 'add-related' });

            setAssistantMessages(prev => [...prev, {
              role: 'assistant',
              content: assistantContent,
              suggestions: suggestions.length > 0 ? suggestions : undefined
            }]);
          } else {
            setAssistantMessages(prev => [...prev, { role: 'assistant', content: '助手暂时无法回复，请稍后再试。' }]);
          }
        } catch {
          setAssistantMessages(prev => [...prev, { role: 'assistant', content: '网络错误，请稍后再试。' }]);
        } finally { setAssistantLoading(false); }
      }, [assistantInput, wf.nodes, wf.connections, selectedNodeId, updateWorkflow]);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport; // 始终保持最新值，避免拖动时stale closure

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    let viewportResizeFrame = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      cancelAnimationFrame(viewportResizeFrame);
      viewportResizeFrame = requestAnimationFrame(() => {
        setNodeViewportSize(previous => (
          previous.width === width && previous.height === height
            ? previous
            : { width, height }
        ));
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(viewportResizeFrame);
    };
  }, []);

  const applyNodeViewportPreview = useCallback((nextViewport: { x: number; y: number; zoom: number }) => {
    const htmlTransform = `translate(${nextViewport.x}px, ${nextViewport.y}px) scale(${nextViewport.zoom})`;
    if (nodeViewportTransformRef.current) nodeViewportTransformRef.current.style.transform = htmlTransform;
    if (svgViewportTransformRef.current) {
      svgViewportTransformRef.current.setAttribute('transform', `translate(${nextViewport.x}, ${nextViewport.y}) scale(${nextViewport.zoom})`);
    }
  }, []);

  const updateNodePanPreview = useCallback((nextViewport: { x: number; y: number; zoom: number }) => {
    nodePanPreviewRef.current = nextViewport;
    if (nodePanRafRef.current === null) {
      nodePanRafRef.current = requestAnimationFrame(() => {
        nodePanRafRef.current = null;
        applyNodeViewportPreview(nodePanPreviewRef.current);
      });
    }

    const now = performance.now();
    if (now - nodePanViewportSyncAtRef.current >= 80) {
      nodePanViewportSyncAtRef.current = now;
      setNodePanViewport(nextViewport);
    }
  }, [applyNodeViewportPreview]);

  const nodeRenderViewport = isPanning ? nodePanViewport : viewport;
  const legacyWorkflowRenderModel = useMemo(
    () => projectLegacyRenderModel(wf, nodeRenderViewport, selectedNodeIds),
    [wf, nodeRenderViewport, selectedNodeIds],
  );
  const reactFlowWorkflowRenderModel = useMemo(
    () => projectReactFlowRenderModel(wf, nodeRenderViewport, selectedNodeIds),
    [wf, nodeRenderViewport, selectedNodeIds],
  );
  const handleWorkflowRenderCommand = useCallback((command: WorkflowInteractionCommand): WorkflowCommandResult => {
    if (command.type === 'selection.set') {
      setSelectedNodeIds(new Set(command.nodeIds));
      if (command.nodeIds.length > 0) setSidebarTab('props');
    }
    return dispatchWorkflowStateCommand(command);
  }, [dispatchWorkflowStateCommand]);
  const nodeById = useMemo(() => new Map(wf.nodes.map(node => [node.id, node])), [wf.nodes]);
  const nodeCullingBounds = useMemo(() => resolveWorkflowCullingBounds(
    viewport,
    nodePanViewport,
    nodeViewportSize,
    isPanning,
  ), [viewport, nodePanViewport, nodeViewportSize, isPanning]);
  const pinnedNodeIds = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const visibleNodeIds = useMemo(() => getVisibleWorkflowNodeIds(
    wf.nodes,
    nodeCullingBounds,
    pinnedNodeIds,
    draggingNodeRef.current,
  ), [wf.nodes, nodeCullingBounds, pinnedNodeIds]);

  useLayoutEffect(() => {
    if (isPanning) applyNodeViewportPreview(nodePanPreviewRef.current);
  }, [applyNodeViewportPreview, isPanning, nodePanViewport]);

  useEffect(() => () => {
    if (nodePanRafRef.current !== null) cancelAnimationFrame(nodePanRafRef.current);
    if (nodeWheelRafRef.current !== null) cancelAnimationFrame(nodeWheelRafRef.current);
  }, []);

  const modelCatalogIndex = useMemo(
    () => createTaskModelCatalogIndex(taskModelCatalog),
    [taskModelCatalog],
  );
  const models = useMemo<ModelOption[]>(() => taskModelOptions.map(model => ({
    id: model.id,
    name: model.name,
    type: model.type,
    provider: model.providerName || model.providerId,
    providerId: model.providerId,
    apiDisplayName: model.displayName || model.name,
  })), [taskModelOptions]);
  const modelsLoading = catalogStatus.loading || Boolean(catalogStatus.error);
  const sketchModelsUnavailable = useMemo(() => unavailableSketchModel(wf.nodes, modelCatalogIndex, modelsLoading)
    || containsSketchNode(wf.nodes) && sketchScope.authority === 'unknown', [wf.nodes, modelCatalogIndex, modelsLoading, sketchScope.authority]);
  const [workflowSkills, setWorkflowSkills] = useState<SkillDefinition[]>([]);
  const [workflowSkillsLoading, setWorkflowSkillsLoading] = useState(false);
  const [workflowSkillsError, setWorkflowSkillsError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setWorkflowSkillsLoading(true);
    loadWorkflowSkillCatalog(fetch, controller.signal).then(skills => {
      setWorkflowSkills(skills);
      setWorkflowSkillsError(null);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setWorkflowSkillsError(error instanceof Error ? error.message : '节点 Skill 目录加载失败');
    }).finally(() => {
      if (!controller.signal.aborted) setWorkflowSkillsLoading(false);
    });
    return () => controller.abort();
  }, []);
  const chatModels = useMemo(() => models.filter(m => m.type === 'chat'), [models]);
  const imageModels = useMemo(() => models.filter(m => m.type === 'image'), [models]);
  const annotationModels = useMemo(() => imageModels
    .filter((model) => modelCatalogIndex.get(taskModelKey(model.providerId || '', model.id))?.supportsMask)
    .map((model) => ({
      id: model.providerId ? `${model.providerId}::${model.id}` : model.id,
      label: `${model.apiDisplayName || model.name || model.id}${model.provider ? ` · ${model.provider}` : ''}`,
    })), [imageModels, modelCatalogIndex]);

  // 工作流节点图片列表 (用于 @mention 引用和输入引用阻断)
  // 合并: 画布传入的图片 + 工作流内节点输出的图片
  const allCanvasImages = useMemo(() => {
    const nodeImages = wf.nodes
      .filter(n => n.type === 'input-image' || n.type === 'ai-generate' || n.type === 'output-image' || n.type === 'output-image-group')
      .map(n => {
        const cfg = n.config as Record<string, unknown>;
        const url = (cfg?.imageUrl as string) || (cfg?.outputUrl as string) || '';
        const name = (cfg?.label as string) || n.label || n.type;
        return {
          id: n.id,
          url,
          name,
          label: name,
          description: name,
          assetId: typeof cfg.assetId === 'string' ? cfg.assetId : undefined,
          assetVersionId: typeof cfg.assetVersionId === 'string' ? cfg.assetVersionId : undefined,
          placementId: typeof cfg.placementId === 'string' ? cfg.placementId : undefined,
          projectId: typeof cfg.projectId === 'string' ? cfg.projectId : undefined,
        };
      })
      .filter(img => img.url);
    // 合并外部传入的画布图片
    const external = (canvasImages || []).map(img => ({ ...img, name: img.name || img.description || img.label || '', label: img.label || img.description || img.name || '' }));
    return [...external, ...nodeImages];
  }, [wf.nodes, canvasImages]);

  // P1-4: 上游图片URL缓存 — 避免每个NodeCard内联IIFE重复计算
  const upstreamImageUrls = useMemo(() => {
    const m = new Map<string, string>(), counts = new Map<string, number>();
    const incoming = new Map<string, WorkflowConnection[]>(), resolved = new Map<string, string | null>();
    for (const node of wf.nodes) counts.set(node.id, (counts.get(node.id) || 0) + 1);
    for (const c of wf.connections) {
      const rows = incoming.get(c.toNodeId) || []; rows.push(c); incoming.set(c.toNodeId, rows);
      const target = nodeById.get(c.toNodeId);
      if (target?.type === 'input-image' && target.config.source === 'upstream') continue;
      if (c.type === 'image' || c.type === 'data') {
        const upNode = nodeById.get(c.fromNodeId);
        const url = (upNode?.config?.imageUrl as string) || (execResults[c.fromNodeId]?.output?.imageUrl as string);
        if (url) m.set(c.toNodeId, url);
      }
    }
    // Resolve receivers through the same actual input/port rules as execution. This is preview only.
    const receiverPreview = (initial: WorkflowNode): string | undefined => {
      let node = initial, url: string | undefined;
      const path: string[] = [], visited = new Set<string>();
      while (true) {
        if (resolved.has(node.id)) { url = resolved.get(node.id) || undefined; break; }
        if (visited.has(node.id)) break;
        visited.add(node.id); path.push(node.id);
        if (counts.get(node.id) !== 1) break;
        try { if (!readWorkflowImageInputTransform(node)) break; } catch { break; }
        const ports = node.ports.filter(port => port.id === 'in-image'), blocked = node.config.blockedInputs;
        if (ports.length !== 1 || ports[0].direction !== 'in' || ports[0].type !== 'image'
          || blocked !== undefined && (!Array.isArray(blocked) || !blocked.every(value => typeof value === 'string' && value.trim().length > 0))) break;
        const blockedIds = new Set((blocked || []) as string[]);
        const candidates = (incoming.get(node.id) || []).filter(connection => connection.toPortId === 'in-image' && !blockedIds.has(connection.id));
        if (candidates.length !== 1) break;
        const connection = candidates[0], source = nodeById.get(connection.fromNodeId);
        if (!source || source.id === node.id || counts.get(source.id) !== 1 || !connection.id.trim()) break;
        const outputs = source.ports.filter(port => port.id === connection.fromPortId);
        if (outputs.length !== 1 || outputs[0].direction !== 'out' || connection.type !== outputs[0].type || !canConnectPorts(outputs[0].type, 'image')) break;
        if (source.type === 'input-image' && source.config.source === 'upstream') {
          let transform;
          try { transform = readWorkflowImageInputTransform(source); } catch { break; }
          if (transform?.kind === 'identity') { node = source; continue; }
          if (transform?.kind !== 'grid') break;
          const result = execResults[source.id], imageInput = workflowImageRetryRecord(result?.output?.imageInput);
          const cell = workflowImageRetryRecord(imageInput?.cell);
          if (result?.status === 'success' && imageInput?.version === 1 && cell
            && ['columns', 'rows', 'column', 'row'].every(key => cell[key] === transform[key as 'columns' | 'rows' | 'column' | 'row'])) {
            const value = result.output?.imageUrl; if (typeof value === 'string' && value.trim()) url = value;
          } else if (source.config.gridIndex === transform.row * transform.columns + transform.column + 1
            && source.config.gridCol === transform.column + 1 && source.config.gridRow === transform.row + 1
            && ['assetId', 'assetVersionId', 'placementId', 'projectId', 'imageUrl'].every(key => typeof source.config[key] === 'string' && Boolean(source.config[key]))) {
            url = source.config.imageUrl as string;
          }
          break;
        }
        const value = execResults[source.id]?.output?.imageUrl || source.config.imageUrl;
        if (typeof value === 'string' && value.trim()) url = value;
        break;
      }
      for (const id of path) resolved.set(id, url || null);
      return url;
    };
    for (const node of wf.nodes) {
      if (node.type !== 'input-image' || node.config.source !== 'upstream') continue;
      const url = receiverPreview(node); if (url) m.set(node.id, url);
    }
    return m;
  }, [wf.connections, wf.nodes, nodeById, execResults]);

  // 框选状态
  const [boxSelect, setBoxSelect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const isBoxSelectingRef = useRef(false);

  const selectedNode = useMemo(() => wf.nodes.find(n => n.id === selectedNodeId) || null, [wf.nodes, selectedNodeId]);
  const selectedNodeBoundSourceVersionIds = useMemo(() => {
    if (!selectedNode) return [];
    const ids: string[] = [];
    for (const connection of wf.connections) {
      if (connection.toNodeId !== selectedNode.id || connection.type !== 'image') continue;
      const source = nodeById.get(connection.fromNodeId);
      const assetVersionId = source?.config?.assetVersionId;
      const sourceVersionId = source?.config?.sourceVersionId;
      if (typeof assetVersionId === 'string' && assetVersionId) ids.push(assetVersionId);
      if (typeof sourceVersionId === 'string' && sourceVersionId) ids.push(sourceVersionId);
    }
    return [...new Set(ids)];
  }, [nodeById, selectedNode, wf.connections]);

  const getNodeAnnotationCandidates = useCallback((
    node: WorkflowNode,
    existingBundle?: EditIntentBundle | null,
  ): NodeAnnotationCandidate[] => {
    return collectNodeAnnotationCandidates({
      node,
      nodes: wfRef.current.nodes,
      connections: wfRef.current.connections,
      results: execResults,
      canvasImages: (canvasImages || []).map((image) => ({
        id: image.id,
        url: image.url,
        versionId: image.versionId,
      })),
      existingBundle,
    });
  }, [canvasImages, execResults]);

  const openNodeAnnotation = useCallback((
    sourceNode: WorkflowNode,
    candidate: NodeAnnotationCandidate,
    existingBundle: EditIntentBundle | null = null,
  ) => {
    if (!projectId) {
      setNodeAnnotationError('请先保存项目，再使用批注修改');
      return;
    }
    const ownedImage = candidate.sourceImageId
      ? canvasImages?.find((image) =>
          image.id === candidate.sourceImageId
          && image.url === candidate.url,
        )
      : (() => {
          const matches = canvasImages?.filter(
            (image) => image.url === candidate.url,
          ) || [];
          return matches.length === 1 ? matches[0] : undefined;
        })();
    if (!ownedImage?.versionId) {
      setNodeAnnotationError('请先将图片保存到项目画布');
      return;
    }
    if (
      candidate.sourceVersionId
      && candidate.sourceVersionId !== ownedImage.versionId
    ) {
      setNodeAnnotationError('来源图片版本已变化，请重新创建批注');
      return;
    }
    if (
      existingBundle
      && (
        existingBundle.sourceImageId !== ownedImage.id
        || existingBundle.sourceVersionId !== ownedImage.versionId
      )
    ) {
      setNodeAnnotationError('来源图片版本已变化，请重新创建批注');
      return;
    }

    const connectionNode = wfRef.current.nodes.find(
      (node) => node.id === candidate.sourceNodeId,
    );
    if (!connectionNode?.ports.some((port) =>
      port.id === candidate.sourcePortId
      && port.direction === 'out'
      && port.type === 'image',
    )) {
      setNodeAnnotationError('请选择包含单张图片的节点');
      return;
    }

    setNodeAnnotationSession({
      source: {
        projectId,
        sourceNodeId: candidate.sourceNodeId,
        sourceImageId: ownedImage.id,
        sourceVersionId: ownedImage.versionId,
        imageUrl: candidate.url,
        label: candidate.label || sourceNode.label,
      },
      anchorNodeId: sourceNode.id,
      connectionNodeId: candidate.sourceNodeId,
      connectionPortId: candidate.sourcePortId,
      editingNodeId: sourceNode.type === 'ai-annotation-edit'
        ? sourceNode.id
        : undefined,
      existingBundle,
    });
    setNodeAnnotationCandidates(null);
    setNodeAnnotationError(null);
  }, [canvasImages, projectId]);

  const requestNodeAnnotation = useCallback((sourceNode: WorkflowNode | null) => {
    const sourceNodeId = sourceNode?.id;
    sourceNode = sourceNodeId !== undefined ? wfRef.current.nodes.find((node) => node.id === sourceNodeId) || null : null;
    if (!sourceNode) {
      setNodeAnnotationError('请选择包含单张图片的节点');
      return;
    }
    const existingBundle = sourceNode.type === 'ai-annotation-edit'
      ? parseAnnotationBundle(sourceNode.config?.annotationBundle)
      : null;
    if (sourceNode.type === 'ai-annotation-edit' && !existingBundle) {
      setNodeAnnotationError('当前批注节点的数据无效，无法重新编辑');
      return;
    }
    const candidates = getNodeAnnotationCandidates(sourceNode, existingBundle);
    if (candidates.length === 0) {
      setNodeAnnotationError('请选择包含单张图片的节点');
      return;
    }
    if (candidates.length > 1) {
      setNodeAnnotationCandidates({
        sourceNodeId: sourceNode.id,
        candidates,
        existingBundle,
      });
      setNodeAnnotationError(null);
      return;
    }
    openNodeAnnotation(sourceNode, candidates[0], existingBundle);
  }, [getNodeAnnotationCandidates, openNodeAnnotation]);

  const handleCreateAnnotationNode = useCallback((bundle: EditIntentBundle) => {
    const session = nodeAnnotationSession;
    if (!session) return;
    if (session.editingNodeId) {
      updateWorkflow((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => node.id === session.editingNodeId
          ? {
              ...node,
              label: '批注修改',
              config: {
                ...node.config,
                annotationBundle: bundle,
                prompt: bundle.prompt,
                model: bundle.modelId,
                providerId: bundle.providerId,
                sourceImageId: bundle.sourceImageId,
                sourceVersionId: bundle.sourceVersionId,
                sourceImageUrl: session.source.imageUrl,
              },
            }
          : node),
      }));
      setNodeAnnotationSession(null);
      setNodeAnnotationError(null);
      return;
    }

    const anchorNode = wf.nodes.find((node) => node.id === session.anchorNodeId);
    const connectionNode = wf.nodes.find(
      (node) => node.id === session.connectionNodeId,
    );
    const outputPort = connectionNode?.ports.find(
      (port) => port.id === session.connectionPortId,
    );
    if (!anchorNode || !connectionNode || !outputPort) {
      setNodeAnnotationError('无法建立批注节点的图片连线');
      return;
    }

    const annotationNode = createWorkflowNode('ai-annotation-edit',
      anchorNode.x + anchorNode.width + 80,
      anchorNode.y,
    );
    annotationNode.config = {
      ...annotationNode.config,
      annotationBundle: bundle,
      prompt: bundle.prompt,
      model: bundle.modelId,
      providerId: bundle.providerId,
      sourceImageId: bundle.sourceImageId,
      sourceVersionId: bundle.sourceVersionId,
      sourceImageUrl: session.source.imageUrl,
    };
    const inputPort = annotationNode.ports.find((port) =>
      port.id === 'in-image',
    );
    if (!inputPort) {
      setNodeAnnotationError('批注节点缺少图片输入端口');
      return;
    }
    const connection = createConnection(
      connectionNode.id,
      outputPort.id,
      annotationNode.id,
      inputPort.id,
      'image',
    );
    updateWorkflow((prev) => ({
      ...prev,
      nodes: [...prev.nodes, annotationNode],
      connections: [...prev.connections, connection],
    }));
    setSelectedNodeIds(new Set([annotationNode.id]));
    setSidebarTab('props');
    setNodeAnnotationSession(null);
    setNodeAnnotationError(null);
  }, [nodeAnnotationSession, updateWorkflow, wf.nodes]);

  // 图片上传: 全局文件输入框 (foreignObject内动态input.click()不可靠)
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const pendingImageUploadNodeId = useRef<string | null>(null);

  // 通知外部 (拖动期间跳过)
  const onWorkflowChangeRef = useRef(onWorkflowChange);
  onWorkflowChangeRef.current = onWorkflowChange;
  const notificationDragGuardRef = useRef(isDraggingRef);
  notificationDragGuardRef.current = isDraggingRef;
  useEffect(() => {
    if (!notificationDragGuardRef.current.current) {
      lastEmittedRef.current = wf;
      onWorkflowChangeRef.current?.(wf);
    }
  }, [wf, workflowSyncRevision]);

  // ─── 节点操作 ───

  const handleAddNode = useCallback((type: NodeType) => {
    const node = createWorkflowNode(type, 300 + Math.random() * 200, 200 + Math.random() * 200);
    // 生图节点自动创建输出图片节点并连接，尺寸与画面比例一致
    const shouldAutoOutput = isImageGeneratingNode(type);
    // 从属性面板配置获取默认画面比例
    const defaultAspectRatio = shouldAutoOutput
      ? (getNodePropertyFields(type).find(f => f.key === 'aspectRatio')?.defaultValue as string | undefined)
      : undefined;
    const outSize = shouldAutoOutput ? getOutputNodeSize(defaultAspectRatio) : null;
    const outputNode = shouldAutoOutput
      ? (() => {
          const on = createWorkflowNode('output-image', node.x + node.width + 80, node.y);
          on.width = Math.max(outSize!.width, 140);
          on.height = Math.max(outSize!.height, 120);
          return on;
        })()
      : null;
    const currentWorkflow = wfRef.current;
    const autoConns: WorkflowConnection[] = [];
    // 生图节点 → 自动输出节点连线
    if (outputNode) {
      const genOutPort = node.ports.find(p => p.direction === 'out' && p.type === 'image');
      const outInPort = outputNode.ports.find(p => p.direction === 'in' && p.type === 'image');
      if (genOutPort && outInPort) {
        autoConns.push(createConnection(node.id, genOutPort.id, outputNode.id, outInPort.id, 'image'));
      }
    }
    // P2: 拖拽自动连线 — 如果有选中节点，尝试自动连线
    const selectedNodes = currentWorkflow.nodes.filter(n => selectedNodeIds.has(n.id));
    if (selectedNodes.length > 0) {
      for (const selNode of selectedNodes) {
        const selOutPorts = selNode.ports.filter(p => p.direction === 'out');
        const newInPorts = node.ports.filter(p => p.direction === 'in');
        for (const outP of selOutPorts) {
          for (const inP of newInPorts) {
            if (canConnectPorts(outP.type, inP.type)) {
              const exists = currentWorkflow.connections.some(c =>
                c.fromNodeId === selNode.id && c.fromPortId === outP.id &&
                c.toNodeId === node.id && c.toPortId === inP.id
              );
              if (!exists) {
                autoConns.push(createConnection(selNode.id, outP.id, node.id, inP.id, outP.type));
                break;
              }
            }
          }
          if (autoConns.length > 0) break;
        }
        if (autoConns.length > 0) break;
      }
    }
    updateWorkflow(prev => {
      const newNodes = outputNode ? [node, outputNode] : [node];
      return { ...prev, nodes: [...prev.nodes, ...newNodes], connections: [...prev.connections, ...autoConns] };
    });
    setSelectedNodeIds(new Set([node.id]));
    setSidebarTab('props');
  }, [selectedNodeIds, updateWorkflow]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    workflowInputTransferGuardRef.current.invalidate(nodeId);
    handleWorkflowRenderCommand({
      type: 'nodes.delete', nodeIds: [nodeId], transactionId: `legacy-node-delete:${nodeId}`,
    });
    setSelectedNodeIds(prev => { const next = new Set(prev); next.delete(nodeId); return next; });
  }, [handleWorkflowRenderCommand]);
  useEffect(() => { handleDeleteNodeRef.current = handleDeleteNode; }, [handleDeleteNode]);

  const materialInsertionTransactionsRef = useRef(new Map<string, { transactionId: string;
    guard: ReturnType<typeof createWorkflowInputTransferGuard>; shadow: WorkflowNode; image: CanvasImageRef }>());
  // An interrupted insertion is owned by the exact originating scope and history entry.
  const abandonedMaterialOriginsRef = useRef(new Map<string, { scope: string; actor: string; project: string;
    transactionId: string; guard: ReturnType<typeof createWorkflowInputTransferGuard>;
    token?: ReturnType<ReturnType<typeof createWorkflowInputTransferGuard>['begin']>; image: CanvasImageRef }>());
  useEffect(() => () => { abandonedMaterialOriginsRef.current.clear(); }, []);
  useEffect(() => () => { materialInsertionTransactionsRef.current.clear(); }, [workflowInputScope]);
  const abandonedMaterialOrigin = (node: WorkflowNode) => {
    const origin = abandonedMaterialOriginsRef.current.get(node.id);
    if (!origin || origin.scope !== workflowInputScope || !userId || !projectId || origin.actor !== userId
      || origin.project !== projectId || origin.guard === workflowInputTransferGuardRef.current
      || node.type !== 'input-image' || node.config.assetTransferPending !== true || node.config.assetTransferError
      || !workflowEditorState.history.entries.some(entry => entry.transactionId === origin.transactionId
        && entry.redo.some(op => op.type === 'node.add' && op.node.id === node.id))) return undefined;
    return origin;
  };
  const persistedInterruptedMaterial = (node: WorkflowNode): boolean => {
    if (node.type !== 'input-image' || node.config.assetTransferPending !== true || node.config.assetTransferError
      || !userId || !projectId || node.config.assetTransferExpectedActorId !== userId
      || node.config.assetTransferExpectedProjectId !== projectId || !node.config.assetTransferExpectedSource) return false;
    const active = abandonedMaterialOriginsRef.current.get(node.id);
    return !active || active.scope !== workflowInputScope || active.guard !== workflowInputTransferGuardRef.current
      || !active.token || !active.guard.isCurrent(active.token);
  };
  const recoveryDisplayNode = (node: WorkflowNode): WorkflowNode => {
    const origin = abandonedMaterialOrigin(node);
    if (!origin) return persistedInterruptedMaterial(node)
      ? { ...node, config: { ...node.config, assetTransferError: 'TRANSFER_INTERRUPTED' } } : node;
    const image = origin.image;
    return { ...node, config: { ...node.config, assetTransferError: 'TRANSFER_INTERRUPTED',
      assetTransferExpectedActorId: origin.actor, assetTransferExpectedProjectId: origin.project,
      assetTransferExpectedSource: { id: image.id, url: image.url, projectId: image.projectId, versionId: image.versionId,
        assetId: image.assetId, assetVersionId: image.assetVersionId, placementId: image.placementId } } };
  };
  useEffect(() => {
    const ids = new Set(workflowEditorState.history.entries.map(entry => entry.transactionId));
    for (const [id, insertion] of materialInsertionTransactionsRef.current) if (!ids.has(insertion.transactionId)) materialInsertionTransactionsRef.current.delete(id);
  }, [workflowEditorState.history]);
  const settleMaterialInsertion = useCallback((nodeId: string, before: WorkflowNode, after: WorkflowNode): void => {
    const insertion = materialInsertionTransactionsRef.current.get(nodeId);
    if (!insertion || insertion.guard !== workflowInputTransferGuardRef.current) return;
    insertion.shadow = after;
    const live = wfRef.current.nodes.find(node => node.id === nodeId);
    if (live) {
      if (live !== before) return;
      wfRef.current = { ...wfRef.current, nodes: wfRef.current.nodes.map(node => node.id === nodeId ? after : node) };
    }
    dispatchWorkflowEditorTransition({ kind: 'insertion.settle', nodeId, transactionId: insertion.transactionId, before, after });
  }, []);
  const transferCanvasImageToWorkflow = useCallback(async (
    nodeId: string,
    image: CanvasImageRef,
    insertionTransactionId?: string,
  ): Promise<void> => {
    const blocked = wfRef.current.nodes.find(node => node.id === nodeId);
    if ((blocked?.config.assetTransferError === 'ACTOR_SCOPE_CHANGED' || blocked?.config.assetTransferError === 'TRANSFER_INTERRUPTED')
      && (!userId || !projectId || blocked.config.assetTransferExpectedActorId !== userId
        || blocked.config.assetTransferExpectedProjectId !== projectId)) return;
    const guard = workflowInputTransferGuardRef.current;
    const token = guard.begin(nodeId);
    const origin = abandonedMaterialOriginsRef.current.get(nodeId);
    if (origin && origin.scope === workflowInputScope && origin.guard === guard) origin.token = token;
    const isCurrent = (): boolean => guard === workflowInputTransferGuardRef.current && guard.isCurrent(token);
    let actorScopeChanged = false;
    const noteActorScopeChanged = async (response: Response): Promise<void> => {
      if (response.status !== 409) return;
      try {
        const body: unknown = await response.clone().json();
        actorScopeChanged = !!body && typeof body === 'object' && !Array.isArray(body)
          && (body as { error?: unknown }).error === 'ACTOR_SCOPE_CHANGED';
      } catch { /* Leave other failures on the existing fallback path. */ }
    };
    const pendingReference = createPendingWorkflowInputReference(image);
    const expectedSource = { id: image.id, url: image.url, projectId: image.projectId, versionId: image.versionId,
      assetId: image.assetId, assetVersionId: image.assetVersionId, placementId: image.placementId };
    let initialPendingRecorded = false;
    const updateInputWorkflow = (updater: (prev: WorkflowData) => WorkflowData): void => {
      if (!insertionTransactionId) { updateWorkflow(updater); return; }
      const insertion = materialInsertionTransactionsRef.current.get(nodeId);
      const historyPresent = workflowEditorStateRef.current.history.entries.some(entry => entry.transactionId === insertionTransactionId);
      if (insertion && insertion.transactionId === insertionTransactionId && insertion.guard === guard
        && (!initialPendingRecorded || historyPresent)) {
        const before = wfRef.current.nodes.find(node => node.id === nodeId) ?? insertion.shadow;
        const after = updater({ ...wfRef.current, nodes: [before] }).nodes[0];
        if (after) settleMaterialInsertion(nodeId, before, after);
        return;
      }
      // Hydration or bounded history eviction must not discard an authorised live receipt.
      // The fallback never recreates a removed node or applies to a changed source or scope.
      const current = wfRef.current.nodes.find(node => node.id === nodeId);
      const expected = current?.config.assetTransferExpectedSource as Partial<CanvasImageRef> | undefined;
      if (!initialPendingRecorded || !isCurrent() || !origin || origin.scope !== workflowInputScope
        || origin.guard !== guard || origin.token !== token || origin.actor !== userId || origin.project !== projectId
        || !current || current.type !== 'input-image' || current.config.assetTransferPending !== true || current.config.assetTransferError
        || current.config.assetTransferExpectedActorId !== userId || current.config.assetTransferExpectedProjectId !== projectId
        || current.config.source !== 'canvas' || current.config.sourceImageId !== image.id || current.config.imageUrl !== image.url
        || current.config.sourceVersionId !== image.versionId || !expected || expected.id !== image.id || expected.url !== image.url
        || expected.projectId !== image.projectId || expected.versionId !== image.versionId || expected.assetId !== image.assetId
        || expected.assetVersionId !== image.assetVersionId || expected.placementId !== image.placementId) return;
      updateWorkflowSystem(updater);
    };
    const applyLegacyReference = (): void => {
      updateInputWorkflow(prev => ({
        ...prev,
        nodes: prev.nodes.map(node => node.id === nodeId
          ? {
              ...node,
              config: {
                ...node.config,
                ...pendingReference,
                assetTransferPending: false,
                assetTransferExpectedActorId: undefined, assetTransferExpectedProjectId: undefined, assetTransferExpectedSource: undefined,
                projectId: undefined,
                assetId: undefined,
                assetVersionId: undefined,
                placementId: undefined,
              },
            }
          : node),
      }));
    };
    updateInputWorkflow(prev => ({
      ...prev,
      nodes: prev.nodes.map(node => node.id === nodeId
        ? {
            ...node,
            config: {
              ...node.config,
              ...pendingReference,
              assetTransferPending: Boolean(projectId),
              ...(userId && projectId ? { assetTransferExpectedActorId: node.config.assetTransferExpectedActorId || userId,
                assetTransferExpectedProjectId: node.config.assetTransferExpectedProjectId || projectId,
                assetTransferExpectedSource: expectedSource } : {}),
              projectId: undefined,
              assetId: undefined,
              assetVersionId: undefined,
              placementId: undefined,
            },
          }
        : node),
    }));
    initialPendingRecorded = true;
    if (!projectId) {
      if (guard.isCurrent(token)) applyLegacyReference();
      return;
    }
    await runGuardedWorkflowInputTransfer({
      guard,
      token,
      transfer: async () => {
        if (canvasDocumentMode) {
          if (!image.assetVersionId || !image.placementId || image.projectId !== projectId) {
            throw new Error('Document input identity is required');
          }
          const response = await fetch('/api/assets', {
            method: 'POST', credentials: 'include', cache: 'no-store',
            headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-wujie-expected-actor-id': userId } : {}) },
            body: JSON.stringify({ projectId, assetVersionId: image.assetVersionId, placementId: image.placementId }),
          });
          if (!response.ok) {
            await noteActorScopeChanged(response);
            throw new Error(`Document input rejected (${response.status})`);
          }
          const reference = await response.json() as WorkspaceAssetReference;
          if (typeof reference.url !== 'string' || !reference.url.trim() || reference.assetVersionId !== image.assetVersionId
            || reference.placementId !== image.placementId) throw new Error('Document input identity changed');
          return reference;
        }
        let sourceReference: WorkspaceAssetReference = image;
        if (!sourceReference.assetVersionId) {
          const adoptionResponse = await fetch('/api/assets/adopt-canvas-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-wujie-expected-actor-id': userId } : {}) },
            body: JSON.stringify({ projectId, imageId: image.id }),
          });
          if (!adoptionResponse.ok) {
            await noteActorScopeChanged(adoptionResponse);
            throw new Error(`Legacy asset adoption failed (${adoptionResponse.status})`);
          }
          sourceReference = await adoptionResponse.json() as WorkspaceAssetReference;
          if (!sourceReference.assetVersionId) {
            throw new Error('Legacy asset adoption returned no version');
          }
          if (isCurrent()) onCanvasImageAssetReferenceAdopted?.(image.id, sourceReference);
        }
        if (!isCurrent()) throw new Error('Workflow input transfer is no longer current');
        const response = await fetch('/api/assets/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-wujie-expected-actor-id': userId } : {}) },
          body: JSON.stringify({
            sourceVersion: sourceReference.assetVersionId,
            targetProject: projectId,
            targetWorkspace: wf.id,
            entityType: 'workflow-input',
            entityId: nodeId,
            idempotencyKey: `canvas-workflow:${wf.id}:${nodeId}:${sourceReference.assetVersionId}`,
            metadata: { name: image.name, source: 'canvas', sourceImageId: image.id },
          }),
        });
        if (!response.ok) {
          await noteActorScopeChanged(response);
          throw new Error(`Asset transfer failed (${response.status})`);
        }
        return response.json() as Promise<WorkspaceAssetReference>;
      },
      onSuccess: transferred => {
        if (!isCurrent()) return;
        setWorkflowInputActorSourceChanged(previous => previous === nodeId ? null : previous);
        updateInputWorkflow(prev => ({
          ...prev,
          nodes: prev.nodes.map(node => node.id === nodeId
            ? {
                ...node,
                config: {
                  ...node.config,
                  imageUrl: transferred.url,
                  source: 'canvas',
                  sourceImageId: image.id,
                  assetTransferPending: false,
                  assetTransferError: undefined,
                  assetTransferExpectedActorId: undefined,
                  assetTransferExpectedProjectId: undefined,
                  assetTransferExpectedSource: undefined,
                  projectId,
                  assetId: transferred.assetId,
                  assetVersionId: transferred.assetVersionId,
                  placementId: transferred.placementId,
                },
              }
            : node),
        }));
      },
      onFailure: () => {
        if (!isCurrent()) return;
        const prior = wfRef.current.nodes.find(node => node.id === nodeId);
        if (actorScopeChanged || (prior?.config.assetTransferError === 'ACTOR_SCOPE_CHANGED' || prior?.config.assetTransferError === 'TRANSFER_INTERRUPTED')) {
          updateInputWorkflow(prev => ({ ...prev, nodes: prev.nodes.map(node => node.id === nodeId
            ? { ...node, config: { ...node.config, assetTransferPending: true, assetTransferError: actorScopeChanged ? 'ACTOR_SCOPE_CHANGED' : node.config.assetTransferError,
              assetTransferExpectedActorId: node.config.assetTransferExpectedActorId || userId || '',
              assetTransferExpectedProjectId: (node.config.assetTransferError === 'ACTOR_SCOPE_CHANGED' || node.config.assetTransferError === 'TRANSFER_INTERRUPTED')
                ? node.config.assetTransferExpectedProjectId : projectId,
              assetTransferExpectedSource: expectedSource } } : node) }));
          return;
        }
        if (!canvasDocumentMode) { applyLegacyReference(); return; }
        updateInputWorkflow(prev => ({ ...prev, nodes: prev.nodes.map(node => node.id === nodeId ? {
          ...node, config: { ...node.config, imageUrl: '', assetTransferPending: false,
            assetTransferExpectedActorId: undefined, assetTransferExpectedProjectId: undefined, assetTransferExpectedSource: undefined,
            projectId: undefined, assetId: undefined, assetVersionId: undefined, placementId: undefined },
        } : node) }));
        setNodeAnnotationError('协作图片权限或版本已变化，请重新选择');
      },
    });
  }, [canvasDocumentMode, onCanvasImageAssetReferenceAdopted, projectId, settleMaterialInsertion, updateWorkflow, updateWorkflowSystem, userId, wf.id, workflowInputScope]);


  useEffect(() => () => { materialInsertionCentersRef.current.clear(); materialGeometryEpochRef.current.clear(); }, [workflowInputScope]);
  useLayoutEffect(() => {
    let disposed = false, frame = 0;
    const removers: Array<() => void> = [];
    const schedule = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reconcile); };
    function reconcile(): void {
      if (disposed) return;
      for (const [nodeId, anchor] of materialInsertionCentersRef.current) {
        const state = workflowEditorStateRef.current;
        const index = state.history.entries.findIndex(entry => entry.transactionId === anchor.transactionId);
        if (anchor.guard !== workflowInputTransferGuardRef.current || index < 0
          || (materialGeometryEpochRef.current.get(nodeId) ?? 0) !== anchor.geometryEpoch) { materialInsertionCentersRef.current.delete(nodeId); continue; }
        const node = wfRef.current.nodes.find(current => current.id === nodeId);
        if (!node) { if (index < state.history.index) materialInsertionCentersRef.current.delete(nodeId); continue; }
        if (index >= state.history.index || node.x !== anchor.x || node.y !== anchor.y || Math.abs(node.width - anchor.width) > 2
          || draggingNodeRef.current === nodeId || node.config.source !== 'canvas' || node.config.sourceImageId !== anchor.sourceImageId) {
          materialInsertionCentersRef.current.delete(nodeId); continue;
        }
        if (node.config.assetTransferPending === true) continue;
        if (!node.config.imageUrl) { materialInsertionCentersRef.current.delete(nodeId); continue; }
        const element = canvasContainerRef.current && Array.from(canvasContainerRef.current.querySelectorAll<HTMLElement>('[data-node-id]')).find(item => item.dataset.nodeId === nodeId);
        if (!element) continue;
        if (element.classList.contains('collapsed')) { materialInsertionCentersRef.current.delete(nodeId); continue; }
        const images = Array.from(element.querySelectorAll('img'));
        if (images.some(image => image.complete && image.naturalWidth === 0)) { materialInsertionCentersRef.current.delete(nodeId); continue; }
        const waiting = images.filter(image => !image.complete);
        if (waiting.length) {
          for (const image of waiting) { image.addEventListener('load', schedule, { once: true }); image.addEventListener('error', schedule, { once: true });
            removers.push(() => { image.removeEventListener('load', schedule); image.removeEventListener('error', schedule); }); }
          continue;
        }
        const rect = element.getBoundingClientRect(), zoom = viewportRef.current.zoom;
        if (!Number.isFinite(zoom) || zoom <= 0 || rect.width <= 0 || rect.height <= 0) continue;
        const width = rect.width / zoom, height = rect.height / zoom;
        if (Math.abs(node.width - width) > 2 || Math.abs(node.height - height) > 2) continue;
        materialInsertionCentersRef.current.delete(nodeId);
        settleMaterialInsertion(nodeId, node, { ...node, x: anchor.cx - width / 2, y: anchor.cy - height / 2 });
      }
    }
    schedule();
    return () => { disposed = true; cancelAnimationFrame(frame); removers.forEach(remove => remove()); };
  }, [wf.nodes, workflowEditorState.history, viewport.zoom, workflowInputScope, settleMaterialInsertion]);

  const addCanvasImageNode = useCallback((imageUrl: string, cx: number, cy: number, refImage?: CanvasImageRef): void => {
    const imgW = refImage?.width || 1024;
    const imgH = refImage?.height || 1024;
    const ratio = imgW / imgH;
    const nodeW = Math.max(180, Math.min(320, 260 * Math.max(1, ratio)));
    const nodeH = Math.max(140, Math.min(320, nodeW / ratio));

    const node = createWorkflowNode('input-image', cx - nodeW / 2, cy - nodeH / 2);
    node.config = refImage
      ? { ...node.config, ...createPendingWorkflowInputReference(refImage) }
      : { ...node.config, imageUrl, source: 'canvas-ref', assetTransferPending: false };
    node.width = nodeW;
    node.height = nodeH;
    const transactionId = 'material-insert:' + (++editorTransactionCounterRef.current);
    if (refImage) {
      materialInsertionCentersRef.current.set(node.id, { guard: workflowInputTransferGuardRef.current, transactionId,
        x: node.x, y: node.y, cx, cy, width: nodeW, sourceImageId: refImage.id, geometryEpoch: materialGeometryEpochRef.current.get(node.id) ?? 0 });
      materialInsertionTransactionsRef.current.set(node.id, { transactionId, guard: workflowInputTransferGuardRef.current, shadow: node, image: refImage });
      if (userId && projectId) abandonedMaterialOriginsRef.current.set(node.id, { scope: workflowInputScope,
        actor: userId, project: projectId, transactionId, guard: workflowInputTransferGuardRef.current, image: structuredClone(refImage) });
    }
    const next = { ...wfRef.current, nodes: [...wfRef.current.nodes, node] };
    wfRef.current = next;
    dispatchWorkflowEditorTransition({ kind: 'user.update', workflow: next, transactionId });
    setSelectedNodeIds(new Set([node.id]));
    if (refImage) void transferCanvasImageToWorkflow(node.id, refImage, transactionId);
  }, [projectId, transferCanvasImageToWorkflow, userId, workflowInputScope]);

  const handleLibraryImage = useCallback((id: string): void => {
    const image = (canvasImages || []).find(candidate => candidate.id === id);
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!image || !rect) return;
    const vp = viewportRef.current;
    addCanvasImageNode(image.url, (rect.width / 2 - vp.x) / vp.zoom, (rect.height / 2 - vp.y) / vp.zoom, image);
    closeDirectoryOnMobile();
  }, [addCanvasImageNode, canvasImages, closeDirectoryOnMobile]);

  // 从内容面板拖拽图片到画布 → 创建 input-image 节点
  const handleCanvasImageDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const structuredReference = parseCanvasAssetDragPayload(
      e.dataTransfer.getData(CANVAS_ASSET_DRAG_MIME),
    );
    const imageUrl = structuredReference?.url
      || e.dataTransfer.getData('text/uri-list')
      || e.dataTransfer.getData('text/plain');
    if (!imageUrl) return;
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vp = viewportRef.current;
    const cx = (e.clientX - rect.left - vp.x) / vp.zoom;
    const cy = (e.clientY - rect.top - vp.y) / vp.zoom;

    const refImage: CanvasImageRef | undefined = structuredReference
      ? {
          ...structuredReference,
          name: structuredReference.name || '',
          description: structuredReference.name || '',
        }
      : undefined;
    addCanvasImageNode(imageUrl, cx, cy, refImage);
  }, [addCanvasImageNode]);

  // Transient UI ownership only; the original transfer remains the authority.
  const [materialTouchAvailable, setMaterialTouchAvailable] = useState(false);
  const materialTouchClickRef = useRef<{ owner: HTMLButtonElement; pointerId: number } | null>(null);
  const materialTouchScopeRef = useRef({ key: workflowInputScope, epoch: 0 });
  if (materialTouchScopeRef.current.key !== workflowInputScope) {
    materialTouchScopeRef.current = { key: workflowInputScope, epoch: materialTouchScopeRef.current.epoch + 1 };
  }
  const materialImagesRef = useRef(canvasImages);
  materialImagesRef.current = canvasImages;
  const materialTouchRef = useRef<{
    pointerId: number; owner: HTMLButtonElement; epoch: number; image: CanvasImageRef;
    startX: number; startY: number; moved: boolean;
  } | null>(null);
  const [materialTouchPreview, setMaterialTouchPreview] = useState<{ x: number; y: number; label: string } | null>(null);
  const cancelMaterialTouch = useCallback((render = true, suppressClick = true): void => {
    const active = materialTouchRef.current;
    materialTouchRef.current = null;
    if (active && suppressClick) materialTouchClickRef.current = { owner: active.owner, pointerId: active.pointerId };
    if (render) setMaterialTouchPreview(null);
    if (active?.owner.hasPointerCapture(active.pointerId)) {
      try { active.owner.releasePointerCapture(active.pointerId); } catch { /* Removed DOM owner. */ }
    }
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(any-pointer: coarse)');
    const update = (): void => {
      const available = navigator.maxTouchPoints > 0;
      setMaterialTouchAvailable(available);
      if (!available) cancelMaterialTouch();
    };
    update();
    media.addEventListener('change', update); window.addEventListener('focus', update);
    return () => { media.removeEventListener('change', update); window.removeEventListener('focus', update); };
  }, [cancelMaterialTouch]);
  const beginMaterialTouch = useCallback((event: React.PointerEvent<HTMLButtonElement>, image: CanvasImageRef): void => {
    if (event.pointerType !== 'touch') { materialTouchClickRef.current = null; return; }
    if (!event.isPrimary || event.button !== 0) return;
    materialTouchClickRef.current = null;
    event.preventDefault(); event.stopPropagation();
    if (materialTouchRef.current || legacyNodePointerRef.current || legacyMobilePointerRef.current?.busy()) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const owner = event.currentTarget;
    try { owner.setPointerCapture(event.pointerId); } catch { return; }
    if (!owner.hasPointerCapture(event.pointerId)) return;
    materialTouchRef.current = { pointerId: event.pointerId, owner, epoch: materialTouchScopeRef.current.epoch,
      image: { ...image }, startX: event.clientX, startY: event.clientY, moved: false };
  }, []);
  const moveMaterialTouch = useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = materialTouchRef.current;
    if (!active || event.pointerType !== 'touch' || active.pointerId !== event.pointerId || active.owner !== event.currentTarget) return;
    event.preventDefault(); event.stopPropagation();
    if (active.epoch !== materialTouchScopeRef.current.epoch || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      cancelMaterialTouch(); return;
    }
    active.moved ||= Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >= 6;
    if (active.moved) setMaterialTouchPreview({ x: Math.max(0, Math.min(event.clientX + 12, window.innerWidth - 160)),
      y: Math.max(0, Math.min(event.clientY + 12, window.innerHeight - 44)), label: active.image.description || active.image.name || '素材' });
  }, [cancelMaterialTouch]);
  const finishMaterialTouch = useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = materialTouchRef.current;
    if (!active || event.pointerType !== 'touch' || active.pointerId !== event.pointerId || active.owner !== event.currentTarget) return;
    event.preventDefault(); event.stopPropagation();
    const currentImage = materialImagesRef.current?.find(image => image.id === active.image.id);
    const sameImage = currentImage && (['id', 'url', 'projectId', 'assetId', 'assetVersionId', 'placementId', 'versionId', 'width', 'height'] as const)
      .every(key => currentImage[key] === active.image[key]);
    const root = canvasContainerRef.current;
    const hit = Number.isFinite(event.clientX) && Number.isFinite(event.clientY) ? document.elementFromPoint(event.clientX, event.clientY) : null;
    const valid = active.moved && active.epoch === materialTouchScopeRef.current.epoch && sameImage && root && hit
      && root.contains(hit) && !hit.closest('[data-node-id], [data-workflow-ui-occlusion], button, input, textarea, select, [role="dialog"]');
    const rect = root?.getBoundingClientRect(), vp = viewportRef.current;
    if (!active.moved) {
      cancelMaterialTouch(true, active.epoch !== materialTouchScopeRef.current.epoch || !sameImage);
      return; // A fresh tap uses the button's standard click activation.
    }
    cancelMaterialTouch(); // Clear ownership before capture release or graph mutation.
    if (!valid || !currentImage || !rect || !Number.isFinite(vp.zoom) || vp.zoom <= 0) return;
    addCanvasImageNode(currentImage.url, (event.clientX - rect.left - vp.x) / vp.zoom,
      (event.clientY - rect.top - vp.y) / vp.zoom, currentImage);
  }, [addCanvasImageNode, cancelMaterialTouch]);
  const activateMaterialTouchButton = useCallback((event: React.MouseEvent<HTMLButtonElement>, imageId: string): void => {
    event.preventDefault(); event.stopPropagation();
    const native = event.nativeEvent as MouseEvent & { pointerType?: string; pointerId?: number;
      sourceCapabilities?: { firesTouchEvents?: boolean } | null };
    const handled = materialTouchClickRef.current;
    const touchCompatibility = native.detail > 0 && (native.pointerType === 'touch'
      || native.sourceCapabilities?.firesTouchEvents === true || native.pointerType === undefined);
    if (handled?.owner === event.currentTarget && touchCompatibility
      && (native.pointerId === undefined || native.pointerId === handled.pointerId)) {
      materialTouchClickRef.current = null;
      return;
    }
    materialTouchClickRef.current = null;
    handleLibraryImage(imageId);
  }, [handleLibraryImage]);
  const cancelMaterialTouchEvent = useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = materialTouchRef.current;
    if (active && active.pointerId === event.pointerId && active.owner === event.currentTarget) cancelMaterialTouch();
  }, [cancelMaterialTouch]);
  useEffect(() => {
    const cancel = (): void => cancelMaterialTouch();
    const anotherPointer = (event: PointerEvent): void => { if (materialTouchRef.current && materialTouchRef.current.pointerId !== event.pointerId) cancel(); };
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('blur', cancel); window.addEventListener('pointerdown', anotherPointer, true); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('pointerdown', anotherPointer, true);
      window.removeEventListener('keydown', escape); cancelMaterialTouch(false); };
  }, [cancelMaterialTouch]);
  useEffect(() => { cancelMaterialTouch(); }, [workflowInputScope, cancelMaterialTouch]);

  const handleNodeUpdate = useCallback((nodeId: string, updates: Partial<WorkflowNode>): void => {
    const current = wf.nodes.find(node => node.id === nodeId);
    const sourceChanged = current?.type === 'input-image' && typeof updates.config?.source === 'string'
      && updates.config.source !== current.config.source;
    let applied = updates;
    if (current?.type === 'input-text' && updates.config) {
      const text = typeof updates.config.textContent === 'string' ? updates.config.textContent : updates.config.text;
      if (typeof text === 'string') applied = { ...updates, config: { ...updates.config, text, textContent: text } };
    }
    if (sourceChanged) {
      const config = { ...current.config, ...updates.config };
      const insertion = materialInsertionTransactionsRef.current.get(nodeId);
      if (current.config.assetTransferPending === true && !current.config.assetTransferError && insertion
        && insertion.guard === workflowInputTransferGuardRef.current) {
        const image = insertion.image;
        const expectedSource = { id: image.id, url: image.url, projectId: image.projectId, versionId: image.versionId,
          assetVersionId: image.assetVersionId, placementId: image.placementId };
        Object.assign(config, { assetTransferPending: true, assetTransferError: 'TRANSFER_INTERRUPTED',
          assetTransferExpectedActorId: userId || '', assetTransferExpectedProjectId: projectId,
          assetTransferExpectedSource: expectedSource });
        const live = wfRef.current.nodes.find(node => node.id === nodeId);
        if (live) settleMaterialInsertion(nodeId, live, { ...live, config: { ...live.config,
          assetTransferPending: true, assetTransferError: 'TRANSFER_INTERRUPTED',
          assetTransferExpectedActorId: userId || '', assetTransferExpectedProjectId: projectId,
          assetTransferExpectedSource: expectedSource } });
      }
      let ports = updates.ports || current.ports;
      if (config.source === 'upstream') {
        if (config.imageInputTransform === undefined) config.imageInputTransform = { version: 1, kind: 'identity' };
        const inputs = ports.filter(port => port.id === 'in-image');
        try {
          readWorkflowImageInputTransform({ ...current, config });
          if (inputs.length > 1 || inputs.some(port => port.type !== 'image' || port.direction !== 'in')) throw new Error('INVALID_IMAGE_RECEIVER_PORT');
        } catch {
          alert('图片接收设置无效，请检查接收端口和切分设置。');
          return;
        }
        if (!inputs.length) ports = [...ports, { id: 'in-image', label: '上游图片', type: 'image', direction: 'in' }];
      }
      if (config.assetTransferPending === true && config.assetTransferError !== 'ACTOR_SCOPE_CHANGED' && config.assetTransferError !== 'TRANSFER_INTERRUPTED') config.assetTransferPending = false;
      applied = { ...updates, config, ports };
    }
    if (sourceChanged || shouldInvalidateWorkflowInputTransfer(current?.config.imageUrl, applied.config)) {
      workflowInputTransferGuardRef.current.invalidate(nodeId);
      workflowInputActorRetries.current.delete(JSON.stringify([workflowInputScope, nodeId]));
      materialInsertionTransactionsRef.current.delete(nodeId);
    }
    updateWorkflow(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === nodeId ? mergeWorkflowNodeUpdate(n, applied) : n),
    }));
  }, [projectId, settleMaterialInsertion, updateWorkflow, userId, wf.nodes, workflowInputScope]);

  // P0: LLM优化提示词
  const handleLlmOptimize = useCallback(async (nodeId: string, _prompt: string, model: string, systemPrompt: string, instruction: string) => {
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const currentText = String(node.config?.textContent || node.config?.text || node.config?.promptText || '');
    if (!currentText.trim()) return; // 空文本不优化
    handleNodeUpdate(nodeId, { config: { ...node.config, llmOptimizing: true } });
    try {
      const exactModel = parseExactModelKey(model || String(node.config?.llmModel || ''));
      if (!exactModel) throw new Error('请重新选择提示词优化模型及供应商');
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt || instruction || '你是一个专业的AI图像提示词优化助手。请优化用户提供的提示词，使其更加详细、精确，适合AI图像生成。请用中文输出优化后的提示词，不要添加任何解释。' },
            { role: 'user', content: currentText },
          ],
          model: exactModel.modelId,
          providerId: exactModel.providerId,
          stream: false, // 非流式请求，直接获取JSON结果
        }),
      });
      if (!res.ok) throw new Error('LLM请求失败');
      const data = await res.json();
      // 兼容多种响应格式
      const optimized = data.choices?.[0]?.message?.content || data.content || data.text || data.output || currentText;
      handleNodeUpdate(nodeId, { config: { ...node.config, textContent: optimized, promptText: optimized, llmOptimizing: false } });
    } catch (err) {
      console.error('LLM优化失败:', err);
      handleNodeUpdate(nodeId, { config: { ...node.config, llmOptimizing: false } });
    }
  }, [wf.nodes, handleNodeUpdate]);

  const submitWorkflowExecution = useCallback(async (payload: {
    nodes: WorkflowNode[];
    connections: WorkflowConnection[];
    startNodeId?: string;
    tailNodeId?: string;
  }) => {
    const submissionViewScope = executionViewScope;
    if (imageRetryRequestRef.current || imageRetryViewRef.current?.active || imageRetryViewRef.current?.pending) return;
    if (unavailableSketchModel(payload.nodes, modelCatalogIndex, modelsLoading) || (containsSketchNode(payload.nodes) && sketchScope.authority === 'unknown')) {
      setExecStatus('failed'); setExecLogs([{ time: Date.now(), nodeId: 'workflow', label: '工作流', status: 'error', message: '请在当前授权项目选择可用的同步视觉聊天模型' }]); setShowExecLog(true); return;
    }
    try {
      payload = resolveWorkflowExecutionScope(payload);
    } catch (error) {
      setExecStatus('failed');
      setExecLogs([{ time: Date.now(), nodeId: 'workflow', label: '工作流', status: 'error', message: error instanceof Error ? error.message : '无法确定运行范围' }]);
      setShowExecLog(true);
      return;
    }
    const executionNodes: WorkflowNode[] = [];
    for (const node of payload.nodes) {
      if (node.type === 'input-image') {
        if (node.config.assetTransferPending === true) {
          setExecStatus('failed');
          setExecLogs([{ time: Date.now(), nodeId: node.id, label: node.label, status: 'error', message: '图片资产正在同步，请完成后再运行工作流' }]);
          setShowExecLog(true);
          return;
        }
        // 仅移除画布选图的界面追踪标记，保留权威资产引用及服务端严格校验。
        const config = Object.fromEntries(Object.entries(node.config)
          .filter(([key]) => !['sourceImageId', 'sourceVersionId', 'assetTransferPending'].includes(key)));
        executionNodes.push({ ...node, config });
        continue;
      }
      if (node.type === 'ai-skill') {
        const skill = workflowSkills.find(candidate => (
          candidate.id === node.config.skillId && candidate.version === Number(node.config.version)
        ));
        const roles = new Set(skill ? requiredSkillModelRoles(skill) : []);
        const configured = node.config.modelBindings && typeof node.config.modelBindings === 'object'
          && !Array.isArray(node.config.modelBindings)
          ? node.config.modelBindings as Record<string, unknown>
          : {};
        const modelBindings = Object.fromEntries(
          Object.entries(configured).filter(([role]) => roles.has(role as SkillModelBinding['role'])),
        );
        executionNodes.push({ ...node, config: { ...node.config, modelBindings } });
        continue;
      }
      if (node.type !== 'ai-generate') {
        executionNodes.push(node);
        continue;
      }
      const model = String(node.config?.model || '');
      const providerId = String(node.config?.providerId || '');
      const persistedKey = model && providerId && !parseExactModelKey(model) ? `${providerId}::${model}` : model;
      const selection = resolvePersistedModelSelection(
        persistedKey,
        imageModels.filter(item => item.providerId).map(item => ({ id: item.id, providerId: item.providerId! })),
      );
      if (!selection.compositeKey) {
        setExecStatus('failed');
        setExecLogs([{ time: Date.now(), nodeId: node.id, label: node.label, status: 'error', message: '请重新选择明确的图像模型及供应商' }]);
        setShowExecLog(true);
        return;
      }
      executionNodes.push({ ...node, config: { ...node.config, model: selection.compositeKey, providerId: selection.providerId } });
    }
    imageRetryViewRef.current = null;
    imageRetryEpochRef.current += 1;
    setExecutionNodeIds(executionNodes.map(node => node.id));
    setExecStatus('running');
    setExecutionId(null);
    setExecResults({});
    setExecLogs([]);
    try {
      const res = await fetch('/api/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', projectId, workflowId: wf.id, ...payload, nodes: executionNodes }),
      });
      const data = await res.json().catch(() => null) as { executionId?: string; error?: string } | null;
      if (executionViewScopeRef.current !== submissionViewScope) return;
      if (!res.ok || !data?.executionId) {
        setExecStatus('failed');
        setExecLogs([{
          time: Date.now(), nodeId: 'workflow', label: '工作流', status: 'error',
          message: typeof data?.error === 'string' && data.error ? data.error : `工作流启动失败 (${res.status})`,
        }]);
        setShowExecLog(true);
        return;
      }
      workflowCanvasPersistenceRef.current = {
        executionId: data.executionId,
        settled: false,
        failedOutputNodeIds: new Set<string>(),
      };
      setExecutionId(data.executionId);
      localStorage.setItem(WORKFLOW_EXEC_STATE_KEY, JSON.stringify({
        executionId: data.executionId,
        nodeIds: executionNodes.map(node => node.id),
        execStatus: 'running',
        execResults: {},
        execLogs: [],
      }));
    } catch {
      if (executionViewScopeRef.current !== submissionViewScope) return;
      setExecStatus('failed');
      setExecLogs([{ time: Date.now(), nodeId: 'workflow', label: '工作流', status: 'error', message: '工作流启动请求失败，请重试' }]);
      setShowExecLog(true);
    }
  }, [projectId, imageModels, wf.id, workflowSkills, WORKFLOW_EXEC_STATE_KEY, executionViewScope, modelCatalogIndex, modelsLoading, sketchScope]);

  const startWorkflowExecution = useCallback(async (payload: WorkflowExecutionScope) => {
    if (skillExecutionLock.current || skillQuote || ['running', 'paused'].includes(execStatus)) return;
    skillExecutionLock.current = true;
    const controller = new AbortController();
    skillEstimateController.current = controller;
    const timeout = setTimeout(() => controller.abort(new Error('费用预估超时，请重试')), 15000);
    try {
      const scope = resolveWorkflowExecutionScope(payload);
      if (!scope.nodes.some(node => node.type === 'ai-skill')) {
        await submitWorkflowExecution(scope);
        return;
      }
      if (!projectId) throw new Error('请先保存项目再运行 Skill');
      setSkillEstimating(true);
      const result = await estimateWorkflowSkills(scope, workflowSkills, {
        projectId, workflowId: wf.id, requestKey: crypto.randomUUID(),
      }, controller.signal);
      if (controller.signal.aborted || !isWorkflowExecutionScopeCurrent(scope,
        skillWorkflowRef.current.nodes, skillWorkflowRef.current.connections)) return;
      setSkillQuote({ ...result, projectId, expiresAt: Date.now() + 60000 });
    } catch (error) {
      if (!isWorkflowExecutionScopeCurrent(payload,
        skillWorkflowRef.current.nodes, skillWorkflowRef.current.connections)
        || (controller.signal.aborted && controller.signal.reason?.name === 'AbortError')) return;
      setExecLogs([{ time: Date.now(), nodeId: 'workflow', label: '费用预估', status: 'error', message: error instanceof Error ? error.message : '费用预估失败' }]);
      setShowExecLog(true);
    } finally {
      clearTimeout(timeout);
      if (skillEstimateController.current === controller) {
        skillEstimateController.current = null;
        skillExecutionLock.current = false;
        setSkillEstimating(false);
      }
    }
  }, [execStatus, projectId, skillQuote, submitWorkflowExecution, wf, workflowSkills]);

  const confirmSkillExecution = useCallback(async () => {
    if (!skillQuote || skillExecutionLock.current) return;
    if (!isWorkflowExecutionScopeCurrent(skillQuote.scope,
      skillWorkflowRef.current.nodes, skillWorkflowRef.current.connections)
      || skillQuote.projectId !== projectId || Date.now() > skillQuote.expiresAt) {
      setSkillQuote(null);
      setExecLogs([{ time: Date.now(), nodeId: 'workflow', label: '费用预估', status: 'error', message: '预估已过期或配置已变化，请重新执行以获取预估' }]);
      setShowExecLog(true);
      return;
    }
    skillExecutionLock.current = true;
    setSkillQuote(null);
    try { await submitWorkflowExecution(skillQuote.scope); }
    finally { skillExecutionLock.current = false; }
  }, [projectId, skillQuote, submitWorkflowExecution]);

  // P0: 级联一键运行 — 找到当前节点的整条链，从上游到下游依次执行
  const handleCascadeRun = useCallback(async (startNodeId: string) => {
    // 找到链尾（最下游的图片输出节点）
    const findChainTail = (nodeId: string, visited: Set<string>): string => {
      if (visited.has(nodeId)) return nodeId;
      visited.add(nodeId);
      const downstream = wf.connections.filter(c => c.fromNodeId === nodeId);
      if (downstream.length === 0) return nodeId;
      return findChainTail(downstream[0].toNodeId, visited);
    };
    const tailId = findChainTail(startNodeId, new Set());
    await startWorkflowExecution({
      startNodeId,
      tailNodeId: tailId,
      nodes: wf.nodes,
      connections: wf.connections,
    });
  }, [startWorkflowExecution, wf.connections, wf.nodes]);
  useEffect(() => { handleCascadeRunRef.current = handleCascadeRun; }, [handleCascadeRun]);


  // P0: 节点字段变更（用于节点上直接编辑）
  const handleNodeFieldChange = useCallback((nodeId: string, field: string, value: unknown) => {
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    handleNodeUpdate(nodeId, { config: { [field]: value } });
    // 当生图节点修改画面比例时，同步调整自动创建的输出图片节点尺寸
    if (field === 'aspectRatio' && isImageGeneratingNode(node.type)) {
      const outSize = getOutputNodeSize(value as string | undefined);
      // 查找与此节点通过 image 连线直接相连的 output-image 节点
      const outConn = wf.connections.find(c =>
        c.fromNodeId === nodeId && c.type === 'image'
      );
      if (outConn) {
        const outNode = wf.nodes.find(n => n.id === outConn.toNodeId);
        if (outNode && (outNode.type === 'output-image' || outNode.type === 'output-image-group')) {
          handleNodeUpdate(outNode.id, {
            width: Math.max(outSize.width, 140),
            height: Math.max(outSize.height, 120),
          });
        }
      }
    }
  }, [wf.nodes, wf.connections, handleNodeUpdate]);

  // P2: 抽取图片到上游源节点
  const handleExtractToSource = useCallback((nodeId: string) => {
    const current = wfRef.current;
    const node = current.nodes.find(n => n.id === nodeId);
    if (!node || node.type !== 'input-image') return;
    if (node.config.assetTransferPending === true) { alert('图片正在载入，请稍后再试。'); return; }
    try {
      sketchScope.assertCurrent();
      const planned = planWorkflowImageExtraction(current, nodeId, projectId!);
      workflowInputTransferGuardRef.current.invalidate(nodeId);
      // Source, receiver and edges form one history entry; keep the original
      // preview, asset/version identity and all existing downstream connections.
      updateWorkflow(planned);
    } catch {
      alert('无法抽取当前图片，请确认图片来源和上游连线后重试。');
    }
  }, [projectId, sketchScope, updateWorkflow]);

  // P2: 宫格切分
  const handleGridSplit = useCallback((nodeId: string, cols: number, rows: number) => {
    void gridClientRef.current!.run(nodeId, cols, rows);
  }, []);

  // P2: 对比滑块 — 找到上游原图，与当前节点图片对比
  const resolveCompareImages = useCallback((nodeId: string): { before: string; after: string } | undefined => {
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const imageUrl = (node.config?.imageUrl as string) || (execResults[nodeId]?.output?.imageUrl as string);
    if (!imageUrl) return;
    // 查找上游输入图片
    const upstreamConn = wf.connections.find(c => c.toNodeId === nodeId && (c.type === 'image' || c.type === 'data'));
    let beforeUrl = '';
    if (upstreamConn) {
      const upNode = wf.nodes.find(n => n.id === upstreamConn.fromNodeId);
      beforeUrl = (upNode?.config?.imageUrl as string) || (execResults[upstreamConn.fromNodeId]?.output?.imageUrl as string) || '';
    }
    if (!beforeUrl) return;
    return { before: beforeUrl, after: imageUrl };
  }, [wf.nodes, wf.connections, execResults]);

  const handleCompare = useCallback((nodeId: string): void => {
    const images = resolveCompareImages(nodeId);
    if (images) setCompareImages(images);
  }, [resolveCompareImages]);

  const selectedNodeCompareImages = useMemo(
    () => selectedNode ? resolveCompareImages(selectedNode.id) : undefined,
    [selectedNode, resolveCompareImages],
  );

  const handleSendWorkflowResultToChat = useCallback(async (nodeId: string) => {
    if (!projectId || !executionId) {
      setExecLogs(prev => mergeExecutionLogs(prev, [{
        time: Date.now(), nodeId, label: wf.nodes.find(node => node.id === nodeId)?.label || nodeId,
        status: 'error', message: '工作流结果尚未完成，无法发送到智能对话',
      }]));
      return;
    }
    const canvasPersistence = workflowCanvasPersistenceRef.current;
    if (canvasPersistence?.executionId === executionId) {
      for (let attempt = 0; attempt < 300 && !canvasPersistence.settled; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (
        !canvasPersistence.settled
        || canvasPersistence.failedOutputNodeIds.has(nodeId)
      ) {
        setExecLogs(prev => mergeExecutionLogs(prev, [{
          time: Date.now(), nodeId, label: wf.nodes.find(node => node.id === nodeId)?.label || nodeId,
          status: 'error', message: '工作流结果尚未完成画布持久化，无法发送到智能对话',
        }]));
        return;
      }
    }
    const reference = resolveWorkflowOutputAssetReference(
      nodeId,
      wf.nodes,
      wf.connections,
      execResults,
    );
    if (!reference?.assetVersionId) {
      setExecLogs(prev => mergeExecutionLogs(prev, [{
        time: Date.now(), nodeId, label: wf.nodes.find(node => node.id === nodeId)?.label || nodeId,
        status: 'error', message: '输出缺少规范素材版本，无法发送到智能对话',
      }]));
      return;
    }
    const targetChatProjectId = localStorage.getItem('wujie_last_simple_chat_project') || undefined;
    const targetUrl = buildWorkflowChatReturnIntentUrl({
      assetProjectId: projectId,
      sourceVersionId: reference.assetVersionId,
      workflowId: wf.id,
      executionId,
      outputNodeId: nodeId,
      outputLabel: wf.nodes.find(node => node.id === nodeId)?.label || '工作流结果',
    }, targetChatProjectId);
    try {
      if (canvasDocumentMode && !onBeforeWorkflowChatNavigation) {
        throw new Error('工作流输出尚未在协作文档中确认');
      }
      await navigateToWorkflowChatAfterPersistence(
        targetUrl,
        async () => { await onBeforeWorkflowChatNavigation?.(reference); },
        target => window.location.assign(target),
      );
    } catch (error) {
      setExecLogs(prev => mergeExecutionLogs(prev, [{
        time: Date.now(), nodeId, label: wf.nodes.find(node => node.id === nodeId)?.label || nodeId,
        status: 'error', message: error instanceof Error ? error.message : '保存工作区失败，未跳转到智能对话',
      }]));
    }
  }, [canvasDocumentMode, execResults, executionId, onBeforeWorkflowChatNavigation, projectId, wf.connections, wf.id, wf.nodes]);

  // P1: 键盘快捷键 (复制/粘贴/删除)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (jsonEditorOpen) return;
      const event = e;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;

      if (event.key === 'Escape' && nodeAnnotationCandidates) {
        event.preventDefault();
        setNodeAnnotationCandidates(null);
        return;
      }

      if (event.code === 'KeyC' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (nodeAnnotationCandidates) setNodeAnnotationCandidates(null);
        else if (nodeAnnotationSession) setNodeAnnotationSession(null);
        else requestNodeAnnotation(selectedNode);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setAiBuildOpen(true);
        return;
      }

      // Ctrl+C / Cmd+C 复制选中节点（支持多选）
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedNodeIds.size > 0) {
        e.preventDefault();
        setClipboard(createWorkflowClipboardSnapshot(wf, [...selectedNodeIds]));
      }
      // Ctrl+V / Cmd+V 粘贴节点
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && clipboard) {
        e.preventDefault();
        const transactionId = `keyboard-node-copy:${++editorTransactionCounterRef.current}`;
        const result = handleWorkflowRenderCommand({
          type: 'clipboard.paste',
          snapshot: clipboard,
          offset: { x: 40, y: 40 },
          transactionId,
        });
        if (result.createdNodeIds.length > 0) {
          setSelectedNodeIds(new Set(result.createdNodeIds));
          setSidebarTab('props');
        }
      }
      // Delete / Backspace 删除选中节点（支持多选）
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIds.size > 0) {
        e.preventDefault();
        const nodeIds = [...selectedNodeIds];
        nodeIds.forEach(id => workflowInputTransferGuardRef.current.invalidate(id));
        handleWorkflowRenderCommand({
          type: 'nodes.delete',
          nodeIds,
          transactionId: `keyboard-node-delete:${++editorTransactionCounterRef.current}`,
        });
        setSelectedNodeIds(new Set());
      }
      // Ctrl+Z / Cmd+Z 撤销
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl+Shift+Z / Cmd+Shift+Z 重做
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jsonEditorOpen, selectedNodeIds, selectedNodeId, selectedNode, clipboard, wf, handleWorkflowRenderCommand, handleUndo, handleRedo, nodeAnnotationCandidates, nodeAnnotationSession, requestNodeAnnotation]);

  // ─── 连线操作 (含端口类型约束) ───

  const clearLegacyConnection = useCallback((): void => {
    draggingConnRef.current = null;
    connectionScopeRef.current = null;
    setDraggingConn(null);
  }, []);

  const completeLegacyConnection = useCallback((source: LegacyPortEndpoint, target: LegacyPortEndpoint, sourceType: PortType, scope: string): void => {
    clearLegacyConnection();
    if (scope !== legacyPointerScopeRef.current || source.direction !== 'out' || target.direction !== 'in' || source.nodeId === target.nodeId) return;
    const current = wfRef.current;
    const from = current.nodes.find(node => node.id === source.nodeId)?.ports.find(port => port.id === source.portId && port.direction === 'out');
    const to = current.nodes.find(node => node.id === target.nodeId)?.ports.find(port => port.id === target.portId && port.direction === 'in');
    if (!from || !to || from.type !== sourceType || !canConnectPorts(from.type, to.type)) return;
    if (current.connections.some(connection => connection.fromNodeId === source.nodeId && connection.fromPortId === source.portId
      && connection.toNodeId === target.nodeId && connection.toPortId === target.portId)) return;
    const connection = createConnection(source.nodeId, source.portId, target.nodeId, target.portId, from.type);
    handleWorkflowRenderCommand({ type: 'connection.create', connection, transactionId: `legacy-connection:${connection.id}` });
  }, [clearLegacyConnection, handleWorkflowRenderCommand]);

  const beginLegacyConnection = useCallback((source: LegacyPortEndpoint, element: HTMLElement): boolean => {
    const node = wfRef.current.nodes.find(candidate => candidate.id === source.nodeId);
    const port = node?.ports.find(candidate => candidate.id === source.portId && candidate.direction === 'out');
    if (!node || !port || source.direction !== 'out') return false;
    const local = getPortPositionLocalRef.current(node, port);
    const layer = nodeViewportTransformRef.current;
    const visualPort = element.hasAttribute('data-port-id') ? element : [...(layer?.querySelectorAll<HTMLElement>('[data-port-id]') ?? [])].find(candidate =>
      candidate.dataset.workflowPortNode === source.nodeId && candidate.dataset.workflowPortKey === source.portId && candidate.dataset.workflowPortDirection === 'out');
    const pos = getLegacyPortWorldPosition(visualPort ?? element, layer)
      ?? (local ? { x: node.x + local.x, y: node.y + local.y } : null);
    if (!pos) return false;
    const next = { fromNodeId: node.id, fromPortId: port.id, fromX: pos.x, fromY: pos.y, toX: pos.x, toY: pos.y, portType: port.type };
    connectionScopeRef.current = legacyPointerScopeRef.current;
    draggingConnRef.current = next;
    setDraggingConn(next);
    return true;
  }, []);

  const handlePortMouseDown = useCallback((e: React.MouseEvent, nodeId: string, port: NodePort) => {
    e.stopPropagation();
    if (legacyNodePointerRef.current || legacyMobilePointerRef.current?.busy() || legacyMobilePointerRef.current?.suppressesMouse()) return;
    beginLegacyConnection({ nodeId, portId: port.id, direction: port.direction }, e.currentTarget as HTMLElement);
  }, [beginLegacyConnection]);

  const handlePortMouseUp = useCallback((nodeId: string, port: NodePort) => {
    if (legacyMobilePointerRef.current?.busy() || legacyMobilePointerRef.current?.suppressesMouse()) return;
    const drag = draggingConnRef.current, scope = connectionScopeRef.current;
    if (!drag || !scope || port.direction !== 'in') return;
    completeLegacyConnection({ nodeId: drag.fromNodeId, portId: drag.fromPortId, direction: 'out' },
      { nodeId, portId: port.id, direction: 'in' }, drag.portType, scope);
  }, [completeLegacyConnection]);

  // ─── 画布交互 ───

  const applyNodeDragPosition = useCallback((position: { id: string; x: number; y: number }) => {
    updateWorkflowSystem(current => ({
      ...current,
      nodes: current.nodes.map(node => node.id === position.id
        ? { ...node, x: position.x, y: position.y }
        : node),
    }));
  }, [updateWorkflowSystem]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (legacyNodePointerRef.current || legacyMobilePointerRef.current?.busy() || legacyMobilePointerRef.current?.suppressesMouse()) return;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // 中键或Alt+左键 = 平移
      const vp = viewportRef.current;
      nodePanPreviewRef.current = vp;
      setNodePanViewport(vp);
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, vx: vp.x, vy: vp.y });
    } else if (e.button === 0 && !draggingConn) {
      // 左键点击空白区域 = 取消选中 + 开始框选
      setSelectedNodeIds(new Set());
      setSidebarTab('nodes');
      // 开始框选
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      const vp = viewportRef.current;
      if (canvasRect) {
        const mx = (e.clientX - canvasRect.left - vp.x) / vp.zoom;
        const my = (e.clientY - canvasRect.top - vp.y) / vp.zoom;
        setBoxSelect({ startX: mx, startY: my, endX: mx, endY: my });
        isBoxSelectingRef.current = true;
      }
    }
  }, [draggingConn]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      updateNodePanPreview({
        x: panStart.vx + (e.clientX - panStart.x),
        y: panStart.vy + (e.clientY - panStart.y),
        zoom: viewportRef.current.zoom,
      });
    } else if (draggingNodeRef.current) {
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const vp = viewportRef.current;
      const mx = (e.clientX - canvasRect.left - vp.x) / vp.zoom;
      const my = (e.clientY - canvasRect.top - vp.y) / vp.zoom;
      const nodeId = draggingNodeRef.current;
      const offset = dragOffsetRef.current;
      const initial = nodeDragInitialPositionsRef.current.find(position => position.nodeId === nodeId)?.position;
      if (initial && (mx - offset.x !== initial.x || my - offset.y !== initial.y)) noteMaterialUserGeometry(nodeId);
      nodeDragPositionRef.current = { id: nodeId, x: mx - offset.x, y: my - offset.y };
      if (nodeDragRafRef.current === null) {
        nodeDragRafRef.current = requestAnimationFrame(() => {
          nodeDragRafRef.current = null;
          const position = nodeDragPositionRef.current;
          if (position) applyNodeDragPosition(position);
        });
      }
    } else if (draggingConn) {
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const vp = viewportRef.current;
      const mx = (e.clientX - canvasRect.left - vp.x) / vp.zoom;
      const my = (e.clientY - canvasRect.top - vp.y) / vp.zoom;
      const previous = draggingConnRef.current;
      const next = previous ? { ...previous, toX: mx, toY: my } : null;
      draggingConnRef.current = next;
      setDraggingConn(next);
    } else if (isBoxSelectingRef.current && boxSelect) {
      // 更新框选范围
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const vp = viewportRef.current;
      const mx = (e.clientX - canvasRect.left - vp.x) / vp.zoom;
      const my = (e.clientY - canvasRect.top - vp.y) / vp.zoom;
      setBoxSelect(prev => prev ? { ...prev, endX: mx, endY: my } : null);
    }
  }, [applyNodeDragPosition, isPanning, draggingConn, boxSelect, panStart.vx, panStart.x, panStart.vy, panStart.y, updateNodePanPreview, noteMaterialUserGeometry]);

  const handleCanvasMouseUp = useCallback(() => {
    if (legacyNodePointerRef.current || legacyMobilePointerRef.current?.busy() || legacyMobilePointerRef.current?.suppressesMouse()) return;
    if (isPanning) {
      if (nodePanRafRef.current !== null) {
        cancelAnimationFrame(nodePanRafRef.current);
        nodePanRafRef.current = null;
      }
      const finalViewport = nodePanPreviewRef.current;
      applyNodeViewportPreview(finalViewport);
      setNodePanViewport(finalViewport);
      setViewport(finalViewport);
    }
    setIsPanning(false);
    if (draggingNodeRef.current) {
      const finalPosition = nodeDragPositionRef.current;
      const finalPositions: WorkflowNodePosition[] = finalPosition
        ? [{ nodeId: finalPosition.id, position: { x: finalPosition.x, y: finalPosition.y } }]
        : [];
      if (nodeDragRafRef.current !== null) {
        cancelAnimationFrame(nodeDragRafRef.current);
        nodeDragRafRef.current = null;
      }
      nodeDragPositionRef.current = null;
      draggingNodeRef.current = null;
      if (finalPosition && nodeDragInitialPositionsRef.current.length > 0) {
        dispatchWorkflowStateCommand({
          type: 'nodes.drag.commit',
          initialPositions: nodeDragInitialPositionsRef.current,
          positions: finalPositions,
          transactionId: `legacy-node-drag:${finalPosition.id}:${++editorTransactionCounterRef.current}`,
        });
      }
      finishWorkflowDrag(finalPositions);
      nodeDragInitialPositionsRef.current = [];
      // 让外部同步由 effect 在本次拖拽状态提交后执行，避免在状态更新器中触发父组件更新。
      setWorkflowSyncRevision(revision => revision + 1);
    }
    clearLegacyConnection();
    // 完成框选：选中框内所有节点
    if (isBoxSelectingRef.current && boxSelect) {
      const minX = Math.min(boxSelect.startX, boxSelect.endX);
      const maxX = Math.max(boxSelect.startX, boxSelect.endX);
      const minY = Math.min(boxSelect.startY, boxSelect.endY);
      const maxY = Math.max(boxSelect.startY, boxSelect.endY);
      // 判断是否有实际框选范围（避免单击误触发）
      const hasArea = (maxX - minX) > 10 || (maxY - minY) > 10;
      if (hasArea) {
        const nodesInBox = wf.nodes.filter(n =>
          n.x + n.width > minX && n.x < maxX && n.y + n.height > minY && n.y < maxY
        );
        if (nodesInBox.length > 0) {
          setSelectedNodeIds(new Set(nodesInBox.map(n => n.id)));
          setSidebarTab('props');
        }
      }
    }
    setBoxSelect(null);
    isBoxSelectingRef.current = false;
  }, [applyNodeViewportPreview, boxSelect, clearLegacyConnection, dispatchWorkflowStateCommand, finishWorkflowDrag, isPanning, wf.nodes]);

  const cancelLegacyNodePointer = useCallback((restorePreview = true, revealProperties = false): void => {
    const pointer = legacyNodePointerRef.current;
    if (!pointer) return;
    legacyNodePointerRef.current = null;
    if (nodeDragRafRef.current !== null) cancelAnimationFrame(nodeDragRafRef.current);
    nodeDragRafRef.current = null;
    const initialPositions = nodeDragInitialPositionsRef.current;
    nodeDragPositionRef.current = null;
    draggingNodeRef.current = null;
    nodeDragInitialPositionsRef.current = [];
    if (restorePreview && pointer.scope === legacyPointerScopeRef.current) {
      updateWorkflowSystem(current => ({ ...current, nodes: current.nodes.map(node => {
        const initial = initialPositions.find(position => position.nodeId === node.id);
        return initial ? { ...node, x: initial.position.x, y: initial.position.y } : node;
      }) }));
    }
    finishWorkflowDrag([]);
    if (restorePreview) setLegacyPropertiesDeferred(!revealProperties);
    if (pointer.owner.hasPointerCapture?.(pointer.pointerId)) {
      try { pointer.owner.releasePointerCapture(pointer.pointerId); } catch { /* already lost */ }
    }
  }, [finishWorkflowDrag, updateWorkflowSystem]);

  const handleLegacyNodePointerMove = useCallback((event: React.PointerEvent): void => {
    const pointer = legacyNodePointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId || pointer.pointerType !== event.pointerType || event.target !== pointer.owner) return;
    if (pointer.scope !== legacyPointerScopeRef.current) { cancelLegacyNodePointer(); return; }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    pointer.moved ||= Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) >= 3;
    if (pointer.moved) handleCanvasMouseMove(event);
  }, [cancelLegacyNodePointer, handleCanvasMouseMove]);

  const handleLegacyNodePointerUp = useCallback((event: React.PointerEvent): void => {
    const pointer = legacyNodePointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId || pointer.pointerType !== event.pointerType || event.target !== pointer.owner) return;
    if (pointer.scope !== legacyPointerScopeRef.current || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      cancelLegacyNodePointer(); return;
    }
    handleLegacyNodePointerMove(event);
    if (!pointer.moved) { cancelLegacyNodePointer(true, true); return; }
    // Settle once before releasing capture; its lost event cannot cancel a committed drag.
    legacyNodePointerRef.current = null;
    handleCanvasMouseUp();
    if (pointer.owner.hasPointerCapture?.(pointer.pointerId)) {
      try { pointer.owner.releasePointerCapture(pointer.pointerId); } catch { /* already lost */ }
    }
  }, [cancelLegacyNodePointer, handleCanvasMouseUp, handleLegacyNodePointerMove]);

  const handleLegacyNodePointerCancel = useCallback((event: React.PointerEvent): void => {
    const pointer = legacyNodePointerRef.current;
    if (pointer?.pointerId === event.pointerId && pointer.pointerType === event.pointerType && event.target === pointer.owner) cancelLegacyNodePointer();
  }, [cancelLegacyNodePointer]);

  useEffect(() => {
    const blur = (): void => cancelLegacyNodePointer();
    window.addEventListener('blur', blur);
    return (): void => { window.removeEventListener('blur', blur); cancelLegacyNodePointer(false); };
  }, [cancelLegacyNodePointer]);
  useEffect(() => {
    if (legacyNodePointerRef.current && legacyNodePointerRef.current.scope !== legacyPointerScopeRef.current) cancelLegacyNodePointer();
  }, [cancelLegacyNodePointer, legacyPointerScope]);

  legacyMobileOptionsRef.current = {
    getScope: () => legacyPointerScopeRef.current,
    getViewport: () => viewportRef.current,
    getCanvasRect: () => canvasContainerRef.current?.getBoundingClientRect() ?? null,
    isExternalGestureBusy: () => Boolean(legacyNodePointerRef.current || draggingNodeRef.current || portListSource),
    isWithinOwner: (owner, target) => owner instanceof HTMLElement && target instanceof Node && owner.contains(target),
    onPortBegin: (source, _point, owner) => owner instanceof HTMLElement && beginLegacyConnection(source, owner),
    onPortMove: (_source, point) => {
      const drag = draggingConnRef.current, rect = canvasContainerRef.current?.getBoundingClientRect(), vp = viewportRef.current;
      if (!drag || !rect || connectionScopeRef.current !== legacyPointerScopeRef.current) return;
      const next = { ...drag, toX: (point.x - rect.left - vp.x) / vp.zoom, toY: (point.y - rect.top - vp.y) / vp.zoom };
      draggingConnRef.current = next;
      setDraggingConn(next);
    },
    onPortEnd: (source, target) => {
      const drag = draggingConnRef.current, scope = connectionScopeRef.current;
      if (drag && scope && drag.fromNodeId === source.nodeId && drag.fromPortId === source.portId) completeLegacyConnection(source, target, drag.portType, scope);
      else clearLegacyConnection();
    },
    onPortCancel: clearLegacyConnection,
    resolvePortAt: point => {
      const element = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-workflow-port-node][data-workflow-port-key][data-workflow-port-direction]');
      if (!element || !canvasContainerRef.current?.contains(element)) return null;
      const nodeId = element.dataset.workflowPortNode, portId = element.dataset.workflowPortKey, direction = element.dataset.workflowPortDirection;
      if (!nodeId || !portId || (direction !== 'in' && direction !== 'out')) return null;
      const port = wfRef.current.nodes.find(node => node.id === nodeId)?.ports.find(candidate => candidate.id === portId && candidate.direction === direction);
      return port ? { nodeId, portId, direction } : null;
    },
    onViewportBegin: initial => { nodePanPreviewRef.current = initial; setNodePanViewport(initial); setIsPanning(true); },
    onViewportPreview: updateNodePanPreview,
    onViewportEnd: (next, commit, restore) => {
      if (nodePanRafRef.current !== null) cancelAnimationFrame(nodePanRafRef.current);
      nodePanRafRef.current = null;
      if (restore) {
        nodePanPreviewRef.current = next;
        applyNodeViewportPreview(next);
        setNodePanViewport(next);
        // View changes never enter node/connection history.
        if (commit || viewportRef.current.x !== next.x || viewportRef.current.y !== next.y || viewportRef.current.zoom !== next.zoom) setViewport(next);
      }
      setIsPanning(false);
    },
    onBlankTap: () => { setSelectedNodeIds(new Set()); setSidebarTab('nodes'); },
    onLongPress: point => {
      const root = canvasContainerRef.current;
      if (!root) return;
      const target = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-node-id]');
      const nodeId = target && root.contains(target) ? target.dataset.nodeId : undefined;
      const node = wfRef.current.nodes.find(candidate => candidate.id === nodeId);
      setContextMenu({ type: node ? 'node' : 'canvas', nodeId: node?.id, x: point.x, y: point.y,
        scope: legacyPointerScopeRef.current, returnFocus: node && target ? target : root });
    },
  };
  if (!legacyMobilePointerRef.current) {
    // Stable owner, fresh host callbacks: no gesture captures an old workflow closure.
    const current = (): LegacyMobilePointerOptions => legacyMobileOptionsRef.current!;
    legacyMobilePointerRef.current = createLegacyMobilePointerController({
      getScope: () => current().getScope(), getViewport: () => current().getViewport(), getCanvasRect: () => current().getCanvasRect(),
      isExternalGestureBusy: () => current().isExternalGestureBusy(), isWithinOwner: (owner, target) => current().isWithinOwner(owner, target),
      onPortBegin: (source, point, owner) => current().onPortBegin(source, point, owner), onPortMove: (source, point) => current().onPortMove(source, point),
      onPortEnd: (source, target) => current().onPortEnd(source, target), onPortCancel: () => current().onPortCancel(), resolvePortAt: point => current().resolvePortAt(point),
      onViewportBegin: initial => current().onViewportBegin(initial), onViewportPreview: next => current().onViewportPreview(next),
      onViewportEnd: (next, commit, restore) => current().onViewportEnd(next, commit, restore), onBlankTap: () => current().onBlankTap(),
      onLongPress: (point, target) => current().onLongPress(point, target),
    });
  }
  const handleLegacySurfacePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const controller = legacyMobilePointerRef.current!;
    controller.freshPointer(event);
    if (workflowRendererMode === 'react-flow-v2' || event.pointerType !== 'touch') return;
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
    if (target.closest('button, input, textarea, select, a, [role="button"], [contenteditable="true"], .port-dot, [data-workflow-port-key]')) {
      if (controller.hasViewport()) controller.cancelAll();
      return;
    }
    if (!controller.hasViewport() && target.closest('[data-workflow-node-drag-handle]')) return;
    const kind = target.closest('[data-node-id], [data-edge-id]') ? 'image' : 'blank';
    if (controller.beginViewport(event.currentTarget, event, kind)) { event.preventDefault(); event.stopPropagation(); }
  };
  const requestLegacyPortList = useCallback((endpoint: LegacyPortEndpoint): void => {
    const port = wfRef.current.nodes.find(node => node.id === endpoint.nodeId)?.ports.find(candidate => candidate.id === endpoint.portId && candidate.direction === endpoint.direction);
    if (!port || legacyNodePointerRef.current) return;
    legacyMobilePointerRef.current?.cancelAll();
    clearLegacyConnection();
    setSelectedNodeIds(new Set([endpoint.nodeId])); setSidebarTab('props'); setLegacyPropertiesDeferred(false);
    setPortListSource(endpoint.direction === 'out' ? { endpoint, type: port.type, scope: legacyPointerScopeRef.current } : null);
    setPortListOpen(true);
  }, [clearLegacyConnection]);
  const handleLegacyPortPointerDown = (event: React.PointerEvent<HTMLElement>, nodeId: string, port: NodePort): void => {
    if (workflowRendererMode === 'react-flow-v2') return;
    if (event.pointerType === 'touch' && !event.currentTarget.hasAttribute('data-workflow-direct-port-target')
      && window.matchMedia('(any-pointer: coarse)').matches && event.isPrimary && event.button === 0) {
      event.preventDefault(); event.stopPropagation();
      requestLegacyPortList({ nodeId, portId: port.id, direction: port.direction });
      return;
    }
    if (legacyMobilePointerRef.current!.beginPort(event.currentTarget, event, { nodeId, portId: port.id, direction: port.direction })) {
      event.preventDefault(); event.stopPropagation();
    }
  };
  useLayoutEffect(() => {
    legacyMobilePointerRef.current?.cancelAll();
    clearLegacyConnection();
    setPortListSource(null);
    setPortListOpen(false);
    setContextMenu(null);
  }, [clearLegacyConnection, legacyPointerScope]);
  useEffect(() => {
    const root = canvasContainerRef.current;
    const controller = legacyMobilePointerRef.current!;
    const guard = (event: TouchEvent): void => {
      if (!root || !controller.blocksNativeTouch() || !event.cancelable || event.touches.length === 0) return;
      const touches = Array.from(event.touches);
      if (!controller.matchesNativeTouchTargets(touches.map(touch => touch.target))) { controller.cancelAll(); return; }
      const safe = touches.every(touch => touch.target instanceof Element && root.contains(touch.target)
        && !touch.target.closest('button, input, textarea, select, a, [role="button"], [contenteditable="true"]'));
      if (safe) event.preventDefault();
    };
    const blur = (): void => controller.cancelAll();
    root?.addEventListener('touchstart', guard, { passive: false });
    root?.addEventListener('touchmove', guard, { passive: false });
    window.addEventListener('blur', blur);
    return () => { root?.removeEventListener('touchstart', guard); root?.removeEventListener('touchmove', guard); window.removeEventListener('blur', blur); controller.cancelAll(); };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (legacyMobilePointerRef.current?.busy() || legacyNodePointerRef.current) return;
    e.preventDefault();
    nodeWheelDeltaRef.current += e.deltaY;
    if (nodeWheelRafRef.current !== null) return;
    nodeWheelRafRef.current = requestAnimationFrame(() => {
      nodeWheelRafRef.current = null;
      const delta = nodeWheelDeltaRef.current;
      nodeWheelDeltaRef.current = 0;
      const factor = Math.exp(-delta * 0.0015);
      setViewport(current => ({
        ...current,
        zoom: Math.max(0.15, Math.min(3, current.zoom * factor)),
      }));
    });
  }, []);

  // ─── 右键菜单 ───
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    legacyMobilePointerRef.current?.cancelAll();
    setContextMenu({ type: 'canvas', x: e.clientX, y: e.clientY, scope: legacyPointerScopeRef.current, returnFocus: e.currentTarget instanceof HTMLElement ? e.currentTarget : undefined });
  }, []);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    legacyMobilePointerRef.current?.cancelAll();
    setContextMenu({ type: 'node', x: e.clientX, y: e.clientY, nodeId, scope: legacyPointerScopeRef.current, returnFocus: e.currentTarget instanceof HTMLElement ? e.currentTarget : undefined });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ESC关闭右键菜单
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && contextMenu) closeContextMenu(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [contextMenu, closeContextMenu]);

  const handleContextAction = useCallback((action: string) => {
    if (!contextMenu) return;
    if (contextMenu.scope && contextMenu.scope !== legacyPointerScopeRef.current) { closeContextMenu(); return; }
    if (contextMenu?.type === 'canvas') {
      switch (action) {
        case 'add-node': {
          // 在右键位置添加一个AI生成节点
          const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
          const vp = viewportRef.current;
          const mx = canvasRect ? (contextMenu.x - canvasRect.left - vp.x) / vp.zoom : 100;
          const my = canvasRect ? (contextMenu.y - canvasRect.top - vp.y) / vp.zoom : 100;
          const newNode = createWorkflowNode('ai-generate', mx - 160, my - 60);
          updateWorkflow(prev => ({ ...prev, nodes: [...prev.nodes, newNode] }));
          setSelectedNodeIds(new Set([newNode.id]));
          break;
        }
        case 'paste': {
          if (!clipboard) break;
          const canvasRect2 = canvasContainerRef.current?.getBoundingClientRect();
          const vp2 = viewportRef.current;
          const mx2 = canvasRect2 ? (contextMenu.x - canvasRect2.left - vp2.x) / vp2.zoom : 100;
          const my2 = canvasRect2 ? (contextMenu.y - canvasRect2.top - vp2.y) / vp2.zoom : 100;
          const minX = Math.min(...clipboard.nodes.map(node => node.x));
          const minY = Math.min(...clipboard.nodes.map(node => node.y));
          const transactionId = `context-paste:${++editorTransactionCounterRef.current}`;
          const command: WorkflowInteractionCommand = {
            type: 'clipboard.paste',
            snapshot: clipboard,
            offset: { x: mx2 + 30 - minX, y: my2 + 30 - minY },
            transactionId,
          };
          const result = dispatchWorkflowStateCommand(command);
          setSelectedNodeIds(new Set(result.createdNodeIds));
          break;
        }
        case 'select-all': {
          setSelectedNodeIds(new Set(wf.nodes.map(n => n.id)));
          break;
        }
      }
    } else if (contextMenu?.type === 'node' && contextMenu.nodeId) {
      const nodeId = contextMenu.nodeId;
      if (!wfRef.current.nodes.some(node => node.id === nodeId)) { closeContextMenu(); return; }
      // These are the same callbacks and grid values used by the card controls.
      if (action === 'extract-source') handleExtractToSource(nodeId);
      else if (action === 'grid-split-current') {
        const node = wfRef.current.nodes.find(candidate => candidate.id === nodeId)!;
        handleGridSplit(nodeId, Number(node.config?.gridCols || 2), Number(node.config?.gridRows || 2));
      } else if (action === 'run-chain') void handleCascadeRun(nodeId);
      else if (action === 'send-chat') void handleSendWorkflowResultToChat(nodeId);
      else if (action === 'compare-image') handleCompare(nodeId);
      switch (action) {
        case 'annotate': {
          requestNodeAnnotation(wfRef.current.nodes.find((node) => node.id === nodeId) || null);
          break;
        }
        case 'copy': {
          const selIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]);
          setClipboard(createWorkflowClipboardSnapshot(wf, [...selIds]));
          break;
        }
        case 'duplicate': {
          const selIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]);
          const transactionId = `context-duplicate:${++editorTransactionCounterRef.current}`;
          const command: WorkflowInteractionCommand = {
            type: 'nodes.copy',
            nodeIds: [...selIds],
            offset: { x: 40, y: 40 },
            transactionId,
          };
          const result = dispatchWorkflowStateCommand(command);
          setSelectedNodeIds(new Set(result.createdNodeIds));
          break;
        }
        case 'disconnect': {
          updateWorkflow(prev => ({
            ...prev,
            connections: prev.connections.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
          }));
          break;
        }
        case 'delete': {
          const selIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]);
          dispatchWorkflowStateCommand({
            type: 'nodes.delete',
            nodeIds: [...selIds],
            transactionId: `context-delete:${++editorTransactionCounterRef.current}`,
          });
          setSelectedNodeIds(new Set());
          break;
        }
      }
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu, clipboard, wf, selectedNodeIds, requestNodeAnnotation, dispatchWorkflowStateCommand, updateWorkflow, handleExtractToSource, handleGridSplit, handleCascadeRun, handleSendWorkflowResultToChat, handleCompare]);

  // ─── 执行工作流 ───

  const handleRunWorkflow = useCallback(async () => {
    const latestWorkflow = wfRef.current;
    await startWorkflowExecution({ nodes: latestWorkflow.nodes, connections: latestWorkflow.connections });
  }, [startWorkflowExecution]);

  const handleStopWorkflow = useCallback(async () => {
    const active = imageRetryViewRef.current?.active, epoch = imageRetryEpochRef.current;
    if (active?.executionId === executionId) {
      if (imageRetryRequestRef.current) return;
      const request = { controller: new AbortController(), epoch }; imageRetryRequestRef.current = request;
      const current = (): boolean => imageRetryRequestRef.current === request && imageRetryEpochRef.current === epoch;
      try {
        await fetch('/api/workflow/execute', { method: 'POST', signal: request.controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', executionId: active.executionId }) });
        if (!current()) return;
        // A completed winner or uncertain cancel is resolved by an authoritative
        // read. Do not clear the identity or invent a cancelled node result.
        const response = await fetch('/api/workflow/execute', { method: 'POST', signal: request.controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', executionId: active.executionId }) });
        const raw: unknown = await response.json(); if (!current()) return;
        if (!response.ok) throw new Error(String(workflowImageRetryRecord(raw)?.error || '取消结果待核对'));
        applyImageRetrySnapshot(raw, active.executionId, epoch);
      } catch (error) {
        if (current()) pauseImageRetry(active.executionId, epoch, error instanceof Error ? error.message : '取消结果待核对');
      } finally { if (imageRetryRequestRef.current === request) imageRetryRequestRef.current = null; }
      return;
    }
    if (executionId) {
      const response = await fetch('/api/workflow/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', executionId }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (imageRetryEpochRef.current !== epoch) return;
      if (!response.ok) {
        setExecStatus('running');
        setExecLogs(previous => [...previous, { time: Date.now(), nodeId: 'workflow', label: '工作流', status: 'error', message: data.error || '取消工作流失败' }]);
        return;
      }
    }
    if (imageRetryEpochRef.current !== epoch) return;
    setExecStatus('idle'); setExecutionId(null); localStorage.removeItem(WORKFLOW_EXEC_STATE_KEY);
  }, [executionId, WORKFLOW_EXEC_STATE_KEY, applyImageRetrySnapshot, pauseImageRetry]);

  const handleReconcileImageRetry = useCallback(async (): Promise<void> => {
    const active = imageRetryViewRef.current?.active;
    if (!active || active.executionId !== executionId || imageRetryRequestRef.current) return;
    const request = { controller: new AbortController(), epoch: imageRetryEpochRef.current };
    const submissionScope = executionViewScope; imageRetryRequestRef.current = request;
    const current = (): boolean => imageRetryRequestRef.current === request && imageRetryEpochRef.current === request.epoch
      && executionViewScopeRef.current === submissionScope && imageRetryViewRef.current?.active?.executionId === active.executionId;
    try {
      setImageRetryLog(active.nodeId, 'running', '正在核对原任务…');
      const response = await fetch('/api/workflow/execute', { method: 'POST', signal: request.controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', executionId: active.executionId, reconcile: true }) });
      const raw: unknown = await response.json(); if (!current()) return;
      if (!response.ok) throw new Error(String(workflowImageRetryRecord(raw)?.error || '结果仍待核对'));
      applyImageRetrySnapshot(raw, active.executionId, request.epoch);
    } catch (error) {
      if (current()) pauseImageRetry(active.executionId, request.epoch, error instanceof Error ? error.message : '结果仍待核对');
    } finally { if (imageRetryRequestRef.current === request) imageRetryRequestRef.current = null; }
  }, [executionId, executionViewScope, setImageRetryLog, applyImageRetrySnapshot, pauseImageRetry]);

  const handleRetryNode = useCallback(async (nodeId: string) => {
    if (!executionId || imageRetryRequestRef.current || imageRetryViewRef.current?.active) return;
    if (imageRetryViewRef.current?.pending && imageRetryViewRef.current.pending.nodeId !== nodeId) return;
    if (wfRef.current.nodes.some(entry => entry.type === 'input-image'
      && entry.config.assetTransferPending === true && (entry.config.assetTransferError === 'ACTOR_SCOPE_CHANGED' || entry.config.assetTransferError === 'TRANSFER_INTERRUPTED' || (!entry.config.assetTransferError && !entry.config.assetTransferExpectedActorId && !entry.config.assetTransferExpectedProjectId && !entry.config.assetTransferExpectedSource)))) {
      setBlockedNodeRetryNotice(true);
      return;
    }
    setBlockedNodeRetryNotice(false);
    const request = { controller: new AbortController(), epoch: imageRetryEpochRef.current };
    imageRetryRequestRef.current = request;
    const submissionScope = executionViewScope;
    const current = (): boolean => imageRetryRequestRef.current === request && imageRetryEpochRef.current === request.epoch
      && executionViewScopeRef.current === submissionScope;
    const node = wfRef.current.nodes.find(entry => entry.id === nodeId);
    const imageReceiver = node?.type === 'input-image' && node.config.source === 'upstream';
    let sourceExecutionId = imageRetryViewRef.current?.contextExecutionId || executionId;
    try {
      if (imageReceiver) {
        const retryView = beginWorkflowImageRetry(imageRetryViewRef.current, executionId, nodeId);
        imageRetryViewRef.current = retryView; sourceExecutionId = retryView.pending!.sourceExecutionId;
        const logs = setImageRetryLog(nodeId, 'running', '重试中...');
        setExecStatus('paused'); persistImageRetryState(executionId, 'paused', execResultsRef.current, logs);
      } else setImageRetryLog(nodeId, 'running', '重试中...');
      const latest = wfRef.current;
      const nodes = latest.nodes.map(entry => entry.type === 'input-image' ? { ...entry, config: Object.fromEntries(Object.entries(entry.config)
        .filter(([key]) => !['sourceImageId', 'sourceVersionId', 'assetTransferPending'].includes(key))) } : entry);
      const response = await fetch('/api/workflow/execute', { method: 'POST', signal: request.controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry', executionId: sourceExecutionId,
          nodeId, projectId, workflowId: latest.id, nodes, connections: latest.connections }) });
      const raw: unknown = await response.json(); if (!current()) return;
      const data = workflowImageRetryRecord(raw);
      if (imageReceiver && response.ok && data?.executionId) {
        const retryView = imageRetryViewRef.current;
        if (!retryView?.pending || retryView.pending.sourceExecutionId !== sourceExecutionId) throw new Error('重试身份已变化');
        const accepted = acceptWorkflowImageRetry(retryView, data.executionId, data.nodeId);
        imageRetryViewRef.current = accepted;
        const results = { ...execResultsRef.current, [nodeId]: { status: 'running' } };
        execResultsRef.current = results; setExecResults(results);
        const logs = setImageRetryLog(nodeId, 'running', '重试中...');
        setExecutionId(accepted.active!.executionId); setExecStatus('running');
        persistImageRetryState(accepted.active!.executionId, 'running', results, logs);
        return;
      }
      if (!imageReceiver && response.ok && data?.success === true) {
        setImageRetryLog(nodeId, 'success', '重试成功');
        setExecResults(previous => ({ ...previous, [nodeId]: { status: 'success', output: workflowImageRetryRecord(data.output) } }));
        return;
      }
      const message = typeof data?.error === 'string' ? data.error : imageReceiver ? '重试回执待核对，请重试原节点' : '重试失败';
      const logs = setImageRetryLog(nodeId, 'error', message);
      if (imageReceiver) {
        if ([400, 403, 409, 422].includes(response.status)) {
          const retryView = imageRetryViewRef.current; if (retryView) { const { pending: omitted, ...settled } = retryView; void omitted; imageRetryViewRef.current = settled; }
        }
        const status = imageRetryViewRef.current?.pending ? 'paused' : 'failed';
        setExecStatus(status); persistImageRetryState(executionId, status, execResultsRef.current, logs);
      }
    } catch {
      if (!current()) return;
      const logs = setImageRetryLog(nodeId, 'error', imageReceiver ? '重试网络错误，回执待核对，请重试原节点' : '重试网络错误');
      if (imageReceiver) { setExecStatus('paused'); persistImageRetryState(executionId, 'paused', execResultsRef.current, logs); }
    } finally { if (imageRetryRequestRef.current === request) imageRetryRequestRef.current = null; }
  }, [executionId, executionViewScope, projectId, persistImageRetryState, setImageRetryLog]);

  const handleWorkflowSkillApproval = useCallback(async (
    nodeId: string,
    runId: string,
    action: 'approve' | 'revise' | 'cancel',
    identity?: SkillApprovalIdentity,
    revisionInstruction?: string,
  ): Promise<boolean> => {
    const epoch = imageRetryEpochRef.current;
    const current = (): boolean => executionViewScopeRef.current === executionViewScope
      && imageRetryEpochRef.current === epoch && executionIdRef.current === executionId;
    if (!current()) return false;
    const body: Record<string, unknown> = executionId
      ? {
          action: 'approve-skill', controlAction: action, executionId, nodeId, runId, projectId, workflowId: wf.id,
          nodes: wf.nodes, connections: wf.connections,
        }
      : { action };
    if (identity) Object.assign(body, identity);
    if (action === 'revise') body.revisionInstruction = revisionInstruction;
    const response = await fetch(executionId
      ? '/api/workflow/execute'
      : `/api/skill-runs/${encodeURIComponent(runId)}`, {
      method: executionId ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as {
      accepted?: unknown; error?: unknown; approvalPending?: unknown; executionId?: unknown;
    } | null;
    if (!current()) return false;
    if (!response.ok) {
      if (executionId && payload?.approvalPending === true) {
        throw new Error('审批结果待核对，重新打开工作流可继续。');
      }
      throw new Error(typeof payload?.error === 'string' ? payload.error : '视频脚本操作失败');
    }
    if (executionId && (payload?.executionId !== executionId || payload.accepted !== true)) return false;
    if (action === 'cancel') {
      setExecResults(previous => ({ ...previous, [nodeId]: {
        status: 'cancelled', output: { runId, status: 'cancelled' },
      } }));
      if (executionId) {
        setExecStatus('idle');
        setExecutionId(null);
        try { localStorage.removeItem(WORKFLOW_EXEC_STATE_KEY); } catch { /* The cancellation is already durable. */ }
      }
    } else if (executionId) {
      setExecStatus('running');
      try {
        localStorage.setItem(WORKFLOW_EXEC_STATE_KEY, JSON.stringify({
          executionId,
          execStatus: 'running',
          execResults,
          execLogs: execLogsRef.current,
          nodeIds: executionNodeIds.length > 0 ? executionNodeIds : Object.keys(execResults),
        }));
      } catch { /* Keep observing the server result when local storage is unavailable. */ }
    } else {
      setExecResults(previous => ({ ...previous, [nodeId]: {
        status: 'running', output: { runId, status: 'running' },
      } }));
      setSkillObservationRevision(value => value + 1);
    }
    return payload?.accepted !== false;
  }, [WORKFLOW_EXEC_STATE_KEY, execResults, executionId, executionNodeIds, executionViewScope, projectId, wf.id, wf.connections, wf.nodes]);

  // A paused editor is restored from browser storage. The child may already
  // have accepted approval even though the parent acknowledgement never arrived.
  const pausedSkillApproval = execStatus === 'paused' && Object.values(execResults).some(result =>
    result.status === 'waiting-approval' && typeof result.output?.runId === 'string' && result.output.runId.length > 0);
  useEffect(() => {
    if (!pausedSkillApproval || !executionId || !userId || !projectId || imageRetryViewRef.current) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const current = (): boolean => !controller.signal.aborted && executionViewScopeRef.current === executionViewScope
      && executionIdRef.current === executionId;
    const retry = (): void => {
      // An interrupted server can still hold the approval lease for two minutes.
      if (current() && attempts < 70) timer = setTimeout(() => void reconcile(), 2_000);
    };
    const reconcile = async (): Promise<void> => {
      attempts++;
      try {
        const response = await fetch('/api/workflow/execute', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', executionId, projectId, workflowId: wf.id }),
        });
        const result = workflowImageRetryRecord(await response.json());
        if (!current()) return;
        if (response.status >= 500) { retry(); return; }
        if (!response.ok || result?.executionId !== executionId) return;
        if (result.approvalPending === true) { retry(); return; }
        if (result.status === 'running' || result.status === 'completed' || result.status === 'failed') {
          // Use the usual execution observer to display and publish terminal output.
          setExecStatus('running');
        } else if (result.status === 'cancelled') {
          setExecResults({});
          setExecStatus('idle');
          setExecutionId(null);
          try { localStorage.removeItem(WORKFLOW_EXEC_STATE_KEY); } catch { /* Rendering the durable outcome still succeeds. */ }
        } else if (result.status === 'paused' && isWorkflowSkillPauseResult(result.results)) {
          setExecResults(safeSketchExecutionResults(result.results, wfRef.current.nodes));
        }
      } catch {
        retry();
      }
    };
    void reconcile();
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [pausedSkillApproval, executionId, executionViewScope, projectId, userId, wf.id, WORKFLOW_EXEC_STATE_KEY]);

  // 轮询执行状态
  useEffect(() => {
    if (execStatus !== 'running' || !executionId) return;
    const executionProjectId = projectId, pollEpoch = imageRetryEpochRef.current;
    const activeImageRetry = imageRetryViewRef.current?.active?.executionId === executionId ? imageRetryViewRef.current.active : undefined;
    const controller = new AbortController();
    let pollCount = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        pollCount++;
        const res = await fetch('/api/workflow/execute', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', executionId }),
        });
        const data = await res.json();
        if (controller.signal.aborted || imageRetryEpochRef.current !== pollEpoch) return;
        if (activeImageRetry) {
          if (!res.ok) { pauseImageRetry(executionId, pollEpoch, String(workflowImageRetryRecord(data)?.error || '图片重试状态读取失败')); return; }
          const done = applyImageRetrySnapshot(data, executionId, pollEpoch);
          if (!done) {
            if (pollCount >= 180) { pauseImageRetry(executionId, pollEpoch, '图片重试读取超时，请核对原任务'); return; }
            timerId = setTimeout(poll, pollCount <= 5 ? 1000 : pollCount <= 15 ? 1500 : 2000);
          }
          return;
        }
        if (data.results) data.results = safeSketchExecutionResults(data.results, wfRef.current.nodes);
        if (controller.signal.aborted || !isWorkspaceResultScopeCurrent(executionProjectId, projectIdRef.current)) return;
        if (data.results && typeof data.results === 'object') {
          const results = data.results as Record<string, { output?: Record<string, unknown> }>;
          updateWorkflowSystem(current => {
            let changed = false;
            const nodes = current.nodes.map(node => {
              if (node.type !== 'ai-skill') return node;
              const runId = results[node.id]?.output?.runId;
              if (typeof runId !== 'string' || runId === node.config.runId) return node;
              changed = true;
              return { ...node, config: { ...node.config, runId } };
            });
            return changed ? { ...current, nodes } : current;
          });
        }
        if (data.status === 'cancelled' && data.executionId === executionId) {
          setExecResults(data.results || {});
          setExecStatus('idle');
          setExecutionId(null);
          try { localStorage.removeItem(WORKFLOW_EXEC_STATE_KEY); } catch { /* Rendering the durable outcome still succeeds. */ }
          return;
        }
        if (data.status === 'paused') {
          setExecStatus('paused');
          setExecResults(data.results || {});
          localStorage.setItem(WORKFLOW_EXEC_STATE_KEY, JSON.stringify({
            executionId,
            execStatus: 'paused',
            execResults: data.results || {},
            execLogs: execLogsRef.current,
            nodeIds: executionNodeIdsRef.current.length > 0 ? executionNodeIdsRef.current : Object.keys(data.results || {}),
          }));
          return;
        }
        if (data.status === 'completed' || data.status === 'failed') {
          const completedWorkflow = wfRef.current;
          const existingCanvasPersistence = workflowCanvasPersistenceRef.current?.executionId === executionId
            ? workflowCanvasPersistenceRef.current
            : null;
          const canvasPersistence = existingCanvasPersistence || {
            executionId,
            settled: false,
            failedOutputNodeIds: new Set<string>(),
          };
          canvasPersistence.settled = false;
          canvasPersistence.failedOutputNodeIds.clear();
          workflowCanvasPersistenceRef.current = canvasPersistence;
          setExecStatus(data.status === 'completed' ? 'completed' : 'failed');
          setExecResults(data.results || {});
          // P1: 记录执行日志
          let finalLogs: WorkflowExecutionLog[] = [];
          if (data.results) {
            finalLogs = Object.entries(data.results as Record<string, { status: string; output?: Record<string, unknown>; error?: string }>).map(([nodeId, result]) => {
              const node = completedWorkflow.nodes.find(n => n.id === nodeId);
              return { time: Date.now(), nodeId, label: node?.label || nodeId, status: ['failed', 'error', 'cancelled', 'timeout'].includes(result.status) ? 'error' : result.status, message: result.error || (result.output ? '完成' : '未知') };
            });
            setExecLogs(prev => mergeExecutionLogs(prev, finalLogs));
          }
          // B1: 持久化最终结果，3秒后清除
          const finalState = { executionId, execStatus: data.status, execResults: data.results || {}, execLogs: finalLogs };
          localStorage.setItem(WORKFLOW_EXEC_STATE_KEY, JSON.stringify(finalState));
          setTimeout(() => {
            if (localStorage.getItem(WORKFLOW_EXEC_STATE_KEY) === JSON.stringify(finalState)) {
              localStorage.removeItem(WORKFLOW_EXEC_STATE_KEY);
            }
          }, 3000);
          // 持久化: 将工作流生成的图片添加到项目
          if (!canvasDocumentMode && data.status === 'completed' && onAddImages && data.results) {
            const workflowResults = data.results as Record<string, { status: string; output?: Record<string, unknown> }>;
            // ★ 收集工作流中使用的模型信息
            let workflowModelName: string | undefined;
            let workflowApiProvider: string | undefined;
            for (const [, result] of Object.entries(workflowResults)) {
              if (result.status === 'success' && result.output) {
                // 尝试从输出获取模型信息
                if (!workflowModelName && result.output.modelName) workflowModelName = result.output.modelName as string;
                if (!workflowApiProvider && result.output.apiProvider) workflowApiProvider = result.output.apiProvider as string;
              }
            }
            const outputCandidates = completedWorkflow.nodes
              .filter(node => getNodeCategory(node.type) === 'output')
              .flatMap(outputNode => {
                const result = workflowResults[outputNode.id];
                if (result?.status !== 'success' || !result.output) return [];
                const outputReference = resolveWorkflowOutputAssetReference(
                  outputNode.id,
                  completedWorkflow.nodes,
                  completedWorkflow.connections,
                  workflowResults,
                );
                if (outputReference?.assetVersionId) {
                  return [{
                    outputNodeId: outputNode.id,
                    url: outputReference.url,
                    managed: true,
                    sourceReference: outputReference,
                  }];
                }
                const hasManagedIdentity = typeof result.output.assetVersionId === 'string'
                  || (Array.isArray(result.output.assetReferences) && result.output.assetReferences.some(value => {
                    if (!value || typeof value !== 'object') return false;
                    const reference = value as Record<string, unknown>;
                    return reference.outputNodeId === outputNode.id && typeof reference.assetVersionId === 'string';
                  }));
                const imageUrls = Array.isArray(result.output.imageUrls)
                  ? result.output.imageUrls.filter((url): url is string => typeof url === 'string')
                  : (typeof result.output.imageUrl === 'string' ? [result.output.imageUrl] : []);
                return imageUrls.map((url, index) => ({
                  outputNodeId: imageUrls.length === 1 ? outputNode.id : `${outputNode.id}:${index}`,
                  url,
                  managed: hasManagedIdentity,
                }));
              });
            if (outputCandidates.length > 0) {
              const insertion = await prepareWorkflowCanvasInsertions(outputCandidates, async (outputReference, candidate) => {
                if (!projectId) throw new Error('Missing target project');
                const outputNodeId = candidate.outputNodeId.split(':')[0];
                const outputNode = completedWorkflow.nodes.find(node => node.id === outputNodeId);
                const response = await fetch('/api/assets/transfer', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sourceVersion: outputReference.assetVersionId,
                    targetProject: projectId,
                    targetWorkspace: `canvas:${projectId}`,
                    entityType: 'canvas-image',
                    entityId: `${executionId}:${candidate.outputNodeId}`,
                    idempotencyKey: `workflow-canvas:${executionId}:${candidate.outputNodeId}:${outputReference.assetVersionId}`,
                    metadata: {
                      name: outputNode?.label || candidate.outputNodeId,
                      source: 'workflow',
                      workflowId: completedWorkflow.id,
                      executionId,
                      outputNodeId: candidate.outputNodeId,
                    },
                  }),
                });
                if (!response.ok) throw new Error(`Asset transfer failed (${response.status})`);
                return response.json() as Promise<WorkspaceAssetReference>;
              });
              if (insertion.failedOutputNodeIds.length > 0) {
                insertion.failedOutputNodeIds.forEach(nodeId => {
                  canvasPersistence.failedOutputNodeIds.add(nodeId.split(':')[0]);
                });
                setExecLogs(prev => mergeExecutionLogs(prev, insertion.failedOutputNodeIds.map(nodeId => ({
                  time: Date.now(),
                  nodeId,
                  label: completedWorkflow.nodes.find(node => node.id === nodeId)?.label || nodeId,
                  status: 'error',
                  message: 'Asset transfer failed; retry is available',
                }))));
              }
              // ★ 如果输出没有模型信息，从工作流节点中查找
              if (!workflowModelName && completedWorkflow.nodes) {
                const genNode = completedWorkflow.nodes.find(n => n.type === 'ai-generate' && n.config?.model);
                if (genNode?.config?.model) {
                  const model = genNode.config.model as string;
                  workflowModelName = model.includes('::') ? model.split('::').pop()! : model;
                  if (!workflowApiProvider && model.includes('::')) workflowApiProvider = model.split('::')[0];
                }
              }
              const meta: { modelName?: string; apiProvider?: string } = {};
              if (workflowModelName) meta.modelName = workflowModelName;
              if (workflowApiProvider) meta.apiProvider = workflowApiProvider;
              if (insertion.items.length > 0) {
                await onAddImages(insertion.items, Object.keys(meta).length > 0 ? meta : undefined);
              }
            }
          }
          canvasPersistence.settled = true;
          return; // done, don't schedule next poll
        } else if (data.results) {
          setExecResults(data.results);
          // P1: 记录运行中的日志
          const newLogs = Object.entries(data.results as Record<string, { status: string; output?: Record<string, unknown>; error?: string }>)
            .filter(([, result]) => result.status === 'success' || result.status === 'failed')
            .map(([nodeId, result]) => {
              const node = wf.nodes.find(n => n.id === nodeId);
              return { time: Date.now(), nodeId, label: node?.label || nodeId, status: ['failed', 'error', 'cancelled', 'timeout'].includes(result.status) ? 'error' : result.status, message: result.error || (result.output ? '完成' : '运行中') };
            });
          if (newLogs.length > 0) setExecLogs(prev => mergeExecutionLogs(prev, newLogs));
        }
      } catch (err) {
        if (controller.signal.aborted || imageRetryEpochRef.current !== pollEpoch) return;
        if (activeImageRetry) { pauseImageRetry(executionId, pollEpoch, err instanceof Error ? err.message : '图片重试状态待核对'); return; }
        // 临时网络错误不直接终止轮询，允许重试
        console.error('[workflow-poll] Error polling workflow status:', err);
        const delay = pollCount <= 5 ? 1000 : pollCount <= 15 ? 1500 : 2000;
        if (pollCount >= 180) {
          setExecStatus('failed');
          return;
        }
        timerId = setTimeout(poll, delay);
        return;
      }
      // ★ 动态间隔：前5次1秒，5-15次1.5秒，之后2秒
      const delay = pollCount <= 5 ? 1000 : pollCount <= 15 ? 1500 : 2000;
      // ★ 轮询上限：180次（约5分钟），防止无限轮询
      if (pollCount >= 180) {
        setExecStatus('failed');
        return;
      }
      timerId = setTimeout(poll, delay);
    };
    poll();
    return () => { controller.abort(); if (timerId) clearTimeout(timerId); };
  }, [canvasDocumentMode, execStatus, executionId, onAddImages, projectId, updateWorkflowSystem, wf.connections, wf.id, wf.nodes, WORKFLOW_EXEC_STATE_KEY, applyImageRetrySnapshot, pauseImageRetry]);

  // ─── 保存工作流 ───

  const handleSaveWorkflow = useCallback(async () => {
    setSaveStatus('saving');
    try {
      if (!userId) throw new Error('未登录');
      const savedWorkflow = { ...wfRef.current, updatedAt: Date.now() };
      if (onWorkflowSaveRequest) {
        await onWorkflowSaveRequest(savedWorkflow);
      } else {
        const res = await fetch('/api/workflow/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, workflow: savedWorkflow }),
        });
        if (!res.ok) throw new Error('工作流保存失败');
        await onWorkflowSaved?.(savedWorkflow);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [onWorkflowSaveRequest, onWorkflowSaved, userId]);

  // ─── 图片上传 ───

  const triggerNodeImageUpload = useCallback((nodeId: string) => {
    pendingImageUploadNodeId.current = nodeId;
    imageFileInputRef.current?.click();
  }, []);

  // ─── 根据图片实际尺寸调整节点大小 ───
  const resizeNodeForImageUrl = useCallback((nodeId: string, imageUrl: string) => {
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;
      if (!imgW || !imgH) return;
      const ratio = imgW / imgH;
      const nodeW = 220;
      const nodeH = Math.round(nodeW / ratio);
      const clampedH = Math.max(120, Math.min(400, nodeH));
      updateWorkflow(prev => ({
        ...prev,
        nodes: prev.nodes.map((n: WorkflowNode) =>
          n.id === nodeId ? { ...n, width: nodeW, height: clampedH + 56 } : n
        ),
      }));
    };
    img.src = imageUrl;
    // 返回清理函数，组件卸载时取消回调
    return () => { cancelled = true; img.onload = null; };
  }, [updateWorkflow]);

  const updateNodeSize = useCallback((nodeId: string, width: number, height: number) => {
    dispatchWorkflowStateCommand({
      type: 'node.measure',
      nodeId,
      size: { width, height },
    });
    // 节点尺寸变化时清除该节点的端口位置缓存，下次取端口位置时重新计算
    for (const key of portPositionCacheRef.current.keys()) {
      if (key.startsWith(nodeId + '-')) {
        portPositionCacheRef.current.delete(key);
      }
    }
  }, [dispatchWorkflowStateCommand]);

  const handleGlobalImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const nodeId = pendingImageUploadNodeId.current;
    if (!file || !nodeId) return;
    // 清空 input value 以支持重复选择同一文件
    e.target.value = '';
    pendingImageUploadNodeId.current = null;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/save-image', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        handleNodeUpdate(nodeId, { config: {
          imageUrl: data.url,
          source: 'upload',
          projectId: '',
          assetId: '',
          assetVersionId: '',
          placementId: '',
        } });
        resizeNodeForImageUrl(nodeId, data.url);
      }
    } catch (err) {
      console.error('[NodeEditor] 节点图片上传失败:', err);
    }
  }, [handleNodeUpdate, resizeNodeForImageUrl]);

  const handleImageUpload = useCallback(async (nodeId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/save-image', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        handleNodeUpdate(nodeId, { config: {
          imageUrl: data.url,
          source: 'upload',
          projectId: '',
          assetId: '',
          assetVersionId: '',
          placementId: '',
        } });
        resizeNodeForImageUrl(nodeId, data.url);
      }
    } catch (e) {
      console.error('[NodeEditor] 图片上传失败:', e);
    }
  }, [handleNodeUpdate, resizeNodeForImageUrl]);

  // ─── AI自然语言建图 ───

  const handleAiBuild = useCallback(async () => {
        if (!aiBuildInput.trim() || aiBuildPendingRef.current) return;
        aiBuildPendingRef.current = true;
        const requestEpoch = ++aiBuildEpochRef.current;
        const requestScope = aiBuildScopeRef.current;
        const requestContentEpoch = aiBuildContentEpochRef.current;
        setAiBuildLoading(true);
        setAiBuildError(null);
        try {
          const res = await fetch('/api/workflow/ai-build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: aiBuildInput }),
          });
          const data = await res.json();
          if (!aiBuildMountedRef.current || aiBuildEpochRef.current !== requestEpoch || aiBuildScopeRef.current !== requestScope) return;
          if (data.success && data.workflow) {
            if (aiBuildContentEpochRef.current !== requestContentEpoch) {
              setAiBuildError('工作流已更改，未应用本次 AI 建图结果；请检查当前工作流后重新生成。');
              return;
            }
            updateWorkflow(data.workflow);
            setSelectedNodeIds(new Set());
            setSidebarTab('nodes');
            setAiBuildInput('');
            setAiBuildOpen(false);
          } else {
            setAiBuildError(data.error || 'AI建图失败，请重试');
          }
        } catch (e) {
          if (aiBuildMountedRef.current && aiBuildEpochRef.current === requestEpoch && aiBuildScopeRef.current === requestScope) {
            setAiBuildError('网络错误，请重试');
            console.error('[NodeEditor] AI建图失败:', e);
          }
        } finally {
          aiBuildPendingRef.current = false;
          if (aiBuildMountedRef.current) setAiBuildLoading(false);
        }
      }, [aiBuildInput, updateWorkflow]);

  // ─── 加载预设模板 ───

  const handleLoadPreset = useCallback((preset: WorkflowPreset) => {
        updateWorkflow(createWorkflowFromPreset(preset));
        setSelectedNodeIds(new Set());
        setSidebarTab('nodes');
        closeDirectoryOnMobile();
      }, [closeDirectoryOnMobile, updateWorkflow]);

  const handleLibraryPrompt = useCallback((id: string): void => {
    const template = promptTemplates.find(candidate => candidate.id === id);
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!template || !rect) return;
    const vp = viewportRef.current;
    const node = createWorkflowNode('input-text', 0, 0, template.name);
    node.x = (rect.width / 2 - vp.x) / vp.zoom - node.width / 2;
    node.y = (rect.height / 2 - vp.y) / vp.zoom - node.height / 2;
    node.config = { ...node.config, text: template.content };
    updateWorkflow(previous => ({ ...previous, nodes: [...previous.nodes, node] }));
    setSelectedNodeIds(new Set([node.id]));
    setSidebarTab('props');
    closeDirectoryOnMobile();
  }, [closeDirectoryOnMobile, promptTemplates, updateWorkflow]);

  const handleLibraryPreset = useCallback((id: string): void => {
    const preset = WORKFLOW_PRESETS.find(candidate => candidate.id === id);
    if (!preset) return;
    const current = wfRef.current;
    if (current.nodes.length || current.connections.length) {
      setPendingPreset({ preset, scope: JSON.stringify([userId, projectId, current.id]) });
    } else handleLoadPreset(preset);
  }, [handleLoadPreset, projectId, userId]);

  // ─── 自动布局 ───

  useCallback(() => {
        updateWorkflow(prev => autoLayoutWorkflow(prev));
      }, [updateWorkflow]);

  // ─── 连线路径计算 ───

  const getConnPath = useCallback((fromX: number, fromY: number, toX: number, toY: number) => {
    const dx = Math.abs(toX - fromX) * 0.5;
    return `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`;
  }, []);

  // 端口位置缓存: 避免每次渲染连线时查询DOM
  const portPositionCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // 节点变化时清除端口位置缓存（确保计算结果与最新数据一致）
  const prevNodesRef = useRef(wf.nodes);
  useEffect(() => {
    if (prevNodesRef.current !== wf.nodes) {
      portPositionCacheRef.current.clear();
      prevNodesRef.current = wf.nodes;
    }
  }, [wf.nodes]);

  // 纯数据驱动的端口位置计算（不依赖DOM查询）
  const getPortPositionLocal = useCallback((node: WorkflowNode, port: NodePort) => {
    const cacheKey = `${node.id}-${port.direction}-${port.id}`;
    const cached = portPositionCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const result = computePortPosition(node, port.id);
    if (result) {
      portPositionCacheRef.current.set(cacheKey, result);
    }
    return result;
  }, []);
  useEffect(() => { getPortPositionLocalRef.current = getPortPositionLocal; }, [getPortPositionLocal]);


  // ─── 高亮连线 (选中节点时高亮上下游) ───

  const getConnectedNodeIds = useMemo(() => {
    if (!highlightNodeId) return new Set<string>();
    const ids = new Set<string>();
    ids.add(highlightNodeId);
    // 上游
    for (const c of wf.connections) {
      if (c.toNodeId === highlightNodeId) ids.add(c.fromNodeId);
      if (c.fromNodeId === highlightNodeId) ids.add(c.toNodeId);
    }
    return ids;
  }, [highlightNodeId, wf.connections]);

  const isConnectionHighlighted = useCallback((conn: WorkflowConnection) => {
    if (!highlightNodeId) return false;
    return conn.fromNodeId === highlightNodeId || conn.toNodeId === highlightNodeId;
  }, [highlightNodeId]);

  // ─── 过滤节点模板 ───

  const filteredTemplates = useMemo(() => {
    const templates = getWorkflowNodeTemplates();
    if (!searchQuery) return templates;
    const q = searchQuery.toLowerCase();
    return templates.filter(t => t.label.includes(q) || t.desc.includes(q) || t.type.includes(q));
  }, [searchQuery]);

  const groupedTemplates = useMemo(() => {
    const groups: Record<NodeCategory, typeof NODE_TEMPLATES> = {} as never;
    for (const t of filteredTemplates) {
      if (!groups[t.category]) groups[t.category] = [];
      groups[t.category].push(t);
    }
    return groups;
  }, [filteredTemplates]);

  // 过滤预设
  useMemo(() => {
        if (!searchQuery) return WORKFLOW_PRESETS;
        const q = searchQuery.toLowerCase();
        return WORKFLOW_PRESETS.filter(p => p.name.includes(q) || p.description.includes(q) || p.tags.some(t => t.includes(q)));
      }, [searchQuery]);

  const workflowCardCallbacks: WorkflowLegacyCardCallbacks = {
    onNodeFieldChange: handleNodeFieldChange,
    onLlmOptimize: handleLlmOptimize,
    onCascadeRun: handleCascadeRun,
    onExtractToSource: handleExtractToSource,
    onGridSplit: handleGridSplit,
    onCompare: handleCompare,
    onSendToChat: handleSendWorkflowResultToChat,
    onTriggerImageUpload: triggerNodeImageUpload,
    onImageFileDrop: handleImageUpload,
    promptPresets: nodePromptPresets,
    onSavePromptPreset: saveNodePromptPreset,
    onDeletePromptPreset: deleteNodePromptPreset,
    onSelect: (nodeId, event) => {
      if (legacyNodePointerRef.current || legacyMobilePointerRef.current?.busy() || (event && legacyMobilePointerRef.current?.suppressesMouse())) return;
      setLegacyPropertiesDeferred(Boolean(event && 'pointerId' in event));
      if (event && (event.ctrlKey || event.metaKey)) {
        setSelectedNodeIds(previous => {
          const next = new Set(previous);
          if (next.has(nodeId)) next.delete(nodeId);
          else next.add(nodeId);
          return next;
        });
      } else {
        setSelectedNodeIds(new Set([nodeId]));
      }
      setSidebarTab('props');
    },
    onHover: nodeId => {
      setHighlightNodeId(nodeId);
      setHoveredNodeId(nodeId);
    },
    onDragStart: (nodeId, event) => {
      if (legacyNodePointerRef.current || legacyMobilePointerRef.current?.busy() || legacyMobilePointerRef.current?.suppressesMouse()) return;
      const node = wfRef.current.nodes.find(candidate => candidate.id === nodeId);
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      if (!node || !canvasRect) return;
      if ('pointerId' in event) {
        const pointer = event as React.PointerEvent<HTMLElement>;
        if (!pointer.isPrimary || pointer.button !== 0 || !Number.isInteger(pointer.pointerId)
          || !['mouse', 'touch', 'pen'].includes(pointer.pointerType)) return;
        const owner = pointer.currentTarget;
        try { owner.setPointerCapture(pointer.pointerId); } catch { setLegacyPropertiesDeferred(true); return; }
        legacyNodePointerRef.current = { pointerId: pointer.pointerId, pointerType: pointer.pointerType, owner,
          scope: legacyPointerScopeRef.current, clientX: pointer.clientX, clientY: pointer.clientY, moved: false };
      }
      const currentViewport = viewportRef.current;
      const mouseX = (event.clientX - canvasRect.left - currentViewport.x) / currentViewport.zoom;
      const mouseY = (event.clientY - canvasRect.top - currentViewport.y) / currentViewport.zoom;
      draggingNodeRef.current = nodeId;
      nodeDragInitialPositionsRef.current = [{ nodeId, position: { x: node.x, y: node.y } }];
      nodeDragPositionRef.current = { id: nodeId, x: node.x, y: node.y };
      dragOffsetRef.current = { x: mouseX - node.x, y: mouseY - node.y };
      beginWorkflowDrag();
      setBoxSelect(null);
      isBoxSelectingRef.current = false;
    },
    onPortMouseDown: handlePortMouseDown,
    onPortMouseUp: handlePortMouseUp,
    onPortPointerDown: handleLegacyPortPointerDown,
    mobileActionMenu: workflowRendererMode !== 'react-flow-v2',
    onDelete: () => undefined,
    onDeselect: () => setSelectedNodeIds(new Set()),
    onPreviewImage: setImagePreviewUrl,
    onResizeNode: resizeNodeForImageUrl,
    onUpdateNodeSize: updateNodeSize,
    collapsedNodes,
    onToggleCollapse: toggleNodeCollapse,
    onContextMenu: (nodeId, event) => handleNodeContextMenu(event, nodeId),
    onDoubleClickAnnotation: nodeId => {
      const node = wfRef.current.nodes.find(candidate => candidate.id === nodeId);
      if (node?.type === 'ai-annotation-edit') requestNodeAnnotation(node);
    },
  };

  const contextNode = contextMenu?.type === 'node' ? wf.nodes.find(node => node.id === contextMenu.nodeId) : null;
  const extraNodeActions: WorkflowMenuAction[] = [];
  if (contextNode) {
    const image = execResults[contextNode.id]?.output?.imageUrl || contextNode.config?.imageUrl;
    const inputImage = contextNode.type === 'input-image', inputText = contextNode.type === 'input-text';
    if (inputImage && image) {
      extraNodeActions.push({ action: 'extract-source', label: '抽取为源节点', icon: ImageDown });
      extraNodeActions.push({ action: 'grid-split-current', label: `宫格切分 ${Number(contextNode.config?.gridCols || 2)}×${Number(contextNode.config?.gridRows || 2)}`, icon: Scissors });
      if (upstreamImageUrls.get(contextNode.id)) extraNodeActions.push({ action: 'compare-image', label: '对比原图', icon: GitCompare });
    }
    if (inputText || (inputImage && image) || (!inputText && !inputImage && !image && !contextNode.type.startsWith('condition-') && !(contextNode.type.startsWith('ai-') || contextNode.type === 'output-image'))) {
      extraNodeActions.push({ action: 'run-chain', label: '运行此链', icon: Play });
    }
    const output = execResults[contextNode.id]?.output;
    if (contextNode.type === 'output-image' && ((Array.isArray(output?.imageUrls) && output.imageUrls.length > 0) || image)) {
      extraNodeActions.push({ action: 'send-chat', label: '发送到智能对话', icon: MessageSquare });
    }
  }

  const imageRetryReconciliation = Boolean(imageRetryViewRef.current?.active || imageRetryViewRef.current?.pending);
  const canStopExecution = execStatus === 'running' || execStatus === 'paused' && Boolean(imageRetryViewRef.current?.active);
  // ─── 渲染 ───

  return (
    <>
    <style>{`@media (max-width:767px), (any-pointer:coarse) {
      .node-editor-root [data-workflow-mobile-action-menu] button[title="抽取为源节点"],
      .node-editor-root [data-workflow-mobile-action-menu] button[title="宫格切分"],
      .node-editor-root [data-workflow-mobile-action-menu] button[title="运行此链"],
      .node-editor-root [data-workflow-mobile-action-menu] button[title="发送到智能对话"],
      .node-editor-root [data-workflow-mobile-action-menu] button[title="对比原图"] { display:none; }
    }`}</style>
    <Dialog open={Boolean(pendingPreset)} onOpenChange={open => { if (!open) setPendingPreset(null); }}>
      <DialogContent className="max-h-[calc(100dvh-32px)] max-w-md overflow-y-auto" data-modal="true" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>替换当前工作流</DialogTitle>
          <DialogDescription>加载“{pendingPreset?.preset.name}”将替换当前节点与连线。取消保留原内容；替换后可撤销恢复。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button" className="min-h-11 min-w-11 rounded-md border border-border bg-muted px-4 text-foreground focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setPendingPreset(null)}>取消</button>
          <button type="button" className="min-h-11 min-w-11 rounded-md border border-primary bg-muted px-4 font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-primary" onClick={() => {
            const pending = pendingPreset;
            setPendingPreset(null);
            if (pending && pending.scope === JSON.stringify([userId, projectId, wfRef.current.id])) handleLoadPreset(pending.preset);
          }}>替换工作流</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(skillQuote)} onOpenChange={open => { if (!open) setSkillQuote(null); }}>
      <DialogContent
        onOpenAutoFocus={(): void => {
          const active = document.activeElement;
          skillQuoteReturnFocusRef.current = active instanceof HTMLElement ? active : null;
        }}
        onCloseAutoFocus={(event: Event): void => {
          const target = skillQuoteReturnFocusRef.current;
          skillQuoteReturnFocusRef.current = null;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus({ preventScroll: true });
          }
        }}
        className="flex max-h-[calc(100dvh-32px)] w-[calc(100%-2rem)] max-w-md flex-col overflow-hidden [&_[data-slot=dialog-close]]:top-2 [&_[data-slot=dialog-close]]:right-2 [&_[data-slot=dialog-close]]:inline-flex [&_[data-slot=dialog-close]]:min-h-11 [&_[data-slot=dialog-close]]:min-w-11 [&_[data-slot=dialog-close]]:items-center [&_[data-slot=dialog-close]]:justify-center" data-modal="true">
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle>Skill 费用预估</DialogTitle>
          <DialogDescription>以下为各 Skill 单次调用积分，其他节点及循环重复调用另计。实际结算以执行时价格为准。</DialogDescription>
        </DialogHeader>
        <ul className="min-h-0 max-h-64 flex-1 overflow-y-auto overscroll-contain space-y-2 text-sm">
          {skillQuote?.quotes.map(quote => <li key={quote.nodeId} className="flex items-start justify-between gap-4">
            <span className="min-w-0 break-words">{quote.label}</span>
            <span className="shrink-0">{quote.minimum === quote.maximum ? quote.maximum : `${quote.minimum}–${quote.maximum}`} 积分</span>
          </li>)}
        </ul>
        <DialogFooter className="shrink-0">
          <button className="min-h-11 min-w-11 whitespace-nowrap px-3 py-2 rounded-md border focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setSkillQuote(null)}>取消</button>
          <button className="min-h-11 min-w-11 whitespace-nowrap px-3 py-2 rounded-md bg-primary text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary" onClick={confirmSkillExecution}>确认执行</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <div className="node-editor-root h-screen w-screen flex flex-col text-foreground overflow-hidden select-none" data-theme={themeStyle === 'monochrome' ? 'monochrome' : 'gold'} style={{ ...neVars, background: T.canvasBg }}>
      {skillEstimating && <div role="status" className="absolute top-14 left-1/2 -translate-x-1/2 z-50 bg-card border rounded-md px-3 py-2 text-sm">正在预估 Skill 积分…</div>}
      {/* 全局图片上传 (foreignObject内input.click()不可靠, 统一由外部触发) */}
      <input ref={imageFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleGlobalImageUpload} />
      {/* ═══ 顶部工具栏 - 全宽, 与原型对齐 ═══ */}
      <header ref={toolbarRef} className="[&_button]:min-h-11 [&_button]:min-w-11 bg-card min-h-12 flex items-center justify-between gap-3 overflow-x-auto px-3 py-0.5 border-b border-border/20 z-50 shrink-0" role="toolbar" aria-label="工作流工具栏">
        {/* 左侧：工作流操作 */}
        <div className="flex min-w-max items-center gap-1" role="group" aria-label="工作流操作">
          {onBack && (
            <button onClick={onBack} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors cursor-pointer" title="返回画布 (Esc)" aria-label="返回画布">
              <ArrowLeft size={16} />
              <span>画布</span>
            </button>
          )}
          <div className="w-px h-6 bg-border/20 mx-1" aria-hidden="true" />
          {/* AI建图 */}
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium transition-colors cursor-pointer" title="AI自然语言建图 (Ctrl+L)" aria-label="AI建图" onClick={() => setAiBuildOpen(true)}>
            <Sparkles size={16} />
            <span>AI 建图</span>
          </button>
          {/* 执行/停止 */}
          <button
            onClick={canStopExecution ? handleStopWorkflow : handleRunWorkflow}
            disabled={Boolean(imageRetryRequestRef.current) || execStatus === 'paused' && !canStopExecution || (!canStopExecution && sketchModelsUnavailable)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${execStatus === 'running' ? 'bg-destructive/10 text-destructive hover:bg-destructive/20' : 'bg-[var(--color-success,#3fb950)]/10 text-[var(--color-success,#3fb950)] hover:bg-[var(--color-success,#3fb950)]/20'}`}
            title={canStopExecution ? '停止执行 (Ctrl+.)' : execStatus === 'paused' ? imageRetryReconciliation ? '请核对图片重试结果' : '请先确认视频脚本' : '执行工作流 (Ctrl+Enter)'}
            aria-label={canStopExecution ? '停止执行' : execStatus === 'paused' ? imageRetryReconciliation ? '等待结果核对' : '等待脚本确认' : '执行工作流'}
          >
            {canStopExecution ? <Square size={16} /> : <Play size={16} />}
            <span>{canStopExecution ? '停止' : execStatus === 'paused' ? '待确认' : '执行'}</span>
          </button>
          {execStatus === 'paused' && imageRetryViewRef.current?.active && (
            <button type="button" aria-label="核对图片重试结果" onClick={() => { void handleReconcileImageRetry(); }}
              disabled={Boolean(imageRetryRequestRef.current)}
              className="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-primary/40 bg-primary/10 px-3 text-sm text-primary hover:bg-primary/20 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
              {imageRetryRequestRef.current ? '核对中…' : '核对结果'}
            </button>
          )}
          <button
            type="button"
            data-toolbar="node-annotation-entry"
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
              nodeAnnotationSession
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
            }`}
            onClick={() => {
              if (nodeAnnotationSession) setNodeAnnotationSession(null);
              else requestNodeAnnotation(selectedNode);
            }}
            title="批注修改 (C)"
            aria-label="批注修改"
            aria-pressed={Boolean(nodeAnnotationSession)}
          >
            <MessageSquare size={15} aria-hidden="true" />
            批注修改
          </button>
          <div className="w-px h-6 bg-border/20 mx-1" aria-hidden="true" />
          {/* 撤销/重做 */}
          <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="撤销 Ctrl+Z" aria-label="撤销">
            <RotateCcw size={16} />
          </button>
          <button onClick={handleRedo} disabled={historyIndex >= historyStack.length} className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="重做 Ctrl+Shift+Z" aria-label="重做">
            <RotateCcw size={16} className="scale-x-[-1]" />
          </button>
          <div className="w-px h-6 bg-border/20 mx-1" aria-hidden="true" />
          {/* 预设 */}
          <button className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${showLeftPanel && sidebarTab === 'presets' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="预设工作流模板 (Ctrl+P)" aria-label="预设工作流" aria-pressed={showLeftPanel && sidebarTab === 'presets'} onClick={() => { setSidebarTab(showLeftPanel && sidebarTab === 'presets' ? 'nodes' : 'presets'); setShowLeftPanel(true); }}>
            <LayoutGrid size={16} />
            <span>预设</span>
          </button>
          {/* 保存 */}
          <button onClick={handleSaveWorkflow} disabled={saveStatus === 'saving'} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${saveStatus === 'saved' ? 'text-[var(--color-success,#3fb950)]' : saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="保存工作流">
            {saveStatus === 'saving' ? <Loader2 size={16} className="animate-spin" /> : saveStatus === 'saved' ? <Check size={16} /> : <Save size={16} />}
            <span>{saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : '保存'}</span>
          </button>
          {/* 导入 */}
          <button
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const result = importWorkflowFile(text);
                  if (!result || result.nodes.length === 0) { alert('未能识别有效的工作流节点或连线'); return; }
                  const current = wfRef.current;
                  const nodeIds = new Set(current.nodes.map(node => node.id));
                  const connectionIds = new Set(current.connections.map(connection => connection.id));
                  if (result.nodes.some(node => nodeIds.has(node.id))
                    || result.connections.some(connection => connectionIds.has(connection.id))) {
                    alert('导入的节点或连线与当前工作流 ID 重复');
                    return;
                  }
                  updateWorkflow({
                    ...current,
                    nodes: [...current.nodes, ...result.nodes],
                    connections: [...current.connections, ...result.connections],
                  });
                } catch (err) { alert('导入失败: ' + (err instanceof Error ? err.message : '无效的JSON文件')); }
              };
              input.click();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors cursor-pointer" title="导入工作流 (Ctrl+I)" aria-label="导入工作流"
          >
            <FileInput size={16} />
          </button>
          {/* JSON编辑器 (build_mode下隐藏) */}
          {!isBuildMode && (
            <button
              onClick={() => { setJsonEditContent(JSON.stringify({ nodes: wf.nodes, connections: wf.connections }, null, 2)); setJsonEditorError(null); setJsonEditorOpen(true); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors cursor-pointer" title="查看/编辑JSON"
            >
              <Settings size={16} />
            </button>
          )}
        </div>
        {/* 右侧：工作流信息 + 缩放控制 + 面板切换 */}
        <div className="flex min-w-max items-center gap-1" role="group" aria-label="视图控制">
          {/* 工作流名称 + 统计 */}
          <span className="text-sm font-semibold text-primary mr-1">{wf.name}</span>
          <span className="text-[11px] text-muted-foreground mr-2">{wf.nodes.length} 节点 · {wf.connections.length} 连线</span>
          {execStatus !== 'idle' && (
            <div aria-live="polite" className="flex items-center gap-1.5 rounded-md border border-border/20 bg-muted/50 px-2 py-1 text-[11px]">
              {execStatus === 'running' && <Loader2 size={12} className="animate-spin text-primary" />}
              {execStatus === 'paused' && <AlertCircle size={12} className="text-[#d4af37]" />}
              {execStatus === 'completed' && <Check size={12} className="text-green-400" />}
              {execStatus === 'failed' && <AlertCircle size={12} className="text-red-400" />}
              <span className={execStatus === 'running' ? 'text-primary' : execStatus === 'paused' ? 'text-[#d4af37]' : execStatus === 'completed' ? 'text-green-400' : 'text-red-400'}>
                {execStatus === 'running' ? '执行中' : execStatus === 'paused' ? imageRetryReconciliation ? '等待结果核对' : '等待脚本确认' : execStatus === 'completed' ? '执行完成' : '执行失败'}
              </span>
              <span className="text-muted-foreground">{executionNodeIds.filter(id => ['success', 'error', 'failed', 'timeout', 'skipped', 'cancelled'].includes(execResults[id]?.status)).length}/{executionNodeIds.length}</span>
              <button
                type="button"
                disabled={imageRetryReconciliation}
                onClick={() => { if (imageRetryReconciliation) return; setExecStatus('idle'); setExecResults({}); setExecLogs([]); }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="关闭执行状态"
              >
                <X size={11} />
              </button>
            </div>
          )}
          <div className="w-px h-6 bg-border/20 mx-1" aria-hidden="true" />
          {/* 缩放控制 */}
          <button onClick={() => setViewport(v => ({ ...v, zoom: Math.max(0.2, v.zoom * 0.8) }))} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer" title="缩小 (Ctrl+-)" aria-label="缩小">
            <ZoomOut size={16} />
          </button>
          <span className="text-xs text-muted-foreground font-mono w-12 text-center" aria-live="polite" aria-label="当前缩放">{Math.round(viewport.zoom * 100)}%</span>
          <button onClick={() => setViewport(v => ({ ...v, zoom: Math.min(3, v.zoom * 1.2) }))} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer" title="放大 (Ctrl++)" aria-label="放大">
            <ZoomIn size={16} />
          </button>
          <button onClick={() => setViewport({ x: 0, y: 0, zoom: 0.8 })} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer" title="重置视图 (Ctrl+0)" aria-label="重置视图">
            <Maximize size={16} />
          </button>
          <div className="w-px h-6 bg-border/20 mx-1" aria-hidden="true" />
          <button
            ref={minimapToggleRef}
            type="button"
            className={`inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm focus-visible:ring-2 focus-visible:ring-primary ${showMinimap ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            title="小地图"
            aria-label="切换小地图"
            aria-controls="workflow-minimap"
            aria-pressed={showMinimap}
            aria-expanded={showMinimap}
            onClick={() => setShowMinimap(visible => !visible)}
          >
            <LayoutGrid size={16} aria-hidden="true" />
            <span>小地图</span>
          </button>
          <button
            type="button"
            aria-label="画布菜单"
            aria-haspopup="menu"
            aria-controls="workflow-context-menu"
            aria-expanded={contextMenu?.type === 'canvas'}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2.5 text-sm text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            onClick={event => {
              const anchor = event.currentTarget.getBoundingClientRect();
              const canvas = canvasContainerRef.current?.getBoundingClientRect();
              setContextMenu({ type: 'canvas', x: canvas ? canvas.left + canvas.width / 2 : anchor.left,
                y: canvas ? canvas.top + canvas.height / 2 : anchor.bottom,
                menuX: anchor.left, menuY: anchor.bottom, scope: legacyPointerScopeRef.current, returnFocus: event.currentTarget });
            }}
          >
            <MoreHorizontal size={16} aria-hidden="true" /><span>画布菜单</span>
          </button>
          {/* 面板切换按钮组 - 与原型对齐 */}
          <button className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showLeftPanel && sidebarTab === 'nodes' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="节点库" aria-label="切换节点库面板" aria-pressed={showLeftPanel && sidebarTab === 'nodes'} onClick={() => { if (showLeftPanel && sidebarTab === 'nodes') setShowLeftPanel(false); else { setSidebarTab('nodes'); setShowLeftPanel(true); } }}>
            <Blocks size={16} />
          </button>
          <button className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showLeftPanel && sidebarTab === 'material' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="素材库" aria-label="切换素材库面板" aria-pressed={showLeftPanel && sidebarTab === 'material'} onClick={() => { setSidebarTab(showLeftPanel && sidebarTab === 'material' ? 'nodes' : 'material'); setShowLeftPanel(true); }}>
            <FolderOpen size={16} />
          </button>
          <button className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showContentStrip ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="内容窗口" aria-label="切换内容窗口" aria-pressed={showContentStrip} onClick={() => setShowContentStrip(!showContentStrip)}>
            <LayoutGrid size={16} />
          </button>
          <button className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showLeftPanel && sidebarTab === 'prompts' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="提示词库" aria-label="切换提示词库面板" aria-pressed={showLeftPanel && sidebarTab === 'prompts'} onClick={() => { setSidebarTab(showLeftPanel && sidebarTab === 'prompts' ? 'nodes' : 'prompts'); setShowLeftPanel(true); }}>
            <BookOpen size={16} />
          </button>
          <button className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showExecLog ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title="执行日志" aria-label="切换执行日志面板" aria-pressed={showExecLog} onClick={() => setShowExecLog(!showExecLog)}>
            <ScrollText size={16} />
          </button>
        </div>
      </header>
      {gridClientView.phase !== 'idle' && (
        <div data-workflow-ui-occlusion className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/20 bg-card px-3 py-1 text-sm">
          <span role={gridClientView.phase === 'unknown' || gridClientView.phase === 'error' ? 'alert' : 'status'} className="min-w-0 flex-1 basis-48 break-words">
            {gridClientView.message}
          </span>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {gridClientView.phase === 'preparing' && (
              <button type="button" onClick={() => gridClientRef.current!.stop()} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded border border-border px-3 focus-visible:ring-2 focus-visible:ring-primary">停止等待</button>
            )}
            {gridClientView.canRetry && (
              <button type="button" onClick={() => { void gridClientRef.current!.retry(); }} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded bg-primary px-3 text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary">{gridClientView.phase === 'unknown' ? '核对结果' : '重试'}</button>
            )}
            {gridClientView.phase !== 'preparing' && (
              <button type="button" aria-label="关闭切分提示" onClick={() => gridClientRef.current!.dismiss()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"><X size={16} /></button>
            )}
          </div>
        </div>
      )}

      {/* ═══ 主体三栏布局 - 与原型对齐 ═══ */}
      <div className="relative isolate flex flex-1 min-h-0 [@media(max-height:400px)]:min-h-[114px]">
      {/* ═══ 左侧节点库面板 - 与原型对齐: w-64, 搜索+分类列表 ═══ */}
      {showLeftPanel && (
      <aside aria-label={sidebarTab === 'material' ? '素材库' : sidebarTab === 'prompts' ? '提示词库' : sidebarTab === 'presets' ? '预设工作流' : '节点库'} className="[&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11 [&_input]:text-base absolute inset-y-0 left-0 z-[60] flex w-[min(18rem,85vw)] shrink-0 flex-col overflow-hidden border-r border-border/20 bg-card shadow-2xl md:relative md:z-auto md:w-64 md:shadow-none">
        <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border/20 px-3">
          <h2 className="min-w-0 text-sm font-semibold text-foreground">{sidebarTab === 'material' ? '素材库' : sidebarTab === 'prompts' ? '提示词库' : sidebarTab === 'presets' ? '预设工作流' : '节点库'}</h2>
          <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary" aria-label="关闭目录面板" onClick={() => setShowLeftPanel(false)}><X size={18} /></button>
        </div>
        {sidebarTab === 'material' || sidebarTab === 'prompts' || sidebarTab === 'presets' ? (
          <WorkflowLibraryContent tab={sidebarTab} images={canvasImages || []} prompts={promptTemplates}
            presets={WORKFLOW_PRESETS.map(preset => ({ id: preset.id, name: preset.name, description: preset.description, tags: preset.tags, nodeCount: preset.nodes.length }))}
            onUseImage={handleLibraryImage} onUsePrompt={handleLibraryPrompt} onUsePreset={handleLibraryPreset} />
        ) : <>
        {/* 搜索框 */}
        <div className="p-3 sticky top-0 z-10 bg-card border-b border-border/10">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索节点..."
              className="w-full border border-border rounded-xl px-8 py-2 text-sm bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
        {/* 节点分类列表 */}
        <div className="flex-1 overflow-y-auto">
          {Object.entries(groupedTemplates).map(([cat, templates]) => (
            <div key={cat} className="mb-1">
              <div className="px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_TYPE_COLORS[cat as NodeCategory] }} />
                {NODE_CATEGORY_LABELS[cat as NodeCategory]}
              </div>
              {templates.map(t => (
                <button
                  key={t.type}
                  data-node-type={t.type}
                  onClick={() => handleAddNode(t.type)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 cursor-pointer group hover:bg-muted/60 active:scale-[0.98]"
                >
                  <span className="text-muted-foreground group-hover:text-primary transition-colors">
                    {getNodeIcon(t.type, 16)}
                  </span>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-foreground text-[13px] leading-tight">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{t.desc}</div>
                  </div>
                  <Plus size={14} className="text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0" />
                </button>
              ))}
            </div>
          ))}
        </div>
        </>}
      </aside>
      )}



      {/* ═══ 中间区域: 画布 + 右侧属性面板 ═══ */}
      <div className="flex flex-1 min-h-0">

      {/* 主画布区域 */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        {/* 画布容器 - HTML架构 (SVG连线层 + HTML节点层, 与原型对齐) */}
        <div
          ref={canvasContainerRef}
          tabIndex={-1}
          className="w-full h-full relative overflow-hidden canvas-bg"
          style={{
            cursor: isPanning ? 'grabbing' : draggingConn ? 'crosshair' : 'default',
            background: T.nodeBg === '#161b22' ? '#0d1117' : '#f8fafc',
          }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={event => { if (!legacyNodePointerRef.current && !legacyMobilePointerRef.current?.busy() && !legacyMobilePointerRef.current?.suppressesMouse()) handleCanvasMouseMove(event); }}
          onPointerDownCapture={handleLegacySurfacePointerDown}
          onPointerMove={event => { if (legacyMobilePointerRef.current!.move(event)) event.preventDefault(); else handleLegacyNodePointerMove(event); }}
          onPointerUp={event => { if (legacyMobilePointerRef.current!.up(event)) event.preventDefault(); else handleLegacyNodePointerUp(event); }}
          onPointerCancel={event => { if (legacyMobilePointerRef.current!.cancel(event)) event.preventDefault(); else handleLegacyNodePointerCancel(event); }}
          onLostPointerCapture={event => { if (!legacyMobilePointerRef.current!.cancel(event)) handleLegacyNodePointerCancel(event); }}
          onClickCapture={event => { if (event.detail !== 0 && legacyMobilePointerRef.current?.suppressesMouse()) { event.preventDefault(); event.stopPropagation(); } }}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onWheel={handleWheel}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={handleCanvasImageDrop}
          onContextMenu={handleCanvasContextMenu}
        >
          {/* 网格背景 - 独立层, 不随viewport transform变化 */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `radial-gradient(circle, ${T.gridDot} 0.5px, transparent 0.5px)`,
            backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`,
            backgroundPosition: `${viewport.x % (20 * viewport.zoom)}px ${viewport.y % (20 * viewport.zoom)}px`,
          }} />

          {workflowRendererMode === 'react-flow-v2' ? (
            <WorkflowReactFlowSurface
              model={reactFlowWorkflowRenderModel}
              onCommand={handleWorkflowRenderCommand}
              onNodeDragStart={positions => { positions.forEach(position => noteMaterialUserGeometry(position.nodeId)); beginWorkflowDrag(); }}
              onNodeDragEnd={finishWorkflowDrag}
              onViewportChange={setViewport}
              visibleNodeIds={visibleNodeIds}
              readOnly={false}
              theme={T}
              execResults={execResults}
              execStatus={execStatus}
              executionNodeIds={executionNodeIds}
              highlightedNodeIds={getConnectedNodeIds}
              hoveredNodeId={hoveredNodeId}
              canvasImages={canvasImages}
              llmModels={chatModels}
              imageModels={imageModels}
              promptTemplates={promptTemplates}
              upstreamImageUrls={upstreamImageUrls}
              cardCallbacks={workflowCardCallbacks}
            />
          ) : (
            <>
          <WorkflowLegacySurface
            model={legacyWorkflowRenderModel}
            onCommand={handleWorkflowRenderCommand}
            visibleNodeIds={visibleNodeIds}
            theme={T}
            execResults={execResults}
            execStatus={execStatus}
            executionNodeIds={executionNodeIds}
            highlightedNodeIds={getConnectedNodeIds}
            hoveredNodeId={hoveredNodeId}
            canvasImages={canvasImages}
            llmModels={chatModels}
            imageModels={imageModels}
            promptTemplates={promptTemplates}
            upstreamImageUrls={upstreamImageUrls}
            draggingConnection={draggingConn}
            boxSelect={boxSelect}
            svgViewportTransformRef={svgViewportTransformRef}
            nodeViewportTransformRef={nodeViewportTransformRef}
            getConnectionPath={getConnPath}
            getPortPosition={getPortPositionLocal}
            isConnectionHighlighted={isConnectionHighlighted}
            onToggleConnectionBlocked={(connection, targetNode) => {
              updateWorkflow(prev => {
                const currentTarget = prev.nodes.find(node => node.id === targetNode.id);
                if (!currentTarget) return prev;
                const blocked = Array.isArray(currentTarget.config?.blockedInputs) ? [...(currentTarget.config.blockedInputs as string[])] : [];
                const index = blocked.indexOf(connection.id);
                if (index >= 0) blocked.splice(index, 1);
                else blocked.push(connection.id);
                return {
                  ...prev,
                  nodes: prev.nodes.map(node => node.id === targetNode.id ? { ...node, config: { ...node.config, blockedInputs: blocked } } : node),
                };
              });
            }}
            cardCallbacks={workflowCardCallbacks}
            onDirectPortPointerDown={(event, endpoint) => {
              const port = wfRef.current.nodes.find(node => node.id === endpoint.nodeId)?.ports.find(candidate => candidate.id === endpoint.portId && candidate.direction === endpoint.direction);
              if (port) handleLegacyPortPointerDown(event, endpoint.nodeId, port);
            }}
            onPortListRequest={requestLegacyPortList}
            disablePortTargets={isPanning || Boolean(legacyNodePointerRef.current)}
          />
          {workflowRendererMode === 'shadow' ? (
            <WorkflowShadowProbe
              legacyModel={legacyWorkflowRenderModel}
              shadowModel={reactFlowWorkflowRenderModel}
            />
          ) : null}
            </>
          )}
        </div>

        {(wf.nodes.some(node => node.type === 'input-image' && node.config.assetTransferPending === true
          && !node.config.assetTransferError && !node.config.assetTransferExpectedActorId
          && !node.config.assetTransferExpectedProjectId && !node.config.assetTransferExpectedSource)
          || wf.nodes.map(recoveryDisplayNode).some(node => node.config.assetTransferError === 'ACTOR_SCOPE_CHANGED' || node.config.assetTransferError === 'TRANSFER_INTERRUPTED')) && (
          <div className="absolute bottom-14 left-1/2 z-30 max-h-[min(200px,40vh)] w-max max-w-[min(420px,calc(100vw-32px))] -translate-x-1/2 space-y-2 overflow-y-auto rounded-md border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive shadow-lg">
          {wf.nodes.filter(node => node.type === 'input-image' && node.config.assetTransferPending === true
            && !node.config.assetTransferError && !node.config.assetTransferExpectedActorId
            && !node.config.assetTransferExpectedProjectId && !node.config.assetTransferExpectedSource).map(node => (
          <div key={'legacy-pending:' + node.id} role="alert">
            图片接收未完成，无法确认原账号、项目或素材。请重新选择当前项目的图片；接收完成前无法运行。
            <button type="button" className="min-h-11 px-2 underline" onClick={() => {
              setWorkflowInputActorReselectNode(previous => previous === node.id ? null : node.id);
            }}>重新选择图片</button>
            {workflowInputActorReselectNode === node.id && (
              <div>
                {!userId || !projectId ? '请先登录并打开项目。' : !(canvasImages?.length) ? '当前画布没有可选择的图片。'
                  : canvasImages.map(image => (
                    <button type="button" key={image.id} className="block min-h-11 w-full px-2 text-left underline" onClick={() => {
                      const current = wfRef.current.nodes.find(entry => entry.id === node.id);
                      const source = canvasImages.find(entry => entry.id === image.id);
                      if (workflowInputScopeRef.current !== workflowInputScope || !userId || !projectId || !current
                        || current.type !== 'input-image' || current.config.assetTransferPending !== true
                        || current.config.assetTransferError || current.config.assetTransferExpectedActorId
                        || current.config.assetTransferExpectedProjectId || current.config.assetTransferExpectedSource || !source) return;
                      const guard = workflowInputTransferGuardRef.current;
                      const retryKey = JSON.stringify([workflowInputScope, node.id]);
                      if (workflowInputActorRetries.current.get(retryKey)?.guard === guard) return;
                      const retry = { guard };
                      workflowInputActorRetries.current.set(retryKey, retry);
                      const expectedSource = { id: source.id, url: source.url, projectId: source.projectId, versionId: source.versionId,
                        assetId: source.assetId, assetVersionId: source.assetVersionId, placementId: source.placementId };
                      updateWorkflow(previous => ({ ...previous, nodes: previous.nodes.map(entry => entry.id === node.id
                        ? { ...entry, config: { ...entry.config, ...createPendingWorkflowInputReference(source), assetTransferPending: true,
                          assetTransferError: 'TRANSFER_INTERRUPTED', assetTransferExpectedActorId: userId,
                          assetTransferExpectedProjectId: projectId, assetTransferExpectedSource: expectedSource,
                          projectId: undefined, assetId: undefined, assetVersionId: undefined, placementId: undefined } } : entry) }));
                      setWorkflowInputActorReselectNode(null);
                      void transferCanvasImageToWorkflow(node.id, source).finally(() => {
                        if (workflowInputActorRetries.current.get(retryKey) === retry) workflowInputActorRetries.current.delete(retryKey);
                      });
                    }}>{image.description || image.name || '画布图片'}</button>
                  ))}
              </div>
            )}
          </div>
          ))}
          {wf.nodes.map(recoveryDisplayNode).filter(node => (node.config.assetTransferError === 'ACTOR_SCOPE_CHANGED' || node.config.assetTransferError === 'TRANSFER_INTERRUPTED')).map(node => (
          <div key={node.id} role="alert">
            {!node.config.assetTransferExpectedProjectId
              ? '无法确认原目标项目，旧图片接收已暂停。本节点保留原内容；可在当前项目的新工作流中重新选择图片。'
              : node.config.assetTransferExpectedProjectId !== projectId
                ? '图片接收属于原项目，请切回原项目重试；也可在当前项目的新工作流中重新选择图片。'
                : workflowInputActorSourceChanged === node.id ? '素材或节点已变化，请重新选择图片。' : node.config.assetTransferError === 'TRANSFER_INTERRUPTED' ? '图片接收已中断，请在原账号和项目重试接收或重新选择图片。' : '账号已切换或不一致，图片尚未接收。请切回原账号后重试接收或重新选择图片。'}
            <button type="button" className="min-h-11 px-2 underline" onClick={() => {
              const current = wfRef.current.nodes.find(entry => entry.id === node.id);
              const origin = current ? abandonedMaterialOrigin(current) : undefined;
              const expected = (origin ? recoveryDisplayNode(current!).config.assetTransferExpectedSource : current?.config.assetTransferExpectedSource) as Partial<CanvasImageRef> | undefined;
              const source = canvasImages?.find(image => image.id === expected?.id);
              const expectedActor = origin?.actor || current?.config.assetTransferExpectedActorId;
              const expectedProject = origin?.project || current?.config.assetTransferExpectedProjectId;
              if (!current || !userId || !projectId || expectedActor !== userId || expectedProject !== projectId) return;
              if (current.config.source !== 'canvas') {
                setWorkflowInputActorSourceChanged(node.id);
                return;
              }
              if (current.config.assetTransferPending !== true || !expected || !source
                || current.config.sourceImageId !== expected.id || current.config.imageUrl !== expected.url
                || source.url !== expected.url || source.projectId !== expected.projectId
                || source.versionId !== expected.versionId || (expected.assetId !== undefined && source.assetId !== expected.assetId)
                || source.assetVersionId !== expected.assetVersionId || source.placementId !== expected.placementId
                || ((origin || persistedInterruptedMaterial(current)) && (!expected.assetVersionId || !expected.projectId
                  || current.config.sourceVersionId !== expected.versionId))) {
                setWorkflowInputActorSourceChanged(node.id);
                return;
              }
              const retryKey = JSON.stringify([workflowInputScope, node.id]);
              const guard = workflowInputTransferGuardRef.current;
              if (workflowInputActorRetries.current.get(retryKey)?.guard === guard) return;
              const retry = { guard };
              workflowInputActorRetries.current.set(retryKey, retry);
              if (origin || persistedInterruptedMaterial(current)) {
                if (origin) origin.guard = guard;
                updateWorkflowSystem(previous => ({ ...previous, nodes: previous.nodes.map(entry => entry.id === node.id
                  ? { ...entry, config: { ...entry.config, assetTransferPending: true, assetTransferError: 'TRANSFER_INTERRUPTED',
                    assetTransferExpectedActorId: expectedActor, assetTransferExpectedProjectId: expectedProject,
                    assetTransferExpectedSource: expected } } : entry) }));
              }
              void transferCanvasImageToWorkflow(node.id, source).finally(() => {
                if (workflowInputActorRetries.current.get(retryKey) === retry) workflowInputActorRetries.current.delete(retryKey);
              });
            }}>重试接收图片</button>
            {node.config.source === 'upstream' && node.config.assetTransferPending === true && !!userId && !!projectId
              && node.config.assetTransferExpectedActorId === userId && node.config.assetTransferExpectedProjectId === projectId && (
              <button type="button" className="min-h-11 px-2 underline" onClick={() => {
                const current = wfRef.current.nodes.find(entry => entry.id === node.id);
                if (!current || current.type !== 'input-image' || current.config.source !== 'upstream'
                  || current.config.assetTransferPending !== true || (current.config.assetTransferError !== 'ACTOR_SCOPE_CHANGED' && current.config.assetTransferError !== 'TRANSFER_INTERRUPTED')
                  || !userId || !projectId || current.config.assetTransferExpectedActorId !== userId
                  || current.config.assetTransferExpectedProjectId !== projectId) return;
                try { readWorkflowImageInputTransform(current); } catch {
                  setNodeAnnotationError('图片接收设置无效，请检查接收端口和切分设置。');
                  return;
                }
                workflowInputTransferGuardRef.current.invalidate(node.id);
                workflowInputActorRetries.current.delete(JSON.stringify([workflowInputScope, node.id]));
                setWorkflowInputActorSourceChanged(previous => previous === node.id ? null : previous);
                updateWorkflow(previous => ({ ...previous, nodes: previous.nodes.map(entry => entry.id === node.id
                  ? { ...entry, config: { ...entry.config, imageUrl: '', sourceImageId: undefined, sourceVersionId: undefined,
                    projectId: undefined, assetId: undefined, assetVersionId: undefined, placementId: undefined,
                    assetTransferPending: false, assetTransferError: undefined, assetTransferExpectedActorId: undefined,
                    assetTransferExpectedProjectId: undefined, assetTransferExpectedSource: undefined } } : entry) }));
              }}>确认使用上游图片</button>
            )}
            <button type="button" className="min-h-11 px-2 underline" onClick={() => {
              setWorkflowInputActorReselectNode(previous => previous === node.id ? null : node.id);
            }}>重新选择图片</button>
            {workflowInputActorReselectNode === node.id && (
              <div>
                {(!userId || !projectId || node.config.assetTransferExpectedActorId !== userId
                  || node.config.assetTransferExpectedProjectId !== projectId)
                  ? '请先切回原账号并确认已打开项目。'
                  : !(canvasImages?.length) ? '当前画布没有可选择的图片。'
                  : canvasImages.map(image => (
                    <button type="button" key={image.id} className="block min-h-11 w-full px-2 text-left underline" onClick={() => {
                      const current = wfRef.current.nodes.find(entry => entry.id === node.id);
                      const source = canvasImages.find(item => item.id === image.id);
                      if (!current || current.type !== 'input-image' || (current.config.assetTransferError !== 'ACTOR_SCOPE_CHANGED' && current.config.assetTransferError !== 'TRANSFER_INTERRUPTED')
                        || current.config.assetTransferPending !== true || !userId || !projectId
                        || current.config.assetTransferExpectedActorId !== userId
                        || current.config.assetTransferExpectedProjectId !== projectId || !source) return;
                      setWorkflowInputActorReselectNode(null);
                      void transferCanvasImageToWorkflow(node.id, source);
                    }}>{image.description || image.name || '画布图片'}</button>
                  ))}
              </div>
            )}
          </div>
          ))}
          </div>
        )}
        {blockedNodeRetryNotice && wf.nodes.some(node => node.type === 'input-image'
          && node.config.assetTransferPending === true && (node.config.assetTransferError === 'ACTOR_SCOPE_CHANGED' || node.config.assetTransferError === 'TRANSFER_INTERRUPTED' || (!node.config.assetTransferError && !node.config.assetTransferExpectedActorId && !node.config.assetTransferExpectedProjectId && !node.config.assetTransferExpectedSource))) && (
          <div role="alert" className="absolute top-14 left-1/2 z-30 max-w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive shadow-lg">
            有图片尚未接收，当前无法重试节点；请先处理图片的账号或项目提示。
          </div>
        )}
        {nodeAnnotationError && !nodeAnnotationSession && (
          <div
            className="absolute bottom-14 left-1/2 z-30 max-w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive shadow-lg"
            role="alert"
          >
            {nodeAnnotationError}
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex h-[146px] max-h-[calc(100%-1.5rem)] items-end justify-between gap-3">
        {/* 端口类型图例：与地图分区，短屏时可独立滚动查看全部类型。 */}
        {selectedNodeIds.size === 0 && (
          <div data-workflow-port-legend data-workflow-ui-occlusion className="pointer-events-auto flex max-h-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-y-auto overscroll-contain rounded border border-border bg-card/90 px-3 py-2 text-xs max-md:[@media(max-height:400px)]:p-0">
            <button type="button" aria-label="端口图例" aria-expanded={portLegendExpanded} onClick={() => setPortLegendExpanded(value => !value)} className="hidden min-h-11 min-w-11 items-center justify-center px-2 text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary max-md:[@media(max-height:400px)]:inline-flex">图例</button>
            <div data-workflow-port-legend-items className={`contents ${portLegendExpanded ? 'max-md:[@media(max-height:400px)]:flex max-md:[@media(max-height:400px)]:max-h-16 max-md:[@media(max-height:400px)]:flex-wrap max-md:[@media(max-height:400px)]:gap-x-3 max-md:[@media(max-height:400px)]:gap-y-1 max-md:[@media(max-height:400px)]:overflow-y-auto max-md:[@media(max-height:400px)]:overscroll-contain max-md:[@media(max-height:400px)]:px-3 max-md:[@media(max-height:400px)]:pt-1 max-md:[@media(max-height:400px)]:pb-2' : 'max-md:[@media(max-height:400px)]:hidden'}`}>
            {Object.entries(PORT_COLORS).map(([type, color]) => (
              <div key={type} data-workflow-port-type className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-muted-foreground">{type}</span>
              </div>
            ))}
            </div>
          </div>
        )}

        {/* 小地图：SVG内容与视口使用同一坐标系，不估算窗口比例。 */}
        {showMinimap && (() => {
          const padding = 100;
          const allX = wf.nodes.map(n => n.x);
          const allY = wf.nodes.map(n => n.y);
          const minX = Math.min(0, ...allX) - padding;
          const minY = Math.min(0, ...allY) - padding;
          const maxX = Math.max(1200, ...allX.map((x, i) => x + wf.nodes[i].width)) + padding;
          const maxY = Math.max(800, ...allY.map((y, i) => y + wf.nodes[i].height)) + padding;
          const vw = maxX - minX;
          const vh = maxY - minY;
          const centerOn = (x: number, y: number): void => {
            const rect = canvasContainerRef.current?.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return;
            setViewport(current => ({ ...current, x: rect.width / 2 - x * current.zoom, y: rect.height / 2 - y * current.zoom }));
          };
          return (
            <div
              id="workflow-minimap"
              data-workflow-minimap
              data-workflow-ui-occlusion
              className="pointer-events-auto ml-auto flex h-full w-28 min-[360px]:w-40 shrink-0 flex-col overflow-hidden rounded border border-border bg-card/90"
            >
              <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
                <span className="text-sm font-medium text-foreground">小地图</span>
                <button
                  type="button"
                  aria-label="关闭小地图"
                  onClick={() => { setShowMinimap(false); minimapToggleRef.current?.focus(); }}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <svg
                viewBox={`${minX} ${minY} ${vw} ${vh}`}
                role="button"
                tabIndex={0}
                aria-label="小地图导航"
                aria-describedby="workflow-minimap-help"
                className="min-h-0 w-full flex-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                onPointerDown={event => minimapPointer.begin(event.currentTarget, event.nativeEvent)}
                onPointerUp={event => minimapPointer.end(event.currentTarget, event.nativeEvent)}
                onPointerCancel={minimapPointer.clear}
                onLostPointerCapture={minimapPointer.captureLost}
                onClick={event => {
                  const client = minimapPointer.consume(event.currentTarget, event.nativeEvent);
                  if (!client) return;
                  const matrix = event.currentTarget.getScreenCTM();
                  if (!matrix) return;
                  const point = new DOMPoint(client.clientX, client.clientY).matrixTransform(matrix.inverse());
                  centerOn(point.x, point.y);
                }}
                onKeyDown={event => {
                  minimapPointer.clear();
                  if (event.altKey || event.ctrlKey || event.metaKey) return;
                  const deltas: Record<string, { x: number; y: number }> = {
                    ArrowLeft: { x: 40, y: 0 }, ArrowRight: { x: -40, y: 0 },
                    ArrowUp: { x: 0, y: 40 }, ArrowDown: { x: 0, y: -40 },
                  };
                  const delta = deltas[event.key];
                  if (!delta && !['Enter', ' ', 'Home'].includes(event.key)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (delta) setViewport(current => ({ ...current, x: current.x + delta.x, y: current.y + delta.y }));
                  else centerOn(minX + vw / 2, minY + vh / 2);
                }}
              >
                <title id="workflow-minimap-help">点击定位；方向键移动画布；Enter、空格或 Home 定位到全图中心。</title>
                <rect
                  data-workflow-minimap-viewport
                  x={-nodeRenderViewport.x / nodeRenderViewport.zoom}
                  y={-nodeRenderViewport.y / nodeRenderViewport.zoom}
                  width={nodeViewportSize.width / nodeRenderViewport.zoom}
                  height={nodeViewportSize.height / nodeRenderViewport.zoom}
                  className="pointer-events-none fill-primary/10 stroke-primary/60"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                {wf.connections.map(conn => {
                  const from = wf.nodes.find(n => n.id === conn.fromNodeId);
                  const to = wf.nodes.find(n => n.id === conn.toNodeId);
                  if (!from || !to) return null;
                  return <line key={conn.id} x1={from.x + from.width / 2} y1={from.y + from.height / 2} x2={to.x + to.width / 2} y2={to.y + to.height / 2} stroke={PORT_COLORS[conn.type] || T.connColor} strokeWidth={2} opacity={0.6} />;
                })}
                {wf.nodes.map(n => (
                  <rect key={n.id} data-workflow-minimap-node={n.id} x={n.x} y={n.y} width={n.width} height={n.height} rx={4}
                    fill={selectedNodeIds.has(n.id) ? 'var(--ne-accent)' : NODE_TYPE_COLORS[getNodeCategory(n.type)]}
                    fillOpacity={0.6} stroke="none"
                  />
                ))}
              </svg>
            </div>
          );
        })()}
        </div>

      </div>{/* 主画布 end */}

      {/* ═══ 右侧属性面板 - 与原型对齐: w-72, 始终可见 ═══ */}
      <aside
        data-workflow-ui-occlusion
        className={`${selectedNode && !legacyPropertiesDeferred ? 'absolute inset-y-0 right-0 z-50 flex w-[min(20rem,90vw)] shadow-2xl' : 'hidden'} shrink-0 flex-col overflow-hidden border-l border-border/20 bg-card md:relative md:inset-auto md:z-auto md:flex md:w-72 md:shadow-none`}
      >
        <div className="workflow-node-properties-header flex shrink-0 items-center gap-1 px-3 h-11 border-b border-border/10">
          <span className="min-w-0 truncate whitespace-nowrap text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground">节点属性</span>
          {selectedNode && (
            <button type="button" aria-label="节点菜单" aria-haspopup="menu" aria-controls="workflow-context-menu"
              aria-expanded={contextMenu?.type === 'node' && contextMenu.nodeId === selectedNode.id}
              className="ml-auto inline-flex h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 text-sm text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              onClick={event => {
                const anchor = event.currentTarget.getBoundingClientRect();
                setContextMenu({ type: 'node', nodeId: selectedNode.id, x: anchor.left, y: anchor.bottom,
                  scope: legacyPointerScopeRef.current, returnFocus: event.currentTarget });
              }}>
              <MoreHorizontal size={16} aria-hidden="true" /><span>节点菜单</span>
            </button>
          )}
          {selectedNode && !selectedNode.type.startsWith('condition-') && (
            <button
              type="button"
              className="workflow-touch-node-action h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              aria-label={collapsedNodes.has(selectedNode.id) ? '展开节点' : '折叠节点'}
              title={collapsedNodes.has(selectedNode.id) ? '展开节点' : '折叠节点'}
              aria-expanded={!collapsedNodes.has(selectedNode.id)}
              onClick={() => toggleNodeCollapse(selectedNode.id)}
            >
              <ChevronDown size={16} aria-hidden="true" style={{ transform: collapsedNodes.has(selectedNode.id) ? 'rotate(0deg)' : 'rotate(180deg)' }} />
            </button>
          )}
          <button
            type="button"
            className="workflow-node-property-close inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary md:hidden"
            aria-label="关闭节点属性"
            disabled={!selectedNode}
            onClick={() => { setSelectedNodeIds(new Set()); setPortListOpen(false); setPortListSource(null); }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {selectedNode ? (
            <>
            {workflowRendererMode !== 'react-flow-v2' && (
              <section className="border-b border-border/20 p-3" aria-label="端口连接">
                <button type="button" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary"
                  aria-expanded={portListOpen} onClick={() => { setPortListOpen(open => !open); setPortListSource(null); }}>
                  连接端口
                </button>
                {portListOpen && (
                  <div className="mt-2 flex min-w-0 flex-col gap-2" onKeyDown={event => {
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPortListSource(null); setPortListOpen(false); }
                  }}>
                    <p className="text-sm text-muted-foreground" role="status">{portListSource ? '选择兼容的输入端口' : '选择输出端口'}</p>
                    {wf.nodes.flatMap(node => node.ports.filter(port => port.direction === (portListSource ? 'in' : 'out')).map(port => {
                      const label = portListSource ? `连接至 ${node.label} ${port.label} ${port.type}` : `从 ${node.label} ${port.label} ${port.type} 连接`;
                      const disabled = Boolean(portListSource && (node.id === portListSource.endpoint.nodeId || !canConnectPorts(portListSource.type, port.type)));
                      return <button key={JSON.stringify([node.id, port.direction, port.id])} type="button" aria-label={label} disabled={disabled}
                        className="min-h-11 w-full rounded-md border border-border px-3 py-2 text-left text-sm [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                        onClick={() => {
                          const endpoint: LegacyPortEndpoint = { nodeId: node.id, portId: port.id, direction: port.direction };
                          if (!portListSource) {
                            const fresh = wfRef.current.nodes.find(candidate => candidate.id === node.id)?.ports.find(candidate => candidate.id === port.id && candidate.direction === 'out');
                            if (fresh) setPortListSource({ endpoint, type: fresh.type, scope: legacyPointerScopeRef.current });
                          } else {
                            const source = portListSource;
                            setPortListSource(null); setPortListOpen(false);
                            completeLegacyConnection(source.endpoint, endpoint, source.type, source.scope);
                          }
                        }}>{label}</button>;
                    }))}
                    <button type="button" className="min-h-11 rounded-md border border-border px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => { setPortListSource(null); setPortListOpen(false); }}>取消连接</button>
                  </div>
                )}
              </section>
            )}
            {selectedNodeCompareImages && (
              <div className="border-b border-border/20 p-3">
                <button type="button" aria-label="对比原图" title="对比原图"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => { event.stopPropagation(); handleCompare(selectedNode.id); }}>
                  <GitCompare size={16} aria-hidden="true" /><span>对比原图</span>
                </button>
              </div>
            )}
            <PropertyPanel
              node={selectedNode}
              models={models}
              modelCatalogIndex={modelCatalogIndex}
              modelsLoading={modelsLoading}
              workflowSkills={workflowSkills}
              workflowSkillsLoading={workflowSkillsLoading}
              workflowSkillsError={workflowSkillsError}
              boundSourceVersionIds={selectedNodeBoundSourceVersionIds}
              onUpdate={handleNodeUpdate}
              onDelete={handleDeleteNode}
              onImageUpload={handleImageUpload}
              canvasImages={allCanvasImages}
              onCanvasImageSelect={transferCanvasImageToWorkflow}
              projectId={projectId}
              execResult={execResults[selectedNode.id]}
              sketchScope={sketchScope}
              onSketchInsert={onAddImages ? async reference => {
                sketchScope.assertCurrent(true);
                await onAddImages([{ outputNodeId: selectedNode.id, url: reference.url, assetReference: reference }]);
                sketchScope.assertCurrent(true);
              } : undefined}
              onSkillApproval={handleWorkflowSkillApproval}
            />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <MousePointer2 size={24} className="opacity-40" />
              <p className="text-xs">选中节点查看属性</p>
            </div>
          )}
        </div>
      </aside>
      </div>{/* 中间区域 end */}
      </div>{/* 主体水平行 end */}

      {materialTouchPreview && <div data-workflow-material-ghost aria-hidden="true"
        className="pointer-events-none fixed z-[300] flex h-11 w-40 items-center rounded border border-primary bg-card px-2 text-xs text-foreground shadow-lg"
        style={{ left: materialTouchPreview.x, top: materialTouchPreview.y }}><span className="truncate">{materialTouchPreview.label}</span></div>}
      {/* ═══ 底部面板: 内容条 + 执行日志 - 与原型对齐: 全宽底部 ═══ */}
      <div ref={executionDockRef} data-workflow-ui-occlusion className="shrink-0 border-t border-border/20 bg-card [@media(max-height:400px)]:shrink [@media(max-height:400px)]:max-h-[45dvh] [@media(max-height:400px)]:overflow-y-auto [@media(max-height:400px)]:overscroll-y-contain">
        {/* 内容条 */}
        {showContentStrip && (
        <div className="block border-b border-border/10">
          <div className="flex items-center justify-between px-4 h-8 max-md:[@media(max-height:400px)]:h-11">
            <div className="flex items-center gap-2">
              <FolderOpen size={12} className="text-primary" />
              <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground">内容</span>
              <span className="text-[10px] text-muted-foreground/60">{canvasImages?.length || 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" aria-label={compactContentExpanded ? '收起内容素材' : '展开内容素材'} aria-expanded={compactContentExpanded}
                className="hidden min-h-11 items-center justify-center px-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-primary max-md:[@media(max-height:400px)]:inline-flex"
                onClick={() => setCompactContentExpanded(expanded => !expanded)}>{compactContentExpanded ? '收起素材' : '展开素材'}</button>
              <button className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5"><Download size={10} /></button>
              <button onClick={() => setShowContentStrip(false)} className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5"><ChevronDown size={10} /></button>
            </div>
          </div>
          <div data-workflow-content-items className={`flex gap-2 px-4 pb-2 overflow-x-auto ${compactContentExpanded ? '' : 'max-md:[@media(max-height:400px)]:hidden'}`}>
            {(canvasImages || []).map((img, i) => (
              <div
                key={img.id}
                data-node-canvas-image={img.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData(CANVAS_ASSET_DRAG_MIME, serializeCanvasAssetDragPayload(img));
                  event.dataTransfer.setData('text/uri-list', img.url);
                  event.dataTransfer.setData('text/plain', img.url);
                }}
                className="shrink-0 w-14 flex flex-col group"
                title={img.description || img.name || `图片 ${i+1}`}
              >
                <div className="h-14 w-14 relative overflow-hidden rounded border border-border/20 bg-muted/30 cursor-grab active:cursor-grabbing">
                <NextImage unoptimized width={1} height={1} src={img.url} alt="" className="w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 text-[7px] text-center text-muted-foreground bg-card/80 py-px">
                  {(img.url?.split('.').pop() || 'PNG').toUpperCase()}
                </span>
                </div>
                {materialTouchAvailable && <button type="button" data-workflow-material-drag={img.id}
                  aria-label={'拖动素材 '+(img.description || img.name || '图片 '+(i+1))+' 到画布'}
                  title="激活时居中添加；触屏按住拖动可选择落点。"
                  className="mt-1 flex min-h-11 w-full items-center justify-center rounded border border-primary/40 bg-primary/10 px-1 text-[10px] text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ touchAction: 'none' }}
                  onPointerDown={event => beginMaterialTouch(event, img)} onPointerMove={moveMaterialTouch}
                  onPointerUp={finishMaterialTouch} onPointerCancel={cancelMaterialTouchEvent} onLostPointerCapture={cancelMaterialTouchEvent}
                  onClick={event => activateMaterialTouchButton(event, img.id)}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { materialTouchClickRef.current = null; event.stopPropagation(); if (event.key === 'Enter' && event.repeat) event.preventDefault(); } }}
                >按住拖入</button>}
              </div>
            ))}
            <button className="shrink-0 w-14 h-14 rounded border border-dashed border-border/30 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors cursor-pointer">
              <Plus size={14} />
            </button>
          </div>
        </div>
        )}

        {/* 执行日志 */}
        {showExecLog && (
        <div ref={executionLogPanelRef}>
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-1">
            <div className="flex items-center gap-2">
              <ScrollText size={12} className="text-primary" />
              <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-muted-foreground">执行日志</span>
              <span className="text-[10px] text-muted-foreground/60">{execLogs.length}条记录</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="清空执行日志" onClick={() => setExecLogs([])} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:text-foreground cursor-pointer focus-visible:ring-2 focus-visible:ring-primary"><Trash2 size={10} /></button>
              <button type="button" aria-label="收起执行日志" onClick={() => setShowExecLog(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:text-foreground cursor-pointer focus-visible:ring-2 focus-visible:ring-primary"><ChevronDown size={10} /></button>
            </div>
          </div>
          <div className="max-h-[120px] overflow-y-auto text-[10px] px-4 pb-2">
            {execLogs.length === 0 ? (
              <div className="text-muted-foreground/50 py-2 text-center">暂无执行记录</div>
            ) : (
              execLogs.map((log, i) => (
                <div key={i} className={`flex max-md:flex-wrap items-center gap-2 py-1 group ${log.status === 'error' ? 'text-red-400/80' : ''}`}>
                  {log.status === 'success' ? <Check size={8} className="text-green-400 shrink-0" /> : log.status === 'running' ? <Loader2 size={8} className="text-yellow-400 shrink-0 animate-spin" /> : <AlertCircle size={8} className="text-red-400 shrink-0" />}
                  <span className="text-foreground/80 shrink-0 max-md:order-last max-md:basis-full max-md:break-all font-medium">{log.label}</span>
                  <span className={`flex-1 truncate max-md:order-last max-md:basis-full max-md:break-all max-md:overflow-visible max-md:text-clip max-md:whitespace-normal ${log.status === 'success' ? 'text-green-400/60' : log.status === 'running' ? 'text-yellow-400/60' : 'text-red-400/60'}`}>{log.message}</span>
                  {log.duration != null && <span className="text-muted-foreground/40 shrink-0 tabular-nums">{log.duration >= 1000 ? `${(log.duration / 1000).toFixed(1)}s` : `${log.duration}ms`}</span>}
                  {/* B2: 失败节点一键重试 */}
                  {log.status === 'error' && (
                    <button type="button" aria-label="重试此节点" disabled={Boolean(imageRetryRequestRef.current || imageRetryViewRef.current?.active || imageRetryViewRef.current?.pending && imageRetryViewRef.current.pending.nodeId !== log.nodeId)} onClick={(e) => { e.stopPropagation(); handleRetryNode(log.nodeId); }} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 whitespace-nowrap rounded px-2 text-xs bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary cursor-pointer shrink-0" title="重试此节点">
                      <RefreshCw size={14} aria-hidden="true" />
                      <span>重试</span>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        )}
      </div>
      {nodeAnnotationCandidates && (
        <div
          className="fixed inset-0 z-[205] flex items-center justify-center bg-black/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="node-annotation-image-picker-title"
          onClick={() => setNodeAnnotationCandidates(null)}
        >
          <div
            className="w-full max-w-2xl rounded-md border border-border bg-card p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="node-annotation-image-picker-title" className="text-sm font-semibold">
                选择要批注的图片
              </h2>
              <button
                type="button"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:h-6 lg:w-6"
                onClick={() => setNodeAnnotationCandidates(null)}
                aria-label="关闭图片选择"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
              {nodeAnnotationCandidates.candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="overflow-hidden rounded-md border border-border bg-muted text-left transition-colors hover:border-primary"
                  onClick={() => {
                    const sourceNode = wf.nodes.find(
                      (node) => node.id === nodeAnnotationCandidates.sourceNodeId,
                    );
                    if (!sourceNode) return;
                    if (nodeAnnotationCandidates.existingBundle) {
                      openNodeAnnotation(
                        sourceNode,
                        candidate,
                        nodeAnnotationCandidates.existingBundle,
                      );
                    } else {
                      openNodeAnnotation(sourceNode, candidate);
                    }
                  }}
                >
                  <span className="relative block aspect-square bg-[#0d1117]">
                    <NextImage
                      unoptimized
                      fill
                      sizes="220px"
                      src={candidate.url}
                      alt={candidate.label}
                      className="object-contain"
                    />
                  </span>
                  <span className="block truncate px-2 py-1.5 text-xs">
                    {candidate.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {nodeAnnotationSession && (
        <NodeAnnotationWorkspace
          source={nodeAnnotationSession.source}
          models={annotationModels}
          initialBundle={nodeAnnotationSession.existingBundle}
          preferredModelId={preferredAnnotationModelId}
          onCreateNode={handleCreateAnnotationNode}
          onClose={() => setNodeAnnotationSession(null)}
        />
      )}
      {aiBuildOpen && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-build-title"
          onClick={closeAiBuild}
        >
          <div
            data-modal
            className="w-full max-w-xl rounded-lg border border-border bg-card p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 id="ai-build-title" className="text-base font-semibold text-foreground">AI 建图</h2>
                <p className="mt-1 text-xs text-muted-foreground">描述目标工作流，系统会生成可继续编辑的节点与连线。</p>
              </div>
              <button
                type="button"
                onClick={closeAiBuild}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="关闭 AI 建图"
                title="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <textarea
              autoFocus
              value={aiBuildInput}
              onChange={(event) => setAiBuildInput(event.target.value)}
              placeholder="例如：上传商品图，生成电商主图，放大后导出 PNG"
              className="min-h-32 w-full resize-y rounded border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            {aiBuildError && <p className="mt-2 text-xs text-destructive" role="alert">{aiBuildError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAiBuild}
                className="rounded px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleAiBuild()}
                disabled={!aiBuildInput.trim() || aiBuildLoading}
                className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiBuildLoading ? '生成中...' : '生成工作流'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图片预览弹窗 */}
      {imagePreviewUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setImagePreviewUrl(null)}>
          <div className="relative" style={{ width: '80vw', height: '80vh' }}>
            <NextImage unoptimized width={1} height={1} src={imagePreviewUrl} alt="预览" className="rounded shadow-2xl" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            <button
              type="button"
              aria-label="下载预览图片"
              title="下载预览图片"
              disabled={imagePreviewDownloadState === 'downloading'}
              onClick={async event => {
                event.stopPropagation();
                setImagePreviewDownloadState('downloading');
                try {
                  let response: Response;
                  try {
                    response = await fetch(imagePreviewUrl);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                  } catch {
                    const persistResponse = await fetch('/api/save-image', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ imageUrl: imagePreviewUrl }),
                    });
                    if (!persistResponse.ok) throw new Error(`HTTP ${persistResponse.status}`);
                    const persisted = await persistResponse.json() as { success?: boolean; url?: string; savedUrl?: string; localUrl?: string };
                    const persistedUrl = persisted.url || persisted.savedUrl || persisted.localUrl;
                    if (!persisted.success || !persistedUrl) throw new Error('图片持久化失败');
                    response = await fetch(persistedUrl);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                  }
                  const blobUrl = URL.createObjectURL(await response.blob());
                  const link = document.createElement('a');
                  link.href = blobUrl;
                  link.download = 'wujie-workflow-result.png';
                  document.body.appendChild(link);
                  link.click();
                  link.remove();
                  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
                  setImagePreviewDownloadState('idle');
                } catch {
                  setImagePreviewDownloadState('error');
                }
              }}
              className="absolute -top-2 right-12 inline-flex h-11 w-11 items-center justify-center bg-muted rounded-full text-muted-foreground hover:text-foreground cursor-pointer disabled:cursor-wait disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-primary"
            >
              {imagePreviewDownloadState === 'downloading' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            </button>
            <button type="button" aria-label="关闭预览" onClick={() => setImagePreviewUrl(null)} className="absolute -top-2 -right-2 inline-flex h-11 w-11 items-center justify-center bg-muted rounded-full text-muted-foreground hover:text-foreground cursor-pointer focus-visible:ring-2 focus-visible:ring-primary">
              <X size={14} />
            </button>
            {imagePreviewDownloadState === 'error' && (
              <div role="alert" className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-destructive px-3 py-1.5 text-xs text-destructive-foreground">
                下载失败，请稍后重试
              </div>
            )}
          </div>
        </div>
      )}

      {/* 节点结果复用统一图片对比窗口，原图与结果仍由 handleCompare 解析。 */}
      {compareImages && (
        <ImageCompareDialog
          leftImage={{ url: compareImages.before }}
          rightImage={{ url: compareImages.after }}
          isMonochrome={themeStyle === 'monochrome'}
          onClose={() => setCompareImages(null)}
        />
      )}

      {/* P2: JSON编辑器弹窗 */}
      {jsonEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={() => setJsonEditorOpen(false)}>
          <div ref={jsonDialogRef} role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="workflow-json-editor-title" onKeyDown={event => event.stopPropagation()} className="flex h-[min(80dvh,40rem)] max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-border bg-card" onClick={e => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1">
              <span id="workflow-json-editor-title" className="min-w-0 text-sm font-semibold text-primary">工作流 JSON 编辑器</span>
              <button type="button" aria-label="关闭 JSON 编辑器" onClick={() => setJsonEditorOpen(false)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground cursor-pointer focus-visible:ring-2 focus-visible:ring-primary"><X size={14} /></button>
            </div>
            <textarea
              ref={jsonInputRef} aria-label="工作流 JSON 内容" value={jsonEditContent}
              aria-invalid={jsonEditorError ? true : undefined}
              aria-describedby={jsonEditorError ? "workflow-json-editor-error" : undefined}
              onChange={e => { setJsonEditContent(e.target.value); setJsonEditorError(null); }}
              className="min-h-0 w-full flex-1 resize-none overflow-auto overscroll-contain bg-muted p-3 font-mono text-base leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              spellCheck={false}
            />
            {jsonEditorError && (
              <p id="workflow-json-editor-error" role="alert" className="shrink-0 border-t border-border px-3 py-2 text-sm text-destructive">
                {jsonEditorError}
              </p>
            )}
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-3 py-2">
              <button type="button" onClick={() => setJsonEditorOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap rounded bg-muted px-3 py-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer focus-visible:ring-2 focus-visible:ring-primary">取消</button>
              <button
                onClick={() => {
                  let parsedSuccessfully = false;
                  try {
                    const parsed = JSON.parse(jsonEditContent);
                    parsedSuccessfully = true;
                    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
                      || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.connections)) {
                      setJsonEditorError('工作流结构错误：nodes 和 connections 必须为数组。');
                      return;
                    }
                    if (!isWorkflowGraph(parsed)) {
                      setJsonEditorError('节点、端口、配置或连线的数据类型不正确，请检查后重试。');
                      return;
                    }
                    if (parsed.nodes && parsed.connections) {
                      updateWorkflow(prev => ({ ...prev, nodes: parsed.nodes, connections: parsed.connections }));
                      setJsonEditorError(null);
                      setJsonEditorOpen(false);
                    }
                  } catch {
                    setJsonEditorError(parsedSuccessfully
                      ? '未能应用更改，请检查内容后重试。'
                      : 'JSON 格式错误，请检查括号、引号和逗号后重新应用。');
                  }
                }}
                type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap rounded bg-primary/20 px-3 py-2 text-sm text-primary hover:bg-primary/30 cursor-pointer focus-visible:ring-2 focus-visible:ring-primary"
              >
                应用更改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 菜单只负责可视位置和输入；业务动作仍走原 handleContextAction。 */}
      {contextMenu && (
        <WorkflowContextMenu menu={contextMenu} hasClipboard={!!clipboard}
          extraNodeActions={extraNodeActions}
          onAction={handleContextAction} onClose={closeContextMenu} />
      )}
    </div>
    </>
  );
}

// ==================== 属性面板 ====================

interface PropertyPanelProps {
  node: WorkflowNode | null;
  models: ModelOption[];
  modelCatalogIndex: Map<string, TaskModelDescriptor>;
  modelsLoading: boolean;
  workflowSkills: SkillDefinition[];
  workflowSkillsLoading: boolean;
  workflowSkillsError: string | null;
  boundSourceVersionIds: readonly string[];
  onUpdate: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onDelete: (nodeId: string) => void;
  onImageUpload: (nodeId: string, file: File) => void;
  /** P0: 画布图片列表，用于@图片引用 */
  canvasImages?: CanvasImageRef[];
  onCanvasImageSelect: (nodeId: string, image: CanvasImageRef) => Promise<void>;
  projectId?: string;
  execResult?: { status: string; output?: Record<string, unknown>; error?: string };
  sketchScope: SketchScope;
  onSketchInsert?: SketchInsert;
  onSkillApproval: (
    nodeId: string,
    runId: string,
    action: 'approve' | 'revise' | 'cancel',
    identity?: SkillApprovalIdentity,
    revisionInstruction?: string,
  ) => Promise<boolean>;
}

function PropertyPanel({ node, models, modelCatalogIndex, modelsLoading, workflowSkills, workflowSkillsLoading, workflowSkillsError, boundSourceVersionIds, onUpdate, onDelete, onImageUpload, canvasImages, onCanvasImageSelect, projectId, execResult, onSkillApproval, sketchScope, onSketchInsert }: PropertyPanelProps) {
  const fieldScopeId = React.useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localTextValues, setLocalTextValues] = useState<Record<string, string>>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [mentionPopup, setMentionPopup] = useState<MentionPopup>({ visible: false, nodeId: '', fieldKey: '', filter: '', position: { top: 0, left: 0 } });

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Settings size={24} className="mx-auto mb-2 opacity-30" />
          <p>选择节点查看属性</p>
        </div>
      </div>
    );
  }

  const cat = getNodeCategory(node.type);
  const color = NODE_TYPE_COLORS[cat];
  const fields = getNodePropertyFields(node.type);
  const controlId = (key: string, fieldIndex: number): string => `${fieldScopeId}-workflow-node-${node.id}-${fieldIndex}-${key}`;
  const fieldLabelId = (key: string, fieldIndex: number): string => `${controlId(key, fieldIndex)}-label`;
  const isCanvasFeature = ['ai-font-design', 'ai-refine-engine', 'ai-human-repair', 'ai-brand-ecommerce', 'ai-segment', 'ai-multi-angle', 'ai-3d-model'].includes(node.type);
  const configuredModel = String(node.config?.model || '');
  const configuredModelSeparator = configuredModel.indexOf('::');
  const configuredProviderId = configuredModelSeparator >= 0
    ? configuredModel.slice(0, configuredModelSeparator)
    : String(node.config?.providerId || '');
  const configuredModelId = configuredModelSeparator >= 0
    ? configuredModel.slice(configuredModelSeparator + 2)
    : configuredModel;
  const configuredDescriptor = modelCatalogIndex.get(taskModelKey(configuredProviderId, configuredModelId));
  const selectedSkill = node.type === 'ai-skill'
    ? workflowSkills.find(skill => skill.id === node.config.skillId && skill.version === Number(node.config.version))
    : undefined;
  const skillModelRoles = selectedSkill
    ? requiredSkillModelRoles(selectedSkill)
    : [];
  const configuredSkillInputs = node.config.inputValues && typeof node.config.inputValues === 'object'
    && !Array.isArray(node.config.inputValues)
    ? node.config.inputValues as Record<string, unknown>
    : {};
  const displayedSkillInputs = selectedSkill
    ? selectedSkill.inputs.reduce<Record<string, unknown>>((values, field) => {
        if (field.bindToSourceVersions) values[field.key] = [...boundSourceVersionIds];
        return values;
      }, { ...configuredSkillInputs })
    : configuredSkillInputs;
  const configuredSkillBindings = node.config.modelBindings && typeof node.config.modelBindings === 'object'
    && !Array.isArray(node.config.modelBindings)
    ? node.config.modelBindings as Record<string, { providerId?: string; modelId?: string }>
    : {};

  const modelsForSkillRole = (role: SkillModelBinding['role']): ModelOption[] => {
    return models.filter(model => {
      if (!model.providerId) return false;
      const descriptor = modelCatalogIndex.get(taskModelKey(model.providerId, model.id));
      return descriptor ? workflowModelSupportsSkillRole(role, descriptor) : false;
    });
  };

  const renderField = (field: PropertyField, fieldIndex: number) => {
    const externalValue = node.type === 'input-text' && field.key === 'text'
      ? node.config?.textContent || node.config?.text || ''
      : node.config?.[field.key] ?? (node as unknown as Record<string, unknown>)[field.key] ?? field.defaultValue ?? '';
    const serializedExternalValue = (
      externalValue
      && typeof externalValue === 'object'
    )
      ? JSON.stringify(externalValue, null, 2)
      : String(externalValue);
    // 聚焦时使用本地缓存值，避免每次按键触发 onUpdate → 重渲染 → 闪烁
    const isFocused = focusedField === `${node.id}:${field.key}`;
    const displayValue = isFocused
      ? (localTextValues[field.key] ?? serializedExternalValue)
      : serializedExternalValue;

    const onChangeText = (val: string) => {
      // 更新本地缓存
      setLocalTextValues(prev => ({ ...prev, [field.key]: val }));
    };

    const onFocusField = () => {
      setFocusedField(`${node.id}:${field.key}`);
      setLocalTextValues(prev => ({
        ...prev,
        [field.key]: serializedExternalValue,
      }));
    };

    const onBlurField = () => {
      setFocusedField(null);
      if (field.readOnly) return;
      // 失焦时同步到父组件
      const localVal = localTextValues[field.key];
      if (localVal !== undefined && localVal !== serializedExternalValue) {
        onUpdate(node.id, field.key === 'label'
          ? { label: localVal }
          : { config: { [field.key]: localVal } });
      }
      setLocalTextValues(prev => {
        const next = { ...prev };
        delete next[field.key];
        return next;
      });
    };

    switch (field.type) {
      case 'text':
        return (
          <input
            id={controlId(field.key, fieldIndex)}
            type="text"
            value={displayValue}
            onChange={e => onChangeText(e.target.value)}
            onFocus={onFocusField}
            onBlur={onBlurField}
            readOnly={field.readOnly}
            placeholder={field.placeholder}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 read-only:cursor-default read-only:opacity-75"
          />
        );

      case 'textarea': {
        // P0: 提示词字段支持@图片引用
        const isPromptField = field.key === 'prompt' || field.key === 'text' || field.key === 'stylePrompt' || field.key === 'negativePrompt';
        return (
          <div className="relative">
            <textarea
              id={controlId(field.key, fieldIndex)}
              value={displayValue}
              onChange={e => {
                onChangeText(e.target.value);
                // P0: 检测@符号触发图片引用弹窗
                if (isPromptField && canvasImages && canvasImages.length > 0) {
                  const text = e.target.value;
                  const cursorPos = e.target.selectionStart || text.length;
                  const textBeforeCursor = text.slice(0, cursorPos);
                  const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);
                  if (atMatch) {
                    const textarea = e.target;
                    const rect = textarea.getBoundingClientRect();
                    setMentionPopup({
                      visible: true,
                      nodeId: node.id,
                      fieldKey: field.key,
                      filter: atMatch[1].toLowerCase(),
                      position: { top: rect.bottom - rect.top + 4, left: 16 },
                    });
                  } else {
                    if (mentionPopup.visible) setMentionPopup(prev => ({ ...prev, visible: false }));
                  }
                }
              }}
              onFocus={onFocusField}
              onBlur={onBlurField}
              readOnly={field.readOnly}
              placeholder={isPromptField && canvasImages && canvasImages.length > 0 ? `${field.placeholder} (输入@引用画布图片)` : field.placeholder}
              rows={3}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-y read-only:cursor-default read-only:opacity-75"
            />
            {/* P0: @图片引用弹窗 */}
            {isPromptField && mentionPopup.visible && mentionPopup.nodeId === node.id && mentionPopup.fieldKey === field.key && (
              <div
                className="absolute z-50 bg-card border border-primary/30 rounded shadow-lg max-h-40 overflow-y-auto"
                style={{ top: mentionPopup.position.top, left: mentionPopup.position.left, minWidth: 180 }}
              >
                {canvasImages
                  ?.filter(img => {
                    const desc = img.description || img.url;
                    return !mentionPopup.filter || desc.toLowerCase().includes(mentionPopup.filter);
                  })
                  .slice(0, 6)
                  .map(img => (
                    <button
                      key={img.id}
                      className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-primary/10 hover:text-primary flex items-center gap-2 cursor-pointer"
                      onMouseDown={e => {
                        // 用 onMouseDown 替代 onClick，在 blur 之前触发
                        e.preventDefault();
                        // 在@位置插入图片引用
                        const currentValue = displayValue;
                        const cursorPos = currentValue.length;
                        const beforeAt = currentValue.slice(0, cursorPos).replace(/@[^\s@]*$/, '');
                        const afterCursor = currentValue.slice(cursorPos);
                        const ref = `[img:${img.id}]`;
                        const newValue = beforeAt + ref + afterCursor;
                        onChangeText(newValue);
                        // 立即同步到父组件
                        onUpdate(node.id, { config: { [field.key]: newValue } });
                        setMentionPopup(prev => ({ ...prev, visible: false }));
                      }}
                    >
                      <span className="w-6 h-6 rounded bg-card flex-shrink-0 overflow-hidden">
                        {img.url && <NextImage unoptimized width={1} height={1} src={img.url} alt="" className="w-full h-full object-cover" />}
                      </span>
                      <span className="truncate">{img.description || img.url.slice(-20)}</span>
                    </button>
                  ))
                }
                {(!canvasImages || canvasImages.filter(img => {
                  const desc = img.description || img.url;
                  return !mentionPopup.filter || desc.toLowerCase().includes(mentionPopup.filter);
                }).length === 0) && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">无匹配图片</div>
                )}
              </div>
            )}
          </div>
        );
      }

      case 'number':
        return (
          <input
            id={controlId(field.key, fieldIndex)}
            type="number"
            value={externalValue !== undefined && externalValue !== '' ? Number(externalValue) : (field.defaultValue != null ? Number(field.defaultValue) : '')}
            onChange={e => onUpdate(node.id, { config: { [field.key]: e.target.value === '' ? '' : Number(e.target.value) } })}
            min={field.min}
            max={field.key === 'count' || field.key === 'n'
              ? configuredDescriptor?.maxOutputs || field.max
              : field.max}
            step={field.step || 1}
            placeholder={field.placeholder}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        );

      case 'select': {
        let dynamicOptions = field.options;
        const configuredModel = String(node.config?.model || '');
        const separatorIndex = configuredModel.indexOf('::');
        const selectedProviderId = separatorIndex >= 0
          ? configuredModel.slice(0, separatorIndex)
          : String(node.config?.providerId || '');
        const selectedModelId = separatorIndex >= 0
          ? configuredModel.slice(separatorIndex + 2)
          : configuredModel;
        const selectedDescriptor = modelCatalogIndex.get(taskModelKey(selectedProviderId, selectedModelId));
        if (selectedDescriptor && field.key === 'quality') {
          dynamicOptions = selectedDescriptor.qualityOptions.map(value => ({ value, label: value }));
        }
        if (selectedDescriptor && field.key === 'resolution') {
          dynamicOptions = selectedDescriptor.allowedSizes.map(value => ({ value, label: value }));
        }
        if (selectedDescriptor && field.key === 'aspectRatio') {
          dynamicOptions = selectedDescriptor.allowedRatios.map(value => ({ value, label: value }));
        }
        if (selectedDescriptor && (field.key === 'duration' || field.key === 'durationSeconds')) {
          dynamicOptions = (selectedDescriptor.allowedDurationsSeconds || []).map(value => ({
            value: String(value),
            label: `${value} 秒`,
          }));
        }
        return (
          <select
            id={controlId(field.key, fieldIndex)}
            value={String(externalValue)}
            onChange={e => onUpdate(node.id, { config: { [field.key]: e.target.value } })}
            className="min-h-11 w-full bg-muted border border-border rounded px-3 py-2 text-base text-foreground focus:outline-none focus:border-primary/50"
          >
            {dynamicOptions?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        );
      }

      case 'slider': {
        const numericValue = Number(externalValue);
        const numVal = externalValue === '' || Number.isNaN(numericValue) ? Number(field.defaultValue) || 0 : numericValue;
        return (
          <div className="flex items-center gap-2">
            <input
              id={controlId(field.key, fieldIndex)}
              type="range"
              value={numVal}
              onChange={e => onUpdate(node.id, { config: { [field.key]: Number(e.target.value) } })}
              min={field.min || 0}
              max={field.max || 100}
              step={field.step || 1}
              className="flex-1 h-1 accent-primary"
            />
            <span className="text-xs text-muted-foreground w-8 text-right">{numVal}</span>
          </div>
        );
      }

      case 'toggle': {
        const boolVal = Boolean(externalValue) || externalValue === 'true';
        return (
          <button
            onClick={() => onUpdate(node.id, { config: { [field.key]: !boolVal } })}
            id={controlId(field.key, fieldIndex)}
            type="button"
            role="switch"
            aria-labelledby={fieldLabelId(field.key, fieldIndex)}
            aria-checked={boolVal}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className={`relative block h-5 w-9 rounded-full transition-colors ${boolVal ? 'bg-primary' : 'bg-muted'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${boolVal ? 'translate-x-4' : ''}`} />
            </span>
          </button>
        );
      }

      case 'model-select': {
        if (node.type === 'ai-sketch-to-image' && (field.key === 'visionModel' || field.key === 'imageModel')) {
          const visionRole = field.key === 'visionModel', providerKey = visionRole ? 'visionProviderId' : 'imageProviderId';
          let eligible: TaskModelDescriptor[] = [];
          try { eligible = visionRole ? sketchModels([...modelCatalogIndex.values()]) : sketchImageModels([...modelCatalogIndex.values()]); } catch { /* Invalid catalog stays unavailable. */ }
          const configured = typeof externalValue === 'string' ? externalValue : '', providerId = node.config[providerKey];
          const split = configured.indexOf('::'), modelId = split < 0 ? configured : configured.slice(split + 2);
          const exact = typeof providerId === 'string' && providerId && (split < 0 || configured.slice(0, split) === providerId) ? `${providerId}::${modelId}` : '';
          const label = visionRole ? '草图生图视觉模型' : '草图生图图像模型';
          const empty = visionRole ? '暂无可用的同步视觉聊天模型，请检查模型授权与视觉能力。' : '暂无支持参考图的图像模型，请检查模型授权与参考图能力。';
          return <div className="min-w-0 space-y-1">
            <select id={controlId(field.key, fieldIndex)} aria-label={label} value={eligible.some(model => `${model.providerId}::${model.modelId}` === exact) ? exact : ''}
              disabled={modelsLoading || !eligible.length} onChange={event => {
                const selected = eligible.find(model => `${model.providerId}::${model.modelId}` === event.target.value);
                onUpdate(node.id, { config: { [field.key]: selected ? event.target.value : '', [providerKey]: selected?.providerId || '' } });
              }} className="w-full min-w-0 bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50">
              <option value="">{modelsLoading ? '模型目录暂不可用' : visionRole ? '选择同步视觉聊天模型' : '选择参考图生成模型'}</option>
              {eligible.map(model => <option key={`${model.providerId}::${model.modelId}`} value={`${model.providerId}::${model.modelId}`}>{model.modelId} ({model.providerId})</option>)}
            </select>
            {!modelsLoading && !eligible.length && <p className="text-xs text-muted-foreground break-words">{empty}</p>}
          </div>;
        }
        if (node.type === 'ai-sketch-to-code') {
          const eligible = sketchModels([...modelCatalogIndex.values()]);
          const configured = String(externalValue || '');
          const exact = configured.includes('::') ? configured : `${String(node.config.providerId || '')}::${configured}`;
          return <select id={controlId(field.key, fieldIndex)} aria-label="草图视觉模型" value={eligible.some(m => `${m.providerId}::${m.modelId}` === exact) ? exact : ''} disabled={modelsLoading}
            onChange={event => { const model = eligible.find(m => `${m.providerId}::${m.modelId}` === event.target.value); if (model) onUpdate(node.id, { config: { model: event.target.value, providerId: model.providerId } }); }}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50">
            <option value="">{modelsLoading ? '模型目录暂不可用' : '选择同步视觉聊天模型'}</option>
            {eligible.map(model => <option key={`${model.providerId}::${model.modelId}`} value={`${model.providerId}::${model.modelId}`}>{model.modelId} ({model.providerId})</option>)}
          </select>;
        }
        const modelFilterType = field.modelFilter || 'image'; // 默认只显示图像模型
        // 支持复合键 providerId::modelId 和纯 modelId
        const currentModelId = String(externalValue || '');
        const cfgProviderId = node.config?.providerId as string | undefined;
        const persistedKey = currentModelId && cfgProviderId && !parseExactModelKey(currentModelId)
          ? `${cfgProviderId}::${currentModelId}`
          : currentModelId;
        const currentCompositeValue = resolvePersistedModelSelection(
          persistedKey,
          models.filter(m => m.type === modelFilterType && m.providerId)
            .map(m => ({ id: m.id, providerId: m.providerId! })),
        ).compositeKey || '';
        return (
          <select
            id={controlId(field.key, fieldIndex)}
            value={currentCompositeValue}
            onChange={e => {
              const selectedValue = e.target.value;
              // 解析复合键: providerId::modelId
              const sepIdx = selectedValue.indexOf('::');
              const selectedModelId = sepIdx >= 0 ? selectedValue.slice(sepIdx + 2) : selectedValue;
              const selectedProviderId = sepIdx >= 0 ? selectedValue.slice(0, sepIdx) : '';
              const configUpdate: Record<string, string | number> = {};
              configUpdate[field.key] = selectedValue;
              // 保存providerId到节点config
              if (selectedProviderId) {
                configUpdate.providerId = selectedProviderId;
              }
              // 只在旧值不受新模型支持时归一化，保留仍然合法的用户选择。
              if (selectedModelId) {
                const selectedDescriptor = modelCatalogIndex.get(taskModelKey(selectedProviderId, selectedModelId));
                if (selectedDescriptor) {
                  if (
                    selectedDescriptor.qualityOptions.length > 0
                    && !selectedDescriptor.qualityOptions.includes(String(node.config?.quality || ''))
                  ) {
                    configUpdate.quality = selectedDescriptor.qualityOptions[0];
                  }
                  if (
                    selectedDescriptor.allowedSizes.length > 0
                    && !selectedDescriptor.allowedSizes.includes(String(node.config?.resolution || ''))
                  ) {
                    configUpdate.resolution = selectedDescriptor.allowedSizes[0];
                  }
                  if (
                    selectedDescriptor.allowedRatios.length > 0
                    && !selectedDescriptor.allowedRatios.includes(String(node.config?.aspectRatio || ''))
                  ) {
                    configUpdate.aspectRatio = selectedDescriptor.allowedRatios[0];
                  }
                  const durations = selectedDescriptor.allowedDurationsSeconds || [];
                  if (
                    durations.length > 0
                    && !durations.includes(Number(node.config?.duration ?? node.config?.durationSeconds))
                  ) {
                    configUpdate.duration = durations[0];
                  }
                  const currentCount = Number(node.config?.count ?? node.config?.n ?? 1);
                  if (currentCount > selectedDescriptor.maxOutputs) {
                    configUpdate.count = selectedDescriptor.maxOutputs;
                  }
                }
              }
              onUpdate(node.id, { config: configUpdate });
            }}
            disabled={modelsLoading}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50"
          >
            <option value="">{modelsLoading ? '加载中...' : '选择模型'}</option>
            {models.filter(m => m.type === modelFilterType).map(m => {
              const compositeValue = m.providerId ? `${m.providerId}::${m.id}` : m.id;
              return (
                <option key={compositeValue} value={compositeValue}>{m.apiDisplayName || m.name || getModelDisplayName(m.id)} ({m.provider})</option>
              );
            })}
          </select>
        );
      }

      case 'image-upload':
        if (node.type === 'input-image' && node.config.source === 'upstream') {
          return <p className="text-xs leading-relaxed text-muted-foreground">使用上游图片，请连接图片输入端口。</p>;
        }
        return (
          <div className="space-y-2">
            {node.config?.imageUrl ? (
              <div className="relative group">
                <NextImage unoptimized width={1} height={1} src={String(node.config.imageUrl)} alt="预览" className="w-full h-24 object-cover rounded border border-border" />
                <button onClick={() => onUpdate(node.id, { config: { [field.key]: '' } })} className="absolute top-1 right-1 p-0.5 bg-black/70 rounded text-muted-foreground hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                  <X size={10} />
                </button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  aria-label="上传图片"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 h-16 border-2 border-dashed border-border rounded flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors text-muted-foreground hover:text-muted-foreground"
                >
                  <Upload size={14} />
                  <span className="text-[10px] mt-0.5">上传</span>
                </button>
                {canvasImages && canvasImages.length > 0 && (
                  <div className="relative flex-1 group/canvas">
                    <button
                      type="button"
                      aria-label="从画布选择图片"
                      className="w-full h-16 border-2 border-dashed border-border rounded flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors text-muted-foreground hover:text-muted-foreground"
                      onClick={(e) => {
                        const dropdown = (e.currentTarget.nextElementSibling as HTMLElement);
                        if (dropdown) dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
                      }}
                    >
                      <ImageIcon size={14} />
                      <span className="text-[10px] mt-0.5">画布</span>
                    </button>
                    <div style={{ display: 'none' }} className="absolute right-0 top-full mt-1 w-64 max-h-40 overflow-y-auto bg-muted border border-border rounded shadow-lg z-50">
                      {canvasImages.map((img, idx) => (
                        <button
                          key={img.id}
                          className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-primary/10 hover:text-primary cursor-pointer truncate transition-colors"
                          onClick={() => {
                            void onCanvasImageSelect(node.id, img);
                            const dropdown = document.querySelector('.group\\/canvas > div:last-child') as HTMLElement;
                            if (dropdown) dropdown.style.display = 'none';
                          }}
                          title={img.description}
                        >
                          {idx + 1}. {img.description?.slice(0, 25) || '图片 ' + (idx + 1)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => {
              const file = e.target.files?.[0];
              if (file) onImageUpload(node.id, file);
            }} />
            <input
              id={controlId(field.key, fieldIndex)}
              type="text"
              value={String(externalValue || '')}
              onChange={e => onUpdate(node.id, { config: { [field.key]: e.target.value } })}
              placeholder="或输入图片URL"
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
        );

      default:
        return (
          <input
            id={controlId(field.key, fieldIndex)}
            type="text"
            value={String(externalValue)}
            onChange={e => onUpdate(node.id, { config: { [field.key]: e.target.value } })}
            placeholder={field.placeholder}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        );
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 节点类型标识 — 与原型对齐: 彩色圆点 + 类型名 + 描述 */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-semibold text-foreground">{NODE_TYPE_LABELS[node.type]}</span>
          {isCanvasFeature && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium ml-auto">画布专用</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{NODE_CATEGORY_LABELS[cat]}</span>
      </div>

      <WorkspaceSourceTraceDetails sourceTrace={node.config.sourceTrace} />

      {(node.type === 'ai-sketch-to-image' || parseWorkflowSketchImageReference(execResult?.output?.sketchImageReference)) && <WorkflowSketchImageControls
        key={node.id} scope={sketchScope} reference={parseWorkflowSketchImageReference(execResult?.output?.sketchImageReference)}
        status={execResult?.status || 'idle'} error={execResult?.error} phase={execResult?.output?.phase} progress={execResult?.output?.progress}
        reserveCredits={execResult?.output?.reserveCredits} actualCredits={execResult?.output?.actualCredits} refunded={execResult?.output?.refunded}
        needsReconcile={execResult?.output?.needsReconcile || execResult?.output?.dispatchPending || execResult?.output?.recoveryPending} insert={onSketchInsert} />}
      {(node.type === 'ai-sketch-to-code' || parseWorkflowSketchDocumentReference(execResult?.output?.documentReference)) && <WorkflowSketchDocumentControls scope={sketchScope}
        reference={parseWorkflowSketchDocumentReference(execResult?.output?.documentReference)} status={execResult?.status || 'idle'} error={execResult?.error}
        phase={execResult?.output?.phase} progress={execResult?.output?.progress} insert={onSketchInsert} />}
      {node.type === 'ai-skill' && (
        <div className="space-y-4 px-4 py-2">
          <div>
            <label htmlFor={`workflow-skill-${node.id}`} className="block text-xs font-medium text-muted-foreground mb-1.5">Skill</label>
            <select
              id={`workflow-skill-${node.id}`}
              aria-label="Skill"
              value={selectedSkill?.id || ''}
              disabled={workflowSkillsLoading}
              onChange={event => {
                const skill = workflowSkills.find(item => item.id === event.target.value);
                const configuredNode = configureWorkflowSkillNodePorts(node, skill);
                onUpdate(node.id, { ports: configuredNode.ports, config: {
                  skillId: skill?.id,
                  version: skill?.version,
                  inputValues: {},
                  modelBindings: {},
                  runId: undefined,
                } });
              }}
              className="min-h-11 w-full bg-muted border border-border rounded px-3 py-2 text-base text-foreground focus:outline-none focus:border-primary/50"
            >
              <option value="">{workflowSkillsLoading ? '加载中...' : '选择 Skill'}</option>
              {workflowSkills.map(skill => <option key={`${skill.id}:${skill.version}`} data-workflow-skill-id={skill.id} value={skill.id}>{skill.name}</option>)}
            </select>
            {workflowSkillsError && <p role="alert" className="mt-1 text-xs text-destructive">{workflowSkillsError}</p>}
          </div>
          {selectedSkill && (
            <>
              <SkillInputFields
                fields={selectedSkill.inputs}
                values={displayedSkillInputs}
                capabilityDescriptors={{
                  video: modelCatalogIndex.get(taskModelKey(
                    configuredSkillBindings.video?.providerId ?? '',
                    configuredSkillBindings.video?.modelId ?? '',
                  )),
                }}
                onChange={(key, value) => onUpdate(node.id, { config: {
                  inputValues: { ...configuredSkillInputs, [key]: value },
                } })}
              />
              {skillModelRoles.map(role => {
                const options = modelsForSkillRole(role).filter(model => model.providerId);
                const binding = configuredSkillBindings[role];
                const value = binding?.providerId && binding.modelId ? `${binding.providerId}::${binding.modelId}` : '';
                return (
                  <div key={role}>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">{role} 模型</label>
                    <select
                      aria-label={`${role} 模型`}
                      value={value}
                      disabled={modelsLoading}
                      onChange={event => {
                        const exact = parseExactModelKey(event.target.value);
                        onUpdate(node.id, { config: {
                          modelBindings: updateWorkflowSkillModelBinding(
                            configuredSkillBindings,
                            role,
                            exact ? { providerId: exact.providerId, modelId: exact.modelId } : null,
                          ),
                        } });
                      }}
                      className="min-h-11 w-full bg-muted border border-border rounded px-3 py-2 text-base text-foreground focus:outline-none focus:border-primary/50"
                    >
                      <option value="">选择模型</option>
                      {options.map(model => (
                        <option key={`${model.providerId}::${model.id}`} value={`${model.providerId}::${model.id}`}>
                          {model.apiDisplayName || model.name} ({model.provider})
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              {selectedSkill.id === BRIEF_TO_VIDEO_SKILL_ID
                && projectId
                && execResult?.status === 'waiting-approval'
                && typeof execResult.output?.runId === 'string'
                && (
                  <BriefToVideoApprovalCard
                    runId={execResult.output.runId}
                    projectId={projectId!}
                    onApprove={identity => onSkillApproval(
                      node.id, String(execResult.output?.runId), 'approve', identity,
                    )}
                    onRevise={(identity, revisionInstruction) => onSkillApproval(
                      node.id, String(execResult.output?.runId), 'revise', identity, revisionInstruction,
                    )}
                    onCancel={() => onSkillApproval(
                      node.id, String(execResult.output?.runId), 'cancel',
                    )}
                  />
                )}
            </>
          )}
        </div>
      )}

      {/* 属性字段 — 与原型对齐: 逐字段垂直排列, px-4 py-2 间距 */}
      {fields.map((field, fieldIndex) => (
        <div key={controlId(field.key, fieldIndex)} data-node-field={field.key} className="min-w-0 px-4 py-2 [&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11 [&_input]:min-w-0 [&_input]:text-base [&_textarea]:text-base [&_select]:min-h-11 [&_select]:text-base">
          <label id={fieldLabelId(field.key, fieldIndex)} htmlFor={field.key === 'aspectRatio' || (field.key === 'quality' && field.type === 'select') ? undefined : controlId(field.key, fieldIndex)} className="block text-xs font-medium text-muted-foreground mb-1.5">{field.label}</label>
          {field.key === 'aspectRatio' ? (
            /* 比例选择器 — 与原型对齐: 4列grid + ratio-btn样式 */
            <div role="group" aria-labelledby={fieldLabelId(field.key, fieldIndex)} className="grid grid-cols-4 gap-2">
              {(configuredDescriptor?.allowedRatios.map(value => ({ value, label: value })) || field.options || []).map(opt => {
                const isActive = String(node.config?.aspectRatio ?? field.defaultValue ?? '1:1') === opt.value;
                const ratioMap: Record<string, { w: number; h: number }> = { '1:1': { w: 20, h: 20 }, '4:3': { w: 24, h: 18 }, '16:9': { w: 28, h: 16 }, '9:16': { w: 14, h: 24 }, '3:4': { w: 18, h: 24 }, '3:2': { w: 24, h: 16 }, '2:3': { w: 16, h: 24 } };
                const dim = ratioMap[opt.value] || { w: 20, h: 20 };
                return (
                  <button key={opt.value} className={`ratio-btn ${isActive ? 'active' : ''}`} aria-pressed={isActive} onClick={() => onUpdate(node.id, { config: { aspectRatio: opt.value } })}>
                    <div className="ratio-preview" style={{ width: dim.w, height: dim.h }} />
                    <span className="text-[10px] text-muted-foreground">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          ) : field.key === 'quality' && field.type === 'select' ? (
            /* 质量选择器 — 与原型对齐: 3按钮横排 */
            <div role="group" aria-labelledby={fieldLabelId(field.key, fieldIndex)} className="grid grid-cols-2 gap-2">
              {(configuredDescriptor?.qualityOptions.map(value => ({ value, label: value })) || field.options || []).map(opt => {
                const isActive = String(node.config?.quality ?? field.defaultValue ?? 'hd') === opt.value;
                return (
                  <button key={opt.value} className={`quality-btn min-w-0 px-2 ${isActive ? 'active' : ''}`} aria-pressed={isActive} onClick={() => onUpdate(node.id, { config: { quality: opt.value } })}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : field.key === 'seed' ? (
            /* 种子输入 — 与原型对齐: 输入框 + 随机按钮 */
            <div className="flex gap-2">
              <input
                id={controlId(field.key, fieldIndex)}
                type="text"
                value={String(node.config?.seed ?? field.defaultValue ?? '')}
                onChange={e => onUpdate(node.id, { config: { seed: e.target.value } })}
                placeholder={field.placeholder}
                className="flex-1 bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={() => onUpdate(node.id, { config: { seed: Math.floor(Math.random() * 99999999).toString() } })}
                className="px-2 py-1.5 rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                title="随机种子"
              >
                <Shuffle size={16} />
              </button>
            </div>
          ) : field.key === 'cfg' || field.key === 'guidanceScale' ? (
            /* CFG/引导系数 — 与原型对齐: 滑块 + 数值显示 */
            <div className="flex items-center gap-3">
              <input
                id={controlId(field.key, fieldIndex)}
                type="range"
                min={Number(field.min) || 1}
                max={Number(field.max) || 20}
                step={Number(field.step) || 0.5}
                value={Number(node.config?.[field.key] ?? field.defaultValue ?? 7)}
                onChange={e => onUpdate(node.id, { config: { [field.key]: Number(e.target.value) } })}
                className="flex-1 accent-primary"
              />
              <span className="text-xs font-mono text-foreground w-8 text-right">{Number(node.config?.[field.key] ?? field.defaultValue ?? 7)}</span>
            </div>
          ) : (
            renderField(field, fieldIndex)
          )}
        </div>
      ))}

      {/* 端口信息 */}
      <div className="px-4 py-2 border-t border-border/10 mt-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">端口</div>
        <div className="space-y-1">
          {node.ports.filter(p => p.direction === 'in').map(p => (
            <div key={p.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PORT_COLORS[p.type] }} />
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground">{p.label}</span>
              <span className="text-muted-foreground/50 ml-auto">{p.type}</span>
            </div>
          ))}
          {node.ports.filter(p => p.direction === 'out').map(p => (
            <div key={p.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PORT_COLORS[p.type] }} />
              <span className="text-muted-foreground">{p.label}</span>
              <span className="text-muted-foreground/50 ml-auto">{p.type} →</span>
            </div>
          ))}
        </div>
      </div>

      {/* 删除按钮 — 与原型对齐 */}
      <div className="px-4 py-3">
        <button
          onClick={() => onDelete(node.id)}
          className="min-h-11 w-full py-2 rounded-md text-sm text-red-300 [.node-editor-root[data-theme=monochrome]_&]:text-red-800 hover:bg-red-900/20 transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-dashed border-red-400/20"
        >
          <Trash2 size={12} /> 删除节点
        </button>
      </div>
    </div>
  );
}
