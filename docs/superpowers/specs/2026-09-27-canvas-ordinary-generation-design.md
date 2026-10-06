# 普通图像生成的协作原子准入与逐输出恢复

日期：2026-09-27。原计划Task8Cb3i2；3i1来源校验已关闭，不重做。本文只接入尚未覆盖的协作画布普通generate/旧wrapper路径，不宣称其他工作区UI或全平台完成。

## 1. 依据与方案选择

当前普通路由先consumeCredits，实际供应商返回后才创建direct/remote任务；一次请求可多次n=1提交，每次又可返回多个结果。3f的canvas-direct submitOnly按slot收费、1–4合同不是本路径的替代品；universal协议也不能替代普通路由的Gemini、Responses、JSON/multipart、参考图及提示词增强能力。

选择：在原任务系统内为一次普通请求建立一个type=generate的权威任务，费用维持当前普通路径一次计算/一次消费；所有提交尝试、远程任务与输出都是该任务的持久执行信息，不另建账本或供应商状态机。完成仍调用既有complete/projectPersistedCompletedTask，输出canonical身份由原发布器按task/output建立。

不选择把请求拆成3f收费批次（改价格/数量合同），不选择转发universal（丢协议），不选择在旧内存/远程ID任务生成后补publication（供应商调用前没有权威身份）。保存可恢复执行描述符与每个提交checkpoint，而非把整个NextResponse视为可恢复状态。

## 2. 精确分流与兼容边界

- 已认证、项目授权返回document、assetWorkspace缺省或canvas，并且属于非submitOnly请求或WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER实际启用的旧wrapper首次请求，进入新路径。
- 已有3f默认submitOnly/canvas-direct分支不重做；私有/旧非协作项目、chat/workflow、gateway原路径保持。有效Skill billing/prepaid及真实authResult.source=internal且任一skip为true的旧内部调用继续原消费者，保留两个标记各自独立的原语义，不得误建第二收费任务。不能将所有internal都当已付费；两标记均缺省/false的内部首次请求仍需正常准入。
- 3i1类型/来源检查仍先于任何分流。新首次协作准入本身不接受skip授权；上述旧内部兼容分流只以实际认证结果为依据，并继续原项目授权与Skill围栏，不能凭浏览器字段或伪造internal header取得授权。单skip旧调用不属于新ordinary原子准入，不能声称其已获得新协作发布保证。
- 2026-09-27兼容裁定：前版“仅双skip恢复”表述过窄，冲突于已关闭3i1明确保留全部合法内部组合的合同。保留document单skip原行为和旧测试断言，不把这些测试改到private/chat来隐藏回归；外部true拒绝和内部无skip正常准入必须同时覆盖。
- 新分流在参考媒体读取、save-image、识图、供应商IO及独立consume之前。解析/前门授权后优先查幂等历史，再检查当前模型列表；终态同key重放不依赖当前供应商配置或源媒体可读，但POST保留当前项目前门。owned poll历史不额外要求当前共享grant。
- 新任务前缀ordinary_，type=generate，不新增任务类型。协作普通请求响应仍mode=polling，taskId和taskIds:[同一权威ID]、idempotencyKey；count为当前已确认输出数或未完成时请求输出数，directImageUrls含全部已持久直接结果。多个输出通过同task的imageUrls及完整assetProjection.references交付，不伪造多个收费任务。新公开`outputGroup:{version:1,kind:'ordinary-generation',taskId,requestedCount}`明确一个任务对应一组结果，必须同时在POST顶层与持久result/POLL/安全SSE/GET恢复结果中提供。
- 这是新协作分支的显式身份合同；非协作旧调用仍保留原taskIds与返回结构。Photoshop/Illustrator当前forwardJson不带projectId，仍走原私有分支；不得为此悄悄修改连接器或声称三工作区接线完成。新响应禁止输出apiKey、descriptor、grantGeneration和凭据；保留模型、供应商名称、路由审计、增强提示词与原提示词等非敏感旧字段。
- non-submitOnly等待初次提交及checkpoint，不等待远程长轮询；submitOnly旧wrapper首次准入后用after调同执行器并立即返回。after失效/进程丢失由owned poll恢复。

## 3. 请求、来源、费用及原子身份

- requestDigest绑定原完整JSON请求（稳定键排序），包含所有影响执行/发布/会话的字段及路由版本，不仅挑prompt/model。`outputCount ?? n`优先级、原数值floor/max10及先于此发生的能力目录拒绝保持；不得把字符串计数变成新的多输出行为，也不绕过目录上限。
- idempotency-key存在则严格沿用，否则生成并在成功/准入不确定错误响应中返回。同key改变prompt/参考顺序/强度/分类/风格/尺寸/quality/透明输出/项目/父系/选区/模式/workspace/session任一有效字段409；不消费、不读媒体、不外呼。
- 参考图按原有效元素规则标准化；协作每张有效参考必须对应有序assetParentVersionIds。来源由真实authorizeAgentContext/resolveAgentMediaUrls绑定同项目canonical URL，拒绝跨账号/跨项目、URL替换、相同URL不同版本、data/blob外部任意图、伪造grant；文生图允许空父系。精确快照含版本/资产及有序父系，不能仅检查URL相同。
- 保留derived/revision语义，revision复用原资产版本家族但只append，不把选择当作替换确认。selectedEntityIds解析为规范placement并冻结位置；多输出原发布器稳定偏移，不在客户端临时补权。
- 最终共享发布（含completed待发布恢复）仍验证准入时完整来源指纹。合法revision已提交的前序输出会推进同资产current_version_id：只在真实数据库版本、lineage及稳定canonical command共同证明是同根输出时，允许比较时还原服务器冻结原头再计算完整指纹；不修改数据库头，不忽略其他资产字段、源版本或有序父系。外来头、缺失/非法证明仍拒绝；新slot/准入/媒体读取不采用该豁免。详细裁定与真PG正反例见本计划task-8cb3i2-fix1-brief。
- 扩展CanvasTaskPublicationInput.singleAdmission和CanvasSingleTaskIdentity为edit/universal-generate/generate，core实际task.type与marker必须一致。single/batch互斥、edit仍要求父系、原锁序和幂等行检查保持。
- createBillableTask同一事务创建请求任务、本人一次消费、原grant代次及发布意图。费用用原普通路径的calculateConfiguredCreditCost参数，不乘输出数、不向owner扣费；零费用同样创建任务和意图。普通私有价格不变。
- 原子提交前故障全部回滚；COMMIT结果未知返回503及原key，不返回未经确认的候选ID、不外呼；同key重试找回实际一条任务/一次账务。相同key并发只准入一次。

## 4. 执行描述符及协议保留

新增ordinary-generation-request模块负责原模型/供应商/能力选择与非IO请求准备；ordinary-generation-provider负责原普通协议和解析，不导入数据库；ordinary-generation-task连接既有lease/任务/发布；canvas-ordinary-generation-admission负责协作来源/意图。

不得复制一套缩减协议。把原普通路由实际使用的请求准备/submitSingleTask实现提取为可复用边界，旧private路径也调用同协议实现以避免双份漂移。原submitOnly账务、注册与Skill围栏留路由。提取带来的旧字符串测试位置变更只调整读取位置，保留业务断言并补实际POST行为。

描述符存入owned cloud task.result.ordinaryGeneration：version=1、route=/api/generate、requestDigest、冻结请求、请求/实际选择、模型能力、兼容profile（实际resolveProfileForModel结果）、baseURL、非secret advanced参数、已准入候选顺序、请求输出数、价格及publication。API key不持久化；执行只按冻结providerId取当前key，不重新发现/切换供应商/模型/profile/baseURL/候选目录。显式provider和复合键冲突/不存在必须拒绝，不能当隐式发现。

显式供应商永不切换；原未显式供应商的自动选择与兼容候选保持，但候选在首次准入时按真实权限/能力固定。某次确定性拒绝允许切到已冻结候选；逐次记录实际provider/model/route，不能最后一个usedProvider覆盖全部输出身份。每个n=1提交的所有direct及remote结果都要保留。

逐输出身份须落实到实际资产版本，而非仅响应审计字段。既有document-media-import写版本时，对合法ordinary任务按稳定outputIndex读取服务器持久的已接受输出来源，写入对应provider_id/model_id；不得将根任务最初候选套给全部输出。其他旧任务/上传/版本导入保持原行为，不改锁序、授权、媒体读取、lineage或结算。来源只能来自已验证任务/描述符及其接受checkpoint，与有序结果相符；缺失/非法的ordinary输出来源不能静默伪装为根候选成功。禁止从该导入模块反向导入执行器造成发布循环依赖。

识图增强保留：在请求生成前冻结辅助模型选择（无可用模型保持原可选降级），只按冻结ID取key，媒体安全读取后执行；成功或已确定的可选失败结果及最终enhancedPrompt在第一次生图前持久化。恢复不得重新选择另一辅助供应商或重复改写已保存提示词。辅助识图不是生图接受证据；也不能让它绕过task/lease/source围栏。

所有媒体读取、辅助请求、实际生成POST、输出下载和轮询使用同任务abort/lease围栏。SSE的streamResponsesApiSSE只是已取得Response的解析器；真实POST在它前面的fetchWithV1Retry。tryChatCompletionsImageFallback内部另有fetch并吞catch，需要显式受控transport/错误传播选项，不能被新执行器遗漏。shared helper新选项默认保持其他调用者原行为，不改变全平台重试策略。

## 5. checkpoint、回退与不确定结果

- 每个请求slot使用稳定slotIndex，每次生成尝试使用attemptIndex及冻结route身份。调用任何可能创建远程生成的POST前，持有有效lease并持久保存started；收到输出或remote IDs立即持久checkpoint，写失败不能继续另一生成POST。
- 根账务幂等键不直接充当所有供应商生成操作的同一键。新协作路径若发送provider idempotency key，须以服务端根任务身份和slot等稳定操作身份隔离：同根不同slot、不同根（含不同actor使用相同客户端key）不能碰撞；同一操作恢复身份稳定，已接受/未知操作仍不得重发。通过按key缓存结果的离线供应商验证多slot实际不同生成，不用按调用次数返回不同图掩盖碰撞；原private/Skill键合同不改。
- checkpoint保留完整direct输出、全部remote IDs、每个remote已取得的全部输出及各自provider/model/target。恢复只处理未完成remote/未持久媒体；已接受的slot不得再提交。数组最终按slot/attempt/remote/output顺序确定，禁止使用随机输出ID或重排已发布结果。
- 允许明确未接受的协议兼容回退：404/405端点拒绝、明确参数/尺寸拒绝、415格式拒绝及确定的无渠道拒绝。保留原JSON↔multipart、edits→generations、Gemini chat、Responses/SSE等适用分支。每次拒绝证据和后继尝试都持久化；未知错误文本不能冒充确定拒绝。
- 网络断开、abort后不知是否接受、524/504/不明5xx、成功状态无法解析或没有可靠结果、started后丢ACK、checkpoint写入结果未知：标记ORDINARY_SUBMISSION_UNCERTAIN；不得同模型重发、切供应商、切chat或启动后续slot，不能自动退款后再消费。响应携原task/key、requiresReconciliation=true/retryable=false，仍可取消。
- 已有direct URL但下载/可达性失败是已生成结果，不能再生一张以获取外网URL。可以保留原provider域名转换/安全下载恢复，但必须保留原结果checkpoint，不把下载失败归为生成未接受。其他旧private消费者不在本段改变该策略。
- 原始错误的status/code/message及尝试身份保留在安全诊断中，移除secret与响应头敏感值；前端中文提示不替代原错误。
- 远程poll失败可重试GET/查询，不重发生成。lease替换、过期及取消后旧worker不得更新checkpoint/完成/发布。完成事务成功但ACK丢失时只读权威终态，不反向失败/退款。
- 已知部分slot失败而其他slot成功：保留全部成功结果和失败诊断，根任务完成且维持一次请求费；全部明确失败走原唯一退款。未知提交不得当部分成功直接完成；已得结果保存checkpoint，等待核对或用户取消。
- 当前generate不在requiresAtomicTerminalSettlement固定集合，新根也没有旧batch slot身份；必须在terminal-settlement精确识别type=generate且version/route/requestDigest有效的ordinaryGeneration服务端描述符，使已持久新任务走原子terminate/refund，不能把所有旧generate全局改为原子。registry只投影安全结果并保持durable标识，不能回落到内存退款分支。重复取消、迟到结果不复活、不再扣费；取消后即使checkpoint留有输出，也不自动发布共享文档。

## 6. 恢复、授权与输出交付

executeOrdinaryGenerationTask({taskId,actorUserId,origin,phase:'submit'|'poll'})从DB加载描述符；POST/after/poll只传owned身份，不传浏览器恢复配置。以原claimCloudTaskLease/release/update/complete/terminate为唯一状态权威；不另建自有状态表。

首次生成及恢复尚未开始的slot前重新验证原grant代次/规范来源，重授权的新代次不能补旧权限。已经接受的远程任务仍可为本人查询/保存个人结果；来源撤权/删除时不能重新读参考字节或发新的生成。共享完成投影继续依赖冻结grant代次，禁止写入已撤权项目。

非submitOnly的submit阶段处理提交并持久checkpoint后返回；poll阶段最多一轮查询各未完成remote，给客户端processing/recoveryPending，不在单次HTTP里循环等十分钟。after可执行同一阶段，失效不丢任务。已完成输出使用loadSafeImageInput与persistAssetBytes，按相同task/有序输出稳定交付。

ordinaryTaskResponse只投影安全字段，completed的result.imageUrl/imageUrls和顶层兼容字段均完整；assetProjection.references包含每个输出的asset/version/placement。不要只返回第一张；新taskIds单根合同必须由实际POST→POLL→客户端解析合同测试证明。未完成、发布待恢复及真正失败分别表示；发布失败只重试原发布，不重发/再收费。

客户端兼容是本段必需，不推给8Cc：`image-generation-session`现有bindSubmission会将多请求槽中未绑定槽置MISSING_GENERATION_TASK，applyUpdate/restore只取refs[0]。新增仅合法outputGroup触发的分组分支，同根任务绑定全部目标槽、只轮询一份任务；完成按全部有序references映射，额外返回图片追加稳定输出槽而不丢弃。旧3f/未带group路径保持原逻辑。group marker必须严格校验version/kind、非空taskId、1–10整数requestedCount及与响应task身份一致；不能把多个普通taskID冒充一个group。

分组刷新恢复建立同task+outputIndex稳定视图身份、重复恢复无重复槽；终态但canonical references尚缺时保持processing并恢复原发布，不能进入会重新生成的retry路径。确定部分成功且缺少请求结果的剩余槽标明确失败且retryable=false，已有结果保持completed；未知提交保持等待核对而非自动retry。取消组内运行槽等于取消整组任务、成功后同根所有运行槽收敛cancelled；迟到事件不复活。真正生成失败可保留原显式单槽重新生成操作，但须解除该槽与旧根的绑定并遵守retryable=false；不能自动重发同根。dispose/项目restore清理组映射及旧poll，保持已有隔离围栏。

group运行任务需要owned poll驱动恢复/远程查询，不能因全局SSE连接正常而跳过轮询；否则after没有执行时任务会一直停住。每根只保留一个poll句柄，terminal/cancel/dispose清理，旧非group SSE策略不改。以SSE全局已连接且after未执行的真实session定时器行为测试证明仍触发POLL。

共用无server-only的ordinary-generation-output-group模块提供严格parse方法和纯类型，route/task/recover/session一致消费；GET现有白名单仅追加验证过的outputGroup，不透传整个descriptor。真实POST/POLL/GET载荷喂给实际createImageGenerationSession、extractTaskAssetReferences行为测试，禁止新写一个“理想客户端”冒充现有消费。

主画布同属本次兼容：canvas-workspace:2060订阅session的现有桥接写死outputIndex=0、无原context即跳过；主要面板:2835的payload也可能进入旧wrapper新分流。group槽必须带outputIndex并在既有占位绑定及事件投影中一致使用（普通旧slot仍0）。只对group抽出可行为测试的`canvas-ordinary-generation-projection`桥接，并由该真实订阅器调用；同根不同输出不能覆盖第0张，超出预建占位的输出按canonical placement/version添加，不凭URL重新导入/创建资产或写Yjs。与服务器文档先到/后到交错时按placement去重并只移除本组对应占位，不清其他任务。没有当前项目且同根有效提交上下文时，不应用迟到事件；保留既有项目/账号隔离与撤销体系。该桥接不扩大为所有8Cc工作区/编辑/撤销完整接线完成。

GET tasks/recover使用已完成3e通用恢复；新前缀poll放在cache/registry之前，用登录actor查询真实owned generate与合法descriptor。匿名401/他人404；伪造prefix、模型或请求body不能接管任务。终态与发布恢复不依赖当前供应商key/媒体源配置。

## 7. 必须执行的本地验收

A. 真实POST、真实PG/core/授权/意图/发布（auth/config/after/供应商边界可离线替身）：owner/editor、0/正费、文生图/规范多图、derived/revision/选区、非submitOnly/旧wrapper，账务一次且owner不变；同key并发/不同有效字段409；3f/Skill/private/连接器旧合同保持。

B. 真PG屏障/故障代理：准入前撤权、来源/父系/选区交错变更、提交前回滚、COMMIT ACK丢失（含无key首次）、同key恢复；逐表快照确认拒绝零媒体读取/外呼/消费/意图。原edit marker空父系和batch/single混用仍拒绝。

C. 实际协议矩阵：OpenAI直图/多图/多remote/混合输出、Gemini chat、Responses SSE、JSON edits→generations、multipart、确定尺寸拒绝修复、隐式候选与显式不回退、透明输出。有效profile/baseURL/model/价格/候选顺序/辅助模型配置在准入后变化，恢复仍使用冻结值，只允许key轮换。新协作分支已接受的输出下载失败不重新生成；旧私有消费者默认行为按第2、4、5节保持，本段不全局更改其回退策略。

D. 真after/POST/POLL/CANCEL/GET：after不运行、claim失效、started无checkpoint、524/断流/非JSON/无输出、checkpoint写失败、第一输出完成后下一remote暂失败、一个remote多输出、进程状态清空恢复、发布失败恢复、取消/late/旧lease；每个真实外呼前观察数据库已有一任务/一费用/一意图，不以mock函数调用代替事务证据。真实source读取spy仅观测原实现，拒绝不能读字节；完整references及规范图层/版本/Yjs更新去重。实际session需验证group提交/多图和额外图/恢复/投影待恢复/整组取消/迟到/坏marker/旧3f兼容，不只断言后端数组长度。

上述单机故障注入不等于真实OS重启/跨机、生产供应商、Chrome云端、实体设备或全平台发布；这些仍为原Task9及后续范围。

## 8. 约束

仅本地main；不暂存/提交/推送/切分支/触stable或donor，不安装、真实付费、Coze、部署或连接业务库。保护七文件不动。原SDD日志/快照/媒体/测试库不删除。全新隔离本地3i2测试库，只跑明确直接影响回归；全仓/build/strict NFT/Chrome仍留原完整门禁。Pear分层验证排除、PSD核心保留。产品/测试使用apply_patch，独立审查批准并过保护检查后才勾本task。
