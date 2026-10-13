'use client';
import React, { useEffect, useId, useRef, useState, type ReactElement, type PointerEvent } from 'react';
import { X } from 'lucide-react';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { parseWorkspaceSourceTrace, type SketchWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { appendSketchStroke, clearSketch, redoSketch, SKETCH_COLORS, SKETCH_WIDTHS,
  undoSketch, type SketchHistory, type SketchStroke } from '@/lib/sketch-to-code/drawing';
import { exportSketchPng, paintSketch } from '@/lib/sketch-to-code/render';
import { createSketchPanelSession, DOCUMENT_PLACEMENT_REASON, SKETCH_DOCUMENT_SANDBOX, sketchModels, type SketchPanelSession, type SketchScope, type SketchTask } from '@/lib/sketch-to-code/client';
import { SketchPlacement, type SketchInsert } from '@/lib/sketch-to-code/placement-client';

export interface SketchCanvasContext {
  key: string; captureScope: () => SketchScope; insert: SketchInsert;
}
interface SketchToCodePanelProps {
  session?: SketchPanelSession; models?: readonly TaskModelDescriptor[];
  catalogStatus?: { loading: boolean; error: string | null }; onClose?: () => void;
  insert?: SketchInsert; initialTrace?: SketchWorkspaceSourceTrace; isMonochrome?: boolean;
}
const unavailable: SketchScope = { actorId: '', projectId: '', key: 'unavailable', authority: 'unknown', assertCurrent: () => { throw new Error('当前项目授权不可用'); } };
const active = (task?: SketchTask): boolean => !!task && ['pending', 'processing', 'submitting'].includes(task.status);
// Keep the browser input boundary aligned with generation.ts admission validation.
const MAX_INSTRUCTION_LENGTH = 4096;

export function SketchToCodePanel({ session: supplied, models = [], catalogStatus, onClose, insert,
  initialTrace, isMonochrome = false }: SketchToCodePanelProps): ReactElement {
  const [fallback] = useState(() => createSketchPanelSession(unavailable));
  const session = supplied ?? fallback;
  const [, repaint] = useState(0);
  const [task, setTask] = useState(initialTrace ? undefined : session.client.task);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [tool, setTool] = useState<SketchStroke['tool']>('pen');
  const [color, setColor] = useState<SketchStroke['color']>(SKETCH_COLORS[0]);
  const [width, setWidth] = useState<SketchStroke['width']>(5);
  const canvas = useRef<HTMLCanvasElement>(null);
  const draft = useRef<{ pointerId: number; stroke: SketchStroke } | null>(null);
  const blobUrl = useRef('');
  const live = useRef(true); const busyRef = useRef(false); const operation = useRef(0);
  const readPaused = useRef(false);
  const candidates = sketchModels(models);
  const selected = candidates.find(model => JSON.stringify([model.providerId, model.modelId]) === session.selection);
  const instructionErrorId = useId();
  const instructionTooLong = session.instruction.length > MAX_INSTRUCTION_LENGTH;
  let authorized = true, writable = true;
  try { session.client.scope.assertCurrent(false); if (session.client.scope.authority === 'unknown') authorized = false; } catch { authorized = false; }
  try { session.client.scope.assertCurrent(true); } catch { writable = false; }
  const canGenerate = authorized && writable && !catalogStatus?.loading && !catalogStatus?.error && !!selected
    && session.history.present.strokes.length > 0 && !instructionTooLong && !busy && !active(task);
  const refresh = (): void => repaint(value => value + 1);
  const revoke = (): void => { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); blobUrl.current = ''; };
  const draw = (): void => {
    const context = canvas.current?.getContext('2d');
    if (context) paintSketch(context, draft.current ? { ...session.history.present, strokes: [...session.history.present.strokes, draft.current.stroke] } : session.history.present);
  };
  useEffect(() => { draw(); });
  useEffect(() => {
    live.current = true;
    const operationCounter = operation;
    return () => { live.current = false; operationCounter.current++; session.client.stop(); session.placement?.stop(); revoke(); draft.current = null; };
  }, [session]);
  useEffect(() => { if (!authorized) { session.client.stop(); session.placement?.stop(); revoke(); setPreviewUrl(''); } }, [authorized, session]);
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return;
    const token = ++operation.current; busyRef.current = true; setBusy(true); setMessage('');
    try { await action(); } catch (error) {
      if (live.current && token === operation.current) { readPaused.current = true; revoke(); setPreviewUrl(''); setMessage(error instanceof Error ? error.message : '操作未确认，请核对原任务'); }
    } finally { if (live.current && token === operation.current) { busyRef.current = false; setBusy(false); refresh(); } }
  };
  const receive = (next: SketchTask): void => {
    session.client.scope.assertCurrent();
    if (!live.current) return;
    if (initialTrace && (next.taskId !== initialTrace.taskId || next.projectId !== initialTrace.projectId
      || next.previewAssetVersionId !== initialTrace.previewAssetVersionId || next.htmlAssetVersionId !== initialTrace.htmlAssetVersionId)) { session.client.task = undefined; throw new Error('保存的来源提示与当前任务不匹配'); }
    readPaused.current = false;
    setTask(next);
    if (next.status === 'completed' && insert && session.placement?.trace.taskId !== next.taskId) {
      session.placement = new SketchPlacement(next, session.client.scope, insert);
    }
  };
  useEffect(() => {
    if (!initialTrace) return;
    const trace = parseWorkspaceSourceTrace(initialTrace);
    if (trace?.source !== 'sketch-to-code' || trace.projectId !== session.client.scope.projectId) { setMessage('来源提示不属于当前项目，不能打开代码'); return; }
    void run(async () => receive(await session.client.poll(trace.taskId)));
    // A stored hint triggers only an authorized read, never admission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTrace, session]);
  useEffect(() => {
    if (!active(task) || task?.needsReconcile || task?.dispatchPending || busy || readPaused.current || !authorized) return;
    const timer = setTimeout(() => { void run(async () => receive(await session.client.poll(task!.taskId))); }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, busy, session, authorized]);
  const updateHistory = (history: SketchHistory): void => { session.history = history; draft.current = null; refresh(); };
  const cancelStroke = (): void => { const pointerId = draft.current?.pointerId; draft.current = null;
    if (pointerId !== undefined && canvas.current?.hasPointerCapture?.(pointerId)) canvas.current.releasePointerCapture(pointerId); draw(); };
  const point = (event: PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1024, (event.clientX - rect.left) * 1024 / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(768, (event.clientY - rect.top) * 768 / Math.max(1, rect.height))) };
  };
  const download = (url: string, filename: string): void => {
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  };
  const readCode = async (save: boolean): Promise<void> => {
    if (!task || task.status !== 'completed') return;
    revoke(); setPreviewUrl('');
    const html = await session.client.document(task.taskId);
    session.client.scope.assertCurrent(); if (!live.current) return;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    blobUrl.current = url; setPreviewUrl(url);
    if (save) download(url, 'sketch-code.html');
  };
  const control = `rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${isMonochrome ? 'border-gray-300 hover:bg-gray-100 focus-visible:outline-gray-900' : 'border-white/25 hover:bg-white/10 focus-visible:outline-[#d4af37]'}`;
  const generation = async (reconcile: boolean): Promise<void> => {
    if (reconcile) { if (!session.client.input) return; receive(await session.client.start(session.client.input, true)); return; }
    if (!canGenerate || !selected) return;
    const input = { projectId: session.client.scope.projectId, imageDataUrl: exportSketchPng(session.history.present),
      instruction: session.instruction, providerId: selected.providerId, modelId: selected.modelId, idempotencyKey: crypto.randomUUID() };
    setTask(undefined); session.placement?.stop(); session.placement = undefined;
    revoke(); setPreviewUrl('');
    receive(await session.client.start(input));
  };
  const stage = task?.needsReconcile || task?.dispatchPending ? '派发待核对'
    : task?.status === 'completed' ? '已完成' : task?.status === 'cancelled' ? '已取消（服务端确认）' : task?.status === 'failed' ? '失败，草图已保留' : task?.status === 'timeout' ? '任务超时，草图已保留'
    : task?.phase === 'analysis' ? '分析中' : task?.phase === 'reconstruction' ? '重建中' : task ? '等待处理' : '尚未提交';
  return <section aria-label="草图转代码" role="region" data-modal="sketch-to-code" tabIndex={-1}
    className={`absolute inset-x-2 bottom-20 z-[80] max-h-[82dvh] overflow-y-auto overscroll-contain rounded-xl p-4 shadow-[0_12px_32px_rgba(0,0,0,0.3)] md:inset-x-8 ${isMonochrome ? 'bg-white text-gray-900' : 'bg-[#1a1a1a] text-gray-100'}`}
    onWheel={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); cancelStroke(); session.client.stop(); onClose?.(); return; }
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); updateHistory(event.shiftKey ? redoSketch(session.history) : undoSketch(session.history)); }
    }}>
    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">草图转代码</h2>
      <button className={control} aria-label="关闭草图转代码" onClick={() => { session.client.stop(); onClose?.(); }}><X className="h-4 w-4" /></button></div>
    <p className="mb-3 text-sm">画出页面结构，生成安全静态 HTML。画布卡片是原始草图 PNG，不是页面截图。关闭仅停止读取，不取消任务。</p>
    {session.client.scope.authority === 'document' && <p role="note" className="mb-3 text-sm">{DOCUMENT_PLACEMENT_REASON}</p>}
    {!authorized && <p role="alert" className="mb-3 text-sm">当前项目授权未知或已失效，请恢复项目后操作。</p>}
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(240px,2fr)]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap gap-2">
          <button className={control} aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>画笔</button>
          <button className={control} aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>橡皮擦</button>
          {SKETCH_COLORS.map(value => <button key={value} className={`${control} h-11 w-11 p-1`} aria-label={`画笔颜色 ${value}`} aria-pressed={color === value} onClick={() => setColor(value)}>
            <span className="block h-5 w-5 rounded border border-gray-400" style={{ backgroundColor: value }} /></button>)}
          {SKETCH_WIDTHS.map(value => <button key={value} className={control} aria-label={`画笔粗细 ${value}`} aria-pressed={width === value} onClick={() => setWidth(value)}>{value}px</button>)}
        </div>
        <canvas ref={canvas} aria-label="绘图区" tabIndex={0} width={1024} height={768} className="block h-auto w-full rounded-md bg-white outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4af37]" style={{ touchAction: 'none' }}
          onPointerDown={event => { event.preventDefault(); if (draft.current) { cancelStroke(); return; } if (event.button !== 0 || session.history.present.strokes.length >= 200) return;
            event.currentTarget.focus(); draft.current = { pointerId: event.pointerId, stroke: { id: crypto.randomUUID(), tool, color, width, points: [point(event)] } };
            try { event.currentTarget.setPointerCapture(event.pointerId); draw(); } catch { cancelStroke(); setMessage('绘图捕获不可用，请重新落笔'); } }}
          onPointerMove={event => { const current = draft.current; if (!current || current.pointerId !== event.pointerId || current.stroke.points.length >= 2048) return;
            draft.current = { ...current, stroke: { ...current.stroke, points: [...current.stroke.points, point(event)] } }; draw(); }}
          onPointerUp={event => { const current = draft.current; if (!current || current.pointerId !== event.pointerId) return;
            draft.current = null; if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            try { updateHistory(appendSketchStroke(session.history, current.stroke)); } catch (error) { setMessage(error instanceof Error ? error.message : '笔迹未保存'); } }}
          onPointerCancel={cancelStroke} onLostPointerCapture={cancelStroke} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={control} disabled={!session.history.past.length} onClick={() => updateHistory(undoSketch(session.history))}>撤销</button>
          <button className={control} disabled={!session.history.future.length} onClick={() => updateHistory(redoSketch(session.history))}>重做</button>
          <button className={control} disabled={!session.history.present.strokes.length} onClick={() => updateHistory(clearSketch(session.history))}>清空</button>
          <button className={control} disabled={!session.history.present.strokes.length} onClick={() => { try { download(exportSketchPng(session.history.present), 'input-sketch.png'); } catch (error) { setMessage(String(error)); } }}>下载草图PNG</button>
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        <label className="block text-sm">页面说明<textarea aria-label="页面说明" value={session.instruction} maxLength={MAX_INSTRUCTION_LENGTH}
          aria-invalid={instructionTooLong || undefined} aria-describedby={instructionTooLong ? instructionErrorId : undefined}
          placeholder="例如：上方导航、左侧列表、右侧详情" className={`${control} mt-1 min-h-24 w-full bg-transparent placeholder:text-inherit placeholder:opacity-70`}
          onChange={event => { session.instruction = event.target.value; refresh(); }} /></label>
        {instructionTooLong && <p id={instructionErrorId} role="alert" className="text-sm">页面说明最多支持 {MAX_INSTRUCTION_LENGTH} 个字符，请缩短后再提交；现有说明和草图已保留。</p>}
        <label className="block text-sm">视觉模型<select aria-label="视觉模型" value={selected ? session.selection : ''} className={`${control} mt-1 w-full ${isMonochrome ? 'bg-white' : 'bg-[#1a1a1a]'}`}
          disabled={catalogStatus?.loading || !!catalogStatus?.error} onChange={event => { session.selection = event.target.value; refresh(); }}>
          <option value="">{catalogStatus?.loading ? '目录加载中' : '请选择支持视觉的同步聊天模型'}</option>
          {candidates.map(model => <option key={JSON.stringify([model.providerId, model.modelId])} value={JSON.stringify([model.providerId, model.modelId])}>{model.providerId} / {model.modelId}</option>)}</select></label>
        {catalogStatus?.error && <p role="alert">模型目录不可用：{catalogStatus.error}</p>}
        {!catalogStatus?.loading && !candidates.length && <p className="text-sm">没有可用的同步视觉聊天模型，请管理员检查目录。</p>}
        <button className={`${control} w-full ${isMonochrome ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-[#d4af37] text-black hover:bg-[#e2c45e]'}`} disabled={!canGenerate} onClick={() => { void run(() => generation(false)); }}>{task || session.client.input ? '生成新任务代码（新提交）' : '生成代码'}</button>
        {session.client.input && (session.client.admissionUnknown || active(task)) && <p className="text-sm">更改草图、说明或模型后生成属于新意图；原提交可能仍在处理。核对原提交不会使用新输入。</p>}
        {session.client.admissionUnknown && <><p role="status">受理结果未知，未确认取消或退款。请核对原提交，勿重复扣费提交。</p><button className={control} disabled={busy || !authorized} onClick={() => { void run(() => generation(true)); }}>核对原提交（相同标识）</button></>}
        <div aria-live="polite" className="space-y-2 break-words text-sm">
          <p>{busy ? '正在核对服务结果…' : stage}{task ? ` · ${task.progress}%` : ''}</p>
          {task && <><p>预留额度：{task.reserveCredits}；实际净费：{task.actualCredits ?? '尚未确认'}</p>
            <p>退款状态：{task.refunded === true ? '服务端确认已退还预留额度' : task.status === 'completed' ? '净费以实际金额为准，返差额不等于全额退款' : '未确认全额退款'}</p>
            <p>任务：{task.taskId}{task.requestId ? ` · 请求：${task.requestId}` : ''}</p>
            <button className={control} disabled={busy || !authorized} onClick={() => { void run(async () => receive(await session.client.poll(task.taskId))); }}>核对任务状态</button>
            {active(task) && <button className={control} disabled={busy || !authorized} onClick={() => { void run(async () => { session.client.stop(); receive(await session.client.cancel(task.taskId)); }); }}>取消任务（等待确认）</button>}
            {task.error && <p role="alert">{task.error}</p>}</>}
          {message && <p role="alert">{message}</p>}
        </div>
        {task?.status === 'completed' && <div className="space-y-2">
          <p className="whitespace-pre-wrap break-words text-sm">{task.analysis}</p>
          <div className="flex flex-wrap gap-2">
            <button className={control} disabled={busy || !authorized} onClick={() => { void run(() => readCode(false)); }}>打开代码预览</button>
            <button className={control} disabled={busy || !authorized} onClick={() => { void run(() => readCode(true)); }}>下载HTML</button>
            <button className={control} disabled={busy || !authorized || session.client.scope.authority !== 'legacy' || !session.placement}
              title={session.client.scope.authority === 'document' ? DOCUMENT_PLACEMENT_REASON : undefined}
              onClick={() => { void run(async () => { await session.placement?.add(); if (live.current) setMessage('原始草图PNG已放置，代码仍需当前授权读取'); }); }}>添加到画布</button>
          </div>
          {authorized && previewUrl && <iframe title="安全静态代码预览" sandbox={SKETCH_DOCUMENT_SANDBOX} src={previewUrl} className="h-72 w-full rounded bg-white" />}
        </div>}
      </div>
    </div>
  </section>;
}
