/**
 * PSD 导出 API 封装
 * 将 psd-export.ts 的功能封装为异步 API，支持进度回调
 */

import type {
  PsdDocument,
  PsdExportMode,
  PsdExportProgress,
  PsdLayerItem,
} from '@/types/psdLayer';
import { exportAsPSD, type PSDExportMode as InternalMode } from '@/lib/psd-export';

/** 将前端模式映射为内部模式 */
function mapExportMode(mode: PsdExportMode): InternalMode {
  const map: Record<PsdExportMode, InternalMode> = {
    basic: 'basic',
    standard: 'pro',
    advanced: 'pro',
    studio: 'studio',
  };
  return map[mode] ?? 'pro';
}

/** 创建空 PSD 文档 */
export function createPsdDocument(
  imageUrl: string,
  width: number,
  height: number,
  fileName: string,
): PsdDocument {
  return {
    id: `psd-${Date.now()}`,
    fileName,
    width,
    height,
    layers: [
      {
        id: 'layer-original',
        name: '原图层',
        type: 'raster',
        visible: true,
        locked: false,
        opacity: 1,
        x: 0,
        y: 0,
        width,
        height,
        imageUrl,
        blendMode: 'normal',
      },
    ],
    exportMode: 'standard',
  };
}

/** 将 canvas 转为 data URL */
function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

/** 分析图片并生成分层 PSD 文档 */
export async function analyzeImageToPsdLayers(
  imageUrl: string,
  width: number,
  height: number,
  mode: PsdExportMode,
  onProgress?: (p: PsdExportProgress) => void,
): Promise<PsdDocument> {
  onProgress?.({ stage: 'segment', progress: 0.1, message: '正在加载图像...' });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = imageUrl;
  });

  onProgress?.({ stage: 'segment', progress: 0.2, message: '正在分析图像...' });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);

  const internalMode = mapExportMode(mode);
  const dataUrl = canvasToDataUrl(canvas);

  const result = await exportAsPSD(dataUrl, `analyze_${Date.now()}`, {
    mode: internalMode,
    onProgress: (stage: string, progress: number, message?: string) => {
      const stageMap: Record<string, PsdExportProgress['stage']> = {
        'normalizing_input': 'segment',
        'color_quantization': 'segment',
        'region_analysis': 'segment',
        'building_scene': 'segment',
        'building_psd': 'generate',
        'done': 'done',
      };
      onProgress?.({
        stage: stageMap[stage] ?? 'segment',
        progress,
        message: message ?? '',
      });
    },
  });

  onProgress?.({ stage: 'generate', progress: 0.9, message: '正在构建图层...' });

  const layers: PsdLayerItem[] = [];

  // 原图层
  layers.push({
    id: 'layer-original',
    name: '原图层',
    type: 'raster',
    visible: true,
    locked: false,
    opacity: 1,
    x: 0,
    y: 0,
    width,
    height,
    imageUrl,
    blendMode: 'normal',
  });

  // 如果有设计场景信息，添加分层
  if (result.designScene?.layers) {
    for (const sl of result.designScene.layers) {
      if (sl.role === 'background') {
        layers.push({
          id: `layer-${sl.id}`,
          name: sl.name || '背景层',
          type: 'raster',
          visible: true,
          locked: false,
          opacity: 1,
          x: 0,
          y: 0,
          width,
          height,
          imageUrl: sl.imageDataUrl || imageUrl,
          blendMode: 'normal',
        });
      } else if (sl.role === 'subject' || sl.role === 'deco') {
        layers.push({
          id: `layer-${sl.id}`,
          name: sl.name || `主体 ${sl.id}`,
          type: 'raster',
          visible: true,
          locked: false,
          opacity: 1,
          x: sl.boundingBox?.x ?? 0,
          y: sl.boundingBox?.y ?? 0,
          width: sl.boundingBox?.width ?? width,
          height: sl.boundingBox?.height ?? height,
          imageUrl: sl.imageDataUrl || imageUrl,
          blendMode: 'normal',
        });
      } else if (sl.role === 'text') {
        layers.push({
          id: `layer-${sl.id}`,
          name: sl.name || `文字 ${sl.id}`,
          type: 'text',
          visible: true,
          locked: false,
          opacity: 1,
          x: sl.boundingBox?.x ?? 0,
          y: sl.boundingBox?.y ?? 0,
          width: sl.boundingBox?.width ?? 200,
          height: sl.boundingBox?.height ?? 40,
          imageUrl: sl.imageDataUrl || imageUrl,
          blendMode: 'normal',
          textContent: sl.textContent,
        });
      } else if (sl.role === 'shadow') {
        layers.push({
          id: `layer-${sl.id}`,
          name: sl.name || `阴影 ${sl.id}`,
          type: 'raster',
          visible: true,
          locked: false,
          opacity: 0.6,
          x: sl.boundingBox?.x ?? 0,
          y: sl.boundingBox?.y ?? 0,
          width: sl.boundingBox?.width ?? width,
          height: sl.boundingBox?.height ?? height,
          imageUrl: sl.imageDataUrl || imageUrl,
          blendMode: 'multiply',
        });
      }
    }
  }

  // 反转图层顺序（最上层在最前面）
  layers.reverse();

  onProgress?.({ stage: 'done', progress: 1, message: '分析完成' });

  return {
    id: `psd-${Date.now()}`,
    fileName: `document_${Date.now()}`,
    width,
    height,
    layers,
    exportMode: mode,
  };
}

/** 导出 PSD 文件 */
export async function exportPsdFile(
  doc: PsdDocument,
  onProgress?: (p: PsdExportProgress) => void,
): Promise<void> {
  onProgress?.({ stage: 'generate', progress: 0.1, message: '正在合并图层...' });

  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, doc.width, doc.height);

  // 使用合并后的图层重建
  for (const layer of doc.layers) {
    if (!layer.visible || !layer.imageUrl) continue;
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('图层图片加载失败'));
        image.src = layer.imageUrl;
      });
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height);
    } catch {
      // 跳过加载失败的图层
    }
  }
  ctx.globalAlpha = 1;

  const internalMode = mapExportMode(doc.exportMode);
  const dataUrl = canvasToDataUrl(canvas);

  await exportAsPSD(dataUrl, doc.fileName, {
    mode: internalMode,
    onProgress: (stage: string, progress: number, message?: string) => {
      onProgress?.({ stage: stage as PsdExportProgress['stage'], progress, message: message ?? '' });
    },
  });

  onProgress?.({ stage: 'done', progress: 1, message: '导出完成' });
}
