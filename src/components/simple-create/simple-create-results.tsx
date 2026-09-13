'use client';

import { Ban, Download, ExternalLink, LoaderCircle, RotateCcw } from 'lucide-react';
import type React from 'react';

import type { ImageGenerationSlot } from '@/lib/image-generation-session';

interface SimpleCreateResultsProps {
  slots: ImageGenerationSlot[];
  onCancel(slotId: string): void;
  onRetry(slotId: string): void;
  onDownload(slot: ImageGenerationSlot): void;
  onOpenCanvas(slot: ImageGenerationSlot): void;
}

export function SimpleCreateResults({
  slots,
  onCancel,
  onRetry,
  onDownload,
  onOpenCanvas,
}: SimpleCreateResultsProps) {
  if (slots.length === 0) return null;

  return (
    <section aria-label="生成结果" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">生成结果</h2>
        <span className="text-xs text-zinc-500">{slots.length} 个槽位</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {slots.map(slot => {
          const active = ['submitting', 'queued', 'processing'].includes(slot.status);
          const managed = Boolean(slot.url && slot.assetVersionId && slot.placementId);
          return (
            <article key={slot.id} className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
              <div className="relative flex aspect-square items-center justify-center bg-black">
                {slot.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slot.url} alt="生成结果" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-zinc-400">
                    {active && <LoaderCircle className="h-6 w-6 animate-spin text-amber-400" />}
                    <span className="text-sm">{statusLabel(slot.status)}</span>
                    <span className="text-xs">{slot.progress}%</span>
                  </div>
                )}
              </div>
              <div className="space-y-3 p-3">
                {slot.error?.message && <p className="text-xs text-red-300">{slot.error.message}</p>}
                <div className="flex flex-wrap gap-2">
                  {active && (
                    <ActionButton label={`取消 ${slot.id}`} onClick={() => onCancel(slot.id)} icon={<Ban className="h-4 w-4" />} />
                  )}
                  {(slot.status === 'failed' || slot.status === 'timeout') && slot.error?.retryable !== false && (
                    <ActionButton label={`重试 ${slot.id}`} onClick={() => onRetry(slot.id)} icon={<RotateCcw className="h-4 w-4" />} />
                  )}
                  {slot.url && (
                    <ActionButton label={`下载 ${slot.id}`} onClick={() => onDownload(slot)} icon={<Download className="h-4 w-4" />} />
                  )}
                  {managed && (
                    <ActionButton label={`在画布中打开 ${slot.id}`} onClick={() => onOpenCanvas(slot)} icon={<ExternalLink className="h-4 w-4" />} />
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ActionButton({ label, onClick, icon }: { label: string; onClick(): void; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 text-xs text-zinc-200 hover:border-amber-400 hover:text-white"
    >
      {icon}
      <span aria-hidden="true">{label.split(' ')[0]}</span>
    </button>
  );
}

function statusLabel(status: ImageGenerationSlot['status']): string {
  if (status === 'submitting') return '正在提交';
  if (status === 'queued') return '排队中';
  if (status === 'processing') return '生成中';
  if (status === 'failed') return '生成失败';
  if (status === 'cancelled') return '已取消';
  if (status === 'timeout') return '已超时';
  return '已完成';
}
