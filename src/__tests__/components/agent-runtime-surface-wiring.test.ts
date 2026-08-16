import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Agent runtime surface boundaries', () => {
  it('keeps independent navigation and never shows a user API-key setup path', () => {
    const canvas = source('src/components/chat-panel.tsx');
    const standalone = source('src/components/simple-chat/chat-area.tsx');
    const editor = source('src/components/agent-editor.tsx');

    expect(canvas).not.toContain("window.location.href = '/simple-chat'");
    expect(standalone).toMatch(/window\.open\(\s*`\/\?projectId=\$\{encodeURIComponent\(targetProjectId\)\}`/);
    expect(editor).not.toMatch(/API\s*Key.*(?:配置|设置)|配置.*API\s*Key/);
  });
});
