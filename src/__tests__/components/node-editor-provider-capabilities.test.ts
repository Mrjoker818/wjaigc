import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');

describe('node editor provider capability wiring', () => {
  it('drives node controls from the injected exact provider/model descriptor', () => {
    expect(source).toContain('taskModelCatalog?: TaskModelDescriptor[]');
    expect(source).toContain('modelCatalogIndex.get(taskModelKey(selectedProviderId, selectedModelId))');
    expect(source).toContain('selectedDescriptor.qualityOptions');
    expect(source).toContain('selectedDescriptor.allowedSizes');
    expect(source).toContain('selectedDescriptor.allowedRatios');
    expect(source).toContain('selectedDescriptor.allowedDurationsSeconds');
    expect(source).toContain('configUpdate[field.key] = selectedValue');
    expect(source).not.toContain('function useModelList()');
    expect(source).not.toContain("fetch('/api/workflow/models?type=all')");
  });
});
