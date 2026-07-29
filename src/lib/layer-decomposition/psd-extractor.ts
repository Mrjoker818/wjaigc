import {
  ImageData as NapiImageData,
  createCanvas as createNapiCanvas,
} from '@napi-rs/canvas';
import { initializeCanvas, readPsd } from 'ag-psd';
import type { Layer } from 'ag-psd';
import sharp from 'sharp';

import type {
  EditableLayerAsset,
  EditableLayerRole,
} from '@/lib/layer-decomposition/types';
import { withLayerPsdMemorySlot } from '@/lib/layer-decomposition/memory-gate';
import { saveImageFile } from '@/lib/server-data-root';

const MAX_PSD_BYTES = 128 * 1024 * 1024;
const MAX_DIMENSION = 8_192;
const MAX_DOCUMENT_PIXELS = 67_108_864;
const MAX_LAYER_COUNT = 64;
const MAX_GROUP_DEPTH = 16;
const MAX_AGGREGATE_LAYER_PIXELS = 256_000_000;

let canvasInitialized = false;

function ensureCanvasInitialized(): void {
  if (canvasInitialized) return;
  initializeCanvas(
    createNapiCanvas as unknown as (width: number, height: number) => HTMLCanvasElement,
    (width: number, height: number) => (
      new NapiImageData(width, height) as unknown as ImageData
    ),
  );
  canvasInitialized = true;
}

export class PsdExtractionError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PsdExtractionError';
    this.code = code;
  }
}

export interface ExtractPsdOptions {
  taskId?: string;
  signal?: AbortSignal;
  persistLayer?: (buffer: Buffer, filename: string) => string | Promise<string>;
}

export interface ExtractedPsdLayers {
  width: number;
  height: number;
  layers: EditableLayerAsset[];
  warnings: string[];
}

function validatePsdHeader(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 26 || buffer.subarray(0, 4).toString('ascii') !== '8BPS') {
    throw new PsdExtractionError('PSD_SIGNATURE_INVALID', 'PSD signature is invalid');
  }
  if (buffer.length > MAX_PSD_BYTES) {
    throw new PsdExtractionError('PSD_FILE_TOO_LARGE', 'PSD file exceeds 128 MiB');
  }
  const version = buffer.readUInt16BE(4);
  if (version !== 1) {
    throw new PsdExtractionError('PSD_VERSION_UNSUPPORTED', 'Only standard PSD version 1 is supported');
  }
  if (buffer.readUInt16BE(22) !== 8) {
    throw new PsdExtractionError('PSD_BIT_DEPTH_UNSUPPORTED', 'Only 8-bit PSD documents are supported');
  }
  const height = buffer.readUInt32BE(14);
  const width = buffer.readUInt32BE(18);
  if (
    width <= 0
    || height <= 0
    || width > MAX_DIMENSION
    || height > MAX_DIMENSION
    || width * height > MAX_DOCUMENT_PIXELS
  ) {
    throw new PsdExtractionError(
      'PSD_PIXEL_LIMIT',
      'PSD dimensions or decoded pixel count exceed the safety limit',
    );
  }
  return { width, height };
}

function inferRole(name: string): EditableLayerRole {
  const value = name.toLowerCase();
  if (/背景|background|\bbg\b/.test(value)) return 'background';
  if (/主体|人物|产品|subject|person|product|object/.test(value)) return 'subject';
  if (/文字|文本|标题|text|title|caption/.test(value)) return 'text';
  if (/阴影|shadow/.test(value)) return 'shadow';
  if (/装饰|图案|点缀|decoration|ornament|deco/.test(value)) return 'decoration';
  return 'unknown';
}

function hasVisiblePixels(data: ArrayLike<number>): boolean {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) return true;
  }
  return false;
}

function normalizeOpacity(value: number | undefined): number {
  const opacity = value ?? 1;
  const normalized = opacity <= 1 ? opacity : opacity / 255;
  return Math.round(Math.min(1, Math.max(0, normalized)) * 100) / 100;
}

function safeTaskName(taskId: string | undefined): string {
  return (taskId || 'layer').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

async function extractEditableLayersWithoutGate(
  buffer: Buffer,
  options: ExtractPsdOptions = {},
): Promise<ExtractedPsdLayers> {
  const header = validatePsdHeader(buffer);
  let psd: ReturnType<typeof readPsd>;
  try {
    ensureCanvasInitialized();
    psd = readPsd(buffer, {
      useImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      throwForMissingFeatures: false,
      logMissingFeatures: false,
    });
  } catch (error) {
    throw new PsdExtractionError(
      'PSD_DECODE_FAILED',
      'PSD could not be decoded safely',
      { cause: error },
    );
  }

  if (psd.width !== header.width || psd.height !== header.height) {
    throw new PsdExtractionError('PSD_DIMENSION_MISMATCH', 'PSD decoded dimensions do not match its header');
  }

  const layers: EditableLayerAsset[] = [];
  const warnings: string[] = [];
  const persistLayer = options.persistLayer || ((png: Buffer, filename: string) => (
    saveImageFile(png, filename, 'layer-decomposition')
  ));
  let groupIndex = 0;
  let layerIndex = 0;
  let aggregatePixels = 0;

  const walk = async (
    children: Layer[] | undefined,
    parentId: string | undefined,
    depth: number,
  ): Promise<void> => {
    if (!children?.length) return;
    if (depth > MAX_GROUP_DEPTH) {
      throw new PsdExtractionError('PSD_GROUP_DEPTH_LIMIT', 'PSD group depth exceeds the safety limit');
    }

    for (const layer of children) {
      if (layer.children) {
        groupIndex += 1;
        await walk(layer.children, `group-${groupIndex}`, depth + 1);
        continue;
      }
      if (!layer.imageData) {
        warnings.push(`Skipped layer without raster pixels: ${layer.name || 'unnamed'}`);
        continue;
      }
      layerIndex += 1;
      if (layerIndex > MAX_LAYER_COUNT) {
        throw new PsdExtractionError('PSD_LAYER_LIMIT', 'PSD decoded layer count exceeds the safety limit');
      }

      const width = layer.imageData.width;
      const height = layer.imageData.height;
      const pixelData = layer.imageData.data;
      if (
        width <= 0
        || height <= 0
        || width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || !(pixelData instanceof Uint8Array || pixelData instanceof Uint8ClampedArray)
        || pixelData.length !== width * height * 4
      ) {
        throw new PsdExtractionError('PSD_LAYER_PIXEL_INVALID', 'PSD layer pixel data is invalid');
      }
      aggregatePixels += width * height;
      if (aggregatePixels > MAX_AGGREGATE_LAYER_PIXELS) {
        throw new PsdExtractionError('PSD_AGGREGATE_PIXEL_LIMIT', 'PSD aggregate layer pixels exceed the safety limit');
      }
      if (!hasVisiblePixels(pixelData)) {
        warnings.push(`Skipped empty layer: ${layer.name || 'unnamed'}`);
        continue;
      }

      const raw = Buffer.from(
        pixelData.buffer,
        pixelData.byteOffset,
        pixelData.byteLength,
      );
      const png = await sharp(raw, {
        raw: { width, height, channels: 4 },
        limitInputPixels: MAX_DOCUMENT_PIXELS,
      }).png().toBuffer();
      const id = `layer-${layerIndex}`;
      const filename = `${safeTaskName(options.taskId)}_${id}.png`;
      const imageUrl = await persistLayer(png, filename);
      const metadata = layer as Layer & Record<string, unknown>;
      const qualityWarnings = (
        metadata.effects || metadata.placedLayer || metadata.smartObject
      ) ? ['Unsupported PSD effects or smart content were rasterized'] : undefined;

      layers.push({
        id,
        ...(parentId ? { parentId } : {}),
        name: layer.name?.trim() || `图层 ${layerIndex}`,
        role: inferRole(layer.name || ''),
        imageUrl,
        width,
        height,
        offsetX: layer.left ?? 0,
        offsetY: layer.top ?? 0,
        opacity: normalizeOpacity(layer.opacity),
        blendMode: layer.blendMode || 'normal',
        visible: layer.hidden !== true,
        source: 'pear-psd',
        ...(qualityWarnings ? { qualityWarnings } : {}),
      });
    }
  };

  await walk(psd.children, undefined, 1);
  if (layers.length === 0) {
    throw new PsdExtractionError('PSD_NO_EDITABLE_LAYERS', 'PSD contains no editable pixel layers');
  }
  return { width: psd.width, height: psd.height, layers, warnings };
}

export async function extractEditableLayersFromPsd(
  buffer: Buffer,
  options: ExtractPsdOptions = {},
): Promise<ExtractedPsdLayers> {
  return withLayerPsdMemorySlot(options.signal, () => (
    extractEditableLayersWithoutGate(buffer, options)
  ));
}
