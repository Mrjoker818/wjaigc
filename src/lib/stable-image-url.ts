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

    if (!/^https?:\/\//i.test(imageUrl)) {
      return imageUrl;
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
