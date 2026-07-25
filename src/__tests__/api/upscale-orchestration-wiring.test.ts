import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);
const pollRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/poll-task/route.ts'),
  'utf8',
);

describe('image-edit upscale orchestration wiring', () => {
  it('uses the shared execution planner for the three product modes', () => {
    expect(routeSource).toContain("from '@/lib/upscale-orchestrator'");
    expect(routeSource).toContain('createUpscaleExecutionPlan({');
    expect(routeSource).toContain("'ai-only'");
    expect(routeSource).toContain("'fidelity'");
  });

  it('executes fidelity plans according to the planner result', () => {
    expect(routeSource).toContain("if (executionPlan.engine === 'fidelity')");
  });

  it('executes non-tiled dedicated AI plans at the planner target scale', () => {
    expect(routeSource).toContain('if (!executionPlan.tiled && executionPlan.providerId)');
    expect(routeSource).toContain('Math.ceil(executionPlan.targetScale)');
    expect(routeSource).toContain("throw new Error(`AI 超分输出尺寸不足");
  });

  it('routes tiled AI plans through overlap tile execution', () => {
    expect(routeSource).toContain("from '@/lib/upscale-tile-executor'");
    expect(routeSource).toContain('executeOverlapTileUpscale({');
    expect(routeSource).toContain('isTaskCancelled(taskId)');
    expect(routeSource).toContain('updateTaskProgress(taskId,');
  });

  it('returns auditable execution and real output metadata', () => {
    expect(routeSource).toContain('fallbackReason: executionPlan.fallbackReason');
    expect(routeSource).toContain('fallbackAllowed: executionPlan.fallbackAllowed');
    expect(routeSource).toContain('engine: executionPlan.engine');
    expect(routeSource).toContain('tiled: executionPlan.tiled');
    expect(routeSource).toContain('tileCount');
    expect(routeSource).toContain('const outputMetadata = await sharp(finalBuffer).metadata()');
  });

  it('audits successful fidelity fallbacks and applies them to tiled AI failures', () => {
    expect(routeSource).toContain('const runLocalCpuUpscale = async (fallbackReason?: string) =>');
    expect(routeSource).toContain("engine: 'fidelity'");
    expect(routeSource).toContain('fallbackReason: fallbackReason ?? executionPlan.fallbackReason');
    expect(routeSource).toContain('const fidelityResult = await runLocalCpuUpscale(`AI 分块超分失败，已降级到保真模式：${errorMessage}`)');
  });

  it('keeps async AI upscale target metadata aligned and never upscales with Sharp', () => {
    expect(routeSource).toContain('_targetW: targetW');
    expect(routeSource).toContain('_targetH: targetH');
    expect(pollRouteSource).toContain('AI 超分输出尺寸不足');
    expect(pollRouteSource).toContain("const postProcessError = typeof pollResult.error === 'string' ? pollResult.error : ''");
    expect(pollRouteSource).not.toContain('sharpened + Lanczos3 upscaled');
  });
});
