import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  loadCanvasSkillCatalog,
  loadCompletedCanvasSkillAssets,
} from '@/lib/skill-runtime/canvas-client';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

const chatPanelSource = readFileSync(
  resolve(process.cwd(), 'src/components/chat-panel.tsx'),
  'utf8',
);
const canvasPresetSource = readFileSync(
  resolve(process.cwd(), 'src/lib/skill-runtime/canvas-presets.ts'),
  'utf8',
);
const simpleChatPresetSource = readFileSync(
  resolve(process.cwd(), 'src/lib/skill-runtime/simple-chat-presets.ts'),
  'utf8',
);
const canvasClientSource = readFileSync(
  resolve(process.cwd(), 'src/lib/skill-runtime/canvas-client.ts'),
  'utf8',
);

function catalogSkill(id: string, allowedSurfaces: SkillDefinition['allowedSurfaces']): SkillDefinition {
  return {
    id,
    version: 1,
    name: id,
    category: 'test',
    description: 'test skill',
    systemPrompt: 'test',
    allowedSurfaces,
    inputs: [],
    steps: [],
    enabled: true,
    builtIn: true,
    createdAt: 1,
    updatedAt: 1,
    usageCount: 0,
  };
}

describe('canvas chat Skill catalog contract', () => {
  it('loads the canvas catalog from its scoped API instead of an embedded directory', () => {
    expect(chatPanelSource).toContain("loadCanvasSkillCatalog");
    expect(canvasClientSource).toContain("'/api/skills?surface=canvas'");
    expect(chatPanelSource).not.toContain('CANVAS_PRESET_CHAT_SKILLS');
    expect(chatPanelSource).not.toContain('LOVART_PRESET_SKILLS');
    expect(chatPanelSource).not.toContain("loadChatKeyFromServer('chat_skills')");
    expect(chatPanelSource).not.toContain("scheduleChatSync('chat_skills'");
  });

  it('keeps the 21 canvas built-ins isolated from the 16 simple-chat built-ins', () => {
    expect((canvasPresetSource.match(/id: 'preset-/g) || [])).toHaveLength(21);
    expect((simpleChatPresetSource.match(/\{ id: '/g) || [])).toHaveLength(16);
    expect(chatPanelSource).toContain('skill.allowedSurfaces.includes(\'canvas\')');
    expect(chatPanelSource).not.toContain('SIMPLE_CHAT_PRESET_SKILLS');
    expect(chatPanelSource).not.toContain('surface=simple-chat');
  });

  it('defensively rejects non-canvas catalog entries from the scoped response', async () => {
    const canvasSkill = catalogSkill('canvas-skill', ['canvas']);
    const simpleChatSkill = catalogSkill('simple-chat-skill', ['simple-chat']);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      skills: [canvasSkill, simpleChatSkill],
    }), { status: 200 }));

    await expect(loadCanvasSkillCatalog(fetcher as typeof fetch)).resolves.toEqual([canvasSkill]);
    expect(fetcher).toHaveBeenCalledWith('/api/skills?surface=canvas', expect.any(Object));
  });

  it('rejects incomplete catalog entries instead of exposing malformed Skills to the panel', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      skills: [{ id: 'broken', version: 1, allowedSurfaces: ['canvas'] }],
    }), { status: 200 }));

    await expect(loadCanvasSkillCatalog(fetcher)).rejects.toThrow('Canvas Skill 目录格式无效');
  });

  it('projects only authoritative completed output versions and excludes source versions', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/skill-runs/run-1') {
        return new Response(JSON.stringify({
          run: {
            runId: 'run-1',
            status: 'completed',
            assetVersionIds: ['source-version', 'output-version'],
          },
        }), { status: 200 });
      }
      if (url.includes('assetVersionId=output-version')) {
        return new Response(JSON.stringify({
          assetId: 'asset-output',
          assetVersionId: 'output-version',
          url: '/api/serve-upload/output.png',
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(loadCompletedCanvasSkillAssets({
      fetcher: fetcher as typeof fetch,
      projectId: 'project-1',
      runId: 'run-1',
      sourceVersionIds: ['source-version'],
    })).resolves.toEqual([{
      assetId: 'asset-output',
      assetVersionId: 'output-version',
      url: '/api/serve-upload/output.png',
    }]);
  });

  it.each(['failed', 'cancelled', 'paused'])('does not project %s runs', async status => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      run: { runId: 'run-1', status, assetVersionIds: ['late-version'] },
    }), { status: 200 }));

    await expect(loadCompletedCanvasSkillAssets({
      fetcher: fetcher as typeof fetch,
      projectId: 'project-1',
      runId: 'run-1',
      sourceVersionIds: [],
    })).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
