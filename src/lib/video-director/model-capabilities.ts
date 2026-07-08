// 视频模型导演能力档案：按模型家族确定支持的导演特性（首尾帧/多参考图/音效/最大时长/参考角色限制等）
import { VIDEO_MODEL_REGISTRY } from '../video-api';
import type { DirectorStyle } from './prompt-compiler';

export interface VideoModelDirectorProfile {
  supportsFirstLastFrame: boolean;
  supportsMultiReference: boolean;
  supportsAudio: boolean;
  supportsMotionBrush: boolean;
  supportsCameraControl: boolean;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  maxDuration: number; // 秒
  maxReferenceCount: number;
  maxCharacterRefs: number;
  cameraMoves: string[];
  aspectRatios: string[];
}

const DEFAULT_PROFILE: VideoModelDirectorProfile = {
  supportsFirstLastFrame: false,
  supportsMultiReference: false,
  supportsAudio: false,
  supportsMotionBrush: false,
  supportsCameraControl: false,
  supportsNegativePrompt: true,
  supportsSeed: false,
  maxDuration: 10,
  maxReferenceCount: 1,
  maxCharacterRefs: 1,
  cameraMoves: ['static'],
  aspectRatios: ['16:9', '9:16', '1:1'],
};

// 协议级能力默认值（保守）
const PROTOCOL_PROFILE: Record<string, Partial<VideoModelDirectorProfile>> = {
  'dashscope-kling': {
    supportsFirstLastFrame: true,
    supportsMultiReference: false,
    supportsAudio: true,
    supportsMotionBrush: true,
    supportsCameraControl: true,
    maxDuration: 10,
    maxReferenceCount: 2,
    maxCharacterRefs: 3,
    cameraMoves: ['static', 'push_in', 'push_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'tracking', 'crane_up', 'crane_down'],
    aspectRatios: ['16:9', '9:16', '1:1', '21:9', '4:3'],
  },
  'volcengine-ark': {
    supportsFirstLastFrame: true,
    supportsMultiReference: true,
    supportsAudio: true,
    supportsMotionBrush: false,
    supportsCameraControl: true,
    maxDuration: 15,
    maxReferenceCount: 4,
    maxCharacterRefs: 3,
    cameraMoves: ['static', 'push_in', 'push_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'orbit_left', 'orbit_right', 'zoom_in', 'zoom_out'],
    aspectRatios: ['16:9', '9:16', '1:1', '21:9', '4:3'],
  },
  minimax: {
    supportsFirstLastFrame: false,
    supportsMultiReference: false,
    supportsAudio: true,
    supportsMotionBrush: false,
    supportsCameraControl: false,
    maxDuration: 6,
    maxReferenceCount: 1,
    maxCharacterRefs: 1,
    cameraMoves: ['static'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  vidu: {
    supportsFirstLastFrame: true,
    supportsMultiReference: true,
    supportsAudio: false,
    supportsMotionBrush: false,
    supportsCameraControl: false,
    maxDuration: 8,
    maxReferenceCount: 4,
    maxCharacterRefs: 2,
    cameraMoves: ['static'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'openai-video': {
    supportsFirstLastFrame: false,
    supportsMultiReference: false,
    supportsAudio: false,
    supportsMotionBrush: false,
    supportsCameraControl: false,
    maxDuration: 20,
    maxReferenceCount: 1,
    maxCharacterRefs: 1,
    cameraMoves: ['static'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'fal-video': {
    supportsFirstLastFrame: true,
    supportsMultiReference: true,
    supportsAudio: false,
    supportsMotionBrush: false,
    supportsCameraControl: false,
    maxDuration: 13,
    maxReferenceCount: 3,
    maxCharacterRefs: 2,
    cameraMoves: ['static'],
    aspectRatios: ['16:9', '9:16', '1:1', '21:9'],
  },
};

export function getVideoModelDirectorProfile(modelId: string): VideoModelDirectorProfile {
  const entry = (VIDEO_MODEL_REGISTRY as unknown as Record<string, { protocol: string; features?: Record<string, boolean>; maxDuration?: number }>)[modelId];
  const base: VideoModelDirectorProfile = { ...DEFAULT_PROFILE };
  if (entry) {
    const protoOverrides = PROTOCOL_PROFILE[entry.protocol] || {};
    Object.assign(base, protoOverrides);
    if (entry.maxDuration) base.maxDuration = entry.maxDuration;
    // 按 features 字段细化开关
    if (entry.features) {
      const f = entry.features;
      if (f.firstLastFrame === false) base.supportsFirstLastFrame = false;
      if (f.multiReference === false) base.supportsMultiReference = false;
      if (f.audio === false) base.supportsAudio = false;
      if (f.cameraControl === false) base.supportsCameraControl = false;
      if (f.motionBrush === false) base.supportsMotionBrush = false;
    }
  }
  return base;
}

// 兼容旧 API
export function getModelCameraMoveLimit(modelId: string): string[] {
  return getVideoModelDirectorProfile(modelId).cameraMoves;
}
export function getModelFeatureSupport(modelId: string): Record<string, boolean> {
  const p = getVideoModelDirectorProfile(modelId);
  return {
    firstLastFrame: p.supportsFirstLastFrame,
    multiReference: p.supportsMultiReference,
    audio: p.supportsAudio,
    motionBrush: p.supportsMotionBrush,
    cameraControl: p.supportsCameraControl,
    negativePrompt: p.supportsNegativePrompt,
    seed: p.supportsSeed,
  };
}
export function getModelMaxReferenceTypes(modelId: string): { total: number; characters: number } {
  const p = getVideoModelDirectorProfile(modelId);
  return { total: p.maxReferenceCount, characters: p.maxCharacterRefs };
}
export function getModelAspectRatios(modelId: string): string[] {
  return getVideoModelDirectorProfile(modelId).aspectRatios;
}

// 限制常量
export const CAPABILITY_LIMITS = {
  maxShotCount: 8,
  maxPromptLength: 1500,
  defaultStyle: 'cinematic' as DirectorStyle,
};
export const CAMERA_MOVE_LIMITS = {
  all: ['static', 'push_in', 'push_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'orbit_left', 'orbit_right', 'zoom_in', 'zoom_out', 'tracking', 'crane_up', 'crane_down', 'handheld', 'dolly'],
};
export const FEATURE_SUPPORT = {
  shotPlan: true,
  directorPrompt: true,
  retakeDiagnosis: true,
};
export const MAX_REFERENCE_TYPES = {
  default: 4,
  perModel: true,
};
