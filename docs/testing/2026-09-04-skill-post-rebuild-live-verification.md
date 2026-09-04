# Skill 重建后云端真实验收

## 环境与范围

- 日期：2026-09-04，Asia/Shanghai。
- 基线提交：06351176c80d5d47eaf0062fd7e96ef77e492b0e。
- 目标源码 tree：13f3803a5f3ca53591049b2a8bf2ae8e1469b104。
- 项目：https://code.coze.cn/p/7671964106919837702/preview 。
- 预览：https://62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.coze.site/ 。
- 浏览器：Google Chrome 用户1，现有标签1727126468；未操作360或新建标签。
- 本轮仅验证统一Skill Runtime Task12，不重做冻结阶段，不修改业务源码。

## Coze 完成回执

新对话8中的同步及两条纠偏均已回复。最终源码tree与目标一致，HEAD为Coze形成的065dec0a前缀提交；最终回执BuildID为BJbgobiTcMNCHJvvV4oxN，唯一5000服务PID17877，无构建残留。

完整云端测试退出码0：5017通过、0失败、158跳过，共5175；632文件通过、28文件跳过。跳过项据回执为缺隔离PostgreSQL。保护基线38项、类型及ESLint通过。云端未用业务数据库运行集成测试。

系统自动构建的退出码未取得，只取得构建产物与服务响应佐证，不记为已证实退出码0。历史EADDRINUSE来自手动启动与沙箱自动启动竞争，最终回执称无双实例；不抹除该失败记录。本地AI模型缺失日志不能视为所有本地图像功能通过。

## 真实操作证据

1. 使用现有Chrome标签执行Page.reload(ignoreCache=true)。
2. 刷新后Mr.joker仍登录，仪表盘显示10个项目、454张图片。
3. 打开三张图片的未命名项目，地址精确为project_1787549625844_nfmso3ts9。
4. 画布出现1024x1024、768x1152、1920x1088三张图片节点。
5. 点击AI聊天、Skills技能库、美食摄影风格图。
6. 面板显示菜品名称、菜系类型、拍摄角度、视觉风格、使用目的、估算积分、运行Skill；不显示旧暂停任务或历史运行入口。

上述证据来自真实浏览器DOM与URL，不是组件模拟测试。未取得录像或Trace，不标记证据完整。

## 新增阻断：刷新后旧 Skill 任务不可达

- 关联任务：bdb9e4dc-be49-450b-b04c-8ac168441c07。
- 预期：刷新并回到相同用户、项目及Skill后，能够找回暂停任务、查看状态并通过应用正常取消或恢复。
- 实际：只显示新运行输入面板，无旧任务及取消入口。
- 本地代码线索：src/components/skill-runtime/use-skill-run.ts内runId由useState初始化，没有恢复参数；组件卸载清空activeRun。该线索尚需结合列表API及其他入口核实，不能只凭它宣布全站无历史能力。
- Coze只读数据库取证已定位原任务：cloud_tasks.status=processing、credit_status=pending；执行租约paused_at非零、completed_at=0，最后事件run.paused，pauseReason=execution-error；Skill身份保存在run.created事件的skillSnapshot。任务仍存在，不能称为数据库任务丢失。
- 消费退款条数、余额和其他恢复入口的最终只读报告仍待取得。

## 验收状态

### 17:38 生产构建与复核门禁

- 唯一生产构建会话1060最终exit0；编译13.4分钟，内置TypeScript56秒，119/119静态页面生成完成。BuildID=Lx70QQI4cyGw8yBasewi2，日志output/skill-history-final-build-20260904.log。构建过程中未改业务代码、未重启进程、未跳过检查。
- 日志保留两条Node的--localstorage-file无有效路径警告，不据此声称无警告。未发现构建失败。
- 独立只读复核01～03修复边界未发现可证明的新缺口；未改文件、未运行数据库，审查智能体已关闭。完整ChatPanel接线主要由源码契约覆盖，四图恢复为精简React行为容器，仍须Chrome云端证明。
- 本地门禁齐备，允许仅main提交推送候选以供云端验收；不是发布通过。正确Chrome项目页本轮仍Debugger unattached，未重复发送Coze拉取/构建指令。

### 17:22 最终候选全量回归

- 当前审查后候选完整Vitest退出0：665文件、5208测试通过、0失败、0跳过；614.12秒。使用本机127.0.0.1:55489隔离PostgreSQL，四个数据库环境变量仅设置于测试进程，未改.env及云端配置；测试后pg_ctl正常停止。
- 报告：output/skill-history-final-full-postgres-20260904.json；日志同名.log。SHA-256：5721dd4d40c2829c39e478cfdb6e7941a92276b7281867ec43a5fef5e2f43b90。
- 最终全仓Lint退出0，0错误/943现存警告，日志output/skill-history-final-lint-20260904.log；本候选类型检查及保护门禁此前同轮已退出0。
- 该结果覆盖01～03本地修复候选，不再借用审查前5200报告。仍不关闭云端缺陷：生产构建、Chrome界面及真实账务/成品验收尚未完成。
- 远端main只读核实06351176，stable52f7c601；未提交、未推送、未新发Coze构建指令。

### 17:11 React恢复及代际隔离检查点

- SKILL-HISTORY-01补齐真实React状态更新和异步保存复现：旧实现只交付2/4张，稳定接收回调后交付4/4张；回调读取最新接收函数，项目切换和卸载后的迟到结果不交付。
- 快速显式恢复时，旧请求pending曾阻止新接收，新增用例先失败。pending改为以AbortSignal记录所属恢复代际，旧请求finally仅清理自己，不能清掉新请求状态；正常运行去重仍保留。
- 本轮重新执行6文件38项，全部通过、0跳过，报告output/skill-history-react-recovery-green-20260904.json。pnpm ts-check、相关4文件ESLint、pnpm check:protected-baseline均exit0。
- 这些是本地组件/协调器证据，不是云端产图、取消或退款证明。此前5200全量仅对应审查前候选；最终候选仍需完整PostgreSQL回归及生产构建。
- 用户告知Coze构建完成；正确Google Chrome现有项目和预览标签均返回Debugger unattached，尚未读取当前构建回执或执行刷新。未重复发送排队指令、未新建标签、未使用360。
- 当前候选未提交、未推送；Stage4等冻结部分未重做，Task12及总目标继续保持未完成。

### 17:03 历史数据库窗口修复

- 为listCloudTasks增加显式skillRun筛选；不传此筛选的旧调用保持原SQL行为。Skill列表统一传入用户、项目和Skill范围，在LIMIT之前用run.created事件的owner/project/task身份关联筛选，排除普通任务和观察影子记录。
- 模式、Skill ID、工作区都参数化查询；simple-chat映射到持久化chat模式。未新增任务系统、迁移、账务写入或模型调用。
- 新真实PostgreSQL测试插入2000条跨项目、跨Skill、跨工作区及普通任务，还有其他用户记录。先返回错误noise记录而失败；修复后正确只返回目标，并验证simple-chat正反向、SQL特殊字符不改变查询。
- 查询测试与服务/存储专项3文件94项通过；新PG测试与原Skill并发测试合计2文件8项通过、0跳过，报告output/skill-history-scope-postgres-green-20260904.json。TypeScript与定向ESLint退出0。
- 复用已记录角色的本机测试库，测试后pg_ctl正常停止。当前不再有数据库测试或构建运行；未推送。
- 剩余审查项SKILL-HISTORY-20260904-01：React回调变化打断多图恢复，必须先补完整渲染/异步保存复现再修复。最终全量/构建及云端待此项完成后统一执行。

### 16:59 独立审查与构建中止检查点

- 独立只读审查发现3项P2，已登记SKILL-HISTORY-20260904-01～03。5200通过的全量结果仍真实保留，但不能证明这3个新发现边界正确。
- 删除后显式恢复用例先1失败/16通过；在显式activate时清空本次完成缓存后，相关3文件21项通过。普通同一次运行内的pending/completed去重保留，已有画布版本检查仍执行。
- 501任务历史窗口用例先1失败/37通过，当前保持失败，未隐藏或删除；下一步范围过滤必须在数据库LIMIT之前完成，不能仅扩大窗口。
- React回调身份变化导致4图恢复中断的问题已核对实际调用链，仍需完整渲染/异步保存失败测试和最小修复。
- 本地生产构建以进程级NODE_OPTIONS=--max-old-space-size=8192启动，日志output/skill-history-build-20260904.log。审查问题得到稳定失败测试后，主动中止已知不能发布的候选构建；执行会话62124退出1，确认无残留next build进程。这不是构建成功、不是编译失败，也不是由于观察超时重启。
- 修改源码后必须重新执行最终门禁；当前未推送。远端只读核实main仍06351176，stable仍52f7c601，未触碰stable。审查智能体已关闭，无遗留运行任务。

### 16:50 全量回归检查点（未推送）

- 新增真实组件交互集成：从历史列表查看暂停任务、接回共享事件订阅、点击原取消按钮并展示取消终态；只有1次PATCH、没有POST新任务。此测试隔离了网络响应，不是云端退款证据。
- 四张输出跨两次协调器重建的测试先失败（重复插入），随后将现有画布版本检查接入原投影协调器，修复后只插入缺失的3张。未重构其他画布能力。
- 本机旧测试库未能确定角色，默认postgres/Administrator连接被拒；单用户只读查询被Windows管理员限制拒绝，未改变权限。旧库已停止，改建独立测试库output/postgres-skill-history-20260904，角色wujie_test，监听127.0.0.1:55489，数据库wujie_skill_test，无密码trust仅本机测试。测试后已正常停止，未安装服务。
- 在进程环境中将TEST_POSTGRES_URL、POSTGRES_TEST_DATABASE_URL、PGDATABASE_URL、DATABASE_URL全部指向上述本机隔离库，未修改.env或云端配置。
- 全量Vitest实际exit0：663文件、5200测试通过、0失败、0跳过；耗时654.42秒。报告output/skill-history-full-postgres-20260904.json，SHA-256：b435595953249dde78efbf5f566513e98c3871d314e491f334a8f29a3a84a732。日志output/skill-history-full-postgres-20260904.log。
- TypeScript通过；全仓Lint exit0，0错误/943历史警告，日志output/skill-history-lint-20260904.log。
- 保护基线先阻断新增SkillRunHistory.tsx未登记。依据已批准2026-09-02规格的刷新恢复和历史要求，仅添加该精确路径到允许变更清单；未移除保护项。复跑38功能保护及全部门禁exit0，0警告。
- Chrome正确browser5原项目页再次返回Debugger unattached。未新建标签、未操作360、未重发Coze拉取、未提交供应商任务。
- 剩余：生产构建、视觉及Chrome云端全链路验收，真实账务证据仍未闭环。候选代码未提交或推送，目标保持active。

### 16:34 历史 UI 接入检查点（未推送）

- 画布AI聊天的当前Skill面板新增运行记录列表、状态、时间、任务ID、刷新与显式查看入口。只查询当前项目/画布模式/Skill，不限制当前聊天会话，允许找回旧会话任务。
- 已实现列表加载失败/超时/空态；账号或项目切换时丢弃旧响应，跨范围记录不展示。查询只读，不调用生成/恢复执行API。
- 选择任务接回共享Hook和既有进度控制；原始素材版本从run.created事件读取，不使用当前选中图片替代。
- 结果投影增加画布同assetVersionId跳过；此处目前只有接线契约证据，尚缺完整多图恢复行为测试与真实浏览器证明，不能宣布去重闭环。
- 本轮组合回归7文件102/102通过，包含历史组件5项、Hook恢复7项、原控制28项、取消订阅1项、执行器37项、API21项、画布接线3项。类型检查退出0；新组件/Hook/路由/服务及相关测试定向ESLint退出0。
- 尚需完整集成测试、全量回归、保护基线、构建、视觉验证及Chrome云端付费链路。仍未提交、推送或触发Coze重新构建。

### 16:28 本地恢复补丁检查点（未推送）

- 恢复 Hook 按真实 `{ run }` 响应读取；只读加载使用 `observeOnly=true`，不启动执行恢复。
- 单任务和列表 GET 保留既有默认恢复行为；显式只读查询不派发任务。
- 历史服务增加 projectId、surface、workspaceId，并在数量限制之前按项目、模式、工作区、Skill 过滤；仍执行真实用户归属校验。
- 列表路由验证范围参数长度、空值、控制字符及 surface 枚举。
- TDD 证据：先复现恢复协议/只读2项失败、历史隔离4项失败、列表接口5项失败，再最小修复。当前5个专项测试文件94/94通过；随后新增测试类型标注修正后，pnpm ts-check退出0，git diff --check退出0。
- 未完成：历史入口UI、作用域切换并发测试、结果恢复去重、完整回归/构建、Chrome云端验收。没有推送本地候选补丁或要求Coze重复构建。
- Chrome用户1仍可枚举正确两个标签，但实际控制均返回Debugger unattached。本次不能标记云端刷新或验收通过。

**不通过（Task12尚未闭环）。** 新预付链路还没有进行新任务的供应商真实产图、取消退款、保存恢复及下载验收。本轮未充值、未新建付费任务、未重试旧拒绝任务、未修改任何历史账本。必须先恢复旧任务的正常应用可达性，不能以直接SQL退款或额外充值绕过。
