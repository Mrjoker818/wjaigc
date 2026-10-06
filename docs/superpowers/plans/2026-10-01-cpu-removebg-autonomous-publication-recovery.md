# CPU 去背景画布发布无流量恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 已完成的文档 CPU 去背景任务即使无人轮询，也能恢复主体图和蒙版的画布发布。

**Architecture:** 独立、限量的 Node 定时扫描器只选择带持久画布意图的已完成 `local-rembg` 任务。逐任务会话锁保护并发，锁内复用现有发布函数；任务与账本状态不由扫描器直接修改。

**Tech Stack:** Next.js 16、TypeScript、PostgreSQL 18、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-01-cpu-removebg-autonomous-publication-recovery-design.md`

## Global Constraints

- 仅修改当前 `main`，保留用户工作树，`stable` 只读。
- 仅测试隔离 PostgreSQL；不连接业务库、不触发真实供应商或付费、不推送 Coze。
- Pear 分层不属于此目标；PSD 核心不变。
- 保护基线阻断未解决前，不能发布。

---

### Task 1: 可重试候选与并发安全扫描

**Files:** 新建 `src/lib/collaboration/cpu-removebg-publication-worker.ts`；测试 `tests/integration/image-edit-document-source-postgres.test.ts` 和 `src/__tests__/lib/cpu-removebg-publication-worker.test.ts`。

**Interfaces:** 导出 `drainPendingCpuRemoveBgPublications({ limit?, now? }): Promise<{ selected: number; attempted: number }>`；内部调用 `projectCanvasTaskResult` 和失败审计 `recordTaskProjectionPending`，不得走普通投影 fallback、图像模型、收费或退款接口。

- [x] 写真库 RED：用既有去背景发布失败 fixture 形成 `completed/projection_pending`；恢复媒体后不调用任何路由，单次 `drainPendingCpuRemoveBgPublications` 应创建主体／蒙版两个版本且仍只有原消费流水。
- [x] 跑该用例，确认失败是无自主恢复能力，不是 fixture、数据库连接或媒体路径故障。
- [x] 实现限量选择 SQL：精确 `local-rembg`／文档准入／持久发布意图／未完成投影；用 `lastAttemptAt` 一分钟退避，默认 limit 10、最大 50。
- [x] 对候选逐一获取 `getAdvisoryLockPool()` 连接及 `pg_try_advisory_lock`；锁内重新核任务，调用 `projectCanvasTaskResult`，失败写 `recordTaskProjectionPending`；`finally` 解锁，异常丢弃连接。
- [x] 跑真库 GREEN；补两扫描并发及非法／无意图任务控制组，核无重复版本或多次扣费。

### Task 2: 启动、单例与故障隔离

**Files:** 修改 `src/instrumentation.ts`；新建 worker 单元测试；更新 `src/__tests__/lib/instrumentation-cleanup-worker.test.ts` 的启动 mock。

**Interfaces:** `startCpuRemoveBgPublicationWorker({ drain?, intervalMs? }): { stop(): void }`，全局 Symbol 单例，启动立即 drain，默认间隔 60 秒，重复 tick 不重入。

- [x] 写 RED：Node 非构建阶段启动一次，Edge 和生产构建不启动；重入 tick 不会并行扫描，失败后下一 tick 可继续。
- [x] 跑 RED，确认是缺少 worker/启动接线。
- [x] 实现单例定时器并在 Node instrumentation 中动态导入启动；定时器 `unref`，扫描异常只记固定错误码。
- [x] 跑单元与真库 GREEN，验证停止后无新扫描。

### Task 3: 门禁与进度记录

**Files:** 更新主计划顶部与 `J:\无界本地版\projects\_obsidian_wujie\11-阶段进度看板.md`。

- [x] 跑相关 Vitest、`pnpm ts-check`、目标 ESLint、`pnpm build`、`git diff --check` 和保护基线，逐项记录原始退出码与范围。
- [x] 精确清理本轮新建测试库并停止临时 PostgreSQL；媒体根按既有策略保留，不绕过清理边界。
- [x] 写清本地通过与正确预览／云端多实例未验证的边界；十动作、三工作区及发布门禁保持开放。

## 执行证据（2026-10-01）

真 PostgreSQL 先 RED（缺后台入口），再补锁内退避 RED（旧候选仍尝试）和批次饥饿 RED（新任务无法获得名额），各自转 GREEN。最终隔离库来源整份 **88/88**；目标 worker／instrumentation 单元 **8/8**、加相邻恢复 API 合计 **10/10**；TypeScript exit0、目标 ESLint 0 error／0 warning；`pnpm build` exit0、121/121 静态页、构建标记匹配 BUILD_ID，但仍有 **41 条 Turbopack 警告及广泛 NFT 路径追踪警告**。独立只读复审指出的批次饥饿与“轮询补投影混淆”已用源码和真库修正；最终真库还以外部数据库锁同步两轮扫描、撤销意图后零资产／未完成投影、恢复意图后两项发布。最终限定只读复审未再发现本纵切的 Critical／Important，但复审者**未亲跑真库测试**，不把此结论扩为整体交付批准。

保护基线 38 项身份保留，但新增 worker 使未许可源码路径从 13 增为 **14 BLOCK**，未扩白名单，明确不具备发布许可。本轮跟踪文件 diff-check exit0；全树仍仅有三份既有 SDD 文档尾空行导致 exit1，本轮未改它们。专用库 `wujie_bridge_test_removebg_autorecover_20261001` 清理前 `test_%` schema／public 表／其他连接均 0，精确删除后复核不存在；55493 临时集群停止。媒体根 466 项、无重解析点，依既有策略保留。此纵切**只解决已完成文档 CPU 去背景任务的无请求发布投影**：处理中任务无流量超时／退款、其他动作、完整十动作／三工作区、云端多实例、正确预览页／真实供应商／付费／业务库和全站门禁仍未验证；未提交、推送、部署或同步 Coze。Pear 排除，PSD 核心保留。
