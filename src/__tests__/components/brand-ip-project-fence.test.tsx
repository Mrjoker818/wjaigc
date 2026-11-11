// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BrandIpPanel from '@/components/brand-ip-panel';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function project(id: string) {
  const direction = { id: `direction-${id}`, name: `方向-${id}`, concept: '合成角色',
    scores: { brandRole: 80, ownability: 80, feasibility: 80 }, status: 'confirmed' };
  return { id, name: `项目-${id}`, currentStage: 'asset-generation', brief: { brandName: `品牌-${id}` },
    directions: [direction], confirmedDirectionId: direction.id, immutableCore: [], controlledVariables: [] };
}

const projects = [project('a'), project('b')];
const asset = (id: string) => ({ id, imageUrl: `/synthetic/asset-${id}.png`, assetType: `资产-${id}` });

function setup(routes: Record<string, () => Response | Promise<Response>>) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (routes[url]) return routes[url]();
    if (init?.method && init.method !== 'GET') throw Error(`Unexpected write: ${url}`);
    if (url === '/api/brand-ip/projects') return Response.json({ projects });
    if (url.startsWith('/api/models?')) return Response.json({ models: [], providers: [] });
    if (url.startsWith('/api/brand-ip/tasks?projectId=')) return Response.json({ tasks: [] });
    if (url.startsWith('/api/brand-ip/assets?projectId=')) return Response.json({ assets: [] });
    if (url.startsWith('/api/brand-ip/projects?projectId=')) {
      return Response.json({ project: projects.find(item => url.endsWith(`=${item.id}`)) });
    }
    throw Error(`Unexpected fixture request: ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const add = vi.fn();
  render(<BrandIpPanel onClose={() => {}} onAddImages={add} />);
  return { fetcher, add };
}

async function openProject(id: string) {
  fireEvent.click(screen.getByRole('button', { name: '品牌IP项目列表' }));
  fireEvent.click(await screen.findByRole('button', { name: `项目-${id}` }));
}

async function finish<T>(pending: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => { pending.resolve(value); });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('honors the latest project selection when project detail resolves out of order', async () => {
  const old = deferred<Response>();
  const { fetcher } = setup({ '/api/brand-ip/projects?projectId=a': () => old.promise });
  await openProject('a'); await openProject('b');
  await screen.findByDisplayValue('品牌-b');
  await finish(old, Response.json({ project: projects[0] }));
  expect(screen.getByDisplayValue('品牌-b')).toBeTruthy();
  expect(fetcher.mock.calls.some(([url]) => url === '/api/brand-ip/assets?projectId=a')).toBe(false);
});

it('keeps assets scoped across A to B to A, even when an older A request settles last', async () => {
  const old = deferred<Response>();
  let readsA = 0;
  const { fetcher, add } = setup({
    '/api/brand-ip/assets?projectId=a': () => ++readsA === 1 ? old.promise : Response.json({ assets: [asset('new-a')] }),
    '/api/brand-ip/assets?projectId=b': () => Response.json({ assets: [asset('b')] }),
  });
  await openProject('a');
  await waitFor(() => expect(readsA).toBe(1));
  await openProject('b'); await screen.findByRole('img', { name: '资产-b' });
  await openProject('a'); await screen.findByRole('img', { name: '资产-new-a' });
  await finish(old, Response.json({ assets: [asset('old-a')] }));
  expect(screen.queryByRole('img', { name: '资产-old-a' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '发送到画布' }));
  expect(add).toHaveBeenCalledWith(['/synthetic/asset-new-a.png'], expect.any(Object));
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/brand-ip/assets?projectId=a')).toHaveLength(2);
});

it('ignores delayed task discovery from the previous project', async () => {
  const old = deferred<Response>();
  const { fetcher } = setup({
    '/api/brand-ip/tasks?projectId=a': () => old.promise,
    '/api/brand-ip/tasks?taskId=old-a': () => Response.json({ task: { status: 'processing', label: '旧任务', progress: 55 } }),
  });
  await openProject('a');
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === '/api/brand-ip/tasks?projectId=a')).toBe(true));
  await openProject('b'); await screen.findByDisplayValue('品牌-b');
  await finish(old, Response.json({ tasks: [{ taskId: 'old-a', label: '旧任务', progress: 50 }] }));
  expect(screen.queryByText('旧任务')).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => url === '/api/brand-ip/tasks?taskId=old-a')).toBe(false);
});

it('keeps the new task running when the old poll finishes and completes only the new project', async () => {
  const old = deferred<Response>();
  let currentReads = 0, newAssetReads = 0;
  const { fetcher } = setup({
    '/api/brand-ip/tasks?projectId=a': () => Response.json({ tasks: [{ taskId: 'task-a', label: '恢复 A' }] }),
    '/api/brand-ip/tasks?projectId=b': () => Response.json({ tasks: [{ taskId: 'task-b', label: '恢复 B' }] }),
    '/api/brand-ip/tasks?taskId=task-a': () => old.promise,
    '/api/brand-ip/tasks?taskId=task-b': () => ++currentReads === 1
      ? Response.json({ task: { status: 'processing', label: '正在生成 B', progress: 45 } })
      : Response.json({ task: { status: 'completed', progress: 100 } }),
    '/api/brand-ip/assets?projectId=b': () => Response.json({ assets: ++newAssetReads > 1 ? [asset('b')] : [] }),
  });
  await openProject('a');
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === '/api/brand-ip/tasks?taskId=task-a')).toBe(true));
  await openProject('b'); await screen.findByText('正在生成 B');
  await finish(old, Response.json({ task: { status: 'completed', progress: 100, label: 'A 已完成' } }));
  expect(screen.getByText('正在生成 B')).toBeTruthy();
  expect(screen.queryByText('A 已完成')).toBeNull();
  await screen.findByRole('img', { name: '资产-b' }, { timeout: 4500 });
  expect(currentReads).toBe(2);
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/brand-ip/assets?projectId=a')).toHaveLength(1);
});

it('fences late recovery and submission while preserving the selected model and asset type', async () => {
  const recovery = deferred<Response>(), submission = deferred<Response>();
  const { fetcher } = setup({
    '/api/models?type=image': () => Response.json({ models: [{ id: 'synthetic-image', providerId: 'fixture-provider' }], providers: [] }),
    '/api/brand-ip/tasks?projectId=a': () => recovery.promise,
    '/api/brand-ip/generate': () => submission.promise,
  });
  await openProject('a');
  await screen.findByRole('option', { name: 'fixture-provider / synthetic-image' });
  fireEvent.click(await screen.findByRole('button', { name: '单色版' }));
  const request = fetcher.mock.calls.find(([url]) => url === '/api/brand-ip/generate')?.[1];
  expect(request?.method).toBe('POST');
  expect(JSON.parse(String(request?.body))).toMatchObject({
    projectId: 'a', assetType: '单色版', providerId: 'fixture-provider', model: 'synthetic-image',
  });
  await finish(recovery, Response.json({ tasks: [{ taskId: 'old-a', label: '旧恢复任务' }] }));
  expect(screen.getByText('正在提交生成任务')).toBeTruthy();
  expect(screen.getByRole('button', { name: '取消生成' })).toHaveProperty('disabled', true);
  await openProject('b'); await screen.findByDisplayValue('品牌-b');
  expect(request?.signal?.aborted).toBe(true);
  await finish(submission, Response.json({ taskId: 'submitted-a' }));
  expect(screen.queryByText('生成任务已提交')).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('taskId='))).toHaveLength(0);
});
