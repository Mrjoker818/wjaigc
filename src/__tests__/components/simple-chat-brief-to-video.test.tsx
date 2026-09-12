// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  loadResult: vi.fn(),
  runEvents: vi.fn(),
}));

vi.mock('@/components/agent-runtime/use-agent-run-events', () => ({
  useAgentRunEvents: (runId: string, refreshVersion: number) => mocks.runEvents(runId, refreshVersion),
}));
vi.mock('@/lib/skill-runtime/canvas-client', () => ({
  loadCompletedCanvasBriefVideoResult: mocks.loadResult,
}));
vi.mock('@/components/skill-runtime/BriefToVideoApprovalCard', () => ({
  BriefToVideoApprovalCard: ({ runId, onApprove, onCancel }: {
    runId: string;
    onApprove: (identity: { revision: number; generation: number; planChecksum: string }) => Promise<boolean>;
    onCancel: () => Promise<boolean>;
  }) => <div>
    <button type="button" onClick={() => void onApprove({
      revision: 2, generation: 1, planChecksum: 'checksum-1',
    })}>批准 {runId}</button>
    <button type="button" onClick={() => void onCancel()}>取消 {runId}</button>
  </div>,
}));
vi.mock('@/components/skill-runtime/BriefToVideoResultCard', () => ({
  BriefToVideoResultCard: ({ runId }: { runId: string }) => <div>成片 {runId}</div>,
}));

import { BriefToVideoCard } from '@/components/simple-chat/brief-to-video-card';

describe('Simple Chat Brief to video card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancel.mockResolvedValue(true);
  });

  it('approves the paused plan on the same Run', async () => {
    mocks.runEvents.mockReturnValue({
      projection: { status: 'paused', error: { code: 'SKILL_APPROVAL_REQUIRED' } },
      stale: false,
      cancel: mocks.cancel,
    });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true }));
    render(<BriefToVideoCard runId="run-video-1" projectId="project-1"
      onReturnToCanvas={vi.fn()} fetcher={fetcher} />);

    fireEvent.click(screen.getByRole('button', { name: '批准 run-video-1' }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      '/api/skill-runs/run-video-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          action: 'approve', revision: 2, generation: 1, planChecksum: 'checksum-1',
        }),
      }),
    ));
    await waitFor(() => expect(mocks.runEvents).toHaveBeenCalledWith('run-video-1', 1));
  });

  it('returns the existing video AssetVersion for placement without creating a replacement asset', async () => {
    mocks.runEvents.mockReturnValue({
      projection: { status: 'completed' }, stale: false, cancel: mocks.cancel,
    });
    const asset = {
      assetId: 'asset-video-1', assetVersionId: 'video-v1', kind: 'video' as const,
      url: '/videos/final.mp4',
    };
    mocks.loadResult.mockResolvedValue({
      result: { sourceAssetVersionIds: ['frame-v1'] }, asset,
    });
    const onReturnToCanvas = vi.fn();
    render(<BriefToVideoCard runId="run-video-1" projectId="project-1"
      onReturnToCanvas={onReturnToCanvas} />);

    fireEvent.click(screen.getByRole('button', { name: '返回画布' }));

    await waitFor(() => expect(onReturnToCanvas).toHaveBeenCalledWith([asset]));
    expect(mocks.loadResult).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-video-1', projectId: 'project-1',
    }));
  });

  it('cancels through the same Skill Run control API', async () => {
    mocks.runEvents.mockReturnValue({
      projection: { status: 'paused', error: { code: 'SKILL_APPROVAL_REQUIRED' } },
      stale: false,
      cancel: mocks.cancel,
    });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ accepted: true }));
    render(<BriefToVideoCard runId="run-video-1" projectId="project-1"
      onReturnToCanvas={vi.fn()} fetcher={fetcher} />);

    fireEvent.click(screen.getByRole('button', { name: '取消 run-video-1' }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      '/api/skill-runs/run-video-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ action: 'cancel' }) }),
    ));
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
