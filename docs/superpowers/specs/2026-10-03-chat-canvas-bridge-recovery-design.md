# 独立聊天返回画布的账号隔离与逐项恢复设计

## 范围及证据

### 2026-10-04 刷新重开恢复接续（原H2，有界接线，fix1限定通过；浏览器部分补证，整体验收未完）

沿用原journal的固定operation/key与restoration映射，新增可选`metadataConfirmedSequence`，只作为“曾完成”的调度检查点，不授予权限、不证明当前远端内容，也不重建旧会话全部Ctrl+Z。检查点须来自既有受权重放、独立完整服务器目录证明，并在原scope Web Lock下复验绑定/回执后保存；备份已有检查点不得丢失或漂移。无消费者的原recover仍保持传输合同。

有真实metadata消费者的recover处理pending/accepted，以及尚无metadata检查点的confirmed attach；先受权恢复同一新身份，superseded不复活。独立服务器目录若已有完整metadata，只保存检查点，不再次发帧；只有完整目录证明metadata全部尚未写入时才可恢复，局部写入/冲突/目标墓碑/不完整或越scope/403不能作为补写授权。发帧前先refresh到metadata目录序号，以当前组属性和成员为基准；真实session写盘→帧→ACK→独立确认后才保存检查点。失败保留原意图和映射，callback截止10秒，不用本地投影冒充服务器完成。

实际workspace启动effect与外部重试按钮接原recover；冻结actor/project/epoch/Hook方法代际和当前refresh。raw Yjs recovery/rejected状态沿用原显式重试政策，不自动重发。恢复运行或失败待办以原transition token拒绝delete/undo/redo及普通图片/分组/标注编辑，但服务器document-source投影继续；失败不自动重试风暴，当前作用域明确重试，旧scope迟到不解锁新scope。无primary/backup/saving日志的作用域不要求Web Locks或等待普通Yjs编辑。全部是原H2实际consumer恢复，不新增业务阶段，不重做已闭原语，不代替真实双账号浏览器、完整第7项或发布验收。

Planck首审Important I1：pristine读回与catch-up后已送达的冲突之间有竞态。实际新Session/真实callback永久3行为RED证实catchup及write前冲突均错误发1帧、catchup已complete仍失败。fix1在catch-up后重新独立分类，complete仅checkpoint/conflict拒绝；旧HTTP证明仍可能在最后await后变旧，因此只在fresh-page调用现有restore时传`requirePristine:true`。Session同一同步方法、构造持久帧前检查实际Y.Doc目标group/annotation字段具体头、新annotation记录和墓碑头、旧记录/墓碑和存活组成员；冲突整次拒绝，不部分补写。原同活会话未传该标记，默认语义保持。修后3文件256/256及准确十文件507/507零skip，类型/目标lint0；Planck同席fix1 Spec/Quality PASS、I1已关闭、无新增C/I/M，三产品SHA/main/HEAD复算一致，席已关闭。首审否决与三RED保留，保护46阻断、workspace strict原6warnings，真实浏览器及完整第7项/发布仍未验证；第一次504是历史候选，不冒充修后证据。

当前状态（2026-10-04，覆盖下方历史）：原H2实际删除callback与同活会话共享media history已限定通过。原owner/editor两RED转GREEN，partial undo/redo交错I1经四项永久RED修复，最终40/40、九文件454/454零skip、类型0、client/test严格lint及workspace quiet0；Hume同席fix1 Spec/Quality PASS，I1 ADDRESSED，无C/I/M，席已关闭。workspace strict原6 warning、保护46阻断仍不放行，未扩白名单。原始证据/SHA/scope见`output/playwright/canvas-delete-consumer-h2-20261004.json`。不重开已闭Hook/ACK/metadata/标注原语；fresh reload日志/metadata阶段恢复、真实浏览器A删除/B待办恢复及undo-redo刷新重开/多账号项目/三工作区、全量/构建/NFT/保护/设备/Coze/CI/发布仍开放，不批准完整H2或发布。以下旧guard/两RED/复审中及旧计数仅作历史。

### 2026-10-04 删除入口与撤销合同补充（实际接线为本地候选，完整验收未完成）

I1恢复围栏裁定（同一原H2）：Hume首审发现部分media undo/redo失败后，新删除或普通编辑可清除未完成游标或替换已恢复prefix身份。永久两交错RED与两方向编辑fence RED后，在既有session历史中保留失败media的entry/direction；普通geometry/groups/annotations、新media历史、非media调用restore/rebind和反方向undo-redo拒绝，原方向重试可继续其restore/rebind/ACK，同一游标成功完成才释放。实际delete callback的scope retryDirection在HTTP前拒绝新删除并指示重试；它不是服务器授权或第二个持久状态机。旧scope断开不会影响新会话；fresh reload的日志/metadata恢复仍是下一未完成边界。fix1完整40/40、类型与目标strict/quiet lint0；Hume同席fix1确认I1 ADDRESSED、Spec/Quality PASS、无C/I/M，席关闭；首审No与原失败保留JSON。下段36/450是修前候选，不证明fix1。

首候选消费者覆盖（2026-10-04，修前历史）：实际handleDeleteCanvasImages已接既有受权journal与session共享media history。同活会话批次只登记confirmed且有服务器removeSnapshot的成功前缀；pending先ACK，actor/project/epoch/Hook方法generation冻结，reader仅找重试operationId，run仍锁内受权。undo固定restore identity/annotation map→metadata帧→ACK→独立确认→rebind，redo每周期新remove；成员phase只用于同会话partial retry，不作为重开后的证明。实际Hook发现新媒体时暂时unavailable不是scope改变；启动删除仍saved/pending，后续沿用身份代际及真实方法自检。36/36与精确九文件450/450、类型0仅受控本地证据，首候选当时Hume限定复审中，不批准完整H2/发布；完整JSON及原失败见output/playwright/canvas-delete-consumer-h2-20261004.json。fresh reload持久consumer/metadata阶段恢复、实际浏览器A删除/B待办恢复、三工作区、多账号项目及全量/构建/NFT/保护/设备/Coze仍开放。下方原UI guard与旧计数均历史，不用于重新派发已关闭的原语审查。

H2 当前最终覆盖（2026-10-04，会话身份历史原语限定通过，完整删除未完成）：Noether fix3只读复审确认I1/I2/N1/N2及恢复来源拒绝全部ADDRESSED，无新增Critical/Important/Minor；6项内存定向控制包括合法多字段两轮undo-redo、链式身份及全部退役noop不跨媒体边界，审前后两SHA/main/HEAD一致。批准的只有此会话接缝可继续H2，不批准完整删除、合并或发布，不重派已关闭的限定审查。主控历史45/45、原四文件171/171零skip；扩大七文件242项240pass/2原owner/editor删除guard RED保持。最终tsc、三路径严格ESLint/限定diff通过；保护44阻断、38功能身份/入口/合同保留，白名单未改。UI实际callback/实际scope validator四项账号项目迟到控制通过，仅受控边界；hook仍void。最终源码/RED/GREEN/限定批准scope见output/playwright/canvas-placement-history-h2-20261004-fix3.json；fix2否决和N1/N2失败保留历史。下一步接hook媒体history/restore/rebind与Promise透传及作用域门禁，再真实remove-attach/持久不确定恢复、metadata记录及原实际组合；准确全量/构建/NFT/保护/375px/正确Coze和发布仍开放。无DB/新浏览器/付费/推送/Coze/部署，Pear排除、PSD保留，目标active；下方复审中/旧候选计数均历史。

H2 fix1 最新覆盖（2026-10-04，复审中、完整删除未完成）：Noether首审No，Important2；永久30项27pass/3fail确认原生逆项误保留字段及首次绑定误认领远端字段头。I1按实际前后差量/方向记录成功字段后28pass/2fail；I2补永久退役远端覆盖意图和首次字段头基准，新增合并帧及后续本人编辑控制32项28pass/4fail→32/32。实际UI等待/忙态/异步报错六项回归通过，但hook仍未透传Promise或接真实媒体命令，不算端到端。扩大明确七文件225项223pass/2原删除guard RED，零skip、exit1；组合与首候选不完全相同，不移植192项口径。tsc、三路径严格ESLint/限定diff通过；workspace严格ESLint有既有6 warning而exit1，quiet零错误。保护仍44阻断、白名单未改。四源码冻结，Noether同席限定fix1复审中，不批准H2/发布；原始输出和SHA见output/playwright/canvas-placement-history-h2-20261004-fix1.json。接续真实remove/attach与持久不确定恢复、hook/UI作用域、metadata差量及原真实组合，再回准确全量/构建/NFT/正确Coze发布。无DB/新浏览器/付费/推送/Coze/部署，Pear排除、PSD保留，目标active；下方153项/独审中均首候选历史。

当前覆盖：H2身份历史接续候选已实现并有四文件153/153局部回归；Noether限定只读独审中，不能批准接缝。真实删除两RED和HTTP/持久恢复/UI/metadata/浏览器/发布仍未完成。下文138项及H1审查中状态是历史，H1限定审查已关闭；当前原始输出和源码身份见output/playwright/canvas-placement-history-h2-20261004.json。

最新覆盖：H1会话历史候选已实现，真实删除入口仍未修。新历史12项与原session/hook/media-sync同次138/138、类型/两路径严格ESLint通过；Hubble限定只读审查进行中，尚未批准。扩大七文件177项175通过/2原删除入口预期失败；保护门禁仍44阻断、白名单未改。下方“四产品未改”仅是较早RED基准历史，当前document-client已改变，不能引用旧聚合身份或旧局部浏览器通过为新候选发布证据。

最终测试基准已限定独审：补强真实setter权威、刷新project/sequence/POST顺序及真实目录parser/完整字段后9项7控制pass/2预期fail；相邻三文件39项37pass/2fail。Banach I1/I2/I3/Minor全部关闭，仅确认RED基准可用。下方首次8项为历史；没有删除/撤销实现或真实角色授权通过声明。

真实浏览器删除失败已由真实生产 `handleDeleteCanvasImages` 回调执行测试固化：新文件 `src/__tests__/components/canvas-document-delete-entry.test.ts` 首次8项为6控制通过、2预期失败，owner/editor两例均返回空数组，未进入文档命令；不是导入或环境错误。网络与React state是受控边界，未证明真实服务端授权或浏览器删除通过。

继续追踪确认该项必须连同原协作媒体撤销合同处理，不能只解除入口guard：

- 服务端现有 `remove` 保留资产与版本、添加摆放墓碑、移除分组成员、为依附标注添加墓碑；原始Yjs更新和旧命令重放均不得移除墓碑或复活旧身份。
- 现有 `undoLocal/redoLocal` 只操作本地来源的Yjs UndoManager；HTTP文档命令的远端更新不自动进入该历史。单独接POST remove会变成不可撤销删除，不满足保留已有Ctrl+Z目标。
- 不采用legacy DELETE/restore、旧项目快照回灌、原始Yjs增删摆放、手动API/SQL代替按钮，亦不放宽墓碑单调性或媒体授权。
- 后继设计应复用现有受权remove/attach与完整媒体刷新；撤销删除以原受管版本重新建立新摆放身份，旧墓碑不变，不创建新资产版本或积分动作。本人删除与本地几何编辑必须按实际顺序统一撤销/重做，远端编辑不进入本人历史；不能把两套互不排序的undo栈并排接到Ctrl+Z。
- 分组、标注及图片ID→placementID映射须跟随新身份；只保存并恢复本次删除涉及的内容，不用旧整组快照覆盖别人的后续修改。已被其他操作删除的分组不可偷偷复活。需验证图片/视频、批量部分成功、丢回执、撤权、切账号/项目、重载和本地pending更新边界。

上述是已证实的缺口及修复不变量，不是实现或完整设计定案。接续先完成命令与本人历史的精确接口/排序/恢复设计，再逐项RED→GREEN、限定独审和原真实浏览器组合；不得仅凭本次入口RED宣称删除或撤销完成。

#### 同日本人历史接缝裁定：H1（不关闭完整删除修复）

最终限定复验：Hubble确认I1/I2/Minor/N1全部关闭、无新增Critical/Important，独立143/143通过、源码SHA匹配；H1接口及会话失败合同可继续使用。仅此接缝通过，不替代H2的真实传输、身份历史迁移、metadata差量、浏览器或发布验收；下方“复验进行中”保留为历史。

fix2恢复门禁：较早已发送帧的ACK可以正常确认，但不得解除后续rejected/uncertain记录的恢复状态；未发送的rejected帧不能被旧重复ACK确认删除。新17项N1永久RED→GREEN、四文件143/143，Hubble同席限定复验进行中；不扩大成功定义为完整删除或发布。

fix1失败合同补充：live原生source栈只在Yjs apply成功后消耗；只读observer通知异常不传播到事务，状态置unavailable以等待后续权威通知。未应用更新以完整Yjs编码未变确认后只清自己的pending；状态不确定或清理失败保留既有rejected恢复记录，不能自动重发。metadata创建转换墓碑仅使Yjs逆操作失效，独立合法媒体redo按原序保留；用原生clear释放丢弃redo的keep引用。以上已永久RED→局部GREEN（新history16项、四文件142/142），Hubble首审两Important/Minor的同席限定复验中，尚未批准H1或完整删除。

会话接口新增 `CanvasDocumentMediaHistoryEntry { undo(): void | Promise<void>; redo(): void | Promise<void> }` 和 `CanvasDocumentSession.recordMediaHistory(entry): void`；`undoLocal/redoLocal` 扩为 `void | Promise<void>`。注册只记录已确认的本人命令，不执行HTTP或授权；真正的HTTP/幂等/刷新、原版本新摆放及metadata映射由后继删除接入负责。H1只确定顺序与失败合同，不把注入的媒体回调当真实服务端或浏览器证据。

会话维护一条带Yjs stack item身份或命令entry的本地历史。Yjs local-origin新增项和已确认本人命令都按发生次序进入undo，远端更新不入栈；新本人操作清redo。几何undo/redo仅预演当前项，不能因该项已被远端覆盖而越过命令边界偷偷撤销更早项。继续既有先写pending store再发Yjs帧的合同，写盘失败不移动历史游标。

命令undo/redo的Promise完成前拒绝第二次历史操作、注册或本地写；失败保留原项供同键恢复后重试，不自动吞掉并执行更早项。同步几何操作仍即时返回，不引入不必要异步。断开/撤权销毁会话后，迟到命令完成不得重新写历史或允许旧会话编辑。metadata创建撤销仍转换单调墓碑且不提供非法redo。原始Yjs增删媒体、墓碑删除、owner快照或legacy API均不放行。

2026-10-04实现补充：连续两次本地几何撤销也会停在中间值，新永久回归与交错媒体用例同次2项预期失败。既有预演编码仅传输Yjs内容，不包含UndoManager依赖的本会话Item.redone关联；候选用导出Y.Item/ID/clean-start/end接口按clock区间携带关联，预演前复制，pending持久化并live apply成功后才写回，合并结构按区间拆分，不把关联放进服务端文档或恢复文件。四步两轮undo/redo与append拒绝后同游标重试为控制证据，不宣称刷新后历史恢复。远端覆盖导致noop还曾误清媒体redo，新增RED后改为仅显式metadata创建墓碑转换才清redo；空操作不抹除命令重做。该内部Yjs接缝须经限定独审，未新增自定义快照回灌或媒体状态机。

后继H2必须补真实命令传输、删除中UI锁定与await错误处理、原摆放→新摆放的已有历史意图迁移、分组/标注差量恢复和持久不确定命令恢复；尤其“移动A→删除A→撤销删除→撤销移动”不能因A换了placement ID变成空操作。H1单独通过不证明这些合同。

#### H2 身份历史接续接口（2026-10-04，接真实传输之前）

Hook首审纠正：作用域失效不能仅等passive effect。`useLayoutEffect`只在cleanup撤销旧generation，确保新的提交layout阶段旧回调已被拒绝；setup不激活新token，不能让新回调访问尚未替换的旧session。新token仍由passive连接生命周期启用，不在render中修改ref，避免未提交渲染污染当前会话。actor/project×patch/record/undo的永久6项layout RED→GREEN留证，Galileo同席fix1复验已关闭唯一Important，只批准此Hook接缝继续后继H2；完整删除/持久恢复/metadata/浏览器及发布仍未完成。

Hook接线有界设计（2026-10-04）：在既有`CollaborativeCanvas`上暴露会话的媒体历史注册、字段恢复和身份绑定，undo/redo保持`void | Promise<void>`原返回，不吞失败、不另建任务。所有相关写入回调捕获当前generation；调用前检查仍是当前generation、媒体投影完整和session存在，继续由真实session检查连接/status/busy/版本及来源。已有patch/group/annotation同样走此作用域入口，避免旧回调读共享ref误写新账号/项目。媒体undo内可恢复/绑定但普通编辑与第二次历史仍被会话busy拒绝；断开或切作用域后旧媒体Promise只能向原调用者结束，不能重新登记新会话历史。真实Hook/Y.Doc测试的受控HTTP完整目录/socket不替代HTTP命令传输或UI/浏览器授权。不得因此关闭原删除两RED、持久命令日志、不确定回执恢复或完整metadata记录。

N2因果补充：字段失效检查必须同时发生在旧身份接续前和后继映射/字段头基准安装后。缺少恢复依据或当前头与恢复头不匹配的旧字段须永久退出历史意图，不能等到 undo 时临时跳过；后续本人编辑虽然获得新头，也不能复活这些失效旧字段。保留本人后续新编辑独立撤销/重做、旧操作合法几何部分及原分组/标注恢复正向控制。

N1有界修复设计：会话增加 `restorePlacementHistoryMetadata({ previousPlacementId, nextPlacementId, assetVersionId }): void`，只从已墓碑旧摆放读取 groupId/annotation，为已确认同版本新摆放恢复本次可选字段。仅写此前完全未写过的可选字段；目标已有字段头（包括同值、空值或删除历史）视为他人操作，绝不覆盖或认领。分组须仍存活。写入沿用既有 pending store 的先持久化再应用/发帧，使用不进入本人新编辑历史的既有差量来源，作为媒体恢复的一部分；失败不得登记所有权，重试不得重新认领远端后续头。成功后在当前会话保存实际恢复字段头及旧/新/版本来源，断开清除；rebind 的 transform 仍取 attach 首头，groups/annotations 只取匹配来源的实际恢复字段头。同一恢复调用可幂等，允许媒体 undo 回调期间调用，不解除普通编辑 busy 门禁。原多字段正向用例改由这一真实会话恢复写入执行而不是测试服务器的无来源 raw 写入；保留原值/墓碑/分组删除约束。接口不操作 HTTP、assetVersion、账务或 annotationRecords，真实媒体/UI/持久命令日志接入仍属未完成 H2。

N1覆盖fix1基准规则：真实attach只初始化transform，groupId/annotation的首写不能证明是恢复写入。两者须有可核的本次实际恢复写入与字段头基准才可认领；无此证据时不能撤销他人首写。合法恢复后的本人多字段历史仍必须可撤销/重做，不能为通过负控制而取消该正向目标。当前接口尚未提供可选字段恢复凭据，永久两RED保留；此要求不是完成设计或实现声明。

fix1 因果补充：原生 undo/redo 产生的后继项须从实际成功的前后差量生成，并按撤销方向反转；不沿用原意图全集。收到远端字段头覆盖时，本会话相应历史字段永久失效，后续本人编辑只能新增自身意图，不能复活旧意图。首次接续的新身份只以同 key 首次写入的 Yjs 字段头为基准，不认领当前覆盖头；必须覆盖 attach 与多次覆盖首次合并送达的情况。此为会话原语合同，真实恢复命令、metadata 记录恢复与服务端授权仍另验。

会话新增 `rebindPlacementHistory({ previousPlacementId, nextPlacementId, assetVersionId }): void`。仅接续已确认 remove/attach 且已读入会话的身份：旧摆放必须墓碑、新摆放必须存活、两者必须为指定同一版本。一次旧身份只允许一个后继，后继不得同时属于另一旧身份；同一绑定重复可幂等，链式恢复 P1→P3→P5 可接续，不能倒指墓碑、形成环或以版本替换冒充恢复。会话断开/恢复拒绝状态下不能注册；允许当前媒体 undo 回调在刷新确认后调用，不放开普通本地编辑 busy 门禁。接口不提供授权、不执行命令、不清旧墓碑或创建版本。

在既有本地 placement patch 提交中保留本次变更前后差量（完整原子 transform、独立 groupId/annotation），不保留整项目快照。首次身份接续把 placement 历史项转为同一时间线内的条件差量；metadata 记录仍走原生 Yjs 历史。多选一个操作仍一个历史项，各摆放/字段分别检查当前版本、预期值及本会话持有的 Yjs 字段头身份，避免他人的同值覆盖也被旧历史撤销。仅实际成功的字段进入逆操作，冲突项不产生可覆盖他人的 redo，不越过媒体边界自动执行更早项。分组墓碑不得复活，annotation 字段不存在时恢复为合法空文本；删除产生的 annotationRecords 新身份恢复仍属于后续 metadata 差量接入，不能用本接口冒充完成。

历史差量继续先写既有 pending store 再应用/发帧；写盘失败游标不动。绑定与历史均只活于当前受权会话，断开清除，刷新后的不确定 HTTP 恢复由后续命令日志接入，不宣称刷新恢复 Ctrl+Z 历史。原生未绑定用例及已关闭 H1 失败合同必须保持。真实删除入口、HTTP 幂等恢复、UI await/作用域守卫、metadata 差量、图片/视频/批量部分成功与实际浏览器组合均仍是 H2 未完成范围。

这是现有“三工作区共享项目、素材和结果版本”目标的接缝修复，不新增业务阶段。Provider/Admin/Credits、统一 Skill Runtime Task12、Brief→视频、多平台导出和已关闭矩阵不重新实施。Pear 按 2026-09-27 决定排除，既有 PSD 核心保留。

2026-10-03 独立复审为 No。外部 `../_tmp_e2e/chat-bridge-review-20261003/bridge-recovery-red.test.mjs` 直接调用当前消费者和挂接函数，4/4 预期失败：外国账号消耗记录、解析等待中切账号仍合并、B 同键重试 x420→200、A 已完成后被删除使 B 永远不再尝试。HTTP 和完整文档投影是受控边界，尚不是双账号浏览器或真库重现。

### H2 remove/attach 持久传输合同（2026-10-04）

#### 实际删除恢复前像（2026-10-04，本接缝本地验证，不代表完整H2验收）

本接缝限定静态审查与实际隔离真库验证已收口：三文件324/324、客户端46/46；原实际删除两RED保留。初次环境/夹具失败、最终输出、SHA及专用库清理见 `output/playwright/canvas-removal-snapshot-h2-20261004.json`。后继 metadata 新身份差量、共享历史、UI及完整组合仍未完成，不解除删除guard。

沿用既有 remove 命令、项目写锁和命令回执表，不增加端点、资产版本或任务状态机。`commitDocumentAssetCommandInTransaction` 在取得项目/文档写锁后，从实际 `previous` 文档捕获 `removeSnapshot`，与图、Yjs 更新和命令回执在同一事务提交。快照为 `{version:1, projectId, placementId, placement, groupIds, annotationRecords}`：placement 包含实际六维几何/版本及可选 groupId/annotation，不含 deleted；groupIds 仅包含本次删除实际移除成员的存活组身份，不复制组名/其他成员；annotationRecords 仅包含本次删除实际墓碑化的存活标注，保留原 sourceVersionId（包括 stale），不能猜为当前版本。记录复用画布结构验证、项目/来源绑定和确定性字段排序，深复制，未知字段/非法几何/异项目/异摆放拒绝。

回执增加可选 removeSnapshot，同键重放和丢 COMMIT 回执恢复必须返回原快照，不重新从当前文档捕获；当前授权仍必须复验。nullable JSONB 迁移幂等，历史 NULL 回执继续返回原三字段，不能由删除后投影或点击前快照伪造恢复证明。新的 remove 必须写快照；attach/replace 不携带。损坏或与请求项目/摆放/版本不匹配的持久快照拒绝，不产生替代写入。客户端日志必须保存、校验并比较整个快照；丢字段或漂移拒绝。历史无快照命令可确认已删除，但不能作为完整 metadata 恢复依据。

后继恢复按新 placement/annotation 身份差量接入：仅向仍存活的原 groupId 增加新成员，保留其当前组名、其他成员和后续修改，不复活组/标注墓碑。完整映射/共享历史/UI 与实际图片视频删除撤销重做刷新仍是原 H2 未完成项；本合同不解除删除 guard。

##### metadata 会话接线合同（2026-10-04，原H2接续，限定会话及Hook通过，实际UI未验证）

扩展既有 `restorePlacementHistoryMetadata` 输入，原三字段调用不变；可选 `removal: { projectId, snapshot: DocumentPlacementRemovalSnapshot, annotationIds: Record<string,string> }` 消费真实受权 remove 回执。snapshot 必须绑定该项目、旧摆放与版本；annotationIds 完整覆盖原快照标注、每个目标唯一且为全新未写过身份，旧标注必须已有墓碑。由后继持久消费者在任何帧前冻结和保存该映射，此会话方法不生成随机ID、不授权、不伪造回执；完整持久消费者尚未实现。

一次既有 pending 先写盘事务同时完成可选摆放字段、仍存活组成员追加及新标注，保留组当前其他属性/成员、原 sourceVersionId 和标注内容/时间；不覆盖已有新摆放可选字段头、不复活任何旧身份。成功后记录本次恢复来源、规范化输入指纹和实际字段头；同来源同映射重复调用不再写入或认领远端后续修改，漂移拒绝。映射碰撞、墓碑目标、缺失/重复/危险ID及异作用域在写盘前整批拒绝。断开/恢复拒绝门禁保留；媒体history回调内部可恢复，但不产生第二条原生Yjs历史。真实Hook先复验当前generation，并核对removal项目等于当前项目。

此方法只以当前已接收文档状态做同步差量，不承诺尚未送达的远端并发组字段合并，也不把本地 pending 当服务器确认。后继消费者必须等待权威帧确认并处理冲突；刷新后的同映射判断、annotation历史跨新身份接续、实际UI批量删除/恢复与原组合仍未关闭。

##### 恢复帧ACK等待合同（原H2接续，2026-10-04，限定通过）

现有session和真实Hook新增 `waitForPendingUpdates(): Promise<number>`，只观察既有有序WebSocket ACK队列，不新增端点/任务/版本/积分，不把本地pending或canonical snapshot当自己的ACK。当前可写会话且队列为空时返回已接收canonical/ACK的最大序号；有pending时须等待队列全部获ACK并仍saved/连接可用，返回可用于后继独立目录readback的序号。依赖既有有序ACK协议，此结果不是完整metadata内容或当前授权证明。

10秒有界等待，超时只拒绝和移除等待者，不删pending/改变历史游标；后继重试可继续等待原帧。断开/拒绝/恢复/撤权/observer失败时拒绝并清理等待者，不伪造成功；支持多个等待者，resolve/reject均清timer，disconnect主动拒绝。媒体history busy内部可await，不解锁第二历史或普通写入；Hook在调用前及await后复验当前generation、媒体完整性及同session身份，旧账号/项目回调和ACK后作用域切换都不能交付成功。调用方仍须独立受权目录确认metadata，再rebind/完成媒体history；真正UI和刷新映射恢复尚未闭环。

Bohr限定规格/质量审查通过、无Critical/Important/Minor；独立17/17定向及14内存控制，五SHA/main/HEAD未变，席已关闭。准确十文件456pass/实际UI两RED、类型/strictlint通过，保护46阻断。scope仅此ACK接缝，不批准完整H2/UI/发布，原始证据见output/playwright/canvas-pending-ack-h2-20261004.json。

受权metadata读回接续（原H2，有界接线，fix2限定通过）：原document-history-command内增加 `confirmDocumentHistoryRestorationMetadata({ ...restorationInput, documentSequence })`，先校验ACK序号为非负安全整数，再复用既有同scope锁/摘要/重放路径复验原remove前像及固定attach/map；只有confirmed目标才另取完整受权服务器目录。目录须当前可写、同项目、完整且sequence不小于ACK和attach回执；旧placement保持同版本墓碑、新placement同版本存活，可选字段与实际前像一致，仍存活原组包含新身份但不含旧身份，组当前其他属性不回灌。原标注与墓碑保留，新映射记录只改id/sourceImageId、完整内容/原版本/时间保持、目标无墓碑；JSON对象属性顺序不影响比较，数组仍有序。已墓碑的组不要求复活。最终HTTP/body及scope沿用原10秒deadline/每await复验；失败不写metadata、不注册history、不rebind，不把attach journal的confirmed冒充完整恢复完成。不新增槽/状态机/版本/费用，不解除UI守卫；后继实际消费者按restore→会话metadata帧→ACK→本读回→身份接续/成功history调用。

受权读回删组例外（同一原H2，fix2限定通过）：annotation仍严格对比；groupId单独比较，仅原前像中的groupId对应当前服务器groupTombstones=true时允许新摆放无归属（undefined或null）。这覆盖删组发生在metadata帧前/后，不恢复已删组、不允许转归其他组；原组仍存活时严格匹配原groupId。真实tombstoneCanvasGroup的两个有效RED及live-null/异组拒绝控制保留，最终98/98；不扩张为整个metadata/UI完成。

标注历史身份接续（同一原H2，有界现有会话延伸，fix1限定通过）：applyLocalAnnotations记录实际前后完整record意图，来源/project/version改变不作为可迁移内容编辑；在现有restore成功记录的新头与annotationIds基础上，由原rebindPlacementHistory安装链式映射。与placement/media同一cursor按原顺序迁移native条目及其undo生成的redo，原ID墓碑从不复活；原sourceVersionId和内容/时间只按实际本人逆意图改变，新的id/sourceImageId固定到后继。未映射的其他标注保留原身份。当前Yjs具体头与期望语义record双重匹配；对象键无序、数组有序。远端首写/同值新头和rebind前后覆盖永久退役旧意图，后续本人编辑不认领。pending先写盘拒绝不得移动cursor或丢旧逆项。本人创建撤销只墓碑当前新ID，禁止该ID非法redo，但按本次真实墓碑ID精准裁剪逆项，保留其他annotation/media/placement/native条目及顺序，不全局清除合法redo。原Hook无需新公开接口；真实UI仍未解除guard。

##### 持久恢复身份绑定（原H2接续，2026-10-04，限定通过，实际metadata帧及UI未接）

沿用document-history-command的同账号项目journal/Web Lock/saving/previous备份，不增加存储槽或业务状态机。attach条目可带restoration `{ removalOperationId, annotationIds }`，指向同日志内confirmed remove及其完整前像。`runDocumentHistoryRestoration({ ...boundary, operationId, removalOperationId, annotationIds? })` 每次先同键重放原remove复验当前授权与完整服务器目录，再从其实际删除前像派生同版本attach及六个几何字段。映射完整、目标唯一安全且不复用日志中的旧身份/先前恢复目标；首调用须提供完整映射，重试可省略、不得改变。同operationId不能把普通attach或另一删除认作该恢复。

映射在attach首次POST及任何后继metadata帧前，经既有save读回确认冻结；丢attach回执、媒体刷新失败与刷新后重试使用原映射/operation/key/placement。reader仍仅结构检查；返回值只能来自本次受权重放与独立目录，包含confirmed或superseded attach条目、原remove前像及映射，不自动登记历史或应用metadata。已superseded不冒充恢复成功。普通run/recover保留该绑定，备份完整性检查不能丢失或漂移绑定。旧无前像remove仍可确认删除，但不能恢复完整metadata；保存/授权/scope失败禁止新attach和后继帧。

裁定：这是现有日志的受权恢复身份消费者，不等同完整删除UI。接续仍须实际metadata帧ACK/权威确认、原标注历史迁移和成功sharedhistory，最后接UI/批量/原组合；本轮不解除删除守卫、不改旧已闭会话实现、不新增版本或费用。常规设计确认按用户既有免确认授权执行，main-only及发布门禁保持。

当前限定结果：Sartre首审I1普通run/recover省略remove前置及Minor首次隐式空map，经永久9行为RED后两项同席ADDRESSED、规格/质量限定通过，无新Critical/Important。三个入口共用同锁内remove回执/授权/目录复验，无递归锁；首次即使无标注也须显式{}，已有绑定重试可省略。最终73/73及准确十文件439pass/原实际入口2 RED，类型/strictlint通过，保护46阻断；完整首审/修复证据见output/playwright/canvas-restoration-binding-h2-20261004.json，不批准完整H2/UI/发布。

上节metadata会话的限定历史结果（不是本节持久绑定审查）：四文件234/234、命令真库61/61、类型及四路径严格lint通过；准确十文件412pass/原实际删除两RED保持，保护46阻断。Epicurus规格/质量限定通过、无新增问题，不批准完整H2/UI/mapping/发布。永久RED、原失败、SHA及专用测试库精确清理见output/playwright/canvas-metadata-restore-h2-20261004.json；不重开既有已闭接缝。

最终限定批准：Feynman同席fix2已关闭原I1/I2/M1/M2及新增N1，无新Critical/Important/Minor，源码hash审前后一致；只批准此传输接缝可继续metadata/UI接线。最终37/37及准确七文件328pass/2原UI删除RED、类型/lint证据见fix2 JSON，不证明整体H2或发布。下方30项/独审中保留为首候选历史；受权删除时metadata前像、完整恢复映射与真实组合仍须补齐。

当前实现/验证：见同名计划“持久传输接缝实施”和output/playwright/canvas-document-history-transport-h2-20261004.json；新30/30及准确七文件321pass/2原删除RED仅本地受控证据，限定独审中，完整metadata/共享历史/UI尚未接线，不放行删除或发布。HTTP/body之外，媒体refresh也有10秒截止；已superseded的attach显式重放若refresh失败须保持该终态，不能降成可恢复accepted重新认领。

沿用现有文档命令与统一历史；传输层不拥有历史游标、metadata 或任务终态，不另建服务器状态机。文件 `src/lib/collaboration/document-history-command.ts` 只负责命令的冻结、持久化、受权重放和目录确认，原聊天日志合同保持不变。

- `runDocumentHistoryCommand` 接收冻结 actor/project、调用方持有的 operationId、remove 或 attach、Storage/Web Locks、当前作用域检查、HTTP 边界和真实 refreshMedia。一次删除或一次撤销/重做周期各有独立 operationId；同一次失败重试必须复用原 operationId 与完整命令，不因布局或新回执改变。新周期不能重放旧 remove 键冒充删除新摆放。
- 日志按 actor/project 隔离；每项保存 operationId、规范化完整命令、SHA256 幂等键、pending/accepted/confirmed/superseded、attempted 和严格回执。键由 `[actorId, projectId, operationId, command]` 派生并在读入后重新核验。只支持 remove/attach，不接受 replace、媒体 URL、凭据或伪造 actor body。
- run/recover 的读改写/恢复共享该 scope 的 Web Lock；缺能力、损坏、异 scope、重复 operationId/键、命令漂移均拒绝并保留旧 raw。导出 read 是检查展示接口，只做结构校验、不取锁不核SHA，不是历史注册、授权或恢复依据；后继必须使用run/recover受权结果。
- 保存已有日志前，把原raw精确写入同scope的`:previous`并读回；备份拒写或读回失败时不覆盖主日志。主日志写入/读回失败后在同锁、同scope回滚旧raw并读回；回滚也被拒绝/无法确认或scope已改变时返回`DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED`，旧raw仍在备份，不能保证故障Storage下主key原文始终不变。备份不作为授权凭据或自动消费入口；保留它直到明确恢复，不自动删除。首次空日志保存失配则恢复原空状态、零POST。首次 POST 前意图与 attempted 必须写盘且精确读回；不删除终态或自动淘汰待办。
- 连续调用安全：主日志写入前持久设置同scope的`:saving`标记并读回，只有主保存或回滚已精确确认才移除并确认标记。锁内run/recover/save遇标记即RECOVERY_REQUIRED，不能消费空日志或覆盖旧备份。兼容无标记的先前候选时，也要比较备份与主日志的operationId/key/command/已知receipt；主日志缺旧身份或回执即继续RECOVERY_REQUIRED，身份键/命令漂移拒绝。只检查完整性，不自动采纳备份为服务器授权；后继实际UI需提供明确恢复说明与受权恢复路径，当前不解除删除guard。
- 每次显式执行（包括已 accepted 或 terminal 重试）先重放服务器原命令，复核当前授权与原回执。服务器真实 session 仍是唯一授权来源；冻结 actor 只作为一致性 header。POST/JSON 与独立目录 GET/JSON 均有 10 秒截止，abort 不生效也要释放锁；迟到结果不能写日志。
- 回执的版本必须对应原命令；remove 的摆放必须对应原摆放，既有回执的三字段不得漂移。accepted 保存后才 refreshMedia，再独立 GET 完整 `document-project`；活动 Y.Doc 可带本地 pending，不能替代服务器证明。目录必须同项目、可写、完整、sequence 不小于回执；remove 必须看到同版本旧摆放墓碑，attach 同版本新摆放存活则 confirmed，否则 superseded，绝不复活旧身份。
- `recoverDocumentHistoryCommands` 只恢复非终态项；逐项确认即持久保存，后续失败不丢先前成功。账号/项目每次 await 前后复核，包括最后一项返回和整个Web Lock请求返回；等待锁、解析或最后成功微任务中切 scope 不向消费者交付旧作用域成功。
- 本传输合同不证明 UI 删除、持久 metadata 恢复或刷新后历史重建。后继消费者必须先持久冻结删除涉及的几何/分组/标注及恢复映射，按真实命令成功顺序注册共享历史，并保持部分成功可撤销；完整接线与真实组合通过前不解除原删除 guard。

## 方案选择

采用现有文档命令加浏览器账号/项目隔离日志。不另建服务端任务队列、不把位置加入新的幂等键、不新建资产版本、不改变积分。使用仓库已有 `navigator.locks` 注入式互斥模式，能力不存在时保留记录并显示不可恢复原因，不能降为无锁写入。

新职责模块为 `src/lib/simple-chat-canvas-bridge.ts`；发送方和画布只接线，不整体重构大型组件。旧 pure helpers 和 URL-only 拒收安全合同保留。

## 持久合同

- storage key：`wujie:canvas-bridge:v2:` + `encodeURIComponent(JSON.stringify([actorId, projectId]))`；不同账号、不同项目互不覆盖。
- envelope：`{ version: 2, actorId, projectId, items }`。只存身份、固定命令和进度，不存媒体 URL、凭据或浏览器会话。
- item：`{ assetVersionId, placementId, entityId?, slot, idempotencyKey, command, state, receipt?, documentAttempted? }`；新增标记只接受true，第一次文档请求发出前必须持久化并读回。
- `slot` 在新项首次入队时取该项目日志原有最大 slot + 1；重复身份不得重新分配。按原有布局生成固定 x/y/512×512/rotation0/zIndex1。过滤、追加、刷新、重试不重算命令。
- 幂等键沿用 `chat-bridge:` + SHA256(JSON.stringify([projectId, assetVersionId, placementId]))；服务器仍按真实 session actor、项目、键和完整 command digest 验证。
- state 为 `pending | accepted | confirmed | superseded`。accepted 有经过服务端响应验证的 receipt；本地状态不是授权凭证。
- receipt 为 `{ placementId, assetVersionId, documentSequence }`；版本必须等于原请求，sequence 必须为非负安全整数，placement 非空。保存成功并读回相同日志后才继续下一项。
- storage 异常、无锁能力、损坏或 scope 不匹配均不得删除或覆盖旧记录。读写/消费共享同一账号项目锁，追加不得被消费时的旧快照覆盖。
- 锁内复用、追加或消费前须重算既有每项SHA256，不能只检查键格式；错误键保留原raw，不自动换键，旧迁移不得清理来源。
- 完成日志保留固定命令和terminal状态，不删除整个scope key。否则服务端仍有回执、客户端却把同一placement重新分配slot，会制造新的摘要冲突；再次入队必须复用原项。全部terminal表示零待办，不表示删除幂等历史。不得因空间不足自动淘汰未完成项或固定命令；配额失败显示保留待办的错误。

## 发送方合同

以 ChatArea 已有 `user.id` 和当前 project/task 冻结请求作用域，并通过实时 ref 在每次 await 前后检查。任务持久化、transfer 响应解析、入队、导航和成功提示都必须仍在同一作用域。

每个 transfer 成功后即把该受管版本/placement 写日志；后续 transfer 失败不丢已成功项。原服务器 transfer 权限及 restore 合同不改。重复点击复用原日志命令；不能用再次发送来复活已消费后被删除的文档 placement。

发送成功只表示“已发送，等待画布接收”，不是“已添加”。未成功保存日志不可导航或呈现成功提示。协作编辑者向他人所属项目的来源转移能力单独按实际 API 证据核验，不在此设计中假称 batch-transfer 已允许。

## 消费与授权合同

先确认当前账号、当前项目、文档权威/legacy 状态和 hydration；账号不符必须零解析、零命令、零合并、零清理。每次异步边界及持久化/删除前复验冻结作用域。

文档分支直接把冻结的 ID-only attach 命令送到现有 `/api/collaboration/document-assets`。该端点已有 session actor 授权、项目 owner 版本归属、ready 媒体验证、摘要与重放合同；不用 owner-only `/api/assets` 的 404 来判定协作引用已删除，也不传伪 owner。客户端 URL 不参与受权或落图。

2026-10-03 外部真实路由单元测试补证：`../_tmp_e2e/chat-bridge-review-20261003/bridge-actor-route.test.ts` 控制 session 与命令 I/O，保持真实 NextRequest、来源校验、解析和路由响应；5项4控制pass/1预期fail、exit1。请求冻结A而会话为B，现有路由返回200并把命令交给B执行。不是双标签浏览器或数据库授权绕过复现；如果B确有项目权限，仅前端ref仍不能阻止A旧页面的意图被B承接。

桥接文档命令须带 `x-wujie-expected-actor-id`，值为日志冻结actor。既有路由在会话及来源校验后、执行命令前，若该header存在且不等于真实session user.id，返回409 `ACTOR_SCOPE_CHANGED`，不得执行命令。header只是意图与会话一致性检查，不是身份或授权凭证：匹配后仍以session actor执行全部原授权；不修改body strict schema。不带header的既有调用保留原合同；桥接新消费者必须发送header，不能通过省略规避自身账号scope检查。零命令副作用、匹配控制、无header兼容、无session401和错误origin403均须成为永久路由回归。

2026-10-04复审修正：真实`CanvasDocumentMediaSync.refresh`返回的是当前Y.Doc的媒体视图，可含未确认的本地删除，不是纯服务器快照。文档请求发出前先保存`documentAttempted:true`；丢响应或accepted写盘失败后，pending仍不能交给legacy合并。该新模块尚未接生产UI，因此此前模块测试生成的无标记pending不属于已发布日志迁移；不能为无账号旧记录猜出历史命令是否成功。

收到真实有效回执后先持久化 accepted，再调用现有 `refreshMedia({ projectId, documentSequence })`协调UI。随后读现有`GET /api/collaboration/document-project?projectId=...`，使用真实`parseDocumentMediaDirectory`校验完整服务器投影、项目身份、媒体目录、readOnly=false和sequence不小于回执。POST及GET都发送冻结actor一致性header，GET失配409且零目录读取，session仍唯一授权来源，不带header的旧读调用不变。只有此独立服务器读回可以确认终态：

- 服务器投影含未删除的回执 placement 和同一版本：confirmed，本地pending删除不会误标superseded。
- accepted 项恢复时仍通过同一 command 授权重放取得真实回执；完整投影中回执 placement 已缺失或变成其他版本：superseded，尊重后续删除/替换，不复活，继续其他 pending 项。
- 首次有效回执到读回之间发生后续删除/替换，同样只在完整权威读回后判 superseded；不能把网络失败、目录未完整、401/403、错误 JSON 或其他异常当成 superseded。
- confirmed/superseded 不再次挂接；局部失败保留其进度，下一轮只接续待办。全部完成且 scope 未变时回 `consumed`，保留终态日志以冻结后续重复入队的原命令；不能删其他项目或旧全局日志。

legacy 画布仍使用真实 `/api/assets` 解析的受管引用及原 setImages 权威包装器。合并拒绝时保留日志；原图和版本不覆盖。原始 slot 布局不因 resolver 过滤改变。

文档POST/GET的10秒deadline包括fetch及JSON解析，Promise.race不能只依赖传输服从abort。超时释放scope锁，保留pending尝试或accepted状态；迟到读取不能落盘或覆盖新追加。UI refresh自身已有30秒批次上限，不改变其返回合同。

## 无账号旧记录

`wujie_canvas_bridge` 不自动归属当前登录者。匹配项目的全部受管引用通过当前账号的 owner-only 原解析器精确核验，且每个 await 后 scope 不变，才可迁入账号日志；原数组去重后的原始顺序作为 slot。任何 404、403、暂不可用或不完整身份均保留原记录，显示“旧记录来源未确认”，不转为成功或空消费。

迁移入队与原 raw 比较成功后才删除旧 raw。若原 raw 已改变则不清理，保留新写入。旧命令若已产生摘要冲突，不换键、改位置或再创建副本；保留可诊断冲突，后续按真实服务端记录核对。不能从旧 payload 无法证明的进度猜出已完成状态。

迁移从UI独立调用，不能在持有scope消费锁时再递归申请同一锁。迁移使用固定legacy锁保护旧raw，再调用拥有scope锁的入队函数；消费者和普通入队不反向申请legacy锁，避免循环等待。

## 验收及发布边界

永久行为测试须覆盖本次 4 个 RED、同账号正常控制、401/403/错误回执、部分成功后重载、删除/替换不复活、日志追加/互斥、storage 失败和旧记录迁移拒收。真库须验证同键同 command 重放只一条、变更 command409、被删后重放不复活、撤权不能重放。

发送方外部追加回归 `../_tmp_e2e/chat-bridge-review-20261003/bridge-delivery-red.test.mjs` 在真实普通/导出发送helper上同次6项2控制pass/4预期fail：第二项失败未保留第一项；异步交付尚未持久化即成功返回。只控制transfer与交付边界，不宣称云端数据丢失。永久测试还须验证零待办后重复入队原项仍保持原slot/key/command且零额外挂接。

真实 Edge 隔离浏览器须做多图部分失败恢复、同浏览器账号切换、刷新保持原版本以及可见等待/失败提示；不能用单 PNG 历史证据代替。2026-10-04原全量CI75455句柄及进程均已消失，日志无全量汇总，原源码身份未变；该轮结果为中断/未完成，解除被测源冻结后才实现局部guard和Task1日志。设计和计划不在脏 main 中单独提交；独审、保护基线、新准确候选全量 CI/构建/严格 NFT、正确 Coze 及发布级未验证项仍须分别通过，不能批量放宽白名单。
