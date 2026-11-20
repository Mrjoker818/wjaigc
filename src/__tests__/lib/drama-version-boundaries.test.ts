import { describe, expect, it } from 'vitest';
import { createEmptyDramaProject, type DramaShot } from '@/lib/drama/types';
import { filmInputSnapshot, isTakeCurrent, rebaseImportedProduction, shotInputSnapshot } from '@/lib/drama/production-version';
import { parseDramaProject } from '@/lib/drama/schema';

function fixture() {
  const script = '第一场\n甲：你好。';
  const shot = (id: string): DramaShot => ({ id, title: '', index: 0, prompt: '镜头', duration: 5, durationSec: 5, aspectRatio: '9:16', status: 'planned', references: [], continuityNotes: [], takes: [] } as unknown as DramaShot);
  return { ...createEmptyDramaProject(), episodes: [{ id: 'e', index: 0, title: '一', logline: '', script, structuredScript: script, scenes: [{ id: 'sc', heading: '第一场', summary: '', sourceRange: { start: 0, end: script.length }, shots: [shot('a'), shot('b')] }] }] };
}
describe('production version review boundaries', () => {
  it('rebases current archive outputs after URL remapping without making stale history current', () => {
    const original = fixture(); const shot = original.episodes[0].scenes[0].shots[0];
    shot.firstFrameUrl = '/old.png';
    shot.takes = [{ id: 'current', status: 'completed', videoUrl: '/old.mp4', createdAt: 1, inputSnapshot: shotInputSnapshot(original, 'e', shot.id) }, { id: 'obsolete', status: 'completed', videoUrl: '/old-history.mp4', createdAt: 1, inputSnapshot: 'old-inputs' }];
    const imported = structuredClone(original); const updated = imported.episodes[0].scenes[0].shots[0];
    updated.firstFrameUrl = '/new.png'; updated.takes[0].videoUrl = '/new.mp4';
    const result = rebaseImportedProduction(original, imported); const rebased = result.episodes[0].scenes[0].shots[0];
    expect(isTakeCurrent(result, 'e', rebased, rebased.takes[0])).toBe(true);
    expect(isTakeCurrent(result, 'e', rebased, rebased.takes[1])).toBe(false);
  });
  it('invalidates a source-backed output when text is appended beyond old scene offsets', () => {
    const doc = fixture(); const shot = doc.episodes[0].scenes[0].shots[1];
    const take = { id: 't', status: 'completed' as const, createdAt: 1, videoUrl: '/b.mp4', inputSnapshot: shotInputSnapshot(doc, 'e', 'b') };
    doc.episodes[0].script += '\n乙：新增对白。';
    expect(isTakeCurrent(doc, 'e', shot, take)).toBe(false);
  });
  it('binds predecessor selection, extraction time and continuity text', () => {
    const doc = fixture(); const [before, shot] = doc.episodes[0].scenes[0].shots;
    before.takes = [{ id: 't', status: 'completed', videoUrl: '/old.mp4', createdAt: 1 }];
    const snapshot = shotInputSnapshot(doc, 'e', shot.id);
    before.clipEdit = { trimEndSec: 3 };
    expect(shotInputSnapshot(doc, 'e', shot.id)).not.toBe(snapshot);
    const trimmed = shotInputSnapshot(doc, 'e', shot.id);
    before.takes[0].videoUrl = '/new.mp4';
    expect(shotInputSnapshot(doc, 'e', shot.id)).not.toBe(trimmed);
  });
  it('keeps large valid film versions bounded enough to save', () => {
    const doc = fixture(); const scene = doc.episodes[0].scenes[0];
    scene.shots = Array.from({ length: 50 }, (_, i) => ({ ...scene.shots[0], id: `s${i}`, prompt: '长'.repeat(2000) }));
    const snapshot = filmInputSnapshot(doc, 'e');
    expect(snapshot.length).toBeLessThan(200);
    doc.timeline.lastRender = { taskId: 'r', status: 'completed', videoUrl: '/film.mp4', episodeId: 'e', inputSnapshot: snapshot, createdAt: 1 };
    expect(() => parseDramaProject(doc)).not.toThrow();
  });
  it('accepts loadable legacy metadata with absent optional arrays', () => {
    const doc = fixture(); const shot = doc.episodes[0].scenes[0].shots[0];
    delete (shot as Partial<DramaShot>).references;
    Object.assign(shot, { motion: { maskDataUrl: 'data:image/png;base64,eA==' } });
    const parsed = parseDramaProject(doc);
    expect(() => shotInputSnapshot(parsed, 'e', shot.id)).not.toThrow();
  });
});
