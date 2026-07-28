import { describe, expect, it } from 'vitest';
import {
  buildRecraftGenerationPayload,
  extractRecraftVectorSources,
  validateRecraftVectorSourceCount,
} from '@/lib/recraft-vector-request';

describe('Recraft vector request contract', () => {
  it('sends one native batch request while removing controls unsupported by V4.1', () => {
    const payload = buildRecraftGenerationPayload({
      model: 'recraftv4_1_pro_vector',
      prompt: 'A precise geometric tea brand mark',
      size: '14:10',
      count: 6,
      style: 'Vector art',
      negativePrompt: 'blur',
      noText: true,
      artisticLevel: 5,
      colors: ['#D4AF37', '#111111'],
      backgroundColor: '#FFFFFF',
      randomSeed: 42,
    });

    expect(payload).toMatchObject({
      model: 'recraftv4_1_pro_vector',
      size: '14:10',
      n: 6,
      response_format: 'b64_json',
      random_seed: 42,
      controls: {
        colors: [
          { rgb: [212, 175, 55] },
          { rgb: [17, 17, 17] },
        ],
        background_color: { rgb: [255, 255, 255] },
      },
    });
    expect(payload).not.toHaveProperty('style');
    expect(payload).not.toHaveProperty('negative_prompt');
    expect(payload.controls ?? {}).not.toHaveProperty('no_text');
    expect(payload.controls ?? {}).not.toHaveProperty('artistic_level');
  });

  it('keeps V3-only style, negative prompt and artistic controls for V3 Vector', () => {
    const payload = buildRecraftGenerationPayload({
      model: 'recraftv3_vector',
      prompt: 'A monoline cafe wordmark',
      size: '1:1',
      count: 2,
      style: 'Line art',
      negativePrompt: 'photo, texture',
      noText: false,
      artisticLevel: 3,
    });

    expect(payload).toMatchObject({
      n: 2,
      style: 'Line art',
      negative_prompt: 'photo, texture',
      controls: {
        no_text: false,
        artistic_level: 3,
      },
    });
  });

  it('supports V2 negative prompts without exposing V3-only controls', () => {
    const payload = buildRecraftGenerationPayload({
      model: 'recraftv2_vector',
      prompt: 'A playful doodle icon',
      size: '1:1',
      count: 1,
      negativePrompt: 'photo',
      noText: true,
      artisticLevel: 5,
    });

    expect(payload.negative_prompt).toBe('photo');
    expect(payload.controls ?? {}).not.toHaveProperty('no_text');
    expect(payload.controls ?? {}).not.toHaveProperty('artistic_level');
  });

  it('clamps count and ignores invalid color values', () => {
    const payload = buildRecraftGenerationPayload({
      model: 'recraftv4_vector',
      prompt: 'Icon',
      size: '1:1',
      count: 99,
      colors: ['red', '#00FF88'],
    });

    expect(payload.n).toBe(6);
    expect(payload.controls).toEqual({ colors: [{ rgb: [0, 255, 136] }] });
  });
});

describe('Recraft vector response contract', () => {
  it('extracts every SVG result instead of keeping only the first item', () => {
    const first = Buffer.from('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>').toString('base64');
    const second = Buffer.from('<svg viewBox="0 0 20 20"><circle r="5"/></svg>').toString('base64');

    const results = extractRecraftVectorSources({
      data: [
        { b64_json: first, id: 'explore-1' },
        { b64_json: second, image_id: 'explore-2' },
      ],
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ sourceImageId: 'explore-1' });
    expect(results[0].inlineSvg).toContain('<path');
    expect(results[1]).toMatchObject({ sourceImageId: 'explore-2' });
    expect(results[1].inlineSvg).toContain('<circle');
  });

  it('supports vectorize image responses and URL responses for safe server download', () => {
    expect(extractRecraftVectorSources({
      image: { url: 'https://example.com/result.svg' },
    })).toEqual([
      { url: 'https://example.com/result.svg', sourceImageId: undefined },
    ]);
  });

  it('rejects result-count mismatches and excessive provider output', () => {
    const source = { inlineSvg: '<svg viewBox="0 0 1 1"/>' };
    expect(() => validateRecraftVectorSourceCount([source], 2)).toThrow(/2.*1|数量/);
    expect(() => extractRecraftVectorSources({
      data: Array.from({ length: 9 }, () => ({ svg: source.inlineSvg })),
    })).toThrow(/过多|too many/i);
  });
});
