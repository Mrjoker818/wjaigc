export type EffectReverseTaskStatus =
  | 'queued'
  | 'analyzing'
  | 'correcting'
  | 'exporting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export type NormalizedQuad = [
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
];

export type EffectReverseRegionKind =
  | 'wall'
  | 'floor'
  | 'ceiling'
  | 'object'
  | 'text'
  | 'material'
  | 'custom';

export interface EffectReverseRegion {
  id: string;
  kind: EffectReverseRegionKind;
  label: string;
  points: NormalizedPoint[];
  visible: boolean;
  locked: boolean;
  inferred: boolean;
}

export interface EffectReverseSessionInput {
  projectId: string;
  sourceImageId: string;
  sourceVersionId: string;
  imageUrl: string;
  perspective: NormalizedQuad;
  regions: EffectReverseRegion[];
  instruction?: string;
}

export interface EffectReverseTaskResult {
  correctedImageUrl?: string;
  exportUrl?: string;
  regions?: EffectReverseRegion[];
}

export interface EffectReverseTaskRecord {
  taskId: string;
  userId: string;
  status: EffectReverseTaskStatus;
  progress: number;
  label: string;
  createdAt: number;
  updatedAt: number;
  result?: EffectReverseTaskResult;
  error?: string;
}
