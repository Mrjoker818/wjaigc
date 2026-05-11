import { NextRequest, NextResponse } from 'next/server';

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

  try {
    const res = await fetch(url, {
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
