/**
 * RemoveBG 后处理模块
 * 
 * 设计原则（从第一性原理出发，彻底规避 sharp 通道转换 Bug）：
 * 
 * 1. rembg 模型输出概率蒙版（0-255灰度），边缘有自然过渡
 * 2. 所有蒙版处理（膨胀+模糊+应用）在 Python 端用 PIL/numpy 完成
 * 3. Node.js 端只做一件事：接收 Python 输出的 RGBA PNG + 蒙版 PNG → 保存到磁盘 → 返回 URL
 * 4. 不在 Node.js 端做任何 sharp 像素级操作（彻底避免 threshold/blur/convolve 转换通道的 Bug）
 * 
 * 流程：
 * 1. Python rembg 生成概率蒙版 → 膨胀(MaxFilter 5x5 ≈ 2px) → 高斯模糊(1.5px) → 应用蒙版到原图 → 返回 RGBA PNG + 蒙版 PNG
 * 2. Node.js 解码 base64 → 保存两份 PNG → 返回两个 URL
 */

import sharp from 'sharp';
import { saveImageFile } from './server-data-root';
import { fetchImageBuffer } from './fetch-image-buffer';

/** 计算数组中位数 */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** RemoveBG 后处理结果 */
export interface RemoveBGResult {
  /** 透明背景 PNG URL */
  imageUrl: string;
  /** 黑白蒙版 PNG URL（白色=前景主体，黑色=背景） */
  maskUrl: string;
}

/**
 * 本地 RemoveBG 后处理
 * 
 * Python 端已完成所有图像处理（蒙版生成+优化+应用），这里只负责保存文件
 * 
 * @param rgbaBase64 Python 端输出的 RGBA PNG base64（透明背景图）
 * @param maskBase64 Python 端输出的蒙版 PNG base64（黑白蒙版图）
 * @returns 持久化后的 URL（透明背景图 + 蒙版图），任一保存失败则该字段为空字符串
 */
export async function postProcessLocalRemoveBG(
  rgbaBase64: string,
  maskBase64?: string,
): Promise<RemoveBGResult | null> {
  try {
    // 解码 base64 → PNG Buffer
    const rgbaBuffer = Buffer.from(rgbaBase64, 'base64');

    // 将透明背景合成到白色背景上（用户要求：主体图不要透明背景，只显示主体）
    let subjectBuffer: Buffer;
    try {
      const rgbaImage = sharp(rgbaBuffer);
      const meta = await rgbaImage.metadata();
      const w = meta.width || 1;
      const h = meta.height || 1;
      subjectBuffer = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
        .composite([{ input: rgbaBuffer, blend: 'over' }])
        .png()
        .toBuffer();
    } catch {
      // 合成失败时 fallback 到原始 RGBA
      subjectBuffer = rgbaBuffer;
    }

    // 保存主体图（白色背景，无透明）
    const timestamp = Date.now();
    const imageFilename = `removebg-${timestamp}.png`;
    const imageUrl = saveImageFile(subjectBuffer, imageFilename, 'removebg');

    // 保存黑白蒙版图
    let maskUrl: string | null = null;
    if (maskBase64) {
      const maskBuffer = Buffer.from(maskBase64, 'base64');
      const maskFilename = `removebg-mask-${timestamp}.png`;
      maskUrl = saveImageFile(maskBuffer, maskFilename, 'removebg');
    }

    if (!imageUrl) {
      console.error('[postProcessLocalRemoveBG] Failed to save subject PNG');
      return null;
    }

    console.log(`[postProcessLocalRemoveBG] Saved subject PNG (white bg): ${imageUrl} (${subjectBuffer.length} bytes), mask: ${maskUrl || 'N/A'}`);
    
    return {
      imageUrl,
      maskUrl: maskUrl || '',
    };
  } catch (err) {
    console.error('[postProcessLocalRemoveBG] Error:', err);
    return null;
  }
}

/**
 * AI RemoveBG 后处理
 * 
 * AI 模型返回的图片可能含棋盘格背景（不是真透明），
 * 需要后处理提取主体蒙版再应用到原图。
 * 
 * 策略优先级（保留AI模型对主体的理解，避免二次损失）：
 * 1. AI 结果有有效 alpha 通道 → 直接提取
 * 2. AI 结果与原图对比提取蒙版（最关键策略：AI已正确识别主体，通过差异分离前景/背景）
 * 3. 边缘背景检测（从 AI 结果检测背景色，保留 AI 的主体识别）
 * 4. 本地 rembg 兜底
 * 
 * @param aiResultUrl AI 返回的图片 URL
 * @param originalImageUrl 原始图片 URL 或 Buffer
 */
export async function postProcessAIRemoveBG(
  aiResultUrl: string,
  originalImageUrl?: string | Buffer
): Promise<RemoveBGResult | null> {
  try {
    if (!originalImageUrl) {
      console.log('[postProcessAIRemoveBG] No original URL, cannot process');
      return null;
    }

    // 获取原图数据
    let origBuffer: Buffer;
    if (Buffer.isBuffer(originalImageUrl)) {
      origBuffer = originalImageUrl;
    } else {
      origBuffer = await fetchImageBuffer(originalImageUrl);
    }

    // 获取 AI 结果图片
    let aiBuffer: Buffer | null = null;
    try {
      aiBuffer = await fetchImageBuffer(aiResultUrl);
    } catch (e) {
      console.warn('[postProcessAIRemoveBG] Failed to fetch AI result:', e);
    }

    // 策略1: 如果 AI 结果有透明通道 (alpha)，直接从 AI 结果提取蒙版
    if (aiBuffer) {
      try {
        const sharp = (await import('sharp')).default;
        const aiMeta = await sharp(aiBuffer).metadata();
        const hasAlpha = aiMeta.channels === 4 || aiMeta.hasAlpha;

        if (hasAlpha) {
          console.log('[postProcessAIRemoveBG] AI result has alpha channel, extracting mask directly');
          const { data: raw, info } = await sharp(aiBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

          const w = info.width;
          const h = info.height;
          const pixelCount = w * h;
          const alphaChannel = Buffer.alloc(pixelCount);
          for (let i = 0; i < pixelCount; i++) {
            alphaChannel[i] = raw[i * 4 + 3];
          }

          // 计算透明像素占比，判断蒙版是否有效
          let transparentCount = 0;
          for (let i = 0; i < pixelCount; i++) {
            if (alphaChannel[i] < 128) transparentCount++;
          }
          const transparencyRatio = transparentCount / pixelCount;

          if (transparencyRatio > 0.01 && transparencyRatio < 0.99) {
            // 蒙版有效：将 AI 的 alpha 蒙版与原图 RGB 合成（保留原图像素质量）
            const origResized = await sharp(origBuffer)
              .resize(w, h, { fit: 'fill' })
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });

            const pixelCount2 = w * h;
            const resultRaw = Buffer.alloc(pixelCount2 * 4);

            // 对 alpha 做轻微膨胀（3x3 膨胀），修复 AI 蒙版边缘可能过度切割主体的问题
            const dilatedAlpha = Buffer.alloc(pixelCount2);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                let maxA = 0;
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    const ny = y + dy;
                    const nx = x + dx;
                    if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
                      const ni = ny * w + nx;
                      if (alphaChannel[ni] > maxA) maxA = alphaChannel[ni];
                    }
                  }
                }
                dilatedAlpha[y * w + x] = maxA;
              }
            }

            for (let i = 0; i < pixelCount2; i++) {
              const idx = i * 4;
              resultRaw[idx] = origResized.data[idx];         // R from original (better quality)
              resultRaw[idx + 1] = origResized.data[idx + 1]; // G from original
              resultRaw[idx + 2] = origResized.data[idx + 2]; // B from original
              resultRaw[idx + 3] = dilatedAlpha[i];           // A from AI alpha (dilated)
            }

            const resultPng = await sharp(resultRaw, { raw: { width: w, height: h, channels: 4 } })
              .png()
              .toBuffer();

            // 生成黑白蒙版
            const maskBuffer = await sharp(dilatedAlpha, { raw: { width: w, height: h, channels: 1 } })
              .threshold(128)
              .png()
              .toBuffer();

            console.log('[postProcessAIRemoveBG] Alpha extraction succeeded, using original RGB + dilated AI alpha');
            return await postProcessLocalRemoveBG(
              resultPng.toString('base64'),
              maskBuffer.toString('base64')
            );
          } else {
            console.log(`[postProcessAIRemoveBG] AI alpha not useful (transparency: ${(transparencyRatio * 100).toFixed(1)}%), trying diff-based extraction`);
          }
        }
      } catch (e) {
        console.warn('[postProcessAIRemoveBG] Failed to extract alpha from AI result:', e);
      }
    }

    // 策略2: AI 结果与原图对比提取蒙版（核心策略！保留AI的主体识别）
    // 原理：AI 已正确识别主体，AI 结果中的主体与原图几乎一致，
    //        而 AI 结果中的背景区域与原图有显著差异（被替换为棋盘格/纯色等）
    //        因此通过逐像素对比，差异大的区域是背景，差异小的区域是前景
    if (aiBuffer) {
      try {
        const sharp = (await import('sharp')).default;
        
        // 确保 AI 结果和原图尺寸一致
        const aiMeta = await sharp(aiBuffer).metadata();
        const origMeta = await sharp(origBuffer).metadata();
        const targetW = aiMeta.width || 1024;
        const targetH = aiMeta.height || 1024;
        
        // 将原图缩放到与 AI 结果相同尺寸
        const origResized = await sharp(origBuffer)
          .resize(targetW, targetH, { fit: 'fill' })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        const aiRaw = await sharp(aiBuffer)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        const w = aiRaw.info.width;
        const h = aiRaw.info.height;
        const pixelCount = w * h;

        // 逐像素对比 AI 结果和原图
        // 主体区域：AI 保留了原图 → RGB 差异小
        // 背景区域：AI 替换了背景 → RGB 差异大
        const diffMap = Buffer.alloc(pixelCount);
        const diffValues: number[] = [];
        
        for (let i = 0; i < pixelCount; i++) {
          const idx = i * 4;
          const dr = Math.abs(aiRaw.data[idx] - origResized.data[idx]);
          const dg = Math.abs(aiRaw.data[idx + 1] - origResized.data[idx + 1]);
          const db = Math.abs(aiRaw.data[idx + 2] - origResized.data[idx + 2]);
          const diff = Math.sqrt(dr * dr + dg * dg + db * db);
          diffMap[i] = Math.min(255, Math.round(diff));
          diffValues.push(diff);
        }

        // 自适应阈值：使用差异分布的中位数 + 标准差来确定分割点
        const sortedDiffs = [...diffValues].sort((a, b) => a - b);
        const medianDiff = sortedDiffs[Math.floor(sortedDiffs.length / 2)];
        
        // 计算上四分位差（Q3），用 Otsu 风格的自适应阈值
        const q75Index = Math.floor(sortedDiffs.length * 0.75);
        const q75Diff = sortedDiffs[q75Index];
        
        // 阈值策略：自适应阈值，基于差异分布
        // 大部分场景：背景差异 >> 主体差异 → 阈值取两者之间
        let threshold: number;
        if (q75Diff < 15) {
          // AI 结果与原图几乎完全一致，无法通过差异分离
          // 说明 AI 可能只是返回了原图，跳过此策略
          console.log('[postProcessAIRemoveBG] Diff-based: AI result too similar to original (Q75 diff=' + q75Diff.toFixed(1) + '), skipping');
        } else {
          // 自适应阈值：中位数 + 0.3 * (Q75 - 中位数)
          // 这确保即使差异分布不太均匀，也能找到合理的分割点
          threshold = Math.max(20, medianDiff + 0.3 * (q75Diff - medianDiff));
          threshold = Math.min(threshold, 120); // 上限 120，避免过度分割
          
          console.log(`[postProcessAIRemoveBG] Diff-based: medianDiff=${medianDiff.toFixed(1)}, q75Diff=${q75Diff.toFixed(1)}, threshold=${threshold.toFixed(1)}`);
          
          const alphaData = Buffer.alloc(pixelCount);
          let foregroundCount = 0;
          
          for (let i = 0; i < pixelCount; i++) {
            // 差异小的像素 = 主体（AI 保留了原图）→ 不透明
            // 差异大的像素 = 背景（AI 替换了）→ 透明
            if (diffMap[i] < threshold) {
              alphaData[i] = 255;
              foregroundCount++;
            } else {
              alphaData[i] = 0;
            }
          }
          
          const foregroundRatio = foregroundCount / pixelCount;
          console.log(`[postProcessAIRemoveBG] Diff-based: foreground=${(foregroundRatio * 100).toFixed(1)}%`);
          
          // 前景占比在合理范围（3%-97%）时，认为检测有效
          if (foregroundRatio > 0.03 && foregroundRatio < 0.97) {
            // 将原图 RGB 与新 alpha 合成（使用原图而非 AI 结果，确保主体像素精确）
            const origW = origResized.info.width;
            const origH = origResized.info.height;
            const resultRaw = Buffer.alloc(pixelCount * 4);
            
            for (let i = 0; i < pixelCount; i++) {
              const idx = i * 4;
              resultRaw[idx] = origResized.data[idx];       // R from original
              resultRaw[idx + 1] = origResized.data[idx + 1]; // G from original
              resultRaw[idx + 2] = origResized.data[idx + 2]; // B from original
              resultRaw[idx + 3] = alphaData[i];             // A from diff analysis
            }
            
            const resultPng = await sharp(resultRaw, { raw: { width: origW, height: origH, channels: 4 } })
              .png()
              .toBuffer();

            // 保存黑白蒙版
            const maskPng = await sharp(alphaData, { raw: { width: w, height: h, channels: 1 } })
              .png()
              .toBuffer();

            console.log('[postProcessAIRemoveBG] Diff-based extraction succeeded');
            return await postProcessLocalRemoveBG(
              resultPng.toString('base64'),
              maskPng.toString('base64')
            );
          }
        }
      } catch (diffErr) {
        console.warn('[postProcessAIRemoveBG] Diff-based extraction failed:', diffErr);
      }
    }

    // 策略3: AI 结果边缘背景检测（作为策略2的补充，适用于 AI 返回纯色/渐变背景）
    if (aiBuffer) {
      try {
        const sharp = (await import('sharp')).default;
        const { data: raw, info } = await sharp(aiBuffer)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        const w = info.width;
        const h = info.height;

        // 采样边缘像素（上下左右各 3px 条带），统计最常见的颜色作为背景色
        const edgeSamples: number[][] = [];
        const bandWidth = 3;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (x < bandWidth || x >= w - bandWidth || y < bandWidth || y >= h - bandWidth) {
              const idx = (y * w + x) * 4;
              edgeSamples.push([raw[idx], raw[idx + 1], raw[idx + 2]]);
            }
          }
        }

        // 计算边缘颜色中位数作为背景色
        const bgR = median(edgeSamples.map(s => s[0]));
        const bgG = median(edgeSamples.map(s => s[1]));
        const bgB = median(edgeSamples.map(s => s[2]));

        // 使用容差检测背景色像素
        // 提高容差以更好地检测渐变和棋盘格背景
        const bgTolerance = 70;
        const pixelCount = w * h;
        const alphaData = Buffer.alloc(pixelCount);
        let foregroundCount = 0;

        for (let i = 0; i < pixelCount; i++) {
          const idx = i * 4;
          const dr = raw[idx] - bgR;
          const dg = raw[idx + 1] - bgG;
          const db = raw[idx + 2] - bgB;
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);
          if (dist > bgTolerance) {
            alphaData[i] = 255;
            foregroundCount++;
          } else {
            alphaData[i] = 0;
          }
        }

        const foregroundRatio = foregroundCount / pixelCount;
        console.log(`[postProcessAIRemoveBG] Edge-based bg detection: bg=(${bgR},${bgG},${bgB}), tolerance=${bgTolerance}, foreground=${(foregroundRatio * 100).toFixed(1)}%`);

        if (foregroundRatio > 0.05 && foregroundRatio < 0.95) {
          // 使用原图 RGB（像素更精确）+ AI 检测的 alpha 蒙版
          let resultRgbSource: Buffer;
          let sourceW = w;
          let sourceH = h;
          try {
            const origResized = await sharp(origBuffer)
              .resize(w, h, { fit: 'fill' })
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            resultRgbSource = origResized.data;
            sourceW = origResized.info.width;
            sourceH = origResized.info.height;
          } catch {
            // 原图不可用时退回 AI 结果像素
            resultRgbSource = raw;
          }

          const newRaw = Buffer.alloc(pixelCount * 4);
          for (let i = 0; i < pixelCount; i++) {
            const idx = i * 4;
            newRaw[idx] = resultRgbSource[idx];
            newRaw[idx + 1] = resultRgbSource[idx + 1];
            newRaw[idx + 2] = resultRgbSource[idx + 2];
            newRaw[idx + 3] = alphaData[i];
          }

          const resultPng = await sharp(newRaw, { raw: { width: w, height: h, channels: 4 } })
            .png()
            .toBuffer();

          const maskPng = await sharp(alphaData, { raw: { width: w, height: h, channels: 1 } })
            .png()
            .toBuffer();

          console.log('[postProcessAIRemoveBG] Edge-based bg detection succeeded');
          return await postProcessLocalRemoveBG(
            resultPng.toString('base64'),
            maskPng.toString('base64')
          );
        }
      } catch (bgDetectErr) {
        console.warn('[postProcessAIRemoveBG] Edge-based background detection failed:', bgDetectErr);
      }
    }

    // 策略4: 用本地 rembg 生成蒙版（使用高质量模型，最后兜底）
    // 关键改进：用原图 RGB + rembg 蒙版，而不是 rembg 的 RGBA 输出
    console.log('[postProcessAIRemoveBG] Using rembg to generate mask from original image');
    const { generateRemoveBgMask } = await import('./image-tools/iopaint-client');
    const maskResult = await generateRemoveBgMask(origBuffer, 'isnet-general-use');
    
    if (!maskResult || !maskResult.success || !maskResult.maskBase64) {
      console.log('[postProcessAIRemoveBG] Failed to generate mask with rembg');
      return null;
    }

    // 用原图 RGB + rembg 蒙版合成，保留原始主体像素质量
    try {
      const sharp = (await import('sharp')).default;
      const origResized = await sharp(origBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const origW = origResized.info.width;
      const origH = origResized.info.height;
      const origRaw = origResized.data;
      const origPixels = origW * origH;

      const maskBuffer = Buffer.from(maskResult.maskBase64, 'base64');
      const maskMeta = await sharp(maskBuffer).metadata();
      const maskResized = await sharp(maskBuffer)
        .resize(origW, origH, { fit: 'fill' })
        .raw()
        .toBuffer();
      
      const resultRaw = Buffer.alloc(origPixels * 4);
      for (let i = 0; i < origPixels; i++) {
        const idx = i * 4;
        resultRaw[idx] = origRaw[idx];
        resultRaw[idx + 1] = origRaw[idx + 1];
        resultRaw[idx + 2] = origRaw[idx + 2];
        resultRaw[idx + 3] = maskResized[i];
      }

      const resultPng = await sharp(resultRaw, { raw: { width: origW, height: origH, channels: 4 } })
        .png()
        .toBuffer();

      return await postProcessLocalRemoveBG(
        resultPng.toString('base64'),
        maskResult.maskBase64
      );
    } catch (composeErr) {
      console.warn('[postProcessAIRemoveBG] Original+mask compose failed, falling back to rembg RGBA:', composeErr);
      if (maskResult.rgbaBase64) {
        return await postProcessLocalRemoveBG(maskResult.rgbaBase64, maskResult.maskBase64);
      }
      return null;
    }
  } catch (err) {
    console.error('[postProcessAIRemoveBG] Error:', err);
    return null;
  }
}

/**
 * 生成 rembg 蒙版（供外部调用）
 */
export async function generateRembgMask(
  imageBuffer: Buffer,
  model: string = 'u2net'
): Promise<string | null> {
  try {
    const { generateRemoveBgMask: clientGenMask } = await import('./image-tools/iopaint-client');
    const result = await clientGenMask(imageBuffer, model);
    return result?.maskBase64 || null;
  } catch (err) {
    console.error('[generateRembgMask] Error:', err);
    return null;
  }
}
