'use client';

import { Download, Images, LocateFixed, PackageOpen, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { ExportManifestFile, MultiPlatformExportResultV1 } from '@/lib/multi-platform-export/manifest';

interface MultiPlatformExportResultsProps {
  projectId: string;
  result: MultiPlatformExportResultV1;
  references: readonly WorkspaceAssetReference[];
  files?: readonly ExportManifestFile[];
  busy?: boolean;
  onDownload: (versionId: string) => void | Promise<void>;
  onDownloadGroup?: (
    references: WorkspaceAssetReference[],
    platform: string,
    onProgress: (progress: number) => void,
  ) => void | Promise<void>;
  onAddToCanvas: (references: WorkspaceAssetReference[]) => void | Promise<void>;
  onLocateSource?: (
    sourceVersionId: string,
  ) => WorkspaceAssetReference | void | Promise<WorkspaceAssetReference | void>;
  onRetry?: () => void | Promise<void>;
}

const actionClass = 'min-h-10 min-w-10 inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

export function MultiPlatformExportResults({
  projectId,
  result,
  references,
  files = [],
  busy = false,
  onDownload,
  onDownloadGroup,
  onAddToCanvas,
  onLocateSource,
  onRetry,
}: MultiPlatformExportResultsProps): React.ReactElement {
  void projectId;
  const [pendingAction, setPendingAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [groupProgress, setGroupProgress] = useState<number>();
  const [sourcePreview, setSourcePreview] = useState<WorkspaceAssetReference>();
  const runAction = async (key: string, action: () => void | Promise<void>): Promise<void> => {
    setPendingAction(key);
    setActionError(undefined);
    if (key.startsWith('source:')) setSourcePreview(undefined);
    if (key.startsWith('group:')) setGroupProgress(0);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      setPendingAction(undefined);
      if (key.startsWith('group:')) setGroupProgress(undefined);
    }
  };
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
              <div className="mb-1 flex min-h-10 items-center justify-between gap-2">
                <h4 className="min-w-0 truncate text-xs font-semibold">{platform}</h4>
                {onDownloadGroup && (
                  <button type="button" className={actionClass} disabled={busy || Boolean(pendingAction)}
                    aria-label={`下载 ${platform} 整组`}
                    onClick={() => { void runAction(`group:${platform}`, () => onDownloadGroup(items.map(item => item.reference), platform, setGroupProgress)); }}>
                    <PackageOpen aria-hidden="true" size={15} />整组
                  </button>
                )}
              </div>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {items.map(({ reference, file }, index) => {
                  const label = reference.name || file?.filename || `导出图片 ${index + 1}`;
                  return (
                    <li key={reference.assetVersionId} className="flex min-w-0 items-center justify-between gap-2 border-b border-border/60 py-2">
                      <span className="min-w-0 text-xs">
                        <span className="block truncate">{file?.filename || label}</span>
                        {file && (
                          <button type="button" className="block min-h-10 max-w-full truncate text-left text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                            aria-label={`定位来源 ${file.sourceAssetVersionId}`}
                            disabled={!onLocateSource || Boolean(pendingAction)}
                            onClick={() => { void runAction(`source:${file.sourceAssetVersionId}`, async () => {
                              const reference = await onLocateSource?.(file.sourceAssetVersionId);
                              if (reference) setSourcePreview(reference);
                            }); }}>
                            <LocateFixed className="mr-1 inline" aria-hidden="true" size={12} />来源 {file.sourceAssetVersionId}
                          </button>
                        )}
                      </span>
                      <button
                        type="button"
                        className={actionClass}
                        aria-label={`下载 ${label}`}
                        disabled={busy || Boolean(pendingAction)}
                        onClick={() => { void runAction(`download:${reference.assetVersionId}`, () => onDownload(reference.assetVersionId!)); }}
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

      {actionError && <div role="alert" className="break-words text-xs text-destructive">{actionError}</div>}
      {sourcePreview && (
        <div aria-label="来源版本预览" className="flex min-w-0 items-center gap-3 border-t border-border/60 pt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sourcePreview.url}
            alt={sourcePreview.name || '来源版本预览'}
            className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover"
          />
          <div className="min-w-0 text-xs">
            <p className="truncate">{sourcePreview.name || sourcePreview.assetVersionId}</p>
            <a
              href={sourcePreview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center text-primary underline-offset-2 hover:underline"
            >
              查看来源版本
            </a>
          </div>
        </div>
      )}
      {typeof groupProgress === 'number' && (
        <div className="space-y-1 text-xs" role="status">
          <span>正在打包 {groupProgress}%</span>
          <progress aria-label="整组下载进度" className="h-2 w-full" max={100} value={groupProgress} />
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
          <button type="button" className={actionClass} disabled={busy || Boolean(pendingAction)} onClick={() => { void runAction('canvas', () => onAddToCanvas([...imageReferences])); }}>
            <Images aria-hidden="true" size={15} />
            批量放入画布
          </button>
        )}
        {result.zipAssetVersionId && (
          <button type="button" className={actionClass} disabled={busy || Boolean(pendingAction)} onClick={() => { void runAction('zip', () => onDownload(result.zipAssetVersionId!)); }}>
            <PackageOpen aria-hidden="true" size={15} />
            下载 ZIP
          </button>
        )}
        {result.manifestAssetVersionId && (
          <button type="button" className={actionClass} disabled={busy || Boolean(pendingAction)} onClick={() => { void runAction('manifest', () => onDownload(result.manifestAssetVersionId!)); }}>
            <Download aria-hidden="true" size={15} />
            下载 manifest
          </button>
        )}
        {result.outcome === 'partial_success' && result.failures.some(failure => failure.retryable) && onRetry && (
          <button type="button" className={actionClass} disabled={busy || Boolean(pendingAction)} onClick={() => { void runAction('retry', onRetry); }}>
            <RotateCcw aria-hidden="true" size={15} />
            仅重试失败项
          </button>
        )}
      </div>
    </div>
  );
}
