import crypto from 'crypto';

const DEVELOPMENT_SECRET_KEY = '__wujiePaymentTokenSecret';

function paymentTokenSecret(): string {
  const configured = process.env.PAYMENT_TOKEN_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;

  const runtime = globalThis as typeof globalThis & { [DEVELOPMENT_SECRET_KEY]?: string };
  runtime[DEVELOPMENT_SECRET_KEY] ??= crypto.randomBytes(48).toString('base64url');
  return runtime[DEVELOPMENT_SECRET_KEY];
}

export function createPaymentToken(data: { realQrUrl: string; method: string; expiresAt: number }): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', paymentTokenSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyPaymentToken(token: string): { realQrUrl: string; method: string; expiresAt: number } | null {
  try {
    const dotIndex = token.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const payload = token.slice(0, dotIndex);
    const signature = token.slice(dotIndex + 1);
    const expectedSignature = crypto.createHmac('sha256', paymentTokenSecret()).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    return data.realQrUrl && data.method && data.expiresAt ? data : null;
  } catch {
    return null;
  }
}
