import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import proxy from '@/proxy';

describe('API proxy request tracing', () => {
  it('adds a request ID to successful API responses and forwards it downstream', () => {
    const response = proxy(new NextRequest('http://localhost/api/models'));

    expect(response.headers.get('x-request-id')).toMatch(/^req_[a-z0-9-]+$/);
    expect(response.headers.get('x-middleware-request-x-request-id')).toMatch(/^req_[a-z0-9-]+$/);
  });

  it('includes a request ID when rejecting an unsafe API request', () => {
    const response = proxy(new NextRequest('http://localhost/api/models?target=javascript:alert(1)'));

    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toMatch(/^req_[a-z0-9-]+$/);
  });
});
