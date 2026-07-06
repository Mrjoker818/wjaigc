/**
 * 视频生成 API 通用调用层
 * 支持 6 种协议适配：dashscope / volcengine-ark / minimax / vidu / openai-video / fal-video / rest-generic / custom
 * 所有视频 API 统一采用"异步提交 + 轮询结果"模式
 */

// ==================== Types ====================

export type VideoCompatProfile =
  | 'dashscope'       // 阿里云百炼 (可灵等)
  | 'volcengine-ark'  // 火山引擎方舟 (Seedance等)
  | 'minimax'         // MiniMax自有协议 (海螺等)
  | 'vidu'            // Vidu自有协议
  | 'openai-video'    // OpenAI /v1/videos (Sora等)
  | 'fal-video'       // fal.ai托管 (Pika等)
  | 'apimart-video'   // APImart /api-b /v1/videos/generations (VEO3/Sora2等)
  | 'pearapi-video'   // PearAPI /v1/videos/generations (gpt-image-2视频/可灵等通用格式)
  | 'rest-generic'    // 通用REST (Runway/Luma/Google等)
  | 'custom';         // 管理员自定义

export interface VideoModelFeatures {
  firstLastFrame: boolean;    // 是否支持首尾帧
  multiReference: boolean;    // 是否支持多参考图
  videoEdit: boolean;         // 是否支持视频编辑
  videoExtend: boolean;       // 是否支持视频延长
  audio: boolean;             // 是否支持音效生成
  cameraControl: boolean;     // 是否支持摄像机控制 (推/拉/摇/移/环绕/跟踪)
  motionBrush: boolean;       // 是否支持运动笔刷 (涂抹区域+轨迹)
  characterConsistency: boolean; // 是否支持角色一致性 (参考图锁定角色)
  multiShot: boolean;         // 是否支持多镜头叙事
  maxDuration: number;        // 最大时长(秒)
  durations: number[];        // 可选时长列表(秒)
  ratios: string[];           // 支持的画面比例
  aspectRatios?: string[];    // 别名（部分前端组件使用 aspectRatios）
  resolutions: string[];      // 支持的分辨率
  region: 'cn' | 'global';   // 国内/海外
}

export interface VideoModelInfo {
  profile: VideoCompatProfile;
  name: string;
  short: string;
  provider: string;
  features: VideoModelFeatures;
}

export interface VideoGenerateParams {
  prompt: string;
  model: string;
  imageUrl?: string;             // 首帧图片 URL (图生视频)
  lastFrameImageUrl?: string;   // 尾帧图片 URL (首尾帧模式)
  referenceImages?: string[];   // 多参考图 (可灵/Seedance/Vidu/Pika)
  aspectRatio?: string;         // 画面比例 (如 "16:9")
  duration?: number;            // 视频时长(秒)
  mode?: 'std' | 'pro';        // 生成模式 (标准/高品质)
  generateAudio?: boolean;      // 是否生成音效
  action?: 'generate' | 'extend' | 'edit'; // 操作类型: 生成/延长/编辑
  videoUrl?: string;            // 延长/编辑源视频 URL
  extendDuration?: number;      // 延长时长(秒)
  // 摄像机控制
  cameraControl?: CameraControlParams;
  // 运动笔刷
  motionBrush?: MotionBrushParams;
  // 角色一致性
  characterReferences?: string[]; // 角色参考图URL列表
  // 多镜头叙事
  multiShotScenes?: Array<{ id: string; prompt: string; duration: number; cameraControl?: CameraControlParams }>;
  // 其他高级参数
  motionStrength?: number; // 运动强度 0-100
  seed?: number; // 随机种子
  negativePrompt?: string; // 反向提示词
  providerId?: string;          // 提供商ID
  apiKey?: string;              // API密钥
  baseUrl?: string;             // API基础URL
  advancedParams?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- 提供商高级参数
}

/** 摄像机控制参数 */
export interface CameraControlParams {
  type: 'push_in' | 'push_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'orbit_left' | 'orbit_right' | 'zoom_in' | 'zoom_out' | 'tracking' | 'static';
  intensity?: number;           // 运动强度 0-100
  speed?: number;               // 速度 0-100
}

/** 运动笔刷参数 */
export interface MotionBrushParams {
  maskDataUrl: string;          // 笔刷涂抹区域的蒙版 (base64 PNG)
  trajectories: MotionTrajectory[]; // 运动轨迹列表
}

export interface MotionTrajectory {
  startX: number;               // 起点X (0-1 归一化)
  startY: number;               // 起点Y (0-1 归一化)
  endX: number;                 // 终点X (0-1 归一化)
  endY: number;                 // 终点Y (0-1 归一化)
  speed?: number;               // 运动速度 0-100
}

export interface VideoTaskSubmitResult {
  taskId: string;
  status: 'queued' | 'submitted' | 'succeeded';
  estimatedTime?: number;  // 预估完成时间(秒)
  videoUrl?: string;       // 同步返回时的视频URL
}

export interface VideoTaskPollResult {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress?: number;       // 0-100
  videoUrl?: string;       // 视频文件URL
  thumbnailUrl?: string;   // 封面帧URL
  watermarkVideoUrl?: string; // 带水印视频URL (可灵)
  duration?: number;       // 实际视频时长
  resolution?: string;     // 实际分辨率
  error?: string;
}

// ==================== Model Registry ====================

const VIDEO_MODEL_REGISTRY: Record<string, VideoModelInfo> = {
  // === 国内模型 ===
  'kling-v3-video-generation': {
    profile: 'dashscope', name: '可灵 V3 视频', short: 'Kling V3', provider: 'Kuaishou',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false, maxDuration: 15, durations: [5, 10, 15], ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'], region: 'cn' },
  },
  'kling-v3-omni-video-generation': {
    profile: 'dashscope', name: '可灵 V3 Omni 视频', short: 'Kling V3 Omni', provider: 'Kuaishou',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 30, durations: [5, 10, 15, 30], ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'], region: 'cn' },
  },
  'kling-v3-5-video-generation': {
    profile: 'dashscope', name: '可灵 V3.5 视频', short: 'Kling V3.5', provider: 'Kuaishou',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 30, durations: [5, 10, 15, 30], ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p','4K'], region: 'cn' },
  },
  'doubao-seedance-3-0': {
    profile: 'volcengine-ark', name: 'Seedance 3.0', short: 'SD 3.0', provider: 'ByteDance',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: true, maxDuration: 15, durations: [5, 10, 15], ratios: ['1:1','4:3','3:4','16:9','9:16','21:9'], resolutions: ['720p','1080p','4K'], region: 'cn' },
  },
  'doubao-seedance-3-0-fast': {
    profile: 'volcengine-ark', name: 'Seedance 3.0 Fast', short: 'SD 3.0F', provider: 'ByteDance',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, cameraControl: true, motionBrush: false, characterConsistency: true, multiShot: true, maxDuration: 15, durations: [5, 10, 15], ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['720p','1080p'], region: 'cn' },
  },
  'doubao-seedance-2-3': {
    profile: 'volcengine-ark', name: 'Seedance 2.3', short: 'SD 2.3', provider: 'ByteDance',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['1:1','4:3','3:4','16:9','9:16','21:9'], resolutions: ['768p','1080p'], region: 'cn' },
  },
  'doubao-seedance-2-3-fast': {
    profile: 'volcengine-ark', name: 'Seedance 2.3 Fast', short: 'SD 2.3F', provider: 'ByteDance',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['768p','1080p'], region: 'cn' },
  },
  'doubao-seedance-2-0': {
    profile: 'volcengine-ark', name: 'Seedance 2.0', short: 'SD 2.0', provider: 'ByteDance',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['1:1','4:3','3:4','16:9','9:16','21:9'], resolutions: ['480p','720p','1080p'], region: 'cn' },
  },
  'doubao-seedance-2-0-fast': {
    profile: 'volcengine-ark', name: 'Seedance 2.0 Fast', short: 'SD 2.0F', provider: 'ByteDance',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['480p','720p','1080p'], region: 'cn' },
  },
  'doubao-seedance-1-0-lite': {
    profile: 'volcengine-ark', name: 'Seedance 1.0 Lite', short: 'SD 1.0L', provider: 'ByteDance',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['480p','720p'], region: 'cn' },
  },
  'hailuo-02': {
    profile: 'minimax', name: '海螺 Hailuo 02', short: 'Hailuo 02', provider: 'MiniMax',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 6, 10], ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['512p','768p','1080p'], region: 'cn' },
  },
  'hailuo-2.3': {
    profile: 'minimax', name: '海螺 Hailuo 2.3', short: 'Hailuo 2.3', provider: 'MiniMax',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 6, 10], ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['768p','1080p'], region: 'cn' },
  },
  'video-01': {
    profile: 'minimax', name: '海螺 Video-01', short: 'Video-01', provider: 'MiniMax',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 6, durations: [6], ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['720p'], region: 'cn' },
  },
  'vidu-q3': {
    profile: 'vidu', name: 'Vidu Q3', short: 'Vidu Q3', provider: 'ShengShu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 16, durations: [4, 8, 16], ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p','4K'], region: 'cn' },
  },
  'vidu-q3-pro': {
    profile: 'vidu', name: 'Vidu Q3 Pro', short: 'Vidu Q3 Pro', provider: 'ShengShu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 16, durations: [4, 8, 16], ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['1080p','4K'], region: 'cn' },
  },
  'vidu-q2': {
    profile: 'vidu', name: 'Vidu Q2', short: 'Vidu Q2', provider: 'ShengShu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [4, 8], ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'], region: 'cn' },
  },
  'vidu-q1': {
    profile: 'vidu', name: 'Vidu Q1', short: 'Vidu Q1', provider: 'ShengShu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [4, 8], ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'], region: 'cn' },
  },
  // === 海外模型 ===
  'gen-4': {
    profile: 'rest-generic', name: 'Runway Gen-4', short: 'Gen-4', provider: 'Runway',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: false, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p','4K'], region: 'global' },
  },
  'gen-4-turbo': {
    profile: 'rest-generic', name: 'Runway Gen-4 Turbo', short: 'Gen-4T', provider: 'Runway',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: false, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'gen-3-alpha-turbo': {
    profile: 'rest-generic', name: 'Runway Gen-3 Turbo', short: 'Gen-3T', provider: 'Runway',
    features: { firstLastFrame: true, multiReference: false, videoEdit: true, videoExtend: true, audio: false, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'gen-3-alpha': {
    profile: 'rest-generic', name: 'Runway Gen-3', short: 'Gen-3', provider: 'Runway',
    features: { firstLastFrame: true, multiReference: false, videoEdit: true, videoExtend: true, audio: false, cameraControl: true, motionBrush: true, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'pika-2.5': {
    profile: 'fal-video', name: 'Pika 2.5', short: 'Pika 2.5', provider: 'Pika',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: false, audio: false, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['16:9','9:16','1:1','4:5','5:4','3:2','2:3'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'pika-2.2': {
    profile: 'fal-video', name: 'Pika 2.2', short: 'Pika 2.2', provider: 'Pika',
    features: { firstLastFrame: false, multiReference: true, videoEdit: true, videoExtend: false, audio: false, cameraControl: true, motionBrush: true, characterConsistency: true, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['16:9','9:16','1:1','4:5','5:4','3:2','2:3'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'pika-2.0': {
    profile: 'fal-video', name: 'Pika 2.0', short: 'Pika 2.0', provider: 'Pika',
    features: { firstLastFrame: false, multiReference: true, videoEdit: true, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 10], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'pika-1.5': {
    profile: 'fal-video', name: 'Pika 1.5', short: 'Pika 1.5', provider: 'Pika',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 5, durations: [5], ratios: ['16:9','9:16','1:1'], resolutions: ['720p'], region: 'global' },
  },
  'ray3.14': {
    profile: 'rest-generic', name: 'Luma Ray3.14', short: 'Ray3.14', provider: 'Luma',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, cameraControl: true, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 9, 10], ratios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'ray3': {
    profile: 'rest-generic', name: 'Luma Ray3', short: 'Ray3', provider: 'Luma',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, cameraControl: true, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5, 9, 10], ratios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'ray2': {
    profile: 'rest-generic', name: 'Luma Ray2', short: 'Ray2', provider: 'Luma',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 5, durations: [5], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'sora': {
    profile: 'openai-video', name: 'OpenAI Sora', short: 'Sora', provider: 'OpenAI',
    features: { firstLastFrame: false, multiReference: false, videoEdit: true, videoExtend: true, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 20, durations: [5, 10, 15, 20], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'veo-3.1': {
    profile: 'rest-generic', name: 'Google Veo 3.1', short: 'Veo 3.1', provider: 'Google',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: true, cameraControl: false, motionBrush: false, characterConsistency: true, multiShot: false, maxDuration: 8, durations: [4, 8], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p','4K'], region: 'global' },
  },
  'veo-3': {
    profile: 'rest-generic', name: 'Google Veo 3', short: 'Veo 3', provider: 'Google',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [4, 8], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'veo-2': {
    profile: 'rest-generic', name: 'Google Veo 2', short: 'Veo 2', provider: 'Google',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [4, 8], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  // ==== APImart 视频模型 ====
  'veo3.1-fast': {
    profile: 'apimart-video', name: 'Veo 3.1 Fast (APImart)', short: 'Veo3.1F', provider: 'Google/APImart',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [8], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'veo3.1-quality': {
    profile: 'apimart-video', name: 'Veo 3.1 Quality (APImart)', short: 'Veo3.1Q', provider: 'Google/APImart',
    features: { firstLastFrame: false, multiReference: true, videoEdit: false, videoExtend: false, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [8], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p','4K'], region: 'global' },
  },
  'veo3.1-lite': {
    profile: 'apimart-video', name: 'Veo 3.1 Lite (APImart)', short: 'Veo3.1L', provider: 'Google/APImart',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [8], ratios: ['16:9','9:16','1:1'], resolutions: ['720p'], region: 'global' },
  },
  'sora-2': {
    profile: 'apimart-video', name: 'Sora 2 (APImart)', short: 'Sora2', provider: 'OpenAI/APImart',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: true, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 20, durations: [5,10,15,20], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'minimax-hailuo-02': {
    profile: 'apimart-video', name: 'MiniMax Hailuo 02 (APImart)', short: 'Hailuo02', provider: 'MiniMax/APImart',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: true, cameraControl: true, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 10, durations: [5,10], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'wan2.5-video': {
    profile: 'apimart-video', name: 'Wan2.5 Video (APImart)', short: 'Wan2.5V', provider: 'Wan/APImart',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, cameraControl: false, motionBrush: false, characterConsistency: false, multiShot: false, maxDuration: 8, durations: [5,8], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
};

/**
 * Get video model info by model ID.
 * Falls back to generic info if model is not in the registry.
 */
export function getVideoModelInfo(modelId: string): VideoModelInfo | null {
  if (!modelId) return null;
  // Exact match
  if (VIDEO_MODEL_REGISTRY[modelId]) return VIDEO_MODEL_REGISTRY[modelId];
  // Case-insensitive partial match
  const lower = modelId.toLowerCase();
  for (const [key, info] of Object.entries(VIDEO_MODEL_REGISTRY)) {
    if (lower.includes(key) || key.includes(lower)) return info;
  }
  // Keyword-based inference
  return inferVideoModelFromKeywords(modelId);
}

export function inferVideoModelFeatures(modelId: string): VideoModelInfo['features'] | null {
  const info = inferVideoModelFromKeywords(modelId);
  return info ? info.features : null;
}

function inferVideoModelFromKeywords(modelId: string): VideoModelInfo | null {
  const lower = modelId.toLowerCase();
  let profile: VideoCompatProfile = 'rest-generic';
  let region: 'cn' | 'global' = 'global';
  let name = modelId;

  // ====== 家族特征推断 ======
  // Kling (可灵): 完整首尾帧/多参考/延长/音效/运镜/运动笔刷
  const isKling = lower.includes('kling') || lower.includes('dashscope') || lower.includes('wanx') || lower.includes('通义');
  // Seedance/豆包: 完整特征
  const isSeedance = lower.includes('seedance') || lower.includes('doubao') || lower.includes('volcengine') || lower.includes('ark') || lower.includes('豆包');
  // Minimax/海螺
  const isMinimax = lower.includes('minimax') || lower.includes('hailuo') || lower.includes('video-01') || lower.includes('海螺');
  // Vidu
  const isVidu = lower.includes('vidu');
  // Sora / OpenAI
  const isSora = lower.includes('sora') || (lower.includes('openai') && lower.includes('video'));
  // Runway Gen-3/4
  const isRunway = lower.includes('runway') || lower.includes('gen-3') || lower.includes('gen-4');
  // Pika
  const isPika = lower.includes('pika');
  // Luma Ray
  const isLuma = lower.includes('luma') || lower.includes('ray');
  // Veo/Google
  const isVeo = lower.includes('veo') || lower.includes('google');
  // 海螺 miniomni/hailuo omni 等带音效
  const hasAudio = isKling || isSeedance || isMinimax || isSora || isVeo;
  // 现代主流视频模型普遍支持首尾帧/图生视频
  const supportsFirstLast = isKling || isSeedance || isVidu || isRunway || isPika || isLuma || isSora || isVeo || isMinimax;
  const supportsMultiRef = isKling || isSeedance || isMinimax;
  const supportsExtend = isKling || isSeedance || isVidu || isLuma || isSora || isVeo || isRunway;
  const supportsCamera = isKling || isSeedance || isVidu || isRunway || isPika || isLuma || isMinimax;
  const supportsMotionBrush = isKling || isSeedance || isRunway || isPika || isLuma;
  const supportsChar = isKling && (lower.includes('v3') && !lower.includes('fast')) || isSeedance || lower.includes('character') || lower.includes('omni');
  const supportsMultiShot = isSeedance;

  if (isKling) {
    profile = 'dashscope'; region = 'cn';
    name = lower.includes('v3.5') || lower.includes('v3-5') ? '可灵 V3.5' : lower.includes('omni') ? '可灵 V3 Omni' : lower.includes('v3') ? '可灵 V3' : lower.includes('v2') ? '可灵 V2' : lower.includes('v2.6') ? '可灵 2.6' : '可灵';
  } else if (isSeedance) {
    profile = 'volcengine-ark'; region = 'cn';
    name = lower.includes('3.0') ? 'Seedance 3.0' : lower.includes('2.3') ? 'Seedance 2.3' : lower.includes('2.0') ? 'Seedance 2.0' : lower.includes('1.0') ? 'Seedance 1.0 Pro' : 'Seedance';
  } else if (isMinimax) {
    profile = 'minimax'; region = 'cn'; name = '海螺 AI';
  } else if (isVidu) {
    profile = 'vidu'; region = 'cn'; name = lower.includes('q2') || lower.includes('2.0') ? 'Vidu Q2' : lower.includes('q1') ? 'Vidu Q1' : 'Vidu';
  } else if (isSora) {
    profile = 'openai-video'; name = 'Sora';
  } else if (isPika || lower.includes('fal')) {
    profile = 'fal-video'; name = isPika ? 'Pika' : name;
  } else if (isRunway) {
    profile = 'rest-generic'; name = lower.includes('gen-4') ? 'Runway Gen-4' : lower.includes('gen-3') ? 'Runway Gen-3' : 'Runway';
  } else if (isLuma) {
    profile = 'rest-generic'; name = 'Luma Ray';
  } else if (isVeo) {
    profile = 'rest-generic'; name = 'Veo';
  } else {
    if (lower.includes('ali') || lower.includes('baidu') || lower.includes('tencent') || lower.includes('cn')) {
      region = 'cn';
    }
  }

  return {
    profile,
    name,
    short: modelId,
    provider: name,
    features: {
      firstLastFrame: supportsFirstLast,
      multiReference: supportsMultiRef,
      videoEdit: supportsFirstLast,
      videoExtend: supportsExtend,
      audio: hasAudio,
      maxDuration: isSeedance && lower.includes('3.0') ? 15 : isKling && lower.includes('v3.5') ? 30 : isKling && lower.includes('omni') ? 30 : isKling && lower.includes('v3') ? 15 : 10,
      durations: isKling && lower.includes('v3.5') || lower.includes('omni') ? [5, 10, 15, 30] : isKling && lower.includes('v3') ? [5, 10, 15] : isSeedance && lower.includes('3.0') ? [5, 10, 15] : [5, 10],
      ratios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      region,
      cameraControl: supportsCamera,
      motionBrush: supportsMotionBrush,
      characterConsistency: supportsChar,
      multiShot: supportsMultiShot,
    },
  };
}

/**
 * Resolve the video compat profile for a model ID and base URL.
 * Can be overridden by the provider's advancedParams.compatProfile.
 */
export function resolveVideoCompatProfile(
  modelId: string,
  compatProfileOverride?: string,
  baseUrl?: string,
): VideoCompatProfile {
  if (compatProfileOverride && compatProfileOverride !== 'auto') {
    return compatProfileOverride as VideoCompatProfile;
  }
  // Priority 1: infer from baseUrl — if URL matches an official API, use its native protocol
  // This is checked FIRST because the API URL determines the actual request format.
  // A third-party proxy (e.g. APImart) serving seedance models uses OpenAI format, NOT volcengine format.
  if (baseUrl) {
    const urlLower = baseUrl.toLowerCase();
    if (urlLower.includes('dashscope') || urlLower.includes('aliyun')) return 'dashscope';
    if (urlLower.includes('volcengine') || urlLower.includes('ark')) return 'volcengine-ark';
    if (urlLower.includes('minimax') || urlLower.includes('hailuo')) return 'minimax';
    if (urlLower.includes('vidu')) return 'vidu';
    if (urlLower.includes('fal.run')) return 'fal-video';
    if (urlLower.includes('openai')) return 'openai-video';
    if (urlLower.includes('apib.ai') || urlLower.includes('apimart')) return 'apimart-video';
    if (urlLower.includes('pearapi') || urlLower.includes('pearapi.ai')) return 'pearapi-video';
    // If baseUrl does NOT match any official API domain, it's a third-party proxy
    // → use rest-generic (OpenAI-compatible format) regardless of model name
    if (!urlLower.includes('volcengine') && !urlLower.includes('ark') &&
        !urlLower.includes('dashscope') && !urlLower.includes('aliyun')) {
      return 'rest-generic';
    }
  }
  // Priority 2: match from model registry (only when no baseUrl or baseUrl matches official domain)
  const info = getVideoModelInfo(modelId);
  if (info) return info.profile;
  return 'rest-generic';
}

/** Ensure baseUrl doesn't produce double /v1 paths. Strips trailing /v1 if present. */
function ensureBaseUrl(url: string): string {
  let clean = url.replace(/\/+$/, '');
  // Strip trailing /v1 to avoid double /v1 when builder appends /v1/xxx
  if (clean.endsWith('/v1')) {
    clean = clean.slice(0, -3);
  }
  return clean;
}

// ==================== Protocol Adapters ====================

/**
 * Build the submit request for a video generation task.
 * Returns { url, headers, body } ready for fetch().
 */
export function buildVideoSubmitRequest(
  profile: VideoCompatProfile,
  params: VideoGenerateParams,
): { url: string; headers: Record<string, string>; body: string; method: string } {
  const baseUrl = ensureBaseUrl(params.baseUrl || '');
  const apiKey = params.apiKey || '';

  switch (profile) {
    case 'dashscope':
      return buildDashscopeSubmit(baseUrl, apiKey, params);
    case 'volcengine-ark':
      return buildVolcengineSubmit(baseUrl, apiKey, params);
    case 'minimax':
      return buildMinimaxSubmit(baseUrl, apiKey, params);
    case 'vidu':
      return buildViduSubmit(baseUrl, apiKey, params);
    case 'openai-video':
      return buildOpenAIVideoSubmit(baseUrl, apiKey, params);
    case 'fal-video':
      return buildFalVideoSubmit(baseUrl, apiKey, params);
    case 'apimart-video':
      return buildApiMartVideoSubmit(baseUrl, apiKey, params);
    case 'pearapi-video':
      return buildPearApiVideoSubmit(baseUrl, apiKey, params);
    case 'rest-generic':
    default:
      return buildRestGenericSubmit(baseUrl, apiKey, params);
  }
}

/**
 * Parse the submit response to extract the task ID.
 */
export function parseVideoSubmitResponse(
  profile: VideoCompatProfile,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): VideoTaskSubmitResult {
  switch (profile) {
    case 'dashscope':
      return {
        taskId: data?.output?.task_id || data?.request_id || '',
        status: 'submitted',
        estimatedTime: 120,
      };
    case 'volcengine-ark':
      return {
        taskId: data?.id || '',
        status: 'submitted',
        estimatedTime: 120,
      };
    case 'minimax':
      return {
        taskId: data?.task_id || '',
        status: 'submitted',
        estimatedTime: 90,
      };
    case 'vidu':
      return {
        taskId: data?.task_id || data?.id || '',
        status: 'submitted',
        estimatedTime: 90,
      };
    case 'openai-video':
      return {
        taskId: data?.id || '',
        status: 'submitted',
        estimatedTime: 120,
      };
    case 'fal-video':
      return {
        taskId: data?.request_id || data?.id || '',
        status: 'submitted',
        estimatedTime: 90,
      };
    case 'apimart-video': {
      // APImart: {code:200, data:[{status:"submitted", task_id:"xxx"}]}
      const items = data?.data;
      const item = Array.isArray(items) ? items[0] : items;
      return {
        taskId: item?.task_id || item?.id || data?.task_id || '',
        status: 'submitted',
        estimatedTime: 240,
      };
    }
    case 'pearapi-video': {
      // PearAPI async: {id, status:'queued', model}
      if (data?.id && (data?.status === 'queued' || data?.status === 'running')) {
        return {
          taskId: data.id,
          status: 'submitted',
          estimatedTime: 240,
        };
      }
      // PearAPI sync: {created, data:[{url}]}
      const syncData = data?.data?.[0];
      if (syncData?.url) {
        return {
          taskId: '',
          status: 'succeeded',
          videoUrl: syncData.url,
        };
      }
      return { taskId: data?.id || '', status: 'submitted', estimatedTime: 240 };
    }
    case 'rest-generic':
    default: {
      // 检查是否同步返回结果（第三方API可能直接返回视频URL）
      const syncData = data?.data?.[0] || data?.results?.[0] || (Array.isArray(data?.data) && data.data[0]);
      if (syncData && (syncData.url || syncData.video_url)) {
        return {
          taskId: '__sync_complete__',
          status: 'succeeded',
          videoUrl: syncData.url || syncData.video_url,
          estimatedTime: 0,
        };
      }
      // 检查嵌套的task_id（如 apimart 格式: {code:200, data:[{task_id:"xxx"}]}）
      if (syncData?.task_id || syncData?.id || syncData?.request_id) {
        return {
          taskId: syncData.task_id || syncData.id || syncData.request_id || '',
          status: syncData.status || 'submitted',
          estimatedTime: 120,
        };
      }
      // 检查顶层直接返回视频URL
      if (data?.url || data?.video_url || data?.output?.video_url) {
        return {
          taskId: '__sync_complete__',
          status: 'succeeded',
          videoUrl: data.url || data.video_url || data.output.video_url,
          estimatedTime: 0,
        };
      }
      return {
        taskId: data?.task_id || data?.id || data?.request_id || '',
        status: data?.status || 'submitted',
        estimatedTime: 120,
      };
    }
  }
}

/**
 * Build the poll request for a video task.
 */
export function buildVideoPollRequest(
  profile: VideoCompatProfile,
  baseUrl: string,
  apiKey: string,
  taskId: string,
  advancedParams?: Record<string, any>,
): { url: string; headers: Record<string, string>; method: string } {
  const cleanBaseUrl = ensureBaseUrl(baseUrl);

  switch (profile) {
    case 'dashscope':
      return {
        url: `${cleanBaseUrl}/api/v1/tasks/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'volcengine-ark':
      return {
        url: `${cleanBaseUrl}/contents/generations/tasks/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'minimax':
      return {
        url: `${cleanBaseUrl}/v1/video_generation?task_id=${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'vidu':
      return {
        url: `${cleanBaseUrl}/api/v1/video/tasks/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'openai-video':
      return {
        url: `${cleanBaseUrl}/v1/videos/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'fal-video':
      return {
        url: `${cleanBaseUrl}/requests/${taskId}/status`,
        headers: { 'Authorization': `Key ${apiKey}` },
        method: 'GET',
      };
    case 'apimart-video':
      return {
        url: `${cleanBaseUrl}/v1/tasks/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'pearapi-video':
      return {
        url: `${cleanBaseUrl}/v1/videos/tasks/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'rest-generic':
    default: {
      // 支持自定义轮询端点（通过advancedParams.pollEndpoint指定）
      const customPollEndpoint = advancedParams?.pollEndpoint;
      if (customPollEndpoint) {
        return {
          url: customPollEndpoint.replace('{taskId}', taskId),
          headers: { 'Authorization': `Bearer ${apiKey}` },
          method: 'GET',
        };
      }
      // 默认轮询端点：尝试多种常见格式
      // 大多数第三方 API 代理使用以下路径之一:
      // /v1/images/generations/{taskId} (OpenAI 风格)
      // /v1/tasks/{taskId} (通用任务)
      // /tasks/{taskId} (简化路径)
      // 优先使用 /v1/images/generations/{taskId} 因为大部分代理通过 images 端点暴露视频模型
      const submitEndpoint = advancedParams?.submitEndpoint || '';
      if (submitEndpoint.includes('images') || advancedParams?.videoEndpoint === 'images') {
        // 提交使用的是 images 端点，轮询也用 images 端点
        return {
          url: `${cleanBaseUrl}/v1/images/generations/${taskId}`,
          headers: { 'Authorization': `Bearer ${apiKey}` },
          method: 'GET',
        };
      }
      return {
        url: `${cleanBaseUrl}/v1/tasks/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    }
  }
}

/**
 * Parse the poll response to extract task status and video URL.
 */
export function parseVideoPollResponse(
  profile: VideoCompatProfile,
  data: any,
): VideoTaskPollResult {
  switch (profile) {
    case 'dashscope':
      return parseDashscopePoll(data);
    case 'volcengine-ark':
      return parseVolcenginePoll(data);
    case 'minimax':
      return parseMinimaxPoll(data);
    case 'vidu':
      return parseViduPoll(data);
    case 'openai-video':
      return parseOpenAIVideoPoll(data);
    case 'fal-video':
      return parseFalVideoPoll(data);
    case 'apimart-video':
      return parseApiMartVideoPoll(data);
    case 'pearapi-video':
      return parsePearApiVideoPoll(data);
    case 'rest-generic':
    default:
      return parseRestGenericPoll(data);
  }
}

// ==================== Protocol-Specific Builders ====================

function buildDashscopeSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const media: Array<{ type: string; url: string; role?: string }> = [];
  if (params.imageUrl) {
    media.push({ type: 'image', url: params.imageUrl, role: 'first_frame' });
  }
  if (params.lastFrameImageUrl) {
    media.push({ type: 'image', url: params.lastFrameImageUrl, role: 'last_frame' });
  }
  if (params.referenceImages?.length) {
    params.referenceImages.forEach((url, i) => {
      media.push({ type: 'image', url, role: `reference_${i + 1}` });
    });
  }

  const body: Record<string, any> = {
    model: params.model,
    input: {
      prompt: params.prompt,
      ...(media.length > 0 ? { media } : {}),
      ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    },
    parameters: {
      ...(params.mode ? { mode: params.mode } : { mode: 'std' }),
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
      ...(params.duration ? { duration: params.duration } : {}),
      ...(params.generateAudio ? { audio: true } : {}),
      ...(params.seed ? { seed: params.seed } : {}),
      // 摄像机控制
      ...(params.cameraControl?.type ? {
        camera_control: {
          type: params.cameraControl.type,
          intensity: params.cameraControl.intensity ?? 50,
          speed: params.cameraControl.speed ?? 50,
        },
      } : {}),
      // 运动笔刷 (可灵 DynamicMask)
      ...(params.motionBrush?.maskDataUrl ? {
        dynamic_mask: {
          mask: params.motionBrush.maskDataUrl,
          trajectories: params.motionBrush.trajectories.map(t => ({
            start_x: t.startX, start_y: t.startY,
            end_x: t.endX, end_y: t.endY,
            speed: t.speed ?? 50,
          })),
        },
      } : {}),
      // 角色一致性参考图
      ...(params.characterReferences?.length ? {
        character_references: params.characterReferences.map((url, i) => ({
          url, role: `character_${i + 1}`,
        })),
      } : {}),
    },
  };

  return {
    url: `${baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildVolcengineSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const content: Array<Record<string, any>> = [
    { type: 'text', text: params.prompt },
  ];
  if (params.imageUrl) {
    content.push({ type: 'image_url', image_url: { url: params.imageUrl, role: 'first_frame' } });
  }
  if (params.lastFrameImageUrl) {
    content.push({ type: 'image_url', image_url: { url: params.lastFrameImageUrl, role: 'last_frame' } });
  }
  if (params.referenceImages?.length) {
    params.referenceImages.forEach((url) => {
      content.push({ type: 'image_url', image_url: { url } });
    });
  }
  // 角色一致性参考图 (Seedance 3.0 Reference to Get)
  if (params.characterReferences?.length) {
    params.characterReferences.forEach((url, i) => {
      content.push({ type: 'image_url', image_url: { url, role: `character_${i + 1}` } });
    });
  }

  const body: Record<string, any> = {
    model: params.model,
    content,
    ...(params.aspectRatio ? { ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    ...(params.generateAudio ? { generate_audio: true } : {}),
    ...(params.seed ? { seed: params.seed } : {}),
    // 摄像机控制 (Seedance camera_control)
    ...(params.cameraControl?.type ? {
      camera_control: {
        type: params.cameraControl.type,
        intensity: params.cameraControl.intensity ?? 50,
        speed: params.cameraControl.speed ?? 50,
      },
    } : {}),
    // 运动笔刷 (Seedance motion_brush)
    ...(params.motionBrush?.maskDataUrl ? {
      motion_brush: {
        mask: params.motionBrush.maskDataUrl,
        trajectories: params.motionBrush.trajectories.map(t => ({
          start_x: t.startX, start_y: t.startY,
          end_x: t.endX, end_y: t.endY,
          speed: t.speed ?? 50,
        })),
      },
    } : {}),
    // 多镜头叙事 (Seedance 3.0 multi_shot)
    ...(params.advancedParams?.multiShotScenes ? {
      multi_shot: { scenes: params.advancedParams.multiShotScenes },
    } : {}),
  };

  return {
    url: `${baseUrl}/contents/generations/tasks`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildMinimaxSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    ...(params.imageUrl ? { first_frame_image: params.imageUrl } : {}),
    ...(params.lastFrameImageUrl ? { last_frame_image: params.lastFrameImageUrl } : {}),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
  };

  return {
    url: `${baseUrl}/v1/video_generation`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildViduSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const images: Array<{ url: string; role?: string }> = [];
  if (params.imageUrl) {
    images.push({ url: params.imageUrl, role: 'first_frame' });
  }
  if (params.lastFrameImageUrl) {
    images.push({ url: params.lastFrameImageUrl, role: 'last_frame' });
  }
  if (params.referenceImages?.length) {
    params.referenceImages.forEach((url, i) => {
      images.push({ url, role: `reference_${i + 1}` });
    });
  }

  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    ...(images.length > 0 ? { images } : {}),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    ...(params.generateAudio ? { audio: true } : {}),
    ...(params.seed ? { seed: params.seed } : {}),
    // 摄像机控制
    ...(params.cameraControl?.type ? {
      camera_control: {
        type: params.cameraControl.type,
        intensity: params.cameraControl.intensity ?? 50,
      },
    } : {}),
    // 运动笔刷
    ...(params.motionBrush?.maskDataUrl ? {
      motion_brush: {
        mask: params.motionBrush.maskDataUrl,
        trajectories: params.motionBrush.trajectories.map(t => ({
          start_x: t.startX, start_y: t.startY,
          end_x: t.endX, end_y: t.endY,
        })),
      },
    } : {}),
    // 角色一致性
    ...(params.characterReferences?.length ? {
      character_references: params.characterReferences.map((url, i) => ({
        url, role: `character_${i + 1}`,
      })),
    } : {}),
  };

  return {
    url: `${baseUrl}/api/v1/video/generate`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildOpenAIVideoSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    ...(params.imageUrl ? { image_url: params.imageUrl } : {}),
    ...(params.aspectRatio ? { size: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    n: 1,
  };

  return {
    url: `${baseUrl}/v1/videos`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildFalVideoSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  // fal.ai uses a queue-based pattern
  const body: Record<string, any> = {
    prompt: params.prompt,
    ...(params.imageUrl ? { image_url: params.imageUrl } : {}),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
  };

  // fal.ai URLs are like: https://queue.fal.run/{model_id}
  const submitUrl = baseUrl.includes('fal.run')
    ? `${baseUrl}/${params.model}`
    : `${baseUrl}/queue/${params.model}`;

  return {
    url: submitUrl,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildRestGenericSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  // Support both video-specific and image-style endpoints for max third-party compatibility
  // Many third-party APIs expose video generation via /v1/images/generations
  const cleanBase = ensureBaseUrl(baseUrl);

  const advancedEndpoint = params.advancedParams?.submitEndpoint;
  const useImageEndpoint = advancedEndpoint
    ? advancedEndpoint.includes('images')
    : (params.advancedParams?.videoEndpoint === 'images'
      || baseUrl.includes('/v1/images'));

  const endpoint = advancedEndpoint
    ? `${cleanBase}${advancedEndpoint.startsWith('/') ? advancedEndpoint : '/' + advancedEndpoint}`
    : useImageEndpoint
      ? `${cleanBase}/v1/images/generations`
      : `${cleanBase}/v1/video/generations`;

  // Build request body compatible with both OpenAI image and video API formats
  // 策略：视频模型始终使用 aspect_ratio（如 "16:9"），不发送像素 size（代理可能误映射为 ratio）
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    // Image-style: image as array of objects; Video-style: flat fields
    ...(params.imageUrl ? useImageEndpoint
      ? { image: params.imageUrl }  // OpenAI images/generations style
      : { image_url: params.imageUrl }  // Video style
    : {}),
    ...(params.lastFrameImageUrl ? { last_frame_image_url: params.lastFrameImageUrl } : {}),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.generateAudio ? { audio: true } : {}),
    ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    ...(params.seed !== undefined ? { seed: params.seed } : {}),
    // 摄像机控制
    ...(params.cameraControl?.type ? {
      camera_control: {
        type: params.cameraControl.type,
        intensity: params.cameraControl.intensity ?? 50,
        speed: params.cameraControl.speed ?? 50,
      },
    } : {}),
    // 运动笔刷
    ...(params.motionBrush?.maskDataUrl ? {
      motion_brush: {
        mask: params.motionBrush.maskDataUrl,
        trajectories: params.motionBrush.trajectories,
      },
    } : {}),
    // 角色一致性
    ...(params.characterReferences?.length ? {
      character_references: params.characterReferences,
    } : {}),
    // Image-style: n=1 for single video generation
    ...(useImageEndpoint ? { n: 1, response_format: 'url' } : {}),
  };

  return {
    url: endpoint,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

/** APImart videos/generations submit (per docs.apib.ai).
 * POST /v1/videos/generations
 * Fields: model, prompt, n(optional), aspect_ratio, duration, image_urls[], negative_prompt,
 *         resolution(720p/1080p/4k), generation_type(frame=文生视频/reference=图生视频), seed
 * Response: {code:200, data:[{status:"submitted", task_id}]}
 */
function buildApiMartVideoSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const cleanBase = ensureBaseUrl(baseUrl);
  const imageUrls: string[] = [];
  if (params.imageUrl) imageUrls.push(params.imageUrl);
  if (params.lastFrameImageUrl) imageUrls.push(params.lastFrameImageUrl);
  if (params.referenceImages?.length) imageUrls.push(...params.referenceImages);

  // Map resolution: duration/quality → 720p/1080p/4k (default 1080p)
  let resolution = '1080p';
  if (params.mode === 'pro') resolution = '4k';
  const advRes = params.advancedParams?.resolution;
  if (advRes) resolution = advRes;

  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    n: 1,
    generation_type: imageUrls.length > 0 ? 'reference' : 'frame',
    ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    resolution,
    ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    ...(params.seed !== undefined ? { seed: params.seed } : {}),
  };

  return {
    url: `${cleanBase}/v1/videos/generations`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

/** Parse APImart video poll response.
 * GET /v1/tasks/{id}
 * Response: {code:200, data:{id, status, progress(0-100), result:{videos:[{url:[...URLs]}]}, error:{code,message}}}
 */
function parseApiMartVideoPoll(data: any): VideoTaskPollResult {
  const inner = data?.data;
  const item = Array.isArray(inner) ? inner[0] : inner;
  const status = (item?.status || data?.status || '').toLowerCase();

  if (status === 'succeeded' || status === 'completed' || status === 'success' || status === 'done') {
    const result = item?.result || item?.results || item?.output || {};
    const videos = result?.videos || result?.video_results || [];
    let videoUrl: string | undefined;
    if (Array.isArray(videos) && videos.length > 0) {
      const v = videos[0];
      videoUrl = Array.isArray(v.url) ? v.url[0] : (v.url || v.video_url);
    }
    if (!videoUrl) videoUrl = result?.video_url || result?.url || item?.video_url;
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl,
      duration: result?.duration,
      thumbnailUrl: result?.thumbnail_url || result?.cover_url,
    };
  }
  if (status === 'failed' || status === 'error' || status === 'cancelled') {
    return {
      status: 'failed',
      error: item?.error?.message || item?.fail_reason || data?.error?.message || data?.message || 'Video generation failed',
    };
  }
  if (status === 'running' || status === 'processing' || status === 'in_progress') {
    const rawProgress = item?.progress ?? data?.progress;
    const progress = rawProgress != null
      ? (rawProgress > 1 ? rawProgress : Math.round(rawProgress * 100))
      : 50;
    return { status: 'running', progress };
  }
  // pending/queued/submitted
  return { status: 'pending', progress: item?.progress ?? 10 };
}

/** Build PearAPI video submit request.
 * POST /v1/videos/generations
 * Body: {model, prompt, n, size, aspect_ratio, task_type:'async', image/images, duration}
 * Async response: {id, status:'queued', model}
 * Sync response: {created, data:[{url}]}
 */
function buildPearApiVideoSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const cleanBase = ensureBaseUrl(baseUrl);
  const refImages: string[] = [];
  if (params.imageUrl) refImages.push(params.imageUrl);
  if (params.lastFrameImageUrl) refImages.push(params.lastFrameImageUrl);
  if (params.referenceImages?.length) refImages.push(...params.referenceImages);

  // Compute size from aspect ratio or default
  const size = params.aspectRatio && params.aspectRatio.includes(':')
    ? params.aspectRatio
    : '16:9';

  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    n: 1,
    size,
    response_format: 'url',
    task_type: 'async',
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    ...(params.seed !== undefined ? { seed: params.seed } : {}),
  };

  // Single image vs multiple (PearAPI style: same as images)
  if (refImages.length === 1) {
    body.image = refImages[0];
  } else if (refImages.length > 1) {
    body.images = refImages;
  }

  return {
    url: `${cleanBase}/v1/videos/generations`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

/** Parse PearAPI video poll response.
 * GET /v1/videos/tasks/{id}
 * Completed response: {status:'completed', output:{created, data:[{url}], video_urls:[...]}, progress, error:{message}}
 */
function parsePearApiVideoPoll(data: any): VideoTaskPollResult {
  const status = (data?.status || '').toLowerCase();
  const output = data?.output || data;

  if (status === 'succeeded' || status === 'completed' || status === 'success' || status === 'done') {
    const dataArr = output?.data || output?.video_urls || [];
    let videoUrl: string | undefined;
    if (Array.isArray(dataArr) && dataArr.length > 0) {
      const first = dataArr[0];
      videoUrl = typeof first === 'string' ? first : (first.url || first.video_url);
    }
    if (!videoUrl) videoUrl = output?.video_url || output?.url || data?.video_url;

    return {
      status: 'succeeded',
      progress: 100,
      videoUrl,
      duration: output?.duration,
      thumbnailUrl: output?.thumbnail_url || output?.cover_url,
    };
  }
  if (status === 'failed' || status === 'error' || status === 'cancelled') {
    return {
      status: 'failed',
      error: data?.error?.message || data?.message || output?.error?.message || 'Video generation failed',
    };
  }
  if (status === 'running' || status === 'processing' || status === 'in_progress') {
    const rawProgress = data?.progress ?? output?.progress;
    const progress = rawProgress != null
      ? (rawProgress > 1 ? rawProgress : Math.round(rawProgress * 100))
      : 50;
    return { status: 'running', progress };
  }
  // queued/pending
  return { status: 'pending', progress: data?.progress ?? 5 };
}

/** Convert aspect ratio like "16:9" to approximate pixel size string "1920x1080" */
export function ratioToSize(ratio: string): string {
  const ratioMap: Record<string, string> = {
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '16:9': '1920x1080',
    '9:16': '1080x1920',
    '21:9': '1792x768',
  };
  return ratioMap[ratio] || '1024x1024';
}

// ==================== Protocol-Specific Parsers ====================

function parseDashscopePoll(data: any): VideoTaskPollResult {
  const status = data?.output?.task_status || '';
  const videoResult = data?.output?.video_result?.[0];

  if (status === 'SUCCEEDED') {
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: videoResult?.video_url,
      watermarkVideoUrl: videoResult?.watermark_video_url,
      duration: videoResult?.duration,
    };
  } else if (status === 'FAILED') {
    return {
      status: 'failed',
      error: data?.output?.message || data?.message || 'Video generation failed',
    };
  } else if (status === 'RUNNING' || status === 'PENDING') {
    return {
      status: status === 'RUNNING' ? 'running' : 'pending',
      progress: status === 'RUNNING' ? 50 : 10,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseVolcenginePoll(data: any): VideoTaskPollResult {
  const status = data?.status || '';
  const content = data?.content;

  if (status === 'succeeded') {
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: content?.video_url,
      duration: content?.duration,
    };
  } else if (status === 'failed') {
    return {
      status: 'failed',
      error: data?.error?.message || data?.message || 'Video generation failed',
    };
  } else if (status === 'running' || status === 'queued') {
    return {
      status: status === 'running' ? 'running' : 'pending',
      progress: status === 'running' ? 50 : 10,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseMinimaxPoll(data: any): VideoTaskPollResult {
  const status = data?.status || data?.task_status || '';

  if (status === 'succeeded' || status === 'Success' || status === 'done') {
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: data?.video_url || data?.file_id,
      duration: data?.duration,
    };
  } else if (status === 'failed' || status === 'Fail' || status === 'error') {
    return {
      status: 'failed',
      error: data?.error?.message || data?.message || 'Video generation failed',
    };
  } else if (status === 'running' || status === 'processing' || status === 'Queueing') {
    return {
      status: status === 'Queueing' ? 'pending' : 'running',
      progress: status === 'Queueing' ? 10 : 50,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseViduPoll(data: any): VideoTaskPollResult {
  const status = data?.status || '';

  if (status === 'success' || status === 'succeeded') {
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: data?.video_url || data?.result?.video_url,
      duration: data?.duration,
    };
  } else if (status === 'failed' || status === 'error') {
    return {
      status: 'failed',
      error: data?.error || data?.message || 'Video generation failed',
    };
  } else if (status === 'processing' || status === 'running' || status === 'pending') {
    return {
      status: status === 'pending' ? 'pending' : 'running',
      progress: status === 'pending' ? 10 : 50,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseOpenAIVideoPoll(data: any): VideoTaskPollResult {
  const status = data?.status || '';

  if (status === 'completed' || status === 'succeeded') {
    const videoData = data?.data?.[0] || data;
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: videoData?.url || videoData?.video_url,
      duration: videoData?.duration,
    };
  } else if (status === 'failed' || status === 'error') {
    return {
      status: 'failed',
      error: data?.error?.message || data?.last_error?.message || 'Video generation failed',
    };
  } else if (status === 'processing' || status === 'running' || status === 'queued' || status === 'in_progress') {
    return {
      status: status === 'queued' || status === 'in_progress' ? 'pending' : 'running',
      progress: status === 'queued' ? 10 : 50,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseFalVideoPoll(data: any): VideoTaskPollResult {
  const status = data?.status || '';

  if (status === 'COMPLETED' || status === 'completed' || status === 'succeeded') {
    const output = data?.output || data;
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: output?.video_url || output?.url,
      duration: output?.duration,
    };
  } else if (status === 'FAILED' || status === 'failed') {
    return {
      status: 'failed',
      error: data?.error || data?.message || 'Video generation failed',
    };
  } else if (status === 'IN_PROGRESS' || status === 'in_progress' || status === 'running') {
    return {
      status: 'running',
      progress: data?.progress ? Math.round(data.progress * 100) : 50,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseRestGenericPoll(data: any): VideoTaskPollResult {
  // apimart 格式: {code:200, data:{task_status:"SUCCEEDED", results:{video_url:"..."}}}
  // 或: {code:200, data:[{status:"SUCCEEDED", video_url:"..."}]}
  const innerData = data?.data;
  const pollItem = Array.isArray(innerData) ? innerData[0] : innerData;
  
  // 优先从嵌套data中提取状态和结果
  const status = (pollItem?.status || pollItem?.task_status || data?.status || data?.task_status || '').toLowerCase();

  if (status === 'succeeded' || status === 'completed' || status === 'success' || status === 'done') {
    const result = pollItem?.results || pollItem?.result || pollItem?.output || data?.result || data?.output || data?.data?.[0] || data;
    // apimart 格式: result.videos[0].url[0] 或 result.videos[0].url
    // 通用格式: result.video_url / result.url / result.content.video_url
    const videosArray = result?.videos || result?.video_results;
    const videoUrl = result?.video_url || result?.url || result?.content?.video_url
      || pollItem?.video_url || pollItem?.url
      || (Array.isArray(videosArray) && videosArray.length > 0
        ? (Array.isArray(videosArray[0].url) ? videosArray[0].url[0] : videosArray[0].url)
        : undefined);
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl,
      duration: result?.duration,
    };
  } else if (status === 'failed' || status === 'error') {
    return {
      status: 'failed',
      error: pollItem?.error || data?.error?.message || data?.message || data?.error || 'Video generation failed',
    };
  } else if (status === 'running' || status === 'processing' || status === 'in_progress') {
    // 进度值可能是 0-1（比例）或 0-100（百分比），智能判断
    const rawProgress = data?.progress ?? pollItem?.progress;
    const progress = rawProgress != null
      ? (rawProgress > 1 ? rawProgress : Math.round(rawProgress * 100))
      : 50;
    return {
      status: 'running',
      progress,
    };
  } else if (status === 'pending' || status === 'queued' || status === 'submitted') {
    return { status: 'pending', progress: 10 };
  }
  return { status: 'pending', progress: 0 };
}

// ==================== Video Extend Protocol Adapters ====================

/**
 * Build the submit request for a video extend task.
 * Extends an existing video by generating additional frames.
 */
export function buildVideoExtendRequest(
  profile: VideoCompatProfile,
  params: VideoGenerateParams,
): { url: string; headers: Record<string, string>; body: string; method: string } {
  const baseUrl = ensureBaseUrl(params.baseUrl || '');
  const apiKey = params.apiKey || '';

  switch (profile) {
    case 'dashscope':
      return buildDashscopeExtend(baseUrl, apiKey, params);
    case 'volcengine-ark':
      return buildVolcengineExtend(baseUrl, apiKey, params);
    case 'vidu':
      return buildViduExtend(baseUrl, apiKey, params);
    case 'openai-video':
      return buildOpenAIVideoExtend(baseUrl, apiKey, params);
    case 'fal-video':
      return buildFalVideoExtend(baseUrl, apiKey, params);
    case 'minimax':
    case 'apimart-video':
    case 'pearapi-video':
    case 'rest-generic':
    default:
      return buildRestGenericExtend(baseUrl, apiKey, params);
  }
}

function buildDashscopeExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    input: {
      video_url: params.videoUrl,
      prompt: params.prompt || '请延长视频',
    },
    parameters: {
      ...(params.extendDuration ? { duration: params.extendDuration } : { duration: 5 }),
      ...(params.generateAudio ? { audio: true } : {}),
    },
  };

  return {
    url: `${baseUrl}/api/v1/services/aigc/video-generation/video-extension`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildVolcengineExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const content: Array<Record<string, any>> = [
    { type: 'text', text: params.prompt || '请延长视频' },
  ];
  if (params.videoUrl) {
    content.push({ type: 'video_url', video_url: { url: params.videoUrl } });
  }

  const body: Record<string, any> = {
    model: params.model,
    content,
    action: 'extend',
    ...(params.extendDuration ? { duration: params.extendDuration } : { duration: 5 }),
    ...(params.generateAudio ? { generate_audio: true } : {}),
  };

  return {
    url: `${baseUrl}/contents/generations/tasks`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildViduExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt || '请延长视频',
    video_url: params.videoUrl,
    ...(params.extendDuration ? { duration: params.extendDuration } : { duration: 4 }),
    ...(params.generateAudio ? { audio: true } : {}),
  };

  return {
    url: `${baseUrl}/api/v1/video/extend`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildOpenAIVideoExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt || 'Extend this video',
    video_url: params.videoUrl,
    ...(params.extendDuration ? { duration: params.extendDuration } : {}),
    n: 1,
  };

  return {
    url: `${baseUrl}/v1/videos`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildFalVideoExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    prompt: params.prompt || 'Extend this video',
    video_url: params.videoUrl,
    ...(params.extendDuration ? { duration: params.extendDuration } : {}),
  };

  const submitUrl = baseUrl.includes('fal.run')
    ? `${baseUrl}/${params.model}`
    : `${baseUrl}/queue/${params.model}`;

  return {
    url: submitUrl,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildRestGenericExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt || '请延长视频',
    video_url: params.videoUrl,
    action: 'extend',
    ...(params.extendDuration ? { duration: params.extendDuration } : { duration: 5 }),
    ...(params.generateAudio ? { audio: true } : {}),
  };

  return {
    url: `${baseUrl}/v1/video/extend`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

// ==================== Utility Functions ====================

/**
 * Check if a model ID is likely a video model.
 */
export function isVideoModel(modelId: string): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return lower.includes('video') ||
    lower.includes('seedance') ||
    lower.includes('kling-v3') ||
    lower.includes('hailuo') ||
    lower.includes('vidu') ||
    lower.includes('sora') ||
    lower.includes('veo') ||
    lower.includes('pika') ||
    lower.includes('ray2') ||
    lower.includes('ray3') ||
    lower.includes('gen-3') ||
    lower.includes('gen-4');
}

/**
 * Get the default aspect ratios for video generation.
 */
export function getDefaultVideoRatios(): string[] {
  return ['1:1', '4:3', '16:9', '9:16', '21:9'];
}

/**
 * Get the default durations for video generation.
 */
export function getDefaultVideoDurations(): number[] {
  return [5, 10];
}

/**
 * Map aspect ratio to approximate pixel dimensions for video.
 */
export function getVideoPixelSize(aspectRatio: string, resolution: string = '1080p'): { width: number; height: number } {
  const [w, h] = aspectRatio.split(':').map(Number);
  const baseHeight = resolution === '720p' ? 720 : resolution === '1080p' ? 1080 : resolution === '4K' ? 2160 : 1080;
  const baseWidth = Math.round(baseHeight * w / h);
  // Round to nearest multiple of 8
  return {
    width: Math.round(baseWidth / 8) * 8,
    height: Math.round(baseHeight / 8) * 8,
  };
}
