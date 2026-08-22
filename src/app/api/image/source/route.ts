import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { downloadPublicImage } from '@/lib/safe-image-download';

const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export const dynamic = 'force-dynamic';

function invalidSourceResponse(): NextResponse {
  return NextResponse.json({ error: 'IMAGE_SOURCE_INVALID' }, { status: 400 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  const source = request.nextUrl.searchParams.get('url')?.trim() ?? '';
  if (!source || source.length > MAX_SOURCE_URL_LENGTH) return invalidSourceResponse();

  let remoteUrl: URL;
  try {
    remoteUrl = new URL(source);
  } catch {
    return invalidSourceResponse();
  }

  if (
    !['http:', 'https:'].includes(remoteUrl.protocol)
    || remoteUrl.username
    || remoteUrl.password
  ) {
    return invalidSourceResponse();
  }

  try {
    const image = await downloadPublicImage(remoteUrl.toString(), {
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: 20_000,
    });

    return new NextResponse(new Uint8Array(image.buffer), {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=300',
        'Content-Length': String(image.buffer.byteLength),
        'Content-Type': image.mimeType,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'REMOTE_IMAGE_UNAVAILABLE' }, { status: 422 });
  }
}
