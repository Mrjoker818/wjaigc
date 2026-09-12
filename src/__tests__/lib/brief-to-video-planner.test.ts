import { describe, expect, it } from 'vitest';

import {
  buildBriefToVideoPlanPrompt,
  parseBriefToVideoPlanResponse,
} from '@/lib/brief-to-video/planner';
import type { BriefToVideoInput, BriefToVideoPlanV1 } from '@/lib/brief-to-video/types';
import {
  durableSkillOutputFromStructuredResult,
  parseDurableSkillOutput,
} from '@/lib/skill-runtime/structured-output';

const input: BriefToVideoInput = {
  brief: '为城市跑鞋制作发布短片', goal: '产品转化', audience: '城市跑者',
  platform: '抖音', style: '电影感', durationSeconds: 10, aspectRatio: '9:16',
  generateAudio: false,
};

const plan: BriefToVideoPlanV1 = {
  schemaId: 'brief-to-video-plan-v1', title: '轻盈向前', logline: '跑者穿越城市。',
  durationSeconds: 10, aspectRatio: '9:16',
  scenes: [{ order: 1, timeRange: '0-10s', visual: '城市跑者', camera: '跟拍', action: '加速' }],
  finalVideoPrompt: '电影感城市跑鞋短片', negativePrompt: '闪烁，变形',
  factualConstraints: ['鞋面保持白色'],
};

describe('brief to video planner', () => {
  it('builds a bounded instruction that preserves requested facts', () => {
    const prompt = buildBriefToVideoPlanPrompt(input);
    expect(prompt).toContain('为城市跑鞋制作发布短片');
    expect(prompt).toContain('brief-to-video-plan-v1');
    expect(prompt).toContain('10');
    expect(prompt.length).toBeLessThan(16_000);
  });

  it('includes a bounded user revision in the next planning request', () => {
    expect(buildBriefToVideoPlanPrompt(input, '减少首镜头时长，强化产品特写'))
      .toContain('上一版修改要求：减少首镜头时长，强化产品特写');
  });

  it.each([
    ['direct JSON', JSON.stringify(plan)],
    ['JSON fence', `\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`\n`],
    ['OpenAI envelope', { choices: [{ message: { content: JSON.stringify(plan) } }] }],
    ['SSE deltas', JSON.stringify(plan).match(/.{1,40}/gu)!
      .map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`)
      .concat('data: [DONE]').join('\n\n')],
  ])('parses %s into the strict plan contract', (_name, response) => {
    expect(parseBriefToVideoPlanResponse(response)).toEqual(plan);
  });

  it.each([
    '{"scenes":[]}',
    'not-json',
    { choices: [] },
    `data: ${JSON.stringify({ choices: [{ delta: { content: '{"scenes":[]}' } }] })}`,
  ])('rejects malformed provider output without a free-text fallback', response => {
    expect(() => parseBriefToVideoPlanResponse(response)).toThrow('BRIEF_VIDEO_PLAN_INVALID');
  });

  it('round-trips the plan through the durable Skill output contract', () => {
    const output = durableSkillOutputFromStructuredResult('plan-film', {
      schemaId: 'brief-to-video-plan-v1', value: plan,
    });
    expect(parseDurableSkillOutput(output)).toEqual({
      stepId: 'plan-film', kind: 'json', schemaId: 'brief-to-video-plan-v1',
      content: JSON.stringify(plan),
    });
  });
});
