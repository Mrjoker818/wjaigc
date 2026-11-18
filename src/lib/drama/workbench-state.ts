/** Pure edits on a drama document for the workbench. Every function returns a new document and leaves the input untouched. */
import {
  activeTake, MAX_SHOTS_PER_EPISODE,
  type DramaCastMember, type DramaEpisode, type DramaLocation, type DramaProjectV1, type DramaProp, type DramaSceneBlock, type DramaShot, type DramaTake,
} from './types';

export interface ShotLocation {
  episode: DramaEpisode;
  scene: DramaSceneBlock;
  shot: DramaShot;
  /** 0-based position of the scene in the episode. */
  sceneIndex: number;
  /** 0-based position of the shot in its scene. */
  shotIndex: number;
}

export function findShot(doc: DramaProjectV1, shotId: string): ShotLocation | undefined {
  for (const episode of doc.episodes) {
    for (const [sceneIndex, scene] of episode.scenes.entries()) {
      const shotIndex = scene.shots.findIndex(shot => shot.id === shotId);
      if (shotIndex >= 0) return { episode, scene, shot: scene.shots[shotIndex], sceneIndex, shotIndex };
    }
  }
  return undefined;
}

function withIndexes(shots: DramaShot[]): DramaShot[] {
  return shots.map((shot, index) => (shot.index === index ? shot : { ...shot, index }));
}

/** Returns `doc` itself when no scene changed, so a no-op edit does not trigger a save. */
function mapScenes(doc: DramaProjectV1, fn: (scene: DramaSceneBlock, episode: DramaEpisode) => DramaSceneBlock): DramaProjectV1 {
  const episodes = doc.episodes.map(episode => {
    const scenes = episode.scenes.map(scene => fn(scene, episode));
    return scenes.every((scene, i) => scene === episode.scenes[i]) ? episode : { ...episode, scenes };
  });
  return episodes.every((episode, i) => episode === doc.episodes[i]) ? doc : { ...doc, episodes };
}

export function updateEpisode(doc: DramaProjectV1, episodeId: string, patch: Partial<Omit<DramaEpisode, 'id' | 'scenes'>>): DramaProjectV1 {
  return { ...doc, episodes: doc.episodes.map(episode => (episode.id === episodeId ? { ...episode, ...patch } : episode)) };
}

export function updateScene(doc: DramaProjectV1, sceneId: string, patch: Partial<Omit<DramaSceneBlock, 'id' | 'shots'>>): DramaProjectV1 {
  return mapScenes(doc, scene => (scene.id === sceneId ? { ...scene, ...patch } : scene));
}

export function setSceneShots(doc: DramaProjectV1, sceneId: string, shots: DramaShot[]): DramaProjectV1 {
  return mapScenes(doc, scene => (scene.id === sceneId ? { ...scene, shots: withIndexes(shots) } : scene));
}

export function updateShot(doc: DramaProjectV1, shotId: string, patch: Partial<DramaShot> | ((shot: DramaShot) => DramaShot)): DramaProjectV1 {
  return mapScenes(doc, scene => {
    const i = scene.shots.findIndex(shot => shot.id === shotId);
    if (i < 0) return scene;
    const current = scene.shots[i];
    const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    if (next === current) return scene;
    // Duration is stored twice for the shared VideoShotPlan type; keep them in step.
    const synced = next.durationSec !== current.durationSec ? { ...next, duration: next.durationSec }
      : next.duration !== current.duration ? { ...next, durationSec: next.duration } : next;
    const shots = [...scene.shots];
    shots[i] = synced;
    return { ...scene, shots };
  });
}

/** Adds or replaces a take. A newly completed take becomes the selected one so the latest retake is what renders. */
export function upsertTake(doc: DramaProjectV1, shotId: string, take: DramaTake): DramaProjectV1 {
  return updateShot(doc, shotId, shot => {
    const exists = shot.takes.some(item => item.id === take.id);
    const takes = exists ? shot.takes.map(item => (item.id === take.id ? take : item)) : [...shot.takes, take];
    const status: DramaShot['status'] = take.status === 'completed' ? 'completed'
      : take.status === 'failed' ? (activeTake({ takes }) ? 'completed' : 'failed') : 'generating';
    return {
      ...shot, takes: takes.slice(-50), status,
      ...(take.status === 'completed' && take.videoUrl ? { selectedTakeId: take.id, videoUrl: take.videoUrl, thumbnailUrl: take.thumbnailUrl } : {}),
    };
  });
}

export function selectTake(doc: DramaProjectV1, shotId: string, takeId: string): DramaProjectV1 {
  return updateShot(doc, shotId, shot => {
    const take = shot.takes.find(item => item.id === takeId && item.status === 'completed' && item.videoUrl);
    return take ? { ...shot, selectedTakeId: take.id, videoUrl: take.videoUrl, thumbnailUrl: take.thumbnailUrl } : shot;
  });
}

/** A one-episode, one-scene document for users who write the script themselves. */
export function blankEpisodeDoc(base: DramaProjectV1, logline = '', now = Date.now()): DramaProjectV1 {
  const stamp = now.toString(36);
  return {
    ...base,
    episodes: [{
      id: `ep_${stamp}_0`, index: 0, title: '第 1 集', logline, script: logline,
      scenes: [{ id: `sc_${stamp}_0_0`, heading: '第 1 场', summary: '', shots: [] }],
    }],
  };
}

export function addScene(doc: DramaProjectV1, episodeId: string, now = Date.now()): DramaProjectV1 {
  return {
    ...doc,
    episodes: doc.episodes.map(episode => (episode.id !== episodeId ? episode : {
      ...episode,
      scenes: [...episode.scenes, {
        id: `sc_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        heading: `第 ${episode.scenes.length + 1} 场`, summary: '', shots: [],
      }],
    })),
  };
}

export function removeScene(doc: DramaProjectV1, sceneId: string): DramaProjectV1 {
  return { ...doc, episodes: doc.episodes.map(episode => ({ ...episode, scenes: episode.scenes.filter(scene => scene.id !== sceneId) })) };
}

export function updateCastMember(doc: DramaProjectV1, id: string, patch: Partial<DramaCastMember>): DramaProjectV1 {
  return { ...doc, cast: doc.cast.map(member => (member.id === id ? { ...member, ...patch } : member)) };
}

export function updateLocation(doc: DramaProjectV1, id: string, patch: Partial<DramaLocation>): DramaProjectV1 {
  return { ...doc, locations: doc.locations.map(item => (item.id === id ? { ...item, ...patch } : item)) };
}

export function updateProp(doc: DramaProjectV1, id: string, patch: Partial<DramaProp>): DramaProjectV1 {
  return { ...doc, props: doc.props.map(item => (item.id === id ? { ...item, ...patch } : item)) };
}

/** A new id that is not used by any cast member, location or prop. */
export function nextBibleId(doc: DramaProjectV1, prefix: 'char' | 'loc' | 'prop'): string {
  const used = new Set([...doc.cast, ...doc.locations, ...doc.props].map(item => item.id));
  for (let i = 1; ; i += 1) if (!used.has(`${prefix}_${i}`)) return `${prefix}_${i}`;
}

/** Removes a cast member and every reference to it from scenes and shots. */
export function removeCastMember(doc: DramaProjectV1, id: string): DramaProjectV1 {
  const strip = (ids?: string[]) => ids?.filter(item => item !== id);
  return mapScenes({ ...doc, cast: doc.cast.filter(member => member.id !== id) }, scene => ({
    ...scene, characterIds: strip(scene.characterIds), shots: scene.shots.map(shot => ({ ...shot, characterIds: strip(shot.characterIds) })),
  }));
}

/** Removes a prop and every shot reference to it. */
export function removeProp(doc: DramaProjectV1, id: string): DramaProjectV1 {
  return mapScenes({ ...doc, props: doc.props.filter(item => item.id !== id) }, scene => ({
    ...scene, shots: scene.shots.map(shot => (shot.propIds ? { ...shot, propIds: shot.propIds.filter(item => item !== id) } : shot)),
  }));
}

/** Removes a location and clears it from scenes and shots. */
export function removeLocation(doc: DramaProjectV1, id: string): DramaProjectV1 {
  return mapScenes({ ...doc, locations: doc.locations.filter(item => item.id !== id) }, scene => ({
    ...scene,
    ...(scene.locationId === id ? { locationId: undefined } : {}),
    shots: scene.shots.map(shot => (shot.sceneId === id ? { ...shot, sceneId: undefined } : shot)),
  }));
}

/** Nearest duration the model accepts; models reject lengths outside their list instead of rounding. */
export function fitDuration(seconds: number, allowed?: number[], max?: number): number {
  const wanted = Math.max(1, Math.round(seconds || 5));
  if (allowed?.length) {
    return allowed.reduce((best, value) => (Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best), allowed[0]);
  }
  return max ? Math.min(max, wanted) : wanted;
}

/** `00:01:05` style time code for the timeline ruler. */
export function formatTimecode(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
}

/** Shots that still need a usable take, in timeline order. */
export function pendingShots(episode: DramaEpisode | undefined): DramaShot[] {
  return episode ? episode.scenes.flatMap(scene => scene.shots).filter(shot => !activeTake(shot)) : [];
}

/** Shots whose newest take failed and that have no usable take to fall back on. */
export function failedShots(episode: DramaEpisode | undefined): DramaShot[] {
  return pendingShots(episode).filter(shot => shot.takes.at(-1)?.status === 'failed');
}

/** The shot right before `shotId` in timeline order, across scene boundaries. */
export function orderedPrevious(doc: DramaProjectV1, episodeId: string, shotId: string): DramaShot | undefined {
  const shots = doc.episodes.find(item => item.id === episodeId)?.scenes.flatMap(scene => scene.shots) ?? [];
  const i = shots.findIndex(shot => shot.id === shotId);
  return i > 0 ? shots[i - 1] : undefined;
}

export function episodeShotCount(episode: DramaEpisode): number {
  return episode.scenes.reduce((total, scene) => total + scene.shots.length, 0);
}

export function createBlankShot(doc: DramaProjectV1, scene: DramaSceneBlock, now = Date.now()): DramaShot {
  return {
    id: `shot_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    index: scene.shots.length, title: '', purpose: '', actionBeat: '', prompt: '',
    duration: 5, durationSec: 5, aspectRatio: doc.aspectRatio, references: [], continuityNotes: [],
    characterIds: scene.characterIds ? [...scene.characterIds] : [], ...(scene.locationId ? { sceneId: scene.locationId } : {}),
    firstFrameFromPrev: true, takes: [], status: 'planned',
  };
}

/** Appends a blank shot after `afterShotId` (or at the end). Returns null when the episode is at its shot limit. */
export function addShot(doc: DramaProjectV1, sceneId: string, afterShotId?: string, now = Date.now()): { doc: DramaProjectV1; shotId: string } | null {
  const episode = doc.episodes.find(item => item.scenes.some(scene => scene.id === sceneId));
  const scene = episode?.scenes.find(item => item.id === sceneId);
  if (!episode || !scene || episodeShotCount(episode) >= MAX_SHOTS_PER_EPISODE) return null;
  const shot = createBlankShot(doc, scene, now);
  const at = afterShotId ? scene.shots.findIndex(item => item.id === afterShotId) + 1 : scene.shots.length;
  const shots = [...scene.shots];
  shots.splice(at > 0 ? at : shots.length, 0, shot);
  return { doc: setSceneShots(doc, sceneId, shots), shotId: shot.id };
}

export function removeShot(doc: DramaProjectV1, shotId: string): DramaProjectV1 {
  const found = findShot(doc, shotId);
  return found ? setSceneShots(doc, found.scene.id, found.scene.shots.filter(shot => shot.id !== shotId)) : doc;
}

/** Moves a shot to `targetIndex` of `targetSceneId`; used by drag and drop and by the move buttons. */
export function moveShotTo(doc: DramaProjectV1, shotId: string, targetSceneId: string, targetIndex: number): DramaProjectV1 {
  const found = findShot(doc, shotId);
  if (!found) return doc;
  const target = found.episode.scenes.find(scene => scene.id === targetSceneId);
  if (!target) return doc;
  const without = setSceneShots(doc, found.scene.id, found.scene.shots.filter(shot => shot.id !== shotId));
  const targetShots = (found.scene.id === targetSceneId ? found.scene.shots.filter(shot => shot.id !== shotId) : target.shots);
  const at = Math.max(0, Math.min(targetShots.length, targetIndex));
  const moved = found.scene.id === targetSceneId ? found.shot : { ...found.shot, sceneId: target.locationId };
  return setSceneShots(without, targetSceneId, [...targetShots.slice(0, at), moved, ...targetShots.slice(at)]);
}

export function moveShot(doc: DramaProjectV1, shotId: string, delta: -1 | 1): DramaProjectV1 {
  const found = findShot(doc, shotId);
  if (!found) return doc;
  const next = found.shotIndex + delta;
  if (next >= 0 && next < found.scene.shots.length) return moveShotTo(doc, shotId, found.scene.id, next);
  // Past the edge of a scene the shot joins the neighbouring scene.
  const neighbour = found.episode.scenes[found.sceneIndex + delta];
  return neighbour ? moveShotTo(doc, shotId, neighbour.id, delta < 0 ? neighbour.shots.length : 0) : doc;
}
