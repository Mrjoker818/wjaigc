/**
 * QR 码解码工具 - 从收款码图片中自动提取支付链接
 * 
 * 管理员上传微信/支付宝收款码图片后，后端自动解码提取支付链接
 * 用户点击"立即付款"直接跳转到该链接，无需手动扫描收款码
 * 
 * 此文件仅用于服务端（使用 sharp + Node.js Buffer）
 */
import jsQR from 'jsqr';

/**
 * 从图片 Buffer 中解码 QR 码，提取支付链接
 * 使用 jsqr 库 + sharp 读取像素
 */
export async function decodeQrFromBuffer(imageBuffer: Buffer): Promise<string | null> {
  try {
    const sharp = await import('sharp');
    const { data, info } = await sharp.default(imageBuffer)
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;

    // jsQR 需要 RGBA Uint8ClampedArray
    const rgbaData = new Uint8ClampedArray(data);
    const code = jsQR(rgbaData, width, height, {
      inversionAttempts: 'dontInvert',
    });

    if (code && code.data) {
      console.log('[qr-decode] 解码成功:', code.data.substring(0, 50) + '...');
      return code.data;
    }

    console.log('[qr-decode] 未检测到 QR 码');
    return null;
  } catch (error) {
    console.error('[qr-decode] 解码失败:', error);
    return null;
  }
}

/**
 * 从图片 URL 中解码 QR 码（服务端版本，使用 fetch + sharp）
 */
export async function decodeQrFromUrl(imageUrl: string): Promise<string | null> {
  try {
    // 处理相对路径
    let url = imageUrl;
    if (url.startsWith('/api/')) {
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || 'http://localhost:5000';
      url = `${domain}${url}`;
    }
    if (url.startsWith('http://localhost') || url.startsWith('/')) {
      const port = process.env.DEPLOY_RUN_PORT || '5000';
      if (!url.startsWith('http')) {
        url = `http://localhost:${port}${url}`;
      }
    }

    console.log('[qr-decode] 下载图片:', url.substring(0, 80) + '...');
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      console.error('[qr-decode] 下载失败:', response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return await decodeQrFromBuffer(buffer);
  } catch (error) {
    console.error('[qr-decode] URL 解码失败:', error);
    return null;
  }
}

/**
 * 判断解码出的链接是否是支付链接
 */
export function isPaymentLink(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  // 微信支付链接
  if (lower.startsWith('wxp://')) return true;
  // 支付宝支付链接
  if (lower.includes('qr.alipay.com')) return true;
  // 通用 HTTPS 支付链接（部分收款码生成器使用）
  if (lower.startsWith('https://') && (
    lower.includes('pay') || lower.includes('收款') || lower.includes('transfer')
  )) return true;
  return false;
}
