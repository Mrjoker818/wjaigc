# 协作画布语言修图准入与同任务执行

## 目标与范围

Task8Cb3g 接通真实 `/api/edit`：当前用户在已启用协作画布中，以规范素材版本修图，在原本人收费事务冻结发布意图，由原完成/GET恢复出口登记结果。覆盖首次、并发重放、内部 defer/resume、执行租约、失败/取消及提交结果不确定的恢复；不是只交付 helper。

只修改本地 main，保留当前 dirty 工作；不 stage/commit/push、切分支、改 stable/供体、安装依赖、访问业务库、执行真实付费/外网供应商、同步 Coze 或部署。六份平面 SDD 文档及 `src/lib/asset-core/managed-media-read.ts` 是保护文件。专用 loopback PG、真实文件、原账务/任务/发布实现用于验证；仅认证、管理员配置、框架标记、after调度及供应商网络边界允许替身。

3e完成/恢复发布及3f批量生成已验收，不重新实现。其他generate分支、image-edit/video、Skill可信父子继承、全UI/撤销、三工作区及发布门禁仍开放；本段不改变聊天工具请求体或替代它们的继承设计。Pear专项已移出范围，PSD核心保留。用户已授权后续自行选择方案，无需重复确认；本设计在此授权内，不扩至新外部操作。

## 已核实的接入点与方案选择

- edit入口固定 `core-v2`，已有 `createBillableTask`、完整body的 `createAnnotationRequestHash`、可信internal defer/resume、`completeCloudTask` 与 `projectPersistedCompletedTask`。新增的是协作授权/意图及执行去重，不是计费迁移。
- 原普通重放只返回polling，internal resume可执行；任务提交成功但ACK丢失后若无worker，单纯返回ID会留住未执行任务。文档路径采用现有cloud task lease，使同key重试可恢复且并发只一worker执行；不增表、不造第二状态机。
- 采用“原core加显式单任务准入，路由复用旧provider循环”。另一方案是把edit改造为生成批次，会混淆一任务多输出与多任务slot；另建edit队列/账本会产生第二权威来源，均不采用。
- 当前ImageEditor会重编码图片且未传项目/版本；本段不把这种UI行为冒称已接通。后续8Cc应传规范版本/URL，并以规范发布引用确认结果；不能以重编码文件SHA冒充源版本。

## 请求与来源合同

1. 身份只取 `requireApiAuthOrReject` 的 actor；项目先调用既有 `authorizeGenerationProject`，在媒体IO、扣费、任务注册和供应商执行之前拒绝无权项目。非协作/无项目保留原接口和计费；显式chat/workflow不自动变为canvas发布，相关全工作区接线仍开放。
2. document access 且 `assetWorkspace` 未给或为canvas时进入本合同。允许 `assetWorkspaceId` 未给、projectId或`canvas:projectId`，其他目标拒绝。新增 `assetSelectedEntityIds`；使用既有严格proposal schema，projectionMode仅derived/revision，默认derived；只允许append，revision复用版本家族但不替换原摆放。任何客户端owner/grant/冻结intent/skip计费声明不能成为授权。
3. 文档修图必须有至少一个已就绪图像 `assetParentVersionIds`，上限沿schema 32，顺序保留、禁止重复。第一个是主图，后续是参考图；`image`与第一个规范URL等价，`referenceImages`按顺序精确匹配其余URL。无参考时允许undefined/[]；有声明parents时不忽略空槽、也不接受任意外部/data图替代父版本。来源通过既有 `authorizeAgentContext` / `resolveAgentMediaUrls` 及真实版本/规范placement验证；actor/owner/project/grant须与前门相同。
4. URL等价只比较合法相对URL和同源绝对URL；拒绝反斜杠、协议相对URL、用户口令、fragment、非HTTP(S)。不读取媒体字节来猜源版本。蒙版可保留旧用户绘制输入，仍经原安全图片读取；它不是凭空声明的父版本。新上传须先沿已实现的协作导入成为版本，再用于共享修图；非document的原上传/base64能力不改变。
5. requestDigest继续用原完整parsed body散列，不重写旧annotation幂等合同；新增scope/parents/selection/mode自然参与。同key改变任何有效body字段拒绝409；不得从payload或当前授权补造丢失的顶层digest。首次与重放不以下载后的字节构造不同身份。

## 原子创建和重放

新增服务器内部 `CanvasTaskPublicationInput.singleAdmission?: 'edit'`，与batch标记互斥；只有本路由文档准入模块能构造该输入，不能透传body。core向prepare另传真实 `CanvasSingleTaskIdentity { type:'edit'; idempotencyKey:string; requestDigest:string }`。不把single伪装成batch，不改既有batch协议。

- 新任务仍在原core事务中锁幂等键、复核actor/project/原grant/启用/parents及选区，扣发起人费用、插入task、持久化publication一起提交；零费用同样冻结意图。owner身份只用于项目素材，不能扣owner余额。为新single意图复用已有 `freezeSelectionSnapshot:true`，固定选区entity/placement/version及布局；不扩schema，不迁移旧任务。
- 非终态复用在原core task锁内验证实际type/project/key/顶层digest、已有publication的原actor/owner/project/workspace/grant、原intent与新proposal一致。用已有只读规范来源验证核对parents及冻结选区身份；移动/缩放不重算布局，删图/换版/来源不可用拒绝。原grant即使regrant后重新拥有当前权也不能换成新代次。缺原publication/snapshot的历史pending拒绝升级，不补收费用、不改原任务。
- single复用无需推进3f专属补偿revision：本路径外层派发失败不急于结算已准入任务；唯一执行者通过既有lease结算。3f的revision围栏和未知COMMIT分类保持原义。
- 全终态是读：在实时来源检查和媒体IO之前，按当前actor/project访问权及实际type/key/顶层digest返回原polling ID，所有terminal状态均不重新processing、不派发、不改账务/intent。来源删除或不可用不阻断该读；撤权者仍可走原个人任务GET，不能借POST写共享项目。历史terminal缺publication可只读，不自动补意图。
- 首次lookup与core之间发生并发时，必须按core返回的真实task重新区分terminal/reused；不能使用预生成ID或旧lookup结论继续执行。非终态实际providerId/model也必须等于冻结任务身份，不随管理员自动选择变化切换供应商；不从当前价格改旧账单。
- 事务提交ACK丢失返回安全503，不以ROLLBACK或本地随机ID推定未提交、退款或重建。原key+原body重试定位已提交task，原账务一笔且可进入租约恢复。其他数据库错误同样不泄露SQL/连接信息。确定提交前失败完全回滚。

## 执行与终态

文档任务继续原after/内部resume调度，但执行必须先通过现有 `claimCloudTaskLease`（随机owner、TTL 360000ms）取得唯一执行权；未取得则不注册/覆盖内存任务、不读取媒体、不调用供应商、不退款。原全局执行超时300000ms保留；无需新持久队列或新租约表。

1. internal defer只创建/复用任务，不claim或派发。internal resume必须有原key对应非终态任务，不允许以缺失task自动建新任务；普通cookie伪造internal头不起作用。现有chat-tools内部调用无project，保持旧流程，不能以此宣称Skill继承已完成。
2. 原key非终态重试可排队同一个after，但实际lease只允许一个worker；丢ACK或调度失败的任务因此可恢复，不新增扣费。取得lease后、首次媒体IO前重新核对原publication/grant与规范来源，拒绝时不将别的worker/已终态任务失败化。执行中撤权后已产生的个人结果可保存，原3e阻止共享发布。
3. 内存store、registry、AbortController及processing进度的初始化移至文档worker成功claim之后；原私有路径不重构。检查初始化更新的真实返回值，terminal或已失去lease不能继续运行。所有文档进度DB更新带leaseOwner；只有成功DB更新后才能反映到本地store/SSE，避免旧worker污染接手者。
4. `finishTask`复用原 `completeCloudTask`，文档worker传leaseOwner和deadlineAt；未提交成功不更新本地completed，不发布。成功后调用原projector/GET恢复，结果自动登记/追加但不覆盖source；多输出沿原outputIndex/stride。完成、失败、超时与取消单调，迟到成功不可覆盖失败/取消。
5. 文档worker的失败/取消/退款调用既有 `terminateCloudTaskAndRefund` 并传leaseOwner；只有持租约worker可结算，至多退款一次。lease丢失/未取得以及外层调度失败不取消或退款其他执行。finally按owner释放租约、注销自己的controller/计时器；若另一个worker已接手，不清其本地状态。非document原退款合同不变。
6. 使用原供应商实现和错误翻译，不更改模型能力、fallback、输出形状或真实价格。外层错误优先分类 `CanvasEditAdmissionError`、publication错误及既有积分/幂等错误，HTTP 400/403/409/503可辨识，不能吞成含SQL的500。

## 真实行为验收

每组先业务RED再最小GREEN；真实路由、PG任务/账务/意图、源PNG、完成发布及恢复不能mock。锁等待用真实PG锁/`pg_blocking_pids`或协议屏障，不sleep猜时序。

测试环境窄例外：新3g与其余兼容测试仍先加载`task-8cb3g-environment.ps1`。旧`canvas-generation-batch-postgres.test.ts`及`canvas-generation-route-postgres.test.ts`保留原精确库名guard，不修改这两个文件；它们单独在随后加载的`task-8cb3f-environment.ps1`环境执行，使用原loopback专用测试库和媒体根。这是测试命令分组，不更换被测代码，仍测试当前3g候选中的共享实现。两组分别保存命令/起止/exit；不得删旧断言、跳过旧回归或把3g环境下的guard失败计为业务RED。共享故障代理仅精确允许3f/3g两库且保持127.0.0.1，其他库和主机须在联网前拒绝；产品与旧两suite写集不扩大。

| 组 | 必验行为 |
| --- | --- |
| A 首次闭环 | editor POST主图+parents+selection，200/一个真实edit task/一笔−7/editor93 owner100/一条publication，原x0 width100冻结x132；真实after供应商边界返回PNG，原finish+GET得owner项目新version/placement/command；源文件checksum及原placement不变。derived/revision、多输出与零价覆盖。 |
| B 幂等/来源 | 20并发同key只一任务/消费/publication，一worker供应商调用；变化body字段409；跨owner/project/仅presence/停用/归档/全局关闭/来源非image或不可用/错误主图或参考URL均无IO/消费；无parents共享修图400，私有base64仍可用。 |
| C 原授权与历史 | 前门后锁等待revoke/regrant、源删/换版拒绝无新消费；非终态regrant不可刷新grant；选区只移动可复用且位置冻结。completed/failed/cancelled/timeout各在来源删除后同key返回ID且全部DB快照不变；错顶层digest、project/type拒绝；旧pending缺intent拒绝，旧terminal可只读。 |
| D 执行恢复 | defer不派发、原task resume执行；伪internal头不能越过普通逻辑；真实COMMIT已提交ACK丢失后503，原key重试相同ID/一消费并成功；after调度抛错后保留可恢复task；并发resume与普通retry只一provider。实际lease takeover后旧worker进度/完成/失败均不能写新worker或退款。 |
| E 终态和兼容 | provider失败/超时/明确取消只一次退款，迟到成功不写共享图；执行中撤权保留本人结果但无共享command，再恢复GET不新扣费；其他无project/个人/chat/workflow与原内部chat工具路径不新增canvas意图或二次扣费。原3f、Agent、3e消费者定向回归。 |

最终保存逐组覆盖、所有失败（区分fixture/业务）、命令/原始输出/开始结束/exit、候选SHA和资源句柄。独立规范/质量审查后，主控才登记新模块准确保护路径并运行38项保护；tsc与变更TS ESLint必须有实际结果，既有warning披露不伪装零警告。全仓构建、浏览器/Coze、设备/真实付费与发布仍属Task9，不用本地接口通过替代。
