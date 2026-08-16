'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, GripVertical, RefreshCw, ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, ImagePlus, Minus, Zap, Timer, Clock, FileText } from 'lucide-react';
import { useProgressTimer } from '@/hooks/useProgressTimer';
import { getPromptTemplates, searchTemplates, type PromptTemplate } from '@/lib/prompt-templates';
import { AgentProgressTimeline } from '@/components/agent-runtime/AgentProgressTimeline';
import { useAgentRunEvents } from '@/components/agent-runtime/use-agent-run-events';

interface AgentEditorProps {
  projectId?: string;
  sourceVersionId?: string;
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

// 从图像生成面板读取当前选择的模型信息
function getCurrentImageModelInfo(): { imageModel?: string; imageProviderId?: string; quality?: string; aspectRatio?: string } {
  try {
    const stored = localStorage.getItem('wujie_selected_model');
    if (stored) {
      const parsed = JSON.parse(stored);
      const compositeKey = parsed.model || '';
      if (compositeKey.includes('::')) {
        const [pid, mid] = compositeKey.split('::');
        return { imageModel: mid, imageProviderId: pid, quality: parsed.quality, aspectRatio: parsed.aspectRatio };
      }
      return { imageModel: compositeKey, imageProviderId: parsed.providerId || parsed.compositeProviderId || undefined, quality: parsed.quality, aspectRatio: parsed.aspectRatio };
    }
  } catch { /* ignore */ }
  return {};
}

// 主题色
const GOLD = '#d4af37';
const GOLD_DIM = '#a88a2a';
const MONO_BG = '#f5f5f5';
const MONO_BORDER = '#d4d4d4';
const MONO_TEXT = '#333333';
const MONO_MUTED = '#888888';
const MONO_ACCENT = '#3b82f6';

/** 前端兜底：将纯英文 API 错误翻译为中文友好提示 */
function translateErrorFrontend(msg: string): string {
  if (!msg) return '操作失败，请重试';
  const lower = msg.toLowerCase();
  if (lower.includes('try again later') || lower.includes('please wait')) {
    return '当前模型暂时不可用，请稍后重试或切换其他模型';
  }
  if (lower.includes('insufficient balance') || lower.includes('insufficient')) {
    return 'API 余额不足，请联系管理员充值';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return '请求过于频繁，请稍后再试';
  }
  if (lower.includes('model not found')) {
    return '模型不存在或已下线，请尝试切换其他模型';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return '请求超时，请稍后重试';
  }
  if (/^[a-zA-Z]/.test(msg) && !/[\u4e00-\u9fff]/.test(msg)) {
    return `API 返回错误: ${msg.replace(/\s*\(request id:.*?\)\s*/i, '').trim()}`;
  }
  return msg;
}

export function AgentEditor({
  projectId,
  sourceVersionId,
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

  // 决策模型（LLM）选择：Agent 编排的思考模型，从 /api/models?type=chat 加载
  const [chatModelOptions, setChatModelOptions] = useState<{ providerId: string; providerName: string; id: string; name: string; isDefault?: boolean }[]>([]);
  const [selectedChatModel, setSelectedChatModel] = useState('');
  const chatModelLoaded = useRef(false);
  useEffect(() => {
    if (chatModelLoaded.current) return;
    chatModelLoaded.current = true;
    fetch('/api/models?type=chat')
      .then((r) => r.json())
      .then((data: { models?: { providerId: string; providerName: string; id: string; name: string; isDefault?: boolean }[] }) => {
        const models = Array.isArray(data?.models) ? data.models : [];
        setChatModelOptions(models);
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('wujie_agent_llm_model') || '' : '';
        if (saved && models.some((m) => `${m.providerId}::${m.id}` === saved)) {
          setSelectedChatModel(saved);
        } else if (models.length > 0) {
          const dflt = models.find((m) => m.isDefault) || models[0];
          setSelectedChatModel(`${dflt.providerId}::${dflt.id}`);
        }
      })
      .catch(() => {});
  }, []);

  // 提示词模板触发状态
  const [showTemplatePopup, setShowTemplatePopup] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templatePopupIndex, setTemplatePopupIndex] = useState(0);
  const filteredTemplates = templateSearch ? searchTemplates(templateSearch) : getPromptTemplates();
  const [resultPrompt, setResultPrompt] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const agentRun = useAgentRunEvents(agentRunId);
  const { elapsed, totalTime, formatTime, startTimer, stopTimer, resetTimer } = useProgressTimer();

  // 拖动状态
  const [position, setPosition] = useState(() => {
    if (typeof window !== 'undefined') {
      const panelW = 420;
      const panelH = 580;
      return { x: Math.max(0, (window.innerWidth - panelW) / 2), y: Math.max(0, (window.innerHeight - panelH) / 2) };
    }
    return { x: 0, y: 0 };
  });
  const [hasPosition, setHasPosition] = useState(true);
  const isDragging = useRef(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
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

  // 组件卸载时清理轮询定时器
  useEffect(() => {
    return () => {
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
      stopTimer();
    };
  }, [stopTimer]);

  // 主题色变量
  const accentColor = isMonochrome ? MONO_ACCENT : GOLD;
  const accentDim = isMonochrome ? '#2563eb' : GOLD_DIM;
  const bgPanel = isMonochrome ? MONO_BG : 'rgba(20,20,20,0.85)';
  const bgInput = isMonochrome ? '#ffffff' : 'rgba(26,26,26,0.85)';
  const textColor = isMonochrome ? MONO_TEXT : '#e0e0e0';
  const mutedColor = isMonochrome ? MONO_MUTED : '#999999';
  const borderColor = isMonochrome ? MONO_BORDER : 'rgba(255,255,255,0.12)';

  // 轮询任务状态
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttempts = useRef(0);

  const pollOnce = useCallback(async (tid: string) => {
    pollAttempts.current++;

    if (pollAttempts.current > 300) {
      stopTimer();
      setIsProcessing(false);
      setError('任务超时，请重试');
      return;
    }

    try {
      const resp = await fetch(`/api/agent-edit?taskId=${encodeURIComponent(tid)}`);
      if (!resp.ok) throw new Error('poll failed');

      const data = await resp.json() as Record<string, unknown>;
      const status = String(data.status || '');
      const prog = Number(data.progress || 0);
      const label = String(data.label || '');
      const result = data.result as Record<string, unknown> | undefined;
      const taskError = String(data.error || '');

      setProgress(prog);
      setProgressLabel(label);
      if (result?.steps) setSteps(result.steps as AgentStep[]);

      if (status === 'completed') {
        stopTimer();
        setIsProcessing(false);
        setProgress(100);
        setProgressLabel('完成');
        if (result?.imageUrl) setResultImageUrl(String(result.imageUrl));
        if (result?.prompt) setResultPrompt(String(result.prompt));
        const steps = (result?.steps || []) as AgentStep[];
        const failedSteps = steps.filter((s: AgentStep) => !s.success);
        if (failedSteps.length > 0) {
          const errorDetails = failedSteps.map((s: AgentStep, i: number) =>
            `步骤${i + 1}(${s.toolName}): ${s.result || '未知错误'}`
          ).join('\n');
          setError(errorDetails);
        }
        return;
      } else if (status === 'failed') {
        setIsProcessing(false); stopTimer();
        const errorMsg = translateErrorFrontend(taskError || (result?.finalResponse ? String(result.finalResponse) : '') || '任务执行失败');
        setError(errorMsg);
        return;
      } else if (status === 'cancelled') {
        setIsProcessing(false); stopTimer();
        setError('任务已取消');
        return;
      }
    } catch {
      // 轮询失败，继续重试
    }

    // 动态间隔：前10次1s，10-30次1.5s，之后2s
    const nextInterval = pollAttempts.current <= 10 ? 1000 :
                         pollAttempts.current <= 30 ? 1500 : 2000;
    pollTimer.current = setTimeout(() => pollOnce(tid), nextInterval);
  }, [stopTimer]);

  const startPolling = useCallback((tid: string) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollAttempts.current = 0;
    pollOnce(tid);
  }, [pollOnce]);

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
    startTimer();
    setTaskId(null);
    setAgentRunId(null);

    try {
      const resp = await fetch('/api/agent-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageUrl || '',
          projectId,
          assetParentVersionIds: sourceVersionId ? [sourceVersionId] : [],
          assetProjectionMode: sourceVersionId ? 'revision' : 'derived',
          prompt: prompt.trim(),
          imagePrompt: imagePrompt || '',
          maskDataUrl: '',
          maxRounds,
          model: selectedChatModel.split('::')[1] || '',
          providerId: selectedChatModel.split('::')[0] || '',
          ...getCurrentImageModelInfo(),
        }),
      });

      const data = await resp.json() as Record<string, unknown>;

      if (!resp.ok) {
        throw new Error(translateErrorFrontend(String(data.error || '提交失败')));
      }

      const tid = String(data.taskId || '');
      setAgentRunId(typeof data.runId === 'string' && data.runId ? data.runId : null);
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
        setIsProcessing(false); stopTimer();
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
        await fetch(`/api/agent-edit?taskId=${encodeURIComponent(taskId)}&action=cancel`);
      } catch { /* ignore */ }
    }
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setIsProcessing(false);
    setProgress(0);
    setError('任务已取消');
  };

  const handleAgentRunCancel = async () => {
    await agentRun.cancel();
    if (pollTimer.current) clearTimeout(pollTimer.current);
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
    setIsDraggingState(true);
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
      setIsDraggingState(false);
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
      setIsDraggingState(false);
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
        left: position.x,
        top: position.y,
        width: 320,
        maxHeight: '85vh',
        backgroundColor: bgPanel,
        border: isDraggingState
          ? `2px solid ${accentColor}`
          : `1px solid ${borderColor}`,
        borderRadius: 10,
        boxShadow: isDraggingState
          ? (isMonochrome ? '0 0 24px rgba(37,99,235,0.25), 0 4px 20px rgba(0,0,0,0.1)' : '0 0 24px rgba(212,175,55,0.3), 0 4px 20px rgba(0,0,0,0.5)')
          : (isMonochrome ? '0 4px 20px rgba(0,0,0,0.1)' : '0 4px 20px rgba(0,0,0,0.5)'),
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
        <Zap size={15} style={{ color: accentColor }} />
        <span className="text-base font-semibold flex-1" style={{ color: accentColor }}>
          Agent 编排
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: mutedColor, background: isMonochrome ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)' }}>
          智能工具选择
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="p-1 rounded-md transition-colors"
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
              <p className="text-xs mt-1 truncate" style={{ color: mutedColor }}>
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
              <span className="text-xs">从画布选择图片</span>
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
              <span className="text-xs shrink-0" style={{ color: mutedColor }}>
                {progress}%
              </span>
            </div>
            {progressLabel && (
              <p className="text-xs mt-0.5 truncate" style={{ color: mutedColor }}>
                {progressLabel}
              </p>
            )}
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs" style={{ color: mutedColor }}>
                {isProcessing ? formatTime(elapsed) : (totalTime !== null ? `总耗时 ${formatTime(totalTime)}` : '')}
              </span>
            </div>
          </div>
        )}

        {agentRunId && (
          <div className="px-3 py-1.5" style={{ color: mutedColor }}>
            <AgentProgressTimeline
              projection={agentRun.projection}
              stale={agentRun.stale}
              onCancel={() => { void handleAgentRunCancel(); }}
            />
          </div>
        )}

        {/* 执行步骤 (折叠) */}
        {steps.length > 0 && (
          <div className="px-3">
            <button
              onClick={(e) => { e.stopPropagation(); setStepsExpanded(!stepsExpanded); }}
              className="flex items-center gap-1 text-xs w-full py-1"
              style={{ color: accentDim }}
            >
              {stepsExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              <span>执行步骤 ({steps.length})</span>
            </button>
            {stepsExpanded && (
              <div className="space-y-0.5 pb-1">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-1 text-xs" style={{ color: mutedColor }}>
                    {step.success ? (
                      <CheckCircle2 size={10} className="shrink-0 mt-0.5" style={{ color: '#4caf50' }} />
                    ) : (
                      <XCircle size={10} className="shrink-0 mt-0.5" style={{ color: '#ef5350' }} />
                    )}
                    <span className="flex-1 min-w-0">
                      R{step.round}: {step.toolName}
                      {step.params?.prompt ? (
                        <span className="truncate" style={{ color: accentDim }}> — {String(step.params.prompt).slice(0, 50)}</span>
                      ) : step.detail ? (
                        <span> - {step.detail}</span>
                      ) : null}
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
            <div className="text-xs px-2 py-1.5 rounded flex items-start gap-1.5" style={{ color: '#ef5350', backgroundColor: isMonochrome ? '#fff0f0' : 'rgba(239,83,80,0.1)' }}>
              <XCircle size={10} className="shrink-0 mt-0.5" />
              <span className="flex-1 break-all">{error}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setError(''); }}
                className="shrink-0 p-0.5 hover:opacity-70"
                title="关闭"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 固定底部区域：模型 + 轮次 + 输入框 + 按钮 + 拖拽手柄 */}
      <div className="shrink-0 flex flex-col" style={{ borderTop: `1px solid ${borderColor}` }}>
        {/* 决策模型选择（LLM） */}
        {chatModelOptions.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
            <span className="text-xs shrink-0" style={{ color: mutedColor }}>模型:</span>
            <select
              value={selectedChatModel}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedChatModel(v);
                try { localStorage.setItem('wujie_agent_llm_model', v); } catch { /* ignore */ }
              }}
              className="flex-1 min-w-0 text-xs rounded px-1.5 py-1 border outline-none cursor-pointer"
              style={{ color: textColor, borderColor, background: bgInput }}
              title="Agent 编排的思考模型（LLM）"
            >
              {chatModelOptions.map((m) => (
                <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                  {m.name || m.id}{m.providerName ? ` (${m.providerName})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* 轮次选择 */}
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
          <span className="text-xs" style={{ color: mutedColor }}>轮次:</span>
          {[3, 5, 8].map(r => (
            <button
              key={r}
              onClick={(e) => { e.stopPropagation(); setMaxRounds(r); }}
              className="px-1.5 py-0.5 rounded text-sm transition-colors"
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
        <div className="px-3 pb-1 relative">
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              const val = e.target.value;
              if (val.endsWith('/')) {
                setShowTemplatePopup(true);
                setTemplateSearch('');
                setTemplatePopupIndex(0);
              } else if (showTemplatePopup) {
                const slashIdx = val.lastIndexOf('/');
                if (slashIdx >= 0) {
                  const afterSlash = val.slice(slashIdx + 1);
                  if (!afterSlash.includes(' ') && !afterSlash.includes('\n')) {
                    setTemplateSearch(afterSlash);
                    setTemplatePopupIndex(0);
                  } else {
                    setShowTemplatePopup(false);
                  }
                } else {
                  setShowTemplatePopup(false);
                }
              }
            }}
            onKeyDown={(e) => {
              if (showTemplatePopup && filteredTemplates.length > 0) {
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setTemplatePopupIndex((i) => (i - 1 + filteredTemplates.length) % filteredTemplates.length);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setTemplatePopupIndex((i) => (i + 1) % filteredTemplates.length);
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const tpl = filteredTemplates[templatePopupIndex];
                  if (tpl) {
                    const val = prompt;
                    const slashIdx = val.lastIndexOf('/');
                    const before = val.slice(0, slashIdx);
                    setPrompt(before + tpl.content);
                    setShowTemplatePopup(false);
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowTemplatePopup(false);
                }
              }
            }}
            placeholder="描述你想要的编辑效果... (输入 / 使用模板)"
            className="w-full rounded px-2 py-1.5 text-sm resize-none focus:outline-none"
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
          {showTemplatePopup && filteredTemplates.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 mb-1 max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a1a] shadow-xl z-50">
              {filteredTemplates.slice(0, 20).map((tpl, i) => (
                <button
                  key={tpl.id}
                  onClick={() => {
                    const val = prompt;
                    const slashIdx = val.lastIndexOf('/');
                    const before = val.slice(0, slashIdx);
                    setPrompt(before + tpl.content);
                    setShowTemplatePopup(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-white/5 last:border-0 transition-colors group/tpl relative ${i === templatePopupIndex ? 'bg-[#d4af37]/20 text-white' : 'text-gray-300 hover:bg-white/5'}`}
                >
                  <div className="flex items-center gap-2">
                    {tpl.thumbnail ? (
                      <img src={tpl.thumbnail} alt={tpl.name} className="w-6 h-6 rounded object-cover flex-shrink-0 border border-white/10" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 flex-shrink-0 text-gold-muted/50" />
                    )}
                    <span className="font-medium truncate">{tpl.name}</span>
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-0.5 pl-8">{tpl.content}</div>
                  {tpl.thumbnail && (
                    <div className="absolute left-full ml-2 top-0 z-[60] hidden group-hover/tpl:block">
                      <div className="rounded-lg shadow-2xl overflow-hidden border border-white/10 bg-[#1a1a1a]">
                        <img src={tpl.thumbnail} alt={tpl.name} className="w-36 h-36 object-cover" />
                        <div className="px-2 py-1 text-[10px] truncate text-gold-muted">{tpl.name}</div>
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 执行按钮 */}
        <div className="flex items-center gap-1.5 px-3 pb-1.5">
          {isProcessing ? (
            <button
              onClick={(e) => { e.stopPropagation(); handleCancel(); }}
              className="flex-1 py-1.5 rounded text-sm font-medium transition-colors flex items-center justify-center gap-1"
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
              className="flex-1 py-1.5 rounded text-sm font-medium transition-colors"
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
              className="px-3 py-1.5 rounded text-sm font-medium transition-colors"
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
