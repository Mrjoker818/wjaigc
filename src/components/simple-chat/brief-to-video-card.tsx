'use client';

import { Undo2 } from 'lucide-react';
import { useState } from 'react';

import { AgentProgressTimeline } from '@/components/agent-runtime/AgentProgressTimeline';
import { useAgentRunEvents } from '@/components/agent-runtime/use-agent-run-events';
import { BriefToVideoApprovalCard } from '@/components/skill-runtime/BriefToVideoApprovalCard';
import { BriefToVideoResultCard } from '@/components/skill-runtime/BriefToVideoResultCard';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { loadCompletedCanvasBriefVideoResult } from '@/lib/skill-runtime/canvas-client';
import type { SkillApprovalIdentity } from '@/lib/skill-runtime/approval';

interface BriefToVideoCardProps {
  runId: string;
  projectId: string;
  onReturnToCanvas: (references: WorkspaceAssetReference[]) => void | Promise<void>;
  fetcher?: typeof fetch;
}

export function BriefToVideoCard({
  runId,
  projectId,
  onReturnToCanvas,
  fetcher = fetch,
}: BriefToVideoCardProps): React.ReactElement {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const run = useAgentRunEvents(runId, refreshVersion);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const control = async (
    action: 'approve' | 'revise' | 'cancel',
    identity?: SkillApprovalIdentity,
    revisionInstruction?: string,
  ): Promise<boolean> => {
    const response = await fetcher(`/api/skill-runs/${encodeURIComponent(runId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...identity, ...(revisionInstruction ? { revisionInstruction } : {}) }),
    });
    if (!response.ok) throw new Error('视频任务控制失败');
    const payload = await response.json() as { accepted?: boolean; success?: boolean };
    const accepted = payload.accepted === true || payload.success === true;
    if (accepted) setRefreshVersion(value => value + 1);
    return accepted;
  };

  const returnToCanvas = async (): Promise<void> => {
    setPending(true);
    setError(undefined);
    try {
      const completed = await loadCompletedCanvasBriefVideoResult({ projectId, runId, fetcher });
      if (!completed) throw new Error('视频成片尚未准备完成');
      await onReturnToCanvas([completed.asset]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '返回画布失败');
    } finally {
      setPending(false);
    }
  };

  const waitingApproval = run.projection?.status === 'paused'
    && run.projection.error?.code === 'SKILL_APPROVAL_REQUIRED';
  const completed = run.projection?.status === 'completed';

  return (
    <section data-simple-chat-brief-video-run-id={runId}
      className="mt-3 min-w-0 space-y-3 border-t border-border pt-3" aria-live="polite">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Brief 到视频成片</h3>
        <p className="truncate text-xs text-muted-foreground">Run {runId}</p>
      </div>
      {!waitingApproval && !completed && (
        <AgentProgressTimeline projection={run.projection} stale={run.stale}
          onCancel={() => { void control('cancel'); }} />
      )}
      {waitingApproval && (
        <BriefToVideoApprovalCard runId={runId} projectId={projectId} fetcher={fetcher}
          onApprove={identity => control('approve', identity)}
          onRevise={(identity, instruction) => control('revise', identity, instruction)}
          onCancel={() => control('cancel')} />
      )}
      {completed && <>
        <BriefToVideoResultCard runId={runId} projectId={projectId} fetcher={fetcher} />
        <button type="button" disabled={pending} aria-label="返回画布"
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => { void returnToCanvas(); }}>
          <Undo2 className="h-4 w-4" aria-hidden="true" />返回画布
        </button>
      </>}
      {error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}
    </section>
  );
}
