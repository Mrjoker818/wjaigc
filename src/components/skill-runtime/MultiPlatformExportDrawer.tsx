'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare, Crop, FileArchive, FolderInput, Image as ImageIcon,
  Maximize2, PackageCheck, Play, Square, X,
} from 'lucide-react';

import { MultiPlatformExportResults } from './MultiPlatformExportResults';
import { SkillRunHistory, type SkillRunHistoryItem } from './SkillRunHistory';
import type { AgentRunProjection } from '@/lib/agent-runtime/types';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { ExportManifestFile, MultiPlatformExportResultV1 } from '@/lib/multi-platform-export/manifest';
import type { PlatformExportPreset } from '@/lib/multi-platform-export/types';
import type { SkillRunCostEstimate } from '@/lib/skill-runtime/cost-estimator';
import {
  downloadExportArtifact,
  downloadExportGroup,
  loadEnabledPlatformExportPresets,
  loadExportManifestFiles,
  parseMultiPlatformExportResult,
  previewMultiPlatformExportPlan,
  resolveExportImageReferences,
} from '@/lib/skill-runtime/multi-platform-export-client';

interface MultiPlatformExportDrawerProps {
  open: boolean;
  projectId: string;
  accountKey?: string;
  activeRunId?: string;
  historyRefreshKey?: string;
  sourceAssetVersionIds: readonly string[];
  values: Record<string, unknown>;
  estimate?: MultiPlatformExportEstimate;
  projection?: AgentRunProjection;
  busy?: boolean;
  error?: string;
  onChange: (key: string, value: unknown) => void;
  onEstimate: () => MultiPlatformExportEstimate | undefined | Promise<MultiPlatformExportEstimate | undefined>;
  onStart: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onRetry?: (stepId: string) => void | Promise<void>;
  onAddToCanvas?: (references: WorkspaceAssetReference[]) => void | Promise<void>;
  onRestoreRun?: (run: SkillRunHistoryItem) => void | Promise<void>;
  onLocateSource?: (sourceVersionId: string) => void;
  onClose: () => void;
  fetcher?: typeof fetch;
}

const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'timeout']);

interface ServerExportPlanEstimate {
  fileCount: number;
  totalPixels: number;
  estimatedZipBytes: number;
}

type MultiPlatformExportEstimate = SkillRunCostEstimate & {
  exportPlan?: ServerExportPlanEstimate;
};

function serverExportPlan(estimate: MultiPlatformExportEstimate | undefined): ServerExportPlanEstimate | undefined {
  const plan = estimate?.exportPlan;
  if (!plan) return undefined;
  return Number.isSafeInteger(plan.fileCount) && plan.fileCount >= 0
    && Number.isSafeInteger(plan.totalPixels) && plan.totalPixels >= 0
    && Number.isSafeInteger(plan.estimatedZipBytes) && plan.estimatedZipBytes >= 0
    ? plan
    : undefined;
}
const sectionClass = 'min-w-0 rounded-lg border border-border/70 bg-background/65 p-3';
const touchClass = 'min-h-10 min-w-10 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </h3>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  return `${(bytes / 1_048_576).toFixed(bytes >= 10_485_760 ? 0 : 1)} MB`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function MultiPlatformExportDrawer({
  open,
  projectId,
  accountKey = '',
  activeRunId,
  historyRefreshKey,
  sourceAssetVersionIds,
  values,
  estimate,
  projection,
  busy = false,
  error,
  onChange,
  onEstimate,
  onStart,
  onCancel,
  onRetry,
  onAddToCanvas,
  onRestoreRun,
  onLocateSource,
  onClose,
  fetcher = fetch,
}: MultiPlatformExportDrawerProps): React.ReactElement | null {
  const [presets, setPresets] = useState<PlatformExportPreset[]>([]);
  const [presetError, setPresetError] = useState<string>();
  const [references, setReferences] = useState<WorkspaceAssetReference[]>([]);
  const [manifestFiles, setManifestFiles] = useState<ExportManifestFile[]>([]);
  const [resultError, setResultError] = useState<string>();
  const [showRunLog, setShowRunLog] = useState(false);
  const [estimateState, setEstimateState] = useState<'idle' | 'checking' | 'success' | 'partial' | 'failed'>(
    estimate ? (serverExportPlan(estimate) ? 'success' : 'partial') : 'idle',
  );
  const validatedExportPlan = serverExportPlan(estimate);

  useEffect(() => {
    if (estimate) setEstimateState(serverExportPlan(estimate) ? 'success' : 'partial');
  }, [estimate]);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setPresetError(undefined);
    void loadEnabledPlatformExportPresets(fetcher, controller.signal)
      .then(setPresets)
      .catch(caught => {
        if (!controller.signal.aborted) setPresetError(caught instanceof Error ? caught.message : '平台预设加载失败');
      });
    return () => controller.abort();
  }, [fetcher, open]);

  const parsedResult = useMemo<{ result?: MultiPlatformExportResultV1; error?: string }>(() => {
    const outputs = projection?.result?.outputs;
    if (!outputs) {
      return terminalStatuses.has(projection?.status || '')
        ? { error: '结果数据损坏或版本不兼容' }
        : {};
    }
    try {
      return { result: parseMultiPlatformExportResult(outputs) };
    } catch {
      return terminalStatuses.has(projection?.status || '')
        ? { error: '结果数据损坏或版本不兼容' }
        : {};
    }
  }, [projection?.result?.outputs, projection?.status]);
  const result = parsedResult.result;

  useEffect(() => {
    if (!open || !result) {
      setReferences([]);
      setManifestFiles([]);
      setResultError(undefined);
      return undefined;
    }
    const controller = new AbortController();
    setResultError(undefined);
    void Promise.allSettled([
      resolveExportImageReferences({
        projectId,
        versionIds: result.imageAssetVersionIds,
        fetcher,
        signal: controller.signal,
      }),
      loadExportManifestFiles(result, projectId, fetcher, controller.signal),
    ]).then(([referenceResult, manifestResult]) => {
      if (controller.signal.aborted) return;
      if (referenceResult.status === 'fulfilled') setReferences(referenceResult.value);
      else setReferences([]);
      if (manifestResult.status === 'fulfilled') setManifestFiles(manifestResult.value);
      else setManifestFiles([]);
      const failure = referenceResult.status === 'rejected'
        ? referenceResult.reason
        : manifestResult.status === 'rejected' ? manifestResult.reason : undefined;
      if (failure) setResultError(failure instanceof Error ? failure.message : '导出结果加载失败');
    });
    return () => controller.abort();
  }, [fetcher, open, projectId, result]);

  if (!open) return null;

  const selectedPresetIds = stringArray(values.targetPresetIds);
  const selectedPresets = presets.filter(preset => selectedPresetIds.includes(`${preset.id}-v${preset.version}`));
  const preview = previewMultiPlatformExportPlan(sourceAssetVersionIds.length, selectedPresets);
  const fit = values.fit === 'contain' ? 'contain' : 'cover';
  const background = typeof values.background === 'string' ? values.background : '#ffffffff';
  const namingTemplate = typeof values.namingTemplate === 'string'
    ? values.namingTemplate
    : '{project}-{asset}-{platform}-{size}-{index}';
  const running = Boolean(projection && !terminalStatuses.has(projection.status));
  const canStart = sourceAssetVersionIds.length > 0 && selectedPresets.length > 0 && !running && !busy;

  const togglePreset = (reference: string): void => {
    const next = selectedPresetIds.includes(reference)
      ? selectedPresetIds.filter(id => id !== reference)
      : [...selectedPresetIds, reference];
    onChange('targetPresetIds', next);
  };

  const validatePlan = async (): Promise<void> => {
    setEstimateState('checking');
    try {
      const nextEstimate = await onEstimate();
      setEstimateState(nextEstimate ? (serverExportPlan(nextEstimate) ? 'success' : 'partial') : 'failed');
    } catch {
      setEstimateState('failed');
    }
  };

  return (
    <section
      data-testid="multi-platform-export-drawer"
      data-bottom-toolbar-drawer
      aria-label="多平台批量导出工具"
      style={{ bottom: 'var(--canvas-bottom-toolbar-offset)' }}
      className="fixed left-1/2 z-[90] flex max-h-[min(72vh,720px)] w-[min(960px,calc(100vw-16px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background/95 text-foreground shadow-2xl backdrop-blur-md"
    >
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <PackageCheck className="shrink-0 text-primary" aria-hidden="true" size={18} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">多平台批量导出</h2>
            <p className="truncate text-[11px] text-muted-foreground">确定性 CPU 适配，不调用模型</p>
          </div>
        </div>
        <button type="button" aria-label="关闭多平台批量导出" className={touchClass} onClick={onClose}>
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="overflow-y-auto overscroll-contain p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <section className={sectionClass}>
            <SectionHeading icon={<FolderInput aria-hidden="true" size={15} />}>素材</SectionHeading>
            <p className="break-words text-xs text-muted-foreground">
              {sourceAssetVersionIds.length > 0
                ? `已选择 ${sourceAssetVersionIds.length} 张受管图片`
                : '请在当前项目画布选择至少一张已保存图片'}
            </p>
          </section>

          <section className={sectionClass}>
            <SectionHeading icon={<CheckSquare aria-hidden="true" size={15} />}>目标平台</SectionHeading>
            {presetError && <div role="alert" className="break-words text-xs text-destructive">{presetError}</div>}
            {!presetError && presets.length === 0 && <p className="text-xs text-muted-foreground">暂无可用平台预设</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {presets.map(preset => {
                const reference = `${preset.id}-v${preset.version}`;
                return (
                  <label key={reference} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-xs hover:bg-accent">
                    <input
                      type="checkbox"
                      aria-label={preset.label}
                      checked={selectedPresetIds.includes(reference)}
                      onChange={() => togglePreset(reference)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{preset.label}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{preset.width} x {preset.height} · {preset.recommendedFormat.toUpperCase()}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className={sectionClass}>
            <SectionHeading icon={<Crop aria-hidden="true" size={15} />}>适配方式</SectionHeading>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="适配方式">
              <button type="button" aria-pressed={fit === 'cover'} className={`${touchClass} ${fit === 'cover' ? 'border-primary bg-primary/10 text-primary' : ''}`} onClick={() => onChange('fit', 'cover')}>
                <Crop className="mx-auto mb-1" aria-hidden="true" size={15} />
                裁切填充
              </button>
              <button type="button" aria-pressed={fit === 'contain'} className={`${touchClass} ${fit === 'contain' ? 'border-primary bg-primary/10 text-primary' : ''}`} onClick={() => onChange('fit', 'contain')}>
                <Maximize2 className="mx-auto mb-1" aria-hidden="true" size={15} />
                完整留白
              </button>
            </div>
            <div className="mt-3 flex min-h-10 items-center gap-2 text-xs">
              <span className="shrink-0">背景</span>
              <label className="flex min-h-10 items-center">
                <span className="sr-only">背景颜色</span>
                <input
                  aria-label="背景颜色"
                  type="color"
                  value={/^#[0-9a-f]{8}$/iu.test(background) ? background.slice(0, 7) : '#ffffff'}
                  disabled={background === 'transparent'}
                  className="h-10 w-12 rounded-lg border border-border bg-transparent p-1"
                  onChange={event => onChange('background', `${event.target.value}ff`)}
                />
              </label>
              <label className="flex min-h-10 min-w-0 items-center gap-2">
                <input type="checkbox" checked={background === 'transparent'} onChange={event => onChange('background', event.target.checked ? 'transparent' : '#ffffffff')} />
                <span className="truncate">透明背景</span>
              </label>
            </div>
          </section>

          <section className={sectionClass}>
            <SectionHeading icon={<ImageIcon aria-hidden="true" size={15} />}>命名</SectionHeading>
            <label className="block text-xs">
              <span className="sr-only">命名模板</span>
              <input
                aria-label="命名模板"
                value={namingTemplate}
                maxLength={160}
                onChange={event => onChange('namingTemplate', event.target.value)}
                className="min-h-10 w-full rounded-lg border border-border bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <p className="mt-2 break-words text-[10px] text-muted-foreground">支持 project、asset、platform、usage、size、index 变量</p>
          </section>

          <section className={sectionClass}>
            <SectionHeading icon={<FileArchive aria-hidden="true" size={15} />}>执行预览</SectionHeading>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div><dt className="text-muted-foreground">文件 · 本地预估</dt><dd>{preview.fileCount} 个文件</dd></div>
              <div><dt className="text-muted-foreground">积分</dt><dd>{estimate ? `服务端 ${estimate.minimum}-${estimate.maximum}` : '积分 0'}</dd></div>
              <div><dt className="text-muted-foreground">总像素 · 本地预估</dt><dd>{preview.totalPixels.toLocaleString('zh-CN')} 像素</dd></div>
              <div><dt className="text-muted-foreground">压缩包 · 本地预估</dt><dd>预计 ZIP {formatBytes(preview.estimatedZipBytes)}</dd></div>
            </dl>
            {validatedExportPlan && (
              <dl aria-label="服务端导出计划" className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-emerald-500 sm:grid-cols-3">
                <div><dt className="sr-only">服务端文件数</dt><dd>服务端 {validatedExportPlan.fileCount} 个文件</dd></div>
                <div><dt className="sr-only">服务端总像素</dt><dd>服务端 {validatedExportPlan.totalPixels.toLocaleString('zh-CN')} 像素</dd></div>
                <div><dt className="sr-only">服务端压缩包估计</dt><dd>服务端 ZIP {formatBytes(validatedExportPlan.estimatedZipBytes)}</dd></div>
              </dl>
            )}
            <p className={`mt-2 text-[11px] ${estimateState === 'success' ? 'text-emerald-500' : estimateState === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
              {estimateState === 'success' ? '服务端校验成功' : estimateState === 'partial' ? '积分已校验，导出计划尚未校验' : estimateState === 'failed' ? '服务端校验失败' : estimateState === 'checking' ? '正在请求服务端校验' : '尚未校验'}
            </p>
            {projection && (
              <div className="mt-3 space-y-1" aria-live="polite">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{projection.status === 'failed' && result?.outcome === 'partial_success' ? '部分成功' : '服务端进度'}</span>
                  <span>{Math.round(projection.progress ?? 0)}%</span>
                </div>
                <progress className="h-2 w-full" max={100} value={Math.max(0, Math.min(100, projection.progress ?? 0))} aria-label="导出进度" />
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={touchClass} disabled={!canStart || estimateState === 'checking'} onClick={() => { void validatePlan(); }}>
                <Square aria-hidden="true" size={14} />
                校验计划
              </button>
              <button type="button" className={`${touchClass} border-primary bg-primary text-primary-foreground hover:bg-primary/90`} disabled={!canStart} onClick={() => { void onStart(); }}>
                <Play aria-hidden="true" size={14} />
                开始导出
              </button>
              {running && onCancel && (
                <button type="button" className={touchClass} disabled={busy} onClick={() => { void onCancel(); }}>
                  <X aria-hidden="true" size={14} />
                  取消任务
                </button>
              )}
            </div>
            {error && <div role="alert" className="mt-2 break-words text-xs text-destructive">{error}</div>}
          </section>

          <section className={sectionClass}>
            <SectionHeading icon={<PackageCheck aria-hidden="true" size={15} />}>结果</SectionHeading>
            {!result && <p className="text-xs text-muted-foreground">完成后可逐张下载、下载 ZIP 或放入画布。</p>}
            {parsedResult.error && (
              <div className="space-y-2">
                <div role="alert" className="break-words text-xs text-destructive">{parsedResult.error}</div>
                <div className="flex flex-wrap gap-2">
                  {onRetry && <button type="button" className={touchClass} onClick={() => {
                    void Promise.resolve(onRetry('export')).catch(caught => {
                      setResultError(caught instanceof Error ? caught.message : '重试失败');
                    });
                  }}>重试导出</button>}
                  <button type="button" className={touchClass} onClick={() => setShowRunLog(current => !current)}>查看运行日志</button>
                </div>
                {showRunLog && <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-[10px] text-muted-foreground">{JSON.stringify({ status: projection?.status, plan: projection?.plan, error: projection?.error }, null, 2)}</pre>}
              </div>
            )}
            {resultError && <div role="alert" className="break-words text-xs text-destructive">{resultError}</div>}
            {result && (
              <MultiPlatformExportResults
                projectId={projectId}
                result={result}
                references={references}
                files={manifestFiles}
                busy={busy}
                onDownload={versionId => downloadExportArtifact(versionId, projectId, fetcher)}
                onDownloadGroup={(items, platform, onProgress) => downloadExportGroup({
                  projectId, platform, references: items, files: manifestFiles, fetcher, onProgress,
                })}
                onAddToCanvas={items => onAddToCanvas?.(items)}
                onRetry={onRetry ? () => onRetry('export') : undefined}
                onLocateSource={onLocateSource}
              />
            )}
            {onRestoreRun && (
              <SkillRunHistory
                projectId={projectId}
                surface="canvas"
                skillId="preset-multi-platform-export"
                accountKey={accountKey}
                activeRunId={activeRunId}
                refreshKey={historyRefreshKey}
                busy={busy}
                onSelect={run => {
                  void Promise.resolve(onRestoreRun(run)).catch(caught => {
                    setResultError(caught instanceof Error ? caught.message : '运行记录恢复失败');
                  });
                }}
                fetcher={fetcher}
              />
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
