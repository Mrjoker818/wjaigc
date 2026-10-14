import 'server-only';
import { inspectBinaryImage } from '@/lib/asset-core/binary-image-validation';
import type { GenerationProjectAccess } from '@/lib/collaboration/generation-project-access';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { SketchGenerationContext, SketchModelBinding } from './generation';
import { freezeSketchImageInput, parseSketchImageAnalysis, buildSketchImageGenerationBody, type SketchImageInput, type SketchImageAnalysis } from './image-contract';
import { parseSketchTokenUsage, type SketchStageResponse } from './usage';
import { sketchFields, sketchHttpId } from './http';
import { runSketchStage } from './stage';

export type SketchImagePhase = 'analysis' | 'generation';
export type SketchImageAnalysisResponse = Readonly<{ analysis: SketchImageAnalysis; usage?: SketchStageResponse['usage'] }>;
export interface SketchImageReceipt {
  readonly taskIds: readonly string[]; readonly directImageUrls: readonly string[];
  readonly usedModel: string; readonly usedProviderId: string;
}
export interface SketchImageDraft extends SketchImageAnalysisResponse { readonly receipt: SketchImageReceipt }
export interface SketchImageExecutionHooks {
  beforePhase(phase: SketchImagePhase): Promise<void>;
  afterAnalysis(response: SketchImageAnalysisResponse): Promise<void>;
}
export interface SketchImageGenerationDependencies {
  authorizeProject(actorUserId: string, projectId: string): Promise<GenerationProjectAccess>;
  resolveTaskModel(providerId: string, modelId: string, actorUserId: string): Promise<TaskModelDescriptor>;
  analyze(imageDataUrl: string, instruction: string, binding: SketchModelBinding, signal: AbortSignal): Promise<unknown>;
  generate(body: Readonly<ReturnType<typeof buildSketchImageGenerationBody>>, binding: SketchModelBinding, signal: AbortSignal): Promise<unknown>;
}
export interface SketchImagePreparation {
  readonly input: Readonly<SketchImageInput>;
  readonly access: Readonly<Exclude<GenerationProjectAccess, { kind: 'unscoped' }>>;
  readonly visionBinding: SketchModelBinding; readonly imageBinding: SketchModelBinding;
  compute(signal: AbortSignal, hooks: SketchImageExecutionHooks): Promise<Readonly<SketchImageDraft>>;
}

function accessSnapshot(value: GenerationProjectAccess, actorUserId: string, projectId: string): SketchImagePreparation['access'] {
  const raw = sketchFields(value, ['kind', 'actorUserId', 'projectId', 'ownerId', 'grantGeneration']);
  if (raw.actorUserId !== actorUserId || raw.projectId !== projectId) throw new Error('SKETCH_IMAGE_PROJECT_UNAVAILABLE');
  const ownerId = sketchHttpId(raw.ownerId);
  if (raw.kind === 'personal' && ownerId === actorUserId && Object.keys(raw).length === 4) {
    return Object.freeze({ kind: 'personal', actorUserId, projectId, ownerId });
  }
  if (raw.kind === 'document' && Object.keys(raw).length === 5
    && typeof raw.grantGeneration === 'string' && /^(0|[1-9]\d*)$/.test(raw.grantGeneration)) {
    return Object.freeze({ kind: 'document', actorUserId, projectId, ownerId, grantGeneration: sketchHttpId(raw.grantGeneration) });
  }
  throw new Error('SKETCH_IMAGE_PROJECT_UNAVAILABLE');
}
function analysisResponse(value: unknown): SketchImageAnalysisResponse {
  const raw = sketchFields(value, ['analysis', 'usage']);
  return Object.freeze({ analysis: parseSketchImageAnalysis(raw.analysis),
    ...(Object.hasOwn(raw, 'usage') ? { usage: parseSketchTokenUsage(raw.usage) } : {}) });
}
function receiptStrings(value: unknown): string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 1
    || Reflect.ownKeys(value).length !== value.length + 1) throw new Error('SKETCH_IMAGE_RECEIPT_INVALID');
  const result: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property) || typeof property.value !== 'string' || !property.value
      || /\p{Cc}/u.test(property.value)) throw new Error('SKETCH_IMAGE_RECEIPT_INVALID');
    result.push(property.value as string);
  }
  return result;
}
/** Receipt is an unpublished draft, never media safety or completion authority. */
function imageReceipt(value: unknown, binding: SketchModelBinding): Readonly<SketchImageReceipt> {
  const raw = sketchFields(value, ['taskIds', 'directImageUrls', 'usedModel', 'usedProviderId']);
  const taskIds = receiptStrings(raw.taskIds), directImageUrls = receiptStrings(raw.directImageUrls);
  if (raw.usedModel !== binding.modelId || raw.usedProviderId !== binding.providerId || taskIds.length + directImageUrls.length !== 1) {
    throw new Error('SKETCH_IMAGE_RECEIPT_INVALID');
  }
  taskIds.forEach(sketchHttpId);
  for (const url of directImageUrls) {
    if (url.length > Math.ceil(32 * 1024 * 1024 / 3) * 4 + 80) throw new Error('SKETCH_IMAGE_RECEIPT_INVALID');
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) continue;
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('SKETCH_IMAGE_RECEIPT_INVALID'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('SKETCH_IMAGE_RECEIPT_INVALID');
  }
  return Object.freeze({ taskIds: Object.freeze(taskIds), directImageUrls: Object.freeze(directImageUrls),
    usedModel: binding.modelId, usedProviderId: binding.providerId });
}
/** Private durable restoration shares validation, not submission or asset authority. */
export function parseStoredSketchImageReceipt(value: unknown, binding: SketchModelBinding): Readonly<SketchImageReceipt> { return imageReceipt(value, binding); }
function executionHooks(value: SketchImageExecutionHooks): SketchImageExecutionHooks {
  try {
    const raw = sketchFields(value, ['beforePhase', 'afterAnalysis']);
    if (typeof raw.beforePhase !== 'function' || typeof raw.afterAnalysis !== 'function') throw new Error();
    return Object.freeze({ beforePhase: (raw.beforePhase as SketchImageExecutionHooks['beforePhase']).bind(value),
      afterAnalysis: (raw.afterAnalysis as SketchImageExecutionHooks['afterAnalysis']).bind(value) });
  } catch { throw new Error('SKETCH_IMAGE_EXECUTION_HOOKS_REQUIRED'); }
}
async function checkpoint(operation: () => Promise<void>, signal: AbortSignal): Promise<void> {
  // Only this deadline's own error denotes a lost ACK. Callback exceptions,
  // including identical messages and their causes, propagate unchanged.
  await runSketchStage(() => operation(), signal, 10_000, new Error('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED'));
}
/** Decode and resolve admission only. Trusted task hooks remain mandatory; the
 * original worker must fence its own charge/lease/checkpoint and publication. */
export async function prepareSketchImage(value: unknown, dependencies: SketchImageGenerationDependencies,
  context: SketchGenerationContext): Promise<SketchImagePreparation> {
  context.signal.throwIfAborted();
  const raw = sketchFields(value, ['projectId', 'imageDataUrl', 'instruction', 'visionProviderId', 'visionModelId',
    'imageProviderId', 'imageModelId', 'idempotencyKey', 'aspectRatio', 'size', 'quality']);
  const actorUserId = sketchHttpId(context.actorUserId), projectId = sketchHttpId(raw.projectId);
  const visionProviderId = sketchHttpId(raw.visionProviderId), visionModelId = sketchHttpId(raw.visionModelId);
  const imageProviderId = sketchHttpId(raw.imageProviderId), imageModelId = sketchHttpId(raw.imageModelId);
  const access = accessSnapshot(await dependencies.authorizeProject(actorUserId, projectId), actorUserId, projectId);
  context.signal.throwIfAborted();
  const vision = await dependencies.resolveTaskModel(visionProviderId, visionModelId, actorUserId);
  context.signal.throwIfAborted();
  const image = await dependencies.resolveTaskModel(imageProviderId, imageModelId, actorUserId);
  context.signal.throwIfAborted();
  const input = freezeSketchImageInput(raw, vision, image);
  const bytes = Buffer.from(input.imageDataUrl.slice('data:image/png;base64,'.length), 'base64');
  try {
    const dimensions = await inspectBinaryImage(bytes, 'image/png', context.signal);
    if (dimensions.width > 2048 || dimensions.height > 2048) throw new Error('SKETCH_IMAGE_DECODE_INVALID');
  } catch (error) {
    context.signal.throwIfAborted(); throw new Error('SKETCH_IMAGE_DECODE_INVALID', { cause: error });
  }
  context.signal.throwIfAborted();
  const visionBinding = Object.freeze({ providerId: input.visionProviderId, modelId: input.visionModelId });
  const imageBinding = Object.freeze({ providerId: input.imageProviderId, modelId: input.imageModelId });
  const analyze = dependencies.analyze.bind(dependencies), generate = dependencies.generate.bind(dependencies);
  const compute = async (signal: AbortSignal, suppliedHooks: SketchImageExecutionHooks): Promise<Readonly<SketchImageDraft>> => {
    signal.throwIfAborted(); const hooks = executionHooks(suppliedHooks);
    await checkpoint(() => hooks.beforePhase('analysis'), signal); signal.throwIfAborted();
    const response = analysisResponse(await runSketchStage(
      actual => analyze(input.imageDataUrl, input.instruction, visionBinding, actual), signal, 60_000));
    signal.throwIfAborted(); await checkpoint(() => hooks.afterAnalysis(response), signal); signal.throwIfAborted();
    await checkpoint(() => hooks.beforePhase('generation'), signal); signal.throwIfAborted();
    const body = buildSketchImageGenerationBody(input, response.analysis);
    Object.freeze(body.referenceImages); Object.freeze(body.referenceDescriptions); Object.freeze(body);
    const receipt = imageReceipt(await runSketchStage(actual => generate(body, imageBinding, actual), signal, 120_000), imageBinding);
    signal.throwIfAborted(); return Object.freeze({ ...response, receipt });
  };
  return Object.freeze({ input, access, visionBinding, imageBinding, compute });
}
