import {
  canonicalComplianceReportJson,
  parsePlatformComplianceReport,
} from '../platform-compliance/report-schema';
import type { DurableSkillOutput, SkillStructuredResult } from './types';
import { canonicalMultiPlatformExportResultJson } from '../multi-platform-export/manifest';

const STRUCTURED_OUTPUT_SCHEMAS = new Map<string, (value: unknown) => string>([
  ['platform-compliance-report-v1', value => (
    canonicalComplianceReportJson(parsePlatformComplianceReport(value))
  )],
  ['multi-platform-export-result-v1', canonicalMultiPlatformExportResultJson],
]);
const MAX_STRUCTURED_OUTPUT_BYTES = 256 * 1024;

export interface DurableSkillOutputError {
  index: number;
  stepId?: string;
  schemaId?: string;
  code: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function structuredContent(schemaId: string, value: unknown): string {
  if (!schemaId.trim()) throw new Error('SKILL_OUTPUT_SCHEMA_ID_INVALID');
  const serialize = STRUCTURED_OUTPUT_SCHEMAS.get(schemaId);
  if (!serialize) throw new Error('SKILL_OUTPUT_SCHEMA_UNKNOWN');
  return serialize(value);
}

export function durableSkillOutputFromStructuredResult(
  stepId: string,
  structured: SkillStructuredResult,
): DurableSkillOutput {
  return {
    stepId,
    kind: 'json',
    schemaId: structured.schemaId,
    content: structuredContent(structured.schemaId, structured.value),
  };
}

export function parseDurableSkillOutput(value: unknown): DurableSkillOutput {
  if (!isRecord(value) || typeof value.stepId !== 'string' || typeof value.content !== 'string') {
    throw new Error('SKILL_OUTPUT_INVALID');
  }
  if (value.kind === 'text' || value.kind === 'html') {
    return { stepId: value.stepId, kind: value.kind, content: value.content };
  }
  if (value.kind !== 'json') throw new Error('SKILL_OUTPUT_INVALID');
  if (typeof value.schemaId !== 'string') throw new Error('SKILL_OUTPUT_SCHEMA_ID_INVALID');
  if (new TextEncoder().encode(value.content).byteLength > MAX_STRUCTURED_OUTPUT_BYTES) {
    throw new Error('SKILL_OUTPUT_SIZE_LIMIT');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.content) as unknown;
  } catch {
    throw new Error('SKILL_OUTPUT_JSON_INVALID');
  }
  return {
    stepId: value.stepId,
    kind: 'json',
    schemaId: value.schemaId,
    content: structuredContent(value.schemaId, parsed),
  };
}

export function parseDurableSkillOutputs(value: unknown): DurableSkillOutput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('SKILL_OUTPUTS_INVALID');
  return value.map(parseDurableSkillOutput);
}

function diagnosticString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
    && descriptor.value.length > 0 && descriptor.value.length <= 128
    ? descriptor.value
    : undefined;
}

function diagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(message) ? message : 'SKILL_OUTPUT_INVALID';
}

export function parseDurableSkillOutputsIsolated(value: unknown): {
  outputs: DurableSkillOutput[];
  errors: DurableSkillOutputError[];
} {
  if (value === undefined) return { outputs: [], errors: [] };
  if (!Array.isArray(value)) throw new Error('SKILL_OUTPUTS_INVALID');
  const outputs: DurableSkillOutput[] = [];
  const errors: DurableSkillOutputError[] = [];
  value.forEach((item, index) => {
    try {
      outputs.push(parseDurableSkillOutput(item));
    } catch (error) {
      const stepId = diagnosticString(item, 'stepId');
      const schemaId = diagnosticString(item, 'schemaId');
      if (schemaId !== 'platform-compliance-report-v1') throw error;
      errors.push({
        index,
        ...(stepId ? { stepId } : {}),
        ...(schemaId ? { schemaId } : {}),
        code: diagnosticCode(error),
      });
    }
  });
  return { outputs, errors };
}

export function durableSkillOutputKey(output: DurableSkillOutput): string {
  return output.kind === 'json'
    ? `${output.stepId}\u0000${output.kind}\u0000${output.schemaId}`
    : `${output.stepId}\u0000${output.kind}`;
}
