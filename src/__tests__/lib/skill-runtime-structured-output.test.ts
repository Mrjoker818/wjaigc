import { describe, expect, it } from 'vitest';

import {
  durableSkillOutputKey,
  parseDurableSkillOutput,
  parseDurableSkillOutputsIsolated,
} from '@/lib/skill-runtime/structured-output';
import { canonicalComplianceReportJson } from '@/lib/platform-compliance/report-schema';
import { validReport, wideReport } from '@/__tests__/helpers/platform-compliance-fixtures';

const exportResult = () => ({
  schemaVersion: 1,
  runId: 'run-1',
  outcome: 'completed',
  imageAssetVersionIds: ['image-v2', 'image-v1'],
  manifestAssetVersionId: 'manifest-v1',
  zipAssetVersionId: 'zip-v1',
  failures: [],
});

describe('bounded durable Skill outputs', () => {
  it('restores a registered schema-tagged JSON output in canonical form', () => {
    const output = parseDurableSkillOutput({
      stepId: 'audit:a',
      kind: 'json',
      schemaId: 'platform-compliance-report-v1',
      content: JSON.stringify(validReport()),
    });

    expect(output).toEqual({
      stepId: 'audit:a',
      kind: 'json',
      schemaId: 'platform-compliance-report-v1',
      content: canonicalComplianceReportJson(validReport()),
    });
  });

  it('restores multi-platform export results with stable image ordering', () => {
    const output = parseDurableSkillOutput({
      stepId: 'export', kind: 'json', schemaId: 'multi-platform-export-result-v1',
      content: JSON.stringify(exportResult()),
    });
    expect(JSON.parse(output.content)).toEqual({
      ...exportResult(), imageAssetVersionIds: ['image-v1', 'image-v2'],
    });
  });

  it('rejects an export outcome inconsistent with its failure list', () => {
    expect(() => parseDurableSkillOutput({
      stepId: 'export', kind: 'json', schemaId: 'multi-platform-export-result-v1',
      content: JSON.stringify({ ...exportResult(), failures: [{ sourceAssetVersionId: 'source-1', code: 'EXPORT_FAILED', retryable: false }] }),
    })).toThrow('EXPORT_RESULT_SCHEMA_INVALID');
    expect(() => parseDurableSkillOutput({
      stepId: 'export', kind: 'json', schemaId: 'multi-platform-export-result-v1',
      content: JSON.stringify({ ...exportResult(), outcome: 'partial_success' }),
    })).toThrow('EXPORT_RESULT_SCHEMA_INVALID');
  });

  it.each([
    ['', 'SKILL_OUTPUT_SCHEMA_ID_INVALID'],
    ['unregistered-report-v1', 'SKILL_OUTPUT_SCHEMA_UNKNOWN'],
    ['__proto__', 'SKILL_OUTPUT_SCHEMA_UNKNOWN'],
  ])('rejects schema id %j', (schemaId, code) => {
    expect(() => parseDurableSkillOutput({
      stepId: 'audit:a', kind: 'json', schemaId, content: JSON.stringify(validReport()),
    })).toThrow(code);
  });

  it('rejects malicious, invalid, and over-limit JSON content', () => {
    expect(() => parseDurableSkillOutput({
      stepId: 'audit:a', kind: 'json', schemaId: 'platform-compliance-report-v1',
      content: JSON.stringify(wideReport(4097)),
    })).toThrow('REPORT_KEY_LIMIT');
    expect(() => parseDurableSkillOutput({
      stepId: 'audit:a', kind: 'json', schemaId: 'platform-compliance-report-v1',
      content: '{"constructor":"unsafe"}',
    })).toThrow('REPORT_FORBIDDEN_KEY');
    expect(() => parseDurableSkillOutput({
      stepId: 'audit:a', kind: 'json', schemaId: 'platform-compliance-report-v1', content: '{',
    })).toThrow('SKILL_OUTPUT_JSON_INVALID');
    expect(() => parseDurableSkillOutput({
      stepId: 'audit:a', kind: 'json', schemaId: 'platform-compliance-report-v1',
      content: `${JSON.stringify(validReport())}${' '.repeat(256 * 1024)}`,
    })).toThrow('SKILL_OUTPUT_SIZE_LIMIT');
  });

  it('keeps legacy outputs compatible and includes schemaId only for JSON deduplication', () => {
    const text = parseDurableSkillOutput({ stepId: 'audit:a', kind: 'text', content: 'legacy' });
    const html = parseDurableSkillOutput({ stepId: 'audit:a', kind: 'html', content: '<p>legacy</p>' });
    const json = parseDurableSkillOutput({
      stepId: 'audit:a', kind: 'json', schemaId: 'platform-compliance-report-v1',
      content: JSON.stringify(validReport()),
    });

    expect(text).toEqual({ stepId: 'audit:a', kind: 'text', content: 'legacy' });
    expect(html).toEqual({ stepId: 'audit:a', kind: 'html', content: '<p>legacy</p>' });
    expect(durableSkillOutputKey(text)).toBe('audit:a\u0000text');
    expect(durableSkillOutputKey(json)).toBe('audit:a\u0000json\u0000platform-compliance-report-v1');
  });

  it('isolates only an explicitly tagged damaged platform compliance report', () => {
    expect(parseDurableSkillOutputsIsolated([
      { stepId: 'copy', kind: 'text', content: 'safe' },
      { stepId: 'audit:a', kind: 'json', schemaId: 'platform-compliance-report-v1', content: '{bad' },
    ])).toEqual({
      outputs: [{ stepId: 'copy', kind: 'text', content: 'safe' }],
      errors: [{
        index: 1,
        stepId: 'audit:a',
        schemaId: 'platform-compliance-report-v1',
        code: 'SKILL_OUTPUT_JSON_INVALID',
      }],
    });
  });

  it.each([
    ['unknown schema', { stepId: 'ordinary', kind: 'json', schemaId: 'ordinary-skill-v1', content: '{}' }, 'SKILL_OUTPUT_SCHEMA_UNKNOWN'],
    ['ordinary invalid JSON', { stepId: 'ordinary', kind: 'json', schemaId: 'ordinary-skill-v1', content: '{bad' }, 'SKILL_OUTPUT_JSON_INVALID'],
    ['illegal kind', { stepId: 'ordinary', kind: 'binary', content: 'unsafe' }, 'SKILL_OUTPUT_INVALID'],
    ['missing fields', { kind: 'text', content: 'unsafe' }, 'SKILL_OUTPUT_INVALID'],
  ])('keeps the whole-output failure contract for %s', (_label, invalidOutput, code) => {
    expect(() => parseDurableSkillOutputsIsolated([
      { stepId: 'audit:a', kind: 'json', schemaId: 'platform-compliance-report-v1', content: '{bad' },
      invalidOutput,
    ])).toThrow(code);
  });
});
