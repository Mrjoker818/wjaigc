/**
 * QR 码解码工具 - 客户端版本
 * 
 * 仅使用浏览器 Canvas API + jsQR，不依赖 sharp/Node.js
 * 用于管理员工作台前端自动解码收款码
 */
import jsQR from 'jsqr';

/**
 * 从图片 URL 中解码 QR 码（客户端版本，使用 Canvas）
 */
export async function decodeQrFromUrlClient(imageUrl: string): Promise<string | null> {
  try {
    // 加载图片
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = imageUrl;
    });

    // 绘制到 Canvas 提取像素
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // jsQR 解码
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    if (code && code.data) {
      console.log('[qr-decode-client] 解码成功:', code.data.substring(0, 50) + '...');
      return code.data;
    }

    console.log('[qr-decode-client] 未检测到 QR 码');
    return null;
  } catch (error) {
    console.error('[qr-decode-client] 解码失败:', error);
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
