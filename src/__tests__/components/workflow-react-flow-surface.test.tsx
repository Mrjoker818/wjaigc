import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';
import { projectLegacyRenderModel, projectReactFlowRenderModel } from '@/lib/workflow-renderer/view-model';
import {
  createReactFlowEdges,
  createReactFlowNodes,
  createReactFlowCommandHandlers,
  WorkflowReactFlowSurface,
} from '@/components/workflow/WorkflowReactFlowSurface';
import { WorkflowLegacySurface } from '@/components/workflow/WorkflowLegacySurface';
import { WorkflowShadowProbe } from '@/components/workflow/WorkflowShadowProbe';

const legacyRendererSource = readFileSync(resolve(process.cwd(), 'src/components/workflow/WorkflowLegacyNodeCard.tsx'), 'utf8');
const reactFlowSurfaceSource = readFileSync(resolve(process.cwd(), 'src/components/workflow/WorkflowReactFlowSurface.tsx'), 'utf8');
const reactFlowNodeSource = readFileSync(resolve(process.cwd(), 'src/components/workflow/WorkflowNodeCard.tsx'), 'utf8');
const rendererPresentationSource = readFileSync(resolve(process.cwd(), 'src/lib/workflow-renderer/presentation.ts'), 'utf8');
const nodeEditorSource = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');
const canvasWorkspaceSource = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
const rendererSources = [
  'WorkflowLegacyNodeCard.tsx',
  'WorkflowLegacySurface.tsx',
  'WorkflowNodeCard.tsx',
  'WorkflowReactFlowSurface.tsx',
  'WorkflowShadowProbe.tsx',
].map(file => readFileSync(resolve(process.cwd(), `src/components/workflow/${file}`), 'utf8'));

afterEach(() => vi.unstubAllGlobals());

describe('WorkflowReactFlowSurface', () => {
  it('keeps execution logs in the bottom dock instead of covering workflow nodes', () => {
    expect(nodeEditorSource).not.toContain('(showExecLog || execLogs.length > 0)');
    expect(nodeEditorSource).not.toContain('absolute bottom-12 right-3 w-[380px]');
    expect(nodeEditorSource).not.toMatch(/setExecStatus\('running'\);\r?\n\s+setShowExecLog\(true\);/);
    expect(nodeEditorSource).toContain('{showExecLog && (');
    expect(nodeEditorSource).toContain('data-workflow-ui-occlusion');
    expect(nodeEditorSource).not.toContain('absolute bottom-12 left-3');
    expect(nodeEditorSource).toContain('aria-live="polite"');
    expect(nodeEditorSource).toContain('selectedNodeIds.size === 0 && (');
    expect(nodeEditorSource).toContain('pointer-events-none bg-card/90');
  });

  it('keeps the minimap out of the mobile interaction surface', () => {
    expect(nodeEditorSource).toContain('data-workflow-minimap');
    expect(nodeEditorSource).toMatch(/data-workflow-minimap[\s\S]*?className="[^"]*\bhidden\b[^"]*\bmd:block\b"/);
  });

  it('defers ResizeObserver-driven layout writes until the next animation frame', () => {
    expect(legacyRendererSource).toContain('requestAnimationFrame(() => {');
    expect(legacyRendererSource).toContain('cancelAnimationFrame(resizeFrame);');
    expect(nodeEditorSource).toContain('requestAnimationFrame(() => {');
    expect(nodeEditorSource).toContain('cancelAnimationFrame(viewportResizeFrame);');
  });

  it('mounts only the host-authorized visible nodes and their internal edges', () => {
    const workflow = createEmptyWorkflow('virtualized react flow');
    const first = createWorkflowNode('input-text', 0, 0, 'First');
    const second = createWorkflowNode('ai-generate', 240, 0, 'Second');
    const third = createWorkflowNode('output-image', 480, 0, 'Third');
    workflow.nodes = [first, second, third];
    workflow.connections = [
      {
        id: 'first-second', fromNodeId: first.id, fromPortId: 'out-prompt',
        toNodeId: second.id, toPortId: 'in-prompt', type: 'prompt',
      },
      {
        id: 'second-third', fromNodeId: second.id, fromPortId: 'out-image',
        toNodeId: third.id, toPortId: 'in-image', type: 'image',
      },
    ];
    const model = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
    const visibleNodeIds = new Set([first.id, second.id]);

    expect(createReactFlowNodes(model, false, {}, visibleNodeIds).map(node => node.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(createReactFlowEdges(model, {}, 'idle', visibleNodeIds).map(edge => edge.id)).toEqual([
      'first-second',
    ]);
    expect(reactFlowSurfaceSource).toContain('const projectedEdges = useMemo(() => createReactFlowEdges(');
    expect(reactFlowSurfaceSource).toContain('edges={projectedEdges}');
  });

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
    }));

    expect(markup).toContain('data-workflow-legacy-edge-layer');
    expect(markup).toContain('data-workflow-legacy-node-layer');
    expect(markup).toContain(`data-node-id="${workflow.nodes[0].id}"`);
    expect(markup).toContain(`data-port-id="${workflow.nodes[0].id}-out-out-prompt"`);
    expect(markup).toContain('aria-label="折叠节点"');
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('keeps legacy card side effects in the host callbacks rather than the renderer module', () => {
    for (const source of rendererSources) {
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toContain('localStorage');
      expect(source).not.toContain("@/lib/prompt-templates");
    }
    expect(legacyRendererSource).toContain('onImageFileDrop');
    expect(legacyRendererSource).toContain('onSavePromptPreset');
  });

  it('keeps every workflow-engine dependency type-only across renderer modules', () => {
    for (const source of rendererSources) {
      const engineImports = source.match(/import[^;]*from ['"]@\/lib\/workflow-engine['"];/g) ?? [];
      expect(engineImports.every(statement => statement.startsWith('import type'))).toBe(true);
    }
    expect(rendererPresentationSource).not.toMatch(/\bfetch\s*\(|localStorage/);
  });

  it('does not touch storage while rendering a host-supplied prompt template list', () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem, removeItem: vi.fn() });
    const workflow = createEmptyWorkflow('pure renderer');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'Prompt')];
    const props = {
      model: projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }),
      onCommand: vi.fn(),
      promptTemplates: [{
        id: 'plain-template', name: 'Plain', content: 'plain prompt', category: 'test', tags: ['plain'],
      }],
    } as unknown as ComponentProps<typeof WorkflowLegacySurface>;

    renderToStaticMarkup(createElement(WorkflowLegacySurface, props));

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('renders legacy node, port, geometry, and edge DOM only from the legacy projection', () => {
    const workflow = createEmptyWorkflow('projected legacy DOM');
    const source = createWorkflowNode('input-text', 0, 0, 'raw source');
    const target = createWorkflowNode('ai-generate', 240, 0, 'raw target');
    workflow.nodes = [source, target];
    workflow.connections = [{
      id: 'raw-edge', fromNodeId: source.id, fromPortId: 'out-prompt',
      toNodeId: target.id, toPortId: 'in-prompt', type: 'prompt',
    }];
    const model = projectLegacyRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
    model.nodes[0] = {
      ...model.nodes[0]!, label: 'projected source', position: { x: 111, y: 222 },
      size: { width: 333, height: 144 },
      ports: [{ id: 'projected-output', label: 'Projected output', type: 'prompt', direction: 'out' }],
    };
    model.edges[0] = {
      ...model.edges[0]!, id: 'projected-edge',
      source: { nodeId: source.id, portId: 'projected-output' },
    };

    const markup = renderToStaticMarkup(createElement(WorkflowLegacySurface, {
      model,
      onCommand: vi.fn(),
      getPortPosition: (_node, port) => port.direction === 'out' ? { x: 10, y: 20 } : { x: 30, y: 20 },
    }));

    expect(markup).toContain('projected source');
    expect(markup).not.toContain('raw source');
    expect(markup).toContain('left:111px');
    expect(markup).toContain('top:222px');
    expect(markup).toContain('width:333px');
    expect(markup).toContain('min-height:144px');
    expect(markup).toContain(`data-port-id="${source.id}-out-projected-output"`);
    expect(markup).not.toContain(`data-port-id="${source.id}-out-out-prompt"`);
    expect(markup).toContain('data-edge-id="projected-edge"');
    expect(markup).not.toContain('data-edge-id="raw-edge"');
  });

  it('cannot report shadow sync when an omitted legacy projection node is also omitted from actual DOM', () => {
    const workflow = createEmptyWorkflow('legacy omission');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'must be omitted')];
    const shadow = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
    const legacy = { ...projectLegacyRenderModel(workflow, { x: 0, y: 0, zoom: 1 }), nodes: [] };
    const markup = renderToStaticMarkup(createElement('div', null,
      createElement(WorkflowLegacySurface, { model: legacy, onCommand: vi.fn() }),
      createElement(WorkflowShadowProbe, { legacyModel: legacy, shadowModel: shadow }),
    ));

    expect(markup).not.toContain('data-node-id');
    expect(markup).toContain('data-in-sync="false"');
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

  it('translates React Flow group drag, viewport, and connections into controlled host updates', () => {
    const workflow = createEmptyWorkflow('commands');
    const source = createWorkflowNode('input-text', 0, 0, 'Prompt');
    const target = createWorkflowNode('ai-generate', 240, 0, 'Generate');
    workflow.nodes = [source, target];
    const onCommand = vi.fn();
    let hostModel = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }, new Set([source.id, target.id]));
    const handlers = createReactFlowCommandHandlers(
      hostModel,
      onCommand,
      viewport => { hostModel = { ...hostModel, viewport }; },
    );

    handlers.commitNodeDrag([
      { id: source.id, position: { x: 32, y: 12 } },
      { id: target.id, position: { x: 272, y: 12 } },
    ], 'flow-drag');
    handlers.updateViewport({ x: -120, y: 48, zoom: 1.5 });
    handlers.createConnection({
      source: source.id, sourceHandle: 'out-prompt', target: target.id, targetHandle: 'in-prompt',
    }, 'flow-connect');

    expect(onCommand).toHaveBeenNthCalledWith(1, {
      type: 'nodes.drag.commit',
      initialPositions: [
        { nodeId: source.id, position: { x: 0, y: 0 } },
        { nodeId: target.id, position: { x: 240, y: 0 } },
      ],
      positions: [
        { nodeId: source.id, position: { x: 32, y: 12 } },
        { nodeId: target.id, position: { x: 272, y: 12 } },
      ],
      transactionId: 'flow-drag',
    });
    expect(onCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'connection.create', transactionId: 'flow-connect',
      connection: expect.objectContaining({ type: 'prompt', fromPortId: 'out-prompt', toPortId: 'in-prompt' }),
    }));
    expect(hostModel.viewport).toEqual({ x: -120, y: 48, zoom: 1.5 });
    expect(reactFlowSurfaceSource).toContain('onViewportChange=');
  });

  it('uses the full product card and status/control/accessibility contract', () => {
    const workflow = createEmptyWorkflow('product card');
    const node = createWorkflowNode('ai-generate', 0, 0, 'Generate');
    node.execResult = { status: 'running' };
    workflow.nodes = [node];

    const markup = renderToStaticMarkup(createElement(WorkflowReactFlowSurface, {
      model: projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }, new Set([node.id])),
      onCommand: vi.fn(),
      readOnly: false,
    }));

    expect(markup).toContain('data-node-id');
    expect(markup).toContain('node-type-bar');
    expect(markup).toContain('status-badge running');
    expect(markup).toContain('aria-label="折叠节点"');
    expect(markup).toContain('title="运行此节点"');
  });

  it('keeps nodes and ports movable/connectable only on the controlled interactive surface', async () => {
    const workflow = createEmptyWorkflow('conditional interaction');
    workflow.nodes = [createWorkflowNode('input-text', 0, 0, 'Prompt')];
    const model = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
    type ProjectedModel = typeof model;
    const surfaceModule = await import('@/components/workflow/WorkflowReactFlowSurface');
    const createNodes = (surfaceModule as unknown as {
      createReactFlowNodes: (renderModel: ProjectedModel, readOnly: boolean) => Array<{
        draggable?: boolean;
        connectable?: boolean;
        data: { readOnly: boolean };
      }>;
    }).createReactFlowNodes;

    expect(createNodes(model, false)[0]).toMatchObject({
      draggable: true,
      connectable: true,
      data: { readOnly: false },
    });
    expect(createNodes(model, true)[0]).toMatchObject({
      draggable: false,
      connectable: false,
      data: { readOnly: true },
    });
    expect(reactFlowSurfaceSource).toContain("@xyflow/react/dist/style.css");
    expect(reactFlowSurfaceSource).toContain('useNodesState');
    expect(reactFlowSurfaceSource).toContain('onNodesChange={readOnly ? undefined : onFlowNodesChange}');
    expect(reactFlowSurfaceSource).toContain('if (!dragActiveRef.current) setFlowNodes(projectedNodes)');
    expect(reactFlowSurfaceSource).not.toContain('useEdgesState');
  });

  it('preserves projected Ctrl multi-selection without invoking a second legacy selection path', async () => {
    const workflow = createEmptyWorkflow('multiselect');
    const first = createWorkflowNode('input-text', 0, 0, 'first');
    const second = createWorkflowNode('input-text', 240, 0, 'second');
    workflow.nodes = [first, second];
    const model = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }, new Set([first.id]));
    const legacySelect = vi.fn();
    const surfaceModule = await import('@/components/workflow/WorkflowReactFlowSurface');
    const nodes = surfaceModule.createReactFlowNodes(model, false, {
      cardCallbacks: { onSelect: legacySelect } as never,
    });

    nodes[1]!.data.cardProps.onSelect({ ctrlKey: true, metaKey: false } as never);

    expect(surfaceModule.resolveReactFlowSelection(model, second.id, true))
      .toEqual([first.id, second.id]);
    expect(legacySelect).not.toHaveBeenCalled();
  });

  it('uses each visible product port as the single React Flow handle and forwards size measurement', () => {
    const workflow = createEmptyWorkflow('visible handles');
    const node = createWorkflowNode('input-text', 0, 0, 'Prompt');
    workflow.nodes = [node];
    const onUpdateNodeSize = vi.fn();
    const model = projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 });
    const markup = renderToStaticMarkup(createElement(WorkflowReactFlowSurface, {
      model,
      onCommand: vi.fn(),
      readOnly: false,
      cardCallbacks: { onUpdateNodeSize } as never,
    }));
    const portId = `${node.id}-out-out-prompt`;
    const portTag = markup.match(new RegExp(`<[^>]*data-port-id="${portId}"[^>]*>`))?.[0];

    expect(portTag).toContain('react-flow__handle');
    expect(markup.match(new RegExp(`data-port-id="${portId}"`, 'g'))).toHaveLength(1);
    expect(markup.match(/data-port-id=/g)).toHaveLength(node.ports.length);
    expect(reactFlowNodeSource).toContain('renderPortHandle');
    expect(reactFlowNodeSource).not.toContain("style={{ top: `${((index + 1)");

    const flowNode = createReactFlowNodes(model, false, {
      cardCallbacks: { onUpdateNodeSize } as never,
    })[0]!;
    flowNode.data.cardProps.onUpdateNodeSize?.(node.id, 333, 222);
    expect(onUpdateNodeSize).toHaveBeenCalledWith(node.id, 333, 222);
  });

  it('projects custom typed edges instead of React Flow defaults', async () => {
    const workflow = createEmptyWorkflow('custom edge');
    const source = createWorkflowNode('input-text', 0, 0, 'Prompt');
    const target = createWorkflowNode('ai-generate', 240, 0, 'Generate');
    workflow.nodes = [source, target];
    workflow.connections = [{
      id: 'prompt-edge', fromNodeId: source.id, fromPortId: 'out-prompt',
      toNodeId: target.id, toPortId: 'in-prompt', type: 'prompt',
    }];
    const surfaceModule = await import('@/components/workflow/WorkflowReactFlowSurface');
    const createEdges = (surfaceModule as unknown as {
      createReactFlowEdges: (model: ReturnType<typeof projectReactFlowRenderModel>) => Array<{
        type?: string;
        data?: { portType?: string };
      }>;
    }).createReactFlowEdges;

    expect(createEdges(projectReactFlowRenderModel(workflow, { x: 0, y: 0, zoom: 1 }))[0])
      .toMatchObject({ type: 'workflow', data: { portType: 'prompt' } });
    expect(reactFlowNodeSource).toContain('WorkflowLegacyNodeCard');
  });

  it('keeps the workflow-to-chat result action available in both renderers', () => {
    expect(legacyRendererSource).toContain('发送到智能对话');
    expect(legacyRendererSource).toContain('onSendToChat?.(node.id)');
    expect(reactFlowSurfaceSource).toContain('onSendToChat');
  });

  it('keeps the mobile content strip available and persists before workflow-to-chat navigation', () => {
    const mobileLayout = nodeEditorSource.match(/const applyMobileLayout = \(\) => \{[\s\S]*?\n\s*\};/)?.[0] || '';
    expect(mobileLayout).toContain('setShowLeftPanel(false)');
    expect(mobileLayout).not.toContain('setShowContentStrip(false)');
    expect(nodeEditorSource).toContain('onBeforeWorkflowChatNavigation');
    expect(nodeEditorSource).toContain('navigateToWorkflowChatAfterPersistence');
    expect(canvasWorkspaceSource).toContain('onBeforeWorkflowChatNavigation');
    expect(canvasWorkspaceSource).toContain("canvasPersistenceScheduler.flush('immediate')");
  });
});
