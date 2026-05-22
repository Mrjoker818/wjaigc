function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image blob'));
    reader.readAsDataURL(blob);
  });
}

// 缓存已验证的本地路径，避免重复 HEAD 请求
const verifiedLocalPaths = new Map<string, boolean>();

export async function toStableImageUrl(imageUrl: string): Promise<string> {
  if (!imageUrl || imageUrl.startsWith('data:')) return imageUrl;

  try {
    if (imageUrl.startsWith('blob:')) {
      const response = await fetch(imageUrl);
      return await blobToDataUrl(await response.blob());
    }

    // 本地相对路径：检查缓存，避免每次都发 HEAD 请求
    if (!/^https?:\/\//i.test(imageUrl)) {
      const cached = verifiedLocalPaths.get(imageUrl);
      if (cached === true) return imageUrl;

      // 已知 /uploads/ 和 /api/serve-upload/ 路径直接可用，跳过验证
      if (imageUrl.startsWith('/uploads/') || imageUrl.startsWith('/api/serve-upload/')) {
        verifiedLocalPaths.set(imageUrl, true);
        return imageUrl;
      }

      const isValid = await verifyLocalImageAccessible(imageUrl);
      verifiedLocalPaths.set(imageUrl, isValid);
      if (isValid) return imageUrl;

      // 尝试 fallback：为非 /api/serve-upload/ 路径补上前缀
      if (!imageUrl.startsWith('/api/serve-upload/')) {
        const fallbackUrl = `/api/serve-upload/${imageUrl.replace(/^\//, '')}`;
        const fallbackCached = verifiedLocalPaths.get(fallbackUrl);
        if (fallbackCached === true) return fallbackUrl;

        const fallbackValid = await verifyLocalImageAccessible(fallbackUrl);
        verifiedLocalPaths.set(fallbackUrl, fallbackValid);
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
