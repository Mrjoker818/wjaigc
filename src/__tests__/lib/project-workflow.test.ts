import { describe, expect, it } from 'vitest';

import {
  mergeWorkflowIntoProjectMetadata,
  workflowFromProjectMetadata,
} from '@/lib/project-workflow';
import type { Workflow } from '@/lib/workflow-engine';

describe('project workflow restoration', () => {
  const workflow: Workflow = {
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

  it('binds a saved workflow to its project without dropping existing metadata', () => {
    const metadata = {
      groups: [{ id: 'group-1' }],
      viewState: { zoom: 1.25, offsetX: 12, offsetY: 34 },
    };

    expect(mergeWorkflowIntoProjectMetadata(metadata, workflow)).toEqual({
      ...metadata,
      workflow,
    });
    expect(metadata).not.toHaveProperty('workflow');
  });

  it('rejects malformed workflow metadata', () => {
    expect(workflowFromProjectMetadata({ workflow: { ...workflow, nodes: null } })).toBeNull();
    expect(workflowFromProjectMetadata({ workflow: { ...workflow, id: '' } })).toBeNull();
    expect(workflowFromProjectMetadata(null)).toBeNull();
  });
});
