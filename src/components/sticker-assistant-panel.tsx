'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GripVertical, X, Minus, Sparkles, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Download, ChevronRight, Smile, Upload, ImagePlus, Archive } from 'lucide-react';
import JSZip from 'jszip';
import { getModelDisplayName } from '@/lib/model-name-map';


/* ──────────────────── 主题色 ──────────────────── */
const themes = {
  gold: {
    panelBg: '#1a1a1a',
    deepBg: '#141414',
    cardBg: '#222',
    inputBg: '#1e1e1e',
    border: 'rgba(255,255,255,0.08)',
    accent: '#d4af37',
    accentHover: '#e0be4a',
    accentBg: 'rgba(212,175,55,0.10)',
    text: '#e5e5e5',
    textSub: '#a3a3a3',
    textDim: '#737373',
    shadow: '0 8px 32px rgba(0,0,0,0.5)',
    headerGrad: 'linear-gradient(135deg, #222 0%, #1a1a1a 100%)',
    btnClose: '#ef4444',
  },
  mono: {
    panelBg: '#ffffff',
    deepBg: '#f9fafb',
    cardBg: '#ffffff',
    inputBg: '#ffffff',
    border: '#e5e7eb',
    accent: '#2563eb',
    accentHover: '#1d4ed8',
    accentBg: 'rgba(37,99,235,0.06)',
    text: '#1f2937',
    textSub: '#6b7280',
    textDim: '#9ca3af',
    shadow: '0 8px 32px rgba(0,0,0,0.08)',
    headerGrad: 'linear-gradient(135deg, #f3f4f6 0%, #ffffff 100%)',
    btnClose: '#dc2626',
  },
} as const;

type ThemeKey = keyof typeof themes;

/* ──────────────────── 数据类型 ──────────────────── */
interface StickerItem {
  id: number;
  caption: string;
  action: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  imageUrl?: string;
  error?: string;
}

interface StylePreset {
  key: string;
  label: string;
  icon: string;
  positivePrompt: string;
  negativePrompt: string;
}

interface ThemePreset {
  key: string;
  label: string;
  icon: string;
  captions: string[];
  mood: string;
}

interface ModelOption {
  id: string;
  providerId: string;
  providerName: string;
  displayLabel?: string;
}

/* ──────────────────── 预设数据 (from Zinxtick) ──────────────────── */
const STYLE_PRESETS: StylePreset[] = [
  {
    key: 'general',
    label: '大众通用',
    icon: '😊',
    positivePrompt: 'cute cartoon sticker, thick outlines, vivid solid colors, flat shading, transparent background, sticker art style, expressive pose, chibi proportions, die-cut sticker',
    negativePrompt: 'photorealistic, 3d render, complex details, gradient, realistic texture, blurry, low quality, watermark, text, solid background, white background',
  },
  {
    key: 'comic',
    label: '漫画风格',
    icon: '💥',
    positivePrompt: 'manga style sticker, screen tones, bold ink outlines, dynamic action lines, monochrome with spot color, speech bubble elements, dramatic expression, comic panel feel, transparent background, die-cut sticker',
    negativePrompt: 'photorealistic, watercolor, pastel, gradient, realistic shading, blurry, low quality, watermark, solid background, white background',
  },
  {
    key: 'classic',
    label: '经典贴纸',
    icon: '⭐',
    positivePrompt: 'die-cut sticker style, clean vector outline, solid bold colors, transparent background, whimsical character design, rounded shapes, professional sticker production, no background',
    negativePrompt: 'photorealistic, 3d, solid background, gradient, messy lines, blurry, low quality, watermark, photo, white background',
  },
  {
    key: 'flat',
    label: '平面设计',
    icon: '🎨',
    positivePrompt: 'flat design sticker, minimal geometric shapes, limited color palette, clean vector art, bold solid fills, no shadows, modern graphic style, simple silhouettes, transparent background, die-cut sticker',
    negativePrompt: 'realistic, 3d, gradient, texture, complex details, watercolor, photorealistic, blurry, solid background, white background',
  },
  {
    key: 'retro',
    label: '古早QQ风',
    icon: '🐧',
    positivePrompt: 'early 2000s Chinese QQ sticker style, pixel-art influenced, simple round body, big head small body, bright saturated colors, cute kawaii expression, retro digital feel, simple gif-style pose, transparent background',
    negativePrompt: 'photorealistic, 3d render, complex shading, realistic, modern minimalist, gradient, solid background, white background',
  },
  {
    key: 'custom',
    label: '自定义',
    icon: '✏️',
    positivePrompt: '',
    negativePrompt: '',
  },
];

const THEME_PRESETS: ThemePreset[] = [
  { key: 'everyday', label: '日常高频', icon: '💬', captions: ['收到','谢谢','好耶','加油','不行','你猜','无语','吃瓜','摸鱼','开摆','裂开','困了','抱抱','冲','哈哈','晚安'], mood: '日常实用、友好亲切' },
  { key: 'work', label: '打工摸鱼', icon: '💼', captions: ['收到','在忙','马上','加班中','摸鱼','开会了','别催','需求变了','崩溃','救命','下班','老板来了','先鸽了','继续冲','已读乱回','周一不想动'], mood: '疲惫搞笑、社交解压' },
  { key: 'sarcastic', label: '阴阳怪气', icon: '😏', captions: ['你猜','啊对对对','就不','关我啥事','你说得对','好棒棒','笑死','我不信','真的假的','还有这事','你开心就好','懂了','已阅','退退退','看戏','别装'], mood: '傲娇吐槽、俏皮搞笑' },
  { key: 'cute', label: '可爱贴贴', icon: '💕', captions: ['贴贴','抱抱','想你','喜欢','谢谢你','辛苦啦','摸摸头','不哭','陪你','晚安','早安','开心','给你花花','心动','充电中','一起躺'], mood: '温暖治愈、软萌贴心' },
  { key: 'food', label: '吃喝玩乐', icon: '🍜', captions: ['开吃','干杯','好香','饿了','吃瓜','点奶茶','续命','出门玩','躺平','快乐水','再来一口','买它','排队中','拍照','嗨起来','明天减肥'], mood: '热闹感官、快乐吃喝' },
  { key: 'holiday', label: '节日祝福', icon: '🎉', captions: ['早安','晚安','新年好','恭喜发财','大吉大利','平安喜乐','生日快乐','谢谢','想你','祝你好运','万事顺意','元气满满','收红包','干杯','团圆啦','明天更好'], mood: '积极温暖、吉祥如意' },
  { key: 'custom', label: '自定义', icon: '✏️', captions: [], mood: '' },
];

/* ──────────────────── Props ──────────────────── */
interface StickerAssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  isMonochrome?: boolean;
  onAddImages?: (urls: string[]) => void;
}

/* ──────────────────── 白色/浅色背景移除（确保透明PNG） ──────────────────── */
async function removeBackgroundToTransparent(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const { width, height } = img;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        const { data } = imageData;

        // 1. 采样四边像素，计算背景色（取最常见的浅色）
        const edgeSamples: number[] = [];
        const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 50));
        for (let x = 0; x < width; x += sampleStep) {
          edgeSamples.push(x, 0); edgeSamples.push(x, height - 1);
        }
        for (let y = 0; y < height; y += sampleStep) {
          edgeSamples.push(0, y); edgeSamples.push(width - 1, y);
        }
        // 计算四边平均色作为背景色
        let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
        for (let i = 0; i < edgeSamples.length; i += 2) {
          const px = edgeSamples[i], py = edgeSamples[i + 1];
          const idx = (py * width + px) * 4;
          if (data[idx + 3] < 128) continue; // 跳过已透明像素
          bgR += data[idx]; bgG += data[idx + 1]; bgB += data[idx + 2]; bgCount++;
        }
        if (bgCount === 0) { resolve(null); return; }
        bgR = Math.round(bgR / bgCount);
        bgG = Math.round(bgG / bgCount);
        bgB = Math.round(bgB / bgCount);

        // 2. 只处理浅色背景（亮度>200），避免误删深色内容
        const bgBrightness = (bgR * 299 + bgG * 587 + bgB * 114) / 1000;
        if (bgBrightness < 180) { resolve(null); return; }

        // 3. 遍历像素，将接近背景色的像素设为透明
        const tolerance = 35; // 颜色容差
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue; // 已透明跳过
          const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
          if (dist < tolerance) {
            // 完全透明
            data[i + 3] = 0;
          } else if (dist < tolerance * 2) {
            // 边缘羽化：平滑过渡
            const alpha = Math.round(((dist - tolerance) / tolerance) * 255);
            data[i + 3] = Math.min(a, alpha);
          }
        }

        ctx.putImageData(imageData, 0, 0);

        // 4. 检查是否有实际变化（至少 5% 像素变透明）
        let transparentCount = 0;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 128) transparentCount++;
        }
        const transparentRatio = transparentCount / (width * height);
        if (transparentRatio < 0.05) { resolve(null); return; } // 变化太少，说明本来就是透明的

        // 5. 导出为 PNG data URL 并通过 save-image 持久化
        canvas.toBlob(async (blob) => {
          if (!blob) { resolve(null); return; }
          try {
            const formData = new FormData();
            formData.append('file', blob, 'sticker-transparent.png');
            const res = await fetch('/api/save-image', { method: 'POST', body: formData });
            if (res.ok) {
              const result = await res.json();
              resolve(result.url || null);
            } else {
              // 回退：使用 data URL
              resolve(canvas.toDataURL('image/png'));
            }
          } catch {
            resolve(canvas.toDataURL('image/png'));
          }
        }, 'image/png');
      };
      img.onerror = () => resolve(null);
      img.src = imageUrl;
    } catch {
      resolve(null);
    }
  });
}

/* ──────────────────── 组件 ──────────────────── */
export default function StickerAssistantPanel({
  isOpen,
  onClose,
  isMonochrome = false,
  onAddImages,
}: StickerAssistantPanelProps) {
  const t = themes[isMonochrome ? 'mono' : 'gold'];

  /* ── 拖拽 & 最小化 ── */
  const panelW = 480;
  const panelH = 620;
  const [pos, setPos] = useState({
    x: typeof window !== 'undefined' ? Math.max(40, (window.innerWidth - panelW) / 2) : 0,
    y: typeof window !== 'undefined' ? Math.max(40, (window.innerHeight - panelH) / 2) : 0,
  });
  const [dragging, setDragging] = useState(false);
  const dragOff = useRef({ x: 0, y: 0 });
  const [minimized, setMinimized] = useState(false);

  /* ── 步骤 ── */
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [subject, setSubject] = useState('');
  const [subjectSource, setSubjectSource] = useState<'text' | 'image'>('text');
  const [subjectImage, setSubjectImage] = useState<string | null>(null); // data URL or server URL
  const [subjectImageIdentifying, setSubjectImageIdentifying] = useState(false);
  const [styleKey, setStyleKey] = useState('general');
  const [themeKey, setThemeKey] = useState('everyday');
  const [count, setCount] = useState<9 | 16>(9);
  const [customStyle, setCustomStyle] = useState('');
  const [customTheme, setCustomTheme] = useState('');

  /* ── 模型选择 ── */
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [chatModelId, setChatModelId] = useState('');
  const [chatModels, setChatModels] = useState<ModelOption[]>([]);

  /* ── 计划 ── */
  const [plan, setPlan] = useState<StickerItem[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');

  /* ── 生成 ── */
  const [generating, setGenerating] = useState(false);
  const [genIdx, setGenIdx] = useState(-1);

  /* ── 文件上传 ref ── */
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── 加载模型列表 ── */
  useEffect(() => {
    if (!isOpen) return;
    const loadModels = async () => {
      setModelsLoading(true);
      try {
        // 并行加载图像模型和聊天模型
        const [imgRes, chatRes] = await Promise.all([
          fetch('/api/models?type=image'),
          fetch('/api/models?type=chat'),
        ]);
        const loaded: ModelOption[] = [];
        const chatLoaded: ModelOption[] = [];

        if (imgRes.ok) {
          const data = await imgRes.json();
          const providerMap = new Map<string, string>();
          if (data.providers && Array.isArray(data.providers)) {
            for (const p of data.providers) {
              providerMap.set(p.id, p.name || p.displayName || '');
            }
          }
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              const rawId = m.id || m.name;
              loaded.push({
                id: m.providerId ? `${m.providerId}::${rawId}` : rawId,
                providerId: m.providerId || '',
                providerName: providerMap.get(m.providerId) || m.providerId || '',
                displayLabel: getModelDisplayName(rawId),
              });
            }
          }
          setModels(loaded);
          if (loaded.length > 0 && !selectedModelId) {
            setSelectedModelId(loaded[0].id);
          }
        }

        if (chatRes.ok) {
          const data = await chatRes.json();
          const providerMap = new Map<string, string>();
          if (data.providers && Array.isArray(data.providers)) {
            for (const p of data.providers) {
              providerMap.set(p.id, p.name || p.displayName || '');
            }
          }
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              const rawId = m.id || m.name;
              chatLoaded.push({
                id: m.providerId ? `${m.providerId}::${rawId}` : rawId,
                providerId: m.providerId || '',
                providerName: providerMap.get(m.providerId) || m.providerId || '',
                displayLabel: getModelDisplayName(rawId),
              });
            }
          }
          setChatModels(chatLoaded);
          if (chatLoaded.length > 0 && !chatModelId) {
            setChatModelId(chatLoaded[0].id);
          }
        }
      } catch { /* ignore */ } finally {
        setModelsLoading(false);
      }
    };
    loadModels();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedModel = models.find(m => m.id === selectedModelId);

  /* ── 拖拽逻辑 ── */
  const onDragDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const rect = (e.currentTarget.parentElement as HTMLElement)?.getBoundingClientRect();
    dragOff.current = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, [chatModelId]);
  useEffect(() => {
    if (!dragging) return;
    const mv = (e: MouseEvent) => setPos({ x: e.clientX - dragOff.current.x, y: e.clientY - dragOff.current.y });
    const up = () => setDragging(false);
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, [dragging]);

  /* ── ESC ── */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  /* ── 辅助 ── */
  const selectedStyle = STYLE_PRESETS.find(s => s.key === styleKey)!;
  const selectedTheme = THEME_PRESETS.find(th => th.key === themeKey)!;

  /* ── 主体详细描述（用于增强一致性） ── */
  const [subjectDetail, setSubjectDetail] = useState('');

  const buildIdentityLock = useCallback((): string => {
    const visualDesc = subjectDetail || subject;
    return `Subject: ${subject}\nVisual Identity: ${visualDesc}\nIdentity Lock: The character MUST maintain EXACTLY the same visual identity across ALL stickers — same species/type, same color scheme, same body proportions, same facial features, same outfit/accessories. Only expression, pose, and action may vary. FORBIDDEN: changing species, altering colors, modifying proportions, changing outfit design, or any visual drift that makes the character look different.`;
  }, [subject, subjectDetail]);

  /* ── 上传主体图片并识别 ── */
  const handleSubjectImageUpload = useCallback(async (file: File) => {
    // 读取为 data URL 用于预览
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setSubjectImage(dataUrl);
      setSubjectSource('image');
      setSubjectImageIdentifying(true);

      try {
        // 先持久化到服务器（data URL 太大无法直接传给 vision API）
        let imageUrl = dataUrl;
        try {
          const saveRes = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: dataUrl }),
          });
          if (saveRes.ok) {
            const saveData = await saveRes.json();
            if (saveData.url) imageUrl = saveData.url;
          }
        } catch { /* keep data URL */ }

        // 使用 chat API + 图片识别主体，获取简短名称和详细视觉描述
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: '请分析这张图片中的主体角色，按以下格式输出（严格遵循）：\n第一行：主体简短名称（2-6个字，如：橘猫、小恐龙）\n第二行起：详细视觉外观描述（包括物种、体型、毛色/配色、五官特征、穿着/配饰、标志性的视觉特征等，50-100字）\n\n示例：\n橘猫\n圆胖身材的橘色猫咪，全身橘黄毛色带白色腹部，大圆脸、短鼻子、绿色大眼睛，尾巴短粗翘起，无穿衣配饰' },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            }],
          model: chatModelId || (chatModels.length > 0 ? chatModels[0].id : undefined),
            stream: false,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content ?? data.content ?? '';
          const lines = content.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
          // 第一行是简短名称
          const shortName = (lines[0] || '').replace(/["""\n\r]/g, '').trim();
          // 第二行起是详细描述
          const detail = lines.slice(1).join('，').replace(/["""\n\r]/g, '').trim();
          if (shortName) {
            setSubject(shortName);
          }
          if (detail) {
            setSubjectDetail(detail);
          } else if (shortName) {
            // 如果没有详细描述，至少用简短名称作为描述
            setSubjectDetail(shortName);
          }
        }
      } catch {
        // 识别失败不影响使用，用户可以手动输入
      } finally {
        setSubjectImageIdentifying(false);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  /* ── 处理文件拖放 ── */
  const handleSubjectImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleSubjectImageUpload(file);
    }
  }, [handleSubjectImageUpload]);

  /* ── Step 0 → 1: 生成计划 ── */
  const handleGeneratePlan = useCallback(async () => {
    const hasSubject = subject.trim() || (subjectSource === 'image' && subjectImage);
    if (!hasSubject) return;
    setPlanLoading(true);
    setPlanError('');
    try {
      const themeDesc = themeKey === 'custom'
        ? customTheme
        : `主题:${selectedTheme.label}, 情绪:${selectedTheme.mood}, 参考文案:${selectedTheme.captions.slice(0, 8).join('/')}`;
      const styleDesc = styleKey === 'custom'
        ? customStyle
        : `风格:${selectedStyle.label}, 正向提示:${selectedStyle.positivePrompt}`;

      const subjectDesc = (subjectDetail || subject).trim()
        ? `${subject}${subjectDetail ? `（${subjectDetail}）` : ''}`
        : (subjectSource === 'image' && subjectImage ? '上传图片中的主体角色' : '未知主体');

      const prompt = `你是一个表情包策划专家。请根据以下要求生成表情包计划。

主体: ${subjectDesc}
${styleDesc}
${themeDesc}
数量: ${count}个

要求:
1. 每个表情必须有明确的"文案"(caption)和"动作描述"(action)
2. 文案要简短(1-4个字), 适合聊天场景
3. 动作描述要具体, 确保每个表情的姿势/动作有明显差异
4. 主体特征必须保持绝对一致(外形/颜色/轮廓/物种/服饰), 仅允许表情和姿势变化
5. 动作描述中要包含该表情的具体身体动作和面部表情, 以确保生成的图片有足够的视觉差异

请严格以JSON格式输出, 不要添加任何其他文字:
[{"id":1,"caption":"文案","action":"动作描述"},...]`;

      const chatModel = chatModels.find(m => m.id === chatModelId);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel?.id?.split('::').pop() || chatModelId,
          providerId: chatModel?.providerId || undefined,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
      });

      if (!res.ok) throw new Error(`API错误: ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? data.content ?? '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('无法解析表情计划');
      const items: StickerItem[] = JSON.parse(jsonMatch[0]).map((item: { caption?: string; action?: string }, i: number) => ({
        id: i + 1,
        caption: item.caption || `表情${i + 1}`,
        action: item.action || '微笑',
        status: 'pending' as const,
      }));
      setPlan(items);
      setStep(1);
    } catch (err: unknown) {
      setPlanError(err instanceof Error ? err.message : '生成计划失败');
    } finally {
      setPlanLoading(false);
    }
  }, [subject, subjectDetail, styleKey, themeKey, count, customStyle, customTheme, selectedStyle, selectedTheme, chatModelId, chatModels, subjectSource, subjectImage]);

  /* ── Step 1 → 2: 逐个生成贴纸 ── */
  const handleStartGeneration = useCallback(() => {
    setStep(2);
    setGenerating(true);
  }, []);

  useEffect(() => {
    if (!generating || step !== 2 || plan.length === 0) return;
    const idx = plan.findIndex(p => p.status === 'pending' || p.status === 'failed');
    if (idx === -1) { setGenerating(false); return; }
    setGenIdx(idx);

    const item = plan[idx];
    const styleP = styleKey === 'custom' ? customStyle : selectedStyle.positivePrompt;
    const negP = styleKey === 'custom' ? '' : selectedStyle.negativePrompt;
    const identityLock = buildIdentityLock();

    // 构建生成 prompt — 使用与画布图生图完全一致的 [ref] 前缀和保留格式
    let prompt: string;
    if (subjectImage && subjectSource === 'image') {
      // 有参考图时，使用画布图生图的完整提示词格式，触发 API 的主体一致性增强
      prompt = `[ref] Use the provided reference image(s) as the base. Create an image of: Sticker #${item.id}: "${item.caption}" — ${item.action}. ${styleP}. While creating this new image, strictly preserve the main subject and focal point of the reference image(s) — do NOT change the original product/object identity, strictly preserve the artistic style and visual aesthetics of the reference image(s), strictly preserve the color palette and tone of the reference image(s), strictly preserve the fine details and textures of the reference image(s). IMPORTANT: The product/object in the result MUST be the SAME product/object as in the reference image — do NOT substitute or replace it with a different product. ${identityLock}. Feel free to reimagine the composition and layout structure, the scene and environment setting. Transparent PNG background, die-cut sticker style, 1024x1024 square, sticker sheet single item, no solid background color.${negP ? ` Avoid: ${negP}, solid background, white background` : ''}`;
    } else {
      prompt = `Sticker #${item.id}: "${item.caption}" — ${item.action}. ${styleP}. Subject identity: ${identityLock}. Transparent PNG background, die-cut sticker style, no solid background color, 1024x1024 square, sticker sheet single item.${negP ? ` Avoid: ${negP}, solid background, white background` : ''}`;
    }

    const doGenerate = async () => {
      try {
        setPlan(prev => prev.map(p => p.id === item.id ? { ...p, status: 'generating' as const } : p));

        // 构建请求体
        const requestBody: Record<string, unknown> = {
          prompt,
          size: '1024x1024',
          aspectRatio: '1:1',
          n: 1,
          outputCount: 1,
          quality: 'standard',
        };

        // 如果选了模型，拆解 providerId::modelId 分别传递（与画布图生图一致）
        if (selectedModelId) {
          const selModel = models.find(m => m.id === selectedModelId);
          if (selModel) {
            requestBody.model = selModel.id.includes('::') ? selModel.id.split('::').pop()! : selModel.id;
            requestBody.providerId = selModel.providerId || undefined;
          } else if (selectedModelId.includes('::')) {
            requestBody.model = selectedModelId.split('::').pop()!;
            requestBody.providerId = selectedModelId.split('::')[0];
          } else {
            requestBody.model = selectedModelId;
          }
        }

        // 如果有主体图片，持久化后作为参考图传入（使用 referenceCategories 触发 API 主体一致性增强）
        if (subjectImage && subjectSource === 'image') {
          try {
            // 先将 data URL 持久化为服务器 URL
            let persistedUrl = subjectImage;
            if (subjectImage.startsWith('data:')) {
              const saveRes = await fetch('/api/save-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: subjectImage }),
              });
              if (saveRes.ok) {
                const saveData = await saveRes.json();
                if (saveData.url) persistedUrl = saveData.url;
              }
            }
            // 使用与画布图生图完全一致的 referenceCategories 格式
            // 保留主体(subject)、风格(style)、色彩(color)、细节(detail)，允许构图/场景自由变化
            // 强度设置：主体95, 风格90, 色彩90, 细节85 → 画布计算 strength ≈ 0.15（最大主体保留）
            requestBody.referenceImages = [persistedUrl];
            requestBody.referenceMode = 'reference';
            requestBody.referenceCategories = { '0': ['subject', 'style', 'color', 'detail'] };
            requestBody.referenceStrengths = [95];
            // strength 在 0~1 之间，0.15 = 画布图生图在主体保留最高时的最小值（最大保留）
            requestBody.strength = 0.15;
          } catch { /* 使用原始 URL 兜底 */ }
        }

        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        if (!res.ok) throw new Error(`生成失败: ${res.status}`);
        const data = await res.json();

        let imageUrl: string | undefined;
        if (data.imageUrls?.length > 0) {
          // 直接模式：generate API 直接返回图片 URL 数组
          imageUrl = data.imageUrls[0];
        } else if (data.taskIds?.length > 0) {
          // 轮询模式：通过 poll-task 等待结果
          const taskId = data.taskIds[0];
          // 拆解 model 和 providerId 给 poll-task
          const pollModelId = selectedModelId?.includes('::') ? selectedModelId.split('::').pop()! : (selectedModelId || undefined);
          const pollProviderId = selectedModelId?.includes('::') ? selectedModelId.split('::')[0] : undefined;
          for (let attempt = 0; attempt < 120; attempt++) {
            await new Promise(r => setTimeout(r, 2000));
            const pollRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: pollModelId, providerId: pollProviderId }),
            });
            if (!pollRes.ok) continue;
            const pollData = await pollRes.json();
            if (pollData.status === 'completed') {
              // poll-task 返回 imageUrl（单数字符串）
              imageUrl = pollData.imageUrl || (pollData.imageUrls?.length > 0 ? pollData.imageUrls[0] : undefined);
              break;
            }
            if (pollData.status === 'failed') throw new Error(pollData.error || '生成失败');
          }
        }
        if (!imageUrl) throw new Error('未获取到图片');

        // 持久化
        try {
          const saveRes = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl }),
          });
          if (saveRes.ok) {
            const saveData = await saveRes.json();
            if (saveData.url) imageUrl = saveData.url;
          }
        } catch { /* keep original URL */ }

        // 自动移除白色/浅色背景，确保输出为透明PNG
        try {
          if (imageUrl) {
            const transparentUrl = await removeBackgroundToTransparent(imageUrl);
            if (transparentUrl) imageUrl = transparentUrl;
          }
        } catch { /* 保留原图 */ }

        setPlan(prev => prev.map(p => p.id === item.id ? { ...p, status: 'done' as const, imageUrl } : p));
      } catch (err: unknown) {
        setPlan(prev => prev.map(p => p.id === item.id ? { ...p, status: 'failed' as const, error: err instanceof Error ? err.message : '生成失败' } : p));
      }
    };
    doGenerate();
  }, [generating, step, plan, styleKey, customStyle, selectedStyle, selectedTheme, buildIdentityLock, selectedModelId, subjectImage, subjectSource, subjectDetail]);

  /* ── 重试失败项 ── */
  const handleRetry = useCallback((id: number) => {
    setPlan(prev => prev.map(p => p.id === id ? { ...p, status: 'pending' as const, error: undefined } : p));
  }, []);

  /* ── 停止生成 ── */
  const handleStop = useCallback(() => {
    setGenerating(false);
    setGenIdx(-1);
  }, []);

  /* ── 全部添加到画布 ── */
  const handleAddAllToCanvas = useCallback(() => {
    const urls = plan.filter(p => p.status === 'done' && p.imageUrl).map(p => p.imageUrl!);
    if (urls.length > 0 && onAddImages) onAddImages(urls);
  }, [plan, onAddImages]);

  /* ── 下载全部（ZIP 压缩包） ── */
  const [downloadZipping, setDownloadZipping] = useState(false);
  const handleDownloadAll = useCallback(async () => {
    const done = plan.filter(p => p.status === 'done' && p.imageUrl);
    if (done.length === 0) return;
    setDownloadZipping(true);
    try {
      const zip = new JSZip();
      await Promise.all(done.map(async (item) => {
        try {
          const res = await fetch(item.imageUrl!);
          const blob = await res.blob();
          const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
          zip.file(`sticker_${String(item.id).padStart(2, '0')}_${item.caption.replace(/[/\\?%*:|"<>]/g, '_')}.${ext}`, blob);
        } catch { /* skip failed */ }
      }));
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stickers_${subject || 'pack'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadZipping(false);
    }
  }, [plan, subject]);

  /* ── 重置 ── */
  const handleReset = useCallback(() => {
    setStep(0);
    setPlan([]);
    setPlanError('');
    setGenerating(false);
    setGenIdx(-1);
    setSubjectDetail('');
  }, []);

  if (!isOpen) return null;

  const doneCount = plan.filter(p => p.status === 'done').length;
  const failCount = plan.filter(p => p.status === 'failed').length;

  return (
    <div
      className="fixed z-[150] flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        width: panelW,
        maxHeight: minimized ? 40 : 'calc(100vh - 100px)',
        background: t.panelBg,
        borderRadius: 10,
        border: `1px solid ${t.border}`,
        boxShadow: t.shadow,
        overflow: 'hidden',
        transition: 'max-height 0.2s ease',
      }}
      data-popup="sticker-assistant"
    >
      {/* ── 标题栏 ── */}
      <div
        className="flex items-center justify-between px-3 h-10 cursor-move select-none shrink-0"
        style={{ background: t.headerGrad, borderBottom: `1px solid ${t.border}` }}
        onMouseDown={onDragDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical size={14} style={{ color: t.textDim }} />
          <Smile size={15} style={{ color: t.accent }} />
          <span className="text-sm font-medium" style={{ color: t.text }}>表情助手</span>
          {plan.length > 0 && step >= 1 && (
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: t.accentBg, color: t.accent }}>
              {doneCount}/{plan.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded transition-colors duration-150"
            style={{ color: t.textDim }}
            onMouseEnter={e => (e.currentTarget.style.color = t.text)}
            onMouseLeave={e => (e.currentTarget.style.color = t.textDim)}
            onClick={() => setMinimized(v => !v)}
            aria-label="最小化"
          >
            <Minus size={14} />
          </button>
          <button
            className="p-1 rounded transition-colors duration-150"
            style={{ color: t.textDim }}
            onMouseEnter={e => (e.currentTarget.style.color = t.btnClose)}
            onMouseLeave={e => (e.currentTarget.style.color = t.textDim)}
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {minimized ? null : (
        <div className="flex-1 overflow-y-auto" style={{ background: t.deepBg }}>
          {/* ── 生成进度条 ── */}
          {step === 2 && plan.length > 0 && (
            <div className="h-1 shrink-0" style={{ background: t.border }}>
              <div
                className="h-full transition-all duration-300"
                style={{ width: `${(doneCount / plan.length) * 100}%`, background: t.accent }}
              />
            </div>
          )}

          {/* ── Step 0: 配置 ── */}
          {step === 0 && (
            <div className="p-4 space-y-4">
              {/* 主体来源切换 */}
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: t.textSub }}>表情主体</label>
                <div className="flex gap-2 mb-2">
                  <button
                    className="flex-1 px-2 py-1.5 rounded-md text-xs transition-all duration-150 cursor-pointer flex items-center justify-center gap-1"
                    style={{
                      background: subjectSource === 'text' ? t.accentBg : t.cardBg,
                      border: `1.5px solid ${subjectSource === 'text' ? t.accent : t.border}`,
                      color: subjectSource === 'text' ? t.accent : t.textSub,
                    }}
                    onClick={() => setSubjectSource('text')}
                  >
                    文字描述
                  </button>
                  <button
                    className="flex-1 px-2 py-1.5 rounded-md text-xs transition-all duration-150 cursor-pointer flex items-center justify-center gap-1"
                    style={{
                      background: subjectSource === 'image' ? t.accentBg : t.cardBg,
                      border: `1.5px solid ${subjectSource === 'image' ? t.accent : t.border}`,
                      color: subjectSource === 'image' ? t.accent : t.textSub,
                    }}
                    onClick={() => setSubjectSource('image')}
                  >
                    <ImagePlus size={12} /> 上传主体
                  </button>
                </div>

                {/* 文字描述模式 */}
                {subjectSource === 'text' && (
                  <input
                    className="w-full px-3 py-2 rounded-md text-sm outline-none transition-all duration-150"
                    style={{ background: t.inputBg, color: t.text, border: `1px solid ${t.border}` }}
                    placeholder="例如: 橘猫、奶茶杯、小恐龙..."
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    onFocus={e => (e.currentTarget.style.borderColor = t.accent)}
                    onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                  />
                )}

                {/* 上传图片模式 */}
                {subjectSource === 'image' && (
                  <div>
                    {subjectImage ? (
                      <div className="relative rounded-md overflow-hidden" style={{ border: `1px solid ${t.border}` }}>
                        <img
                          src={subjectImage}
                          alt="主体参考图"
                          className="w-full max-h-40 object-contain"
                          style={{ background: t.cardBg }}
                        />
                        {subjectImageIdentifying && (
                          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                            <div className="flex items-center gap-2 text-white text-xs">
                              <Loader2 size={14} className="animate-spin" />
                              识别主体中...
                            </div>
                          </div>
                        )}
                        <button
                          className="absolute top-1 right-1 p-1 rounded-full transition-colors duration-150 cursor-pointer"
                          style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                          onClick={() => { setSubjectImage(null); setSubject(''); setSubjectDetail(''); }}
                          aria-label="移除图片"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div
                        className="flex flex-col items-center justify-center gap-2 py-6 rounded-md cursor-pointer transition-all duration-150"
                        style={{ background: t.inputBg, border: `2px dashed ${t.border}` }}
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = t.accent; }}
                        onDragLeave={e => { e.currentTarget.style.borderColor = t.border; }}
                        onDrop={handleSubjectImageDrop}
                      >
                        <Upload size={20} style={{ color: t.textDim }} />
                        <span className="text-xs" style={{ color: t.textDim }}>点击上传或拖拽图片</span>
                        <span className="text-[10px]" style={{ color: t.textDim }}>AI 将自动识别图片中的主体</span>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleSubjectImageUpload(file);
                        e.target.value = '';
                      }}
                    />
                    {/* 识别结果可编辑 */}
                    {subjectImage && (
                      <input
                        className="w-full mt-2 px-3 py-2 rounded-md text-sm outline-none transition-all duration-150"
                        style={{ background: t.inputBg, color: t.text, border: `1px solid ${t.border}` }}
                        placeholder="识别主体名称（可手动修改）..."
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        onFocus={e => (e.currentTarget.style.borderColor = t.accent)}
                        onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* 模型选择 */}
              <div className="space-y-2">
                {/* LLM 计划模型 */}
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: t.textSub }}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0`} style={{ background: t.accent }} />
                    计划模型
                  </label>
                  <select
                    value={chatModelId}
                    onChange={(e) => setChatModelId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm appearance-none cursor-pointer transition-all duration-150"
                    style={{
                      background: t.inputBg,
                      color: t.text,
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    {chatModels.length === 0 && <option value="">暂无模型</option>}
                    {(() => {
                      const grouped: Record<string, typeof chatModels> = {};
                      chatModels.forEach(m => {
                        const key = m.providerName || '未知';
                        if (!grouped[key]) grouped[key] = [];
                        grouped[key].push(m);
                      });
                      return Object.entries(grouped).map(([providerName, models]) => (
                        <optgroup key={providerName} label={providerName}>
                          {models.map(m => (
                            <option key={m.id} value={m.id}>{m.displayLabel || m.id}</option>
                          ))}
                        </optgroup>
                      ));
                    })()}
                  </select>
                  {(() => {
                    const cm = chatModels.find(m => m.id === chatModelId);
                    if (cm) return <p className="text-xs mt-0.5" style={{ color: t.textDim }}>{cm.displayLabel || cm.id} · 来自 {cm.providerName}</p>;
                    return null;
                  })()}
                </div>
                {/* 生图模型 */}
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: t.textSub }}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0`} style={{ background: t.accent }} />
                    生图模型
                  </label>
                  <select
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm appearance-none cursor-pointer transition-all duration-150"
                    style={{
                      background: t.inputBg,
                      color: t.text,
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    {models.length === 0 && <option value="">暂无模型</option>}
                    {(() => {
                      const grouped: Record<string, typeof models> = {};
                      models.forEach(m => {
                        const key = m.providerName || '未知';
                        if (!grouped[key]) grouped[key] = [];
                        grouped[key].push(m);
                      });
                      return Object.entries(grouped).map(([providerName, ms]) => (
                        <optgroup key={providerName} label={providerName}>
                          {ms.map(m => (
                            <option key={m.id} value={m.id}>{m.displayLabel || m.id}</option>
                          ))}
                        </optgroup>
                      ));
                    })()}
                  </select>
                  {(() => {
                    const sm = models.find(m => m.id === selectedModelId);
                    if (sm) return <p className="text-xs mt-0.5" style={{ color: t.textDim }}>{sm.displayLabel || sm.id} · 来自 {sm.providerName}</p>;
                    return null;
                  })()}
                </div>
              </div>

              {/* 风格选择 */}
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: t.textSub }}>风格</label>
                <div className="grid grid-cols-3 gap-2">
                  {STYLE_PRESETS.map(s => (
                    <button
                      key={s.key}
                      className="flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs transition-all duration-150 cursor-pointer"
                      style={{
                        background: styleKey === s.key ? t.accentBg : t.cardBg,
                        border: `1.5px solid ${styleKey === s.key ? t.accent : t.border}`,
                        color: styleKey === s.key ? t.accent : t.textSub,
                      }}
                      onClick={() => setStyleKey(s.key)}
                    >
                      <span>{s.icon}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
                {styleKey === 'custom' && (
                  <textarea
                    className="w-full mt-2 px-3 py-2 rounded-md text-xs outline-none resize-none transition-all duration-150"
                    style={{ background: t.inputBg, color: t.text, border: `1px solid ${t.border}`, minHeight: 60 }}
                    placeholder="输入自定义风格提示词..."
                    value={customStyle}
                    onChange={e => setCustomStyle(e.target.value)}
                    onFocus={e => (e.currentTarget.style.borderColor = t.accent)}
                    onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                  />
                )}
              </div>

              {/* 主题选择 */}
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: t.textSub }}>主题</label>
                <div className="grid grid-cols-4 gap-2">
                  {THEME_PRESETS.map(th => (
                    <button
                      key={th.key}
                      className="flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-xs transition-all duration-150 cursor-pointer"
                      style={{
                        background: themeKey === th.key ? t.accentBg : t.cardBg,
                        border: `1.5px solid ${themeKey === th.key ? t.accent : t.border}`,
                        color: themeKey === th.key ? t.accent : t.textSub,
                      }}
                      onClick={() => setThemeKey(th.key)}
                    >
                      <span className="text-base">{th.icon}</span>
                      <span className="text-[10px] leading-tight">{th.label}</span>
                    </button>
                  ))}
                </div>
                {themeKey === 'custom' && (
                  <textarea
                    className="w-full mt-2 px-3 py-2 rounded-md text-xs outline-none resize-none transition-all duration-150"
                    style={{ background: t.inputBg, color: t.text, border: `1px solid ${t.border}`, minHeight: 60 }}
                    placeholder="输入自定义主题描述和想要的文案..."
                    value={customTheme}
                    onChange={e => setCustomTheme(e.target.value)}
                    onFocus={e => (e.currentTarget.style.borderColor = t.accent)}
                    onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                  />
                )}
              </div>

              {/* 数量 */}
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: t.textSub }}>数量</label>
                <div className="flex gap-2">
                  {[9, 16].map(n => (
                    <button
                      key={n}
                      className="flex-1 px-3 py-1.5 rounded-md text-xs transition-all duration-150 cursor-pointer"
                      style={{
                        background: count === n ? t.accentBg : t.cardBg,
                        border: `1.5px solid ${count === n ? t.accent : t.border}`,
                        color: count === n ? t.accent : t.textSub,
                      }}
                      onClick={() => setCount(n as 9 | 16)}
                    >
                      {n}个（{n === 9 ? '精简版' : '完整版'}）
                    </button>
                  ))}
                </div>
              </div>

              {/* 生成计划按钮 */}
              <button
                className="w-full py-2.5 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-2"
                style={{
                  background: (subject.trim() || (subjectSource === 'image' && subjectImage)) ? t.accent : t.border,
                  color: (subject.trim() || (subjectSource === 'image' && subjectImage)) ? (isMonochrome ? '#fff' : '#1a1a1a') : t.textDim,
                  opacity: planLoading ? 0.7 : 1,
                }}
                onClick={handleGeneratePlan}
                disabled={(!subject.trim() && !(subjectSource === 'image' && subjectImage)) || planLoading}
              >
                {planLoading ? (
                  <><Loader2 size={15} className="animate-spin" /> 生成计划中...</>
                ) : (
                  <><Sparkles size={15} /> 生成表情计划</>
                )}
              </button>
              {planError && (
                <p className="text-xs text-red-500 mt-1">{planError}</p>
              )}
            </div>
          )}

          {/* ── Step 1: 计划确认 ── */}
          {step === 1 && (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: t.text }}>
                  表情计划 ({plan.length}个)
                </span>
                <button
                  className="text-xs px-2 py-1 rounded transition-colors duration-150 cursor-pointer"
                  style={{ color: t.accent, background: t.accentBg }}
                  onClick={handleReset}
                >
                  重新配置
                </button>
              </div>

              {/* 主体信息 */}
              {(subjectImage || subject) && (
                <div className="flex items-center gap-2 px-2.5 py-2 rounded-md" style={{ background: t.cardBg, border: `1px solid ${t.border}` }}>
                  {subjectImage && (
                    <img src={subjectImage} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate" style={{ color: t.text }}>
                      主体: {subject}
                    </div>
                    <div className="text-[10px]" style={{ color: t.textDim }}>
                      计划: {chatModels.find(m => m.id === chatModelId)?.displayLabel || '默认'}
                      {' · '}生图: {selectedModel?.displayLabel || selectedModel?.id || '默认'}
                      {' · '}风格: {selectedStyle.label}
                      {' · '}主题: {selectedTheme.label}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1">
                {plan.map(item => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 px-2.5 py-2 rounded-md"
                    style={{ background: t.cardBg, border: `1px solid ${t.border}` }}
                  >
                    <span className="text-xs font-mono shrink-0 mt-0.5" style={{ color: t.accent }}>
                      {String(item.id).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate" style={{ color: t.text }}>
                        {item.caption}
                      </div>
                      <div className="text-[11px] truncate" style={{ color: t.textDim }}>
                        {item.action}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                className="w-full py-2.5 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-2"
                style={{ background: t.accent, color: isMonochrome ? '#fff' : '#1a1a1a' }}
                onClick={handleStartGeneration}
              >
                <ChevronRight size={15} /> 开始生成
              </button>
            </div>
          )}

          {/* ── Step 2: 生成 ── */}
          {step === 2 && (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: t.text }}>
                  生成进度 {doneCount}/{plan.length}
                  {failCount > 0 && <span className="text-red-500 ml-1">({failCount}失败)</span>}
                </span>
                {generating ? (
                  <button
                    className="text-xs px-2 py-1 rounded cursor-pointer transition-colors duration-150"
                    style={{ background: '#ef4444', color: '#fff' }}
                    onClick={handleStop}
                  >
                    停止
                  </button>
                ) : (
                  <div className="flex gap-2">
                    {failCount > 0 && (
                      <button
                        className="text-xs px-2 py-1 rounded cursor-pointer transition-colors duration-150"
                        style={{ color: t.accent, background: t.accentBg }}
                        onClick={() => { setGenerating(true); }}
                      >
                        重试失败
                      </button>
                    )}
                    <button
                      className="text-xs px-2 py-1 rounded cursor-pointer transition-colors duration-150"
                      style={{ color: t.accent, background: t.accentBg }}
                      onClick={handleReset}
                    >
                      重新开始
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 max-h-[50vh] overflow-y-auto">
                {plan.map(item => (
                  <div
                    key={item.id}
                    className="relative rounded-md overflow-hidden"
                    style={{
                      aspectRatio: '1',
                      background: t.cardBg,
                      border: `1px solid ${item.status === 'failed' ? '#ef4444' : t.border}`,
                    }}
                  >
                    {item.status === 'done' && item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.caption}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : item.status === 'generating' ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                        <Loader2 size={18} className="animate-spin" style={{ color: t.accent }} />
                        <span className="text-[10px]" style={{ color: t.textDim }}>生成中</span>
                      </div>
                    ) : item.status === 'failed' ? (
                      <div
                        className="w-full h-full flex flex-col items-center justify-center gap-1 cursor-pointer"
                        onClick={() => handleRetry(item.id)}
                      >
                        <XCircle size={18} className="text-red-500" />
                        <span className="text-[10px] text-red-400">点击重试</span>
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center">
                        <Clock size={16} style={{ color: t.textDim }} />
                      </div>
                    )}
                    {/* 底部文案 */}
                    <div
                      className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-center text-[10px] truncate"
                      style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                    >
                      {item.caption}
                    </div>
                  </div>
                ))}
              </div>

              {/* 底部操作 */}
              {!generating && doneCount > 0 && (
                <div className="flex gap-2 pt-1">
                  <button
                    className="flex-1 py-2 rounded-md text-xs font-medium cursor-pointer transition-all duration-150 flex items-center justify-center gap-1"
                    style={{ background: t.accent, color: isMonochrome ? '#fff' : '#1a1a1a' }}
                    onClick={handleAddAllToCanvas}
                  >
                    <CheckCircle2 size={13} /> 添加到画布 ({doneCount})
                  </button>
                  <button
                    className="py-2 px-3 rounded-md text-xs font-medium cursor-pointer transition-all duration-150 flex items-center justify-center gap-1"
                    style={{ background: t.cardBg, color: t.textSub, border: `1px solid ${t.border}` }}
                    onClick={handleDownloadAll}
                    disabled={downloadZipping}
                  >
                    {downloadZipping ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
