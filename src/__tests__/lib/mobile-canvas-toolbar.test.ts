import { describe, expect, it, vi } from 'vitest';

import {
  buildMobileCanvasToolbar,
  type CanvasToolbarAction,
} from '@/lib/mobile-canvas-toolbar';

function action(id: string, hidden = false): CanvasToolbarAction {
  return {
    id,
    label: id,
    group: 'test',
    hidden,
    onActivate: vi.fn(),
  };
}

describe('mobile canvas toolbar projection', () => {
  it('keeps five stable primary slots and every reachable action in the drawer', () => {
    const actions = [
      action('select'),
      action('pan'),
      action('upload'),
      action('generate'),
      action('annotation'),
      action('hidden-tool', true),
    ];

    const projection = buildMobileCanvasToolbar(actions);

    expect(projection.primary.map(item => item.id)).toEqual([
      'select',
      'pan',
      'upload',
      'zoom-status',
      'all-tools',
    ]);
    expect(new Set(projection.drawer.map(item => item.id))).toEqual(new Set([
      'select',
      'pan',
      'upload',
      'generate',
      'annotation',
    ]));
  });
});
