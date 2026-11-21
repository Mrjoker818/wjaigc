import { loadBrowserImageBlob } from './browser-image-blob';

/** Decode the fetched bytes, rather than trusting a filename or Content-Type. */
export async function loadCanvasPngBlob(sourceUrl: string): Promise<Blob> {
  const source = await loadBrowserImageBlob(sourceUrl);
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(source);
  } catch {
    throw new Error('图片解码失败，无法导出 PNG');
  }
  const canvas = document.createElement('canvas');
  try {
    if (!image.width || !image.height) throw new Error('图片尺寸无效，无法导出 PNG');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建 PNG 导出画布');
    // A fresh transparent surface preserves alpha and the decoded source size.
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob || !blob.size || blob.type !== 'image/png') {
          reject(new Error('PNG 编码失败，请重试'));
        } else {
          resolve(blob);
        }
      }, 'image/png');
    });
  } finally {
    image.close();
    canvas.width = canvas.height = 0;
  }
}
