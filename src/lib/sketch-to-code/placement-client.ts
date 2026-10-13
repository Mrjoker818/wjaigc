import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { parseWorkspaceSourceTrace, type SketchWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { DOCUMENT_PLACEMENT_REASON, validSketchId, type SketchScope, type SketchTask } from './client';
export interface SketchTransform { x: number; y: number; width: number; height: number; rotation: number; zIndex: number }
export type SketchInsert = (reference: WorkspaceAssetReference, transform: SketchTransform) => Promise<void>;
export class SketchPlacement {
  readonly trace: SketchWorkspaceSourceTrace;
  readonly entityId = `sketch-${crypto.randomUUID()}`;
  private readonly nonce = `sketch-placement-${crypto.randomUUID()}`;
  readonly transform: SketchTransform;
  private pending?: Promise<void>;
  private inserted = false;
  private controller?: AbortController;
  constructor(private readonly task: SketchTask, private readonly scope: SketchScope,
    private readonly insert: SketchInsert, private readonly fetcher: typeof fetch = fetch,
    transform: SketchTransform = { x: 0, y: 0, width: 512, height: 384, rotation: 0, zIndex: 1 }) {
    this.transform = Object.freeze({ ...transform });
    this.trace = Object.freeze({ source: 'sketch-to-code', taskId: task.taskId, projectId: task.projectId,
      previewAssetVersionId: task.previewAssetVersionId ?? '', htmlAssetVersionId: task.htmlAssetVersionId ?? '', createdAt: new Date().toISOString() });
  }
  stop(): void { this.controller?.abort(); }
  add(): Promise<void> {
    if (this.pending) return this.pending;
    const pending = this.perform().finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending; return pending;
  }
  private async perform(): Promise<void> {
    this.scope.assertCurrent(true);
    if (this.scope.authority !== 'legacy') throw new Error(this.scope.authority === 'document' ? DOCUMENT_PLACEMENT_REASON : '项目授权未知，不能放置');
    if (this.task.status !== 'completed' || this.task.projectId !== this.scope.projectId || !parseWorkspaceSourceTrace(this.trace)
      || !validSketchId(this.task.previewAssetId) || !Object.values(this.transform).every(Number.isFinite)) throw new Error('草图结果或落点无效，不能跨项目复制');
    if (this.inserted) return;
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 30_000);
    const assert = (): void => { this.scope.assertCurrent(true); if (controller.signal.aborted) throw new Error('放置读取已停止，请核对原落点'); };
    const request = async (url: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
      assert(); const response = await this.fetcher(url, { ...init, signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': this.scope.actorId } });
      assert(); const value: unknown = await response.json(); assert();
      if (!response.ok || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('素材放置收据不可用，请核对原意图');
      return value as Record<string, unknown>;
    };
    const validate = (value: Record<string, unknown>, placed: boolean): WorkspaceAssetReference => {
      if (value.assetVersionId !== this.task.previewAssetVersionId || value.assetId !== this.task.previewAssetId
        || typeof value.url !== 'string' || !/^(?:\/(?!\/)|https?:\/\/)/.test(value.url)
        || !placed && value.kind !== 'image'
        || placed && (!validSketchId(value.placementId) || value.entityId !== this.entityId
          || JSON.stringify(parseWorkspaceSourceTrace(value.sourceTrace)) !== JSON.stringify(this.trace))) throw new Error('素材放置身份或来源不匹配');
      return { url: value.url, assetId: value.assetId as string, assetVersionId: value.assetVersionId as string,
        ...(placed ? { entityId: this.entityId, placementId: value.placementId as string, sourceTrace: this.trace } : {}) };
    };
    try {
      const query = `/api/assets?projectId=${encodeURIComponent(this.scope.projectId)}&assetVersionId=${encodeURIComponent(this.trace.previewAssetVersionId)}`;
      const original = validate(await request(query), false);
      const receipt = await request('/api/assets/transfer', { method: 'POST', body: JSON.stringify({
        sourceVersion: this.trace.previewAssetVersionId, targetProject: this.scope.projectId, targetWorkspace: `canvas:${this.scope.projectId}`,
        entityType: 'canvas-image', entityId: this.entityId, idempotencyKey: this.nonce, transform: this.transform,
        metadata: { sourceTrace: this.trace, name: '草图转代码 · 原始草图PNG（非页面截图）' },
      }) });
      if (receipt.placementStatus !== 'active' || typeof receipt.reused !== 'boolean') throw new Error('素材放置未确认');
      const transferred = validate(receipt, true);
      if (transferred.url !== original.url) throw new Error('原始草图引用已变化');
      const readback = await request(`${query}&placementId=${encodeURIComponent(transferred.placementId!)}`);
      if (readback.kind !== 'image') throw new Error('原始草图素材类型不匹配');
      const refreshed = validate(readback, true);
      if (refreshed.url !== transferred.url || refreshed.placementId !== transferred.placementId) throw new Error('刷新后的素材落点不匹配');
      assert(); await this.insert(refreshed, this.transform); assert(); this.inserted = true;
    } finally { clearTimeout(timer); if (this.controller === controller) this.controller = undefined; }
  }
}
