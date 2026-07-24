"use client";

import { useMemo } from "react";
import { X, BarChart3, MessageSquare, Image } from "lucide-react";
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
}

export function UsageStats({ usage, messageCount, imageCount, isMonochrome, onClose }: UsageStatsProps) {
  const panelClass = isMonochrome ? "bg-white border-gray-200 text-gray-800" : "bg-[#1a1a1a] border-[#424242] text-white";
  const mutedClass = isMonochrome ? "text-gray-500" : "text-gray-400";

  const avgPerMessage = messageCount > 0 ? Math.round(usage.total / messageCount) : 0;
  const estimatedCost = useMemo(() => {
    // 粗略估算：GPT-4o 级别约 $0.005/1K tokens（混合输入输出）
    return (usage.total / 1000 * 0.005).toFixed(4);
  }, [usage.total]);

  const maxBar = Math.max(usage.prompt, usage.completion, 1);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className={cn("w-full max-w-sm rounded-xl border shadow-2xl", panelClass)} onClick={e => e.stopPropagation()}>
        <div className={cn("flex items-center justify-between border-b border-inherit px-4 py-3")}>
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className={isMonochrome ? "text-gray-600" : "text-amber-400"} />
            <span className="text-sm font-semibold">用量统计</span>
          </div>
          <button onClick={onClose} className={cn("p-1.5 rounded hover:opacity-70")}><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* 概览卡片 */}
          <div className="grid grid-cols-3 gap-2">
            <div className={cn("rounded-lg border p-3 text-center", isMonochrome ? "border-gray-200 bg-gray-50" : "border-[#333] bg-[#222]")}>
              <div className="text-lg font-bold">{usage.total.toLocaleString('zh-CN')}</div>
              <div className={cn("text-[10px]", mutedClass)}>总 Tokens</div>
            </div>
            <div className={cn("rounded-lg border p-3 text-center", isMonochrome ? "border-gray-200 bg-gray-50" : "border-[#333] bg-[#222]")}>
              <div className="text-lg font-bold flex items-center justify-center gap-1"><MessageSquare size={14} />{messageCount}</div>
              <div className={cn("text-[10px]", mutedClass)}>消息数</div>
            </div>
            <div className={cn("rounded-lg border p-3 text-center", isMonochrome ? "border-gray-200 bg-gray-50" : "border-[#333] bg-[#222]")}>
              <div className="text-lg font-bold flex items-center justify-center gap-1"><Image size={14} />{imageCount}</div>
              <div className={cn("text-[10px]", mutedClass)}>图片数</div>
            </div>
          </div>

          {/* Token 分布 */}
          <div>
            <div className={cn("text-xs font-medium mb-2", mutedClass)}>Token 分布</div>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>输入（Prompt）</span>
                  <span>{usage.prompt.toLocaleString('zh-CN')}</span>
                </div>
                <div className={cn("h-2 rounded-full overflow-hidden", isMonochrome ? "bg-gray-200" : "bg-[#333]")}>
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(usage.prompt / maxBar) * 100}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
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
            <div className="flex justify-between">
              <span className={mutedClass}>平均每条消息</span>
              <span>{avgPerMessage.toLocaleString('zh-CN')} tokens</span>
            </div>
            <div className="flex justify-between">
              <span className={mutedClass}>预估费用</span>
              <span>${estimatedCost}</span>
            </div>
          </div>

          <div className={cn("text-[10px] text-center", mutedClass)}>
            统计数据基于当前对话会话，仅供参考
          </div>
        </div>
      </div>
    </div>
  );
}
