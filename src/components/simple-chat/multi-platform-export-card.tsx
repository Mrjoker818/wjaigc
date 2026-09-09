'use client';

import { Download, Image as ImageIcon, PackageOpen, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AgentProgressTimeline } from '@/components/agent-runtime/AgentProgressTimeline';
import { useAgentRunEvents } from '@/components/agent-runtime/use-agent-run-events';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { MultiPlatformExportResultV1 } from '@/lib/multi-platform-export/manifest';
import {
  downloadExportArtifact,
  parseMultiPlatformExportResult,
  resolveExportImageReferences,
} from '@/lib/skill-runtime/multi-platform-export-client';

interface MultiPlatformExportCardProps {
  runId: string;
  projectId: string;
  onReturnToCanvas: (references: WorkspaceAssetReference[]) => void | Promise<void>;
}

const actionClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';

function readResult(outputs: unknown): MultiPlatformExportResultV1 | undefined {
  try {
    return parseMultiPlatformExportResult(outputs);
  } catch {
    return undefined;
  }
}

export function MultiPlatformExportCard({
  runId,
  projectId,
  onReturnToCanvas,
}: MultiPlatformExportCardProps): React.ReactElement {
  const run = useAgentRunEvents(runId);
  const projectedResult = useMemo(
    () => readResult(run.projection?.result?.outputs),
    [run.projection?.result],
  );
  const [restoredResult, setRestoredResult] = useState<MultiPlatformExportResultV1>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const result = projectedResult ?? restoredResult;

  useEffect(() => {
    if (projectedResult) return;
    const controller = new AbortController();
    void fetch(`/api/skill-runs/${encodeURIComponent(runId)}?observeOnly=true`, {
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) return;
      const payload = await response.json() as { run?: { outputs?: unknown } };
      const restored = readResult(payload.run?.outputs);
      if (restored) setRestoredResult(restored);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [projectedResult, run.projection?.status, runId]);

  const perform = async (operation: () => void | Promise<void>): Promise<void> => {
    setPending(true);
    setError(undefined);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试');
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      data-simple-chat-export-run-id={runId}
      className="mt-3 min-w-0 space-y-3 border-t border-border pt-3"
      aria-live="polite"
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">多平台批量导出</h3>
        <p className="truncate text-xs text-muted-foreground">Run {runId}</p>
      </div>

      {!result && (
        <AgentProgressTimeline
          projection={run.projection}
          stale={run.stale}
          onCancel={() => { void run.cancel(); }}
        />
      )}

      {result && (
        <>
          <p className="text-xs">
            {result.imageAssetVersionIds.length} 个成功 · {result.failures.length} 个失败
          </p>
          <ul className="space-y-1 text-xs" aria-label="导出图片版本">
            {result.imageAssetVersionIds.map(versionId => (
              <li key={versionId} className="flex min-w-0 items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{versionId}</span>
              </li>
            ))}
          </ul>
          {result.failures.length > 0 && (
            <ul className="space-y-1 text-xs text-destructive" aria-label="导出失败项">
              {result.failures.map((failure, index) => (
                <li key={`${failure.sourceAssetVersionId}:${index}`}>
                  {failure.sourceAssetVersionId}：{failure.code}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {result.zipAssetVersionId && (
              <button type="button" className={actionClass} disabled={pending}
                aria-label="下载 ZIP"
                onClick={() => { void perform(() => downloadExportArtifact(result.zipAssetVersionId!, projectId)); }}>
                <PackageOpen className="h-4 w-4" aria-hidden="true" />ZIP
              </button>
            )}
            {result.manifestAssetVersionId && (
              <button type="button" className={actionClass} disabled={pending}
                aria-label="下载 manifest"
                onClick={() => { void perform(() => downloadExportArtifact(result.manifestAssetVersionId!, projectId)); }}>
                <Download className="h-4 w-4" aria-hidden="true" />manifest
              </button>
            )}
            {result.imageAssetVersionIds.length > 0 && (
              <button type="button" className={actionClass} disabled={pending}
                aria-label="返回画布"
                onClick={() => { void perform(async () => {
                  const references = await resolveExportImageReferences({
                    projectId,
                    versionIds: result.imageAssetVersionIds,
                  });
                  await onReturnToCanvas(references);
                }); }}>
                <Undo2 className="h-4 w-4" aria-hidden="true" />返回画布
              </button>
            )}
          </div>
        </>
      )}
      {error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}
    </section>
  );
}
