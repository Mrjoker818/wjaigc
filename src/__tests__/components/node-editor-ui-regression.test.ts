import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');

describe('node editor UI regressions', () => {
  it('renders a controlled AI build dialog from the toolbar entry', () => {
    expect(source).toContain('const [aiBuildOpen, setAiBuildOpen] = useState(false);');
    expect(source).toContain('const [aiBuildLoading, setAiBuildLoading] = useState(false);');
    expect(source).toContain('const handleAiBuild = useCallback(async () => {');
    expect(source).toContain("fetch('/api/workflow/ai-build'");
    expect(source).toContain('body: JSON.stringify({ description: aiBuildInput })');
    expect(source).toContain('onClick={() => void handleAiBuild()}');
    expect(source).toContain('{aiBuildOpen && (');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-label="关闭 AI 建图"');
  });

  it('keeps the mobile workflow canvas clear of permanent sidebars', () => {
    expect(source).toContain('overflow-x-auto');
    expect(source).toContain('md:relative');
    expect(source).toContain('hidden md:flex w-72');
  });

  it('marks only known layout chrome as workflow canvas occlusion', () => {
    expect(source.match(/data-workflow-ui-occlusion/g)).toHaveLength(3);
    expect(source).toMatch(/data-workflow-minimap\s+data-workflow-ui-occlusion/);
    expect(source).toMatch(/<aside data-workflow-ui-occlusion/);
    expect(source).toMatch(/<div data-workflow-ui-occlusion className="shrink-0 border-t/);
  });
});
