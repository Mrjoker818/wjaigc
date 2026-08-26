import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'tests/e2e/stage5-simple-chat-gate.spec.ts'),
  'utf8',
);

describe('stage5 simple-chat browser gate contract', () => {
  it('covers narrow mobile menu geometry at 320px and 375px', () => {
    expect(source).toContain('viewport: { width: 320, height: 568 }');
    expect(source).toContain('viewport: { width: 375, height: 667 }');
  });

  it('blocks browser-originated chat project writes before seeding real account data', () => {
    expect(source).toContain('async function blockBrowserChatProjectWrites');
    expect(source).toContain("payload?.key === CHAT_PROJECTS_SYNC_KEY");
    expect(source).toContain('await blockBrowserChatProjectWrites(page);');
    expect(source).toContain('CHAT_PROJECT_WRITE_BLOCKED_FOR_E2E');
  });

  it('discovers the conflict-safe simple-chat synchronization scenarios', () => {
    for (const scenario of [
      'remote deletion is not resurrected by a stale second tab',
      'offline edits resume without losing completed messages',
      'refresh restores persisted projects and completed messages',
      'concurrent tabs preserve a conflict copy instead of overwriting remote edits',
      "account isolation never exposes another account's projects",
      'sync status UI reports offline, syncing, conflict, and synced states',
    ]) {
      expect(source).toContain(scenario);
    }
  });

  it('uses revision-aware fixture writes and restores through the latest CAS revision', () => {
    expect(source).toContain('syncRevision: number');
    expect(source).toContain('expectedRevision: before.syncRevision');
    expect(source).toContain('expectedRevision: current.syncRevision');
    expect(source).toContain('blockBrowserWrites = true');
    expect(source).toContain('{ blockBrowserWrites: false }');
    expect(source).toContain('syncRevision: blockedRevision');
  });
});
