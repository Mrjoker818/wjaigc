function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image blob'));
    reader.readAsDataURL(blob);
  });
}

export async function toStableImageUrl(imageUrl: string): Promise<string> {
  if (!imageUrl || imageUrl.startsWith('data:')) return imageUrl;

  try {
    if (imageUrl.startsWith('blob:')) {
      const response = await fetch(imageUrl);
      return await blobToDataUrl(await response.blob());
    }

    // 本地相对路径：尝试直接 fetch 验证可达性，不可达则 fallback 到 /api/serve-upload/ 前缀
    if (!/^https?:\/\//i.test(imageUrl)) {
      const isValid = await verifyLocalImageAccessible(imageUrl);
      if (isValid) return imageUrl;

      // 尝试 fallback：为非 /api/serve-upload/ 路径补上前缀
      if (!imageUrl.startsWith('/api/serve-upload/')) {
        const fallbackUrl = `/api/serve-upload/${imageUrl.replace(/^\//, '')}`;
        const fallbackValid = await verifyLocalImageAccessible(fallbackUrl);
        if (fallbackValid) return fallbackUrl;
      }

      return imageUrl; // 最终 fallback 返回原始路径
    }

    const response = await fetch('/api/cache-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl }),
    });
    const data = await response.json();
    return data?.success && typeof data.imageUrl === 'string' ? data.imageUrl : imageUrl;
  } catch (error) {
    console.warn('Failed to stabilize image URL:', error);
    return imageUrl;
  }
}

/**
 * 校验本地相对路径的图片是否可达
 */
async function verifyLocalImageAccessible(imageUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(imageUrl, { method: 'HEAD' });
    const contentType = resp.headers.get('content-type') || '';
    return resp.ok && contentType.startsWith('image/');
  } catch {
    return false;
  }
}
