// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MobileBottomToolbar } from '@/components/canvas/mobile-bottom-toolbar';
import type { CanvasToolbarAction } from '@/lib/mobile-canvas-toolbar';

function actions(): CanvasToolbarAction[] {
  return [
    { id: 'select', label: '选择', group: '基础', icon: <span>S</span>, onActivate: vi.fn() },
    { id: 'pan', label: '平移', group: '基础', icon: <span>P</span>, onActivate: vi.fn() },
    { id: 'upload', label: '上传', group: '基础', icon: <span>U</span>, onActivate: vi.fn() },
    { id: 'generate', label: '图像生成', group: 'AI 创作', icon: <span>G</span>, onActivate: vi.fn() },
    { id: 'annotation', label: '批注', group: '画布工具', icon: <span>A</span>, onActivate: vi.fn() },
  ];
}

describe('MobileBottomToolbar', () => {
  it('runs the original action once and keeps all actions reachable in the drawer', () => {
    const items = actions();
    render(<MobileBottomToolbar actions={items} zoomLabel="100%" />);

    fireEvent.click(screen.getByRole('button', { name: '全部工具' }));
    fireEvent.click(screen.getByRole('button', { name: '图像生成' }));

    expect(items.find(item => item.id === 'generate')?.onActivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '全部工具' })).toBeNull();
  });

  it('isolates pointer and wheel events from the canvas surface', () => {
    const onPointerDown = vi.fn();
    const onWheel = vi.fn();
    const { container } = render(
      <div onPointerDown={onPointerDown} onWheel={onWheel}>
        <MobileBottomToolbar actions={actions()} zoomLabel="75%" />
      </div>,
    );

    const toolbar = container.querySelector('[data-mobile-canvas-toolbar]');
    expect(toolbar).not.toBeNull();
    if (!toolbar) return;
    fireEvent.pointerDown(toolbar);
    fireEvent.wheel(toolbar);

    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onWheel).not.toHaveBeenCalled();
  });

  it('uses stable five-column geometry and at least 40px touch targets', () => {
    const { container } = render(<MobileBottomToolbar actions={actions()} zoomLabel="125%" />);
    const toolbar = container.querySelector('[data-mobile-canvas-toolbar]');
    expect(toolbar?.className).toContain('grid-cols-5');
    expect(toolbar?.querySelectorAll('[data-mobile-toolbar-primary]')).toHaveLength(5);
    for (const button of toolbar?.querySelectorAll('button') ?? []) {
      expect(button.className).toContain('min-h-10');
      expect(button.className).toContain('min-w-10');
    }
  });
});
