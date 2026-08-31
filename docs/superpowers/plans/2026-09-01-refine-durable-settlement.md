# 精修任务持久化与结算接入实施计划（方案A）

> 执行要求：使用 executing-plans，逐项测试驱动。用户已于2026-09-01批准方案A，不再重复请求同范围批准。

**目标：** 修复 V588-TOOLS-BUG-002，使精修任务先持久化并原子扣费，再调用供应商；同步、异步结果均通过权威终态交付。

**架构：** 复用 createBillableTask、recordImageTaskTerminal、terminateCloudTaskAndRefund。增加精修专用生命周期辅助模块；轮询和取消仅增加精修类型分支，不改变其他任务行为或全局状态机。

**技术栈：** Next.js、TypeScript、Vitest、现有 PostgreSQL 事务服务。

## 全局约束

- 基线 main@3daa1043968cd0d7144699b67b7c797656c7d525；stable及V5.8.8参考目录不改。
- 不修改登录、账号、密码、供应商配置、数据库结构、UI或其他工具。
- 保留预检前置、原始模型计价、所选供应商、同步/异步响应字段及终态保护。
- 不持久化供应商密钥，不重发已存在的远端任务，不自动补偿历史12积分。
- 云端仅使用原Google Chrome标签、当前隔离Coze项目，重启沙箱后强刷预览。

## 任务1：失败测试与契约

- [x] 原POST→原poll稳定复现：6项3通过3失败，证据保留。
- [x] 扩展 `src/__tests__/api/refine-async-terminal-contract.test.ts`：原子创建失败不调用供应商；远端ID入库；同步完成；异步失败及取消一次退款；迟到结果不改终态；重复轮询不重复扣费；重启后只轮询原远端ID。
- [x] 更新 `src/__tests__/api/tool-image-preflight-billing.test.ts` 的精修计费断言以对应任务级事务，不删除品牌/字境和原先错误补偿检查。
- [x] 执行 `pnpm exec vitest run src/__tests__/api/refine-async-terminal-contract.test.ts src/__tests__/api/tool-image-preflight-billing.test.ts`，保存新增RED。

## 任务2：最小业务实现

- [x] 新建 `src/lib/refine-task-lifecycle.ts`，提供精修创建、远端关联、完成和失败结算辅助函数。
- [x] `src/app/api/refine-engine/route.ts`：预检后按原模型调用 `calculateConfiguredCreditCost('image_retouch', model, { providerId })`，再调用现有 `createBillableTask`；失败不提交供应商。
- [x] 同步结果取消内存提前completed写入，先 `recordImageTaskTerminal`，只有数据库completed才返回成品。
- [x] 异步结果先持久化remoteTaskId；持久化暂不可用时保留任务、明确可重试，不创建第二个供应商任务。
- [x] `src/app/api/poll-task/route.ts`：精修失败/取消接入原子结算，重启但尚无远端编号时不误将本地编号发给供应商。
- [x] `src/app/api/cancel-task/route.ts`：仅把精修纳入现有原子取消类型。
- [x] 运行任务1专项至全绿，保留原终态竞争反例；独立审查后的消费者契约追加至53项通过。

## 任务3：数据库与全量门禁

- [x] 隔离PostgreSQL测试精修扣费、远端关联、完成与取消竞争、重复失败退款；不连接生产数据库。精修及11项既有并发用例共12项通过。
- [x] 执行 `pnpm ts-check`、`pnpm lint`、`pnpm test`、保护清单检查、`pnpm build`；最终4569项全部通过、0跳过，38类保护、118页构建通过，Lint 956历史警告。
- [x] 审查diff只包含批准范围，无密钥、无本地凭据与原始浏览器日志。

## 任务4：交付和云端

- [x] 更新缺陷登记、回归、发布准备、未验证清单及Obsidian两处唯一检查点。
- [x] 只提交并推送main；代码提交bf2b8ec529112e7df29219600cbe5d7dedaad5bb已远端复读，stable保持52f7c601不变。
- [ ] 原Chrome内读取既有Coze诊断，再发送一次同步指令；重启后强刷原预览。
- [ ] 使用APImart精修验证任务、结果、积分和刷新恢复；浏览器无法接管则准确保留云端未验证，不声称修复闭环。
