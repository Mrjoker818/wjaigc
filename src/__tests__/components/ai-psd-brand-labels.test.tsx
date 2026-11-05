// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AiPsdPanel from '@/components/ai-psd/ai-psd-panel';

describe('PSD brand material form labels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, models: [], providers: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('associates each label with its input and preserves all entered text', () => {
    const { container } = render(<AiPsdPanel onClose={() => {}} onAddImages={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '品牌物料' }));
    for (const [label, value] of [['品牌名称', '测试品牌'], ['品牌 Slogan', '测试广告语'], ['品牌字体', '测试字体']]) {
      const control = screen.getByRole('textbox', { name: label });
      const labelElement = [...container.querySelectorAll('label')].find(item => item.textContent?.trim() === label);
      expect(labelElement?.control).toBe(control);
      fireEvent.click(labelElement!);
      fireEvent.change(control, { target: { value } });
      expect(control).toHaveProperty('value', value);
    }
    const form = within(container);
    expect(form.getByRole('textbox', { name: '品牌名称' })).toHaveProperty('value', '测试品牌');
    expect(form.getByRole('textbox', { name: '品牌 Slogan' })).toHaveProperty('value', '测试广告语');
    expect(form.getByRole('textbox', { name: '品牌字体' })).toHaveProperty('value', '测试字体');
  });
});
