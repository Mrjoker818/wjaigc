// 用户相关的类型定义

import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';
import type { MediaAvailability } from '@/lib/asset-core/types';
import type { GenerationRouteAudit } from '@/lib/generation-route-audit';
import type { VideoRetryPayload } from '@/lib/video-processing-state';

export interface User {
  id: string;
  name: string;
  password?: string;
  role?: 'admin' | 'user';
  status?: 'active' | 'disabled';
  productType?: string; // 'canvas' | 'chat' | 'canvas,chat' | null
  groupId?: string; // group ID reference
  chatModels?: string[]; // authorized chat model IDs
  imageModels?: string[]; // authorized image model IDs
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
  dailyImageLimit?: number;
  avatar?: string;
  nickname?: string;
  apiPermissions?: {
    image: boolean;
    chat: boolean;
    threeD: boolean;
    imageEdit: boolean;
    vectorize: boolean;
    vlm: boolean;
    layer: boolean;
    video: boolean;
    upscaler: boolean;
    removebg: boolean;
    audio: boolean;
  };
  storageFolder?: string;
  email?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserUsageRecord {
  id: number;
  userId: string;
  date: string;
  model: string;
  tokensUsed: number;
  imagesGenerated: number;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  schemaVersion?: 1 | 2 | 3;
  description?: string;
  createdAt: number;
  updatedAt: number;
  // 项目数据
  canvasImages: CanvasImage[];
  settings: {
    model?: string;
    aspectRatio?: string;
    quality?: string;
    themeStyle?: 'gold' | 'monochrome';
  };
  metadata?: {
    groups?: ImageGroupData[];
    annotationsV2?: CanvasAnnotationV2[];
    [key: string]: unknown;
  };
  legacyAudit?: {
    sourceSchemaVersion: 1 | 2 | 3;
    payload: unknown;
  };
}

export interface ImageGroupData {
  id: string;
  name: string;
  note: string;
  imageIds: string[];
  x?: number;
  y?: number;
  collapsed?: boolean;
}

export interface CanvasImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  rotation: number;
  zIndex: number;
  createdAt: number;
  // 图像生成元信息
  prompt?: string;
  modifyPrompt?: string;
  model?: string;
  quality?: string;
  aspectRatio?: string;
  stylePreset?: string;
  category?: string;
  size?: string;
  groupId?: string;
  // 原始图片 URL（外部 CDN 地址），用于本地文件丢失时重新下载
  sourceUrl?: string;
  mediaAvailability?: MediaAvailability;
  mediaErrorCode?: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  // AI 模型与提供商信息
  modelName?: string;
  /** Stable provider identity used for task polling and routing. */
  apiProviderId?: string;
  apiProvider?: string;
  apiBaseUrl?: string;
  generationRouteAudit?: GenerationRouteAudit;
  threeDModelUrl?: string;
  threeDModelUrls?: Record<string, string>;
  threeDThumbnailUrls?: Record<string, string>;
  threeDTextureUrls?: Array<Record<string, string>>;
  threeDModelInfo?: { faceCount?: number; vertexCount?: number; fileSize?: string; providerId?: string; providerName?: string; model3DName?: string; modelTaskId?: string };
  isProcessingPlaceholder?: boolean;
  processing?: {
    label: string;
    status: string;
    progress: number;
    taskId?: string;
    /** True only after a processing placeholder was restored from persisted project data. */
    isResumed?: boolean;
    sourceUrl?: string;
    error?: string;
    startTime?: number;
    retryable?: boolean;
    retryPayload?: VideoRetryPayload;
  };
  generatedFromImageId?: string;
  annotationVersionId?: string;
  annotationSourceImageId?: string;
  annotationSourceVersionId?: string;
  annotationBundleId?: string;
  annotationIds?: string[];
  svgDataUrl?: string;
  svgUrl?: string; // SVG服务器文件URL（轻量级，用于下载矢量图，避免存储超大svgDataUrl）
  psdUrl?: string;
  // 视频媒体扩展
  mediaType?: 'image' | 'video';
  videoUrl?: string;
  videoDuration?: number;
  videoThumbnailUrl?: string;
  // 关系与状态
  isPlaying?: boolean;
  relationType?: string;
  // 持久化标记
  _needsPersist?: boolean;  // URL被trimDataUrls清空，需要从本地恢复
  _pendingPersist?: boolean; // data: URL待异步持久化到服务器
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  provider: 'apimart' | 'gemini' | 'custom' | 'openai' | 'openai-async' | 'async-poll' | 'direct';
  key: string;
  baseUrl?: string; // 自定义API的基地址
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UsageStats {
  userId: string;
  date: string; // YYYY-MM-DD
  requests: number;
  imagesGenerated: number;
  videosGenerated: number;
  models3dGenerated: number;
  editsPerformed: number;
  eraseCount: number;
  removeBgCount: number;
  upscaleCount: number;
  chatsCount: number;
  tokensUsed: number;
  estimatedCost: number;
}

export interface UserData {
  user: User;
  projects: Project[];
  apiKeys: ApiKey[];
  usageStats: UsageStats[];
}

export interface WujieProjectFile {
  format: 'wujie-project';
  version: '1.0' | '2.0';
  exportedAt: number;
  project: Project;
}
