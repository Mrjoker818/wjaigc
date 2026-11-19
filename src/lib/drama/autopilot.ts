/** One-click film: what each production stage still lacks for an episode, so a run only fills the gaps. */
import {
  CAST_IMAGE_RATIO, castImagePrompt, locationImagePrompt, locationImageRatio, PROP_IMAGE_RATIO, propImagePrompt,
} from './reference-prompts';
import { activeTake, type DramaCastMember, type DramaLocation, type DramaProjectV1, type DramaProp, type DramaShot } from './types';
import { shotsNeedingVoiceover } from './voiceover';
import { updateCastMember, updateLocation, updateProp } from './workbench-state';

/** Stages in the order a run goes through them. */
export const AUTOPILOT_STAGES = ['bible', 'keyframes', 'shots', 'voiceover', 'render'] as const;
export type AutopilotStage = typeof AUTOPILOT_STAGES[number];

export interface BibleGap {
  /** Estimate key, also unique across kinds. */
  key: string;
  kind: 'cast' | 'location' | 'prop';
  id: string;
  name: string;
}

export interface AutopilotPlan {
  /** Scenes with no shots yet; their shots cannot be priced until the scene is split. */
  scenes: string[];
  /** Cast, locations and props the episode shows that have no image yet. */
  bible: BibleGap[];
  /** Shots still without a video and without a first frame, in episode order. */
  keyframes: string[];
  /** Shots still without a usable video, in episode order. */
  shots: string[];
  /** Shots whose line has no current recording. */
  voiceovers: string[];
}

const castHasImage = (member: DramaCastMember) =>
  Boolean(member.lockedImageUrl || member.imageUrlFront || member.frontUrl || member.imageUrlSide || member.sideUrl || member.imageUrlFull);
const hasImage = (item: DramaLocation | DramaProp) => Boolean(item.lockedImageUrl || item.imageUrl);

/** `needsKeyframe` leaves out shots whose model cannot start from an image, so no keyframe is paid for in vain. */
export function autopilotPlan(
  doc: DramaProjectV1, episodeId: string, needsKeyframe: (shot: DramaShot) => boolean = () => true,
): AutopilotPlan {
  const episode = doc.episodes.find(item => item.id === episodeId);
  const scenes = episode?.scenes ?? [];
  const shots = scenes.flatMap(scene => scene.shots);
  const castIds = new Set([...scenes.flatMap(scene => scene.characterIds ?? []), ...shots.flatMap(shot => shot.characterIds ?? [])]);
  const locationIds = new Set([
    ...scenes.map(scene => scene.locationId), ...shots.map(shot => shot.sceneId),
  ].filter((id): id is string => Boolean(id)));
  const propIds = new Set(shots.flatMap(shot => shot.propIds ?? []));
  const gap = (kind: BibleGap['kind'], item: { id: string; name: string }): BibleGap =>
    ({ key: `bible:${kind}:${item.id}`, kind, id: item.id, name: item.name || item.id });
  const pending = shots.filter(shot => !activeTake(shot));
  return {
    scenes: scenes.filter(scene => scene.shots.length === 0).map(scene => scene.id),
    bible: [
      ...doc.cast.filter(member => castIds.has(member.id) && !castHasImage(member)).map(member => gap('cast', member)),
      ...doc.locations.filter(location => locationIds.has(location.id) && !hasImage(location)).map(location => gap('location', location)),
      ...doc.props.filter(prop => propIds.has(prop.id) && !hasImage(prop)).map(prop => gap('prop', prop)),
    ],
    keyframes: pending.filter(shot => !shot.firstFrameUrl && needsKeyframe(shot)).map(shot => shot.id),
    shots: pending.map(shot => shot.id),
    voiceovers: shotsNeedingVoiceover(shots).map(shot => shot.id),
  };
}

/** Prompt and ratio for one missing bible image; the cast gets the front view, which every shot can use. */
export function bibleImageRequest(doc: DramaProjectV1, item: BibleGap): { prompt: string; aspectRatio: string } | null {
  if (item.kind === 'cast') {
    const member = doc.cast.find(entry => entry.id === item.id);
    return member ? { prompt: castImagePrompt(member, 'front', doc.style), aspectRatio: CAST_IMAGE_RATIO } : null;
  }
  if (item.kind === 'location') {
    const location = doc.locations.find(entry => entry.id === item.id);
    return location ? { prompt: locationImagePrompt(location, doc.style), aspectRatio: locationImageRatio(doc.aspectRatio) } : null;
  }
  const prop = doc.props.find(entry => entry.id === item.id);
  return prop ? { prompt: propImagePrompt(prop, doc.style), aspectRatio: PROP_IMAGE_RATIO } : null;
}

export function applyBibleImage(doc: DramaProjectV1, item: BibleGap, url: string): DramaProjectV1 {
  if (item.kind === 'cast') return updateCastMember(doc, item.id, { imageUrlFront: url });
  if (item.kind === 'location') return updateLocation(doc, item.id, { imageUrl: url });
  return updateProp(doc, item.id, { imageUrl: url });
}

/** Stages the user can leave out; shot videos always run, since the film needs them. */
export type AutopilotChoices = Record<'bible' | 'keyframes' | 'voiceover' | 'render', boolean>;
export type PaidStage = 'bible' | 'keyframes' | 'shots';

export interface AutopilotQuote {
  episodeId: string;
  plan: AutopilotPlan;
  /** Credits per paid stage; undefined when that stage could not be priced. */
  credits: Partial<Record<PaidStage, number>>;
  balance?: number;
}

/** A run in progress: the price the user agreed to, what they chose, and the stage being worked on. */
export interface AutopilotRun {
  quote: AutopilotQuote;
  choices: AutopilotChoices;
  stage: AutopilotStage;
}

/** Credits for the chosen stages; undefined when a chosen stage with work in it has no price. */
export function quoteTotal(quote: AutopilotQuote, choices: AutopilotChoices): number | undefined {
  const parts: Array<[boolean, number, number | undefined]> = [
    [choices.bible, quote.plan.bible.length, quote.credits.bible],
    [choices.keyframes, quote.plan.keyframes.length, quote.credits.keyframes],
    [true, quote.plan.shots.length, quote.credits.shots],
  ];
  let total = 0;
  for (const [chosen, count, credits] of parts) {
    if (!chosen || count === 0) continue;
    if (credits === undefined) return undefined;
    total += credits;
  }
  return total;
}

/** How many of the quoted items in each stage are now done. */
export function autopilotDone(quote: AutopilotQuote, now: AutopilotPlan): Record<Exclude<AutopilotStage, 'render'>, number> {
  const done = (quoted: string[], open: string[]) => quoted.filter(id => !open.includes(id)).length;
  return {
    bible: done(quote.plan.bible.map(item => item.key), now.bible.map(item => item.key)),
    keyframes: done(quote.plan.keyframes, now.keyframes),
    shots: done(quote.plan.shots, now.shots),
    voiceover: done(quote.plan.voiceovers, now.voiceovers),
  };
}

/** True when every open paid item was in the quote, so running the plan now cannot cost more than quoted. */
export function withinQuote(quote: AutopilotQuote, now: AutopilotPlan): boolean {
  const covered = (open: string[], quoted: string[]) => open.every(id => quoted.includes(id));
  return covered(now.bible.map(item => item.key), quote.plan.bible.map(item => item.key))
    && covered(now.keyframes, quote.plan.keyframes)
    && covered(now.shots, quote.plan.shots);
}
