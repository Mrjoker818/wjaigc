import { NextRequest, NextResponse } from 'next/server';
import { buildStoryAssetsPrompt, parseStoryAssetsResponse } from '@/lib/video-director/continuity';
import { findProviderForFeature } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function callChatLLM(messages: { role: string; content: string }[], temperature = 0.7, maxTokens = 4000): Promise<string | null> {
  const chatProvider = await findProviderForFeature('chat');
  if (!chatProvider) return null;
  const chatModels: string[] = (chatProvider as any)?.selectedModels || [];
  const chatModel = chatModels[0] || (chatProvider as any)?.defaultChatModel;
  const baseUrl = String((chatProvider as any).baseUrl || (chatProvider as any).base_url || '').replace(/\/$/, '');
  const apiKey = String((chatProvider as any).apiKey || (chatProvider as any).api_key || '');
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
    const data = await resp.json() as any;
    const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
    return typeof text === 'string' ? text : null;
  } catch (e) {
    console.warn('[story-assets/plan] LLM call failed:', e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const storyIdea: string = String(body.storyIdea || body.story || body.prompt || '').trim();
    const duration = Math.max(3, Math.min(30, Number(body.duration) || 10));
    const aspectRatio: string = String(body.aspectRatio || '16:9');
    const style: string = String(body.style || body.directorStyle || 'cinematic');
    if (!storyIdea) return NextResponse.json({ error: '请输入故事梗概' }, { status: 400 });

    const systemPrompt = buildStoryAssetsPrompt({ duration, style, aspectRatio });
    const userPrompt = `故事/剧本：\n${storyIdea}\n\n请输出 JSON：包含 characters[]、scenes[]、props[]（没有道具时返回空数组）。`;

    try {
      const llmText = await callChatLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], 0.6, 4000);
      if (llmText) {
        const parsed = parseStoryAssetsResponse(llmText);
        if (parsed.characters.length > 0 || parsed.scenes.length > 0 || parsed.props.length > 0) {
          const now = Date.now();
          return NextResponse.json({
            success: true,
            characters: parsed.characters.map((c: any, i: number) => ({ ...c, id: c.id || `char-${now}-${i}` })),
            scenes: parsed.scenes.map((s: any, i: number) => ({ ...s, id: s.id || `scene-${now}-${i}` })),
            props: parsed.props.map((p: any, i: number) => ({ ...p, id: p.id || `prop-${now}-${i}` })),
          });
        }
      }
    } catch (e) {
      console.warn('[story-assets/plan] LLM error:', e);
    }

    // 兜底：返回一个默认角色 + 一个默认场景
    const now = Date.now();
    return NextResponse.json({
      success: true,
      fallback: true,
      characters: [{
        id: `char-${now}-0`,
        name: '主角',
        appearance: storyIdea.slice(0, 60),
        role: '主角',
        gender: 'unknown',
        frontPrompt: `${storyIdea.slice(0, 60)}, character design reference sheet, front view, white background, studio lighting`,
        sidePrompt: `${storyIdea.slice(0, 60)}, character design reference sheet, side view, white background, studio lighting`,
        keywords: ['protagonist'],
      }],
      scenes: [{
        id: `scene-${now}-0`,
        name: '主场景',
        description: storyIdea.slice(0, 80),
        lighting: 'natural cinematic light',
        scenePrompt: `${storyIdea.slice(0, 80)}, cinematic establishing shot, wide angle, high detail, movie still`,
      }],
      props: [],
    });
  } catch (err: any) {
    console.error('[story-assets/plan] error:', err);
    return NextResponse.json({ error: err?.message || '资产规划失败' }, { status: 500 });
  }
}
