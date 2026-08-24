'use client';

import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type {
  CapabilityLayer,
  ProviderCapabilityOverridesV1,
  SupportedOperation,
} from '@/lib/task-core/model-capability-contract';
import { serializeProviderCapabilityOverrides } from '@/lib/task-core/model-capability-resolution';
import type { ModelInfo } from '@/lib/universal-api-types';

export interface AdvancedParamEntry {
  key: string;
  value: string;
}

export interface ModelCapabilityEditorProps {
  models: ModelInfo[];
  value: ProviderCapabilityOverridesV1;
  onChange: (value: ProviderCapabilityOverridesV1) => void;
}

const IMAGE_RATIOS = ['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'];
const IMAGE_SIZES = ['1024x1024', '1K', '2K', '4K'];
const IMAGE_QUALITIES = ['standard', 'hd', 'low', 'medium', 'high'];
const IMAGE_OUTPUTS = ['png', 'jpg', 'webp'];
const VIDEO_DURATIONS = [3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 30];
const VIDEO_OPERATIONS: Array<{ value: SupportedOperation; label: string }> = [
  { value: 'text-to-video', label: '文生视频' },
  { value: 'image-to-video', label: '图生视频' },
  { value: 'first-last-frame', label: '首尾帧' },
  { value: 'multi-reference', label: '多参考图' },
  { value: 'video-extend', label: '视频延长' },
];

const VIDEO_OPERATION_LABELS = new Map(VIDEO_OPERATIONS.map(operation => [operation.value, operation.label]));

function asAdvancedParamRecord(
  params: Record<string, string> | readonly AdvancedParamEntry[] | undefined,
): Record<string, string> {
  const entries = Array.isArray(params)
    ? params.map(({ key, value }) => [key, value] as const)
    : Object.entries(params || {});
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    const normalizedKey = key.trim();
    if (!normalizedKey || normalizedKey === 'taskModelCapabilities') continue;
    result[normalizedKey] = String(value);
  }
  return result;
}

function uniqueOptions<T>(...groups: Array<readonly T[] | undefined>): T[] {
  return Array.from(new Set(groups.flatMap(group => group || [])));
}

function capabilityEditorModelType(providerType: string): ModelInfo['type'] {
  return providerType === 'video' ? 'video' : 'image';
}

export function buildCapabilityEditorModels(
  discoveredModels: ModelInfo[],
  selectedModels: string[],
  providerId: string,
  providerType: string,
): ModelInfo[] {
  const discoveredById = new Map(discoveredModels.map(model => [model.id, model]));
  return Array.from(new Set(selectedModels)).map(modelId => {
    const discovered = discoveredById.get(modelId);
    const type = discovered?.type === 'image' || discovered?.type === 'video'
      ? discovered.type
      : capabilityEditorModelType(providerType);
    return discovered
      ? { ...discovered, providerId, type }
      : { id: modelId, name: modelId, providerId, type };
  });
}

export function getVisibleAdvancedParams(
  params: Record<string, string> | readonly AdvancedParamEntry[] | undefined,
): Record<string, string> {
  return asAdvancedParamRecord(params);
}

export function mergeAdvancedParamsWithCapabilities(
  params: Record<string, string> | readonly AdvancedParamEntry[] | undefined,
  capabilities: ProviderCapabilityOverridesV1,
): Record<string, string> {
  return {
    ...asAdvancedParamRecord(params),
    taskModelCapabilities: serializeProviderCapabilityOverrides(capabilities),
  };
}

function updateArray<T>(items: T[] | undefined, value: T, checked: boolean): T[] {
  const current = items || [];
  return checked
    ? current.includes(value) ? current : [...current, value]
    : current.filter(item => item !== value);
}

function numericValue(value: string, minimum: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : undefined;
}

function CapabilityCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-foreground">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export function ModelCapabilityEditor({ models, value, onChange }: ModelCapabilityEditorProps) {
  const editableModels = useMemo(
    () => models.filter(model => model.type === 'image' || model.type === 'video'),
    [models],
  );
  const [selectedModelId, setSelectedModelId] = useState<string | null>(editableModels[0]?.id || null);
  const selectedModel = editableModels.find(model => model.id === selectedModelId) || editableModels[0];
  const selectedValue = selectedModel ? value.models[selectedModel.id] || {} : {};
  const isVideo = selectedModel?.type === 'video';
  const ratioOptions = uniqueOptions(
    IMAGE_RATIOS,
    selectedModel?.supportedAspectRatios,
    selectedValue.allowedRatios,
  );
  const sizeOptions = uniqueOptions(IMAGE_SIZES, selectedValue.allowedSizes);
  const qualityOptions = uniqueOptions(IMAGE_QUALITIES, selectedModel?.supportedQualities, selectedValue.qualityOptions);
  const outputOptions = uniqueOptions(IMAGE_OUTPUTS, selectedModel?.outputKinds, selectedValue.outputKinds);
  const durationOptions = uniqueOptions(
    VIDEO_DURATIONS,
    selectedModel?.allowedDurationsSeconds,
    selectedValue.allowedDurationsSeconds,
  );
  const operationOptions = uniqueOptions(
    VIDEO_OPERATIONS.map(operation => operation.value),
    selectedModel?.supportedOperations,
    selectedValue.supportedOperations,
  );

  useEffect(() => {
    if (!selectedModelId || !editableModels.some(model => model.id === selectedModelId)) {
      setSelectedModelId(editableModels[0]?.id || null);
    }
  }, [editableModels, selectedModelId]);

  const patchSelected = (patch: Partial<CapabilityLayer>) => {
    if (!selectedModel) return;
    onChange({
      version: 1,
      models: {
        ...value.models,
        [selectedModel.id]: { ...selectedValue, ...patch },
      },
    });
  };

  const removeSelected = () => {
    if (!selectedModel) return;
    const modelsWithoutSelected = { ...value.models };
    delete modelsWithoutSelected[selectedModel.id];
    onChange({ version: 1, models: modelsWithoutSelected });
  };

  if (editableModels.length === 0) return null;

  const toggleStrings = (
    field: 'allowedRatios' | 'allowedSizes' | 'qualityOptions' | 'outputKinds' | 'supportedOperations',
    item: string,
    checked: boolean,
  ) => patchSelected({ [field]: updateArray(selectedValue[field] as string[] | undefined, item, checked) });

  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="模型能力配置">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">模型能力配置</h4>
          <p className="text-xs text-muted-foreground">只保存已选择模型的明确覆盖。</p>
        </div>
        {selectedModel && value.models[selectedModel.id] && (
          <button
            type="button"
            onClick={removeSelected}
            aria-label={`删除 ${selectedModel.name} 的能力配置`}
            title="删除此模型能力配置"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="list" aria-label="选择模型">
        {editableModels.map(model => (
          <button
            key={model.id}
            type="button"
            onClick={() => setSelectedModelId(model.id)}
            className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
              selectedModel?.id === model.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            {model.name}
          </button>
        ))}
      </div>

      {isVideo ? (
        <div className="space-y-3">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-foreground">画面比例</legend>
            <div className="flex flex-wrap gap-1.5">
              {ratioOptions.map(ratio => <CapabilityCheckbox key={ratio} label={ratio} checked={selectedValue.allowedRatios?.includes(ratio) || false} onChange={checked => toggleStrings('allowedRatios', ratio, checked)} />)}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-foreground">分辨率</legend>
            <div className="flex flex-wrap gap-1.5">
              {sizeOptions.map(size => <CapabilityCheckbox key={size} label={size} checked={selectedValue.allowedSizes?.includes(size) || false} onChange={checked => toggleStrings('allowedSizes', size, checked)} />)}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-foreground">离散时长（秒）</legend>
            <div className="flex flex-wrap gap-1.5">
              {durationOptions.map(duration => <CapabilityCheckbox key={duration} label={`${duration}`} checked={selectedValue.allowedDurationsSeconds?.includes(duration) || false} onChange={checked => patchSelected({ allowedDurationsSeconds: updateArray(selectedValue.allowedDurationsSeconds, duration, checked) })} />)}
            </div>
          </fieldset>
          <label className="block text-xs font-medium text-foreground">最大时长（秒）
            <input type="number" min="1" value={selectedValue.maxDurationSeconds || ''} onChange={event => patchSelected({ maxDurationSeconds: numericValue(event.target.value, 1) })} className="mt-1 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm" />
          </label>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-foreground">操作模式</legend>
            <div className="flex flex-wrap gap-1.5">
              {operationOptions.map(operation => <CapabilityCheckbox key={operation} label={VIDEO_OPERATION_LABELS.get(operation) || operation} checked={selectedValue.supportedOperations?.includes(operation) || false} onChange={checked => toggleStrings('supportedOperations', operation, checked)} />)}
            </div>
          </fieldset>
        </div>
      ) : (
        <div className="space-y-3">
          <fieldset className="space-y-1.5"><legend className="text-xs font-medium text-foreground">画面比例</legend><div className="flex flex-wrap gap-1.5">{ratioOptions.map(ratio => <CapabilityCheckbox key={ratio} label={ratio} checked={selectedValue.allowedRatios?.includes(ratio) || false} onChange={checked => toggleStrings('allowedRatios', ratio, checked)} />)}</div></fieldset>
          <fieldset className="space-y-1.5"><legend className="text-xs font-medium text-foreground">尺寸</legend><div className="flex flex-wrap gap-1.5">{sizeOptions.map(size => <CapabilityCheckbox key={size} label={size} checked={selectedValue.allowedSizes?.includes(size) || false} onChange={checked => toggleStrings('allowedSizes', size, checked)} />)}</div></fieldset>
          <fieldset className="space-y-1.5"><legend className="text-xs font-medium text-foreground">质量</legend><div className="flex flex-wrap gap-1.5">{qualityOptions.map(quality => <CapabilityCheckbox key={quality} label={quality} checked={selectedValue.qualityOptions?.includes(quality) || false} onChange={checked => toggleStrings('qualityOptions', quality, checked)} />)}</div></fieldset>
          <label className="block text-xs font-medium text-foreground">最大生成数量<input aria-label="最大生成数量" type="number" min="1" max="4" value={selectedValue.maxOutputs || ''} onChange={event => patchSelected({ maxOutputs: numericValue(event.target.value, 1) })} className="mt-1 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm" /></label>
          <div className="flex flex-wrap gap-3"><CapabilityCheckbox label="支持参考图" checked={selectedValue.supportsReferenceImages || false} onChange={checked => patchSelected({ supportsReferenceImages: checked })} /><CapabilityCheckbox label="支持蒙版" checked={selectedValue.supportsMask || false} onChange={checked => patchSelected({ supportsMask: checked })} /></div>
          <label className="block text-xs font-medium text-foreground">最大参考图数量<input type="number" min="0" max="16" value={selectedValue.maxReferenceImages ?? ''} onChange={event => patchSelected({ maxReferenceImages: numericValue(event.target.value, 0) })} className="mt-1 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm" /></label>
          <fieldset className="space-y-1.5"><legend className="text-xs font-medium text-foreground">输出格式</legend><div className="flex flex-wrap gap-1.5">{outputOptions.map(format => <CapabilityCheckbox key={format} label={format} checked={selectedValue.outputKinds?.includes(format) || false} onChange={checked => toggleStrings('outputKinds', format, checked)} />)}</div></fieldset>
        </div>
      )}
    </section>
  );
}
