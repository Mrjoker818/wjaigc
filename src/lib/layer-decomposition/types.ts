export type LayerEngineMode = 'smart' | 'cloud' | 'local';

export type LayerTaskPhase =
  | 'reading-source'
  | 'submitting-pear'
  | 'waiting-for-pear'
  | 'downloading-psd'
  | 'extracting-psd'
  | 'refining-layers'
  | 'checking-quality'
  | 'running-local-fallback'
  | 'ready';

export type EditableLayerRole =
  | 'background'
  | 'subject'
  | 'text'
  | 'decoration'
  | 'shadow'
  | 'unknown';

export interface LayerDecompositionRequest {
  imageUrl: string;
  engine: LayerEngineMode;
  providerId?: string;
  modelId?: string;
}

export interface EditableLayerAsset {
  id: string;
  parentId?: string;
  name: string;
  role: EditableLayerRole;
  imageUrl: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  blendMode: string;
  visible: boolean;
  source: 'pear-psd' | 'local-enhanced';
  qualityWarnings?: string[];
}

export interface LayerQualityResult {
  status: 'pass' | 'warning';
  score: number;
  warnings: string[];
}

export interface LayerDecompositionResult {
  width: number;
  height: number;
  layers: EditableLayerAsset[];
  psdUrl?: string;
  engine: 'pear' | 'local';
  quality: LayerQualityResult;
}

export interface LayerTaskResponse {
  success: boolean;
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  phase?: LayerTaskPhase;
  progress: number;
  result?: LayerDecompositionResult;
  error?: { code: string; message: string; retryable: boolean };
}
