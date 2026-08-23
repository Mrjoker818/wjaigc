// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  readImageOutputPreference,
  writeImageOutputPreference,
} from '@/lib/image-generation-output-preference';

describe('image-generation-output-preference', () => {
  let storage: Storage;

  beforeEach(() => {
    const values = new Map<string, string>();
    storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => Array.from(values.keys())[index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, value); },
    };
  });

  it('stores output preferences independently for each model', () => {
    writeImageOutputPreference('gpt-image-2', {
      background: 'transparent',
      outputFormat: 'png',
    }, storage);
    writeImageOutputPreference('dall-e-3', {
      background: 'opaque',
      outputFormat: 'png',
    }, storage);

    expect(readImageOutputPreference('gpt-image-2', storage).background).toBe('transparent');
    expect(readImageOutputPreference('dall-e-3', storage).background).toBe('opaque');
  });

  it('falls back to automatic PNG output when storage is corrupted', () => {
    storage.setItem('wujie_image_output_preferences', '{broken');
    expect(readImageOutputPreference('gpt-image-2', storage)).toEqual({
      background: 'auto',
      outputFormat: 'png',
    });
  });
});
