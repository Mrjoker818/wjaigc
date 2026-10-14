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
    findArgument: (args: string[], name: string, fallback?: string | null) => string | null;
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

const exactAgentRuntimeAuthorizations = [
  ['src/app/api/agent-runs/[runId]/events/route.ts', '0c5c1adf'],
  ['src/app/api/agent-runs/[runId]/route.ts', '0c5c1adf'],
  ['src/app/api/agent-runs/route.ts', 'ae8d4608'],
  ['src/lib/agent-runtime/admission-gate.ts', 'b1bcf2d8'],
  ['src/lib/agent-runtime/context-adapters.ts', 'd619ec21'],
  ['src/lib/agent-runtime/downstream-operations.ts', 'ee60a0d3'],
  ['src/lib/agent-runtime/event-reducer.ts', '0c5c1adf'],
  ['src/lib/agent-runtime/event-storage.ts', 'd84ba085'],
  ['src/lib/agent-runtime/generate-image-adapter.ts', '3f93aa34'],
  ['src/lib/agent-runtime/legacy-observer.ts', '571ba587'],
  ['src/lib/agent-runtime/mode.ts', '12327887'],
  ['src/lib/agent-runtime/model-capability-set.ts', 'b1bcf2d8'],
  ['src/lib/agent-runtime/provider-submission.ts', '2175b4f4'],
  ['src/lib/agent-runtime/same-task-adapter.ts', 'b1bcf2d8'],
  ['src/lib/agent-runtime/service.ts', 'b1bcf2d8'],
  ['src/lib/agent-runtime/surface-dispatch.ts', '3f93aa34'],
  ['src/lib/agent-runtime/surface-requests.ts', '14adbf0c'],
  ['src/lib/agent-runtime/tool-registry.ts', 'b1bcf2d8'],
  ['src/lib/agent-runtime/types.ts', '0c5c1adf'],
  ['src/lib/agent-runtime/workspace-results.ts', '2557d67c'],
] as const;

const historicalSourceAuthorizations = [
  ...exactAgentRuntimeAuthorizations,
  ['migrations/20260902_unified_skill_task4_agent_controls.sql', '9226821e'],
  ['migrations/20260902_unified_skill_task4_execution_fence.sql', '2bbd6851'],
  ['migrations/20260903_unified_skill_task4_dispatch_lease.sql', 'b8c687d3'],
  ['migrations/20260904_unified_skill_task4_agent_edit_descriptor.sql', 'b8c687d3'],
  ['src/app/api/workflow/execute/route.ts', '347b0b21'],
  ['src/lib/skill-runtime/workflow-client.ts', '347b0b21'],
  ['src/lib/workflow-execution-context.ts', '347b0b21'],
  ['src/lib/workflow-skill-execution.ts', '347b0b21'],
  ['src/components/skill-runtime/dataset-file-parser.ts', '21913c4a'],
  ['src/lib/skill-runtime/content-commerce-presets.ts', 'f760c3f7'],
  ['src/lib/skill-runtime/dataset-schema.ts', 'e6da017a'],
  ['src/lib/skill-runtime/step-compiler.ts', 'f760c3f7'],
  ['src/app/api/skill-reports/[runId]/[stepId]/route.ts', 'b6920680'],
  ['src/components/skill-runtime/PlatformComplianceReportCard.tsx', '835e155e'],
  ['src/components/skill-runtime/platform-compliance-client.ts', '835e155e'],
  ['src/lib/platform-compliance/media-audit.ts', '21701f84'],
  ['src/lib/platform-compliance/report-asset.ts', 'b6920680'],
  ['src/lib/platform-compliance/report-builder.ts', '7019a60b'],
  ['src/lib/platform-compliance/report-schema.ts', '085be096'],
  ['src/lib/platform-compliance/rules.ts', '085be096'],
  ['src/lib/platform-compliance/technical-evaluator.ts', '21701f84'],
  ['src/lib/platform-compliance/types.ts', '085be096'],
  ['src/lib/platform-compliance/vision-client.ts', '7019a60b'],
  ['src/lib/skill-runtime/compiled-fan-out.ts', 'c7afc22f'],
  ['src/lib/skill-runtime/platform-compliance-preset.ts', 'ca434bd4'],
  ['src/lib/skill-runtime/structured-output.ts', '33c28202'],
  ['migrations/20260821_v588_admin_thumbnail_variants.sql', 'd941384'],
  ['migrations/20260821_wj_stable_s4_historical_media_remediations.sql', 'bc74b89'],
  ['scripts/coze-deploy-build.sh', '172f38c'],
  ['scripts/coze-preview-build.sh', '172f38c'],
  ['scripts/doctor-asset-status.mjs', 'e809f5c'],
  ['src/app/api/admin/assets/remediation/route.ts', 'e97533c9'],
  ['src/app/api/admin/backfill-thumbnails/route.ts', 'd941384'],
  ['src/app/api/admin/dashboard-stats/route.ts', '1ba98f7'],
  ['src/app/api/admin/production-readiness/route.ts', '05f6717'],
  ['src/app/api/assets/[assetId]/restore/route.ts', '0756f71'],
  ['src/app/api/assets/adopt-canvas-image/route.ts', 'c99fb72'],
  ['src/components/dashboard/admin-tabs.tsx', '795d3fe3'],
  ['src/components/canvas/CanvasCommandPalette.tsx', '8acb3c9'],
  ['src/components/canvas/CanvasEditColorRemoveBgPanel.tsx', '2fc5c83'],
  ['src/components/canvas/CanvasEditEraseMaskPanel.tsx', 'e3991f3'],
  ['src/components/canvas/CanvasEditExpandCropPanel.tsx', '2fc5c83'],
  ['src/components/canvas/CanvasEditUpscaleSvgPanel.tsx', '2fc5c83'],
  ['src/components/canvas/CanvasEmptyState.tsx', 'feac579'],
  ['src/components/canvas/CanvasImageActionToolbar.tsx', '69d3466'],
  ['src/components/canvas/CanvasZoomCluster.tsx', 'c808e50'],
  ['src/lib/admin-dashboard-projection.ts', '1ba98f7'],
  ['src/lib/admin-model-authorization.ts', 'e455ea8c'],
  ['src/lib/asset-core/asset-release-readiness.ts', 'e809f5c'],
  ['src/lib/asset-core/asset-version-id.ts', '746198f6'],
  ['src/lib/asset-core/canvas-adapter.ts', '5a35b98'],
  ['src/lib/asset-core/canvas-placement-snapshot.ts', '69479f7'],
  ['src/lib/asset-core/canvas-project-sync.ts', 'd619ec21'],
  ['src/lib/asset-core/historical-media-remediation.ts', 'd619ec21'],
  ['src/lib/asset-core/legacy-migration.ts', 'd619ec21'],
  ['src/lib/asset-core/media-health.ts', 'd619ec21'],
  ['src/lib/asset-core/recovery-media.ts', 'd619ec21'],
  ['src/lib/asset-core/service.ts', 'd619ec21'],
  ['src/lib/asset-core/storage.ts', 'd619ec21'],
  ['src/lib/asset-core/thumbnail-backfill.ts', 'd619ec21'],
  ['src/lib/canvas-kernel/persistence.ts', 'efe5e4f'],
  ['src/lib/image-toolbar-position.ts', '2fc5c83'],
  ['src/lib/image-toolbar-preferences.ts', '69d3466'],
  ['src/lib/project-workflow.ts', '016e5d2'],
  ['migrations/20260823_v588_auth_credentials.sql', 'b63025be'],
  ['scripts/collect-v588-auth-artifacts.ts', '02a3bd3d'],
  ['scripts/v588-auth-fixture.mjs', '02a3bd3d'],
  ['scripts/verify-v588-auth-stable-contract.mjs', '02a3bd3d'],
  ['src/app/api/admin/apis/route.ts', '96c1907b'],
  ['src/app/api/admin/credits/overview/route.ts', '795d3fe3'],
  ['src/app/api/admin/credits/pricing/route.ts', '2c25af59'],
  ['src/app/api/auth/login/route.ts', '9c693b1d'],
  ['src/app/api/auth/me/route.ts', '9c693b1d'],
  ['src/app/api/simple-chat/deep-research/route.ts', '3773f66c'],
  ['src/app/api/font-design/generate-image/route.ts', '27d16726'],
  ['src/app/api/models/route.ts', 'd4c9d015'],
  ['src/app/api/universal-generate/route.ts', '536882aa'],
  ['src/app/api/video/extend/route.ts', 'b1bcf2d8'],
  ['src/app/api/video/generate/route.ts', 'ecb0d95c'],
  ['src/app/api/workflow/models/route.ts', 'd4c9d015'],
  ['src/app/page.tsx', '2214ad4c'],
  ['src/components/dashboard/dashboard-view.tsx', '96c1907b'],
  ['src/components/dashboard/login-panel.tsx', '2214ad4c'],
  ['src/components/dashboard/model-capability-editor.tsx', '96c1907b'],
  ['src/components/generation-background-control.tsx', '6522c7ef'],
  ['src/components/generation-panel.tsx', 'cce434a1'],
  ['src/components/operation-audit-client.tsx', '7bf1cc3c'],
  ['src/components/scene-studio-panel.tsx', 'd7ffe827'],
  ['src/components/sticker-assistant-panel.tsx', 'd7ffe827'],
  ['src/components/third-party-model-dialog.tsx', '96c1907b'],
  ['src/components/video-generation-panel.tsx', 'ecb0d95c'],
  ['src/components/simple-chat/canvas-editor.tsx', 'ffa41558'],
  ['src/components/simple-chat/sidebar.tsx', 'e4316f8f'],
  ['src/hooks/use-task-model-catalog.ts', '47090886'],
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
  ['src/lib/server-api-config.ts', '087fae12'],
  ['src/lib/server-auth.ts', '6102572b'],
  ['src/lib/simple-chat-logout.ts', 'b0cd946f'],
  ['src/components/simple-chat/simple-chat-sync-status.tsx', '37fb6d12'],
  ['src/lib/simple-chat-project-sync.ts', '6a5e7baa'],
  ['src/lib/simple-chat-sync-client.ts', '0ce9f539'],
  ['src/lib/simple-chat-sync-server.ts', 'ceac3db8'],
  ['src/lib/simple-chat-sync-storage.ts', '7b465597'],
  ['src/lib/simple-chat-retry.ts', '3773f66c'],
  ['src/lib/task-core/candidate-model-admission.ts', 'b1bcf2d8'],
  ['src/lib/task-core/descriptor-image-request-fields.ts', 'b1bcf2d8'],
  ['src/lib/task-core/exact-model-selection.ts', 'b1bcf2d8'],
  ['src/lib/task-core/exact-provider-routing.ts', 'b1bcf2d8'],
  ['src/lib/task-core/image-output-fanout.ts', 'b1bcf2d8'],
  ['src/lib/task-core/model-capability-contract.ts', 'c7db96f1'],
  ['src/lib/task-core/model-capability-resolution.ts', '96c1907b'],
  ['src/lib/task-core/provider-capability-adapters.ts', '15827a50'],
  ['src/lib/task-core/task-abort.ts', '8cc902b8'],
  ['src/lib/task-events-client.ts', 'b0cd946f'],
  ['src/lib/universal-api-manager.ts', '96c1907b'],
  ['src/lib/universal-api-types.ts', '1798d252'],
  ['src/app/api/analyze-psd/route.ts', 'f7883f96'],
  ['src/app/api/element-decompose/route.ts', '8d01e9ca'],
  ['src/app/api/assets/transfer/route.ts', 'b3fe71b4'],
  ['src/app/api/brand-ecommerce/result-store.ts', '6a9efa5e'],
  ['src/app/api/brand-ecommerce/route.ts', '6a9efa5e'],
  ['src/app/api/font-design/plan/constants.ts', 'c4b49293'],
  ['src/app/api/font-design/plan/route.ts', 'c4b49293'],
  ['src/app/api/font-design/prompt/route.ts', 'c4b49293'],
  ['src/app/api/refine-engine/result-store.ts', '6a9efa5e'],
  ['src/app/api/refine-engine/route.ts', '6a9efa5e'],
  ['src/app/api/simple-chat/workspace-handoff/route.ts', 'b67930cf'],
  ['src/components/psd-editor/LayerInspector.tsx', '34c8980d'],
  ['src/components/psd-editor/PsdCanvas.tsx', '34c8980d'],
  ['src/components/psd-editor/PsdLayerEditor.tsx', 'a50fcbeb'],
  ['src/app/api/layer-documents/route.ts', '5dfa1f0c'],
  ['src/lib/layer-documents/client.ts', '68242e43'],
  ['src/lib/layer-documents/service.ts', '5dfa1f0c'],
  ['src/lib/layer-documents/storage.ts', 'f8c9bf44'],
  ['src/lib/layer-documents/types.ts', 'ca6858f6'],
  ['src/lib/layer-documents/validation.ts', 'ca6858f6'],
  ['src/components/workspace-source-trace.tsx', '09e2b0c0'],
  ['src/lib/asset-core/source-trace.ts', '496d7892'],
  ['src/lib/asset-core/types.ts', '27c625ca'],
  ['src/lib/canvas-kernel/selection.ts', '6bea240f'],
  ['src/lib/editable-layer-adapter.ts', '34c8980d'],
  ['src/lib/element-decomposition/client.ts', '2166f032'],
  ['src/lib/element-decomposition/reconstruction.ts', '940a0b7f'],
  ['src/lib/layer-decomposition-client.ts', '2166f032'],
  ['src/lib/layer-decomposition/layer-stack-order.ts', '940a0b7f'],
  ['src/lib/layer-decomposition/pear-adapter.ts', 'ca356477'],
  ['src/lib/layer-decomposition/quality-gate.ts', '940a0b7f'],
  ['src/lib/layer-decomposition/service.ts', 'ca356477'],
  ['src/lib/layer-decomposition/source-image.ts', 'ac8e826b'],
  ['src/lib/layer-decomposition/types.ts', 'ca356477'],
  ['src/lib/model-defaults.ts', '0a36aefd'],
  ['src/lib/project-workspace-url.ts', 'cdded1e2'],
  ['src/lib/psd-analysis/contracts.ts', 'f7883f96'],
  ['src/lib/psd-analysis/media.ts', 'f7883f96'],
  ['src/lib/psd-analysis/model-router.ts', '1b0996ad'],
  ['src/lib/psd-analysis/service.ts', 'f7883f96'],
  ['src/lib/psd-canvas-surface.ts', '34c8980d'],
  ['src/lib/psd-export.ts', '34c8980d'],
  ['src/lib/safe-image-download.ts', 'ac8e826b'],
  ['src/lib/safe-image-input.ts', 'bc1ee2b0'],
  ['src/lib/simple-chat-workspace-handoff-client.ts', '3f056442'],
  ['src/lib/simple-chat-workspace-handoff-server.ts', '496d7892'],
  ['src/lib/simple-chat-workspace-handoff.ts', '3f056442'],
  ['src/lib/user-types.ts', '250d7cf1'],
  ['src/app/api/skill-runs/[runId]/retry/route.ts', 'd85a8b08'],
  ['src/app/api/skill-runs/[runId]/route.ts', 'd85a8b08'],
  ['src/app/api/skill-runs/estimate/route.ts', 'bfc97edc'],
  ['src/app/api/skill-runs/http.ts', 'd85a8b08'],
  ['src/app/api/skill-runs/route.ts', '5d0f69d6'],
  ['src/app/api/skills/[skillId]/route.ts', 'd68391cc'],
  ['src/app/api/skills/http.ts', 'e196d039'],
  ['src/app/api/skills/route.ts', 'd68391cc'],
  ['src/lib/abort-signal.ts', 'd0bf0dc3'],
  ['src/lib/agent-runtime/agent-edit-continuation.ts', 'b8c687d3'],
  ['src/lib/agent-runtime/agent-edit-execution-descriptor.ts', '01377806'],
  ['src/lib/agent-runtime/agent-edit-execution-service.ts', 'd0bf0dc3'],
  ['src/lib/agent-runtime/agent-edit-executor.ts', 'b8c687d3'],
  ['src/lib/agent-runtime/execution-dispatch.ts', '781c57a4'],
  ['src/lib/agent-runtime/execution-fence.ts', '2bbd6851'],
  ['src/lib/agent-runtime/model-route-error.ts', 'b8c687d3'],
  ['src/lib/agent-runtime/request-validation.ts', 'bfc97edc'],
  ['src/lib/skill-runtime/canvas-presets.ts', 'ff0e94c5'],
  ['src/lib/skill-runtime/catalog.ts', 'ff0e94c5'],
  ['src/lib/skill-runtime/continuation.ts', '5d0f69d6'],
  ['src/lib/skill-runtime/cost-estimator.ts', 'bfc97edc'],
  ['src/lib/skill-runtime/executor.ts', '5d0f69d6'],
  ['src/lib/skill-runtime/input-resolver.ts', '50888daa'],
  ['src/lib/skill-runtime/legacy-migration.ts', 'e196d039'],
  ['src/lib/skill-runtime/marketing-presets.ts', 'f7c17468'],
  ['src/lib/skill-runtime/prompt-compiler.ts', '50888daa'],
  ['src/lib/skill-runtime/quality-gates.ts', 'fb70d7c7'],
  ['src/lib/skill-runtime/run-request.ts', 'bfc97edc'],
  ['src/lib/skill-runtime/service.ts', '5d0f69d6'],
  ['src/lib/skill-runtime/simple-chat-presets.ts', 'ff0e94c5'],
  ['src/lib/skill-runtime/step-registry.ts', '5d0f69d6'],
  ['src/lib/skill-runtime/storage.ts', 'e196d039'],
  ['src/lib/skill-runtime/types.ts', 'e196d039'],
  ['src/lib/task-core/durable-generation-kickoff.ts', 'd0bf0dc3'],
  ['src/app/api/tasks/recover/route.ts', '70c93f6b'],
  ['src/app/simple-create/page.tsx', '70c93f6b'],
  ['src/components/canvas/mobile-bottom-toolbar.tsx', 'ca923edd'],
  ['src/components/canvas/mobile-image-actions.tsx', '2e309a05'],
  ['src/components/canvas/use-canvas-viewport.ts', '2c315950'],
  ['src/components/simple-create/simple-create-form.tsx', '70c93f6b'],
  ['src/components/simple-create/simple-create-page.tsx', 'f67b20be'],
  ['src/components/simple-create/simple-create-results.tsx', '70c93f6b'],
  ['src/lib/canvas-touch-gestures.ts', '061f2257'],
  ['src/lib/image-generation-session.ts', '70c93f6b'],
  ['src/lib/mobile-canvas-toolbar.ts', 'ca923edd'],
  ['src/lib/simple-create-navigation.ts', '70c93f6b'],
  ['src/app/api/admin/gateway/keys/[keyId]/route.ts', '6f41d2a9'],
  ['src/app/api/admin/gateway/keys/route.ts', '6f41d2a9'],
  ['src/app/api/gateway/v1/images/route.ts', 'fbaa13d9'],
  ['src/app/api/gateway/v1/tasks/[taskId]/cancel/route.ts', '1071de17'],
  ['src/app/api/gateway/v1/tasks/[taskId]/route.ts', '1071de17'],
  ['src/app/api/gateway/v1/videos/route.ts', 'fbaa13d9'],
  ['src/components/dashboard/media-gateway-admin.tsx', '0ae86da8'],
  ['src/lib/media-gateway/admission.ts', '301fc4af'],
  ['src/lib/media-gateway/audit.ts', '752b2504'],
  ['src/lib/media-gateway/http.ts', '031c6a58'],
  ['src/lib/media-gateway/internal-client.ts', '54e21e65'],
  ['src/lib/media-gateway/key-service.ts', '301fc4af'],
  ['src/lib/media-gateway/schema.ts', 'd387736d'],
  ['src/lib/media-gateway/task-projection.ts', '9ecb8a06'],
  ['src/lib/media-gateway/types.ts', '91c1f6c2'],
  ['src/lib/media-gateway/utc-day-window.ts', '301fc4af'],
  ['.superpowers/sdd/media-gateway-task-7-fix-review-package.md', 'a790f953'],
  ['.superpowers/sdd/media-gateway-task-7-report.md', '4a6ae9da'],
  ['.superpowers/sdd/media-gateway-task-8-report.md', '74716cb9'],
  ['.superpowers/sdd/media-gateway-task-9-report.md', 'b108312b'],
  ['.superpowers/sdd/media-gateway-task-9-review-package.md', 'b108312b'],
  ['migrations/20260913_v588_media_gateway.sql', '91c1f6c2'],
  ['src/app/api/sketch-to-code/[taskId]/document/route.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/app/api/sketch-to-code/route.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/components/sketch-to-code-panel.tsx', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/admission.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/client.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/configured-dependencies.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/document.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/drawing.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/execution.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/generation.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/html.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/http.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/placement-client.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/provider.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/publication.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/render.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/task-http.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/token-billing.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/usage.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/sketch-to-code/workflow.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
  ['src/lib/workflow-renderer/legacy-port-position.ts', '2729e0f903e68d1005ac21bc968f7fb529c37470'],
] as const;

const unifiedSkillRuntimeArtifactPaths = [
  '.superpowers/sdd/task-5-report.md',
  '.superpowers/sdd/task-6-report.md',
  '.superpowers/sdd/unified-skill-task-2-report.md',
  '.superpowers/sdd/unified-skill-task-3-report.md',
  '.superpowers/sdd/unified-skill-task-4-report.md',
  'migrations/20260902_unified_skill_task4_agent_controls.sql',
  'migrations/20260902_unified_skill_task4_execution_fence.sql',
  'migrations/20260903_unified_skill_task4_dispatch_lease.sql',
  'migrations/20260904_unified_skill_task4_agent_edit_descriptor.sql',
] as const;

describe('protected baseline release gate', () => {
  it('lets a workflow-supplied argument override the package default', async () => {
    const { findArgument } = await loadGateModule();

    expect(findArgument([
      '--base',
      'recorded-baseline',
      '--base',
      'workflow-event-base',
    ], '--base', 'origin/main')).toBe('workflow-event-base');
  });

  it('authorizes the nine reviewed unified Skill runtime artifacts by exact path', async () => {
    const allowedPaths = JSON.parse(await readFile(
      resolve(process.cwd(), 'docs/testing/baselines/protected-baseline-allowed-paths.json'),
      'utf8',
    )) as string[];

    expect(unifiedSkillRuntimeArtifactPaths.filter(path => !allowedPaths.includes(path))).toEqual([]);
    expect(allowedPaths).not.toContain('.superpowers/');
    expect(allowedPaths).not.toContain('migrations/');
  });

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
    expect(allowedPaths).toContain(
      '.superpowers/sdd/task-v588-stability-002-completed-task-hydration-report.md',
    );
    expect(allowedPaths).toContain('src/lib/simple-chat-model-menu-position.ts');
    expect(allowedPaths).toContain('src/lib/simple-chat-request-context.ts');
    expect(allowedPaths).toContain('src/lib/element-decomposition/service.ts');
    expect(allowedPaths).toContain('migrations/20260816_wj_stable_s4_agent_events.sql');
    expect(allowedPaths).toContain('scripts/run-migrations.mjs');
    expect(allowedPaths).not.toContain('src/app/api/agent-runs/');
    expect(allowedPaths).not.toContain('src/lib/agent-runtime/');
    for (const [path] of exactAgentRuntimeAuthorizations) {
      expect(allowedPaths).toContain(path);
    }
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

  it('does not silently truncate a large untracked-file inventory', async () => {
    const gateSource = await readFile(
      resolve(process.cwd(), 'scripts/check-protected-baseline.mjs'),
      'utf8',
    );

    expect(gateSource).toContain('maxBuffer: 64 * 1024 * 1024');
    expect(gateSource).toContain("git(root, ['status', '--porcelain', '--untracked-files=all'])");
  });

  it('requires exact authorization for every committed production source drift', async () => {
    const allowedPaths = JSON.parse(await readFile(
      resolve(process.cwd(), 'docs/testing/baselines/protected-baseline-allowed-paths.json'),
      'utf8',
    )) as string[];
    const changedProductionPaths = execFileSync('git', [
      'diff',
      '--name-only',
      '7fdc0108952fb3a68415ca3a2a26b5d33641dc6b',
      'HEAD',
      '--',
      'src',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim().split(/\r?\n/).filter((path) => (
      path
      && !path.startsWith('src/__tests__/')
      && !path.startsWith('src/tests/')
    ));
    const unapprovedPaths = changedProductionPaths.filter((path) => !allowedPaths.includes(path));

    expect(
      unapprovedPaths,
      'Every committed production source drift must have one exact reviewed authorization path',
    ).toEqual([]);
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
    const reachableCommits = new Set(execFileSync('git', ['rev-list', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim().split(/\r?\n/));
    for (const [sourceCommit, fullSourceCommit] of fullSourceCommits) {
      expect(
        reachableCommits.has(fullSourceCommit),
        `${sourceCommit} must be reachable from HEAD so a clean main checkout can verify provenance`,
      ).toBe(true);
    }
    const authorizedPaths = historicalSourceAuthorizations.map(([path]) => path);
    const task8ProtectedPaths = [
      'src/components/simple-chat/simple-chat-sync-status.tsx',
      'src/lib/simple-chat-project-sync.ts',
      'src/lib/simple-chat-sync-client.ts',
      'src/lib/simple-chat-sync-server.ts',
      'src/lib/simple-chat-sync-storage.ts',
    ];
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
    for (const path of allowedPaths.filter(path => path.startsWith('src/'))) {
      expect(path.includes('*'), `${path} must not use a wildcard`).toBe(false);
      expect(path.endsWith('/'), `${path} must authorize an exact production file`).toBe(false);
    }
    for (const { path } of provenance.authorizations.filter(({ path }) => path.startsWith('src/'))) {
      expect(path.includes('*'), `${path} provenance must not use a wildcard`).toBe(false);
      expect(path.endsWith('/'), `${path} provenance must name an exact production file`).toBe(false);
    }
    for (const path of task8ProtectedPaths) {
      expect(allowedPaths).toContain(path);
      expect(authorizedPaths).toContain(path);
      expect(path.endsWith('/')).toBe(false);
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
