'use client';

import { Download } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';

import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { BriefToVideoResultV1 } from '@/lib/brief-to-video/types';
import { loadCompletedCanvasBriefVideoResult } from '@/lib/skill-runtime/canvas-client';

interface BriefToVideoResultCardProps {
  runId: string;
  projectId: string;
  authority?: 'document' | 'legacy' | 'pending';
  expectedActorId?: string;
  fetcher?: typeof fetch;
}

export function BriefToVideoResultCard({
  runId,
  projectId,
  authority = 'legacy',
  expectedActorId,
  fetcher = fetch,
}: BriefToVideoResultCardProps): React.ReactElement {
  const [value, setValue] = useState<{ result: BriefToVideoResultV1; asset: WorkspaceAssetReference }>();
  const [error, setError] = useState<string>();

  useLayoutEffect(() => {
    const controller = new AbortController();
    setValue(undefined);
    setError(undefined);
    void loadCompletedCanvasBriefVideoResult({ projectId, runId, authority, expectedActorId, fetcher, signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) {
          if (result) setValue(result);
          else setError('视频成片尚未准备完成');
        }
      })
      .catch(cause => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : '视频成片加载失败');
        }
      });
    return () => controller.abort();
  }, [fetcher, projectId, runId, authority, expectedActorId]);

  return (
    <section className="min-w-0 space-y-3 border-t border-current/15 pt-3" aria-live="polite">
      {!value && !error && <div role="status" className="text-xs text-muted-foreground">正在加载视频成片...</div>}
      {error && <div role="alert" className="break-words text-xs text-destructive">{error}</div>}
      {value && <>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">视频成片</h3>
          <p className="break-words text-xs text-muted-foreground">
            {value.result.durationSeconds} 秒 · {value.result.aspectRatio}{value.result.resolution ? ` · ${value.result.resolution}` : ''}
          </p>
        </div>
        <video
          src={value.asset.url}
          poster={value.result.thumbnailUrl}
          controls
          preload="metadata"
          className="aspect-video w-full rounded-lg bg-black object-contain"
        >
          当前浏览器不支持视频播放。
        </video>
        <a
          href={value.asset.url}
          download
          aria-label="下载成片"
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-3 text-xs font-semibold text-[#0a0a0b] hover:bg-[#e2c45c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4af37]"
        >
          <Download className="h-4 w-4" aria-hidden="true" />下载成片
        </a>
      </>}
    </section>
  );
}
