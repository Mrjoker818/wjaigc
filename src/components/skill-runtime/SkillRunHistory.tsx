'use client';

import { useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import type { DurableSkillOutput, SkillSurface } from '@/lib/skill-runtime/types';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';
import { parseSkillApprovalState, type SkillApprovalStateV1 } from '@/lib/skill-runtime/approval';
import type { SkillRunRestoreIdentity } from './use-skill-run';

export interface SkillRunHistoryItem extends SkillRunRestoreIdentity {
  workspaceId?: string;
  skillVersion?: number;
  status: string;
  createdAt: number;
  sourceVersionIds?: string[];
  inputValues?: Record<string, unknown>;
  modelBindings?: SkillRunRequest['modelBindings'];
  outputs?: DurableSkillOutput[];
  approval?: SkillApprovalStateV1;
}

interface SkillRunHistoryProps {
  projectId: string;
  surface: SkillSurface;
  skillId: string;
  accountKey: string;
  activeRunId?: string;
  refreshKey?: string;
  busy?: boolean;
  onSelect: (run: SkillRunHistoryItem) => void;
  fetcher?: typeof fetch;
}

const labels: Record<string, string> = {
  created: '待执行', queued: '排队中', planning: '规划中', 'awaiting-confirmation': '等待确认',
  executing: '执行中', uploading: '保存中', paused: '已暂停', completed: '已完成',
  failed: '失败', cancelled: '已取消', timeout: '超时',
};

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value as Record<string, unknown>)
    : undefined;
}

function parseHistoryItem(value: unknown, scope: {
  projectId: string;
  surface: SkillSurface;
  skillId: string;
}): SkillRunHistoryItem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.runId !== 'string' || !item.runId || item.projectId !== scope.projectId
    || item.surface !== scope.surface || item.skillId !== scope.skillId || typeof item.status !== 'string'
    || !Object.hasOwn(labels, item.status) || typeof item.createdAt !== 'number'
    || !Number.isFinite(item.createdAt) || Math.abs(item.createdAt) > 8.64e15) return undefined;
  const sourceVersionIds = Array.isArray(item.sourceVersionIds)
    && item.sourceVersionIds.every(id => typeof id === 'string')
    ? [...item.sourceVersionIds] as string[] : undefined;
  const outputs = Array.isArray(item.outputs)
    ? structuredClone(item.outputs) as DurableSkillOutput[] : undefined;
  const approval = item.approval === undefined ? undefined : parseSkillApprovalState(item.approval);
  return {
    runId: item.runId,
    projectId: scope.projectId,
    surface: scope.surface,
    skillId: scope.skillId,
    status: item.status,
    createdAt: item.createdAt,
    ...(typeof item.workspaceId === 'string' && item.workspaceId ? { workspaceId: item.workspaceId } : {}),
    ...(Number.isSafeInteger(item.skillVersion) && Number(item.skillVersion) > 0
      ? { skillVersion: Number(item.skillVersion) } : {}),
    ...(sourceVersionIds ? { sourceVersionIds } : {}),
    ...(optionalRecord(item.inputValues) ? { inputValues: optionalRecord(item.inputValues) } : {}),
    ...(optionalRecord(item.modelBindings)
      ? { modelBindings: optionalRecord(item.modelBindings) as SkillRunRequest['modelBindings'] } : {}),
    ...(outputs ? { outputs } : {}),
    ...(approval ? { approval } : {}),
  };
}

function runStatusLabel(run: SkillRunHistoryItem): string {
  return run.status === 'paused' && run.approval ? '待审批' : labels[run.status];
}

export function SkillRunHistory({ projectId, surface, skillId, accountKey, activeRunId,
  refreshKey, busy = false, onSelect, fetcher = fetch }: SkillRunHistoryProps): React.ReactElement {
  const scopeKey = JSON.stringify([accountKey, projectId, surface, skillId]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; loading: boolean; runs: SkillRunHistoryItem[]; error?: string }>({
    key: scopeKey, loading: true, runs: [],
  });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    setState({ key: scopeKey, loading: true, runs: [] });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    const params = new URLSearchParams({ projectId, surface, skillId, observeOnly: 'true', limit: '20' });
    void (async () => {
      try {
        const response = await fetcher(`/api/skill-runs?${params}`, {
          method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录' : '运行记录加载失败');
        const body: unknown = await response.json();
        const runs = body && typeof body === 'object' && 'runs' in body ? body.runs : undefined;
        if (!Array.isArray(runs) || runs.length > 20) throw new Error('运行记录响应无效，请刷新重试');
        const parsedRuns = runs.map(run => parseHistoryItem(run, { projectId, surface, skillId }));
        if (parsedRuns.some(run => !run)) throw new Error('运行记录响应无效，请刷新重试');
        if (active && !controller.signal.aborted) setState({
          key: scopeKey,
          loading: false,
          runs: parsedRuns as SkillRunHistoryItem[],
        });
      } catch (error) {
        if (active) setState({ key: scopeKey, loading: false, runs: [],
          error: timedOut ? '运行记录加载超时，请重试' : error instanceof Error ? error.message : '运行记录加载失败' });
      } finally { clearTimeout(timer); }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [accountKey, projectId, surface, skillId, scopeKey, revision, refreshKey, fetcher]);

  const current = state.key === scopeKey ? state : { loading: true, runs: [], error: undefined };
  return <section aria-label="Skill 运行记录" className="min-w-0 border-t border-current/15 pt-2 text-xs">
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1"><History size={13} aria-hidden="true" />运行记录</span>
      <button type="button" aria-label="刷新运行记录" title="刷新运行记录" disabled={current.loading || busy}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-current/10 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
        onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} aria-hidden="true" /></button>
    </div>
    {current.loading && <p role="status">正在加载运行记录...</p>}
    {current.error && <p role="alert" className="break-words text-red-500">{current.error}</p>}
    {!current.loading && !current.error && current.runs.length === 0 && <p>暂无运行记录</p>}
    <ul className="max-h-40 overflow-y-auto">
      {current.runs.map(run => <li key={run.runId} className="border-b border-current/10 last:border-0">
        <button type="button" aria-label={`查看任务 ${run.runId}`} aria-pressed={run.runId === activeRunId}
          disabled={busy} onClick={() => onSelect(run)}
          className="flex min-h-9 w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1 py-2 text-left hover:bg-current/10 focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
          <span>{runStatusLabel(run)}</span><time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleString('zh-CN')}</time>
          <span className="w-full break-all font-mono text-[10px]">{run.runId}</span>
        </button>
      </li>)}
    </ul>
  </section>;
}
