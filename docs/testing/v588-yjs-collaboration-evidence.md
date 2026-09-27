# V588 Yjs 协作分层验证记录

更新日期：2026-09-27。

## 当前结论

- Task 1–6 已有本地阶段证据，见对应实施计划；不得重新实施。
- Task 7 浏览器文档桥的本地实现、逐项覆盖审计及最终回归已完成；本地阶段收口不等于完整协作能力或云端发布通过。
- 恢复控件遮挡与 Firefox 测试输入隔离已处理；不同素材真实并发覆盖已补齐。最终规格 `run-6db7f863` 的 Chromium/Firefox/WebKit **3/3通过，4.6分钟，exit0**。前一轮 `regression-15d16ba1` 的PSD单项超时历史保留；仅修测试等待身份后，新隔离库 `regression-05562230` **875文件/7532项全部通过，1322.61s，exit0**。
- Task 8 媒体命令和三工作区权威视图、Task 9 阶段及云端门禁尚未关闭。
- PSD正式测试等待身份已修正，仅5行新增/3行删除；受控反序1/1、原文件15/15通过，限定复审spec/quality通过。产品与最终浏览器规格未变。`regression-05562230`/46593已全部终态：migrate/core/focused/full/validate/protected/build均0、nft为1，整体exit1；PG正常停止，5109/55492无监听。构建121/121页、243traces，保护38/38零警告。严格NFT为231路由/556069引用/80宽/23含配置/24含根文档，BUILD_ID为 `unverified-77ea1592f59f16a9f612ae7988e490a0`。完整测试有Node localStorage路径及夹具CRLF提示，不称零警告。
- 当前无 Yjs 云端发布通过结论。严格构建追踪审计仍失败，构建身份为 `unverified-*`；不推送、同步 Coze、付费验证或部署。

## Task 7 本地证据（历史与最终分开）

原始日志根目录：`J:/无界本地版/projects/_tmp_e2e/yjs-task7-68fba343/`。这些日志属于本地隔离环境，不能代替 Coze 或生产证据。

| 检查 | 运行记录 | 实际结果及边界 |
| --- | --- | --- |
| 最终聚焦 | `regression-05562230/focused.log` | 6文件/93项通过，22.88s，exit0 |
| 最终完整Vitest | `regression-05562230/full.log` | 875文件/7532项通过，1322.61s，exit0，超时上限15000ms未变 |
| 最终validate/保护/构建 | `regression-05562230/exit-codes.json`及对应日志 | 均exit0；38功能标识/0基线警告；121页/243traces；不是发布许可 |
| 最终严格NFT | `regression-05562230/nft.log` | exit1，231路由/556069引用/80宽/23配置/24根文档 |
| 最终三浏览器 | `run-6db7f863/test.log` | Chromium/Firefox/WebKit3/3，4.6m，exit0；产品及E2E与最终全量候选一致 |
| 聚焦客户端、组件、API、真库 | `regression-178e68a6/focused.log` | 6 文件、80 测试通过 |
| 生命周期及布局补丁前的完整 Vitest | `regression-178e68a6/full.log` | 875 文件、7517 测试通过；命令带 `--testTimeout 15000`，不能代表后续补丁通过 |
| 类型和构建版 ESLint | `regression-178e68a6/validate.log` | 日志完成类型生成、TypeScript 与 `eslint . --quiet`；有大文件 Babel 提示，不称零警告 |
| 受保护基线 | `regression-178e68a6/protected.log` | 38 个功能标识保留、0 警告 |
| Next 构建 | `regression-178e68a6/build.log` | 完成构建并检查 243 traces；不是可发布构建身份证据 |
| 严格构建追踪 | `regression-178e68a6/nft.log` | 231 路由、546932 文件引用、80 条宽追踪；未通过 |
| Chromium | `run-f0073453/test.log` | 协作 E2E 1/1 通过，1.8 分钟 |
| Firefox | `run-68a38a61/test.log` | 同规格 1/1 通过，1.5 分钟 |
| WebKit | `run-f36c5db5/test.log` | 同规格 1/1 通过，2.2 分钟 |

原始进程句柄已不存在，因此此处没有从消失的句柄补造退出码；使用保存的各命令日志结果。2026-09-27 复核专用 PostgreSQL 已停止，5109/55492 无监听。

### 浏览器规格覆盖范围

`tests/e2e/yjs-canvas-collaboration.spec.ts` 使用独立 localhost 应用、每次新建的临时 PostgreSQL 数据库与测试用户。已覆盖 owner 和明确授权 editor、项目不复制进编辑者个人列表、原节点工作流保留、图片移动与局部撤销、队列写盘失败回滚、刷新恢复、完整分组及结构化标注、远端删除交错、断线编辑拒绝、320/375/393px 状态与恢复控件可达。

上述历史浏览器日志中的跨页面恢复用例重放的是已捕获的合法持久队列记录，只验证刷新后隔离、导出及明确重试入口可见；不把按钮可见当作已经执行了按钮后的真实重试。

### 2026-09-27 新鲜审计及补验

- 聚焦客户端/桥/旧画布回归：7 文件、74 测试通过，exit 0。`pnpm validate` 本轮退出 0；有既有大文件 Babel 提示。
- 严格 NFT 重新运行 exit 1：231 路由、546932 引用、80 宽、23 含配置、24 含根文档。
- 独立验收复核发现 2 个 Important：已连接页面权限撤销/用户或功能禁用后，客户端没有完整销毁 Y.Doc/UndoManager；原测试没有从相同状态发起同一 placement 的真正并发变换。另有 1 个 Minor：恢复浏览器用例缺少实际发送帧、下载内容和显式重试后的证据。因此 Task 7 继续开放，而不是按历史绿灯关闭。
- 新 E2E 已加入双页面拦住本地更新帧、各自拖动同一素材后反序经 native socket 放行，并比较完整服务端 placement 与两页位置；恢复用例新增零自动发送、下载 JSON 内容、点击重试、服务器确认后清队列。**开发运行已开始，但整案未通过；旧日志不覆盖新规格。**
- 权限失效修复有效 RED：hook 6 项、session 1 项以真实 `Y.Doc.isDestroyed === false` 失败；修复后客户端/组件聚焦 76 项通过，类型及定向 ESLint 通过。永久权限错误终止 socket、Y.Doc、UndoManager 和重试；持久未确认帧不删除，内存保留普通恢复副本供下载，不能继续编辑或重试。
- 新建 localhost 库的 `review-87ad73c6/focused.log`：6 文件、86 测试通过、exit 0，包含真实 WebSocket 同一 placement 的两种发送顺序和数据库完整投影/重建一致性。专用 PostgreSQL 正常停止。此前的 7517 全量结果仍是修复前的证据，不能当作本次补丁全量通过。
- 新浏览器规格开发运行 `run-71806742`：并发段走过，离线分组改名点击被图片工具栏挡住；按截图改为先 Esc 退出选中状态。`run-d3139211`：小图片在编辑者端未产生拖动帧，严格 held 断言失败；改为另一图片，并加强双方起点一致、各自实际移动、两端待发送队列非空断言。文件元数据后来核实 `tiny-test.png` 为 **2×2**，此前“一像素”描述不准确。两次整案均失败，日志保留；不能引用局部通过来关闭浏览器矩阵。
- `run-b7c17ac9` 三浏览器整案均失败：并发段后分组选择被图片工具栏挡住。随后仅修改测试项目的启用前种子摆放为两个相隔的 100×100 图片，保留真实上传和正常同步 API，并在选择前明确检查 Esc 后工具栏消失。`run-688f6533` 最终 3 failed、exit 1：Chromium 在该检查失败（工具栏仍有 1 个），Firefox 后续分组标题被 `image-hover-toolbar` 遮挡，WebKit 初始拖拽位置未变化；专用应用与 PostgreSQL 已停止。统一调查真实焦点、可命中区域、快捷键和截图/Trace，不以逐例强制点击绕过。恢复下载与明确重试仍无该新规格的整案通过证据。
- 最新独立 `pnpm validate` 进程 30124 结束，exit 0；不能代替修复后的全量 Vitest。
- 交互前置补丁仅改 E2E：Trace 证明 WebKit 的拖动起点为视口外 `(-30,98)`；Firefox 未选中图片的 hover 工具栏与标题重叠。新增真实收起面板/重置视图、可命中位置和键盘焦点前置，保持单次 Esc、并发与恢复断言；移除原有远端标注删除的 DOM click，改用正常用户点击。Chromium 失败页为第三张截图，原第一张是辅助页；现有 trace 不能唯一证明其 Esc 失败根因，不据此改产品。定向 ESLint、非增量 TypeScript 检查 exit 0。`run-a358a66f` / 8664 正在复跑三浏览器，仍无新整案通过结论。
- `run-a358a66f` 最终 3 failed、exit 1，专用 app/PG 已停止。Chromium 与 WebKit 已走到恢复下载，但 `下载未同步副本` 被右侧面板的收起把手拦截；源码项目菜单按全屏居中、状态和按钮不换行、与后出现右面板同为 z70，构成真实恢复控件可达性缺陷，不能以收起面板掩盖。Firefox 在另一端正常点击标注删除后未得到服务端删除墓碑，仍调查事件/焦点边界。此前三浏览器交互前置补丁的静态复审通过不代表这两个后续问题关闭。下一修复限定状态布局及已有 E2E，不更改文档协议、数据库或账务。
- 恢复布局补丁：桌面菜单避开右面板，窄屏根据菜单实际高度为展开面板留出顶部；提示/按钮在具名 group 内换行，不改变导出/重试语义、不提高 z-index。组件测试有效 RED 为缺少语义分组，GREEN 为 6/6；定向 ESLint 与非增量 tsc exit 0，workspace 六条既有 warnings 未增加。**组件通过不能证明真实布局通过**。新增 E2E 覆盖 1280/320/375/393 × 展开/折叠的边界、中心命中、真实下载与最后明确重试；Firefox只增加原生输入事件附件和本地删除断言。`run-0da6c2cf` / 32966 正在复验，限定复审仍待结果。
- 恢复布局限定复审已返回：spec符合、静态quality未见新增Critical/Important，真实几何仍待矩阵。主代理追加相关回归：`mobile-workspace-panel`、`mobile-canvas-css-contract`、`presence-indicator`、`document-status`、`workspace-panel-layout` 共 5 文件/19 项通过，exit 0；其中既有源码合同测试只证明对应静态约束，不扩大为移动布局实测通过。
- `run-0da6c2cf` / 32966 最终 **2 passed / 1 failed，4.4 分钟，exit 1**。Chromium、WebKit 完整通过同素材并发、恢复 JSON 实际下载、四宽度×面板展开/折叠命中及窄屏展开状态明确重试；恢复UI有这两个浏览器的真实GREEN。Firefox在新增本地删除边界失败：第二页面自己的“区域1”未消失，不能直接归因于文档传播；原生输入观测已附于该失败trace，继续只分析该路径。专用app/PG正常停止；产品布局补丁暂冻结，不重复两个已通过浏览器来替代Firefox证据。
- Firefox 的 `annotation-remove-native-input` 小附件已定位输入边界：owner 收到第二组 pointerdown/up/click 并提前完成手势，editor 事件数组为空，没有目标 removeId；不能把未到达按钮的输入认定为Yjs同步缺陷。仅在 E2E 显式激活目标页，并增加 editor 目标 trusted click 与 owner 草稿始终未完成的断言；不提前 mouse.up、不合成事件，产品哈希不变。限定复审 spec/quality 静态通过。`run-1eee27ab` / 96935 单跑 Firefox 中；前两个浏览器的旧记录不覆盖这些新增输入断言。
- `run-1eee27ab` / 96935 已结束，Firefox 1 failed、exit 1：显式 bringToFront 后 editor 的事件数组仍为空，目标 trusted click 断言失败，app/PG已停止。仅切换焦点的假设未通过，不继续堆焦点动作；下一步用无应用/无数据库的最小 Firefox 指针捕获探针对比同进程 context 和独立进程，确定测试输入隔离方式。产品实现保持冻结。
- 独立限定复审确认权限终止资源清理、迟到响应围栏、普通数据恢复副本符合要求，无新 Critical/Important；并发 E2E 静态复核也确认不能把单端移动算成并发。完整浏览器矩阵及补丁后全量回归仍待实际结果。

### 失败记录不抹除

- 2026-09-27 Firefox 输入隔离证据：`probe-firefox-input-2026-09-27T00-01-27-908Z/summary.json` 显示同进程双 context 无法把可信点击交给 editor，且 owner 草稿提前结束；独立进程六项断言全部通过。该探针没有应用、数据库或外部网络，仅证明此本机自动化输入边界，不扩大为 Firefox 产品普遍缺陷。
- 仅 E2E 为 Firefox 创建独立 editor 浏览器进程并在嵌套 finally 中清理；保留目标 trusted click、owner 草稿保持、远端删除墓碑、刷新恢复和下载/重试断言，无强制点击、DOM click 或提前释放手势。Gauss 限定复审 spec/quality 通过，无新增 Critical/Important。
- 主代理取得 `run-23019efb` / 5562 终态：Firefox **1 passed，1.8 分钟，exit 0**；应用与专用 PostgreSQL 正常停止。旧 Chromium/WebKit 日志不声称覆盖后加输入断言，因此正在对最终 E2E 规格补验两浏览器（6583）；随后才运行最终补丁完整回归。
- `run-ceba9540` / 6583 已终态：Chromium/WebKit **2 passed，3.7 分钟，exit 0**，app/PG 正常停止。以上三浏览器均覆盖新增可信输入与草稿保持断言；仍不把不同素材顺序段称为真实并发，后续补齐该项后才进行最终回归。
- 不同素材并发覆盖已补齐：双端先核对相同服务端起点并 hold 更新，真实拖动后要求本端改变、对端所见未变、双方未保存、服务器两份完整 placement 未变；随后 native flush，核对两份修改同时存在于双方及服务器。原 Ctrl+Z、刷新和 capturedPending 恢复链保持。定向 ESLint/非增量 tsc exit 0；Gauss 限定复审 spec/quality 通过，无新增 Critical/Important。此为补验收缺口，不伪造产品 RED。
- 最终规格三浏览器 `run-6db7f863` / 16370 已取得终态：**3 passed，4.6 分钟，exit 0**；覆盖不同素材因果并发、同素材冲突、localUndo、分组/标注远端删除、可信输入交错、恢复 JSON 下载/明确重试及四尺寸×面板状态矩阵。专用 app/PG 正常停止。随后启动新隔离库完整回归，不得引用旧 7517 项结果作为最终补丁通过。
- 最终补丁回归 `regression-15d16ba1` / 58447：迁移、核心建表 exit 0；聚焦 **6 文件/93 项通过，19.40 秒，exit 0**。完整 Vitest 正在运行，后续 validate/protected/build/strict NFT 尚待执行；最终退出码由 `exit-codes.json` 留存。观察同一句柄，不重启，不把聚焦结果扩大为全量通过。
- 该轮完整 Vitest 已返回 **exit 1**，耗时 **1192.79 秒**：共 875 文件/7532 项，874 文件/7531 项通过；唯一失败为 `src/__tests__/lib/psd-export-layer-decomposition.test.ts:286` 的 `does not let a late older generation erase a newer accepted task`，15000ms timeout。PSD 测试与 `psd-export.ts` 没有本轮工作树差异；这不证明是环境问题或排除产品缺陷。原实现者已恢复并只读调查异步顺序，禁止在现有流水线终态前修改源码、放宽超时或启动第二轮。
- `regression-15d16ba1` / 58447 已全部结束、整体 exit 1；`exit-codes.json` 核实 migrate/core/focused/validate/protected/build 均为 0，full/nft 为 1。保护基线 38/38、0 警告；构建 121/121 静态页、243 traces。严格 NFT 为 **231 路由、556069 引用、80 宽、23 含配置、24 含根文档**；BUILD_ID 为 `unverified-430ff5da325ed07ee6b85553954f974e`。`nft.log` 混合输出中有独立 stderr 行 `API route traces include unexpected project files`，原始日志保留，计数只在内存中分离该行解析，不把失败改成通过。专用 PG 正常停止，两个布局产品文件哈希保持冻结值。
- 流水线终态后仅授权 PSD 原失败项及有界异步顺序探针，先验证根因，不放宽 15000ms 限制、不改产品、不启动第二次全量；Task 7 尚不可关闭。
- PSD 原版单项单独运行通过（65ms），不能抵消完整回归失败。随后用真实 SHA256、仅控制返回时序的反序探针复现测试自锁：第二顶层请求先进入第一 mock，释放第一 deferred 后测试却等待仍被第二 deferred 阻塞的第一顶层请求。按实际完成身份继续的对照在相同调度下通过新任务持久化、迟到旧请求保护与模块重载恢复断言。原 full 未记录阶段时序，故只证明可重复的自锁机制，不声称追溯到那一次历史执行的确切调度。诊断日志在 `psd-generation-diagnosis-20260927/`；现仅授权正式测试身份绑定最小修正、限定验证及独立复审，产品和浏览器规格冻结。
- 正式修正使用仅成功映射标签的 `.then` 和 `Promise.race` 识别完成者，另一个请求作为迟到旧代；保持两请求先在途、原持久化/迟到保护/重载全部断言和15000ms上限，不吞拒绝。强制真实摘要反序的临时探针直接取当前正式case：1/1（70ms），原PSD全文件15/15，定向ESLint/非增量tsc报告exit0。日志为 `wait-fix-forced-order.log`、`wait-fix-psd-file.log` 等；探针源码留档且测试目录临时文件已精确删除。独立限定复审确认自锁finding已解决、spec/quality通过，无新增Critical/Important/Minor。此次未改PSD产品/Yjs/E2E，旧三浏览器结果仍对应当前产品与浏览器规格；全量候选验证由新 `regression-05562230` 负责，未终态前不称通过。

- `regression-affbd946` 首轮全量有 5 个失败：旧源文本断言与测试动态执行缺少新 helper 绑定。只修正相关测试后，第二轮完整回归获得上表结果；不能把首轮写为通过。
- Chromium `run-de07e2d0` 曾在应用请求阶段出现 `ECONNRESET`。未改变源码的后续运行通过，但尚无足以证明该次连接重置根因的证据。

## 发布前仍开放

### Task 7 逐项覆盖审计（2026-09-27，本地关闭）

| 既定要求 | 已检查的实际断言 | 尚缺边界 |
| --- | --- | --- |
| 不同素材独立并发合并 | `canvas-document.test.ts` 两个真实 Y.Doc 独立修改后反序/重复合并；E2E 已补双页面 outgoing hold、双方本地修改存在且对方/服务端未变再放行，服务端及双页面保留两份完整修改；最终三浏览器3/3 | 本地该项已验证；不能代替云端验收 |
| 同素材原子变换收敛 | client 测试比较完整六字段变换；真 PG/WebSocket 两种发送次序及重建投影；E2E 两端 held 后 native flush 并核对服务端完整 placement；最终三浏览器3/3及完整7532项通过 | 本地该项已验证；云端仍未验证 |
| 远端不回声、本地撤销不覆盖他人 | client `send` 次数断言、same-placement newer-remote undo；E2E Ctrl+Z 保留 editor 第二张图片的修改及刷新；最终三浏览器3/3及完整7532项通过 | 本地该项已验证；云端仍未验证 |
| 切项目、登出、权限失效释放资源 | hook 已连接 logout/switch-project 断言真实 Y.Doc destroyed、UndoManager destroy、旧 socket handler 清理；401/403/明确禁用503、1008及迟到响应围栏；最终完整回归通过 | 不冒充云端权限实测 |
| 未确认状态与跨页面恢复 | saved 必须匹配 ACK；持久写入失败不推进画布；拒绝标记/删除失败不丢副本；新页面零自动发送；下载 JSON 后明确重试与清队列；最终三浏览器3/3及完整7532项通过 | 本地该项已验证；云端仍未验证 |
| 完整分组/标注、远端删除不复活 | client/bridge 的 ID 映射与墓碑；浏览器真实交错草稿与 editor 删除、可信点击及服务端删除确认；最终三浏览器3/3 | 本地该项已验证；不能代替云端验收 |
| 旧项目和既有功能不回退 | 非协作仍走原 scheduler，未知/坏投影禁止旧写；延迟项目加载不覆盖新选择；E2E 原节点工作流保留；最终完整7532项回归通过 | 新协作媒体接入属于Task8；全量不等于云端全部工具端到端实测 |
| 窄屏恢复可达性 | 1280/320/375/393 × 面板展开/折叠的边界、命中、真实下载，最后窄屏展开状态明确重试；最终三浏览器3/3 | 实体触屏仍按总目标延期；不把模拟尺寸当真机验收 |

1. Task7仅本地关闭；完整协作阶段仍须证明用户可达的启用/邀请入口，不能以E2E直接预置权限代替。
2. Task 8 项目媒体命令、跨工作区投影及真实并发/账务隔离。
3. Task 9 完整集成回归和独立复审。
4. 全站严格 NFT、精确源码/构建身份、Coze 同源 `101`、双实例与重启、实际 CI、发布候选真实取消及唯一退款。
5. 总目标的草图转代码、Pear、实体设备等独立未验收项。Lovart 已关闭功能不因本次协作验证重新列为开发任务；明确延期的证据仍保留。

本记录不修改 `stable`，也不把只读分享或历史 Skill 阶段重新打开。
