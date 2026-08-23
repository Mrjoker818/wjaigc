import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('default project media', () => {
  it('uses application-owned assets instead of third-party image URLs', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/lib/user-manager.ts'), 'utf8');
    const start = source.indexOf('private createDemoProjects(');
    const end = source.indexOf('\n  getProjects(): Project[]', start);
    const createDemoProjects = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(createDemoProjects).not.toContain('https://');
    expect(createDemoProjects).toContain("url: '/gallery/");
  });
});
