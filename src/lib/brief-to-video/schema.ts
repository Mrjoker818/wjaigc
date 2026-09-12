import { isAssetVersionId } from '@/lib/asset-core/asset-version-id';
import {
  BRIEF_TO_VIDEO_GOALS,
  BRIEF_TO_VIDEO_PLAN_SCHEMA_ID,
  BRIEF_TO_VIDEO_PLATFORMS,
  BRIEF_TO_VIDEO_RESULT_SCHEMA_ID,
  type BriefToVideoGoal,
  type BriefToVideoInput,
  type BriefToVideoPlanV1,
  type BriefToVideoPlatform,
  type BriefToVideoResultV1,
  type BriefToVideoSceneV1,
} from './types';

const DEFAULT_STYLE = '电影感、主体清晰、运动自然';
const INPUT_BYTE_LIMIT = 32 * 1024;
const PLAN_BYTE_LIMIT = 256 * 1024;
const RESULT_BYTE_LIMIT = 32 * 1024;
const MAX_SCENES = 64;
const MAX_CONSTRAINTS = 32;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const ASPECT_RATIO = /^[1-9]\d{0,3}:[1-9]\d{0,3}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

const INPUT_KEYS = new Set([
  'brief', 'goal', 'audience', 'platform', 'style', 'callToAction', 'durationSeconds',
  'aspectRatio', 'resolution', 'startFrame', 'endFrame', 'negativeConstraints',
  'generateAudio',
]);
const PLAN_KEYS = new Set([
  'schemaId', 'title', 'logline', 'durationSeconds', 'aspectRatio', 'scenes',
  'finalVideoPrompt', 'negativePrompt', 'factualConstraints',
]);
const SCENE_KEYS = new Set([
  'order', 'timeRange', 'visual', 'camera', 'action', 'textOverlay',
]);
const RESULT_KEYS = new Set([
  'schemaId', 'runId', 'planChecksum', 'videoAssetVersionId', 'sourceAssetVersionIds',
  'providerId', 'modelId', 'remoteTaskId', 'durationSeconds', 'aspectRatio',
  'resolution', 'thumbnailUrl',
]);

export class BriefToVideoSchemaError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BriefToVideoSchemaError';
  }
}

function fail(code: string): never {
  throw new BriefToVideoSchemaError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSize(value: unknown, maximum: number, code: string): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > maximum) fail(code);
  } catch (error) {
    if (error instanceof BriefToVideoSchemaError) throw error;
    fail(code);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
  code: string,
): void {
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.has(key))) fail(code);
}

function boundedString(value: unknown, maximum: number, code: string): string {
  if (typeof value !== 'string') fail(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || CONTROL_CHARACTER.test(normalized)) fail(code);
  return normalized;
}

function optionalString(value: unknown, maximum: number, code: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return boundedString(value, maximum, code);
}

function positiveInteger(value: unknown, maximum: number, code: string): number {
  const normalized = typeof value === 'string' && /^[1-9]\d*$/u.test(value)
    ? Number(value)
    : value;
  if (typeof normalized !== 'number' || !Number.isSafeInteger(normalized)
    || normalized < 1 || normalized > maximum) fail(code);
  return normalized;
}

function aspectRatio(value: unknown, code: string): string {
  const normalized = boundedString(value, 16, code);
  if (!ASPECT_RATIO.test(normalized)) fail(code);
  return normalized;
}

function identifier(value: unknown, code: string): string {
  const normalized = boundedString(value, 256, code);
  if (!SAFE_IDENTIFIER.test(normalized)) fail(code);
  return normalized;
}

function assetVersion(value: unknown, code: string): string {
  const normalized = boundedString(value, 256, code);
  if (!isAssetVersionId(normalized)) fail(code);
  return normalized;
}

function optionalAssetVersion(value: unknown, code: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return assetVersion(value, code);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], code: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(code);
  return value as T;
}

export function parseBriefToVideoInput(value: unknown): BriefToVideoInput {
  assertSize(value, INPUT_BYTE_LIMIT, 'BRIEF_VIDEO_INPUT_SIZE_INVALID');
  if (!isRecord(value)) fail('BRIEF_VIDEO_INPUT_INVALID');
  assertExactKeys(value, INPUT_KEYS, 'BRIEF_VIDEO_INPUT_UNKNOWN_FIELD');

  const startFrame = optionalAssetVersion(value.startFrame, 'BRIEF_VIDEO_START_FRAME_INVALID');
  const endFrame = optionalAssetVersion(value.endFrame, 'BRIEF_VIDEO_END_FRAME_INVALID');
  if (endFrame && !startFrame) fail('BRIEF_VIDEO_END_FRAME_REQUIRES_START');

  return {
    brief: boundedString(value.brief, 4_000, 'BRIEF_VIDEO_BRIEF_INVALID'),
    goal: enumValue(value.goal, BRIEF_TO_VIDEO_GOALS, 'BRIEF_VIDEO_GOAL_INVALID') as BriefToVideoGoal,
    audience: boundedString(value.audience, 500, 'BRIEF_VIDEO_AUDIENCE_INVALID'),
    platform: enumValue(value.platform, BRIEF_TO_VIDEO_PLATFORMS, 'BRIEF_VIDEO_PLATFORM_INVALID') as BriefToVideoPlatform,
    style: optionalString(value.style, 500, 'BRIEF_VIDEO_STYLE_INVALID') ?? DEFAULT_STYLE,
    callToAction: optionalString(value.callToAction, 300, 'BRIEF_VIDEO_CALL_TO_ACTION_INVALID'),
    durationSeconds: positiveInteger(value.durationSeconds, 600, 'BRIEF_VIDEO_DURATION_INVALID'),
    aspectRatio: aspectRatio(value.aspectRatio, 'BRIEF_VIDEO_ASPECT_RATIO_INVALID'),
    resolution: optionalString(value.resolution, 64, 'BRIEF_VIDEO_RESOLUTION_INVALID'),
    startFrame,
    endFrame,
    negativeConstraints: optionalString(value.negativeConstraints, 1_000, 'BRIEF_VIDEO_NEGATIVE_INVALID'),
    generateAudio: value.generateAudio === undefined ? false : value.generateAudio === true
      ? true
      : value.generateAudio === false
        ? false
        : fail('BRIEF_VIDEO_AUDIO_INVALID'),
  };
}

function parseScene(value: unknown, expectedOrder: number): BriefToVideoSceneV1 {
  if (!isRecord(value)) fail('BRIEF_VIDEO_PLAN_SCENE_INVALID');
  assertExactKeys(value, SCENE_KEYS, 'BRIEF_VIDEO_PLAN_SCENE_INVALID');
  if (value.order !== expectedOrder) fail('BRIEF_VIDEO_PLAN_SCENE_INVALID');
  return {
    order: expectedOrder,
    timeRange: boundedString(value.timeRange, 64, 'BRIEF_VIDEO_PLAN_SCENE_INVALID'),
    visual: boundedString(value.visual, 2_000, 'BRIEF_VIDEO_PLAN_SCENE_INVALID'),
    camera: boundedString(value.camera, 1_000, 'BRIEF_VIDEO_PLAN_SCENE_INVALID'),
    action: boundedString(value.action, 1_000, 'BRIEF_VIDEO_PLAN_SCENE_INVALID'),
    textOverlay: optionalString(value.textOverlay, 500, 'BRIEF_VIDEO_PLAN_SCENE_INVALID'),
  };
}

export function parseBriefToVideoPlan(value: unknown): BriefToVideoPlanV1 {
  assertSize(value, PLAN_BYTE_LIMIT, 'BRIEF_VIDEO_PLAN_SIZE_INVALID');
  if (!isRecord(value)) fail('BRIEF_VIDEO_PLAN_INVALID');
  assertExactKeys(value, PLAN_KEYS, 'BRIEF_VIDEO_PLAN_UNKNOWN_FIELD');
  if (value.schemaId !== BRIEF_TO_VIDEO_PLAN_SCHEMA_ID) fail('BRIEF_VIDEO_PLAN_SCHEMA_INVALID');
  if (!Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > MAX_SCENES) {
    fail('BRIEF_VIDEO_PLAN_SCENES_INVALID');
  }
  if (!Array.isArray(value.factualConstraints)
    || value.factualConstraints.length > MAX_CONSTRAINTS) {
    fail('BRIEF_VIDEO_PLAN_CONSTRAINTS_INVALID');
  }

  return {
    schemaId: BRIEF_TO_VIDEO_PLAN_SCHEMA_ID,
    title: boundedString(value.title, 200, 'BRIEF_VIDEO_PLAN_TITLE_INVALID'),
    logline: boundedString(value.logline, 1_000, 'BRIEF_VIDEO_PLAN_LOGLINE_INVALID'),
    durationSeconds: positiveInteger(value.durationSeconds, 600, 'BRIEF_VIDEO_PLAN_DURATION_INVALID'),
    aspectRatio: aspectRatio(value.aspectRatio, 'BRIEF_VIDEO_PLAN_ASPECT_RATIO_INVALID'),
    scenes: value.scenes.map((scene, index) => parseScene(scene, index + 1)),
    finalVideoPrompt: boundedString(value.finalVideoPrompt, 8_000, 'BRIEF_VIDEO_PLAN_PROMPT_INVALID'),
    negativePrompt: boundedString(value.negativePrompt, 2_000, 'BRIEF_VIDEO_PLAN_NEGATIVE_INVALID'),
    factualConstraints: value.factualConstraints.map(item => (
      boundedString(item, 1_000, 'BRIEF_VIDEO_PLAN_CONSTRAINTS_INVALID')
    )),
  };
}

export function canonicalBriefToVideoPlanJson(value: unknown): string {
  return JSON.stringify(parseBriefToVideoPlan(value));
}

export function parseBriefToVideoResult(value: unknown): BriefToVideoResultV1 {
  assertSize(value, RESULT_BYTE_LIMIT, 'BRIEF_VIDEO_RESULT_SIZE_INVALID');
  if (!isRecord(value)) fail('BRIEF_VIDEO_RESULT_INVALID');
  assertExactKeys(value, RESULT_KEYS, 'BRIEF_VIDEO_RESULT_UNKNOWN_FIELD');
  if (value.schemaId !== BRIEF_TO_VIDEO_RESULT_SCHEMA_ID) fail('BRIEF_VIDEO_RESULT_SCHEMA_INVALID');
  if (!Array.isArray(value.sourceAssetVersionIds) || value.sourceAssetVersionIds.length > 2) {
    fail('BRIEF_VIDEO_RESULT_SOURCE_INVALID');
  }
  const sourceAssetVersionIds = value.sourceAssetVersionIds.map(item => (
    assetVersion(item, 'BRIEF_VIDEO_RESULT_SOURCE_INVALID')
  ));
  if (new Set(sourceAssetVersionIds).size !== sourceAssetVersionIds.length) {
    fail('BRIEF_VIDEO_RESULT_SOURCE_INVALID');
  }

  return {
    schemaId: BRIEF_TO_VIDEO_RESULT_SCHEMA_ID,
    runId: identifier(value.runId, 'BRIEF_VIDEO_RESULT_RUN_INVALID'),
    planChecksum: boundedString(value.planChecksum, 256, 'BRIEF_VIDEO_RESULT_CHECKSUM_INVALID'),
    videoAssetVersionId: assetVersion(value.videoAssetVersionId, 'BRIEF_VIDEO_RESULT_ASSET_INVALID'),
    sourceAssetVersionIds,
    providerId: identifier(value.providerId, 'BRIEF_VIDEO_RESULT_PROVIDER_INVALID'),
    modelId: identifier(value.modelId, 'BRIEF_VIDEO_RESULT_MODEL_INVALID'),
    remoteTaskId: value.remoteTaskId === undefined
      ? undefined
      : identifier(value.remoteTaskId, 'BRIEF_VIDEO_RESULT_REMOTE_TASK_INVALID'),
    durationSeconds: positiveInteger(value.durationSeconds, 600, 'BRIEF_VIDEO_RESULT_DURATION_INVALID'),
    aspectRatio: aspectRatio(value.aspectRatio, 'BRIEF_VIDEO_RESULT_ASPECT_RATIO_INVALID'),
    resolution: optionalString(value.resolution, 64, 'BRIEF_VIDEO_RESULT_RESOLUTION_INVALID'),
    thumbnailUrl: optionalString(value.thumbnailUrl, 2_048, 'BRIEF_VIDEO_RESULT_THUMBNAIL_INVALID'),
  };
}
