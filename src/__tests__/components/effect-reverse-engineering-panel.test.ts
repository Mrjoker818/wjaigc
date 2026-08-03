import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/effect-reverse-engineering-panel.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('EffectReverseEngineeringPanel contract', () => {
  it('renders a fixed isolated floating workspace with manual mode', () => {
    expect(source).toContain('data-popup="effect-reverse-engineering"');
    expect(source).toContain('data-testid="effect-reverse-engineering-panel"');
    expect(source).toContain('fixed z-[220]');
    expect(source).toContain('Manual structure mode');
    expect(source).toContain('onPointerDown={(event) => event.stopPropagation()}');
    expect(source).toContain('onWheel={(event) => event.stopPropagation()}');
  });

  it('requires four valid perspective points before correction', () => {
    expect(source).toContain('Set four valid perspective points first');
    expect(source).toContain('isValidPerspective');
    expect(source).toContain("action: 'correct'");
    expect(source).toContain('/api/effect-reverse-engineering');
  });

  it('shows task progress, supports cancellation, and returns results to the canvas', () => {
    expect(source).toContain('task.progress');
    expect(source).toContain("method: 'DELETE'");
    expect(source).toContain('onCanvasResult(payload.result)');
    expect(source).toContain('taskEventsClient.onTaskEvent');
    expect(source).toContain('pollTask');
  });

  it('supports manual regions and marks analyzer regions as inferred', () => {
    expect(source).toContain("inferred: false");
    expect(source).toContain("inferred: true");
    expect(source).toContain('Unavailable until an analyzer is configured');
    expect(source).toContain('Add manual region');
  });

  it('allows each perspective point to be adjusted before submission', () => {
    expect(source).toContain('movePerspectivePoint');
    expect(source).toContain('onPointerDown={(event) => startPointDrag');
    expect(source).toContain('setPoints((current) => current.map');
  });

  it('persists bounded window geometry and supports minimize and maximize', () => {
    expect(source).toContain('wujie.effect-reverse.window.v1');
    expect(source).toContain('sanitizeGeometry');
    expect(source).toContain('setMinimized');
    expect(source).toContain('setMaximized');
  });
});
