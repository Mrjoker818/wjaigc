// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filmInputSnapshot, shotInputSnapshot, voiceoverInputSnapshot } from '@/lib/drama/production-version';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/drama/drama-autopilot', () => ({ DramaAutopilot: () => null }));
vi.mock('@/components/drama/drama-readiness', () => ({ EpisodeReadiness: () => null }));
vi.mock('@/components/drama/drama-context', () => ({ useDrama: () => context }));
import { DramaFinalStep } from '@/components/drama/drama-final-step';

let doc: DramaProjectV1;
const generateVoiceovers = vi.fn();
const renderEpisode = vi.fn();
let context: Record<string, unknown>;
const currentShot = () => doc.episodes[0].scenes[0].shots[0];
beforeEach(() => {
  doc = createEmptyDramaProject();
  doc.cast = [{ id: 'speaker', name: '角色', appearance: '', voice: 'alloy' }];
  const shot: DramaShot = { id: 's', index: 0, title: '', purpose: '', actionBeat: '', prompt: '原画面', duration: 5, durationSec: 5,
    aspectRatio: '9:16', references: [], continuityNotes: [], status: 'completed', takes: [{ id: 'take', status: 'completed', videoUrl: '/take.mp4', createdAt: 1 }],
    characterIds: ['speaker'], dialogue: '同一句台词', voiceoverText: '同一句台词', voiceoverUrl: '/voice.mp3' };
  doc.episodes = [{ id: 'e', index: 0, title: '', logline: '', script: '', scenes: [{ id: 'sc', heading: '', summary: '', shots: [shot] }] }];
  shot.takes[0].inputSnapshot = shotInputSnapshot(doc, 'e', 's');
  shot.voiceoverSnapshot = voiceoverInputSnapshot(doc, shot);
  doc.timeline.lastRender = { taskId: 'r', status: 'completed', episodeId: 'e', videoUrl: '/film.mp4', createdAt: 1, inputSnapshot: filmInputSnapshot(doc, 'e') };
  context = { doc, episode: doc.episodes[0], update: vi.fn(), render: { status: 'idle' }, renderEpisode, voiceoverShotIds: new Set(), generateVoiceovers, voiceAvailable: true };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('final production input currency', () => {
  it('keeps obsolete films available for preview and download with an explicit rerender notice', () => {
    const { rerender } = render(<DramaFinalStep />);
    expect(screen.getByRole('heading', { name: '成片' })).toBeTruthy();
    doc.timeline.subtitles = false;
    rerender(<DramaFinalStep />);
    expect(screen.getByText('旧版成片，参数已修改，请重渲染')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '成片' })).toBeNull();
    expect(screen.getByRole('link', { name: /下载/ }).getAttribute('href')).toBe('/film.mp4');
    expect(document.querySelector('video')?.getAttribute('src')).toBe('/film.mp4');
  });

  it('does not render obsolete selected takes as ready footage', () => {
    currentShot().prompt = '新画面';
    render(<DramaFinalStep />);
    const button = screen.getByRole('button', { name: /渲染成片/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(renderEpisode).not.toHaveBeenCalled();
    expect(screen.getByText(/还有 1 个镜头/)).toBeTruthy();
  });

  it('requires a new voiceover after voice input changes even if the spoken text is unchanged', () => {
    doc.cast[0].voice = 'nova';
    render(<DramaFinalStep />);
    expect(screen.getByText(/已配音 0\/1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '为 1 句台词生成配音' }));
    expect(generateVoiceovers).toHaveBeenCalledWith(['s']);
  });

  it('retains the pure helper legacy behavior for films and voices without snapshots', () => {
    delete doc.timeline.lastRender!.inputSnapshot;
    delete currentShot().voiceoverSnapshot;
    render(<DramaFinalStep />);
    expect(screen.getByRole('heading', { name: '成片' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '台词都已配音' })).toBeTruthy();
    expect(screen.getByText(/已配音 1\/1/)).toBeTruthy();
  });
});
