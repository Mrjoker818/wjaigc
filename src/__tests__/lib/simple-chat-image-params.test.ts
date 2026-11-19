import { describe, expect, it } from 'vitest';
import { fitImageParams, parseImageCount, parseImageRequest, planImageToolJobs } from '@/lib/simple-chat-image-params';
import { getProviderAspectRatios } from '@/lib/canvas-generation-group';

describe('parseImageRequest', () => {
  it('reads explicit ratios, Chinese ratio phrasing and orientation words', () => {
    expect(parseImageRequest('画一张 16:9 的城市夜景').aspectRatio).toBe('16:9');
    expect(parseImageRequest('比例 3比4 的海报').aspectRatio).toBe('3:4');
    expect(parseImageRequest('做一张竖版手机壁纸').aspectRatio).toBe('9:16');
    expect(parseImageRequest('正方形头像').aspectRatio).toBe('1:1');
  });

  it('turns pixel sizes into a reduced ratio and a resolution tier', () => {
    const parsed = parseImageRequest('尺寸 1920x1080');
    expect(parsed).toMatchObject({ aspectRatio: '16:9', resolution: '2K', width: 1920, height: 1080 });
    expect(parseImageRequest('3840×2160 的壁纸').resolution).toBe('4K');
  });

  it('reads resolution tiers and quality words', () => {
    expect(parseImageRequest('出一张 4K 的图').resolution).toBe('4K');
    expect(parseImageRequest('高清产品图').resolution).toBe('2K');
    expect(parseImageRequest('要高质量、细节丰富').quality).toBe('high');
    expect(parseImageRequest('先出个草图').quality).toBe('low');
    expect(parseImageRequest('一只猫')).toEqual({});
  });
});

describe('parseImageCount', () => {
  it('reads how many variations the user asked for', () => {
    expect(parseImageCount('生成3张方案')).toBe(3);
    expect(parseImageCount('来两张不同的海报')).toBe(2);
    expect(parseImageCount('多出几张看看')).toBe(3);
    expect(parseImageCount('画一只猫')).toBe(1);
  });

  it('caps the count at the allowed maximum', () => {
    expect(parseImageCount('给我10张')).toBe(4);
    expect(parseImageCount('生成6个版本', 4)).toBe(4);
  });
});

describe('fitImageParams', () => {
  it('always returns a ratio the selected model supports', () => {
    const model = 'doubao-seedream-5-0-pro-260628';
    const hint = 'api_x PearAPI 图像 https://api.pearapi.ai';
    const supported = getProviderAspectRatios(model, hint);
    const fitted = fitImageParams({ aspectRatio: '21:9' }, '1:1', model, hint);
    if (supported.length > 0) expect(supported).toContain(fitted.aspectRatio);
    const kept = fitImageParams({}, '16:9', model, hint);
    if (supported.includes('16:9')) expect(kept.aspectRatio).toBe('16:9');
  });

  it('explains when a requested value had to be changed', () => {
    const model = 'doubao-seedream-5-0-pro-260628';
    const hint = 'PearAPI https://api.pearapi.ai';
    const supported = getProviderAspectRatios(model, hint);
    if (supported.length > 0 && !supported.includes('7:3')) {
      expect(fitImageParams({ aspectRatio: '7:3' }, '1:1', model, hint).notes.join('')).toContain('7:3');
    }
  });
});

describe('planImageToolJobs', () => {
  const call = (id: string, args: Record<string, unknown> = { prompt: id }) => ({ id, arguments: JSON.stringify(args) });

  it('runs one image per tool call', () => {
    const jobs = planImageToolJobs([call('cat'), call('dog')], '分别画一只猫和一只狗');
    expect(jobs.map(job => job.call.id)).toEqual(['cat', 'dog']);
    expect(jobs[1].args.prompt).toBe('dog');
  });

  it('repeats a single call as many times as the user asked', () => {
    expect(planImageToolJobs([call('poster')], '生成3张方案')).toHaveLength(3);
    expect(planImageToolJobs([call('poster')], '画一张海报')).toHaveLength(1);
  });

  it('ignores a model-chosen count and caps the turn', () => {
    expect(planImageToolJobs([call('a', { prompt: 'a', image_count: 4 })], '画一只猫')).toHaveLength(1);
    expect(planImageToolJobs(['a', 'b', 'c', 'd', 'e', 'f'].map(id => call(id)), '画六个')).toHaveLength(4);
  });

  it('treats unreadable arguments as empty', () => {
    expect(planImageToolJobs([{ id: 'x', arguments: '{oops' }], '画')[0].args).toEqual({});
  });
});
