import { describe, expect, it } from 'vitest';
import {
  createUpscaleExecutionPlan,
  resolveUpscaleProductMode,
  type UpscaleProviderCapability,
} from '@/lib/upscale-orchestrator';

const dedicatedCloud: UpscaleProviderCapability = {
  id: '302-super-upscale-v2',
  kind: 'dedicated-ai',
  maxInputEdge: 2048,
  maxScale: 4,
  supportsTiling: true,
};

describe('upscale execution planning', () => {
  it('forces an exact 302 selection into AI-only mode', () => {
    expect(resolveUpscaleProductMode('auto', true)).toBe('ai-only');
    expect(resolveUpscaleProductMode('fidelity', true)).toBe('ai-only');
    expect(resolveUpscaleProductMode('auto', false)).toBe('auto');
  });

  it('normalizes removed local engine modes to auto', () => {
    // 本地 cpu/fidelity 引擎已随本地模型移除；旧偏好值归一化为 auto（云端 AI）。
    expect(resolveUpscaleProductMode('fidelity', false)).toBe('auto');
    expect(resolveUpscaleProductMode('cpu', false)).toBe('auto');
    expect(resolveUpscaleProductMode('local', false)).toBe('auto');
  });

  it('uses a dedicated AI provider and overlapping tiles for 8K', () => {
    const plan = createUpscaleExecutionPlan({
      mode: 'auto',
      sourceWidth: 1920,
      sourceHeight: 1080,
      targetWidth: 8192,
      targetHeight: 4608,
      providers: [dedicatedCloud],
    });

    expect(plan.engine).toBe('dedicated-ai');
    expect(plan.providerId).toBe(dedicatedCloud.id);
    expect(plan.tiled).toBe(true);
    expect(plan.tileSize).toBeGreaterThan(plan.overlap);
  });

  it('never silently falls back when no AI provider is configured', () => {
    expect(() => createUpscaleExecutionPlan({
      mode: 'ai-only',
      sourceWidth: 2048,
      sourceHeight: 2048,
      targetWidth: 8192,
      targetHeight: 8192,
      providers: [],
    })).toThrowError(/AI 超分模型不可用/);
    expect(() => createUpscaleExecutionPlan({
      mode: 'auto',
      sourceWidth: 1024,
      sourceHeight: 768,
      targetWidth: 4096,
      targetHeight: 3072,
      providers: [],
    })).toThrowError(/AI 超分模型不可用/);
  });

  it('reports no fallback target now that the local engine is removed', () => {
    const plan = createUpscaleExecutionPlan({
      mode: 'auto',
      sourceWidth: 1024,
      sourceHeight: 768,
      targetWidth: 4096,
      targetHeight: 3072,
      providers: [dedicatedCloud],
    });

    expect(plan.engine).toBe('dedicated-ai');
    expect(plan.fallbackAllowed).toBe(false);
    expect(plan.fallbackReason).toBeNull();
  });
});
