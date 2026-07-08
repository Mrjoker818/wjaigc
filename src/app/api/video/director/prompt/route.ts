import { NextRequest, NextResponse } from 'next/server';
import { VIDEO_DIRECTOR_SYSTEM_PROMPT, buildDirectorUserMessage, parseDirectorResponse, type VideoDirectorMode, type DirectorStyle } from '@/lib/video-director/prompt-compiler';
import { findProviderForFeature } from '@/lib/server-api-config';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
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

    // 1) 基础规则拼接版本（无 LLM 也可用）
    const rulePrompt = [
      style === 'cinematic' ? '【电影感镜头】' : `【${style}风格】`,
      camera ? `运镜：${camera}；` : '',
      `画面描述：${userIdea.trim()}`,
      firstFrameDesc ? `\n首帧：${firstFrameDesc}` : '',
      lastFrameDesc ? `\n尾帧必须抵达：${lastFrameDesc}` : '',
      `\n光线与声音：自然光，环境声真实，避免文字/水印/字幕。`,
      audio ? `\n音效：${audio}` : '',
    ].join('');

    let llmText = '';
    try {
      const chatProvider = await findProviderForFeature('chat');
      const chatModels: string[] = (chatProvider as any)?.selectedModels || [];
      const chatModel = chatModels[0] || (chatProvider as any)?.defaultChatModel;
      if (chatProvider && chatModel) {
        const baseUrl = String((chatProvider as any).baseUrl || (chatProvider as any).base_url || '').replace(/\/$/, '');
        const apiKey = String((chatProvider as any).apiKey || (chatProvider as any).api_key || '');
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
              temperature: 0.7,
              max_tokens: 600,
            }),
            signal: AbortSignal.timeout(25000),
          });
          if (resp.ok) {
            const data = await resp.json();
            const text: string = data?.choices?.[0]?.message?.content?.trim?.() || '';
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
  } catch (err: any) {
    console.error('[video/director/prompt] error:', err);
    return NextResponse.json(
      { error: err?.message || '导演增强失败' },
      { status: 500 }
    );
  }
}
