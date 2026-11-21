import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { validateApiInputs, validators, withValidation } from '@/lib/api-validator';

describe('API JSON object boundary', () => {
  it.each([null, [], [1], true, 7, 'hello'])('rejects a non-object JSON body before the handler: %j', async value => {
    const handler = vi.fn(() => NextResponse.json({ accepted: true }));
    const post = withValidation({ prompt: { required: false, validate: validators.optionalPrompt } }, handler);
    const response = await post(new NextRequest('http://localhost/api/test', {
      method: 'POST', body: JSON.stringify(value), headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '请求体必须是对象' });
    expect(handler).not.toHaveBeenCalled();
    expect(validateApiInputs(value, { prompt: 'optionalPrompt' })).toBe('请求体必须是对象');
  });

  it('retains the valid object, optional fields and required-field errors', async () => {
    const handler = vi.fn((_req: NextRequest, body: Record<string, unknown>) => NextResponse.json({ received: body }));
    const post = withValidation({ prompt: validators.prompt }, handler);
    const missing = await post(new NextRequest('http://localhost/api/test', { method: 'POST', body: '{}' }));
    expect(missing.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    const valid = await post(new NextRequest('http://localhost/api/test', { method: 'POST', body: '{"prompt":"海报","extra":2}' }));
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ received: { prompt: '海报', extra: 2 } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(validateApiInputs({}, { prompt: 'optionalPrompt' })).toBeNull();
  });
});
