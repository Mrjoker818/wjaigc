import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/chat-area.tsx'),
  'utf8',
);
const canvasEditorSource = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/canvas-editor.tsx'),
  'utf8',
);

describe('simple-chat strict SSE integration', () => {
  it('uses the shared consumer in all three streaming entries', () => {
    expect(source).toContain("from '@/lib/simple-chat-sse'");
    expect(source.match(/consumeSimpleChatJsonStream\(/g)).toHaveLength(3);
    expect(source).not.toContain("buffer.split('\\n')");
    expect(source).not.toContain('catch { /* skip */ }');
  });

  it('connects CanvasEditor to the three-argument streaming editor', () => {
    expect(source).toContain('onAiEdit={canvasAiEdit}');
    expect(source).not.toContain('stream: false');
    expect(source).toContain(
      'async function canvasAiEdit(instruction: string, currentContent: string, selectedText: string)',
    );
    expect(source).toContain("parsed.type === 'text' || parsed.type === 'content'");
    expect(canvasEditorSource).toContain('onAiEdit(aiInstruction, content, selectedText)');
  });
});
