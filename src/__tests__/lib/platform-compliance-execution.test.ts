import { readFileSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithV1Retry: vi.fn(),
  getApiProviders: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: mocks.fetchWithV1Retry }));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: mocks.getApiProviders }));

import { auditComplianceMedia } from '@/lib/platform-compliance/media-audit';
import { buildComplianceReport } from '@/lib/platform-compliance/report-builder';
import { resolveComplianceRuleSet } from '@/lib/platform-compliance/rules';
import { evaluateTechnicalRules } from '@/lib/platform-compliance/technical-evaluator';
import {
  executeDurableAgentDownstreamOperation,
  type AgentDownstreamOperation,
  type AgentDownstreamOperationDependencies,
} from '@/lib/agent-runtime/downstream-operations';
import {
  createProductionSkillStepRegistry,
  type PersistCompliancePartialReportInput,
} from '@/lib/skill-runtime/step-registry';

const image = readFileSync(resolve(
  process.cwd(), 'src/__tests__/fixtures/platform-compliance/amazon-main-pass.png',
));
const imageDataUrl = `data:image/png;base64,${image.toString('base64')}`;
const ruleSet = resolveComplianceRuleSet({
  platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
});

function successfulVisionChecks() {
  return ruleSet.rules.filter(rule => rule.evaluator === 'vision').map(rule => ({
    ruleId: rule.id, status: 'passed', evidence: ['model-observation=clear'],
    measuredValue: 'compliant', confidence: 0.9, remediation: null,
  }));
}

function durableDependencies() {
  let operation: AgentDownstreamOperation | undefined;
  const dependencies: AgentDownstreamOperationDependencies = {
    prepare: vi.fn(async identity => {
      operation = operation
        ? { ...operation, ...identity, attempts: operation.attempts + 1, claimed: true }
        : { ...identity, status: 'prepared', attempts: 1, claimed: true };
      return operation as AgentDownstreamOperation;
    }),
    markSubmitted: vi.fn(async identity => {
      operation = { ...operation!, ...identity, status: 'submitted' };
      return operation as AgentDownstreamOperation;
    }),
    markAccepted: vi.fn(),
    markSubmissionUnknown: vi.fn(async identity => {
      operation = { ...operation!, ...identity, status: 'submission_unknown' };
      return operation as AgentDownstreamOperation;
    }),
    complete: vi.fn(async identity => {
      operation = { ...operation!, ...identity, status: 'completed' };
      return operation as AgentDownstreamOperation;
    }),
    release: vi.fn(async (_identity, options) => {
      if (operation?.status === 'submitted' && options?.knownSubmissionOutcome) {
        operation = { ...operation, status: 'prepared', claimed: false };
      }
      return true;
    }),
  };
  return dependencies;
}

function complianceRequest() {
  return {
    skillId: 'preset-platform-compliance-audit', skillVersion: 1, surface: 'canvas' as const,
    projectId: 'project-1', workspaceId: 'canvas-1',
    inputValues: {
      sourceImages: ['asset-version-a'],
      platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
    },
    sourceVersionIds: ['asset-version-a'], modelBindings: {}, idempotencyKey: 'run-key',
  };
}

function complianceStepInput(
  request: ReturnType<typeof complianceRequest>,
  operation: Parameters<ReturnType<typeof createProductionSkillStepRegistry>['stepAdapters']['compliance_audit']>[0]['operation'],
  signal: AbortSignal,
) {
  return {
    actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
    definition: {
      id: request.skillId, version: 1, name: 'Compliance', category: 'commerce', description: '',
      systemPrompt: '', allowedSurfaces: ['canvas' as const], inputs: [], steps: [],
      enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
    },
    step: {
      id: 'audit:a', label: 'Audit 1', toolId: 'compliance_audit', execution: 'parallel' as const,
      parallelGroup: 'audit', promptTemplate: '', modelRole: 'vision' as const, qualityGateIds: [],
      compiledFanOut: { inputKey: 'sourceImages', itemIndex: 0, itemDigest: 'aaaaaaaaaaaaaaaa' },
    },
    inputValues: request.inputValues,
    modelBinding: { providerId: 'frozen-vision', modelId: 'vision-model' },
    requestDigest: 'request-digest', operation, signal,
  };
}

describe('platform compliance report execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiProviders.mockResolvedValue([{
      id: 'frozen-vision', name: 'Frozen Vision', baseUrl: 'https://vision.example/v1',
      apiKey: 'test-key', isEnabled: true, type: 'vlm', createdAt: 1, updatedAt: 1,
    }, {
      id: 'fallback-vision', name: 'Fallback Vision', baseUrl: 'https://fallback.example/v1',
      apiKey: 'fallback-key', isEnabled: true, type: 'vlm', createdAt: 1, updatedAt: 1,
    }]);
  });

  it('builds a canonical partial report with technical checks and unknown vision checks', async () => {
    const facts = await auditComplianceMedia({
      imageInput: imageDataUrl, signal: new AbortController().signal,
    });
    const technicalChecks = evaluateTechnicalRules(facts, ruleSet.rules);
    const report = buildComplianceReport({
      reportId: 'report-partial', runId: 'run-1', generatedAt: '2026-09-08T00:00:00.000Z',
      sourceVersionId: 'asset-version-1', sourceDigest: 'a'.repeat(64), ruleSet,
      technicalChecks,
      visionModel: { providerId: 'frozen-vision', modelId: 'vision-model' },
      visionError: {
        code: 'COMPLIANCE_VISION_RATE_LIMITED', message: 'Vision provider rate limited the request',
        retryable: true, providerId: 'frozen-vision', modelId: 'vision-model',
        requestId: 'provider-request-1',
      },
    });

    expect(report.checks.filter(check => check.evaluator !== 'vision')).toEqual(technicalChecks);
    expect(report.checks.filter(check => check.evaluator === 'vision'))
      .toHaveLength(ruleSet.rules.filter(rule => rule.evaluator === 'vision').length);
    expect(report.checks.filter(check => check.evaluator === 'vision')
      .every(check => check.status === 'unknown')).toBe(true);
    expect(report).toMatchObject({
      verdict: 'unknown', manualReviewRequired: true,
      visionModel: { providerId: 'frozen-vision', modelId: 'vision-model' },
      technicalErrors: [expect.objectContaining({
        providerId: 'frozen-vision', modelId: 'vision-model', requestId: 'provider-request-1',
        retryable: true,
      })],
    });
  });

  it('uses compiledFanOut itemIndex and authorized media before recording the partial report', async () => {
    mocks.fetchWithV1Retry.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ checks: successfulVisionChecks() }) } }],
    }), { status: 200, headers: { 'x-request-id': 'provider-request-2' } }));
    const persistCompliancePartialReport = vi.fn<(
      input: PersistCompliancePartialReportInput,
    ) => Promise<void>>(async () => undefined);
    const request = {
      skillId: 'preset-platform-compliance-audit', skillVersion: 1, surface: 'canvas' as const,
      projectId: 'project-1', workspaceId: 'canvas-1',
      inputValues: {
        sourceImages: ['asset-version-a', 'asset-version-b'],
        platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
      },
      sourceVersionIds: ['asset-version-a', 'asset-version-b'],
      modelBindings: { vision: { providerId: 'frozen-vision', modelId: 'vision-model' } },
      idempotencyKey: 'run-key',
    };
    const operation = {
      idempotencyKey: 'provider-idempotency', operationKey: 'operation-1', recovery: false,
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
      beginSubmission: vi.fn(async () => undefined),
      recordAccepted: vi.fn(async () => undefined),
      recordLocalAccepted: vi.fn(async () => undefined),
      executeOperation: vi.fn(),
    };
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request,
      mediaByVersionId: {
        'asset-version-a': 'data:image/png;base64,client-must-not-win',
        'asset-version-b': imageDataUrl,
      },
      persistCompliancePartialReport,
    });

    const result = await registry.stepAdapters.compliance_audit({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      definition: {
        id: request.skillId, version: 1, name: 'Compliance', category: 'commerce', description: '',
        systemPrompt: '', allowedSurfaces: ['canvas'], inputs: [], steps: [],
        enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
      },
      step: {
        id: 'audit:b', label: 'Audit 2', toolId: 'compliance_audit', execution: 'parallel',
        parallelGroup: 'audit', promptTemplate: '', modelRole: 'vision', qualityGateIds: [],
        compiledFanOut: { inputKey: 'sourceImages', itemIndex: 1, itemDigest: 'bbbbbbbbbbbbbbbb' },
      },
      inputValues: request.inputValues,
      modelBinding: { providerId: 'frozen-vision', modelId: 'vision-model' },
      requestDigest: 'request-digest', operation,
      signal: new AbortController().signal,
    });

    expect(persistCompliancePartialReport).toHaveBeenCalledTimes(1);
    expect(persistCompliancePartialReport.mock.calls[0]?.[0]).toMatchObject({
      sourceVersionId: 'asset-version-b', phase: 'technical',
    });
    expect(operation.beginSubmission).toHaveBeenCalledTimes(1);
    expect(persistCompliancePartialReport.mock.invocationCallOrder[0])
      .toBeLessThan(operation.beginSubmission.mock.invocationCallOrder[0]);
    expect(mocks.fetchWithV1Retry).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWithV1Retry.mock.calls[0]?.[0]).toBe('https://vision.example/v1');
    expect(String(mocks.fetchWithV1Retry.mock.calls[0]?.[2]?.body)).toContain(imageDataUrl);
    expect(String(mocks.fetchWithV1Retry.mock.calls[0]?.[2]?.body)).not.toContain('client-must-not-win');
    expect(result.structured).toMatchObject({ schemaId: 'platform-compliance-report-v1' });
  });

  it('keeps the partial report and exact retryable identity when vision fails', async () => {
    mocks.fetchWithV1Retry.mockResolvedValue(new Response('{}', {
      status: 429, headers: { 'x-request-id': 'rate-request-1' },
    }));
    const persisted = vi.fn<(
      input: PersistCompliancePartialReportInput,
    ) => Promise<void>>(async () => undefined);
    const request = {
      skillId: 'preset-platform-compliance-audit', skillVersion: 1, surface: 'canvas' as const,
      projectId: 'project-1', workspaceId: 'canvas-1',
      inputValues: {
        sourceImages: ['asset-version-a'],
        platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
      },
      sourceVersionIds: ['asset-version-a'], modelBindings: {}, idempotencyKey: 'run-key',
    };
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: persisted,
    });

    let error: unknown;
    try {
      await registry.stepAdapters.compliance_audit({
        actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
        definition: {
          id: request.skillId, version: 1, name: 'Compliance', category: 'commerce', description: '',
          systemPrompt: '', allowedSurfaces: ['canvas'], inputs: [], steps: [],
          enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
        },
        step: {
          id: 'audit:a', label: 'Audit 1', toolId: 'compliance_audit', execution: 'parallel',
          parallelGroup: 'audit', promptTemplate: '', modelRole: 'vision', qualityGateIds: [],
          compiledFanOut: { inputKey: 'sourceImages', itemIndex: 0, itemDigest: 'aaaaaaaaaaaaaaaa' },
        },
        inputValues: request.inputValues,
        modelBinding: { providerId: 'frozen-vision', modelId: 'vision-model' },
        requestDigest: 'request-digest',
        operation: {
          idempotencyKey: 'provider-idempotency', operationKey: 'operation-1', recovery: false,
          executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
          beginSubmission: vi.fn(async () => undefined), recordAccepted: vi.fn(async () => undefined),
          recordLocalAccepted: vi.fn(async () => undefined), executeOperation: vi.fn(),
        },
        signal: new AbortController().signal,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: 'COMPLIANCE_AUDIT_VISION_FAILED', retryable: true,
      providerId: 'frozen-vision', modelId: 'vision-model', requestId: 'rate-request-1',
      partialReport: expect.objectContaining({
        technicalErrors: [expect.objectContaining({ retryable: true })],
      }),
    });
    expect(persisted).toHaveBeenCalledTimes(2);
    expect(persisted.mock.calls[1]?.[0]).toMatchObject({ phase: 'vision-error' });
    const failedReport = persisted.mock.calls[1]?.[0].report;
    expect(failedReport.checks.filter((check: { evaluator: string }) => check.evaluator === 'vision')
      .every((check: { status: string }) => check.status === 'unknown')).toBe(true);
    expect(mocks.fetchWithV1Retry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['HTTP 401', () => new Response('{}', { status: 401, headers: { 'x-request-id': 'request-401' } }), false, 401],
    ['HTTP 429', () => new Response('{}', { status: 429, headers: { 'x-request-id': 'request-429' } }), true, 429],
    ['HTTP 500', () => new Response('{}', { status: 500, headers: { 'x-request-id': 'request-500' } }), true, 500],
    ['invalid JSON', () => new Response('{broken', { status: 200 }), true, undefined],
  ])('keeps %s as a known failure through the durable operation', async (
    _name, makeResponse, retryable, providerStatus,
  ) => {
    mocks.fetchWithV1Retry.mockImplementation(async () => makeResponse());
    const dependencies = durableDependencies();
    const persisted = vi.fn<(input: PersistCompliancePartialReportInput) => Promise<void>>(
      async () => undefined,
    );
    const request = complianceRequest();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: persisted,
    });

    let error: unknown;
    try {
      await executeDurableAgentDownstreamOperation({
        actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
        toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
        executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
      }, operation => registry.stepAdapters.compliance_audit(
        complianceStepInput(request, operation, new AbortController().signal),
      ), dependencies);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: 'COMPLIANCE_AUDIT_VISION_FAILED', retryable,
      providerId: 'frozen-vision', modelId: 'vision-model',
      ...(providerStatus === undefined ? {} : { providerStatus }),
    });
    expect(dependencies.markSubmissionUnknown).not.toHaveBeenCalled();
    expect(dependencies.release).toHaveBeenCalledTimes(1);
    expect(dependencies.release).toHaveBeenCalledWith(
      expect.any(Object), { knownSubmissionOutcome: true },
    );
    mocks.fetchWithV1Retry.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ checks: successfulVisionChecks() }) } }],
    })));
    await expect(executeDurableAgentDownstreamOperation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    }, operation => registry.stepAdapters.compliance_audit(
      complianceStepInput(request, operation, new AbortController().signal),
    ), dependencies)).resolves.toMatchObject({
      structured: { schemaId: 'platform-compliance-report-v1' },
    });
    expect(mocks.fetchWithV1Retry).toHaveBeenCalledTimes(2);
  });

  it('keeps caller abort classified as cancellation through the durable operation', async () => {
    const controller = new AbortController();
    mocks.fetchWithV1Retry.mockImplementation(async () => {
      controller.abort(new DOMException('cancelled by user', 'AbortError'));
      throw controller.signal.reason;
    });
    const dependencies = durableDependencies();
    const persisted = vi.fn<(input: PersistCompliancePartialReportInput) => Promise<void>>(
      async () => undefined,
    );
    const request = complianceRequest();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: persisted,
    });

    let error: unknown;
    try {
      await executeDurableAgentDownstreamOperation({
        actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
        toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
        executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
      }, operation => registry.stepAdapters.compliance_audit(
        complianceStepInput(request, operation, controller.signal),
      ), dependencies);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: 'COMPLIANCE_AUDIT_VISION_FAILED', retryable: false });
    expect(persisted.mock.calls[1]?.[0].report.technicalErrors[0]).toMatchObject({
      code: 'COMPLIANCE_VISION_CANCELLED', retryable: false,
    });
    expect(dependencies.markSubmissionUnknown).not.toHaveBeenCalled();
    expect(dependencies.release).toHaveBeenCalledTimes(1);
  });

  it('marks only transport response loss as submission_unknown without replay', async () => {
    mocks.fetchWithV1Retry.mockRejectedValue(new TypeError('socket closed'));
    const dependencies = durableDependencies();
    const request = complianceRequest();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: vi.fn(async () => undefined),
    });

    const durableInput = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    };
    const execute = () => executeDurableAgentDownstreamOperation(durableInput, operation => (
      registry.stepAdapters.compliance_audit(
      complianceStepInput(request, operation, new AbortController().signal),
      )
    ), dependencies);

    await expect(execute()).rejects.toMatchObject({ code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN' });
    await expect(execute()).rejects.toMatchObject({ code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN' });

    expect(dependencies.markSubmissionUnknown).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWithV1Retry).toHaveBeenCalledTimes(1);
  });

  it('marks response body transport loss as submission_unknown without replay', async () => {
    mocks.fetchWithV1Retry.mockImplementation(async () => {
      let sentHeaders = false;
      return new Response(new ReadableStream<Uint8Array>({
        pull(stream) {
          if (!sentHeaders) {
            sentHeaders = true;
            stream.enqueue(new TextEncoder().encode('{"choices":'));
            return;
          }
          stream.error(new TypeError('socket reset during body'));
        },
      }), { headers: { 'x-request-id': 'body-loss-request-1' } });
    });
    const dependencies = durableDependencies();
    const request = complianceRequest();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: vi.fn(async () => undefined),
    });
    const durableInput = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    };
    const execute = () => executeDurableAgentDownstreamOperation(durableInput, operation => (
      registry.stepAdapters.compliance_audit(
        complianceStepInput(request, operation, new AbortController().signal),
      )
    ), dependencies);

    await expect(execute()).rejects.toMatchObject({
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN',
      requestId: 'body-loss-request-1',
      retryable: false,
    });
    await expect(execute()).rejects.toMatchObject({ code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN' });
    expect(dependencies.markSubmissionUnknown).toHaveBeenCalledTimes(1);
    expect(dependencies.release).not.toHaveBeenCalled();
    expect(mocks.fetchWithV1Retry).toHaveBeenCalledTimes(1);
  });

  it('keeps oversized model strings known and permits a corrected durable retry', async () => {
    const oversizedChecks: Record<string, unknown>[] = successfulVisionChecks();
    oversizedChecks[0] = { ...oversizedChecks[0], evidence: ['x'.repeat(16_385)] };
    mocks.fetchWithV1Retry.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ checks: oversizedChecks }) } }],
    }), { headers: { 'x-request-id': 'oversized-string-request-1' } }));
    const dependencies = durableDependencies();
    const persisted = vi.fn<(input: PersistCompliancePartialReportInput) => Promise<void>>(
      async () => undefined,
    );
    const request = complianceRequest();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: persisted,
    });
    const durableInput = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    };
    const execute = () => executeDurableAgentDownstreamOperation(durableInput, operation => (
      registry.stepAdapters.compliance_audit(
        complianceStepInput(request, operation, new AbortController().signal),
      )
    ), dependencies);

    await expect(execute()).rejects.toMatchObject({
      code: 'COMPLIANCE_AUDIT_VISION_FAILED',
      submissionOutcome: 'known',
      retryable: true,
      partialReport: expect.objectContaining({
        technicalErrors: [expect.objectContaining({
          code: 'COMPLIANCE_VISION_RESPONSE_INVALID',
          requestId: 'oversized-string-request-1',
        })],
      }),
    });
    expect(dependencies.markSubmissionUnknown).not.toHaveBeenCalled();
    expect(dependencies.release).toHaveBeenCalledWith(
      expect.any(Object), { knownSubmissionOutcome: true },
    );

    mocks.fetchWithV1Retry.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ checks: successfulVisionChecks() }) } }],
    })));
    await expect(execute()).resolves.toMatchObject({
      structured: { schemaId: 'platform-compliance-report-v1' },
    });
    expect(mocks.fetchWithV1Retry).toHaveBeenCalledTimes(2);
  });

  it('keeps a post-fetch caller abort cancelled through the durable operation', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    mocks.fetchWithV1Retry.mockImplementation(async () => {
      const body = new ReadableStream<Uint8Array>({ pull() {}, cancel });
      controller.abort(new DOMException('cancelled by user', 'AbortError'));
      return new Response(body, {
        status: 429,
        headers: { 'x-request-id': 'provider-request-429' },
      });
    });
    const dependencies = durableDependencies();
    const persisted = vi.fn<(input: PersistCompliancePartialReportInput) => Promise<void>>(
      async () => undefined,
    );
    const request = complianceRequest();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: persisted,
    });

    await expect(executeDurableAgentDownstreamOperation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    }, operation => registry.stepAdapters.compliance_audit(
      complianceStepInput(request, operation, controller.signal),
    ), dependencies)).rejects.toMatchObject({
      code: 'COMPLIANCE_AUDIT_VISION_FAILED',
      submissionOutcome: 'known',
      retryable: false,
      partialReport: expect.objectContaining({
        technicalErrors: [expect.objectContaining({
          code: 'COMPLIANCE_VISION_CANCELLED',
          requestId: expect.stringMatching(/^agent-provider:[a-f0-9]{64}$/u),
        })],
      }),
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(dependencies.markSubmissionUnknown).not.toHaveBeenCalled();
    expect(dependencies.release).toHaveBeenCalledWith(
      expect.any(Object), { knownSubmissionOutcome: true },
    );
  });

  it('binds vision to the inspected bytes when the authorized URL content changes', async () => {
    const uploads = resolve(process.cwd(), 'public/uploads');
    const name = `compliance-byte-binding-${process.pid}-${Date.now()}.png`;
    const path = resolve(uploads, name);
    const replacement = readFileSync(resolve(
      process.cwd(), 'src/__tests__/fixtures/platform-compliance/amazon-main-alpha.png',
    ));
    await mkdir(uploads, { recursive: true });
    await writeFile(path, image);
    mocks.fetchWithV1Retry.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ checks: successfulVisionChecks() }) } }],
    })));
    const persisted = vi.fn<(input: PersistCompliancePartialReportInput) => Promise<void>>(
      async input => {
        expect(JSON.stringify(input.report)).not.toContain(image.toString('base64'));
        if (input.phase === 'technical') await writeFile(path, replacement);
      },
    );
    const request = complianceRequest();
    const mutableUrl = `/uploads/${name}`;
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': mutableUrl },
      persistCompliancePartialReport: persisted,
    });

    try {
      const result = await registry.stepAdapters.compliance_audit(complianceStepInput(
        request,
        {
          idempotencyKey: 'provider-idempotency', operationKey: 'operation-1', recovery: false,
          executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
          beginSubmission: vi.fn(async () => undefined), recordAccepted: vi.fn(async () => undefined),
          recordLocalAccepted: vi.fn(async () => undefined), executeOperation: vi.fn(),
        },
        new AbortController().signal,
      ));
      const body = String(mocks.fetchWithV1Retry.mock.calls[0]?.[2]?.body);
      expect(body).toContain(`data:image/png;base64,${image.toString('base64')}`);
      expect(body).not.toContain(mutableUrl);
      expect(body).not.toContain(replacement.toString('base64'));
      expect(result.structured?.value).toMatchObject({
        sourceDigest: createHash('sha256').update(image).digest('hex'),
      });
    } finally {
      await unlink(path);
    }
  });

  it('keeps a known provider failure known when the vision-error report cannot persist', async () => {
    mocks.fetchWithV1Retry.mockResolvedValue(new Response('{}', {
      status: 429, headers: { 'x-request-id': 'persist-request-429' },
    }));
    const dependencies = durableDependencies();
    const persisted = vi.fn<(input: PersistCompliancePartialReportInput) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('event storage unavailable'));
    const request = complianceRequest();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: persisted,
    });

    let error: unknown;
    try {
      await executeDurableAgentDownstreamOperation({
        actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
        toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
        executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
      }, operation => registry.stepAdapters.compliance_audit(
        complianceStepInput(request, operation, new AbortController().signal),
      ), dependencies);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: 'COMPLIANCE_AUDIT_VISION_FAILED', submissionOutcome: 'known',
      providerId: 'frozen-vision', modelId: 'vision-model', requestId: 'persist-request-429',
      providerStatus: 429, retryable: true, persistenceFailed: true,
      partialReport: expect.objectContaining({
        technicalErrors: expect.arrayContaining([
          expect.objectContaining({ code: 'COMPLIANCE_VISION_RATE_LIMITED' }),
          expect.objectContaining({ code: 'COMPLIANCE_PARTIAL_REPORT_PERSIST_FAILED' }),
        ]),
      }),
    });
    expect(dependencies.markSubmissionUnknown).not.toHaveBeenCalled();
    expect(dependencies.release).toHaveBeenCalledWith(
      expect.any(Object), { knownSubmissionOutcome: true },
    );
  });

  it('keeps transport response loss unknown when its partial report cannot persist', async () => {
    mocks.fetchWithV1Retry.mockRejectedValue(new TypeError('socket closed'));
    const dependencies = durableDependencies();
    const persisted = vi.fn<(input: PersistCompliancePartialReportInput) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('event storage unavailable'));
    const request = complianceRequest();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: persisted,
    });

    await expect(executeDurableAgentDownstreamOperation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    }, operation => registry.stepAdapters.compliance_audit(
      complianceStepInput(request, operation, new AbortController().signal),
    ), dependencies)).rejects.toMatchObject({
      code: 'AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN', persistenceFailed: true,
      providerId: 'frozen-vision', modelId: 'vision-model',
    });
    expect(dependencies.markSubmissionUnknown).toHaveBeenCalledTimes(1);
    expect(dependencies.release).not.toHaveBeenCalled();
  });
});
