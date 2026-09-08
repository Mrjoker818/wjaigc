import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createCanvasSkillProjectionCoordinator,
  canvasSkillProjectionIdentity,
  deleteCanvasSkillsSequentially,
  loadCanvasSkillCatalog,
  loadCompletedCanvasSkillAssets,
  transferCanvasSkillAsset,
  startCanvasSkillRun,
} from '@/lib/skill-runtime/canvas-client';
import {
  CANVAS_WORKFLOW_SKILLS,
  SIMPLE_CHAT_PRESET_SKILLS,
} from '@/lib/skill-runtime/catalog';
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

const contentCommerceSkillIds = [
  'preset-video-platform-thumbnails',
  'preset-pinterest-pins',
  'preset-batch-sku-assets',
] as const;

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
  it('does not let an aborted prior projection block or clear a new projection of the same asset', async () => {
    const coordinator = createCanvasSkillProjectionCoordinator();
    const input = { runId: 'run-1', projectId: 'project-1', assetVersionId: 'v1' };
    let releaseOld!: () => void;
    let releaseNew!: () => void;
    coordinator.activate('run-1', 'project-1');
    const old = coordinator.project({ ...input, project: () => new Promise<void>(resolve => { releaseOld = resolve; }) });
    coordinator.cancel();
    coordinator.activate('run-1', 'project-1');
    const nextReceiver = vi.fn(() => new Promise<void>(resolve => { releaseNew = resolve; }));
    const next = coordinator.project({ ...input, project: nextReceiver });
    expect(nextReceiver).toHaveBeenCalledOnce();
    releaseOld();
    expect(await old).toBe(false);
    expect(await coordinator.project({ ...input, project: nextReceiver })).toBe(false);
    expect(nextReceiver).toHaveBeenCalledOnce();
    releaseNew();
    expect(await next).toBe(true);
  });
  it('allows explicit history restore after the result was deleted in the same mounted canvas', async () => {
    const coordinator = createCanvasSkillProjectionCoordinator();
    const canvas = new Set<string>();
    const project = vi.fn(async () => { canvas.add('v1'); });
    const input = { runId: 'old-run', projectId: 'project-1', assetVersionId: 'v1',
      isAlreadyProjected: () => canvas.has('v1'), project };
    coordinator.activate('old-run', 'project-1');
    expect(await coordinator.project(input)).toBe(true);
    canvas.delete('v1');
    await startCanvasSkillRun(coordinator, async () => 'old-run', 'project-1');
    expect(await coordinator.project(input)).toBe(true);
    expect(project).toHaveBeenCalledTimes(2);
    expect(canvas.has('v1')).toBe(true);
  });
  it('restores four outputs across remounts without duplicating an existing canvas version', async () => {
    const canvas = new Set(['v1']);
    const insert = vi.fn(async (id: string) => { canvas.add(id); });
    for (let mount = 0; mount < 2; mount += 1) {
      const coordinator = createCanvasSkillProjectionCoordinator();
      coordinator.activate('old-run', 'project-1');
      for (const assetVersionId of ['v1', 'v2', 'v3', 'v4']) {
        await coordinator.project({ runId: 'old-run', projectId: 'project-1', assetVersionId,
          isAlreadyProjected: () => canvas.has(assetVersionId),
          project: () => insert(assetVersionId),
        });
      }
    }
    expect([...canvas]).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(insert.mock.calls.map(([id]) => id)).toEqual(['v2', 'v3', 'v4']);
  });
  it.each(['resolve', 'reject'] as const)('cancels an old projection before a new run POST can %s', async (outcome) => {
    const coordinator = createCanvasSkillProjectionCoordinator();
    coordinator.activate('old-run', 'project-1');
    let settle!: (value: string) => void;
    let fail!: (reason: Error) => void;
    const started = new Promise<string>((resolve, reject) => { settle = resolve; fail = reject; });
    const oldTransfer = coordinator.project({
      runId: 'old-run', projectId: 'project-1', assetVersionId: 'asset-old',
      project: signal => new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true })),
    });
    const next = startCanvasSkillRun(coordinator, () => started);
    await expect(oldTransfer).resolves.toBe(false);
    if (outcome === 'resolve') {
      settle('new-run');
      await expect(next).resolves.toBe('new-run');
    } else {
      fail(new Error('start failed'));
      await expect(next).rejects.toThrow('start failed');
    }
  });
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

  it('exposes marketing Skills returned by the shared canvas catalog without embedding their IDs in the component', async () => {
    const marketingSkills = [
      catalogSkill('preset-ad-ab-variants', ['canvas', 'workflow']),
      catalogSkill('preset-retargeting-creative', ['canvas', 'workflow']),
      catalogSkill('preset-omnichannel-campaign', ['canvas', 'workflow']),
    ];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      skills: marketingSkills,
    }), { status: 200 }));

    await expect(loadCanvasSkillCatalog(fetcher)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'preset-ad-ab-variants' }),
      expect.objectContaining({ id: 'preset-retargeting-creative' }),
      expect.objectContaining({ id: 'preset-omnichannel-campaign' }),
    ]));
    expect(chatPanelSource).not.toMatch(/preset-(?:ad-ab-variants|retargeting-creative|omnichannel-campaign)/);
  });

  it('shares all three content-commerce Skill versions with Workflow without embedding their IDs in the panel', () => {
    const canvasVersions = new Map(CANVAS_WORKFLOW_SKILLS.map(skill => [skill.id, skill.version]));
    const simpleChatIds = new Set(SIMPLE_CHAT_PRESET_SKILLS.map(skill => skill.id));

    expect(CANVAS_WORKFLOW_SKILLS).toHaveLength(28);
    expect(SIMPLE_CHAT_PRESET_SKILLS).toHaveLength(16);
    for (const id of contentCommerceSkillIds) {
      expect(canvasVersions.get(id)).toBe(1);
      expect(simpleChatIds.has(id)).toBe(false);
      expect(chatPanelSource).not.toContain(id);
    }
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

  it('rejects an unknown structured output schema during Canvas history restore', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      run: {
        runId: 'run-1', status: 'completed', assetVersionIds: [],
        outputs: [{ stepId: 'audit:a', kind: 'json', schemaId: 'unknown', content: '{}' }],
      },
    }), { status: 200 }));

    await expect(loadCompletedCanvasSkillAssets({
      fetcher: fetcher as typeof fetch,
      projectId: 'project-1',
      runId: 'run-1',
      sourceVersionIds: [],
    })).rejects.toThrow('SKILL_OUTPUT_SCHEMA_UNKNOWN');
  });

  it('rejects present non-array outputs during Canvas history restore', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      run: { runId: 'run-1', status: 'completed', assetVersionIds: [], outputs: {} },
    }), { status: 200 }));

    await expect(loadCompletedCanvasSkillAssets({
      fetcher: fetcher as typeof fetch,
      projectId: 'project-1', runId: 'run-1', sourceVersionIds: [],
    })).rejects.toThrow('SKILL_OUTPUTS_INVALID');
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

  it('claims a stable run and asset identity before projection and suppresses effect reentry', async () => {
    let release!: () => void;
    const deferred = new Promise<void>(resolve => { release = resolve; });
    const project = vi.fn(async () => deferred);
    const coordinator = createCanvasSkillProjectionCoordinator();
    coordinator.activate('run-1', 'project-1');

    const first = coordinator.project({
      runId: 'run-1', projectId: 'project-1', assetVersionId: 'asset-version-1', project,
    });
    const duplicate = await coordinator.project({
      runId: 'run-1', projectId: 'project-1', assetVersionId: 'asset-version-1', project,
    });

    expect(canvasSkillProjectionIdentity('run-1', 'asset-version-1'))
      .toBe('canvas-skill:run-1:asset-version-1');
    expect(project).toHaveBeenCalledTimes(1);
    expect(duplicate).toBe(false);
    release();
    await expect(first).resolves.toBe(true);
  });

  it('releases a failed claim for retry and aborts late work when the run is closed or switched', async () => {
    const coordinator = createCanvasSkillProjectionCoordinator();
    const failed = vi.fn().mockRejectedValueOnce(new Error('transfer failed')).mockResolvedValue(undefined);
    coordinator.activate('run-1', 'project-1');

    await expect(coordinator.project({
      runId: 'run-1', projectId: 'project-1', assetVersionId: 'asset-version-1', project: failed,
    })).rejects.toThrow('transfer failed');
    await expect(coordinator.project({
      runId: 'run-1', projectId: 'project-1', assetVersionId: 'asset-version-1', project: failed,
    })).resolves.toBe(true);
    expect(failed).toHaveBeenCalledTimes(2);

    let observedSignal: AbortSignal | undefined;
    let release!: () => void;
    const deferred = new Promise<void>(resolve => { release = resolve; });
    const late = coordinator.project({
      runId: 'run-1', projectId: 'project-1', assetVersionId: 'asset-version-2',
      project: async signal => { observedSignal = signal; await deferred; },
    });
    coordinator.activate('run-2', 'project-1');
    expect(observedSignal?.aborted).toBe(true);
    release();
    await expect(late).resolves.toBe(false);
  });

  it('uses the stable identity at the transfer API and carries lineage trace into the placement', async () => {
    const transferred = {
      assetId: 'asset-1', assetVersionId: 'version-1', placementId: 'placement-1', url: '/output.png',
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(transferred), { status: 200 }));

    await expect(transferCanvasSkillAsset({
      reference: { assetId: 'asset-1', assetVersionId: 'version-1', url: '/output.png' },
      projectId: 'project-1', runId: 'run-1', sourceVersionIds: ['source-1'], fetcher,
    })).resolves.toEqual(transferred);

    const [, init] = fetcher.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      sourceVersion: 'version-1',
      targetProject: 'project-1',
      targetWorkspace: 'canvas:project-1',
      entityType: 'canvas-image',
      entityId: 'canvas-skill:run-1:version-1',
      idempotencyKey: 'canvas-skill:run-1:version-1',
      metadata: { source: 'canvas-skill', runId: 'run-1', sourceVersionIds: ['source-1'] },
    });
  });

  it('sanitizes and freezes transfer response provenance before canvas hydration', async () => {
    const sourceTrace = {
      source: 'canvas-skill' as const, runId: 'run-1', skillId: 'skill-000000000000000000000001',
      skillVersion: 1, sourceVersionIds: ['source-1'], createdAt: '2026-09-02T00:00:00.000Z',
    };
    const transfer = (trace: unknown) => transferCanvasSkillAsset({
      reference: { assetId: 'asset-1', assetVersionId: 'version-1', url: '/output.png' },
      projectId: 'project-1', runId: 'run-1', sourceVersionIds: ['source-1'],
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        assetId: 'asset-1', assetVersionId: 'version-1', placementId: 'placement-1',
        url: '/output.png', sourceTrace: trace,
      }), { status: 200 })),
    });

    const valid = await transfer(sourceTrace);
    expect(valid.sourceTrace).toEqual(sourceTrace);
    expect(Object.isFrozen(valid.sourceTrace)).toBe(true);
    await expect(transfer({ ...sourceTrace, runId: 'bad run id' })).resolves.not.toHaveProperty('sourceTrace');
  });

  it('restores a deleted placement only for explicit history recovery before returning it', async () => {
    const reference = { assetId: 'asset-1', assetVersionId: 'version-1', placementId: 'placement-1', url: '/output.png' };
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...reference, placementStatus: 'trashed', placementRevision: '42', reused: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        placement: { id: 'placement-1', assetId: 'asset-1', assetVersionId: 'version-1', status: 'active' },
        asset: { id: 'asset-1', status: 'active' }, projectRevision: 8,
      })));
    await expect(transferCanvasSkillAsset({
      reference, projectId: 'project-1', runId: 'run-1', sourceVersionIds: [],
      restoreDeletedPlacement: true, fetcher, signal: controller.signal,
    })).resolves.toMatchObject({ ...reference, projectRevision: 8 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/assets/asset-1/restore');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)))
      .toEqual({ projectId: 'project-1', placementId: 'placement-1', expectedPlacementRevision: '42' });
    expect(fetcher.mock.calls[1]?.[1]?.signal).toBe(controller.signal);
  });

  it('does not resurrect a deleted placement during ordinary output projection', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      assetId: 'asset-1', assetVersionId: 'version-1', placementId: 'placement-1',
      url: '/output.png', placementStatus: 'trashed', reused: true,
    })));
    await expect(transferCanvasSkillAsset({
      reference: { assetId: 'asset-1', assetVersionId: 'version-1', url: '/output.png' },
      projectId: 'project-1', runId: 'run-1', sourceVersionIds: [], fetcher,
    })).rejects.toThrow('已删除');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not return a canvas reference when explicit placement restoration is rejected', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        assetId: 'asset-1', assetVersionId: 'version-1', placementId: 'placement-1',
        url: '/output.png', placementStatus: 'trashed', placementRevision: '42', reused: true,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'ASSET_RESTORE_NOT_ALLOWED' }), { status: 409 }));
    await expect(transferCanvasSkillAsset({
      reference: { assetId: 'asset-1', assetVersionId: 'version-1', url: '/output.png' },
      projectId: 'project-1', runId: 'run-1', sourceVersionIds: [],
      restoreDeletedPlacement: true, fetcher,
    })).rejects.toThrow('ASSET_RESTORE_NOT_ALLOWED');
  });

  it('clears user Skills serially and stops at the first server failure', async () => {
    let release!: () => void;
    const first = new Promise<void>(resolve => { release = resolve; });
    const remove = vi.fn((skillId: string) => skillId === 'skill-a' ? first : Promise.resolve());
    const clearing = deleteCanvasSkillsSequentially(['skill-a', 'skill-b'], remove);

    expect(remove).toHaveBeenCalledTimes(1);
    release();
    await clearing;
    expect(remove.mock.calls.map(call => call[0])).toEqual(['skill-a', 'skill-b']);

    const failing = vi.fn().mockRejectedValueOnce(new Error('server conflict'));
    await expect(deleteCanvasSkillsSequentially(['skill-c', 'skill-d'], failing))
      .rejects.toThrow('server conflict');
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
