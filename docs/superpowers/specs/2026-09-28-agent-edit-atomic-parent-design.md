# Agent 编辑父任务原子准入设计

## 目标与范围

这是原 Yjs 协作计划 Task8Cb 的必要接入，不是新目标。现有 image-edit 项目准入 j1、精确执行模型 j2、普通生图 3i2 已关闭，不重做。Task8Cb3j3 交付可单独验收的新 Agent 父任务：鉴权本人收费、任务与消费流水同事务、agent-v2 私有执行描述符同事务，以及请求上下文幂等隔离。后续 image-edit 的可信父预付只能信任这样的数据库证据，不能信任内部请求头或 Cookie 缺失。

用户已要求无需重复确认，main-only；本设计不触发提交或部署。Pear 分层专项移出本轮范围，既有 PSD 核心保留。

## 现有证据与取舍

`agent-edit-execution-service.ts` 当前用 requireApiAuthOrReject 得到任务归属，却再次读取 getSessionUser 决定费用。legacy 分支先 consumeCredits 再产生 taskId，收费流水不能可靠证明这个父任务已付费。core-v2 虽同事务建任务和扣费，但 agent-v2 描述符在事务后另写。旧摘要未包含 projectId、选择实体、来源版本、投影方式、会话/消息和 maskVersionId；终态提前重放可能复用不同上下文。

选用既有 createBillableTask/createBillableCloudTask 事务，扩展私有描述符的原子写入；新 Agent 请求在各 task-core 模式均用这一权威准入，迁移审计保留实际模式。只修 Cookie 分支不能解决孤儿扣费，单独新增父任务账本会复制既有状态机，两者均不采用。运行引擎是否 agent-v2 不改变新任务的原子收费原则；旧引擎不被强行赋予不存在的持久描述符。

## j3 必须满足的合同

1. 请求 actor 只来源于成功接口鉴权或受控 resumeContext。同请求不再次读 Cookie 选收费人。internal 身份在新准入时按鉴权 ID 读取真实 managed user，缺失/停用拒绝，不能使用头中的 admin/productType 代替实际授权。session/desktop 身份与任务归属、模型授权、收费及日志一致。
2. 新请求仍先安全/模型/项目与来源准入，再扣费；保留 agent-v2 精确 providerId+modelId 和现有协作授权。运行恢复不再收费。旧 legacy、shadow、core-v2 模式的新请求均用原子任务/消费事务，不再执行 consumeCredits→recordAgentTaskSubmitted。旧任务不补扣、不迁移虚假流水；旧 poll/cancel/recovery 保留。
3. 新摘要版本化并绑定所有执行与归属语义：原 image/prompt/maskDataUrl/精确双模型对/imagePrompt/quality/aspectRatio/maxRounds，另加 projectId/sessionId/messageId/selectedEntityId/有序 assetParentVersionIds/规范投影方式/maskVersionId。摘要用明确白名单，不把随机 requestId 或客户端身份/凭证纳入。两条不同有序来源不能合并。新摘要与旧摘要不同，不“兼容”到旧上下文不明的任务。
4. 终态同上下文精确重放仍在当前模型/素材授权之前返回，满足历史完成结果可读合同；必须同时验证 task.type=agent-edit、actor、project、摘要。不同项目、不同来源/蒙版/选择实体/会话/投影或其他 task type 同键均 409，不能返回旧结果。旧摘要不明的 POST 重放安全返回冲突；原 taskId 读取/取消/恢复不变。这是拒绝重新提交，不删除旧任务。
5. agent-v2 在授权取得 canonical sourceVersionId 后、任何新扣费之前构造并验证现有 AgentEditExecutionDescriptorV1。作为独立的 server-only admission 参数传给既有账务事务，和 cloud_tasks、consume 及 canvas publication 同 COMMIT 保存到现有 agent_execution_descriptor 列。禁止描述符放到公开 result/submissionPayload/响应；禁止新列/新账本/函数型任意事务回调。descriptorDigest 必须等于真实规范描述符摘要。
6. 事务参数可选，未提供者全部原行为兼容。提供时只接受 agent-edit task，限制现有 64KiB，校验版本/字段/摘要；复用现有任务要求私有描述符相同（不覆盖旧描述符、不在收费后补写缺失描述符）。描述符失败、新任务插入失败、消费流水失败任一触发整事务回滚，余额/total_used/任务/消费均零新增。不得因此破坏旧 createBillableTask 调用或账务锁顺序。
7. 新请求成功只有一次 task ID、一次消费和一个私有描述符；并发同键只产生一份。收费失败返回402且无任务/描述符。配置费用为0只按真实配置免费，不能因无Cookie免费。接纳重放不得因后续描述符检查或恢复失败把已存在任务擅自失败/退款；对已有任务的执行结算仍由原租约/终态机制负责。
8. 新费用按真实 actor + exact provider/model 计算。旧 legacy 的未链接消费不得成为可信父预付，后续预付授权必须继续拒绝这种旧记录；j3 不能给旧记录伪造 charged_transaction_id。所有异常保持脱敏，现有失败/取消最多一次退款不变。

### 执行期补充：明确配置免费与历史漏扣的区分

旧 Agent 无Cookie也曾产生 creditCost=0/not-applicable 且有 V1 描述符，仅凭零费用与descriptor存在不足以证明“配置免费”。新原子路径在既有私有列wrapper中添加服务器生成的 `admissionVersion: 2`，与descriptor/descriptorDigest同事务保存；descriptor本体V1及continuation不变，旧getter仍只返回descriptor。只有此新原子路径可产生该标记，旧 persistPrivateAgentExecutionDescriptor 不回填标记。新同键复用必须同时匹配该版本标记及完整规范descriptor，不能升级旧记录冒充新准入。后继Agent预付校验须核此标记，再核真实消费或零费用行；标记不是客户端参数、不是单独免扣凭证。真库测试明确新付费/免费均有标记，旧0费用+旧wrapper无标记重放冲突且不修改/不扣费/不退款；原GET与恢复保持。这是wrapper兼容扩展，不改descriptor V1 schema、不新增列。

## 实现边界

- `src/lib/agent-runtime/agent-edit-execution-service.ts`：统一 actor、摘要与准入；移除新请求旧非原子收费分支，保持已准入执行及直接远程 image_edit 工具不改。
- `src/lib/task-core/billing-service.ts`、`src/lib/cloud-task-storage.ts`：可选 `agentExecutionDescriptor: { descriptor: AgentEditExecutionDescriptorV1; descriptorDigest: string }` 参数，只在服务器传递，在既有事务校验/写入；对外 CloudTask 序列化不变。
- `src/lib/agent-runtime/agent-edit-execution-descriptor.ts`：仅必要复用校验/错误分类，保留 V1 合同。
- 可提取 `src/lib/agent-runtime/agent-edit-admission-identity.ts` 存放有界请求摘要/身份校验，不能引入第二任务状态机。
- 行为测试必须使用真实 POST 与隔离 PostgreSQL；provider/model catalogue、认证入口、after dispatch 可作明确替身，账务/任务/描述符事务不可替换。fetch 默认拒绝，不能运行供应商或业务库。

## 验收

真实 POST 的 RED 必须先于产品修改，至少证明 desktop 无Cookie漏扣、internal 与冲突Cookie错人/漏扣、legacy 新任务无关联消费、不同项目/来源同键终态重放、非法描述符先扣后退这几类缺陷中对应行为。然后完整矩阵覆盖三认证、三个 task-core 模式、两 runtime 路径、配置免费、402、并发重复、不同类型/上下文冲突、描述符私密性与持久恢复。每个场景都查 task.user_id、流水 task_id/type/amount、charged_transaction_id、余额/total_used 和私有列；不能只断言 mock 调用。

描述符写盘失败用隔离 schema 的触发器/约束或受控本地 SQL 失败注入，在真实事务中证明四项全回滚。终态同上下文重放仍通过，旧任务的 GET 和原恢复用例不弱化。完整相关 Agent、task-billing、descriptor/recovery suites 和非增量 tsc/改动路径 lint 留原生日志、UTC、exit、SHA。所有新增测试都必须实际运行，跳过不能算通过。独立规范与质量审查、七保护/refs/index/38功能门禁由主控负责；未完成之前不关闭 j3。

## 完整 image-edit 接入后继（不由 j3 冒充完成）

1. 普通本人编辑与可信父预付同一 durable admission：沿用任务/账务/租约，覆盖全部十 action 与同步/异步分支，冻结 j2 exact plan 与可恢复来源；旧非协作兼容但新协作不能走本地神经 CPU/GPU 路线。
2. 父预付校验锁序 parent→execution lease→operation。分别验证 Skill(agent-run + frozen step/binding) 与 Agent(agent-edit + 私有描述符 + run.created continuation)；收费必须有同父 task_id 的 consume/金额，或明确0费用配置。校验 active generation fence、owner/project/tool/step/request digest/idempotency/key，禁止伪造头、跨项目、退款/终态父、旧lease及旧无链接父消费。子任务创建、dispatch fencing、local acceptance、暂停/取消/poll 都必须同一证明，不只扩 assert。
3. Agent 动态 remove_background/upscale 必须传真实 project/source/prepay；local child taskId 用 recordLocalAccepted，不当远程 providerTaskId。直接 performImageEdit 的远程操作保持原语义。Chat-tools 消费 sync/async 规范结果，不虚称“已加入画布”。
4. 图像编辑来源授权和唯一发布覆盖实时撤权、已发布任务精确重放；主图/可选蒙版用持久角色和固定序号，mask 单独 derived+attach，不能把两 URL 丢进全局 revision 数组覆盖同素材。来源版本/有序父项与输出意图在 admission 冻结；中间子输出不重复代替 Agent 最终输出发布。
5. 恢复/供应商接收未知/取消唯一退款/迟到终态、三工作区 UI/撤销与刷新、视频/Skill其他入口、草图与全平台发布保持原任务清单。本阶段不得跳过这些直接进入 Task9。
