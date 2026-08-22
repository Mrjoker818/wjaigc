import { spawnSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateEvidenceManifest } from '../helpers/evidence-manifest';
import {
  extractUi003GovernanceSection,
  findUi003AbsorptionGovernanceIssues,
  UI003_GOVERNANCE_DOCUMENT_NAMES,
  type Ui003GovernanceDocuments,
} from '../helpers/v588-ui003-governance';

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const evidenceDirectory = resolve(root, 'docs/testing/evidence');
const inventoryPath = resolve(root, 'docs/plans/v588/V588_ABSORPTION_INVENTORY.md');
const regressionPath = resolve(root, 'docs/testing/REGRESSION_REPORT.md');
const releasePath = resolve(root, 'docs/testing/RELEASE_READINESS_REPORT.md');
const unverifiedPath = resolve(root, 'docs/testing/UNVERIFIED_ITEMS.md');
const progressPath = resolve(root, '.superpowers/sdd/progress.md');
const stableSha = '52f7c601ed150769e15d06fb435c6e360e28c9e7';

const ui003RequiredChecks = [
  ['existing-chrome-tab', { reusedExistingTab: true }],
  ['no-new-tab', { newTabCreated: false }],
  ['default-closed', { visible: false }],
  ['toolbar-open', { opened: true }],
  ['toolbar-close', { closed: true }],
  ['command-toggle', { opened: true, closed: true }],
  ['close-button', { closed: true }],
  ['preference-restore', { restored: true }],
  ['viewport-lt-768-hide', { viewportWidth: 767, hidden: true }],
  ['viewport-lt-768-restore', { viewportWidth: 768, visible: true }],
  ['usable-width-lt-560-hide', { usableWidth: 559, hidden: true }],
  ['usable-width-lt-560-restore', { usableWidth: 560, visible: true }],
  ['right-panel-avoidance', { overlapObserved: false }],
  ['dark-theme', { theme: 'dark', visible: true }],
  ['mono-theme', { theme: 'mono', visible: true }],
  ['empty-state', { visible: true }],
  ['nodes-100', { nodeCount: 100 }],
  ['nodes-300', { nodeCount: 300 }],
  ['console-errors', { count: 0 }],
  ['console-warnings', { count: 0 }],
  ['canvas-tool-session-errors', { count: 0 }],
  ['minimap-network-requests', { count: 0 }],
  ['native-dialogs', { count: 0 }],
  ['screenshot-artifact-references', {
    screenshot: true,
    console: true,
    network: true,
    task: true,
  }],
] as const;

function asObject(value: unknown, label: string): JsonObject {
  expect(value, `${label} 必须是对象`).toBeTruthy();
  expect(Array.isArray(value), `${label} 不能是数组`).toBe(false);
  expect(typeof value, `${label} 必须是对象`).toBe('object');
  return value as JsonObject;
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

async function readJson(relativePath: string): Promise<JsonObject> {
  return asObject(
    JSON.parse(await readFile(resolve(root, relativePath), 'utf8')) as unknown,
    `${relativePath} 根节点`,
  );
}

async function expectArtifact(relativePath: string, label: string): Promise<void> {
  expect(relativePath, `${label} 必须位于证据目录`).toMatch(/^docs\/testing\/evidence\//);
  await expect(access(resolve(root, relativePath))).resolves.toBeUndefined();
}

function validateCompletedRecord(input: {
  commit: string;
  deploymentUrl: string;
  browser: string;
  capturedAt: string;
  featureId: string;
  artifactPaths: JsonObject;
  requestIds: string[];
  viewport: JsonObject;
}): void {
  validateEvidenceManifest({
    commit: input.commit,
    deploymentUrl: input.deploymentUrl,
    browser: input.browser,
    capturedAt: input.capturedAt,
    featureId: input.featureId,
    viewport: {
      width: asNumber(input.viewport.width, '视口宽度'),
      height: asNumber(input.viewport.height, '视口高度'),
    },
    artifactPaths: {
      screenshot: asString(input.artifactPaths.screenshot, '截图证据'),
      console: asString(input.artifactPaths.console, '控制台证据'),
      network: asString(input.artifactPaths.network, '网络证据'),
      task: asString(input.artifactPaths.task, '任务证据'),
    },
    requestIds: input.requestIds,
    status: 'completed',
  });
}

function assertUi003CloudMatrix(value: unknown): void {
  expect(Array.isArray(value), 'UI-003 检查列表必须存在').toBe(true);
  const checks = value as unknown[];
  const byId = new Map<string, JsonObject>();

  for (const value of checks) {
    const check = asObject(value, 'UI-003 检查项');
    const id = asString(check.id, 'UI-003 检查项标识');
    expect(byId.has(id), `UI-003 检查项标识重复：${id}`).toBe(false);
    expect(check.pass, `UI-003 检查项必须通过：${id}`).toBe(true);
    byId.set(id, check);
  }

  for (const [id, expectedFields] of ui003RequiredChecks) {
    const check = byId.get(id);
    expect(check, `缺少 UI-003 云端矩阵检查项：${id}`).toBeDefined();
    for (const [field, expected] of Object.entries(expectedFields)) {
      expect(check?.[field], `UI-003 检查项 ${id} 的 ${field}`).toEqual(expected);
    }
  }

  const navigation = byId.get('zoom-preserving-navigation');
  expect(navigation, '缺少 UI-003 云端矩阵检查项：zoom-preserving-navigation').toBeDefined();
  expect(navigation?.pass, 'UI-003 检查项必须通过：zoom-preserving-navigation').toBe(true);
  const beforeZoom = asString(navigation?.beforeZoom, '导航前缩放值');
  expect(asString(navigation?.afterZoom, '导航后缩放值')).toBe(beforeZoom);
}

function expectGitCommitToBeAuditableHeadAncestor(commit: string): void {
  const exists = spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(exists.status, `UI-003 Git SHA 在当前仓库中不存在：${exists.stderr}`).toBe(0);

  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(ancestor.status, 'UI-003 Git SHA 必须是当前 HEAD 的祖先').toBe(0);
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

describe('V588 云端机器证据治理门禁', () => {
  it('拒绝缺少小地图必需矩阵的任意全通过检查列表', () => {
    expect(() => assertUi003CloudMatrix([
      { id: 'arbitrary-pass', pass: true },
    ])).toThrow('缺少 UI-003 云端矩阵检查项');
  });

  it('拒绝任一治理文档仍为云端待验、未验证或缺少 exact SHA', () => {
    const evidenceSha = 'a'.repeat(40);
    const absorbedDocuments = Object.fromEntries(
      UI003_GOVERNANCE_DOCUMENT_NAMES.map((name) => [
        name,
        `V588-UI-003 已吸收，云端验证通过，exact SHA ${evidenceSha}`,
      ]),
    ) as Ui003GovernanceDocuments;

    expect(findUi003AbsorptionGovernanceIssues(absorbedDocuments, evidenceSha)).toEqual([]);

    const absorbedWithPostgresGap = Object.fromEntries(
      UI003_GOVERNANCE_DOCUMENT_NAMES.map((name) => [
        name,
        `V588-UI-003 已吸收，云端验证通过，exact SHA ${evidenceSha}\nPostgreSQL 集成门禁仍未验证（UNVERIFIED），不计为通过。`,
      ]),
    ) as Ui003GovernanceDocuments;
    expect(findUi003AbsorptionGovernanceIssues(absorbedWithPostgresGap, evidenceSha)).toEqual([]);

    const postgresOnlyDocuments = Object.fromEntries(
      UI003_GOVERNANCE_DOCUMENT_NAMES.map((name) => [
        name,
        `V588-UI-003 exact SHA ${evidenceSha}\nPostgreSQL 集成门禁仍为 UNVERIFIED。`,
      ]),
    ) as Ui003GovernanceDocuments;
    for (const name of UI003_GOVERNANCE_DOCUMENT_NAMES) {
      expect(findUi003AbsorptionGovernanceIssues(postgresOnlyDocuments, evidenceSha)).toContain(
        `${name}: missing absorbed status`,
      );
    }

    for (const name of UI003_GOVERNANCE_DOCUMENT_NAMES) {
      const staleDocuments = {
        ...absorbedDocuments,
        [name]: `V588-UI-003 本地候选通过 / 云端待验，exact SHA ${evidenceSha}`,
      };
      expect(findUi003AbsorptionGovernanceIssues(staleDocuments, evidenceSha)).toContain(
        `${name}: still pending cloud verification`,
      );

      const missingShaDocuments = {
        ...absorbedDocuments,
        [name]: 'V588-UI-003 已吸收，云端验证通过',
      };
      expect(findUi003AbsorptionGovernanceIssues(missingShaDocuments, evidenceSha)).toContain(
        `${name}: missing exact evidence SHA`,
      );
    }

    expect(findUi003AbsorptionGovernanceIssues(absorbedDocuments, 'abc')).toContain(
      'evidence: gitCommit must be a 40-character SHA',
    );
  });

  it('按当前证据契约校验已吸收的 UI-001 与 UI-002 机器记录', async () => {
    const ui001Path = 'docs/testing/evidence/v588-ui-001-cloud-2026-08-22.json';
    const ui002Path = 'docs/testing/evidence/v588-ui-002-cloud-2026-08-22.json';
    const ui001 = await readJson(ui001Path);
    const ui002 = await readJson(ui002Path);

    expect(asNumber(ui001.schemaVersion, 'UI-001 schemaVersion')).toBe(1);
    expect(asString(ui001.item, 'UI-001 项目')).toBe('V588-UI-001');
    const ui001Candidate = asObject(ui001.candidate, 'UI-001 候选信息');
    const ui001Browser = asObject(ui001.browser, 'UI-001 浏览器信息');
    const ui001Health = asObject(ui001.browserHealth, 'UI-001 浏览器健康信息');
    expect(asString(ui001Candidate.githubMain, 'UI-001 Git SHA')).toBe(
      '986f128006c246b400f116da7fb3a5b4c02f0a6c',
    );
    expect(asString(ui001Candidate.stable, 'UI-001 stable SHA')).toBe(stableSha);
    expect(ui001Candidate.cozeTreeEqualsOriginMain).toBe(true);
    expect(ui001Candidate.cozeWorktreeClean).toBe(true);
    expect(asNumber(ui001Candidate.cozeBuildExit, 'UI-001 构建退出码')).toBe(0);
    expect(asNumber(ui001Candidate.cozeRootHttpStatus, 'UI-001 HTTP 状态')).toBe(200);
    expect(asNumber(ui001Health.freshConsoleErrorsOrWarnings, 'UI-001 Console')).toBe(0);
    const ui001Screenshot = asString(ui001Browser.screenshot, 'UI-001 截图');
    await expectArtifact(ui001Screenshot, 'UI-001 截图');
    validateCompletedRecord({
      commit: asString(ui001Candidate.githubMain, 'UI-001 Git SHA'),
      deploymentUrl: asString(ui001Candidate.runtimeAdministratorOrigin, 'UI-001 运行地址'),
      browser: 'Google Chrome 用户1',
      capturedAt: asString(ui001.recordedAt, 'UI-001 记录时间'),
      featureId: 'V588-UI-001',
      viewport: { width: 1440, height: 900 },
      artifactPaths: {
        screenshot: ui001Screenshot,
        console: ui001Path,
        network: ui001Path,
        task: ui001Path,
      },
      requestIds: ['v588-ui-001-cloud'],
    });

    expect(asString(ui002.testId, 'UI-002 测试标识')).toBe('V588-UI-002-cloud');
    expect(asString(ui002.result, 'UI-002 结果')).toBe('passed');
    const ui002Environment = asObject(ui002.environment, 'UI-002 运行环境');
    const ui002Summary = asObject(ui002.summary, 'UI-002 汇总');
    const ui002Console = asObject(ui002.console, 'UI-002 控制台');
    const ui002Artifacts = asObject(ui002.artifacts, 'UI-002 产物');
    const ui002Checks = ui002.checks;
    expect(asString(ui002Environment.gitCommit, 'UI-002 Git SHA')).toBe(
      '1681b2b80a5afdbb23c710616a3b9cd99fd47e71',
    );
    expect(asString(ui002Environment.stableCommit, 'UI-002 stable SHA')).toBe(stableSha);
    expect(asNumber(ui002Environment.cozeBuildExitCode, 'UI-002 构建退出码')).toBe(0);
    expect(asNumber(ui002Environment.httpStatus, 'UI-002 HTTP 状态')).toBe(200);
    expect(asNumber(ui002Summary.checks, 'UI-002 检查总数')).toBe(30);
    expect(asNumber(ui002Summary.passed, 'UI-002 通过数')).toBe(30);
    expect(asNumber(ui002Summary.failed, 'UI-002 失败数')).toBe(0);
    expect(Array.isArray(ui002Checks), 'UI-002 检查列表必须存在').toBe(true);
    expect(ui002Checks).toHaveLength(asNumber(ui002Summary.checks, 'UI-002 检查总数'));
    for (const check of ui002Checks as unknown[]) {
      expect(asObject(check, 'UI-002 检查项').pass).toBe(true);
    }
    expect(asNumber(ui002Console.errors, 'UI-002 Console 错误数')).toBe(0);
    expect(asNumber(ui002Console.warnings, 'UI-002 Console 警告数')).toBe(0);
    const ui002Screenshot = asString(ui002Artifacts.screenshot, 'UI-002 截图');
    await expectArtifact(ui002Screenshot, 'UI-002 截图');
    validateCompletedRecord({
      commit: asString(ui002Environment.gitCommit, 'UI-002 Git SHA'),
      deploymentUrl: asString(ui002Environment.url, 'UI-002 运行地址'),
      browser: asString(ui002Environment.browser, 'UI-002 浏览器'),
      capturedAt: asString(ui002.testedAt, 'UI-002 测试时间'),
      featureId: 'V588-UI-002',
      viewport: { width: 1440, height: 900 },
      artifactPaths: {
        screenshot: ui002Screenshot,
        console: ui002Path,
        network: ui002Path,
        task: ui002Path,
      },
      requestIds: ['v588-ui-002-cloud'],
    });
  });

  it('要求 UI-003 的云端证据状态与吸收文档保持一致', async () => {
    const artifacts = (await readdir(evidenceDirectory))
      .filter((name) => /^v588-ui-003-cloud-.*$/i.test(name))
      .sort();
    const matches = artifacts.filter((name) => name.endsWith('.json'));
    const governanceDocuments = await readUi003GovernanceDocuments();
    const inventorySection = governanceDocuments.inventory;
    const releaseSection = governanceDocuments.release;

    if (artifacts.length === 0) {
      expect(inventorySection).toContain('**状态：本地候选通过 / 云端待验。**');
      expect(inventorySection).toContain('未创建任何云端证据文件');
      expect(inventorySection).toContain('未标记为已吸收');
      expect(releaseSection).toContain('**发布判定：本地候选通过 / 云端待验。**');
      expect(releaseSection).toContain('尚无 Coze exact SHA');
      expect(releaseSection).toContain('不得将本地验证升级为云端通过或已吸收');
      for (const section of Object.values(governanceDocuments)) {
        expect(section).toMatch(/(?:本地候选|云端待验|待验项)/u);
      }
      return;
    }

    expect(matches, '存在 UI-003 云端产物时必须有且仅有一份机器证据 JSON').toHaveLength(1);
    const relativePath = `docs/testing/evidence/${matches[0]}`;
    const evidence = await readJson(relativePath);
    const environment = asObject(evidence.environment, 'UI-003 运行环境');
    const summary = asObject(evidence.summary, 'UI-003 汇总');
    const artifactPaths = asObject(evidence.artifacts, 'UI-003 产物');
    const consoleEvidence = asObject(evidence.console, 'UI-003 控制台');
    const requestIds = evidence.requestIds;
    const checks = evidence.checks;
    const evidenceSha = asString(environment.gitCommit, 'UI-003 Git SHA');

    expect(asString(evidence.testId, 'UI-003 测试标识')).toBe('V588-UI-003-cloud');
    expect(asString(evidence.result, 'UI-003 结果')).toBe('passed');
    expect(evidenceSha).toMatch(/^[0-9a-f]{40}$/i);
    expectGitCommitToBeAuditableHeadAncestor(evidenceSha);
    expect(asString(environment.stableCommit, 'UI-003 stable SHA')).toBe(stableSha);
    expect(asNumber(environment.cozeBuildExitCode, 'UI-003 构建退出码')).toBe(0);
    expect(asNumber(environment.httpStatus, 'UI-003 HTTP 状态')).toBe(200);
    expect(asNumber(summary.checks, 'UI-003 检查总数')).toBeGreaterThanOrEqual(
      ui003RequiredChecks.length + 1,
    );
    expect(asNumber(summary.passed, 'UI-003 通过数')).toBe(
      asNumber(summary.checks, 'UI-003 检查总数'),
    );
    expect(asNumber(summary.failed, 'UI-003 失败数')).toBe(0);
    expect(checks).toHaveLength(asNumber(summary.checks, 'UI-003 检查总数'));
    assertUi003CloudMatrix(checks);
    expect(asNumber(consoleEvidence.errors, 'UI-003 Console 错误数')).toBe(0);
    expect(asNumber(consoleEvidence.warnings, 'UI-003 Console 警告数')).toBe(0);
    expect(Array.isArray(requestIds), 'UI-003 请求标识必须存在').toBe(true);
    expect(requestIds).not.toHaveLength(0);
    expect((requestIds as unknown[]).every((id) => typeof id === 'string' && id.trim() !== '')).toBe(true);

    const screenshot = asString(artifactPaths.screenshot, 'UI-003 截图');
    const consolePath = asString(artifactPaths.console, 'UI-003 控制台文件');
    const networkPath = asString(artifactPaths.network, 'UI-003 网络文件');
    const taskPath = asString(artifactPaths.task, 'UI-003 任务文件');
    await Promise.all([
      expectArtifact(screenshot, 'UI-003 截图'),
      expectArtifact(consolePath, 'UI-003 控制台文件'),
      expectArtifact(networkPath, 'UI-003 网络文件'),
      expectArtifact(taskPath, 'UI-003 任务文件'),
    ]);
    validateCompletedRecord({
      commit: evidenceSha,
      deploymentUrl: asString(environment.url, 'UI-003 运行地址'),
      browser: asString(environment.browser, 'UI-003 浏览器'),
      capturedAt: asString(evidence.testedAt, 'UI-003 测试时间'),
      featureId: 'V588-UI-003',
      viewport: asObject(evidence.viewport, 'UI-003 视口'),
      artifactPaths,
      requestIds: requestIds as string[],
    });
    expect(findUi003AbsorptionGovernanceIssues(governanceDocuments, evidenceSha)).toEqual([]);
    expect(inventorySection).toContain('**状态：V588-UI-003 已吸收。**');
    expect(releaseSection).toContain('**发布判定：V588-UI-003 通过并完成吸收。**');
  });
});
