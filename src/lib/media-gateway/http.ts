import { GatewayError } from '@/lib/media-gateway/types';

function bodyTooLarge(): GatewayError {
  return new GatewayError('GATEWAY_BODY_TOO_LARGE', 413, '请求体过大');
}

export async function readGatewayJson(
  request: Request,
  maxBytes = 1_048_576,
): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  const declared = contentLength === null ? 0 : Number(contentLength);
  if (!Number.isFinite(declared) || declared < 0) {
    throw new GatewayError('GATEWAY_INVALID_REQUEST', 400, '请求体长度无效');
  }
  if (declared > maxBytes) throw bodyTooLarge();

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw bodyTooLarge();
    }
    chunks.push(value);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new GatewayError(
      'GATEWAY_INVALID_REQUEST',
      400,
      '请求体不是有效 JSON',
    );
  }
}
