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
    expect(source).toContain("selectedNode ? 'absolute inset-y-0 right-0 z-50 flex w-[min(20rem,90vw)] shadow-2xl' : 'hidden'");
    expect(source).toContain('md:flex md:w-72 md:shadow-none');
    expect(source).toContain('aria-label="关闭节点属性"');
    expect(source).toContain('onClick={() => setSelectedNodeIds(new Set())}');
  });

  it('marks only known layout chrome as workflow canvas occlusion', () => {
    expect(source.match(/data-workflow-ui-occlusion/g)).toHaveLength(3);
    expect(source).toMatch(/data-workflow-minimap\s+data-workflow-ui-occlusion/);
    expect(source).toContain('<aside');
    expect(source).toContain('data-workflow-ui-occlusion');
    expect(source).toMatch(/<div data-workflow-ui-occlusion className="shrink-0 border-t/);
  });
});
