import 'server-only';
import { createHash } from 'node:crypto';
import { bufferImageEditProviderResponse, type ImageEditProviderIdentity } from '@/lib/image-edit-provider-boundary';
import { capturePhaseIdentity, capturePhaseOwner, capturePhaseResult, capturePhaseSpec, finishPhaseAttempt,
  openPhaseCheckpoint, samePhaseIdentity, startPhaseAttempt,
  type ImageEditPhaseOpenResult, type OpenImageEditProviderPhaseInput, type PhaseRejection } from './image-edit-provider-checkpoint';

function stopped(): never { throw new Error('Image edit submission-unknown or phase stopped'); }

function redact(text: string, secrets: readonly string[]): string {
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  return text;
}
function safeError(error: unknown, secrets: readonly string[]): Error {
  const message = redact(error instanceof Error ? error.message : 'Image edit phase failed', secrets);
  const name = redact(error instanceof Error ? error.name : 'Error', secrets);
  // Do not propagate provider cause/stack/custom fields: any of them can contain credentials or body data.
  const safe = new Error(message); safe.name = name;
  return safe;
}

function rejection(status: number, text: string, secrets: readonly string[]): PhaseRejection | undefined {
  const patterns: Record<number, RegExp> = {
    400: /\b(?:invalid (?:request|parameter|size)|unsupported (?:size|format|parameter)|required (?:field|parameter)|model not found|image editing unavailable|aspect ratio is not in the allowed)\b/i,
    422: /\b(?:invalid (?:request|parameter|size)|unsupported (?:size|format|parameter)|required (?:field|parameter)|model not found|image editing unavailable|aspect ratio is not in the allowed)\b/i,
    401: /\b(?:authentication|unauthorized|invalid api key)\b/i,
    403: /\b(?:forbidden|permission denied|not authorized)\b/i,
    429: /\b(?:rate limit|too many requests)\b/i,
  };
  if (![404, 405, 415].includes(status) && !patterns[status]?.test(text)) return undefined;
  // Store only the proof category, not arbitrary provider prose (which can echo request bodies or credentials).
  let message = patterns[status]?.exec(text)?.[0].toLowerCase() ?? 'endpoint or media type rejected';
  for (const secret of secrets) message = message.split(secret).join('[redacted]');
  return { status, code: 'HTTP_REJECTED', message: message.slice(0, 512) };
}

export async function openImageEditProviderPhase(input: OpenImageEditProviderPhaseInput): Promise<ImageEditPhaseOpenResult> {
  // Snapshot the whitelist before the first await. No caller-owned objects enter storage.
  const owner = capturePhaseOwner(input);
  const spec = capturePhaseSpec(input.phase);
  const transport = input.transport ?? fetch;
  const beforeDispatch = input.beforeDispatch;
  const transactionalSourceCheck = input.transactionalSourceCheck;
  const signal = input.signal;
  const secrets = Object.freeze([...(input.secretValues ?? [])]);
  if (typeof transport !== 'function' || typeof beforeDispatch !== 'function'
    || (transactionalSourceCheck !== undefined && typeof transactionalSourceCheck !== 'function')
    || secrets.some(secret => typeof secret !== 'string' || !secret)) throw new Error('Invalid image edit phase callbacks');
  if (signal?.aborted) throw safeError(signal.reason, secrets);
  const opened = await openPhaseCheckpoint(owner, spec).catch((error: unknown): never => { throw safeError(error, secrets); });
  if (opened.status !== 'ready') return opened;
  const session = opened.session;
  let busy = false;
  let active: { attemptId: string; identity: ImageEditProviderIdentity; signal: AbortSignal; returned: boolean } | undefined;
  return { status: 'ready', boundary: {
    async transport(input, init, suppliedIdentity, responseMaxBytes): Promise<Response> {
      if (busy || active) stopped();
      busy = true;
      try {
        if (responseMaxBytes !== undefined && (!Number.isSafeInteger(responseMaxBytes) || responseMaxBytes <= 0)) {
          throw new RangeError('Invalid provider response limit');
        }
        const identity = capturePhaseIdentity(suppliedIdentity);
        if (!spec.targets.some(target => samePhaseIdentity(target, identity))) stopped();
        // Serialize once. The exact Request whose clone is hashed is sent, retaining multipart boundary and headers.
        const request = new Request(input instanceof Request ? input.clone() : input, init);
        const signals = [request.signal];
        if (signal) signals.push(signal);
        if (input instanceof Request) signals.push(input.signal);
        const combined = AbortSignal.any(signals);
        combined.throwIfAborted();
        if (request.method !== 'POST') throw new Error('Image edit phase requires POST');
        const url = new URL(request.url);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid provider endpoint');
        url.username = ''; url.password = ''; url.search = ''; url.hash = '';
        const endpoint = url.toString();
        if (secrets.some(secret => endpoint.includes(secret))) throw new Error('Provider endpoint contains a secret');
        const bytes = await request.clone().arrayBuffer();
        const bodyDigest = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
        combined.throwIfAborted();
        await beforeDispatch();
        combined.throwIfAborted();
        const attemptId = await startPhaseAttempt(session, identity, endpoint, bodyDigest, transactionalSourceCheck);
        active = { attemptId, identity: suppliedIdentity, signal: combined, returned: false };
        combined.throwIfAborted();
        let response = await transport(request, { signal: combined, redirect: 'manual' });
        if (responseMaxBytes !== undefined) {
          response = await bufferImageEditProviderResponse(response, responseMaxBytes, combined);
        }
        combined.throwIfAborted();
        if (!response.ok) {
          const text = await response.clone().text();
          const proof = rejection(response.status, text, secrets);
          if (!proof) stopped();
          combined.throwIfAborted();
          await finishPhaseAttempt(session, attemptId, identity, { status: 'rejected', rejection: proof });
          active = undefined;
          const safeText = redact(text, secrets);
          return safeText === text ? response : new Response(safeText, {
            status: response.status, statusText: redact(response.statusText, secrets), headers: response.headers,
          });
        } else { active.returned = true; }
        return response;
      } catch (error) { throw safeError(error, secrets); } finally { busy = false; }
    },
    async onAccepted(identity, result): Promise<void> {
      // Reference identity binds the j4c callback to this request-local call; SQL binds the unique attempt across processes.
      if (busy || !active || !active.returned || active.identity !== identity) stopped();
      busy = true;
      // A failed callback is terminal for this instance. Its durable started fact remains unknown.
      active.returned = false;
      try {
        signal?.throwIfAborted(); active.signal.throwIfAborted();
        const accepted = capturePhaseResult(result, identity.kind);
        if (Object.values(accepted).some(value => typeof value === 'string' && secrets.some(secret => value.includes(secret)))) {
          throw new Error('Provider result contains a secret');
        }
        await finishPhaseAttempt(session, active.attemptId, capturePhaseIdentity(identity), { status: 'accepted', result: accepted });
        active = undefined;
      } catch (error) { throw safeError(error, secrets); } finally { busy = false; }
    },
  } };
}
