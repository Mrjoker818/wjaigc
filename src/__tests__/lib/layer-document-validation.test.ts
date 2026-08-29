import { describe, expect, it } from 'vitest';

import {
  LayerDocumentError,
  readLayerDocumentContent,
  validateLayerDocumentRequestSize,
} from '@/lib/layer-documents/validation';

function validContent(layerCount = 1) {
  return {
    schemaVersion: 1,
    title: '产品图分层',
    width: 1280,
    height: 1280,
    exportMode: 'pro',
    layers: Array.from({ length: layerCount }, (_, order) => ({
      id: `layer-${order}`,
      name: `图层 ${order}`,
      role: order === 0 ? 'background' : 'subject',
      imageUrl: `/api/serve-upload/layers/layer-${order}.png`,
      width: 1280,
      height: 1280,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      locked: false,
      order,
      source: 'pear-psd',
    })),
  };
}

describe('layer document validation', () => {
  it('normalizes a complete schema version 1 document', () => {
    expect(readLayerDocumentContent(validContent())).toEqual(validContent());
  });

  it('accepts at most 64 layers and rejects the 65th', () => {
    expect(readLayerDocumentContent(validContent(64)).layers).toHaveLength(64);
    expect(() => readLayerDocumentContent(validContent(65))).toThrowError(
      expect.objectContaining({ code: 'LAYER_DOCUMENT_TOO_MANY_LAYERS' }),
    );
  });

  it.each([
    ['data URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['blob URL', 'blob:https://example.com/id'],
    ['external URL', 'https://example.com/layer.png'],
    ['private media', '/api/serve-upload/users/secret.png'],
  ])('rejects %s image references', (_label, imageUrl) => {
    const content = validContent();
    content.layers[0].imageUrl = imageUrl;
    expect(() => readLayerDocumentContent(content)).toThrowError(
      expect.objectContaining({ code: 'LAYER_DOCUMENT_MEDIA_UNSAFE' }),
    );
  });

  it.each([
    ['width', Number.NaN],
    ['height', Number.POSITIVE_INFINITY],
    ['offsetX', 1_000_001],
    ['offsetY', -1_000_001],
    ['opacity', 1.01],
    ['order', 0.5],
  ])('rejects unsafe numeric field %s', (field, value) => {
    const content = validContent();
    Object.assign(content.layers[0], { [field]: value });
    expect(() => readLayerDocumentContent(content)).toThrow(LayerDocumentError);
  });

  it('rejects duplicate ids and duplicate order values', () => {
    const duplicateId = validContent(2);
    duplicateId.layers[1].id = duplicateId.layers[0].id;
    expect(() => readLayerDocumentContent(duplicateId)).toThrowError(
      expect.objectContaining({ code: 'LAYER_DOCUMENT_DUPLICATE_LAYER' }),
    );

    const duplicateOrder = validContent(2);
    duplicateOrder.layers[1].order = duplicateOrder.layers[0].order;
    expect(() => readLayerDocumentContent(duplicateOrder)).toThrowError(
      expect.objectContaining({ code: 'LAYER_DOCUMENT_DUPLICATE_ORDER' }),
    );
  });

  it('enforces string and request body limits', () => {
    const longName = validContent();
    longName.layers[0].name = 'x'.repeat(129);
    expect(() => readLayerDocumentContent(longName)).toThrowError(
      expect.objectContaining({ code: 'LAYER_DOCUMENT_STRING_TOO_LONG' }),
    );

    expect(() => validateLayerDocumentRequestSize('x'.repeat(60 * 1024 + 1))).toThrowError(
      expect.objectContaining({ code: 'LAYER_DOCUMENT_BODY_TOO_LARGE' }),
    );
  });

  it('rejects unsupported schema and export modes', () => {
    expect(() => readLayerDocumentContent({ ...validContent(), schemaVersion: 2 })).toThrowError(
      expect.objectContaining({ code: 'LAYER_DOCUMENT_SCHEMA_UNSUPPORTED' }),
    );
    expect(() => readLayerDocumentContent({ ...validContent(), exportMode: 'raw' })).toThrowError(
      expect.objectContaining({ code: 'LAYER_DOCUMENT_EXPORT_MODE_INVALID' }),
    );
  });
});
