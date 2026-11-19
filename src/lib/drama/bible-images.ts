/** Reference images of the bible (cast views, location plates, prop sheets) and the earlier versions of each. */
import type { BibleView, DramaCastMember, DramaLocation, DramaProjectV1, DramaProp } from './types';
import { updateCastMember, updateLocation, updateProp } from './workbench-state';

/** Earlier versions kept per image; the oldest drops off first. */
export const MAX_IMAGE_HISTORY = 8;

export type BibleSlot =
  | { kind: 'cast'; id: string; view: 'front' | 'side' }
  | { kind: 'location'; id: string; view: 'plate' }
  | { kind: 'prop'; id: string; view: 'sheet' };

type BibleItem = DramaCastMember | DramaLocation | DramaProp;

function item(doc: DramaProjectV1, slot: BibleSlot): BibleItem | undefined {
  const list: BibleItem[] = slot.kind === 'cast' ? doc.cast : slot.kind === 'location' ? doc.locations : doc.props;
  return list.find(entry => entry.id === slot.id);
}

export function slotImage(doc: DramaProjectV1, slot: BibleSlot): string | undefined {
  const found = item(doc, slot);
  if (!found) return undefined;
  if (slot.kind !== 'cast') return (found as DramaLocation | DramaProp).imageUrl || undefined;
  const member = found as DramaCastMember;
  return (slot.view === 'front' ? member.imageUrlFront || member.frontUrl : member.imageUrlSide || member.sideUrl) || undefined;
}

/** Earlier versions of the slot, newest first. */
export function slotHistory(doc: DramaProjectV1, slot: BibleSlot): string[] {
  return item(doc, slot)?.imageHistory?.[slot.view] ?? [];
}

function patch(doc: DramaProjectV1, slot: BibleSlot, url: string, history: string[]): DramaProjectV1 {
  const found = item(doc, slot);
  if (!found) return doc;
  const imageHistory: Partial<Record<BibleView, string[]>> = { ...found.imageHistory, [slot.view]: history };
  if (slot.kind === 'cast') {
    return updateCastMember(doc, slot.id, slot.view === 'front' ? { imageUrlFront: url, imageHistory } : { imageUrlSide: url, imageHistory });
  }
  return slot.kind === 'location'
    ? updateLocation(doc, slot.id, { imageUrl: url, imageHistory })
    : updateProp(doc, slot.id, { imageUrl: url, imageHistory });
}

/**
 * Shows `url` in the slot and keeps the image it replaces as the newest earlier version.
 * Restoring an earlier version goes through here too, so the two images swap places.
 * The lock is left alone: shots keep their locked reference until the user locks the new image.
 */
export function setSlotImage(doc: DramaProjectV1, slot: BibleSlot, url: string): DramaProjectV1 {
  const previous = slotImage(doc, slot);
  if (!url || previous === url) return doc;
  const history = [...(previous ? [previous] : []), ...slotHistory(doc, slot).filter(entry => entry !== url && entry !== previous)];
  return patch(doc, slot, url, history.slice(0, MAX_IMAGE_HISTORY));
}
