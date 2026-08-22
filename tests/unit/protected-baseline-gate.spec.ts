import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Feature {
  featureId: string;
  components?: string[];
}

async function loadGateModule() {
  const scriptPath = resolve(
    process.cwd(),
    'scripts/check-protected-baseline.mjs',
  );
  return import(pathToFileURL(scriptPath).href) as Promise<{
    evaluateProtectedBaseline: (input: {
      baselineFeatures: Feature[];
      candidateFeatures: Feature[];
      changedPaths?: string[];
      untrackedPaths?: string[];
      protectedSourcePaths?: string[];
      missingEvidenceContracts?: string[];
      baseResolved?: boolean;
      candidateResolved?: boolean;
    }) => {
      pass: string[];
      warn: string[];
      block: string[];
    };
  }>;
}

const baselineFeatures: Feature[] = [
  {
    featureId: 'workspace.canvas.core',
    components: ['src/components/infinite-canvas.tsx'],
  },
  {
    featureId: 'workspace.workflow.graph',
    components: ['src/components/node-editor.tsx'],
  },
];

const historicalSourceAuthorizations = [
  ['migrations/20260821_v588_admin_thumbnail_variants.sql', 'd941384'],
  ['migrations/20260821_wj_stable_s4_historical_media_remediations.sql', 'bc74b89'],
  ['scripts/coze-deploy-build.sh', '172f38c'],
  ['scripts/coze-preview-build.sh', '172f38c'],
  ['scripts/doctor-asset-status.mjs', 'e809f5c'],
  ['src/app/api/admin/assets/remediation/route.ts', '9a9fb8b'],
  ['src/app/api/admin/backfill-thumbnails/route.ts', 'd941384'],
  ['src/app/api/admin/dashboard-stats/route.ts', '1ba98f7'],
  ['src/app/api/admin/production-readiness/route.ts', '05f6717'],
  ['src/app/api/assets/[assetId]/restore/route.ts', '0756f71'],
  ['src/app/api/assets/adopt-canvas-image/route.ts', 'c99fb72'],
  ['src/components/dashboard/admin-tabs.tsx', '1ba98f7'],
  ['src/components/canvas/CanvasCommandPalette.tsx', '8acb3c9'],
  ['src/components/canvas/CanvasZoomCluster.tsx', 'c808e50'],
  ['src/lib/admin-dashboard-projection.ts', '1ba98f7'],
  ['src/lib/asset-core/asset-release-readiness.ts', 'e809f5c'],
  ['src/lib/asset-core/canvas-adapter.ts', '5a35b98'],
  ['src/lib/asset-core/canvas-placement-snapshot.ts', '69479f7'],
  ['src/lib/asset-core/canvas-project-sync.ts', '9c3f52f'],
  ['src/lib/asset-core/historical-media-remediation.ts', '9c3f52f'],
  ['src/lib/asset-core/legacy-migration.ts', '9c3f52f'],
  ['src/lib/asset-core/media-health.ts', '9c3f52f'],
  ['src/lib/asset-core/recovery-media.ts', '9c3f52f'],
  ['src/lib/asset-core/service.ts', '9c3f52f'],
  ['src/lib/asset-core/storage.ts', '9c3f52f'],
  ['src/lib/asset-core/thumbnail-backfill.ts', '9c3f52f'],
  ['src/lib/project-workflow.ts', '016e5d2'],
] as const;

describe('protected baseline release gate', () => {
  it('pins the Stage 4 gate and permits only the declared Stage 4 task surfaces', async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const command = packageJson.scripts['check:protected-baseline'];

    expect(command).toContain('--base 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b');
    expect(command).toContain('--allow-path .superpowers/sdd/task-0-report.md');
    expect(command).toContain('--allow-path .superpowers/sdd/task-1-report.md');
    expect(command).toContain('--allow-path migrations/20260816_wj_stable_s4_agent_events.sql');
    expect(command).toContain('--allow-path scripts/run-migrations.mjs');
    expect(command).toContain('--allow-path src/app/api/agent-runs/');
    expect(command).not.toMatch(/--allow-path src\/app\/api\/(?:\s|$)/);
    expect(command).not.toMatch(/--allow-path src\/components\/workflow\/(?:\s|$)/);
    for (const path of [
      'src/components/workflow/WorkflowLegacyNodeCard.tsx',
      'src/components/workflow/WorkflowLegacySurface.tsx',
      'src/components/workflow/WorkflowNodeCard.tsx',
      'src/components/workflow/WorkflowReactFlowSurface.tsx',
      'src/components/workflow/WorkflowShadowProbe.tsx',
    ]) {
      expect(command).toContain(`--allow-path ${path}`);
    }
    expect(command).not.toMatch(/--allow-path src\/lib\/workflow-renderer\/(?:\s|$)/);
    for (const path of [
      'src/lib/workflow-renderer/mode.ts',
      'src/lib/workflow-renderer/view-model.ts',
      'src/lib/workflow-renderer/commands.ts',
      'src/lib/workflow-renderer/shadow.ts',
      'src/lib/workflow-renderer/presentation.ts',
    ]) {
      expect(command).toContain(`--allow-path ${path}`);
    }
  });

  it('authorizes reviewed historical source drift by exact path with provenance', async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const provenance = JSON.parse(await readFile(
      resolve(process.cwd(), 'docs/testing/baselines/protected-source-authorizations.json'),
      'utf8',
    )) as {
      authorizations: Array<{ path: string; sourceCommit: string }>;
    };
    const command = packageJson.scripts['check:protected-baseline'];
    const sourceCommits = [...new Set(
      historicalSourceAuthorizations.map(([, sourceCommit]) => sourceCommit),
    )];
    const authorizedPaths = historicalSourceAuthorizations.map(([path]) => path);
    const provenanceOutput = execFileSync(
      'git',
      [
        'show',
        '--format=@@%h',
        '--name-only',
        '--no-renames',
        ...sourceCommits,
        '--',
        ...authorizedPaths,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    const pathsByCommit = new Map<string, Set<string>>();
    let currentCommit: string | undefined;

    for (const line of provenanceOutput.split(/\r?\n/)) {
      if (line.startsWith('@@')) {
        currentCommit = line.slice(2);
        pathsByCommit.set(currentCommit, new Set());
      } else if (currentCommit && line) {
        pathsByCommit.get(currentCommit)?.add(line.replaceAll('\\', '/'));
      }
    }

    expect(provenance.authorizations).toHaveLength(historicalSourceAuthorizations.length);
    for (const [path, sourceCommit] of historicalSourceAuthorizations) {
      expect(command).toContain(`--allow-path ${path}`);
      expect(provenance.authorizations).toContainEqual({ path, sourceCommit });
      expect(pathsByCommit.get(sourceCommit)).toContain(path);
    }

    for (const broadPath of [
      'migrations/',
      'scripts/',
      'src/app/api/admin/',
      'src/app/api/assets/',
      'src/components/dashboard/',
      'src/lib/',
      'src/lib/asset-core/',
    ]) {
      expect(command).not.toContain(`--allow-path ${broadPath} `);
      expect(command).not.toMatch(new RegExp(`--allow-path ${broadPath.replaceAll('/', '\\/')}$`));
    }
  });

  it('passes an identical candidate and allows documentation-only changes', async () => {
    const { evaluateProtectedBaseline } = await loadGateModule();
    const result = evaluateProtectedBaseline({
      baselineFeatures,
      candidateFeatures: structuredClone(baselineFeatures),
      changedPaths: ['docs/testing/TEST_PLAN.md'],
    });

    expect(result.block).toEqual([]);
    expect(result.pass.length).toBeGreaterThan(0);
  });

  it('warns but passes when a feature is added', async () => {
    const { evaluateProtectedBaseline } = await loadGateModule();
    const result = evaluateProtectedBaseline({
      baselineFeatures,
      candidateFeatures: [
        ...baselineFeatures,
        { featureId: 'workspace.chat.new-tool', components: [] },
      ],
    });

    expect(result.block).toEqual([]);
    expect(result.warn.join('\n')).toMatch(/workspace\.chat\.new-tool/);
  });

  it('blocks removed and duplicate feature ids', async () => {
    const { evaluateProtectedBaseline } = await loadGateModule();
    const removed = evaluateProtectedBaseline({
      baselineFeatures,
      candidateFeatures: baselineFeatures.slice(1),
    });
    const duplicate = evaluateProtectedBaseline({
      baselineFeatures,
      candidateFeatures: [...baselineFeatures, baselineFeatures[0]],
    });

    expect(removed.block.join('\n')).toMatch(/workspace\.canvas\.core/);
    expect(duplicate.block.join('\n')).toMatch(/Duplicate/);
  });

  it('blocks untracked protected source but allows test infrastructure', async () => {
    const { evaluateProtectedBaseline } = await loadGateModule();
    const blocked = evaluateProtectedBaseline({
      baselineFeatures,
      candidateFeatures: baselineFeatures,
      untrackedPaths: ['src/components/new-runtime-panel.tsx'],
    });
    const allowed = evaluateProtectedBaseline({
      baselineFeatures,
      candidateFeatures: baselineFeatures,
      changedPaths: [
        'src/__tests__/scripts/function-inventory.test.ts',
        'tests/unit/protected-baseline-gate.spec.ts',
        'scripts/check-protected-baseline.mjs',
      ],
    });

    expect(blocked.block.join('\n')).toMatch(/new-runtime-panel/);
    expect(allowed.block).toEqual([]);
  });

  it('blocks missing evidence contracts and unresolved git refs', async () => {
    const { evaluateProtectedBaseline } = await loadGateModule();
    const result = evaluateProtectedBaseline({
      baselineFeatures,
      candidateFeatures: baselineFeatures,
      missingEvidenceContracts: ['tests/helpers/evidence-manifest.ts'],
      baseResolved: false,
      candidateResolved: false,
    });

    expect(result.block.join('\n')).toMatch(/evidence-manifest/);
    expect(result.block.join('\n')).toMatch(/base Git ref/);
    expect(result.block.join('\n')).toMatch(/candidate Git ref/);
  });
});
