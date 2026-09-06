import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectStage4Inventory,
  extractSkillIds,
  extractSkillIdsForSurface,
} from '../../../scripts/stage-4-inventory.mjs';

function intersection(left: string[], right: string[]): string[] {
  const rightIds = new Set(right);
  return left.filter(id => rightIds.has(id));
}

describe('scoped Skill runtime inventory', () => {
  it('finds the real named array past declarations hidden in lexical trivia', () => {
    const source = [
      "// export const TARGET_SKILLS = [{ id: 'line-comment-decoy' }];",
      "/* const TARGET_SKILLS = [{ id: 'block-comment-decoy' }]; */",
      'const prose = "export const TARGET_SKILLS = [{ id: \'string-decoy\' }]";',
      "const example = `const TARGET_SKILLS = [{ id: 'template-decoy' }]`;",
      'export const TARGET_SKILLS: readonly unknown[] = [',
      '  {',
      "    id: 'real-first',",
      "    metadata: { nested: { closingBracket: ']' } },",
      '  },',
      "  /* { id: 'nested-comment-decoy' }, ] */",
      '  {',
      "    id: 'real-second',",
      "    metadata: { nested: [{ note: 'kept' }] },",
      '  },',
      '];',
    ].join('\n');

    expect(extractSkillIds(source, 'TARGET_SKILLS')).toEqual(['real-first', 'real-second']);
  });

  it('resolves only direct Skill ids from real top-level string constants', () => {
    const source = [
      "// const REAL_ID = 'line-comment-decoy';",
      "/* const REAL_ID = 'block-comment-decoy'; */",
      'const prose = "const REAL_ID = \'string-decoy\'";',
      "const example = `const REAL_ID = 'template-decoy'`;",
      "const REAL_ID = 'real-constant-id';",
      'export const TARGET_SKILLS = [',
      '  {',
      '    id: REAL_ID,',
      "    metadata: { id: 'nested-object-decoy' },",
      '  },',
      "  { id: 'real-literal-id' },",
      '];',
    ].join('\n');

    expect(extractSkillIds(source, 'TARGET_SKILLS')).toEqual([
      'real-constant-id',
      'real-literal-id',
    ]);
  });

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

  it('rejects surface references that do not belong to the target Skill construction', () => {
    const source = `
      const canvasSurfaces = ['canvas'] as const;
      const otherSurfaces = ['workflow'] as const;
      const prose = 'allowedSurfaces: canvasSurfaces';
      const example = \`allowedSurfaces: canvasSurfaces\`;
      const unrelated = { nested: { allowedSurfaces: canvasSurfaces } };
      const TARGET_SKILLS = [{ id: 'workflow-only' }];
      const normalized = TARGET_SKILLS.map(skill => ({
        ...skill,
        metadata: { allowedSurfaces: canvasSurfaces },
        allowedSurfaces: otherSurfaces,
      }));
    `;

    expect(extractSkillIdsForSurface(
      source,
      'TARGET_SKILLS',
      'canvasSurfaces',
      'canvas',
    )).toEqual([]);
  });

  it('rejects unrelated calls that merely receive the target Skill array', () => {
    const source = `
      const canvasSurfaces = ['canvas'] as const;
      const TARGET_SKILLS = [{ id: 'not-normalized' }];
      function inspect(skills) {
        void skills;
        return { allowedSurfaces: canvasSurfaces };
      }
      const inspected = inspect(TARGET_SKILLS);
    `;

    expect(extractSkillIdsForSurface(
      source,
      'TARGET_SKILLS',
      'canvasSurfaces',
      'canvas',
    )).toEqual([]);
  });

  it('rejects map callbacks that replace rather than normalize each target Skill', () => {
    const source = `
      const canvasSurfaces = ['canvas'] as const;
      const TARGET_SKILLS = [{ id: 'replaced-skill' }];
      const replacements = TARGET_SKILLS.map(() => ({
        id: 'unrelated-output',
        allowedSurfaces: canvasSurfaces,
      }));
    `;

    expect(extractSkillIdsForSurface(
      source,
      'TARGET_SKILLS',
      'canvasSurfaces',
      'canvas',
    )).toEqual([]);
  });

  it('rejects factories that discard the argument carrying the Skill id', () => {
    const source = `
      const surfaces = ['canvas'] as const;
      function inspect(input) {
        void input;
        return { allowedSurfaces: surfaces };
      }
      const TARGET_SKILLS = [inspect({ id: 'ghost' })];
    `;

    expect(extractSkillIdsForSurface(
      source,
      'TARGET_SKILLS',
      'surfaces',
      'canvas',
    )).toEqual([]);
  });

  it('extracts ids from the real legacy and marketing Skill definitions', async () => {
    const [legacySource, marketingSource] = await Promise.all([
      readFile(resolve(process.cwd(), 'src/lib/skill-runtime/canvas-presets.ts'), 'utf8'),
      readFile(resolve(process.cwd(), 'src/lib/skill-runtime/marketing-presets.ts'), 'utf8'),
    ]);

    const legacyIds = extractSkillIdsForSurface(
      legacySource,
      'RAW_CANVAS_PRESET_SKILLS',
      'canvasSurfaces',
      'workflow',
    );
    const marketingIds = extractSkillIdsForSurface(
      marketingSource,
      'LOVART_MARKETING_SKILLS',
      'surfaces',
      'canvas',
    );

    expect(legacyIds).toHaveLength(21);
    expect(legacyIds[0]).toBe('preset-ecommerce-listing');
    expect(legacyIds.at(-1)).toBe('preset-food-photography');
    expect(marketingIds).toEqual([
      'preset-ad-ab-variants',
      'preset-retargeting-creative',
      'preset-omnichannel-campaign',
    ]);
  });

  it('isolates the Skill E2E from the 100-node Stage 4 workflow fixture', async () => {
    const source = await readFile(resolve(
      process.cwd(),
      'tests/e2e/skill-runtime-canvas-workflow.spec.ts',
    ), 'utf8');

    const isolatedFixture = source.indexOf('const skillFixture = structuredClone(fixture);');
    const minimalWorkflow = source.indexOf('nodes: [sourceNode, marketingNode]');
    const seed = source.indexOf('seedStage4Baseline(page, skillFixture, auth)');

    expect(isolatedFixture).toBeGreaterThan(0);
    expect(minimalWorkflow).toBeGreaterThan(isolatedFixture);
    expect(seed).toBeGreaterThan(minimalWorkflow);
    expect(source).toContain('fromNodeId: sourceNode.id');
    expect(source).toContain('toNodeId: marketingNode.id');
    expect(source).not.toContain("from '../../scripts/stage-4-e2e-fixtures.mjs'");
    expect(source).not.toContain('buildStage4FixturePlan');
    expect(source).not.toContain('expectedNodeIds');
    expect(source).not.toContain('nodeCount');
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
