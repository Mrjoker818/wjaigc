'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw, Download, Sparkles, X, Film, Clock, Wand2, Loader2 } from 'lucide-react';

interface VideoEditPanelProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 视频 URL */
  videoUrl: string;
  /** 视频缩略图 URL */
  thumbnailUrl?: string;
  /** 原始提示词 */
  originalPrompt?: string;
  /** 主题风格 */
  themeStyle?: 'gold' | 'monochrome';
  /** 关闭回调 */
  onClose: () => void;
  /** 编辑提交回调 */
  onEdit: (params: {
    videoUrl: string;
    prompt: string;
    duration?: number;
    model?: string;
    providerId?: string;
  }) => void;
  /** 延长提交回调 */
  onExtend?: (params: {
    videoUrl: string;
    prompt?: string;
    duration?: number;
    model?: string;
    providerId?: string;
  }) => void;
  /** 当前选中的视频模型 */
  selectedVideoModel?: string;
  /** 当前选中的视频提供商ID */
  selectedVideoProviderId?: string;
}

export function VideoEditPanel({
  isOpen,
  videoUrl,
  thumbnailUrl,
  originalPrompt = '',
  themeStyle = 'gold',
  onClose,
  onEdit,
  onExtend,
  selectedVideoModel,
  selectedVideoProviderId,
}: VideoEditPanelProps) {
  const [editPrompt, setEditPrompt] = useState('');
  const [extendPrompt, setExtendPrompt] = useState('');
  const [activeTab, setActiveTab] = useState<'edit' | 'extend'>('edit');
  const [extendDuration, setExtendDuration] = useState(5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isDark = themeStyle === 'gold';

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setEditPrompt('');
      setExtendPrompt('');
      setActiveTab('edit');
      setIsPlaying(false);
      setIsSubmitting(false);
      setSubmitError(null);
    }
  }, [isOpen]);

  // 同步 video 元素真实状态（防止外部控制/快捷键导致状态不一致）
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isOpen) return;
    const syncPlay = () => setIsPlaying(!v.paused);
    const syncMute = () => setIsMuted(v.muted);
    v.addEventListener('play', syncPlay);
    v.addEventListener('pause', syncPlay);
    v.addEventListener('ended', syncPlay);
    v.addEventListener('volumechange', syncMute);
    return () => {
      v.removeEventListener('play', syncPlay);
      v.removeEventListener('pause', syncPlay);
      v.removeEventListener('ended', syncPlay);
      v.removeEventListener('volumechange', syncMute);
    };
  }, [isOpen, videoUrl]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  };

  const handleSubmitEdit = async () => {
    if (!editPrompt.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onEdit({
        videoUrl,
        prompt: editPrompt.trim(),
        model: selectedVideoModel,
        providerId: selectedVideoProviderId,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitExtend = async () => {
    if (!onExtend || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onExtend({
        videoUrl,
        prompt: extendPrompt.trim() || undefined,
        duration: extendDuration,
        model: selectedVideoModel,
        providerId: selectedVideoProviderId,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 z-[250] flex items-center justify-center ${isDark ? 'bg-black/70' : 'bg-black/50'}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`relative w-[560px] max-h-[85vh] overflow-y-auto rounded-2xl shadow-2xl ${isDark ? 'bg-[#1a1a1a] border border-[#2a2a2a]' : 'bg-white border border-gray-200'}`}>

        {/* 头部 */}
        <div className={`flex items-center justify-between px-5 py-3 border-b ${isDark ? 'border-[#2a2a2a]' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <Film className={`w-5 h-5 ${isDark ? 'text-[#d4af37]' : 'text-blue-500'}`} />
            <h2 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>视频编辑</h2>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 视频预览 */}
        <div className="px-5 pt-4">
          <div className={`relative rounded-xl overflow-hidden ${isDark ? 'bg-[#0d0d0d]' : 'bg-gray-100'}`} style={{ aspectRatio: '16/9' }}>
            <video
              ref={videoRef}
              src={videoUrl}
              poster={thumbnailUrl}
              className="w-full h-full object-contain"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
            />
            {/* 播放控制 */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 flex items-center gap-3">
              <button onClick={togglePlay} className="text-white hover:text-[#d4af37] transition-colors">
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <button onClick={toggleMute} className="text-white hover:text-[#d4af37] transition-colors">
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <div className="flex-1" />
              <button
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = 0;
                }}
                className="text-white hover:text-[#d4af37] transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Tab 切换 */}
        <div className={`flex mx-5 mt-4 rounded-lg overflow-hidden ${isDark ? 'bg-[#0d0d0d]' : 'bg-gray-100'}`}>
          <button
            onClick={() => setActiveTab('edit')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all ${
              activeTab === 'edit'
                ? isDark ? 'bg-[#2a2a2a] text-[#d4af37]' : 'bg-white text-blue-600 shadow-sm'
                : isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            语言编辑
          </button>
          <button
            onClick={() => setActiveTab('extend')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all ${
              activeTab === 'extend'
                ? isDark ? 'bg-[#2a2a2a] text-[#d4af37]' : 'bg-white text-blue-600 shadow-sm'
                : isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            视频延长
          </button>
        </div>

        {/* 编辑 Tab */}
        {activeTab === 'edit' && (
          <div className="px-5 pt-4 pb-5 space-y-3">
            <div>
              <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                编辑描述
              </label>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="描述你想要对视频做的修改，例如：将背景改为海滩日落、添加飘落的雪花..."
                rows={3}
                className={`w-full rounded-lg px-3 py-2.5 text-sm resize-none transition-all ${isDark ? 'bg-[#0d0d0d] border border-[#2a2a2a] text-white placeholder:text-gray-600 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30' : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:ring-1 focus:ring-blue-200'}`}
              />
            </div>

            {originalPrompt && (
              <div className={`text-xs px-3 py-2 rounded-lg ${isDark ? 'bg-[#0d0d0d] text-gray-500' : 'bg-gray-50 text-gray-400'}`}>
                原始描述：{originalPrompt}
              </div>
            )}

            {submitError && (
              <div className="text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
                {submitError}
              </div>
            )}

            <button
              onClick={handleSubmitEdit}
              disabled={!editPrompt.trim() || isSubmitting}
              className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                editPrompt.trim() && !isSubmitting
                  ? isDark ? 'bg-gradient-to-r from-[#d4af37] to-[#b8941f] text-black hover:from-[#e5c249] hover:to-[#d4af37] shadow-md hover:shadow-lg active:shadow-sm'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-md hover:shadow-lg active:shadow-sm'
                  : isDark ? 'bg-[#2a2a2a] text-gray-600 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isSubmitting ? '提交中...' : '应用编辑'}
            </button>
          </div>
        )}

        {/* 延长 Tab */}
        {activeTab === 'extend' && (
          <div className="px-5 pt-4 pb-5 space-y-3">
            <div>
              <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                延续描述（可选）
              </label>
              <textarea
                value={extendPrompt}
                onChange={(e) => setExtendPrompt(e.target.value)}
                placeholder="描述视频后续画面发展，留空则自动延续当前画面风格..."
                rows={2}
                className={`w-full rounded-lg px-3 py-2.5 text-sm resize-none transition-all ${isDark ? 'bg-[#0d0d0d] border border-[#2a2a2a] text-white placeholder:text-gray-600 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30' : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:ring-1 focus:ring-blue-200'}`}
              />
            </div>

            <div>
              <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                延长时长
              </label>
              <div className="flex gap-2">
                {[5, 10].map((d) => (
                  <button
                    key={d}
                    onClick={() => setExtendDuration(d)}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                      extendDuration === d
                        ? isDark ? 'bg-[#2a2a2a] text-[#d4af37] border border-[#d4af37]/30' : 'bg-blue-50 text-blue-600 border border-blue-200'
                        : isDark ? 'bg-[#0d0d0d] text-gray-500 border border-[#2a2a2a] hover:text-gray-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:text-gray-700'
                    }`}
                  >
                    +{d}秒
                  </button>
                ))}
              </div>
            </div>

            {onExtend && (
              <>
                {submitError && (
                  <div className="text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
                    {submitError}
                  </div>
                )}
                <button
                  onClick={handleSubmitExtend}
                  disabled={isSubmitting}
                  className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                    !isSubmitting
                      ? isDark ? 'bg-gradient-to-r from-[#d4af37] to-[#b8941f] text-black hover:from-[#e5c249] hover:to-[#d4af37] shadow-md hover:shadow-lg active:shadow-sm'
                        : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-md hover:shadow-lg active:shadow-sm'
                      : isDark ? 'bg-[#2a2a2a] text-gray-600 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                  {isSubmitting ? '提交中...' : '延长视频'}
                </button>
              </>
            )}
          </div>
        )}

        {/* 底部提示 */}
        <div className={`px-5 pb-4 text-center`}>
          <span className={`text-[10px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
            ESC 退出 · 视频编辑基于AI模型，结果可能因模型而异
          </span>
        </div>
      </div>
    </div>
  );
}
