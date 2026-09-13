import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('canvas task projection wiring', () => {
  it('routes workspace submit, polling and resumed recovery events through the shared projector', () => {
    const workspace = source('src/components/canvas-workspace.tsx');

    expect(workspace).toContain('applyCanvasTaskEventToProcessingPlaceholders');
    expect(workspace).toContain('createImageGenerationSession');
    expect(workspace).toContain('imageGenerationSession.submit');
    expect(workspace).toContain("source: 'submit'");
    expect(workspace).toContain("source: 'poll'");
    expect(workspace).toContain("source: 'recovery'");
  });

  it('routes infinite-canvas polling and cancellation through the same projector', () => {
    const canvas = source('src/components/infinite-canvas.tsx');

    expect(canvas).toContain('applyCanvasTaskEventToProcessingPlaceholders');
    expect(canvas).toContain("source: 'poll'");
    expect(canvas).toContain("source: 'cancel'");
  });

  it('keeps task projection separate from provider requests and billing settlement', () => {
    const projector = source('src/lib/canvas-kernel/task-projection.ts');

    expect(projector).not.toContain('fetch(');
    expect(projector).not.toContain('credit');
    expect(projector).not.toContain('refund');
  });
});
