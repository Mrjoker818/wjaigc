import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  LayerModeControl,
  layerEditorPhaseLabel,
} from '@/components/psd-editor/PsdLayerEditor';
import PsdLayerEditor from '@/components/psd-editor/PsdLayerEditor';
import { LayerInspector } from '@/components/psd-editor/LayerInspector';
import type { DesignLayer } from '@/lib/psd-export';

describe('PSD layer editor hybrid controls', () => {
  it('renders all three explicit engine modes', () => {
    const markup = renderToStaticMarkup(createElement(LayerModeControl, {
      value: 'smart',
      disabled: false,
      onChange: () => {},
    }));

    expect(markup).toContain('智能');
    expect(markup).toContain('云端');
    expect(markup).toContain('本地');
    expect(markup).toContain('aria-pressed="true"');
  });

  it('shows real provider phases rather than synthetic loading copy', () => {
    expect(layerEditorPhaseLabel('waiting-for-pear')).toBe('Pear 正在生成 PSD');
    expect(layerEditorPhaseLabel('running-local-fallback')).toBe('正在运行本地增强分层');
  });

  it('renders the initial engine choice without requiring a browser global', () => {
    const markup = renderToStaticMarkup(createElement(PsdLayerEditor, {
      imageUrl: '/source.png',
      onClose: () => {},
    }));

    expect(markup).toContain('开始分层');
    expect(markup).toContain('PSD 分层编辑器');
  });

  it('shows the original image size for a layer clipped by the document boundary', () => {
    const layer = {
      id: 'outside-layer',
      name: '越界图层',
      role: 'subject',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      offsetX: -10,
      offsetY: -5,
      sourceWidth: 100,
      sourceHeight: 80,
      boundingBox: { x: 0, y: 0, width: 90, height: 75 },
      maskScore: 1,
      edgeScore: 1,
      warnings: [],
      reconstructMode: 'raster-safe',
    } as DesignLayer;

    const markup = renderToStaticMarkup(createElement(LayerInspector, { layer }));

    expect(markup).toContain('>-10,-5<');
    expect(markup).toContain('>100x80<');
    expect(markup).not.toContain('>90x75<');
  });
});
