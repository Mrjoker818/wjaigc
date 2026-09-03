// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import NodeEditor from '@/components/node-editor';
import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';

const workflowSkill = {
  id: 'workflow-skill', version: 2, name: '工作流产品套图', category: 'image',
  description: 'workflow only', systemPrompt: 'system', allowedSurfaces: ['canvas', 'workflow'],
  inputs: [{ key: 'brief', label: '产品需求', kind: 'text', required: true }],
  steps: [{ id: 'step', label: '生成', toolId: 'generate_image', execution: 'sequential', promptTemplate: '{{brief}}', modelRole: 'image', qualityGateIds: [] }],
  enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NodeEditor workflow Skill node', () => {
  it('keeps the execution id when workflow cancellation is not confirmed', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');
    expect(source).toContain('if (!response.ok)');
    expect(source).toContain("data.error || '取消工作流失败'");
  });

  it('loads only the workflow catalog and renders shared dynamic inputs', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/skills?surface=workflow') {
        return new Response(JSON.stringify({ skills: [workflowSkill] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });

    const node = createWorkflowNode('ai-skill', 0, 0);
    const workflow = { ...createEmptyWorkflow('Skill workflow'), nodes: [node] };
    render(<NodeEditor workflow={workflow} projectId="project-a" canvasImages={[]} />);

    fireEvent.mouseDown(screen.getByLabelText(node.label), { button: 0 });
    fireEvent.mouseUp(screen.getByLabelText(node.label), { button: 0 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/skills?surface=workflow',
      expect.objectContaining({ method: 'GET' }),
    ));

    const skillSelect = await screen.findByRole('combobox', { name: 'Skill' });
    expect(screen.queryByText('独立对话 Skill')).toBeNull();
    fireEvent.change(skillSelect, { target: { value: workflowSkill.id } });
    expect(await screen.findByLabelText('产品需求')).toBeTruthy();
  });
});
