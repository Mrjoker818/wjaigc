import { NextRequest, NextResponse } from 'next/server';
import { readServeUploadMediaLocal } from '@/lib/serve-upload-local-storage';
import { downloadImageFromS3 } from '@/lib/s3-storage';
import { getServerDataRoot } from '@/lib/server-data-root';
import { getSafeMediaTypeFromResponse } from '@/lib/media-validation';
import { publicMediaContentType, verifyPublicAudioParts, verifyPublicMediaParts } from '@/lib/public-media-link';
import { readGeneratedAudio } from '@/lib/generated-audio-storage';

export const runtime = 'nodejs';

const notFound = () => NextResponse.json({ error: 'File not found' }, { status: 404 });

/** Serves one managed media file to a model provider, only while its signed link is valid. */
async function serve(request: NextRequest, parts: string[], withBody: boolean): Promise<NextResponse> {
  if (parts[2] === 'generated-audio') return serveAudio(request, parts, withBody);
  const relativePath = verifyPublicMediaParts(parts);
  if (!relativePath) return NextResponse.json({ error: 'Link is invalid or has expired' }, { status: 403 });
  const contentType = publicMediaContentType(relativePath);
  if (!contentType) return notFound();

  let bytes: Buffer | null;
  try {
    bytes = await readServeUploadMediaLocal(getServerDataRoot(), process.cwd(), relativePath)
      ?? await downloadImageFromS3(relativePath);
  } catch {
    return notFound();
  }
  if (!bytes || bytes.length === 0) return notFound();
  // The extension decides the type, so the bytes must match it before anything is served.
  const media = getSafeMediaTypeFromResponse(contentType, bytes, contentType.startsWith('video/'));
  if (!media || media.mimeType !== contentType) return notFound();
  if (request.signal.aborted) return notFound();

  return new NextResponse(withBody ? new Uint8Array(bytes) : null, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/** A character's voice sample, read with its owner so owner-scoped audio stays private to that account's links. */
async function serveAudio(request: NextRequest, parts: string[], withBody: boolean): Promise<NextResponse> {
  const granted = verifyPublicAudioParts(parts);
  if (!granted) return NextResponse.json({ error: 'Link is invalid or has expired' }, { status: 403 });
  let audio;
  try {
    audio = await readGeneratedAudio(granted.filename, request.signal, granted.ownerId);
  } catch {
    return notFound();
  }
  if (!audio || audio.mimeType !== granted.contentType || request.signal.aborted) return notFound();
  return new NextResponse(withBody ? new Uint8Array(audio.buffer) : null, {
    headers: {
      'Content-Type': audio.mimeType,
      'Content-Length': String(audio.buffer.length),
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ parts: string[] }> }) {
  return serve(request, (await params).parts, true);
}

export async function HEAD(request: NextRequest, { params }: { params: Promise<{ parts: string[] }> }) {
  return serve(request, (await params).parts, false);
}
