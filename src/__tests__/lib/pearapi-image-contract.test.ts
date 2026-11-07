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
});
