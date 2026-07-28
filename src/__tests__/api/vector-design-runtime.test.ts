import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  uploadDir: '',
  fetch: vi.fn(),
  claimVectorDesignTask: vi.fn(),
  chargeCloudTaskCredits: vi.fn(),
  completeCloudTask: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  getRequestUser: vi.fn().mockResolvedValue({
    user: {
      id: 'user-1',
      role: 'admin',
      apiPermissions: { vectorize: true },
      imageModels: [],
    },
  }),
}));

vi.mock('@/lib/server-api-config', () => ({
  findProviderById: vi.fn().mockResolvedValue({
    id: 'provider-1',
    name: 'Recraft',
    displayName: 'Recraft Official',
    baseUrl: 'https://provider.test',
    apiKey: 'secret',
    selectedModels: ['recraftv4_1_vector'],
  }),
}));

vi.mock('@/lib/api-helpers', () => ({
  getInternalApiUrl: vi.fn((value: string) => value),
}));

vi.mock('@/lib/model-defaults', () => ({
  isModelAssignedToUser: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/credits', () => ({
  calculateConfiguredCreditCost: vi.fn().mockResolvedValue(2),
}));

vi.mock('@/lib/server-data-root', () => ({
  getImageWriteDir: vi.fn(() => routeMocks.uploadDir),
}));

vi.mock('@/lib/vector-design-idempotency', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/vector-design-idempotency')>();
  return {
    ...actual,
    createVectorDesignRequestHash: vi.fn().mockReturnValue('request-hash'),
    claimVectorDesignTask: routeMocks.claimVectorDesignTask,
  };
});

vi.mock('@/lib/cloud-task-storage', () => ({
  chargeCloudTaskCredits: routeMocks.chargeCloudTaskCredits,
  completeCloudTask: routeMocks.completeCloudTask,
  getCloudTaskForUser: routeMocks.getCloudTaskForUser,
  terminateCloudTaskAndRefund: routeMocks.terminateCloudTaskAndRefund,
}));

import { POST } from '@/app/api/vector-design/route';

const SVG_ONE = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><path d="M0 0h512v512H0z" fill="#111"/></svg>';
const SVG_TWO = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="180" fill="#d4af37"/></svg>';

function providerResponse(svgValues: string[], status = 200): Response {
  return new Response(JSON.stringify({
    data: svgValues.map(svg => ({ b64_json: Buffer.from(svg).toString('base64') })),
  }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createGenerateRequest(overrides: Record<string, unknown> = {}, idempotencyKey = 'vector-request-0001') {
  return new NextRequest('http://localhost/api/vector-design', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({
      action: 'generate',
      providerId: 'provider-1',
      model: 'recraftv4_1_vector',
      prompt: '几何品牌标志',
      size: '1:1',
      n: 2,
      ...overrides,
    }),
  });
}

function createRequest(body: Record<string, unknown>, idempotencyKey: string) {
  return new NextRequest('http://localhost/api/vector-design', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

describe('vector design route runtime', () => {
  beforeAll(async () => {
    routeMocks.uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wujie-vector-route-'));
  });

  afterAll(async () => {
    await fs.rm(routeMocks.uploadDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', routeMocks.fetch);
    routeMocks.claimVectorDesignTask.mockResolvedValue({ owner: true, taskId: 'vector-task-1' });
    routeMocks.chargeCloudTaskCredits.mockResolvedValue({
      charged: true,
      creditCost: 4,
      userId: 'user-1',
    });
    routeMocks.completeCloudTask.mockResolvedValue(true);
    routeMocks.terminateCloudTaskAndRefund.mockResolvedValue({
      status: 'failed',
      transitioned: true,
      refunded: true,
      creditCost: 4,
    });
    routeMocks.getCloudTaskForUser.mockResolvedValue(null);
    routeMocks.fetch.mockResolvedValue(providerResponse([SVG_ONE, SVG_TWO]));
    await fs.rm(routeMocks.uploadDir, { recursive: true, force: true });
    await fs.mkdir(routeMocks.uploadDir, { recursive: true });
  });

  it('claims one idempotent task, charges once and persists every batch result', async () => {
    const response = await POST(createGenerateRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.assets).toHaveLength(2);
    expect(routeMocks.claimVectorDesignTask).toHaveBeenCalledTimes(1);
    expect(routeMocks.chargeCloudTaskCredits).toHaveBeenCalledTimes(1);
    expect(routeMocks.completeCloudTask).toHaveBeenCalledTimes(1);
    expect(routeMocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
    expect(routeMocks.fetch).toHaveBeenCalledTimes(1);
    const savedFiles = await fs.readdir(routeMocks.uploadDir);
    expect(savedFiles.filter(file => file.endsWith('.svg'))).toHaveLength(2);
    expect(savedFiles.filter(file => file.endsWith('.png'))).toHaveLength(2);

    const completedResult = routeMocks.completeCloudTask.mock.calls[0][1];
    expect(JSON.stringify(completedResult)).not.toContain('"svg":"');
  });

  it('replays a completed idempotent task without calling or charging the provider again', async () => {
    const svgFilename = 'vector-17221212-123e4567-e89b-12d3-a456-426614174000.svg';
    await fs.writeFile(path.join(routeMocks.uploadDir, svgFilename), SVG_ONE);
    routeMocks.claimVectorDesignTask.mockResolvedValue({
      owner: false,
      taskId: 'vector-task-existing',
    });
    routeMocks.getCloudTaskForUser.mockResolvedValue({
      id: 'vector-task-existing',
      userId: 'user-1',
      status: 'completed',
      creditStatus: 'charged',
      result: {
        requestHash: 'request-hash',
        response: {
          success: true,
          assets: [{
            svgUrl: `/api/serve-upload/vector-design/${svgFilename}`,
            previewUrl: '/api/serve-upload/vector-design/vector-preview.png',
            width: 512,
            height: 512,
            pathCount: 1,
            model: 'recraftv4_1_vector',
            providerId: 'provider-1',
            providerName: 'Recraft Official',
            sourceType: 'generate',
          }],
        },
      },
    });

    const response = await POST(createGenerateRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.assets[0].svg).toContain('<svg');
    expect(routeMocks.fetch).not.toHaveBeenCalled();
    expect(routeMocks.chargeCloudTaskCredits).not.toHaveBeenCalled();
  });

  it('retries only a missing provider path and preserves the upstream idempotency key', async () => {
    routeMocks.fetch
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(providerResponse([SVG_ONE, SVG_TWO]));

    const response = await POST(createGenerateRequest());

    expect(response.status).toBe(200);
    expect(routeMocks.fetch).toHaveBeenCalledTimes(2);
    const firstHeaders = new Headers(routeMocks.fetch.mock.calls[0][1]?.headers);
    const secondHeaders = new Headers(routeMocks.fetch.mock.calls[1][1]?.headers);
    expect(firstHeaders.get('idempotency-key')).toBeTruthy();
    expect(secondHeaders.get('idempotency-key')).toBe(firstHeaders.get('idempotency-key'));
  });

  it('atomically fails and refunds when the provider returns fewer assets than requested', async () => {
    routeMocks.fetch.mockResolvedValue(providerResponse([SVG_ONE]));

    const response = await POST(createGenerateRequest());
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.success).toBe(false);
    expect(routeMocks.completeCloudTask).not.toHaveBeenCalled();
    expect(routeMocks.terminateCloudTaskAndRefund).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(routeMocks.uploadDir)).toEqual([]);
  });

  it('requires an idempotency key for every billable action', async () => {
    const request = createGenerateRequest({}, '');
    request.headers.delete('idempotency-key');

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(routeMocks.fetch).not.toHaveBeenCalled();
    expect(routeMocks.chargeCloudTaskCredits).not.toHaveBeenCalled();
  });

  it('accepts a legal large SVG reference without sending unsupported image-to-image size', async () => {
    const referenceSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="3072" height="1536"><rect width="3072" height="1536" fill="#fff"/></svg>';
    routeMocks.fetch.mockResolvedValue(providerResponse([SVG_ONE]));

    const response = await POST(createRequest({
      action: 'image-to-image',
      providerId: 'provider-1',
      model: 'recraftv4_1_vector',
      prompt: '保持构图并转为几何矢量风格',
      imageUrl: `data:image/svg+xml;base64,${Buffer.from(referenceSvg).toString('base64')}`,
      size: '16:9',
      n: 1,
      strength: 0.35,
    }, 'vector-image-to-image-0001'));

    expect(response.status).toBe(200);
    const providerBody = routeMocks.fetch.mock.calls[0][1]?.body;
    expect(providerBody).toBeInstanceOf(FormData);
    expect((providerBody as FormData).has('size')).toBe(false);
  });

  it('sends Explore only the parameters documented for that endpoint', async () => {
    routeMocks.fetch.mockResolvedValue(providerResponse(Array.from({ length: 8 }, () => SVG_ONE)));

    const response = await POST(createRequest({
      action: 'explore',
      providerId: 'provider-1',
      model: 'recraftv4_1_vector',
      prompt: '探索科技品牌图标方向',
      size: '3:2',
      n: 6,
      randomSeed: 42,
      colors: ['#d4af37'],
      backgroundColor: '#ffffff',
    }, 'vector-explore-0001'));

    expect(response.status).toBe(200);
    const providerBody = JSON.parse(String(routeMocks.fetch.mock.calls[0][1]?.body));
    expect(providerBody).toEqual({
      prompt: expect.any(String),
      model: 'recraftv4_1_vector',
      size: '3:2',
      response_format: 'b64_json',
    });
  });

  it('returns a settlement error instead of hiding an unconfirmed refund', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    routeMocks.fetch.mockResolvedValue(providerResponse([SVG_ONE]));
    routeMocks.terminateCloudTaskAndRefund.mockResolvedValue({
      status: 'failed',
      transitioned: true,
      refunded: false,
      creditCost: 4,
    });
    routeMocks.getCloudTaskForUser.mockResolvedValue({
      id: 'vector-task-1',
      userId: 'user-1',
      status: 'failed',
      creditStatus: 'charged',
    });

    const response = await POST(createGenerateRequest());
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.taskId).toBe('vector-task-1');
    expect(data.error).toContain('积分结算状态未确认');
    expect(consoleError).toHaveBeenCalledWith(
      '[vector-design] task settlement failed',
      expect.objectContaining({ taskId: 'vector-task-1' }),
    );
    consoleError.mockRestore();
  });

  it('times out and refunds a stale in-progress duplicate instead of returning 202 forever', async () => {
    routeMocks.claimVectorDesignTask.mockResolvedValue({
      owner: false,
      taskId: 'vector-task-stale',
    });
    routeMocks.getCloudTaskForUser.mockResolvedValue({
      id: 'vector-task-stale',
      userId: 'user-1',
      status: 'processing',
      creditStatus: 'pending',
      creditCost: 4,
      updatedAt: Date.now() - 10 * 60_000,
      result: { requestHash: 'request-hash' },
    });
    routeMocks.terminateCloudTaskAndRefund.mockResolvedValue({
      status: 'timeout',
      transitioned: true,
      refunded: true,
      creditCost: 4,
    });

    const response = await POST(createGenerateRequest());
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data.taskId).toBe('vector-task-stale');
    expect(routeMocks.terminateCloudTaskAndRefund).toHaveBeenCalledWith(
      'vector-task-stale',
      'timeout',
      expect.stringContaining('超时'),
    );
    expect(routeMocks.fetch).not.toHaveBeenCalled();
    expect(routeMocks.chargeCloudTaskCredits).not.toHaveBeenCalled();
  });

  it('executes an AI element replacement through the idempotent paid task path', async () => {
    routeMocks.fetch.mockResolvedValue(providerResponse([SVG_TWO]));

    const response = await POST(createRequest({
      action: 'edit',
      providerId: 'provider-1',
      model: 'recraftv4_1_vector',
      sourceSvg: SVG_ONE,
      selectedElementId: 'vector-element-1',
      targetBox: { x: 0, y: 0, width: 512, height: 512 },
      replacePrompt: '替换成金色圆形徽章',
      size: '1:1',
    }, 'vector-ai-replace-0001'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.asset.svg).toContain('circle');
    expect(routeMocks.claimVectorDesignTask).toHaveBeenCalledTimes(1);
    expect(routeMocks.chargeCloudTaskCredits).toHaveBeenCalledTimes(1);
    expect(routeMocks.completeCloudTask).toHaveBeenCalledTimes(1);
  });

  it('deduplicates prompt enhancement without charging user credits', async () => {
    routeMocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      enhanced_prompt: '几何金色品牌标志，适合小尺寸识别',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await POST(createRequest({
      action: 'enhance-prompt',
      providerId: 'provider-1',
      model: 'recraftv4_1_vector',
      prompt: '品牌标志',
      size: '1:1',
    }, 'vector-enhance-0001'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.enhancedPrompt).toContain('品牌标志');
    expect(routeMocks.claimVectorDesignTask).toHaveBeenCalledTimes(1);
    expect(routeMocks.chargeCloudTaskCredits).toHaveBeenCalledWith(
      'vector-task-1',
      'user-1',
      0,
      'AI 矢量提示词优化',
    );
    expect(routeMocks.completeCloudTask).toHaveBeenCalledTimes(1);
  });
});
