"use client";

import { useMemo, useRef, type ReactElement, type RefObject } from "react";
import { X, BarChart3, MessageSquare, Image } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

interface UsageStatsProps {
  usage: TokenUsage;
  messageCount: number;
  imageCount: number;
  isMonochrome?: boolean;
  onClose: () => void;
  fallbackFocusRef?: RefObject<HTMLButtonElement | null>;
}

export function UsageStats({ usage, messageCount, imageCount, isMonochrome, onClose, fallbackFocusRef }: UsageStatsProps): ReactElement {
  const returnFocus = useRef<HTMLElement | null>(null);
  const panelClass = isMonochrome ? "bg-white border-gray-200 text-gray-800" : "bg-[#1a1a1a] border-[#424242] text-white";
  const mutedClass = isMonochrome ? "text-gray-500" : "text-gray-400";

  const avgPerMessage = messageCount > 0 ? Math.round(usage.total / messageCount) : 0;
  const estimatedCost = useMemo(() => {
    // 粗略估算：GPT-4o 级别约 $0.005/1K tokens（混合输入输出）
    return (usage.total / 1000 * 0.005).toFixed(4);
  }, [usage.total]);

  const maxBar = Math.max(usage.prompt, usage.completion, 1);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { const prior = returnFocus.current; const target = prior?.isConnected && prior.getClientRects().length > 0 ? prior : fallbackFocusRef?.current; if (target?.isConnected && target.getClientRects().length > 0) { event.preventDefault(); target.focus(); } }}
        style={{ animation: "none" }}
        className={cn("flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-sm flex-col gap-0 overflow-hidden p-0 sm:max-w-sm", panelClass)}>
        <div className={cn("flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-inherit px-4 py-2")}>
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className={isMonochrome ? "text-gray-600" : "text-amber-400"} />
            <DialogTitle className="text-base font-semibold">用量统计</DialogTitle>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭用量统计" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:opacity-70"><X size={18} /></button>
        </div>

        <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto overscroll-contain p-4">
          {/* 概览卡片 */}
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
            <div className={cn("min-w-0 rounded-lg border p-3 text-center", isMonochrome ? "border-gray-200 bg-gray-50" : "border-[#333] bg-[#222]")}>
              <div className="break-all text-base font-bold tabular-nums">{usage.total.toLocaleString('zh-CN')}</div>
              <div className={cn("text-xs", mutedClass)}>总 Tokens</div>
            </div>
            <div className={cn("min-w-0 rounded-lg border p-3 text-center", isMonochrome ? "border-gray-200 bg-gray-50" : "border-[#333] bg-[#222]")}>
              <div className="flex min-w-0 items-start justify-center gap-1 text-base font-bold tabular-nums"><MessageSquare size={14} className="mt-1 shrink-0" /><span className="min-w-0 break-all">{messageCount}</span></div>
              <div className={cn("text-xs", mutedClass)}>消息数</div>
            </div>
            <div className={cn("min-w-0 rounded-lg border p-3 text-center", isMonochrome ? "border-gray-200 bg-gray-50" : "border-[#333] bg-[#222]")}>
              <div className="flex min-w-0 items-start justify-center gap-1 text-base font-bold tabular-nums"><Image size={14} className="mt-1 shrink-0" /><span className="min-w-0 break-all">{imageCount}</span></div>
              <div className={cn("text-xs", mutedClass)}>图片数</div>
            </div>
          </div>

          {/* Token 分布 */}
          <div>
            <div className={cn("text-xs font-medium mb-2", mutedClass)}>Token 分布</div>
            <div className="space-y-2">
              <div>
                <div className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 text-xs mb-1 [&>span]:break-all [&>span]:tabular-nums">
                  <span>输入（Prompt）</span>
                  <span>{usage.prompt.toLocaleString('zh-CN')}</span>
                </div>
                <div className={cn("h-2 rounded-full overflow-hidden", isMonochrome ? "bg-gray-200" : "bg-[#333]")}>
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(usage.prompt / maxBar) * 100}%` }} />
                </div>
              </div>
              <div>
                <div className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 text-xs mb-1 [&>span]:break-all [&>span]:tabular-nums">
                  <span>输出（Completion）</span>
                  <span>{usage.completion.toLocaleString('zh-CN')}</span>
                </div>
                <div className={cn("h-2 rounded-full overflow-hidden", isMonochrome ? "bg-gray-200" : "bg-[#333]")}>
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(usage.completion / maxBar) * 100}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* 详细信息 */}
          <div className={cn("rounded-lg border p-3 space-y-1.5 text-xs", isMonochrome ? "border-gray-200 bg-gray-50" : "border-[#333] bg-[#222]")}>
            <div className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 [&>span]:break-all [&>span]:tabular-nums">
              <span className={mutedClass}>平均每条消息</span>
              <span>{avgPerMessage.toLocaleString('zh-CN')} tokens</span>
            </div>
            <div className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 [&>span]:break-all [&>span]:tabular-nums">
              <span className={mutedClass}>预估费用</span>
              <span>${estimatedCost}</span>
            </div>
          </div>

          <div className={cn("text-xs text-center", mutedClass)}>
            统计数据基于当前对话会话，仅供参考
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
