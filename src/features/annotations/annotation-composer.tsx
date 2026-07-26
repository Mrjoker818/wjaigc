'use client';

import {
  ArrowUpRight,
  Crosshair,
  Loader2,
  Paintbrush,
  Play,
  SquareDashed,
  Trash2,
  Type,
  X,
} from 'lucide-react';

import type {
  AnnotationType,
  CanvasAnnotationV2,
} from './annotation-types';

export interface AnnotationModelOption {
  id: string;
  label: string;
}

interface AnnotationComposerProps {
  annotations: CanvasAnnotationV2[];
  selectedAnnotationId: string | null;
  tool: AnnotationType;
  prompt: string;
  modelId: string;
  models?: AnnotationModelOption[];
  sourceLabel?: string;
  executeLabel?: string;
  rightInset?: number;
  isExecuting?: boolean;
  error?: string | null;
  onToolChange: (tool: AnnotationType) => void;
  onPromptChange: (prompt: string) => void;
  onModelChange: (modelId: string) => void;
  onSelectAnnotation: (annotationId: string) => void;
  onRemoveAnnotation: (annotationId: string) => void;
  onUpdateInstruction: (annotationId: string, instruction: string) => void;
  onExecute: () => void;
  onCancel: () => void;
  onClose: () => void;
}

const TOOL_BUTTON_CLASS =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';

function annotationLabel(annotation: CanvasAnnotationV2, index: number): string {
  if (annotation.label?.trim()) return annotation.label.trim();
  if (annotation.type === 'semantic-object') return `对象 ${index + 1}`;
  if (annotation.type === 'region') return `区域 ${index + 1}`;
  if (annotation.type === 'brush') return `画笔 ${index + 1}`;
  if (annotation.type === 'arrow') return `箭头 ${index + 1}`;
  return annotation.instruction?.trim() || `文字 ${index + 1}`;
}

function toolClass(active: boolean): string {
  return `${TOOL_BUTTON_CLASS} ${
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border bg-toolbar-bg text-muted-foreground hover:bg-toolbar-hover hover:text-foreground'
  }`;
}

export function AnnotationComposer({
  annotations,
  selectedAnnotationId,
  tool,
  prompt,
  modelId,
  models = [],
  sourceLabel = '当前图片',
  executeLabel = '执行修改',
  rightInset = 0,
  isExecuting = false,
  error = null,
  onToolChange,
  onPromptChange,
  onModelChange,
  onSelectAnnotation,
  onRemoveAnnotation,
  onUpdateInstruction,
  onExecute,
  onCancel,
  onClose,
}: AnnotationComposerProps) {
  const selectedAnnotation = annotations.find(
    (annotation) => annotation.id === selectedAnnotationId,
  );
  const hasInstruction = prompt.trim().length > 0
    || annotations.some((annotation) => annotation.instruction?.trim());
  const canExecute = annotations.length > 0 && hasInstruction && !isExecuting;

  return (
    <section
      data-testid="annotation-composer"
      data-floating-panel="annotation-composer"
      data-toolbar="annotation-tools"
      className="absolute bottom-[76px] z-50 flex flex-col gap-2 rounded-lg border border-border bg-panel-bg p-2 shadow-float"
      style={{
        left: `calc((100% - ${rightInset}px) / 2)`,
        width: `min(960px, calc(100% - ${rightInset}px - 32px))`,
        transform: 'translateX(-50%)',
      }}
      aria-label="批注修改"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex min-h-7 items-center gap-2 overflow-hidden">
        <div className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground">
            <Crosshair size={14} aria-hidden="true" />
          </span>
          <span className="max-w-28 truncate">{sourceLabel}</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {annotations.map((annotation, index) => {
            const selected = annotation.id === selectedAnnotationId;
            return (
              <div
                key={annotation.id}
                className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs ${
                  selected
                    ? 'border-primary bg-accent text-foreground'
                    : 'border-border bg-secondary text-muted-foreground'
                }`}
              >
                <button
                  type="button"
                  className="max-w-28 truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => onSelectAnnotation(annotation.id)}
                  title="定位批注"
                >
                  {annotationLabel(annotation, index)}
                </button>
                <button
                  type="button"
                  data-annotation-remove={annotation.id}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => onRemoveAnnotation(annotation.id)}
                  title="删除批注"
                  aria-label={`删除${annotationLabel(annotation, index)}`}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>

        <span className="shrink-0 text-[11px] text-muted-foreground">
          {annotations.length}/10 · 最多 10 个标记
        </span>
        <button
          type="button"
          className={TOOL_BUTTON_CLASS + ' border-transparent text-muted-foreground hover:bg-toolbar-hover hover:text-foreground'}
          onClick={onClose}
          title="退出批注修改"
          aria-label="退出批注修改"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex shrink-0 items-center gap-1" role="toolbar" aria-label="批注工具">
          <button
            type="button"
            data-annotation-tool="semantic-object"
            aria-pressed={tool === 'semantic-object'}
            className={toolClass(tool === 'semantic-object')}
            onClick={() => onToolChange('semantic-object')}
            title="智能标记对象"
            aria-label="智能标记对象"
          >
            <Crosshair size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-annotation-tool="region"
            aria-pressed={tool === 'region'}
            className={toolClass(tool === 'region')}
            onClick={() => onToolChange('region')}
            title="框选区域"
            aria-label="框选区域"
          >
            <SquareDashed size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-annotation-tool="brush"
            aria-pressed={tool === 'brush'}
            className={toolClass(tool === 'brush')}
            onClick={() => onToolChange('brush')}
            title="画笔圈画"
            aria-label="画笔圈画"
          >
            <Paintbrush size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-annotation-tool="arrow"
            aria-pressed={tool === 'arrow'}
            className={toolClass(tool === 'arrow')}
            onClick={() => onToolChange('arrow')}
            title="箭头标记"
            aria-label="箭头标记"
          >
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-annotation-tool="text"
            aria-pressed={tool === 'text'}
            className={toolClass(tool === 'text')}
            onClick={() => onToolChange('text')}
            title="文字说明"
            aria-label="文字说明"
          >
            <Type size={15} aria-hidden="true" />
          </button>
        </div>

        <textarea
          data-testid="annotation-prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          rows={1}
          maxLength={2000}
          placeholder="描述需要修改的内容，可组合多个标记"
          className="min-h-9 min-w-0 flex-[1_1_320px] resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />

        {models.length > 0 && (
          <select
            value={modelId}
            onChange={(event) => onModelChange(event.target.value)}
            className="h-9 min-w-36 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="批注修改模型"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        )}

        {isExecuting ? (
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 text-sm text-destructive hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            onClick={onCancel}
          >
            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            取消
          </button>
        ) : (
          <button
            type="button"
            data-testid="annotation-execute"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canExecute}
            onClick={onExecute}
          >
            <Play size={15} aria-hidden="true" />
            {executeLabel}
          </button>
        )}

        <button
          type="button"
          className={TOOL_BUTTON_CLASS + ' border-border bg-toolbar-bg text-muted-foreground hover:bg-destructive/10 hover:text-destructive'}
          onClick={() => annotations.forEach((annotation) => onRemoveAnnotation(annotation.id))}
          disabled={annotations.length === 0 || isExecuting}
          title="清空批注"
          aria-label="清空批注"
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>

      {selectedAnnotation?.type === 'text' && (
        <input
          data-testid="annotation-instruction-editor"
          value={selectedAnnotation.instruction || ''}
          onChange={(event) =>
            onUpdateInstruction(selectedAnnotation.id, event.target.value)}
          maxLength={500}
          placeholder="Edit text instruction"
          aria-label="Text annotation instruction"
          className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      )}
    </section>
  );
}
