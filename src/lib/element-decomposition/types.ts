export type ElementDecomposeOutputMode = 'board' | 'layers' | 'both';

export type ElementBranchStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface ElementDecomposeRequest {
  projectId: string;
  sourceImageId: string;
  sourceVersionId?: string;
  imageUrl: string;
  outputMode: ElementDecomposeOutputMode;
  board: {
    aspectRatio: string;
    background: 'light-gray' | 'transparent';
    providerId?: string;
    modelId?: string;
  };
  layers: {
    engine: 'smart' | 'cloud' | 'local';
    providerId?: string;
    modelId?: string;
    requireTransparentSubject?: boolean;
  };
}

export interface FrozenElementSource {
  sourceImageId: string;
  sourceVersionId?: string;
  canonicalUrl: string;
  sha256: string;
  width: number;
  height: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  buffer: Buffer;
}
