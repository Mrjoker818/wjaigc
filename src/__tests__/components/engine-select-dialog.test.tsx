// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EngineSelectDialog } from '@/components/engine-select-dialog';

afterEach(cleanup);

it('shows the current upscale engine and describes only the available routing', () => {
  const onSelect = vi.fn();
  render(<EngineSelectDialog open title="放大引擎选择" toolType="upscale"
    selectedEngine="auto" onClose={vi.fn()} onSelect={onSelect} />);

  const dialog = within(screen.getByRole('dialog', { name: '放大引擎选择' }));
  const automatic = dialog.getByRole('button', { name: /^智能自动/, pressed: true });
  expect(automatic.textContent).toContain('通用AI放大');
  expect(automatic.textContent).not.toContain('本地算法');
  expect(dialog.queryByRole('button', { name: /^本地算法/ })).toBeNull();

  fireEvent.click(dialog.getByRole('button', { name: /^云端 AI/, pressed: false }));
  expect(onSelect).toHaveBeenCalledWith('ai');
});
