import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { requireApiAuthOrReject } from '@/lib/api-auth';

const SERVER_DATA_ROOT = process.env.SERVER_DATA_ROOT || '/space/wujie-data';

/**
 * Validate URL to prevent SSRF attacks.
 * Blocks private/internal network addresses and non-HTTP protocols.
 */
function isSafeUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const hostname = url.hostname.toLowerCase();
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
  if (/^(169\.254\.|fe80:)/.test(hostname)) return false;
  if (/^0\./.test(hostname)) return false;
  return true;
}

/**
 * Generate a deterministic cache key from a URL.
 * Uses first 16 chars of SHA-256-ish hex (via simple hash since no crypto dep needed at scale).
 */
function hashKey(input: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Detect file extension from URL or content-type */
function detectExt(url: string, contentType: string): string {
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  const m = clean.match(/\.(glb|gltf|fbx|obj|stl|usdz|mtl|png|jpg|jpeg|bin|tex)$/);
  if (m) return m[1];
  const ct = contentType.toLowerCase();
  if (ct.includes('model/gltf-binary') || ct.includes('glb')) return 'glb';
  if (ct.includes('model/gltf+json') || ct.includes('gltf')) return 'gltf';
  if (ct.includes('octet-stream')) return 'bin';
  return 'bin';
}

/** Ensure cache directory exists */
function getCacheDir(): string {
  const dir = path.join(SERVER_DATA_ROOT || '/space/wujie-data', '3d-models');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

/** Try to serve from local cache */
function tryServeCache(cacheKey: string): { body: Buffer; contentType: string } | null {
  const dir = getCacheDir();
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.startsWith(cacheKey + '.')) {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (stat.isFile() && stat.size > 0) {
          const ext = path.extname(f).slice(1);
          const ct = ext === 'glb' ? 'model/gltf-binary'
            : ext === 'gltf' ? 'model/gltf+json'
            : ext === 'fbx' ? 'application/octet-stream'
            : ext === 'obj' ? 'text/plain'
            : ext === 'stl' ? 'application/sla'
            : ext === 'mtl' ? 'text/plain'
            : ext === 'png' ? 'image/png'
            : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : 'application/octet-stream';
          return { body: fs.readFileSync(fp), contentType: ct };
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Save to local cache */
function saveToCache(cacheKey: string, ext: string, body: Buffer): void {
  try {
    const fp = path.join(getCacheDir(), `${cacheKey}.${ext}`);
    fs.writeFileSync(fp, body);
  } catch (e) {
    console.warn('[proxy-3d-model] Failed to cache:', e);
  }
}

/**
 * Proxy route for fetching 3D model files.
 * Solves CORS issues when loading external 3D model URLs (e.g. Meshy/Tencent COS URLs)
 * in the browser-side Three.js loaders.
 *
 * Features:
 * - CORS bypass for cross-origin 3D model hosts
 * - Local file cache (so expired presigned URLs don't break previously-loaded models
 *   when server has already fetched and cached them once)
 * - SSRF protection (blocks private IPs)
 * - Binary streaming with proper Content-Type
 * - Friendly Chinese error messages for 403/404 (expired/cleaned URLs)
 */
export async function GET(request: NextRequest) {
  // Require authentication to prevent abuse as open proxy
  const authResult = await requireApiAuthOrReject(request);
  if (authResult) return authResult;

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

  // 1. Try local cache first (avoids expired presigned URL issues)
  const cacheKey = hashKey(parsedUrl.pathname + parsedUrl.hostname);
  const cached = tryServeCache(cacheKey);
  if (cached) {
    const headers = new Headers();
    headers.set('Content-Type', cached.contentType);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Content-Length', cached.body.byteLength.toString());
    headers.set('X-Cache', 'HIT');
    return new NextResponse(new Uint8Array(cached.body), { status: 200, headers });
  }

  // 2. Fetch from upstream
  try {
    let res = await fetch(parsedUrl.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; 3DProxy/1.0)',
        'Accept': '*/*',
      },
      redirect: 'follow',
    });

    // 3. Handle upstream errors with friendly messages for common cases
    if (!res.ok) {
      if (res.status === 403) {
        return NextResponse.json(
          {
            error: '模型下载链接已过期（第三方云存储签名过期）。请重新生成该 3D 模型，或使用下方"直接下载"按钮尝试原始链接。',
            code: 'URL_EXPIRED',
            originalUrl: url,
          },
          { status: 403 }
        );
      }
      if (res.status === 404) {
        return NextResponse.json(
          { error: '模型文件不存在（404），可能已被第三方服务器清理，请重新生成该 3D 模型' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Upstream returned ${res.status}` },
        { status: res.status }
      );
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const body = Buffer.from(await res.arrayBuffer());

    // 4. Cache to disk for future requests (only if file size is reasonable, <200MB)
    if (body.length > 0 && body.length < 200 * 1024 * 1024) {
      const ext = detectExt(parsedUrl.href, contentType);
      saveToCache(cacheKey, ext, body);
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('Content-Length', body.byteLength.toString());
    headers.set('X-Cache', 'MISS');

    return new NextResponse(new Uint8Array(body), { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[proxy-3d-model] Error:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
