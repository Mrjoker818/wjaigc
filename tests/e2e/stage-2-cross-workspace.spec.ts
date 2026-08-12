import {
  expect,
  loginRealUser,
  openCanvasProject,
  postJson,
  requireStage2Env,
  test,
} from '../helpers/stage-2-e2e';

function transferBody(input: {
  sourceVersion: string;
  projectId: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
}) {
  return {
    sourceVersion: input.sourceVersion,
    targetProject: input.projectId,
    targetWorkspace: input.workspaceId,
    entityType: input.entityType,
    entityId: input.entityId,
    idempotencyKey: `stage-2-e2e:${input.workspaceId}:${input.entityId}:${input.sourceVersion}`,
    metadata: { source: 'stage-2-e2e' },
  };
}

test.describe('Stage 2 cross-workspace flows', () => {
  test('bridges a canvas image through embedded chat back onto the canvas', async ({ page, stage2Evidence }) => {
    const env = requireStage2Env(
      'E2E_STAGE2_SOURCE_VERSION_ID',
      'E2E_STAGE2_EMBEDDED_CHAT_RESULT_VERSION_ID',
      'E2E_STAGE2_PROJECT_ID',
    );
    await loginRealUser(page);
    const chat = await postJson(page, '/api/assets/transfer', transferBody({
      sourceVersion: env.E2E_STAGE2_SOURCE_VERSION_ID,
      projectId: env.E2E_STAGE2_PROJECT_ID,
      workspaceId: `embedded-chat:${env.E2E_STAGE2_PROJECT_ID}`,
      entityType: 'chat-attachment',
      entityId: 'stage-2-embedded-chat-input',
    }));
    const canvas = await postJson(page, '/api/assets/transfer', transferBody({
      sourceVersion: env.E2E_STAGE2_EMBEDDED_CHAT_RESULT_VERSION_ID,
      projectId: env.E2E_STAGE2_PROJECT_ID,
      workspaceId: env.E2E_STAGE2_PROJECT_ID,
      entityType: 'canvas-image',
      entityId: 'stage-2-embedded-chat-result',
    }));
    stage2Evidence.recordPayload({ chat, canvas });
    expect(canvas.assetVersionId).toBeTruthy();
    expect(canvas.assetVersionId).not.toBe(chat.assetVersionId);
    await openCanvasProject(page, env.E2E_STAGE2_PROJECT_ID);
    await expect(page.locator('[data-canvas-viewport] img[src]').first()).toBeVisible({ timeout: 20_000 });
  });

  test('moves a workflow input and output back to the project canvas', async ({ page, stage2Evidence }) => {
    const env = requireStage2Env('E2E_STAGE2_SOURCE_VERSION_ID', 'E2E_STAGE2_WORKFLOW_OUTPUT_VERSION_ID', 'E2E_STAGE2_PROJECT_ID', 'E2E_STAGE2_WORKFLOW_ID');
    await loginRealUser(page);
    const input = await postJson(page, '/api/assets/transfer', transferBody({
      sourceVersion: env.E2E_STAGE2_SOURCE_VERSION_ID,
      projectId: env.E2E_STAGE2_PROJECT_ID,
      workspaceId: env.E2E_STAGE2_WORKFLOW_ID,
      entityType: 'workflow-input',
      entityId: 'stage-2-workflow-input',
    }));
    const output = await postJson(page, '/api/assets/transfer', transferBody({
      sourceVersion: env.E2E_STAGE2_WORKFLOW_OUTPUT_VERSION_ID,
      projectId: env.E2E_STAGE2_PROJECT_ID,
      workspaceId: env.E2E_STAGE2_WORKFLOW_ID,
      entityType: 'workflow-output',
      entityId: 'stage-2-workflow-output',
    }));
    const canvas = await postJson(page, '/api/assets/transfer', transferBody({
      sourceVersion: String(output.assetVersionId),
      projectId: env.E2E_STAGE2_PROJECT_ID,
      workspaceId: env.E2E_STAGE2_PROJECT_ID,
      entityType: 'canvas-image',
      entityId: 'stage-2-workflow-canvas-result',
    }));
    stage2Evidence.recordPayload({ input, output, canvas });
    expect(input.placementId).toBeTruthy();
    expect(canvas.url).toBe(output.url);
  });

  test('sends standalone chat media into the designated canvas project', async ({ page, stage2Evidence }) => {
    const env = requireStage2Env('E2E_STAGE2_CHAT_RESULT_VERSION_ID', 'E2E_STAGE2_TARGET_PROJECT_ID');
    await loginRealUser(page);
    const result = await postJson(page, '/api/assets/transfer', transferBody({
      sourceVersion: env.E2E_STAGE2_CHAT_RESULT_VERSION_ID,
      projectId: env.E2E_STAGE2_TARGET_PROJECT_ID,
      workspaceId: env.E2E_STAGE2_TARGET_PROJECT_ID,
      entityType: 'canvas-image',
      entityId: 'stage-2-standalone-chat-result',
    }));
    stage2Evidence.recordPayload(result);
    expect(result.placementId).toBeTruthy();
    await openCanvasProject(page, env.E2E_STAGE2_TARGET_PROJECT_ID);
    await expect(page.locator('[data-canvas-viewport] img[src]').first()).toBeVisible({ timeout: 20_000 });
  });

  test('keeps chat and workflow placements usable after deleting one canvas placement', async ({ page, stage2Evidence }) => {
    const env = requireStage2Env('E2E_STAGE2_SOURCE_VERSION_ID', 'E2E_STAGE2_PROJECT_ID', 'E2E_STAGE2_WORKFLOW_ID');
    await loginRealUser(page);
    const suffix = Date.now().toString(36);
    const chat = await postJson(page, '/api/assets/transfer', transferBody({
      sourceVersion: env.E2E_STAGE2_SOURCE_VERSION_ID,
      projectId: env.E2E_STAGE2_PROJECT_ID,
      workspaceId: `chat:${suffix}`,
      entityType: 'chat-attachment',
      entityId: `chat-${suffix}`,
    }));
    const workflow = await postJson(page, '/api/assets/transfer', transferBody({
      sourceVersion: env.E2E_STAGE2_SOURCE_VERSION_ID,
      projectId: env.E2E_STAGE2_PROJECT_ID,
      workspaceId: env.E2E_STAGE2_WORKFLOW_ID,
      entityType: 'workflow-input',
      entityId: `workflow-${suffix}`,
    }));
    const canvas = await postJson(page, '/api/assets/transfer', transferBody({
      sourceVersion: env.E2E_STAGE2_SOURCE_VERSION_ID,
      projectId: env.E2E_STAGE2_PROJECT_ID,
      workspaceId: env.E2E_STAGE2_PROJECT_ID,
      entityType: 'canvas-image',
      entityId: `canvas-${suffix}`,
    }));
    const deleted = await page.request.delete(`/api/assets/placements/${encodeURIComponent(String(canvas.placementId))}?projectId=${encodeURIComponent(env.E2E_STAGE2_PROJECT_ID)}`);
    expect(deleted.ok()).toBeTruthy();
    for (const placement of [chat, workflow]) {
      const resolved = await page.request.get(`/api/assets?projectId=${encodeURIComponent(env.E2E_STAGE2_PROJECT_ID)}&assetVersionId=${encodeURIComponent(String(placement.assetVersionId))}&placementId=${encodeURIComponent(String(placement.placementId))}`);
      expect(resolved.ok()).toBeTruthy();
    }
    stage2Evidence.recordPayload({ chat, workflow, canvas });
  });
});
