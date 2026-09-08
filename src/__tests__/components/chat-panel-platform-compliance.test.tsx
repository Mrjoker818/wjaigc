// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SkillRunProgress } from '@/components/skill-runtime/SkillRunProgress';
import { canonicalComplianceReportJson } from '@/lib/platform-compliance/report-schema';
import type { PlatformComplianceReportV1 } from '@/lib/platform-compliance/types';

const report: PlatformComplianceReportV1 = {
  schemaVersion: 1, reportId: 'report-1', runId: 'run-1', generatedAt: '2026-09-09T08:00:00.000Z',
  platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
  sourceVersionId: '018f47d2-4b2a-7d30-8c21-123456789abc', sourceDigest: 'a'.repeat(64),
  ruleSetDigest: 'b'.repeat(64), verdict: 'passed',
  checks: [{ ruleId: 'size', ruleVersion: 1, title: '尺寸', severity: 'blocking', evaluator: 'metadata',
    status: 'passed', evidence: ['尺寸符合'], measuredValue: 1600, requiredValue: 1000,
    confidence: 1, remediation: null }],
  summary: { passed: 1, warning: 0, blocked: 0, unknown: 0 }, visionModel: null,
  knownLimitations: [], technicalErrors: [], manualReviewRequired: false, extensions: {},
};

describe('Canvas compliance report projection', () => {
  it('projects durable JSON reports into the existing Skill progress area', async () => {
    const content = canonicalComplianceReportJson(report);
    render(<SkillRunProgress
      projectId="project-1"
      projection={{
        runId: 'run-1', status: 'completed', lastSequence: 3, plan: [], assetVersionIds: [],
        result: { outputs: [{ stepId: 'audit:one', kind: 'json', schemaId: 'platform-compliance-report-v1', content }] },
        ignoredEventIds: [], missingSequences: [], qualityChecks: [], progress: 100,
      }}
      onLocateComplianceSource={vi.fn()}
    />);

    await waitFor(() => expect(screen.getByRole('region', { name: '平台素材合规报告' })).toBeTruthy());
    expect(screen.getByRole('link', { name: '导出 JSON' }).getAttribute('href')).toMatch(/^\/api\/skill-reports\/run-1\/audit%3Aone\?/u);
  });

  it('does not project unknown JSON schemas as compliance reports', async () => {
    render(<SkillRunProgress
      projectId="project-1"
      projection={{
        runId: 'run-1', status: 'completed', lastSequence: 3, plan: [], assetVersionIds: [],
        result: { outputs: [{ stepId: 'audit:one', kind: 'json', schemaId: 'other-report', content: '{}' }] },
        ignoredEventIds: [], missingSequences: [], qualityChecks: [], progress: 100,
      }}
    />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('region', { name: '平台素材合规报告' })).toBeNull();
  });
});
