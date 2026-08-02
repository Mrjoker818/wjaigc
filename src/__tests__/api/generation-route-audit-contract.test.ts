import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const generateRoute = readFileSync(resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
const pollRoute = readFileSync(resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
const workspace = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');

describe('generation route audit contract', () => {
  it('returns the route audit from submit and poll responses', () => {
    expect(generateRoute).toContain('generationRouteAudit');
    expect(pollRoute).toContain('generationRouteAudit');
  });

  it('persists route audit metadata with canvas images', () => {
    expect(workspace).toContain('generationRouteAudit: img.generationRouteAudit || undefined');
  });
});
