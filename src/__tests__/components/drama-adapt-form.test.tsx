// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskModelCatalogModel } from '@/hooks/use-task-model-catalog';

const state = vi.hoisted(() => ({
  models: [] as TaskModelCatalogModel[], loading: false, error: null as Error | null,
}));
vi.mock('@/hooks/use-task-model-catalog', () => ({ useTaskModelCatalog: vi.fn(() => state) }));

import { useTaskModelCatalog } from '@/hooks/use-task-model-catalog';
import { DramaAdaptForm } from '@/components/drama/drama-adapt-form';

const models: TaskModelCatalogModel[] = [
  { id: 'chat-1', name: '首模型', providerId: 'p', providerName: '供应商甲', type: 'chat' },
  { id: 'chat-2', name: '非首模型', displayName: '授权编剧', providerId: 'p', providerName: '供应商甲', type: 'chat' },
  { id: 'chat-2', name: '非首模型', displayName: '授权编剧', providerId: 'other', providerName: '供应商乙', type: 'chat' },
];
const text = '小说原文。'.repeat(50);
const fillText = () => fireEvent.change(screen.getByRole('textbox', { name: '原文' }), { target: { value: text } });
const choose = (value = 'p::chat-2') => fireEvent.change(screen.getByRole('combobox', { name: '改编模型' }), { target: { value } });
const start = () => screen.getByRole('button', { name: '开始改编' }) as HTMLButtonElement;

beforeEach(() => { state.models = [...models]; state.loading = false; state.error = null; vi.clearAllMocks(); });
afterEach(cleanup);

describe('explicit authorized adaptation planner', () => {
  it('uses the shared chat catalog and requires a choice instead of silently choosing its first entry', () => {
    const onAdapt = vi.fn();
    render(<DramaAdaptForm busy={null} progress={null} onAdapt={onAdapt} />);
    fillText();
    expect(useTaskModelCatalog).toHaveBeenCalledWith('chat');
    expect(screen.getByRole('option', { name: '授权编剧 · 供应商甲' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '授权编剧 · 供应商乙' })).toBeTruthy();
    expect(start().disabled).toBe(true);
    fireEvent.submit(start().closest('form')!);
    expect(onAdapt).not.toHaveBeenCalled();
  });

  it('submits the exact chosen nonfirst model and provider', () => {
    const onAdapt = vi.fn();
    render(<DramaAdaptForm busy={null} progress={null} onAdapt={onAdapt} />);
    fillText(); choose();
    expect(start().disabled).toBe(false);
    fireEvent.click(start());
    expect(onAdapt).toHaveBeenCalledExactlyOnceWith({ text, style: 'cinematic', aspectRatio: '9:16', episodeDurationSec: 60,
      planner: { providerId: 'p', modelId: 'chat-2' } });
    choose('other::chat-2'); fireEvent.click(start());
    expect(onAdapt.mock.calls[1][0].planner).toEqual({ providerId: 'other', modelId: 'chat-2' });
  });

  it('blocks a revoked choice instead of switching to the first or same-named model on another provider', () => {
    const onAdapt = vi.fn();
    const view = render(<DramaAdaptForm busy={null} progress={null} onAdapt={onAdapt} />);
    fillText(); choose();
    state.models = [models[0], models[2]];
    view.rerender(<DramaAdaptForm busy={null} progress={null} onAdapt={onAdapt} />);
    expect(start().disabled).toBe(true);
    expect(screen.getByRole('combobox', { name: '改编模型' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('原模型已不可用');
    fireEvent.submit(start().closest('form')!);
    expect(onAdapt).not.toHaveBeenCalled();
    choose('other::chat-2'); fireEvent.click(start());
    expect(onAdapt.mock.calls[0][0].planner).toEqual({ providerId: 'other', modelId: 'chat-2' });
  });

  it.each(['loading', 'error', 'empty'])('blocks submission while the authorized catalog is %s', condition => {
    const onAdapt = vi.fn();
    const view = render(<DramaAdaptForm busy={null} progress={null} onAdapt={onAdapt} />);
    fillText(); choose();
    if (condition === 'loading') state.loading = true;
    if (condition === 'error') state.error = new Error('catalog unavailable');
    if (condition === 'empty') state.models = [];
    view.rerender(<DramaAdaptForm busy={null} progress={null} onAdapt={onAdapt} />);
    expect(start().disabled).toBe(true);
    fireEvent.submit(start().closest('form')!);
    expect(onAdapt).not.toHaveBeenCalled();
    if (condition !== 'loading') expect(screen.getByRole('status').textContent).toMatch(/模型|目录/);
  });

  it('keeps model selection locked while an adaptation is running', () => {
    const onAdapt = vi.fn();
    const view = render(<DramaAdaptForm busy={null} progress={null} onAdapt={onAdapt} />);
    fillText(); choose();
    view.rerender(<DramaAdaptForm busy="改编小说" progress={{ value: 25 }} onAdapt={onAdapt} />);
    expect((screen.getByRole('combobox', { name: '改编模型' }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '正在改编 25%' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('button', { name: '正在改编 25%' }).closest('form')!);
    expect(onAdapt).not.toHaveBeenCalled();
  });
});
