// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SketchToCodePanel } from '@/components/sketch-to-code-panel';
import { createSketchPanelSession, type SketchScope } from '@/lib/sketch-to-code/client';
import { createSketchImagePanelSession, SketchImageClient } from '@/lib/sketch-to-code/image-client';

// Diagnostic only: native React DOM commits and native DOM clicks. No fake
// scheduler, direct cleanup/stop invocation, altered client timeout or paid API.
// A cleanup that stops the newly adopted client rather than its owned client
// should fail the early-click case's real cancelled receipt/UI assertions.
const discoveryUrl = '/api/tasks/recover?projectId=project-a';
const processing = {
  success: true, type: 'sketch-to-image', taskId: 'A5', projectId: 'project-a',
  visionProviderId: 'vision-a', visionModelId: 'same-model', imageProviderId: 'image-a', imageModelId: 'same-model',
  status: 'processing', phase: 'generation', progress: 55, reserveCredits: 30,
  pricing: { version: 1, vision: { providerId: 'vision-a', modelId: 'same-model', calls: 1, mode: 'token',
    reserveCredits: 10, tokenPricing: { input: 1000, output: 4000 } },
  image: { providerId: 'image-a', modelId: 'same-model', calls: 1, credits: 20 }, totalReserveCredits: 30 },
  needsReconcile: false, dispatchPending: false, recoveryPending: false, refunded: false, requestId: 'request-a5',
};
const cancelled = { ...processing, status: 'cancelled', progress: 0, refunded: true };
let observationOutputFaults = 0;
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve };
}
async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`DOM_CONTROL_BOUNDARY_NOT_REACHED:${label}`)), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
function observeDom<T>(element: HTMLElement, read: () => T | undefined): { promise: Promise<T>; disconnect: () => void } {
  const ready = deferred<T>();
  const check = (): void => { const value = read(); if (value !== undefined) { observer.disconnect(); ready.resolve(value); } };
  const observer = new MutationObserver(check);
  observer.observe(element, { childList: true, subtree: true, attributes: true, characterData: true });
  check();
  return { promise: ready.promise, disconnect: () => observer.disconnect() };
}
const button = (host: HTMLElement, text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === text);

beforeEach((): void => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
  }) as unknown as CanvasRenderingContext2D);
});
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll((): void => { expect(observationOutputFaults, 'diagnostic output failure, not a business RED').toBe(0); });

describe('native recovery DOM commit cancellation window', (): void => {
  it.each(['first-dom-commit', 'after-real-passive-cleanup'] as const)('%s preserves explicit cancellation confirmation', async (timing): Promise<void> => {
    const current = { actorId: 'actor-a', projectId: 'project-a' };
    const scope: SketchScope = { actorId: 'actor-a', projectId: 'project-a', key: 'scope-a', authority: 'legacy',
      assertCurrent: (): void => {
        if (current.actorId !== 'actor-a' || current.projectId !== 'project-a') throw new Error('当前身份或项目已失效');
      } };
    const poll = deferred<Response>(), cancel = deferred<Response>(), oldCleanup = deferred<void>(), cancellationSettled = deferred<void>();
    const requests: string[] = [], pending: Promise<unknown>[] = [];
    let cancelSignal: AbortSignal | undefined, enteredCancel = false, cancelOutcome = 'not-entered';
    let clickBeforeCleanup = false, cleanupObserved = false, cleanupStoppedAdoptedClient = false, finishing = false;
    const cancellingClients = new WeakSet<SketchImageClient>();
    let clickedConnected = false, clickedEnabled = false;
    const sequence: string[] = [];
    const cleanupEvents: { afterCancelEnter: boolean; sameAsCancelClient: boolean; targetIsAdopted: boolean;
      originalSignalAbortedBefore: boolean | null; originalSignalAbortedAfter: boolean | null }[] = [];
    let root: Root | undefined;
    const host = document.createElement('div'); document.body.append(host);
    const watchers: { disconnect: () => void }[] = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const route = String(url); requests.push(route);
      expect(init?.credentials).toBe('same-origin');
      expect(new Headers(init?.headers).get('x-wujie-expected-actor-id')).toBe('actor-a');
      if (route === discoveryUrl && init?.method === 'GET') return json({ success: true, tasks: [{
        id: 'A5', projectId: 'project-a', type: 'sketch-to-image', status: 'processing',
        createdAt: 1792020000000, updatedAt: 1792020300000,
      }] });
      expect(JSON.parse(String(init?.body))).toEqual({ taskId: 'A5', projectId: 'project-a' });
      expect(init?.method).toBe('POST');
      if (route === '/api/poll-task') return poll.promise;
      if (route === '/api/cancel-task') {
        enteredCancel = true; cancelSignal = init?.signal ?? undefined; sequence.push('cancel-transport-enter'); return cancel.promise;
      }
      throw new Error('UNEXPECTED_SYNTHETIC_ROUTE');
    });
    const session = createSketchPanelSession(scope), imageSession = createSketchImagePanelSession(scope);
    const initialClient = imageSession.client;
    const originalStop = SketchImageClient.prototype.stop, originalCancel = SketchImageClient.prototype.cancel;
    vi.spyOn(SketchImageClient.prototype, 'stop').mockImplementation(function (this: SketchImageClient): void {
      const passiveUnmount = String(new Error().stack).includes('commitHookEffectListUnmount');
      const adopted = imageSession.client !== initialClient && imageSession.client.task?.taskId === 'A5';
      const before = cancelSignal?.aborted ?? null;
      const result = Reflect.apply(originalStop, this, []);
      if (!finishing && passiveUnmount && adopted) {
        sequence.push('recovered-key-old-passive-cleanup');
        cleanupEvents.push({ afterCancelEnter: enteredCancel, sameAsCancelClient: cancellingClients.has(this),
          targetIsAdopted: this === imageSession.client, originalSignalAbortedBefore: before,
          originalSignalAbortedAfter: cancelSignal?.aborted ?? null });
        cleanupObserved = true; cleanupStoppedAdoptedClient ||= this === imageSession.client;
        oldCleanup.resolve();
      }
      return result;
    });
    vi.spyOn(SketchImageClient.prototype, 'cancel').mockImplementation(function (this: SketchImageClient, taskId: string): ReturnType<SketchImageClient['cancel']> {
      cancellingClients.add(this); sequence.push('real-client-cancel-enter');
      const originalPromise = Reflect.apply(originalCancel, this, [taskId]) as ReturnType<SketchImageClient['cancel']>;
      const observed = originalPromise.then(value => { cancelOutcome = value.status; }, () => { cancelOutcome = 'rejected'; })
        .finally(() => cancellationSettled.resolve());
      pending.push(observed);
      return originalPromise;
    });
    try {
      root = createRoot(host);
      flushSync((): void => { root!.render(<SketchToCodePanel session={session} imageSession={imageSession} recoverTasks />); });
      const choice = observeDom(host, (): HTMLButtonElement | undefined => [...host.querySelectorAll('button')]
        .find(node => node.textContent?.startsWith('草图生图 · A5 ·') && !node.disabled)); watchers.push(choice);
      (await within(choice.promise, 'choice')).click();
      const loading = observeDom(host, (): true | undefined => host.textContent?.includes('正在读取原任务，请稍候…') ? true : undefined);
      watchers.push(loading); await within(loading.promise, 'recovery-loading');
      const visible = observeDom(host, (): HTMLButtonElement | undefined => {
        const target = button(host, '取消任务（等待确认）');
        if (!target || target.disabled || !host.textContent?.includes('生图中 · 55%')) return undefined;
        sequence.push('recovered-processing-dom');
        if (timing === 'first-dom-commit') {
          clickedConnected = target.isConnected; clickedEnabled = !target.disabled;
          clickBeforeCleanup = !cleanupObserved; sequence.push('native-dom-click-untrusted'); target.click();
        }
        return target;
      }); watchers.push(visible);
      // Native asynchronous model receipt, deliberately outside React act.
      // The observer can only click a real enabled control after DOM commit.
      poll.resolve(json(processing));
      const target = await within(visible.promise, 'processing-dom');
      await within(oldCleanup.promise, 'actual-old-passive-cleanup');
      if (timing === 'after-real-passive-cleanup') {
        clickedConnected = target.isConnected; clickedEnabled = !target.disabled;
        sequence.push('native-dom-click-untrusted'); target.click();
      }
      expect(enteredCancel).toBe(true);
      expect(clickedConnected && clickedEnabled).toBe(true);
      sequence.push('synthetic-server-cancel-receipt-release');
      cancel.resolve(json(cancelled));
      await within(cancellationSettled.promise, 'real-cancel-settlement');
      expect(cancelSignal?.aborted).toBe(false);
      expect(imageSession.client.task).toMatchObject({ taskId: 'A5', status: 'cancelled', refunded: true });
      const confirmed = observeDom(host, (): true | undefined => host.textContent?.includes('已取消（服务端确认） · 0%')
        && host.textContent.includes('退款状态：服务端确认已退还预留额度') ? true : undefined);
      watchers.push(confirmed); await within(confirmed.promise, 'confirmed-ui');
      expect(requests).toEqual([discoveryUrl, '/api/poll-task', '/api/cancel-task']);
    } finally {
      // Record before genuine root unmount so expected final cleanup cannot be
      // confused with the old keyed child's observed passive cleanup.
      try {
        process.stdout.write('SKETCH_DOM_WINDOW_CONTROL ' + JSON.stringify({ timing, enteredCancel, clickBeforeCleanup,
          cleanupObserved, cleanupStoppedAdoptedClient, cancelSignalAborted: cancelSignal?.aborted ?? null,
          cancelOutcome, currentStatus: imageSession.client.task?.status ?? null,
          cancelledUi: !!host.textContent?.includes('已取消（服务端确认） · 0%'), requests, sequence, cleanupEvents,
          clickedConnected, clickedEnabled, nativeClickIsUntrusted: true, notProofOfTrustedInputOrOriginalWholeCause: true }) + '\n');
      } catch { observationOutputFaults++; }
      finally {
        finishing = true; for (const watcher of watchers) watcher.disconnect();
        try { if (root) flushSync((): void => root!.unmount()); }
        finally { host.remove(); poll.resolve(json(processing)); cancel.resolve(json(cancelled)); await Promise.allSettled(pending); }
      }
    }
  });
});
