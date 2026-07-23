'use client';

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle, type ReactNode } from 'react';
import * as React from 'react';
import {
  Play, Video, ImagePlus, Settings2,
  ChevronDown, ChevronUp, Loader2, Sparkles, Volume2, VolumeX,
  Upload, X, AlertCircle, Info, FastForward, Users, Plus, Paintbrush, Film, Palette, Images,
  History, RotateCcw, Languages, GripVertical, Minus, Maximize2, ChevronRight, CheckCircle2,
  Clapperboard, SlidersHorizontal, Mountain, ImageIcon, User, RefreshCw, Package
} from 'lucide-react';
import MotionBrushCanvas, { type MotionBrushResult, type MotionBrushCanvasHandle } from './motion-brush-canvas';
import { clampVideoDurationToAllowed, getPlatformVideoDurations, inferVideoModelFeatures, VIDEO_MODEL_REGISTRY, type MotionBrushParams, type CameraControlParams, type VideoGenerateParams as VideoApiGenerateParams } from '@/lib/video-api';
import {
  buildContinuationPrompt,
  parseShotPlanCharacters,
  parseShotPlanScenes,
} from '@/lib/video-director/continuity';
import type {
  VideoShotPlan,
  VideoCharacter,
  VideoScene,
  VideoProp,
} from '@/lib/video-director/continuity';
import type { DirectorStyle, VideoReferenceBinding } from '@/lib/video-director/prompt-compiler';
import { selectInitialModel } from '@/lib/model-defaults';

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
  // 多镜头/导演参数
  shotId?: string;
  shotIndex?: number;
  _vgenReqId?: string;
  directorMode?: boolean;
  // 导演增强
  useDirector?: boolean;
  directorStyle?: DirectorStyle;
  compiledPrompt?: string;
  compiledNegative?: string;
  // 多镜头结构化计划
  shotPlan?: VideoShotPlan[];
}
interface VideoGenerationPanelProps {
  onVideoGenerate: (params: VideoGenerateParams) => Promise<{ taskId?: string }> | { taskId?: string } | void;
  /** 多镜头任务完成回调：把视频结果回填到 shotPlan */
  onShotVideoCompleted?: (shotId: string, result: { videoUrl: string; thumbnailUrl?: string }) => void;
  onError?: (error: string) => void;
  /** 画布添加图片（用于把制片资产加入画布） */
  onAddImages?: (imageUrls: string[]) => void;
  /** 故事视频合成完成回调 */
  onStoryVideoComposed?: (result: { videoUrl: string; thumbnailUrl?: string; duration?: number }) => void;
  themeStyle?: 'gold' | 'monochrome';
  /** 当前画布选中的图片URL，自动用作图生视频首帧 */
  selectedImageUrl?: string | null;
  /** 当前画布选中的视频URL，自动用作视频延长源 */
  selectedVideoUrl?: string | null;
  /** 从 /api/models?type=video 加载的服务器端视频模型列表 */
  serverVideoModels?: { id: string; name: string; providerId: string; providerName: string; isDefault?: boolean }[];
  /** 是否以浮动弹窗模式显示 */
  floating?: boolean;
  /** 关闭浮动面板 */
  onClose?: () => void;
  /** 从快速创作注入的视频提示词 */
  externalPrompt?: string;
  /** 外部提示词对应的创作模式 */
  externalPromptMode?: 'generate' | 'extend';
  /** 外部提示词写入后通知父组件清空 */
  onExternalPromptConsumed?: () => void;
}

type VideoModelOption = {
  id: string;
  modelId: string;
  name: string;
  providerId: string;
  providerName: string;
  region: 'cn' | 'global';
  features: VideoModelInfo['features'];
};

type StoryCharacterPayload = VideoCharacter & {
  looks?: string;
  appearancePrompt?: string;
  outfit?: string;
  clothing?: string;
  hairstyle?: string;
  frontImagePrompt?: string;
  sideImagePrompt?: string;
};

type StoryScenePayload = VideoScene & {
  place?: string;
  setting?: string;
  environmentPrompt?: string;
  sceneImageUrl?: string;
};

type StoryPropPayload = VideoProp & {
  imagePrompt?: string;
  shotIds?: Array<string | number>;
};

type StoryShotPayload = Partial<VideoShotPlan> & {
  shot_size?: string;
  camera_movement?: string;
  camera_move?: string;
  action_beat?: string;
  audio_cues?: string;
  sound?: string;
  compiledPrompt?: string;
  continuity_notes?: string[];
  description?: string;
};

interface ShotPlanApiResponse {
  success?: boolean;
  error?: string;
  shots?: StoryShotPayload[];
  characters?: VideoCharacter[];
  scenes?: VideoScene[];
  props?: VideoProp[];
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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

export interface VideoGenerationPanelHandle {
  /** 通知某个镜头/任务的视频已生成完成（shotId 优先匹配镜头，否则按 taskId 兜底） */
  notifyShotVideoGenerated: (payload: { shotId?: string; taskId?: string; videoUrl: string; thumbnailUrl?: string }) => void;
  /** 通知某个镜头/任务失败 */
  notifyShotVideoFailed: (payload: { shotId?: string; taskId?: string; error: string }) => void;
}

export interface ShotVideoResult {
  videoUrl: string;
  thumbnailUrl?: string;
}

const VideoGenerationPanel = forwardRef<VideoGenerationPanelHandle, VideoGenerationPanelProps>(function VideoGenerationPanel({
  onVideoGenerate,
  onShotVideoCompleted,
  onAddImages,
  onError,
  onStoryVideoComposed,
  themeStyle = 'gold',
  selectedImageUrl,
  selectedVideoUrl,
  serverVideoModels,
  floating = false,
  onClose,
  externalPrompt,
  externalPromptMode = 'generate',
  onExternalPromptConsumed,
}: VideoGenerationPanelProps, ref) {
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

  useEffect(() => {
    if (!externalPrompt?.trim()) return;
    setPrompt(externalPrompt);
    setMode(externalPromptMode === 'extend' ? 'video-extend' : 'text2video');
    onExternalPromptConsumed?.();
  }, [externalPrompt, externalPromptMode, onExternalPromptConsumed]);

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
  const typedReferencesRef = useRef<TypedReference[]>([]);
  useEffect(() => { typedReferencesRef.current = typedReferences; }, [typedReferences]);

  // 角色/场景/道具资产（AI 制片流水线）—— 直接使用后端解析的 VideoCharacter/VideoScene/VideoProp 结构
  const [productionCharacters, setProductionCharacters] = useState<VideoCharacter[]>([]);
  const [productionScenes, setProductionScenes] = useState<VideoScene[]>([]);
  const [productionProps, setProductionProps] = useState<VideoProp[]>([]);
  const [isGeneratingAssets, setIsGeneratingAssets] = useState(false);
  const [isBuildingProduction, setIsBuildingProduction] = useState(false);
  const [isGeneratingCharacters, setIsGeneratingCharacters] = useState(false);
  const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);
  const [isGeneratingProps, setIsGeneratingProps] = useState(false);
  const [autoInjectAssets, setAutoInjectAssets] = useState(true);
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
  const [useGlobalReferences, setUseGlobalReferences] = useState(true);
  const [tailFrameRelay, setTailFrameRelay] = useState(true); // 尾帧接力开关（默认开启）
  const [autoDiagnoseOnFail, setAutoDiagnoseOnFail] = useState(true); // 失败自动诊断
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
  type ShotVideoResult = { videoUrl: string; thumbnailUrl?: string };
  const [shotPlans, setShotPlans] = useState<VideoShotPlan[]>([]);
  const [isPlanningShots, setIsPlanningShots] = useState(false);
  const [shotPlanOpen, setShotPlanOpen] = useState(false);
  const [currentGeneratingShotId, setCurrentGeneratingShotId] = useState<string | null>(null);
  const [diagnoseOpen, setDiagnoseOpen] = useState<string | null>(null); // 诊断哪个失败镜头
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [characterRefType, setCharacterRefType] = useState<'character-front'|'character-side'|'character-back'>('character-front');
  const shotTaskResolversRef = useRef<Map<string, { resolve: (r: ShotVideoResult) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }>>(new Map());
  const shotTaskIdMapRef = useRef<Map<string, string>>(new Map()); // shotId -> taskId
  const autoDiagnoseFiredRef = useRef<Set<string>>(new Set());

  // === 失败诊断 ===
  const handleDiagnoseFailed = async (shot: VideoShotPlan) => {
    if (!shot.error) return;
    try {
      const resp = await fetch('/api/video/director/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: shot.prompt,
          issue: shot.error,
          model: (currentModel?.id || model),
          aspectRatio,
          duration,
          videoUrl: shot.videoUrl,
          shot: { id: shot.id, title: shot.title },
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || '诊断失败');
      const diag = data.diagnosis || {};
      if (Array.isArray(diag.retakeSuggestions)) {
        const suggestions = (diag.retakeSuggestions as Array<{label: string; description?: string; patch?: Record<string, unknown>; promptAppend?: string; negativeAppend?: string}>).map((s) => ({
          title: diag.title || '重拍建议',
          description: s.description || diag.description,
          label: s.label,
          patch: { ...(s.patch || {}), promptAppend: s.promptAppend, negativeAppend: s.negativeAppend },
        }));
        setShotPlans(prev => prev.map(s => s.id === shot.id ? { ...s, diagnosis: suggestions } : s));
        setDiagnoseOpen(shot.id);
      }
    } catch (e) {
      console.error('诊断失败:', e);
      onError?.(e instanceof Error ? e.message : '诊断失败');
    }
  };

  // 合并服务器模型与内置注册表
  const [videoModels, setVideoModels] = useState<VideoModelOption[]>([]);

  // ref 保持最新 shotPlans，供异步循环读取不被闭包冻结
  const shotPlansRef = useRef<VideoShotPlan[]>(shotPlans);
  useEffect(() => { shotPlansRef.current = shotPlans; }, [shotPlans]);

  // === shot 任务等待队列：taskId -> {resolve,reject,timer} ===
  // 暴露给父组件：完成回填 + 等待某 shot 任务
  useImperativeHandle(ref, () => ({
    notifyShotVideoGenerated: (payload: { shotId?: string; taskId?: string; videoUrl: string; thumbnailUrl?: string }) => {
      const { shotId, taskId, videoUrl, thumbnailUrl } = payload;
      const key = shotId || taskId;
      if (!key) return;
      // 1) 先按 key 找 resolver
      let resolver = shotTaskResolversRef.current.get(key);
      // 2) 同步更新 shotPlans 状态
      setShotPlans(prev => {
        let hit = false;
        const next = prev.map(s => {
          if (s.id === key || s.taskId === key) {
            hit = true;
            if (!resolver) resolver = shotTaskResolversRef.current.get(s.id) || (s.taskId ? shotTaskResolversRef.current.get(s.taskId) : undefined);
            return { ...s, status: 'completed' as const, videoUrl, thumbnailUrl: thumbnailUrl || s.thumbnailUrl, error: undefined, diagnosisOpen: false };
          }
          return s;
        });
        if (!hit) return prev;
        return next;
      });
      if (resolver) {
        clearTimeout(resolver.timer);
        shotTaskResolversRef.current.delete(key);
        resolver.resolve({ videoUrl, thumbnailUrl: thumbnailUrl || '' });
      }
    },
    notifyShotVideoFailed: (payload: { shotId?: string; taskId?: string; error: string }) => {
      const { shotId, taskId, error: errMsg } = payload;
      const key = shotId || taskId;
      if (!key) return;
      const resolver = shotTaskResolversRef.current.get(key);
      setShotPlans(prev => prev.map(s => (s.id === key || s.taskId === key) ? { ...s, status: 'failed' as const, error: errMsg } : s));
      if (resolver) {
        clearTimeout(resolver.timer);
        shotTaskResolversRef.current.delete(key);
        resolver.reject(new Error(errMsg));
      }
    },
  }));

  // 等待某个 shot 对应的视频任务完成（供串行流水线使用）
  const waitForShotTask = (taskId: string, timeoutMs = 600000): Promise<ShotVideoResult> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        shotTaskResolversRef.current.delete(taskId);
        reject(new Error('生成超时'));
      }, timeoutMs);
      shotTaskResolversRef.current.set(taskId, { resolve, reject, timer });
    });
  };

  // 镜头失败时自动诊断（通过 ref Set 避免重复触发）
  useEffect(() => {
    if (!autoDiagnoseOnFail) return;
    shotPlans.forEach(shot => {
      if (shot.status === 'failed' && shot.error && !autoDiagnoseFiredRef.current.has(shot.id)) {
        autoDiagnoseFiredRef.current.add(shot.id);
        setDiagnoseOpen(shot.id);
        handleDiagnoseFailed(shot).catch(() => {});
      }
    });
  }, [shotPlans, autoDiagnoseOnFail]);

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
        maxDuration: 15, durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p','4K'],
      };
    };
    if (serverVideoModels && serverVideoModels.length > 0) {
      const merged = serverVideoModels.map(sm => {
        const modelId = sm.id.includes('::') ? sm.id.split('::').pop()! : sm.id;
        const providerId = sm.providerId || (sm.id.includes('::') ? sm.id.split('::')[0] : '');
        const registry = VIDEO_MODEL_REGISTRY[modelId as keyof typeof VIDEO_MODEL_REGISTRY] as unknown as {
          name?: string; features?: string[]; maxDuration?: number; supportedRatios?: string[];
          maxBatch?: number; audio?: boolean; provider?: string; region?: 'cn' | 'global';
        } | undefined;
        return {
          id: providerId ? `${providerId}::${modelId}` : modelId,
          modelId,
          name: sm.name || registry?.name || modelId,
          providerId,
          providerName: sm.providerName || registry?.provider || '',
          isDefault: Boolean(sm.isDefault),
          region: (registry?.region || 'cn') as 'cn' | 'global',
          features: Array.isArray(registry?.features) ? inferFallbackFeatures(sm.id) : inferFallbackFeatures(sm.id),
        };
      });
      setVideoModels(merged);
      if (merged.length > 0 && !model) {
        setModel(current => selectInitialModel(current, merged));
      }
      return;
    }
    // 自动加载
    (async () => {
      try {
        const res = await fetch('/api/models?type=video');
        if (res.ok) {
          const data = await res.json();
          const vModels: Array<{ id: string; name: string; providerId: string; providerName: string; isDefault?: boolean }> = [];
          const providerMap = new Map<string, string>();
          if (data.providers && Array.isArray(data.providers)) {
            for (const p of data.providers) {
              providerMap.set(p.id, p.name || p.displayName || '');
            }
          }
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              const modelId = m.id || m.name;
              vModels.push({
                id: modelId,
                name: m.name || m.id || '',
                providerId: m.providerId || '',
                providerName: providerMap.get(m.providerId) || m.providerId || '',
                isDefault: Boolean(m.isDefault),
              });
            }
          }
          const merged = vModels.map(sm => {
            const modelId = sm.id.includes('::') ? sm.id.split('::').pop()! : sm.id;
            const providerId = sm.providerId || (sm.id.includes('::') ? sm.id.split('::')[0] : '');
            const registry = VIDEO_MODEL_REGISTRY[modelId as keyof typeof VIDEO_MODEL_REGISTRY];
            return {
              id: providerId ? `${providerId}::${modelId}` : modelId,
              modelId,
              name: sm.name || registry?.name || modelId,
              providerId,
              providerName: sm.providerName || registry?.provider || '',
              isDefault: Boolean(sm.isDefault),
              region: registry?.features.region || 'cn',
              features: {
                ...registry?.features,
                aspectRatios: registry?.features.aspectRatios || registry?.features.ratios,
              },
            };
          });
          setVideoModels(merged);
          if (merged.length > 0 && !model) {
            setModel(current => selectInitialModel(current, merged));
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
  const currentRegistry = VIDEO_MODEL_REGISTRY[currentModel?.modelId || model];

  // 动态可选比例
  const availableRatios = currentFeatures?.aspectRatios || ['1:1', '4:3', '16:9', '9:16'];
  const platformDurations = getPlatformVideoDurations(currentFeatures?.durations || [5, 10]);
  const availableDurations = platformDurations.length > 0 ? platformDurations : [5, 10];
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
      // 收集当前参考图列表（扁平 URL 数组）与角色绑定
      const refList = typedReferences.map(r => r.url);
      const res = await fetch('/api/video/director/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIdea: prompt,
          mode,
          modelId: currentModel?.id || model,
          aspectRatio,
          duration,
          style: directorStyle,
          verbosity: directorEnhanceIntensity,
          references: refList.length > 0 ? refList : undefined,
          imageUrl: firstFrameUrl || undefined,
          lastFrameUrl: lastFrameUrl || undefined,
          audio: generateAudio || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '导演增强失败');
      const compiled = data.compiled || {};
      const compiledPrompt = typeof compiled.prompt === 'string' ? compiled.prompt : '';
      const compiledNegative = typeof compiled.negativePrompt === 'string' ? compiled.negativePrompt : '';
      if (compiledPrompt) {
        setPrompt(compiledPrompt);
        if (compiledNegative) setNegativePrompt(compiledNegative);
        setDirectorResult({
          prompt: compiledPrompt,
          negativePrompt: compiledNegative,
          analysis: compiled.contract || {},
        });
        setGenStage('');
      } else {
        throw new Error('导演增强返回空结果');
      }
    } catch (err) {
      console.error('导演增强失败:', err);
      setGenStage('');
      onError?.(err instanceof Error ? err.message : '导演增强失败');
    } finally {
      setIsDirectorEnhancing(false);
    }
  }, [prompt, isDirectorEnhancing, mode, model, currentModel, aspectRatio, duration, directorEnhanceIntensity, directorStyle, typedReferences, firstFrameUrl, lastFrameUrl, generateAudio, onError]);

  // === AI 分镜规划（P2）：梗概 → 结构化镜头列表 ===
  const handlePlanShots = useCallback(async () => {
    if (!prompt.trim() || isPlanningShots) return;
    setIsPlanningShots(true);
    setGenStage('AI 规划分镜中...');
    const targetShotCount = Math.min(8, Math.max(2, Math.ceil(duration / 4)));
    try {
      // 统一调用一次，字段名对齐后端 storyIdea/duration/shotCount/style
      const makeCall = async (extraPrompt = '', forcedMin?: number) => {
        const res = await fetch('/api/video/director/shot-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyIdea: prompt + extraPrompt,
            duration,
            aspectRatio,
            model: (currentModel?.id || model),
            style: directorStyle,
            shotCount: forcedMin || targetShotCount,
          }),
        });
        const data = await res.json() as ShotPlanApiResponse;
        if (!res.ok || !data.success) throw new Error(data.error || '分镜规划失败');
        return data;
      };

      let planData = await makeCall('');
      let shotsRaw = planData.shots || null;
      const rawCharacters = planData.characters || [];
      const rawScenes = planData.scenes || [];
      const rawProps = planData.props || [];
      // 镜头数过少时追加约束再试一次
      if (!shotsRaw || shotsRaw.length < 2) {
        try {
          planData = await makeCall('。请至少拆分为3个镜头，每个镜头明确景别、运镜、光线、声音和连续性备注；同时完整返回 characters（人物）、scenes（场景）、props（关键道具）三类资产。', Math.max(targetShotCount, 3));
          shotsRaw = planData.shots || null;
          if (planData.characters && planData.characters.length > 0) { rawCharacters.splice(0, rawCharacters.length, ...planData.characters); }
          if (planData.scenes && planData.scenes.length > 0) { rawScenes.splice(0, rawScenes.length, ...planData.scenes); }
          if (planData.props && planData.props.length > 0) { rawProps.splice(0, rawProps.length, ...planData.props); }
        } catch { /* 重试失败沿用首次结果 */ }
      }
      if (!shotsRaw || shotsRaw.length < 1) throw new Error('分镜规划失败：返回为空');

      const normalizeShot = (s: StoryShotPayload, idx: number): VideoShotPlan => {
        const legacyCamera = typeof s.camera === 'string' ? s.camera : '';
        return {
        id: s.id || `shot-${Date.now()}-${idx}`,
        index: idx,
        title: s.title || `镜头 ${idx + 1}`,
        purpose: s.purpose || '',
        shotSize: s.shotSize || s.shot_size || '中景',
        cameraMove: s.cameraMove || s.cameraMotion || s.camera_movement || s.camera_move || legacyCamera,
        cameraMotion: s.cameraMotion || s.cameraMove || s.camera_movement || s.camera_move || legacyCamera,
        actionBeat: s.actionBeat || s.action_beat || s.description || '',
        lighting: s.lighting || '',
        audioCues: s.audioCues || s.audio_cues || s.sound || '',
        prompt: s.prompt || s.directedPrompt || s.compiledPrompt || '',
        directedPrompt: s.directedPrompt || s.compiledPrompt || undefined,
        duration: Number(s.duration) || Math.max(3, Math.round(duration / Math.max(shotsRaw!.length, 1))),
        aspectRatio: s.aspectRatio || aspectRatio,
        references: Array.isArray(s.references) ? s.references as VideoReferenceBinding[] : [],
        continuityNotes: Array.isArray(s.continuityNotes)
          ? s.continuityNotes as string[]
          : Array.isArray(s.continuity_notes)
            ? s.continuity_notes as string[]
            : [],
        camera: undefined,
        motion: null,
        firstFrameFromPrev: idx > 0,
        firstFrameUrl: idx === 0 ? (firstFrameUrl || undefined) : undefined,
        lastFrameUrl: undefined,
        status: 'planned' as const,
        diagnosis: null,
        retakeCount: 0,
        error: undefined,
        videoUrl: undefined,
        thumbnailUrl: undefined,
        };
      };
      const plans = shotsRaw.map(normalizeShot);
      setShotPlans(plans);
      shotPlansRef.current = plans;
      // 写入角色/场景/道具资产
      const now = Date.now();
      const charList: VideoCharacter[] = Array.isArray(planData.characters) ? planData.characters : [];
      const sceneList: VideoScene[] = Array.isArray(planData.scenes) ? planData.scenes : [];
      const propList: VideoProp[] = Array.isArray(planData.props) ? planData.props : [];
      setProductionCharacters((charList as StoryCharacterPayload[]).map((c, i) => ({
        id: c.id || `char-${now}-${i}`,
        name: String(c.name || `角色${i + 1}`).slice(0, 20),
        role: String(c.role || ''),
        age: String(c.age || ''),
        gender: String(c.gender || ''),
        ethnicity: String(c.ethnicity || ''),
        style: String(c.style || ''),
        appearance: String(c.appearance || c.looks || c.visualPrompt || c.appearancePrompt || ''),
        costume: String(c.costume || c.outfit || c.clothing || ''),
        hair: String(c.hair || c.hairstyle || ''),
        accessories: String(c.accessories || ''),
        frontPrompt: String(c.frontPrompt || c.frontImagePrompt || ''),
        sidePrompt: String(c.sidePrompt || c.sideImagePrompt || ''),
        keywords: Array.isArray(c.keywords) ? c.keywords.map(String).slice(0, 8) : [],
        imageUrlFront: String(c.frontImageUrl || c.imageUrlFront || c.frontUrl || ''),
        imageUrlSide: String(c.sideImageUrl || c.imageUrlSide || c.sideUrl || ''),
        status: (c.frontImageUrl || c.imageUrlFront) ? 'completed' : 'pending',
      } as VideoCharacter)));
      setProductionScenes((sceneList as StoryScenePayload[]).map((s, i) => ({
        id: s.id || `scene-${now}-${i}`,
        shotId: s.shotId != null ? String(s.shotId) : undefined,
        forShotIds: Array.isArray(s.forShotIds) ? s.forShotIds.map(String) : [],
        name: String(s.name || `场景${i + 1}`).slice(0, 30),
        description: String(s.description || ''),
        location: String(s.location || s.place || s.setting || ''),
        timeOfDay: String(s.timeOfDay || ''),
        weather: String(s.weather || ''),
        lighting: String(s.lighting || s.lightingHint || ''),
        mood: String(s.mood || ''),
        colorPalette: String(s.colorPalette || ''),
        keyProps: String(s.keyProps || ''),
        scenePrompt: String(s.scenePrompt || s.environmentPrompt || s.visualPrompt || ''),
        imageUrl: String(s.imageUrl || s.sceneImageUrl || ''),
        status: s.imageUrl ? 'completed' : 'pending',
      } as VideoScene)));
      setProductionProps((propList as StoryPropPayload[]).map((p, i) => ({
        id: p.id || `prop-${now}-${i}`,
        name: String(p.name || `道具${i + 1}`).slice(0, 20),
        role: String(p.role || ''),
        description: String(p.description || ''),
        material: String(p.material || ''),
        color: String(p.color || ''),
        scale: String(p.scale || ''),
        propPrompt: String(p.propPrompt || p.imagePrompt || ''),
        imageUrl: String(p.imageUrl || ''),
        forShotIds: Array.isArray(p.shotIds) ? p.shotIds.map(String) : (Array.isArray(p.forShotIds) ? p.forShotIds.map(String) : []),
        sceneId: p.sceneId != null ? String(p.sceneId) : undefined,
        status: p.imageUrl ? 'completed' : 'pending',
      } as VideoProp)));
      setShotPlanOpen(true);
      setMode('multi-shot');
      setGenStage('');
    } catch (err) {
      console.error('分镜规划失败:', err);
      setGenStage('');
      onError?.(err instanceof Error ? err.message : '分镜规划失败');
    } finally {
      setIsPlanningShots(false);
    }
  }, [prompt, isPlanningShots, duration, aspectRatio, model, currentModel, directorStyle, firstFrameUrl, onError]);

  // === 单独生成一个镜头（使用 onVideoGenerate 直接提交；自动用上一镜头抽尾帧作为首帧）===
  const handleGenerateSingleShot = async (shotId: string) => {
    // 重拍前清理诊断标记，允许重拍失败后再次自动诊断
    autoDiagnoseFiredRef.current.delete(shotId);
    setDiagnoseOpen(null);
    const shot = shotPlans.find(s => s.id === shotId);
    if (!shot || !model) return;
    setCurrentGeneratingShotId(shotId);
    setShotPlans(prev => prev.map(s => s.id === shotId ? { ...s, status: 'generating' as const, error: undefined } : s));
    try {
      const shotIdx = shotPlans.findIndex(s => s.id === shotId);
      // 场景图优先作为首帧（AI 制片流水线预先为该镜头生成的氛围图），仅当用户没手动设置首帧时生效
      let sceneFrameUrl: string | undefined;
      const matchedScene = productionScenes.find(s => {
        if (s.shotId === shotId) return true;
        const forIds = s.forShotIds;
        if (Array.isArray(forIds) && (forIds.includes(shotId) || (shotIdx >= 0 && forIds.includes(shotIdx)))) return true;
        return false;
      });
      if (matchedScene?.imageUrl && !firstFrameUrl) {
        sceneFrameUrl = matchedScene.imageUrl;
      } else {
        // 兼容：从 typedReferences 里找标记为 'scene' 的参考图
        const sceneRefs = typedReferences.filter(r => r.type === 'scene').map(r => r.url);
        if (sceneRefs.length > 0 && !firstFrameUrl) {
          sceneFrameUrl = sceneRefs[shotIdx] || sceneRefs[0];
        }
      }
      // 查找上一个已完成镜头：优先使用服务端 ffmpeg 抽取的尾帧，其次用缩略图
      let firstFrameForThis: string | undefined = firstFrameUrl || sceneFrameUrl || undefined;
      if (shotIdx > 0 && tailFrameRelay && !firstFrameUrl && !sceneFrameUrl) {
        const prev = shotPlans[shotIdx - 1];
        if (prev?.videoUrl) {
          // 调用后端抽帧 API（ffmpeg 抽最后一帧，比前端 video 元素更稳定）
          try {
            const resp = await fetch('/api/video/extract-frame', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ videoUrl: prev.videoUrl, frame: 'last' }),
            });
            const data = await resp.json();
            if (resp.ok && data.imageUrl) {
              // 持久化到本地存储，避免远端临时 URL 过期
              try {
                const persist = await fetch('/api/save-image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageUrl: data.imageUrl, mediaType: 'image' }),
                });
                const persistData = await persist.json();
                firstFrameForThis = (persist.ok && persistData.url) ? persistData.url : data.imageUrl;
              } catch {
                firstFrameForThis = data.imageUrl;
              }
            } else if (prev.thumbnailUrl) {
              firstFrameForThis = prev.thumbnailUrl;
            }
          } catch {
            if (prev.thumbnailUrl) firstFrameForThis = prev.thumbnailUrl;
          }
        } else if (prev?.thumbnailUrl) {
          firstFrameForThis = prev.thumbnailUrl;
        }
      }
      const pureModelId = model.includes('::') ? model.split('::').pop()! : model;
      const providerId = currentModel?.providerId || (model.includes('::') ? model.split('::')[0] : undefined);
      // 把 shot.cameraMove 文本规范化为 cameraControl.type 枚举
      const normalizeCameraType = (move: string): string => {
        const m = move.toLowerCase();
        if (/push|zoom in|close|推近|特写/.test(m)) return 'zoom_in';
        if (/pull|zoom out|拉远/.test(m)) return 'zoom_out';
        if (/pan|横移|左移|右移/.test(m)) return 'pan';
        if (/tilt|仰拍|俯拍|上下移/.test(m)) return 'tilt';
        if (/tracking|follow|跟拍/.test(m)) return 'tracking';
        if (/static|固定|静止/.test(m)) return 'static';
        return (cameraControl?.type || 'static');
      };
      const camControl = shot.cameraMove
        ? { type: normalizeCameraType(shot.cameraMove), intensity: motionStrength }
        : (cameraControl || undefined);
      // 连续性提示：用上一镜头结果构造续接 prompt，帮助模型衔接动作与场景
      const prevShot = shotIdx > 0 ? shotPlans[shotIdx - 1] : undefined;
      const shotPrompt = prevShot && prevShot.status === 'completed' && prevShot.videoUrl
        ? buildContinuationPrompt(prevShot, shot.directedPrompt || shot.prompt)
        : (shot.directedPrompt || shot.prompt);

      setShotPlans(prev => prev.map(s => s.id === shotId ? { ...s, status: 'generating' as const, error: undefined, progress: 0 } : s));

      // 先注册等待器，确保父组件 notify 时 resolver 已就绪
      const waitPromise = waitForShotTask(shotId, 15 * 60 * 1000);

      try {
        await onVideoGenerate({
          prompt: shotPrompt,
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
          cameraControl: camControl as CameraControlParams | undefined,
          motionBrush: motionBrush || undefined,
          characterReferences: [
            ...productionCharacters.flatMap(c => [c.imageUrlFront || c.frontUrl, c.imageUrlSide || c.sideUrl].filter(Boolean) as string[]),
            ...typedReferences.filter(r => r.type === 'character-front' || r.type === 'character-side').map(r => r.url),
          ],
          referenceImages: [
            ...(productionScenes.map(s => s.imageUrl).filter(Boolean) as string[]),
            ...typedReferences.filter(r => !r.type.startsWith('character-') && r.type !== 'first-frame' && r.type !== 'last-frame' && r.type !== 'scene').map(r => r.url),
          ],
          motionStrength: camControl ? motionStrength : undefined,
          seed,
          negativePrompt: negativePrompt.trim() || undefined,
          useDirector: true,
          directorStyle,
          shotId,
        });
      } catch (submitErr: unknown) {
        const resolver = shotTaskResolversRef.current.get(shotId);
        if (resolver) {
          if (resolver.timer) clearTimeout(resolver.timer);
          resolver.reject(new Error(getErrorMessage(submitErr, '提交失败')));
          shotTaskResolversRef.current.delete(shotId);
        }
        throw submitErr;
      }

      // 等待父组件通知该任务真正完成（视频URL/缩略图就绪）
      try {
        const { videoUrl, thumbnailUrl } = await waitPromise;
        setShotPlans(prev => prev.map(s => s.id === shotId ? {
          ...s,
          status: 'completed' as const,
          videoUrl,
          thumbnailUrl,
          progress: 100,
          error: undefined,
        } : s));
      } catch (waitErr: unknown) {
        setShotPlans(prev => prev.map(s => s.id === shotId ? { ...s, status: 'failed' as const, error: getErrorMessage(waitErr, '生成失败') } : s));
      }
    } catch (err: unknown) {
      setShotPlans(prev => prev.map(s => s.id === shotId ? { ...s, status: 'failed' as const, error: getErrorMessage(err, '生成失败') } : s));
    } finally {
      setCurrentGeneratingShotId(null);
    }
  };

  // === 批量生成所有镜头（串行，自动串联尾帧→首帧，使用后端链式 API 实现连续性）===
  const [isGeneratingAllShots, setIsGeneratingAllShots] = useState(false);
  const [isComposingStory, setIsComposingStory] = useState(false);
  const [isExtending, setIsExtending] = useState(false);
  // === AI 制片流水线：角色卡 & 场景图（state 声明在文件前部统一管理） ===
  // 调用图像生成 API 生成单张图片（使用后端默认图像模型）
  const generateSingleImage = useCallback(async (imgPrompt: string, size?: string): Promise<string> => {
    const body: Record<string, unknown> = { prompt: imgPrompt, n: 1 };
    if (size) body.size = size;
    else body.size = '1024x1024';
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || '图像生成失败');
    }
    const data = await resp.json();
    if (data.taskId) {
      const taskId = data.taskId;
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2500));
        const pollResp = await fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
        if (!pollResp.ok) continue;
        const pollData = await pollResp.json();
        if (pollData.status === 'completed') {
          const url = pollData.imageUrl || pollData.result?.imageUrl || pollData.url || '';
          if (url) return url;
          throw new Error('图像生成未返回 URL');
        }
        if (pollData.status === 'failed') throw new Error(pollData.error || '图像生成失败');
      }
      throw new Error('图像生成超时');
    }
    const url = data.imageUrl || data.url || '';
    if (!url) throw new Error('图像生成未返回 URL');
    return url;
  }, []);

  // 持久化远端图片到本地，避免临时 URL 过期
  const persistImageUrl = useCallback(async (url: string): Promise<string> => {
    if (!url || url.startsWith('/') || url.startsWith('data:')) return url;
    try {
      const r = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url, mediaType: 'image' }),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.url) return d.url;
      }
    } catch { /* ignore */ }
    return url;
  }, []);

  // 生成单个角色的正/侧面定妆照
  const generateCharacterImage = useCallback(async (charId: string, view: 'front'|'side') => {
    const char = productionCharacters.find(c => c.id === charId);
    if (!char) return;
    setProductionCharacters(prev => prev.map(c => c.id === charId ? { ...c, status: 'generating' as const, error: undefined } : c));
    try {
      const viewDesc = view === 'front'
        ? 'front view, facing camera, bust portrait, centered, pure white background, frontal eye-level angle'
        : '3/4 side view, bust portrait, pure white background, side angle, cinematic lighting';
      const basePrompt = char.frontPrompt || char.appearance || '';
      const detailBits = [
        char.name ? `${char.name},` : '',
        char.age ? `${char.age},` : '',
        char.gender ? `${char.gender},` : '',
        char.costume ? `wearing ${char.costume},` : '',
      ].filter(Boolean).join(' ');
      const imgPrompt = `character design reference sheet, ${detailBits} ${basePrompt}, ${viewDesc}, studio lighting, high detail, photorealistic portrait, white background, no text, no watermark, sharp focus`;
      const rawUrl = await generateSingleImage(imgPrompt, '1024x1536');
      const url = await persistImageUrl(rawUrl);
      setProductionCharacters(prev => prev.map(c => c.id === charId ? {
        ...c,
        imageUrlFront: view === 'front' ? url : c.imageUrlFront,
        imageUrlSide: view === 'side' ? url : c.imageUrlSide,
        status: undefined,
        error: undefined,
      } : c));
      if (autoInjectAssets) {
        addTypedReference(url, view === 'front' ? 'character-front' : 'character-side');
      }
    } catch (err: unknown) {
      setProductionCharacters(prev => prev.map(c => c.id === charId ? { ...c, status: 'failed' as const, error: getErrorMessage(err, '生成失败') } : c));
    }
  }, [productionCharacters, generateSingleImage, persistImageUrl, autoInjectAssets, addTypedReference]);

  // 生成单个场景氛围图
  const generateSceneImage = useCallback(async (sceneId: string) => {
    const scene = productionScenes.find(s => s.id === sceneId);
    if (!scene) return;
    setProductionScenes(prev => prev.map(s => s.id === sceneId ? { ...s, status: 'generating' as const, error: undefined } : s));
    try {
      const shot = shotPlans.find(sh => sh.id === scene.shotId);
      const ratio = shot?.aspectRatio || aspectRatio || '16:9';
      const size = ratio === '16:9' || ratio === '21:9' ? '1792x1024' : ratio === '9:16' ? '1024x1792' : '1024x1024';
      const base = scene.scenePrompt || scene.description || scene.location || scene.name;
      const envBits = [
        scene.timeOfDay ? `${scene.timeOfDay},` : '',
        scene.weather ? `${scene.weather},` : '',
        scene.lighting ? `${scene.lighting} lighting,` : '',
        scene.mood ? `${scene.mood} mood,` : '',
        scene.colorPalette ? `${scene.colorPalette} tones,` : '',
      ].filter(Boolean).join(' ');
      const imgPrompt = `cinematic establishing shot, ${scene.name}, ${base}, ${envBits} ${directorStyle} style, wide angle, atmospheric, movie still, high detail, photorealistic environment, no text, no watermark, sharp focus`;
      const rawUrl = await generateSingleImage(imgPrompt, size);
      const url = await persistImageUrl(rawUrl);
      setProductionScenes(prev => prev.map(s => s.id === sceneId ? { ...s, imageUrl: url, status: undefined, error: undefined } : s));
      if (autoInjectAssets) {
        addTypedReference(url, 'scene');
      }
    } catch (err: unknown) {
      setProductionScenes(prev => prev.map(s => s.id === sceneId ? { ...s, status: 'failed' as const, error: getErrorMessage(err, '生成失败') } : s));
    }
  }, [productionScenes, shotPlans, aspectRatio, directorStyle, generateSingleImage, persistImageUrl, autoInjectAssets, addTypedReference]);

  // 生成单个道具设定图
  const generatePropImage = useCallback(async (propId: string) => {
    const prop = productionProps.find(p => p.id === propId);
    if (!prop) return;
    setProductionProps(prev => prev.map(p => p.id === propId ? { ...p, status: 'generating' as const, error: undefined } : p));
    try {
      const size = '1024x1024';
      const base = prop.propPrompt || prop.description || prop.name;
      const bits = [
        prop.material ? `${prop.material},` : '',
        prop.color ? `${prop.color} color,` : '',
        prop.scale ? `${prop.scale} size,` : '',
      ].filter(Boolean).join(' ');
      const imgPrompt = `isolated prop object design sheet, ${prop.name}, ${bits} ${base}, studio lighting, on white background, high detail, product photography style, clear silhouette, no text, no watermark, sharp focus`;
      const rawUrl = await generateSingleImage(imgPrompt, size);
      const url = await persistImageUrl(rawUrl);
      setProductionProps(prev => prev.map(p => p.id === propId ? { ...p, imageUrl: url, status: undefined, error: undefined } : p));
      if (autoInjectAssets) {
        addTypedReference(url, 'scene'); // 道具作为 scene 类型参考注入（video-api 支持多参考图）
      }
    } catch (err: unknown) {
      setProductionProps(prev => prev.map(p => p.id === propId ? { ...p, status: 'failed' as const, error: getErrorMessage(err, '生成失败') } : p));
    }
  }, [productionProps, generateSingleImage, persistImageUrl, autoInjectAssets, addTypedReference]);

  const handleGenerateProductionAssets = useCallback(async () => {
    if ((productionCharacters.length === 0 && productionScenes.length === 0 && productionProps.length === 0) || isGeneratingAssets) return;
    setIsGeneratingAssets(true);
    const generatedUrls: string[] = [];
    try {
      // 并发生成所有角色正/侧面定妆照
      const charTasks: Promise<void>[] = [];
      for (const c of productionCharacters) {
        if (!c.imageUrlFront) charTasks.push(generateCharacterImage(c.id, 'front').then(() => {}).catch(() => {}));
      }
      for (const c of productionCharacters) {
        if (!c.imageUrlSide) charTasks.push(generateCharacterImage(c.id, 'side').then(() => {}).catch(() => {}));
      }
      await Promise.allSettled(charTasks);
      // 并发生成所有场景氛围图
      const sceneTasks: Promise<void>[] = [];
      for (const s of productionScenes) {
        if (!s.imageUrl) sceneTasks.push(generateSceneImage(s.id).then(() => {}).catch(() => {}));
      }
      await Promise.allSettled(sceneTasks);
      // 并发生成所有道具设定图
      const propTasks: Promise<void>[] = [];
      for (const p of productionProps) {
        if (!p.imageUrl) propTasks.push(generatePropImage(p.id).then(() => {}).catch(() => {}));
      }
      await Promise.allSettled(propTasks);
      // 收集成功的URL，加到画布
      productionCharacters.forEach(c => {
        if (c.imageUrlFront) generatedUrls.push(c.imageUrlFront);
        if (c.imageUrlSide) generatedUrls.push(c.imageUrlSide);
      });
      productionScenes.forEach(s => {
        if (s.imageUrl) generatedUrls.push(s.imageUrl);
      });
      productionProps.forEach(p => {
        if (p.imageUrl) generatedUrls.push(p.imageUrl);
      });
      if (generatedUrls.length > 0 && onAddImages) {
        try { onAddImages(generatedUrls); } catch {}
      }
    } finally {
      setIsGeneratingAssets(false);
    }
  }, [productionCharacters, productionScenes, productionProps, isGeneratingAssets, generateCharacterImage, generateSceneImage, generatePropImage, onAddImages]);

  const buildProductionFromShots = useCallback((chars?: VideoCharacter[], scenes?: VideoScene[]) => {
    // 若后端直接返回了 characters/scenes 则直接用
    if (chars && chars.length > 0) {
      setProductionCharacters(chars.map(c => ({
        ...c,
        imageUrlFront: c.imageUrlFront || c.frontUrl || '',
        imageUrlSide: c.imageUrlSide || c.sideUrl || '',
        status: undefined,
        error: undefined,
      })));
    } else if (prompt.trim()) {
      setProductionCharacters([{
        id: `char-protagonist-${Date.now()}`,
        name: '主角',
        appearance: prompt.slice(0, 80),
        role: '主角',
        frontPrompt: `${prompt.slice(0, 80)}, character design reference sheet, front view, neutral pose, white background, studio lighting, high detail`,
        sidePrompt: `${prompt.slice(0, 80)}, character design reference sheet, side view, neutral pose, white background, studio lighting, high detail`,
        imageUrlFront: '',
        imageUrlSide: '',
        status: undefined,
        error: undefined,
      }]);
    } else {
      setProductionCharacters([]);
    }
    if (scenes && scenes.length > 0) {
      const idToIdx = new Map<string, number>();
      shotPlans.forEach((s, idx) => idToIdx.set(s.id, idx));
      setProductionScenes(scenes.map((s, i) => {
        let shotId = s.shotId;
        const forShotIds = s.forShotIds;
        if (!shotId && Array.isArray(forShotIds)) {
          const sid = forShotIds[0];
          if (typeof sid === 'number' && shotPlans[sid]) shotId = shotPlans[sid].id;
          else if (typeof sid === 'string' && idToIdx.has(sid)) shotId = sid;
        }
        if (!shotId && shotPlans[i]) shotId = shotPlans[i].id;
        else if (!shotId && shotPlans.length > 0) shotId = shotPlans[0].id;
        return {
          ...s,
          shotId,
          location: s.location || s.description?.slice(0, 40) || s.name,
          lighting: s.lighting || 'natural lighting',
          scenePrompt: s.scenePrompt || `${s.description || s.location || s.name}, cinematic establishing shot, wide angle, atmospheric, high detail, movie still`,
          imageUrl: s.imageUrl || '',
          status: undefined,
          error: undefined,
        };
      }));
    } else {
      setProductionScenes(shotPlans.map(shot => ({
        id: `scene-${shot.id}`,
        shotId: shot.id,
        name: shot.title || `镜头${shot.index + 1}场景`,
        description: shot.setting || shot.prompt.slice(0, 60),
        location: shot.setting || shot.prompt.slice(0, 40),
        timeOfDay: shot.lighting || '',
        lighting: shot.lighting || 'natural lighting',
        scenePrompt: `${shot.prompt} ${shot.setting || ''}, cinematic establishing shot, wide angle, atmospheric, high detail, movie still`,
        imageUrl: '',
        status: undefined,
        error: undefined,
      })));
    }
  }, [shotPlans, prompt]);

  // AI 一键制片：从分镜→角色+场景+道具定妆照
  const runAIPipeline = useCallback(async () => {
    if (productionCharacters.length === 0 && productionScenes.length === 0 && productionProps.length === 0) {
      // 若还没分镜但有 prompt，先调 story-assets/plan 拉取资产清单
      if (!prompt.trim()) {
        onError?.('请先输入剧情描述或进行 AI 分镜规划');
        return;
      }
      setIsBuildingProduction(true);
      try {
        const res = await fetch('/api/story-assets/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyIdea: prompt, duration, aspectRatio, style: directorStyle }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || '资产规划失败');
        const now = Date.now();
        const charList: VideoCharacter[] = Array.isArray(data.characters) ? data.characters : [];
        const sceneList: VideoScene[] = Array.isArray(data.scenes) ? data.scenes : [];
        const propList: VideoProp[] = Array.isArray(data.props) ? data.props : [];
        if (charList.length === 0 && sceneList.length === 0 && propList.length === 0) {
          onError?.('AI 未识别出角色/场景/道具，请用更具体的描述再试');
          return;
        }
        setProductionCharacters((charList as StoryCharacterPayload[]).map((c, i) => ({
          id: c.id || `char-${now}-${i}`,
          name: String(c.name || `角色${i + 1}`).slice(0, 20),
          role: String(c.role || ''),
          age: String(c.age || ''),
          gender: String(c.gender || ''),
          appearance: String(c.appearance || c.looks || c.visualPrompt || ''),
          costume: String(c.costume || c.outfit || ''),
          hair: String(c.hair || ''),
          accessories: String(c.accessories || ''),
          frontPrompt: String(c.frontPrompt || c.appearancePrompt || ''),
          sidePrompt: String(c.sidePrompt || ''),
          keywords: Array.isArray(c.keywords) ? c.keywords.map(String).slice(0, 8) : [],
          imageUrlFront: String(c.frontImageUrl || c.imageUrlFront || ''),
          imageUrlSide: String(c.sideImageUrl || c.imageUrlSide || ''),
          status: 'pending',
        } as VideoCharacter)));
        setProductionScenes((sceneList as StoryScenePayload[]).map((s, i) => ({
          id: s.id || `scene-${now}-${i}`,
          shotId: s.shotId != null ? String(s.shotId) : undefined,
          forShotIds: Array.isArray(s.forShotIds) ? s.forShotIds.map(String) : [],
          name: String(s.name || `场景${i + 1}`).slice(0, 30),
          description: String(s.description || ''),
          location: String(s.location || s.setting || ''),
          timeOfDay: String(s.timeOfDay || ''),
          weather: String(s.weather || ''),
          lighting: String(s.lighting || s.lightingHint || ''),
          mood: String(s.mood || ''),
          colorPalette: String(s.colorPalette || ''),
          keyProps: String(s.keyProps || ''),
          scenePrompt: String(s.scenePrompt || s.environmentPrompt || s.visualPrompt || ''),
          imageUrl: String(s.imageUrl || ''),
          status: 'pending',
        } as VideoScene)));
        setProductionProps((propList as StoryPropPayload[]).map((p, i) => ({
          id: p.id || `prop-${now}-${i}`,
          name: String(p.name || `道具${i + 1}`).slice(0, 20),
          role: String(p.role || ''),
          description: String(p.description || ''),
          material: String(p.material || ''),
          color: String(p.color || ''),
          scale: String(p.scale || ''),
          propPrompt: String(p.propPrompt || p.imagePrompt || ''),
          imageUrl: String(p.imageUrl || ''),
          forShotIds: Array.isArray(p.shotIds) ? p.shotIds.map(String) : (Array.isArray(p.forShotIds) ? p.forShotIds.map(String) : []),
          sceneId: p.sceneId != null ? String(p.sceneId) : undefined,
          status: 'pending',
        } as VideoProp)));
      } catch (err: unknown) {
        onError?.(getErrorMessage(err, '资产规划失败'));
        return;
      } finally {
        setIsBuildingProduction(false);
      }
    }
    setIsGeneratingAssets(true);
    try {
      await handleGenerateProductionAssets();
    } finally {
      setIsGeneratingAssets(false);
    }
  }, [productionCharacters, productionScenes, productionProps, prompt, duration, aspectRatio, directorStyle, handleGenerateProductionAssets, onError]);

  const handleGenerateAllShots = async () => {
    if (!model || shotPlans.length === 0) return;
    setIsGeneratingAllShots(true);
    try {
      const pureModelId = model.includes('::') ? model.split('::').pop()! : model;
      const providerId = currentModel?.providerId || (model.includes('::') ? model.split('::')[0] : undefined);
      const _charRefs = typedReferences.filter(r => r.type.startsWith('character-')).map(r => r.url);
      const _otherRefs = typedReferences.filter(r => !r.type.startsWith('character-') && r.type !== 'first-frame' && r.type !== 'last-frame').map(r => r.url);

      // 自动生成角色/场景资产（若尚未生成）
      if (autoInjectAssets && (productionCharacters.length > 0 || productionScenes.length > 0)) {
        const hasAllCharFront = productionCharacters.every(c => !!(c.imageUrlFront || c.frontUrl));
        const hasAllScene = productionScenes.every(s => !!s.imageUrl);
        if (!hasAllCharFront || !hasAllScene) {
          try { await handleGenerateProductionAssets(); } catch {}
        }
      }
      // 前端串行链式执行：逐个镜头生成，每完成一个自动抽尾帧作为下一镜头首帧
      // 这种方式比后端链式更灵活，支持进度实时展示与单镜头失败重试
      for (let i = 0; i < shotPlans.length; i++) {
        const shot = shotPlans[i];
        await handleGenerateSingleShot(shot.id);
        // 若用户已中断或该镜头失败则终止链
        const latest = shotPlansRef.current.find(s => s.id === shot.id);
        if (!latest || latest.status === 'failed') break;
      }
    } catch (err: unknown) {
      console.error('[shot-plan] 批量生成失败', err);
    } finally {
      setIsGeneratingAllShots(false);
      setCurrentGeneratingShotId(null);
    }
  };

  // 故事视频合成 - 调用 /api/video/tools concat-videos
  const handleComposeStoryVideo = useCallback(async () => {
    const completedShots = shotPlansRef.current
      .filter((shot) => shot.status === 'completed' && Boolean(shot.videoUrl))
      .sort((a, b) => a.index - b.index);

    if (completedShots.length < 2) {
      onError?.('请先完成至少两个镜头，再合成故事视频');
      return;
    }

    if (completedShots.length !== shotPlansRef.current.length) {
      onError?.('请先完成全部镜头，避免成片遗漏剧情段落');
      return;
    }

    setIsComposingStory(true);
    try {
      const response = await fetch('/api/video/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'concat-videos',
          videoUrls: completedShots.map((shot) => shot.videoUrl),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.videoUrl) {
        throw new Error(data.error || '故事视频合成失败');
      }
      onStoryVideoComposed?.({
        videoUrl: data.videoUrl,
        thumbnailUrl: data.thumbnailUrl,
        duration: completedShots.reduce((sum, shot) => sum + (shot.duration || 0), 0),
      });
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '故事视频合成失败');
    } finally {
      setIsComposingStory(false);
    }
  }, [onError, onStoryVideoComposed]);

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
    if (mode === 'video-extend') setIsExtending(true);
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
    const providerId = currentModel?.providerId || (model.includes('::') ? model.split('::')[0] : undefined);

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
          ? (shotPlans.length > 0 ? shotPlans : multiShotScenes.filter(s => s.prompt.trim()))
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
        setIsExtending(false);
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
      setIsExtending(false);
      onError?.(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsExtending(false);
      // setIsGenerating 已在成功路径延迟调用
    }
  }, [prompt, mode, model, aspectRatio, duration, quality, generateAudio, firstFrameUrl, lastFrameUrl, referenceImages, resolution, videoUrl, extendDuration, cameraControl, motionBrush, characterReferences, motionStrength, seed, negativePrompt, multiShotScenes, chainContinuity, useGlobalReferences, batchCount, showLastFrame, onVideoGenerate, onError]);

  const isPrimaryDisabled = mode === 'multi-shot'
    ? (isGeneratingAllShots || (shotPlans.length === 0 && multiShotScenes.every(s => !s.prompt.trim())))
    : (mode === 'video-extend' ? (!videoUrl || isExtending) : isGenerating || !prompt.trim() || !model);

  const primaryLabel = mode === 'multi-shot'
    ? (isGeneratingAllShots ? '镜头生成中...' : `生成 ${shotPlans.filter(s => s.prompt.trim()).length || multiShotScenes.filter(s => s.prompt.trim()).length} 个镜头视频`)
    : (mode === 'video-extend' ? (isExtending ? '延长中...' : '延长视频') : (isGenerating ? '生成中...' : '生成视频'));

  // 从历史记录复用参数
  const reuseHistoryEntry = useCallback((entry: VideoHistoryEntry) => {
    setPrompt(entry.prompt);
    setAspectRatio(entry.aspectRatio);
    setDuration(clampVideoDurationToAllowed(entry.duration, availableDurations));
    if (entry.firstFrameUrl) {
      setFirstFrame(entry.firstFrameUrl);
    }
    if (entry.lastFrameUrl) {
      setLastFrame(entry.lastFrameUrl);
      if (!showLastFrame) setShowLastFrame(true);
    }
  }, [availableDurations, showLastFrame]);

  // 清空历史记录
  const clearHistory = useCallback(() => {
    setVideoHistory([]);
    saveVideoHistory([]);
  }, []);

  // 处理图片上传（支持视频延长模式上传视频）
  const handleImageUpload = useCallback((target: 'first' | 'last' | 'ref' | 'video') => {
    const isVideoTarget = target === 'video';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = isVideoTarget ? 'video/*' : 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      // 文件大小校验（图片 20MB，视频 200MB）
      const maxSize = isVideoTarget ? 200 * 1024 * 1024 : 20 * 1024 * 1024;
      if (file.size > maxSize) {
        onError?.(isVideoTarget ? '视频文件过大（最大 200MB）' : '图片文件过大（最大 20MB）');
        return;
      }
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/save-image', { method: 'POST', body: formData });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || '上传失败');
        }
        const data = await res.json();
        if (!data.url) throw new Error('上传失败：未返回 URL');
        if (target === 'first') setFirstFrame(data.url);
        else if (target === 'last') setLastFrame(data.url);
        else if (target === 'video') {
          setVideoUrl(data.url);
        } else addTypedReference(data.url, 'style');
      } catch (err) {
        onError?.(err instanceof Error ? err.message : (isVideoTarget ? '视频上传失败' : '图片上传失败'));
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

  // 浮动面板样式（纵向布局，标题栏 + 内容上下堆叠）
  const floatingWrapperClass = floating
    ? `fixed z-[210] flex flex-col rounded-2xl shadow-2xl overflow-hidden ${
        isMonochrome ? 'bg-white border border-gray-200' : 'bg-[#141418] border border-white/[0.08]'
      }`
    : 'flex flex-col min-h-full';

  const floatingStyle = floating ? {
    left: panelPosition ? `${panelPosition.x}px` : '50%',
    top: panelPosition ? `${panelPosition.y}px` : '50%',
    transform: panelPosition ? 'none' : 'translate(-50%, -50%)',
    maxHeight: '88vh',
    width: 'min(1180px, 94vw)',
    minWidth: '960px',
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
                onClick={() => { setMode(opt.value); setIsExtending(false); }}
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

        {/* 主体区域 —— flex col：上方滚动区（两列布局）+ 下方固定操作栏 */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar">
        <div className="flex gap-0 min-h-full">
          {/* ============ 左列：风格模板 + 模型选择（340px） ============ */}
          <div
            className="flex-shrink-0 overflow-y-auto overflow-x-hidden px-4 py-4 scrollbar-thin flex flex-col gap-4"
            style={{ width: 340, borderRight: `1px solid ${isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.06)'}`, scrollbarWidth: 'thin' }}
          >
            {/* 导演风格选择 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: subTextColor }}>
                  <Clapperboard className="w-3.5 h-3.5" style={{ color: accentColor }} />导演风格
                </label>
                <button
                  onClick={() => setUseDirector(!useDirector)}
                  className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
                  style={{
                    background: useDirector ? `linear-gradient(135deg, ${accentColor}, ${isGold ? '#8b7225' : '#1d4ed8'})` : isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.05)',
                    color: useDirector ? '#0a0a0a' : subTextColor,
                    border: useDirector ? 'none' : `1px solid ${borderColor}`,
                    boxShadow: useDirector ? `0 2px 6px ${accentColor}40` : 'none',
                  }}
                  title="导演增强：自动补充运镜/光线/表演/氛围"
                >
                  {useDirector ? '已开启' : '关闭'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { v: 'cinematic', label: '🎬 电影感', desc: '景别/运镜/光影' },
                  { v: 'documentary', label: '📹 纪录片', desc: '纪实/手持/自然光' },
                  { v: 'commercial', label: '📺 广告片', desc: '高光/特写/节奏' },
                  { v: 'music-video', label: '🎵 MV', desc: '节奏/光影/色彩' },
                  { v: 'anime', label: '🎨 动漫', desc: '风格化/夸张/张力' },
                  { v: 'minimal', label: '◻️ 极简', desc: '留白/克制/长镜头' },
                ] as Array<{ v: DirectorStyle; label: string; desc: string }>).map(s => {
                  const active = useDirector && directorStyle === s.v;
                  return (
                    <button
                      key={s.v}
                      onClick={() => { setDirectorStyle(s.v); if (!useDirector) setUseDirector(true); }}
                      className="flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-md text-[10px] font-medium transition-all cursor-pointer"
                      style={{
                        background: active ? accentColor : isMonochrome ? '#f9fafb' : 'rgba(255,255,255,0.03)',
                        color: active ? (isGold ? '#0a0a0a' : '#fff') : subTextColor,
                        border: `1px solid ${active ? accentColor : borderColor}`,
                        boxShadow: active ? `0 2px 6px ${accentColor}40` : 'none',
                      }}
                    >
                      <span className="text-sm leading-none">{s.label.split(' ')[0]}</span>
                      <span className="leading-tight text-center">{s.label.split(' ')[1]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 视频模型 */}
            <div>
              <label className="text-[11px] font-semibold mb-1.5 block flex items-center gap-1.5" style={{ color: subTextColor }}>
                <Video className="w-3.5 h-3.5" style={{ color: accentColor }} />视频模型
              </label>
              <div className="relative">
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="w-full px-3 py-2 pr-8 rounded-lg text-[12px] appearance-none cursor-pointer font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition-colors truncate"
                  style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
                >
                  {videoModels.length === 0 && <option value="">请在管理员后台添加视频模型</option>}
                  {videoModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name} · {m.providerName || '未标记供应商'} {m.region === 'cn' ? '🇨🇳' : '🌍'}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: subTextColor }} />
              </div>
            </div>

            {/* 视频模板库（按类别分组） */}
            <div className="space-y-2.5">
            {(['product', 'character', 'landscape', 'effect', 'story'] as const).map(cat => {
              const catTemplates = VIDEO_TEMPLATES.filter(t => t.category === cat);
              const catLabel = { product: '📦 产品展示', character: '👤 人物', landscape: '🏞 风景', effect: '✨ 特效', story: '🎞 故事叙事' }[cat];
              return (
                <div key={cat}>
                  <label className="text-[11px] font-semibold mb-1.5 block" style={{ color: subTextColor }}>{catLabel}</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {catTemplates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setPrompt(prev => prev ? `${prev}, ${t.prompt}` : t.prompt);
                          if (t.aspectRatio) setAspectRatio(t.aspectRatio);
                          if (t.duration && availableDurations.includes(t.duration)) setDuration(t.duration);
                          if (t.cameraControl) setCameraControl({ ...t.cameraControl, intensity: t.cameraControl.intensity || 50 });
                        }}
                        className="px-2 py-1.5 rounded-md text-[10.5px] text-left transition-all cursor-pointer hover:scale-[1.02] leading-tight"
                        style={{
                          background: isMonochrome ? '#f9fafb' : 'rgba(255,255,255,0.03)',
                          color: subTextColor,
                          border: `1px solid ${borderColor}`,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = accentColor + '80'; e.currentTarget.style.color = textColor as string; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = borderColor as string; e.currentTarget.style.color = subTextColor as string; }}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          {/* ============ 右列：提示词 + 参数（flex-1 自适应，内部纵向分为滚动区 + 底部按钮） ============ */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 pt-4 pb-2 scrollbar-thin min-h-0" style={{ scrollbarWidth: 'thin' }}>
            {/* ======== 视频描述区 ======== */}
            <div className="flex flex-col gap-3 min-w-0">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: subTextColor }}>
                    视频描述
                    {useDirector && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1"
                        style={{
                          background: `linear-gradient(135deg, ${accentColor}, ${isGold ? '#8b7225' : '#1d4ed8'})`,
                          color: '#0a0a0a',
                          boxShadow: `0 2px 6px ${accentColor}30`,
                        }}
                      >
                        <Clapperboard className="w-2.5 h-2.5" />导演模式
                      </span>
                    )}
                  </label>
                </div>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder={mode === 'video-extend' ? '描述希望延长的内容方向，如：继续向前推进、保持人物动作...' : useDirector ? '输入创意/剧本/想法，导演会自动补充运镜/光线/表演/氛围...' : '描述你想生成的视频画面，如：一位女性在海边漫步，夕阳西下，金色的阳光洒在海面上...'}
                rows={4}
                className="w-full px-3.5 py-2.5 rounded-lg text-[13px] resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition-colors leading-relaxed mt-2"
                style={{
                  background: inputBg,
                  color: textColor,
                  border: `1px solid ${useDirector ? (isGold ? 'rgba(212,175,55,0.4)' : 'rgba(59,130,246,0.4)') : borderColor}`,
                  boxShadow: useDirector ? `0 0 0 1px ${isGold ? 'rgba(212,175,55,0.1)' : 'rgba(59,130,246,0.1)'}` : 'none',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = accentColor; }}
                onBlur={e => { e.currentTarget.style.borderColor = useDirector ? (isGold ? 'rgba(212,175,55,0.4)' : 'rgba(59,130,246,0.4)') : borderColor; }}
              />
              {/* AI 增强工具栏 */}
              <div className="flex flex-wrap gap-2 mt-2 items-center">
                <button
                  onClick={handleDirectorEnhance}
                  disabled={!prompt.trim() || isDirectorEnhancing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: isDirectorEnhancing ? `${accentColor}40` : `linear-gradient(135deg, ${accentColor}, ${isGold ? '#8b7225' : '#1d4ed8'})`,
                    color: '#fff',
                    boxShadow: isDirectorEnhancing ? 'none' : `0 2px 8px ${accentColor}40`,
                  }}
                >
                  {isDirectorEnhancing ? (
                    <><span className="inline-block w-3 h-3 border-[1.5px] border-white border-t-transparent rounded-full animate-spin" />导演增强中...</>
                  ) : (
                    <><Sparkles className="w-3 h-3" />AI 导演增强</>
                  )}
                </button>
                {useDirector && directorResult && (
                  <span className="text-[10px] px-2 py-1 rounded-md flex items-center gap-1" style={{ background: `${accentColor}15`, color: accentColor }}>
                    <CheckCircle2 className="w-3 h-3" />提示词已增强
                  </span>
                )}
                <button
                  onClick={handleTranslatePrompt}
                  disabled={!prompt.trim() || isTranslating}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all disabled:opacity-40 cursor-pointer"
                  style={{ background: isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.05)', color: subTextColor, border: `1px solid ${borderColor}` }}
                >
                  {isTranslating ? <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" /> : <Languages className="w-3 h-3" />}
                  中英翻译
                </button>
                <button
                  onClick={() => {
                    setNegativePrompt(negativePrompt || '模糊，低质量，变形，畸形，水印，文字，过曝，暗部死黑');
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer"
                  style={{ background: isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.05)', color: subTextColor, border: `1px solid ${borderColor}` }}
                >
                  <SlidersHorizontal className="w-3 h-3" />反向提示词
                </button>
                {useDirector && (
                  <button
                    onClick={handlePlanShots}
                    disabled={!prompt.trim() || isPlanningShots}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: isPlanningShots ? 'rgba(255,255,255,0.08)' : isMonochrome ? '#1f2937' : 'rgba(212,175,55,0.15)',
                      color: isPlanningShots ? subTextColor : accentColor,
                      border: `1px solid ${accentColor}40`,
                    }}
                  >
                    {isPlanningShots ? (
                      <><span className="inline-block w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" />AI 分镜规划中...</>
                    ) : (
                      <><Film className="w-3 h-3" />AI 分镜</>
                    )}
                  </button>
                )}
              </div>

              {useDirector && prompt.trim() && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-md" style={{ background: `${accentColor}0d`, color: accentColor, border: `1px solid ${accentColor}30` }}>
                  <Clapperboard className="w-3 h-3 shrink-0" />
                  <span>导演模式：生成时自动编排镜头景别/运镜/光影/表演/声音</span>
                </div>
              )}

              {/* 快捷标签 */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {['电影感', '慢动作', '微距特写', '航拍', 'cinematic lighting', '4K'].map(tag => (
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
                {/* 多参考图（图生视频模式下，受模型能力约束） */}
                {(mode === 'image2video-first' || mode === 'multi-shot') && currentFeatures?.multiReference && (
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
                        className="w-full px-3 py-2 rounded-md text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
                      />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => handleImageUpload('video')} className="flex-1 py-2 rounded-md text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer" style={{ background: inputBg, color: subTextColor, border: `1px dashed ${borderColor}` }}>
                          <Upload className="w-3 h-3" />上传视频
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <label className={labelClass}>延长时长</label>
                  <div className="flex gap-1.5">
                    {[3, 5, 8, 10].filter(d => availableDurations.includes(d)).map(d => (
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

            {/* 参数区：网格双列避免挤压 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>画面比例</label>
                <div className="grid grid-cols-3 gap-1">
                  {availableRatios.map(r => (
                    <button
                      key={r}
                      onClick={() => setAspectRatio(r)}
                      className="flex items-center justify-center gap-1 px-1 py-1.5 rounded-md text-[10.5px] font-medium transition-all cursor-pointer whitespace-nowrap"
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
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10.5px] font-medium" style={{ color: subTextColor }}>
                    <span>{availableDurations[0]}s</span>
                    <span style={{ color: accentColor }}>{duration}s</span>
                    <span>{availableDurations[availableDurations.length - 1]}s</span>
                  </div>
                  <input
                    aria-label="视频时长"
                    className="w-full accent-current cursor-pointer"
                    max={Math.max(availableDurations.length - 1, 0)}
                    min={0}
                    onChange={(event) => setDuration(availableDurations[Number(event.target.value)])}
                    step={1}
                    style={{ accentColor }}
                    type="range"
                    value={Math.max(availableDurations.indexOf(duration), 0)}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>生成质量</label>
                <div className="grid grid-cols-2 gap-1">
                  {(['std', 'pro'] as const).map(q => (
                    <button
                      key={q}
                      onClick={() => setQuality(q)}
                      className="px-1 py-1.5 rounded-md text-[10.5px] font-medium transition-all cursor-pointer whitespace-nowrap"
                      style={{
                        background: quality === q ? (isGold ? 'rgba(212,175,55,0.18)' : 'rgba(59,130,246,0.18)') : inputBg,
                        color: quality === q ? accentColor : subTextColor,
                        border: `1px solid ${quality === q ? accentColor : borderColor}`,
                      }}
                    >{q === 'std' ? '标准' : '高清Pro'}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>生成数量</label>
                <div className="flex items-center gap-1">
                  {([1, 2, 4] as const).map(n => (
                    <button
                      key={n}
                      onClick={() => setBatchCount(n)}
                      className="flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer"
                      style={{
                        background: batchCount === n ? accentColor : inputBg,
                        color: batchCount === n ? (isGold ? '#0a0a0a' : '#fff') : subTextColor,
                        border: `1px solid ${batchCount === n ? accentColor : borderColor}`,
                        boxShadow: batchCount === n ? `0 2px 6px ${accentColor}30` : 'none',
                      }}
                    >{n}x</button>
                  ))}
                </div>
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
                  {(['character-front', 'character-side'] as const).map(charType => {
                    const already = typedReferences.some(r => r.type === charType);
                    if (already) return null;
                    return (
                      <button
                        key={charType}
                        onClick={() => {
                          const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
                          input.onchange = async (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
                            if (file.size > 20 * 1024 * 1024) { onError?.('图片文件过大（最大 20MB）'); return; }
                            try {
                              const fd = new FormData(); fd.append('file', file);
                              const res = await fetch('/api/save-image', { method: 'POST', body: fd });
                              if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || '上传失败'); }
                              const data = await res.json();
                              if (data?.url) addTypedReference(data.url, charType as 'character-front' | 'character-side');
                              else throw new Error('上传失败：未返回 URL');
                            } catch (err) {
                              onError?.(err instanceof Error ? err.message : '图片上传失败');
                            }
                          };
                          input.click();
                        }}
                        className="w-16 h-16 rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors hover:scale-105"
                        style={{ borderColor: borderColor }}
                      >
                        <Plus className="w-4 h-4" style={{ color: accentColor }} />
                        <span className="text-[9px]" style={{ color: subTextColor }}>{REFERENCE_TYPE_CONFIG[charType]?.label}</span>
                      </button>
                    );
                  })}
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
                    <ToggleBtn active={tailFrameRelay} onClick={() => setTailFrameRelay(!tailFrameRelay)} accent={accentColor} sub={subTextColor} mono={isMonochrome}>尾帧接力</ToggleBtn>
                    <ToggleBtn active={chainContinuity} onClick={() => setChainContinuity(!chainContinuity)} accent={accentColor} sub={subTextColor} mono={isMonochrome}>链式连贯</ToggleBtn>
                    <ToggleBtn active={useGlobalReferences} onClick={() => setUseGlobalReferences(!useGlobalReferences)} accent={accentColor} sub={subTextColor} mono={isMonochrome}>全局参考图</ToggleBtn>
                  </div>
                </div>

                {/* === AI 一键制片流水线：角色卡 + 场景氛围图 + 道具 === */}
                {(productionCharacters.length > 0 || productionScenes.length > 0 || productionProps.length > 0) && (
                  <div className="mb-3 p-2.5 rounded-lg border" style={{ borderColor: borderColor, background: isMonochrome ? 'rgba(0,0,0,0.15)' : 'rgba(168,85,247,0.05)' }}>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Sparkles className="w-3.5 h-3.5" style={{ color: '#a855f7' }} />
                      <span className="text-[11px] font-semibold" style={{ color: textColor }}>AI 一键制片</span>
                      <span className="text-[9px]" style={{ color: subTextColor }}>
                        {productionCharacters.length}角色 / {productionScenes.length}场景{productionProps.length > 0 ? ` / ${productionProps.length}道具` : ''}
                      </span>
                      <ToggleBtn active={autoInjectAssets} onClick={() => setAutoInjectAssets(!autoInjectAssets)} accent="#a855f7" sub={subTextColor} mono={isMonochrome}>自动注入</ToggleBtn>
                      <button
                        onClick={handleGenerateProductionAssets}
                        disabled={isGeneratingAssets}
                        className="ml-auto px-2 py-0.5 rounded text-[9px] font-semibold cursor-pointer disabled:opacity-40 flex items-center gap-1"
                        style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', color: '#fff' }}
                      >
                        {isGeneratingAssets ? (<><span className="inline-block w-2 h-2 border-[1.5px] border-white border-t-transparent rounded-full animate-spin" />生成资产中...</>) : <>✨ 生成全部资产</>}
                      </button>
                    </div>

                    {/* 角色卡区 */}
                    {productionCharacters.length > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Users className="w-3 h-3" style={{ color: '#ec4899' }} />
                          <span className="text-[10px] font-medium" style={{ color: subTextColor }}>角色定妆照</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {productionCharacters.map(char => {
                            const frontUrl = char.imageUrlFront || char.frontUrl;
                            const sideUrl = char.imageUrlSide || char.sideUrl;
                            const isGenerating = char.status === 'generating' || char.generating;
                            const isFailed = char.status === 'failed' || !!char.error;
                            return (
                              <div key={char.id} className="p-1.5 rounded-md" style={{ background: inputBg, border: `1px solid ${borderColor}` }}>
                                <div className="text-[10px] font-semibold truncate mb-1" style={{ color: textColor }} title={char.appearance}>
                                  {char.appearance.slice(0, 14)}{char.appearance.length > 14 ? '…' : ''}
                                </div>
                                <div className="grid grid-cols-2 gap-1">
                                  <div className="aspect-square rounded overflow-hidden relative flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
                                    {frontUrl ? <img src={frontUrl} alt="正面" className="w-full h-full object-cover" /> :
                                      isGenerating ? <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: '#ec4899' }} /> :
                                      isFailed ? <RefreshCw className="w-3 h-3 text-red-400" /> :
                                      <User className="w-4 h-4 opacity-30" />}
                                    <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center py-0.5 bg-black/60 text-white/80">正面</span>
                                  </div>
                                  <div className="aspect-square rounded overflow-hidden relative flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
                                    {sideUrl ? <img src={sideUrl} alt="侧面" className="w-full h-full object-cover" /> :
                                      isGenerating ? <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: '#ec4899' }} /> :
                                      isFailed ? <RefreshCw className="w-3 h-3 text-red-400" /> :
                                      <User className="w-4 h-4 opacity-30" />}
                                    <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center py-0.5 bg-black/60 text-white/80">侧面</span>
                                  </div>
                                </div>
                                {char.error && <div className="text-[9px] text-red-400 mt-1 truncate" title={char.error}>{char.error}</div>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 场景氛围图区 */}
                    {productionScenes.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Mountain className="w-3 h-3" style={{ color: '#10b981' }} />
                          <span className="text-[10px] font-medium" style={{ color: subTextColor }}>场景氛围图</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {productionScenes.map(scene => {
                            const shotIdx = scene.forShotIds?.[0];
                            const shotForScene = typeof shotIdx === 'number' ? shotPlans[shotIdx] : (scene.shotId ? shotPlans.find(s => s.id === scene.shotId || s.sceneId === scene.id) : undefined);
                            const sceneDesc = scene.description || scene.location || scene.name;
                            const isGen = scene.status === 'generating' || scene.generating;
                            const isFail = scene.status === 'failed' || !!scene.error;
                            return (
                              <div key={scene.id} className="rounded-md overflow-hidden relative" style={{ background: inputBg, border: `1px solid ${borderColor}` }}>
                                <div className="aspect-video relative flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
                                  {scene.imageUrl ? <img src={scene.imageUrl} alt={sceneDesc} className="w-full h-full object-cover" /> :
                                    isGen ? <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: '#10b981' }} /> :
                                    isFail ? <RefreshCw className="w-4 h-4 text-red-400" /> :
                                    <ImageIcon className="w-5 h-5 opacity-30" />}
                                </div>
                                <div className="p-1">
                                  <div className="text-[9px] font-medium truncate" style={{ color: textColor }} title={sceneDesc}>
                                    {sceneDesc.slice(0, 12)}{sceneDesc.length > 12 ? '…' : ''}
                                  </div>
                                  {shotForScene && <div className="text-[8px]" style={{ color: subTextColor }}>镜头 {shotPlans.indexOf(shotForScene) + 1}</div>}
                                  {scene.error && <div className="text-[8px] text-red-400 truncate">{scene.error}</div>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 道具资产区 */}
                    {productionProps.length > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Package className="w-3 h-3" style={{ color: '#f59e0b' }} />
                          <span className="text-[10px] font-medium" style={{ color: subTextColor }}>关键道具</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {productionProps.map(prop => {
                            const propDesc = prop.description || prop.name;
                            const isGen = prop.status === 'generating' || prop.generating;
                            const isFail = prop.status === 'failed' || Boolean(prop.error);
                            return (
                              <div key={prop.id} className="rounded-md overflow-hidden relative" style={{ background: inputBg, border: `1px solid ${borderColor}` }}>
                                <div className="aspect-square relative flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
                                  {prop.imageUrl ? <img src={prop.imageUrl} alt={prop.name} className="w-full h-full object-cover" /> :
                                    isGen ? <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: '#f59e0b' }} /> :
                                    isFail ? <RefreshCw className="w-4 h-4 text-red-400" /> :
                                    <Package className="w-5 h-5 opacity-30" />}
                                </div>
                                <div className="p-1">
                                  <div className="text-[9px] font-medium truncate" style={{ color: textColor }} title={prop.name}>{prop.name}</div>
                                  {prop.error && <div className="text-[8px] text-red-400 truncate">{prop.error}</div>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {(productionCharacters.some(c => c.imageUrlFront || c.frontUrl) || productionScenes.some(s => s.imageUrl) || productionProps.some(p => p.imageUrl)) && (
                      <div className="mt-2 pt-2" style={{ borderTop: `1px dashed ${borderColor}` }}>
                        <div className="text-[9px] flex items-start gap-1" style={{ color: subTextColor }}>
                          <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" style={{ color: '#10b981' }} />
                          <span>定妆照/场景图/道具图生成完成后会自动作为角色参考/镜头首帧/场景锚点注入，多镜头生成时人物、场景、道具保持一致。</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {shotPlans.length > 0 ? (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {shotPlans.map((shot, idx) => {
                      const isShotGenerating = currentGeneratingShotId === shot.id;
                      const shotRefs = shot.references || [];
                      return (
                        <div
                          key={shot.id}
                          className="p-3 rounded-lg relative overflow-hidden transition-all"
                          style={{
                            background: panelBg,
                            border: `1px solid ${shot.status === 'failed' ? '#ef4444' : borderColor}`,
                            boxShadow: shot.status === 'completed' ? `0 0 0 1px ${accentColor}40 inset` : 'none',
                          }}
                        >
                          {/* 顶部行：序号+标题+时长+状态 */}
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                style={{
                                  background:
                                    shot.status === 'completed' ? accentColor :
                                    shot.status === 'failed' ? '#ef4444' :
                                    isShotGenerating ? `${accentColor}30` : `${accentColor}20`,
                                  color: shot.status === 'completed' ? '#0a0a0a' : accentColor,
                                }}
                              >
                                {isShotGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : idx + 1}
                              </span>
                              <span className="text-[11px] font-semibold truncate" style={{ color: textColor }}>
                                {shot.title || `镜头 ${idx + 1}`}
                              </span>
                              {shot.purpose && (
                                <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={{ background: subTextColor + '15', color: subTextColor }}>
                                  {shot.purpose}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{ background: `${accentColor}20`, color: accentColor }}>
                                {shot.duration}s
                              </span>
                              {/* 上移/下移 */}
                              <button
                                onClick={() => {
                                  if (idx === 0) return;
                                  const copy = [...shotPlans];
                                  [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                                  setShotPlans(copy);
                                }}
                                disabled={idx === 0 || isShotGenerating || isGeneratingAllShots}
                                className="cursor-pointer hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                                style={{ color: subTextColor }}
                                title="上移"
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => {
                                  if (idx === shotPlans.length - 1) return;
                                  const copy = [...shotPlans];
                                  [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                                  setShotPlans(copy);
                                }}
                                disabled={idx === shotPlans.length - 1 || isShotGenerating || isGeneratingAllShots}
                                className="cursor-pointer hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                                style={{ color: subTextColor }}
                                title="下移"
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => setShotPlans(shotPlans.filter((_, i) => i !== idx))}
                                disabled={isShotGenerating || isGeneratingAllShots}
                                className="cursor-pointer hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                                style={{ color: subTextColor }}
                                title="删除"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {/* 结构化标签行：景别/运镜/光线/声音 */}
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {shot.shotSize && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ background: 'rgba(59,130,246,0.12)', color: '#60a5fa' }}>
                                <Maximize2 className="w-2.5 h-2.5" />{shot.shotSize}
                              </span>
                            )}
                            {shot.cameraMove && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}>
                                <Video className="w-2.5 h-2.5" />{shot.cameraMove}
                              </span>
                            )}
                            {shot.lighting && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ background: 'rgba(234,179,8,0.12)', color: '#facc15' }}>
                                <Sparkles className="w-2.5 h-2.5" />{shot.lighting.substring(0, 14)}{shot.lighting.length > 14 ? '…' : ''}
                              </span>
                            )}
                            {shot.audioCues && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ background: 'rgba(168,85,247,0.12)', color: '#c084fc' }}>
                                <Volume2 className="w-2.5 h-2.5" />{shot.audioCues.substring(0, 14)}{shot.audioCues.length > 14 ? '…' : ''}
                              </span>
                            )}
                            {shotRefs.slice(0, 3).map((r, ri) => (
                              <span key={ri} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)', color: subTextColor }}>
                                {r.role === 'character' ? '👤角色' : r.role === 'scene' ? '🏞场景' : r.role === 'style' ? '🎨风格' : r.role === 'first-frame' ? '🖼首帧' : r.role}
                              </span>
                            ))}
                          </div>

                          {/* 镜头描述 */}
                          <textarea
                            value={shot.directedPrompt || shot.prompt}
                            onChange={e => {
                              const copy = [...shotPlans];
                              copy[idx] = { ...copy[idx], prompt: e.target.value, directedPrompt: e.target.value };
                              setShotPlans(copy);
                            }}
                            rows={2}
                            className="w-full px-2 py-1.5 rounded text-[11px] resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 leading-relaxed"
                            style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
                          />

                          {/* 连续性备注 */}
                          {shot.continuityNotes && shot.continuityNotes.length > 0 && (
                            <div className="mt-1 text-[9px] leading-relaxed px-1" style={{ color: subTextColor }}>
                              <span className="font-semibold" style={{ color: accentColor }}>连续性: </span>
                              {shot.continuityNotes.slice(0, 2).join(' · ')}
                            </div>
                          )}

                          {/* 缩略图（已完成） */}
                          {shot.status === 'completed' && shot.thumbnailUrl && (
                            <div className="mt-1.5 rounded overflow-hidden" style={{ border: `1px solid ${borderColor}` }}>
                              <img src={shot.thumbnailUrl} alt={shot.title} className="w-full h-20 object-cover" />
                            </div>
                          )}

                          {/* 错误信息 */}
                          {shot.status === 'failed' && shot.error && (
                            <div className="mt-1.5 p-1.5 rounded text-[10px] flex items-start gap-1" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                              <span className="flex-1">{shot.error}</span>
                            </div>
                          )}

                          {/* 诊断建议 */}
                          {shot.diagnosis && shot.diagnosis.length > 0 && diagnoseOpen === shot.id && (
                            <div className="mt-1.5 p-2 rounded space-y-1" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.3)' }}>
                              <div className="text-[10px] font-semibold flex items-center gap-1 mb-1" style={{ color: '#facc15' }}>
                                <AlertCircle className="w-3 h-3" />单变量重拍建议
                              </div>
                              {shot.diagnosis.map((d: { label?: string; description?: string; patch?: Record<string, unknown>; promptAppend?: string; negativeAppend?: string; title?: string }, di: number) => (
                                <div key={di} className="text-[10px] flex items-start gap-2" style={{ color: '#fde68a' }}>
                                  <span className="shrink-0 text-[9px] mt-0.5">{di + 1}.</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold">{d.label || d.title}</div>
                                    {d.description && <div className="text-[9px] opacity-80 mt-0.5">{d.description}</div>}
                                  </div>
                                  <button
                                    onClick={async () => {
                                      const copy = [...shotPlans];
                                      const patch = d.patch || {};
                                      // 应用 prompt/negative 追加
                                      let newPrompt = copy[idx].prompt;
                                      let newNegative = negativePrompt || '';
                                      if (d.promptAppend) newPrompt = newPrompt + '。' + d.promptAppend;
                                      if (d.negativeAppend) newNegative = newNegative ? newNegative + ', ' + d.negativeAppend : d.negativeAppend;
                                      copy[idx] = { ...copy[idx], diagnosis: undefined, prompt: newPrompt, directedPrompt: newPrompt };
                                      setShotPlans(copy);
                                      setNegativePrompt(newNegative);
                                      setDiagnoseOpen(null);
                                      await handleGenerateSingleShot(shot.id);
                                      void patch;
                                    }}
                                    className="text-[9px] px-1.5 py-0.5 rounded cursor-pointer shrink-0 font-semibold"
                                    style={{ background: '#facc15', color: '#0a0a0a' }}
                                  >
                                    应用并重拍
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* 操作按钮 */}
                          <div className="flex gap-1.5 mt-2 flex-wrap items-center">
                            <button
                              onClick={() => handleGenerateSingleShot(shot.id)}
                              disabled={isShotGenerating || isGeneratingAllShots}
                              className="text-[10px] px-2 py-1 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                              style={{ background: `${accentColor}25`, color: accentColor }}
                            >
                              {isShotGenerating ? <><Loader2 className="w-3 h-3 animate-spin" />生成中</> : <><Play className="w-3 h-3" />{shot.status === 'completed' ? '重拍' : shot.status === 'failed' ? '重试' : '生成'}</>}
                            </button>
                            {shot.status === 'completed' && shot.videoUrl && (
                              <button
                                onClick={() => window.open(shot.videoUrl, '_blank')}
                                className="text-[10px] px-2 py-1 rounded transition-colors cursor-pointer flex items-center gap-1"
                                style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}
                              >
                                <Play className="w-3 h-3 fill-current" />播放
                              </button>
                            )}
                            {shot.status === 'failed' && (
                              <button
                                onClick={async () => {
                                  if (diagnoseOpen === shot.id) { setDiagnoseOpen(null); return; }
                                  setDiagnoseOpen(shot.id);
                                  await handleDiagnoseFailed(shot);
                                }}
                                className="text-[10px] px-2 py-1 rounded transition-colors cursor-pointer flex items-center gap-1"
                                style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
                              >
                                <AlertCircle className="w-3 h-3" />诊断
                              </button>
                            )}
                            {shot.status === 'completed' && (
                              <span className="text-[9px] flex items-center gap-0.5 ml-auto" style={{ color: '#4ade80' }}>
                                <CheckCircle2 className="w-3 h-3" />完成
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
                            className="w-full px-2 py-1.5 rounded text-[11px] resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
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
                {shotPlans.length > 0 && (
                  <>
                    <button
                      onClick={handleGenerateAllShots}
                      disabled={isGeneratingAllShots || isGenerating}
                      className="w-full mt-2 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: accentColor, color: '#0a0a0a' }}
                    >
                      {isGeneratingAllShots ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" />连续生成中（尾帧→首帧串联）...</>) : (<><Film className="w-3.5 h-3.5" />生成全部镜头（自动串联尾帧→首帧）</>)}
                    </button>
                    <button
                      onClick={handleComposeStoryVideo}
                      disabled={isComposingStory || isGeneratingAllShots || shotPlans.some((shot) => shot.status !== 'completed' || !shot.videoUrl)}
                      className="w-full mt-1.5 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: `${accentColor}22`, color: accentColor, border: `1px solid ${accentColor}66` }}
                    >
                      {isComposingStory ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" />合成故事视频中...</>) : (<><Clapperboard className="w-3.5 h-3.5" />合成故事视频</>)}
                    </button>
                    <button
                      onClick={() => {
                        const newShot: VideoShotPlan = {
                          id: `shot-${Date.now()}`,
                          index: shotPlans.length,
                          title: `镜头 ${shotPlans.length + 1}`,
                          purpose: '',
                          prompt: '',
                          shotSize: '',
                          cameraMotion: '',
                          cameraMove: '',
                          actionBeat: '',
                          lighting: '',
                          audioCues: '',
                          references: [],
                          continuityNotes: [],
                          duration: duration as number,
                          aspectRatio: aspectRatio as string,
                          firstFrameFromPrev: chainContinuity && shotPlans.length > 0,
                          firstFrameUrl: undefined,
                          lastFrameUrl: undefined,
                          status: 'planned',
                          diagnosis: null,
                          retakeCount: 0,
                          error: undefined,
                          videoUrl: undefined,
                          thumbnailUrl: undefined,
                          directedPrompt: undefined,
                          endState: undefined,
                          motion: null,
                        };
                        const copy = [...shotPlans, newShot];
                        setShotPlans(copy);
                        shotPlansRef.current = copy;
                      }}
                      disabled={isGeneratingAllShots || isGenerating}
                      className="w-full mt-1.5 py-1.5 rounded-md border-2 border-dashed text-[11px] flex items-center justify-center gap-1 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ borderColor: borderColor, color: subTextColor }}
                    >
                      <Plus className="w-3 h-3" />添加镜头
                    </button>
                  </>
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
                {!prompt.trim() && <p className="text-[10px] mt-2" style={{ color: subTextColor }}>💡 先在上方“视频描述”输入故事梗概，再点击“AI分镜规划”</p>}
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
                    className="w-full rounded-md px-2.5 py-1.5 text-[11px] resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
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
                    className="flex-1 rounded-md px-2.5 py-1.5 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
                  />
                  <button onClick={() => setSeed(Math.floor(Math.random() * 2147483647))} className="px-2.5 py-1.5 rounded-md text-sm cursor-pointer" style={{ background: inputBg, color: subTextColor, border: `1px solid ${borderColor}` }}>🎲</button>
                </div>
              </div>
            </CollapsibleSection>

            {/* 生成按钮放在右列底部操作栏（独立于滚动区），此处不再渲染 */}
            {/* 历史记录 */}
            {videoHistory.length > 0 && (
              <div className="mt-3">
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
          </div>{/* 右列滚动区结束 */}
          </div>{/* 右列 flex-1 结束 */}
        </div>{/* 两列 flex gap-0 结束 */}
        </div>{/* 主体滚动区结束 */}

        {/* 底部固定操作栏（独立于滚动区，避免被挤压折叠） */}
        <div className="shrink-0 pt-3 px-4 pb-4 border-t" style={{ borderColor: isGold ? 'rgba(212,175,55,0.18)' : (isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.08)'), background: isMonochrome ? '#ffffff' : 'rgba(0,0,0,0.2)' }}>
          <button
            onClick={handleGenerate}
            disabled={isPrimaryDisabled}
            className="w-full py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: isGenerating ? (isGold ? 'rgba(212,175,55,0.6)' : 'rgba(59,130,246,0.6)') : accentColor,
              color: '#fff',
              boxShadow: isGenerating ? 'none' : `0 4px 14px ${isGold ? 'rgba(212,175,55,0.4)' : 'rgba(59,130,246,0.4)'}`,
            }}
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {primaryLabel}
          </button>
        </div>
        {/* 主体 flex-1 flex flex-col 容器结束 */}
        </div>
        </div>
        </div>
        )}
    </div>
  );
});

// 可折叠区块（内联组件，保持简洁）
function CollapsibleSection({ title, icon, iconColor, badge, defaultOpen = false, isMonochrome, accentColor, inputBg, borderColor, subTextColor, textColor, children }: {
  title: string;
  icon?: ReactNode;
  iconColor?: string;
  badge?: string;
  defaultOpen?: boolean;
  isMonochrome: boolean;
  accentColor: string;
  inputBg: string;
  borderColor: string;
  subTextColor: string;
  textColor: string;
  children: ReactNode;
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
  active: boolean; onClick: () => void; accent: string; sub: string; mono: boolean; children: ReactNode;
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

export default VideoGenerationPanel;
