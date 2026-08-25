import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { getServerDataRoot } from '@/lib/server-data-root';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { isSafeVideoSource } from '@/lib/api-validator';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;

function resolveWithinDirectory(directory: string, relativePath: string): string | null {
  const resolved = path.resolve(directory, relativePath);
  const difference = path.relative(directory, resolved);
  return difference && !difference.startsWith('..') && !path.isAbsolute(difference) ? resolved : null;
}

async function readLocalVideoBuffer(url: string): Promise<Buffer | null> {
  let requestPath: string;
  try {
    requestPath = decodeURIComponent(url.split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }

  const dataRoot = getServerDataRoot();
  const candidates: string[] = [];
  if (requestPath.startsWith('/api/serve-upload/')) {
    const relativePath = requestPath.slice('/api/serve-upload/'.length);
    const uploadPath = resolveWithinDirectory(path.join(dataRoot, 'uploads'), relativePath);
    const legacyPath = resolveWithinDirectory(dataRoot, relativePath);
    if (uploadPath) candidates.push(uploadPath);
    if (legacyPath) candidates.push(legacyPath);
  } else if (requestPath.startsWith('/uploads/')) {
    const localPath = resolveWithinDirectory(path.join(dataRoot, 'uploads'), requestPath.slice('/uploads/'.length));
    if (localPath) candidates.push(localPath);
  } else {
    const localPath = resolveWithinDirectory(path.join(process.cwd(), 'public'), requestPath.slice(1));
    if (localPath) candidates.push(localPath);
  }

  for (const candidate of candidates) {
    try {
      const buffer = await readFile(candidate);
      if (buffer.byteLength > MAX_DOWNLOAD_BYTES) throw new Error('视频文件超过 150MB 下载上限');
      return buffer;
    } catch (error) {
      if (error instanceof Error && error.message.includes('视频文件超过')) throw error;
    }
  }
  return null;
}

function getVideoContentType(url: string): string {
  const pathname = url.split(/[?#]/, 1)[0].toLowerCase();
  if (pathname.endsWith('.webm')) return 'video/webm';
  if (pathname.endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  const sourceUrl = request.nextUrl.searchParams.get('url') || '';
  if (!isSafeVideoSource(sourceUrl) || (!sourceUrl.startsWith('/') && !sourceUrl.startsWith('https://'))) {
    return NextResponse.json({ error: '视频下载地址无效' }, { status: 400 });
  }

  try {
    if (sourceUrl.startsWith('/')) {
      const localBuffer = await readLocalVideoBuffer(sourceUrl);
      if (!localBuffer) return NextResponse.json({ error: '视频文件不存在' }, { status: 404 });
      return new NextResponse(new Uint8Array(localBuffer), {
        headers: {
          'Content-Type': getVideoContentType(sourceUrl),
          'Content-Disposition': 'attachment; filename="wujie-video.mp4"',
          'Cache-Control': 'private, max-age=0',
        },
      });
    }

    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) return NextResponse.json({ error: `视频下载失败: ${response.status}` }, { status: response.status });
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_DOWNLOAD_BYTES) return NextResponse.json({ error: '视频文件超过 150MB 下载上限' }, { status: 413 });
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_DOWNLOAD_BYTES) return NextResponse.json({ error: '视频文件超过 150MB 下载上限' }, { status: 413 });
    return new NextResponse(body, {
      headers: {
        'Content-Type': response.headers.get('content-type') || 'video/mp4',
        'Content-Disposition': 'attachment; filename="wujie-video.mp4"',
        'Cache-Control': 'private, max-age=0',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '视频下载失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
