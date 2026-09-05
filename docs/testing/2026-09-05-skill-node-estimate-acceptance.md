# 节点 Skill 费用预估与执行范围验收

## 范围与基线

- 日期：2026-09-05，Asia/Shanghai。
- 基线：main `db3f9ca6283b905d920c9d57051b9825e438eae4`。
- 属于统一 Skill Runtime Task12，不重做已冻结 Stage4。
- 本轮仅接入节点 Skill 服务端预估、确认窗口、失效保护及前后端一致的级联执行范围。
- 未修改登录、账户余额、积分账本、供应商适配、资产核心或 stable。

## 已建立的回归证据

- 预估503时不得创建工作流；取消、过期、重复确认及项目切换均有组件测试。
- 报价必需绑定缺失、供应商/模型不一致、取消后的迟到响应必须拒绝。
- 所选链包含必要上下游，排除无关节点；循环正文和并行分支保留。
- 执行器实际运行循环正文两次后才完成，专项12/12通过，证据 `output/skill-scope-executor-20260905.json`。该测试使用真实路由函数和执行器、外部服务替身，不是云端供应商测试。
- 失败回归均保留：`skill-node-estimate-red-20260905.json`、`skill-node-scope-red-20260905.json`、`skill-workflow-estimate-api-red-20260905.json`、`skill-quote-integrity-red-20260905.json`、`skill-scope-control-red-20260905.json`，均在 `output/`。
- 首轮全量5277通过，但随后修复了循环范围问题，不能作为最终候选的完整门禁。

## 当前验收状态

最终固定候选全量测试退出0：672文件、5282测试全部通过，0失败、0跳过、0待办，耗时849.33秒。测试仅使用localhost:55489隔离PostgreSQL，不访问业务数据库，测试后已正常停止该集群。报告 `output/skill-node-final-full-20260905.json`，SHA256 `2E5768FDEDC2B291217AF71CC4FB1C34337EDFEC7DD04D297FB0549E67F806AF`。

最终全仓lint退出0，0错误/944警告，日志 `output/skill-node-final-lint-20260905.log`。生产构建退出0，编译15.2分钟、TypeScript检查55秒、119/119页面生成，Build ID `wJQQamvK4SugXUYd2nOrf`。日志 `output/skill-node-final-build-20260905.log`，SHA256 `DC649F644B6FBE7E85E0D6EE6A0A39DF5B90F1FD28400AA3D78C42BFB0A851A2`；仅设置进程级8GB Node堆，不修改Coze配置。两条Node `--localstorage-file` 无有效路径警告保留，不声称零警告。

38项功能保护和 `git diff --check` 通过。远端main仍为基线，stable仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。

正确Chrome以扩展身份 `2b86e09b-4e88-427d-ae91-6970d48621d8` 和用户1识别，项目标签1727126792、预览标签1727126800。本轮控制会话重建后临时浏览器编号由6变为2，实际读取仍返回 `Debugger unattached`，只能枚举标签；未操作360、未新建标签、未重复发送Coze指令。此前已读取到管理员余额9022，仅是历史UI证据，不作当前账务断言。

## 授权与计费边界

### 本地续修候选（尚未发布）

- 最终补修后门禁（覆盖下方历史待验状态）：672文件/5306测试全通过、0失败0跳过，退出0；`output/skill-restore-reviewed-full-20260905.json` SHA256 `B45B0FFB2B4EDBA266BA02C57C3897916E5BDF399A423FDB883546A62CF3EFE1`。本机隔离PG55490已停止。全仓lint0错944警告、38保护检查通过。生产构建退出0，编译13.9分钟、类型54秒、119/119页面；Build ID `Iej7_Y1CIXKJ3FCwhdYlu`，日志 `output/skill-restore-reviewed-build-20260905.log` SHA256 `A46A917E498D40BBD8FB2D46CFBA06742F2CE4AB1AA267E418CF55B43AB62FB5`。两条Node本地存储路径警告未隐藏。可提交并同步隔离沙箱，不代表Task12或全平台云端验收完成。

- 独立审查后版本边界：5.6-sol中等推理只读审查提出failed进度遗漏、单次恢复超时停止观察两项。均已另写RED复现并最小修正；failed/timeout计入终态，读取超时保留观察队列且提示正在重试。最新四文件58测试通过0跳过，`output/skill-review-fixes-20260905.json`，类型检查和diff检查通过。旧候选生产构建因源码将变化而主动中止，退出1，不属于构建成功或已验证构建失败。下列5304全量仅覆盖审查前候选，不能证明当前增量；须重新固定全量/构建后才发布。审查子智能体已关闭，隔离PG已停止。

- 固定候选全量门禁：672文件/5304测试全部通过、0失败0跳过，退出0。报告 `output/skill-restore-full-20260905.json`，SHA256 `7125760D559FCE421D352BB8AA50EB71C2E6E6FA89983F3888EAC5B220F38338`。使用新建的本机127.0.0.1:55490隔离PostgreSQL，测试结束已停止，未访问云端库。全仓lint退出0、0错误944警告；最新类型检查退出0。38项保护检查实现包含工作区diff，已通过。生产构建与独立只读代码审查尚待终态，不发布。
- 暂停/取消标签补验：先RED复现无状态徽章，再在两种渲染器共享卡片显示“已暂停/已取消”。取消后不再观察、暂停继续只读观察、卸载停止观察均有组件断言，包含在上述全量结果中。

- 最新检查点：跨项目已显示结果清理、迟到响应不得继续读取资产均已完成失败回归及修复。恢复超时先以组件测试复现静默失败，再区分超时与卸载取消，展示明确刷新重试提示，不重新生成或扣费。失败证据 `output/skill-restore-timeout-red-20260905.json`；四文件45项测试全部通过、0跳过，证据 `output/skill-restore-timeout-green-20260905.json`；最新 `pnpm ts-check` 退出0。这只是本地专项，尚未运行本候选全仓门禁或发布。
- 缓存隔离补验：`skill-cache-scope-red-20260905.json` 复现旧全局缓存被直接恢复；改为按用户/项目/工作流的v2键保存并读取。未知归属的旧键保留但不自动恢复，不删除业务数据；已保存Skill仍由受授权的run查询恢复。五种场景覆盖旧键、其他用户/项目/工作流及本范围正常恢复。
- 迟到轮询补验：`skill-status-scope-red-20260905.json` 复现同一项目切换用户后旧响应仍显示执行完成；轮询新增AbortController，清理时中止，请求返回后再次验证取消。最终四文件51项测试通过、0跳过，`output/skill-cache-status-final-20260905.json`；类型检查退出0，修改文件lint0错误15条既有警告。`skill-cache-status-green-20260905.json` 的失败保留，原因是断言误包含提示词库初始化写入，已限定工作流缓存写回范围，不屏蔽失败。
- 多节点恢复预算已补RED→GREEN：首节点超时曾阻止后续正常节点请求，现保持串行读取、每个节点单独15秒超时，卸载中止当前请求；失败记录不阻止其他成品恢复。失败证据 `output/skill-restore-budget-red-20260905.json`。
- 新runId旧预览残留已补RED→GREEN：只清理run身份不匹配的执行展示，不删除任何素材/历史版本；新成品按新run查询恢复。失败证据 `output/skill-rerun-preview-red-20260905.json`。四文件最新53测试通过、0跳过，报告 `output/skill-rerun-final-20260905.json`，最新类型检查退出0，diff检查通过。
- 运行中恢复补验完成本地RED→GREEN：原实现只查询一次，executing后变completed也无成品。现串行只读观察非终态run，每轮间隔2秒，终态节点退出队列，生命周期取消清理请求与观察定时器；无POST重新生成。executing等活动状态映射为节点running，原始状态仍在结果投影内。失败证据 `skill-running-restore-red-final-20260905.json`、`skill-running-label-red-20260905.json`，最终四文件54项通过0跳过，`output/skill-running-final-20260905.json`；最新类型检查退出0，修改文件lint0错误15既有警告。
- 下一步固定候选代码复核、全仓门禁和云端同一run恢复验收。暂停/取消终态展示与观察清理仍应在复核中逐项检查，不以本地替身结果冒充云端结果恢复通过；当前候选未发布。

- 结果恢复新增RED：保存runId后组件没有成品图片，`skill-node-restore-red-20260905.json`；文本输出遗漏另有`skill-node-restore-text-red-20260905.json`。现有workflow-client新增只读恢复，GET run携带observeOnly=true，校验项目/工作区/run/Skill身份，按已有资产查询读取版本，并复用执行器的结果投影。
- node-editor按已保存runId恢复展示，开始执行、切换范围或卸载时abort；不发POST生成，不自动恢复已删除资产。图片、文本和身份错误专项累计16项通过exit0，报告`skill-node-restore-green-20260905.json`。首次恢复接入TypeScript通过，随后文本补丁仍需最终类型复核。改动文件lint0错误15警告。
- 仍需补跨项目迟到响应、重新执行竞争、恢复超时反馈、旧缓存与双渲染器专项，以及最终全仓测试/构建/Chrome同一run复验。当前不发布、不将Task12标完成。

- 2026-09-05已补进度范围组件失败回归：旧版找不到0/1，实际以全图为分母。失败报告`output/skill-scope-display-red-final-20260905.json`。
- 节点编辑器新增执行节点ID集合，从真实提交范围生成并随在途执行保存；进度分母使用该集合，分子仅统计终态节点。Legacy和ReactFlow节点卡运行态均限制在集合中。
- 当前组件套件9/9通过、命令退出0，报告`output/skill-scope-display-green-20260905.json`；TypeScript退出0、diff检查通过。曾因测试替身在最终缓存清理定时器前撤销导致未捕获错误，已按明确缓存清理状态等待解决，未吞异常。
- 此候选尚缺两套渲染器运行中专项、旧执行缓存兼容与结果恢复修复、全仓门禁及云端验证。未提交或推送，不以旧5282测试证明新改动通过。

预估接口继续验证用户、Skill版本、模型授权和项目/来源归属。工作流节点的动态上游输入允许在实际执行时验证，不为预估伪造图片。执行服务仍重新校验并按服务端价格计算费用。

界面报价为各Skill单次调用，其他节点及循环重复调用另计；不宣称全工作流总价、锁价或API强制确认令牌。未改变既有自动化客户端协议。

## 尚未通过的云端验收

### 2026-09-05 Chrome续验增量

- Coze只读复核：HEAD `5fbf94c8faacf313dc37a3b3db739882eb34cd9b`，tree `d924c13925c91a4ca43963381ae68ad42fc8003b`，与候选f15b05ee无源码差异；Build ID `kqc08JlYUHuX1Rmne5Gln`，`BUILD_EXIT=0`，5000 PID4565。此为Coze命令回执，不与本地构建混用。
- 第一次快捷键刷新后实际仍加载旧 `webpack-6d4a5a9f63eb4179.js`。RUN未显示报价，点击停止后界面回到可执行状态；该次的账务/底层终态尚未取证，不计入新版验收。
- 通过浏览器CDP `Page.reload({ignoreCache:true})` 刷新后，DOM脚本实际变为当前 `webpack-3da1dce2f1d948b5.js`。不能只以按下刷新快捷键证明新版本生效。
- 新版美食摄影Skill真实显示62积分报价；第一次取消，第二次重新获取报价后确认。网络证据两次estimate、一次start，取消与第二次estimate之间没有start。
- 实际start仅包含 `node-1788569246796-xnyehw` 一个ai-skill节点，start/tail相同、connections为空，未包含另外两个孤立节点。模型明确绑定APImartLLM `gemini-3.1-flash-lite-preview` 和APImart图像 `gpt-image-2`。
- executionId `exec-1788569269938-72jay6`，runId `58fa70c2-e347-45af-b505-fac910842443`。最终业务响应completed，仅一个节点success，耗时32671ms，返回图片URL及新assetVersion `e819d7ba-7cbb-4984-b444-f02d3a118104`；UI执行日志一条“Skill 执行 完成”。账务、刷新恢复、图片可视质量及下载仍未验证，不重复生成。
- 新发现展示缺陷：实际只运行一个节点，顶部仍为1/3，其他无结果节点也显示运行中。范围请求正确，不能混同为服务端多执行；需最小UI修复及回归。
- 后续实际图片解码成功：本次URL naturalWidth/naturalHeight均1254。点击保存后CDP绕缓存刷新，再进节点模式，3个节点及Skill配置恢复，但成品预览消失、Skill显示就绪。JSON查看器确认config.runId仍为本次run，未保存result/imageUrl/assetVersionId。代码轮询只补runId，最终执行缓存3秒后清除，加载仅恢复running状态，构成恢复缺口；不能标记结果恢复通过，也不能再次生成代替恢复。证据`after-save-refresh.png`、`after-save-refresh-dom.txt`、`saved-workflow-json-dom.txt`。
- 已向同一Coze会话发送一次只读账务核验，精确限定本次run/execution/assetVersion，不修改数据库；查询尚在执行，单次扣费及零退款仍未取得最终原始证据，不重发。
- 账务查询中间回执已见cloud_tasks completed/charged、credit_cost=62、charged_transaction_id=`ctx_charge_cbaa66d507284fd4e981165366c5763f`、refunded_transaction_id为空；流水1条consume -62，balance_after=8960。但完整原始结果与最终NODE_EXIT尚未取得，不能正式关闭账务验收。查询中错误地把assetVersionId用于wujie_assets.id，资产归属部分必须使用实际assetId `52cda863-2ceb-4387-afd0-97ee749c7dd6`纠正，不能把空结果解释为资产丢失。项目控制随后Debugger unattached，未重发查询。
- 证据：`output/skill-node-cloud-20260905/quote-62.png`、`quote-62-dom.txt`、`requests.json`、`latest-status.json`。未采集视频，不宣称完整视频/Trace验收。

### 最新云端回执纠正

- Chrome现有项目页与预览页均可读取，实际打开并关闭执行日志成功；未创建标签页、未操作360。隐藏的“上下文压缩中”按钮 `isVisible=false`，不再当作阻塞证据。预览实际webpack仍为 `3da1dce2f1d948b5`。
- 原只读账务查询已结束，Coze最终回执标注 `NODE_EXIT=0`：run58fa70c2 completed/charged、62积分，关联流水1条consume -62且无refund。资产查询已纠正为assetId52cda863，版本e819d7ba为其current_version，用户和项目一致。此为Coze查询回执与浏览器业务响应相互印证，不是本地直连数据库审计。
- 回执新增待核查：版本width/height为NULL、租约attempt_count=1但completed_at=0。不能直接认定导致重复计费，也不能忽略；需代码与专项证据判断。保存刷新丢失展示仍未云端闭环。未重复执行付费任务、未更改任何账务。

1. 新候选准确提交同步、构建及重启后的预览强刷。
2. 节点费用预估、取消不提交、确认仅提交一次。
3. Pear或APImart真实任务成功、精确模型身份、结果进入工作区。
4. 保存刷新、历史记录、下载及单次账务证据。

当前结论：不通过最终云端验收条件。此结论不表示本地回归已失败；Task12及总目标仍未完成。

### 671fa1bc 云端复验：图片已恢复但显示为单像素

- Coze同步已完成，不得重发：回执HEAD `c90322279be666f4bbb9650aae1bb82b8fef73e6`，tree `a52fc80b2ff9535a1b7d93689ccda44be2f8fc2c`与671fa1bc一致，构建退出0，BuildID `8eFHzpKq-DzJiJa1NL8fv`。
- 正确Chrome既有预览页可读取并截图；网络控制通道未阻塞。截图输出上下文截断不能作为断线依据。
- Skill状态恢复为完成，但真实DOM中1254×1254成品的显示矩形仅0.80005×0.79999像素（画布80%）。原因是NextImage固有width/height为1，只有max尺寸样式而无实际尺寸约束。图片解码成功不等于用户可见。
- 证据：`output/skill-node-cloud-20260905/671fa1bc-restored.png`及`671fa1bc-restored-dom.txt`。本次没有重新生成或修改账务。
- 最小候选：共享节点卡结果图明确width/height为100%、objectFit为contain。不改任务、资产、账户或积分链路。
- TDD：`skill-preview-size-red-20260905.json`中正常/超时恢复两场景均因尺寸断言失败；修复后`skill-preview-size-green-20260905.json`32项通过，`skill-preview-module-20260905.json`55项通过，均无失败或跳过。diff检查通过。
- 尚未推送。本次样式补修后的全仓门禁、生产构建和Chrome矩形/截图复验尚未执行；旧5306测试门禁不能替代本次门禁。Task12仍未完成。

### 单像素补修最终本地门禁

- 本次固定候选：672文件5306测试全通过，0失败/跳过/todo，真实隔离PostgreSQL55490参与且已正常停止。报告`output/skill-preview-final-full-20260905.json`，SHA256 `C223580E71D7937AEB0C2382604530120F1BC9D6465A63E329A6E07E93DFCA2F`。
- 全仓lint退出0：0错误、944既有警告；38功能保护门禁通过。未关闭任何测试或检查。
- 生产构建退出0，编译13.7分钟、TypeScript55秒，119/119页面。BuildID `iRGs3KeVu0EXq6qo6H0QI`。日志`output/skill-preview-final-build-20260905.log`，SHA256 `6FE89FCAECF8F98EF4ADED05F5189F0604227AA3FB6CB0D4CC513809B2A33912`。保留Node localstorage路径警告；8GB堆仅作用于本地构建进程，不修改Coze配置。
- 允许将此候选推送main并同步隔离Coze；仍须同一run的节点实际矩形、可视截图与刷新验收，不代表Task12或全平台通过。

### 01564010 云端首次强刷可见性通过

- 已推送main `015640102e435c662c15d86c54f404bea09abf7f`，远端复读一致，stable仍52f7c601未动。Coze只发送一次同步，最终回执merge HEAD `c0395f903295616ce7dfbda638c32a76c1ada24d`、tree `0c0a4343c3121ef87c19af3ca79e4faf72d8bc17`匹配，diff空、工作区干净，类型/38保护退出0，构建119/119退出0。
- 云端BuildID `tf2IgVAAov4L5QY2rH-ar`，唯一5000 PID4036，启动时间10:24:56。Coze健康命令实际使用curl -I，故200仅作为HEAD健康回执；浏览器随后的真实页面加载另作证据。
- 现有正确Chrome预览执行CDP Page.reload(ignoreCache:true)后，登录保留、原四图完整。点击节点模式，原三节点恢复，同一Skill显示完成；1254×1254成品的DOM矩形171.20×171.20，截图肉眼可见完整蛋糕图。未点击RUN、未重新生成。
- 证据目录`output/skill-node-cloud-20260905/`：`01564010-coze-final.txt`、`01564010-visible.png`、`01564010-visible-dom.txt`、`01564010-visible-size.json`。与旧671fa1bc的单像素截图分开保存。
- 随后已捕获“保存”的真实网络响应：`POST /api/workflow/save` 返回HTTP 200、`success:true`，workflowId仍为`wf-chat-import-7d07ebb373a5fdc9b11fe4afc7f3abec`。再次整页刷新并进入节点模式后，3个节点恢复，同一Skill仍为“执行完成”，同一1254×1254成品继续显示为171.20×171.20；未点击RUN、未产生新任务或新扣费。新增证据：`01564010-save-response.json`、`01564010-post-save-refresh-visible.png`、`01564010-post-save-refresh-size.json`。
- Chrome旧标签的调试附加曾同时失效，页面标题/URL可读但DOM操作返回未附着；通过同一Google Chrome实例建立受控替代页后恢复。该现象属于浏览器控制通道，不记为产品缺陷。点击大图/下载、完整Console/Network/Trace及Task12其他项仍未完成；当前关闭“节点成品可见性”和“保存后刷新恢复”两个缺口，不宣布Task12完成。

### 原生 Skill 租约与 AssetVersion 元数据核查

- `completed_at=0` 已确认是代码缺陷：原生 Skill 已写 `run.completed` 后，same-task 适配器仍尝试追加无 stepId 的合成 `tool.completed`；终态保护拒绝写入，使租约结算没有执行。新增测试先失败，最小修改为重读父任务权威终态并跳过重复合成事件；聚焦 73/73、TypeScript 通过。
- 已添加真实 PostgreSQL 成功执行用例，要求父任务 completed、租约 `completed_at>0`、owner 清空、一次 consume、无 refund/重复合成完成事件。本机未配置 `POSTGRES_TEST_DATABASE_URL`，8 项真库套件明确跳过，不能关闭云端租约问题。
- `width/height=NULL` 不是 SQL 写入丢失。真实任务结果仅含图片 URL，资产投影器没有宽高输入，因此落库为空。已新增 RED 并完成最小修复：在数据库投影事务之外用安全媒体读取取得真实元数据，失败不覆盖成功终态；投影器按 URL 保留尺寸/MIME/字节数，未以模型比例猜测 1254×1254。聚焦 66/66、全仓 5148/5148 非跳过项、类型、零错误 Lint、38 项保护及 119/119 构建通过，Build ID `mYvPkKVF-PAGUqYjiugVw`；166 项真库门禁和云端仍待验。
- 最终本地门禁：672 文件中 642 通过/30 个 PostgreSQL 文件跳过，5308 项中 5142 通过/166 项跳过/0 失败；`lint:build` 零错误、38 项保护通过；生产构建 119/119 页面，Build ID `r-dYejxNXZhfZ2hXiAEYl`。
- 当前 Task12 约 78%：节点生成、账务、显示、保存刷新、租约和尺寸持久化的本地修复已闭环；画布入口、暂停恢复、失败步骤重试、预览下载、完整诊断证据，以及租约/尺寸的真库与云端复验仍未完成。
