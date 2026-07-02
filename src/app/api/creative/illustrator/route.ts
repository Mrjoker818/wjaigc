import { NextRequest, NextResponse } from 'next/server';
import { validateApiInputs } from '@/lib/api-validator';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

interface CreativeRequest {
  action?: string;
  source?: string;
  image?: string;
  svg?: string;
  prompt?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  quality?: string;
  model?: string;
  providerId?: string;
  metadata?: Record<string, unknown>;
}

const GENERATE_ACTIONS = new Set(['generate_from_artboard', 'generate_from_selection', 'style_reference', 'packaging_concept']);
const VECTOR_ACTIONS = new Set(['vectorize_image', 'svg_trace']);

function buildPrompt(payload: CreativeRequest): string {
  const prompt = (payload.prompt || '').trim();
  const negative = (payload.negativePrompt || '').trim();
  const sourceHint = payload.source ? `\n来源：${payload.source}` : '';
  return negative ? `${prompt}${sourceHint}\n负面提示词：${negative}` : `${prompt}${sourceHint}`;
}

async function forwardJson(request: NextRequest, path: string, body: Record<string, unknown>) {
  const response = await fetch(new URL(path, request.nextUrl.origin), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: request.headers.get('authorization') || '',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return NextResponse.json(data, { status: response.status });
}

export async function POST(request: NextRequest) {
  let payload: any = {};
  try {
    const text = await request.text();
    payload = text ? (JSON.parse(text) as CreativeRequest) : {};
  } catch {
    return NextResponse.json({ success: false, error: '请求体 JSON 解析失败。' }, { status: 400 });
  }
  // 输入校验
  const _validationError = validateApiInputs(payload, {
    prompt: 'optionalPrompt',
    image: 'optionalImageUrl',
  });
  if (_validationError) {
    return NextResponse.json({ success: false, error: _validationError }, { status: 400 });
  }
  const { imageUrl } = payload;
  const action: string = payload.action || 'generate_from_artboard';
  if (!action) {
    return NextResponse.json({ success: false, error: '缺少 action 参数。' }, { status: 400 });
  }
  const prompt = buildPrompt(payload);

  if (!prompt.trim() && !VECTOR_ACTIONS.has(action)) {
    return NextResponse.json({ success: false, error: '缺少 Illustrator CEP 创意提示词。' }, { status: 400 });
  }

  if (GENERATE_ACTIONS.has(action)) {
    return forwardJson(request, '/api/generate', {
      prompt,
      referenceImages: payload.image ? [payload.image] : [],
      referenceMode: action === 'style_reference' ? 'style' : 'composition',
      aspectRatio: payload.aspectRatio || '16:9',
      quality: payload.quality || '2K',
      model: payload.model,
      providerId: payload.providerId,
      metadata: {
        ...(payload.metadata || {}),
        connector: 'wujie-creative-connector',
        host: 'illustrator-cep',
        action,
      },
    });
  }

  if (action === 'vectorize_image') {
    return forwardJson(request, '/api/design/vectorize', {
      imageUrl: payload.image,
      svg: payload.svg,
      mode: 'studio',
      prompt,
      metadata: payload.metadata,
    });
  }

  if (action === 'svg_trace') {
    return forwardJson(request, '/api/svg-trace', {
      imageUrl: payload.image,
      mode: 'color',
      quality: payload.quality || 'high',
      prompt,
      metadata: payload.metadata,
    });
  }

  return NextResponse.json({ success: false, error: `Illustrator CEP 暂不支持动作：${action}` }, { status: 400 });
}
