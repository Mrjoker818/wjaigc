// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  download: vi.fn(),
  resolveImages: vi.fn(),
  runEvents: vi.fn(),
}));

vi.mock('@/components/agent-runtime/use-agent-run-events', () => ({
  useAgentRunEvents: () => mocks.runEvents(),
}));

const completedRun = {
    projection: {
      runId: 'run-export-1', status: 'completed', lastSequence: 4, plan: [],
      assetVersionIds: ['image-v1', 'manifest-v1', 'zip-v1'], ignoredEventIds: [],
      missingSequences: [], qualityChecks: [],
      result: {
        outputs: [{
          stepId: 'export', kind: 'json', schemaId: 'multi-platform-export-result-v1',
          content: JSON.stringify({
            schemaVersion: 1, runId: 'run-export-1', outcome: 'partial_success',
            imageAssetVersionIds: ['image-v1'], manifestAssetVersionId: 'manifest-v1',
            zipAssetVersionId: 'zip-v1',
            failures: [{ sourceAssetVersionId: 'source-v2', code: 'EXPORT_FAILED', retryable: true }],
          }),
        }],
      },
    },
    stale: false,
    cancel: mocks.cancel,
    pause: vi.fn(),
    resume: vi.fn(),
};

vi.mock('@/lib/skill-runtime/multi-platform-export-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/skill-runtime/multi-platform-export-client')>();
  return {
    ...actual,
    downloadExportArtifact: mocks.download,
    resolveExportImageReferences: mocks.resolveImages,
  };
});

import { MultiPlatformExportCard } from '@/components/simple-chat/multi-platform-export-card';

describe('Simple Chat multi-platform export result card', () => {
  beforeEach(() => {
    mocks.runEvents.mockReturnValue(completedRun);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('restores one durable Run and exposes its existing image, ZIP, and manifest versions', async () => {
    render(<MultiPlatformExportCard
      runId="run-export-1"
      projectId="project-1"
      onReturnToCanvas={vi.fn()}
    />);

    expect(screen.getByRole('heading', { name: '多平台批量导出' })).not.toBeNull();
    expect(screen.getByText('Run run-export-1')).not.toBeNull();
    expect(screen.getByText('1 个成功 · 1 个失败')).not.toBeNull();
    expect(screen.getByText('image-v1')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith('zip-v1', 'project-1'));
    fireEvent.click(screen.getByRole('button', { name: '下载 manifest' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith('manifest-v1', 'project-1'));
  });

  it('returns the same managed image versions to canvas without creating replacements', async () => {
    const references = [{
      assetId: 'asset-1', assetVersionId: 'image-v1', placementId: 'placement-1',
      kind: 'image' as const, url: '/exports/image-v1.png',
    }];
    const onReturnToCanvas = vi.fn();
    mocks.resolveImages.mockResolvedValue(references);
    render(<MultiPlatformExportCard
      runId="run-export-1"
      projectId="project-1"
      onReturnToCanvas={onReturnToCanvas}
    />);

    fireEvent.click(screen.getByRole('button', { name: '返回画布' }));

    await waitFor(() => expect(onReturnToCanvas).toHaveBeenCalledWith(references));
    expect(mocks.resolveImages).toHaveBeenCalledWith({
      projectId: 'project-1', versionIds: ['image-v1'],
    });
  });

  it('recovers the same durable result from Run history after refresh', async () => {
    mocks.runEvents.mockReturnValue({
      ...completedRun,
      projection: { ...completedRun.projection, status: 'created', result: undefined },
    });
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      run: { outputs: completedRun.projection.result.outputs },
    }));
    vi.stubGlobal('fetch', fetcher);

    render(<MultiPlatformExportCard
      runId="run-export-1"
      projectId="project-1"
      onReturnToCanvas={vi.fn()}
    />);

    expect(await screen.findByText('1 个成功 · 1 个失败')).not.toBeNull();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/skill-runs/run-export-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText('Run run-export-1')).not.toBeNull();
  });

  it('reloads durable partial outputs when an in-flight Run reaches failed terminal state', async () => {
    const inFlightRun = {
      ...completedRun,
      projection: { ...completedRun.projection, status: 'executing', result: undefined },
    };
    mocks.runEvents.mockReturnValue(inFlightRun);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ run: { outputs: [] } }))
      .mockResolvedValueOnce(Response.json({
        run: { outputs: completedRun.projection.result.outputs },
      }));
    vi.stubGlobal('fetch', fetcher);
    const { rerender } = render(<MultiPlatformExportCard
      runId="run-export-1"
      projectId="project-1"
      onReturnToCanvas={vi.fn()}
    />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    mocks.runEvents.mockReturnValue({
      ...inFlightRun,
      projection: { ...inFlightRun.projection, status: 'failed' },
    });
    rerender(<MultiPlatformExportCard
      runId="run-export-1"
      projectId="project-1"
      onReturnToCanvas={vi.fn()}
    />);

    expect(await screen.findByText('1 个成功 · 1 个失败')).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
