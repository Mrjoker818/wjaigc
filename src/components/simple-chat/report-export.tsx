"use client";

import { useCallback, useState } from "react";
import { Download, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface ReportExportProps {
  isMonochrome: boolean;
  content: string;
  title?: string;
  onClose: () => void;
}

export function ReportExport({ isMonochrome, content, title, onClose }: ReportExportProps) {
  const [exportTitle, setExportTitle] = useState(title || "分析报告");
  const [isExporting, setIsExporting] = useState(false);

  const panelBg = isMonochrome ? "bg-white border-gray-200" : "bg-[#1e1e1e] border-[#3d3d3d]";
  const textColor = isMonochrome ? "text-gray-800" : "text-white";
  const subText = isMonochrome ? "text-gray-500" : "text-white/50";
  const inputBg = isMonochrome ? "bg-gray-50 border-gray-200 text-gray-800" : "bg-[#2a2a2a] border-[#404040] text-white";
  const goldBtn = isMonochrome
    ? "bg-amber-500 text-white hover:bg-amber-600"
    : "bg-[#d4af37] text-black hover:bg-[#e5c158]";

  const handleDownloadMarkdown = useCallback(() => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${exportTitle.replace(/[\\/:*?"<>|]/g, "_")}_${dateStr}.md`;
    const header = `# ${exportTitle}\n\n> 生成时间：${new Date().toLocaleString("zh-CN")}\n> 来源：无界AI 智能对话\n\n---\n\n`;
    const blob = new Blob([header + content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Markdown 报告已下载");
    onClose();
  }, [content, exportTitle, onClose]);

  const handleSendToWord = useCallback(async () => {
    setIsExporting(true);
    try {
      // 将内容复制到剪贴板，提示用户粘贴到 Word 大师
      await navigator.clipboard.writeText(content);
      toast.success("内容已复制到剪贴板，请前往 Word 大师粘贴", { duration: 4000 });
      onClose();
    } catch {
      toast.error("复制失败，请手动复制");
    } finally {
      setIsExporting(false);
    }
  }, [content, onClose]);

  return (
    <div className={"fixed inset-0 z-[200] flex items-center justify-center p-4 " + (isMonochrome ? "bg-black/20" : "bg-black/60")}>
      <div className={"w-full max-w-md rounded-xl border shadow-2xl " + panelBg}>
        {/* Header */}
        <div className={"flex items-center justify-between border-b px-5 py-4 " + (isMonochrome ? "border-gray-200" : "border-[#3d3d3d]")}>
          <div className="flex items-center gap-2">
            <FileText size={18} className={isMonochrome ? "text-amber-500" : "text-[#d4af37]"} />
            <h3 className={"text-sm font-semibold " + textColor}>导出报告</h3>
          </div>
          <button onClick={onClose} className={"rounded p-1 hover:opacity-70 " + subText}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Title Input */}
          <div>
            <label className={"mb-1 block text-xs " + subText}>报告标题</label>
            <input
              type="text"
              value={exportTitle}
              onChange={(e) => setExportTitle(e.target.value)}
              placeholder="输入报告标题…"
              className={"w-full rounded-lg border px-3 py-2 text-sm " + inputBg}
            />
          </div>

          {/* Content Preview */}
          <div>
            <label className={"mb-1 block text-xs " + subText}>内容预览（前 300 字）</label>
            <div className={"max-h-32 overflow-y-auto rounded-lg border p-3 text-xs leading-relaxed " + inputBg}>
              {content.slice(0, 300)}{content.length > 300 ? "…" : ""}
            </div>
            <div className={"mt-1 text-right text-xs " + subText}>共 {content.length} 字符</div>
          </div>

          {/* Export Options */}
          <div className="space-y-2">
            <button
              onClick={handleDownloadMarkdown}
              className={"flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold " + goldBtn}
            >
              <Download size={15} />
              下载 Markdown 文件
            </button>
            <button
              onClick={() => void handleSendToWord()}
              disabled={isExporting}
              className={"flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm " + (isMonochrome ? "border-gray-200 text-gray-600 hover:bg-gray-50" : "border-[#404040] text-white/60 hover:bg-[#2a2a2a]")}
            >
              {isExporting ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
              发送到 Word 大师（复制内容）
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
