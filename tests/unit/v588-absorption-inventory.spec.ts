import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateEvidenceManifest } from '../helpers/evidence-manifest';
import {
  extractUi003GovernanceSection,
  findUi003AbsorptionGovernanceIssues,
  type Ui003GovernanceDocuments,
} from '../helpers/v588-ui003-governance';

const inventoryPath = resolve(
  process.cwd(),
  'docs/plans/v588/V588_ABSORPTION_INVENTORY.md',
);
const evidenceDirectory = resolve(process.cwd(), 'docs/testing/evidence');
const regressionPath = resolve(process.cwd(), 'docs/testing/REGRESSION_REPORT.md');
const releasePath = resolve(process.cwd(), 'docs/testing/RELEASE_READINESS_REPORT.md');
const unverifiedPath = resolve(process.cwd(), 'docs/testing/UNVERIFIED_ITEMS.md');
const progressPath = resolve(process.cwd(), '.superpowers/sdd/progress.md');
const stableSha = '52f7c601ed150769e15d06fb435c6e360e28c9e7';

function asObject(value: unknown, label: string): Record<string, unknown> {
  expect(value, `${label} 必须是对象`).toBeTruthy();
  expect(Array.isArray(value), `${label} 不能是数组`).toBe(false);
  expect(typeof value, `${label} 必须是对象`).toBe('object');
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  expect(typeof value, `${label} 必须是非空字符串`).toBe('string');
  expect((value as string).trim(), `${label} 不能为空`).not.toBe('');
  return value as string;
}

function asNumber(value: unknown, label: string): number {
  expect(typeof value, `${label} 必须是数字`).toBe('number');
  return value as number;
}

function extractSection(document: string, heading: string): string {
  const start = document.indexOf(heading);
  expect(start, `缺少治理章节：${heading}`).toBeGreaterThanOrEqual(0);

  const following = document.slice(start + heading.length);
  const nextHeading = following.search(/\n### /);
  return nextHeading === -1
    ? document.slice(start)
    : document.slice(start, start + heading.length + nextHeading);
}

async function getValidUi003CloudEvidenceSha(): Promise<string | null> {
  const matches = (await readdir(evidenceDirectory))
    .filter((name) => /^v588-ui-003-cloud-.*\.json$/i.test(name))
    .sort();

  if (matches.length === 0) return null;

  expect(matches, 'UI-003 云端闭环只能保留一份机器证据').toHaveLength(1);
  const relativePath = `docs/testing/evidence/${matches[0]}`;
  const evidence = asObject(
    JSON.parse(await readFile(resolve(process.cwd(), relativePath), 'utf8')) as unknown,
    'UI-003 云端证据',
  );
  const environment = asObject(evidence.environment, 'UI-003 运行环境');
  const summary = asObject(evidence.summary, 'UI-003 汇总');
  const artifacts = asObject(evidence.artifacts, 'UI-003 产物');
  const requestIds = evidence.requestIds;

  expect(asString(evidence.testId, 'UI-003 测试标识')).toBe('V588-UI-003-cloud');
  expect(asString(evidence.result, 'UI-003 结果')).toBe('passed');
  const evidenceSha = asString(environment.gitCommit, 'UI-003 Git SHA');
  expect(evidenceSha).toMatch(/^[0-9a-f]{40}$/i);
  expect(asString(environment.stableCommit, 'UI-003 stable SHA')).toBe(stableSha);
  expect(asNumber(summary.checks, 'UI-003 检查总数')).toBeGreaterThan(0);
  expect(asNumber(summary.passed, 'UI-003 通过数')).toBe(
    asNumber(summary.checks, 'UI-003 检查总数'),
  );
  expect(asNumber(summary.failed, 'UI-003 失败数')).toBe(0);
  expect(Array.isArray(requestIds), 'UI-003 请求标识必须存在').toBe(true);
  expect(requestIds).not.toHaveLength(0);
  expect((requestIds as unknown[]).every((id) => typeof id === 'string' && id.trim() !== '')).toBe(true);

  validateEvidenceManifest({
    commit: asString(environment.gitCommit, 'UI-003 Git SHA'),
    deploymentUrl: asString(environment.url, 'UI-003 运行地址'),
    browser: asString(environment.browser, 'UI-003 浏览器'),
    capturedAt: asString(evidence.testedAt, 'UI-003 测试时间'),
    featureId: 'V588-UI-003',
    viewport: {
      width: asNumber(asObject(evidence.viewport, 'UI-003 视口').width, '视口宽度'),
      height: asNumber(asObject(evidence.viewport, 'UI-003 视口').height, '视口高度'),
    },
    artifactPaths: {
      screenshot: asString(artifacts.screenshot, 'UI-003 截图'),
      console: asString(artifacts.console, 'UI-003 控制台文件'),
      network: asString(artifacts.network, 'UI-003 网络文件'),
      task: asString(artifacts.task, 'UI-003 任务文件'),
    },
    requestIds: requestIds as string[],
    status: 'completed',
  });
  return evidenceSha;
}

async function readUi003GovernanceDocuments(): Promise<Ui003GovernanceDocuments> {
  const [inventory, regression, release, unverified, progress] = await Promise.all([
    readFile(inventoryPath, 'utf8'),
    readFile(regressionPath, 'utf8'),
    readFile(releasePath, 'utf8'),
    readFile(unverifiedPath, 'utf8'),
    readFile(progressPath, 'utf8'),
  ]);

  return {
    inventory: extractUi003GovernanceSection(inventory, 3),
    regression: extractUi003GovernanceSection(regression, 2),
    release: extractUi003GovernanceSection(release, 2),
    unverified: extractUi003GovernanceSection(unverified, 2),
    progress: extractUi003GovernanceSection(progress, 2),
  };
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

  it('保留 UI-003 可审计的本地与云端门禁证据', async () => {
    const inventory = await readFile(inventoryPath, 'utf8');
    const row = inventory.split(/\r?\n/).find((line) => line.startsWith('| V588-UI-003 |'));
    const ui003 = extractUi003GovernanceSection(inventory, 3);

    expect(row, '缺少 V588-UI-003 吸收清单行').toBeDefined();
    expect(ui003).toContain('efe5e4f16ac3c8a0c7ed6b8fc73cba48af6fd6b2');
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
    expect(ui003).toContain('499` 个文件（`481` 通过、`18` 跳过）');
    expect(ui003).toContain('3143` 个测试（`3038` 通过、`105` 跳过）');
    expect(ui003).toContain('Next.js `16.2.11` 生产构建生成 `116/116` 页面');
    expect(ui003).toContain('保护基线');
    expect(ui003).toContain('**状态：V588-UI-003 已吸收。**');
    expect(ui003).toContain(
      'PostgreSQL 集成/并发门禁，不计为通过',
    );
    expect(ui003).not.toMatch(/PostgreSQL[^。]*(?:测试|门禁)[，、；; ]*(?:均|全部|已)?通过/);
  });

  it('在 inventory、regression 和 release 中同步新鲜全量 Vitest 统计', async () => {
    const documents = await readUi003GovernanceDocuments();

    for (const name of ['inventory', 'regression', 'release'] as const) {
      const section = documents[name];
      expect(section, `${name} 缺少 UI-003 章节`).not.toBe('');
      expect(section).toContain('`499` 个文件（`481` 通过、`18` 跳过）');
      expect(section).toContain('`3143` 个测试（`3038` 通过、`105` 跳过）');
      expect(section).toContain('PostgreSQL');
      expect(section).toContain('不计为通过');
      expect(section).not.toMatch(/PostgreSQL[^。]*(?:测试|门禁)[，、；; ]*(?:均|全部|已)?通过/);
    }
  });

  it('按有效 UI-003 云端证据切换吸收状态和后续项门禁', async () => {
    const inventory = await readFile(inventoryPath, 'utf8');
    const row = inventory.split(/\r?\n/).find((line) => line.startsWith('| V588-UI-003 |'));
    const ui003 = extractUi003GovernanceSection(inventory, 3);
    const evidenceSha = await getValidUi003CloudEvidenceSha();
    const governanceDocuments = await readUi003GovernanceDocuments();

    expect(row, '缺少 V588-UI-003 吸收清单行').toBeDefined();
    if (!evidenceSha) {
      expect(row).toContain('**本地候选通过 / 云端待验。**');
      expect(row).toContain('不得标记为已吸收');
      expect(ui003).toContain('未创建任何云端证据文件');
      expect(ui003).toContain('V588-UI-004` 及后续项不得开始');
      expect(ui003).toContain('云端仍须验证 Coze exact SHA');
      return;
    }

    expect(findUi003AbsorptionGovernanceIssues(governanceDocuments, evidenceSha)).toEqual([]);
    expect(row).toContain('已吸收');
    expect(row).not.toMatch(/本地候选通过|云端待验/);
  });
});
