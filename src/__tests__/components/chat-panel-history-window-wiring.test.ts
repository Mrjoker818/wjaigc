import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');

describe('chat panel history windowing', () => {
  it('targets the real message scroller and bounds rendered message history', () => {
    expect(source).toContain('const messageListRef = useRef<HTMLDivElement>(null)');
    expect(source).toContain('const CHAT_RENDER_WINDOW = 80');
    expect(source).toContain('const visibleMessages = useMemo');
    expect(source).toContain('visibleMessages.map(message =>');
    expect(source).toContain('ref={messageListRef}');
    expect(source).toContain('onScroll={handleMessageListScroll}');
  });
});
