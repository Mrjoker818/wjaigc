import { describe, expect, it, vi } from 'vitest';
import { POST as downloadFlowchart } from '@/app/api/flowchart/generate/route';
import { POST as downloadMindmap } from '@/app/api/mindmap/generate/route';

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: vi.fn().mockResolvedValue({ user: { id: 'diagram-test-user' } }),
}));

function diagramRequest(kind: string, body: Record<string, unknown>): Request {
  return new Request('http://127.0.0.1/api/' + kind + '/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('conversation diagram downloads', () => {
  it('uses SVG text labels for a rasterizable flowchart', async () => {
    const response = await downloadFlowchart(diagramRequest('flowchart', {
      title: '方案流程',
      type: 'flowchart',
      mermaid: 'flowchart LR\n A["制作 < 复核"] --> B["完成"]',
    }));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/flowchart:\s*\{\s*htmlLabels:\s*false\s*\}/);
    expect(html).toContain('制作 \\u003c 复核');
  });

  it('preserves punctuation when embedding mindmap text and a download name', async () => {
    const title = "策划组's 导图";
    const response = await downloadMindmap(diagramRequest('mindmap', { title, root: { text: '甲 < 乙' } }));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('const title = ' + JSON.stringify(title));
    expect(html).toContain('甲 \\u003c 乙');
    expect(html).toContain("a.download = title + '.png'");
  });
});
