# 历史退款唯一占位实施计划

> 2026-09-28 独立复审后的本地候选：复审指出四项可修问题（退款入口可能早于迁移、混合历史误对账、就绪检查可被伪触发器冒充、查询无索引），均已按定向 RED→GREEN 修正；旧版本实例并行处理退款可能在账本冲突后单独增加余额，**尚未可由新版代码修复，必须在发布时停写／排空旧实例**。最新真库迁移 **9/9**、跨通用/云端结算 **18/18**，相关单元 **140/140**，`pnpm ts-check` exit0，目标 ESLint 0 error／5 条既有 warning，目标跟踪文件 `git diff --check` exit0。`pnpm check:protected-baseline` 仍 **BLOCK 10 个未审定路径**，未扩许可。专用库 `wujie_bridge_test_refund_review_20260928` 清理前 test schema/public 表/其他连接均为 0，已删除并复核不存在。未做正式库历史审计、迁移锁时长、全量回归或云端验证；不提交、不推送、不部署、不连接业务库。以下较早 7/7、79/79 的记录是当时快照，不代表现状。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留全部旧退款流水，在旧重复任务引用存在时仍可初始化，并对所有新退款写入者维持数据库级同身份至多一次。

**Architecture:** 同一 PostgreSQL 事务锁定退款账本、回填唯一身份占位表、安装插入/身份变更触发器；历史旧索引存在则保留，不再对含重复历史的数据强建全历史唯一索引。现有普通退款和云任务退款继续以账本唯一行对账，冲突时不修改余额。

**Tech Stack:** Next.js 16、TypeScript 5、`pg`、PostgreSQL 18、本地 Vitest。

**Spec:** `docs/superpowers/specs/2026-09-28-refund-history-unique-claim-design.md`

> 2026-09-28 早期快照：Task 1/2 的定向 RED→GREEN 已执行。真库历史/并发/复启 **7/7**、桥接账务 **18/18**；受迁移桩影响的四份单元文件 **59/59**，另三份云任务/计价/终态文件 **79/79**。并发退款触发器插入的受控变异让定向测试失败，恢复后再通过。原专用库 `wujie_bridge_test_refund_claim_20260928` 已清理。本条保留历史证据；以文件顶部最新门禁为准。

## Global Constraints

- 只在 `main` 当前脏工作树原位接续，保留用户现有改动；`stable` 只读。
- 仅使用新建 `127.0.0.1`、`wujie_bridge_test_` 前缀的专用测试库；四个测试数据库环境变量必须一致；不查询或修改业务库。
- 不删除、合并或改写任何旧退款流水、积分余额或已存在的唯一索引。
- 无历史任务身份的匿名退款无法由任务身份屏障覆盖，不得把本方案称为全平台账务通过。
- RED→GREEN、真库并发、TypeScript、限定 ESLint、相关回归和保护基线的实际输出必须分别记录；保护基线未通过时不得推送、Coze 同步或部署。
- 当前工作树未获合并与发布许可；不自动提交这些混合中的用户改动。

---

## 文件职责

- `src/lib/refund-identity-claim.ts`：仅负责原子建表、历史回填、触发器安装。
- `src/lib/db-storage.ts`：在账本基础列迁移后调用上面的数据库屏障，不再强建与历史冲突的全历史索引。
- `src/lib/credits.ts`：已有退款只有恰好一条、同用户同金额时才算幂等成功。
- `src/lib/cloud-task-storage.ts`：终态结算识别占位主键冲突并重新读账本对账。
- `tests/integration/refund-index-legacy-history-postgres.test.ts`：真实 PostgreSQL 历史兼容、直接写入和并发行为。
- `tests/integration/image-upscale-bridge-billing-postgres.test.ts`：现有普通/云任务跨写入者账务回归。

### Task 1: 历史回填与数据库唯一屏障

**Files:**
- Create: `src/lib/refund-identity-claim.ts`
- Modify: `src/lib/db-storage.ts:370-389`
- Modify: `tests/integration/refund-index-legacy-history-postgres.test.ts`

**Interfaces:**
- Produces: `ensureRefundIdentityClaims(): Promise<void>`，供 `initializeCoreTables()` 在旧账本列补齐后调用。
- SQL 行为：`wujie_refund_identity_claims(identity TEXT PRIMARY KEY)`；冲突约束名由 PostgreSQL 给出 `wujie_refund_identity_claims_pkey`。

- [x] **Step 1: 改写旧历史行为测试为期望可启动，保持旧两行不变；追加第三笔同身份拒绝和新身份成功。**

  测试用原 `legacy_refund_a/b` 两行，`await ensureCoreTables()` 应 resolve；随后 `INSERT ... reference_id='same_task'` 应拒绝 `{code:'23505',constraint:'wujie_refund_identity_claims_pkey'}`；`reference_id='new_task'` 应成功。查询旧两行的金额和余额快照必须逐字相同，查询占位表应只有 `same_task`、`new_task` 两个身份。另设两条 `ctx_refund_%` 旧行、相同 `task_id` 的控制组，证明旧复合索引也不再挡启动。

- [x] **Step 2: 在新专用测试库运行单文件，确认 RED 原因是旧全历史索引在已有重复行上抛 `23505`。**

  `pnpm exec vitest run tests/integration/refund-index-legacy-history-postgres.test.ts`

- [x] **Step 3: 实现原子迁移。**

  `ensureRefundIdentityClaims()` 使用 `getPool().connect()`、`BEGIN`、`LOCK TABLE wujie_credit_transactions IN SHARE ROW EXCLUSIVE MODE`；`CREATE TABLE IF NOT EXISTS` 后执行 `INSERT ... SELECT DISTINCT COALESCE(NULLIF(task_id,''),NULLIF(reference_id,'')) ... WHERE type='refund' ... ON CONFLICT DO NOTHING`；安装 `CREATE OR REPLACE FUNCTION` 的 PL/pgSQL 触发器函数和仅缺失时 `CREATE TRIGGER`；`COMMIT`，失败 `ROLLBACK`，最后 `release()`。函数对 `INSERT` 和有效身份改变的 `UPDATE` 插入占位，身份未变时不再次插入。`db-storage.ts` 在现有列迁移后调用它，删去会因旧重复失败的 `idx_credit_refund_task_once_all` 新建语句；把原 `idx_credit_tx_task_type_once` 新建替换成只针对 `ctx_charge_%` 的新消费唯一索引；不 `DROP INDEX`，已存在的两个旧索引自然保留。

- [x] **Step 4: 运行单文件至 GREEN；以两独立连接同时插同新身份，断言恰一成功且旧行不变。再验证 UPDATE 改为占用身份拒绝，匿名退款仍按旧行为。**

  并发测试必须检查真实账本行数和占位表身份数，不能只断言 Promise 返回；失败 SQL 的 code/constraint 必须指向占位主键。每例随机 schema 自动清理。

- [x] **Step 5: 首次安装后的复启只读检查。**

  真库先在另一连接持有 `ROW EXCLUSIVE` 账本锁，调用 `ensureRefundIdentityClaims()` 仍应在 1.2 秒内返回；初轮 RED 为等待锁，修正后只读核对占位表、主键和启用的触发器，已完整安装则不再进入回填事务。另以新库保留 `ctx_charge_%` 同任务一次消费唯一性。

### Task 2: 对账而不是误报成功

**Files:**
- Modify: `src/lib/credits.ts:519-539`
- Modify: `src/lib/cloud-task-storage.ts:1404-1412`
- Modify: `tests/integration/refund-index-legacy-history-postgres.test.ts`
- Test: `tests/integration/image-upscale-bridge-billing-postgres.test.ts`

**Interfaces:**
- Consumes: 占位主键错误 `wujie_refund_identity_claims_pkey`，以及原有 `findExistingTaskRefund`/`reconcileCloudTaskRefund` 查询。
- Produces: 普通退款/云任务退款只把恰好一笔匹配原任务、账号、金额的历史流水视为已退款；多笔旧冲突返回失败或保持待审，不更新余额。

- [x] **Step 1: 加真库 RED 用例。**

  在旧历史 `same_task` 两行下调用 `refundCredits('legacy_user',8,...,'same_task')`，断言不得 `{success:true}`、余额不得变化；构造云任务已扣费却有两条旧退款的场景，终态结算不得新增第三笔，也不得把 pending 错记为已安全退款。另用一条旧退款的控制组证明仍可正确对账。

- [x] **Step 2: 运行定向测试，确认 RED 是重复历史被当作单次成功或第三笔退款。**

- [x] **Step 3: 最小修正。**

  `findExistingTaskRefund` 在 `rows.length !== 1` 时返回 `{success:false,balance:0}`；云终态结算把 `wujie_refund_identity_claims_pkey` 纳入仅可重读对账的约束名单。若重读发现历史歧义，停止新退款，不覆盖任务为已退款状态；必要时新增明确错误结果供上层审计，禁止吞错视作成功。

- [x] **Step 4: 定向测试 GREEN，复跑 `image-upscale-bridge-billing-postgres.test.ts` 全文件和现有云任务退款真库套件。**

### Task 3: 门禁与边界审计

**Files:**
- Modify: `docs/superpowers/plans/2026-09-28-image-edit-source-and-quote-integration.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`（仅当其当前总览确需更新）

**Interfaces:** 无产品接口变化；输出精确的已验证/未验证边界。

- [x] **Step 1: 新鲜运行 `pnpm ts-check`、目标 ESLint、相关 Vitest、`git diff --check` 与 `pnpm check:protected-baseline`，记录完整退出码和失败项。**
- [x] **Step 2: 只清理本任务新建、已核实无其他会话/测试 schema/public 表的专用测试库，并复核不存在；不清理旧库或业务媒体。**
- [x] **Step 3: 将旧数据不变、并发一次、剩余匿名退款和产品发布门禁写入现有计划顶部。保护基线仍 BLOCK 时保持全局目标 active。**
