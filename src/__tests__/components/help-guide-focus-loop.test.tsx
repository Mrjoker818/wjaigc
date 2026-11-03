// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpGuide } from '@/components/help-guide';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('help guide keyboard focus', () => {
  it('keeps keyboard focus in the modal and makes the guide content focusable', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
    render(<HelpGuide isOpen onClose={() => {}} />);
    const close = screen.getByRole('button', { name: '关闭使用说明' });
    const content = screen.getByRole('region', { name: '使用说明内容' });
    expect(content.tabIndex).toBe(0);
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(content);
    fireEvent.keyDown(content, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });
});
