/** A character's voice sample: an MP3 or WAV the video model hears so the character's lines keep that voice. */
import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { probeAudioSeconds, sniffAudioFormat } from '@/lib/drama/audio-upload';
import { videoForbidden } from '@/lib/drama/access';
import { persistGeneratedAudioResponse } from '@/lib/generated-audio-storage';
import { VOICE_SAMPLE_MAX_BYTES, VOICE_SAMPLE_MAX_SEC, VOICE_SAMPLE_MIN_SEC } from '@/lib/video-reference-audio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/drama/voice-sample (multipart, field "file") → { audioUrl, name, durationSec }. Costs no credits. */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const denied = videoForbidden(auth.user);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '没有收到声音文件，请重新选择' }, { status: 400 });
  if (file.size > VOICE_SAMPLE_MAX_BYTES) return NextResponse.json({ error: '声音样本超过 15MB，剪短一些再上传' }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffAudioFormat(bytes);
  if (!format) return NextResponse.json({ error: '只能上传 MP3 或 WAV 声音样本' }, { status: 400 });
  const seconds = await probeAudioSeconds(bytes, format);
  if (seconds === null) return NextResponse.json({ error: '这个声音文件读不出来，可能已损坏，换一个 MP3 或 WAV 再试' }, { status: 400 });
  if (seconds < VOICE_SAMPLE_MIN_SEC || seconds > VOICE_SAMPLE_MAX_SEC + 0.5) {
    return NextResponse.json({
      error: `声音样本要 ${VOICE_SAMPLE_MIN_SEC}–${VOICE_SAMPLE_MAX_SEC} 秒，这段是 ${seconds.toFixed(1)} 秒，剪成一两句清楚的台词再上传`,
    }, { status: 400 });
  }
  try {
    const stored = await persistGeneratedAudioResponse(
      new Response(bytes, { headers: { 'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/wav' } }), format, auth.userId,
    );
    return NextResponse.json({
      success: true, audioUrl: stored.audioUrl, name: file.name.slice(0, 200) || '声音样本', durationSec: Math.round(seconds * 10) / 10,
    });
  } catch (error) {
    // The store throws a TypeError when ffmpeg cannot decode the file.
    if (error instanceof TypeError) return NextResponse.json({ error: '这个声音文件读不出来，可能已损坏，换一个 MP3 或 WAV 再试' }, { status: 400 });
    console.error({ code: 'DRAMA_VOICE_SAMPLE_UPLOAD_FAILED', error });
    return NextResponse.json({ error: '声音样本上传失败，请稍后重试' }, { status: 500 });
  }
}
