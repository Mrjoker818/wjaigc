import { NextRequest, NextResponse } from 'next/server';
import { validateApiInputs } from '@/lib/api-validator';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

interface CreativeRequest {
  action?: string;
  source?: string;
  image?: string;
  mask?: string;
  prompt?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  quality?: string;
  model?: string;
  providerId?: string;
  metadata?: Record<string, unknown>;
}

const GENERATE_ACTIONS = new Set(['generate_from_canvas', 'generate_from_layer']);
const EDIT_ACTIONS: Record<string, string> = {
  edit_selection: 'mask',
  inpaint_mask: 'mask',
  remove_background: 'remove_background',
  upscale_layer: 'upscale',
  layer_decompose: 'segment',
};

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
  const action: string = payload.action || 'generate_from_canvas';
  if (!action) {
    return NextResponse.json({ success: false, error: '缺少 action 参数。' }, { status: 400 });
  }
  const prompt = buildPrompt(payload);

  if (!prompt.trim() && !['remove_background', 'upscale_layer'].includes(action)) {
    return NextResponse.json({ success: false, error: '缺少 Photoshop CEP 创意提示词。' }, { status: 400 });
  }

  if (GENERATE_ACTIONS.has(action)) {
    return forwardJson(request, '/api/generate', {
      prompt,
      referenceImages: payload.image ? [payload.image] : [],
      referenceMode: 'composition',
      aspectRatio: payload.aspectRatio || '16:9',
      quality: payload.quality || '2K',
      model: payload.model,
      providerId: payload.providerId,
      metadata: {
        ...(payload.metadata || {}),
        connector: 'wujie-creative-connector',
        host: 'photoshop-cep',
        action,
      },
    });
  }

  const editAction = EDIT_ACTIONS[action];
  if (!editAction) {
    return NextResponse.json({ success: false, error: `Photoshop CEP 暂不支持动作：${action}` }, { status: 400 });
  }

  if (action === 'layer_decompose') {
    return forwardJson(request, '/api/segment-elements', {
      imageUrl: payload.image,
      prompt,
      metadata: payload.metadata,
    });
  }

  return forwardJson(request, '/api/image-edit', {
    action: editAction,
    imageUrl: payload.image,
    maskImage: payload.mask,
    editMode: editAction === 'mask' ? 'mask' : undefined,
    prompt,
    quality: payload.quality || '2K',
    model: payload.model,
    providerId: payload.providerId,
    metadata: {
      ...(payload.metadata || {}),
      connector: 'wujie-creative-connector',
      host: 'photoshop-cep',
      action,
    },
  });
}
