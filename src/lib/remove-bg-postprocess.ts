/**
 * RemoveBG 后处理模块
 * 
 * 设计原则（从第一性原理出发，彻底规避 sharp 通道转换 Bug）：
 * 
 * 1. rembg 模型输出概率蒙版（0-255灰度），边缘有自然过渡
 * 2. 所有蒙版处理（膨胀+模糊+应用蒙版）在 Python 端用 PIL/numpy 完成
 * 3. Node.js 端只做一件事：接收 Python 输出的 RGBA PNG → 保存到磁盘 → 返回 URL
 * 4. 不在 Node.js 端做任何 sharp 像素级操作（彻底避免 threshold/blur/convolve 转换通道的 Bug）
 * 
 * 流程：
 * 1. Python rembg 生成概率蒙版 → 膨胀(MaxFilter 5x5 ≈ 2px) → 高斯模糊(1.5px) → 应用蒙版到原图 → 返回 RGBA PNG
 * 2. Node.js 解码 base64 → 保存 PNG → 返回 URL
 */

import { saveImageFile } from './server-data-root';

/**
 * 本地 RemoveBG 后处理（简化版：直接使用 Python 输出的 RGBA PNG）
 * 
 * Python 端已完成所有图像处理（蒙版生成+优化+应用），这里只负责保存文件
 * 
 * @param rgbaBase64 Python 端输出的 RGBA PNG base64
 * @returns 持久化后的透明 PNG URL
 */
export async function postProcessLocalRemoveBG(
  rgbaBase64: string
): Promise<string | null> {
  try {
    // 解码 base64 → PNG Buffer
    const pngBuffer = Buffer.from(rgbaBase64, 'base64');

    // 保存文件
    const timestamp = Date.now();
    const filename = `removebg-${timestamp}.png`;
    const imageUrl = saveImageFile(pngBuffer, filename, 'removebg');

    console.log(`[postProcessLocalRemoveBG] Saved RGBA PNG: ${imageUrl} (${pngBuffer.length} bytes)`);
    return imageUrl;
  } catch (err) {
    console.error('[postProcessLocalRemoveBG] Error:', err);
    return null;
  }
}

/**
 * AI RemoveBG 后处理
 * 
 * AI 模型返回的图片可能含棋盘格背景（不是真透明），
 * 需要用 rembg 生成蒙版后应用到原图
 * 
 * 这里也走 Python 路径：让 Python 生成蒙版并应用到原图，返回 RGBA PNG
 */
export async function postProcessAIRemoveBG(
  _aiResultUrl: string,
  originalImageUrl?: string | Buffer
): Promise<string | null> {
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
      const baseUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
      const fullUrl = originalImageUrl.startsWith('http') ? originalImageUrl : `${baseUrl}${originalImageUrl}`;
      const resp = await fetch(fullUrl);
      if (!resp.ok) throw new Error(`Failed to fetch original: ${resp.status}`);
      origBuffer = Buffer.from(await resp.arrayBuffer());
    }

    // 用本地 rembg 生成蒙版并应用（Python 端完成所有处理）
    const { generateRemoveBgMask } = await import('./image-tools/iopaint-client');
    const maskResult = await generateRemoveBgMask(origBuffer, 'u2net');
    
    if (!maskResult || !maskResult.success || !maskResult.rgbaBase64) {
      console.log('[postProcessAIRemoveBG] Failed to generate RGBA result');
      return null;
    }

    // 直接使用 Python 输出的 RGBA PNG
    return await postProcessLocalRemoveBG(maskResult.rgbaBase64);
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
