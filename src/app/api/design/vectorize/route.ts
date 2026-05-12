import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getServerDataRoot } from '@/lib/server-data-root';
import fsSync from 'fs';
import path from 'path';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeMode(value: unknown) {
  const mode = String(value || 'auto').toLowerCase();
  return ['auto', 'logo', 'illustration', 'photo', 'line-art'].includes(mode) ? mode : 'auto';
}

/**
 * Resolve an image URL to a Buffer for APIs that need raw image data.
 * Handles local paths, data URLs, and external URLs.
 */
async function resolveImageToBuffer(imageUrl: string): Promise<Buffer | null> {
  try {
    // Data URL - extract base64 part
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
      return match ? Buffer.from(match[1], 'base64') : null;
    }

    // Blob URL - cannot be resolved server-side
    if (imageUrl.startsWith('blob:')) {
      console.warn('[vectorize] Blob URLs cannot be resolved server-side');
      return null;
    }

    // Local path - read from filesystem
    if (imageUrl.startsWith('/')) {
      const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';

      // Try direct public path
      const localPath = path.join(workspacePath, 'public', imageUrl);
      if (fsSync.existsSync(localPath)) {
        return fsSync.readFileSync(localPath);
      }

      // /api/serve-upload/filename → search upload directories
      const serveUploadMatch = imageUrl.match(/^\/api\/serve-upload\/(.+)$/);
      if (serveUploadMatch) {
        const filename = serveUploadMatch[1];
        const dataRoot = getServerDataRoot();
        const uploadDirs = [
          path.join(dataRoot, 'uploads'),
          path.join(workspacePath, 'public', 'uploads'),
        ];
        for (const dir of uploadDirs) {
          const filePath = path.join(dir, filename);
          if (fsSync.existsSync(filePath)) {
            return fsSync.readFileSync(filePath);
          }
        }
      }

      // Fallback: fetch from localhost
      const fullUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}`;
      const response = await fetch(fullUrl, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
      console.warn('[vectorize] Failed to fetch local image:', imageUrl);
      return null;
    }

    // External URL - fetch
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.warn('[vectorize] Could not resolve image to buffer:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Build a publicly accessible URL for a local image path. */
function buildPublicImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:')) {
    return imageUrl;
  }
  const port = process.env.DEPLOY_RUN_PORT || 5000;
  return `http://localhost:${port}${imageUrl}`;
}

/** Detect MIME type from image URL or buffer header */
function detectImageMime(imageUrl: string, buffer: Buffer): string {
  // Check URL extension
  const ext = imageUrl.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  // Check buffer magic bytes
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[4] === 0x57 && buffer[5] === 0x45) return 'image/webp';
  return 'image/png'; // default
}

/**
 * Extract SVG content from a text response.
 * Handles markdown code blocks, raw SVG, and JSON responses.
 */
function extractSvgFromText(text: string): string | null {
  // Remove markdown code block if present
  let cleaned = text.trim();
  const codeBlockMatch = cleaned.match(/```(?:svg|xml|html)?\s*\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Check if it contains SVG
  const svgStart = cleaned.indexOf('<svg');
  if (svgStart === -1) {
    // Try looking for XML declaration before svg
    const xmlStart = cleaned.indexOf('<?xml');
    if (xmlStart !== -1) {
      const svgAfterXml = cleaned.indexOf('<svg', xmlStart);
      if (svgAfterXml !== -1) {
        cleaned = cleaned.substring(xmlStart);
      } else {
        return null;
      }
    } else {
      return null;
    }
  } else {
    cleaned = cleaned.substring(svgStart);
  }

  // Ensure the SVG is properly closed
  const svgEnd = cleaned.lastIndexOf('</svg>');
  if (svgEnd !== -1) {
    cleaned = cleaned.substring(0, svgEnd + 6); // +6 for </svg>
  }

  return cleaned;
}

/**
 * Strategy 1: Multipart form-data (Vectorizer.AI / VTracer style API).
 */
async function tryMultipartVectorize(
  baseUrl: string,
  apiKey: string,
  imageBuffer: Buffer,
  imageUrl: string,
  model: string,
): Promise<{ svg: string; engine: string } | null> {
  const mime = detectImageMime(imageUrl, imageBuffer);

  // Build multipart form-data manually
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const parts: Buffer[] = [];

  // image field (binary)
  const imageHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="image.${mime.split('/')[1]}"\r\nContent-Type: ${mime}\r\n\r\n`
  );
  parts.push(imageHeader);
  parts.push(imageBuffer);
  parts.push(Buffer.from('\r\n'));

  // model field
  if (model) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
    ));
  }

  // mode / output.type fields
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="output.type"\r\n\r\nsvg\r\n`
  ));

  // End boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  // Try /vectorize with multipart form-data
  for (const basePath of ['', '/v1']) {
    try {
      const url = `${baseUrl}${basePath}/vectorize`;
      console.log('[vectorize] Trying multipart POST:', url);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(120000),
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        let svgContent: string;

        if (contentType.includes('image/svg') || contentType.includes('text/xml') || contentType.includes('text/plain')) {
          svgContent = await response.text();
        } else {
          // JSON response
          const data = await response.json() as Record<string, unknown>;
          if (data.svg) {
            svgContent = String(data.svg);
          } else if (data.data) {
            const dataList = data.data as Array<Record<string, string>>;
            if (dataList[0]?.b64_json) {
              svgContent = Buffer.from(String(dataList[0].b64_json), 'base64').toString('utf-8');
            } else if (dataList[0]?.url) {
              const svgResp = await fetch(String(dataList[0].url), { signal: AbortSignal.timeout(15000) });
              svgContent = await svgResp.text();
            } else {
              console.warn('[vectorize] Multipart response OK but no SVG found:', JSON.stringify(data).substring(0, 200));
              continue;
            }
          } else {
            console.warn('[vectorize] Multipart response OK but no SVG found:', JSON.stringify(data).substring(0, 200));
            continue;
          }
        }

        if (svgContent.includes('<svg')) {
          return { svg: svgContent, engine: `vectorize-api${basePath}` };
        }
        console.warn('[vectorize] Multipart response did not contain <svg>');
      } else {
        const errText = await response.text().catch(() => '');
        console.warn('[vectorize] Multipart endpoint returned non-OK:', url, response.status, errText.substring(0, 200));
      }
    } catch (e) {
      console.warn('[vectorize] Multipart endpoint failed:', `${baseUrl}${basePath}/vectorize`, e instanceof Error ? e.message : String(e));
    }
  }

  return null;
}

/**
 * Strategy 2: JSON body with image URL and/or base64.
 */
async function tryJsonVectorize(
  baseUrl: string,
  apiKey: string,
  imageUrl: string,
  imageBase64: string | null,
  layerId: string,
  mode: string,
  model: string,
): Promise<{ svg: string; engine: string } | null> {
  const vectorizeRequestBody: Record<string, unknown> = {
    imageUrl: buildPublicImageUrl(imageUrl),
    imageBase64: imageBase64 || undefined,
    layerId,
    mode,
    model: model || undefined,
    target: 'editable-svg',
    policy: {
      mergeTinyFragments: true,
      preserveTextCandidates: true,
      preferClosedPaths: true,
      maxPaletteSize: mode === 'logo' || mode === 'line-art' ? 8 : 24,
    },
  };

  // Try /vectorize JSON
  try {
    const response = await fetchWithV1Retry(baseUrl, '/vectorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(vectorizeRequestBody),
      signal: AbortSignal.timeout(60000),
    });
    if (response.ok) {
      const data = await response.json() as Record<string, unknown>;
      if (data.svg && String(data.svg).includes('<svg')) {
        return { svg: String(data.svg), engine: String(data.engine || 'json-vectorize') };
      }
      if (data.success === false) {
        console.warn('[vectorize] JSON endpoint returned success=false:', data.error);
      }
    }
  } catch (e) {
    console.warn('[vectorize] JSON /vectorize failed:', e instanceof Error ? e.message : String(e));
  }

  return null;
}

/**
 * Parse SSE (Server-Sent Events) stream content from a chat completions response.
 * Extracts the concatenated content from all data chunks.
 */
function parseSSEContent(sseText: string): string | null {
  let fullContent = '';
  for (const line of sseText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const jsonStr = trimmed.slice(6);
    if (jsonStr === '[DONE]') break;
    try {
      const chunk = JSON.parse(jsonStr) as Record<string, unknown>;
      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      if (choices?.[0]) {
        const delta = choices[0].delta as Record<string, string> | undefined;
        if (delta?.content) {
          fullContent += delta.content;
        }
      }
    } catch {
      // Skip malformed chunks
    }
  }
  return fullContent || null;
}

/**
 * Strategy 3: Chat completions with vision - use LLM to generate SVG from image.
 * Works with GPT-4o, Claude, Gemini and other vision-capable models.
 * This is the most universally compatible approach for vectorization via API proxies.
 */
async function tryChatCompletionsVectorize(
  baseUrl: string,
  apiKey: string,
  imageBase64: string | null,
  imageUrl: string,
  mode: string,
  model: string,
): Promise<{ svg: string; engine: string } | null> {
  if (!imageBase64 && !imageUrl.startsWith('http')) {
    console.warn('[vectorize] Chat completions need either imageBase64 or a public imageUrl');
    return null;
  }

  const imageContent: Array<Record<string, unknown>> = [];

  // Add image input
  if (imageBase64) {
    imageContent.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${imageBase64}` },
    });
  } else if (imageUrl.startsWith('http')) {
    imageContent.push({
      type: 'image_url',
      image_url: { url: imageUrl },
    });
  }

  const modeDescriptions: Record<string, string> = {
    'logo': 'a logo/icon with clean geometric shapes and limited colors',
    'line-art': 'line art with clean strokes and minimal fills',
    'illustration': 'an illustration with distinct shapes and moderate color palette',
    'photo': 'a photograph, simplify into distinct color regions and shapes',
    'auto': 'an image, convert to clean vector paths',
  };

  const modeDesc = modeDescriptions[mode] || modeDescriptions['auto'];

  const requestBody = {
    model: model || 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are an expert SVG vector graphics designer. You convert raster images to clean, well-structured SVG code. Output ONLY the SVG code, no explanations, no markdown fences. Start with <svg and end with </svg>.',
      },
      {
        role: 'user',
        content: [
          ...imageContent,
          {
            type: 'text',
            text: `Convert this ${modeDesc} to SVG vector graphics. Requirements:
- Create clean, scalable vector paths
- Use <path> elements with appropriate fill colors
- Preserve the overall composition and key visual elements
- Use reasonable color approximations
- Set viewBox to match the image dimensions
- Do NOT use <image> tags to embed the raster - create actual vector paths
- Output only valid SVG code starting with <svg`,
          },
        ],
      },
    ],
    max_tokens: 16384,
    temperature: 0.1,
    stream: false,
  };

  console.log('[vectorize] Trying chat/completions with model:', model || 'gpt-4o');

  try {
    const response = await fetchWithV1Retry(baseUrl, '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(120000),
    });

    if (response.ok) {
      const responseText = await response.text();
      let content: string | null = null;

      // Try parsing as JSON first
      try {
        const data = JSON.parse(responseText) as Record<string, unknown>;
        const choices = data.choices as Array<Record<string, unknown>> | undefined;
        if (choices?.[0]) {
          const message = choices[0].message as Record<string, string> | undefined;
          content = message?.content || null;
        }
      } catch {
        // If JSON parsing fails, try parsing as SSE stream
        content = parseSSEContent(responseText);
      }

      if (content) {
        const svg = extractSvgFromText(content);
        if (svg) {
          return { svg, engine: `chat-vision-vectorize (${model || 'gpt-4o'})` };
        }
        console.warn('[vectorize] Chat completions returned content without SVG:', content.substring(0, 200));
      }
    } else {
      const errText = await response.text().catch(() => '');
      console.warn('[vectorize] Chat completions returned non-OK:', response.status, errText.substring(0, 200));
    }
  } catch (e) {
    console.warn('[vectorize] Chat completions failed:', e instanceof Error ? e.message : String(e));
  }

  return null;
}

/**
 * Strategy 4: OpenAI images/generations format.
 */
async function tryOpenAIFormat(
  baseUrl: string,
  apiKey: string,
  imageBase64: string | null,
  mode: string,
  model: string,
): Promise<{ svg: string; engine: string } | null> {
  if (!model || !imageBase64) return null;

  try {
    const response = await fetchWithV1Retry(baseUrl, '/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: `Convert image to SVG vector graphics. Mode: ${mode}. Target: editable SVG.`,
        image: `data:image/png;base64,${imageBase64}`,
        response_format: 'b64_json',
        n: 1,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (response.ok) {
      const data = await response.json() as Record<string, unknown>;
      const candidates = data.data as Array<Record<string, string>> | undefined;
      if (candidates?.[0]) {
        const b64 = candidates[0].b64_json;
        const url = candidates[0].url;
        if (b64) {
          const svgContent = Buffer.from(b64, 'base64').toString('utf-8');
          if (svgContent.includes('<svg')) {
            return { svg: svgContent, engine: 'openai-vectorize' };
          }
        }
        if (url) {
          const svgResp = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (svgResp.ok) {
            const svgContent = await svgResp.text();
            if (svgContent.includes('<svg')) {
              return { svg: svgContent, engine: 'openai-vectorize' };
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[vectorize] OpenAI-compatible format failed:', e instanceof Error ? e.message : String(e));
  }

  return null;
}

/**
 * Strategy 5: Try using a chat model provider for vectorization.
 * If no vectorize provider is configured but a chat provider with vision is available,
 * use it to generate SVG from the image.
 */
async function tryChatProviderFallback(
  imageBase64: string | null,
  imageUrl: string,
  mode: string,
): Promise<{ svg: string; engine: string } | null> {
  const chatProvider = await findProviderForFeature('chat');
  if (!chatProvider) return null;

  const rawBaseUrl = chatProvider.baseUrl.replace(/\/+$/, '');
  const baseUrl = normalizeApiBaseUrl(rawBaseUrl);
  const model = chatProvider.selectedModels?.[0] || chatProvider.selectedModel || '';

  console.log('[vectorize] Trying chat provider fallback:', { baseUrl, model });

  return tryChatCompletionsVectorize(baseUrl, chatProvider.apiKey, imageBase64, imageUrl, mode, model);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imageUrl = String(body.imageUrl || '');
    const layerId = String(body.layerId || 'layer');
    const mode = normalizeMode(body.mode);

    if (!imageUrl) {
      return NextResponse.json({ success: false, error: '缺少 imageUrl' }, { status: 400 });
    }

    console.log('[vectorize] Request:', { imageUrl: imageUrl.substring(0, 100), layerId, mode });

    // Pre-resolve image to buffer (needed for multipart form upload and base64)
    const imageBuffer = await resolveImageToBuffer(imageUrl);
    const imageBase64 = imageBuffer ? imageBuffer.toString('base64') : null;
    const publicImageUrl = imageUrl.startsWith('http') ? imageUrl : buildPublicImageUrl(imageUrl);

    // 1. 尝试管理员配置的矢量模型 API
    const vectorizeProvider = await findProviderForFeature('vectorize');
    console.log('[vectorize] Provider lookup result:', vectorizeProvider ? { id: vectorizeProvider.id, name: vectorizeProvider.name, baseUrl: vectorizeProvider.baseUrl, modelType: vectorizeProvider.modelType, selectedModels: vectorizeProvider.selectedModels } : null);

    if (vectorizeProvider) {
      const rawBaseUrl = vectorizeProvider.baseUrl.replace(/\/+$/, '');
      const baseUrl = normalizeApiBaseUrl(rawBaseUrl);
      const model = vectorizeProvider.selectedModels?.[0] || vectorizeProvider.selectedModel || '';
      console.log('[vectorize] Using provider:', { rawBaseUrl, normalizedBaseUrl: baseUrl, model });

      // Strategy 1: Chat completions with vision (most compatible with API proxies like 302.ai)
      const chatResult = await tryChatCompletionsVectorize(baseUrl, vectorizeProvider.apiKey, imageBase64, publicImageUrl, mode, model);
      if (chatResult) {
        return NextResponse.json({ success: true, svg: chatResult.svg, engine: chatResult.engine });
      }

      // Strategy 2: Multipart form-data (Vectorizer.AI / VTracer style API)
      if (imageBuffer) {
        const multipartResult = await tryMultipartVectorize(baseUrl, vectorizeProvider.apiKey, imageBuffer, imageUrl, model);
        if (multipartResult) {
          return NextResponse.json({ success: true, svg: multipartResult.svg, engine: multipartResult.engine });
        }
      }

      // Strategy 3: JSON body with image URL and/or base64
      const jsonResult = await tryJsonVectorize(baseUrl, vectorizeProvider.apiKey, imageUrl, imageBase64, layerId, mode, model);
      if (jsonResult) {
        return NextResponse.json({ success: true, svg: jsonResult.svg, engine: jsonResult.engine });
      }

      // Strategy 4: OpenAI images/generations format
      const openaiResult = await tryOpenAIFormat(baseUrl, vectorizeProvider.apiKey, imageBase64, mode, model);
      if (openaiResult) {
        return NextResponse.json({ success: true, svg: openaiResult.svg, engine: openaiResult.engine });
      }

      console.warn('[vectorize] All admin-configured vectorize API attempts failed');
    }

    // 2. 尝试使用管理员配置的 LLM 模型（带视觉能力）作为 fallback
    const chatFallbackResult = await tryChatProviderFallback(imageBase64, publicImageUrl, mode);
    if (chatFallbackResult) {
      return NextResponse.json({ success: true, svg: chatFallbackResult.svg, engine: chatFallbackResult.engine });
    }

    // 3. 尝试环境变量配置的矢量化端点
    const endpoint = process.env.PY_VECTORIZE_ENDPOINT;
    if (endpoint) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: buildPublicImageUrl(imageUrl),
            imageBase64: imageBase64 || undefined,
            layerId,
            mode,
            target: 'editable-svg',
            policy: {
              mergeTinyFragments: true,
              preserveTextCandidates: true,
              preferClosedPaths: true,
              maxPaletteSize: mode === 'logo' || mode === 'line-art' ? 8 : 24,
            },
          }),
          signal: AbortSignal.timeout(60000),
        });
        if (response.ok) {
          const data = await response.json() as Record<string, unknown>;
          if (data.svg) {
            return NextResponse.json({ success: true, svg: data.svg, engine: 'py-vectorize' });
          }
        }
        console.warn('[vectorize] PY_VECTORIZE_ENDPOINT returned non-OK or no svg');
      } catch (e) {
        console.warn('[vectorize] PY_VECTORIZE_ENDPOINT failed:', e instanceof Error ? e.message : String(e));
      }
    }

    // 4. Safe fallback: raster-backed SVG wrapper
    const safeLayerId = escapeXml(layerId);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%" data-layer-id="${safeLayerId}" data-vector-mode="${escapeXml(mode)}" data-engine="raster-svg-wrapper">
  <defs>
    <clipPath id="clip-${safeLayerId}"><rect x="0" y="0" width="1024" height="1024" /></clipPath>
  </defs>
  <image href="${escapeXml(imageUrl)}" x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid meet" clip-path="url(#clip-${safeLayerId})" />
</svg>`;

    return NextResponse.json({
      success: true,
      engine: 'raster-svg-wrapper',
      editable: false,
      message: '已生成可嵌入的 SVG 容器。配置矢量模型 API 后可切换到真实路径矢量化。',
      svg,
      warnings: ['当前结果保留原图像素，不会伪装成真实矢量路径。'],
    });
  } catch (error) {
    console.error('[vectorize] Fatal error:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'vectorize failed' }, { status: 500 });
  }
}
