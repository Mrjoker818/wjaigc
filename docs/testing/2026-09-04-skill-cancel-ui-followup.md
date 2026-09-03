# Skill 取消终态真实浏览器续验

- 日期：2026-09-04（北京时间）
- 环境：现有 Google Chrome，未创建标签，未操作 360。
- 预览地址：https://62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.coze.site/
- 本地文档基线：6b40f707；部署业务基线沿用上次记录 8e997ebf，本轮未重新读取部署 Git。
- 项目：project_1787549625844_nfmso3ts9。

## 本轮真实结果

### 2026-09-04 前端步骤显示最小修复（最新检查点）

用户已批准前端限定边界。以 main@644ad75d 为基线，新增 Skill 专用显示投影，读取 run.created 的冻结步骤并重放有效事件；默认 Agent 投影不变，服务器执行、模型、登录和积分代码未修改。显示待执行、执行中、已暂停、已完成、失败、已取消、超时，保留已完成步骤并拒绝旧代次及终态后的迟到结果。

永久回归最初 5 项 RED；修复及边界补测后专项 37/37 通过。全仓 pnpm test：628 文件通过、27 文件跳过，4912 项通过、143 项跳过、0 失败，耗时 474.87 秒。跳过项包含缺少隔离 PostgreSQL 测试库，不能视为数据库验收通过。pnpm ts-check 退出 0；全仓 Lint 为 0 错误/943 警告，改动文件 --max-warnings 0 通过。保护门禁首次拒绝新增前端文件，按已批准边界登记精确路径后，38 功能标识和全部门禁通过；未放宽通配范围。

生产构建已完整退出0：webpack编译13.3分钟，TypeScript53秒，119/119页面生成；仅命令进程使用8GB Node堆，不改变云端配置。本地门禁完成，允许仅main发布供云端验收，不能判定全平台发布通过。步骤显示的新版 Chrome 真实验收尚未执行。此前取消终态和单任务流水的证据保持有效，但不冒充新增显示的验收；S3 受控恢复仍待验收。

本次浏览器接管检查：getState 识别正确 Chrome 3 / 用户1 / 扩展实例2b86e09b-4e88-427d-ae91-6970d48621d8，项目标签1727125989、预览标签1727125994均仍存在；getTab对两者均返回Debugger unattached。没有打开新标签、没有操作360、没有发送Coze同步指令。这是调试连接未附着证据，不是沙箱断开或上下文压缩中的证据。

### 同次任务账务复核及步骤列表缺陷定位

真实Chrome进入管理员积分管理-消耗明细，06:39的记录为Agent run -62与Agent run cancelled +62，各一条。另以管理员认证只读GET /api/credits?transactions=true&limit=50取得：consume=ctx_charge_8df4c20eca222f58f02a679692135346，createdAt=1788475183290，balanceAfter=144；refund=ctx_refund_55be6e4c3ba08e2c76903bdbff4884e3，createdAt=1788475189163，balanceAfter=206。本次时间窗仅两条，净变动0。证据为credits-ledger.png和credits-ledger-dom.txt。接口未暴露taskId，因此这是时间窗、金额、描述与UI一致的正向账务证据，不冒充数据库按taskId唯一性/并发退款证明。

新增已复现：Skill真实事件含skillSnapshot.steps但无plan.updated，reduceAgentEvents仅在plan.updated填充plan，run.created忽略冻结步骤；SkillRunProgress仅遍历projection.plan并只显示label。因此列表为空并非“没有子步骤”，而是前端投影遗漏。使用本轮4事件结构在本地调用真实reducer，断言保留2个冻结步骤稳定失败，输出status=cancelled、stepCount=0、currentStepId=conversation-1，退出1。此为最小重放诊断，尚未建立永久回归或修改业务代码。

下一修复边界：复用已冻结步骤形成显示投影并映射步骤状态，补永久回归；不改模型路由、任务执行、取消/退款或登录。历史05:20另见父预扣及图像扣费，尚未按taskId关联，列为需核对线索而非确定重复扣费结论。不得因当前UI两条流水就关闭所有历史账务问题。

### 2026-09-04 06:39 中国标准时间：TEST-SKILL-004 云端回归通过

在现有Google Chrome预览页、10图项目中使用“美食摄影风格图”完成真实UI提交一次。估价62积分；POST创建响应201，runId=67bfbf02-4b7c-4e13-9594-c7afec9648b0，charged=true、reused=false，创建时间2026-09-03T22:39:43.358Z。界面正在执行后点击暂停，业务响应accepted=true、projection.status=paused，随后点击取消，响应accepted=true、projection.status=cancelled。事件sequence 4为run.cancelled，时间22:39:49.197Z。

取消后真实DOM和截图显示“已取消”；继续按钮isVisible=false、取消按钮isVisible=false，输入恢复可编辑。本次以明确UI状态等待而非固定长sleep验证，未刷新页面帮助终态更新。TEST-SKILL-004“暂停后取消仍停留已暂停”在本次云端路径已通过，不再重复修复。

证据：output/skill-cancel-20260904/cancelled.png、cancelled-dom.txt、network-evidence.json。网络JSON为实际响应的脱敏选取，不是完整trace；请求6439创建、6457暂停、6461取消、6463事件，前缀均23628。读取到的Console error/warn为空，未声称全站无错误。未录制视频。

限制：本次事件plan为空，不能证明子步骤终态显示；仅用户主动暂停，不替代execution-error重试互斥；退款账本和一次退款仍未查询。发现取消被红色英文AGENT_RUN_CANCELLED呈现，记为交互文案待审，不因此判定取消失败。无新增业务代码、无GitHub推送、无stable修改。

### 2026-09-04 本次只读核查结果

Coze 返回报告：main HEAD=03d1b433，tree=ccffe338仍匹配644ad75d；5000进程为18282，旧17220不存活；磁盘Build ID=6aQ5Uyk7TXgyxwt1clVXA，与旧报告不同。以上为云端报告证据，非本机独立进程读取。报告结束后平台生成版本336866e并出现预览准备中，随后刷新现有Chrome预览，入口短暂出现后自动恢复原10图项目，未重新登录。

不采纳Coze报告中未经证明的推断：本地src/lib/asset-core/mode.ts明确缺省返回legacy，不是shadow；/proc启动环境缺少变量也不能证明Next运行时未加载环境文件。读取/proc/PID/cwd/.next/BUILD_ID只证明进程工作目录的磁盘文件，不能独立证明进程内存正在服务该构建。HMR或自动重启的具体触发原因仍未确定。

测试统计仍未闭环：Coze通过echo重述批次数字而非提供原始测试日志，未将其新估算4893通过作为新增验证结果。本轮仅估算62积分，未运行新Skill、未新增扣费。原图回退已通过的记录不重做，Skill取消UI与受控S3恢复仍未验证。没有业务代码调整或GitHub推送。

> 2026-09-04 后续纠正：此前将 Coze DOM 快照中的“Loading 上下文压缩中”误判为可见阻塞。真实截图无该提示，对应按钮 isVisible()=false。Chrome 重连后页面读取、截图、全部工具展开/收起均成功，Coze 已接收一次只读环境核查指令并开始执行。撤回该阻塞判断，不据此重启沙箱或重复同步。Skill 表单及62积分估算已验证，尚未提交本轮新运行。

管理员已登录，仪表盘显示 10 个项目、453 张图片。进入现有项目，三个画布图片实际可见，画布 AI 聊天 Skills 入口显示 21 项。未操作独立智能对话。

通过页面填写美食摄影风格图，估算 62 积分，点击一次运行。界面出现正在执行、暂停和取消。点击暂停后显示已暂停及继续按钮。随后点击取消，按钮短暂禁用后恢复，但界面持续保留已暂停、继续、取消。

对应真实任务：`c4c6ac10-a5ec-4ab2-ba19-1ce44ddde7fb`。

独立认证 API 核对：

- 父任务：cancelled。
- conversation-1：completed。
- conversation-2：cancelled。
- creditStatus：refunded；creditCost：62。
- 创建时间：1788470415496；更新时间：1788470433283。

随后 Chrome DOM 仍断言已暂停可见，并已在本次对话保存截图。开始采集后的 Console error/warn 为空，不代表提交之前的全程日志无错误。

## 缺陷与边界

取消终态前端同步未通过。服务端取消与退款状态有正向证据，但账本唯一退款条目未在本轮复核。根因待定位，不能仅凭状态接口成功关闭此项。

本轮为手动暂停，不是 execution-error 暂停，因此不能替代从失败步骤重试按钮的专项断言。取消时步骤列表为空，亦不能声称已验证子步骤终态呈现。

网络采集在取消之后启动，不能冒充拥有该次 PATCH 原始响应。另观察到 session/task-events 重连请求，尚未确定是否相关，不作为已定位根因。

缩略图失败回退及受控 S3 缓存恢复未在本轮执行。无业务代码修改，无推送，无 stable 分支修改。

## 结论

本轮取消终态 UI 验收：不通过。保留现有页面与任务，不重复创建付费任务。

## 本地定位与最小修复

事件 API 已确认 sequence 6 存在 run.cancelled，排除后台未写入取消事件。真实 Hook 组合测试将取消响应和零延时刷新放在同一次 React 批处理中，稳定复现 expected cancelled / received paused。

根因：useSkillRun 通过先清空 eventRunId、再 setTimeout(0) 恢复相同 ID 触发订阅。在 React 合并更新时最终 ID 不变，已因 paused 停止的 useAgentRunEvents 不会重新订阅。

最小修复使用单调递增 refreshVersion 作为订阅依赖，保留原 runId 和 generation 校验；删除零延时重置技巧。不调整登录、后端账务和终态保护。

- RED：真实 Hook 组合测试 1 项失败，状态仍为 paused。
- GREEN：组合测试和原控件测试 29 项通过。
- TypeScript：pnpm ts-check 退出 0。
- 全仓回归：627 个文件通过、27 个文件跳过；4904 项通过、143 项跳过、0 失败，448.76 秒，退出 0。跳过项未作为通过。
- 改动四文件 ESLint：退出 0，无错误或警告输出。
- 保护门禁：38 个功能 ID 与组件路径保留，仅允许本次两个 Hook 业务变更，0 警告，退出 0。
- 生产构建：默认 Node 堆约 4GB 时内存不足，退出 134；本机可用物理内存约 45GB，以进程级 NODE_OPTIONS=--max-old-space-size=8192 重试后完整退出 0，webpack 编译 12.2 分钟、TypeScript 52 秒、119/119 页面生成。日志存在 localstorage-file 警告。未修改项目、依赖或云端启动配置。
- 发布状态：本地门禁完成，准备仅 main 提交；Coze 原项目和预览标签再次失去调试连接，尚未发送拉取指令、未部署、未云端复验。
- 云端修复后复验：未执行，不能以本地测试代替。

## 发布后环境复核

修复已推送并从远端复读 `main@82285dee1e648362b93a5c365fa29805fd09df77`，stable 未变。再次接管原 Google Chrome 项目标签仍报告调试连接未附加；直接请求该沙箱 API 返回“无法连接到后端服务”。因此未发送 Coze 拉取指令，未声称完成部署或云端验收。

历史缩略图证据的 readyAfter=3 实际是首个单条批次快照，已改名 readyAfterFirstBatch，避免与后续 41 项完成数混淆。本轮未重新执行回填，未推算或补造最终数据库快照。

## 续验检查点（2026-09-04 05:59，中国标准时间）

本节覆盖上文历史“未发送拉取”状态：目标 main@644ad75d 的同步指令此前已向同一 Coze 项目发送一次，已观察到普通合并及源码 tree 匹配、门禁启动；最终构建和重启报告尚未读取，不得重新发送同步来替代查询。

本地 HEAD 为 644ad75d2fcfe5c24d417f8ebeb9e880524c2b9b，业务修复仍为 82285dee。Google Chrome 浏览器 3、原预览标签 1727125985 已重新接管；项目标签 1727125976 仍返回 Debugger unattached。

- 刷新前真实 DOM 仍为旧美食 Skill 表单和“已暂停”。这不是已部署新版本失败的证据。
- 页面关闭 Skill 按钮实际响应，表单及暂停控件从 DOM 消失。
- 快捷键刷新未能证明加载完成；随后在同一标签重新导航至原项目 URL，DOM 实际恢复为图像生成界面，画布三图尺寸分别为 1024×1024、768×1152、1920×1088，登录保持。
- 根地址直接请求返回 HTTP 200、17967 字节，仅证明入口可达，不证明部署版本、取消修复或供应商业务通过。
- 没有新建标签、进入 360、发起付费任务、重复取消、修改积分或操作 stable。

证据为本对话 Chrome DOM 工具返回与只读请求输出；本轮未生成独立截图、录像或 Trace，不标为完整 E2E 通过。下一断点仍为读取同一 Coze 任务最终报告，确认部署后验证取消状态；ADMIN-003 的浏览器失败回退和受控 S3 恢复仍未验证。

## ADMIN-003 样本定位续验

### 单图缩略图重试与回退真实通过（Chrome 5）

用户重开标签后，使用现有 Chrome 5 / 1727125994，管理员仍登录。通过仪表盘“10 张图片”进入同一样本并reload。页面自身 GET projects（23628.4838）真实响应为 shadow，10个canvasImages均有thumbnailUrl。此时48%缩放的DOM前两张确实使用512.webp、naturalWidth=512，纠正此前仅凭旧页面观察作出的未切换判断；运行模式与此前Coze报告asset-v3不同，尚待环境核对，不静默修改配置。

使用Chrome Network.setBlockedURLs仅阻断一张已观察到的512.webp及其查询参数变体，禁用浏览器缓存，reload并等待目标图片实际挂载。第一次探针在挂载前即清理，未产生目标请求，不计通过；第二次有效探针取得：

- 首次缩略图请求23628.5089失败。
- 重试请求23628.5099，且只添加一次`__wujie_thumbnail_retry=1`。
- DOM切换canvasMediaSource=original，随后原图gen-1786342073541-gymekg.png完成1254×1254解码，complete=true、canvasMediaState=ready、thumbnailRetried=1。
- finally解除阻断和缓存覆盖；再次reload后同一节点正常回到512.webp、naturalWidth=512、ready，不残留重试标记。

本项结论：真实Chrome、当前shadow模式下，单张缩略图失败后一次重试及原图回退通过；不代表asset-v3配置、S3对象恢复、全部媒体或全平台验收完成。未新增模型任务或扣费，未改业务源码或持久化媒体。截图和脱敏观测摘要位于`output/admin003-20260904/thumbnail-fallback.png`与`thumbnail-fallback.json`。JSON是工具观测摘要，不是完整原始网络trace；未生成录像。Coze当前处于“上下文压缩中”，未发送新的同步或模式调整命令。

### 重连后的部署报告与正确样本（后续检查点）

Google Chrome 重连为浏览器 4 后，已实际读取此前唯一同步任务的最终报告。Coze 报告 main HEAD=4250ef81，tree=ccffe338，精确匹配 644ad75d；stable=52f7c601 未变；Build ID=JBeoU3bvBtJPaoBNHgj9_，唯一 PID=17220，asset-v3。新增两文件 1+28 项、Skill 聚焦273项、保护6项、类型、Lint、119页构建均报告通过。Coze“全量”统计为614文件/4346项通过、7文件/17项跳过，与本地627文件/4904项通过、27文件/143项跳过并不等同；未读取全部原始日志前不得认定云端执行了同等全量范围。

已按要求在同一预览标签 reload，随后通过仪表盘唯一“10 张图片”卡片实际打开 project_1786341961637_hxc3szbke。真实DOM显示10图，100%及四次缩小后仍读取原图。采集到页面 GET projects 响应200，请求ID=23628.4139；读取其响应体时调试连接中断，尚不能断言浏览器实际收到与独立API相同的10个thumbnailUrl。没有启用Fetch拦截、没有伪造图片错误、没有取消或重发模型任务。

下一步恢复同一标签后优先续读该响应（若已过期则重新捕获一次页面真实同步），确认投影字段和缩放值，再执行单张缩略图失败重试与原图回退。此观察暂不升级为确定Bug。部署报告“待读取”已解除，但Skill取消云端验收、S3恢复和云端测试覆盖差异仍未关闭。

Google Chrome 实际打开项目仪表盘、资产库和既有 100 节点项目，DOM 与图片 naturalWidth 证明原图正常解码。画布低缩放后仍读原图，不能立即判为缩略图故障：随后真实认证 GET `/api/user-data/sync?key=projects` 明确返回 assetGraphMode=asset-v3、canvasKernelMode=legacy、workflowRendererMode=legacy，10 个项目；原三图项目和 100 节点项目均无 thumbnailUrl。

同次只读投影统计：13 图项目 project_1786342484250_vjti42ltw 有 7 张缩略图；10 图项目 project_1786341961637_hxc3szbke 有 10 张；9 图项目 project_1786292967408_hvsznuh5k 有 3 张；其余为 0，合计 20 张。这是当前接口投影数，不是数据库制品总数，不与历史 41 次回填任务数混用。

下一样本固定为 project_1786341961637_hxc3szbke（仪表盘唯一“10 张图片”项目），不重新回填、不重新归档、不创建媒体。返回仪表盘时发生控制超时，随后预览返回 Debugger unattached，尚未打开此目标，不声称完成失败重试/原图回退测试。

已保存真实截图：`output/admin003-20260904/100-node-original-display.png`。截图为 100 节点项目的原图显示证据，不是缩略图失败测试证据。无请求拦截或页面注入，无新增模型任务/扣费，无业务代码修改。项目页同步最终报告仍未读，所有有关新构建的结论保持未验证。
