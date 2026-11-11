// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  MobileGenerationGroupHost, ResponsiveGenerationGroupSlot, type MobileGenerationGroupSlots,
} from '@/components/canvas/mobile-generation-groups';

afterEach(cleanup);

function Fixture({ onPopupKey, onDialogKey }: {
  onPopupKey: (event: React.KeyboardEvent) => void;
  onDialogKey: (event: React.KeyboardEvent) => void;
}) {
  const [slots, setSlots] = useState<MobileGenerationGroupSlots | null>(null);
  const register = React.useCallback((_id: string, next: MobileGenerationGroupSlots | null) => setSlots(next), []);
  return <>
    <div role="dialog" aria-label="前景弹窗" onKeyDown={onDialogKey}>
      <button>弹窗控件</button>
    </div>
    <MobileGenerationGroupHost data-toolbar="generation-group" groupIds={['group']} isMonochrome register={register} />
    <ResponsiveGenerationGroupSlot mobile host={slots} slot="toolbar">
      <div data-popup="group-picker" onKeyDown={onPopupKey}>
        <button>模型选项</button>
      </div>
    </ResponsiveGenerationGroupSlot>
    <ResponsiveGenerationGroupSlot mobile host={slots} slot="sources">
      <textarea aria-label="生成描述" defaultValue="保留草稿" />
    </ResponsiveGenerationGroupSlot>
  </>;
}

it('lets foreground and portaled popup controls receive Escape with settings expanded', () => {
  const popupEscape = vi.fn();
  const dialogEscape = vi.fn();
  render(<Fixture onPopupKey={popupEscape} onDialogKey={dialogEscape} />);
  fireEvent.click(screen.getByRole('button', { name: '打开生成组设置' }));
  for (const [name, handler] of [['弹窗控件', dialogEscape], ['模型选项', popupEscape]] as const) {
    const control = screen.getByRole('button', { name });
    control.focus();
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(control);
    expect(screen.getByRole('button', { name: '最小化生成组设置' })).toBeTruthy();
  }
});

it('minimizes from the panel header, restores the opener, and keeps portaled inputs mounted', () => {
  render(<Fixture onPopupKey={() => {}} onDialogKey={() => {}} />);
  const opener = screen.getByRole('button', { name: '打开生成组设置' });
  opener.focus();
  fireEvent.click(opener);
  const draft = screen.getByRole('textbox', { name: '生成描述' });
  fireEvent.change(draft, { target: { value: '当前草稿' } });
  const minimize = screen.getByRole('button', { name: '最小化生成组设置' });
  expect(document.activeElement).toBe(minimize);
  fireEvent.keyDown(minimize, { key: 'Escape' });
  expect(document.activeElement).toBe(opener);
  expect(screen.queryByRole('textbox', { name: '生成描述' })).toBeNull();
  fireEvent.click(opener);
  expect(screen.getByRole('textbox', { name: '生成描述' })).toBe(draft);
  expect(draft).toHaveProperty('value', '当前草稿');
});
