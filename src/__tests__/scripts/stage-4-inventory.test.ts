import { describe, expect, it } from 'vitest';

import { PRESET_SKILLS } from '@/components/simple-chat/simple-chat-types';
import { NODE_TYPE_LABELS, PORT_COMPATIBILITY } from '@/lib/workflow-engine';

import { collectStage4Inventory } from '../../../scripts/stage-4-inventory.mjs';

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
    expect(inventory.skills.length).toBeGreaterThan(0);
    expect(inventory.skills.length).toBeGreaterThanOrEqual(PRESET_SKILLS.length);

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
});
