'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  Play, Video, ImagePlus, Clock, Settings2,
  ChevronDown, Loader2, Sparkles, Volume2, VolumeX,
  Upload, X, AlertCircle, Info, FastForward, Users, Plus, Paintbrush, Film, Palette,
  History, RotateCcw, Languages, GripVertical, Minus, Maximize2, ChevronRight, CheckCircle2
} from 'lucide-react';
import MotionBrushCanvas, { type MotionBrushResult, type MotionBrushCanvasHandle } from './motion-brush-canvas';
import { inferVideoModelFeatures } from '@/lib/video-api';

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

// === 参考图类型定义 ===
export type ReferenceType = 'character-front' | 'character-side' | 'style' | 'scene' | 'first-frame' | 'last-frame';

export interface TypedReference {
  id: string;
  url: string;
  type: ReferenceType;
  label?: string;
}

export const REFERENCE_TYPE_CONFIG: Record<ReferenceType, { label: string; icon: string; color: string; description: string }> = {
  'character-front': { label: '角色正面', icon: 'User', color: '#f59e0b', description: '角色正面照，用于保持人物外貌一致' },
  'character-side': { label: '角色侧面', icon: 'RotateCcw', color: '#f97316', description: '角色侧面/背面照，多角度约束' },
  'style': { label: '风格参考', icon: 'Palette', color: '#a855f7', description: '画面风格、色调、艺术风格参考' },
  'scene': { label: '场景参考', icon: 'Mountain', color: '#22c55e', description: '背景环境、场景氛围参考' },
  'first-frame': { label: '首帧', icon: 'Play', color: '#3b82f6', description: '视频起始画面' },
  'last-frame': { label: '尾帧', icon: 'Square', color: '#ef4444', description: '视频结束画面' },
};

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
  mode: 'text2video' | 'image2video-first' | 'image2video-ref' | 'video-extend' | 'multi-shot';
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
  chainContinuity?: boolean; // 链式连贯：前一段末帧→下一段首帧
  useGlobalReferences?: boolean; // 全局参考图注入到所有片段
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
  const [mode, setMode] = useState<'text2video' | 'image2video-first' | 'image2video-ref' | 'video-extend' | 'multi-shot'>('text2video');
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
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; panelX: number; panelY: number } | null>(null);

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
        const registry = VIDEO_MODEL_REGISTRY[sm.id];
        return {
          id: sm.id,
          name: sm.name || registry?.name || sm.id,
          providerId: sm.providerId,
          providerName: sm.providerName || registry?.provider || '',
          region: registry?.region || 'cn' as const,
          features: registry?.features || inferFallbackFeatures(sm.id),
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
              features: registry?.features || inferFallbackFeatures(sm.id),
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

  // 首尾帧开关（图生视频模式内可展开尾帧）
  const [showLastFrame, setShowLastFrame] = useState(false);

  // 画布选中图片自动设为首帧
  useEffect(() => {
    if (selectedImageUrl && mode === 'image2video-first') {
      setFirstFrame(selectedImageUrl);
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

    // 多镜头叙事模式：合并所有镜头的提示词
    const finalPrompt = mode === 'multi-shot' 
      ? multiShotScenes.filter(s => s.prompt.trim()).map((s, i) => `[镜头${i + 1}] ${s.prompt}`).join('\n')
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
        multiShotScenes: mode === 'multi-shot' ? multiShotScenes.filter(s => s.prompt.trim()) : undefined,
        chainContinuity: mode === 'multi-shot' ? chainContinuity : undefined,
        useGlobalReferences: mode === 'multi-shot' && useGlobalReferences ? true : undefined,
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
  const labelClass = isMonochrome ? 'text-xs text-gray-500' : 'text-xs text-gray-500';
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
    left: panelPosition.x || undefined,
    top: panelPosition.y || undefined,
    right: panelPosition.x ? undefined : 24,
    bottom: panelPosition.y ? undefined : 96,
    maxHeight: '78vh',
  } : {};

  return (
    <div ref={panelRef} className={floatingWrapperClass} style={{ background: !floating ? panelBg : undefined, color: textColor, ...floatingStyle } as React.CSSProperties} data-floating-panel="video">
      {/* 浮动模式下显示完整标题栏 + 拖拽手柄 */}
      {floating && (
        <div
          className={`flex items-center justify-between px-3 py-2.5 flex-shrink-0 cursor-move select-none border-r ${
            isMonochrome ? 'border-gray-200 bg-gray-50' : 'border-white/[0.06] bg-black/20'
          }`}
          onMouseDown={handleDragStart}
          style={{ width: panelMinimized ? 'auto' : 56 }}
        >
          <div className="flex flex-col items-center gap-1.5 w-full">
            <GripVertical className={`w-4 h-4 flex-shrink-0 ${isMonochrome ? 'text-gray-400' : 'text-gray-500'}`} />
            <Film className="w-5 h-5 flex-shrink-0" style={{ color: accentColor }} />
            {!panelMinimized && (
              <span className="text-xs font-medium writing-vertical" style={{ writingMode: 'vertical-rl', letterSpacing: '0.1em' }}>视频生成</span>
            )}
          </div>
        </div>
      )}
      {/* 内容区域 */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* 浮动模式工具栏 */}
      {floating && (
        <div className={`flex items-center justify-between px-3 py-2 flex-shrink-0 border-b ${
          isMonochrome ? 'border-gray-200' : 'border-white/[0.06]'
        }`}>
          <div className="flex items-center gap-2">
            {panelMinimized && <Film className="w-4 h-4" style={{ color: accentColor }} />}
            <span className={`font-semibold ${panelMinimized ? 'text-sm' : 'text-base'}`}>视频生成</span>
          </div>
          <div className="flex items-center gap-1">
            {isGenerating && (
              <button
                onClick={() => setPanelMinimized(!panelMinimized)}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  isMonochrome ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-white/10 text-gray-400'
                }`}
                title={panelMinimized ? '展开面板' : '最小化'}
              >
                {panelMinimized ? <Maximize2 className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
              </button>
            )}
            {!isGenerating && (
              <button
                onClick={() => setPanelMinimized(!panelMinimized)}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  isMonochrome ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-white/10 text-gray-400'
                }`}
                title={panelMinimized ? '展开面板' : '最小化'}
              >
                {panelMinimized ? <Maximize2 className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={onClose}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                isMonochrome ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-white/10 text-gray-400'
              }`}
              title="关闭面板"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {/* 非浮动模式下的工具栏 */}
      {!floating && (
      <div className="flex items-center justify-end px-3 pt-2 pb-1 flex-shrink-0">
        <button
          onClick={() => setPanelMinimized(true)}
          className="p-1.5 rounded-md transition-colors cursor-pointer hover:opacity-70"
          style={{ color: subTextColor }}
          title="最小化面板"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>
      )}
      <div className={`flex-1 overflow-y-auto ${floating ? '' : 'scroll-smooth'}`} style={floating ? {} : { scrollbarWidth: 'thin', scrollbarColor: isMonochrome ? '#d1d5db transparent' : '#444 transparent' }}>
      {/* 最小化时显示紧凑进度条 */}
      {panelMinimized && isGenerating ? (
        <div className="p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: accentColor }} />
              <span className="text-sm font-medium">{genStage}</span>
            </div>
            {floating ? (
              <button
                onClick={() => setPanelMinimized(false)}
                className="p-1.5 rounded-md transition-colors cursor-pointer hover:opacity-70"
                style={{ color: subTextColor }}
                title="展开面板"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => setPanelMinimized(false)}
                className="p-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                title="展开面板"
              >
                <Maximize2 className="w-4 h-4" style={{ color: subTextColor }} />
              </button>
            )}
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: isMonochrome ? '#e5e7eb' : '#333' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${genProgress}%`,
                background: isGold ? 'linear-gradient(90deg, #d4af37, #f0d060)' : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              }}
            />
          </div>
          <p className="text-xs" style={{ color: subTextColor }}>视频生成中，你可以继续使用画布...</p>
        </div>
      ) : panelMinimized ? (
        <button
          onClick={() => setPanelMinimized(false)}
          className="m-3 p-2.5 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-all cursor-pointer hover:opacity-80"
          style={{
            background: isGold ? 'rgba(212,175,55,0.1)' : 'rgba(59,130,246,0.1)',
            border: `1px solid ${isGold ? 'rgba(212,175,55,0.3)' : 'rgba(59,130,246,0.3)'}`,
            color: accentColor,
          }}
        >
          <Maximize2 className="w-4 h-4" />
          展开视频生成面板
        </button>
      ) : (
      <>
      {/* 顶部工具栏 - 仅保留最小化按钮，标题由外部Tab显示 */}
      <div className="flex items-center justify-end px-3 pt-2 pb-1">
        <button
          onClick={() => setPanelMinimized(true)}
          className="p-1.5 rounded-md transition-colors cursor-pointer hover:opacity-70"
          style={{ color: subTextColor }}
          title="最小化面板"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {/* === 模式切换 === */}
      <div className={`flex gap-1 px-3 pb-1 flex-nowrap ${isMonochrome ? 'bg-gray-100 rounded-lg mx-3 mt-1 p-1.5' : ''}`}>
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
        <label className={labelClass}>风格预设</label>
        {/* 分类标签 */}
        <div className="flex gap-1 mb-1.5 overflow-x-auto">
          {(['all', 'product', 'character', 'landscape', 'effect', 'story'] as const).map(cat => (
            <button
              key={cat}
              onClick={() => {
                const el = document.querySelector(`[data-template-cat="${cat}"]`);
                if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
                else setTemplateFilter(cat);
              }}
              className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] transition-all cursor-pointer`}
              style={{
                background: templateFilter === cat ? (isGold ? 'rgba(212,175,55,0.15)' : 'rgba(59,130,246,0.15)') : 'transparent',
                color: templateFilter === cat ? accentColor : subTextColor,
                border: `1px solid ${templateFilter === cat ? borderColor : 'transparent'}`,
              }}
            >
              {cat === 'all' ? '全部' : cat === 'product' ? '产品' : cat === 'character' ? '人物' : cat === 'landscape' ? '风景' : cat === 'effect' ? '特效' : '故事'}
            </button>
          ))}
        </div>
        {/* 模板网格 */}
        <div className="grid grid-cols-2 gap-1.5 max-h-[160px] overflow-y-auto">
          {VIDEO_TEMPLATES
            .filter(t => templateFilter === 'all' || t.category === templateFilter)
            .map(template => (
            <button
              key={template.id}
              onClick={() => {
                setPrompt(template.prompt);
                if (template.aspectRatio) setAspectRatio(template.aspectRatio);
                if (template.duration) setDuration(template.duration);
                if (template.cameraControl) setCameraControl(template.cameraControl);
              }}
              className={`text-left px-2.5 py-1.5 rounded-md text-[10px] border transition-all cursor-pointer hover:border-opacity-60 ${
                isMonochrome
                  ? 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                  : ''
              }`}
              style={isMonochrome ? {} : {
                background: inputBg,
                borderColor: borderColor,
                color: '#9ca3af',
              }}
              title={template.prompt}
            >
              <div className="font-medium truncate" style={{ color: subTextColor }}>{template.name}</div>
              <div className="truncate opacity-60 mt-0.5" style={{ fontSize: '9px' }}>{template.aspectRatio} · {template.duration}s</div>
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
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500">视频描述</label>
          <div className="flex gap-1">
            <button
              onClick={handleEnhancePrompt}
              disabled={!prompt.trim() || isEnhancing}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-all disabled:opacity-30"
              style={{
                background: isGold ? 'rgba(212,175,55,0.1)' : 'rgba(59,130,246,0.1)',
                color: accentColor,
                border: `1px solid ${isGold ? 'rgba(212,175,55,0.2)' : 'rgba(59,130,246,0.2)'}`,
              }}
              title="AI增强提示词，添加细节描述"
            >
              {isEnhancing ? (
                <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Sparkles className="w-2.5 h-2.5" />
              )}
              增强
            </button>
            <button
              onClick={handleTranslatePrompt}
              disabled={!prompt.trim() || isTranslating}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-all disabled:opacity-30"
              style={{
                background: isGold ? 'rgba(212,175,55,0.1)' : 'rgba(59,130,246,0.1)',
                color: accentColor,
                border: `1px solid ${isGold ? 'rgba(212,175,55,0.2)' : 'rgba(59,130,246,0.2)'}`,
              }}
              title="中英互译，视频模型对英文提示词效果更好"
            >
              {isTranslating ? (
                <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Languages className="w-2.5 h-2.5" />
              )}
              翻译
            </button>
          </div>
        </div>
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
        {/* 快捷场景预设 */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[
            { label: '产品展示', text: '产品360度旋转展示，柔和光影，商业广告质感' },
            { label: '人物行走', text: '人物自然行走，镜头跟随，电影感运镜' },
            { label: '风景推镜', text: '壮丽自然风光，镜头缓慢推进，云雾流动' },
            { label: '慢动作', text: '水滴飞溅慢动作，极致细节，高速摄影质感' },
            { label: '夜景霓虹', text: '赛博朋克城市夜景，霓虹灯光，雨后湿润路面反光' },
          ].map(preset => (
            <button
              key={preset.label}
              onClick={() => setPrompt(preset.text)}
              className="px-2 py-0.5 rounded text-[10px] transition-colors hover:opacity-80"
              style={{
                background: isGold ? 'rgba(212,175,55,0.08)' : 'rgba(59,130,246,0.08)',
                color: accentColor,
                border: `1px solid ${isGold ? 'rgba(212,175,55,0.2)' : 'rgba(59,130,246,0.2)'}`,
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="text-[9px] mt-1" style={{ color: subTextColor }}>
          提示：英文提示词通常效果更好，可点击"翻译"自动转换
        </div>
      </div>

      {/* === 图生视频：首帧 + 尾帧 + 分类参考图 === */}
      {mode !== 'text2video' && mode !== 'video-extend' && mode !== 'multi-shot' && (
        <div className="px-3 pt-3 space-y-3">
          {/* 首帧 - 大尺寸预览 */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block flex items-center gap-1.5">
              <ImagePlus className="w-3.5 h-3.5" style={{ color: accentColor }} />
              首帧（起始画面）
            </label>
            {firstFrameUrl ? (
              <div className="relative group aspect-video rounded-lg overflow-hidden" style={{ border: `2px solid ${accentColor}30` }}>
                <img src={firstFrameUrl} alt="首帧" className="w-full h-full object-cover" />
                <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
                  <span className="text-[10px] text-white/80">第 1 帧 · 起始</span>
                </div>
                <button
                  onClick={() => setFirstFrame('')}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <X className="w-3.5 h-3.5 text-white" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleImageUpload('first')}
                className="w-full aspect-video rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors hover:opacity-80"
                style={{ background: inputBg, border: `2px dashed ${borderColor}` }}
              >
                {selectedImageUrl ? (
                  <div className="relative w-full h-full">
                    <img src={selectedImageUrl} alt="画布图片" className="w-full h-full object-cover rounded-lg opacity-50" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <Upload className="w-7 h-7 text-white drop-shadow-lg" />
                      <span className="text-sm text-white drop-shadow-lg mt-1">使用画布图片或上传新图</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-gray-400" />
                    <span className="text-sm text-gray-400">上传首帧图片</span>
                    <span className="text-[10px] text-gray-500">AI 将从此画面开始生成视频</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* 尾帧开关 + 预览 */}
          {currentFeatures?.firstLastFrame && (
            <div>
              <button
                onClick={() => {
                  const next = !showLastFrame;
                  setShowLastFrame(next);
                  if (!next) setLastFrame('');
                }}
                className="flex items-center gap-2 text-xs cursor-pointer group/switch"
                style={{ color: showLastFrame ? accentColor : textColor }}
              >
                <div className="w-8 h-4 rounded-full relative transition-colors" style={{ background: showLastFrame ? accentColor : 'rgba(255,255,255,0.15)' }}>
                  <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow-sm" style={{ left: showLastFrame ? '17px' : '2px' }} />
                </div>
                <span className="group-hover/switch:underline">添加尾帧（结束画面）</span>
              </button>

              {showLastFrame && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex-1 h-px" style={{ background: `${accentColor}30` }} />
                    <div className="flex items-center gap-1 shrink-0" style={{ color: accentColor }}>
                      <FastForward className="w-3.5 h-3.5" />
                      <span className="text-[10px]">AI 生成过渡动画</span>
                    </div>
                    <div className="flex-1 h-px" style={{ background: `${accentColor}30` }} />
                  </div>
                  {lastFrameUrl ? (
                    <div className="relative group aspect-video rounded-lg overflow-hidden" style={{ border: `2px solid ${accentColor}30` }}>
                      <img src={lastFrameUrl} alt="尾帧" className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
                        <span className="text-[10px] text-white/80">最终帧 · 结束</span>
                      </div>
                      <button
                        onClick={() => setLastFrame('')}
                        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5 text-white" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleImageUpload('last')}
                      className="w-full aspect-video rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors hover:opacity-80"
                      style={{ background: inputBg, border: `2px dashed ${borderColor}` }}
                    >
                      <Upload className="w-7 h-7 text-gray-400" />
                      <span className="text-sm text-gray-400">上传尾帧图片</span>
                      <span className="text-[10px] text-gray-500">视频将从首帧过渡到此画面</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* === 分类参考图区域 === */}
          <div style={{ borderTop: `1px solid ${borderColor}` }} className="pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5" style={{ color: accentColor }} />
                参考图约束
              </label>
              {typedReferences.length > 0 && (
                <span className="text-[10px] text-gray-500">{typedReferences.length}/7</span>
              )}
            </div>

            {/* 已添加的参考图列表 */}
            {typedReferences.length > 0 && (
              <div className="space-y-2 mb-2">
                {typedReferences.map((ref) => (
                  <div key={ref.id} className="flex items-center gap-2 rounded-lg p-1.5 group" style={{ background: inputBg }}>
                    <img src={ref.url} alt={ref.type} className="w-14 h-10 object-cover rounded shrink-0" />
                    <div className="flex-1 min-w-0">
                      {/* 类型选择器 */}
                      <div className="flex items-center gap-1 flex-wrap">
                        {Object.entries(REFERENCE_TYPE_CONFIG)
                          .filter(([key]) => key !== 'first-frame' && key !== 'last-frame')
                          .map(([key, cfg]) => (
                          <button
                            key={key}
                            onClick={() => updateRefType(ref.id, key as ReferenceType)}
                            className="text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer transition-colors"
                            style={{
                              background: ref.type === key ? `${cfg.color}30` : 'transparent',
                              color: ref.type === key ? cfg.color : textColor,
                              border: `1px solid ${ref.type === key ? cfg.color : borderColor}`
                            }}
                          >
                            {cfg.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => removeTypedReference(ref.id)}
                      className="w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                      style={{ background: 'rgba(255,255,255,0.1)' }}
                    >
                      <X className="w-3 h-3" style={{ color: textColor }} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 添加参考图按钮 */}
            {typedReferences.length < 7 && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleImageUpload('ref')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg cursor-pointer transition-colors hover:opacity-80 text-xs"
                  style={{ background: inputBg, border: `1px dashed ${borderColor}`, color: textColor }}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>上传参考图</span>
                </button>
                {selectedImageUrl && (
                  <button
                    onClick={() => {
                      addTypedReference(selectedImageUrl, 'character-front');
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg cursor-pointer transition-colors hover:opacity-80 text-xs"
                    style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}30`, color: accentColor }}
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>从画布选取</span>
                  </button>
                )}
              </div>
            )}

            {/* 参考图类型说明 */}
            {typedReferences.length === 0 && (
              <p className="text-[10px] text-gray-500 mt-1.5 flex items-start gap-1">
                <Info className="w-3 h-3 shrink-0 mt-0.5" />
                添加角色/风格/场景参考图，帮助AI更好理解你的意图
              </p>
            )}
          </div>
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
              {characterReferences.length > 0 && <span className="text-[10px] opacity-60">({characterReferences.length}张)</span>}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showCharacterPanel ? 'rotate-180' : ''}`} />
          </button>
          {showCharacterPanel && (
            <div className="mt-2 p-2 rounded-md space-y-2" style={{ background: inputBg }}>
              <p className="text-[10px] text-gray-500">上传角色参考图，AI将保持角色外观一致性（也可在上方参考图区域添加）</p>
              <div className="flex flex-wrap gap-2">
                {typedReferences.filter(r => r.type === 'character-front' || r.type === 'character-side').map((ref) => (
                  <div key={ref.id} className="relative w-16 h-16 rounded overflow-hidden group">
                    <img src={ref.url} alt={ref.type} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center py-0.5 bg-black/60 text-white truncate">
                      {REFERENCE_TYPE_CONFIG[ref.type]?.label || ref.type}
                    </span>
                    <button
                      onClick={() => removeTypedReference(ref.id)}
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
                        try {
                          const formData = new FormData();
                          formData.append('file', file);
                          const res = await fetch('/api/save-image', { method: 'POST', body: formData });
                          const data = await res.json();
                          if (data.url) addTypedReference(data.url, 'character-front');
                        } catch {}
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
                  onClick={() => {
                    // 移除所有角色类型参考图
                    setTypedReferences(prev => prev.filter(r => r.type !== 'character-front' && r.type !== 'character-side'));
                    setShowCharacterPanel(false);
                  }}
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
            <div className="flex items-center gap-2 mb-2">
              <Film className="w-4 h-4 text-purple-400" />
              <span className={`text-xs ${sectionTitleClass}`}>多镜头叙事</span>
              <span className="text-[10px] text-gray-500">({multiShotScenes.length} 个镜头)</span>
            </div>

            {/* 连贯性控制 */}
            <div className="flex items-center gap-3 mb-3 pb-2" style={{ borderBottom: `1px solid ${borderColor}` }}>
              <button
                onClick={() => setChainContinuity(!chainContinuity)}
                className="flex items-center gap-1.5 text-[10px] cursor-pointer"
                style={{ color: chainContinuity ? accentColor : textColor }}
              >
                <div className="w-6 h-3 rounded-full relative transition-colors" style={{ background: chainContinuity ? accentColor : 'rgba(255,255,255,0.15)' }}>
                  <div className="absolute top-0.5 w-2 h-2 rounded-full bg-white transition-all shadow-sm" style={{ left: chainContinuity ? '13px' : '2px' }} />
                </div>
                <span>链式连贯</span>
              </button>
              <button
                onClick={() => setUseGlobalReferences(!useGlobalReferences)}
                className="flex items-center gap-1.5 text-[10px] cursor-pointer"
                style={{ color: useGlobalReferences ? accentColor : textColor }}
              >
                <div className="w-6 h-3 rounded-full relative transition-colors" style={{ background: useGlobalReferences ? accentColor : 'rgba(255,255,255,0.15)' }}>
                  <div className="absolute top-0.5 w-2 h-2 rounded-full bg-white transition-all shadow-sm" style={{ left: useGlobalReferences ? '13px' : '2px' }} />
                </div>
                <span>全局参考图</span>
              </button>
              {chainContinuity && (
                <span className="text-[9px] text-gray-500 flex items-center gap-0.5">
                  <Info className="w-2.5 h-2.5" />
                  前段尾帧自动作为后段首帧
                </span>
              )}
            </div>

            {/* 全局参考图提示 */}
            {useGlobalReferences && typedReferences.length > 0 && (
              <div className="mb-2 px-2 py-1 rounded text-[9px] flex items-center gap-1" style={{ background: `${accentColor}10`, color: accentColor }}>
                <ImagePlus className="w-3 h-3" />
                {typedReferences.length} 张参考图将应用到所有镜头
              </div>
            )}
            
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {multiShotScenes.map((scene, index) => (
                <div key={scene.id}>
                  <div className={`p-2 rounded-md border ${subtleBorderClass}`} style={{ background: panelBg }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-purple-400 font-medium">镜头 {index + 1}</span>
                        {chainContinuity && index > 0 && (
                          <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: `${accentColor}15`, color: accentColor }}>
                            接续前段
                          </span>
                        )}
                      </div>
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
                      placeholder={index === 0 
                        ? '描述开场画面...' 
                        : chainContinuity 
                          ? '描述与上一镜头衔接的画面...' 
                          : `描述镜头 ${index + 1} 的画面内容...`}
                      className={`w-full px-2 py-1.5 rounded text-xs border resize-none h-14 ${
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
                  {/* 链式连接指示箭头 */}
                  {chainContinuity && index < multiShotScenes.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <div className="flex flex-col items-center" style={{ color: accentColor }}>
                        <div className="w-px h-2" style={{ background: `${accentColor}40` }} />
                        <FastForward className="w-3 h-3" />
                        <div className="w-px h-2" style={{ background: `${accentColor}40` }} />
                      </div>
                    </div>
                  )}
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
            
            <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500">
              <span>总时长: {multiShotScenes.reduce((sum, s) => sum + s.duration, 0)}s</span>
              {chainContinuity && multiShotScenes.length > 1 && (
                <span className="flex items-center gap-0.5" style={{ color: accentColor }}>
                  <FastForward className="w-2.5 h-2.5" />
                  链式生成
                </span>
              )}
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
            {/* 反向提示词 */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">反向提示词（可选）</label>
              <textarea
                value={negativePrompt}
                onChange={e => setNegativePrompt(e.target.value)}
                placeholder="描述你不想出现的内容，如：模糊、变形、低质量..."
                rows={2}
                className={`w-full rounded-md px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 ${
                  isMonochrome
                    ? 'bg-gray-50 border border-gray-200 text-gray-800 placeholder:text-gray-400 focus:ring-blue-300'
                    : ''
                }`}
                style={isMonochrome ? {} : {
                  background: '#1e1e1e',
                  color: '#e5e5e5',
                  border: '1px solid #333',
                }}
              />
            </div>
            {/* 随机种子 */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 shrink-0">随机种子</label>
              <input
                type="number"
                value={seed ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  setSeed(v ? parseInt(v, 10) : undefined);
                }}
                placeholder="随机"
                className={`flex-1 rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-1 ${
                  isMonochrome
                    ? 'bg-gray-50 border border-gray-200 text-gray-800 placeholder:text-gray-400 focus:ring-blue-300'
                    : ''
                }`}
                style={isMonochrome ? {} : {
                  background: '#1e1e1e',
                  color: '#e5e5e5',
                  border: '1px solid #333',
                }}
              />
              <button
                onClick={() => setSeed(Math.floor(Math.random() * 2147483647))}
                className={`text-xs px-2 py-1 rounded-md transition-colors cursor-pointer ${
                  isMonochrome
                    ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    : ''
                }`}
                style={isMonochrome ? {} : { background: '#2a2a2a', color: subTextColor }}
                title="随机生成种子"
              >
                🎲
              </button>
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

      {/* === 生成历史 === */}
      {videoHistory.length > 0 && (
        <div className="px-3 pt-3">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 text-xs font-medium w-full cursor-pointer"
            style={{ color: subTextColor }}
          >
            <History className="w-3.5 h-3.5" />
            <span>生成历史 ({videoHistory.length})</span>
            <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
          {showHistory && (
            <div className="mt-2">
              <div className="grid grid-cols-3 gap-1.5">
                {videoHistory.slice(0, 12).map(entry => (
                  <button
                    key={entry.id}
                    onClick={() => reuseHistoryEntry(entry)}
                    className="group relative aspect-video rounded-md overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-opacity-60"
                    style={{
                      background: '#1e1e1e',
                    }}
                    title={`${entry.prompt.slice(0, 50)}${entry.prompt.length > 50 ? '...' : ''}\n${entry.model} · ${entry.aspectRatio} · ${entry.duration}s`}
                  >
                    {/* 缩略图或占位符 */}
                    {entry.thumbnailUrl || entry.firstFrameUrl ? (
                      <img
                        src={entry.thumbnailUrl || entry.firstFrameUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Video className="w-4 h-4" style={{ color: subTextColor }} />
                      </div>
                    )}
                    {/* 悬浮覆盖层 */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <RotateCcw className="w-4 h-4 text-white" />
                    </div>
                    {/* 模式标签 */}
                    <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-white" style={{ background: 'rgba(0,0,0,0.7)', fontSize: '9px' }}>
                      {entry.duration}s · {entry.aspectRatio}
                    </div>
                  </button>
                ))}
              </div>
              {videoHistory.length > 3 && (
                <button
                  onClick={clearHistory}
                  className="mt-1.5 text-xs w-full text-center cursor-pointer hover:underline"
                  style={{ color: subTextColor }}
                >
                  清空历史
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* === 生成按钮 === */}
      <div className="px-3 pt-4 pb-3 mt-auto">
        {/* 批量生成选择器 */}
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-xs shrink-0" style={{ color: subTextColor }}>批量生成</span>
          <div className="flex gap-1">
            {([1, 2, 4] as const).map(n => (
              <button
                key={n}
                onClick={() => setBatchCount(n)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                  batchCount === n ? '' : ''
                }`}
                style={{
                  background: batchCount === n
                    ? (isGold ? 'rgba(212,175,55,0.2)' : 'rgba(59,130,246,0.2)')
                    : (isMonochrome ? '#f3f4f6' : '#1e1e1e'),
                  color: batchCount === n ? accentColor : subTextColor,
                  border: `1px solid ${batchCount === n ? (isGold ? 'rgba(212,175,55,0.4)' : 'rgba(59,130,246,0.4)') : (isMonochrome ? '#e5e7eb' : '#333')}`,
                }}
              >
                {n}x
              </button>
            ))}
          </div>
          {batchCount > 1 && (
            <span className="text-[10px] ml-auto" style={{ color: subTextColor }}>
              {batchCount}个不同种子
            </span>
          )}
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !model || (!prompt.trim() && mode !== 'video-extend')}
          className={`w-full ${isGenerating ? 'py-3' : 'py-2.5'} rounded-lg text-sm font-medium flex flex-col items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
          style={{
            background: isGold
              ? (isGenerating ? 'rgba(212,175,55,0.3)' : 'linear-gradient(135deg, #d4af37, #b8962e)')
              : (isGenerating ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #3b82f6, #2563eb)'),
            color: '#fff',
            boxShadow: isGenerating ? 'none' : `0 2px 8px ${isGold ? 'rgba(212,175,55,0.3)' : 'rgba(59,130,246,0.3)'}`,
          }}
        >
          {isGenerating ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{genStage || '处理中...'}</span>
              </div>
              <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.15)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${genProgress}%`,
                    background: isGold ? 'linear-gradient(90deg, #d4af37, #f0d060)' : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                  }}
                />
              </div>
            </div>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              生成视频
            </>
          )}
        </button>
      </div>
      </>
      )}
      </div>{/* 关闭scroll容器 */}
      </div>{/* 关闭内容区域容器 */}
    </div>
  );
}

export { VIDEO_MODEL_REGISTRY };
