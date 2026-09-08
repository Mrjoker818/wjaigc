import { describe, expect, it } from 'vitest';

import {
  durableSkillOutputKey,
  parseDurableSkillOutput,
} from '@/lib/skill-runtime/structured-output';
import { canonicalComplianceReportJson } from '@/lib/platform-compliance/report-schema';
import { validReport, wideReport } from '@/__tests__/helpers/platform-compliance-fixtures';

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
});
