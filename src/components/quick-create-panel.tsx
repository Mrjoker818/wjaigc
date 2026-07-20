'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Box,
  Film,
  ImagePlus,
  Settings2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { classifyIntent, describeIntent, type ClassifiedIntent } from '@/lib/intent-classifier';

export interface QuickCreateRequest {
  prompt: string;
  aspectRatio: string;
  quality: string;
  outputCount: number;
  referenceImages: string[];
  intent: ClassifiedIntent;
}

interface QuickCreatePanelProps {
  themeStyle?: 'gold' | 'monochrome';
  selectedImage?: { id: string; url: string; prompt?: string } | null;
  isGenerating?: boolean;
  onGenerate: (request: QuickCreateRequest) => Promise<boolean>;
  onOpenProfessional: (prompt?: string) => void;
  onOpenChat: (prompt?: string) => void;
  onOpenVideo: (prompt?: string, mode?: 'generate' | 'extend') => void;
}

const QUICK_GOALS = [
  { label: '创意海报', prompt: '设计一张具有明确视觉焦点和高级排版的创意海报' },
  { label: '电商商品图', prompt: '生成一张干净专业、突出商品质感的电商主图' },
  { label: '品牌视觉', prompt: '设计一套具有统一品牌调性和辨识度的品牌视觉' },
  { label: '社媒配图', prompt: '生成一张适合社交媒体发布、信息清晰且有吸引力的配图' },
] as const;

function recommendAspectRatio(prompt: string, intent: ClassifiedIntent): string {
  const normalized = prompt.toLowerCase();
  if (/手机|竖版|小红书|短视频|story|9:16/.test(normalized)) return '9:16';
  if (/海报|人物|肖像|封面|3:4/.test(normalized)) return '3:4';
  if (/横版|电影|风景|视频|banner|16:9/.test(normalized) || intent.action === 'video') return '16:9';
  if (/商品|电商|头像|logo|方形|1:1/.test(normalized)) return '1:1';
  return '1:1';
}

function getRouteLabel(intent: ClassifiedIntent): string {
  if (intent.action === 'video' || intent.action === 'video_extend') return '视频导演';
  if (intent.action === '3d') return '3D 创作';
  if (intent.category === 'operate') return '智能图片编辑';
  if (intent.category === 'analyze' || intent.category === 'chat') return 'AI 助手';
  if (intent.category === 'brand') return '品牌设计 Skill';
  return '图像生成';
}

export function QuickCreatePanel({
  themeStyle = 'gold',
  selectedImage,
  isGenerating = false,
  onGenerate,
  onOpenProfessional,
  onOpenChat,
  onOpenVideo,
}: QuickCreatePanelProps) {
  const [prompt, setPrompt] = useState('');
  const [uploadedReferences, setUploadedReferences] = useState<string[]>([]);
  const [includeSelectedImage, setIncludeSelectedImage] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isUploadingReferences, setIsUploadingReferences] = useState(false);
  const [referenceUploadError, setReferenceUploadError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const referenceImages = useMemo(() => {
    const selected = includeSelectedImage && selectedImage?.url ? [selectedImage.url] : [];
    return Array.from(new Set([...selected, ...uploadedReferences]));
  }, [includeSelectedImage, selectedImage, uploadedReferences]);

  const intent = useMemo(
    () => classifyIntent(prompt, {
      hasImages: referenceImages.length > 0,
      selectedImageId: includeSelectedImage ? selectedImage?.id ?? null : null,
      selectedImageUrl: includeSelectedImage ? selectedImage?.url ?? null : null,
    }),
    [includeSelectedImage, prompt, referenceImages.length, selectedImage],
  );

  const recommendation = useMemo(() => ({
    intent: prompt.trim() ? describeIntent(intent) : '等待输入创作需求',
    route: prompt.trim() ? getRouteLabel(intent) : '自动匹配',
    aspectRatio: recommendAspectRatio(prompt, intent),
    quality: 'standard',
    outputCount: 1,
  }), [intent, prompt]);

  useEffect(() => {
    setSubmitted(false);
  }, [includeSelectedImage, uploadedReferences]);

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? []).filter((file: File) => file.type.startsWith('image/'));
    const remainingSlots = Math.max(0, 4 - uploadedReferences.length);
    const selectedFiles = files.slice(0, remainingSlots);
    event.target.value = '';

    if (selectedFiles.length === 0) return;

    setIsUploadingReferences(true);
    setReferenceUploadError(undefined);

    const results = await Promise.all(selectedFiles.map(async (file: File): Promise<string | null> => {
      try {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch('/api/save-image', {
          method: 'POST',
          body: formData,
        });
        const data = await response.json() as { url?: string; error?: string };
        if (!response.ok || !data.url) {
          throw new Error(data.error || '参考图片上传失败');
        }
        return data.url;
      } catch (error) {
        console.error('[QuickCreatePanel] reference upload failed:', error);
        return null;
      }
    }));

    const persistedUrls = results.filter((url: string | null): url is string => Boolean(url));
    if (persistedUrls.length > 0) {
      setUploadedReferences((current: string[]) => Array.from(new Set([...current, ...persistedUrls])).slice(0, 4));
    }
    if (persistedUrls.length !== selectedFiles.length) {
      setReferenceUploadError('部分参考图片上传失败，请重试');
    }
    setIsUploadingReferences(false);
  };

  const handleSubmit = async (): Promise<void> => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    if (intent.action === 'video' || intent.action === 'video_extend') {
      onOpenVideo(trimmedPrompt, intent.action === 'video_extend' ? 'extend' : 'generate');
      return;
    }
    if (intent.action === '3d' || intent.category === 'operate' || intent.category === 'analyze' || intent.category === 'chat') {
      onOpenChat(trimmedPrompt);
      return;
    }

    const accepted = await onGenerate({
      prompt: trimmedPrompt,
      aspectRatio: recommendation.aspectRatio,
      quality: recommendation.quality,
      outputCount: recommendation.outputCount,
      referenceImages,
      intent,
    });
    setSubmitted(accepted);
  };

  const isMonochrome = themeStyle === 'monochrome';

  return (
    <div className="flex min-h-full flex-col px-4 py-4">
      <section className={`rounded-2xl border p-4 shadow-card ${isMonochrome ? 'border-border bg-card' : 'border-primary/20 bg-card'}`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">一句话开始创作</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">描述目标，系统自动匹配能力、模型和参数。</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenProfessional(prompt)}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            专业设置
          </button>
        </div>

        <textarea
          value={prompt}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setPrompt(event.target.value);
            setSubmitted(false);
          }}
          placeholder="例如：为一款东方茶饮设计春季新品海报，清新、克制、有高级感"
          className="min-h-32 w-full resize-y rounded-xl border border-border bg-muted px-3.5 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
        />

        <div className="mt-3 flex flex-wrap gap-2" aria-label="常用创作目标">
          {QUICK_GOALS.map((goal) => (
            <button
              key={goal.label}
              type="button"
              onClick={() => {
                setPrompt(goal.prompt);
                setSubmitted(false);
              }}
              className="min-h-9 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {goal.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-foreground">参考图片</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">可选，最多添加 4 张</p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingReferences || uploadedReferences.length >= 4}
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {isUploadingReferences ? '上传中' : '上传图片'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event: React.ChangeEvent<HTMLInputElement>) => { void handleFiles(event); }} />
        </div>

        {selectedImage && (
          <button
            type="button"
            aria-pressed={includeSelectedImage}
            onClick={() => setIncludeSelectedImage((value: boolean) => !value)}
            className={`mt-2 flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${includeSelectedImage ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-muted text-muted-foreground hover:text-foreground'}`}
          >
            <ImagePlus className="h-4 w-4 text-primary" aria-hidden="true" />
            {includeSelectedImage ? '已引用画布选中图片' : '引用画布当前选中图片'}
          </button>
        )}

        {referenceUploadError && (
          <p className="mt-2 text-[11px] text-destructive" role="alert">{referenceUploadError}</p>
        )}

        {uploadedReferences.length > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {uploadedReferences.map((url: string, index: number) => (
              <div key={`${url.slice(0, 32)}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`参考图片 ${index + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setUploadedReferences((current: string[]) => current.filter((item: string) => item !== url))}
                  aria-label={`移除参考图片 ${index + 1}`}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md bg-background/85 text-foreground opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-3 rounded-2xl border border-border bg-muted/40 p-4">
        <div className="flex items-center gap-2">
          {recommendation.route === '视频导演' ? <Film className="h-4 w-4 text-primary" aria-hidden="true" /> : recommendation.route === '3D 创作' ? <Box className="h-4 w-4 text-primary" aria-hidden="true" /> : <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />}
          <h3 className="text-xs font-semibold text-foreground">系统推荐摘要</h3>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div><dt className="text-muted-foreground">识别目标</dt><dd className="mt-0.5 truncate text-foreground">{recommendation.intent}</dd></div>
          <div><dt className="text-muted-foreground">执行能力</dt><dd className="mt-0.5 text-foreground">{recommendation.route}</dd></div>
          <div><dt className="text-muted-foreground">画面比例</dt><dd className="mt-0.5 text-foreground">{recommendation.aspectRatio}</dd></div>
          <div><dt className="text-muted-foreground">输出方案</dt><dd className="mt-0.5 text-foreground">标准质量 · 1 张</dd></div>
        </dl>
      </section>

      {submitted && (
        <section className="mt-3 rounded-2xl border border-primary/25 bg-primary/10 p-4" aria-live="polite">
          <h3 className="text-xs font-semibold text-foreground">任务已提交，接下来可以</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => onOpenProfessional(prompt)} className="min-h-9 rounded-lg bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted">生成同系列</button>
            <button type="button" onClick={() => onOpenChat(`请基于刚才的创作继续优化：${prompt}`)} className="min-h-9 rounded-lg bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted">继续优化</button>
            <button type="button" onClick={() => onOpenVideo(prompt)} className="min-h-9 rounded-lg bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted">生成视频</button>
          </div>
        </section>
      )}

      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!prompt.trim() || isGenerating || isUploadingReferences}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-card transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {isGenerating ? '生成任务进行中' : recommendation.route === '视频导演' ? '打开视频创作' : recommendation.route === 'AI 助手' || recommendation.route === '智能图片编辑' || recommendation.route === '3D 创作' ? '交给 AI 助手' : '立即生成'}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">不会替换专业模式，随时可切换并调整全部参数</p>
      </div>
    </div>
  );
}
