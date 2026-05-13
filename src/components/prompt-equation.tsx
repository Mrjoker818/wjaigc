'use client';

import React, { useState, useRef, useCallback } from 'react';
import { X, Sparkles, Send, Merge, ChevronDown, ChevronUp, RotateCcw, Check } from 'lucide-react';

/* ─── 方程式字段定义 ─── */
interface EquationField {
    key: string;
    label: string;
    sublabel: string;
    placeholder: string;
    icon: string;
    color: string;   // accent color (gold theme)
}

const EQUATION_FIELDS: EquationField[] = [
    { key: 'subject',    label: '主体',       sublabel: '要画什么，核心元素',  placeholder: '例：一只金色的凤凰、未来城市天际线…',        icon: '🎯', color: '#d4af37' },
    { key: 'scene',      label: '场景/背景',   sublabel: '环境氛围',           placeholder: '例：雪山之巅、赛博朋克街道、星空下…',        icon: '🌄', color: '#7eb8a0' },
    { key: 'composition',label: '构图/视角',   sublabel: '画面布局',           placeholder: '例：仰视广角、居中对称、黄金分割…',          icon: '📐', color: '#8eaadb' },
    { key: 'lighting',   label: '光线/氛围',   sublabel: '光影与氛围',         placeholder: '例：黄昏逆光、丁达尔光效、霓虹灯…',          icon: '💡', color: '#f0c56d' },
    { key: 'style',      label: '风格/媒介',   sublabel: '艺术风格',           placeholder: '例：水彩画、油画、3D渲染、赛博朋克…',        icon: '🎨', color: '#c07eb0' },
    { key: 'details',    label: '细节/修饰',   sublabel: '增加画面细节',       placeholder: '例：精致羽毛纹理、镜面反射、微距细节…',      icon: '🔍', color: '#7dc8e8' },
    { key: 'params',     label: '参数/格式',   sublabel: '输出要求',           placeholder: '例：4K高清、16:9、电影级画质、超写实…',       icon: '⚙️', color: '#999' },
];

type FieldValues = Record<string, string>;

interface PromptEquationProps {
    open: boolean;
    onClose: () => void;
    onSendToPrompt: (text: string) => void;
    /** 当前使用的聊天模型 (providerId::model 或纯 model) */
    chatModel?: string;
    /** 主题风格 */
    isMonochrome?: boolean;
}

/* ─── 合成逻辑 ─── */
function synthesize(fields: FieldValues): string {
    const parts: string[] = [];
    for (const f of EQUATION_FIELDS) {
        const v = (fields[f.key] || '').trim();
        if (!v) continue;
        // 主体直接放，其他类别加前缀
        if (f.key === 'subject') {
            parts.push(v);
        } else {
            parts.push(`${f.label}: ${v}`);
        }
    }
    return parts.join(', ');
}

/* ─── 组件 ─── */
export function PromptEquation({ open, onClose, onSendToPrompt, chatModel, isMonochrome }: PromptEquationProps) {
    const mc = !!isMonochrome;
    const [fields, setFields] = useState<FieldValues>({});
    const [resultText, setResultText] = useState('');
    const [originalText, setOriginalText] = useState('');  // 合成后的原文（优化前）
    const [optimizedText, setOptimizedText] = useState(''); // 优化后文本
    const [useOptimized, setUseOptimized] = useState(false);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({});
    const resultRef = useRef<HTMLTextAreaElement>(null);

    // 更新字段值
    const updateField = useCallback((key: string, value: string) => {
        setFields(prev => ({ ...prev, [key]: value }));
    }, []);

    // 切换字段折叠
    const toggleCollapse = useCallback((key: string) => {
        setCollapsedFields(prev => ({ ...prev, [key]: !prev[key] }));
    }, []);

    // 合成
    const handleSynthesize = useCallback(() => {
        const text = synthesize(fields);
        setResultText(text);
        setOriginalText(text);
        setOptimizedText('');
        setUseOptimized(false);
    }, [fields]);

    // 一键优化
    const handleOptimize = useCallback(async () => {
        if (!resultText.trim()) {
            handleSynthesize();
        }
        const textToOptimize = resultText.trim() || synthesize(fields);
        if (!textToOptimize.trim()) return;

        setIsOptimizing(true);
        try {
            const res = await fetch('/api/optimize-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: textToOptimize,
                    model: chatModel || '',
                    mode: 'enhance',
                    systemPrompt: `你是一个专业的AI图像提示词优化专家。用户会给你一个由"提示词方程式"工具生成的结构化提示词，请将其优化为一段高质量的、可直接用于AI图像生成的英文提示词。

要求：
1. 保留用户原始意图的所有关键元素
2. 优化为自然流畅的英文描述（保留关键词的专业性）
3. 适当增加视觉细节（光影、材质、色调、构图细节）
4. 输出格式：先输出【优化后】英文提示词，再输出【中文翻译】方便用户理解
5. 不要输出多余的解释，只输出提示词内容`,
                }),
            });
            const data = await res.json();
            if (data.success && data.optimized) {
                // 清理思考过程，只保留优化后的关键词
                let cleaned = data.optimized.trim();
                cleaned = cleaned
                    .replace(/<think[\s\S]*?<\/think>/gi, '')
                    .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
                    .replace(/【中文】[\s\S]*$/i, '')
                    .replace(/【English】\s*/i, '')
                    .trim();
                setOptimizedText(cleaned);
                setUseOptimized(false);
                setOriginalText(resultText || textToOptimize);
            } else {
                alert(data.error || '优化失败，请重试');
            }
        } catch (err) {
            console.error('Optimize error:', err);
            alert('优化请求失败，请重试');
        } finally {
            setIsOptimizing(false);
        }
    }, [resultText, fields, chatModel, handleSynthesize]);

    // 发送提示词
    const handleSend = useCallback(() => {
        const finalText = useOptimized && optimizedText ? optimizedText : (resultText || synthesize(fields));
        if (!finalText.trim()) return;
        onSendToPrompt(finalText.trim());
        onClose();
    }, [useOptimized, optimizedText, resultText, fields, onSendToPrompt, onClose, synthesize]);

    // 重置
    const handleReset = useCallback(() => {
        setFields({});
        setResultText('');
        setOriginalText('');
        setOptimizedText('');
        setUseOptimized(false);
    }, []);

    if (!open) return null;

    /* ─── 样式变量 ─── */
    const overlayBg = 'rgba(0,0,0,0.7)';
    const panelBg = mc ? '#ffffff' : '#111111';
    const panelBorder = mc ? '#e0e0e0' : '#2a2a2a';
    const sectionBg = mc ? '#f5f5f5' : '#1a1a1a';
    const textPrimary = mc ? '#1a1a1a' : '#e0e0e0';
    const textSecondary = mc ? '#666' : '#888';
    const inputBg = mc ? '#fff' : '#141414';
    const inputBorder = mc ? '#ddd' : '#2a2a2a';
    const accentColor = mc ? '#333' : '#d4af37';
    const accentBg = mc ? 'rgba(0,0,0,0.05)' : 'rgba(212,175,55,0.08)';
    const accentBorder = mc ? '#ccc' : 'rgba(212,175,55,0.25)';

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ background: overlayBg }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="relative flex flex-col rounded-2xl overflow-hidden shadow-2xl"
                style={{
                    background: panelBg,
                    border: `1px solid ${panelBorder}`,
                    width: 'min(560px, 95vw)',
                    maxHeight: '90vh',
                }}
            >
                {/* ── Header ── */}
                <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${panelBorder}` }}>
                    <div className="flex items-center gap-2.5">
                        <span className="text-lg">⚡</span>
                        <span className="text-base font-bold" style={{ color: textPrimary }}>提示词方程式</span>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: accentBg, color: accentColor, border: `1px solid ${accentBorder}` }}>
                            Prompt Formula
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                        style={{ color: textSecondary }}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* ── 方程式输入区 ── */}
                <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5 custom-scrollbar" style={{ maxHeight: 'calc(90vh - 200px)' }}>
                    {EQUATION_FIELDS.map((f) => {
                        const isCollapsed = collapsedFields[f.key];
                        const hasValue = !!(fields[f.key] || '').trim();
                        return (
                            <div
                                key={f.key}
                                className="rounded-xl overflow-hidden transition-all duration-200"
                                style={{
                                    background: sectionBg,
                                    border: `1px solid ${hasValue ? f.color + '40' : inputBorder}`,
                                }}
                            >
                                {/* 字段标题行 */}
                                <div
                                    className="flex items-center gap-2 px-3.5 py-2 cursor-pointer select-none"
                                    onClick={() => toggleCollapse(f.key)}
                                >
                                    <span className="text-sm">{f.icon}</span>
                                    <span className="text-sm font-semibold" style={{ color: f.color }}>{f.label}</span>
                                    <span className="text-xs" style={{ color: textSecondary }}>{f.sublabel}</span>
                                    {hasValue && (
                                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: f.color }} />
                                    )}
                                    <span className="flex-shrink-0" style={{ color: textSecondary }}>
                                        {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                                    </span>
                                </div>
                                {/* 输入区 */}
                                {!isCollapsed && (
                                    <div className="px-3.5 pb-2.5">
                                        <input
                                            type="text"
                                            value={fields[f.key] || ''}
                                            onChange={(e) => updateField(f.key, e.target.value)}
                                            placeholder={f.placeholder}
                                            className="w-full px-3 py-2 rounded-lg text-sm transition-all focus:outline-none focus:ring-1"
                                            style={{
                                                background: inputBg,
                                                color: textPrimary,
                                                border: `1px solid ${inputBorder}`,
                                            }}
                                            onFocus={(e) => { e.currentTarget.style.borderColor = f.color; e.currentTarget.style.boxShadow = `0 0 0 2px ${f.color}25`; }}
                                            onBlur={(e) => { e.currentTarget.style.borderColor = inputBorder; e.currentTarget.style.boxShadow = 'none'; }}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* ── 合成按钮 ── */}
                    <div className="pt-1.5 pb-1">
                        <button
                            onClick={handleSynthesize}
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-[0.98]"
                            style={{
                                background: mc ? '#1a1a1a' : 'linear-gradient(135deg, #d4af37 0%, #b8942e 100%)',
                                color: mc ? '#fff' : '#111',
                                boxShadow: mc ? 'none' : '0 2px 12px rgba(212,175,55,0.25)',
                            }}
                        >
                            <Merge className="w-4 h-4" />
                            合成提示词
                        </button>
                    </div>

                    {/* ── 结果文本框 ── */}
                    {(resultText || true) && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold" style={{ color: textSecondary }}>合成结果</span>
                                {originalText && optimizedText && (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => setUseOptimized(false)}
                                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                                            style={{
                                                background: !useOptimized ? (mc ? '#1a1a1a' : 'rgba(212,175,55,0.15)') : 'transparent',
                                                color: !useOptimized ? (mc ? '#fff' : '#d4af37') : textSecondary,
                                                border: `1px solid ${!useOptimized ? (mc ? '#333' : '#d4af37') : 'transparent'}`,
                                            }}
                                        >
                                            <Check className="w-3 h-3" /> 原版
                                        </button>
                                        <button
                                            onClick={() => setUseOptimized(true)}
                                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                                            style={{
                                                background: useOptimized ? (mc ? '#1a1a1a' : 'rgba(212,175,55,0.15)') : 'transparent',
                                                color: useOptimized ? (mc ? '#fff' : '#d4af37') : textSecondary,
                                                border: `1px solid ${useOptimized ? (mc ? '#333' : '#d4af37') : 'transparent'}`,
                                            }}
                                        >
                                            <Sparkles className="w-3 h-3" /> 优化版
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* 对比展示区：优化前 vs 优化后 */}
                            {originalText && optimizedText && (
                                <div className="space-y-1.5">
                                    {/* 优化前 */}
                                    <div
                                        className={`rounded-lg p-2.5 cursor-pointer transition-all ${!useOptimized ? 'ring-1' : 'opacity-60'}`}
                                        style={{
                                            background: mc ? '#fafafa' : '#0d0d0d',
                                            border: `1px solid ${inputBorder}`,
                                            ...( !useOptimized ? { ringColor: textSecondary } : {} ),
                                        }}
                                        onClick={() => setUseOptimized(false)}
                                    >
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                            {!useOptimized ? (
                                                <Check className="w-3 h-3" style={{ color: accentColor }} />
                                            ) : (
                                                <span className="w-3 h-3 rounded-full border" style={{ borderColor: textSecondary }} />
                                            )}
                                            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: !useOptimized ? accentColor : textSecondary }}>原始提示词</span>
                                        </div>
                                        <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: textPrimary }}>{originalText}</p>
                                    </div>
                                    {/* 优化后 */}
                                    <div
                                        className={`rounded-lg p-2.5 cursor-pointer transition-all ${useOptimized ? 'ring-1' : 'opacity-60'}`}
                                        style={{
                                            background: mc ? '#fafafa' : '#0d0d0d',
                                            border: `1px solid ${accentBorder}`,
                                            ...( useOptimized ? { ringColor: accentColor } : {} ),
                                        }}
                                        onClick={() => setUseOptimized(true)}
                                    >
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                            {useOptimized ? (
                                                <Check className="w-3 h-3" style={{ color: accentColor }} />
                                            ) : (
                                                <span className="w-3 h-3 rounded-full border" style={{ borderColor: textSecondary }} />
                                            )}
                                            <Sparkles className="w-3 h-3" style={{ color: useOptimized ? accentColor : textSecondary }} />
                                            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: useOptimized ? accentColor : textSecondary }}>优化后提示词</span>
                                        </div>
                                        <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: textPrimary }}>{optimizedText}</p>
                                    </div>
                                </div>
                            )}

                            {/* 可编辑的结果文本框 */}
                            <textarea
                                ref={resultRef}
                                value={useOptimized && optimizedText ? optimizedText : resultText}
                                onChange={(e) => {
                                    if (useOptimized && optimizedText) {
                                        setOptimizedText(e.target.value);
                                    } else {
                                        setResultText(e.target.value);
                                    }
                                }}
                                placeholder="点击「合成提示词」将上方内容整合到这里，或直接输入..."
                                rows={4}
                                className="w-full px-3 py-2.5 rounded-lg text-sm leading-relaxed resize-y focus:outline-none focus:ring-1 custom-scrollbar"
                                style={{
                                    background: inputBg,
                                    color: textPrimary,
                                    border: `1px solid ${inputBorder}`,
                                    minHeight: 80,
                                    maxHeight: 200,
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.boxShadow = `0 0 0 2px ${accentColor}25`; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = inputBorder; e.currentTarget.style.boxShadow = 'none'; }}
                            />
                        </div>
                    )}
                </div>

                {/* ── 底部操作栏 ── */}
                <div className="flex items-center gap-2 px-5 py-3" style={{ borderTop: `1px solid ${panelBorder}` }}>
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                        style={{ color: textSecondary, border: `1px solid ${inputBorder}` }}
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        重置
                    </button>
                    <div className="flex-1" />
                    <button
                        onClick={handleOptimize}
                        disabled={isOptimizing || (!resultText.trim() && !synthesize(fields).trim())}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 active:scale-[0.97]"
                        style={{
                            background: mc ? 'rgba(0,0,0,0.06)' : 'rgba(212,175,55,0.1)',
                            color: mc ? '#333' : '#d4af37',
                            border: `1px solid ${mc ? '#ddd' : 'rgba(212,175,55,0.3)'}`,
                        }}
                    >
                        <Sparkles className={`w-3.5 h-3.5 ${isOptimizing ? 'animate-pulse' : ''}`} />
                        {isOptimizing ? '优化中...' : '一键优化'}
                    </button>
                    <button
                        onClick={handleSend}
                        disabled={!resultText.trim() && !synthesize(fields).trim() && !(useOptimized && optimizedText.trim())}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 active:scale-[0.97]"
                        style={{
                            background: mc ? '#1a1a1a' : 'linear-gradient(135deg, #d4af37 0%, #b8942e 100%)',
                            color: mc ? '#fff' : '#111',
                        }}
                    >
                        <Send className="w-3.5 h-3.5" />
                        发送提示词
                    </button>
                </div>
            </div>
        </div>
    );
}
