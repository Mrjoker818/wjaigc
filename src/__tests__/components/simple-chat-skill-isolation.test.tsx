// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatArea, {
  SIMPLE_CHAT_SKILL_RUN_PENDING_SUFFIX,
  readSkillRunOutputText,
} from '@/components/simple-chat/chat-area';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import type { User } from '@/lib/user-types';
import { SIMPLE_CHAT_PRESET_SKILLS } from '@/lib/skill-runtime/simple-chat-presets';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const user: User = {
  id: 'simple-chat-user',
  name: 'Simple Chat user',
  createdAt: 1,
  updatedAt: 1,
};

const task: SimpleChatTask = {
  id: 'task-1',
  projectId: 'project-1',
  name: 'Skill isolation',
  messages: [],
  model: 'chat-model',
  providerId: 'provider-1',
  createdAt: 1,
  updatedAt: 1,
};

const project: SimpleChatProject = {
  id: 'project-1',
  name: 'Simple Chat',
  createdAt: 1,
  updatedAt: 1,
  tasks: [task],
  agents: [],
  knowledgeItems: [],
};

function renderSimpleChat(): void {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

  render(
    <ChatArea
      user={user}
      project={project}
      task={task}
      onUpdateTask={vi.fn()}
      onPersistTask={async () => {}}
      onUpdateProject={vi.fn()}
      onCreateTask={vi.fn()}
      onSelectTask={vi.fn()}
      onUpdateAgent={vi.fn()}
      onDeleteAgent={vi.fn()}
      onSkillToAgent={vi.fn()}
      onLogout={vi.fn()}
      onBackToWorkspace={vi.fn()}
      sidebarOpen={true}
      onToggleSidebar={vi.fn()}
    />,
  );
}

function renderChatArea(options: {
  fetchMock: ReturnType<typeof vi.fn>;
  onSkillToAgent?: ReturnType<typeof vi.fn>;
  onUpdateTask?: ReturnType<typeof vi.fn>;
  task?: SimpleChatTask;
}): void {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal('fetch', options.fetchMock);
  const currentTask = options.task ?? task;
  render(
    <ChatArea
      user={user}
      project={{ ...project, tasks: [currentTask] }}
      task={currentTask}
      onUpdateTask={options.onUpdateTask ?? vi.fn()}
      onPersistTask={async () => {}}
      onUpdateProject={vi.fn()}
      onCreateTask={vi.fn()}
      onSelectTask={vi.fn()}
      onUpdateAgent={vi.fn()}
      onDeleteAgent={vi.fn()}
      onSkillToAgent={options.onSkillToAgent ?? vi.fn()}
      onLogout={vi.fn()}
      onBackToWorkspace={vi.fn()}
      sidebarOpen={true}
      onToggleSidebar={vi.fn()}
    />,
  );
}

describe('Simple Chat Skill catalog isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders exactly the 16 Simple Chat Skills and excludes Canvas Skills', () => {
    renderSimpleChat();

    fireEvent.click(screen.getByTitle('Skill'));

    expect(SIMPLE_CHAT_PRESET_SKILLS).toHaveLength(16);
    const renderedSkillIds = Array.from(document.querySelectorAll('[data-simple-chat-skill-id]'))
      .map(element => element.getAttribute('data-simple-chat-skill-id'));
    expect(renderedSkillIds).toEqual(SIMPLE_CHAT_PRESET_SKILLS.map(skill => skill.id));
    expect(screen.getAllByText('PPT大师')).toHaveLength(2);
    expect(screen.queryByText('电商商品套图')).toBeNull();
    expect(renderedSkillIds).not.toEqual(expect.arrayContaining([
      'preset-ad-ab-variants',
      'preset-retargeting-creative',
      'preset-omnichannel-campaign',
      'preset-video-platform-thumbnails',
      'preset-pinterest-pins',
      'preset-batch-sku-assets',
      'preset-platform-compliance-audit',
    ]));
    expect(screen.queryByText('广告 A/B 变体')).toBeNull();
    expect(screen.queryByText('再营销素材')).toBeNull();
    expect(screen.queryByText('全渠道活动素材包')).toBeNull();
    expect(screen.queryByText('YouTube/B站缩略图')).toBeNull();
    expect(screen.queryByText('Pinterest 图钉')).toBeNull();
    expect(screen.queryByText('批量 SKU 商品素材')).toBeNull();
    expect(screen.queryByText('平台素材合规检查')).toBeNull();
  });

  it('selects a skill for the conversation and sends its instructions with the next message', async () => {
    const fetchMock = vi.fn((..._args: unknown[]) => new Promise<Response>(() => {}));
    const onSkillToAgent = vi.fn();
    renderChatArea({ fetchMock, onSkillToAgent });
    const skill = SIMPLE_CHAT_PRESET_SKILLS.find(candidate => candidate.id === 'ppt-master')!;

    fireEvent.click(screen.getByTitle('Skill'));
    fireEvent.click(screen.getByRole('button', { name: /PPT大师/ }));

    expect(document.querySelector('[data-simple-chat-selected-skill="ppt-master"]')).not.toBeNull();
    expect(onSkillToAgent).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/skill-runs')).toBe(false);

    fireEvent.change(screen.getByPlaceholderText(/PPT大师/), { target: { value: '做一份季度汇报' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => expect(
      fetchMock.mock.calls.some(([url]) => String(url) === '/api/simple-chat/chat'),
    ).toBe(true));
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/simple-chat/chat')!;
    const body = JSON.parse(String((chatCall[1] as RequestInit).body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages).toEqual(expect.arrayContaining([
      { role: 'system', content: skill.systemPrompt },
      expect.objectContaining({ role: 'user', content: '做一份季度汇报' }),
    ]));
  });

  it('turns the selected skill and the typed request into a recoverable background skill run', async () => {
    const fetchMock = vi.fn((input: unknown, _init?: unknown) => (String(input) === '/api/skill-runs'
      ? Promise.resolve(new Response(JSON.stringify({ runId: 'run-1', reused: false }), { status: 201 }))
      : new Promise<Response>(() => {})));
    const onUpdateTask = vi.fn();
    renderChatArea({ fetchMock, onUpdateTask });

    fireEvent.click(screen.getByTitle('Skill'));
    fireEvent.click(screen.getByRole('button', { name: /PPT大师/ }));
    fireEvent.change(screen.getByPlaceholderText(/PPT大师/), { target: { value: '做一份季度汇报' } });
    fireEvent.click(screen.getByRole('button', { name: '转为后台任务' }));

    await waitFor(() => expect(
      fetchMock.mock.calls.some(([url]) => String(url) === '/api/skill-runs'),
    ).toBe(true));
    const request = fetchMock.mock.calls.find(([url]) => String(url) === '/api/skill-runs')![1] as RequestInit;
    expect(request.method).toBe('POST');
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      skillId: 'ppt-master',
      skillVersion: 1,
      surface: 'simple-chat',
      projectId: 'project-1',
      workspaceId: 'standalone-chat:project-1',
      inputValues: { request: '做一份季度汇报' },
      sourceVersionIds: [],
      modelBindings: { orchestrator: { providerId: 'provider-1', modelId: 'chat-model' } },
    });
    expect(body.idempotencyKey).toEqual(expect.any(String));
    await waitFor(() => expect(onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: '做一份季度汇报' }),
        expect.objectContaining({ role: 'assistant', agentRunId: 'run-1' }),
      ]),
    })));
  });

  it('writes the completed skill run text back into the pending message after a reload', async () => {
    const pendingTask: SimpleChatTask = {
      ...task,
      messages: [
        { id: 'user-1', role: 'user', content: '做一份季度汇报', createdAt: 1 },
        {
          id: 'assistant-1', role: 'assistant', agentRunId: 'run-1', createdAt: 2,
          content: `📊 PPT大师${SIMPLE_CHAT_SKILL_RUN_PENDING_SUFFIX}`,
        },
      ],
    };
    const events = [
      { eventId: 'e1', runId: 'run-1', sequence: 1, type: 'run.created', timestamp: '2026-11-08T00:00:00.000Z', payload: {} },
      {
        eventId: 'e2', runId: 'run-1', sequence: 2, type: 'run.completed', timestamp: '2026-11-08T00:00:01.000Z',
        payload: { result: { outputs: [{ stepId: 'orchestrator', kind: 'text', content: '季度汇报大纲已完成' }] } },
      },
    ];
    const fetchMock = vi.fn((input: unknown, _init?: unknown) => (String(input).startsWith('/api/agent-runs/run-1/events')
      ? Promise.resolve(new Response(JSON.stringify({ events }), { status: 200 }))
      : new Promise<Response>(() => {})));
    const onUpdateTask = vi.fn();
    renderChatArea({ fetchMock, onUpdateTask, task: pendingTask });

    expect(await screen.findByText('季度汇报大纲已完成')).toBeTruthy();
    await waitFor(() => expect(onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ id: 'assistant-1', agentRunId: 'run-1', content: '季度汇报大纲已完成' }),
      ]),
    })));
  });

  it('reads only durable text outputs from a completed skill run result', () => {
    expect(readSkillRunOutputText({ outputs: [
      { stepId: 'orchestrator', kind: 'text', content: '第一段' },
      { stepId: 'orchestrator', kind: 'html', content: '<p>x</p>' },
      { stepId: 'second', kind: 'text', content: '第二段' },
    ] })).toBe('第一段\n\n第二段');
    expect(readSkillRunOutputText(undefined)).toBe('');
    expect(readSkillRunOutputText({ outputs: 'broken' })).toBe('');
  });
});
