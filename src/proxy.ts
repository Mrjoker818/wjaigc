/**
 * Next.js 全局代理 (proxy.ts)
 * - API 请求基础安全校验（URL参数/路径注入/请求大小）
 * - POST body 校验由各路由的 validateApiInputs 负责
 */
import { NextRequest, NextResponse } from 'next/server';

// 请求体大小限制（50MB，与 next.config.ts 的 bodySizeLimit 对齐）
const MAX_BODY_SIZE = 50 * 1024 * 1024;

// 路径遍历/注入检测
const PATH_TRAVERSAL_PATTERN = /\.\.[/\\]|%2e%2e[%/\\]/i;

// 危险协议检测（URL参数中）
const UNSAFE_PROTOCOL_PATTERN = /^(file|javascript|vbscript|data):/i;

// XSS基础检测（URL参数中）
const XSS_PATTERN = /<\s*script|on\w+\s*=|javascript\s*:/i;

// 不需要校验的路径前缀
const SKIP_PATHS = [
  '/_next',
  '/favicon',
  '/uploads/',
  '/api/serve-upload/',
];

export default function proxy(request: NextRequest) {
  const { pathname, search } = new URL(request.url);

  // 跳过静态资源
  if (SKIP_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 仅对 /api/ 路径做安全校验
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // 1. 路径遍历检测
  if (PATH_TRAVERSAL_PATTERN.test(pathname) || PATH_TRAVERSAL_PATTERN.test(search)) {
    return NextResponse.json(
      { error: '请求路径包含非法字符' },
      { status: 400 }
    );
  }

  // 2. URL 参数中的危险协议/XSS
  if (search) {
    try {
      const decoded = decodeURIComponent(search);
      if (UNSAFE_PROTOCOL_PATTERN.test(decoded)) {
        return NextResponse.json(
          { error: '请求参数包含不安全的协议' },
          { status: 400 }
        );
      }
      if (XSS_PATTERN.test(decoded)) {
        return NextResponse.json(
          { error: '请求参数包含非法内容' },
          { status: 400 }
        );
      }
    } catch {
      // decodeURIComponent 失败，忽略
    }
  }

  // 3. Content-Length 检查（针对有 body 的请求）
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: '请求体超出大小限制' },
      { status: 413 }
    );
  }

  // 4. 路径中参数的基本安全检查（动态路由段）
  const pathSegments = pathname.split('/');
  for (const segment of pathSegments) {
    if (segment.length > 256) {
      return NextResponse.json(
        { error: '请求路径参数过长' },
        { status: 400 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
