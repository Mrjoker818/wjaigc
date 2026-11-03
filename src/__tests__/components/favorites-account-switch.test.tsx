// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FavoritesPanel } from '@/components/favorites-panel';
import { installJsdomMediaQueries } from '../helpers/jsdom-browser-apis';

it('ignores an older account response after switching to a new account', async () => {
  const values = new Map<string, string>();
  const storage: Storage = { get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, String(value)); } };
  vi.stubGlobal('localStorage', storage);
  const restore = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false });
  let resolveA!: (response: Response) => void;
  const slow = new Promise<Response>(resolve => { resolveA = resolve; });
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input); requests.push(url);
    if (url === '/api/favorites?userId=synthetic-a&page=1&limit=20') return slow;
    if (url === '/api/favorites?userId=synthetic-b&page=1&limit=20') return Promise.resolve(Response.json({
      success: true, favorites: [{ id: 2, user_id: 'synthetic-b', image_url: 'data:,b', prompt: '乙账号收藏' }], pagination: { totalPages: 1 },
    }));
    throw new Error('UNEXPECTED_REQUEST');
  }));
  try {
    const panel = render(<FavoritesPanel userId="synthetic-a" onClose={() => undefined} />);
    await waitFor(() => expect(requests).toContain('/api/favorites?userId=synthetic-a&page=1&limit=20'));
    panel.rerender(<FavoritesPanel userId="synthetic-b" onClose={() => undefined} />);
    await screen.findByText('乙账号收藏');
    await act(async () => {
      resolveA(Response.json({ success: true, favorites: [{ id: 1, user_id: 'synthetic-a', image_url: 'data:,a', prompt: '甲账号迟到收藏' }], pagination: { totalPages: 1 } }));
      await slow;
    });
    expect(screen.queryByText('甲账号迟到收藏')).toBeNull();
    expect(screen.getByText('乙账号收藏')).toBeTruthy();
    expect(values.get('wujie-favorites-local')).not.toContain('甲账号迟到收藏');
  } finally { cleanup(); vi.unstubAllGlobals(); restore(); }
});
it('hides the previous account immediately while the next account is loading', async () => {
  const restore = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false });
  let resolveB!: (response: Response) => void;
  const slow = new Promise<Response>(resolve => { resolveB = resolve; });
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('userId=synthetic-a')) return Promise.resolve(Response.json({
      success: true, favorites: [{ id: 1, user_id: 'synthetic-a', image_url: 'data:,a', prompt: '甲账号已有收藏' }], pagination: { totalPages: 1 },
    }));
    if (url.includes('userId=synthetic-b')) return slow;
    throw new Error('UNEXPECTED_REQUEST');
  }));
  try {
    const panel = render(<FavoritesPanel userId="synthetic-a" onClose={() => undefined} />);
    await screen.findByText('甲账号已有收藏');
    panel.rerender(<FavoritesPanel userId="synthetic-b" onClose={() => undefined} />);
    expect(screen.queryByText('甲账号已有收藏')).toBeNull();
    await act(async () => {
      resolveB(Response.json({ success: true, favorites: [{ id: 2, user_id: 'synthetic-b', image_url: 'data:,b', prompt: '乙账号收藏' }], pagination: { totalPages: 1 } }));
      await slow;
    });
    expect(screen.getByText('乙账号收藏')).toBeTruthy();
  } finally { cleanup(); vi.unstubAllGlobals(); restore(); }
});
it('keeps the newest page when an older page response arrives late', async () => {
  const restore = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false });
  let resolvePage2!: (response: Response) => void;
  const slow = new Promise<Response>(resolve => { resolvePage2 = resolve; });
  const reply = (id: number, prompt: string): Response => Response.json({
    success: true, favorites: [{ id, user_id: 'synthetic-page', image_url: `data:,${id}`, prompt }], pagination: { totalPages: 3 },
  });
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('page=1')) return Promise.resolve(reply(1, '第一页'));
    if (url.includes('page=2')) return slow;
    if (url.includes('page=3')) return Promise.resolve(reply(3, '第三页'));
    throw new Error('UNEXPECTED_REQUEST');
  }));
  try {
    render(<FavoritesPanel userId="synthetic-page" onClose={() => undefined} />);
    await screen.findByText('第一页');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText('2 / 3')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText('第三页');
    await act(async () => { resolvePage2(reply(2, '迟到的第二页')); await slow; });
    expect(screen.queryByText('迟到的第二页')).toBeNull();
    expect(screen.getByText('第三页')).toBeTruthy();
  } finally { cleanup(); vi.unstubAllGlobals(); restore(); }
});
afterEach(() => vi.restoreAllMocks());
