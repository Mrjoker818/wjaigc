import { describe, it, expect } from 'vitest';
import {
  classifyModelFamily,
  getModelCapabilities,
  modelSupports,
  filterRequestForModel,
  repairSizeForModel,
  shouldUseResponsesAPI,
  shouldUseGeminiChatRoute,
} from '@/lib/model-capabilities';

describe('model-capabilities', () => {
  describe('classifyModelFamily', () => {
    it('should classify GPT Image models', () => {
      expect(classifyModelFamily('gpt-image-1')).toBe('gpt-image');
    });

    it('should classify DALL-E 3 models', () => {
      expect(classifyModelFamily('dall-e-3')).toBe('dalle3');
    });

    it('should classify Flux models', () => {
      expect(classifyModelFamily('flux-pro-1.1')).toBe('flux');
    });

    it('should classify Stable Diffusion models', () => {
      expect(classifyModelFamily('stable-diffusion-xl')).toBe('stable-diffusion');
    });

    it('should classify Gemini image models', () => {
      expect(classifyModelFamily('gemini-2.5-flash-image')).toBe('gemini-image');
    });

    it('should return other for unknown models', () => {
      expect(classifyModelFamily('unknown-model-xyz')).toBe('other');
    });
  });

  describe('getModelCapabilities', () => {
    it('should return capabilities for known models', () => {
      const caps = getModelCapabilities('gpt-image-1');
      expect(caps).toBeDefined();
      expect(caps.family).toBe('gpt-image');
    });

    it('should return default capabilities for unknown models', () => {
      const caps = getModelCapabilities('unknown-model-xyz');
      expect(caps).toBeDefined();
    });
  });

  describe('modelSupports', () => {
    it('should return boolean for capability check', () => {
      const result = modelSupports('gpt-image-1', 'supportsBackground');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('filterRequestForModel', () => {
    it('should filter request based on model capabilities', () => {
      const request = {
        model: 'flux-pro-1.1',
        prompt: 'test',
        size: '1024x1024',
      };
      const filtered = filterRequestForModel('flux-pro-1.1', request);
      expect(filtered).toBeDefined();
      expect(filtered.prompt).toBe('test');
    });
  });

  describe('repairSizeForModel', () => {
    it('should return null for valid sizes or a repaired string', () => {
      const result = repairSizeForModel('gpt-image-1', '1024x1024');
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });

  describe('shouldUseResponsesAPI', () => {
    it('should return true for GPT Image models', () => {
      expect(shouldUseResponsesAPI('gpt-image-1')).toBe(true);
    });

    it('should return false for DALL-E 3', () => {
      expect(shouldUseResponsesAPI('dall-e-3')).toBe(false);
    });
  });

  describe('shouldUseGeminiChatRoute', () => {
    it('should return true for Gemini image models', () => {
      expect(shouldUseGeminiChatRoute('gemini-2.5-flash-image')).toBe(true);
    });

    it('should return false for non-Gemini models', () => {
      expect(shouldUseGeminiChatRoute('gpt-image-1')).toBe(false);
    });
  });
});
