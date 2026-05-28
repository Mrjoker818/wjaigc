/**
 * AI PSD 导出打包器
 * 
 * 对照文档: 13.5 导出包
 * - PSD主文件（Photoshop编辑）
 * - 图层JSON配置（文字编辑器/二次生成用）
 * - 生成报告MD（摘要/质量评分/图层清单）
 * - ZIP打包所有文件
 */

import type { AiPsdTask, LayerPlan, TextLayerEditableConfig } from './types';
import type { PsdBuildResult } from './psd-builder';

/** 导出格式选项 */
export type ExportFormat = 'psd' | 'zip' | 'json' | 'md';

/** 导出结果 */
export interface ExportResult {
  /** 文件Buffer */
  buffer: Buffer;
  /** 文件名 */
  filename: string;
  /** MIME类型 */
  mimeType: string;
  /** 包含的文件列表（ZIP时有效） */
  files?: string[];
  /** 总大小 */
  size: number;
}

/** 质量评分 */
export interface QualityScore {
  overall: number;      // 0-100
  consistency: number;  // 0-100 图层一致性
  editable: number;     // 0-100 可编辑度
}

/**
 * 生成图层JSON配置
 * 包含所有图层的元信息，供文字编辑器和二次生成使用
 */
export function buildLayerJson(
  task: AiPsdTask,
  layerPlan: LayerPlan,
  textConfigs: TextLayerEditableConfig[],
  psdResult: PsdBuildResult
): object {
  return {
    version: '4.0',
    taskId: task.id,
    createdAt: new Date().toISOString(),
    canvas: {
      width: psdResult.filename.match(/(\d+)x(\d+)/)?.[1] 
        ? parseInt(psdResult.filename.match(/(\d+)x(\d+)/)![1]) 
        : 1024,
      height: psdResult.filename.match(/(\d+)x(\d+)/)?.[2]
        ? parseInt(psdResult.filename.match(/(\d+)x(\d+)/)![2])
        : 1024,
    },
    generation: {
      mode: task.generationMode,
      prompt: task.prompt,
      sceneType: task.sceneType,
      styleTags: task.style,
      colorTone: task.colorTone,
      complexity: task.layerComplexity,
      quality: task.outputQuality,
      imageModel: task.imageModel,
      llmModel: task.llmModel,
    },
    layers: (layerPlan.layers || []).map(layer => {
      const textConfig = textConfigs.find(c => c.v4Name === layer.name);
      return {
        name: layer.name,
        type: layer.type,
        v4Name: layer.name,
        visible: layer.visible !== false,
        opacity: layer.opacity ?? 100,
        blendMode: layer.blendMode || 'normal',
        description: layer.description || '',
        prompt: layer.prompt || '',
        isUserAsset: layer.name.includes('product') || layer.name.includes('logo'),
        editable: layer.type === 'text',
        textConfig: textConfig || undefined,
      };
    }),
    layerManifest: psdResult.layerManifest,
  };
}

/**
 * 生成报告MD文档
 * 对照文档: 13.5 生成报告
 */
export function buildReportMd(
  task: AiPsdTask,
  layerPlan: LayerPlan,
  psdResult: PsdBuildResult,
  scores: QualityScore,
  durationMs: number
): string {
  const durationSec = (durationMs / 1000).toFixed(1);
  const layerCount = layerPlan.layers?.length || 0;
  const sizeMB = (psdResult.size / 1024 / 1024).toFixed(2);

  let md = `# AI PSD 生成报告

## 基本信息

| 项目 | 值 |
|------|-----|
| 任务ID | ${task.id} |
| 生成模式 | ${task.generationMode} |
| 场景类型 | ${task.sceneType} |
| 画幅比例 | ${task.ratio} |
| 风格标签 | ${(task.style || []).join(', ')} |
| 色调 | ${task.colorTone} |
| 图层复杂度 | ${task.layerComplexity} |
| 输出质量 | ${task.outputQuality} |
| 图像模型 | ${task.imageModel || '默认'} |
| LLM模型 | ${task.llmModel || '默认'} |
| 生成耗时 | ${durationSec}s |
| PSD文件大小 | ${sizeMB}MB |
| 图层数量 | ${layerCount} |

## 质量评分

| 维度 | 评分 |
|------|------|
| 整体质量 | ${scores.overall}/100 |
| 图层一致性 | ${scores.consistency}/100 |
| 可编辑度 | ${scores.editable}/100 |

## 图层清单

| 序号 | V4名称 | 类型 | 可见 | 不透明度 | 说明 |
|------|--------|------|------|----------|------|
`;

  (layerPlan.layers || []).forEach((layer, i) => {
    const isUserAsset = layer.name.includes('product') || layer.name.includes('logo');
    md += `| ${i + 1} | ${layer.name} | ${layer.type} | ${layer.visible !== false ? '✓' : '✗'} | ${layer.opacity ?? 100}% | ${isUserAsset ? '[原素材]' : (layer.description || '')} |\n`;
  });

  md += `
## V4规范说明

- \`bg/\` — 背景层
- \`fx/\` — 光效/阴影/氛围
- \`subject/\` — 主体/产品
- \`deco/\` — 装饰/纹样/边框/Logo
- \`text/\` — 可编辑文字层

## 使用说明

1. 在Photoshop中打开PSD文件
2. 文字层标注[可编辑]，可直接双击编辑文字内容
3. 标注[原素材]的图层为用户上传的原始素材，请勿重绘
4. 每个图层均为全画布透明PNG，可通过图层JSON配置二次生成
`;

  return md;
}

/**
 * 计算质量评分
 */
export function calculateQualityScore(
  task: AiPsdTask,
  layerPlan: LayerPlan,
  psdResult: PsdBuildResult
): QualityScore {
  const layers = layerPlan.layers || [];
  const totalLayers = layers.length;

  // 整体质量：基于图层数量和PSD大小
  const expectedLayers = task.layerComplexity === 'standard' ? 5 : 12;
  const layerScore = Math.min(100, Math.round((totalLayers / expectedLayers) * 80 + 20));
  const sizeScore = psdResult.size > 1024 * 1024 ? 90 : 60; // >1MB为高质量
  const overall = Math.round((layerScore * 0.6 + sizeScore * 0.4));

  // 一致性：所有图层尺寸一致+命名规范
  const validNames = layers.filter(l => /^(bg|fx|subject|deco|text)\//.test(l.name)).length;
  const consistency = totalLayers > 0 ? Math.round((validNames / totalLayers) * 100) : 50;

  // 可编辑度：文字层比例+产品图保留
  const textLayers = layers.filter(l => l.type === 'text').length;
  const userAssetLayers = layers.filter(l => 
    l.name.includes('product') || l.name.includes('logo')
  ).length;
  const editableRatio = totalLayers > 0 
    ? ((textLayers + userAssetLayers) / totalLayers) * 100 
    : 50;
  const editable = Math.min(100, Math.round(editableRatio + 30)); // 基础分30

  return {
    overall: Math.min(100, overall),
    consistency: Math.min(100, consistency),
    editable: Math.min(100, editable),
  };
}

/**
 * 打包为ZIP
 * 使用 Node.js 内置 zlib 手动构建 ZIP 文件（无需第三方依赖）
 * 包含: PSD + 图层JSON + 报告MD
 */
export async function buildExportZip(
  psdResult: PsdBuildResult,
  layerJson: object,
  reportMd: string,
  task: AiPsdTask
): Promise<ExportResult> {
  const jsonStr = JSON.stringify(layerJson, null, 2);
  const filename = `AI_PSD_${task.sceneType}_${Date.now()}.zip`;

  // 使用简单 ZIP 构建（无需 archiver 依赖）
  const buffer = await buildSimpleZip([
    { name: psdResult.filename, data: psdResult.buffer },
    { name: 'layers.json', data: Buffer.from(jsonStr, 'utf-8') },
    { name: 'report.md', data: Buffer.from(reportMd, 'utf-8') },
  ]);

  return {
    buffer,
    filename,
    mimeType: 'application/zip',
    files: [psdResult.filename, 'layers.json', 'report.md'],
    size: buffer.byteLength,
  };
}

/** 简单 ZIP 文件构建器（STORE 模式，无压缩） */
async function buildSimpleZip(files: Array<{ name: string; data: Buffer }>): Promise<Buffer> {
  const { deflateSync } = await import('zlib');
  const entries: Array<{
    name: Buffer;
    compressed: Buffer;
    crc32: number;
    localHeaderOffset: number;
  }> = [];

  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf-8');
    const compressed = deflateSync(file.data);
    const crc = crc32(file.data);

    entries.push({
      name: nameBytes,
      compressed,
      crc32: crc,
      localHeaderOffset: offset,
    });

    // Local file header (30 + name + data)
    offset += 30 + nameBytes.length + compressed.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;

  // Build central directory
  const centralDirParts: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);   // Central directory signature
    header.writeUInt16LE(20, 4);            // Version made by
    header.writeUInt16LE(20, 6);            // Version needed
    header.writeUInt16LE(0, 8);             // Flags
    header.writeUInt16LE(8, 10);            // Compression: deflate
    header.writeUInt16LE(0, 12);            // Mod time
    header.writeUInt16LE(0, 14);            // Mod date
    header.writeUInt32LE(entry.crc32, 16);  // CRC-32
    header.writeUInt32LE(entry.compressed.length, 20); // Compressed size
    header.writeUInt32LE(0, 24);            // Uncompressed size (placeholder)
    header.writeUInt16LE(entry.name.length, 28); // Name length
    header.writeUInt16LE(0, 30);            // Extra length
    header.writeUInt16LE(0, 32);            // Comment length
    header.writeUInt16LE(0, 34);            // Disk number
    header.writeUInt16LE(0, 36);            // Internal attrs
    header.writeUInt32LE(0, 38);            // External attrs
    header.writeUInt32LE(entry.localHeaderOffset, 42); // Offset

    centralDirParts.push(header);
    centralDirParts.push(entry.name);
    centralDirSize += 46 + entry.name.length;
  }

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);        // EOCD signature
  eocd.writeUInt16LE(0, 4);                  // Disk number
  eocd.writeUInt16LE(0, 6);                  // Central dir disk
  eocd.writeUInt16LE(entries.length, 8);     // Entries on this disk
  eocd.writeUInt16LE(entries.length, 10);    // Total entries
  eocd.writeUInt32LE(centralDirSize, 12);    // Central dir size
  eocd.writeUInt32LE(centralDirOffset, 16);  // Central dir offset
  eocd.writeUInt16LE(0, 20);                 // Comment length

  // Build local file headers + data
  const localParts: Buffer[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const file = files[i]!;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);     // Local file header signature
    header.writeUInt16LE(20, 4);              // Version needed
    header.writeUInt16LE(0, 6);               // Flags
    header.writeUInt16LE(8, 8);               // Compression: deflate
    header.writeUInt16LE(0, 10);              // Mod time
    header.writeUInt16LE(0, 12);              // Mod date
    header.writeUInt32LE(entry.crc32, 14);    // CRC-32
    header.writeUInt32LE(entry.compressed.length, 18); // Compressed size
    header.writeUInt32LE(file.data.length, 22);         // Uncompressed size
    header.writeUInt16LE(entry.name.length, 26);        // Name length
    header.writeUInt16LE(0, 28);              // Extra length

    localParts.push(header);
    localParts.push(entry.name);
    localParts.push(entry.compressed);
  }

  return Buffer.concat([
    ...localParts,
    ...centralDirParts,
    eocd,
  ]);
}

/** CRC32 计算 */
function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ data[i]!) & 0xFF]!;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const crc32Table: number[] = (() => {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table.push(c);
  }
  return table;
})();

/**
 * 单文件导出
 */
export async function exportSingle(
  format: ExportFormat,
  task: AiPsdTask,
  layerPlan: LayerPlan,
  textConfigs: TextLayerEditableConfig[],
  psdResult: PsdBuildResult,
  scores: QualityScore,
  durationMs: number
): Promise<ExportResult> {
  switch (format) {
    case 'psd': {
      return {
        buffer: psdResult.buffer,
        filename: psdResult.filename,
        mimeType: 'image/vnd.adobe.photoshop',
        size: psdResult.size,
      };
    }

    case 'json': {
      const layerJson = buildLayerJson(task, layerPlan, textConfigs, psdResult);
      const jsonStr = JSON.stringify(layerJson, null, 2);
      const buffer = Buffer.from(jsonStr, 'utf-8');
      return {
        buffer,
        filename: `AI_PSD_${task.sceneType}_layers.json`,
        mimeType: 'application/json',
        size: buffer.byteLength,
      };
    }

    case 'md': {
      const reportMd = buildReportMd(task, layerPlan, psdResult, scores, durationMs);
      const buffer = Buffer.from(reportMd, 'utf-8');
      return {
        buffer,
        filename: `AI_PSD_${task.sceneType}_report.md`,
        mimeType: 'text/markdown',
        size: buffer.byteLength,
      };
    }

    case 'zip': {
      const layerJson = buildLayerJson(task, layerPlan, textConfigs, psdResult);
      const reportMd = buildReportMd(task, layerPlan, psdResult, scores, durationMs);
      return buildExportZip(psdResult, layerJson, reportMd, task);
    }

    default:
      throw new Error(`不支持的导出格式: ${format}`);
  }
}
