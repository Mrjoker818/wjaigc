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
  ['src/components/canvas/CanvasEditColorRemoveBgPanel.tsx', '2fc5c83'],
  ['src/components/canvas/CanvasEditEraseMaskPanel.tsx', 'e3991f3'],
  ['src/components/canvas/CanvasEditExpandCropPanel.tsx', '2fc5c83'],
  ['src/components/canvas/CanvasEditUpscaleSvgPanel.tsx', '2fc5c83'],
  ['src/components/canvas/CanvasEmptyState.tsx', 'feac579'],
  ['src/components/canvas/CanvasImageActionToolbar.tsx', '69d3466'],
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
  ['src/lib/canvas-kernel/persistence.ts', 'efe5e4f'],
  ['src/lib/image-toolbar-position.ts', '2fc5c83'],
  ['src/lib/image-toolbar-preferences.ts', '69d3466'],
  ['src/lib/project-workflow.ts', '016e5d2'],
  ['migrations/20260823_v588_auth_credentials.sql', 'b63025be'],
  ['scripts/collect-v588-auth-artifacts.ts', '02a3bd3d'],
  ['scripts/v588-auth-fixture.mjs', '02a3bd3d'],
  ['scripts/verify-v588-auth-stable-contract.mjs', '02a3bd3d'],
  ['src/app/api/admin/apis/route.ts', '1327da03'],
  ['src/app/api/auth/login/route.ts', '9c693b1d'],
  ['src/app/api/auth/me/route.ts', '9c693b1d'],
  ['src/app/api/font-design/generate-image/route.ts', '27d16726'],
  ['src/app/api/models/route.ts', 'd87fad98'],
  ['src/app/api/universal-generate/route.ts', '536882aa'],
  ['src/app/api/video/extend/route.ts', '80b6be0a'],
  ['src/app/api/video/generate/route.ts', 'a26806be'],
  ['src/app/api/workflow/models/route.ts', 'd87fad98'],
  ['src/app/page.tsx', '2214ad4c'],
  ['src/components/dashboard/dashboard-view.tsx', '1327da03'],
  ['src/components/dashboard/login-panel.tsx', '2214ad4c'],
  ['src/components/dashboard/model-capability-editor.tsx', '1327da03'],
  ['src/components/generation-background-control.tsx', '6522c7ef'],
  ['src/components/generation-panel.tsx', '69e791dc'],
  ['src/components/scene-studio-panel.tsx', 'd7ffe827'],
  ['src/components/sticker-assistant-panel.tsx', 'd7ffe827'],
  ['src/components/third-party-model-dialog.tsx', '1327da03'],
  ['src/components/video-generation-panel.tsx', 'a26806be'],
  ['src/hooks/use-task-model-catalog.ts', '9e3618c8'],
  ['src/lib/auth/auth-errors.ts', 'f5dfdfc4'],
  ['src/lib/auth/auth-password.ts', 'c518aa29'],
  ['src/lib/auth/auth-persistence.ts', 'b0cd946f'],
  ['src/lib/auth/auth-repository.ts', '42e540bd'],
  ['src/lib/auth/auth-secret-ring.ts', '865559d3'],
  ['src/lib/db-client.ts', '608ae930'],
  ['src/lib/db-storage.ts', 'b0cd946f'],
  ['src/lib/api-provider-selected-models-storage.ts', 'd56844b4'],
  ['src/lib/font-design-task-store.ts', '27d16726'],
  ['src/lib/generated-image-alpha.ts', '536882aa'],
  ['src/lib/image-generation-output-preference.ts', 'd7ffe827'],
  ['src/lib/image-generation-output.ts', '607ce13d'],
  ['src/lib/operation-audit.ts', 'b0cd946f'],
  ['src/lib/server-api-config.ts', '89fd45d7'],
  ['src/lib/server-auth.ts', '6102572b'],
  ['src/lib/simple-chat-logout.ts', 'b0cd946f'],
  ['src/lib/task-core/candidate-model-admission.ts', '80b6be0a'],
  ['src/lib/task-core/descriptor-image-request-fields.ts', '80b6be0a'],
  ['src/lib/task-core/exact-model-selection.ts', '80b6be0a'],
  ['src/lib/task-core/exact-provider-routing.ts', '80b6be0a'],
  ['src/lib/task-core/image-output-fanout.ts', '80b6be0a'],
  ['src/lib/task-core/model-capability-contract.ts', 'be0ff6dc'],
  ['src/lib/task-core/model-capability-resolution.ts', '1327da03'],
  ['src/lib/task-core/provider-capability-adapters.ts', 'b211c73c'],
  ['src/lib/task-events-client.ts', 'b0cd946f'],
  ['src/lib/universal-api-manager.ts', '1327da03'],
  ['src/lib/universal-api-types.ts', 'faee6de5'],
] as const;

describe('protected baseline release gate', () => {
  it('pins the Stage 4 gate and permits only the declared Stage 4 task surfaces', async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const command = packageJson.scripts['check:protected-baseline'];
    const allowedPaths = JSON.parse(await readFile(
      resolve(process.cwd(), 'docs/testing/baselines/protected-baseline-allowed-paths.json'),
      'utf8',
    )) as string[];

    expect(command).toContain('--base 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b');
    expect(command).toContain('--allow-path-file docs/testing/baselines/protected-baseline-allowed-paths.json');
    expect(command).not.toContain('--allow-path ');
    expect(allowedPaths).toContain('.superpowers/sdd/task-0-report.md');
    expect(allowedPaths).toContain('.superpowers/sdd/task-1-report.md');
    expect(allowedPaths).toContain('.superpowers/sdd/task-simple-chat-4-report.md');
    expect(allowedPaths).toContain('.superpowers/sdd/task-simple-chat-5-report.md');
    expect(allowedPaths).toContain('.superpowers/sdd/task-simple-chat-7-report.md');
    expect(allowedPaths).toContain('src/lib/simple-chat-request-context.ts');
    expect(allowedPaths).toContain('migrations/20260816_wj_stable_s4_agent_events.sql');
    expect(allowedPaths).toContain('scripts/run-migrations.mjs');
    expect(allowedPaths).toContain('src/app/api/agent-runs/');
    expect(allowedPaths).not.toContain('src/app/api/');
    expect(allowedPaths).not.toContain('src/components/workflow/');
    for (const path of [
      'src/components/workflow/WorkflowLegacyNodeCard.tsx',
      'src/components/workflow/WorkflowLegacySurface.tsx',
      'src/components/workflow/WorkflowNodeCard.tsx',
      'src/components/workflow/WorkflowReactFlowSurface.tsx',
      'src/components/workflow/WorkflowShadowProbe.tsx',
    ]) {
      expect(allowedPaths).toContain(path);
    }
    expect(allowedPaths).not.toContain('src/lib/workflow-renderer/');
    for (const path of [
      'src/lib/workflow-renderer/mode.ts',
      'src/lib/workflow-renderer/view-model.ts',
      'src/lib/workflow-renderer/commands.ts',
      'src/lib/workflow-renderer/shadow.ts',
      'src/lib/workflow-renderer/presentation.ts',
    ]) {
      expect(allowedPaths).toContain(path);
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
    const allowedPaths = JSON.parse(await readFile(
      resolve(process.cwd(), 'docs/testing/baselines/protected-baseline-allowed-paths.json'),
      'utf8',
    )) as string[];
    const sourceCommits = [...new Set(
      historicalSourceAuthorizations.map(([, sourceCommit]) => sourceCommit),
    )];
    const resolvedSourceCommits = execFileSync('git', ['rev-parse', ...sourceCommits], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim().split(/\r?\n/);
    const fullSourceCommits = new Map(
      sourceCommits.map((sourceCommit, index) => [sourceCommit, resolvedSourceCommits[index]]),
    );
    const authorizedPaths = historicalSourceAuthorizations.map(([path]) => path);
    const provenanceOutput = execFileSync(
      'git',
      [
        'show',
        '--format=@@%H',
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
      expect(command).toContain('--allow-path-file docs/testing/baselines/protected-baseline-allowed-paths.json');
      expect(allowedPaths).toContain(path);
      expect(provenance.authorizations).toContainEqual({ path, sourceCommit });
      expect(pathsByCommit.get(fullSourceCommits.get(sourceCommit)!)).toContain(path);
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
      expect(allowedPaths).not.toContain(broadPath);
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
