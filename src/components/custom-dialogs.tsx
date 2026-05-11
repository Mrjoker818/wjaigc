'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmText = '确定', cancelText = '取消', variant = 'danger', onConfirm, onCancel }: ConfirmDialogProps) {
  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  if (!open) return null;

  return (
    <div className={overlayCls} onClick={onCancel}>
      <div className={dialogCls} onClick={e => e.stopPropagation()} onKeyDown={handleKey}>
        {/* 标题 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h3 className={titleCls}>{title}</h3>
          <button onClick={onCancel} className="text-[#666] hover:text-[#d4af37] transition-colors">
            <X size={18} />
          </button>
        </div>
        {/* 消息 */}
        <div className="px-6 py-3">
          <p className="text-sm text-[#bbb] leading-relaxed">{message}</p>
        </div>
        {/* 按钮 */}
        <div className="flex justify-end gap-3 px-6 pb-5 pt-1">
          <button className={btnSecondary} onClick={onCancel}>{cancelText}</button>
          <button className={variant === 'danger' ? btnDanger : btnPrimary} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
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
