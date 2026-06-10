'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Play, Pause, Volume2, VolumeX, Maximize, Minimize, Download } from 'lucide-react';

interface VideoPlayerProps {
  videoUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  onClose?: () => void;
  /** 是否为弹窗模式（默认true），false 则为内嵌模式 */
  modal?: boolean;
  /** 内嵌模式下的尺寸 */
  width?: number;
  height?: number;
}

/**
 * 视频播放器组件
 * - 弹窗模式：全屏半透明背景 + 居中视频
 * - 内嵌模式：固定尺寸内嵌播放
 * - 黑金配色主题，与项目设计语言一致
 */
export default function VideoPlayer({
  videoUrl,
  thumbnailUrl,
  duration,
  onClose,
  modal = true,
  width = 640,
  height = 360,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 播放/暂停
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  // 静音切换
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  // 全屏切换
  const toggleFullscreen = useCallback(() => {
    const container = videoRef.current?.parentElement;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // 进度条点击跳转
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    video.currentTime = ratio * video.duration;
  }, []);

  // 下载视频
  const handleDownload = useCallback(() => {
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `video_${Date.now()}.mp4`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [videoUrl]);

  // 自动隐藏控制栏
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (isPlaying) {
      hideControlsTimer.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [isPlaying]);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setTotalDuration(video.duration);
    const onEnded = () => { setIsPlaying(false); setShowControls(true); };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('ended', onEnded);
    };
  }, []);

  // ESC 关闭
  useEffect(() => {
    if (!modal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modal, onClose]);

  // 格式化时间 mm:ss
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  // 内嵌模式
  if (!modal) {
    return (
      <div
        className="relative bg-black rounded-lg overflow-hidden group"
        style={{ width, height }}
        onMouseMove={resetHideTimer}
        onMouseLeave={() => !isPlaying && setShowControls(true)}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          poster={thumbnailUrl}
          className="w-full h-full object-contain"
          playsInline
          preload="metadata"
        />
        {/* 播放/暂停大按钮覆盖层 */}
        {!isPlaying && (
          <div
            className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/20"
            onClick={togglePlay}
          >
            <div className="w-14 h-14 rounded-full bg-[#d4af37]/90 flex items-center justify-center shadow-lg">
              <Play className="w-6 h-6 text-black ml-1" fill="black" />
            </div>
          </div>
        )}
        {/* 底部控制栏 */}
        <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 transition-opacity duration-200 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}>
          {/* 进度条 */}
          <div className="w-full h-1 bg-white/20 rounded-full mb-2 cursor-pointer" onClick={handleProgressClick}>
            <div className="h-full bg-[#d4af37] rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={togglePlay} className="text-white/80 hover:text-white cursor-pointer">
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <span className="text-xs text-white/60 tabular-nums">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
            <div className="flex-1" />
            <button onClick={toggleMute} className="text-white/80 hover:text-white cursor-pointer">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 弹窗模式
  return (
    <div
      className="fixed inset-0 z-[500] bg-black/85 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-[#1a1a1a]/80 hover:bg-[#1a1a1a] border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer z-10"
      >
        <X className="w-5 h-5" />
      </button>

      {/* 视频容器 */}
      <div
        className="relative max-w-[90vw] max-h-[85vh] bg-black rounded-xl overflow-hidden shadow-2xl"
        onMouseMove={resetHideTimer}
        onMouseLeave={() => !isPlaying && setShowControls(true)}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          poster={thumbnailUrl}
          className="max-w-[90vw] max-h-[85vh] object-contain"
          playsInline
          preload="metadata"
        />

        {/* 播放/暂停大按钮覆盖层 */}
        {!isPlaying && (
          <div
            className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/20"
            onClick={togglePlay}
          >
            <div className="w-20 h-20 rounded-full bg-[#d4af37]/90 flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
              <Play className="w-8 h-8 text-black ml-1" fill="black" />
            </div>
          </div>
        )}

        {/* 底部控制栏 */}
        <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-8 transition-opacity duration-200 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}>
          {/* 进度条 */}
          <div className="w-full h-1.5 bg-white/20 rounded-full mb-3 cursor-pointer hover:h-2 transition-all group" onClick={handleProgressClick}>
            <div className="h-full bg-[#d4af37] rounded-full transition-all relative" style={{ width: `${progress}%` }}>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-[#d4af37] rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={togglePlay} className="text-white/80 hover:text-white cursor-pointer transition-colors">
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>

            <button onClick={toggleMute} className="text-white/80 hover:text-white cursor-pointer transition-colors">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <span className="text-sm text-white/60 tabular-nums font-mono">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>

            <div className="flex-1" />

            <button onClick={handleDownload} className="text-white/60 hover:text-white cursor-pointer transition-colors" title="下载视频">
              <Download className="w-4 h-4" />
            </button>

            <button onClick={toggleFullscreen} className="text-white/60 hover:text-white cursor-pointer transition-colors" title="全屏">
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
