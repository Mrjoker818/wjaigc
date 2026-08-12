import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/chat-panel.tsx'),
  'utf8',
);

describe('chat panel generation recovery contract', () => {
  it('settles every resumable slot without aborting siblings after one failure', () => {
    const recoveryStart = source.indexOf('const pendingMessages = messagesRef.current');
    const recoveryEnd = source.indexOf('// 新建对话', recoveryStart);
    const recoverySource = source.slice(recoveryStart, recoveryEnd);

    expect(recoverySource).toContain('await settleChatGenerationSlots(');
    expect(recoverySource).toContain('const settlements =');
    expect(recoverySource).not.toContain('if (terminalError) break;');
    expect(recoverySource).toContain('pendingGenerationTasks: undefined');
  });

  it('surfaces partial failures while preserving successful sibling images', () => {
    const recoveryStart = source.indexOf('const settlements = await settleChatGenerationSlots(');
    const recoveryEnd = source.indexOf('// 新建对话', recoveryStart);
    const recoverySource = source.slice(recoveryStart, recoveryEnd);

    expect(recoverySource).toContain('upsertChatGenerationSlotImage(');
    expect(recoverySource).toContain('generatedImages: mergeRecoveredImages(');
    expect(recoverySource).toContain('await addGeneratedImageToCanvas(settlement.result, recoveredMessage)');
    expect(recoverySource).not.toContain('onAddImages?.([settlement.result])');
    expect(recoverySource).toContain('.flatMap(settlement => settlement.error');
    expect(recoverySource).toContain('generateError: terminalError || undefined');
  });
});
