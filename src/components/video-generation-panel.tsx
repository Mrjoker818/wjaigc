'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  Play, Video, ImagePlus, Clock, Settings2,
  ChevronDown, Loader2, Sparkles, Volume2, VolumeX,
  Upload, X, AlertCircle, Info, FastForward
} from 'lucide-react';

// === 视频模型信息 ===
export interface VideoModelInfo {
  id: string;
  name: string;
  provider: string;
  region: 'cn' | 'global';
  profile: string;
  features: {
    firstLastFrame: boolean;
    multiReference: boolean;
    videoEdit: boolean;
    videoExtend: boolean;
    audio: boolean;
    maxDuration: number;
    durations: number[];
    aspectRatios: string[];
    resolutions: string[];
  };
}

// 视频模型注册表（与 video-api.ts 保持同步）
const VIDEO_MODEL_REGISTRY: Record<string, VideoModelInfo> = {
  // === 国内模型 ===
  'kling-v3-video-generation': {
    id: 'kling-v3-video-generation', name: '可灵 V3', provider: 'Kuaishou', region: 'cn',
    profile: 'dashscope',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'] }
  },
  'kling-v3-omni-video-generation': {
    id: 'kling-v3-omni-video-generation', name: '可灵 V3 Omni', provider: 'Kuaishou', region: 'cn',
    profile: 'dashscope',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'] }
  },
  'doubao-seedance-2-0': {
    id: 'doubao-seedance-2-0', name: 'Seedance 2.0', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16','21:9'], resolutions: ['480p','720p','1080p'] }
  },
  'doubao-seedance-2-0-fast': {
    id: 'doubao-seedance-2-0-fast', name: 'Seedance 2.0 Fast', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['480p','720p','1080p'] }
  },
  'doubao-seedance-2-3': {
    id: 'doubao-seedance-2-3', name: 'Seedance 2.3', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16','21:9'], resolutions: ['768p','1080p'] }
  },
  'doubao-seedance-2-3-fast': {
    id: 'doubao-seedance-2-3-fast', name: 'Seedance 2.3 Fast', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['768p','1080p'] }
  },
  'doubao-seedance-1-0-lite': {
    id: 'doubao-seedance-1-0-lite', name: 'Seedance 1.0 Lite', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['480p','720p'] }
  },
  'video-01': {
    id: 'video-01', name: '海螺 Video-01', provider: 'MiniMax', region: 'cn',
    profile: 'minimax',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 6, durations: [6], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['720p'] }
  },
  'hailuo-02': {
    id: 'hailuo-02', name: '海螺 Hailuo 02', provider: 'MiniMax', region: 'cn',
    profile: 'minimax',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 10, durations: [5, 6, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['512p','768p','1080p'] }
  },
  'hailuo-2.3': {
    id: 'hailuo-2.3', name: '海螺 Hailuo 2.3', provider: 'MiniMax', region: 'cn',
    profile: 'minimax',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 10, durations: [5, 6, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['768p','1080p'] }
  },
  'vidu-q1': {
    id: 'vidu-q1', name: 'Vidu Q1', provider: 'ShengShu', region: 'cn',
    profile: 'vidu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, maxDuration: 8, durations: [4, 8], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'] }
  },
  'vidu-q2': {
    id: 'vidu-q2', name: 'Vidu Q2', provider: 'ShengShu', region: 'cn',
    profile: 'vidu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, maxDuration: 8, durations: [4, 8], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'] }
  },
  // === 海外模型 ===
  'gen-3-alpha-turbo': {
    id: 'gen-3-alpha-turbo', name: 'Runway Gen-3 Turbo', provider: 'Runway', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: true, videoExtend: true, audio: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'gen-3-alpha': {
    id: 'gen-3-alpha', name: 'Runway Gen-3', provider: 'Runway', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: true, videoExtend: true, audio: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'gen-4': {
    id: 'gen-4', name: 'Runway Gen-4', provider: 'Runway', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: true, videoExtend: true, audio: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p','4K'] }
  },
  'pika-2.2': {
    id: 'pika-2.2', name: 'Pika 2.2', provider: 'Pika', region: 'global',
    profile: 'fal-video',
    features: { firstLastFrame: false, multiReference: true, videoEdit: true, videoExtend: false, audio: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1','4:5','5:4','3:2','2:3'], resolutions: ['720p','1080p'] }
  },
  'pika-2.0': {
    id: 'pika-2.0', name: 'Pika 2.0', provider: 'Pika', region: 'global',
    profile: 'fal-video',
    features: { firstLastFrame: false, multiReference: true, videoEdit: true, videoExtend: false, audio: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'pika-1.5': {
    id: 'pika-1.5', name: 'Pika 1.5', provider: 'Pika', region: 'global',
    profile: 'fal-video',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 5, durations: [5], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p'] }
  },
  'ray3': {
    id: 'ray3', name: 'Luma Ray3', provider: 'Luma', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, maxDuration: 10, durations: [5, 9, 10], aspectRatios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p'] }
  },
  'ray3.14': {
    id: 'ray3.14', name: 'Luma Ray3.14', provider: 'Luma', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, maxDuration: 10, durations: [5, 9, 10], aspectRatios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p'] }
  },
  'ray2': {
    id: 'ray2', name: 'Luma Ray2', provider: 'Luma', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, maxDuration: 5, durations: [5], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'sora': {
    id: 'sora', name: 'OpenAI Sora', provider: 'OpenAI', region: 'global',
    profile: 'openai-video',
    features: { firstLastFrame: false, multiReference: false, videoEdit: true, videoExtend: true, audio: true, maxDuration: 20, durations: [5, 10, 15, 20], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'veo-2': {
    id: 'veo-2', name: 'Google Veo 2', provider: 'Google', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 8, durations: [4, 8], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'veo-3': {
    id: 'veo-3', name: 'Google Veo 3', provider: 'Google', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: true, maxDuration: 8, durations: [4, 8], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
};

export interface VideoGenerateParams {
  prompt: string;
  mode: 'text2video' | 'image2video-first' | 'image2video-firstlast' | 'image2video-ref' | 'video-extend';
  model: string;
  providerId?: string;
  aspectRatio: string;
  duration: number;
  quality: 'std' | 'pro';
  generateAudio: boolean;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImages?: string[];
  resolution?: string;
  videoUrl?: string;
  extendDuration?: number;
}

interface VideoGenerationPanelProps {
  onVideoGenerate: (params: VideoGenerateParams) => void;
  onError?: (error: string) => void;
  themeStyle?: 'gold' | 'monochrome';
  /** 当前画布选中的图片URL，自动用作图生视频首帧 */
  selectedImageUrl?: string | null;
  /** 当前画布选中的视频URL，自动用作视频延长源 */
  selectedVideoUrl?: string | null;
  /** 从 /api/models?type=video 加载的服务器端视频模型列表 */
  serverVideoModels?: { id: string; name: string; providerId: string; providerName: string }[];
}

// 比例图形预览组件
function RatioPreview({ ratio, className = '' }: { ratio: string; className?: string }) {
  const parseRatio = (r: string): [number, number] => {
    const parts = r.split(':').map(Number);
    return parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) ? [parts[0], parts[1]] : [1, 1];
  };
  const [w, h] = parseRatio(ratio);
  const maxDim = 20;
  const scale = maxDim / Math.max(w, h);
  const pw = Math.round(w * scale);
  const ph = Math.round(h * scale);
  return (
    <svg width={pw} height={ph} className={className}>
      <rect width={pw} height={ph} rx={2} fill="currentColor" opacity={0.5} />
    </svg>
  );
}

export default function VideoGenerationPanel({
  onVideoGenerate,
  onError,
  themeStyle = 'gold',
  selectedImageUrl,
  selectedVideoUrl,
  serverVideoModels,
}: VideoGenerationPanelProps) {
  // === 状态 ===
  const [mode, setMode] = useState<'text2video' | 'image2video-first' | 'image2video-firstlast' | 'image2video-ref' | 'video-extend'>('text2video');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState<'std' | 'pro'>('std');
  const [generateAudio, setGenerateAudio] = useState(false);
  const [firstFrameUrl, setFirstFrameUrl] = useState<string>('');
  const [lastFrameUrl, setLastFrameUrl] = useState<string>('');
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resolution, setResolution] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [extendDuration, setExtendDuration] = useState(5);

  // 合并服务器模型与内置注册表
  const [videoModels, setVideoModels] = useState<{ id: string; name: string; providerId: string; providerName: string; region: 'cn' | 'global'; features: VideoModelInfo['features'] }[]>([]);

  // 自动从服务器加载视频模型（如果未通过 props 传入）
  useEffect(() => {
    if (serverVideoModels && serverVideoModels.length > 0) {
      const merged = serverVideoModels.map(sm => {
        const registry = VIDEO_MODEL_REGISTRY[sm.id];
        return {
          id: sm.id,
          name: sm.name || registry?.name || sm.id,
          providerId: sm.providerId,
          providerName: sm.providerName || registry?.provider || '',
          region: registry?.region || 'cn' as const,
          features: registry?.features || {
            firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false,
            audio: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p']
          },
        };
      });
      setVideoModels(merged);
      if (merged.length > 0 && !model) {
        setModel(merged[0].id);
      }
      return;
    }
    // 自动加载
    (async () => {
      try {
        const res = await fetch('/api/models?type=video');
        if (res.ok) {
          const data = await res.json();
          const vModels: { id: string; name: string; providerId: string; providerName: string }[] = [];
          const providerMap = new Map<string, string>();
          if (data.providers && Array.isArray(data.providers)) {
            for (const p of data.providers) {
              providerMap.set(p.id, p.name || p.displayName || '');
            }
          }
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              vModels.push({
                id: m.id || m.name,
                name: m.name || m.id || '',
                providerId: m.providerId || '',
                providerName: providerMap.get(m.providerId) || m.providerId || '',
              });
            }
          }
          const merged = vModels.map(sm => {
            const registry = VIDEO_MODEL_REGISTRY[sm.id];
            return {
              id: sm.id,
              name: sm.name || registry?.name || sm.id,
              providerId: sm.providerId,
              providerName: sm.providerName || registry?.provider || '',
              region: registry?.region || 'cn' as const,
              features: registry?.features || {
                firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false,
                audio: false, maxDuration: 10, aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p']
              },
            };
          });
          setVideoModels(merged);
          if (merged.length > 0 && !model) {
            setModel(merged[0].id);
          }
        }
      } catch {
        // 静默失败
      }
    })();
  }, [serverVideoModels, model]);

  // 当前模型信息
  const currentModel = videoModels.find(m => m.id === model);
  const currentFeatures = currentModel?.features;
  const currentRegistry = VIDEO_MODEL_REGISTRY[model];

  // 动态可选比例
  const availableRatios = currentFeatures?.aspectRatios || ['1:1', '4:3', '16:9', '9:16'];
  const availableDurations = currentFeatures?.durations || [5, 10];
  const availableResolutions = currentFeatures?.resolutions || ['720p', '1080p'];

  // 画布选中图片自动设为首帧
  useEffect(() => {
    if (selectedImageUrl && (mode === 'image2video-first' || mode === 'image2video-firstlast' || mode === 'image2video-ref')) {
      setFirstFrameUrl(selectedImageUrl);
    }
  }, [selectedImageUrl, mode]);

  // 画布选中视频自动设为延长源
  useEffect(() => {
    if (selectedVideoUrl && mode === 'video-extend') {
      setVideoUrl(selectedVideoUrl);
    }
  }, [selectedVideoUrl, mode]);

  // 切换模型时重置不支持的参数
  useEffect(() => {
    if (currentFeatures) {
      if (!availableRatios.includes(aspectRatio)) setAspectRatio(availableRatios[0]);
      if (!availableDurations.includes(duration)) setDuration(availableDurations[0]);
      if (!currentFeatures.firstLastFrame && mode === 'image2video-firstlast') setMode('image2video-first');
      if (!currentFeatures.multiReference && mode === 'image2video-ref') setMode('image2video-first');
      if (!currentFeatures.videoExtend && mode === 'video-extend') setMode('text2video');
      if (!currentFeatures.audio && generateAudio) setGenerateAudio(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // 模式切换
  const modeOptions: { value: VideoGenerateParams['mode']; label: string; icon: ReactNode }[] = [
    { value: 'text2video' as const, label: '文生视频', icon: <Video className="w-4 h-4" /> },
    { value: 'image2video-first' as const, label: '图生视频', icon: <ImagePlus className="w-4 h-4" /> },
  ];
  if (currentFeatures?.firstLastFrame) {
    modeOptions.push({ value: 'image2video-firstlast' as const, label: '首尾帧', icon: <ImagePlus className="w-4 h-4" /> });
  }
  if (currentFeatures?.multiReference) {
    modeOptions.push({ value: 'image2video-ref' as const, label: '多参考图', icon: <ImagePlus className="w-4 h-4" /> });
  }
  if (currentFeatures?.videoExtend) {
    modeOptions.push({ value: 'video-extend' as const, label: '视频延长', icon: <FastForward className="w-4 h-4" /> });
  }

  const handleGenerate = useCallback(() => {
    if (!prompt.trim() && mode === 'text2video') {
      onError?.('请输入视频描述');
      return;
    }
    if ((mode === 'image2video-first' || mode === 'image2video-firstlast' || mode === 'image2video-ref') && !firstFrameUrl) {
      onError?.('请上传或选择首帧图片');
      return;
    }
    if (mode === 'image2video-firstlast' && !lastFrameUrl) {
      onError?.('请上传尾帧图片');
      return;
    }
    if (mode === 'video-extend' && !videoUrl) {
      onError?.('请提供源视频URL');
      return;
    }
    if (!model) {
      onError?.('请选择视频模型');
      return;
    }

    setIsGenerating(true);
    setTimeout(() => setIsGenerating(false), 3000); // 3秒后恢复按钮（实际由外部控制）

    // 提取 providerId（如果 model 是复合键）
    const pureModelId = model.includes('::') ? model.split('::').pop()! : model;
    const providerId = model.includes('::') ? model.split('::')[0] : undefined;

    onVideoGenerate({
      prompt: prompt.trim(),
      mode,
      model: pureModelId,
      providerId,
      aspectRatio,
      duration,
      quality,
      generateAudio,
      firstFrameUrl: (mode !== 'text2video' && mode !== 'video-extend') ? firstFrameUrl : undefined,
      lastFrameUrl: (mode === 'image2video-firstlast') ? lastFrameUrl : undefined,
      referenceImages: (mode === 'image2video-ref') ? referenceImages : undefined,
      resolution,
      videoUrl: (mode === 'video-extend') ? videoUrl : undefined,
      extendDuration: (mode === 'video-extend') ? extendDuration : undefined,
    });
  }, [prompt, mode, model, aspectRatio, duration, quality, generateAudio, firstFrameUrl, lastFrameUrl, referenceImages, resolution, videoUrl, extendDuration, onVideoGenerate, onError]);

  // 处理图片上传
  const handleImageUpload = useCallback((target: 'first' | 'last' | 'ref') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/save-image', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.url) {
          if (target === 'first') setFirstFrameUrl(data.url);
          else if (target === 'last') setLastFrameUrl(data.url);
          else setReferenceImages(prev => [...prev, data.url]);
        }
      } catch {
        onError?.('图片上传失败');
      }
    };
    input.click();
  }, [onError]);

  // === 主题颜色 ===
  const isGold = themeStyle === 'gold';
  const accentColor = isGold ? '#d4af37' : '#8b8b8b';
  const panelBg = '#1a1a1a';
  const inputBg = '#242424';
  const borderColor = isGold ? 'rgba(212,175,55,0.3)' : 'rgba(139,139,139,0.3)';

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: panelBg, color: '#e0e0e0' }}>
      {/* === 模式切换 === */}
      <div className="flex gap-1 p-3 pb-1">
        {modeOptions.map(opt => (
          <button
            key={opt.value}
            onClick={() => setMode(opt.value)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer"
            style={{
              background: mode === opt.value ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(139,139,139,0.15)') : 'transparent',
              color: mode === opt.value ? accentColor : '#888',
              border: `1px solid ${mode === opt.value ? borderColor : 'transparent'}`,
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>

      {/* === 视频模型选择 === */}
      <div className="px-3 pt-2">
        <label className="text-xs text-gray-500 mb-1 block">视频模型</label>
        <div className="relative">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full px-3 py-2 rounded-md text-sm appearance-none cursor-pointer"
            style={{ background: inputBg, color: '#e0e0e0', border: `1px solid ${borderColor}` }}
          >
            {videoModels.length === 0 && (
              <option value="">请在管理员后台添加视频模型</option>
            )}
            {videoModels.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} {m.region === 'cn' ? '🇨🇳' : '🌍'} - {m.providerName || m.providerId}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
        </div>
      </div>

      {/* === 视频描述 === */}
      <div className="px-3 pt-3">
        <label className="text-xs text-gray-500 mb-1 block">视频描述</label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="描述你想生成的视频画面..."
          rows={3}
          className="w-full px-3 py-2 rounded-md text-sm resize-y min-h-[60px]"
          style={{ background: inputBg, color: '#e0e0e0', border: `1px solid ${borderColor}`, outline: 'none' }}
          onFocus={e => e.target.style.borderColor = accentColor}
          onBlur={e => e.target.style.borderColor = borderColor}
        />
      </div>

      {/* === 图片上传区（图生视频模式时显示） === */}
      {mode !== 'text2video' && (
        <div className="px-3 pt-3 space-y-2">
          {/* 首帧 */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">首帧图片</label>
            {firstFrameUrl ? (
              <div className="relative group">
                <img src={firstFrameUrl} alt="首帧" className="w-full h-24 object-cover rounded-md" style={{ border: `1px solid ${borderColor}` }} />
                <button
                  onClick={() => setFirstFrameUrl('')}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleImageUpload('first')}
                className="w-full h-24 rounded-md flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
                style={{ background: inputBg, border: `1px dashed ${borderColor}` }}
              >
                {selectedImageUrl ? (
                  <>
                    <img src={selectedImageUrl} alt="画布图片" className="w-full h-16 object-cover rounded opacity-50" />
                    <span className="text-xs text-gray-500">点击使用画布图片</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-gray-500" />
                    <span className="text-xs text-gray-500">上传首帧图片</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* 尾帧（首尾帧模式时显示） */}
          {mode === 'image2video-firstlast' && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">尾帧图片</label>
              {lastFrameUrl ? (
                <div className="relative group">
                  <img src={lastFrameUrl} alt="尾帧" className="w-full h-24 object-cover rounded-md" style={{ border: `1px solid ${borderColor}` }} />
                  <button
                    onClick={() => setLastFrameUrl('')}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleImageUpload('last')}
                  className="w-full h-24 rounded-md flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
                  style={{ background: inputBg, border: `1px dashed ${borderColor}` }}
                >
                  <Upload className="w-5 h-5 text-gray-500" />
                  <span className="text-xs text-gray-500">上传尾帧图片</span>
                </button>
              )}
            </div>
          )}

          {/* 多参考图 */}
          {mode === 'image2video-ref' && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">参考图（最多7张）</label>
              <div className="flex flex-wrap gap-2">
                {referenceImages.map((url, idx) => (
                  <div key={idx} className="relative group w-14 h-14">
                    <img src={url} alt={`参考${idx+1}`} className="w-full h-full object-cover rounded-md" style={{ border: `1px solid ${borderColor}` }} />
                    <button
                      onClick={() => setReferenceImages(prev => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5 text-white" />
                    </button>
                  </div>
                ))}
                {referenceImages.length < 7 && (
                  <button
                    onClick={() => handleImageUpload('ref')}
                    className="w-14 h-14 rounded-md flex items-center justify-center cursor-pointer transition-colors"
                    style={{ background: inputBg, border: `1px dashed ${borderColor}` }}
                  >
                    <Upload className="w-4 h-4 text-gray-500" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* === 视频延长区（视频延长模式时显示） === */}
      {mode === 'video-extend' && (
        <div className="px-3 pt-3 space-y-3">
          {/* 源视频 */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">源视频</label>
            {videoUrl ? (
              <div className="relative group flex items-center gap-2 p-2 rounded-md" style={{ background: inputBg, border: `1px solid ${borderColor}` }}>
                <Video className="w-5 h-5 shrink-0" style={{ color: accentColor }} />
                <span className="text-xs text-gray-400 truncate flex-1">{videoUrl.length > 60 ? videoUrl.substring(0, 60) + '...' : videoUrl}</span>
                <button
                  onClick={() => setVideoUrl('')}
                  className="w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedVideoUrl && (
                  <button
                    onClick={() => setVideoUrl(selectedVideoUrl)}
                    className="w-full py-2 rounded-md flex items-center justify-center gap-2 cursor-pointer transition-colors text-xs"
                    style={{ background: isGold ? 'rgba(212,175,55,0.1)' : 'rgba(139,139,139,0.1)', border: `1px solid ${borderColor}`, color: accentColor }}
                  >
                    <FastForward className="w-3.5 h-3.5" />
                    使用画布选中的视频
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="输入视频URL..."
                    className="flex-1 px-3 py-2 rounded-md text-xs"
                    style={{ background: inputBg, color: '#e0e0e0', border: `1px solid ${borderColor}`, outline: 'none' }}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value; if (v) setVideoUrl(v); } }}
                    onBlur={(e: React.FocusEvent<HTMLInputElement>) => { if (e.target.value) setVideoUrl(e.target.value); }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 延长时长 */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">延长时长</label>
            <div className="flex gap-1.5">
              {[4, 5, 8, 10].filter(d => d <= (currentFeatures?.maxDuration || 10)).map(d => (
                <button
                  key={d}
                  onClick={() => setExtendDuration(d)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer"
                  style={{
                    background: extendDuration === d ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(139,139,139,0.15)') : inputBg,
                    color: extendDuration === d ? accentColor : '#888',
                    border: `1px solid ${extendDuration === d ? borderColor : 'transparent'}`,
                  }}
                >
                  <Clock className="w-3 h-3" />
                  +{d}秒
                </button>
              ))}
            </div>
          </div>

          {/* 延长提示 */}
          <div className="flex items-start gap-1.5 p-2 rounded-md" style={{ background: 'rgba(212,175,55,0.05)', border: `1px solid rgba(212,175,55,0.1)` }}>
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: accentColor }} />
            <span className="text-xs text-gray-500">视频延长将在源视频末尾追加新内容，保持画面连贯性。可在描述中指定延长内容的方向。</span>
          </div>
        </div>
      )}

      {/* === 画面比例 === */}
      <div className="px-3 pt-3">
        <label className="text-xs text-gray-500 mb-1 block">画面比例</label>
        <div className="flex flex-wrap gap-1.5">
          {availableRatios.map(r => (
            <button
              key={r}
              onClick={() => setAspectRatio(r)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer"
              style={{
                background: aspectRatio === r ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(139,139,139,0.15)') : inputBg,
                color: aspectRatio === r ? accentColor : '#888',
                border: `1px solid ${aspectRatio === r ? borderColor : 'transparent'}`,
              }}
            >
              <RatioPreview ratio={r} />
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* === 视频时长 === */}
      <div className="px-3 pt-3">
        <label className="text-xs text-gray-500 mb-1 block">视频时长</label>
        <div className="flex gap-1.5">
          {availableDurations.map(d => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer"
              style={{
                background: duration === d ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(139,139,139,0.15)') : inputBg,
                color: duration === d ? accentColor : '#888',
                border: `1px solid ${duration === d ? borderColor : 'transparent'}`,
              }}
            >
              <Clock className="w-3 h-3" />
              {d}秒
            </button>
          ))}
        </div>
      </div>

      {/* === 生成质量 === */}
      <div className="px-3 pt-3">
        <label className="text-xs text-gray-500 mb-1 block">生成质量</label>
        <div className="flex gap-1.5">
          {(['std', 'pro'] as const).map(q => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className="px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer"
              style={{
                background: quality === q ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(139,139,139,0.15)') : inputBg,
                color: quality === q ? accentColor : '#888',
                border: `1px solid ${quality === q ? borderColor : 'transparent'}`,
              }}
            >
              {q === 'std' ? '标准' : '高品质'}
            </button>
          ))}
        </div>
      </div>

      {/* === 音效开关（仅支持音频的模型显示） === */}
      {currentFeatures?.audio && (
        <div className="px-3 pt-3">
          <button
            onClick={() => setGenerateAudio(!generateAudio)}
            className="flex items-center gap-2 text-xs cursor-pointer"
            style={{ color: generateAudio ? accentColor : '#888' }}
          >
            {generateAudio ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            {generateAudio ? '生成音效（已开启）' : '生成音效（已关闭）'}
          </button>
        </div>
      )}

      {/* === 高级设置 === */}
      <div className="px-3 pt-3">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" />
          高级设置
          <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>
        {showAdvanced && (
          <div className="mt-2 space-y-2 p-2 rounded-md" style={{ background: inputBg }}>
            {/* 分辨率选择 */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">分辨率</label>
              <div className="flex gap-1.5">
                {availableResolutions.map(r => (
                  <button
                    key={r}
                    onClick={() => setResolution(r)}
                    className="px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer"
                    style={{
                      background: resolution === r ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(139,139,139,0.15)') : '#2a2a2a',
                      color: resolution === r ? accentColor : '#888',
                      border: `1px solid ${resolution === r ? borderColor : 'transparent'}`,
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* === 模型能力提示 === */}
      {currentModel && (
        <div className="px-3 pt-3">
          <div className="flex items-start gap-1.5 p-2 rounded-md" style={{ background: 'rgba(212,175,55,0.05)', border: `1px solid rgba(212,175,55,0.1)` }}>
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: accentColor }} />
            <div className="text-xs text-gray-500 leading-relaxed">
              <span style={{ color: accentColor }}>{currentModel.name}</span>
              {' · '}支持
              {currentFeatures?.firstLastFrame && ' 首尾帧'}
              {currentFeatures?.multiReference && ' 多参考图'}
              {currentFeatures?.videoEdit && ' 视频编辑'}
              {currentFeatures?.videoExtend && ' 延长'}
              {currentFeatures?.audio && ' 音效'}
              {' · '}最长 {currentFeatures?.maxDuration || 10}秒
            </div>
          </div>
        </div>
      )}

      {/* === 生成按钮 === */}
      <div className="px-3 pt-4 pb-3 mt-auto">
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !model || (!prompt.trim() && mode !== 'video-extend')}
          className="w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: isGold
              ? (isGenerating ? 'rgba(212,175,55,0.3)' : 'linear-gradient(135deg, #d4af37, #b8962e)')
              : (isGenerating ? 'rgba(139,139,139,0.3)' : 'linear-gradient(135deg, #8b8b8b, #6b6b6b)'),
            color: '#fff',
            boxShadow: isGenerating ? 'none' : `0 2px 8px ${isGold ? 'rgba(212,175,55,0.3)' : 'rgba(139,139,139,0.3)'}`,
          }}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              提交中...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              生成视频
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export { VIDEO_MODEL_REGISTRY };
