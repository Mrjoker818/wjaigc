import { describe, expect, it } from 'vitest';

import { createMultiPlatformExportSkill } from '@/lib/skill-runtime/multi-platform-export-preset';
import { buildWorkflowSkillRunRequest, createWorkflowNode } from '@/lib/workflow-engine';
import { projectWorkflowSkillRun } from '@/lib/workflow-skill-execution';

describe('workflow multi-platform export contract', () => {
  it('binds managed upstream versions to the export input without model bindings', () => {
    const skill = createMultiPlatformExportSkill(true);
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = {
      ...node.config,
      skillId: skill.id,
      version: skill.version,
      inputValues: {
        targetPresetIds: ['instagram-post-v1'],
        fit: 'cover',
        background: '#ffffffff',
        namingTemplate: '{asset}-{platform}-{size}',
      },
    };

    const request = buildWorkflowSkillRunRequest(node, {
      assetReferences: [
        { assetVersionId: 'source-v1', url: '/source-1.png' },
        { assetVersionId: 'source-v2', url: '/source-2.png' },
      ],
    }, skill, {
      projectId: 'project-1', workflowId: 'workflow-1', executionId: 'execution-1',
    });

    expect(request.body).toMatchObject({
      modelBindings: {},
      sourceVersionIds: ['source-v1', 'source-v2'],
      inputValues: { sourceAssetVersionIds: ['source-v1', 'source-v2'] },
    });
  });

  it('projects export images, manifest, ZIP and outcome separately', () => {
    const projected = projectWorkflowSkillRun({
      runId: 'run-1',
      status: 'completed',
      assetVersionIds: ['image-v1', 'manifest-v1', 'zip-v1'],
      outputs: [{
        stepId: 'export',
        kind: 'json',
        schemaId: 'multi-platform-export-result-v1',
        content: JSON.stringify({
          schemaVersion: 1,
          runId: 'run-1',
          outcome: 'completed',
          imageAssetVersionIds: ['image-v1'],
          manifestAssetVersionId: 'manifest-v1',
          zipAssetVersionId: 'zip-v1',
          failures: [],
        }),
      }],
    }, [
      { assetVersionId: 'image-v1', url: '/image.png', kind: 'image' },
      { assetVersionId: 'manifest-v1', url: '/manifest.json', kind: 'document' },
      { assetVersionId: 'zip-v1', url: '/export.zip', kind: 'document' },
    ]);

    expect(projected).toMatchObject({
      outcome: 'completed',
      imageAssetVersionIds: ['image-v1'],
      manifestAssetVersionId: 'manifest-v1',
      zipAssetVersionId: 'zip-v1',
      imageUrls: ['/image.png'],
      documentAssetVersionIds: ['manifest-v1', 'zip-v1'],
    });
  });
});
