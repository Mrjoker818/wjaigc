import { NextRequest, NextResponse } from 'next/server';
import {
  buildShotPlanSystemPrompt,
  parseShotPlanFullResponse,
} from '@/lib/video-director/continuity';
import { getChatModelConfig, callChatApi } from '@/lib/server-api-config';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 故事资产规划（专用）：只生成/补全 characters / scenes / props，不要求分镜。
 * POST /api/story-assets/plan
 * body: { storyIdea, duration?, aspectRatio?, style? }
 * 返回: { success, characters, scenes, props }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const storyIdea = String(body.storyIdea || body.story || body.prompt || '').trim();
    const duration = Number(body.duration) || 10;
    const aspectRatio = String(body.aspectRatio || '16:9');
    const style = String(body.style || body.directorStyle || 'cinematic');
    if (!storyIdea) return NextResponse.json({ error: '请输入故事梗概' }, { status: 400 });

    const systemPrompt = buildShotPlanSystemPrompt({ duration, shotCount: 4, style, aspectRatio });
    const userPrompt = `故事/想法：\n${storyIdea}\n\n请**仅**输出资产 JSON（shots 数组可以留空或给 1-2 个概括镜头，但重点是 characters[]、scenes[]、props[] 必须完整）。格式要求同前：characters 包含 id/name/age/gender/appearance/costume/hair/accessories/keywords；scenes 包含 id/name/location/timeOfDay/weather/lighting/mood/colorPalette/keyProps/description；props 包含 id/name/role/material/color/scale/description/sceneId/shotIds。没有人物返回 []，没有道具返回 []。`;

    let text = '';
    let usedModel = '';
    try {
      const cfg = await getChatModelConfig();
      if (cfg) {
        const resp = await callChatApi(cfg, [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], { temperature: 0.7, maxTokens: 4000 });
        if (resp?.text) {
          text = resp.text;
          usedModel = cfg.model || '';
        }
      }
    } catch (llmErr) {
      console.warn('[story-assets/plan] LLM failed:', llmErr);
    }

    if (!text) {
      return NextResponse.json({
        success: true,
        characters: [],
        scenes: [],
        props: [],
        fallback: true,
      });
    }

    const parsed = parseShotPlanFullResponse(text, 5, aspectRatio);
    return NextResponse.json({
      success: true,
      characters: parsed.characters,
      scenes: parsed.scenes,
      props: parsed.props,
      usedModel,
    });
  } catch (err: any) {
    console.error('[story-assets/plan] error:', err);
    return NextResponse.json({ error: err?.message || '资产规划失败' }, { status: 500 });
  }
}
