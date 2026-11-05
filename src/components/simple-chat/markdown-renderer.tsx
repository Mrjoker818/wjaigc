"use client";

import { isValidElement, memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isDark?: boolean;
}

function codePlainText(value: React.ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(codePlainText).join("");
  if (isValidElement<{ children?: React.ReactNode }>(value)) return codePlainText(value.props.children);
  return "";
}

function CodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copyingRef = useRef(false);
  const mountedRef = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearTimeout(resetTimer.current); };
  }, []);
  const codeText = codePlainText(children).replace(/\n$/, "");

  const handleCopy = async (): Promise<void> => {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    setCopyError(false);
    setCopied(false);
    clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(codeText);
      if (mountedRef.current) {
        setCopied(true);
        resetTimer.current = setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      if (mountedRef.current) setCopyError(true);
    } finally {
      copyingRef.current = false;
      if (mountedRef.current) setCopying(false);
    }
  };

  const lang = /language-(\w+)/.exec(className || "")?.[1];

  return (
    <div className="group/code relative my-3 min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-zinc-950">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">{lang || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          disabled={copying}
          aria-busy={copying}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded px-2 text-xs text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
        >
          {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          {copying ? "复制中" : copied ? "已复制" : "复制"}
        </button>
      </div>
      {copyError && <p role="alert" className="px-3 py-2 text-xs text-red-300">复制失败</p>}
      <pre className="[overflow-wrap:normal] overflow-x-auto p-3 text-[13px] leading-relaxed text-zinc-100">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className = "", isDark: _isDark }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body min-w-0 max-w-full [overflow-wrap:anywhere] text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className: codeClass, children, ...props }) => {
            const isBlock = /language-(\w+)/.test(codeClass || "") || String(children).includes("\n");
            if (isBlock) {
              return <CodeBlock className={codeClass}>{children}</CodeBlock>;
            }
            return (
              <code className="rounded bg-muted px-1.5 py-0.5 text-[13px] font-mono text-foreground" {...props}>
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          th: ({ children }) => <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-border/50 px-3 py-2">{children}</td>,
          h1: ({ children }) => <h1 className="mb-3 mt-5 text-xl font-bold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2.5 mt-4 text-lg font-bold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mb-1.5 mt-2.5 text-sm font-semibold first:mt-0">{children}</h4>,
          p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2.5 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2.5 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-2.5 border-l-3 border-primary/40 bg-muted/40 py-1 pl-3 italic text-muted-foreground last:mb-0">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">
              {children}
            </a>
          ),
          hr: () => <hr className="my-4 border-border" />,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
