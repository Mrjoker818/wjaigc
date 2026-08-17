import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';
import { projectReactFlowRenderModel } from '@/lib/workflow-renderer/view-model';
import {
  createReactFlowCommandHandlers,
  WorkflowReactFlowSurface,
} from '@/components/workflow/WorkflowReactFlowSurface';
import { WorkflowLegacySurface } from '@/components/workflow/WorkflowLegacySurface';
import { WorkflowShadowProbe } from '@/components/workflow/WorkflowShadowProbe';

const legacyRendererSource = readFileSync(resolve(process.cwd(), 'src/components/workflow/WorkflowLegacyNodeCard.tsx'), 'utf8');

describe('WorkflowReactFlowSurface', () => {
  it('renders the domain projection as an inert custom-node surface without dispatching commands', () => {
    const workflow = createEmptyWorkflow('react flow');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'Prompt')];
    const onCommand = vi.fn();
    const markup = renderToStaticMarkup(createElement(WorkflowReactFlowSurface, {
      model: projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }),
      onCommand,
      readOnly: true,
    }));

    expect(markup).toContain('data-workflow-react-flow-surface');
    expect(markup).toContain('Prompt');
    expect(markup).toContain('out-prompt');
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('owns the legacy edge and node DOM while preserving port and collapse accessibility contracts', () => {
    const workflow = createEmptyWorkflow('legacy');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'Legacy prompt')];
    const model = projectReactFlowRenderModel(workflow, { x: 4, y: 8, zoom: 1 });
    const onCommand = vi.fn();

    const markup = renderToStaticMarkup(createElement(WorkflowLegacySurface, {
      model,
      onCommand,
      nodes: workflow.nodes,
    }));

    expect(markup).toContain('data-workflow-legacy-edge-layer');
    expect(markup).toContain('data-workflow-legacy-node-layer');
    expect(markup).toContain(`data-node-id="${workflow.nodes[0].id}"`);
    expect(markup).toContain(`data-port-id="${workflow.nodes[0].id}-out-out-prompt"`);
    expect(markup).toContain('aria-label="折叠节点"');
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('keeps legacy card side effects in the host callbacks rather than the renderer module', () => {
    expect(legacyRendererSource).not.toContain("fetch('/api/save-image'");
    expect(legacyRendererSource).not.toContain('localStorage.');
    expect(legacyRendererSource).toContain('onImageFileDrop');
    expect(legacyRendererSource).toContain('onSavePromptPreset');
  });

  it('compares the exact legacy and shadow models supplied by the host', () => {
    const workflow = createEmptyWorkflow('probe');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'Probe')];
    const legacy = projectReactFlowRenderModel(workflow, { x: 12, y: 16, zoom: 1.2 });
    const shadow = { ...legacy, nodes: [] };

    const markup = renderToStaticMarkup(createElement(WorkflowShadowProbe, {
      legacyModel: legacy,
      shadowModel: shadow,
    }));

    expect(markup).toContain('data-in-sync="false"');
  });

  it('translates React Flow moves and connections into controlled workflow commands', () => {
    const workflow = createEmptyWorkflow('commands');
    const source = createWorkflowNode('input-text', 0, 0, 'Prompt');
    const target = createWorkflowNode('ai-generate', 240, 0, 'Generate');
    workflow.nodes = [source, target];
    const onCommand = vi.fn();
    const handlers = createReactFlowCommandHandlers(
      projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }),
      onCommand,
    );

    handlers.moveNode(source.id, { x: 32, y: 12 }, 'flow-drag');
    handlers.createConnection({
      source: source.id, sourceHandle: 'out-prompt', target: target.id, targetHandle: 'in-prompt',
    }, 'flow-connect');

    expect(onCommand).toHaveBeenNthCalledWith(1, {
      type: 'nodes.move', nodeIds: [source.id], delta: { x: 32, y: 12 }, transactionId: 'flow-drag',
    });
    expect(onCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'connection.create', transactionId: 'flow-connect',
      connection: expect.objectContaining({ type: 'prompt', fromPortId: 'out-prompt', toPortId: 'in-prompt' }),
    }));
  });
});
