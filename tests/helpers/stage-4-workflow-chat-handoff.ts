import { expect, type Page, type Request, type Response } from '@playwright/test';

import { parseWorkflowChatReturnIntent } from '../../src/lib/asset-core/workflow-chat-return';

interface WorkflowChatHandoffScope {
  actorId: string;
  assetProjectId: string;
  chatProjectId: string;
  workflowId: string;
  executionId: string;
  outputNodeId: string;
  assetVersionId: string;
}

interface WorkflowChatHandoff {
  transfer: Response;
  acknowledgedSaveAbort: Request | undefined;
}

export async function sendStage4WorkflowResultToChat(
  page: Page,
  scope: WorkflowChatHandoffScope,
  clickSend: () => Promise<void>,
): Promise<WorkflowChatHandoff> {
  const origin = new URL(page.url()).origin;
  const saveUrl = `${origin}/api/workflow/save`;
  const transferUrl = `${origin}/api/assets/transfer`;
  const isChatNavigation = (request: Request): boolean => {
    if (request.method() !== 'GET' || !request.isNavigationRequest() || request.frame() !== page.mainFrame()) return false;
    const url = new URL(request.url());
    if (url.origin !== origin || url.pathname !== '/simple-chat') return false;
    const intent = parseWorkflowChatReturnIntent(url.search);
    return intent?.assetProjectId === scope.assetProjectId && intent.workflowId === scope.workflowId
      && intent.executionId === scope.executionId && intent.outputNodeId === scope.outputNodeId
      && intent.sourceVersionId === scope.assetVersionId;
  };
  const handoffSaveRequests = new Set<Request>();
  const finishedSaveRequests = new Set<Request>();
  let saveResponse: Response | undefined;
  let chatNavigationAfterSave: Request | undefined;
  let returnedTransferRequest: Request | undefined;
  let saveAbortedDuringNavigation = false;
  let transferError: Error | undefined;
  let rejectHandoff!: (error: Error) => void;
  const invalidHandoff = new Promise<never>((_, reject) => { rejectHandoff = reject; });
  const failTransfer = (message: string): void => {
    transferError ??= new Error(message);
    rejectHandoff(transferError);
  };
  const onRequest = (request: Request): void => {
    if (request.method() === 'POST' && request.url() === saveUrl && request.frame() === page.mainFrame()) {
      handoffSaveRequests.add(request);
    }
    if (!chatNavigationAfterSave && saveResponse?.status() === 200 && isChatNavigation(request)) {
      chatNavigationAfterSave = request;
    }
    if (request.method() !== 'POST' || request.url() !== transferUrl || request.frame() !== page.mainFrame()) return;
    if (!chatNavigationAfterSave) {
      failTransfer('Workflow chat transfer started before the matched navigation');
      return;
    }
    let body: Record<string, unknown> | null;
    try {
      body = request.postDataJSON() as Record<string, unknown> | null;
    } catch {
      failTransfer('Workflow chat transfer request has invalid JSON');
      return;
    }
    const metadata = body?.metadata as Record<string, unknown> | undefined;
    if (returnedTransferRequest || body?.entityType !== 'chat-result'
      || body.sourceVersion !== scope.assetVersionId || body.targetProject !== scope.assetProjectId
      || body.targetWorkspace !== `standalone-chat:${scope.chatProjectId}`
      || body.entityId !== `workflow-return:${scope.executionId}:${scope.outputNodeId}`
      || metadata?.workflowId !== scope.workflowId || metadata.executionId !== scope.executionId
      || metadata.outputNodeId !== scope.outputNodeId) {
      failTransfer('Workflow chat transfer did not match the expected handoff');
      return;
    }
    returnedTransferRequest = request;
  };
  const onFailed = (request: Request): void => {
    // Chromium can report cancellation after the new document's headers arrive.
    if (request === saveResponse?.request() && chatNavigationAfterSave && !returnedTransferRequest) {
      saveAbortedDuringNavigation = true;
    }
  };
  const onFinished = (request: Request): void => {
    if (handoffSaveRequests.has(request)) finishedSaveRequests.add(request);
  };
  page.on('request', onRequest);
  page.on('requestfailed', onFailed);
  page.on('requestfinished', onFinished);
  try {
    const [saved, chatDocument, transfer] = await Promise.race([
      Promise.all([
        page.waitForResponse(response => {
          if (!handoffSaveRequests.has(response.request())) return false;
          saveResponse = response;
          return true;
        }),
        page.waitForResponse(response => response.request() === chatNavigationAfterSave),
        page.waitForResponse(response => response.request() === returnedTransferRequest),
        clickSend(),
      ]),
      invalidHandoff,
    ]);

    expect(handoffSaveRequests.size, 'Expected one new workflow save during the handoff').toBe(1);
    expect(saved.status()).toBe(200);
    expect(saved.headers()['content-type']).toMatch(/^application\/json(?:;|$)/i);
    expect(chatDocument.status()).toBe(200);
    const request = saved.request();
    let submitted: { userId: string; workflow: Record<string, unknown> };
    try {
      submitted = request.postDataJSON() as typeof submitted;
    } catch {
      throw new Error('Workflow save request has invalid JSON');
    }
    expect(submitted).toMatchObject({
      userId: scope.actorId,
      workflow: {
        id: scope.workflowId,
        projectId: scope.assetProjectId,
        nodes: expect.arrayContaining([expect.objectContaining({ id: scope.outputNodeId, type: 'output-image' })]),
      },
    });

    await expect.poll(() => finishedSaveRequests.has(request) || request.failure() !== null, {
      message: 'Workflow save must either finish or report its exact transport failure',
    }).toBe(true);
    const failure = request.failure();
    if (failure) {
      expect(failure.errorText).toBe('net::ERR_ABORTED');
      expect(saveAbortedDuringNavigation, 'Workflow save abort must follow the matched chat navigation and precede the return transfer').toBe(true);
    }

    // Navigation can evict the old response body even after requestfinished. Verify the graph from storage.
    const readback = await page.request.get(saveUrl);
    expect(readback.status()).toBe(200);
    const { workflows } = await readback.json() as { workflows: Array<Record<string, unknown>> };
    const matches = workflows.filter(workflow => workflow.id === scope.workflowId && workflow.projectId === scope.assetProjectId);
    expect(matches).toEqual([{ ...submitted.workflow, updatedAt: expect.any(Number) }]);
    expect(handoffSaveRequests.size, 'Expected one workflow save after graph readback').toBe(1);
    if (transferError) throw transferError;

    return { transfer, acknowledgedSaveAbort: failure ? request : undefined };
  } finally {
    page.off('request', onRequest);
    page.off('requestfailed', onFailed);
    page.off('requestfinished', onFinished);
  }
}
