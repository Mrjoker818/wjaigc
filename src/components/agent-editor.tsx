'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Bot, X, Loader2, ChevronDown, ChevronRight, Sparkles, Image as ImageIcon, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { taskEventsClient } from '@/lib/task-events-client';
import type { TaskInfo } from '@/lib/task-registry';

interface AgentEditorProps {
  /** 初始图片 URL */
  imageUrl: string;
  /** 主题风格 */
  themeStyle?: 'gold' | 'monochrome';
  /** 完成回调 */
  onComplete: (resultImageUrl: string) => void;
  /** 关闭回调 */
  onClose: () => void;
}

interface AgentStep {
  round: number;
  toolName: string;
  params: Record<string, unknown>;
  result: string;
  success: boolean;
}

export default function AgentEditor({ imageUrl, themeStyle = 'gold', onComplete, onClose }: AgentEditorProps) {
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
  const [showSteps, setShowSteps] = useState(true);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

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
      } else if (task.status === 'processing') {
        // 更新步骤（从进度标签解析）
        if (task.label?.includes('轮:')) {
          // 正在执行，更新状态
        }
      }
    });

    unsubscribeRef.current = unsub;
    return () => { unsub(); };
  }, [taskId, onComplete]);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || isProcessing) return;

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
          image: imageUrl,
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
  }, [prompt, imageUrl, maxRounds, isProcessing]);

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
  const btnSecondary = isGold
    ? 'bg-[#252525] text-[#999] hover:bg-[#333]'
    : 'bg-gray-800 text-gray-400 hover:bg-gray-700';
  const border = isGold ? 'border-[#2a2a2a]' : 'border-gray-700';

  return (
    <div className={`fixed right-4 top-4 bottom-4 w-[360px] ${bg} border ${border} rounded-xl shadow-2xl flex flex-col z-[150] overflow-hidden`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${border} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Bot className={`w-4 h-4 ${accent}`} />
          <span className={`text-sm font-semibold ${text}`}>Agent 编排</span>
        </div>
        <button onClick={onClose} className={`p-1 rounded ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-800'}`}>
          <X className="w-3.5 h-3.5 text-gray-500" />
        </button>
      </div>

      {/* 图片预览 */}
      <div className="px-4 py-3">
        <div className={`w-full h-40 rounded-lg overflow-hidden border ${border} flex items-center justify-center ${isGold ? 'bg-[#111]' : 'bg-gray-950'}`}>
          {resultImageUrl ? (
            <img src={resultImageUrl} alt="Agent result" className="w-full h-full object-contain" />
          ) : (
            <img src={imageUrl} alt="Original" className="w-full h-full object-contain opacity-60" />
          )}
        </div>
        {resultImageUrl && (
          <div className={`mt-1 text-xs ${muted} text-center`}>
            {finalResponse || '编辑完成'}
          </div>
        )}
      </div>

      {/* 进度条 */}
      {isProcessing && (
        <div className="px-4 pb-2">
          <div className={`w-full h-1.5 rounded-full ${isGold ? 'bg-[#252525]' : 'bg-gray-800'}`}>
            <div
              className="h-full rounded-full bg-[#d4af37] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className={`mt-1 text-xs ${muted} text-center`}>{progressLabel}</div>
        </div>
      )}

      {/* 执行步骤 */}
      {steps.length > 0 && (
        <div className="px-4 pb-2">
          <button
            onClick={() => setShowSteps(!showSteps)}
            className={`flex items-center gap-1 text-xs ${muted} hover:${text} transition-colors`}
          >
            {showSteps ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            执行步骤 ({steps.length})
          </button>
          {showSteps && (
            <div className={`mt-1 space-y-1 max-h-32 overflow-y-auto ${isGold ? 'scrollbar-thin-dark' : ''}`}>
              {steps.map((step, i) => (
                <div key={i} className={`flex items-start gap-1.5 text-xs ${isGold ? 'bg-[#111]' : 'bg-gray-950'} rounded px-2 py-1`}>
                  {step.success ? (
                    <CheckCircle className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className={accent}>{step.toolName}</span>
                    <span className={`ml-1 ${muted}`}>{step.result}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className={`mx-4 mb-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${isGold ? 'bg-red-900/20 text-red-400' : 'bg-red-950 text-red-400'}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
          <button onClick={handleRetry} className="ml-auto opacity-60 hover:opacity-100 underline">重试</button>
        </div>
      )}

      {/* 弹性填充 */}
      <div className="flex-1" />

      {/* 控制区域 */}
      <div className={`px-4 py-3 border-t ${border} space-y-3`}>
        {/* 最大轮次 */}
        <div className="flex items-center gap-2">
          <span className={`text-xs ${muted}`}>最大轮次</span>
          <div className="flex gap-1">
            {[3, 5, 8].map(n => (
              <button
                key={n}
                onClick={() => setMaxRounds(n)}
                className={`px-2 py-0.5 rounded text-xs ${
                  maxRounds === n
                    ? btnPrimary
                    : btnSecondary
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* 输入框 */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想对图片做什么..."
          disabled={isProcessing}
          className={`w-full h-20 rounded-lg px-3 py-2 text-sm resize-y ${
            isGold
              ? 'bg-[#111] text-[#e5e5e5] border-[#2a2a2a] placeholder:text-[#555] focus:border-[#d4af37]/30'
              : 'bg-gray-950 text-gray-100 border-gray-700 placeholder:text-gray-600 focus:border-blue-500/30'
          } border focus:outline-none focus:ring-1 focus:ring-[#d4af37]/20 transition-colors disabled:opacity-50`}
        />

        {/* 按钮 */}
        <div className="flex gap-2">
          {isProcessing ? (
            <button
              onClick={handleCancel}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              取消
            </button>
          ) : (
            <>
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim()}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Agent 执行
              </button>
              {resultImageUrl && (
                <button
                  onClick={() => resultImageUrl && onComplete(resultImageUrl)}
                  className={`flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm ${btnSecondary} transition-colors`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
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
