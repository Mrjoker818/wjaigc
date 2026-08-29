import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  evaluateLayerQuality,
  normalizeLayerSourceCanvas,
} from '@/lib/layer-decomposition/quality-gate';
import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';

describe('layer reconstruction quality gate', () => {
  it('normalizes a same-aspect source into the PSD document coordinate space', async () => {
    const source = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#ef1f1f' },
    }).png().toBuffer();

    const normalized = await normalizeLayerSourceCanvas(source, 10, 10);
    const metadata = await sharp(normalized.buffer).metadata();

    expect(normalized.normalized).toBe(true);
    expect(metadata).toMatchObject({ width: 10, height: 10 });
  });

  it('does not stretch a source whose aspect ratio differs from the PSD document', async () => {
    const source = await sharp({
      create: { width: 12, height: 8, channels: 4, background: '#ef1f1f' },
    }).png().toBuffer();

    const normalized = await normalizeLayerSourceCanvas(source, 10, 10);
    const metadata = await sharp(normalized.buffer).metadata();

    expect(normalized.normalized).toBe(false);
    expect(metadata).toMatchObject({ width: 12, height: 8 });
  });

  it('reconstructs Pear PSD layers from Photoshop top-to-bottom order', async () => {
    const background = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#ffffff' },
    }).png().toBuffer();
    const subject = await sharp({
      create: { width: 4, height: 4, channels: 4, background: '#ef1f1f' },
    }).png().toBuffer();
    const source = await sharp(background)
      .composite([{ input: subject, left: 2, top: 2 }])
      .png()
      .toBuffer();
    const layers: EditableLayerAsset[] = [
      {
        id: 'subject',
        name: '产品主体',
        role: 'subject',
        imageUrl: '/subject.png',
        width: 4,
        height: 4,
        offsetX: 2,
        offsetY: 2,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        source: 'pear-psd',
      },
      {
        id: 'background',
        name: '背景',
        role: 'background',
        imageUrl: '/background.png',
        width: 8,
        height: 8,
        offsetX: 0,
        offsetY: 0,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        source: 'pear-psd',
      },
    ];

    const quality = await evaluateLayerQuality(source, layers, {
      loadLayer: async (layer) => (
        layer.id === 'subject' ? subject : background
      ),
    });

    expect(quality.status).toBe('pass');
    expect(quality.metrics.reconstructionMae).toBe(0);
  });

  it('fails when recomposition differs materially from the source', async () => {
    const source = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#ef1f1f' },
    }).png().toBuffer();
    const wrong = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#ffffff' },
    }).png().toBuffer();
    const layer: EditableLayerAsset = {
      id: 'background',
      name: '背景',
      role: 'background',
      imageUrl: '/wrong.png',
      width: 8,
      height: 8,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      source: 'local-enhanced',
    };

    const quality = await evaluateLayerQuality(source, [layer], {
      loadLayer: async () => wrong,
    });
    expect(quality.status).toBe('fail');
    expect(quality.warnings).toContain('RECONSTRUCTION_ERROR_HIGH');
  });
});
