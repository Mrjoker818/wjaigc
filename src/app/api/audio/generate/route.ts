/**
 * 音频生成 API（TTS 文本转语音）
 * POST /api/audio/generate
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApiProviders } from '@/lib/server-api-config';
import { isGeneratedAudioFormat, persistGeneratedAudioResponse } from '@/lib/generated-audio-storage';
import { requireApiAuthOrReject } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authResult = await requireApiAuthOrReject(req);
  if (authResult instanceof NextResponse) return authResult;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await req.json();
    const {
      text,
      voice = 'alloy',
      model: requestedModel,
      format = 'mp3',
      speed = 1.0,
      providerId,
    } = body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ success: false, error: '请输入要转换的文本' }, { status: 400 });
    }

    if (!isGeneratedAudioFormat(format)) {
      return NextResponse.json({ success: false, error: '请选择 MP3 或 WAV 音频格式' }, { status: 400 });
    }

    // 从管理员配置中查找音频模型提供商
    const providers = await getApiProviders();
    let provider = providers.find(p => p.isEnabled && p.type === 'audio');
    
    if (providerId) {
      const explicit = providers.find(p => p.id === providerId && p.isEnabled);
      if (explicit) provider = explicit;
    }
    
    if (!provider) {
      provider = providers.find(p => p.isEnabled && (p.type === 'universal' || p.type === 'general'));
    }
    
    if (!provider) {
      return NextResponse.json({ 
        success: false, 
        error: '未配置TTS音频模型提供商，请在管理员面板添加OpenAI兼容的音频模型（如tts-1、gpt-4o-mini-tts）' 
      }, { status: 400 });
    }

    const model = requestedModel || provider.selectedModels?.[0] || 'tts-1';

    // 构建请求体
    const ttsRequestBody: Record<string, unknown> = {
      model,
      input: text,
      voice,
      response_format: format,
      speed,
    };

    console.log('[Audio] TTS request:', { provider: provider.name, model, voice, format, textLen: text.length });

    // 直接调用TTS API - 尝试带/v1和不带/v1
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 55000);
    const signal = AbortSignal.any([controller.signal, req.signal]);

    const baseUrl = provider.baseUrl.replace(/\/$/, '');
    const urls = [`${baseUrl}/v1/audio/speech`, `${baseUrl}/audio/speech`];
    
    let ttsResponse: Response | null = null;
    let lastError: Error | null = null;
    
    for (const url of urls) {
      try {
        ttsResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify(ttsRequestBody),
          signal,
        });
        if (ttsResponse.ok) break;
        if (ttsResponse.status !== 404) {
          // 非404错误直接返回
          break;
        }
      } catch (e) {
        lastError = e as Error;
        if (url === urls[urls.length - 1]) throw e;
      }
    }

    if (!ttsResponse || !ttsResponse.ok) {
      let errorText = '';
      try { if (ttsResponse) errorText = await ttsResponse.text(); } catch {}
      console.error('[Audio] TTS error:', ttsResponse?.status, errorText.slice(0,300));
      return NextResponse.json({ 
        success: false, 
        error: `语音生成失败: ${ttsResponse?.status || 'network error'} ${errorText.slice(0,200) || lastError?.message || ''}` 
      }, { status: 502 });
    }

    const { filename, audioUrl, size } = await persistGeneratedAudioResponse(ttsResponse, format, signal);
    const estimatedDuration = Math.max(1, Math.ceil(text.length / 15));

    console.log('[Audio] Generated:', { filename, size });

    return NextResponse.json({
      success: true,
      audioUrl,
      filename,
      format,
      size,
      duration: estimatedDuration,
      model,
      provider: provider.name,
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Audio] Generation error:', err);
    const isTimeout = err?.name === 'AbortError';
    return NextResponse.json({ 
      success: false, 
      error: isTimeout ? '语音生成超时，请重试' : (err?.message || '语音生成失败，请检查TTS模型配置') 
    }, { status: 500 });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
