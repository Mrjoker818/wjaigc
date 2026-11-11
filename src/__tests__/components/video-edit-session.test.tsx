// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VideoEditPanel } from '@/components/video-edit-panel';

afterEach(cleanup);

const actions = [
  { tab: 'edit', field: '编辑描述', button: '应用编辑', method: 'onEdit' },
  { tab: 'extend', field: '延续描述（可选）', button: '延长视频', method: 'onExtend' },
] as const;

it.each(actions)('keeps the $tab draft on failure and dismisses only after acceptance', async ({ tab, field, button, method }) => {
  const close = vi.fn();
  const submit = vi.fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('提交未受理'))
    .mockResolvedValueOnce(undefined);
  render(<VideoEditPanel isOpen videoUrl="/synthetic/a.mp4" initialTab={tab} onClose={close} onEdit={() => {}}
    onExtend={() => {}} {...{ [method]: submit }} />);
  const draft = screen.getByRole('textbox', { name: field });
  fireEvent.change(draft, { target: { value: '保留当前描述' } });
  if (tab === 'extend') fireEvent.click(screen.getByRole('button', { name: '+10秒' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: button })));
  expect(screen.getByRole('alert').textContent).toBe('提交未受理');
  expect(draft).toHaveProperty('value', '保留当前描述');
  if (tab === 'extend') expect(screen.getByRole('button', { name: '+10秒' }).getAttribute('aria-pressed')).toBe('true');
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: button })).toHaveProperty('disabled', false);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: button })));
  expect(submit).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(1);
});

it('ignores a rejected submission after the displayed video changes', async () => {
  let failOld!: (error: Error) => void;
  const oldSubmit = vi.fn(() => new Promise<void>((_resolve, reject) => { failOld = reject; }));
  const close = vi.fn();
  const view = render(<VideoEditPanel isOpen videoUrl="/synthetic/a.mp4" onClose={close} onEdit={oldSubmit} />);
  fireEvent.change(screen.getByRole('textbox', { name: '编辑描述' }), { target: { value: 'A 的描述' } });
  fireEvent.click(screen.getByRole('button', { name: '应用编辑' }));
  view.rerender(<VideoEditPanel isOpen videoUrl="/synthetic/b.mp4" onClose={close} onEdit={() => {}} />);
  const newDraft = screen.getByRole('textbox', { name: '编辑描述' });
  expect(newDraft).toHaveProperty('value', '');
  fireEvent.change(newDraft, { target: { value: 'B 的描述' } });
  await act(async () => failOld(new Error('旧请求失败')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(newDraft).toHaveProperty('value', 'B 的描述');
  expect(screen.getByRole('button', { name: '应用编辑' })).toHaveProperty('disabled', false);
  expect(close).not.toHaveBeenCalled();
});

it('keeps a reopened session for the same video when an earlier submission succeeds', async () => {
  let acceptOld!: () => void;
  let acceptCurrent!: () => void;
  const submit = vi.fn<() => Promise<void>>()
    .mockImplementationOnce(() => new Promise(resolve => { acceptOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { acceptCurrent = resolve; }));
  const close = vi.fn();
  const panel = (isOpen: boolean) => <VideoEditPanel isOpen={isOpen} videoUrl="/synthetic/a.mp4"
    initialTab="extend" onClose={close} onEdit={() => {}} onExtend={submit} />;
  const view = render(panel(true));
  fireEvent.click(screen.getByRole('button', { name: '延长视频' }));
  view.rerender(panel(false));
  view.rerender(panel(true));
  fireEvent.click(screen.getByRole('button', { name: '延长视频' }));
  await act(async () => acceptOld());
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '提交中...' })).toHaveProperty('disabled', true);
  await act(async () => acceptCurrent());
  expect(close).toHaveBeenCalledTimes(1);
});
