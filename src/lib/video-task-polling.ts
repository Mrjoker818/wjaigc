export const DIRECT_VIDEO_MAX_POLL_ATTEMPTS = 400;
export const DIRECT_VIDEO_MAX_POLL_DURATION_MS = 20 * 60 * 1000;

export function hasDirectVideoPollingTimedOut(
  attempts: number,
  elapsedMs: number,
): boolean {
  return attempts >= DIRECT_VIDEO_MAX_POLL_ATTEMPTS
    || elapsedMs >= DIRECT_VIDEO_MAX_POLL_DURATION_MS;
}

const VIDEO_STATUS_SEGMENT = /^(?:提交中|排队中|生成中)(?:\.\.\.)?$/u;

/**
 * Rebuilds a processing label from its stable prefix (mode · model) so each
 * poll replaces the trailing status segment instead of appending to it.
 */
export function buildVideoProgressLabel(previous: string | undefined, running: boolean): string {
  const segments = (previous ?? '').split('·').map(part => part.trim()).filter(Boolean);
  while (segments.length > 0 && VIDEO_STATUS_SEGMENT.test(segments[segments.length - 1])) segments.pop();
  return [...(segments.length > 0 ? segments : ['视频生成']), `${running ? '生成中' : '排队中'}...`].join(' · ');
}
