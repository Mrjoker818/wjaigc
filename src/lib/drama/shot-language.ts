import type { DramaShot } from './types';

/** Shot sizes and camera moves the planner and prompt polish are asked to use. */
export const SHOT_SIZES = ['特写', '近景', '中近景', '中景', '全景', '远景'] as const;
export const CAMERA_MOVES = ['静止', '缓慢推进', '拉出', '左摇', '右摇', '上仰', '下俯', '左环绕', '右环绕', '跟拍', '手持', '升降'] as const;

export type ShotLanguage = Pick<DramaShot, 'shotSize' | 'cameraMotion' | 'cameraMove' | 'lighting' | 'audioCues'>;

/** Values filled in when the planner gave none; they were never chosen, so they are not sent. */
const UNSET = new Set(['', 'medium', 'static']);

/** A field's value, or '' when it holds the planner's placeholder. */
export function chosenShotValue(value: string | undefined): string {
  const text = value?.trim() ?? '';
  return UNSET.has(text) ? '' : text;
}

/** "镜头：中景，缓慢推进。光线：…。声音：…。" from the shot's camera fields, or '' when none was chosen. */
export function shotLanguageText(shot: ShotLanguage): string {
  const camera = [chosenShotValue(shot.shotSize), chosenShotValue(shot.cameraMove || shot.cameraMotion)].filter(Boolean).join('，');
  const lighting = chosenShotValue(shot.lighting);
  const sound = chosenShotValue(shot.audioCues);
  const parts = [camera ? `镜头：${camera}` : '', lighting ? `光线：${lighting}` : '', sound ? `声音：${sound}` : ''].filter(Boolean);
  return parts.length ? `${parts.join('。')}。` : '';
}
