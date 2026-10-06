# 协作画布批量生成准入设计

## 范围与完成标准

接续已验收8Cb3e，本段接通真实`POST /api/generate`的当前submitOnly批量分支（非旧wrapper、非Skill prepaid），形成请求→本人原子扣费/任务/冻结意图→既有完成发布→规范画布结果的可测试闭环。不是只添加无人调用的helper，也不把本段当所有生成入口完成。

沿原8Cb剩余范围，旧wrapper、直接生成、universal、edit/image-edit/video、Skill可信父子继承另段接续；UI/撤销、8D–E、Task9、草图及发布仍开放。Pear移出范围，原PSD保留。不得通过禁用上述现有模式宣称完成。

仅本地main；不stage/commit/push/安装/Coze/付费/业务库/部署，stable/donor与七保护文件不动。保留既有未提交修改。用户自主执行覆盖技能默认反复确认、新worktree与提交。测试只用显式loopback新专用库及产品import前唯一mkdtemp媒体根，远端模型和供应商stub，真实任务/账务/发布/PG不可mock。

## 方案与不选方案

选择复用`createBillableTask`/`createBillableCloudTask`已有原子事务：同一slot的任务、本人扣费、consume流水和`wujie_canvas_task_publications`意图一起提交。协作document批量分支不再先recordSubmitted后delayCharge；非协作/无项目/非canvas与Skill分支保持旧逻辑。

不选为当前document批量继续增加pending创建→延迟charge的跨事务协调：其正/零费用双分支、已存在pending及独立恢复须额外围栏，而现有core事务已提供所需原子性。也不选择完成时重新授权、把grant写到可变submission或新建批次/账务状态表。其他入口今后可按自身语义复用core或补原延迟事务，但不能据本段宣称delayCharge所有调用已覆盖。

## 真实入口与收费身份

1. 保留并接收`authorizeGenerationProject`的返回值。仅`kind=document`、目标workspace为canvas且非Skill预付费的当前批量分支调用新编排。缺assetWorkspace沿此路由当前canvas默认；显式chat/workflow不自动变成canvas。`assetWorkspaceId`仅允许projectId或canvas:projectId，目标以已授权项目为准。
2. 新模块`src/lib/collaboration/canvas-generation-batch-admission.ts`仅编排已有core创建、原任务读取/幂等及原失败结算，不复制SQL账本、供应商循环或媒体发布。输出仍用既有CanonicalGenerationSlot及原batch响应/after kickoff；不改客户端响应协议或返回临时未持久taskId。
3. 费用取原`calculateConfiguredCreditCost`按确切provider/model/quality/resolution的单slot值，零费用仍走同一core创建事务并冻结意图；不向project owner扣费。不由请求body的_skipCredits/_skipCloudTaskPersistence绕过新收费/持久化；这些字段用于已可信内部执行的原分支，本段普通document批量请求带此逃逸组合须在付费供应商调用前明确拒绝。Skill上下文不套第二次消费，维持其原分支，可信继承留后段。
4. 输入模型、供应商能力、数量、透明背景、参考图约束与已有默认选择均保留，不重做已验收provider/model功能。新增intent提案输入只表达用户意图，不接受owner、grant、冻结transform或任意命令key：parentVersionIds取body.assetParentVersionIds（未提供为空），projectionMode取body.assetProjectionMode（默认derived），append选区取body.assetSelectedEntityIds（未提供为空）。由既有严格proposal解析及规范文档解析校验；无效类型、重复/越界、错scope版本在任何新消费前拒绝。当前batch只append，replace在本段拒绝，后续显式UI替换另接。
5. 若调用者同时声明父版本与参考图，二者必须经服务器规范媒体身份匹配，不得把任意URL冒充已授权父版本。复用现有来源/上下文验证方法或最小适配，保留真实image kind、ready、owner/project和规范placement对应；不能放宽公共媒体下载器。来源验证/身份匹配必须在转换raw参考URL和供应商调用前完成。单纯外部/data上传参考而无版本声明沿旧输入合同，不凭URL猜造父系。若既有来源接口不足，先报告具体缺口，不能省略此合同。

## 幂等、冻结批量布局

采用原batchId/slotId/slotIndex和客户端idempotency-key；有key的子key保持`${key}:${slotIndex}`。无key由服务器为本请求生成根key，不能宣称无key跨请求幂等。requestDigest覆盖原规范生成参数以及输出数量、canvas目标、父版本顺序、projectionMode、选区身份，不能让同key改发布意图却复用原任务。费用/模型均来自服务器已有准入，不采客户端价格。

按slotIndex递增处理。每slot使用原createBillableTask，任务type generate-async、status processing、provider/model/session/message/slot metadata与原持久恢复payload保持。重复返回core的真实task.id，不使用本次候选随机taskId。同key20并发只产生每slot一任务/一consume/一意图；已完成/取消不重复激活，不发新供应商请求。

布局的第一slot经既有proposal→规范文档解析冻结。后续slot必须从第一slot真实task/publication中读取同batch的原意图，不再依据变化后的画布计算；x=anchor.x+slotIndex*anchor.strideX，其余attach transform及ordered parents/projectionMode保持。每slot单图；若供应商后续异常多输出，3e按该task内outputIndex原合同处理，本段不伪造跨task输出顺序或截断真实结果。

允许在`CanvasTaskPublicationInput`增加服务器内部`batchPlacement?: { anchorTaskId: string; slotIndex: number; slotCount: number; requestDigest: string }`，仅后续slot使用；route不从body反序列化此字段。core传入自身requestDigest供校验。prepare函数在项目锁前读取并锁定anchor task/publication，核对actor/project/workspace、同一grant、真实task.request_digest、payload的batchId/slotIndex=0、slotCount及当前slot边界；当前slotIndex/slotCount由服务器batch生成器提供。anchor必须是本次相同根幂等批次的真实第一任务，不能仅“该用户某个task”就行。准备能力仍由WeakMap产生；不能接受plain frozen intent或调用者transform绕过原来源检查。

明确身份传递：core给prepare另传可选`taskIdentity: { idempotencyKey, requestDigest, batchId, slotId, slotIndex, slotCount }`，值从本次core自身输入及将持久化的submissionPayload提取，不信任publication字段的同名声明。后续slot必须有此身份；从当前子key按准确的末尾`:${slotIndex}`取得根key，再要求anchor的原顶层idempotency_key严格等于`${root}:0`。同时要求当前slotId等于原batch生成器规则、anchor为slot0、batchId/slotCount一致。不能只检查digest或可变payload相等。

重放检查不重算意图：非终态复用任务在短事务中按task→publication→project顺序检查原冻结grant、当前权限和原意图存在；不允许core现有早返回让新编排跳过此检查。历史无意图终态仍可经原GET读取，POST只有原幂等digest确实匹配才可复用；不得为了兼容旧digest删去新请求身份字段。独立来源上下文验证返回的授权代次必须与前门准入一致，不能在regrant窗口升级权限。

从anchor读取的intent须严格解析，原parents仍同scope/ready/active；共享父系与原grant在创建事务内复核。不要求原选区坐标仍相同，也不因来源摆放已移动就重新算布局。若来源摆放已删或换版，本段新增slot的准入明确拒绝（不会补扣），已存在slot历史不重写。所有offset结果用原media command schema检查边界，溢出或非安全slot索引在该slot写入/扣费前拒绝。首slot与后续slot的输入requestDigest/批次身份不能只来自可变result字段：结合原顶层request_digest及原user/idempotency key核验。

首个RED后的接口裁定：当前intent未保存选区原版本，无法区分“同一entity换版”与单纯移动。允许在既有version:1的冻结intent增加严格可选服务端字段`selectionSnapshot?: readonly { entityId: string; placementId: string; assetVersionId: string }[]`。仅本次batch通过core taskIdentity识别后请求resolver冻结它；第一slot由实际规范placement查询按proposal选区顺序生成（无选区写空数组），不从body/payload接收。普通Agent和历史intent可缺此字段，原3d行为保持。新batch的anchor必须有此字段，缺失不自动补齐；后续slot逐一检查同owner/project的规范活跃placement.id、entity_id、asset_version_id与快照严格相同，再复制原快照与offset transform。可移动/缩放/换zIndex但不许换版本/删除/偷换摆放身份；父系仍独立校验。该字段留在不可重写的publication_intent中，不在可变submissionPayload保存授权真相。解析后深冻结每项及数组；严格schema只声明此字段，不使用passthrough或放松其他字段。只读校验需复用规范来源查询，不能为了校验来源再次计算会因当前坐标溢出而失败的新布局。现有完成与恢复读取应兼容该可选字段，命令/引用合同不改变。

新slot不得借“旧pending无publication”自动补授权；需要继续创建缺失slot时，anchor必须有完整可信intent，且原grant和当前权限一致。全部已存在的历史终态可读原结果，不升级intent、不重新收费；需要实际执行/补创建的非终态重放必须复核原意图与当前权限，不把前置当前新grant当旧任务可继续的依据。数据库错误不按无intent降级。恢复GET及原完成出口继续走3e稳定task/output命令，不创建第二套挂图键。

## 原子性、失败和恢复

每slot事务内grant检查先于本人credits变化，沿现有core幂等锁→task→publication/项目权限→credits/创建/持久意图，不持事务做供应商/文件IO。后续slot读取anchor的锁必须先于项目权限锁，避免与anchor完成发布的task→project顺序倒置。不得修改全局task状态机、退款规则或原准备深比较来解锁。

批次供应商kickoff只在全部本次所需slot准入成功之后发生。若中间失败，使用既有原子失败结算只结算本次新建且未终态的slot，退款至多一次；不取消其他请求复用的既有任务，不改已完成终态或重置其结果。返回原已有task身份和明确失败，不误报整个批次成功。已取消的第一slot且后续slot缺失不能继续借该anchor开新收费任务；用户需新幂等key重试。无需跨slot新状态表。

独立首审I1裁定：本请求曾新建不等于仍拥有独占补偿权。复用既有core revision/settleFailedTask.expectedRevision围栏：本批次显式非终态重放在原锁与授权校验成功后，事务内推进该task revision并返回真实新revision，作为并发请求已接手的持久证据；终态不改、非batch不改。编排保存本次创建返回的taskId+revision，确定失败只用该原revision调用既有结算，原事务比较不符即不取消/退款，不能读取最新revision来刷新补偿资格。不得只依赖是否领取lease或在事务外先读状态。若实际接口存在更深缺口须先报告，不扩大通用退款算法。真实交错须包含A创建slot0→B同key完整准入成功（覆盖未领取lease与已派发）→A在slot1 COMMIT前确定失败，B两任务/intent/两consume保持且零退款，并通过原恢复/完成；只有A且第二slot确定失败仍退款一次。无新批次表或第二状态机。

独立首审I2裁定：分离严格提案/完整稳定请求身份与实时来源准入。允许在媒体转换/下载和实时parent检查前，以当前actor/project访问权、同根全部slot顶层完整digest及实际任务身份确认全部历史终态后，只读返回原IDs/结果。终态不会重激活，不需要原素材当前仍有placement或ready；任何缺slot/非终态路径仍在媒体读取及新消费前完成原来源、原grant、raw reference绑定与intent校验。同key改变任何原请求身份仍409，不得从旧可变payload补造新请求digest。若需把document batch digest的reference部分改为纯规范raw输入身份（而非媒体转换产物），只影响本段未发布document batch，采用同一个纯身份构造函数用于首次准入与重放；非document原合同保持。不得删除安全来源检查、放宽历史GET或借此扩大供应商路径。真实POST对照须覆盖全部completed/cancelled后父placement删除或version unavailable仍原key同IDs、零IO/kickoff/账务/发布变动，以及缺slot/非终态相同来源故障仍拒绝。

撤权/重新授权、actor或owner停用、项目归档/关闭协作、全局关闭、来源变更、数据库/COMMIT故障均保持原错误与未知提交处理原则；不以“重试”新扣费或强改任务身份。新API错误按既有GenerationProjectAccessError/CanvasTaskPublicationError/IdempotencyConflictError/InsufficientCreditsError映射400/403/409/402/503，原始内部SQL/凭据不得外泄。

真实第二slot COMMIT确认丢失RED后的接口裁定：允许core仅为显式document batch产生服务器可信的提交结果未知错误类型/标识（安全code、503，不携带SQL/凭据），区分提交前确定失败。新建与复用两条事务路径都在发出COMMIT前记录提交阶段；COMMIT发出后未得到成功确认的异常保守归为未知，之后ROLLBACK成功也不能证明此前未提交，连接必须丢弃而非放回池。该标识不得从请求body构造，非batch调用保持原合同。编排层遇此标识不结算、取消或退款任何已知slot，不将候选ID冒充已持久化ID；仅返回安全错误与此前已确认的partial IDs，不启动供应商。调用方以原根幂等key重试，经既有准入/权限复核恢复实际任务，不创建第二次consume。提交前确定失败仍沿原仅结算本请求新建任务规则。必须保留首slot与第二slot的真实PG丢ACK测试，第二slot故障后两任务仍processing、两consume、零refund；同key恢复相同两任务且账目不增。该裁定不新增状态表或修改通用账务算法。

## 必须证明的行为

1. 首个RED调用真实POST，owner/editor有真实授权、配置价格单图7分、2 slots；stub认证/管理员配置/模型服务/after派发与外部供应商，真实任务/credits/publication/完成回调/文档不可mock。原实现应因无可信意图/无规范发布失败，不以缺表/函数/夹具错误当RED。GREEN后两个本人任务、−14一次各−7，owner账务不动；真实完成回调各新增唯一规范版本/命令/摆放、引用和固定手算位置。
2. 零费用仍两完整intent且账目零；20并发相同key总tasks=2、consumes=2、publications=2，重放返回相同IDs；同key改数量/父系/模式/选区/参数拒绝，账目不变。私有/无项目/显式chat/workflow/Skill原分支不意外走此收费或发布。
3. 首slot后移动来源/其他用户新增结果、故障后同key重入，第二slot仍来自原anchor位置；已存在slot不重算。原source bytes/placement不变；derived/revision语义保留，revision不自动replace。批次身份、actor/project、slot计数/digest/anchor篡改或伪造权限在消费前拒绝。
4. 前置授权后/原创建事务等待期间撤权或regrant、禁用/归档/停用、父版本变坏、DB故障：无错误新扣费/任务/意图；已有成功结果保留。中途第二slot资金不足/意图失败按原结算至多退款一次、不触其他请求复用任务；无kickoff，错误及partial IDs可追踪。
5. 真实POST→真实完成→GET恢复重放，跨用户/项目隔离，task/output唯一命令；已完成/取消重放不会再次调用供应商。未知COMMIT按旧core合同不伪造失败结算。旧API响应、批次恢复、透明图片、reference参数持久化及原provider契约定向回归。

本段最终只运行受影响新PG/实际路由与现有core/intent/consumer套件、非增量tsc、变更TS ESLint和主控保护门禁；全仓/浏览器/云端仍属后续。必须保留原始失败→成功、每轮命令/输出/时间/exit、修前后SHA、资源及未验边界，独立审查后才能关闭本段。
