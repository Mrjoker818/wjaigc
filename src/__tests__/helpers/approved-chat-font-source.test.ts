import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertReviewedChatFontSource } from './approved-chat-font-source';

const frozen = JSON.parse(readFileSync('.superpowers/sdd/2026-10-09-sketch-to-code/android-mobile-task5-before-20261018.frozen.json', 'utf8')).originalChatFontTestText as string;
const current = readFileSync('src/__tests__/components/chat-font-mobile-layout.test.tsx', 'utf8');

it('admits the reviewed work-mode count while retaining all original layout cases', () => {
  expect(() => assertReviewedChatFontSource(frozen, current)).not.toThrow();
  expect(() => assertReviewedChatFontSource(frozen, current.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'))).not.toThrow();
});

it('rejects any additional assertion or source change', () => {
  expect(() => assertReviewedChatFontSource(frozen, current.replace('.toBe(11)', '.toBe(12)')))
    .toThrow('TASK5_FROZEN_22_CASE_FILE_CHANGED');
  expect(() => assertReviewedChatFontSource(frozen, current + '\n// unreviewed change\n'))
    .toThrow('TASK5_FROZEN_22_CASE_FILE_CHANGED');
});

it('rejects changes to the original artifact even when its byte length stays the same', () => {
  const changed = frozen.replace('jsdom', 'xsdox');
  expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(frozen));
  expect(() => assertReviewedChatFontSource(changed, current)).toThrow('TASK5_FROZEN_22_CASE_BASE_CHANGED');
});
