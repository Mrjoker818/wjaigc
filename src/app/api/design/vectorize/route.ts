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
 * Resolve an image URL to a base64 string for APIs that need image data.
 * Handles local paths (/uploads/..., /api/serve-upload/...), data URLs, and external URLs.
 */
async function resolveImageToBase64(imageUrl: string): Promise<string | null> {
  try {
    // Data URL - extract base64 part
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
      return match ? match[1] : null;
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
        return fsSync.readFileSync(localPath).toString('base64');
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
            return fsSync.readFileSync(filePath).toString('base64');
          }
        }
      }

      // Fallback: fetch from localhost
      const fullUrl = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${imageUrl}`;
      const response = await fetch(fullUrl, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return buffer.toString('base64');
      }
      console.warn('[vectorize] Failed to fetch local image:', imageUrl);
      return null;
    }

    // External URL - fetch and convert
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  } catch (err) {
    console.warn('[vectorize] Could not resolve image to base64:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Build a publicly accessible URL for a local image path.
 * Returns the original URL if it's already external, or constructs a server URL for local paths.
 */
function buildPublicImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:')) {
    return imageUrl;
  }
  // Local path → construct localhost URL
  const port = process.env.DEPLOY_RUN_PORT || 5000;
  return `http://localhost:${port}${imageUrl}`;
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

    // Pre-resolve image to base64 for APIs that can't access local URLs
    const imageBase64 = await resolveImageToBase64(imageUrl);

    // 1. 尝试管理员配置的矢量模型 API
    const vectorizeProvider = await findProviderForFeature('vectorize');
    if (vectorizeProvider) {
      const baseUrl = normalizeApiBaseUrl(vectorizeProvider.baseUrl.replace(/\/+$/, ''));
      const model = vectorizeProvider.selectedModels?.[0] || vectorizeProvider.selectedModel || '';

      // Try multiple endpoint patterns using fetchWithV1Retry for /v1 fallback
      const endpointPathsToTry = [
        '/vectorize',
      ];

      // Build request body with both URL and base64 (for maximum compatibility)
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

      for (const endpointPath of endpointPathsToTry) {
        try {
          const response = await fetchWithV1Retry(baseUrl, endpointPath, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${vectorizeProvider.apiKey}`,
            },
            body: JSON.stringify(vectorizeRequestBody),
            signal: AbortSignal.timeout(60000),
          });
          if (response.ok) {
            const data = await response.json();
            return NextResponse.json(data);
          }
          console.warn('[vectorize] Endpoint returned non-OK:', `${baseUrl}${endpointPath}`, response.status);
        } catch (e) {
          console.warn('[vectorize] Endpoint failed:', `${baseUrl}${endpointPath}`, e instanceof Error ? e.message : String(e));
        }
      }

      // Also try OpenAI-compatible images/generations format as a last resort
      if (model && imageBase64) {
        try {
          const response = await fetchWithV1Retry(baseUrl, '/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${vectorizeProvider.apiKey}`,
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
            // Try to extract SVG from response
            const candidates = data.data as Array<Record<string, string>> | undefined;
            if (candidates?.[0]) {
              const b64 = candidates[0].b64_json;
              const url = candidates[0].url;
              if (b64) {
                const svgContent = Buffer.from(b64, 'base64').toString('utf-8');
                if (svgContent.includes('<svg')) {
                  return NextResponse.json({ success: true, svg: svgContent, engine: 'openai-vectorize' });
                }
              }
              if (url) {
                // Fetch the result from URL
                const svgResp = await fetch(url, { signal: AbortSignal.timeout(15000) });
                if (svgResp.ok) {
                  const svgContent = await svgResp.text();
                  if (svgContent.includes('<svg')) {
                    return NextResponse.json({ success: true, svg: svgContent, engine: 'openai-vectorize' });
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn('[vectorize] OpenAI-compatible format failed:', e instanceof Error ? e.message : String(e));
        }
      }

      console.warn('[vectorize] All admin-configured API attempts failed, falling back');
    }

    // 2. 尝试环境变量配置的矢量化端点
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
          const data = await response.json();
          return NextResponse.json(data);
        }
        console.warn('[vectorize] PY_VECTORIZE_ENDPOINT returned non-OK:', response.status);
      } catch (e) {
        console.warn('[vectorize] PY_VECTORIZE_ENDPOINT failed:', e instanceof Error ? e.message : String(e));
      }
    }

    // 3. Safe fallback: raster-backed SVG wrapper
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
      message: '已生成可嵌入的 SVG 容器。配置 PY_VECTORIZE_ENDPOINT 后可切换到真实路径矢量化。',
      svg,
      warnings: ['当前结果保留原图像素，不会伪装成真实矢量路径。'],
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'vectorize failed' }, { status: 500 });
  }
}
