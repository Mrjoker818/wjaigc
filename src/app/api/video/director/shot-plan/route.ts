import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature } from '@/lib/server-api-config';
import {
  buildShotPlanSystemPrompt,
  buildShotPlanUserMessage,
  parseShotPlanResponse,
  parseShotPlanCharacters,
  parseShotPlanScenes,
  initShotFromPlan,
  type VideoShotPlan,
  type DirectorStyle,
} from '@/lib/video-director';

// 轻量级 fallback shot planner（无 LLM 可用时）
function fallbackShotPlan(userIdea: string, aspectRatio: string, duration: number, shotCount: number): VideoShotPlan[] {
  const shots: VideoShotPlan[] = [];
  const perShotDur = Math.max(3, Math.min(10, Math.floor(duration / Math.max(1, shotCount))));
  const beatNames = ['开场', '发展', '转折', '高潮', '收尾', '尾声'];
  for (let i = 0; i < shotCount; i++) {
    const beat = beatNames[i] || `镜头${i + 1}`;
    const shotSize = i === 0 ? '全景' : i === shotCount - 1 ? '特写' : '中景';
    const cameraMove = i === 0 ? '静止' : i % 2 === 0 ? '缓慢推进' : '右摇';
    shots.push(initShotFromPlan({
      id: `shot-${Date.now()}-${i}`,
      index: i,
      title: `${beat}`,
      purpose: i === 0 ? '建立场景氛围与主题' : i === shotCount - 1 ? '情感落地与收尾' : '推进叙事',
      prompt: i === 0
        ? `【全景】${userIdea}，环境建立，主要角色出场，光线铺陈。`
        : i === shotCount - 1
        ? `【特写】承接上一镜头情绪，聚焦主体表情/关键物件，给出情感落点。`
        : `【中景】${userIdea}，动作节拍持续，情绪递进。`,
      duration: perShotDur,
      aspectRatio,
      shotSize,
      cameraMotion: cameraMove,
      cameraMove,
      actionBeat: beat,
      lighting: i === 0 ? '自然主光' : '保持基调一致',
      audioCues: i === 0 ? '环境音铺底' : '延续背景音',
      firstFramePrompt: i > 0 ? '承接上一镜头尾帧' : undefined,
      lastFramePrompt: i < shotCount - 1 ? '停留以便下一镜头接续' : '定格收尾',
      continuityNotes: i === 0 ? ['保持角色服装/发型/光线基调一致'] : ['承接上一镜头尾帧', '保持角色一致'],
      references: [],
      status: 'planned',
    }));
  }
  return shots;
}

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { story, storyIdea, userIdea, shotCount, aspectRatio = '16:9', duration = 5, characters = '', setting = '', style = 'cinematic', model } = body || {};
    const idea = String(story || storyIdea || userIdea || '').trim();
    if (!idea) {
      return NextResponse.json({ error: '请输入故事梗概' }, { status: 400 });
    }
    const n = Math.max(2, Math.min(8, Number(shotCount) || 3));
    const perShotDur = Math.max(3, Math.min(10, Math.floor(Number(duration) / n) || 5));
    const fallback = fallbackShotPlan(idea, aspectRatio, Number(duration) || perShotDur * n, n);

    let shots: VideoShotPlan[] = fallback;
    try {
      const chatProvider = await findProviderForFeature('chat');
      const chatModels: string[] = (chatProvider as any)?.selectedModels || [];
      const chatModel = chatModels[0] || (chatProvider as any)?.defaultChatModel;
      if (chatProvider && chatModel) {
        const baseUrl = String((chatProvider as any).baseUrl || (chatProvider as any).base_url || '').replace(/\/$/, '');
        const apiKey = String((chatProvider as any).apiKey || (chatProvider as any).api_key || '');
        if (baseUrl && apiKey) {
          const url = baseUrl.endsWith('/chat/completions')
            ? baseUrl
            : `${baseUrl}${baseUrl.endsWith('/v1') ? '' : '/v1'}/chat/completions`;
          const sys = buildShotPlanSystemPrompt(style as DirectorStyle);
          const usr = buildShotPlanUserMessage({
            storyIdea: idea,
            shotCount: n,
            duration: perShotDur,
            aspectRatio,
            style: style as DirectorStyle,
            characters: typeof characters === 'string' ? characters : Array.isArray(characters) ? characters.join('、') : '',
            setting: typeof setting === 'string' ? setting : '',
            model,
          });
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: chatModel,
              messages: [
                { role: 'system', content: sys },
                { role: 'user', content: usr },
              ],
              temperature: 0.6,
              max_tokens: 2000,
            }),
            signal: AbortSignal.timeout(25000),
          });
          if (resp.ok) {
            const data = await resp.json();
            let text = data?.choices?.[0]?.message?.content?.trim?.() || '';
            const parsed = parseShotPlanResponse(text, perShotDur, aspectRatio);
            if (parsed.length > 0) {
              shots = parsed.slice(0, n).map((s, i) => initShotFromPlan({
                ...s,
                id: `shot-${Date.now()}-${i}`,
                index: i,
                duration: Math.max(3, Math.min(10, Number(s.duration) || perShotDur)),
                aspectRatio: s.aspectRatio || aspectRatio,
                status: 'planned',
              }));
              // 解析 LLM 返回的 characters / scenes
              const parsedCharacters = parseShotPlanCharacters(text);
              const parsedScenes = parseShotPlanScenes(text, shots);
              (globalThis as any).__lastShotPlanCharacters = parsedCharacters;
              (globalThis as any).__lastShotPlanScenes = parsedScenes;
              return NextResponse.json({
                success: true,
                shots,
                characters: parsedCharacters,
                scenes: parsedScenes,
                totalDuration: shots.reduce((a, s) => a + (s.duration || 3), 0),
              });
            }
          }
        }
      }
    } catch (llmErr) {
      console.warn('[video/director/shot-plan] LLM failed, using fallback:', llmErr);
    }

    const totalDuration = shots.reduce((a, s) => a + (s.duration || 3), 0);
    return NextResponse.json({ success: true, shots, totalDuration });
  } catch (err: any) {
    console.error('[video/director/shot-plan] error:', err);
    return NextResponse.json({ error: err?.message || '分镜规划失败' }, { status: 500 });
  }
}
