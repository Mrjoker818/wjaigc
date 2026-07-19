import 'server-only';

import { getInternalRequestHeaders } from '@/lib/api-auth';

/** Persist server-generated image data without exposing the internal signer to client bundles. */
export async function persistResultImage(imageUrl: string): Promise<string> {
  try {
    if (imageUrl.startsWith('/api/serve-upload/') || imageUrl.startsWith('/uploads/')) {
      return imageUrl;
    }

    const internalPort = process.env.DEPLOY_RUN_PORT || '5000';
    const saveUrl = `http://localhost:${internalPort}/api/save-image`;
    let persistedImage = imageUrl;

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
      if (!imageResponse.ok) return imageUrl;
      const contentType = imageResponse.headers.get('content-type') || 'image/png';
      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      persistedImage = `data:${contentType};base64,${buffer.toString('base64')}`;
    } else if (!imageUrl.startsWith('data:')) {
      return imageUrl;
    }

    const response = await fetch(saveUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getInternalRequestHeaders('system-save-image', 'admin')),
      },
      body: JSON.stringify({ imageUrl: persistedImage }),
    });
    if (!response.ok) return imageUrl;

    const data = await response.json() as { url?: string };
    return data.url || imageUrl;
  } catch (error) {
    console.warn('[persistResultImage] Failed to persist result image:', error);
    return imageUrl;
  }
}
