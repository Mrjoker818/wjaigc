// @vitest-environment jsdom
/**
 * Focused integration regression, discovered by the original root configuration.
 * Targets: real WorkflowSketchImageControls, SketchImagePlacement,
 * SketchImageClient and NodeEditor (including its real inline insert callback).
 * Doubles: HTTP/auth scope and canvas delivery only; DOM capability polyfills.
 * The canvas boundary uses the real production identity/dedupe functions.
 * The HTTP boundary models actor+nonce semantic idempotency, including metadata;
 * it is NOT a PostgreSQL/route sanitizer/concurrency acceptance test.
 * CanvasWorkspace sketchTransform admission and source badges belong to the
 * owner's separate integration/UI tests; this file exercises its real dedupe
 * helpers at delivery, not the full CanvasWorkspace component.
 */
import { webcrypto } from 'node:crypto';
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NodeEditor from '@/components/node-editor';
import { WorkflowSketchImageControls, type WorkflowSketchImageControlsProps } from '@/components/workflow-sketch-image-controls';
import { createEmptyWorkflow, createWorkflowNode, type Workflow, type WorkflowSketchImageReference } from '@/lib/workflow-engine';
import { canvasEntityIdForTransferredReference, filterUniqueCanvasImageInsertions, type WorkflowCanvasInsertionItem } from '@/lib/asset-core/workspace-transfer';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { SketchScope } from '@/lib/sketch-to-code/client';
import type { SketchImageTask } from '@/lib/sketch-to-code/image-client';
import { SketchImagePlacement } from '@/lib/sketch-to-code/image-placement-client';
import type { SketchInsert, SketchTransform } from '@/lib/sketch-to-code/placement-client';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

const REFERENCE: WorkflowSketchImageReference = Object.freeze({
  kind: 'sketch-image-reference', taskId: 'image-task', projectId: 'project-a',
  visionProviderId: 'vision-a', visionModelId: '视觉/模型', imageProviderId: 'image-a', imageModelId: '生成/模型',
  previewAssetId: 'input-asset', previewAssetVersionId: 'input-version',
  imageAssetId: 'result-asset', imageAssetVersionId: 'result-version',
});
// Approved new variant: no receipt-time createdAt in semantic transfer metadata.
// Kept as literal data, without inventing a production type/export before it exists.
const IMAGE_TRACE = Object.freeze({ source: 'sketch-to-image', taskId: 'image-task', projectId: 'project-a',
  previewAssetVersionId: 'input-version', imageAssetVersionId: 'result-version',
  visionProviderId: 'vision-a', visionModelId: '视觉/模型', imageProviderId: 'image-a', imageModelId: '生成/模型' });
const DEFAULT_TRANSFORM: SketchTransform = { x: 0, y: 0, width: 512, height: 384, rotation: 0, zIndex: 1 };

function completed(): SketchImageTask {
  return { taskId: 'image-task', projectId: 'project-a', visionProviderId: 'vision-a', visionModelId: '视觉/模型',
    imageProviderId: 'image-a', imageModelId: '生成/模型', status: 'completed', phase: 'generation', progress: 100,
    reserveCredits: 13, actualCredits: 20, refunded: true, needsReconcile: false, dispatchPending: false, recoveryPending: false,
    pricing: { version: 1, vision: { providerId: 'vision-a', modelId: '视觉/模型', calls: 1, mode: 'token', reserveCredits: 3,
      tokenPricing: { input: 2, output: 4 } }, image: { providerId: 'image-a', modelId: '生成/模型', calls: 1, credits: 10 }, totalReserveCredits: 13 },
    previewAssetId: 'input-asset', previewAssetVersionId: 'input-version', imageAssetId: 'result-asset', imageAssetVersionId: 'result-version',
    previewUrl: '/api/serve-upload/input.png', imageUrl: '/api/serve-upload/result.png',
    analysis: { summary: '原始草图', composition: '原始布局', prompt: '按关键词生成图片', negativePrompt: '' } };
}
function terminal(status: 'cancelled' | 'failed' | 'timeout'): SketchImageTask {
  const base = { ...completed() };
  for (const field of ['previewAssetId', 'previewAssetVersionId', 'imageAssetId', 'imageAssetVersionId',
    'previewUrl', 'imageUrl', 'analysis', 'actualCredits'] as const) delete base[field];
  // A real non-completed poll cannot carry completed result fields.
  return { ...base, status, progress: 60 };
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
}
function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('fixture expected an object');
  return value as Record<string, unknown>;
}
type Stage = 'poll' | 'asset' | 'transfer' | 'readback' | 'catalog';
interface Call { stage: Stage; url: string; init: RequestInit; body?: Record<string, unknown> }
interface TransferBody {
  sourceVersion: string; targetProject: string; targetWorkspace: string; entityType: string;
  entityId: string; idempotencyKey: string; transform: SketchTransform; metadata: Record<string, unknown>;
}
interface SavedPlacement { body: TransferBody; serialized: string; semantic: string; placementId: string }
interface HeldRead { stage: Stage; response?: Response; release?: () => void; promise: Promise<Response>; resolve: (response: Response) => void }
interface CanvasEntry extends WorkspaceAssetReference { id: string; transform: SketchTransform; instruction?: string; imageDataUrl?: string }
interface Delivery { label: string; reference: WorkspaceAssetReference; transform: SketchTransform }

const activePlacements: SketchImagePlacement[] = [];
const harnesses: Harness[] = [];
let subtleDescriptor: PropertyDescriptor | undefined;
let addedSubtle = false;

class Harness {
  readonly calls: Call[] = [];
  readonly unexpected: string[] = [];
  readonly saved = new Map<string, SavedPlacement>();
  readonly deliveries: Delivery[] = [];
  readonly observed: CanvasEntry[] = [];
  readonly source: CanvasEntry = Object.freeze({ id: 'source-canvas', assetId: 'input-asset', assetVersionId: 'input-version',
    placementId: 'input-placement', url: '/api/serve-upload/input.png',
    instruction: '原始关键词', imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    transform: Object.freeze({ x: 9, y: 12, width: 320, height: 240, rotation: 0, zIndex: 0 }) });
  readonly sourceSnapshot = JSON.stringify(this.source);
  readonly canvas: CanvasEntry[] = [this.source];
  revoked = false;
  pollCount = 0;
  lostTransferAckOnce = false;
  pollTask: (index: number) => SketchImageTask = (): SketchImageTask => completed();
  patch: (stage: Stage, value: Record<string, unknown>) => Record<string, unknown> = (_stage, value): Record<string, unknown> => value;
  private readonly holds: HeldRead[] = [];
  private nextHold?: HeldRead;
  readonly scope: SketchScope = { actorId: 'u1', projectId: 'project-a', key: 'lease-a', authority: 'legacy',
    assertCurrent: (write?: boolean): void => {
      if (this.revoked || this.scope.authority === 'unknown' || write && this.scope.authority !== 'legacy') throw new Error('PRIVATE_AUTH_ERROR');
    } };

  constructor() { harnesses.push(this); }
  holdNext(stage: Stage): HeldRead {
    let resolve!: (response: Response) => void;
    const hold: HeldRead = { stage, promise: new Promise<Response>(done => { resolve = done; }), resolve: (response): void => resolve(response) };
    this.nextHold = hold; this.holds.push(hold); return hold;
  }
  releaseHolds(): void { this.holds.forEach(hold => hold.release?.()); }
  insert(label = 'controls'): SketchInsert {
    return async (reference, transform): Promise<void> => {
      this.deliveries.push({ label, reference, transform }); this.accept(reference, transform, 'fallback-node');
    };
  }
  readonly onAddImages = async (items: WorkflowCanvasInsertionItem[]): Promise<void> => {
    for (const item of items) {
      if (!item.assetReference) throw new Error('delivery must receive a placed reference');
      this.deliveries.push({ label: 'node-editor', reference: item.assetReference, transform: DEFAULT_TRANSFORM });
      this.accept(item.assetReference, DEFAULT_TRANSFORM, item.outputNodeId);
    }
  };
  private accept(reference: WorkspaceAssetReference, transform: SketchTransform, fallback: string): void {
    if (!reference.assetId || !reference.assetVersionId || !reference.entityId || !reference.placementId || reference.kind !== 'image') {
      throw new Error('delivery requires complete generated-image placement identity');
    }
    const incoming: CanvasEntry = { ...reference, id: canvasEntityIdForTransferredReference(reference, fallback), transform: { ...transform } };
    // Same real boundary functions used in lowercase canvas-workspace.tsx.
    // A second legitimate callback with the SAME identity is not a second insertion.
    const additions = filterUniqueCanvasImageInsertions(this.canvas, [incoming]);
    this.canvas.push(...additions); this.observed.push(...additions);
  }
  private commit(body: TransferBody, serialized: string, actor: string): { saved: SavedPlacement; reused: boolean } {
    if (body.sourceVersion !== 'result-version' || body.targetProject !== 'project-a'
      || body.targetWorkspace !== 'canvas:project-a' || body.entityType !== 'canvas-image'
      || !body.entityId || !body.idempotencyKey) throw new Error('fixture received a foreign/input placement');
    const key = JSON.stringify([actor, body.idempotencyKey]);
    // Same semantic fields as the transfer route digest; nonce is its lookup key.
    // Metadata, including the new sourceTrace and any volatile field, participates.
    const semantic = JSON.stringify(canonical({ sourceVersion: body.sourceVersion, targetProject: body.targetProject,
      targetWorkspace: body.targetWorkspace, entityType: body.entityType, entityId: body.entityId,
      transform: body.transform ?? {}, metadata: body.metadata ?? {} }));
    const previous = this.saved.get(key);
    if (previous) {
      if (previous.semantic !== semantic) throw new Error('ASSET_IDEMPOTENCY_CONFLICT');
      return { saved: previous, reused: true };
    }
    if ([...this.saved.values()].some(item => item.body.entityId === body.entityId)) throw new Error('ASSET_PLACEMENT_CONFLICT');
    const saved: SavedPlacement = { body, serialized, semantic, placementId: `placement-${this.saved.size + 1}` };
    this.saved.set(key, saved); return { saved, reused: false };
  }
  readonly fetcher: typeof fetch = async (url, init = {}): Promise<Response> => {
    const path = String(url), parsed = new URL(path, 'http://fixture.invalid');
    let stage: Stage;
    if (path === '/api/poll-task') stage = 'poll';
    else if (path === '/api/assets/transfer') stage = 'transfer';
    else if (parsed.pathname === '/api/assets' && parsed.search) stage = parsed.searchParams.has('placementId') ? 'readback' : 'asset';
    else if (path === '/api/skills?surface=workflow') stage = 'catalog';
    else { this.unexpected.push(path); throw new Error(`Unexpected external request: ${path}`); }
    const body = init.body === undefined ? undefined : asRecord(JSON.parse(String(init.body)) as unknown);
    this.calls.push({ stage, url: path, init, body });
    if (stage !== 'catalog' && (new Headers(init.headers).get('x-wujie-expected-actor-id') !== 'u1'
      || init.credentials !== 'same-origin' || init.cache !== 'no-store' || init.redirect !== 'error')) {
      throw new Error('fixture protected-request authorization/options mismatch');
    }
    let value: Record<string, unknown>;
    if (stage === 'catalog') value = { skills: [] };
    else if (stage === 'poll') {
      if (init.method !== 'POST' || JSON.stringify(body) !== JSON.stringify({ taskId: 'image-task', projectId: 'project-a' })) {
        throw new Error('fixture poll binding mismatch');
      }
      value = { success: true, type: 'sketch-to-image', ...this.pollTask(++this.pollCount) };
    } else if (stage === 'transfer') {
      if (init.method !== 'POST') throw new Error('fixture transfer must be POST');
      const transfer = body as unknown as TransferBody;
      const { saved, reused } = this.commit(transfer, String(init.body), 'u1');
      // Full route receipt; sourceTrace echo deliberately optional for legacy fixtures.
      value = { assetId: 'result-asset', assetVersionId: 'result-version', entityId: saved.body.entityId,
        placementId: saved.placementId, placementStatus: 'active', placementRevision: '1',
        url: '/api/serve-upload/result.png', name: saved.body.metadata.name, reused };
      if (this.lostTransferAckOnce) { this.lostTransferAckOnce = false; throw new Error('PRIVATE_UNKNOWN_COMMIT'); }
    } else {
      if (init.method !== 'GET' || parsed.searchParams.get('projectId') !== 'project-a'
        || parsed.searchParams.get('assetVersionId') !== 'result-version') throw new Error('fixture asset read must bind output/project');
      value = { assetId: 'result-asset', assetVersionId: 'result-version', kind: 'image', url: '/api/serve-upload/result.png' };
      if (stage === 'readback') {
        const saved = [...this.saved.values()].find(item => item.placementId === parsed.searchParams.get('placementId'));
        if (!saved) throw new Error('fixture readback must address a committed placement');
        value = { ...value, placementId: saved.placementId, entityId: saved.body.entityId, name: saved.body.metadata.name };
      }
    }
    const response = json(this.patch(stage, value));
    if (this.nextHold?.stage === stage) {
      const hold = this.nextHold; this.nextHold = undefined;
      hold.response = response; hold.release = (): void => hold.resolve(response);
      // Intentionally ignores abort: real read gates must fence late HTTP arrivals.
      return hold.promise;
    }
    return response;
  };
  transfers(): Call[] { return this.calls.filter(call => call.stage === 'transfer'); }
  assertUnchangedInputAndNoNewPaidWork(): void {
    expect(JSON.stringify(this.source)).toBe(this.sourceSnapshot);
    expect(this.canvas[0]).toBe(this.source);
    expect(this.canvas.filter(item => item.assetVersionId === 'input-version')).toHaveLength(1);
    expect(this.unexpected).toEqual([]); // All start/generate/cancel/billing/write routes are unexpected.
    expect(this.calls.filter(call => !['poll', 'transfer'].includes(call.stage) && call.init.method === 'POST')).toEqual([]);
  }
  assertStableSinglePlacement(): void {
    const attempts = this.transfers(); expect(attempts.length).toBeGreaterThan(0);
    // No assumption about number of HTTP replays or legitimate sink callbacks.
    // Every observed submission of this SAME logical result must stay byte-stable.
    expect(new Set(attempts.map(call => String(call.init.body))).size).toBe(1);
    expect(new Set(attempts.map(call => call.body?.entityId)).size).toBe(1);
    expect(new Set(attempts.map(call => call.body?.idempotencyKey)).size).toBe(1);
    expect(this.saved.size).toBe(1); expect(this.observed).toHaveLength(1); expect(this.canvas).toHaveLength(2);
    expect(this.observed[0]).toMatchObject({ assetId: 'result-asset', assetVersionId: 'result-version',
      placementId: 'placement-1', url: '/api/serve-upload/result.png', transform: DEFAULT_TRANSFORM });
    expect(this.observed[0].id).toBe(attempts[0].body?.entityId);
    expect(this.observed[0].id).not.toBe('source-canvas'); this.assertUnchangedInputAndNoNewPaidWork();
  }
}

beforeEach((): void => {
  localStorage.clear();
  // Use genuine Node crypto only where jsdom lacks subtle; do not fix UUIDs.
  subtleDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
  addedSubtle = !globalThis.crypto.subtle;
  if (addedSubtle) Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle });
  vi.stubGlobal('matchMedia', (): object => ({ matches: false, addEventListener: (): void => {}, removeEventListener: (): void => {} }));
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      // jsdom has no layout: a zero-size viewport correctly culls the x=300
      // image node. Supply browser geometry, not a production culling bypass.
      this.callback([{ target, contentRect: new DOMRect(0, 0, 1280, 800),
        borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], this as unknown as ResizeObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
  });
});
afterEach(async (): Promise<void> => {
  cleanup(); activePlacements.forEach(placement => placement.stop());
  await act(async (): Promise<void> => { harnesses.forEach(harness => harness.releaseHolds()); });
  harnesses.forEach(harness => expect(harness.unexpected).toEqual([]));
  activePlacements.length = 0; harnesses.length = 0; localStorage.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (addedSubtle) {
    if (subtleDescriptor) Object.defineProperty(globalThis.crypto, 'subtle', subtleDescriptor);
    else Reflect.deleteProperty(globalThis.crypto, 'subtle');
  }
});
function props(harness: Harness, insert: SketchInsert): WorkflowSketchImageControlsProps {
  return { scope: harness.scope, reference: REFERENCE, status: 'success', insert, reserveCredits: 13, actualCredits: 20, refunded: true };
}
function mount(harness: Harness, insert = harness.insert()): ReturnType<typeof render> {
  vi.stubGlobal('fetch', harness.fetcher); return render(<WorkflowSketchImageControls {...props(harness, insert)} />);
}
function addButton(): HTMLButtonElement { return screen.getByRole('button', { name: '添加生成图到画布' }) as HTMLButtonElement; }
async function addAndSettle(): Promise<void> {
  expect(addButton().disabled).toBe(false); fireEvent.click(addButton());
  await waitFor((): void => { expect(addButton().disabled).toBe(false); expect(screen.queryByText('正在核对当前授权…')).toBeNull(); });
}
async function release(hold: HeldRead): Promise<void> {
  expect(hold.release).toBeDefined(); await act(async (): Promise<void> => { hold.release!(); });
}
function placement(harness: Harness): SketchImagePlacement {
  const result = new SketchImagePlacement(completed(), harness.scope, harness.insert('direct-class'), harness.fetcher);
  activePlacements.push(result); return result;
}

describe('workflow sketch-image placement reentry, real controls and real class', (): void => {
  it('coalesces repeated clicks before readback and after successful insertion, preserving the input and original net fee', async (): Promise<void> => {
    const h = new Harness(), hold = h.holdNext('readback'); mount(h);
    expect(h.calls).toEqual([]);
    fireEvent.click(addButton()); fireEvent.click(addButton());
    await waitFor((): void => expect(hold.release).toBeDefined()); expect(h.observed).toEqual([]);
    await release(hold); await waitFor((): void => expect(addButton().disabled).toBe(false));
    await addAndSettle(); h.assertStableSinglePlacement();
    expect(h.transfers()).toHaveLength(1); expect(h.deliveries).toHaveLength(1);
    expect(screen.getByText(/预留 13 积分.*净费 20 积分/)).toBeTruthy();
  });

  it('keeps a live placement when only insert function identity changes during readback', async (): Promise<void> => {
    const h = new Harness(), hold = h.holdNext('readback'), view = mount(h, h.insert('first-callback'));
    fireEvent.click(addButton()); await waitFor((): void => expect(hold.release).toBeDefined());
    view.rerender(<WorkflowSketchImageControls {...props(h, h.insert('replacement-callback'))} />);
    await release(hold);
    // Current effect cleanup cancels this real placement and leaves zero insertions.
    await waitFor((): void => expect(h.observed).toHaveLength(1));
    expect(h.deliveries[0].label).toBe('replacement-callback');
    await waitFor((): void => expect(addButton().disabled).toBe(false)); await addAndSettle();
    h.assertStableSinglePlacement();
  });

  it('preserves serialized entity/nonce/transform after a settled insert callback rerender', async (): Promise<void> => {
    const h = new Harness(), view = mount(h, h.insert('before-rerender'));
    await addAndSettle(); expect(h.observed).toHaveLength(1);
    view.rerender(<WorkflowSketchImageControls {...props(h, h.insert('after-rerender'))} />);
    await addAndSettle(); h.assertStableSinglePlacement();
  });

  it('reenters after unmount/remount of the same actor/project/task/result without a second actual canvas insertion', async (): Promise<void> => {
    const h = new Harness(), view = mount(h);
    await addAndSettle(); expect(h.observed).toHaveLength(1); view.unmount();
    mount(h, h.insert('remounted')); await addAndSettle(); h.assertStableSinglePlacement();
  });

  it('reuses the identical serialized intent across two real placement class lifetimes', async (): Promise<void> => {
    const h = new Harness(), first = placement(h); await first.add(); first.stop();
    await placement(h).add(); h.assertStableSinglePlacement();
    // Calls may be two: the production canvas dedupe decides novelty, not the callback count.
  });

  it('retries an unknown committed transfer inside the real class using the original nonce/entity/transform', async (): Promise<void> => {
    const h = new Harness(), p = placement(h); h.lostTransferAckOnce = true;
    await expect(p.add()).rejects.toThrow(); expect(h.saved.size).toBe(1); expect(h.deliveries).toEqual([]);
    await p.add(); expect(h.transfers()).toHaveLength(2); h.assertStableSinglePlacement();
  });

  it('recovers an unknown committed transfer after controls remount without creating another server placement', async (): Promise<void> => {
    const h = new Harness(); h.lostTransferAckOnce = true; const view = mount(h);
    await addAndSettle(); expect(screen.getByRole('alert')).toBeTruthy();
    expect(h.saved.size).toBe(1); expect(h.deliveries).toEqual([]); view.unmount();
    mount(h, h.insert('unknown-transfer-reentry')); await addAndSettle(); h.assertStableSinglePlacement();
  });

  it('stops during the first real class poll with exactly one request and no late transfer/insertion', async (): Promise<void> => {
    const h = new Harness(), hold = h.holdNext('poll'), p = placement(h);
    const pending = p.add(), rejection = expect(pending).rejects.toThrow();
    expect(h.calls).toHaveLength(1); p.stop(); await release(hold); await rejection;
    expect(h.calls.map(call => call.stage)).toEqual(['poll']); expect(h.deliveries).toEqual([]);
    h.assertUnchangedInputAndNoNewPaidWork();
  });

  it.each(['document', 'unknown'] as const)('prevents %s placement before transport or delivery', async (authority): Promise<void> => {
    const h = new Harness(); h.scope.authority = authority; mount(h);
    expect(addButton().disabled).toBe(true); fireEvent.click(addButton()); await act(async (): Promise<void> => {});
    expect(h.calls).toEqual([]); expect(h.deliveries).toEqual([]); h.assertUnchangedInputAndNoNewPaidWork();
  });

  it.each(['running', 'failed', 'cancelled', 'timeout', 'idle'])('does not place a residual reference in workflow status %s', async (status): Promise<void> => {
    const h = new Harness(); vi.stubGlobal('fetch', h.fetcher);
    render(<WorkflowSketchImageControls {...props(h, h.insert())} status={status} />);
    expect(addButton().disabled).toBe(true); fireEvent.click(addButton()); await act(async (): Promise<void> => {});
    expect(h.calls).toEqual([]); expect(h.deliveries).toEqual([]); h.assertUnchangedInputAndNoNewPaidWork();
  });

  it.each(['needsReconcile', 'dispatchPending', 'recoveryPending'] as const)('fences fresh completed %s before asset transfer', async (flag): Promise<void> => {
    const h = new Harness(); h.pollTask = (): SketchImageTask => ({ ...completed(), [flag]: true }); mount(h);
    await addAndSettle(); expect(screen.getByRole('alert')).toBeTruthy();
    expect(h.calls.map(call => call.stage)).toEqual(['poll']); expect(h.deliveries).toEqual([]); h.assertUnchangedInputAndNoNewPaidWork();
  });

  it.each(['cancelled', 'failed', 'timeout'] as const)('fences a valid fresh %s task receipt before result consumption', async (status): Promise<void> => {
    const h = new Harness(); h.pollTask = (): SketchImageTask => terminal(status); mount(h);
    await addAndSettle(); expect(screen.getByRole('alert')).toBeTruthy();
    expect(h.calls.map(call => call.stage)).toEqual(['poll']); expect(h.deliveries).toEqual([]); h.assertUnchangedInputAndNoNewPaidWork();
  });

  it.each(['result-version', 'net-fee'] as const)('rejects a valid %s change at the placement fresh poll, without hiding it as a malformed receipt', async (change): Promise<void> => {
    const h = new Harness(); h.pollTask = (index): SketchImageTask => index === 1 ? completed()
      : change === 'result-version' ? { ...completed(), imageAssetVersionId: 'later-version', imageUrl: '/api/serve-upload/later.png' }
        : { ...completed(), actualCredits: 21 };
    mount(h); await addAndSettle(); expect(screen.getByRole('alert')).toBeTruthy();
    expect(h.calls.map(call => call.stage)).toEqual(['poll', 'poll']); expect(h.deliveries).toEqual([]);
    h.assertUnchangedInputAndNoNewPaidWork();
  });

  it.each(['actor', 'project', 'authority', 'lease', 'revoked'] as const)('rejects late readback after %s changes even without a rerender', async (change): Promise<void> => {
    const h = new Harness(), hold = h.holdNext('readback'); mount(h);
    fireEvent.click(addButton()); await waitFor((): void => expect(hold.release).toBeDefined());
    if (change === 'actor') h.scope.actorId = 'other-actor';
    else if (change === 'project') h.scope.projectId = 'other-project';
    else if (change === 'authority') h.scope.authority = 'document';
    else if (change === 'lease') h.scope.key = 'new-lease';
    else h.revoked = true;
    await release(hold);
    // A new scope lifecycle clears old operation errors; only a same-scope
    // revocation keeps its alert. Neither path may deliver the stale readback.
    await waitFor((): void => expect(screen.queryByText('正在核对当前授权…')).toBeNull());
    if (change === 'revoked') expect(screen.getByRole('alert')).toBeTruthy();
    expect(h.deliveries).toEqual([]);
    expect(h.saved.size).toBe(1); expect(h.transfers()).toHaveLength(1); h.assertUnchangedInputAndNoNewPaidWork();
  });

  it.each(['status', 'result-version', 'unmount'] as const)('fences late readback after a genuine %s lifecycle change', async (change): Promise<void> => {
    const h = new Harness(), hold = h.holdNext('readback'), insert = h.insert(), view = mount(h, insert);
    fireEvent.click(addButton()); await waitFor((): void => expect(hold.release).toBeDefined());
    if (change === 'unmount') view.unmount();
    else view.rerender(<WorkflowSketchImageControls {...props(h, insert)}
      status={change === 'status' ? 'cancelled' : 'success'}
      reference={change === 'result-version' ? { ...REFERENCE, imageAssetVersionId: 'later-version' } : REFERENCE} />);
    await release(hold); expect(h.deliveries).toEqual([]); expect(h.saved.size).toBe(1); h.assertUnchangedInputAndNoNewPaidWork();
  });
});

describe('generated-image provenance at the real placement boundary', (): void => {
  it('derives exact stable image provenance for metadata and placed reference even when legacy receipts omit the echo', async (): Promise<void> => {
    const h = new Harness(); await placement(h).add();
    expect(h.calls.map(call => call.stage)).toEqual(['poll', 'asset', 'transfer', 'readback']);
    expect(h.transfers()[0].body?.metadata).toMatchObject({ sourceTrace: IMAGE_TRACE });
    expect(asRecord(h.transfers()[0].body?.metadata).sourceTrace).toEqual(IMAGE_TRACE);
    expect(h.deliveries[0].reference.sourceTrace).toEqual(IMAGE_TRACE);
    h.assertStableSinglePlacement();
  });

  it('accepts matching optional image-trace echoes on transfer/readback and preserves them at delivery', async (): Promise<void> => {
    const h = new Harness(); h.patch = (stage, value): Record<string, unknown> => ['transfer', 'readback'].includes(stage)
      ? { ...value, sourceTrace: IMAGE_TRACE } : value;
    await placement(h).add(); expect(h.deliveries[0].reference.sourceTrace).toEqual(IMAGE_TRACE); h.assertStableSinglePlacement();
  });

  describe.each(['transfer', 'readback'] as const)('optional %s trace must match independently derived image provenance', (stage): void => {
    it.each([
      { field: 'project', trace: { ...IMAGE_TRACE, projectId: 'other-project' } },
      { field: 'image version', trace: { ...IMAGE_TRACE, imageAssetVersionId: 'other-image-version' } },
      { field: 'vision binding', trace: { ...IMAGE_TRACE, visionModelId: '其他/视觉模型' } },
      { field: 'HTML provenance', trace: { source: 'sketch-to-code', taskId: 'image-task', projectId: 'project-a',
        previewAssetVersionId: 'input-version', htmlAssetVersionId: 'html-version', createdAt: '2026-10-09T00:00:00.000Z' } },
    ])('rejects conflicting $field before delivering an otherwise valid placed image', async ({ trace }): Promise<void> => {
      const h = new Harness(); h.patch = (current, value): Record<string, unknown> => current === stage
        ? { ...value, sourceTrace: trace } : value;
      await expect(placement(h).add()).rejects.toThrow(); expect(h.deliveries).toEqual([]); h.assertUnchangedInputAndNoNewPaidWork();
    });
  });
});

const VISION: TaskModelDescriptor = { providerId: 'vision-a', modelId: '视觉/模型', kind: 'chat', sourceType: 'chat', protocol: 'chat-completions',
  executionMode: 'sync', supportsVision: true, allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
  supportsReferenceImages: false, supportsMask: false, outputKinds: ['text'], capabilitySources: {} };
const IMAGE: TaskModelDescriptor = { ...VISION, providerId: 'image-a', modelId: '生成/模型', kind: 'image', sourceType: 'image',
  protocol: 'openai-images', executionMode: 'async', supportsReferenceImages: true, maxReferenceImages: 1,
  supportedOperations: ['image-to-image'], outputKinds: ['image'], allowedRatios: ['4:3'], allowedSizes: ['1024x768'], qualityOptions: ['high'] };
function workflow(h: Harness): Workflow {
  const input = createWorkflowNode('input-image', 0, 0); input.id = 'input-node';
  input.config = { imageUrl: h.source.url, imageDataUrl: h.source.imageDataUrl, projectId: 'project-a',
    assetId: 'input-asset', assetVersionId: 'input-version', placementId: 'input-placement' };
  const image = createWorkflowNode('ai-sketch-to-image', 300, 0); image.id = 'image-node'; image.label = '重入回归草图生图';
  image.config = { instruction: '原始关键词', visionModel: 'vision-a::视觉/模型', visionProviderId: 'vision-a',
    imageModel: 'image-a::生成/模型', imageProviderId: 'image-a', aspectRatio: '4:3', size: '1024x768', quality: 'high' };
  return { ...createEmptyWorkflow('重入回归'), id: 'wf-a', nodes: [input, image], connections: [
    { id: 'input-to-image', fromNodeId: 'input-node', fromPortId: 'out-image', toNodeId: 'image-node', toPortId: 'in-image', type: 'image' },
  ] };
}
function editorProps(h: Harness, wf: Workflow): ComponentProps<typeof NodeEditor> {
  return { workflow: wf, userId: 'u1', projectId: 'project-a', taskModelCatalog: [VISION, IMAGE],
    catalogStatus: { loading: false, error: null }, onAddImages: h.onAddImages, rendererMode: 'legacy', themeStyle: 'gold' };
}
async function mountEditor(h: Harness, wf: Workflow): Promise<ReturnType<typeof render>> {
  localStorage.setItem(`wujie_workflow_exec_state:v2:${JSON.stringify(['u1', 'project-a', 'wf-a'])}`, JSON.stringify({
    executionId: 'execution-a', execStatus: 'paused', execLogs: [], execResults: { 'image-node': { status: 'success', output: {
      sketchImageReference: REFERENCE, taskId: 'image-task', projectId: 'project-a', status: 'completed', phase: 'generation', progress: 100,
      reserveCredits: 13, actualCredits: 20, refunded: true, needsReconcile: false, dispatchPending: false, recoveryPending: false,
    } } },
  }));
  vi.stubGlobal('fetch', h.fetcher); const view = render(<NodeEditor {...editorProps(h, wf)} />);
  await act(async (): Promise<void> => {});
  const card = await screen.findByText('重入回归草图生图');
  fireEvent.mouseDown(card, { button: 0 }); fireEvent.click(card);
  await screen.findByRole('button', { name: '添加生成图到画布' });
  await act(async (): Promise<void> => {}); return view;
}

describe('real node-editor inline callback integration', (): void => {
  it('continues an in-flight placement across an unrelated editor rerender with a fresh real inline insert function', async (): Promise<void> => {
    const h = new Harness(), wf = workflow(h), before = JSON.stringify(wf), view = await mountEditor(h, wf);
    const hold = h.holdNext('readback'); fireEvent.click(addButton());
    await waitFor((): void => expect(hold.release).toBeDefined());
    view.rerender(<NodeEditor {...editorProps(h, wf)} themeStyle="monochrome" />); await release(hold);
    await waitFor((): void => expect(h.observed).toHaveLength(1));
    await waitFor((): void => expect(addButton().disabled).toBe(false));
    await addAndSettle(); h.assertStableSinglePlacement(); expect(JSON.stringify(wf)).toBe(before);
  });

  it('reenters the original editor result after rerender and remount while retaining source PNG/keywords and one canvas entity', async (): Promise<void> => {
    const h = new Harness(), wf = workflow(h), before = JSON.stringify(wf), view = await mountEditor(h, wf);
    await addAndSettle(); expect(h.observed).toHaveLength(1);
    view.rerender(<NodeEditor {...editorProps(h, wf)} themeStyle="monochrome" />); await addAndSettle();
    view.unmount(); await mountEditor(h, wf); await addAndSettle();
    h.assertStableSinglePlacement(); expect(JSON.stringify(wf)).toBe(before);
    expect(h.calls.some(call => call.url === '/api/workflow/execute' || call.url === '/api/sketch-to-image')).toBe(false);
  });
});
