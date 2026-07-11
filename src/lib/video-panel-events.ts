export const VIDEO_PANEL_OPEN_EVENT = 'wujie:open-video-panel';

export function requestVideoPanelOpen(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(VIDEO_PANEL_OPEN_EVENT));
}
