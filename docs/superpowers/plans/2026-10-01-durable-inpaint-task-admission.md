# 擦除／蒙版持久任务原子准入实施计划

## 2026-10-02 接续：文档来源终态栅栏（本地候选，未获发布批准）

私有来源快照缺失补证：在文档蒙版供应商直返已接受、结果下载时清空来源快照六字段，真实路由与随后的 `/api/poll-task` 都不交付图片，原任务维持 `processing/pending`，仅原消费一笔、零错误退款、供应商 POST 一次。新增定向 1/1，来源整份 **127/127**、TypeScript 和目标 ESLint quiet 通过。此为安全待核对，不是自动恢复完成：快照已损坏时任务可能长期挂起，仍需定义可信修复或人工对账；不能从客户端 URL 重建受权来源，也不能盲退款。下一个主线接缝应转向现有工作流编辑意图接 `/api/edit`／`/api/image-edit` 并将完成结果收养为项目资产版本，不能用任务公开 URL 冒充跨工作区发布。

租约换主补证：隔离真 PostgreSQL 在已接受的文档蒙版直返结果下载期间使旧租约到期，由另一工作器抢租。旧工作器返回 202 且不交付图片，任务保持 `processing/pending`；新租约未到期时轮询不能抢跑，到期后只读取原接受检查点完成，供应商 POST 与消费各一次、零退款。新增定向 1/1，来源整份 **126/126**、TypeScript、目标 ESLint quiet 通过。此为同进程受控换主，不等于真实进程被杀或多实例部署；后两项仍开放。

同日补证：普通文档蒙版的最终 COMMIT 回执在 PostgreSQL 提交**前**或提交**后**丢失，各用隔离真库与真实路由注入一次故障。提交前保持原任务 `processing/pending`，接口 202 待核对；随后 `/api/poll-task` 只恢复同一已接受结果，最终 `completed/charged`，供应商 POST 仍一次。提交后读回持久终态，接口 200 且 `completed/charged`。两种情况均只有一笔消费、零错误退款；定向 2/2，来源整份 **125/125**、TypeScript 与测试 ESLint quiet 通过。此处只证明受控 COMMIT 回执丢失，不等于进程被杀、真实网络故障或租约接手，后者仍开放。

隔离真 PostgreSQL 先证明远端已接受后撤销编辑权、删除来源放置或禁用文档项目仍交付图片；现将 owner／授权代次／版本／精确放置／规范 URL 与 origin 随收费事务冻结到私有输入，直返与轮询完成共用任务锁和来源 SHARE 锁内的终态提交。明确撤权后同一任务 failed/refunded，不把未知提交当作确定失败。完成任务的轮询、任务恢复列表和同键重放也核对原授权代次，撤销再重授不能读出旧结果。工作流实际传 `assetSourcePlacementId`，旧路由忽略该字段；新增“双放置、指定第二个后删除第二个”的真库 RED（原错误交付公开图片）后接入精确放置并纳入请求摘要，定向文档蒙版 7/7 GREEN。

本轮来源整份真库 **123/123**、相邻图像编辑真库 **85/85**、相关单测 **10/10**、`pnpm ts-check`、目标 ESLint quiet、目标 diff check exit0。`pnpm build` exit0、121/121 页面，但有 42 条 Turbopack 宽追踪警告；严格 NFT exit1（235 路由／84 宽），保护基线 exit1（21 个未批准源码路径）。这些测试只替代外部供应商网络，使用隔离本机数据库；未知 COMMIT、租约接手、真实崩溃及整个十动作／工作流受管发布、全站 Vitest、正确预览、真实付费仍未验。本轮不提交、推送、同步 Coze 或部署；Pear 不在目标，PSD 核心保留。

**Spec：** `docs/superpowers/specs/2026-10-01-workflow-image-edit-contract-design.md` 顶部同日小节。此任务仍只在本地 `main` 工作；发布门禁未关闭前不做模板中的逐任务 commit、推送或 Coze 同步。

### Task 5.1：把撤权后的迟到成功固定为 RED

**文件：** `tests/integration/image-edit-document-source-postgres.test.ts`。测试仍用专用隔离 PostgreSQL、真实 `/api/image-edit` 与 `/api/poll-task`，只替代外部供应商网络。供应商收到首次编辑 POST 后更新 `wujie_project_document_editors.status='revoked'`，然后返回直返图片或远端任务；断言本地任务不得进入 `completed/charged`，不得向客户端交付图片。同样以 `wujie_workspace_placements` 精确删除和文档开关关闭做交错。先单独运行新用例，预期因旧 `completeCloudTask` 无来源复核而 RED；区分业务断言失败与夹具/网络失败。

### Task 5.2：收费事务冻结完整来源

**文件：** `migrations/20261001_wj_image_edit_private_inputs.sql`、`src/lib/task-core/inpaint-private-inputs.ts`、`src/lib/collaboration/image-edit-source-admission.ts`、`src/app/api/image-edit/route.ts`、相邻真库测试。在 `beforeCharge` 中用现有锁定来源验证选定投影中活跃的具体 placement，写入私有输入行的 owner、grant generation、version、placement、canonical URL、origin；在任务标记中记录服务端文档来源布尔身份。个人项目列为 NULL。新辅助读取必须匹配 taskId、actor、project、requestDigest 与文档标记；文档快照缺失/畸形不能静默回退到个人路径。先加入持久化/错身份的失败测试，观察 RED，再最小实现并跑相邻测试。

### Task 5.3：同步与轮询共用终态重授权

**文件：** `src/lib/collaboration/image-edit-source-admission.ts`、`src/lib/task-core/inpaint-task.ts`、`src/app/api/image-edit/route.ts`、`src/app/api/poll-task/route.ts`、`tests/integration/image-edit-document-source-postgres.test.ts`。给锁定来源校验增加可选的精确 placement ID；终态函数先 `SELECT cloud_tasks ... FOR UPDATE`，再从私有行读取冻结快照，按原 grant generation 与该 placement 锁住授权/版本/投影，最后在同一事务中调用带租约 fence 的 `completeCloudTask`。明确 403 撤权时由原任务一次原子 failed/refunded；COMMIT 回执未知时查原任务状态，不盲退款。先分别验证同步直返和异步轮询 RED→GREEN，再验证正常完成、双次取消/重复轮询、租约接手与未知 COMMIT；最后跑来源整份真库、相邻图像编辑、TypeScript、目标 ESLint、构建、严格 NFT、保护基线，按各自 exit 如实记录。

**状态：本地纵切候选，尚未集成/发布批准。** 擦除发送前原子准入、同键复用、异步失败一次退款及蒙版直返／异步受管结果已经接入真实路由并在隔离真库定向验证；视觉回退、未知回执、取消／撤权、崩溃恢复和全平台门禁仍开放。不能将局部 GREEN 外推为完整图像编辑或三工作区验收。

2026-10-02 取消结算纵切：检查发现 `ordinary-inpaint` 的 `image-edit` 任务未进入 `requiresAtomicTerminalSettlement`，取消路由会先独立退款、后写取消状态，存在处理中任务的分离结算窗口。现任务准入标记绑定请求摘要，只有类型／路由／模式／摘要一致的任务进入既有原子取消；分类用例先 RED 后 GREEN。隔离真库把供应商首个 POST 挂起后经真实取消路由取消，重复取消无第二笔退款，迟到回执仅返回 202 待核对，不交付图片；任务保持 `cancelled/refunded`。分类及相邻单测 **26/26**、两份图像编辑相邻真库 **85/85**、来源整份真库 **116/116**、TypeScript、目标 ESLint quiet 通过。两专用库 `test_` schema／public 表／其他会话 `0|0|0`，55492 已停止。**未关闭**文档权限／placement 在远端接受后、结果终态前撤销：当前普通 inpaint 完成与 poll 恢复仅受任务租约和终态 CAS 约束，缺持久父版本/规范来源及提交事务内重授权；不能据本轮取消用例宣称撤权安全。完整构建、全站 Vitest、严格 NFT、保护基线、正确预览、真实付费和发布仍未验；无提交／推送／Coze／部署。

2026-10-02 相邻回归补证：余额不足时 `createBillableTask` 抛出的 `InsufficientCreditsError` 原被外层映射为 500；现保持零任务、零扣费并返回 402。历史蒙版真库用例的供应商替身原未识别 `Request`，旧断言还要求 data URL／零 `cloud_tasks`，已按真实发送边界与受管结果合同更新，同时保留 RGB/RGBA 像素和一次扣费检查。更新后该用例揭示直返 `return completeInpaint(...)` 在 `try/finally` 中提前释放租约；四条直返分支改为 `return await`，持久化期间租约断言经去掉 `await` 反向验证确实 RED。最终相邻两份真库 **84/84**、来源整份真库 **116/116**、`pnpm ts-check`、目标 ESLint quiet 通过。两专用测试库的 `test_` schema／public 表／其他会话均 `0|0|0`，临时 PostgreSQL 55492 已停止。未运行本轮生产构建、全站 Vitest、严格 NFT、保护基线、正确预览或真实付费；无提交／推送／Coze／部署。

2026-10-02 实测：原擦除并发 RED 与旧 handoff RED 分别转 GREEN；新增蒙版直返 RED→GREEN，异步蒙版完成与错误客户端 provider/model 不改冻结路由用例通过。蒙版主模型全为明确 404 且无视觉回退时，原返回 500 却不结算；真库 RED→GREEN 后原任务失败、一次退款、私有输入清理，同键重放零第二次发送。`tests/integration/image-edit-document-source-postgres.test.ts` 整份 **115/115**、`pnpm ts-check`、目标 ESLint quiet、目标 `git diff --check` 均 exit 0。测试使用专用 localhost PostgreSQL 与受控供应商替身；尚未运行本轮生产构建、全站 Vitest、正确预览、真实供应商/付费或发布门禁。视觉模型已发请求后的未知回执、视觉描述与图像生成的双阶段恢复仍开放；下方清单保留未覆盖变体，复用老用例不等于全部勾选。

> **执行方式：** 按任务逐项测试先行、修后复核。本仓只在本地 `main` 工作；发布门禁未关闭前不提交、推送、同步 Coze 或部署，故不执行通用计划模板的逐任务 commit 步骤。

**目标：** 让 `/api/image-edit` 的 AI 擦除和蒙版修图在任何供应商 POST 前建立一条收费、可恢复的本地任务，保持本地兜底、取消、一次退款和原图非蒙版区域不变。

**架构：** 复用 `createBillableTask` 与 `openImageEditProviderPhase`，以本地 `image-edit-*` 为唯一任务身份；远端 ID 仅放 `remoteTaskId`。源图和蒙版保存在非 HTTP 暴露的私有任务输入表，任务 JSON 只保留摘要与后处理参数；供应商接受回执写入同一任务的阶段检查点。直返和异步均由相同的蒙版合成与终态栅栏完成。工作流资产版本发布仍由既有工作流发布合同负责，不能把本阶段的临时输出 URL 当作三工作区共享版本。

**技术栈：** Next.js 路由、TypeScript、PostgreSQL、Sharp、Vitest。供应商网络在测试中受控替身；任务、积分、来源授权、租约和版本数据库为真实隔离 PostgreSQL。

**设计依据：** [工作流图像编辑合同](../specs/2026-10-01-workflow-image-edit-contract-design.md) 顶部的“擦除／蒙版原子任务设计补记”，以及 [图像编辑来源与费用裁定](../specs/2026-09-28-image-edit-source-and-quote-decision.md)。

## 全局约束

- 保留 `erase`、`mask`、`inpaint` 三个旧入口与 `editMode` 语义；本地 LaMa/BFS 与 AI 失败兜底不能静默消失。
- 文档来源在收费事务内复核当前授权版本／placement；个人项目保持原受权路径。蒙版必须有受限媒体或受权版本，不把原始 data URL 写入任务 JSON。
- 请求摘要同时绑定 actor、项目、动作／模式、源图、蒙版、模型／供应商和关键后处理参数；同键异摘要返回冲突，零第二次发送／扣费。
- 任何 `started` 且未能证明未发送的阶段保留 `submission-unknown`，不换供应商、不重发、不盲退款。
- 仅在受管输出持久、原图非蒙版区域合成校验和任务终态 CAS 成功后交付；取消或撤权后迟到结果不能完成任务。
- 仅本机隔离真库与受控供应商；全站回归、Chrome 正确预览、真实付费和发布门禁另行验收。

## 文件职责

- `tests/integration/image-edit-document-source-postgres.test.ts`：真实路由／真库行为，现有“首个擦除 POST 挂起时任务为 0、消费为 1”RED 是第一条合同。
- `src/app/api/image-edit/route.ts`：请求准入、模式分派、兼容响应；不在此新增第二套积分状态机。
- `src/lib/task-core/inpaint-private-inputs.ts`、`migrations/20261001_wj_image_edit_private_inputs.sql`：收费事务内的私有源图／蒙版快照与严格身份/摘要读取；不产生公开 URL。
- `src/lib/task-core/inpaint-task.ts`：确定性蒙版合成、受管输出保存；直返与异步接受结果已由路由调用并以租约终态 CAS 完成，失败清理和崩溃恢复仍待扩充，不接收或保存 API Key。
- `src/lib/task-core/image-edit-provider-checkpoint.ts` 与 `image-edit-provider-phase.ts`：沿用阶段身份／回执；只有遇到实测缺口才修改。
- `src/app/api/poll-task/route.ts`：本地任务 ID 的受控恢复、远端 ID 轮询和直返后处理，不把本地 ID 发给供应商。
- `docs/superpowers/plans/2026-10-01-workflow-image-edit-contract.md` 与 Obsidian 看板：只登记本纵切已证与未证边界。

### Task 1：原子身份、来源及输入准备

- [ ] 在现有 RED 用例中保留挂起首个真实路由供应商请求的屏障；断言回执前 `cloud_tasks=1`、`consume=1`，第二个同键请求复用相同本地 ID 且供应商发送仍为 1。另加相同键换项目、模式或蒙版摘要的 409／零发送控制组。
- [x] 已独立验证私有输入组件：`persistAssetBytes` 的 `exports` 为公开 GET，不能用于暂存私有源图／蒙版。隔离真库已对同事务存取、错人/错项目/错摘要拒绝、篡改检测及仅已结算终态清理 GREEN；现已接入擦除／蒙版受管主路径，崩溃后清理重试仍待验。
- [ ] 对 `inpaint` 在任何本地／远端推理前准备受限源图与蒙版。收费事务的 `beforeCharge` 使用 `insertPrivateInpaintInputs` 存源图、蒙版及摘要；无任务/费用时整事务回滚。恢复用 `readPrivateInpaintInputs` 精确匹配本地 taskId、actor、项目、请求摘要，绝不通过公开 `exports` 读取原始输入。准备失败不得扣费；接线后在已结算终态调用 `deleteTerminalPrivateInpaintInputs`，并测试崩溃后清理重试。
- [ ] 把 `inpaint` 统一纳入 `core-v2` 费用路径，调用 `createBillableTask({ userId: authResult.userId, idempotencyKey: replayKey || requestId, requestDigest: inputIdentityDigest, creditCost: deductedCredits, beforeCharge: 文档源事务复核＋私有输入写入, task: { id: image-edit-UUID, type:'image-edit', status:'processing', projectId, messageId, result:{ imageEditAdmission:{version:1,route:'/api/image-edit',kind:'ordinary-inpaint',editMode}, imageEditInputs:{sourceSha256,maskSha256,dimensions}} } })`。任务 JSON 不含源图、蒙版原始字节或公开输入 URL。重复请求在媒体／供应商动作前返回原任务；冲突不可清算旧任务。
- [ ] 真库先跑新并发用例确认 RED→GREEN，再跑现有扩图并发、文档假源拒绝和旧擦除 handoff 用例。此时若旧擦除 handoff 失败，视为同任务身份迁移尚未完成，不把 Task 1 宣称闭合。

### Task 2：AI 发送阶段与结果接受

- [ ] 给擦除和蒙版各加真实路由测试：供应商明确拒绝、回执未知、异步 `task_id`、同步 URL 四类响应；检查只有已证明拒绝才进入下一个候选／本地兜底，未知态仍是原本地任务且第二次同键请求零 POST。
- [ ] 在 `image-edit/route.ts` 的 AI 擦除与蒙版调用 `autoTrySubmitImageTask` 时传 `openImageEditProviderPhase` 返回的 `boundary`。阶段 `phaseId` 分别为 `inpaint-erase-submit`、`inpaint-mask-submit`，`inputDigest` 哈希受管源／蒙版 checksum、提示词和变换参数，`targets` 是冻结的 providerId/modelId 对；发送前复核文档来源与取消状态。
- [ ] `opened.status==='accepted'` 从阶段检查点重建既有结果，只处理不重发；`submission-unknown` 返回本地任务 ID／202。新接受的 `taskId` 写 `remoteTaskId`，直返 URL 留在阶段结果而非直接交付。写回 CAS 失败回 202 待核对，不创建第二任务。
- [ ] 复跑 Task 1 与本 Task 的 RED，以及源文件相邻用例。任何供应商响应中的 API Key、原始图片数据与任意错误正文均不写入任务 JSON。

### Task 3：受管后处理、轮询与终态

- [x] 独立组件层：私有快照读取、擦除整图尺寸归一化、蒙版裁剪区等比居中、原图未涂抹像素保留及输出 PNG/校验和，均经隔离真库 RED→GREEN；该 helper 只返回待提交的输出，未完成收费任务终态。
- [ ] 给擦除与蒙版分别加直返和异步真库用例：原图非蒙版像素保持、结果缩放／裁剪与现有语义一致，完成结果是受管 URL 与 checksum；重复恢复只得到同一个任务结果。同步结果下载失败必须保留已接受检查点，不再发送供应商 POST。
- [ ] 在 `inpaint-task.ts` 读取冻结输入与接受结果，复用现有 `compositeMaskedEdit` 语义，用 `persistAssetBytes` 保存输出；对保存结果核对图片 MIME、尺寸、checksum。调用 `completeCloudTask` 时带租约 owner／attemptCount／deadline，CAS 失败不交付成功。失败文件的清理由持有者安全执行；未知 COMMIT 不直接删除可能已完成的输出。
- [ ] 在 `poll-task/route.ts` 为 `ordinary-inpaint` 加本地 ID 分支：无接受回执返回 `recoveryPending`，有直返 URL 时抢租继续后处理，有异步 ID 时仅轮询该远端 ID；远端 ID 写回丢失时按已接受阶段做本地 CAS 修复，不在有效提交租约内重复调用供应商。结果合成使用持久引用，不依赖原 HTTP 请求对象。
- [ ] 用真库模拟进程死亡后的租约失效、接受直返 URL 后保存中断、异步远端完成，分别确认同 ID 接续、一次供应商发送、一次消费／终态。

### Task 4：本地兜底、取消与账务

- [ ] 真库覆盖无 AI 模型的本地擦除、明确拒绝后的 LaMa/BFS 兜底、蒙版 AI 失败、供应商已 `started` 的未知态、提交中取消和完成前撤权；逐条断言没有重复任务或退款，未知态不以本地成功覆盖潜在远端任务。
- [ ] 本地路径沿 Task 1 的同一任务完成并持久化受管输出；确定失败使用 `settleFailedTask` 一次退款。已 `started` 未核对的阶段保持 pending；取消和完成均受同一终态 CAS／租约栅栏约束。
- [ ] 在 `tests/integration/image-edit-document-source-postgres.test.ts` 跑整份来源回归，随后跑图像编辑／轮询／取消相邻用例；`pnpm ts-check`、目标 ESLint、diff check、`pnpm build`、严格 NFT 与保护基线各自记录 exit。隔离库检查 `test_%` schema／public 表／其他会话为 `0|0|0` 后停止专用 localhost PostgreSQL。

## 后续独立边界

本计划完成仍不等于文档工作流发布或三工作区互通。下一计划须把完成的本地子 taskId 绑定现有 `WorkflowEditPublicationInput`，受管输出收养为 `workflow-output` 资产版本，并核对画布／节点／独立聊天读取同一结果版本；再做正确预览、真实付费与全站发布门禁。Pear 分层不在当前目标，PSD 核心保留。
