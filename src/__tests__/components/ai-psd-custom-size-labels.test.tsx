// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AiPsdPanel from '@/components/ai-psd/ai-psd-panel';

describe('PSD custom dimensions', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('associates width and height labels with independent editable number inputs', () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, models: [], providers: [] })));
    const { container } = render(<AiPsdPanel onClose={() => {}} onAddImages={() => {}} />);
    const aspectSection = screen.getByText('画幅比例').parentElement;
    expect(aspectSection).not.toBeNull();
    fireEvent.click(within(aspectSection!).getByRole('button', { name: '自定义' }));
    const labels = [...container.querySelectorAll('label')];
    const width = labels.find(label => label.textContent?.trim() === '宽度(px)');
    const height = labels.find(label => label.textContent?.trim() === '高度(px)');
    expect(width?.control).toBe(screen.getByRole('spinbutton', { name: '宽度(px)' }));
    expect(height?.control).toBe(screen.getByRole('spinbutton', { name: '高度(px)' }));
    expect(width?.control).not.toBe(height?.control);
    fireEvent.change(width!.control!, { target: { value: '1500' } });
    fireEvent.change(height!.control!, { target: { value: '900' } });
    expect(width?.control).toHaveProperty('value', '1500');
    expect(height?.control).toHaveProperty('value', '900');
  });
});
