import { describe, expect, it } from 'vitest';

import {
  canonicalComplianceReportJson,
  parsePlatformComplianceReport,
} from '@/lib/platform-compliance/report-schema';
import type { ComplianceJsonObject } from '@/lib/platform-compliance/types';
import { deepReport, validReport, wideReport } from '@/__tests__/helpers/platform-compliance-fixtures';

describe('platform compliance report schema', () => {
  it('never converts missing evidence into a pass', () => {
    const report = parsePlatformComplianceReport(validReport({
      checks: [{
        ruleId: 'amazon-main-fill',
        ruleVersion: 1,
        title: '商品画面占比',
        severity: 'blocking',
        evaluator: 'vision',
        status: 'unknown',
        evidence: [],
        measuredValue: null,
        requiredValue: '商品占画面至少 85%',
        confidence: null,
        remediation: '人工复核商品占比',
      }],
    }));

    expect(report.summary.unknown).toBe(1);
    expect(report.summary.passed).toBe(0);
    expect(report.verdict).toBe('unknown');
    expect(report.manualReviewRequired).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   \t\n'],
  ])('never treats %s evidence as a pass', (_label, evidence) => {
    const report = parsePlatformComplianceReport(validReport({
      checks: [{ ...validReport().checks[0], evidence: [evidence] }],
    }));

    expect(report.checks[0].evidence).toEqual([]);
    expect(report.checks[0].status).toBe('unknown');
    expect(report.summary).toEqual({ passed: 0, warning: 0, blocked: 0, unknown: 1 });
    expect(report.verdict).toBe('unknown');
  });

  it('rejects oversized deeply nested and prototype-shaped reports', () => {
    expect(() => parsePlatformComplianceReport({ __proto__: { polluted: true } })).toThrow();
    expect(() => canonicalComplianceReportJson(deepReport(13))).toThrow('REPORT_DEPTH_LIMIT');
    expect(() => canonicalComplianceReportJson(wideReport(4097))).toThrow('REPORT_KEY_LIMIT');
  });

  it('rejects forbidden own keys and all configured size boundaries', () => {
    const prototypeKey = JSON.parse('{"constructor":"unsafe"}');
    expect(() => canonicalComplianceReportJson(prototypeKey)).toThrow('REPORT_FORBIDDEN_KEY');
    expect(() => canonicalComplianceReportJson(validReport({
      knownLimitations: ['x'.repeat(16_385)],
    }))).toThrow('REPORT_STRING_LIMIT');
    expect(() => canonicalComplianceReportJson(validReport({
      knownLimitations: ['x'.repeat(16_384), 'y'.repeat(16_384), 'z'.repeat(16_384),
        'a'.repeat(16_384), 'b'.repeat(16_384), 'c'.repeat(16_384), 'd'.repeat(16_384),
        'e'.repeat(16_384), 'f'.repeat(16_384), 'g'.repeat(16_384), 'h'.repeat(16_384),
        'i'.repeat(16_384), 'j'.repeat(16_384), 'k'.repeat(16_384), 'l'.repeat(16_384),
        'm'.repeat(16_384), 'n'.repeat(16_384)],
    }))).toThrow('REPORT_SIZE_LIMIT');
  });

  it('rejects large arrays and excessive total node counts before normalization can amplify them', () => {
    expect(() => canonicalComplianceReportJson(new Array(4097).fill(null)))
      .toThrow('REPORT_ARRAY_LIMIT');

    const atNodeLimit = {
      left: new Array(4094).fill(null),
      right: new Array(4095).fill(null),
    };
    expect(() => canonicalComplianceReportJson(atNodeLimit)).not.toThrow();
    expect(() => canonicalComplianceReportJson({
      ...atNodeLimit,
      right: new Array(4096).fill(null),
    })).toThrow('REPORT_NODE_LIMIT');
  });

  it('rejects every forbidden key recursively, including enumerable array properties', () => {
    for (const key of ['__proto__', 'prototype', 'constructor']) {
      const nested = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(nested, key, { value: true, enumerable: true });
      expect(() => canonicalComplianceReportJson({ nested })).toThrow('REPORT_FORBIDDEN_KEY');

      const array: unknown[] = [];
      Object.defineProperty(array, key, { value: true, enumerable: true });
      expect(() => canonicalComplianceReportJson({ array })).toThrow('REPORT_FORBIDDEN_KEY');
    }
  });

  it('accepts exact limits and rejects the first value beyond each limit', () => {
    const nested = (depth: number): unknown => {
      let value: unknown = null;
      for (let index = 0; index < depth; index += 1) value = { nested: value };
      return value;
    };
    const exactKeys = Object.fromEntries(
      Array.from({ length: 4096 }, (_, index) => [`key-${index}`, null]),
    );
    const exactBytes = [...new Array(15).fill('x'.repeat(16_384)), 'x'.repeat(16_335)];
    const overBytes = [...exactBytes.slice(0, -1), 'x'.repeat(16_336)];

    expect(() => canonicalComplianceReportJson('x'.repeat(16_384))).not.toThrow();
    expect(() => canonicalComplianceReportJson(new Array(4096).fill(null))).not.toThrow();
    expect(() => canonicalComplianceReportJson(exactKeys)).not.toThrow();
    expect(() => canonicalComplianceReportJson(nested(12))).not.toThrow();
    expect(new TextEncoder().encode(canonicalComplianceReportJson(exactBytes))).toHaveLength(256 * 1024);
    expect(() => canonicalComplianceReportJson(overBytes)).toThrow('REPORT_SIZE_LIMIT');
    expect(() => canonicalComplianceReportJson(nested(13))).toThrow('REPORT_DEPTH_LIMIT');
  });

  it('rejects cycles and requires a real ISO 8601 generatedAt timestamp', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    expect(() => canonicalComplianceReportJson(cycle)).toThrow('REPORT_CYCLE');
    expect(() => parsePlatformComplianceReport(validReport({ generatedAt: 'not-a-date' })))
      .toThrow('REPORT_SCHEMA_INVALID');
    expect(() => parsePlatformComplianceReport(validReport({
      generatedAt: '2026-02-30T00:00:00.000Z',
    }))).toThrow('REPORT_SCHEMA_INVALID');
    expect(parsePlatformComplianceReport(validReport({
      generatedAt: '2026-09-07T08:30:00+08:00',
    })).generatedAt).toBe('2026-09-07T08:30:00+08:00');
  });

  it('sorts keys recursively and returns identical JSON bytes for the same report', () => {
    const report = parsePlatformComplianceReport(validReport({
      extensions: { zebra: 1, alpha: { charlie: true, bravo: false } },
    }));
    const first = canonicalComplianceReportJson(report);
    const second = canonicalComplianceReportJson(report);

    expect(first).toBe(second);
    expect(first.indexOf('"alpha"')).toBeLessThan(first.indexOf('"zebra"'));
    expect(first.indexOf('"bravo"')).toBeLessThan(first.indexOf('"charlie"'));

    const codePointOrdered = canonicalComplianceReportJson({ Z: 2, a: 1 });
    expect(codePointOrdered.indexOf('"Z"')).toBeLessThan(codePointOrdered.indexOf('"a"'));
  });

  it('recursively freezes extension objects, arrays, and array elements', () => {
    const report = parsePlatformComplianceReport(validReport({
      extensions: {
        nested: {
          enabled: true,
          items: [{ label: 'first' }],
        },
      },
    }));
    const nested = report.extensions.nested;
    expect(nested).not.toBeNull();
    expect(Array.isArray(nested)).toBe(false);
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
      throw new Error('expected nested extension object');
    }
    const nestedObject = nested as ComplianceJsonObject;
    const items = nestedObject.items;
    expect(Array.isArray(items)).toBe(true);
    if (!Array.isArray(items)) throw new Error('expected nested extension array');

    expect(Object.isFrozen(report.extensions)).toBe(true);
    expect(Object.isFrozen(nestedObject)).toBe(true);
    expect(Object.isFrozen(items)).toBe(true);
    expect(Object.isFrozen(items[0])).toBe(true);
    expect(() => {
      (nestedObject as { enabled: boolean }).enabled = false;
    }).toThrow();
    expect(() => {
      (items[0] as { label: string }).label = 'changed';
    }).toThrow();
  });

  it('rejects malformed reports and recomputes summary and verdict from checks', () => {
    expect(() => parsePlatformComplianceReport({})).toThrow('REPORT_SCHEMA_INVALID');
    expect(() => parsePlatformComplianceReport({
      ...validReport(),
      verdict: 'not-a-status',
    })).toThrow('REPORT_SCHEMA_INVALID');
    expect(() => parsePlatformComplianceReport({
      ...validReport(),
      summary: { passed: -1, warning: 0, blocked: 0, unknown: 0 },
    })).toThrow('REPORT_SCHEMA_INVALID');
    expect(() => parsePlatformComplianceReport({
      ...validReport(),
      unexpected: true,
    })).toThrow('REPORT_SCHEMA_INVALID');
    expect(parsePlatformComplianceReport(validReport({ checks: [] }))).toMatchObject({
      verdict: 'unknown',
      manualReviewRequired: true,
      summary: { passed: 0, warning: 0, blocked: 0, unknown: 0 },
    });
    const report = parsePlatformComplianceReport(validReport({
      verdict: 'passed',
      summary: { passed: 99, warning: 0, blocked: 0, unknown: 0 },
      checks: [{
        ruleId: 'amazon-main-no-text',
        ruleVersion: 1,
        title: '主图文字',
        severity: 'warning',
        evaluator: 'vision',
        status: 'warning',
        evidence: ['发现促销文字'],
        measuredValue: true,
        requiredValue: false,
        confidence: 0.9,
        remediation: '移除主图文字',
      }],
    }));

    expect(report.summary).toEqual({ passed: 0, warning: 1, blocked: 0, unknown: 0 });
    expect(report.verdict).toBe('warning');
    expect(report.manualReviewRequired).toBe(true);
  });
});
