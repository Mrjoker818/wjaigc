'use client';
import React, { useEffect, useId, useRef, useState, type ReactElement, type PointerEvent } from 'react';
import { X } from 'lucide-react';
import Image from 'next/image';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { parseWorkspaceSourceTrace, type SketchWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { appendSketchStroke, clearSketch, redoSketch, SKETCH_COLORS, SKETCH_WIDTHS,
  undoSketch, type SketchHistory, type SketchStroke } from '@/lib/sketch-to-code/drawing';
import { exportSketchPng, paintSketch } from '@/lib/sketch-to-code/render';
import { createSketchPanelSession, SketchClient, DOCUMENT_PLACEMENT_REASON, SKETCH_DOCUMENT_SANDBOX, sketchModels, type SketchPanelSession, type SketchScope, type SketchTask } from '@/lib/sketch-to-code/client';
import { SketchPlacement, type SketchInsert } from '@/lib/sketch-to-code/placement-client';
import { sketchImageModels, type SketchCreationMode } from '@/lib/sketch-to-code/image-contract';
import { SketchImageClient, SketchImageReadGate, type SketchImagePanelSession, type SketchImageTask } from '@/lib/sketch-to-code/image-client';
import { SketchImagePlacement } from '@/lib/sketch-to-code/image-placement-client';
import { discoverSketchTasks, sketchRecoveryActive, sketchRecoveryMemory, type SketchRecoveryCandidate } from '@/lib/sketch-to-code/recovery-client';

export interface SketchCanvasContext {
  key: string; captureScope: () => SketchScope; insert: SketchInsert;
}
interface SketchToCodePanelProps {
  session?: SketchPanelSession; imageSession?: SketchImagePanelSession; models?: readonly TaskModelDescriptor[];
  catalogStatus?: { loading: boolean; error: string | null }; onClose?: () => void;
  insert?: SketchInsert; initialTrace?: SketchWorkspaceSourceTrace; isMonochrome?: boolean;
  recoverTasks?: boolean;
}
const unavailable: SketchScope = { actorId: '', projectId: '', key: 'unavailable', authority: 'unknown', assertCurrent: () => { throw new Error('当前项目授权不可用'); } };
const active = (task?: Pick<SketchTask, 'status'>): boolean => !!task && ['pending', 'processing', 'submitting'].includes(task.status);
// Keep the browser input boundary aligned with generation.ts admission validation.
const MAX_INSTRUCTION_LENGTH = 4096;

// Owned by the existing drawer sessions, not a global cache of authorization
// closures. Non-enumerable state is neither persisted nor copied as draft data.
const runtimeKey = Symbol('sketch-drawer-runtime');
interface SketchDrawerRuntime {
  scopeKey: string; check: SketchScope['assertCurrent']; imageAdmissions: number;
  placements: Map<string, SketchPlacement | SketchImagePlacement>;
}
function placementKey(task: SketchTask | SketchImageTask): string {
  return JSON.stringify('visionProviderId' in task
    ? ['image', task.projectId, task.taskId, task.previewAssetId, task.previewAssetVersionId,
      task.imageAssetId, task.imageAssetVersionId, task.visionProviderId, task.visionModelId, task.imageProviderId, task.imageModelId]
    : ['code', task.projectId, task.taskId, task.previewAssetId, task.previewAssetVersionId, task.htmlAssetId, task.htmlAssetVersionId]);
}
function drawerRuntime(session: SketchPanelSession | SketchImagePanelSession): SketchDrawerRuntime {
  const owner = session as (SketchPanelSession | SketchImagePanelSession) & { [runtimeKey]?: SketchDrawerRuntime };
  const scope = session.client.scope;
  const scopeKey = JSON.stringify([scope.actorId, scope.projectId, scope.key, scope.authority]);
  const previous = owner[runtimeKey];
  if (previous?.scopeKey === scopeKey && previous.check === scope.assertCurrent) return previous;
  if (previous) {
    for (const placement of previous.placements.values()) placement.stop();
    previous.placements.clear(); session.placement?.stop(); session.placement = undefined;
  }
  const runtime: SketchDrawerRuntime = { scopeKey, check: scope.assertCurrent, imageAdmissions: 0, placements: new Map() };
  if (!previous && session.placement && session.client.task?.status === 'completed') {
    runtime.placements.set(placementKey(session.client.task), session.placement);
  }
  Object.defineProperty(owner, runtimeKey, { value: runtime, configurable: true });
  return runtime;
}
function retainedPlacement<T extends SketchPlacement | SketchImagePlacement>(session: SketchPanelSession | SketchImagePanelSession,
  task: SketchTask | SketchImageTask, create: () => T): T {
  session.client.scope.assertCurrent();
  const placements = drawerRuntime(session).placements, key = placementKey(task);
  let placement = placements.get(key);
  if (!placement) { placement = create(); placements.set(key, placement); }
  return placement as T;
}

interface ImageModeControlsProps {
  session: SketchImagePanelSession; history: SketchHistory; models: readonly TaskModelDescriptor[];
  catalogStatus?: SketchToCodePanelProps['catalogStatus']; insert?: SketchInsert;
  visible: boolean; allowed: boolean; control: string; isMonochrome: boolean;
  recoveryBlocked?: boolean; onTask?: (task: SketchImageTask) => void;
  recoverTasks?: boolean; onAdmissionChange?: () => void;
}
function ImageModeControls({ session, history, models, catalogStatus, insert, visible, allowed, control, isMonochrome, recoveryBlocked = false, onTask, recoverTasks = false, onAdmissionChange }: ImageModeControlsProps): ReactElement {
  const [, repaint] = useState(0);
  const [task, setTask] = useState(session.client.task);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState('');
  const url = useRef(''), operation = useRef(0), busyRef = useRef(false), live = useRef(true), paused = useRef(false);
  const enabled = useRef(false); enabled.current = visible && allowed;
  const placementTask = useRef(session.placement ? session.client.task?.taskId : undefined);
  const runtime = recoverTasks ? drawerRuntime(session) : undefined;
  const errorId = useId();
  const visionModels = sketchModels(models);
  let imageModels: TaskModelDescriptor[] = [], invalidCatalog = false;
  try { imageModels = sketchImageModels(models); } catch { invalidCatalog = true; }
  const key = (model: TaskModelDescriptor): string => JSON.stringify([model.providerId, model.modelId]);
  const vision = visionModels.find(model => key(model) === session.visionSelection);
  const image = imageModels.find(model => key(model) === session.imageSelection);
  let writable = true;
  try { session.client.scope.assertCurrent(true); } catch { writable = false; }
  const tooLong = session.instruction.length > MAX_INSTRUCTION_LENGTH;
  const parametersValid = !!image && (!image.allowedRatios.length || image.allowedRatios.includes(session.aspectRatio))
    && (!session.size || image.allowedSizes.includes(session.size)) && (!session.quality || image.qualityOptions.includes(session.quality));
  const reconcile = !!(task?.needsReconcile || task?.dispatchPending || task?.recoveryPending);
  const canGenerate = !recoveryBlocked && allowed && writable && !!vision && parametersValid && !catalogStatus?.loading && !catalogStatus?.error
    && !invalidCatalog && !!history.present.strokes.length && !tooLong && !busy && !runtime?.imageAdmissions && !active(task) && !reconcile && !session.client.admissionUnknown;
  const refresh = (): void => repaint(value => value + 1);
  const revoke = (): void => { if (url.current) URL.revokeObjectURL(url.current); url.current = ''; };
  const stop = (): void => { operation.current++; busyRef.current = false; session.client.stop(); session.placement?.stop(); };
  useEffect(() => {
    live.current = true;
    setTask(session.client.task); setBusy(false); setMessage(''); setPreview(''); paused.current = false;
    placementTask.current = session.placement ? session.client.task?.taskId : undefined;
    return () => { live.current = false; stop(); revoke(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  useEffect(() => {
    if (!visible || !allowed) { stop(); setBusy(false); }
    if (!allowed) { revoke(); setPreview(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, allowed, session]);
  const run = async (action: (assert: () => void) => Promise<void>): Promise<void> => {
    if (busyRef.current || runtime?.imageAdmissions || !enabled.current || !live.current) return;
    const token = ++operation.current; busyRef.current = true; setBusy(true); setMessage('');
    const assert = (): void => { session.client.scope.assertCurrent(); if (!live.current || !enabled.current || token !== operation.current) throw new Error('图像读取已停止，请核对原任务'); };
    try { await action(assert); }
    catch (error) { if (live.current && enabled.current && token === operation.current) { paused.current = true; revoke(); setPreview(''); setMessage(error instanceof Error ? error.message : '操作未确认，请核对原任务'); } }
    finally { if (live.current && token === operation.current) { busyRef.current = false; setBusy(false); refresh(); } }
  };
  const receive = (next: SketchImageTask): void => {
    paused.current = false; setTask(next);
    onTask?.(next);
    if (next.status === 'completed' && !next.needsReconcile && !next.dispatchPending && !next.recoveryPending && insert && (recoverTasks || placementTask.current !== next.taskId)) {
      const placement = recoverTasks ? retainedPlacement(session, next, () => new SketchImagePlacement(next, session.client.scope, insert))
        : new SketchImagePlacement(next, session.client.scope, insert);
      if (session.placement !== placement) session.placement?.stop();
      session.placement = placement; placementTask.current = next.taskId;
    }
  };
  const poll = async (assert: () => void): Promise<void> => { if (!task) return; const next = await session.client.poll(task.taskId); assert(); receive(next); };
  useEffect(() => {
    if (!visible || !allowed || !active(task) || reconcile || busy || paused.current) return;
    const timer = setTimeout(() => { void run(poll); }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, allowed, task, reconcile, busy, session]);
  const admit = async (input: NonNullable<SketchImageClient['input']>, reconcile = false): Promise<SketchImageTask> => {
    if (!runtime) return session.client.start(input, reconcile);
    if (runtime.imageAdmissions) throw new Error('原图像提交仍在受理，请等待确认后核对原提交');
    // stop(), mode changes and child remounts cannot release this ownership.
    // Only settlement of the original client promise can do so; a lost ACK
    // then remains guarded by that client's admissionUnknown and frozen input.
    runtime.imageAdmissions++; onAdmissionChange?.();
    try { return await session.client.start(input, reconcile); }
    finally { runtime.imageAdmissions--; onAdmissionChange?.(); }
  };
  const generate = async (original: boolean, assert: () => void): Promise<void> => {
    if (original) {
      if (!session.client.input) return;
      const next = task ? await session.client.poll(task.taskId) : await admit(session.client.input, true);
      assert(); receive(next); return;
    }
    if (!canGenerate || !vision || !image) return;
    const input = { projectId: session.client.scope.projectId, imageDataUrl: exportSketchPng(history.present), instruction: session.instruction,
      visionProviderId: vision.providerId, visionModelId: vision.modelId, imageProviderId: image.providerId, imageModelId: image.modelId,
      idempotencyKey: crypto.randomUUID(), aspectRatio: session.aspectRatio, ...(session.size ? { size: session.size } : {}), ...(session.quality ? { quality: session.quality } : {}) };
    setTask(undefined); session.placement?.stop(); session.placement = undefined; placementTask.current = undefined; revoke(); setPreview('');
    const next = await admit(input); assert(); receive(next);
  };
  const readImage = async (save: boolean, assert: () => void): Promise<void> => {
    if (!task || task.status !== 'completed' || reconcile) return;
    revoke(); setPreview('');
    const bytes = await session.client.image(task.taskId); assert();
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[bytes.type];
    if (!extension) throw new Error('图像格式未确认，请核对原任务');
    if (session.client.task) receive(session.client.task);
    const next = URL.createObjectURL(bytes); url.current = next; setPreview(next);
    if (save) { const link = document.createElement('a'); link.href = next; link.download = `sketch-image.${extension}`; document.body.append(link); link.click(); link.remove(); }
  };
  const stage = reconcile ? '任务待核对' : task?.status === 'completed' ? '已完成' : task?.status === 'failed' ? '失败，草图已保留'
    : task?.status === 'cancelled' ? '已取消（服务端确认）' : task?.status === 'timeout' ? '任务超时，草图已保留'
    : task?.phase === 'analysis' ? '分析中' : task?.phase === 'generation' ? '生图中' : task ? '等待处理' : recoveryBlocked ? '原任务待核对' : '尚未提交';
  const selectClass = `${control} mt-1 w-full ${isMonochrome ? 'bg-white' : 'bg-[#1a1a1a]'}`;
  return <div hidden={!visible} className="min-w-0 space-y-3">
    <label className="block text-sm">创作关键词<textarea aria-label="创作关键词" value={session.instruction} maxLength={MAX_INSTRUCTION_LENGTH}
      aria-invalid={tooLong || undefined} aria-describedby={tooLong ? errorId : undefined} placeholder="例如：暖色建筑、水彩质感，保留草图构图"
      className={`${control} mt-1 min-h-24 w-full bg-transparent placeholder:text-inherit placeholder:opacity-70`}
      onChange={event => { session.instruction = event.target.value; refresh(); }} /></label>
    {tooLong && <p id={errorId} role="alert" className="text-sm">创作关键词最多支持 {MAX_INSTRUCTION_LENGTH} 个字符，请缩短后再提交；现有关键词和草图已保留。</p>}
    <label className="block text-sm">视觉分析模型<select aria-label="视觉分析模型" value={vision ? session.visionSelection : ''} className={selectClass}
      disabled={catalogStatus?.loading || !!catalogStatus?.error || invalidCatalog} onChange={event => { session.visionSelection = event.target.value; refresh(); }}>
      <option value="">请选择支持视觉的同步聊天模型</option>{visionModels.map(model => <option key={key(model)} value={key(model)}>{model.providerId} / {model.modelId}</option>)}</select></label>
    <label className="block text-sm">图像生成模型<select aria-label="图像生成模型" value={image ? session.imageSelection : ''} className={selectClass}
      disabled={catalogStatus?.loading || !!catalogStatus?.error || invalidCatalog} onChange={event => { session.imageSelection = event.target.value; refresh(); }}>
      <option value="">请选择支持参考图的图像模型</option>{imageModels.map(model => <option key={key(model)} value={key(model)}>{model.providerId} / {model.modelId}</option>)}</select></label>
    {!catalogStatus?.loading && !catalogStatus?.error && (!visionModels.length || !imageModels.length) && <p className="text-sm">需要可用的视觉分析模型和支持参考图的图像模型，请管理员检查目录。</p>}
    {(catalogStatus?.error || invalidCatalog) && <p role="alert">模型目录不可用：{catalogStatus?.error ?? '目录格式无效，请重新加载'}</p>}
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
      <label className="block text-sm">画面比例<select aria-label="画面比例" className={selectClass} value={session.aspectRatio} disabled={!image}
        onChange={event => { session.aspectRatio = event.target.value; refresh(); }}>
        {Array.from(new Set([session.aspectRatio, ...(image?.allowedRatios.length ? image.allowedRatios : ['4:3'])])).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="block text-sm">图像尺寸<select aria-label="图像尺寸" className={selectClass} value={session.size ?? ''} disabled={!image?.allowedSizes.length && !session.size}
        onChange={event => { session.size = event.target.value || undefined; refresh(); }}><option value="">模型默认</option>{Array.from(new Set([...(session.size ? [session.size] : []), ...(image?.allowedSizes ?? [])])).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="block text-sm">图像质量<select aria-label="图像质量" className={selectClass} value={session.quality ?? ''} disabled={!image?.qualityOptions.length && !session.quality}
        onChange={event => { session.quality = event.target.value || undefined; refresh(); }}><option value="">模型默认</option>{Array.from(new Set([...(session.quality ? [session.quality] : []), ...(image?.qualityOptions ?? [])])).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    {image && !parametersValid && <p role="alert">保留的图像参数不适用于当前模型，请调整比例、尺寸或质量后提交。</p>}
    <button className={`${control} w-full ${isMonochrome ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-[#d4af37] text-black hover:bg-[#e2c45e]'}`} disabled={!canGenerate}
      onClick={() => { void run(assert => generate(false, assert)); }}>{task || session.client.input ? '生成新图像（新提交）' : '生成图像'}</button>
    {session.client.input && (session.client.admissionUnknown || active(task)) && <p className="text-sm">原提交可能仍在处理。核对原提交使用原始草图、关键词、双模型和参数，不使用后续编辑。</p>}
    {session.client.admissionUnknown && <><p role="status">受理结果未知，未确认取消或退款。请核对原提交，勿重复扣费提交。</p><button className={control} disabled={busy || !allowed}
      onClick={() => { void run(assert => generate(true, assert)); }}>核对原提交（相同标识）</button></>}
    <div aria-live="polite" className="space-y-2 break-words text-sm">
      <p>{busy ? '正在核对服务结果…' : stage}{task ? ` · ${task.progress}%` : ''}</p>
      {task && <><p>预留额度：{task.reserveCredits}；实际净费：{task.actualCredits ?? '尚未确认'}</p>
        <p>视觉分析预留：{task.pricing.vision.reserveCredits}；单张图像报价：{task.pricing.image.credits}</p>
        <p>任务模型：{task.visionProviderId} / {task.visionModelId} → {task.imageProviderId} / {task.imageModelId}</p>
        <p>退款状态：{task.status === 'completed' ? '净费以实际金额为准，返差额不等于全额退款' : task.refunded === true ? '服务端确认已退还预留额度' : '未确认全额退款'}</p>
        <p>任务：{task.taskId}{task.requestId ? ` · 请求：${task.requestId}` : ''}</p>
        <button className={control} disabled={busy || !allowed} onClick={() => { void run(poll); }}>核对任务状态</button>
        {active(task) && <button className={control} disabled={busy || !allowed || !writable} onClick={() => { void run(async assert => { session.client.stop(); const next = await session.client.cancel(task.taskId); assert(); receive(next); }); }}>取消任务（等待确认）</button>}
        {task.error && <p role="alert">{task.error}</p>}</>}
      {message && <p role="alert">{message}</p>}
    </div>
    {task?.status === 'completed' && !reconcile && <div className="space-y-2">
      {task.analysis && <p className="whitespace-pre-wrap break-words text-sm">{`摘要：${task.analysis.summary}\n构图：${task.analysis.composition}\n生成提示词：${task.analysis.prompt}\n反向提示词：${task.analysis.negativePrompt}`}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={control} disabled={busy || !allowed} onClick={() => { void run(assert => readImage(false, assert)); }}>打开图像预览</button>
        <button className={control} disabled={busy || !allowed} onClick={() => { void run(assert => readImage(true, assert)); }}>下载生成图像</button>
        <button className={control} disabled={busy || !allowed || !writable || session.client.scope.authority !== 'legacy' || !session.placement}
          title={session.client.scope.authority === 'document' ? '协作文档暂不能放置生成图像，仍可受权预览和下载。' : undefined}
          onClick={() => { void run(async assert => { await session.placement?.add(); assert(); setMessage('生成图像已新增到画布，原始草图保持不变'); }); }}>添加生成图到画布</button>
      </div>
      {allowed && preview && <Image unoptimized width={1024} height={768} alt="受权生成图像预览" src={preview} className="max-h-80 h-auto w-full rounded-md object-contain" />}
    </div>}
  </div>;
}

export function SketchToCodePanel({ session: supplied, imageSession, models = [], catalogStatus, onClose, insert,
  initialTrace, isMonochrome = false, recoverTasks = false }: SketchToCodePanelProps): ReactElement {
  const [fallback] = useState(() => createSketchPanelSession(unavailable));
  const session = supplied ?? fallback;
  const [mode, setMode] = useState<SketchCreationMode>(initialTrace ? 'code' : imageSession ? 'image' : 'code');
  const [closed, setClosed] = useState(false);
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
  const sourceRestore = useRef<{ session: SketchPanelSession; imageSession?: SketchImagePanelSession; key: string; started: boolean; completed: boolean } | undefined>(undefined);
  const candidates = sketchModels(models);
  const selected = candidates.find(model => JSON.stringify([model.providerId, model.modelId]) === session.selection);
  const instructionErrorId = useId();
  const instructionTooLong = session.instruction.length > MAX_INSTRUCTION_LENGTH;
  let authorized = true, writable = true;
  try { session.client.scope.assertCurrent(false); if (session.client.scope.authority === 'unknown') authorized = false; } catch { authorized = false; }
  try { session.client.scope.assertCurrent(true); } catch { writable = false; }
  let imageAuthorized = !!imageSession;
  if (imageSession) {
    try { imageSession.client.scope.assertCurrent(false); if (imageSession.client.scope.authority === 'unknown') imageAuthorized = false; } catch { imageAuthorized = false; }
    if (supplied && (imageSession.client.scope.actorId !== session.client.scope.actorId || imageSession.client.scope.projectId !== session.client.scope.projectId || imageSession.client.scope.key !== session.client.scope.key)) imageAuthorized = false;
  }
  const allowed = !closed && (imageSession ? imageAuthorized && (!supplied || authorized) : authorized);
  const recovery = sketchRecoveryMemory(session, session.client.scope);
  const [recoverBusy, setRecoverBusy] = useState(false);
  // List discovery is independent of the incumbent original-task controls.
  const [recoveringTask, setRecoveringTask] = useState(false);
  const [recoverError, setRecoverError] = useState('');
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const recoveryRead = useRef<{ stop: () => void } | undefined>(undefined);
  const recoveryOperation = useRef(0);
  const recoveryEnabled = recoverTasks && !initialTrace;
  if (recoveryEnabled) drawerRuntime(session);
  const imageRuntime = recoveryEnabled && imageSession ? drawerRuntime(imageSession) : undefined;
  const imageAdmissionInFlight = !!imageRuntime?.imageAdmissions;
  const rememberTask = (next: SketchTask | SketchImageTask, type: SketchRecoveryCandidate['type']): void => {
    if (!recoveryEnabled) return;
    recovery.known.set(next.taskId, { type, unresolved: sketchRecoveryActive(next.status)
      || !!next.needsReconcile || !!next.dispatchPending || ('recoveryPending' in next && !!next.recoveryPending) });
    repaint(value => value + 1);
  };
  // Known session tasks remain authoritative even when discovery omits them.
  for (const [known, type] of [[session.client.task, 'sketch-to-code'], [imageSession?.client.task, 'sketch-to-image']] as const) {
    if (known && recoveryEnabled) recovery.known.set(known.taskId, { type, unresolved: sketchRecoveryActive(known.status)
      || !!known.needsReconcile || !!known.dispatchPending || ('recoveryPending' in known && !!known.recoveryPending) });
  }
  const recoveryBlocked = recoveryEnabled && (recoverBusy || imageAdmissionInFlight || !recovery.checked || recovery.unresolved
    || (!!recovery.candidates.length && !recovery.decided)
    || recovery.candidates.some(candidate => sketchRecoveryActive(candidate.status) && recovery.known.get(candidate.id)?.unresolved !== false)
    || [...recovery.known.values()].some(known => known.unresolved)
    || session.client.admissionUnknown || !!imageSession?.client.admissionUnknown);
  const canGenerate = authorized && writable && !catalogStatus?.loading && !catalogStatus?.error && !!selected
    && !recoveryBlocked && allowed && mode === 'code' && session.history.present.strokes.length > 0 && !instructionTooLong && !busy && !active(task);
  const refresh = (): void => repaint(value => value + 1);
  const revoke = (): void => { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); blobUrl.current = ''; };
  const draw = (): void => {
    const context = canvas.current?.getContext('2d');
    if (context) paintSketch(context, draft.current ? { ...session.history.present, strokes: [...session.history.present.strokes, draft.current.stroke] } : session.history.present);
  };
  useEffect(() => { draw(); });
  useEffect(() => {
    live.current = true;
    busyRef.current = false;
    setTask(initialTrace ? undefined : session.client.task); setBusy(false); setMessage(''); setPreviewUrl(''); readPaused.current = false;
    const operationCounter = operation;
    return () => {
      live.current = false; operationCounter.current++;
      const restore = sourceRestore.current;
      if (restore?.session === session && restore.imageSession === imageSession && !restore.completed) restore.started = false;
      session.client.stop(); session.placement?.stop(); imageSession?.client.stop(); imageSession?.placement?.stop(); revoke(); draft.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, imageSession]);
  useEffect(() => { if (!allowed) { operation.current++; busyRef.current = false; session.client.stop(); session.placement?.stop(); imageSession?.client.stop(); imageSession?.placement?.stop(); revoke(); setPreviewUrl(''); setBusy(false); } }, [allowed, session, imageSession]);
  useEffect(() => { if (mode !== 'code') { operation.current++; busyRef.current = false; session.client.stop(); session.placement?.stop(); setBusy(false); } }, [mode, session]);
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busyRef.current || !live.current || !allowed || recoveringTask || mode !== 'code') return;
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
    rememberTask(next, 'sketch-to-code');
    if (next.status === 'completed' && insert && (recoveryEnabled || session.placement?.trace.taskId !== next.taskId)) {
      const placement = recoveryEnabled ? retainedPlacement(session, next, () => new SketchPlacement(next, session.client.scope, insert))
        : new SketchPlacement(next, session.client.scope, insert);
      if (session.placement !== placement) session.placement?.stop();
      session.placement = placement;
    }
  };
  const stopRecovery = (): void => { recoveryOperation.current++; recoveryRead.current?.stop(); recoveryRead.current = undefined; };
  const discover = async (): Promise<void> => {
    if (!recoveryEnabled || !allowed) return;
    stopRecovery();
    const token = recoveryOperation.current;
    const gate = new SketchImageReadGate(session.client.scope, fetch);
    recoveryRead.current = gate; recovery.checked = false; setRecoverBusy(true); setRecoverError('');
    try {
      const found = await discoverSketchTasks(gate, gate.scope);
      gate.assert(); if (!live.current || token !== recoveryOperation.current) return;
      // A later empty list cannot erase a previously discovered unresolved ID.
      const merged = new Map(recovery.candidates.map(candidate => [candidate.id, candidate]));
      for (const candidate of found) {
        const previous = merged.get(candidate.id);
        const known = recovery.known.get(candidate.id);
        if (previous && previous.type !== candidate.type || known && known.type !== candidate.type) throw new Error('原任务类型不一致，请重试读取。');
        if (sketchRecoveryActive(candidate.status) && !known) recovery.known.set(candidate.id, { type: candidate.type, unresolved: true });
        merged.set(candidate.id, candidate);
      }
      recovery.candidates = [...merged.values()]; recovery.checked = true;
    } catch (error) {
      if (live.current && token === recoveryOperation.current) setRecoverError(error instanceof Error ? error.message : '原任务列表读取失败，请重试。');
    } finally {
      if (live.current && token === recoveryOperation.current) { recoveryRead.current = undefined; setRecoverBusy(false); refresh(); }
    }
  };
  const recover = async (candidate: Pick<SketchRecoveryCandidate, 'id' | 'type'>): Promise<void> => {
    if (!allowed || recoverBusy || busyRef.current || imageRuntime?.imageAdmissions || session.client.admissionUnknown || imageSession?.client.admissionUnknown) return;
    if (candidate.type === 'sketch-to-image' && !imageSession) return;
    stopRecovery(); operation.current++; busyRef.current = false; setBusy(false);
    session.client.stop(); session.placement?.stop(); imageSession?.client.stop(); imageSession?.placement?.stop(); revoke(); setPreviewUrl('');
    recovery.selected = candidate; recovery.unresolved = true; setRecoverBusy(true); setRecoveringTask(true); setRecoverError('');
    setRecoveryVersion(value => value + 1);
    const token = recoveryOperation.current;
    const isImage = candidate.type === 'sketch-to-image';
    const current = isImage ? imageSession!.client : session.client;
    // Each explicit recovery choice gets an isolated reader. Never switch an
    // image client's guarded identity or attach discovery data to its input.
    const client = isImage ? new SketchImageClient(current.scope) : new SketchClient(current.scope);
    recoveryRead.current = client;
    setMode(isImage ? 'image' : 'code');
    try {
      const next = await client.poll(candidate.id);
      client.scope.assertCurrent(); if (!live.current || token !== recoveryOperation.current) return;
      if (isImage && imageSession && client instanceof SketchImageClient) {
        imageSession.client = client; imageSession.placement?.stop(); imageSession.placement = undefined;
        if (next.status === 'completed' && insert && !next.needsReconcile && !next.dispatchPending && !('recoveryPending' in next && next.recoveryPending)) {
          imageSession.placement = retainedPlacement(imageSession, next, () => new SketchImagePlacement(next as SketchImageTask, client.scope, insert));
        }
      } else if (client instanceof SketchClient) {
        session.client = client; session.placement?.stop(); session.placement = undefined; receive(next as SketchTask);
      }
      rememberTask(next, candidate.type); recovery.decided = true; recovery.unresolved = false;
      setRecoveryVersion(value => value + 1);
    } catch (error) {
      if (live.current && token === recoveryOperation.current) setRecoverError(error instanceof Error ? error.message : '原任务状态读取失败，请重试。');
    } finally {
      if (live.current && token === recoveryOperation.current) { recoveryRead.current = undefined; setRecoverBusy(false); setRecoveringTask(false); refresh(); }
    }
  };
  useEffect(() => {
    if (recoveryEnabled && allowed) void discover();
    else { stopRecovery(); setRecoverBusy(false); setRecoveringTask(false); }
    return stopRecovery;
    // Discovery is scoped to the drawer, not to model, mode or drawing edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryEnabled, allowed, session, imageSession, recovery]);
  useEffect(() => {
    if (!initialTrace) { sourceRestore.current = undefined; return; }
    const trace = parseWorkspaceSourceTrace(initialTrace);
    const key = JSON.stringify(trace ?? initialTrace);
    let restore = sourceRestore.current;
    if (!restore || restore.session !== session || restore.imageSession !== imageSession || restore.key !== key) {
      restore = { session, imageSession, key, started: false, completed: false }; sourceRestore.current = restore;
      setMode('code');
    }
    if (restore.started || mode !== 'code') return;
    if (trace?.source !== 'sketch-to-code' || trace.projectId !== session.client.scope.projectId) { restore.started = true; setMessage('来源提示不属于当前项目，不能打开代码'); return; }
    if (!allowed || !live.current || busyRef.current) return;
    restore.started = true;
    void run(async () => {
      receive(await session.client.poll(trace.taskId));
      if (sourceRestore.current === restore && live.current) restore.completed = true;
    });
    // Restore once per source/current session, after switching to code. Manual image selection stays available afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTrace, session, imageSession, mode, allowed, busy]);
  useEffect(() => {
    if (mode !== 'code' || !allowed || recoveringTask || !active(task) || task?.needsReconcile || task?.dispatchPending || busy || readPaused.current || !authorized) return;
    const timer = setTimeout(() => { void run(async () => receive(await session.client.poll(task!.taskId))); }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, busy, session, authorized, allowed, mode, recoveringTask]);
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
  const close = (): void => { stopRecovery(); live.current = false; operation.current++; busyRef.current = false; session.client.stop(); session.placement?.stop(); imageSession?.client.stop(); imageSession?.placement?.stop(); revoke(); setPreviewUrl(''); setClosed(true); cancelStroke(); onClose?.(); };
  const generation = async (reconcile: boolean): Promise<void> => {
    if (reconcile) { if (!session.client.input) return; receive(await session.client.start(session.client.input, true)); return; }
    if (!canGenerate || imageRuntime?.imageAdmissions || !selected) return;
    const input = { projectId: session.client.scope.projectId, imageDataUrl: exportSketchPng(session.history.present),
      instruction: session.instruction, providerId: selected.providerId, modelId: selected.modelId, idempotencyKey: crypto.randomUUID() };
    setTask(undefined); session.placement?.stop(); session.placement = undefined;
    revoke(); setPreviewUrl('');
    receive(await session.client.start(input));
  };
  const stage = task?.needsReconcile || task?.dispatchPending ? '派发待核对'
    : task?.status === 'completed' ? '已完成' : task?.status === 'cancelled' ? '已取消（服务端确认）' : task?.status === 'failed' ? '失败，草图已保留' : task?.status === 'timeout' ? '任务超时，草图已保留'
    : task?.phase === 'analysis' ? '分析中' : task?.phase === 'reconstruction' ? '重建中' : task ? '等待处理' : recoveryBlocked ? '原任务待核对' : '尚未提交';
  return <section aria-label={imageSession ? '草图创作' : '草图转代码'} role="region" data-modal="sketch-to-code" tabIndex={-1}
    className={`absolute inset-x-2 bottom-20 z-[80] max-h-[82dvh] overflow-y-auto overscroll-contain rounded-xl p-4 shadow-[0_12px_32px_rgba(0,0,0,0.3)] md:inset-x-8 ${isMonochrome ? 'bg-white text-gray-900' : 'bg-[#1a1a1a] text-gray-100'}`}
    onWheel={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); updateHistory(event.shiftKey ? redoSketch(session.history) : undoSketch(session.history)); }
    }}>
    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{imageSession ? '草图创作' : '草图转代码'}</h2>
      <button className={control} aria-label={imageSession ? '关闭草图创作' : '关闭草图转代码'} onClick={close}><X className="h-4 w-4" /></button></div>
    {imageSession && <div role="group" aria-label="创作模式" className="mb-3 flex flex-wrap gap-2">{(['image', 'code'] as const).map(value => <button key={value} className={`${control} ${mode === value ? isMonochrome ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-[#d4af37] text-black hover:bg-[#e2c45e]' : ''}`} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'image' ? '草图生图' : '草图转代码'}</button>)}</div>}
    <p className="mb-3 text-sm">{mode === 'image' ? '画出构图，输入创作关键词，选择视觉分析与图像模型。生成图不会替换原始草图。' : '画出页面结构，生成安全静态 HTML。画布卡片是原始草图 PNG，不是页面截图。'}关闭仅停止读取，不取消任务。</p>
    {session.client.scope.authority === 'document' && <p role="note" className="mb-3 text-sm">{mode === 'image' ? '协作文档暂不能放置生成图像，仍可受权预览和下载。' : DOCUMENT_PLACEMENT_REASON}</p>}
    {!allowed && <p role="alert" className="mb-3 text-sm">当前项目授权未知或已失效，请恢复项目后操作。</p>}
    {recoveryEnabled && <section aria-label="恢复原草图任务" className="mb-3 min-w-0 space-y-2 rounded-md border border-current/20 p-3 text-sm break-words">
      <h3 className="font-medium">恢复原草图任务</h3>
      <p role="status">{recoverBusy ? '正在读取原任务，请稍候…' : !recovery.checked ? '原任务列表尚未确认，请重试读取。'
        : !recovery.candidates.length ? '当前项目未发现可恢复的草图任务。' : '请选择确切任务核对状态；读取不会重新提交或扣费。'}</p>
      {recoverError && <p role="alert">{recoverError}</p>}
      <div className="flex min-w-0 flex-wrap gap-2">
        {recovery.candidates.map(candidate => <button key={candidate.id} className={`${control} max-w-full whitespace-normal break-all text-left`}
          disabled={!allowed || recoverBusy || busy || imageAdmissionInFlight || session.client.admissionUnknown || !!imageSession?.client.admissionUnknown || (candidate.type === 'sketch-to-image' && !imageSession)}
          aria-pressed={recovery.selected?.id === candidate.id} onClick={() => { void recover(candidate); }}>
          {candidate.type === 'sketch-to-image' ? '草图生图' : '草图转代码'} · {candidate.id} · {candidate.status} · {new Date(candidate.createdAt).toLocaleString('zh-CN')}
        </button>)}
        {[...recovery.known].filter(([id]) => !recovery.candidates.some(candidate => candidate.id === id)).map(([id, known]) => <button
          key={id} className={`${control} max-w-full whitespace-normal break-all text-left`}
          disabled={!allowed || recoverBusy || busy || imageAdmissionInFlight || session.client.admissionUnknown || !!imageSession?.client.admissionUnknown || (known.type === 'sketch-to-image' && !imageSession)}
          aria-pressed={recovery.selected?.id === id} onClick={() => { void recover({ id, type: known.type }); }}>
          核对会话原任务 · {id}
        </button>)}
      </div>
      {recoveryBlocked && <p>原任务尚待核对，暂不能新生成；其他活动任务也需逐一核对。取消和退款以服务端确认为准。</p>}
      <div className="flex flex-wrap gap-2">
        <button className={control} disabled={!allowed || recoverBusy} onClick={() => { void discover(); }}>重试读取原任务列表</button>
        {recovery.selected && <button className={control} disabled={!allowed || recoverBusy || busy || imageAdmissionInFlight || session.client.admissionUnknown || !!imageSession?.client.admissionUnknown} onClick={() => { if (recovery.selected) void recover(recovery.selected); }}>重试核对原任务 {recovery.selected.id}</button>}
      </div>
    </section>}
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
      <div className="min-w-0">
      {imageSession && <ImageModeControls key={recoveryVersion} session={imageSession} history={session.history} models={models} catalogStatus={catalogStatus} insert={insert} visible={mode === 'image'} allowed={allowed && !recoveringTask} control={control} isMonochrome={isMonochrome} recoveryBlocked={recoveryBlocked} onTask={next => rememberTask(next, 'sketch-to-image')} recoverTasks={recoveryEnabled} onAdmissionChange={() => { if (live.current) refresh(); }} />}
      <div hidden={mode !== 'code'} className="min-w-0 space-y-3">
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
        {session.client.admissionUnknown && <><p role="status">受理结果未知，未确认取消或退款。请核对原提交，勿重复扣费提交。</p><button className={control} disabled={busy || !allowed || recoveringTask} onClick={() => { void run(() => generation(true)); }}>核对原提交（相同标识）</button></>}
        <div aria-live="polite" className="space-y-2 break-words text-sm">
          <p>{busy ? '正在核对服务结果…' : stage}{task ? ` · ${task.progress}%` : ''}</p>
          {task && <><p>预留额度：{task.reserveCredits}；实际净费：{task.actualCredits ?? '尚未确认'}</p>
            <p>退款状态：{task.refunded === true ? '服务端确认已退还预留额度' : task.status === 'completed' ? '净费以实际金额为准，返差额不等于全额退款' : '未确认全额退款'}</p>
            <p>任务：{task.taskId}{task.requestId ? ` · 请求：${task.requestId}` : ''}</p>
            <button className={control} disabled={busy || !allowed || recoveringTask} onClick={() => { void run(async () => receive(await session.client.poll(task.taskId))); }}>核对任务状态</button>
            {active(task) && <button className={control} disabled={busy || !allowed || recoveringTask} onClick={() => { void run(async () => { session.client.stop(); receive(await session.client.cancel(task.taskId)); }); }}>取消任务（等待确认）</button>}
            {task.error && <p role="alert">{task.error}</p>}</>}
          {message && <p role="alert">{message}</p>}
        </div>
        {task?.status === 'completed' && <div className="space-y-2">
          <p className="whitespace-pre-wrap break-words text-sm">{task.analysis}</p>
          <div className="flex flex-wrap gap-2">
            <button className={control} disabled={busy || !allowed} onClick={() => { void run(() => readCode(false)); }}>打开代码预览</button>
            <button className={control} disabled={busy || !allowed} onClick={() => { void run(() => readCode(true)); }}>下载HTML</button>
            <button className={control} disabled={busy || !allowed || !writable || session.client.scope.authority !== 'legacy' || !session.placement}
              title={session.client.scope.authority === 'document' ? DOCUMENT_PLACEMENT_REASON : undefined}
              onClick={() => { void run(async () => { await session.placement?.add(); if (live.current) setMessage('原始草图PNG已放置，代码仍需当前授权读取'); }); }}>添加到画布</button>
          </div>
          {allowed && previewUrl && <iframe title="安全静态代码预览" sandbox={SKETCH_DOCUMENT_SANDBOX} src={previewUrl} className="h-72 w-full rounded bg-white" />}
        </div>}
      </div>
      </div>
    </div>
  </section>;
}
