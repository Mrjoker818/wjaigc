export type AnnotationStatus =
  | 'draft'
  | 'ready'
  | 'stale'
  | 'running'
  | 'done'
  | 'failed';

export type AnnotationType =
  | 'semantic-object'
  | 'region'
  | 'brush'
  | 'arrow'
  | 'text';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface AnnotationRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NormalizedAnnotationGeometry =
  | {
      kind: 'semantic-object';
      region: AnnotationRegion;
      polygon?: NormalizedPoint[];
    }
  | {
      kind: 'region';
      region: AnnotationRegion;
    }
  | {
      kind: 'brush';
      points: NormalizedPoint[];
      width: number;
    }
  | {
      kind: 'arrow';
      start: NormalizedPoint;
      end: NormalizedPoint;
    }
  | {
      kind: 'text';
      point: NormalizedPoint;
    };

export interface CanvasAnnotationV2 {
  id: string;
  projectId: string;
  sourceImageId: string;
  sourceVersionId: string;
  type: AnnotationType;
  geometry: NormalizedAnnotationGeometry;
  label?: string;
  instruction?: string;
  confidence?: number;
  maskAssetId?: string;
  overlayAssetId?: string;
  status: AnnotationStatus;
  createdAt: number;
  updatedAt: number;
}

export interface EditIntentBundle {
  id: string;
  projectId: string;
  sourceImageId: string;
  sourceVersionId: string;
  annotationIds: string[];
  annotations: CanvasAnnotationV2[];
  prompt: string;
  modelId: string;
  providerId: string;
  idempotencyKey: string;
  createdAt: number;
}

export interface LegacyCanvasAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  targetImageId: string | null;
  region?: AnnotationRegion;
  brushMaskDataUrl?: string;
  brushColor?: string;
  status?: string;
  createdAt: number;
}
