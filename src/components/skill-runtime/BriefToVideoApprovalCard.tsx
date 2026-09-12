'use client';

import { Check, Pencil, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { parseBriefToVideoPlan } from '@/lib/brief-to-video/schema';
import type { BriefToVideoPlanV1 } from '@/lib/brief-to-video/types';
import { parseSkillApprovalState, type SkillApprovalIdentity, type SkillApprovalStateV1 } from '@/lib/skill-runtime/approval';
import type { SkillRunCostEstimate } from '@/lib/skill-runtime/cost-estimator';
import { parseDurableSkillOutputs } from '@/lib/skill-runtime/structured-output';

interface BriefToVideoApprovalCardProps {
  runId: string;
  projectId: string;
  estimate?: SkillRunCostEstimate;
  busy?: boolean;
  onApprove: (identity: SkillApprovalIdentity) => Promise<boolean>;
  onRevise: (identity: SkillApprovalIdentity, revisionInstruction: string) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
  fetcher?: typeof fetch;
}

interface ApprovalView {
  approval: SkillApprovalStateV1;
  plan: BriefToVideoPlanV1;
}

const primaryAction = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-3 text-xs font-semibold text-[#0a0a0b] hover:bg-[#e2c45c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4af37] disabled:cursor-not-allowed disabled:opacity-50';
const secondaryAction = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-current/20 px-3 text-xs font-medium hover:bg-current/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

function approvalIdentity(approval: SkillApprovalStateV1): SkillApprovalIdentity {
  return {
    revision: approval.revision,
    generation: approval.generation,
    planChecksum: approval.planChecksum,
  };
}

async function loadApproval(
  runId: string,
  projectId: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<ApprovalView> {
  const response = await fetcher(`/api/skill-runs/${encodeURIComponent(runId)}?observeOnly=true`, {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
  });
  if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录' : '视频脚本加载失败');
  const payload = await response.json() as { run?: Record<string, unknown> };
  const run = payload.run;
  if (!run || run.runId !== runId || run.projectId !== projectId) {
    throw new Error('审批数据与当前项目不一致');
  }
  if (run.status !== 'paused') throw new Error('视频脚本已不在待审批状态');
  const approval = parseSkillApprovalState(run.approval);
  const outputs = parseDurableSkillOutputs(run.outputs);
  const output = outputs.findLast(candidate => (
    candidate.kind === 'json' && candidate.schemaId === approval.outputSchemaId
  ));
  if (!output || output.kind !== 'json' || output.schemaId !== 'brief-to-video-plan-v1') {
    throw new Error('视频脚本数据缺失或版本不兼容');
  }
  return { approval, plan: parseBriefToVideoPlan(JSON.parse(output.content) as unknown) };
}

export function BriefToVideoApprovalCard({
  runId,
  projectId,
  estimate,
  busy = false,
  onApprove,
  onRevise,
  onCancel,
  fetcher = fetch,
}: BriefToVideoApprovalCardProps): React.ReactElement {
  const [view, setView] = useState<ApprovalView>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [revisionInstruction, setRevisionInstruction] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setView(undefined);
    setError(undefined);
    void loadApproval(runId, projectId, fetcher, controller.signal)
      .then(setView)
      .catch(cause => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : '视频脚本加载失败');
        }
      });
    return () => controller.abort();
  }, [fetcher, projectId, runId]);

  const perform = async (operation: () => Promise<boolean>): Promise<void> => {
    setSubmitting(true);
    setError(undefined);
    try {
      if (!await operation()) setError('操作未被接受，请刷新后重试');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const videoCost = estimate?.steps.find(step => step.stepId === 'generate-film')?.cost;
  const disabled = busy || submitting || !view;

  return (
    <section className="min-w-0 space-y-3 border-t border-current/15 pt-3" aria-label="视频脚本审批">
      {!view && !error && <div role="status" className="text-xs text-muted-foreground">正在加载待确认脚本...</div>}
      {error && <div role="alert" className="break-words text-xs text-destructive">{error}</div>}
      {view && <>
        <div className="min-w-0 space-y-1">
          <div className="text-[11px] font-medium text-[#d4af37]">待确认脚本</div>
          <h3 className="break-words text-sm font-semibold">{view.plan.title}</h3>
          <p className="break-words text-xs text-muted-foreground">{view.plan.logline}</p>
          <p className="text-xs font-medium">
            {typeof videoCost === 'number' ? `视频步骤预计 ${videoCost} 积分` : '视频步骤费用以批准时服务端结算为准'}
          </p>
        </div>
        <ol className="space-y-2" aria-label="视频分镜">
          {view.plan.scenes.map(scene => <li key={scene.order} className="min-w-0 rounded-lg bg-current/[0.04] p-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
              <span>镜头 {scene.order}</span><span>{scene.timeRange}</span>
            </div>
            <p className="mt-1 break-words text-muted-foreground">{scene.visual}</p>
            <p className="mt-1 break-words">{scene.camera} · {scene.action}</p>
            {scene.textOverlay && <p className="mt-1 break-words">字幕：{scene.textOverlay}</p>}
          </li>)}
        </ol>
        {editing && <div className="space-y-2">
          <label htmlFor={`brief-video-revision-${runId}`} className="block text-xs font-medium">脚本修改要求</label>
          <textarea
            id={`brief-video-revision-${runId}`}
            value={revisionInstruction}
            maxLength={2_000}
            rows={3}
            disabled={busy || submitting}
            onChange={event => setRevisionInstruction(event.target.value)}
            className="w-full resize-y rounded-lg border border-current/20 bg-transparent px-3 py-2 text-xs outline-none focus-visible:border-[#d4af37]"
          />
          <button type="button" className={`${primaryAction} w-full`} disabled={disabled || !revisionInstruction.trim()}
            onClick={() => { void perform(() => onRevise(
              approvalIdentity(view.approval), revisionInstruction.trim(),
            )); }}>
            提交修改要求
          </button>
        </div>}
        <div data-testid="brief-video-approval-actions" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button type="button" className={primaryAction} disabled={disabled}
            onClick={() => { void perform(() => onApprove(approvalIdentity(view.approval))); }}>
            <Check className="h-4 w-4" aria-hidden="true" />批准生成
          </button>
          <button type="button" className={secondaryAction} disabled={disabled || !view.approval.allowRevision}
            aria-expanded={editing} onClick={() => setEditing(value => !value)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />修改脚本
          </button>
          <button type="button" className={secondaryAction} disabled={disabled}
            onClick={() => { void perform(onCancel); }}>
            <X className="h-4 w-4" aria-hidden="true" />取消任务
          </button>
        </div>
      </>}
    </section>
  );
}
