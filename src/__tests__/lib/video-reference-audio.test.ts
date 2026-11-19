import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildVideoSubmitRequest, resolvePearVideoMaterials } from '@/lib/video-api';
import { referenceAudioLimit } from '@/lib/video-reference-audio';
import { signPublicAudioPath, verifyPublicAudioParts, verifyPublicMediaParts } from '@/lib/public-media-link';

// Reference audio contracts:
// - Pear Seedance 2.x: reference_contents items { type: 'audio', media_url }; 2.0 / 2.5 take 3 audios, Mini 10
//   (pearapi.apifox.cn/api-533519667 / -669 / -671 / -673, 2026-11-19).
// - APIMart: audio_urls; 2.0 at most 3, 2.5 at most 10; first/last-frame roles cannot carry audio and audio needs
//   a reference image (docs.apib.ai seedance-2-0 / seedance-2-5 generation, 2026-11-19).

const AUDIO = 'https://example.com/voice.mp3';
const FRAME = 'https://example.com/first.png';
const HERO = 'https://example.com/hero.png';

function pear(model: string, extra: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(buildVideoSubmitRequest('pearapi-video', {
    baseUrl: 'https://api.pearapi.ai', apiKey: 'k', model, prompt: '说台词', ...extra,
  }).body);
}

function apimart(model: string, extra: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(buildVideoSubmitRequest('apimart-video', {
    baseUrl: 'https://api.apib.ai', apiKey: 'k', model, prompt: '说台词', ...extra,
  }).body);
}

describe('reference audio limits', () => {
  it('only allows the endpoints that document reference audio', () => {
    expect(referenceAudioLimit('pearapi-video', 'doubao-seedance-2-0-260128')).toBe(3);
    expect(referenceAudioLimit('pearapi-video', 'doubao-seedance-2-0-mini-260615')).toBe(10);
    expect(referenceAudioLimit('pearapi-video', 'hailuo-2.3')).toBe(0);
    expect(referenceAudioLimit('apimart-video', 'seedance-2.0-fast')).toBe(3);
    expect(referenceAudioLimit('apimart-video', 'seedance-2.5')).toBe(10);
    expect(referenceAudioLimit('apimart-video', 'seedance-2.0-face')).toBe(0);
    expect(referenceAudioLimit('ai-link', 'doubao-seedance-2-0-260128')).toBe(0);
  });
});

describe('Pear reference audio', () => {
  it('sends the first frame as a reference image next to the audio', () => {
    const body = pear('doubao-seedance-2-0-fast-260128', { imageUrl: FRAME, mode: 'image2video-first', referenceAudios: [AUDIO] });
    expect(body.generation_mode).toBe('reference2video');
    expect(body.reference_contents).toEqual([{ type: 'image', media_url: FRAME }, { type: 'audio', media_url: AUDIO }]);
  });

  it('rejects audio without an image, over the limit, or on a model without audio', () => {
    const model = 'doubao-seedance-2-0-260128';
    expect(() => resolvePearVideoMaterials({ model, referenceAudios: [AUDIO] })).toThrow();
    expect(() => resolvePearVideoMaterials({ model, imageUrl: FRAME, referenceAudios: [AUDIO, AUDIO, AUDIO, AUDIO] })).toThrow();
    expect(() => resolvePearVideoMaterials({ model: 'hailuo-2.3', imageUrl: FRAME, referenceAudios: [AUDIO] })).toThrow();
    expect(() => resolvePearVideoMaterials({ model, imageUrl: FRAME, referenceAudios: [''] })).toThrow();
  });

  it('leaves requests without audio as they were', () => {
    expect(resolvePearVideoMaterials({ model: 'doubao-seedance-2-0-260128', imageUrl: FRAME })).toMatchObject({
      generationMode: 'image2video', imageUrl: FRAME, referenceAudios: [],
    });
  });
});

describe('APIMart reference audio', () => {
  it('sends audio_urls and every image, frames included, as image_urls', () => {
    const body = apimart('seedance-2.0', { imageUrl: FRAME, characterReferences: [HERO], referenceAudios: [AUDIO] });
    expect(body.audio_urls).toEqual([AUDIO]);
    expect(body.image_urls).toEqual([FRAME, HERO]);
    expect(body).not.toHaveProperty('image_with_roles');
  });

  it('refuses audio the model does not take', () => {
    expect(() => apimart('seedance-2.0-face', { imageUrl: FRAME, referenceAudios: [AUDIO] })).toThrow('不支持参考音频');
    expect(() => apimart('seedance-2.0', { imageUrl: FRAME, referenceAudios: [AUDIO, AUDIO, AUDIO, AUDIO] })).toThrow('最多接受 3 段');
  });
});

describe('signed voice sample links', () => {
  const FILE = `ttsdb_1795000000000_0123abcd_${'a'.repeat(64)}.mp3`;
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips the owner and file, and rejects a changed owner or an expired link', () => {
    vi.stubEnv('WUJIE_PUBLIC_MEDIA_SECRET', 'x'.repeat(40));
    const now = 1_800_000_000_000;
    const link = signPublicAudioPath(FILE, 'user_1', { now })!;
    expect(link).toMatch(/^\/api\/public\/media\/\d+\/[\w-]+\/generated-audio\/user_1\//);
    const parts = link.split('/').slice(4);
    expect(verifyPublicAudioParts(parts, now)).toEqual({ ownerId: 'user_1', filename: FILE, contentType: 'audio/mpeg' });
    expect(verifyPublicAudioParts([...parts.slice(0, 3), 'user_2', parts[4]], now)).toBeNull();
    expect(verifyPublicAudioParts(parts, now + 3 * 60 * 60 * 1000)).toBeNull();
    // The image route never accepts these links.
    expect(verifyPublicMediaParts(parts, now)).toBeNull();
  });

  it('signs nothing without a secret or for names outside the audio store', () => {
    expect(signPublicAudioPath(FILE, 'user_1')).toBeNull();
    vi.stubEnv('WUJIE_PUBLIC_MEDIA_SECRET', 'x'.repeat(40));
    expect(signPublicAudioPath('../etc/passwd', 'user_1')).toBeNull();
    expect(signPublicAudioPath(FILE, '../admin')).toBeNull();
  });
});
