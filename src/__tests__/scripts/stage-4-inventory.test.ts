import { describe, expect, it } from 'vitest';

import { NODE_TYPE_LABELS, PORT_COMPATIBILITY } from '@/lib/workflow-engine';

import {
  collectStage4Inventory,
  extractSkillIds,
} from '../../../scripts/stage-4-inventory.mjs';

const expectedSkillIds = [
  'brand-visual-design',
  'code-reviewer',
  'creative-writing',
  'email-master',
  'excel-master',
  'flowchart-master',
  'infographic-design',
  'meeting-notes',
  'mindmap-master',
  'pdf-master',
  'poster-design',
  'ppt-master',
  'ppt-page-design',
  'preset-apparel-fashion',
  'preset-book-cover',
  'preset-business-card',
  'preset-comic-manga',
  'preset-concept-art',
  'preset-ecommerce-listing',
  'preset-food-photography',
  'preset-illustration',
  'preset-interior-design',
  'preset-ip-character',
  'preset-logo-brand',
  'preset-magazine-cover',
  'preset-marketing-brochure',
  'preset-mockup-showcase',
  'preset-poster-design',
  'preset-ppt-design',
  'preset-product-packaging',
  'preset-social-media',
  'preset-sticker-emoji',
  'preset-storyboard',
  'preset-ui-design',
  'project-plan',
  'report-master',
  'word-master',
];

describe('Stage 4 inventory generator', () => {
  it('captures the three legacy workspaces and their structured coverage details', async () => {
    const inventory = await collectStage4Inventory(process.cwd());

    expect(inventory.workspaces.map(item => item.id)).toEqual([
      'canvas',
      'workflow',
      'simple-chat',
    ]);
    expect(inventory.nodeTypes).toEqual(Object.keys(NODE_TYPE_LABELS).sort());
    expect(inventory.portTypes).toEqual(Object.keys(PORT_COMPATIBILITY).sort());
    expect(inventory.routes).toContain('/api/chat');
    expect(inventory.routes).toContain('/api/simple-chat/chat');
    expect(inventory.routes).toContain('/api/agent-edit');
    expect(inventory.agentTools.length).toBeGreaterThan(0);
    expect(inventory.skills).toEqual(expectedSkillIds);

    for (const workspace of inventory.workspaces) {
      expect(workspace.entryRoute.length).toBeGreaterThan(0);
      expect(workspace.components.length).toBeGreaterThan(0);
      expect(workspace.routes.length).toBeGreaterThan(0);
      expect(workspace.taskTypes.length).toBeGreaterThan(0);
      expect(workspace.assetInputs.length).toBeGreaterThan(0);
      expect(workspace.assetOutputs.length).toBeGreaterThan(0);
      expect(typeof workspace.hasAutomatedCoverage).toBe('boolean');
      expect(['low', 'medium', 'high']).toContain(workspace.risk);
    }
  });

  it('extracts IDs only from the requested raw preset array', () => {
    const source = `
      const helper = { id: 'outside-before' };
      const RAW_CANVAS_PRESET_SKILLS = [
        { id: 'kept-second' },
        { id: 'kept-first' },
      ];
      const unrelated = [{ id: 'outside-after' }];
    `;

    expect(extractSkillIds(source, 'RAW_CANVAS_PRESET_SKILLS')).toEqual([
      'kept-first',
      'kept-second',
    ]);
  });
});
