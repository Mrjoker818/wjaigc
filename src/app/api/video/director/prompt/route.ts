import { NextRequest, NextResponse } from 'next/server';
import { VIDEO_DIRECTOR_SYSTEM_PROMPT, buildDirectorUserMessage, parseDirectorResponse, type VideoDirectorMode, type DirectorStyle } from '@/lib/video-director/prompt-compiler';
import { findProviderForFeature } from '@/lib/server-api-config';
import { requireApiAuthOrReject } from '@/lib/api-auth';

export const maxDuration = 30;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function chatCompletionText(value: unknown): string {
  const data = value as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 按导演风格自适应温度：电影感/音乐视频需要更高创意度，纪录片/商业需要更精确 */
const STYLE_TEMPERATURE: Record<string, number> = {
  cinematic: 0.85,
  documentary: 0.55,
  commercial: 0.6,
  'music-video': 0.9,
  anime: 0.8,
  minimal: 0.5,
};

export async function POST(req: NextRequest) {
  const authResult = await requireApiAuthOrReject(req);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const body = await req.json();
    const {
      userIdea,
      mode = 'text2video',
      aspectRatio = '16:9',
      duration = 5,
      style = 'cinematic',
      language = 'zh',
      firstFrameDesc,
      lastFrameDesc,
      audio,
      modelId,
      verbosity = 'standard',
      imageUrl,
      lastFrameUrl,
      camera,
      references,
    } = body || {};

    if (!userIdea || typeof userIdea !== 'string' || !userIdea.trim()) {
      return NextResponse.json({ error: '请输入视频创意描述' }, { status: 400 });
    }

    const userPrompt = buildDirectorUserMessage({
      mode: mode as VideoDirectorMode,
      userPrompt: userIdea.trim(),
      modelId,
      model: modelId,
      style: style as DirectorStyle,
      aspectRatio,
      duration: Number(duration) || 5,
      firstFrameNote: firstFrameDesc,
      lastFrameNote: lastFrameDesc,
      imageUrl,
      lastFrameUrl,
      audio: Boolean(audio),
      camera,
      references,
      includeNegative: true,
      verbosity,
      language,
    });

    // 1) 规则增强版 prompt（无 LLM 时的智能 fallback）
    const stylePhrases: Record<string, { opening: string; quality: string; mood: string }> = {
      cinematic: { opening: '史诗级电影镜头', quality: '电影级画质，35mm胶片质感，浅景深，电影级调色', mood: '宏大叙事感，强烈的视觉冲击力' },
      documentary: { opening: '纪实风格镜头', quality: '自然光线，手持摄影质感，真实色彩还原', mood: '真实记录感，自然不做作' },
      commercial: { opening: '商业广告级镜头', quality: '专业影棚光效，产品级画质，高饱和度色彩', mood: '精致高级感，吸引眼球的视觉呈现' },
      'music-video': { opening: 'MV风格镜头', quality: '节奏感画面，动态光效，高对比度色彩', mood: '充满节奏感和情绪张力' },
      anime: { opening: '动画风格镜头', quality: '流畅动作，细腻线条，鲜艳色彩', mood: '二次元美感，生动的角色表现' },
      minimal: { opening: '极简风格镜头', quality: '干净构图，柔和自然光，低饱和度调色', mood: '宁静致远的极简美学' },
    };
    const sp = stylePhrases[style] || stylePhrases.cinematic;
    const rulePrompt = [
      `${sp.opening}：${sp.quality}。`,
      camera ? `运镜方式：${camera}。` : '运镜方式：平滑推进或横摇。',
      `画面内容：${userIdea.trim()}`,
      firstFrameDesc ? `开场画面：${firstFrameDesc}` : '',
      lastFrameDesc ? `结束画面必须呈现：${lastFrameDesc}` : '',
      `整体氛围：${sp.mood}。`,
      `光线：${style === 'cinematic' ? '戏剧性侧光与逆光，柔光箱补光' : '自然柔和光线'}。`,
      `色调：${style === 'anime' ? '鲜明动画色调' : style === 'commercial' ? '高饱和度商业色调' : '电影感LUT调色'}。`,
      audio ? `音效设计：${audio}` : '音效：高质量环境音，空间感立体声',
      '',
      '[NEGATIVE] 模糊、变形、抖动、水印、文字、字幕、logo、低画质、压缩伪影、过曝、死黑 [/NEGATIVE]',
    ].filter(Boolean).join('\n');

    let llmText = '';
    try {
      const chatProvider = await findProviderForFeature('chat');
      const chatModels = chatProvider?.selectedModels ?? [];
      const chatModel = chatModels[0];
      if (chatProvider && chatModel) {
        const baseUrl = chatProvider.baseUrl.replace(/\/$/, '');
        const apiKey = chatProvider.apiKey;
        if (baseUrl && apiKey) {
          // 自动处理 /v1 前缀
          const url = baseUrl.endsWith('/chat/completions')
            ? baseUrl
            : `${baseUrl}${baseUrl.endsWith('/v1') ? '' : '/v1'}/chat/completions`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: chatModel,
              messages: [
                { role: 'system', content: VIDEO_DIRECTOR_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
              ],
              temperature: STYLE_TEMPERATURE[style] ?? 0.8,
              max_tokens: 2000,
            }),
            signal: AbortSignal.timeout(40000),
          });
          if (resp.ok) {
            const data = await resp.json() as unknown;
            const text = chatCompletionText(data);
            if (text && text.length > 20) {
              llmText = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
            }
          }
        }
      }
    } catch (llmErr) {
      console.warn('[video/director/prompt] LLM enhance failed:', llmErr);
    }

    const finalText = llmText || rulePrompt;
    const compiled = parseDirectorResponse(finalText);

    return NextResponse.json({
      success: true,
      compiled: {
        prompt: compiled.prompt,
        negativePrompt: compiled.negativePrompt,
        contract: compiled.contract,
        firstFrameSuggestion: compiled.firstFrameSuggestion,
        lastFrameSuggestion: compiled.lastFrameSuggestion,
        endState: compiled.contract?.endState,
        compiledBy: llmText ? 'llm-director' : 'rule-director',
      },
      mode,
      rawText: finalText,
    });
  } catch (err: unknown) {
    console.error('[video/director/prompt] error:', err);
    return NextResponse.json(
      { error: errorMessage(err, 'Director prompt enhancement failed') },
      { status: 500 }
    );
  }
}
