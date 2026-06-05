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

// 缓存已持久化的远程 URL → 本地 URL 映射，避免重复持久化
const persistedRemoteUrls = new Map<string, string>();

// 正在持久化中的 URL 集合，防止重复请求
const persistingUrls = new Set<string>();

// 监听持久化完成的回调列表（用于画布图片URL更新）
type PersistCompleteListener = (originalUrl: string, localUrl: string) => void;
const persistListeners: PersistCompleteListener[] = [];

/**
 * 注册持久化完成监听器，当远程URL持久化为本地URL时通知
 */
export function onPersistComplete(listener: PersistCompleteListener): () => void {
  persistListeners.push(listener);
  return () => {
    const idx = persistListeners.indexOf(listener);
    if (idx >= 0) persistListeners.splice(idx, 1);
  };
}

/**
 * 在后台异步持久化远程 URL，不阻塞当前渲染
 * 完成后更新缓存并通知监听器
 */
function persistRemoteUrlInBackground(imageUrl: string): void {
  // 已缓存或正在持久化，跳过
  if (persistedRemoteUrls.has(imageUrl) || persistingUrls.has(imageUrl)) return;

  persistingUrls.add(imageUrl);

  // 使用 save-image API 持久化
  (async () => {
    try {
      const response = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.url && typeof data.url === 'string') {
          persistedRemoteUrls.set(imageUrl, data.url);
          // 限制缓存大小
          if (persistedRemoteUrls.size > 500) {
            const firstKey = persistedRemoteUrls.keys().next().value;
            if (firstKey) persistedRemoteUrls.delete(firstKey);
          }
          // 通知监听器
          for (const listener of persistListeners) {
            try { listener(imageUrl, data.url); } catch {}
          }
          return;
        }
      }
    } catch {
      // save-image 失败，尝试 cache-image 兜底
    }

    try {
      const cacheResponse = await fetch('/api/cache-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      const cacheData = await cacheResponse.json();
      if (cacheData?.success && typeof cacheData.imageUrl === 'string') {
        persistedRemoteUrls.set(imageUrl, cacheData.imageUrl);
        for (const listener of persistListeners) {
          try { listener(imageUrl, cacheData.imageUrl); } catch {}
        }
      }
    } catch {
      // 兜底也失败，忽略
    } finally {
      persistingUrls.delete(imageUrl);
    }
  })();
}

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

    // ★ 远程 URL：检查是否已持久化过
    const cachedLocal = persistedRemoteUrls.get(imageUrl);
    if (cachedLocal) return cachedLocal;

    // ★ 关键优化：立即返回远程 URL，让浏览器先显示图片
    // 同时在后台异步持久化，完成后通过 onPersistComplete 通知画布更新
    persistRemoteUrlInBackground(imageUrl);

    return imageUrl; // 先返回远程 URL，不阻塞渲染
  } catch (error) {
    console.warn('Failed to stabilize image URL:', error);
    return imageUrl;
  }
}

/**
 * 获取已缓存的本地 URL（同步），如果没有缓存则返回原始 URL
 * 用于组件渲染时快速获取最优 URL，不触发网络请求
 */
export function getCachedLocalUrl(imageUrl: string): string {
  if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) return imageUrl;
  if (!/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return persistedRemoteUrls.get(imageUrl) || imageUrl;
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
