import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as quickCreateCompile from '@/lib/quick-create-compile';

type TransportFallbackModule = typeof quickCreateCompile & {
  shouldFallbackQuickCreateCompile?: (error: unknown, terminalCode?: string | null) => boolean;
};

const canvasWorkspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

describe('quick create transport fallback', () => {
  it('falls back only when the compiler transport fails without a terminal server error', () => {
    const shouldFallback = (quickCreateCompile as TransportFallbackModule)
      .shouldFallbackQuickCreateCompile;

    expect(shouldFallback).toBeTypeOf('function');
    if (!shouldFallback) return;

    expect(shouldFallback(new TypeError('network error'))).toBe(true);
    expect(shouldFallback(new Error('Failed to fetch'))).toBe(true);
    expect(shouldFallback(new Error('快速创作服务未返回可读取的流'))).toBe(true);
    expect(shouldFallback(new Error('快速创作服务返回了无法解析的 SSE 事件'))).toBe(true);
    expect(shouldFallback(new Error('快速创作编译失败（HTTP 404）'))).toBe(true);
    expect(shouldFallback(new Error('模型未返回完整的 JSON 对象'))).toBe(false);
    expect(shouldFallback(new TypeError('network error'), 'PROMPT_BLOCKED')).toBe(false);
    expect(shouldFallback(new Error('快速创作编译失败（HTTP 404）'), 'UNAUTHORIZED')).toBe(false);
  });

  it('submits the raw request through the existing image generation path after a transport failure', () => {
    expect(canvasWorkspaceSource).toContain('shouldFallbackQuickCreateCompile(error, compileErrorCode)');
    expect(canvasWorkspaceSource).toContain('createQuickCreateFallbackResult(request');
    expect(canvasWorkspaceSource).toContain('prompt: finalResult.positivePrompt');
  });
});
