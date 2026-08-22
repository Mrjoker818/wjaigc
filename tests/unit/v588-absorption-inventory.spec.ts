import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const inventoryPath = resolve(
  process.cwd(),
  'docs/plans/v588/V588_ABSORPTION_INVENTORY.md',
);

function extractSection(document: string, heading: string): string {
  const start = document.indexOf(heading);
  expect(start, `缺少治理章节：${heading}`).toBeGreaterThanOrEqual(0);

  const following = document.slice(start + heading.length);
  const nextHeading = following.search(/\n### /);
  return nextHeading === -1
    ? document.slice(start)
    : document.slice(start, start + heading.length + nextHeading);
}

describe('V588 吸收清单治理门禁', () => {
  it('仅将已有云端闭环的 UI-001 与 UI-002 标记为已吸收', async () => {
    const inventory = await readFile(inventoryPath, 'utf8');
    const ui001 = extractSection(
      inventory,
      '### V588-UI-001 - 2026-08-22 云端吸收闭环',
    );
    const ui002 = extractSection(
      inventory,
      '### V588-UI-002 - 2026-08-22 云端闭环',
    );

    expect(inventory).toContain('**FIRST LEAF ABSORBED.**');
    expect(inventory).toContain('**ABSORBED / CLOUD VERIFIED.**');
    expect(ui001).toContain('**状态：V588-UI-001 已吸收。**');
    expect(ui001).toContain(
      'docs/testing/evidence/v588-ui-001-cloud-2026-08-22.json',
    );
    expect(ui002).toContain('**状态：V588-UI-002 已吸收。**');
    expect(ui002).toContain(
      'docs/testing/evidence/v588-ui-002-cloud-2026-08-22.json',
    );
  });

  it('将 UI-003 固定为本地候选，并保留可审计的本地门禁证据', async () => {
    const inventory = await readFile(inventoryPath, 'utf8');
    const row = inventory.split(/\r?\n/).find((line) => line.startsWith('| V588-UI-003 |'));
    const ui003 = extractSection(
      inventory,
      '### V588-UI-003 - 2026-08-22 小地图本地候选',
    );

    expect(row, '缺少 V588-UI-003 吸收清单行').toBeDefined();
    expect(row).toContain('**本地候选通过 / 云端待验。**');
    expect(row).toContain('不得标记为已吸收');
    expect(ui003.match(/本地候选通过 \/ 云端待验/g)).toHaveLength(1);
    expect(ui003).not.toMatch(/V588-UI-003 已吸收|云端(?:回归)?通过/);
    expect(ui003).toContain('b5b0b18ed1feda1f5324537f15a9645b87e4fc9d');
    expect(ui003).toContain('52f7c601ed150769e15d06fb435c6e360e28c9e7');
    expect(ui003).toContain(
      '66B41B25CA9D5932C1894D8250EBD7960261454F3C519E583036830173BC4440',
    );
    expect(ui003).toContain(
      '3D2E9005A471399421C060B6CDB996B4850573F1ACE0714C1D4811C5BE1D3754',
    );
    expect(ui003).toContain('最终 `14` 个测试');
    expect(ui003).toContain('聚焦回归为 `6` 个文件、`27` 个测试通过');
    expect(ui003).toContain('全仓 TypeScript 通过');
    expect(ui003).toContain('ESLint 为 `0 errors / 988` 条历史 warning');
    expect(ui003).toContain('497` 个文件（`479` 通过、`18` 跳过）');
    expect(ui003).toContain('3128` 个测试（`3023` 通过、`105` 跳过）');
    expect(ui003).toContain('Next.js `16.2.11` 生产构建生成 `116/116` 页面');
    expect(ui003).toContain('干净 HEAD 保护基线 `38/38`');
    expect(ui003).toContain(
      'PostgreSQL 集成/并发门禁，不计为通过',
    );
    expect(ui003).not.toMatch(/PostgreSQL[^。]*(?:测试|门禁)[，、；; ]*(?:均|全部|已)?通过/);
  });

  it('在 UI-003 云端闭环前阻止 UI-004 及后续项开始', async () => {
    const inventory = await readFile(inventoryPath, 'utf8');
    const ui003 = extractSection(
      inventory,
      '### V588-UI-003 - 2026-08-22 小地图本地候选',
    );

    expect(ui003).toContain('未创建任何云端证据文件');
    expect(ui003).toContain('V588-UI-004` 及后续项不得开始');
    expect(ui003).toContain('云端仍须验证 Coze exact SHA');
  });
});
