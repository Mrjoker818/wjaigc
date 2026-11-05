'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Columns2, Layers, MoveHorizontal } from 'lucide-react';

type CompareMode = 'side-by-side' | 'overlay' | 'slider';

interface VideoCompareOption {
  id: string;
  url: string;
  label: string;
}

interface VideoCompareDialogProps {
  videoA: { url: string; label?: string };
  videoB: { url: string; label?: string };
  open: boolean;
  onClose: () => void;
  isGold?: boolean;
  videoBOptions?: readonly VideoCompareOption[];
  onSelectVideoB?: (id: string) => void;
}

export default function VideoCompareDialog({
  videoA,
  videoB,
  open,
  onClose,
  isGold = true,
  videoBOptions = [],
  onSelectVideoB,
}: VideoCompareDialogProps) {
  const [mode, setMode] = useState<CompareMode>('side-by-side');
  const [sliderPos, setSliderPos] = useState(50); // 0-100
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const accentColor = isGold ? '#d4af37' : '#3b82f6';
  const bgDark = '#0a0a0a';
  const borderColor = isGold ? 'rgba(212,175,55,0.3)' : 'rgba(59,130,246,0.3)';

  const selectedVideoBId = videoBOptions.find((option: VideoCompareOption): boolean => option.url === videoB.url)?.id || '';
  const handleSelectVideoB = (id: string): void => {
    const option = videoBOptions.find((candidate: VideoCompareOption): boolean => candidate.id === id);
    if (!onSelectVideoB || !option || option.url === videoA.url) return;
    if (videoARef.current) {
      videoARef.current.pause();
      videoARef.current.currentTime = 0;
    }
    if (videoBRef.current) {
      videoBRef.current.pause();
      videoBRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    onSelectVideoB(option.id);
  };

  // Sync playback state between two videos
  const handlePlayPause = useCallback(() => {
    if (!videoARef.current || !videoBRef.current) return;
    if (isPlaying) {
      videoARef.current.pause();
      videoBRef.current.pause();
    } else {
      videoARef.current.play();
      videoBRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleSeek = useCallback((time: number) => {
    if (!videoARef.current || !videoBRef.current) return;
    videoARef.current.currentTime = time;
    videoBRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (videoARef.current) {
      setCurrentTime(videoARef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const nextDuration = videoARef.current?.duration ?? 0;
    setDuration(Number.isFinite(nextDuration) && nextDuration >= 0 ? nextDuration : 0);
  }, []);

  // Slider drag handlers
  const handleSliderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
  }, []);

  const handleContainerMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(percent);
  }, []);

  const handleContainerMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  useEffect(() => {
    const handleGlobalMouseUp = () => { isDragging.current = false; };
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSliderPos(percent);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, []);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const modeButtons: { id: CompareMode; icon: React.ReactNode; label: string }[] = [
    { id: 'side-by-side', icon: <Columns2 className="w-3.5 h-3.5" />, label: '并排' },
    { id: 'overlay', icon: <Layers className="w-3.5 h-3.5" />, label: '叠加' },
    { id: 'slider', icon: <MoveHorizontal className="w-3.5 h-3.5" />, label: '滑动' },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="视频对比"
      data-modal="video-compare"
      className="fixed inset-0 z-[200] flex items-center justify-center p-2"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex min-h-0 w-full max-w-[1200px] max-h-[calc(100dvh-1rem)] flex-col rounded-xl overflow-hidden"
        style={{ background: bgDark, border: `1px solid ${borderColor}` }}
      >
        {/* Header */}
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_44px] items-start gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${borderColor}` }}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm font-medium" style={{ color: accentColor }}>视频对比</span>
            <div className="flex flex-wrap gap-1">
              {modeButtons.map(mb => (
                <button
                  key={mb.id}
                  onClick={() => setMode(mb.id)}
                  aria-pressed={mode === mb.id}
                  className="flex min-h-11 min-w-11 items-center justify-center gap-1 whitespace-nowrap px-2 rounded text-sm transition-colors"
                  style={{
                    background: mode === mb.id ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(59,130,246,0.15)') : 'transparent',
                    color: mode === mb.id ? accentColor : '#9ca3af',
                    border: `1px solid ${mode === mb.id ? borderColor : 'transparent'}`,
                  }}
                >
                  {mb.icon}
                  {mb.label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} aria-label="关闭视频对比" className="flex h-11 w-11 items-center justify-center rounded hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
          <label className="mb-3 flex min-w-0 flex-col gap-2 text-sm text-gray-300">
            <span>视频 B</span>
            <select
              aria-label="从当前画布选择视频 B"
              value={selectedVideoBId}
              disabled={!onSelectVideoB || videoBOptions.length === 0}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>): void => handleSelectVideoB(event.target.value)}
              className="h-11 w-full min-w-0 rounded-lg border px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: bgDark, color: '#f5f5f5', borderColor: accentColor, outlineColor: accentColor }}
            >
              <option value="" disabled>选择画布中的其他视频</option>
              {videoBOptions.map((option: VideoCompareOption): React.ReactElement => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            {videoBOptions.length === 0 && <span className="text-sm text-gray-400">当前画布没有其他可用视频</span>}
          </label>
          {/* Side by side mode */}
          {mode === 'side-by-side' && (
            <div className="flex flex-col gap-3 min-[480px]:flex-row">
              {[
                { ref: videoARef, video: videoA, label: 'A' },
                { ref: videoBRef, video: videoB, label: 'B' },
              ].map(({ ref, video, label }) => (
                <div key={label} className="flex-1 min-w-0">
                  <div className="text-xs mb-1 break-words text-gray-400">
                    {label}: {video.label || '视频'}
                  </div>
                  <div className="relative aspect-video rounded-lg overflow-hidden" style={{ border: `1px solid ${borderColor}` }}>
                    <video
                      ref={ref}
                      src={video.url}
                      playsInline
                      className="w-full h-full object-contain"
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleLoadedMetadata}
                      onClick={handlePlayPause}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Overlay mode */}
          {mode === 'overlay' && (
            <div className="relative aspect-video rounded-lg overflow-hidden mx-auto" style={{ maxWidth: '800px', border: `1px solid ${borderColor}` }}>
              <video
                ref={videoARef}
                src={videoA.url}
                playsInline
                className="w-full h-full object-contain absolute inset-0"
                style={{ opacity: 0.5, zIndex: 1 }}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onClick={handlePlayPause}
              />
              <video
                ref={videoBRef}
                src={videoB.url}
                playsInline
                className="w-full h-full object-contain absolute inset-0"
                style={{ opacity: 0.5, zIndex: 2, mixBlendMode: 'difference' }}
                onClick={handlePlayPause}
              />
              <div className="absolute bottom-2 left-2 z-10 flex gap-2">
                <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: 'rgba(0,0,0,0.7)', color: accentColor }}>
                  A: {videoA.label || '视频1'}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: 'rgba(0,0,0,0.7)', color: '#ef4444' }}>
                  B: {videoB.label || '视频2'}
                </span>
              </div>
            </div>
          )}

          {/* Slider mode */}
          {mode === 'slider' && (
            <div
              ref={containerRef}
              className="relative aspect-video rounded-lg overflow-hidden mx-auto select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white"
              style={{ maxWidth: '800px', border: `1px solid ${borderColor}`, cursor: 'col-resize', containerType: 'inline-size' }}
              onMouseMove={handleContainerMouseMove}
              onMouseUp={handleContainerMouseUp}
              onClick={handlePlayPause}
            >
              {/* Video B (full, behind) */}
              <video
                ref={videoBRef}
                src={videoB.url}
                playsInline
                className="w-full h-full object-contain absolute inset-0"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
              />
              {/* Video A (clipped, front) */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${sliderPos}%` }}
              >
                <video
                  ref={videoARef}
                  src={videoA.url}
                  playsInline
                  className="absolute inset-0 object-contain w-full h-full"
                  style={{ width: '100cqw', maxWidth: 'none' }}
                  onLoadedMetadata={handleLoadedMetadata}
                />
              </div>
              {/* Slider handle */}
              <div
                className="absolute top-0 bottom-0 z-10"
                style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)', width: '3px', background: accentColor, cursor: 'col-resize' }}
                onMouseDown={handleSliderMouseDown}
              >
                <div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center"
                  style={{ background: accentColor, boxShadow: '0 0 10px rgba(0,0,0,0.5)' }}
                >
                  <MoveHorizontal className="w-4 h-4 text-black" />
                </div>
              </div>
              <input
                type="range"
                aria-label="对比边界"
                min={0}
                max={100}
                step={1}
                value={sliderPos}
                onChange={e => setSliderPos(Number(e.target.value))}
                onClick={e => e.stopPropagation()}
                className="absolute inset-x-0 top-1/2 z-20 w-full -translate-y-1/2 cursor-col-resize opacity-0"
                style={{ height: 44, touchAction: 'pan-y' }}
              />
              {/* Labels */}
              <div className="absolute bottom-2 left-2 z-10">
                <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: 'rgba(0,0,0,0.7)', color: accentColor }}>
                  A: {videoA.label || '视频1'}
                </span>
              </div>
              <div className="absolute bottom-2 right-2 z-10">
                <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: 'rgba(0,0,0,0.7)', color: '#9ca3af' }}>
                  B: {videoB.label || '视频2'}
                </span>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex min-w-0 items-center gap-2 mt-3">
            <button
              onClick={handlePlayPause}
              aria-label={isPlaying ? '暂停对比' : '播放对比'}
              className="flex shrink-0 items-center justify-center w-11 h-11 rounded-full transition-colors"
              style={{ background: isGold ? 'rgba(212,175,55,0.15)' : 'rgba(59,130,246,0.15)', color: accentColor }}
            >
              {isPlaying ? (
                <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="4" height="10" fill="currentColor" /><rect x="7" y="1" width="4" height="10" fill="currentColor" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="1,1 11,6 1,11" fill="currentColor" /></svg>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <input
                type="range"
                aria-label="对比播放进度"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={e => handleSeek(parseFloat(e.target.value))}
                className="w-full rounded-full appearance-none cursor-pointer"
                style={{ height: 44, touchAction: 'pan-y', accentColor, background: 'linear-gradient(rgba(255,255,255,0.18),rgba(255,255,255,0.18)) center / 100% 4px no-repeat' }}
              />
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs text-gray-400 tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
