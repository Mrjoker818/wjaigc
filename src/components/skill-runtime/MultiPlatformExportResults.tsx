'use client';

import { Download, Images, PackageOpen, RotateCcw } from 'lucide-react';

import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { ExportManifestFile, MultiPlatformExportResultV1 } from '@/lib/multi-platform-export/manifest';

interface MultiPlatformExportResultsProps {
  projectId: string;
  result: MultiPlatformExportResultV1;
  references: readonly WorkspaceAssetReference[];
  files?: readonly ExportManifestFile[];
  busy?: boolean;
  onDownload: (versionId: string) => void | Promise<void>;
  onAddToCanvas: (references: WorkspaceAssetReference[]) => void | Promise<void>;
  onRetry?: () => void;
}

const actionClass = 'min-h-10 min-w-10 inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

export function MultiPlatformExportResults({
  projectId,
  result,
  references,
  files = [],
  busy = false,
  onDownload,
  onAddToCanvas,
  onRetry,
}: MultiPlatformExportResultsProps): React.ReactElement {
  void projectId;
  const imageReferences = references.filter(reference => (
    reference.kind === 'image'
    && typeof reference.assetVersionId === 'string'
    && result.imageAssetVersionIds.includes(reference.assetVersionId)
  ));
  const fileByVersionId = new Map(files.map(file => [file.derivedAssetVersionId, file]));
  const groupedReferences = new Map<string, Array<{ reference: WorkspaceAssetReference; file?: ExportManifestFile }>>();
  for (const reference of imageReferences) {
    const file = reference.assetVersionId ? fileByVersionId.get(reference.assetVersionId) : undefined;
    const platform = file?.platform || '其他';
    const group = groupedReferences.get(platform) ?? [];
    group.push({ reference, file });
    groupedReferences.set(platform, group);
  }

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={result.outcome === 'completed' ? 'text-emerald-500' : 'text-amber-500'}>
          {result.outcome === 'completed' ? '全部完成' : '部分成功'}
        </span>
        <span className="text-muted-foreground">{imageReferences.length} 张图片可用</span>
      </div>

      {imageReferences.length > 0 && (
        <div className="space-y-3" aria-label="导出图片">
          {[...groupedReferences.entries()].map(([platform, items]) => (
            <section key={platform} className="min-w-0">
              <h4 className="mb-1 text-xs font-semibold">{platform}</h4>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {items.map(({ reference, file }, index) => {
                  const label = reference.name || file?.filename || `导出图片 ${index + 1}`;
                  return (
                    <li key={reference.assetVersionId} className="flex min-w-0 items-center justify-between gap-2 border-b border-border/60 py-2">
                      <span className="min-w-0 text-xs">
                        <span className="block truncate">{file?.filename || label}</span>
                        {file && <span className="block truncate text-[10px] text-muted-foreground">来源 {file.sourceAssetVersionId}</span>}
                      </span>
                      <button
                        type="button"
                        className={actionClass}
                        aria-label={`下载 ${label}`}
                        disabled={busy}
                        onClick={() => { void onDownload(reference.assetVersionId!); }}
                      >
                        <Download aria-hidden="true" size={15} />
                        <span className="hidden sm:inline">下载</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {result.failures.length > 0 && (
        <ul className="space-y-1 text-xs text-destructive" aria-label="失败项">
          {result.failures.map((failure, index) => (
            <li key={`${failure.sourceAssetVersionId}:${failure.presetId || ''}:${index}`} className="break-words">
              {failure.outputFilename || failure.sourceAssetVersionId}：{failure.code}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {imageReferences.length > 0 && (
          <button type="button" className={actionClass} disabled={busy} onClick={() => { void onAddToCanvas([...imageReferences]); }}>
            <Images aria-hidden="true" size={15} />
            批量放入画布
          </button>
        )}
        {result.zipAssetVersionId && (
          <button type="button" className={actionClass} disabled={busy} onClick={() => { void onDownload(result.zipAssetVersionId!); }}>
            <PackageOpen aria-hidden="true" size={15} />
            下载 ZIP
          </button>
        )}
        {result.outcome === 'partial_success' && result.failures.some(failure => failure.retryable) && onRetry && (
          <button type="button" className={actionClass} disabled={busy} onClick={onRetry}>
            <RotateCcw aria-hidden="true" size={15} />
            仅重试失败项
          </button>
        )}
      </div>
    </div>
  );
}
