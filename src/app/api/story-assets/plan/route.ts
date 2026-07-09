import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import {
  buildStoryAssetsPrompt,
  parseStoryAssetsResponse,
  type VideoShotPlan,
  type VideoCharacter,
  type VideoScene,
  type VideoProp,
  type DirectorStyle,
} from '@/lib/video-director';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      storyIdea,
      shots = [],
      characters = [],
      scenes = [],
      props = [],
      style = 'cinematic',
      aspectRatio = '16:9',
    } = body || {};

    if (!storyIdea || typeof storyIdea !== 'string' || storyIdea.trim().length < 5) {
      return NextResponse.json({ error: '请输入故事梗概（至少 5 字）' }, { status: 400 });
    }
    if (!Array.isArray(shots) || shots.length === 0) {
      return NextResponse.json({ error: '需要先有分镜结果' }, { status: 400 });
    }

    const provider = await findProviderForFeature('chat');
    if (!provider || !provider.selectedModels?.length) {
      return NextResponse.json({ error: '未配置可用的 LLM 模型' }, { status: 503 });
    }
    const modelId = provider.selectedModels[0];
    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    const apiKey = provider.apiKey;

    const systemPrompt = buildStoryAssetsPrompt({
      storyIdea: storyIdea.trim(),
      shots: shots as VideoShotPlan[],
      characters: characters as VideoCharacter[],
      scenes: scenes as VideoScene[],
      props: props as VideoProp[],
      style: style as DirectorStyle,
      aspectRatio,
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '请输出需要生成的资产任务列表 JSON。' },
    ];

    const res = await fetchWithV1Retry(baseUrl, '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      return NextResponse.json({ error: `LLM 调用失败(${res.status}): ${errTxt.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const result = parseStoryAssetsResponse(typeof content === 'string' ? content : JSON.stringify(content));

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('[story-assets/plan] error:', err);
    return NextResponse.json({ error: err?.message || '规划失败' }, { status: 500 });
  }
}
