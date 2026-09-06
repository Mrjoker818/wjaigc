import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { frozenDefinition } from '@/lib/skill-runtime/continuation';

describe('Skill runtime frozen continuation', () => {
  it('restores the complete validated input contract from the frozen snapshot', () => {
    const definition = frozenDefinition({
      id: 'custom-source-bound', version: 4, name: 'Frozen source skill',
      executionContextVersion: 1, systemPrompt: 'Use frozen constraints',
      inputs: [{
        key: 'sources', label: 'Sources', kind: 'multi-select', required: true,
        defaultValue: ['version-a'], options: ['version-a', 'version-b'], maximumItems: 2,
        bindToSourceVersions: true,
      }],
      steps: [{
        id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential',
        promptTemplate: '{{sources}}', modelRole: 'orchestrator', qualityGateIds: [],
      }],
    }, 'canvas', 'custom-source-bound', 4);

    expect(definition.inputs).toEqual([{
      key: 'sources', label: 'Sources', kind: 'multi-select', required: true,
      defaultValue: ['version-a'], options: ['version-a', 'version-b'], maximumItems: 2,
      bindToSourceVersions: true,
    }]);
  });

  it.each([
    [{ defaultValue: ['version-a', 1] }],
    [{ options: ['version-a', 1] }],
    [{ maximumItems: 0 }],
    [{ bindToSourceVersions: 'true' }],
  ])('rejects malformed frozen input metadata %#', extra => {
    expect(() => frozenDefinition({
      id: 'bad', version: 1, name: 'Bad', executionContextVersion: 1, systemPrompt: 'Bad',
      inputs: [{ key: 'sources', label: 'Sources', kind: 'multi-select', required: true, ...extra }],
      steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: '', modelRole: 'orchestrator', qualityGateIds: [] }],
    }, 'canvas', 'bad', 1)).toThrow('Frozen Skill input is invalid');
  });
});
