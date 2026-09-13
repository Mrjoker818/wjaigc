import { createHash } from 'node:crypto';

import { validateAspectRatio, validateImageUrl } from '@/lib/input-validation';
import { GatewayError } from '@/lib/media-gateway/types';

const MAX_PROMPT_LENGTH = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REFERENCE_IMAGES = 16;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]*[A-Za-z0-9])?$/;
const SECRET_FIELD_PATTERN = /^(?:api[_-]?key|authorization|gateway[_-]?key|key[_-]?hash|provider[_-]?(?:api[_-]?)?key|secret)$/i;
const IMAGE_REQUEST_FIELDS = new Set([
  'prompt', 'providerId', 'modelId', 'projectId', 'n', 'aspectRatio', 'size', 'quality', 'resolution', 'referenceImages',
  'apiKey', 'sourceChannel',
]);
const VIDEO_REQUEST_FIELDS = new Set([
  'prompt', 'providerId', 'modelId', 'projectId', 'duration', 'aspectRatio', 'firstFrameImageUrl',
  'lastFrameImageUrl', 'referenceImages', 'apiKey', 'sourceChannel',
]);

export interface GatewayImageRequest {
  prompt: string;
  providerId: string;
  modelId: string;
  projectId: string;
  n?: number;
  aspectRatio?: string;
  size?: string;
  quality?: string;
  resolution?: string;
  referenceImages?: string[];
}

export interface GatewayVideoRequest {
  prompt: string;
  providerId: string;
  modelId: string;
  projectId: string;
  duration?: number;
  aspectRatio?: string;
  firstFrameImageUrl?: string;
  lastFrameImageUrl?: string;
  referenceImages?: string[];
}

function invalidRequest(message = 'Gateway request is invalid'): GatewayError {
  return new GatewayError('GATEWAY_INVALID_REQUEST', 400, message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRequest();
  }
  return value as Record<string, unknown>;
}

function assertAllowedFields(
  input: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): void {
  if (Object.keys(input).some(field => !allowedFields.has(field))) {
    throw invalidRequest('Gateway request contains an undeclared field');
  }
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') throw invalidRequest(`${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw invalidRequest(`${field} is invalid`);
  }
  return normalized;
}

function identifier(value: unknown, field: string): string {
  const normalized = boundedText(value, field, MAX_IDENTIFIER_LENGTH);
  if (!IDENTIFIER_PATTERN.test(normalized) || normalized.includes('..')) {
    throw invalidRequest(`${field} is invalid`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  field: string,
  maximum: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return boundedText(value, field, maximum);
}

function imageUrl(value: unknown, field: string): string {
  const error = validateImageUrl(value, field);
  if (error) throw invalidRequest(error);
  return (value as string).trim();
}

function optionalImageUrl(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return imageUrl(value, field);
}

function referenceImages(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > MAX_REFERENCE_IMAGES) {
    throw invalidRequest('referenceImages is invalid');
  }
  return value.map((entry, index) => imageUrl(entry, `referenceImages[${index}]`));
}

function aspectRatio(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalidRequest('aspectRatio is invalid');
  const error = validateAspectRatio(value);
  if (error) throw invalidRequest(error);
  return value.trim();
}

function assignDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

export function normalizeGatewayImageRequest(value: unknown): GatewayImageRequest {
  const input = asRecord(value);
  assertAllowedFields(input, IMAGE_REQUEST_FIELDS);
  const output: GatewayImageRequest = {
    prompt: boundedText(input.prompt, 'prompt', MAX_PROMPT_LENGTH),
    providerId: identifier(input.providerId, 'providerId'),
    modelId: identifier(input.modelId, 'modelId'),
    projectId: identifier(input.projectId, 'projectId'),
  };

  if (input.n !== undefined) {
    if (!Number.isInteger(input.n) || Number(input.n) < 1 || Number(input.n) > 4) {
      throw invalidRequest('n is invalid');
    }
    output.n = Number(input.n);
  }
  assignDefined(output, 'aspectRatio', aspectRatio(input.aspectRatio));
  const size = optionalText(input.size, 'size', 50);
  if (size !== undefined && !/^(?:auto|\d{1,5}x\d{1,5}|\d{1,3}:\d{1,3})$/.test(size)) {
    throw invalidRequest('size is invalid');
  }
  assignDefined(output, 'size', size);
  assignDefined(output, 'quality', optionalText(input.quality, 'quality', 50));
  const resolution = optionalText(input.resolution, 'resolution', 10);
  if (resolution !== undefined && !/^[124]K$/i.test(resolution)) {
    throw invalidRequest('resolution is invalid');
  }
  assignDefined(output, 'resolution', resolution?.toUpperCase());
  assignDefined(output, 'referenceImages', referenceImages(input.referenceImages));
  return output;
}

export function normalizeGatewayVideoRequest(value: unknown): GatewayVideoRequest {
  const input = asRecord(value);
  assertAllowedFields(input, VIDEO_REQUEST_FIELDS);
  const output: GatewayVideoRequest = {
    prompt: boundedText(input.prompt, 'prompt', MAX_PROMPT_LENGTH),
    providerId: identifier(input.providerId, 'providerId'),
    modelId: identifier(input.modelId, 'modelId'),
    projectId: identifier(input.projectId, 'projectId'),
  };

  if (input.duration !== undefined) {
    if (!Number.isInteger(input.duration) || Number(input.duration) < 1 || Number(input.duration) > 600) {
      throw invalidRequest('duration is invalid');
    }
    output.duration = Number(input.duration);
  }
  assignDefined(output, 'aspectRatio', aspectRatio(input.aspectRatio));
  assignDefined(output, 'firstFrameImageUrl', optionalImageUrl(input.firstFrameImageUrl, 'firstFrameImageUrl'));
  assignDefined(output, 'lastFrameImageUrl', optionalImageUrl(input.lastFrameImageUrl, 'lastFrameImageUrl'));
  assignDefined(output, 'referenceImages', referenceImages(input.referenceImages));
  return output;
}

function canonicalize(value: unknown, ancestors: Set<object>): unknown {
  if (typeof value === 'string') return value.trim();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidRequest();
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw invalidRequest();
    ancestors.add(value);
    const result = value.map((entry) => canonicalize(entry, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) throw invalidRequest();
    ancestors.add(value);
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (SECRET_FIELD_PATTERN.test(key) || source[key] === undefined) continue;
      result[key] = canonicalize(source[key], ancestors);
    }
    ancestors.delete(value);
    return result;
  }
  throw invalidRequest();
}

export function digestGatewayRequest(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value, new Set<object>()));
  return createHash('sha256').update(canonical).digest('hex');
}
