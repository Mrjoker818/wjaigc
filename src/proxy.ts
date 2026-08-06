import { NextRequest, NextResponse } from 'next/server';

const MAX_BODY_SIZE = 50 * 1024 * 1024;
const PATH_TRAVERSAL_PATTERN = /\.\.[/\\]|%2e%2e[%/\\]/i;
const UNSAFE_PROTOCOL_PATTERN = /^(file|javascript|vbscript|data):/i;
const XSS_PATTERN = /<\s*script|javascript\s*:|\bon(?:click|error|load|mouseover|mouseout|mousedown|mouseup|change|submit|focus|blur|keydown|keyup|keypress|input|scroll|wheel|touchstart|touchmove|touchend|toggle|animationend|transitionend)\s*=/i;
const SKIP_PATHS = ['/_next', '/favicon', '/uploads/', '/api/serve-upload/'];

function getRequestId(request: NextRequest): string {
  const incoming = request.headers.get('x-request-id');
  if (incoming && /^[a-zA-Z0-9_-]{1,128}$/.test(incoming)) return incoming;
  return `req_${crypto.randomUUID()}`;
}

function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  return response;
}

function nextWithRequestId(request: NextRequest, requestId: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }), requestId);
}

function badRequest(message: string, requestId: string, status: 400 | 413 = 400): NextResponse {
  return withRequestId(NextResponse.json({ error: message }, { status }), requestId);
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = new URL(request.url);
  const requestId = getRequestId(request);

  if (SKIP_PATHS.some(path => pathname.startsWith(path))) {
    return nextWithRequestId(request, requestId);
  }

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (PATH_TRAVERSAL_PATTERN.test(pathname) || PATH_TRAVERSAL_PATTERN.test(search)) {
    return badRequest('请求路径包含非法字符', requestId);
  }

  if (search) {
    try {
      const decoded = decodeURIComponent(search);
      if (UNSAFE_PROTOCOL_PATTERN.test(decoded)) {
        return badRequest('请求参数包含不安全的协议', requestId);
      }
      if (XSS_PATTERN.test(decoded)) {
        return badRequest('请求参数包含非法内容', requestId);
      }
    } catch {
      return badRequest('请求参数编码无效', requestId);
    }
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return badRequest('请求体超过大小限制', requestId, 413);
  }

  if (pathname.split('/').some(segment => segment.length > 256)) {
    return badRequest('请求路径参数过长', requestId);
  }

  return nextWithRequestId(request, requestId);
}

export const config = {
  matcher: ['/api/:path*'],
};
