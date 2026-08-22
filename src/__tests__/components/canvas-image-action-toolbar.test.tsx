// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  CanvasImageActionToolbar,
  type CanvasImageToolbarAction,
} from '@/components/canvas/CanvasImageActionToolbar';

const actions: CanvasImageToolbarAction[] = Array.from({ length: 7 }, (_, index) => ({
  label: `工具${index + 1}`,
  icon: <span aria-hidden>{index + 1}</span>,
  desc: `工具${index + 1}说明`,
  action: vi.fn(),
}));

function renderToolbar(overrides: Partial<Parameters<typeof CanvasImageActionToolbar>[0]> = {}) {
  const props: Parameters<typeof CanvasImageActionToolbar>[0] = {
    toolbarRef: { current: null },
    position: { left: 180, top: 120, transform: 'translate(-50%, -100%)' },
    isMonochrome: false,
    displayedActions: actions.slice(0, 5),
    overflowActions: actions.slice(5),
    expanded: false,
    onExpandedChange: vi.fn(),
    onBeforeOpenOverlay: vi.fn(),
    onDelete: vi.fn(),
    customizeOpen: false,
    onCustomizeOpenChange: vi.fn(),
    toolbarItemOrder: actions.map((action) => action.label),
    onToolbarItemOrderChange: vi.fn(),
    toolbarHiddenItems: new Set<string>(),
    onToolbarHiddenItemsChange: vi.fn(),
    allActionLabels: actions.map((action) => action.label),
    onResetPreferences: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CanvasImageActionToolbar {...props} />) };
}

describe('CanvasImageActionToolbar', () => {
  it('固定显示前五项并把剩余动作放入有界 +N 弹层', () => {
    const { container, props, rerender } = renderToolbar();

    expect(container.querySelectorAll('[data-image-toolbar-main-action]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-image-toolbar-overflow-action]')).toHaveLength(2);
    expect(container.querySelector('[data-toolbar="image-action-toolbar"]')?.className).toContain('max-w-[calc(100vw-24px)]');
    expect(container.querySelector('[data-toolbar="image-action-toolbar"]')?.className).toContain('motion-reduce:transition-none');
    expect(container.innerHTML).not.toContain('overflow-x-auto');
    expect(container.querySelector('[data-image-toolbar-overflow]')?.className).toContain('max-h-[min(50vh,420px)]');

    fireEvent.click(screen.getByRole('button', { name: '展开更多工具' }));
    expect(props.onBeforeOpenOverlay).toHaveBeenCalledWith('overflow');
    expect(props.onExpandedChange).toHaveBeenCalledWith(true);

    rerender(<CanvasImageActionToolbar {...props} expanded />);
    expect(screen.getByRole('button', { name: '收起更多工具' })).toBeTruthy();
  });

  it('让删除、设置和恢复默认始终可达', () => {
    const { props, rerender } = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '自定义图片工具栏' }));
    expect(props.onBeforeOpenOverlay).toHaveBeenCalledWith('customize');
    expect(props.onCustomizeOpenChange).toHaveBeenCalledWith(true);

    rerender(<CanvasImageActionToolbar {...props} customizeOpen />);
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(props.onResetPreferences).toHaveBeenCalledTimes(1);
  });

  it('隔离 pointer、mouse 与 wheel，避免选图或缩放画布', () => {
    const onPointerDown = vi.fn();
    const onMouseDown = vi.fn();
    const onWheel = vi.fn();
    const { container } = render(
      <div onPointerDown={onPointerDown} onMouseDown={onMouseDown} onWheel={onWheel}>
        <CanvasImageActionToolbar
          {...renderToolbar().props}
        />
      </div>,
    );
    const toolbar = container.querySelector('[data-toolbar="image-action-toolbar"]');
    expect(toolbar).not.toBeNull();
    if (!toolbar) return;

    fireEvent.pointerDown(toolbar);
    fireEvent.mouseDown(toolbar);
    fireEvent.wheel(toolbar);

    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onMouseDown).not.toHaveBeenCalled();
    expect(onWheel).not.toHaveBeenCalled();
  });
});
