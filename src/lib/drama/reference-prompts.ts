/** Image prompts for cast turnarounds and location plates. Kept separate so the workbench and tests share them. */
import { DIRECTOR_STYLES, type DirectorStyle } from '@/lib/video-director/director-styles';
import { stripMentions } from './mentions';
import type { DramaCastMember, DramaLocation, DramaProjectV1, DramaProp, DramaShot } from './types';

const clean = (parts: Array<string | undefined>) => parts.map(part => part?.trim()).filter(Boolean).join(', ');

export function castImagePrompt(member: DramaCastMember, view: 'front' | 'side', style: DirectorStyle): string {
  const angle = view === 'front'
    ? 'front view, facing camera, bust portrait, centered, frontal eye-level angle'
    : '3/4 side view, bust portrait, side angle';
  return clean([
    'character design reference sheet',
    member.name, member.age, member.gender,
    member.frontPrompt && view === 'front' ? member.frontPrompt : member.appearance,
    member.costume ? `wearing ${member.costume}` : undefined,
    member.hair,
    angle,
    'plain light grey background, even studio lighting, high detail, no text, no watermark, sharp focus',
    `视觉风格：${DIRECTOR_STYLES[style].planDescription}`,
  ]);
}

export function locationImagePrompt(location: DramaLocation, style: DirectorStyle): string {
  return clean([
    'establishing shot of an empty film set, no people',
    location.name, location.scenePrompt || location.description, location.location,
    location.timeOfDay, location.weather, location.lighting, location.mood,
    'cinematic composition, high detail, no text, no watermark',
    `视觉风格：${DIRECTOR_STYLES[style].planDescription}`,
  ]);
}

/**
 * Location plates follow the project ratio so they can serve as a first frame.
 * Image models are admitted by ratio; many list no pixel sizes and reject one outright.
 */
export function locationImageRatio(aspectRatio: string): string {
  if (aspectRatio === '9:16' || aspectRatio === '3:4') return '9:16';
  if (aspectRatio === '16:9' || aspectRatio === '4:3' || aspectRatio === '21:9') return '16:9';
  return '1:1';
}

export const CAST_IMAGE_RATIO = '2:3';
export const PROP_IMAGE_RATIO = '1:1';

export function propImagePrompt(prop: DramaProp, style: DirectorStyle): string {
  return clean([
    'prop design reference sheet, single object, product shot',
    prop.name, prop.propPrompt || prop.description, prop.material, prop.color, prop.scale,
    'centered, plain light grey background, even studio lighting, high detail, no people, no text, no watermark',
    `视觉风格：${DIRECTOR_STYLES[style].planDescription}`,
  ]);
}

/** Props the shot shows, in the order the shot lists them. */
export function shotProps(shot: Pick<DramaShot, 'propIds'>, props: DramaProp[]): DramaProp[] {
  return (shot.propIds ?? [])
    .map(id => props.find(prop => prop.id === id))
    .filter((prop): prop is DramaProp => Boolean(prop));
}

function shotCast(shot: DramaShot, doc: DramaProjectV1): DramaCastMember[] {
  return (shot.characterIds ?? [])
    .map(id => doc.cast.find(member => member.id === id))
    .filter((member): member is DramaCastMember => Boolean(member));
}

export type KeyframeKind = 'first' | 'last';

/**
 * The opening (or closing) frame of one shot, drawn as a still that the video model then animates.
 * The closing frame shows where the action ends, so the model moves between two fixed pictures.
 */
export function keyframePrompt(shot: DramaShot, doc: DramaProjectV1, kind: KeyframeKind = 'first'): string {
  const location = doc.locations.find(item => item.id === shot.sceneId);
  const cast = shotCast(shot, doc).map(member => clean([member.name, member.appearance, member.costume ? `wearing ${member.costume}` : undefined]));
  return clean([
    kind === 'first' ? 'cinematic film still, opening frame of the shot' : 'cinematic film still, closing frame of the shot, the action has finished',
    stripMentions(kind === 'first' ? shot.firstFramePrompt || shot.directedPrompt || shot.prompt : shot.lastFramePrompt || shot.directedPrompt || shot.prompt, doc),
    kind === 'last' && shot.actionBeat ? `ends after: ${shot.actionBeat}` : undefined,
    shot.shotSize, shot.cameraMove || shot.cameraMotion, shot.lighting,
    location ? clean([location.name, location.description, location.timeOfDay, location.lighting]) : undefined,
    ...cast,
    ...shotProps(shot, doc.props).map(prop => clean([prop.name, prop.description])),
    'keep characters and setting consistent with the reference images, no text, no watermark, no subtitles',
    `视觉风格：${DIRECTOR_STYLES[doc.style].planDescription}`,
  ]);
}

/**
 * References for a keyframe: one locked image per character in the shot, then the location plate,
 * then the shot's props, capped at what the image model accepts. A closing frame puts the opening
 * frame first so both ends of the shot match.
 */
export function keyframeReferences(shot: DramaShot, doc: DramaProjectV1, limit: number, kind: KeyframeKind = 'first'): string[] {
  const max = Math.max(0, Math.floor(limit));
  if (max === 0) return [];
  const location = doc.locations.find(item => item.id === shot.sceneId);
  const urls = [
    kind === 'last' ? shot.firstFrameUrl : undefined,
    ...shotCast(shot, doc).map(member => member.lockedImageUrl || member.imageUrlFront || member.frontUrl),
    location?.lockedImageUrl || location?.imageUrl,
    ...shotProps(shot, doc.props).map(prop => prop.lockedImageUrl || prop.imageUrl),
  ].filter((url): url is string => Boolean(url));
  return [...new Set(urls)].slice(0, max);
}
