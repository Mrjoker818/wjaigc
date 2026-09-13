'use client';

/**
 * 全局错误监控 — 捕获未处理异常和 Promise 拒绝
 * 在根布局中挂载，自动上报到 /api/client-error
 */

import { useEffect } from 'react';
import { attemptChunkLoadRecovery } from '@/lib/chunk-load-recovery';

interface ErrorReport {
  type: 'error' | 'unhandledrejection';
  message: string;
  stack?: string;
  url?: string;
  line?: number;
  column?: number;
  timestamp: string;
  userAgent: string;
  path: string;
}

const BENIGN_RESIZE_OBSERVER_MESSAGES = new Set([
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications.',
]);

export function isBenignResizeObserverDeliveryNotice(message: string): boolean {
  return BENIGN_RESIZE_OBSERVER_MESSAGES.has(message.trim());
}

function sendErrorReport(report: ErrorReport): void {
  // fire-and-forget: 不阻塞用户操作
  fetch('/api/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {
    // 静默失败 — 不因为错误上报本身再产生错误
  });
}

export function GlobalErrorMonitor() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (isBenignResizeObserverDeliveryNotice(event.message)) {
        event.preventDefault();
        return;
      }
      attemptChunkLoadRecovery(event.error ?? event.message);
      sendErrorReport({
        type: 'error',
        message: event.message || 'Unknown error',
        stack: event.error?.stack,
        url: event.filename,
        line: event.lineno,
        column: event.colno,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        path: window.location.pathname,
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      attemptChunkLoadRecovery(reason);
      sendErrorReport({
        type: 'unhandledrejection',
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        path: window.location.pathname,
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null;
}
