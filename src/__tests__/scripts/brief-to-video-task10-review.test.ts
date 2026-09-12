import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), 'utf8');
}

describe('Task 10 independent review contracts', () => {
  it('drives all three workspace chains through browser-visible controls', async () => {
    const [spec, helper] = await Promise.all([
      source('tests/e2e/brief-to-video-finished-film.spec.ts'),
      source('tests/helpers/brief-to-video.ts'),
    ]);

    for (const action of [
      'createCanvasRunFromUi',
      'reviseFromUi',
      'approveFromUi',
      'cancelFromUi',
      'runWorkflowThroughUi',
      'runSimpleChatThroughUi',
      'assertNoVideoChildInDatabase',
    ]) {
      expect(spec).toContain(`briefToVideo.${action}`);
    }
    expect(helper).toContain("getByRole('button', { name: '运行 Skill'");
    expect(helper).toContain("getByRole('button', { name: '批准生成'");
    expect(helper).toContain("getByRole('button', { name: '修改脚本'");
    expect(helper).toContain("getByRole('button', { name: '取消任务'");
    expect(helper).toContain("getByRole('button', { name: '返回画布'");
    expect(helper).toContain("getByRole('button', { name: '执行工作流'");
    expect(helper).not.toContain('createRun: runRequest');
  });

  it('requires Workflow output projection and full mobile interaction geometry', async () => {
    const [spec, helper] = await Promise.all([
      source('tests/e2e/brief-to-video-finished-film.spec.ts'),
      source('tests/helpers/brief-to-video.ts'),
    ]);

    expect(spec).toContain('workflow.videoAssetVersionId');
    expect(spec).toContain("workflow.outputNodeType).toBe('output-video')");
    expect(helper).toContain('assertNoOverlap');
    expect(helper).toContain('viewportWidth');
    expect(helper).toContain('scrollHeight');
    expect(helper).toContain("getByLabel('video 模型')");
    expect(helper).toContain('.selectOption(');
    expect(helper).toContain('.click()');
  });

  it('binds doctor to four manifests, their hashes, and non-self-referential Git provenance', async () => {
    const [doctor, evidence] = await Promise.all([
      source('scripts/doctor.mjs'),
      source('scripts/brief-to-video-evidence.mjs'),
    ]);

    expect(doctor).toContain("from './brief-to-video-evidence.mjs'");
    expect(doctor).toContain('validateBriefToVideoEvidence');
    expect(doctor).toContain('validateCandidateProvenance');
    expect(doctor).toContain('chromium');
    expect(doctor).toContain('firefox');
    expect(doctor).toContain('webkit');
    expect(doctor).toContain('mobile-chromium');
    expect(doctor).toContain('BRIEF_TO_VIDEO_VERIFY_INDEX');
    expect(evidence).toContain("git('write-tree')");
  });

  it('does not leave superseded gate or clickability claims in the progress document', async () => {
    const progress = await source('docs/plans/2026-09-12-brief-to-video-progress.md');

    expect(progress).not.toContain('目录边界 29/29/16');
    expect(progress).not.toContain('可见、可点击、不越界 | Mobile Chromium 通过');
    expect(progress).not.toContain('全量发布门禁：待文档完成后');
    expect(progress).toContain('30/30/16');
  });
});
