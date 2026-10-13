import { describe, expect, it } from 'vitest';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import nextConfig from '../../../next.config';

async function effectiveHeaders(pathname: string): Promise<Headers> {
  const headers = new Headers();
  for (const rule of await nextConfig.headers!()) {
    if (!getPathMatch(rule.source)(pathname)) continue;
    for (const header of rule.headers) headers.set(header.key, header.value);
  }
  return headers;
}

describe('production sketch attachment security header precedence', () => {
  it.each(['sketch_2cae7d6d-e690-4d26-b6a4-51f55b2f28d1', 'original-task'])('isolates the final HTML download response for %s', async taskId => {
    const headers = await effectiveHeaders(`/api/sketch-to-code/${taskId}/document`);
    const csp = headers.get('content-security-policy') ?? '';
    for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "frame-ancestors 'none'", "form-action 'none'", "base-uri 'none'", 'sandbox']) {
      expect(csp.split(';').map(part => part.trim())).toContain(directive);
    }
    expect(csp).not.toMatch(/unsafe-eval|cdn\.jsdelivr\.net|ws:|https:/);
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  it.each(['/', '/simple-create', '/api/models', '/api/sketch-to-code', '/api/sketch-to-code/task/other', '/api/sketch-to-code/a/b/document'])('preserves the application policy outside the document route: %s', async pathname => {
    const csp = (await effectiveHeaders(pathname)).get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp.split(';').map(part => part.trim())).not.toContain('sandbox');
  });
});
