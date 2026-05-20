import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120;

type LayerSplitRequest = {
  imageUrl?: string;
  prompt?: string;
  layers?: number;
  mode?: string;
};

function normalizeEndpoint() {
  return process.env.LAYER_SPLIT_ENDPOINT || process.env.QWEN_LAYERED_ENDPOINT || process.env.OMNIPSD_ENDPOINT || '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as LayerSplitRequest;
    const imageUrl = String(body.imageUrl || '');
    if (!imageUrl) {
      return NextResponse.json({ success: false, error: '缺少 imageUrl' }, { status: 400 });
    }

    const endpoint = normalizeEndpoint();
    if (!endpoint) {
      return NextResponse.json({
        success: false,
        configured: false,
        error: '未配置 LAYER_SPLIT_ENDPOINT。可接入 Qwen-Image-Layered / OmniPSD / SAM 图层分离服务。',
      }, { status: 501 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        image: imageUrl,
        imageUrl,
        prompt: body.prompt || '',
        max_layers: body.layers || 6,
        layers: body.layers || 6,
        mode: body.mode || 'studio',
        output: 'rgba_layers',
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return NextResponse.json({
        success: false,
        error: `图层分离服务调用失败: ${response.status}`,
        detail: errText.slice(0, 200),
      }, { status: response.status });
    }
    const data = await response.json();

    const rawLayers = data.layers || data.rgba_layers || data.images || data.outputs || [];
    const layers = Array.isArray(rawLayers)
      ? rawLayers.map((layer: Record<string, unknown>, index: number) => ({
          id: String(layer.id || `layer_${index}`),
          name: String(layer.name || layer.label || `Layer ${index + 1}`),
          role: String(layer.role || layer.type || (index === 0 ? 'background' : 'subject')),
          text: typeof layer.text === 'string' ? layer.text : undefined,
          textContent: typeof layer.textContent === 'string' ? layer.textContent : typeof layer.content === 'string' ? layer.content : undefined,
          fontSize: typeof layer.fontSize === 'number' ? layer.fontSize : undefined,
          color: typeof layer.color === 'string' || Array.isArray(layer.color) ? layer.color : undefined,
          imageUrl: typeof layer.imageUrl === 'string' ? layer.imageUrl : undefined,
          dataUrl: typeof layer.dataUrl === 'string' ? layer.dataUrl : typeof layer.url === 'string' ? layer.url : undefined,
          url: typeof layer.url === 'string' ? layer.url : undefined,
          bbox: layer.bbox || layer.box,
          opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
          blendMode: typeof layer.blendMode === 'string' ? layer.blendMode : 'normal',
        }))
      : [];

    return NextResponse.json({
      success: layers.length > 0,
      engine: data.engine || data.model || 'external-layer-split',
      width: data.width,
      height: data.height,
      layers,
      raw: layers.length > 0 ? undefined : data,
      error: layers.length > 0 ? undefined : '图层分离服务未返回 layers/rgba_layers/images',
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return NextResponse.json({
      success: false,
      error: isAbort ? '图层分离服务超时' : error instanceof Error ? error.message : '图层分离失败',
    }, { status: isAbort ? 504 : 500 });
  }
}
