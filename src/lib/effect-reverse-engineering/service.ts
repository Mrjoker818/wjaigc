import { createHash, randomUUID } from 'node:crypto';

import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

import { warpPerspectiveRgba } from './perspective';
import type {
  EffectReverseSessionInput,
  EffectReverseTaskRecord,
  EffectReverseTaskResult,
} from './types';
import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';
import { saveImageFile } from '@/lib/server-data-root';
import {
  cancelTask,
  getTaskInfo,
  isTaskCancelled,
  registerTask,
  registerTaskAbortController,
  unregisterTaskAbortController,
  updateTaskProgress,
} from '@/lib/task-registry';

export type EffectReverseAction =
  | 'correct'
  | 'export-png'
  | 'export-svg'
  | 'export-pdf'
  | 'export-zip';

interface EffectReverseInternalRecord {
  userId: string;
  action: EffectReverseAction;
  request: EffectReverseSessionInput;
  createdAt: number;
  sourceHash?: string;
  sourceMimeType?: string;
}

const records = new Map<string, EffectReverseInternalRecord>();
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

export class EffectReverseServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'EffectReverseServiceError';
  }
}

function mapRecord(taskId: string): EffectReverseTaskRecord {
  const task = getTaskInfo(taskId);
  const record = records.get(taskId);
  if (!task || !record) {
    throw new EffectReverseServiceError(
      'EFFECT_REVERSE_TASK_NOT_FOUND',
      'Reverse engineering task was not found',
      404,
    );
  }
  const status = task.status === 'pending' || task.status === 'processing'
    ? (task.label?.toLowerCase().includes('export') ? 'exporting'
      : task.label?.toLowerCase().includes('correct') ? 'correcting'
        : 'analyzing')
    : task.status;
  return {
    taskId,
    userId: record.userId,
    status,
    progress: task.progress,
    label: task.label || 'Effect Reverse Engineering',
    createdAt: record.createdAt,
    updatedAt: task.updatedAt,
    result: task.result as EffectReverseTaskResult | undefined,
    error: task.error,
  };
}

function assertTaskAccess(input: { taskId: string; userId: string; userRole: string }): EffectReverseInternalRecord {
  const record = records.get(input.taskId);
  if (!record || !getTaskInfo(input.taskId)) {
    throw new EffectReverseServiceError(
      'EFFECT_REVERSE_TASK_NOT_FOUND',
      'Reverse engineering task was not found',
      404,
    );
  }
  if (record.userId !== input.userId && input.userRole !== 'admin') {
    throw new EffectReverseServiceError(
      'EFFECT_REVERSE_TASK_FORBIDDEN',
      'Reverse engineering task belongs to another user',
      403,
    );
  }
  return record;
}

function assertActive(taskId: string, signal: AbortSignal): void {
  signal.throwIfAborted();
  const task = getTaskInfo(taskId);
  if (!task || isTaskCancelled(taskId) || task.status === 'cancelled') {
    throw new EffectReverseServiceError(
      'EFFECT_REVERSE_CANCELLED',
      'Reverse engineering task was cancelled',
      409,
    );
  }
  if (task.status === 'failed' || task.status === 'completed') {
    throw new EffectReverseServiceError(
      'EFFECT_REVERSE_TERMINAL_STATE',
      'Reverse engineering task is already terminal',
      409,
    );
  }
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function svgOverlay(request: EffectReverseSessionInput, correctedPng: Buffer, width: number, height: number): string {
  const source = `data:image/png;base64,${correctedPng.toString('base64')}`;
  const regions = request.regions
    .filter((region) => region.visible)
    .map((region) => {
      const points = region.points.map((point) => `${point.x * width},${point.y * height}`).join(' ');
      return `<g data-region-id="${xml(region.id)}"><polygon points="${points}" fill="none" stroke="#d4af37" stroke-width="2"/><title>${xml(region.label)}</title></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${source}" width="${width}" height="${height}"/>${regions}</svg>`;
}

async function pdfExport(
  request: EffectReverseSessionInput,
  sourceBuffer: Buffer,
  correctedPng: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const images = [
    { label: 'Frozen source', bytes: sourceBuffer },
    { label: 'Perspective corrected result', bytes: correctedPng },
  ];
  for (const item of images) {
    let embedded;
    try {
      embedded = await document.embedPng(item.bytes);
    } catch {
      embedded = await document.embedJpg(item.bytes);
    }
    const page = document.addPage([842, 595]);
    const scale = Math.min(780 / width, 500 / height);
    page.drawText(item.label, { x: 32, y: 560, size: 14, font, color: rgb(0.12, 0.12, 0.12) });
    page.drawImage(embedded, {
      x: 32,
      y: 32,
      width: width * scale,
      height: height * scale,
    });
  }
  const notes = document.addPage([595, 842]);
  notes.drawText('Effect Reverse Engineering Session', { x: 40, y: 790, size: 18, font });
  notes.drawText(`Regions: ${request.regions.length}`, { x: 40, y: 755, size: 11, font });
  notes.drawText('Manual and inferred regions require human verification before production use.', {
    x: 40,
    y: 730,
    size: 10,
    font,
    color: rgb(0.6, 0.2, 0.1),
  });
  return Buffer.from(await document.save());
}

async function createExports(input: {
  action: EffectReverseAction;
  request: EffectReverseSessionInput;
  sourcePng: Buffer;
  correctedPng: Buffer;
  width: number;
  height: number;
  sourceHash: string;
  taskId: string;
  signal: AbortSignal;
}): Promise<EffectReverseTaskResult> {
  const filenameBase = `${input.taskId}-${Date.now()}`;
  const correctedImageUrl = saveImageFile(
    input.correctedPng,
    `${filenameBase}.png`,
    'effect-reverse',
  );
  if (input.action === 'correct' || input.action === 'export-png') {
    return { correctedImageUrl, exportUrl: correctedImageUrl, regions: input.request.regions };
  }

  input.signal.throwIfAborted();
  const svg = svgOverlay(input.request, input.correctedPng, input.width, input.height);
  if (input.action === 'export-svg') {
    const exportUrl = saveImageFile(Buffer.from(svg), `${filenameBase}.svg`, 'effect-reverse');
    return { correctedImageUrl, exportUrl, regions: input.request.regions };
  }

  const pdf = await pdfExport(
    input.request,
    input.sourcePng,
    input.correctedPng,
    input.width,
    input.height,
  );
  input.signal.throwIfAborted();
  if (input.action === 'export-pdf') {
    const exportUrl = saveImageFile(pdf, `${filenameBase}.pdf`, 'effect-reverse');
    return { correctedImageUrl, exportUrl, regions: input.request.regions };
  }

  if (input.action === 'export-zip') {
    const zip = new JSZip();
    zip.file('corrected.png', input.correctedPng);
    zip.file('regions.svg', svg);
    zip.file('report.pdf', pdf);
    zip.file('session.json', JSON.stringify({
      ...input.request,
      sourceHash: input.sourceHash,
      exportedAt: new Date().toISOString(),
    }, null, 2));
    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    input.signal.throwIfAborted();
    const exportUrl = saveImageFile(archive, `${filenameBase}.zip`, 'effect-reverse');
    return { correctedImageUrl, exportUrl, regions: input.request.regions };
  }

  throw new EffectReverseServiceError(
    'EFFECT_REVERSE_EXPORT_UNAVAILABLE',
    'Requested export is unavailable for this session',
    422,
  );
}

async function executeTask(
  taskId: string,
  record: EffectReverseInternalRecord,
  controller: AbortController,
): Promise<void> {
  try {
    assertActive(taskId, controller.signal);
    updateTaskProgress(taskId, { status: 'processing', progress: 5, label: 'Freezing source image' });
    const source = await loadSafeImageInput(record.request.imageUrl, {
      maxBytes: MAX_IMAGE_BYTES,
      maxPixels: MAX_IMAGE_PIXELS,
      signal: controller.signal,
    });
    const metadata = await safeSharp(source.buffer, {
      maxPixels: MAX_IMAGE_PIXELS,
      signal: controller.signal,
    }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new EffectReverseServiceError(
        'EFFECT_REVERSE_SOURCE_INVALID',
        'Source image dimensions are unavailable',
        422,
      );
    }
    record.sourceHash = createHash('sha256').update(source.buffer).digest('hex');
    record.sourceMimeType = source.mimeType;

    assertActive(taskId, controller.signal);
    updateTaskProgress(taskId, { status: 'processing', progress: 35, label: 'Correcting perspective' });
    const decoded = await safeSharp(source.buffer, {
      maxPixels: MAX_IMAGE_PIXELS,
      signal: controller.signal,
    }).ensureAlpha().raw().toBuffer();
    const sourcePng = await sharp(decoded, {
      raw: { width: metadata.width, height: metadata.height, channels: 4 },
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'error',
    }).png().toBuffer();
    const warped = warpPerspectiveRgba(
      decoded,
      metadata.width,
      metadata.height,
      record.request.perspective,
      metadata.width,
      metadata.height,
    );
    const correctedPng = await sharp(warped, {
      raw: { width: metadata.width, height: metadata.height, channels: 4 },
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'error',
    }).png().toBuffer();

    assertActive(taskId, controller.signal);
    updateTaskProgress(taskId, { status: 'processing', progress: 75, label: 'Exporting result' });
    const result = await createExports({
      action: record.action,
      request: record.request,
      sourcePng,
      correctedPng,
      width: metadata.width,
      height: metadata.height,
      sourceHash: record.sourceHash,
      taskId,
      signal: controller.signal,
    });

    assertActive(taskId, controller.signal);
    updateTaskProgress(taskId, {
      status: 'completed',
      progress: 100,
      label: 'Completed',
      result,
    });
  } catch (error) {
    const task = getTaskInfo(taskId);
    if (controller.signal.aborted || isTaskCancelled(taskId) || task?.status === 'cancelled') return;
    const message = error instanceof Error ? error.message : 'Reverse engineering task failed';
    updateTaskProgress(taskId, {
      status: 'failed',
      label: 'Failed',
      error: message,
    });
  } finally {
    unregisterTaskAbortController(taskId, controller);
  }
}

export async function submitEffectReverseTask(input: {
  userId: string;
  action: EffectReverseAction;
  request: EffectReverseSessionInput;
}): Promise<{ taskId: string; status: 'queued' }> {
  const taskId = `effect-reverse-${randomUUID()}`;
  const record: EffectReverseInternalRecord = {
    userId: input.userId,
    action: input.action,
    request: structuredClone(input.request),
    createdAt: Date.now(),
  };
  records.set(taskId, record);
  registerTask(taskId, 'display-decompose', 'Effect Reverse Engineering', input.userId);
  const controller = new AbortController();
  registerTaskAbortController(taskId, controller);
  void executeTask(taskId, record, controller);
  return { taskId, status: 'queued' };
}

export async function getEffectReverseTask(input: {
  taskId: string;
  userId: string;
  userRole: string;
}): Promise<EffectReverseTaskRecord> {
  assertTaskAccess(input);
  return mapRecord(input.taskId);
}

export async function cancelEffectReverseTask(input: {
  taskId: string;
  userId: string;
  userRole: string;
}): Promise<EffectReverseTaskRecord> {
  assertTaskAccess(input);
  cancelTask(input.taskId);
  const task = getTaskInfo(input.taskId);
  updateTaskProgress(input.taskId, {
    status: 'cancelled',
    progress: task?.progress ?? 0,
    label: 'Cancelled',
  });
  return mapRecord(input.taskId);
}
