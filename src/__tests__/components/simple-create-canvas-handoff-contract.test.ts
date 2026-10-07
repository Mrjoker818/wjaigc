import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/canvas-workspace.tsx', 'utf8');

describe('simple-create managed result canvas handoff wiring', () => {
  it('resolves the URL handoff after project hydration and merges the canonical asset', () => {
    expect(source).toContain('parseSimpleCreateCanvasHandoff(workspaceLocationSearch)');
    expect(source).toContain('consumeSimpleCreateCanvasHandoff({');
    expect(source).toContain('resolveReference: reference => resolveSimpleChatCanvasReference(reference, fetch, {');
    expect(source).toContain('buildSimpleChatCanvasBridgeImages([reference], Date.now())');
    expect(source).toContain('clearSimpleCreateCanvasHandoff(window.location.href)');
  });

  it('binds the handoff read and merge to the actor and cancellable project scope', () => {
    const effect = source.slice(source.indexOf('const workspaceLocationSearch'), source.indexOf('const handoffBootstrapWorkflow'));
    expect(effect).toContain('expectedActorUserId: actorId');
    expect(effect).toContain('signal: controller.signal, isCurrent');
    expect(effect).toContain('currentUserRef.current?.id === actorId');
    expect(effect).toContain('if (!isCurrent())');
    expect(effect).toContain('controller.abort()');
  });
});
