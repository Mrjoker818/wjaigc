import { createHash } from 'node:crypto';

const originalSha256 = '6ad14c8b2a1739cabe700c9c5629cbc533a7719b08b2705de8bce88c8e270c9b';
const originalCounter = "expect(await page.locator(tools).count(), 'all nine tools and send remain available').toBe(10);";
// c549a5f7630480be0a5fc7d50946726d942e62e4 added the work-mode control.
// Preserve the original frozen artifact; admit only its reviewed count update.
const reviewedCounter = "expect(await page.locator(tools).count(), 'all ten tools (incl. work mode) and send remain available').toBe(11);";

export function assertReviewedChatFontSource(frozen: string, current: string): void {
  if (Buffer.byteLength(frozen, 'utf8') !== 14994
    || createHash('sha256').update(frozen).digest('hex') !== originalSha256) {
    throw new Error('TASK5_FROZEN_22_CASE_BASE_CHANGED');
  }
  const original = frozen.replaceAll('\r\n', '\n');
  if (original.split(originalCounter).length !== 2
    || current.replaceAll('\r\n', '\n') !== original.replace(originalCounter, reviewedCounter)) {
    throw new Error('TASK5_FROZEN_22_CASE_FILE_CHANGED');
  }
}
