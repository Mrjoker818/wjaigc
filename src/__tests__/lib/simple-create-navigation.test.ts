import { describe, expect, it } from 'vitest';

import {
  buildSimpleCreateCanvasUrl,
  buildSimpleCreateLoginUrl,
} from '@/lib/simple-create-navigation';

describe('simple create navigation', () => {
  it('opens the managed result in the same project canvas', () => {
    expect(buildSimpleCreateCanvasUrl('project 1', {
      url: '/media/result.png',
      assetVersionId: 'version/1',
      placementId: 'placement 1',
    })).toBe('/?projectId=project+1&assetVersionId=version%2F1&placementId=placement+1');
  });

  it('preserves the exact simple-create return target for login', () => {
    expect(buildSimpleCreateLoginUrl('/simple-create?projectId=p1')).toBe(
      '/?returnTo=%2Fsimple-create%3FprojectId%3Dp1',
    );
  });
});
