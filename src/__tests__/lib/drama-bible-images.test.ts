import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_HISTORY, setSlotImage, slotHistory, slotImage, type BibleSlot } from '@/lib/drama/bible-images';
import { parseDramaProject } from '@/lib/drama/schema';
import { createEmptyDramaProject, type DramaProjectV1 } from '@/lib/drama/types';
import { uploadReferenceImage } from '@/lib/drama/workbench-client';

function doc(): DramaProjectV1 {
  return {
    ...createEmptyDramaProject({ title: '招财猫' }),
    cast: [{ id: 'lin', name: '林辰', appearance: '短发', imageUrlFront: '/img/a.png', lockedImageUrl: '/img/a.png' }],
    locations: [{ id: 'shop', name: '小店' }],
    props: [{ id: 'ticket', name: '彩票', imageUrl: '/img/t1.png' }],
  };
}

const front: BibleSlot = { kind: 'cast', id: 'lin', view: 'front' };
const side: BibleSlot = { kind: 'cast', id: 'lin', view: 'side' };
const plate: BibleSlot = { kind: 'location', id: 'shop', view: 'plate' };
const sheet: BibleSlot = { kind: 'prop', id: 'ticket', view: 'sheet' };

describe('drama bible image history', () => {
  it('keeps the replaced image as the newest earlier version and leaves the lock alone', () => {
    const next = setSlotImage(doc(), front, '/img/b.png');
    expect(slotImage(next, front)).toBe('/img/b.png');
    expect(slotHistory(next, front)).toEqual(['/img/a.png']);
    expect(next.cast[0].lockedImageUrl).toBe('/img/a.png');
    // Views keep separate histories.
    expect(slotHistory(next, side)).toEqual([]);
  });

  it('swaps places when an earlier version is restored', () => {
    const replaced = setSlotImage(setSlotImage(doc(), front, '/img/b.png'), front, '/img/c.png');
    expect(slotHistory(replaced, front)).toEqual(['/img/b.png', '/img/a.png']);
    const restored = setSlotImage(replaced, front, '/img/a.png');
    expect(slotImage(restored, front)).toBe('/img/a.png');
    expect(slotHistory(restored, front)).toEqual(['/img/c.png', '/img/b.png']);
  });

  it('starts an empty slot without history, ignores no-op edits and caps the history', () => {
    const first = setSlotImage(doc(), plate, '/img/p0.png');
    expect(slotImage(first, plate)).toBe('/img/p0.png');
    expect(slotHistory(first, plate)).toEqual([]);
    expect(setSlotImage(first, plate, '/img/p0.png')).toBe(first);
    expect(setSlotImage(first, { ...plate, id: 'gone' }, '/img/x.png')).toBe(first);

    let many = doc();
    for (let i = 2; i <= MAX_IMAGE_HISTORY + 4; i += 1) many = setSlotImage(many, sheet, `/img/t${i}.png`);
    const history = slotHistory(many, sheet);
    expect(history).toHaveLength(MAX_IMAGE_HISTORY);
    expect(history[0]).toBe(`/img/t${MAX_IMAGE_HISTORY + 3}.png`);
    expect(history).not.toContain('/img/t1.png');
  });

  it('survives a save round trip through the schema', () => {
    const next = setSlotImage(setSlotImage(doc(), front, '/img/b.png'), sheet, '/img/t2.png');
    const parsed = parseDramaProject(next);
    expect(parsed.cast[0].imageHistory).toEqual({ front: ['/img/a.png'] });
    expect(parsed.props[0].imageHistory).toEqual({ sheet: ['/img/t1.png'] });
    const tooMany = { ...next, cast: [{ ...next.cast[0], imageHistory: { front: Array.from({ length: MAX_IMAGE_HISTORY + 1 }, (_, i) => `/img/${i}.png`) } }] };
    expect(() => parseDramaProject(tooMany)).toThrow('DRAMA_DOC_INVALID');
  });
});

describe('drama reference upload', () => {
  const file = () => new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' });
  const answer = (status: number, data: unknown) => async () => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  it('returns the stored URL', async () => {
    await expect(uploadReferenceImage(file(), answer(200, { success: true, url: '/api/serve-upload/uploads/x.png' }))).resolves.toBe('/api/serve-upload/uploads/x.png');
  });

  it('turns the English server errors into what the user should change', async () => {
    await expect(uploadReferenceImage(file(), answer(400, { error: 'File too large (max 20MB)' }))).rejects.toThrow('图片超过 20MB，压缩后再上传');
    await expect(uploadReferenceImage(file(), answer(400, { error: 'File content does not match image format' }))).rejects.toThrow(/只能上传 PNG/);
    await expect(uploadReferenceImage(file(), answer(401, { error: 'Unauthorized' }))).rejects.toThrow(/重新登录/);
    await expect(uploadReferenceImage(file(), async () => { throw new TypeError('fetch failed'); })).rejects.toThrow('网络中断，图片没有上传，请重试');
  });
});
