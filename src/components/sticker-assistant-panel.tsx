'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, ChevronDown, ChevronUp, Sparkles, Download, RotateCcw, Loader2, Check, Image as ImageIcon, RefreshCw } from 'lucide-react';

/* ──────── Preset data ──────── */

const STYLE_PRESETS = [
  { id: 1, name: '大众通用', nameEn: 'Mainstream cartoon', desc: '圆润可爱，干净高级的现代卡通', prompt: '大众通用表情包美术：圆润可爱但不低幼，干净高级的现代卡通，主体轮廓清晰，柔和粗描边，饱满块面，轻微立体光影，颜色明快但不过饱和，动作夸张但不怪异，白色贴纸外轮廓或干净透明背景，64px缩略图也能看懂，适合微信/LINE/Telegram聊天发送。避免：写实照片、油腻AI质感、复杂背景、廉价儿童泡泡字、暗黑恐怖、赛博朋克、过度二次元、凌乱小装饰、网红土味大字、表情僵硬、同一姿势换字。' },
  { id: 2, name: '漫画风格', nameEn: 'Comic', desc: '夸张表情，漫画分镜感', prompt: '漫画风格表情包：清晰手绘线条，夸张表情和肢体变形，速度线、冲击线、汗滴、爆炸框、拟声符号适量使用，动作有漫画分镜感，表情冲突更强，画面有笑点但不杂乱，主体仍保持一致且缩略图可读。避免：黑白草稿感、过多网点、复杂分镜框、恐怖猎奇、过度日漫脸、文字占满画面、动作乱到看不懂。' },
  { id: 3, name: '经典贴纸', nameEn: 'Classic sticker', desc: '厚白边，干净剪纸感', prompt: '经典贴纸风格：主体像独立贴纸剪纸一样清楚，厚实白边，干净透明背景，简化背景和道具，轮廓强，色块干净，表情动作一眼读懂，整体更轻、更Q、更适合直接作为聊天贴纸上传。避免：复杂场景、背景插画感、过重光影、写实材质、边缘脏、白边不稳定、主体太小、细节太多。' },
  { id: 4, name: '平面设计', nameEn: 'Bold graphic design', desc: '强烈图形，高对比色块', prompt: '强烈平面设计风格：高识别度平面图形，强轮廓，明确几何构图，大色块，高对比配色，少量有设计感的阴影或颗粒，画面像精致海报符号但仍是可发送表情，主体造型统一，文字和图形关系强。避免：普通企业插画、信息图表感、复杂渐变、过多装饰纹理、品牌logo误用、主体被设计元素盖住、缺少表情包情绪。' },
  { id: 5, name: '古早QQ风', nameEn: 'Retro early-chat', desc: '怀旧即时通讯表情味', prompt: '古早QQ聊天风格表情包：怀旧即时通讯表情味道，圆润小图标感，轻微像素/低分辨率边缘趣味，亮晶晶高光，柔和渐变，蓝白聊天软件氛围，夸张但简单的表情，动作直接，符号化汗滴/爱心/星星/感叹号，像早期聊天窗口里会出现的小表情，但保持现代清晰度和可上传质量。避免：直接复制QQ企鹅、QQ官方表情、QQ logo或受保护角色；不要做成真实软件截图，不要过度像素化到看不清，不要脏旧压缩噪点。' },
  { id: 6, name: '自定义', nameEn: 'Custom', desc: '描述你想要的风格', prompt: '' },
];

const THEME_PRESETS = [
  { id: 1, name: '日常高频', nameEn: 'Everyday reactions', captions: '收到, 谢谢, 好耶, 加油, 不行, 你猜, 无语, 吃瓜, 摸鱼, 开摆, 裂开, 困了, 抱抱, 冲, 哈哈, 晚安' },
  { id: 2, name: '打工摸鱼', nameEn: 'Work and procrastination', captions: '收到, 在忙, 马上, 加班中, 摸鱼, 开会了, 别催, 需求变了, 崩溃, 救命, 下班, 老板来了, 先鸽了, 继续冲, 已读乱回, 周一不想动' },
  { id: 3, name: '阴阳怪气', nameEn: 'Playful sarcasm', captions: '你猜, 啊对对对, 就不, 关我啥事, 你说得对, 好棒棒, 笑死, 我不信, 真的假的, 还有这事, 你开心就好, 懂了, 已阅, 退退退, 看戏, 别装' },
  { id: 4, name: '可爱贴贴', nameEn: 'Cute and affectionate', captions: '贴贴, 抱抱, 想你, 喜欢, 谢谢你, 辛苦啦, 摸摸头, 不哭, 陪你, 晚安, 早安, 开心, 给你花花, 心动, 充电中, 一起躺' },
  { id: 5, name: '吃喝玩乐', nameEn: 'Food, drinks, and fun', captions: '开吃, 干杯, 好香, 饿了, 吃瓜, 点奶茶, 续命, 出门玩, 躺平, 快乐水, 再来一口, 买它, 排队中, 拍照, 嗨起来, 明天减肥' },
  { id: 6, name: '节日祝福', nameEn: 'Greetings and holidays', captions: '早安, 晚安, 新年好, 恭喜发财, 大吉大利, 平安喜乐, 生日快乐, 谢谢, 想你, 祝你好运, 万事顺意, 元气满满, 收红包, 干杯, 团圆啦, 明天更好' },
  { id: 7, name: '自定义', nameEn: 'Custom', captions: '' },
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
  // Theme colors
  const accent = isMonochrome ? 'text-blue-400' : 'text-gold';
  const accentBg = isMonochrome ? 'bg-blue-500' : 'bg-gold';
  const accentBgHover = isMonochrome ? 'hover:bg-blue-500/20' : 'hover:bg-gold/20';
  const accentBorder = isMonochrome ? 'border-blue-500/50' : 'border-gold/50';
  const accentRing = isMonochrome ? 'ring-blue-500/50' : 'ring-gold/50';
  const panelBg = isMonochrome ? 'bg-[#111]' : 'bg-[#1a1a1a]';
  const cardBg = isMonochrome ? 'bg-[#1a1a1a]' : 'bg-[#222]';

  // State
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

  // Build subject identity
  const buildIdentityLock = useCallback((subj: string): string => {
    return `Subject: ${subj}. Core silhouette, colors, and features must stay consistent across all stickers. The subject must be instantly recognizable in every sticker at thumbnail size. Do not change species, main silhouette, main colors, face placement or feature count across the pack.`;
  }, []);

  // Build generation prompt for a single sticker
  const buildStickerPrompt = useCallback((item: StickerItem, subj: string, stylePrompt: string): string => {
    return `Create a single square sticker design. ${buildIdentityLock(subj)} Style: ${stylePrompt}. Action: ${item.action}. Caption: "${item.caption}" - integrate text naturally if it improves the sticker, or omit text if the action is clear without it. Format: single 512x512 sticker with clean margins, white sticker border or transparent background. The sticker must be readable at small thumbnail size and work as a chat reaction.`;
  }, [buildIdentityLock]);

  // Generate plan using chat API
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
      // Parse JSON from response
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

  // Generate a single sticker image
  const generateSingleSticker = useCallback(async (item: StickerItem, index: number): Promise<string | null> => {
    const styleObj = STYLE_PRESETS.find(s => s.id === selectedStyle)!;
    const stylePrompt = selectedStyle === 6 ? customStyle : styleObj.prompt;
    const prompt = buildStickerPrompt(item, subject, stylePrompt);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          size: '1024x1024',
          aspectRatio: '1:1',
          quality: 'standard',
          n: 1,
        }),
      });
      if (!res.ok) throw new Error(`API错误: ${res.status}`);
      const data = await res.json();

      // Handle direct image URLs
      if (data.imageUrls?.length > 0) return data.imageUrls[0];
      if (data.imageUrl) return data.imageUrl;

      // Handle task-based (polling)
      if (data.taskIds?.length > 0 || data.taskId) {
        const taskId = data.taskIds?.[0] || data.taskId;
        // Poll for result
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

  // Generate all stickers sequentially
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

    if (completedUrls.length > 0 && onAddImages) {
      onAddImages(completedUrls);
    }
  }, [stickers, generateSingleSticker, onAddImages]);

  // Retry failed stickers
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

  // Stop generation
  const handleStop = useCallback(() => { abortRef.current = true; }, []);

  // Reset
  const handleReset = useCallback(() => {
    setStep('config');
    setStickers([]);
    setError('');
    setCurrentGenIndex(-1);
    setIsGenerating(false);
    setIsPlanning(false);
    abortRef.current = false;
  }, []);

  // Download all stickers
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

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center bg-black/70`}
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={`${panelBg} rounded-2xl shadow-2xl border ${isMonochrome ? 'border-blue-500/20' : 'border-gold/20'} w-[720px] max-h-[85vh] flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-3 border-b ${isMonochrome ? 'border-blue-500/10' : 'border-gold/10'}`}>
          <div className="flex items-center gap-2">
            <span className={`text-lg font-bold ${accent}`}>表情助手</span>
            <span className="text-xs text-[#888]">Zinxtick Sticker Pack Builder</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-[#888] hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-xs">
            {(['config', 'plan', 'generate'] as const).map((s, i) => (
              <React.Fragment key={s}>
                <span className={`px-2 py-0.5 rounded-full ${step === s ? `${accentBg} text-black font-bold` : 'bg-[#333] text-[#888]'}`}>
                  {i + 1}. {s === 'config' ? '配置' : s === 'plan' ? '计划' : '生成'}
                </span>
                {i < 2 && <span className="text-[#555]">→</span>}
              </React.Fragment>
            ))}
          </div>

          {/* Step 1: Config */}
          {step === 'config' && (
            <div className="space-y-4">
              {/* Subject input */}
              <div>
                <label className={`text-sm font-medium ${accent} mb-1.5 block`}>表情包主题</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="例如：一只橘猫、可乐罐、小老虎、咖啡杯..."
                  className={`w-full px-4 py-2.5 rounded-lg ${cardBg} border ${isMonochrome ? 'border-blue-500/20 focus:border-blue-500/50' : 'border-gold/20 focus:border-gold/50'} text-white placeholder:text-[#666] focus:outline-none transition-colors`}
                />
              </div>

              {/* Style presets */}
              <div>
                <label className={`text-sm font-medium ${accent} mb-1.5 block`}>风格</label>
                <div className="grid grid-cols-3 gap-2">
                  {STYLE_PRESETS.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStyle(s.id)}
                      className={`px-3 py-2 rounded-lg text-left transition-all border ${
                        selectedStyle === s.id
                          ? `${accentBorder} ${accentBg} text-black font-bold ring-2 ${accentRing}`
                          : `${cardBg} border-[#333] text-[#ccc] ${accentBgHover}`
                      }`}
                    >
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className="text-[10px] text-[#999] mt-0.5">{s.desc}</div>
                    </button>
                  ))}
                </div>
                {selectedStyle === 6 && (
                  <textarea
                    value={customStyle}
                    onChange={e => setCustomStyle(e.target.value)}
                    placeholder="描述你想要的风格，例如：水彩手绘、像素游戏、低饱和治愈系..."
                    className={`w-full mt-2 px-4 py-2.5 rounded-lg ${cardBg} border ${isMonochrome ? 'border-blue-500/20' : 'border-gold/20'} text-white placeholder:text-[#666] focus:outline-none text-sm resize-none h-20`}
                  />
                )}
              </div>

              {/* Theme presets */}
              <div>
                <label className={`text-sm font-medium ${accent} mb-1.5 block`}>主题</label>
                <div className="grid grid-cols-4 gap-2">
                  {THEME_PRESETS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTheme(t.id)}
                      className={`px-3 py-2 rounded-lg text-center transition-all border ${
                        selectedTheme === t.id
                          ? `${accentBorder} ${accentBg} text-black font-bold ring-2 ${accentRing}`
                          : `${cardBg} border-[#333] text-[#ccc] ${accentBgHover}`
                      }`}
                    >
                      <div className="text-sm">{t.name}</div>
                    </button>
                  ))}
                </div>
                {selectedTheme === 7 && (
                  <textarea
                    value={customTheme}
                    onChange={e => setCustomTheme(e.target.value)}
                    placeholder="描述你想要的主题和文案，例如：熬夜打游戏的猫猫，文案包括我能赢、再来一把、困死了..."
                    className={`w-full mt-2 px-4 py-2.5 rounded-lg ${cardBg} border ${isMonochrome ? 'border-blue-500/20' : 'border-gold/20'} text-white placeholder:text-[#666] focus:outline-none text-sm resize-none h-20`}
                  />
                )}
                {selectedTheme !== 7 && (
                  <div className="mt-2 text-xs text-[#888] leading-relaxed">
                    预设文案：{THEME_PRESETS.find(t => t.id === selectedTheme)?.captions}
                  </div>
                )}
              </div>

              {/* Count */}
              <div>
                <label className={`text-sm font-medium ${accent} mb-1.5 block`}>数量</label>
                <div className="flex gap-3">
                  {[9, 16].map(n => (
                    <button
                      key={n}
                      onClick={() => setStickerCount(n)}
                      className={`px-4 py-2 rounded-lg transition-all border ${
                        stickerCount === n
                          ? `${accentBorder} ${accentBg} text-black font-bold`
                          : `${cardBg} border-[#333] text-[#ccc] ${accentBgHover}`
                      }`}
                    >
                      {n}个{n === 9 ? '（精简版）' : '（完整版）'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Plan */}
          {step === 'plan' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-medium ${accent}`}>表情计划</h3>
                <button onClick={() => setStep('config')} className="text-xs text-[#888] hover:text-white transition-colors">
                  ← 修改配置
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto">
                {stickers.map((s, i) => (
                  <div key={i} className={`${cardBg} rounded-lg p-3 border border-[#333]`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-bold ${accent}`}>#{s.id}</span>
                      <span className="text-sm text-white font-medium">{s.caption}</span>
                    </div>
                    <p className="text-xs text-[#999] leading-relaxed">{s.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Generate */}
          {step === 'generate' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-medium ${accent}`}>
                  生成进度 {doneCount}/{stickers.length}
                  {failedCount > 0 && <span className="text-red-400 ml-2">({failedCount}失败)</span>}
                </h3>
                <div className="flex items-center gap-2">
                  {failedCount > 0 && !isGenerating && (
                    <button onClick={handleRetryFailed} className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1">
                      <RefreshCw className="h-3 w-3" /> 重试失败项
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {stickers.map((s, i) => (
                  <div key={i} className={`rounded-lg overflow-hidden border ${
                    s.status === 'generating' ? 'border-yellow-500/50' :
                    s.status === 'done' ? isMonochrome ? 'border-blue-500/50' : 'border-gold/50' :
                    s.status === 'failed' ? 'border-red-500/50' : 'border-[#333]'
                  }`}>
                    {s.imageUrl ? (
                      <img src={s.imageUrl} alt={s.caption} className="w-full aspect-square object-cover" />
                    ) : (
                      <div className="w-full aspect-square flex items-center justify-center bg-[#1a1a1a]">
                        {s.status === 'generating' && <Loader2 className="h-6 w-6 text-yellow-500 animate-spin" />}
                        {s.status === 'pending' && <ImageIcon className="h-6 w-6 text-[#444]" />}
                        {s.status === 'failed' && <X className="h-6 w-6 text-red-500" />}
                      </div>
                    )}
                    <div className="px-2 py-1 bg-[#111]">
                      <span className="text-[10px] text-[#ccc]">{s.caption}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-3 border-t ${isMonochrome ? 'border-blue-500/10' : 'border-gold/10'} flex items-center justify-between`}>
          <div className="text-xs text-[#666]">
            {step === 'config' && '输入主题后点击"生成计划"开始'}
            {step === 'plan' && '确认计划后点击"开始生成"'}
            {step === 'generate' && `已完成 ${doneCount}/${stickers.length}`}
          </div>
          <div className="flex items-center gap-2">
            {step !== 'config' && (
              <button
                onClick={handleReset}
                className="px-3 py-1.5 rounded-lg text-sm text-[#888] hover:text-white hover:bg-white/10 transition-colors"
              >
                <RotateCcw className="h-4 w-4 inline mr-1" />重新开始
              </button>
            )}

            {step === 'config' && (
              <button
                onClick={handlePlan}
                disabled={isPlanning || !subject.trim()}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${accentBg} text-black hover:opacity-90`}
              >
                {isPlanning ? <><Loader2 className="h-4 w-4 inline mr-1 animate-spin" />规划中...</> : <><Sparkles className="h-4 w-4 inline mr-1" />生成计划</>}
              </button>
            )}

            {step === 'plan' && (
              <button
                onClick={() => { setStep('generate'); handleGenerate(); }}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${accentBg} text-black hover:opacity-90`}
              >
                <Sparkles className="h-4 w-4 inline mr-1" />开始生成
              </button>
            )}

            {step === 'generate' && isGenerating && (
              <button
                onClick={handleStop}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                停止
              </button>
            )}

            {step === 'generate' && !isGenerating && doneCount > 0 && (
              <button
                onClick={handleDownload}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${accentBg} text-black hover:opacity-90`}
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
