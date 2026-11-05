"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { Download, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface ReportExportProps { isMonochrome: boolean; content: string; title?: string; onClose: () => void }

export function ReportExport({ isMonochrome, content, title, onClose }: ReportExportProps): ReactElement {
  const [exportTitle, setExportTitle] = useState(title || "分析报告");
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const mounted = useRef(true), inFlight = useRef(false), returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const panelBg = isMonochrome ? "bg-white border-gray-200" : "bg-[#1e1e1e] border-[#3d3d3d]";
  const textColor = isMonochrome ? "text-gray-800" : "text-white";
  const subText = isMonochrome ? "text-gray-600" : "text-white/75";
  const inputBg = isMonochrome ? "bg-gray-50 border-gray-200 text-gray-800" : "bg-[#2a2a2a] border-[#404040] text-white";
  const goldBtn = isMonochrome ? "bg-amber-500 text-gray-950 hover:bg-amber-600" : "bg-[#d4af37] text-black hover:bg-[#e5c158]";

  const handleDownloadMarkdown = useCallback((): void => {
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

  const handleSendToWord = useCallback(async (): Promise<void> => {
    if (inFlight.current || !mounted.current) return;
    inFlight.current = true;
    setIsExporting(true);
    setError("");
    try {
      await navigator.clipboard.writeText(content);
      if (mounted.current) {
        toast.success("内容已复制到剪贴板，请前往 Word 大师粘贴", { duration: 4000 });
        onClose();
      }
    } catch {
      if (mounted.current) { setError("复制失败，请检查剪贴板权限，或下载 Markdown 文件。"); toast.error("复制失败，请手动复制"); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setIsExporting(false);
    }
  }, [content, onClose]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}
        style={{ animation: "none" }} className={"flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md " + panelBg + " " + textColor}>
        <div className={"flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 sm:px-5 " + (isMonochrome ? "border-gray-200" : "border-[#3d3d3d]")}>
          <div className="flex min-w-0 items-center gap-2"><FileText size={18} className="shrink-0 text-[#d4af37]" /><DialogTitle className={"text-sm font-semibold " + textColor}>导出报告</DialogTitle></div>
          <button onClick={onClose} aria-label="关闭导出报告" className={"inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:opacity-70 " + subText}><X size={16} /></button>
        </div>
        <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-5">
          <div><label htmlFor={titleId} className={"mb-1 block text-xs " + subText}>报告标题</label><input id={titleId} type="text" value={exportTitle} onChange={(e) => setExportTitle(e.target.value)} placeholder="输入报告标题…" className={"min-h-11 w-full min-w-0 rounded-lg border px-3 py-2 text-base " + inputBg} /></div>
          <div><p className={"mb-1 text-xs " + subText}>内容预览（前 300 字）</p><div className={"max-h-32 overflow-y-auto break-words rounded-lg border p-3 text-sm leading-relaxed " + inputBg}>{content.slice(0, 300)}{content.length > 300 ? "…" : ""}</div><p className={"mt-1 text-right text-xs " + subText}>共 {content.length} 字符</p></div>
          {error && <p role="alert" className={"break-words text-sm " + textColor}>{error}</p>}
          <div className="space-y-2">
            <button onClick={handleDownloadMarkdown} className={"flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold " + goldBtn}><Download size={15} className="shrink-0" />下载 Markdown 文件</button>
            <button onClick={() => void handleSendToWord()} disabled={isExporting} className={"flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm " + (isMonochrome ? "border-gray-200 text-gray-700 hover:bg-gray-50" : "border-[#404040] text-white/75 hover:bg-[#2a2a2a]")}>{isExporting ? <Loader2 size={15} className="shrink-0 animate-spin" /> : <FileText size={15} className="shrink-0" />}发送到 Word 大师（复制内容）</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
