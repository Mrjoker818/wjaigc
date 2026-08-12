import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('task result asset projection wiring', () => {
  it('awaits the non-durable image terminal before returning the completed poll result', () => {
    const route = source('src/app/api/poll-task/route.ts');
    expect(route).not.toMatch(/void\s+recordImageTaskTerminal\(taskId,\s*\{\s*status:\s*'completed'/);
    expect(route).toMatch(/await\s+recordImageTaskTerminal\(taskId,\s*\{\s*status:\s*'completed'/);
    expect(route).toMatch(
      /if\s*\(generationCompletion\)[\s\S]*projectPersistedCompletedTask\(taskId,\s*userId\)/,
    );
    expect(route).toContain("!assetProjection || assetProjection.status === 'projection_pending'");
    expect(route).toContain('let completedTask = await getCloudTaskForUser(taskId, userId);');
    expect(route).toContain('assetProjection: completedResult.assetProjection');
    expect(route).toMatch(
      /await\s+recordImageTaskTerminal\(taskId,[\s\S]*getAuthoritativeCompletedImageResult\([\s\S]*pollResult as Record<string, unknown>\)\.assetProjection/,
    );
  });

  it('normalizes every completed image path through one authoritative projected result', () => {
    const route = source('src/app/api/poll-task/route.ts');

    expect(route).toContain('getAuthoritativeCompletedImageResult');
    expect(route.match(/getAuthoritativeCompletedImageResult\(/g)?.length).toBeGreaterThanOrEqual(5);
    expect(route).toMatch(
      /if\s*\(completedTask\.projectId && \(!assetProjection \|\| assetProjection\.status === 'projection_pending'\)\)[\s\S]*projectPersistedCompletedTask\(taskId,\s*userId\)[\s\S]*getCloudTaskForUser\(taskId,\s*userId\)/,
    );
    expect(route).toMatch(
      /registryTask\.status === 'completed'[\s\S]*getAuthoritativeCompletedImageResult\(\s*taskId,\s*userId/,
    );
    expect(route).toMatch(
      /persistedTask\.status === 'completed'[\s\S]*getAuthoritativeCompletedImageResult\(\s*taskId,\s*userId/,
    );
    expect(route).not.toMatch(/if\s*\(!durableGenerationSlot\)\s*\{\s*const projectedTask/);
  });

  it('keeps direct aggregates and annotation edit completions on the authoritative projection path', () => {
    const route = source('src/app/api/poll-task/route.ts');
    const directAggregate = route.slice(
      route.indexOf('const dedupedImageUrls = Array.from(new Set(aggregatedImageUrls))'),
      route.indexOf('// direct tasks', route.indexOf('const dedupedImageUrls = Array.from(new Set(aggregatedImageUrls))')),
    );
    expect(directAggregate).toContain("await recordImageTaskTerminal(taskId, {");
    expect(directAggregate).toContain('const aggregateTerminal = await recordImageTaskTerminal(taskId, {');
    expect(directAggregate).toContain("aggregateTerminal.task.status !== 'completed'");
    expect(directAggregate).toContain("status: aggregateTerminal?.task.status || 'error'");
    expect(directAggregate).toContain('getAuthoritativeCompletedImageResult(');
    expect(directAggregate).toContain('assetProjection: authoritativeAggregateResult.assetProjection');
    expect(directAggregate).toContain('imageUrl: authoritativeImageUrl');
    expect(directAggregate).toContain('imageUrls: authoritativeImageUrls');

    const annotationCache = route.slice(
      route.indexOf("if (taskId.startsWith('edit_'))"),
      route.indexOf('const remotePollInfo = task.remotePollInfo'),
    );
    expect(annotationCache).toContain('let task = getEditTask(taskId)');
    expect(annotationCache).toContain('if (!task && persistedEditTask)');
    expect(annotationCache).toContain("persistedEditTask.status === 'completed'");
    expect(annotationCache).toContain("persistedEditTask?.status === 'failed'");
    expect(annotationCache).toContain('const persistedRemotePollInfo = persistedResult.remotePollInfo');
    expect(annotationCache).toContain('setEditTask(taskId, recoveredEditTask)');
    expect(annotationCache).toContain('const hasDurableEditTask = Boolean(persistedEditTask && sessionUser)');
    expect(annotationCache).toContain('getAuthoritativeCompletedImageResult(taskId, sessionUser.id');
    expect(annotationCache).toContain('if (hasDurableEditTask && !authoritativeResult)');
    expect(annotationCache).toContain('persistedEditTask?.status');
    expect(annotationCache).toContain('sanitizeCompletedTaskResult(task.result as Record<string, unknown>)');

    const annotationRemote = route.slice(
      route.indexOf('if (remotePollInfo && task.status ==='),
      route.indexOf('//', route.indexOf('if (remotePollInfo && task.status ===') + 1),
    );
    expect(route.match(/authoritativeCompletedResult = await getAuthoritativeCompletedImageResult\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(route.match(/result: authoritativeCompletedResult/g)?.length).toBeGreaterThanOrEqual(4);
    expect(annotationRemote.length).toBeGreaterThan(0);
  });

  it('never lets a caller fallback override a missing or non-completed durable terminal', () => {
    const route = source('src/app/api/poll-task/route.ts');
    const helper = route.slice(
      route.indexOf('async function getAuthoritativeCompletedImageResult('),
      route.indexOf('async function getDurableGenerationSlotResponse('),
    );
    expect(helper).toContain("if (!completedTask || completedTask.status !== 'completed') return null;");
    expect(helper).not.toContain("return fallback || null");
  });

  it('checks the durable terminal winner before publishing a non-slot image completion', () => {
    const route = source('src/app/api/poll-task/route.ts');
    const terminalWrite = route.indexOf('if (!durableGenerationSlot) {', route.indexOf('const completedTaskResult'));
    const auditWrite = route.indexOf("await appendUserJsonl(userId, 'images'");
    const completion = route.slice(terminalWrite, route.indexOf('updateTaskProgress(taskId', terminalWrite));
    expect(completion).toContain('const imageTerminal = await recordImageTaskTerminal(taskId, {');
    expect(completion).toContain("imageTerminal.task.status !== 'completed'");
    expect(completion).toContain("status: imageTerminal?.task.status || 'error'");
    expect(auditWrite).toBeGreaterThan(terminalWrite);
    expect(completion).toContain('if (!authoritativeCompletedResult)');
  });

  it('never publishes an annotation or aggregate completion without an authoritative durable result', () => {
    const route = source('src/app/api/poll-task/route.ts');
    const annotationRemote = route.slice(
      route.indexOf("if (remotePollInfo && task.status === 'processing')"),
      route.indexOf('//', route.indexOf('if (isSuccessStatus && images.length === 0)') + 1),
    );
    const directAggregate = route.slice(
      route.indexOf('const dedupedImageUrls = Array.from(new Set(aggregatedImageUrls))'),
      route.indexOf('// direct tasks', route.indexOf('const dedupedImageUrls = Array.from(new Set(aggregatedImageUrls))')),
    );

    expect(annotationRemote).not.toContain('currentResult || current.result');
    expect(annotationRemote).not.toContain(') || completedResult');
    expect(annotationRemote.match(/if \(!projectedCompletedResult\)/g)?.length || 0).toBeGreaterThanOrEqual(2);
    expect(directAggregate).toContain('if (!projectedAggregateResult)');
  });

  it('uses persisted provider and model metadata on cache and restart recovery responses', () => {
    const route = source('src/app/api/poll-task/route.ts');
    const completedCache = route.slice(
      route.indexOf('const cachedCompleted = completedTaskCache.get(taskId)'),
      route.indexOf('const cachedFailed = failedTaskCache.get(taskId)'),
    );
    const persistedRestart = route.slice(
      route.indexOf("if (persistedTask.status === 'completed' && persistedTask.result?.imageUrl)"),
      route.indexOf("if (persistedTask.status === 'completed' && persistedTask.result?.videoUrl)"),
    );
    const recoveredDirect = route.slice(
      route.indexOf('if (directImageUrls.length > 0)'),
      route.indexOf('const remoteTaskIds = Array.isArray(resumedData.taskIds)'),
    );

    expect(completedCache).toContain("modelName: authoritativeResult.modelName || cachedCompleted.modelName || ''");
    expect(completedCache).toContain("providerName: authoritativeResult.providerName || cachedCompleted.providerName || ''");
    expect(persistedRestart).not.toContain(') || persistedTask.result');
    expect(persistedRestart).toContain("modelName: completedResult.modelName || completedResult.usedModel || persistedTask.model || ''");
    expect(recoveredDirect).toContain('usedModel: resumedData.model || recovery.model');
    expect(recoveredDirect).toContain('modelName: resumedData.modelName || resumedData.model || recovery.model');
    expect(recoveredDirect).toContain('providerName: resumedData.providerName');
  });

  it('does not persist or return provider credentials through annotation and aggregate completion paths', () => {
    const route = source('src/app/api/poll-task/route.ts');
    const helper = route.slice(
      route.indexOf('async function getAuthoritativeCompletedImageResult('),
      route.indexOf('async function getDurableGenerationSlotResponse('),
    );
    const annotationRemote = route.slice(
      route.indexOf("if (remotePollInfo && task.status === 'processing')"),
      route.indexOf('//', route.indexOf('if (isSuccessStatus && images.length === 0)') + 1),
    );
    const directAggregate = route.slice(
      route.indexOf('const aggregateResult: Record<string, unknown> = {'),
      route.indexOf('// direct tasks', route.indexOf('const aggregateResult: Record<string, unknown> = {')),
    );

    expect(helper).toContain('return sanitizeCompletedTaskResult(completedResult);');
    expect(annotationRemote).not.toContain("provider: apiBaseUrl || 'unknown'");
    expect(annotationRemote).not.toContain("provider: remotePollInfo.apiBaseUrl || 'unknown'");
    expect(directAggregate).not.toContain('apiBaseUrl: firstDirectResult?.apiBaseUrl || regResult.apiBaseUrl');

    const editRoute = source('src/app/api/edit/route.ts');
    const finishTask = editRoute.slice(
      editRoute.indexOf('const finishTask = async'),
      editRoute.indexOf('try {', editRoute.indexOf('const finishTask = async')),
    );
    expect(finishTask).toContain('const safeResult = sanitizeEditTaskResult(result)');
    expect(finishTask).toContain('...safeResult');
    expect(finishTask).toContain('result: safeResult');
    expect(editRoute).not.toContain("provider: effectiveBaseUrl || 'unknown'");
    expect(editRoute).toContain('providerId: actualProviderId || undefined');
    expect(editRoute).toContain('providerName: imageProvider?.name || undefined');
    expect(editRoute).toContain('remoteTaskId,');
    expect(editRoute).toContain('remotePollInfo: {');
    expect(editRoute).toContain('providerId: actualProviderId || undefined');
    const durableRemotePoll = editRoute.slice(
      editRoute.indexOf('if (annotationTaskId) {', editRoute.indexOf("parsed.mode === 'polling'")),
      editRoute.indexOf('setEditTask(taskId, {', editRoute.indexOf("parsed.mode === 'polling'")),
    );
    expect(durableRemotePoll).toContain('remoteTaskId,');
    expect(durableRemotePoll).not.toContain('apiBaseUrl: effectiveBaseUrl');

    const editPolling = route.slice(
      route.indexOf("if (taskId.startsWith('edit_'))"),
      route.indexOf('// ★ Layer decomposition tasks'),
    );
    expect(editPolling).not.toContain('isAnnotationEdit');
    expect(editPolling.match(/hasDurableEditTask/g)?.length || 0).toBeGreaterThanOrEqual(5);
    expect(editPolling).toContain("taskStatus === 'cancelled'");
    expect(editPolling).toContain("taskStatus === 'timeout'");
    expect(editPolling).toContain('const settlement = await terminateCloudTaskAndRefund(');
    expect(editPolling).toContain('if (settlement.transitioned) return null');
    expect(editPolling).toContain("if (current?.status === 'completed')");
    expect(editPolling).toContain('status: persistedEditTask.status');
  });

  it('sanitizes main image and video completions before persistence, memory, and response boundaries', () => {
    const route = source('src/app/api/poll-task/route.ts');
    const helper = route.slice(
      route.indexOf('function sanitizeCompletedTaskResult('),
      route.indexOf('async function getAuthoritativeCompletedImageResult('),
    );
    const video = route.slice(
      route.indexOf("if (registryTask.type === 'video')"),
      route.indexOf('// direct tasks', route.indexOf("if (registryTask.type === 'video')")),
    );
    const mainImage = route.slice(
      route.indexOf('const completedTaskResult = sanitizeCompletedTaskResult({'),
      route.indexOf('const cachedImageUrl = imageUrls[0]'),
    );

    expect(helper).toContain('apiKey: _apiKey');
    expect(helper).toContain('apiBaseUrl: _apiBaseUrl');
    expect(helper).toContain('baseUrl: _baseUrl');
    expect(helper).toContain('advancedParams: _advancedParams');
    expect(helper).toMatch(/sanitizeCompletedTaskResult\(submissionPayload(?: as Record<string, unknown>)?\)/);
    expect(helper).toContain('const sanitizedProvider = isProviderUrlAlias ? undefined : provider');
    expect(video).toContain('sanitizeCompletedTaskResult(registryTask.result as Record<string, unknown>)');
    expect(video).toContain('const completedResult = sanitizeCompletedTaskResult({');
    expect(video).not.toContain("(({ apiKey: _ak, apiBaseUrl: _abu, ...rest }) => rest)");
    expect(mainImage).toContain('const completedTaskResult = sanitizeCompletedTaskResult({');
    expect(mainImage).toContain('updateTaskProgress(taskId, { status: \'completed\', progress: 100, result: authoritativeCompletedResult })');
    expect(mainImage).not.toContain('Object.assign(completedTaskResult, authoritativeCompletedResult)');

    const registryCompleted = route.slice(
      route.indexOf("if (registryTask.status === 'completed')"),
      route.indexOf("if (registryTask.type === 'video')"),
    );
    expect(registryCompleted).toContain('const safeResult = sanitizeCompletedTaskResult(');
    expect(registryCompleted).toContain('}, safeResult, taskId)');

    const recoveryDirect = route.slice(
      route.indexOf('if (directImageUrls.length > 0)'),
      route.indexOf('const remoteTaskIds = Array.isArray(resumedData.taskIds)'),
    );
    expect(recoveryDirect).toContain('const completedResult = sanitizeCompletedTaskResult({');
  });

  it('projects asynchronous standalone chat results with the provider task identity', () => {
    const route = source('src/app/api/simple-chat/chat/route.ts');
    expect(route).toContain('projectCompletedTaskToAssets');
    expect(route).toMatch(/sendGeneratedImage\(pollData\.imageUrl,\s*imgPrompt,\s*taskId\)/);
    expect(route).toContain("sessionId: `standalone-chat:${body.projectId}`");
    expect(route).toContain('sourceEntityId: body.responseMessageId');
    expect(route).not.toContain('sourceEntityId: `${body.responseMessageId}:${authoritativeTaskId}`');
  });

  it('passes workflow identity to each authoritative child task without projecting the aggregate', () => {
    const route = source('src/app/api/workflow/execute/route.ts');
    expect(route).not.toContain('projectCompletedTaskToAssets');
    expect(route).toContain('projectId: execState.projectId');
    expect(route).toContain("sessionId: `workflow:${execState.projectId}`");
    expect(route).toContain('sourceEntityId = `${executionId}:${node.id}`');
    expect(route).toContain('messageId: sourceEntityId');
    expect(route).toContain('`${executionId}:${node.id}:scene:${si}`');
    expect(route).toContain("trackedHeaders.set('x-idempotency-key'");
    expect(route).not.toMatch(/const sceneResult = await executeAsyncTask\(/);

    const videoRoute = source('src/app/api/video/generate/route.ts');
    expect(videoRoute).toMatch(/projectId,\s*sessionId,\s*messageId/);
    expect(videoRoute).toContain('sessionId: typeof sessionId');
    expect(videoRoute).toContain('messageId: typeof messageId');

    const videoExtendRoute = source('src/app/api/video/extend/route.ts');
    expect(videoExtendRoute).toMatch(/projectId,\s*sessionId,\s*messageId/);
    expect(videoExtendRoute).toContain('sessionId: typeof sessionId');
    expect(videoExtendRoute).toContain('messageId: typeof messageId');

    const persistence = source('src/lib/cloud-task-persistence.ts');
    expect(persistence).toMatch(/interface VideoTaskSubmission[\s\S]*sessionId\?: string;[\s\S]*messageId\?: string;/);
    expect(persistence).toMatch(/recordVideoTaskSubmitted[\s\S]*sessionId: input\.sessionId,[\s\S]*messageId: input\.messageId,/);
    expect(persistence).toContain('mergeResult: true');

    const editRoute = source('src/app/api/edit/route.ts');
    expect(editRoute).toContain('projectId, sessionId, messageId');
    expect(editRoute).toContain('projectPersistedCompletedTask(taskId, authResult.userId)');
    expect(editRoute).toMatch(/updateCloudTask\(taskId,[\s\S]*mergeResult:\s*true/);

    const imageEditRoute = source('src/app/api/image-edit/route.ts');
    expect(imageEditRoute).toContain('projectId?: string');
    expect(imageEditRoute).toContain('projectPersistedCompletedTask(upscaleCreditTaskId, sessionUser.id)');

    const threeDRoute = source('src/app/api/image-to-3d/route.ts');
    expect(threeDRoute).toMatch(/projectId\?: string;[\s\S]*sessionId\?: string;[\s\S]*messageId\?: string;/);
    expect(threeDRoute).toContain('sessionId: body.sessionId');
    expect(threeDRoute).toContain('messageId: body.messageId');

    const workflowEngine = source('src/lib/workflow-engine.ts');
    expect(workflowEngine).toMatch(/case 'ai-3d-model'[\s\S]*endpoint: '\/api\/image-to-3d'/);
    expect(workflowEngine).not.toMatch(/case 'ai-3d-model'[\s\S]*endpoint: '\/api\/poll-3d-task'/);
    expect(route).toContain("'/api/image-to-3d'");
    expect(route).toContain("nodeType === 'ai-3d-model'");
    expect(route).toContain("'/api/poll-3d-task'");
  });

  it('projects only the winning completed agent transition and marks projection failures pending', () => {
    const persistence = source('src/lib/agent-task-persistence.ts');
    expect(persistence).toContain('projectCompletedTaskToAssets');
    expect(persistence).toMatch(/if\s*\(terminal\.transitioned\)[\s\S]*projectCompletedTaskToAssets/);
    expect(persistence).toContain('recordTaskProjectionPending');
  });

  it('retries projection_pending tasks through the existing project recovery endpoint', () => {
    const route = source('src/app/api/tasks/recover/route.ts');
    expect(route).toContain("assetProjection?.status === 'projection_pending'");
    expect(route).toContain('projectPersistedCompletedTask(task.id, user.id)');
  });
});
