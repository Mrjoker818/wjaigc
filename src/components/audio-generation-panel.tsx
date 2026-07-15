'use client';

import React, { useState } from 'react';
import { Mic, Play, Loader2, Settings, RefreshCw, Copy } from 'lucide-react';
import { AudioPlayer } from './audio-player';

interface AudioGenerationPanelProps {
  onGenerate?: (audioUrl: string, text: string) => void;
  currentModel?: string;
  onModelChange?: (model: string) => void;
  onClose?: () => void;
}

interface AudioModel {
  id: string;
  name: string;
  provider: string;
  features: string[];
}

/**
 * 音频生成面板组件
 * 支持TTS文字转语音、语音风格选择、语速控制
 */
export function AudioGenerationPanel({
  onGenerate,
  currentModel,
  onModelChange,
  onClose
}: AudioGenerationPanelProps) {
  const [text, setText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState<{ url: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  // 语音参数
  const [voice, setVoice] = useState('default');
  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);

  // 可用模型（从管理员配置或默认）
  const audioModels: AudioModel[] = [
    { id: 'openai-tts-1', name: 'TTS-1', provider: 'OpenAI', features: ['高质量', '多语言'] },
    { id: 'openai-tts-1-hd', name: 'TTS-1-HD', provider: 'OpenAI', features: ['超高清', '自然语音'] },
    { id: 'azure-tts', name: 'Azure TTS', provider: 'Azure', features: ['SSML', '情感语音'] },
  ];

  // 可用语音选项
  const voiceOptions = [
    { id: 'default', name: '默认', description: '标准自然语音' },
    { id: 'male', name: '男声', description: '成年男性声音' },
    { id: 'female', name: '女声', description: '成年女性声音' },
    { id: 'child', name: '童声', description: '儿童声音' },
    { id: 'news', name: '新闻播报', description: '新闻播报风格' },
    { id: 'story', name: '讲故事', description: '故事讲述风格' },
  ];

  // 生成音频
  const handleGenerate = async () => {
    if (!text.trim()) {
      setError('请输入要转换的文字');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedAudio(null);

    try {
      const response = await fetch('/api/audio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          model: currentModel || 'openai-tts-1',
          voice,
          speed,
          pitch,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '生成失败');
      }

      if (data.audioUrl) {
        setGeneratedAudio({ url: data.audioUrl, text: text.trim() });
        onGenerate?.(data.audioUrl, text.trim());
      } else {
        throw new Error('未返回音频URL');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  // 复制文本
  const handleCopyText = () => {
    navigator.clipboard.writeText(text);
  };

  // 清空重试
  const handleClear = () => {
    setText('');
    setGeneratedAudio(null);
    setError(null);
  };

  // 字数统计
  const charCount = text.length;
  const maxChars = 4000;

  return (
    <div className="bg-[#1a1a1a] rounded-xl border border-border shadow-lg w-full max-w-lg">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Mic className="w-5 h-5 text-primary" />
          <h3 className="text-base font-medium text-foreground">音频生成</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-muted/50 flex items-center justify-center hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
            aria-label="打开设置面板"
            aria-expanded={showSettings}
            aria-controls="settings-panel"
          >
            <Settings className="w-5 h-5 text-muted-foreground" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-muted/50 flex items-center justify-center hover:bg-destructive/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
              aria-label="关闭音频生成面板"
            >
              <span className="text-muted-foreground text-lg">×</span>
            </button>
          )}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="p-4 space-y-4">
        {/* 文本输入 */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">输入文字</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入要转换为语音的文字内容..."
            className="w-full h-32 px-3 py-2 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            maxLength={maxChars}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{charCount} / {maxChars} 字</span>
            <button
              onClick={handleCopyText}
              className="min-h-[44px] px-3 py-2 hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 rounded"
              aria-label="复制文本内容"
            >
              <Copy className="w-4 h-4 inline mr-1" aria-hidden="true" />复制
            </button>
          </div>
        </div>

        {/* 设置面板（可展开） */}
        {showSettings && (
          <div className="space-y-4 p-3 bg-muted/30 rounded-lg border border-border">
            {/* 语音选择 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">语音风格</label>
              <div className="grid grid-cols-3 gap-2">
                {voiceOptions.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVoice(v.id)}
                    className={`min-h-[44px] px-3 py-2 rounded text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                      voice === v.id 
                        ? 'bg-primary text-primary-foreground' 
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    }`}
                    aria-label={`选择${v.name}语音风格`}
                    aria-pressed={voice === v.id}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 语速控制 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">语速: {speed.toFixed(1)}x</label>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
              />
            </div>

            {/* 音调控制 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">音调: {pitch.toFixed(1)}</label>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={pitch}
                onChange={(e) => setPitch(parseFloat(e.target.value))}
                className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
              />
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
            {error}
          </div>
        )}

        {/* 生成的音频 */}
        {generatedAudio && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Play className="w-4 h-4" />
              <span>生成完成</span>
            </div>
            <AudioPlayer 
              audioUrl={generatedAudio.url} 
              text={generatedAudio.text}
              autoPlay={true}
            />
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !text.trim()}
            className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>生成中...</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span>生成音频</span>
              </>
            )}
          </button>
          <button
            onClick={handleClear}
            className="w-10 h-10 rounded-lg bg-muted/50 text-muted-foreground hover:bg-muted transition-colors flex items-center justify-center"
            aria-label="清空"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 模型选择（底部） */}
      <div className="px-4 py-3 border-t border-border">
        <label className="text-xs text-muted-foreground mb-2 block">当前模型</label>
        <div className="flex gap-2">
          {audioModels.map((m) => (
            <button
              key={m.id}
              onClick={() => onModelChange?.(m.id)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                (currentModel || 'openai-tts-1') === m.id
                  ? 'bg-primary/20 text-primary border border-primary/50'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-border'
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AudioGenerationPanel;