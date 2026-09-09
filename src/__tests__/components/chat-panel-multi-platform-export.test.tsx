// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatPanel } from '@/components/chat-panel';
import { createMultiPlatformExportSkill } from '@/lib/skill-runtime/multi-platform-export-preset';

beforeEach(() => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.startsWith('/api/skills?')) return Response.json({ skills: [createMultiPlatformExportSkill(true)] });
    if (url === '/api/platform-export-presets') return Response.json({ success: true, presets: [] });
    if (url.startsWith('/api/user-data/sync')) return Response.json({ value: null });
    return Response.json({});
  }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('canvas ChatPanel multi-platform export integration', () => {
  it('opens the real bottom drawer after the user selects the export Skill', async () => {
    render(<ChatPanel themeStyle="gold" projectId="project-1" canvasImages={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skills技能库' }));
    const skillName = await screen.findByText('多平台批量导出');
    fireEvent.click(skillName.closest('[class*="cursor-pointer"]')!);

    expect(await screen.findByRole('heading', { name: '多平台批量导出' })).not.toBeNull();
    expect(screen.getByTestId('multi-platform-export-drawer').hasAttribute('data-bottom-toolbar-drawer')).toBe(true);
  });

  it('keeps the real drawer single-column and vertically scrollable at 375px', async () => {
    render(<ChatPanel themeStyle="gold" projectId="project-1" canvasImages={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills技能库' }));
    const skillName = await screen.findByText('多平台批量导出');
    fireEvent.click(skillName.closest('[class*="cursor-pointer"]')!);

    const drawer = await screen.findByTestId('multi-platform-export-drawer');
    expect(drawer.className).toContain('w-[min(960px,calc(100vw-16px))]');
    const content = drawer.querySelector(':scope > div');
    await waitFor(() => expect(content?.className).toContain('overflow-y-auto'));
    const responsiveGrid = content?.querySelector('.grid.grid-cols-1');
    expect(responsiveGrid?.className).toContain('md:grid-cols-2');
    expect(responsiveGrid?.className).toContain('xl:grid-cols-3');
    expect([...responsiveGrid!.children].every(section => section.className.includes('min-w-0'))).toBe(true);
    expect(drawer.className).not.toMatch(/(?:^|\s)min-w-\[/);
  });
});
