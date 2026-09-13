// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  MobileImageActions,
  type MobileImageAction,
} from '@/components/canvas/mobile-image-actions';

function actions(): MobileImageAction[] {
  return [
    { id: 'preview', label: '预览', icon: <span>P</span>, onActivate: vi.fn() },
    { id: 'upscale', label: '放大', icon: <span>U</span>, onActivate: vi.fn() },
    { id: 'download', label: '下载', icon: <span>D</span>, onActivate: vi.fn() },
    { id: 'delete', label: '删除', icon: <span>X</span>, onActivate: vi.fn() },
  ];
}

describe('MobileImageActions', () => {
  it('keeps preview, download, and delete fixed while exposing every action in more', () => {
    const items = actions();
    render(<MobileImageActions actions={items} viewportWidth={320} />);

    expect(screen.getByRole('button', { name: '预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下载' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    for (const action of items) {
      expect(screen.getAllByRole('button', { name: action.label }).length).toBeGreaterThan(0);
    }
  });

  it('runs the original action once, closes the drawer, and returns focus to more', () => {
    const items = actions();
    render(<MobileImageActions actions={items} viewportWidth={320} />);
    const more = screen.getByRole('button', { name: '更多' });

    fireEvent.click(more);
    fireEvent.click(screen.getByRole('dialog', { name: '图片工具' }).querySelector('[data-mobile-image-action="upscale"]')!);

    expect(items[1].onActivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '图片工具' })).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('isolates pointer and wheel events and does not overflow a 320px viewport', () => {
    const onPointerDown = vi.fn();
    const onWheel = vi.fn();
    const { container } = render(
      <div onPointerDown={onPointerDown} onWheel={onWheel}>
        <MobileImageActions actions={actions()} viewportWidth={320} />
      </div>,
    );
    const bar = container.querySelector('[data-mobile-image-actions]');
    expect(bar?.className).toContain('max-w-[calc(100vw-16px)]');
    if (!bar) return;

    fireEvent.pointerDown(bar);
    fireEvent.wheel(bar);
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onWheel).not.toHaveBeenCalled();
  });
});
