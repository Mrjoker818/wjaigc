# Skill 历史结果恢复：本地修复与云端待验收

## 范围与基线

### 22:36业务库原始查询：定位旧节点冲突

- Coze首轮使用不存在字段并把查询失败当空集，其“数据已被移出”“sync会自动恢复trashed”结论作废。第二轮多语句exec_sql没有返回有效行集，也不作为业务状态证据。
- 第三轮按限定指令使用Node内联pg.Client，连接业务环境变量，复制现有db-client连接归一化/SSL规则，同一连接BEGIN READ ONLY、SELECT、COMMIT、end。原始输出 `ROWS_RETURNED=2`、`NODE_EXIT=0`，同一快照 `2026-09-04T14:36:59.198Z`。
- 旧placement `eb548ea0-94a6-453d-b6a6-62fa076fc5ce` 为trashed，deleted_at=`2026-09-04T01:34:38.857Z`，对应额外提交的另一个项目旧Skill节点；owner/project/asset/version映射相符。其被重新带入POST后不满足adoptManagedCanvasMapping的active谓词，是已证实的冲突项。未获取具体requestId堆栈，不声称已排除所有其他冲突。
- 蛋糕placement `9a418cbe-6e3f-4ed3-90c4-74db0b3d8dac` 为active、deleted_at=null，owner/project/asset/version/entity/workspace全部对应当前4图项目；证明历史显式恢复已经生效。
- 两者transform={}，version.width/height=null。结合蛋糕GET缺失尺寸及前端归一化默认1，尺寸问题独立成立。
- 下一实施边界：先为shadow模式已删除托管节点被本地旧快照重新合入建立失败回归，保留合法未同步本地图片；另为历史恢复尺寸元数据建立失败回归。不得移除完整性校验、自动恢复旧删除图、清空本地缓存、改账本或强切asset-v3。

### 22:28 Chrome重连后的网络取证

- 后续对全部10个项目比较GET/失败POST，唯一资产身份集合差异位于另一项目 `project_1786341961637_hxc3szbke`：服务器10图、提交11图，多出节点 `canvas-skill:1c56c864-0b28-4e10-8b72-b15371c19adf:71b202ac-173e-41c9-92bb-6867e5d6e3a5`，asset `a94f4d77-d48e-4fb8-835b-ca26bfc7768b`，placement `eb548ea0-94a6-453d-b6a6-62fa076fc5ce`。该节点为明确的客户端独有项，但数据库status及实际冲突点尚未查询，不能称已确认软删除根因。
- 真实GET响应模式为 `assetGraphMode=shadow`、`canvasKernelMode=legacy`、`workflowRendererMode=legacy`。源码 `user-manager.ts` 的合并路径调用 `selectCanvasPlacementSnapshot`，后者在shadow模式选用并集合并、asset-v3才采用服务器集合。这是排查线索，不授权直接切换模式、丢弃本地未保存数据或重做Stage4。
- 正确Chrome扩展实例 `2b86e09b-4e88-427d-ae91-6970d48621d8`；复用项目页1727126792、预览页1727126796，没有创建标签页或操作360。
- Mr.joker已登录。通过工作台打开原项目后执行 `Page.reload(ignoreCache=true)`，未运行Skill或新增供应商调用。
- GET `/api/user-data/sync?key=projects` 返回200，响应projectRevision为7871，原项目服务器数据含4张图片，包含蛋糕asset `b474beef-2d87-4ff6-b23e-9e9458ad4a6c`、version `21531be6-2481-4a32-974b-6bbb2d72a70c`、placement `9a418cbe-6e3f-4ed3-90c4-74db0b3d8dac`。因此本次已证明服务器项目响应包含恢复图，不能再描述为仅临时显示或刷新丢失。
- 蛋糕图服务器快照缺少width、height、originalWidth、originalHeight；实际浏览器图片complete=true、naturalWidth/naturalHeight=1254。前端卡片显示1×1，后续保存快照width/height=420、originalWidth/originalHeight=1。这是明确尺寸元数据异常，尚未证明其为完整性冲突根因。
- POST `/api/user-data/sync` 返回500，原始响应 `{"success":false,"error":"LEGACY_MIGRATION_INTEGRITY_CONFLICT"}`。响应Date为 `Fri, 04 Sep 2026 14:28:51 GMT`，X-Request-Id为 `a4d45a2a-50d5-96e5-adf7-feb48948f377`，浏览器网络requestId为22908.357。
- 失败POST的key=projects，value包含全部10个项目，projectRevision=7871；当前项目4图的id、assetId、assetVersionId、placementId与GET一致。尚需定位全部提交项目中具体哪一条映射违反完整性条件，不能只检查蛋糕图便断言根因。
- Console在14:28:00Z、14:28:17Z记录自动同步500。Coze界面仍显示“上下文压缩中”，本轮未提交新诊断、构建、重启或修复指令；未修改业务源码、数据库或账本。

### 最新云端复验：不通过（2026-09-04）

- Coze只读回执：HEAD `37383cf9a448d52d52275c7aa708fd69280961ac`，tree `74b594b6ead23d6776854f10df9d066fefea0f08`，相对发布候选 `1b648e1a` 无源码差异。云端测试5068通过、163隔离PG跳过；不能称全量通过。
- done后又发生自动构建，回执当前PID26660、BuildID `ppYEhpFsV4C23zenxZ6p1`；最初BuildID不能代表当前运行，自动构建真实退出码尚未独立取得。
- 正确Google Chrome原预览执行忽略缓存刷新，Mr.joker登录保留；通过工作台打开 `project_1787549625844_nfmso3ts9`，确认原三图存在。
- 画布AI聊天 → 21 Skills → 美食摄影风格图 → 查看已完成run `164afb05-baf2-41ff-bd8c-204278291429`，结果1254×1254临时出现，但再次显示 `LEGACY_MIGRATION_INTEGRITY_CONFLICT`。AX工具现场同时包含第四张图片、对应run来源标记及错误toast。
- 未点击运行Skill，未新增付费生成。随后刷新调用因调试连接断开失败，刷新持久化结果未取得；不能沿用旧版本结果推断本次已丢失。
- 本次仍不通过。下一步取证实际transfer/restore/sync响应、placement状态与服务产物对应关系，先定位根因，不猜测修改或重复迁移。

- 缺陷：`SKILL-HISTORY-20260904-04`，Task12验收中发现的P1。
- 本地与2026-09-04本轮重新fetch确认的GitHub main基线：`f2b673ce2da9af29caed4d9f6b42faff11ce7907`。
- 只修复Skill历史结果与现有资产恢复入口的接入边界，不重做Stage4，不改账本、账号、供应商或数据库结构。
- `stable`保持`52f7c601ed150769e15d06fb435c6e360e28c9e7`，未操作。

## 真实问题

APImart美食Skill已完成真实蛋糕图生成，第一次落图、刷新、下载正常。删除本轮结果后从运行历史恢复，画布短暂出现图片并提示`LEGACY_MIGRATION_INTEGRITY_CONFLICT`，刷新后图片消失。

原因是固定幂等transfer复用已删除placement，却未显式恢复活动状态。既有完整性校验拒绝该失效引用是正确行为，不能移除校验解决。

## 最小修复

1. transfer返回放置状态；普通投影不得自动恢复已删除结果。
2. 用户从历史显式恢复时，调用既有restore入口，复用原资产、版本及placement。
3. 恢复失败不自动重试，避免提交已完成但响应丢失后，重复恢复用户再次删除的内容。
4. 图片尺寸加载完成、同步插入前重新校验修订号和目标删除代际，校验通过才清除目标删除标记。
5. 新Skill恢复携带transfer读取的PostgreSQL行版本；既有restore事务取得行锁后匹配可选`expectedPlacementRevision`，不匹配返回409 `ASSET_PLACEMENT_CONFLICT`。新客户端缺少版本时拒绝静默降级，旧入口仍兼容。

未新增生成调用或扣费调用，没有数据迁移，也不批量恢复历史图片。

## 测试证据

| 验证 | 结果与证据 |
|---|---|
| 显式恢复自动重试 | 生产回调执行：先1失败/2通过，最小修复后通过；`output/skill-history-retry-red-20260904.json` |
| 迟到响应/尺寸加载期间删除/本地删除 | 生产接收与落图回调执行：先3失败/1通过，修复后通过；`output/skill-history-late-insertion-red-20260904.json` |
| 恢复提交前另一页面已恢复再删除 | 真实隔离PG交错：先失败，版本前置条件后通过；`output/skill-history-delete-cycle-red-20260904.json`、`output/skill-history-delete-cycle-green-20260904.json` |
| HTTP边界 | 版本转发、409冲突、非法版本400、原入口兼容通过 |
| 最终完整测试 | 668文件，5231通过、0失败、0跳过，真实隔离PG包含；`output/skill-history-revision-full-20260904.json` |
| 类型检查 | `pnpm ts-check`退出0 |
| 全仓Lint | 退出0，0错误/943历史警告；`output/skill-history-revision-lint-20260904.log` |
| 功能保护 | 38项通过；`output/skill-history-revision-protection-20260904.log` |
| 生产构建 | 会话85442退出0，编译12.4分钟、构建内TypeScript52秒，Build ID `dpG6DGhjQK1vCcu58Q6oI`；日志 `output/skill-history-revision-build-20260904.log` |

测试JSON SHA256：`EA5760FE7F5D7A1B519E20128D5C34EC70F699D94781C964122057794C7F2761`。

构建日志SHA256：`70A0915861FE4081BA08087DC38FF1EDDE0C10C51ADD3B02108A928F15A0D600`。仅为本地构建结果，不代表Coze已部署。

保留一次测试基础设施失败：漏传pg_ctl端口使集群监听5432、测试连接55489，导致5062通过/144失败/18跳过。原报告`output/skill-history-race-full-20260904.json`未删除；显式55489重启并pg_isready通过后完成上表最终全量。不得将该失败归咎于云端程序。

## 未验证与发布状态

### 本轮shadow与尺寸修复续接（2026-09-04）

#### 最终候选门禁（最后两项审查修复之后）

- **最终构建已通过**：8GB进程堆重试退出0，webpack12.6分钟、构建内TypeScript52秒、119/119页面生成。Build ID `zYUQ6fpF8dLGH1FP9itrn`。没有修改云端内存或启动配置。候选本地门禁通过，云端待验，不等于全平台发布通过。
- 最终测试JSON SHA256：`D76E39414319DBAAB676D195B3C8837D15C45F57E96E3C023ECC8D51B0E54EC1`；8GB构建日志SHA256：`C02889642FD885C6B4FD58E073A35AA636979A05B9FA290C1CC3ED11F9F48B4C`。下方执行中记录为历史过程，保留以便审计。

- 重新fetch origin/main，仅更新main引用，仍与本地基线1b648e1a一致；没有遗漏新的GitHub源码。
- 完整Vitest：5253通过、0失败、0跳过，退出0，真实隔离PG两组环境变量均启用；证据`output/skill-shadow-release-full-20260904.json`。隔离PG已正常停止。
- 全仓ESLint退出0，0错误944警告，证据`output/skill-shadow-release-lint-20260904.json`。其中943项为此前存量，1项新增为infinite-canvas尺寸effect清理时读取sizeFillAttemptedRef.current的exhaustive-deps提示。该ref只有初始化及Set成员操作，没有替换集合引用；取消及迟到回调回归已通过，当前登记为非阻断静态告警，不关闭规则、不伪称历史告警。
- 缺失数据库配置：独立tsx进程清空DATABASE_URL和PGDATABASE_URL后真实调用readCanvasShadowSnapshot，assert.rejects确认配置错误，退出0，没有连接或修改数据库。API读取失败保持拒绝返回假空数据。
- 功能保护38项通过，类型检查已在最后两项源码修改后通过。当前正在执行生产构建，日志`output/skill-shadow-release-build-20260904.log`；本段不提前声明构建通过或云端修复完成。
- 上述默认4GB构建已退出134：V8 heap out of memory。确认进程退出、本机可用内存40GB后，以进程级NODE_OPTIONS=--max-old-space-size=8192启动一次重试，日志`output/skill-shadow-release-build-8gb-20260904.log`。历史`2026-09-04-skill-cancel-ui-followup.md`已记录相同4GB限制与8GB成功，本轮默认尝试属于可避免的环境重复，已在Obsidian最前检查点记录后续正确参数；未修改源码、依赖或云端启动配置。重试尚待终态。

#### 最新检查点：尺寸取消边界及独立审查

- 尺寸回填新增失败测试5通过2失败，定位effect清理后无法重试及Promise.all使一张图片阻塞其他图片；证据`output/skill-size-cancel-red-20260904.json`。改为逐张回填，以id+url记录尝试，清理时中断读取并只释放pending标记，失败URL不无限重试，新URL允许重新读取，使用最新imagesRef避免相邻完成互相覆盖。正常、1×1、旧URL、取消、失败、删除、多图片及换URL共8项覆盖。
- 此后完整套件5251通过、0失败、0跳过，退出0：`output/skill-shadow-final-full-20260904.json`。该次执行尚不包含下列两项审查修复，不能标记为当前最终全量门禁。
- 独立只读审查（gpt-5.6-sol / medium，智能体已关闭）指出两个高置信缺口；本智能体新增测试均稳定RED（32通过2失败）：GET等待期间本地新增图片被旧克隆草稿覆盖；字符串形式项目快照未被归一化，漏传shadow模式并绕过响应归属过滤。证据`output/skill-shadow-review-red-20260904.json`。
- 最小修复：仅GET加载采用mutationGeneration检查，拒绝接纳本地已经发生编辑的旧响应，不改POST确认逻辑；GET项目字符串先JSON.parse成数组后执行既有归属过滤和模式交付，不回写数据库。
- 最新模块回归127通过、0失败、0跳过（`output/skill-shadow-review-module-20260904.json`）；ts-check退出0；本轮10个改动文件ESLint退出0、0错误19警告（`output/skill-shadow-review-lint-20260904.json`）。隔离PG已停止。
- Chrome连接恢复：使用browser6（扩展2b86e09b-4e88-427d-ae91-6970d48621d8），现有项目1727126792、预览1727126796，未新建标签、未操作360。项目页沙箱断开弹窗刷新后，预览暂报ERR_BLOCKED_BY_CLIENT；只读核验发现5000无监听。后续沙箱自动拉起PID2092（Coze报告23:13:07），额外pnpm start因EADDRINUSE失败，不能计为启动成功。当前原服务本机GET200，强刷同一Chrome预览后四张图片和画布恢复，蛋糕仍1×1，符合本轮代码尚未部署。未付费生成、未重新登录、未改账本。
- 未推送、未构建本轮产物。后续必须对这两项最后修复执行最终全量及构建，再进行受控发布和Chrome验收。Task12及总目标保持未完成。

- 基线仍为main `1b648e1a5814f99e42347144d048e09ce2e144c6`，本轮为未提交工作区修改。未推送、未部署；origin/stable本地引用仍为`52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- 真实隔离PG尺寸RED：5通过1失败，失败精确为恢复快照缺少版本已有的1254×1254原始尺寸。证据：`output/skill-size-pg-red-20260904.json`。
- 最小修复：恢复时以可信版本尺寸补齐缺失/占位的原始尺寸，保留历史显示几何；前端补全修复被注释的resolve、1×1占位遗漏以及旧URL迟到结果污染。
- 联合回归：41通过、0失败、0跳过，包含6项真实隔离PostgreSQL测试；证据：`output/skill-shadow-size-green-20260904.json`。数据库测试使用本地55489隔离库，不涉及云端业务数据。
- `pnpm ts-check`退出0；`pnpm lint`退出0，0错误943警告。不能声称零告警。
- 本轮全量Vitest退出0：5234通过、0失败、12跳过（`output/skill-shadow-full-20260904.json`）。跳过原因是4个旧PG测试文件使用`TEST_POSTGRES_URL`而本轮初次仅提供`POSTGRES_TEST_DATABASE_URL`；不是业务失败，也不能算通过。显式指定同一本地隔离库补跑这4文件后，12通过、0失败、0跳过（`output/skill-shadow-pg-supplement-20260904.json`），退出0。两次执行合计覆盖5246项；原始含跳过报告保留，不改写成单次零跳过。隔离PG已正常停止。
- 功能保护门禁第一次退出1：新增契约文件未登记。按已批准修复范围仅登记具体路径`src/lib/asset-core/deleted-canvas-placements.ts`后，第二次退出0，38项功能ID与受保护组件均保留；没有添加通配规则或关闭检查。
- 仍未关闭：尺寸读取被组件更新取消后的重试、读取失败边界、生产构建及最新Chrome云端验收。本轮没有创建供应商任务或调整扣费、登录和运行模式。Task12仍未完成。

- 最终限定增量只读复审未发现确定缺陷或Skill版本漏传。普通画布撤销仍保持旧可选前置条件行为，不能宣称所有恢复入口都已获得新版本保护；该边界不在本次Skill修复中整体改写。审查子智能体已关闭。

- 本地回调执行测试不是完整React页面或真实Chrome多标签操作；PG传输适配是进程内调用真实服务与数据库，不能称完整HTTP端到端。
- 当前候选尚未在Coze部署，Chrome调试通道仍未附着；不能把本地通过写成云端问题已修复。
- 云端必须使用既有蛋糕资产验证删除、历史恢复、保存、刷新和下载；不重复付费生成、不重复取消已退款旧run。
- 仍需确认恢复不新增任务、消费、退款或版本；原有三张图片保留。
- 当前Task12与全平台目标均未完成，发布结论暂为不通过；不进入下一业务阶段。
