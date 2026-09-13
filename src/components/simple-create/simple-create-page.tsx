'use client';

import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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

export function SimpleCreatePage({ dependencies, initialProjectId }: SimpleCreatePageProps) {
  const [models, setModels] = useState<SimpleCreateModel[]>([]);
  const [slots, setSlots] = useState<ImageGenerationSlot[]>([]);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => dependencies.session.subscribe(setSlots), [dependencies]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const sessionState = await dependencies.getSession();
        if (!active) return;
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
        const [availableModels, restoredSlots] = await Promise.all([
          dependencies.loadModels(),
          dependencies.session.restore(initialProjectId),
        ]);
        if (!active) return;
        setModels(availableModels);
        setSlots(restoredSlots);
        if (availableModels.length === 0) setError('当前账号没有可用的图像模型');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '快速生图页加载失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [dependencies, initialProjectId]);

  const submit = async (value: SimpleCreateFormValue): Promise<void> => {
    setSubmitting(true);
    setError('');
    try {
      setSlots(await dependencies.session.submit({
        projectId: initialProjectId,
        outputCount: value.outputCount,
        prompt: value.prompt,
        providerId: value.providerId,
        model: value.model,
        aspectRatio: value.aspectRatio,
        size: value.size,
        quality: value.quality,
        referenceImages: value.referenceImages,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图像生成任务提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#0d1016] text-zinc-300">
        <LoaderCircle className="h-5 w-5 animate-spin" aria-label="正在加载" />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#0d1016] text-white">
      <div className="mx-auto w-full max-w-3xl px-4 pb-12 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <header className="mb-7 flex items-center gap-3 border-b border-zinc-800 pb-4">
          <button
            type="button"
            aria-label="返回项目"
            onClick={() => dependencies.navigate('/?view=dashboard')}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:border-amber-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">快速生图</h1>
            <p className="text-xs text-zinc-500">项目 {initialProjectId || '未选择'}</p>
          </div>
        </header>

        {error && <div role="alert" className="mb-5 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>}

        {models.length > 0 && (
          <SimpleCreateForm
            models={models}
            submitting={submitting}
            uploadBusy={uploadBusy}
            referenceImages={referenceImages}
            onUpload={async (file) => {
              setUploadBusy(true);
              setError('');
              try {
                const reference = await dependencies.uploadReference(file);
                setReferenceImages(current => [...current, reference.url]);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : '参考图上传失败');
              } finally {
                setUploadBusy(false);
              }
            }}
            onRemoveReference={index => setReferenceImages(current => current.filter((_, itemIndex) => itemIndex !== index))}
            onSubmit={submit}
          />
        )}

        <div className="mt-8">
          <SimpleCreateResults
            slots={slots}
            onCancel={slotId => { void dependencies.session.cancel(slotId); }}
            onRetry={slotId => { void dependencies.session.retry(slotId); }}
            onDownload={slot => { if (slot.url) dependencies.download(slot.url, `${slot.id}.png`); }}
            onOpenCanvas={slot => {
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
