import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findNewBriefVideoRunId } from '../../../tests/helpers/brief-to-video-card-selection';

describe('Brief-to-video Simple Chat card selection', () => {
  it('selects only a run card that appeared after the current send', () => {
    expect(findNewBriefVideoRunId(['cancelled-old'], ['cancelled-old', 'fresh-run']))
      .toBe('fresh-run');
  });

  it('does not reuse the restored cancelled card while the new card is pending', () => {
    expect(findNewBriefVideoRunId(['cancelled-old'], ['cancelled-old'])).toBeUndefined();
    expect(findNewBriefVideoRunId(['cancelled-old'], ['cancelled-old', '', 'cancelled-old']))
      .toBeUndefined();
  });

  it('uses exact accessible labels for every Canvas Brief form control', async () => {
    const helper = await readFile(resolve(process.cwd(), 'tests/helpers/brief-to-video.ts'), 'utf8');
    for (const label of [
      'video 模型', '创作 Brief', '目标受众', '传播目标', '发布平台',
      '视频时长', '画面比例', '分辨率', '尾帧',
    ]) {
      expect(helper).toContain(`getByLabel('${label}', { exact: true })`);
    }
  });
});
