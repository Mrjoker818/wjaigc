// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VideoCompareDialog from '@/components/video-compare-dialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('video comparison playback', () => {
  it('stops both players at the shorter video and restarts playback from the beginning', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const { container } = render(<VideoCompareDialog open onClose={() => {}}
      videoA={{ url: '/qa-long.mp4' }} videoB={{ url: '/qa-short.mp4' }} />);
    const [first, second] = Array.from(container.querySelectorAll('video'));
    Object.defineProperty(first, 'duration', { value: 6 });
    Object.defineProperty(second, 'duration', { value: 4 });
    fireEvent.loadedMetadata(first);
    fireEvent.loadedMetadata(second);
    expect(screen.getByRole('slider', { name: '对比播放进度' }).getAttribute('max')).toBe('4');

    fireEvent.click(screen.getByRole('button', { name: '播放对比' }));
    first.currentTime = 4;
    second.currentTime = 4;
    fireEvent.ended(second);
    expect(pause).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '播放对比' }));
    expect(first.currentTime).toBe(0);
    expect(second.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(4);
  });

  it('resets playback on a new source and ignores the earlier play rejection', async () => {
    let rejectFirst!: (error: Error) => void;
    vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const dialog = (url: string) => <VideoCompareDialog open onClose={() => {}}
      videoA={{ url: '/synthetic/a.mp4' }} videoB={{ url }} />;
    const view = render(dialog('/synthetic/b.mp4'));
    fireEvent.click(screen.getByRole('button', { name: '播放对比' }));
    const [previousA, previousB] = view.container.querySelectorAll('video');
    view.rerender(dialog('/synthetic/c.mp4'));
    const [currentA, currentB] = view.container.querySelectorAll('video');
    expect(currentA).not.toBe(previousA);
    expect(currentB).not.toBe(previousB);
    expect(screen.getByRole('button', { name: '播放对比' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '播放对比' }));
    const beforeRejection = pause.mock.calls.length;
    fireEvent.ended(previousA);
    await act(async () => rejectFirst(new Error('Earlier media could not play')));
    expect(pause).toHaveBeenCalledTimes(beforeRejection);
    expect(screen.getByRole('button', { name: '暂停对比' })).toBeTruthy();
  });
});
