'use client';

import React from 'react';
import type { DesignLayer } from '@/lib/psd-export';

interface LayerInspectorProps {
  layer: DesignLayer;
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    background: '背景层',
    subject: '主体层',
    shadow: '阴影/反射',
    text: '文字层',
    deco: '装饰层',
    decoration: '装饰层',
    vector: '矢量候选',
    original: '原始图层',
  };
  return map[role] || role;
}

export function LayerInspector({ layer }: LayerInspectorProps) {
  const box = layer.boundingBox;
  const x = Math.round((box?.x ?? 0) + (layer.offsetX ?? 0));
  const y = Math.round((box?.y ?? 0) + (layer.offsetY ?? 0));

  return (
    <div className="p-2.5 space-y-2">
      <h3 className="text-xs text-neutral-400 uppercase tracking-wider">属性</h3>

      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-neutral-400">名称</span>
          <span className="text-white truncate max-w-[140px]">{layer.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-400">角色</span>
          <span className="text-amber-400">{roleLabel(layer.role)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-400">可见</span>
          <span className={layer.visible ? 'text-green-400' : 'text-red-400'}>{layer.visible ? '是' : '否'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-400">锁定</span>
          <span className={layer.locked ? 'text-red-400' : 'text-green-400'}>{layer.locked ? '是' : '否'}</span>
        </div>
        {box && (
          <div className="flex justify-between">
            <span className="text-neutral-400">位置</span>
            <span className="text-neutral-300">{x},{y}</span>
          </div>
        )}
        {box && (
          <div className="flex justify-between">
            <span className="text-neutral-400">尺寸</span>
            <span className="text-neutral-300">{box.width}x{box.height}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-neutral-400">不透明度</span>
          <span className="text-neutral-300">{Math.round((layer.opacity ?? 1) * 100)}%</span>
        </div>
        {layer.score !== undefined && (
          <div className="flex justify-between">
            <span className="text-neutral-400">置信度</span>
            <span className="text-neutral-300">{(layer.score * 100).toFixed(1)}%</span>
          </div>
        )}
        {layer.textContent && (
          <div className="mt-1">
            <span className="text-neutral-400 text-xs">文本内容</span>
            <p className="text-white mt-0.5 text-xs bg-neutral-800 rounded px-2 py-1">
              {layer.textContent}
            </p>
          </div>
        )}
        {layer.semanticLabel && (
          <div className="flex justify-between">
            <span className="text-neutral-400">语义标签</span>
            <span className="text-neutral-300">{layer.semanticLabel}</span>
          </div>
        )}
        {layer.fallbackReason && (
          <div className="mt-1">
            <span className="text-amber-400 text-xs">回退原因: {layer.fallbackReason}</span>
          </div>
        )}
      </div>
    </div>
  );
}
