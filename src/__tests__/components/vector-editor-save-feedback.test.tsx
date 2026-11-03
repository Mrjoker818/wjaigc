// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VectorEditorDialog, type VectorDesignAsset } from '@/components/vector-design/vector-editor-dialog';

const { errorToast } = vi.hoisted(() => ({ errorToast: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: errorToast, info: vi.fn() } }));

const asset: VectorDesignAsset = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#ff0000"/></svg>',
  svgUrl: '', previewUrl: '', width: 100, height: 100, pathCount: 1,
  model: 'synthetic-model', providerId: 'synthetic-provider', providerName: 'synthetic', sourceType: 'synthetic',
};
const networkMessage = '网络连接中断，保存结果未确认';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderEditor(): { onClose: ReturnType<typeof vi.fn>; onSave: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  const onSave = vi.fn();
  function Fixture() {
    const [open, setOpen] = useState(true);
    return open ? <VectorEditorDialog asset={asset} templateIds={[]} onSave={onSave} onClose={() => { onClose(); setOpen(false); }} /> : null;
  }
  render(<Fixture />);
  const shape = document.querySelector('.vector-edit-stage rect');
  if (!shape) throw new Error('synthetic SVG shape missing');
  fireEvent.click(shape);
  fireEvent.click(screen.getByRole('button', { name: '应用颜色' }));
  expect(document.querySelector('.vector-edit-stage rect')?.getAttribute('fill')).toBe('#d4af37');
  return { onClose, onSave };
}

function expectEditedRequest(fetchMock: ReturnType<typeof vi.fn>): void {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('/api/vector-design');
  expect(options.method).toBe('POST');
  const body = JSON.parse(String(options.body)) as { action: string; sourceSvg: string };
  expect(body.action).toBe('edit');
  expect(body.sourceSvg).toContain('#d4af37');
}

describe('vector editor save failure feedback', () => {
  it('reports an unconfirmed result when fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const { onClose, onSave } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '保存到画布' }));
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(networkMessage));
    expectEditedRequest(fetchMock);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('.vector-edit-stage rect')?.getAttribute('fill')).toBe('#d4af37');
  });

  it('keeps the HTTP JSON error from the server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ success: false, error: '合成保存失败，请重试' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { onClose, onSave } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '保存到画布' }));
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('合成保存失败，请重试'));
    expectEditedRequest(fetchMock);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not promise the edit is preserved after closing while save is pending', async () => {
    let rejectRequest!: (error: Error) => void;
    const pending = new Promise<Response>((_resolve, reject) => { rejectRequest = reject; });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal('fetch', fetchMock);
    const { onClose, onSave } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '保存到画布' }));
    expectEditedRequest(fetchMock);
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-modal]')).toBeNull();
    await act(async () => { rejectRequest(new TypeError('Failed to fetch')); });
    expect(errorToast).toHaveBeenCalledTimes(1);
    expect(errorToast).toHaveBeenCalledWith(networkMessage);
    expect(errorToast.mock.calls[0][0]).not.toContain('保留');
    expect(onSave).not.toHaveBeenCalled();
  });
});
