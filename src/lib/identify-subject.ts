/**
 * AI Vision Image Subject Identifier
 *
 * Uses a chat/vision model to identify the main subject in an image.
 * Used by refine-engine, generate (IMG2IMG), and other routes to anchor
 * subject identity before image generation, preventing misidentification
 * (e.g. medicine bottle → cosmetics).
 *
 * The function finds an available chat model from admin-configured providers
 * and sends the image with a focused identification prompt.
 */
import { findProviderForFeature, getApiProviders } from './server-api-config';
import { fetchWithV1Retry } from './api-helpers';
import type { ModelInfo } from './universal-api-types';

const IDENTIFY_PROMPT = `Identify the main product/object in this image. Focus on: what is it exactly (product type, specific category), NOT what it resembles. For example: "a white medicine bottle with blue label", NOT "a cosmetic container". Be precise about the product category — distinguish between medicine, cosmetics, food, beverages, chemicals, etc.

Reply in this exact format:
EN: [English identification phrase, 5-15 words]
ZH: [Chinese identification phrase, 5-20 characters]

Example:
EN: a white medicine bottle with blue label
ZH: 白色药瓶带蓝色标签`;

interface IdentifyResult {
  /** English subject description */
  en: string;
  /** Chinese subject description */
  zh: string;
}

/** Extract model ID strings from provider's model lists */
function getModelIds(provider: { selectedModels?: string[]; discoveredModels?: ModelInfo[] }): string[] {
  const selected = (provider.selectedModels || []) as string[];
  const discovered = (provider.discoveredModels || []).map((m: ModelInfo) => m.id);
  // Merge and deduplicate
  return [...new Set([...selected, ...discovered])];
}

/** Check if a model ID is a chat/vision model (not image generation) */
function isChatModel(modelId: string): boolean {
  const imageKeywords = ['dall-e', 'flux', 'stable-diffusion', 'midjourney', 'sd3', 'sdxl', 'kandinsky', 'playground', 'ideogram'];
  return !imageKeywords.some(kw => modelId.toLowerCase().includes(kw));
}

/**
 * Find an available chat model provider for vision identification
 */
async function findChatProvider(): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
  // 1. Try findProviderForFeature('chat') first
  const chatProvider = await findProviderForFeature('chat');
  if (chatProvider?.apiKey) {
    const chatModels = getModelIds(chatProvider).filter(isChatModel);
    if (chatModels.length > 0) {
      return {
        baseUrl: chatProvider.baseUrl,
        apiKey: chatProvider.apiKey,
        model: chatModels[0],
      };
    }
  }

  // 2. Try all providers for any chat model
  const providers = await getApiProviders();
  for (const p of providers) {
    if (!p.apiKey || !p.isEnabled) continue;
    const models = getModelIds(p).filter(isChatModel);
    if (models.length > 0) {
      return {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        model: models[0],
      };
    }
  }

  return null;
}

/**
 * Convert an image URL to base64 data URL for vision API
 */
async function imageToBase64(imageUrl: string): Promise<string | null> {
  try {
    // Already a data URL
    if (imageUrl.startsWith('data:')) return imageUrl;

    // Local file path
    if (imageUrl.startsWith('/api/serve-upload/') || imageUrl.startsWith('/uploads/')) {
      const fs = await import('fs/promises');
      const path = await import('path');
      const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
      const publicDir = path.join(workspacePath, 'public');

      // Extract relative path (e.g. "uploads/gen-xxx.png")
      let relativePath = '';
      if (imageUrl.startsWith('/api/serve-upload/')) {
        relativePath = imageUrl.replace('/api/serve-upload/', '');
      } else {
        relativePath = imageUrl.replace(/^\//, '');
      }

      // Try multiple directories (same logic as serve-upload route)
      const possiblePaths = [
        path.join(publicDir, relativePath),                          // public/uploads/gen-xxx.png
        path.join(publicDir, 'uploads', relativePath),              // public/uploads/uploads/gen-xxx.png (legacy)
      ];
      // Also try server data root if available
      try {
        const { getServerDataRoot } = await import('./server-data-root');
        const dataRoot = getServerDataRoot();
        possiblePaths.push(
          path.join(dataRoot, relativePath),                        // dataRoot/uploads/gen-xxx.png
          path.join(dataRoot, 'uploads', path.basename(relativePath)), // dataRoot/uploads/gen-xxx.png
        );
      } catch { /* server-data-root not available */ }

      for (const filePath of possiblePaths) {
        try {
          const buffer = await fs.readFile(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
          return `data:${mime};base64,${buffer.toString('base64')}`;
        } catch { /* try next path */ }
      }
      console.warn(`[identify-subject] File not found in any location for: ${imageUrl}`);
      return null;
    }

    // HTTP URL
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return null;
      const contentType = resp.headers.get('content-type') || 'image/png';
      const buffer = Buffer.from(await resp.arrayBuffer());
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    }

    return null;
  } catch (err) {
    console.warn('[identify-subject] Failed to convert image to base64:', err);
    return null;
  }
}

/**
 * Identify the main subject in an image using AI vision
 *
 * @param imageUrl - URL or path of the image to identify
 * @param timeoutMs - Timeout in milliseconds (default 15s)
 * @returns Subject description in English and Chinese, or null if identification fails
 */
export async function identifyImageSubject(
  imageUrl: string,
  timeoutMs: number = 15000,
): Promise<IdentifyResult | null> {
  try {
    const provider = await findChatProvider();
    if (!provider) {
      console.warn('[identify-subject] No chat model provider available for vision identification');
      return null;
    }

    const base64 = await imageToBase64(imageUrl);
    if (!base64) {
      console.warn('[identify-subject] Failed to convert image to base64');
      return null;
    }

    const requestBody = {
      model: provider.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: IDENTIFY_PROMPT },
            { type: 'image_url', image_url: { url: base64 } },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.1,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchWithV1Retry(
        provider.baseUrl,
        '/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
        true,
        timeoutMs,
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[identify-subject] Vision API error:', response.status);
        return null;
      }

      // Handle both streaming and non-streaming responses
      const responseText = await response.text();

      // Try parsing as JSON first
      let content = '';
      try {
        const json = JSON.parse(responseText);
        content = json.choices?.[0]?.message?.content || '';
      } catch {
        // Try parsing as SSE stream
        const lines = responseText.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const chunk = JSON.parse(line.slice(6));
              const delta = chunk.choices?.[0]?.delta?.content || '';
              content += delta;
            } catch { /* skip */ }
          }
        }
      }

      if (!content) {
        console.warn('[identify-subject] Vision API returned empty content');
        return null;
      }

      // Clean up the content - remove quotes, extra whitespace
      content = content.trim().replace(/^["']|["']$/g, '');

      // Parse bilingual response (EN: xxx / ZH: xxx format)
      let enDesc = content;
      let zhDesc = content;

      const enMatch = content.match(/EN:\s*(.+?)(?:\n|ZH:|$)/i);
      const zhMatch = content.match(/ZH:\s*(.+?)$/im);
      if (enMatch) enDesc = enMatch[1].trim();
      if (zhMatch) zhDesc = zhMatch[1].trim();

      console.info(`[identify-subject] Identified: en="${enDesc}", zh="${zhDesc}"`);
      return {
        en: enDesc,
        zh: zhDesc || enDesc,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    console.warn('[identify-subject] Identification failed:', err);
    return null;
  }
}
