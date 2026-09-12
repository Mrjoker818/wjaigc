import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildBriefToVideoResult,
  canonicalBriefToVideoResultJson,
} from '@/lib/brief-to-video/result';
import { canonicalBriefToVideoPlanJson } from '@/lib/brief-to-video/schema';
import { parseDurableSkillOutput } from '@/lib/skill-runtime/structured-output';

const plan = {
  schemaId: 'brief-to-video-plan-v1' as const,
  title: '新品短片',
  logline: '一镜到底展示新品',
  durationSeconds: 10,
  aspectRatio: '16:9',
  scenes: [{
    order: 1,
    timeRange: '0-10s',
    visual: '产品从暗处进入光线',
    camera: '缓慢推进',
    action: '产品旋转',
  }],
  finalVideoPrompt: '电影感产品短片',
  negativePrompt: '文字变形',
  factualConstraints: ['商标保持一致'],
};

describe('Brief to video finished result', () => {
  it('builds one canonical video result from the approved plan and immutable version', () => {
    const result = buildBriefToVideoResult({
      runId: 'run-video-1',
      plan,
      videoAssetVersionId: 'video-v1',
      sourceAssetVersionIds: ['start-v1', 'end-v1'],
      providerId: 'pear-video',
      modelId: 'video-model',
      remoteTaskId: 'remote-video-1',
      resolution: '1080p',
    });

    expect(result).toEqual({
      schemaId: 'brief-to-video-result-v1',
      runId: 'run-video-1',
      planChecksum: createHash('sha256').update(canonicalBriefToVideoPlanJson(plan)).digest('hex'),
      videoAssetVersionId: 'video-v1',
      sourceAssetVersionIds: ['start-v1', 'end-v1'],
      providerId: 'pear-video',
      modelId: 'video-model',
      remoteTaskId: 'remote-video-1',
      durationSeconds: 10,
      aspectRatio: '16:9',
      resolution: '1080p',
    });
    expect(JSON.parse(canonicalBriefToVideoResultJson(result))).toEqual(result);
  });

  it('registers brief-to-video-result-v1 as a durable structured output', () => {
    const result = buildBriefToVideoResult({
      runId: 'run-video-1', plan, videoAssetVersionId: 'video-v1',
      sourceAssetVersionIds: [], providerId: 'pear-video', modelId: 'video-model',
    });
    const output = parseDurableSkillOutput({
      stepId: 'generate-film', kind: 'json', schemaId: 'brief-to-video-result-v1',
      content: JSON.stringify(result),
    });

    expect(output.kind).toBe('json');
    if (output.kind !== 'json') throw new Error('expected JSON output');
    expect(output.schemaId).toBe('brief-to-video-result-v1');
    expect(output.content).toBe(canonicalBriefToVideoResultJson(result));
  });
});
