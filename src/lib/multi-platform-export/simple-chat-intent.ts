import type { MultiPlatformExportInput, PlatformExportPreset } from './types';

export type ExportIntentMissingField = 'sources' | 'targets';

interface ParsedExportValues {
  fit: MultiPlatformExportInput['fit'];
  background: MultiPlatformExportInput['background'];
  namingTemplate: string;
  targetPresetIds: string[];
}

export type ExportIntentResult =
  | { kind: 'none' }
  | (ParsedExportValues & {
      kind: 'needs_clarification';
      missing: ExportIntentMissingField[];
      question: string;
    })
  | (ParsedExportValues & { kind: 'ready' });

const DEFAULT_NAMING_TEMPLATE = '{project}-{asset}-{platform}-{size}-{index}';
const CLARIFICATION_QUESTIONS = new Set([
  '请先附加要导出的受管图片，并指定目标平台或尺寸。',
  '请先附加要导出的受管图片。',
  '请指定目标平台或尺寸。',
]);
const SOURCE_PATTERN = /(?:这些|这一批|全部|所有|附件|已上传|上面).{0,8}(?:图片|图)|这(?:两|三|四|五|六|七|八|九|十|\d+)张(?:图片|图)/u;
const BATCH_PATTERN = /批量|多张|这一批|这些|全部|所有|这(?:两|三|四|五|六|七|八|九|十|\d+)张/u;
const EXPORT_PATTERN = /导出|打包/u;
const TARGET_PATTERN = /平台|尺寸|规格/u;

const USAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  post: ['post', '帖子', '贴文'],
  story: ['story', 'stories', '故事', '快拍', '限时动态'],
  note: ['note', '笔记'],
  cover: ['cover', '封面'],
  thumbnail: ['thumbnail', '缩略图'],
  pin: ['pin', '图钉'],
};

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function includesAny(message: string, values: readonly string[]): boolean {
  return values.some(value => value && message.includes(normalized(value)));
}

function presetReference(preset: PlatformExportPreset): string {
  return `${preset.id}-v${preset.version}`;
}

function resolveTargets(message: string, presets: readonly PlatformExportPreset[]): string[] {
  const enabled = presets.filter(preset => preset.enabled);
  const matched = enabled.filter(preset => {
    if (message.includes(normalized(preset.label))) return true;
    const platformMentioned = includesAny(message, [preset.platform]);
    const usageAliases = USAGE_ALIASES[normalized(preset.usage)] ?? [preset.usage];
    return platformMentioned && includesAny(message, usageAliases);
  });

  const matchedIds = new Set(matched.map(preset => presetReference(preset)));
  for (const platform of new Set(enabled.map(preset => preset.platform))) {
    const platformPresets = enabled.filter(preset => preset.platform === platform);
    if (!message.includes(normalized(platform)) || platformPresets.some(preset => matchedIds.has(presetReference(preset)))) {
      continue;
    }
    for (const preset of platformPresets) matchedIds.add(presetReference(preset));
  }
  return enabled.map(preset => presetReference(preset)).filter(reference => matchedIds.has(reference));
}

function clarificationQuestion(missing: readonly ExportIntentMissingField[]): string {
  if (missing.length === 2) return '请先附加要导出的受管图片，并指定目标平台或尺寸。';
  if (missing[0] === 'sources') return '请先附加要导出的受管图片。';
  return '请指定目标平台或尺寸。';
}

export function isSimpleChatExportClarification(content: string): boolean {
  return CLARIFICATION_QUESTIONS.has(content.trim());
}

interface SimpleChatExportContextMessage {
  role: string;
  content: string;
  retryContext?: {
    sourceVersionIds?: readonly string[];
    canvasProjectId?: string;
  };
}

export function resolveSimpleChatExportRequestContext(input: {
  messages: readonly SimpleChatExportContextMessage[];
  currentSourceVersionIds: readonly string[];
  currentAssetProjectId: string;
}): { sourceVersionIds: string[]; assetProjectId: string } {
  const currentSourceVersionIds = [...new Set(input.currentSourceVersionIds.filter(Boolean))];
  if (currentSourceVersionIds.length > 0) {
    return {
      sourceVersionIds: currentSourceVersionIds,
      assetProjectId: input.currentAssetProjectId,
    };
  }
  const previous = input.messages.at(-1);
  if (previous?.role !== 'assistant' || !isSimpleChatExportClarification(previous.content)) {
    return { sourceVersionIds: [], assetProjectId: input.currentAssetProjectId };
  }
  return {
    sourceVersionIds: [...new Set((previous.retryContext?.sourceVersionIds || []).filter(Boolean))],
    assetProjectId: previous.retryContext?.canvasProjectId || input.currentAssetProjectId,
  };
}

export function parseSimpleChatExportIntent(
  message: string,
  presets: readonly PlatformExportPreset[],
): ExportIntentResult {
  const text = normalized(message.trim());
  if (!BATCH_PATTERN.test(text) || !TARGET_PATTERN.test(text) || !EXPORT_PATTERN.test(text)) {
    return { kind: 'none' };
  }

  const targetPresetIds = resolveTargets(text, presets);
  const missing: ExportIntentMissingField[] = [];
  if (!SOURCE_PATTERN.test(text)) missing.push('sources');
  if (targetPresetIds.length === 0) missing.push('targets');
  const values: ParsedExportValues = {
    fit: /完整|留白|不裁切|contain/u.test(text) ? 'contain' : 'cover',
    background: /透明/u.test(text) ? 'transparent' : '#ffffffff',
    namingTemplate: DEFAULT_NAMING_TEMPLATE,
    targetPresetIds,
  };
  return missing.length > 0
    ? { kind: 'needs_clarification', missing, question: clarificationQuestion(missing), ...values }
    : { kind: 'ready', ...values };
}
