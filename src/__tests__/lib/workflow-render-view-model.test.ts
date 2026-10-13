import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  NODE_TYPE_LABELS,
  PORT_COMPATIBILITY,
  canConnectPorts,
  createEmptyWorkflow,
  createWorkflowNode,
  type NodeType,
  type PortType,
} from '@/lib/workflow-engine';
import {
  projectLegacyRenderModel,
  projectReactFlowRenderModel,
  projectWorkflowRenderModel,
  type WorkflowRenderViewport,
} from '@/lib/workflow-renderer/view-model';

const viewport: WorkflowRenderViewport = { x: 12, y: -8, zoom: 0.75 };
const portTypes: PortType[] = ['image', 'mask', 'prompt', 'condition', 'any', 'data', 'video', 'audio', 'frames', 'text', 'document-reference'];
const expectedPortCompatibility: Record<PortType, PortType[]> = {
  image: ['image', 'any'],
  mask: ['mask', 'any'],
  prompt: ['prompt', 'any', 'text'],
  condition: ['condition', 'any'],
  any: ['any'],
  data: ['data', 'any', 'prompt', 'image'],
  video: ['video', 'any', 'image'],
  audio: ['audio', 'any'],
  frames: ['frames', 'any', 'image'],
  text: ['text', 'prompt', 'any'],
  'document-reference': ['document-reference'],
};

describe('workflow render view model', () => {
  it('projects every workflow node, edge, port, and viewport without changing the domain', () => {
    const workflow = createEmptyWorkflow('projection');
    const source = createWorkflowNode('input-image', 40, 64, 'source');
    const target = createWorkflowNode('ai-generate', 320, 64, 'target');
    workflow.nodes = [source, target];
    workflow.connections = [{
      id: 'edge-1',
      fromNodeId: source.id,
      fromPortId: 'out-image',
      toNodeId: target.id,
      toPortId: 'in-image',
      type: 'image',
    }];

    const model = projectWorkflowRenderModel(workflow, viewport);

    expect(model.nodes.map(node => node.id)).toEqual(workflow.nodes.map(node => node.id));
    expect(model.edges.map(edge => edge.id)).toEqual(workflow.connections.map(edge => edge.id));
    expect(model.nodes.find(node => node.id === source.id)?.ports).toEqual(source.ports);
    expect(model.viewport).toEqual(viewport);
    expect(workflow.nodes[0]).toBe(source);
  });

  it('projects every declared node type', () => {
    const workflow = createEmptyWorkflow('all node types');
    workflow.nodes = (Object.keys(NODE_TYPE_LABELS) as NodeType[]).map((type, index) => (
      createWorkflowNode(type, index * 24, index * 12)
    ));

    const model = projectWorkflowRenderModel(workflow, viewport);

    expect(model.nodes.map(node => node.type)).toEqual(workflow.nodes.map(node => node.type));
  });

  it('matches the fixed port compatibility matrix for every output/input pair', () => {
    expect(PORT_COMPATIBILITY).toEqual(expectedPortCompatibility);

    for (const output of portTypes) {
      for (const input of portTypes) {
        expect(canConnectPorts(output, input), `${output} -> ${input}`)
          .toBe(expectedPortCompatibility[output].includes(input));
      }
    }
  });

  it('keeps the legacy and React Flow adapters distinct while cloning complete node data and selection', () => {
    const workflow = createEmptyWorkflow('adapter projection');
    const node = createWorkflowNode('condition-if', 40, 64, 'selected condition');
    node.config = { condition: 'approved === true', nested: { threshold: 0.8 } };
    node.condition = 'approved === true';
    node.breakpoint = true;
    workflow.nodes = [node];
    const selection = new Set([node.id]);

    const legacy = projectLegacyRenderModel(workflow, viewport, selection);
    const reactFlow = projectReactFlowRenderModel(workflow, viewport, selection);

    expect(legacy.nodes[0]).toMatchObject({ selected: true, workflowNode: node });
    expect(reactFlow.nodes[0]).toMatchObject({ selected: true, workflowNode: node });
    expect(legacy.nodes[0]?.workflowNode).not.toBe(node);
    expect(reactFlow.nodes[0]?.workflowNode).not.toBe(node);
    expect(legacy.nodes[0]?.workflowNode).not.toBe(reactFlow.nodes[0]?.workflowNode);

    const source = readFileSync(resolve(process.cwd(), 'src/lib/workflow-renderer/view-model.ts'), 'utf8');
    const legacyBody = source.match(/export function projectLegacyRenderModel[\s\S]*?\n}/)?.[0] ?? '';
    const reactFlowBody = source.match(/export function projectReactFlowRenderModel[\s\S]*?\n}/)?.[0] ?? '';
    expect(legacyBody).not.toContain('projectWorkflowRenderModel(');
    expect(reactFlowBody).not.toContain('projectWorkflowRenderModel(');
  });
});
