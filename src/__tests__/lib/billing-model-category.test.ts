import { describe, expect, it } from 'vitest';
import { getBillingModelCategory } from '@/lib/billing-model-category';

describe('billing model category', () => {
  it.each(['image', '3d', undefined])('groups %s as an image model', modelType => {
    expect(getBillingModelCategory(modelType)).toBe('image');
  });

  it.each(['chat', 'vlm', 'universal', 'general'])('groups %s as an LLM model', modelType => {
    expect(getBillingModelCategory(modelType)).toBe('llm');
  });

  it('groups video providers separately', () => {
    expect(getBillingModelCategory('video')).toBe('video');
  });

  it.each(['imageEdit', 'upscaler', 'vectorize', 'layer', 'removebg'])('groups %s as an edit model', modelType => {
    expect(getBillingModelCategory(modelType)).toBe('edit');
  });
});
