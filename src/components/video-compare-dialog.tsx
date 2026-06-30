'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Columns2, Layers, MoveHorizontal } from 'lucide-react';

type CompareMode = 'side-by-side' | 'overlay' | 'slider';

interface VideoCompareDialogProps {
  videoA: { url: string; label?: string };
  videoB: { url: string; label?: string };
  open: boolean;
  onClose: () => void;
  isGold?: boolean;
}

export default function VideoCompareDialog({
  videoA,
  videoB,
  open,
  onClose,
  isGold = true,
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
    if (videoARef.current) {
      setDuration(videoARef.current.duration);
    }
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
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-[90vw] max-w-[1200px] max-h-[85vh] rounded-xl overflow-hidden"
        style={{ background: bgDark, border: `1px solid ${borderColor}` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${borderColor}` }}>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium" style={{ color: accentColor }}>视频对比</span>
            <div className="flex gap-1">
              {modeButtons.map(mb => (
                <button
                  key={mb.id}
                  onClick={() => setMode(mb.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all"
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
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Side by side mode */}
          {mode === 'side-by-side' && (
            <div className="flex gap-3">
              {[
                { ref: videoARef, video: videoA, label: 'A' },
                { ref: videoBRef, video: videoB, label: 'B' },
              ].map(({ ref, video, label }) => (
                <div key={label} className="flex-1 min-w-0">
                  <div className="text-[10px] mb-1 text-gray-500">
                    {label}: {video.label || '视频'}
                  </div>
                  <div className="relative aspect-video rounded-lg overflow-hidden" style={{ border: `1px solid ${borderColor}` }}>
                    <video
                      ref={ref}
                      src={video.url}
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
                className="w-full h-full object-contain absolute inset-0"
                style={{ opacity: 0.5, zIndex: 1 }}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onClick={handlePlayPause}
              />
              <video
                ref={videoBRef}
                src={videoB.url}
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
              className="relative aspect-video rounded-lg overflow-hidden mx-auto select-none"
              style={{ maxWidth: '800px', border: `1px solid ${borderColor}`, cursor: 'col-resize' }}
              onMouseMove={handleContainerMouseMove}
              onMouseUp={handleContainerMouseUp}
              onClick={handlePlayPause}
            >
              {/* Video B (full, behind) */}
              <video
                ref={videoBRef}
                src={videoB.url}
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
                  className="absolute inset-0 object-contain w-full h-full"
                />
              </div>
              {/* Slider handle */}
              <div
                className="absolute top-0 bottom-0 z-10"
                style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)', width: '3px', background: accentColor, cursor: 'col-resize' }}
                onMouseDown={handleSliderMouseDown}
              >
                <div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: accentColor, boxShadow: '0 0 10px rgba(0,0,0,0.5)' }}
                >
                  <MoveHorizontal className="w-4 h-4 text-black" />
                </div>
              </div>
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
          <div className="flex items-center gap-3 mt-3 px-2">
            <button
              onClick={handlePlayPause}
              className="flex items-center justify-center w-8 h-8 rounded-full transition-colors"
              style={{ background: isGold ? 'rgba(212,175,55,0.15)' : 'rgba(59,130,246,0.15)', color: accentColor }}
            >
              {isPlaying ? (
                <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="4" height="10" fill="currentColor" /><rect x="7" y="1" width="4" height="10" fill="currentColor" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="1,1 11,6 1,11" fill="currentColor" /></svg>
              )}
            </button>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={e => handleSeek(parseFloat(e.target.value))}
                className="w-full h-1 rounded-full appearance-none cursor-pointer"
                style={{ accentColor, background: 'rgba(255,255,255,0.1)' }}
              />
            </div>
            <span className="text-[10px] text-gray-500 tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
