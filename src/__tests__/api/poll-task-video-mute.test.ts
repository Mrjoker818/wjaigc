import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Scope inherited DB bindings before imports and module-level guard snapshots.
await vi.hoisted(async () => {
  const { afterAll } = await import('vitest');
  const { scopeOfflineDatabaseEnvironment } = await import('../helpers/isolated-child-database-env');
  const restore = scopeOfflineDatabaseEnvironment(process.env);
  try {
    afterAll(restore);
  } catch (error) {
    restore();
    throw error;
  }
});
import type { CloudTask } from '@/lib/cloud-task-storage';

vi.mock('server-only', () => ({}));
const io = vi.hoisted(() => ({
  read: vi.fn(), lease: vi.fn(), releaseLease: vi.fn(), complete: vi.fn(), terminate: vi.fn(),
  refund: vi.fn(), record: vi.fn(), project: vi.fn(), provider: vi.fn(),
  download: vi.fn(), strip: vi.fn(), inspect: vi.fn(), upload: vi.fn(), cleanup: vi.fn(),
  mkdir: vi.fn(), write: vi.fn(), unexpectedDb: vi.fn(),
}));
vi.mock('@/lib/db-client', () => ({
  isDatabaseConfigured: (): boolean => false, getPool: io.unexpectedDb, execSql: io.unexpectedDb,
}));
vi.mock('@/lib/api-auth', () => ({
  getRequestUser: async () => ({ user: { id: 'video-mute-owner', role: 'user' }, source: 'cookie' }),
  getTrustedRequestAgentExecutionFence: async () => undefined,
  getInternalRequestHeaders: () => ({}),
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: io.provider, findProviderForModel: io.provider,
  normalizeApiBaseUrl: (url: string): string => url.replace(/\/+$/, ''),
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  CloudTaskAdmissionError: class extends Error {},
  getCloudTaskForUser: io.read, getCloudTaskById: io.read,
  claimCloudTaskLease: io.lease, releaseCloudTaskLease: io.releaseLease,
  completeCloudTask: io.complete, terminateCloudTaskAndRefund: io.terminate,
  refundCloudTaskCredits: io.refund,
  updateCloudTask: async () => { throw Error('Unexpected task mutation'); },
  renewCloudTaskLease: async () => true,
  deferCloudTaskRecovery: async () => { throw Error('Unexpected submission recovery'); },
}));
vi.mock('@/lib/cloud-task-persistence', async original => ({
  ...await original<typeof import('@/lib/cloud-task-persistence')>(),
  recordVideoTaskTerminal: io.record, projectPersistedCompletedTask: io.project,
}));
vi.mock('@/lib/video-document-admission', async original => ({
  ...await original<typeof import('@/lib/video-document-admission')>(),
  completeDocumentVideoTask: io.complete,
}));
vi.mock('@/lib/media-gateway/artifact-persistence', async original => ({
  ...await original<typeof import('@/lib/media-gateway/artifact-persistence')>(),
  downloadSafeVideoArtifact: io.download, persistGatewayVideoArtifact: io.upload,
  cleanupPersistedGatewayVideoResult: io.cleanup,
}));
vi.mock('@/lib/asset-core/video-file-metadata', () => ({
  stripVideoAudioTrack: io.strip, inspectPersistedVideoFile: io.inspect,
}));
vi.mock('fs/promises', async original => ({
  ...await original<typeof import('fs/promises')>(), mkdir: io.mkdir, writeFile: io.write,
}));
vi.mock('@/lib/server-data-root', async original => ({
  ...await original<typeof import('@/lib/server-data-root')>(),
  getServerDataRoot: (): string => path.resolve('output/canvas-chat-audit/ci-20261121/video-mute/synthetic-files'),
}));

import { POST } from '@/app/api/poll-task/route';
import { getTaskInfo, registerTask, updateTaskProgress, subscribeToTaskEvents } from '@/lib/task-registry';
import { VideoCompletionUnknownError } from '@/lib/video-document-admission';

const RAW_URL = 'https://video-fixture.invalid/original-with-audio.mp4';
const RAW = Buffer.from('synthetic-video-with-audio');
const MUTED = Buffer.from('synthetic-video-without-audio');
const inheritedDbKeys = Object.keys(process.env).filter(key =>
  /^(PG|DATABASE|POSTGRES|TEST_POSTGRES|COZE_SUPABASE)|^WUJIE_.*DB|^WUJIE_AUTH_PERSISTENCE_MODE$/.test(key));
let taskId: string;
let durable: CloudTask | null;
let refunds: string[];
let writes: Map<string, Buffer>;
let events: string[];
let responses: Record<string, unknown>[];
let unsubscribe: () => void;

function seed(input: { durable?: boolean; gateway?: boolean; audio?: boolean; recovered?: boolean;
  profile?: string; document?: boolean } = {}): void {
  const result = { profile: input.profile || 'pearapi-video', thirdPartyTaskId: 'pear-remote-fixture',
    baseUrl: 'https://pear-fixture.invalid', apiKey: 'synthetic-not-a-key', model: 'seedance-2.0',
    providerId: 'pear-fixture', generateAudio: input.audio,
    submissionPayload: { generateAudio: input.audio,
      ...(input.gateway ? { sourceChannel: 'gateway' } : {}),
      ...(input.document ? { videoCanvasAdmission: { fixture: true } } : {}) } };
  if (!input.recovered) {
    registerTask(taskId, 'video', '视频生成', 'video-mute-owner', input.durable === false ? 'memory' : 'durable');
    updateTaskProgress(taskId, { status: 'processing', progress: 50, creditCost: 9, result });
  }
  durable = input.durable === false ? null : { id: taskId, userId: 'video-mute-owner', type: 'video',
    status: 'processing', providerId: 'pear-fixture', model: 'seedance-2.0', remoteTaskId: 'pear-remote-fixture',
    progress: 50, label: '视频生成', creditStatus: 'charged', creditCost: 9,
    result, createdAt: Date.now() - 5000, updatedAt: Date.now() - 5000 };
}

async function poll(): Promise<Record<string, unknown>> {
  const response = await POST(new NextRequest('http://localhost/api/poll-task', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json() as Record<string, unknown>;
  responses.push(body);
  return body;
}

beforeEach(() => {
  vi.clearAllMocks();
  expect(inheritedDbKeys, 'offline launcher must clear inherited DB bindings').toEqual([]);
  taskId = `video-mute-${randomUUID()}`;
  durable = null; refunds = []; writes = new Map(); events = []; responses = [];
  io.unexpectedDb.mockImplementation(() => { throw Error('REAL DATABASE ACCESS FORBIDDEN'); });
  io.provider.mockResolvedValue({ id: 'pear-fixture', name: 'Synthetic Pear', type: 'video', modelType: 'video',
    baseUrl: 'https://pear-fixture.invalid', apiKey: 'synthetic-not-a-key', isEnabled: true,
    selectedModels: ['seedance-2.0'], advancedParams: { compatProfile: 'pearapi-video' } });
  io.read.mockImplementation(async (id: string, user?: string) => {
    expect(id).toBe(taskId);
    if (user) expect(user).toBe('video-mute-owner');
    return durable ? structuredClone(durable) : null;
  });
  io.lease.mockImplementation(async (_id: string, owner: string) => {
    events.push('lease');
    if (!durable || durable.leaseOwner) return null;
    durable.leaseOwner = owner;
    return { taskId, owner, expiresAt: Date.now() + 600_000, attemptCount: 1 };
  });
  io.releaseLease.mockImplementation(async (_id: string, owner: string) => {
    expect(durable?.leaseOwner).toBe(owner);
    if (durable) durable.leaseOwner = undefined;
  });
  io.complete.mockImplementation(async (_id: string, result: Record<string, unknown>, owner?: string) => {
    events.push('complete-attempt');
    if (!durable || durable.status !== 'processing') return false;
    if (owner) expect(durable.leaseOwner).toBe(owner);
    durable.status = 'completed'; durable.result = structuredClone(result);
    events.push('complete-commit');
    return true;
  });
  io.terminate.mockImplementation(async (_id: string, status: CloudTask['status'], error: string, owner?: string) => {
    events.push('terminate-attempt');
    if (!durable || durable.status !== 'processing') return { transitioned: false, status: durable?.status };
    if (owner) expect(durable.leaseOwner).toBe(owner);
    durable.status = status; durable.error = error; durable.creditStatus = 'refunded';
    refunds.push(taskId); events.push('failed-commit');
    return { transitioned: true, status, refunded: true };
  });
  io.refund.mockImplementation(async () => { refunds.push(taskId); return { refunded: true }; });
  io.record.mockImplementation(async (_id: string, record: { status: string }) => { events.push(`record-${record.status}`); });
  io.project.mockImplementation(async () => { events.push('projection'); });
  io.download.mockResolvedValue({ buffer: RAW, resolvedSourceUrl: RAW_URL,
    mediaType: { extension: 'mp4', mimeType: 'video/mp4' } });
  io.strip.mockImplementation(async (buffer: Buffer, extension: string) => {
    expect(buffer).toEqual(RAW); expect(extension).toBe('mp4'); return MUTED;
  });
  io.mkdir.mockResolvedValue(undefined);
  io.write.mockImplementation(async (filename: string, buffer: Buffer) => {
    expect(filename).toContain(taskId); writes.set(filename, Buffer.from(buffer)); events.push('write');
  });
  io.inspect.mockImplementation(async (_filename: string, byteSize: number) => ({ byteSize, mimeType: 'video/mp4', width: 640, height: 480 }));
  io.upload.mockResolvedValue({ storageKey: 'synthetic-muted-video-key' });
  io.cleanup.mockImplementation(async () => { writes.clear(); events.push('cleanup'); });
  vi.stubGlobal('fetch', vi.fn(async (url: string): Promise<Response> => {
    expect(String(url)).toMatch(/^https:\/\/pear-fixture\.invalid\//);
    return Response.json({ status: 'completed', output: { video_url: RAW_URL }, metadata: { duration: 5 } });
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  unsubscribe = subscribeToTaskEvents(event => { if (event.taskId === taskId) events.push(`registry-${event.task.status}`); });
});

afterEach((context) => {
  expect(io.unexpectedDb).not.toHaveBeenCalled();
  unsubscribe();
  if (getTaskInfo(taskId)?.status === 'processing') updateTaskProgress(taskId, { status: 'failed' });
  const evidence = {
    test: context.task.name, responses, durableStatus: durable?.status,
    refundCount: refunds.length, completeAttempts: io.complete.mock.calls.length,
    terminateAttempts: io.terminate.mock.calls.length, stripCalls: io.strip.mock.calls.length,
    publishedRaw: responses.some(body => body.status === 'completed' && (body.videoUrl === RAW_URL || body.imageUrl === RAW_URL)),
    publishedUnmutedBytes: responses.some(body => body.status === 'completed') && [...writes.values()].some(buffer => buffer.equals(RAW)),
    remainingWrites: [...writes.values()].map(buffer => buffer.toString()), events,
  };
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (process.env.VIDEO_MUTE_EVIDENCE === '1') console.info('VIDEO_MUTE_EVIDENCE', JSON.stringify(evidence));
});

function expectNoPublication(): void {
  expect(io.complete).not.toHaveBeenCalled();
  expect(io.project).not.toHaveBeenCalled();
  expect(events).not.toContain('registry-completed');
  expect(io.record.mock.calls.some(([, record]) => record.status === 'completed')).toBe(false);
  expect(responses.some(body => body.status === 'completed')).toBe(false);
}

describe('poll-task Pear muted video handler', () => {
  it.each(['durable', 'memory', 'gateway'])('fails closed on strip rejection (%s), refunds once across repoll', async (mode) => {
    seed({ durable: mode !== 'memory', gateway: mode === 'gateway', audio: false });
    io.strip.mockRejectedValue(Error('synthetic FFmpeg failure'));
    expect((await poll()).status).toBe('failed');
    expect((await poll()).status).toBe('failed');
    expectNoPublication();
    expect(refunds).toEqual([taskId]);
    expect(writes.size).toBe(0); expect(io.upload).not.toHaveBeenCalled();
    if (mode !== 'memory') {
      expect(durable?.status).toBe('failed'); expect(io.terminate).toHaveBeenCalledTimes(1);
      expect(io.refund).not.toHaveBeenCalled();
      expect(events.indexOf('failed-commit')).toBeLessThan(events.indexOf('registry-failed'));
    }
    if (mode === 'gateway') {
      expect(io.lease).toHaveBeenCalledTimes(1);
      expect(io.terminate.mock.calls[0][3]).toBe(io.lease.mock.calls[0][1]);
    }
  });

  it.each(['download', 'write', 'inspect'])('never falls back to the raw URL on muted %s failure', async (stage) => {
    seed({ audio: false });
    if (stage === 'download') io.download.mockRejectedValue(Error('synthetic download failure'));
    if (stage === 'write') io.write.mockRejectedValue(Error('synthetic disk full'));
    if (stage === 'inspect') io.inspect.mockRejectedValue(Error('synthetic verification failure'));
    expect((await poll()).status).toBe('failed');
    expectNoPublication(); expect(refunds).toEqual([taskId]);
    expect(writes.size).toBe(0);
    expect(io.cleanup).toHaveBeenCalledTimes(stage === 'download' ? 0 : 1);
  });

  it.each([false, true])('publishes only muted bytes after a durable success (gateway=%s)', async (gateway) => {
    seed({ audio: false, gateway });
    const body = await poll();
    expect(body.status).toBe('completed'); expect(body.videoUrl).toMatch(/^\/api\/serve-upload\/video\//);
    expect(body.videoUrl).not.toBe(RAW_URL);
    expect([...writes.values()]).toEqual([MUTED]);
    expect(durable?.result?.videoUrl).toBe(body.videoUrl);
    expect(io.complete).toHaveBeenCalledTimes(1); expect(io.strip).toHaveBeenCalledTimes(1);
    expect(refunds).toEqual([]);
    expect(events.indexOf('complete-commit')).toBeLessThan(events.indexOf('registry-completed'));
    if (gateway) {
      expect(io.upload.mock.calls[0][0].buffer).toEqual(MUTED);
      expect(io.complete.mock.calls[0][2]).toBe(io.lease.mock.calls[0][1]);
    }
  });

  it.each([true, undefined])('retains the ordinary non-muted Pear persistence fallback (audio=%s)', async (audio) => {
    seed({ audio }); io.write.mockRejectedValue(Error('synthetic disk full'));
    const body = await poll();
    expect(body.status).toBe('completed'); expect(body.videoUrl).toBe(RAW_URL);
    expect(io.strip).not.toHaveBeenCalled(); expect(refunds).toEqual([]);
  });

  it('retains another provider profile fallback even when generateAudio=false', async () => {
    seed({ audio: false, profile: 'rest-generic' });
    io.write.mockRejectedValue(Error('synthetic disk full'));
    const body = await poll();
    expect(body.status).toBe('completed'); expect(body.videoUrl).toBe(RAW_URL);
    expect(io.strip).not.toHaveBeenCalled(); expect(refunds).toEqual([]);
  });

  it('does not refund or delete a muted artifact when the document completion commit is unknown', async () => {
    seed({ audio: false, document: true });
    io.complete.mockRejectedValue(new VideoCompletionUnknownError());
    expect((await poll()).status).toBe('processing');
    expect(io.terminate).not.toHaveBeenCalled(); expect(refunds).toEqual([]);
    expect(io.cleanup).not.toHaveBeenCalled(); expect([...writes.values()]).toEqual([MUTED]);
    expect(events).not.toContain('registry-completed');
  });

  it.each(['processing', 'cancelled'] as const)('keeps authoritative %s when failure settlement loses the race', async (status) => {
    seed({ audio: false }); io.strip.mockRejectedValue(Error('synthetic FFmpeg failure'));
    io.terminate.mockImplementation(async () => {
      durable!.status = status; return { transitioned: false, status };
    });
    expect((await poll()).status).toBe(status);
    expect(refunds).toEqual([]); expectNoPublication();
    expect(events).not.toContain('registry-failed');
  });

  it('keeps processing if atomic failure settlement acknowledgement is lost', async () => {
    seed({ audio: false }); io.strip.mockRejectedValue(Error('synthetic FFmpeg failure'));
    io.terminate.mockRejectedValue(Error('synthetic settlement acknowledgement lost'));
    expect((await poll()).status).toBe('processing');
    expect(io.refund).not.toHaveBeenCalled(); expect(refunds).toEqual([]); expectNoPublication();
  });

  it('does no artifact work when another worker holds the gateway lease', async () => {
    seed({ audio: false, gateway: true }); io.lease.mockResolvedValue(null);
    expect((await poll()).status).toBe('processing');
    expect(io.download).not.toHaveBeenCalled(); expect(io.strip).not.toHaveBeenCalled();
    expect(io.terminate).not.toHaveBeenCalled(); expect(refunds).toEqual([]); expectNoPublication();
  });

  it('honors the persisted mute request after real registry recovery without resubmission', async () => {
    seed({ audio: false, recovered: true }); io.strip.mockRejectedValue(Error('synthetic FFmpeg failure'));
    expect((await poll()).status).toBe('failed');
    expect(io.lease).toHaveBeenCalledTimes(1); expect(io.releaseLease).toHaveBeenCalledTimes(1);
    expect(getTaskInfo(taskId)?.persistence).toBe('durable');
    expect(io.strip).toHaveBeenCalledTimes(1); expect(refunds).toEqual([taskId]); expectNoPublication();
  });
});
