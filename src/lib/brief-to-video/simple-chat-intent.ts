import { BRIEF_TO_VIDEO_SKILL_ID } from '@/lib/skill-runtime/brief-to-video-preset';

export type BriefVideoIntentMissingField =
  | 'attachments'
  | 'brief'
  | 'platform'
  | 'durationSeconds'
  | 'aspectRatio'
  | 'videoModel';

export interface SimpleChatBriefVideoAttachment {
  url?: string;
  assetVersionId?: string;
  placementId?: string;
}

export interface SimpleChatBriefVideoCapability {
  providerId: string;
  modelId: string;
  allowedDurationsSeconds?: readonly number[];
  allowedRatios: readonly string[];
  allowedSizes: readonly string[];
  supportedOperations?: readonly string[];
}

interface BriefVideoInputValues extends Record<string, unknown> {
  brief: string;
  goal: '品牌认知' | '产品转化' | '活动传播' | '内容叙事';
  audience: string;
  platform: '通用' | '抖音' | '小红书' | 'B站' | 'YouTube' | 'Instagram';
  style: string;
  durationSeconds: number;
  aspectRatio: string;
  generateAudio: false;
  startFrame?: string;
  endFrame?: string;
  resolution?: string;
}

export type SimpleChatBriefVideoIntentResult =
  | { kind: 'none' }
  | {
      kind: 'needs_clarification';
      missing: BriefVideoIntentMissingField[];
      question: string;
    }
  | {
      kind: 'ready';
      skillId: typeof BRIEF_TO_VIDEO_SKILL_ID;
      skillVersion: 1;
      inputValues: BriefVideoInputValues;
      sourceVersionIds: string[];
      modelBinding: { providerId: string; modelId: string };
    };

const PLATFORMS = ['小红书', 'Instagram', 'YouTube', '抖音', 'B站', '通用'] as const;
const GOALS = ['品牌认知', '产品转化', '活动传播', '内容叙事'] as const;
const CLARIFICATION_QUESTIONS: Readonly<Record<BriefVideoIntentMissingField, string>> = {
  attachments: '请重新附加受管素材。',
  brief: '请提供具体 Brief 或脚本内容。',
  platform: '请指定发布平台。',
  durationSeconds: '请指定视频时长。',
  aspectRatio: '请指定画面比例。',
  videoModel: '请指定要使用的视频模型。',
};

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function explicitIntent(message: string): boolean {
  return /brief|脚本/iu.test(message)
    && /视频|成片/u.test(message)
    && /生成|制作|产出/u.test(message);
}

function extractBrief(message: string): string {
  const match = message.match(/(?:brief|脚本)\s*[：:]\s*(.+?)(?=(?:[，,。；;\n]\s*(?:平台|时长|比例|视频模型|模型|受众|目标)\s*[：:])|(?:[，,。；;\n]\s*(?:生成|制作|产出).*(?:视频|成片))|$)/iu);
  return match?.[1]?.trim() || '';
}

function extractLabeledValue(message: string, label: string): string {
  const match = message.match(new RegExp(`${label}\\s*[：:]\\s*([^，,。；;\\n]+)`, 'iu'));
  return match?.[1]?.trim() || '';
}

function findCapability(
  message: string,
  capabilities: readonly SimpleChatBriefVideoCapability[],
): SimpleChatBriefVideoCapability | undefined {
  const text = normalize(message);
  const matches = capabilities.filter(capability => (
    text.includes(normalize(capability.modelId))
    || text.includes(normalize(`${capability.providerId}/${capability.modelId}`))
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

function supportsSourceCount(
  capability: SimpleChatBriefVideoCapability,
  sourceCount: number,
): boolean {
  const operation = sourceCount === 0
    ? 'text-to-video'
    : sourceCount === 1 ? 'image-to-video' : 'first-last-frame';
  return capability.supportedOperations?.includes(operation) ?? sourceCount === 0;
}

export function isSimpleChatBriefVideoClarification(content: string): boolean {
  return Object.values(CLARIFICATION_QUESTIONS).includes(content.trim());
}

interface SimpleChatBriefVideoContextMessage {
  role: string;
  content: string;
  retryContext?: {
    sourceVersionIds?: readonly string[];
    selectedEntityIds?: readonly string[];
    canvasProjectId?: string;
    exportSourceMessageId?: string;
    userMessageId?: string;
  };
}

export function resolveSimpleChatBriefVideoRequestContext(input: {
  messages: readonly SimpleChatBriefVideoContextMessage[];
  currentSourceVersionIds: readonly string[];
  currentSelectedEntityIds: readonly string[];
  currentSourceMessageId: string;
  currentAssetProjectId: string;
}): { sourceVersionIds: string[]; selectedEntityIds: string[]; sourceMessageId: string; assetProjectId: string } {
  const current = [...new Set(input.currentSourceVersionIds.filter(Boolean))];
  if (current.length > 0) {
    return {
      sourceVersionIds: current,
      selectedEntityIds: [...new Set(input.currentSelectedEntityIds.filter(Boolean))],
      sourceMessageId: input.currentSourceMessageId,
      assetProjectId: input.currentAssetProjectId,
    };
  }
  const previous = input.messages.at(-1);
  if (previous?.role !== 'assistant' || !isSimpleChatBriefVideoClarification(previous.content)) {
    return {
      sourceVersionIds: [], selectedEntityIds: [], sourceMessageId: input.currentSourceMessageId,
      assetProjectId: input.currentAssetProjectId,
    };
  }
  return {
    sourceVersionIds: [...new Set((previous.retryContext?.sourceVersionIds || []).filter(Boolean))],
    selectedEntityIds: [...new Set((previous.retryContext?.selectedEntityIds || []).filter(Boolean))],
    sourceMessageId: previous.retryContext?.exportSourceMessageId
      || previous.retryContext?.userMessageId
      || input.currentSourceMessageId,
    assetProjectId: previous.retryContext?.canvasProjectId || input.currentAssetProjectId,
  };
}

export function parseSimpleChatBriefVideoIntent(
  message: string,
  attachments: readonly SimpleChatBriefVideoAttachment[],
  capabilities: readonly SimpleChatBriefVideoCapability[],
): SimpleChatBriefVideoIntentResult {
  if (!explicitIntent(message)) return { kind: 'none' };

  const invalidAttachments = attachments.length > 2 || attachments.some(attachment => (
    !attachment.assetVersionId || !attachment.placementId
  ));
  const sourceVersionIds = invalidAttachments
    ? []
    : [...new Set(attachments.map(attachment => attachment.assetVersionId!).filter(Boolean))];
  const brief = extractBrief(message);
  const platform = PLATFORMS.find(value => new RegExp(`(?:平台\\s*[：:]\\s*)?${value}`, 'iu').test(message));
  const duration = Number(message.match(/(?:时长\s*[：:]\s*)?(\d{1,3})\s*秒/u)?.[1] || 0);
  const ratioMatch = message.match(/(?:比例\s*[：:]\s*)?(\d{1,2})\s*[：:]\s*(\d{1,2})/u);
  const aspectRatio = ratioMatch ? `${Number(ratioMatch[1])}:${Number(ratioMatch[2])}` : '';
  const capability = findCapability(message, capabilities);
  const missing: BriefVideoIntentMissingField[] = [];
  if (invalidAttachments) missing.push('attachments');
  if (!brief) missing.push('brief');
  if (!platform) missing.push('platform');
  if (!duration || (capability && !capability.allowedDurationsSeconds?.includes(duration))) {
    missing.push('durationSeconds');
  }
  if (!aspectRatio || (capability && !capability.allowedRatios.includes(aspectRatio))) {
    missing.push('aspectRatio');
  }
  if (!capability || !supportsSourceCount(capability, sourceVersionIds.length)) missing.push('videoModel');
  if (missing.length > 0) {
    return { kind: 'needs_clarification', missing, question: CLARIFICATION_QUESTIONS[missing[0]] };
  }
  if (!brief || !platform || !duration || !aspectRatio || !capability) {
    throw new Error('Brief video intent validation did not narrow required values');
  }

  const resolution = capability.allowedSizes.find(value => normalize(message).includes(normalize(value)));
  const goal = GOALS.find(value => message.includes(value)) || '内容叙事';
  const audience = extractLabeledValue(message, '受众') || '通用受众';
  return {
    kind: 'ready',
    skillId: BRIEF_TO_VIDEO_SKILL_ID,
    skillVersion: 1,
    sourceVersionIds,
    modelBinding: { providerId: capability.providerId, modelId: capability.modelId },
    inputValues: {
      brief,
      goal,
      audience,
      platform,
      style: '电影感、主体清晰、运动自然',
      durationSeconds: duration,
      aspectRatio,
      generateAudio: false,
      ...(sourceVersionIds[0] ? { startFrame: sourceVersionIds[0] } : {}),
      ...(sourceVersionIds[1] ? { endFrame: sourceVersionIds[1] } : {}),
      ...(resolution ? { resolution } : {}),
    },
  };
}
