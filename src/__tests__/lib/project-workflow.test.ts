import { describe, expect, it } from 'vitest';

import { workflowFromProjectMetadata } from '@/lib/project-workflow';

describe('project workflow restoration', () => {
  const workflow = {
    id: 'wf-stage-2',
    name: 'Stage 2 workflow',
    version: 'v1.0',
    nodes: [],
    connections: [],
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
  };

  it('restores a valid project-scoped workflow without mutating it', () => {
    expect(workflowFromProjectMetadata({ workflow })).toEqual(workflow);
  });

  it('rejects malformed workflow metadata', () => {
    expect(workflowFromProjectMetadata({ workflow: { ...workflow, nodes: null } })).toBeNull();
    expect(workflowFromProjectMetadata({ workflow: { ...workflow, id: '' } })).toBeNull();
    expect(workflowFromProjectMetadata(null)).toBeNull();
  });
});
