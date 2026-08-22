// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CanvasEmptyState } from '@/components/canvas/CanvasEmptyState';

describe('CanvasEmptyState', () => {
  it('提供不阻断画布的上传与说明入口', () => {
    const onUploadClick = vi.fn();
    const onHelpClick = vi.fn();
    const { container } = render(
      <CanvasEmptyState
        isMonochrome={false}
        onUploadClick={onUploadClick}
        onHelpClick={onHelpClick}
      />,
    );

    expect(screen.getByText('无限画布')).toBeTruthy();
    expect(screen.getByText('拖入图片 / 上传图片 / AI 生成图片到画布')).toBeTruthy();
    expect(screen.getByText('左键选择 · 滚轮缩放 · 空格+拖动平移 · 右键菜单')).toBeTruthy();
    expect(screen.getByText(/底部工具栏：图像生成/u)).toBeTruthy();
    expect(container.firstElementChild?.className).toContain('pointer-events-none');
    expect(screen.getByRole('group', { name: '空画布快捷操作' }).className).toContain('pointer-events-auto');

    fireEvent.click(screen.getByRole('button', { name: '上传图片' }));
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));

    expect(onUploadClick).toHaveBeenCalledTimes(1);
    expect(onHelpClick).toHaveBeenCalledTimes(1);
  });

  it('适配暗色与黑白主题且禁用 reduced-motion 过渡', () => {
    const { container, rerender } = render(
      <CanvasEmptyState isMonochrome={false} onUploadClick={vi.fn()} onHelpClick={vi.fn()} />,
    );

    expect(container.querySelector('[data-canvas-empty-state]')?.getAttribute('data-theme')).toBe('dark');
    expect(container.innerHTML).toContain('motion-reduce:transition-none');

    rerender(
      <CanvasEmptyState isMonochrome onUploadClick={vi.fn()} onHelpClick={vi.fn()} />,
    );
    expect(container.querySelector('[data-canvas-empty-state]')?.getAttribute('data-theme')).toBe('mono');
  });
});
