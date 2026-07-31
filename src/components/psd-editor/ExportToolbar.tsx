'use client';

import React from 'react';
import type { PSDExportMode } from '@/lib/psd-export';

interface ExportToolbarProps {
  mode: PSDExportMode;
  onModeChange: (mode: PSDExportMode) => void;
  onExport: () => void;
  isExporting: boolean;
  progress: number;
  progressMessage: string;
}

const MODE_OPTIONS: { value: PSDExportMode; label: string; desc: string }[] = [
  { value: 'basic', label: '基础', desc: '原图与基础图层' },
  { value: 'pro', label: '专业', desc: '元素分层与 V4 清单' },
  { value: 'studio', label: '工作室', desc: '完整分层、质量评分与效果层' },
];

export function ExportToolbar({ mode, onModeChange, onExport, isExporting, progress, progressMessage }: ExportToolbarProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-neutral-400 uppercase tracking-wider mb-1.5 block">
          导出模式
        </label>
        <div className="grid grid-cols-3 gap-1">
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onModeChange(opt.value)}
              className={`px-1.5 py-1.5 text-xs rounded transition-colors text-center ${
                mode === opt.value
                  ? 'bg-amber-500 text-black font-semibold'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
              title={opt.desc}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isExporting && (
        <div>
          <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-neutral-400 mt-1">{progressMessage}</p>
        </div>
      )}

      <button
        data-testid="layer-export-psd"
        onClick={onExport}
        disabled={isExporting}
        className={`w-full py-2 text-xs font-semibold rounded transition-colors ${
          isExporting
            ? 'bg-neutral-700 text-neutral-400 cursor-not-allowed'
            : 'bg-amber-500 text-black hover:bg-amber-400'
        }`}
      >
        {isExporting ? `导出中 ${Math.round(progress)}%` : '导出 PSD'}
      </button>
    </div>
  );
}
