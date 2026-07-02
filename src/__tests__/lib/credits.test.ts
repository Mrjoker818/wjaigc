import { describe, it, expect } from 'vitest';
import {
  getImageModelCredits,
  getVideoModelCreditsPerSecond,
  getChatModelCredits,
  getOtherOperationCredits,
  calculateCreditCost,
  creditsToCNY,
} from '@/lib/credits';

describe('Credits 模块', () => {
  // ========== getImageModelCredits ==========
  describe('getImageModelCredits', () => {
    it('空模型返回默认10积分', () => {
      expect(getImageModelCredits('')).toBe(10);
    });

    it('精确匹配 DALL-E 3', () => {
      expect(getImageModelCredits('dall-e-3')).toBe(28);
    });

    it('精确匹配带quality参数', () => {
      expect(getImageModelCredits('dall-e-3', 'hd')).toBe(56);
      expect(getImageModelCredits('dall-e-3', 'standard')).toBe(28);
    });

    it('精确匹配 GPT Image 2', () => {
      expect(getImageModelCredits('gpt-image-2')).toBe(60);
      expect(getImageModelCredits('gpt-image-2', 'low')).toBe(40);
      expect(getImageModelCredits('gpt-image-2', 'high')).toBe(100);
    });

    it('模糊匹配包含关键词的模型', () => {
      const credits = getImageModelCredits('my-custom-dall-e-model');
      expect(credits).toBeGreaterThan(0);
    });

    it('关键词推断：flux', () => {
      expect(getImageModelCredits('flux-schnell')).toBe(4);
    });

    it('关键词推断：seedream', () => {
      expect(getImageModelCredits('my-seedream-model')).toBe(6);
    });

    it('关键词推断：midjourney', () => {
      expect(getImageModelCredits('midjourney-v6')).toBe(35);
    });

    it('未知模型返回默认10积分', () => {
      expect(getImageModelCredits('totally-unknown-model-xyz')).toBe(10);
    });
  });

  // ========== getVideoModelCreditsPerSecond ==========
  describe('getVideoModelCreditsPerSecond', () => {
    it('空模型返回默认30积分/秒', () => {
      expect(getVideoModelCreditsPerSecond('')).toBe(30);
    });

    it('关键词推断：kling', () => {
      expect(getVideoModelCreditsPerSecond('kling-v3')).toBe(30);
    });

    it('关键词推断：sora', () => {
      expect(getVideoModelCreditsPerSecond('sora-1.0')).toBe(80);
    });

    it('关键词推断：vidu', () => {
      expect(getVideoModelCreditsPerSecond('vidu-q1')).toBe(25);
    });
  });

  // ========== getChatModelCredits ==========
  describe('getChatModelCredits', () => {
    it('空模型返回默认2积分', () => {
      expect(getChatModelCredits('')).toBe(2);
    });

    it('关键词推断：gpt-4', () => {
      expect(getChatModelCredits('gpt-4-turbo')).toBe(10);
    });

    it('关键词推断：gemini-flash', () => {
      expect(getChatModelCredits('gemini-2-flash')).toBe(2);
    });

    it('关键词推断：deepseek', () => {
      expect(getChatModelCredits('deepseek-v3')).toBe(3);
    });
  });

  // ========== getOtherOperationCredits ==========
  describe('getOtherOperationCredits', () => {
    it('未知操作返回默认10积分', () => {
      expect(getOtherOperationCredits('unknown_op')).toBe(10);
    });
  });

  // ========== calculateCreditCost ==========
  describe('calculateCreditCost', () => {
    it('图像生成操作', () => {
      const cost = calculateCreditCost('image_generate', 'dall-e-3');
      expect(cost).toBe(28);
    });

    it('视频生成操作（按时长计算）', () => {
      const cost = calculateCreditCost('video_generate', 'kling-v3', { durationSeconds: 5 });
      expect(cost).toBe(30 * 5);
    });

    it('聊天操作', () => {
      const cost = calculateCreditCost('chat', 'gpt-4-turbo');
      expect(cost).toBe(10);
    });
  });

  // ========== creditsToCNY ==========
  describe('creditsToCNY', () => {
    it('100积分 = ¥1.00', () => {
      expect(creditsToCNY(100)).toBe('¥1.00');
    });

    it('0积分 = ¥0.00', () => {
      expect(creditsToCNY(0)).toBe('¥0.00');
    });

    it('28积分 = ¥0.28', () => {
      expect(creditsToCNY(28)).toBe('¥0.28');
    });
  });
});
