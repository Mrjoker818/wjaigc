import { isAssetVersionId } from '@/lib/asset-core/asset-version-id';
import type { MultiPlatformExportInput } from './types';

const MAX_SERIALIZED_INPUT_BYTES = 16_384;
const MAX_SOURCE_COUNT = 20;
const MAX_TARGET_COUNT = 20;
const MAX_NAMING_TEMPLATE_LENGTH = 160;
const INPUT_FIELDS = new Set([
  'sourceAssetVersionIds',
  'targetPresetIds',
  'fit',
  'background',
  'namingTemplate',
]);
const TEMPLATE_TOKEN = /\{([^{}]+)\}/g;
const ALLOWED_TEMPLATE_TOKENS = new Set([
  'project', 'asset', 'platform', 'usage', 'size', 'index',
]);
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const PRESET_REFERENCE = /^([a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?)-v([1-9]\d{0,9})$/;

export class MultiPlatformExportInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'MultiPlatformExportInputError';
  }
}

function fail(code: string): never {
  throw new MultiPlatformExportInputError(code);
}

function serializedByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8');
  } catch {
    return MAX_SERIALIZED_INPUT_BYTES + 1;
  }
}

function normalizeUniqueIds(
  value: unknown,
  options: {
    minimum: number;
    maximum: number;
    countCode: string;
    invalidCode: string;
    duplicateCode: string;
    validate: (id: string) => boolean;
  },
): string[] {
  if (!Array.isArray(value) || value.length < options.minimum || value.length > options.maximum) {
    return fail(options.countCode);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') fail(options.invalidCode);
    const id = candidate.trim();
    if (!options.validate(id)) fail(options.invalidCode);
    if (seen.has(id)) fail(options.duplicateCode);
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function normalizeNamingTemplate(value: unknown): string {
  if (typeof value !== 'string') fail('EXPORT_NAMING_TEMPLATE_INVALID');
  const template = value.trim();
  if (!template || template.length > MAX_NAMING_TEMPLATE_LENGTH || /[\u0000-\u001f\u007f]/.test(template)) {
    fail('EXPORT_NAMING_TEMPLATE_INVALID');
  }
  const withoutKnownTokens = template.replace(TEMPLATE_TOKEN, (_match, token: string) => {
    if (!ALLOWED_TEMPLATE_TOKENS.has(token)) fail('EXPORT_NAMING_TEMPLATE_INVALID');
    return '';
  });
  if (/[{}]/.test(withoutKnownTokens)) fail('EXPORT_NAMING_TEMPLATE_INVALID');
  return template;
}

function isPresetReference(value: string): boolean {
  const match = PRESET_REFERENCE.exec(value);
  if (!match) return false;
  const version = Number(match[2]);
  return Number.isSafeInteger(version) && version <= MAX_POSTGRES_INTEGER;
}

export function parseMultiPlatformExportInput(value: unknown): MultiPlatformExportInput {
  if (serializedByteLength(value) > MAX_SERIALIZED_INPUT_BYTES) {
    fail('EXPORT_INPUT_SERIALIZED_LIMIT_EXCEEDED');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('EXPORT_INPUT_INVALID');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !INPUT_FIELDS.has(key))) {
    fail('EXPORT_INPUT_UNKNOWN_FIELD');
  }

  const sourceAssetVersionIds = normalizeUniqueIds(record.sourceAssetVersionIds, {
    minimum: 1,
    maximum: MAX_SOURCE_COUNT,
    countCode: 'EXPORT_SOURCE_COUNT_INVALID',
    invalidCode: 'EXPORT_SOURCE_ID_INVALID',
    duplicateCode: 'EXPORT_SOURCE_ID_DUPLICATE',
    validate: isAssetVersionId,
  });
  const targetPresetIds = normalizeUniqueIds(record.targetPresetIds, {
    minimum: 1,
    maximum: MAX_TARGET_COUNT,
    countCode: 'EXPORT_TARGET_COUNT_INVALID',
    invalidCode: 'EXPORT_TARGET_ID_INVALID',
    duplicateCode: 'EXPORT_TARGET_ID_DUPLICATE',
    validate: isPresetReference,
  });
  if (record.fit !== 'cover' && record.fit !== 'contain') fail('EXPORT_FIT_INVALID');

  let background: MultiPlatformExportInput['background'];
  if (record.background === 'transparent') {
    background = 'transparent';
  } else if (typeof record.background === 'string' && /^#[a-fA-F0-9]{8}$/.test(record.background)) {
    background = record.background.toLowerCase() as `#${string}`;
  } else {
    fail('EXPORT_BACKGROUND_INVALID');
  }

  return {
    sourceAssetVersionIds,
    targetPresetIds,
    fit: record.fit,
    background,
    namingTemplate: normalizeNamingTemplate(record.namingTemplate),
  };
}
