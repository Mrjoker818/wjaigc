# V588-SAFETY-001 WASM SVG 描摹像素预算实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅为同步 WASM VTracer fallback 增加 `512 * 512` 像素预算，防止大图长时间阻塞 Node.js 事件循环，同时保持其他矢量引擎的输入质量和现有业务行为。

**Architecture:** 新建一个无运行时依赖的预算纯函数，由 SVG 路由中的 `runWasmVTracer()` 在 raw RGBA 解码前调用。AI 管线、Python VTracer、ImageTracer、Potrace、任务、账务和前端均不修改；V5.8.8 只提供算法参考，不复制完整路由。

**Tech Stack:** Next.js 16 App Router、TypeScript 5、Sharp、`wasm_vtracer`、Vitest、ESLint、Google Chrome、Coze 沙箱。

## Global Constraints

- 仅修改 `main`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 始终只读。
- donor 固定为 `J:/无界云端0820`，不得写入或从 donor 整文件覆盖当前路由。
- 必须按 RED -> 最小实现 -> 聚焦回归 -> 全量回归 -> Coze exact SHA -> Google Chrome 真实验收执行。
- 默认预算精确为 `512 * 512 = 262,144` 像素。
- 预算只作用于同步 `convertImageToSvg()` 输入，不改变 Recraft、管理员矢量模型、VLM、Python VTracer、ImageTracer 或 Potrace 输入。
- 不修改 SVG 质量预设、路径阈值、积分、退款、任务状态或前端功能入口。
- 不创建新的 Chrome 标签页，不使用 360 浏览器；只复用现有 Coze 项目页和预览页。

---

### Task 1: 建立 WASM 像素预算 RED

**Files:**
- Create: `src/__tests__/api/svg-trace-wasm-pixel-budget.test.ts`
- Reference: `docs/superpowers/specs/2026-08-23-v588-safety-001-wasm-svg-pixel-budget.md`

**Interfaces:**
- Consumes: 尚不存在的 `computeWasmTraceBudget(width, height, maxPixels?)` 与 `WASM_TRACER_MAX_PIXELS`。
- Produces: 预算数学边界和路由接线顺序的失败契约。

- [x] **Step 1: 写纯函数与路由接线失败测试**

创建测试，覆盖以下实际断言：

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeWasmTraceBudget,
  WASM_TRACER_MAX_PIXELS,
} from '@/app/api/svg-trace/wasm-budget';

const routeSource = readFileSync(
  join(process.cwd(), 'src/app/api/svg-trace/route.ts'),
  'utf8',
);

describe('svg-trace WASM 像素预算', () => {
  it('固定预算为 512 * 512', () => {
    expect(WASM_TRACER_MAX_PIXELS).toBe(262_144);
  });

  it.each([
    [256, 256],
    [512, 512],
  ])('预算内尺寸 %sx%s 保持不变', (width, height) => {
    expect(computeWasmTraceBudget(width, height)).toEqual({
      scale: 1,
      width,
      height,
    });
  });

  it('将 2048x2048 等比限制为 512x512', () => {
    expect(computeWasmTraceBudget(2048, 2048)).toEqual({
      scale: 0.25,
      width: 512,
      height: 512,
    });
  });

  it('限制非方图面积并保持纵横比', () => {
    const result = computeWasmTraceBudget(1024, 512);
    expect(result.width * result.height).toBeLessThanOrEqual(WASM_TRACER_MAX_PIXELS);
    expect(result.width / result.height).toBeCloseTo(2, 2);
  });

  it.each([
    [Number.NaN, 2048, undefined],
    [Number.POSITIVE_INFINITY, 2048, undefined],
    [-4, 0, undefined],
    [2048, 2048, Number.NaN],
    [2048, 2048, -1],
  ])('非法输入仍返回有限正整数', (width, height, maxPixels) => {
    const result = computeWasmTraceBudget(width, height, maxPixels);
    expect(Number.isFinite(result.scale)).toBe(true);
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('近边界取整后仍不超过预算', () => {
    const result = computeWasmTraceBudget(1001, 777, 262_144);
    expect(result.width * result.height).toBeLessThanOrEqual(262_144);
  });

  it('在同步 WASM 转换前应用预算且不改通用预处理上限', () => {
    expect(routeSource).toContain("from './wasm-budget'");
    expect(routeSource).toContain('const maxSize = params.colorPrecision >= 128 ? 4096 : 3072');

    const functionStart = routeSource.indexOf('async function runWasmVTracer');
    const functionBody = routeSource.slice(functionStart, functionStart + 5000);
    const budgetIndex = functionBody.indexOf('computeWasmTraceBudget');
    const convertIndex = functionBody.indexOf('convertImageToSvg');

    expect(functionStart).toBeGreaterThan(-1);
    expect(budgetIndex).toBeGreaterThan(-1);
    expect(convertIndex).toBeGreaterThan(budgetIndex);
    expect(functionBody).toContain('.resize(budget.width, budget.height');
  });
});
```

- [x] **Step 2: 运行测试并保存 RED 证据**

Run:

```bash
pnpm exec vitest run src/__tests__/api/svg-trace-wasm-pixel-budget.test.ts
```

Expected: FAIL；直接原因必须是 `@/app/api/svg-trace/wasm-budget` 不存在或预算导出不存在。若因环境、依赖或无关语法失败，先修正测试，不得进入生产实现。

- [x] **Step 3: 提交失败测试**

```bash
git add src/__tests__/api/svg-trace-wasm-pixel-budget.test.ts
git commit -m "test: reproduce wasm svg pixel budget gap"
```

---

### Task 2: 最小接入预算纯函数

**Files:**
- Create: `src/app/api/svg-trace/wasm-budget.ts`
- Modify: `src/app/api/svg-trace/route.ts:412-485`
- Modify: `package.json` (`check:protected-baseline` 的允许路径列表)
- Test: `src/__tests__/api/svg-trace-wasm-pixel-budget.test.ts`

**Interfaces:**
- Consumes: Task 1 的失败契约。
- Produces: `WASM_TRACER_MAX_PIXELS` 和 `computeWasmTraceBudget(width, height, maxPixels?)`；`runWasmVTracer()` 在同步 WASM 前应用预算。

- [x] **Step 1: 新增预算纯函数**

创建 `src/app/api/svg-trace/wasm-budget.ts`：

```ts
export const WASM_TRACER_MAX_PIXELS = 512 * 512;

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function computeWasmTraceBudget(
  width: number,
  height: number,
  maxPixels: number = WASM_TRACER_MAX_PIXELS,
): { scale: number; width: number; height: number } {
  const normalizedWidth = normalizePositiveInteger(width, 1);
  const normalizedHeight = normalizePositiveInteger(height, 1);
  const normalizedMaxPixels = normalizePositiveInteger(
    maxPixels,
    WASM_TRACER_MAX_PIXELS,
  );
  const pixels = normalizedWidth * normalizedHeight;

  if (pixels <= normalizedMaxPixels) {
    return {
      scale: 1,
      width: normalizedWidth,
      height: normalizedHeight,
    };
  }

  const scale = Math.sqrt(normalizedMaxPixels / pixels);
  return {
    scale,
    width: Math.max(1, Math.floor(normalizedWidth * scale)),
    height: Math.max(1, Math.floor(normalizedHeight * scale)),
  };
}
```

- [x] **Step 2: 仅在 `runWasmVTracer()` 内接线**

在路由顶部导入：

```ts
import {
  computeWasmTraceBudget,
  WASM_TRACER_MAX_PIXELS,
} from './wasm-budget';
```

将 raw 解码块改为：

```ts
const image = sharp(inputBuffer);
const metadata = await image.metadata();
const budget = computeWasmTraceBudget(
  metadata.width ?? 0,
  metadata.height ?? 0,
);

if (budget.scale < 1) {
  console.log(
    `[svg-trace] WASM budget: ${metadata.width}x${metadata.height} exceeds ${WASM_TRACER_MAX_PIXELS}px, downscaling to ${budget.width}x${budget.height}`,
  );
}

const wasmImage = budget.scale < 1
  ? image.resize(budget.width, budget.height, {
      fit: 'fill',
      kernel: 'lanczos3',
    })
  : image;

const { data, info } = await wasmImage
  .raw()
  .ensureAlpha()
  .toBuffer({ resolveWithObject: true });
```

不得修改 `preprocessForVTracer()` 的 3072/4096 上限，也不得把预算后的 buffer 传给 Python fallback。

- [x] **Step 3: 将新增生产路径加入保护门禁允许清单**

在 `package.json` 的 `check:protected-baseline` 命令末尾增加：

```text
--allow-path src/app/api/svg-trace/route.ts --allow-path src/app/api/svg-trace/wasm-budget.ts
```

测试与文档目录已由门禁默认允许，不增加多余白名单。

- [x] **Step 4: 运行聚焦测试并确认 GREEN**

Run:

```bash
pnpm exec vitest run src/__tests__/api/svg-trace-wasm-pixel-budget.test.ts src/__tests__/lib/build-command-contract.test.ts
pnpm ts-check
pnpm exec eslint src/app/api/svg-trace/route.ts src/app/api/svg-trace/wasm-budget.ts src/__tests__/api/svg-trace-wasm-pixel-budget.test.ts
pnpm check:protected-baseline
git diff --check
```

Expected: 所有命令退出码 0；专项预算测试全部通过；保护门禁没有 `Unapproved source drift`。

- [x] **Step 5: 提交最小实现**

```bash
git add package.json src/app/api/svg-trace/route.ts src/app/api/svg-trace/wasm-budget.ts
git commit -m "fix: bound synchronous wasm svg tracing"
```

---

### Task 3: 全量回归、独立审查与 `main` 推送

**Files:**
- Modify only if evidence requires: Task 2 files
- Record later: `docs/testing/BUG_REGISTER.md`
- Record later: `docs/testing/REGRESSION_REPORT.md`
- Record later: `docs/testing/RELEASE_READINESS_REPORT.md`
- Record later: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Consumes: Task 2 的绿色候选。
- Produces: 可推送的本地候选、完整门禁证据和未触碰 `stable` 的 Git 证明。

- [x] **Step 1: 运行全量本地门禁**

```bash
pnpm ts-check
pnpm lint
pnpm test
pnpm build
pnpm check:protected-baseline
git diff --check
```

Expected: 全部退出码 0。没有配置 `POSTGRES_TEST_DATABASE_URL` 的 PostgreSQL 专项必须如实记为 skipped，不能计为通过。

- [x] **Step 2: 独立审查精确差异**

审查范围只包含：

```text
src/app/api/svg-trace/wasm-budget.ts
src/app/api/svg-trace/route.ts
src/__tests__/api/svg-trace-wasm-pixel-budget.test.ts
package.json
```

必须确认：没有全链路缩图、没有新任务状态、没有账务变更、没有吞异常、没有修改前端入口、没有 donor 整文件覆盖。只修复可复现 findings，然后重跑 Task 3 Step 1。

- [x] **Step 3: 推送 `main` 并锁定 SHA**

```bash
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git rev-parse origin/stable
git push origin HEAD:main
git rev-parse origin/main
git rev-parse origin/stable
```

Expected: `main` 普通快进到候选 exact SHA；`origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。

---

### Task 4: Coze exact-SHA 与 Google Chrome 真实验收

**Files:**
- Create: `docs/testing/evidence/v588-safety-001-wasm-svg-budget-2026-08-23.json`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify external: `F:/AIGC/vault-template/无界计划/11-阶段进度看板.md`
- Modify external: `F:/AIGC/vault-template/无界计划/16-V5.8.8选择性吸收.md`

**Interfaces:**
- Consumes: Task 3 推送的 exact SHA。
- Produces: 云端运行、并发健康、任务终态、浏览器日志、Git 分支与治理记录的机器可读证据。

- [x] **Step 1: 在现有 Coze 项目页拉取 exact SHA 并干净构建**

只复用现有 Google Chrome 项目页。若出现沙箱断开弹窗，点击页面刷新，等待终端恢复后执行：

```bash
cd /workspace/worktrees/main-fix
git fetch origin main
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
git rev-parse origin/stable
pnpm build
```

Expected: HEAD 等于 Task 3 exact SHA；stable 等于固定 SHA；构建成功。随后按当前 Coze 启动方式重启 5000 端口，并强制刷新现有预览页。

- [x] **Step 2: 真实执行大图 SVG 描摹与并发健康探针**

在已登录预览页选择一张长宽均明显大于 512 的真实画布图片，执行“SVG智能描摹”，选择本地/WASM 可达路径。提交后立即从 Coze 终端每 500ms 请求一次轻量健康端点或首页，共至少 20 次，并记录每次状态码与耗时。

验收：

- SVG 请求必须得到成功终态或明确失败终态，不能永久加载。
- 服务端日志必须出现预算前尺寸和预算后尺寸，预算后面积不超过 262,144。
- 并发健康请求不得因 WASM 单次同步执行连续超时；记录最大、P95 耗时。
- 若 AI 管线先成功而没有进入 WASM，标记“未触发 fallback”，不得冒充预算验证通过；必须使用可明确进入本地路径的请求重新验证。

- [x] **Step 3: 检查浏览器与服务端异常**

在同一现有预览页收集：

- Console error/warning；
- SVG 请求与任务查询网络响应；
- 浏览器原生 dialog；
- Coze 服务端未处理异常；
- 结果节点是否进入画布、可选择和下载。

Expected: 没有未处理 Console error、Promise rejection 或永久 loading；失败时必须保留明确业务错误。

- [x] **Step 4: 写入机器证据和中文报告**

证据 JSON 至少包含：

```json
{
  "candidateCommit": "<exact-sha>",
  "stableCommit": "52f7c601ed150769e15d06fb435c6e360e28c9e7",
  "cloudUrl": "<existing-preview-url>",
  "sourceDimensions": { "width": 0, "height": 0 },
  "wasmDimensions": { "width": 0, "height": 0 },
  "maxPixels": 262144,
  "fallbackTriggered": true,
  "probeCount": 20,
  "probeMaxMs": 0,
  "probeP95Ms": 0,
  "taskTerminalState": "completed-or-failed",
  "consoleErrors": [],
  "consoleWarnings": [],
  "dialogs": [],
  "verifiedAt": "<ISO-8601>"
}
```

在四份测试报告中登记真实结果和任何未验证项；不得把 PostgreSQL skipped、未触发 fallback 或失败任务写成通过。

- [x] **Step 5: 更新 Obsidian 并提交治理证据**

只有 Task 4 Step 1-4 全部有证据时，才在两份 Obsidian 文档中把 `V588-SAFETY-001` 标记为“已吸收”，并把下一唯一项更新为 `V588-AUTH-001`。若云端未触发 WASM 或沙箱不可用，则保持“本地候选/云端未闭环”。

```bash
git add docs/testing docs/superpowers/plans/2026-08-23-v588-safety-001-wasm-svg-pixel-budget.md
git commit -m "docs: record wasm svg budget verification"
git push origin HEAD:main
```

## Self-Review

- 规格覆盖：像素预算、非法输入、面积上限、调用顺序、其他引擎不降质、全量门禁、exact SHA、并发健康和浏览器终态均有任务。
- 占位扫描：计划没有 `TBD`、`TODO`、“自行处理”或未定义接口；云端证据字段和验收条件已明确。
- 类型一致：纯函数签名、返回字段和路由变量在 Task 1、Task 2 与 Task 4 中一致。
- 目标边界：没有任务允许修改 `stable`、donor、积分、任务状态、前端入口或整体 SVG 路由。
- 防误判：未触发 WASM fallback、PostgreSQL skipped、明确失败终态均要求如实记录，不能冒充通过。

## 完成记录（2026-08-23）

- RED：`5003337`；最小实现：`d968ad3448c9a3202f462959baaa89dab5f471cd`。
- 本地：聚焦 `14/14`，全仓 `3099 passed / 105 PostgreSQL-gated skipped`，TypeScript、零错误 ESLint、`116/116` 构建与保护基线通过。
- 云端：Coze exact `d968ad3`，真实 `1536x1024` 图片进入 WASM 后缩至 `627x418`，约 `10.245s` 完成；并发探针 `80/80` HTTP 200，P95 `8.163ms`。
- 结果：画布节点保持 `1536x1024`，SVG 文件实际下载并完成 SHA-256 核验；Console error/warning 与 dialog 均为 0。
- 状态：**V588-SAFETY-001 已吸收并完成云端关闭。** 下一唯一项为 `V588-AUTH-001`。
