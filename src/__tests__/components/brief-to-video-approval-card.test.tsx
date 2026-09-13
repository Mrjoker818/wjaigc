// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function approvalResponse(
  approvalOverride: Partial<typeof approval> = {},
  planOverride: Partial<typeof plan> = {},
  runOverride: Record<string, unknown> = {},
): Response {
  return Response.json({ run: {
    runId: 'run-video-1', projectId: 'project-1', status: 'paused',
    approval: { ...approval, ...approvalOverride },
    steps: [{ id: 'plan-film', cost: 5 }, { id: 'generate-film', cost: 120 }],
    outputs: [{
      stepId: 'plan-film', kind: 'json', schemaId: 'brief-to-video-plan-v1',
      content: JSON.stringify({ ...plan, ...planOverride }),
    }],
    ...runOverride,
  } });
}

describe('BriefToVideoApprovalCard', () => {
  it('removes each approval refresh abort listener after its timer resolves', async () => {
    const addSpy = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const removeSpy = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
    try {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(approvalResponse())
        .mockResolvedValueOnce(new Response(JSON.stringify({ run: {
          ...(await approvalResponse().json()).run,
          status: 'queued',
        } }), { status: 200 }))
        .mockResolvedValueOnce(approvalResponse());
      const onRevise = vi.fn(async () => true);
      render(<BriefToVideoApprovalCard
        runId="run-video-1" projectId="project-1" fetcher={fetcher as typeof fetch}
        onApprove={vi.fn(async () => true)} onRevise={onRevise} onCancel={vi.fn(async () => true)}
      />);
      expect(await screen.findByRole('heading', { name: '夏日新品短片' })).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '修改脚本' }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '加快节奏' } });
      fireEvent.click(screen.getByRole('button', { name: '提交修改要求' }));
      await waitFor(() => expect(onRevise).toHaveBeenCalledOnce());
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
      expect(removeSpy.mock.calls.length).toBeGreaterThanOrEqual(addSpy.mock.calls.length);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

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
    expect(screen.getByTestId('brief-video-approval-actions').className).toContain('grid-cols-1 gap-2');
    for (const name of ['批准生成', '修改脚本', '取消任务']) {
      expect(screen.getByRole('button', { name }).className).toContain('min-h-[44px]');
    }

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

  it('reloads the authoritative approval identity after a successful revision', async () => {
    const revisedChecksum = 'b'.repeat(64);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(approvalResponse())
      .mockResolvedValueOnce(approvalResponse(
        { revision: 11, generation: 1, planChecksum: revisedChecksum },
        { title: '修改后的夏日新品短片' },
      ));
    const onApprove = vi.fn().mockResolvedValue(true);
    const onRevise = vi.fn().mockResolvedValue(true);

    render(<BriefToVideoApprovalCard
      runId="run-video-1" projectId="project-1" onApprove={onApprove}
      onRevise={onRevise} onCancel={vi.fn()} fetcher={fetcher}
    />);

    expect(await screen.findByRole('heading', { name: '夏日新品短片' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '修改脚本' }));
    fireEvent.change(screen.getByLabelText('脚本修改要求'), { target: { value: '减少字幕' } });
    fireEvent.click(screen.getByRole('button', { name: '提交修改要求' }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/skill-runs/run-video-1?observeOnly=true',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(await screen.findByRole('heading', { name: '修改后的夏日新品短片' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '批准生成' }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({
      revision: 11, generation: 1, planChecksum: revisedChecksum,
    }));
  });

  it('waits for the revised run to pause again before exposing its new approval identity', async () => {
    const revisedChecksum = 'c'.repeat(64);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(approvalResponse())
      .mockResolvedValueOnce(approvalResponse({}, {}, { status: 'executing' }))
      .mockResolvedValueOnce(approvalResponse({}, {}, { status: 'planning' }))
      .mockResolvedValueOnce(approvalResponse(
        { revision: 12, generation: 2, planChecksum: revisedChecksum },
        { title: '异步修订后的脚本' },
      ));
    const onApprove = vi.fn().mockResolvedValue(true);

    render(<BriefToVideoApprovalCard
      runId="run-video-1" projectId="project-1" onApprove={onApprove}
      onRevise={vi.fn().mockResolvedValue(true)} onCancel={vi.fn()} fetcher={fetcher}
    />);

    expect(await screen.findByRole('heading', { name: '夏日新品短片' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '修改脚本' }));
    fireEvent.change(screen.getByLabelText('脚本修改要求'), { target: { value: '异步重写脚本' } });
    fireEvent.click(screen.getByRole('button', { name: '提交修改要求' }));

    expect(await screen.findByRole('heading', { name: '异步修订后的脚本' }, { timeout: 2_000 })).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole('button', { name: '批准生成' }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({
      revision: 12, generation: 2, planChecksum: revisedChecksum,
    }));
  });

  it('does not let a completed revision from the previous run overwrite the current run', async () => {
    let resolveRevision: (accepted: boolean) => void = () => undefined;
    const onRevise = vi.fn().mockReturnValue(new Promise<boolean>(resolve => {
      resolveRevision = resolve;
    }));
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.includes('run-video-2')) {
        return approvalResponse(
          { revision: 20, generation: 4, planChecksum: 'd'.repeat(64) },
          { title: '第二个 Run 的脚本' },
          { runId: 'run-video-2', projectId: 'project-2' },
        );
      }
      return approvalResponse();
    });
    const props = {
      onApprove: vi.fn(), onRevise, onCancel: vi.fn(), fetcher,
    };
    const { rerender } = render(<BriefToVideoApprovalCard
      runId="run-video-1" projectId="project-1" {...props}
    />);

    expect(await screen.findByRole('heading', { name: '夏日新品短片' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '修改脚本' }));
    fireEvent.change(screen.getByLabelText('脚本修改要求'), { target: { value: '延迟完成' } });
    fireEvent.click(screen.getByRole('button', { name: '提交修改要求' }));
    await waitFor(() => expect(onRevise).toHaveBeenCalledOnce());

    rerender(<BriefToVideoApprovalCard
      runId="run-video-2" projectId="project-2" {...props}
    />);
    await waitFor(() => expect(fetcher.mock.calls.some(([input]) => String(input).includes('run-video-2'))).toBe(true));
    expect(await screen.findByRole('heading', { name: '第二个 Run 的脚本' })).not.toBeNull();
    await act(async () => resolveRevision(true));

    await waitFor(() => expect(screen.getByRole('heading', { name: '第二个 Run 的脚本' })).not.toBeNull());
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('run-video-1'))).toHaveLength(1);
  });

  it('does not reload approval after unmounting during a revision', async () => {
    let resolveRevision: (accepted: boolean) => void = () => undefined;
    const onRevise = vi.fn().mockReturnValue(new Promise<boolean>(resolve => {
      resolveRevision = resolve;
    }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(approvalResponse());
    const { unmount } = render(<BriefToVideoApprovalCard
      runId="run-video-1" projectId="project-1" onApprove={vi.fn()}
      onRevise={onRevise} onCancel={vi.fn()} fetcher={fetcher}
    />);

    expect(await screen.findByRole('heading', { name: '夏日新品短片' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '修改脚本' }));
    fireEvent.change(screen.getByLabelText('脚本修改要求'), { target: { value: '减少字幕' } });
    fireEvent.click(screen.getByRole('button', { name: '提交修改要求' }));
    await waitFor(() => expect(onRevise).toHaveBeenCalledOnce());

    unmount();
    await act(async () => resolveRevision(true));
    expect(fetcher).toHaveBeenCalledOnce();
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
