# 图像编辑持久执行与可信父预付接入设计

状态：完整链路仍为架构调查稿，未完成实施或验收。角色发布j4a、302请求身份j4b、共享供应商边界j4c、302终态屏障j4d、供应商数据库阶段组件j4e、辅助真实提交接入j4f及蒙版收费前准入j4g已分别完成本地验收，不等于完整执行器完成。来源与费用决策见[专项裁定](2026-09-28-image-edit-source-and-quote-decision.md)；后文旧“费用决策边界”保留调查时的取舍背景，不能单独当作当前未决状态。其余合同用于防止后续仅补一个入口而误称完整链路完成。

## 目标与范围

在现有 cloud_tasks、任务租约、积分账本、Agent operation、资产版本和协作文档体系内，接通完整 `/api/image-edit`。覆盖 erase、mask、inpaint、extend、outpaint、upscale、removebg、remove_background、multi_angle、display_decompose；同时覆盖供应商同步图片和异步任务。保留无限画布、节点、聊天入口及旧任务读取，不以关闭自动候选、降低结果质量或删除旧功能换取测试通过。

已完成j1项目准入、j2精确授权模型计划、j3 Agent父原子收费不重做。Pear专项验证移出范围，PSD核心保留。十动作中的display_decompose是当前普通图像接口的拼板输出，不因名字推断为Pear分层测试或多层PSD交付。

本阶段本地main-only，禁止提交、推送、Coze、真实付费、安装或业务库操作；保持七保护文件及旧数据。GPU与神经模型强改CPU不引入。现有非协作旧本地功能不能误删；新协作执行只能采用管理员远程模型及受控Sharp等非神经CPU处理。

## 方案比较

1. **采用统一持久入口、提取现有执行分支。** route负责认证/校验/准入/响应，执行器负责同一任务的提交、恢复及完成。将现有协议与后处理迁移为共享适配器，不复制一份完整route。
2. 不采用仅替换getSessionUser：内部父已付调用会再扣一次；同步结果、未知提交和恢复仍没有任务身份。
3. 不采用独立编辑队列/积分账本：与现有取消、退款、租约和资产投影形成两个权威。执行checkpoint属于既有任务result，不另建供应商状态机。

## 持久合同

### 准入与响应

新请求统一从成功鉴权取actor。internal须读取实际managed user，不以头中admin权限代替授权；不能再次用Cookie选收费人。先校验动作、参数、安全、项目与来源，再选择已授权精确模型计划、确定费用/父预付证明，最后在原子事务保存任务与发布授权。同键重放必须严格核type/actor/project/requestDigest；已完成同上下文先重放既有结果，不重新发送，不因新配置变动擅自失败或退款。

稳定本地ID建议前缀 `image_edit_`，供应商ID只放remoteTaskId/checkpoint。同步返回也必须先有同一持久任务，经过完成事务和结果投影后才可返回成功；旧客户端仍可收到imageUrl/maskUrl，新增taskId/status供恢复。异步返回taskId/status后，poll只能读取服务器descriptor，不接受客户端engine/model/key改变新任务执行。旧taskId保持原poll兼容分支。

### 请求描述符与素材

按明确白名单冻结原action和规范action/editMode、原始图/蒙版规范引用、有序父版本、项目/会话/消息、当前选区及发布方式、prompt/originalPrompt、尺寸/裁剪/扩展、角度/旋转/倾斜/缩放、引擎、放大模式/格式/压缩和蒙版是否交付。默认值在准入时归一化，恢复不读取新的UI状态。摘要包含全部执行与归属语义，不含随机请求ID、凭证或客户端role。

持久模型计划只含精确provider/model、协议档案和非敏感参数；API Key保持请求内，恢复按已冻结providerId读取凭证。不能把整个provider对象或任意advancedParams原样写result。描述符读取做版本/大小/字段与摘要校验，响应只返回公开投影。

协作输入必须用原授权版本与准入fingerprint，在每次媒体读取、远程发送和最终发布前复验。非协作dataURL需转受控持久媒体后再进入可恢复任务；blobURL不能服务端恢复，应由客户端先上传。二进制不进入Yjs。来源准备失败不得留下扣费任务；准备成功而事务回滚的媒体沿既有outbox规则处理，不扫描删除用户文件。

### 实际发送、恢复与取消

租约保护每次实际transport调用。发送前把候选、endpoint、请求语义摘要及started状态持久化，确认明确未接受的响应才记录rejected并允许下一候选/合法协议变体；已接受存direct输出或remote ID。超时、断网、响应读取失败、成功但不可解析且无否定证据统一为submission-unknown，保持原任务待核对，禁止盲目发下一候选或自动退款后重发。

`fetchWithV1Retry`与编辑→生成/chat兼容fallback均必须走相同transport钩子。一次外层helper调用不等于一次实际请求。现有helper提供transport/skipV1Retry/propagateErrors，可限定新durable调用而保留旧消费者；明确不支持端点的拒绝仍允许按原能力回退，不全局关闭兼容行为。

已接受remote轮询无需重新生成。完成后持久保存原图/蒙版crop信息、输出及后处理checkpoint；进程重启继续精确蒙版合成/RemoveBG验证，不使用内存registry和请求engine替代。失败、显式取消与迟到结果由同一终态/退款服务裁决；不能根据网络异常推断供应商未执行。质量失败不得退化成成功返回原图。

## 可信父预付：一套数据库证明贯穿全程

锁顺序沿用parent→execution lease→operation→child。创建、local accept、实际dispatch、暂停结果暂存及三个终态入口都消费同一证明；不是只验证一个internal头。

- Skill父：`agent-run`、原冻结step/modelBindings、精确tool/step/digest/operation/idempotency和执行generation。
- Agent父：`agent-edit`、私有wrapper admissionVersion=2、有效V1 descriptor及run.created continuation摘要、真实consume关联/金额或明确配置免费。旧漏扣零费用wrapper和旧无关联consume不能升级成可信预付。
- 两类父均要求同actor/project、processing、未退款，活跃lease/fence；子task creditCost=0/not-applicable，唯一键沿原operation key的 `:0`，已有同子重放不重建。
- 证明不授予任意工具/URL：Agent工具必须在有效执行记录中，模型符合父绑定；原始来源或前序同run已完成operation/child输出须有精确身份。变化后的finalImageUrl不能继续附原sourceVersionId冒充同一输入。
- Agent upscale/remove_background改为本地准入→recordLocalAccepted→子执行→monitor；不得先beginSubmission再local accept。现有直接远程image_edit保留远程accept/reconcile语义。
- `cloud-task-storage`的update/transition/lease-complete三条入口保留单一父完成屏障；父暂停暂存而不发布，取消/退款阻止迟到完成，恢复不重发。不能只另起provenance键绕过旧SQL屏障。
- Agent中间子结果只交父，父最终结果发布一次；Skill沿原质量检查/交付合同。交付策略来自服务器证明，不接受客户端skipPublication。

## 主图与蒙版的独立结果身份

新编辑结果清单固定primary outputIndex=0；请求时冻结的可选mask为1。两URL即使相同也不通过Set合并角色，URL变化也不改变序号。未请求蒙版不生成隐含画布输出。请求了蒙版但输出缺失时标识未完成/质量失败，不用主图充当蒙版。

每项带服务端冻结的父系/投影/摆放意图：primary采用请求的derived或revision/replace；mask始终独立derived+attach，不能继承primary的revision资产族。最终图像尺寸与摆放均按规范引用交付。以下三处必须同改并在同一授权复验下工作：

1. `task-publication-output.readSnapshot`按显式清单建立role/request及幂等身份。
2. `document-media-source.loadSource/persist`选定同一输出URL、父系和资产族。
3. `document-media-import.finalTransaction`按同一role写版本/父系/模型身份与current_version_id。

primary已完成、mask未完成的恢复保持同一主图和独立mask身份；同任务自有revision head例外只能证明已发布primary，不许可mask覆盖它。手动采纳、自动完成、poll、恢复都走相同capability；不将公开result中的自报role当授权。

## 费用决策背景（已由专项文件裁定，实施仍未完成）

现有管理员exact provider::model定价会覆盖image_edit等动作默认价，因此跨候选不一定等价；现有旧route在执行前只按requested pair扣一次，并不证明费用按最终accepted模型正确。现有chargeCloudTaskCredits只收费pending任务，不是重定价工具。

可选合同的真实取舍：

- 一次冻结服务报价：保留单次扣费，自动回退不追加扣费，账务记录明确报价依据与实际执行不同。必须明确这是报价合同，不能把它宣称为按最终模型价格收费。
- 按最终接受模型收费：要在发送前保护余额且未知提交不丢账，涉及预留/结算或分次尝试账务。现有单次扣费API不能直接满足；不擅改历史消费、不先退再重扣同一任务、不暗加最高价预扣。
- 仅同价候选自动回退会削减当前能力，不采用它作为技术捷径。

专项裁定选择一次冻结服务报价，明确不把它宣称为按最终模型价格收费；实际接线、用户告知与真实账本验收尚未完成。父已付场景与固定显式模型不因此失去设计推进空间，但完整验收必须覆盖自动模式，不能把它永久留在旧收费路径。

## 文件职责与后续验证边界

后继完整执行覆盖的源码补核（本计划SDD `task-8cb-source-billing-evidence.md` 125–128）：j4f已给`submitDedicatedRemoveBg`与`enhanceViaAI`增加受控发送/接受模式，二进制已通过真实存储转为可恢复URL，不灌入JSON。仍需由正式统一执行器传入同任务phase，不能把增强当纯CPU或依靠旧失败catch推断未接受；旧route catch仍可能吞停止错误，必须按started/rejected/accepted事实分流。`postProcessAIRemoveBG`末级调用rembg神经CPU模型，新协作执行须隔离该回退，仅复用允许的像素处理，旧非协作入口不删除。这些调用者/恢复/CPU隔离仍为开放边界，不重做已完成j4e/j4f组件。

### Task8Cb3j4f：专用去背景与画质增强的真实提交接入

状态：本地限定完成（2026-09-28），未提交/部署。专用RemoveBG与二次增强实际POST已消费j4c/j4e，真实持久化/接受顺序、身份冻结、取消、未知不重发、接受后恢复事实与旧兼容均有真实PG矩阵。首审I1响应体提前无界缓冲经7项业务RED→GREEN修复，最终十一suite505/505零跳过、非增量tsc及六路径eslint通过；McClintock fix1复审Spec✅/Approved，无新增Critical/Important。主控final-gates UTC21:55:21.017–23.906 exit0核六候选前后/current/02副本SHA、33项既有/七保护文件、38保护零warning、refs/index和隔离PG零其他连接/测试schema；仅独审后许可RemoveBG准确路径。M1预期日志噪声留最终全分支。原始report、fix1-review与controller-final-gates位于本计划SDD，两代理已关闭。复用既有队列/存储，不改收费；正式route仍由后继统一执行器接线，本段完成不能解释为十动作恢复已完成。

专用RemoveBG的requestOptions新增可选`execution: ImageEditProviderCallOptions`；提供时，首次await前捕获provider所需标量、解析后的配置、signal、timeout及已绑定的call。验证execution.providerId与provider.id相同，selectedModel（或selectedModels首项）为非空精确模型。真正POST走call.transport，解码与既有透明质量门禁通过后调用现有persistAssetBytes保存PNG/WebP，再await call.acceptImage({directUrl:file.url})。DedicatedRemoveBgResult新增可选directUrl，在受控成功路径返回同一已接受的受控媒体URL与原buffer/mimeType。二进制不写JSON；不自行创建asset版本或发布。保存/接受失败不得返回成功、不得删除可能已被检查点引用的制品，也不新建清理服务。明确拒绝仍允许旧RemoveBgProviderError交调用方；未知提交、成功响应解码/质量/持久化/接受故障统一以ImageEditProviderBoundaryError停止，不能包装成可继续候选的普通错误。

enhanceViaAI保留原五参数，新增第六可选`{execution: ImageEditProviderCallOptions;signal?:AbortSignal}`。受控模式要求显式非空model及有效admittedProvider，provider.id与execution.providerId、给定providerId一致；在首次await前捕获目标尺寸、baseUrl/key/model/身份与边界方法，不回查新的管理员配置。生成POST及合法/v1兼容走call.fetchWithV1Retry；合法taskId或directUrl一经解析先await acceptImage，再开始GET轮询或本地save-image。GET媒体读取、GET任务轮询、内部save-image POST不是新的供应商生成，不能经过提交phase。受控模式不允许无效接受、网络未知、接受落盘失败被原图fallback吞掉；已接受后轮询超时/失败/取消同样抛出停止错误但保留accepted事实，交后继executor按远程ID恢复，不据此重发。明确未接受的HTTP拒绝可返回enhanced:false；它不是任务成功的结算凭证。

两个入口的调用方signal必须覆盖发送与接受之间的取消检查，增强还覆盖轮询/保存；异常外层不能吞取消。无execution的老调用保持原接口及原图fallback/RemoveBG错误合同。新受控模式的错误公开message不含密钥，检查点不含provider对象/请求体/Buffer。真实PG测试消费这两个真实helper及j4e，媒体持久化使用真实本地磁盘；仅外部HTTP、配置凭证来源和S3外部边界可替身。验证started发送前、accepted保存后、重开不发、未知不发、写故障/取消/身份冻结、正常拒绝与合法兼容；保持账本、任务其他result和终态不变。新文件不能取代旧回归。

回归基线修订：主控在未改变的j4d route上运行`quality-enhance-resolution.test.ts`，2案中1案因要求过时的`modelStr/effectiveProviderId`源码字符串失败；当前早已使用已授权enhanceTarget。仅允许将这个旧测试文件改为真实enhanceViaAI HTTP请求的2K/4K尺寸行为测试，不mock被测函数或尺寸计算。原“最终精确尺寸”保证由既有`image-edit-model-execution.test.ts`真实POST+Sharp的两案（允许增强/不允许增强，均输出64×64）继续承担，新增到本轮完整回归、保持文件只读。不改route、不重新引入未授权模型，也不将该历史断言失败算作j4f产品RED。

独审I1修订（fix1）：首版受控RemoveBG调用共享call.transport会在旧32MiB检查之前无界arrayBuffer；DBphase对非OK还会先clone().text()分类。因此只在RemoveBG解码处或phase返回后检查仍不能保护首次读取。沿原协议增加可选服务器响应字节上限，不新增状态机：`ImageEditProviderCallOptions.responseMaxBytes?: number`，`ImageEditProviderExecution.transport`在原三个参数后新增可选第四`responseMaxBytes?: number`。未提供时保持原三参数调用及行为；提供时必须为正安全整数，首次发送前校验并捕获，RemoveBG受控调用固定32*1024*1024，调用方不能调高。两处共同复用boundary模块导出的`bufferImageEditProviderResponse(response:Response,maxBytes:number,signal?:AbortSignal):Promise<Response>`：phase在底层真实HTTP返回后、任何非OK正文分类或成功交付之前执行；call在边界返回后、自己的完整缓冲之前执行以覆盖其他边界实现。

有界读取先检查Content-Length，明确超限不读正文并取消流；无长度/虚报较小长度仍逐chunk计数，超限立即取消/释放reader并停止，不读到EOF或缓存后才判断。取消和读取失败停止，保留原status/headers与有效正文语义，不以截断正文作为成功。该错误发生在started之后，必须保持unknown、无accepted、无后续POST；包括超限非OK响应，不能先标rejected再允许转投。仅新增这一个响应上限合同和必要的共享读取函数，不顺便改变无边界旧请求行为。明确授权修改boundary.ts与phase.ts这两个先前只读文件，checkpoint.ts及其旧测试仍只读；需更新精确冻结/门禁并复跑相关十一suite与静态。M1预期日志噪声列为deferred，不扩本次阻断修复。

### Task8Cb3j4e：供应商阶段的数据库提交与接受检查点

本地限定完成：Mendel独审Spec✅/Task quality Approved，无Critical/Important；真实adapter+PG聚焦80/80、相关六suite299/299、零跳过、非增量tsc与三路径eslint通过。主控final-gates UTC2026-09-27T21:05:54.846–21:05:57.846 exit0核最终02候选的独立before/after/current/review SHA、38保护0warning、七保护与j4a–d冻结源、main/HEAD/stable/空index及隔离PG零其他连接/测试schema。仅许可两个准确新产品路径，未修改旧route或adapter。一个Minor为预先打开的不同phase同时竞争发送的直接测试缺口，任务行锁与全phase started检查已审查，记录留全分支补强；不把建议写成已测。报告/审查全文/原始日志/controller-final-gates在本SDD task-8cb3j4e-*。后继正式准入、beforeDispatch授权回调、CPU恢复、父预付、费用、poll/取消/发布及专用二进制/精修阶段仍未接线，不能以本组件通过宣称全链路完成。以下合同已按本切片验收，不重派。

目标是把j4c的请求内transport/onAccepted边界变成真实cloud_tasks.result中的持久事实，作为后继统一executor的公共组件。不是复制ordinary-generation-task，也不新增队列、供应商任务表、积分账本或HTTP入口。本段不改route或启用新收费合同；实际消费者是现有共享适配器，正式route/poll/CPU后处理接线仍须后继完成。此前单纯回调测试不能替代本段真库证明。

一个phase只允许一个语义结果：视觉分析、图像生成或一块图像的单次放大。视觉→生图必须分为两个phase；不能把vision accepted当整个编辑任务完成。phase输入由可信服务器提供`phaseId/inputDigest/targets`，inputDigest是规范输入语义的SHA256，不是随机URL或请求ID。targets为有序、精确providerId/modelId/kind白名单；凭证不进入phase或result。同task同phase重开必须校验相同输入摘要与targets，变化冲突，不能覆盖旧记录。

`openImageEditProviderPhase`在已有任务和已有lease上运行，不自行创建/扣费/认领/续租/结算/发布任务。固定核对taskId、actorUserId、projectId、task.requestDigest、processing状态与同owner未过期lease。只支持image-edit/upscale持久任务；匿名、缺少合法SHA256摘要、错误actor/project/type、无lease、过期或终态一律拒绝。租约时间以数据库clock_timestamp为准，在真正写入SQL条件中再核，不用先读再无条件update。变更只合并私有`imageEditExecution`检查点，保留task其他result、收费字段和业务状态；可增加既有revision/updated_at，不改账本。锁仅持有数据库操作期间，不能持锁执行HTTP或beforeDispatch。

检查点版本1包含绑定的requestDigest和phase数组；每phase持有上述规范输入与targets、实际attempt列表。每次HTTP实际发送先原子追加started，记录精确identity、去除userinfo/query/hash的endpoint、方法和实际请求体SHA256（不记录请求体或headers）；DB提交成功后才允许远程调用。每个phase的尝试顺序及started→rejected/accepted转换必须由同一lease和attempt身份保护，不能依赖内存最后一项覆盖并发写。任何phase仍有started时禁止同task发出新的提交；这是未确认提交，不表示允许换模型。

beforeDispatch为必填服务器回调，后继调用方负责原授权/来源/父证明复验。本段证明它在实际发送前被await，失败时零远程请求；它本身不是授权证明，也不能由客户端注入。外部signal必须与adapter提供的signal合并，取消或lease失效不能被兼容层吞掉。只接受POST提交，非POST或不可读取请求体在发送前拒绝；支持实际adapter使用的string/URL/Request及JSON/string、FormData、Blob、ArrayBuffer/typed-array、URLSearchParams体，不吞掉Request自身body/signal。请求构造可用Request克隆读取字节，保持真正传输的method/headers/body语义和同一signal，尤其multipart boundary不能与重建body不一致。

HTTP响应只在证明未接受时记录rejected并返回给旧adapter，以保留正常/v1、格式、比例和候选回退。保守确定拒绝：404/405/415；400/422且正文明确invalid request/parameter/size、unsupported size/format/parameter、required field/parameter或model not found；401匹配authentication/unauthorized/invalid API key；403匹配forbidden/permission denied/not authorized；429匹配rate limit/too many requests。5xx、408、504/524、含糊的非OK响应、网络/超时、body读取失败均不授权回退，started保留并返回submission-unknown。成功但解析失败由j4c停止，DB仍started；不在本组件猜测退款。

onAccepted只在同一attempt仍started、identity匹配、lease和任务仍有效时原子写accepted，存j4c安全标量结果；空结果、类型与phase不匹配、重复/无请求accepted、跨phase/跨identity回调拒绝。必须await落盘后才能向adapter返回。数据库写入报错不能在内存标记成功。拒绝诊断只持久化限长脱敏status/code/message；endpoint不含凭证，输入secretValues只驻内存，用于剔除已知密钥，原错误形态可保留但无密钥值；不持久化原请求body、headers、provider对象或任意advancedParams。合法accepted图像/视觉结果保留，不把direct/remote身份混淆；检查点总体限16MiB，超限或损坏必须停止而非截断/清空旧状态，非JSON安全值拒绝。

重启后重新open只读既有事实：本phaseaccepted返回同identity/result（无boundary、不再次调用供应商）；任意phase存在started返回submission-unknown（无boundary、不能重试或退款）；仅已有rejected或新phase可返回ready边界，允许在已证明未接受的情况下继续尝试。ready实例过期后也不能绕过DB复验。lease失效/取消后的迟到onAccepted不能更新结果或终态；显式取消及最终发布由既有服务/后继executor处理。不得把rejected错误重试说成未知提交的恢复。

新增组件在server-only模块中；语义验证/SQL原子存储与transport适配分两个文件，接口在plan固定。测试必须真实PG+真实共享适配器，默认所有未声明网络deny；真实创建收费任务/lease后测试发送前started、接受后accepted、进程式重开（重建边界且不共享内存）、响应丢失、存储故障、租约抢占、取消、两调用并发、明确拒绝后合法fallback、vision→image两phase和精确身份/脱敏。不得以mock数据库或仅手写onAccepted调用矩阵代替实际适配器消费；非法身份等纯合同边界可以直接调用组件。

### Task8Cb3j4g：蒙版编辑先准备、后收费

**当前结论（2026-09-28）：本地限定完成。** 原始真实POST+隔离PG先证明无效蒙版请求扣费，再将输入准备移到收费前。Maxwell首审Spec PASS但I1资源预算未闭合；Meitner fix1 的16suite334/334仍被Ptolemy复审判I1未解决（恢复媒体先按旧80MiB读取）；fix2将可选预算传入精确恢复reader并经Mencius限定复审I1 ADDRESSED、无新增Critical/Important。最终17suite344/344、非增量tsc通过，四改动路径eslint0error/0warning，38保护门禁零warning；仅本地源与测试候选，无提交、云端、付费或部署。恢复专项用模拟SQL/S3及真实本地文件，不冒充恢复路径的真实PG端到端。此项仍不替代descriptor、来源权限/指纹、可信父预付、CPU恢复、费用合同或三工作区接入。以下是实施前的历史合同及两轮修复记录。

旧入口在consumeCredits之后才检查editMode、获取并解码原图/蒙版、对齐尺寸、扫描非空区域，多条错误直接return，可能留下一笔没有任务结果的消费。须先用真实POST与隔离PostgreSQL确认业务RED。

保持鉴权、项目授权、模型授权、原URL与提示词安全检查在前；仅对规范动作inpaint（含erase/mask别名）把现有完整准备块搬到收费之前，用route局部有类型对象缓存imageBuffer、maskBuffer、maskRawData、origW/origH、maskPixelCount与minX/minY/maxX/maxY。后面的inpaint执行消费同一对象，不再获取/解码/缩放/扫描同一输入；保留isErase分支、裁剪、模型/本地降级、蒙版合成与结果元数据。保持显式editMode要求，不根据prompt或action推断。保持nearest对齐、亮度阈值及已有错误状态/文案；本段不顺带重写灰度算法或增加通用参数政策。

无效模式、缺蒙版、原图读取/解码失败、蒙版读取/解码失败、空蒙版必须在消费之前结束：真实余额、消费及退款流水、任务均不变，供应商POST为零。异常也须发生在deductedCredits仍为零时，不能用补退款伪装无消费。合法输入保持一次旧规则收费与原图未涂抹区域保真；合法但余额不足仍402。鉴权/项目/模型拒绝在素材读取之前；非inpaint不能启动该准备过程，原始302请求身份快照与重放不变。取舍是合法请求先准备素材、再检查余额，避免重复预检查和双次读取造成输入变化；素材来源权威仍由后继完整descriptor准入解决。

精确产品写集仅route及新增真实PG测试；不改账务、数据库schema、供应商helper或其他已验收产品源，不增加队列/工具模块。真库仅固定3i2隔离库的本轮schema，远程边界默认拒绝，不使用真实供应商或付费；原图/蒙版/结果夹具使用真实Sharp，真实账务/任务/模型授权不得mock。需实际RED→GREEN、完整相关回归、非增量tsc、精确路径eslint、独审及保护/版本核对后才可关闭此项。

首次完整回归的旧断言冲突只准两份测试的最小迁移，保留原始失败日志：`image-edit-project-admission.test.ts`中的成功授权/旧收费边界fixture默认使用不需要蒙版的outpaint（同image_edit积分操作），保持逐action无权限拒绝矩阵及项目/会话身份断言；`remove-bg-provider-wiring.test.ts`将“第一个inpaint字符串”分支尾改为后段实际执行分支，保留去背景专用早于通用fallback的原断言。此二改是校准旧测试对无效蒙版先402和源码截取位置的过时假设，不允许删除断言、放宽项目授权或更改产品行为。四文件独立SHA/限定diff和完整回归须纳入复审。

#### 独审 Important I1：前置准备的资源预算（fix1，尚未实现）

首审Spec PASS但Task quality CHANGES REQUESTED：前置于扣费的素材读取/蒙版缩放/整图raw可能被余额不足的账号反复触发；共享`fetchImageBuffer`现有多来源在本次调用路径没有字节上限。原“不得增加新范围政策”在此仅对无关参数仍有效；为商业稳定性，准许本前置路径增加确定、可执行的资源预算。这会拒绝既有超过本地图片工具默认预算的图片，是明确的兼容代价，不能隐蔽缩图、吞错误或用收费代替资源保护。

预算：inpaint原图和蒙版各最大20MiB编码字节；源与蒙版各宽/高均为正且不大于2048，原图raw RGBA最多2048×2048×4字节；这些上限与现有`IMAGE_MAX_SIZE_MB=20`、`IMAGE_MAX_EDGE=2048`默认一致，若环境配置更低遵从更低值，配置更高不放宽本前置安全上限。超限在decode/resize/raw之前返回`413`和不含私有URL的`IMAGE_EDIT_INPUT_TOO_LARGE`，真实账本/退款/任务零变动、供应商POST零；未超限输入保持原行为，原有坏图/读取失败状态和文案不变。

共享读取器仅为本调用新增可选`{maxBytes:number}`，未传时保留现有行为。受限模式下`data:`在Buffer分配前检查编码长度；本地文件在读前检查尺寸且读后再检查；HTTP先看Content-Length，再以流累计字节并在超限时取消reader，绝不能先`arrayBuffer()`整包后检查；本地fallback的source-map/localhost/domain同样用受限读，超限不得被catch吞成改源重试；S3使用现有受控bounded read而非无界download，精确托管恢复读取结果再次验长。任何上限错误不得转到其它媒体来源。蒙版data URL直解支路在Buffer.from之前估算大小，解码后再验长；非data蒙版走受限共享读取器。仅canonical inpaint触发，其他动作/旧调用不受影响。

先加聚焦真实行为RED：零余额+压缩的2049边长原图/蒙版均413/零流水/零供应商，超限data蒙版在Buffer分配前被拒；受限读取器的data、HTTP声明长度零读、无声明流超限取消、文件超限拒绝，以及未传限制的旧用法正常。RED不得仅为缺新导出而失败。修后跑新增helper suite+原15suite、非增量tsc及六路径eslint，冻结修前/修后准确SHA、限定复审I1。环境/外部审批阻塞的空临时目录保留并报告，不绕过删除策略。

#### fix1 限定复审后的 fix2：恢复媒体同预算

Ptolemy 的只读限定复审判 I1 **NOT ADDRESSED**：受限共享读取器在 `recovery/` 分支仍先调用旧 `readExactRecoveryMedia`，该函数可按自身 80 MiB 上限读取/校验本地或 S3 字节，返回后才执行本轮 20 MiB 上限。首轮 334/334 及静态检查不覆盖读取前预算，不能据此批准。原完整报告与 `task-8cb3j4g-fix1-review.md` 保留。

fix2 只许准确扩展 `src/lib/asset-core/recovery-media.ts` 与 `src/__tests__/lib/asset-recovery-media.test.ts`，连同受限调用所需的 `src/lib/fetch-image-buffer.ts` 与现有 helper 测试；既有 route/真库测试仅有真实必要性并获主控裁定才可再改。恢复读取器新增可选字节预算：无选项保持旧 80 MiB 和公开服务调用；有选项时 DB 声明超限在媒体读取前报可映射的超限错误，S3 使用该更低值的严格有界读取，本地使用同一文件句柄及最多预算加一字节的有界读，文件增长不能绕过。超过预算不得退化为另一媒体来源或旧 80 MiB 读取。共享读取器必须将调用预算传入恢复读取器，并将超限映射到同一 `413/IMAGE_EDIT_INPUT_TOO_LARGE`；无选项仍兼容。先写能在旧产品逻辑上失败的恢复 S3/本地/调用者测试，再聚焦 GREEN、17-suite（原16加恢复 reader suite）、非增量 tsc、精确路径 ESLint、限定复审与保护门禁。仍不扩大为全部图像路由资源审计。

### Task8Cb3j4d：已准入302放大的原子取消与迟到完成屏障

本地限定完成：Singer独审Spec✅/Task quality Approved、无Critical/Important；真实POST+PG故障/竞态GREEN，完整十一suite387/387、非增量tsc通过、eslint0error/1旧warning。主控task-8cb3j4d-controller-final-gates exit0核同候选四SHA、七保护和既有切片、38保护、refs/index与隔离库。两个Minor为迁移子日志单次hash被标作before/after、既有lint/测试噪声；主验证前后独立SHA有效，子日志不当作独立前后证明。批准仅限此终态修补，三路径中直接ESRGAN有真实PG覆盖，其他两处有源码审查；完整持久恢复仍开放。下述合同已验收，不重新派发。

这是完整执行器接入前必须修复的现有终态边界，不替代十动作的lease/checkpoint/恢复。源码检查发现：core-v2显式302放大以upscale类型原子创建收费任务，但terminal-settlement目前不识别这种身份，cancel-task会分开执行refundCloudTaskCredits与recordCloudTaskCancelled；完成helper又忽略completeCloudTask返回false，可能把未提交的结果作为HTTP成功交付。必须先用真实POST和隔离PG故障注入确认，不能仅依据源码猜测关闭问题。

采用在原core-v2准入事务保存窄服务器标记、复用既有原子取消服务的方案。不把全部upscale/image-edit类型一概升级，也不再建结算服务。标记名`imageEditAdmission`，值为`{version:1,route:'/api/image-edit',kind:'requested-302-upscale',requestDigest}`；只由显式302 core-v2创建任务分支生成，不接受客户端标记，不给旧legacy/shadow任务补标。识别必须验证type=upscale、result/标记是非数组对象、version/route/kind准确、64位小写十六进制摘要与task.requestDigest一致。该标记只证明取消应采用原子结算，不是完整可恢复descriptor，也不授权发布或父预付。

三个显式302完成调用点必须尊重完成事务的布尔结果：只有committed才可投影或返回新图片。false时读取同actor的持久状态并返回非成功冲突响应，不抛进供应商重试/失败退款分支，不发新请求、不覆盖终态；不得泄露未提交的新imageUrl。数据库取消/退款任何一步故障必须整体回滚，取消接口返回失败，内存也不能先记取消。并发重复取消最多一次退款；完成先赢则取消409且原结果/账本不变；取消先赢则迟到POST不能返回success=true或发布新结果。旧任务、无标记任务及其他类型识别不变，历史数据不迁移。分块入口另有旧registry ID，本轮不能以修正false响应宣称双身份已经统一，后继完整执行器仍须统一。

本轮不裁定跨候选费用、不改变收费金额、不处理unknown提交或安装/部署/远程验证。所有证据必须来自真实路由/账务/SQL，仅替换鉴权凭证来源、管理员配置、远端HTTP和图像读取等外部边界；默认拒绝未声明网络。事务故障用本轮隔离schema内触发器，不能mock退款或任务存储。保留失败日志、零外部付费，测试媒体与PG实例不删除。

### Task8Cb3j4c：共享供应商适配器与可等待执行边界

本地限定完成：Arendt首审发现SSE部分坏帧I1，经真实适配器RED16失败/12控制及fix1修复，限定复审I1 ADDRESSED、Spec✅/Approved。最终13suite403/403、非增量tsc通过、eslint0error/1既有warning。主控final-gates核九SHA同候选、七保护/j4a/j4b限定未变、38保护0warning、refs/index与隔离库，原始报告/复审/日志在本SDD task-8cb3j4c-*。无提交部署、完整执行器未关闭。日志噪声/unused两Minor留全分支；大响应额外缓冲压力尚未验证。以下合同已按本切片验收，不重新派发。

这是完整执行器的前置接口接入，不代表租约、提交checkpoint、费用或十动作已持久化。选择提取现有协议实现供route与后继执行器共用；不复制route，不在全局fetch打补丁，也不全局关闭兼容回退。当前route不传新边界，继续既有业务行为；后继durable调用必须提供边界，并承担HTTP接受/明确拒绝/unknown分类与数据库持久化。

精确分工：`src/lib/image-edit-provider.ts`接收通用提交、ModelCapabilityError和候选/比例循环；`src/lib/image-edit-vision-provider.ts`接收SSE描述解析、视觉描述和视觉后生图；`src/lib/image-edit-upscale-provider.ts`接收四个原生302提交；`src/lib/image-edit-provider-boundary.ts`只实现请求内的边界类型/停止错误/安全等待，不导入数据库，不新增状态机。route删除对应函数并导入共享实现；保留动作编排、轮询、CPU处理、收费和身份摘要。

边界合同：`ImageEditProviderIdentity`为只读`{providerId:string,modelId:string,kind:'image'|'vision'|'upscale'}`，禁止API key/完整provider/任意advancedParams进入identity。`ImageEditProviderAccepted`为只读图片结果`{kind:'image',taskId?:string,directUrl?:string,width?:number,height?:number}`或视觉结果`{kind:'vision',text:string}`。`ImageEditProviderExecution`含`transport(input:RequestInfo|URL,init:RequestInit|undefined,identity:ImageEditProviderIdentity):Promise<Response>`及`onAccepted(identity:ImageEditProviderIdentity,result:ImageEditProviderAccepted):Promise<void>`。`ImageEditProviderCallOptions`为`{providerId:string,boundary:ImageEditProviderExecution}`。

原submitImageTask与四个submit302函数保持既有参数/结果，末尾增加可选CallOptions；autoTrySubmitImageTask、describeImageWithVision、autoTryChatVisionFallback末尾增加可选Execution，用精确候选providerId/model建立调用身份。每个实际HTTP调用，包括/v1、multipart、edits→generations→chat、flat格式、1:1和候选/vision切换都经过传入transport。无边界时使用既有fetch/协议行为；有边界时不接受空provider/model身份。

边界transport抛错（租约丢失、未知提交、取消或持久化失败）必须停止整个适配器，不能被任何兼容/candidate/vision catch吞掉；统一`ImageEditProviderBoundaryError`保留cause，公开message固定不含凭证。已返回的HTTP响应是否允许fallback由边界transport决定：只有确认可安全继续才返回Response，unknown必须抛出；本适配层不把所有非OK假定为未执行。响应body读取/成功响应解析错误、2xx却无合法结果，在有边界时同样停止，不能继续下个候选。明确拒绝由旧分类选择兼容路径，保留旧能力。

尤其原fetchWithV1Retry把200非JSON视为/v1重试条件；新边界模式不能因此在解析成功SSE/未知HTML之前二次POST。边界模块使用局部controlled facade：先以skipV1Retry:true调用原helper（仍注入transport/propagateErrors），2xx直接交解析；只有非OK且boundary已允许返回的拒绝、原shouldSkipV1Retry/base/path规则允许才补/v1。不伪造响应头，不修改全局helper。无边界保持原helper。新增unversioned SSE成功一次请求、2xxHTML停止无重发、明确404→/v1成功行为测试。

解析出有效远端taskId/directUrl或有效视觉文本后，先await onAccepted再返回结果或启动下一步；回调只收到只读安全标量快照，失败停止，不得伪装成能力不支持继续发送。视觉accepted必须发生在后续生图之前。无边界不要求callback，不改变旧响应。计时器在抛错时也清理，外部边界signal不能因兼容helper被替换丢弃。未来durable executor负责提交前lease/started与response级分类，不能把此处内存回调测试当数据库恢复证明。

验证必须跑真实适配器/真实兼容helper/真实解析，只替换远端HTTP；全局网络默认拒绝。先在机械提取的等价实现上用新boundary参数展示实际未走边界/异常被吞的RED，再实现新行为。测试覆盖所有实际发送分支、请求体/精确身份、回调等待和故障、成功解析缺失、各层停止不重发、无边界兼容控制。既有302源码契约仅将端点/parser断言指向提取文件，路由选择/退款断言留route，并新增四端点真实行为矩阵；不得删旧保证。完整相关回归及真实302 POST+PG身份suite证明提取不破坏现有准入。全部能力未跑全平台/云端，不能记为发布通过。

回归发现的有限测试修正：`src/__tests__/api/remove-bg-provider-wiring.test.ts`两条旧源码断言仍要求j2之前route内的dedicatedRemoveBgProviders数组/sort/configuredDedicatedModels，j4c修前快照亦不含这些字段。只将两case升级为真实prepareImageEditModelPlan行为，验证专用/通用隔离和显式exact pair及provider.selectedModel一致；配置/managed-user来源可替身，真实catalog/授权不能mock。保留其余五case和仍有效route过滤/调用断言，不恢复旧产品代码。此文件是第九个准确测试写路径，完整回归额外运行既有image-edit-model-plan suite，产品写集仍route+四模块。

### 2026-09-28：302 既有原子准入的请求身份修补（Task8Cb3j4b）

本地限定完成：Aquinas独审Spec✅/Task quality Approved，Critical/Important均无；完整八套203/203、非增量tsc通过，eslint零错误/一个既有warning。主控核五候选前后/current SHA、七保护与j4a十文件不变、38保护0warning、refs/index及隔离库状态。证据见本SDDtask-8cb3j4b-report、review-01、full日志与controller-final-gates；未提交或部署。以下是本段合同，不重做。

现有 `beginRequested302CreditTask` 仅对 action、图片 URL、实际供应商/模型及测得尺寸做摘要，未绑定 projectId/sessionId/messageId、有序父版本、派生/修订意图和其他执行输入。`createBillableCloudTask` 对该旧 upscale 类型靠 requestDigest 判定重放，因此不能以通用任务表已经幂等为理由假定上下文隔离成立。先用真实 POST 和隔离 PostgreSQL 复现；该修补不选择自动模式收费合同，不代替完整持久执行器。

本切片使用版本化、固定白名单的请求身份快照，在 JSON 对象校验之后、首次项目准入 await 之前捕获。白名单覆盖当前 EditRequest 的全部已支持字段，嵌套 expandPadding 固定四边、有序 assetParentVersionIds 不排序；不包含未知字段、API key、role、任意客户端审计/预付标记。摘要加入服务器 actor、固定入口/版本、实际 providerId/modelId、实际 sourceWidth/sourceHeight/targetWidth/targetHeight；请求对象键顺序不改变摘要。不同已支持输入保守视为不同请求，不增加“语义等价默认值”的未经验证归一化规则。快照不存凭证，不修改请求的执行值，不创建另一个数据库权威。

在现有 core-v2 的 302 准入点消费该摘要。同键同请求继续复用 processing/completed/failed/cancelled/timeout 任务；同键异项目（即使两个项目都属于本人）、session/message、父版本及顺序、projectionMode、请求/实际模型和执行参数必须发生结构化 409 IDEMPOTENCY_CONFLICT，不能返回原结果、再次发送、收费或退款。历史旧摘要不能无证明升级，重试冲突保留原任务、结果与流水；新键仍可正常创建。不扩展 legacy/shadow 收费、全局 idempotency、父预付或其他 action。

冲突发生在原子准入之前取得旧任务身份，不得把它送进普通失败结算分支。测试必须保留真实账务、任务、幂等与 SQL；可替换鉴权凭证来源、管理员模型配置、远端 transport 与图片存储边界，默认拒绝所有未列明网络，禁止真实模型/业务库。真实 POST 先产生任务，再以同键变更上下文，用数据库前后快照证明原 task/result/revision/credit_status、余额、consume/refund 不变。增加正常同键复用和并发同键对照；终态至少 completed、failed、cancelled、timeout，以及 processing，不能只断言 helper 的 hash 不同。

实施写集为 route、专用请求身份模块、新纯逻辑测试、新真实 POST+PG 测试及旧模型执行测试中摘要期望。旧断言仅将缺字段的旧摘要期望改为独立构造完整新合同，不删除对 actual pair/收费次数/发出请求的验证。完整执行器、可信父预付、unknown 提交、角色 checkpoint 的真实生产者和全部 UI 仍开放。

route保持入口，不增加另一个HTTP递归执行入口。新任务描述符/执行器分别置于task-core对应image-edit模块；协议与CPU后处理从当前route提取供统一执行器使用。父证明复用skill-runtime/prepaid-generation与agent-runtime/event-storage的数据库锁机制。新增名称必须在实施计划给出签名与精确写集后才能派发产品实现；不凭本草案一次授权整个src目录。

第一组已有离线route诊断验证同步身份、不同价回退和未知提交；它使用外部账务替身，不证明真实数据库原子性。正式实现须另有真实POST+隔离PostgreSQL的十action/认证/模式/同步异步矩阵，不能沿用这些替身宣称账务通过。

正式验收还须覆盖并发同键、403/402/配置免费、事务故障回滚、来源撤权与准入后变更、未知提交不重发、异步重启、子预付伪造/错误generation/取消暂停交错、primary/mask独立发布及中途失败恢复。每项先业务RED再GREEN，完整相关回归和静态检查，独立规范与质量审查、38保护门禁、七保护SHA与refs/index边界。全仓/build/NFT/CI/Coze/真实取消退款及三工作区UI继续单独开放。
