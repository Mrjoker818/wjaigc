import 'server-only';

import { createHash } from 'node:crypto';

import { fetchWithV1Retry } from '@/lib/api-helpers';
import {
  AgentDownstreamProviderRejectedError,
  AgentDownstreamSubmissionUnknownError,
  type AgentDownstreamRecovery,
} from '@/lib/agent-runtime/downstream-operations';
import { getCloudTaskForUser, updateCloudTask, type CloudTask } from '@/lib/cloud-task-storage';
import { executeAdmittedToolCall, executeToolCall, type AdmittedToolExecution } from '@/lib/chat-tools';
import { getApiProviders } from '@/lib/server-api-config';
import { appendAdoptedAgentEvent } from '@/lib/agent-runtime/event-storage';
import type { User } from '@/lib/user-types';
import { parseWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { createPostgresAssetStorage } from '@/lib/asset-core/storage';
import { enrichCompletedImageResult } from '@/lib/asset-core/image-result-metadata';
import { auditComplianceMedia } from '@/lib/platform-compliance/media-audit';
import { buildComplianceReport } from '@/lib/platform-compliance/report-builder';
import {
  complianceReportFromAssetVersion,
  persistComplianceReportAsset,
} from '@/lib/platform-compliance/report-asset';
import { canonicalComplianceReportJson } from '@/lib/platform-compliance/report-schema';
import { resolveComplianceRuleSet } from '@/lib/platform-compliance/rules';
import { evaluateTechnicalRules } from '@/lib/platform-compliance/technical-evaluator';
import type {
  ComplianceAssetType,
  CompliancePlatform,
  PlatformComplianceReportV1,
  PlatformComplianceTechnicalErrorV1,
} from '@/lib/platform-compliance/types';
import {
  ComplianceVisionError,
  invokeComplianceVision,
} from '@/lib/platform-compliance/vision-client';
import { buildSkillStepMessages, buildSkillStepPrompt } from './execution-context';
import type { SkillRunRequest } from './run-request';
import type { ExecuteSkillStepInput } from './executor';
import type { SkillStepAdapter, SkillStepRecoveryFactory } from './service';
import type { SkillStepResult } from './types';
import { executeMultiPlatformExportStep } from '@/lib/multi-platform-export/executor';

type ResolveSkillMediaMetadata = (input: {
  actorUserId: string;
  projectId: string;
  assetVersionIds: readonly string[];
}) => Promise<SkillStepResult['media']>;

export interface PersistCompliancePartialReportInput {
  actorUserId: string;
  projectId: string;
  runId: string;
  stepId: string;
  sourceVersionId: string;
  phase: 'technical' | 'vision-error';
  report: PlatformComplianceReportV1;
  assetVersionId?: string;
  executionFence: NonNullable<ExecuteSkillStepInput['operation']['executionFence']>;
  workspace: 'canvas' | 'workflow';
}

type PersistCompliancePartialReport = (
  input: PersistCompliancePartialReportInput,
) => Promise<void>;

class ComplianceAuditVisionFailedError extends Error {
  readonly code = 'COMPLIANCE_AUDIT_VISION_FAILED';
  readonly submissionOutcome = 'known';
  readonly persistenceFailed: boolean;

  constructor(
    readonly partialReport: PlatformComplianceReportV1,
    readonly providerId: string,
    readonly modelId: string,
    readonly requestId: string,
    readonly retryable: boolean,
    readonly providerStatus?: number,
    options?: ErrorOptions & { persistenceFailed?: boolean },
  ) {
    super('The frozen compliance vision check failed', options);
    this.name = 'ComplianceAuditVisionFailedError';
    this.persistenceFailed = options?.persistenceFailed === true;
  }
}

async function persistCompliancePartialReport(
  input: PersistCompliancePartialReportInput,
): Promise<void> {
  if (input.assetVersionId) {
    await appendAdoptedAgentEvent({
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      runId: input.runId,
      workspace: input.workspace,
      eventId: `skill:${input.runId}:step:${input.stepId}:compliance:${input.phase}:asset:${input.assetVersionId}:generation:${input.executionFence.generation}`,
      type: 'asset.created',
      payload: { stepId: input.stepId, assetVersionId: input.assetVersionId },
      executionFence: input.executionFence,
    });
  }
  await appendAdoptedAgentEvent({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    runId: input.runId,
    workspace: input.workspace,
    eventId: `skill:${input.runId}:step:${input.stepId}:compliance:${input.phase}:generation:${input.executionFence.generation}`,
    type: 'tool.progress',
    payload: {
      toolId: 'compliance_audit',
      stepId: input.stepId,
      phase: input.phase,
      generation: input.executionFence.generation,
      ...(input.assetVersionId ? { assetVersionId: input.assetVersionId } : {}),
      outputs: [{
        stepId: input.stepId,
        kind: 'json',
        schemaId: 'platform-compliance-report-v1',
        content: canonicalComplianceReportJson(input.report),
      }],
    },
    executionFence: input.executionFence,
  });
}

const resolveSkillMediaMetadata: ResolveSkillMediaMetadata = async input => {
  const storage = createPostgresAssetStorage();
  return storage.read(async transaction => Promise.all(input.assetVersionIds.map(async versionId => {
    const version = await transaction.findVersion(input.actorUserId, input.projectId, versionId);
    if (version?.file.width !== undefined && version.file.height !== undefined) {
      return { width: version.file.width, height: version.file.height };
    }
    if (version?.file.url) {
      const enriched = await enrichCompletedImageResult({ imageUrls: [version.file.url] });
      const inspected = Array.isArray(enriched.images) ? enriched.images[0] : undefined;
      if (inspected && typeof inspected === 'object' && !Array.isArray(inspected)) {
        const media = inspected as Record<string, unknown>;
        return {
          ...(typeof media.width === 'number' ? { width: media.width } : {}),
          ...(typeof media.height === 'number' ? { height: media.height } : {}),
        };
      }
    }
    return {
      ...(version?.file.width !== undefined ? { width: version.file.width } : {}),
      ...(version?.file.height !== undefined ? { height: version.file.height } : {}),
    };
  })));
};

function projectionVersionIds(task: CloudTask): string[] {
  const projection = task.result?.assetProjection;
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) return [];
  const versionIds = (projection as Record<string, unknown>).versionIds;
  return Array.isArray(versionIds)
    ? versionIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : [];
}

function assertKnownSubmission(task: CloudTask | null): void {
  if (task?.status === 'processing' && task.result?.skillBillingProvenance
    && (task.result.taskError as Record<string, unknown> | undefined)?.code === 'SKILL_SUBMISSION_UNKNOWN') {
    throw new AgentDownstreamSubmissionUnknownError();
  }
}

async function monitorGeneration(execution: AdmittedToolExecution, signal: AbortSignal): Promise<void> {
  try {
    await executeAdmittedToolCall(execution, signal);
  } catch (error) {
    if (execution.kind === 'generation') {
      for (const taskId of execution.taskIds) assertKnownSubmission(await getCloudTaskForUser(taskId, execution.userId));
    }
    throw error;
  }
}

async function completedGenerationResult(
  taskId: string,
  actorUserId: string,
  projectId: string,
  metadataResolver?: ResolveSkillMediaMetadata,
): Promise<SkillStepResult> {
  const task = await getCloudTaskForUser(taskId, actorUserId);
  assertKnownSubmission(task);
  if (!task || task.status !== 'completed') {
    const error = task?.result?.taskError;
    const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    throw new AgentDownstreamProviderRejectedError(typeof details.providerStatus === 'number' ? details.providerStatus : undefined, {
      message: task?.error || 'Skill generation task did not complete',
      providerCode: typeof details.code === 'string' ? details.code : undefined,
    });
  }
  const assetVersionIds = projectionVersionIds(task);
  return {
    assetVersionIds,
    media: metadataResolver
      ? await metadataResolver({ actorUserId, projectId, assetVersionIds })
      : assetVersionIds.map(() => ({})),
  };
}

function promptForStep(input: ExecuteSkillStepInput): string {
  return buildSkillStepPrompt(input);
}

async function executeOrchestratorStep(input: ExecuteSkillStepInput): Promise<SkillStepResult> {
  if (!input.modelBinding) {
    throw new AgentDownstreamProviderRejectedError(undefined, {
      message: 'Skill orchestrator model binding is missing',
    });
  }
  const provider = (await getApiProviders()).find(candidate => (
    candidate.id === input.modelBinding!.providerId && candidate.isEnabled
  ));
  if (!provider || !provider.apiKey || !provider.baseUrl) {
    throw new AgentDownstreamProviderRejectedError(undefined, {
      message: 'Skill orchestrator provider is unavailable',
    });
  }
  await input.operation.beginSubmission();
  const response = await fetchWithV1Retry(provider.baseUrl, '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: input.modelBinding.modelId,
      messages: buildSkillStepMessages(input),
      stream: false,
    }),
    signal: input.signal,
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    throw new AgentDownstreamProviderRejectedError(response.status, {
      message: 'Skill orchestrator provider rejected the request',
    });
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = choices[0] && typeof choices[0] === 'object'
    ? (choices[0] as Record<string, unknown>).message
    : null;
  const content = message && typeof message === 'object' && !Array.isArray(message)
    ? (message as Record<string, unknown>).content
    : '';
  return {
    assetVersionIds: [],
    media: [],
    ...(typeof content === 'string' && content ? { text: content } : {}),
  };
}

async function reconcileGeneration(
  taskId: string,
  actor: User,
  projectId: string,
  signal: AbortSignal,
  metadataResolver?: ResolveSkillMediaMetadata,
): Promise<SkillStepResult> {
  await monitorGeneration({
    kind: 'generation',
    taskIds: [taskId],
    userId: actor.id,
    userRole: actor.role || 'user',
  }, signal);
  return completedGenerationResult(taskId, actor.id, projectId, metadataResolver);
}

function imageAdmissionError(message: string, code = 'SKILL_IMAGE_ADMISSION_FAILED'): Error {
  return Object.assign(new Error(message), { code });
}

async function executeGenerationStep(
  actor: User,
  request: SkillRunRequest,
  input: ExecuteSkillStepInput,
  toolId: 'generate_image' | 'img2img' = 'generate_image',
  canonicalImageUrls?: readonly string[],
  metadataResolver?: ResolveSkillMediaMetadata,
): Promise<SkillStepResult> {
  if (!input.modelBinding) {
    throw imageAdmissionError('Skill image model binding is missing');
  }
  const result = await executeToolCall(toolId, {
    prompt: promptForStep(input),
    aspect_ratio: typeof input.inputValues.aspectRatio === 'string'
      ? input.inputValues.aspectRatio
      : '1:1',
    ...(toolId === 'img2img' ? { image_urls: [...(canonicalImageUrls || [])] } : {}),
  }, {
    chatApiKey: '', chatBaseUrl: '', origin: 'http://localhost',
    userId: actor.id, userRole: actor.role || 'user',
    imageModel: input.modelBinding.modelId,
    imageProviderId: input.modelBinding.providerId,
    projectId: request.projectId,
    sessionId: request.workspaceId,
    idempotencyKey: input.operation.idempotencyKey,
    skillBillingContext: input.operation.executionFence ? {
      runId: input.runId,
      stepId: input.step.id,
      requestDigest: input.requestDigest,
      operationKey: input.operation.operationKey,
      executionFence: input.operation.executionFence,
    } : undefined,
    deferAgentExecution: true,
    allowedTools: [toolId],
    ...(canonicalImageUrls ? { canonicalImageUrls } : {}),
  });
  if (!result.success) {
    throw imageAdmissionError(
      result.error || 'Skill image admission failed before provider submission',
      result.errorCode || 'SKILL_IMAGE_ADMISSION_FAILED',
    );
  }
  const taskId = result.taskIds?.[0]?.taskId;
  if (!taskId || !result.admittedExecution) {
    throw imageAdmissionError('Skill image generation did not return a durable task');
  }
  const task = await getCloudTaskForUser(taskId, actor.id);
  const submissionPayload = task?.result?.submissionPayload;
  const assetSourceTrace = parseWorkspaceSourceTrace({
    source: 'canvas-skill', runId: input.runId, skillId: request.skillId,
    skillVersion: request.skillVersion, sourceVersionIds: request.sourceVersionIds,
    modelBindings: request.modelBindings, createdAt: new Date().toISOString(),
  });
  if (!assetSourceTrace) {
    throw imageAdmissionError('Skill generation source trace could not be frozen');
  }
  const updated = task && await updateCloudTask(taskId, {
    result: {
      ...task.result,
      submissionPayload: {
        ...(submissionPayload && typeof submissionPayload === 'object' && !Array.isArray(submissionPayload)
          ? submissionPayload
          : {}),
        assetParentVersionIds: [...request.sourceVersionIds],
        assetSourceTrace,
      },
    },
  });
  if (!updated) {
    throw imageAdmissionError('Skill generation lineage could not be persisted');
  }
  if (!input.operation.recordLocalAccepted) throw new Error('Local Skill task confirmation is unavailable');
  await input.operation.recordLocalAccepted(taskId);
  await monitorGeneration(result.admittedExecution, input.signal);
  const requiresDimensions = input.step.qualityGateIds.some(id => (
    id === 'image-dimensions-known' || id === 'aspect-ratio-match'
  ));
  return completedGenerationResult(
    taskId,
    input.actorUserId,
    request.projectId,
    requiresDimensions ? metadataResolver : undefined,
  );
}

export function createProductionSkillStepRegistry(input: {
  actor: User;
  request: SkillRunRequest;
  mediaByVersionId?: Readonly<Record<string, string>>;
  resolveMediaMetadata?: ResolveSkillMediaMetadata;
  persistCompliancePartialReport?: PersistCompliancePartialReport;
}): {
  stepAdapters: Readonly<Record<string, SkillStepAdapter>>;
  stepRecoveries: Readonly<Record<string, SkillStepRecoveryFactory>>;
} {
  const generate: SkillStepAdapter = step => step.step.modelRole === 'orchestrator'
    ? executeOrchestratorStep(step)
    : executeGenerationStep(
      input.actor, input.request, step, 'generate_image', undefined,
      input.resolveMediaMetadata || resolveSkillMediaMetadata,
    );
  const recoverGenerate: SkillStepRecoveryFactory = step => ({
    reconcile: taskId => reconcileGeneration(
      taskId,
      input.actor,
      input.request.projectId,
      step.signal,
      step.step.qualityGateIds.some(id => (
        id === 'image-dimensions-known' || id === 'aspect-ratio-match'
      )) ? input.resolveMediaMetadata || resolveSkillMediaMetadata : undefined,
    ),
  } satisfies AgentDownstreamRecovery<SkillStepResult>);
  const img2img: SkillStepAdapter = step => {
    if (input.request.sourceVersionIds.length < 1 || input.request.sourceVersionIds.length > 6) {
      throw imageAdmissionError('Skill img2img requires between 1 and 6 authorized sources');
    }
    const canonicalImageUrls = input.request.sourceVersionIds.map(versionId => {
      const url = input.mediaByVersionId?.[versionId];
      if (typeof url !== 'string' || !url.trim()) {
        throw imageAdmissionError('Authorized Skill source media is unavailable', 'AGENT_CONTEXT_NOT_FOUND');
      }
      return url;
    });
    return executeGenerationStep(
      input.actor,
      input.request,
      step,
      'img2img',
      canonicalImageUrls,
      input.resolveMediaMetadata || resolveSkillMediaMetadata,
    );
  };

  const complianceAudit: SkillStepAdapter = async step => {
    const fanOut = step.step.compiledFanOut;
    const sourceValues = fanOut ? step.inputValues[fanOut.inputKey] : undefined;
    const sourceVersionId = Array.isArray(sourceValues) ? sourceValues[fanOut!.itemIndex] : undefined;
    if (
      !fanOut
      || typeof sourceVersionId !== 'string'
      || !sourceVersionId
      || !input.request.sourceVersionIds.includes(sourceVersionId)
    ) {
      throw imageAdmissionError(
        'Skill compliance audit source is not an authorized compiled fan-out item',
        'AGENT_CONTEXT_NOT_FOUND',
      );
    }
    const imageInput = input.mediaByVersionId?.[sourceVersionId];
    if (typeof imageInput !== 'string' || !imageInput.trim()) {
      throw imageAdmissionError(
        'Authorized Skill compliance source media is unavailable',
        'AGENT_CONTEXT_NOT_FOUND',
      );
    }
    if (!step.modelBinding) {
      throw imageAdmissionError('Skill compliance vision model binding is missing');
    }
    if (!step.operation.executionFence) {
      throw imageAdmissionError('Skill compliance execution fence is missing');
    }
    if (input.request.surface !== 'canvas' && input.request.surface !== 'workflow') {
      throw imageAdmissionError('Skill compliance audit requires a persisted workspace');
    }
    const workspace = input.request.surface;

    const platform = step.inputValues.platform;
    const region = step.inputValues.region;
    const assetType = step.inputValues.assetType;
    const productCategory = step.inputValues.productCategory;
    const productFacts = step.inputValues.productFacts ?? '';
    const claims = step.inputValues.claims ?? '';
    const reportLanguage = step.inputValues.reportLanguage ?? '中文';
    if (
      !['通用电商', 'Amazon', '淘宝/天猫', '京东'].includes(String(platform))
      || typeof region !== 'string'
      || !['main', 'secondary', 'detail', 'a-plus'].includes(String(assetType))
      || typeof productCategory !== 'string'
      || typeof productFacts !== 'string'
      || productFacts.length > 4_000
      || typeof claims !== 'string'
      || claims.length > 4_000
      || (reportLanguage !== '中文' && reportLanguage !== 'English')
    ) {
      throw imageAdmissionError('Skill compliance audit inputs are invalid');
    }

    const ruleSet = resolveComplianceRuleSet({
      platform: platform as CompliancePlatform,
      region,
      assetType: assetType as ComplianceAssetType,
      productCategory,
    });
    const facts = await auditComplianceMedia({ imageInput, signal: step.signal });
    const technicalChecks = evaluateTechnicalRules(facts, ruleSet.rules);
    const sourceDigest = facts.sourceDigest;
    const reportId = `compliance:${step.runId}:${step.step.id}`;
    const generatedAt = new Date().toISOString();
    const visionModel = {
      providerId: step.modelBinding.providerId,
      modelId: step.modelBinding.modelId,
    };
    const buildReport = (
      technicalErrors: readonly PlatformComplianceTechnicalErrorV1[] = [],
      visionResult?: Awaited<ReturnType<typeof invokeComplianceVision>>,
    ): PlatformComplianceReportV1 => buildComplianceReport({
      reportId,
      runId: step.runId,
      generatedAt,
      sourceVersionId,
      sourceDigest,
      ruleSet,
      technicalChecks,
      visionModel,
      technicalErrors,
      visionResult,
    });
    const sourceTrace = parseWorkspaceSourceTrace({
      source: 'canvas-skill',
      runId: step.runId,
      skillId: input.request.skillId,
      skillVersion: input.request.skillVersion,
      sourceVersionIds: [sourceVersionId],
      modelBindings: input.request.modelBindings,
      createdAt: generatedAt,
    });
    if (sourceTrace?.source !== 'canvas-skill') {
      throw imageAdmissionError('Skill compliance report source trace could not be frozen');
    }
    const persistReportAsset = async (
      phase: 'technical' | 'vision-error' | 'completed',
      report: PlatformComplianceReportV1,
    ) => {
      const version = await persistComplianceReportAsset({
        actorUserId: step.actorUserId,
        projectId: step.projectId,
        runId: step.runId,
        stepId: step.step.id,
        report,
        sourceVersionIds: [sourceVersionId],
        sourceTrace,
        idempotencyKey: `${step.operation.idempotencyKey}:report-asset:${phase}`,
        requestDigest: step.requestDigest,
      });
      return { version, report: complianceReportFromAssetVersion(version) };
    };
    const persist = input.persistCompliancePartialReport || persistCompliancePartialReport;
    const persistReport = async (
      phase: PersistCompliancePartialReportInput['phase'],
      report: PlatformComplianceReportV1,
    ) => {
      const persisted = phase === 'technical'
        ? { report }
        : await persistReportAsset(phase, report);
      await persist({
        actorUserId: step.actorUserId,
        projectId: step.projectId,
        runId: step.runId,
        stepId: step.step.id,
        sourceVersionId,
        phase,
        report: persisted.report,
        ...('version' in persisted ? { assetVersionId: persisted.version.id } : {}),
        executionFence: step.operation.executionFence!,
        workspace,
      });
      return persisted;
    };

    await persistReport('technical', buildReport());
    const provider = (await getApiProviders()).find(candidate => (
      candidate.id === step.modelBinding!.providerId && candidate.isEnabled
    ));
    if (!provider || !provider.apiKey || !provider.baseUrl) {
      const technicalError: PlatformComplianceTechnicalErrorV1 = {
        code: 'COMPLIANCE_VISION_PROVIDER_UNAVAILABLE',
        message: 'The frozen compliance vision provider is unavailable',
        retryable: true,
        providerId: step.modelBinding.providerId,
        modelId: step.modelBinding.modelId,
        requestId: step.operation.idempotencyKey,
      };
      const partialReport = buildReport([technicalError]);
      const persisted = await persistReport('vision-error', partialReport);
      throw new ComplianceAuditVisionFailedError(
        persisted.report,
        step.modelBinding.providerId,
        step.modelBinding.modelId,
        step.operation.idempotencyKey,
        true,
      );
    }

    const persistVisionFailure = async (error: ComplianceVisionError): Promise<never> => {
      if (!(error instanceof ComplianceVisionError)) throw error;
      const technicalError: PlatformComplianceTechnicalErrorV1 = {
        code: error.code,
        message: 'The frozen compliance vision check did not complete',
        retryable: error.retryable,
        providerId: error.providerId,
        modelId: error.modelId,
        requestId: error.requestId,
      };
      let partialReport = buildReport([technicalError]);
      try {
        partialReport = (await persistReport('vision-error', partialReport)).report;
      } catch (persistenceError) {
        partialReport = buildReport([technicalError, {
          code: 'COMPLIANCE_PARTIAL_REPORT_PERSIST_FAILED',
          message: 'The compliance partial report could not be persisted',
          retryable: true,
        }]);
        if (error.submissionUnknown) {
          throw Object.assign(new AgentDownstreamSubmissionUnknownError(error), {
            partialReport,
            providerId: error.providerId,
            modelId: error.modelId,
            requestId: error.requestId,
            retryable: false,
            persistenceFailed: true,
          });
        }
        throw new ComplianceAuditVisionFailedError(
          partialReport,
          error.providerId,
          error.modelId,
          error.requestId,
          error.retryable,
          error.providerStatus,
          { cause: persistenceError, persistenceFailed: true },
        );
      }
      if (error.submissionUnknown) {
        throw Object.assign(new AgentDownstreamSubmissionUnknownError(error), {
          partialReport,
          providerId: error.providerId,
          modelId: error.modelId,
          requestId: error.requestId,
          retryable: false,
        });
      }
      throw new ComplianceAuditVisionFailedError(
        partialReport,
        error.providerId,
        error.modelId,
        error.requestId,
        error.retryable,
        error.providerStatus,
        { cause: error },
      );
    };
    const visionRequestDigest = createHash('sha256').update(JSON.stringify({
      requestDigest: step.requestDigest,
      sourceDigest,
      providerId: step.modelBinding.providerId,
      modelId: step.modelBinding.modelId,
      ruleSetDigest: ruleSet.digest,
    })).digest('hex');
    const visionResult = await step.operation.executeOperation({
      stepId: `${step.step.id}:vision`,
      toolId: 'compliance_audit_vision',
      requestDigest: visionRequestDigest,
    }, async visionOperation => {
      await visionOperation.beginSubmission();
      try {
        return await invokeComplianceVision({
          provider,
          modelId: step.modelBinding!.modelId,
          imageInput: facts.inspectedImageDataUrl,
          rules: ruleSet.rules.filter(rule => rule.evaluator === 'vision'),
          productFacts,
          claims,
          reportLanguage,
          requestId: visionOperation.idempotencyKey,
          signal: step.signal,
        });
      } catch (error) {
        if (!(error instanceof ComplianceVisionError)) throw error;
        return persistVisionFailure(error);
      }
    });
    const completed = await persistReportAsset('completed', buildReport([], visionResult));
    return {
      assetVersionIds: [completed.version.id],
      media: [],
      structured: { schemaId: 'platform-compliance-report-v1', value: completed.report },
    };
  };
  const multiPlatformExport: SkillStepAdapter = step => executeMultiPlatformExportStep(step, {
    ...(input.request.retryLineage ? { retryLineage: input.request.retryLineage } : {}),
    onProgress: async progress => {
      if (!step.operation.executionFence) throw new Error('Skill export execution fence is missing');
      await appendAdoptedAgentEvent({
        actorUserId: step.actorUserId,
        projectId: step.projectId,
        runId: step.runId,
        workspace: input.request.surface === 'simple-chat' ? 'chat' : input.request.surface,
        eventId: `skill:${step.runId}:step:${step.step.id}:progress:${progress.completed}:generation:${step.operation.executionFence.generation}`,
        type: 'tool.progress',
        payload: {
          toolId: step.step.toolId,
          stepId: step.step.id,
          ...progress,
          progress: progress.total > 0 ? progress.completed / progress.total : 0,
          generation: step.operation.executionFence.generation,
        },
        executionFence: step.operation.executionFence,
      });
    },
  });
  return {
    stepAdapters: {
      chat: executeOrchestratorStep,
      generate_image: generate,
      img2img,
      compliance_audit: complianceAudit,
      multi_platform_export: multiPlatformExport,
    },
    stepRecoveries: { generate_image: recoverGenerate, img2img: recoverGenerate },
  };
}
