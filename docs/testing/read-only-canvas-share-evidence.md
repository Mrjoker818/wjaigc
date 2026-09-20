# 只读画布分享发布证据

> 状态：本地候选门禁已完成；存在明确的真实环境未验证项，发布保持关闭。本文不包含 raw token、媒体 URL、storage key、供应商载荷或个人标识。

## 先列阻断与未验证项

| 门禁 | 状态 | 原因 / 解除条件 |
| --- | --- | --- |
| 真实 PostgreSQL 并发、迁移重复执行、事务竞态 | **未验证** | 当前环境缺少 `POSTGRES_TEST_DATABASE_URL`；4 个新增并发用例和既有 Canvas Share PostgreSQL 套件均不得计为通过。 |
| P0 真实账号流程 | **未验证** | 缺少受控账号、密码和生成模型前置。 |
| Stage 2 真实资产生命周期 | **未验证** | 缺少受控 fixture、账号和真实数据库前置。 |
| Firefox / WebKit 功能矩阵 | **未验证** | 本阶段只取得 Chromium 功能证据；launch-only 结果不等价于功能通过。 |
| 云端 / Coze / GitHub main | **未验证** | 候选尚未推送或合入 main，不能把本地 worktree 当作云端证据。 |
| 真实 token 的 trace 脱敏 | **未验证** | Playwright 使用合成 token/ref；只能证明合成 fixture 不泄漏。 |
| 发布开关 | **关闭** | `WUJIE_CANVAS_SHARE_ENABLED` 仅在精确值 `true` 时开启；当前没有授权启用。 |

## 候选身份与运行模式

- 计划基线：`main@953bd6309a571a6af7bfbac330ec6f31663779eb`。
- Task 7 审查基线：`7848c01a82dab2543ede38c779c7def8a5696401`。
- Task 8 实现与完整本地门禁提交：`dd4880bc87ac13e723d7cd36d71b9e0a484bfbeb`。
- 本地分支：`codex/read-only-canvas-share`；不把 feature worktree 记作 main。
- 本地 `main`：`953bd6309a571a6af7bfbac330ec6f31663779eb`，候选领先 28 个提交。
- `origin/main`：`9b6077b72f0661b68054c5b4709dc7e25997f9f2`，候选领先 30 个提交。
- 运行模式：本地 Next.js / Vitest / Playwright 合成 fixture；没有真实云端或真实账号声明。
- 迁移版本：`migrations/20260919_read_only_canvas_shares.sql`。

## 冻结契约

- Feature flag：`src/lib/canvas-share/request.ts` 中 `process.env.WUJIE_CANVAS_SHARE_ENABLED === 'true'`，默认关闭。
- Owner API：`POST/GET /api/canvas-shares`、`POST /api/canvas-shares/preflight`、`PATCH /api/canvas-shares/[shareId]`、`POST /api/canvas-shares/[shareId]/revoke`。
- Public API：`GET /api/public/canvas-shares/[token]`。
- Controlled media：`GET/HEAD /api/public/canvas-shares/[token]/media/[itemId]`；下载由 `/download` 路由及服务端 `allowDownload` 强制控制。
- 公共投影只返回派生 `itemRef` 和相对 `mediaPath` / 可选 `downloadPath`；不返回 raw token、owner/project/asset/version/placement ID 或任意绝对 URL。
- Viewer：`src/app/shared/canvas/[token]` 与 `src/components/canvas-share/shared-canvas-viewer.tsx`，不导入主编辑器状态机。
- Fixture / evidence contract：`tests/helpers/read-only-canvas-share-contract.ts`，record schema v4，expected/executed/passed 固定为 8/8/8。

## RED 与最小 GREEN

1. 修改前运行 `pnpm check:protected-baseline`：阻断 33 个未登记的 Canvas Share source 路径，exit 1。
2. 仅将脚本逐项点名的 33 个路径加入 `docs/testing/baselines/protected-baseline-allowed-paths.json`；未加入目录通配符或无关路径。
3. 修改后同一命令：38 个 baseline feature ID 保留，source drift / protected component / evidence contract / Git refs 全部通过，0 warning。
4. 安全回归新增实际泄漏负探针；扫描公开 JSON、捕获日志、公开错误体和落盘 artifact。正向输出无 private marker，负向 artifact 被准确检出。
5. PostgreSQL 并发套件覆盖重复创建、重复撤销、策略 CAS、过期竞态、媒体读取与撤销；当前因真库缺失全部明确 skip，不写成通过。

## 可复现命令与已取得证据

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| Task 8 聚焦安全 / DB | `pnpm exec vitest run src/__tests__/lib/canvas-share-security-regression.test.ts tests/integration/canvas-share-concurrency-postgres.test.ts --reporter=verbose` | 安全 2/2 passed；PostgreSQL 4 skipped（未验证）。 |
| 类型 | `pnpm ts-check` | passed。 |
| 定向 lint | `pnpm exec eslint src/__tests__/lib/canvas-share-security-regression.test.ts tests/integration/canvas-share-concurrency-postgres.test.ts --max-warnings=0` | passed。 |
| 保护基线 | `pnpm check:protected-baseline` | 修改后 passed，0 warning。 |
| Task 7 evidence/CLI | `pnpm exec vitest run tests/unit/read-only-canvas-share-evidence-round5.spec.ts tests/unit/read-only-canvas-share-evidence.spec.ts tests/unit/read-only-canvas-share-evidence-cli.spec.ts --reporter=dot` | 44/44 passed at `7848c01a…`。 |
| Viewer component/API | 见 Task 7 报告中的 3-file focused command | 127/127 passed at `7848c01a…`。 |
| Desktop Chromium | Task 7 desktop matrix | 4/4 passed。 |
| Mobile Chromium | Task 7 mobile matrix | 4 actual passed，4 个互斥 skip；实际 viewport 320×568、375×667、393×852、812×375。 |
| Network no-write gate | Task 7 network gate | 1/1 passed。 |
| 全量 Vitest | `pnpm test` | 782 files passed、43 skipped、1 failed；6902 tests passed、220 skipped、1 failed。唯一失败为既有 PostgreSQL doctor 因缺少 `POSTGRES_TEST_DATABASE_URL` 主动阻断，不能记作全绿。 |
| 统一校验 | `pnpm validate` | passed；`ts-check` 与 ESLint 均通过。仅有既有 `infinite-canvas.tsx` 超过 500 KB 的 Babel 提示。 |
| 迁移执行 | `pnpm migrate` | **未验证**；缺少 `DATABASE_URL` / `PGDATABASE_URL`，命令在运行迁移前退出。 |
| Chromium P0 | `pnpm exec playwright test tests/e2e/p0-core.spec.ts --project=chromium --reporter=line` | **未验证**；缺少 `E2E_TEST_USERNAME`、`E2E_TEST_PASSWORD`、`E2E_GENERATION_MODEL`。 |
| Chromium Stage 2 | `pnpm exec playwright test tests/e2e/stage-2-asset-lifecycle.spec.ts tests/e2e/stage-2-cross-workspace.spec.ts --project=chromium --reporter=line` | 11 skipped；缺少真实 fixture、账号与数据库前置，**未验证**。 |
| Chromium Stage 3 | `pnpm exec playwright test tests/e2e/stage-3-canvas-kernel.spec.ts --project=chromium --reporter=line` | 收集阶段因缺少 `E2E_STAGE3_PROJECT_IDS`、`E2E_STAGE3_RUN_ID` 阻断，**未验证**。 |
| Chromium Stage 4 | `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium --reporter=line` | 收集阶段因缺少 `E2E_STAGE4_EXPECTED_AGENT_MODE` 阻断，**未验证**。 |
| Task 8 Desktop Chromium | `tests/e2e/read-only-canvas-share.spec.ts` | 4/4 passed at `dd4880bc…`。 |
| Task 8 Mobile Chromium | 320、375、393 portrait 与 Pixel landscape 项目 | 4 actual passed，4 个互斥 skip。 |
| Task 8 network no-write gate | `tests/e2e/read-only-canvas-share-network.spec.ts` | 1/1 passed。 |

Task 7 的不可变证据目录：

```text
output/playwright/read-only-canvas-share-evidence/promoted/
  7848c01a82dab2543ede38c779c7def8a5696401/
  task7-owner-digest-final-20260920-7848c01a/
```

该目录的 manifest 为 passed、8/8/8、desktop/mobile 4/4、forbidden request/frame 0/0；`complete.json.ownerSha256` 与 `owner.json` 原始字节 SHA-256 一致。证据内容使用合成 fixture，不扩大为真实 token 证明。

Task 8 的精确提交证据目录：

```text
output/playwright/read-only-canvas-share-evidence/promoted/
  dd4880bc87ac13e723d7cd36d71b9e0a484bfbeb/
  task8-local-final-20260920-dd4880bc/
```

该目录在 exact commit `dd4880bc87ac13e723d7cd36d71b9e0a484bfbeb` 上由 finalizer 完成：manifest `passed`，expected/executed 为 8/8，8 条 record 全部 passed，desktop/mobile 各 4，forbidden request/frame 0/0。`complete.json` 记录的 owner SHA-256 `1187520110b1e296cfc136051afb15012d783cbeffb4ed500474f55ae9f81548` 与 `owner.json` 原始字节一致；记录的 manifest SHA-256 `79f4c043ab53f869f02aa6cbce3c06746cb49d08186688c198925db65058f02f` 与 `manifest.json` 原始字节一致。

同一 exact commit 上再次运行 `pnpm check:protected-baseline` 通过且 0 warning，38 个 baseline feature ID 与 evidence contract 均保留。证据绑定后的提交只修改文档，不改变受测实现。

## 真库复现（取得数据库后必须执行）

```powershell
$env:POSTGRES_TEST_DATABASE_URL = '<隔离测试数据库连接>'
pnpm exec vitest run `
  tests/integration/canvas-share-schema-postgres.test.ts `
  tests/integration/canvas-share-snapshot-postgres.test.ts `
  tests/integration/canvas-share-owner-postgres.test.ts `
  tests/integration/canvas-share-public-postgres.test.ts `
  tests/integration/canvas-share-concurrency-postgres.test.ts `
  --reporter=verbose
```

只有该命令在真实隔离 PostgreSQL 上通过，迁移重复执行、share/items 原子性、CAS、撤销/过期和媒体竞态才能从“未验证”改为“通过”。

## 云端验收固定顺序

仅对已推送且与运行时迁移一致的 exact main commit 执行：匿名有效链接 → 默认无下载 → 显式下载 → 撤销 → 过期 → 后续项目编辑不改变旧快照 → 媒体失效占位 → 320/375/393。当前全部为 **未验证**。

## 发布判定

本地候选已具备安全、类型、保护基线和 Chromium 合成证据；`pnpm validate` 通过。全量 Vitest 唯一失败是缺少真实 PostgreSQL 测试连接触发的环境门禁，迁移、真实 PostgreSQL、真实账号/资产、Firefox/WebKit 和云端 main 仍未验证。因此发布开关必须保持默认关闭；本文不授权启用或对外发布。
