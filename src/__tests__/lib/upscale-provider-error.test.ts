import { describe, expect, it } from 'vitest';
import {
  UpscaleProviderError,
  parse302UpscaleProviderError,
} from '@/lib/upscale-provider-error';

describe('302 upscale provider errors', () => {
  it('preserves an upstream content-review rejection as a non-retryable 422 error', () => {
    const error = parse302UpscaleProviderError(
      422,
      JSON.stringify({
        err_code: -10021,
        err_msg: 'Content rejected by provider moderation',
      }),
    );

    expect(error).toBeInstanceOf(UpscaleProviderError);
    expect(error).toMatchObject({
      status: 422,
      code: 'UPSCALE_PROVIDER_REJECTED',
      providerCode: '-10021',
      retryable: false,
    });
    expect(error.message).toContain('Content rejected');
  });

  it.each([
    [401, 'UPSCALE_PROVIDER_AUTH', false],
    [403, 'UPSCALE_PROVIDER_AUTH', false],
    [429, 'UPSCALE_PROVIDER_RATE_LIMIT', true],
    [503, 'UPSCALE_PROVIDER_UNAVAILABLE', true],
  ])('classifies HTTP %i consistently', (status, code, retryable) => {
    const error = parse302UpscaleProviderError(status, '{"message":"provider failure"}');

    expect(error).toMatchObject({ status, code, retryable });
  });
});
