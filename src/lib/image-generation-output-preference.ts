import type { ImageOutputPreference } from '@/lib/image-generation-output';

const STORAGE_KEY = 'wujie_image_output_preferences';
const DEFAULT_PREFERENCE: ImageOutputPreference = {
  background: 'auto',
  outputFormat: 'png',
};

type PreferenceMap = Record<string, ImageOutputPreference>;

function getStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

function isPreference(value: unknown): value is ImageOutputPreference {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ImageOutputPreference>;
  return ['auto', 'transparent', 'opaque'].includes(candidate.background || '')
    && ['png', 'jpeg', 'webp'].includes(candidate.outputFormat || '');
}

function readMap(storage: Storage): PreferenceMap {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed as PreferenceMap : {};
  } catch {
    return {};
  }
}

export function readImageOutputPreference(
  modelId: string,
  storageOverride?: Storage,
): ImageOutputPreference {
  const storage = storageOverride || getStorage();
  if (!storage || !modelId) return { ...DEFAULT_PREFERENCE };
  const saved = readMap(storage)[modelId];
  return isPreference(saved) ? { ...saved } : { ...DEFAULT_PREFERENCE };
}

export function writeImageOutputPreference(
  modelId: string,
  preference: ImageOutputPreference,
  storageOverride?: Storage,
): void {
  const storage = storageOverride || getStorage();
  if (!storage || !modelId || !isPreference(preference)) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      ...readMap(storage),
      [modelId]: preference,
    }));
  } catch {
    // Storage can be unavailable in private mode; generation still works in-memory.
  }
}
