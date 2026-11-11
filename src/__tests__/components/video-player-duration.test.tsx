// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import VideoPlayer from '@/components/video-player';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('enables seeking when the preview opens after metadata is already available', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(1.2);
  const { container } = render(<VideoPlayer videoUrl="/test-video.mp4" />);
  const progress = screen.getByRole('slider', { name: '视频进度' }) as HTMLInputElement;
  const video = container.querySelector('video')!;

  expect(progress.disabled).toBe(false);
  expect(progress.max).toBe('1.2');
  fireEvent.change(progress, { target: { value: '0.7' } });
  expect(video.currentTime).toBe(0.7);
});

it('resets controls for the new video and ignores metadata from the previous element', () => {
  const view = render(<VideoPlayer videoUrl="/synthetic/a.mp4" />);
  const first = view.container.querySelector('video')!;
  Object.defineProperty(first, 'duration', { value: 6 });
  fireEvent.loadedMetadata(first);
  first.currentTime = 4;
  fireEvent.timeUpdate(first);
  fireEvent.play(first);

  view.rerender(<VideoPlayer videoUrl="/synthetic/b.mp4" />);
  const current = view.container.querySelector('video')!;
  const seek = screen.getByRole('slider', { name: '视频进度' }) as HTMLInputElement;
  expect(current).not.toBe(first);
  expect(seek).toHaveProperty('disabled', true);
  expect(seek).toHaveProperty('value', '0');
  expect(screen.getByRole('button', { name: '播放视频' })).toBeTruthy();
  fireEvent.loadedMetadata(first);
  fireEvent.timeUpdate(first);
  expect(seek).toHaveProperty('disabled', true);
  expect(seek).toHaveProperty('value', '0');
  Object.defineProperty(current, 'duration', { value: 2 });
  fireEvent.loadedMetadata(current);
  expect(seek).toHaveProperty('max', '2');
});
