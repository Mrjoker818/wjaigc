import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { canAccessAgentTask } from '@/lib/agent-task-access';

describe('agent task access policy', () => {
  it('allows the task owner and administrators only', () => {
    expect(canAccessAgentTask('user-a', 'user-a', 'user')).toBe(true);
    expect(canAccessAgentTask('user-a', 'admin-a', 'admin')).toBe(true);
    expect(canAccessAgentTask('user-a', 'user-b', 'user')).toBe(false);
  });

  it('fails closed when a task does not have a known owner', () => {
    expect(canAccessAgentTask(undefined, 'user-a', 'user')).toBe(false);
  });

  it('requires authenticated ownership checks for agent task reads and cancellations', () => {
    const source = readFileSync(path.resolve(
      process.cwd(),
      'src/lib/agent-runtime/agent-edit-execution-service.ts',
    ), 'utf8');
    const getHandler = source.indexOf('export async function GET');
    const auth = source.indexOf('requireApiAuthOrReject(request)', getHandler);
    const cancel = source.indexOf("action === 'cancel'", getHandler);
    const ownership = source.indexOf('canAccessAgentTask(task.userId, authResult.userId, authResult.userRole)', getHandler);

    expect(auth).toBeGreaterThan(getHandler);
    expect(ownership).toBeGreaterThan(cancel);
    expect(source).toContain('userId: authResult.userId');
  });

  it('uses an explicit tool allowlist and bounded rounds for agent editing', () => {
    const source = readFileSync(path.resolve(
      process.cwd(),
      'src/lib/agent-runtime/agent-edit-execution-service.ts',
    ), 'utf8');

    expect(source).toContain('const AGENT_EDIT_ALLOWED_TOOLS');
    expect(source).toContain('allowedTools: AGENT_EDIT_ALLOWED_TOOLS');
    expect(source).toContain('MAX_AGENT_EDIT_ROUNDS');
  });
});
