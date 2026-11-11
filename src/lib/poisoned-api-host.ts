/**
 * Hosts that resolve to poisoned addresses and must never receive a request.
 * Matching is exact or a subdomain, so a comment mentioning the name is not a hit.
 * Kept out of server-api-config so client-safe helpers can use it.
 */

export const POISONED_API_HOSTS = ['apimart.ai'] as const;

export class PoisonedApiHostError extends Error {
  readonly host: string;

  constructor(host: string) {
    super(`Refusing request to poisoned API host: ${host}`);
    this.name = 'PoisonedApiHostError';
    this.host = host;
  }
}

export function poisonedApiHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const hostname = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
      .hostname.toLowerCase().replace(/\.$/, '');
    return POISONED_API_HOSTS.find(host => hostname === host || hostname.endsWith(`.${host}`)) ?? null;
  } catch {
    return null;
  }
}

/** Throws before a request can leave for a missing, malformed, or poisoned provider URL. */
export function assertSafeProviderUrl(value: string): void {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Provider URL is empty');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Provider URL is not a valid absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Provider URL must use http or https');
  }
  const host = poisonedApiHost(parsed.href);
  if (host) throw new PoisonedApiHostError(host);
}
