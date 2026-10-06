# V588 Yjs 多人画布文档协作设计

日期：2026-09-25
阶段：协作能力 3/4（只读分享、WebSocket 在线状态之后；草图转代码之前）
状态：设计定案；Task1–7本地实现及分层验收已完成，Task8–9和云端/发布门禁仍开放。当前证据见 `docs/testing/v588-yjs-collaboration-evidence.md`。

## 1. 目标与不变量

让同一项目的所有者和被明确授予编辑权的用户，在无限画布上共同编辑素材摆放、分组、标注及相关文档状态。不同参与者的独立编辑应合并；断线重连、刷新、进程重启和多实例切换后不得丢失已确认更新。新增、删除和替换媒体必须继续使用现有项目、资产版本与任务/积分体系，不得生成第二套素材或账本权威。

节点模式与独立智能对话继续共享该项目的素材、任务、Skills 和结果版本；本阶段不谎称两者已经实现同步光标或多人同时编辑。匿名只读画布分享保持不可写且不能换取协作票据。当前 `presence` 成员仅获在线状态资格，绝不能自动取得文档读取或编辑权。功能默认关闭；未开启协作的项目完全沿用当前画布保存和撤销链路。

## 2. 现状与方案比较

当前画布通过 `canvas-workspace.tsx` 的整项目自动保存和 `UserManagerCore` 项目快照持久化；资产图中的 `wujie_projects`、`wujie_workspace_placements` 和 `wujie_asset_versions` 按所有者隔离。在线状态已有同源 `ws` 入口、一次性票据和 PostgreSQL 租约，但 Coze 同源 `101` 及发布门禁仍未验收。

1. **采用：现有同源入口 + 独立 Yjs 文档网关 + PostgreSQL 更新日志。** 权限、文档、投影与媒体引用均绑定现有项目；Yjs 管并发文档状态，资产图仍管媒体/版本。可逐项验证与回滚，代价是必须显式切换协作项目的保存权威。
2. 不采用：把 `Y.Doc` 叠在现有整项目自动保存上。旧的 owner 快照会覆盖非 owner 更新，且旧模式的 `wujie_user_data.projects` 与资产图会出现两个可写权威。
3. 不采用：直接暴露通用 `y-websocket` 内存服务器或新增外部协作 SaaS。通用内存后端不满足项目授权、重启持久化和多实例要求；外部服务会引入第二套身份与部署面。

使用稳定的 Yjs v13 文档更新 API；客户端以项目绑定的自有受限帧协议传 `Uint8Array` 更新，不把票据塞进 URL。Yjs 更新可交换、可重复应用，但服务端仍须先持久化、后广播。在线人员继续由现有 presence 系统显示，不复制第二套 awareness 名单。参考：[Yjs 文档更新](https://docs.yjs.dev/api/document-updates)、[y-websocket 官方说明](https://github.com/yjs/y-websocket)、[awareness 与文档分离](https://docs.yjs.dev/api/about-awareness)。

## 3. 编辑资格与数据边界

- 所有者默认是本项目编辑者；其他登录用户须由所有者通过新的项目协作邀请显式授予 `editor`。授权表独立于 `wujie_project_presence_members`。管理员身份、在线状态资格、匿名分享令牌和同名用户均不构成编辑资格。
- 授权只覆盖指定项目的协作文档和经校验的素材投影，不扩大既有 owner-only 资产 API 的查询范围。编辑者通过新的项目作用域读取/命令接口访问文档；服务端以登录用户 ID、项目 owner ID、活跃项目和有效授权四者联合校验。成员撤销、用户禁用、项目归档/删除必须立即拒绝新票据和后续更新，并关闭现有连接。
- 独立的一次性 30 秒票据在数据库仅存哈希，绑定用户、项目、文档种类与用途；升级前原子消费，复核同源 Origin 与权限。浏览器通过受限 `Sec-WebSocket-Protocol` 携带，不进入 URL、localStorage 或日志。入口精确为 `/api/collaboration/document`，与 `/api/collaboration/presence` 分流；开关 `WUJIE_YJS_ENABLED` 默认关闭。
- 文档只保存持久且允许协作的画布字段：按稳定 image/placement ID 索引的媒体版本引用、变换、层级、分组、标注及必要的展示元数据。不得纳入 API Key、供应商凭据、账本、临时 `data:`/`blob:` URL、任务 processing 占位框或用户私有视口。媒体内容和二进制模型不进入 Yjs 更新；文档引用须对应本项目已就绪的资产版本。

## 4. 文档权威、兼容与恢复

- 项目由所有者显式开启协作。开启事务先核对现有项目可见性、媒体持久化与资产版本映射；对 legacy/shadow 项目执行受控迁移，失败则不改开关、不写半成品。以当时的项目修订号为条件一次性种入 Yjs 文档及资产投影，保留原快照与回滚标识。
- 开启后，Yjs 文档是画布可协作字段的唯一写入权威，资产图仍是素材/版本唯一权威。所有者和编辑者的本地画布改动均转换为 Yjs 事务；旧整项目自动保存对该项目不得再写 `canvasImages` 或把旧快照回灌。项目列表、节点模式与对话所需的素材视图由服务端物化投影读取，不复制到编辑者个人项目列表。
- Yjs 固定根 `Y.Map` 的摆放字段为按 placement ID 索引的 `assetVersions`、`transforms`、`groups`（分组归属）、`annotations`（旧式短标注）和 `tombstones`；旧项目还实际保存独立的 `metadata.groups` 完整分组定义及 `metadata.annotationsV2` 结构化标注，因此增加按各自记录 ID 索引的 `groupDefinitions`、`annotationRecords`，不得只保留摆放上的 `groupId` 或短标注。启用时把两类记录中的旧图片 ID 映射为 placement ID，项目读取时再映射回原图片 ID；验证引用、项目归属、几何、大小与禁入历史，异常事务回滚。完整分组和结构化标注的删除使用独立的 `groupTombstones`、`annotationTombstones`：保留原记录但从用户视图过滤，清除被删分组的摆放归属，拒绝移除墓碑或重写被删记录。遮罩和叠加 Asset ID 必须属于当前项目且有可用的受管版本。不同素材和独立记录可合并；变换本身作为一个原子字段更新，冲突按 Yjs 确定性次序收敛。没有可被原始更新整体替换的嵌套摆放记录。服务端提交前须对比原文档与候选文档，拒绝原始 Yjs 更新移除墓碑或已有摆放，不能因旧客户端重连复活。`Y.UndoManager` 只追踪本地用户来源，不把别人的更新纳入自己的 Ctrl+Z。
- 新增、替换或删除素材先走已有任务/资产版本语义和服务端项目作用域命令：新媒体必须由任务/上传先落盘并得到本项目有效资产版本，再把引用加入文档；编辑者的付费任务仍由其本人确认与计费，协作只引用最终成品。编辑者自有任务结果进入所有者项目时，须由新增的项目作用域采纳事务核对授权、任务终态、可用媒体及版本来源，为项目建立独立版本与父系记录；不得直接改写任务的计费归属或原资产 owner。删除摆放不删除原始素材或资产版本。任何未知/跨项目/未就绪引用均拒绝，不能由客户端伪造 `assetVersionId` 取得他人媒体。
- 服务端先从权威快照与更新日志构造临时 `Y.Doc`，应用来稿后同时校验完整文档根类型、物化投影、墓碑单调性及资产归属；不合规则丢弃临时文档。不能直接把原始更新字节落库：一次更新可能先写入非法 URL/媒体字节再覆盖，最终投影虽合法，原始历史仍泄露。须规范重编码候选并证明历史禁入内容不残留；无法净化时整笔拒绝。合格更新在同一数据库事务内复核资格、追加规范更新、序号和投影，提交后才替换缓存并向本机 socket 广播；PostgreSQL `NOTIFY` 唤醒其他实例从日志补读。通知可丢，断线以状态向量和数据库序号补齐。持久更新定期在项目锁下合并为快照并保留有界故障恢复日志；已确认更新在进程崩溃后可重建。服务端不接受未校验投影的恶意 Yjs 更新，也不把进程内 `Y.Doc` 当持久权威。
- 客户端加载先取授权快照/状态向量，再连同源 WebSocket；项目切换、登出、撤销或卸载销毁旧 `Y.Doc`/socket。远端更新应用到画布时不回写为本地事务，防止回声循环；未获服务器确认的本地更新显示待同步，失败后保留可重试状态，不谎报“已保存”。
- 浏览器每笔本地更新先把原始帧和可读意图写入项目/用户隔离的待确认队列，再更改可见文档；写盘失败则拒绝操作。服务器以永久错误拒绝时尽力在原记录中标记隔离，绝不删除唯一持久恢复副本。无论该标记是否成功，**新页面/新会话**加载到的未确认帧均为“不确定恢复”状态：展示经过校验的本地分叉及下载入口，不自动重放；只有用户明确点击重试才发送。明确标记为服务器拒绝的帧仅允许导出，不提供重试。媒体投影不完整也不得隐藏恢复状态/导出，但必须禁止写入和重试。单页面临时断线最多自动重放同一待确认批次三次，再转为手动恢复，避免永久拒绝的关闭码丢失时无限循环。此规则覆盖浏览器拒绝标记写入、关闭事件未到达就崩溃等窗口；除非未来加入服务端逐操作结果账本及查询协议，不得恢复跨页面自动重放。

## 5. 故障、安全与资源预算

### 受控媒体命令细则（Task 8，2026-09-27）

- `attach/remove/replace` 以登录 actor、目标项目和幂等键确定唯一命令，规范请求摘要不同则冲突；结果与资产摆放、文档序号及日志同事务保存。重放须重新验证当前资格，但返回原结果，不重新添图或复活已删除摆放。
- attach 对本项目已有 ready 图片/视频版本建立新的摆放；外部上传和完成任务须先通过受信媒体准备，再在同一最终事务建立资产版本及添图。不得将任意 URL 当作所有权证据，也不得顺序调用两个独立提交的包装器冒充原子性。
- remove/replace 必须匹配 `expectedAssetVersionId`，拒绝操作已经被其他人换版的摆放。remove 保留原资产、版本和文件，只将摆放转为 trashed、文档添加墓碑、从活跃分组移除成员并为依附标注添加墓碑；不抹除历史。replace 保留摆放 ID、几何与分组，更新资产图和文档的同一版本引用；保留标注的原来源版本并标记 stale，不冒充标注已经针对新图重新计算。
- 原始 WebSocket 更新仍不能改已有版本键。受控命令只有精确的类型化操作，不提供客户端 `allowReplace`、任意回调或未经验证的投影绕过。服务端共用同一套历史、墓碑、归属、规范编码和持久化验证。
- 媒体探测/复制必须在授权行锁之外完成；最终事务只按准备时的版本/资产身份快照重新核验并写入。快照变化、撤权或项目状态改变时拒绝整笔命令。待提交结果不是 ACK；COMMIT 确认丢失时通过持久幂等结果查询，未知结果不删除可能已被引用的媒体。

每文档限制连接数、更新字节数、更新频率、物化记录数与队列长度；超限更新拒绝且不改变数据库。所有更新需按服务端白名单校验有限坐标/尺寸、标注长度和项目内资产引用。原始票据、Cookie、完整画布、URL 私密参数不进入日志。连接时及每次写入复核授权；只读分享页不得导入协作客户端。数据库或网关不可用时协作项目应显示“同步不可用”，不得落回旧整项目自动保存造成双写；普通非协作项目不受影响。

### 本人无任务素材转入细则（Task8Cb1，2026-09-27）

本项补齐原8C个人素材/Skill转入中`assetVersion.taskId`为空的合法来源；不是新的生成、账务或协作授权系统。采用现有媒体准备和共同提交管道的第三种`version`来源，不采用伪造已完成任务，也不采用旧transfer先提交再补Yjs。

- 新项目作用域`POST /api/collaboration/document-assets/import-version`只接收目标projectId、本人sourceVersionId、idempotencyKey和既有attach/replace命令；不接收URL、owner、任意sourceProjectId、taskId、outputIndex或原始Yjs。登录actor从session取，不从请求取。
- 仅允许actor自己拥有、源项目活跃、资产活跃、ready图片/视频且`task_id IS NULL`的版本。版本、资产、源项目的owner/project联合身份必须一致。有关联任务的版本仍走现有completed-task采纳，不得用此接口绕过任务终态/选中输出校验；失败/取消任务结果不能转成无任务来源。目标要求现有独立编辑授权及协作启用，Presence/匿名/管理员身份不自动授权。
- 服务端读取可信来源快照，按asset.kind绑定原32MiB/512MiB读前预算，在授权行锁之外复制/探测受管媒体；复用现有本地身份/S3固定对象/安全远端读取和完整格式验证，不能因MIME错配扩大预算。两活跃准备、全局512MiB预约、120秒媒体读取和300秒总期限继续共用，不另开独立容量池。
- 最终事务沿已有graph gate及排序项目NOWAIT锁，锁后重新核对源version/asset的完整快照、owner/project/ready/task_id-null及目标授权/启用。来源删除、归属/文件/尺寸/checksum或任务关联改变、撤权、项目归档任一变化都拒绝整笔提交；不得在媒体I/O期间持业务授权行锁。
- 目标建立独立owner/version/file，原版本/文件不覆盖、不重新归属；lineage保存真实source_kind=version、source_project_id/source_version_id，task_id/output_index保持NULL。lineage、资产/版本、摆放、规范文档更新和幂等结果必须共同COMMIT。非任务导入不创建任务、不扣积分、不退积分。
- 幂等身份沿actor+目标项目+key，来源类别及请求摘要参与冲突判断，跨upload/task/version/现成版本命令同key不能串用。已确认重放先复核当前目标权限，再返回原结果，不重读/复制源文件，也不复活已删除的摆放；源后来不再可用不撤销已完成的独立项目副本。
- 保持现有COMMIT确认丢失处理和清理规则；不能收到未知提交结果就删掉可能已被引用的目标媒体。迁移仅追加，保留旧upload/task数据和约束，不改历史迁移；新version行的来源字段组合必须由数据库CHECK同时约束。

该来源分支与8Cb其余本人生成前授权/完成投影、8Cc全部UI入口、8Cd撤销兼容是不同验收单元。做完本项不能宣称共享项目生成已正确计费，也不能代替三工作区视图或发布。

严格构建 NFT、精确构建树、Coze 同源 `101`、多实例、真实付费取消唯一退款、CI 与正式发布继续是独立门禁。Yjs 的本地功能验证不能替代这些门禁；若云端代理不能透传同源升级，阶段仍为 `UNVERIFIED`，不能以轮询冒充 WebSocket 协作通过。

### 本人生成前项目授权（Task8Cb2a，2026-09-27）

这是原8Cb生成接入的前置权限单元。选用专用服务端准入适配，不全局放宽owner-only资产API，也不依赖浏览器判断授权。相较于重写全部生成/账务系统，该方式保留原任务与积分权威；相较于仅前端禁用按钮，所有实际请求都能在供应商或扣费副作用前拒绝。

- `/api/generate`与画布实际使用的`/api/universal-generate`都必须先完成现有统一API鉴权，再以认证actor和请求projectId执行同一项目准入。客户端userId/ownerId/admin声明不能决定身份。第三方入口改用`requireApiAuthOrReject`，保留已认证无项目调用；不在本单元重建其任务/计费系统。
- 未提供projectId（undefined/null/空字符串）保持无项目语义且不为此连接数据库；空白字符串、控制字符、超长或非字符串拒绝。有效ID须原样使用，不以trim悄悄切换项目。项目身份最大256字符，与既有协作媒体请求一致；actor须为非空字符串。
- 有项目请求使用短生命周期、同一一致性快照的只读PostgreSQL事务。先区分资产项目存在与不存在，存在但非本人/trashed/owner停用不能被旧JSON项目同名记录覆盖。actor与owner均需active。纯个人资产项目仅owner准入，不要求Yjs开关。
- 无资产项目行时，仅允许认证actor自己的`wujie_user_data`中`key='projects'`的唯一同ID/userId项目；兼容JSON数组和字符串化数组，拒绝重复、无效、冒名项目。不借`dbGetUserData`吞掉数据库错误变成“未找到”。此路径只读，不提前迁移旧项目。
- 存在规范协作文档或enabled设置的项目按协作处理，不得因禁用而降回个人写入。必须有文档、项目enabled及`WUJIE_YJS_ENABLED === 'true'`，actor为owner或具有独立active editor grant。owner代次为`'0'`，editor代次从库中grant_generation原样转字符串读取；presence/匿名分享/admin均不授权。仅有disabled设置且尚无文档的owner个人项目仍可正常生成。
- 返回类型区分unscoped/personal/document，并保留actorUserId与ownerId为不同字段；这只是当前准入快照，不是可重放的写入令牌。错误固定为400 `GENERATION_PROJECT_INVALID`、403 `GENERATION_PROJECT_FORBIDDEN`、503 `GENERATION_PROJECT_UNAVAILABLE`；客户端响应不含SQL/URL/路径/底层异常。
- 路由在任何模型/供应商读取、credits/task admission或供应商网络请求前校验。连接/BEGIN/读取/COMMIT失败必须fail closed，释放连接且不泄露异常；事务不能跨越供应商I/O。不修改既有任务actor、积分归属、终态重放或投影器。准入通过后发生撤权仍须由后续完成投影单元重新校验，不允许把此快照当作永久写权限。

后续8Cb仍必须实现共享来源的规范版本授权、冻结授权代次、完成/恢复/客户端采纳的唯一幂等投影，以及全部生成/编辑/视频/Agent入口；8Cc–8E仍须UI接入、撤销与三工作区完整回归。这里只关闭两个入口的前置权限，不能声称共享生成、第三方计费或发布完成。

### Agent 共享画布来源准入（Task8Cb2b，2026-09-27）

承接8Cb2a的项目准入，将真实`authorizeAgentContext → admitAuthorizedAgentExecution`链路接到协作画布素材；不另建任务/计费系统。选择专用Agent PostgreSQL读取适配器，在同一短只读REPEATABLE READ事务中读取项目权限、规范文档和素材。保留owner-only资产存储API及自定义AgentContextStorage接口，不能把asset-core的findProject放宽成“所有编辑者都能读所有工作区”。

- 发起actor与资源owner分离。权限取自服务端现有GenerationProjectAccess；素材读取使用经授权owner和同一project，model权限、任务admit及账务仍使用actor。将服务器读到的document access（actor/owner/project/grantGeneration）附带在AuthorizedAgentContext中，明确是本次来源快照，不是未来写许可、不是客户端可传的授权证明。
- 共享editor目前只允许canvas及精确`projectId`/`canvas:projectId`别名。共享文档中的owner画布也走同一规范素材校验。非owner不得以workflow/chat/任意workspaceId或空source列表绕过；owner自己的workflow/chat继续保持既有owner-only读取边界，不授予其他编辑者其私有内容。三工作区的后续项目作用域视图仍属8D。
- 对文档画布，sourceVersionIds和visibleVersionIds均须出现在有效规范projection的非deleted摆放中，且对应数据库placement active、deleted_at为空、canvas-image/canvas-video类别、精确canvas别名、版本一致。仅存在项目版本、orphan placement、回收站/旧版本、墓碑或私有chat/workflow placement都不能作为共享来源；存在多个同版本摆放时不能因第一个orphan误拒绝后面的有效规范摆放。
- 所有返回文档版本必须ready、asset active并保持project/owner联合身份；sourceVersionIds继续仅接受image及既有可信MIME（缺MIME的legacy ready image保留），不是将video来源悄悄送入图片工具。选中entity必须映射到同一有效摆放和已授权version集合；返回数据库规范URL，忽略请求伪造URL/owner/授权对象。原个人项目版本/摆放/别名语义保留。
- 默认SQL读取的权限与project/owner/文档/素材必须来自同一一致性快照；撤权、用户/owner禁用、项目归档、文档缺失或停用、全局关闭均拒绝新准入。恢复/再授权读取新代次；不以旧内存scope缓存跨请求复用。事务结束后才进入模型检查或admit，不跨供应商/任务/积分I/O持锁。
- 拒绝保持`AGENT_CONTEXT_NOT_FOUND`404以避免泄露他人项目；数据库/回滚故障公开固定的`GENERATION_PROJECT_UNAVAILABLE`503且不含SQL/URL/凭据。连接全部释放，回滚失败销毁故障连接。来源读取不写图、项目、任务、积分或文档。

测试须调用真实Agent context与真实admission gate并接入真实PG，模型解析/最终admit使用受控边界以证明拒绝前零副作用、许可后actor不变。该单元不自动关闭普通图片referenceImages授权、持久化授权代次、完成/恢复唯一投影、旧回调围栏或UI；这些仍沿原8Cb继续，不能因来源可读就宣布共享生成完成。

### Agent任务创建时冻结共享发布授权（Task8Cb3a，2026-09-27）

执行期真实上传探针确认来源读取的跨段键映射缺陷：规范projection按数据库placement.id索引，不是entity_id。8Cb3a须同步修复context读取与错误测试夹具，保持selectedEntityIds仍为UI实体ID；禁止双键回退导致orphan来源泄露。新增真实upload→context以及实体ID冒充另一摆放键的负例，旧8Cb2b通过不能代替此集成验收。

来源准入快照不是未来写许可。本段将其接入两个已有core计费创建消费者：AgentRuntimeService.createRun（含Skill父运行）与agent-edit的agent-v2/core-v2新任务路径，持久化独立的服务端发布授权。选独立表而非可变result/submissionPayload，避免完成结果合并覆盖授权；不建立第二套任务或账务状态机。普通generate、raw createCloudTask、延迟收费、Skill预付费子任务及完成投影仍须接续，不在本段冒称完成。

- 新增`wujie_canvas_task_publications`，每task唯一，绑定actor、target owner/project、规范canvas workspace ID及grant_generation。task与项目使用真实FK，actor/owner不交换；owner代次0、editor正代次，原授权不被updateCloudTask或终态结果覆盖。
- `createBillableTask`及下层`createBillableCloudTask`接受可选canvasPublication，来源仅为服务器authorizeAgentContext的document结果；调用者请求中的同名字段、owner或代次不得复制。只在真实canvas及两个精确别名时传递，owner私有chat/workflow不建立canvas发布授权；legacy自定义context无该字段时保持原合同。
- 原幂等键锁和existing任务重放逻辑先行。已有同键同digest任务直接沿原语义重放，不重验为新任务、不补发意图、不用新代次覆盖旧值；冲突digest仍沿原冲突合同。即使再次授权代次变化，也不能把原grant1变为grant3。旧任务没有意图就保持没有，个人项目后来开启协作同样不追溯授权。
- 新任务在原计费事务内、扣费前锁住并复核active actor/owner/project、当前准确grant、项目enabled和实际文档存在。授权快照中的actor/project/owner及workspace必须精确一致，跨用户/项目/错误代次均失败。准备结果绑定同一client，仅用于本事务持久化；不跨请求缓存或当外部票据。锁不跨任何模型/provider I/O。
- 任务、本人扣费/consume流水、发布授权记录在同一COMMIT提交，任一失败整体回滚。费用0也保存授权；已有正常私有任务及无canvasPublication路径不依赖新表。原用户结果/replay和退款语义不改，不能因发布权限失效让历史结果不可读。
- 新授权错误固定`CANVAS_TASK_PUBLICATION_FORBIDDEN`403、`CANVAS_TASK_PUBLICATION_CONFLICT`409、`CANVAS_TASK_PUBLICATION_UNAVAILABLE`503，无SQL/URL/cause。事务回滚失败须销毁连接。新增表必须通过迁移创建，不能运行时DDL或静默缺表降级放行。

真实PG测试覆盖同键20并发只有一个task/扣费/授权、重放不升级代次/不补发、跨项目/撤权/停用/全局关闭全回滚、故障事务、0费用、缺迁移拒绝、授权到COMMIT与撤权的交错；实际service/route消费者验证server scope传递与actor不变。此表只记录创建时意图；下一完成回写仍需重读本人终态任务并按冻结代次在最终文档事务复核，不能仅持有记录就发布。

## 6. 验收标准

1. 真 PostgreSQL 中两用户两项目验证 owner/editor/仅 presence/匿名/跨项目/撤销/禁用/归档权限；票据不可重放，数据库只含哈希。
2. 两浏览器真实 socket 对不同素材同时编辑后收敛；同素材冲突确定性收敛；刷新、断线、旧消息、进程重启与两个实例通知丢失后均恢复已确认状态，不复活删除项。
3. 既有 legacy/shadow 项目开启前后素材与资产版本一致；迁移失败原状态可用；协作项目不被旧 owner 自动保存覆盖，非协作项目保持原行为；节点与对话仍能读取共享项目的权威素材结果。
4. 上传/生成/删除的项目作用域与账务隔离，恶意跨项目版本引用、超限更新、过期授权和临时媒体 URL 均失败；原始素材不被覆盖。
5. 聚焦 RED→GREEN、独立真库、完整 Vitest、`pnpm validate`、受保护基线、生产构建、严格 NFT、Chromium/Firefox/WebKit 与 320/375/393px 本地矩阵逐项留证。只有 exact-main Coze 同源 `101`、重启/多实例、CI 和发布前真实账务门禁齐全后才考虑阶段云端关闭。

本阶段不实施手绘草图转代码，也不更改 `stable` 或整体复制 V5.8.8 donor。
