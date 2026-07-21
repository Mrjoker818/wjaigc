import { dbGetSystemSetting } from '@/lib/db-storage';

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
}

export interface RuntimeSettings {
  initialCredits: number;
  imageMaxSizeMB: number;
  imageMaxEdge: number;
  defaultImageModel: string;
  defaultChatModel: string;
  defaultVideoModel: string;
  quickCreateImageModel: string;
  quickCreateChatModel: string;
  quickCreateAutoModelRouting: boolean;
  maxVideoDuration: number;
  videoGenerationEnabled: boolean;
  threeDModelEnabled: boolean;
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const [
    initialCredits,
    imageMaxSizeMB,
    imageMaxEdge,
    defaultImageModel,
    defaultChatModel,
    defaultVideoModel,
    quickCreateImageModel,
    quickCreateChatModel,
    quickCreateAutoModelRouting,
    maxVideoDuration,
    videoEnabled,
    threeDEnabled,
  ] = await Promise.all([
    dbGetSystemSetting('initialCredits'),
    dbGetSystemSetting('imageMaxSizeMB'),
    dbGetSystemSetting('imageMaxEdge'),
    dbGetSystemSetting('defaultImageModel'),
    dbGetSystemSetting('defaultChatModel'),
    dbGetSystemSetting('defaultVideoModel'),
    dbGetSystemSetting('quickCreateImageModel'),
    dbGetSystemSetting('quickCreateChatModel'),
    dbGetSystemSetting('quickCreateAutoModelRouting'),
    dbGetSystemSetting('maxVideoDuration'),
    dbGetSystemSetting('videoGenerationEnabled'),
    dbGetSystemSetting('3dModelEnabled'),
  ]);
  const resolvedDefaultImageModel = String(defaultImageModel ?? '').trim();
  const resolvedDefaultChatModel = String(defaultChatModel ?? '').trim();
  const configuredQuickImageModel = String(quickCreateImageModel ?? '').trim();
  const configuredQuickChatModel = String(quickCreateChatModel ?? '').trim();

  return {
    initialCredits: numberSetting(initialCredits, 0, 0, 100_000),
    imageMaxSizeMB: numberSetting(imageMaxSizeMB, 20, 1, 100),
    imageMaxEdge: numberSetting(imageMaxEdge, 2048, 256, 8192),
    defaultImageModel: resolvedDefaultImageModel,
    defaultChatModel: resolvedDefaultChatModel,
    defaultVideoModel: String(defaultVideoModel ?? '').trim(),
    quickCreateImageModel: configuredQuickImageModel,
    quickCreateChatModel: configuredQuickChatModel,
    quickCreateAutoModelRouting: String(quickCreateAutoModelRouting ?? 'true') !== 'false',
    maxVideoDuration: numberSetting(maxVideoDuration, 15, 1, 15),
    videoGenerationEnabled: String(videoEnabled ?? 'true') !== 'false',
    threeDModelEnabled: String(threeDEnabled ?? 'true') !== 'false',
  };
}
