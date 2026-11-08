import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn().mockResolvedValue({}),
}));

import { buildChatToolGuide } from '@/lib/chat-tools';
import { listSkillsForSurface } from '@/lib/skill-runtime/catalog';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('chat tool guide', () => {
  it('lists canvas skills only when run_skill is available', () => {
    const guide = buildChatToolGuide(['run_skill']);
    expect(guide).toContain('## 技能目录（run_skill）');
    const listedIds = listSkillsForSurface('canvas')
      .map(skill => skill.id)
      .filter(id => guide.includes(`- ${id}：`));
    expect(listedIds.length).toBeGreaterThan(0);
    expect(buildChatToolGuide(['generate_image'])).toBe('');
  });

  it('explains build_workflow only when it is available', () => {
    expect(buildChatToolGuide(['build_workflow'])).toContain('## 节点工作流（build_workflow）');
    expect(buildChatToolGuide(['run_skill'])).not.toContain('build_workflow');
  });

  it('injects the guide into the chat system prompt', () => {
    const route = source('src/app/api/chat/route.ts');
    expect(route).toContain('buildChatToolGuide(availableTools.map(tool => tool.function.name))');
  });
});

describe('chat agent-v2 and confirmed tool calls', () => {
  it('lets run_skill and build_workflow self-admit under agent-v2', () => {
    const route = source('src/app/api/chat/route.ts');
    expect(route).toContain("const SELF_ADMITTED_TOOLS = new Set(['run_skill', 'build_workflow']);");
    expect(route).toContain("input.agentRuntimeMode === 'agent-v2' && SELF_ADMITTED_TOOLS.has(input.toolName)");
  });

  it('runs a confirmed tool, then hands its result back to the model loop', () => {
    const route = source('src/app/api/chat/route.ts');
    expect(route).not.toContain('executeConfirmedToolStream');
    const confirmed = route.indexOf('if (initialToolCall) {');
    const loop = route.indexOf('while (iteration < MAX_AGENT_ITERATIONS) {', confirmed);
    expect(confirmed).toBeGreaterThan(0);
    expect(loop).toBeGreaterThan(confirmed);
    const block = route.slice(confirmed, loop);
    expect(block).toContain("role: 'tool'");
    expect(block).toContain('content: toolResult.resultText');
  });

  it('queues multiple confirmation requests and does not add an empty user turn', () => {
    const panel = source('src/components/chat-panel.tsx');
    expect(panel).toContain('setPendingToolConfirmations(current => [...current, {');
    expect(panel).toContain('setPendingToolConfirmations(current => current.slice(1));');
    expect(panel).toContain("const intentLevel = options?.confirmedToolCall ? 'clear' : intentResult.clarity;");
    expect(panel).toContain('const newMessages = options?.confirmedToolCall ? messages : [...messages, userMessage];');
  });
});
