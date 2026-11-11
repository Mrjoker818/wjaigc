import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildApiUrl, ensureVersionPath, shouldSkipV1Retry } from '@/lib/api-helpers';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { ensureGeneratedAudioStorage, persistGeneratedAudioResponse } from '@/lib/generated-audio-storage';
import { getConfiguredModelsForProvider } from '@/lib/model-type-classification';
import { assertSafeProviderUrl } from '@/lib/poisoned-api-host';
import { getApiProviders } from '@/lib/server-api-config';
import { listManagedUsers } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

const audioRequest = z.object({
  text: z.string().trim().min(1).max(4000),
  voice: z.string().trim().min(1).max(128).default('alloy'),
  model: z.string().trim().min(1).optional(),
  providerId: z.string().trim().min(1).optional(),
  format: z.enum(['mp3', 'wav']).default('mp3'),
  speed: z.number().min(0.25).max(4).default(1),
});

function speechEndpoint(baseUrl: string): string {
  assertSafeProviderUrl(baseUrl);
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('AUDIO_ENDPOINT_INVALID');
  const base = url.href.replace(/\/+$/, '');
  if (base.endsWith('/audio/speech')) return base;
  return buildApiUrl(shouldSkipV1Retry(base) ? base : ensureVersionPath(base), '/audio/speech');
}

function unconfirmedResult() {
  return NextResponse.json({
    success: false,
    code: 'AUDIO_RESULT_UNCONFIRMED',
    error: '语音任务结果尚未确认，请勿立即重复提交。',
    retryable: false,
  }, { status: 503 });
}

export async function POST(req: NextRequest) {
  const authResult = await requireApiAuthOrReject(req);
  if (authResult instanceof NextResponse) return authResult;

  const parsed = audioRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '请检查文本、语音参数和 MP3/WAV 格式。' }, { status: 400 });
  }
  const { text, voice, model: requestedModel, providerId, format, speed } = parsed.data;

  let endpoint: string;
  let provider: { name: string; apiKey: string };
  let model: string;
  let ownerId: string;
  try {
    const user = authResult.source === 'internal'
      ? (await listManagedUsers()).find(candidate => candidate.id === authResult.userId)
      : authResult.user;
    if (!user || user.status === 'disabled' || (user.role !== 'admin' && user.apiPermissions?.audio !== true)) {
      return NextResponse.json({ success: false, error: '当前账号未获得语音生成权限。' }, { status: 403 });
    }
    ownerId = user.id;

    const providers = await getApiProviders({ strict: true, migrateFileProviders: false });
    const matches = providers.flatMap(candidate => {
      if (!candidate.isEnabled || !candidate.baseUrl || !candidate.apiKey
        || (providerId && candidate.id !== providerId)) return [];
      return getConfiguredModelsForProvider(candidate)
        .filter(item => item.type === 'audio' && (!requestedModel || item.id === requestedModel))
        .map(item => ({ provider: candidate, model: item.id }));
    });
    if (requestedModel && !providerId && matches.length > 1) {
      return NextResponse.json({ success: false, error: '该模型由多个供应商提供，请同时指定供应商。' }, { status: 400 });
    }
    const selected = matches.find(item => item.provider.isDefault) ?? matches[0];
    if (!selected) {
      return NextResponse.json({ success: false, error: '所选语音模型不可用，请核对管理员配置。' }, {
        status: providerId || requestedModel ? 403 : 400,
      });
    }
    ({ provider, model } = selected);
    endpoint = speechEndpoint(selected.provider.baseUrl);
  } catch {
    return NextResponse.json({
      success: false, code: 'AUDIO_CONFIG_UNAVAILABLE', error: '语音模型配置暂时不可用。',
    }, { status: 503 });
  }

  try {
    await ensureGeneratedAudioStorage();
  } catch {
    return NextResponse.json({
      success: false, code: 'AUDIO_STORAGE_UNAVAILABLE', error: '语音文件存储暂时不可用。',
    }, { status: 503 });
  }

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(55_000)]);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({ model, input: text, voice, response_format: format, speed }),
      redirect: 'manual',
      signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status < 400 || response.status === 408 || response.status >= 500) return unconfirmedResult();
      return NextResponse.json({
        success: false, code: 'AUDIO_PROVIDER_REJECTED', error: '供应商拒绝语音生成请求，请检查模型和语音参数。',
      }, { status: 502 });
    }

    const { filename, audioUrl, size } = await persistGeneratedAudioResponse(response, format, ownerId, signal);
    return NextResponse.json({
      success: true,
      audioUrl,
      filename,
      format,
      size,
      duration: Math.max(1, Math.ceil(text.length / 15)),
      model,
      provider: provider.name,
    });
  } catch {
    return unconfirmedResult();
  }
}
