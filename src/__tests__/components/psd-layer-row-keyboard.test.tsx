// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LayerRow } from '@/components/psd-editor/LayerRow';
import type { DesignLayer } from '@/lib/psd-export';

const layer: DesignLayer = {
  id: 'test-layer', name: '合成图层', role: 'subject', visible: true, opacity: 1, blendMode: 'normal',
  maskScore: 0, edgeScore: 0, warnings: [], reconstructMode: 'raster-safe',
};
afterEach(cleanup);

function renderRow() {
  const rename = vi.fn();
  const select = vi.fn();
  const toggleVisibility = vi.fn();
  const toggleLock = vi.fn();
  function Fixture() {
    const [name, setName] = useState(layer.name);
    const [selected, setSelected] = useState(false);
    return <LayerRow layer={{ ...layer, name }} isSelected={selected}
      onSelect={() => { select(); setSelected(true); }}
      onRename={value => { rename(value); setName(value); }}
      onToggleVisibility={toggleVisibility} onToggleLock={toggleLock} />;
  }
  render(<Fixture />);
  return { rename, select, toggleVisibility, toggleLock };
}

it('exposes a focusable selection button and enters rename with F2', () => {
  const { rename, select } = renderRow();
  const selection = screen.getByRole('button', { name: '合成图层' });
  selection.focus();
  expect(document.activeElement).toBe(selection);
  expect(selection.tabIndex).toBe(0);
  fireEvent.click(selection);
  expect(select).toHaveBeenCalledTimes(1);
  expect(selection.getAttribute('aria-pressed')).toBe('true');
  expect(selection.getAttribute('aria-keyshortcuts')).toBe('F2');
  fireEvent.keyDown(selection, { key: 'F2' });
  const editor = screen.getByRole('textbox', { name: '重命名图层' });
  expect(document.activeElement).toBe(editor);
  fireEvent.change(editor, { target: { value: ' 新图层名 ' } });
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(rename).toHaveBeenCalledExactlyOnceWith('新图层名');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '新图层名' }));
});

it('cancels keyboard rename and leaves the independent action buttons usable', () => {
  const { rename, select, toggleVisibility, toggleLock } = renderRow();
  const visibility = screen.getByRole('button', { name: '图层可见性：合成图层' });
  const lock = screen.getByRole('button', { name: '图层锁定：合成图层' });
  fireEvent.keyDown(lock, { key: 'F2' });
  fireEvent.click(visibility);
  fireEvent.click(lock);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(toggleVisibility).toHaveBeenCalledTimes(1);
  expect(toggleLock).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();

  fireEvent.keyDown(screen.getByRole('button', { name: '合成图层' }), { key: 'F2' });
  const editor = screen.getByRole('textbox', { name: '重命名图层' });
  fireEvent.change(editor, { target: { value: '丢弃草稿' } });
  fireEvent.keyDown(editor, { key: 'Escape' });
  expect(rename).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '合成图层' }));
});
