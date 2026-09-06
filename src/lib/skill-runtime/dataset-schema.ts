const ALLOWED_SKU_FIELDS = new Set(['sku', 'name', 'sellingPoints', 'variant', 'headline']);
const FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/u;

export type SkillDatasetSchemaErrorCode =
  | 'SKILL_DATASET_DUPLICATE_SKU'
  | 'SKILL_DATASET_UNKNOWN_FIELD'
  | 'SKILL_DATASET_INVALID_ROW'
  | 'SKILL_DATASET_FORMULA_VALUE';

export class SkillDatasetSchemaError extends Error {
  constructor(readonly code: SkillDatasetSchemaErrorCode) {
    super(code);
    this.name = 'SkillDatasetSchemaError';
  }
}

export interface NormalizedSkuRow {
  sku: string;
  name: string;
  sellingPoints?: string;
  variant?: string;
  headline?: string;
}

function normalizedText(
  row: Record<string, unknown>,
  key: keyof NormalizedSkuRow,
  maximum: number,
  required: boolean,
): string | undefined {
  const value = row[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') throw new SkillDatasetSchemaError('SKILL_DATASET_INVALID_ROW');
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximum) {
    throw new SkillDatasetSchemaError('SKILL_DATASET_INVALID_ROW');
  }
  if (FORMULA_PREFIX.test(normalized)) {
    throw new SkillDatasetSchemaError('SKILL_DATASET_FORMULA_VALUE');
  }
  return normalized || undefined;
}

export function normalizeSkuDataset(value: unknown): readonly NormalizedSkuRow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new SkillDatasetSchemaError('SKILL_DATASET_INVALID_ROW');
  }
  const seen = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SkillDatasetSchemaError('SKILL_DATASET_INVALID_ROW');
    }
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).some(key => !ALLOWED_SKU_FIELDS.has(key))) {
      throw new SkillDatasetSchemaError('SKILL_DATASET_UNKNOWN_FIELD');
    }
    const sku = normalizedText(row, 'sku', 64, true)!;
    const normalizedKey = sku.toUpperCase();
    if (seen.has(normalizedKey)) {
      throw new SkillDatasetSchemaError('SKILL_DATASET_DUPLICATE_SKU');
    }
    seen.add(normalizedKey);
    const name = normalizedText(row, 'name', 200, true)!;
    const sellingPoints = normalizedText(row, 'sellingPoints', 1_000, false);
    const variant = normalizedText(row, 'variant', 200, false);
    const headline = normalizedText(row, 'headline', 120, false);
    return {
      sku,
      name,
      ...(sellingPoints ? { sellingPoints } : {}),
      ...(variant ? { variant } : {}),
      ...(headline ? { headline } : {}),
    };
  });
}
