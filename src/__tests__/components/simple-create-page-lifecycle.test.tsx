// @vitest-environment jsdom
// PROPOSAL ONLY. Controller copies this entire file to
// src/__tests__/components/simple-create-page-lifecycle.test.tsx only after
// prior503 actual exit/close, DB post-proof, lock release, and AD docs closure.
// No execution, RED classification, or production change accompanies this fragment.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SimpleCreatePage,
  type SimpleCreateDependencies,
  type SimpleCreateModel,
} from '@/components/simple-create/simple-create-page';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { extractTaskAssetReferences } from '@/lib/asset-core/workspace-transfer';
import {
  createImageGenerationSession,
  type ImageGenerationSession,
  type ImageGenerationSlot,
  type ImageGenerationSessionDependencies,
  type ImageGenerationTaskUpdate,
  type RestoredImageGenerationTask,
} from '@/lib/image-generation-session';

type Auth = Awaited<ReturnType<SimpleCreateDependencies['getSession']>>;
type SubmitReply = Awaited<ReturnType<ImageGenerationSessionDependencies['submit']>>;
type SubmitRequest = Parameters<ImageGenerationSessionDependencies['submit']>[0];

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: Error): void;
}

interface OwnedDeferred {
  finish(): void;
  settled: Promise<void>;
}

interface Boot {
  auth: Deferred<Auth>;
  models: Deferred<SimpleCreateModel[]>;
  restore: Deferred<RestoredImageGenerationTask[]>;
}

interface Harness {
  dependencies: SimpleCreateDependencies;
  session: ImageGenerationSession;
  requests: SubmitRequest[];
  uploadFiles: File[];
  restores: string[];
  modelLoads: string[];
  navigations: string[];
  downloads: Array<{ url: string; filename: string }>;
  cancellations: string[];
  eventCallbacks: Array<(update: ImageGenerationTaskUpdate) => void>;
  planAuth(): Deferred<Auth>;
  planBoot(projectId: string): Boot;
  planSubmit(): Deferred<SubmitReply>;
  planUpload(): Deferred<WorkspaceAssetReference>;
  emit(update: ImageGenerationTaskUpdate): void;
}

const ownedDeferreds: OwnedDeferred[] = [];
const ownedSessions: ImageGenerationSession[] = [];

function deferred<T>(fallback: T): Deferred<T> {
  let done = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (cause: Error) => void;
  const promise = new Promise<T>((resolve, reject): void => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const gate: Deferred<T> = {
    promise,
    resolve(value: T): void {
      if (done) return;
      done = true;
      resolvePromise(value);
    },
    reject(cause: Error): void {
      if (done) return;
      done = true;
      rejectPromise(cause);
    },
  };
  ownedDeferreds.push({
    finish: (): void => gate.resolve(fallback),
    // Bookkeeping observes rejection without changing the consumer's promise.
    settled: promise.then((): void => undefined, (): void => undefined),
  });
  return gate;
}

function take<T>(queue: Deferred<T>[], name: string): Promise<T> {
  const gate = queue.shift();
  if (!gate) throw new Error(`Unplanned AE external I/O: ${name}`);
  return gate.promise;
}

async function resolveGate<T>(gate: Deferred<T>, value: T): Promise<void> {
  await act(async (): Promise<void> => {
    gate.resolve(value);
    await gate.promise;
  });
}

async function rejectGate<T>(gate: Deferred<T>, message: string): Promise<void> {
  await act(async (): Promise<void> => {
    gate.reject(new Error(message));
    await gate.promise.catch((): void => undefined);
  });
}

async function releaseResources(): Promise<void> {
  // Unmount first: do not let cleanup completions stand in for UI assertions.
  cleanup();
  ownedSessions.splice(0).forEach((session): void => session.dispose());
  const gates = ownedDeferreds.splice(0);
  await act(async (): Promise<void> => {
    gates.forEach((gate): void => gate.finish());
    await Promise.all(gates.map((gate): Promise<void> => gate.settled));
  });
}

afterEach(releaseResources);

function createHarness(identity: string): Harness {
  const authQueue: Deferred<Auth>[] = [];
  const modelQueue: Deferred<SimpleCreateModel[]>[] = [];
  const restoreQueues = new Map<string, Deferred<RestoredImageGenerationTask[]>[]>();
  const submitQueue: Deferred<SubmitReply>[] = [];
  const uploadQueue: Deferred<WorkspaceAssetReference>[] = [];
  const listeners = new Set<(update: ImageGenerationTaskUpdate) => void>();
  const eventCallbacks: Array<(update: ImageGenerationTaskUpdate) => void> = [];
  const requests: SubmitRequest[] = [];
  const uploadFiles: File[] = [];
  const restores: string[] = [];
  const modelLoads: string[] = [];
  const navigations: string[] = [];
  const downloads: Array<{ url: string; filename: string }> = [];
  const cancellations: string[] = [];
  let slotSequence = 0;

  const ports: ImageGenerationSessionDependencies = {
    submit: async (request: SubmitRequest): Promise<SubmitReply> => {
      requests.push(request);
      return take(submitQueue, 'submit');
    },
    restoreTasks: async (projectId: string): Promise<RestoredImageGenerationTask[]> => {
      restores.push(projectId);
      return take(restoreQueues.get(projectId) || [], `restore ${projectId}`);
    },
    subscribeTaskEvents: (listener): (() => void) => {
      listeners.add(listener);
      eventCallbacks.push(listener);
      return (): void => { listeners.delete(listener); };
    },
    isTaskEventsConnected: (): boolean => true,
    cancelTask: async (taskId: string): Promise<{ success: boolean }> => {
      cancellations.push(taskId);
      return { success: true };
    },
    extractAssetReferences: extractTaskAssetReferences,
    createSlotId: (): string => `${identity}-local-${++slotSequence}`,
    // pollTask is optional and deliberately absent: no real or fake timer exists.
  };
  const session = createImageGenerationSession(ports);
  ownedSessions.push(session);

  const dependencies: SimpleCreateDependencies = {
    getSession: async (): Promise<Auth> => take(authQueue, 'getSession'),
    loadModels: async (): Promise<SimpleCreateModel[]> => {
      modelLoads.push('image');
      return take(modelQueue, 'loadModels');
    },
    uploadReference: async (file: File): Promise<WorkspaceAssetReference> => {
      uploadFiles.push(file);
      return take(uploadQueue, 'uploadReference');
    },
    session,
    navigate: (url: string): void => { navigations.push(url); },
    download: (url: string, filename: string): void => { downloads.push({ url, filename }); },
  };

  const planAuth = (): Deferred<Auth> => {
    const gate = deferred<Auth>({ authenticated: false });
    authQueue.push(gate);
    return gate;
  };
  return {
    dependencies, session, requests, uploadFiles, restores, modelLoads,
    navigations, downloads, cancellations, eventCallbacks, planAuth,
    planBoot(projectId: string): Boot {
      const auth = planAuth();
      const models = deferred<SimpleCreateModel[]>([]);
      const restore = deferred<RestoredImageGenerationTask[]>([]);
      modelQueue.push(models);
      const queue = restoreQueues.get(projectId) || [];
      queue.push(restore);
      restoreQueues.set(projectId, queue);
      return { auth, models, restore };
    },
    planSubmit(): Deferred<SubmitReply> {
      const gate = deferred<SubmitReply>({ slots: [] });
      submitQueue.push(gate);
      return gate;
    },
    planUpload(): Deferred<WorkspaceAssetReference> {
      const gate = deferred<WorkspaceAssetReference>({ url: '/__ae__/cleanup.png' });
      uploadQueue.push(gate);
      return gate;
    },
    emit(update: ImageGenerationTaskUpdate): void {
      listeners.forEach((listener): void => listener(update));
    },
  };
}

const p1Model: SimpleCreateModel = {
  providerId: 'ae-provider-p1', providerName: 'AE P1',
  modelId: 'ae-model-p1', modelName: 'P1 Model',
  allowedRatios: ['1:1'], allowedSizes: ['1024x1024'], qualityOptions: ['standard'],
  maxOutputs: 2, supportsReferenceImages: true, maxReferenceImages: 2,
};
const p2Model: SimpleCreateModel = {
  providerId: 'ae-provider-p2', providerName: 'AE P2',
  modelId: 'ae-model-p2', modelName: 'P2 Model',
  allowedRatios: ['1:1'], allowedSizes: ['1024x1024'], qualityOptions: ['standard'],
  maxOutputs: 2, supportsReferenceImages: true, maxReferenceImages: 2,
};
const p1Reference: WorkspaceAssetReference = {
  url: '/__ae__/p1.png', assetVersionId: 'p1-v', placementId: 'p1-pl',
};
const p2Reference: WorkspaceAssetReference = {
  url: '/__ae__/p2.png', assetVersionId: 'p2-v', placementId: 'p2-pl',
};

function completedTask(
  projectId: string,
  id: string,
  reference: WorkspaceAssetReference,
): RestoredImageGenerationTask {
  return {
    id, taskId: `${id}-task`, projectId, status: 'completed', progress: 100,
    result: { imageUrls: [reference.url], assetProjection: { references: [reference] } },
  };
}

const p1Done = completedTask('p1', 'p1-visible', p1Reference);
const p2Done = completedTask('p2', 'p2-visible', p2Reference);

async function ready(
  boot: Boot,
  models: SimpleCreateModel[],
  tasks: RestoredImageGenerationTask[],
): Promise<void> {
  await act(async (): Promise<void> => {
    boot.auth.resolve({ authenticated: true });
    boot.models.resolve(models);
    boot.restore.resolve(tasks);
    await Promise.all([boot.auth.promise, boot.models.promise, boot.restore.promise]);
  });
}

function referenceFile(name: string): File {
  // Actual PNG bytes. No Image/decode/canvas/module replacement is installed.
  const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
  const bytes = Uint8Array.from(binary, (character: string): number => character.charCodeAt(0));
  return new File([bytes], name, { type: 'image/png' });
}

function fillPrompt(prompt: string): void {
  fireEvent.change(screen.getByLabelText('提示词'), { target: { value: prompt } });
}

function expectNoActionableProjectControls(): void {
  const enabledButtons = screen.queryAllByRole('button')
    .filter((element): boolean => element.getAttribute('aria-label') !== '返回项目')
    .filter((element): boolean => !element.matches(':disabled'))
    .map((element): string => element.getAttribute('aria-label') || element.textContent?.trim() || '');
  const enabledInputs = [
    ...screen.queryAllByRole('combobox'),
    ...screen.queryAllByRole('textbox'),
    ...screen.queryAllByLabelText('参考图'),
  ].filter((element): boolean => !element.matches(':disabled'))
    .map((element): string => element.getAttribute('aria-label') || 'unlabelled control');
  // Soft checkpoints continue to the next *controlled completion*, not a retry.
  // Inert retained UI is allowed; the contract is consumer admission, not markup.
  expect.soft(enabledButtons).toEqual([]);
  expect.soft(enabledInputs).toEqual([]);
}

function expectP2Only(): void {
  expect.soft(screen.queryByText('项目 p2')).not.toBeNull();
  expect.soft((screen.queryByLabelText('模型') as HTMLSelectElement | null)?.value)
    .toBe('ae-provider-p2::ae-model-p2');
  expect.soft(screen.queryByRole('button', { name: '下载 p2-visible' })).not.toBeNull();
  expect.soft(screen.queryByRole('button', { name: '下载 p1-visible' })).toBeNull();
  expect.soft(screen.queryAllByAltText('参考图已上传')).toHaveLength(0);
  expect.soft(screen.queryByRole('alert')).toBeNull();
}

describe('SimpleCreatePage bounded lifecycle consumer contract (AE proposal)', (): void => {
  // Break: anonymous readiness accidentally admits models, restored results, or generation.
  it('denies anonymous boot and preserves the project returnTo without exposing work controls', async (): Promise<void> => {
    const io = createHarness('anonymous');
    const auth = io.planAuth();
    render(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p1" />);
    expect(screen.getByLabelText('正在加载')).not.toBeNull();
    expect(screen.queryByLabelText('模型')).toBeNull();
    expect(screen.queryByRole('region', { name: '生成结果' })).toBeNull();

    await resolveGate(auth, { authenticated: false });

    expect(io.navigations).toEqual(['/?returnTo=%2Fsimple-create%3FprojectId%3Dp1']);
    expect(io.modelLoads).toEqual([]);
    expect(io.restores).toEqual([]);
    expect(io.requests).toEqual([]);
    expect(screen.queryByLabelText('提示词')).toBeNull();
    expect(screen.queryByRole('button', { name: '开始生成' })).toBeNull();
    expect(screen.queryByRole('region', { name: '生成结果' })).toBeNull();
    expect(screen.queryByAltText('参考图已上传')).toBeNull();
  });

  // Break: p1 controls stay live during p2 auth/model/restore, or a p1 reference enters p2.
  it('withdraws p1 admission throughout deferred p2 readiness and submits only current references', async (): Promise<void> => {
    const io = createHarness('switch');
    const first = io.planBoot('p1');
    const view = render(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p1" />);
    await ready(first, [p1Model], [p1Done]);
    fillPrompt('P1 draft');
    const upload = io.planUpload();
    fireEvent.change(screen.getByLabelText('参考图'), { target: { files: [referenceFile('p1.png')] } });
    await resolveGate(upload, { url: '/__ae__/p1-reference.png' });
    expect(screen.getByAltText('参考图已上传').getAttribute('src')).toBe('/__ae__/p1-reference.png');
    expect(screen.getByRole('button', { name: '下载 p1-visible' })).not.toBeNull();

    const second = io.planBoot('p2');
    view.rerender(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p2" />);
    expectNoActionableProjectControls();
    await resolveGate(second.auth, { authenticated: true });
    expectNoActionableProjectControls();
    await resolveGate(second.models, [p2Model]);
    expectNoActionableProjectControls();
    await resolveGate(second.restore, [p2Done]);
    expectP2Only();

    const submission = io.planSubmit();
    fillPrompt('P2 current prompt');
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(io.requests).toEqual([{
      projectId: 'p2', outputCount: 1, prompt: 'P2 current prompt',
      providerId: 'ae-provider-p2', model: 'ae-model-p2', aspectRatio: '1:1',
      size: '1024x1024', quality: 'standard', referenceImages: [], submitOnly: true,
    }]);
    await resolveGate(submission, { slots: [{ taskId: 'p2-current-task', slotIndex: 0, status: 'processing' }] });
    expect(io.uploadFiles.map((file): string => file.name)).toEqual(['p1.png']);
    expect(io.cancellations).toEqual([]);
  });

  // Break: an obsolete real restore publishes through the still-subscribed session.
  it('keeps p2 models results and handoff after p1 initialization finishes out of order', async (): Promise<void> => {
    const io = createHarness('late-init');
    const first = io.planBoot('p1');
    const view = render(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p1" />);
    await resolveGate(first.auth, { authenticated: true });
    expect(io.restores).toEqual(['p1']);
    expect(screen.queryByLabelText('模型')).toBeNull();

    const second = io.planBoot('p2');
    view.rerender(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p2" />);
    await ready(second, [p2Model], [p2Done]);
    expectP2Only();
    await resolveGate(first.models, [p1Model]);
    expectP2Only();
    await resolveGate(first.restore, [p1Done]);
    expectP2Only();
    expect(io.navigations).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '在画布中打开 p2-visible' }));
    expect(io.navigations).toEqual(['/?projectId=p2&assetVersionId=p2-v&placementId=p2-pl']);
    expect(io.restores).toEqual(['p1', 'p2']);
    expect(io.requests).toEqual([]);
  });

  // Break: a previously ready page admits old work after current denial/no project.
  // The brief explicitly permits these two boundary states in one bounded case.
  it('withdraws prior admission for current auth denial and for an empty project', async (): Promise<void> => {
    const boundaries: Array<{ projectId: string; authenticated: boolean; navigation: string[]; error: string | null }> = [
      { projectId: 'p2', authenticated: false, navigation: ['/?returnTo=%2Fsimple-create%3FprojectId%3Dp2'], error: null },
      { projectId: '', authenticated: true, navigation: [], error: '请先选择一个项目' },
    ];
    for (const boundary of boundaries) {
      try {
        const io = createHarness('denied');
        const first = io.planBoot('p1');
        const view = render(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p1" />);
        await ready(first, [p1Model], [p1Done]);
        fillPrompt('Previously admitted draft');
        const auth = io.planAuth();
        view.rerender(<SimpleCreatePage dependencies={io.dependencies} initialProjectId={boundary.projectId} />);
        expectNoActionableProjectControls();
        await resolveGate(auth, { authenticated: boundary.authenticated });
        expectNoActionableProjectControls();
        expect.soft(io.navigations).toEqual(boundary.navigation);
        expect.soft(screen.queryByRole('alert')?.textContent ?? null).toBe(boundary.error);
        expect.soft(io.modelLoads).toEqual(['image']);
        expect.soft(io.restores).toEqual(['p1']);
        expect.soft(io.requests).toEqual([]);
      } finally {
        await releaseResources();
      }
    }
  });

  // Break: p1's late accepted submit overwrites p2 results or releases p2's busy flag.
  it('fences an accepted p1 submit while a separately admitted p2 submit remains pending', async (): Promise<void> => {
    const io = createHarness('submit');
    const first = io.planBoot('p1');
    const view = render(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p1" />);
    await ready(first, [p1Model], []);
    const oldSubmit = io.planSubmit();
    fillPrompt('Old P1 accepted request');
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(io.requests.map((request): string => request.projectId)).toEqual(['p1']);

    const second = io.planBoot('p2');
    view.rerender(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p2" />);
    await ready(second, [p2Model], [p2Done]);
    const currentSubmit = io.planSubmit();
    fillPrompt('Current P2 accepted request');
    // A failure here is itself the first consumer-visible admission fence, not
    // permission to bypass the real disabled form to reach later assertions.
    expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(io.requests.map((request): string => request.projectId)).toEqual(['p1', 'p2']);

    await resolveGate(oldSubmit, { slots: [{ taskId: 'accepted-p1', slotIndex: 0, status: 'processing' }] });
    expect.soft(screen.queryByRole('button', { name: '取消 submit-local-1' })).toBeNull();
    expect.soft(screen.queryByRole('button', { name: '下载 p2-visible' })).not.toBeNull();
    expect.soft(screen.queryByRole('button', { name: '取消 submit-local-2' })).not.toBeNull();
    expect.soft((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(true);
    expect.soft(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(io.requests.map((request): string => request.projectId)).toEqual(['p1', 'p2']);
    expect(io.cancellations).toEqual([]);

    await resolveGate(currentSubmit, { slots: [{ taskId: 'accepted-p2', slotIndex: 0, status: 'processing' }] });
    expect(screen.getByRole('button', { name: '取消 submit-local-2' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '取消 submit-local-1' })).toBeNull();
    expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(false);
    expect(io.cancellations).toEqual([]);
  });

  // Break: a stale upload adds a foreign reference or unlocks a current upload.
  it('keeps p1 upload completion out of p2 references and preserves current upload admission', async (): Promise<void> => {
    const io = createHarness('upload');
    const first = io.planBoot('p1');
    const view = render(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p1" />);
    await ready(first, [p1Model], []);
    const oldUpload = io.planUpload();
    fireEvent.change(screen.getByLabelText('参考图'), { target: { files: [referenceFile('old-p1.png')] } });

    const second = io.planBoot('p2');
    view.rerender(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p2" />);
    await ready(second, [p2Model], []);
    fillPrompt('P2 reference isolation');
    expect((screen.getByLabelText('参考图') as HTMLInputElement).disabled).toBe(false);
    const currentUpload = io.planUpload();
    fireEvent.change(screen.getByLabelText('参考图'), { target: { files: [referenceFile('current-p2.png')] } });

    await resolveGate(oldUpload, { url: '/__ae__/late-p1-reference.png' });
    expect.soft(screen.queryAllByAltText('参考图已上传')).toHaveLength(0);
    expect.soft((screen.getByLabelText('参考图') as HTMLInputElement).disabled).toBe(true);
    expect.soft((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(true);
    expect.soft(screen.queryByText('正在上传')).not.toBeNull();
    expect(io.uploadFiles.map((file): string => file.name)).toEqual(['old-p1.png', 'current-p2.png']);

    await rejectGate(currentUpload, 'P2 reference refused');
    expect(screen.getByRole('alert').textContent).toBe('P2 reference refused');
    expect(screen.queryAllByAltText('参考图已上传')).toHaveLength(0);
    expect((screen.getByLabelText('参考图') as HTMLInputElement).disabled).toBe(false);
    const submission = io.planSubmit();
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(io.requests).toEqual([{
      projectId: 'p2', outputCount: 1, prompt: 'P2 reference isolation',
      providerId: 'ae-provider-p2', model: 'ae-model-p2', aspectRatio: '1:1',
      size: '1024x1024', quality: 'standard', referenceImages: [], submitOnly: true,
    }]);
    await resolveGate(submission, { slots: [{ taskId: 'upload-p2-task', slotIndex: 0, status: 'processing' }] });
  });

  // Break: replaced dependencies still receive old session publishes or async returns.
  it('keeps a replacement identity current while the old live session and queued submit finish', async (): Promise<void> => {
    const old = createHarness('old-identity');
    const first = old.planBoot('p1');
    const view = render(<SimpleCreatePage dependencies={old.dependencies} initialProjectId="p1" />);
    await ready(first, [p1Model], [{
      id: 'old-active', taskId: 'old-active-task', projectId: 'p1', status: 'processing', progress: 10,
    }]);
    expect(screen.getByRole('button', { name: '取消 old-active' })).not.toBeNull();
    const oldSubmit = old.planSubmit();
    fillPrompt('Old identity submit');
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    const current = createHarness('new-identity');
    const second = current.planBoot('p1');
    view.rerender(<SimpleCreatePage dependencies={current.dependencies} initialProjectId="p1" />);
    await ready(second, [p2Model], [completedTask('p1', 'new-visible', {
      url: '/__ae__/new.png', assetVersionId: 'new-v', placementId: 'new-pl',
    })]);
    expect(screen.getByRole('button', { name: '下载 new-visible' })).not.toBeNull();

    const oldEvent = old.eventCallbacks[0];
    if (!oldEvent) throw new Error('AE fixture did not capture the real session event callback');
    await act(async (): Promise<void> => {
      // Keep the old session alive here: early disposal would mask a page unsubscribe defect.
      oldEvent({
        taskId: 'old-active-task', projectId: 'p1', status: 'completed', progress: 100,
        result: { imageUrls: ['/__ae__/old.png'], assetProjection: { references: [{
          url: '/__ae__/old.png', assetVersionId: 'old-v', placementId: 'old-pl',
        }] } },
      });
    });
    expect(old.session.snapshot().find((slot): boolean => slot.id === 'old-active')?.status).toBe('completed');
    expect.soft(screen.queryByRole('button', { name: '下载 old-active' })).toBeNull();
    expect.soft(screen.queryByRole('button', { name: '取消 old-identity-local-1' })).toBeNull();
    expect.soft(screen.queryByRole('button', { name: '下载 new-visible' })).not.toBeNull();

    await resolveGate(oldSubmit, { slots: [{ taskId: 'old-identity-accepted', slotIndex: 0, status: 'processing' }] });
    expect.soft((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe('ae-provider-p2::ae-model-p2');
    expect.soft(screen.queryByRole('button', { name: '下载 old-active' })).toBeNull();
    expect.soft(screen.queryByRole('button', { name: '取消 old-identity-local-1' })).toBeNull();
    expect.soft(screen.queryByRole('button', { name: '下载 new-visible' })).not.toBeNull();
    fillPrompt('New identity remains usable');
    expect.soft((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '在画布中打开 new-visible' }));
    expect(current.navigations).toEqual(['/?projectId=p1&assetVersionId=new-v&placementId=new-pl']);
    expect(old.navigations).toEqual([]);
    expect(old.cancellations).toEqual([]);
    expect(current.cancellations).toEqual([]);
    // The embedding owner disposes sessions after unmount in releaseResources;
    // SimpleCreatePage itself is not asserted to own that resource.
  });

  // Break: one output's state suppresses another's controls or routes its handoff to p1.
  it('admits two current outputs with independent completed and processing controls', async (): Promise<void> => {
    const io = createHarness('positive');
    const boot = io.planBoot('p2');
    render(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="p2" />);
    await ready(boot, [p2Model], []);
    const submission = io.planSubmit();
    fillPrompt('Two independent P2 outputs');
    fireEvent.change(screen.getByLabelText('生成数量'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await resolveGate(submission, { slots: [
      { taskId: 'positive-first', slotIndex: 0, status: 'processing' },
      { taskId: 'positive-second', slotIndex: 1, status: 'processing' },
    ] });
    await act(async (): Promise<void> => {
      io.emit({ taskId: 'positive-first', projectId: 'p2', status: 'completed', progress: 100,
        result: { imageUrls: ['/__ae__/positive.png'], assetProjection: { references: [{
          url: '/__ae__/positive.png', assetVersionId: 'positive-v', placementId: 'positive-pl',
        }] } } });
      io.emit({ taskId: 'positive-second', projectId: 'p2', status: 'processing', progress: 45 });
    });

    expect(io.requests).toEqual([{
      projectId: 'p2', outputCount: 2, prompt: 'Two independent P2 outputs',
      providerId: 'ae-provider-p2', model: 'ae-model-p2', aspectRatio: '1:1',
      size: '1024x1024', quality: 'standard', referenceImages: [], submitOnly: true,
    }]);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('2 个槽位')).not.toBeNull();
    expect(screen.getByText('45%')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '取消 positive-local-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重试 positive-local-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下载 positive-local-2' })).toBeNull();
    expect(screen.queryByRole('button', { name: '在画布中打开 positive-local-2' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重试 positive-local-2' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下载 positive-local-1' }));
    fireEvent.click(screen.getByRole('button', { name: '在画布中打开 positive-local-1' }));
    expect(io.downloads).toEqual([{ url: '/__ae__/positive.png', filename: 'positive-local-1.png' }]);
    expect(io.navigations).toEqual(['/?projectId=p2&assetVersionId=positive-v&placementId=positive-pl']);

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: '取消 positive-local-2' }));
    });
    expect(io.cancellations).toEqual(['positive-second']);
    expect(screen.getByText('已取消')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '取消 positive-local-2' })).toBeNull();
    expect(screen.getByRole('button', { name: '下载 positive-local-1' })).not.toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });
});

const agRetentionModel: SimpleCreateModel = {
  providerId: 'ag-retention-provider', providerName: 'AG synthetic provider',
  modelId: 'ag-retention-model', modelName: 'AG synthetic image model',
  allowedRatios: ['1:1'], allowedSizes: ['1024x1024'], qualityOptions: ['standard'],
  maxOutputs: 2, supportsReferenceImages: false,
};

// SECTION B — APPENDABLE PROPOSED CASES (exactly two it blocks).

describe('SimpleCreatePage same-project sequential retention (AG proposal)', (): void => {
  it('retains a completed first output after the next submit resolves without a later publication', async (): Promise<void> => {
    const io = createHarness('ag-retain');
    const submitSpy = vi.spyOn(io.session, 'submit');
    const publications: ImageGenerationSlot[][] = [];
    const stopObserving = io.session.subscribe((value: ImageGenerationSlot[]): void => {
      publications.push(value);
    });
    const oldReference: WorkspaceAssetReference = {
      assetId: 'ag-retain-old-asset', assetVersionId: 'ag-retain-old-version',
      placementId: 'ag-retain-old-placement', entityId: 'ag-retain-old-entity',
      url: 'https://ag-retention.invalid/first-completed.png',
    };

    try {
      const boot = io.planBoot('ag-retain-project');
      render(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="ag-retain-project" />);
      await ready(boot, [agRetentionModel], []);
      expect(screen.queryByRole('region', { name: '生成结果' })).toBeNull();

      const firstReply = io.planSubmit();
      fillPrompt('AG first single output');
      expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
      expect(submitSpy).toHaveBeenCalledTimes(1);
      expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(true);
      const firstCall = submitSpy.mock.results[0];
      if (!firstCall || firstCall.type !== 'return') throw new Error('AG first real submit did not return a promise');
      await resolveGate(firstReply, {
        slots: [{ taskId: 'ag-retain-first-task', slotIndex: 0, status: 'processing' }],
      });
      const firstCreated = await firstCall.value;
      expect(firstCreated.map((slot: ImageGenerationSlot): string => slot.id)).toEqual(['ag-retain-local-1']);

      await act(async (): Promise<void> => {
        io.emit({
          taskId: 'ag-retain-first-task', projectId: 'ag-retain-project',
          status: 'completed', progress: 100,
          result: { imageUrls: [oldReference.url], assetProjection: { references: [oldReference] } },
        });
      });
      expect(screen.getByAltText('生成结果').getAttribute('src')).toBe(oldReference.url);
      expect(screen.getByRole('button', { name: '下载 ag-retain-local-1' })).not.toBeNull();
      expect(screen.getByRole('button', { name: '在画布中打开 ag-retain-local-1' })).not.toBeNull();

      const secondReply = io.planSubmit();
      fillPrompt('AG second single output');
      expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
      expect(submitSpy).toHaveBeenCalledTimes(2);
      const secondCall = submitSpy.mock.results[1];
      if (!secondCall || secondCall.type !== 'return') throw new Error('AG second real submit did not return a promise');

      // The second port promise is still pending. The real session has already
      // published both the completed old slot and the new submitting slot.
      expect(io.session.snapshot().map((slot: ImageGenerationSlot): string => slot.id))
        .toEqual(['ag-retain-local-1', 'ag-retain-local-2']);
      expect(io.session.snapshot()[1]).toMatchObject({ status: 'submitting', progress: 0 });
      expect(screen.getByAltText('生成结果').getAttribute('src')).toBe(oldReference.url);
      expect(screen.getByRole('button', { name: '取消 ag-retain-local-2' })).not.toBeNull();
      expect(screen.getAllByRole('article')).toHaveLength(2);
      expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(true);

      const publicationsBeforeReply = publications.length;
      let secondCreated: ImageGenerationSlot[] = [];
      await act(async (): Promise<void> => {
        secondReply.resolve({
          slots: [{ taskId: 'ag-retain-second-task', slotIndex: 0, status: 'processing' }],
        });
        // Await the real session return, not only the lower-level port reply.
        secondCreated = await secondCall.value;
      });

      // Diagnostic prerequisites distinguish the actual all-slots contract from
      // the actual created-only return, before asserting the consumer's DOM.
      expect(secondCreated).toEqual([{
        id: 'ag-retain-local-2', projectId: 'ag-retain-project',
        taskId: 'ag-retain-second-task', status: 'processing', progress: 0,
      }]);
      const allSlots = io.session.snapshot();
      expect(allSlots.map((slot: ImageGenerationSlot): string => slot.id))
        .toEqual(['ag-retain-local-1', 'ag-retain-local-2']);
      expect(allSlots[0]).toMatchObject({
        id: 'ag-retain-local-1', projectId: 'ag-retain-project',
        taskId: 'ag-retain-first-task', status: 'completed', progress: 100,
        url: oldReference.url, assetVersionId: 'ag-retain-old-version',
        placementId: 'ag-retain-old-placement',
      });
      expect(allSlots[1]).toEqual(secondCreated[0]);
      expect(publications.length).toBeGreaterThan(publicationsBeforeReply);
      expect(publications[publications.length - 1]).toEqual(allSlots);
      const publicationsAtReturn = publications.length;
      await act(async (): Promise<void> => { await Promise.resolve(); });
      expect(publications).toHaveLength(publicationsAtReturn);

      // No task event follows the second return. A future SSE/poll publication
      // must not be needed to make the old image and its managed controls exist.
      expect(screen.queryAllByAltText('生成结果').map((element: HTMLElement): string | null => element.getAttribute('src')))
        .toEqual([oldReference.url]);
      expect(screen.getByRole('button', { name: '下载 ag-retain-local-1' })).not.toBeNull();
      expect(screen.getByRole('button', { name: '在画布中打开 ag-retain-local-1' })).not.toBeNull();
      expect(screen.getByRole('button', { name: '取消 ag-retain-local-2' })).not.toBeNull();
      expect(screen.getAllByRole('article')).toHaveLength(2);
      expect(screen.getByText('2 个槽位')).not.toBeNull();
      expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(io.requests).toEqual([
        {
          projectId: 'ag-retain-project', outputCount: 1, prompt: 'AG first single output',
          providerId: 'ag-retention-provider', model: 'ag-retention-model',
          aspectRatio: '1:1', size: '1024x1024', quality: 'standard', referenceImages: [], submitOnly: true,
        },
        {
          projectId: 'ag-retain-project', outputCount: 1, prompt: 'AG second single output',
          providerId: 'ag-retention-provider', model: 'ag-retention-model',
          aspectRatio: '1:1', size: '1024x1024', quality: 'standard', referenceImages: [], submitOnly: true,
        },
      ]);
      expect(io.restores).toEqual(['ag-retain-project']);
      expect(io.uploadFiles).toEqual([]);
      expect(io.cancellations).toEqual([]);
      expect(io.navigations).toEqual([]);
      expect(io.downloads).toEqual([]);
    } finally {
      stopObserving();
      submitSpy.mockRestore();
      // The existing afterEach unmounts, disposes owned sessions, and settles
      // gates even on an assertion failure. Do not dispose early to hide it.
    }
  });

  it('retains a mixed prior batch and adds a completed delayed second submission at its return', async (): Promise<void> => {
    const io = createHarness('ag-mixed');
    const submitSpy = vi.spyOn(io.session, 'submit');
    const publications: ImageGenerationSlot[][] = [];
    const stopObserving = io.session.subscribe((value: ImageGenerationSlot[]): void => {
      publications.push(value);
    });
    const oldReference: WorkspaceAssetReference = {
      assetId: 'ag-mixed-old-asset', assetVersionId: 'ag-mixed-old-version',
      placementId: 'ag-mixed-old-placement', entityId: 'ag-mixed-old-entity',
      url: 'https://ag-retention.invalid/mixed-prior-completed.png',
    };
    const currentReference: WorkspaceAssetReference = {
      assetId: 'ag-mixed-current-asset', assetVersionId: 'ag-mixed-current-version',
      placementId: 'ag-mixed-current-placement', entityId: 'ag-mixed-current-entity',
      url: 'https://ag-retention.invalid/mixed-current-completed.png',
    };

    try {
      const boot = io.planBoot('ag-mixed-project');
      render(<SimpleCreatePage dependencies={io.dependencies} initialProjectId="ag-mixed-project" />);
      await ready(boot, [agRetentionModel], []);
      const firstReply = io.planSubmit();
      fillPrompt('AG prior two output batch');
      fireEvent.change(screen.getByLabelText('生成数量'), { target: { value: '2' } });
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
      expect(submitSpy).toHaveBeenCalledTimes(1);
      const firstCall = submitSpy.mock.results[0];
      if (!firstCall || firstCall.type !== 'return') throw new Error('AG mixed first real submit did not return a promise');
      await resolveGate(firstReply, { slots: [
        { taskId: 'ag-mixed-prior-completed-task', slotIndex: 0, status: 'processing' },
        { taskId: 'ag-mixed-prior-active-task', slotIndex: 1, status: 'processing' },
      ] });
      const firstCreated = await firstCall.value;
      expect(firstCreated.map((slot: ImageGenerationSlot): string => slot.id))
        .toEqual(['ag-mixed-local-1', 'ag-mixed-local-2']);
      await act(async (): Promise<void> => {
        io.emit({
          taskId: 'ag-mixed-prior-completed-task', projectId: 'ag-mixed-project',
          status: 'completed', progress: 100,
          result: { imageUrls: [oldReference.url], assetProjection: { references: [oldReference] } },
        });
        io.emit({
          taskId: 'ag-mixed-prior-active-task', projectId: 'ag-mixed-project',
          status: 'processing', progress: 45,
        });
      });
      expect(screen.getByAltText('生成结果').getAttribute('src')).toBe(oldReference.url);
      expect(screen.getByText('45%')).not.toBeNull();
      expect(screen.getByRole('button', { name: '取消 ag-mixed-local-2' })).not.toBeNull();
      expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(false);

      const secondReply = io.planSubmit();
      fillPrompt('AG delayed current single output');
      fireEvent.change(screen.getByLabelText('生成数量'), { target: { value: '1' } });
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
      expect(submitSpy).toHaveBeenCalledTimes(2);
      const secondCall = submitSpy.mock.results[1];
      if (!secondCall || secondCall.type !== 'return') throw new Error('AG mixed second real submit did not return a promise');

      // An actual prior-task update happens while the second port is unresolved.
      // Retention must use this latest state, not a pre-submit captured list.
      await act(async (): Promise<void> => {
        io.emit({
          taskId: 'ag-mixed-prior-active-task', projectId: 'ag-mixed-project',
          status: 'processing', progress: 63,
        });
      });
      expect(io.session.snapshot().map((slot: ImageGenerationSlot): string => slot.id))
        .toEqual(['ag-mixed-local-1', 'ag-mixed-local-2', 'ag-mixed-local-3']);
      expect(io.session.snapshot()[2]).toMatchObject({ status: 'submitting', progress: 0 });
      expect(screen.getByAltText('生成结果').getAttribute('src')).toBe(oldReference.url);
      expect(screen.getByText('63%')).not.toBeNull();
      expect(screen.getByRole('button', { name: '取消 ag-mixed-local-2' })).not.toBeNull();
      expect(screen.getByRole('button', { name: '取消 ag-mixed-local-3' })).not.toBeNull();
      expect(screen.getAllByRole('article')).toHaveLength(3);
      expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(true);

      const publicationsBeforeReply = publications.length;
      let secondCreated: ImageGenerationSlot[] = [];
      await act(async (): Promise<void> => {
        // This is the supported ordinary-generation group envelope, not a fake
        // session returning all slots or a normal-slot reply with ignored result.
        secondReply.resolve({
          taskId: 'ag-mixed-current-task', taskIds: ['ag-mixed-current-task'], status: 'completed',
          outputGroup: {
            version: 1, kind: 'ordinary-generation', taskId: 'ag-mixed-current-task', requestedCount: 1,
          },
          result: { imageUrls: [currentReference.url], assetProjection: { references: [currentReference] } },
        });
        secondCreated = await secondCall.value;
      });
      expect(secondCreated.map((slot: ImageGenerationSlot): string => slot.id)).toEqual(['ag-mixed-local-3']);
      expect(secondCreated[0]).toMatchObject({
        projectId: 'ag-mixed-project', taskId: 'ag-mixed-current-task', status: 'completed', progress: 100,
        assetId: 'ag-mixed-current-asset', assetVersionId: 'ag-mixed-current-version',
        placementId: 'ag-mixed-current-placement', entityId: 'ag-mixed-current-entity',
        url: currentReference.url, outputIndex: 0,
        outputGroup: {
          version: 1, kind: 'ordinary-generation', taskId: 'ag-mixed-current-task', requestedCount: 1,
        },
      });
      const allSlots = io.session.snapshot();
      const expectedIds = ['ag-mixed-local-1', 'ag-mixed-local-2', 'ag-mixed-local-3'];
      expect(allSlots.map((slot: ImageGenerationSlot): string => slot.id)).toEqual(expectedIds);
      expect(allSlots[0]).toMatchObject({
        projectId: 'ag-mixed-project', taskId: 'ag-mixed-prior-completed-task', status: 'completed',
        url: oldReference.url, assetVersionId: 'ag-mixed-old-version', placementId: 'ag-mixed-old-placement',
      });
      expect(allSlots[1]).toMatchObject({
        projectId: 'ag-mixed-project', taskId: 'ag-mixed-prior-active-task', status: 'processing', progress: 63,
      });
      expect(allSlots[2]).toEqual(secondCreated[0]);
      const replyPublications = publications.slice(publicationsBeforeReply);
      expect(replyPublications.length).toBeGreaterThan(0);
      for (const publication of replyPublications) {
        expect(publication.map((slot: ImageGenerationSlot): string => slot.id)).toEqual(expectedIds);
      }
      expect(publications[publications.length - 1]).toEqual(allSlots);
      const publicationsAtReturn = publications.length;
      await act(async (): Promise<void> => { await Promise.resolve(); });
      expect(publications).toHaveLength(publicationsAtReturn);

      // There is no event after return, even for the prior active sibling.
      // Assert both rendered images now; a subsequent event would mask loss.
      expect(screen.queryAllByAltText('生成结果').map((element: HTMLElement): string | null => element.getAttribute('src')))
        .toEqual([oldReference.url, currentReference.url]);
      expect(screen.getAllByRole('article')).toHaveLength(3);
      expect(screen.getByText('3 个槽位')).not.toBeNull();
      expect(screen.getByText('63%')).not.toBeNull();
      expect(screen.getByRole('button', { name: '下载 ag-mixed-local-1' })).not.toBeNull();
      expect(screen.getByRole('button', { name: '在画布中打开 ag-mixed-local-1' })).not.toBeNull();
      expect(screen.getByRole('button', { name: '取消 ag-mixed-local-2' })).not.toBeNull();
      expect(screen.queryByRole('button', { name: '下载 ag-mixed-local-2' })).toBeNull();
      expect(screen.getByRole('button', { name: '下载 ag-mixed-local-3' })).not.toBeNull();
      expect(screen.getByRole('button', { name: '在画布中打开 ag-mixed-local-3' })).not.toBeNull();
      expect(screen.queryByRole('button', { name: '取消 ag-mixed-local-3' })).toBeNull();
      expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(io.requests).toEqual([
        {
          projectId: 'ag-mixed-project', outputCount: 2, prompt: 'AG prior two output batch',
          providerId: 'ag-retention-provider', model: 'ag-retention-model',
          aspectRatio: '1:1', size: '1024x1024', quality: 'standard', referenceImages: [], submitOnly: true,
        },
        {
          projectId: 'ag-mixed-project', outputCount: 1, prompt: 'AG delayed current single output',
          providerId: 'ag-retention-provider', model: 'ag-retention-model',
          aspectRatio: '1:1', size: '1024x1024', quality: 'standard', referenceImages: [], submitOnly: true,
        },
      ]);
      expect(io.restores).toEqual(['ag-mixed-project']);
      expect(io.uploadFiles).toEqual([]);
      expect(io.cancellations).toEqual([]);
      expect(io.navigations).toEqual([]);
      expect(io.downloads).toEqual([]);
    } finally {
      stopObserving();
      submitSpy.mockRestore();
      // Existing lifecycle cleanup owns unmount/dispose/deferred settlement.
    }
  });
});
