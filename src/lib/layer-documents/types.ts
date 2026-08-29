import type { PSDExportMode } from '@/lib/psd-export';

export const LAYER_DOCUMENT_SCHEMA_VERSION = 1 as const;

export interface LayerDocumentSource {
  projectId: string;
  sourceImageId: string;
  sourceVersionId: string;
  imageUrl: string;
  taskId?: string;
}

export interface LayerDocumentLayer {
  id: string;
  name: string;
  role: string;
  imageUrl: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  blendMode: string;
  visible: boolean;
  locked: boolean;
  order: number;
  source: 'pear-psd' | 'local-enhanced';
}

export interface LayerDocumentContent {
  schemaVersion: typeof LAYER_DOCUMENT_SCHEMA_VERSION;
  title: string;
  width: number;
  height: number;
  exportMode: PSDExportMode;
  layers: LayerDocumentLayer[];
}

export interface LayerDocumentRecord {
  id: string;
  userId: string;
  projectId: string;
  sourceImageId: string;
  sourceVersionId: string;
  taskId: string;
  engine: 'pear' | 'local';
  schemaVersion: typeof LAYER_DOCUMENT_SCHEMA_VERSION;
  revision: number;
  content: LayerDocumentContent;
  createdAt: number;
  updatedAt: number;
}
