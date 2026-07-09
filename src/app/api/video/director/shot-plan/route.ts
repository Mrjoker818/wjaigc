import { NextRequest, NextResponse } from 'next/server';
import { buildShotPlanSystemPrompt } from '@/lib/video-director/continuity';
import { getChatModelConfig, callChatApi } from '@/lib/server-api-config';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * AI 分镜规划
 * POST /api/video/director/shot-plan
 * body: { storyIdea, duration, shotCount?, style?, aspectRatio? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const storyIdea: string = String(body.storyIdea || body.story || body.prompt || '').trim();
    const totalDur = Number(body.duration) || 10;
    const n = Math.max(2, Math.min(10, Number(body.shotCount) || Math.min(6, Math.ceil(totalDur / 4))));
    const style = String(body.style || body.directorStyle || 'cinematic');
    const aspectRatio = String(body.aspectRatio || '16:9');
    if (!storyIdea) return NextResponse.json({ error: '请输入故事梗概' }, { status: 400 });

    // 使用共享 system prompt
    const systemPrompt = buildShotPlanSystemPrompt({ duration: totalDur, shotCount: n, style, aspectRatio });
    const perShotDur = Math.max(3, Math.min(10, Math.round(totalDur / n)));
    const userPrompt = `故事/想法：\n${storyIdea}\n\n请输出 JSON：包含 shots[]（${n}个镜头）、characters[]（人物）、scenes[]（场景）、props[]（关键道具，没有就返回空数组）。每个镜头必须包含 title/purpose/shotSize/cameraMotion/actionBeat/lighting/audioCues/prompt/duration/aspectRatio/continuityNotes/characterIds/sceneId/propIds。`;

    // 优先尝试：从管理员配置找 chat 模型
    let shots: any[] = [];
    let characters: any[] = [];
    let scenes: any[] = [];
    let props: any[] = [];
    let totalDuration = totalDur;
    let planText = '';

    try {
      const cfg = await getChatModelConfig();
      if (cfg) {
        const chatResp = await callChatApi(cfg, [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], { temperature: 0.7, maxTokens: 4000 });
        if (chatResp?.text) {
          planText = chatResp.text;
          const { parseShotPlanFullResponse } = await import('@/lib/video-director/continuity');
          const parsed = parseShotPlanFullResponse(planText, perShotDur, aspectRatio);
          if (parsed.shots.length > 0) {
            shots = parsed.shots.slice(0, n).map((s, i) => ({
              ...s,
              id: `shot-${Date.now()}-${i}`,
              index: i,
              duration: Math.max(3, Math.min(10, Number(s.duration) || perShotDur)),
              aspectRatio: s.aspectRatio || aspectRatio,
            }));
            characters = parsed.characters;
            scenes = parsed.scenes;
            props = parsed.props;
            totalDuration = shots.reduce((a, s) => a + (Number(s.duration) || perShotDur), 0);
            (globalThis as any).__lastShotPlanCharacters = characters;
            (globalThis as any).__lastShotPlanScenes = scenes;
            (globalThis as any).__lastShotPlanProps = props;
            return NextResponse.json({
              success: true,
              shots,
              characters,
              scenes,
              props,
              totalDuration,
              usedModel: cfg.model,
            });
          }
        }
      }
    } catch (llmErr) {
      console.warn('[video/director/shot-plan] LLM failed, using fallback:', llmErr);
    }

    // 兜底：简单拆分（无 LLM）
    const parts = storyIdea.split(/[。！？.!?\n]/).filter(Boolean);
    const segCount = Math.max(2, Math.min(n, parts.length || 3));
    if (parts.length < segCount) {
      for (let i = parts.length; i < segCount; i++) parts.push(storyIdea.slice(0, 60));
    }
    const chunkSize = Math.ceil(parts.length / segCount);
    shots = [];
    for (let i = 0; i < segCount; i++) {
      const chunk = parts.slice(i * chunkSize, (i + 1) * chunkSize).join('，');
      const dur = Math.round(totalDur / segCount);
      shots.push({
        id: `shot-${Date.now()}-${i}`,
        index: i,
        title: `镜头 ${i + 1}`,
        purpose: '叙事推进',
        shotSize: i === 0 ? 'wide establishing shot' : i === segCount - 1 ? 'medium close-up' : 'medium shot',
        cameraMotion: i === 0 ? 'slow dolly in' : i === segCount - 1 ? 'static, hold' : 'gentle tracking',
        cameraMove: i === 0 ? 'slow dolly in' : i === segCount - 1 ? 'static' : 'gentle tracking',
        actionBeat: chunk.slice(0, 80),
        lighting: 'natural cinematic light',
        audioCues: 'ambient + subtle score',
        prompt: chunk,
        duration: dur,
        aspectRatio,
        setting: '',
        continuityNotes: i > 0 ? ['保持上一镜头尾帧人物/场景一致'] : [],
        characterIds: [],
        sceneId: undefined,
        propIds: [],
        firstFrameFromPrev: i > 0,
        firstFrameUrl: '',
        lastFrameUrl: '',
        thumbnailUrl: '',
        videoUrl: '',
        status: 'planned',
        retakeSuggestions: [],
      });
    }
    totalDuration = shots.reduce((a, s) => a + s.duration, 0);
    return NextResponse.json({ success: true, shots, characters, scenes, props, totalDuration, fallback: true });
  } catch (err: any) {
    console.error('[video/director/shot-plan] error:', err);
    return NextResponse.json({ error: err?.message || '分镜规划失败' }, { status: 500 });
  }
}
