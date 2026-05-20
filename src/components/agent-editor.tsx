'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Bot, X, Loader2, ChevronDown, ChevronRight, Sparkles, Image as ImageIcon, CheckCircle, XCircle, AlertTriangle, Plus, GripVertical } from 'lucide-react';
import { taskEventsClient } from '@/lib/task-events-client';

interface AgentEditorProps {
  /** 初始图片 URL，为空时显示添加图片按钮 */
  imageUrl?: string;
  /** 主题风格 */
  themeStyle?: 'gold' | 'monochrome';
  /** 完成回调 */
  onComplete: (resultImageUrl: string) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 选择图片回调（从画布选择） */
  onSelectImage?: () => void;
}

interface AgentStep {
  round: number;
  toolName: string;
  params: Record<string, unknown>;
  result: string;
  success: boolean;
}

export default function AgentEditor({ imageUrl, themeStyle = 'gold', onComplete, onClose, onSelectImage }: AgentEditorProps) {
  const isGold = themeStyle === 'gold';
  const [prompt, setPrompt] = useState('');
  const [maxRounds, setMaxRounds] = useState(5);
  const [isProcessing, setIsProcessing] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [finalResponse, setFinalResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 80, y: 80 });

  const currentImage = resultImageUrl || imageUrl;

  // 全局鼠标事件：拖动面板
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      e.preventDefault();
      setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    };
    const onUp = () => { setIsDragging(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, dragOffset]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  // 连接 SSE
  useEffect(() => {
    taskEventsClient.connect();
    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  // 监听任务事件
  useEffect(() => {
    if (!taskId) return;

    const unsub = taskEventsClient.onTaskEvent((event) => {
      if (event.taskId !== taskId) return;

      const task = event.task;
      setProgress(task.progress || 0);
      setProgressLabel(task.label || '');

      if (task.status === 'completed' && task.result) {
        const result = task.result as { imageUrl?: string; steps?: AgentStep[]; finalResponse?: string };
        setIsProcessing(false);
        setResultImageUrl(result.imageUrl || null);
        setSteps(result.steps || []);
        setFinalResponse(result.finalResponse || null);
        if (result.imageUrl) {
          onComplete(result.imageUrl);
        }
      } else if (task.status === 'failed') {
        setIsProcessing(false);
        setError(task.error || '任务失败');
      } else if (task.status === 'cancelled') {
        setIsProcessing(false);
        setError('任务已取消');
      }
    });

    unsubscribeRef.current = unsub;
    return () => { unsub(); };
  }, [taskId, onComplete]);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || isProcessing || !currentImage) return;

    setIsProcessing(true);
    setProgress(5);
    setProgressLabel('提交任务...');
    setSteps([]);
    setFinalResponse(null);
    setError(null);
    setResultImageUrl(null);

    try {
      const resp = await fetch('/api/agent-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: currentImage,
          prompt: prompt.trim(),
          maxRounds,
        }),
      });

      const data = await resp.json() as { success: boolean; taskId?: string; error?: string };
      if (data.success && data.taskId) {
        setTaskId(data.taskId);
      } else {
        setIsProcessing(false);
        setError(data.error || '提交失败');
      }
    } catch (err) {
      setIsProcessing(false);
      setError(err instanceof Error ? err.message : '网络错误');
    }
  }, [prompt, currentImage, maxRounds, isProcessing]);

  const handleCancel = useCallback(async () => {
    if (!taskId) return;
    await taskEventsClient.cancelTask(taskId);
    setIsProcessing(false);
    setError('任务已取消');
  }, [taskId]);

  const handleRetry = useCallback(() => {
    setError(null);
    setTaskId(null);
    setProgress(0);
    setProgressLabel('');
    setSteps([]);
    setFinalResponse(null);
    setResultImageUrl(null);
  }, []);

  // 样式
  const bg = isGold ? 'bg-[#1a1a1a]' : 'bg-gray-900';
  const text = isGold ? 'text-[#e5e5e5]' : 'text-gray-100';
  const muted = isGold ? 'text-[#888]' : 'text-gray-500';
  const accent = isGold ? 'text-[#d4af37]' : 'text-blue-400';
  const btnPrimary = isGold
    ? 'bg-[#d4af37] text-black hover:bg-[#c4a030]'
    : 'bg-blue-500 text-white hover:bg-blue-600';
  const border = isGold ? 'border-[#2a2a2a]' : 'border-gray-700';
  const inputBg = isGold ? 'bg-[#111]' : 'bg-gray-950';

  return (
    <div
      className={`fixed ${bg} border ${border} rounded-xl shadow-2xl flex flex-col z-[150] overflow-hidden`}
      style={{ left: position.x, top: position.y, width: 320 }}
      data-popup
    >
      {/* Header - 可拖拽 */}
      <div
        className={`px-3 py-2.5 border-b ${border} flex items-center gap-2 cursor-move select-none`}
        onMouseDown={handleDragStart}
      >
        <GripVertical className="w-3.5 h-3.5 text-gray-600" />
        <Bot className={`w-4 h-4 ${accent}`} />
        <span className={`text-sm font-semibold ${text} flex-1`}>Agent 编排</span>
        <button onClick={onClose} className={`p-1 rounded ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-800'}`}>
          <X className="w-3.5 h-3.5 text-gray-500" />
        </button>
      </div>

      {/* 图片区域 - 紧凑 */}
      <div className="px-3 pt-2.5 pb-1">
        {currentImage ? (
          <div className={`w-full rounded-lg overflow-hidden border ${border} relative`} style={{ height: 120 }}>
            <img
              src={resultImageUrl || imageUrl}
              alt={resultImageUrl ? 'Result' : 'Original'}
              className={`w-full h-full object-contain ${!resultImageUrl ? 'opacity-70' : ''}`}
            />
            {/* 切换原图/结果 */}
            {resultImageUrl && (
              <div className={`absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[10px] ${isGold ? 'bg-black/70 text-[#d4af37]' : 'bg-black/70 text-blue-400'}`}>
                {finalResponse || '编辑完成'}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onSelectImage}
            className={`w-full rounded-lg border-2 border-dashed ${border} flex flex-col items-center justify-center gap-1.5 transition-colors ${isGold ? 'hover:border-[#d4af37]/50 hover:bg-[#111]' : 'hover:border-blue-500/50 hover:bg-gray-950'}`}
            style={{ height: 120 }}
          >
            <Plus className={`w-6 h-6 ${muted}`} />
            <span className={`text-xs ${muted}`}>从画布选择图片</span>
          </button>
        )}
      </div>

      {/* 进度条 - 紧凑 */}
      {isProcessing && (
        <div className="px-3 pb-1.5">
          <div className={`w-full h-1 rounded-full ${isGold ? 'bg-[#252525]' : 'bg-gray-800'}`}>
            <div
              className={`h-full rounded-full transition-all duration-500 ${isGold ? 'bg-[#d4af37]' : 'bg-blue-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className={`mt-0.5 text-[10px] ${muted} text-center`}>{progressLabel}</div>
        </div>
      )}

      {/* 步骤折叠 - 默认收起 */}
      {steps.length > 0 && (
        <div className="px-3 pb-1">
          <button
            onClick={() => setShowSteps(!showSteps)}
            className={`flex items-center gap-1 text-[10px] ${muted} hover:${text} transition-colors`}
          >
            {showSteps ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            执行步骤 ({steps.length})
          </button>
          {showSteps && (
            <div className={`mt-1 space-y-0.5 max-h-24 overflow-y-auto`}>
              {steps.map((step, i) => (
                <div key={i} className={`flex items-center gap-1 text-[10px] ${inputBg} rounded px-1.5 py-0.5`}>
                  {step.success ? (
                    <CheckCircle className="w-2.5 h-2.5 text-green-400 shrink-0" />
                  ) : (
                    <XCircle className="w-2.5 h-2.5 text-red-400 shrink-0" />
                  )}
                  <span className={accent}>{step.toolName}</span>
                  <span className={`${muted} truncate`}>{step.result}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 错误提示 - 紧凑 */}
      {error && (
        <div className={`mx-3 mb-1.5 px-2 py-1.5 rounded text-[10px] flex items-center gap-1.5 ${isGold ? 'bg-red-900/20 text-red-400' : 'bg-red-950 text-red-400'}`}>
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span className="truncate flex-1">{error}</span>
          <button onClick={handleRetry} className="opacity-60 hover:opacity-100 underline shrink-0">重试</button>
        </div>
      )}

      {/* 控制区域 - 精简 */}
      <div className={`px-3 py-2.5 border-t ${border} space-y-2`}>
        {/* 最大轮次 + 执行按钮同行 */}
        <div className="flex items-center gap-2">
          <span className={`text-[10px] ${muted} shrink-0`}>轮次</span>
          <div className="flex gap-1">
            {[3, 5, 8].map(n => (
              <button
                key={n}
                onClick={() => setMaxRounds(n)}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  maxRounds === n ? btnPrimary : isGold ? 'bg-[#252525] text-[#999]' : 'bg-gray-800 text-gray-400'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* 输入框 - 精简 */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想对图片做什么..."
          disabled={isProcessing || !currentImage}
          className={`w-full rounded-lg px-2.5 py-1.5 text-xs resize-y ${inputBg} ${text} border ${border} focus:outline-none focus:ring-1 ${isGold ? 'focus:ring-[#d4af37]/20 placeholder:text-[#444]' : 'focus:ring-blue-500/20 placeholder:text-gray-600'} transition-colors disabled:opacity-50`}
          rows={2}
        />

        {/* 按钮行 */}
        <div className="flex gap-2">
          {isProcessing ? (
            <button
              onClick={handleCancel}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              取消
            </button>
          ) : (
            <>
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || !currentImage}
                className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
              >
                <Sparkles className="w-3 h-3" />
                执行
              </button>
              {resultImageUrl && (
                <button
                  onClick={() => resultImageUrl && onComplete(resultImageUrl)}
                  className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs ${isGold ? 'bg-[#252525] text-[#999] hover:bg-[#333]' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'} transition-colors`}
                >
                  <ImageIcon className="w-3 h-3" />
                  应用
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
