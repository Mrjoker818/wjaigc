import { describe, expect, it } from 'vitest';
import {
  createQuickCreateFallbackResult,
  extractFirstJsonObject,
  parseQuickCreateCompilePayload,
  parseQuickCreateCompileRequest,
  parseQuickCreateCompileSseEvent,
  resolveQuickCreateGenerationQuality,
  stripMarkdownCodeFence,
  supportsQuickCreateVision,
} from '@/lib/quick-create-compile';

const validPayload = {
  summary: '春季东方茶饮社媒海报',
  strategy: '以克制留白和春日植物建立高级东方感。',
  directions: [
    {
      title: '清露新芽',
      description: '产品居中，使用晨雾和嫩叶构建清新层次。',
      visualKeywords: ['东方美学', '晨雾', '嫩叶'],
    },
  ],
  positivePrompt: '东方茶饮春季新品海报，产品居中，柔和晨光，高级商业摄影',
  negativePrompt: '低清晰度，变形，水印，乱码文字',
  aspectRatio: '4:5',
  quality: 'high',
  outputCount: 3,
};

describe('quick create compile JSON parsing', () => {
  it('strips a markdown JSON fence', () => {
    expect(stripMarkdownCodeFence('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it('extracts JSON from mixed explanatory text', () => {
    expect(extractFirstJsonObject(`方案如下：\n${JSON.stringify(validPayload)}\n请确认`)).toBe(JSON.stringify(validPayload));
  });

  it('handles braces and escaped quotes inside JSON strings', () => {
    const source = '说明 {"summary":"保留 {花括号} 和 \\"引号\\"","strategy":"策略","directions":[{"title":"方向","description":"描述","visualKeywords":["关键词"]}],"positivePrompt":"正向","negativePrompt":"负向","aspectRatio":"1:1","quality":"standard","outputCount":1} 尾部';
    expect(() => parseQuickCreateCompilePayload(source)).not.toThrow();
  });

  it('returns a strictly validated payload', () => {
    expect(parseQuickCreateCompilePayload(JSON.stringify(validPayload))).toEqual(validPayload);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseQuickCreateCompilePayload('{"summary":')).toThrow('完整的 JSON');
  });

  it('rejects missing required fields', () => {
    expect(() => parseQuickCreateCompilePayload(JSON.stringify({ ...validPayload, strategy: undefined }))).toThrow('strategy');
  });

  it('rejects unsupported enum values', () => {
    expect(() => parseQuickCreateCompilePayload(JSON.stringify({ ...validPayload, aspectRatio: '5:7' }))).toThrow('aspectRatio');
  });

  it('rejects an output count outside the supported range', () => {
    expect(() => parseQuickCreateCompilePayload(JSON.stringify({ ...validPayload, outputCount: 8 }))).toThrow('outputCount');
  });
});

describe('quick create request validation', () => {
  const validRequest = {
    prompt: '为春季东方茶饮设计一组社媒海报',
    aspectRatio: '4:5',
    quality: 'high',
    outputCount: 3,
    referenceImages: [
      'https://example.com/reference.webp',
      '/api/serve-upload/reference.png',
      'data:image/png;base64,AA==',
    ],
  };

  it('accepts a valid compile request', () => {
    expect(parseQuickCreateCompileRequest(validRequest)).toEqual(validRequest);
  });

  it('rejects unsupported ratios and qualities', () => {
    expect(() => parseQuickCreateCompileRequest({ ...validRequest, aspectRatio: '5:7' })).toThrow('aspectRatio');
    expect(() => parseQuickCreateCompileRequest({ ...validRequest, quality: 'ultra' })).toThrow('quality');
  });

  it('rejects an invalid output count', () => {
    expect(() => parseQuickCreateCompileRequest({ ...validRequest, outputCount: 5 })).toThrow('outputCount');
  });

  it('rejects too many reference images and unsafe protocols', () => {
    expect(() => parseQuickCreateCompileRequest({
      ...validRequest,
      referenceImages: Array.from({ length: 9 }, () => '/image.png'),
    })).toThrow('referenceImages');
    expect(() => parseQuickCreateCompileRequest({
      ...validRequest,
      referenceImages: ['file:///etc/passwd'],
    })).toThrow('referenceImages');
  });
});

describe('quick create generation quality routing', () => {
  it('uses a resolution tier without sending unsupported quality to a size-only model', () => {
    expect(resolveQuickCreateGenerationQuality('standard', {
      allowedSizes: ['1K', '2K', '4K'],
      qualityOptions: [],
    })).toEqual({ resolution: '1K' });
  });

  it('maps high intent to both supported dimensions when the model exposes both', () => {
    expect(resolveQuickCreateGenerationQuality('high', {
      allowedSizes: ['1K', '2K', '4K'],
      qualityOptions: ['auto', 'low', 'medium', 'high'],
    })).toEqual({ quality: 'high', resolution: '2K' });
  });

  it('preserves a supported quality-only value', () => {
    expect(resolveQuickCreateGenerationQuality('standard', {
      allowedSizes: [],
      qualityOptions: ['standard', 'hd'],
    })).toEqual({ quality: 'standard' });
  });

  it('omits unverified fields when no authoritative capability is available', () => {
    expect(resolveQuickCreateGenerationQuality('standard')).toEqual({});
  });

  it('does not forward pixel sizes or unknown quality values as generation tiers', () => {
    expect(resolveQuickCreateGenerationQuality('high', {
      allowedSizes: ['1024x1024'],
      qualityOptions: ['premium'],
    })).toEqual({});
  });
});

describe('quick create fallback plan', () => {
  it('preserves the original prompt and all user-selected image parameters', () => {
    const request = {
      prompt: '生成三张纯白背景上的青绿色立方体产品图',
      aspectRatio: '1:1' as const,
      quality: 'standard' as const,
      outputCount: 3,
      referenceImages: [],
    };

    expect(createQuickCreateFallbackResult(request, {
      model: 'chat-model',
      providerId: 'provider-1',
      providerName: 'Provider One',
      modelSource: 'quick-create-default',
    })).toMatchObject({
      mode: 'fallback',
      positivePrompt: request.prompt,
      aspectRatio: request.aspectRatio,
      quality: request.quality,
      outputCount: request.outputCount,
    });
  });
});

describe('quick create SSE event validation', () => {
  it('accepts a valid result event', () => {
    expect(parseQuickCreateCompileSseEvent({
      type: 'result',
      result: {
        ...validPayload,
        model: 'chat-model',
        providerId: 'provider-1',
        providerName: 'Provider One',
        modelSource: 'task-override',
        mode: 'compiled',
      },
    })).toMatchObject({ type: 'result' });
  });

  it('rejects unknown event types and invalid result metadata', () => {
    expect(() => parseQuickCreateCompileSseEvent({ type: 'unknown' })).toThrow('无效的 SSE');
    expect(() => parseQuickCreateCompileSseEvent({
      type: 'result',
      result: { ...validPayload, model: '', providerId: 'p', providerName: 'P', modelSource: 'first-available', mode: 'compiled' },
    })).toThrow('无效的 SSE');
  });
});

describe('quick create vision model detection', () => {
  it('recognizes supported multimodal model families', () => {
    expect(supportsQuickCreateVision('doubao-seed-2-0-pro-260215')).toBe(true);
    expect(supportsQuickCreateVision('gemini-2.5-flash')).toBe(true);
  });

  it('uses explicit capability metadata before model-name heuristics', () => {
    expect(supportsQuickCreateVision('custom-chat-model', ['multimodal'])).toBe(true);
  });

  it('does not attach images to a text-only model', () => {
    expect(supportsQuickCreateVision('deepseek-v3-2-251201')).toBe(false);
  });
});
