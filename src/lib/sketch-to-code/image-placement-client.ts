import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { parseWorkspaceSourceTrace, type SketchImageWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { validSketchId, type SketchScope } from './client';
import type { SketchInsert, SketchTransform } from './placement-client';
import { SketchImageClient, SketchImageReadGate, freezeSketchImageClientTask, sketchImageManagedUrl, sketchImageNeedsReconcile, type SketchImageTask } from './image-client';

export class SketchImagePlacement {
  private readonly initialEntityId = `sketch-image-${crypto.randomUUID()}`;
  private identity?: Readonly<{ entityId: string; nonce: string }>;
  get entityId(): string { return this.identity?.entityId ?? this.initialEntityId; }
  readonly transform: SketchTransform;
  private readonly task: SketchImageTask;
  private readonly gate: SketchImageReadGate;
  private readonly client: SketchImageClient;
  private pending?: Promise<void>;
  private inserted = false;
  private insertionStarted = false;
  constructor(task: SketchImageTask, scope: SketchScope,
    private readonly insert: SketchInsert, fetcher: typeof fetch = fetch,
    transform: SketchTransform = { x: 0, y: 0, width: 512, height: 384, rotation: 0, zIndex: 1 }) {
    this.gate = new SketchImageReadGate(scope, fetcher); this.client = new SketchImageClient(scope, fetcher);
    this.task = freezeSketchImageClientTask(task, this.gate.scope);
    this.transform = Object.freeze({ ...transform });
  }
  add(): Promise<void> {
    if (this.pending) return this.pending;
    const pending = this.perform().finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending; return pending;
  }
  stop(): void { this.gate.stop(); this.client.stop(); }
  private async perform(): Promise<void> {
    this.gate.assert(true); const scope = this.gate.scope;
    if (scope.authority !== 'legacy') throw new Error('协作文档暂不能放置生成图；仍可在当前授权下预览和下载');
    if (this.task.status !== 'completed' || sketchImageNeedsReconcile(this.task) || this.task.projectId !== scope.projectId
      || Object.keys(this.transform).length !== 6 || !Object.values(this.transform).every(Number.isFinite)
      || this.transform.width <= 0 || this.transform.height <= 0) throw new Error('生成图或落点无效，不能覆盖原输入或跨项目');
    if (this.inserted) return;
    if (this.insertionStarted) throw new Error('本地插入结果未知，请核对原实体；不能重复插入');
    const generation = this.gate.generation, deadline = Date.now() + 30_000;
    let rejectStopped!: (reason: Error) => void;
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
    const timer = setTimeout(() => { this.stop(); rejectStopped(new Error('放置读取超时，请核对原落点')); }, 30_000);
    const guard = (): void => {
      this.gate.assert(true);
      if (this.gate.generation !== generation || Date.now() >= deadline) throw new Error('放置读取已停止，请核对原落点');
    };
    const request = async (url: string, body?: object): Promise<Record<string, unknown>> => {
      guard(); const response = await this.gate.json(url, body); guard();
      if (response.status !== 200 || !response.value || typeof response.value !== 'object' || Array.isArray(response.value)) throw new Error('放置收据未知，请核对原落点');
      return response.value as Record<string, unknown>;
    };
    const validate = (raw: Record<string, unknown>, placed: boolean, trace?: SketchImageWorkspaceSourceTrace): WorkspaceAssetReference => {
      if (raw.assetVersionId !== this.task.imageAssetVersionId || raw.assetId !== this.task.imageAssetId
        || sketchImageManagedUrl(raw.url) !== this.task.imageUrl || !placed && raw.kind !== 'image'
        || placed && (!validSketchId(raw.placementId) || raw.entityId !== this.entityId)) throw new Error('生成图版本或落点身份不匹配');
      if (placed && (!trace || Object.hasOwn(raw, 'sourceTrace')
        && JSON.stringify(parseWorkspaceSourceTrace(raw.sourceTrace)) !== JSON.stringify(trace))) throw new Error('生成图来源与原任务不匹配');
      return Object.freeze({ url: raw.url as string, assetId: raw.assetId as string, assetVersionId: raw.assetVersionId as string, kind: 'image',
        ...(placed ? { entityId: this.entityId, placementId: raw.placementId as string, sourceTrace: trace! } : {}) });
    };
    const operation = async (): Promise<void> => {
      const fresh = await this.client.poll(this.task.taskId); guard();
      const fields = ['taskId', 'projectId', 'visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId', 'pricing', 'reserveCredits',
        'actualCredits', 'previewAssetId', 'previewAssetVersionId', 'imageAssetId', 'imageAssetVersionId', 'previewUrl', 'imageUrl', 'analysis'] as const;
      if (fresh.status !== 'completed' || sketchImageNeedsReconcile(fresh) || fields.some(field => JSON.stringify(fresh[field]) !== JSON.stringify(this.task[field]))) throw new Error('生成图受权结果已变化，请核对原任务');
      const trace = parseWorkspaceSourceTrace({ source: 'sketch-to-image', taskId: this.task.taskId, projectId: scope.projectId,
        previewAssetVersionId: this.task.previewAssetVersionId, imageAssetVersionId: this.task.imageAssetVersionId,
        visionProviderId: this.task.visionProviderId, visionModelId: this.task.visionModelId,
        imageProviderId: this.task.imageProviderId, imageModelId: this.task.imageModelId });
      if (trace?.source !== 'sketch-to-image') throw new Error('生成图来源无效');
      // Initialize only after the original protected fresh poll. A remount of
      // this same actor/project/task/output must replay one semantic placement.
      if (!this.identity) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
          'sketch-image-placement-v1', scope.actorId, scope.projectId, this.task.taskId,
          this.task.imageAssetId, this.task.imageAssetVersionId,
        ])));
        guard();
        const suffix = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        this.identity = Object.freeze({ entityId: `sketch-image-${suffix}`, nonce: `sketch-image-placement-${suffix}` });
      }
      const query = `/api/assets?projectId=${encodeURIComponent(scope.projectId)}&assetVersionId=${encodeURIComponent(this.task.imageAssetVersionId!)}`;
      validate(await request(query), false);
      const receipt = await request('/api/assets/transfer', {
        sourceVersion: this.task.imageAssetVersionId, targetProject: scope.projectId, targetWorkspace: `canvas:${scope.projectId}`,
        entityType: 'canvas-image', entityId: this.entityId, idempotencyKey: this.identity.nonce, transform: this.transform,
        metadata: { name: '草图生图 · 新增生成图（不覆盖原始草图）', sketchImageTaskId: this.task.taskId, sourceTrace: trace },
      });
      if (receipt.placementStatus !== 'active' || typeof receipt.reused !== 'boolean') throw new Error('放置未确认，请核对原落点');
      const accepted = validate(receipt, true, trace);
      const raw = await request(`${query}&placementId=${encodeURIComponent(accepted.placementId!)}`);
      const readback = validate(raw, true, trace);
      if (raw.kind !== 'image' || readback.placementId !== accepted.placementId) throw new Error('生成图落点回读不匹配');
      guard(); this.insertionStarted = true;
      await this.insert(readback, this.transform);
      // A local sink may have inserted before stop/throw; never invoke it again
      // merely because the post-insert acknowledgement was lost.
      this.inserted = true; guard();
    };
    try { await Promise.race([operation(), stopped]); }
    finally { clearTimeout(timer); }
  }
}
