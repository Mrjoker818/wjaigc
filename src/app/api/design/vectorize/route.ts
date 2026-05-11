import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, normalizeApiBaseUrl } from '@/lib/server-api-config';

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imageUrl = String(body.imageUrl || '');
    const layerId = String(body.layerId || 'layer');
    const mode = normalizeMode(body.mode);

    if (!imageUrl) {
      return NextResponse.json({ success: false, error: '缺少 imageUrl' }, { status: 400 });
    }

    // 1. 尝试管理员配置的矢量模型 API
    const vectorizeProvider = await findProviderForFeature('vectorize');
    if (vectorizeProvider) {
      try {
        const baseUrl = normalizeApiBaseUrl(vectorizeProvider.baseUrl.replace(/\/+$/, ''));
        const response = await fetch(`${baseUrl}/vectorize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${vectorizeProvider.apiKey}`,
          },
          body: JSON.stringify({
            imageUrl,
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
        });
        if (response.ok) {
          const data = await response.json();
          return NextResponse.json(data);
        }
        console.warn('Vectorize API returned non-OK:', response.status);
      } catch (e) {
        console.warn('Vectorize API call failed, falling back:', e);
      }
    }

    // 2. 尝试环境变量配置的矢量化端点
    // PY_VECTORIZE_ENDPOINT can point to a VTracer, Potrace, StarVector, or SAM-assisted
    // service. The service should return { success, svg, engine, layers?, palette?, warnings? }.
    const endpoint = process.env.PY_VECTORIZE_ENDPOINT;
    if (endpoint) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
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
      });
      const data = await response.json();
      return NextResponse.json(data);
    }

    // Safe fallback: this is intentionally labeled as a raster-backed SVG, not
    // true vectorization. It preserves edit/export flow while making the missing
    // vector engine explicit to the UI and downstream tools.
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
