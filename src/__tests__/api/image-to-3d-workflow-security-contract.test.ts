import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');
}

describe('image-to-3d workflow security contract', () => {
  it('preserves signed internal user identity when creating a 3D task', () => {
    const route = readSource('src/app/api/image-to-3d/route.ts');

    expect(route).toContain("import { getRequestUser } from '@/lib/api-auth'");
    expect(route).not.toContain("import { getSessionUser } from '@/lib/server-auth'");
    expect(route).toMatch(/const requestUser = await getRequestUser\(request\);[\s\S]*if \(!requestUser\)[\s\S]*status: 401/);
    expect(route).toContain('sessionUser = requestUser.user');
    expect(route).not.toContain("sessionUser?.id || 'anonymous'");
  });

  it('requires authenticated ownership when polling a 3D task', () => {
    const route = readSource('src/app/api/poll-3d-task/route.ts');

    expect(route).toContain("import { getRequestUser } from '@/lib/api-auth'");
    expect(route).not.toContain("import { getSessionUser } from '@/lib/server-auth'");
    expect(route).toMatch(/const requestUser = await getRequestUser\(request\);[\s\S]*if \(!requestUser\)[\s\S]*status: 401/);
    expect(route).toContain('const sessionUser = requestUser.user');
    expect(route).toMatch(/const persistedTask = await getCloudTaskById\(requestedBody\.taskId\);[\s\S]*if \(!persistedTask\)[\s\S]*status: 404/);
    expect(route).toMatch(/if \(persistedTask\.userId !== sessionUser\.id\)/);
    expect(route).not.toContain('persistedTask?.id || body.taskId');
    expect(route).toContain('providerId: persistedTask.providerId');
    expect(route).toContain('model: persistedTask.model');
  });

  it('uses a stable workflow idempotency key across ambiguous submit retries', () => {
    const route = readSource('src/app/api/workflow/execute/route.ts');

    expect(route).toContain('const taskIdempotencyKey = `workflow:${sourceEntityId}`');
    expect(route).toContain("trackedHeaders.set('idempotency-key', taskIdempotencyKey)");
    expect(route).toContain("trackedHeaders.set('x-idempotency-key', taskIdempotencyKey)");
    expect(route).not.toContain('`workflow:${executionId}:${node.id}:${attemptCount}`');
    expect(route).toContain('`${executionId}:${retryNode.id}:attempt:${retryAttempt}`');
  });

  it('gives 3D provider submission the same long timeout as other generators', () => {
    const route = readSource('src/app/api/workflow/execute/route.ts');

    expect(route).toMatch(
      /const isGenerateEndpoint = [^\n]+submitUrl\.includes\('\/api\/image-to-3d'\)/,
    );
  });
});
