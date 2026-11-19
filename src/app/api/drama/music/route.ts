/** Background music for a drama episode: the user uploads an MP3 or WAV, stored like generated audio so renders can read it. */
import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { videoForbidden } from '@/lib/drama/access';
import { sniffAudioFormat } from '@/lib/drama/audio-upload';
import { persistGeneratedAudioResponse } from '@/lib/generated-audio-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same ceiling as the audio store. */
const MAX_MUSIC_BYTES = 25 * 1024 * 1024;

/** POST /api/drama/music (multipart, field "file") → { audioUrl, name }. Costs no credits. */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const denied = videoForbidden(auth.user);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '没有收到音乐文件，请重新选择' }, { status: 400 });
  if (file.size > MAX_MUSIC_BYTES) return NextResponse.json({ error: '音乐文件超过 25MB，压缩或剪短后再上传' }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffAudioFormat(bytes);
  if (!format) return NextResponse.json({ error: '只能上传 MP3 或 WAV 音乐' }, { status: 400 });
  try {
    const stored = await persistGeneratedAudioResponse(
      new Response(bytes, { headers: { 'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/wav' } }), format, auth.userId,
    );
    return NextResponse.json({ success: true, audioUrl: stored.audioUrl, name: file.name.slice(0, 200) || '背景音乐' });
  } catch (error) {
    // The store throws a TypeError when ffmpeg cannot decode the file.
    if (error instanceof TypeError) return NextResponse.json({ error: '这个音乐文件读不出来，可能已损坏，换一个 MP3 或 WAV 再试' }, { status: 400 });
    console.error({ code: 'DRAMA_MUSIC_UPLOAD_FAILED', error });
    return NextResponse.json({ error: '音乐上传失败，请稍后重试' }, { status: 500 });
  }
}
