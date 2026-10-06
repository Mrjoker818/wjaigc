# 协作批注来源授权修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 关闭8C批注来源的客户端URL授权绕过，并使合法协作批注贯穿既有本人修图任务与规范发布。

**Architecture:** 来源读取与复验复用现有项目授权，规范文档与资产在同一PG只读事务中匹配。稳定身份沿用持久旧值，无持久旧值时绑定登记资产版本；编译产物与普通授权参考素材分开，下游复用现有edit原子准入而不建立第二套任务/账务系统。

**Tech Stack:** Next.js、TypeScript、PostgreSQL、Yjs、Sharp、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-04-annotation-source-admission-design.md`

## 2026-10-05 第七项前置门禁纠正与现有8C安全收尾

最新真实 Next 自然退出检查点（573–591）：当前3641源码物理副本逐SHA核对，581四步完整构建/native0，582严格NFT0（235路由/230393引用/67宽，配置/根文档污染0），583实际产物两文件15PASS。584真实Next无DB烟测HTTP200、拒绝401/403、幂等close/端口重绑定及自然退出native0、watchdog=false；不是成功101/云端/OS信号。587诊断控制10PASS，589私有读写及九回退拦截控制PASS；guard仅覆盖三已知回退根的所列FS接口，不称全文件系统沙箱。590保护仍61BLOCK，591专库READ ONLY限定计数/sequence保持；旧失败及无DB/Yjs/安装尝试失败警告保留。先补WS剩余信号/SQL永久等待deadline、源码准入/全量业务/正式Git身份及Coze101/多实例/重启，再8C剩余→8D→8E→内部Task9→整体8；后继仍冻结，已闭切片不重做、Pear移出/PSD保留。详情见593报告、594同席审查；本条以下“最新/当前”均属历史时点。

最新数据目录竞态修补检查点（550–570）：先补WebSocket前置，不推进新的Yjs/8D/8E或整体第八项。551/552真实双worker探针同名删除触发ENOENT与回退，越界写被夹具阻断；独占随机探针最小修补后563三文件7PASS。562漏close受控变异确实FAIL并精确撤回；564在565前冻结51输入，565终态28文件143PASS/native0，566严格lint及567非增量tsc native0/空stdout/noTee。同席限定复审C0/I0/M0，只收口本次并发探针缺陷，不关闭WS或第七项。详 `docs/testing/2026-10-05-stage7-sequence-gates.md` 及571报告、572审查。

531构建虽四步0，却实际三次回退已有 `/space/wujie-data`，不称隔离成功或业务数据未触碰；549是PASS而非RED，546–548为夹具加载失败。所有旧“最新/当前”段落仅属历史检查点。修后完整构建/真实Next自然退出与诊断helper I/M、61保护BLOCK、正式Git身份/全量业务/Coze101/多实例/重启等仍OPEN；只读分享和已闭1–6/Lovart不重做，Pear移出、PSD保留。


**最新初始化失败清理检查点（467起）：** 本轮只补 WS-I3 中已取得资源在 document factory/maintenance 同步抛错后的清理所有权。468六真实监听/定时器业务RED、二prepare失败control PASS；统一缓存close owner后469默认八PASS。470在471前冻结40输入，471二十文件124PASS/native0；473 strictlint 0error/6unused warning/native1保留。等471/472终态后仅测试参数显式void；475两路径strictlint native0/空stdout/noTee，476在477前重新冻结40输入，477终态20文件124PASS/0skip/99.46秒/native0、478非增量tsc native0空stdout/noTee，484当前默认入口八PASS/native0。Peirce同席只读复核C0/I0/M0，限定关闭本轮具体初始化缺陷；最终native由主控观察，不冒审查席实跑。

479保护仍60BLOCK/native1，许可清单未扩；480专用55494 READ ONLY/on，限定公共计数/四sequence不变、非系统schema0。原5010/55494、main/stable/index/旧构建保持，未安装/付费/Coze/stage/commit/push/部署。真实Next/OS信号、SQL永久等待deadline、upgraded raw drain及HTTP-Next双清理失败矩阵、当前准入/全量业务/正式Git构建身份、Coze101/多实例/重启仍OPEN，继续先补WS前置，不后移内部Task9；新的Yjs/8D/8E/整体8草图仍冻结，现有8C只必要安全收尾，完整Task1/2/3/8C不闭。已闭1–6/Lovart/只读分享不重做，Pear移出、PSD保留。470/471和458/459均按历史受验身份保留；详482中文报告、481审查和483有限来源核验。


**最新升级前 SQL/socket 检查点（442起）：** 本轮只修 WS-I4 的升级前授权及 raw socket 关闭所有权。443真PG/TCP四RED；444四断言PASS却有一uncaught/native1，不能记GREEN；445明确票据借出连接断连错误后修补，447四PASS。独审初次I2/M1，455额外成员SQL RED、456三RED/三PASS；修后457默认六PASS。458在459启动前冻结39输入，459终态19文件116PASS/0skip/97.09秒/native0；460非增量tsc与461三路径strictlint native0/空stdout/noTee。Averroes同席只读复审C0/I0/M0，限定关闭这三个具体问题，不授予阶段/merge许可。

462保护仍60BLOCK/native1、许可清单未扩；463专用55494 READ ONLY/on，限定公共计数/四sequence不变，非系统schema0。原5010/55494、main/stable/index及旧构建标记保持。真实Next/OS信号、永久等待SQL deadline、WS-I3未验矩阵、当前源码准入/全量业务/正式构建身份与Coze101/多实例/重启仍OPEN；下一步先收这些WS前置，不后移Yjs内部Task9。新Yjs/8D/8E/整体8草图冻结；既有8C只必要安全修补，完整Task1/2/3/8C仍OPEN。只读分享/已闭1–6/Lovart不重做，Pear移出、PSD保留。448/449与旧435/436保留为历史，不冒当前候选；详465中文报告、464审查、466有限来源核验。


**最新生产 CLI 信号检查点（419起）：** 本轮只补生产入口的 runtime/信号清理所有权。421六业务RED/一原启动失败control PASS后最小修补；422七PASS。独审发现重复信号测试盲区，432补强八PASS，433临时提前移除listener变异一FAIL/七筛选skip；精确撤回后434默认八PASS。435的38个candidate在436启动前冻结，436终态18文件110PASS/0skip/90.96秒/native0，437非增量tsc与438五路径strictlint native0/空stdout。Erdos同席复核关闭本轮Important/Minor，仅支持受控Next下CLI具体缺陷限定关闭；不提供merge或阶段许可。

真实Next、OS/POSIX信号、启动永久等待deadline及既有WS-I3剩余边界仍未验；下一优先WS-I4升级前SQL/socket等待合同，之后当前源码准入/业务全量/正式构建身份与Coze101/多实例/重启。440保护仍60BLOCK/exit1、allowlist未扩；439专用55494 READ ONLY限定公共计数/四sequence不变、非系统schema0。原5010/55494保持，未改stable/业务55432、未安装/付费/Coze/提交部署；新Yjs/8D/8E/草图冻结。435继承的frozenBefore424字段不得作为最终时点证据，详441；423/435原件保留。详情见430中文报告、429审查与431有限来源核验。

**最新生命周期检查点（389–418）：** WS-I3 的 Next/HTTP 具体实现缺陷完成390五RED→391修补；独审发现顺序/admission盲区后，399两RED→400四文件21PASS，410默认入口timeout RED→411八PASS。最终418在412启动前冻结34输入，412终态17文件102PASS/0skip/81.75秒/native0，413非增量tsc与414两路径strictlint native0/空stdout。Aristotle同席末复审C0/I0，仅关闭本轮已审具体缺陷；真实Next、upgraded raw回收、初始化throw与双错误矩阵仍未证。WS-I2信号退出、WS-I4升级前SQL、保护407的60BLOCK、修后完整构建/正式Git身份及Coze101/多实例/重启仍OPEN。355/357/359仍为修前副本，后继Yjs/8D/8E/草图冻结。详情见406中文报告和405审查记录；下文旧“当前”仅属历史检查点。

**最新检查点（370–387）：** 本轮仅修复 WebSocket 启动隔离 WS-I1，376 两案实际 RED 后最小条件导入，378 三文件16PASS；379 当前矩阵15文件93PASS/0skip/native0，380 非增量类型检查与381两路径 strict lint native0。Singer 同席限定复审 C0/I0/M0，只关闭 WS-I1；WS-I2–I4、保护384的60BLOCK、修后全量业务/正式构建身份及云端101/多实例/重启仍OPEN。355/357/359属于352**修前副本**，不再代表修后当前源码；372/373是修前保守导入图与优先级，不是运行故障或准入许可。前置不闭不推进新Yjs、8D/8E或草图；详情见 `docs/testing/2026-10-05-stage7-sequence-gates.md` 与386报告。下方早期“当前”口径均为当时检查点。

**当前执行口径：优先补WebSocket前置，不将欠项后移冒充顺序恢复。** 冻结新的Yjs能力、8D/8E及整体第八项；现有8C候选只做必要缺陷修复/回归/独审，完整Task1/2/3与8C仍OPEN。前置闭合后按8C剩余→8D剩余→8E→内部Task9→整体8接续，内部编号不等于整体阶段。只读分享和已闭1–6/Lovart不重做，Pear移出、PSD保留。

当前前置补证344：WebSocket真实socket/PG与既有客户端/启动矩阵14文件89PASS/0skip/73.21秒/exit0；含独立网关进程广播、撤权断连和监听恢复，不代替真实Next浏览器/Coze101、云端多实例/重启或全仓。347保护仍60BLOCK/38功能合同保留，allowlist不扩；351拆解为23tracked工作树变更+37untracked，非60个运行故障。322仅10月2日旧产物，355本轮源码副本完整构建与357严格NFT已实测exit0，但正式Git exact-tree/云端验收仍未验证。

当前源码构建诊断350–361：352/358原与副本3629文件SHA一致；353物理复制91788依赖文件无安装/共享junction；355四构建步骤皆0、静态121/121，副本unverified-81a1af51216c749a8477cb3d7e478dbe。357新产物235路由/230391引用/67宽、nextConfig/rootDocs0，不能与旧322差值冒称优化；356全仓eslint . --quiet exit0，严格warning不消失；359副本两文件15PASS/0skip/19.12秒，非全仓业务回归。原5010/55494与main旧.next标记/mtime未变，未启动新服务/数据库/付费/Coze/部署；360详细界限原件，正式准入/业务回归/Git身份及云端101多实例重启仍OPEN，隔离副本保留用于核验。

366 Darwin同席限定审查C0/I0/M2，两Minor明确deferred，不放行整体业务；独立复算副本3629输入0 mismatch，原席已关闭。362/364验证器预期范围/时间精度首败原日志保留，365准确九Git可见文档例外与原产物/60路径校验exit0；367当前输入集合3629/extra0/missing0，368日志直接确认专用testDB/readOnly=on及有限公共计数不变。记录只证明manifest输入与本地诊断，不声称整个目录、全库或正式发布通过。

现有8C安全收尾：331修后四文件53PASS为测试小改前；345仅两测试严格解析/holder清理修补，343当前三文件16PASS/0skip/57.76秒/exit0；340非增量tsc与341两测试strictlint终态0/空stdout/noTee。333类型错误及342缺配套环境变量guard拒绝原日志保留，不算产品RED。Dalton同席335确认I1具体锁等待缺陷与新增清理M已解决，但I2–I7/原M1/fault回收及整体Spec/Quality仍OPEN，原席已关闭。319旧五套239PASS/1过渡NULL409合同冲突/240/exit1不删、不改期望；332全候选strictlint仍十条旧warning。348限定公共counts/四sequence不变，byte/legacy/presence测试schema各0。main/stable/原5010/55494沿用，无重启/推送/Coze/付费/部署，完整Task1/2/3与8C不关闭。

权威顺序及证据边界见 `docs/testing/2026-10-05-stage7-sequence-gates.md`；本节覆盖下方历史接续口径，不覆盖或改写历史结果。

## 2026-10-05 8C可信读取候选与本地I/O复审

当前仍为整体第7/Yjs8C，原完整来源Task1/2/3及8C OPEN，不进入8D/草图。读取基础Task1已通过限定本地验证和独审；这不是旧NULL图片完整执行或发布许可。四生产路径+一个新test包含SQL NULL/空字段映射、零拷贝格式识别、多帧pageHeight、可终止本地fs worker及中文UTF8分块修复；原资产/版本/文件/账本不修写，原登记MIME守卫及收费SQL不放宽。

266六真实取消RED→267六GREEN；286中文basename实际替换字符RED→287聚焦GREEN，285夹具混入Windows路径拼写差异保留、不算纯业务RED。294/session78048最终七文件139=138PASS/1原NULL业务RED/0skip、53.42s：descriptor可读，但实际executor→edit仍收费前409、schema不变、after/provider0；登记MIME控制完整链路成功。D893原测试仍期望202且SHA不变。测试六deadline是修后覆盖；fs停顿为精确边界注入、worker回收真实，不称真实磁盘故障。S3接口替身不称HTTP/SDK/云端。

292/session21194非增量tsc与296四生产+test strictlint终态exit0空stdout/no原生Tee；291测试nullable类型首败及268/275等历史错误保留。Kuhn283确认I1–I4 ADDRESSED，301同席补审M2 ADDRESSED、Spec PASS/Quality PASS、新C0/I0/M0，原席已关闭；审查者只读未独立运行测试，原文运行中状态由主控终态补注区分。293为准确两路径M2增量，277五路径初始增量不覆盖。298保护仍59BLOCK/38功能合同在、allowlist不扩；299显式READ ONLY公共counts/四sequence同270/279、schema0；295/300五候选及D893/allowlist前后相同。281/282仅M2前历史检查点，282已不适用于当前候选；旧240原冻结控制实际再次通过。原5010/55494 PID沿用，main/stable/空index不变，无安装/重启/业务55432/真实付费/Coze/提交推送部署。

下一仍8C：将真实原图证明用于原Task2收费、派发、持久冻结、恢复和发布，再完成剩余8C→8D剩余→8E→内部Task9及WebSocket云端101/多实例/重启欠项→整体8草图。内部编号不是整体第8/9；历史越序不冒称前置通过，不重做已闭1–6/Lovart/分享。Pear移出/PSD保留、goal active。FILE_ONLY、其余入口/下载/after/late owner/remote恢复、全仓/build/strictNFT/CI/设备/发布仍OPEN。最终接续见output/playwright/semantic-target-source-20261004/legacy-utf8-final-report-302.md及286–301原件；278/281保留历史。memory checkpoint EMPTY，项目事实不复制进长期记忆。


## 2026-10-05旧MIME完整接缝根因接续

上一目标轮顺序核查NO PROGRESS；本轮新增实际来源→原图/编号图像素解码→executor→edit真PG收费前拒绝的证据。仅新增独立测试，不改冻结生产/旧测试/allowlist。228四案3PASS/1业务RED，NULL图片409、schema全量不变、after/provider0；相同字节的有MIME控制本人-7一次/无退款/canonical一次/原版本整行及原图不变；坏字节422/明确非图片MIME404均零internal/remote且schema不变。真实AssetCore受管descriptor另有缺MIME拒绝，不能一行SQL放宽冒充兼容。

225只读字段误写与226 loopback替身错误不算业务RED；227为226后/228前，229/237分别在228/234后，公共counts/四sequence同值、测试schema0。228/CC3E是旧候选；首审C0/I3/M1后新test补原图送达、精确协议、完整发布关联及成功后的受管原版本读取/元数据，descriptor NULL拒绝仅根因观测。233四案3PASS/1RED/11.04s，234最终D893049FA306944AB0B4EF6EF4AAA3E406F12AADD04F8890F1089D041DB28574四案3PASS/1NULL业务RED/exit1/12.83s，不加总。235/session66684最终非增量tsc及236test strictlint终态exit0空stdout/no原生Tee。232保护59BLOCK/38合同保留/allowlist不扩，238原216冻结控制与新D893前后SHA核验通过。Cicero同席补审根因/TDD可接续、限定C0/I0/M0，报告已读、原席已关闭，未独立运行234/静态/DB；生产兼容路径实际采用可信原图描述仍OPEN。详本SDD legacy-media-root-report.md和legacy-media-review-initial/final.md。

下一仍Task2/8C：可信实际原图字节的元数据兼容须覆盖准入与受管交付，保持原源身份与持久冻结/恢复、无收费旁路/客户端MIME权威/静默改原版本；暂保留旧NULL两相反测试，不勾完整Task1/2/3。8C→8D→8E→内部Task9与WebSocket欠项→整体8草图；历史越序不冒称闭合。Pear移出/PSD保留、goal active，无提交部署付费Coze，memory checkpoint EMPTY。

## Global Constraints

- 整体第7项/Yjs8C；8D、8E、内部Task9及草图仍开放。
- main-only/stable只读，不提交推送、Coze同步、部署或真实付费；Pear移出/PSD保留。
- 旧标注记录、orderKey、语义版本和墓碑不批量迁移；六份用户SDD文件保留。
- PG配置但失败不降级文件；远程I/O不持锁；客户端URL不能制造来源。
- 来源读取零写入；最终任务费用和发布仍由既有事务复验。
- 无独立复审不扩大保护allowlist；局部通过不等于完整8C/发布。

## 2026-10-04执行检查点

### 接续：父Workspace规范媒体确认（完整Task2仍OPEN）

真实Workspace/document hook/session/Y.Doc/media sync及Canvas链路，外部HTTP/socket帧替身。HTTP先到等待已授权目录序号，WS先到保留已准入run；最终仍writable/完整tuple复验，进度封顶95等待同步，新提交不借等待资格。原夹具失败与187/188/190/192业务RED保留。196旧359检查点不叠加；新增已接受batch强等待合并测试，201删除target提升变异1FAIL/3filter skip后精确恢复，205最终13文件360PASS/0skip/exit0、64.38s。50290非增量tsc0空stdout无Tee；198 strictlint21旧warning/exit1，206与修前逐条一致且其他五路径0诊断。207保护59BLOCK/38合同在/allowlist不扩。

Confucius197准确七文件静态Spec PASS/Quality PASS WITH NIT/C0I0M1；M1直接测试和变异证明已补，同席补审M1 ADDRESSED/Spec PASS/Quality PASS/C0I0M0，席已关闭；不冒充独立执行205。208四生产diff精确匹配197，临时变异已恢复。203验证前冻结七候选/197/原审及13控制/旧后端/旧UI/备份/refs，209最终核验exit0、前后SHA一致。五权威文档/Obsidian当前标记唯一并更新，210分层执行结果记录；memory checkpoint EMPTY、不写重复日志。所有exec终态/原席关闭。本轮不改服务端来源/费用/发布，不做DB/浏览器/云端/提交部署。NULL-MIME/FILE_ONLY、Task1/2/3/完整8C及WebSocket欠项不关闭；下一同8C，不能跳8D/草图。历史前置未闭交叉仍披露。

### 接续：实际画布执行限定修复（完整Task2仍OPEN）

四生产文件/两新测试接入本人poll、严格canonical引用及原workspace媒体确认；文档不synthetic append，私人写拒绝不成功，独立run/scope/来源复验阻断切项目、换版、撤权、取消、卸载和旧finally迟到。165八真实组件RED、169三个取消业务RED后最小修补，夹具错误另留证。176十文件89PASS/0skip/exit0（旧源码合同非行为证据），177非增量tsc0空stdout/noTee，客户端与新测试四路径strict lint0；六路径strict lint21旧warning/exit1，174修前修后逐条一致。178保护59BLOCK/不扩allowlist，不能发布。

Zeno准确175六路径增量Spec符合/Quality Approved/C0I0M2，席关闭。M1媒体确认前进度可能提前100、M2旧lint噪声deferred至Task3。179运行后SHA/13控制/冻结后端/原Canvas备份/refs/index核验；旧159不改为当前。父Workspace真实刷新、浏览器/WS/远程/真实网络故障未新验，NULL-MIME/FILE_ONLY及Task1/2/3仍OPEN。五权威文档/Obsidian同步，main-only无提交部署付费/DB写，Pear移出/PSD保留。下一同8C补确认状态、父接缝与旧合同，不进入8D–E/Task9/草图；历史WebSocket云端前置欠项必须在整体7关闭前验收。

### 接续：下游错误状态传递限定修复

仍同Task2/8C，不勾Task1/2/3。两生产路径保留下游明确拒绝status/有界code/retryable，安全消息不含下游/网络异常细节；不重发、不改身份费用/发布，无success旧合法响应保留。144unit/146generic/147四真PG拒绝RED→14842PASS/149四PASS；145 project预期404误配现行trashed403原日志保留并另补缺source404，不能算业务RED。

151最终五文件212=211PASS/1旧NULL-MIME/0skip、299.03s，原100edit控制通过；152tsc/153五路径strictlint exit0空stdout无Tee。154保护58BLOCK、38契约保留、不扩allowlist。Wegener限定Spec符合/Quality Approved/C0I0M2，原席关闭；两Minor边界覆盖/常规输出留最终Task3审查，不能写无风险。155/156候选/准确150diff/14保留路径及refs/index核验，158公共基线未漂移/隔离schemas0，157结果与五权威文档及Obsidian同步。旧140/141历史不覆盖，executor本轮变化不使用旧SHA作当前证据。

下一真实InfiniteCanvas canonical结果/去重及切项目换版撤权迟到隔离，旧批注stale确认和NULL-MIME/FILE_ONLY合同仍开放；after/late成功owner/remote恢复无新增实测。无提交/部署/付费/Coze，Pear移出/PSD保留、目标active。

### 接续：私人原子来源与付款身份限定修复

原beforeCharge同事务冻结原私人来源、task.result有界原tuple/request摘要与派发身份已接入；101Q10/103R3有效RED→10618PASS。首审I1/I2按117S4真实PG业务RED修复；118 Append首轮24PASS/1FAIL后25PASS。同席fix1新增正常网络重试Important由131U真RED确认，fix2仅删route propagateErrors:true一行恢复原fallback，13226PASS/120filter skip/146。Meitner同席fix2限定Spec符合/Approved、新C0/I0/M0，原I1/I2及新增重试Important均ADDRESSED；不批准完整Task2。两席关闭，旧失败保留。

135最终五文件185=184PASS/1旧NULL-MIME失败/0skip、290.20s，原100edit控制通过；136非增量tsc/137五路径quietlint/143四路径strictlint均exit0空stdout/noTee。138保护58BLOCK，38契约保留、allowlist不扩。139只读公共数据未漂移/隔离schemas0；140候选/141结果/private-atomic-final-report.md与五权威文档/Obsidian同步，main/stable/原服务及冻结SHA保留，未提交部署付费。123不含后来U，不能冒充当前最终回归。after调度/late成功owner突变/remote恢复无新增实测；下一实际UI/stale状态传递及NULL-MIME/FILE_ONLY兼容，Task1/2/3保持OPEN。

### 接续：私人输入候选与原子准入下一义务

74另一primary误准入真实RED，严格原source比较后75PASS；79首审I1绝对合法URL误拒绝经82真实完整执行器两RED验证，fix1 executor原source身份与读图路径分离，83七PASS（route124+executor2，Q未采集）。同席复审I1 ADDRESSED、限定Spec符合/C0I0M1，注释错位Minor留下一Q修复，准确说明Q直接edit而非完整上游；两席关闭。最终90五文件165=162PASS/3FAIL/0skip：旧NULL-MIME及新Q两原子来源缺口，原100edit控制通过；91/92/99静态exit0空stdout/noTee，88保护57BLOCK未扩allowlist。94候选/95执行器结果及private-input-fix1-report.md为最终检查点。

89确认真实私人收费锁等待来源变化仍200，dispatch前变化仍provider1；二者在首个失败断言止步，后续零副作用/退款未证。下一必须将原source纳入既有beforeCharge事务及dispatch/持久身份，不以新输入检查代替；随后真正UI及兼容。完整Task1/2/3不勾关闭，五权威文档/Obsidian已同步此候选，main/stable refs及原服务未变。

### 接续：持久媒体指纹候选最终记录

既有publication_intent已冻结原媒体完整指纹与请求摘要，51真库三个RED→56六控制PASS，完成/final import/持久恢复不接受更换URL/checksum。65恢复费用/nonterminal及66真实staging窗口补证通过，最终67完整N20=19PASS/1旧NULL-MIME RED。60前补测试检查点152PASS/1同旧RED，61正确intent/client31PASS；不能相加。最终68/69静态exit0空stdout/no Tee文件，保护62仍57BLOCK。Rawls70限定test-only复审M1/M2均ADDRESSED、新C/I/M0、席关闭；完整Task2不关闭。最终候选72/结果73及media-freeze-report.md保留；下面为历史检查点。

当前接续先真实私人primary image与server source同源拒绝矩阵，再收费锁等待/dispatch冻结，之后实际UI/兼容合同；不进入8D/草图，不把私人点时验证当原子准入。

### 接续：Task2候选，不关闭整任务

本轮已接source context与internal编译PNG，普通refs为空、原project/grant/父版本/摆放进入原计费冻结准入，完整真实POST→Sharp→executor→edit→离线provider→本人单扣费→canonical单案通过。实际PG额外复现并最小处理缺MIME误收费、丢编号图降级、模型I/O时entity变化仍发布；HTTP400另条降级由独审发现并补RED。各日志20–45及SDD ledger为本轮，不用下面历史83/2概括当前状态。

独立只读复审不可合并：迟到URL/checksum未持久冻结、私人source/body.image不同源及私人计费锁等待复验仍缺，下游stale错误转发缺。客户端canonical等待协议7RED→11含旧控制PASS，但实际InfiniteCanvas未接入；没有实际UI/远程模型/付费/云端新验收。Task1故障pool边界37=35PASS/2FILE_ONLY合同RED，旧本人查找并非已证明文件后端，不能写文件兼容已保留。NULL MIME来源识别能读，但现有规范发布要求登记MIME，严格准入零扣费恢复；NULL执行成功假设的正控制仍RED，待元数据合同裁定，不降低质量门禁。

Task2实际写集补充：src/lib/annotation-edit-context.ts、src/lib/collaboration/task-publication.ts、task-publication-output.ts、annotation-task-client.ts与对应新测试。Task1/2/3不勾整任务；allowlist不扩。精确复审与处置见.superpowers/sdd/2026-10-04-annotation-source-admission/task-2-backend-review.md。

最终分层结果：37服务端前检查点190=187PASS/3RED（不含最后HTTP400谓词/客户端）；43最新批注15=14PASS/1NULL成功假设RED/100skip；41客户端11PASS但未实际接canvas。44非增量tsc0、45准确13路径quietlint0，47保护57BLOCK/38功能契约保留，50证据完整性0。不能加总重叠样本或称完整回归/Task2完成。精确原始日志与49当前指纹及task2-report.md/JSON，五权威文档/Obsidian已同步本检查点。下一先URL/checksum真实PG迟到RED及既有持久冻结、私人计费锁同源，再真正UI回调/作用域/stale验收与再复审。

### 历史：来源基础83/2检查点

Task1来源候选及稳定身份已形成，原四RED转绿；最新联合回归9文件83项81通过/2失败，失败为新Task2真实executor HTTP请求丢失共享/私人projectId。Task1专门PG故障、不改旧入口及stale反馈矩阵仍缺；Task2原grant/编号图/费用/发布未实现；不勾整任务完成。非增量tsc/准确quietlint exit0，严格lint两warning，保护54 BLOCK。准确分层证据见output/playwright/semantic-target-source-20261004/report.md及execution-results.json，五权威文档和Obsidian已同步；未提交/独审/部署。

## Task 1：真实来源与稳定身份

**Files:** 新增`src/lib/annotation-authorized-source.ts`及`tests/integration/annotation-source-postgres.test.ts`；修改两annotations路由、`annotation-source-version.ts`、`canvas-project-sync.ts`及`document-project-bridge.ts`的源图身份字段；新增mapper身份测试。其他业务来源查找不替换。

**Interfaces:** `findAuthorizedAnnotationSource(actorUserId:string,projectId:string,imageId:string):Promise<AuthorizedAnnotationSource|null>`；`assertAnnotationSourceUnchanged(source:AuthorizedAnnotationSource):Promise<void>`；返回服务器来源及可选document access/assetId/assetVersionId/placementId。`buildCanonicalAnnotationSourceVersionId(imageId:string,assetVersionId:string):string`供mapper和服务端共同使用。

- [x] 两真实POST四个客户端URL绕过RED已保留，30项4失败/26通过，不是导入错误。
- [ ] 补真库业务RED，保留本人/private控制及规范媒体身份：
  ```ts
  expect(await findAuthorizedAnnotationSource('editor','shared','entity-a')).toMatchObject({
    imageUrl:'/api/serve-upload/images/source.png',
    assetVersionId:'11111111-1111-4111-8111-111111111111', placementId:'placement-a',
    access:{actorUserId:'editor',ownerId:'owner',grantGeneration:'1'},
  });
  await query("UPDATE wujie_project_document_editors SET status='revoked',grant_generation=2");
  await expect(assertAnnotationSourceUnchanged(source)).rejects.toMatchObject({status:404});
  ```
- [ ] 用同事务授权+严格规范投影/活跃图片版本实现查找；复验原完整身份，404/409/503公共错误不含SQL。两POST不再制造URL兜底。
- [ ] mapper无持久身份时填入canonical版本，有持久旧身份保留；以两次不同读回时间及替换assetVersionId证明稳定与换版失效。
- [ ] 运行`pnpm exec vitest run src/__tests__/api/annotation-resolve-target.test.ts src/__tests__/api/annotation-execute.test.ts tests/integration/annotation-source-postgres.test.ts --reporter=verbose`，显式本机POSTGRES_TEST_DATABASE_URL，保留首败及最终日志。复验source后再返回识别/转发执行，不持远程锁。本任务只完成来源基础，不能称下游付费/发布已通。

## Task 2：完整下游与UI结果接缝

**Files:** `annotation-executor.ts`、execute路由、`api/edit/route.ts`、`canvas-edit-admission.ts`及现有canvas-edit源/冻结合同模块；新增真实executor请求测试及扩展`canvas-edit-route-postgres.test.ts`；`infinite-canvas.tsx`仅实际提交和完成回调。

**Interfaces:** `submitAnnotationEdit`接收Task1服务端source context；内部编译编号图作为单独受信字段，不是普通referenceImages。`/api/edit`原授权代次与来源必须进入原冻结准入，外部伪造字段在费用/媒体I/O前400。

- [ ] RED：真实executor捕获HTTP body，文档保留projectId、唯一父版本、本人internal身份，普通参考列表不含生成overlay；外部伪造内部字段零扣费，原grant变化后转发零任务，数据图实际到provider且进入digest。
  ```ts
  expect(JSON.parse(capturedRequest.body)).toMatchObject({projectId:'shared',
    assetWorkspace:'canvas',assetWorkspaceId:'shared',assetParentVersionIds:[versionId]});
  expect(JSON.parse(capturedRequest.body).referenceImages).not.toContain(overlayDataUrl);
  ```
- [ ] GREEN：受信编译字段严格验证后并入实际模型请求；保持来源验证、原grant冻结、请求幂等/本人费用/规范发布，不增加免费内部跳过标记。
- [ ] 真库真实POST→现有准入→离线transport→任务→发布矩阵：本人单扣费/重放、撤权/删来源前后、接受不确定、取消及迟到完成、一次退款；不用下游mock证明完整链路。
- [ ] 实际UI完成读取canonical结果，切项目/撤权/换版后不得另造引用；保留旧私人及节点入口行为回归与旧标注stale明确反馈。

## Task 3：复审与证据

- [ ] 定向全接缝回归、`pnpm exec tsc --noEmit --incremental false`、准确路径lint、保护门禁；每项单独记录exit和scope，不加总重叠测试。
- [ ] 准确修前后diff交独立spec/quality复审，再裁定精确保护路径；失败不放宽allowlist。
- [ ] 正确现有预览owner/editor来源稳定与识别真实解析、撤权/换版迟到结果；无授权远程模型则标未验证，不复制真实配置。
- [ ] 更新分层证据、UNVERIFIED、原Yjs/恢复计划及Obsidian；完整8C其余动作/下载/付费、8D–E及发布保持开放。阶段不齐不提交或转草图。
