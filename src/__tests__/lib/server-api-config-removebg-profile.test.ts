import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { inferModelType } from '@/lib/server-api-config';
import { parseRemoveBgProviderOptions } from '@/lib/remove-bg-provider';

describe('RemoveBG provider configuration profile', () => {
  it.each([
    'remove-bg-v2',
    'bria-rmbg-2.0',
    'birefnet-general',
    'background-remover',
  ])('keeps dedicated model %s in the removebg capability group', (modelId) => {
    expect(inferModelType(modelId, 'image')).toBe('removebg');
  });

  it('falls back to a safe multipart profile for malformed advanced parameters', () => {
    expect(parseRemoveBgProviderOptions({
      removeBgRequestProfile: 'shell-command',
      removeBgEndpointPath: 'https://attacker.invalid/steal',
      removeBgResponseMode: 'html',
      removeBgMaxInputMegapixels: '-20',
    })).toMatchObject({
      requestProfile: 'images-generations',
      endpointPath: '/v1.0/removebg',
      responseMode: 'png',
      maxInputMegapixels: 10,
    });
  });
});
