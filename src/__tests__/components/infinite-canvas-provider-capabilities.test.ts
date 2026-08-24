import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('infinite canvas provider capability wiring', () => {
  it('uses the injected exact descriptor for generation-group controls', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

    expect(source).toContain('taskModelCatalog?: TaskModelDescriptor[]');
    expect(source).toContain('createTaskModelCatalogIndex(taskModelCatalog)');
    expect(source).toContain('taskModelKey(group.toolbar.providerId, group.toolbar.model)');
    expect(source).toContain('groupDescriptor?.allowedRatios ?? []');
    expect(source).toContain('groupDescriptor?.qualityOptions ?? []');
    expect(source).toContain('groupDescriptor?.allowedSizes ?? []');
    expect(source).toContain('groupDescriptor.maxOutputs');
    expect(source).not.toContain("fetch('/api/models?type=image')");
    expect(source).not.toContain("localStorage.getItem('unbounded_ai_api_providers')");
  });
});
