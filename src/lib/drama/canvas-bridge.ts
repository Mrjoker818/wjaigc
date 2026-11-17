/** Converts the canvas video panel's shot plan into drama engine shapes, so both share one generation path. */
import type { VideoCharacter, VideoProp, VideoScene, VideoShotPlan } from '@/lib/video-director/continuity';
import type { DirectorStyle } from '@/lib/video-director/director-styles';
import { createEmptyDramaProject, MAX_SHOTS_PER_EPISODE, type DramaCastMember, type DramaLocation, type DramaProjectV1, type DramaSceneBlock, type DramaShot } from './types';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Inline data and blob URLs are page-local and too large for a saved document. */
function persistableUrl(url: string | undefined): string | undefined {
  return url && !url.startsWith('data:') && !url.startsWith('blob:') ? url : undefined;
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Runtime view of a panel shot for the shot-runner choices; a finished result becomes its single take. */
export function asDramaShot(plan: VideoShotPlan): DramaShot {
  const done = plan.status === 'completed' && plan.videoUrl;
  return {
    ...plan,
    durationSec: plan.duration,
    takes: done ? [{ id: `take_${plan.id}`, status: 'completed', videoUrl: plan.videoUrl, thumbnailUrl: plan.thumbnailUrl, createdAt: 0 }] : [],
  };
}

/** A panel shot as a saved drama shot: inline URLs dropped, a finished result kept as the selected take. */
export function planShotToDramaShot(plan: VideoShotPlan, index = plan.index): DramaShot {
  const videoUrl = persistableUrl(plan.videoUrl);
  const thumbnailUrl = persistableUrl(plan.thumbnailUrl);
  const done = plan.status === 'completed' && videoUrl;
  const takeId = `take_${plan.id}`.slice(0, 128);
  return {
    ...plan,
    index,
    title: clip(plan.title, 200) || `镜头 ${index + 1}`,
    prompt: clip(plan.prompt, 8000),
    duration: plan.duration > 0 ? Math.min(plan.duration, 60) : 5,
    durationSec: plan.duration > 0 ? Math.min(plan.duration, 60) : 5,
    firstFrameUrl: persistableUrl(plan.firstFrameUrl),
    lastFrameUrl: persistableUrl(plan.lastFrameUrl),
    videoUrl: undefined,
    thumbnailUrl: undefined,
    status: done ? 'completed' : 'planned',
    error: undefined,
    takes: done ? [{ id: takeId, status: 'completed', videoUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}), createdAt: 0 }] : [],
    ...(done ? { selectedTakeId: takeId } : {}),
  };
}

function castMember(character: VideoCharacter, index: number): DramaCastMember {
  return {
    ...character,
    id: SAFE_ID.test(character.id) ? character.id : `char_${index + 1}`,
    name: clip(character.name, 200) || `角色 ${index + 1}`,
    appearance: clip(character.appearance, 4000),
    imageUrlFront: persistableUrl(character.imageUrlFront || character.frontUrl),
    imageUrlSide: persistableUrl(character.imageUrlSide || character.sideUrl),
    frontUrl: undefined,
    sideUrl: undefined,
  };
}

function location(scene: VideoScene, index: number): DramaLocation {
  return {
    ...scene,
    id: SAFE_ID.test(scene.id) ? scene.id : `loc_${index + 1}`,
    name: clip(scene.name, 200) || `场景 ${index + 1}`,
    imageUrl: persistableUrl(scene.imageUrl),
  };
}

export interface CanvasDraftInput {
  idea: string;
  style: DirectorStyle;
  aspectRatio: string;
  shots: VideoShotPlan[];
  characters: VideoCharacter[];
  scenes: VideoScene[];
  props: VideoProp[];
}

/**
 * One-episode draft from the panel. Consecutive shots that share a location form one scene block,
 * which matches how the workbench groups its storyboard.
 */
export function buildDramaDraftFromCanvas(input: CanvasDraftInput): DramaProjectV1 {
  const idea = input.idea.trim();
  const doc = createEmptyDramaProject({
    title: idea ? idea.slice(0, 24) : undefined,
    style: input.style,
    aspectRatio: input.aspectRatio,
  });
  doc.cast = input.characters.slice(0, 100).map(castMember);
  doc.locations = input.scenes.slice(0, 200).map(location);
  doc.props = input.props.slice(0, 200).map((prop, index) => ({
    ...prop, id: SAFE_ID.test(prop.id) ? prop.id : `prop_${index + 1}`, name: clip(prop.name, 200) || `道具 ${index + 1}`,
  }));
  const knownLocations = new Set(doc.locations.map(item => item.id));
  const knownCast = new Set(doc.cast.map(item => item.id));
  const blocks: DramaSceneBlock[] = [];
  input.shots.slice(0, MAX_SHOTS_PER_EPISODE).forEach((plan, index) => {
    const shot = planShotToDramaShot(plan, index);
    shot.sceneId = shot.sceneId && knownLocations.has(shot.sceneId) ? shot.sceneId : undefined;
    shot.characterIds = (shot.characterIds ?? []).filter(id => knownCast.has(id));
    const last = blocks.at(-1);
    if (last && last.locationId === shot.sceneId) { last.shots.push(shot); return; }
    const place = doc.locations.find(item => item.id === shot.sceneId);
    blocks.push({
      id: `scene_${blocks.length + 1}`,
      heading: place?.name || `第 ${blocks.length + 1} 场`,
      summary: '',
      ...(shot.sceneId ? { locationId: shot.sceneId } : {}),
      shots: [shot],
    });
  });
  for (const block of blocks) {
    block.characterIds = [...new Set(block.shots.flatMap(shot => shot.characterIds ?? []))];
  }
  doc.episodes = [{ id: 'ep_1', index: 0, title: '第 1 集', logline: idea.slice(0, 2000), script: idea.slice(0, 100_000), scenes: blocks }];
  return doc;
}
