export type CanvasShareStatus = 'active' | 'revoked' | 'expired';

export type CanvasShareErrorCode =
  | 'CANVAS_SHARE_DISABLED'
  | 'CANVAS_SHARE_UNAUTHORIZED'
  | 'CANVAS_SHARE_NOT_FOUND'
  | 'CANVAS_SHARE_MEDIA_NOT_READY'
  | 'CANVAS_SHARE_PROJECT_CONFLICT'
  | 'CANVAS_SHARE_UNSUPPORTED_ELEMENT'
  | 'CANVAS_SHARE_DOWNLOAD_DISABLED'
  | 'CANVAS_SHARE_POLICY_CONFLICT'
  | 'CANVAS_SHARE_MEDIA_UNAVAILABLE';

export interface CanvasShareViewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface CanvasShareTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
}

export interface CanvasShareSafeDisplayMetadata {
  label?: string;
  altText?: string;
}

export interface CanvasShareRecord {
  id: string;
  ownerId: string;
  projectId: string;
  projectRevision: number;
  tokenHash: string;
  title: string;
  status: CanvasShareStatus;
  expiresAt: string | null;
  allowDownload: boolean;
  viewport: CanvasShareViewport;
  snapshotDigest: string;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CanvasShareItemRecord {
  id: string;
  shareId: string;
  placementId: string;
  assetId: string;
  assetVersionId: string;
  entityType: 'canvas-image' | 'canvas-video';
  assetKind: 'image' | 'video';
  transform: CanvasShareTransform;
  displayMetadata: CanvasShareSafeDisplayMetadata;
  mimeType: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  checksum: string | null;
  availability: 'ready';
  sortOrder: number;
  createdAt: string;
}

export interface CanvasSharePolicyPatch {
  expiresAt?: string | null;
  allowDownload?: boolean;
}

export interface CanvasSharePublicItem {
  itemRef: string;
  entityType: 'canvas-image' | 'canvas-video';
  assetKind: 'image' | 'video';
  transform: CanvasShareTransform;
  display: CanvasShareSafeDisplayMetadata;
  mimeType: string;
  width: number | null;
  height: number | null;
  mediaPath: string;
  downloadPath?: string;
}

export interface CanvasSharePublicDocument {
  title: string;
  revisionLabel: string;
  createdAt: string;
  allowDownload: boolean;
  viewport: CanvasShareViewport;
  items: CanvasSharePublicItem[];
}
