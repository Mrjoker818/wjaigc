import { NextRequest, NextResponse } from 'next/server';

/**
 * Validate URL to prevent SSRF attacks.
 * Blocks private/internal network addresses and non-HTTP protocols.
 */
function isSafeUrl(url: URL): boolean {
  // Only allow http/https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const hostname = url.hostname.toLowerCase();
  // Block RFC1918 private addresses
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) return false;
  // Block loopback
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
  // Block link-local
  if (/^(169\.254\.|fe80:)/.test(hostname)) return false;
  // Block host-only digits (0.x.x.x)
  if (/^0\./.test(hostname)) return false;
  return true;
}

/**
 * Proxy route for fetching 3D model files.
 * Solves CORS issues when loading external 3D model URLs (e.g. 302.ai COS URLs)
 * in the browser-side Three.js loaders.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  if (!isSafeUrl(parsedUrl)) {
    return NextResponse.json({ error: 'URL not allowed (internal/private addresses are blocked)' }, { status: 403 });
  }

  try {
    const res = await fetch(parsedUrl.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; 3DProxy/1.0)',
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status}` },
        { status: res.status }
      );
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const body = await res.arrayBuffer();

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=3600');
    // Allow large 3D model files
    headers.set('Content-Length', body.byteLength.toString());

    return new NextResponse(body, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[proxy-3d-model] Error:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
