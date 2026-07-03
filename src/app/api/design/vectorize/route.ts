import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getServerDataRoot } from '@/lib/server-data-root';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { vectorizePipeline, type VectorizeEngine } from '@/lib/vectorize-pipeline';
import fsSync from 'fs';
import path from 'path';
import sharp from 'sharp';
import { validateApiInputs } from '@/lib/api-validator';
import { logOperation, logError, OP_ACTIONS, startTimer } from '@/lib/op-log';

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
        return await fsSync.promises.readFile(localPath);
      }

      // Try dataRoot path (images stored via save-image API)
      const dataRoot = getServerDataRoot();
      const dataRootPath = path.join(dataRoot, imageUrl);
      if (fsSync.existsSync(dataRootPath)) {
        return await fsSync.promises.readFile(dataRootPath);
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
            return await fsSync.promises.readFile(filePath);
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
 * Sanitize AI-generated SVG for security and quality.
 * Rejects dangerous or invalid SVG content.
 * Returns { safe, reason? } — if safe=false, the SVG should be rejected.
 */
function sanitizeGeneratedSvg(svg: string): { safe: boolean; reason?: string; sanitized?: string } {
  let content = svg;
  // Must contain <svg> tag
  if (!/<svg[\s>]/i.test(content)) {
    return { safe: false, reason: 'Missing <svg> tag' };
  }

  // Detect and strip <text> elements — they cause garbled rendering due to font dependency
  const textElementCount = (content.match(/<text[\s>]/gi) || []).length;
  if (textElementCount > 0) {
    console.warn(`[vectorize] SVG 包含 ${textElementCount} 个 <text> 元素，将尝试移除`);
    content = content.replace(/<text[^>]*>[\s\S]*?<\/text>/gi, '').replace(/<text[^>]*\/>/gi, '');
  }

  // Security checks — reject dangerous content
  const dangerousPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /<script[\s>]/i, label: '<script> tag' },
    { pattern: /<foreignObject[\s>]/i, label: '<foreignObject> tag' },
    { pattern: /<image[\s>]/i, label: '<image> tag (raster embedding)' },
    { pattern: /\bon\w+\s*=/i, label: 'event handler (onclick, etc.)' },
    { pattern: /xlink:href\s*=\s*["'](?!data:)[^"']+["']/i, label: 'external href' },
    { pattern: /href\s*=\s*["'](?!data:|#)[^"']+["']/i, label: 'external href' },
    { pattern: /<style[^>]*>[\s\S]*?url\s*\(/i, label: 'CSS with external url()' },
  ];

  for (const { pattern, label } of dangerousPatterns) {
    if (pattern.test(svg)) {
      return { safe: false, reason: `Dangerous content detected: ${label}` };
    }
  }

  // Check base64 embedding
  const base64Count = (svg.match(/data:[^;]+;base64,/g) || []).length;
  if (base64Count > 2) {
    return { safe: false, reason: `Too many base64 embeddings (${base64Count})` };
  }

  // Check viewBox exists
  if (!/viewBox\s*=/.test(svg)) {
    return { safe: false, reason: 'Missing viewBox attribute' };
  }

  // Check graphic element count
  const graphicElements = content.match(/<(?:path|circle|ellipse|rect|line|polyline|polygon|g|defs|linearGradient|radialGradient|stop|use|clipPath|mask)\b/gi) || [];
  if (graphicElements.length === 0) {
    return { safe: false, reason: 'No graphic elements found' };
  }

  // Path count quality control
  const pathCount = (content.match(/<path\b/gi) || []).length;
  if (pathCount > 900) {
    return { safe: false, reason: `Too many paths (${pathCount}), this asset is better kept as PNG` };
  }

  return { safe: true, sanitized: content };
}

/**
 * Normalize SVG: ensure consistent viewBox, width, height attributes.
 * Returns the normalized SVG string.
 */
function normalizeVectorSvg(svg: string, targetWidth: number, targetHeight: number): string {
  // Ensure viewBox exists and matches target dimensions
  const viewBoxMatch = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  let viewBox: string;

  if (viewBoxMatch) {
    // Use existing viewBox — it defines the coordinate space
    viewBox = viewBoxMatch[1];
  } else {
    // Create viewBox from target dimensions
    viewBox = `0 0 ${targetWidth} ${targetHeight}`;
  }

  // Remove existing width/height/viewBox attributes to rewrite them
  let normalized = svg
    .replace(/width\s*=\s*["'][^"']*["']/gi, '')
    .replace(/height\s*=\s*["'][^"']*["']/gi, '')
    .replace(/viewBox\s*=\s*["'][^"']*["']/gi, '');

  // Insert normalized attributes into <svg> tag
  normalized = normalized.replace(
    /<svg\b/i,
    `<svg width="${targetWidth}" height="${targetHeight}" viewBox="${viewBox}"`
  );

  return normalized;
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
  // Path patterns:
  //   Standard: baseUrl + /vectorize or /v1/vectorize
  //   Vectorizer.AI style: baseUrl + /api/v1/vectorize
  //   302AI proxy: baseUrl + /vectorizer/api/v1/vectorize (when baseUrl ends with /v1, strip it first)
  const pathsToTry: string[] = [];
  for (const basePath of ['', '/v1']) {
    pathsToTry.push(`${baseUrl}${basePath}/vectorize`);
  }
  // Vectorizer.AI native endpoint: /api/v1/vectorize
  pathsToTry.push(`${baseUrl}/api/v1/vectorize`);
  // 302AI proxy: strips /v1 from baseUrl, then adds /vectorizer/api/v1/vectorize
  const baseUrlWithoutV1 = baseUrl.replace(/\/v1\/?$/, '');
  pathsToTry.push(`${baseUrlWithoutV1}/vectorizer/api/v1/vectorize`);

  for (const url of pathsToTry) {
    try {
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
          return { svg: svgContent, engine: 'vectorize-api' };
        }
        console.warn('[vectorize] Multipart response did not contain <svg>');
      } else {
        const errText = await response.text().catch(() => '');
        console.warn('[vectorize] Multipart endpoint returned non-OK:', url, response.status, errText.substring(0, 200));
      }
    } catch (e) {
      console.warn('[vectorize] Multipart endpoint failed:', url, e instanceof Error ? e.message : String(e));
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
  // 优先使用 base64 数据，确保外部 API 可以访问图片
  const effectiveImageUrl = imageBase64
    ? `data:image/png;base64,${imageBase64}`
    : buildPublicImageUrl(imageUrl);

  const vectorizeRequestBody: Record<string, unknown> = {
    imageUrl: effectiveImageUrl,
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
        content: `You are a senior SVG vectorization engineer and UI icon restoration expert.
Your ONLY task: output a single, clean, production-ready SVG that faithfully reproduces the source image as scalable vector paths.

CORE PRINCIPLE: 1:1 similarity is more important than making a prettier new icon. Do NOT redesign, stylize, or "improve" the source. Your goal is faithful vector restoration.

ANALYSIS (internal — do NOT output this section):
1. Identify the asset type (icon / logo / illustration / UI element)
2. Count distinct closed shapes / outline blocks
3. Locate the primary subject and its bounding center
4. Determine outline direction (upright / angled / rotated)
5. Map internal structure (fills, strokes, gradients, shadows)
6. Establish layer order (back-to-front)
7. Identify color relationships (primary / accent / neutral)

OUTPUT RULES:
- Output ONLY raw SVG code. Start with <svg and end with </svg>
- NO markdown fences, NO explanations, NO comments
- viewBox must exactly match the source image dimensions
- Transparent background (no background rect unless the source has one)
- Maximum 220 path elements — simplify small details if needed
- Preserve original crop position and whitespace ratio
- All paths must be closed (<path d="M...Z"/>)
- Use hex colors matching the source as closely as possible
- Preserve gradient directions if visible

FORBIDDEN:
- NO <text> elements — always convert text to <path> outlines
- NO <image> tags (no raster embedding)
- NO <foreignObject>
- NO <script> or event handlers (onclick, onload, etc.)
- NO external hrefs (xlink:href to URLs)
- NO base64-encoded content
- NO CSS <style> blocks with external references`,
      },
      {
        role: 'user',
        content: [
          ...imageContent,
          {
            type: 'text',
            text: `Convert this ${modeDesc} to SVG vector graphics with maximum fidelity.

CRITICAL REQUIREMENTS:
1. FAITHFUL REPRODUCTION — Match the source 1:1. Same shapes, same colors, same proportions.
2. CLEAN PATHS — Use <path> elements with precise d attributes. Close all paths with Z.
3. EXACT COLORS — Match source colors in hex. Preserve gradients if present.
4. CORRECT VIEWBOX — Set viewBox to "0 0 [width] [height]" matching source dimensions.
5. TRANSPARENT BACKGROUND — No background rectangle unless source has one.
6. LAYER ORDER — Render back-to-front to match source visual stacking.
7. PATH COUNT — Stay under 220 paths. Merge tiny adjacent same-color shapes if needed.

Do NOT redesign or stylize. Reproduce faithfully.`,
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
          // Sanitize AI-generated SVG for security
          const safetyCheck = sanitizeGeneratedSvg(svg);
          if (!safetyCheck.safe) {
            console.warn('[vectorize] AI SVG failed safety check:', safetyCheck.reason);
            return null;
          }
          // Use sanitized version (text elements stripped)
          return { svg: safetyCheck.sanitized || svg, engine: `chat-vision-vectorize (${model || 'gpt-4o'})` };
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

/** Sanitize SVG for Adobe Illustrator compatibility — removes DOCTYPE, metadata, external refs, ensures proper viewBox/xmlns */
function sanitizeSvgForAI(svg: string): string {
  let s = svg;
  // Remove XML declaration
  s = s.replace(/<\?xml[^?]*\?>/g, '');
  // Remove DOCTYPE (may span multiple lines)
  s = s.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  // Remove metadata blocks
  s = s.replace(/<metadata[\s\S]*?<\/metadata>/gi, '');
  // Remove standalone attribute
  s = s.replace(/\sstandalone="[^"]*"/gi, '');
  // Remove comments
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Remove preserveAspectRatio (causes issues in AI)
  s = s.replace(/\s*preserveAspectRatio="[^"]*"/gi, '');
  // Replace pt units with unitless values
  s = s.replace(/(width|height)="([0-9.]+)pt"/gi, '$1="$2"');
  // Ensure xmlns exists
  if (!s.includes('xmlns=')) {
    s = s.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  // Ensure viewBox exists
  if (!s.includes('viewBox')) {
    const wMatch = s.match(/width="([0-9.]+)"/);
    const hMatch = s.match(/height="([0-9.]+)"/);
    if (wMatch && hMatch) {
      s = s.replace(/<svg/, `<svg viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`);
    }
  }
  // Remove xlink:href (deprecated) and replace with href
  s = s.replace(/xlink:href=/g, 'href=');
  // Remove any external resource references that could cause "missing links"
  // Remove <use> elements referencing external resources
  s = s.replace(/<use[^>]*href="(?!#)[^"]*"[^>]*\/?>/gi, '');
  // Remove <image> with external href (not data: URI)
  s = s.replace(/<image[^>]*href="(?!data:)[^"]*"[^>]*\/?>/gi, '');
  // Remove <link> elements
  s = s.replace(/<link[^>]*>/gi, '');
  // Remove style imports (@import url(...))
  s = s.replace(/@import\s+url\([^)]*\)[^;]*;/gi, '');
  // Clean up empty <g> elements
  s = s.replace(/<g>\s*<\/g>/g, '');
  // Clean up excessive whitespace
  s = s.replace(/\n\s*\n/g, '\n');
  s = s.trim();
  // Ensure starts with <svg
  const svgIdx = s.indexOf('<svg');
  if (svgIdx > 0) s = s.substring(svgIdx);
  return s;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let deductedCredits = 0;
  let sessionUser: any = null;
  let selectedMode = '';
  let engineUsed = '';
  try {
    const body = await req.json();
    // 输入校验
    const _validationError = validateApiInputs(typeof body !== 'undefined' ? body : {}, {
      imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const imageUrl = String(body.imageUrl || '');
    const layerId = String(body.layerId || 'layer');
    const mode = normalizeMode(body.mode);
    selectedMode = mode;

    if (!imageUrl) {
      return NextResponse.json({ success: false, error: '缺少 imageUrl' }, { status: 400 });
    }

    // 积分检查与扣除
    deductedCredits = 0;
    sessionUser = await getSessionUser(req).catch(() => null);
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'vectorize');
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    console.log('[vectorize] Request:', { imageUrl: imageUrl.substring(0, 100), layerId, mode });

    // Pre-resolve image to buffer (needed for multipart form upload and base64)
    const imageBuffer = await resolveImageToBuffer(imageUrl);
    const imageBase64 = imageBuffer ? imageBuffer.toString('base64') : null;
    const publicImageUrl = imageUrl.startsWith('http') ? imageUrl : buildPublicImageUrl(imageUrl);

    // Get original image dimensions for SVG normalization
    let origWidth = 0;
    let origHeight = 0;
    if (imageBuffer) {
      try {
        const meta = await sharp(imageBuffer).metadata();
        origWidth = meta.width || 0;
        origHeight = meta.height || 0;
      } catch { /* ignore */ }
    }

    /** Build SVG response with automatic sanitization for AI compatibility + normalization + quality control */
    const svgResponse = (svg: string, engine: string) => {
      const processed = normalizeVectorSvg(sanitizeSvgForAI(svg), origWidth, origHeight);
      // Quality control: check path count
      const pathCount = (processed.match(/<path\b/g) || []).length;
      if (pathCount > 5000) {
        console.warn(`[vectorize] SVG path count too high: ${pathCount}, this asset may be better as PNG`);
        return NextResponse.json({
          success: false,
          error: `路径数量过多(${pathCount})，已尝试自动简化但仍超过上限。该素材更适合保留为 PNG 格式`,
          pathCount,
        });
      }
      return NextResponse.json({ success: true, svg: processed, engine, pathCount });
    };

    // 1. 统一矢量化管线 (Recraft Vectorize → VLM → vtracer)
    console.log('[vectorize] Using unified pipeline...');
    try {
      // 为 VLM 准备 base64 data URL（外部 API 无法访问本地路径）
      const pipelineImageDataUrl = imageBase64
        ? `data:${detectImageMime(imageUrl, imageBuffer || Buffer.alloc(0))};base64,${imageBase64}`
        : undefined;

      const pipelineResult = await vectorizePipeline({
        imageUrl,
        imageBuffer: imageBuffer || undefined,
        imageDataUrl: pipelineImageDataUrl,
        width: origWidth || undefined,
        height: origHeight || undefined,
        mode: (mode === 'line-art' ? 'lineart' : mode === 'logo' ? 'color' : 'color') as 'color' | 'lineart',
        engine: undefined,
      });

      if (pipelineResult.success && pipelineResult.svg) {
        const processed = normalizeVectorSvg(sanitizeSvgForAI(pipelineResult.svg), origWidth, origHeight);
        const pathCount = (processed.match(/<path\b/g) || []).length;
        if (pathCount <= 900) {
          return NextResponse.json({
            success: true,
            svg: processed,
            engine: pipelineResult.engine,
            pathCount,
            enginesTried: pipelineResult.enginesTried,
          });
        }
        console.warn(`[vectorize] Pipeline SVG path count too high: ${pathCount}, falling through`);
      } else {
        console.warn('[vectorize] Pipeline failed:', pipelineResult.error);
      }
    } catch (pipelineErr) {
      console.warn('[vectorize] Pipeline error:', pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr));
    }

    // 2. 尝试管理员配置的矢量模型 API (旧策略兼容，仅当管线未命中时)
    const vectorizeProvider = await findProviderForFeature('vectorize');
    if (vectorizeProvider) {
      const rawBaseUrl = vectorizeProvider.baseUrl.replace(/\/+$/, '');
      const baseUrl = normalizeApiBaseUrl(rawBaseUrl);
      const model = vectorizeProvider.selectedModels?.[0] || vectorizeProvider.selectedModel || '';

      // Strategy 1: Chat completions with vision
      const chatResult = await tryChatCompletionsVectorize(baseUrl, vectorizeProvider.apiKey, imageBase64, publicImageUrl, mode, model);
      if (chatResult) {
        return svgResponse(chatResult.svg, chatResult.engine);
      }

      // Strategy 2: Multipart form-data
      if (imageBuffer) {
        const multipartResult = await tryMultipartVectorize(baseUrl, vectorizeProvider.apiKey, imageBuffer, imageUrl, model);
        if (multipartResult) {
          return svgResponse(multipartResult.svg, multipartResult.engine);
        }
      }

      // Strategy 3: JSON body
      const jsonResult = await tryJsonVectorize(baseUrl, vectorizeProvider.apiKey, imageUrl, imageBase64, layerId, mode, model);
      if (jsonResult) {
        return svgResponse(jsonResult.svg, jsonResult.engine);
      }

      // Strategy 4: OpenAI images/generations format
      const openaiResult = await tryOpenAIFormat(baseUrl, vectorizeProvider.apiKey, imageBase64, mode, model);
      if (openaiResult) {
        return svgResponse(openaiResult.svg, openaiResult.engine);
      }
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
            return svgResponse(String(data.svg), 'py-vectorize');
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
    const durationMs = Date.now() - startTime;
    console.error('[vectorize] Fatal error:', error);
    logError(OP_ACTIONS.IMAGE_VECTORIZE, error, {
      userId: sessionUser?.id || 'unknown',
      userName: sessionUser?.name || 'unknown',
      model: selectedMode,
      providerId: engineUsed,
      durationMs,
      detail: `图片矢量化失败: mode=${selectedMode}`,
    });
    // 退款：矢量化失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `矢量化失败退款: ${(error instanceof Error ? error.message : 'Unknown').substring(0, 100)}`);
      } catch (refundErr) { console.error('[vectorize] Refund failed:', refundErr); }
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'vectorize failed' }, { status: 500 });
  }
}
