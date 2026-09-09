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
