import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  LayerModeControl,
  layerEditorPhaseLabel,
} from '@/components/psd-editor/PsdLayerEditor';
import PsdLayerEditor from '@/components/psd-editor/PsdLayerEditor';

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
});
