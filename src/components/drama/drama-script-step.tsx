'use client';

import { useState } from 'react';
import { MessageSquareText, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { buildDramaChatHandoff } from '@/lib/drama/chat-handoff';
import { planDramaScript } from '@/lib/drama/workbench-client';
import { addScene, removeScene, updateEpisode, updateScene } from '@/lib/drama/workbench-state';
import { useDrama } from './drama-context';

/** Step 1: the episode script on "storyboard paper", plus the scene list the board is built from. */
export function DramaScriptStep() {
  const { doc, episode, update, replaceDoc, runJob, busyLabel, setStep, dramaId, projectId, flushSave, onContinueInChat } = useDrama();
  const [idea, setIdea] = useState(episode?.logline ?? '');
  const [leaving, setLeaving] = useState(false);

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
      const next = await planDramaScript({ idea: idea.trim(), title: doc.title, genre: doc.genre, style: doc.style, aspectRatio: doc.aspectRatio });
      replaceDoc({ ...next, title: doc.title || next.title });
    });
  };

  if (!episode) {
    return <p className="drama-label">这部短剧还没有分集。用下面的一句话生成剧本。</p>;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <section className="drama-panel flex flex-col gap-3 p-4" aria-labelledby="drama-idea">
        <h2 id="drama-idea" className="text-sm font-semibold">一句话梗概</h2>
        <textarea className="drama-input min-h-16 resize-y" maxLength={4000} value={idea} onChange={event => setIdea(event.target.value)} />
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

      <section className="flex flex-col gap-3" aria-labelledby="drama-scenes">
        <div className="flex items-center gap-3">
          <h2 id="drama-scenes" className="text-sm font-semibold">分场（{episode.scenes.length}）</h2>
          <span className="drama-label">分镜按这里的场次拆解，场景和出场角色决定参考图。</span>
        </div>
        <ol className="flex flex-col gap-2">
          {episode.scenes.map((scene, i) => (
            <li key={scene.id} className="drama-panel grid gap-3 p-3 md:grid-cols-[3rem_1fr_14rem]">
              <span className="font-mono text-sm text-[var(--drama-gold)]">场 {String(i + 1).padStart(2, '0')}</span>
              <div className="flex flex-col gap-2">
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
