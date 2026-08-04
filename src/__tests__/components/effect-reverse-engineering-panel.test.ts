import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(
  resolve(process.cwd(), path),
  'utf8',
).replace(/\r\n/g, '\n');

const source = readSource('src/components/effect-reverse-engineering-panel.tsx');
const workspaceSource = readSource('src/components/effect-reverse-engineering/workspace.tsx');
const layerSource = readSource('src/components/effect-reverse-engineering/layer-panel.tsx');
const layerOperationsSource = readSource('src/lib/effect-reverse-engineering/layer-operations.ts');

describe('EffectReverseEngineeringPanel contract', () => {
  it('renders a fixed isolated floating workspace composed from three regions', () => {
    expect(source).toContain('data-popup="effect-reverse-engineering"');
    expect(source).toContain('data-testid="effect-reverse-engineering-panel"');
    expect(source).toContain('fixed z-[220]');
    expect(source).toContain('EffectReverseSourcePanel');
    expect(source).toContain('EffectReverseWorkspace');
    expect(source).toContain('EffectReverseLayerPanel');
    expect(layerSource).toContain('REVERSE_COPY.manualMode');
    expect(source).toContain('onPointerDown={(event) => event.stopPropagation()}');
    expect(source).toContain('onWheel={(event) => event.stopPropagation()}');
  });

  it('requires four valid perspective points before correction', () => {
    expect(source).toContain('REVERSE_COPY.invalidPerspective');
    expect(source).toContain('isValidPerspective');
    expect(source).toContain("action: 'correct'");
    expect(source).toContain('/api/effect-reverse-engineering');
  });

  it('shows task progress, supports cancellation, and returns results to the canvas', () => {
    expect(workspaceSource).toContain('task.progress');
    expect(source).toContain("method: 'DELETE'");
    expect(source).toContain('onCanvasResult(payload.result)');
    expect(source).toContain('taskEventsClient.onTaskEvent');
    expect(source).toContain('pollTask');
  });

  it('supports manual regions without fabricating analyzer output', () => {
    expect(layerOperationsSource).toContain('inferred: false');
    expect(layerSource).toContain('REVERSE_COPY.analyzerUnavailable');
    expect(layerSource).toContain('REVERSE_COPY.addRegion');
    expect(layerSource).not.toContain('inferred: true');
  });

  it('allows each perspective point to be adjusted before submission', () => {
    expect(workspaceSource).toContain('const updatePoint');
    expect(workspaceSource).toContain('setDragIndex(index)');
    expect(workspaceSource).toContain('onPointsChange(points.map');
  });

  it('persists bounded window geometry and supports minimize and maximize', () => {
    expect(source).toContain('wujie.effect-reverse.window.v1');
    expect(source).toContain('sanitizeGeometry');
    expect(source).toContain('setMinimized');
    expect(source).toContain('setMaximized');
  });

  it('uses Chinese window controls and task feedback', () => {
    expect(source).toContain('title={minimized ? REVERSE_COPY.restore : REVERSE_COPY.minimize}');
    expect(source).toContain('title={maximized ? REVERSE_COPY.restore : REVERSE_COPY.maximize}');
    expect(source).toContain('title={REVERSE_COPY.close}');
    expect(source).toContain('aria-label={REVERSE_COPY.resize}');
    expect(source).toContain('REVERSE_COPY.taskStatusFailed');
    expect(source).toContain('REVERSE_COPY.submissionFailed');
    expect(source).toContain('REVERSE_COPY.cancellationFailed');
    expect(source).toContain('label: REVERSE_COPY.queued');
  });
});
