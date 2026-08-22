import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateEvidenceManifest } from '../helpers/evidence-manifest';

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const evidenceDirectory = resolve(root, 'docs/testing/evidence');
const inventoryPath = resolve(root, 'docs/plans/v588/V588_ABSORPTION_INVENTORY.md');
const releasePath = resolve(root, 'docs/testing/RELEASE_READINESS_REPORT.md');
const stableSha = '52f7c601ed150769e15d06fb435c6e360e28c9e7';
const ui003CandidateSha = 'b5b0b18ed1feda1f5324537f15a9645b87e4fc9d';

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

function extractSection(document: string, heading: string): string {
  const start = document.indexOf(heading);
  expect(start, `缺少治理章节：${heading}`).toBeGreaterThanOrEqual(0);

  const following = document.slice(start + heading.length);
  const nextHeading = following.search(/\n## /);
  return nextHeading === -1
    ? document.slice(start)
    : document.slice(start, start + heading.length + nextHeading);
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

describe('V588 云端机器证据治理门禁', () => {
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
    const matches = (await readdir(evidenceDirectory))
      .filter((name) => /^v588-ui-003-cloud-.*\.json$/i.test(name))
      .sort();
    const inventory = await readFile(inventoryPath, 'utf8');
    const release = await readFile(releasePath, 'utf8');
    const inventorySection = extractSection(
      inventory,
      '### V588-UI-003 - 2026-08-22 小地图本地候选',
    );
    const releaseSection = extractSection(
      release,
      '## 2026-08-22 V588-UI-003 小地图发布准备度',
    );

    if (matches.length === 0) {
      expect(inventorySection).toContain('**状态：本地候选通过 / 云端待验。**');
      expect(inventorySection).toContain('未创建任何云端证据文件');
      expect(inventorySection).toContain('未标记为已吸收');
      expect(releaseSection).toContain('**发布判定：本地候选通过 / 云端待验。**');
      expect(releaseSection).toContain('尚无 Coze exact SHA');
      expect(releaseSection).toContain('不得将本地验证升级为云端通过或已吸收');
      return;
    }

    expect(matches, 'UI-003 云端闭环只能保留一份规范机器证据').toHaveLength(1);
    const relativePath = `docs/testing/evidence/${matches[0]}`;
    const evidence = await readJson(relativePath);
    const environment = asObject(evidence.environment, 'UI-003 运行环境');
    const summary = asObject(evidence.summary, 'UI-003 汇总');
    const artifacts = asObject(evidence.artifacts, 'UI-003 产物');
    const consoleEvidence = asObject(evidence.console, 'UI-003 控制台');
    const requestIds = evidence.requestIds;
    const checks = evidence.checks;

    expect(asString(evidence.testId, 'UI-003 测试标识')).toBe('V588-UI-003-cloud');
    expect(asString(evidence.result, 'UI-003 结果')).toBe('passed');
    expect(asString(environment.gitCommit, 'UI-003 Git SHA')).toBe(ui003CandidateSha);
    expect(asString(environment.stableCommit, 'UI-003 stable SHA')).toBe(stableSha);
    expect(asNumber(environment.cozeBuildExitCode, 'UI-003 构建退出码')).toBe(0);
    expect(asNumber(environment.httpStatus, 'UI-003 HTTP 状态')).toBe(200);
    expect(asNumber(summary.checks, 'UI-003 检查总数')).toBeGreaterThan(0);
    expect(asNumber(summary.passed, 'UI-003 通过数')).toBe(
      asNumber(summary.checks, 'UI-003 检查总数'),
    );
    expect(asNumber(summary.failed, 'UI-003 失败数')).toBe(0);
    expect(Array.isArray(checks), 'UI-003 检查列表必须存在').toBe(true);
    expect(checks).toHaveLength(asNumber(summary.checks, 'UI-003 检查总数'));
    for (const check of checks as unknown[]) {
      expect(asObject(check, 'UI-003 检查项').pass).toBe(true);
    }
    expect(asNumber(consoleEvidence.errors, 'UI-003 Console 错误数')).toBe(0);
    expect(asNumber(consoleEvidence.warnings, 'UI-003 Console 警告数')).toBe(0);
    expect(Array.isArray(requestIds), 'UI-003 请求标识必须存在').toBe(true);
    expect(requestIds).not.toHaveLength(0);
    expect((requestIds as unknown[]).every((id) => typeof id === 'string' && id.trim() !== '')).toBe(true);

    const screenshot = asString(artifacts.screenshot, 'UI-003 截图');
    const consolePath = asString(artifacts.console, 'UI-003 控制台文件');
    const networkPath = asString(artifacts.network, 'UI-003 网络文件');
    const taskPath = asString(artifacts.task, 'UI-003 任务文件');
    await Promise.all([
      expectArtifact(screenshot, 'UI-003 截图'),
      expectArtifact(consolePath, 'UI-003 控制台文件'),
      expectArtifact(networkPath, 'UI-003 网络文件'),
      expectArtifact(taskPath, 'UI-003 任务文件'),
    ]);
    validateCompletedRecord({
      commit: asString(environment.gitCommit, 'UI-003 Git SHA'),
      deploymentUrl: asString(environment.url, 'UI-003 运行地址'),
      browser: asString(environment.browser, 'UI-003 浏览器'),
      capturedAt: asString(evidence.testedAt, 'UI-003 测试时间'),
      featureId: 'V588-UI-003',
      viewport: asObject(evidence.viewport, 'UI-003 视口'),
      artifactPaths: artifacts,
      requestIds: requestIds as string[],
    });
    expect(inventorySection).toContain('**状态：V588-UI-003 已吸收。**');
    expect(releaseSection).toContain('**发布判定：V588-UI-003 通过并完成吸收。**');
  });
});
