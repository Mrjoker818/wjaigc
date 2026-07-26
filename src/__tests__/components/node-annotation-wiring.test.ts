import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(editorSource).toContain("handleContextAction('annotate')");
    expect(editorSource).toContain('批注修改');
  });

  it('shows guidance for a selection without a concrete owned image', () => {
    expect(editorSource).toContain('setNodeAnnotationError');
    expect(editorSource).toContain('请选择包含单张图片的节点');
    expect(editorSource).toContain('请先将图片保存到项目画布');
  });

  it('requires a concrete choice for image groups', () => {
    expect(editorSource).toContain('nodeAnnotationCandidates');
    expect(editorSource).toContain('选择要批注的图片');
    expect(editorSource).toContain('openNodeAnnotation(sourceNode, candidate)');
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
    expect(editorSource).toContain("node.type === 'ai-annotation-edit'");
    expect(editorSource).toContain('existingBundle');
    expect(editorSource).toContain('<NodeAnnotationWorkspace');
  });

  it('reuses the shared overlay and composer in a focused, dimmed workspace', () => {
    expect(workspaceSource).toContain('<AnnotationOverlay');
    expect(workspaceSource).toContain('<AnnotationComposer');
    expect(workspaceSource).toContain('data-testid="node-annotation-workspace"');
    expect(workspaceSource).toContain('创建修改节点');
  });

  it('filters annotation models by spatial edit capability', () => {
    expect(editorSource).toContain("modelSupports(model.id, 'supportsMask')");
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
