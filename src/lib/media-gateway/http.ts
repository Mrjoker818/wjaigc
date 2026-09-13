import { GatewayError } from '@/lib/media-gateway/types';

function bodyTooLarge(): GatewayError {
  return new GatewayError('GATEWAY_BODY_TOO_LARGE', 413, '请求体过大');
}

export async function readGatewayJson(
  request: Request,
  maxBytes = 1_048_576,
): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && !/^\d+$/.test(contentLength)) {
    throw new GatewayError('GATEWAY_INVALID_REQUEST', 400, '请求体长度无效');
  }
  if (contentLength !== null && BigInt(contentLength) > BigInt(maxBytes)) {
    throw bodyTooLarge();
  }

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
    const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(json) as unknown;
  } catch {
    throw new GatewayError(
      'GATEWAY_INVALID_REQUEST',
      400,
      '请求体不是有效 JSON',
    );
  }
}
