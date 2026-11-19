/** Episode exports: subtitles (SRT), shot list (CSV) and the file list of a production package (ZIP). Pure, runs in the browser. */
import { buildSrt } from './render';
import { buildTimeline, dialogueCues } from './timeline';
import { stripMentions } from './mentions';
import { activeTake, type DramaProjectV1 } from './types';
import { currentVoiceover } from './voiceover';

/** A file name segment without path separators or characters Windows rejects. */
export function safeFileName(value: string, fallback = '短剧'): string {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, '_').replace(/\s+/gu, ' ').trim().slice(0, 60);
  return cleaned.replace(/^\.+/u, '') || fallback;
}

/** SRT of the episode's lines on the planned timeline, independent of whether subtitles are burned in. */
export function episodeSrt(doc: DramaProjectV1, episodeId: string): string {
  const blocks = buildTimeline(doc, episodeId);
  const episode = doc.episodes.find(item => item.id === episodeId);
  if (!episode || !blocks.length) return '';
  const shots = episode.scenes.flatMap(scene => scene.shots);
  const transitionSec = blocks.length > 1 ? Math.max(0, blocks[0].endSec - blocks[1].startSec) : 0;
  const clips = shots.map(shot => (shot.dialogue?.trim() ? { dialogue: shot.dialogue.trim() } : {}));
  return buildSrt(dialogueCues(clips, blocks.map(block => block.startSec), blocks.map(block => block.durationSec), transitionSec));
}

// Spreadsheet apps run cells that start with these as formulas; a leading apostrophe keeps them text.
const FORMULA_START = /^[=+\-@\t\r]/u;

function csvCell(value: string | number | undefined): string {
  let text = value === undefined ? '' : String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One row per shot with what an editor or crew needs. Starts with a BOM so Excel reads the Chinese text. */
export function shotListCsv(doc: DramaProjectV1, episodeId: string): string {
  const episode = doc.episodes.find(item => item.id === episodeId);
  if (!episode) return '';
  const blocks = new Map(buildTimeline(doc, episodeId).map(block => [block.shotId, block]));
  const names = (ids: string[] | undefined, list: Array<{ id: string; name: string }>) =>
    (ids ?? []).map(id => list.find(item => item.id === id)?.name).filter(Boolean).join('、');
  const rows = [['镜号', '场次', '场景', '开始（秒）', '时长（秒）', '画面', '台词', '角色', '道具', '模型', '视频', '配音']];
  episode.scenes.forEach((scene, sceneIndex) => {
    for (const shot of scene.shots) {
      const block = blocks.get(shot.id);
      rows.push([
        String((block?.shotNumber ?? shot.index + 1)).padStart(2, '0'), String(sceneIndex + 1), scene.heading,
        block ? block.startSec.toFixed(1) : '', String(shot.durationSec),
        stripMentions(shot.directedPrompt || shot.prompt, doc), shot.dialogue?.trim() ?? '',
        names(shot.characterIds, doc.cast), names(shot.propIds, doc.props), shot.modelId?.split('::').at(-1) ?? '',
        activeTake(shot)?.videoUrl ?? '', currentVoiceover(shot) ?? '',
      ]);
    }
  });
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export interface PackageMedia {
  /** Path inside the ZIP. */
  name: string;
  url: string;
}

function extension(url: string, fallback: string): string {
  const match = /\.([a-z0-9]{2,4})(?:[?#]|$)/iu.exec(url);
  return match ? match[1].toLowerCase() : fallback;
}

/** Media files of the episode, named by shot so they sort in timeline order. Each URL appears once. */
export function episodePackageMedia(doc: DramaProjectV1, episodeId: string): PackageMedia[] {
  const episode = doc.episodes.find(item => item.id === episodeId);
  if (!episode) return [];
  const out: PackageMedia[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined, base: string, fallbackExt: string) => {
    if (!url || url.startsWith('data:') || seen.has(url)) return;
    seen.add(url);
    out.push({ name: `${base}.${extension(url, fallbackExt)}`, url });
  };
  const last = doc.timeline.lastRender;
  if (last?.status === 'completed' && last.episodeId === episodeId) add(last.videoUrl, '成片', 'mp4');
  episode.scenes.flatMap(scene => scene.shots).forEach((shot, i) => {
    const number = String(i + 1).padStart(2, '0');
    add(activeTake(shot)?.videoUrl, `镜头/${number}_视频`, 'mp4');
    add(shot.firstFrameUrl, `镜头/${number}_首帧`, 'png');
    add(shot.lastFrameUrl, `镜头/${number}_尾帧`, 'png');
    add(currentVoiceover(shot), `配音/${number}`, 'mp3');
  });
  for (const member of doc.cast) {
    const name = safeFileName(member.name, member.id);
    add(member.lockedImageUrl || member.imageUrlFront, `设定/角色_${name}`, 'png');
    add(member.imageUrlSide, `设定/角色_${name}_侧面`, 'png');
    add(member.imageUrlBack, `设定/角色_${name}_背面`, 'png');
    add(member.imageUrlFace, `设定/角色_${name}_面部`, 'png');
  }
  for (const location of doc.locations) add(location.lockedImageUrl || location.imageUrl, `设定/场景_${safeFileName(location.name, location.id)}`, 'png');
  for (const prop of doc.props) add(prop.lockedImageUrl || prop.imageUrl, `设定/道具_${safeFileName(prop.name, prop.id)}`, 'png');
  return out;
}
