'use client';

import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchSessionPayload } from '@/lib/auth-session';
import { extractTaskAssetReferences } from '@/lib/asset-core/workspace-transfer';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import {
  createImageGenerationSession,
  type ImageGenerationSession,
  type ImageGenerationSlot,
} from '@/lib/image-generation-session';
import {
  buildSimpleCreateCanvasUrl,
  buildSimpleCreateLoginUrl,
} from '@/lib/simple-create-navigation';
import { taskEventsClient } from '@/lib/task-events-client';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

import { SimpleCreateForm, type SimpleCreateFormValue } from './simple-create-form';
import { SimpleCreateResults } from './simple-create-results';

export interface SimpleCreateModel {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  allowedRatios: string[];
  allowedSizes: string[];
  qualityOptions: string[];
  maxOutputs: number;
  supportsReferenceImages: boolean;
  maxReferenceImages?: number;
}

export interface SimpleCreateDependencies {
  getSession(): Promise<{ authenticated: boolean }>;
  loadModels(): Promise<SimpleCreateModel[]>;
  uploadReference(file: File): Promise<WorkspaceAssetReference>;
  session: ImageGenerationSession;
  navigate(url: string): void;
  download(url: string, filename: string): void;
}

interface SimpleCreatePageProps {
  dependencies: SimpleCreateDependencies;
  initialProjectId: string;
}

interface SimpleCreatePageLifecycle {
  context: SimpleCreatePageProps;
  ready: boolean;
  submitting: boolean;
  uploadBusy: boolean;
}

export function SimpleCreatePage({ dependencies, initialProjectId }: SimpleCreatePageProps) {
  const context = useMemo<SimpleCreatePageProps>(
    () => ({ dependencies, initialProjectId }),
    [dependencies, initialProjectId],
  );
  const lifecycle = useRef<SimpleCreatePageLifecycle | null>(null);
  const [visibleContext, setVisibleContext] = useState<SimpleCreatePageProps | null>(null);
  const [models, setModels] = useState<SimpleCreateModel[]>([]);
  const [slots, setSlots] = useState<ImageGenerationSlot[]>([]);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const owner: SimpleCreatePageLifecycle = { context, ready: false, submitting: false, uploadBusy: false };
    lifecycle.current = owner;
    setVisibleContext(context);
    setLoading(true);
    setModels([]);
    setSlots([]);
    setReferenceImages([]);
    setSubmitting(false);
    setUploadBusy(false);
    setError('');
    const unsubscribe = dependencies.session.subscribe((currentSlots: ImageGenerationSlot[]): void => {
      if (lifecycle.current !== owner || !owner.ready) return;
      setSlots(currentSlots.filter((slot: ImageGenerationSlot): boolean => slot.projectId === initialProjectId));
    });
    void (async () => {
      try {
        const sessionState = await dependencies.getSession();
        if (lifecycle.current !== owner) return;
        if (!sessionState.authenticated) {
          dependencies.navigate(buildSimpleCreateLoginUrl(
            `/simple-create?${new URLSearchParams({ projectId: initialProjectId }).toString()}`,
          ));
          return;
        }
        if (!initialProjectId) {
          setError('请先选择一个项目');
          return;
        }
        const [availableModels] = await Promise.all([
          dependencies.loadModels(),
          dependencies.session.restore(initialProjectId),
        ]);
        if (lifecycle.current !== owner) return;
        const currentSlots = dependencies.session.snapshot();
        setModels(availableModels);
        setSlots(currentSlots.filter((slot: ImageGenerationSlot): boolean => slot.projectId === initialProjectId));
        owner.ready = true;
        if (availableModels.length === 0) setError('当前账号没有可用的图像模型');
      } catch (cause) {
        if (lifecycle.current === owner) setError(cause instanceof Error ? cause.message : '快速生图页加载失败');
      } finally {
        if (lifecycle.current === owner) setLoading(false);
      }
    })();
    return () => {
      if (lifecycle.current === owner) lifecycle.current = null;
      unsubscribe();
    };
  }, [context, dependencies, initialProjectId]);

  const submit = async (value: SimpleCreateFormValue): Promise<void> => {
    const owner = lifecycle.current;
    if (!owner || owner.context !== context || !owner.ready || owner.submitting || owner.uploadBusy) return;
    owner.submitting = true;
    setSubmitting(true);
    setError('');
    try {
      await dependencies.session.submit({
        projectId: initialProjectId,
        outputCount: value.outputCount,
        prompt: value.prompt,
        providerId: value.providerId,
        model: value.model,
        aspectRatio: value.aspectRatio,
        size: value.size,
        ...(value.quality ? { quality: value.quality } : {}),
        ...(value.resolution ? { resolution: value.resolution } : {}),
        referenceImages: value.referenceImages,
      });
      if (lifecycle.current !== owner) return;
      const currentSlots = dependencies.session.snapshot();
      setSlots(currentSlots.filter((slot: ImageGenerationSlot): boolean => slot.projectId === initialProjectId));
    } catch (cause) {
      if (lifecycle.current === owner) setError(cause instanceof Error ? cause.message : '图像生成任务提交失败');
    } finally {
      if (lifecycle.current === owner) {
        owner.submitting = false;
        setSubmitting(false);
      }
    }
  };

  if (loading || visibleContext !== context) {
    return (
      <main style={{ height: '100dvh' }} className="flex h-dvh min-h-0 items-center justify-center bg-[#0d1016] text-zinc-300">
        <LoaderCircle className="h-5 w-5 animate-spin" aria-label="正在加载" />
      </main>
    );
  }

  return (
    <main data-simple-create-page style={{ height: '100dvh' }} className="h-dvh min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-[#0d1016] text-white">
      <div className="mx-auto w-full max-w-3xl px-4 pb-12 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <header className="mb-7 flex items-center gap-3 border-b border-zinc-800 pb-4">
          <button
            type="button"
            aria-label="返回项目"
            onClick={() => dependencies.navigate('/?view=dashboard')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:border-amber-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">快速生图</h1>
            <p className="text-xs text-zinc-500 [overflow-wrap:anywhere]">项目 {initialProjectId || '未选择'}</p>
          </div>
        </header>

        {error && <div role="alert" className="mb-5 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>}

        {models.length > 0 && (
          <SimpleCreateForm
            models={models}
            submitting={submitting}
            uploadBusy={uploadBusy}
            referenceImages={referenceImages}
            onUpload={async (file: File): Promise<void> => {
              const owner = lifecycle.current;
              if (!owner || owner.context !== context || !owner.ready || owner.uploadBusy) return;
              owner.uploadBusy = true;
              setUploadBusy(true);
              setError('');
              try {
                const reference = await dependencies.uploadReference(file);
                if (lifecycle.current !== owner) return;
                setReferenceImages(current => [...current, reference.url]);
              } catch (cause) {
                if (lifecycle.current === owner) setError(cause instanceof Error ? cause.message : '参考图上传失败');
              } finally {
                if (lifecycle.current === owner) {
                  owner.uploadBusy = false;
                  setUploadBusy(false);
                }
              }
            }}
            onRemoveReference={(index: number): void => {
              const owner = lifecycle.current;
              if (!owner || owner.context !== context || !owner.ready) return;
              setReferenceImages(current => current.filter((_, itemIndex) => itemIndex !== index));
            }}
            onSubmit={submit}
          />
        )}

        <div className="mt-8">
          <SimpleCreateResults
            slots={slots}
            onCancel={(slotId: string): void => {
              const owner = lifecycle.current;
              if (!owner || owner.context !== context || !owner.ready) return;
              if (!slots.some((slot: ImageGenerationSlot): boolean => slot.id === slotId && slot.projectId === initialProjectId)) return;
              void dependencies.session.cancel(slotId);
            }}
            onRetry={(slotId: string): void => {
              const owner = lifecycle.current;
              if (!owner || owner.context !== context || !owner.ready) return;
              if (!slots.some((slot: ImageGenerationSlot): boolean => slot.id === slotId && slot.projectId === initialProjectId)) return;
              void dependencies.session.retry(slotId);
            }}
            onDownload={(slot: ImageGenerationSlot): void => {
              const owner = lifecycle.current;
              if (!owner || owner.context !== context || !owner.ready || slot.projectId !== initialProjectId) return;
              if (slot.url) dependencies.download(slot.url, `${slot.id}.png`);
            }}
            onOpenCanvas={(slot: ImageGenerationSlot): void => {
              const owner = lifecycle.current;
              if (!owner || owner.context !== context || !owner.ready || slot.projectId !== initialProjectId) return;
              if (!slot.url || !slot.assetVersionId || !slot.placementId) return;
              dependencies.navigate(buildSimpleCreateCanvasUrl(initialProjectId, {
                url: slot.url,
                assetVersionId: slot.assetVersionId,
                placementId: slot.placementId,
              }));
            }}
          />
        </div>
      </div>
    </main>
  );
}

export function SimpleCreateApp({ initialProjectId }: { initialProjectId: string }) {
  const dependencies = useMemo(() => createBrowserDependencies(), []);

  useEffect(() => {
    taskEventsClient.connect();
    return () => {
      dependencies.session.dispose();
      taskEventsClient.disconnect();
    };
  }, [dependencies]);

  return <SimpleCreatePage dependencies={dependencies} initialProjectId={initialProjectId} />;
}

function createBrowserDependencies(): SimpleCreateDependencies {
  const session = createImageGenerationSession({
    submit: async request => {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, n: request.outputCount, submitOnly: true }),
      });
      const data = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || data?.success !== true) {
        throw new Error(typeof data?.error === 'string' ? data.error : '图像生成任务提交失败');
      }
      return data;
    },
    retryRestoredTask: async (taskId, projectId) => {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retryTaskId: taskId, projectId, submitOnly: true, outputCount: 1, n: 1 }),
      });
      const data = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || !data) {
        throw new Error(typeof data?.error === 'string' ? data.error : '原任务重试提交失败，请稍后重试');
      }
      // A 200 success:false reply may identify a reused failed child that must remain retryable.
      return data;
    },
    subscribeTaskEvents: listener => taskEventsClient.onTaskEvent(event => listener({
      taskId: event.taskId,
      status: event.task.status,
      progress: event.task.progress,
      result: event.task.result,
      error: event.task.error,
    })),
    isTaskEventsConnected: () => taskEventsClient.isConnected(),
    cancelTask: taskId => taskEventsClient.cancelTask(taskId),
    restoreTasks: async projectId => {
      const response = await fetch(`/api/tasks/recover?projectId=${encodeURIComponent(projectId)}`);
      const data = await response.json().catch(() => null) as { tasks?: Array<Record<string, unknown>> } | null;
      if (!response.ok || !Array.isArray(data?.tasks)) return [];
      return data.tasks.flatMap(task => {
        const taskId = typeof task.id === 'string' ? task.id : '';
        const taskType = typeof task.type === 'string' ? task.type : '';
        if (
          !taskId
          || task.projectId !== projectId
          || typeof task.status !== 'string'
          || (taskType !== 'generate' && taskType !== 'generate-async')
        ) return [];
        return [{
          id: typeof task.slotId === 'string' ? task.slotId : undefined,
          taskId,
          projectId,
          status: task.status,
          progress: typeof task.progress === 'number' ? task.progress : 0,
          result: task.result,
          error: typeof task.error === 'string' ? task.error : undefined,
        }];
      });
    },
    extractAssetReferences: extractTaskAssetReferences,
    pollTask: async taskId => {
      const response = await fetch('/api/poll-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      const data = await response.json().catch(() => null) as Record<string, unknown> | null;
      return {
        taskId,
        status: typeof data?.status === 'string' ? data.status : 'failed',
        progress: typeof data?.progress === 'number' ? data.progress : undefined,
        result: data,
        error: typeof data?.error === 'string'
          ? { message: data.error, retryable: data.retryable === true }
          : undefined,
      };
    },
  });

  return {
    getSession: async () => {
      const payload = await fetchSessionPayload();
      return { authenticated: payload.success === true && Boolean(payload.user) };
    },
    loadModels: loadSimpleCreateModels,
    uploadReference: async file => {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/upload', { method: 'POST', body });
      const data = await response.json().catch(() => null) as { url?: string; error?: string } | null;
      if (!response.ok || !data?.url) throw new Error(data?.error || '参考图上传失败');
      return { url: data.url };
    },
    session,
    navigate: url => window.location.assign(url),
    download: (url, filename) => {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      anchor.click();
    },
  };
}

async function loadSimpleCreateModels(): Promise<SimpleCreateModel[]> {
  const response = await fetch('/api/models?type=image', { cache: 'no-store' });
  const data = await response.json().catch(() => null) as {
    success?: boolean;
    providers?: Array<{ id?: string; name?: string; displayName?: string }>;
    models?: Array<{ id?: string; name?: string; displayName?: string; providerId?: string }>;
    taskModelCatalog?: TaskModelDescriptor[];
  } | null;
  if (!response.ok || data?.success !== true || !Array.isArray(data.models) || !Array.isArray(data.taskModelCatalog)) {
    throw new Error('模型能力目录不可用');
  }
  const providerNames = new Map((data.providers || []).map(provider => [
    provider.id || '',
    provider.displayName || provider.name || provider.id || '',
  ]));
  const descriptors = new Map(data.taskModelCatalog.map(descriptor => [
    `${descriptor.providerId}::${descriptor.modelId}`,
    descriptor,
  ]));
  return data.models.flatMap(model => {
    if (!model.id || !model.providerId) return [];
    const descriptor = descriptors.get(`${model.providerId}::${model.id}`);
    if (!descriptor || descriptor.kind !== 'image') return [];
    return [{
      providerId: model.providerId,
      providerName: providerNames.get(model.providerId) || model.providerId,
      modelId: model.id,
      modelName: model.displayName || model.name || model.id,
      allowedRatios: descriptor.allowedRatios,
      allowedSizes: descriptor.allowedSizes,
      qualityOptions: descriptor.qualityOptions,
      maxOutputs: Math.min(Math.max(descriptor.maxOutputs, 1), 4),
      supportsReferenceImages: descriptor.supportsReferenceImages,
      maxReferenceImages: descriptor.maxReferenceImages,
    }];
  });
}
