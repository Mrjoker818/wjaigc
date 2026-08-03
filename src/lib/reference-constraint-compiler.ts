export type ReferenceConstraintLanguage = 'zh' | 'en' | 'bilingual';

type ReferenceCategory =
  | 'style'
  | 'composition'
  | 'scene'
  | 'color'
  | 'subject'
  | 'detail';

type ReferenceCategoriesInput = Record<string, string[]> | string[][];
type ReferenceCategoryStrengthsInput = Record<string, Record<string, unknown>>;

export interface ReferenceConstraintInput {
  providerId?: string;
  providerName?: string;
  modelId: string;
  referenceImages: string[];
  referenceDescriptions?: unknown;
  referenceCategories?: ReferenceCategoriesInput;
  referenceStrengths?: unknown;
  referenceCategoryStrengths?: unknown;
}

export interface ReferenceConstraintResult {
  language: ReferenceConstraintLanguage;
  prompt: string;
  hasActiveConstraints: boolean;
}

const CATEGORY_ORDER: ReferenceCategory[] = [
  'style',
  'composition',
  'scene',
  'color',
  'subject',
  'detail',
];

const CATEGORY_LABELS: Record<ReferenceCategory, { zh: string; en: string }> = {
  style: { zh: '风格', en: 'STYLE' },
  composition: { zh: '构图', en: 'COMPOSITION' },
  scene: { zh: '场景', en: 'SCENE' },
  color: { zh: '色彩', en: 'COLOR' },
  subject: { zh: '主体', en: 'SUBJECT' },
  detail: { zh: '细节', en: 'DETAIL' },
};

const CATEGORY_DETAILS: Record<ReferenceCategory, { zh: string; en: string }> = {
  style: {
    zh: '视觉语言、媒介或渲染方式、光影气质、材质表现与整体审美',
    en: 'visual language, medium or rendering method, lighting character, material treatment, and overall aesthetic',
  },
  composition: {
    zh: '机位、景别、裁切、主体位置、视觉层级与留白',
    en: 'camera angle, framing, crop, subject placement, visual hierarchy, and negative space',
  },
  scene: {
    zh: '环境、背景、空间关系、光线方向与氛围',
    en: 'environment, background, spatial relationships, light direction, and atmosphere',
  },
  color: {
    zh: '主色、色温、明暗关系、材质色彩与调色倾向',
    en: 'dominant palette, color temperature, tonal balance, material colors, and grading direction',
  },
  subject: {
    zh: '主体身份、轮廓、比例、结构、姿态及显著识别特征',
    en: 'subject identity, silhouette, proportions, structure, pose, and distinctive identifying features',
  },
  detail: {
    zh: '纹理、边缘、饰件、图案、可辨识标记与局部细节',
    en: 'textures, edges, ornaments, patterns, recognizable markings, and local details',
  },
};

const CHINESE_MODEL_PATTERN = /doubao|seedream|seedance|jimeng|volcengine|volces|qwen|wanx|hunyuan|kling|hidream|tongyi|zhipu|glm|ernie|minimax|sensenova|siliconflow/i;
const ENGLISH_MODEL_PATTERN = /gpt|openai|dall-e|gemini|imagen|nano[-_\s]?banana|midjourney|ideogram|recraft|flux|stable[-_\s]?diffusion|sdxl|stability|fal\.ai|bfl/i;
const CHINESE_PROVIDER_PATTERN = /火山|方舟|豆包|即梦|通义|阿里云|腾讯混元|百度|智谱|硅基|可灵|国内/i;
const ENGLISH_PROVIDER_PATTERN = /openai|pear|apimart|recraft|fal\.ai|bfl|stability|google/i;

function isReferenceCategory(value: string): value is ReferenceCategory {
  return CATEGORY_ORDER.includes(value as ReferenceCategory);
}

function clampStrength(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function getCategoryArray(
  input: ReferenceCategoriesInput | undefined,
  index: number,
): string[] {
  if (Array.isArray(input)) return Array.isArray(input[index]) ? input[index] : [];
  return input?.[String(index)] || [];
}

function getPerCategoryStrengths(
  input: unknown,
): ReferenceCategoryStrengthsInput | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  return input as ReferenceCategoryStrengthsInput;
}

function getReferenceStrength(input: unknown, index: number): number {
  if (!Array.isArray(input)) return 0;
  return clampStrength(input[index]);
}

function strengthInstruction(language: ReferenceConstraintLanguage, strength: number): string {
  if (language === 'zh') {
    if (strength >= 80) return '锁定并严格保留';
    if (strength >= 50) return '优先保持';
    if (strength >= 25) return '明显参考';
    return '轻微参考';
  }
  if (language === 'en') {
    if (strength >= 80) return 'Lock and strictly preserve';
    if (strength >= 50) return 'Prioritize preserving';
    if (strength >= 25) return 'Clearly reference';
    return 'Lightly reference';
  }
  if (strength >= 80) return 'LOCK / 严格保留';
  if (strength >= 50) return 'PRESERVE / 优先保持';
  if (strength >= 25) return 'REFERENCE / 明显参考';
  return 'HINT / 轻微参考';
}

export function resolveReferenceConstraintLanguage(input: Pick<
  ReferenceConstraintInput,
  'providerId' | 'providerName' | 'modelId'
>): ReferenceConstraintLanguage {
  const modelHint = input.modelId.toLowerCase();
  const providerHint = `${input.providerId || ''} ${input.providerName || ''}`.toLowerCase();

  if (CHINESE_MODEL_PATTERN.test(modelHint)) return 'zh';
  if (ENGLISH_MODEL_PATTERN.test(modelHint)) return 'en';
  if (CHINESE_PROVIDER_PATTERN.test(providerHint)) return 'zh';
  if (ENGLISH_PROVIDER_PATTERN.test(providerHint)) return 'en';
  return 'bilingual';
}

export function alignReferenceDescriptions(
  referenceImages: string[],
  referenceDescriptions: unknown,
): string[] {
  const descriptions = Array.isArray(referenceDescriptions) ? referenceDescriptions : [];
  return referenceImages.map((_, index) => {
    const value = descriptions[index];
    return typeof value === 'string' ? value.trim() : '';
  });
}

export function compileReferenceConstraints(
  input: ReferenceConstraintInput,
): ReferenceConstraintResult {
  const language = resolveReferenceConstraintLanguage(input);
  const descriptions = alignReferenceDescriptions(
    input.referenceImages,
    input.referenceDescriptions,
  );
  const categoryStrengths = getPerCategoryStrengths(input.referenceCategoryStrengths);
  const blocks: string[] = [];

  input.referenceImages.forEach((_, index) => {
    const categories = getCategoryArray(input.referenceCategories, index)
      .filter(isReferenceCategory);
    const categoryLines = categories
      .map((category) => {
        const strength = clampStrength(
          categoryStrengths?.[String(index)]?.[category] ?? getReferenceStrength(input.referenceStrengths, index),
        );
        if (strength <= 0) return '';

        const label = CATEGORY_LABELS[category];
        const detail = CATEGORY_DETAILS[category];
        if (language === 'zh') {
          return `- ${label.zh} ${strength}%：${strengthInstruction(language, strength)}参考图 #${index + 1} 的${detail.zh}。`;
        }
        if (language === 'en') {
          return `- ${label.en} ${strength}%: ${strengthInstruction(language, strength).toLowerCase()} the ${detail.en} from reference #${index + 1}.`;
        }
        return `- ${label.en} / ${label.zh} ${strength}%: ${strengthInstruction(language, strength)} the ${detail.en} / ${detail.zh}.`;
      })
      .filter(Boolean);

    if (categoryLines.length === 0) return;

    const description = descriptions[index];
    if (language === 'zh') {
      blocks.push([
        `[参考图 #${index + 1}]`,
        description ? `内容锚点：${description}` : '',
        ...categoryLines,
      ].filter(Boolean).join('\n'));
    } else if (language === 'en') {
      blocks.push([
        `[REFERENCE #${index + 1}]`,
        description ? `Content anchor: ${description}` : '',
        ...categoryLines,
      ].filter(Boolean).join('\n'));
    } else {
      blocks.push([
        `[REFERENCE #${index + 1} / 参考图 #${index + 1}]`,
        description ? `Content anchor / 内容锚点: ${description}` : '',
        ...categoryLines,
      ].filter(Boolean).join('\n'));
    }
  });

  if (blocks.length === 0) {
    return { language, prompt: '', hasActiveConstraints: false };
  }

  if (language === 'zh') {
    return {
      language,
      prompt: `${blocks.join('\n\n')}\n仅把每个编号下已选类别用于对应参考图；未选类别不构成约束。属性冲突时，优先级按显式强度从高到低，强度相同时由用户创意描述决定。`,
      hasActiveConstraints: true,
    };
  }
  if (language === 'en') {
    return {
      language,
      prompt: `${blocks.join('\n\n')}\nApply selected categories only to their matching numbered reference. Unselected categories are unconstrained. When attributes conflict, the highest explicit strength wins; ties are resolved by the user's creative prompt.`,
      hasActiveConstraints: true,
    };
  }
  return {
    language,
    prompt: `${blocks.join('\n\n')}\nApply each selected category only to its matching numbered reference / 每个已选类别仅作用于对应编号参考图。Highest explicit strength wins / 属性冲突时以最高显式强度为准。`,
    hasActiveConstraints: true,
  };
}
