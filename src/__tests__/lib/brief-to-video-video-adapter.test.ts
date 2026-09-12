import { describe, expect, it } from 'vitest';

import {
  buildBriefToVideoVideoSubmission,
  BriefToVideoVideoAdmissionError,
  executeBriefToVideoStep,
  parseFrozenBriefVideoBinding,
  submitBriefToVideoTask,
} from '@/lib/brief-to-video/video-adapter';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

const plan = {
  schemaId: 'brief-to-video-plan-v1' as const,
  title: '新品短片', logline: '展示新品', durationSeconds: 10, aspectRatio: '16:9',
  scenes: [{ order: 1, timeRange: '0-10s', visual: '产品', camera: '推进', action: '旋转' }],
  finalVideoPrompt: '产品在柔和光线中旋转', negativePrompt: '闪烁', factualConstraints: [],
};

const briefInput = {
  brief: '新品广告', goal: '产品转化' as const, audience: '年轻用户', platform: '抖音' as const,
  style: '电影感', durationSeconds: 10, aspectRatio: '16:9', resolution: '1080p',
  generateAudio: false,
};

function descriptor(operations: TaskModelDescriptor['supportedOperations'] = [
  'text-to-video', 'image-to-video', 'first-last-frame',
]): TaskModelDescriptor {
  return {
    providerId: 'pear-video', modelId: 'video-model', kind: 'video', sourceType: 'video',
    protocol: 'video', executionMode: 'async', allowedRatios: ['16:9'], allowedSizes: ['1080p'],
    qualityOptions: [], maxOutputs: 1, supportsReferenceImages: true, maxReferenceImages: 2,
    supportsMask: false, allowedDurationsSeconds: [5, 10], supportedOperations: operations,
    outputKinds: ['mp4'], capabilitySources: {},
  };
}

function build(overrides: Record<string, unknown> = {}) {
  return buildBriefToVideoVideoSubmission({
    runId: 'run-1', stepId: 'generate-film', projectId: 'project-1', workspaceId: 'canvas-1',
    idempotencyKey: 'skill-provider:video', modelBinding: {
      providerId: 'pear-video', modelId: 'video-model', descriptor: descriptor(),
    },
    plan,
    input: briefInput,
    sourceImageUrls: {},
    skillBillingContext: {
      runId: 'run-1', stepId: 'generate-film', requestDigest: 'digest-1',
      operationKey: 'operation-1',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    },
    ...overrides,
  });
}

describe('Brief to video video adapter', () => {
  it('parses only the exact persisted video capability binding', () => {
    const frozen = descriptor();
    expect(parseFrozenBriefVideoBinding(frozen, {
      providerId: 'pear-video', modelId: 'video-model',
    })).toEqual({ providerId: 'pear-video', modelId: 'video-model', descriptor: frozen });
    expect(() => parseFrozenBriefVideoBinding({ ...frozen, providerId: 'other' }, {
      providerId: 'pear-video', modelId: 'video-model',
    })).toThrowError(BriefToVideoVideoAdmissionError);
    expect(() => parseFrozenBriefVideoBinding({ ...frozen, allowedDurationsSeconds: [0] }, {
      providerId: 'pear-video', modelId: 'video-model',
    })).toThrowError(BriefToVideoVideoAdmissionError);
  });

  it('builds an exact text-to-video request with the operation idempotency key', () => {
    const submission = build();
    expect(submission.endpoint).toBe('/api/video/generate');
    expect(submission.headers['idempotency-key']).toBe('skill-provider:video');
    expect(submission.body).toMatchObject({
      providerId: 'pear-video', model: 'pear-video::video-model', prompt: plan.finalVideoPrompt,
      duration: 10, aspectRatio: '16:9', resolution: '1080p', projectId: 'project-1',
      sessionId: 'canvas-1', skillBillingContext: expect.any(Object),
    });
    expect(submission.body).not.toHaveProperty('imageUrl');
  });

  it('maps one and two authorized source versions without accepting arbitrary URLs', () => {
    const one = build({
      input: { ...briefInput, startFrame: 'av_start' },
      sourceImageUrls: { av_start: '/api/assets/av_start/content' },
    });
    expect(one.body).toMatchObject({ imageUrl: '/api/assets/av_start/content' });
    expect(one.body).not.toHaveProperty('lastFrameImageUrl');

    const two = build({
      input: { ...briefInput, startFrame: 'av_start', endFrame: 'av_end' },
      sourceImageUrls: {
        av_start: '/api/assets/av_start/content', av_end: '/api/assets/av_end/content',
      },
    });
    expect(two.body).toMatchObject({
      imageUrl: '/api/assets/av_start/content', lastFrameImageUrl: '/api/assets/av_end/content',
      assetParentVersionIds: ['av_start', 'av_end'],
    });
  });

  it('fails closed when the frozen capability does not support the requested operation', () => {
    expect(() => build({ modelBinding: {
      providerId: 'pear-video', modelId: 'video-model', descriptor: descriptor(['text-to-video']),
    }, input: { ...briefInput, startFrame: 'av_start' },
    sourceImageUrls: { av_start: '/api/assets/av_start/content' } }))
      .toThrowError(BriefToVideoVideoAdmissionError);
  });

  it('persists an accepted local task before monitoring it', async () => {
    const order: string[] = [];
    const taskId = await submitBriefToVideoTask(build(), {
      submit: async () => new Response(JSON.stringify({ taskId: 'video-local-1', status: 'queued' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
      recordLocalAccepted: async value => { order.push(`accepted:${value}`); },
      monitor: async value => { order.push(`monitor:${value}`); },
    });
    expect(taskId).toBe('video-local-1');
    expect(order).toEqual(['accepted:video-local-1', 'monitor:video-local-1']);
  });

  it('classifies an explicit rejection separately from an uncertain accepted response', async () => {
    await expect(submitBriefToVideoTask(build(), {
      submit: async () => new Response(JSON.stringify({ error: 'unsupported duration' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      }),
      recordLocalAccepted: async () => undefined,
      monitor: async () => undefined,
    })).rejects.toMatchObject({ name: 'AgentDownstreamProviderRejectedError' });

    await expect(submitBriefToVideoTask(build(), {
      submit: async () => new Response('<html>gateway ended</html>', {
        status: 200, headers: { 'content-type': 'text/html' },
      }),
      recordLocalAccepted: async () => undefined,
      monitor: async () => undefined,
    })).rejects.toMatchObject({ name: 'AgentDownstreamSubmissionUnknownError' });
  });

  it('bounds a response body that stalls after successful headers', async () => {
    await expect(submitBriefToVideoTask(build(), {
      submit: async () => new Response(new ReadableStream({ start() {} }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
      recordLocalAccepted: async () => undefined,
      monitor: async () => undefined,
      responseTimeoutMs: 20,
    })).rejects.toMatchObject({ name: 'AgentDownstreamSubmissionUnknownError' });
  });

  it('preserves monitor failures after local acceptance was persisted', async () => {
    const terminalError = new Error('VIDEO_TASK_FAILED');
    await expect(submitBriefToVideoTask(build(), {
      submit: async () => new Response(JSON.stringify({ taskId: 'video-local-2' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
      recordLocalAccepted: async () => undefined,
      monitor: async () => { throw terminalError; },
    })).rejects.toBe(terminalError);
  });

  it('executes the approved plan with the frozen model before monitoring the same local task', async () => {
    const calls: string[] = [];
    const result = await executeBriefToVideoStep({
      actorUserId: 'user-1', actorRole: 'user', projectId: 'project-1', workspaceId: 'canvas-1',
      runId: 'run-1', stepId: 'generate-film', requestDigest: 'digest-1',
      idempotencyKey: 'skill-provider:video', operationKey: 'operation-video',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 2 },
      inputValues: briefInput,
      previousOutputs: [{
        stepId: 'plan-film', kind: 'json', schemaId: 'brief-to-video-plan-v1',
        content: JSON.stringify(plan),
      }],
      modelBinding: { providerId: 'pear-video', modelId: 'video-model', descriptor: descriptor() },
      sourceImageUrls: {}, signal: new AbortController().signal,
      recordLocalAccepted: async taskId => { calls.push(`accepted:${taskId}`); },
    }, {
      submit: async submission => {
        calls.push(`submit:${submission.body.providerId}:${submission.body.model}`);
        return new Response(JSON.stringify({ taskId: 'video-child-1' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      },
      monitor: async taskId => {
        calls.push(`monitor:${taskId}`);
        return {
          assetVersionIds: ['video-version-1'],
          remoteTaskId: 'remote-video-1',
        };
      },
    });

    expect(calls).toEqual([
      'submit:pear-video:pear-video::video-model',
      'accepted:video-child-1',
      'monitor:video-child-1',
    ]);
    expect(result).toMatchObject({
      assetVersionIds: ['video-version-1'],
      media: [{}],
      structured: {
        schemaId: 'brief-to-video-result-v1',
        value: {
          runId: 'run-1',
          videoAssetVersionId: 'video-version-1',
          sourceAssetVersionIds: [],
          providerId: 'pear-video',
          modelId: 'video-model',
          remoteTaskId: 'remote-video-1',
        },
      },
    });
  });

  it('does not submit when the approved structured plan is missing', async () => {
    await expect(executeBriefToVideoStep({
      actorUserId: 'user-1', actorRole: 'user', projectId: 'project-1', workspaceId: 'canvas-1',
      runId: 'run-1', stepId: 'generate-film', requestDigest: 'digest-1',
      idempotencyKey: 'skill-provider:video', operationKey: 'operation-video',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 2 },
      inputValues: briefInput, previousOutputs: [],
      modelBinding: { providerId: 'pear-video', modelId: 'video-model', descriptor: descriptor() },
      sourceImageUrls: {}, signal: new AbortController().signal,
      recordLocalAccepted: async () => undefined,
    }, {
      submit: async () => { throw new Error('must not submit'); },
      monitor: async () => ({ assetVersionIds: [] }),
    })).rejects.toMatchObject({ code: 'BRIEF_VIDEO_PLAN_MISSING' });
  });
});
