// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatArea from '@/components/simple-chat/chat-area';
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
  });
});
