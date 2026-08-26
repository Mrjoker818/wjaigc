import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageSource = readFileSync(resolve(process.cwd(), 'src/app/simple-chat/page.tsx'), 'utf8');

describe('simple chat page lifecycle contract', () => {
  it('connects pagehide and connectivity events to the active coordinator', () => {
    expect(pageSource).toContain("flush('pagehide')");
    expect(pageSource).toContain('handleOnline()');
    expect(pageSource).toContain("addEventListener('pagehide'");
    expect(pageSource).toContain("addEventListener('online'");
    expect(pageSource).toContain("addEventListener('offline'");
    expect(pageSource).toContain("removeEventListener('pagehide'");
    expect(pageSource).toContain("removeEventListener('online'");
    expect(pageSource).toContain("removeEventListener('offline'");
  });

  it('flushes logout through the coordinator and removes the legacy snapshot write', () => {
    expect(pageSource).toContain('stageLocalProjectsForRecovery(candidate.projects)');
    expect(pageSource).toContain("await coordinator.flush('logout')");
    expect(pageSource).not.toContain('saveProjects(snapshot)');
    expect(pageSource).not.toContain('projects: snapshot');
  });

  it('keeps cookie-changing account transitions on the no-flush isolation path', () => {
    expect(pageSource).toContain('dispose({ flush: false })');
    expect(pageSource).toContain('await coordinatorTransitionRef.current');
    expect(pageSource).toContain('coordinatorTransitionRef.current = disposal.catch');
    expect(pageSource).toContain("coordinator.flush('user-switch')");
    expect(pageSource).toContain('latestUserIdRef.current === userId');
  });
});
