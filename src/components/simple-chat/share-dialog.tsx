"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { Check, Copy, Link2, Loader2, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { expectedActorHeaders } from "@/lib/expected-actor-header";

interface ShareDialogProps {
  userId: string;
  conversationId: string;
  conversationTitle: string;
  messages: Array<{ id: string; role: string; content: string; images?: string[]; timestamp?: number | string }>;
  onClose: () => void;
}

export function ShareDialog({ userId, conversationId, conversationTitle, messages, onClose }: ShareDialogProps): ReactElement {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true), creating = useRef(false), copying = useRef(false), returnFocus = useRef<HTMLElement | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shareableMessages = messages.filter((message) => message.role !== "system");
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (copiedTimer.current) clearTimeout(copiedTimer.current); };
  }, []);

  const createShare = async (): Promise<void> => {
    if (creating.current || !mounted.current) return;
    creating.current = true;
    setIsCreating(true);
    setError("");
    try {
      const key = JSON.stringify(["simple-chat-share", userId, conversationId]);
      const pendingOperation = sessionStorage.getItem(key);
      const operation = pendingOperation ?? crypto.randomUUID();
      if (!pendingOperation) sessionStorage.setItem(key, operation);
      const res = await fetch("/api/simple-chat/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operation,
          ...expectedActorHeaders(userId),
        },
        body: JSON.stringify({ conversationId, title: conversationTitle, messages: shareableMessages }),
      });
      const value: unknown = await res.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("分享返回结果无效，请先核对创建结果。");
      const data = value as Record<string, unknown>;
      if (!res.ok) {
        if (res.status === 410 && sessionStorage.getItem(key) === operation) sessionStorage.removeItem(key);
        throw new Error(typeof data.error === "string" && data.error ? data.error : "创建分享失败");
      }
      if (typeof data.shareId !== "string" || !/^[0-9a-f]{16}$/.test(data.shareId) || data.shareUrl !== "/shared/" + data.shareId) {
        throw new Error("分享返回的链接无效。再次点击创建可找回原链接。");
      }
      if (mounted.current) {
        if (sessionStorage.getItem(key) === operation) sessionStorage.removeItem(key);
        setShareUrl(window.location.origin + data.shareUrl);
      }
    } catch (err) {
      if (mounted.current) {
        const message = err instanceof SyntaxError ? "分享返回格式异常。再次点击创建可找回原链接。" : err instanceof Error ? err.message : "创建分享失败";
        setError(message);
        toast.error(message);
      }
    } finally {
      creating.current = false;
      if (mounted.current) setIsCreating(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!shareUrl || copying.current || !mounted.current) return;
    copying.current = true;
    setIsCopying(true);
    setCopied(false);
    setError("");
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    try {
      await navigator.clipboard.writeText(shareUrl);
      if (mounted.current) {
        setCopied(true);
        toast.success("链接已复制");
        copiedTimer.current = setTimeout(() => { if (mounted.current) setCopied(false); }, 2000);
      }
    } catch {
      if (mounted.current) { setError("复制失败，请检查剪贴板权限，或选中链接手动复制。"); toast.error("复制失败，请手动复制链接"); }
    } finally {
      copying.current = false;
      if (mounted.current) setIsCopying(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}
        style={{ animation: "none" }} className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-md flex-col gap-0 overflow-hidden p-0 text-foreground sm:max-w-md">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-2"><Share2 size={17} className="shrink-0 text-primary" /><DialogTitle className="text-sm font-semibold">分享对话</DialogTitle></div>
          <button onClick={onClose} aria-label="关闭分享对话" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><X size={16} /></button>
        </div>
        <div className="min-h-0 min-w-0 space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
          {!shareUrl ? <>
            <p className="min-w-0 break-words text-sm text-foreground">{conversationTitle}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">将生成一个公开链接，任何人都可以通过链接查看此对话的 {shareableMessages.length} 条消息（只读）。</p>
            <button onClick={() => void createShare()} disabled={isCreating} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-gray-950 hover:bg-primary/90 disabled:opacity-40">{isCreating ? <Loader2 size={15} className="shrink-0 animate-spin" /> : <Link2 size={15} className="shrink-0" />}{isCreating ? "创建中..." : "创建分享链接"}</button>
            {isCreating && <p className="text-xs text-muted-foreground">关闭仅退出查看，不会撤回已发出的创建请求。</p>}
          </> : <>
            <p className="text-sm text-muted-foreground">分享链接已创建，有效期 30 天：</p>
            <div className="flex min-w-0 gap-2">
              <input aria-label="分享链接" readOnly value={shareUrl} className="min-h-11 w-0 min-w-0 flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-base" onFocus={(event) => event.target.select()} />
              <button onClick={() => void handleCopy()} disabled={isCopying} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm text-gray-950 hover:bg-primary/90 disabled:opacity-40">{isCopying ? <Loader2 size={14} className="shrink-0 animate-spin" /> : copied ? <Check size={14} className="shrink-0" /> : <Copy size={14} className="shrink-0" />}<span aria-live="polite">{isCopying ? "复制中…" : copied ? "已复制" : "复制"}</span></button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">注意：任何获得链接的人都可以查看此对话内容，请避免分享敏感信息。</p>
          </>}
          {error && <p role="alert" className="break-words rounded-lg bg-muted p-3 text-sm text-foreground">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
