import { createHmac, timingSafeEqual } from 'node:crypto';

export const IMAGE_EDIT_QUOTE_LIFETIME_MS = 5 * 60_000;
const MAX_TOKEN_LENGTH = 8_192;

export interface ImageEditQuoteIdentity {
  actorUserId: string;
  requestDigest: string;
  creditOp: string;
  total: number;
  components: Record<string, number>;
  targets: Array<{ phase: string; providerId: string; modelId: string }>;
  pricingDigest: string;
  catalogDigest: string;
}

export function confirmedImageEditQuoteForResponse(result: unknown):
  { total: number; components: Record<string, number> } | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const quote = (result as Record<string, unknown>).imageEditQuote as Record<string, unknown> | undefined;
  if (quote?.confirmed !== true || !Number.isSafeInteger(quote.total)) return undefined;
  if (Number.isSafeInteger(quote.upscale) && Number.isSafeInteger(quote.enhance)) {
    return { total: quote.total as number,
      components: { upscale: quote.upscale as number, enhance: quote.enhance as number } };
  }
  const components = quote.components;
  if (!components || typeof components !== 'object' || Array.isArray(components)) return undefined;
  const entries = Object.entries(components);
  if (entries.length === 0 || entries.some(([key, value]) => !key || key.length > 64
    || !Number.isSafeInteger(value) || (value as number) < 0)
    || entries.reduce((total, [, value]) => total + (value as number), 0) !== quote.total) return undefined;
  return { total: quote.total as number, components: components as Record<string, number> };
}

function canonicalQuote(quote: ImageEditQuoteIdentity): ImageEditQuoteIdentity {
  const textFields = [quote.actorUserId, quote.requestDigest, quote.creditOp,
    quote.pricingDigest, quote.catalogDigest];
  if (textFields.some(value => typeof value !== 'string' || value.length < 1 || value.length > 256)
    || !Number.isSafeInteger(quote.total) || quote.total < 0
    || !quote.components || typeof quote.components !== 'object' || Array.isArray(quote.components)
    || !Array.isArray(quote.targets) || quote.targets.length < 1 || quote.targets.length > 16) {
    throw new Error('Invalid image edit quote identity');
  }
  const componentEntries = Object.entries(quote.components).sort(([a], [b]) => a.localeCompare(b));
  if (componentEntries.length === 0 || componentEntries.some(([name, amount]) =>
    !name || name.length > 64 || !Number.isSafeInteger(amount) || amount < 0)
    || componentEntries.reduce((sum, [, amount]) => sum + amount, 0) !== quote.total
    || quote.targets.some(target => [target.phase, target.providerId, target.modelId].some(value =>
      typeof value !== 'string' || value.length < 1 || value.length > 256))) {
    throw new Error('Invalid image edit quote identity');
  }
  return {
    actorUserId: quote.actorUserId, requestDigest: quote.requestDigest, creditOp: quote.creditOp,
    total: quote.total, components: Object.fromEntries(componentEntries),
    targets: quote.targets.map(target => ({ phase: target.phase, providerId: target.providerId, modelId: target.modelId })),
    pricingDigest: quote.pricingDigest, catalogDigest: quote.catalogDigest,
  };
}

function signingKey(secret: string): string {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Image edit quote signing secret unavailable');
  return secret;
}

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', signingKey(secret)).update(payload).digest();
}

export function issueImageEditQuoteToken(quote: ImageEditQuoteIdentity, secret: string, nowMs: number): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('Invalid quote timestamp');
  const payload = Buffer.from(JSON.stringify({ version: 1, issuedAt: nowMs,
    expiresAt: nowMs + IMAGE_EDIT_QUOTE_LIFETIME_MS, quote: canonicalQuote(quote) }), 'utf8').toString('base64url');
  const token = `${payload}.${signature(payload, secret).toString('base64url')}`;
  if (token.length > MAX_TOKEN_LENGTH) throw new Error('Image edit quote identity too large');
  return token;
}

export function verifyImageEditQuoteToken(token: string, expected: ImageEditQuoteIdentity,
  secret: string, nowMs: number): boolean {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !Number.isSafeInteger(nowMs) || nowMs < 0) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  const [payload, encodedSignature] = parts;
  const actualSignature = Buffer.from(encodedSignature, 'base64url');
  if (actualSignature.toString('base64url') !== encodedSignature || actualSignature.length !== 32) return false;
  const expectedSignature = signature(payload, secret);
  if (!timingSafeEqual(actualSignature, expectedSignature)) return false;
  try {
    const decoded = Buffer.from(payload, 'base64url');
    if (decoded.toString('base64url') !== payload) return false;
    const parsed = JSON.parse(decoded.toString('utf8')) as { version?: number; issuedAt?: number;
      expiresAt?: number; quote?: ImageEditQuoteIdentity };
    if (parsed.version !== 1 || !Number.isSafeInteger(parsed.issuedAt) || !Number.isSafeInteger(parsed.expiresAt)
      || parsed.issuedAt! > nowMs || parsed.expiresAt !== parsed.issuedAt! + IMAGE_EDIT_QUOTE_LIFETIME_MS
      || nowMs >= parsed.expiresAt!) return false;
    return JSON.stringify(canonicalQuote(parsed.quote!)) === JSON.stringify(canonicalQuote(expected));
  } catch {
    return false;
  }
}
