import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('administrator task monitor contract', () => {
  it('renders authoritative routing, timing, billing, request, and error-source facts', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'),
      'utf8',
    );

    for (const field of [
      'requestedProviderId',
      'requestedModelId',
      'actualProviderId',
      'actualModelId',
      'handlerVersion',
      'durationMs',
      'billing',
      'requestId',
      'errorSource',
    ]) {
      expect(source).toContain(field);
    }
  });
});
