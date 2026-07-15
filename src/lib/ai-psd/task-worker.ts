/**
 * AI PSD 任务 Worker — 完整生成流程
 *
 * 流程：图层规划(planning) → 整图预览(preview_generating) → 逐层生成(layer_generating) →
 *       文字层构建(text_building) → 合成PSD(psd_exporting) → 打包(packaging) → 完成(success)
 */

import path from 'path';
import fs from 'fs';
import type {
  AiPsdTask,
  AiPsdTaskStatus,
  LayerPlan,
  LayerPlanLayer,
  TextLayerDef,
  TextLayerEditableConfig,
  LayerDef,
} from './types';
import {
  dbGetTask,
  dbUpdateTaskStatus,
  dbAddFile,
} from './storage';
import { isTaskCancelled, updateTaskProgress } from '../task-registry';
import {
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  extractLayerPlanFromResponse,
} from './plan-prompt';
import { validateLayerPlan, type ValidationResult } from './schema-validator';
import {
  callLLM,
  generateImage,
  getImageProvider,
  getLLMProvider,
  pollImageTask,
} from './model-router';
import {
  generateLayerPrompt,
  generatePreviewPrompt,
} from './layer-prompt';
import {
  buildTextLayers,
  renderTextToPng,
  buildTextLayer,
} from './text-layer-builder';
import {
  normalizeImage,
  downloadImageToBuffer,
  getCanvasDimensions,
  type NormalizeOptions,
  type NormalizeResult,
} from './image-normalize';
import {
  generateShadowLayer,
  type ShadowParams,
} from './shadow-generator';
import {
  buildPsd,
  type PsdBuildInput,
  type PsdBuildResult,
} from './psd-builder';
import {
  exportSingle,
  buildExportZip,
  buildLayerJson,
  buildReportMd,
  calculateQualityScore,
  type ExportFormat,
  type ExportResult,
  type QualityScore,
} from './export-packager';

// ──────────── 工具 ────────────

function checkCancel(taskId: string): void {
  if (isTaskCancelled(taskId)) {
    throw new Error('TASK_CANCELLED');
  }
}

function makeV4Name(layer: LayerPlanLayer): string {
  const group = layer.group ?? 'deco';
  const idx = 1;
  const label = (layer.description ?? layer.name ?? 'layer').slice(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
  switch (group) {
    case 'background': return 'bg/main';
    case 'light': return `fx/light/${idx}`;
    case 'subject': return `subject/${idx}/${label}`;
    case 'decoration': return `deco/${idx}/${label}`;
    case 'identity': return `deco/${idx}/${label}`;
    case 'atmosphere': return `fx/atmosphere/${idx}`;
    case 'text': return `text/${idx}/${label}`;
    default: return `deco/${idx}/${label}`;
  }
}

/** 同时更新数据库和 task-registry 的进度 */
async function advanceTask(
  taskId: string,
  status: AiPsdTaskStatus,
  progress: number,
  extra?: Partial<Pick<AiPsdTask, 'currentStep' | 'currentLayerName' | 'previewUrl' | 'psdUrl' | 'zipUrl' | 'jsonUrl' | 'reportUrl' | 'errorMessage' | 'layerPlan'>>,
) {
  await dbUpdateTaskStatus(taskId, status, progress, extra);
  // 同步推送到 SSE (task-registry) — 映射 ai-psd 状态到 task-registry 状态
  const statusMap: Record<string, import('@/lib/task-registry').TaskStatus> = {
    idle: 'pending', uploading: 'processing', queued: 'queued',
    planning: 'processing', preview_generating: 'processing',
    layer_generating: 'processing', text_building: 'processing',
    psd_exporting: 'processing', packaging: 'processing',
    success: 'completed', failed: 'failed', cancelled: 'cancelled',
  };
  updateTaskProgress(taskId, {
    status: statusMap[status] || 'processing',
    progress,
    label: extra?.currentStep || '',
  });
}

/** 将 ExportResult 保存到文件表并返回可访问路径 */
async function saveExportResult(
  taskId: string,
  result: ExportResult,
  format: string,
  layerId: string = '',
): Promise<string> {
  const fileId = `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fileUrl = `/ai-psd/${taskId}/${result.filename}`;

  // 将 buffer 写入磁盘（public 目录，可通过 HTTP 访问）
  if (result.buffer) {
    try {
      const outputDir = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', 'ai-psd', taskId);
      fs.mkdirSync(outputDir, { recursive: true });
      const filePath = path.join(outputDir, result.filename);
      fs.writeFileSync(filePath, result.buffer);
      console.info(`[ai-psd-worker] File saved: ${filePath} (${result.size} bytes)`);
    } catch (writeErr) {
      console.error(`[ai-psd-worker] Failed to write file ${result.filename}:`, writeErr);
    }
  }

  const resultAny = result as unknown as Record<string, unknown>;
  // ZIP 包含多个子文件
  if ('files' in result && Array.isArray(resultAny.files)) {
    const files = resultAny.files as Array<{ filename: string; buffer: Buffer }>;
    for (const f of files) {
      if (f.buffer) {
        try {
          const outputDir = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'public', 'ai-psd', taskId);
          fs.mkdirSync(outputDir, { recursive: true });
          const filePath = path.join(outputDir, f.filename);
          fs.writeFileSync(filePath, f.buffer);
        } catch (writeErr) {
          console.error(`[ai-psd-worker] Failed to write sub-file ${f.filename}:`, writeErr);
        }
      }
    }
  }

  await dbAddFile(fileId, taskId, layerId, format, result.filename, fileUrl, result.size);
  return fileUrl;
}

// ──────────── 主流程 ────────────

export async function runAiPsdTask(taskId: string): Promise<void> {
  console.info(`[ai-psd-worker] Starting task ${taskId}`);
  let t = await dbGetTask(taskId);
  if (!t) {
    console.error(`[ai-psd-worker] Task ${taskId} not found`);
    return;
  }

  const startTime = Date.now();

  try {
    // ═══════════════════════════════════════════
    // Phase 1: 图层规划 (planning)
    // ═══════════════════════════════════════════
    await advanceTask(taskId, 'planning', 5, { currentStep: '正在规划图层结构' });
    t = (await dbGetTask(taskId))!;

    // 获取画布尺寸
    const dims = getCanvasDimensions(t.ratio, t.customWidth, t.customHeight);

    // 构建 System Prompt
    const systemPrompt = buildPlanSystemPrompt({
      generationMode: t.generationMode,
      sceneType: t.sceneType,
      styles: t.style,
      colorTone: t.colorTone,
      primaryColor: t.primaryColor,
      secondaryColor: t.secondaryColor,
      accentColor: t.accentColor,
      layerComplexity: t.layerComplexity,
      textRenderMode: t.textRenderMode,
      ratio: t.ratio,
      canvasWidth: dims.width,
      canvasHeight: dims.height,
      title: t.title,
      subtitle: t.subtitle,
      bodyText: t.bodyText,
      hasReferenceImages: (t.referenceImageUrls?.length ?? 0) > 0,
      hasProductImages: (t.productImageUrls?.length ?? 0) > 0,
      hasLogoImages: (t.logoImageUrls?.length ?? 0) > 0,
      brandName: t.brandName,
      brandSlogan: t.brandSlogan,
      brandColors: t.brandColors,
      materialType: t.materialType,
    });

    // 构建 User Prompt
    const userPrompt = buildPlanUserPrompt(t.prompt);

    // 调用 LLM
    const llmResult = await callLLM(userPrompt, systemPrompt, t.llmModel, {
      maxTokens: 4096,
      temperature: 0.7,
    });

    if (!llmResult.success || !llmResult.content) {
      throw new Error(`LLM 规划调用失败: ${llmResult.error ?? '无返回内容'}`);
    }

    // 从 LLM 响应中提取 LayerPlan
    const rawPlan = extractLayerPlanFromResponse(llmResult.content);
    if (!rawPlan) {
      throw new Error('无法从 LLM 响应中解析出有效的图层规划 JSON');
    }

    // 校验 LayerPlan
    const validation: ValidationResult = validateLayerPlan(rawPlan);
    if (!validation.valid && !validation.fixed) {
      throw new Error(`图层规划校验失败: ${validation.errors.join('; ')}`);
    }

    const layerPlan: LayerPlan = validation.fixed ?? rawPlan;
    await advanceTask(taskId, 'planning', 15, { currentStep: '图层规划完成', layerPlan });
    checkCancel(taskId);
    t = (await dbGetTask(taskId))!;

    // ═══════════════════════════════════════════
    // Phase 2: 整图预览 (preview_generating)
    // ═══════════════════════════════════════════
    await advanceTask(taskId, 'preview_generating', 20, { currentStep: '正在生成整图预览' });
    t = (await dbGetTask(taskId))!;

    const previewPrompt = generatePreviewPrompt(t);
    const previewSize = `${dims.width}x${dims.height}`;
    // reference_to_psd 模式：使用源图作为参考，图生图以复现原图设计
    const previewRefImage = t.generationMode === 'reference_to_psd' && t.referenceImageUrls?.[0]
      ? t.referenceImageUrls[0]
      : undefined;
    const previewStrength = previewRefImage ? 0.55 : undefined;
    const previewResult = await generateImage(previewPrompt, t.imageModel, {
      size: previewSize,
      quality: t.outputQuality === 'hd' ? 'hd' : 'standard',
      n: 1,
      ...(previewRefImage ? { referenceImageUrl: previewRefImage, strength: previewStrength } : {}),
    });

    if (previewResult.success) {
      let previewUrl = previewResult.imageUrl || previewResult.imageUrls?.[0];
      // 异步任务模式：有taskId但无imageUrls，需要轮询
      if (!previewUrl && previewResult.taskId) {
        const pollResult = await pollImageTask(previewResult.taskId, t.imageModel);
        if (pollResult.success && (pollResult.imageUrl || pollResult.imageUrls?.length)) {
          previewUrl = pollResult.imageUrl || pollResult.imageUrls![0];
        }
      }
      if (previewUrl) {
        await advanceTask(taskId, 'preview_generating', 35, { currentStep: '整图预览完成', previewUrl });
      }
    }
    checkCancel(taskId);
    t = (await dbGetTask(taskId))!;

    // ═══════════════════════════════════════════
    // Phase 3: 逐层生成 (layer_generating)
    // ═══════════════════════════════════════════
    await advanceTask(taskId, 'layer_generating', 40, { currentStep: '正在逐层生成' });
    t = (await dbGetTask(taskId))!;

    const layers = layerPlan.layers;
    const totalLayers = layers.length;
    const layerBuffers: Map<string, Buffer> = new Map();

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const progress = 40 + Math.round((i / totalLayers) * 30);

      await advanceTask(taskId, 'layer_generating', progress, { currentStep: `生成图层: ${layer.name}` });
      t = (await dbGetTask(taskId))!;

      try {
        const isProductRef = layer.role === 'product_ref' || layer.role === 'product';
        const isLogoRef = layer.role === 'logo_ref' || layer.role === 'logo';
        const isShadow = layer.role === 'shadow';
        const keepOriginal = layer.keepOriginal ?? false;

        if (isProductRef && keepOriginal && t.productImageUrls && t.productImageUrls.length > 0) {
          // ── 产品图（保留原图） ──
          const buf = await downloadImageToBuffer(t.productImageUrls[0]);
          if (buf) {
            const normResult = await normalizeImage(buf, {
              targetWidth: dims.width,
              targetHeight: dims.height,
              preserveAlpha: true,
            });
            if (normResult.success && normResult.buffer) {
              layerBuffers.set(layer.name, normResult.buffer);
            }
          }
        } else if (isLogoRef && keepOriginal && t.logoImageUrls && t.logoImageUrls.length > 0) {
          // ── Logo（保留原图） ──
          const buf = await downloadImageToBuffer(t.logoImageUrls[0]);
          if (buf) {
            const normResult = await normalizeImage(buf, {
              targetWidth: dims.width,
              targetHeight: dims.height,
              preserveAlpha: true,
            });
            if (normResult.success && normResult.buffer) {
              layerBuffers.set(layer.name, normResult.buffer);
            }
          }
        } else if (isShadow) {
          // ── 阴影层：需要先有主体图，暂用占位 ──
          // 阴影层在PSD合成阶段由psd-builder处理，此处跳过独立生成
          console.info(`[ai-psd-worker] Shadow layer "${layer.name}" will be generated during PSD build`);
        } else {
          // ── AI 生成图层 ──
          const layerPrompt = generateLayerPrompt(layer, t);
          // reference_to_psd 模式：图层也用源图参考，保持与原图风格一致
          const layerRefImage = t.generationMode === 'reference_to_psd' && t.referenceImageUrls?.[0]
            ? t.referenceImageUrls[0]
            : undefined;
          const layerStrength = layerRefImage ? 0.45 : undefined;
          const imgResult = await generateImage(layerPrompt, t.imageModel, {
            size: `${dims.width}x${dims.height}`,
            quality: t.outputQuality === 'hd' ? 'hd' : 'standard',
            n: 1,
            ...(layerRefImage ? { referenceImageUrl: layerRefImage, strength: layerStrength } : {}),
          });

          if (imgResult.success) {
            // 异步任务模式：有taskId但无imageUrls，需要轮询
            let imageUrl = imgResult.imageUrl || (imgResult.imageUrls?.[0]);

            if (!imageUrl && imgResult.taskId) {
              console.info(`[ai-psd-worker] Async image task for layer "${layer.name}", polling...`);
              const pollResult = await pollImageTask(imgResult.taskId, t.imageModel);
              if (pollResult.success && (pollResult.imageUrl || pollResult.imageUrls?.length)) {
                imageUrl = pollResult.imageUrl || pollResult.imageUrls![0];
              } else {
                const detail = pollResult.error ?? 'poll timeout';
                console.warn(`[ai-psd-worker] Poll failed for layer "${layer.name}": ${detail}`);
              }
            }

            if (imageUrl) {
              const buf = await downloadImageToBuffer(imageUrl);
              if (buf) {
                const preserveAlpha = layer.transparent;
                const normResult = await normalizeImage(buf, {
                  targetWidth: dims.width,
                  targetHeight: dims.height,
                  preserveAlpha,
                  backgroundColor: preserveAlpha ? undefined : '#ffffff',
                });
                if (normResult.success && normResult.buffer) {
                  layerBuffers.set(layer.name, normResult.buffer);
                }
              }
            } else {
              console.warn(`[ai-psd-worker] Image generation for layer "${layer.name}": no URL returned (taskId=${imgResult.taskId ?? 'none'})`);
            }
          } else {
            console.warn(`[ai-psd-worker] Image generation failed for layer "${layer.name}": ${imgResult.error ?? 'unknown'}`);
          }
        }
      } catch (layerErr) {
        console.warn(`[ai-psd-worker] Layer "${layer.name}" failed, skipping:`, layerErr);
      }
      // 每生成一个图层后检查取消
      checkCancel(taskId);
    }

    // ═══════════════════════════════════════════
    // Phase 4: 文字层构建 (text_building)
    // ═══════════════════════════════════════════
    checkCancel(taskId);
    await advanceTask(taskId, 'text_building', 70, { currentStep: '正在生成可编辑文字层' });
    t = (await dbGetTask(taskId))!;

    const textLayers: TextLayerDef[] = buildTextLayers(t, layerPlan);
    const textConfigs: TextLayerEditableConfig[] = [];

    for (let i = 0; i < textLayers.length; i++) {
      const textDef = textLayers[i];
      const { name: layerName, pngBuffer } = buildTextLayer(textDef, dims.width, dims.height);
      const v4Name = `text/${i + 1}/${textDef.text.slice(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}`;

      // 文字层PNG添加到layerBuffers (key必须与psd-builder的layerDef.name一致)
      layerBuffers.set(v4Name, pngBuffer);

      textConfigs.push({
        ...textDef,
        layerIndex: i,
        v4Name,
      });
    }

    // ═══════════════════════════════════════════
    // Phase 5: 合成PSD (psd_exporting)
    // ═══════════════════════════════════════════
    await advanceTask(taskId, 'psd_exporting', 82, { currentStep: '正在合成PSD' });
    t = (await dbGetTask(taskId))!;

    const psdInput: PsdBuildInput = {
      task: t,
      layerPlan,
      layerBuffers,
      textConfigs,
      width: dims.width,
      height: dims.height,
      previewUrl: t.previewUrl,
    };

    const psdResult: PsdBuildResult = await buildPsd(psdInput);

    // ═══════════════════════════════════════════
    // Phase 6: 打包导出 (packaging)
    // ═══════════════════════════════════════════
    await advanceTask(taskId, 'packaging', 90, { currentStep: '正在打包导出文件' });
    t = (await dbGetTask(taskId))!;

    const durationMs = Date.now() - startTime;
    const scores: QualityScore = calculateQualityScore(t, layerPlan, psdResult);

    // 导出各种格式
    const psdExport: ExportResult = await exportSingle('psd', t, layerPlan, textConfigs, psdResult, scores, durationMs);
    const jsonExport: ExportResult = await exportSingle('json', t, layerPlan, textConfigs, psdResult, scores, durationMs);
    const reportExport: ExportResult = await exportSingle('md', t, layerPlan, textConfigs, psdResult, scores, durationMs);

    const layerJson = buildLayerJson(t, layerPlan, textConfigs, psdResult);
    const reportMd = buildReportMd(t, layerPlan, psdResult, scores, durationMs);
    const zipExport: ExportResult = await buildExportZip(psdResult, layerJson, reportMd, t);

    // 持久化文件到数据库
    const psdUrl = await saveExportResult(taskId, psdExport, 'psd');
    const zipUrl = await saveExportResult(taskId, zipExport, 'zip');
    const jsonUrl = await saveExportResult(taskId, jsonExport, 'json');
    const reportUrl = await saveExportResult(taskId, reportExport, 'md');

    // ═══════════════════════════════════════════
    // Phase 7: 完成
    // ═══════════════════════════════════════════
    await advanceTask(taskId, 'success', 100, { currentStep: '生成完成', psdUrl, zipUrl, jsonUrl, reportUrl });

    console.info(`[ai-psd-worker] Task ${taskId} completed successfully in ${(durationMs / 1000).toFixed(1)}s`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isCancel = errMsg.includes('已取消');
    console.error(`[ai-psd-worker] Task ${taskId} failed:`, errMsg);
    await advanceTask(taskId, 'failed', 0, { currentStep: `生成失败: ${errMsg}`, errorMessage: errMsg });
  }
}
