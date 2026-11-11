// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import UserSettingsTab from '@/components/dashboard/user-settings-tab';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected fixture request'); }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openPasswordDialog(onToast = vi.fn()) {
  render(<UserSettingsTab isDark={false} isMonochrome userName="Synthetic user" userRole="user"
    onToggleTheme={() => {}} onToast={onToast} />);
  const opener = screen.getByRole('button', { name: '修改密码' });
  opener.focus();
  fireEvent.click(opener);
  return { opener, onToast };
}

function fillPassword(value: string) {
  fireEvent.change(screen.getByLabelText('新密码', { exact: true }), { target: { value } });
  fireEvent.change(screen.getByLabelText('确认密码', { exact: true }), { target: { value } });
}

it.each(['close button', 'backdrop'] as const)('clears both drafts when dismissed by the %s', method => {
  const { opener } = openPasswordDialog();
  fillPassword('synthetic-fixture-only');
  const card = screen.getByRole('heading', { name: '修改密码' }).parentElement!;
  const dismiss = method === 'close button'
    ? screen.getByRole('button', { name: '关闭修改密码' })
    : card.previousElementSibling!;
  fireEvent.click(dismiss);
  fireEvent.click(opener);
  expect(screen.getByLabelText('新密码', { exact: true })).toHaveProperty('value', '');
  expect(screen.getByLabelText('确认密码', { exact: true })).toHaveProperty('value', '');
  expect(fetch).not.toHaveBeenCalled();
});

it('focuses the first field, contains Tab and restores the opener on Escape', () => {
  const { opener } = openPasswordDialog();
  const dialog = screen.getByRole('dialog', { name: '修改密码' });
  const first = screen.getByLabelText('新密码', { exact: true });
  const last = screen.getByRole('button', { name: '关闭修改密码' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  fillPassword('synthetic-fixture-only');
  fireEvent.keyDown(first, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener);
  expect(screen.getByLabelText('新密码', { exact: true })).toHaveProperty('value', '');
  expect(screen.getByLabelText('确认密码', { exact: true })).toHaveProperty('value', '');
});

it('blocks duplicate confirmation and scopes a late response to the dismissed form', async () => {
  let completeOld!: (response: Response) => void;
  const request = vi.mocked(fetch)
    .mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }))
    .mockResolvedValueOnce(Response.json({ success: true }));
  const { opener, onToast } = openPasswordDialog();
  fillPassword('synthetic-first');
  const confirm = screen.getByRole('button', { name: '确认修改' });
  act(() => {
    fireEvent.click(confirm);
    fireEvent.click(confirm);
  });
  expect(confirm).toHaveProperty('disabled', true);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe('/api/user/change-password');
  const signal = request.mock.calls[0][1]?.signal;

  fireEvent.click(screen.getByRole('button', { name: '关闭修改密码' }));
  expect(signal?.aborted).toBe(true);
  fireEvent.click(opener);
  fillPassword('synthetic-second');
  await act(async () => completeOld(Response.json({ success: true })));
  expect(screen.getByLabelText('新密码', { exact: true })).toHaveProperty('value', 'synthetic-second');
  expect(onToast).not.toHaveBeenCalled();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认修改' })));
  expect(request).toHaveBeenCalledTimes(2);
  expect(onToast).toHaveBeenCalledExactlyOnceWith('密码修改成功', 'success');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
});
