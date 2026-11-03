'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

/* ─── 通用弹窗样式变量 ─── */
const overlayCls = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm';
const dialogCls = 'relative w-full max-w-md rounded-2xl border border-[#d4af37]/30 bg-[#1a1a1a] shadow-2xl shadow-black/50';
const titleCls = 'text-lg font-semibold text-[#f0e6d3]';
const inputCls = 'w-full rounded-xl border border-[#444] bg-[#2a2a2a] px-4 py-3 text-sm text-[#f0e6d3] placeholder:text-[#888] focus:border-[#d4af37] focus:outline-none focus:ring-1 focus:ring-[#d4af37]/40 transition-all';
const btnBase = 'rounded-xl px-5 py-2.5 text-sm font-medium transition-all';
const btnPrimary = `${btnBase} bg-[#d4af37] text-[#1a1a1a] hover:bg-[#e5c249] active:scale-95`;
const btnSecondary = `${btnBase} border border-[#555] text-[#aaa] hover:border-[#d4af37]/50 hover:text-[#d4af37] active:scale-95`;
const btnDanger = `${btnBase} bg-red-600/80 text-white hover:bg-red-500 active:scale-95`;

/* ─── PromptDialog: 替代 window.prompt ─── */
interface PromptDialogProps {
  open: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({ open, title, placeholder, defaultValue = '', onConfirm, onCancel }: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [open, defaultValue]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onConfirm(value);
    if (e.key === 'Escape') onCancel();
  }, [value, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div className={overlayCls} onClick={onCancel}>
      <div className={dialogCls} onClick={e => e.stopPropagation()}>
        {/* 标题 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h3 className={titleCls}>{title}</h3>
          <button onClick={onCancel} className="text-[#666] hover:text-[#d4af37] transition-colors">
            <X size={18} />
          </button>
        </div>
        {/* 输入框 */}
        <div className="px-6 py-3">
          <input
            ref={inputRef}
            className={inputCls}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            autoFocus
          />
        </div>
        {/* 按钮 */}
        <div className="flex justify-end gap-3 px-6 pb-5 pt-1">
          <button className={btnSecondary} onClick={onCancel}>取消</button>
          <button className={btnPrimary} onClick={() => onConfirm(value)}>确定</button>
        </div>
      </div>
    </div>
  );
}

/* ─── ConfirmDialog: 替代 window.confirm ─── */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  details?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  returnFocusFallback?: () => HTMLElement | null;
}

export function ConfirmDialog({ open, title, message, details, confirmText = '确定', cancelText = '取消', variant = 'danger', onConfirm, onCancel, returnFocusFallback }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);
  const operationVersion = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  useLayoutEffect(() => {
    operationVersion.current++;
    submittingRef.current = false;
    setSubmitting(false);
    setSubmitError('');
    return () => { operationVersion.current++; };
  }, [open, onConfirm]);
  const requestCancel = (): void => { if (!submittingRef.current) onCancel(); };
  const confirm = async (): Promise<void> => {
    if (submittingRef.current) return;
    const version = operationVersion.current;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    try { await onConfirm(); }
    catch {
      if (operationVersion.current === version) setSubmitError('未能确认操作结果，请核对当前状态。');
    } finally {
      if (operationVersion.current === version) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  if (!open) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={value => { if (!value) requestCancel(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayCls} />
        <DialogPrimitive.Content aria-modal="true" aria-busy={submitting} className={dialogCls}
          style={{ position: 'fixed', zIndex: 10000, left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'calc(100vw - 2rem)', maxHeight: 'calc(100dvh - 2rem)', overflowY: 'auto' }}
          onOpenAutoFocus={event => {
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={event => {
            const focus = (target: HTMLElement | null | undefined): boolean => {
              if (!target?.isConnected || target.matches(':disabled')) return false;
              for (let node: HTMLElement | null = target; node; node = node.parentElement) {
                if (node.hidden || node.hasAttribute('inert')) return false;
                const style = getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
              }
              target.focus({ preventScroll: true });
              return document.activeElement === target;
            };
            if (focus(returnFocusRef.current) || focus(returnFocusFallback?.())) event.preventDefault();
          }}
          onEscapeKeyDown={event => { if (submittingRef.current) event.preventDefault(); }}
          onInteractOutside={event => { if (submittingRef.current) event.preventDefault(); }}>
        {/* 标题 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <DialogPrimitive.Title asChild><h3 className={titleCls}>{title}</h3></DialogPrimitive.Title>
          <button aria-label={`关闭${title}`} disabled={submitting} onClick={requestCancel} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#666] hover:text-[#d4af37] transition-colors disabled:opacity-50">
            <X size={18} />
          </button>
        </div>
        {/* 消息 */}
        <div className="px-6 py-3">
          <DialogPrimitive.Description asChild><p className="break-words text-sm text-[#bbb] leading-relaxed">{message}</p></DialogPrimitive.Description>
        </div>
        {details && (
          <div role="region" aria-label="待删除项目" tabIndex={0} className="mx-6 mb-3 max-h-[min(40dvh,18rem)] overflow-y-auto overscroll-contain rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4af37]">
            {details}
          </div>
        )}
        {submitError && <p role="alert" className="mx-6 mb-3 text-sm text-red-300">{submitError}</p>}
        {/* 按钮 */}
        <div className="flex justify-end gap-3 px-6 pb-5 pt-1">
          <button ref={cancelRef} disabled={submitting} className={`${btnSecondary} min-h-[44px] min-w-[44px] disabled:opacity-50`} onClick={requestCancel}>{cancelText}</button>
          <button disabled={submitting} className={`${variant === 'danger' ? btnDanger : btnPrimary} min-h-[44px] min-w-[44px] disabled:opacity-50`} onClick={() => { void confirm(); }}>{confirmText}</button>
        </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ─── TextareaDialog: 多行文本输入弹窗 ─── */
interface TextareaDialogProps {
  open: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function TextareaDialog({ open, title, placeholder, defaultValue = '', onConfirm, onCancel }: TextareaDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, defaultValue]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  if (!open) return null;

  return (
    <div className={overlayCls} onClick={onCancel}>
      <div className={dialogCls} onClick={e => e.stopPropagation()}>
        {/* 标题 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h3 className={titleCls}>{title}</h3>
          <button onClick={onCancel} className="text-[#666] hover:text-[#d4af37] transition-colors">
            <X size={18} />
          </button>
        </div>
        {/* 文本域 */}
        <div className="px-6 py-3">
          <textarea
            ref={textareaRef}
            className={`${inputCls} min-h-[100px] resize-y`}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            autoFocus
          />
        </div>
        {/* 按钮 */}
        <div className="flex justify-end gap-3 px-6 pb-5 pt-1">
          <button className={btnSecondary} onClick={onCancel}>取消</button>
          <button className={btnPrimary} onClick={() => onConfirm(value)}>确定</button>
        </div>
      </div>
    </div>
  );
}
