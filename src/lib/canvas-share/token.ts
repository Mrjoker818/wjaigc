import { createHash, randomBytes } from 'node:crypto';

const CANVAS_SHARE_TOKEN_BYTES = 32;

export function createCanvasShareToken(): string {
  return randomBytes(CANVAS_SHARE_TOKEN_BYTES).toString('base64url');
}

export function hashCanvasShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function redactCanvasShareToken(token: string): string {
  if (token.length < 12) return '[已脱敏]';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
