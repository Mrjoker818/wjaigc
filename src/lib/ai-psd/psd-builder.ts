/**
 * AI PSD 合成器
 * 使用 ag-psd 将所有图层合成为 Photoshop PSD 文件
 * 
 * 对照文档: 13.3 合成规则
 * - 每个图层为全画布透明PNG，定位在(0,0)
 * - 图层顺序：背景→光效→阴影→主体→装饰→标识→氛围→文字
 * - V4规范命名：bg/main, fx/light, fx/shadow/1, subject/1/product, deco/1/xxx, text/1/title
 * - 产品图/Logo为用户原图，不重绘
 * - 文字层为PNG预览 + 可编辑JSON配置
 */

import { writePsd, initializeCanvas } from 'ag-psd';
import type { Psd, Layer, BlendMode } from 'ag-psd';
import sharp from 'sharp';
import type { AiPsdTask, LayerPlan, LayerPlanLayer, LayerDef, TextLayerEditableConfig } from './types';

// 初始化 ag-psd 的 canvas 方法（服务器端使用 @napi-rs/canvas）
let canvasInitialized = false;
async function ensureCanvasInit(): Promise<void> {
  if (canvasInitialized) return;
  try {
    // Use webpackIgnore to bypass webpack bundling and get the native module at runtime (P3-1: replaced eval)
    const canvasModule = /* webpackIgnore: true */ require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
    initializeCanvas(
      canvasModule.createCanvas as unknown as (width: number, height: number) => HTMLCanvasElement,
      (width: number, height: number) => new canvasModule.ImageData(width, height) as unknown as ImageData
    );
    canvasInitialized = true;
  } catch (e) {
    console.warn('[ai-psd-builder] @napi-rs/canvas not available, PSD generation will be limited:', e);
  }
}

/** PSD合成输入 */
export interface PsdBuildInput {
  task: AiPsdTask;
  layerPlan: LayerPlan;
  /** 图层PNG Buffer列表，按V4顺序排列 */
  layerBuffers: Map<string, Buffer>;
  /** 文字层配置列表 */
  textConfigs: TextLayerEditableConfig[];
  /** 画布宽度 */
  width: number;
  /** 画布高度 */
  height: number;
  /** 预览图URL */
  previewUrl?: string;
}

/** PSD合成结果 */
export interface PsdBuildResult {
  /** PSD文件Buffer */
  buffer: Buffer;
  /** 文件名 */
  filename: string;
  /** 图层清单 */
  layerManifest: Array<{
    name: string;
    type: string;
    visible: boolean;
    opacity: number;
    editable?: boolean;
    textConfig?: TextLayerEditableConfig;
  }>;
  /** PSD文件大小(bytes) */
  size: number;
}

/** V4图层排序权重 */
const LAYER_ORDER: Record<string, number> = {
  bg: 0,
  fx: 1,
  subject: 2,
  deco: 3,
  fx_atmosphere: 4,
  text: 5,
};

/** 获取图层的排序权重 */
function getLayerSortWeight(name: string): number {
  const prefix = name.split('/')[0];
  if (prefix === 'fx' && name.includes('atmosphere')) return LAYER_ORDER.fx_atmosphere;
  return LAYER_ORDER[prefix] ?? 99;
}

/** 将PNG Buffer转为ag-psd的imageData */
async function pngBufferToImageData(pngBuffer: Buffer, targetWidth: number, targetHeight: number): Promise<{
  data: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const raw = await sharp(pngBuffer)
    .resize(targetWidth, targetHeight, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  return {
    data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength),
    width: targetWidth,
    height: targetHeight,
  };
}

/** 混合模式映射 */
function mapBlendMode(blend?: string): BlendMode | undefined {
  const map: Record<string, BlendMode> = {
    'normal': 'normal',
    'multiply': 'multiply',
    'screen': 'screen',
    'overlay': 'overlay',
    'darken': 'darken',
    'lighten': 'lighten',
    'color-dodge': 'color dodge',
    'color-burn': 'color burn',
    'hard-light': 'hard light',
    'soft-light': 'soft light',
    'difference': 'difference',
    'exclusion': 'exclusion',
    'hue': 'hue',
    'saturation': 'saturation',
    'color': 'color',
    'luminosity': 'luminosity',
    // 中文名映射
    '正片叠底': 'multiply',
    '滤色': 'screen',
    '叠加': 'overlay',
    '柔光': 'soft light',
    '强光': 'hard light',
  };
  return blend ? map[blend] : undefined;
}

/** 构建分组结构 */
function buildGroupedLayers(
  layers: LayerDef[],
  layerBuffers: Map<string, Buffer>,
  textConfigs: TextLayerEditableConfig[],
  width: number,
  height: number
): Layer[] {
  // 按V4顺序分组
  const groups = new Map<string, LayerDef[]>();
  for (const layer of layers) {
    const prefix = layer.name.split('/')[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(layer);
  }

  const agLayers: Layer[] = [];

  // V4标准顺序：bg → fx → subject → deco → fx(atmosphere) → text
  const groupOrder = ['bg', 'fx', 'subject', 'deco', 'text'];

  for (const groupKey of groupOrder) {
    const groupLayers = groups.get(groupKey);
    if (!groupLayers || groupLayers.length === 0) continue;

    // 分离atmosphere到最底部
    const normalLayers = groupLayers.filter(l => !l.name.includes('atmosphere'));
    const atmosphereLayers = groupLayers.filter(l => l.name.includes('atmosphere'));

    const groupChildren: Layer[] = [];

    for (const layerDef of [...normalLayers, ...atmosphereLayers]) {
      const buffer = layerBuffers.get(layerDef.name);
      if (!buffer) continue;

      // 构建图层
      const agLayer: Layer = {
        name: layerDef.name,
        opacity: layerDef.opacity ?? 255,
        blendMode: mapBlendMode(layerDef.blendMode),
        hidden: layerDef.visible === false,
      };

      // 产品图/Logo为用户原图，标记不重绘
      if (layerDef.name.includes('product') || layerDef.name.includes('logo')) {
        agLayer.name = `${layerDef.name} [原素材-勿重绘]`;
      }

      // 文字层特殊处理：PNG预览 + JSON配置注释
      if (layerDef.type === 'text') {
        const textConfig = textConfigs.find(c => c.v4Name === layerDef.name);
        if (textConfig) {
          agLayer.name = `${layerDef.name} [可编辑:${textConfig.text.slice(0, 10)}]`;
        }
      }

      // 设置imageData（服务器端）
      agLayer.canvas = undefined; // 服务器端无canvas
      // ag-psd在服务器端使用canvas字段时需要createCanvas，改用直接构建方式

      groupChildren.push(agLayer);
    }

    if (groupChildren.length === 0) continue;

    // 如果组内只有一层，不建组直接添加
    if (groupChildren.length === 1) {
      agLayers.push(groupChildren[0]);
    } else {
      agLayers.push({
        name: getGroupDisplayName(groupKey),
        opened: true,
        children: groupChildren,
      });
    }
  }

  return agLayers;
}

/** 获取组的显示名称 */
function getGroupDisplayName(groupKey: string): string {
  const names: Record<string, string> = {
    bg: '01_背景层',
    fx: '02_光效/阴影',
    subject: '03_主体层',
    deco: '04_装饰层',
    text: '05_文字层',
  };
  return names[groupKey] || groupKey;
}

/**
 * 主合成函数
 * 将所有图层PNG Buffer合成为PSD文件
 */
export async function buildPsd(input: PsdBuildInput): Promise<PsdBuildResult> {
  await ensureCanvasInit();
  const { task, layerPlan, layerBuffers, textConfigs, width, height } = input;

  // 创建ag-psd的图层结构
  const agLayers: Layer[] = [];

  // 按V4顺序处理所有图层
  const sortedLayers = [...(layerPlan.layers || [])].sort(
    (a, b) => getLayerSortWeight(a.name) - getLayerSortWeight(b.name)
  );

  for (const layerDef of sortedLayers) {
    const buffer = layerBuffers.get(layerDef.name);
    if (!buffer) {
      console.warn(`[ai-psd-builder] 图层 ${layerDef.name} 无Buffer，跳过`);
      continue;
    }

    try {
      const imageData = await pngBufferToImageData(buffer, width, height);

      const agLayer: Layer = {
        name: layerDef.name,
        opacity: (layerDef.opacity ?? 100) * 2.55, // 0-100 → 0-255
        blendMode: mapBlendMode(layerDef.blendMode),
        hidden: layerDef.visible === false,
        imageData,
      };

      // 产品图/Logo标记
      if (layerDef.name.includes('product') || layerDef.name.includes('logo')) {
        agLayer.name = `${layerDef.name} [原素材]`;
      }

      // 文字层标记
      if (layerDef.type === 'text') {
        const textConfig = textConfigs.find(c => c.v4Name === layerDef.name);
        if (textConfig) {
          agLayer.name = `${layerDef.name} [可编辑]`;
        }
      }

      agLayers.push(agLayer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ai-psd-builder] 图层 ${layerDef.name} 处理失败:`, msg);
    }
  }

  // 构建PSD
  const psd: Psd = {
    width,
    height,
    children: agLayers,
  };

  const arrayBuffer = writePsd(psd, {
    generateThumbnail: true,
    noBackground: true,
  });

  const psdBuffer = Buffer.from(arrayBuffer);

  // 构建图层清单
  const layerManifest = sortedLayers.map(layerDef => {
    const textConfig = textConfigs.find(c => c.v4Name === layerDef.name);
    return {
      name: layerDef.name,
      type: layerDef.type,
      visible: layerDef.visible !== false,
      opacity: layerDef.opacity ?? 100,
      editable: layerDef.type === 'text',
      textConfig,
    };
  });

  const filename = `AI_PSD_${task.sceneType}_${width}x${height}_${Date.now()}.psd`;

  return {
    buffer: psdBuffer,
    filename,
    layerManifest,
    size: psdBuffer.byteLength,
  };
}

/**
 * 轻量合成（不含图像数据，仅结构预览）
 * 用于任务完成前的快速预览
 */
export function buildPsdPreview(input: PsdBuildInput): {
  layerCount: number;
  layers: Array<{ name: string; type: string; visible: boolean }>;
  estimatedSize: number;
} {
  const layers = (input.layerPlan.layers || []).sort(
    (a, b) => getLayerSortWeight(a.name) - getLayerSortWeight(b.name)
  );

  return {
    layerCount: layers.length,
    layers: layers.map(l => ({ name: l.name, type: l.type, visible: l.visible !== false })),
    estimatedSize: input.width * input.height * 4 * layers.length * 0.3, // 粗略估算
  };
}
