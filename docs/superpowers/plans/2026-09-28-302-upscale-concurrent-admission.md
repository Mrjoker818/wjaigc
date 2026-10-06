# 302 放大双标签提交防重实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 已确认报价的 302 放大在两个标签同时首次确认时不产生第二笔活跃任务、扣费或供应商请求。

**Architecture:** 客户端用同源 Web Lock 串行检查及写入现有最小标记；服务端在现有原子计费事务里按服务端请求身份锁定并拒绝不同键的活跃重复请求。首任务终结后仍允许新报价主动重做。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Vitest、隔离 PostgreSQL。

**Spec:** `docs/superpowers/specs/2026-09-28-302-upscale-concurrent-admission-design.md`

**当前状态（2026-09-28）：** 本地候选已实现；当前源码编译的浏览器标记模块在真实 Chromium 同源双标签中 25 轮并发认领均只产生一个标记，刷新后的另一标签仍读取原键。又在当前 Next 画布和隔离 PostgreSQL 中用两个已登录同源标签各取得 7 积分报价、同时点击确认；浏览器拦截层只收到一条真实 UI 发出的付费 POST，另一个标签显示“另一标签已提交”，只保留一条未决标记。提交响应在浏览器本地桩返回 202，隔离库中云任务及积分流水均为零，未配置或联系真实供应商。独立复审、云端及完整保护门禁仍开放；不能合并或发布。首次尝试启动只读审查因代理席位已满而失败，未取得审查结论。

**复审接续（2026-09-28）：** 独立只读审查指出不同画布图片共用同一受权来源时，409 接续会覆盖第一张图片的原任务标记；原真库测试只覆盖首任务已提交后的第二请求；长幂等键的浏览器标记和只读恢复长度不一致。三项均先以失败行为验证，再最小修复：标记存储和清理按账号、项目、画布图片、来源版本、幂等键区分，读取兼容旧标记；恢复接口与计费准入均接受最长 256 字符。新真库用例在首事务提交前阻断两笔不同键请求，恢复锁后只一笔任务、-7 流水及供应商发送；临时把该锁替换为 `SELECT 1` 时同一测试因实际两次发送失败，随后立刻恢复锁。整份隔离 PostgreSQL 28/28、画布和标记单测 29/29、TypeScript exit0、限定 ESLint 0 error（画布 15 条既有 warning）；当前标记模块的真实 Chromium 双标签 25 轮及不同图片共用原任务键刷新保留通过。审查者只读复核认为上述问题已关闭，未独立运行测试。随后在最新代码启动的本地 Next 画布与专用隔离库中，两个同源已登录 Chromium 标签各选 `demo-1`、`302-esrgan`、取得 7 积分桩报价并同时确认；浏览器付费请求拦截仅收到 1 条 POST，保留 1 条未决标记，无真实供应商接触，库中 `cloud_tasks=0`、`wujie_credit_transactions=0`。这替换了标记修复前的旧 UI 证据，但只证明同浏览器画布交互，不代表云端付费成功。保护基线 38 项身份保留，当前脏树 9 条未授权源码漂移 BLOCK；云端真实付费、完整发布门禁仍开放，不合并或发布。

**清理边界：** 本轮专用隔离数据库 `wujie_302_race_20260928` 已确认零活动会话、零测试 schema 后删除，并复查不存在；测试媒体目录 `J:/无界本地版/projects/_tmp_e2e/302-race-20260928` 的路径已确认位于指定 `_tmp_e2e` 内，但本机命令策略拒绝递归删除，目录仍保留，不得声称已清理。所有供应商响应来自测试桩，未发真实付费请求。

## Global Constraints

- Pear 分层验证排除本目标；PSD 核心不变。
- 仅使用显式 loopback 测试库和隔离媒体根；不得操作业务数据库、真实供应商、真实积分或发布。
- 保留脏 `main` 的既有修改，不暂存、提交或推送未审查的整树内容。
- 查无原任务、浏览器锁不可用或请求回执不明时，不能换键重试。
- 浏览器只持久化既有非敏感标记，不存报价令牌、密钥或图片内容。

---

### Task 1: 服务端活跃请求准入

**Files:**
- Modify: `src/lib/cloud-task-storage.ts`
- Modify: `src/lib/task-core/billing-service.ts`
- Modify: `src/app/api/image-edit/route.ts`
- Test: `tests/integration/image-edit-302-identity-postgres.test.ts`

**Interfaces:**
- `CreateBillableTaskInput` 与 `CreateBillableCloudTaskInput` 新增可选 `activeImageEditInputDigest?: string`，仅原生 302 入口传入已计算的 `inputIdentityDigest`。
- 新建 `ActiveImageEditAttemptError`，携 `code='IMAGE_EDIT_ACTIVE_ATTEMPT'`、`status=409`、本人原任务 ID、原幂等键和状态；路由以最小 JSON 响应，不做异常退款。

- [x] **Step 1: 写真实失败测试。** 在第一笔不同键 302 请求进入受控 `fetch` 后保持 gate 不释放，同时发相同 actor/请求体的第二笔新键 POST；断言 409 `IMAGE_EDIT_ACTIVE_ATTEMPT`，只一条 `cloud_tasks`、一条 -7 消费、一次供应商发送，响应只含本人任务身份且无媒体/令牌。再断言首笔终态后新键能够成功。
- [x] **Step 2: 跑 RED。** 使用 `POSTGRES_TEST_DATABASE_URL`、`PGDATABASE_URL`、`DATABASE_URL`、`TEST_POSTGRES_URL` 指向同一显式 loopback 测试库，`WUJIE_DATA_DIR` 指向隔离媒体根；原实现实际产生两条任务，本断言预期 1、实得 2。
- [x] **Step 3: 最小实现。** 同键现有 `FOR UPDATE` 重放逻辑保持优先；不同键时在计费事务中按服务端 actor＋digest 加锁，并只对已确认报价的原生 302 活跃任务拒绝不同键；路由返回 409，不建任务/扣费。
- [x] **Step 4: 跑 GREEN 和回归。** 真库整文件新鲜 27/27；已终态新键、同键重放，以及不同 actor、不同项目/请求体在首任务活跃时独立提交的控制组通过。控制组还发现无项目模式把 `undefined` 传进提供商阶段导致 502；已统一为空项目身份并由该真库用例覆盖。

### Task 2: 浏览器双标签锁与原任务接续

**Files:**
- Modify: `src/lib/canvas-upscale-submission-marker.ts`
- Modify: `src/components/infinite-canvas.tsx`
- Test: `src/__tests__/lib/canvas-upscale-submission-marker.test.ts`
- Test: `src/__tests__/components/canvas-document-upscale-entry.test.tsx`

**Interfaces:**
- `claimUpscaleSubmissionMarker(locks: LockManager | undefined, storage: Storage, marker: UpscaleSubmissionMarker): Promise<{claimed:true}|{claimed:false;existing:UpscaleSubmissionMarker}>`：按 actor/项目/源图/源版本取独占锁、锁内重读同源标记，只有无标记时写入并返回 claimed；无锁/存储故障抛错，且不能 POST。
- 409 `IMAGE_EDIT_ACTIVE_ATTEMPT` 的原任务身份仅用于替换本地未受理标记和精确只读核对。

- [x] **Step 1: 写失败测试。** 纯标记双 claim、组件无 Web Lock 不得发付费 POST，以及服务端冲突后采用原任务键均先建立行为测试。单线程 jsdom 两画布同点测试在旧代码也通过，无法证明真实双标签交错，已移除，不计证据。
- [x] **Step 2: 跑 RED。** 纯 claim 因不存在失败；组件无锁时实发第二个付费 POST；冲突时原任务键没有保存。
- [x] **Step 3: 最小实现。** 浏览器锁内读/写最小标记；无锁和存储失败不发送付费 POST。服务端已确认活跃冲突返回的本人原任务身份通过浏览器标记接续，模糊响应仍待核对。
- [x] **Step 4: 跑 GREEN 和回归。** 画布/标记两文件新鲜 27/27，刷新、不同 actor、同 ID 新版本、报价失效、存储异常等既有用例通过；真实双标签浏览器仍是独立门禁。

### Task 3: 交叉验证与范围记录

**Files:**
- Modify: `docs/superpowers/plans/2026-09-28-image-edit-source-and-quote-integration.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`（仅当已有 302 项需补本候选边界）

**Interfaces:** 无新运行时接口。

- [x] **Step 1: 验证。** 真库整文件最新 27/27、画布/标记前轮 27/27、非增量 TypeScript 最新 exit0、此次改动目标 ESLint 0 error／1 条既有 warning、`git diff --check` exit0；未将模拟控制组视为真实双标签浏览器门禁。
- [x] **Step 2: 记录本地证据与未通过门禁。** 标记模块的真实 Chromium 双标签 25 轮、刷新认领证据：`esbuild` 编译 `src/lib/canvas-upscale-submission-marker.ts` 为 `output/playwright/302-double-tab/marker.js`，在仅绑定 `127.0.0.1:5017` 的静态页上用 `playwright-cli run-code --filename tests/browser/302-upscale-marker-dual-tab.cjs` 运行，每轮一认领/一原键恢复。实际画布 UI 再用独立本机库 `wujie_302_ui_browser_20260928` 和本地管理员进入同一示例项目，两标签均选择 `demo-1`、`302-esrgan`、获得 7 积分桩报价；`playwright-cli run-code --filename tests/browser/302-upscale-ui-dual-tab.cjs` 使两个确认同时发生，浏览器拦截层仅 1 个付费 POST，第一标签收到本地 202、第二标签提示另一标签已提交；PostgreSQL `cloud_tasks=0`、`wujie_credit_transactions=0`。首次 dev 编译热刷新使第一标签报价消失，重新准备后复跑才得到上述通过结果，不能把首次超时当成功。验证后已关闭浏览器与本地应用、删除本轮专用测试库及空媒体目录；可复跑脚本保留。跨设备首笔极速完成、真实 Cookie/桌面令牌、完整保护门禁、云端付费供应商和正式发布均未验证。
