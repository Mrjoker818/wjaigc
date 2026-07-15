import {
  analyzeHumanImage,
  buildHumanMaskSpec,
  buildHumanRepairPrompt,
  rankHumanCandidates,
} from '../src/lib/human-ai-engine';
import type { HumanRepairMode } from '../src/lib/human-ai-engine';

const image = { id: 'virtual_human_001', url: '/virtual-human.png', width: 1920, height: 1080 };
const analysis = analyzeHumanImage(image);
const selected = analysis.targets.filter((target): target is typeof target & { recommendedMode: HumanRepairMode } => target.recommendedMode !== 'no_repair');
const candidates = rankHumanCandidates(selected.flatMap((target, index) => [
  { id: `candidate-${index}-a`, targetId: target.id, imageUrl: `/virtual/${target.id}-a.png`, provider: 'mock-image-edit', structureScore: Math.min(97, target.qualityScore + 18), outsideChangeRate: 0.002 },
  { id: `candidate-${index}-b`, targetId: target.id, imageUrl: `/virtual/${target.id}-b.png`, provider: 'mock-image-edit', structureScore: Math.min(98, target.qualityScore + 20), outsideChangeRate: 0.004 },
]));

const result = {
  executedAt: new Date().toISOString(),
  input: image,
  targets: selected.map(target => ({
    id: target.id,
    type: target.type,
    mask: buildHumanMaskSpec(target, image, target.recommendedMode),
    prompt: buildHumanRepairPrompt(target, { strength: 0.75 }),
  })),
  candidates: candidates.length,
  passedCandidates: candidates.filter(candidate => candidate.validation.passed).length,
  best: candidates[0],
  notice: '此虚拟测试仅验证检测、蒙版规格、保护校验与排序流程；不代表真实图像模型修复质量。',
};

if (!result.best || result.passedCandidates === 0 || result.targets.some(target => !target.mask.protectOutside)) {
  throw new Error('人物精修虚拟验收失败');
}

console.log(JSON.stringify(result, null, 2));
