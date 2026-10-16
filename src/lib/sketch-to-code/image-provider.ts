import 'server-only';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { SketchModelBinding } from './generation';
import type { SketchImageReceipt } from './image-generation';
import type { buildSketchImageGenerationBody } from './image-contract';
import { createOrdinaryProvider, queryOrdinaryGeneration, type OrdinaryQueryResult } from '@/lib/task-core/ordinary-generation-provider';
import { createHash } from 'node:crypto';
import { inferModelConfig } from '@/lib/task-core/ordinary-generation-request';
import { buildPollUrl, parseGeminiChatImageResponse, parseResponseForProfile, resolveProfileForModel, type ApiCompatProfile } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { sketchFields, sketchHttpId } from './http';
import { markSketchImageKnownFailure } from './image-known-failure';
import { createSketchRuntimeObserver, type SketchRuntimeObserver } from './runtime-observation';

type Body = Readonly<ReturnType<typeof buildSketchImageGenerationBody>>;
type Code = 'SKETCH_IMAGE_PROVIDER_UNAVAILABLE' | 'SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH'
  | 'SKETCH_IMAGE_PROVIDER_INPUT_INVALID' | 'SKETCH_IMAGE_PROVIDER_EXTRA_REQUEST'
  | 'SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED' | 'SKETCH_IMAGE_PROVIDER_TRANSPORT_FAILED'
  | 'SKETCH_IMAGE_PROVIDER_REJECTED' | 'SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID' | 'SKETCH_IMAGE_PROVIDER_RESPONSE_LIMIT';
interface Runtime { providerId: string; modelId: string; requestId: string; apiKey: string; baseUrl: string }
const LIMIT = 32 * 1024 * 1024;
const ADAPTER_IMAGE_URL = 'https://sketch-receipt.invalid/image';
const ADAPTER_TASK_ID = 'sketch-receipt-draft';
const REJECTION_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422]);
interface ConfirmedQueryFailure { readonly providerId: string; readonly modelId: string; readonly remoteId: string }
const confirmedQueryFailures = new WeakMap<object, Readonly<ConfirmedQueryFailure>>();
/** Only the original validated result object carries provenance; public fields and copies do not. */
export function readConfirmedSketchImageQueryFailure(result: unknown): Readonly<ConfirmedQueryFailure> | undefined {
  return result !== null && typeof result === 'object' ? confirmedQueryFailures.get(result) : undefined;
}

export function getSketchImageRoutingFingerprint(input: { provider: ApiProvider; modelId: string }): string {
  const { runtime, route, profile } = freezeRouting({ ...input, requestId: 'routing-fingerprint' });
  const material = { providerId: runtime.providerId, modelId: runtime.modelId, baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey, route, profile };
  const canonical = JSON.stringify(material, (_key: string, value: unknown): unknown => record(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return createHash('sha256').update(canonical).digest('hex');
}
export function createSketchImageQueryStage(input: { provider: ApiProvider; modelId: string; requestId: string },
  dependencies: { transport?: typeof fetch } = {}): (
    remoteId: string, binding: SketchModelBinding, signal: AbortSignal,
  ) => Promise<Readonly<OrdinaryQueryResult>> {
  const { runtime, profile } = freezeRouting(input);
  const transport = dependencies.transport || globalThis.fetch;
  const observe = createSketchRuntimeObserver(runtime, [runtime.apiKey]);
  let firstQuery = true, observedStatus: string | undefined;
  return async (remoteId, binding, signal): Promise<Readonly<OrdinaryQueryResult>> => {
    signal.throwIfAborted(); checkBinding(binding, runtime);
    try { remoteTaskId(remoteId); }
    catch { throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_INPUT_INVALID', runtime); }
    const expectedUrl = buildPollUrl(runtime.baseUrl, encodeURIComponent(remoteId), profile)
      || `${runtime.baseUrl}/tasks/${encodeURIComponent(remoteId)}?language=zh`;
    let confirmedFailure = false;
    const queryObserver = firstQuery ? observe : undefined; firstQuery = false;
    const guarded = controlledTransport(runtime, profile, transport, signal, { method: 'GET', expectedUrl, remoteId,
      observe: queryObserver,
      onQueryFailure: (): void => { confirmedFailure = true; } });
    try {
      const result = await queryOrdinaryGeneration({ baseUrl: runtime.baseUrl, profile, remoteId, apiKey: runtime.apiKey,
        transport: guarded, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
      signal.throwIfAborted();
      if (result.status === 'completed') receipt({ taskIds: [], directImageUrls: result.imageUrls,
        usedModel: runtime.modelId, usedProviderId: runtime.providerId }, runtime);
      const imageUrls = [...result.imageUrls]; Object.freeze(imageUrls);
      const outward = Object.freeze({ status: result.status, imageUrls });
      if (result.status !== observedStatus) {
        observe({ event: 'query-result', phase: 'image-query', remoteTaskId: remoteId, status: result.status });
        observedStatus = result.status;
      }
      if (confirmedFailure && result.status === 'failed') confirmedQueryFailures.set(outward,
        Object.freeze({ providerId: runtime.providerId, modelId: runtime.modelId, remoteId }));
      return outward;
    } catch (error) {
      signal.throwIfAborted(); if (error instanceof ImageProviderError) throw error;
      throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID', runtime);
    }
  };
}

function freezeRouting(input: { provider: ApiProvider; modelId: string; requestId: string }): {
  runtime: Readonly<Runtime>; profile: Readonly<ApiCompatProfile>;
  route: Readonly<{ baseUrl: string; requestStyle?: string; advancedParams: Readonly<Record<string, string>> }>;
} {
  const { provider, modelId, requestId } = input;
  const route = Object.freeze({ baseUrl: provider.baseUrl, requestStyle: provider.requestStyle,
    advancedParams: Object.freeze({ ...provider.advancedParams }) });
  const runtime: Runtime = Object.freeze({ providerId: provider.id, modelId, requestId, apiKey: provider.apiKey,
    baseUrl: provider.baseUrl.replace(/\/+$/, '') });
  try {
    const url = new URL(runtime.baseUrl);
    sketchHttpId(runtime.providerId); sketchHttpId(modelId);
    if (!provider.isEnabled || !provider.apiKey || /\p{Cc}/u.test(provider.apiKey)
      || !['image', 'imageEdit', 'universal', 'general'].includes(provider.modelType || provider.type)
      || !(provider.selectedModels || [provider.selectedModel]).includes(modelId)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)
      || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { throw new Error('SKETCH_IMAGE_PROVIDER_UNAVAILABLE'); }
  return Object.freeze({ runtime, route, profile: Object.freeze({ ...resolveProfileForModel(modelId, route) }) });
}
function checkBinding(binding: SketchModelBinding, runtime: Runtime): void {
  let selected: Record<string, unknown>;
  try { selected = sketchFields(binding, ['providerId', 'modelId']); }
  catch { throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH', runtime); }
  if (selected.providerId !== runtime.providerId || selected.modelId !== runtime.modelId) {
    throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH', runtime);
  }
}

class ImageProviderError extends Error {
  readonly providerId: string; readonly modelId: string; readonly requestId: string;
  constructor(readonly code: Code, runtime: Runtime, readonly providerStatus?: number) {
    super(code); this.name = 'SketchImageProviderError';
    const safe = (text: string): string => text.split(runtime.apiKey).join('[REDACTED]');
    this.providerId = safe(runtime.providerId); this.modelId = safe(runtime.modelId); this.requestId = safe(runtime.requestId);
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function remoteTaskId(value: unknown): string {
  const id = sketchHttpId(value);
  if (id === '.' || id === '..') throw new Error();
  return id;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) throw new Error();
  return Array.from({ length: value.length }, (_, index): string => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property) || typeof property.value !== 'string') throw new Error();
    return property.value;
  });
}
function snapshotBody(value: Body, runtime: Runtime): Body {
  const raw = sketchFields(value, ['projectId', 'model', 'providerId', 'prompt', 'negativePrompt', 'referenceImages',
    'imageUrl', 'referenceDescriptions', 'aspectRatio', 'size', 'quality', 'outputCount', 'submitOnly']);
  if (raw.model !== runtime.modelId || raw.providerId !== runtime.providerId) {
    throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH', runtime);
  }
  const images = strings(raw.referenceImages), descriptions = strings(raw.referenceDescriptions);
  if (raw.outputCount !== 1 || raw.submitOnly !== true || images.length !== 1 || descriptions.length !== 1
    || images[0] !== raw.imageUrl || typeof raw.prompt !== 'string' || !raw.prompt.trim()
    || typeof raw.negativePrompt !== 'string' || typeof raw.aspectRatio !== 'string'
    || !/^[1-9]\d{0,3}:[1-9]\d{0,3}$/.test(raw.aspectRatio)) throw new Error();
  // Admission owns decoding; this boundary additionally forbids remote references and alias changes.
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(images[0]);
  if (!match || match[1].length > Math.ceil(4 * 1024 * 1024 / 3) * 4) throw new Error();
  const png = Buffer.from(match[1], 'base64');
  if (png.length > 4 * 1024 * 1024 || png.toString('base64') !== match[1]
    || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error();
  for (const text of [raw.prompt, raw.negativePrompt, ...descriptions]) {
    if (text.length > 128 * 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) throw new Error();
  }
  sketchHttpId(raw.projectId);
  if (raw.size !== undefined) sketchHttpId(raw.size);
  if (raw.quality !== undefined) sketchHttpId(raw.quality);
  return Object.freeze({ ...raw, referenceImages: Object.freeze(images), referenceDescriptions: Object.freeze(descriptions) }) as unknown as Body;
}

/** Small normalization of duplicate aliases emitted by the existing Gemini builder, not a new protocol. */
function guardPayload(payload: Record<string, unknown>, body: Body, profile: ApiCompatProfile, prompt: string,
  runtime: Runtime): Record<string, unknown> {
  const fail = (): never => { throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED', runtime); };
  if (payload.model !== runtime.modelId || payload.idempotency_key !== runtime.requestId) fail();
  if (profile.id === 'gemini-image') {
    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length !== 1 || !record(messages[0]) || !Array.isArray(messages[0].content)) return fail();
    const content = messages[0].content as unknown[];
    const texts = content.filter(record).filter(part => part.type === 'text');
    const images = content.filter(record).filter(part => part.type === 'image_url');
    if (texts.length !== 1 || typeof texts[0].text !== 'string' || !texts[0].text.includes(prompt)
      || !images.length || images.some(part => !record(part.image_url) || part.image_url.url !== body.imageUrl)
      || content.length !== texts.length + images.length || !record(payload.generationConfig)
      || body.size !== undefined && payload.generationConfig.image_size !== body.size) return fail();
    messages[0].content = [texts[0], images[0]];
  } else {
    if (payload.n !== 1 || typeof payload.prompt !== 'string' || !payload.prompt.includes(prompt)
      || body.quality !== undefined && payload.quality !== body.quality) fail();
    if (profile.sizeFormat === 'aspect-ratio') {
      if (payload.size !== body.aspectRatio) fail();
      if (profile.id === 'apimart' && profile.resolutionTierMode === 'native') {
        // Native tiers are not pixel hints. APImart deliberately strips derived
        // width/height/size_px; require the frozen tier in its actual wire field.
        if (body.size !== undefined && !/^[124]K$/.test(body.size)
          || payload.resolution !== body.size
          || ['width', 'height', 'size_px'].some(key => Object.hasOwn(payload, key))) fail();
      } else if (body.size !== undefined && payload.size_px !== body.size) fail();
    } else if (body.size !== undefined && payload.size !== body.size) fail();
    const references: string[] = [];
    if (typeof payload.image === 'string') references.push(payload.image);
    if (Array.isArray(payload.image_urls)) references.push(...strings(payload.image_urls));
    if (Array.isArray(payload.images)) {
      for (const item of payload.images as unknown[]) {
        if (typeof item === 'string') references.push(item);
        else if (record(item) && record(item.image_url) && typeof item.image_url.url === 'string') references.push(item.image_url.url);
        else fail();
      }
    }
    if (!references.length || references.some(reference => reference !== body.imageUrl)) fail();
  }
  return payload;
}

async function boundedText(response: Response, signal: AbortSignal, limitError: ImageProviderError): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > LIMIT)) {
    void response.body?.cancel(limitError).catch(() => undefined); throw limitError;
  }
  if (!response.body) return '';
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const cancel = (): void => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > LIMIT) { void reader.cancel(limitError).catch(() => undefined); throw limitError; }
      chunks.push(chunk.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
function validateNativeModel(value: unknown, runtime: Runtime, status: number): void {
  if (Array.isArray(value)) { value.forEach(child => validateNativeModel(child, runtime, status)); return; }
  if (!record(value)) return;
  if (Object.hasOwn(value, 'model') && value.model !== runtime.modelId) {
    throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH', runtime, status);
  }
  Object.values(value).forEach(child => validateNativeModel(child, runtime, status));
}
/** Reject candidates the legacy parser would hide through first-result preferences. */
function validateNativeResults(value: Record<string, unknown>, profile: ApiCompatProfile, runtime: Runtime, status: number,
  querying = false): void {
  const invalid = (): never => { throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID', runtime, status); };
  let images = 0, tasks = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!record(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (['url', 'b64_json', 'image_url'].includes(key) && typeof child === 'string' && child) images++;
      if (key === 'url' && Array.isArray(child)) images += child.length;
      if (key === 'images' && Array.isArray(child)) images += child.filter(item => typeof item === 'string').length;
      if (key === 'task_id' && typeof child === 'string' && child) tasks++;
      if (key === 'inline_data' && record(child) && typeof child.data === 'string' && child.data) images++;
      visit(child);
    }
    if (node.type === 'image') {
      if (typeof node.data === 'string' && node.data) images++;
      if (record(node.source) && typeof node.source.data === 'string' && node.source.data) images++;
    }
  };
  if (profile.id === 'gemini-image') {
    if (!Array.isArray(value.choices) || value.choices.length !== 1 || !record(value.choices[0])
      || !record(value.choices[0].message) || !Array.isArray(value.choices[0].message.content)) invalid();
  }
  visit(value);
  if (images > 1 || !querying && images + tasks > 1) invalid();
}
function receipt(value: SketchImageReceipt, runtime: Runtime): Readonly<SketchImageReceipt> {
  const tasks = strings(value.taskIds), urls = strings(value.directImageUrls);
  if (value.usedModel !== runtime.modelId || value.usedProviderId !== runtime.providerId || tasks.length + urls.length !== 1) throw new Error();
  tasks.forEach(remoteTaskId);
  for (const url of urls) {
    if (/\p{Cc}/u.test(url)) throw new Error();
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) continue;
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
  }
  return Object.freeze({ taskIds: Object.freeze(tasks), directImageUrls: Object.freeze(urls),
    usedModel: runtime.modelId, usedProviderId: runtime.providerId });
}

interface TransportScope {
  method: 'POST' | 'GET'; expectedUrl: string; body?: Body; prompt?: string; remoteId?: string;
  onReceipt?: (value: Readonly<SketchImageReceipt>) => void;
  onDispatch?: () => void; onQueryFailure?: () => void;
  observe?: SketchRuntimeObserver;
}
/** A failed parser result alone is insufficient: require the original task alias
 * and no competing task envelope or media behind the parser's first preference. */
function confirmedNativeFailure(native: Record<string, unknown>, info: Record<string, unknown>, remoteId: string): boolean {
  if (!['failed', 'cancelled'].includes(info.status as string)
    || Object.hasOwn(native, 'data') && !record(native.data)
    || ![info.task_id, info.id, native.task_id, ...(info === native ? [native.id] : [])].includes(remoteId)) return false;
  let consistent = true;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!record(node)) return;
    if (Object.hasOwn(node, 'status') && (node !== native && node !== info || node.status !== info.status)
      || Object.hasOwn(node, 'task_id') && (node !== native && node !== info || node.task_id !== remoteId)
      || Object.hasOwn(node, 'status') && Object.hasOwn(node, 'id') && node.id !== remoteId
      // output.id is an original adapter task alias even without its own status.
      // Keep only the existing top-level response-metadata id exception.
      || record(node.output) && Object.hasOwn(node.output, 'id')
      || node.type === 'image') consistent = false;
    for (const [key, child] of Object.entries(node)) {
      if (['url', 'b64_json', 'image_url', 'images', 'inline_data'].includes(key) && child !== null && child !== undefined) consistent = false;
      visit(child);
    }
  };
  visit(native); return consistent;
}
/** Shared submit/query boundary. Each invocation has exactly one network allowance. */
function controlledTransport(runtime: Runtime, profile: ApiCompatProfile, transport: typeof fetch, signal: AbortSignal,
  scope: TransportScope): typeof fetch {
  let attempts = 0;
  return async (url, options): Promise<Response> => {
    signal.throwIfAborted();
    if (attempts++) throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_EXTRA_REQUEST', runtime);
    if (typeof url !== 'string' || url !== scope.expectedUrl || (options?.method || 'GET') !== scope.method) {
      throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED', runtime);
    }
    if (scope.method === 'GET' && new URL(url).pathname !== /^https?:\/\/[^/]+([^?#]*)/.exec(url)?.[1]) {
      throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED', runtime);
    }
    const headers = new Headers(options?.headers);
    if (headers.get('authorization') !== `Bearer ${runtime.apiKey}`
      || scope.method === 'POST' && headers.get('idempotency-key') !== runtime.requestId) {
      throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH', runtime);
    }
    let outgoing: RequestInit['body'];
    if (scope.method === 'POST') {
      try {
        if (typeof options?.body !== 'string' || !scope.body || !scope.prompt) throw new Error();
        const parsed: unknown = JSON.parse(options.body); if (!record(parsed)) throw new Error();
        outgoing = JSON.stringify(guardPayload(parsed, scope.body, profile, scope.prompt, runtime));
      } catch (error) {
        if (error instanceof ImageProviderError) throw error;
        throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED', runtime);
      }
    } else if (options?.body !== undefined && options.body !== null) {
      throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED', runtime);
    }
    const actual = options?.signal ? AbortSignal.any([signal, options.signal]) : signal;
    actual.throwIfAborted(); headers.set('X-Request-Id', runtime.requestId);
    let response: Response;
    scope.onDispatch?.();
    const started = Date.now(), phase = scope.method === 'GET' ? 'image-query' : 'image-submit';
    scope.observe?.({ event: 'request-start', phase, elapsedMs: 0 });
    try { response = await transport(url, { ...options, headers, body: outgoing, signal: actual, redirect: 'error' }); }
    catch {
      scope.observe?.({ event: 'attempt-error', phase, aborted: actual.aborted, elapsedMs: Date.now() - started });
      signal.throwIfAborted(); throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_TRANSPORT_FAILED', runtime);
    }
    if (actual.aborted) { void response.body?.cancel(actual.reason).catch(() => undefined); signal.throwIfAborted(); actual.throwIfAborted(); }
    const invalid = (): ImageProviderError => new ImageProviderError('SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID', runtime, response.status);
    const responseId = response.headers.get('x-request-id') || response.headers.get('request-id') || undefined;
    scope.observe?.({ event: 'response-headers', phase, httpStatus: response.status, responseId, elapsedMs: Date.now() - started });
    let text: string;
    try { text = await boundedText(response, actual, new ImageProviderError('SKETCH_IMAGE_PROVIDER_RESPONSE_LIMIT', runtime, response.status)); }
    catch (error) {
      scope.observe?.({ event: 'attempt-error', phase, httpStatus: response.status, aborted: actual.aborted, elapsedMs: Date.now() - started });
      signal.throwIfAborted(); if (error instanceof ImageProviderError) throw error; throw invalid();
    }
    signal.throwIfAborted();
    scope.observe?.({ event: 'body-complete', phase, httpStatus: response.status, responseId, elapsedMs: Date.now() - started });
    if (!response.ok) {
      if (scope.method === 'GET') return new Response(null, { status: response.status });
      const error = new ImageProviderError('SKETCH_IMAGE_PROVIDER_REJECTED', runtime, response.status);
      if (!response.redirected && REJECTION_STATUSES.has(response.status)) markSketchImageKnownFailure(error,
        { phase: 'generation', providerId: runtime.providerId, modelId: runtime.modelId, kind: 'rejected' });
      throw error;
    }
    if (response.redirected || !/^(application\/json|text\/json)(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw invalid();
    try {
      const native: unknown = JSON.parse(text); if (!record(native)) throw new Error();
      validateNativeModel(native, runtime, response.status);
      validateNativeResults(native, profile, runtime, response.status, scope.method === 'GET');
      if (scope.method === 'POST') {
        const parsed = profile.id === 'gemini-image'
          ? { taskIds: [], directImageUrls: parseGeminiChatImageResponse(native) }
          : parseResponseForProfile(native, profile);
        const draft = receipt({ ...parsed, usedModel: runtime.modelId, usedProviderId: runtime.providerId }, runtime);
        if (!scope.onReceipt) throw invalid();
        scope.onReceipt(draft);
        // The old adapter logs its complete parsed response. Give it only an opaque
        // single-result view; native URLs/bytes/IDs and unknown fields stay private.
        const view = profile.id === 'gemini-image'
          ? { choices: [{ message: { content: [{ type: 'image_url', image_url: { url: ADAPTER_IMAGE_URL } }] } }] }
          : { data: [draft.directImageUrls.length ? { url: ADAPTER_IMAGE_URL } : { task_id: ADAPTER_TASK_ID }] };
        return new Response(JSON.stringify(view), { status: response.status, headers: { 'content-type': 'application/json' } });
      }
      if (scope.method === 'GET') {
        const info = record(native.data) ? native.data : native;
        if (typeof info.status !== 'string' || !['queued', 'pending', 'processing', 'running', 'completed', 'succeeded', 'success', 'failed', 'cancelled'].includes(info.status)) throw invalid();
        if (['completed', 'succeeded', 'success'].includes(info.status)) {
          // The original query treats a claimed completion without media as pending.
          // Reject that malformed claim here, keeping completion authority unambiguous.
          const parsed = parseResponseForProfile({ data: info }, profile);
          receipt({ taskIds: [], directImageUrls: parsed.directImageUrls, usedModel: runtime.modelId,
            usedProviderId: runtime.providerId }, runtime);
        }
        for (const envelope of info === native ? [native] : [native, info]) {
          for (const key of ['task_id', 'id']) {
            // A wrapper id without task status is response metadata, not a task alias.
            if (key === 'id' && envelope === native && info !== native && !Object.hasOwn(native, 'status')) continue;
            if (Object.hasOwn(envelope, key) && envelope[key] !== scope.remoteId) {
              throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH', runtime, response.status);
            }
          }
        }
        if (scope.remoteId && confirmedNativeFailure(native, info, scope.remoteId)) scope.onQueryFailure?.();
      }
    } catch (error) { if (error instanceof ImageProviderError) throw error; throw invalid(); }
    // Queries have no raw-response logger; retain their original validated native envelope.
    return new Response(text, { status: response.status, headers: { 'content-type': 'application/json' } });
  };
}

export function createSketchImageGenerationStage(input: {
  provider: ApiProvider; modelId: string; requestId: string;
}, dependencies: { transport?: typeof fetch } = {}): (
  body: Readonly<ReturnType<typeof buildSketchImageGenerationBody>>, binding: SketchModelBinding, signal: AbortSignal,
) => Promise<Readonly<SketchImageReceipt>> {
  const { runtime, route, profile } = freezeRouting(input);
  const modelConfig = inferModelConfig(runtime.modelId, profile);
  const transport = dependencies.transport || globalThis.fetch;
  const observe = createSketchRuntimeObserver(runtime, [runtime.apiKey]);
  let claimed = false;
  return async (suppliedBody, binding, signal): Promise<Readonly<SketchImageReceipt>> => {
    signal.throwIfAborted();
    let body: Body;
    try {
      checkBinding(binding, runtime);
      body = snapshotBody(suppliedBody, runtime);
    } catch (error) {
      if (error instanceof ImageProviderError) throw error;
      throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_INPUT_INVALID', runtime);
    }
    if (claimed) throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_EXTRA_REQUEST', runtime);
    claimed = true;
    const prompt = `${body.prompt}\n[negative: ${body.negativePrompt}]\n[Image settings: aspectRatio=${body.aspectRatio}${body.size === undefined ? '' : `, size=${body.size}`}${body.quality === undefined ? '' : `, quality=${body.quality}`}]`;
    let nativeReceipt: Readonly<SketchImageReceipt> | undefined;
    let dispatched = false;
    const guarded = controlledTransport(runtime, profile, transport, signal, { method: 'POST', body, prompt,
      observe,
      onDispatch: (): void => { dispatched = true; },
      onReceipt: (value: Readonly<SketchImageReceipt>): void => { nativeReceipt = value; },
      expectedUrl: runtime.baseUrl + (profile.id === 'gemini-image' ? '/chat/completions' : profile.editEndpoint) });
    const providerFetch: typeof fetchWithV1Retry = (base, path, options = {}): Promise<Response> => {
      signal.throwIfAborted();
      if (base.replace(/\/+$/, '') !== runtime.baseUrl || options.skipV1Retry !== true) {
        throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED', runtime);
      }
      return fetchWithV1Retry(base, path, { ...options, skipV1Retry: true, transport: guarded, propagateErrors: true }, false);
    };
    const nativeResolution = profile.id === 'apimart' && profile.resolutionTierMode === 'native';
    const submit = createOrdinaryProvider({ requestedSize: body.aspectRatio,
      normalizedRequestedPixelSize: nativeResolution ? undefined : body.size,
      resolutionTier: nativeResolution ? body.size : undefined,
      quality: body.quality, enhancedPrompt: prompt, agentProviderIdempotencyKey: runtime.requestId,
      accessibleReferenceImages: [body.imageUrl], aspectRatio: body.aspectRatio, referenceMode: 'reference',
      strictAgentRouting: true, controlled: true, profile, transport: guarded, providerFetch,
      // Any accidental asset side effect is denied; Responses (which can fall back) is not enabled here.
      responsesApiEnabled: false, downloadAndSaveImage: async (): Promise<never> => { throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED', runtime); },
      isPrivateIp: (): boolean => true });
    try {
      const result = await submit(modelConfig, runtime.apiKey, runtime.baseUrl, runtime.providerId, 1, route);
      signal.throwIfAborted(); const adapterReceipt = receipt(result, runtime);
      if (!nativeReceipt || adapterReceipt.taskIds.length !== nativeReceipt.taskIds.length
        || adapterReceipt.directImageUrls.length !== nativeReceipt.directImageUrls.length
        || adapterReceipt.taskIds.some(id => id !== ADAPTER_TASK_ID)
        || adapterReceipt.directImageUrls.some(url => url !== ADAPTER_IMAGE_URL)) throw new Error();
      return nativeReceipt;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ImageProviderError) {
        if (!dispatched && !nativeReceipt && error.code === 'SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED') {
          markSketchImageKnownFailure(error, { phase: 'generation', providerId: runtime.providerId, modelId: runtime.modelId, kind: 'not-submitted' });
        }
        throw error;
      }
      throw new ImageProviderError('SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID', runtime);
    }
  };
}
