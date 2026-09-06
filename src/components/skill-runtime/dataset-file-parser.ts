import Papa from 'papaparse';

const MAX_DATASET_FILE_BYTES = 512 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/u;

export type SkillDatasetFileErrorCode =
  | 'SKILL_DATASET_FILE_TYPE'
  | 'SKILL_DATASET_FILE_TOO_LARGE'
  | 'SKILL_DATASET_INVALID_JSON'
  | 'SKILL_DATASET_INVALID_CSV'
  | 'SKILL_DATASET_DUPLICATE_HEADER'
  | 'SKILL_DATASET_INVALID_ROWS'
  | 'SKILL_DATASET_FORBIDDEN_KEY'
  | 'SKILL_DATASET_FORMULA_VALUE';

export class SkillDatasetFileError extends Error {
  constructor(readonly code: SkillDatasetFileErrorCode, message: string) {
    super(message);
    this.name = 'SkillDatasetFileError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeValue(value: unknown): void {
  if (typeof value === 'string' && FORMULA_PREFIX.test(value)) {
    throw new SkillDatasetFileError(
      'SKILL_DATASET_FORMULA_VALUE',
      '数据集包含可能执行公式的值',
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeValue(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (!isPlainObject(value)) {
    throw new SkillDatasetFileError('SKILL_DATASET_INVALID_ROWS', '数据集行必须是普通对象');
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new SkillDatasetFileError(
        'SKILL_DATASET_FORBIDDEN_KEY',
        `数据集不能包含保留键 ${key}`,
      );
    }
    assertSafeValue(nested);
  }
}

function assertRows(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(row => !isPlainObject(row))) {
    throw new SkillDatasetFileError('SKILL_DATASET_INVALID_ROWS', '数据集必须是对象数组');
  }
  assertSafeValue(value);
  return value;
}

function parseJsonRows(text: string): readonly Record<string, unknown>[] {
  try {
    return assertRows(JSON.parse(text.replace(/^\uFEFF/u, '')) as unknown);
  } catch (error) {
    if (error instanceof SkillDatasetFileError) throw error;
    throw new SkillDatasetFileError('SKILL_DATASET_INVALID_JSON', 'JSON 文件格式无效');
  }
}

function parseCsvRows(text: string): readonly Record<string, unknown>[] {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/u, ''), {
    skipEmptyLines: 'greedy',
  });
  if (result.errors.length > 0 || result.data.length === 0) {
    throw new SkillDatasetFileError('SKILL_DATASET_INVALID_CSV', 'CSV 文件格式无效');
  }
  const headers = result.data[0].map(header => header.trim());
  if (
    headers.length === 0
    || headers.some(header => !header || FORBIDDEN_KEYS.has(header))
  ) {
    throw new SkillDatasetFileError('SKILL_DATASET_FORBIDDEN_KEY', 'CSV 表头包含非法字段');
  }
  if (new Set(headers).size !== headers.length) {
    throw new SkillDatasetFileError('SKILL_DATASET_DUPLICATE_HEADER', 'CSV 表头不能重复');
  }
  const rows = result.data.slice(1).map(cells => {
    if (cells.length !== headers.length) {
      throw new SkillDatasetFileError('SKILL_DATASET_INVALID_CSV', 'CSV 每行字段数量必须一致');
    }
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  });
  return assertRows(rows);
}

export async function parseSkillDatasetFile(
  file: File,
): Promise<readonly Record<string, unknown>[]> {
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.json')) {
    throw new SkillDatasetFileError(
      'SKILL_DATASET_FILE_TYPE',
      '仅支持 CSV 或 JSON 文件',
    );
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_DATASET_FILE_BYTES) {
    throw new SkillDatasetFileError(
      'SKILL_DATASET_FILE_TOO_LARGE',
      '数据集文件不能超过 512 KiB',
    );
  }
  const text = await file.text();
  return lowerName.endsWith('.json') ? parseJsonRows(text) : parseCsvRows(text);
}
