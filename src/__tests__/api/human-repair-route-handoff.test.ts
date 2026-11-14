import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findProvider: vi.fn(),
  start: vi.fn(),
  read: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => ({ userId: 'owner', userRole: 'user' }),
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => ({ id: 'owner' }) }));
vi.mock('@/lib/server-api-config', () => ({ findProviderById: mocks.findProvider }));
vi.mock('@/lib/human-repair-service', () => ({
  startHumanRepair: mocks.start,
  getHumanRepairTask: mocks.read,
  selectHumanRepairCandidate: mocks.select,
}));

import { POST as repair } from '@/app/api/human/repair/route';
import { POST as select } from '@/app/api/human/select/route';
import { GET as readTask } from '@/app/api/human/task/[id]/route';

const sourceImageUrl = '/api/serve-upload/qa-source.png';
const candidate = { id: 'candidate-1', imageUrl: '/api/serve-upload/qa-repaired.png', validation: { passed: true } };
const task = { id: 'task-1', status: 'completed', analysis: { targets: [{ id: 'target-1' }] }, candidates: [candidate] };
const request = (path: string, body: unknown) => new NextRequest('http://localhost/api/human/' + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findProvider.mockResolvedValue({ selectedModels: ['qa-image-edit'] });
  mocks.start.mockResolvedValue({ ...task, status: 'processing' });
  mocks.read.mockReturnValue(task);
  mocks.select.mockResolvedValue(candidate);
});

it('passes the selected model and source to the job, reads its completion, and saves the chosen candidate as the same owner', async () => {
  const response = await repair(request('repair', {
    imageUrl: sourceImageUrl, imageId: 'source-1', providerId: 'provider-1', model: 'qa-image-edit',
    targetIds: ['target-1'], candidateCount: 1,
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, taskId: task.id, status: 'processing' });
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'owner', sourceImageId: 'source-1', sourceImageUrl,
    providerId: 'provider-1', model: 'qa-image-edit', targetIds: ['target-1'], candidateCount: 1,
  }));
  const readback = await readTask(new NextRequest('http://localhost/api/human/task/' + task.id), {
    params: Promise.resolve({ id: task.id }),
  });
  expect(readback.status).toBe(200);
  expect(await readback.json()).toEqual({ success: true, task });
  expect(mocks.read).toHaveBeenCalledWith(task.id, 'owner');
  const selected = await select(request('select', { taskId: task.id, candidateId: candidate.id }));
  expect(selected.status).toBe(200);
  expect(await selected.json()).toEqual({ success: true, candidate });
  expect(mocks.select).toHaveBeenCalledWith(task.id, 'owner', candidate.id);
});
