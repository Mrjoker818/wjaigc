export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface PlatformExportPreset {
  id: string;
  version: number;
  platform: string;
  usage: string;
  label: string;
  width: number;
  height: number;
  recommendedFormat: ExportFormat;
  supportsTransparency: boolean;
  enabled: boolean;
}

export type FrozenPlatformExportPreset = Readonly<PlatformExportPreset>;

export type CreatePlatformExportPresetVersionInput = Omit<PlatformExportPreset, 'version'>;

export interface MultiPlatformExportInput {
  sourceAssetVersionIds: string[];
  targetPresetIds: string[];
  fit: 'cover' | 'contain';
  background: 'transparent' | `#${string}`;
  namingTemplate: string;
}

export interface ExportSourceDescriptor {
  versionId: string;
  assetName: string;
  hasTransparency: boolean;
}

export interface ExportPlanningContext {
  userId: string;
  projectId: string;
  projectName: string;
  skillId: string;
  skillVersion: number;
}

export interface ExportFilenameContext {
  project: string;
  asset: string;
  platform: string;
  usage: string;
  width: number;
  height: number;
  index: number;
  outputFormat: ExportFormat;
  sourceVersionId: string;
  presetId: string;
  presetVersion: number;
}

export interface ExportPlanOutput {
  sourceVersionId: string;
  presetId: string;
  presetVersion: number;
  platform: string;
  usage: string;
  width: number;
  height: number;
  outputFormat: ExportFormat;
  outputFilename: string;
  pixelCount: number;
}

export interface ExportDigestPayload {
  userId: string;
  projectId: string;
  projectName: string;
  skillId: string;
  skillVersion: number;
  sourceAssetVersionIds: string[];
  sources: ExportSourceDescriptor[];
  frozenPresets: PlatformExportPreset[];
  fit: MultiPlatformExportInput['fit'];
  background: MultiPlatformExportInput['background'];
  namingTemplate: string;
}

export interface ExportPlan {
  requestDigest: string;
  digestPayload: ExportDigestPayload;
  outputCount: number;
  totalPixels: number;
  outputs: ExportPlanOutput[];
}
