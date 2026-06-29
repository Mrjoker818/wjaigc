'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  Play, Video, ImagePlus, Clock, Settings2,
  ChevronDown, Loader2, Sparkles, Volume2, VolumeX,
  Upload, X, AlertCircle, Info, FastForward, Users, Plus, Paintbrush, Film
} from 'lucide-react';
import MotionBrushCanvas, { type MotionBrushResult, type MotionBrushCanvasHandle } from './motion-brush-canvas';

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
  // 人物
  { id: 'character-portrait', name: '人物肖像', category: 'character', prompt: '一位优雅的人物肖像，柔和的背景光，电影级色彩', aspectRatio: '3:4', duration: 5 },
  { id: 'character-action', name: '人物动作', category: 'character', prompt: '人物做出流畅的动作，头发和衣服自然飘动，慢动作效果', aspectRatio: '16:9', duration: 5 },
  // 风景
  { id: 'landscape-pan', name: '风景横摇', category: 'landscape', prompt: '壮丽的自然风景，山川河流，日出时分，金色阳光', aspectRatio: '21:9', duration: 8, cameraControl: { type: 'pan_right', intensity: 40 } },
  { id: 'landscape-aerial', name: '航拍视角', category: 'landscape', prompt: '航拍视角俯瞰大地，云层缭绕，壮观的自然景观', aspectRatio: '16:9', duration: 8, cameraControl: { type: 'push_in', intensity: 30 } },
  // 特效
  { id: 'effect-transition', name: '转场特效', category: 'effect', prompt: '粒子消散转场效果，从清晰到模糊，梦幻氛围', aspectRatio: '16:9', duration: 3 },
  { id: 'effect-slowmo', name: '慢动作', category: 'effect', prompt: '慢动作捕捉瞬间，水滴飞溅，时间凝固的感觉', aspectRatio: '16:9', duration: 5 },
  // 故事
  { id: 'story-opening', name: '故事开场', category: 'story', prompt: '电影开场镜头，从远景缓慢推进到主体，营造悬念氛围', aspectRatio: '2.35:1', duration: 8, cameraControl: { type: 'push_in', intensity: 20 } },
  { id: 'story-climax', name: '故事高潮', category: 'story', prompt: '紧张刺激的高潮场景，快速剪辑感，动态镜头', aspectRatio: '2.35:1', duration: 5, cameraControl: { type: 'tracking', intensity: 70 } },
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

// 视频模型注册表（与 video-api.ts 保持同步）
const VIDEO_MODEL_REGISTRY: Record<string, VideoModelInfo> = {
  // === 国内模型 ===
  'kling-v3-video-generation': {
    id: 'kling-v3-video-generation', name: '可灵 V3', provider: 'Kuaishou', region: 'cn',
    profile: 'dashscope',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false, maxDuration: 15, durations: [5, 10, 15], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'] }
  },
  'kling-v3-omni-video-generation': {
    id: 'kling-v3-omni-video-generation', name: '可灵 V3 Omni', provider: 'Kuaishou', region: 'cn',
    profile: 'dashscope',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 30, durations: [5, 10, 15, 30], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'] }
  },
  'kling-v3-5-video-generation': {
    id: 'kling-v3-5-video-generation', name: '可灵 V3.5', provider: 'Kuaishou', region: 'cn',
    profile: 'dashscope',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 30, durations: [5, 10, 15, 30], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p','4K'] }
  },
  'doubao-seedance-3-0': {
    id: 'doubao-seedance-3-0', name: 'Seedance 3.0', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: true, maxDuration: 15, durations: [5, 10, 15], aspectRatios: ['1:1','4:3','3:4','16:9','9:16','21:9'], resolutions: ['720p','1080p','4K'] }
  },
  'doubao-seedance-3-0-fast': {
    id: 'doubao-seedance-3-0-fast', name: 'Seedance 3.0 Fast', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, cameraControl: true, motionBrush: false, characterConsistency: true, multiShot: true, maxDuration: 15, durations: [5, 10, 15], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['720p','1080p'] }
  },
  'doubao-seedance-2-3': {
    id: 'doubao-seedance-2-3', name: 'Seedance 2.3', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16','21:9'], resolutions: ['768p','1080p'] }
  },
  'doubao-seedance-2-3-fast': {
    id: 'doubao-seedance-2-3-fast', name: 'Seedance 2.3 Fast', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['768p','1080p'] }
  },
  'doubao-seedance-2-0': {
    id: 'doubao-seedance-2-0', name: 'Seedance 2.0', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16','21:9'], resolutions: ['480p','720p','1080p'] }
  },
  'doubao-seedance-2-0-fast': {
    id: 'doubao-seedance-2-0-fast', name: 'Seedance 2.0 Fast', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['480p','720p','1080p'] }
  },
  'doubao-seedance-1-0-lite': {
    id: 'doubao-seedance-1-0-lite', name: 'Seedance 1.0 Lite', provider: 'ByteDance', region: 'cn',
    profile: 'volcengine-ark',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['480p','720p'] }
  },
  'video-01': {
    id: 'video-01', name: '海螺 Video-01', provider: 'MiniMax', region: 'cn',
    profile: 'minimax',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 6, durations: [6], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['720p'] }
  },
  'hailuo-02': {
    id: 'hailuo-02', name: '海螺 Hailuo 02', provider: 'MiniMax', region: 'cn',
    profile: 'minimax',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 6, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['512p','768p','1080p'] }
  },
  'hailuo-2.3': {
    id: 'hailuo-2.3', name: '海螺 Hailuo 2.3', provider: 'MiniMax', region: 'cn',
    profile: 'minimax',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 6, 10], aspectRatios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['768p','1080p'] }
  },
  'vidu-q3': {
    id: 'vidu-q3', name: 'Vidu Q3', provider: 'ShengShu', region: 'cn',
    profile: 'vidu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 16, durations: [4, 8, 16], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p','4K'] }
  },
  'vidu-q3-pro': {
    id: 'vidu-q3-pro', name: 'Vidu Q3 Pro', provider: 'ShengShu', region: 'cn',
    profile: 'vidu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 16, durations: [4, 8, 16], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['1080p','4K'] }
  },
  'vidu-q2': {
    id: 'vidu-q2', name: 'Vidu Q2', provider: 'ShengShu', region: 'cn',
    profile: 'vidu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [4, 8], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'] }
  },
  'vidu-q1': {
    id: 'vidu-q1', name: 'Vidu Q1', provider: 'ShengShu', region: 'cn',
    profile: 'vidu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [4, 8], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'] }
  },
  // === 海外模型 ===
  'gen-3-alpha-turbo': {
    id: 'gen-3-alpha-turbo', name: 'Runway Gen-3 Turbo', provider: 'Runway', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: true, videoExtend: true, audio: false, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'gen-3-alpha': {
    id: 'gen-3-alpha', name: 'Runway Gen-3', provider: 'Runway', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: true, videoExtend: true, audio: false, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'gen-4': {
    id: 'gen-4', name: 'Runway Gen-4', provider: 'Runway', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: false, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p','4K'] }
  },
  'gen-4-turbo': {
    id: 'gen-4-turbo', name: 'Runway Gen-4 Turbo', provider: 'Runway', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: false, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p'] }
  },
  'pika-2.5': {
    id: 'pika-2.5', name: 'Pika 2.5', provider: 'Pika', region: 'global',
    profile: 'fal-video',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: false, audio: false, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1','4:5','5:4','3:2','2:3'], resolutions: ['720p','1080p'] }
  },
  'pika-2.2': {
    id: 'pika-2.2', name: 'Pika 2.2', provider: 'Pika', region: 'global',
    profile: 'fal-video',
    features: { firstLastFrame: false, multiReference: true, videoEdit: true, videoExtend: false, audio: false, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1','4:5','5:4','3:2','2:3'], resolutions: ['720p','1080p'] }
  },
  'pika-2.0': {
    id: 'pika-2.0', name: 'Pika 2.0', provider: 'Pika', region: 'global',
    profile: 'fal-video',
    features: { firstLastFrame: false, multiReference: true, videoEdit: true, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'pika-1.5': {
    id: 'pika-1.5', name: 'Pika 1.5', provider: 'Pika', region: 'global',
    profile: 'fal-video',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 5, durations: [5], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p'] }
  },
  'ray3': {
    id: 'ray3', name: 'Luma Ray3', provider: 'Luma', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, cameraControl: true, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 9, 10], aspectRatios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p'] }
  },
  'ray3.14': {
    id: 'ray3.14', name: 'Luma Ray3.14', provider: 'Luma', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, cameraControl: true, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 9, 10], aspectRatios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p'] }
  },
  'ray2': {
    id: 'ray2', name: 'Luma Ray2', provider: 'Luma', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 5, durations: [5], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'sora': {
    id: 'sora', name: 'OpenAI Sora', provider: 'OpenAI', region: 'global',
    profile: 'openai-video',
    features: { firstLastFrame: false, multiReference: false, videoEdit: true, videoExtend: true, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 20, durations: [5, 10, 15, 20], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'veo-2': {
    id: 'veo-2', name: 'Google Veo 2', provider: 'Google', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [4, 8], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'veo-3': {
    id: 'veo-3', name: 'Google Veo 3', provider: 'Google', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [4, 8], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] }
  },
  'veo-3.1': {
    id: 'veo-3.1', name: 'Google Veo 3.1', provider: 'Google', region: 'global',
    profile: 'rest-generic',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: true, cameraControl: false, motionBrush: false, characterConsistency: true, multiShot: false, maxDuration: 8, durations: [4, 8], aspectRatios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p','4K'] }
  },
};

// 摄像机控制参数
export interface CameraControlParams {
  type: 'push_in' | 'push_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'orbit_left' | 'orbit_right' | 'zoom_in' | 'zoom_out' | 'tracking' | 'static';
  intensity?: number; // 运动强度 0-100
  speed?: number; // 速度 0-100
}

// 运动笔刷参数
export interface MotionBrushParams {
  maskDataUrl: string; // 笔刷涂抹区域的蒙版 (base64 PNG)
  trajectories: MotionTrajectory[]; // 运动轨迹列表
}

export interface MotionTrajectory {
  startX: number; // 起点X (0-1 归一化)
  startY: number; // 起点Y (0-1 归一化)
  endX: number; // 终点X (0-1 归一化)
  endY: number; // 终点Y (0-1 归一化)
  speed?: number; // 运动速度 0-100
}

export interface VideoGenerateParams {
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
  // 新增高级参数
  cameraControl?: CameraControlParams;
  motionBrush?: MotionBrushParams;
  characterReferences?: string[]; // 角色参考图URL列表
  motionStrength?: number; // 运动强度 0-100
  seed?: number; // 随机种子
  negativePrompt?: string; // 反向提示词
  // 多镜头叙事
  multiShotScenes?: Array<{ id: string; prompt: string; duration: number; cameraControl?: CameraControlParams }>;
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
  const [mode, setMode] = useState<'text2video' | 'image2video-first' | 'image2video-firstlast' | 'image2video-ref' | 'video-extend' | 'multi-shot'>('text2video');
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

  // === 多镜头叙事状态 ===
  const [multiShotScenes, setMultiShotScenes] = useState<Array<{ id: string; prompt: string; duration: number; cameraControl?: CameraControlParams }>>([
    { id: '1', prompt: '', duration: 5 },
  ]);
  const [showMultiShotPanel, setShowMultiShotPanel] = useState(false);

  // === 高级功能状态 ===
  const [cameraControl, setCameraControl] = useState<CameraControlParams | null>(null);
  const [motionBrush, setMotionBrush] = useState<MotionBrushParams | null>(null);
  const [characterReferences, setCharacterReferences] = useState<string[]>([]);
  const [showCameraPanel, setShowCameraPanel] = useState(false);
  const [showCharacterPanel, setShowCharacterPanel] = useState(false);
  const [showMotionBrush, setShowMotionBrush] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [motionStrength, setMotionStrength] = useState(50);

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
            audio: false, maxDuration: 10, durations: [5, 10], aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'],
            cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false,
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
                audio: false, maxDuration: 10, aspectRatios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'],
                cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false,
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

  const handleGenerate = useCallback(async () => {
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
    if (mode === 'multi-shot' && multiShotScenes.every(s => !s.prompt.trim())) {
      onError?.('请至少输入一个镜头的描述');
      return;
    }
    if (!model) {
      onError?.('请选择视频模型');
      return;
    }

    setIsGenerating(true);

    // 提取 providerId（如果 model 是复合键）
    const pureModelId = model.includes('::') ? model.split('::').pop()! : model;
    const providerId = model.includes('::') ? model.split('::')[0] : undefined;

    // 多镜头叙事模式：合并所有镜头的提示词
    const finalPrompt = mode === 'multi-shot' 
      ? multiShotScenes.filter(s => s.prompt.trim()).map((s, i) => `[镜头${i + 1}] ${s.prompt}`).join('\n')
      : prompt.trim();

    try {
      await onVideoGenerate({
        prompt: finalPrompt,
        mode,
        model: pureModelId,
        providerId,
        aspectRatio,
        duration,
        quality,
        generateAudio,
        firstFrameUrl: (mode !== 'text2video' && mode !== 'video-extend' && mode !== 'multi-shot') ? firstFrameUrl : undefined,
        lastFrameUrl: (mode === 'image2video-firstlast') ? lastFrameUrl : undefined,
        referenceImages: (mode === 'image2video-ref') ? referenceImages : undefined,
        resolution,
        videoUrl: (mode === 'video-extend') ? videoUrl : undefined,
        extendDuration: (mode === 'video-extend') ? extendDuration : undefined,
        // 高级参数
        cameraControl: cameraControl || undefined,
        motionBrush: motionBrush || undefined,
        characterReferences: characterReferences.length > 0 ? characterReferences : undefined,
        motionStrength: cameraControl ? motionStrength : undefined,
        seed: seed || undefined,
        negativePrompt: negativePrompt.trim() || undefined,
        // 多镜头参数
        multiShotScenes: mode === 'multi-shot' ? multiShotScenes.filter(s => s.prompt.trim()) : undefined,
      });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, mode, model, aspectRatio, duration, quality, generateAudio, firstFrameUrl, lastFrameUrl, referenceImages, resolution, videoUrl, extendDuration, cameraControl, motionBrush, characterReferences, motionStrength, seed, negativePrompt, multiShotScenes, onVideoGenerate, onError]);

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
  const labelClass = isMonochrome ? 'text-xs text-gray-500' : 'text-xs text-gray-500';
  const sectionTitleClass = isMonochrome ? 'text-xs font-semibold text-blue-500 whitespace-nowrap truncate' : 'text-xs font-semibold text-gray-300 whitespace-nowrap truncate';
  const subtleTextClass = isMonochrome ? 'text-gray-400' : 'text-gray-500';
  const subtleBorderClass = isMonochrome ? 'border-gray-200' : 'border-gray-600';
  const deepBorderClass = isMonochrome ? 'border-gray-200' : 'border-gray-700';
  // Monochrome-specific bg classes (matching chat-panel)
  const cardBgClass = isMonochrome ? 'bg-gray-50/50' : '';
  const sectionBgClass = isMonochrome ? 'bg-gray-50' : '';

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: panelBg, color: textColor }}>
      {/* === 模式切换 === */}
      <div className={`flex gap-1 p-3 pb-1 flex-nowrap ${isMonochrome ? 'bg-gray-100 rounded-lg mx-3 mt-3 p-1.5' : ''}`}>
        {modeOptions.map(opt => (
          <button
            key={opt.value}
            onClick={() => setMode(opt.value)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              isMonochrome
                ? mode === opt.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
                : ''
            }`}
            style={isMonochrome ? {} : {
              background: mode === opt.value ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(59,130,246,0.15)') : 'transparent',
              color: mode === opt.value ? accentColor : subTextColor,
              border: `1px solid ${mode === opt.value ? borderColor : 'transparent'}`,
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>

      {/* === 视频模板库 === */}
      <div className="px-3 pt-2">
        <label className={labelClass}>快速模板</label>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {VIDEO_TEMPLATES.map(template => (
            <button
              key={template.id}
              onClick={() => {
                setPrompt(template.prompt);
                if (template.aspectRatio) setAspectRatio(template.aspectRatio);
                if (template.duration) setDuration(template.duration);
                if (template.cameraControl) setCameraControl(template.cameraControl);
              }}
              className={`flex-shrink-0 px-2.5 py-1.5 rounded-md text-[10px] border transition-all cursor-pointer ${
                isMonochrome
                  ? 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                  : hoverBorderColor
              }`}
              style={isMonochrome ? {} : {
                background: inputBg,
                borderColor: borderColor,
                color: '#9ca3af',
              }}
              title={template.prompt}
            >
              {template.name}
            </button>
          ))}
        </div>
      </div>

      {/* === 视频模型选择 === */}
      <div className="px-3 pt-2">
        <label className="text-xs text-gray-500 mb-1 block">视频模型</label>
        <div className="relative">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full px-3 py-2 rounded-md text-sm appearance-none cursor-pointer"
            style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
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
          style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}`, outline: 'none' }}
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
                    style={{ background: isGold ? 'rgba(212,175,55,0.1)' : isMonochrome ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.1)', border: `1px solid ${borderColor}`, color: accentColor }}
                  >
                    <FastForward className="w-3.5 h-3.5" />
                    使用画布选中的视频
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="输入视频URL..."
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-md text-xs"
                    style={{ background: inputBg, color: textColor, border: `1px solid ${borderColor}`, outline: 'none' }}
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
                    background: extendDuration === d ? (isGold ? 'rgba(212,175,55,0.15)' : isMonochrome ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.15)') : inputBg,
                    color: extendDuration === d ? accentColor : subTextColor,
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
          <div className="flex items-start gap-1.5 p-2 rounded-md" style={{ background: isGold ? 'rgba(212,175,55,0.05)' : 'rgba(59,130,246,0.05)', border: `1px solid ${isGold ? 'rgba(212,175,55,0.1)' : 'rgba(59,130,246,0.1)'}` }}>
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: accentColor }} />
            <span className="text-xs text-gray-500">视频延长将在源视频末尾追加新内容，保持画面连贯性。可在描述中指定延长内容的方向。</span>
          </div>
        </div>
      )}

      {/* === 画面比例 === */}
      <div className="px-3 pt-3">
        <label className={labelClass}>画面比例</label>
        <div className="flex flex-wrap gap-1.5">
          {availableRatios.map(r => (
            <button
              key={r}
              onClick={() => setAspectRatio(r)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer border ${
                isMonochrome
                  ? aspectRatio === r
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm shadow-blue-200'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                  : ''
              }`}
              style={isMonochrome ? {} : {
                background: aspectRatio === r ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(59,130,246,0.15)') : inputBg,
                color: aspectRatio === r ? accentColor : subTextColor,
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
        <label className={labelClass}>视频时长</label>
        <div className="flex gap-1.5">
          {availableDurations.map(d => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer border ${
                isMonochrome
                  ? duration === d
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm shadow-blue-200'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                  : ''
              }`}
              style={isMonochrome ? {} : {
                background: duration === d ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(59,130,246,0.15)') : inputBg,
                color: duration === d ? accentColor : subTextColor,
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
        <label className={labelClass}>生成质量</label>
        <div className="flex gap-1.5">
          {(['std', 'pro'] as const).map(q => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer border ${
                isMonochrome
                  ? quality === q
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm shadow-blue-200'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                  : ''
              }`}
              style={isMonochrome ? {} : {
                background: quality === q ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(59,130,246,0.15)') : inputBg,
                color: quality === q ? accentColor : subTextColor,
                border: `1px solid ${quality === q ? borderColor : 'transparent'}`,
              }}
            >
              {q === 'std' ? '标准' : '高品质'}
            </button>
          ))}
        </div>
      </div>

      {/* === 音效开关 === */}
      {(
        <div className="px-3 pt-3">
          <button
            onClick={() => setGenerateAudio(!generateAudio)}
            className="flex items-center gap-2 text-xs cursor-pointer"
            style={{ color: generateAudio ? accentColor : subTextColor }}
          >
            {generateAudio ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            {generateAudio ? '生成音效（已开启）' : '生成音效（已关闭）'}
          </button>
        </div>
      )}

      {/* === 摄像机控制 === */}
      {mode !== 'video-extend' && (
        <div className="px-3 pt-3 pb-2">
          <button
            onClick={() => setShowCameraPanel(!showCameraPanel)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md border transition-colors ${
              showCameraPanel ? borderActiveClass : `${borderInactiveClass} ${hoverBorderColorLight}`
            }`}
            style={{ background: inputBg }}
          >
            <span className="flex items-center gap-2 text-xs min-w-0 overflow-hidden shrink">
              <Video className="w-4 h-4 shrink-0" style={{ color: cameraControl ? accentColor : subTextColor }} />
              <span className={sectionTitleClass}>摄像机控制</span>
              {cameraControl && <span className="text-[10px] opacity-60">({cameraControl.type.replace('_', ' ')})</span>}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showCameraPanel ? 'rotate-180' : ''}`} />
          </button>
          {showCameraPanel && (
            <div className="mt-2 p-2 rounded-md space-y-2" style={{ background: inputBg }}>
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
                ].map(cam => (
                  <button
                    key={cam.type}
                    onClick={() => setCameraControl(cameraControl?.type === cam.type ? null : { type: cam.type as CameraControlParams['type'], intensity: 50 })}
                    className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded text-[10px] transition-all cursor-pointer border ${
                      isMonochrome
                        ? cameraControl?.type === cam.type
                          ? 'bg-blue-500 text-white border-blue-500 shadow-sm shadow-blue-200'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                        : ''
                    }`}
                    style={isMonochrome ? {} : {
                      background: cameraControl?.type === cam.type ? (isGold ? 'rgba(212,175,55,0.2)' : 'rgba(59,130,246,0.2)') : '#2a2a2a',
                      color: cameraControl?.type === cam.type ? accentColor : subTextColor,
                      border: `1px solid ${cameraControl?.type === cam.type ? borderColor : 'transparent'}`,
                    }}
                  >
                    <span className="text-sm">{cam.icon}</span>
                    <span>{cam.label}</span>
                  </button>
                ))}
              </div>
              {cameraControl && cameraControl.type !== 'static' && (
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500">运动强度: {motionStrength}%</label>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={motionStrength}
                    onChange={(e) => setMotionStrength(Number(e.target.value))}
                    className="w-full h-1 rounded-lg appearance-none cursor-pointer"
                    style={{ background: `linear-gradient(to right, ${accentColor} ${motionStrength}%, ${isMonochrome ? '#ddd' : '#333'} ${motionStrength}%)` }}
                  />
                </div>
              )}
              {cameraControl && (
                <button
                  onClick={() => { setCameraControl(null); setShowCameraPanel(false); }}
                  className={`text-[10px] ${subtleTextClass} ${isMonochrome ? 'hover:text-gray-600' : 'hover:text-gray-300'} cursor-pointer`}
                >
                  清除摄像机控制
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* === 角色一致性 === */}
      {mode !== 'video-extend' && (
        <div className="px-3 pt-3 pb-2">
          <button
            onClick={() => setShowCharacterPanel(!showCharacterPanel)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md border transition-colors ${
              showCharacterPanel ? borderActiveClass : `${borderInactiveClass} ${hoverBorderColorLight}`
            }`}
            style={{ background: inputBg }}
          >
            <span className="flex items-center gap-2 text-xs min-w-0 overflow-hidden shrink">
              <Users className="w-4 h-4 shrink-0" style={{ color: characterReferences.length > 0 ? accentColor : subTextColor }} />
              <span className={sectionTitleClass}>角色一致性</span>
              {characterReferences.length > 0 && <span className="text-[10px] opacity-60">({characterReferences.length}张参考图)</span>}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showCharacterPanel ? 'rotate-180' : ''}`} />
          </button>
          {showCharacterPanel && (
            <div className="mt-2 p-2 rounded-md space-y-2" style={{ background: inputBg }}>
              <p className="text-[10px] text-gray-500">上传角色参考图，AI将保持角色外观一致性</p>
              <div className="flex flex-wrap gap-2">
                {characterReferences.map((url, idx) => (
                  <div key={idx} className="relative w-16 h-16 rounded overflow-hidden group">
                    <img src={url} alt={`角色${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => setCharacterReferences(characterReferences.filter((_, i) => i !== idx))}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {characterReferences.length < 5 && (
                  <button
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const dataUrl = ev.target?.result as string;
                          setCharacterReferences([...characterReferences, dataUrl]);
                        };
                        reader.readAsDataURL(file);
                      };
                      input.click();
                    }}
                    className="w-16 h-16 rounded border border-dashed flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-gray-500 transition-colors"
                    style={{ borderColor: borderColor }}
                  >
                    <Plus className="w-4 h-4" style={{ color: accentColor }} />
                    <span className="text-[9px] text-gray-500">添加</span>
                  </button>
                )}
              </div>
              {characterReferences.length > 0 && (
                <button
                  onClick={() => { setCharacterReferences([]); setShowCharacterPanel(false); }}
                  className={`text-[10px] ${subtleTextClass} ${isMonochrome ? 'hover:text-gray-600' : 'hover:text-gray-300'} cursor-pointer`}
                >
                  清除角色参考
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* === 运动笔刷 === */}
      {mode === 'image2video-first' && firstFrameUrl && (
        <div className="px-3 pt-3 pb-2">
          <button
            onClick={() => setShowMotionBrush(!showMotionBrush)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md border transition-colors ${
              showMotionBrush ? borderActiveClass : `${borderInactiveClass} ${hoverBorderColorLight}`
            }`}
            style={{ background: inputBg }}
          >
            <span className="flex items-center gap-2 text-xs min-w-0 overflow-hidden shrink">
              <Paintbrush className="w-4 h-4 shrink-0" style={{ color: motionBrush ? accentColor : subTextColor }} />
              <span className={sectionTitleClass}>运动笔刷</span>
              {motionBrush && (
                <span className="text-[10px] opacity-60">
                  ({motionBrush.trajectories.length} 轨迹)
                </span>
              )}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showMotionBrush ? 'rotate-180' : ''}`} />
          </button>
          
          {showMotionBrush && (
            <div className="mt-2 p-3 rounded-md border" style={{ background: inputBg, borderColor }}>
              <div className="flex items-center gap-2 mb-2">
                <Paintbrush className={`w-4 h-4 ${accentTextClass}`} />
                <span className={`text-xs ${sectionTitleClass}`}>在图片上涂抹区域并绘制运动轨迹</span>
              </div>
              
              <MotionBrushCanvas
                ref={motionBrushRef}
                imageUrl={firstFrameUrl}
                onExport={handleMotionBrushExport}
                onClose={() => setShowMotionBrush(false)}
              />
              
              {motionBrush && motionBrush.trajectories.length > 0 && (
                <div className="mt-2 space-y-2">
                  <div className="text-[10px] text-gray-500">
                    已绘制 {motionBrush.trajectories.length} 条运动轨迹
                  </div>
                  <button
                    onClick={() => {
                      setMotionBrush(null);
                      setShowMotionBrush(false);
                    }}
                    className={`w-full py-1.5 rounded-md border ${subtleBorderClass} text-[11px] text-gray-400 hover:border-red-500/50 hover:text-red-400 transition-colors`}
                  >
                    清除运动笔刷
                  </button>
                </div>
              )}
              
              <div className="mt-2 text-[10px] text-gray-500 space-y-0.5">
                <div>• 左键涂抹：标记运动区域</div>
                <div>• 右键绘制：定义运动方向</div>
                <div>• 滚轮调整：画笔大小</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* === 多镜头叙事 === */}
      {mode === 'multi-shot' && (
        <div className="px-3 pt-2">
          <div className={`p-3 rounded-md border ${deepBorderClass}`} style={{ background: inputBg }}>
            <div className="flex items-center gap-2 mb-3">
              <Film className="w-4 h-4 text-purple-400" />
              <span className={`text-xs ${sectionTitleClass}`}>多镜头叙事</span>
              <span className="text-[10px] text-gray-500">({multiShotScenes.length} 个镜头)</span>
            </div>
            
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {multiShotScenes.map((scene, index) => (
                <div key={scene.id} className={`p-2 rounded-md border ${subtleBorderClass}`} style={{ background: panelBg }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-purple-400">镜头 {index + 1}</span>
                    {multiShotScenes.length > 1 && (
                      <button
                        onClick={() => setMultiShotScenes(multiShotScenes.filter(s => s.id !== scene.id))}
                        className="text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <textarea
                    value={scene.prompt}
                    onChange={(e) => {
                      const newScenes = [...multiShotScenes];
                      const idx = newScenes.findIndex(s => s.id === scene.id);
                      if (idx >= 0) newScenes[idx] = { ...newScenes[idx], prompt: e.target.value };
                      setMultiShotScenes(newScenes);
                    }}
                    placeholder={`描述镜头 ${index + 1} 的画面内容...`}
                    className={`w-full px-2 py-1.5 rounded text-xs border resize-none h-16 ${
                      isMonochrome
                        ? 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                        : ''
                    }`}
                    style={isMonochrome ? {} : {
                      background: panelBg,
                      borderColor: '#374151',
                      color: '#e5e7eb',
                    }}
                  />
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-gray-500">时长:</span>
                    <select
                      value={scene.duration}
                      onChange={(e) => {
                        const newScenes = [...multiShotScenes];
                        const idx = newScenes.findIndex(s => s.id === scene.id);
                        if (idx >= 0) newScenes[idx] = { ...newScenes[idx], duration: Number(e.target.value) };
                        setMultiShotScenes(newScenes);
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] border ${
                        isMonochrome
                          ? 'bg-white border-gray-200 text-gray-700'
                          : ''
                      }`}
                      style={isMonochrome ? {} : { background: panelBg, borderColor: '#374151', color: '#e5e7eb' }}
                    >
                      <option value={3}>3s</option>
                      <option value={5}>5s</option>
                      <option value={8}>8s</option>
                      <option value={10}>10s</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
            
            <button
              onClick={() => {
                setMultiShotScenes([
                  ...multiShotScenes,
                  { id: Date.now().toString(), prompt: '', duration: 5 },
                ]);
              }}
              className={`w-full mt-2 py-1.5 rounded-md border border-dashed ${subtleBorderClass} text-[11px] text-gray-400 hover:border-purple-500/50 hover:text-purple-400 transition-colors flex items-center justify-center gap-1`}
            >
              <Plus className="w-3 h-3" />
              添加镜头
            </button>
            
            <div className="mt-2 text-[10px] text-gray-500">
              总时长: {multiShotScenes.reduce((sum, s) => sum + s.duration, 0)}s
            </div>
          </div>
        </div>
      )}

      {/* === 高级设置 === */}
      <div className="px-3 pt-3">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`flex items-center gap-1.5 text-xs ${subtleTextClass} ${isMonochrome ? 'hover:text-gray-600' : 'hover:text-gray-300'} transition-colors cursor-pointer`}
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
                    className={`px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer border ${
                      isMonochrome
                        ? resolution === r
                          ? 'bg-blue-500 text-white border-blue-500 shadow-sm shadow-blue-200'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                        : ''
                    }`}
                    style={isMonochrome ? {} : {
                      background: resolution === r ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(59,130,246,0.15)') : '#2a2a2a',
                      color: resolution === r ? accentColor : subTextColor,
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
          <div className="flex items-start gap-1.5 p-2 rounded-md" style={{ background: isGold ? 'rgba(212,175,55,0.05)' : isMonochrome ? 'rgba(107,114,128,0.05)' : 'rgba(59,130,246,0.05)', border: `1px solid ${isGold ? 'rgba(212,175,55,0.1)' : isMonochrome ? 'rgba(107,114,128,0.15)' : 'rgba(59,130,246,0.1)'}` }}>
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: accentColor }} />
            <div className="text-xs text-gray-500 leading-relaxed">
              <span style={{ color: accentColor }}>{currentModel.name}</span>
              {' · '}支持
              {currentFeatures?.firstLastFrame && ' 首尾帧'}
              {currentFeatures?.multiReference && ' 多参考图'}
              {currentFeatures?.videoEdit && ' 视频编辑'}
              {currentFeatures?.videoExtend && ' 延长'}
              {currentFeatures?.audio && ' 音效'}
              {' 摄像机控制'}
              {' 运动笔刷'}
              {' 角色一致性'}
              {' 多镜头叙事'}
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
              : (isGenerating ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #3b82f6, #2563eb)'),
            color: '#fff',
            boxShadow: isGenerating ? 'none' : `0 2px 8px ${isGold ? 'rgba(212,175,55,0.3)' : 'rgba(59,130,246,0.3)'}`,
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
