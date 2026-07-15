export type HumanTargetType =
  | 'face'
  | 'left_hand'
  | 'right_hand'
  | 'body'
  | 'feet'
  | 'hair'
  | 'clothes'
  | 'interaction';

export type HumanRepairMode = 'light' | 'standard' | 'deep';

export interface HumanImageDescriptor {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface HumanBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HumanPerson {
  id: string;
  box: HumanBox;
}

export interface HumanTarget {
  id: string;
  personId: string;
  type: HumanTargetType;
  box: HumanBox;
  qualityScore: number;
  recommendedMode: HumanRepairMode | 'no_repair';
  issues: string[];
}

export interface HumanAnalysis {
  image: HumanImageDescriptor;
  persons: HumanPerson[];
  targets: HumanTarget[];
  scores: Record<string, number>;
  recommendations: Array<{ targetId: string; mode: HumanRepairMode }>;
  detector: 'mock' | 'vision-adapter';
}

export interface HumanRepairOptions {
  strength?: number;
  lockIdentity?: boolean;
  lockHair?: boolean;
  lockClothes?: boolean;
  lockPose?: boolean;
  lockBackground?: boolean;
  protectTextLogoProduct?: boolean;
}

export interface HumanMaskSpec {
  shape: 'ellipse' | 'rounded-box';
  box: HumanBox;
  featherPx: number;
  protectOutside: true;
}

export interface HumanCandidate {
  id: string;
  targetId: string;
  imageUrl: string;
  provider: string;
  structureScore: number;
  outsideChangeRate: number;
  validation: {
    preservation: number;
    total: number;
    passed: boolean;
  };
}

interface CandidateInput {
  id: string;
  targetId: string;
  imageUrl: string;
  provider: string;
  structureScore: number;
  outsideChangeRate: number;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function recommend(score: number): HumanRepairMode | 'no_repair' {
  if (score >= 85) return 'no_repair';
  if (score >= 70) return 'light';
  if (score >= 50) return 'standard';
  return 'deep';
}

function makeBox(image: HumanImageDescriptor, x: number, y: number, width: number, height: number): HumanBox {
  return {
    x: Math.round(image.width * x),
    y: Math.round(image.height * y),
    width: Math.max(1, Math.round(image.width * width)),
    height: Math.max(1, Math.round(image.height * height)),
  };
}

/**
 * Deterministic adapter used for CI and when no configured vision detector is
 * available. A production detector can replace this output through the API
 * adapter without changing UI, task, or provider contracts.
 */
export function analyzeHumanImage(image: HumanImageDescriptor): HumanAnalysis {
  const person: HumanPerson = { id: 'person_01', box: makeBox(image, 0.16, 0.05, 0.68, 0.9) };
  const targetSpecs: Array<[HumanTargetType, number, number, number, number, number, string[]]> = [
    ['face', 0.39, 0.10, 0.22, 0.24, 64, ['blur', 'eye_asymmetry']],
    ['left_hand', 0.18, 0.48, 0.14, 0.2, 72, ['finger_structure']],
    ['right_hand', 0.68, 0.48, 0.14, 0.2, 48, ['extra_fingers', 'object_intersection']],
    ['body', 0.30, 0.34, 0.4, 0.48, 71, ['limb_proportion']],
    ['feet', 0.32, 0.79, 0.34, 0.14, 76, ['foot_perspective']],
    ['hair', 0.35, 0.05, 0.3, 0.2, 82, ['edge_frizz']],
    ['clothes', 0.27, 0.32, 0.46, 0.47, 80, ['fabric_artifact']],
    ['interaction', 0.62, 0.46, 0.22, 0.23, 52, ['contact_alignment']],
  ];
  const targets = targetSpecs.map(([type, x, y, width, height, qualityScore, issues]) => ({
    id: `${type}_01`,
    personId: person.id,
    type,
    box: makeBox(image, x, y, width, height),
    qualityScore,
    recommendedMode: recommend(qualityScore),
    issues,
  }));
  const scores = Object.fromEntries(targets.map(target => [target.type, target.qualityScore]));
  scores.overall = round(targets.reduce((sum, target) => sum + target.qualityScore, 0) / targets.length);
  return {
    image,
    persons: [person],
    targets,
    scores,
    recommendations: targets
      .filter((target): target is HumanTarget & { recommendedMode: HumanRepairMode } => target.recommendedMode !== 'no_repair')
      .map(target => ({ targetId: target.id, mode: target.recommendedMode })),
    detector: 'mock',
  };
}

export function buildHumanMaskSpec(target: HumanTarget, image: HumanImageDescriptor, mode: HumanRepairMode): HumanMaskSpec {
  const expansion = { light: 0.08, standard: 0.18, deep: 0.3 }[mode];
  const paddingX = target.box.width * expansion;
  const paddingY = target.box.height * expansion;
  const x = Math.max(0, Math.floor(target.box.x - paddingX));
  const y = Math.max(0, Math.floor(target.box.y - paddingY));
  const right = Math.min(image.width, Math.ceil(target.box.x + target.box.width + paddingX));
  const bottom = Math.min(image.height, Math.ceil(target.box.y + target.box.height + paddingY));
  return {
    shape: target.type === 'face' ? 'ellipse' : 'rounded-box',
    box: { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) },
    featherPx: Math.max(4, Math.round(Math.min(target.box.width, target.box.height) * 0.06)),
    protectOutside: true,
  };
}

export function buildHumanRepairPrompt(target: HumanTarget, options: HumanRepairOptions = {}): string {
  const subject = target.type === 'face'
    ? 'Repair only the masked face: natural eyes, facial structure and skin texture.'
    : target.type === 'left_hand' || target.type === 'right_hand'
      ? 'Repair only the masked hand and wrist: five natural fingers, joints, perspective and object contact.'
      : target.type === 'interaction'
        ? 'Repair only the masked human-object contact without changing the object.'
        : `Repair only the masked ${target.type.replace('_', ' ')} region with natural anatomy and texture.`;
  const locks = [
    options.lockIdentity !== false ? 'identity' : '',
    options.lockHair !== false ? 'hair' : '',
    options.lockClothes !== false ? 'clothes' : '',
    options.lockPose !== false ? 'pose' : '',
    options.lockBackground !== false ? 'background' : '',
  ].filter(Boolean).join(', ');
  const productProtection = options.protectTextLogoProduct !== false
    ? ' Preserve text, logo and product exactly; never alter pixels outside the mask.'
    : ' Preserve pixels outside the mask.';
  return `${subject} Keep ${locks} unchanged.${productProtection} Repair strength: ${clamp(options.strength ?? 0.7, 0, 1)}.`;
}

export function rankHumanCandidates(inputs: CandidateInput[]): HumanCandidate[] {
  return inputs
    .map(input => {
      const preservation = round(clamp(100 - input.outsideChangeRate * 10000));
      const total = round(input.structureScore * 0.7 + preservation * 0.3);
      return {
        ...input,
        validation: {
          preservation,
          total,
          passed: input.outsideChangeRate <= 0.01 && total >= 75,
        },
      };
    })
    .sort((left, right) => Number(right.validation.passed) - Number(left.validation.passed) || right.validation.total - left.validation.total);
}
