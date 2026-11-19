/**
 * Rewrites one shot's picture description the way a director would, using the chat model.
 * The method follows the Seedance 2.0 Skill OS directing notes (github.com/Emily2040/seedance-2.0, MIT):
 * one intention per shot, a concrete light source, one camera move, and a sound cue.
 */
import { DIRECTOR_STYLES, normalizeDirectorStyle } from '@/lib/video-director/director-styles';
import { DramaPlannerError } from './planner';
import { CAMERA_MOVES, SHOT_SIZES, shotLanguageText } from './shot-language';
import type { DramaProjectV1, DramaShot } from './types';

export type PolishedShot = Pick<DramaShot, 'shotSize' | 'cameraMotion' | 'lighting' | 'audioCues'> & { prompt: string };

const MAX_PROMPT = 8000;
const MAX_FIELD = 200;

const SYSTEM_PROMPT = `你是短剧的分镜导演。把用户给的一个镜头的画面描述改写成能直接交给视频模型的版本。

写法：
1. 一个镜头只讲一件事：一到两个动作，一个运镜。
2. 只写摄影机拍得到的东西，用正在发生的动作来写。不写"很震撼""很有氛围"这类评价。
3. 光线写出具体光源和方向，比如窗侧光、霓虹反光、夕阳逆光。
4. 运镜写清从哪里到哪里，并服务情绪：紧张用手持，悲伤用缓慢推进，宏大用拉远，亲密用固定近景。
5. 写一句声音：环境声或关键音效。
6. 不写字幕、logo、水印、片头片尾和任何画面文字。
7. 原文里的 @名字 原样保留，人物的长相和服装不要改。
8. 画面描述 40-150 字，中文，单段，不要解释。

只输出一个 JSON 对象：
{"prompt":"改写后的画面描述","shotSize":"景别","cameraMotion":"运镜","lighting":"光线，20字内","audioCues":"声音，20字内"}
景别只能是：${SHOT_SIZES.join('/')}。
运镜只能是：${CAMERA_MOVES.join('/')}。`;

/** Messages asking the chat model to polish one shot. Throws when the shot is not in the document. */
export function buildPolishMessages(doc: DramaProjectV1, shotId: string): Array<{ role: 'system' | 'user'; content: string }> {
  for (const episode of doc.episodes) {
    for (const scene of episode.scenes) {
      const shot = scene.shots.find(item => item.id === shotId);
      if (!shot) continue;
      const style = DIRECTOR_STYLES[normalizeDirectorStyle(doc.style)];
      const location = doc.locations.find(item => item.id === (shot.sceneId || scene.locationId));
      const cast = doc.cast.filter(member => shot.characterIds?.includes(member.id));
      const lines = [
        `画风：${style.label}，${style.rule.quality}`,
        `画面比例：${shot.aspectRatio || doc.aspectRatio}，时长：${shot.durationSec} 秒`,
        `场次：${scene.heading}`,
        location ? `场景：${location.name}，${location.description || ''}${location.lighting ? `，${location.lighting}` : ''}` : '',
        cast.length ? `出场角色：${cast.map(member => `${member.name}（${member.appearance}）`).join('；')}` : '',
        shot.actionBeat ? `这一镜的动作：${shot.actionBeat}` : '',
        shot.dialogue ? `台词：「${shot.dialogue}」` : '',
        shotLanguageText(shot) ? `现在的镜头设置：${shotLanguageText(shot)}` : '',
        `原画面描述：${shot.prompt || '（空）'}`,
      ].filter(Boolean);
      return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: lines.join('\n') }];
    }
  }
  throw new DramaPlannerError('DRAMA_PLAN_INVALID', false);
}

function field(value: unknown, max = MAX_FIELD): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

/** Reads the model's JSON reply. A reply without a usable prompt is retryable. */
export function parsePolishResponse(text: string): PolishedShot {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let data: Record<string, unknown> = {};
  try {
    if (start >= 0 && end > start) data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch { /* handled below */ }
  const prompt = field(data.prompt, MAX_PROMPT);
  if (!prompt) throw new DramaPlannerError('DRAMA_PLAN_INVALID', true);
  return {
    prompt,
    ...(field(data.shotSize) ? { shotSize: field(data.shotSize) } : {}),
    ...(field(data.cameraMotion) ? { cameraMotion: field(data.cameraMotion) } : {}),
    ...(field(data.lighting) ? { lighting: field(data.lighting) } : {}),
    ...(field(data.audioCues) ? { audioCues: field(data.audioCues) } : {}),
  };
}
