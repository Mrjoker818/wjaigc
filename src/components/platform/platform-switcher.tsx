'use client';

import type { MouseEvent } from 'react';
import { PLATFORMS, platformHref, type Platform } from '@/lib/platform-routes';

/**
 * Switches between the canvas, video and chat platforms, keeping the current project.
 * Each tab is a real link; `onNavigate` may handle a plain click in place (canvas and video share one page)
 * by returning true. Hidden when the user has fewer than two platforms.
 */
export function PlatformSwitcher({ current, platforms, projectId, dramaId, tone = 'dark', onNavigate }: {
  current: Platform;
  platforms: Platform[];
  projectId?: string | null;
  dramaId?: string | null;
  tone?: 'dark' | 'light';
  onNavigate?: (platform: Platform) => boolean;
}) {
  if (platforms.length < 2) return null;
  const click = (platform: Platform) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (platform === current) { event.preventDefault(); return; }
    // New-tab and modified clicks keep the browser's own behaviour.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (onNavigate?.(platform)) event.preventDefault();
  };
  return (
    <nav aria-label="切换平台" className="platform-switch" data-tone={tone}>
      {PLATFORMS.filter(item => platforms.includes(item.id)).map(item => (
        <a key={item.id} href={platformHref(item.id, { projectId, dramaId: item.id === 'video' ? dramaId : null })}
          className="platform-switch__tab" data-platform={item.id}
          aria-current={item.id === current ? 'page' : undefined} onClick={click(item.id)}>
          <span className="platform-switch__tally" aria-hidden="true" />
          {item.label}
        </a>
      ))}
    </nav>
  );
}
