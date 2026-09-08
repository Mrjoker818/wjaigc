import {
  canonicalComplianceReportJson,
  parsePlatformComplianceReport,
} from '../platform-compliance/report-schema';
import type { DurableSkillOutput, SkillStructuredResult } from './types';

const STRUCTURED_OUTPUT_SCHEMAS = new Map<string, (value: unknown) => string>([
  ['platform-compliance-report-v1', value => (
    canonicalComplianceReportJson(parsePlatformComplianceReport(value))
  )],
]);
const MAX_STRUCTURED_OUTPUT_BYTES = 256 * 1024;

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

export function durableSkillOutputKey(output: DurableSkillOutput): string {
  return output.kind === 'json'
    ? `${output.stepId}\u0000${output.kind}\u0000${output.schemaId}`
    : `${output.stepId}\u0000${output.kind}`;
}
