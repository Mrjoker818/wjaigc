import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);

describe('image-edit upscale orchestration wiring', () => {
  it('uses the shared execution planner for the three product modes', () => {
    expect(routeSource).toContain("from '@/lib/upscale-orchestrator'");
    expect(routeSource).toContain('createUpscaleExecutionPlan({');
    expect(routeSource).toContain("'ai-only'");
    expect(routeSource).toContain("'fidelity'");
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
});
