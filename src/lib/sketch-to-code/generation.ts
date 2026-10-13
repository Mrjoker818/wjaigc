import { inspectBinaryImage } from '@/lib/asset-core/binary-image-validation';
import type { GenerationProjectAccess } from '@/lib/collaboration/generation-project-access';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { compileSketchHtml } from './html';
import { aggregateSketchUsage, normalizeSketchStageResponse, type SketchCodeUsage } from './usage';

export interface SketchCodeInput {
  projectId: string;
  imageDataUrl: string;
  instruction: string;
  providerId: string;
  modelId: string;
  idempotencyKey: string;
}
export interface SketchAnalysis {
  readonly summary: string;
  readonly layout: string;
  readonly controls: readonly string[];
  readonly text: readonly string[];
}
export type SketchModelBinding = Readonly<Pick<TaskModelDescriptor, 'providerId' | 'modelId'>>;
export type SketchPhase = 'analysis' | 'reconstruction';
export type SketchPhaseCallback = (phase: SketchPhase) => Promise<void>;
/** Own validation failures, distinct from arbitrary adapter/database exceptions. */
export class SketchInputError extends Error {
  constructor(readonly code: 'SKETCH_INPUT_INVALID' | 'SKETCH_PROJECT_UNAVAILABLE' | 'SKETCH_MODEL_UNAVAILABLE' | 'SKETCH_IMAGE_INVALID' | 'SKETCH_IMAGE_LIMIT', message: string = code) {
    super(message); this.name = 'SketchInputError';
  }
}
/** Draft only: the guarded task route must publish assets and settle billing. */
export interface SketchCodeDraft { analysis: SketchAnalysis; html: string; uiTree?: unknown; readonly usage?: Readonly<SketchCodeUsage> }
export interface SketchGenerationDependencies {
  authorizeProject(inputActorUserId: string, projectId: string): Promise<GenerationProjectAccess>;
  resolveTaskModel(providerId: string, modelId: string, actorUserId: string): Promise<TaskModelDescriptor>;
  analyze(imageDataUrl: string, instruction: string, binding: SketchModelBinding, signal: AbortSignal): Promise<unknown>;
  reconstruct(analysis: SketchAnalysis, binding: SketchModelBinding, signal: AbortSignal): Promise<unknown>;
}
export interface SketchGenerationContext { actorUserId: string; signal: AbortSignal }
/** Admission snapshot only; computation neither bills nor permits asset publication. */
export interface SketchCodePreparation {
  readonly input: Readonly<SketchCodeInput>;
  readonly binding: SketchModelBinding;
  readonly access: Readonly<Exclude<GenerationProjectAccess, { kind: 'unscoped' }>>;
  compute(signal: AbortSignal, onPhase?: SketchPhaseCallback): Promise<SketchCodeDraft>;
}

const MAX_PNG_BYTES = 4 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const STAGE_TIMEOUT_MS = 60_000;
const INPUT_FIELDS = ['projectId', 'imageDataUrl', 'instruction', 'providerId', 'modelId', 'idempotencyKey'];

function record(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error(code);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !fields.includes(key) || !descriptor || !('value' in descriptor)) throw new Error(code);
    result[key] = descriptor.value as unknown;
  }
  return result;
}

function inputString(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && (!value || value !== value.trim() || /\p{Cc}/u.test(value)))) {
    throw new SketchInputError('SKETCH_INPUT_INVALID');
  }
  return value;
}

function parseInput(value: unknown): SketchCodeInput {
  let raw: Record<string, unknown>;
  try { raw = record(value, INPUT_FIELDS, 'SKETCH_INPUT_INVALID'); }
  catch { throw new SketchInputError('SKETCH_INPUT_INVALID'); }
  return Object.freeze({
    projectId: inputString(raw.projectId, 256), imageDataUrl: inputString(raw.imageDataUrl, Math.ceil(MAX_PNG_BYTES / 3) * 4 + 22),
    instruction: inputString(raw.instruction, 4096, true), providerId: inputString(raw.providerId, 256),
    modelId: inputString(raw.modelId, 256), idempotencyKey: inputString(raw.idempotencyKey, 256),
  });
}

function parseModelJson(value: unknown): unknown {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_JSON_BYTES) throw new Error('SKETCH_MODEL_INVALID_JSON');
  try { return JSON.parse(value) as unknown; }
  catch (cause) { throw new Error('SKETCH_MODEL_INVALID_JSON', { cause }); }
}

function parseAnalysis(value: unknown): SketchAnalysis {
  const code = 'SKETCH_ANALYSIS_INVALID';
  const raw = record(value, ['summary', 'layout', 'controls', 'text'], code);
  let bytes = 0;
  const boundedText = (value: unknown, required = false): string => {
    if (typeof value !== 'string' || value.length > 65536 || (required && !value.trim())) throw new Error(code);
    bytes += Buffer.byteLength(value, 'utf8');
    if (bytes > 65536) throw new Error(code);
    return value;
  };
  const list = (value: unknown): readonly string[] => {
    if (!Array.isArray(value) || value.length > 200) throw new Error(code);
    const values: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) throw new Error(code);
      values.push(boundedText(descriptor.value as unknown));
    }
    return Object.freeze(values);
  };
  return Object.freeze({ summary: boundedText(raw.summary, true), layout: boundedText(raw.layout, true), controls: list(raw.controls), text: list(raw.text) });
}

function freezeJson(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}

// Abort even an adapter that ignores its signal; late fulfillment cannot start the next phase.
async function runStage<T>(operation: (signal: AbortSignal) => Promise<T>, parent: AbortSignal): Promise<T> {
  parent.throwIfAborted();
  const deadline = new AbortController();
  const signal = AbortSignal.any([parent, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(new Error('SKETCH_MODEL_TIMEOUT')), STAGE_TIMEOUT_MS);
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = (): void => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(signal); }).then(
      result => { cleanup(); if (signal.aborted) reject(signal.reason); else resolve(result); },
      error => { cleanup(); reject(error); },
    );
  });
}

/** Complete admission and binary validation before a caller may begin guarded billing. */
export async function prepareSketchCode(
  value: unknown, dependencies: SketchGenerationDependencies, context: SketchGenerationContext,
): Promise<SketchCodePreparation> {
  context.signal.throwIfAborted();
  const actorUserId = inputString(context.actorUserId, 256);
  const input = parseInput(value);
  const access = Object.freeze({ ...await dependencies.authorizeProject(actorUserId, input.projectId) });
  context.signal.throwIfAborted();
  if (access.kind === 'unscoped' || access.actorUserId !== actorUserId || access.projectId !== input.projectId) throw new SketchInputError('SKETCH_PROJECT_UNAVAILABLE');
  const model = await dependencies.resolveTaskModel(input.providerId, input.modelId, actorUserId);
  context.signal.throwIfAborted();
  if (model.providerId !== input.providerId || model.modelId !== input.modelId || model.kind !== 'chat' || model.supportsVision !== true) throw new SketchInputError('SKETCH_MODEL_UNAVAILABLE');
  const binding: SketchModelBinding = Object.freeze({ providerId: model.providerId, modelId: model.modelId });
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.imageDataUrl);
  if (!match) throw new SketchInputError('SKETCH_IMAGE_INVALID');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > MAX_PNG_BYTES || bytes.toString('base64') !== match[1]) throw new SketchInputError('SKETCH_IMAGE_INVALID');
  let dimensions: Awaited<ReturnType<typeof inspectBinaryImage>>;
  try { dimensions = await inspectBinaryImage(bytes, 'image/png', context.signal); }
  catch (error) {
    if (error instanceof TypeError && ['ASSET_BINARY_FORMAT_INVALID', 'ASSET_BYTES_INVALID'].includes(error.message)) throw new SketchInputError('SKETCH_IMAGE_INVALID', error.message);
    throw error;
  }
  if (dimensions.width > 2048 || dimensions.height > 2048) throw new SketchInputError('SKETCH_IMAGE_LIMIT');
  context.signal.throwIfAborted();
  const analyze = dependencies.analyze.bind(dependencies);
  const reconstruct = dependencies.reconstruct.bind(dependencies);
  const compute = async (executionSignal: AbortSignal, onPhase?: SketchPhaseCallback): Promise<SketchCodeDraft> => {
    executionSignal.throwIfAborted();
    await onPhase?.('analysis'); executionSignal.throwIfAborted();
    const analysisResponse = normalizeSketchStageResponse(await runStage(
      signal => analyze(input.imageDataUrl, input.instruction, binding, signal), executionSignal,
    ));
    const analysis = parseAnalysis(parseModelJson(analysisResponse.content));
    executionSignal.throwIfAborted();
    await onPhase?.('reconstruction'); executionSignal.throwIfAborted();
    const reconstructionResponse = normalizeSketchStageResponse(await runStage(signal => reconstruct(analysis, binding, signal), executionSignal));
    const tree = parseModelJson(reconstructionResponse.content);
    executionSignal.throwIfAborted();
    // Validate before preserving the JSON source; never label an arbitrary
    // model string or a type assertion as safe compilation provenance.
    compileSketchHtml(tree);
    const uiTree = freezeJson(structuredClone(tree));
    const usage = aggregateSketchUsage(analysisResponse.usage ?? null, reconstructionResponse.usage ?? null);
    return { analysis, html: compileSketchHtml(uiTree), uiTree, ...(usage ? { usage } : {}) };
  };
  return Object.freeze({ input, binding, access, compute });
}

/** Two-stage compute only. No task store, billing, persistence, retries or implicit fallback. */
export async function generateSketchCode(
  value: unknown, dependencies: SketchGenerationDependencies, context: SketchGenerationContext,
): Promise<SketchCodeDraft> {
  const prepared = await prepareSketchCode(value, dependencies, context);
  return prepared.compute(context.signal);
}
