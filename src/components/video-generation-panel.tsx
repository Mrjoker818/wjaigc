'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import * as React from 'react';
import {
  Play, Video, ImagePlus, Clock, Settings2,
  ChevronDown, Loader2, Sparkles, Volume2, VolumeX,
  Upload, X, AlertCircle, Info, FastForward, Users, Plus, Paintbrush, Film, Palette, Images,
  History, RotateCcw, Languages, GripVertical, Minus, Maximize2, ChevronRight, CheckCircle2,
  Clapperboard
} from 'lucide-react';
import MotionBrushCanvas, { type MotionBrushResult, type MotionBrushCanvasHandle } from './motion-brush-canvas';
import { inferVideoModelFeatures, VIDEO_MODEL_REGISTRY, type MotionBrushParams, type CameraControlParams, type VideoGenerateParams as VideoApiGenerateParams } from '@/lib/video-api';
import {
  buildNextShotFirstFramePrompt,
  buildShotPlanSystemPrompt,
  buildShotPlanUserMessage,
  parseShotPlanResponse,
} from '@/lib/video-director/continuity';
import type {
  VideoShotPlan,
  ShotPlanInput,
} from '@/lib/video-director/continuity';
import type { DirectorStyle, VideoReferenceBinding } from '@/lib/video-director/prompt-compiler';

// === 生成历史 ===
interface VideoHistoryEntry {
  id: string;
  timestamp: number;
  prompt: string;
  model: string;
  mode: string;
  aspectRatio: string;
  duration: number;
  thumbnailUrl?: string;
  videoUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
}

const VIDEO_HISTORY_KEY = 'wujie_video_gen_history';
const MAX_HISTORY_ENTRIES = 30;

function loadVideoHistory(): VideoHistoryEntry[] {
  try {
    const raw = localStorage.getItem(VIDEO_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveVideoHistory(entries: VideoHistoryEntry[]) {
  try {
    localStorage.setItem(VIDEO_HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)));
  } catch { /* quota exceeded */ }
}

// === 视频模板库 ===
interface VideoTemplate {
  id: string;
  name: string;
  category: 'product' | 'character' | 'landscape' | 'effect' | 'story';
  prompt: string;
  recommendedModel?: string;
  aspectRatio?: string;
  duration?: number;
  cameraControl?: CameraControlParams;
}

const VIDEO_TEMPLATES: VideoTemplate[] = [
  // 产品展示
  { id: 'product-rotate', name: '产品旋转展示', category: 'product', prompt: '一个产品在纯白背景上缓慢旋转，柔和的灯光，专业产品摄影风格', aspectRatio: '1:1', duration: 5, cameraControl: { type: 'orbit_right', intensity: 50 } },
  { id: 'product-zoom', name: '产品特写推进', category: 'product', prompt: '产品特写镜头缓慢推进，展示细节质感，电影级光影', aspectRatio: '16:9', duration: 5, cameraControl: { type: 'push_in', intensity: 30 } },
  { id: 'product-unbox', name: '产品开箱', category: 'product', prompt: '产品开箱过程，精致的包装缓缓打开，高级质感，暖色灯光', aspectRatio: '16:9', duration: 6 },
  { id: 'product-lifestyle', name: '生活场景植入', category: 'product', prompt: '产品在温馨生活场景中的使用画面，自然光，生活化氛围', aspectRatio: '16:9', duration: 5 },
  // 人物
  { id: 'character-portrait', name: '人物肖像', category: 'character', prompt: '一位优雅的人物肖像，柔和的背景光，电影级色彩', aspectRatio: '3:4', duration: 5 },
  { id: 'character-action', name: '人物动作', category: 'character', prompt: '人物做出流畅的动作，头发和衣服自然飘动，慢动作效果', aspectRatio: '16:9', duration: 5 },
  { id: 'character-walk', name: '人物行走', category: 'character', prompt: '人物自信地走向镜头，风衣微微飘动，电影感构图', aspectRatio: '16:9', duration: 5, cameraControl: { type: 'push_in', intensity: 20 } },
  { id: 'character-emotion', name: '表情特写', category: 'character', prompt: '人物面部表情特写，眼神细腻变化，柔和光晕，高级感', aspectRatio: '3:4', duration: 4 },
  // 风景
  { id: 'landscape-pan', name: '风景横摇', category: 'landscape', prompt: '壮丽的自然风景，山川河流，日出时分，金色阳光', aspectRatio: '21:9', duration: 8, cameraControl: { type: 'pan_right', intensity: 40 } },
  { id: 'landscape-aerial', name: '航拍视角', category: 'landscape', prompt: '航拍视角俯瞰大地，云层缭绕，壮观的自然景观', aspectRatio: '16:9', duration: 8, cameraControl: { type: 'push_in', intensity: 30 } },
  { id: 'landscape-timelapse', name: '延时摄影', category: 'landscape', prompt: '日落延时摄影，天空色彩渐变，云朵流动，从白天到黄昏', aspectRatio: '16:9', duration: 6 },
  { id: 'landscape-underwater', name: '水下世界', category: 'landscape', prompt: '水下世界，光线穿透水面，珊瑚和鱼群，宁静深蓝', aspectRatio: '16:9', duration: 5 },
  // 特效
  { id: 'effect-transition', name: '转场特效', category: 'effect', prompt: '粒子消散转场效果，从清晰到模糊，梦幻氛围', aspectRatio: '16:9', duration: 3 },
  { id: 'effect-slowmo', name: '慢动作', category: 'effect', prompt: '慢动作捕捉瞬间，水滴飞溅，时间凝固的感觉', aspectRatio: '16:9', duration: 5 },
  { id: 'effect-smoke', name: '烟雾弥漫', category: 'effect', prompt: '烟雾缓缓升起，光影交错，神秘氛围，暗调画面', aspectRatio: '16:9', duration: 5 },
  { id: 'effect-particles', name: '粒子飘散', category: 'effect', prompt: '金色粒子从中心向四周飘散，梦幻光效，唯美意境', aspectRatio: '1:1', duration: 4 },
  // 故事
  { id: 'story-opening', name: '故事开场', category: 'story', prompt: '电影开场镜头，从远景缓慢推进到主体，营造悬念氛围', aspectRatio: '2.35:1', duration: 8, cameraControl: { type: 'push_in', intensity: 20 } },
  { id: 'story-climax', name: '故事高潮', category: 'story', prompt: '紧张刺激的高潮场景，快速剪辑感，动态镜头', aspectRatio: '2.35:1', duration: 5, cameraControl: { type: 'tracking', intensity: 70 } },
  { id: 'story-ending', name: '故事收尾', category: 'story', prompt: '电影结尾镜头，从主体缓缓拉远，留白余韵，夕阳余晖', aspectRatio: '2.35:1', duration: 8, cameraControl: { type: 'push_out', intensity: 20 } },
];

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
    cameraControl: boolean;
    motionBrush: boolean;
    characterConsistency: boolean;
    multiShot: boolean;
    maxDuration: number;
    durations: number[];
    aspectRatios: string[];
    resolutions: string[];
  };
}

// === 参考图类型定义（导演扩展：语义化绑定参考角色） ===
export type ReferenceType =
  | 'character-front'
  | 'character-side'
  | 'character-back'
  | 'style'
  | 'scene'
  | 'composition'
  | 'motion'
  | 'lighting'
  | 'first-frame'
  | 'last-frame';

export interface TypedReference {
  id: string;
  url: string;
  type: ReferenceType;
  label?: string;
}

export const REFERENCE_TYPE_CONFIG: Record<ReferenceType, { label: string; icon: string; color: string; description: string }> = {
  'character-front': { label: '角色正面', icon: 'User', color: '#f59e0b', description: '角色正面照，用于保持人物外貌一致' },
  'character-side': { label: '角色侧面', icon: 'RotateCcw', color: '#f97316', description: '角色侧面/背面照，多角度约束' },
  'character-back': { label: '角色背面', icon: 'User', color: '#ea580c', description: '角色背面照，多视角一致性' },
  'style': { label: '风格参考', icon: 'Palette', color: '#a855f7', description: '画面风格、色调、艺术风格参考' },
  'scene': { label: '场景参考', icon: 'Mountain', color: '#22c55e', description: '背景环境、场景氛围参考' },
  'composition': { label: '构图参考', icon: 'LayoutGrid', color: '#06b6d4', description: '画面构图、取景、镜头角度参考' },
  'motion': { label: '运动参考', icon: 'Move', color: '#ec4899', description: '动作轨迹、运动节奏参考' },
  'lighting': { label: '光线参考', icon: 'Sun', color: '#eab308', description: '光照方向、光影氛围参考' },
  'first-frame': { label: '首帧', icon: 'Play', color: '#3b82f6', description: '视频起始画面' },
  'last-frame': { label: '尾帧', icon: 'Square', color: '#ef4444', description: '视频结束画面' },
};

// === 类型别名（避免魔法字符串） ===
type AspectRatio = string;
type VideoDuration = number;
type VideoMode = 'text2video' | 'image2video-first' | 'image2video-firstlast' | 'multi-shot' | 'video-extend' | 'image2video-ref';

// === 导演增强维度 ===
interface DirectorEnhanceResult {
  prompt: string;
  negativePrompt?: string;
  analysis: {
    subject: string;
    shot: string;
    camera: string;
    lighting: string;
    mood: string;
    audio: string;
  };
  model?: string;
  mode?: string;
  references?: Array<{ role: string; description: string }>;
  shotPlan?: VideoShotPlan[];
}

export interface VideoGenerateParams extends Omit<VideoApiGenerateParams, 'mode' | 'action' | 'imageUrl' | 'lastFrameImageUrl'> {
  prompt: string;
  mode: 'text2video' | 'image2video-first' | 'image2video-firstlast' | 'image2video-ref' | 'video-extend' | 'multi-shot';
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
  cameraControl?: CameraControlParams;
  motionBrush?: MotionBrushParams;
  characterReferences?: string[];
  motionStrength?: number;
  seed?: number;
  negativePrompt?: string;
  multiShotScenes?: Array<{ id: string; prompt: string; duration: number; cameraControl?: CameraControlParams }>;
  chainContinuity?: boolean;
  useGlobalReferences?: boolean;
  // 导演增强
  useDirector?: boolean;
  directorStyle?: DirectorStyle;
  compiledPrompt?: string;
  compiledNegative?: string;
  // 多镜头结构化计划
  shotPlan?: VideoShotPlan[];
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
  /** 是否以浮动弹窗模式显示 */
  floating?: boolean;
  /** 关闭浮动面板 */
  onClose?: () => void;
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
  floating = false,
  onClose,
}: VideoGenerationPanelProps) {
  // === 状态 ===
  const [mode, setMode] = useState<'text2video' | 'image2video-first' | 'image2video-ref' | 'video-extend' | 'multi-shot' | 'image2video-firstlast'>('text2video');
  const [prompt, setPrompt] = useState('');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [model, setModel] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState<'std' | 'pro'>('std');
  const [generateAudio, setGenerateAudio] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resolution, setResolution] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [extendDuration, setExtendDuration] = useState(5);
  const [panelMinimized, setPanelMinimized] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStage, setGenStage] = useState('');
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; panelX: number; panelY: number } | null>(null);

  // 初始居中定位
  useEffect(() => {
    if (floating && panelPosition === null && panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      setPanelPosition({
        x: (window.innerWidth - rect.width) / 2,
        y: (window.innerHeight - rect.height) / 2,
      });
    }
  }, [floating, panelPosition]);

  // 拖拽处理
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!floating || !panelRef.current) return;
    e.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panelX: rect.left,
      panelY: rect.top,
    };
    const handleMouseMove = (me: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = me.clientX - dragStartRef.current.x;
      const dy = me.clientY - dragStartRef.current.y;
      setPanelPosition({
        x: dragStartRef.current.panelX + dx,
        y: dragStartRef.current.panelY + dy,
      });
    };
    const handleMouseUp = () => {
      dragStartRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [floating]);

  // === 多参考图约束系统 ===
  const [typedReferences, setTypedReferences] = useState<TypedReference[]>([]);
  
  // 兼容：从 typedReferences 中提取首帧/尾帧/参考图
  const firstFrameUrl = typedReferences.find(r => r.type === 'first-frame')?.url || '';
  const lastFrameUrl = typedReferences.find(r => r.type === 'last-frame')?.url || '';
  const referenceImages = typedReferences.filter(r => r.type !== 'first-frame' && r.type !== 'last-frame' && r.type !== 'character-front' && r.type !== 'character-side').map(r => r.url);
  const characterReferences = typedReferences.filter(r => r.type === 'character-front' || r.type === 'character-side').map(r => r.url);

  // 添加/更新/删除参考图
  const addTypedReference = (url: string, type: ReferenceType = 'style') => {
    setTypedReferences(prev => [...prev, { id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, url, type }]);
  };
  const updateRefType = (id: string, type: ReferenceType) => {
    setTypedReferences(prev => prev.map(r => r.id === id ? { ...r, type } : r));
  };
  const removeTypedReference = (id: string) => {
    setTypedReferences(prev => prev.filter(r => r.id !== id));
  };
  const setFirstFrame = (url: string) => {
    setTypedReferences(prev => {
      const without = prev.filter(r => r.type !== 'first-frame');
      return url ? [...without, { id: `ref-first-${Date.now()}`, url, type: 'first-frame' as ReferenceType }] : without;
    });
  };
  const setLastFrame = (url: string) => {
    setTypedReferences(prev => {
      const without = prev.filter(r => r.type !== 'last-frame');
      return url ? [...without, { id: `ref-last-${Date.now()}`, url, type: 'last-frame' as ReferenceType }] : without;
    });
  };

  // === 多镜头叙事状态 ===
  const [multiShotScenes, setMultiShotScenes] = useState<Array<{ id: string; prompt: string; duration: number; cameraControl?: CameraControlParams }>>([
    { id: '1', prompt: '', duration: 5 },
  ]);
  const [showMultiShotPanel, setShowMultiShotPanel] = useState(false);
  const [chainContinuity, setChainContinuity] = useState(true); // 链式连贯：前段尾帧→后段首帧
  const [useGlobalReferences, setUseGlobalReferences] = useState(true); // 全局参考图注入
  const [videoHistory, setVideoHistory] = useState<VideoHistoryEntry[]>(loadVideoHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [templateFilter, setTemplateFilter] = useState<'all' | 'product' | 'character' | 'landscape' | 'effect' | 'story'>('all');

  // === 高级功能状态 ===
  const [cameraControl, setCameraControl] = useState<CameraControlParams | null>(null);
  const [motionBrush, setMotionBrush] = useState<MotionBrushParams | null>(null);
  const [showCameraPanel, setShowCameraPanel] = useState(false);
  const [showCharacterPanel, setShowCharacterPanel] = useState(false);
  const [showMotionBrush, setShowMotionBrush] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [motionStrength, setMotionStrength] = useState(50);
  const [batchCount, setBatchCount] = useState<1 | 2 | 4>(1); // 批量生成数量

  // === 导演增强状态 ===
  const [isDirectorEnhancing, setIsDirectorEnhancing] = useState(false);
  const [directorResult, setDirectorResult] = useState<DirectorEnhanceResult | null>(null);
  const [useDirector, setUseDirector] = useState(true);
  const [directorStyle, setDirectorStyle] = useState<DirectorStyle>('cinematic');
  const [directorEnhanceIntensity, setDirectorEnhanceIntensity] = useState<'soft' | 'standard' | 'cinematic'>('standard');

  // === 结构化镜头计划状态 ===
  const [shotPlans, setShotPlans] = useState<VideoShotPlan[]>([]);
  const [isPlanningShots, setIsPlanningShots] = useState(false);
  const [shotPlanOpen, setShotPlanOpen] = useState(false);
  const [currentGeneratingShotId, setCurrentGeneratingShotId] = useState<string | null>(null);
  const [diagnoseOpen, setDiagnoseOpen] = useState<string | null>(null); // 诊断哪个失败镜头

  // === 失败诊断 ===
  const handleDiagnoseFailed = async (shot: VideoShotPlan) => {
    if (!shot.error) return;
    try {
      const resp = await fetch('/api/video/director/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalPrompt: shot.prompt,
          error: shot.error,
          model: currentModel?.name || model,
        }),
      });
      const data = await resp.json();
      if (data.diagnosis && Array.isArray(data.diagnosis.issues)) {
        setShotPlans(prev => prev.map(s => s.id === shot.id ? { ...s, diagnosis: data.diagnosis.issues } : s));
      }
    } catch (e) { /* ignore */ }
  };

  // 合并服务器模型与内置注册表
  const [videoModels, setVideoModels] = useState<{ id: string; name: string; providerId: string; providerName: string; region: 'cn' | 'global'; features: VideoModelInfo['features'] }[]>([]);

  // 自动从服务器加载视频模型（如果未通过 props 传入）
  useEffect(() => {
    // 关键词推断模型能力（供未在注册表中硬编码的自定义模型使用）
    const inferFallbackFeatures = (modelId: string): VideoModelInfo['features'] => {
      const inferred = inferVideoModelFeatures(modelId);
      if (inferred) {
        return {
          firstLastFrame: inferred.firstLastFrame,
          multiReference: inferred.multiReference,
          videoEdit: inferred.videoEdit,
          videoExtend: inferred.videoExtend,
          audio: inferred.audio,
          cameraControl: inferred.cameraControl,
          motionBrush: inferred.motionBrush,
          characterConsistency: inferred.characterConsistency,
          multiShot: inferred.multiShot,
          maxDuration: inferred.maxDuration,
          durations: inferred.durations,
          aspectRatios: inferred.aspectRatios || inferred.ratios,
          resolutions: inferred.resolutions,
        };
      }
      return {
        firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true,
        audio: true, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false,
        maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'],
      };
    };
    if (serverVideoModels && serverVideoModels.length > 0) {
      const merged = serverVideoModels.map(sm => {
        const registry: any = VIDEO_MODEL_REGISTRY[sm.id as keyof typeof VIDEO_MODEL_REGISTRY];
        return {
          id: sm.id,
          name: sm.name || registry?.name || sm.id,
          providerId: sm.providerId,
          providerName: sm.providerName || registry?.provider || '',
          region: (registry?.region || 'cn') as 'cn' | 'global',
          features: registry?.features || inferFallbackFeatures(sm.id),
        };
      });
      setVideoModels(merged as any);
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
            const registry: any = VIDEO_MODEL_REGISTRY[sm.id as keyof typeof VIDEO_MODEL_REGISTRY];
            return {
              id: sm.id,
              name: sm.name || registry?.name || sm.id,
              providerId: sm.providerId,
              providerName: sm.providerName || registry?.provider || '',
              region: (registry?.region || 'cn') as 'cn' | 'global',
              features: registry?.features || inferFallbackFeatures(sm.id),
            };
          });
          setVideoModels(merged as any);
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

  // 首尾帧开关（图生视频模式内可展开尾帧）
  const [showLastFrame, setShowLastFrame] = useState(false);

  // 画布选中图片自动设为首帧
  useEffect(() => {
    if (selectedImageUrl && mode === 'image2video-first') {
      setFirstFrame(selectedImageUrl);
    }
  }, [selectedImageUrl, mode]);

  // 画布选中视频自动切到延长模式并设为源
  useEffect(() => {
    if (selectedVideoUrl) {
      if (currentFeatures?.videoExtend) {
        setMode('video-extend');
        setVideoUrl(selectedVideoUrl);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideoUrl]);

  // 切换模型时重置不支持的参数
  useEffect(() => {
    if (currentFeatures) {
      if (!availableRatios.includes(aspectRatio)) setAspectRatio(availableRatios[0]);
      if (!availableDurations.includes(duration)) setDuration(availableDurations[0]);
      if (!currentFeatures.firstLastFrame && showLastFrame) setShowLastFrame(false);
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
  // 首尾帧和多参考图已合并到图生视频模式内，不再作为独立 Tab
  if (currentFeatures?.videoExtend) {
    modeOptions.push({ value: 'video-extend' as const, label: '视频延长', icon: <FastForward className="w-4 h-4" /> });
  }
  // 多镜头叙事模式（所有模型都支持，通过串行生成实现）
  modeOptions.push({ value: 'multi-shot' as const, label: '多镜头叙事', icon: <Film className="w-4 h-4" /> });

  // === 运动笔刷处理 ===
  const motionBrushRef = useRef<MotionBrushCanvasHandle>(null);

  const handleMotionBrushExport = useCallback((result: MotionBrushResult) => {
    if (!result || result.trajectories.length === 0) {
      setMotionBrush(null);
      return;
    }
    // Convert MotionBrushResult to MotionBrushParams format
    const motionBrushParams: MotionBrushParams = {
      maskDataUrl: result.maskDataUrl,
      trajectories: result.trajectories.map(traj => ({
        startX: traj.startX,
        startY: traj.startY,
        endX: traj.endX,
        endY: traj.endY,
        speed: traj.speed,
      })),
    };
    setMotionBrush(motionBrushParams);
  }, []);

  // 提示词增强 - 调用 optimize-prompt API
  const handleEnhancePrompt = useCallback(async () => {
    if (!prompt.trim() || isEnhancing) return;
    setIsEnhancing(true);
    try {
      const res = await fetch('/api/optimize-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          mode: 'enhance',
          systemPrompt: `You are a professional AI video prompt optimizer. Transform a simple user video description into a high quality video generation prompt.

Rules:
1. Preserve the user's original intent.
2. Add concrete visual details: camera movement, lighting, color, motion, atmosphere, timing.
3. Focus on video-specific elements: transitions, camera angles, movement direction, speed.
4. Output bilingual keywords: first line in Chinese, second line in English.
5. Do NOT include any thinking process, explanation, reasoning, or analysis.
6. Do NOT include any formatting markers like 【】 or **.
7. Each line should be a comma-separated list of keywords/phrases only.`,
        }),
      });
      if (!res.ok) throw new Error('增强失败');
      const data = await res.json();
      if (data.optimized) {
        setPrompt(data.optimized);
      }
    } catch (err) {
      console.error('提示词增强失败:', err);
    } finally {
      setIsEnhancing(false);
    }
  }, [prompt, isEnhancing]);

  // === 导演级增强（P0）：普通描述 → 专业视频提示词 ===
  const handleDirectorEnhance = useCallback(async () => {
    if (!prompt.trim() || isDirectorEnhancing) return;
    setIsDirectorEnhancing(true);
    setGenStage('导演增强中...');
    try {
      // 收集当前参考图类型
      const refRoles: Record<string, string[]> = {};
      typedReferences.forEach(r => {
        if (!refRoles[r.type]) refRoles[r.type] = [];
        refRoles[r.type].push(r.url);
      });
      const res = await fetch('/api/video/director/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput: prompt,
          mode,
          model: currentModel?.name || model,
          aspectRatio,
          duration,
          intensity: directorEnhanceIntensity,
          referenceRoles: Object.keys(refRoles).length > 0 ? refRoles : undefined,
          firstFrameUrl: firstFrameUrl || undefined,
          lastFrameUrl: lastFrameUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导演增强失败');
      if (data.enhancedPrompt) {
        setPrompt(data.enhancedPrompt);
        if (data.negativePrompt) setNegativePrompt(data.negativePrompt);
        setDirectorResult({
          prompt: data.enhancedPrompt,
          negativePrompt: data.negativePrompt,
          analysis: data.analysis || {},
        });
        setGenStage('');
      }
    } catch (err) {
      console.error('导演增强失败:', err);
      setGenStage('');
    } finally {
      setIsDirectorEnhancing(false);
    }
  }, [prompt, isDirectorEnhancing, mode, model, currentModel, aspectRatio, duration, directorEnhanceIntensity, typedReferences, firstFrameUrl, lastFrameUrl]);

  // === AI 分镜规划（P2）：梗概 → 结构化镜头列表 ===
  const handlePlanShots = useCallback(async () => {
    if (!prompt.trim() || isPlanningShots) return;
    setIsPlanningShots(true);
    setGenStage('AI 规划分镜中...');
    try {
      const res = await fetch('/api/video/director/shot-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concept: prompt,
          totalDuration: duration,
          aspectRatio,
          model: currentModel?.name || model,
          maxShots: Math.min(6, Math.max(2, Math.ceil(duration / 4))),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '分镜规划失败');
      if (data.shots && Array.isArray(data.shots)) {
        const plans: VideoShotPlan[] = data.shots.map((s: any, idx: number) => ({
          id: `shot-${Date.now()}-${idx}`,
          title: s.title || `镜头 ${idx + 1}`,
          prompt: s.prompt || '',
          duration: s.duration || 5,
          aspectRatio: s.aspectRatio || aspectRatio,
          camera: s.camera || '',
          motion: s.motion || '',
          firstFrameFromPrev: idx > 0,
          status: 'pending' as const,
        }));
        setShotPlans(plans);
        setShotPlanOpen(true);
        setMode('multi-shot');
        setGenStage('');
      }
    } catch (err) {
      console.error('分镜规划失败:', err);
      setGenStage('');
    } finally {
      setIsPlanningShots(false);
    }
  }, [prompt, isPlanningShots, duration, aspectRatio, model, currentModel, mode]);

  // === 单独生成一个镜头（使用 onVideoGenerate 直接提交）===
  const handleGenerateSingleShot = async (shotId: string) => {
    const shot = shotPlans.find(s => s.id === shotId);
    if (!shot || !model) return;
    setCurrentGeneratingShotId(shotId);
    setShotPlans(prev => prev.map(s => s.id === shotId ? { ...s, status: 'generating' } : s));
    try {
      // 查找上一个已完成镜头的缩略图作为首帧近似
      const shotIdx = shotPlans.findIndex(s => s.id === shotId);
      let firstFrameForThis: string | undefined = firstFrameUrl || undefined;
      if (shotIdx > 0 && shot.firstFrameFromPrev) {
        const prev = shotPlans[shotIdx - 1];
        if (prev && prev.thumbnailUrl) firstFrameForThis = prev.thumbnailUrl;
        else if (prev && prev.videoUrl) firstFrameForThis = prev.videoUrl;
      }
      const pureModelId = model.includes('::') ? model.split('::').pop()! : model;
      const providerId = model.includes('::') ? model.split('::')[0] : undefined;
      const camControl = shot.cameraMotion ? { type: (cameraControl?.type || 'push_in'), intensity: motionStrength } : cameraControl || undefined;
      // 复用 onVideoGenerate 提交（传 useDirector: true 启用后端导演编译）
      await onVideoGenerate({
        prompt: shot.directedPrompt || shot.prompt,
        mode: firstFrameForThis ? 'image2video-first' : 'text2video',
        model: pureModelId,
        providerId,
        aspectRatio: shot.aspectRatio,
        duration: shot.duration,
        quality,
        generateAudio: !!shot.audioCues || generateAudio,
        firstFrameUrl: firstFrameForThis,
        lastFrameUrl: shotIdx === shotPlans.length - 1 ? (lastFrameUrl || undefined) : undefined,
        resolution,
        cameraControl: camControl,
        motionBrush: motionBrush || undefined,
        characterReferences: typedReferences.filter(r => r.type.startsWith('character-')).map(r => r.url),
        referenceImages: typedReferences.filter(r => !r.type.startsWith('character-') && r.type !== 'first-frame' && r.type !== 'last-frame').map(r => r.url),
        motionStrength: camControl ? motionStrength : undefined,
        seed,
        negativePrompt: negativePrompt.trim() || undefined,
        useDirector: true,
        directorStyle,
      });
      // 注意：onVideoGenerate 已经处理了 canvas 添加，这里将该镜头标记为 ready 并保存视频URL
      setShotPlans(prev => prev.map(s => s.id === shotId ? { ...s, status: 'ready' } : s));
    } catch (err: any) {
      setShotPlans(prev => prev.map(s => s.id === shotId ? { ...s, status: 'failed', error: err?.message || '生成失败' } : s));
    } finally {
      setCurrentGeneratingShotId(null);
    }
  };

  // === 批量生成所有镜头（串行）===
  const handleGenerateAllShots = async () => {
    for (const shot of shotPlans) {
      if (shot.status === 'ready' || shot.status === 'accepted') continue;
      await handleGenerateSingleShot(shot.id);
    }
  };

  // 中英翻译 - 调用 optimize-prompt API 的 translate 模式
  const handleTranslatePrompt = useCallback(async () => {
    if (!prompt.trim() || isTranslating) return;
    setIsTranslating(true);
    try {
      const res = await fetch('/api/optimize-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          mode: 'translate',
          systemPrompt: `You are a professional translator specializing in AI video generation prompts. Translate the given text between Chinese and English.

Rules:
1. If the input is in Chinese, translate to English. If the input is in English, translate to Chinese.
2. Preserve all visual, motion, and camera description details.
3. Use natural, fluent language appropriate for video generation prompts.
4. Do NOT add any extra creative details not present in the original.
5. Output ONLY the translated text, no explanations or formatting.`,
        }),
      });
      if (!res.ok) throw new Error('翻译失败');
      const data = await res.json();
      if (data.optimized) {
        setPrompt(data.optimized);
      }
    } catch (err) {
      console.error('提示词翻译失败:', err);
    } finally {
      setIsTranslating(false);
    }
  }, [prompt, isTranslating]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() && mode === 'text2video') {
      onError?.('请输入视频描述');
      return;
    }
    if (mode === 'image2video-first' && !firstFrameUrl) {
      onError?.('请上传或选择首帧图片');
      return;
    }
    if (mode === 'image2video-first' && showLastFrame && !lastFrameUrl) {
      onError?.('请上传尾帧图片');
      return;
    }
    if (mode === 'video-extend' && !videoUrl) {
      onError?.('请提供源视频URL');
      return;
    }
    if (mode === 'multi-shot' && multiShotScenes.every(s => !s.prompt.trim())) {
      onError?.('请至少输入一个镜头的描述');
      return;
    }
    if (!model) {
      onError?.('请选择视频模型');
      return;
    }

    setIsGenerating(true);
    setPanelMinimized(true);
    setGenProgress(5);
    setGenStage('准备提交...');
    const progressTimer = setInterval(() => {
      setGenProgress(prev => {
        if (prev < 25) return prev + 2;
        if (prev < 60) return prev + 0.8;
        if (prev < 90) return prev + 0.3;
        return prev;
      });
      setGenStage(prev => {
        if (prev === '准备提交...') return '排队中...';
        if (prev === '排队中...' && genProgress > 20) return '渲染中...';
        if (prev === '渲染中...' && genProgress > 70) return '合成音视频...';
        return prev;
      });
    }, 800);

    // 提取 providerId（如果 model 是复合键）
    const pureModelId = model.includes('::') ? model.split('::').pop()! : model;
    const providerId = model.includes('::') ? model.split('::')[0] : undefined;

    // 多镜头叙事模式：使用结构化 ShotPlans（优先）或旧的 multiShotScenes 兼容
    const finalPrompt = mode === 'multi-shot'
      ? (shotPlans.length > 0
        ? shotPlans.map((s, i) => `[镜头${i + 1}｜${s.shotSize}｜${s.cameraMove}] ${s.prompt}`).join('\n')
        : multiShotScenes.filter(s => s.prompt.trim()).map((s, i) => `[镜头${i + 1}] ${s.prompt}`).join('\n'))
      : prompt.trim();

    // 批量生成：为每个副本生成不同的随机种子
    const batchSeeds = Array.from({ length: batchCount }, (_, i) =>
      seed !== undefined ? seed + i : Math.floor(Math.random() * 2147483647)
    );

    try {
      // 批量并行提交
      const generatePromises = batchSeeds.map((currentSeed) =>
        onVideoGenerate({
          prompt: finalPrompt,
        mode,
        model: pureModelId,
        providerId,
        aspectRatio,
        duration,
        quality,
        generateAudio,
        firstFrameUrl: (mode === 'image2video-first') ? firstFrameUrl : undefined,
        lastFrameUrl: (mode === 'image2video-first' && showLastFrame) ? lastFrameUrl : undefined,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        resolution,
        videoUrl: (mode === 'video-extend') ? videoUrl : undefined,
        extendDuration: (mode === 'video-extend') ? extendDuration : undefined,
        // 高级参数
        cameraControl: cameraControl || undefined,
        motionBrush: motionBrush || undefined,
        characterReferences: characterReferences.length > 0 ? characterReferences : undefined,
        motionStrength: cameraControl ? motionStrength : undefined,
        seed: currentSeed,
        negativePrompt: negativePrompt.trim() || undefined,
        // 多镜头参数
        multiShotScenes: mode === 'multi-shot'
          ? (shotPlans.length > 0 ? shotPlans : multiShotScenes.filter(s => s.prompt.trim())) as any
          : undefined,
        chainContinuity: mode === 'multi-shot' ? chainContinuity : undefined,
        useGlobalReferences: mode === 'multi-shot' && useGlobalReferences ? true : undefined,
        // 导演增强
        useDirector: useDirector,
        directorStyle: directorStyle,
      })
    );

      await Promise.allSettled(generatePromises);
      clearInterval(progressTimer);
      setGenProgress(100);
      setGenStage('完成');
      setTimeout(() => {
        setIsGenerating(false);
        setGenProgress(0);
        setGenStage('');
      }, 1200);

      // 记录到生成历史
      const historyEntry: VideoHistoryEntry = {
        id: `vh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        prompt: finalPrompt,
        model: pureModelId,
        mode,
        aspectRatio,
        duration,
        firstFrameUrl: (mode === 'image2video-first') ? firstFrameUrl : undefined,
        lastFrameUrl: (mode === 'image2video-first' && showLastFrame) ? lastFrameUrl : undefined,
      };
      setVideoHistory(prev => {
        const updated = [historyEntry, ...prev].slice(0, MAX_HISTORY_ENTRIES);
        saveVideoHistory(updated);
        return updated;
      });
    } catch (err) {
      clearInterval(progressTimer);
      setGenProgress(0);
      setGenStage('');
      setIsGenerating(false);
      onError?.(err instanceof Error ? err.message : '生成失败');
    } finally {
      // setIsGenerating 已在成功路径延迟调用
    }
  }, [prompt, mode, model, aspectRatio, duration, quality, generateAudio, firstFrameUrl, lastFrameUrl, referenceImages, resolution, videoUrl, extendDuration, cameraControl, motionBrush, characterReferences, motionStrength, seed, negativePrompt, multiShotScenes, chainContinuity, useGlobalReferences, batchCount, showLastFrame, onVideoGenerate, onError]);

  // 从历史记录复用参数
  const reuseHistoryEntry = useCallback((entry: VideoHistoryEntry) => {
    setPrompt(entry.prompt);
    setAspectRatio(entry.aspectRatio);
    setDuration(entry.duration);
    if (entry.firstFrameUrl) {
      setFirstFrame(entry.firstFrameUrl);
    }
    if (entry.lastFrameUrl) {
      setLastFrame(entry.lastFrameUrl);
      if (!showLastFrame) setShowLastFrame(true);
    }
  }, [showLastFrame]);

  // 清空历史记录
  const clearHistory = useCallback(() => {
    setVideoHistory([]);
    saveVideoHistory([]);
  }, []);

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
          if (target === 'first') setFirstFrame(data.url);
          else if (target === 'last') setLastFrame(data.url);
          else addTypedReference(data.url, 'style');
        }
      } catch {
        onError?.('图片上传失败');
      }
    };
    input.click();
  }, [onError]);

  // === 主题颜色 ===
  const isGold = themeStyle === 'gold';
  const isMonochrome = themeStyle === 'monochrome';
  // Monochrome: white bg + blue accent (matches generation-panel & chat-panel)
  // Gold: dark bg + gold accent
  // Default: dark bg + blue accent
  const accentColor = isGold ? '#d4af37' : '#3b82f6';
  const panelBg = isMonochrome ? '#ffffff' : '#1a1a1a';
  const inputBg = isMonochrome ? '#ffffff' : isGold ? '#242424' : '#222222';
  const textColor = isMonochrome ? '#111827' : '#e0e0e0';
  const subTextColor = isMonochrome ? '#6b7280' : '#888';
  const borderColor = isMonochrome ? '#e5e7eb' : isGold ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.1)';
  const hoverBorderColor = isMonochrome ? 'border-blue-300' : isGold ? 'border-amber-500/50' : 'border-blue-500/50';
  const hoverBorderColorLight = isMonochrome ? 'hover:border-blue-300' : isGold ? 'hover:border-amber-500/30' : 'hover:border-blue-500/30';
  const accentTextClass = isMonochrome ? 'text-blue-500' : isGold ? 'text-amber-500' : 'text-blue-400';
  const borderActiveClass = isMonochrome ? 'border-blue-500' : isGold ? 'border-amber-500/50' : 'border-blue-500/50';
  const borderInactiveClass = isMonochrome ? 'border-gray-200' : 'border-gray-700';
  // Additional theme-aware classes for labels, text, borders
  const labelClass = 'text-[11px] font-semibold block mb-2 ' + (isMonochrome ? 'text-gray-500' : 'text-gray-400');
  const sectionTitleClass = isMonochrome ? 'text-xs font-semibold text-blue-500 whitespace-nowrap truncate' : 'text-xs font-semibold text-gray-300 whitespace-nowrap truncate';
  const subtleTextClass = isMonochrome ? 'text-gray-400' : 'text-gray-500';
  const subtleBorderClass = isMonochrome ? 'border-gray-200' : 'border-gray-600';
  const deepBorderClass = isMonochrome ? 'border-gray-200' : 'border-gray-700';
  // Monochrome-specific bg classes (matching chat-panel)
  const cardBgClass = isMonochrome ? 'bg-gray-50/50' : '';
  const sectionBgClass = isMonochrome ? 'bg-gray-50' : '';

  // 浮动面板样式（横向布局）
  const floatingWrapperClass = floating
    ? `fixed z-50 w-[820px] max-w-[92vw] flex rounded-2xl shadow-2xl overflow-hidden ${
        isMonochrome ? 'bg-white border border-gray-200' : 'bg-[#141418] border border-white/[0.08]'
      }`
    : 'flex flex-col min-h-full';

  const floatingStyle = floating ? {
    left: panelPosition ? `${panelPosition.x}px` : '50%',
    top: panelPosition ? `${panelPosition.y}px` : '50%',
    transform: panelPosition ? 'none' : 'translate(-50%, -50%)',
    maxHeight: '82vh',
    width: 'min(880px, 94vw)',
  } : {};

  return (
    <div
      ref={panelRef}
      className={floatingWrapperClass}
      style={{ background: !floating ? panelBg : undefined, color: textColor, ...floatingStyle } as React.CSSProperties}
      data-floating-panel="video"
    >
      {/* 浮动模式标题栏 */}
      {floating && (
        <div
          className={`flex items-center gap-2.5 px-5 py-3 cursor-move select-none flex-shrink-0 ${isMonochrome ? 'bg-[#f9fafb]' : 'bg-gradient-to-b from-[#161616] to-[#0f0f0f]'}`}
          style={{ borderBottom: `1px solid ${isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.06)'}` }}
          onMouseDown={handleDragStart}
        >
          <GripVertical size={16} style={{ color: isMonochrome ? '#9ca3af' : '#6b7280' }} className="shrink-0" />
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
            style={{ background: `linear-gradient(135deg, ${accentColor}, ${isMonochrome ? '#2563eb' : '#8b7225'})`, color: isMonochrome ? '#ffffff' : '#0a0a0a' }}
          >
            <Film className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-semibold leading-tight" style={{ color: textColor }}>视频生成器</h1>
            <p className="text-[11px] mt-0.5 leading-tight" style={{ color: subTextColor }}>文生视频 · 图生视频 · 首尾帧 · 多镜头 · 视频延长</p>
          </div>
          <div className="flex items-center gap-1.5">
            {isGenerating && (
              <div
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 shadow-sm"
                style={{ background: accentColor, color: isMonochrome ? '#fff' : '#0a0a0a' }}
              >
                <div className="w-2 h-2 rounded-full bg-white/90 animate-pulse" />
                生成中{genProgress > 0 ? ` ${Math.round(genProgress)}%` : ''}
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setPanelMinimized(!panelMinimized); }}
              className="p-2 rounded-lg transition-all duration-200 hover:scale-105"
              style={{ color: subTextColor, border: `1px solid ${isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.1)'}` }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.color = accentColor; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = subTextColor; }}
              title={panelMinimized ? '展开面板' : '最小化'}
            >
              {panelMinimized ? <Maximize2 size={15} /> : <Minus size={15} />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose?.(); }}
              className="p-2 rounded-lg transition-all duration-200 hover:scale-105"
              style={{ color: subTextColor, border: `1px solid ${isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.1)'}` }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,80,80,0.4)'; e.currentTarget.style.color = '#ff5555'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = subTextColor; }}
              title="关闭"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {panelMinimized ? null : (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* 非浮动模式简易头部 */}
        {!floating && (
          <div className="px-5 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
            <h2 className="text-lg font-bold" style={{ color: textColor }}>视频生成</h2>
            {onClose && (
              <button onClick={onClose} className="p-1.5 rounded-md hover:bg-black/5 transition-colors" style={{ color: subTextColor }}>
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* 模式切换 */}
        <div className={`flex gap-1.5 px-5 py-1 flex-shrink-0 ${isMonochrome ? 'bg-gray-100 rounded-xl mx-5 mt-3 p-1.5' : 'mx-5 mt-3'}`}>
          {modeOptions.map(opt => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setMode(opt.value)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
                style={isMonochrome ? {
                  background: active ? '#2563eb' : '#fff',
                  color: active ? '#fff' : '#6b7280',
                  boxShadow: active ? '0 2px 8px rgba(37,99,235,0.25)' : 'none',
                } : {
                  background: active ? accentColor : 'rgba(255,255,255,0.03)',
                  color: active ? (isGold ? '#0a0a0a' : '#fff') : subTextColor,
                  border: `1px solid ${active ? accentColor : 'rgba(255,255,255,0.08)'}`,
                  boxShadow: active ? `0 2px 8px ${accentColor}40` : 'none',
                }}
              >
                {opt.icon}
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* 主体滚动区 - 两列布局 */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-x-5 gap-y-0 px-5 pt-4 overflow-y-auto min-h-0">
          {/* ======== 左列：风格预设 + 模型 ======== */}
          <div className="flex flex-col gap-4 pb-4">
            {/* 风格预设 */}
            <div>
              <label className={labelClass}>视频风格模板</label>
              <div className="flex gap-1 mb-2 overflow-x-auto pb-0.5">
                {[
                  { id: 'all', label: '全部' },
                  { id: 'product', label: '产品' },
                  { id: 'character', label: '人物' },
                  { id: 'landscape', label: '风景' },
                  { id: 'effect', label: '特效' },
                  { id: 'story', label: '故事' },
                ].map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setTemplateFilter(cat.id as any)}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 cursor-pointer"
                    style={{
                      background: templateFilter === cat.id ? (isGold ? `${accentColor}25` : `${accentColor}20`) : isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.04)',
                      color: templateFilter === cat.id ? accentColor : subTextColor,
                      border: `1px solid ${templateFilter === cat.id ? accentColor : 'transparent'}`,
                    }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-[260px] overflow-y-auto pr-1">
                {VIDEO_TEMPLATES.filter(t => templateFilter === 'all' || t.category === templateFilter).map(template => (
                  <button
                    key={template.id}
                    onClick={() => {
                      setPrompt(template.prompt);
                      if (template.aspectRatio && availableRatios.includes(template.aspectRatio)) setAspectRatio(template.aspectRatio);
                      if (template.duration && availableDurations.includes(template.duration)) setDuration(template.duration);
                      if (template.cameraControl) setCameraControl(template.cameraControl);
                    }}
                    className="text-left p-2.5 rounded-lg transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-md"
                    style={{
                      background: inputBg,
                      border: `1px solid ${borderColor}`,
                    }}
                    title={template.prompt}
                  >
                    <div className="font-semibold truncate text-[12px]" style={{ color: isMonochrome ? '#1f2937' : '#e5e7eb' }}>{template.name}</div>
                    <div className="truncate opacity-70 mt-1 text-[10px]" style={{ color: subTextColor }}>{template.aspectRatio} · {template.duration}s</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 模型选择 */}
            <div>
              <label className="text-[11px] font-semibold mb-2 block" style={{ color: subTextColor }}>视频模型</label>
              <div className="relative">
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg text-[13px] appearance-none cursor-pointer font-medium focus:outline-none transition-colors"
                  style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
                >
                  {videoModels.length === 0 && <option value="">请在管理员后台添加视频模型</option>}
                  {videoModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name} {m.region === 'cn' ? '🇨🇳' : '🌍'} - {m.providerName || m.providerId}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: subTextColor }} />
              </div>
              {currentModel && (
                <div className="mt-2 flex items-start gap-1.5 p-2 rounded-md text-[11px] leading-relaxed" style={{ background: isGold ? 'rgba(212,175,55,0.05)' : isMonochrome ? 'rgba(107,114,128,0.05)' : 'rgba(59,130,246,0.05)', border: `1px solid ${isGold ? 'rgba(212,175,55,0.1)' : isMonochrome ? 'rgba(107,114,128,0.15)' : 'rgba(59,130,246,0.1)'}` }}>
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: accentColor }} />
                  <div style={{ color: subTextColor }}>
                    <span style={{ color: accentColor, fontWeight: 600 }}>{currentModel.name}</span>
                    {' · '}最长 {currentFeatures?.maxDuration || 10}秒 · 支持{currentFeatures?.audio ? '音效' : ''}{currentFeatures?.firstLastFrame ? ' · 首尾帧' : ''}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ======== 右列：描述 + 参数 + 生成 ======== */}
          <div className="flex flex-col gap-4 pb-4 min-w-0">
            {/* 视频描述 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: subTextColor }}>
                  视频描述
                  <span
                    className="px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-all select-none"
                    style={{
                      background: useDirector ? 'linear-gradient(135deg,#d4af37,#b8962e)' : isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.05)',
                      color: useDirector ? '#0a0a0a' : subTextColor,
                      border: useDirector ? 'none' : `1px solid ${borderColor}`,
                      boxShadow: useDirector ? '0 2px 6px rgba(212,175,55,0.3)' : 'none',
                    }}
                    onClick={() => setUseDirector(!useDirector)}
                    title="导演增强：自动补充运镜/光线/表演/氛围"
                  >🎬 导演{useDirector ? '✓' : ''}</span>
                </label>
                <div className="flex gap-1.5 items-center">
                  {useDirector && (
                    <select
                      value={directorStyle}
                      onChange={e => setDirectorStyle(e.target.value as any)}
                      className="px-2 py-1 rounded text-[10px] cursor-pointer appearance-none pr-5 bg-no-repeat"
                      style={{
                        background: isGold ? 'rgba(212,175,55,0.1)' : 'rgba(59,130,246,0.1)',
                        color: accentColor,
                        border: `1px solid ${isGold ? 'rgba(212,175,55,0.3)' : 'rgba(59,130,246,0.3)'}`,
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%23d4af37' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                        backgroundPosition: 'right 4px center',
                        backgroundSize: '8px',
                      }}
                    >
                      <option value="cinematic">🎬 电影叙事</option>
                      <option value="product">📦 产品展示</option>
                      <option value="music-video">🎵 MV风格</option>
                      <option value="documentary">📹 纪实</option>
                      <option value="anime">🎌 动漫</option>
                      <option value="horror">👻 悬疑</option>
                      <option value="action">💥 动作</option>
                      <option value="comedy">😄 喜剧</option>
                      <option value="fashion">👗 时尚</option>
                      <option value="sci-fi">🚀 科幻</option>
                    </select>
                  )}
                  <button
                    onClick={handleTranslatePrompt}
                    disabled={!prompt.trim() || isTranslating}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all disabled:opacity-30 cursor-pointer"
                    style={{ background: isMonochrome ? 'rgba(107,114,128,0.1)' : 'rgba(255,255,255,0.05)', color: subTextColor }}
                  >
                    {isTranslating ? <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" /> : <Languages className="w-2.5 h-2.5" />}
                    中英
                  </button>
                </div>
              </div>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder={mode === 'video-extend' ? '描述希望延长的内容方向，如：继续向前推进、保持人物动作...' : useDirector ? '输入创意/剧本/想法，导演会自动补充运镜/光线/表演/氛围...' : '描述你想生成的视频画面，如：一位女性在海边漫步，夕阳西下，金色的阳光洒在海面上...'}
                rows={4}
                className="w-full px-3.5 py-2.5 rounded-lg text-[13px] resize-none focus:outline-none transition-colors leading-relaxed"
                style={{
                  background: inputBg,
                  color: textColor,
                  border: `1px solid ${useDirector ? (isGold ? 'rgba(212,175,55,0.4)' : 'rgba(59,130,246,0.4)') : borderColor}`,
                  boxShadow: useDirector ? `0 0 0 1px ${isGold ? 'rgba(212,175,55,0.1)' : 'rgba(59,130,246,0.1)'}` : 'none',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = accentColor; }}
                onBlur={e => { e.currentTarget.style.borderColor = useDirector ? (isGold ? 'rgba(212,175,55,0.4)' : 'rgba(59,130,246,0.4)') : borderColor; }}
              />
              {useDirector && prompt.trim() && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px]" style={{ color: accentColor }}>
                  <Clapperboard className="w-3 h-3" />
                  <span>导演模式已开启：生成时自动编排镜头景别/运镜/光影/表演/声音</span>
                </div>
              )}
              {/* 快捷标签 */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {['电影感', '慢动作', '微距特写', '航拍', ' cinematic lighting', '4K'].map(tag => (
                  <button
                    key={tag}
                    onClick={() => setPrompt(prev => prev ? `${prev}, ${tag}` : tag)}
                    className="px-2 py-0.5 rounded text-[10px] transition-all cursor-pointer"
                    style={{ background: isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.05)', color: subTextColor }}
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* 图生视频：首帧/尾帧上传 */}
            {mode === 'image2video-first' && (
              <div className="p-3 rounded-lg space-y-3" style={{ background: isMonochrome ? '#f9fafb' : 'rgba(255,255,255,0.02)', border: `1px solid ${borderColor}` }}>
                <div>
                  <label className="text-[11px] font-semibold mb-1.5 flex items-center gap-1" style={{ color: subTextColor }}>
                    <ImagePlus className="w-3.5 h-3.5" style={{ color: accentColor }} />首帧图片（起始画面）
                  </label>
                  {firstFrameUrl ? (
                    <div className="relative group aspect-video rounded-lg overflow-hidden" style={{ border: `2px solid ${accentColor}40` }}>
                      <img src={firstFrameUrl} alt="首帧" className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
                        <span className="text-white text-[10px]">首帧已设置</span>
                      </div>
                      <button onClick={() => setFirstFrame('')} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">×</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleImageUpload('first')}
                      className="w-full aspect-video rounded-lg flex flex-col items-center justify-center gap-1 transition-all cursor-pointer border-2 border-dashed hover:scale-[1.01]"
                      style={{ borderColor: borderColor, background: inputBg }}
                    >
                      <Upload className="w-6 h-6" style={{ color: subTextColor }} />
                      <span className="text-xs" style={{ color: subTextColor }}>上传首帧图片</span>
                      {selectedImageUrl && <span className="text-[10px]" style={{ color: accentColor }}>已自动填充画布选中图片</span>}
                    </button>
                  )}
                </div>
                {currentFeatures?.firstLastFrame && (
                  <div>
                    <button
                      onClick={() => setShowLastFrame(!showLastFrame)}
                      className="flex items-center gap-2 text-xs cursor-pointer transition-colors"
                      style={{ color: showLastFrame ? accentColor : subTextColor }}
                    >
                      <div className="w-8 h-4 rounded-full relative transition-colors" style={{ background: showLastFrame ? accentColor : 'rgba(255,255,255,0.15)' }}>
                        <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow-sm" style={{ left: showLastFrame ? '18px' : '2px' }} />
                      </div>
                      添加尾帧（视频结束画面）
                    </button>
                    {showLastFrame && (
                      <div className="mt-2">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="flex-1 h-px" style={{ background: `${accentColor}30` }} />
                          <span className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: accentColor }}>
                            <FastForward className="w-3 h-3" />尾帧
                          </span>
                          <div className="flex-1 h-px" style={{ background: `${accentColor}30` }} />
                        </div>
                        {lastFrameUrl ? (
                          <div className="relative group aspect-video rounded-lg overflow-hidden" style={{ border: `2px solid ${accentColor}40` }}>
                            <img src={lastFrameUrl} alt="尾帧" className="w-full h-full object-cover" />
                            <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
                              <span className="text-white text-[10px]">尾帧已设置</span>
                            </div>
                            <button onClick={() => setLastFrame('')} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">×</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleImageUpload('last')}
                            className="w-full aspect-video rounded-lg flex flex-col items-center justify-center gap-1 transition-all cursor-pointer border-2 border-dashed hover:scale-[1.01]"
                            style={{ borderColor: borderColor, background: inputBg }}
                          >
                            <Upload className="w-6 h-6" style={{ color: subTextColor }} />
                            <span className="text-xs" style={{ color: subTextColor }}>上传尾帧图片</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* 多参考图 */}
                {currentFeatures?.multiReference && (
                  <div style={{ borderTop: `1px solid ${borderColor}` }} className="pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold flex items-center gap-1" style={{ color: subTextColor }}>
                        <Images className="w-3.5 h-3.5" />风格/场景参考图
                      </span>
                      <button onClick={() => handleImageUpload('ref')} className="text-[10px] px-2 py-0.5 rounded transition-colors cursor-pointer" style={{ color: accentColor, background: isGold ? 'rgba(212,175,55,0.1)' : 'rgba(59,130,246,0.1)' }}>+ 添加</button>
                    </div>
                    {referenceImages.length > 0 ? (
                      <div className="space-y-1.5 mb-2">
                        {typedReferences.filter(r => r.type !== 'first-frame' && r.type !== 'last-frame' && r.type !== 'character-front' && r.type !== 'character-side').map(ref => (
                          <div key={ref.id} className="flex items-center gap-2 rounded-lg p-1.5 group" style={{ background: inputBg }}>
                            <img src={ref.url} alt="ref" className="w-10 h-10 rounded object-cover" />
                            <select
                              value={ref.type}
                              onChange={e => updateRefType(ref.id, e.target.value as ReferenceType)}
                              className="flex-1 text-[11px] px-2 py-1 rounded cursor-pointer"
                              style={{ background: isMonochrome ? '#fff' : '#1a1a1a', color: textColor, border: `1px solid ${borderColor}` }}
                            >
                              <option value="style">🎨 风格参考</option>
                              <option value="scene">🏔️ 场景参考</option>
                              <option value="composition">📐 构图参考</option>
                              <option value="motion">💨 运动参考</option>
                              <option value="lighting">💡 光线参考</option>
                              <option value="character-back">👤 角色背面</option>
                            </select>
                            <button onClick={() => removeTypedReference(ref.id)} className="opacity-0 group-hover:opacity-100 text-red-400 w-6 h-6 rounded flex items-center justify-center cursor-pointer">×</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px]" style={{ color: subTextColor }}>添加参考图可帮助AI更好理解画面风格和场景</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 视频延长模式：源视频 */}
            {mode === 'video-extend' && (
              <div className="p-3 rounded-lg space-y-3" style={{ background: isMonochrome ? '#f9fafb' : 'rgba(255,255,255,0.02)', border: `1px solid ${borderColor}` }}>
                <div>
                  <label className={labelClass}>源视频</label>
                  {videoUrl ? (
                    <div className="relative group flex items-center gap-2 p-2.5 rounded-md" style={{ background: inputBg, border: `1px solid ${borderColor}` }}>
                      <Video className="w-5 h-5 shrink-0" style={{ color: accentColor }} />
                      <span className="text-xs truncate flex-1" style={{ color: subTextColor }}>{videoUrl.length > 60 ? videoUrl.substring(0, 60) + '...' : videoUrl}</span>
                      <button onClick={() => setVideoUrl('')} className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-full flex items-center justify-center text-red-400 cursor-pointer">×</button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={videoUrl}
                        onChange={e => setVideoUrl(e.target.value)}
                        placeholder="输入视频URL（画布选中视频会自动填充）"
                        className="w-full px-3 py-2 rounded-md text-xs focus:outline-none"
                        style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
                      />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => handleImageUpload('first')} className="flex-1 py-2 rounded-md text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer" style={{ background: inputBg, color: subTextColor, border: `1px dashed ${borderColor}` }}>
                          <Upload className="w-3 h-3" />上传视频
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <label className={labelClass}>延长时长</label>
                  <div className="flex gap-1.5">
                    {[3, 5, 8, 10].filter(d => availableDurations.includes(d as any)).map(d => (
                      <button
                        key={d}
                        onClick={() => setExtendDuration(d)}
                        className="flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all cursor-pointer"
                        style={{
                          background: extendDuration === d ? accentColor : inputBg,
                          color: extendDuration === d ? (isGold ? '#0a0a0a' : '#fff') : subTextColor,
                          border: `1px solid ${extendDuration === d ? accentColor : borderColor}`,
                          boxShadow: extendDuration === d ? `0 2px 8px ${accentColor}30` : 'none',
                        }}
                      >{d}秒</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 参数三行网格：比例 / 时长 / 质量 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>画面比例</label>
                <div className="flex flex-wrap gap-1">
                  {availableRatios.map(r => (
                    <button
                      key={r}
                      onClick={() => setAspectRatio(r)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer"
                      style={{
                        background: aspectRatio === r ? (isGold ? 'rgba(212,175,55,0.18)' : 'rgba(59,130,246,0.18)') : inputBg,
                        color: aspectRatio === r ? accentColor : subTextColor,
                        border: `1px solid ${aspectRatio === r ? accentColor : borderColor}`,
                      }}
                    >
                      <RatioPreview ratio={r} />
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>视频时长</label>
                <div className="flex gap-1">
                  {availableDurations.map(d => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer"
                      style={{
                        background: duration === d ? (isGold ? 'rgba(212,175,55,0.18)' : 'rgba(59,130,246,0.18)') : inputBg,
                        color: duration === d ? accentColor : subTextColor,
                        border: `1px solid ${duration === d ? accentColor : borderColor}`,
                      }}
                    >
                      <Clock className="w-3 h-3 inline mr-0.5" />{d}s
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>生成质量</label>
                <div className="flex gap-1">
                  {(['std', 'pro'] as const).map(q => (
                    <button
                      key={q}
                      onClick={() => setQuality(q)}
                      className="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer"
                      style={{
                        background: quality === q ? (isGold ? 'rgba(212,175,55,0.18)' : 'rgba(59,130,246,0.18)') : inputBg,
                        color: quality === q ? accentColor : subTextColor,
                        border: `1px solid ${quality === q ? accentColor : borderColor}`,
                      }}
                    >{q === 'std' ? '标准' : '高清'}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* 生成数量 */}
            <div>
              <label className={labelClass}>生成数量</label>
              <div className="flex items-center gap-2">
                {([1, 2, 4] as const).map(n => (
                  <button
                    key={n}
                    onClick={() => setBatchCount(n)}
                    className="w-12 h-9 rounded-md text-xs font-semibold transition-all cursor-pointer"
                    style={{
                      background: batchCount === n ? accentColor : inputBg,
                      color: batchCount === n ? (isGold ? '#0a0a0a' : '#fff') : subTextColor,
                      border: `1px solid ${batchCount === n ? accentColor : borderColor}`,
                      boxShadow: batchCount === n ? `0 2px 8px ${accentColor}30` : 'none',
                    }}
                  >{n}x</button>
                ))}
                {batchCount > 1 && <span className="text-[10px] ml-auto" style={{ color: subTextColor }}>生成 {batchCount} 个视频（不同种子）</span>}
              </div>
            </div>

            {/* 音效开关 */}
            {currentFeatures?.audio && (
              <button
                onClick={() => setGenerateAudio(!generateAudio)}
                className="flex items-center gap-2 text-xs cursor-pointer py-1 transition-colors"
                style={{ color: generateAudio ? accentColor : subTextColor }}
              >
                {generateAudio ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                {generateAudio ? '音效已开启（视频自带声音）' : '开启音效'}
              </button>
            )}

            {/* 高级折叠区：摄像机/角色/运动笔刷/多镜头/高级设置 */}
            {mode !== 'video-extend' && (
              <CollapsibleSection
                title="摄像机控制"
                icon={<Video className="w-4 h-4" />}
                iconColor={cameraControl ? accentColor : subTextColor}
                badge={cameraControl ? cameraControl.type.replace('_', ' ') : undefined}
                defaultOpen={false}
                isMonochrome={isMonochrome}
                accentColor={accentColor}
                inputBg={inputBg}
                borderColor={borderColor}
                subTextColor={subTextColor}
                textColor={textColor}
              >
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { type: 'push_in', label: '推进', icon: '→' },
                    { type: 'push_out', label: '拉出', icon: '←' },
                    { type: 'pan_left', label: '左摇', icon: '◀' },
                    { type: 'pan_right', label: '右摇', icon: '▶' },
                    { type: 'tilt_up', label: '上仰', icon: '▲' },
                    { type: 'tilt_down', label: '下俯', icon: '▼' },
                    { type: 'orbit_left', label: '左环绕', icon: '↺' },
                    { type: 'orbit_right', label: '右环绕', icon: '↻' },
                    { type: 'zoom_in', label: '放大', icon: '⊕' },
                    { type: 'zoom_out', label: '缩小', icon: '⊖' },
                    { type: 'tracking', label: '跟踪', icon: '◎' },
                    { type: 'static', label: '静止', icon: '□' },
                  ].map(cam => {
                    const active = cameraControl?.type === cam.type;
                    return (
                      <button
                        key={cam.type}
                        onClick={() => setCameraControl(active ? null : { type: cam.type as CameraControlParams['type'], intensity: 50 })}
                        className="flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-md text-[10px] font-medium transition-all cursor-pointer"
                        style={{
                          background: active ? accentColor : inputBg,
                          color: active ? (isGold ? '#0a0a0a' : '#fff') : subTextColor,
                          border: `1px solid ${active ? accentColor : borderColor}`,
                        }}
                      >
                        <span className="text-sm">{cam.icon}</span>
                        <span>{cam.label}</span>
                      </button>
                    );
                  })}
                </div>
                {cameraControl && cameraControl.type !== 'static' && (
                  <div className="mt-3 space-y-1">
                    <label className="text-[10px] flex justify-between" style={{ color: subTextColor }}>
                      <span>运动强度</span><span>{motionStrength}%</span>
                    </label>
                    <input
                      type="range" min={10} max={100} value={motionStrength}
                      onChange={e => setMotionStrength(Number(e.target.value))}
                      className="w-full h-1 rounded-lg appearance-none cursor-pointer"
                      style={{ background: `linear-gradient(to right, ${accentColor} ${motionStrength}%, ${isMonochrome ? '#ddd' : '#333'} ${motionStrength}%)` }}
                    />
                  </div>
                )}
                {cameraControl && (
                  <button onClick={() => { setCameraControl(null); }} className="text-[10px] mt-2 cursor-pointer" style={{ color: subTextColor }}>清除摄像机控制</button>
                )}
              </CollapsibleSection>
            )}

            {mode !== 'video-extend' && (
              <CollapsibleSection
                title="角色一致性"
                icon={<Users className="w-4 h-4" />}
                iconColor={characterReferences.length > 0 ? accentColor : subTextColor}
                badge={characterReferences.length > 0 ? `${characterReferences.length}张` : undefined}
                defaultOpen={false}
                isMonochrome={isMonochrome}
                accentColor={accentColor}
                inputBg={inputBg}
                borderColor={borderColor}
                subTextColor={subTextColor}
                textColor={textColor}
              >
                <p className="text-[10px] mb-2" style={{ color: subTextColor }}>上传角色正面/侧面照，AI将保持角色外观一致</p>
                <div className="flex flex-wrap gap-2">
                  {typedReferences.filter(r => r.type === 'character-front' || r.type === 'character-side').map(ref => (
                    <div key={ref.id} className="relative w-16 h-16 rounded-md overflow-hidden group">
                      <img src={ref.url} alt={ref.type} className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center py-0.5 bg-black/60 text-white truncate">{REFERENCE_TYPE_CONFIG[ref.type]?.label}</span>
                      <button onClick={() => removeTypedReference(ref.id)} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">×</button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
                        const fd = new FormData(); fd.append('file', file);
                        const res = await fetch('/api/save-image', { method: 'POST', body: fd });
                        const data = await res.json(); if (data.url) addTypedReference(data.url, 'character-front');
                      };
                      input.click();
                    }}
                    className="w-16 h-16 rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors hover:scale-105"
                    style={{ borderColor: borderColor }}
                  >
                    <Plus className="w-4 h-4" style={{ color: accentColor }} />
                    <span className="text-[9px]" style={{ color: subTextColor }}>添加</span>
                  </button>
                </div>
              </CollapsibleSection>
            )}

            {mode === 'image2video-first' && firstFrameUrl && currentFeatures?.motionBrush && (
              <CollapsibleSection
                title="运动笔刷"
                icon={<Paintbrush className="w-4 h-4" />}
                iconColor={motionBrush ? accentColor : subTextColor}
                badge={motionBrush ? `${motionBrush.trajectories.length}轨迹` : undefined}
                defaultOpen={false}
                isMonochrome={isMonochrome}
                accentColor={accentColor}
                inputBg={inputBg}
                borderColor={borderColor}
                subTextColor={subTextColor}
                textColor={textColor}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Paintbrush className="w-4 h-4" style={{ color: accentColor }} />
                  <span className="text-xs" style={{ color: textColor }}>在图片上涂抹区域并绘制运动方向</span>
                </div>
                <MotionBrushCanvas
                  ref={motionBrushRef}
                  imageUrl={firstFrameUrl}
                  onExport={handleMotionBrushExport}
                  onClose={() => setShowMotionBrush(false)}
                />
                <div className="mt-2 text-[10px] space-y-0.5" style={{ color: subTextColor }}>
                  <div>• 左键涂抹：标记运动区域</div>
                  <div>• 右键绘制：定义运动方向箭头</div>
                  <div>• 滚轮：调整画笔大小</div>
                </div>
              </CollapsibleSection>
            )}

            {mode === 'multi-shot' && (
              <CollapsibleSection
                title="多镜头叙事"
                icon={<Film className="w-4 h-4" />}
                iconColor="#a855f7"
                badge={`${(shotPlans.length > 0 ? shotPlans : multiShotScenes).length}镜头`}
                defaultOpen={true}
                isMonochrome={isMonochrome}
                accentColor={accentColor}
                inputBg={inputBg}
                borderColor={borderColor}
                subTextColor={subTextColor}
                textColor={textColor}
              >
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={handlePlanShots}
                    disabled={isPlanningShots || !prompt.trim()}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', color: '#fff' }}
                  >
                    {isPlanningShots ? <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-white border-t-transparent rounded-full animate-spin" /> : <Clapperboard className="w-3 h-3" />}
                    AI 分镜规划
                  </button>
                  <button
                    onClick={() => { setShotPlans([]); setMultiShotScenes([{ id: Date.now().toString(), prompt: '', duration: duration as number }]); }}
                    className="px-2 py-1.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer"
                    style={{ background: inputBg, color: subTextColor, border: `1px solid ${borderColor}` }}
                  >清空</button>
                  <div className="ml-auto flex items-center gap-3">
                    <ToggleBtn active={chainContinuity} onClick={() => setChainContinuity(!chainContinuity)} accent={accentColor} sub={subTextColor} mono={isMonochrome}>链式连贯</ToggleBtn>
                    <ToggleBtn active={useGlobalReferences} onClick={() => setUseGlobalReferences(!useGlobalReferences)} accent={accentColor} sub={subTextColor} mono={isMonochrome}>全局参考图</ToggleBtn>
                  </div>
                </div>
                {shotPlans.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {shotPlans.map((shot, idx) => (
                      <div key={shot.id} className="p-2.5 rounded-lg" style={{ background: panelBg, border: `1px solid ${borderColor}` }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: '#a855f7' }}>
                            <span className="w-4 h-4 rounded-full bg-[#a855f7]/20 flex items-center justify-center text-[9px]">{idx + 1}</span>
                            {shot.title || `镜头 ${idx + 1}`}
                            <span className="text-[9px] font-normal px-1 rounded" style={{ color: subTextColor }}>{shot.cameraMove || shot.shotSize || ''}</span>
                          </span>
                          <div className="flex gap-1">
                            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${accentColor}20`, color: accentColor }}>{shot.duration}s</span>
                            <button onClick={() => setShotPlans(shotPlans.filter((_, i) => i !== idx))} className="cursor-pointer hover:text-red-400" style={{ color: subTextColor }}>
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <textarea
                          value={shot.prompt}
                          onChange={e => { const copy = [...shotPlans]; copy[idx] = { ...copy[idx], prompt: e.target.value }; setShotPlans(copy); }}
                          rows={2}
                          className="w-full px-2 py-1.5 rounded text-[11px] resize-none focus:outline-none"
                          style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
                        />
                        <div className="flex gap-1 mt-1 flex-wrap">
                          <span className="text-[9px] px-1 rounded" style={{ color: subTextColor }}>🎬 {shot.purpose}</span>
                          {shot.lighting && <span className="text-[9px] px-1 rounded" style={{ color: subTextColor }}>💡 {shot.lighting.substring(0, 10)}</span>}
                          {shot.audioCues && <span className="text-[9px] px-1 rounded" style={{ color: subTextColor }}>🔊 {shot.audioCues.substring(0, 10)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {multiShotScenes.map((scene, idx) => (
                      <div key={scene.id}>
                        <div className="p-2 rounded-md" style={{ background: panelBg, border: `1px solid ${borderColor}` }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-semibold" style={{ color: '#a855f7' }}>镜头 {idx + 1}</span>
                            {multiShotScenes.length > 1 && (
                              <button onClick={() => setMultiShotScenes(multiShotScenes.filter(s => s.id !== scene.id))} className="cursor-pointer" style={{ color: subTextColor }}>
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <textarea
                            value={scene.prompt}
                            onChange={e => {
                              const copy = [...multiShotScenes]; const i = copy.findIndex(s => s.id === scene.id);
                              if (i >= 0) copy[i] = { ...copy[i], prompt: e.target.value };
                              setMultiShotScenes(copy);
                            }}
                            placeholder={idx === 0 ? '描述开场画面...' : '描述下一镜头...'}
                            rows={2}
                            className="w-full px-2 py-1.5 rounded text-[11px] resize-none focus:outline-none"
                            style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
                          />
                        </div>
                        {chainContinuity && idx < multiShotScenes.length - 1 && (
                          <div className="flex justify-center py-0.5"><FastForward className="w-3 h-3" style={{ color: accentColor }} /></div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {shotPlans.length === 0 && (
                  <button
                    onClick={() => setMultiShotScenes([...multiShotScenes, { id: Date.now().toString(), prompt: '', duration: duration as number }])}
                    className="w-full mt-2 py-1.5 rounded-md border-2 border-dashed text-[11px] flex items-center justify-center gap-1 cursor-pointer transition-colors"
                    style={{ borderColor: borderColor, color: subTextColor }}
                  >
                    <Plus className="w-3 h-3" />添加镜头
                  </button>
                )}
                {!prompt.trim() && <p className="text-[10px] mt-2" style={{ color: subTextColor }}>💡 先在上方"视频描述"输入故事梗概，再点击"AI分镜规划"</p>}
              </CollapsibleSection>
            )}

            {/* 高级设置 */}
            <CollapsibleSection
              title="高级设置"
              icon={<Settings2 className="w-4 h-4" />}
              defaultOpen={false}
              isMonochrome={isMonochrome}
              accentColor={accentColor}
              inputBg={inputBg}
              borderColor={borderColor}
              subTextColor={subTextColor}
              textColor={textColor}
            >
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>分辨率</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {availableResolutions.map(r => (
                      <button
                        key={r}
                        onClick={() => setResolution(r)}
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer"
                        style={{
                          background: resolution === r ? accentColor : inputBg,
                          color: resolution === r ? (isGold ? '#0a0a0a' : '#fff') : subTextColor,
                          border: `1px solid ${resolution === r ? accentColor : borderColor}`,
                        }}
                      >{r}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelClass}>反向提示词（可选）</label>
                  <textarea
                    value={negativePrompt}
                    onChange={e => setNegativePrompt(e.target.value)}
                    placeholder="模糊、变形、低质量、水印..."
                    rows={2}
                    className="w-full rounded-md px-2.5 py-1.5 text-[11px] resize-none focus:outline-none"
                    style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] shrink-0 font-medium" style={{ color: subTextColor }}>随机种子</label>
                  <input
                    type="number"
                    value={seed ?? ''}
                    onChange={e => { const v = e.target.value; setSeed(v ? parseInt(v, 10) : undefined); }}
                    placeholder="随机"
                    className="flex-1 rounded-md px-2.5 py-1.5 text-[11px] focus:outline-none"
                    style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
                  />
                  <button onClick={() => setSeed(Math.floor(Math.random() * 2147483647))} className="px-2.5 py-1.5 rounded-md text-sm cursor-pointer" style={{ background: inputBg, color: subTextColor, border: `1px solid ${borderColor}` }}>🎲</button>
                </div>
              </div>
            </CollapsibleSection>

            {/* 生成按钮 */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !model || (!prompt.trim() && mode !== 'video-extend')}
              className={`w-full ${isGenerating ? 'py-3' : 'py-3'} rounded-xl text-sm font-semibold flex flex-col items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-auto`}
              style={{
                background: isGold
                  ? (isGenerating ? 'rgba(212,175,55,0.3)' : 'linear-gradient(135deg, #d4af37, #b8962e)')
                  : (isGenerating ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #3b82f6, #2563eb)'),
                color: '#fff',
                boxShadow: isGenerating ? 'none' : `0 4px 12px ${isGold ? 'rgba(212,175,55,0.35)' : 'rgba(59,130,246,0.35)'}`,
              }}
            >
              {isGenerating ? (
                <div className="flex flex-col gap-2 w-full px-4">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{genStage || '处理中...'}</span>
                  </div>
                  <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.2)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${genProgress}%`, background: 'rgba(255,255,255,0.9)' }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  {mode === 'video-extend' ? '延长视频' : mode === 'multi-shot' ? `生成${multiShotScenes.length}镜头视频` : `生成视频${batchCount > 1 ? ` (${batchCount}个)` : ''}`}
                </div>
              )}
            </button>

            {/* 历史记录 */}
            {videoHistory.length > 0 && (
              <div>
                <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1.5 text-xs font-medium w-full py-1 cursor-pointer" style={{ color: subTextColor }}>
                  <History className="w-3.5 h-3.5" />
                  <span>生成历史 ({videoHistory.length})</span>
                  <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${showHistory ? 'rotate-180' : ''}`} />
                </button>
                {showHistory && (
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {videoHistory.slice(0, 8).map(entry => (
                      <button key={entry.id} onClick={() => reuseHistoryEntry(entry)} className="aspect-video rounded overflow-hidden relative group cursor-pointer" style={{ border: `1px solid ${borderColor}` }}>
                        {entry.thumbnailUrl ? (
                          <img src={entry.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ background: inputBg }}>
                            <Video className="w-5 h-5" style={{ color: subTextColor }} />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

// 可折叠区块（内联组件，保持简洁）
function CollapsibleSection({ title, icon, iconColor, badge, defaultOpen = false, isMonochrome, accentColor, inputBg, borderColor, subTextColor, textColor, children }: {
  title: string;
  icon?: React.ReactNode;
  iconColor?: string;
  badge?: string;
  defaultOpen?: boolean;
  isMonochrome: boolean;
  accentColor: string;
  inputBg: string;
  borderColor: string;
  subTextColor: string;
  textColor: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${borderColor}`, background: isMonochrome ? '#fafafa' : 'rgba(255,255,255,0.02)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left transition-colors cursor-pointer hover:opacity-90"
        style={{ background: open ? (isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.04)') : 'transparent' }}
      >
        {icon && <span className="shrink-0" style={{ color: iconColor || subTextColor }}>{icon}</span>}
        <span className="text-xs font-semibold flex-1" style={{ color: textColor }}>{title}</span>
        {badge && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${accentColor}20`, color: accentColor }}>{badge}</span>}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} style={{ color: subTextColor }} />
      </button>
      {open && <div className="px-3.5 pb-3.5 pt-0">{children}</div>}
    </div>
  );
}

function ToggleBtn({ active, onClick, accent, sub, mono, children }: {
  active: boolean; onClick: () => void; accent: string; sub: string; mono: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-[10px] font-medium cursor-pointer" style={{ color: active ? accent : sub }}>
      <div className="w-7 h-3.5 rounded-full relative transition-colors" style={{ background: active ? accent : (mono ? '#d1d5db' : 'rgba(255,255,255,0.15)') }}>
        <div className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all shadow-sm" style={{ left: active ? '16px' : '2px' }} />
      </div>
      <span>{children}</span>
    </button>
  );
}

export { VIDEO_MODEL_REGISTRY };
