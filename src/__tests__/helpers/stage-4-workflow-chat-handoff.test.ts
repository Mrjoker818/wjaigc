import { EventEmitter } from 'node:events';
import type { Page, Request, Response } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import { sendStage4WorkflowResultToChat } from '../../../tests/helpers/stage-4-workflow-chat-handoff';

const scope = {
  actorId: 'fixture-actor', assetProjectId: 'fixture-canvas', chatProjectId: 'fixture-chat',
  workflowId: 'fixture-workflow', executionId: 'fixture-execution',
  outputNodeId: 'fixture-output', assetVersionId: 'fixture-version',
};
const graph = {
  id: scope.workflowId, projectId: scope.assetProjectId, updatedAt: 1,
  nodes: [{ id: scope.outputNodeId, type: 'output-image' }],
};
const returnedTransfer = {
  sourceVersion: scope.assetVersionId, targetProject: scope.assetProjectId,
  targetWorkspace: `standalone-chat:${scope.chatProjectId}`, entityType: 'chat-result',
  entityId: `workflow-return:${scope.executionId}:${scope.outputNodeId}`,
  metadata: { workflowId: scope.workflowId, executionId: scope.executionId, outputNodeId: scope.outputNodeId },
};

interface FixtureOptions {
  abortBeforeNavigation?: boolean;
  transferBeforeNavigation?: boolean;
  decodeTransfer?: () => unknown;
  saveDuringReadback?: boolean;
}

function runHandoff(options: FixtureOptions = {}): ReturnType<typeof sendStage4WorkflowResultToChat> {
  const events = new EventEmitter();
  const origin = 'http://127.0.0.1:5000';
  const mainFrame = {};
  let saveAborted = false;
  const request = (method: string, path: string, decode = (): unknown => null): Request => ({
    method: () => method,
    url: () => origin + path,
    frame: () => mainFrame,
    isNavigationRequest: () => path.startsWith('/simple-chat?'),
    postDataJSON: decode,
  }) as unknown as Request;
  const save = Object.assign(request('POST', '/api/workflow/save', () => ({ userId: scope.actorId, workflow: graph })), {
    failure: () => saveAborted ? { errorText: 'net::ERR_ABORTED' } : null,
  });
  const navigation = request('GET', `/simple-chat?${new URLSearchParams({
    assetProjectId: scope.assetProjectId, projectId: scope.chatProjectId,
    workflowVersionId: scope.assetVersionId, workflowId: scope.workflowId,
    workflowExecutionId: scope.executionId, workflowOutputNodeId: scope.outputNodeId,
    workflowOutputLabel: 'Output',
  })}`);
  const transfer = request('POST', '/api/assets/transfer', options.decodeTransfer ?? (() => returnedTransfer));
  const respond = (completed: Request): void => {
    events.emit('request', completed);
    events.emit('response', {
      request: () => completed, status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }),
    });
  };
  const abort = (): void => {
    saveAborted = true;
    events.emit('requestfailed', save);
  };
  const page = {
    url: () => origin + '/', mainFrame: () => mainFrame,
    on: events.on.bind(events), off: events.off.bind(events),
    waitForResponse: (predicate: (response: Response) => boolean) => new Promise<Response>(resolve => {
      const onResponse = (response: Response): void => {
        if (!predicate(response)) return;
        events.off('response', onResponse);
        resolve(response);
      };
      events.on('response', onResponse);
    }),
    request: { get: async () => {
      if (options.saveDuringReadback) events.emit('request', request('POST', '/api/workflow/save'));
      return { status: () => 200, json: async () => ({ workflows: [{ ...graph, updatedAt: 2 }] }) };
    } },
  } as unknown as Page;

  return sendStage4WorkflowResultToChat(page, scope, async () => {
    respond(save);
    if (options.transferBeforeNavigation) {
      events.emit('requestfinished', save);
      respond(transfer);
      respond(navigation);
      return;
    }
    if (options.abortBeforeNavigation) abort();
    respond(navigation);
    if (!options.abortBeforeNavigation) abort();
    respond(transfer);
  });
}

describe('Stage 4 workflow chat handoff evidence', () => {
  it('accepts the exact acknowledged save abort during the matched handoff', async () => {
    const result = await runHandoff();
    expect(result.acknowledgedSaveAbort?.failure()).toEqual({ errorText: 'net::ERR_ABORTED' });
    expect(result.transfer.status()).toBe(200);
  });

  it('rejects a save abort that arrives before navigation starts', async () => {
    await expect(runHandoff({ abortBeforeNavigation: true })).rejects.toThrow('Workflow save abort must follow the matched chat navigation');
  });

  it('rejects even an exact return transfer before navigation starts', async () => {
    await expect(runHandoff({ transferBeforeNavigation: true })).rejects.toThrow('Workflow chat transfer started before the matched navigation');
  });

  it.each([
    ['source version', { sourceVersion: 'other-version' }],
    ['target project', { targetProject: 'other-canvas' }],
    ['execution and output entity', { entityId: 'workflow-return:other-execution:other-output' }],
    ['workflow metadata', { metadata: { ...returnedTransfer.metadata, workflowId: 'other-workflow' } }],
  ])('rejects a mismatched %s on the returned transfer', async (_field, override) => {
    await expect(runHandoff({ decodeTransfer: () => ({ ...returnedTransfer, ...override }) }))
      .rejects.toThrow('Workflow chat transfer did not match the expected handoff');
  });

  it('reports invalid transfer JSON without including the raw parsing error', async () => {
    await expect(runHandoff({ decodeTransfer: () => { throw new SyntaxError('synthetic raw request body'); } }))
      .rejects.toThrow(/^Workflow chat transfer request has invalid JSON$/);
  });

  it('rejects a second save that starts during graph readback', async () => {
    await expect(runHandoff({ saveDuringReadback: true })).rejects.toThrow('Expected one workflow save after graph readback');
  });
});
