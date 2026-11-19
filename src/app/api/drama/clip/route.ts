/** A shot video the user brings in, for example from an imported production package. Stored where renders can read it. */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { videoForbidden } from '@/lib/drama/access';
import { getSafeMediaTypeFromResponse } from '@/lib/media-validation';
import { MAX_DRAMA_CLIP_BYTES } from '@/lib/drama/package';
import { saveImageFile } from '@/lib/server-data-root';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLIP_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'];

/** POST /api/drama/clip (multipart, field "file") → { videoUrl }. Costs no credits. */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const denied = videoForbidden(auth.user);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '没有收到视频文件，请重新选择' }, { status: 400 });
  if (file.size > MAX_DRAMA_CLIP_BYTES) return NextResponse.json({ error: '视频超过 48MB，压缩后再上传' }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = CLIP_TYPES.includes(file.type) ? getSafeMediaTypeFromResponse(file.type, bytes, true) : null;
  if (!type) return NextResponse.json({ error: '只能上传 MP4、WebM 或 MOV 视频' }, { status: 400 });
  try {
    const videoUrl = saveImageFile(Buffer.from(bytes), `clip_${Date.now()}_${randomUUID().slice(0, 8)}.${type.extension}`, 'drama-clips');
    return NextResponse.json({ success: true, videoUrl });
  } catch (error) {
    console.error({ code: 'DRAMA_CLIP_UPLOAD_FAILED', error });
    return NextResponse.json({ error: '视频上传失败，请稍后重试' }, { status: 500 });
  }
}
