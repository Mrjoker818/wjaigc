import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FONT_STYLE_CATEGORIES,
  GRAPHIC_MAP,
  MATERIAL_MAP,
  SCENE_MAP,
  STROKE_MAP,
  buildBlackOnWhitePrompt,
  buildJimengPrompt,
  buildTransparentLogoPrompt,
  type StyleCategory,
  type StyleSubCategory,
} from '@/app/api/font-design/plan/constants';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('font-design plan constants', () => {
  it('preserves the style catalog and lookup values consumed by all three routes', () => {
    const representativeSubStyle: StyleSubCategory = FONT_STYLE_CATEGORIES[4].subStyles[8];
    const representativeCategory: StyleCategory = FONT_STYLE_CATEGORIES[4];

    expect(FONT_STYLE_CATEGORIES.map((category) => category.id)).toEqual([
      'smart-recommend',
      'commercial-title',
      'text-logo',
      'trendy-young',
      'oriental',
      'emotional',
      'tech-future',
      'texture-fx',
      'industry',
    ]);
    expect(representativeCategory.name).toBe('东方国风');
    expect(representativeSubStyle).toEqual({
      id: 'oriental-bamboo',
      name: '竹节笔意',
      prompt: '竹节形态融入笔画',
    });
    expect(SCENE_MAP['KV主标题']).toBe('品牌KV主视觉标题字，需要强烈视觉冲击力和品牌辨识度');
    expect(STROKE_MAP['圆角']).toBe('笔画圆润处理');
    expect(GRAPHIC_MAP['云气']).toBe('云纹融入笔画');
    expect(MATERIAL_MAP['金属质感']).toBe('金属材质');
  });

  it('preserves mapped, fallback, and enhanced Jimeng prompt output byte for byte', () => {
    const mappedPrompt = buildJimengPrompt({
      text: '无界',
      scene: 'KV主标题',
      style: '竹节笔意',
      strokeOptions: ['圆角', '连笔'],
      graphicElements: ['云气', '几何'],
      color: '鎏金',
      background: '纯黑',
      material: '金属质感',
      ratio: '横版16:9',
      jimengEnhanced: true,
    });
    const fallbackPrompt = buildJimengPrompt({
      text: '界',
      scene: '自定义场景',
      style: '实验风格',
      strokeOptions: [],
      graphicElements: [],
      color: '白色',
      background: '留白',
      material: '自定义材质',
      ratio: '1:1',
      jimengEnhanced: false,
    });

    expect(mappedPrompt).toHaveLength(315);
    expect(sha256(mappedPrompt)).toBe('6665d521dadaf676f507159c74f48c8d0bd1740e80fa7d36582d5eb25d3b9673');
    expect(fallbackPrompt).toHaveLength(215);
    expect(sha256(fallbackPrompt)).toBe('1a121558626af0c86e83cbfe520465282f3418048a37006258104b97a4b0d37b');
  });

  it('preserves specialized prompt output byte for byte', () => {
    expect(sha256(buildBlackOnWhitePrompt('无界')))
      .toBe('5ec59eb07a3cd7a57ac28f58916e358d3a2fe9ae3886a9628144cfec8f6dd4aa');
    expect(sha256(buildTransparentLogoPrompt('无界')))
      .toBe('d06deeadd01dbf232d28e6401d30dcafea0b45fe6a3ff2ddad415dcd0429a0f0');
  });
});
