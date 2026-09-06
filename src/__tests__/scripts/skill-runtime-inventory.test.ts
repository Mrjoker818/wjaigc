import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectStage4Inventory,
  extractSkillIdsForSurface,
} from '../../../scripts/stage-4-inventory.mjs';

function intersection(left: string[], right: string[]): string[] {
  const rightIds = new Set(right);
  return left.filter(id => rightIds.has(id));
}

describe('scoped Skill runtime inventory', () => {
  it('keeps Canvas and Workflow aligned while Simple Chat remains isolated', async () => {
    const inventory = await collectStage4Inventory(process.cwd());
    const legacyCanvasIds = [
      'preset-ecommerce-listing', 'preset-logo-brand', 'preset-storyboard',
      'preset-marketing-brochure', 'preset-social-media', 'preset-ip-character',
      'preset-product-packaging', 'preset-concept-art', 'preset-interior-design',
      'preset-poster-design', 'preset-ppt-design', 'preset-magazine-cover',
      'preset-apparel-fashion', 'preset-business-card', 'preset-book-cover',
      'preset-sticker-emoji', 'preset-comic-manga', 'preset-mockup-showcase',
      'preset-illustration', 'preset-ui-design', 'preset-food-photography',
    ];

    expect(inventory.skillCatalogs.canvas).toHaveLength(24);
    expect(inventory.skillCatalogs.canvas.slice(0, legacyCanvasIds.length)).toEqual(legacyCanvasIds);
    expect(inventory.skillCatalogs.workflow).toEqual(inventory.skillCatalogs.canvas);
    expect(inventory.skillCatalogs.simpleChat).toHaveLength(16);
    expect(intersection(
      inventory.skillCatalogs.canvas,
      inventory.skillCatalogs.simpleChat,
    )).toEqual([]);
    expect(inventory.nodeTypes).toContain('ai-skill');
  });

  it('derives Workflow inventory from the declared Skill surfaces', () => {
    const source = `
      const canvasSurfaces = ['canvas' /* 'workflow' is documentation only */] as const;
      const RAW_CANVAS_PRESET_SKILLS = [{ id: 'canvas-only' }, { id: 'shared' }];
      const normalized = RAW_CANVAS_PRESET_SKILLS.map(skill => ({
        ...skill,
        allowedSurfaces: canvasSurfaces,
      }));
    `;

    expect(extractSkillIdsForSurface(
      source,
      'RAW_CANVAS_PRESET_SKILLS',
      'canvasSurfaces',
      'canvas',
    )).toEqual(['canvas-only', 'shared']);
    expect(extractSkillIdsForSurface(
      source,
      'RAW_CANVAS_PRESET_SKILLS',
      'canvasSurfaces',
      'workflow',
    )).toEqual([]);

    expect(extractSkillIdsForSurface(
      source.replace('allowedSurfaces: canvasSurfaces', 'allowedSurfaces: otherSurfaces'),
      'RAW_CANVAS_PRESET_SKILLS',
      'canvasSurfaces',
      'canvas',
    )).toEqual([]);
  });

  it('isolates the Skill E2E from the 100-node Stage 4 workflow fixture', async () => {
    const source = await readFile(resolve(
      process.cwd(),
      'tests/e2e/skill-runtime-canvas-workflow.spec.ts',
    ), 'utf8');

    expect(source).toContain('const skillFixture = structuredClone(fixture);');
    expect(source).toContain('nodes: []');
    expect(source).toContain('connections: []');
    expect(source).toContain('seedStage4Baseline(page, skillFixture, auth)');
  });

  it('requires exact model and result-version evidence in the cross-surface E2E', async () => {
    const source = await readFile(resolve(
      process.cwd(),
      'tests/e2e/skill-runtime-canvas-workflow.spec.ts',
    ), 'utf8');

    expect(source).toContain('await page.addInitScript(() => {');
    expect(source).toContain("localStorage.setItem('wujie_selected_model'");
    expect(source).not.toContain("await page.evaluate(() => localStorage.setItem('wujie_selected_model'");
    expect(source).toContain("compositeKey: 'stage4-image-provider::stage4-image-model'");
    expect(source).toContain('canvasRequest.modelBindings?.orchestrator');
    expect(source).toContain("providerId: 'stage4-chat-provider'");
    expect(source).toContain("modelId: 'stage4-chat-model'");
    expect(source).toContain('canvasRun.skillVersion');
    expect(source).toContain('workflowRun.skillVersion');
    expect(source).toContain('workflowOutput?.assetVersionIds');
    expect(source).toContain('workflowRun.assetVersionIds');
  });
});
