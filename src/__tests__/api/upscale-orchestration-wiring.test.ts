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
  it('uses the shared execution planner for the remaining AI product modes', () => {
    expect(routeSource).toContain("from '@/lib/upscale-orchestrator'");
    expect(routeSource).toContain('resolveUpscaleProductMode(');
    expect(routeSource).toContain('createUpscaleExecutionPlan({');
    expect(routeSource).toContain("'ai-only'");
    expect(routeSource).not.toContain("'fidelity'");
  });

  it('maps the legacy local engine request fields onto the AI contract', () => {
    expect(routeSource).toContain("upscaleMode?: 'auto' | 'ai' | 'ai-only'");
    expect(routeSource).toContain('本地 cpu/fidelity 档已随本地模型移除');
    expect(routeSource).toContain("productMode === 'ai-only' ? 'ai' : 'auto'");
  });

  it('executes non-tiled dedicated AI plans at the planner target scale', () => {
    expect(routeSource).toContain('if (!executionPlan.tiled && executionPlan.providerId)');
    expect(routeSource).toContain('Math.ceil(executionPlan.targetScale)');
    expect(routeSource).toContain('throw new Error(`AI 超分输出尺寸不足');
  });

  it('routes tiled AI plans through overlap tile execution', () => {
    expect(routeSource).toContain("from '@/lib/upscale-tile-executor'");
    expect(routeSource).toContain('executeOverlapTileUpscale({');
    expect(routeSource).toContain('isTaskCancelled(taskId)');
    expect(routeSource).toContain('updateTaskProgress(taskId,');
  });

  it('returns auditable execution and real output metadata without a local fallback', () => {
    expect(routeSource).toContain('fallbackReason: executionPlan.fallbackReason');
    expect(routeSource).toContain('fallbackAllowed: executionPlan.fallbackAllowed');
    expect(routeSource).toContain('engine: executionPlan.engine');
    expect(routeSource).toContain('tiled: executionPlan.tiled');
    expect(routeSource).toContain('tileCount');
    expect(routeSource).toContain('const outputMetadata = await sharp(finalBuffer).metadata()');
  });

  it('never degrades to the removed local upscale engine', () => {
    expect(routeSource).not.toContain('runLocalCpuUpscale');
    expect(routeSource).not.toContain('performUpscaleAuto');
    expect(routeSource).not.toContain('performOnnxUpscale');
    expect(routeSource).not.toContain("@/lib/image-tools/upscayl");
  });

  it('keeps async AI upscale target metadata aligned and never upscales with Sharp', () => {
    expect(routeSource).toContain('_targetW: targetW');
    expect(routeSource).toContain('_targetH: targetH');
    expect(pollRouteSource).toContain('AI 超分输出尺寸不足');
    expect(pollRouteSource).toContain("const postProcessError = typeof pollResult.error === 'string' ? pollResult.error : ''");
    expect(pollRouteSource).not.toContain('sharpened + Lanczos3 upscaled');
  });
});
