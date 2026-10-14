import { validSketchId, type SketchScope } from './client';
import { parseStoredSketchImageInput, parseSketchImageAnalysis, type SketchImageInput, type SketchImageAnalysis } from './image-contract';
import type { SketchImagePricing } from './image-pricing';
import type { SketchImagePlacement } from './image-placement-client';

export interface SketchImageTask {
  readonly taskId: string; readonly projectId: string;
  readonly visionProviderId: string; readonly visionModelId: string;
  readonly imageProviderId: string; readonly imageModelId: string;
  readonly status: 'pending' | 'processing' | 'submitting' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  readonly phase?: 'analysis' | 'generation'; readonly progress: number;
  readonly reserveCredits: number; readonly pricing: Readonly<SketchImagePricing>;
  readonly previewAssetId?: string; readonly previewAssetVersionId?: string;
  readonly imageAssetId?: string; readonly imageAssetVersionId?: string;
  readonly previewUrl?: string; readonly imageUrl?: string;
  readonly analysis?: SketchImageAnalysis; readonly actualCredits?: number;
  readonly needsReconcile?: boolean; readonly dispatchPending?: boolean; readonly recoveryPending?: boolean;
  readonly refunded?: boolean; readonly error?: string; readonly requestId?: string;
}
/** These flags preserve original-task reconciliation; a completed label alone
 * cannot authorize result consumption or another paid intent. */
export function sketchImageNeedsReconcile(task: Pick<SketchImageTask, 'needsReconcile' | 'dispatchPending' | 'recoveryPending'>): boolean {
  return task.needsReconcile === true || task.dispatchPending === true || task.recoveryPending === true;
}
export interface SketchImagePanelSession {
  client: SketchImageClient; instruction: string; visionSelection: string; imageSelection: string;
  aspectRatio: string; size?: string; quality?: string; placement?: SketchImagePlacement;
}
export function createSketchImagePanelSession(scope: SketchScope): SketchImagePanelSession {
  return { client: new SketchImageClient(scope), instruction: '', visionSelection: '', imageSelection: '', aspectRatio: '4:3' };
}
function invalid(): never { throw new Error('草图生图回执无效，请核对原任务'); }
function record(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || fields && !fields.includes(key) || !descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    Object.defineProperty(copy, key, { value: descriptor.value as unknown, enumerable: true });
  }
  return copy;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) invalid();
  return value;
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 256 || /\p{Cc}/u.test(value)) invalid();
  return value;
}
/** Browser-only data projection of Task7 pricing. The quotation module imports
 * server billing/storage, so it is deliberately a type-only dependency here. */
function pricing(value: unknown): Readonly<SketchImagePricing> {
  const raw = record(value, ['version', 'vision', 'image', 'totalReserveCredits']);
  const vision = record(raw.vision, ['providerId', 'modelId', 'calls', 'mode', 'reserveCredits', 'tokenPricing']);
  const image = record(raw.image, ['providerId', 'modelId', 'calls', 'credits']);
  const token = vision.mode === 'token';
  if (raw.version !== 1 || Object.keys(raw).length !== 4 || vision.calls !== 1 || image.calls !== 1
    || Object.keys(image).length !== 4 || !['flat', 'token'].includes(String(vision.mode))
    || Object.keys(vision).length !== (token ? 6 : 5) || Object.hasOwn(vision, 'tokenPricing') !== token) invalid();
  const reserveCredits = integer(vision.reserveCredits, 100_000), credits = integer(image.credits, 100_000);
  const totalReserveCredits = integer(raw.totalReserveCredits, 200_000);
  if (totalReserveCredits !== reserveCredits + credits || token && reserveCredits < 1) invalid();
  let tokenPricing: Readonly<{ input: number; output: number }> | undefined;
  if (token) {
    const rates = record(vision.tokenPricing, ['input', 'output']);
    if (Object.keys(rates).length !== 2) invalid();
    const input = integer(rates.input, 10_000_000), output = integer(rates.output, 10_000_000);
    if (input < 1 || output < 1) invalid();
    tokenPricing = Object.freeze({ input, output });
  }
  return Object.freeze({ version: 1, vision: Object.freeze({ providerId: label(vision.providerId), modelId: label(vision.modelId),
    calls: 1, mode: token ? 'token' : 'flat', reserveCredits, ...(tokenPricing ? { tokenPricing } : {}) }),
  image: Object.freeze({ providerId: label(image.providerId), modelId: label(image.modelId), calls: 1, credits }), totalReserveCredits });
}
/** Shape restriction is not authorization. Only a fresh protected poll supplies
 * these URLs; absolute managed URLs are read without local credentials. */
export function sketchImageManagedUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || /[?#\\\p{Cc}]/u.test(value)) invalid();
  let path = value;
  if (!value.startsWith('/api/serve-upload/')) {
    let url: URL;
    try { url = new URL(value); } catch { return invalid(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.href !== value) invalid();
    path = url.pathname;
  }
  if (!path.startsWith('/api/serve-upload/')) invalid();
  let decoded: string;
  try { decoded = decodeURIComponent(path.slice('/api/serve-upload/'.length)); } catch { return invalid(); }
  if (!/^[A-Za-z0-9._/-]+$/u.test(decoded) || decoded.split('/').some(part => !part || part === '.' || part === '..')) invalid();
  return value;
}
const TASK_FIELDS = ['success', 'type', 'taskId', 'projectId', 'status', 'progress', 'visionProviderId', 'visionModelId',
  'imageProviderId', 'imageModelId', 'reserveCredits', 'pricing', 'phase', 'needsReconcile', 'dispatchPending', 'recoveryPending',
  'refunded', 'error', 'requestId', 'reused', 'charged', 'previewAssetId', 'previewAssetVersionId', 'imageAssetId', 'imageAssetVersionId',
  'previewUrl', 'imageUrl', 'analysis', 'actualCredits'];
type Binding = Pick<SketchImageTask, 'visionProviderId' | 'visionModelId' | 'imageProviderId' | 'imageModelId'>;
const PAIR = ['visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId'] as const;
const RESULT_FIELDS = ['previewAssetId', 'previewAssetVersionId', 'imageAssetId', 'imageAssetVersionId', 'previewUrl', 'imageUrl', 'analysis', 'actualCredits'];
function task(value: unknown, scope: SketchScope, expected?: Binding & Partial<SketchImageTask>, admission = false): SketchImageTask {
  const raw = record(value, TASK_FIELDS), quote = pricing(raw.pricing);
  if (raw.success !== true || raw.type !== 'sketch-to-image' || raw.projectId !== scope.projectId || !validSketchId(raw.taskId)
    || ['.', '..'].includes(raw.taskId) || !['pending', 'processing', 'submitting', 'completed', 'failed', 'cancelled', 'timeout'].includes(String(raw.status))
    || typeof raw.progress !== 'number' || !Number.isFinite(raw.progress) || raw.progress < 0 || raw.progress > 100
    || raw.reserveCredits !== quote.totalReserveCredits || PAIR.some(key => expected && raw[key] !== expected[key])
    || expected?.taskId && raw.taskId !== expected.taskId || expected?.pricing && JSON.stringify(quote) !== JSON.stringify(expected.pricing)) invalid();
  if (quote.vision.providerId !== raw.visionProviderId || quote.vision.modelId !== raw.visionModelId
    || quote.image.providerId !== raw.imageProviderId || quote.image.modelId !== raw.imageModelId) invalid();
  for (const field of ['needsReconcile', 'dispatchPending', 'recoveryPending', 'refunded', 'reused', 'charged']) {
    if (Object.hasOwn(raw, field) && typeof raw[field] !== 'boolean') invalid();
  }
  if (Object.hasOwn(raw, 'phase') && raw.phase !== 'analysis' && raw.phase !== 'generation') invalid();
  if (Object.hasOwn(raw, 'requestId')) label(raw.requestId);
  // Display only an allowlisted symbolic code; never supplier messages, cause or secrets.
  let error: string | undefined;
  if (Object.hasOwn(raw, 'error')) {
    const detail = record(raw.error, ['code', 'retryable', 'message', 'phase', 'requestId']);
    if (typeof detail.code !== 'string' || !/^SKETCH_[A-Z_]{1,100}$/.test(detail.code)) invalid();
    error = detail.code;
  }
  const base: SketchImageTask = { taskId: raw.taskId, projectId: scope.projectId,
    visionProviderId: label(raw.visionProviderId), visionModelId: label(raw.visionModelId), imageProviderId: label(raw.imageProviderId), imageModelId: label(raw.imageModelId),
    status: raw.status as SketchImageTask['status'], progress: raw.progress, reserveCredits: quote.totalReserveCredits, pricing: quote,
    ...(raw.phase ? { phase: raw.phase as SketchImageTask['phase'] } : {}),
    ...(typeof raw.needsReconcile === 'boolean' ? { needsReconcile: raw.needsReconcile } : {}),
    ...(typeof raw.dispatchPending === 'boolean' ? { dispatchPending: raw.dispatchPending } : {}),
    ...(typeof raw.recoveryPending === 'boolean' ? { recoveryPending: raw.recoveryPending } : {}),
    ...(typeof raw.refunded === 'boolean' ? { refunded: raw.refunded } : {}), ...(error ? { error } : {}),
    ...(raw.requestId ? { requestId: raw.requestId as string } : {}) };
  const present = RESULT_FIELDS.some(field => Object.hasOwn(raw, field));
  if (base.status !== 'completed') { if (present) invalid(); return Object.freeze(base); }
  if (!present && admission) return Object.freeze({ ...base, status: 'processing', progress: Math.min(base.progress, 99), needsReconcile: true });
  if (![raw.previewAssetId, raw.previewAssetVersionId, raw.imageAssetId, raw.imageAssetVersionId].every(validSketchId)
    || raw.previewAssetId === raw.imageAssetId || raw.previewAssetVersionId === raw.imageAssetVersionId) invalid();
  const result = { previewAssetId: raw.previewAssetId as string, previewAssetVersionId: raw.previewAssetVersionId as string,
    imageAssetId: raw.imageAssetId as string, imageAssetVersionId: raw.imageAssetVersionId as string,
    previewUrl: sketchImageManagedUrl(raw.previewUrl), imageUrl: sketchImageManagedUrl(raw.imageUrl),
    analysis: parseSketchImageAnalysis(raw.analysis), actualCredits: integer(raw.actualCredits) };
  if (result.imageUrl === result.previewUrl) invalid();
  return admission ? Object.freeze({ ...base, status: 'processing', progress: Math.min(base.progress, 99), needsReconcile: true })
    : Object.freeze({ ...base, ...result });
}
/** Data-only snapshot for placement, not a substitute for its fresh poll. */
export function freezeSketchImageClientTask(value: SketchImageTask, scope: SketchScope): SketchImageTask {
  return task({ ...record(value), success: true, type: 'sketch-to-image' }, scope);
}
/** Shared client read gate for the two Task9 modules only. Races include fetch
 * AND streamed body work; ignoring AbortSignal cannot leave callers hanging. */
export class SketchImageReadGate {
  readonly scope: SketchScope;
  generation = 0;
  private readonly controllers = new Set<AbortController>();
  constructor(private readonly original: SketchScope, private readonly fetcher: typeof fetch, private readonly timeoutMs = 30_000) {
    this.scope = Object.freeze({ ...original });
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new Error('读取截止无效');
  }
  assert(write = false): void {
    this.original.assertCurrent(write);
    if (['actorId', 'projectId', 'key', 'authority'].some(key => Reflect.get(this.original, key) !== Reflect.get(this.scope, key))
      || this.scope.authority === 'unknown' || !validSketchId(this.scope.actorId) || !validSketchId(this.scope.projectId)) throw new Error('当前项目授权已失效');
  }
  stop(): void { this.generation++; for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
  async request<T>(url: string, init: RequestInit, read: (response: Response, signal: AbortSignal) => Promise<T>, foreign = false): Promise<T> {
    this.assert(); const generation = this.generation, controller = new AbortController(); this.controllers.add(controller);
    const deadline = Date.now() + this.timeoutMs;
    const stopped = new Error('读取已停止或超时，请在当前项目核对原意图');
    const guard = (): void => { this.assert(); if (controller.signal.aborted || this.generation !== generation || Date.now() >= deadline) throw stopped; };
    let rejectAbort!: (reason: Error) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = (): void => rejectAbort(stopped); controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const operation = async (): Promise<T> => {
      const response = await this.fetcher(url, { ...init, signal: controller.signal, credentials: foreign ? 'omit' : 'same-origin', cache: 'no-store', redirect: 'error' });
      try { guard(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      const result = await read(response, controller.signal); guard(); return result;
    };
    try { return await Promise.race([operation(), aborted]); }
    catch { controller.abort(); throw stopped; }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); this.controllers.delete(controller); }
  }
  async json(url: string, body?: object): Promise<{ status: number; value: unknown }> {
    return this.request(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': this.scope.actorId },
      ...(body ? { body: JSON.stringify(body) } : {}) }, async (response, signal) => {
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') invalid();
      const bytes = await readBytes(response, signal, 1024 * 1024);
      let value: unknown; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { return invalid(); }
      return { status: response.status, value };
    });
  }
}
async function readBytes(response: Response, signal: AbortSignal, limit: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > limit)) {
    void response.body?.cancel().catch(() => {}); invalid();
  }
  if (!response.body || response.redirected) invalid();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  const abort = (): void => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) invalid();
      const chunk = await reader.read(); if (signal.aborted) invalid(); if (chunk.done) break;
      total += chunk.value.byteLength; if (total > limit) invalid(); chunks.push(chunk.value);
    }
    if (!total || declared !== null && Number(declared) !== total) invalid();
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); }
}
function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return undefined;
}
export class SketchImageClient {
  private currentInput?: Readonly<SketchImageInput>;
  private currentTask?: SketchImageTask;
  private unknown = false;
  private readonly nonces = new Set<string>();
  private pending?: Promise<SketchImageTask>;
  private revision = 0;
  private readonly gate: SketchImageReadGate;
  readonly scope: SketchScope;
  get input(): Readonly<SketchImageInput> | undefined { return this.currentInput; }
  get task(): SketchImageTask | undefined { return this.currentTask; }
  get admissionUnknown(): boolean { return this.unknown; }
  constructor(scope: SketchScope, fetcher: typeof fetch = fetch, timeoutMs = 30_000) { this.gate = new SketchImageReadGate(scope, fetcher, timeoutMs); this.scope = this.gate.scope; }
  async start(input: SketchImageInput, reconcile = false): Promise<SketchImageTask> {
    this.gate.assert(true); const frozen = parseStoredSketchImageInput(input);
    if (frozen.projectId !== this.scope.projectId || !validSketchId(frozen.idempotencyKey) || ['.', '..'].includes(frozen.idempotencyKey)) invalid();
    const same = !!this.currentInput && JSON.stringify(frozen) === JSON.stringify(this.currentInput);
    if (this.pending) { if (!same) invalid(); return this.pending; }
    if (reconcile && !same || this.unknown && (!same || !reconcile)) throw new Error('受理未知，必须核对原冻结输入和提交标识');
    if (this.currentTask && same) return this.poll(this.currentTask.taskId);
    if (this.currentTask && (!['failed', 'cancelled', 'timeout', 'completed'].includes(this.currentTask.status) || sketchImageNeedsReconcile(this.currentTask))) throw new Error('请先核对原任务');
    if (this.nonces.has(frozen.idempotencyKey) && !this.unknown) throw new Error('新生成必须使用新的提交标识');
    this.stop(); this.currentInput = frozen; this.currentTask = undefined; this.unknown = false; this.nonces.add(frozen.idempotencyKey);
    const generation = this.gate.generation;
    const pending = this.admit(frozen, generation).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending; return pending;
  }
  private async admit(input: Readonly<SketchImageInput>, generation: number): Promise<SketchImageTask> {
    let knownRejection = false;
    try {
      const response = await this.gate.json('/api/sketch-to-image', input);
      if (response.status !== 200 && response.status !== 202) {
        // A well-formed explicit 4xx rejection is different from a lost/invalid ACK.
        const rejection = record(response.value); knownRejection = response.status >= 400 && response.status < 500 && rejection.success === false;
        throw new Error('生图受理未确认，请核对原提交');
      }
      const accepted = task(response.value, this.scope, input, true); this.currentTask = accepted; this.revision++;
      if (record(response.value).status !== 'completed') return accepted;
      try { return await this.poll(accepted.taskId); }
      catch {
        this.gate.assert(); if (this.gate.generation !== generation) throw new Error('读取已停止');
        return this.currentTask = Object.freeze({ ...accepted, error: '完整图像结果暂不可用，请核对原任务' });
      }
    } catch (error) { if (!this.currentTask) this.unknown = !knownRejection; throw error; }
  }
  private expected(taskId: string): Binding & Partial<SketchImageTask> | undefined {
    if (!validSketchId(taskId) || ['.', '..'].includes(taskId) || this.currentTask && this.currentTask.taskId !== taskId) invalid();
    return this.currentTask ?? this.currentInput;
  }
  async poll(taskId: string): Promise<SketchImageTask> {
    const expected = this.expected(taskId), revision = this.revision;
    const response = await this.gate.json('/api/poll-task', { taskId, projectId: this.scope.projectId });
    if (response.status !== 200 && response.status !== 202) throw new Error('受保护图像结果暂不可用，请核对原任务');
    const parsed = task(response.value, this.scope, expected);
    if (parsed.taskId !== taskId || this.revision !== revision) invalid();
    this.currentTask = parsed; this.unknown = false; this.revision++; return parsed;
  }
  async cancel(taskId: string): Promise<SketchImageTask> {
    const expected = this.expected(taskId);
    if (!this.currentTask) throw new Error('受理未知，请先核对原提交，不能假定已取消');
    const response = await this.gate.json('/api/cancel-task', { taskId, projectId: this.scope.projectId });
    if (response.status === 409) return this.poll(taskId);
    if (response.status !== 200) throw new Error('取消结果未确认，费用以服务端为准');
    const parsed = task(response.value, this.scope, expected);
    if (parsed.taskId !== taskId || parsed.status !== 'cancelled') invalid();
    this.currentTask = parsed; this.revision++; return parsed;
  }
  async image(taskId: string): Promise<Blob> {
    const generation = this.gate.generation;
    const completed = await this.poll(taskId); this.gate.assert();
    if (generation !== this.gate.generation || completed.status !== 'completed' || sketchImageNeedsReconcile(completed) || !completed.imageUrl) invalid();
    const url = sketchImageManagedUrl(completed.imageUrl), revision = this.revision;
    return this.gate.request(url, { method: 'GET' }, async (response, signal): Promise<Blob> => {
      if (!response.ok) invalid();
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (!mime || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) invalid();
      const bytes = await readBytes(response, signal, 32 * 1024 * 1024);
      if (imageMime(bytes) !== mime || revision !== this.revision) invalid();
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
    }, !url.startsWith('/'));
  }
  stop(): void { this.gate.stop(); this.revision++; }
}
