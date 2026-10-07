import { readFileSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceReadableAssetReference } from '@/lib/asset-core/types';
import type { SkillDocumentAssetScopeInput } from '@/lib/skill-runtime/document-assets';

const mocks = vi.hoisted(() => ({
  fetchWithV1Retry: vi.fn(),
  getApiProviders: vi.fn(),
  persistComplianceReportAsset: vi.fn(),
  appendAdoptedAgentEvent: vi.fn(),
  createSkillDocumentAssetScope: vi.fn<typeof import('@/lib/skill-runtime/document-assets').createSkillDocumentAssetScope>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({
  getPool: () => { throw new Error('Unexpected compliance unit database access'); },
}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: mocks.fetchWithV1Retry }));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: mocks.getApiProviders }));
vi.mock('@/lib/skill-runtime/document-assets', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/skill-runtime/document-assets')>(),
  createSkillDocumentAssetScope: mocks.createSkillDocumentAssetScope,
}));
vi.mock('@/lib/agent-runtime/event-storage', () => ({
  appendAdoptedAgentEvent: mocks.appendAdoptedAgentEvent,
}));
vi.mock('@/lib/platform-compliance/report-asset', () => ({
  persistComplianceReportAsset: mocks.persistComplianceReportAsset,
  complianceReportFromAssetVersion: (version: { metadata?: { reportContent?: string } }) => (
    JSON.parse(version.metadata?.reportContent || '{}') as unknown
  ),
}));

import { auditComplianceMedia } from '@/lib/platform-compliance/media-audit';
import { buildComplianceReport } from '@/lib/platform-compliance/report-builder';
import { canonicalComplianceReportJson } from '@/lib/platform-compliance/report-schema';
import { resolveComplianceRuleSet } from '@/lib/platform-compliance/rules';
import { evaluateTechnicalRules } from '@/lib/platform-compliance/technical-evaluator';
import { SkillAssetScopeError } from '@/lib/skill-runtime/document-assets';
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
type ComplianceAssetScope = Awaited<ReturnType<typeof import('@/lib/skill-runtime/document-assets').createSkillDocumentAssetScope>>;
const authorizedReferences = new Map<string, WorkspaceReadableAssetReference>();

// This unit replaces the DB-backed scope boundary, not the production adapter.
// Only these sealed test identities are authorized; unused storage/writes fail closed.
async function authorizedComplianceScope(input: SkillDocumentAssetScopeInput): Promise<ComplianceAssetScope> {
  const permittedOperation = (input.operationKey === 'operation-1'
    && input.operationIdempotencyKey === 'provider-idempotency')
    || (input.operationKey === 'agent-op:3286ea5e0f58339cfcd61dd4cf6c0171e0505eb7e7def5d9c56e9c7fa28b0baf'
      && input.operationIdempotencyKey === 'agent-provider:3286ea5e0f58339cfcd61dd4cf6c0171e0505eb7e7def5d9c56e9c7fa28b0baf');
  const permittedSources = input.stepId === 'audit:a'
    ? input.sourceVersionIds.length === 1 && input.sourceVersionIds[0] === 'asset-version-a'
    : input.stepId === 'audit:b' && input.sourceVersionIds.length === 2
      && input.sourceVersionIds[0] === 'asset-version-a' && input.sourceVersionIds[1] === 'asset-version-b';
  if (input.actorUserId !== 'user-1' || input.projectId !== 'project-1' || input.runId !== 'run-1'
    || input.toolId !== 'compliance_audit' || input.requestDigest !== 'request-digest'
    || input.executionFence?.runId !== 'run-1' || input.executionFence.leaseOwner !== 'lease-1'
    || input.executionFence.generation !== 1 || !permittedOperation || !permittedSources
    || !(input.signal instanceof AbortSignal)) throw new SkillAssetScopeError();
  input.signal.throwIfAborted();
  const unsupported = async (): Promise<never> => { throw new Error('Unexpected compliance unit asset storage/write'); };
  return {
    assetService: {
      resolveAssetReference: async value => {
        const reference = authorizedReferences.get(value.assetVersionId);
        if (value.actorUserId !== 'user-1' || value.projectId !== 'project-1'
          || !input.sourceVersionIds.includes(value.assetVersionId) || !reference) throw new SkillAssetScopeError();
        return { ...reference };
      },
      createAssetVersion: unsupported,
      createAssetVersionsAtomically: unsupported,
      findAssetVersionByIdempotency: unsupported,
    },
    storage: { read: unsupported, transaction: unsupported },
    readExportSources: unsupported,
    persistExportImage: unsupported,
    loadPersistedExportImages: unsupported,
    persistExportArtifacts: unsupported,
  };
}
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
  const operations = new Map<string, AgentDownstreamOperation>();
  const dependencies: AgentDownstreamOperationDependencies = {
    prepare: vi.fn(async identity => {
      const current = operations.get(identity.operationKey);
      const operation = current
        ? { ...current, ...identity, attempts: current.attempts + 1, claimed: true }
        : { ...identity, status: 'prepared', attempts: 1, claimed: true };
      operations.set(identity.operationKey, operation as AgentDownstreamOperation);
      return operation as AgentDownstreamOperation;
    }),
    markSubmitted: vi.fn(async identity => {
      const operation = { ...operations.get(identity.operationKey)!, ...identity, status: 'submitted' };
      operations.set(identity.operationKey, operation as AgentDownstreamOperation);
      return operation as AgentDownstreamOperation;
    }),
    markAccepted: vi.fn(async identity => {
      const operation = { ...operations.get(identity.operationKey)!, ...identity, status: 'accepted' };
      operations.set(identity.operationKey, operation as AgentDownstreamOperation);
      return operation as AgentDownstreamOperation;
    }),
    markSubmissionUnknown: vi.fn(async identity => {
      const operation = { ...operations.get(identity.operationKey)!, ...identity, status: 'submission_unknown' };
      operations.set(identity.operationKey, operation as AgentDownstreamOperation);
      return operation as AgentDownstreamOperation;
    }),
    complete: vi.fn(async identity => {
      const operation = { ...operations.get(identity.operationKey)!, ...identity, status: 'completed' };
      operations.set(identity.operationKey, operation as AgentDownstreamOperation);
      return operation as AgentDownstreamOperation;
    }),
    release: vi.fn(async (identity, options) => {
      const operation = operations.get(identity.operationKey);
      if (operation && (operation.status !== 'submission_unknown')) {
        operations.set(identity.operationKey, {
          ...operation,
          ...(operation.status === 'submitted' && options?.knownSubmissionOutcome
            ? { status: 'prepared' as const }
            : {}),
          claimed: false,
        });
      }
      return true;
    }),
    read: vi.fn(async identity => operations.get(identity.operationKey) ?? null),
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
      productFacts: '材质为食品级不锈钢', claims: '宣称通过 FDA 认证', reportLanguage: '中文',
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

function immediateOperationContext(idempotencyKey = 'provider-idempotency') {
  const beginSubmission = vi.fn(async () => undefined);
  const operation = {
    idempotencyKey,
    operationKey: 'operation-1',
    recovery: false,
    executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    beginSubmission,
    recordAccepted: vi.fn(async () => undefined),
    recordLocalAccepted: vi.fn(async () => undefined),
    executeOperation: vi.fn(),
  } as Parameters<ReturnType<typeof createProductionSkillStepRegistry>['stepAdapters']['compliance_audit']>[0]['operation'];
  operation.executeOperation = vi.fn(async (_input, execute) => execute(operation));
  return operation;
}

describe('platform compliance report execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizedReferences.clear();
    for (const [versionId, assetId] of [['asset-version-a', 'asset-a'], ['asset-version-b', 'asset-b']]) {
      authorizedReferences.set(versionId, {
        assetId, assetVersionId: versionId, kind: 'image', url: imageDataUrl,
        mimeType: 'image/png', byteSize: image.length,
        checksum: createHash('sha256').update(image).digest('hex'),
      });
    }
    mocks.createSkillDocumentAssetScope.mockImplementation(authorizedComplianceScope);
    mocks.persistComplianceReportAsset.mockImplementation(async input => {
      const reportContent = canonicalComplianceReportJson(input.report);
      return {
        id: 'report-version-1', parentVersionIds: [],
        file: {
          availability: 'ready', mimeType: 'application/json',
          byteSize: Buffer.byteLength(reportContent),
          checksum: createHash('sha256').update(reportContent).digest('hex'),
        },
        metadata: { schemaId: 'platform-compliance-report-v1', reportContent },
      };
    });
    mocks.appendAdoptedAgentEvent.mockResolvedValue(undefined);
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
        productFacts: '材质为食品级不锈钢', claims: '宣称通过 FDA 认证', reportLanguage: '中文',
      },
      sourceVersionIds: ['asset-version-a', 'asset-version-b'],
      modelBindings: { vision: { providerId: 'frozen-vision', modelId: 'vision-model' } },
      idempotencyKey: 'run-key',
    };
    const operation = immediateOperationContext();
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
    expect(vi.mocked(operation.beginSubmission)).toHaveBeenCalledTimes(1);
    expect(persistCompliancePartialReport.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(operation.beginSubmission).mock.invocationCallOrder[0]);
    expect(mocks.fetchWithV1Retry).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWithV1Retry.mock.calls[0]?.[0]).toBe('https://vision.example/v1');
    expect(String(mocks.fetchWithV1Retry.mock.calls[0]?.[2]?.body)).toContain(imageDataUrl);
    expect(String(mocks.fetchWithV1Retry.mock.calls[0]?.[2]?.body)).toContain('材质为食品级不锈钢');
    expect(String(mocks.fetchWithV1Retry.mock.calls[0]?.[2]?.body)).toContain('宣称通过 FDA 认证');
    expect(String(mocks.fetchWithV1Retry.mock.calls[0]?.[2]?.body)).toContain('中文');
    expect(String(mocks.fetchWithV1Retry.mock.calls[0]?.[2]?.body)).not.toContain('client-must-not-win');
    expect(mocks.persistComplianceReportAsset).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', stepId: 'audit:b',
      sourceVersionIds: ['asset-version-b'], requestDigest: 'request-digest',
      idempotencyKey: 'provider-idempotency:report-asset:completed',
      sourceTrace: expect.objectContaining({
        source: 'canvas-skill', runId: 'run-1', sourceVersionIds: ['asset-version-b'],
      }),
    }));
    expect(result.assetVersionIds).toEqual(['report-version-1']);
    expect(result.structured).toMatchObject({ schemaId: 'platform-compliance-report-v1' });
    expect(mocks.createSkillDocumentAssetScope).toHaveBeenCalledWith({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', stepId: 'audit:b',
      requestDigest: 'request-digest', sourceVersionIds: ['asset-version-a', 'asset-version-b'],
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
      toolId: 'compliance_audit', operationKey: 'operation-1',
      operationIdempotencyKey: 'provider-idempotency', signal: expect.any(AbortSignal),
    });
  });

  it('rejects a denied asset scope before provider, report or event effects', async () => {
    const denied = new SkillAssetScopeError();
    mocks.createSkillDocumentAssetScope.mockRejectedValueOnce(denied);
    const request = complianceRequest();
    const persisted = vi.fn<(input: PersistCompliancePartialReportInput) => Promise<void>>();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: persisted,
    });
    await expect(registry.stepAdapters.compliance_audit(complianceStepInput(
      request, immediateOperationContext(), new AbortController().signal,
    ))).rejects.toBe(denied);
    expect(mocks.getApiProviders).not.toHaveBeenCalled();
    expect(mocks.fetchWithV1Retry).not.toHaveBeenCalled();
    expect(persisted).not.toHaveBeenCalled();
    expect(mocks.persistComplianceReportAsset).not.toHaveBeenCalled();
    expect(mocks.appendAdoptedAgentEvent).not.toHaveBeenCalled();
  });

  it('rejects mismatched authorized reference media before provider or persistence', async () => {
    // Independently sealed source remains the PNG; the registry's media is different.
    const request = complianceRequest();
    const persisted = vi.fn<(input: PersistCompliancePartialReportInput) => Promise<void>>();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': 'data:image/png;base64,client-must-not-win' },
      persistCompliancePartialReport: persisted,
    });
    await expect(registry.stepAdapters.compliance_audit(complianceStepInput(
      request, immediateOperationContext(), new AbortController().signal,
    ))).rejects.toThrow('Skill compliance source identity changed');
    expect(mocks.getApiProviders).not.toHaveBeenCalled();
    expect(mocks.fetchWithV1Retry).not.toHaveBeenCalled();
    expect(persisted).not.toHaveBeenCalled();
    expect(mocks.persistComplianceReportAsset).not.toHaveBeenCalled();
    expect(mocks.appendAdoptedAgentEvent).not.toHaveBeenCalled();
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
        operation: immediateOperationContext(),
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
    expect(dependencies.release).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'audit:a:vision' }), { knownSubmissionOutcome: true },
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
    expect(dependencies.release).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'audit:a:vision' }), { knownSubmissionOutcome: true },
    );
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
    expect(dependencies.release).not.toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'audit:a:vision' }), expect.anything(),
    );
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

  it('preserves caller cancellation during HTTP response cleanup through durable execution', async () => {
    const controller = new AbortController();
    let markCleanupStarted!: () => void;
    let finishCleanup!: () => void;
    const cleanupStarted = new Promise<void>(resolve => { markCleanupStarted = resolve; });
    const cleanupPending = new Promise<void>(resolve => { finishCleanup = resolve; });
    const cancel = vi.fn(async () => {
      markCleanupStarted();
      await cleanupPending;
    });
    mocks.fetchWithV1Retry.mockImplementation(async () => new Response(
      new ReadableStream<Uint8Array>({ pull() {}, cancel }),
      { status: 429, headers: { 'x-request-id': 'provider-request-429' } },
    ));
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

    const execution = executeDurableAgentDownstreamOperation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    }, operation => registry.stepAdapters.compliance_audit(
      complianceStepInput(request, operation, controller.signal),
    ), dependencies);
    // Observe rejection immediately. A pre-cleanup failure must reject this wait,
    // not leave cleanupStarted pending and turn the original error into unhandled.
    const outcome = execution.then(
      value => ({ kind: 'resolved' as const, value }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    try {
      await Promise.race([cleanupStarted, outcome.then(result => {
        if (result.kind === 'rejected') throw result.error;
        throw new Error('Compliance execution completed before response cleanup');
      })]);
      controller.abort(new DOMException('cancelled during cleanup', 'AbortError'));
      finishCleanup();

      await expect(execution).rejects.toMatchObject({
        code: 'COMPLIANCE_AUDIT_VISION_FAILED',
        submissionOutcome: 'known',
        retryable: false,
        partialReport: expect.objectContaining({
          technicalErrors: [expect.objectContaining({
            code: 'COMPLIANCE_VISION_CANCELLED',
            requestId: 'provider-request-429',
            retryable: false,
          })],
        }),
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(dependencies.markSubmissionUnknown).not.toHaveBeenCalled();
      expect(dependencies.release).toHaveBeenCalledWith(
        expect.any(Object), { knownSubmissionOutcome: true },
      );
    } finally {
      finishCleanup();
      markCleanupStarted();
      await cleanupPending;
      await outcome;
    }
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
    const reference = authorizedReferences.get('asset-version-a')!;
    authorizedReferences.set('asset-version-a', { ...reference, url: mutableUrl });
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': mutableUrl },
      persistCompliancePartialReport: persisted,
    });

    try {
      const result = await registry.stepAdapters.compliance_audit(complianceStepInput(
        request,
        {
          ...immediateOperationContext(),
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
    expect(dependencies.release).not.toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'audit:a:vision' }), expect.anything(),
    );
  });

  it('retries only local report persistence after a paid vision response succeeds', async () => {
    mocks.fetchWithV1Retry.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ checks: successfulVisionChecks() }) } }],
    })));
    let rejectCompletedAssetOnce = true;
    mocks.persistComplianceReportAsset.mockImplementation(async input => {
      const report = input.report as { checks: Array<{ evaluator: string; status: string }> };
      const isCompleted = report.checks
        .filter(check => check.evaluator === 'vision')
        .every(check => check.status === 'passed');
      if (isCompleted && rejectCompletedAssetOnce) {
        rejectCompletedAssetOnce = false;
        throw new Error('asset database temporarily unavailable');
      }
      const reportContent = canonicalComplianceReportJson(input.report);
      return {
        id: isCompleted ? 'completed-report-version' : 'technical-report-version',
        parentVersionIds: [],
        file: {
          availability: 'ready', mimeType: 'application/json',
          byteSize: Buffer.byteLength(reportContent),
          checksum: createHash('sha256').update(reportContent).digest('hex'),
        },
        metadata: { schemaId: 'platform-compliance-report-v1', reportContent },
      };
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
    const execute = () => executeDurableAgentDownstreamOperation(
      durableInput,
      operation => registry.stepAdapters.compliance_audit(
        complianceStepInput(request, operation, new AbortController().signal),
      ),
      dependencies,
    );

    await expect(execute()).rejects.toThrow('asset database temporarily unavailable');
    await expect(execute()).resolves.toMatchObject({
      assetVersionIds: ['completed-report-version'],
      structured: { schemaId: 'platform-compliance-report-v1' },
    });
    expect(mocks.fetchWithV1Retry).toHaveBeenCalledTimes(1);
    expect(dependencies.markSubmissionUnknown).not.toHaveBeenCalled();
    expect(mocks.persistComplianceReportAsset).toHaveBeenCalledTimes(2);
    expect(mocks.persistComplianceReportAsset.mock.calls.every(call => (
      String(call[0].idempotencyKey).endsWith(':report-asset:completed')
    ))).toBe(true);
  });

  it('creates an exportable document asset for a provider-unavailable partial report', async () => {
    mocks.getApiProviders.mockResolvedValue([]);
    const dependencies = durableDependencies();
    const request = complianceRequest();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
      persistCompliancePartialReport: vi.fn(async () => undefined),
    });

    await expect(executeDurableAgentDownstreamOperation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    }, operation => registry.stepAdapters.compliance_audit(
      complianceStepInput(request, operation, new AbortController().signal),
    ), dependencies)).rejects.toMatchObject({
      code: 'COMPLIANCE_AUDIT_VISION_FAILED', submissionOutcome: 'known',
    });

    expect(mocks.persistComplianceReportAsset).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', stepId: 'audit:a',
      idempotencyKey: expect.stringContaining(':vision-error'),
      report: expect.objectContaining({
        technicalErrors: [expect.objectContaining({
          code: 'COMPLIANCE_VISION_PROVIDER_UNAVAILABLE',
        })],
      }),
    }));
    expect(mocks.persistComplianceReportAsset).toHaveBeenCalledTimes(1);
  });

  it('publishes the partial report asset event before its progress output', async () => {
    mocks.getApiProviders.mockResolvedValue([]);
    const dependencies = durableDependencies();
    const request = complianceRequest();
    const registry = createProductionSkillStepRegistry({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
      request, mediaByVersionId: { 'asset-version-a': imageDataUrl },
    });

    await expect(executeDurableAgentDownstreamOperation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      toolId: 'compliance_audit', stepId: 'audit:a', requestDigest: 'request-digest',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    }, operation => registry.stepAdapters.compliance_audit(
      complianceStepInput(request, operation, new AbortController().signal),
    ), dependencies)).rejects.toMatchObject({ code: 'COMPLIANCE_AUDIT_VISION_FAILED' });

    const assetEvent = mocks.appendAdoptedAgentEvent.mock.calls.find(call => (
      call[0]?.type === 'asset.created'
    ))?.[0];
    const progressEvent = mocks.appendAdoptedAgentEvent.mock.calls.find(call => (
      call[0]?.type === 'tool.progress' && call[0]?.payload?.phase === 'vision-error'
    ))?.[0];
    expect(assetEvent).toMatchObject({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', workspace: 'canvas',
      type: 'asset.created',
      payload: { stepId: 'audit:a', assetVersionId: 'report-version-1', generation: 1 },
    });
    expect(progressEvent).toMatchObject({
      type: 'tool.progress',
      payload: {
        stepId: 'audit:a', phase: 'vision-error', assetVersionId: 'report-version-1',
      },
    });
    expect(mocks.appendAdoptedAgentEvent.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.appendAdoptedAgentEvent.mock.invocationCallOrder[1]);
  });
});
