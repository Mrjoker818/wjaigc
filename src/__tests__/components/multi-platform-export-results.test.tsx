// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MultiPlatformExportResults } from '@/components/skill-runtime/MultiPlatformExportResults';
import {
  downloadExportArtifact,
  loadExportManifestFiles,
  parseMultiPlatformExportResult,
  resolveExportImageReferences,
} from '@/lib/skill-runtime/multi-platform-export-client';

const result = {
  schemaVersion: 1 as const,
  runId: 'run-export-1',
  outcome: 'completed' as const,
  imageAssetVersionIds: ['version-image-1'],
  manifestAssetVersionId: 'version-manifest-1',
  zipAssetVersionId: 'version-zip-1',
  failures: [],
};

describe('multi-platform export results', () => {
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

  it('downloads a single image or ZIP through its authorized stable AssetVersion URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      assetId: 'asset-zip-1', assetVersionId: 'version-zip-1', kind: 'document',
      url: '/api/serve-upload/exports/export.zip', name: 'export.zip',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await downloadExportArtifact('version-zip-1', 'project-1', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      '/api/assets?projectId=project-1&assetVersionId=version-zip-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
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
});
