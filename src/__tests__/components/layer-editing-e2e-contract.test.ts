import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('layer editing browser contract', () => {
  it('exposes stable image-toolbar and editor controls', () => {
    const canvas = source('src/components/infinite-canvas.tsx');
    const editor = source('src/components/psd-editor/PsdLayerEditor.tsx');

    expect(canvas).toContain("'canvas-edit-elements'");
    expect(canvas).toContain('testId: \'canvas-edit-elements\'');
    expect(canvas).toContain('data-testid="canvas-image-upload-input"');
    for (const selector of [
      'layer-editor',
      'layer-start',
      'layer-progress',
      'layer-cancel',
      'layer-error',
      'layer-retry',
      'layer-count',
    ]) {
      expect(editor).toContain(`data-testid=\"${selector}\"`);
    }
    expect(editor).toContain('data-layer-engine={item.value}');
  });

  it('exposes stable layer-row operations and node configuration fields', () => {
    const layerRow = source('src/components/psd-editor/LayerRow.tsx');
    const nodeEditor = source('src/components/node-editor.tsx');

    expect(layerRow).toContain('data-layer-row={layer.id}');
    expect(layerRow).toContain('data-layer-action="visibility"');
    expect(layerRow).toContain('data-layer-action="lock"');
    expect(nodeEditor).toContain('data-node-type={t.type}');
    expect(nodeEditor).toContain('data-node-field={field.key}');
  });

  it('guards the layer submission synchronously against rapid duplicate clicks', () => {
    const editor = source('src/components/psd-editor/PsdLayerEditor.tsx');

    expect(editor).toContain('layeringInFlightRef.current');
    expect(editor).toContain('if (layeringInFlightRef.current) return;');
    expect(editor).toContain('layeringInFlightRef.current = true;');
    expect(editor).toContain('layeringInFlightRef.current = false;');
  });
});
