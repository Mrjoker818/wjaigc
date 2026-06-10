// 用户相关的类型定义

export interface User {
  id: string;
  name: string;
  password?: string;
  role?: 'admin' | 'user';
  status?: 'active' | 'disabled';
  apiPermissions?: {
    image: boolean;
    chat: boolean;
    threeD: boolean;
    imageEdit: boolean;
    vectorize: boolean;
    layer: boolean;
  };
  storageFolder?: string;
  email?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
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
    [key: string]: unknown;
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
  // AI 模型与提供商信息
  modelName?: string;
  apiProvider?: string;
  apiBaseUrl?: string;
  threeDModelUrl?: string;
  threeDModelUrls?: string[];
  isProcessingPlaceholder?: boolean;
  processing?: string;
  generatedFromImageId?: string;
  svgDataUrl?: string;
  // 视频媒体扩展
  mediaType?: 'image' | 'video';
  videoUrl?: string;
  videoDuration?: number;
  videoThumbnailUrl?: string;
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
