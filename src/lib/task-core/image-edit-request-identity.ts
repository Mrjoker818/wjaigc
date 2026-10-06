import { createHash } from 'node:crypto';

// Keep this explicit list aligned with route.ts EditRequest. Never capture credentials
// or client-supplied audit/prepaid fields, and never rewrite the execution input.
const REQUEST_FIELDS = [
  'projectId', 'sessionId', 'messageId', 'assetParentVersionIds', 'assetSourcePlacementId',
  'assetProjectionMode', 'assetSelectedEntityIds',
  'action', 'imageUrl', 'maskImage', 'prompt', 'editMode', 'expandRatio', 'expandScale',
  'expandPadding', 'targetWidth', 'targetHeight', 'targetPreset', 'aspectRatio',
  'angleMode', 'rotation', 'tilt', 'zoom', 'originalWidth', 'originalHeight', 'scale',
  'model', 'providerId', 'eraseModel', 'removeBgModel', 'originalPrompt', 'upscaleMode',
  'upscaleModel', 'outputFormat', 'compression', 'engine', 'displayBackground',
  'enableQualityEnhance', 'enhanceModel', 'enhanceProviderId',
].sort();
const PADDING_FIELDS = ['bottom', 'left', 'right', 'top'];

function copyFrozen(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(copyFrozen));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.keys(value).sort().map((key: string): [string, unknown] =>
      [key, copyFrozen((value as Record<string, unknown>)[key])])));
  }
  return value;
}

export function captureImageEditRequestIdentity(body: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const entries: Array<[string, unknown]> = [];
  for (const key of REQUEST_FIELDS) {
    if (!Object.hasOwn(body, key)) continue;
    let value = body[key];
    if (key === 'expandPadding' && value && typeof value === 'object' && !Array.isArray(value)) {
      const padding = value as Record<string, unknown>;
      value = Object.fromEntries(PADDING_FIELDS.filter((side: string): boolean => Object.hasOwn(padding, side))
        .map((side: string): [string, unknown] => [side, padding[side]]));
    }
    entries.push([key, copyFrozen(value)]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

/** Stable user request identity; unlike the execution digest it does not depend on today's provider catalog. */
export function digestImageEditInputIdentity(actorUserId: string,
  request: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify({ version: 1, actorUserId, request })).digest('hex');
}

export function digestRequested302UpscaleIdentity(input: {
  actorUserId: string;
  request: Readonly<Record<string, unknown>>;
  providerId: string;
  modelId: string;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
}): string {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    entry: '/api/image-edit/302',
    actorUserId: input.actorUserId,
    request: copyFrozen(input.request),
    providerId: input.providerId,
    modelId: input.modelId,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    targetWidth: input.targetWidth,
    targetHeight: input.targetHeight,
  })).digest('hex');
}
