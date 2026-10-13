// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WorkflowLegacyNodeCard,
  type WorkflowLegacyNodeCardProps,
  type WorkflowLegacyPortRenderProps,
} from '@/components/workflow/WorkflowLegacyNodeCard';
import { DEFAULT_WORKFLOW_NODE_THEME } from '@/components/workflow/WorkflowLegacySurface';
import { createWorkflowNode, type NodeType, type WorkflowNode } from '@/lib/workflow-engine';

function cardProps(node: WorkflowNode): WorkflowLegacyNodeCardProps {
  return {
    node, isSelected: true, isHighlighted: false, isHovered: false, isRunning: false,
    theme: DEFAULT_WORKFLOW_NODE_THEME,
    onSelect: vi.fn(), onHover: vi.fn(), onDragStart: vi.fn(),
    onPortMouseDown: vi.fn(), onPortMouseUp: vi.fn(),
    onDelete: vi.fn(), onDeselect: vi.fn(), onPreviewImage: vi.fn(),
  };
}

afterEach(cleanup);

describe('export node visible typed input handles', () => {
  it.each([
    ['canvas', false], ['canvas', true], ['embedded', false], ['embedded', true],
  ] as const)('keeps image and safe document inputs visible in %s, image result %s', (layout, hasImage) => {
    const node = createWorkflowNode('output-export', 0, 0, 'export-node');
    const original = JSON.stringify(node);
    const { container } = render(<WorkflowLegacyNodeCard {...cardProps(node)} layout={layout}
      execResult={hasImage ? { status: 'success', output: { imageUrl: '/fixture.png' } } : undefined} />);

    for (const [title, id] of [['图片', 'in-image'], ['安全代码', 'in-document']]) {
      const handle = screen.getByTitle(title);
      expect(handle.getAttribute('data-port-id')).toBe(`${node.id}-in-${id}`);
      expect(handle.classList.contains('input-port')).toBe(true);
      expect(handle.style.visibility).not.toBe('hidden');
      expect(handle.closest('.node-body')).not.toBeNull();
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(container.querySelectorAll('[data-port-id]')).toHaveLength(2);
    expect(JSON.stringify(node)).toBe(original);
  });

  it.each(['in-image', 'in-document'])('completes the existing native connection callback for %s', id => {
    const node = createWorkflowNode('output-export', 0, 0, 'export-node');
    const props = cardProps(node);
    const port = node.ports.find(candidate => candidate.id === id)!;
    render(<WorkflowLegacyNodeCard {...props} />);
    fireEvent.mouseUp(screen.getByTitle(port.label), { button: 0 });
    expect(props.onPortMouseUp).toHaveBeenCalledTimes(1);
    expect(props.onPortMouseUp).toHaveBeenCalledWith(node.id, port);
    expect(props.onPortMouseDown).not.toHaveBeenCalled();
    expect(props.onDragStart).not.toHaveBeenCalled();
  });

  it.each(['canvas', 'embedded'] as const)('preserves the existing custom handle adapter in %s', layout => {
    const node = createWorkflowNode('output-export', 0, 0, 'export-node');
    const adapter = vi.fn((props: WorkflowLegacyPortRenderProps) => <div
      title={props.title} data-testid={`adapter-${props.port.id}`} data-direction={props.direction} />);
    render(<WorkflowLegacyNodeCard {...cardProps(node)} layout={layout} renderPortHandle={adapter} />);
    expect(adapter).toHaveBeenCalledTimes(2);
    for (const port of node.ports) {
      expect(adapter).toHaveBeenCalledWith(expect.objectContaining({ nodeId: node.id, direction: 'in', port }));
      expect(screen.getByTestId(`adapter-${port.id}`).getAttribute('data-direction')).toBe('in');
    }
  });

  it.each([
    ['input-image', ['out-image']],
    ['output-image', ['in-image']],
    ['ai-sketch-to-code', ['in-image', 'in-prompt', 'out-image', 'out-document']],
  ] as const)('does not change the original %s handles', (type, ids) => {
    const node = createWorkflowNode(type as NodeType, 0, 0, 'control-node');
    const { container } = render(<WorkflowLegacyNodeCard {...cardProps(node)} />);
    expect(Array.from(container.querySelectorAll('[data-port-id]')).map(x => x.getAttribute('data-port-id')))
      .toEqual(ids.map(id => `${node.id}-${node.ports.find(port => port.id === id)!.direction}-${id}`));
  });

  it('keeps the existing collapsed body contract', () => {
    const node = createWorkflowNode('output-export', 0, 0, 'export-node');
    const { container } = render(<WorkflowLegacyNodeCard {...cardProps(node)} collapsedNodes={new Set([node.id])} />);
    expect(container.querySelector('.node-body')).toBeNull();
    expect(container.querySelectorAll('[data-port-id]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '展开节点' })).toBeTruthy();
  });
});
