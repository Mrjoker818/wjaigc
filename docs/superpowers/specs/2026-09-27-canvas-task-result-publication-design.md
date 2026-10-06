# 协作任务完成与恢复唯一发布设计

## 目标与范围

接续已验收8Cb3d，在真实完成消费者中读取冻结意图，把任务输出字节、资产版本/父系、摆放、Yjs更新和命令身份沿已有共同事务提交；重复完成、恢复和崩溃重放只能得到同一历史引用。覆盖generic Agent事件、agent-edit终态、cloud完成回调、workspace结果与recover GET。它们是同一发布合同的接入点，不是多套状态机。

本段不新增其他generate/raw/延迟/Skill子任务的创建授权，不猜Skill结构化父输出；那些继续属于原8Cb。全部UI/撤销、8D–E、Task9和草图转代码仍开放。Pear按最新范围决定排除，原PSD保留。

仅本地main，保留既有未提交修改与七保护文件；不stage/commit/push/Coze/付费/部署/安装/业务库。stable/donor只读，Yjs默认关闭、Presence不授编辑权、账务始终actor，不建第二任务/账务/权限状态机。用户自主执行覆盖技能默认反复确认、新worktree及提交。

## 方案与取舍

选择扩展现有document-media-import受控共同事务，并让所有本段完成消费者汇入共用分流。不能直接把旧owner-only task-projector用于共享owner：它不写规范Yjs；不能仅调用现有adopt并丢失revision家族：它总是新建资产；也不另建发布队列或事务引擎。新模块只承担冻结意图解释/输出编排，媒体下载、预算、锁、准备能力、授权、命令及ACK恢复复用原实现。

## 服务器合同与唯一身份

1. 新内部入口`publishDocumentTaskOutput(actorId: string, taskId: string, outputIndex: number, signal?: AbortSignal): Promise<DocumentMediaImportResult>`只接受本人任务和索引，从数据库读取TaskPublicationAccess及非null intent。调用者不能指定owner/grant/父系/位置/命令键/URL。公开upload/adopt/import-version的JSON schema不扩权限字段。
2. 每输出命令键固定为`canvas-task-output:v1:`加SHA256(JSON.stringify([actorId, projectId, taskId, outputIndex]))的小写hex。项目来自冻结记录；与调用渠道、messageId、客户端idempotencyKey无关。导出一个纯键函数供后续UI的服务器接入复用；浏览器不直接导入server-only模块，本段不改UI。
3. attach transform按冻结值，x加outputIndex*strideX；所有输出的命令在开始写入前用原mediaImportCommandSchema核验范围。replace只准恰好一个输出且index0；多输出replace在任何新写入前拒绝，不能同目标连续换版或暗改为append。
4. 每输出沿原命令表及media lineage记录，不新增发布状态表。只有真实已提交命令才返回RegisteredWorkspaceAssetReference。重放引用来自原命令的历史asset/version/placement，不查当前摆放拼接，不删除后复活，不再下载字节。
5. 全任务编排`projectCanvasTaskResult(input: ProjectCompletedTaskInput): Promise<WorkspaceAssetReference[] | null>`读取真实actor任务。非null冻结授权时忽略可变submission及调用者的workspace/父系/位置，目标project必须等于真实任务/冻结project，否则拒绝。记录存在但intent为null/破损、权限或数据库故障时不回退旧projector。
6. `null`仅表示非本段协作路径，可继续原私有projector；无publication但目标为已启用协作canvas的旧任务不能自动补权或走owner-only写入，须明确失败并保留本人结果。未启用协作的私有项目、chat/workflow旧路径兼容，不把本段扩为三工作区UI接入。全局feature关闭不允许有冻结记录的任务回退绕过；数据库异常不视作无记录。
7. 输出枚举使用既有outputUrls的顺序/优先级，索引稳定。任务type为video按既有video来源；generic Agent仅videoUrl的实际媒体输出应识别video，不能当image下载。拒绝3D/非媒体；本段不解析任意Skill嵌套对象。无直接媒体URL时不写虚假的completed/空引用标记，不抛供应商任务失败，不声称Skill子结果已经共享。

## 父系、修订与受控媒体身份

- 读冻结parentVersionIds有序值；发布时确认父版本仍ready、同owner/project且asset active、绑定正确。无需重新要求原来源placement仍在当前选区或原位置；移动或删除摆放不改变已冻结父系与布局。跨scope/归档/损坏父版本拒绝。revision唯一父资产kind必须与输出kind一致。
- derived创建新资产；revision复用唯一父版本所属资产、创建新版本并更新该资产current_version_id；两种模式均保留ordered sourceVersionIds元数据，并写现有wujie_asset_version_parents有序边（现有跨asset同scope FK已支持）。版本task_id、provider/model身份从真实任务读取，不能从body/result伪造归属；media lineage actor仍为发起人。所有这些与命令、placement、Yjs同事务，无中间资产提交。
- revision仍是版本语义，attach时新建输出摆放，不覆盖源摆放。replace必须是冻结明确动作且expected版本仍匹配。
- 新版本必须绑定真实媒体准备的WeakMap能力。revision目标身份从真实任务冻结来源准备产生，不能接受普通对象assetId来改写prepared identity。旧upload/adopt/version的随机新资产能力不变。
- 推荐最小安全顺序：在最终项目锁内复查父系/来源，插入新version但暂不更改已有revision资产current指针；bind通过专用可信revision能力验证其真实asset及原current，不放宽普通media bind；执行原document command及前后完整prepared快照验证；最后在同事务更新revision current指针，再读完整reference、COMMIT。这样不需跳过或全局刷新旧asset快照。如实现采用其他顺序，必须证明只承认本事务明确指针变更，其他asset/version/annotation并发变更仍被拒绝。不得通过删除整个asset_record深比较或任意回调validator绕过准备守卫。

## 授权、并发及错误

所有阶段（准备前、锁后、最终事务、原命令重放、COMMIT不确定恢复）同时复核原TaskPublicationAccess/intent及当前编辑权、创建grant代次和项目启用状态。冻结intent不是长期授权。锁序保持graph gate→task/publication→排序project NOWAIT→原权限与document，不持数据库事务做网络/文件IO。

整个任务按索引顺序采纳输出；中间失败允许已提交前缀保留，重试按同键取回前缀并继续，不再次消费积分或退款。失败/取消/timeout任务的迟到输出保持原审计且不发布，不改供应商终态以掩盖发布失败。

自动发布的task source快照必须仍检测task身份、终态、输出URL/metadata及所有源资产变更；仅允许排除由本系统独立维护的`result.assetProjection`标记这一非媒体字段，防止并发pending/completed标记变化使正确媒体被误判。不能移除整个result比较；旧手动采纳合同不弱化。测试必须实证真实URL/来源变化仍拒绝。

保留原预算、超时、取消、未知COMMIT保留媒体、不确定结果不提前ACK、精确历史引用等合同。重要权限错误保持403，冲突409，暂不可用503，不能把错误静默当成无协作路径。

`recordTaskProjectionPending`不得覆盖已completed标记；completed只在全输出真实命令引用收齐后写。最终记录前在短事务内复核task仍completed、冻结身份和当前权限，禁止撤权期间写入新的共享结果确认；不可把仅返回URL当登记完成。历史已completed标记不授权新共享读取或发布。完成标记必须保留全部引用顺序；既有成功标记不被较迟失败降级，也不被相同重放无意义覆盖。

## 真实消费者

- workspace-results默认出口先调用上述分流；保留现有factory注入合同，不能只改测试factory而默认出口不接入。协作分支返回真实完整引用，不调用旧projector第二次。私有路径行为不变。
- cloud-task-persistence完成回调：无论首次transitioned或已completed同终态重放均尝试规范投影；读取终态库内结果，不采纳新的回调URL覆盖既有终态结果。failed/cancelled/timeout只旧迟到审计。
- agent-task-persistence真实recordAgentTaskTerminal：复用共用完成投影，completed重放恢复而不抛旧冲突；非completed冲突和迟到处理保留。不重复旧owner-only版本投影/marker代码。
- AgentRuntimeService.appendEvent：首次run.completed、task完成但事件未写的同终态重放、已有相同terminal event三种窗口都可补发布。先验证原event/digest/terminal身份；不同事件/迟到失败不得触发。用可注入生产依赖接现有projectPersistedCompletedTask，真实集成测试不能mock此依赖。非媒体/Skill父结果不冒充已发布；发布故障记录pending并保留原成功终态及事件，不能造成再次收费。
- recover GET：保留原本人/项目/legacy过滤；除旧pending外，已completed且具有本段可信持久intent但无标记的任务也进入恢复。不为所有旧completed盲目补权。恢复后重读真实任务返回本次已提交引用；仍有错误则返回本人原结果和pending，不泄漏其他用户/项目。直接调用真实GET与PG验证，旧源字符串测试不足为证。

## 验收

首个RED走真实Agent创建/本人扣费→真实完成事件或真实完成回调→查询规范document/命令/资产/账本；失败应为未产生规范摆放或仍projection_pending，不以缺导出/缺列/夹具异常作为功能RED。最小单图GREEN之后增加各真实消费者独立RED→GREEN与以下矩阵。

1. owner/editor、image/video、derived/revision、明确replace、固定手算布局、父边顺序与源资产字节不变；revision同asset不同version且源placement未替换。所有引用与真实库内身份一致；无第二扣费/退款。
2. 至少两个输出、第二输出故障后恢复、20并发同task/output、完成回调与GET交错，唯一命令/资产/版本/摆放/更新；失败者pending不能覆盖成功。模拟COMMIT后ACK丢失、publication完成但marker前崩溃、终态完成但任何marker前崩溃，均从原键恢复。
3. 创建后移动/删除来源摆放仍按历史intent；结果摆放删除/换版后重放不复活。明确replace期望版本过期拒绝；多输出replace和数值越界无部分写入。
4. prepare媒体期间撤权、撤权再授权、项目禁用/归档、actor停用、跨用户/项目、null/破损intent、伪造能力/输入；零新文档/资产写入，原成功任务与账务不变。数据库故障不回退私有投影。
5. 新弱比较只排除assetProjection；媒体URL/metadata变更、asset current或其他字段并发变化、注解来源变化仍拒绝并回滚。锁/预算/取消/错误清理回归，未知COMMIT不删已提交媒体。
6. generic三个完成窗口、agent-edit、cloud完成重放、workspace默认出口和真实GET分别有行为证据；GET同次响应新references、账号/项目隔离、旧私有和旧null不补权覆盖。

全部测试使用显式loopback隔离库，产品import前唯一mkdtemp媒体根，未设根时tmpdir fallback；保留原生命令/输出/时间/exit/失败历史。先定向后最终受影响套件一次及非增量tsc/变更TS ESLint；独立审查通过才记本段完成，不替代8E全仓/浏览器/云端发布。
