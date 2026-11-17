import { NextRequest, NextResponse } from 'next/server';
import { VIDEO_DIRECTOR_SYSTEM_PROMPT, buildDirectorUserMessage, parseDirectorResponse, type VideoDirectorMode } from '@/lib/video-director/prompt-compiler';
import { DIRECTOR_STYLES, normalizeDirectorStyle } from '@/lib/video-director/director-styles';
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
      style: rawStyle,
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
    const style = normalizeDirectorStyle(rawStyle);

    if (!userIdea || typeof userIdea !== 'string' || !userIdea.trim()) {
      return NextResponse.json({ error: '请输入视频创意描述' }, { status: 400 });
    }

    const userPrompt = buildDirectorUserMessage({
      mode: mode as VideoDirectorMode,
      userPrompt: userIdea.trim(),
      modelId,
      model: modelId,
      style,
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
    const sp = DIRECTOR_STYLES[style].rule;
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
              temperature: DIRECTOR_STYLES[style].temperature,
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
