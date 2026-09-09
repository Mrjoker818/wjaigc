import {
  dbCreatePlatformExportPresetVersion,
  dbListPlatformExportPresets,
  dbSetPlatformExportPresetEnabled,
} from '@/lib/db-storage';
import type {
  CreatePlatformExportPresetVersionInput,
  FrozenPlatformExportPreset,
  PlatformExportPreset,
} from './types';

const DEFAULT_PLATFORM_EXPORT_PRESETS: readonly PlatformExportPreset[] = Object.freeze([
  {
    id: 'instagram-post',
    version: 1,
    platform: 'instagram',
    usage: 'post',
    label: 'Instagram 帖子',
    width: 1080,
    height: 1080,
    recommendedFormat: 'jpeg',
    supportsTransparency: false,
    enabled: true,
  },
  {
    id: 'instagram-story',
    version: 1,
    platform: 'instagram',
    usage: 'story',
    label: 'Instagram 快拍',
    width: 1080,
    height: 1920,
    recommendedFormat: 'jpeg',
    supportsTransparency: false,
    enabled: true,
  },
  {
    id: 'xiaohongshu-note',
    version: 1,
    platform: 'xiaohongshu',
    usage: 'note',
    label: '小红书笔记',
    width: 1242,
    height: 1660,
    recommendedFormat: 'jpeg',
    supportsTransparency: false,
    enabled: true,
  },
  {
    id: 'douyin-cover',
    version: 1,
    platform: 'douyin',
    usage: 'cover',
    label: '抖音竖版封面',
    width: 1080,
    height: 1920,
    recommendedFormat: 'jpeg',
    supportsTransparency: false,
    enabled: true,
  },
]);

export class PlatformExportPresetError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PlatformExportPresetError';
  }
}

function presetReference(preset: Pick<PlatformExportPreset, 'id' | 'version'>): string {
  return `${preset.id}-v${preset.version}`;
}

function freezePreset(preset: PlatformExportPreset): FrozenPlatformExportPreset {
  return Object.freeze({ ...preset });
}

export async function listAllPlatformExportPresets(): Promise<PlatformExportPreset[]> {
  let stored: PlatformExportPreset[];
  try {
    stored = await dbListPlatformExportPresets();
  } catch (error) {
    throw new PlatformExportPresetError(
      'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE',
      error instanceof Error ? error.message : 'Platform export preset storage is unavailable',
    );
  }
  const versions = new Map<string, PlatformExportPreset>();
  for (const preset of DEFAULT_PLATFORM_EXPORT_PRESETS) {
    versions.set(presetReference(preset), { ...preset });
  }
  for (const preset of stored) {
    versions.set(presetReference(preset), { ...preset });
  }
  return [...versions.values()].sort((left, right) => (
    left.id.localeCompare(right.id) || left.version - right.version
  ));
}

export async function listEnabledPlatformExportPresets(): Promise<PlatformExportPreset[]> {
  const all = await listAllPlatformExportPresets();
  return all.filter(preset => preset.enabled);
}

export async function freezePlatformExportPresets(
  references: readonly string[],
): Promise<FrozenPlatformExportPreset[]> {
  const all = await listAllPlatformExportPresets();
  const byReference = new Map(all.map(preset => [presetReference(preset), preset]));
  return references.map(reference => {
    if (!/^.+-v[1-9]\d*$/.test(reference)) {
      throw new PlatformExportPresetError(
        'PLATFORM_EXPORT_PRESET_REFERENCE_INVALID',
        `Invalid platform export preset reference: ${reference}`,
      );
    }
    const preset = byReference.get(reference);
    if (!preset) {
      throw new PlatformExportPresetError(
        'PLATFORM_EXPORT_PRESET_NOT_FOUND',
        `Platform export preset not found: ${reference}`,
      );
    }
    return freezePreset(preset);
  });
}

export async function createPlatformExportPresetVersion(
  input: CreatePlatformExportPresetVersionInput,
): Promise<PlatformExportPreset> {
  try {
    return await dbCreatePlatformExportPresetVersion(input);
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'PLATFORM_EXPORT_PRESET_VERSION_CONFLICT') {
      throw new PlatformExportPresetError(
        'PLATFORM_EXPORT_PRESET_VERSION_CONFLICT',
        `Platform export preset version conflicts with another write: ${input.id}`,
      );
    }
    throw new PlatformExportPresetError(
      'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE',
      'Platform export preset storage is unavailable',
    );
  }
}

export async function setPlatformExportPresetEnabled(
  id: string,
  version: number,
  enabled: boolean,
): Promise<PlatformExportPreset> {
  const [preset] = await freezePlatformExportPresets([`${id}-v${version}`]);
  const updated = { ...preset, enabled };
  try {
    await dbSetPlatformExportPresetEnabled(preset, enabled);
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'PLATFORM_EXPORT_PRESET_VERSION_CONFLICT') {
      throw new PlatformExportPresetError(
        'PLATFORM_EXPORT_PRESET_VERSION_CONFLICT',
        `Platform export preset version conflicts with another write: ${id}-v${version}`,
      );
    }
    throw new PlatformExportPresetError(
      'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE',
      'Platform export preset storage is unavailable',
    );
  }
  return updated;
}
