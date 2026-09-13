# V588-MEDIA-001 Task 8 实施报告

## 当前结论

- 状态：`DONE`
- 基线：`main@a790f9530b2959621e345a2ac02b8f11abf198d9`
- RED 提交：`21e21c7962b9cf8f65be4ad2f9860471527c94fb`
- GREEN 提交：`d387736d8fc7c688c74af23974bf8a6f7e6c642a`
- 评审补强提交：`3e91e8feda215d2a6a6a89b50a2188b68e6d294c`
- 生产修改仅限 `src/lib/media-gateway/schema.ts`。
- 未新增任务、账务、退款、资产或缩略图状态机；`stable` 与 donor 未触碰。

## 根因与最小修复

Task 8 安全回归发现图像和视频请求规范化会静默忽略未声明顶层字段。外部路由虽已拒绝已知 Secret 与内部控制字段，但任意 `metadata`、`constructor` 等字段仍会被无声丢弃，不能满足失败关闭的请求边界。

最小修复是在既有图像和视频规范化入口增加精确字段白名单。保留既有内部兼容测试要求的 `apiKey` 与 `sourceChannel` 规范化占位；外部 HTTP 路由仍在规范化前拒绝这两个字段。除此之外的未声明字段统一返回 `GATEWAY_INVALID_REQUEST / 400`。

## TDD 证据

### RED

真实 PostgreSQL 命令：

```powershell
$env:PGDATABASE_URL='postgresql://postgres@127.0.0.1:55438/postgres'
$env:POSTGRES_TEST_DATABASE_URL=$env:PGDATABASE_URL
pnpm exec vitest run tests/integration/media-gateway-admission-postgres.test.ts tests/integration/media-gateway-lifecycle-postgres.test.ts src/__tests__/api/media-gateway-security.test.ts --reporter=verbose
```

结果：`2 failed / 14 passed / 0 skipped`。仅图像、视频“拒绝未声明字段”两项按预期失败；PostgreSQL 生命周期和 Task 7 非 UTC 用例已执行。

### GREEN

首轮同一命令结果：`3 files passed / 20 tests passed / 0 failed / 0 skipped`。

独立评审要求补强并发工作单元、全状态完成门禁、结构合法未知 Key、HTTP 数据库故障响应和非空泄漏扫描后，最终同一命令结果：`3 files passed / 24 tests passed / 0 failed / 0 skipped`。最长用例约 1.2 秒，无锁等待或无限等待。

### 扩大媒体网关回归

覆盖 `src/__tests__/api/media-gateway-*`、`src/__tests__/lib/media-gateway-*`、组件和 `tests/integration/media-gateway-*`：

- `16 files passed`
- `302 tests passed`
- `0 failed`
- `0 skipped`

### 既有账务与终态回归

```powershell
pnpm exec vitest run tests/integration/task-billing-concurrency.test.ts tests/integration/task-terminal-race.test.ts src/__tests__/api/cancel-task.test.ts --reporter=verbose
```

结果：`3 files passed / 25 tests passed / 0 failed / 0 skipped`。

## PostgreSQL 证据

- 版本：PostgreSQL `18.4`，Windows x86-64。
- 端口：`55438`，仅监听 `127.0.0.1`。
- 运行身份：`Y-20211224EIUNK\wujie_pg_task8`。
- 该账户是本轮创建的一次性本地标准用户，不属于 Administrators。
- 数据目录：`C:\Users\Public\wujie-task8-pg-20260914`。
- 所有集成测试均通过 `withIsolatedPostgres` 创建随机 schema，并在每个测试结束时删除。
- 清理前查询确认随机测试 schema 数量为 `0`。
- `pg_ctl stop -m fast` 由同一标准账户执行，退出码 `0`。
- 清理后：`PORT_LISTENING=False`、`TEMP_USER_EXISTS=False`、`TEMP_PROFILE_EXISTS=False`、`REMAINING_PATHS=0`。

## 必证边界结果

1. 20 个并发工作单元各自执行 RPM 准入与幂等保留；胜者继续创建权威任务、扣费并标记 admitted。结果为 `1 execute + 19 reuse`，数据库只有 1 条 gateway request、1 条 cloud task、1 条 consume 流水；20 次 admitted 重放均返回同一 taskId。
2. 同键异摘要返回 409；不同用户可独立使用相同幂等键；20 路 RPM 和 UTC 日配额均未超卖。
3. 独立矩阵证明 completed 只可从 processing 成功；created/queued/submitting/uploading/completed/failed/cancelled/timeout 全部拒绝。`failed/timeout/cancelled` 三方竞争只有一个终态；迟到 completed 返回 false。
4. 失败终态只产生 1 条 refund；20 次重复取消不再转换、不再退款；余额与累计使用恢复一致。
5. 缺失/畸形、结构合法但未知、吊销 Key、413、非法 JSON、恶意额外字段、跨用户 taskId、伪造 trusted headers 与数据库断开均失败关闭；数据库断开经真实 GET 路由返回稳定 `503/GATEWAY_INTERNAL_UNAVAILABLE/retryable=true`，响应不含连接错误或 Secret。
6. 持久化只保存密钥 hash/prefix 与规范摘要；测试将非空 Secret、Bearer、提示词和参考图输入纳入真实 digest/准入/权威任务链，再对 keys、requests、cloud_tasks、credit ledger 全表联合扫描，均未发现原值。Authorization、Access Token、密码与任意额外字段在持久化前拒绝。
7. Task 7 `Asia/Shanghai` 会话与 UTC 日界线交叉用例在真实 PostgreSQL 执行通过。

## 静态门禁

- `pnpm ts-check`：通过。
- Task 8 指定 ESLint：通过，0 error。
- `git diff --check a790f953..HEAD`：通过。

## 关注点

1. 本任务证明本地真实 PostgreSQL 并发与安全边界，不包含第三方供应商付费调用或 Coze 云端 rollout；这些属于 Task 9。
2. 扩大回归会输出受控的数据库失败日志和既有生成调试日志；日志内容不包含本轮 Secret、Authorization、Access Token、密码、提示词或参考图内容。
3. 首轮独立复审为 `REJECTED / 0 Critical / 6 Important / 0 Minor`；六项均已通过 `3e91e8fe` 的测试补强和上述清理证据处理。

## 独立复审

- 模型：`gpt-5.6-sol`
- 推理强度：`medium`
- 评审范围：`a790f953..3e91e8fe`
- 最终结论：`APPROVED`
- Critical / Important / Minor：`0 / 0 / 0`
- 评审确认 20 路并发覆盖准入、权威建任务、扣费和 admitted；全状态完成门禁、合法未知 Key、真实 HTTP 数据库故障响应、非空泄漏扫描、TDD 提交溯源和临时 PostgreSQL 清理证据均已关闭。
