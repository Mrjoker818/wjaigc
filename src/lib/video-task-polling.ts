export const DIRECT_VIDEO_MAX_POLL_ATTEMPTS = 400;
export const DIRECT_VIDEO_MAX_POLL_DURATION_MS = 20 * 60 * 1000;

export function hasDirectVideoPollingTimedOut(
  attempts: number,
  elapsedMs: number,
): boolean {
  return attempts >= DIRECT_VIDEO_MAX_POLL_ATTEMPTS
    || elapsedMs >= DIRECT_VIDEO_MAX_POLL_DURATION_MS;
}
