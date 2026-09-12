// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NodeEditor from '@/components/node-editor';
import { createBriefToVideoSkill } from '@/lib/skill-runtime/brief-to-video-preset';
import {
  configureWorkflowSkillNodePorts,
  createEmptyWorkflow,
  createWorkflowNode,
} from '@/lib/workflow-engine';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NodeEditor Brief 到视频节点', () => {
  it('为首帧、尾帧和最终视频提供独立端口，同时保留通用 Skill 端口', () => {
    const node = configureWorkflowSkillNodePorts(
      createWorkflowNode('ai-skill', 0, 0),
      createBriefToVideoSkill(true),
    );

    expect(node.ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'in-start-frame', label: '首帧', type: 'image', direction: 'in' }),
      expect.objectContaining({ id: 'in-end-frame', label: '尾帧', type: 'image', direction: 'in' }),
      expect.objectContaining({ id: 'out-video', label: '视频', type: 'video', direction: 'out' }),
    ]));
    expect(node.ports.map(port => port.id)).toEqual(expect.arrayContaining([
      'in-prompt', 'out-image', 'out-prompt', 'out-task',
    ]));

    const cleared = configureWorkflowSkillNodePorts(node, undefined);
    expect(cleared.ports.map(port => port.id)).not.toEqual(expect.arrayContaining([
      'in-start-frame', 'in-end-frame', 'out-video',
    ]));
  });

  it('在属性面板选择 Brief Skill 时立即持久化专用端口', async () => {
    const skill = createBriefToVideoSkill(true);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/skills?surface=workflow'
      ? new Response(JSON.stringify({ skills: [skill] }), { status: 200 })
      : new Response('{}', { status: 200 })));
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = createWorkflowNode('ai-skill', 0, 0);
    let latest = createEmptyWorkflow('Brief video');
    latest.nodes = [node];

    render(<NodeEditor workflow={latest} projectId="project-a" canvasImages={[]}
      onWorkflowChange={workflow => { if (workflow) latest = workflow; }} />);
    fireEvent.mouseDown(screen.getByLabelText(node.label), { button: 0 });
    fireEvent.mouseUp(screen.getByLabelText(node.label), { button: 0 });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Skill' }), {
      target: { value: skill.id },
    });

    await waitFor(() => expect(latest.nodes[0].ports.map(port => port.id)).toEqual(expect.arrayContaining([
      'in-start-frame', 'in-end-frame', 'out-video',
    ])));
  });

  it('恢复待审批 Run 后在节点属性区显示脚本审批操作', async () => {
    const skill = createBriefToVideoSkill(true);
    const plan = {
      schemaId: 'brief-to-video-plan-v1', title: '秋季上新短片', logline: '展示新品质感',
      durationSeconds: 10, aspectRatio: '16:9', finalVideoPrompt: 'cinematic product film',
      negativePrompt: '画面抖动、主体变形', factualConstraints: [], scenes: [{
        order: 1, timeRange: '0-10s', visual: '产品从暗处出现', camera: '缓慢推进', action: '旋转展示',
      }],
    };
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/skills?surface=workflow') {
        return new Response(JSON.stringify({ skills: [skill] }), { status: 200 });
      }
      if (url.includes('/api/skill-runs/run-video-1')) return new Response(JSON.stringify({ run: {
        runId: 'run-video-1', projectId: 'project-a', workspaceId: 'workflow:workflow-a',
        surface: 'workflow', skillId: skill.id, skillVersion: skill.version, status: 'paused',
        assetVersionIds: [], approval: {
          schemaId: 'skill-approval-state-v1', status: 'pending', stepId: 'plan-film',
          nextStepId: 'generate-film', outputSchemaId: 'brief-to-video-plan-v1',
          planChecksum: 'a'.repeat(64), revision: 0, generation: 0, allowRevision: true,
        },
        outputs: [{ stepId: 'plan-film', kind: 'json', schemaId: 'brief-to-video-plan-v1', content: JSON.stringify(plan) }],
      } }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    const node = configureWorkflowSkillNodePorts(createWorkflowNode('ai-skill', 0, 0), skill);
    node.config = { ...node.config, skillId: skill.id, version: skill.version, runId: 'run-video-1' };
    const workflow = { ...createEmptyWorkflow('Brief approval'), id: 'workflow-a', nodes: [node] };

    render(<NodeEditor workflow={workflow} projectId="project-a" canvasImages={[]} />);
    fireEvent.mouseDown(screen.getByLabelText(node.label), { button: 0 });
    fireEvent.mouseUp(screen.getByLabelText(node.label), { button: 0 });

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/api/skill-runs/run-video-1'),
      expect.objectContaining({ method: 'GET' }),
    ));
    expect((await screen.findByRole('combobox', { name: 'Skill' }) as HTMLSelectElement).value)
      .toBe(skill.id);
    expect(await screen.findByRole('button', { name: '批准生成' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '修改脚本' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消任务' })).toBeTruthy();
  });

  it('工作流轮询进入待审批后持久化 paused 状态供刷新恢复', async () => {
    const skill = createBriefToVideoSkill(true);
    const node = configureWorkflowSkillNodePorts(createWorkflowNode('ai-skill', 0, 0), skill);
    node.config = { ...node.config, skillId: skill.id, version: skill.version, runId: 'run-video-1' };
    const workflow = { ...createEmptyWorkflow('Brief approval'), id: 'workflow-a', nodes: [node] };
    const storageKey = `wujie_workflow_exec_state:v2:${JSON.stringify([
      'user-a', 'project-a', 'workflow-a',
    ])}`;
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
      clear: () => { stored.clear(); },
      key: (index: number) => [...stored.keys()][index] ?? null,
      get length() { return stored.size; },
    } satisfies Storage;
    vi.stubGlobal('localStorage', storage);
    storage.setItem(storageKey, JSON.stringify({
      executionId: 'exec-paused', execStatus: 'running', execResults: {}, execLogs: [], nodeIds: [node.id],
    }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/skills?surface=workflow') {
        return new Response(JSON.stringify({ skills: [skill] }), { status: 200 });
      }
      if (url === '/api/workflow/execute') return Response.json({
        executionId: 'exec-paused', status: 'paused', results: {
          [node.id]: { status: 'waiting-approval', output: { runId: 'run-video-1', status: 'waiting-approval' } },
        },
      });
      return new Response('{}', { status: 200 });
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });

    render(<NodeEditor workflow={workflow} userId="user-a" projectId="project-a" canvasImages={[]} />);

    await waitFor(() => expect(JSON.parse(storage.getItem(storageKey) || '{}')).toMatchObject({
      executionId: 'exec-paused', execStatus: 'paused', nodeIds: [node.id],
    }));
  });
});
