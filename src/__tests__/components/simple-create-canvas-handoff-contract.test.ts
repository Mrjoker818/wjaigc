import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/canvas-workspace.tsx', 'utf8');

describe('simple-create managed result canvas handoff wiring', () => {
  it('resolves the URL handoff after project hydration and merges the canonical asset', () => {
    expect(source).toContain('parseSimpleCreateCanvasHandoff(workspaceLocationSearch)');
    expect(source).toContain('consumeSimpleCreateCanvasHandoff({');
    expect(source).toContain('resolveReference: resolveSimpleChatCanvasReference');
    expect(source).toContain('buildSimpleChatCanvasBridgeImages([reference], Date.now())');
    expect(source).toContain('clearSimpleCreateCanvasHandoff(window.location.href)');
  });
});
