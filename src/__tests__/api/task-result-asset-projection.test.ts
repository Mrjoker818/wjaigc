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
    expect(route).toContain("assetProjection?.status === 'projection_pending'");
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
