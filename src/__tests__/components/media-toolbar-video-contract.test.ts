import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const canvasSource = readSource('src/components/infinite-canvas.tsx');
const videoToolsSource = readSource('src/app/api/video/tools/route.ts');
const videoEditPanelSource = readSource('src/components/video-edit-panel.tsx');
const serveUploadSource = readSource('src/app/api/serve-upload/[...path]/route.ts');
const videoDownloadSource = readSource('src/app/api/video/download/route.ts');

describe('media toolbar video contracts', () => {
  it('implements every server-side transformation advertised by the video tools', () => {
    expect(videoToolsSource).toContain("action === 'extract-frames'");
    expect(videoToolsSource).toContain("action === 'to-gif'");
    expect(videoToolsSource).toContain("action === 'compress'");
  });

  it('extracts displayable PNG frames without seeking past the video end', () => {
    expect(videoToolsSource).toContain('getSafeFrameTimestamp(timestamp, duration)');
    expect(videoToolsSource).toContain("duration - Math.min(0.1, Math.max(0.01, duration / 10))");
    expect(videoToolsSource).toContain("frame_${token}_${String(index + 1).padStart(3, '0')}.png");
  });

  it('serves runtime video outputs from persistent storage with media MIME types', () => {
    expect(videoToolsSource).toContain("'/api/serve-upload/generated-videos'");
    expect(serveUploadSource).toContain("ext === '.mp4' ? 'video/mp4'");
    expect(serveUploadSource).toContain("ext === '.gif' ? 'image/gif'");
  });

  it('reads same-platform video inputs from disk instead of recursively fetching its own server', () => {
    expect(videoToolsSource).toContain('readLocalVideoBuffer(url)');
    expect(videoToolsSource).toContain("path.join(process.cwd(), 'public')");
  });

  it('downloads same-platform videos from disk without a recursive server fetch', () => {
    expect(videoDownloadSource).toContain('readLocalVideoBuffer(sourceUrl)');
    expect(videoDownloadSource).toContain("path.join(process.cwd(), 'public')");
  });

  it('passes the selected frame limit to both uniform and FPS extraction modes', () => {
    expect(canvasSource).toContain("frameCount: videoExtractFrameCount");
  });

  it('keeps GIF conversion and compression reachable from the video floating toolbar', () => {
    expect(canvasSource).toContain("label: '转 GIF'");
    expect(canvasSource).toContain("label: '视频压缩'");
    expect(canvasSource).toContain("const videoTools = ['视频抽帧', 'AI配音', '转 GIF', '视频压缩', '下载']");
  });

  it('downloads a selected video from its video URL instead of its thumbnail', () => {
    expect(canvasSource).toContain('/api/video/download?url=${encodeURIComponent(image.videoUrl)}');
    expect(canvasSource).toContain("format === 'video'");
    // Actual popup/filename/byte behavior is covered by canvas-video-download.test.tsx.
  });

  it('regenerates an edited video from its thumbnail image, not the video URL', () => {
    expect(videoEditPanelSource).toContain('thumbnailUrl: thumbnailUrl || undefined');
    expect(canvasSource).toContain('imageUrl: params.thumbnailUrl || videoEditTarget.url');
    expect(canvasSource).not.toContain('imageUrl: params.videoUrl');
  });

  it('hides the image toolbar while every local media tool window is open', () => {
    expect(canvasSource).toContain('showRemoveBgPicker || showDisplayDecomposePanel || show3DModal || showVideoExtractPanel || showPsdEditor');
  });

  it('centers the display decomposition panel with the other floating tool windows', () => {
    expect(canvasSource).toContain('data-popup="display-decompose"');
    expect(canvasSource).toContain('fixed inset-0 z-[200] flex items-center justify-center pointer-events-none');
    expect(canvasSource).toContain('pointer-events-auto w-72');
  });
});
