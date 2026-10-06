# 协作任务发布意图冻结设计

## 目标与边界

接续已完成8Cb3c：真实Agent任务创建时，在原任务/本人扣费/冻结授权共同事务内保存来源父版本、资产修订模式及摆放意图。完成与恢复不得重读可变submissionPayload或当前选区猜意图。本段交付真实创建消费者和可读取的不可变合同；自动发布消费者、统一task/output命令、Skill子任务继承、全部UI和发布门禁仍须继续，不以本段替代整体目标。

仅main、本地隔离测试；不stage/commit/push/Coze/付费/部署/安装，不连接业务库；stable/donor与七保护文件保持。默认关闭、Presence不授编辑权、账务actor不变、无第二套任务状态机、原PSD核心保留、Pear验证排除。用户自主执行要求覆盖技能默认反复确认、另建分支及提交。

## 方案选择

选择扩展既有wujie_canvas_task_publications的nullable publication_intent JSONB，不另建发布状态机。不选可变result/submissionPayload：其完成写入会替换且不保证原子；不选完成时按当前选区推导：会在移动、删除或撤权再授权后漂移。空旧值保持null，不迁移补权；只有实际创建消费者显式传入intent才冻结。

## 合同

CanvasTaskPublicationInput新增可选intent，输入是服务器构造的提案：parentVersionIds（有序、唯一、最多32）、projectionMode（derived/revision）、placement（append时携selectedEntityIds；replace时携placementId与expectedAssetVersionId）。严禁body/result中的owner、grant、位置或publication对象直接作为授权。重复/空/非法ID、未知字段、非法模式失败；revision必须恰好一个父版本。父系/修订与摆放动作相互独立：revision不会推导replace，derived也不会丢弃输入父版本。

保存规范值CanvasTaskPublicationIntent：version=1、parentVersionIds、projectionMode和placement；append规范化为action=attach、transform和strideX；replace保留action=replace、placementId、expectedAssetVersionId。使用现有媒体命令数值/ID边界，不引入URL、bytes、临时占位ID、客户端grant或账本。

准备时先同步校验并深拷贝整个提案，再等待SQL。沿原授权锁顺序，同client锁owner/project/授权与文档，读取并验证canonical projection。所有父版本必须ready、asset active、同owner/project、绑定asset正确，且存在未删除的规范canvas placement（精确workspace别名、canvas-image/video、deleted_at为空、文档以placement.id为键且版本匹配）。selectedEntityIds必须映射这些规范placement，不误把entity_id当placement.id；按输入顺序取第一个选中摆放作为位置锚点。replace必须在同事务验证规范目标与expected版本吻合，不接受仅版本ID或任意当前选区代替确认。无意图的既有调用沿旧合同，不能因新守卫改变旧授权语义。

兼容性裁定（2026-09-27源码核对）：本段冻结元数据，不上传或解码来源字节，不得用binary-media-contract的导出扩展白名单缩窄既有Agent来源。MIME为null/空白的历史ready素材保留兼容；存在非空MIME时trim+lowercase，并与asset.kind的image/或video/类别一致，类别冲突仍拒绝，不在此层新增格式白名单。实际Agent来源仍先经原context-adapters的图片白名单（含HEIC/HEIF），那些前置守卫不改。真实createRun新增null、空白、大小写/首尾空白、HEIC/HEIF可用与错误video MIME拒绝用例；同时验证同一intent及本人单次账务。不能用媒体导出支持范围代替来源引用可用性。

append布局：有选中锚点时x=anchor.x+anchor.width+32、y=anchor.y、width/height=anchor尺寸、rotation=0、zIndex=min(anchor.zIndex+1,1000000)；没有选中时，非空文档取所有未删除摆放的最右边界+32作为x，y=0、512×512、rotation=0、zIndex=0，空画布x=0。strideX=width+32。通过现有mediaImportCommandSchema校验规范transform；超出数值范围拒绝，不静默夹到其他素材上。后续多输出按冻结起点/stride计算并再次检查范围；本段不消费输出或决定媒体真实像素尺寸。

prepare/persist保持现有WeakMap事务绑定；写入publication时同一INSERT带intent，ON CONFLICT不更新；exact检查包含jsonb的IS NOT DISTINCT FROM，冲突409。旧同幂等键任务重放按既有早返回保留原意图，不升级授权、父系或位置。创建失败（权限、来源、位置、SQL、intent写入）与扣费/任务一起回滚；仅自身付款，无共享owner扣费。

新增readTaskPublicationIntent(client,actorId,taskId)：复用readTaskPublicationAccess既有task→publication锁与actor/project校验；无publication或null intent返回null；非null破损、未知version/字段或非法规范值409，数据库异常固定503；返回深复制/冻结结果，无写入。读者不能将其当长期授权：实际发布仍须8Cb3b的当前编辑权和原grant复核。读历史意图不重新计算位置或父系，不因当前摆放移动/删除篡改历史。

## 真实消费者

- AgentRuntimeService.createRun在已授权canvas文档分支，显式构造append提案，parentVersionIds=request.sourceVersionIds，selectedEntityIds=request.context.selectedEntityIds，projectionMode=derived。不要新增公开AgentRunRequest字段。
- agent-edit-execution-service原admission回调在同分支构造append提案，来源使用经过authorizeContext的sourceVersionIds/selectedEntityIds，projectionMode保留原assetProjectionMode规范结果；revision仍append，实际onApply替换另行接入。core-v2的原createBillableTask消费，legacy/resume/终态重放不扩权。
- 不修改现有账务service、幂等摘要、模型目录、私有descriptor、UI或任务终态。不能把Skill父run的intent称子结果已发布。

## 验收

真实AgentRuntimeService.createRun→真实授权→真实createBillableTask→原PG事务后直接查询publication_intent，证明位置/父系存在而非仅mock传参；最初用to_jsonb(row)->'publication_intent'读取以获得字段缺失的真实行为RED，而非missing-column错误。创建后移动/删除选中项、改task.result、同键重放，历史意图必须不变且一次扣费。真实agent-edit消费者测试证明revision保持revision且append；它与generic createRun不可相互代替。

覆盖owner/editor、两种canvas别名、空/无选中/多选、有序父系、derived/revision、显式replace合同、跨项目/私有placement/墓碑/旧版本/归档/MIME类型归属等拒绝；请求对象在SQL等待中变更不能影响冻结值；20并发同键一次任务/消费/intent；撤权再授权不升级；准备或persist失败无部分收费。迁移可重复运行、旧null不backfill、read破损/DB故障明确分类。测试隔离根须先于产品import，数据库必须显式loopback，保留原日志及失败历史。
