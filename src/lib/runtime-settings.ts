import { dbGetSystemSetting } from '@/lib/db-storage';

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
}

export async function getRuntimeSettings(): Promise<{
  initialCredits: number;
  imageMaxSizeMB: number;
  imageMaxEdge: number;
  defaultImageModel: string;
  defaultChatModel: string;
  defaultVideoModel: string;
  maxVideoDuration: number;
  videoGenerationEnabled: boolean;
  threeDModelEnabled: boolean;
}> {
  const [initialCredits, imageMaxSizeMB, imageMaxEdge, defaultImageModel, defaultChatModel, defaultVideoModel, maxVideoDuration, videoEnabled, threeDEnabled] = await Promise.all([
    dbGetSystemSetting('initialCredits'),
    dbGetSystemSetting('imageMaxSizeMB'),
    dbGetSystemSetting('imageMaxEdge'),
    dbGetSystemSetting('defaultImageModel'),
    dbGetSystemSetting('defaultChatModel'),
    dbGetSystemSetting('defaultVideoModel'),
    dbGetSystemSetting('maxVideoDuration'),
    dbGetSystemSetting('videoGenerationEnabled'),
    dbGetSystemSetting('3dModelEnabled'),
  ]);
  return {
    initialCredits: numberSetting(initialCredits, 0, 0, 100_000),
    imageMaxSizeMB: numberSetting(imageMaxSizeMB, 20, 1, 100),
    imageMaxEdge: numberSetting(imageMaxEdge, 2048, 256, 8192),
    defaultImageModel: String(defaultImageModel ?? ''),
    defaultChatModel: String(defaultChatModel ?? ''),
    defaultVideoModel: String(defaultVideoModel ?? ''),
    maxVideoDuration: numberSetting(maxVideoDuration, 15, 1, 15),
    videoGenerationEnabled: String(videoEnabled ?? 'true') !== 'false',
    threeDModelEnabled: String(threeDEnabled ?? 'true') !== 'false',
  };
}
