import { chooseFirstFrame, type ShotModelCapability } from './shot-runner';
import type { DramaEpisode, DramaProjectV1, DramaShot } from './types';
import { currentTakeForShot, isVoiceoverCurrent } from './production-version';
import { fitDuration, orderedPrevious } from './workbench-state';

/** Workbench step where a missing item is fixed; matches the workbench's own step ids. */
export type ReadinessStep = 'script' | 'bible' | 'board' | 'shots' | 'final';

export type ReadinessKey = 'prompt' | 'model' | 'duration' | 'ratio' | 'cast' | 'props' | 'firstFrame' | 'video' | 'voiceover';

export interface ReadinessCheck {
  key: ReadinessKey;
  ok: boolean;
  /** Required items block the finished episode; the rest only lower the quality. */
  required: boolean;
  label: string;
  /** What is missing and what happens if it stays missing; set only when the check fails. */
  detail?: string;
  step: ReadinessStep;
}

/** The parts of a video model option the checks read. */
export interface ReadinessModel {
  name: string;
  capability: ShotModelCapability;
  durations: number[];
  maxDuration?: number;
  ratios: string[];
}

const castHasImage = (member: DramaProjectV1['cast'][number]) =>
  Boolean(member.lockedImageUrl || member.imageUrlFront || member.frontUrl || member.imageUrlSide || member.sideUrl || member.imageUrlFace || member.imageUrlBack || member.imageUrlFull);

function names<T extends { id: string; name: string }>(ids: string[] | undefined, items: T[], hasImage: (item: T) => boolean) {
  const shown = (ids ?? []).map(id => items.find(item => item.id === id)).filter((item): item is T => Boolean(item));
  return { shown, missing: shown.filter(item => !hasImage(item)).map(item => item.name || item.id) };
}

/** Everything a shot needs before it can go into the film, in the order the user fixes them. */
export function shotReadiness(doc: DramaProjectV1, episodeId: string, shot: DramaShot, model: ReadinessModel | undefined): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const add = (check: Omit<ReadinessCheck, 'detail'>, detail: string) => checks.push(check.ok ? check : { ...check, detail });

  add({ key: 'prompt', ok: Boolean(shot.prompt.trim()), required: true, label: '画面描述', step: 'board' }, '还没有画面描述，模型不知道要拍什么');
  add({ key: 'model', ok: Boolean(model), required: true, label: '视频模型', step: 'shots' }, '没有可用的视频模型，请先在镜头步骤选一个');

  if (model) {
    const fitted = fitDuration(shot.durationSec, model.durations, model.maxDuration);
    add({ key: 'duration', ok: fitted === shot.durationSec, required: false, label: '时长', step: 'shots' },
      `${model.name} 不支持 ${shot.durationSec} 秒，会按 ${fitted} 秒生成`);
    const ratio = shot.aspectRatio || doc.aspectRatio;
    if (model.ratios.length) {
      add({ key: 'ratio', ok: model.ratios.includes(ratio), required: false, label: '画面比例', step: 'shots' },
        `${model.name} 不支持 ${ratio}，换一个模型或改画面比例`);
    }
  }

  const cast = names(shot.characterIds, doc.cast, castHasImage);
  if (cast.shown.length) {
    add({ key: 'cast', ok: cast.missing.length === 0, required: false, label: '角色定妆图', step: 'bible' },
      `${cast.missing.join('、')} 没有定妆图，长相可能和其他镜头对不上`);
  }
  const props = names(shot.propIds, doc.props, item => Boolean(item.lockedImageUrl || item.imageUrl));
  if (props.shown.length) {
    add({ key: 'props', ok: props.missing.length === 0, required: false, label: '道具设定图', step: 'bible' },
      `${props.missing.join('、')} 没有设定图，外观可能前后不一致`);
  }

  if (model?.capability.imageToVideo) {
    const previous = orderedPrevious(doc, episodeId, shot.id);
    const location = doc.locations.find(item => item.id === shot.sceneId);
    const currentPrevious = previous && currentTakeForShot(doc, episodeId, previous) ? previous : undefined;
    const source = chooseFirstFrame(shot, currentPrevious, location, model.capability).source;
    add({ key: 'firstFrame', ok: source !== 'none', required: false, label: '首帧', step: 'shots' },
      '没有关键帧、场景图或上一镜头可接，会只按文字生成，构图不可控');
  }

  add({ key: 'video', ok: Boolean((shot.still && shot.firstFrameUrl) || currentTakeForShot(doc, episodeId, shot)), required: true, label: '选用的视频', step: 'shots' },
    shot.takes.some(take => take.status === 'completed' && take.videoUrl) ? '制作输入已更改，选用的视频需要重拍'
      : shot.takes.at(-1)?.status === 'failed' ? '最近一次生成失败，重拍后才能进成片' : '还没有生成视频');

  if (shot.dialogue?.trim()) {
    add({ key: 'voiceover', ok: isVoiceoverCurrent(doc, shot), required: false, label: '台词配音', step: 'final' },
      shot.voiceoverUrl ? shot.voiceoverText !== shot.dialogue.trim() ? '台词改过，配音需要重录' : '音色或声音样本改过，配音需要重录'
        : '台词还没有配音，成片里只有字幕');
  }
  return checks;
}

export interface ReadinessSummary {
  /** Every required item is in place. */
  ready: boolean;
  open: number;
  blocking: number;
}

export function summarizeReadiness(checks: ReadinessCheck[]): ReadinessSummary {
  const failed = checks.filter(check => !check.ok);
  return { ready: failed.every(check => !check.required), open: failed.length, blocking: failed.filter(check => check.required).length };
}

/** Shot numbers run across the whole episode, the same numbering the shot grid shows. */
export function episodeShotNumbers(episode: DramaEpisode): Map<string, number> {
  return new Map(episode.scenes.flatMap(scene => scene.shots).map((shot, i) => [shot.id, i + 1]));
}

/** "镜头 3", or "第 2 集 镜头 3" when the document has more than one episode. Unknown ids fall back to null. */
export function shotLabel(doc: DramaProjectV1, shotId: string): string | null {
  for (const [i, episode] of doc.episodes.entries()) {
    const number = episodeShotNumbers(episode).get(shotId);
    if (number) return doc.episodes.length > 1 ? `第 ${i + 1} 集 镜头 ${number}` : `镜头 ${number}`;
  }
  return null;
}
