// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CanvasCommandPalette,
  filterCanvasCommands,
  shouldToggleCanvasCommandPalette,
  type CanvasCommandItem,
} from '@/components/canvas/CanvasCommandPalette';

const command = (
  id: string,
  label: string,
  action: () => void = vi.fn(),
  extra: Partial<CanvasCommandItem> = {},
): CanvasCommandItem => ({
  id,
  label,
  action,
  ...extra,
});

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('filterCanvasCommands', () => {
  const commands = [
    command('zoom-in', '放大画布', vi.fn(), { hint: 'Zoom in', section: '视图', keywords: 'magnify bigger' }),
    command('clear', '取消选择', vi.fn(), { hint: '清空当前选择', section: '编辑', keywords: 'deselect clear selection' }),
  ];

  it('returns all commands for a blank query without changing their order', () => {
    expect(filterCanvasCommands(commands, '   ')).toEqual(commands);
  });

  it.each([
    ['放大', 'zoom-in'],
    ['ZOOM', 'zoom-in'],
    ['视图', 'zoom-in'],
    ['deselect', 'clear'],
    ['当前选择', 'clear'],
  ])('searches label, hint, section and bilingual keywords: %s', (query, expectedId) => {
    expect(filterCanvasCommands(commands, query).map(item => item.id)).toEqual([expectedId]);
  });

  it('returns an empty list when no command matches', () => {
    expect(filterCanvasCommands(commands, 'no-such-command')).toEqual([]);
  });
});

describe('shouldToggleCanvasCommandPalette', () => {
  it('accepts Ctrl/Cmd+K on the canvas but protects editing and overlay targets', () => {
    const canvasTarget = document.createElement('div');
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    const overlay = document.createElement('div');
    overlay.dataset.popup = 'true';
    const overlayButton = document.createElement('button');
    overlay.appendChild(overlayButton);

    expect(shouldToggleCanvasCommandPalette({ code: 'KeyK', ctrlKey: true, metaKey: false, target: canvasTarget })).toBe(true);
    expect(shouldToggleCanvasCommandPalette({ code: 'KeyK', ctrlKey: false, metaKey: true, target: canvasTarget })).toBe(true);
    expect(shouldToggleCanvasCommandPalette({ code: 'KeyK', ctrlKey: false, metaKey: false, target: canvasTarget })).toBe(false);
    expect(shouldToggleCanvasCommandPalette({ code: 'KeyK', ctrlKey: true, metaKey: false, target: input })).toBe(false);
    expect(shouldToggleCanvasCommandPalette({ code: 'KeyK', ctrlKey: true, metaKey: false, target: textarea })).toBe(false);
    expect(shouldToggleCanvasCommandPalette({ code: 'KeyK', ctrlKey: true, metaKey: false, target: editable })).toBe(false);
    expect(shouldToggleCanvasCommandPalette({ code: 'KeyK', ctrlKey: true, metaKey: false, target: overlayButton })).toBe(false);
  });
});

describe('CanvasCommandPalette', () => {
  it('focuses search and executes the keyboard-selected command after closing', async () => {
    const order: string[] = [];
    const commands = [
      command('first', '第一项', () => order.push('first')),
      command('second', '第二项', () => order.push('second')),
    ];

    render(
      <CanvasCommandPalette
        commands={commands}
        onClose={() => order.push('close')}
      />,
    );

    const search = screen.getByRole('searchbox', { name: '搜索画布命令' });
    await waitFor(() => expect(document.activeElement).toBe(search));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    expect(order).toEqual(['close', 'second']);
  });

  it('wraps upward to the last command and keeps selection visible', () => {
    const lastAction = vi.fn();
    render(
      <CanvasCommandPalette
        commands={[
          command('first', '第一项'),
          command('last', '最后一项', lastAction),
        ]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    expect(lastAction).toHaveBeenCalledTimes(1);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it.each([
    { key: 'Escape' },
    { key: 'k', ctrlKey: true },
    { key: 'K', metaKey: true },
  ])('closes from the keyboard without executing a command: $key', keyboard => {
    const action = vi.fn();
    const onClose = vi.fn();
    render(<CanvasCommandPalette commands={[command('one', '命令', action)]} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole('dialog'), keyboard);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });

  it('filters from the search input and exposes an explicit empty result', () => {
    render(
      <CanvasCommandPalette
        commands={[command('zoom', '放大画布', vi.fn(), { keywords: 'zoom' })]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索画布命令' }), {
      target: { value: '不存在' },
    });

    expect(screen.getByText('没有匹配的命令')).toBeTruthy();
  });

  it('executes mouse selection and only closes when the backdrop itself is pressed', () => {
    const action = vi.fn();
    const onClose = vi.fn();
    render(<CanvasCommandPalette commands={[command('zoom', '放大画布', action)]} onClose={onClose} />);

    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId('canvas-command-palette-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /放大画布/ }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
