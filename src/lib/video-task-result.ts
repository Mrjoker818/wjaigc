export interface CompletedVideoTaskResult {
  videoUrl?: string;
  result: Record<string, unknown>;
}

export function getCompletedVideoTaskResult(taskResult: Record<string, unknown> | undefined): CompletedVideoTaskResult {
  const result = { ...(taskResult || {}) };
  delete result.apiKey;
  delete result.apiBaseUrl;
  const videoUrl = typeof result.videoUrl === 'string' && result.videoUrl ? result.videoUrl : undefined;

  return { videoUrl, result };
}
