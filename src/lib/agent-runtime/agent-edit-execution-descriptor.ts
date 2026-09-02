import { createHash } from 'node:crypto';

const MAX_DESCRIPTOR_BYTES = 64 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ALLOWED_KEYS = new Set([
  'sourceVersionId', 'maskVersionId', 'prompt', 'imagePrompt',
  'providerId', 'modelId', 'imageProviderId', 'imageModelId',
  'maxRounds', 'quality', 'aspectRatio',
]);

export interface AgentEditExecutionDescriptorV1 {
  version: 1;
  sourceVersionId: string;
  maskVersionId?: string;
  prompt: string;
  imagePrompt?: string;
  providerId: string;
  modelId: string;
  imageProviderId: string;
  imageModelId: string;
  maxRounds: number;
  quality?: string;
  aspectRatio?: string;
}

export interface AgentEditExecutionContinuationV1 {
  kind: 'agent-edit';
  version: 1;
  descriptorDigest: string;
}

export class AgentEditExecutionDescriptorError extends Error {
  readonly code = 'AGENT_EDIT_EXECUTION_DESCRIPTOR_INVALID';

  constructor(message = 'Agent edit execution descriptor is invalid') {
    super(message);
    this.name = 'AgentEditExecutionDescriptorError';
  }
}

function requiredString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maxLength || value.includes('\0')) {
    throw new AgentEditExecutionDescriptorError(`${name} is invalid`);
  }
  if (/data:[^,]*;base64,/i.test(value)) {
    throw new AgentEditExecutionDescriptorError(`${name} must not contain inline data`);
  }
  return value;
}

function identifier(value: unknown, name: string): string {
  const normalized = requiredString(value, name, 256);
  if (!IDENTIFIER.test(normalized) || /^https?:/i.test(normalized)) {
    throw new AgentEditExecutionDescriptorError(`${name} is invalid`);
  }
  return normalized;
}

function optionalString(value: unknown, name: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : requiredString(value, name, maxLength);
}

export function createAgentEditExecutionDescriptorV1(
  input: Omit<AgentEditExecutionDescriptorV1, 'version'>,
): AgentEditExecutionDescriptorV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AgentEditExecutionDescriptorError();
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !ALLOWED_KEYS.has(key)) {
      throw new AgentEditExecutionDescriptorError('Descriptor contains an unknown field');
    }
  }
  const maxRounds = input.maxRounds;
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 8) {
    throw new AgentEditExecutionDescriptorError('maxRounds is invalid');
  }
  const descriptor: AgentEditExecutionDescriptorV1 = {
    version: 1,
    sourceVersionId: identifier(input.sourceVersionId, 'sourceVersionId'),
    ...(input.maskVersionId === undefined
      ? {} : { maskVersionId: identifier(input.maskVersionId, 'maskVersionId') }),
    prompt: requiredString(input.prompt, 'prompt', 16_384),
    ...(input.imagePrompt === undefined
      ? {} : { imagePrompt: optionalString(input.imagePrompt, 'imagePrompt', 16_384) }),
    providerId: identifier(input.providerId, 'providerId'),
    modelId: identifier(input.modelId, 'modelId'),
    imageProviderId: identifier(input.imageProviderId, 'imageProviderId'),
    imageModelId: identifier(input.imageModelId, 'imageModelId'),
    maxRounds,
    ...(input.quality === undefined ? {} : { quality: identifier(input.quality, 'quality') }),
    ...(input.aspectRatio === undefined
      ? {} : { aspectRatio: requiredString(input.aspectRatio, 'aspectRatio', 32) }),
  };
  if (Buffer.byteLength(JSON.stringify(descriptor), 'utf8') > MAX_DESCRIPTOR_BYTES) {
    throw new AgentEditExecutionDescriptorError('Descriptor exceeds the size limit');
  }
  return descriptor;
}

export function digestAgentEditExecutionDescriptor(
  descriptor: AgentEditExecutionDescriptorV1,
): string {
  const { version, ...input } = descriptor;
  if (version !== 1) throw new AgentEditExecutionDescriptorError('Descriptor version is unknown');
  const canonical = createAgentEditExecutionDescriptorV1(input);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function parseAgentEditExecutionContinuation(
  rawContinuation: unknown,
  rawDescriptor: unknown,
): AgentEditExecutionDescriptorV1 {
  if (!rawContinuation || typeof rawContinuation !== 'object' || Array.isArray(rawContinuation)) {
    throw new AgentEditExecutionDescriptorError('Continuation is missing');
  }
  const continuation = rawContinuation as Record<string, unknown>;
  if (
    continuation.kind !== 'agent-edit'
    || continuation.version !== 1
    || continuation.rootToolId !== 'agent_edit'
    || typeof continuation.descriptorDigest !== 'string'
    || !DIGEST.test(continuation.descriptorDigest)
  ) {
    throw new AgentEditExecutionDescriptorError('Continuation reference is invalid');
  }
  if (!rawDescriptor || typeof rawDescriptor !== 'object' || Array.isArray(rawDescriptor)) {
    throw new AgentEditExecutionDescriptorError('Descriptor is missing');
  }
  const { version, ...descriptorInput } = rawDescriptor as AgentEditExecutionDescriptorV1;
  if (version !== 1) throw new AgentEditExecutionDescriptorError('Descriptor version is unknown');
  const descriptor = createAgentEditExecutionDescriptorV1(descriptorInput);
  if (digestAgentEditExecutionDescriptor(descriptor) !== continuation.descriptorDigest) {
    throw new AgentEditExecutionDescriptorError('Descriptor digest mismatch');
  }
  return descriptor;
}
