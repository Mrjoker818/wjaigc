// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlatformComplianceReportCard } from '@/components/skill-runtime/PlatformComplianceReportCard';
import type { PlatformComplianceReportV1 } from '@/lib/platform-compliance/types';

export const fourStatusReport: PlatformComplianceReportV1 = {
  schemaVersion: 1,
  reportId: 'report-1',
  runId: 'run-1',
  generatedAt: '2026-09-09T08:00:00.000Z',
  platform: 'Amazon',
  region: 'US',
  assetType: 'main',
  productCategory: '家居',
  sourceVersionId: '018f47d2-4b2a-7d30-8c21-123456789abc',
  sourceDigest: 'a'.repeat(64),
  ruleSetDigest: 'b'.repeat(64),
  verdict: 'blocked',
  checks: [
    { ruleId: 'passed', ruleVersion: 1, title: '已通过规则', severity: 'warning', evaluator: 'metadata', status: 'passed', evidence: ['尺寸符合'], measuredValue: 1600, requiredValue: 1000, confidence: 1, remediation: null },
    { ruleId: 'warning', ruleVersion: 2, title: '警告规则', severity: 'warning', evaluator: 'vision', status: 'warning', evidence: ['主体偏小'], measuredValue: '偏小', requiredValue: '主体居中', confidence: 0.82, remediation: '放大主体' },
    { ruleId: 'blocked', ruleVersion: 3, title: '阻止规则', severity: 'blocking', evaluator: 'pixel', status: 'blocked', evidence: ['背景非纯白'], measuredValue: '#eeeeee', requiredValue: '#ffffff', confidence: 0.96, remediation: '替换为纯白背景' },
    { ruleId: 'unknown', ruleVersion: 4, title: '未知规则', severity: 'blocking', evaluator: 'vision', status: 'unknown', evidence: ['视觉服务不可用'], measuredValue: null, requiredValue: '无促销文字', confidence: null, remediation: '人工复核' },
  ],
  summary: { passed: 1, warning: 1, blocked: 1, unknown: 1 },
  visionModel: { providerId: 'pear', modelId: 'vision-1' },
  knownLimitations: [],
  technicalErrors: [],
  manualReviewRequired: true,
  extensions: {},
};

describe('PlatformComplianceReportCard', () => {
  it('renders pass warning blocked and unknown without relying on color', async () => {
    render(<PlatformComplianceReportCard report={fourStatusReport} stepId="audit:one" onLocate={vi.fn()} />);

    expect(screen.getAllByText('通过').length).toBeGreaterThan(0);
    expect(screen.getAllByText('阻止').length).toBeGreaterThan(0);
    expect(screen.getAllByText('警告').length).toBeGreaterThan(0);
    expect(screen.getAllByText('未知').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '只看问题' }));
    expect(screen.queryByText('已通过规则')).toBeNull();
  });

  it('locates the original canvas image and uses authenticated downloads', async () => {
    const onLocate = vi.fn();
    render(<PlatformComplianceReportCard
      report={fourStatusReport}
      stepId="audit:one"
      downloadUrls={{ json: '/api/skill-reports/run-1/audit%3Aone?projectId=p1&checksum=abc&format=json', html: '/api/skill-reports/run-1/audit%3Aone?projectId=p1&checksum=abc&format=html' }}
      onLocate={onLocate}
    />);

    fireEvent.click(screen.getByRole('button', { name: '定位画布图片' }));
    expect(onLocate).toHaveBeenCalledWith(fourStatusReport.sourceVersionId);
    expect(screen.getByRole('link', { name: '导出 JSON' }).getAttribute('href')).toContain('format=json');
    expect(screen.getByRole('link', { name: '导出 HTML' }).getAttribute('href')).toContain('format=html');
  });

  it('shows evidence, measured and required values, confidence, and remediation inside details', async () => {
    render(<PlatformComplianceReportCard report={fourStatusReport} stepId="audit:one" onLocate={vi.fn()} />);
    fireEvent.click(screen.getByText('阻止规则'));
    expect(screen.getByText(/背景非纯白/)).toBeTruthy();
    expect(screen.getByText(/#eeeeee/)).toBeTruthy();
    expect(screen.getByText(/#ffffff/)).toBeTruthy();
    expect(screen.getByText(/96%/)).toBeTruthy();
    expect(screen.getByText(/替换为纯白背景/)).toBeTruthy();
  });
});
