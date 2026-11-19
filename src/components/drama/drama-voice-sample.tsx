'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AudioLines, Loader2, Trash2 } from 'lucide-react';
import { shotVoiceSample, type ShotModelCapability } from '@/lib/drama/shot-runner';
import type { DramaCastMember, DramaShot } from '@/lib/drama/types';
import { shotSpeaker } from '@/lib/drama/voiceover';
import { uploadVoiceSample } from '@/lib/drama/workbench-client';
import { updateCastMember, updateShot } from '@/lib/drama/workbench-state';
import { useDrama } from './drama-context';

/** The voice sample row on a cast card: upload, listen, replace or remove. */
export function VoiceSampleField({ member }: { member: DramaCastMember }) {
  const { update } = useDrama();
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<DramaCastMember>) => update(current => updateCastMember(current, member.id, patch));
  const pick = async (file: File) => {
    setUploading(true);
    try {
      const stored = await uploadVoiceSample(file);
      set({ voiceSampleUrl: stored.url, voiceSampleName: stored.name, voiceSampleSec: stored.durationSec });
      toast.success(`${member.name}的声音样本已添加`, { description: '支持参考音频的视频模型会用这个声音说台词。' });
    } catch (error) {
      toast.error('声音样本上传失败', { description: error instanceof Error && error.message ? error.message : '请稍后重试' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <input ref={picker} type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,.mp3,.wav" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void pick(file); }} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="drama-label shrink-0">声音样本</span>
        <button type="button" className="drama-btn drama-btn--quiet min-h-8 whitespace-nowrap px-2 text-xs" disabled={uploading}
          aria-label={`${member.voiceSampleUrl ? '换一段' : '上传'}${member.name}的声音样本`} onClick={() => picker.current?.click()}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <AudioLines className="h-3.5 w-3.5" aria-hidden />}
          {uploading ? '正在上传' : member.voiceSampleUrl ? '换一段' : '上传'}
        </button>
        {member.voiceSampleUrl ? (
          <>
            {/* The length stays visible when a long file name is cut. */}
            <span className="flex min-w-0 flex-1 gap-1 text-xs">
              <span className="truncate" title={member.voiceSampleName}>{member.voiceSampleName || '声音样本'}</span>
              {member.voiceSampleSec ? <span className="shrink-0 tabular-nums">{member.voiceSampleSec.toFixed(1)} 秒</span> : null}
            </span>
            <button type="button" className="drama-btn drama-btn--quiet min-h-8 px-2" aria-label={`去掉${member.name}的声音样本`}
              onClick={() => set({ voiceSampleUrl: undefined, voiceSampleName: undefined, voiceSampleSec: undefined })}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : null}
      </div>
      {member.voiceSampleUrl
        ? <audio src={member.voiceSampleUrl} controls preload="none" className="h-8 w-full" aria-label={`${member.name}的声音样本`} />
        : <p className="drama-label">2–15 秒的 MP3 或 WAV，一两句清楚的台词。视频模型支持参考音频时，{member.name || '这个角色'}的台词会用这个声音说。不扣积分。</p>}
    </div>
  );
}

/**
 * The voice line in the inspector's "next generation" panel: which sample goes out and what it changes,
 * with a per-shot switch.
 */
export function ShotVoiceSampleNote({ shot, capability, images }: {
  shot: DramaShot; capability: ShotModelCapability | undefined; images: number;
}) {
  const { doc, update } = useDrama();
  const speaker = shotSpeaker(shot, doc.cast);
  if (!shot.dialogue?.trim() || !speaker?.voiceSampleUrl) return null;
  const sent = capability ? shotVoiceSample(shot, doc.cast, capability, images) : undefined;
  let note: string;
  if (!capability?.maxReferenceAudios) note = '当前视频模型不接受参考音频，这一镜不会带上声音样本。';
  else if (shot.voiceSampleOff) note = '这一镜不带声音样本，台词由模型自己配音。';
  else if (!sent) note = '要有首帧或角色参考图才能带上声音样本。';
  else note = `台词用${speaker.name}的声音样本说。带声音样本时，首帧和尾帧会改作参考图，开场画面不一定完全一样。`;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs">声音：{note}</p>
      {capability?.maxReferenceAudios ? (
        <label className="flex items-center gap-2 text-xs text-[var(--drama-muted)]">
          <input type="checkbox" checked={!shot.voiceSampleOff}
            onChange={event => update(current => updateShot(current, shot.id, { voiceSampleOff: event.target.checked ? undefined : true }))} />
          这一镜带上{speaker.name}的声音样本
        </label>
      ) : null}
    </div>
  );
}
