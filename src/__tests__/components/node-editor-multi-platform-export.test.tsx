// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NodeEditor from '@/components/node-editor';
import { createMultiPlatformExportSkill } from '@/lib/skill-runtime/multi-platform-export-preset';
import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NodeEditor multi-platform export Skill', () => {
  it('renders local export inputs without an orchestrator model and submits empty bindings', async () => {
    const skill = createMultiPlatformExportSkill(true);
    const submissions: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/skills?surface=workflow') {
        return new Response(JSON.stringify({ skills: [skill] }), { status: 200 });
      }
      if (url === '/api/platform-export-presets') {
        return new Response(JSON.stringify({ success: true, presets: [{
          id: 'instagram-post', version: 1, platform: 'Instagram', usage: 'post',
          label: 'Instagram 帖子', width: 1080, height: 1080,
          recommendedFormat: 'png', supportsTransparency: true, enabled: true,
        }] }), { status: 200 });
      }
      if (url === '/api/skill-runs/estimate') {
        return new Response(JSON.stringify({ minimum: 0, maximum: 0, modelBindings: {} }), { status: 200 });
      }
      if (url === '/api/workflow/execute' && typeof init?.body === 'string') {
        submissions.push(JSON.parse(init.body) as Record<string, unknown>);
        return new Response(JSON.stringify({ executionId: 'execution-1' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });

    const source = createWorkflowNode('input-image', -300, 0);
    source.config = { ...source.config, imageUrl: '/source.png', assetVersionId: 'source-v1' };
    const exportNode = createWorkflowNode('ai-skill', 0, 0);
    exportNode.config = {
      ...exportNode.config,
      skillId: skill.id,
      version: skill.version,
      inputValues: {
        fit: 'cover', background: '#ffffffff',
        namingTemplate: '{project}-{asset}-{platform}-{size}-{index}',
      },
      modelBindings: {},
    };
    const workflow = {
      ...createEmptyWorkflow('Batch export'),
      nodes: [source, exportNode],
      connections: [{
        id: 'source-export', fromNodeId: source.id, fromPortId: 'out-image',
        toNodeId: exportNode.id, toPortId: 'in-image', type: 'image' as const,
      }],
    };

    render(<NodeEditor workflow={workflow} projectId="project-1" canvasImages={[]} />);
    fireEvent.mouseDown(screen.getByLabelText(exportNode.label), { button: 0 });
    fireEvent.mouseUp(screen.getByLabelText(exportNode.label), { button: 0 });

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Skill' }).textContent).toContain(skill.name));
    expect(screen.queryByLabelText('orchestrator 模型')).toBeNull();
    expect(await screen.findByRole('checkbox', { name: 'instagram-post-v1' })).toBeTruthy();
    expect(screen.getByLabelText('命名模板')).toBeTruthy();
    expect(screen.getByText('已选择 1 张来源图片')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'instagram-post-v1' }));
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' }));
    await screen.findByRole('dialog', { name: 'Skill 费用预估' });
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await waitFor(() => expect(submissions).toHaveLength(1));

    const nodes = submissions[0].nodes as Array<{ id: string; config: Record<string, unknown> }>;
    const submitted = nodes.find(node => node.id === exportNode.id);
    expect(submitted?.config.modelBindings).toEqual({});
  });
});
