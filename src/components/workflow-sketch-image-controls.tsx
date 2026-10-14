'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import Image from 'next/image';
import { parseWorkflowSketchImageReference, type WorkflowSketchImageReference } from '@/lib/workflow-engine';
import type { SketchScope } from '@/lib/sketch-to-code/client';
import type { SketchInsert } from '@/lib/sketch-to-code/placement-client';
import { SketchImageClient, type SketchImageTask } from '@/lib/sketch-to-code/image-client';
import { SketchImagePlacement } from '@/lib/sketch-to-code/image-placement-client';

export interface WorkflowSketchImageControlsProps {
  scope: SketchScope;
  reference: WorkflowSketchImageReference | null;
  status: string;
  error?: string;
  phase?: unknown;
  progress?: unknown;
  insert?: SketchInsert;
  reserveCredits?: unknown;
  actualCredits?: unknown;
  refunded?: unknown;
  needsReconcile?: unknown;
}

const REFERENCE_FIELDS = ['taskId', 'projectId', 'visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId',
  'previewAssetId', 'previewAssetVersionId', 'imageAssetId', 'imageAssetVersionId'] as const;
const READ_ERROR = '当前生成图读取未确认或授权已失效，请在当前项目核对原任务。';
function matches(task: SketchImageTask | undefined, reference: WorkflowSketchImageReference): boolean {
  return !!task && task.status === 'completed' && !task.needsReconcile && !task.dispatchPending && !task.recoveryPending
    && REFERENCE_FIELDS.every(field => task[field] === reference[field]);
}
function credits(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function WorkflowSketchImageControls({ scope, reference: incomingReference, status, phase, progress, insert,
  reserveCredits, actualCredits, refunded, needsReconcile }: WorkflowSketchImageControlsProps): ReactElement {
  const reference = parseWorkflowSketchImageReference(incomingReference);
  const binding = JSON.stringify(reference);
  const { key, actorId, projectId, authority } = scope;
  const session = useMemo(() => ({ client: new SketchImageClient(scope), binding,
    snapshot: { key, actorId, projectId, authority } }), [scope, key, actorId, projectId, authority, binding]);
  const client = session.client;
  const placement = useRef<SketchImagePlacement | null>(null);
  const latestInsert = useRef(insert);
  latestInsert.current = insert;
  const lifecycle = useRef(0), busyRef = useRef(false), urlRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [readError, setReadError] = useState('');
  let authorized = scope.authority !== 'unknown';
  try { scope.assertCurrent(); } catch { authorized = false; }
  const readable = authorized && status === 'success' && !!reference && reference.projectId === scope.projectId && needsReconcile !== true;
  const clearPreview = useCallback((): void => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null; setPreview(null);
  }, []);
  useEffect(() => {
    lifecycle.current += 1; placement.current = null; busyRef.current = false;
    clearPreview(); setBusy(false); setReadError(authorized ? '' : READ_ERROR);
    return (): void => {
      lifecycle.current += 1; busyRef.current = false; client.stop(); placement.current?.stop();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [client, binding, status, authorized, needsReconcile, clearPreview]);
  const close = (): void => {
    lifecycle.current++; client.stop(); placement.current?.stop(); busyRef.current = false;
    clearPreview(); setBusy(false);
  };
  const perform = async (action: 'preview' | 'download' | 'place'): Promise<void> => {
    if (busyRef.current || !readable || !reference) return;
    const epoch = ++lifecycle.current;
    const assert = (write = false): void => {
      scope.assertCurrent(write);
      if (epoch !== lifecycle.current || scope.authority === 'unknown'
        || (['key', 'actorId', 'projectId', 'authority'] as const).some(field => scope[field] !== session.snapshot[field])) throw new Error(READ_ERROR);
    };
    busyRef.current = true; setBusy(true); setReadError(''); clearPreview();
    try {
      assert(); const task = await client.poll(reference.taskId); assert();
      if (!matches(task, reference)) throw new Error(READ_ERROR);
      if (action === 'place') {
        assert(true);
        if (!insert || scope.authority !== 'legacy') throw new Error(READ_ERROR);
        placement.current ||= new SketchImagePlacement(task, scope, async (placed, transform): Promise<void> => {
          // The placement owns scope/readback fencing. Callback replacement is
          // not a new result lifecycle; dispatch to the current canvas sink.
          scope.assertCurrent(true);
          const currentInsert = latestInsert.current;
          if (!currentInsert) throw new Error(READ_ERROR);
          await currentInsert(placed, transform);
          scope.assertCurrent(true);
        });
        await placement.current.add(); assert(true);
      } else {
        const blob = await client.image(reference.taskId); assert();
        // image() performs another protected poll; compare its fresh identity too.
        if (!matches(client.task, reference)) throw new Error(READ_ERROR);
        const extensions: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
        const extension = extensions[blob.type];
        if (!extension) throw new Error(READ_ERROR);
        const url = URL.createObjectURL(blob);
        try {
          assert();
          if (action === 'download') {
            const anchor = document.createElement('a'); anchor.href = url;
            anchor.download = `sketch-image-${reference.taskId}.${extension}`; anchor.click();
          } else { urlRef.current = url; setPreview(url); }
        } finally { if (urlRef.current !== url) URL.revokeObjectURL(url); }
      }
    } catch {
      if (epoch === lifecycle.current) {
        client.stop(); placement.current?.stop(); clearPreview(); setReadError(READ_ERROR);
      }
    } finally {
      if (epoch === lifecycle.current) { busyRef.current = false; setBusy(false); }
    }
  };
  const placementReason = scope.authority === 'document' ? '协作文档暂不能放置生成图；仍可在当前授权下预览和下载。'
    : !authorized ? '项目授权不可用，请先核对当前项目。' : !insert ? '当前画布落点不可用。' : '';
  const phaseLabel = phase === 'analysis' ? '正在分析草图' : phase === 'generation' ? '正在生成图片' : '草图生图处理中';
  const progressLabel = typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100 ? ` · ${progress}%` : '';
  const buttonClass = 'rounded border border-border px-2 py-1.5 hover:bg-muted focus-visible:outline-primary disabled:opacity-50';
  return <div className="min-w-0 space-y-2 px-4 py-3 text-xs break-words">
    <p className="text-muted-foreground">生成图按当前项目授权读取，添加后保留原始草图。</p>
    {status === 'running' && <p role="status" className="text-muted-foreground">{phaseLabel}{progressLabel}</p>}
    {(status === 'failed' || status === 'cancelled' || status === 'timeout') && <p role="alert" className="text-destructive">草图生图任务已停止，请核对原任务；费用以服务端终态为准。</p>}
    {needsReconcile === true && <p role="status" className="text-muted-foreground">结果待核对，请核对原任务后再读取。</p>}
    {(credits(reserveCredits) || credits(actualCredits)) && <p className="text-muted-foreground tabular-nums">
      {credits(reserveCredits) && `预留 ${reserveCredits} 积分`}{credits(reserveCredits) && credits(actualCredits) && ' · '}
      {credits(actualCredits) && `净费 ${actualCredits} 积分`}{refunded === true && ' · 已返差，净费以服务端为准'}
    </p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={!readable || busy} onClick={() => void perform('preview')} className={buttonClass}>预览生成图</button>
      <button disabled={!readable || busy} onClick={() => void perform('download')} className={buttonClass}>下载生成图</button>
      <button disabled={!readable || busy || !!placementReason} title={placementReason} onClick={() => void perform('place')} className={buttonClass}>添加生成图到画布</button>
    </div>
    {placementReason && <p className="text-muted-foreground">{placementReason}</p>}
    {busy && <p role="status">正在核对当前授权…</p>}
    {readError && <p role="alert" className="text-destructive">{readError}</p>}
    {(preview || busy) && <button onClick={close} className={buttonClass}>关闭生成图预览</button>}
    {preview && <Image unoptimized width={1} height={1} src={preview} alt="草图生成图预览" className="h-auto max-h-64 w-full rounded object-contain" />}
  </div>;
}
