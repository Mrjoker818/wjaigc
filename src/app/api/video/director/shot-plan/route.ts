import { NextRequest, NextResponse } from 'next/server';
import { buildShotPlanSystemPrompt, parseShotPlanFullResponse, type VideoCharacter, type VideoProp, type VideoScene, type VideoShotPlan } from '@/lib/video-director/continuity';
import { findProviderForFeature } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ChatProviderConfig {
  selectedModels?: string[];
  defaultChatModel?: string;
  baseUrl?: string;
  base_url?: string;
  apiKey?: string;
  api_key?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
}

function getChatProviderConfig(provider: unknown): ChatProviderConfig {
  return provider !== null && typeof provider === 'object' ? provider as ChatProviderConfig : {};
}

async function callChatLLM(messages: { role: string; content: string }[], temperature = 0.7, maxTokens = 4000): Promise<string | null> {
  const chatProvider = await findProviderForFeature('chat');
  if (!chatProvider) return null;
  const config = getChatProviderConfig(chatProvider);
  const chatModels = config.selectedModels || [];
  const chatModel = chatModels[0] || config.defaultChatModel;
  const baseUrl = String(config.baseUrl || config.base_url || '').replace(/\/$/, '');
  const apiKey = String(config.apiKey || config.api_key || '');
  if (!baseUrl || !apiKey || !chatModel) return null;
  try {
    const endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}${baseUrl.includes('/v1') ? '' : '/v1'}/chat/completions`;
    const resp = await fetchWithV1Retry(endpoint, '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: chatModel,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    }, false, 50000);
    if (!resp.ok) return null;
    const data = await resp.json() as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
    return typeof text === 'string' ? text : null;
  } catch (e) {
    console.warn('[shot-plan] LLM call failed:', e);
    return null;
  }
}

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

    const systemPrompt = buildShotPlanSystemPrompt(totalDur, n, style, aspectRatio);
    const perShotDur = Math.max(3, Math.min(10, Math.round(totalDur / n)));
    const userPrompt = `故事/想法：\n${storyIdea}\n\n请输出 JSON：包含 shots[]（${n}个镜头）、characters[]（人物）、scenes[]（场景）、props[]（关键道具，没有就返回空数组）。每个镜头必须包含 title/purpose/shotSize/cameraMotion/actionBeat/lighting/audioCues/prompt/duration/aspectRatio/continuityNotes/characterIds/sceneId/propIds。`;

    let shots: VideoShotPlan[] = [];
    let characters: VideoCharacter[] = [];
    let scenes: VideoScene[] = [];
    let propsArr: VideoProp[] = [];
    let totalDuration = totalDur;
    let usedModel = '';

    try {
      const chatProvider = await findProviderForFeature('chat');
      const config = getChatProviderConfig(chatProvider);
      usedModel = config.selectedModels?.[0] || config.defaultChatModel || '';
      const llmText = await callChatLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], 0.7, 4000);
      if (llmText) {
        const parsed = parseShotPlanFullResponse(llmText, perShotDur, aspectRatio);
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
          propsArr = parsed.props;
          totalDuration = shots.reduce((total, shot) => total + (Number(shot.duration) || perShotDur), 0);
          return NextResponse.json({
            success: true,
            shots,
            characters,
            scenes,
            props: propsArr,
            totalDuration,
            usedModel,
          });
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
        references: [],
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
        diagnosis: null,
        retakeCount: 0,
        error: undefined,
      });
    }
    totalDuration = shots.reduce((total, shot) => total + shot.duration, 0);
    return NextResponse.json({ success: true, shots, characters, scenes, props: propsArr, totalDuration, fallback: true });
  } catch (err: unknown) {
    console.error('[video/director/shot-plan] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '分镜规划失败' }, { status: 500 });
  }
}
