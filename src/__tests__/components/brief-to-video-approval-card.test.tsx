// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BriefToVideoApprovalCard } from '@/components/skill-runtime/BriefToVideoApprovalCard';
import { BriefToVideoResultCard } from '@/components/skill-runtime/BriefToVideoResultCard';

const plan = {
  schemaId: 'brief-to-video-plan-v1',
  title: '夏日新品短片',
  logline: '用清爽镜头呈现新品上市。',
  durationSeconds: 15,
  aspectRatio: '9:16',
  scenes: [{
    order: 1, timeRange: '0-15s', visual: '产品置于夏日水面', camera: '缓慢推进',
    action: '水波掠过产品', textOverlay: '清爽上市',
  }],
  finalVideoPrompt: '夏日水面上的产品广告短片，镜头缓慢推进。',
  negativePrompt: '文字变形，产品变形',
  factualConstraints: ['保持包装文字准确'],
};

const approval = {
  schemaId: 'skill-approval-state-v1', status: 'pending', stepId: 'plan-film',
  nextStepId: 'generate-film', outputSchemaId: 'brief-to-video-plan-v1',
  planChecksum: 'a'.repeat(64), revision: 3, generation: 1, allowRevision: true,
};

function approvalResponse(): Response {
  return Response.json({ run: {
    runId: 'run-video-1', projectId: 'project-1', status: 'paused', approval,
    steps: [{ id: 'plan-film', cost: 5 }, { id: 'generate-film', cost: 120 }],
    outputs: [{ stepId: 'plan-film', kind: 'json', schemaId: 'brief-to-video-plan-v1', content: JSON.stringify(plan) }],
  } });
}

describe('BriefToVideoApprovalCard', () => {
  it('shows the approved plan boundary and responsive controls without fake generation progress', async () => {
    const onApprove = vi.fn().mockResolvedValue(true);
    const onRevise = vi.fn().mockResolvedValue(true);
    const onCancel = vi.fn().mockResolvedValue(true);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(approvalResponse());

    render(<BriefToVideoApprovalCard
      runId="run-video-1" projectId="project-1"
      estimate={{ minimum: 125, maximum: 125, steps: [
        { stepId: 'plan-film', cost: 5 }, { stepId: 'generate-film', cost: 120 },
      ] }}
      onApprove={onApprove} onRevise={onRevise} onCancel={onCancel} fetcher={fetcher}
    />);

    expect(await screen.findByRole('heading', { name: '夏日新品短片' })).not.toBeNull();
    expect(screen.getByText('视频步骤预计 120 积分')).not.toBeNull();
    expect(screen.getByText('0-15s')).not.toBeNull();
    expect((screen.getByRole('button', { name: '批准生成' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '修改脚本' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '取消任务' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('生成中')).toBeNull();
    expect(screen.getByTestId('brief-video-approval-actions').className).toContain('grid-cols-1');
    expect(screen.getByRole('button', { name: '批准生成' }).className).toContain('min-h-10');

    fireEvent.click(screen.getByRole('button', { name: '批准生成' }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({
      revision: 3, generation: 1, planChecksum: 'a'.repeat(64),
    }));

    fireEvent.click(screen.getByRole('button', { name: '修改脚本' }));
    fireEvent.change(screen.getByLabelText('脚本修改要求'), { target: { value: '减少字幕，强化产品特写' } });
    fireEvent.click(screen.getByRole('button', { name: '提交修改要求' }));
    await waitFor(() => expect(onRevise).toHaveBeenCalledWith(
      { revision: 3, generation: 1, planChecksum: 'a'.repeat(64) },
      '减少字幕，强化产品特写',
    ));
  });

  it('shows the authoritative video estimate loaded from the same Run', async () => {
    render(<BriefToVideoApprovalCard
      runId="run-video-1" projectId="project-1" onApprove={vi.fn()}
      onRevise={vi.fn()} onCancel={vi.fn()} fetcher={vi.fn<typeof fetch>().mockResolvedValue(approvalResponse())}
    />);

    expect(await screen.findByText('视频步骤预计 120 积分')).not.toBeNull();
  });

  it('rejects a history payload from a different project', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      run: { ...(await approvalResponse().json()).run, projectId: 'project-other' },
    }));
    render(<BriefToVideoApprovalCard
      runId="run-video-1" projectId="project-1" onApprove={vi.fn()}
      onRevise={vi.fn()} onCancel={vi.fn()} fetcher={fetcher}
    />);
    expect((await screen.findByRole('alert')).textContent).toContain('审批数据与当前项目不一致');
  });
});

describe('BriefToVideoResultCard', () => {
  it('loads the authorized finished video AssetVersion and exposes playback and download', async () => {
    const versionId = 'av_01JVIDEORESULT000000000000001';
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url === '/api/skill-runs/run-video-1') return Response.json({ run: {
        runId: 'run-video-1', status: 'completed', assetVersionIds: [versionId], outputs: [{
          stepId: 'generate-film', kind: 'json', schemaId: 'brief-to-video-result-v1',
          content: JSON.stringify({
            schemaId: 'brief-to-video-result-v1', runId: 'run-video-1',
            planChecksum: 'b'.repeat(64), videoAssetVersionId: versionId,
            sourceAssetVersionIds: [], providerId: 'pear', modelId: 'video-model',
            durationSeconds: 15, aspectRatio: '9:16', resolution: '1080p',
          }),
        }],
      } });
      return Response.json({
        assetId: 'asset-video-1', assetVersionId: versionId, kind: 'video',
        url: '/api/serve-upload/video/run-video-1/result.mp4',
      });
    });

    const { container } = render(<BriefToVideoResultCard
      runId="run-video-1" projectId="project-1" fetcher={fetcher}
    />);

    expect(await screen.findByRole('heading', { name: '视频成片' })).not.toBeNull();
    expect(container.querySelector('video')?.getAttribute('src'))
      .toBe('/api/serve-upload/video/run-video-1/result.mp4');
    expect(screen.getByText('15 秒 · 9:16 · 1080p')).not.toBeNull();
    expect(screen.getByRole('link', { name: '下载成片' }).getAttribute('href'))
      .toBe('/api/serve-upload/video/run-video-1/result.mp4');
  });
});
