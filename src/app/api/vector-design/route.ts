import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { findProviderById } from '@/lib/server-api-config';
import { getInternalApiUrl } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { saveImageFile } from '@/lib/server-data-root';
import {
  applyVectorEditOperation,
  buildVectorPrompt,
  isRecraftVectorModel,
  sanitizeEditableSvg,
  type VectorEditOperation,
} from '@/lib/vector-design';
import { downloadPublicImage } from '@/lib/safe-image-download';

export const runtime = 'nodejs';
export const maxDuration = 180;

type VectorAction = 'generate' | 'vectorize' | 'edit';

interface VectorDesignRequest {
  action: VectorAction;
  providerId: string;
  model: string;
  prompt?: string;
  templateIds?: string[];
  size?: string;
  n?: number;
  imageUrl?: string;
  sourceSvg?: string;
  operation?: VectorEditOperation;
  selectedElementId?: string;
  targetBox?: { x: number; y: number; width: number; height: number };
  replacePrompt?: string;
}

interface RecraftAsset {
  svg: string;
  svgUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  pathCount: number;
}

function buildEndpointCandidates(baseUrl: string, endpoint: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  const candidates = /\/v\d+$/i.test(base)
    ? [`${base}${endpoint}`]
    : [`${base}/v1${endpoint}`, `${base}${endpoint}`, `${base}/recraft/v1${endpoint}`];
  return [...new Set(candidates)];
}

const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

async function fetchImageBuffer(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i);
    if (!match) throw new Error('图生矢量仅支持 PNG、JPG、WEBP');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_REFERENCE_IMAGE_BYTES) throw new Error('参考图不能超过 10MB');
    return { buffer, mimeType: match[1].toLowerCase() };
  }
  // 平台自有媒体（相对路径）走内部地址：目标由服务端构造，不存在 SSRF 面
  if (imageUrl.startsWith('/')) {
    const response = await fetch(getInternalApiUrl(imageUrl), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`读取参考图失败：HTTP ${response.status}`);
    const mimeType = (response.headers.get('content-type') || 'image/png').split(';')[0].toLowerCase();
    if (!ALLOWED_REFERENCE_MIME_TYPES.has(mimeType)) {
      throw new Error('图生矢量仅支持 PNG、JPG、WEBP');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_REFERENCE_IMAGE_BYTES) throw new Error('参考图不能超过 10MB');
    return { buffer, mimeType };
  }
  // 外部 URL 统一走 SSRF 防御入口：DNS 解析后校验公网地址、IP 固定防 DNS rebinding、拒绝重定向与凭据
  const downloaded = await downloadPublicImage(imageUrl, {
    maxBytes: MAX_REFERENCE_IMAGE_BYTES,
    timeoutMs: 30_000,
  });
  if (!ALLOWED_REFERENCE_MIME_TYPES.has(downloaded.mimeType)) {
    throw new Error('图生矢量仅支持 PNG、JPG、WEBP');
  }
  return { buffer: downloaded.buffer, mimeType: downloaded.mimeType };
}

async function svgFromJson(data: Record<string, unknown>): Promise<string | null> {
  const image = data.image as Record<string, unknown> | undefined;
  const first = Array.isArray(data.data) ? data.data[0] as Record<string, unknown> | undefined : undefined;
  const b64 = String(first?.b64_json || image?.b64_json || '');
  if (b64) {
    const decoded = Buffer.from(b64.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf8');
    if (decoded.includes('<svg')) return decoded;
  }
  const direct = String(data.svg || first?.svg || image?.svg || '');
  if (direct.includes('<svg')) return direct;
  const url = String(first?.url || image?.url || data.url || '');
  if (!url) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`下载 Recraft SVG 失败：HTTP ${response.status}`);
  return response.text();
}

async function parseRecraftSvg(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('svg') || contentType.includes('text/xml')) {
    return response.text();
  }
  const data = await response.json() as Record<string, unknown>;
  const svg = await svgFromJson(data);
  if (!svg) throw new Error('Recraft 返回结果中没有 SVG');
  return svg;
}

async function callRecraft(
  baseUrl: string,
  apiKey: string,
  endpoint: '/images/generations/vector' | '/images/vectorize',
  body: BodyInit,
  contentType?: string,
): Promise<string> {
  let lastError = '';
  for (const url of buildEndpointCandidates(baseUrl, endpoint)) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(contentType ? { 'Content-Type': contentType } : {}),
        },
        body,
        signal: AbortSignal.timeout(150_000),
      });
      if (!response.ok) {
        lastError = `${response.status} ${(await response.text().catch(() => '')).slice(0, 240)}`;
        continue;
      }
      return await parseRecraftSvg(response);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Recraft 矢量接口调用失败：${lastError}`);
}

function readSvgSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  if (viewBox) return { width: Math.max(1, Number(viewBox[1])), height: Math.max(1, Number(viewBox[2])) };
  const width = Number(svg.match(/\bwidth=["']([\d.]+)/i)?.[1] || 1024);
  const height = Number(svg.match(/\bheight=["']([\d.]+)/i)?.[1] || 1024);
  return { width, height };
}

async function persistSvg(svgInput: string): Promise<RecraftAsset> {
  const svg = sanitizeEditableSvg(svgInput);
  if (/<image\b/i.test(svg)) throw new Error('结果包含嵌入位图，不是真正可编辑的原生 SVG');
  const { width, height } = readSvgSize(svg);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const svgUrl = saveImageFile(Buffer.from(svg, 'utf8'), `vector-${id}.svg`, 'vector-design');
  const previewBuffer = await sharp(Buffer.from(svg, 'utf8'), { density: 144 })
    .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const previewUrl = saveImageFile(previewBuffer, `vector-${id}.png`, 'vector-design');
  return {
    svg,
    svgUrl,
    previewUrl,
    width,
    height,
    pathCount: (svg.match(/<(?:path|rect|circle|ellipse|polygon|polyline|line)\b/gi) || []).length,
  };
}

async function generateVector(
  provider: { baseUrl: string; apiKey: string },
  model: string,
  prompt: string,
  size: string,
): Promise<string> {
  return callRecraft(
    provider.baseUrl,
    provider.apiKey,
    '/images/generations/vector',
    JSON.stringify({
      prompt,
      model,
      size,
      n: 1,
      response_format: 'b64_json',
    }),
    'application/json',
  );
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  let deductedCredits = 0;
  let userId = '';
  try {
    const body = await request.json() as VectorDesignRequest;
    const action = body.action;
    const providerId = String(body.providerId || '');
    const model = String(body.model || '');
    if (!['generate', 'vectorize', 'edit'].includes(action)) {
      return NextResponse.json({ success: false, error: '不支持的矢量操作' }, { status: 400 });
    }
    const provider = await findProviderById(providerId);
    if (!provider) return NextResponse.json({ success: false, error: '矢量模型提供商未启用或不存在' }, { status: 403 });
    const selectedModels = provider.selectedModels || [];
    if (!selectedModels.includes(model)) {
      return NextResponse.json({ success: false, error: '所选模型未被该提供商精确授权' }, { status: 403 });
    }
    if (!isRecraftVectorModel(model)) {
      return NextResponse.json({ success: false, error: '请选择 Recraft Vector 模型' }, { status: 400 });
    }
    if (action === 'generate' && !body.prompt?.trim()) {
      return NextResponse.json({ success: false, error: '请输入矢量图需求' }, { status: 400 });
    }
    if (action === 'vectorize' && !body.imageUrl) {
      return NextResponse.json({ success: false, error: '请选择参考图片' }, { status: 400 });
    }

    const sessionUser = await getSessionUser(request);
    const requiresModelCall = action !== 'edit' || Boolean(body.replacePrompt?.trim());
    if (sessionUser && requiresModelCall) {
      userId = sessionUser.id;
      const credit = await consumeCredits(sessionUser.id, 'vectorize', undefined, 'AI 矢量设计', model, { providerId });
      if (!credit.success) return NextResponse.json({ success: false, error: credit.message || '积分不足' }, { status: 402 });
      deductedCredits = credit.cost;
    }

    let svg: string;
    if (action === 'generate') {
      const prompt = buildVectorPrompt({ prompt: String(body.prompt || ''), templateIds: body.templateIds });
      svg = await generateVector(provider, model, prompt, String(body.size || '1:1'));
    } else if (action === 'vectorize') {
      const image = await fetchImageBuffer(body.imageUrl!);
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }), `reference.${image.mimeType.split('/')[1]}`);
      form.append('response_format', 'b64_json');
      svg = await callRecraft(provider.baseUrl, provider.apiKey, '/images/vectorize', form);
    } else if (body.operation && body.sourceSvg) {
      svg = applyVectorEditOperation(sanitizeEditableSvg(body.sourceSvg), body.operation);
    } else if (body.sourceSvg && !body.replacePrompt) {
      svg = sanitizeEditableSvg(body.sourceSvg);
    } else {
      if (!body.sourceSvg || !body.selectedElementId || !body.replacePrompt?.trim()) {
        return NextResponse.json({ success: false, error: '局部替换需要 SVG、选中元素和替换描述' }, { status: 400 });
      }
      const replacement = await generateVector(
        provider,
        model,
        buildVectorPrompt({
          prompt: `${body.replacePrompt}。生成单个独立矢量元素，用于替换现有设计中的局部，保持构图简洁且无背景`,
          templateIds: body.templateIds,
        }),
        '1:1',
      );
      svg = applyVectorEditOperation(sanitizeEditableSvg(body.sourceSvg), {
        type: 'replace',
        elementId: body.selectedElementId,
        replacementSvg: replacement,
        targetBox: body.targetBox,
      });
    }

    const asset = await persistSvg(svg);
    return NextResponse.json({
      success: true,
      asset: {
        ...asset,
        model,
        providerId,
        providerName: provider.displayName || provider.name,
        sourceType: action,
      },
    });
  } catch (error) {
    if (deductedCredits > 0 && userId) {
      await refundCredits(userId, deductedCredits, `AI 矢量设计失败：${error instanceof Error ? error.message : String(error)}`).catch(() => null);
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'AI 矢量设计失败' },
      { status: 500 },
    );
  }
}
