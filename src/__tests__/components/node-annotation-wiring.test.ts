import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BoxSelect, Clipboard, Copy, CopyPlus, MessageSquare, Plus, Trash2, Unlink } from 'lucide-react';
import { parseUiSource, openingNodes, literalAttr, readUiAttr, variableInitializer, callbackInitializer, evaluateUi, uniqueNode } from '../helpers/ui-source-contracts';

import { resolveNodeAnnotationModelId } from '@/features/annotations/node-annotation-workspace';

function readSource(path: string): string {
  const absolutePath = resolve(process.cwd(), path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

const editorSource = readSource('src/components/node-editor.tsx');
const workspaceSource = readSource(
  'src/features/annotations/node-annotation-workspace.tsx',
);

describe('node-mode annotation wiring', () => {
  it('makes saved canvas images draggable into the node graph', () => {
    expect(editorSource).toContain('data-node-canvas-image={img.id}');
    expect(editorSource).toContain('draggable');
    expect(editorSource).toContain(
      "event.dataTransfer.setData('text/uri-list', img.url)",
    );
    expect(editorSource).toContain(
      "event.dataTransfer.setData('text/plain', img.url)",
    );
  });

  it('exposes the shared bottom entry, C shortcut, and image-node context action', () => {
    expect(editorSource).toContain('data-toolbar="node-annotation-entry"');
    expect(editorSource).toContain("event.code === 'KeyC'");
    const actual = parseUiSource(editorSource);
    const menu = parseUiSource(readSource('src/components/workflow/WorkflowContextMenu.tsx'));
    const nodes = [{ id: 'other' }, { id: 'chosen' }];
    const requestNodeAnnotation = vi.fn(), closeContextMenu = vi.fn();
    const contextMenu = { type: 'node', nodeId: 'chosen', x: 0, y: 0, scope: 'scope-a' };
    const extraNodeActions = [{ action: 'run-chain', label: '运行此链', icon: Copy }];
    const handler = evaluateUi(actual, callbackInitializer(actual, 'handleContextAction'), {
      contextMenu, wf: { nodes }, wfRef: { current: { nodes } },
      legacyPointerScopeRef: { current: 'scope-a' }, requestNodeAnnotation, closeContextMenu,
    });
    const host = uniqueNode(openingNodes(actual).filter(node =>
      node.tagName.getText(actual.file) === 'WorkflowContextMenu'), 'MENU_HOST');
    const onAction = readUiAttr(actual, host, 'onAction', { handleContextAction: handler });
    const hostExtraNodeActions = readUiAttr(actual, host, 'extraNodeActions', { extraNodeActions });
    expect(hostExtraNodeActions).toBe(extraNodeActions);
    const actions = evaluateUi(menu, variableInitializer(menu, 'actions'), {
      menu: contextMenu, hasClipboard: false, BoxSelect, Clipboard, Copy, CopyPlus,
      MessageSquare, Plus, Trash2, Unlink, extraNodeActions: hostExtraNodeActions,
    }) as Array<{ action: string; label: string }>;
    const action = uniqueNode(actions.filter(item => item.action === 'annotate'), 'ANNOTATE_ACTION');
    expect(action.label).toBe('批注修改');
    expect(actions.filter(item => item.action === 'run-chain')).toEqual(extraNodeActions);
    const item = uniqueNode(openingNodes(menu).filter(node => literalAttr(node, 'role') === 'menuitem'), 'MENU_ITEM');
    (readUiAttr(menu, item, 'onClick', { onAction, action: action.action }) as () => void)();
    expect(requestNodeAnnotation).toHaveBeenCalledExactlyOnceWith(nodes[1]);
    expect(closeContextMenu).toHaveBeenCalledTimes(1);
    expect(nodes).toEqual([{ id: 'other' }, { id: 'chosen' }]);
    expect(editorSource).toContain('批注修改');
  });

  it('routes the extra chain action to the selected node without starting annotation', () => {
    const actual = parseUiSource(editorSource);
    const nodes = [{ id: 'other' }, { id: 'chosen' }];
    const contextMenu = { type: 'node', nodeId: 'chosen', x: 0, y: 0, scope: 'scope-a' };
    const requestNodeAnnotation = vi.fn(), closeContextMenu = vi.fn(), handleCascadeRun = vi.fn();
    const handler = evaluateUi(actual, callbackInitializer(actual, 'handleContextAction'), {
      contextMenu, wf: { nodes }, wfRef: { current: { nodes } },
      legacyPointerScopeRef: { current: 'scope-a' }, requestNodeAnnotation, closeContextMenu, handleCascadeRun,
    }) as (action: string) => void;
    handler('run-chain');
    expect(handleCascadeRun).toHaveBeenCalledExactlyOnceWith('chosen');
    expect(requestNodeAnnotation).not.toHaveBeenCalled();
    expect(closeContextMenu).toHaveBeenCalledTimes(1);
    expect(nodes).toEqual([{ id: 'other' }, { id: 'chosen' }]);
  });

  it('annotates the current node when the workflow ref is newer than the rendered snapshot', () => {
    const actual = parseUiSource(editorSource);
    const stale = { id: 'chosen', config: { imageUrl: '/old.png' } };
    const current = { id: 'chosen', config: { imageUrl: '/new.png' } };
    const contextMenu = { type: 'node', nodeId: 'chosen', x: 0, y: 0, scope: 'scope-a' };
    const requestNodeAnnotation = vi.fn(), closeContextMenu = vi.fn();
    const handler = evaluateUi(actual, callbackInitializer(actual, 'handleContextAction'), {
      contextMenu, wf: { nodes: [stale] }, wfRef: { current: { nodes: [current] } },
      legacyPointerScopeRef: { current: 'scope-a' }, requestNodeAnnotation, closeContextMenu,
    }) as (action: string) => void;
    handler('annotate');
    expect(requestNodeAnnotation).toHaveBeenCalledExactlyOnceWith(current);
    expect(closeContextMenu).toHaveBeenCalledTimes(1);
  });

  it('resolves annotation candidates from the current graph', () => {
    const actual = parseUiSource(editorSource);
    const stale = { nodes: [{ id: 'old' }], connections: [{ id: 'old-edge' }] };
    const current = { nodes: [{ id: 'new' }], connections: [{ id: 'new-edge' }] };
    const collectNodeAnnotationCandidates = vi.fn().mockReturnValue([]);
    const getCandidates = evaluateUi(actual, callbackInitializer(actual, 'getNodeAnnotationCandidates'), {
      wf: stale, wfRef: { current }, execResults: {}, canvasImages: [], collectNodeAnnotationCandidates,
    }) as (node: { id: string }) => unknown;
    getCandidates(current.nodes[0]);
    expect(collectNodeAnnotationCandidates).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      node: current.nodes[0], nodes: current.nodes, connections: current.connections,
    }));
  });

  it('uses the current selected node for every annotation entry', () => {
    const actual = parseUiSource(editorSource);
    const stale = { id: 'chosen', type: 'input-image', config: { imageUrl: '/old.png' } };
    const current = { id: 'chosen', type: 'input-image', config: { imageUrl: '/new.png' } };
    const getNodeAnnotationCandidates = vi.fn().mockReturnValue([]);
    const setNodeAnnotationError = vi.fn();
    const currentGraph = { nodes: [current] };
    const request = evaluateUi(actual, callbackInitializer(actual, 'requestNodeAnnotation'), {
      wfRef: { current: currentGraph }, getNodeAnnotationCandidates, setNodeAnnotationError,
    }) as (node: typeof stale | null) => void;
    request(stale);
    expect(getNodeAnnotationCandidates).toHaveBeenCalledExactlyOnceWith(current, null);
    currentGraph.nodes = [];
    request(stale);
    expect(getNodeAnnotationCandidates).toHaveBeenCalledTimes(1);
    expect(setNodeAnnotationError).toHaveBeenCalledWith('请选择包含单张图片的节点');
  });

  it('checks the current source port before opening annotation', () => {
    const actual = parseUiSource(editorSource);
    const sourceNode = { id: 'source', label: '图', type: 'input-image' };
    const port = { id: 'port', direction: 'out', type: 'image' };
    const candidate = { sourceNodeId: 'source', sourcePortId: 'port', sourceImageId: 'image', sourceVersionId: 'v1', url: '/image.png' };
    const setNodeAnnotationSession = vi.fn(), setNodeAnnotationError = vi.fn(), setNodeAnnotationCandidates = vi.fn();
    const current = { nodes: [{ ...sourceNode, ports: [] as typeof port[] }] };
    const open = evaluateUi(actual, callbackInitializer(actual, 'openNodeAnnotation'), {
      projectId: 'project', canvasImages: [{ id: 'image', url: '/image.png', versionId: 'v1' }],
      wf: { nodes: [{ ...sourceNode, ports: [port] }] }, wfRef: { current },
      setNodeAnnotationSession, setNodeAnnotationError, setNodeAnnotationCandidates,
    }) as (node: typeof sourceNode, value: typeof candidate) => void;
    open(sourceNode, candidate);
    expect(setNodeAnnotationSession).not.toHaveBeenCalled();
    expect(setNodeAnnotationError).toHaveBeenCalledWith('请选择包含单张图片的节点');
    current.nodes[0].ports = [port];
    open(sourceNode, candidate);
    expect(setNodeAnnotationSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      anchorNodeId: 'source', connectionPortId: 'port',
      source: expect.objectContaining({ sourceImageId: 'image', sourceVersionId: 'v1' }),
    }));
  });

  it('refuses a missing node or stale menu scope without annotating another node', () => {
    const actual = parseUiSource(editorSource);
    const nodes = [{ id: 'other' }, { id: 'chosen' }];
    for (const contextMenu of [
      { type: 'node', nodeId: 'missing', x: 0, y: 0, scope: 'scope-a' },
      { type: 'node', nodeId: 'chosen', x: 0, y: 0, scope: 'old-scope' },
    ]) {
      const requestNodeAnnotation = vi.fn(), closeContextMenu = vi.fn();
      const handler = evaluateUi(actual, callbackInitializer(actual, 'handleContextAction'), {
        contextMenu, wf: { nodes }, wfRef: { current: { nodes } },
        legacyPointerScopeRef: { current: 'scope-a' }, requestNodeAnnotation, closeContextMenu,
      }) as (action: string) => void;
      handler('annotate');
      expect(requestNodeAnnotation).not.toHaveBeenCalled();
      expect(closeContextMenu).toHaveBeenCalledTimes(1);
      expect(nodes).toEqual([{ id: 'other' }, { id: 'chosen' }]);
    }
  });

  it('shows guidance for a selection without a concrete owned image', () => {
    expect(editorSource).toContain('setNodeAnnotationError');
    expect(editorSource).toContain('请选择包含单张图片的节点');
    expect(editorSource).toContain('请先将图片保存到项目画布');
  });

  it('requires a concrete choice for image groups', () => {
    expect(editorSource).toContain('nodeAnnotationCandidates');
    expect(editorSource).toContain('选择要批注的图片');
    expect(editorSource).toContain('nodeAnnotationCandidates.existingBundle');
    expect(editorSource).toContain('nodeAnnotationCandidates.existingBundle,');
    expect(editorSource).toContain('openNodeAnnotation(sourceNode, candidate);');
    expect(editorSource).toContain('candidate.sourceNodeId');
    expect(editorSource).toContain('candidate.sourcePortId');
  });

  it('creates one downstream annotation node and one image connection on submit', () => {
    expect(workspaceSource).toContain('onCreateNode');
    expect(editorSource).toContain("createWorkflowNode('ai-annotation-edit'");
    expect(editorSource).toContain("createConnection(");
    expect(editorSource).toContain("annotationBundle: bundle");
    expect(editorSource).toContain('nodes: [...prev.nodes, annotationNode]');
    expect(editorSource).toContain('connections: [...prev.connections, connection]');
  });

  it('reopens an existing annotation bundle on node double click', () => {
    expect(editorSource).toContain('onDoubleClickAnnotation');
    expect(editorSource).toContain("node?.type === 'ai-annotation-edit'");
    expect(editorSource).toContain('existingBundle');
    expect(editorSource).toContain('<NodeAnnotationWorkspace');
  });

  it('reuses the shared overlay and composer in a focused, dimmed workspace', () => {
    expect(workspaceSource).toContain('<AnnotationOverlay');
    expect(workspaceSource).toContain('<AnnotationComposer');
    expect(workspaceSource).toContain('data-testid="node-annotation-workspace"');
    expect(workspaceSource).toContain('创建修改节点');
  });

  it('keeps the displayed source image out of native drag and pointer handling', () => {
    expect(workspaceSource).toContain('draggable={false}');
    expect(workspaceSource).toContain('pointer-events-none');
    expect(workspaceSource).toContain('select-none');
  });

  it('preserves an existing model before considering preferred and fallback models', () => {
    const models = [
      { id: 'provider-a::model-a', label: 'Model A' },
      { id: 'provider-b::model-b', label: 'Model B' },
    ];

    expect(resolveNodeAnnotationModelId({
      models,
      currentId: 'provider-b::model-b',
      preferredId: 'provider-a::model-a',
      bundleId: '',
    })).toBe('provider-b::model-b');
    expect(resolveNodeAnnotationModelId({
      models,
      currentId: '',
      preferredId: 'provider-b::model-b',
      bundleId: '',
    })).toBe('provider-b::model-b');
    expect(resolveNodeAnnotationModelId({
      models,
      currentId: '',
      preferredId: 'missing::model',
      bundleId: '',
    })).toBe('provider-a::model-a');
  });

  it('gives an existing annotation bundle model highest priority', () => {
    expect(resolveNodeAnnotationModelId({
      models: [
        { id: 'provider-a::model-a', label: 'Model A' },
        { id: 'provider-b::model-b', label: 'Model B' },
      ],
      currentId: 'provider-a::model-a',
      preferredId: 'provider-a::model-a',
      bundleId: 'provider-b::model-b',
    })).toBe('provider-b::model-b');
  });

  it('filters annotation models by spatial edit capability', () => {
    expect(editorSource).toContain("modelCatalogIndex.get(taskModelKey(model.providerId || '', model.id))?.supportsMask");
  });

  it('passes the current canvas model into the node annotation workspace', () => {
    expect(editorSource).toContain('preferredAnnotationModelId');
    expect(editorSource).toContain('preferredModelId={preferredAnnotationModelId}');
  });

  it('renders the structured annotation bundle as read-only JSON', () => {
    expect(editorSource).toContain('field.readOnly');
    expect(editorSource).toContain('JSON.stringify(externalValue, null, 2)');
  });

  it('closes the image candidate picker with C or Escape', () => {
    expect(editorSource).toContain('if (nodeAnnotationCandidates)');
    expect(editorSource).toContain("event.key === 'Escape'");
    expect(editorSource).toContain('setNodeAnnotationCandidates(null)');
  });
});
