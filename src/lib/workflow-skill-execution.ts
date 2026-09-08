import type { DurableSkillOutput } from './skill-runtime/types';
import {
  parseDurableSkillOutputsIsolated,
  type DurableSkillOutputError,
} from './skill-runtime/structured-output';
import { parsePlatformComplianceReport } from './platform-compliance/report-schema';

interface WorkflowSkillRunProjection {
  runId: string;
  status: string;
  assetVersionIds?: string[];
  outputs?: DurableSkillOutput[];
  outputErrors?: DurableSkillOutputError[];
  currentStepId?: string;
  resumeFromStepId?: string;
}

export class WorkflowSkillRunTerminalError extends Error {
  readonly runId: string;
  readonly status: string;
  readonly output: Record<string, unknown>;

  constructor(run: WorkflowSkillRunProjection, message = `Skill Run ${run.status}`) {
    super(message);
    this.name = 'WorkflowSkillRunTerminalError';
    this.runId = run.runId;
    this.status = run.status;
    this.output = projectWorkflowSkillRun(run, []);
  }
}

export interface WorkflowSkillAssetReference {
  assetId?: string;
  assetVersionId: string;
  url: string;
  kind?: 'image' | 'video' | 'model-3d' | 'three-d' | 'psd' | 'svg' | 'document' | 'audio' | 'dataset';
}

interface ExecuteWorkflowSkillRunInput {
  submitUrl: string;
  requestBody: Record<string, unknown>;
  headers: HeadersInit;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  timeoutMs?: number;
  statusRequestTimeoutMs?: number;
  requestTimeoutMs?: number;
  onProgress?: (run: WorkflowSkillRunProjection) => Promise<void> | void;
  onRunId?: (runId: string) => Promise<void> | void;
  resolveAssetVersion: (versionId: string) => Promise<WorkflowSkillAssetReference | null>;
}

interface CancelWorkflowSkillRunInput {
  submitUrl: string;
  runId: string;
  headers: HeadersInit;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

interface ResumeWorkflowSkillRunInput extends Omit<ExecuteWorkflowSkillRunInput, 'requestBody'> {
  runId: string;
  stepId: string;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const error = (payload as Record<string, unknown>).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
    return String((error as Record<string, unknown>).message);
  }
  return fallback;
}

function readWorkflowSkillRunProjection(payload: unknown): WorkflowSkillRunProjection | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const wrapped = record.run ?? record.projection;
  const candidate = wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)
    ? wrapped as Record<string, unknown>
    : record;
  if (typeof candidate.runId !== 'string' || typeof candidate.status !== 'string') return null;
  const parsedOutputs = parseDurableSkillOutputsIsolated(candidate.outputs);
  return {
    ...(candidate as unknown as WorkflowSkillRunProjection),
    outputs: parsedOutputs.outputs,
    ...(parsedOutputs.errors.length > 0 ? { outputErrors: parsedOutputs.errors } : {}),
  };
}

async function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new Error('Skill Run 已取消'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function transientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchStatusWithTimeout(
  fetcher: typeof fetch,
  url: string,
  headers: HeadersInit,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal?.reason);
  const timer = setTimeout(() => controller.abort(new Error('Skill Run 状态请求超时')), timeoutMs);
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetcher(url, { method: 'GET', headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

async function fetchMutationWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal?.reason);
  const timer = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs);
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

export async function cancelWorkflowSkillRun(input: CancelWorkflowSkillRunInput): Promise<WorkflowSkillRunProjection> {
  const fetcher = input.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('Skill Run 取消请求超时')),
    input.timeoutMs ?? 30_000,
  );
  try {
    const response = await fetcher(
      `${input.submitUrl.replace(/\/$/u, '')}/${encodeURIComponent(input.runId)}`,
      {
        method: 'PATCH',
        headers: input.headers,
        body: JSON.stringify({ action: 'cancel' }),
        signal: controller.signal,
      },
    );
    const payload = await response.json().catch(() => null);
    const run = readWorkflowSkillRunProjection(payload);
    if (!response.ok) throw new Error(errorMessage(payload, `Skill Run 取消失败 (${response.status})`));
    if (!run || run.runId !== input.runId || run.status !== 'cancelled') {
      throw new Error('Skill Run 未确认取消');
    }
    return run;
  } finally {
    clearTimeout(timer);
  }
}

export function projectWorkflowSkillRun(
  run: WorkflowSkillRunProjection,
  references: readonly WorkflowSkillAssetReference[],
): Record<string, unknown> {
  const assetVersionIds = [...new Set(run.assetVersionIds || [])];
  const parsedOutputs = parseDurableSkillOutputsIsolated(run.outputs);
  const outputs = parsedOutputs.outputs;
  const outputErrors = [...(run.outputErrors || []), ...parsedOutputs.errors];
  const text = outputs.filter(output => output.kind === 'text').map(output => output.content).join('\n\n');
  const complianceReports = outputs
    .filter(output => output.kind === 'json' && output.schemaId === 'platform-compliance-report-v1')
    .map(output => parsePlatformComplianceReport(JSON.parse(output.content) as unknown));
  const referencesByVersion = new Map<string, WorkflowSkillAssetReference>();
  for (const reference of references) {
    if (!referencesByVersion.has(reference.assetVersionId)) {
      referencesByVersion.set(reference.assetVersionId, reference);
    }
  }
  const dedupedReferences = [...referencesByVersion.values()];
  const imageReferences = dedupedReferences.filter(reference => reference.kind === undefined || reference.kind === 'image');
  const documentReferences = dedupedReferences.filter(reference => reference.kind === 'document');
  return {
    runId: run.runId,
    status: run.status,
    taskId: run.runId,
    ...(imageReferences[0]?.url ? { imageUrl: imageReferences[0].url } : {}),
    ...(imageReferences.length > 0 ? { imageUrls: imageReferences.map(reference => reference.url) } : {}),
    ...(imageReferences[0]?.assetVersionId ? { assetVersionId: imageReferences[0].assetVersionId } : {}),
    assetVersionIds,
    assetReferences: dedupedReferences,
    ...(documentReferences.length > 0 ? {
      documentAssetVersionIds: documentReferences.map(reference => reference.assetVersionId),
    } : {}),
    ...(complianceReports.length > 0 ? { complianceReports } : {}),
    ...(text ? { prompt: text, text } : {}),
    outputs,
    ...(outputErrors.length > 0 ? { outputErrors } : {}),
    ...(run.currentStepId ? { currentStepId: run.currentStepId } : {}),
    ...(run.resumeFromStepId ? { resumeFromStepId: run.resumeFromStepId } : {}),
  };
}

async function waitForWorkflowSkillRun(
  input: Omit<ExecuteWorkflowSkillRunInput, 'requestBody' | 'onRunId'> & { runId: string },
): Promise<Record<string, unknown>> {
  const fetcher = input.fetcher ?? fetch;
  const runId = input.runId;
  const pollUrl = `${input.submitUrl.replace(/\/$/u, '')}/${encodeURIComponent(runId)}`;
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? 10 * 60_000;
  const deadline = startedAt + timeoutMs;
  const retryDelayMs = Math.max(input.pollIntervalMs ?? 1_000, 100);
  let lastTransientError: Error | null = null;
  let run: WorkflowSkillRunProjection | null = null;
  while (Date.now() <= deadline) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    let response: Response;
    try {
      response = await fetchStatusWithTimeout(
        fetcher,
        pollUrl,
        input.headers,
        Math.min(input.statusRequestTimeoutMs ?? 15_000, remainingMs),
        input.signal,
      );
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason || error;
      lastTransientError = error instanceof Error ? error : new Error(String(error));
      await wait(Math.min(retryDelayMs, Math.max(0, deadline - Date.now())), input.signal);
      continue;
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(errorMessage(payload, `Skill Run 状态读取失败 (${response.status})`));
      if (!transientStatus(response.status)) throw error;
      lastTransientError = error;
      await wait(Math.min(retryDelayMs, Math.max(0, deadline - Date.now())), input.signal);
      continue;
    }
    const parsedRun = readWorkflowSkillRunProjection(payload);
    if (!parsedRun || parsedRun.runId !== runId) throw new Error('Skill Run 状态读取失败');
    run = parsedRun;
    await input.onProgress?.(run);
    if (run.status === 'completed') break;
    if (['failed', 'cancelled', 'paused', 'timeout'].includes(run.status)) {
      throw new WorkflowSkillRunTerminalError(run);
    }
    await wait(Math.min(input.pollIntervalMs ?? 1_000, Math.max(0, deadline - Date.now())), input.signal);
  }
  if (!run || run.status !== 'completed') {
    const timeoutMessage = lastTransientError
      ? `Skill Run 执行超时: ${lastTransientError.message}`
      : 'Skill Run 执行超时';
    try {
      const cancelledRun = await cancelWorkflowSkillRun({
        submitUrl: input.submitUrl,
        runId,
        headers: input.headers,
        fetcher,
        timeoutMs: input.statusRequestTimeoutMs,
      });
      throw new WorkflowSkillRunTerminalError(cancelledRun, timeoutMessage);
    } catch (error) {
      if (error instanceof WorkflowSkillRunTerminalError) throw error;
      throw new Error(`${timeoutMessage}，且取消未确认: ${errorMessage(error, String(error))}`);
    }
  }

  const assetVersionIds = [...new Set(run.assetVersionIds || [])];
  const references = (await Promise.all(assetVersionIds.map(async (assetVersionId) => {
    const reference = await input.resolveAssetVersion(assetVersionId);
    if (reference && reference.assetVersionId !== assetVersionId) {
      throw new Error('Skill 成品版本解析不一致');
    }
    return reference;
  }))).filter((value): value is WorkflowSkillAssetReference => Boolean(value));
  return projectWorkflowSkillRun(run, references);
}

export async function executeWorkflowSkillRun(input: ExecuteWorkflowSkillRunInput): Promise<Record<string, unknown>> {
  const fetcher = input.fetcher ?? fetch;
  const submitted = await fetchMutationWithTimeout(fetcher, input.submitUrl, {
    method: 'POST',
    headers: input.headers,
    body: JSON.stringify(input.requestBody),
  }, input.requestTimeoutMs ?? 30_000, 'Skill Run 提交请求超时', input.signal);
  const submission = await submitted.json().catch(() => null) as { runId?: unknown } | null;
  if (!submitted.ok || typeof submission?.runId !== 'string') {
    throw new Error(errorMessage(submission, 'Skill Run 提交失败'));
  }
  await input.onRunId?.(submission.runId);
  return waitForWorkflowSkillRun({ ...input, runId: submission.runId });
}

export async function resumeWorkflowSkillRun(input: ResumeWorkflowSkillRunInput): Promise<Record<string, unknown>> {
  const fetcher = input.fetcher ?? fetch;
  const retryUrl = `${input.submitUrl.replace(/\/$/u, '')}/${encodeURIComponent(input.runId)}/retry`;
  const resumed = await fetchMutationWithTimeout(fetcher, retryUrl, {
    method: 'POST',
    headers: input.headers,
    body: JSON.stringify({ stepId: input.stepId }),
  }, input.requestTimeoutMs ?? 30_000, 'Skill Run 恢复请求超时', input.signal);
  const payload = await resumed.json().catch(() => null);
  if (!resumed.ok) throw new Error(errorMessage(payload, 'Skill Run 恢复失败'));
  await input.onRunId?.(input.runId);
  return waitForWorkflowSkillRun({ ...input, runId: input.runId });
}
