import { describe, expect, it } from 'vitest';

import {
  assertBrandIpGenerationAllowed,
  getBrandIpStage,
  type BrandIpProject,
} from '@/lib/brand-ip';

const createProject = (overrides: Partial<BrandIpProject> = {}): BrandIpProject => ({
  id: 'project-1',
  userId: 'user-1',
  name: '无界品牌 IP',
  brief: {
    brandName: '无界AI',
    objective: '建立可持续延展的品牌角色',
    audience: '创意工作者',
    personality: ['专业', '敏捷'],
  },
  directions: [],
  confirmedDirectionId: null,
  immutableCore: [],
  controlledVariables: [],
  currentStage: 'brand-goal',
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
  ...overrides,
});

describe('brand IP project state', () => {
  it('blocks image generation until a role direction is confirmed', () => {
    expect(() => assertBrandIpGenerationAllowed(createProject())).toThrowError(
      '请先确认一个角色方向，再开始图像生成',
    );
  });

  it('allows generation only when the confirmed direction belongs to the project', () => {
    const project = createProject({
      directions: [
        {
          id: 'direction-1',
          name: '边界探索者',
          concept: '以探索和连接为核心的品牌角色',
          scores: { brandRole: 88, ownability: 84, feasibility: 91 },
          status: 'confirmed',
        },
      ],
      confirmedDirectionId: 'direction-1',
    });

    expect(assertBrandIpGenerationAllowed(project).id).toBe('direction-1');
    expect(getBrandIpStage(project)).toBe('visual-system');
  });

  it('rejects a dangling confirmed direction id', () => {
    const project = createProject({ confirmedDirectionId: 'missing-direction' });

    expect(() => assertBrandIpGenerationAllowed(project)).toThrowError(
      '已确认的角色方向不存在',
    );
  });
});
