'use client';

import React, { useState, useCallback, useRef } from 'react';
import { X, Sparkles, Download, RotateCcw, Loader2, Image as ImageIcon, RefreshCw, ArrowLeft, CheckCircle2, XCircle, Clock } from 'lucide-react';

/* ──────── Preset data ──────── */

const STYLE_PRESETS = [
  { id: 1, name: '大众通用', desc: '圆润可爱，干净高级', prompt: '大众通用表情包美术：圆润可爱但不低幼，干净高级的现代卡通，主体轮廓清晰，柔和粗描边，饱满块面，轻微立体光影，颜色明快但不过饱和，动作夸张但不怪异，白色贴纸外轮廓或干净透明背景，64px缩略图也能看懂，适合微信/LINE/Telegram聊天发送。避免：写实照片、油腻AI质感、复杂背景、廉价儿童泡泡字、暗黑恐怖、赛博朋克、过度二次元、凌乱小装饰、网红土味大字、表情僵硬、同一姿势换字。' },
  { id: 2, name: '漫画风格', desc: '夸张表情，分镜感', prompt: '漫画风格表情包：清晰手绘线条，夸张表情和肢体变形，速度线、冲击线、汗滴、爆炸框、拟声符号适量使用，动作有漫画分镜感，表情冲突更强，画面有笑点但不杂乱，主体仍保持一致且缩略图可读。避免：黑白草稿感、过多网点、复杂分镜框、恐怖猎奇、过度日漫脸、文字占满画面、动作乱到看不懂。' },
  { id: 3, name: '经典贴纸', desc: '厚白边，剪纸感', prompt: '经典贴纸风格：主体像独立贴纸剪纸一样清楚，厚实白边，干净透明背景，简化背景和道具，轮廓强，色块干净，表情动作一眼读懂，整体更轻、更Q、更适合直接作为聊天贴纸上传。避免：复杂场景、背景插画感、过重光影、写实材质、边缘脏、白边不稳定、主体太小、细节太多。' },
  { id: 4, name: '平面设计', desc: '强图形，高对比', prompt: '强烈平面设计风格：高识别度平面图形，强轮廓，明确几何构图，大色块，高对比配色，少量有设计感的阴影或颗粒，画面像精致海报符号但仍是可发送表情，主体造型统一，文字和图形关系强。避免：普通企业插画、信息图表感、复杂渐变、过多装饰纹理、品牌logo误用、主体被设计元素盖住、缺少表情包情绪。' },
  { id: 5, name: '古早QQ风', desc: '怀旧即时通讯味', prompt: '古早QQ聊天风格表情包：怀旧即时通讯表情味道，圆润小图标感，轻微像素/低分辨率边缘趣味，亮晶晶高光，柔和渐变，蓝白聊天软件氛围，夸张但简单的表情，动作直接，符号化汗滴/爱心/星星/感叹号，像早期聊天窗口里会出现的小表情，但保持现代清晰度和可上传质量。避免：直接复制QQ企鹅、QQ官方表情、QQ logo或受保护角色；不要做成真实软件截图，不要过度像素化到看不清，不要脏旧压缩噪点。' },
  { id: 6, name: '自定义', desc: '描述你想要的风格', prompt: '' },
];

const THEME_PRESETS = [
  { id: 1, name: '日常高频', captions: '收到, 谢谢, 好耶, 加油, 不行, 你猜, 无语, 吃瓜, 摸鱼, 开摆, 裂开, 困了, 抱抱, 冲, 哈哈, 晚安' },
  { id: 2, name: '打工摸鱼', captions: '收到, 在忙, 马上, 加班中, 摸鱼, 开会了, 别催, 需求变了, 崩溃, 救命, 下班, 老板来了, 先鸽了, 继续冲, 已读乱回, 周一不想动' },
  { id: 3, name: '阴阳怪气', captions: '你猜, 啊对对对, 就不, 关我啥事, 你说得对, 好棒棒, 笑死, 我不信, 真的假的, 还有这事, 你开心就好, 懂了, 已阅, 退退退, 看戏, 别装' },
  { id: 4, name: '可爱贴贴', captions: '贴贴, 抱抱, 想你, 喜欢, 谢谢你, 辛苦啦, 摸摸头, 不哭, 陪你, 晚安, 早安, 开心, 给你花花, 心动, 充电中, 一起躺' },
  { id: 5, name: '吃喝玩乐', captions: '开吃, 干杯, 好香, 饿了, 吃瓜, 点奶茶, 续命, 出门玩, 躺平, 快乐水, 再来一口, 买它, 排队中, 拍照, 嗨起来, 明天减肥' },
  { id: 6, name: '节日祝福', captions: '早安, 晚安, 新年好, 恭喜发财, 大吉大利, 平安喜乐, 生日快乐, 谢谢, 想你, 祝你好运, 万事顺意, 元气满满, 收红包, 干杯, 团圆啦, 明天更好' },
  { id: 7, name: '自定义', captions: '' },
];

/* ──────── Types ──────── */

interface StickerItem {
  id: number;
  caption: string;
  action: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  imageUrl?: string;
}

interface StickerAssistantPanelProps {
  isMonochrome?: boolean;
  onAddImages?: (urls: string[]) => void;
  currentModel?: string;
  onClose?: () => void;
}

/* ──────── Component ──────── */

export default function StickerAssistantPanel({
  isMonochrome = false,
  onAddImages,
  onClose,
}: StickerAssistantPanelProps) {

  /* ───── Theme tokens (matching image-editor.tsx / infinite-canvas.tsx) ───── */
  const thBg           = isMonochrome ? 'bg-gray-50' : 'bg-[#1a1a1a]';
  const thBgDeep       = isMonochrome ? 'bg-white' : 'bg-[#141414]';
  const thBgHover      = isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#222]';
  const thBgCard       = isMonochrome ? 'bg-white' : 'bg-[#222]';
  const thBgCardHover  = isMonochrome ? 'hover:bg-gray-50' : 'hover:bg-[#2a2a2a]';
  const thBgInput      = isMonochrome ? 'bg-white' : 'bg-[#1e1e1e]';
  const thBgOverlay    = isMonochrome ? 'bg-black/30' : 'bg-black/60';

  const thBorder       = isMonochrome ? 'border-gray-200' : 'border-white/[0.08]';
  const thBorderLight  = isMonochrome ? 'border-gray-100' : 'border-white/[0.06]';
  const thBorderAccent = isMonochrome ? 'border-blue-300' : 'border-[#d4af37]';
  const thBorderFocus  = isMonochrome ? 'focus:border-blue-400' : 'focus:border-[#d4af37]';

  const thText         = isMonochrome ? 'text-gray-800' : 'text-gray-100';
  const thTextSec      = isMonochrome ? 'text-gray-500' : 'text-gray-400';
  const thTextMuted    = isMonochrome ? 'text-gray-400' : 'text-gray-500';
  const thTextDim      = isMonochrome ? 'text-gray-300' : 'text-gray-600';
  const thTextPlaceholder = isMonochrome ? 'placeholder:text-gray-400' : 'placeholder:text-gray-600';

  const thAccent       = isMonochrome ? 'text-blue-600' : 'text-[#d4af37]';
  const thAccentIcon   = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';
  const thAccentBg     = isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]';
  const thAccentBgText = isMonochrome ? 'text-white' : 'text-black';
  const thAccentBgHover= isMonochrome ? 'hover:bg-blue-600' : 'hover:bg-[#e0b840]';
  const thAccentLight  = isMonochrome ? 'bg-blue-50' : 'bg-[#d4af37]/10';
  const thAccentLightText = isMonochrome ? 'text-blue-600' : 'text-[#d4af37]';
  const thAccentBorder = isMonochrome ? 'border-blue-200' : 'border-[#d4af37]/30';
  const thAccentRing   = isMonochrome ? 'ring-blue-500/30' : 'ring-[#d4af37]/30';

  const thShadow       = isMonochrome ? 'shadow-lg shadow-gray-200/50' : 'shadow-2xl shadow-black/50';
  const thDivider      = isMonochrome ? 'divide-gray-100' : 'divide-white/[0.06]';

  /* ───── State ───── */
  const [subject, setSubject] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(1);
  const [customStyle, setCustomStyle] = useState('');
  const [selectedTheme, setSelectedTheme] = useState(1);
  const [customTheme, setCustomTheme] = useState('');
  const [stickerCount, setStickerCount] = useState(16);
  const [step, setStep] = useState<'config' | 'plan' | 'generate'>('config');
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentGenIndex, setCurrentGenIndex] = useState(-1);
  const [error, setError] = useState('');
  const abortRef = useRef(false);

  /* ───── Logic ───── */
  const buildIdentityLock = useCallback((subj: string): string => {
    return `Subject: ${subj}. Core silhouette, colors, and features must stay consistent across all stickers. The subject must be instantly recognizable in every sticker at thumbnail size. Do not change species, main silhouette, main colors, face placement or feature count across the pack.`;
  }, []);

  const buildStickerPrompt = useCallback((item: StickerItem, subj: string, stylePrompt: string): string => {
    return `Create a single square sticker design. ${buildIdentityLock(subj)} Style: ${stylePrompt}. Action: ${item.action}. Caption: "${item.caption}" - integrate text naturally if it improves the sticker, or omit text if the action is clear without it. Format: single 1024x1024 sticker with clean margins, white sticker border or transparent background. The sticker must be readable at small thumbnail size and work as a chat reaction.`;
  }, [buildIdentityLock]);

  const handlePlan = useCallback(async () => {
    if (!subject.trim()) { setError('请输入表情包主题'); return; }
    setIsPlanning(true);
    setError('');
    abortRef.current = false;

    const styleObj = STYLE_PRESETS.find(s => s.id === selectedStyle)!;
    const themeObj = THEME_PRESETS.find(t => t.id === selectedTheme)!;
    const styleDesc = selectedStyle === 6 ? customStyle : styleObj.name;
    const captions = selectedTheme === 7 ? customTheme : themeObj.captions;

    const systemPrompt = `你是一个表情包策划专家。根据用户提供的主题、风格和主题类型，生成一个表情包计划。
返回JSON格式，包含一个items数组，每个元素有：id(序号), caption(简短文案2-5字), action(动作描述，描述主体在做什么，要有画面感和动作感)。
确保每个表情的动作和姿态都有明显差异，不要只是换个文案的同一个姿势。
数量为${stickerCount}个。`;

    const userPrompt = `主题/主体：${subject}
风格：${styleDesc}
主题类型：${selectedTheme === 7 ? customTheme : themeObj.name}
参考文案：${captions}
请生成${stickerCount}个表情的详细计划，每个表情要有独特的动作和姿态。`;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], stream: false }),
      });
      if (!res.ok) throw new Error(`API错误: ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || data.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('无法解析计划，请重试');
      const items = JSON.parse(jsonMatch[0]);
      const plan: StickerItem[] = items.slice(0, stickerCount).map((it: { id?: number; caption?: string; action?: string }, idx: number) => ({
        id: it.id || idx + 1,
        caption: it.caption || '',
        action: it.action || '',
        status: 'pending' as const,
      }));
      setStickers(plan);
      setStep('plan');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '生成计划失败');
    } finally {
      setIsPlanning(false);
    }
  }, [subject, selectedStyle, customStyle, selectedTheme, customTheme, stickerCount, buildIdentityLock]);

  const generateSingleSticker = useCallback(async (item: StickerItem, index: number): Promise<string | null> => {
    const styleObj = STYLE_PRESETS.find(s => s.id === selectedStyle)!;
    const stylePrompt = selectedStyle === 6 ? customStyle : styleObj.prompt;
    const prompt = buildStickerPrompt(item, subject, stylePrompt);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, size: '1024x1024', aspectRatio: '1:1', quality: 'standard', n: 1 }),
      });
      if (!res.ok) throw new Error(`API错误: ${res.status}`);
      const data = await res.json();

      if (data.imageUrls?.length > 0) return data.imageUrls[0];
      if (data.imageUrl) return data.imageUrl;

      if (data.taskIds?.length > 0 || data.taskId) {
        const taskId = data.taskIds?.[0] || data.taskId;
        for (let attempt = 0; attempt < 60; attempt++) {
          if (abortRef.current) return null;
          await new Promise(r => setTimeout(r, 2000));
          const pollRes = await fetch('/api/poll-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId }),
          });
          if (!pollRes.ok) continue;
          const pollData = await pollRes.json();
          if (pollData.status === 'completed' && pollData.imageUrl) return pollData.imageUrl;
          if (pollData.status === 'completed' && pollData.imageUrls?.length > 0) return pollData.imageUrls[0];
          if (pollData.status === 'failed') throw new Error(pollData.error || '生成失败');
        }
        throw new Error('生成超时');
      }
      throw new Error('无返回结果');
    } catch (e: unknown) {
      console.error(`Sticker ${index + 1} generation error:`, e);
      return null;
    }
  }, [selectedStyle, customStyle, subject, buildStickerPrompt]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    abortRef.current = false;
    setError('');
    const completedUrls: string[] = [];

    for (let i = 0; i < stickers.length; i++) {
      if (abortRef.current) break;
      if (stickers[i].status === 'done' && stickers[i].imageUrl) {
        completedUrls.push(stickers[i].imageUrl!);
        continue;
      }
      setCurrentGenIndex(i);
      setStickers(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'generating' as const } : s));
      const url = await generateSingleSticker(stickers[i], i);
      if (url) {
        setStickers(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done' as const, imageUrl: url } : s));
        completedUrls.push(url);
      } else {
        setStickers(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'failed' as const } : s));
      }
    }
    setCurrentGenIndex(-1);
    setIsGenerating(false);
    if (completedUrls.length > 0 && onAddImages) onAddImages(completedUrls);
  }, [stickers, generateSingleSticker, onAddImages]);

  const handleRetryFailed = useCallback(async () => {
    const failedIndices = stickers.map((s, i) => s.status === 'failed' ? i : -1).filter(i => i >= 0);
    if (failedIndices.length === 0) return;
    setIsGenerating(true);
    abortRef.current = false;
    for (const i of failedIndices) {
      if (abortRef.current) break;
      setCurrentGenIndex(i);
      setStickers(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'generating' as const } : s));
      const url = await generateSingleSticker(stickers[i], i);
      if (url) {
        setStickers(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done' as const, imageUrl: url } : s));
      } else {
        setStickers(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'failed' as const } : s));
      }
    }
    setCurrentGenIndex(-1);
    setIsGenerating(false);
  }, [stickers, generateSingleSticker]);

  const handleStop = useCallback(() => { abortRef.current = true; }, []);
  const handleReset = useCallback(() => {
    setStep('config'); setStickers([]); setError('');
    setCurrentGenIndex(-1); setIsGenerating(false); setIsPlanning(false);
    abortRef.current = false;
  }, []);

  const handleDownload = useCallback(async () => {
    const doneStickers = stickers.filter(s => s.status === 'done' && s.imageUrl);
    for (const s of doneStickers) {
      try {
        const response = await fetch(s.imageUrl!);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sticker_${s.id}_${s.caption}.png`;
        a.click();
        URL.revokeObjectURL(url);
      } catch { /* skip */ }
    }
  }, [stickers]);

  const doneCount = stickers.filter(s => s.status === 'done').length;
  const failedCount = stickers.filter(s => s.status === 'failed').length;
  const allDone = stickers.length > 0 && doneCount + failedCount === stickers.length;

  /* ───── Step badge helper ───── */
  const StepBadge = ({ label, active, done: isDone }: { label: string; active: boolean; done?: boolean }) => (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
      active ? `${thAccentBg} ${thAccentBgText}` :
      isDone ? `${thAccentLight} ${thAccentLightText}` :
      `${isMonochrome ? 'bg-gray-100 text-gray-400' : 'bg-white/[0.06] text-gray-500'}`
    }`}>
      {isDone && <CheckCircle2 className="h-3 w-3" />}
      {label}
    </span>
  );

  /* ───── Selectable card helper ───── */
  const SelectCard = ({ selected, onClick, children, className = '' }: {
    selected: boolean; onClick: () => void; children: React.ReactNode; className?: string;
  }) => (
    <button
      onClick={onClick}
      className={`px-3 py-2.5 rounded-lg text-left transition-all duration-150 border cursor-pointer ${
        selected
          ? `${thAccentBorder} ${thAccentLight} ${thAccentLightText} ring-2 ${thAccentRing} font-medium`
          : `${thBgCard} ${thBorder} ${thTextSec} ${thBgCardHover}`
      } ${className}`}
    >
      {children}
    </button>
  );

  /* ───── Status icon ───── */
  const StatusIcon = ({ status }: { status: StickerItem['status'] }) => {
    switch (status) {
      case 'generating': return <Loader2 className={`h-5 w-5 animate-spin ${thAccentIcon}`} />;
      case 'done': return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
      case 'failed': return <XCircle className="h-5 w-5 text-red-400" />;
      default: return <Clock className={`h-5 w-5 ${thTextDim}`} />;
    }
  };

  /* ═══════════════ RENDER ═══════════════ */
  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center ${thBgOverlay}`}
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={`${thBg} rounded-2xl ${thShadow} border ${thBorder} w-[740px] max-h-[88vh] flex flex-col overflow-hidden`}>

        {/* ── Header ── */}
        <div className={`flex items-center justify-between px-5 py-3.5 border-b ${thBorder} ${isMonochrome ? '' : 'bg-[#141414]'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg ${thAccentLight} flex items-center justify-center`}>
              <Sparkles className={`h-4 w-4 ${thAccentIcon}`} />
            </div>
            <div>
              <h2 className={`text-base font-bold ${thText}`}>表情助手</h2>
              <p className={`text-[10px] ${thTextMuted}`}>Zinxtick Sticker Pack Builder</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg ${thBgHover} ${thTextMuted} hover:${thText} transition-colors`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Step indicator ── */}
        <div className={`flex items-center gap-2 px-5 py-2.5 border-b ${thBorderLight} ${isMonochrome ? 'bg-gray-50/80' : 'bg-[#111]'}`}>
          <StepBadge label="1. 配置" active={step === 'config'} done={step !== 'config'} />
          <span className={thTextDim}>→</span>
          <StepBadge label="2. 计划" active={step === 'plan'} done={step === 'generate'} />
          <span className={thTextDim}>→</span>
          <StepBadge label="3. 生成" active={step === 'generate'} />
        </div>

        {/* ── Content ── */}
        <div className={`flex-1 overflow-y-auto p-5 space-y-5 ${isMonochrome ? '' : ''}`}>

          {/* === Step 1: Config === */}
          {step === 'config' && (
            <div className="space-y-5">
              {/* Subject */}
              <div>
                <label className={`text-sm font-medium ${thAccent} mb-2 block`}>表情包主题</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="例如：一只橘猫、可乐罐、小老虎、咖啡杯..."
                  className={`w-full px-4 py-2.5 rounded-lg ${thBgInput} border ${thBorder} ${thText} ${thTextPlaceholder} ${thBorderFocus} focus:outline-none focus:ring-2 ${thAccentRing} transition-all`}
                />
              </div>

              {/* Style */}
              <div>
                <label className={`text-sm font-medium ${thAccent} mb-2 block`}>风格</label>
                <div className="grid grid-cols-3 gap-2">
                  {STYLE_PRESETS.map(s => (
                    <SelectCard key={s.id} selected={selectedStyle === s.id} onClick={() => setSelectedStyle(s.id)}>
                      <div className={`text-sm ${selectedStyle === s.id ? 'font-medium' : ''}`}>{s.name}</div>
                      <div className={`text-[10px] mt-0.5 ${selectedStyle === s.id ? thAccentLightText : thTextMuted}`}>{s.desc}</div>
                    </SelectCard>
                  ))}
                </div>
                {selectedStyle === 6 && (
                  <textarea
                    value={customStyle}
                    onChange={e => setCustomStyle(e.target.value)}
                    placeholder="描述你想要的风格，例如：水彩手绘、像素游戏、低饱和治愈系..."
                    className={`w-full mt-2 px-4 py-2.5 rounded-lg ${thBgInput} border ${thBorder} ${thText} ${thTextPlaceholder} ${thBorderFocus} focus:outline-none text-sm resize-none h-20 transition-all`}
                  />
                )}
              </div>

              {/* Theme */}
              <div>
                <label className={`text-sm font-medium ${thAccent} mb-2 block`}>主题</label>
                <div className="grid grid-cols-4 gap-2">
                  {THEME_PRESETS.map(t => (
                    <SelectCard key={t.id} selected={selectedTheme === t.id} onClick={() => setSelectedTheme(t.id)} className="text-center">
                      <div className={`text-sm ${selectedTheme === t.id ? 'font-medium' : ''}`}>{t.name}</div>
                    </SelectCard>
                  ))}
                </div>
                {selectedTheme === 7 && (
                  <textarea
                    value={customTheme}
                    onChange={e => setCustomTheme(e.target.value)}
                    placeholder="描述你想要的主题和文案，例如：熬夜打游戏的猫猫..."
                    className={`w-full mt-2 px-4 py-2.5 rounded-lg ${thBgInput} border ${thBorder} ${thText} ${thTextPlaceholder} ${thBorderFocus} focus:outline-none text-sm resize-none h-20 transition-all`}
                  />
                )}
                {selectedTheme !== 7 && (
                  <div className={`mt-2 text-xs ${thTextMuted} leading-relaxed`}>
                    预设文案：{THEME_PRESETS.find(t => t.id === selectedTheme)?.captions}
                  </div>
                )}
              </div>

              {/* Count */}
              <div>
                <label className={`text-sm font-medium ${thAccent} mb-2 block`}>数量</label>
                <div className="flex gap-3">
                  {[9, 16].map(n => (
                    <SelectCard key={n} selected={stickerCount === n} onClick={() => setStickerCount(n)}>
                      <span className="text-sm">{n}个{n === 9 ? '（精简版）' : '（完整版）'}</span>
                    </SelectCard>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* === Step 2: Plan === */}
          {step === 'plan' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-medium ${thAccent}`}>表情计划</h3>
                <button
                  onClick={() => setStep('config')}
                  className={`text-xs ${thTextMuted} hover:${thTextSec} transition-colors flex items-center gap-1`}
                >
                  <ArrowLeft className="h-3 w-3" /> 修改配置
                </button>
              </div>
              <div className={`grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto rounded-lg ${thBorder} border`}>
                {stickers.map((s, i) => (
                  <div key={i} className={`${thBgCard} p-3 ${i % 2 === 0 && i < stickers.length - 1 ? '' : ''} ${i < stickers.length - (stickers.length % 2 === 0 ? 2 : 1) ? `border-b ${thBorderLight}` : ''}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-bold ${thAccent}`}>#{s.id}</span>
                      <span className={`text-sm ${thText} font-medium`}>{s.caption}</span>
                    </div>
                    <p className={`text-xs ${thTextMuted} leading-relaxed`}>{s.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* === Step 3: Generate === */}
          {step === 'generate' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-medium ${thAccent}`}>
                  生成进度 {doneCount}/{stickers.length}
                  {failedCount > 0 && <span className="text-red-400 ml-2">({failedCount}失败)</span>}
                </h3>
                <div className="flex items-center gap-2">
                  {failedCount > 0 && !isGenerating && (
                    <button onClick={handleRetryFailed} className={`text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1 cursor-pointer`}>
                      <RefreshCw className="h-3 w-3" /> 重试失败项
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className={`w-full h-1.5 rounded-full ${isMonochrome ? 'bg-gray-200' : 'bg-white/[0.06]'}`}>
                <div
                  className={`h-full rounded-full transition-all duration-300 ${thAccentBg}`}
                  style={{ width: `${stickers.length > 0 ? (doneCount / stickers.length * 100) : 0}%` }}
                />
              </div>

              <div className="grid grid-cols-4 gap-2">
                {stickers.map((s, i) => (
                  <div
                    key={i}
                    className={`rounded-lg overflow-hidden border transition-all duration-200 ${
                      s.status === 'generating' ? `${isMonochrome ? 'border-blue-300' : 'border-[#d4af37]/50'} ring-2 ${thAccentRing}` :
                      s.status === 'done' ? `${isMonochrome ? 'border-emerald-300' : 'border-emerald-500/40'}` :
                      s.status === 'failed' ? 'border-red-400/40' :
                      thBorder
                    }`}
                  >
                    {s.imageUrl ? (
                      <img src={s.imageUrl} alt={s.caption} className="w-full aspect-square object-cover" />
                    ) : (
                      <div className={`w-full aspect-square flex items-center justify-center ${isMonochrome ? 'bg-gray-50' : 'bg-[#1a1a1a]'}`}>
                        <StatusIcon status={s.status} />
                      </div>
                    )}
                    <div className={`px-2 py-1 ${isMonochrome ? 'bg-gray-50' : 'bg-[#111]'}`}>
                      <span className={`text-[10px] ${thTextSec}`}>{s.caption}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className={`text-sm ${isMonochrome ? 'text-red-600 bg-red-50 border border-red-200' : 'text-red-400 bg-red-500/10 border border-red-500/20'} px-3 py-2 rounded-lg`}>
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className={`px-5 py-3.5 border-t ${thBorder} flex items-center justify-between ${isMonochrome ? 'bg-gray-50/50' : 'bg-[#141414]'}`}>
          <div className={`text-xs ${thTextMuted}`}>
            {step === 'config' && '输入主题后点击"生成计划"开始'}
            {step === 'plan' && '确认计划后点击"开始生成"'}
            {step === 'generate' && !allDone && `正在生成 ${doneCount}/${stickers.length}...`}
            {step === 'generate' && allDone && `已完成 ${doneCount}/${stickers.length}`}
          </div>
          <div className="flex items-center gap-2">
            {step !== 'config' && (
              <button
                onClick={handleReset}
                className={`px-3 py-1.5 rounded-lg text-sm ${thTextMuted} ${thBgHover} transition-colors cursor-pointer`}
              >
                <RotateCcw className="h-3.5 w-3.5 inline mr-1" />重新开始
              </button>
            )}

            {step === 'config' && (
              <button
                onClick={handlePlan}
                disabled={isPlanning || !subject.trim()}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${thAccentBg} ${thAccentBgText} ${thAccentBgHover}`}
              >
                {isPlanning ? <><Loader2 className="h-4 w-4 inline mr-1 animate-spin" />规划中...</> : <><Sparkles className="h-4 w-4 inline mr-1" />生成计划</>}
              </button>
            )}

            {step === 'plan' && (
              <button
                onClick={() => { setStep('generate'); handleGenerate(); }}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all duration-150 cursor-pointer ${thAccentBg} ${thAccentBgText} ${thAccentBgHover}`}
              >
                <Sparkles className="h-4 w-4 inline mr-1" />开始生成
              </button>
            )}

            {step === 'generate' && isGenerating && (
              <button
                onClick={handleStop}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/80 text-white hover:bg-red-500 transition-colors cursor-pointer"
              >
                停止
              </button>
            )}

            {step === 'generate' && !isGenerating && doneCount > 0 && (
              <button
                onClick={handleDownload}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${thAccentBg} ${thAccentBgText} ${thAccentBgHover}`}
              >
                <Download className="h-4 w-4 inline mr-1" />下载全部
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
