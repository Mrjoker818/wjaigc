import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/components/version-history-panel.tsx'),
  'utf8',
);

describe('VersionHistoryPanel accessibility contract', () => {
  it('exposes the lazy panel as a named dialog with a labelled close control', () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-label="版本历史"');
    expect(source).toContain('aria-label="关闭版本历史"');
  });
});
