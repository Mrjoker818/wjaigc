'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, GripVertical, RefreshCw, ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, ImagePlus, Minus } from 'lucide-react';

interface AgentEditorProps {
  imageUrl?: string;
  imagePrompt?: string;
  imageWidth?: number;
  imageHeight?: number;
  isMonochrome?: boolean;
  onClose: () => void;
  onApply: (resultUrl: string, resultPrompt?: string) => void;
  onSelectImage?: () => void;
  onChangeImage?: () => void;
}

interface AgentStep {
  round: number;
  toolName: string;
  params: Record<string, unknown>;
  result?: string;
  success: boolean;
  detail?: string;
}

// 主题色
const GOLD = '#d4af37';
const GOLD_DIM = '#a88a2a';
const MONO_BG = '#f5f5f5';
const MONO_BORDER = '#d4d4d4';
const MONO_TEXT = '#333333';
const MONO_MUTED = '#888888';

export function AgentEditor({
  imageUrl,
  imagePrompt,
  imageWidth,
  imageHeight,
  isMonochrome,
  onClose,
  onApply,
  onSelectImage,
  onChangeImage,
}: AgentEditorProps) {
  // 状态
  const [prompt, setPrompt] = useState('');
  const [maxRounds, setMaxRounds] = useState(3);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [error, setError] = useState('');
  const [resultImageUrl, setResultImageUrl] = useState('');
  const [resultPrompt, setResultPrompt] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);

  // 拖动状态
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [hasPosition, setHasPosition] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // 输入框拖动调整高度
  const [textareaHeight, setTextareaHeight] = useState(56);
  const isResizing = useRef(false);
  const resizeStart = useRef({ y: 0, height: 0 });

  // 图片显示尺寸（自适应比例）
  const [imgDisplaySize, setImgDisplaySize] = useState({ w: 280, h: 180 });

  // 计算图片显示尺寸
  useEffect(() => {
    if (imageUrl && imageWidth && imageHeight) {
      const maxW = 280, maxH = 200;
      const ratio = imageWidth / imageHeight;
      let w = maxW, h = maxW / ratio;
      if (h > maxH) { h = maxH; w = maxH * ratio; }
      setImgDisplaySize({ w: Math.round(w), h: Math.round(h) });
    } else if (imageUrl) {
      // 没有尺寸信息时，加载图片获取
      const img = new Image();
      img.onload = () => {
        const maxW = 280, maxH = 200;
        const ratio = img.naturalWidth / img.naturalHeight;
        let w = maxW, h = maxW / ratio;
        if (h > maxH) { h = maxH; w = maxH * ratio; }
        setImgDisplaySize({ w: Math.round(w), h: Math.round(h) });
      };
      img.src = imageUrl;
    }
  }, [imageUrl, imageWidth, imageHeight]);

  // 主题色变量
  const accentColor = isMonochrome ? MONO_TEXT : GOLD;
  const accentDim = isMonochrome ? MONO_MUTED : GOLD_DIM;
  const bgPanel = isMonochrome ? MONO_BG : 'rgba(20,20,20,0.85)';
  const bgInput = isMonochrome ? '#ffffff' : 'rgba(26,26,26,0.85)';
  const textColor = isMonochrome ? MONO_TEXT : '#e0e0e0';
  const mutedColor = isMonochrome ? MONO_MUTED : '#999999';
  const borderColor = isMonochrome ? MONO_BORDER : 'rgba(255,255,255,0.12)';

  // 轮询任务状态
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttempts = useRef(0);

  const startPolling = useCallback((tid: string) => {
    if (pollInterval.current) clearInterval(pollInterval.current);
    pollAttempts.current = 0;

    pollInterval.current = setInterval(async () => {
      pollAttempts.current++;
      if (pollAttempts.current > 120) {
        // 2分钟超时
        if (pollInterval.current) clearInterval(pollInterval.current);
        setIsProcessing(false);
        setError('任务超时，请重试');
        return;
      }

      try {
        const resp = await fetch(`/api/poll-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: tid }),
        });
        if (!resp.ok) return;

        const data = await resp.json() as Record<string, unknown>;
        const taskData = data.task as Record<string, unknown> | undefined;
        if (!taskData) return;

        const status = String(taskData.status || '');
        const prog = Number(taskData.progress || 0);
        const label = String(taskData.label || '');
        const result = taskData.result as Record<string, unknown> | undefined;
        const taskError = String(taskData.error || '');

        // 更新进度
        setProgress(prog);
        setProgressLabel(label);

        // 更新步骤
        if (result?.steps) {
          setSteps(result.steps as AgentStep[]);
        }

        if (status === 'completed') {
          if (pollInterval.current) clearInterval(pollInterval.current);
          setIsProcessing(false);
          setProgress(100);
          setProgressLabel('完成');

          if (result?.imageUrl) {
            setResultImageUrl(String(result.imageUrl));
          }
          if (result?.prompt) {
            setResultPrompt(String(result.prompt));
          }
        } else if (status === 'failed') {
          if (pollInterval.current) clearInterval(pollInterval.current);
          setIsProcessing(false);
          setError(taskError || '任务执行失败');
        } else if (status === 'cancelled') {
          if (pollInterval.current) clearInterval(pollInterval.current);
          setIsProcessing(false);
          setError('任务已取消');
        }
      } catch {
        // 轮询失败，继续重试
      }
    }, 2000);
  }, []);

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, []);

  // 提交任务
  const handleSubmit = async () => {
    if (!prompt.trim() && !imageUrl) return;

    setIsProcessing(true);
    setProgress(5);
    setProgressLabel('提交任务...');
    setError('');
    setSteps([]);
    setResultImageUrl('');
    setResultPrompt('');
    setTaskId(null);

    try {
      const resp = await fetch('/api/agent-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageUrl || '',
          prompt: prompt.trim(),
          maskDataUrl: '',
          maxRounds,
          size: '1024',
          quality: 'medium',
        }),
      });

      const data = await resp.json() as Record<string, unknown>;

      if (!resp.ok) {
        throw new Error(String(data.error || '提交失败'));
      }

      const tid = String(data.taskId || '');
      if (tid) {
        setTaskId(tid);
        setProgress(10);
        setProgressLabel('任务已提交，等待处理...');
        // 开始轮询
        startPolling(tid);
      } else {
        // 没有taskId，可能是同步返回
        if (data.result) {
          const result = data.result as Record<string, unknown>;
          if (result.imageUrl) setResultImageUrl(String(result.imageUrl));
          if (result.prompt) setResultPrompt(String(result.prompt));
        }
        setIsProcessing(false);
        setProgress(100);
      }
    } catch (err) {
      setIsProcessing(false);
      setError(err instanceof Error ? err.message : '提交任务失败');
    }
  };

  // 取消任务
  const handleCancel = async () => {
    if (taskId) {
      try {
        await fetch('/api/cancel-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
      } catch { /* ignore */ }
    }
    if (pollInterval.current) clearInterval(pollInterval.current);
    setIsProcessing(false);
    setProgress(0);
    setError('任务已取消');
  };

  // 应用结果
  const handleApplyResult = () => {
    if (resultImageUrl) {
      onApply(resultImageUrl, resultPrompt);
    }
  };

  // 面板拖动
  const handlePanelDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    // 如果还没有设置过位置，先从当前面板位置计算
    if (!hasPosition && panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      setPosition({ x: rect.left, y: rect.top });
      setHasPosition(true);
      dragStart.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    } else if (hasPosition) {
      dragStart.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    } else {
      // panelRef not available yet, skip drag start
      isDragging.current = false;
    }
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      ev.stopPropagation();
      setPosition({
        x: ev.clientX - dragStart.current.x,
        y: ev.clientY - dragStart.current.y,
      });
    };
    const onMouseUp = (ev: MouseEvent) => {
      ev.stopPropagation();
      isDragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // 输入框高度调整
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    resizeStart.current = { y: e.clientY, height: textareaHeight };
    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      ev.stopPropagation();
      const delta = resizeStart.current.height + (ev.clientY - resizeStart.current.y);
      setTextareaHeight(Math.max(36, Math.min(300, delta)));
    };
    const onMouseUp = (ev: MouseEvent) => {
      ev.stopPropagation();
      isResizing.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // 阻止事件穿透
  const stopPropagation = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      ref={panelRef}
      className="fixed z-[150]"
      style={{
        left: hasPosition ? position.x : 'auto',
        top: hasPosition ? position.y : 80,
        right: hasPosition ? undefined : 20,
        width: 320,
        maxHeight: '85vh',
        backgroundColor: bgPanel,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        boxShadow: isMonochrome ? '0 4px 20px rgba(0,0,0,0.1)' : '0 4px 20px rgba(0,0,0,0.5)',
        backdropFilter: isMonochrome ? 'none' : 'blur(24px)',
        WebkitBackdropFilter: isMonochrome ? 'none' : 'blur(24px)',
        color: textColor,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onMouseDown={stopPropagation}
      onPointerDown={stopPropagation}
      data-popup="agent-editor"
    >
      {/* Header - 可拖动 */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-move select-none shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
        onMouseDown={handlePanelDragStart}
      >
        <GripVertical size={14} style={{ color: mutedColor }} />
        <span className="text-sm font-semibold flex-1" style={{ color: accentColor }}>
          Agent 编排
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="p-1 rounded hover:bg-white/10 transition-colors"
          style={{ color: mutedColor }}
        >
          <X size={14} />
        </button>
      </div>

      {/* 可滚动内容区 */}
      <div className="overflow-y-auto shrink-0" style={{ maxHeight: 240 }}>
        {/* 图片区域 */}
        {imageUrl ? (
          <div className="px-3 pt-2 pb-1">
            <div
              className="relative rounded overflow-hidden"
              style={{
                width: imgDisplaySize.w,
                height: imgDisplaySize.h,
                margin: '0 auto',
                backgroundColor: isMonochrome ? '#e5e5e5' : '#111111',
              }}
            >
              <img
                src={imageUrl}
                alt="编辑图片"
                className="w-full h-full object-contain"
                draggable={false}
              />
              {/* 更换图片按钮 */}
              <button
                onClick={(e) => { e.stopPropagation(); onChangeImage?.(); }}
                className="absolute top-1.5 right-1.5 p-1 rounded transition-colors"
                style={{
                  backgroundColor: isMonochrome ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.65)',
                  color: accentColor,
                }}
                title="更换图片"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            {imagePrompt && (
              <p className="text-[10px] mt-1 truncate" style={{ color: mutedColor }}>
                {imagePrompt}
              </p>
            )}
          </div>
        ) : (
          <div className="px-3 pt-2 pb-1">
            <button
              onClick={(e) => { e.stopPropagation(); onSelectImage?.(); }}
              className="w-full py-6 rounded border-2 border-dashed flex flex-col items-center gap-1 transition-colors"
              style={{
                borderColor: `${accentColor}40`,
                color: accentDim,
                backgroundColor: 'transparent',
              }}
            >
              <ImagePlus size={20} />
              <span className="text-[10px]">从画布选择图片</span>
            </button>
          </div>
        )}

        {/* 进度条 - 紧跟图片下方 */}
        {isProcessing && (
          <div className="px-3 py-1.5">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: isMonochrome ? '#e0e0e0' : '#333' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(progress, 2)}%`, backgroundColor: accentColor }}
                />
              </div>
              <span className="text-[10px] shrink-0" style={{ color: mutedColor }}>
                {progress}%
              </span>
            </div>
            {progressLabel && (
              <p className="text-[10px] mt-0.5 truncate" style={{ color: mutedColor }}>
                {progressLabel}
              </p>
            )}
          </div>
        )}

        {/* 执行步骤 (折叠) */}
        {steps.length > 0 && (
          <div className="px-3">
            <button
              onClick={(e) => { e.stopPropagation(); setStepsExpanded(!stepsExpanded); }}
              className="flex items-center gap-1 text-[10px] w-full py-1"
              style={{ color: accentDim }}
            >
              {stepsExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              <span>执行步骤 ({steps.length})</span>
            </button>
            {stepsExpanded && (
              <div className="space-y-0.5 pb-1">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-1 text-[10px]" style={{ color: mutedColor }}>
                    {step.success ? (
                      <CheckCircle2 size={10} className="shrink-0 mt-0.5" style={{ color: '#4caf50' }} />
                    ) : (
                      <XCircle size={10} className="shrink-0 mt-0.5" style={{ color: '#ef5350' }} />
                    )}
                    <span>
                      R{step.round}: {step.toolName}
                      {step.detail ? ` - ${step.detail}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 结果预览 */}
        {resultImageUrl && (
          <div className="px-3 pb-1">
            <div className="rounded overflow-hidden" style={{ border: `1px solid ${accentColor}40` }}>
              <img
                src={resultImageUrl}
                alt="结果"
                className="w-full object-contain"
                style={{ maxHeight: 120 }}
                draggable={false}
              />
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="px-3 pb-1">
            <p className="text-[10px] px-2 py-1 rounded" style={{ color: '#ef5350', backgroundColor: isMonochrome ? '#fff0f0' : 'rgba(239,83,80,0.1)' }}>
              {error}
            </p>
          </div>
        )}
      </div>

      {/* 固定底部区域：轮次 + 输入框 + 按钮 + 拖拽手柄 */}
      <div className="shrink-0 flex flex-col" style={{ borderTop: `1px solid ${borderColor}` }}>
        {/* 轮次选择 */}
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
          <span className="text-[10px]" style={{ color: mutedColor }}>轮次:</span>
          {[3, 5, 8].map(r => (
            <button
              key={r}
              onClick={(e) => { e.stopPropagation(); setMaxRounds(r); }}
              className="px-1.5 py-0.5 rounded text-[10px] transition-colors"
              style={{
                backgroundColor: maxRounds === r ? accentColor : 'transparent',
                color: maxRounds === r ? (isMonochrome ? '#fff' : '#1a1a1a') : mutedColor,
                border: `1px solid ${maxRounds === r ? accentColor : borderColor}`,
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* 输入框 */}
        <div className="px-3 pb-1">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述你想要的编辑效果..."
            className="w-full rounded px-2 py-1.5 text-xs resize-none focus:outline-none"
            style={{
              height: textareaHeight,
              backgroundColor: bgInput,
              color: textColor,
              border: `1px solid ${borderColor}`,
            }}
            rows={2}
            disabled={isProcessing}
            onClick={stopPropagation}
            onPointerDown={stopPropagation}
          />
        </div>

        {/* 执行按钮 */}
        <div className="flex items-center gap-1.5 px-3 pb-1.5">
          {isProcessing ? (
            <button
              onClick={(e) => { e.stopPropagation(); handleCancel(); }}
              className="flex-1 py-1.5 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1"
              style={{
                backgroundColor: '#ef5350',
                color: '#fff',
              }}
            >
              <Minus size={12} /> 取消
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
              disabled={!prompt.trim() && !imageUrl}
              className="flex-1 py-1.5 rounded text-xs font-medium transition-colors"
              style={{
                backgroundColor: accentColor,
                color: isMonochrome ? '#fff' : '#1a1a1a',
                opacity: (!prompt.trim() && !imageUrl) ? 0.5 : 1,
              }}
            >
              执行
            </button>
          )}
          {resultImageUrl && !isProcessing && (
            <button
              onClick={(e) => { e.stopPropagation(); handleApplyResult(); }}
              className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
              style={{
                backgroundColor: '#4caf50',
                color: '#fff',
              }}
            >
              应用
            </button>
          )}
        </div>

        {/* 拖拽手柄 - 调整输入框高度 */}
        <div
          className="flex items-center justify-center py-0.5 cursor-ns-resize select-none"
          style={{ borderTop: `1px solid ${borderColor}` }}
          onMouseDown={handleResizeStart}
        >
          <div className="w-8 h-1 rounded-full" style={{ backgroundColor: mutedColor, opacity: 0.5 }} />
        </div>
      </div>
    </div>
  );
}
