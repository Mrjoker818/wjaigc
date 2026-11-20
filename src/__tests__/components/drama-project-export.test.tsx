// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDramaProject } from '@/lib/drama/types';

const mock = vi.hoisted(() => ({ project: vi.fn(), episode: vi.fn(), download: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mock.success, error: mock.error } }));
vi.mock('@/lib/drama/export-client', () => ({ buildProjectPackage: mock.project, buildEpisodePackage: mock.episode, downloadBlob: mock.download, downloadText: vi.fn(), exportFileName: vi.fn() }));
vi.mock('@/components/drama/drama-context', async importOriginal => ({ ...await importOriginal<typeof import('@/components/drama/drama-context')>(), useDrama: () => ({ doc, episode: doc.episodes[0] }) }));
import { ExportPanel } from '@/components/drama/drama-final-step';

const doc = createEmptyDramaProject();
doc.episodes = [{ id: 'e1', index: 0, title: '第一集', script: '原稿', logline: '', scenes: [] }];
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('production archive controls', () => {
  it('keeps the episode default and sends the explicit project history choice', async () => {
    mock.project.mockResolvedValue({ blob: new Blob(['zip']), fileName: 'all.zip', missing: [], complete: true });
    mock.episode.mockResolvedValue({ blob: new Blob(['zip']), fileName: 'episode.zip', missing: [] });
    render(<ExportPanel />);
    const scope = screen.getByRole('combobox', { name: '制作包范围' }) as HTMLSelectElement;
    expect(scope.value).toBe('episode');
    fireEvent.click(screen.getByRole('button', { name: '制作包 ZIP' }));
    await waitFor(() => expect(mock.episode).toHaveBeenCalledOnce());
    fireEvent.change(scope, { target: { value: 'project' } });
    fireEvent.change(screen.getByRole('combobox', { name: '素材模式' }), { target: { value: 'history' } });
    fireEvent.click(screen.getByRole('button', { name: '制作包 ZIP' }));
    await waitFor(() => expect(mock.project).toHaveBeenCalledWith(doc, expect.objectContaining({ mediaMode: 'history' })));
    expect(mock.download).toHaveBeenLastCalledWith(expect.any(Blob), 'all.zip');
  });

  it('announces incomplete downloads as incomplete and locks options during packing', async () => {
    let finish!: (value: unknown) => void;
    mock.project.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ExportPanel />);
    fireEvent.change(screen.getByLabelText('制作包范围'), { target: { value: 'project' } });
    fireEvent.click(screen.getByRole('button', { name: '制作包 ZIP' }));
    expect((screen.getByLabelText('制作包范围') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('素材模式') as HTMLSelectElement).disabled).toBe(true);
    finish({ blob: new Blob(['partial']), fileName: 'partial.zip', missing: ['missing.png'], complete: false });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('不完整'));
    expect(mock.success).not.toHaveBeenCalled();
    expect(mock.error).toHaveBeenCalled();
  });
});
