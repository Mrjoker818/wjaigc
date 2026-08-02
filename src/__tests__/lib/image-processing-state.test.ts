import { describe, expect, it } from 'vitest';
import {
  buildFailedProcessingFrame,
  extractImageEditErrorMessage,
} from '@/lib/image-processing-state';

describe('image processing state', () => {
  it('converts a network failure into an explicit terminal processing-frame state', () => {
    expect(buildFailedProcessingFrame('network request failed', 'remove background failed')).toEqual({
      progress: -1,
      status: '❌ network request failed',
      error: 'network request failed',
    });
  });

  it('uses the supplied fallback when the failure message is blank', () => {
    expect(buildFailedProcessingFrame('', 'remove background failed')).toEqual({
      progress: -1,
      status: '❌ remove background failed',
      error: 'remove background failed',
    });
  });

  it('extracts the actionable backend error from a failed image-edit JSON response', () => {
    expect(
      extractImageEditErrorMessage(
        JSON.stringify({ success: false, error: 'mask area empty' }),
        400,
      ),
    ).toBe('mask area empty');
  });

  it('normalizes a nested 302 content-review rejection instead of exposing provider JSON', () => {
    const message = extractImageEditErrorMessage(
      JSON.stringify({
        success: false,
        error: '302.AI upscale failed: 422 - {"error":{"err_code":-10021,"message":"The content could not be processed because it contained material flagged by a content checker","message_cn":"内容因包含被内容检查器标记的材料而无法处理"}}',
        code: 'UPSCALE_PROVIDER_REJECTED',
        providerCode: '-10021',
        retryable: false,
      }),
      502,
    );

    expect(message).toBe('当前图片未通过 302.AI 的内容审核，请更换图片或改用其他放大模型。');
    expect(message).not.toContain('err_code');
    expect(message).not.toContain('{"error"');
  });

  it('uses an HTTP fallback when a failed image-edit response has no readable body', () => {
    expect(extractImageEditErrorMessage('', 502)).toBe('服务器错误 (502)');
  });
});
