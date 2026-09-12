import { fetchWithV1Retry } from '@/lib/api-helpers';
import { parseBriefToVideoPlan } from './schema';
import {
  BRIEF_TO_VIDEO_PLAN_SCHEMA_ID,
  type BriefToVideoInput,
  type BriefToVideoPlanV1,
} from './types';

const MAX_PROMPT_CHARACTERS = 16_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const PLANNER_TIMEOUT_MS = 60_000;

function invalidPlan(): never {
  throw new Error('BRIEF_VIDEO_PLAN_INVALID');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function buildBriefToVideoPlanPrompt(
  input: BriefToVideoInput,
  revisionInstruction?: string,
): string {
  const prompt = [
    '你是商业视频脚本规划器。仅返回一个 JSON 对象，不要 Markdown、解释或额外字段。',
    `schemaId 必须为 ${BRIEF_TO_VIDEO_PLAN_SCHEMA_ID}。`,
    'JSON 字段必须严格为：schemaId,title,logline,durationSeconds,aspectRatio,scenes,finalVideoPrompt,negativePrompt,factualConstraints。',
    'scenes 每项字段严格为：order,timeRange,visual,camera,action,textOverlay；order 从 1 连续递增。',
    '必须保持用户给定的时长、比例、事实约束和素材关系，不得臆造品牌事实。',
    `用户输入：${JSON.stringify(input)}`,
    ...(revisionInstruction ? [`上一版修改要求：${revisionInstruction}`] : []),
  ].join('\n');
  if (prompt.length >= MAX_PROMPT_CHARACTERS) invalidPlan();
  return prompt;
}

function contentFromEnvelope(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length < 1 || !isRecord(choices[0])) return value;
  const message = choices[0].message;
  if (!isRecord(message) || typeof message.content !== 'string') invalidPlan();
  return message.content;
}

function contentFromSse(value: string): string | undefined {
  if (!value.split(/\r?\n/u).some(line => line.trimStart().startsWith('data:'))) return undefined;
  let content = '';
  for (const line of value.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let event: unknown;
    try {
      event = JSON.parse(data) as unknown;
    } catch {
      invalidPlan();
    }
    if (!isRecord(event) || !Array.isArray(event.choices) || !isRecord(event.choices[0])) {
      invalidPlan();
    }
    const delta = event.choices[0].delta;
    const message = event.choices[0].message;
    const fragment = isRecord(delta) ? delta.content : isRecord(message) ? message.content : undefined;
    if (typeof fragment !== 'string') invalidPlan();
    content += fragment;
    if (new TextEncoder().encode(content).byteLength > MAX_RESPONSE_BYTES) invalidPlan();
  }
  return content || undefined;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/iu.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export function parseBriefToVideoPlanResponse(response: unknown): BriefToVideoPlanV1 {
  try {
    let candidate = contentFromEnvelope(response);
    if (typeof candidate === 'string') {
      if (new TextEncoder().encode(candidate).byteLength > MAX_RESPONSE_BYTES) invalidPlan();
      const content = contentFromSse(candidate) ?? candidate;
      candidate = JSON.parse(stripJsonFence(content)) as unknown;
    }
    return parseBriefToVideoPlan(candidate);
  } catch {
    invalidPlan();
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) invalidPlan();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        invalidPlan();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function invokeBriefToVideoPlanner(input: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  requestId: string;
  planInput: BriefToVideoInput;
  revisionInstruction?: string;
  signal: AbortSignal;
}): Promise<BriefToVideoPlanV1> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(PLANNER_TIMEOUT_MS)]);
  const response = await fetchWithV1Retry(input.baseUrl, '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
      'X-Request-Id': input.requestId,
    },
    body: JSON.stringify({
      model: input.modelId,
      messages: [{
        role: 'user',
        content: buildBriefToVideoPlanPrompt(input.planInput, input.revisionInstruction),
      }],
      stream: false,
      response_format: { type: 'json_object' },
    }),
    signal,
  }, true, PLANNER_TIMEOUT_MS);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    invalidPlan();
  }
  const body = await readBoundedResponse(response);
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    payload = body;
  }
  return parseBriefToVideoPlanResponse(payload);
}
