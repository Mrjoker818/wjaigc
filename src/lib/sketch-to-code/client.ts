import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { createSketchHistory, type SketchHistory } from './drawing';
import type { SketchPlacement } from './placement-client';

export interface SketchScope {
  actorId: string; projectId: string; key: string;
  authority: 'legacy' | 'document' | 'unknown'; assertCurrent: (write?: boolean) => void;
}
export interface SketchInput {
  projectId: string; imageDataUrl: string; instruction: string;
  providerId: string; modelId: string; idempotencyKey: string;
}
export interface SketchTask {
  taskId: string; projectId: string; providerId: string; modelId: string;
  status: 'pending' | 'processing' | 'submitting' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  progress: number; reserveCredits: number; actualCredits?: number;
  phase?: 'analysis' | 'reconstruction'; dispatchPending?: boolean; needsReconcile?: boolean;
  previewAssetId?: string; htmlAssetId?: string; previewAssetVersionId?: string; htmlAssetVersionId?: string;
  analysis?: string; refunded?: boolean; error?: string; requestId?: string;
}
export const SKETCH_DOCUMENT_SANDBOX = '';
export interface SketchPanelSession {
  history: SketchHistory; instruction: string; selection: string; client: SketchClient; placement?: SketchPlacement;
}
export function createSketchPanelSession(scope: SketchScope): SketchPanelSession {
  return { history: createSketchHistory(), instruction: '', selection: '', client: new SketchClient(scope) };
}
export const DOCUMENT_PLACEMENT_REASON = '协作文档暂不能放置新草图版本，待延期的协作交付恢复；仍可在当前授权下生成、预览和下载代码。';
export const validSketchId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value);
export function sketchModels(catalog: readonly TaskModelDescriptor[]): TaskModelDescriptor[] {
  return catalog.filter(model => model.kind === 'chat' && model.supportsVision === true
    && model.protocol === 'chat-completions' && model.executionMode === 'sync');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('草图服务响应格式无效');
  return value as Record<string, unknown>;
}
function bounded(value: unknown, limit = 8192): string | undefined {
  return typeof value === 'string' && value.length <= limit ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : undefined;
}
function serviceMessage(value: unknown): string {
  const body = record(value);
  const error = typeof body.error === 'object' && body.error ? record(body.error) : body;
  return [bounded(typeof body.error === 'string' ? body.error : error.code, 200), bounded(error.message),
    bounded(error.phase, 128), bounded(error.requestId ?? body.requestId, 128)].filter(Boolean).join(' · ') || '草图服务暂不可用';
}
class SketchReadUnavailableError extends Error {}
function completedAnalysis(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length <= 100_000 ? value : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const fields = ['summary', 'layout', 'controls', 'text'] as const;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.some(field => field === key))) return undefined;
  const values: unknown[] = [];
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !('value' in descriptor)) return undefined;
    values.push(descriptor.value as unknown);
  }
  let bytes = 0;
  const encoder = new TextEncoder();
  const text = (candidate: unknown, required = false): candidate is string => {
    if (typeof candidate !== 'string' || candidate.length > 65536 || required && !candidate.trim()) return false;
    bytes += encoder.encode(candidate).length;
    return bytes <= 65536;
  };
  const list = (candidate: unknown): string[] | undefined => {
    if (!Array.isArray(candidate) || candidate.length > 200 || Reflect.ownKeys(candidate).length !== candidate.length + 1) return undefined;
    const strings: string[] = [];
    for (let index = 0; index < candidate.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
      if (!descriptor || !('value' in descriptor)) return undefined;
      const item: unknown = descriptor.value;
      if (!text(item)) return undefined;
      strings.push(item);
    }
    return strings;
  };
  const [summary, layout, controls, labels] = values;
  if (!text(summary, true) || !text(layout, true)) return undefined;
  const controlText = list(controls), labelText = list(labels);
  if (!controlText || !labelText) return undefined;
  // Plain sections keep the original content budget; JSON escaping is not a display projection.
  return `摘要：${summary}\n布局：${layout}\n控件：\n${controlText.join('\n')}\n文字：\n${labelText.join('\n')}`;
}
function parseTask(value: unknown, scope: SketchScope, expected?: { taskId?: string; providerId: string; modelId: string }, admission = false): SketchTask {
  const body = record(value);
  if (body.success !== true || body.type !== 'sketch-to-code' || body.projectId !== scope.projectId
    || !validSketchId(body.taskId) || typeof body.providerId !== 'string' || typeof body.modelId !== 'string'
    || !['pending', 'processing', 'submitting', 'completed', 'failed', 'cancelled', 'timeout'].includes(String(body.status))
    || typeof body.progress !== 'number' || !Number.isFinite(body.progress) || body.progress < 0 || body.progress > 100
    || typeof body.reserveCredits !== 'number' || !Number.isSafeInteger(body.reserveCredits) || body.reserveCredits < 0
    || expected && (expected.taskId && body.taskId !== expected.taskId || body.providerId !== expected.providerId || body.modelId !== expected.modelId)) throw new Error('草图任务身份或状态无效');
  const task: SketchTask = { taskId: body.taskId, projectId: scope.projectId, providerId: body.providerId,
    modelId: body.modelId, status: body.status as SketchTask['status'], progress: body.progress, reserveCredits: body.reserveCredits,
    ...(body.phase === 'analysis' || body.phase === 'reconstruction' ? { phase: body.phase } : {}),
    ...(body.dispatchPending === true ? { dispatchPending: true } : {}), ...(body.needsReconcile === true ? { needsReconcile: true } : {}),
    ...(typeof body.refunded === 'boolean' ? { refunded: body.refunded } : {}),
    ...(body.error ? { error: serviceMessage(body) } : {}), ...(bounded(body.requestId, 128) ? { requestId: bounded(body.requestId, 128) } : {}) };
  if (task.status === 'completed') {
    const resultFields = ['previewAssetId', 'htmlAssetId', 'previewAssetVersionId', 'htmlAssetVersionId', 'actualCredits', 'analysis'];
    if (admission && resultFields.every(field => !Object.prototype.hasOwnProperty.call(body, field))) {
      // A bare receipt proves only binding; result-bearing receipts still require the full strict validation below.
      return Object.freeze({ ...task, status: 'processing', progress: Math.min(task.progress, 99), needsReconcile: true });
    }
    const analysis = completedAnalysis(body.analysis);
    if (![body.previewAssetId, body.htmlAssetId, body.previewAssetVersionId, body.htmlAssetVersionId].every(validSketchId)
      || typeof body.actualCredits !== 'number' || !Number.isSafeInteger(body.actualCredits) || body.actualCredits < 0
      || analysis === undefined) throw new Error('草图结果引用或净费用无效');
    Object.assign(task, { previewAssetId: body.previewAssetId, htmlAssetId: body.htmlAssetId,
      previewAssetVersionId: body.previewAssetVersionId, htmlAssetVersionId: body.htmlAssetVersionId,
      actualCredits: body.actualCredits, analysis });
  }
  // Discard poll HTML, arbitrary URLs, credentials and pricing internals.
  return Object.freeze(task);
}
export class SketchClient {
  input?: Readonly<SketchInput>;
  task?: SketchTask;
  admissionUnknown = false;
  private generation = 0;
  private controllers = new Set<AbortController>();
  constructor(public readonly scope: SketchScope, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 30_000) {}
  private async request<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>): Promise<T> {
    this.scope.assertCurrent();
    if (this.scope.authority === 'unknown' || !validSketchId(this.scope.actorId) || !validSketchId(this.scope.projectId)) throw new Error('当前项目授权不可用');
    const generation = this.generation;
    const controller = new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const assert = (): void => { this.scope.assertCurrent(); if (controller.signal.aborted || generation !== this.generation) throw new Error('读取已停止，请在当前项目核对状态'); };
    try {
      const response = await this.fetcher(url, { ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      assert(); const result = await read(response); assert(); return result;
    } catch (error) {
      // A stopped, timed-out or obsolete read must never become a recoverable success.
      assert();
      if (url === '/api/poll-task') throw new SketchReadUnavailableError('完整结果暂不可用，请核对原任务');
      throw error;
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }
  private async json(url: string, body: object): Promise<{ status: number; value: unknown }> {
    return this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': this.scope.actorId }, body: JSON.stringify(body) },
      async response => ({ status: response.status, value: await response.json() as unknown }));
  }
  async start(input: SketchInput, reconcile = false): Promise<SketchTask> {
    this.scope.assertCurrent(true);
    const frozen = Object.freeze({ projectId: input.projectId, imageDataUrl: input.imageDataUrl, instruction: input.instruction,
      providerId: input.providerId, modelId: input.modelId, idempotencyKey: input.idempotencyKey });
    if (input.projectId !== this.scope.projectId || !validSketchId(input.idempotencyKey)
      || !input.imageDataUrl.startsWith('data:image/png;base64,') || !input.providerId || !input.modelId) throw new Error('草图输入无效');
    const same = this.input && JSON.stringify(this.input) === JSON.stringify(frozen);
    if (reconcile && !same) throw new Error('核对必须使用原冻结输入和提交标识');
    if (same && this.admissionUnknown && !reconcile) throw new Error('受理结果未知，请明确核对原提交');
    if (this.task?.needsReconcile && !same) throw new Error('原任务结果待核对，请先核对原任务');
    if (same && this.task && !reconcile) return this.task;
    if (same && this.task?.needsReconcile && reconcile) return this.poll(this.task.taskId);
    this.stop(); this.input = frozen; this.task = undefined; this.admissionUnknown = false;
    const generation = this.generation;
    let knownRejection = false;
    try {
      const { status, value } = await this.json('/api/sketch-to-code', frozen);
      if (status !== 200 && status !== 202) { knownRejection = status >= 400 && status < 500; throw new Error(serviceMessage(value)); }
      const task = parseTask(value, this.scope, frozen, true);
      this.task = task;
      if (task.status === 'completed' || record(value).status !== 'completed') return task;
      try { return await this.poll(task.taskId); }
      catch (error) {
        if (!(error instanceof SketchReadUnavailableError)) throw error;
        this.scope.assertCurrent(); if (generation !== this.generation) throw error;
        // The drawer receives tasks only on a resolved start, so return the safe receipt for explicit recovery.
        this.task = Object.freeze({ ...task, error: error.message });
        return this.task;
      }
    } catch (error) { if (this.input === frozen && !this.task) this.admissionUnknown = !knownRejection; throw error; }
  }
  async poll(taskId: string): Promise<SketchTask> {
    if (!validSketchId(taskId)) throw new Error('任务标识无效');
    const { status, value } = await this.json('/api/poll-task', { taskId, projectId: this.scope.projectId });
    if (status !== 200 && status !== 202) throw new SketchReadUnavailableError(serviceMessage(value));
    const task = parseTask(value, this.scope, this.task?.taskId === taskId ? this.task : undefined);
    if (task.taskId !== taskId) throw new Error('草图任务身份不匹配');
    this.task = task; return task;
  }
  async cancel(taskId: string): Promise<SketchTask> {
    if (!validSketchId(taskId)) throw new Error('任务标识无效');
    const { status, value } = await this.json('/api/cancel-task', { taskId, projectId: this.scope.projectId });
    if (status === 409) return this.poll(taskId);
    if (status !== 200) throw new Error(`取消结果未确认，费用以服务端为准：${serviceMessage(value)}`);
    const task = parseTask(value, this.scope, this.task?.taskId === taskId ? this.task : undefined);
    if (task.taskId !== taskId || task.status !== 'cancelled') throw new Error('取消结果未确认');
    this.task = task; return task;
  }
  async document(taskId: string): Promise<string> {
    if (!validSketchId(taskId)) throw new Error('任务标识无效');
    return this.request(`/api/sketch-to-code/${encodeURIComponent(taskId)}/document?projectId=${encodeURIComponent(this.scope.projectId)}`, { method: 'GET' }, async response => {
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('text/html')) throw new Error('当前代码读取未获授权，请重新核对任务');
      const html = await response.text();
      if (!html || html.length > 2_000_000) throw new Error('代码文档大小无效');
      return html;
    });
  }
  stop(): void { this.generation += 1; for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
}
