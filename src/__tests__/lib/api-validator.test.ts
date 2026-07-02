import { describe, it, expect } from 'vitest';
import { validateApiInputs, type FieldType } from '@/lib/api-validator';

describe('api-validator 模块', () => {
  // ========== validateApiInputs ==========
  describe('validateApiInputs', () => {
    // --- imageUrl ---
    it('imageUrl: 缺失时返回错误', () => {
      const err = validateApiInputs({}, { imageUrl: 'imageUrl' });
      expect(err).toBeTruthy();
      expect(err).toContain('imageUrl');
    });

    it('imageUrl: 非字符串返回错误', () => {
      const err = validateApiInputs({ imageUrl: 123 }, { imageUrl: 'imageUrl' });
      expect(err).toBeTruthy();
    });

    it('imageUrl: 合法http URL通过', () => {
      const err = validateApiInputs(
        { imageUrl: 'https://example.com/img.png' },
        { imageUrl: 'imageUrl' }
      );
      expect(err).toBeNull();
    });

    it('imageUrl: data:image/ 通过', () => {
      const err = validateApiInputs(
        { imageUrl: 'data:image/png;base64,abc' },
        { imageUrl: 'imageUrl' }
      );
      expect(err).toBeNull();
    });

    it('imageUrl: /uploads/ 路径通过', () => {
      const err = validateApiInputs(
        { imageUrl: '/uploads/test.png' },
        { imageUrl: 'imageUrl' }
      );
      expect(err).toBeNull();
    });

    it('imageUrl: ftp:// 不合法', () => {
      const err = validateApiInputs(
        { imageUrl: 'ftp://example.com/img.png' },
        { imageUrl: 'imageUrl' }
      );
      expect(err).toBeTruthy();
    });

    // --- optionalImageUrl ---
    it('optionalImageUrl: 缺失时通过', () => {
      const err = validateApiInputs({}, { imageUrl: 'optionalImageUrl' });
      expect(err).toBeNull();
    });

    it('optionalImageUrl: 有值时校验格式', () => {
      const err = validateApiInputs(
        { imageUrl: 'ftp://bad.url' },
        { imageUrl: 'optionalImageUrl' }
      );
      expect(err).toBeTruthy();
    });

    // --- prompt ---
    it('prompt: 空字符串返回错误', () => {
      const err = validateApiInputs({ prompt: '' }, { prompt: 'prompt' });
      expect(err).toBeTruthy();
    });

    it('prompt: 合法字符串通过', () => {
      const err = validateApiInputs({ prompt: 'a beautiful cat' }, { prompt: 'prompt' });
      expect(err).toBeNull();
    });

    it('prompt: 超长字符串返回错误', () => {
      const err = validateApiInputs(
        { prompt: 'x'.repeat(10001) },
        { prompt: 'prompt' }
      );
      expect(err).toBeTruthy();
    });

    // --- optionalPrompt ---
    it('optionalPrompt: 缺失时通过', () => {
      const err = validateApiInputs({}, { prompt: 'optionalPrompt' });
      expect(err).toBeNull();
    });

    it('optionalPrompt: 超长字符串返回错误', () => {
      const err = validateApiInputs(
        { prompt: 'x'.repeat(10001) },
        { prompt: 'optionalPrompt' }
      );
      expect(err).toBeTruthy();
    });

    // --- model ---
    it('model: 缺失时通过（可选字段）', () => {
      const err = validateApiInputs({}, { model: 'model' });
      expect(err).toBeNull();
    });

    it('model: 合法模型名通过', () => {
      const err = validateApiInputs(
        { model: 'dall-e-3' },
        { model: 'model' }
      );
      expect(err).toBeNull();
    });

    it('model: 含特殊字符返回错误', () => {
      const err = validateApiInputs(
        { model: 'model; DROP TABLE' },
        { model: 'model' }
      );
      expect(err).toBeTruthy();
    });

    // --- url ---
    it('url: 缺失返回错误', () => {
      const err = validateApiInputs({}, { url: 'url' });
      expect(err).toBeTruthy();
    });

    it('url: 合法https URL通过', () => {
      const err = validateApiInputs(
        { url: 'https://example.com' },
        { url: 'url' }
      );
      expect(err).toBeNull();
    });

    it('url: /开头的相对路径通过', () => {
      const err = validateApiInputs(
        { url: '/api/models' },
        { url: 'url' }
      );
      expect(err).toBeNull();
    });

    // --- videoUrl ---
    it('videoUrl: 合法https URL通过', () => {
      const err = validateApiInputs(
        { videoUrl: 'https://cdn.example.com/video.mp4' },
        { videoUrl: 'videoUrl' }
      );
      expect(err).toBeNull();
    });

    it('videoUrl: ftp协议不合法', () => {
      const err = validateApiInputs(
        { videoUrl: 'ftp://example.com/video.mp4' },
        { videoUrl: 'videoUrl' }
      );
      expect(err).toBeTruthy();
    });

    // --- id ---
    it('id: 缺失返回错误', () => {
      const err = validateApiInputs({}, { taskId: 'id' });
      expect(err).toBeTruthy();
    });

    it('id: 超长返回错误', () => {
      const err = validateApiInputs(
        { taskId: 'x'.repeat(257) },
        { taskId: 'id' }
      );
      expect(err).toBeTruthy();
    });

    it('id: 合法ID通过', () => {
      const err = validateApiInputs(
        { taskId: 'task-abc-123' },
        { taskId: 'id' }
      );
      expect(err).toBeNull();
    });

    // --- string ---
    it('string: 超长返回错误', () => {
      const err = validateApiInputs(
        { content: 'x'.repeat(50001) },
        { content: 'string' }
      );
      expect(err).toBeTruthy();
    });

    it('string: 合法长度通过', () => {
      const err = validateApiInputs(
        { content: 'normal text' },
        { content: 'string' }
      );
      expect(err).toBeNull();
    });

    // --- 多字段组合 ---
    it('多字段同时校验', () => {
      const err = validateApiInputs(
        { imageUrl: 'https://example.com/img.png', prompt: 'test' },
        { imageUrl: 'imageUrl', prompt: 'prompt' }
      );
      expect(err).toBeNull();
    });

    it('多字段其中一个失败', () => {
      const err = validateApiInputs(
        { imageUrl: 'ftp://bad.url', prompt: 'test' },
        { imageUrl: 'imageUrl', prompt: 'prompt' }
      );
      expect(err).toContain('imageUrl');
    });

    it('空schema始终通过', () => {
      const err = validateApiInputs({}, {});
      expect(err).toBeNull();
    });

    it('空body但schema有required字段时返回错误', () => {
      const err = validateApiInputs({}, { prompt: 'prompt' });
      expect(err).toBeTruthy();
    });
  });
});
