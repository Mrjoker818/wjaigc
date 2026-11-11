'use client';

import React, { useState, useRef, useLayoutEffect, useId } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw, Sparkles, X, Film, Clock, Wand2, Loader2 } from 'lucide-react';
import { useModalFocus } from './canvas/use-modal-focus';

interface VideoEditPanelProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 视频 URL */
  videoUrl: string;
  /** 视频缩略图 URL */
  thumbnailUrl?: string;
  /** 原始提示词 */
  originalPrompt?: string;
  /** 打开时由入口指定的页签，省略时保留语言编辑默认行为 */
  initialTab?: 'edit' | 'extend';
  /** 主题风格 */
  themeStyle?: 'gold' | 'monochrome';
  /** 关闭回调 */
  onClose: () => void;
  /** 提交受理后完成，失败时抛出错误，由当前面板决定是否关闭。 */
  onEdit: (params: {
    videoUrl: string;
    thumbnailUrl?: string;
    prompt: string;
    duration?: number;
    model?: string;
    providerId?: string;
  }) => void | Promise<void>;
  /** 提交受理后完成，失败时抛出错误，由当前面板决定是否关闭。 */
  onExtend?: (params: {
    videoUrl: string;
    prompt?: string;
    duration?: number;
    model?: string;
    providerId?: string;
  }) => void | Promise<void>;
  /** 当前选中的视频模型 */
  selectedVideoModel?: string;
  /** 当前选中的视频提供商ID */
  selectedVideoProviderId?: string;
}

export function VideoEditPanel({ isOpen, ...props }: VideoEditPanelProps) {
  if (!isOpen) return null;
  return <VideoEditSession key={JSON.stringify([props.videoUrl, props.initialTab ?? 'edit'])} {...props} />;
}

function VideoEditSession({
  videoUrl,
  thumbnailUrl,
  originalPrompt = '',
  initialTab = 'edit',
  themeStyle = 'gold',
  onClose,
  onEdit,
  onExtend,
  selectedVideoModel,
  selectedVideoProviderId,
}: Omit<VideoEditPanelProps, 'isOpen'>) {
  const [editPrompt, setEditPrompt] = useState('');
  const [extendPrompt, setExtendPrompt] = useState('');
  const [activeTab, setActiveTab] = useState<'edit' | 'extend'>(initialTab);
  const [extendDuration, setExtendDuration] = useState(5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ tab: 'edit' | 'extend'; message: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const active = useRef(false);
  const pending = useRef(false);
  const isDark = themeStyle === 'gold';
  const fieldId = useId();

  const handleClose = () => {
    active.current = false;
    onClose();
  };
  useModalFocus(dialogRef, closeRef, handleClose);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const submit = async (tab: 'edit' | 'extend', request: () => void | Promise<void>) => {
    if (!active.current || pending.current) return;
    pending.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await request();
    } catch (err) {
      if (active.current) setSubmitError({ tab, message: err instanceof Error ? err.message : '提交失败' });
      return;
    } finally {
      pending.current = false;
      if (active.current) setIsSubmitting(false);
    }
    if (active.current) handleClose();
  };

  const handleSubmitEdit = () => {
    if (!editPrompt.trim()) return;
    void submit('edit', () => onEdit({
      videoUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      prompt: editPrompt.trim(),
      model: selectedVideoModel,
      providerId: selectedVideoProviderId,
    }));
  };

  const handleSubmitExtend = () => {
    if (!onExtend) return;
    void submit('extend', () => onExtend({
      videoUrl,
      prompt: extendPrompt.trim() || undefined,
      duration: extendDuration,
      model: selectedVideoModel,
      providerId: selectedVideoProviderId,
    }));
  };

  return (
    <div ref={dialogRef} className={`fixed inset-0 z-[250] flex items-center justify-center ${isDark ? 'bg-black/70' : 'bg-black/50'}`}
      role="dialog" aria-modal="true" aria-label="视频编辑" data-modal="video-edit" tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div
        className={`relative w-[min(560px,calc(100vw-1rem))] max-h-[calc(100dvh-1rem)] min-h-0 flex flex-col rounded-2xl shadow-2xl [&_button]:inline-flex [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:shrink-0 [&_button]:items-center [&_button]:justify-center [&_button]:whitespace-nowrap ${isDark ? 'bg-[#1a1a1a] border border-[#2a2a2a]' : 'bg-white border border-gray-200'}`}
      >
        {/* 头部 */}
        <div className={`flex items-center justify-between px-5 py-3 border-b flex-shrink-0 ${isDark ? 'border-[#2a2a2a]' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <Film className={`w-5 h-5 ${isDark ? 'text-[#d4af37]' : 'text-blue-500'}`} />
            <h2 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>视频编辑</h2>
          </div>
          <button ref={closeRef} type="button" onClick={handleClose} aria-label="关闭视频编辑" className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 可滚动内容区 */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pt-4" style={{ scrollbarWidth: 'thin' }}>
          {/* 视频预览 */}
          <div>
            <div className={`relative rounded-xl overflow-hidden ${isDark ? 'bg-[#0d0d0d]' : 'bg-gray-100'}`} style={{ aspectRatio: '16/9' }}>
              <video
                ref={videoRef}
                src={videoUrl}
                poster={thumbnailUrl}
                className="w-full h-full object-contain"
                playsInline
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onVolumeChange={event => setIsMuted(event.currentTarget.muted)}
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 flex items-center gap-3">
                <button onClick={togglePlay} aria-label={isPlaying ? '暂停' : '播放'} className="text-white hover:text-[#d4af37] transition-colors">
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </button>
                <button onClick={toggleMute} aria-label={isMuted ? '取消静音' : '静音'} aria-pressed={isMuted} className="text-white hover:text-[#d4af37] transition-colors">
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => { if (videoRef.current) videoRef.current.currentTime = 0; }}
                  aria-label="回到开头"
                  className="text-white hover:text-[#d4af37] transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Tab 切换 */}
          <div className={`flex mt-4 rounded-lg overflow-hidden ${isDark ? 'bg-[#0d0d0d]' : 'bg-gray-100'}`}>
            <button
              onClick={() => setActiveTab('edit')}
              aria-pressed={activeTab === 'edit'}
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
              aria-pressed={activeTab === 'extend'}
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
            <div className="pt-4 pb-5 space-y-3">
              <div>
                <label htmlFor={`${fieldId}-edit`} className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>编辑描述</label>
                <textarea
                  id={`${fieldId}-edit`}
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
              {submitError?.tab === 'edit' && (
                <div role="alert" className="text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">{submitError.message}</div>
              )}
              <button
                onClick={handleSubmitEdit}
                disabled={!editPrompt.trim() || isSubmitting}
                className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all flex-shrink-0 ${
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
            <div className="pt-4 pb-5 space-y-3">
              <div>
                <label htmlFor={`${fieldId}-extend`} className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>延续描述（可选）</label>
                <textarea
                  id={`${fieldId}-extend`}
                  value={extendPrompt}
                  onChange={(e) => setExtendPrompt(e.target.value)}
                  placeholder="描述视频后续画面发展，留空则自动延续当前画面风格..."
                  rows={2}
                  className={`w-full rounded-lg px-3 py-2.5 text-sm resize-none transition-all ${isDark ? 'bg-[#0d0d0d] border border-[#2a2a2a] text-white placeholder:text-gray-600 focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30' : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:ring-1 focus:ring-blue-200'}`}
                />
              </div>
              <div>
                <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>延长时长</label>
                <div className="flex gap-2">
                  {[5, 10].map((d) => (
                    <button
                      key={d}
                      onClick={() => setExtendDuration(d)}
                      aria-pressed={extendDuration === d}
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
                  {submitError?.tab === 'extend' && (
                    <div role="alert" className="text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">{submitError.message}</div>
                  )}
                  <button
                    onClick={handleSubmitExtend}
                    disabled={isSubmitting}
                    className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all flex-shrink-0 ${
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
        </div>

        {/* 底部提示（固定不滚动） */}
        <div className={`px-5 py-3 text-center border-t flex-shrink-0 ${isDark ? 'border-[#2a2a2a]' : 'border-gray-200'}`}>
          <span className={`text-[10px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
            ESC 退出 · 视频编辑基于AI模型，结果可能因模型而异
          </span>
        </div>
      </div>
    </div>
  );
}
