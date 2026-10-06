# 协作画布第三方生成：单请求持久化与恢复

## 1. 范围与决定

本设计对应原 Yjs 计划 Task8Cb 的第三方生成入口子项 Task8Cb3h，不替代完整8Cb、8Cc/d、8D–E、Task9、草图转代码和发布验收。8Cb3g语言修图已独立审查关闭，不重新开发。Pear按用户决定排除，不是通过；现有PSD保留。

用户已授权选择最优方案自主执行，无需逐项确认；本次仅本地main，禁止stage/commit/push/切分支、修改stable/donor、安装、真实供应商/付费、Coze、部署和业务数据库。保留用户dirty文件、旧证据与测试媒体。技能默认提交/新worktree不适用。

选择：保留 universal 的协议与一次请求多结果语义，接入现有 cloud_tasks、原子计费、lease、完成投影。另两方案不采用：转发generate批次会改变n与任务身份；复制独立账务/任务系统会产生双权威。

## 2. 现状与边界

`/api/universal-generate` 已有 authorizeGenerationProject 前门；目前没有持久化任务/计费/publication。原实现通过兼容层提交，直接返回`images`，或轮询首个远程taskId后返回`images`。当前画布第三方调用带`submitOnly:true`但路由忽略它；调用者也有通用轮询分支。非document/无项目/显式chat或workflow保持原行为，本任务不宣称跨工作区接入完成。

文档项目且assetScope省略或为canvas进入本设计；未知scope拒绝，不能靠scope降级绕过文档授权。显式chat/workflow不创建canvas publication，仍必须通过既有项目前门。客户端userId、API密钥、baseURL、remoteTaskId、lease、冻结意图、计费跳过字段不能授权或替换服务端身份。内部Skill继承不在本段，不接受伪造内部头绕过。

## 3. 模块与公开合同

- `canvas-universal-generation-admission.ts`：严格提案、完整请求身份、真实原任务读取、实时来源校验及原子准入；不实现供应商或账本。
- `universal-generation-provider.ts`：从原route抽出协议构建/提交/轮询/透明元数据；共用原兼容层，支持signal和持久化回调。不拥有数据库、计费或共享发布。
- `universal-generation-task.ts`：仅将现有lease、registry/abort、完成/失败核心与上述协议串接；只消费已冻结描述符，负责恢复与安全响应投影。不建立新任务表或状态集合。
- universal route负责auth/分流/返回；poll-task增加专属任务分支，不能走原generate恢复自调用。

新增合法任务类型`universal-generate`，ID前缀`universal_`。原registry类型和atomic terminal类型集合仅增加该类型。不得冒用`generate-async`或伪造batch/slot身份。

文档请求默认n=1；只接受正安全整数，保留第三方原有多结果能力，不套用batch的1–4上限。用现有图像计价`calculateConfiguredCreditCost('image_generate', model, {providerId, quality})`确定单图费用后乘n，校验总费用有限且非负并满足原核心整数费用合同，不另造价格。实际输出少于n时如实保存实际输出，不伪造成n张、不二次扣费；原计价按请求冻结，补偿规则不在本段新增。

幂等键取`Idempotency-Key`；省略时生成服务端request ID并在响应返回，兼容当前无key调用。同body同key必须同task；客户端重试要沿用返回key，不声称无key请求可跨次去重。顶层request_digest使用既有规范化JSON哈希工具对完整原始body加route discriminator；身份比较不从stored payload伪造，不通过媒体下载计算。不把凭证值存入描述符/结果/错误响应。

`submitOnly:true`首次成功或pending重放返回200：`success:true, mode:'polling', taskId, taskIds:[taskId], status, idempotencyKey`，通过after调度唯一执行器；其他首次POST可等待原执行并返回`success:true, images, taskId, idempotencyKey`。已活跃lease的并发请求返回同一polling身份，不等待或替换原执行者。完成重放返回已持久化稳定images及规范assetProjection；四终态不重执行、不再收费。失败响应不得假装success completed。

`POST /api/poll-task`识别前缀后，先会话/内部可信身份，再以actor+taskId查询真实类型；不存在/越权拒绝。不信body中的模型、provider、scope、remote ID或public flag。不命中本地cache或取消缓存后再授权。pending可after恢复，返回既有poll status格式与taskId；completed返回真实imageUrls、images及安全canonical refs。个人历史查询不要求当前项目grant，原共享发布仍检查原授权代次。

## 4. 原子准入与来源

扩展服务器内部`singleAdmission?: 'edit' | 'universal-generate'`和`CanvasSingleTaskIdentity.type`同一联合；task type必须与marker严格相等，batch与single互斥。原edit仍必须有父图，不放宽其测试。

universal文生图没有reference时父版本数组必须为空；`referenceImageUrl`存在时必须是单张真实image父版本的一一匹配规范URL。空值、null、畸形URL、跨域/data/blob/私有素材、重复或多父版本、视频、不可用/已归档版本拒绝；同源绝对规范URL与相对规范URL均允许。placement选区只决定布局，不暗自成为父版本；revision恰一父版本且新增版本/摆放，不覆盖原图。工作区ID仅projectId或canvas:projectId输入，服务端归一。

先纯parse+身份→读取实际原task：terminal返回在当前来源/media/config检查之前；pending必须验证原grant/intent/current source。新任务来源用现有authorizeAgentContext/resolveAgentMediaUrls授权，实际向provider传图前复用安全媒体读取器将规范图片转换为支持的reference输入，不直接下载任意URL。

createBillableTask同事务绑定actor消费、task、publication和冻结selectionSnapshot。既有任务锁后重复校验type/project/key/顶层digest与原grant；零价仍保存意图。actor=请求者，owner仅publication目标，owner不收费。现有锁顺序/账本/终态SQL不变，single不走batch补偿revision。

数据库COMMIT响应丢失属于503未知结果：不按候选taskID退款；原key重试读真实行、同一消费与publication。提交前确定失败全部回滚。终态重放对数据库无写入，不补造旧任务publication。

## 5. 冻结、执行、恢复

仅首次选provider：显式providerId或`provider::model`精确匹配，冲突/不存在/未启用/模型未授权拒绝，绝不fallback另一家；完全省略时才按模型发现。冻结实际providerId、规范model、价格、兼容profile/endpoint及安全请求字段；恢复只取该provider的当前密钥，禁止发现/换供应商。管理员改价格、自动默认选择或模型别名不改旧任务费用/目标。凭证不入库；终态读取不依赖当前provider可用。

租约随机owner，TTL660000ms，单轮执行全局600000ms。只有claim赢家可初始化registry/abort；update/remote checkpoint/complete/terminate必须带leaseOwner，返回false就停止后续IO或本地进度；数据库成功后才发布SSE。清理仅释放本worker的lease/controller。cancel-task通过atomic terminal类型接入原取消退款，不增加退款路径。

描述符存现有result命名空间，明确版本、route、body摘要、provider/model、规范请求、publication必要指针；解析失败不能从客户端重建恢复参数。执行前读取真实task：有已确认远程checkpoint时直接续轮询，不因撤权/删来源重新失败退款；没有checkpoint且未发送时校验原grant/source。沿用3g修复的“远程已在途仅阻止共享发布，不破坏个人结果”原则。

提交前用带lease的DB写入`submissionPhase:'started'`。远程响应的task IDs（或直接image结果checkpoint）必须先成功持久化，才进行下一步轮询/完成。多个远程ID依返回顺序轮询并聚合实际结果，单父任务、单消费；不能只采首个ID或重复发布同一outputIndex。恢复有远程ID/直接结果checkpoint则不重新POST供应商。

已标started但无确认响应时，不盲目二次提交或自动退款：返回`UNIVERSAL_SUBMISSION_UNCERTAIN`和原taskId，保持原pending供确认或用户取消；仅增加result内诊断标记，不新增持久化状态机。提交后网络中断/非JSON/模糊5xx不能伪装确定失败。供应商明确拒绝、远程明确failed、已确认远程任务超过既有执行时限才能走既有唯一结算。

现有fetchWithV1Retry对任意非OK会再次POST，协作路径必须禁止该不确定重试；可对明确路由404/405做一次受控/v1兼容重试，仍使用同一信号和身份，其余模糊结果不重发。非document原策略不改变。Idempotency-Key传上游可辅助但不能假设所有提供商实现。

完整结果先completeCloudTask，再原projectPersistedCompletedTask；输出统一存imageUrl/imageUrls以及稳定images字段，透明元数据保留。共享投影失败保留个人完成结果，可由原GET恢复重试投影，不能重新生成或退款。撤权、regrant、关闭document、归档、删来源后完成只留个人结果，零shared command。完成/取消/超时与迟到worker竞争以原DB终态为准。

## 6. 私有兼容与透明结果

抽出transport不得改变原非document直返`images`、异步轮询、reference/quality/aspectRatio、错误翻译与透明检测。透明请求必须先normalize/reject再供应商；实际alpha检测，不凭PNG后缀。opaque/invalid仍保留原图并提示手动remove-background、requiresConfirmation:true、separatelyBilled:true；不得自动付费去背景。

静态旧测试若依赖route源码位置，可精确迁移到新transport读取并增加行为测试；保留每条原语义，不删除断言换绿。真实协作多输出/取消/恢复不能仅靠源码grep验收。

## 7. 验收矩阵

测试必须调用真实route/core/PG迁移/授权/账务/lease/projector/GET，供应商用默认拒绝fetch下的明确边界替身并返回实际PNG。禁止mock数据库、COMMIT、createBillableTask、原投影或退款。每条shell先专用环境；新3h库127.0.0.1:55492/wujie_yjs_task8cb3h_20260927，media在_tmp_e2e/task8cb3h-media-20260927；不读.env。复用已有故障代理，只增加第三个精确允许库；另测非127主机/未授权第四库在联网前拒绝。原3f/3g硬编码guard测试分别在原环境单独跑，不修改guard。

### A：完整成功与兼容

- 首次文生图、单参考derived、revision、多结果及n=5：actor100按7*n消费一次、owner100不变、单task/intent、实际图片canonical refs/commands逐输出唯一，原素材字节/版本/摆放不变。
- 价格0、余额不足；submitOnly after与同步直返；同键20并发一个provider submit；private/no-project/chat/workflow无canvas publication且原返回不变。
- 旧直接/async/透明alpha/opaque/unsupported/明确失败各有真实协议边界行为证据。

### B：身份与授权

- 同key改变prompt/model/provider/n/reference/parents/mode/选区/project/其他body字段409且DB不变；错误真实task type、顶层digest缺失而payload伪造也拒绝。
- 明确provider不存在/disabled/模型不属于它/复合ID冲突不fallback，媒体IO0；重放改当前价格/发现顺序仍用原provider/费用。
- reference全部坏形态、无parents/错URL/真实跨owner和跨项目/视频/不可用版本拒绝；拒绝伪造user、内部头、skipCredits、stored descriptor/remote checkpoint。
- 使用真实PG锁等待，期间撤权再授予、停用actor/owner、归档/关闭文档/全局开关、选区删/换版均拒绝；仅移动不重算冻结坐标。
- 四terminal来源删除后同key历史返回、完整schema快照不变；旧pending无intent拒绝、旧terminal不补造。

### C：恢复与未知结果

- 真PG COMMIT成功ACK丢失→503→原key同task、consume/intent各一；COMMIT前失败均零。
- after调度抛错保留已准入task，原请求/poll恢复；两个真实poll竞争只claim一个；无registry模拟重启，通过原poll-task续已确认远程ID、完成图片及GET，不只是手工complete代替poll。
- 多远程ID/直接image checkpoint恢复不二次提交；确认响应落盘后撤权/删来源仍个人成功，GET不共享。
- started无checkpoint、非JSON/网络不确定/5xx不二次提交、不自动退款；明确400/远程failed结算一次；404/405受控v1兼容与abort覆盖。

### D：终态与竞态

- 实际cancel-task与provider完成竞争，退款最多一条，迟到成功不覆盖cancelled、无共享输出。
- 已确认远程执行timeout、provider失败、lease失效并被另一worker接管，旧worker progress/finish/fail均不可写DB/SSE/退款或发送新provider IO。
- 共享投影失败仅个人completed，原GET重试投影一次，无重发/重扣；不把projector失败误判供应商失败。

## 8. 完成标准与明确未验证

矩阵A–D、本段两个新PG、直接影响旧共享core/3f/3g和poll/cancel合同、非增量tsc及变更TS ESLint全有原始命令/开始结束/退出码。所有失败、夹具错误和未验边界保留；独立审查Spec与质量均通过后才登记新模块准确保护许可并跑38项门禁。

本地通过不代表真实第三方、云端、多进程重启、实体设备、全UI或发布通过。原8Cb其余generate/direct/legacy、image-edit/video/Skill继承继续开放；8Cc会接真实UI的规范refs/placeholder/idempotency，不能用后端通过关闭UI任务。替代PSD另行设计。
