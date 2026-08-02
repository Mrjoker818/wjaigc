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

const localAi: UpscaleProviderCapability = {
  id: 'realesrgan',
  kind: 'local-ai',
  maxInputEdge: 1024,
  maxScale: 4,
  supportsTiling: true,
};

describe('upscale execution planning', () => {
  it('forces an exact 302 selection into AI-only mode', () => {
    expect(resolveUpscaleProductMode('auto', true)).toBe('ai-only');
    expect(resolveUpscaleProductMode('fidelity', true)).toBe('ai-only');
    expect(resolveUpscaleProductMode('auto', false)).toBe('auto');
  });

  it('uses a dedicated AI provider and overlapping tiles for 8K', () => {
    const plan = createUpscaleExecutionPlan({
      mode: 'auto',
      sourceWidth: 1920,
      sourceHeight: 1080,
      targetWidth: 8192,
      targetHeight: 4608,
      providers: [dedicatedCloud, localAi],
    });

    expect(plan.engine).toBe('dedicated-ai');
    expect(plan.providerId).toBe(dedicatedCloud.id);
    expect(plan.tiled).toBe(true);
    expect(plan.tileSize).toBeGreaterThan(plan.overlap);
    expect(plan.fallbackAllowed).toBe(true);
  });

  it('never silently falls back to CPU in ai-only mode', () => {
    expect(() => createUpscaleExecutionPlan({
      mode: 'ai-only',
      sourceWidth: 2048,
      sourceHeight: 2048,
      targetWidth: 8192,
      targetHeight: 8192,
      providers: [],
    })).toThrowError(/AI 超分模型不可用/);
  });

  it('uses fidelity mode only when explicitly requested', () => {
    const plan = createUpscaleExecutionPlan({
      mode: 'fidelity',
      sourceWidth: 1024,
      sourceHeight: 768,
      targetWidth: 4096,
      targetHeight: 3072,
      providers: [dedicatedCloud],
    });

    expect(plan.engine).toBe('fidelity');
    expect(plan.providerId).toBeNull();
    expect(plan.tiled).toBe(false);
    expect(plan.fallbackReason).toBe('用户选择保真放大');
  });

  it('reports an explainable CPU fallback in auto mode', () => {
    const plan = createUpscaleExecutionPlan({
      mode: 'auto',
      sourceWidth: 1024,
      sourceHeight: 768,
      targetWidth: 4096,
      targetHeight: 3072,
      providers: [],
    });

    expect(plan.engine).toBe('fidelity');
    expect(plan.fallbackAllowed).toBe(true);
    expect(plan.fallbackReason).toMatch(/未配置可用的 AI 超分模型/);
  });
});
