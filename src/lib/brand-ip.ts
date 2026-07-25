export type BrandIpStage = 'brand-goal' | 'strategy' | 'role-direction' | 'visual-system' | 'asset-generation';

export interface BrandIpBrief {
  brandName?: string;
  objective?: string;
  audience?: string;
  personality?: string[];
  [key: string]: unknown;
}

export interface BrandIpDirection {
  id: string;
  name: string;
  concept: string;
  scores: {
    brandRole: number;
    ownability: number;
    feasibility: number;
  };
  status: 'draft' | 'confirmed' | 'archived';
}

export interface BrandIpImmutableCore {
  id: string;
  label: string;
  value: string;
}

export interface BrandIpControlledVariable {
  id: string;
  label: string;
  value: string;
  risk?: 'low' | 'medium' | 'high';
}

export interface BrandIpProject {
  id: string;
  userId: string;
  name: string;
  brief: BrandIpBrief;
  directions: BrandIpDirection[];
  confirmedDirectionId: string | null;
  immutableCore: BrandIpImmutableCore[];
  controlledVariables: BrandIpControlledVariable[];
  currentStage: BrandIpStage;
  createdAt: string;
  updatedAt: string;
}

export function assertBrandIpGenerationAllowed(project: Pick<BrandIpProject, 'directions' | 'confirmedDirectionId'>): BrandIpDirection {
  if (!project.confirmedDirectionId) {
    throw new Error('请先确认一个角色方向，再开始图像生成');
  }

  const direction = project.directions.find((item: BrandIpDirection) => item.id === project.confirmedDirectionId);
  if (!direction) {
    throw new Error('已确认的角色方向不存在');
  }

  return direction;
}

export function getBrandIpStage(project: Pick<BrandIpProject, 'brief' | 'directions' | 'confirmedDirectionId' | 'immutableCore' | 'controlledVariables'>): BrandIpStage {
  if (!project.brief.brandName || !project.brief.objective) return 'brand-goal';
  if (project.directions.length === 0) return 'strategy';
  if (!project.confirmedDirectionId) return 'role-direction';
  assertBrandIpGenerationAllowed(project);
  if (project.immutableCore.length === 0 && project.controlledVariables.length === 0) return 'visual-system';
  return 'asset-generation';
}
