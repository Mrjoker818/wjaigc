import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PearProtocolError,
  PearSubmissionIndeterminateError,
  pollPearLayerTask,
  submitPearLayerTask,
} from '@/lib/layer-decomposition/pear-adapter';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const input = {
  baseUrl: 'https://api.pearapi.ai',
  apiKey: 'server-secret',
  image: 'https://media.example.com/source.png',
  applicationTaskId: 'layer-task-1',
  requestId: 'request-1',
  fetchImpl: fetchMock,
};

describe('Pear layered image adapter', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('uses edits and never calls generations after a task id exists', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ task_id: 'pear-1' }));

    await expect(submitPearLayerTask(input)).resolves.toEqual({
      kind: 'async',
      remoteTaskId: 'pear-1',
      endpoint: 'edits',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.pearapi.ai/v1/images/edits');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer server-secret',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'layer-task-1',
      'X-Request-Id': 'request-1',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'image-layered',
      image: 'https://media.example.com/source.png',
    });
  });

  it('accepts a synchronous PSD artifact from documented data output', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{ url: 'https://cdn.example.com/result.psd' }],
    }));

    await expect(submitPearLayerTask(input)).resolves.toEqual({
      kind: 'sync',
      psdUrl: 'https://cdn.example.com/result.psd',
      endpoint: 'edits',
    });
  });

  it('falls back to generations only for an explicit unsupported endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Not Found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'pear-2' } }));

    await expect(submitPearLayerTask(input)).resolves.toMatchObject({
      kind: 'async',
      remoteTaskId: 'pear-2',
      endpoint: 'generations',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0])
      .toBe('https://api.pearapi.ai/v1/images/generations');
  });

  it('does not fall back after timeout because submission is indeterminate', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'AbortError'));

    await expect(submitPearLayerTask(input))
      .rejects.toBeInstanceOf(PearSubmissionIndeterminateError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fall back after a server error or malformed response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'upstream failed' }, 502));
    await expect(submitPearLayerTask(input)).rejects.toBeInstanceOf(PearProtocolError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));
    await expect(submitPearLayerTask(input)).rejects.toBeInstanceOf(PearProtocolError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes task polling and rejects completed tasks without a PSD', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'running',
      progress: 42,
    }));
    await expect(pollPearLayerTask({
      ...input,
      remoteTaskId: 'pear-1',
    })).resolves.toEqual({ status: 'running', progress: 42 });

    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'completed',
      output: { data: [] },
    }));
    await expect(pollPearLayerTask({
      ...input,
      remoteTaskId: 'pear-1',
    })).rejects.toMatchObject({ code: 'PEAR_EMPTY_COMPLETED_RESULT' });
  });

  it('returns the PSD URL from a completed task', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'completed',
      output: { data: [{ url: 'https://cdn.example.com/task-result.psd' }] },
    }));

    await expect(pollPearLayerTask({
      ...input,
      remoteTaskId: 'pear / 1',
    })).resolves.toEqual({
      status: 'completed',
      progress: 100,
      psdUrl: 'https://cdn.example.com/task-result.psd',
    });
    expect(fetchMock.mock.calls[0][0])
      .toBe('https://api.pearapi.ai/v1/images/tasks/pear%20%2F%201');
  });
});
