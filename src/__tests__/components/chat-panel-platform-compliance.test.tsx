// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillRunProgress } from '@/components/skill-runtime/SkillRunProgress';
import { ChatPanel } from '@/components/chat-panel';
import { canonicalComplianceReportJson } from '@/lib/platform-compliance/report-schema';
import type { PlatformComplianceReportV1 } from '@/lib/platform-compliance/types';
import { LOVART_PLATFORM_COMPLIANCE_SKILLS } from '@/lib/skill-runtime/platform-compliance-preset';

const integration = vi.hoisted(() => ({
  projections: new Map<string, unknown>(),
}));

vi.mock('@/components/agent-runtime/use-agent-run-events', () => ({
  useAgentRunEvents: (runId?: string) => ({
    projection: runId ? integration.projections.get(runId) : undefined,
    stale: false,
  }),
}));

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

beforeEach(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
});

afterEach(() => {
  cleanup();
  integration.projections.clear();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function completedProjection(runId: string, content: string) {
  return {
    runId, status: 'completed' as const, lastSequence: 3, plan: [], assetVersionIds: [],
    result: { outputs: [{ stepId: 'audit:one', kind: 'json' as const, schemaId: 'platform-compliance-report-v1', content }] },
    ignoredEventIds: [], missingSequences: [], qualityChecks: [], progress: 100,
  };
}

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
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeTruthy();
  });

  it('shows a visible projection error and retries without exposing parser details', async () => {
    const content = `${canonicalComplianceReportJson(report)} `;
    render(<SkillRunProgress
      projectId="project-1"
      projection={{
        runId: 'run-1', status: 'completed', lastSequence: 3, plan: [], assetVersionIds: [],
        result: { outputs: [{ stepId: 'audit:one', kind: 'json', schemaId: 'platform-compliance-report-v1', content }] },
        ignoredEventIds: [], missingSequences: [], qualityChecks: [], progress: 100,
      }}
      onLocateComplianceSource={vi.fn()}
    />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('报告加载失败，请重试');
    expect(alert.textContent).not.toContain('JSON');
    fireEvent.click(screen.getByRole('button', { name: '重新加载报告' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
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

  it('restores a frozen historical report in the real ChatPanel and rechecks without the current model', async () => {
    const currentSkill = { ...LOVART_PLATFORM_COMPLIANCE_SKILLS[0], version: 2 };
    const historicalReport = { ...report, runId: 'old-run' };
    integration.projections.set('old-run', completedProjection('old-run', canonicalComplianceReportJson(historicalReport)));
    const historical = {
      runId: 'old-run', projectId: 'project-1', surface: 'canvas', workspaceId: 'canvas:project-1',
      skillId: 'preset-platform-compliance-audit', skillVersion: 1, status: 'completed', createdAt: 1,
      inputValues: { sourceImages: [report.sourceVersionId], platform: 'Amazon', region: 'US', assetType: 'main' },
      sourceVersionIds: [report.sourceVersionId],
      modelBindings: {
        orchestrator: { providerId: 'frozen-provider', modelId: 'frozen-chat' },
        vision: { providerId: 'frozen-provider', modelId: 'frozen-vision' },
      },
      outputs: [],
    };
    const submitted: Array<Record<string, unknown>> = [];
    let resolveSubmit: ((response: Response) => void) | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === '/api/skills?surface=canvas') return jsonResponse({ skills: [currentSkill] });
      if (url.startsWith('/api/models?')) return jsonResponse({ models: [], providers: [] });
      if (url.startsWith('/api/user-data/sync')) return jsonResponse({ data: null });
      if (url.startsWith('/api/chat-tasks?')) return jsonResponse({ tasks: [] });
      if (url.startsWith('/api/skill-runs?')) return jsonResponse({ runs: [historical] });
      if (url === '/api/skill-runs/old-run?observeOnly=true') return jsonResponse({ run: historical });
      if (url === '/api/skill-runs' && init?.method === 'POST') {
        submitted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Promise<Response>(resolve => { resolveSubmit = resolve; });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetcher);

    render(<ChatPanel themeStyle="monochrome" projectId="project-1" canvasImages={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills技能库' }));
    fireEvent.click(await screen.findByText('平台素材合规检查'));
    fireEvent.click(await screen.findByRole('button', { name: '查看任务 old-run' }));

    const card = await screen.findByRole('region', { name: '平台素材合规报告' });
    expect(card.getAttribute('data-theme')).toBe('light');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '导出 JSON' })); });
    expect((await screen.findByRole('alert')).textContent).toContain('报告下载失败，请重试');
    const recheck = screen.getByRole('button', { name: '重新检查' });
    fireEvent.click(recheck);
    fireEvent.click(recheck);
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({
      skillVersion: 2,
      inputValues: historical.inputValues,
      sourceVersionIds: historical.sourceVersionIds,
      modelBindings: historical.modelBindings,
    });
    expect(submitted[0].idempotencyKey).not.toBeUndefined();
    const newReport = { ...report, runId: 'new-run', reportId: 'report-2' };
    integration.projections.set('new-run', completedProjection('new-run', canonicalComplianceReportJson(newReport)));
    resolveSubmit?.(jsonResponse({ runId: 'new-run' }, 201));
    await waitFor(() => expect(screen.getByRole('region', { name: '平台素材合规报告' })).toBeTruthy());
    expect('new-run').not.toBe(historical.runId);
  });

  it('keeps mixed legacy and current history visible while disabling only an incomplete legacy recheck', async () => {
    const legacyReport = { ...report, runId: 'legacy-run' };
    integration.projections.set('legacy-run', completedProjection('legacy-run', canonicalComplianceReportJson(legacyReport)));
    const legacy = {
      runId: 'legacy-run', projectId: 'project-1', surface: 'canvas',
      skillId: 'preset-platform-compliance-audit', skillVersion: 1, status: 'completed', createdAt: 1,
      inputValues: { sourceImages: [report.sourceVersionId], platform: 'Amazon', region: 'US', assetType: 'main' },
      sourceVersionIds: [report.sourceVersionId],
      modelBindings: { vision: { providerId: 'frozen-provider', modelId: 'frozen-vision' } },
      apiKey: 'must-not-be-rendered',
    };
    const current = { ...legacy, runId: 'current-run', workspaceId: 'canvas:project-1', createdAt: 2 };
    const incomplete = { ...current, runId: 'incomplete-run', createdAt: 3 } as Record<string, unknown>;
    delete incomplete.modelBindings;
    integration.projections.set('incomplete-run', completedProjection('incomplete-run', canonicalComplianceReportJson({
      ...report, runId: 'incomplete-run', reportId: 'report-incomplete',
    })));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === '/api/skills?surface=canvas') return jsonResponse({ skills: LOVART_PLATFORM_COMPLIANCE_SKILLS });
      if (url.startsWith('/api/models?')) return jsonResponse({ models: [], providers: [] });
      if (url.startsWith('/api/user-data/sync')) return jsonResponse({ data: null });
      if (url.startsWith('/api/chat-tasks?')) return jsonResponse({ tasks: [] });
      if (url.startsWith('/api/skill-runs?')) return jsonResponse({ runs: [legacy, incomplete, current] });
      if (url === '/api/skill-runs/legacy-run?observeOnly=true') return jsonResponse({ run: legacy });
      if (url === '/api/skill-runs/incomplete-run?observeOnly=true') return jsonResponse({ run: incomplete });
      return jsonResponse({});
    }));

    render(<ChatPanel themeStyle="monochrome" projectId="project-1" canvasImages={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills技能库' }));
    fireEvent.click(await screen.findByText('平台素材合规检查'));
    expect(await screen.findByRole('button', { name: '查看任务 legacy-run' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看任务 current-run' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看任务 incomplete-run' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看任务 legacy-run' }));

    expect(await screen.findByRole('region', { name: '平台素材合规报告' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重新检查' })).toBeNull();
    expect(screen.getByText('旧运行记录缺少工作区信息，无法按当前规则复检')).toBeTruthy();
    expect(document.body.textContent).not.toContain('must-not-be-rendered');

    fireEvent.click(screen.getByRole('button', { name: '查看任务 incomplete-run' }));
    expect(await screen.findByText('旧运行记录缺少冻结复检上下文，无法按当前规则复检')).toBeTruthy();
    expect(screen.getByRole('region', { name: '平台素材合规报告' })).toBeTruthy();
  });

  it('keeps a restored report visible and disables recheck after its current Skill is deleted', async () => {
    const customSkill = {
      ...LOVART_PLATFORM_COMPLIANCE_SKILLS[0], id: 'custom-compliance', name: '自定义合规检查',
      version: 2, builtIn: false, category: 'custom',
    };
    const historicalReport = { ...report, runId: 'deleted-run' };
    integration.projections.set('deleted-run', completedProjection('deleted-run', canonicalComplianceReportJson(historicalReport)));
    const historical = {
      runId: 'deleted-run', projectId: 'project-1', surface: 'canvas', workspaceId: 'canvas:project-1',
      skillId: customSkill.id, skillVersion: 1, status: 'completed', createdAt: 1,
      inputValues: { sourceImages: [report.sourceVersionId], platform: 'Amazon', region: 'US', assetType: 'main' },
      sourceVersionIds: [report.sourceVersionId],
      modelBindings: { vision: { providerId: 'frozen-provider', modelId: 'frozen-vision' } },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === '/api/skills?surface=canvas') return jsonResponse({ skills: [customSkill] });
      if (url.startsWith('/api/models?')) return jsonResponse({ models: [], providers: [] });
      if (url.startsWith('/api/user-data/sync')) return jsonResponse({ data: null });
      if (url.startsWith('/api/chat-tasks?')) return jsonResponse({ tasks: [] });
      if (url.startsWith('/api/skill-runs?')) return jsonResponse({ runs: [historical] });
      if (url === '/api/skill-runs/deleted-run?observeOnly=true') return jsonResponse({ run: historical });
      if (url === '/api/skills/custom-compliance' && init?.method === 'DELETE') return jsonResponse({ success: true });
      return jsonResponse({});
    }));

    render(<ChatPanel themeStyle="gold" projectId="project-1" canvasImages={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills技能库' }));
    fireEvent.click(await screen.findByTitle('使用此 Skill'));
    fireEvent.click(await screen.findByRole('button', { name: '查看任务 deleted-run' }));
    expect(await screen.findByRole('region', { name: '平台素材合规报告' })).toBeTruthy();
    fireEvent.click(screen.getByTitle('删除'));

    await waitFor(() => expect(screen.getByText('当前 Skill 已删除或不可用，无法按当前规则复检')).toBeTruthy());
    expect(screen.getByRole('region', { name: '平台素材合规报告' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重新检查' })).toBeNull();
    expect(screen.getByRole('button', { name: '运行 Skill' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '估算积分' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows a projection failure inside the real ChatPanel after historical restore', async () => {
    integration.projections.set('old-run', completedProjection(
      'old-run',
      `${canonicalComplianceReportJson({ ...report, runId: 'old-run' })} `,
    ));
    const historical = {
      runId: 'old-run', projectId: 'project-1', surface: 'canvas', workspaceId: 'canvas:project-1',
      skillId: 'preset-platform-compliance-audit', skillVersion: 1, status: 'completed', createdAt: 1,
      inputValues: { sourceImages: [report.sourceVersionId], platform: 'Amazon', region: 'US', assetType: 'main' },
      sourceVersionIds: [report.sourceVersionId],
      modelBindings: { vision: { providerId: 'frozen-provider', modelId: 'frozen-vision' } },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === '/api/skills?surface=canvas') return jsonResponse({ skills: LOVART_PLATFORM_COMPLIANCE_SKILLS });
      if (url.startsWith('/api/models?')) return jsonResponse({ models: [], providers: [] });
      if (url.startsWith('/api/user-data/sync')) return jsonResponse({ data: null });
      if (url.startsWith('/api/chat-tasks?')) return jsonResponse({ tasks: [] });
      if (url.startsWith('/api/skill-runs?')) return jsonResponse({ runs: [historical] });
      if (url === '/api/skill-runs/old-run?observeOnly=true') return jsonResponse({ run: historical });
      return jsonResponse({});
    }));

    render(<ChatPanel themeStyle="gold" projectId="project-1" canvasImages={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills技能库' }));
    fireEvent.click(await screen.findByText('平台素材合规检查'));
    fireEvent.click(await screen.findByRole('button', { name: '查看任务 old-run' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('报告加载失败，请重试');
    expect(alert.textContent).not.toContain('reportId');
  });
});
