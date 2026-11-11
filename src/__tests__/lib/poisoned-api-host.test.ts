import { describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, fetchWithV1Retry } from '@/lib/api-helpers';
import { assertSafeProviderUrl, PoisonedApiHostError, POISONED_API_HOSTS } from '@/lib/poisoned-api-host';

describe('poisoned provider host guard', () => {
  it('checks fully qualified DNS names the same way as their unqualified spelling', () => {
    const [blocked] = POISONED_API_HOSTS;
    expect(() => assertSafeProviderUrl(`https://${blocked}./`)).toThrow(PoisonedApiHostError);
    expect(() => assertSafeProviderUrl(`https://service.${blocked}./`)).toThrow(PoisonedApiHostError);
    expect(() => assertSafeProviderUrl('https://provider.invalid./')).not.toThrow();
  });

  it('refuses a poisoned host before fetchWithV1Retry leaves the process', async () => {
    const transport = vi.fn();

    await expect(fetchWithV1Retry('https://api.apimart.ai/v1', '/chat/completions', {
      method: 'POST',
      transport,
    })).rejects.toBeInstanceOf(PoisonedApiHostError);
    expect(transport).not.toHaveBeenCalled();
  });

  it('refuses a poisoned host before fetchWithTimeout leaves the process', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('should not fetch'));

    await expect(fetchWithTimeout('https://upload.apimart.ai/file.png')).rejects.toBeInstanceOf(PoisonedApiHostError);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('still sends a clean gateway request', async () => {
    const transport = vi.fn(async () => new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await fetchWithV1Retry('https://api.apib.ai/v1', '/models', { transport });

    expect(response.ok).toBe(true);
    expect(transport).toHaveBeenCalledWith('https://api.apib.ai/v1/models', expect.any(Object));
  });

  it('refuses an empty or malformed provider URL before leaving the process', async () => {
    const transport = vi.fn();

    await expect(fetchWithV1Retry('', '/chat/completions', { transport })).rejects.toThrow('Provider URL is empty');
    await expect(fetchWithV1Retry('not a url', '/chat/completions', { transport })).rejects.toThrow('Provider URL is not a valid absolute URL');
    await expect(fetchWithTimeout('ftp://api.apib.ai/v1')).rejects.toThrow('Provider URL must use http or https');
    expect(transport).not.toHaveBeenCalled();
  });
});
