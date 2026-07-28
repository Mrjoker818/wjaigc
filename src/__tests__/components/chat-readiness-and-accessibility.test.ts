import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const chatSource = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');
const displaySource = readFileSync(resolve(process.cwd(), 'src/components/display3d-panel.tsx'), 'utf8');

describe('chat readiness and panel accessibility', () => {
  it('requires a configured chat model before sending messages without opening configuration when Agent is selected', () => {
    expect(chatSource).toContain('const [isAgentMode, setIsAgentMode] = useState(false);');
    expect(chatSource).toContain('const availableChatModels = useMemo(() => {');
    expect(chatSource).toContain('const isChatModelReady = availableChatModels.some((candidate) => candidate.id === model);');
    expect(chatSource).toMatch(
      /if \(!isChatModelReady\) \{\s+setShowThirdPartyDialog\(true\);\s+return;\s+\}/,
    );
    expect(chatSource).toMatch(
      /onClick=\{\(\) => \{\s+setIsAgentMode\(\(enabled\) => !enabled\);\s+\}\}/,
    );
    expect(chatSource).toContain('disabled={!input.trim() || isLoading || !isChatModelReady}');
  });

  it('labels display panel title-bar icon buttons for assistive technology', () => {
    expect(displaySource).toContain('aria-label={isMinimized ? \'展开 3D 展陈系统\' : \'最小化 3D 展陈系统\'}');
    expect(displaySource).toContain('aria-label="关闭 3D 展陈系统"');
  });
});
