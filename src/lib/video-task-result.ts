export interface CompletedVideoTaskResult {
  videoUrl?: string;
  videoThumbnailUrl?: string;
  result: Record<string, unknown>;
}

export function getCompletedVideoTaskResult(taskResult: Record<string, unknown> | undefined): CompletedVideoTaskResult {
  const result = { ...(taskResult || {}) };
  delete result.apiKey;
  delete result.apiBaseUrl;
  const videoUrl = typeof result.videoUrl === 'string' && result.videoUrl ? result.videoUrl : undefined;
  const videoThumbnailUrl = typeof result.videoThumbnailUrl === 'string' && result.videoThumbnailUrl
    ? result.videoThumbnailUrl
    : undefined;

  return { videoUrl, videoThumbnailUrl, result };
}
