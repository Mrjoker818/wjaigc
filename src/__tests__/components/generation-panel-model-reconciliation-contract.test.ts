import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/generation-panel.tsx'),
  'utf8',
);

describe('generation panel server model reconciliation contract', () => {
  it('reconciles a persisted stale model against the refreshed provider catalog', () => {
    const catalogStart = source.indexOf("useTaskModelCatalog('image')");
    const discoveredModelsUpdate = source.indexOf('setDiscoveredModels(serverModels);', catalogStart);
    const nextEffect = source.indexOf('}, [catalogModels]);', discoveredModelsUpdate);
    const loadModelsBlock = source.slice(discoveredModelsUpdate, nextEffect);

    expect(catalogStart).toBeGreaterThan(-1);
    expect(discoveredModelsUpdate).toBeGreaterThan(catalogStart);
    expect(nextEffect).toBeGreaterThan(discoveredModelsUpdate);
    expect(loadModelsBlock).toContain('selectInitialModel(prev, serverModels.map(entry => ({');
    expect(loadModelsBlock).not.toContain('即使模型已不存在于列表中');
    expect(source).not.toContain('const loadServerModels');
  });

  it('persists a reconciled composite key so the stale model cannot return after refresh', () => {
    const persistenceStart = source.indexOf('const persistSelectedModel = useCallback');
    const reconciliationStart = source.indexOf('// Persist any valid reconciled selection');
    const reconciliationEnd = source.indexOf('}, [model, discoveredModels, persistSelectedModel]);', reconciliationStart);
    const reconciliationBlock = source.slice(reconciliationStart, reconciliationEnd);

    expect(persistenceStart).toBeGreaterThan(-1);
    expect(reconciliationStart).toBeGreaterThan(persistenceStart);
    expect(reconciliationEnd).toBeGreaterThan(reconciliationStart);
    expect(reconciliationBlock).toContain('persistSelectedModel(model);');
    expect(source.slice(persistenceStart, reconciliationStart))
      .toContain('data.userData[currentUserId].selectedModel = compositeKey;');
    expect(source.slice(persistenceStart, reconciliationStart))
      .toContain("localStorage.setItem('wujie_selected_model'");
  });
});
