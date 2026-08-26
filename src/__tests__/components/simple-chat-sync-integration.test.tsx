import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  resolve(process.cwd(), 'src/app/simple-chat/page.tsx'),
  'utf8',
);

describe('simple chat synchronization integration', () => {
  it('does not call the legacy blind sync path', () => {
    expect(pageSource).not.toContain('scheduleChatProjectsSync');
    expect(pageSource).not.toContain('saveProjects(projects)');
    expect(pageSource).toContain('createSimpleChatSyncCoordinator');
    expect(pageSource).toContain("flush('manual')");
  });

  it('creates and initializes one coordinator after session authentication', () => {
    expect(pageSource.match(/createSimpleChatSyncCoordinator\(/gu)).toHaveLength(1);
    expect(pageSource).toContain('createIndexedDbSimpleChatEnvelopeStore()');
    expect(pageSource).toContain('coordinator.initialize(data.user.id)');
    expect(pageSource).toContain('coordinator.subscribe');
  });

  it('routes project changes and explicit task persistence through the coordinator', () => {
    expect(pageSource).toContain('coordinatorRef.current?.update(projects)');
    expect(pageSource).toContain('coordinatorRef.current?.update(next)');
    expect(pageSource).toContain("await coordinatorRef.current?.flush('manual')");
    expect(pageSource).not.toContain("fetch('/api/user-data/sync', {");
  });

  it('renders synchronization state without replacing the chat surface', () => {
    expect(pageSource).toContain('<SimpleChatSyncStatusView');
    expect(pageSource).toContain('status={syncSnapshot.status}');
    expect(pageSource).toContain('<ChatArea');
  });
});
