import { NextRequest, NextResponse } from 'next/server';
import { expectedActorHeaders } from '@/lib/expected-actor-header';

export const ACTOR_BOUND_ASSET_MAX_BYTES = 50 * 1024 * 1024;

type Prepared = { request: NextRequest } | { response: NextResponse };
const invalid = (): NextResponse => NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });

export async function prepareActorBoundAssetRequest(request: NextRequest, authenticatedActor: string, maxBytes: number): Promise<Prepared> {
  if (maxBytes !== undefined) {
    const length = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(length) && length > maxBytes) return { response: NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 413 }) };
  }
  let body: unknown;
  try {
    {
      if (!request.body) return { response: invalid() };
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            void reader.cancel().catch(() => undefined);
            return { response: NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 413 }) };
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = JSON.parse(new TextDecoder().decode(bytes));
    }
  } catch { return { response: invalid() }; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { response: invalid() };
  const value = body as Record<string, unknown>;
  if (typeof value.expectedActorId !== 'string' || value.expectedActorId.length === 0) return { response: invalid() };
  if (value.expectedActorId !== authenticatedActor) return { response: NextResponse.json({ error: 'ACTOR_SCOPE_CHANGED' }, { status: 409 }) };
  const { expectedActorId: _expectedActorId, ...legacyBody } = value;
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.delete('x-wujie-expected-actor-id');
  headers.delete('x-wujie-expected-actor-id-encoding');
  for (const [key, headerValue] of Object.entries(expectedActorHeaders(authenticatedActor))) headers.set(key, headerValue);
  return { request: new NextRequest(request.url, { method: 'POST', headers, body: JSON.stringify(legacyBody), signal: request.signal }) };
}
