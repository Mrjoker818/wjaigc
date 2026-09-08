// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMPLIANCE_ALERT_COLORS,
  COMPLIANCE_STATUS_COLORS,
  PlatformComplianceReportCard,
} from '@/components/skill-runtime/PlatformComplianceReportCard';
import { SkillRunProgress } from '@/components/skill-runtime/SkillRunProgress';
import { canonicalComplianceReportJson } from '@/lib/platform-compliance/report-schema';
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PlatformComplianceReportCard', () => {
  it('keeps all four status labels at WCAG AA contrast in light and dark themes', () => {
    const channel = (hex: string, offset: number): number => parseInt(hex.slice(offset, offset + 2), 16) / 255;
    const luminance = (hex: string): number => [1, 3, 5]
      .map(offset => channel(hex, offset))
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (foreground: string, background: string): number => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };

    for (const palette of Object.values(COMPLIANCE_STATUS_COLORS)) {
      expect(contrast(palette.light.foreground, palette.light.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.dark.foreground, palette.dark.background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const palette of Object.values(COMPLIANCE_ALERT_COLORS)) {
      expect(contrast(palette.foreground, palette.background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['light', 'dark'] as const)('uses an AA alert color for download and projection errors in %s theme', async theme => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const view = render(<PlatformComplianceReportCard report={fourStatusReport} stepId="audit:one"
      theme={theme} downloadUrls={{ json: '/api/report?format=json', html: '/api/report?format=html' }}
      downloadFetcher={fetcher as typeof fetch} onLocate={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '导出 JSON' })); });
    expect((await screen.findByRole('alert')).className).toContain(theme === 'dark' ? 'text-red-300' : 'text-red-700');

    view.unmount();
    render(<SkillRunProgress projectId="project-1" theme={theme} onLocateComplianceSource={vi.fn()}
      projection={{ runId: 'run-1', status: 'completed', lastSequence: 3, plan: [], assetVersionIds: [],
        result: { outputs: [{ stepId: 'audit:one', kind: 'json', schemaId: 'platform-compliance-report-v1', content: `${canonicalComplianceReportJson(fourStatusReport)} ` }] },
        ignoredEventIds: [], missingSequences: [], qualityChecks: [], progress: 100 }} />);
    expect((await screen.findByRole('alert')).className).toContain(theme === 'dark' ? 'text-red-300' : 'text-red-700');
  });

  it('shows why recheck is unavailable without hiding the historical report', () => {
    render(<PlatformComplianceReportCard report={fourStatusReport} stepId="audit:one" onLocate={vi.fn()}
      recheckUnavailableReason="旧运行记录缺少工作区信息，无法按当前规则复检" />);
    expect(screen.getByRole('region', { name: '平台素材合规报告' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重新检查' })).toBeNull();
    expect(screen.getByText('旧运行记录缺少工作区信息，无法按当前规则复检')).toBeTruthy();
  });

  it('renders pass warning blocked and unknown without relying on color', async () => {
    render(<PlatformComplianceReportCard report={fourStatusReport} stepId="audit:one" onLocate={vi.fn()} />);

    expect(screen.getAllByText('通过').length).toBeGreaterThan(0);
    expect(screen.getAllByText('阻止').length).toBeGreaterThan(0);
    expect(screen.getAllByText('警告').length).toBeGreaterThan(0);
    expect(screen.getAllByText('未知').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '只看问题' }));
    expect(screen.queryByText('已通过规则')).toBeNull();
  });

  it('locates the original canvas image and downloads with authenticated same-origin fetch', async () => {
    const onLocate = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['{}']) });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectURL = vi.fn().mockReturnValue('blob:report');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    render(<PlatformComplianceReportCard
      report={fourStatusReport}
      stepId="audit:one"
      downloadUrls={{ json: '/api/skill-reports/run-1/audit%3Aone?projectId=p1&checksum=abc&format=json', html: '/api/skill-reports/run-1/audit%3Aone?projectId=p1&checksum=abc&format=html' }}
      onLocate={onLocate}
      downloadFetcher={fetcher as typeof fetch}
    />);

    fireEvent.click(screen.getByRole('button', { name: '定位画布图片' }));
    expect(onLocate).toHaveBeenCalledWith(fourStatusReport.sourceVersionId);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '导出 JSON' })); });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('format=json'),
      expect.objectContaining({ method: 'GET', credentials: 'same-origin', cache: 'no-store' }),
    ));
    await vi.waitFor(() => {
      expect(click).toHaveBeenCalledOnce();
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
    });
  });

  it('shows a non-sensitive download error and retries the failed format', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['{}']) });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:report') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    render(<PlatformComplianceReportCard report={fourStatusReport} stepId="audit:one"
      downloadUrls={{ json: '/api/report?format=json', html: '/api/report?format=html' }}
      downloadFetcher={fetcher as typeof fetch} onLocate={vi.fn()} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '导出 JSON' })); });
    expect((await screen.findByRole('alert')).textContent).toContain('报告下载失败，请重试');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试下载' })); });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('uses conservative remediation text and exposes manual review requirements', () => {
    const report = structuredClone(fourStatusReport);
    report.checks[2].remediation = null;
    report.checks[3].remediation = null;
    render(<PlatformComplianceReportCard report={report} stepId="audit:one" onLocate={vi.fn()} />);
    expect(screen.getAllByText('需要人工复核').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('阻止规则'));
    expect(screen.getByText('未提供修复建议')).toBeTruthy();
    fireEvent.click(screen.getByText('未知规则'));
    expect(screen.getAllByText('需要人工复核').length).toBeGreaterThan(1);
  });

  it('renders explicit light theme status styles', () => {
    render(<PlatformComplianceReportCard report={fourStatusReport} stepId="audit:one" theme="light" onLocate={vi.fn()} />);
    const card = screen.getByRole('region', { name: '平台素材合规报告' });
    expect(card.getAttribute('data-theme')).toBe('light');
    expect(screen.getAllByText('阻止')[0].className).toContain('text-red-800');
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
