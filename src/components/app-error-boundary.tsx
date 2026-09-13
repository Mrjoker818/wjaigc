'use client';

import React, { Component, ReactNode } from 'react';
import { attemptChunkLoadRecovery } from '@/lib/chunk-load-recovery';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * P2-5: React class ErrorBoundary
 * 捕获 React 渲染阶段错误（window.onerror 无法捕获）
 * 用法：在 layout.tsx 中包裹 {children}
 */
export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    attemptChunkLoadRecovery(error);
    console.error('[AppErrorBoundary] 捕获渲染错误:', error, errorInfo);
    // 可选：上报错误到监控服务
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>页面渲染出错</h2>
          <p>请刷新页面重试，或联系管理员。</p>
          {this.state.error && (
            <details style={{ marginTop: '1rem', textAlign: 'left' }}>
              <summary>错误详情</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
