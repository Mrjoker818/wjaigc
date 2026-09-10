// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MultiPlatformExportResults } from '@/components/skill-runtime/MultiPlatformExportResults';
import {
  createMultiPlatformExportRequestFingerprint,
  downloadExportGroup,
  downloadExportArtifact,
  loadExportManifestFiles,
  parseMultiPlatformExportResult,
  resolveExportAssetReference,
  resolveExportImageReferences,
} from '@/lib/skill-runtime/multi-platform-export-client';
import { projectExportImagesInBatches } from '@/lib/skill-runtime/canvas-client';

const result = {
  schemaVersion: 1 as const,
  runId: 'run-export-1',
  outcome: 'completed' as const,
  imageAssetVersionIds: ['version-image-1'],
  manifestAssetVersionId: 'version-manifest-1',
  zipAssetVersionId: 'version-zip-1',
  failures: [],
};

function deferred<T>(): { promise: Promise<T>; reject: (reason: Error) => void } {
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((_resolve, fail) => { reject = fail; });
  return { promise, reject };
}

describe('multi-platform export results', () => {
  it('fingerprints every canonical request field that can change an export plan', () => {
    const base = {
      projectId: 'project-1', sourceAssetVersionIds: ['version-source-1'],
      values: { targetPresetIds: ['instagram-post-v1'], fit: 'cover', background: '#ffffffff', namingTemplate: '{asset}' },
    };
    const fingerprint = createMultiPlatformExportRequestFingerprint(base);
    const variants = [
      { ...base, sourceAssetVersionIds: ['version-source-2'] },
      { ...base, values: { ...base.values, targetPresetIds: ['youtube-cover-v1'] } },
      { ...base, values: { ...base.values, fit: 'contain' } },
      { ...base, values: { ...base.values, background: 'transparent' } },
      { ...base, values: { ...base.values, namingTemplate: '{asset}-{index}' } },
    ];
    const variantFingerprints = variants.map(createMultiPlatformExportRequestFingerprint);
    expect(variantFingerprints.every(value => value !== fingerprint)).toBe(true);
    expect(new Set(variantFingerprints).size).toBe(variants.length);
  });
  it('parses the structured durable output without accepting a different schema', () => {
    expect(parseMultiPlatformExportResult([
      { stepId: 'export', kind: 'json', schemaId: 'multi-platform-export-result-v1', content: JSON.stringify(result) },
    ])).toEqual(result);
    expect(() => parseMultiPlatformExportResult([
      { stepId: 'export', kind: 'json', schemaId: 'other', content: JSON.stringify(result) },
    ])).toThrow('EXPORT_RESULT_NOT_FOUND');
  });

  it('resolves stable AssetVersion URLs and projects only image assets back to canvas', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        assetId: 'asset-image-1', assetVersionId: 'version-image-1', kind: 'image', url: '/api/serve-upload/exports/a.png',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        assetId: 'asset-document-1', assetVersionId: 'version-document-1', kind: 'document', url: '/api/serve-upload/exports/a.zip',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const references = await resolveExportImageReferences({
      projectId: 'project-1',
      versionIds: ['version-image-1', 'version-document-1'],
      fetcher,
    });
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ assetVersionId: 'version-image-1', kind: 'image' });
  });

  it('resolves an off-canvas source by project and version authorization, and rejects denied access', async () => {
    const successFetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      assetId: 'asset-source-1', assetVersionId: 'version-source-1', kind: 'image',
      url: '/api/serve-upload/source.png', name: '来源图',
    }));
    await expect(resolveExportAssetReference({
      projectId: 'project-1', versionId: 'version-source-1', fetcher: successFetcher,
    })).resolves.toMatchObject({ assetVersionId: 'version-source-1', kind: 'image' });
    expect(successFetcher).toHaveBeenCalledWith(
      '/api/assets?projectId=project-1&assetVersionId=version-source-1',
      expect.objectContaining({ method: 'GET' }),
    );

    const deniedFetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(
      { error: 'forbidden' }, { status: 403 },
    ));
    await expect(resolveExportAssetReference({
      projectId: 'project-1', versionId: 'version-source-1', fetcher: deniedFetcher,
    })).rejects.toThrow('导出制品加载失败');
  });

  it('downloads a single image or ZIP through its authorized stable AssetVersion URL', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        assetId: 'asset-zip-1', assetVersionId: 'version-zip-1', kind: 'document',
        url: '/api/serve-upload/exports/export.zip',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200, headers: { 'Content-Type': 'application/zip' },
      }));
    const createObjectURL = vi.fn(() => 'blob:export-zip');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const remove = vi.spyOn(HTMLAnchorElement.prototype, 'remove');
    vi.useFakeTimers();
    try {
      await downloadExportArtifact('version-zip-1', 'project-1', fetcher);

      expect(fetcher).toHaveBeenCalledWith(
        '/api/assets?projectId=project-1&assetVersionId=version-zip-1',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(fetcher).toHaveBeenCalledWith(
        '/api/serve-upload/exports/export.zip',
        expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
      );
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledTimes(1);
      expect((click.mock.contexts[0] as HTMLAnchorElement | undefined)?.download).toBe('export.zip');
      expect(remove).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(remove).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:export-zip');
    } finally {
      vi.useRealTimers();
      click.mockRestore();
      remove.mockRestore();
    }
  });

  it('loads authoritative grouping metadata through the manifest AssetVersion', async () => {
    const manifest = {
      schemaVersion: 1,
      schemaId: 'multi-platform-export-manifest-v1',
      runId: 'run-export-1',
      requestDigest: 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z',
      frozenParameters: {},
      files: [{
        filename: 'instagram-post.png', sourceAssetVersionId: 'version-source-1',
        derivedAssetVersionId: 'version-image-1', platform: 'Instagram', usage: 'post',
        width: 1080, height: 1080, mimeType: 'image/png', byteSize: 1234,
        sha256: `sha256:${'a'.repeat(64)}`,
      }],
      failures: [],
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        assetId: 'asset-manifest-1', assetVersionId: 'version-manifest-1', kind: 'document',
        url: '/api/serve-upload/exports/manifest.json',
      }))
      .mockResolvedValueOnce(Response.json(manifest));

    await expect(loadExportManifestFiles(result, 'project-1', fetcher)).resolves.toEqual(manifest.files);
  });

  it('renders stable result actions and reuses existing versions when adding all images', async () => {
    const onAddToCanvas = vi.fn().mockResolvedValue(undefined);
    const onDownload = vi.fn().mockResolvedValue(undefined);
    render(
      <MultiPlatformExportResults
        projectId="project-1"
        result={result}
        references={[{
          assetId: 'asset-image-1', assetVersionId: 'version-image-1', kind: 'image',
          url: '/api/serve-upload/exports/a.png', name: 'Instagram 帖子',
        }]}
        files={[{
          filename: 'instagram-post.png', sourceAssetVersionId: 'version-source-1',
          derivedAssetVersionId: 'version-image-1', platform: 'Instagram', usage: 'post',
          width: 1080, height: 1080, mimeType: 'image/png', byteSize: 1234,
          sha256: `sha256:${'a'.repeat(64)}`,
        }]}
        onDownload={onDownload}
        onAddToCanvas={onAddToCanvas}
        onDownloadGroup={vi.fn()}
        onLocateSource={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Instagram' })).not.toBeNull();
    expect(screen.getByText('来源 version-source-1')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '下载 Instagram 帖子' }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledWith('version-image-1'));
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP' }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledWith('version-zip-1'));
    fireEvent.click(screen.getByRole('button', { name: '批量放入画布' }));
    await waitFor(() => expect(onAddToCanvas).toHaveBeenCalledWith([
      expect.objectContaining({ assetVersionId: 'version-image-1', kind: 'image' }),
    ]));
  });

  it('downloads a platform group, locates its source, and contains async download failures', async () => {
    const onDownload = vi.fn().mockRejectedValue(new Error('下载被浏览器阻止'));
    const onDownloadGroup = vi.fn().mockResolvedValue(undefined);
    const onLocateSource = vi.fn();
    render(<MultiPlatformExportResults
      projectId="project-1" result={result}
      references={[{ assetVersionId: 'version-image-1', kind: 'image', url: '/a.png', name: '帖子' }]}
      files={[{
        filename: 'instagram-post.png', sourceAssetVersionId: 'version-source-1',
        derivedAssetVersionId: 'version-image-1', platform: 'Instagram', usage: 'post',
        width: 1080, height: 1080, mimeType: 'image/png', byteSize: 1234,
        sha256: `sha256:${'a'.repeat(64)}`,
      }]}
      onDownload={onDownload} onDownloadGroup={onDownloadGroup}
      onLocateSource={onLocateSource} onAddToCanvas={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: '下载 Instagram 整组' }));
    await waitFor(() => expect(onDownloadGroup).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '定位来源 version-source-1' }));
    expect(onLocateSource).toHaveBeenCalledWith('version-source-1');
    await waitFor(() => expect(screen.getByRole('button', { name: '下载 帖子' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '下载 帖子' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('下载被浏览器阻止'));
    expect(screen.getByRole('button', { name: '下载 帖子' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows an authorized preview when the source version is not on the current canvas', async () => {
    const onLocateSource = vi.fn().mockResolvedValue({
      assetId: 'asset-source-1', assetVersionId: 'version-source-1', kind: 'image',
      url: '/api/serve-upload/source.png', name: '来源图',
    });
    render(<MultiPlatformExportResults
      projectId="project-1" result={result}
      references={[{ assetVersionId: 'version-image-1', kind: 'image', url: '/a.png' }]}
      files={[{
        filename: 'instagram-post.png', sourceAssetVersionId: 'version-source-1',
        derivedAssetVersionId: 'version-image-1', platform: 'Instagram', usage: 'post',
        width: 1080, height: 1080, mimeType: 'image/png', byteSize: 1234,
        sha256: `sha256:${'a'.repeat(64)}`,
      }]}
      onDownload={vi.fn()} onLocateSource={onLocateSource} onAddToCanvas={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: '定位来源 version-source-1' }));
    expect(await screen.findByRole('img', { name: '来源图' })).not.toBeNull();
    expect(screen.getByRole('link', { name: '查看来源版本' }).getAttribute('href')).toBe('/api/serve-upload/source.png');
  });

  it('shows an actionable error when an off-canvas source cannot be authorized', async () => {
    render(<MultiPlatformExportResults
      projectId="project-1" result={result}
      references={[{ assetVersionId: 'version-image-1', kind: 'image', url: '/a.png' }]}
      files={[{
        filename: 'instagram-post.png', sourceAssetVersionId: 'version-source-1',
        derivedAssetVersionId: 'version-image-1', platform: 'Instagram', usage: 'post',
        width: 1080, height: 1080, mimeType: 'image/png', byteSize: 1234,
        sha256: `sha256:${'a'.repeat(64)}`,
      }]}
      onDownload={vi.fn()} onLocateSource={vi.fn().mockRejectedValue(new Error('来源版本无权访问或已删除'))}
      onAddToCanvas={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: '定位来源 version-source-1' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('来源版本无权访问或已删除'));
  });

  it('clears source A preview as soon as source B lookup starts and keeps it cleared when B fails', async () => {
    const pendingB = deferred<never>();
    const twoImageResult = {
      ...result,
      imageAssetVersionIds: ['version-image-1', 'version-image-2'],
    };
    const onLocateSource = vi.fn((sourceVersionId: string) => sourceVersionId === 'version-source-a'
      ? Promise.resolve({
        assetVersionId: 'version-source-a', kind: 'image' as const,
        url: '/source-a.png', name: '来源 A',
      })
      : pendingB.promise);
    render(<MultiPlatformExportResults
      projectId="project-1" result={twoImageResult}
      references={[
        { assetVersionId: 'version-image-1', kind: 'image', url: '/a.png' },
        { assetVersionId: 'version-image-2', kind: 'image', url: '/b.png' },
      ]}
      files={[
        {
          filename: 'a.png', sourceAssetVersionId: 'version-source-a', derivedAssetVersionId: 'version-image-1',
          platform: 'Instagram', usage: 'post', width: 1080, height: 1080, mimeType: 'image/png',
          byteSize: 1234, sha256: `sha256:${'a'.repeat(64)}`,
        },
        {
          filename: 'b.png', sourceAssetVersionId: 'version-source-b', derivedAssetVersionId: 'version-image-2',
          platform: 'Instagram', usage: 'story', width: 1080, height: 1920, mimeType: 'image/png',
          byteSize: 2345, sha256: `sha256:${'b'.repeat(64)}`,
        },
      ]}
      onDownload={vi.fn()} onLocateSource={onLocateSource} onAddToCanvas={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: '定位来源 version-source-a' }));
    expect(await screen.findByRole('img', { name: '来源 A' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '定位来源 version-source-b' }));
    expect(screen.queryByRole('img', { name: '来源 A' })).toBeNull();
    pendingB.reject(new Error('来源 B 无权访问或已删除'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('来源 B 无权访问或已删除'));
    expect(screen.queryByRole('img', { name: '来源 A' })).toBeNull();
  });

  it('builds a bounded platform ZIP from stable image references and reports progress', async () => {
    const files = [{
      filename: 'instagram-post.png', sourceAssetVersionId: 'version-source-1',
      derivedAssetVersionId: 'version-image-1', platform: 'Instagram', usage: 'post',
      width: 1080, height: 1080, mimeType: 'image/png' as const, byteSize: 4,
      sha256: `sha256:${'a'.repeat(64)}`,
    }];
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        assetId: 'asset-image-1', assetVersionId: 'version-image-1', kind: 'image',
        url: '/stable/image.png', name: 'instagram-post.png',
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '4' },
      }));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:group') });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const progress = vi.fn();

    await downloadExportGroup({
      platform: 'Instagram', projectId: 'project-1', fetcher, files,
      references: [{ assetVersionId: 'version-image-1', kind: 'image', url: '/stable/image.png' }],
      onProgress: progress,
    });
    expect(fetcher).toHaveBeenNthCalledWith(1,
      '/api/assets?projectId=project-1&assetVersionId=version-image-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(2, '/stable/image.png', expect.objectContaining({ method: 'GET' }));
    expect(progress).toHaveBeenLastCalledWith(100);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await new Promise(resolve => window.setTimeout(resolve, 10));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:group');
    click.mockRestore();
  });

  it('projects no more than 100 existing image versions in yielding batches', async () => {
    const references = Array.from({ length: 100 }, (_, index) => ({
      assetVersionId: `version-${index}`, kind: 'image' as const, url: `/image-${index}.png`,
    }));
    const project = vi.fn().mockResolvedValue(undefined);
    const yieldToBrowser = vi.fn().mockResolvedValue(undefined);
    await projectExportImagesInBatches(references, project, { batchSize: 12, yieldToBrowser });
    expect(project).toHaveBeenCalledTimes(100);
    expect(yieldToBrowser).toHaveBeenCalledTimes(8);
    await expect(projectExportImagesInBatches([...references, references[0]], project))
      .rejects.toThrow('EXPORT_CANVAS_ITEM_LIMIT');
  });
});
