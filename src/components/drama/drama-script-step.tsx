'use client';

import { useEffect, useState } from 'react';
import { MessageSquareText, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { buildDramaChatHandoff } from '@/lib/drama/chat-handoff';
import { planDramaScript } from '@/lib/drama/workbench-client';
import { parseDramaProject } from '@/lib/drama/schema';
import { addScene, removeScene, updateEpisode, updateScene } from '@/lib/drama/workbench-state';
import { isEpisodeStructureCurrent, reparseEpisode, sceneSourceText } from '@/lib/drama/source-script';
import type { DramaProjectV1 } from '@/lib/drama/types';
import { useDrama } from './drama-context';

/** Step 1: the episode script on "storyboard paper", plus the scene list the board is built from. */
export function DramaScriptStep() {
  const { doc, episode, update, replaceDoc, runJob, busyLabel, setStep, dramaId, projectId, flushSave, onContinueInChat } = useDrama();
  const [idea, setIdea] = useState(episode?.logline ?? '');
  const [leaving, setLeaving] = useState(false);
  const [structurePreview, setStructurePreview] = useState<{
    base: DramaProjectV1; episodeId: string; result: ReturnType<typeof reparseEpisode>;
  } | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  // Any intervening document edit (including a new take) requires another review.
  const currentPreview = structurePreview?.base === doc && structurePreview.episodeId === episode?.id ? structurePreview : null;
  useEffect(() => { setStructurePreview(null); setStructureError(null); }, [doc, episode?.id]);

  const previewStructure = () => {
    if (!episode || busyLabel) return;
    setStructureError(null);
    try {
      const result = reparseEpisode(doc, episode.id);
      parseDramaProject(result.doc);
      setStructurePreview({ base: doc, episodeId: episode.id, result });
    }
    catch {
      setStructurePreview(null);
      setStructureError('重新解析失败，请检查分场标记、标题长度与角色数量后重试。');
    }
  };
  const applyStructure = () => {
    if (!currentPreview || busyLabel) return;
    update(current => current === currentPreview.base ? currentPreview.result.doc : current);
    setStructurePreview(null);
  };

  // Save first: the chat opens in this tab, and the way back reloads the drama from the server.
  const continueInChat = async () => {
    if (!episode || !onContinueInChat) return;
    setLeaving(true);
    if (!(await flushSave()) && !window.confirm('剧本的最新改动还没保存成功。仍然去对话里改吗？没保存的改动会丢失。')) {
      setLeaving(false);
      return;
    }
    onContinueInChat(buildDramaChatHandoff(doc, episode, { dramaId, projectId }));
  };

  const regenerate = () => {
    const shotCount = doc.episodes.reduce((total, item) => total + item.scenes.reduce((n, scene) => n + scene.shots.length, 0), 0);
    if (shotCount && !window.confirm(`重新生成会替换现在的剧本、角色、场景和 ${shotCount} 个镜头（包括已生成的视频记录）。确定继续？`)) return;
    void runJob('生成剧本', async () => {
      const next = await planDramaScript({ idea: idea.trim(), title: doc.title, genre: doc.genre, style: doc.style, aspectRatio: doc.aspectRatio, planner: doc.planner });
      replaceDoc({ ...next, title: doc.title || next.title, planner: doc.planner,
        ...(doc.sourceScript ? { sourceScript: doc.sourceScript } : {}) });
    });
  };

  if (!episode) {
    return <p className="drama-label">这部短剧还没有分集。用下面的一句话生成剧本。</p>;
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-6">
      <section className="drama-panel flex flex-col gap-3 p-4" aria-labelledby="drama-idea">
        <h2 id="drama-idea" className="text-sm font-semibold">一句话梗概</h2>
        <textarea className="drama-input min-h-16 resize-y" aria-label="一句话梗概" maxLength={4000} value={idea} onChange={event => setIdea(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="drama-btn" disabled={!idea.trim() || Boolean(busyLabel)} onClick={regenerate}>
            <RefreshCw className="h-4 w-4" />按梗概重新生成剧本
          </button>
          <span className="drama-label">不扣积分</span>
        </div>
      </section>

      <section className="drama-paper flex flex-col gap-3 rounded-lg p-4 sm:p-6" aria-labelledby="drama-script">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="drama-script" className="font-serif text-xl font-bold">剧本</h2>
          <input className="drama-input max-w-xs" aria-label="本集标题" maxLength={200} value={episode.title}
            onChange={event => update(current => updateEpisode(current, episode.id, { title: event.target.value }))} />
          {onContinueInChat ? (
            <button type="button" className="drama-btn sm:ml-auto" disabled={leaving || Boolean(busyLabel)} onClick={() => void continueInChat()}
              title="打开智能对话，带上这一集的梗概、分场和剧本，让对话模型帮你改">
              <MessageSquareText className="h-4 w-4" />{leaving ? '正在保存…' : '在对话里继续改'}
            </button>
          ) : null}
        </div>
        <textarea
          className="drama-input min-h-80 resize-y font-serif leading-loose" aria-label="剧本正文" maxLength={100000} value={episode.script}
          placeholder={'第 1 场 · 咖啡馆 · 内 · 夜\n林夏推门进来，雨水顺着伞尖滴落。\n林夏：「你还在等我？」'}
          onChange={event => update(current => updateEpisode(current, episode.id, { script: event.target.value }))}
        />
      </section>

      {doc.sourceScript ? <details className="min-w-0 border-b border-[var(--drama-line)] pb-4">
        <summary className="cursor-pointer break-words py-2 text-sm text-[var(--drama-gold)]">查看导入原稿{doc.sourceScript.fileName ? ` · ${doc.sourceScript.fileName}` : ''}</summary>
        <p className="drama-label my-2">导入时保存的原文，正文编辑与重新解析不会修改它。</p>
        <pre aria-label="保存的导入原稿" tabIndex={0} className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--drama-ink)] p-3 font-sans text-sm leading-relaxed">{doc.sourceScript.originalText}</pre>
      </details> : null}

      {!isEpisodeStructureCurrent(episode) ? <section aria-label="分场结构待更新" className="drama-panel flex min-w-0 flex-col gap-3 p-4">
        <p role="status" className="text-sm font-semibold text-[var(--drama-gold)]">正文已修改，分场结构尚未更新</p>
        <p className="text-sm leading-relaxed text-[var(--drama-muted)]">先预览重新解析的场次与受影响镜头，再应用更新。匹配的场次沿用原 ID 和素材历史，移除的场次归档保留；更新后请复核已有分镜。</p>
        <button type="button" className="drama-btn self-start" disabled={Boolean(busyLabel)} onClick={previewStructure}>预览重新解析</button>
      </section> : null}
      {structureError ? <p role="alert" className="text-sm text-[var(--drama-red)]">{structureError}</p> : null}
      {currentPreview ? (() => {
        const nextEpisode = currentPreview.result.doc.episodes.find(item => item.id === episode.id);
        if (!nextEpisode) return null;
        const changed = new Set(currentPreview.result.changedSceneIds);
        const removed = episode.scenes.filter(scene => !nextEpisode.scenes.some(item => item.id === scene.id));
        return <section aria-labelledby="drama-structure-preview" className="drama-panel flex min-w-0 flex-col gap-4 p-4 sm:p-5">
          <h2 id="drama-structure-preview" className="font-semibold">重新解析预览</h2>
          <p className="text-sm tabular-nums">分场 {episode.scenes.length} → {nextEpisode.scenes.length} · 受影响场次 {changed.size} · 归档 {removed.length} 场</p>
          {currentPreview.result.warnings.length ? <ul className="list-disc space-y-1 break-words pl-5 text-sm leading-relaxed">
            {currentPreview.result.warnings.map((warning, i) => <li key={i}>{warning.replace(/^DRAMA_[A-Z0-9_]+:\s*/u, '')}</li>)}
          </ul> : null}
          <ol className="flex max-h-[32rem] min-w-0 flex-col gap-3 overflow-y-auto">
            {nextEpisode.scenes.map((scene, i) => {
              const previous = episode.scenes.find(item => item.id === scene.id);
              return <li key={scene.id} className="min-w-0 border-t border-[var(--drama-line)] pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <h3 className="min-w-0 break-words font-semibold">{i + 1}. {scene.heading}</h3>
                  <span className="text-[var(--drama-gold)]">{!previous ? '新增场次' : changed.has(scene.id) ? '正文变化 · 保留历史' : '沿用场次'}</span>
                </div>
                {previous?.shots.length ? <p className="drama-label mt-1">保留 {previous.shots.length} 个镜头及其素材历史{changed.has(scene.id) ? '，应用后需复核。' : '。'}</p> : null}
                <details className="mt-2" open={changed.has(scene.id)}><summary className="cursor-pointer py-1 text-sm">查看场次原文</summary>
                  <div className="mt-2 grid min-w-0 gap-3 md:grid-cols-2">
                    {previous && changed.has(scene.id) ? <div className="min-w-0"><p className="drama-label mb-1">更新前</p><pre tabIndex={0} className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{sceneSourceText(episode, previous)}</pre></div> : null}
                    <div className="min-w-0"><p className="drama-label mb-1">解析后</p><pre tabIndex={0} className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{sceneSourceText(nextEpisode, scene)}</pre></div>
                  </div>
                </details>
              </li>;
            })}
            {removed.map(scene => <li key={scene.id} className="min-w-0 border-t border-[var(--drama-line)] pt-3 text-sm">
              <p className="break-words font-semibold">归档场次：{scene.heading}</p><p className="drama-label mt-1">{scene.shots.length} 个镜头及历史素材将保留在归档中，不参与当前分镜。</p>
            </li>)}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="drama-btn drama-btn--primary" disabled={Boolean(busyLabel)} onClick={applyStructure}>应用分场更新</button>
            <button type="button" className="drama-btn" onClick={() => setStructurePreview(null)}>取消分场更新</button>
          </div>
        </section>;
      })() : null}

      {episode.archivedScenes?.length ? <details className="drama-panel min-w-0 p-4"><summary className="cursor-pointer text-sm">归档场次与素材（{episode.archivedScenes.length} 场，不参与当前成片）</summary>
        <ol className="mt-3 flex max-h-80 flex-col gap-4 overflow-y-auto">{episode.archivedScenes.map(scene => <li key={scene.id} className="min-w-0"><h3 className="break-words text-sm font-semibold">{scene.heading}</h3>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs text-[var(--drama-muted)]">{scene.sourceText ?? ''}</pre>
          <div className="mt-2 flex flex-wrap gap-2">{scene.shots.flatMap(shot => shot.takes.filter(take => take.status === 'completed' && take.videoUrl).map((take, i) => <a key={take.id} className="drama-btn text-xs" href={take.videoUrl} download>历史镜头 {shot.index + 1} · 次 {i + 1}</a>))}</div>
        </li>)}</ol>
      </details> : null}

      <section className="flex flex-col gap-3" aria-labelledby="drama-scenes">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="drama-scenes" className="text-sm font-semibold">分场（{episode.scenes.length}）</h2>
          <span className="drama-label">分镜按这里的场次拆解，场景和出场角色决定参考图。</span>
        </div>
        <ol className="flex flex-col gap-2">
          {episode.scenes.map((scene, i) => (
            <li key={scene.id} className="drama-panel grid gap-3 p-3 md:grid-cols-[3rem_1fr_14rem]">
              <span className="font-mono text-sm text-[var(--drama-gold)]">场 {String(i + 1).padStart(2, '0')}</span>
              <div className="flex min-w-0 flex-col gap-2">
                <input className="drama-input font-serif font-bold" aria-label={`第 ${i + 1} 场标题`} maxLength={200} value={scene.heading}
                  onChange={event => update(current => updateScene(current, scene.id, { heading: event.target.value }))} />
                <textarea className="drama-input min-h-16 resize-y" aria-label={`第 ${i + 1} 场内容`} maxLength={4000} value={scene.summary}
                  placeholder="这一场发生了什么、有哪些关键台词"
                  onChange={event => update(current => updateScene(current, scene.id, { summary: event.target.value }))} />
              </div>
              <div className="flex flex-col gap-2">
                <select className="drama-input" aria-label={`第 ${i + 1} 场场景`} value={scene.locationId ?? ''}
                  onChange={event => update(current => updateScene(current, scene.id, { locationId: event.target.value || undefined }))}>
                  <option value="">未指定场景</option>
                  {doc.locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <div className="flex flex-wrap gap-1" role="group" aria-label={`第 ${i + 1} 场出场角色`}>
                  {doc.cast.map(member => {
                    const on = scene.characterIds?.includes(member.id) ?? false;
                    return (
                      <button key={member.id} type="button" className="drama-btn min-h-8 px-2 text-xs" aria-pressed={on}
                        onClick={() => update(current => updateScene(current, scene.id, {
                          characterIds: on ? scene.characterIds?.filter(id => id !== member.id) : [...(scene.characterIds ?? []), member.id],
                        }))}>{member.name}</button>
                    );
                  })}
                </div>
                <button type="button" className="drama-btn drama-btn--quiet self-start" disabled={scene.shots.length > 0}
                  title={scene.shots.length ? '先在分镜里删掉这一场的镜头' : undefined}
                  onClick={() => update(current => removeScene(current, scene.id))}><Trash2 className="h-4 w-4" />删除这一场</button>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="drama-btn" onClick={() => update(current => addScene(current, episode.id))}><Plus className="h-4 w-4" />加一场</button>
          <button type="button" className="drama-btn drama-btn--primary" onClick={() => setStep('bible')}>下一步：设定角色和场景</button>
        </div>
      </section>
    </div>
  );
}
