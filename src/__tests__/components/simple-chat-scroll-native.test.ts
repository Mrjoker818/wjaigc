// @vitest-environment node
// Run the real ChatArea with local fixture data and an explicit offline network boundary.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type ScrollResult = { originalSha256: string; testedSourceSha256: string; checks: number; cases: number; failures: unknown[] };
const source = path.resolve('src/components/simple-chat/chat-area.tsx');
const fixture = path.resolve('src/__tests__/helpers/simple-chat-scroll-native.mjs');
const output = path.resolve('output/playwright/simple-chat-scroll-native');
async function sourceHash(): Promise<string> { return createHash('sha256').update(await readFile(source)).digest('hex'); }
async function run(mode: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture, mode], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    const append = (chunk: Buffer): void => { text = (text + chunk.toString()).slice(-24000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(text) : reject(new Error(`SCROLL_FIXTURE_EXIT ${code}\n${text}`)));
  });
}

describe('simple chat mobile scroll follows intent', () => {
  it.each([
    { mode: 'green', cases: 9, checks: 71 },
    { mode: 'scroll-user-green', cases: 1, checks: 10 },
    { mode: 'scroll-touch-green', cases: 1, checks: 10 },
    { mode: 'motion-reduce', cases: 1, checks: 8 },
  ])('$mode uses the current component with offline fixture input', async ({ mode, cases, checks }) => {
    const before = await sourceHash();
    await run(mode);
    const after = await sourceHash();
    const result = JSON.parse(await readFile(path.join(output, `${mode}-result.json`), 'utf8')) as ScrollResult;
    expect(after).toBe(before);
    expect(result.originalSha256).toBe(before);
    expect(result.testedSourceSha256).toBe(before);
    expect(result.cases).toBe(cases);
    expect(result.checks).toBe(checks);
    expect(result.failures).toEqual([]);
  }, 120000);
});
