'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Download, RotateCcw } from 'lucide-react';

interface AudioPlayerProps {
  audioUrl: string;
  duration?: number;
  text?: string;
  onClose?: () => void;
  autoPlay?: boolean;
}

/**
 * 音频播放器组件
 * 支持播放/暂停、音量控制、进度条、下载
 */
export function AudioPlayer({ 
  audioUrl, 
  duration = 0, 
  text = '',
  onClose,
  autoPlay = false 
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载音频
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setTotalDuration(audio.duration || duration);
      setIsLoading(false);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = () => {
      setError('音频加载失败');
      setIsLoading(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    if (autoPlay) {
      audio.play().catch(() => {
        // 自动播放可能被浏览器阻止
      });
    }

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audioUrl, autoPlay, duration]);

  // 播放/暂停
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || error) return;

    try {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        await audio.play();
        setIsPlaying(true);
      }
    } catch (e) {
      setError('播放失败');
    }
  };

  // 音量控制
  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isMuted) {
      audio.volume = volume;
      setIsMuted(false);
    } else {
      audio.volume = 0;
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const newVolume = parseFloat(e.target.value);
    audio.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  // 进度条拖动
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const newTime = parseFloat(e.target.value);
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // 重新播放
  const handleRestart = () => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.currentTime = 0;
    setCurrentTime(0);
    audio.play().then(() => setIsPlaying(true)).catch(() => {});
  };

  // 下载音频
  const handleDownload = async () => {
    try {
      const response = await fetch(audioUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audio-${Date.now()}.mp3`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed:', e);
    }
  };

  // 格式化时间
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // 进度百分比
  const progressPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="bg-[#1a1a1a] rounded-lg p-4 w-full max-w-md border border-border">
      {/* 隐藏的audio元素 */}
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* 文本内容（如果有） */}
      {text && (
        <div className="text-sm text-muted-foreground mb-3 line-clamp-2">
          “{text.slice(0, 100)}”
        </div>
      )}

      {/* 加载状态 */}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="text-center text-destructive py-4">
          {error}
        </div>
      )}

      {/* 播放器UI */}
      {!isLoading && !error && (
        <div className="space-y-4">
          {/* 播放控制 */}
          <div className="flex items-center gap-4">
            {/* 播放/暂停按钮 */}
            <button
              onClick={togglePlay}
              className="flex-shrink-0 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-primary flex items-center justify-center hover:bg-primary/80 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-white" aria-hidden="true" />
              ) : (
                <Play className="w-5 h-5 text-white ml-0.5" aria-hidden="true" />
              )}
            </button>

            {/* 时间显示 */}
            <div className="flex-shrink-0 text-sm text-muted-foreground tabular-nums">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </div>

            {/* 重新播放 */}
            <button
              onClick={handleRestart}
              className="flex-shrink-0 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
              aria-label="重新播放"
            >
              <RotateCcw className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            </button>
          </div>

          {/* 进度条 */}
          <div className="relative h-2 bg-muted rounded-full overflow-hidden">
            {/* 已播放进度 */}
            <div 
              className="absolute left-0 top-0 h-full bg-primary rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
            {/* 进度条拖动 */}
            <input
              type="range"
              min={0}
              max={totalDuration}
              value={currentTime}
              onChange={handleSeek}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="音频进度"
            />
          </div>

          {/* 音量和下载控制 */}
          <div className="flex items-center justify-between">
            {/* 音量控制 */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-muted/50 flex items-center justify-center hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
                aria-label={isMuted ? '取消静音' : '静音'}
              >
                {isMuted ? (
                  <VolumeX className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <Volume2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-20 h-1 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                aria-label="音量"
              />
            </div>

            {/* 下载按钮 */}
            <button
              onClick={handleDownload}
              className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-muted/50 flex items-center justify-center hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
              aria-label="下载音频"
            >
              <Download className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* 关闭按钮（可选） */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-muted flex items-center justify-center hover:bg-destructive transition-colors focus:outline-none focus:ring-2 focus:ring-destructive/50"
          aria-label="关闭播放器"
        >
          <span className="text-sm" aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

export default AudioPlayer;
