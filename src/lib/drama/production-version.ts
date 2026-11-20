/** Pure, client-safe output dependencies. These canonical JSON strings are version bindings, not authentication hashes. */
import type {
  DramaCastMember, DramaEpisode, DramaLocation, DramaProjectV1, DramaProp, DramaSceneBlock, DramaShot, DramaTake,
} from './types';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Sort object keys, preserving array order wherever it carries reference priority or film order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
  });
}

/** Fixed-size version records keep long scripts and many takes inside the existing document budget. */
function version(value: { kind: string; input?: unknown; [key: string]: unknown }): string {
  return canonical({ digest: bytesToHex(sha256(new TextEncoder().encode(canonical(value)))), kind: value.kind, version: 2 });
}

function episodeFor(doc: DramaProjectV1, episodeId: string): DramaEpisode {
  const episode = doc.episodes.find(item => item.id === episodeId);
  if (!episode) throw new Error('DRAMA_SNAPSHOT_EPISODE_NOT_FOUND');
  return episode;
}

function shotContext(doc: DramaProjectV1, episodeId: string, shotId: string) {
  const episode = episodeFor(doc, episodeId);
  for (const scene of episode.scenes) {
    const shot = scene.shots.find(item => item.id === shotId);
    if (shot) return { episode, scene, shot };
  }
  throw new Error('DRAMA_SNAPSHOT_SHOT_NOT_FOUND');
}

function hasShot(doc: DramaProjectV1, episodeId: string, shotId: string): boolean {
  return Boolean(doc.episodes.find(item => item.id === episodeId)?.scenes.some(scene => scene.shots.some(shot => shot.id === shotId)));
}

function speakerFor(doc: DramaProjectV1, shot: DramaShot): DramaCastMember | undefined {
  return doc.cast.find(member => member.id === shot.speakerId) ?? doc.cast.find(member => member.id === shot.characterIds?.[0]);
}

function voiceInputs(doc: DramaProjectV1, shot: DramaShot) {
  const speaker = speakerFor(doc, shot);
  return {
    dialogue: shot.dialogue?.trim() || '',
    speakerId: shot.speakerId,
    resolvedSpeakerId: speaker?.id,
    voice: speaker?.voice || 'alloy',
    voiceSampleUrl: speaker?.voiceSampleUrl,
    voiceSampleSec: speaker?.voiceSampleSec,
  };
}

function castInputs(member: DramaCastMember) {
  return {
    id: member.id, name: member.name, role: member.role, age: member.age, gender: member.gender, ethnicity: member.ethnicity,
    style: member.style, appearance: member.appearance, costume: member.costume, hair: member.hair,
    accessories: member.accessories, expression: member.expression, keywords: member.keywords,
    images: member.lockedImageUrl ? [member.lockedImageUrl] : [
      member.imageUrlFront || member.frontUrl, member.imageUrlFace, member.imageUrlSide || member.sideUrl,
      member.imageUrlBack, member.imageUrlFull,
    ].filter(Boolean),
  };
}

function locationInputs(location: DramaLocation | undefined) {
  return location ? {
    id: location.id, name: location.name, description: location.description, location: location.location,
    timeOfDay: location.timeOfDay, weather: location.weather, lighting: location.lighting, mood: location.mood,
    colorPalette: location.colorPalette, keyProps: location.keyProps, keywords: location.keywords, lightingHint: location.lightingHint,
    image: location.lockedImageUrl || location.imageUrl,
  } : undefined;
}

function propInputs(prop: DramaProp) {
  return {
    id: prop.id, name: prop.name, role: prop.role, category: prop.category, description: prop.description,
    material: prop.material, color: prop.color, scale: prop.scale, keywords: prop.keywords,
    image: prop.lockedImageUrl || prop.imageUrl,
  };
}

/** Bind current and parsed scene text, not episode-wide timestamps or offsets shifted by another scene. */
function sourceInputs(episode: DramaEpisode, scene: DramaSceneBlock) {
  const range = scene.sourceRange;
  const valid = range && Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end >= range.start
    && range.end <= (episode.structuredScript ?? episode.script).length;
  return {
    text: episode.structuredScript !== undefined && episode.script !== episode.structuredScript ? episode.script
      : valid ? episode.script.slice(range.start, range.end) : episode.script,
    structuredText: episode.structuredScript === undefined ? undefined
      : valid ? episode.structuredScript.slice(range.start, range.end) : episode.structuredScript,
    sourceChanged: Boolean(scene.sourceChanged),
    sourceText: scene.sourceText,
  };
}

function shotInputs(doc: DramaProjectV1, episode: DramaEpisode, scene: DramaSceneBlock, shot: DramaShot) {
  const castIds = Array.isArray(shot.characterIds) ? shot.characterIds : [];
  const propIds = Array.isArray(shot.propIds) ? shot.propIds : [];
  const locationId = shot.sceneId || scene.locationId;
  const at = scene.shots.findIndex(item => item.id === shot.id);
  const previous = at > 0 ? scene.shots[at - 1] : undefined;
  const inheritsFrame = !shot.firstFrameUrl && shot.firstFrameFromPrev !== false && previous
    && (!previous.sceneId || !shot.sceneId || previous.sceneId === shot.sceneId);
  return {
    episodeId: episode.id, sceneId: scene.id, shotId: shot.id,
    source: sourceInputs(episode, scene),
    scene: { heading: scene.heading, summary: scene.summary, locationId: scene.locationId },
    style: doc.style, projectAspectRatio: doc.aspectRatio,
    prompt: shot.prompt, directedPrompt: shot.directedPrompt, purpose: shot.purpose, actionBeat: shot.actionBeat,
    shotSize: shot.shotSize, cameraMove: shot.cameraMove, cameraMotion: shot.cameraMotion,
    lighting: shot.lighting, audioCues: shot.audioCues, setting: shot.setting,
    camera: shot.camera ? { type: shot.camera.type, intensity: shot.camera.intensity, speed: shot.camera.speed } : undefined,
    motion: shot.motion ? {
      maskDataUrl: shot.motion.maskDataUrl,
      trajectories: (Array.isArray(shot.motion.trajectories) ? shot.motion.trajectories : []).filter(Boolean).map(path => ({
        startX: path.startX, startY: path.startY, endX: path.endX, endY: path.endY, speed: path.speed,
      })),
    } : undefined,
    firstFramePrompt: shot.firstFramePrompt, lastFramePrompt: shot.lastFramePrompt,
    firstFrameUrl: shot.firstFrameUrl, lastFrameUrl: shot.lastFrameUrl, firstFrameFromPrev: shot.firstFrameFromPrev,
    duration: shot.duration, durationSec: shot.durationSec, aspectRatio: shot.aspectRatio || doc.aspectRatio,
    modelId: shot.modelId, providerId: shot.providerId,
    references: (Array.isArray(shot.references) ? shot.references : []).filter(reference => reference && typeof reference === 'object').map(reference => ({ id: reference.id, url: reference.url, role: reference.role, weight: reference.weight })),
    predecessor: previous ? { actionBeat: previous.actionBeat, prompt: previous.prompt,
      ...(inheritsFrame ? { videoUrl: activeMediaTake(previous)?.videoUrl, trimEndSec: previous.clipEdit?.trimEndSec } : {}) } : undefined,
    continuityNotes: shot.continuityNotes,
    characterIds: castIds, locationId, propIds,
    cast: castIds.map(id => {
      const member = doc.cast.find(item => item.id === id);
      return member ? castInputs(member) : { id, missing: true };
    }),
    location: locationInputs(doc.locations.find(item => item.id === locationId)),
    props: propIds.map(id => {
      const prop = doc.props.find(item => item.id === id);
      return prop ? propInputs(prop) : { id, missing: true };
    }),
    voice: voiceInputs(doc, shot), voiceSampleOff: Boolean(shot.voiceSampleOff), generateAudio: shot.generateAudio,
  };
}

/** Excludes take history, current selection, progress, editing and ordering. Freeze at submission time. */
export function shotInputSnapshot(doc: DramaProjectV1, episodeId: string, shotId: string): string {
  const { episode, scene, shot } = shotContext(doc, episodeId, shotId);
  return version({ kind: 'shot', input: shotInputs(doc, episode, scene, shot) });
}

export function voiceoverInputSnapshot(doc: DramaProjectV1, shot: DramaShot): string {
  return version({ kind: 'voiceover', input: voiceInputs(doc, shot) });
}

/** Input currency only; a submitted take may still be current while it is processing. */
export function isTakeCurrent(doc: DramaProjectV1, episodeId: string, shot: DramaShot, take: DramaTake): boolean {
  if (!hasShot(doc, episodeId, shot.id)) return false;
  const episode = episodeFor(doc, episodeId);
  if (episode.structuredScript !== undefined && episode.structuredScript !== episode.script) return false;
  if (take.inputSnapshot === undefined) return !shotContext(doc, episodeId, shot.id).scene.sourceChanged;
  return take.inputSnapshot === shotInputSnapshot(doc, episodeId, shot.id);
}

/** Mirror activeTake's media choice, then validate it. Never replace stale selected media with history. */
export function currentTakeForShot(doc: DramaProjectV1, episodeId: string, shot: DramaShot): DramaTake | undefined {
  const take = activeMediaTake(shot);
  return take && isTakeCurrent(doc, episodeId, shot, take) ? take : undefined;
}

function activeMediaTake(shot: DramaShot): DramaTake | undefined {
  return shot.takes.find(take => take.id === shot.selectedTakeId && take.status === 'completed' && take.videoUrl)
    ?? [...shot.takes].reverse().find(take => take.status === 'completed' && take.videoUrl);
}

export function isVoiceoverCurrent(doc: DramaProjectV1, shot: DramaShot): boolean {
  const line = shot.dialogue?.trim();
  if (!line || !shot.voiceoverUrl) return false;
  return shot.voiceoverSnapshot === undefined ? shot.voiceoverText === line
    : shot.voiceoverSnapshot === voiceoverInputSnapshot(doc, shot);
}

function clipInputs(doc: DramaProjectV1, episodeId: string, shot: DramaShot) {
  const take = activeMediaTake(shot);
  const still = shot.still && shot.firstFrameUrl;
  return {
    shotId: shot.id, durationSec: shot.durationSec,
    media: still ? { kind: 'still', imageUrl: shot.firstFrameUrl, motion: shot.still!.motion }
      : take ? { kind: 'video', takeId: take.id, videoUrl: take.videoUrl, current: isTakeCurrent(doc, episodeId, shot, take) } : { kind: 'missing' },
    edit: !still && shot.clipEdit ? {
      trimStartSec: shot.clipEdit.trimStartSec, trimEndSec: shot.clipEdit.trimEndSec, speed: shot.clipEdit.speed, volume: shot.clipEdit.volume,
    } : undefined,
    voice: voiceInputs(doc, shot),
    voiceoverUrl: isVoiceoverCurrent(doc, shot) ? shot.voiceoverUrl : undefined,
  };
}

function filmInputs(doc: DramaProjectV1, episode: DramaEpisode) {
  return {
    episodeId: episode.id, aspectRatio: doc.aspectRatio,
    transition: doc.timeline.transition, transitionSec: doc.timeline.transitionSec, subtitles: doc.timeline.subtitles,
    music: doc.timeline.music ? { url: doc.timeline.music.url, volume: doc.timeline.music.volume, ducking: doc.timeline.music.ducking } : undefined,
    shots: episode.scenes.flatMap(scene => scene.shots.map(shot => ({
      input: shotInputs(doc, episode, scene, shot), clip: clipInputs(doc, episode.id, shot),
    }))),
  };
}

export function filmInputSnapshot(doc: DramaProjectV1, episodeId: string): string {
  return version({ kind: 'film', input: filmInputs(doc, episodeFor(doc, episodeId)) });
}

export function isFilmCurrent(doc: DramaProjectV1, episodeId: string): boolean {
  const last = doc.timeline.lastRender;
  if (!last || last.status !== 'completed' || !last.videoUrl || last.sourceChanged
    || (last.episodeId !== undefined && last.episodeId !== episodeId) || !doc.episodes.some(episode => episode.id === episodeId)) return false;
  return last.inputSnapshot === undefined || last.inputSnapshot === filmInputSnapshot(doc, episodeId);
}

export interface QuoteModelSelection {
  videoModelId?: string;
  videoProviderId?: string;
  imageModelId?: string;
  imageProviderId?: string;
  generateAudio?: boolean;
}

/**
 * Complete INITIAL quote binding, including inputs for missing bible images and keyframes.
 * A completed image/take/voice changes paid gaps. Use the starting binding before dispatch;
 * during a run compare the remaining work with its quoted plan, not with this initial string.
 */
export function quoteInputSnapshot(doc: DramaProjectV1, episodeId: string, selection: QuoteModelSelection): string {
  const episode = episodeFor(doc, episodeId);
  const shots = episode.scenes.flatMap(scene => scene.shots);
  const castIds = new Set([...episode.scenes.flatMap(scene => scene.characterIds ?? []), ...shots.flatMap(shot => shot.characterIds ?? [])]);
  const locationIds = new Set([...episode.scenes.map(scene => scene.locationId), ...shots.map(shot => shot.sceneId)]);
  const propIds = new Set(shots.flatMap(shot => shot.propIds ?? []));
  // planner is optional and is added by the planner integration; project records and provider configs never enter this projection.
  const planner = (doc as DramaProjectV1 & { planner?: { modelId: string; providerId: string } }).planner;
  return version({
    version: 1, kind: 'quote',
    selection: { videoModelId: selection.videoModelId, videoProviderId: selection.videoProviderId,
      imageModelId: selection.imageModelId, imageProviderId: selection.imageProviderId, generateAudio: selection.generateAudio },
    planner: planner ? { modelId: planner.modelId, providerId: planner.providerId } : undefined,
    genre: doc.genre, style: doc.style, aspectRatio: doc.aspectRatio,
    source: { script: episode.script, structuredScript: episode.structuredScript, logline: episode.logline },
    scenes: episode.scenes.map(scene => ({ id: scene.id, heading: scene.heading, summary: scene.summary,
      locationId: scene.locationId, characterIds: scene.characterIds, source: sourceInputs(episode, scene) })),
    cast: [...castIds].sort().map(id => {
      const member = doc.cast.find(item => item.id === id);
      return member ? { ...castInputs(member), frontPrompt: member.frontPrompt, sidePrompt: member.sidePrompt, visualPrompt: member.visualPrompt } : { id, missing: true };
    }),
    locations: [...locationIds].filter((id): id is string => Boolean(id)).sort().map(id => {
      const location = doc.locations.find(item => item.id === id);
      return location ? { ...locationInputs(location), scenePrompt: location.scenePrompt, visualPrompt: location.visualPrompt } : { id, missing: true };
    }),
    props: [...propIds].sort().map(id => {
      const prop = doc.props.find(item => item.id === id);
      return prop ? { ...propInputs(prop), propPrompt: prop.propPrompt } : { id, missing: true };
    }),
    references: doc.references?.map(reference => ({ url: reference.url })),
    film: filmInputs(doc, episode),
  });
}

/** Rebind only outputs proven current before an archive's URLs changed. Obsolete outputs stay obsolete. */
export function rebaseImportedProduction(original: DramaProjectV1, imported: DramaProjectV1): DramaProjectV1 {
  const next = structuredClone(imported);
  for (const episode of next.episodes) for (const scene of episode.scenes) for (const shot of scene.shots) {
    const beforeEpisode = original.episodes.find(item => item.id === episode.id);
    const before = beforeEpisode?.scenes.flatMap(item => item.shots).find(item => item.id === shot.id);
    if (!before) continue;
    for (const take of shot.takes) {
      const previous = before.takes.find(item => item.id === take.id);
      if (previous && isTakeCurrent(original, episode.id, before, previous)) take.inputSnapshot = shotInputSnapshot(next, episode.id, shot.id);
    }
    if (isVoiceoverCurrent(original, before)) shot.voiceoverSnapshot = voiceoverInputSnapshot(next, shot);
  }
  const last = next.timeline.lastRender;
  const episodeId = last?.episodeId ?? (next.episodes.length === 1 ? next.episodes[0].id : undefined);
  if (last && episodeId && isFilmCurrent(original, episodeId)) last.inputSnapshot = filmInputSnapshot(next, episodeId);
  return next;
}
