'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Expand, Palette, RefreshCw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  applyVectorEditOperation,
  interpretVectorInstruction,
  sanitizeEditableSvg,
} from '@/lib/vector-design';

export interface VectorDesignAsset {
  svg: string;
  svgUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  pathCount: number;
  model: string;
  providerId: string;
  providerName: string;
  sourceType: string;
  sourceImageId?: string;
}

interface VectorEditorDialogProps {
  asset: VectorDesignAsset;
  templateIds: string[];
  onClose: () => void;
  onSave: (asset: VectorDesignAsset) => void;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function rasterizeSvg(svg: string, format: 'png' | 'jpg') {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG 预览渲染失败'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, image.naturalWidth || 1024);
    canvas.height = Math.max(1, image.naturalHeight || 1024);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持画布导出');
    if (format === 'jpg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const output = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('导出失败')), format === 'png' ? 'image/png' : 'image/jpeg', 0.94);
    });
    triggerBlobDownload(output, `wujie-vector.${format}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function VectorEditorDialog({ asset, templateIds, onClose, onSave }: VectorEditorDialogProps) {
  const [svg, setSvg] = useState(() => sanitizeEditableSvg(asset.svg));
  const [selectedElementId, setSelectedElementId] = useState('');
  const [selectedBox, setSelectedBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [color, setColor] = useState('#d4af37');
  const [instruction, setInstruction] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);

  // ★ 选中元素视觉反馈：为选中的 SVG 元素添加高亮 filter
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // 清除之前的高亮
    stage.querySelectorAll('.vector-selected').forEach(el => el.classList.remove('vector-selected'));
    if (!selectedElementId) return;
    // 为当前选中元素添加高亮 class
    const target = stage.querySelector(`[data-vector-element-id="${selectedElementId}"]`);
    if (target) target.classList.add('vector-selected');
  }, [selectedElementId, svg]);

  const selectedLabel = useMemo(
    () => selectedElementId ? selectedElementId.replace('vector-element-', '元素 ') : '尚未选择元素',
    [selectedElementId],
  );

  const commitLocal = (nextSvg: string) => {
    setHistory(previous => [...previous.slice(-19), svg]);
    setSvg(nextSvg);
  };

  const runLocalOperation = (operation: Parameters<typeof applyVectorEditOperation>[1]) => {
    try {
      commitLocal(applyVectorEditOperation(svg, operation));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'SVG 编辑失败');
    }
  };

  const applyInstruction = async () => {
    if (!instruction.trim()) return;
    const localOperation = interpretVectorInstruction(instruction, selectedElementId || undefined);
    if (localOperation) {
      runLocalOperation(localOperation);
      setInstruction('');
      return;
    }
    if (!selectedElementId) {
      toast.info('请先点击画面中的一个元素，再描述如何替换');
      return;
    }
    setIsApplying(true);
    try {
      const response = await fetch('/api/vector-design', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: 'edit',
          providerId: asset.providerId,
          model: asset.model,
          sourceSvg: svg,
          selectedElementId,
          targetBox: selectedBox,
          replacePrompt: instruction,
          templateIds,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '局部替换失败');
      commitLocal(data.asset.svg);
      setInstruction('');
      setSelectedElementId('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '局部替换失败');
    } finally {
      setIsApplying(false);
    }
  };

  const saveAsset = async () => {
    setIsApplying(true);
    try {
      const response = await fetch('/api/vector-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          providerId: asset.providerId,
          model: asset.model,
          sourceSvg: svg,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '保存矢量图失败');
      onSave(data.asset);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存矢量图失败');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" data-modal>
      <div className="flex h-[min(820px,94vh)] w-[min(1180px,96vw)] overflow-hidden rounded-2xl border border-[#3b3425] bg-[#111216] shadow-2xl">
        <aside className="flex w-64 shrink-0 flex-col border-r border-white/8 bg-[#15161b]">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-white">SVG 元素编辑</p>
              <p className="mt-1 text-[11px] text-[#8f9199]">{asset.pathCount} 个矢量形状</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white" aria-label="关闭">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-5 overflow-y-auto p-4">
            <section>
              <p className="mb-2 text-[11px] font-semibold text-[#d4af37]">当前选择</p>
              <div className="rounded-xl border border-white/8 bg-[#1c1e25] px-3 py-2 text-xs text-gray-300">{selectedLabel}</div>
            </section>
            <section>
              <p className="mb-2 text-[11px] font-semibold text-[#d4af37]">直接编辑</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!selectedElementId}
                  onClick={() => runLocalOperation({ type: 'delete', elementId: selectedElementId })}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-white/8 bg-[#1c1e25] px-2 py-2 text-xs text-gray-300 hover:border-red-500/40 hover:text-red-300 disabled:opacity-35"
                >
                  <Trash2 size={13} /> 删除
                </button>
                <button
                  type="button"
                  onClick={() => runLocalOperation({ type: 'expand', percent: 20 })}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-white/8 bg-[#1c1e25] px-2 py-2 text-xs text-gray-300 hover:border-[#d4af37]/40 hover:text-[#d4af37]"
                >
                  <Expand size={13} /> 扩展画面
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <input type="color" value={color} onChange={event => setColor(event.target.value)} className="h-9 w-12 rounded-lg border border-white/8 bg-transparent p-1" />
                <button
                  type="button"
                  disabled={!selectedElementId}
                  onClick={() => runLocalOperation({ type: 'recolor', elementId: selectedElementId, color })}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#2a2518] px-2 py-2 text-xs text-[#e4c66d] disabled:opacity-35"
                >
                  <Palette size={13} /> 应用颜色
                </button>
              </div>
              <button
                type="button"
                disabled={history.length === 0}
                onClick={() => {
                  const previous = history.at(-1);
                  if (!previous) return;
                  setSvg(previous);
                  setHistory(items => items.slice(0, -1));
                }}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/8 px-2 py-2 text-xs text-gray-400 hover:text-white disabled:opacity-35"
              >
                <RefreshCw size={13} /> 撤销上一步
              </button>
            </section>
            <section>
              <p className="mb-2 text-[11px] font-semibold text-[#d4af37]">自然语言修改</p>
              <textarea
                value={instruction}
                onChange={event => setInstruction(event.target.value)}
                placeholder="例如：把酒瓶改得更细长；换成黑金色；替换成青花瓷酒瓶"
                className="h-24 w-full resize-none rounded-xl border border-white/8 bg-[#1c1e25] p-3 text-xs leading-5 text-white outline-none placeholder:text-gray-600 focus:border-[#d4af37]/50"
              />
              <button
                type="button"
                disabled={isApplying || !instruction.trim()}
                onClick={applyInstruction}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#d8b64c] to-[#b88a20] px-3 py-2.5 text-xs font-semibold text-black disabled:opacity-40"
              >
                <Sparkles size={14} /> {isApplying ? '正在修改…' : '应用修改 / 局部替换'}
              </button>
            </section>
          </div>
        </aside>

        <main className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,#262934_0,#17181d_58%,#111216_100%)] p-10">
          <div className="absolute left-4 top-4 rounded-full border border-white/8 bg-black/25 px-3 py-1 text-[11px] text-gray-400">
            点击任意形状进行选择
          </div>
          <style>{`
            .vector-edit-stage .vector-selected {
              filter: drop-shadow(0 0 6px #d4af37) drop-shadow(0 0 2px #d4af37);
              cursor: pointer;
            }
            .vector-edit-stage [data-vector-element-id] {
              cursor: pointer;
              transition: filter 0.15s ease;
            }
            .vector-edit-stage [data-vector-element-id]:hover {
              filter: drop-shadow(0 0 3px rgba(212,175,55,0.5));
            }
          `}</style>
          <div
            ref={stageRef}
            className="vector-edit-stage max-h-full max-w-full overflow-hidden rounded-xl bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:20px_20px] bg-white shadow-2xl [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-[68vh] [&>svg]:max-w-full"
            onClick={event => {
              const target = event.target as Element;
              const editable = target.closest('[data-vector-element-id]');
              setSelectedElementId(editable?.getAttribute('data-vector-element-id') || '');
              if (editable && 'getBBox' in editable) {
                try {
                  const box = (editable as SVGGraphicsElement).getBBox();
                  setSelectedBox({ x: box.x, y: box.y, width: box.width, height: box.height });
                } catch {
                  setSelectedBox(null);
                }
              } else {
                setSelectedBox(null);
              }
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </main>

        <aside className="flex w-52 shrink-0 flex-col border-l border-white/8 bg-[#15161b] p-4">
          <p className="text-xs font-semibold text-white">导出与保存</p>
          <p className="mt-1 text-[11px] leading-4 text-gray-500">SVG 保留编辑能力；PNG 支持透明背景；JPG 自动使用白色背景。</p>
          <div className="mt-4 space-y-2">
            <button type="button" onClick={() => triggerBlobDownload(new Blob([svg], { type: 'image/svg+xml' }), 'wujie-vector.svg')} className="flex w-full items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-xs text-gray-300 hover:border-[#d4af37]/40">
              <Download size={14} /> 下载 SVG
            </button>
            <button type="button" onClick={() => void rasterizeSvg(svg, 'png')} className="flex w-full items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-xs text-gray-300 hover:border-[#d4af37]/40">
              <Download size={14} /> 下载 PNG
            </button>
            <button type="button" onClick={() => void rasterizeSvg(svg, 'jpg')} className="flex w-full items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-xs text-gray-300 hover:border-[#d4af37]/40">
              <Download size={14} /> 下载 JPG
            </button>
          </div>
          <div className="mt-auto">
            <button type="button" disabled={isApplying} onClick={saveAsset} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#d4af37] px-3 py-3 text-xs font-bold text-black hover:bg-[#e2c35e] disabled:opacity-40">
              <Save size={15} /> 保存到画布
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
