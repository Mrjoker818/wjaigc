/**
 * 棋盘格检测与透明化后处理
 * 用于 AI RemoveBG 结果：AI 模型可能返回带有棋盘格背景的图片（而非真正的透明 PNG），
 * 需要检测棋盘格图案并将其替换为透明像素。
 */
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

/**
 * 检测图片中的棋盘格图案，将棋盘格区域替换为透明像素
 * 典型场景：AI 模型（GPT/Gemini）去背景时返回带棋盘格背景的图片，
 * 而不是真正的透明 PNG
 * @param imageUrl 图片 URL（支持 data: URL、相对路径 /uploads/xxx、完整 URL）
 * @returns 处理后的图片 URL（相对路径 /uploads/xxx）
 */
export async function removeCheckerboardAndMakeTransparent(imageUrl: string): Promise<string> {
  // 1. 获取图片数据
  let imageBuffer: Buffer;
  if (imageUrl.startsWith('data:')) {
    const base64Data = imageUrl.split(',')[1];
    imageBuffer = Buffer.from(base64Data, 'base64');
  } else {
    const fetchUrl = imageUrl.startsWith('/') ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}` : imageUrl;
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
    imageBuffer = Buffer.from(await resp.arrayBuffer());
  }

  // 2. 用 sharp 获取 RGBA 原始像素
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const raw = await sharp(imageBuffer).ensureAlpha().raw().toBuffer();

  // 3. 检测棋盘格图案
  // 典型棋盘格：8x8 或 16x16 像素的交替方块，颜色为浅灰(~200)和深灰(~150)
  const CHECKER_SIZE = 8; // 假设 8x8 像素棋盘格
  const COLOR_DIFF_MAX = 30; // 同一块内颜色差异上限（棋盘格是纯灰色，颜色差异小）
  
  let checkerPixels = 0;
  const totalPixels = width * height;
  
  // 创建 alpha 通道数组（默认全部保留）
  const alphaChannel = new Uint8Array(totalPixels).fill(255);

  // 逐像素分析，检测是否属于棋盘格区域
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = raw[idx];
      const g = raw[idx + 1];
      const b = raw[idx + 2];
      
      // 棋盘格特征：灰度图（R≈G≈B），亮度在中灰范围，饱和度极低
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;
      const brightness = (r + g + b) / 3;
      
      // 棋盘格像素特征：低饱和度 + 中等亮度 + 属于交替图案
      if (saturation < 0.15 && brightness >= 100 && brightness <= 230) {
        // 检查该像素是否属于棋盘格交替图案
        const checkerX = Math.floor(x / CHECKER_SIZE);
        const checkerY = Math.floor(y / CHECKER_SIZE);
        
        // 检查该块内的像素颜色是否一致（棋盘格的同一块颜色一致）
        // 取块中心像素颜色
        const centerX = Math.min((checkerX * CHECKER_SIZE) + Math.floor(CHECKER_SIZE / 2), width - 1);
        const centerY = Math.min((checkerY * CHECKER_SIZE) + Math.floor(CHECKER_SIZE / 2), height - 1);
        const centerIdx = (centerY * width + centerX) * 4;
        const cR = raw[centerIdx];
        const cG = raw[centerIdx + 1];
        const cB = raw[centerIdx + 2];
        
        // 当前像素与块中心像素的颜色差异
        const colorDist = Math.abs(r - cR) + Math.abs(g - cG) + Math.abs(b - cB);
        
        if (colorDist < COLOR_DIFF_MAX * 3) {
          // 还需要验证整个图片是否确实存在棋盘格：检查相邻块的颜色差异
          const nextCheckerX = checkerX + 1;
          if (nextCheckerX * CHECKER_SIZE < width) {
            const nextCenterX = Math.min((nextCheckerX * CHECKER_SIZE) + Math.floor(CHECKER_SIZE / 2), width - 1);
            const nextCenterIdx = (centerY * width + nextCenterX) * 4;
            const nR = raw[nextCenterIdx];
            const nG = raw[nextCenterIdx + 1];
            const nB = raw[nextCenterIdx + 2];
            
            // 相邻块应该有亮度差异
            const centerBrightness = (cR + cG + cB) / 3;
            const nextBrightness = (nR + nG + nB) / 3;
            const brightnessDiff = Math.abs(centerBrightness - nextBrightness);
            
            if (brightnessDiff > 15 && brightnessDiff < 120) {
              // 确认是棋盘格像素
              alphaChannel[y * width + x] = 0; // 设为透明
              checkerPixels++;
            }
          }
        }
      }
    }
  }
  
  // 4. 判断图片是否确实包含棋盘格
  const checkerRatio = checkerPixels / totalPixels;
  console.log(`[removeCheckerboard] Detected ${checkerPixels} checker pixels (${(checkerRatio * 100).toFixed(1)}% of image)`);
  
  if (checkerRatio < 0.05) {
    // 棋盘格占比不足 5%，可能不是棋盘格背景，返回原图
    console.log('[removeCheckerboard] Checker ratio too low, returning original image');
    return imageUrl;
  }
  
  // 5. 重建图片，将棋盘格区域设为透明
  const outputRaw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 4;
    outputRaw[dstIdx] = raw[srcIdx];     // R
    outputRaw[dstIdx + 1] = raw[srcIdx + 1]; // G
    outputRaw[dstIdx + 2] = raw[srcIdx + 2]; // B
    outputRaw[dstIdx + 3] = alphaChannel[i]; // A (棋盘格=0, 其他=255)
  }
  
  // 6. 对 alpha 边缘做平滑过渡（抗锯齿）
  // 对 alpha=0 和 alpha=255 的边界像素做 2px 的羽化
  const FEATHER_RADIUS = 2;
  const origAlpha = Buffer.from(alphaChannel);
  for (let y = FEATHER_RADIUS; y < height - FEATHER_RADIUS; y++) {
    for (let x = FEATHER_RADIUS; x < width - FEATHER_RADIUS; x++) {
      const idx = y * width + x;
      if (origAlpha[idx] === 255) {
        // 检查周围是否有透明像素
        let nearbyTransparent = false;
        for (let dy = -FEATHER_RADIUS; dy <= FEATHER_RADIUS && !nearbyTransparent; dy++) {
          for (let dx = -FEATHER_RADIUS; dx <= FEATHER_RADIUS && !nearbyTransparent; dx++) {
            if (origAlpha[(y + dy) * width + (x + dx)] === 0) {
              nearbyTransparent = true;
            }
          }
        }
        if (nearbyTransparent) {
          // 计算到最近透明像素的距离
          let minDist = FEATHER_RADIUS + 1;
          for (let dy = -FEATHER_RADIUS; dy <= FEATHER_RADIUS; dy++) {
            for (let dx = -FEATHER_RADIUS; dx <= FEATHER_RADIUS; dx++) {
              if (origAlpha[(y + dy) * width + (x + dx)] === 0) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                minDist = Math.min(minDist, dist);
              }
            }
          }
          // 根据距离设置 alpha 值（越近越透明）
          if (minDist <= FEATHER_RADIUS) {
            const featherAlpha = Math.round(255 * (minDist / FEATHER_RADIUS));
            outputRaw[idx * 4 + 3] = featherAlpha;
          }
        }
      }
    }
  }
  
  // 7. 输出为 PNG
  const outputBuffer = await sharp(outputRaw, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
  
  // 8. 保存输出文件
  const INPAINT_OUTPUT_DIR = process.env.INPAINT_OUTPUT_DIR || path.join(process.cwd(), 'public', 'uploads');
  const outputId = `removebg-transparent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputFilename = `${outputId}.png`;
  const outputPath = path.join(INPAINT_OUTPUT_DIR, outputFilename);
  await fs.mkdir(INPAINT_OUTPUT_DIR, { recursive: true });
  await fs.writeFile(outputPath, outputBuffer);
  
  const resultUrl = `/uploads/${outputFilename}`;
  console.log(`[removeCheckerboard] Saved transparent PNG: ${resultUrl} (${(checkerRatio * 100).toFixed(1)}% background removed)`);
  return resultUrl;
}
