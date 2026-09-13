'use client';

import type {
  CSSProperties,
  Dispatch,
  ReactNode,
  RefObject,
  SetStateAction,
} from 'react';
import { Check, ChevronDown, ChevronUp, Settings2, Trash2, X } from 'lucide-react';

import type { ImageToolbarPosition } from '@/lib/image-toolbar-position';

export interface CanvasImageToolbarAction {
  icon: ReactNode;
  label: string;
  desc: string;
  action: () => void;
  testId?: string;
}

export interface CanvasImageActionToolbarProps {
  toolbarRef: RefObject<HTMLDivElement | null>;
  position: ImageToolbarPosition;
  isMonochrome: boolean;
  displayedActions: CanvasImageToolbarAction[];
  overflowActions: CanvasImageToolbarAction[];
  expanded: boolean;
  onExpandedChange: Dispatch<SetStateAction<boolean>>;
  onBeforeOpenOverlay: (overlay: 'overflow' | 'customize') => void;
  onDelete: () => void;
  customizeOpen: boolean;
  onCustomizeOpenChange: Dispatch<SetStateAction<boolean>>;
  toolbarItemOrder: string[];
  onToolbarItemOrderChange: Dispatch<SetStateAction<string[]>>;
  toolbarHiddenItems: Set<string>;
  onToolbarHiddenItemsChange: Dispatch<SetStateAction<Set<string>>>;
  allActionLabels: string[];
  onResetPreferences: () => void;
}

export function CanvasImageActionToolbar({
  toolbarRef,
  position,
  isMonochrome,
  displayedActions,
  overflowActions,
  expanded,
  onExpandedChange,
  onBeforeOpenOverlay,
  onDelete,
  customizeOpen,
  onCustomizeOpenChange,
  toolbarItemOrder,
  onToolbarItemOrderChange,
  toolbarHiddenItems,
  onToolbarHiddenItemsChange,
  allActionLabels,
  onResetPreferences,
}: CanvasImageActionToolbarProps) {
  const hasMoreActions = overflowActions.length > 0;
  const positionStyle: CSSProperties = {
    left: position.left,
    top: position.top,
    transform: position.transform,
  };

  const setItemHidden = (label: string, hidden: boolean): void => {
    const next = new Set(toolbarHiddenItems);
    if (hidden) next.add(label);
    else next.delete(label);
    onToolbarHiddenItemsChange(next);
  };

  const moveItem = (label: string, direction: -1 | 1): void => {
    const index = toolbarItemOrder.indexOf(label);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= toolbarItemOrder.length) return;
    const next = [...toolbarItemOrder];
    [next[index], next[target]] = [next[target], next[index]];
    onToolbarItemOrderChange(next);
  };

  return (
    <div
      ref={toolbarRef}
      data-toolbar="image-action-toolbar"
      data-theme={isMonochrome ? 'mono' : 'dark'}
      className={`pointer-events-auto absolute z-50 hidden max-w-[calc(100vw-24px)] items-center gap-0.5 overflow-visible rounded-lg border px-1.5 py-1 shadow-xl transition-colors motion-reduce:transition-none md:flex ${
        isMonochrome
          ? 'border-gray-200 bg-white text-gray-700'
          : 'border-white/[0.12] bg-[#1a1a1a] text-gold-muted'
      }`}
      style={positionStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {displayedActions.map((action) => (
        <button
          key={action.label}
          type="button"
          data-image-toolbar-main-action
          data-testid={action.testId}
          title={action.desc || action.label}
          onClick={() => action.action()}
          className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] leading-none transition-colors motion-reduce:transition-none ${
            isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10 hover:text-white'
          }`}
        >
          {action.icon}
          <span className="w-9 truncate text-center">{action.label}</span>
        </button>
      ))}

      <span className={`mx-0.5 h-7 w-px shrink-0 ${isMonochrome ? 'bg-gray-200' : 'bg-white/[0.10]'}`} />
      <button
        type="button"
        data-testid="selected-image-delete"
        aria-label="删除"
        title="删除"
        onClick={onDelete}
        className="flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] text-red-400 transition-colors hover:bg-red-500/10 motion-reduce:transition-none"
      >
        <Trash2 size={15} />
        <span>删除</span>
      </button>

      {hasMoreActions && (
        <button
          type="button"
          aria-label={expanded ? '收起更多工具' : '展开更多工具'}
          aria-expanded={expanded}
          aria-controls="selected-image-toolbar-overflow"
          onClick={() => {
            if (!expanded) onBeforeOpenOverlay('overflow');
            onExpandedChange(!expanded);
          }}
          className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] transition-colors motion-reduce:transition-none ${
            isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10 hover:text-white'
          }`}
          title={expanded ? '收起工具栏' : '展开更多工具'}
        >
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          <span>{expanded ? '收起' : `+${overflowActions.length}`}</span>
        </button>
      )}

      <button
        type="button"
        aria-label="自定义图片工具栏"
        aria-expanded={customizeOpen}
        onClick={() => {
          if (!customizeOpen) onBeforeOpenOverlay('customize');
          onCustomizeOpenChange(!customizeOpen);
        }}
        className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] transition-colors motion-reduce:transition-none ${
          isMonochrome ? 'text-gray-500 hover:bg-gray-100' : 'text-gold-muted/70 hover:bg-white/10'
        }`}
        title="自定义工具栏"
      >
        <Settings2 size={14} />
        <span>设置</span>
      </button>

      {hasMoreActions && (
        <div
          id="selected-image-toolbar-overflow"
          data-image-toolbar-overflow
          className={`absolute right-0 top-full z-[100] mt-2 max-h-[min(50vh,420px)] w-56 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border p-1 shadow-2xl ${
            expanded ? 'block' : 'hidden'
          } ${isMonochrome ? 'border-gray-200 bg-white' : 'border-white/[0.12] bg-[#141418]'}`}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          {overflowActions.map((action) => (
            <button
              key={action.label}
              type="button"
              data-image-toolbar-overflow-action
              data-testid={action.testId}
              title={action.desc || action.label}
              onClick={() => {
                onExpandedChange(false);
                action.action();
              }}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors motion-reduce:transition-none ${
                isMonochrome ? 'text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:bg-white/10 hover:text-white'
              }`}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {customizeOpen && (
        <div
          data-popup="toolbar-customize"
          className={`absolute right-0 top-full z-[100] mt-2 w-72 max-w-[calc(100vw-24px)] rounded-lg border p-3 shadow-2xl ${
            isMonochrome ? 'border-gray-200 bg-white' : 'border-white/[0.12] bg-[#141418]'
          }`}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <strong className={`text-sm ${isMonochrome ? 'text-gray-800' : 'text-white'}`}>
              自定义工具栏
            </strong>
            <button
              type="button"
              aria-label="关闭工具栏设置"
              onClick={() => onCustomizeOpenChange(false)}
              className="rounded p-1 transition-colors hover:bg-white/10 motion-reduce:transition-none"
            >
              <X size={15} />
            </button>
          </div>
          <div className="max-h-[min(45vh,300px)] space-y-1 overflow-y-auto">
            {toolbarItemOrder
              .filter((label) => allActionLabels.includes(label))
              .map((label, index) => {
                const hidden = toolbarHiddenItems.has(label);
                return (
                  <div key={label} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                    <button
                      type="button"
                      aria-label={hidden ? `显示${label}` : `隐藏${label}`}
                      aria-pressed={!hidden}
                      onClick={() => setItemHidden(label, !hidden)}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        hidden
                          ? isMonochrome ? 'border-gray-300' : 'border-white/20'
                          : isMonochrome ? 'border-blue-500 bg-blue-500' : 'border-gold bg-gold'
                      }`}
                    >
                      {!hidden && <Check size={11} className="text-white" />}
                    </button>
                    <span className={`min-w-0 flex-1 truncate text-xs ${
                      hidden
                        ? isMonochrome ? 'text-gray-400 line-through' : 'text-gold-muted/50 line-through'
                        : isMonochrome ? 'text-gray-700' : 'text-white'
                    }`}>
                      {label}
                    </span>
                    <button
                      type="button"
                      aria-label={`上移${label}`}
                      disabled={index === 0}
                      onClick={() => moveItem(label, -1)}
                      className="rounded p-1 disabled:opacity-25"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`下移${label}`}
                      disabled={index === toolbarItemOrder.length - 1}
                      onClick={() => moveItem(label, 1)}
                      className="rounded p-1 disabled:opacity-25"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
                );
              })}
          </div>
          <button
            type="button"
            aria-label="恢复默认"
            onClick={onResetPreferences}
            className={`mt-3 h-8 w-full rounded-md text-xs font-medium transition-colors motion-reduce:transition-none ${
              isMonochrome ? 'bg-gray-900 text-white hover:bg-gray-700' : 'bg-gold text-black hover:bg-gold-light'
            }`}
          >
            恢复默认
          </button>
        </div>
      )}
    </div>
  );
}
