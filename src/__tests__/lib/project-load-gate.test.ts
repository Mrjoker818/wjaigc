import { describe, expect, it } from 'vitest';

import { createLatestProjectLoadGate } from '@/lib/collaboration/project-load-gate';

describe('latest project load gate', () => {
  it('keeps a delayed invited-project response from replacing a later selection', async () => {
    const gate = createLatestProjectLoadGate();
    let finishInvited: ((project: string) => void) | undefined;
    const invited = gate.resolve(() => new Promise<string>(resolve => { finishInvited = resolve; }));
    const selected = await gate.resolve(async () => 'selected-project');
    finishInvited?.('stale-invited-project');
    const stale = await invited;

    const applied: string[] = [];
    if (selected.isCurrent()) applied.push(selected.value);
    if (stale.isCurrent()) applied.push(stale.value);
    expect(applied).toEqual(['selected-project']);
  });
});
