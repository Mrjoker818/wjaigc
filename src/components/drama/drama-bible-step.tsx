'use client';

import { useRef, useState } from 'react';
import { History, ImagePlus, Loader2, Lock, LockOpen, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  CAST_IMAGE_RATIO, castImagePrompt, locationImagePrompt, locationImageRatio, PROP_IMAGE_RATIO, propImagePrompt,
} from '@/lib/drama/reference-prompts';
import type { DramaCastMember, DramaLocation, DramaProp } from '@/lib/drama/types';
import { DEFAULT_VOICE, DRAMA_VOICES } from '@/lib/drama/voiceover';
import { setSlotImage, slotHistory, type BibleSlot } from '@/lib/drama/bible-images';
import { generateReferenceImage, persistImage, REFERENCE_IMAGE_TYPES, uploadReferenceImage } from '@/lib/drama/workbench-client';
import {
  nextBibleId, removeCastMember, removeLocation, removeProp, updateCastMember, updateLocation, updateProp,
} from '@/lib/drama/workbench-state';
import { useDrama } from './drama-context';

type CastView = 'front' | 'side';

/** Step 2: cast and location cards. The locked image is the reference every shot uses. */
export function DramaBibleStep() {
  const { doc, update, setStep } = useDrama();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const mark = (key: string, on: boolean) => setPending(previous => {
    const next = new Set(previous);
    if (on) next.add(key); else next.delete(key);
    return next;
  });

  const slotKey = (slot: BibleSlot) => `${slot.id}:${slot.view}`;
  // Image jobs run in parallel; each card shows its own spinner. The image a job replaces stays in the card's history.
  const fillSlot = async (slot: BibleSlot, failure: string, produce: () => Promise<string>) => {
    mark(slotKey(slot), true);
    try {
      const url = await produce();
      update(current => setSlotImage(current, slot, url));
    } catch (error) {
      toast.error(failure, { description: error instanceof Error ? error.message : '请稍后重试' });
    } finally {
      mark(slotKey(slot), false);
    }
  };
  const makeImage = (slot: BibleSlot, prompt: string, aspectRatio: string) =>
    fillSlot(slot, '设定图生成失败', async () => persistImage(await generateReferenceImage(prompt, aspectRatio)));
  const uploadImage = (slot: BibleSlot, file: File) => fillSlot(slot, '图片上传失败', () => uploadReferenceImage(file));
  const restoreImage = (slot: BibleSlot, url: string) => update(current => setSlotImage(current, slot, url));

  const castImage = (member: DramaCastMember, view: CastView) =>
    makeImage({ kind: 'cast', id: member.id, view }, castImagePrompt(member, view, doc.style), CAST_IMAGE_RATIO);
  const locationImage = (location: DramaLocation) =>
    makeImage({ kind: 'location', id: location.id, view: 'plate' }, locationImagePrompt(location, doc.style), locationImageRatio(doc.aspectRatio));
  const propImage = (prop: DramaProp) =>
    makeImage({ kind: 'prop', id: prop.id, view: 'sheet' }, propImagePrompt(prop, doc.style), PROP_IMAGE_RATIO);
  const tileActions = (slot: BibleSlot) => ({
    busy: pending.has(slotKey(slot)),
    history: slotHistory(doc, slot),
    onUpload: (file: File) => void uploadImage(slot, file),
    onRestore: (url: string) => restoreImage(slot, url),
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <p className="drama-label">生成的定妆图按图像模型价格扣费，上传自己的图不扣积分。锁定一张后，所有出场镜头都用它做角色参考或首帧。换掉的图留在下方，可以随时换回。</p>

      <section aria-labelledby="drama-cast" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="drama-cast" className="text-sm font-semibold">角色（{doc.cast.length}）</h2>
          <button type="button" className="drama-btn" onClick={() => update(current => ({
            ...current, cast: [...current.cast, { id: nextBibleId(current, 'char'), name: `角色${current.cast.length + 1}`, appearance: '' }],
          }))}><Plus className="h-4 w-4" />加角色</button>
        </div>
        {doc.cast.length === 0 ? <p className="drama-label">还没有角色。生成剧本时会自动建好主要角色，也可以手动添加。</p> : null}
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {doc.cast.map(member => (
            <li key={member.id} className="drama-panel flex flex-col gap-3 p-3">
              <div className="flex items-center gap-2">
                <input className="drama-input font-serif font-bold" aria-label="角色名" maxLength={200} value={member.name}
                  onChange={event => update(current => updateCastMember(current, member.id, { name: event.target.value }))} />
                <button type="button" className="drama-btn drama-btn--quiet" aria-label={`删除角色 ${member.name}`}
                  onClick={() => { if (window.confirm(`删除角色「${member.name}」？镜头里对它的引用也会去掉。`)) update(current => removeCastMember(current, member.id)); }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea className="drama-input min-h-20 resize-y" aria-label={`${member.name} 外貌`} maxLength={4000} value={member.appearance}
                placeholder="外貌、年龄感、气质，例如：二十五岁，短发，眼神倔强"
                onChange={event => update(current => updateCastMember(current, member.id, { appearance: event.target.value }))} />
              <input className="drama-input" aria-label={`${member.name} 服装`} maxLength={1000} value={member.costume ?? ''} placeholder="服装"
                onChange={event => update(current => updateCastMember(current, member.id, { costume: event.target.value }))} />
              <label className="flex items-center gap-2 text-sm">
                <span className="drama-label shrink-0">配音音色</span>
                <select className="drama-input flex-1" value={member.voice || DEFAULT_VOICE}
                  onChange={event => update(current => updateCastMember(current, member.id, { voice: event.target.value }))}>
                  {DRAMA_VOICES.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['front', 'side'] as const).map(view => (
                  <ReferenceTile
                    key={view} label={view === 'front' ? '正面' : '侧面'} ratio="2 / 3"
                    url={view === 'front' ? member.imageUrlFront : member.imageUrlSide}
                    locked={Boolean(member.lockedImageUrl) && member.lockedImageUrl === (view === 'front' ? member.imageUrlFront : member.imageUrlSide)}
                    {...tileActions({ kind: 'cast', id: member.id, view })}
                    disabled={!member.appearance.trim() && !member.name.trim()}
                    onGenerate={() => void castImage(member, view)}
                    onToggleLock={url => update(current => updateCastMember(current, member.id, { lockedImageUrl: member.lockedImageUrl === url ? undefined : url }))}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="drama-locations" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="drama-locations" className="text-sm font-semibold">场景（{doc.locations.length}）</h2>
          <button type="button" className="drama-btn" onClick={() => update(current => ({
            ...current, locations: [...current.locations, { id: nextBibleId(current, 'loc'), name: `场景${current.locations.length + 1}` }],
          }))}><Plus className="h-4 w-4" />加场景</button>
        </div>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {doc.locations.map(location => (
            <li key={location.id} className="drama-panel flex flex-col gap-3 p-3">
              <div className="flex items-center gap-2">
                <input className="drama-input font-serif font-bold" aria-label="场景名" maxLength={200} value={location.name}
                  onChange={event => update(current => updateLocation(current, location.id, { name: event.target.value }))} />
                <button type="button" className="drama-btn drama-btn--quiet" aria-label={`删除场景 ${location.name}`}
                  onClick={() => { if (window.confirm(`删除场景「${location.name}」？`)) update(current => removeLocation(current, location.id)); }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea className="drama-input min-h-16 resize-y" aria-label={`${location.name} 描述`} maxLength={4000} value={location.description ?? ''}
                placeholder="环境、时间、光线，例如：深夜便利店，冷白灯管，窗外下雨"
                onChange={event => update(current => updateLocation(current, location.id, { description: event.target.value }))} />
              <ReferenceTile
                label="场景图" ratio={doc.aspectRatio.replace(':', ' / ')} url={location.imageUrl}
                locked={Boolean(location.lockedImageUrl) && location.lockedImageUrl === location.imageUrl}
                {...tileActions({ kind: 'location', id: location.id, view: 'plate' })} disabled={!location.name.trim()}
                onGenerate={() => void locationImage(location)}
                onToggleLock={url => update(current => updateLocation(current, location.id, { lockedImageUrl: location.lockedImageUrl === url ? undefined : url }))}
              />
              <p className="drama-label">有场景图时，这个场景里每场的第一个镜头会用它做首帧。</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="drama-props" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="drama-props" className="text-sm font-semibold">道具（{doc.props.length}）</h2>
          <button type="button" className="drama-btn" onClick={() => update(current => ({
            ...current, props: [...current.props, { id: nextBibleId(current, 'prop'), name: `道具${current.props.length + 1}` }],
          }))}><Plus className="h-4 w-4" />加道具</button>
        </div>
        {doc.props.length === 0 ? <p className="drama-label">还没有道具。信物、武器这类多次出现的物件，画一张设定图能让每个镜头里的样子一致。</p> : null}
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {doc.props.map(prop => (
            <li key={prop.id} className="drama-panel flex flex-col gap-3 p-3">
              <div className="flex items-center gap-2">
                <input className="drama-input font-serif font-bold" aria-label="道具名" maxLength={200} value={prop.name}
                  onChange={event => update(current => updateProp(current, prop.id, { name: event.target.value }))} />
                <button type="button" className="drama-btn drama-btn--quiet" aria-label={`删除道具 ${prop.name}`}
                  onClick={() => { if (window.confirm(`删除道具「${prop.name}」？镜头里对它的引用也会去掉。`)) update(current => removeProp(current, prop.id)); }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea className="drama-input min-h-16 resize-y" aria-label={`${prop.name} 外观`} maxLength={4000} value={prop.description ?? ''}
                placeholder="外观、材质、颜色，例如：泛黄的旧彩票，边角卷起"
                onChange={event => update(current => updateProp(current, prop.id, { description: event.target.value }))} />
              <ReferenceTile
                label="道具图" ratio="1 / 1" url={prop.imageUrl}
                locked={Boolean(prop.lockedImageUrl) && prop.lockedImageUrl === prop.imageUrl}
                {...tileActions({ kind: 'prop', id: prop.id, view: 'sheet' })} disabled={!prop.name.trim()}
                onGenerate={() => void propImage(prop)}
                onToggleLock={url => update(current => updateProp(current, prop.id, { lockedImageUrl: prop.lockedImageUrl === url ? undefined : url }))}
              />
              <p className="drama-label">镜头里勾选这个道具后，它的图会排在角色之后做参考。</p>
            </li>
          ))}
        </ul>
      </section>

      <div>
        <button type="button" className="drama-btn drama-btn--primary" onClick={() => setStep('board')}>下一步：拆分镜</button>
      </div>
    </div>
  );
}

function ReferenceTile({ label, ratio, url, locked, busy, disabled, history, onGenerate, onUpload, onRestore, onToggleLock }: {
  label: string;
  ratio: string;
  url?: string;
  locked: boolean;
  busy: boolean;
  /** Generating needs a name or description; uploading does not. */
  disabled: boolean;
  /** Earlier versions, newest first. */
  history: string[];
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onRestore: (url: string) => void;
  onToggleLock: (url: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden rounded-md bg-[var(--drama-ink)]" style={{ aspectRatio: ratio }}>
        {url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={url} alt={`${label}定妆图`} className="h-full w-full object-cover" />
          : <span className="absolute inset-0 flex items-center justify-center text-xs text-[var(--drama-muted)]">{label}</span>}
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50" role="status">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /><span className="sr-only">正在处理{label}</span>
          </span>
        ) : null}
        {locked ? <span className="absolute left-1 top-1 rounded bg-[var(--drama-green)] px-1.5 py-0.5 text-[11px] text-[var(--drama-ink)]">已锁定</span> : null}
      </div>
      <div className="flex gap-1">
        {/* Three buttons share a narrow tile once an image exists, so the visible label stays short and on one line. */}
        <button type="button" className="drama-btn min-w-0 flex-1 whitespace-nowrap px-2 text-xs" disabled={busy || disabled} onClick={onGenerate}
          aria-label={url ? `重新生成${label}` : undefined}>
          <ImagePlus className="h-3.5 w-3.5 shrink-0" />{url ? '重画' : `生成${label}`}
        </button>
        <input ref={picker} type="file" accept={REFERENCE_IMAGE_TYPES} className="sr-only" tabIndex={-1} aria-hidden="true"
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onUpload(file);
          }} />
        <button type="button" className="drama-btn px-2" disabled={busy} aria-label={`上传${label}`} title="上传自己的图，不扣积分"
          onClick={() => picker.current?.click()}>
          <Upload className="h-3.5 w-3.5" />
        </button>
        {url ? (
          <button type="button" className="drama-btn px-2" aria-pressed={locked} aria-label={locked ? `取消锁定${label}` : `锁定${label}`} onClick={() => onToggleLock(url)}>
            {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>
      {history.length ? (
        <div className="flex items-center gap-1" role="group" aria-label={`${label}的旧版本`}>
          <History className="h-3.5 w-3.5 shrink-0 text-[var(--drama-muted)]" aria-hidden="true" />
          <ul className="flex min-w-0 gap-1 overflow-x-auto">
            {history.map((old, i) => (
              <li key={old} className="shrink-0">
                <button type="button" className="block h-9 w-9 overflow-hidden rounded border border-[var(--drama-line)] hover:border-[var(--drama-gold)]"
                  disabled={busy} aria-label={`换回${label}第 ${i + 1} 个旧版本`} title="换回这一版，当前的图会留在这里" onClick={() => onRestore(old)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={old} alt="" className="h-full w-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
