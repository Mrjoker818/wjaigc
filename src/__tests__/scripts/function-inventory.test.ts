import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ProtectedFeature {
  featureId: string;
  surface: string;
  workspace: string | null;
}

async function loadInventoryModule() {
  const scriptPath = resolve(
    process.cwd(),
    'scripts/generate-function-inventory.mjs',
  );
  return import(pathToFileURL(scriptPath).href) as Promise<{
    validateProtectedFeatures: (
      candidate: ProtectedFeature[],
      baseline?: ProtectedFeature[],
      removalApproved?: Array<string | { featureId: string }>,
    ) => void;
  }>;
}

describe('protected feature inventory contract', () => {
  it('covers every protected product surface and workspace', async () => {
    const inventoryPath = resolve(
      process.cwd(),
      'docs/testing/baselines/protected-features.json',
    );
    const features = JSON.parse(
      await readFile(inventoryPath, 'utf8'),
    ) as ProtectedFeature[];

    expect(new Set(features.map((feature) => feature.surface))).toEqual(
      new Set([
        'identity',
        'creator-dashboard',
        'admin-dashboard',
        'workspaces',
        'public-delivery',
        'desktop-connectors',
        'support-operations',
      ]),
    );

    const workspaceFeatures = features.filter(
      (feature) => feature.surface === 'workspaces',
    );
    expect(workspaceFeatures.map((feature) => feature.workspace)).toEqual(
      expect.arrayContaining(['canvas', 'workflow', 'chat']),
    );
  });

  it('uses non-empty unique feature ids', async () => {
    const inventoryPath = resolve(
      process.cwd(),
      'docs/testing/baselines/protected-features.json',
    );
    const features = JSON.parse(
      await readFile(inventoryPath, 'utf8'),
    ) as ProtectedFeature[];
    const featureIds = features.map((feature) => feature.featureId);

    expect(featureIds.every(Boolean)).toBe(true);
    expect(new Set(featureIds).size).toBe(featureIds.length);
  });

  it('blocks duplicate ids and unapproved removals', async () => {
    const inventoryPath = resolve(
      process.cwd(),
      'docs/testing/baselines/protected-features.json',
    );
    const features = JSON.parse(
      await readFile(inventoryPath, 'utf8'),
    ) as ProtectedFeature[];
    const { validateProtectedFeatures } = await loadInventoryModule();

    expect(() => validateProtectedFeatures(
      [...features, features[0]],
      features,
    )).toThrow(/Duplicate featureId/);

    expect(() => validateProtectedFeatures(
      features.slice(1),
      features,
    )).toThrow(/removed without a removalApproved record/);
  });

  it('allows an explicitly approved removal record', async () => {
    const inventoryPath = resolve(
      process.cwd(),
      'docs/testing/baselines/protected-features.json',
    );
    const features = JSON.parse(
      await readFile(inventoryPath, 'utf8'),
    ) as ProtectedFeature[];
    const { validateProtectedFeatures } = await loadInventoryModule();
    const removedFeatureId = features[0].featureId;

    expect(() => validateProtectedFeatures(
      features.slice(1),
      features,
      [{ featureId: removedFeatureId }],
    )).not.toThrow();
  });
});
