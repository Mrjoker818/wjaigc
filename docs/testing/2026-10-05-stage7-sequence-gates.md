# 整体第七项执行顺序与前置门禁纠正

## 2026-10-17 后续执行规则引用：仅登记，当前不重启

第七项后续执行统一遵循[目标范围决策中的 2026-10-17 六条规则](../superpowers/specs/2026-09-27-upgrade-goal-scope-decisions.md#2026-10-17第七项后续执行规则仅登记不重启)。完整规则仅在该处维护，不另建平行版本。

当前交付继续原接续点，第七项仍为 **DEFERRED / 未验收**。保留现有 Yjs 与业务权威，不把连接失败直接归因于 Yjs，不预设 HTTPS 最优；后续按原入口可修复性、部署授权及 Coze 托管约束评估通道。每轮必须明确假设、验证边界与停止条件；先隔离验证单一主通道，保留原完整验收要求及安全保护。主线固定后再隔离开发，合并、Coze 同步和独立 Edge 真实验收串行执行。

下方旧“当前／前置／冻结后继”段落保留为历史，不能覆盖该最新规则或用于中断当前交付、立即重启第七项、无限等待平台、无新证据重复失败尝试或重跑全量测试。本次不新增付费、服务器、公网隧道或正式部署授权，不改变历史失败与未验收状态。

## 2026-10-09 15:24 当前接续：第七项延期，进入整体第八项

依据用户最新明确要求，第七项在当前 Coze WS 外部条件仍未恢复时暂时跳过，状态 **DEFERRED / 未验收**；保留其全部剩余业务、安全、生产/云端验收与失败证据，不记通过，不再重复同一方案。当前接续为整体第八项手绘草图转代码，再做排除延期协作项的其余平台回归；不把内部 8C/8D/8E/Task9 当作整体第八项，也不把其余回归冒充全部发布通过。完整决定见 `docs/superpowers/specs/2026-09-27-upgrade-goal-scope-decisions.md` 的15:24段。

本地本轮发现并修补了首次项目加载/新建竞态；连续点击和失败后恢复也先RED再GREEN，相关16文件121项通过，完整非增量类型检查原生0、限定独审无Critical/Important。原生产浏览器仍保留1FAIL；修后开发浏览器被首次接口编译7.7秒触发原5秒断言超时，未放宽原断言/超时，未取得修后生产或Coze通过证据。修前12415 COMPOSED覆盖及同树构建保持历史，不自动迁移到修后源码。

下方所有“当前/冻结后继/第7前置”的排队要求按历史保留，不再优先于本段用户决定。整体1–6与已闭分享冻结，Pear取消/PSD保留，main-only/stable只读，目标工具active。

## 2026-10-09 当前执行口径：本地测试，Coze WS 任务不重复派发

依据用户最新决定，GitHub 仅作同步和拉取；旧 Actions 账户付款/支出上限/制品配额不再阻塞本地测试，不重试或等待 Actions。执行位置改变不等于验收标准取消：完整回归、独立 MPE、隔离 PostgreSQL、类型/代码/依赖/保护检查、当前源码构建/严格 NFT 和仍开放的原浏览器矩阵均在本地取得绑定版本的证据。旧版本或局部证据不自动迁移到当前完整门禁，已闭且未受影响的切片不重跑。

2026-10-09 02:05Z已收到用户提供的Coze只读诊断报告，报告称未改文件/环境/配置，短tree和构建值与当前main前缀相符；主控仅独立核对本地代码及既有证据，未取得新云端运行结果。配置匹配不等于实际请求头经过平台代理仍被保留；报告缺少本次必需头入站、有效票据握手和选中子协议、presence/Yjs业务成功证据，因此不接受“WS已恢复/平台无需支持”的结论。工作状态awaiting_ws_acceptance、goal工具实际active，第7仍OPEN。不再标为任务执行中，不重发相同任务或登记为verified wait。下一到正确独立Edge、已有授权项目/身份验证真实协议协商和在线/同步，再验原多身份/撤权/重连/双实例/重启门禁；浏览器URL校验受限时不旁路。保留Origin、短期票据及双子协议；不验右侧iframe，不以本地PASS、静态报告或代理外侧101代替真实云端链路。

完整决定见 `docs/superpowers/specs/2026-09-27-upgrade-goal-scope-decisions.md` 的 2026-10-09 段落。第 7 项仍 OPEN，整体 1–6/已闭分享冻结，第 8 项未启动，Pear 已取消且 PSD 核心保留。以下旧“最新/当前”和 GitHub 账户恢复前置仅属于历史时点，不能优先于本段。

最新集中收口（1210–1213）：1211受控延迟真实末次projection，原两retry业务断言结束后各仍有一条completion未结算，完整九案2FAIL/7PASS/零skip/native1；失败出口仍先排空后清schema。仅compliance测试观察singleton的真实start/completion/failure-record链并在返回前释放gate、allSettled排空，生产及原报告/账务/授权断言不改。strict lint、非增量tsc原生0及同席限定C0/I0/M0后，1212九案9PASS/零skip/native0、19.93秒，3664输入零mismatch、primary0/0、PGstop0，55496/pidfile已消失。只关闭两夹具清理生命周期问题。1213准备按实际1012文件集合精确分组并另跑MPE，清单/语法检查不是全量通过；事实以后续原生运行及JSON终态为准。后续完整覆盖/独立MPE→当前源码构建→真实Next→正确Coze，1189/1190失败绑定未绕过。第七项及发布OPEN，许可不扩、原服务/stable保持，无安装/付费/同步/部署。详细证据只看 docs/superpowers/plans/2026-10-05-stage7-batch-closure-v1.md，既定顺序、Pear移出/PSD保留不变；下方旧检查点仅历史。

最新生产控制连接检查点（640–651）：641四新增RED/原七PASS；642强化后两案actual stream.closed=false、两案原control错误丢失。最小生产修补分别聚合操作/end错误，end同步throw仍destroy具体stream并等待close、清deadline，643十一PASS。首strictlint的no-this-alias/native1保留，等645终态29文件160PASS后只改collector；648在649前冻结54输入，649最终29文件160PASS/零skip/native0/147.75秒、六路径strictlint/非增量tsc终态0、冻结到终态零mismatch。647同席限定关闭两生产具体缺陷及collector Minor，无新增C/I，不等于整个deadline/WS关闭。646源码保护仍62BLOCK/allowlist未扩；650专库有限READ ONLY样本保持、隔离schema/其他非idle为0，原5010/55494/main/stable/index及.next保持。下一先补false termination/操作先结算release竞态，再checkout/身份采样/TLS网络/COMMIT/101后维护等；修后完整构建/正式身份/全平台/Coze门禁仍OPEN。详651报告。顺序仍只读分享已闭→WebSocket前置（当前）→8C剩余→8D剩余→8E→内部Task9→整体第八项草图；后继冻结，已闭1–6/Lovart/分享不重做，Pear移出/PSD保留。下方旧“最新/当前/进行中”均属历史时点。

最新限定检查点（631–639）：原生产错误聚合/SQL观察两项I已获限定关闭；新测试回收身份及body＋cleanup错误两项I经632四真实RED/三PASS→633七PASS及639同席复审限定关闭，无新增C/I。634在635前冻结54输入；635终态29文件156PASS/零skip/native0/144.95秒，六路径strictlint/非增量tsc终态0，冻结到终态零mismatch。相对629只改新增测试，不扩大生产或功能范围。636源码保护仍62BLOCK，allowlist未扩；637专库有限READ ONLY样本保持、隔离schema/其他非idle为0，原服务/main/stable/index及.next保持。当前生产control end双故障、release竞态、checkout/网络/COMMIT/101后维护及修后完整构建/正式身份/全平台与Coze门禁仍OPEN。下一先补生产control操作/end双失败，不以测试helper修补代替；详638报告和639审查。顺序锁定：只读分享已闭→WebSocket前置（当前）→8C剩余→8D剩余→8E→内部Task9→整体第八项草图；新Yjs/8D/8E/草图仍冻结，整体1–6/Lovart/分享不重做，Pear移出、PSD保留。以下旧“最新/当前/进行中”仅属历史时点。

最新升级前 SQL 修补检查点（605–620）：测试辅助原两项 I 已由同席复审限定关闭；606双失败RED→607/608三个控件PASS，609共享预算退化实败并撤回，610仍9PASS/两原生产RED。生产首轮612只销毁TCP虽close返回但原waiter仍1，原失败保留；改为升级级5秒宽限取消、精确backend身份核验及独立限时控制连接确认服务端终止后，614过滤两业务PASS/九skip，615在616前冻结53输入，616完整28文件148PASS/零skip/native0/135.71秒；四生产strictlint和非增量tsc主控均观察native0。生产独审仍进行中，尚不关闭完整deadline/WS阶段。618同旧590基线保护仍62BLOCK（含新增helper）、allowlist未扩；620专库READ ONLY有限样本及schema/非idle条件保持，原5010/55494、main/stable/空index和原.next未动。本次修后完整构建/严格NFT/真实Next与正式Git身份未新验，旧581–584仅属修前历史；pending checkout/网络/COMMIT/二次成员复验故障及101后维护等待等未验边界仍OPEN。下一先收独审及这些WS前置，不推进新的Yjs/8D/8E/草图。只读分享和整体1–6/Lovart不重做，Pear移出/PSD保留；详621报告。下文旧“最新/当前”均属历史时点。

604同席诊断测试复审C0/I2：当前两个业务RED有效，但新增恢复辅助的累计期限和双失败错误保留仍需修补/真实控件；先收这些测试辅助欠项，再实现生产deadline。不可把该审查或602普通finally完成当强制恢复/阶段通过。其余口径见下条和600/604报告。

最新 SQL 关闭截止诊断（597–603）：598初版两业务RED/原六控制PASS；独审后仅deadline分支修正取消误拒、单调六秒预算，601过滤两RED/六skip，602强化实际会话超时0与PID身份/事务/连接断言后全套六PASS/两RED/零skip/native1。实际仍有一被锁查询且close未结算，生产未改、缺陷OPEN。超期精确backend恢复支路尚未实跑，不称清理全验；当前单路径strictlint/非增量tsc原生0，599/603专库READ ONLY有限样本及schema/非idle条件0保留。下一步拥有升级级取消与真实连接回收，再RED→GREEN/回归/独审，不推进Yjs后继；详600报告，下方“最新/当前”只属历史受验时点。

最新真实 Next 自然退出检查点（573–591）：当前3641源码物理副本逐SHA核对，581四步完整构建/native0，582严格NFT0（235路由/230393引用/67宽，配置/根文档污染0），583实际产物两文件15PASS。584真实Next无DB烟测HTTP200、拒绝401/403、幂等close/端口重绑定及自然退出native0、watchdog=false；不是成功101/云端/OS信号。587诊断控制10PASS，589私有读写及九回退拦截控制PASS；guard仅覆盖三已知回退根的所列FS接口，不称全文件系统沙箱。590保护仍61BLOCK，591专库READ ONLY限定计数/sequence保持；旧失败及无DB/Yjs/安装尝试失败警告保留。先补WS剩余信号/SQL永久等待deadline、源码准入/全量业务/正式Git身份及Coze101/多实例/重启，再8C剩余→8D→8E→内部Task9→整体8；后继仍冻结，已闭切片不重做、Pear移出/PSD保留。详情见593报告、594同席审查；本条以下“最新/当前”均属历史时点。

## 2026-10-05 当前：退出边界推进与数据目录竞态限定修补

最新数据目录竞态修补检查点（550–570）：先补WebSocket前置，不推进新的Yjs/8D/8E或整体第八项。551/552真实双worker探针同名删除触发ENOENT与回退，越界写被夹具阻断；独占随机探针最小修补后563三文件7PASS。562漏close受控变异确实FAIL并精确撤回；564在565前冻结51输入，565终态28文件143PASS/native0，566严格lint及567非增量tsc native0/空stdout/noTee。同席限定复审C0/I0/M0，只收口本次并发探针缺陷，不关闭WS或第七项。详 `docs/testing/2026-10-05-stage7-sequence-gates.md` 及571报告、572审查。

531构建虽四步0，却实际三次回退已有 `/space/wujie-data`，不称隔离成功或业务数据未触碰；549是PASS而非RED，546–548为夹具加载失败。所有旧“最新/当前”段落仅属历史检查点。修后完整构建/真实Next自然退出与诊断helper I/M、61保护BLOCK、正式Git身份/全量业务/Coze101/多实例/重启等仍OPEN；只读分享和已闭1–6/Lovart不重做，Pear移出、PSD保留。

485–549前段补证也未关闭阶段：500真实raw/HTTP/连接失败五案PASS，507二十一文件129PASS；502/505当前源码副本四步构建0、513严格NFT0及514实际产物两文件15PASS。519/521真实Next烟测HTTP200、拒绝401/403、幂等close及端口重绑定已到达，但90秒仍不自然退出，watchdog终态1；537从创建栈及sourceMap精确定位edit-task-store计时器，523/524真实子进程RED后只加unref，525直接回归7PASS、533二十五文件136PASS。527/531是该store修补后的完整副本，尚未包含本次root修补；不得作为当前完整构建或自然退出通过。532/540/541/542尚未运行，544验证器仅已编写且未执行，没有最终通过记录。

当前下一顺序：先修诊断helper的有限强制清理/已取得close Promise观察，再建立本次root+store源码的全新完整物理副本并验构建、严格NFT、真实Next隔离与自然退出；同时保留真实OS信号及SQL永久等待deadline等未验门禁。随后完成逐路径准入/全量业务/正式exact-main构建，再验Coze同源101、云端多实例/重启。WebSocket前置正式闭合后才按8C剩余→8D剩余→8E→内部Task9→整体第八项接续。现有8C只允许必要安全收尾；内部Task号不是整体阶段号。

559保护仍61BLOCK/native1（旧60+store；本次root路径已有旧许可，不增加第62项），许可清单未改；568专用55494 READ ONLY/on只证明所查公共计数与四sequence保持、非系统schema0，不证明全库无写。测试自身含隔离PG写和临时worker；失败夹具没有写到回退目录。原5010/55494进程、main/stable/空index及旧.next标记保持，未安装/付费/Coze/提交/推送/部署。无本轮业务55432接触；531此前共享目录风险单独保留，不用有限元数据洗白。

本条以下所有“最新/当前”均为历史时点；本次只分类为PROGRESS，goal active，详571中文报告、572同席限定审查、570有限来源核验。

## 2026-10-05 最新：初始化失败清理具体缺陷限定关闭

**最新初始化失败清理检查点（467起）：** 本轮只补 WS-I3 中已取得资源在 document factory/maintenance 同步抛错后的清理所有权。468六真实监听/定时器业务RED、二prepare失败control PASS；统一缓存close owner后469默认八PASS。470在471前冻结40输入，471二十文件124PASS/native0；473 strictlint 0error/6unused warning/native1保留。等471/472终态后仅测试参数显式void；475两路径strictlint native0/空stdout/noTee，476在477前重新冻结40输入，477终态20文件124PASS/0skip/99.46秒/native0、478非增量tsc native0空stdout/noTee，484当前默认入口八PASS/native0。Peirce同席只读复核C0/I0/M0，限定关闭本轮具体初始化缺陷；最终native由主控观察，不冒审查席实跑。

479保护仍60BLOCK/native1，许可清单未扩；480专用55494 READ ONLY/on，限定公共计数/四sequence不变、非系统schema0。原5010/55494、main/stable/index/旧构建保持，未安装/付费/Coze/stage/commit/push/部署。真实Next/OS信号、SQL永久等待deadline、upgraded raw drain及HTTP-Next双清理失败矩阵、当前准入/全量业务/正式Git构建身份、Coze101/多实例/重启仍OPEN，继续先补WS前置，不后移内部Task9；新的Yjs/8D/8E/整体8草图仍冻结，现有8C只必要安全收尾，完整Task1/2/3/8C不闭。已闭1–6/Lovart/只读分享不重做，Pear移出、PSD保留。470/471和458/459均按历史受验身份保留；详482中文报告、481审查和483有限来源核验。


## 2026-10-05 最新：升级前 SQL/socket 具体缺陷限定关闭

**最新升级前 SQL/socket 检查点（442起）：** 本轮只修 WS-I4 的升级前授权及 raw socket 关闭所有权。443真PG/TCP四RED；444四断言PASS却有一uncaught/native1，不能记GREEN；445明确票据借出连接断连错误后修补，447四PASS。独审初次I2/M1，455额外成员SQL RED、456三RED/三PASS；修后457默认六PASS。458在459启动前冻结39输入，459终态19文件116PASS/0skip/97.09秒/native0；460非增量tsc与461三路径strictlint native0/空stdout/noTee。Averroes同席只读复审C0/I0/M0，限定关闭这三个具体问题，不授予阶段/merge许可。

462保护仍60BLOCK/native1、许可清单未扩；463专用55494 READ ONLY/on，限定公共计数/四sequence不变，非系统schema0。原5010/55494、main/stable/index及旧构建标记保持。真实Next/OS信号、永久等待SQL deadline、WS-I3未验矩阵、当前源码准入/全量业务/正式构建身份与Coze101/多实例/重启仍OPEN；下一步先收这些WS前置，不后移Yjs内部Task9。新Yjs/8D/8E/整体8草图冻结；既有8C只必要安全修补，完整Task1/2/3/8C仍OPEN。只读分享/已闭1–6/Lovart不重做，Pear移出、PSD保留。448/449与旧435/436保留为历史，不冒当前候选；详465中文报告、464审查、466有限来源核验。


## 2026-10-05 最新：生产 CLI 信号所有权具体缺陷限定关闭

**最新生产 CLI 信号检查点（419起）：** 本轮只补生产入口的 runtime/信号清理所有权。421六业务RED/一原启动失败control PASS后最小修补；422七PASS。独审发现重复信号测试盲区，432补强八PASS，433临时提前移除listener变异一FAIL/七筛选skip；精确撤回后434默认八PASS。435的38个candidate在436启动前冻结，436终态18文件110PASS/0skip/90.96秒/native0，437非增量tsc与438五路径strictlint native0/空stdout。Erdos同席复核关闭本轮Important/Minor，仅支持受控Next下CLI具体缺陷限定关闭；不提供merge或阶段许可。

真实Next、OS/POSIX信号、启动永久等待deadline及既有WS-I3剩余边界仍未验；下一优先WS-I4升级前SQL/socket等待合同，之后当前源码准入/业务全量/正式构建身份与Coze101/多实例/重启。440保护仍60BLOCK/exit1、allowlist未扩；439专用55494 READ ONLY限定公共计数/四sequence不变、非系统schema0。原5010/55494保持，未改stable/业务55432、未安装/付费/Coze/提交部署；新Yjs/8D/8E/草图冻结。435继承的frozenBefore424字段不得作为最终时点证据，详441；423/435原件保留。详情见430中文报告、429审查与431有限来源核验。

该修补不消除 gateway.close 尚未等待升级前票据/成员 SQL 的 WS-I4，也不证明完整生产退出。先完成这项及既有生命周期未验证矩阵，不将欠项后移到Yjs内部Task9；第七项仍OPEN。

## 2026-10-05 最新：Next/HTTP 生命周期具体缺陷限定关闭

**最新生命周期检查点（389–418）：** WS-I3 的 Next/HTTP 具体实现缺陷完成390五RED→391修补；独审发现顺序/admission盲区后，399两RED→400四文件21PASS，410默认入口timeout RED→411八PASS。最终418在412启动前冻结34输入，412终态17文件102PASS/0skip/81.75秒/native0，413非增量tsc与414两路径strictlint native0/空stdout。Aristotle同席末复审C0/I0，仅关闭本轮已审具体缺陷；真实Next、upgraded raw回收、初始化throw与双错误矩阵仍未证。WS-I2信号退出、WS-I4升级前SQL、保护407的60BLOCK、修后完整构建/正式Git身份及Coze101/多实例/重启仍OPEN。355/357/359仍为修前副本，后继Yjs/8D/8E/草图冻结。详情见406中文报告和405审查记录；下文旧“当前”仅属历史检查点。

关闭的是明确已审的 Next prepare/handler/listen 失败清理、正常退出顺序、短HTTP完整响应、请求级准入、幂等清理及默认测试timeout；不是完整生产退出/真实Next或整个WS阶段。下一步先WS-I2生产信号接管，再WS-I4 pending upgrade SQL/socket完成合同及未验生命周期边界；仍须逐路径源码准入/业务全量/完整构建和正式Git身份后验云端101/多实例/重启，不把欠项后移到Yjs内部Task9。

408显式55494专库READ ONLY/on，限定公共计数及四document sequence不变、无非系统schema；原5010/55494 PID不变。生产仅改server、新增一个测试，七annotation/既有控制/60保护路径及六human平铺记录保留。未安装、付费、访问业务55432、浏览器/Coze、stage/commit/push/部署或重启原服务。

- [本轮生命周期中文报告](../../output/playwright/semantic-target-source-20261004/stage7-presence-lifecycle-report-406.md)
- [同席审查与修复闭环](../../output/playwright/semantic-target-source-20261004/stage7-presence-lifecycle-review-405.md)
- [最终冻结回归](../../output/playwright/semantic-target-source-20261004/stage7-presence-lifecycle-final-freeze-regression-412.log)

## 2026-10-05 最新：WebSocket 启动隔离收尾，不关闭阶段

最终来源校验388 native exit0：当前32WS指纹、七annotation候选与旧控制、60保护源码及未扩许可清单、六份明确human平铺记录、原构建标记/mtime、refs/index、有限READ ONLY计数及十处记录一致。387首跑误将全部68份平铺sdd当作六份human，属于验证器范围错误，原失败日志/helper副本保留；不算产品RED，不关闭任何业务或云端门禁。

**最新检查点（370–387）：** 本轮仅修复 WebSocket 启动隔离 WS-I1，376 两案实际 RED 后最小条件导入，378 三文件16PASS；379 当前矩阵15文件93PASS/0skip/native0，380 非增量类型检查与381两路径 strict lint native0。Singer 同席限定复审 C0/I0/M0，只关闭 WS-I1；WS-I2–I4、保护384的60BLOCK、修后全量业务/正式构建身份及云端101/多实例/重启仍OPEN。355/357/359属于352**修前副本**，不再代表修后当前源码；372/373是修前保守导入图与优先级，不是运行故障或准入许可。前置不闭不推进新Yjs、8D/8E或草图；详情见 `docs/testing/2026-10-05-stage7-sequence-gates.md` 与386报告。下方早期“当前”口径均为当时检查点。

WS 剩余重要问题按依赖收口：WS-I2 生产 CLI 信号退出不拥有 runtime 清理；WS-I3 Next 生命周期及失败/关闭路径资源回收不完整；WS-I4 upgrade 前票据/成员 SQL 等待及 socket 尚未纳入 shutdown 等待。独审初次 C0/I4/M0，本次只关闭 WS-I1。不能把局部93PASS当作这三项、当前真实 Next、Coze 或全平台验收。

385显式专用55494 READ ONLY，数据库名及readOnly=on直接输出；限定providers0/versions22/creditTransactions0/commands80及四document sequence4/27/2/86不变，无非系统schema。测试自身有隔离写入与子进程socket，不称零DB写/未启动临时服务器。原5010 Node25404、55494 PG27476保持监听；未改stable、未安装、未访问业务55432、浏览器/Coze、真实模型/付费或提交部署。32当前WS输入来源为382运行中指纹，七annotation及旧控制仍保留；旧346/337不再作为修后server一致性验证器。

具体原件：

- [本轮中文报告](../../output/playwright/semantic-target-source-20261004/stage7-presence-isolation-report-386.md)
- [限定独审收尾](../../output/playwright/semantic-target-source-20261004/stage7-presence-isolation-review-383.md)
- [当前93项回归](../../output/playwright/semantic-target-source-20261004/stage7-presence-current-regression-379.log)
- [修后保护阻断](../../output/playwright/semantic-target-source-20261004/stage7-protection-post-isolation-384.log)

## 结论与范围

整体第七项仍未完成。原顺序为只读画布分享 → WebSocket 在线状态 → Yjs 多人文档协作；整体第八项才是手绘草图转代码。Yjs 内部 Task 8/9、8C/8D/8E不是整体阶段号。

历史有两处越序：WebSocket 云端前置未验即推进 Yjs，8C未关闭即穿插部分8D。旧记录的“8C→8D→8E→内部Task9补WebSocket”只是延期补验，不能作为已严格纠偏或前置通过的证据。下方规则覆盖各旧接续段落，不删除历史失败或重开发已关闭切片。

## 当前执行约束

1. 只读分享及整体1–6、已关闭Lovart切片不重做。Pear已按2026-09-27用户决定移出；PSD核心保留。
2. **优先补WebSocket前置。** 先建立当前受验源码、保护许可、回归、构建身份及严格NFT的证据，再验同源101、成员重连/撤销、多实例与重启。任一未验或阻断均保持OPEN，不用SSE、轮询、Yjs本地同步或旧浏览器测试替代。
3. **冻结后继推进。** WebSocket前置未闭时，不新增Yjs能力、不进入新的8D/8E实现、不宣称第七项完成、不进入整体第八项。已存在8C候选仅允许必要缺陷修复、离线回归、独审和留证，防止未验证改动继续扩散；这不是绕过前置的开发许可，也不算阶段关闭。
4. 前置闭合后，依序完成8C剩余实际入口/来源/本人计费/恢复/发布 → 8D剩余跨工作区及owner/editor用户入口 → 8E完整集成 → 内部Task9全量/浏览器/云端/独审及发布前移交。局部通过不能关闭完整Task或代替各层真实证据。
5. 第七项正式验收后再进入整体第八项草图。通用真实付费、CI、实体设备和最终发布仍需各自门禁；不自动宣布全平台可发布。

## 2026-10-05 当前实测与不能推断的内容

- `main` HEAD `c742218dab912adaf501ed4dc9c49a6ea74d47d2`，`origin/stable` `52f7c601ed150769e15d06fb435c6e360e28c9e7`只读；原5010 Node25404、55494 PG27476仍在，无服务重启。
- `annotation-proof-protection-321.log`：保护检查exit1，60项未授权源码漂移阻断；38功能ID、受保护入口和证据合同仍在。allowlist不扩。不能跳过独审和精确授权以取得绿色。
- `stage7-existing-artifact-nft-322.log`：对**既有10月2日构建产物**执行原严格NFT工具exit0，235路由/540850累计引用/81宽路由，nextConfigRoutes与rootDocumentRoutes均为空。宽路由不是此脚本的失败谓词，不能自行说exit1。
- 两个旧构建标记均为 `unverified-cf8f3c823a1d8c2fd48854e7977f80ce`，时间分别为10月2日18:21:17/18:21:29。该检查不证明10月5日候选的完整构建、exact-tree身份或云端可用；不能把历史NFT失败或这次旧产物通过外推为当前源码结果。未在5010活动产物目录上启动竞争构建。
- WebSocket current-candidate云端101、多实例和重启仍无关闭证据，Coze同步/部署仍不执行。下一门禁工作须先证明当前候选身份及本地准入；不重新开启Pear或重验已闭登录。

## 现有8C候选安全收尾（不扩大范围）

原Task2旧NULL-MIME完整合同D893保持原断言。308真实原4案3PASS/1NULL409；311原4PASS。312新9案加原4案12PASS/1FAIL，失败为父关系夹具缺必填asset/owner/project，尚未到产品断言；原日志保留，不能算产品RED。仅修夹具，使父关系绑定合法同资产版本，不改生产门禁。314两文件13PASS/0skip/44.30秒/native exit0，离线transport不代表真实供应商付费。

313与316非增量tsc终态exit0，空stdout；315六路径strictlint exit1/0error/10warning。318 ESLint API逐条对照307编辑路由修前副本，十条诊断完全一致，其他五路径零诊断；不能称strictlint全绿。准确五生产+一测试增量为317.diff，不用HEAD整脏diff冒充本次改动。

320原读取相关五文件98PASS/0skip/45.03秒；命令中的不存在的canvas-share-media路径未采集，不说六文件。正确分享规格323单文件79PASS/0skip/2.98秒。319终态为旧五套239PASS/1过渡NULL409合同冲突/240/0skip/460.29秒/exit1，发生在I1修补前；保留旧测试与日志，不删或改期望取绿。原Task1/2/3及完整8C不关闭。

## 当前WebSocket前置补证与安全收尾终态

### 当前源码隔离构建诊断补证（350–361）

最终限定审查366：Darwin完整读取350/354与记录、独立只读核全部3629副本hash0 mismatch，C0/I0/M2，本次诊断证据可收口、不放行整体业务。M1仅manifest字节核验字段范围不得扩展整目录；367另补当前Git可见输入集合3629/extra0/missing0。M2 helper spawn error可能缺结果JSON，未来复用前补异常终态；本次四步均0，Minor明确deferred，不冒称无残余风险，原席已关闭。362首败ignored ledger误算doc输入数、364第二败.NET/Node mtime精度误写原日志保留、非业务RED；365准确九文档例外/原input及60路径/标记时间/有限public一致校验exit0。368实际事务返回专用库名与readOnly=on，提升361保存日志可核性但仍非全库不变。六份人类flat SDD全含且未改，ignored ledger/外部Obsidian不是352输入。

前一轮PROGRESS后，本轮确实转向WS前置的源码准入/构建诊断，没有再新增Yjs功能。351将60BLOCK精确拆为23tracked工作树变更+37untracked；这23在基线→HEAD已提交变化中为0，不能把它们当已提交授权或60个功能故障。未修改allowlist，保护仍阻断。

352复制当前3629 Git可见文件并逐SHA核验；源摘要f5cd49a9a72ff6f352c70eb9b1625b69cc077901c33a4e0116940e34bfc28f3f。353原依赖91788文件物理副本，Robocopy native1成功/FAILED0、无install/junction。354净化子进程环境后执行原build等价四步骤，355 native exit0/四步0，编译17.5秒/type66秒/静态121/121/247trace去0；副本BUILD_ID与完成标记同unverified-81a1af51216c749a8477cb3d7e478dbe。358在文档同步前再次确认原与副本3629 SHA一致。356全仓eslint . --quiet native0，Babel500KBnote保留，不说严格warning全绿。

357对本轮副本新产物执行原strictNFT native0：235 API路由/230391引用/67宽，nextConfig/rootDocs0。359开启实际current-artifact检查，两文件15PASS/0skip/19.12秒/native0；含9实际产物、4污染CLI控制、2标记控制，非全仓业务。与旧322上下文不同，引用数差值不归因为代码优化或Coze OOM解决。副本忽略Git元数据、环境/模型/旧运行数据，完整诊断有源码指纹，但不是正式Git exact-tree/main发布构建。

361公共限定READ ONLY计数与348一致；原main .next两标记仍旧unverified-cf8f3c823a1d8c2fd48854e7977f80ce且10月2日mtime未变，原5010/55494 PID不变，无新服务/账户/数据库/安装/业务55432/付费/浏览器/Coze/提交部署。副本保留核验，详360原报告。仍需当前源码逐路径准入/业务全量回归、正式Git构建身份，再Coze101/真实多实例/服务重启；I2–I7/原M1/fault与整体Spec/Quality仍OPEN，第七项不关闭。以下347/322旧段落仅表示当时检查点，不推翻此新诊断或冒充已完成正式前置。

- 344以显式55494专用测试库、独立schema执行现有WebSocket完整受验矩阵：14文件89PASS/0skip/73.21秒/native exit0。真实PG/socket覆盖一次性票据、跨源拒绝、撤权、独立网关进程广播、心跳/租约、监听backend中断后的恢复。启动HTTP边界和客户端UI含替身/jsdom，不是当前Next浏览器或云端验收；crashed lease/监听恢复不冒充Coze服务重启。346为运行中的31源码/依赖/测试指纹，不称运行前冻结。
- 347当前保护检查仍exit1/60BLOCK，38原功能ID/入口/证据合同保留。未扩大allowlist；current-candidate完整构建/exact-tree/NFT、Coze同源101、多实例/重启及CI/设备/发布均OPEN。不能用322旧产物通过补齐。
- Dalton初审C0/I7/M1；主控328真实SQL锁两案RED后最小5行修补，329两GREEN/9筛选skip；331修后四套53PASS/0skip/139.11秒/exit0。原席335限定复审确认I1具体实现缺陷可闭，但fault/连接回收矩阵仍OPEN。
- 333新dispatch测试unknown直接取字段TS2571，345改生产严格解析而非anycast；新增锁测试try/finally提前覆盖BEGIN/锁/PID/pending，独审确认清理M已解决且不弱化原断言。340非增量tsc与341两测试strictlint均终态exit0/空stdout/noTee；332全七候选strictlint仍0error/10旧warning/exit1，不称全绿。342首跑主控漏配四环境变量，被专库guard在seed前拒绝16案/12.75秒，保留日志、不放宽guard、不算产品RED；343齐变量后三文件16PASS/0skip/57.76秒/native exit0。
- I2–I7/原M1、全部Task2/8C和整体Spec/Quality仍OPEN；335原席已终态关闭。326/343实际worker合法PNG替换拒绝及唯一本人退款只是I6一条切片，远端已接受后的恢复/文件提交窗口/手动adopt/六格式/预算生命周期等仍须解决，不推后继。
- 348显式READ ONLY：专用testDB的公共providers0/versions22/creditTransactions0/commands80、四document sequence4/27/2/86与338一致；byte/legacy/presence隔离schema各0。测试自身有隔离写入，不称零DB写。原5010 Node25404/55494 PG27476保持监听，无业务55432、付费模型、安装、浏览器、Coze、stage/commit/push/部署操作。

本轮分类为PROGRESS：两测试安全修补、完成同席复审和当前WebSocket本地补证，不表示恢复了所有前置或实现了新的Yjs能力。下一优先仍为当前候选保护准入与完整构建证据、其后云端101/多实例/重启；现有未验候选的必要安全问题保持独立开放，禁止后移门禁。

336保存当前七候选、原控制、审查边界、各命令原生终态与开放项；337来源核验已实际exit0，确认346运行中指纹到终态未变、原D893/allowlist/读取/UI/后端冻结控制仍在、307/327/340副本及317/330/345准确差异不变、限定公共快照和七文档当前口径一致。它是证据一致性检查，不替代业务测试、原生空stdout、完整构建、云端或阶段验收；旧324/325不覆写、不冒称仍适用于当前改动。

证据根目录：`output/playwright/semantic-target-source-20261004/`。本记录仅纠正执行合同与已观察事实，不提供提交、推送、浏览器写入、安装、业务55432、真实模型付费或发布许可。
