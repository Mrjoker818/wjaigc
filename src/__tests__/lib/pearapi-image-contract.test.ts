import { describe, expect, it } from 'vitest';
import { PROFILE_PEARAPI, adjustRequestForProfile } from '@/lib/api-compatibility';

// PearAPI 图像契约来源：https://pearapi.apifox.cn（gpt-image-2 图像生成 api-533519595，
// 逐字核对请求体字段）：size 接受比例（"1:1"/"16:9"）或像素（"1024x1024"）；
// aspect_ratio 为 size 的兼容写法；resolution 1K/2K/4K（默认 2K）；n 1–4；
// quality low/medium/high/auto；output_format png/jpeg/webp；task_type sync/async；
// response_format url/b64_json。文档未定义 width/height/size_px 派生字段。

describe('PearAPI image profile contract', () => {
  it('keeps the ratio size and resolution fields the docs define', () => {
    const { body, endpoint } = adjustRequestForProfile({
      model: 'gpt-image-2', prompt: '一只穿宇航服的小猫', size: '16:9', resolution: '2K', quality: 'high',
    }, PROFILE_PEARAPI);
    expect(endpoint).toBe('/images/generations');
    expect(body).toMatchObject({ size: '16:9', resolution: '2K', quality: 'high' });
  });

  it('does not attach undocumented width/height/size_px pixel hints', () => {
    const { body } = adjustRequestForProfile({
      model: 'gpt-image-2', prompt: 'p', size: '16:9', resolution: '2K',
    }, PROFILE_PEARAPI);
    expect(body).not.toHaveProperty('width');
    expect(body).not.toHaveProperty('height');
    expect(body).not.toHaveProperty('size_px');
  });

  it('declares the documented task_type/response_format submit defaults', () => {
    expect(PROFILE_PEARAPI.extraBodyParams).toEqual({ task_type: 'sync', response_format: 'url' });
  });

  it('routes edits through the documented /images/edits endpoint', () => {
    const { endpoint } = adjustRequestForProfile({
      model: 'gpt-image-2', prompt: 'p', size: '1:1',
    }, PROFILE_PEARAPI, { hasImage: true, isEditEndpoint: true });
    expect(endpoint).toBe('/images/edits');
  });

  it('sends references as the documented images array', () => {
    const { body } = adjustRequestForProfile({
      model: 'nano-banana-2', prompt: 'p', size: '1:1', image: 'https://e/a.png', image_urls: ['https://e/a.png', 'https://e/b.png'],
    }, PROFILE_PEARAPI, { hasReferenceImages: true });
    expect(body.images).toEqual(['https://e/a.png', 'https://e/b.png']);
    expect(body).not.toHaveProperty('image');
    expect(body).not.toHaveProperty('image_urls');
  });

  it('drops fields and values a model does not document', () => {
    const grok = adjustRequestForProfile({
      model: 'grok-imagine-image-2.0', prompt: 'p', size: '16:9', resolution: '2K', quality: 'high',
    }, PROFILE_PEARAPI).body;
    expect(grok).not.toHaveProperty('size');
    expect(grok).not.toHaveProperty('resolution');
    expect(grok).not.toHaveProperty('quality');
    const nano = adjustRequestForProfile({
      model: 'nano-banana', prompt: 'p', size: '1:1', resolution: '4K', quality: 'high', image_count: 6,
    }, PROFILE_PEARAPI).body;
    expect(nano).not.toHaveProperty('resolution');
    expect(nano).not.toHaveProperty('quality');
    expect(nano.n).toBe(4);
    const zImage = adjustRequestForProfile({
      model: 'z-image', prompt: 'p', size: '1:1', image_urls: ['https://e/a.png'],
    }, PROFILE_PEARAPI, { hasReferenceImages: true }).body;
    expect(zImage).not.toHaveProperty('images');
  });

  it('keeps undocumented local model ids unchanged apart from the image fields', () => {
    const { body } = adjustRequestForProfile({
      model: 'gpt-image-2-4k', prompt: 'p', size: '1:1', resolution: '4K', quality: 'high',
    }, PROFILE_PEARAPI);
    expect(body).toMatchObject({ resolution: '4K', quality: 'high' });
  });
});
