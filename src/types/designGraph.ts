export type LayerKind =
  | 'image'
  | 'vector'
  | 'text'
  | 'shape'
  | 'group'
  | 'background'
  | 'mask'
  | 'effect';

export type VectorEngine = 'none' | 'vtracer' | 'starvector' | 'sam-layer' | 'manual';

export interface LayerBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayerTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface LayerNode {
  id: string;
  parentId?: string | null;
  name: string;
  type: LayerKind;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';
  bbox: LayerBBox;
  transform: LayerTransform;
  zIndex: number;
  imageUrl?: string;
  svg?: string;
  text?: string;
  fontFamily?: string;
  fill?: string;
  maskUrl?: string;
  children?: string[];
  semantic?: {
    label?: string;
    confidence?: number;
    prompt?: string;
    model?: string;
    engine?: VectorEngine;
    tags?: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface SceneGraph {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: LayerNode[];
  selectedLayerIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DesignDocument {
  schema: 'wujie.design.v1';
  id: string;
  name: string;
  scene: SceneGraph;
  assets: Array<{
    id: string;
    type: 'image' | 'svg' | 'mask' | 'font';
    url?: string;
    data?: string;
    name?: string;
  }>;
  history?: Array<{
    id: string;
    label: string;
    createdAt: number;
  }>;
  metadata?: Record<string, unknown>;
}
