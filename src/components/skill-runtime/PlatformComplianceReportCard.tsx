'use client';

import { useState } from 'react';
import { Download, Filter, LocateFixed, RotateCcw } from 'lucide-react';

import type { ComplianceJsonScalar, ComplianceStatus, PlatformComplianceReportV1 } from '@/lib/platform-compliance/types';
import { downloadPlatformComplianceReport } from './platform-compliance-client';

interface PlatformComplianceReportCardProps {
  report: PlatformComplianceReportV1;
  stepId: string;
  downloadUrls?: { json: string; html: string };
  busy?: boolean;
  onLocate: (sourceVersionId: string) => void;
  onRecheck?: (report: PlatformComplianceReportV1) => void;
  theme?: 'light' | 'dark';
  downloadFetcher?: typeof fetch;
}

const statusLabels: Record<ComplianceStatus, string> = {
  passed: '通过', warning: '警告', blocked: '阻止', unknown: '未知',
};

export const COMPLIANCE_STATUS_COLORS: Record<ComplianceStatus, {
  light: { foreground: string; background: string };
  dark: { foreground: string; background: string };
}> = {
  passed: { light: { foreground: '#166534', background: '#dcfce7' }, dark: { foreground: '#bbf7d0', background: '#052e16' } },
  warning: { light: { foreground: '#78350f', background: '#fef3c7' }, dark: { foreground: '#fde68a', background: '#451a03' } },
  blocked: { light: { foreground: '#991b1b', background: '#fee2e2' }, dark: { foreground: '#fecaca', background: '#450a0a' } },
  unknown: { light: { foreground: '#334155', background: '#f1f5f9' }, dark: { foreground: '#e2e8f0', background: '#1e293b' } },
};

const lightStatusClasses: Record<ComplianceStatus, string> = {
  passed: 'border-green-300 bg-green-100 text-green-800', warning: 'border-amber-300 bg-amber-100 text-amber-900',
  blocked: 'border-red-300 bg-red-100 text-red-800', unknown: 'border-slate-300 bg-slate-100 text-slate-700',
};
const darkStatusClasses: Record<ComplianceStatus, string> = {
  passed: 'border-emerald-800 bg-green-950 text-green-200', warning: 'border-amber-800 bg-amber-950 text-amber-200',
  blocked: 'border-red-800 bg-red-950 text-red-200', unknown: 'border-slate-700 bg-slate-800 text-slate-200',
};

function scalar(value: ComplianceJsonScalar): string {
  if (value === null) return '未提供';
  return String(value);
}

export function PlatformComplianceReportCard({
  report,
  downloadUrls,
  busy = false,
  onLocate,
  onRecheck,
  theme = 'dark',
  downloadFetcher = fetch,
}: PlatformComplianceReportCardProps): React.ReactElement {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [downloadState, setDownloadState] = useState<{ format?: 'json' | 'html'; error?: string; busy?: boolean }>({});
  const statusClasses = theme === 'light' ? lightStatusClasses : darkStatusClasses;
  const checks = problemsOnly
    ? report.checks.filter(check => check.status !== 'passed')
    : report.checks;
  const ruleVersions = [...new Set(report.checks.map(check => check.ruleVersion))].sort((a, b) => a - b).join(', ');

  return (
    <section
      aria-label="平台素材合规报告"
      data-skill-report="platform-compliance"
      data-theme={theme}
      className={`max-h-96 overflow-y-auto rounded-md border p-3 text-xs ${theme === 'light' ? 'border-slate-200 bg-white text-slate-900' : 'border-slate-700 bg-slate-950 text-slate-100'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">平台素材合规报告</strong>
            <span className={`rounded border px-1.5 py-0.5 font-medium ${statusClasses[report.verdict]}`}>
              {statusLabels[report.verdict]}
            </span>
          </div>
          <p className="text-muted-foreground">
            {report.platform} · {report.region} · {report.assetType} · 规则版本 {ruleVersions || '未知'}
          </p>
          <time className="text-muted-foreground" dateTime={report.generatedAt}>
            {new Date(report.generatedAt).toLocaleString('zh-CN')}
          </time>
        </div>
        <div className="grid grid-cols-4 gap-1" aria-label="检查结果统计">
          {(['passed', 'warning', 'blocked', 'unknown'] as const).map(status => (
            <span key={status} className={`rounded border px-1.5 py-1 text-center ${statusClasses[status]}`}>
              <span className="block">{statusLabels[status]}</span>
              <strong>{report.summary[status]}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="my-3 flex flex-wrap gap-1.5">
        <button type="button" title="定位画布图片" className="inline-flex items-center gap-1 rounded border border-current/20 px-2 py-1 hover:bg-current/10" onClick={() => onLocate(report.sourceVersionId)}>
          <LocateFixed size={13} aria-hidden="true" />定位画布图片
        </button>
        <button type="button" aria-pressed={problemsOnly} title="筛选检查项" className="inline-flex items-center gap-1 rounded border border-current/20 px-2 py-1 hover:bg-current/10" onClick={() => setProblemsOnly(value => !value)}>
          <Filter size={13} aria-hidden="true" />{problemsOnly ? '查看全部' : '只看问题'}
        </button>
        {onRecheck && (
          <button type="button" title="按相同设置重新检查" disabled={busy} className="inline-flex items-center gap-1 rounded border border-current/20 px-2 py-1 hover:bg-current/10 disabled:opacity-50" onClick={() => onRecheck(report)}>
            <RotateCcw size={13} aria-hidden="true" />重新检查
          </button>
        )}
        {downloadUrls && <>
          <button type="button" title="下载 JSON 报告" disabled={downloadState.busy} className="inline-flex items-center gap-1 rounded border border-current/20 px-2 py-1 hover:bg-current/10 disabled:opacity-50" onClick={() => {
            setDownloadState({ format: 'json', busy: true });
            void downloadPlatformComplianceReport(downloadUrls.json, `${report.reportId}.json`, downloadFetcher)
              .then(() => setDownloadState({})).catch(() => setDownloadState({ format: 'json', error: '报告下载失败，请重试' }));
          }}>
            <Download size={13} aria-hidden="true" />导出 JSON
          </button>
          <button type="button" title="下载 HTML 报告" disabled={downloadState.busy} className="inline-flex items-center gap-1 rounded border border-current/20 px-2 py-1 hover:bg-current/10 disabled:opacity-50" onClick={() => {
            setDownloadState({ format: 'html', busy: true });
            void downloadPlatformComplianceReport(downloadUrls.html, `${report.reportId}.html`, downloadFetcher)
              .then(() => setDownloadState({})).catch(() => setDownloadState({ format: 'html', error: '报告下载失败，请重试' }));
          }}>
            <Download size={13} aria-hidden="true" />导出 HTML
          </button>
        </>}
      </div>
      {downloadState.error && <div role="alert" className="mb-2 flex items-center gap-2 text-red-600">
        <span>{downloadState.error}</span>
        <button type="button" className="underline" onClick={() => {
          const format = downloadState.format;
          if (!format || !downloadUrls) return;
          setDownloadState({ format, busy: true });
          void downloadPlatformComplianceReport(downloadUrls[format], `${report.reportId}.${format}`, downloadFetcher)
            .then(() => setDownloadState({})).catch(() => setDownloadState({ format, error: '报告下载失败，请重试' }));
        }}>重试下载</button>
      </div>}

      {report.manualReviewRequired && <p className="mb-2 font-medium">需要人工复核</p>}

      <div className="space-y-1.5">
        {checks.map(check => (
          <details key={`${check.ruleId}:${check.ruleVersion}`} className="rounded border border-current/10 px-2 py-1.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
              <span className="min-w-0 break-words">{check.title}</span>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 ${statusClasses[check.status]}`}>{statusLabels[check.status]}</span>
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-muted-foreground">
              <dt>证据</dt><dd className="break-words">{check.evidence.join('；') || '无可验证证据'}</dd>
              <dt>实测值</dt><dd className="break-words">{scalar(check.measuredValue)}</dd>
              <dt>要求值</dt><dd className="break-words">{scalar(check.requiredValue)}</dd>
              <dt>置信度</dt><dd>{check.confidence === null ? '未知' : `${Math.round(check.confidence * 100)}%`}</dd>
              <dt>修复建议</dt><dd className="break-words">{check.remediation
                || (check.status === 'passed' ? '无需修复' : check.status === 'unknown' ? '需要人工复核' : '未提供修复建议')}</dd>
            </dl>
          </details>
        ))}
        {checks.length === 0 && <p className="py-2 text-center text-muted-foreground">当前没有问题项</p>}
      </div>
    </section>
  );
}
