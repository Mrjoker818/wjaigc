import { describe, it, expect } from 'vitest';
import {
  validateImageUrl,
  validateVideoUrl,
  validatePrompt,
  validateImageSize,
  validateModelName,
  validateAspectRatio,
  validateStrength,
  validateAll,
  validateApiKeyFormat,
} from '@/lib/input-validation';

describe('input-validation', () => {
  describe('validateImageUrl', () => {
    it('should accept valid https URLs', () => {
      expect(validateImageUrl('https://example.com/image.png')).toBeNull();
    });

    it('should accept valid http URLs', () => {
      expect(validateImageUrl('http://localhost:3000/test.png')).toBeNull();
    });

    it('should accept valid data URLs', () => {
      expect(validateImageUrl('data:image/png;base64,abc123')).toBeNull();
    });

    it('should accept relative paths starting with /api/', () => {
      expect(validateImageUrl('/api/serve-upload/test.png')).toBeNull();
    });

    it('should accept relative paths starting with /uploads/', () => {
      expect(validateImageUrl('/uploads/test.png')).toBeNull();
    });

    it('should reject empty strings', () => {
      expect(validateImageUrl('')).not.toBeNull();
    });

    it('should reject null', () => {
      expect(validateImageUrl(null)).not.toBeNull();
    });

    it('should reject undefined', () => {
      expect(validateImageUrl(undefined)).not.toBeNull();
    });

    it('should reject javascript: protocol', () => {
      expect(validateImageUrl('javascript:alert(1)')).not.toBeNull();
    });

    it('should reject file: protocol', () => {
      expect(validateImageUrl('file:///etc/passwd')).not.toBeNull();
    });

    it('should reject data URLs with non-image MIME types', () => {
      expect(validateImageUrl('data:text/html,<h1>test</h1>')).not.toBeNull();
    });

    it('should accept data:application/octet-stream URLs (blob conversion fallback)', () => {
      expect(validateImageUrl('data:application/octet-stream;base64,abc123')).toBeNull();
    });

    it('should accept HTTP URLs longer than 10000 characters (presigned URLs)', () => {
      const longUrl = 'https://example.com/image.png?' + 'x'.repeat(15000);
      expect(validateImageUrl(longUrl)).toBeNull();
    });

    it('should reject HTTP URLs longer than 100000 characters', () => {
      const longUrl = 'https://example.com/image.png?' + 'x'.repeat(100001);
      expect(validateImageUrl(longUrl)).not.toBeNull();
    });

    it('should reject FTP URLs', () => {
      expect(validateImageUrl('ftp://example.com/image.png')).not.toBeNull();
    });

    it('should reject plain strings', () => {
      expect(validateImageUrl('not-a-url')).not.toBeNull();
    });
  });

  describe('validateVideoUrl', () => {
    it('should accept valid video URLs', () => {
      expect(validateVideoUrl('https://example.com/video.mp4')).toBeNull();
    });

    it('should reject empty strings', () => {
      expect(validateVideoUrl('')).not.toBeNull();
    });

    it('should reject null', () => {
      expect(validateVideoUrl(null)).not.toBeNull();
    });

    it('should reject plain strings', () => {
      expect(validateVideoUrl('not-a-url')).not.toBeNull();
    });
  });

  describe('validatePrompt', () => {
    it('should accept normal prompts', () => {
      expect(validatePrompt('a beautiful sunset')).toBeNull();
    });

    it('should reject empty prompts', () => {
      expect(validatePrompt('')).not.toBeNull();
    });

    it('should reject whitespace-only prompts', () => {
      expect(validatePrompt('   ')).not.toBeNull();
    });

    it('should reject prompts that are too long', () => {
      const longPrompt = 'a'.repeat(10001);
      expect(validatePrompt(longPrompt)).not.toBeNull();
    });

    it('should accept prompts at max length', () => {
      const maxPrompt = 'a'.repeat(10000);
      expect(validatePrompt(maxPrompt)).toBeNull();
    });

    it('should use custom max length', () => {
      const prompt = 'a'.repeat(101);
      expect(validatePrompt(prompt, 'prompt', 100)).not.toBeNull();
    });

    it('should reject non-string types', () => {
      expect(validatePrompt(123)).not.toBeNull();
      expect(validatePrompt(null)).not.toBeNull();
    });
  });

  describe('validateImageSize', () => {
    it('should accept valid numeric sizes', () => {
      expect(validateImageSize(1024)).toBeNull();
    });

    it('should accept null as optional', () => {
      expect(validateImageSize(null)).toBeNull();
    });

    it('should accept undefined as optional', () => {
      expect(validateImageSize(undefined)).toBeNull();
    });

    it('should reject string sizes', () => {
      expect(validateImageSize('1024x1024')).not.toBeNull();
    });

    it('should reject zero', () => {
      expect(validateImageSize(0)).not.toBeNull();
    });

    it('should reject negative sizes', () => {
      expect(validateImageSize(-1)).not.toBeNull();
    });

    it('should reject sizes exceeding max', () => {
      expect(validateImageSize(8193)).not.toBeNull();
    });

    it('should accept size at max boundary', () => {
      expect(validateImageSize(8192)).toBeNull();
    });

    it('should reject non-integer sizes', () => {
      expect(validateImageSize(1024.5)).not.toBeNull();
    });
  });

  describe('validateModelName', () => {
    it('should accept valid model names', () => {
      expect(validateModelName('dall-e-3')).toBeNull();
    });

    it('should accept model names with slashes and colons', () => {
      expect(validateModelName('provider/model:v2')).toBeNull();
    });

    it('should reject empty model names', () => {
      expect(validateModelName('')).not.toBeNull();
    });

    it('should reject too long model names', () => {
      const longName = 'a'.repeat(201);
      expect(validateModelName(longName)).not.toBeNull();
    });

    it('should reject model names with special characters', () => {
      expect(validateModelName('model<script>')).not.toBeNull();
    });

    it('should reject null', () => {
      expect(validateModelName(null)).not.toBeNull();
    });
  });

  describe('validateAspectRatio', () => {
    it('should accept standard ratios', () => {
      expect(validateAspectRatio('1:1')).toBeNull();
      expect(validateAspectRatio('16:9')).toBeNull();
      expect(validateAspectRatio('4:3')).toBeNull();
      expect(validateAspectRatio('9:16')).toBeNull();
    });

    it('should treat null/empty as optional (returns null)', () => {
      expect(validateAspectRatio(null)).toBeNull();
      expect(validateAspectRatio('')).toBeNull();
    });

    it('should reject non-ratio strings', () => {
      expect(validateAspectRatio('abc')).not.toBeNull();
    });

    it('should reject ratios with zero values', () => {
      expect(validateAspectRatio('0:1')).not.toBeNull();
      expect(validateAspectRatio('1:0')).not.toBeNull();
    });

    it('should reject ratios with values > 100', () => {
      expect(validateAspectRatio('101:1')).not.toBeNull();
    });
  });

  describe('validateStrength', () => {
    it('should accept valid strength values', () => {
      expect(validateStrength(0.5)).toBeNull();
      expect(validateStrength(0)).toBeNull();
      expect(validateStrength(1)).toBeNull();
    });

    it('should accept undefined/null as optional', () => {
      expect(validateStrength(undefined)).toBeNull();
      expect(validateStrength(null)).toBeNull();
    });

    it('should reject negative values', () => {
      expect(validateStrength(-0.1)).not.toBeNull();
    });

    it('should reject values above max', () => {
      expect(validateStrength(1.1)).not.toBeNull();
    });

    it('should reject non-number values', () => {
      expect(validateStrength('0.5')).not.toBeNull();
    });

    it('should reject NaN', () => {
      expect(validateStrength(NaN)).not.toBeNull();
    });

    it('should respect custom max value', () => {
      expect(validateStrength(50, 'strength', 100)).toBeNull();
      expect(validateStrength(101, 'strength', 100)).not.toBeNull();
    });
  });

  describe('validateApiKeyFormat', () => {
    it('should accept valid API keys', () => {
      expect(validateApiKeyFormat('sk-1234567890abcdef')).toBeNull();
    });

    it('should reject too short keys', () => {
      expect(validateApiKeyFormat('short')).not.toBeNull();
    });

    it('should reject empty keys', () => {
      expect(validateApiKeyFormat('')).not.toBeNull();
    });

    it('should reject null', () => {
      expect(validateApiKeyFormat(null)).not.toBeNull();
    });
  });

  describe('validateAll', () => {
    it('should return null when all validations pass', () => {
      expect(validateAll(null, null, null)).toBeNull();
    });

    it('should return the first error message', () => {
      const result = validateAll(null, 'error1', 'error2');
      expect(result).toBe('error1');
    });

    it('should return the error when only one fails', () => {
      expect(validateAll(null, 'error', null)).toBe('error');
    });
  });
});
