/**
 * PSD 分层编辑器 - 类型定义
 * 依据 PSD SKILL V4 规范
 */

/* ---------- 图层类型 ---------- */

export type PsdLayerType = 'raster' | 'text' | 'adjustment' | 'shape' | 'group';

export type PsdExportMode = 'basic' | 'standard' | 'advanced' | 'studio';

export type PsdExportStage = 'idle' | 'segment' | 'generate' | 'done';

/* ---------- 图层项 ---------- */

export interface PsdLayerItem {
  id: string;
  name: string;
  type: PsdLayerType;
  visible: boolean;
  locked: boolean;
  opacity: number;          // 0-1
  x: number;
  y: number;
  width: number;
  height: number;
  imageUrl: string;
  blendMode: string;
  /** 文本图层内容 */
  textContent?: string;
  /** 语义角色 (background/subject/text/shadow/decoration) */
  semanticRole?: string;
  /** 父组 ID */
  parentId?: string;
}

/* ---------- PSD 文档 ---------- */

export interface PsdDocument {
  id: string;
  fileName: string;
  width: number;
  height: number;
  layers: PsdLayerItem[];
  exportMode: PsdExportMode;
}

/* ---------- 导出进度 ---------- */

export interface PsdExportProgress {
  stage: PsdExportStage;
  progress: number;         // 0-1
  message: string;
}

/* ---------- 设计场景（V4 元数据） ---------- */

export interface DesignSceneLayer {
  id: string;
  name: string;
  role: 'background' | 'subject' | 'text' | 'shadow' | 'deco' | 'vector';
  boundingBox?: { x: number; y: number; width: number; height: number };
  imageDataUrl?: string;
  textContent?: string;
  maskScore?: number;
  confidence?: number;
  children?: DesignSceneLayer[];
}

export interface DesignScene {
  version: string;
  width: number;
  height: number;
  layers: DesignSceneLayer[];
}

/* ---------- 导出结果 ---------- */

export interface PSDExportResult {
  success: boolean;
  psdBlob?: Blob;
  manifestBlob?: Blob;
  designScene?: DesignScene;
  qualityReport?: {
    score: number;
    label: string;
    details: Array<{
      category: string;
      score: number;
      label: string;
    }>;
  };
  error?: string;
}

/* ---------- 图层拖动位置 ---------- */

export interface LayerPosition {
  x: number;
  y: number;
}
