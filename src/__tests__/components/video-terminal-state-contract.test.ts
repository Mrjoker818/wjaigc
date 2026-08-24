import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('video terminal state contract', () => {
  it('keeps failed video placeholders instead of deleting them from the canvas', () => {
    const handlerStart = workspaceSource.indexOf('const handleVideoGenerate = useCallback');
    const handlerEnd = workspaceSource.indexOf('const handleAnalyzeImage', handlerStart);
    const handlerSource = workspaceSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('const markVideoPlaceholderFailed');
    expect((handlerSource.match(/markVideoPlaceholderFailed\(/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(handlerSource).not.toContain('setImages(prev => prev.filter(img => img.id !== phId))');
  });

  it('stores a retry payload when it creates a video processing placeholder', () => {
    const handlerStart = workspaceSource.indexOf('const handleVideoGenerate = useCallback');
    const handlerEnd = workspaceSource.indexOf('const handleAnalyzeImage', handlerStart);
    const handlerSource = workspaceSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('retryPayload: createVideoRetryPayload(params)');
  });

  it('renders terminal failures with retry and remove actions instead of progress controls', () => {
    expect(canvasSource).toContain('isTerminalProcessingFailure(image.processing)');
    expect(canvasSource).toContain('onRetryProcessing?.(image)');
    expect(canvasSource).toContain('重新生成');
    expect(canvasSource).toContain('移除');
  });

  it('uses the completed-video media normalizer and never treats the video URL as a poster', () => {
    const handlerStart = workspaceSource.indexOf('const handleVideoGenerate = useCallback');
    const handlerEnd = workspaceSource.indexOf('const handleAnalyzeImage', handlerStart);
    const handlerSource = workspaceSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('buildCompletedVideoCanvasMedia');
    expect(handlerSource).not.toContain('const rawThumbnailUrl = pollData.thumbnailUrl || pollData.url');
  });

  it('normalizes resumed completed videos with their provider thumbnail', () => {
    const resumedStart = workspaceSource.indexOf('const pending = images.filter');
    const resumedSource = workspaceSource.slice(resumedStart, resumedStart + 8_000);

    expect(resumedSource).toContain('data.videoThumbnailUrl');
    expect(resumedSource).toContain('buildCompletedVideoCanvasMedia');
  });

  it('renders video posters and keeps posterless completed videos visibly playable', () => {
    expect(canvasSource).toContain("mediaRenderDecision === 'video'");
    const previewStart = canvasSource.indexOf("mediaRenderDecision === 'video' && image.videoUrl");
    const previewSource = canvasSource.slice(previewStart, previewStart + 700);
    expect(previewStart).toBeGreaterThan(-1);
    expect(previewSource).toContain('<video');
    expect(previewSource).toContain('data-canvas-video-preview');
    expect(previewSource).toContain('preload="metadata"');
    expect(canvasSource).toContain('group/play bg-black');
  });

  it('clears a failed optional poster so rendering falls through to the video preview', () => {
    expect(canvasSource).toContain("action === 'fallback-video'");
    expect(canvasSource).toContain('clearFailedCanvasVideoPoster(candidate)');
  });
});
