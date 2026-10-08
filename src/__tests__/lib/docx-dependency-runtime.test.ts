import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Document, Packer, Paragraph } from 'docx';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const mammothBin = join(dirname(require.resolve('mammoth/package.json')), 'bin', 'mammoth');
const fixtureText = '无界 DOCX dependency regression';

async function createDocument(): Promise<Buffer> {
  return Packer.toBuffer(new Document({
    sections: [{ children: [new Paragraph(fixtureText)] }],
  }));
}

describe('DOCX consumer compatibility after dependency security updates', () => {
  it('preserves knowledge-base raw text extraction from a real Word archive', async () => {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: await createDocument() });

    expect(result.value).toBe('无界 DOCX dependency regression\n\n');
    expect(result.messages).toEqual([]);
  });

  for (const [format, expected] of [
    ['html', '<p>无界 DOCX dependency regression</p>'],
    ['markdown', '无界 DOCX dependency regression\n\n'],
  ] as const) {
    it(`preserves Mammoth's ${format} CLI with its scoped parser override`, async () => {
      const temporaryRoot = realpathSync(tmpdir());
      const fixtureRoot = realpathSync(mkdtempSync(join(temporaryRoot, 'wujie-docx-dependency-')));
      if (dirname(fixtureRoot) !== temporaryRoot || !basename(fixtureRoot).startsWith('wujie-docx-dependency-')) {
        throw new Error('DOCX fixture must be a direct child of the temporary directory');
      }

      try {
        const fixturePath = join(fixtureRoot, 'fixture.docx');
        writeFileSync(fixturePath, await createDocument());
        const result = spawnSync(process.execPath, [mammothBin, fixturePath, '--output-format', format], {
          cwd: fixtureRoot,
          encoding: 'utf8',
          timeout: 3_000,
        });

        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe(expected);
      } finally {
        rmSync(fixtureRoot, { recursive: true });
      }
    });
  }

  it('retains a nonzero CLI error for unsupported output formats', () => {
    const result = spawnSync(process.execPath, [mammothBin, 'unused.docx', '--output-format', 'unsupported'], {
      encoding: 'utf8',
      timeout: 3_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/invalid choice/i);
  });
});
