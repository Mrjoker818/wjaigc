import type { SkillBillingContext } from '@/lib/skill-runtime/billing-authorization';
import {
  AgentDownstreamProviderRejectedError,
  AgentDownstreamSubmissionUnknownError,
} from '@/lib/agent-runtime/downstream-operations';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { validateTaskModelSelection } from '@/lib/task-core/model-capability-resolution';
import { parseBriefToVideoInput, parseBriefToVideoPlan } from './schema';
import type { BriefToVideoInput, BriefToVideoPlanV1 } from './types';

interface BriefVideoStepOutput {
  stepId: string;
  kind: 'text' | 'html' | 'json';
  schemaId?: string;
  content: string;
}

export interface ExecuteBriefToVideoStepInput {
  actorUserId: string;
  actorRole: 'user' | 'admin';
  projectId: string;
  workspaceId: string;
  runId: string;
  stepId: string;
  requestDigest: string;
  idempotencyKey: string;
  operationKey: string;
  executionFence: SkillBillingContext['executionFence'];
  inputValues: Record<string, unknown>;
  previousOutputs: readonly BriefVideoStepOutput[];
  modelBinding: FrozenBriefVideoBinding;
  sourceImageUrls: Readonly<Record<string, string>>;
  signal: AbortSignal;
  recordLocalAccepted(taskId: string): Promise<unknown>;
}

export interface ExecuteBriefToVideoStepDependencies {
  submit(submission: BriefVideoSubmission, input: ExecuteBriefToVideoStepInput): Promise<Response>;
  monitor(taskId: string, input: ExecuteBriefToVideoStepInput): Promise<{ assetVersionIds: readonly string[] }>;
}

export class BriefToVideoVideoAdmissionError extends Error {
  readonly code = 'BRIEF_VIDEO_MODEL_CAPABILITY_MISMATCH';
  readonly status = 400;
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'BriefToVideoVideoAdmissionError';
  }
}

export interface FrozenBriefVideoBinding {
  providerId: string;
  modelId: string;
  descriptor: TaskModelDescriptor;
}

export interface BriefVideoSubmission {
  endpoint: '/api/video/generate';
  headers: { 'content-type': 'application/json'; 'idempotency-key': string };
  body: Record<string, unknown>;
  input: BriefToVideoInput;
}

export interface BriefVideoSubmissionDependencies {
  submit(signal: AbortSignal): Promise<Response>;
  recordLocalAccepted(taskId: string): Promise<unknown>;
  monitor(taskId: string): Promise<unknown>;
  responseTimeoutMs?: number;
}

const VIDEO_OPERATIONS = new Set([
  'text-to-video', 'image-to-video', 'first-last-frame', 'multi-reference', 'video-extend',
]);
const API_KINDS = new Set([
  'image', 'chat', 'universal', 'general', '3d', 'vectorize', 'layer', 'video', 'vlm',
  'imageEdit', 'upscaler', 'removebg', 'audio',
]);
const CAPABILITY_SOURCES = new Set(['admin', 'adapter', 'discovery', 'fallback']);

function frozenCapabilityError(): never {
  throw new BriefToVideoVideoAdmissionError('Frozen Brief video capability is invalid');
}

function boundedString(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function boundedStrings(value: unknown, maximumItems = 128): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems
    && value.every(item => boundedString(item, 256));
}

export function parseFrozenBriefVideoBinding(
  value: unknown,
  expected: { providerId: string; modelId: string },
): FrozenBriefVideoBinding {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    frozenCapabilityError();
  }
  if (!serialized! || Buffer.byteLength(serialized!, 'utf8') > 65_536
    || !value || typeof value !== 'object' || Array.isArray(value)) frozenCapabilityError();
  const raw = value as Record<string, unknown>;
  if (!boundedString(raw.providerId) || !boundedString(raw.modelId)
    || raw.providerId !== expected.providerId || raw.modelId !== expected.modelId
    || raw.kind !== 'video' || !API_KINDS.has(String(raw.sourceType))
    || !boundedString(raw.protocol, 128) || !['sync', 'async'].includes(String(raw.executionMode))
    || !boundedStrings(raw.allowedRatios) || !boundedStrings(raw.allowedSizes)
    || !boundedStrings(raw.qualityOptions) || !boundedStrings(raw.outputKinds)
    || !Number.isSafeInteger(raw.maxOutputs) || Number(raw.maxOutputs) < 1 || Number(raw.maxOutputs) > 100
    || typeof raw.supportsReferenceImages !== 'boolean' || typeof raw.supportsMask !== 'boolean') {
    frozenCapabilityError();
  }
  if (raw.supportsVision !== undefined && typeof raw.supportsVision !== 'boolean') frozenCapabilityError();
  if (raw.maxReferenceImages !== undefined && (!Number.isSafeInteger(raw.maxReferenceImages)
    || Number(raw.maxReferenceImages) < 0 || Number(raw.maxReferenceImages) > 100)) frozenCapabilityError();
  if (raw.allowedDurationsSeconds !== undefined && (!Array.isArray(raw.allowedDurationsSeconds)
    || raw.allowedDurationsSeconds.length > 128 || raw.allowedDurationsSeconds.some(item => (
      !Number.isSafeInteger(item) || Number(item) < 1 || Number(item) > 3_600
    )))) frozenCapabilityError();
  if (raw.maxDurationSeconds !== undefined && (!Number.isSafeInteger(raw.maxDurationSeconds)
    || Number(raw.maxDurationSeconds) < 1 || Number(raw.maxDurationSeconds) > 3_600)) frozenCapabilityError();
  if (raw.supportedOperations !== undefined && (!boundedStrings(raw.supportedOperations)
    || raw.supportedOperations.some(item => !VIDEO_OPERATIONS.has(item)))) frozenCapabilityError();
  if (!raw.capabilitySources || typeof raw.capabilitySources !== 'object'
    || Array.isArray(raw.capabilitySources)
    || Object.values(raw.capabilitySources).some(source => !CAPABILITY_SOURCES.has(String(source)))) {
    frozenCapabilityError();
  }
  const descriptor = structuredClone(raw) as unknown as TaskModelDescriptor;
  return { providerId: expected.providerId, modelId: expected.modelId, descriptor };
}

async function readBoundedJson(response: Response, timeoutMs: number): Promise<Record<string, unknown>> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new TypeError('Brief video submission did not return JSON');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('Brief video submission body is unavailable');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Brief video submission response timed out')), timeoutMs);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw new Error('Brief video submission response is too large');
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('Brief video submission response is invalid');
    }
    return parsed as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

export async function submitBriefToVideoTask(
  submission: BriefVideoSubmission,
  dependencies: BriefVideoSubmissionDependencies,
): Promise<string> {
  const controller = new AbortController();
  let response: Response;
  try {
    response = await dependencies.submit(controller.signal);
  } catch (error) {
    throw new AgentDownstreamSubmissionUnknownError(error);
  }
  if (!response.ok) {
    controller.abort();
    throw new AgentDownstreamProviderRejectedError(response.status, {
      message: `Brief video task was rejected with HTTP ${response.status}`,
    });
  }
  let taskId: string;
  try {
    const payload = await readBoundedJson(response, dependencies.responseTimeoutMs ?? 10_000);
    taskId = typeof payload.taskId === 'string' ? payload.taskId.trim() : '';
    if (!taskId || taskId.length > 256) throw new TypeError('Brief video task ID is invalid');
    await dependencies.recordLocalAccepted(taskId);
  } catch (error) {
    controller.abort(error);
    throw new AgentDownstreamSubmissionUnknownError(error);
  }
  await dependencies.monitor(taskId);
  return taskId;
}

function sourceUrl(versionId: string | undefined, sources: Readonly<Record<string, string>>): string | undefined {
  if (!versionId) return undefined;
  const url = sources[versionId];
  if (typeof url !== 'string' || !url.trim()) {
    throw new BriefToVideoVideoAdmissionError('Authorized Brief video source is unavailable');
  }
  return url;
}

export function buildBriefToVideoVideoSubmission(input: {
  runId: string;
  stepId: string;
  projectId: string;
  workspaceId: string;
  idempotencyKey: string;
  modelBinding: FrozenBriefVideoBinding;
  plan: BriefToVideoPlanV1;
  input: BriefToVideoInput;
  sourceImageUrls: Readonly<Record<string, string>>;
  skillBillingContext: SkillBillingContext;
}): BriefVideoSubmission {
  const brief = parseBriefToVideoInput(input.input);
  const plan = parseBriefToVideoPlan(input.plan);
  const { descriptor, providerId, modelId } = input.modelBinding;
  if (descriptor.kind !== 'video' || descriptor.providerId !== providerId || descriptor.modelId !== modelId) {
    throw new BriefToVideoVideoAdmissionError('Frozen Brief video model binding is invalid');
  }
  if (plan.durationSeconds !== brief.durationSeconds || plan.aspectRatio !== brief.aspectRatio) {
    throw new BriefToVideoVideoAdmissionError('Approved plan no longer matches the frozen Brief inputs');
  }
  const imageUrl = sourceUrl(brief.startFrame, input.sourceImageUrls);
  const lastFrameImageUrl = sourceUrl(brief.endFrame, input.sourceImageUrls);
  const operation = lastFrameImageUrl
    ? 'first-last-frame' as const
    : imageUrl
      ? 'image-to-video' as const
      : 'text-to-video' as const;
  const admission = validateTaskModelSelection(descriptor, {
    operation,
    aspectRatio: brief.aspectRatio,
    size: brief.resolution,
    durationSeconds: brief.durationSeconds,
    referenceImageCount: Number(Boolean(imageUrl)) + Number(Boolean(lastFrameImageUrl)),
  });
  if (!admission.ok) {
    throw new BriefToVideoVideoAdmissionError(`Frozen video capability rejected ${admission.error.field}`);
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 256
    || input.skillBillingContext.runId !== input.runId
    || input.skillBillingContext.stepId !== input.stepId) {
    throw new BriefToVideoVideoAdmissionError('Brief video operation identity is invalid');
  }
  return {
    endpoint: '/api/video/generate',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey },
    input: brief,
    body: {
      prompt: plan.finalVideoPrompt,
      negativePrompt: plan.negativePrompt,
      providerId,
      model: `${providerId}::${modelId}`,
      duration: brief.durationSeconds,
      aspectRatio: brief.aspectRatio,
      ...(brief.resolution ? { resolution: brief.resolution } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(lastFrameImageUrl ? { lastFrameImageUrl } : {}),
      generateAudio: brief.generateAudio,
      projectId: input.projectId,
      sessionId: input.workspaceId,
      skillRunId: input.runId,
      skillStepId: input.stepId,
      skillBillingContext: input.skillBillingContext,
    },
  };
}

function approvedBriefVideoPlan(outputs: readonly BriefVideoStepOutput[]): BriefToVideoPlanV1 {
  const plans = outputs.filter(output => (
    output.kind === 'json' && output.schemaId === 'brief-to-video-plan-v1'
  ));
  if (plans.length !== 1) {
    throw Object.assign(new Error('Approved Brief video plan is missing'), {
      code: 'BRIEF_VIDEO_PLAN_MISSING',
    });
  }
  try {
    return parseBriefToVideoPlan(JSON.parse(plans[0].content));
  } catch (error) {
    throw Object.assign(new Error('Approved Brief video plan is invalid', { cause: error }), {
      code: 'BRIEF_VIDEO_PLAN_INVALID',
    });
  }
}

export async function executeBriefToVideoStep(
  input: ExecuteBriefToVideoStepInput,
  dependencies: ExecuteBriefToVideoStepDependencies,
): Promise<{ assetVersionIds: readonly string[]; media: readonly Record<string, never>[] }> {
  input.signal.throwIfAborted();
  const submission = buildBriefToVideoVideoSubmission({
    runId: input.runId,
    stepId: input.stepId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    idempotencyKey: input.idempotencyKey,
    modelBinding: input.modelBinding,
    plan: approvedBriefVideoPlan(input.previousOutputs),
    input: parseBriefToVideoInput(input.inputValues),
    sourceImageUrls: input.sourceImageUrls,
    skillBillingContext: {
      runId: input.runId,
      stepId: input.stepId,
      requestDigest: input.requestDigest,
      operationKey: input.operationKey,
      executionFence: input.executionFence,
    },
  });
  const taskId = await submitBriefToVideoTask(submission, {
    submit: signal => dependencies.submit(submission, { ...input, signal }),
    recordLocalAccepted: input.recordLocalAccepted,
    monitor: async () => undefined,
  });
  const completed = await dependencies.monitor(taskId, input);
  return {
    assetVersionIds: completed.assetVersionIds,
    media: completed.assetVersionIds.map(() => ({})),
  };
}
