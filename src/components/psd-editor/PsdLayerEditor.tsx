'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Layers3, Play, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { buildSceneFromEditableLayerAssets, downloadEditedPSD } from '@/lib/psd-export';
import type { DesignLayer, PSDExportMode, SceneBuildResult } from '@/lib/psd-export';
import {
  cancelLayerDecomposition,
  createLayerIdempotencyKey,
  getLayerPhasePresentation,
  LayerClientError,
  runLayerDecomposition,
} from '@/lib/layer-decomposition-client';
import type { LayerDecompositionResult, LayerEngineMode, LayerTaskPhase } from '@/lib/layer-decomposition/types';
import {
  createLayerDocument,
  layerDocumentContentFromDesignLayers,
  layerDocumentScene,
  LayerDocumentClientError,
  loadLayerDocument,
  saveLayerDocument,
} from '@/lib/layer-documents/client';
import type {
  LayerDocumentContent,
  LayerDocumentRecord,
  LayerDocumentSource,
} from '@/lib/layer-documents/types';
import { PsdCanvas } from './PsdCanvas';
import { LayerPanel } from './LayerPanel';
import { LayerInspector } from './LayerInspector';
import { ExportToolbar } from './ExportToolbar';

interface PsdLayerEditorProps {
  imageUrl: string;
  source?: LayerDocumentSource;
  prompt?: string;
  mode?: 'basic' | 'standard' | 'advanced' | 'studio';
  providerId?: string;
  modelId?: string;
  initialResult?: LayerDecompositionResult;
  onClose: () => void;
  registerCloseGuard?: (guard: (() => Promise<boolean>) | null) => void;
}

type EditorStage = 'choosing' | 'loading' | 'cancelling' | 'editing' | 'exporting' | 'done' | 'error';
type LayerErrorAction = 'layering' | 'cancelling' | 'terminal';
type LayerDocumentStatus = 'temporary' | 'loading' | 'creating' | 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

interface LayerAttemptSnapshot {
  imageUrl: string;
  engine: LayerEngineMode;
  providerId?: string;
  modelId?: string;
  idempotencyKey: string;
  defaultTargetResolution: 'unresolved' | 'resolved' | 'none';
}

const DETACHED_CANCEL_ATTEMPTS = 3;
const LAYER_DOCUMENT_SAVE_DELAY_MS = 800;

const LAYER_DOCUMENT_STATUS_LABELS: Record<LayerDocumentStatus, string> = {
  temporary: '未保存到项目',
  loading: '正在恢复',
  creating: '正在创建',
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中',
  error: '保存失败',
  conflict: '保存冲突',
};

function isUncertainLayerResponse(error: unknown): boolean {
  if (!(error instanceof LayerClientError)) return true;
  if (error.status === undefined || error.retryable) return true;
  return error.status !== 400 && error.status !== 422;
}

async function cancelLayerTaskAfterUnmount(taskId: string): Promise<boolean> {
  for (let attempt = 0; attempt < DETACHED_CANCEL_ATTEMPTS; attempt += 1) {
    try {
      const task = await cancelLayerDecomposition(taskId, { keepalive: true });
      if (['cancelled', 'completed', 'failed', 'timeout'].includes(task.status)) return true;
    } catch {
      // A later attempt may recover a transient transport failure.
    }
  }
  return false;
}

async function recoverLayerCancellationAfterUnmount(
  snapshot: LayerAttemptSnapshot,
): Promise<void> {
  for (let attempt = 0; attempt < DETACHED_CANCEL_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    let taskRegistered = false;
    try {
      await runLayerDecomposition({
        ...snapshot,
        keepalive: true,
        skipDefaultTargetResolution: snapshot.defaultTargetResolution === 'none',
        signal: controller.signal,
        onTaskId: async (taskId) => {
          taskRegistered = true;
          if (await cancelLayerTaskAfterUnmount(taskId)) {
            controller.abort(new Error('图片分层任务已在卸载后终结'));
          }
        },
      });
      return;
    } catch (error) {
      if (taskRegistered || controller.signal.aborted || !isUncertainLayerResponse(error)) return;
    }
  }
}

export function layerEditorPhaseLabel(phase?: LayerTaskPhase): string {
  return getLayerPhasePresentation(phase).label;
}

interface LayerModeControlProps {
  value: LayerEngineMode;
  disabled: boolean;
  onChange: (value: LayerEngineMode) => void;
}

const LAYER_MODES: Array<{ value: LayerEngineMode; label: string }> = [
  { value: 'smart', label: '智能' },
  { value: 'cloud', label: '云端' },
  { value: 'local', label: '本地' },
];

export function LayerModeControl({ value, disabled, onChange }: LayerModeControlProps) {
  return (
    <div className="inline-flex h-8 items-center rounded-lg bg-neutral-950 p-0.5" role="group" aria-label="图片分层引擎">
      {LAYER_MODES.map((item) => (
        <button
          key={item.value}
          type="button"
          data-layer-engine={item.value}
          aria-pressed={value === item.value}
          disabled={disabled}
          onClick={() => onChange(item.value)}
          className={`h-7 min-w-14 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50 ${
            value === item.value
              ? 'bg-amber-500 text-neutral-950'
              : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function initialExportMode(mode: PsdLayerEditorProps['mode']): PSDExportMode {
  if (mode === 'basic') return 'basic';
  if (mode === 'studio') return 'studio';
  return 'pro';
}

export default function PsdLayerEditor({
  imageUrl,
  source,
  prompt = '图片',
  mode = 'standard',
  providerId,
  modelId,
  initialResult,
  onClose,
  registerCloseGuard,
}: PsdLayerEditorProps) {
  const [stage, setStage] = useState<EditorStage>(initialResult ? 'editing' : 'choosing');
  const [layerEngine, setLayerEngine] = useState<LayerEngineMode>(() => {
    if (typeof window === 'undefined') return 'smart';
    const stored = window.localStorage.getItem('wujie-layer-engine');
    return stored === 'smart' || stored === 'cloud' || stored === 'local'
      ? stored
      : 'smart';
  });
  const [sceneResult, setSceneResult] = useState<SceneBuildResult | null>(null);
  const [layers, setLayers] = useState<DesignLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState<PSDExportMode>(() => initialExportMode(mode));
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [errorAction, setErrorAction] = useState<LayerErrorAction>('layering');
  const [qualityWarnings, setQualityWarnings] = useState<string[]>([]);
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [documentStatus, setDocumentStatus] = useState<LayerDocumentStatus>(source ? 'loading' : 'temporary');
  const [documentError, setDocumentError] = useState('');
  const [conflictDocument, setConflictDocument] = useState<LayerDocumentRecord | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const taskControllerRef = useRef<AbortController | null>(null);
  const layeringInFlightRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const cancelIntentRef = useRef(false);
  const closeAfterCancelRef = useRef(false);
  const cancelPromiseRef = useRef<Promise<void> | null>(null);
  const attemptSnapshotRef = useRef<LayerAttemptSnapshot | null>(null);
  const mountedRef = useRef(true);
  const documentRef = useRef<LayerDocumentRecord | null>(null);
  const layersRef = useRef<DesignLayer[]>([]);
  const sceneResultRef = useRef<SceneBuildResult | null>(null);
  const exportModeRef = useRef<PSDExportMode>(initialExportMode(mode));
  const dirtyRef = useRef(false);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistenceAbortRef = useRef<AbortController | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);
  const sourceRef = useRef<LayerDocumentSource | undefined>(source);
  const sourceEpochRef = useRef(0);
  const editGenerationRef = useRef(0);
  const pendingCreateTaskIdRef = useRef<string | null>(null);
  const conflictActiveRef = useRef(false);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  const startDetachedCancellation = useCallback((taskId: string): Promise<void> => {
    if (cancelPromiseRef.current) return cancelPromiseRef.current;
    const promise = cancelLayerTaskAfterUnmount(taskId)
      .then((cancelled) => {
        if (cancelled) {
          taskControllerRef.current?.abort(new Error('图片分层任务已在卸载后终结'));
        }
      })
      .finally(() => {
        if (cancelPromiseRef.current === promise) cancelPromiseRef.current = null;
      });
    cancelPromiseRef.current = promise;
    return promise;
  }, []);

  const applyScene = useCallback((scene: SceneBuildResult, nextExportMode?: PSDExportMode) => {
    const editableLayers = scene.layers.map((layer) => ({
      ...layer,
      offsetX: layer.offsetX ?? 0,
      offsetY: layer.offsetY ?? 0,
    }));
    sceneResultRef.current = scene;
    layersRef.current = editableLayers;
    setSceneResult(scene);
    setLayers(editableLayers);
    if (nextExportMode) {
      exportModeRef.current = nextExportMode;
      setExportMode(nextExportMode);
    }
    setSelectedLayerId(
      editableLayers.find((layer) => layer.visible)?.id
      ?? editableLayers[0]?.id
      ?? null,
    );
    setStage('editing');
  }, []);

  const applyLayerResult = useCallback((result: LayerDecompositionResult): SceneBuildResult => {
    const scene = buildSceneFromEditableLayerAssets(result);
    applyScene(scene);
    setQualityWarnings(result.quality.warnings);
    return scene;
  }, [applyScene]);

  const documentContent = useCallback((): LayerDocumentContent | null => {
    const scene = sceneResultRef.current;
    if (!scene || layersRef.current.length === 0) return null;
    return layerDocumentContentFromDesignLayers(
      layersRef.current,
      scene.width,
      scene.height,
      promptRef.current,
      exportModeRef.current,
    );
  }, []);

  const flushLayerDocument = useCallback(async (keepalive = false): Promise<boolean> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const sourceEpoch = sourceEpochRef.current;
    const activeSource = sourceRef.current;
    if (!activeSource || !dirtyRef.current) return true;
    if (conflictActiveRef.current) return false;
    if (savePromiseRef.current) {
      const saved = await savePromiseRef.current;
      if (!saved || sourceEpoch !== sourceEpochRef.current) return false;
      return dirtyRef.current ? flushLayerDocument(keepalive) : true;
    }

    const currentDocument = documentRef.current;
    const pendingTaskId = pendingCreateTaskIdRef.current;
    const content = documentContent();
    if ((!currentDocument && !pendingTaskId) || !content) return false;

    const editGeneration = editGenerationRef.current;
    const controller = new AbortController();
    saveAbortRef.current = controller;

    if (mountedRef.current) {
      setDocumentStatus(currentDocument ? 'saving' : 'creating');
      setDocumentError('');
    }
    const request = currentDocument
      ? saveLayerDocument(currentDocument, content, { keepalive: true, signal: controller.signal })
      : createLayerDocument(activeSource, pendingTaskId!, content, {
        keepalive: true,
        signal: controller.signal,
      });
    const savePromise = request
      .then((saved) => {
        if (sourceEpoch !== sourceEpochRef.current) return false;
        documentRef.current = saved;
        pendingCreateTaskIdRef.current = null;
        if (editGenerationRef.current === editGeneration) {
          if (!currentDocument) {
            applyScene(layerDocumentScene(saved.content), saved.content.exportMode);
          }
          dirtyRef.current = false;
          if (mountedRef.current) setDocumentStatus('saved');
        } else if (mountedRef.current) {
          setDocumentStatus('dirty');
        }
        return true;
      })
      .catch(async (error: unknown) => {
        if (sourceEpoch !== sourceEpochRef.current || controller.signal.aborted) return false;
        if (
          error instanceof LayerDocumentClientError
          && error.status === 409
          && error.code === 'LAYER_DOCUMENT_REVISION_CONFLICT'
        ) {
          conflictActiveRef.current = true;
          let latest: LayerDocumentRecord | null = null;
          try {
            latest = await loadLayerDocument(activeSource, { signal: controller.signal });
          } catch {
            latest = null;
          }
          if (sourceEpoch !== sourceEpochRef.current || controller.signal.aborted) return false;
          if (mountedRef.current) {
            setConflictDocument(latest);
            setDocumentStatus('conflict');
            setDocumentError(latest
              ? '该图层文档已在其他窗口更新，请选择保留版本。'
              : '检测到版本冲突，但服务器版本加载失败，请重新加载。');
          }
          return false;
        }
        if (mountedRef.current) {
          setDocumentStatus('error');
          setDocumentError(error instanceof Error ? error.message : '保存图层文档失败');
        }
        return false;
      })
      .finally(() => {
        if (saveAbortRef.current === controller) saveAbortRef.current = null;
        if (savePromiseRef.current === savePromise) savePromiseRef.current = null;
      });
    savePromiseRef.current = savePromise;
    const saved = await savePromise;
    if (!saved || sourceEpoch !== sourceEpochRef.current) return false;
    return dirtyRef.current ? flushLayerDocument(keepalive) : true;
  }, [applyScene, documentContent]);

  const createDocumentFromScene = useCallback(async (
    taskId: string,
  ): Promise<LayerDocumentRecord | null> => {
    if (!sourceRef.current) return null;
    pendingCreateTaskIdRef.current = taskId;
    dirtyRef.current = true;
    editGenerationRef.current += 1;
    conflictActiveRef.current = false;
    setConflictDocument(null);
    setDocumentStatus('dirty');
    setDocumentError('');
    const saved = await flushLayerDocument();
    return saved ? documentRef.current : null;
  }, [flushLayerDocument]);

  const markDocumentDirty = useCallback(() => {
    if (!sourceRef.current) return;
    dirtyRef.current = true;
    editGenerationRef.current += 1;
    conflictActiveRef.current = false;
    setConflictDocument(null);
    setDocumentStatus('dirty');
    setDocumentError('');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushLayerDocument();
    }, LAYER_DOCUMENT_SAVE_DELAY_MS);
  }, [flushLayerDocument]);

  // Drag state for floating panel
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const canvasWidth = sceneResult?.width ?? 600;
  const canvasHeight = sceneResult?.height ?? 400;

  // Center the panel on mount
  useEffect(() => {
    const pw = Math.min(window.innerWidth * 0.85, 1200);
    const ph = Math.min(window.innerHeight * 0.85, 800);
    setPanelPos({
      x: (window.innerWidth - pw) / 2,
      y: (window.innerHeight - ph) / 2,
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (
      !layeringInFlightRef.current
      && !taskIdRef.current
      && !attemptSnapshotRef.current
    ) {
      cancelIntentRef.current = false;
      closeAfterCancelRef.current = false;
    }
    return () => {
      mountedRef.current = false;
      cancelIntentRef.current = true;
      const taskId = taskIdRef.current;
      if (taskId) {
        void startDetachedCancellation(taskId);
      } else if (!layeringInFlightRef.current) {
        taskControllerRef.current?.abort();
      }
    };
  }, [startDetachedCancellation]);

  useEffect(() => {
    window.localStorage.setItem('wujie-layer-engine', layerEngine);
  }, [layerEngine]);

  useEffect(() => {
    persistenceAbortRef.current?.abort();
    saveAbortRef.current?.abort();
    const controller = new AbortController();
    persistenceAbortRef.current = controller;
    sourceEpochRef.current += 1;
    const sourceEpoch = sourceEpochRef.current;
    sourceRef.current = source;
    saveAbortRef.current = null;
    savePromiseRef.current = null;
    documentRef.current = null;
    dirtyRef.current = false;
    editGenerationRef.current = 0;
    pendingCreateTaskIdRef.current = null;
    conflictActiveRef.current = false;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setConflictDocument(null);
    setDocumentError('');

    if (!source) {
      setDocumentStatus('temporary');
      if (initialResult) applyLayerResult(initialResult);
      return () => controller.abort();
    }

    setDocumentStatus('loading');
    void loadLayerDocument(source, { signal: controller.signal })
      .then(async (storedDocument) => {
        if (
          controller.signal.aborted
          || sourceEpoch !== sourceEpochRef.current
          || !mountedRef.current
        ) return;
        if (storedDocument) {
          documentRef.current = storedDocument;
          const restoredScene = layerDocumentScene(storedDocument.content);
          applyScene(restoredScene, storedDocument.content.exportMode);
          setQualityWarnings([]);
          setDocumentStatus('saved');
          return;
        }

        if (!initialResult) {
          setDocumentStatus('dirty');
          return;
        }
        applyLayerResult(initialResult);
        if (source.taskId) await createDocumentFromScene(source.taskId);
        else setDocumentStatus('dirty');
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted
          || sourceEpoch !== sourceEpochRef.current
          || !mountedRef.current
        ) return;
        if (initialResult) {
          applyLayerResult(initialResult);
          if (source.taskId) {
            pendingCreateTaskIdRef.current = source.taskId;
            dirtyRef.current = true;
            editGenerationRef.current += 1;
          }
        }
        setDocumentError(error instanceof Error ? error.message : '恢复图层文档失败');
        setDocumentStatus('error');
      });

    return () => controller.abort();
  }, [
    applyLayerResult,
    applyScene,
    createDocumentFromScene,
    initialResult,
    source,
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flushLayerDocument(true);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [flushLayerDocument]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const activeSource = sourceRef.current;
    const currentDocument = documentRef.current;
    const pendingTaskId = pendingCreateTaskIdRef.current;
    const content = documentContent();
    if (!activeSource || !content || !dirtyRef.current || savePromiseRef.current) return;
    if (currentDocument) {
      void saveLayerDocument(currentDocument, content, { keepalive: true }).catch((error: unknown) => {
        console.warn('[PsdLayerEditor] 卸载时保存图层文档失败', error);
      });
    } else if (pendingTaskId) {
      void createLayerDocument(activeSource, pendingTaskId, content, { keepalive: true }).catch((error: unknown) => {
        console.warn('[PsdLayerEditor] 卸载时创建图层文档失败', error);
      });
    }
  }, [documentContent]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !savePromiseRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragOffsetRef.current = { x: e.clientX - panelPos.x, y: e.clientY - panelPos.y };
  }, [panelPos]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPanelPos({ x: e.clientX - dragOffsetRef.current.x, y: e.clientY - dragOffsetRef.current.y });
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging]);

  const finishLayerCancellation = useCallback(() => {
    const shouldClose = closeAfterCancelRef.current;
    taskIdRef.current = null;
    idempotencyKeyRef.current = null;
    attemptSnapshotRef.current = null;
    cancelIntentRef.current = false;
    closeAfterCancelRef.current = false;
    cancelPromiseRef.current = null;
    if (!mountedRef.current) return;
    setProgress(0);
    setProgressMessage('');
    setErrorMessage('');
    if (shouldClose) {
      onClose();
      return;
    }
    setStage('choosing');
  }, [onClose]);

  const cancelRegisteredTask = useCallback((taskId: string): Promise<void> => {
    if (cancelPromiseRef.current) return cancelPromiseRef.current;

    const promise = cancelLayerDecomposition(taskId)
      .then((task) => {
        if (task.status !== 'cancelled') {
          if (['completed', 'failed', 'timeout'].includes(task.status)) {
            const shouldClose = closeAfterCancelRef.current;
            taskControllerRef.current?.abort(new Error('图片分层任务已进入终态'));
            taskIdRef.current = null;
            idempotencyKeyRef.current = null;
            attemptSnapshotRef.current = null;
            cancelIntentRef.current = false;
            closeAfterCancelRef.current = false;
            cancelPromiseRef.current = null;
            if (!mountedRef.current) return;
            if (shouldClose) {
              onClose();
              return;
            }
            setErrorAction('terminal');
            setErrorMessage(task.status === 'completed'
              ? '图片分层任务已完成，无法确认取消。'
              : `图片分层任务已${task.status === 'timeout' ? '超时' : '失败'}，无需再次取消。`);
            setStage('error');
            return;
          }
          throw new LayerClientError(
            'LAYER_CANCEL_NOT_CONFIRMED',
            `图片分层任务尚未确认取消（${task.status}），请重试。`,
            { retryable: true },
          );
        }
        taskControllerRef.current?.abort(new Error('用户取消图片分层'));
        finishLayerCancellation();
      })
      .catch((error: unknown) => {
        cancelPromiseRef.current = null;
        if (!mountedRef.current) return startDetachedCancellation(taskId);
        taskControllerRef.current?.abort(new Error('图片分层取消请求失败'));
        setErrorAction('cancelling');
        setErrorMessage(error instanceof Error ? error.message : '取消图片分层任务失败');
        setStage('error');
      });
    cancelPromiseRef.current = promise;
    return promise;
  }, [finishLayerCancellation, onClose, startDetachedCancellation]);

  const startLayering = useCallback(async (options: {
    cancellationRecovery?: boolean;
    idempotencyKey?: string;
  } = {}) => {
    if (layeringInFlightRef.current) return;
    const cancellationRecovery = options.cancellationRecovery === true;
    const snapshot: LayerAttemptSnapshot | null = cancellationRecovery
      ? attemptSnapshotRef.current
      : {
        imageUrl,
        engine: layerEngine,
        providerId,
        modelId,
        idempotencyKey: options.idempotencyKey || createLayerIdempotencyKey(),
        defaultTargetResolution: providerId && modelId
          ? 'resolved'
          : layerEngine === 'local' ? 'none' : 'unresolved',
      };
    if (!snapshot) {
      finishLayerCancellation();
      return;
    }
    layeringInFlightRef.current = true;
    taskControllerRef.current?.abort();
    const controller = new AbortController();
    taskControllerRef.current = controller;
    taskIdRef.current = null;
    cancelPromiseRef.current = null;

    if (!cancellationRecovery) {
      cancelIntentRef.current = false;
      closeAfterCancelRef.current = false;
    }
    attemptSnapshotRef.current = snapshot;
    idempotencyKeyRef.current = snapshot.idempotencyKey;

    setStage(cancellationRecovery ? 'cancelling' : 'loading');
    setProgress(0);
    setProgressMessage(cancellationRecovery ? '正在确认并取消图片分层任务' : '正在准备图片分层');
    setErrorMessage('');
    setErrorAction(cancellationRecovery ? 'cancelling' : 'layering');
    setQualityWarnings([]);
    try {
      const result = await runLayerDecomposition({
        ...snapshot,
        signal: controller.signal,
        skipDefaultTargetResolution: snapshot.defaultTargetResolution === 'none',
        onResolvedSubmissionTarget: (target) => {
          if (attemptSnapshotRef.current?.idempotencyKey === snapshot.idempotencyKey) {
            attemptSnapshotRef.current.providerId = target?.providerId;
            attemptSnapshotRef.current.modelId = target?.modelId;
            attemptSnapshotRef.current.defaultTargetResolution = target ? 'resolved' : 'none';
          }
        },
        onTaskId: async (taskId) => {
          taskIdRef.current = taskId;
          if (!cancelIntentRef.current) return;
          if (!mountedRef.current) {
            await startDetachedCancellation(taskId);
            return;
          }
          await cancelRegisteredTask(taskId);
        },
        onProgress: (_task, presentation) => {
          if (cancelIntentRef.current) return;
          setProgress(presentation.progress);
          setProgressMessage(presentation.label);
        },
      });
      if (controller.signal.aborted || cancelIntentRef.current) return;
      const completedTaskId = taskIdRef.current;
      taskIdRef.current = null;
      idempotencyKeyRef.current = null;
      attemptSnapshotRef.current = null;
      applyLayerResult(result);
      if (source && completedTaskId) {
        await createDocumentFromScene(completedTaskId);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (cancelIntentRef.current) {
        if (!mountedRef.current) {
          if (taskIdRef.current) {
            await startDetachedCancellation(taskIdRef.current);
          } else if (isUncertainLayerResponse(error)) {
            void recoverLayerCancellationAfterUnmount(snapshot);
          }
          return;
        }
        if (taskIdRef.current) {
          await cancelRegisteredTask(taskIdRef.current);
          return;
        }
        if (isUncertainLayerResponse(error)) {
          setErrorAction('cancelling');
          setErrorMessage('无法确认服务端分层任务状态，请重试取消。');
          setStage('error');
          return;
        }
        finishLayerCancellation();
        return;
      }
      taskIdRef.current = null;
      idempotencyKeyRef.current = null;
      attemptSnapshotRef.current = null;
      setErrorAction('layering');
      setErrorMessage(error instanceof Error ? error.message : '图像分层失败');
      setStage('error');
    } finally {
      layeringInFlightRef.current = false;
      if (taskControllerRef.current === controller) taskControllerRef.current = null;
    }
  }, [
    applyLayerResult,
    cancelRegisteredTask,
    finishLayerCancellation,
    imageUrl,
    layerEngine,
    modelId,
    providerId,
    createDocumentFromScene,
    source,
    startDetachedCancellation,
  ]);

  const handleCancelLayering = useCallback(async () => {
    cancelIntentRef.current = true;
    setStage('cancelling');
    setProgressMessage('正在取消图片分层任务');
    const taskId = taskIdRef.current;
    if (taskId) await cancelRegisteredTask(taskId);
  }, [cancelRegisteredTask]);

  const retryLayerAction = useCallback(() => {
    if (errorAction !== 'cancelling') {
      void startLayering();
      return;
    }
    const taskId = taskIdRef.current;
    if (taskId) {
      void handleCancelLayering();
      return;
    }
    const idempotencyKey = idempotencyKeyRef.current;
    if (!idempotencyKey) {
      finishLayerCancellation();
      return;
    }
    cancelIntentRef.current = true;
    void startLayering({ cancellationRecovery: true, idempotencyKey });
  }, [errorAction, finishLayerCancellation, handleCancelLayering, startLayering]);

  const requestClose = useCallback(async (): Promise<boolean> => {
    if (layeringInFlightRef.current || cancelIntentRef.current) {
      closeAfterCancelRef.current = true;
      cancelIntentRef.current = true;
      setStage('cancelling');
      const taskId = taskIdRef.current;
      if (taskId) {
        void cancelRegisteredTask(taskId);
        return false;
      }
      const idempotencyKey = idempotencyKeyRef.current;
      if (!layeringInFlightRef.current && idempotencyKey) {
        void startLayering({ cancellationRecovery: true, idempotencyKey });
      }
      return false;
    }
    taskControllerRef.current?.abort(new Error('图片分层窗口已关闭'));
    if (source && documentStatus === 'error' && dirtyRef.current) return false;
    if (!source || !dirtyRef.current) {
      onClose();
      return true;
    }
    const saved = await flushLayerDocument();
    if (saved && mountedRef.current) onClose();
    return saved;
  }, [cancelRegisteredTask, documentStatus, flushLayerDocument, onClose, source, startLayering]);

  const handleClose = useCallback(() => {
    void requestClose();
  }, [requestClose]);

  useEffect(() => {
    registerCloseGuard?.(requestClose);
    return () => registerCloseGuard?.(null);
  }, [registerCloseGuard, requestClose]);

  const handleLayerMove = useCallback((id: string, x: number, y: number) => {
    setLayers(prev => {
      const next = prev.map(layer => layer.id === id ? { ...layer, offsetX: x, offsetY: y } : layer);
      layersRef.current = next;
      return next;
    });
    markDocumentDirty();
  }, [markDocumentDirty]);

  const toggleVisibility = useCallback((id: string) => {
    setLayers(prev => {
      const next = prev.map(layer => layer.id === id ? { ...layer, visible: !layer.visible } : layer);
      layersRef.current = next;
      return next;
    });
    markDocumentDirty();
  }, [markDocumentDirty]);

  const toggleLock = useCallback((id: string) => {
    setLayers(prev => {
      const next = prev.map(layer => layer.id === id ? { ...layer, locked: !layer.locked } : layer);
      layersRef.current = next;
      return next;
    });
    markDocumentDirty();
  }, [markDocumentDirty]);

  const renameLayer = useCallback((id: string, newName: string) => {
    setLayers(prev => {
      const next = prev.map(layer => layer.id === id ? { ...layer, name: newName } : layer);
      layersRef.current = next;
      return next;
    });
    markDocumentDirty();
  }, [markDocumentDirty]);

  const reorderLayers = useCallback((fromIdx: number, toIdx: number) => {
    setLayers(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      layersRef.current = next;
      return next;
    });
    markDocumentDirty();
  }, [markDocumentDirty]);

  const handleExportModeChange = useCallback((nextMode: PSDExportMode) => {
    exportModeRef.current = nextMode;
    setExportMode(nextMode);
    markDocumentDirty();
  }, [markDocumentDirty]);

  const handleExport = useCallback(async () => {
    try {
      const saved = await flushLayerDocument();
      if (!saved) return;
      setStage('exporting');
      setProgress(15);
      setProgressMessage('正在写入当前编辑后的图层栈...');
      const finalScene = sceneResultRef.current;
      await downloadEditedPSD(
        layersRef.current,
        finalScene?.width ?? canvasWidth,
        finalScene?.height ?? canvasHeight,
        promptRef.current,
        exportModeRef.current,
      );
      setProgress(100);
      setProgressMessage('导出完成');
      setStage('done');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'PSD 导出失败');
      setStage('error');
    }
  }, [canvasWidth, canvasHeight, flushLayerDocument]);

  const applyServerDocument = useCallback(() => {
    if (!conflictDocument) return;
    documentRef.current = conflictDocument;
    dirtyRef.current = false;
    editGenerationRef.current += 1;
    conflictActiveRef.current = false;
    applyScene(layerDocumentScene(conflictDocument.content), conflictDocument.content.exportMode);
    setConflictDocument(null);
    setDocumentError('');
    setDocumentStatus('saved');
  }, [applyScene, conflictDocument]);

  const keepLocalDocument = useCallback(() => {
    const latestDocument = conflictDocument;
    if (!latestDocument || savePromiseRef.current) return;
    documentRef.current = latestDocument;
    dirtyRef.current = true;
    editGenerationRef.current += 1;
    conflictActiveRef.current = false;
    setConflictDocument(null);
    setDocumentError('');
    setDocumentStatus('dirty');
    void flushLayerDocument();
  }, [conflictDocument, flushLayerDocument]);

  const reloadConflictDocument = useCallback(async () => {
    const activeSource = sourceRef.current;
    if (!activeSource) return;
    const sourceEpoch = sourceEpochRef.current;
    setDocumentError('正在重新加载服务器版本...');
    try {
      const latest = await loadLayerDocument(activeSource);
      if (sourceEpoch !== sourceEpochRef.current || !mountedRef.current) return;
      if (!latest) throw new Error('服务器版本不存在，请刷新项目后重试');
      setConflictDocument(latest);
      setDocumentError('服务器版本已重新加载，请选择保留版本。');
      setDocumentStatus('conflict');
    } catch (error) {
      if (sourceEpoch !== sourceEpochRef.current || !mountedRef.current) return;
      setConflictDocument(null);
      setDocumentError(error instanceof Error ? error.message : '服务器版本加载失败，请重试');
      setDocumentStatus('conflict');
    }
  }, []);

  const selectedLayer = layers.find(layer => layer.id === selectedLayerId) || null;

  const panelWidth = 'min(85vw, 1200px)';
  const panelHeight = 'min(85vh, 800px)';

  return (
    <div
      data-testid="layer-editor"
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />

      {/* Floating panel */}
      <div
        className="absolute flex flex-col rounded-xl overflow-hidden shadow-2xl border border-neutral-700"
        style={{
          left: panelPos.x,
          top: panelPos.y,
          width: panelWidth,
          height: panelHeight,
          background: '#2a2a2a',
        }}
      >
        {/* Title bar - draggable */}
        <div
          className="flex items-center justify-between px-4 py-2.5 bg-neutral-800 border-b border-neutral-700 cursor-move select-none shrink-0"
          onMouseDown={handleTitleMouseDown}
        >
          <div className="flex items-center gap-3">
            <Layers3 className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <h2 className="text-sm font-medium text-white/90">PSD 分层编辑器</h2>
            {(stage === 'editing' || stage === 'exporting' || stage === 'done') && (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/60">
                <span data-testid="layer-count">
                {layers.length} 个图层
                </span>
              </span>
            )}
            <span
              data-testid="layer-document-status"
              className={`rounded-md px-2 py-0.5 text-xs ${
                documentStatus === 'conflict' || documentStatus === 'error'
                  ? 'bg-red-500/15 text-red-300'
                  : documentStatus === 'saved'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-white/10 text-white/60'
              }`}
              title={documentError || undefined}
            >
              {LAYER_DOCUMENT_STATUS_LABELS[documentStatus]}
            </span>
            {stage !== 'editing' && stage !== 'loading' && stage !== 'choosing' && (
              <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                {stage === 'exporting' ? '导出中...' : stage === 'done' ? '导出完成' : stage === 'cancelling' ? '取消中...' : stage === 'error' ? '错误' : ''}
              </span>
            )}
          </div>
          <LayerModeControl
            value={layerEngine}
            disabled={stage !== 'choosing' && stage !== 'error'}
            onChange={setLayerEngine}
          />
          <div className="flex items-center gap-1">
            {(stage === 'editing' || stage === 'exporting') && (
              <>
                <button
                  type="button"
                  onClick={() => setShowLayerPanel(!showLayerPanel)}
                  className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${showLayerPanel ? 'bg-amber-500/20 text-amber-400' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
                  title="图层面板"
                  aria-label="图层面板"
                >
                  <Layers3 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowInspector(!showInspector)}
                  className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${showInspector ? 'bg-amber-500/20 text-amber-400' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
                  title="属性面板"
                  aria-label="属性面板"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
                <div className="mx-1 h-4 w-px bg-white/10" />
              </>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              title="关闭 (Esc)"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {(stage === 'loading' || stage === 'cancelling' || stage === 'exporting') && (
          <div className="h-0.5 bg-neutral-800 shrink-0">
            <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* Main content area - three-column layout */}
        <div className="flex-1 flex min-h-0 relative">
          {documentStatus === 'error' && documentError && (
            <div
              data-testid="layer-document-save-error"
              className="absolute inset-x-0 top-0 z-30 flex items-center justify-center gap-3 border-b border-red-500/30 bg-neutral-950/95 px-4 py-3 text-xs text-red-200 shadow-lg"
              role="alert"
            >
              <span>{documentError}</span>
              {dirtyRef.current && (
                <button
                  type="button"
                  onClick={() => { void flushLayerDocument(); }}
                  className="h-8 rounded-md bg-red-400 px-3 font-medium text-neutral-950 hover:bg-red-300"
                >
                  重试保存
                </button>
              )}
            </div>
          )}
          {documentStatus === 'conflict' && (
            <div
              data-testid="layer-document-conflict"
              className="absolute inset-x-0 top-0 z-30 flex items-center justify-center gap-3 border-b border-red-500/30 bg-neutral-950/95 px-4 py-3 text-xs text-red-200 shadow-lg"
              role="alert"
            >
              <span>{documentError || '该图层文档已在其他窗口更新。'}</span>
              {conflictDocument ? (
                <>
                  <button
                    type="button"
                    onClick={applyServerDocument}
                    className="h-8 rounded-md bg-red-400 px-3 font-medium text-neutral-950 hover:bg-red-300"
                  >
                    使用服务器版本
                  </button>
                  <button
                    type="button"
                    onClick={keepLocalDocument}
                    className="h-8 rounded-md bg-neutral-700 px-3 text-white hover:bg-neutral-600"
                  >
                    保留当前修改并重试
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => { void reloadConflictDocument(); }}
                  className="h-8 rounded-md bg-red-400 px-3 font-medium text-neutral-950 hover:bg-red-300"
                >
                  重新加载服务器版本
                </button>
              )}
            </div>
          )}
          {/* Left sidebar: Layer panel */}
          {showLayerPanel && (stage === 'editing' || stage === 'exporting') && (
            <div className="w-56 shrink-0 flex flex-col bg-neutral-900/95 border-r border-neutral-700 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700 shrink-0">
                <span className="text-xs font-medium text-white/80">图层</span>
                <span className="text-xs text-white/40">{layers.length} 层</span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <LayerPanel
                  layers={layers}
                  selectedLayerId={selectedLayerId}
                  onSelectLayer={setSelectedLayerId}
                  onToggleVisibility={toggleVisibility}
                  onToggleLock={toggleLock}
                  onRenameLayer={renameLayer}
                  onReorderLayers={reorderLayers}
                />
              </div>
            </div>
          )}

          {/* Center: Canvas area with checkerboard background */}
          <div className="flex-1 relative overflow-hidden"
            style={{
              background: `
                repeating-conic-gradient(#3a3a3a 0% 25%, #2e2e2e 0% 50%) 0 0 / 20px 20px
              `,
            }}
          >
            {stage === 'choosing' && (
              <div className="flex h-full w-full items-center justify-center bg-neutral-900">
                <div className="flex w-full max-w-sm flex-col items-center gap-5 px-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-800 text-amber-400">
                    <Layers3 className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">选择分层引擎</h3>
                    <p className="mt-1 text-sm text-neutral-400">当前模式：{LAYER_MODES.find((item) => item.value === layerEngine)?.label}</p>
                  </div>
                  <button
                    type="button"
                    data-testid="layer-start"
                    onClick={() => void startLayering()}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-500 px-5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    开始分层
                  </button>
                </div>
              </div>
            )}

            {(stage === 'loading' || stage === 'cancelling') && (
              <div className="w-full h-full flex items-center justify-center">
                <div data-testid="layer-progress" className="w-72 rounded-xl bg-neutral-800 p-6 text-center">
                  <div className="mx-auto mb-4 h-2 w-36 overflow-hidden rounded-full bg-neutral-700">
                    <div className="h-full rounded-full bg-amber-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-sm font-medium text-white/80">
                    {stage === 'cancelling' ? '正在取消图片分层任务' : progressMessage || '正在分析图像...'}
                  </p>
                  <p className="mt-1 font-mono text-xs text-neutral-400">{Math.round(progress)}%</p>
                  {stage === 'loading' && (
                    <button
                      type="button"
                      data-testid="layer-cancel"
                      onClick={() => void handleCancelLayering()}
                      className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-neutral-700 px-4 text-sm text-neutral-100 transition-colors hover:bg-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      <Ban className="h-4 w-4" aria-hidden="true" />
                      取消
                    </button>
                  )}
                </div>
              </div>
            )}

            {stage === 'error' && (
              <div data-testid="layer-error" className="w-full h-full flex items-center justify-center">
                <div className="max-w-sm rounded-xl bg-neutral-800 p-6 text-center">
                  <p className="mb-5 text-sm text-red-300">{errorMessage}</p>
                  <div className="flex justify-center gap-3">
                    {errorAction !== 'terminal' && (
                      <button
                        type="button"
                        data-testid="layer-retry"
                        onClick={retryLayerAction}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-neutral-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        重试
                      </button>
                    )}
                    <button type="button" onClick={handleClose} className="h-9 rounded-lg bg-neutral-700 px-4 text-sm text-white hover:bg-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
                      关闭
                    </button>
                  </div>
                </div>
              </div>
            )}

            {stage === 'done' && (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center bg-neutral-800/90 rounded-xl p-6 shadow-xl border border-neutral-700">
                  <div className="w-10 h-10 mx-auto mb-3 flex items-center justify-center rounded-full bg-green-500/20">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M5 10L8.5 13.5L15 6.5" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-green-400 text-sm mb-4">PSD 文件已下载</p>
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => setStage('editing')} className="px-4 py-2 bg-neutral-700 text-white rounded text-sm hover:bg-neutral-600 transition-colors">
                      继续编辑
                    </button>
                    <button onClick={handleClose} className="px-4 py-2 bg-neutral-700 text-white rounded text-sm hover:bg-neutral-600 transition-colors">
                      关闭
                    </button>
                  </div>
                </div>
              </div>
            )}

            {(stage === 'editing' || stage === 'exporting') && (
              <>
                {qualityWarnings.length > 0 && (
                  <div className="absolute left-1/2 top-3 z-10 max-w-[min(34rem,80%)] -translate-x-1/2 rounded-lg bg-amber-950 px-3 py-2 text-xs text-amber-100 shadow-md" role="status">
                    结果需复核：{qualityWarnings[0]}
                  </div>
                )}
                <PsdCanvas
                  layers={layers}
                  selectedLayerId={selectedLayerId}
                  onSelectLayer={setSelectedLayerId}
                  onLayerMove={handleLayerMove}
                  width={canvasWidth}
                  height={canvasHeight}
                />
              </>
            )}

            {/* Fallback export toolbar when inspector is hidden */}
            {!showInspector && (stage === 'editing' || stage === 'exporting') && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
                <div className="bg-neutral-800/90 rounded-lg border border-neutral-700 px-3 py-2 shadow-xl">
                  <ExportToolbar
                    mode={exportMode}
                    onModeChange={handleExportModeChange}
                    onExport={handleExport}
                    isExporting={stage === 'exporting'}
                    progress={progress}
                    progressMessage={progressMessage}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right sidebar: Properties panel */}
          {showInspector && (stage === 'editing' || stage === 'exporting') && (
            <div className="w-60 shrink-0 flex flex-col bg-neutral-900/95 border-l border-neutral-700 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700 shrink-0">
                <span className="text-xs font-medium text-white/80">属性</span>
                <button onClick={() => setShowInspector(false)} className="text-white/40 hover:text-white/70 transition-colors">
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                {selectedLayer ? (
                  <LayerInspector layer={selectedLayer} />
                ) : (
                  <div className="px-3 py-6 text-center text-xs text-white/30">
                    选择一个图层查看属性
                  </div>
                )}
              </div>

              {/* Export toolbar at bottom of properties panel */}
              <div className="border-t border-neutral-700 p-2 shrink-0">
                <ExportToolbar
                  mode={exportMode}
                  onModeChange={handleExportModeChange}
                  onExport={handleExport}
                  isExporting={stage === 'exporting'}
                  progress={progress}
                  progressMessage={progressMessage}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
