import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { authorizeGenerationProject, type GenerationProjectAccess } from '@/lib/collaboration/generation-project-access';
import { resolveTaskModel } from '@/lib/task-core/model-catalog';
import { findProviderById } from '@/lib/server-api-config';
import { CAPABILITY_FIELDS, type TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { OrdinaryQueryResult } from '@/lib/task-core/ordinary-generation-provider';
import type { SketchImageGenerationDependencies, SketchImagePreparation } from './image-generation';
import type { SketchImageRouting } from './image-execution';
import type { SketchImageTaskIdentity } from './image-task-state';
import { freezeSketchImageInput, parseStoredSketchImageInput, supportsSketchImageOutput, type SketchImageInput } from './image-contract';
import { createSketchImageAnalysisStage, SketchProviderError } from './provider';
import { createSketchImageGenerationStage, createSketchImageQueryStage, getSketchImageRoutingFingerprint, readConfirmedSketchImageQueryFailure } from './image-provider';
import { markSketchImageKnownFailure } from './image-known-failure';
import { sketchFields, sketchHttpId } from './http';
import { runSketchStage } from './stage';

export interface ConfiguredSketchImagePorts {
  authorizeProject?: typeof authorizeGenerationProject;
  resolveTaskModel?: (providerId: string, modelId: string, actorUserId: string) => Promise<TaskModelDescriptor>;
  findProviderById?: (providerId: string) => Promise<ApiProvider | null>;
  transport?: typeof fetch;
  requestId?: string;
}
export interface ConfiguredSketchImageDependencies {
  readonly generation: SketchImageGenerationDependencies;
  routing(): Readonly<SketchImageRouting>;
  checkCurrent(identity: Readonly<SketchImageTaskIdentity>, signal: AbortSignal): Promise<Readonly<SketchImageRouting>>;
  query(remoteId: string, identity: Readonly<SketchImageTaskIdentity>, signal: AbortSignal): Promise<Readonly<OrdinaryQueryResult>>;
}

type Role = 'vision' | 'image';
type Access = SketchImagePreparation['access'];
interface BoundRole { readonly model: TaskModelDescriptor; readonly provider: ApiProvider }
interface CurrentIdentity {
  readonly taskId: string; readonly actorUserId: string; readonly projectId: string; readonly requestDigest: string;
  readonly input: Readonly<SketchImageInput>; readonly access: Access;
}
const unavailable = (): Error => new Error('SKETCH_IMAGE_CONFIGURATION_UNAVAILABLE');
const alreadyBound = (): Error => new Error('SKETCH_IMAGE_DEPENDENCIES_ALREADY_BOUND');
const REJECTION_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422]);

/** Only copied data descriptors enter factory snapshots or hash material. */
function snapshot<T>(value: T, depth = 0, budget = { remaining: 8192 }): T {
  if (depth > 16 || --budget.remaining < 0) throw unavailable();
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) throw unavailable();
    return Object.freeze(Array.from({ length: value.length }, (_, index): unknown => {
      const property = Object.getOwnPropertyDescriptor(value, String(index));
      if (!property || !('value' in property)) throw unavailable();
      return snapshot(property.value as unknown, depth + 1, budget);
    })) as T;
  }
  const raw = sketchFields(value);
  return Object.freeze(Object.fromEntries(Object.keys(raw).map(key => [key, snapshot(raw[key], depth + 1, budget)]))) as T;
}
async function readPort<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  try { const result = await operation(); signal?.throwIfAborted(); return result; }
  catch { signal?.throwIfAborted(); throw unavailable(); }
}
function readAccess(value: GenerationProjectAccess, actorUserId: string, projectId: string): Access {
  try {
    const raw = sketchFields(value, ['kind', 'actorUserId', 'ownerId', 'projectId', 'grantGeneration']);
    const ownerId = sketchHttpId(raw.ownerId);
    if (raw.actorUserId !== actorUserId || raw.projectId !== projectId) throw unavailable();
    if (raw.kind === 'personal' && ownerId === actorUserId && Object.keys(raw).length === 4) {
      return Object.freeze({ kind: 'personal', actorUserId, ownerId, projectId });
    }
    if (raw.kind === 'document' && Object.keys(raw).length === 5 && typeof raw.grantGeneration === 'string'
      && /^(0|[1-9]\d*)$/.test(raw.grantGeneration)) {
      return Object.freeze({ kind: 'document', actorUserId, ownerId, projectId, grantGeneration: sketchHttpId(raw.grantGeneration) });
    }
  } catch { throw unavailable(); }
  throw unavailable();
}
function readModel(value: TaskModelDescriptor, role: Role, providerId: string, modelId: string): TaskModelDescriptor {
  try {
    sketchFields(value, ['providerId', 'modelId', 'kind', 'sourceType', 'capabilitySources', ...CAPABILITY_FIELDS]);
    const model = snapshot(value);
    if (model.providerId !== providerId || model.modelId !== modelId
      || role === 'vision' && (model.kind !== 'chat' || model.supportsVision !== true || model.protocol !== 'chat-completions' || model.executionMode !== 'sync')
      || role === 'image' && (model.kind !== 'image' || model.supportsReferenceImages !== true || model.maxOutputs < 1
        || model.maxReferenceImages !== undefined && model.maxReferenceImages < 1 || !supportsSketchImageOutput(model.outputKinds)
        || model.supportedOperations !== undefined && !model.supportedOperations.includes('image-to-image'))) throw new Error();
    return model;
  } catch { throw new Error('SKETCH_IMAGE_MODEL_UNAVAILABLE'); }
}
function readProvider(value: ApiProvider | null, role: Role, providerId: string, modelId: string): ApiProvider {
  try {
    if (!value) throw unavailable();
    const provider = snapshot(value), url = new URL(provider.baseUrl);
    if (provider.id !== providerId || !provider.isEnabled || !provider.apiKey || /\p{Cc}/u.test(provider.apiKey)
      || !(provider.selectedModels || [provider.selectedModel]).includes(modelId)
      || role === 'vision' && !['chat', 'vlm', 'universal', 'general'].includes(provider.modelType || provider.type)
      || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw unavailable();
    return provider;
  } catch { throw unavailable(); }
}
function visionFingerprint(selected: BoundRole): string {
  // Conservative selected-provider config, never the image-only profile factory.
  const material = { modelId: selected.model.modelId, protocol: selected.model.protocol,
    executionMode: selected.model.executionMode, provider: selected.provider, endpoint: '/chat/completions' };
  const canonical = JSON.stringify(material, (_key: string, value: unknown): unknown => value !== null
    && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, (value as Record<string, unknown>)[key]])) : value);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Pure current-snapshot check. Uses the same role, frozen-input and routing contracts as the factory. */
export function getConfiguredSketchImageRouting(input: Readonly<SketchImageInput>,
  visionModel: TaskModelDescriptor, imageModel: TaskModelDescriptor,
  visionProvider: ApiProvider | null, imageProvider: ApiProvider | null): Readonly<SketchImageRouting> {
  const v = readModel(visionModel, 'vision', input.visionProviderId, input.visionModelId);
  const i = readModel(imageModel, 'image', input.imageProviderId, input.imageModelId);
  freezeSketchImageInput(input, v, i);
  const vp = readProvider(visionProvider, 'vision', v.providerId, v.modelId);
  const ip = readProvider(imageProvider, 'image', i.providerId, i.modelId);
  return Object.freeze({ vision: visionFingerprint({ model: v, provider: vp }),
    image: getSketchImageRoutingFingerprint({ provider: ip, modelId: i.modelId }) });
}

/** Per logical task only. This module binds factories, not a parent task, lock,
 * account, ledger, public route or permission to publish any result. */
export function createConfiguredSketchImageDependencies(deps: ConfiguredSketchImagePorts = {}): ConfiguredSketchImageDependencies {
  let configured: Record<string, unknown>;
  try {
    configured = sketchFields(deps, ['authorizeProject', 'resolveTaskModel', 'findProviderById', 'transport', 'requestId']);
    for (const key of ['authorizeProject', 'resolveTaskModel', 'findProviderById', 'transport']) {
      if (configured[key] !== undefined && typeof configured[key] !== 'function') throw unavailable();
    }
    if (configured.requestId !== undefined && typeof configured.requestId !== 'string') throw unavailable();
  } catch { throw unavailable(); }
  const authorize = (configured.authorizeProject as ConfiguredSketchImagePorts['authorizeProject']) || authorizeGenerationProject;
  const resolve = (configured.resolveTaskModel as ConfiguredSketchImagePorts['resolveTaskModel']) || resolveTaskModel;
  const find = (configured.findProviderById as ConfiguredSketchImagePorts['findProviderById']) || findProviderById;
  const transport = (configured.transport as typeof fetch | undefined) || globalThis.fetch;
  const requestId = configured.requestId === undefined ? randomUUID() : configured.requestId as string;
  let authorized: Access | undefined, authorizationStarted = false, roleCount = 0, resolving = false, failed = false, analysisUsed = false;
  let vision: BoundRole | undefined, image: BoundRole | undefined, currentIdentity: CurrentIdentity | undefined;
  let analyze: ReturnType<typeof createSketchImageAnalysisStage> | undefined;
  let generate: ReturnType<typeof createSketchImageGenerationStage> | undefined;
  let query: ReturnType<typeof createSketchImageQueryStage> | undefined;
  let route: Readonly<SketchImageRouting> | undefined;
  let analysisRequests = 0, analysisResponseStatus: number | undefined;
  const ready = (): Readonly<SketchImageRouting> => {
    if (!route || !vision || !image || !analyze || !generate || !query || failed) throw new Error('SKETCH_IMAGE_CONFIGURATION_NOT_READY');
    return route;
  };
  const captureIdentity = (value: Readonly<SketchImageTaskIdentity>): CurrentIdentity => {
    ready();
    try {
      const raw = sketchFields(value, ['taskId', 'actorUserId', 'projectId', 'requestDigest', 'input', 'access', 'pricing']);
      const taskId = sketchHttpId(raw.taskId), actorUserId = sketchHttpId(raw.actorUserId), projectId = sketchHttpId(raw.projectId);
      const input = parseStoredSketchImageInput(raw.input), access = readAccess(raw.access as GenerationProjectAccess, actorUserId, projectId);
      if (!authorized || !vision || !image || actorUserId !== authorized.actorUserId || projectId !== authorized.projectId
        || input.projectId !== projectId || !isDeepStrictEqual(access, authorized)
        || input.visionProviderId !== vision.model.providerId || input.visionModelId !== vision.model.modelId
        || input.imageProviderId !== image.model.providerId || input.imageModelId !== image.model.modelId
        || typeof raw.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.requestDigest)) throw new Error();
      const captured = Object.freeze({ taskId, actorUserId, projectId, requestDigest: raw.requestDigest, input, access });
      if (currentIdentity && !isDeepStrictEqual(currentIdentity, captured)) throw new Error();
      currentIdentity = captured; return captured;
    } catch { throw new Error('SKETCH_IMAGE_CONFIGURATION_IDENTITY_MISMATCH'); }
  };
  const check = async (identity: CurrentIdentity, parent: AbortSignal): Promise<Readonly<SketchImageRouting>> => runSketchStage(async signal => {
    const original = ready();
    const access = readAccess(await readPort(() => authorize({ actorUserId: identity.actorUserId, projectId: identity.projectId }), signal), identity.actorUserId, identity.projectId);
    if (!isDeepStrictEqual(access, identity.access)) throw new Error('SKETCH_IMAGE_CONFIGURATION_IDENTITY_MISMATCH');
    const v = readModel(await readPort(() => resolve(identity.input.visionProviderId, identity.input.visionModelId, identity.actorUserId), signal), 'vision', identity.input.visionProviderId, identity.input.visionModelId);
    const i = readModel(await readPort(() => resolve(identity.input.imageProviderId, identity.input.imageModelId, identity.actorUserId), signal), 'image', identity.input.imageProviderId, identity.input.imageModelId);
    freezeSketchImageInput(identity.input, v, i); signal.throwIfAborted();
    const vp = readProvider(await readPort(() => find(v.providerId), signal), 'vision', v.providerId, v.modelId);
    const ip = readProvider(await readPort(() => find(i.providerId), signal), 'image', i.providerId, i.modelId);
    let fresh: Readonly<SketchImageRouting>;
    try { fresh = { vision: visionFingerprint({ model: v, provider: vp }), image: getSketchImageRoutingFingerprint({ provider: ip, modelId: i.modelId }) }; }
    catch { signal.throwIfAborted(); throw unavailable(); }
    signal.throwIfAborted();
    if (!isDeepStrictEqual(fresh, original)) throw new Error('SKETCH_IMAGE_ROUTING_CHANGED');
    return original;
  }, parent);
  const generation: SketchImageGenerationDependencies = {
    authorizeProject: async (actorUserId, projectId): Promise<GenerationProjectAccess> => {
      if (authorizationStarted) throw alreadyBound(); authorizationStarted = true;
      try { sketchHttpId(actorUserId); sketchHttpId(projectId); } catch { throw unavailable(); }
      authorized = readAccess(await readPort(() => authorize({ actorUserId, projectId })), actorUserId, projectId); return authorized;
    },
    resolveTaskModel: async (providerId, modelId, actorUserId): Promise<TaskModelDescriptor> => {
      if (!authorized) throw new Error('SKETCH_IMAGE_CONFIGURATION_NOT_READY');
      if (resolving || failed || roleCount >= 2 || actorUserId !== authorized.actorUserId) throw alreadyBound();
      if (vision && providerId === vision.model.providerId && modelId === vision.model.modelId) throw alreadyBound();
      const role: Role = roleCount++ === 0 ? 'vision' : 'image'; resolving = true;
      try {
        try { sketchHttpId(providerId); sketchHttpId(modelId); } catch { throw unavailable(); }
        const model = readModel(await readPort(() => resolve(providerId, modelId, actorUserId)), role, providerId, modelId);
        const provider = readProvider(await readPort(() => find(providerId)), role, providerId, modelId);
        try {
          if (role === 'vision') {
            const observedTransport: typeof fetch = async (url, options): Promise<Response> => {
              const headers = new Headers(options?.headers);
              if (analysisRequests++ || url !== `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`
                || options?.method !== 'POST' || headers.get('authorization') !== `Bearer ${provider.apiKey}`
                || headers.get('x-request-id') !== `${requestId}:analysis`) throw unavailable();
              const response = await transport(url, options);
              if (response instanceof Response && !response.redirected) analysisResponseStatus = response.status;
              return response;
            };
            analyze = createSketchImageAnalysisStage({ provider, modelId, requestId }, { transport: observedTransport }); vision = Object.freeze({ model, provider });
          } else {
            generate = createSketchImageGenerationStage({ provider, modelId, requestId }, { transport });
            query = createSketchImageQueryStage({ provider, modelId, requestId }, { transport }); image = Object.freeze({ model, provider });
            if (!vision) throw unavailable();
            route = Object.freeze({ vision: visionFingerprint(vision), image: getSketchImageRoutingFingerprint({ provider, modelId }) });
          }
        } catch { throw unavailable(); }
        return model;
      } catch (error) { failed = true; throw error; }
      finally { resolving = false; }
    },
    analyze: async (png, instruction, binding, signal): Promise<unknown> => {
      signal.throwIfAborted(); ready(); if (analysisUsed) throw alreadyBound(); analysisUsed = true;
      return runSketchStage(async current => {
        try { return await analyze!(png, instruction, binding, current); }
        catch (error) {
          current.throwIfAborted();
          const outward = new Error('SKETCH_IMAGE_ANALYSIS_UNAVAILABLE');
          // The original A reader must have completed and produced this rejection;
          // a transport-thrown lookalike has no observed response to corroborate it.
          if (vision && analysisRequests === 1 && error instanceof SketchProviderError
            && error.code === 'SKETCH_PROVIDER_REJECTED' && error.phase === 'analysis'
            && error.providerId === vision.model.providerId && error.modelId === vision.model.modelId
            && error.providerStatus === analysisResponseStatus && analysisResponseStatus !== undefined
            && REJECTION_STATUSES.has(analysisResponseStatus)) markSketchImageKnownFailure(outward,
            { phase: 'analysis', providerId: vision.model.providerId, modelId: vision.model.modelId, kind: 'rejected' });
          throw outward;
        }
      }, signal);
    },
    generate: async (body, binding, signal): Promise<unknown> => {
      signal.throwIfAborted(); ready(); return runSketchStage(current => generate!(body, binding, current), signal, 120_000);
    },
  };
  return Object.freeze({ generation: Object.freeze(generation), routing: ready,
    checkCurrent: async (identity: Readonly<SketchImageTaskIdentity>, signal: AbortSignal): Promise<Readonly<SketchImageRouting>> => {
      signal.throwIfAborted(); return check(captureIdentity(identity), signal);
    },
    query: async (remoteId: string, identity: Readonly<SketchImageTaskIdentity>, signal: AbortSignal): Promise<Readonly<OrdinaryQueryResult>> => {
      signal.throwIfAborted(); const captured = captureIdentity(identity); await check(captured, signal); signal.throwIfAborted();
      return runSketchStage(async current => {
        const result = await query!(remoteId,
          Object.freeze({ providerId: captured.input.imageProviderId, modelId: captured.input.imageModelId }), current);
        current.throwIfAborted();
        const proof = readConfirmedSketchImageQueryFailure(result);
        if (result.status === 'failed' && proof?.providerId === captured.input.imageProviderId
          && proof.modelId === captured.input.imageModelId && proof.remoteId === remoteId) {
          throw markSketchImageKnownFailure(new Error('SKETCH_IMAGE_RESULT_UNAVAILABLE'),
            { phase: 'result', providerId: proof.providerId, modelId: proof.modelId, kind: 'remote-failed', remoteId: proof.remoteId });
        }
        return result;
      }, signal, 30_000);
    } });
}
