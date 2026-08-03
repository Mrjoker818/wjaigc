import {
  alignReferenceDescriptions,
  compileReferenceConstraints,
} from '@/lib/reference-constraint-compiler';
import { describe, expect, it } from 'vitest';

describe('reference constraint compiler', () => {
  it('keeps descriptions aligned with their original reference image indexes', () => {
    expect(alignReferenceDescriptions(
      ['reference-1.png', 'reference-2.png', 'reference-3.png'],
      ['', 'blue porcelain lamp', ''],
    )).toEqual(['', 'blue porcelain lamp', '']);
  });

  it('compiles numbered English constraints for an English-oriented model', () => {
    const result = compileReferenceConstraints({
      providerId: 'pear',
      providerName: 'PearAPI 图像',
      modelId: 'gpt-image-2',
      referenceImages: ['reference-1.png', 'reference-2.png'],
      referenceDescriptions: ['linen studio backdrop', 'blue porcelain lamp'],
      referenceCategories: {
        '0': ['style', 'color'],
        '1': ['subject'],
      },
      referenceStrengths: [80, 90],
    });

    expect(result.language).toBe('en');
    expect(result.prompt).toContain('[REFERENCE #1]');
    expect(result.prompt).toContain('[REFERENCE #2]');
    expect(result.prompt).toContain('STYLE 80%');
    expect(result.prompt).toContain('COLOR 80%');
    expect(result.prompt).toContain('SUBJECT 90%');
    expect(result.prompt).toContain('blue porcelain lamp');
    expect(result.prompt).not.toContain('参考图 #1');
  });

  it('compiles Chinese constraints for a Chinese-oriented model', () => {
    const result = compileReferenceConstraints({
      providerId: 'volcengine',
      providerName: '火山方舟',
      modelId: 'doubao-seedream-5-0',
      referenceImages: ['reference-1.png'],
      referenceDescriptions: ['一盏蓝色陶瓷台灯'],
      referenceCategories: {
        '0': ['subject', 'detail'],
      },
      referenceStrengths: [85],
    });

    expect(result.language).toBe('zh');
    expect(result.prompt).toContain('[参考图 #1]');
    expect(result.prompt).toContain('主体 85%');
    expect(result.prompt).toContain('细节 85%');
    expect(result.prompt).toContain('一盏蓝色陶瓷台灯');
    expect(result.prompt).not.toContain('[REFERENCE #1]');
  });

  it('uses independently selected per-category strengths without merging reference images', () => {
    const result = compileReferenceConstraints({
      providerId: 'pear',
      providerName: 'PearAPI 图像',
      modelId: 'gpt-image-2',
      referenceImages: ['reference-1.png', 'reference-2.png'],
      referenceCategories: {
        '0': ['style', 'subject'],
        '1': ['subject'],
      },
      referenceCategoryStrengths: {
        '0': { style: 85, subject: 20 },
        '1': { subject: 95 },
      },
      referenceStrengths: [85, 95],
    });

    expect(result.prompt).toContain('[REFERENCE #1]');
    expect(result.prompt).toContain('STYLE 85%');
    expect(result.prompt).toContain('SUBJECT 20%');
    expect(result.prompt).toContain('[REFERENCE #2]');
    expect(result.prompt).toContain('SUBJECT 95%');
  });

  it('uses a compact bilingual fallback only when provider language is unknown', () => {
    const result = compileReferenceConstraints({
      providerId: 'custom-provider',
      providerName: 'Custom Gateway',
      modelId: 'image-model-x',
      referenceImages: ['reference-1.png'],
      referenceCategories: { '0': ['composition'] },
      referenceStrengths: [60],
    });

    expect(result.language).toBe('bilingual');
    expect(result.prompt).toContain('[REFERENCE #1 / 参考图 #1]');
    expect(result.prompt).toContain('COMPOSITION / 构图 60%');
  });
});
