import { dbGetSystemSetting } from '@/lib/db-storage';

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
}

export async function getRuntimeSettings(): Promise<{
  initialCredits: number;
  imageMaxSizeMB: number;
  maxVideoDuration: number;
  videoGenerationEnabled: boolean;
  threeDModelEnabled: boolean;
}> {
  const [initialCredits, imageMaxSizeMB, maxVideoDuration, videoEnabled, threeDEnabled] = await Promise.all([
    dbGetSystemSetting('initialCredits'),
    dbGetSystemSetting('imageMaxSizeMB'),
    dbGetSystemSetting('maxVideoDuration'),
    dbGetSystemSetting('videoGenerationEnabled'),
    dbGetSystemSetting('3dModelEnabled'),
  ]);
  return {
    initialCredits: numberSetting(initialCredits, 0, 0, 100_000),
    imageMaxSizeMB: numberSetting(imageMaxSizeMB, 20, 1, 100),
    maxVideoDuration: numberSetting(maxVideoDuration, 30, 1, 600),
    videoGenerationEnabled: String(videoEnabled ?? 'true') !== 'false',
    threeDModelEnabled: String(threeDEnabled ?? 'true') !== 'false',
  };
}
