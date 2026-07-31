import 'server-only';

import {
  adjustRequestForProfile,
  buildGeminiChatImageRequest,
  buildPollUrl,
  extractImageUrl,
  parseGeminiChatImageResponse,
  parseResponseForProfile,
  resolveProfileForModel,
} from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { buildDisplayDecomposeRequestBody } from '@/lib/display-decompose';
import { resolveLayerSourceImage } from '@/lib/layer-decomposition/source-image';
import type { ApiProvider } from '@/lib/universal-api-types';

export type ElementBoardRemoteStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface ElementBoardRemoteResult {
  status: ElementBoardRemoteStatus;
  progress: number;
  imageUrl?: string;
  error?: string;
}

function apiError(prefix: string, status: number, data: Record<string, unknown>): Error {
  const nestedError = data.error && typeof data.error === 'object'
    ? (data.error as Record<string, unknown>).message
    : data.error;
  return new Error(String(nestedError || data.message || `${prefix} (${status})`));
}

async function readJson(response: Response, prefix: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${prefix}: provider returned non-JSON data`);
  }
  if (!response.ok) throw apiError(prefix, response.status, data);
  return data;
}

function normalizeRemoteStatus(data: Record<string, unknown>): ElementBoardRemoteStatus {
  const nested = data.data && typeof data.data === 'object'
    ? data.data as Record<string, unknown>
    : undefined;
  const value = String(data.status || data.state || nested?.status || nested?.state || '').toLowerCase();
  if (['completed', 'succeeded', 'success', 'done'].includes(value)) return 'completed';
  if (['failed', 'error', 'rejected'].includes(value)) return 'failed';
  if (['cancelled', 'canceled'].includes(value)) return 'cancelled';
  if (['timeout', 'timed_out'].includes(value)) return 'timeout';
  if (['queued', 'pending', 'created', 'submitted'].includes(value)) return 'queued';
  return 'processing';
}

function normalizeProgress(data: Record<string, unknown>, status: ElementBoardRemoteStatus): number {
  const nested = data.data && typeof data.data === 'object'
    ? data.data as Record<string, unknown>
    : undefined;
  const raw = Number(data.progress ?? nested?.progress);
  if (Number.isFinite(raw)) return Math.min(Math.max(Math.round(raw), 0), 100);
  if (status === 'completed') return 100;
  if (status === 'queued') return 5;
  return 20;
}

function appendMultipartImage(form: FormData, key: string, dataUrl: string): void {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match) throw new Error('Element board source image is not a supported data URL');
  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
  form.append(key, new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), `source.${extension}`);
}

function buildMultipartBody(body: Record<string, unknown>, sourceDataUrl: string): FormData {
  const form = new FormData();
  appendMultipartImage(form, 'image', sourceDataUrl);
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || key === 'image' || key === 'image_urls' || key === 'images') continue;
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, typeof item === 'string' ? item : JSON.stringify(item));
      continue;
    }
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return form;
}

export async function submitElementBoardProviderTask(input: {
  provider: ApiProvider;
  modelId: string;
  sourceUrl: string;
  sourceHash: string;
  aspectRatio: string;
  background: 'light-gray' | 'transparent';
}): Promise<{ remoteTaskId?: string; directUrl?: string; usedModel: string }> {
  const profile = resolveProfileForModel(input.modelId, input.provider);
  const source = await resolveLayerSourceImage(input.sourceUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  const sourceDataUrl = `data:${source.mimeType};base64,${source.buffer.toString('base64')}`;
  const rawBody = buildDisplayDecomposeRequestBody({
    model: input.modelId,
    imageUrl: input.sourceUrl,
    sourceHash: input.sourceHash,
    aspectRatio: input.aspectRatio,
    background: input.background,
  });
  delete rawBody.source_hash;
  rawBody.image = sourceDataUrl;
  rawBody.image_urls = [sourceDataUrl];

  if (profile.id === 'gemini-image') {
    const chatBody = buildGeminiChatImageRequest(rawBody);
    const response = await fetchWithV1Retry(input.provider.baseUrl, '/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chatBody),
      signal: AbortSignal.timeout(600_000),
    });
    const data = await readJson(response, 'Element board submission failed');
    const directUrl = parseGeminiChatImageResponse(data)[0];
    if (!directUrl) throw new Error('Element board Gemini provider returned no image');
    return { directUrl, usedModel: input.modelId };
  }

  const adjusted = adjustRequestForProfile(rawBody, profile, {
    hasImage: true,
    hasReferenceImages: true,
  });
  const multipart = adjusted.endpoint === '/images/edits' && profile.editEncoding === 'multipart-only';
  const response = await fetchWithV1Retry(input.provider.baseUrl, adjusted.endpoint, {
    method: 'POST',
    headers: multipart
      ? { Authorization: `Bearer ${input.provider.apiKey}` }
      : {
          Authorization: `Bearer ${input.provider.apiKey}`,
          'Content-Type': 'application/json',
        },
    body: multipart ? buildMultipartBody(adjusted.body, sourceDataUrl) : JSON.stringify(adjusted.body),
    signal: AbortSignal.timeout(profile.responseMode === 'direct' ? 600_000 : 300_000),
  });
  const data = await readJson(response, 'Element board submission failed');
  const parsed = parseResponseForProfile(data, profile);
  const directUrl = parsed.directImageUrls[0] || extractImageUrl(data) || undefined;
  const remoteTaskId = parsed.taskIds[0];
  if (!directUrl && !remoteTaskId) {
    throw new Error('Element board provider returned neither a task ID nor an image URL');
  }
  return { directUrl, remoteTaskId, usedModel: input.modelId };
}

export async function pollElementBoardProviderTask(input: {
  provider: ApiProvider;
  modelId: string;
  remoteTaskId: string;
}): Promise<ElementBoardRemoteResult> {
  const profile = resolveProfileForModel(input.modelId, input.provider);
  const pollUrl = buildPollUrl(input.provider.baseUrl, input.remoteTaskId, profile);
  if (!pollUrl) throw new Error('The selected element board provider does not support task polling');
  const response = await fetch(pollUrl, {
    headers: { Authorization: `Bearer ${input.provider.apiKey}` },
    signal: AbortSignal.timeout(60_000),
  });
  const data = await readJson(response, 'Element board polling failed');
  const imageUrl = extractImageUrl(data) || undefined;
  const status = imageUrl ? 'completed' : normalizeRemoteStatus(data);
  if (status === 'completed' && !imageUrl) {
    return { status: 'failed', progress: 100, error: 'BOARD_RESULT_MISSING' };
  }
  const nestedError = data.error && typeof data.error === 'object'
    ? (data.error as Record<string, unknown>).message
    : data.error;
  return {
    status,
    progress: normalizeProgress(data, status),
    imageUrl,
    error: typeof nestedError === 'string' ? nestedError : undefined,
  };
}

export async function cancelElementBoardProviderTask(input: {
  provider: ApiProvider;
  modelId: string;
  remoteTaskId: string;
}): Promise<void> {
  const template = input.provider.advancedParams?.cancelPathTemplate?.trim();
  if (!template) {
    throw new Error('The selected element board provider does not support explicit task cancellation');
  }
  const path = template.replace('{taskId}', encodeURIComponent(input.remoteTaskId));
  const response = /^https?:\/\//i.test(path)
    ? await fetch(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.provider.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    })
    : await fetchWithV1Retry(input.provider.baseUrl, path.startsWith('/') ? path : `/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.provider.apiKey}` },
    }, false, 30_000);
  await readJson(response, 'Element board cancellation failed');
}
