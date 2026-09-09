// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MultiPlatformExportDrawer } from '@/components/skill-runtime/MultiPlatformExportDrawer';
import type { AgentRunProjection } from '@/lib/agent-runtime/types';

const enabledPresets = [
  {
    id: 'instagram-post', version: 1, platform: 'Instagram', usage: 'post',
    label: 'Instagram 帖子', width: 1080, height: 1080,
    recommendedFormat: 'png' as const, supportsTransparency: true, enabled: true,
  },
  {
    id: 'youtube-cover', version: 1, platform: 'YouTube', usage: 'cover',
    label: 'YouTube 封面', width: 1280, height: 720,
    recommendedFormat: 'jpeg' as const, supportsTransparency: false, enabled: true,
  },
];

function projection(overrides: Partial<AgentRunProjection> = {}): AgentRunProjection {
  return {
    runId: 'run-export-1', status: 'executing', lastSequence: 4,
    plan: [{ id: 'export', label: '生成平台尺寸', status: 'processing' }],
    assetVersionIds: [], ignoredEventIds: [], missingSequences: [], qualityChecks: [],
    progress: 25,
    ...overrides,
  };
}

describe('MultiPlatformExportDrawer', () => {
  it('renders a bottom-toolbar drawer with the six approved sections and responsive controls', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      presets: [...enabledPresets, { ...enabledPresets[0], id: 'disabled', enabled: false }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    render(
      <MultiPlatformExportDrawer
        open
        projectId="project-1"
        sourceAssetVersionIds={['version-source-1', 'version-source-2']}
        values={{ fit: 'cover', background: '#ffffffff', namingTemplate: '{asset}-{size}' }}
        onChange={vi.fn()}
        onEstimate={vi.fn()}
        onStart={vi.fn()}
        onClose={vi.fn()}
        fetcher={fetcher}
      />,
    );

    expect(screen.getByRole('heading', { name: '多平台批量导出' })).not.toBeNull();
    for (const label of ['素材', '目标平台', '适配方式', '命名', '执行预览', '结果']) {
      expect(screen.getByRole('heading', { name: label })).not.toBeNull();
    }
    const drawer = screen.getByTestId('multi-platform-export-drawer');
    expect(drawer.hasAttribute('data-bottom-toolbar-drawer')).toBe(true);
    expect(drawer.className).toContain('bottom-');
    expect(drawer.querySelector('.grid-cols-1')).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    await waitFor(() => expect(screen.getByLabelText('Instagram 帖子')).not.toBeNull());
    expect(screen.getByLabelText('YouTube 封面')).not.toBeNull();
    expect(screen.queryByLabelText('disabled')).toBeNull();
    expect(screen.getByText('已选择 2 张受管图片')).not.toBeNull();
    expect(screen.getByText('积分 0')).not.toBeNull();
    expect(screen.getByRole('button', { name: '裁切填充' }).className).toContain('min-h-10');
    expect(screen.getByRole('button', { name: '完整留白' }).className).toContain('min-h-10');
  });

  it('uses selected public presets for the deterministic file, pixel and ZIP preview', async () => {
    const onChange = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true, presets: enabledPresets,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    render(
      <MultiPlatformExportDrawer
        open
        projectId="project-1"
        sourceAssetVersionIds={['version-source-1', 'version-source-2']}
        values={{ targetPresetIds: ['instagram-post-v1'], fit: 'cover', background: '#ffffffff', namingTemplate: '{asset}' }}
        onChange={onChange}
        onEstimate={vi.fn()}
        onStart={vi.fn()}
        onClose={vi.fn()}
        fetcher={fetcher}
      />,
    );

    await waitFor(() => expect(screen.getByText('2 个文件')).not.toBeNull());
    expect(screen.getByText('2,332,800 像素')).not.toBeNull();
    expect(screen.getByText(/预计 ZIP/)).not.toBeNull();
    fireEvent.click(screen.getByLabelText('YouTube 封面'));
    expect(onChange).toHaveBeenCalledWith('targetPresetIds', ['instagram-post-v1', 'youtube-cover-v1']);
  });

  it('shows only server projection progress and exposes PATCH-backed cancel and partial retry actions', async () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    const partialResult = {
      schemaVersion: 1, runId: 'run-export-1', outcome: 'partial_success',
      imageAssetVersionIds: ['version-image-1'], failures: [{
        sourceAssetVersionId: 'version-source-2', code: 'EXPORT_TRANSFORM_FAILED', retryable: true,
      }],
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true, presets: enabledPresets,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const { rerender } = render(
      <MultiPlatformExportDrawer
        open projectId="project-1" sourceAssetVersionIds={['version-source-1']}
        values={{ targetPresetIds: ['instagram-post-v1'] }} onChange={vi.fn()}
        onEstimate={vi.fn()} onStart={vi.fn()} onClose={vi.fn()}
        projection={projection()} onCancel={onCancel} onRetry={onRetry} fetcher={fetcher}
      />,
    );
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('25');
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <MultiPlatformExportDrawer
        open projectId="project-1" sourceAssetVersionIds={['version-source-1']}
        values={{ targetPresetIds: ['instagram-post-v1'] }} onChange={vi.fn()}
        onEstimate={vi.fn()} onStart={vi.fn()} onClose={vi.fn()}
        projection={projection({
          status: 'failed', progress: 50,
          result: { outputs: [{ stepId: 'export', kind: 'json', schemaId: 'multi-platform-export-result-v1', content: JSON.stringify(partialResult) }] },
        })}
        onRetry={onRetry} fetcher={fetcher}
      />,
    );
    expect(screen.getAllByText('部分成功')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '仅重试失败项' }));
    expect(onRetry).toHaveBeenCalledWith('export');
  });
});
