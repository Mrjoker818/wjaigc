# 无界AI — 发布就绪报告 (RELEASE READINESS REPORT)

## 2026-09-01 PROVIDER-003 后台结算候选

总体结论保持**不通过**。`V588-PROVIDER-003-BUG-010` 的品牌电商和字境后台任务已完成本地持久化幂等、条件式终态、一次退款、重启孤儿任务结算、精确结果身份与凭据不落盘修复；独立复审提出的六项边界均已补充 RED 合同并关闭。最终全仓 `595` 个文件、`4488` 项、TypeScript、零错误 Lint 和 `118/118` 生产构建均通过。

发布阻断尚未解除：`133` 项隔离 PostgreSQL 测试因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过，Coze 尚未取得真实并发重放、一次扣费/退款、取消/超时、迟到完成拒绝、进程重启恢复和 Google Chrome 证据。当前只允许作为 `main` 候选继续云端验收，不得合并到或修改 `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`，也不得宣布 `V588-PROVIDER-003` 或平台发布通过。

## 2026-09-01 PROVIDER-003 精确路由候选

总体结论保持**不通过**。`main@14b058fc` 已在本地关闭品牌、精修、字境显式供应商跨路由问题，并通过 4466 项全仓测试、TypeScript、零错误 Lint、118/118 构建和干净保护基线 38/38；`stable@52f7c601` 未触碰。

发布仍被真库与云端证据阻断：品牌和字境后台任务已完成本地数据库任务级原子终态/一次退款修复，但 133 项隔离 PostgreSQL 测试未执行。Coze 尚无本候选的真实 Chrome、Pear/APImart、计费、结果入画布或 Console 证据。不得把本地路由回归扩大为 `V588-PROVIDER-003` 或全平台可发布。

## 2026-09-01 品牌辅助失败提示候选

总体结论保持**不通过**。`main@1e58c84e` 已在本地修复品牌 AI 辅助 HTTP/业务失败被静默吞掉的问题，证据已随 `origin/main@2ff2ce4a` 推送，并通过 `4459` 项全仓测试、TypeScript、零错误 Lint、`118/118` 构建及干净保护 `38/38`。但 133 项真实 PostgreSQL 专项仍因无隔离库跳过；云端先整体 502，推送后三类确认请求、根页和认证端点又统一为 `404 instance_not_found`，请求未到应用或供应商。候选尚未取得 Coze 拉取/重启后的 Google Chrome 三类真实辅助内容、可见失败提示与 Console 证据。`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持未触碰。

## 2026-09-01 品牌辅助端点候选

结论保持**不通过**。BUG-005 的 `providerId + modelId` 云端请求配对已经取得正向证据，但 BUG-007 使三个辅助请求在上游图像端点失败。本地最小修复和全部静态/测试/构建门禁已通过；只有 Coze 精确拉取候选并由 Google Chrome 证明三个请求走 `/chat/completions` 且返回真实内容后，才可关闭该子项。133 项隔离 PostgreSQL 测试仍明确未验证，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。

## 2026-09-01 品牌辅助精确配对候选

`V588-PROVIDER-003-BUG-005` 的前端最小修复已通过专项 `13/13`、品牌回归 `68/68`、第二次全仓 `4457` 项、TypeScript、零错误 Lint、生产构建 `118/118` 和干净保护 `38/38`。首次全仓的单个 PSD 竞态用例曾发生一次 5 秒超时，随后单项、完整文件三连跑和第二次全仓均通过，该失败已保留在回归记录中。这只证明本地请求边界和回归不破坏既有功能；Coze exact-SHA、Google Chrome 真实三请求网络体、辅助响应与刷新恢复仍未完成，因此本项尚未云端关闭，整体发布结论保持**不通过**。

## 2026-09-01 最新判定

总体结论仍为：**不通过**。精修浮窗和单次取消链路已在 `main@62566121` 的正确 Coze 云端与 Google Chrome 中闭环：按钮完整可见，数据库终态为 `cancelled`，12 积分一扣一退，取消后超过 90 秒没有迟到结果覆盖或入画布。

该通过项不等于全平台通过。完整 V5.8.8 选择性吸收、其余业务工具矩阵、真实 PostgreSQL 并发门禁、Firefox/WebKit、完整录像/Trace 以及既有管理员/支付/媒体任务缺口仍开放。继续按吸收清单推进，不再重复精修浮窗或本次取消测试。证据：[v588-refine-cancel-62566121-cloud-20260901.json](evidence/v588-refine-cancel-62566121-cloud-20260901.json)。

## 最新整体发布结论：不通过（云端验收未完成）

## 2026-09-01 精修浮窗异步增高候选

结论仍为**不通过**。`dc701c57` 云端实际面板在异步内容加载后高 `903px`、底边 `979px`，超过 `935px` 视口；开始按钮中心在视口外，点击未命中，未发送精修 POST，也未产生任务或扣费。本地已新增 RED→GREEN 回归并以 `ResizeObserver` 最小修复，精修专项 `53/53`、全仓 `4452` 项、类型、零错误 Lint 和 `118/118` 构建通过。仍需完成干净保护门禁、推送、Coze exact-SHA 部署和真实 Chrome 的可见按钮、单次取消、数据库 `cancelled`、单次退款及迟到结果隔离，才可关闭本项。

## 2026-09-01 方案A前端取消候选判断

本地源码与永久回归已完成：精修取消/终态/视口专项52/52，全仓4451通过、0失败、133项隔离PostgreSQL测试明确跳过；TypeScript与零错误Lint通过，8GB Node堆下生产构建118/118页面成功。默认4GB构建OOM是已记录的工程资源门槛，不是业务编译错误。

**当前结论仍为有条件通过。** 候选可推送`main`进入Coze验收，但真实取消必须同时证明唯一取消请求、权威`cancelled`终态、最多一次退款和迟到完成拒绝；浮窗需在现有Chrome预览标签验证底部按钮完整可见、拖动/缩放不越界。上述证据完成前不关闭V588-TOOLS-BUG-003/004，不触碰`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`。

**09:39取消验收更新：** 真实Chrome仅提交一次精修，但Coze预览代理在应用任务创建前返回HTTP 500 `no sandbox ID found for taskID`；无应用taskId、无取消按钮、无取消请求，因此取消/一次退款仍未验证。前端把该错误切换为空结果页且不显示可理解提示，新增P2错误呈现失败。项目页刷新后沙箱启动，预览页强刷稳定出现`ERR_BLOCKED_BY_CLIENT`。本次不改变方案A正向通过结论，也不提供失败/取消账务通过证据；整体发布继续不通过。证据：`evidence/refine-cancel-cloud-20260901.json`。

**08:25覆盖更新：** 方案A新版精修正向链路已完成真实数据库和下载闭环：新任务`completed/100`、charged 12、远端ID/扣费事务精确关联、退款0、余额4794；1254×1254 PNG实际落盘且哈希/字节已核验，Console 0错误/警告。正向项不再列为未验证。但失败/取消/超时真实退款和竞争、远端原始响应、完整录像Trace及其他工具仍未完成；精修浮窗越界P2未修复，静态JS500时序根因未定。因此完整发布结论仍不通过。只更新证据，无业务代码变更，不触碰stable、不要求Coze为文档重建。详见[最新断点](REFINE_DURABLE_FIX_2026-09-01.md)。

**2026-09-01方案A实施覆盖下方历史：** 精修持久化/原子结算接入及旧面板响应兼容已修复，53项专项、12项真实PostgreSQL及本地4569全量通过。Coze候选源码树与main一致，53专项/38保护/构建启动回执已读，Chrome实际恢复登录和4806余额。但平台交付后重载出现JS 500，随后控制断开，未提交新精修；不能将同步完成当作真实业务验收通过。历史12积分未补偿，出图/保存恢复/真实账务仍未闭环，不向stable发布。详见[实施报告](REFINE_DURABLE_FIX_2026-09-01.md)，全工具矩阵不缩减。

**2026-09-01补充：** 精修已有永久RED回归，6项3通过3失败、0跳过，缺行导致TaskNotFoundError及creditCost未挂接已在原路由/原任务服务隔离执行中复现。仅测试新增，生产源码不变；新增业务修复边界待确认。此前4546通过不覆盖这6项新增测试，不作为当前全绿证明。禁止吸收V5.8.8不等待持久化的旧完成逻辑；见[专项诊断](REFINE_ASYNC_TERMINAL_DIAGNOSIS_2026-08-31.md)。

**23:48最新覆盖：** main@3daa1043已同步到正确Coze，构建/重启回执及Chrome强刷已取得，不是仍待拉取。真实7项预检拒绝无新增扣费，品牌2图/保存刷新和提示词优化成功。精修新增V588-TOOLS-BUG-002：有效任务返回“任务终态已变更”而未交付结果，真实扣12积分待核对，不能关闭P0候选账务风险。只读诊断已发送，禁止重复生成、改账或削弱终态门禁。字境/放大正向与五接口失败退款未全部验证；全平台不建议发布。见[云端验收](TOOL_MINIMAL_CLOUD_2026-08-31.md)。本次仅文档更新，main源码及stable不变，不为文档重建Coze。

**最新代码进展（覆盖下方历史未修复描述）：** 已按批准边界修复5原路由预检/同步补偿和节点倍率契约，新增76项永久用例。全仓612文件4546/4546通过、0跳过，类型/118页构建/38类保护通过，Lint 0错误/956历史警告。只允许作为main候选进入云端验收，不能宣布全平台可发布。后台异步终态、全局账务及正确Chrome云端验证尚未关闭；精确门禁和限制见[本轮实施记录](TOOL_MINIMAL_FIX_2026-08-31.md)。stable、认证、UI、供应商策略均未改，云端必须拉取此次代码提交才包含本修复。

**跨工具增量：** BUG-006新增放大与提示词优化两原路由的隔离失败证据，新增P1节点倍率类型冲突V588-TOOLS-BUG-001；仍未修复。两版最终36项12通过24失败不是24个Bug，不是真实账务验收。V5.8.8目标路由仅换行不同，没有可直接复制的修复；见[跨工具审计](TOOL_PREFLIGHT_AUDIT_2026-08-31.md)。不变更此前真实通过项、不为本轮文档重新部署。

**覆盖范围校正：** 最近品牌/精修/字境是PROVIDER-003专项，不是全站已验收。最新[全工具矩阵](TOOL_COVERAGE_MATRIX_2026-08-31.md)补齐19个底部工具、23个媒体动作及节点/聊天/管理系统范围。保留历史专项通过，完整链路仍有缺口；OBS-008/009仅静态风险候选，不冒充已确认云端扣费Bug。本轮仅更新资料，不需要Coze重新构建。

**新增发布阻断：** BUG-006在品牌/精修/字境原路由中隔离复现“扣费SQL后预校验直接返回400，无退款”。当前5个场景、donor4个同类场景，不代表线上已有错误账单，但在修复及隔离PostgreSQL/云端验收前不能发布通过。donor空输入提前校验只可选择性借鉴，直接复制会引入500错误。报告`V588_PROVIDER_003_PREFLIGHT_AUDIT.md`。本轮无生产改动、真实任务或扣费；已通过前端回归不回退。

**21:53更新：** Chrome已恢复，品牌4项已部署前端异常注入均结束等待，BUG-002/003限定前端有条件通过；不是实际后端拒绝、供应商超时或退款通过。原5图和4880积分/3条流水保持，拦截清除并强刷。OBS-007英文网络错误提示保留；BUG-005及精修/字境/账务缺口不变，整项与全平台仍不通过。证据`evidence/v588-provider-003-brand-negative-20260831.json`；无业务源码修改/新增部署，不用旧门禁掩盖未验项。

**21:41证据补充：** 品牌辅助LLM配对BUG-005已本地源码级稳定复现，尚未修复；字境、精修和品牌选择器的显式选择回退也在隔离执行中重现。只读V5.8.8同样失败，不是可以直接复制的修复来源。14项探针12失败/2对照通过，不能被旧4470项全量绿灯掩盖；未访问上游/数据库，不扩大为真实越权或扣费结论。浏览器接管失败不记为程序故障，既有BUG-004通过保留，整体仍不通过。

**当前覆盖（2026-08-31 21:28）：** fac43cbf包含源码9b2e8d5f，已在正确Coze同步并重启，tree/src tree匹配；Build ID D12Ets9rxSINh8SeuecwS。Google Chrome原预览强刷后，一次APImart品牌任务47秒产生两图，每结果来源、改选Pear后入画布、服务端保存5图及再次强刷恢复通过，BUG-004已关闭。单次-60、余额4880已只读核实，不等同于并发/退款通过。BUG-002/003新版云端负向验收、PROVIDER-003其余入口和全平台既有缺口仍在，发布结论不通过。24份原件哈希见`evidence/v588-provider-003-brand-cloud-20260831.json`；3条平台脚本加载失败、13条Coze报告的本地依赖启动error、积分日期NaN、录像/Trace缺失均保留。既有本地4470/4470门禁不重跑，认证/账务/stable/donor不变。下方“同步未发送/三个Bug未修复”为历史，不覆盖本段。

**20:20当前：** 普通用户登录、APImart品牌两张真实结果、逐次返回、服务端保存/强刷恢复与单次60积分已验证；新发现结果供应商标签误标AILINK（BUG-004），与旧BUG-002/003均未修复。Pear结果、精修/字境、上游身份及并发/退款仍缺证，整项不通过。17份原件哈希见 `evidence/v588-provider-003-funded-apimart-20260831.json`。密码仅交付对话，不入仓库；不再等待登录/充值，不重复部署。下方20:03状态为历史。

**20:03当前增量：PROVIDER-003仍不通过，充值不足前置条件已解除。** 正确Chrome原预览可控制，管理员只读核实测试账号余额5,000及19:32充值+5,000完成；未重复加分，退出管理员后待测试账号登录。没有新增供应商结果，不改变18:10的5次402、重试2/2假加载/error模板及截断JSON失败结论。BUG-002/003未修复，结果入画布/保存刷新/账务、精修/字境和完整录像/Trace仍缺。候选98b6505d及既有门禁不重跑，不为文档重建，不改stable。见 `V588_PROVIDER_003_ACCEPTANCE.md` 和 `evidence/v588-provider-003-credit-confirmed-20260831.json`。

**最新增量：PROVIDER-002专项通过并完成吸收，BUG-006已云端关闭；全平台发布结论仍为不通过。** 10bcc899在正确Coze完成54/54专项、38/38保护、118/118构建及单一服务重启。Google Chrome原标签真实验证普通用户会话、23/4精确目录、Pear/APImart保存刷新、临时选择不持久化、6条消息不变及画布/节点重启恢复。最后15个应用资源200，Console错误/警告、异常及原生弹窗0；3条Coze注入脚本CSP拦截另列。未重复本地4438项门禁或修改业务代码。证据为`docs/testing/evidence/v588-provider-002-selection-cloud-20260831.json`。没有付费任务或认证配置改动，stable不动。完整录像/Trace及其他既有未关闭项继续保留；下方旧“普通用户未登录、节点/BUG-006未验”均为历史，不覆盖本结论。

`V588-PROVIDER-002-BUG-004` 已于2026-08-31 11:19在正确Google Chrome原标签通过云端验收并关闭。`865f61b7` 的四类通知、失败勾选保持、持久化复读、恢复不限和强刷后管理员会话均有真实证据；20个应用静态资源200，Runtime异常/原生弹窗0，3条Coze注入脚本CSP拦截单独保留。源码 `da6c036c` 的本地4414/4414、保护38/38及118/118构建证据不重复运行。本轮没有业务源码变更。

**仍不能批准全平台发布：** 普通用户三个工作区目录、刷新/重启保持未取得真实登录验收，录像/Trace未生成，其他未关闭项继续保留。只关闭通知缺陷，不关闭整个PROVIDER-002，不重开Stage 4，不触碰stable。云端脱敏证据：`docs/testing/evidence/v588-provider-002-toast-cloud-20260831.json`。以下10:25及更早内容为历史快照。

## 当前增量结论：有条件通过（2026-08-31）

10:25 补充：PROVIDER-002 管理员唯一裸键迁移、歧义/无效拒绝、拒绝后原值保持与零成功审计已取得真实云端证据，测试用户已恢复原“不限”。普通用户三工作区、刷新/重启、管理员反馈及本轮完整浏览器健康仍未验，录像/Trace 未生成；不能据此关闭整个 PROVIDER-002 或批准全平台发布。本轮没有业务源码修改，已有本地全量结果不重跑。见 `docs/testing/evidence/v588-provider-002-admin-cloud-20260831.json`。

仅指本次吸收增量，不是全平台发布批准：606 个 Vitest 文件、4413 项测试全部通过且 0 跳过；真实 PostgreSQL 双结构、并发及管理员只读投影取得证据。云端 `main@f91ada6b` 已构建重启，ADMIN-004 的四管理页、逐用户字段、两次强刷和浏览器健康验收通过。没有修改登录流程、权限语义、供应商配置或账务。

源码候选 `bd9655b88ec037a0ebb6891addaba19a8280240f` 已包含在云端候选中；生产构建 118/118 与保护基线 38/38 通过，云端原始 Vitest 为 4281 通过、132 隔离 PostgreSQL 环境跳过、0 失败。剩余普通用户目录仍需真实登录验证；新增 P2 `V588-CREDITS-OBS-001` 分类占比 137% 已登记未修复，不能将统计页面整体标通过。Pear 按用户决定延期。不得据此更新 `stable` 或宣布全站全部功能通过。

权威记录：`docs/testing/evidence/v588-admin-provider-postgres-20260831.json` 与 `docs/testing/evidence/v588-f91ada6b-coze-sync-20260831.json`。以下旧日期结论均为当时快照。

> [!IMPORTANT]
> **2026-08-08 最新状态覆盖：当前整体发布结论为“不通过”。**
> 本文件下方 2026-07-20 的“100% 通过、可投入生产”仅是历史快照，不能覆盖后续已登记的未闭环缺陷、5 个基线测试失败、4 个 ESLint 错误、PostgreSQL 并发/账务阻塞和云端运行 SHA 未确认。
> 最新 Stage 0 证据见 `docs/testing/STAGE_0_COMPLETION_REPORT.md` 与 `docs/testing/UNVERIFIED_ITEMS_STAGE_0.md`。

> 生成时间：2026-07-20
> 版本：v3.8.0
> 测试周期：全平台真实用户测试、缺陷扫描与统一修复

---

## 执行摘要

无界AI平台经过 13 阶段全平台测试，累计执行 **121 项测试用例（119 项执行）**，覆盖功能盘点（103项功能矩阵）、健康检查（36项）、E2E 跨浏览器测试（Chromium/Firefox/WebKit）、API 核心接口测试、异常混沌测试、OWASP 安全测试和静态代码扫描。发现并修复 **6 个缺陷**（1个P0 + 2个P1 + 3个P2），**100% 修复率**，**100% 测试通过率**。

**发布建议：✅ 准备就绪，可投入生产环境发布。**

---

## 测试覆盖矩阵

| 阶段 | 测试类型 | 用例数 | 通过 | 失败 | 状态 |
|------|---------|--------|------|------|------|
| 1 | 功能盘点 (FUNCTION_INVENTORY) | 103 | 103 | 0 | ✅ 完成 |
| 2 | 测试基础设施 | — | — | — | ✅ 完成 |
| 3 | 健康检查 (doctor) | 36 | 31 | 0 | ✅ 完成 (5项环境警告) |
| 4 | 静态代码扫描 | 2 | 2 | 0 | ✅ 完成 |
| 5 | API 核心接口测试 | 46 | 46 | 0 | ✅ 完成 |
| 6 | E2E 跨浏览器测试 (P0) | 9 | 9 | 0 | ✅ 完成 |
| 6+ | E2E 补充测试 (Flow B/D/E) | 12 | 12 | 0 | ✅ 完成 |
| 7 | 异常和混沌测试 | 21 | 21 | 0 | ✅ 完成 |
| 8 | OWASP 安全测试 | 31 | 31 | 0 | ✅ 完成 |
| 11 | CI 质量门禁 (GitHub Actions) | — | — | — | ✅ 已配置 |
| 12 | 可观测性 (requestId + 错误监控) | — | — | — | ✅ 已实现 |
| **合计** | — | **121** | **119** | **0** | **✅ 全通过** |

---

## 缺陷修复统计

| 级别 | 发现 | 修复 | 修复率 | 阻断发布 |
|------|------|------|--------|---------|
| P0 (阻断) | 1 | 1 | 100% | 否 |
| P1 (严重) | 2 | 2 | 100% | 否 |
| P2 (一般) | 3 | 3 | 100% | 否 |
| P3 (轻微) | 0 | 0 | — | 否 |
| **合计** | **6** | **6** | **100%** | **否** |

### 关键修复

1. **BUG-001 (P0)**: WebKit 安全 Cookie 导致 401 — 修复 `login/route.ts` 和 `logout/route.ts` 中 localhost 的 `secure` 标志
2. **BUG-002 (P1)**: WebKit selectOption 不触发 React onChange — 添加 dispatchEvent 后备
3. **BUG-003 (P1)**: 模型选择存储路径不一致 — 修正 E2E 测试 localStorage key

---

## 跨浏览器兼容性

| 浏览器 | E2E 测试 | 通过率 | 备注 |
|--------|---------|--------|------|
| Chromium | 3/3 | 100% | 基准浏览器 |
| Firefox | 3/3 | 100% | 无兼容性问题 |
| WebKit | 3/3 | 100% | 修复1个P0 + 2个P1后通过 |

---

## 安全评估

| OWASP 类别 | 测试项 | 通过率 | 风险等级 |
|-----------|--------|--------|---------|
| A01 访问控制 | 8 | 100% | 低 |
| A02 加密机制 | 3 | 100% | 低 |
| A03 注入 | 5 | 100% | 低 |
| A05 安全配置 | 4 | 100% | 低 |
| A07 身份认证 | 5 | 100% | 低 |
| A08 数据完整性 | 2 | 100% | 低 |
| A10 SSRF | 2 | 100% | 低 |
| 路径穿越 | 2 | 100% | 低 |

**安全结论**：未发现 P0/P1 安全漏洞。所有受保护 API 有认证检查，数据库使用参数化查询，文件操作有路径穿越防护。

---

## 功能验证清单

### 核心功能 ✅
- [x] 用户认证（登录/注销/会话保持）
- [x] 图像生成（提示词→提交→轮询→显示）
- [x] 模型选择（下拉菜单切换）
- [x] 用户数据持久化（项目创建/保存/恢复）
- [x] 跨用户数据隔离

### 异常处理 ✅
- [x] HTTP 404/405/413 错误正确处理
- [x] 未授权请求返回 401
- [x] 重复提交防护
- [x] 任务取消机制
- [x] 超大请求体处理
- [x] 特殊字符提示词处理

### 安全防护 ✅
- [x] SQL 注入防护（参数化查询）
- [x] XSS 防护（React 自动转义）
- [x] CSRF 防护（SameSite Cookie）
- [x] 路径穿越防护
- [x] IDOR 防护
- [x] SSRF 防护（私有 IP 检测）
- [x] 命令注入防护

---

## 代码质量

| 指标 | 结果 |
|------|------|
| TypeScript 严格检查 | 0 错误 |
| ESLint 检查 | 0 错误 |
| 空 catch 块 | 0 |
| eval/Function 使用 | 0 |
| 硬编码密钥 | 0 |
| SQL 字符串拼接 | 0 |

---

## 已知限制与建议

### 非阻断建议（可在后续版本改进）
1. **请求体大小限制**：建议添加全局请求体大小限制（1MB），防止资源耗尽
2. **登录速率限制**：建议为 `/api/auth/login` 添加速率限制（5次/分钟）
3. **CSP 头**：建议添加 Content-Security-Policy 响应头
4. **Cookie SameSite**：生产环境建议使用 `sameSite: 'strict'`

### 测试覆盖说明
- 移动端测试已取消（平台无移动端界面）
- 视频生成/3D模型/工作流等高级功能未纳入本次自动化测试范围（需API Key配额）
- 建议后续版本补充这些功能的 E2E 测试

---

## 测试文件清单

| 文件 | 类型 | 用例数 |
|------|------|--------|
| `tests/e2e/p0-core.spec.ts` | E2E | 3 (×3浏览器 = 9) |
| `tests/e2e/p0-auth-session.spec.ts` | E2E | 3 (×3浏览器 = 9) |
| `tests/api/core-api.test.ts` | API | 46 |
| `tests/api/chaos-test.test.ts` | API | 21 |
| `tests/api/security-test.test.ts` | API | 31 |

### 文档清单

| 文件 | 说明 |
|------|------|
| `docs/testing/BUG_REGISTER.md` | 缺陷登记表（6个缺陷） |
| `docs/testing/SECURITY_REPORT.md` | 安全测试报告（OWASP Top 10） |
| `docs/testing/REGRESSION_REPORT.md` | 回归测试报告（109项全通过） |
| `docs/testing/RELEASE_READINESS_REPORT.md` | 发布就绪报告（本文件） |

---

## 最终结论

| 评估维度 | 结果 | 状态 |
|---------|------|------|
| 功能完整性 | 所有核心功能正常 | ✅ |
| 跨浏览器兼容 | Chromium/Firefox/WebKit 全通过 | ✅ |
| 安全性 | OWASP Top 10 全通过 | ✅ |
| 代码质量 | TS/Lint 零错误 | ✅ |
| 缺陷修复 | 6/6 修复 (100%) | ✅ |
| 回归测试 | 109/109 通过 (100%) | ✅ |

### 发布决策：✅ 批准发布

无界AI v3.8.0 已通过全平台测试验证，所有 P0/P1 缺陷已修复，109 项自动化测试 100% 通过，安全评估无阻断问题。**建议批准生产环境发布。**

## 2026-07-29 Pear 混合分层发布复核

此前 v3.8.0 的历史结论不适用于当前 v4.0.0 工作区。当前复核基于 Pear 混合分层 Task 1-9 提交链及本轮已提交的回归门禁修复，具体版本以同一工作区的 `git log` 为准。

### 当前门禁

| 门禁 | 状态 | 证据 |
|------|------|------|
| Doctor | 有条件通过 | 23 passed / 10 warnings / 0 failed |
| TypeScript | 已通过 | `next typegen` + `tsc`，0 errors |
| ESLint | 有条件通过 | 0 errors / 944 warnings |
| Pear/分层专项测试 | 有条件通过 | 68 passed / 1 PostgreSQL skip |
| 生产构建 | 已通过 | Next.js 16.2.10，110 静态页面 |
| 全仓测试 | 有条件通过 | 文件级串行门禁；233 files passed / 2 skipped；1066 tests passed / 2 skipped；0 failed；140.73s |
| Chromium 本地分层冒烟 | 阻塞 | 已生成完整 Playwright 证据；登录 API 因本地缺少数据库/鉴权配置返回 503 |
| Chromium 真实 Pear | 未验证 | 当前部署未包含本地提交，且 E2E provider/model 变量未配置 |
| Firefox/WebKit 分层回归 | 未验证 | 本地缺少真实登录凭据 |
| PostgreSQL 并发幂等 | 未验证 | 无独立测试数据库 |

### 发布决策：不通过

## 2026-08-02 供应商任务可靠性门禁

本轮已完成本地代码与自动化回归，**不等同于线上发布验收**。

### 已完成

1. 图像 `n > 1` 改为每张图片一个独立、可恢复、可取消的持久化子任务。
2. 前端可按槽位接收完成结果，不再等待整批供应商任务全部结束。
3. 视频同步 URL 响应、异步远端 ID 持久化、终态原子结算与取消退款已纳入同一任务模型。
4. 全仓 Vitest 通过：1335 通过、4 个 PostgreSQL 环境用例明确跳过、0 失败。

### 仍阻断正式发布

1. 未在已部署环境用真实付费模型验证图像 `n=2/3/4`：必须证明每张先完成先上画布、每个任务只扣费一次。
2. 未在已部署环境验证取消其中一个图像子任务：必须证明只取消/退款该子任务，其他结果不受影响。
3. 未验证真实视频供应商的同步结果、异步轮询、刷新恢复和失败/取消账务流水。
4. 缺少隔离 `TEST_POSTGRES_URL`，4 个真实数据库并发/幂等测试尚未运行。
5. Firefox/WebKit 对新增核心流程尚未取得真实浏览器证据。

### 发布决策：不通过

## 2026-07-29 Pear 分层最终本地门禁

### 已完成

1. Pear `Image-Layered` 强制异步 URL 响应，兼容直接 PSD 与 ZIP 制品。
2. 真实 ZIP 在本地成功提取主 PSD并解析出 29 个可编辑图层。
3. 提交期租约、heartbeat、worker owner fence、取消清理和共享内存门已进入自动化回归。
4. smart fallback 的阶段切换、积分恢复和退款流水已合并为单条数据库事务。
5. 全仓 535/535 个测试文件通过；1105 项通过、0 失败、3 项跳过。
6. TypeScript、ESLint `--quiet`、Next.js 生产构建均退出 0。
7. 独立代码复审确认本次修改 P0=0、P1=0。

### 仍阻断

1. 新提交尚未部署到 Coze，未证明云端初始 POST 快速返回、异步阶段完整推进并打开 2+ 图层编辑器。
2. 缺少隔离 `TEST_POSTGRES_URL`，2 项 PostgreSQL 并发用例被明确跳过；一次扣费、一次退款和终态竞争尚缺真实数据库证据。
3. Firefox/WebKit 的真实登录、分层、保存和恢复链路尚未执行。
4. 生产构建仍有既有动态文件追踪和超大 `infinite-canvas.tsx` 告警，当前非编译阻断，但应另行治理。

### 发布决策：不通过

允许推送本地修复供云端部署和下一轮验收；在上述三项真实环境门禁解除前，不建议正式发布。

## 2026-07-29 Pear ZIP 适配后的发布门禁

本地代码门禁已通过：分层专项 34/34、全仓 1083 项已执行测试通过、TypeScript 0 error、ESLint 0 error（944 条存量 warning）、Next.js 生产构建退出 0。

已确认 Pear 实际产物为包含主 PSD 与 depth PSD 的 ZIP，且同步模式耗时 4m30s。当前修复改为异步任务并安全提取主 PSD，但尚未部署到云端，因此不能把 Pear 后台的“成功”视为无界编辑器链路成功。

### 发布决策：不通过

解除门禁必须同时满足：

1. 初始 `/api/layered-decompose` POST 快速返回无界 taskId。
2. 任务依次进入 `submitting-pear`、`waiting-for-pear`、`downloading-psd`。
3. ZIP 主 PSD 成功解析，编辑器显示至少 2 个可编辑图层。
4. 单个成功任务仅扣费一次；失败或取消仅退款一次。
5. PostgreSQL 并发门禁和 Firefox/WebKit 回归取得真实执行证据。

## 2026-07-29 活动图片目标修复后的门禁

- 已确认云端 403 的直接输入不是当前选中图片，而是遗留 `editImageId` 指向的过期 Hunyuan 3D 预览地址；Pear 在该次请求中没有被调用。
- 本地已改为当前单选优先，历史编辑目标仅作无单选时的兜底；新增回归测试并完成全仓测试、类型、Lint 和生产构建。
- 真实 Pear 成功、PSD 2+ 图层、一次扣费、失败或取消的一次退款、PostgreSQL 并发以及 Firefox/WebKit 仍未完成。

### 发布决策：不通过

允许部署此最小修复以解除下一轮云端验证阻塞，但在真实 Pear 与结算门禁完成前，不建议对外宣称分层功能可商用。

## 2026-07-29 f8f7cef 复测后的门禁

- 已确认动态 Coze 预览域名下，同源托管图片仍可能绕过服务端托管路径识别并收到 403。
- 已在浏览器提交源头限定改写当前同源托管媒体，未扩大服务端信任边界。
- 已按 Pear 2026-07-27 文档收紧 `/v1/images/edits` 请求体。
- 全仓 1077 项已执行测试、TypeScript、ESLint 和生产构建通过；3 项 PostgreSQL 测试明确跳过。

**发布决策仍为不通过。** 新提交必须部署后取得 Pear PSD、至少 2 个可编辑图层、准确扣费以及取消退款一致性证据；Firefox/WebKit 仍受 E2E Secrets 阻塞。

发布阻断原因：

1. 新分层版本尚未部署，云端只验证到旧 PSD 编辑器入口。
2. 真实 Pear `/v1/images/edits` -> task -> PSD -> 2+ 可编辑图层链路没有部署后证据。
3. PostgreSQL 多实例并发幂等、一次扣费和一次退款仍缺少真实数据库验证。
4. Firefox/WebKit 分层回归和凭据化 HTTP API 套件尚未在目标部署运行。

在这些项目完成前，不推送“可发布”结论，不把跳过测试或旧云端页面计为通过。

## 2026-07-29 当前发布门禁更新

### 已解除

1. 云端同源 `/api/serve-upload/...` 图片不再在 Pear 提交前报 403。
2. 供应商提交前失败的积分保持 `9,987,596`，本次未发生错误扣费。
3. 本地模型类型兼容修复及相关 13 项测试通过。
4. 全仓 Vitest 本轮 1068 项已执行测试全部通过，2 项真实 PostgreSQL 测试明确跳过。

### 仍阻断

1. `server-api-config` 的历史模型类型兼容修复尚未部署，真实 Pear task、PSD 下载与 2+ 可编辑图层仍未验证。
2. 无隔离 `TEST_POSTGRES_URL`，数据库唯一约束、一次扣费、一次退款与迟到完成拒绝尚未在真实 PostgreSQL 并发下证明。
3. Coze 预览域名对独立 Playwright warmup 返回 404，且本地没有 E2E 用户凭据，Firefox/WebKit 未进入真实登录与分层步骤。
4. 一次全仓审查曾出现无法稳定复现的 Sharp 相关 5 秒超时，需继续观察 CI 重复运行结果。

### 发布决策：不通过

当前可以推送本地最小修复供云端部署，但不能宣称 Pear 分层链路或跨浏览器门禁已经完成。

## 2026-07-29 09850e3 后续发布门禁

### 新确认的阻断

1. Coze 代理把外部域名保留在 `Origin`，导致当前部署把同源受控媒体当作远程图片回抓并收到 403。
2. 10:05 与 10:10 两个失败任务各扣 15 积分，任务虽进入 `failed`，但无退款流水，属于 P0 错误扣费。

### 本地修复状态

- 生产路由仅信任部署配置 `COZE_PROJECT_DOMAIN_DEFAULT`，不信任客户端 `Origin`、`Host` 或 `x-forwarded-host`；非生产仅额外允许本机回环地址。
- 失败结算先锁定候选任务和积分账户，再只更新一次 `cloud_tasks`；余额回补和退款流水仍处于同一 SQL 语句。
- TypeScript、变更文件 ESLint、路由与结算专项测试均通过。

### 发布前必须完成

1. GitHub PostgreSQL 16 并发 job 重新通过。
2. 云端部署新提交后，真实 Pear 成功返回 PSD 与至少 2 个可编辑图层。
3. 真实制造一个安全的失败场景，证明只扣一次且只退一次。
4. 核对并补偿已确认的历史错误扣费。
5. Firefox/WebKit Secrets 配置完成后执行真实跨浏览器回归。

### 发布决策：不通过
## 2026-07-29 Pear ZIP MIME 修复后的发布门禁

### 已解除

1. 云端 `/api/layered-decompose` 初始 POST 已真实验证快速返回 HTTP 202 与应用 taskId。
2. Pear 调用已真实进入异步 `waiting-for-pear` 阶段，浏览器不再因 4m30s 同步等待而 `Failed to fetch`。
3. 本地已补齐仅供显式允许调用方使用的 ZIP MIME 安全集合，HTML、脚本及其他非白名单类型仍被拒绝。
4. 分层专项、TypeScript、ESLint、全量 Vitest 和生产构建均通过。

### 仍阻断

1. ZIP MIME 修复尚未部署到 Coze，真实 ZIP 下载、主 PSD 提取和 2+ 可编辑图层尚未通过。
2. 本次失败任务的积分退款和 Pear 侧单次扣费需要在管理员流水中核对。
3. 缺少隔离 `TEST_POSTGRES_URL`，多实例幂等、终态竞争和一次性退款仍缺真实数据库证据。
4. Firefox/WebKit 核心流程仍未执行。

### 发布决策：不通过

允许推送此最小修复并部署复测；在真实编辑器图层、结算一致性、PostgreSQL 并发与跨浏览器门禁全部取得证据前，不标记为可发布。

## 2026-07-29 Pear 双栈 DNS 修复后的发布门禁

### 已解除

1. 已确认 Coze/沙箱 DNS 同时返回允许的透明出口 IPv4 与不可用保留 IPv6。
2. 安全下载器现只固定到明确允许的解析地址，不再因未使用的保留 IPv6 误拒绝整个域名。
3. 真实 Pear ZIP 已通过生产下载器，主 PSD 成功提取并通过 `8BPS` 校验。
4. 真实主 PSD 已由项目 `ag-psd` 解析为 `1280x1280`、5 个可编辑图层、0 警告。

### 仍阻断

1. 本次提交尚需推送、部署后在预览页证明编辑器真实显示并可操作 5 个图层。
2. 成功任务单次扣费以及失败/取消单次退款尚需数据库流水证据。
3. PostgreSQL 多实例并发与 Firefox/WebKit 回归仍未完成。

### 发布决策：不通过

允许部署本次最小修复执行预览页终态回归；不得把本地真实制品回放等同于云端编辑器通过。

## 2026-07-31 两份质量计划本地完成门禁

本轮对应：

1. `2026-07-30-image-toolbar-editing-quality.md`
2. `2026-07-30-dual-element-decomposition.md`

### 已通过

- 图片工具专项 24/24。
- 双输出元素拆解专项 84 项通过，2 项 PostgreSQL 用例明确跳过。
- 全仓 1220 项已执行测试通过，0 失败，4 项真实 PostgreSQL 环境测试跳过。
- TypeScript 退出 0。
- ESLint 0 errors / 945 warnings。
- Next.js 16.2.10 生产构建退出 0，111 个静态页面完成。
- `git diff --check` 退出 0。

### 仍阻断正式发布

1. 新实现尚需推送并由 Coze 拉取部署，未取得本次提交的真实云端 Chrome 证据。
2. 移除背景、擦除、蒙版、调色尚需下载真实 PNG 并进行 alpha 与像素检查。
3. 双输出元素拆解尚需证明 `board`、`layers`、`both`、部分完成、分支重试和项目恢复。
4. Pear 链路尚需证明 ZIP 下载、主 PSD 提取、2+ 可编辑图层、选择/隐藏/移动/导出。
5. 缺少隔离 PostgreSQL 测试库，一次扣费、一次退款、迟到完成拒绝和多实例幂等没有真实数据库证据。
6. Firefox/WebKit 尚未执行本次新增流程。

### 发布决策：不通过

允许推送已验证的本地源码供 Coze 部署验收；在云端产物、PostgreSQL 结算与跨浏览器门禁完成前，不标记为可商用发布。

## 2026-08-02 更新：多图画布归并

新增两个 P1：

1. BUG-025：真实 Pear `n=2` 结果在画布批次收尾时重复持久化，导致 2 张显示为 4 层并重叠。
2. BUG-026：选定 Pear 的 `gpt-image-2` 结果在轮询没有返回展示名时被 UI 误标为 FHL。

两项均已在本地通过定向回归、完整 Vitest（296 files / 1340 tests passed，4 个 PostgreSQL 用例按环境规则跳过）、TypeScript、Lint 和生产构建，但尚未部署复验。因此发布结论保持为 **不通过**。

## 2026-08-02 更新：真实子任务取消与供应商归属

GitHub `main` 已推送提交 `7a003b69f3291bff1991563b0843e4ee1c4e1aba`。该提交关闭两个已稳定复现的本地实现缺陷：

1. 多图进度卡片取消只删除 UI、不取消供应商任务。
2. 轮询终态中的旧供应商名称覆盖保存的实际 `providerId`。

本地质量门禁：定向 5 files / 22 tests、全仓 299 files / 1348 tests 均通过；3 files / 4 PostgreSQL 环境用例跳过；TypeScript 与生产构建通过；ESLint 为 0 error / 949 存量 warning。

### 仍阻断

1. 必须部署 `7a003b6` 后，在真实 Pear `n=2` 任务中取消一个槽位，确认请求命中 `/api/cancel-task`、仅一个槽位终态为 `cancelled`、幸存槽位正常完成、迟到结果不能回写。
2. 管理员账务流水需证明取消槽位只退款一次，幸存槽位只扣费一次。
3. 缺少隔离 `TEST_POSTGRES_URL`，多实例幂等与并发退款仍不能作为真实数据库通过项。
4. Firefox/WebKit 核心任务回归仍未执行。

### 发布决策：不通过

本轮可以部署进行真实验收，但在取消与结算证据补齐前，不得将平台标记为可发布。

## 2026-08-02 最新发布门禁：云端取消复验未通过

GitHub `main` 的 `98ba6c2` 已部署并执行真实 Chrome 复验，但 Pear `n=2` 场景取消一个槽位后，刷新同一项目仍恢复两张结果。该行为说明取消接口在数据库终态竞争失败时向 UI 报告了错误的成功状态。

本地已建立失败回归并完成最小修复：持久化任务必须先条件式进入 `cancelled`，只有转换成功后才允许内存取消和 UI 移除；如果 `completed` 已先取得终态，接口返回 `409` 并保留槽位。当前修复将随本次提交推送，随后仍需部署与真实验收。

仍阻断发布：

1. 本次修复已完成新的全量 Vitest、Lint 与生产构建；云端真实复验仍待部署后执行。
2. 云端复验必须核对取消槽位不回写、幸存槽位完成、供应商账务仅扣一次且取消槽位仅退一次。
3. `BUG-031` 的本地自动保存配额异常尚未修复。
4. 隔离 PostgreSQL 并发结算与 Firefox/WebKit 核心回归仍缺少真实证据。

### 发布决策：不通过

在新提交部署并取得上述 P1 真实证据前，不能将当前版本标记为可商用发布。

## 2026-08-02 发布门禁更新：底部图像生成器修复待部署验收

### 本地已满足

1. 底部图像生成器在 `n > 1` 时请求 durable 子任务槽位，而非等待一个旧批处理外层任务。
2. 每个可见处理框都绑定真实 `taskId`，因此统一取消入口可先调用后端取消，再决定是否移除 UI。
3. 显式选择的 provider/model 在服务端不可用时会得到明确错误，不会偷偷改用另一个提供商。
4. 质量门禁通过：定向 30 测试、全量 1354 测试、TypeScript、ESLint（0 error）和生产构建均已执行。

### 仍阻断发布

1. 本次修复尚未推送并重新部署，因此没有新版云端真实浏览器证据。
2. 必须验证 Pear `n=2` 立即出现两个处理框；取消一个后只取消一个，另一个可完成；刷新后取消结果不会回写。
3. 必须在管理员账务中核对完成槽位只扣一次、取消槽位只退款一次。
4. PostgreSQL 多实例并发/幂等/退款测试仍因缺少隔离 `TEST_POSTGRES_URL` 跳过。
5. Firefox 与 WebKit 的核心付费任务回归仍未执行。
6. BUG-031 的本地自动保存配额异常仍未修复。

### 发布决策：不通过

可以推送此最小修复供 Coze 部署验收；在上述真实验收与阻断项解除之前，不得将整体平台标注为可发布。

## 2026-08-02 发布门禁更新：BUG-034

云端 `canvas-direct n=2` 真实测试已证明两个耐久槽位与两个不同 Pear 输出能够创建和回填，但同时发现所有可见槽位完成后，生成器仍被锁定为“生成中…”。该 P1 已以先失败后通过的回归测试锁定，并完成最小的终态归一化修复。

**当前发布决策仍为：不通过。**

重新评估前必须完成：

1. 部署本次终态归一化提交。
2. Chrome 真实验证 `n=2` 完成后无需刷新即可再次提交。
3. 新建一轮 `n=2` 后立即取消其中一个槽位，并让另一个槽位完成。
4. 保存 `/api/cancel-task`、迟到结果拒绝与一次扣费/一次退款的账务证据。
5. 完成既有 PostgreSQL 并发及 Firefox/WebKit 验证。
## 2026-08-02 Release Gate Update

The local reliability patch is ready for deployment verification, not release approval.

- Local gate: `pnpm test` passed with 302 test files and 1359 tests; 4 PostgreSQL-dependent tests remain skipped without `TEST_POSTGRES_URL`.
- New P1 changes: provider identity is no longer derived from a display label; only restored placeholders use recovery polling; each direct-generation slot now has independent cancellation control.
- New P2 change: autosave snapshots are compacted and storage writes evict oldest snapshots before giving up.

**Decision: Not approved for release yet.** The deployed application must provide real browser and billing evidence for a Pear `n=2` run where one slot is cancelled and the other completes.

## 2026-08-03 Cloud Finding: provider attribution remains a P1 release blocker

The deployed `2270162` build created and completed two real Pear tasks with the correct request provider ID, but displayed the completed cards as FHL because the provider returned an empty `providerName`. This is recorded as BUG-037 and fixed locally with a non-empty-field guard.

The current release decision remains **Not approved**. The next deployed verification must prove all of the following in one run:

1. Pear `n=2` results remain labeled Pear when task completion metadata is empty.
2. One still-processing slot can be cancelled without affecting the other slot.
3. A cancelled slot cannot reappear after a refresh.
4. The billing ledger records exactly one charge for the successful slot and no duplicate charge or refund.

## 2026-08-03 Local Gate Update

The BUG-037 patch has passed the local regression, full Vitest suite, TypeScript check, ESLint error gate, and production build. This is not cloud acceptance evidence. The release decision remains **Not approved** until the deployed build proves provider attribution, per-slot cancellation, refresh recovery, and billing settlement with real provider tasks.
## 2026-08-03 Cloud Retest

BUG-037 is verified in the deployed direct-canvas generator: fresh Pear `n=2` output cards retained the Pear label.

The same live test reproduced a P1 cancellation failure. A first-slot cancellation click at `processing 0%` did not cancel either slot. The next deployment carries an observability-only repair that surfaces the server's exact rejection reason; it does not claim cancellation success. The release decision remains **Not approved**.

## 2026-08-03 Canvas Group Fix Gate

The reference/fusion-group repair has passed local regression, TypeScript, lint error gating, and production build. It is deployable for cloud acceptance, but it does not close the release gate by itself.

- Added P1 BUG-039 coverage for grouping gestures, group dragging, default generation, reference analysis, and concurrent-group metadata isolation.
- Local verification: `pnpm test` passed with 303 files / 1367 tests; `pnpm ts-check` and `pnpm build` passed; ESLint has 0 errors and 949 historical warnings.
- Required cloud acceptance: create both group types from real images, use a real vision-model recognition request, run reference and fusion generation with a configured provider, drag a group, save, and refresh.

**Release decision remains: Not approved.** Existing P1 cancellation and billing-ledger acceptance items, PostgreSQL concurrency evidence, cross-browser verification, and the new group workflow acceptance must be completed before an overall release approval.

## 2026-08-03 Group Control Regression Update

BUG-040 was reproduced in the deployed canvas: image-group, reference-group, and fusion-group controls were intercepted by the root canvas pointer-down handler before their click action could run. The local fix introduces explicit interaction boundaries for both group container types and is covered by a RED/GREEN regression test.

Local evidence: focused canvas and progressive-generation suite passed 24 assertions. The complete local gate also passed: TypeScript, ESLint error gate (`0` errors / `949` historical warnings), `303` test files / `1368` tests, and the production build. Three PostgreSQL-specific test files remain skipped because no isolated `TEST_POSTGRES_URL` is configured. This is not release acceptance evidence. The deployment must be checked against the pushed commit before using it for the paid `n > 1` acceptance flow.

**Release decision: Not approved.** P1 provider cancellation/refund evidence, PostgreSQL concurrency, cross-browser coverage, group-control cloud acceptance, and the next exact-build `n=2` progressive-return verification remain open.

## 2026-08-03 Group Fidelity Update

The deployed `072cd6f` build exposed two additional group issues: native setting menus ignored canvas zoom, and the six reference controls were not retained as independent generation constraints. The next local patch renders configuration menus inside the scaled canvas and preserves per-category strengths through the generation API. Fusion mode now requires every source image's style, composition, scene, color, subject, and detail at full strength.

Local quality gates passed, but the release decision remains **Not approved** until the exact deployed commit is visually verified and completes a real image-to-image `n=2` run.

## 2026-08-03 Image Generator Reference-Constraint Update

The image-generator panel deliberately remains different from canvas reference/fusion groups: each reference image may select up to two semantic categories and retains one image-wide strength. This update repairs the server-side interpretation without changing that approved UI.

- The server now binds descriptions, categories, and strengths to their exact numbered source image.
- Constraint language is chosen internally from the selected provider/model: Chinese-native models receive Chinese instructions, English-native models receive English instructions, and unknown providers receive a compact bilingual fallback.
- Durable asynchronous tasks retain `referenceCategoryStrengths`, preventing recovery from silently degrading a request.
- Local checks passed: focused generation suite 23 assertions; full suite 1,380 passing tests; TypeScript and production build passed; lint has 0 errors and 949 historical warnings.

**Release decision remains: Not approved.** The deployed build still needs paid real-provider acceptance for two-reference generation on enabled Chinese-native and English-native models, together with the existing cancellation, refund, PostgreSQL concurrency, and cross-browser blockers.

## 2026-08-03 Reference/Fusion Group Failure-Visibility Update

BUG-044 is fixed locally and covered by focused regression tests, but it is not cloud-accepted yet. This change intentionally does not treat a real provider rejection as an application success: it makes the rejection visible so the provider capability, request shape, or configuration can be diagnosed from evidence.

The overall release decision remains **Not approved** until the deployed reference-group workflow proves that a bound enabled provider can complete a real image-to-image request, or returns an actionable and correctly attributed failure without leaving the group stuck.

## 2026-08-03 Shared Reference-Image Transport Update

The cloud error `Missing required parameter: image` was traced to a shared application request-construction defect, not to `gpt-image-2-4k` or any individual model. The bottom image generator and canvas reference/fusion groups all converge on `/api/generate`; capability filtering previously captured a request body before reference images were attached.

The repair now attaches and normalizes `image` plus `image_urls` first, then filters and adapts the exact provider request. Local RED/GREEN regression, full Vitest (309 files / 1,386 tests), TypeScript, lint error gating, production build, and protected-file checks passed.

**Release decision remains: Not approved.** This fixes the common transport blocker locally, but paid cloud acceptance must prove successful submission from both the bottom generator and a canvas reference group. PostgreSQL concurrency, cancellation/refund, and cross-browser gates remain open.

## 2026-08-03 Routing Consistency Update

The Coze browser capture exposed a P1 Wujie routing error: the model selector visibly displayed one configured option while the submitted request paired the selected provider with an unconfigured stale model. This could surface as `fetch failed` and be mistaken for a provider outage.

The local repair is verified by new RED/GREEN regression contracts, the focused generation/recovery suite, TypeScript, lint error gating, full Vitest, and production build. It is **not cloud accepted yet**. Release remains **Not approved** until the exact deployed commit proves:

1. UI selection, persisted selection, and `/api/generate` provider/model fields always agree.
2. An invalid explicit pair is rejected before task creation and charging.
3. A valid configured provider task reaches a terminal state with retained provider evidence.
4. Browser/proxy interruption after submission is reconciled through the durable task rather than misreported as an immediate provider failure.

## 2026-08-04 Local Gate Update

Dedicated RemoveBG production wiring and Pear PSD/ZIP artifact handling have passed their focused suites and the complete local test/build gate. The complete Vitest run passed 320 files and 1,435 tests. Four PostgreSQL concurrency tests remain skipped because this workstation has no isolated PostgreSQL test URL. The Next.js production build completed successfully and generated 112 static pages.

**Release decision remains: Not approved.** Local evidence cannot close the following production boundaries:

1. A real dedicated RemoveBG provider must return a non-constant alpha result through each supported response format and preserve the selected provider/model metadata.
2. A real Pear `Image-Layered` request must return quickly with an application task ID, progress through asynchronous phases, download the ZIP, select the non-depth PSD, and open editable layers.
3. PostgreSQL must prove concurrent idempotency, conditional terminal transitions, one charge, and at-most-one refund under completion/cancel/failure races.
4. Login, model catalog, reference/fusion groups, `n > 1` progressive return, canvas, node mode, ChatCanvas, and both toolbars require an exact-build Chrome smoke regression after deployment.

No local test result is being used as a substitute for those deployed acceptance checks.

---

## 2026-08-05 Local Acceptance Status (`7d88625`)

All local gates pass: unit/API/regression suites, TypeScript, ESLint (0 errors), and production build. Deployed acceptance remains blocked: the exact-build cloud smoke needs a running Coze sandbox, and the credit-consuming P0 generation E2E needs explicit environment credentials plus paid-generation approval.

**Verdict: 有条件通过 (conditional)** - pending deployed acceptance checks for auth, model catalog, canvas/node/ChatCanvas, both toolbars, `n > 1` progressive generation, and PostgreSQL billing consistency.

## 2026-08-09 Stage 1 decision

**Decision: Not passed. Do not merge or release Stage 1 as complete.**

The release infrastructure can now collect non-mocked, exact-build evidence, but the evidence itself is incomplete. Local TypeScript, the Stage 1 contract, E2E discovery, and the 38-feature protection gate pass. Release remains blocked by inherited full lint/test failures, missing isolated PostgreSQL, missing paid three-browser provider evidence, and missing cancellation/refund/rollback proof.

The authoritative detail is `docs/testing/STAGE_1_COMPLETION_REPORT.md`. CI must not treat the external evidence job as optional for a Stage 1 release decision.

## 2026-08-09 Stage 1 PostgreSQL update

The local isolated-database blocker is now closed. A loopback-only PostgreSQL 18 instance exposed two real defects before passing the gate: the missing `wujie_audit_log` base table and an illegal NUL byte in the advisory-lock identity. Both were reproduced, covered by failing tests, fixed minimally, and reverified.

- Doctor: 22 passed / 12 warnings / 0 failed / 0 blocked for the supplied test database.
- PostgreSQL suites: 3 files / 9 tests passed, 0 skipped.
- Focused task and billing regression: 4 files / 77 tests passed.
- TypeScript passed; changed-file ESLint has 0 errors.

**Release decision remains Not passed.** Exact-deployment paid generation in Chromium, Firefox, and WebKit; deployed cancellation/timeout/late-result ledger evidence; rollback rehearsal; and inherited full-repository lint/test blockers remain open.

## 2026-08-10 P0 durable-generation update

BUG-050 is fixed locally: charged durable image slots now receive a server-owned kickoff through the existing lease-protected recovery route, without waiting for a browser poll. Focused concurrency/billing tests, TypeScript, ESLint error gating, the full Vitest suite, and the production build pass.

**Release decision remains Not passed.** The exact cloud commit must still prove that `n=1/2/3/4` starts without browser polling, returns each image progressively, records one charge per slot, creates no duplicate provider task under concurrent browser/server wakeup, and refunds each cancelled legacy zombie task at most once.

### 2026-08-10 cloud probe correction

The first deployed server-kickoff candidate (`9392b50`) did not pass its no-browser-poll probe. Its signed internal request reached `/api/poll-task`, but that route only recognized a browser session cookie and therefore looked for the paid task as `anonymous`. The probe task was cancelled and refunded once; the three historical zombie tasks were also cancelled and refunded exactly once each.

Unified request authentication is now covered locally by a RED/GREEN regression test, the focused suite passes 47 tests, the full Vitest suite exits 0 with the PostgreSQL environment skips declared, and the production build passes.

**Release decision remains Not passed.** The internal-auth follow-up is not yet deployed. Server-owned first submission, concurrent wakeup idempotency, progressive paid `n=1/2/3/4`, and exact deployed ledger evidence remain release blockers.

### 2026-08-10 recovery-backoff correction

The deployed internal-auth follow-up `8bf0e20` also failed its no-browser-poll acceptance. Task `async-1786322172707-0-uzo191` remained at 0% for more than 31 minutes with 120 credits pending because the server kickoff stopped after the recovery route returned a successful but non-terminal `recoveryPending` response during the normal fresh-task backoff window.

The kickoff now keeps driving the durable task through bounded recovery and processing responses until a terminal state. The exact failure sequence has RED/GREEN regression coverage, and all local TypeScript, lint error, Vitest, protected-feature, and production-build gates pass after the reviewed source file is added to the exact Stage 1 allowlist.

**Release decision remains Not passed.** This repair has not yet been deployed. The stale paid task requires one-time cancellation/refund evidence, and a fresh `n=1` no-browser-poll probe must reach a provider-backed terminal state before `n=2/3/4` testing resumes.

### 2026-08-10 Coze acceptance result

The server-owned kickoff and progressive slot behavior now pass in the Coze sandbox. The stale 120-credit probe was cancelled and refunded once. A new durable `n=1` completed without browser polling, and canvas-shaped `n=2/3/4` requests returned unique per-slot task IDs quickly. All ten canvas slots completed with images and independent 60-credit charges; `n=3` provided direct evidence that faster slots completed before the slowest sibling.

**Release decision remains Not passed.** BUG-051 is now closed in the updated Coze runtime: real task `direct-1786341342235-0-8pta21` completed with one image, deducted 60 credits, and persisted matching charged costs of 60 in both cloud-task fields. The exact runtime Git SHA was not exposed by Coze, canvas hydration/save-refresh/download still need a browser-visible run, and Firefox/WebKit paid evidence remains open.

## 2026-08-10 latest Stage 1 disposition

- Chromium, Firefox, and WebKit real paid `n=1/2/3/4` generation now have completed browser artifacts. Canvas result hydration and refresh persistence passed in all three engines.
- Real cancellation, repeated cancellation, late-result isolation, one-time refund, and balance restoration passed for task `async-1786343121430-0-6e583w`.
- That cancellation exposed BUG-052: correct money movement existed without durable task-to-ledger transaction IDs. The fix is locally green, including a real isolated PostgreSQL 18 test, but is not yet accepted on the deployed runtime.
- Current verdict remains **Not passed**. Remaining blockers are BUG-052 cloud acceptance, timeout-specific deployed proof, `core-v2 -> legacy` rollback rehearsal, and exact runtime SHA identity.

## 2026-08-10 BUG-052 and deployment-identity update

- BUG-052 is closed in the deployed Coze preview. Real task `async-1786354360647-0-rhvubs` persisted matching non-empty charge/refund transaction IDs, produced one charge and one refund, restored the original balance, and remained cancelled.
- Runtime identity is independently established: running Coze commit `d531ce65` directly parents GitHub `main@32139c5`; its only local delta is the environment-loading block in `scripts/coze-start.sh`.
- Current verdict remains **Not passed**. The remaining Stage 1 blockers are the timeout-specific deployed proof and the `core-v2 -> legacy` rollback rehearsal. No Stage 2 work may begin before those gates are resolved or explicitly recorded as blocked.

## 2026-08-10 BUG-054 absolute-timeout update

- A Coze-local delayed-provider probe validly reproduced the timeout defect: task `async-1786358975492-0-mq23bl` was still `processing/pending` after 666 seconds with 280 credits held.
- Manual cancellation refunded exactly once and restored the balance; this cleanup is not timeout acceptance.
- The local candidate now enforces one absolute 10-minute recovery deadline from the durable task `createdAt`, aborts execution, and uses the database conditional terminal/refund path.
- Local focused, full-test, TypeScript, ESLint, and production-build gates pass.
- Current verdict remains **Not passed**. BUG-054 requires exact-deployment cloud acceptance, followed by the `core-v2 -> legacy` rollback rehearsal. Stage 2 remains prohibited.

## 2026-08-10 BUG-054 cloud gate closure

- BUG-054 is closed by a real paid Coze run. Task `async-1786366442668-0-dzxu9y` automatically reached `timeout/refunded` 602.934 seconds after its durable creation time.
- Billing was exactly once: balance `378 -> 238 -> 378`, one -140 consume, one +140 refund, and both transaction IDs persisted on the task.
- At 1132.6 seconds, after the 900-second delayed response window and a sandbox restart, status, `updatedAt`, balance, and the two-row ledger remained unchanged.
- Temporary provider cleanup passed. Exact runtime SHA was not independently exposed in this run and remains a declared provenance limitation.
- Current verdict remains **Not passed**. The only remaining Stage 1 completion action is the documented `core-v2 -> legacy` rollback rehearsal. BUG-053 remains an open P2 terminal-label defect; Stage 2 remains prohibited.

## 2026-08-10 Stage 1 final gate

- The `core-v2 -> legacy` cloud rollback rehearsal passed on the current GitHub `main@104b140` business source. Coze `HEAD=413cb46d` differs only by the reviewed `.env` loading change in `scripts/coze-start.sh`.
- Before rollback, two paid Agent probes persisted `handlerVersion=task-core-v2`. After changing only `.env` and restarting, a new probe persisted `handlerVersion=legacy`.
- Existing core-v2 task IDs, terminal states, revisions, charge IDs, and refund IDs remained unchanged and readable after rollback. No data migration occurred.
- All three probes had exactly one 12-credit consume and one 12-credit refund; balance stayed at 378. No duplicate task, charge, or refund was observed.
- **Stage 1 verdict: PASS.** All Stage 1 P0/P1 task-and-billing gates are closed. BUG-053 remains an open P2 presentation defect and must stay registered.
- **Whole-program release verdict: CONDITIONAL / NOT YET FINAL.** Later WJ-STABLE stages have not been executed in this task. Stage 2 was not started and `stable@a53da24` was not touched.

Evidence: `docs/testing/evidence/stage-1-core-v2-legacy-rollback-2026-08-10.json`.

## 2026-08-11 Stage 2 Checkpoint B status

- Three of four required workspace-transfer paths pass in the Coze `shadow` runtime.
- Standalone chat to Canvas is blocked by BUG-055: a provider-relative result URL was stored as a ready AssetVersion and rendered as `MEDIA_LOAD_FAILED`.
- BUG-055 is fixed and fully gated locally, but cloud deployment and real Chrome revalidation are still pending. BUG-056 (reference-image data URL decoding) and BUG-057 (stale generating label) remain open.
- Six PostgreSQL integration suites remain unverified locally without `POSTGRES_TEST_DATABASE_URL`.
- **Current Stage 2 verdict: NOT PASSED.** Task 7 must not start until Checkpoint B is closed in cloud `shadow`. `asset-v3` remains prohibited and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only.

## 2026-08-11 Stage 2 Checkpoint B closure

- All four required transfer directions now pass in the Coze `shadow` runtime, including a fresh paid standalone-chat generation rendered in the selected Canvas.
- BUG-055 is closed with controlled media persistence and database-backed idempotency evidence.
- **Checkpoint B verdict: PASS.** Task 7 may begin. This does not mean Stage 2 or the whole program is release-ready.
- BUG-056 and BUG-057 remain open. Six local PostgreSQL integration suites remain unverified without `POSTGRES_TEST_DATABASE_URL`; `asset-v3` remains prohibited and stable remains read-only.

## 2026-08-11 Stage 2 Task 7 local decision

- Task 7 is locally complete at `12a9026eaf35e60410f775ae59f10c5d7eabe769`; independent review R6 is approved with zero findings and all available local gates pass.
- Completed tasks now project idempotently to immutable versions and placements without changing task/billing terminal authority. Projection failure is recoverable and does not turn a completed generation into a failed or recharged task.
- Workflow 3D internal authentication, ownership, provider/model binding, per-attempt idempotency, and long-submit timeout are covered by permanent regressions.
- **Stage 2 remains NOT PASSED.** Task 8, real isolated PostgreSQL concurrency, Checkpoint C cloud `shadow` validation, and final multi-workspace E2E/rollback are still incomplete. `asset-v3` must remain disabled and `stable` remains protected.

## 2026-08-12 Stage 2 Task 8 local decision

- Task 8 is locally implemented at `b969c87..90cad2e`; task review and final whole-branch re-review are approved with 0/0/0 findings, and all available local gates pass.
- Trash/restore is placement-aware, media recovery is exact-path and fail-closed, orphan scans default to deterministic dry-run, and physical purge remains disabled.
- The five PostgreSQL lifecycle tests now pass in an isolated local PostgreSQL 18 database. PostgreSQL-enabled full Vitest passes `2105` tests; four unrelated suites remain skipped under their separate `TEST_POSTGRES_URL` gate.
- Coze has not pulled this Task 8 branch and no cloud `shadow` lifecycle proof exists.
- **Stage 2 verdict remains NOT PASSED.** Checkpoint C is technically eligible for a `main`-only push but cloud `shadow` proof and Task 9 are still pending; `asset-v3` remains prohibited; GitHub `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only.

## 2026-08-12 Checkpoint C cloud decision

- Real Coze `shadow` testing found BUG-063: Canvas generation was not project-bound and shadow reconciliation duplicated placeholder/result identities. The local candidate repairs the request, identity, adoption, deletion, and lock boundaries with focused `48/48` regression and passing TypeScript.
- BUG-064 remains open: clicking media recovery can render a source image while durable availability remains `recovering`; no worker terminal transition is proven.
- **Checkpoint C verdict: NOT PASSED. Task 9 must not start.** Deploy the exact BUG-063 candidate in `shadow` and rerun lifecycle evidence; keep `asset-v3` and physical purge disabled. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only.
- Final candidate local gates passed: affected regression `51/51`, full Vitest `2083 passed / 35 environment-skipped / 0 failed`, TypeScript, ESLint (`0 errors / 957 historical warnings`), production build (`116/116` pages), and protected baseline (`38/38`, no unapproved source drift). This does not override the open BUG-064 or the missing current-candidate PostgreSQL concurrency evidence.

## 2026-08-12 Checkpoint C repaired candidate decision

- BUG-064 is closed locally: recovery now has an authorized durable worker, PostgreSQL lease/fencing, exact validated S3 or durable-local delivery, database-authoritative polling, and explicit retryable versus unrecoverable terminals.
- Current-candidate PostgreSQL evidence is complete. The final repository run passed `402/402` files and `2160/2160` tests with zero failures and zero skips, including all Stage 2 lifecycle/projection and billing concurrency tests.
- TypeScript, production build (`116/116`), ESLint (`0 errors / 957 historical warnings`), protected baseline (`38/38`), and `git diff --check` pass. Independent final review is `APPROVED` with no P0/P1/P2 findings.
- **Checkpoint C verdict remains NOT PASSED pending cloud evidence.** Coze currently runs base `4bbe6db`; after a `main`-only push, deploy the exact candidate in `shadow` and prove generation projection, delete/reload, and media recovery. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`, `asset-v3`, and physical purge remain untouched/disabled.
## 2026-08-12 Stage 2 Checkpoint C final decision

- GitHub candidate: `main@1344dec33f93fc9d8a19baeaf9ed251c28176f5f`.
- Coze runtime: `6965f28ceb57650af0f87f10d6509603949f0eff`, direct parent `1344dec`, with only the approved deployment adapter difference.
- Cloud lifecycle evidence: missing media recovered to ready, survived reload, one succeeded attempt, one physical artifact, one active placement, zero GC candidates.
- Safety controls: `shadow`, task core `legacy`, durable `/space/wujie-data`, physical purge disabled, `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` untouched.
- **Checkpoint C verdict: PASS.** Stage 2 itself is not yet complete; Task 9 multi-browser/cross-workspace E2E, doctor gates, controlled `asset-v3` test switch and proven legacy rollback remain required.

## 2026-08-13 Stage 2 Task 9 local decision

- Local browser acceptance is complete for five profiles: `50/50` Stage 2 lifecycle and cross-workspace tests passed against a production server with isolated PostgreSQL and per-browser controlled fixtures.
- Full Vitest passed `410` files / `2258` tests. Four non-Stage-2 tests remain visibly skipped behind the separate `TEST_POSTGRES_URL` variable; they are not counted as passes.
- ESLint has `0 errors / 959 historical warnings`; TypeScript, Doctor, production build, and whitespace checks pass.
- BUG-065, BUG-066, and BUG-067 are closed locally with permanent regression coverage. Their exact candidate still requires Coze `shadow` verification.
- **Current verdict: CONDITIONALLY PASS FOR A MAIN-ONLY CANDIDATE PUSH; STAGE 2 NOT COMPLETE.** The final blockers are exact-SHA Coze shadow comparison, a controlled test-only `asset-v3` run, and a proven rollback to `legacy`. Physical purge remains disabled and `stable` remains read-only.

## 2026-08-13 Stage 2 Task 9 final candidate decision

- BUG-068 through BUG-070 are closed locally with permanent unit, API, PostgreSQL, and browser regression coverage. Independent final review is `APPROVED` with no remaining review finding.
- Fresh production-browser evidence is `50/50` across Chromium, 1920x1080 Chromium, Firefox, WebKit, and mobile Chromium. Every browser used a separate controlled user/project fixture set; failed environment-misconfiguration and shared-fixture attempts are excluded from pass counts and remain visible in evidence.
- Final local gates pass: full PostgreSQL-enabled test command, API suite, regression suite, TypeScript, Doctor, production build, protected baseline `38/38`, and whitespace checks. ESLint reports `0 errors / 959 historical warnings`.
- Coze currently reports `4bbe6db`, which predates this final candidate. Therefore no cloud result can yet validate BUG-065 through BUG-070.
- **Verdict: CONDITIONALLY PASS FOR MAIN-ONLY PUSH; STAGE 2 NOT COMPLETE.** Required remaining order is exact-SHA Coze `shadow` comparison, controlled test-only `asset-v3`, then verified rollback to `legacy`. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only and physical purge remains disabled.

Post-decision update: the implementation candidate was fast-forward pushed to `main@644a0809658d500d9e3815c14771dd10581f0998`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged. Release status is still conditional because Coze has not yet pulled and validated this candidate in `shadow`.

## 2026-08-13 BUG-071 release decision

The controlled cloud `asset-v3` run exposed a P1 delete/undo persistence defect, so Stage 2 was correctly kept open and Coze was returned to `legacy`. The local candidate now synchronizes placement lifecycle and the authoritative project snapshot, compensates partial failure, and passes the five-profile production-browser reload matrix. The current verdict remains **CONDITIONAL**: push to `main` only, have Coze pull the exact new SHA, verify the same controlled `asset-v3` sequence, then prove rollback to `legacy`. `stable` remains read-only and physical purge remains disabled.

## 2026-08-13 Stage 2 final release decision

Coze validated GitHub source `main@81fe303e73ba2f50d2ca0a6ed7201c5977758231` in authenticated Chrome. BUG-071's delete/undo/redo/undo/reload sequence passed in controlled `asset-v3`; PostgreSQL preserved one authoritative Canvas placement plus the intended chat and workflow references on the same ready version. Exact-candidate `shadow` comparison reported no owner/project drift, no non-ready active reference, and no GC candidate. Both controlled modes were rolled back successfully.

**Stage 2 verdict: PASS / COMPLETE.** The deployed test environment finishes in `WUJIE_ASSET_GRAPH_MODE=legacy`, `WUJIE_TASK_CORE_MODE=legacy`, with physical purge disabled. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains untouched. The whole-program verdict remains **CONDITIONAL / NOT FINAL** because Stages 3 and later, along with the separately registered business-module and payment gates, are outside this Stage 2 closure.

## 2026-08-13 Stage 3 Task 4 readiness decision

- Selection and image-drag behavior is locally closed for the Task 4 scope: focused `34/34` and production Chromium `3/3` pass, including real Ctrl add/remove multi-selection, reverse box selection, group/image cancel rollback and reload-persistent drag coordinates. Independent re-review is `APPROVED`.
- The fresh repository rerun passes `411` executed files / `2291` executed tests; `12` PostgreSQL-gated files / `44` tests remain explicitly skipped. ESLint is `0 errors / 966 historical warnings`, TypeScript passes, and the production build generates `116/116` routes.
- The clean-fixture full Stage 3 Chromium scenario is `5/6`. The open P1 is the 300-node input-delay gate (`50.2ms`, required `<=50ms`; preceding runs `56.8ms` and `62.8ms`). No disappeared or unclickable frame was recorded.
- TypeScript, full Vitest (`411` files / `2288` passed / `44` skipped), the `116/116` production build and whitespace checks pass. ESLint is `0 errors / 966 historical warnings`. The `12` PostgreSQL-gated files and four non-default browser profiles remain unverified in this task.
- All `38/38` protected features remain present, but the release gate correctly blocks production-source drift until the later Stage 3 protected-baseline task updates the approved allowlist/metadata.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `5/11` tasks, approximately `45%`. Task 5 command/history transactions has not started. No Task 4 change is authorized for `stable`, and no cloud deployment claim is made.

## 2026-08-13 Stage 3 Task 5 readiness decision

- Task 5 code and focused browser scope pass locally. Final review found no P0/P1, focused tests are `56/56`, production Chromium Task 5 E2E is `3/3`, and PostgreSQL-enabled full Vitest is `2374/2374` with no skips.
- The final-build full Chromium Stage 3 scenario is still `7/8`. S3-BUG-004 remains open P1 because 300-node input P95 is `52.3ms` against the non-negotiable `<=50ms` gate after an earlier `72.5ms` run, despite zero disappeared frames and zero unclickable time.
- All `38/38` protected feature identities remain present. The gate still blocks `24` expected Stage 3 source drifts until the plan-authorized baseline update; this is not a release pass.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `6/11`, approximately `55%`. Task 6 has not started. Nothing is pushed or deployed, `stable` remains untouched, and no cloud claim is made.

## 2026-08-13 Stage 3 Task 6 readiness decision

- Task projection is locally closed: focused `48/48` and the production Chromium progressive-slot scenario `1/1` pass, including out-of-order `n=4` completion, stable slot identity/order, project sync and reload persistence.
- Fresh full Vitest has zero failures (`2351` passed, `44` environment-skipped). TypeScript, ESLint and whitespace checks pass. Production build generates `116/116` routes.
- Release gates remain open: after a clean 15-project reseed, the full Stage 3 Chromium run is `7/8` because 300-node input P95 is `87.8ms` versus `<=50ms`; four external browser profiles and cloud exact-SHA/rollback are unverified.
- All `38/38` protected feature identities and required evidence contracts remain present. The protected baseline still blocks `27` accumulated Stage 3 source drifts until its ordered approval task.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `7/11`, approximately `64%`. Task 7 persistence scheduling has not started. Nothing is pushed or deployed, and `stable` remains untouched.

## 2026-08-13 Stage 3 Task 7 readiness decision

- Non-blocking project persistence is locally closed for Task 7: focused regression `35/35`, PostgreSQL-enabled full Vitest exit `0`, TypeScript, ESLint and the `116/116` production build pass.
- Production Chromium save/refresh is `2/2`. The 300-node save sample meets the fixed save budget with `0ms` longest save task and preserves coordinates, size, z-order and processing state after refresh; no disappeared or unclickable frame was recorded.
- This save-specific sample does not close S3-BUG-004's full 300-node pan/input P95 gate. External browsers, cloud exact-SHA and rollback remain unverified.
- All `38/38` protected identities, paths and evidence contracts remain, while the gate correctly blocks `29` accumulated Stage 3 source drifts until its ordered approval task.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `8/11`, approximately `73%`. Task 8 is next and has not started. Nothing is pushed or deployed, and `stable` remains untouched.

## 2026-08-13 Stage 3 Task 8 readiness decision

- Tool registration and session exclusivity are locally closed for the Task 8 scope: focused `32/32` and production-browser `5/5` pass across the configured desktop/mobile profiles.
- Full local gates pass with real PostgreSQL enabled: full Vitest exit `0`, API `477/477` plus PostgreSQL concurrency `3/3`, component/lib `1759/1759`, TypeScript, Doctor `43/11/0/0`, and production build `116/116`. ESLint is `0 errors / 966 historical warnings`.
- Protected feature identity remains `38/38`. The default baseline gate correctly blocks `32` accumulated Stage 3 source drifts; an explicit reviewed 32-path scope gate passes. This is not a production-baseline approval.
- The five-profile evidence proves only the Task 8 mutual-exclusion flow. It does not replace the full Task 0-7 cross-browser matrix, S3-BUG-004's 300-node input gate, cloud exact-SHA verification or `canvas-v2 -> legacy` rollback.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `9/11`, approximately `82%`. Task 9 is next and has not started. Nothing is pushed or deployed, and `stable` remains untouched.

## 2026-08-14 Stage 3 Task 9 readiness decision

- Component boundaries are locally closed for Task 9: workspace owns task polling, `CanvasSurface` remains render/controller-only, `CanvasToolHost` remains session/panel-only, and protected tool panels remain reachable through the compatibility facade.
- Focused regression is `58/58`; fresh full Vitest is `422` passed files / `2376` passed tests with environment-gated tests separately verified against PostgreSQL (`46/46` plus `4/4`). TypeScript, production build and whitespace checks pass; ESLint is `0 errors / 965 historical warnings`.
- Task 9 does not supply the complete Stage 3 browser/performance/release evidence. S3-BUG-004's fixed 300-node input P95 gate, full five-browser matrix, exact-SHA Coze verification and `canvas-v2 -> legacy` rollback remain open.
- Protected features remain governed by the unchanged baseline. The accumulated Stage 3 source drift must continue to block the default release gate until the ordered Task 10 approval step; this Task does not silently rewrite that baseline.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `10/11`, approximately `91%`. Task 10 is next and has not started. Nothing is pushed or deployed, and `stable` remains untouched.

## 2026-08-14 Stage 3 Task 10 local readiness decision

- The complete local legacy browser matrix is `60/60`; representative shadow and canvas-v2 matrices are `15/15` each. Desktop Chromium meets the unchanged 100/300-node FPS and P95 thresholds with zero disappearing frames and zero unclickable time.
- S3-BUG-004, S3-BUG-011, S3-BUG-012, S3-BUG-013 and S3-TEST-001 are closed locally with retained RED/GREEN evidence and permanent contracts. All `38/38` protected capabilities remain present.
- Local static, test, PostgreSQL, API, regression and build gates exit 0. ESLint retains `965` historical warnings and adds no error; the build emits `116/116` routes.
- The isolated database has no real API provider configuration. Consequently, paid image generation, task billing, cancellation/refund consistency and provider-returned media are not locally verified. This is an explicit external evidence gap, not a mock pass.
- **Release verdict: CONDITIONAL / NOT READY FOR STAGE 3 COMPLETION.** The candidate still requires main-only publication, GitHub Actions execution, Coze exact-SHA shadow evidence, isolated canvas-v2 verification and mandatory rollback to legacy. `stable` remains read-only and unchanged.

## 2026-08-14 Stage 3 Task 10 post-review readiness decision

- Independent review found no remaining P0 after owner/revision-bound recovery was added. All review P1 findings are now closed locally: resize immediate save, blob geometry recovery, WebKit model-request churn, local-storage/beacon channel isolation, and double-failure leave confirmation.
- Fresh production-browser evidence after these repairs includes five profiles `5/5` for move, resize, one-step undo/redo and immediate reload; WebKit merge-window `1/1`; Chromium final immediate-reload `1/1`. Evidence gates found no unexpected Console or network errors in the passing attempts.
- Focused hardening regression passes `88/88`. The post-review whole-repository rerun now passes with PostgreSQL enabled; API is `480/480`, component/lib regression exits `0`, TypeScript passes, ESLint is `0 errors / 965 historical warnings`, Doctor is `43/11/0/0`, and the production build generates `116/116` pages.
- Two non-P0/P1 limitations remain explicit: small beacon audit records lack an application-level receipt, and external administrator authorization changes require a refresh signal or page reload. Backend authorization remains authoritative.
- The first governance bootstrap push must exclude `.github/workflows/quality.yml`; only files authorized by the old trusted baseline may enter the bootstrap commit. The complete candidate may be pushed only after the new allowlist exists in the trusted parent commit.
- The first whole-repository rerun exposed S3-TEST-002, a stale source contract for explicit-project workflow hydration. The runtime behavior was intact; the contract now protects the recovery-aware ordering and passes `11/11`, followed by a clean full rerun.
- **Release verdict remains CONDITIONAL / NOT READY FOR STAGE 3 COMPLETION.** Local P0/P1 count is zero, but committed-source browser evidence, main publication, GitHub Actions, Coze exact-SHA provider/billing evidence, isolated canvas-v2 and mandatory legacy rollback remain open. Remote `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` is unchanged and must remain untouched.

## 2026-08-14 Stage 3 main and immutable browser evidence

- Governance bootstrap `d9fde3a` and the complete candidate were pushed as non-force fast-forwards. The verified code/test candidate is `main@afa65eb103bd8fa08d669d4680d068d2c565d341`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` is unchanged.
- S3-TEST-003 was found after publication: the evidence fixture waited for video before context closure and deadlocked teardown. Contract RED was `1/10`; GREEN is `10/10`, and the focused regression is `100/100`.
- A production build from the exact commit passes Chromium/WebKit merge-window deletion and move/resize/undo/redo/immediate reload `4/4`. Every test has screenshot, video, trace, Console and Network evidence; Console errors/page errors and non-benign network failures are zero.
- **Release verdict remains CONDITIONAL / STAGE 3 NOT COMPLETE.** Local and main evidence is closed; GitHub Actions, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, real provider generation and real charge/refund evidence remain required.

## 2026-08-14 Stage 3 CI repair readiness decision

- The current GitHub candidate is not yet releasable: the prior run proved PostgreSQL concurrency but exposed clean-schema seed order and production dependency-audit blockers. The real-P0 browser workflow also lacks its required repository secrets.
- The local repair candidate closes the first two blockers without changing Canvas, provider or billing behavior. A clean isolated PostgreSQL bootstrap plus Chromium `2/2` passes, and the production audit changes from `6 moderate / 15 high` to zero vulnerabilities.
- Fresh static/API/full-test/build evidence exits 0. The Sharp changes are type-only compatibility imports required by the patched dependency and are covered by layer/upscale regression.
- **Release verdict remains CONDITIONAL / STAGE 3 NOT COMPLETE.** Publication requires the trusted-parent governance sequence and a green immutable CI rerun. Paid P0 must remain blocked until real secrets are configured; Coze `shadow -> canvas-v2 -> legacy` and real charge/refund evidence are still mandatory.

### Immutable CI follow-up

- `0ac9068` proves the dependency, static, API, full-test, production-build and PostgreSQL-concurrency gates on GitHub. The overall workflow remains red for evidence-infrastructure reasons, not a passing release.
- The next repair waits for additive core columns and supplies a production-valid CI auth secret. Both have retained RED/GREEN and do not change Canvas, provider, billing or application auth policy.
- **Verdict remains CONDITIONAL / STAGE 3 NOT COMPLETE.** A new immutable CI run must execute all three Canvas matrices; the separately missing real-P0 Secrets and all Coze gates remain blocking.

### `c381d50` immutable matrix decision

- All three mode jobs now reach Canvas assertions, closing the schema/auth infrastructure blockers. Static, API, audit, build, PostgreSQL and Stage 0/1 jobs pass.
- The Canvas matrix is red: `160/180` passed. Open blockers are hosted Chromium performance, an unobserved periodic-sync boundary in the merge-window test, and one shadow WebKit immediate-reload geometry rollback.
- The 55/45 FPS and 100ms save thresholds are not weakened. Coze deployment is deferred until these failures are classified and repaired with retained RED/GREEN evidence.
- **Release verdict: NOT READY.** Real-P0 Secrets, real provider/billing evidence, Coze `shadow -> canvas-v2 -> legacy`, and the open matrix failures remain blocking.

### Post-`c381d50` local classification

- Merge-window synchronization now has an explicit request boundary and passes all five local browser profiles. This closes the local evidence defect without modifying Canvas merge behavior.
- Hosted performance thresholds remain exactly 55/45 FPS and 100ms. The candidate removes full-DOM rescans from the measurement observer; six local desktop Chromium performance cases pass, but immutable hosted evidence is still mandatory.
- Shadow WebKit immediate reload passes the exact scenario six consecutive local runs. Because the immutable run failed once, this remains a rerun-required item rather than a claimed closure.
- **Readiness remains NOT READY.** A new immutable matrix must confirm these classifications; real-P0 configuration and Coze `shadow -> canvas-v2 -> legacy` remain blocking.

## 2026-08-14 Stage 3 latest local candidate readiness

- Candidate base is `main@820b33d669e529e90f61837314b164b3a2119675` on `codex/wj-stable-s3`; `origin/main` matched that base before this uncommitted candidate. `stable` was not checked out or modified.
- Local production `canvas-v2` five-profile matrix passes `60/60` after a clean 15-project reseed. The Firefox/mobile batch-delete undo followed by 100-node continuity passes `4/4` in focused order.
- Production build passes `116/116`; TypeScript, ESLint, full Vitest and three PostgreSQL concurrency files (`4/4`) exit `0`.
- S3-BUG-019, S3-BUG-020 and S3-TEST-007 are locally closed with retained RED/GREEN evidence. The post-review execution `final-local-matrix-p1-barrier-20260814` passes `60/60`. S3-BUG-017 and S3-BUG-018 still require a new immutable hosted run.
- GitHub Actions run `31797149839`, attempt 2 remains RED. The real-P0 job is blocked by missing required Secrets; no mock or skip is accepted as closure.
- **Conclusion: CONDITIONAL / NOT READY.** Do not enter Stage 4/5. Commit/push only the reviewed `main` candidate, then require immutable CI and Coze exact-SHA `shadow -> canvas-v2 -> legacy`, including real provider and billing/refund evidence.

## 2026-08-15 Stage 3 CI RED closure readiness

- S3-BUG-021 and S3-TEST-008 are closed locally with permanent regression coverage. Project sync is serialized, legacy writes use database revision CAS, autosave performs one bounded conflict rebase/retry, and evidence no longer treats an unrelated later request as recovery.
- The rebuilt production `canvas-v2` five-profile matrix `local-final-candidate-r5-20260815` is RED `58/60`, not `60/60`. One Chromium delete/undo failed and one later case cascaded. The other four profiles passed `48/48`; the failure remains retained with Trace, video, Console and network evidence.
- Historical checkpoint: moving the listener to commit-phase `useLayoutEffect` narrowed the input gap and passed its source contract, but exact legacy reproduction on `74268eb` later disproved it as a complete fix. The latest readiness section records the component-lifetime stable-listener candidate and its fresh RED/GREEN evidence.
- The retained `r3` mobile RED was classified from pointer evidence as a covered geometric test point, not waived as flakiness. The unobstructed-point regression passes three consecutive mobile executions before the full `r4` matrix; no business threshold was relaxed.
- This result is local candidate evidence based on `main@f6f40ccbd23e8ee4855717a24e3dca4885475f51` plus the documented worktree patch. It is not yet an immutable GitHub commit or Coze deployment result.
- **Release decision: NOT READY / Stage 3 remains in Task 10.** Required next gates are a main-only fast-forward, immutable GitHub Actions three-mode matrix, Coze exact-SHA `shadow -> canvas-v2 -> legacy` rollout/rollback, and real provider billing/cancel/refund proof. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only.

## 2026-08-15 `a372e9e` immutable run decision

- GitHub Actions run `31866500220`, attempt 2, proves schema setup, authentication and all `180` Canvas cases executed. Static/tests and PostgreSQL concurrency passed. The real-P0 job correctly failed closed because required repository Secrets are absent.
- The three Canvas jobs remain RED solely on `13` desktop-Chromium performance assertions: shadow `55/60`, canvas-v2 `57/60`, legacy `55/60`. No disappeared frame or unclickable-duration regression was reported, but FPS, input P95 and longest-save-task budgets are release gates and cannot be waived.
- S3-BUG-018 no longer blocks after the immutable rerun passed the immediate-reload flow and isolated local shadow Chromium 1080p passed `10/10`. S3-BUG-017 remains OPEN P1 because two hosted attempts missed unchanged commercial thresholds even though exact-source local repeated samples pass.
- S3-TEST-009 and S3-TEST-010 are locally closed with narrow regression tests; neither changes Canvas business behavior or performance thresholds. A new immutable run is required for the evidence-filter commit.
- **Release decision remains NOT READY.** Stage 3 Task 10 stays active; Stage 4/5 remain prohibited. Required closure is hosted performance isolation/fix, new immutable Actions, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, and real provider charge/cancel/refund evidence. `stable` remains untouched.

## 2026-08-15 corrected performance-window decision

- S3-TEST-011 is locally closed: FPS now uses the same first-to-last RAF observation window as its frame count instead of the broader Playwright action duration. Fixed commercial thresholds were not changed.
- Fresh production shadow evidence passes the complete five-profile Canvas matrix `60/60`; both desktop Chromium profiles meet 100/300-node FPS, input P95 and 300-node save budgets with zero disappeared frames and zero unclickable duration.
- This is still an uncommitted local candidate. It does not retroactively turn runs `31866500220` or `31869145512` green and does not satisfy the missing real-P0 credentials, Coze exact-SHA rollout/rollback or real billing/cancel/refund evidence.
- **Release decision: NOT READY.** Next ordered gate is full repository verification, main-only non-force push, then a new immutable three-mode Actions run. `stable` and Stage 4/5 remain prohibited.

## 2026-08-15 post-`c4c02a9` repair readiness

- `c4c02a9` is not a passing immutable candidate. Actions run `31870799781` preserved three-mode RED evidence and exposed one legacy WebKit durability race plus hosted performance margin failures.
- S3-BUG-023 and the S3-BUG-017 hot-path follow-up are locally repaired under TDD. No business feature, Canvas threshold, shadow comparison or continuity assertion was removed.
- Available local gates pass: focused `47/47`, full Vitest `2454` passed, TypeScript, ESLint, production build `116/116`, exact source allowlist and `38/38` protected features. PostgreSQL-gated local tests remain explicitly unverified in this generic environment.
- **Release decision remains NOT READY.** The next commit must be pushed only to `main` and must pass the immutable legacy/shadow/canvas-v2 matrix. Real-P0 Secrets, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, provider generation and authoritative charge/cancel/refund evidence remain blocking. `stable` and Stage 4/5 remain prohibited.

## 2026-08-15 readiness after immutable run `31873152403`

- `main@30fdedc793cf66d45863b01725186f85d681fd0a` is not releasable: canvas-v2 and shadow each passed `54/60`; legacy passed `56/60`.
- The run confirmed three independent blockers rather than one generic flake: hosted desktop performance margin, synchronous immediate-save cost, and a WebKit one-revision unload recovery race.
- The second repair candidate has permanent RED/GREEN coverage and passes local lint, TypeScript, `2458` Vitest tests and the `116/116` route production build. No threshold, continuity assertion or protected product feature was removed.
- PostgreSQL browser concurrency is not available on this workstation and remains an explicit external gate. The real-P0 job still fails closed because required repository Secrets are absent.
- **Decision: NOT READY / remain in Stage 3 Task 10.** Publish only to `main`, keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged, and require a new immutable three-mode matrix before any Coze rollout or Stage 4/5 work.

## 2026-08-15 readiness after immutable run `31875413077`

- `main@74268ebaa14c6843cfdd91e08e32e478ad5347a8` is not releasable: canvas-v2 and shadow each passed `56/60`; legacy passed `53/60`.
- Exact local legacy reproduction separated S3-BUG-022 from hosted performance noise. A dependency-driven DOM keyboard listener was replaced during delete/restore commits and could drop rapid Ctrl+Z input.
- The final candidate keeps one stable DOM proxy listener and updates its current behavior through a ref. Fresh legacy Chromium passes `12/12`, mobile focused regression passes `4/4`, and the unchanged local performance budgets pass.
- Repository gates pass locally, but `44` PostgreSQL tests remain environment-skipped in the generic run. Real-P0 still lacks required Secrets, and no cloud charge/refund proof has been produced.
- **Decision: NOT READY / Stage 3 Task 10 remains active.** Push only a reviewed fast-forward to `main`; do not modify `stable`, do not start Stage 4/5, and require a new immutable three-mode matrix before Coze rollout.

## 2026-08-15 readiness after immutable run `31878749102`

- `main@9d8e7bf73c694d8220472c19e4bad85607da63db` is not releasable: legacy, shadow and canvas-v2 each passed `57/60`; real-P0 remains fail-closed because repository Secrets are absent.
- The local candidate removes one proven full-Canvas React render from standard direct pan and sequences the unchanged immediate-save audit after the authoritative sync. No protected tool, workspace, threshold, continuity assertion, provider route or accounting rule was removed.
- The first independent review rejected the local candidate on two pointer-state ownership issues. Both were converted into runtime/source regressions and corrected; the follow-up independent review returned `APPROVED`.
- Fresh legacy execution `local-owner-safe-legacy-full-20260815` is `60/60`; focused tests are `8 files / 78 tests`; PostgreSQL-enabled full Vitest is `441 files / 2512 tests` with zero skips; TypeScript, ESLint `0 errors / 973 historical warnings`, exact protected-source gate `38/38`, whitespace and production build `116/116` pass.
- **Decision: NOT READY / Stage 3 Task 10 remains active.** Push only a reviewed fast-forward to `main`, keep `stable` read-only, and require the new exact SHA to pass immutable legacy/shadow/canvas-v2. After that, Coze must execute `shadow -> canvas-v2 -> legacy`, followed by real provider charge/cancel/refund proof. Stage 4/5 remain prohibited.

## 2026-08-15 readiness after immutable run `31884790226`

- `main@57b3d7371dd12b63680b484854cd9496d6dc2404` remains not releasable: legacy `57/60`, shadow `58/60`, canvas-v2 `57/60`; real-P0 is fail-closed because required GitHub Secrets are absent.
- The local candidate removes the remaining Space-key parent React transition from standard pan and adds explicit blur/visibility/unmount reset. It does not change Canvas feature behavior, persistence, provider routing, accounting, protected features or fixed performance thresholds.
- Local evidence passes: focused `49/49`; production performance `4/4`; exact previously failed functional cases `2/2` after deterministic reseed; PostgreSQL-enabled full Vitest `2517/2517`; TypeScript; ESLint `0 errors / 973 warnings`; build `116/116`; protected feature/source gate `38/38`; whitespace; independent review `APPROVED`.
- **Decision: NOT READY / Stage 3 Task 10 remains active.** Only a normal fast-forward to `main` is allowed. The new exact SHA must pass immutable legacy/shadow/canvas-v2 before Coze `shadow -> canvas-v2 -> legacy`; real provider charge, cancel and at-most-once refund proof remains mandatory. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` and Stage 4/5 remain untouched.

## 2026-08-15 readiness after `3e46150` immutable CI

- Stage 0/1, PostgreSQL and static/test/audit/build gates are green, but the immutable Canvas matrix is legacy `59/60`, shadow `58/60`, canvas-v2 `56/60`.
- Failures are restricted to hosted desktop Chromium FPS and one canvas-v2 input P95 sample. All functional and continuity checks passed.
- Real-P0 remains fail-closed because the authorized repository Secrets and paid controls are absent.
- **Decision: NOT READY.** Stage 3 Task 10 remains `10/11`; Coze mode switching, Stage 4/5 and any stable-branch change remain prohibited.

## 2026-08-15 readiness of the pointer-up reconciliation candidate

- The remaining local pointer-up bottleneck has a stable reproduction, a RED/GREEN runtime contract and a minimal implementation boundary. The complete local production matrix is `180/180` with fixed thresholds and zero disappeared/unclickable evidence.
- Full local unit/integration/API, TypeScript, zero-error ESLint and production build gates exit 0. These are candidate results, not immutable release evidence.
- **Decision: NOT READY.** A new exact `main` SHA must pass immutable legacy, shadow and canvas-v2. Real-P0 remains blocked by missing authorized Secrets; Coze `shadow -> canvas-v2 -> legacy`, real provider charging, cancellation and at-most-once refund remain mandatory. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` stays untouched.

### Immutable decision for `main@3535268`

- Stage 0/1 and all non-browser Quality jobs are green, but the hosted Canvas modes are canvas-v2 `56/60`, legacy `57/60`, shadow `57/60`.
- **Decision: NOT READY.** The local `180/180` result is not release evidence because the exact hosted SHA failed fixed FPS/input thresholds. Coze and later stages remain blocked.

## 2026-08-15 readiness of the direct-pan pointer-ownership candidate

- Pointer ownership is functionally verified in all five local browser profiles, and three repeated Chromium/300 performance samples meet the unchanged limits.
- One cold Chromium/300 sample still measured input P95 `54.5ms` against the fixed `50ms` gate. It is not suppressed, retried away or reclassified as passing.
- Full Vitest, isolated PostgreSQL concurrency, TypeScript, zero-error ESLint and production build gates pass locally; these permit an immutable candidate rerun but do not replace it.
- **Decision: NOT READY.** Push is permitted only as a narrow `main` candidate after full local gates. Stage 3 Task 10 remains `10/11`; immutable three-mode CI, real-P0 provider/accounting evidence and the Coze rollout/rollback sequence remain mandatory. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` stays untouched.

## 2026-08-16 readiness after immutable `2509fcf`

- `main@2509fcf8b46f5458fcc13dd9b86af606163b161b` is not releasable: hosted canvas-v2 passed `56/60`, shadow `57/60`, legacy `57/60`; real-P0 is still fail-closed on missing authorized Secrets/paid controls.
- The local hover-hot-path candidate preserves media hit testing and all fixed commercial thresholds. The broader pointer-events candidate was rejected after producing measurable unclickable time and is not present.
- Local evidence passes focused `33/33`, five-browser pan behavior `5/5`, canvas-v2 repeated performance `16/16`, shadow `4/4`, and the legacy outlier's exact repeat `3/3`. PostgreSQL-enabled Vitest is `2520/2520`; TypeScript, zero-error ESLint and `116/116` production build pass.
- One legacy local input P95 outlier of `57.7ms` and the prior immutable WebKit timeout remain explicitly recorded; neither was hidden by retries or larger thresholds.
- **Decision: NOT READY / Stage 3 Task 10 remains `10/11`.** Only a normal fast-forward candidate push to `main` is permitted. `stable` remains read-only. The new exact SHA must pass immutable legacy/shadow/canvas-v2 before any Coze `shadow -> canvas-v2 -> legacy` sequence; real provider charge/cancel/at-most-once refund evidence remains mandatory. Stage 4/5 stay prohibited.

## 2026-08-16 readiness after immutable `b4ad786`

- `main@b4ad78684a515e31526d62134ac5995a749db698` remains not releasable. Stage 0/1 and non-browser Quality jobs passed, but hosted canvas-v2/legacy were `57/60`, shadow was `54/60`, and real-P0 failed closed on missing authorized controls.
- The projection-only visibility candidate is deliberately narrow: one runtime CSS declaration removed plus one permanent source regression. Local production evidence is green across 24 desktop performance samples and six exact functional repeats; full tests, TypeScript, zero-error ESLint and build also pass.
- Historical contrary evidence from an older baseline is retained, and no performance threshold, retry count or failure assertion was relaxed. The next immutable exact-SHA run is authoritative.
- **Decision: NOT READY / Stage 3 Task 10 remains `10/11`.** A reviewed normal fast-forward to `main` may be used to obtain immutable evidence. Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged. Do not start Coze mode switching or Stage 4/5 before all hosted modes and real-P0 accounting evidence pass.

## 2026-08-16 readiness after real provider cancellation reproduction

- Real Pear generation on `e9efd5d` proves one successful image and one exact 60-credit charge, but the immediate-cancel scenario proves a P0 release blocker: the late result entered Canvas and the charge was not refunded.
- The narrow local fix and permanent tests pass, as do full Vitest, TypeScript, zero-error ESLint, production build and the `38/38` protected-source gate. PostgreSQL-specific cases remain explicitly skipped because no isolated `POSTGRES_TEST_DATABASE_URL` is present in this workspace.
- The quick-create proxy 404 fallback is also fixed locally without converting terminal business failures into fallback submissions.
- **Decision: NOT READY.** A normal fast-forward candidate to `main` is permitted, but release remains blocked until Coze exact-SHA Chrome evidence proves cancellation terminality, late-result isolation and exactly-once refund. Immutable three-mode CI remains unexecuted due GitHub billing, Stage 4/5 remain prohibited, and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only.

## 2026-08-16 readiness after Coze stale-shell reproduction

- Coze exact source `main@fc190b1214f7ec5a1c3588b2be31a87db29f2337` is not a usable cloud deployment despite root HTTP 200: the cached static HTML references a removed chunk and Chrome reaches the global error boundary.
- The local candidate changes only the root rendering cache boundary and adds a permanent regression. Local production proves `/` and `/simple-chat` are dynamic and return private `no-store` HTML; full PostgreSQL-enabled tests, TypeScript, zero-error ESLint, production build and `38/38` protected features pass.
- Coze exact `main@9a6363f021f7197b3aa5a9cf834c0c1c0419cb67` now passes the targeted cloud acceptance: authenticated Chrome loads the dashboard and `/simple-chat`, current assets are `11/11` HTTP 200, the obsolete `5504` chunk is absent, root HTML is private `no-store`, and `/api/auth/me` remains 200.
- **Decision: NOT READY / Stage 3 Task 10 remains `10/11`.** S3-BUG-032 is closed, but the visible historical blank thumbnail remains open, GitHub Actions billing still prevents immutable runner execution, real-P0 accounting evidence remains absent, and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only. Stage 4/5 stay prohibited.

## 2026-08-16 readiness after `2cefe59` paid cancellation retest

- The Quick Create fallback path works in Coze, but the P0 cancellation gate failed: the browser sent no `/api/cancel-task`, the task completed, one 120-credit charge remained, and no refund was recorded.
- The second candidate changes only the two processing-card cancel controls so pointer-down cannot be captured by Canvas dragging. Focused regression is `23/23`; full Vitest is `2479 passed / 44 PostgreSQL-only skipped`; TypeScript, zero-error ESLint, `113/113` build and protected features `38/38` pass. Cloud accounting evidence is not yet available.
- **Decision: NOT READY.** Continue local verification despite unavailable Actions runners, then push only `main`, deploy the exact SHA and repeat cancellation plus repeated-cancel/refund checks. Keep `stable` unchanged and do not enter Stage 4/5.

## 2026-08-16 readiness after `9e6cfb0` paid cancellation closure

- The exact Coze source now passes the real paid cancellation path in Google Chrome: the browser reaches `/api/cancel-task`, the durable task remains `cancelled`, no late provider result enters Canvas, and the user receives a clear cancellation result.
- Accounting evidence is exact: one `-120` consume, one `+120` refund and restored balance `138`. Repeating cancel through the authenticated API returns the same cancelled task and does not add another refund.
- S3-BUG-033 is therefore closed on the deployed candidate. The exact candidate also passes a fresh isolated PostgreSQL 18 run with `441/441` files and `2523/2523` tests, zero skipped. The current release verdict remains **NOT READY** because the immutable legacy/shadow/canvas-v2 Actions matrix did not run under the billing restriction.
- Continue Stage 3 Task 10 only. Do not modify `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` or start Stage 4/5.

## 2026-08-16 readiness after exact-SHA local three-mode Canvas closure

- `0a34c73479d46e8dff85e3c033a9200765291454` passes the complete local Stage 3 matrix in canvas-v2, legacy and shadow modes: `180/180` real Playwright cases across five browser profiles.
- The new regression gate directly proves that preloaded monitored images do not emit native reloads or `src` rewrites during 100/300-node pan. All modes retain zero disappeared frames and zero unclickable time.
- Repository gates pass with PostgreSQL enabled: `2527/2527` tests, TypeScript, production build, protected feature gate and zero ESLint errors. Independent review reports no Critical or Important findings.
- **Decision: CONDITIONALLY READY FOR `main` CANDIDATE PUSH, NOT RELEASE READY.** Hosted immutable Actions remain unexecuted because GitHub did not allocate runners under the billing limit. Coze exact-SHA regression is still required after `main` is updated. `stable` remains untouched and Stage 4/5 remain blocked.
## 2026-08-18 Stage 4 Task 4 readiness

- Local implementation and full regression are complete, including PostgreSQL task/accounting tests and the five-profile production browser matrix.
- All local P0/P1 Stage 4 Task 4 defects are closed; no threshold, assertion or failed evidence was removed.
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains protected and unchanged.
- GitHub Actions did not run because of external billing; this is an explicit missing independent gate, not a pass.
- The candidate has not yet been validated after an exact-SHA Coze pull, so authenticated cloud workspace transfer and real provider accounting remain required.

**Decision: CONDITIONALLY READY FOR A NORMAL `main`-ONLY CANDIDATE PUSH; NOT YET RELEASE READY.**

## 2026-08-20 readiness after S4-BUG-008 repair

- Coze `2557d67` is not release-ready for project node persistence: the standalone workflow record survives, but direct node mode loses the saved workflow after reload.
- The narrow local candidate synchronizes explicit workflow save with the current project metadata through the existing guarded project-sync path. It does not change login, Canvas media, providers, task execution, billing or `stable`.
- Full local gates pass (`2852` tests, TypeScript, production build, ESLint with zero errors). PostgreSQL-only tests are still explicitly skipped in this workstation run and are not represented as passed.
- Exact Coze `main@016e5d2feb98cb0377fc0475389b10b914c1020f` passed authenticated Google Chrome save/reload restoration: standalone save and project metadata sync both returned HTTP 200, project sync carried the workflow node, and direct node-mode entry after reload restored `1 节点 · 0 连线` with no fresh Console Error/Warning.
- The initial Coze production build was OOM-terminated and briefly served the previous runtime. It was not counted as a pass; acceptance ran only after the later production build completed and port 5000 restarted. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged.
- **Decision: S4-BUG-008 CLOUD GATE PASSED; OVERALL RELEASE STILL NOT APPROVED.** PostgreSQL-only tests skipped on the workstation, immutable GitHub Actions, real provider/accounting and the remaining Stage 4 acceptance matrix are still open.

## 2026-08-20 readiness after cross-workspace and renderer rollout checks

- Canonical `Canvas -> workflow -> standalone chat` transfer is proven in authenticated Google Chrome: both asset transfers returned HTTP 200, the workflow completed, and the returned image rendered in chat.
- Existing-project compatibility now has a local guarded adoption repair for S4-BUG-009, but release readiness remains blocked until a real historical image is migrated in Coze/PostgreSQL and completes Canvas -> workflow -> chat without duplicate assets.
- Shadow renderer parity passed its cloud probe (`data-in-sync=true`). S4-BUG-010 has a local domain-selection repair and permanent integration test, but `legacy` remains authoritative until Coze proves click/edit/save/reload and forced rollback.
- The only authorized chat provider returned `get_channel_failed`, so the paid `chat -> Canvas` front half and current-candidate accounting evidence remain unverified rather than passed.
- The isolated Coze sandbox was restored to `WUJIE_WORKFLOW_RENDERER_MODE=legacy`; root HTTP returned 200 and server delivery reported `legacy`. `stable` was untouched.
- **Decision: NOT RELEASE READY.** Normalized cross-workspace transfer passes, but open P1 compatibility and React Flow selection defects plus provider/accounting evidence prevent Stage 4 completion.

## 2026-08-20 readiness after React Flow v2 selection acceptance and save-race repair

- S4-BUG-010 node and pane selection now passes authenticated Coze Google Chrome acceptance on the `c99fb727` business tree with no Console Error/Warning.
- The same run found S4-BUG-011: immediate property blur plus Save reported success but persisted the previous node label. The failure was reproduced before code changes and is not represented as a renderer pass.
- The narrow local repair passes focused `4/4`, related Stage 4 `83/83`, full Vitest `2858 passed / 70 PostgreSQL-gated skipped`, TypeScript, zero-error ESLint, `114/114` production build and whitespace validation.
- `legacy` was restored and remains authoritative. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` was not changed.
- **Decision: NOT RELEASE READY.** S4-BUG-011 still requires a `main` exact-candidate Coze edit/save/reload/clear/rollback pass. S4-BUG-009 historical asset adoption and real PostgreSQL/provider/accounting evidence also remain open.

## 2026-08-20 readiness after S4-BUG-011 cloud closure

- Coze's business tree exactly matches `main@5a5ee387a49ad592e0f3a80f7de69bbf5de6dbd4`; production build `114/114`, authenticated React Flow v2 edit/save/reload, selection clear, test-data restoration and forced legacy rollback all pass.
- Candidate-start Console Error/Warning count is zero. Historical 404/502 synchronization warnings occurred only during the deliberate service stop/build interval and are retained as downtime evidence.
- S4-BUG-010 and S4-BUG-011 are closed. `legacy` is again authoritative and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` is unchanged.
- **Decision: NOT RELEASE READY.** Stage 4 still requires S4-BUG-009 historical Canvas asset adoption through real Coze/PostgreSQL plus current provider charge/cancel/refund evidence. No V5.8.8 absorption starts before those gates close.

## 2026-08-20 readiness after S4-BUG-009 cloud closure

- A real historical Canvas image completed authenticated adoption, canonical workflow transfer, `3/3` pass-through execution and canonical standalone-chat transfer in the isolated Coze deployment.
- The same asset version was preserved across all three workspaces. Replaying the exact chat return reused the same placement, and full project reload retained the canonical source identity.
- Test-created workflow nodes, the generated Canvas output and the transient upload file were removed. The project again exposes five Canvas images and one empty workflow node. Console Error/Warning count is zero.
- S4-BUG-009, S4-BUG-010 and S4-BUG-011 are now closed. `legacy` remains authoritative; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` is unchanged.
- **Decision: NOT RELEASE READY.** Stage 4 still requires a current real-provider generation/cancellation run proving one charge, monotonic cancellation, late-result rejection and at-most-once refund. Hosted immutable Actions remain a separate unavailable gate. V5.8.8 stays read-only until the Stage 4 provider/accounting gate closes.

## 2026-08-20 readiness after current-provider cancellation/accounting run

- The deployed current candidate passed the business boundary for a real Pear cancellation: one charge, durable `cancelled`, no late Canvas result after 73,895 ms, one refund and no duplicate refund after repeated cancellation.
- The same run found S4-BUG-012, a P2 presentation defect: cancellation emitted a generic non-retryable Console Error and displayed a failure toast. The narrow local fix and permanent regression pass, together with full Vitest, TypeScript, ESLint and production build.
- The current workstation's full run still explicitly skips `70` PostgreSQL-gated tests because `POSTGRES_TEST_DATABASE_URL` is absent. Historical PostgreSQL evidence does not substitute for the current candidate's multi-instance gate.
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains unchanged. V5.8.8 remains a read-only donor and no absorption work starts before the exact-candidate cancellation UI retest and current PostgreSQL gate.
- **Decision: NOT RELEASE READY.** Push the narrow S4-BUG-012 candidate to `main`, deploy it in Coze, repeat the paid cancel flow with zero Console Error and informational cancellation UI, then execute the current-candidate isolated PostgreSQL concurrency suite.

## 2026-08-20 readiness after S4-BUG-013 local repair

- The exact production rebuild did not regress the authoritative task or refund, but project reload revived the cancelled empty placeholder. This is a P1 recovery defect and prevents Stage 4 acceptance.
- The local candidate closes the persistence predicate mismatch without altering providers, billing, active placeholders or ordinary damaged-media recovery.
- Full local gates pass (`2861` tests, TypeScript, zero-error ESLint and `114/114` production build). The `70` PostgreSQL-gated tests remain explicitly skipped and are not represented as passed.
- V5.8.8 remains read-only and absorption has not started. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains outside the change set.
- **Decision: NOT RELEASE READY.** Exact-candidate Coze reload cleanup and PostgreSQL multi-instance accounting remain required before Stage 4 closes.

## 2026-08-21 Stage 4 final readiness decision

- S4-BUG-013 is closed on GitHub `main@8490fc14ec313000da37475627b4a101c8ecb546` and the matching Coze business tree. The cancelled placeholder `gen-ph-1787238934569-0-hmfie8` is absent from two authenticated server snapshots at revisions `5295` and `5305`.
- The earlier apparent resurrection was correlated with three simultaneously open stale project tabs writing the same legacy snapshot. After all surviving tabs loaded the fixed source and only one project tab remained, no further resurrection occurred.
- Local gates remain green: focused `52/52`, full non-PostgreSQL `2862` tests, TypeScript, zero-error ESLint and `114/114` build. The isolated PostgreSQL 18 candidate gate immediately before this client-only hydration change passed `2931/2931`, zero skipped.
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` is unchanged.
- **Decision: STAGE 4 ACCEPTED.** This authorizes the next plan item only: freeze `J:\无界云端0820` as a read-only V5.8.8 donor and build an absorption inventory. It is not authorization for whole-tree replacement or for changing `stable`.

## 2026-08-21 readiness after V588-ADMIN-001 local integration

- The first selective donor item removes fabricated administrator dashboard metrics without changing authentication, task execution, accounting, Canvas, node mode or standalone chat.
- Local evidence is green: focused `4/4`, related administrator `8/8`, full Vitest `2866` tests, TypeScript, zero-error ESLint and production build `114/114`.
- The `70` PostgreSQL-gated tests remain explicitly skipped on this workstation. This item does not touch persistence/accounting, so the prior isolated Stage 4 accounting result remains separate rather than being rerun or relabeled.
- **Decision: LOCAL CANDIDATE READY FOR `main`; NOT YET CLOUD-ACCEPTED.** Pull the exact commit into Coze and verify an authenticated administrator dashboard with empty and real metric states before starting the next absorption ID.

## 2026-08-21 V588-ADMIN-001 cloud API checkpoint

- Coze serves exact `main@1ba98f776b0c19141a9f05343ce7bb23d0c50fb2`; public root health is HTTP 200 with private no-store cache headers.
- An authenticated administrator request to `/api/admin/dashboard-stats?period=7` returned HTTP 200, both metrics-coverage objects, `modelCalls=unavailable`, `providerCalls=unavailable`, an empty model ranking and an empty provider-status projection. The deployed route therefore no longer fabricates `99%` model success or zero-call healthy-provider rows when usage data is unavailable.
- Existing Chrome tabs were discoverable, but both page-control attempts timed out. Browser, extension and native-host diagnostics passed. The UI is deliberately left unverified; API evidence is not being relabeled as browser proof.
- **Decision: CLOUD API PASS / CHROME UI PENDING.** Do not start the next absorption item until the existing preview tab proves the empty states, nullable `—` rendering and zero fresh Console Error/Warning. No new Chrome tab may be created for this acceptance.

## 2026-08-21 V588-ADMIN-001 cloud UI closure

- After the Chrome extension released its stale control session, the same two existing tabs were reused; no new Chrome tab was created and 360 Browser was not used.
- The existing Coze project page exposed no sandbox-disconnect dialog and confirmed `main@1ba98f77`; the existing preview page was hard-refreshed and retained the authenticated administrator session.
- The operations dashboard visibly rendered one `暂无模型调用数据` state and one `暂无提供商数据` state. No `99%` value or fabricated provider-health row was present. Fresh Console Error/Warning count was zero.
- The cloud unavailable-data state did not contain a legitimate unknown-rate row. Rendering `—` for nullable rates remains proven by the permanent focused UI contract rather than by fabricated cloud data.
- **Decision: V588-ADMIN-001 CLOUD ACCEPTED.** Evidence: `docs/testing/evidence/v588-admin-001-cloud-api-2026-08-21.json` and `docs/testing/evidence/v588-admin-001-cloud-ui-2026-08-21.png`. The next authorized item is `V588-ADMIN-002`.

## 2026-08-21 readiness after V588-ADMIN-002 local integration

- The administrator authorization inventory is now an exact 24-route contract. It preserves the current runtime guards and prevents future routes from entering `/api/admin` without an explicitly reviewed authorization form.
- The donor contract's failure on `assets/orphans` was a test-architecture mismatch, not an unguarded production route. Representative API tests prove unauthenticated `401`, non-admin `403` and no protected service invocation on either rejection path.
- Local gates are green: focused `6/6`, related administrator `26/26`, full Vitest `2868` tests, TypeScript, zero-error ESLint and production build `114/114`. The `70` PostgreSQL-gated tests remain explicitly skipped; this test-only item does not alter persistence or accounting.
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` and the read-only donor remain unchanged.
- **Decision: LOCAL CANDIDATE READY FOR `main`; CLOUD ACCEPTANCE PENDING.** The exact commit must be pulled into Coze and representative route behavior verified before `V588-ADMIN-003` starts.

## 2026-08-21 V588-ADMIN-002 cloud acceptance

- Coze is cleanly aligned to exact `main@d220479214a88b45fcd3a9520d220b864d19cb28`; no business rebuild or restart was needed for this test-only item, port 5000 remained HTTP 200 and `stable` remained unchanged.
- The public credential-free administrator orphan route returned `401`. The authenticated administrator dashboard refreshed successfully in the existing Chrome preview tab and exposed the expected live summary/empty states with zero new Console Error/Warning.
- The contract now permanently fails if an administrator route is added, removed or loses an approved guard pattern. Runtime authorization remains owned by the current shared and explicitly reviewed guards.
- **Decision: V588-ADMIN-002 CLOUD ACCEPTED.** Evidence: `docs/testing/evidence/v588-admin-002-cloud-api-2026-08-21.json` and `docs/testing/evidence/v588-admin-002-cloud-ui-2026-08-21.png`. This authorizes `V588-ADMIN-003` only; it does not authorize a donor media subsystem replacement.

## 2026-08-21 readiness after V588-ADMIN-003 local candidate

- The current candidate adds an administrator-only, asset-graph-backed thumbnail backfill and persistent Canvas thumbnail projection without importing the donor's raw directory scanner or process-local lock.
- Local gates are green: focused `57/57`, asset/media `245/245`, full Vitest `2895/2895`, TypeScript, zero-error ESLint and production build `115/115`.
- The full non-PostgreSQL run explicitly skipped `72` PostgreSQL-gated tests. A subsequent isolated PostgreSQL 18.4 run enabled both database gates and passed the entire repository at `487/487` files and `2967/2967` tests with zero skips; the two new authoritative thumbnail tests passed alongside all existing persistence and accounting gates.
- Rollout compatibility is covered: project loading falls back only when the new thumbnail table is the missing relation; other database faults are not hidden. S3 object names now match the public media path used after an instance restart.
- GitHub `main@d941384f3f7abb5c0b7a67d71686e4ebfee24da8` contains the candidate. Coze recovered after an `instance_not_found` probe but still serves an older build without the candidate route; this is retained as infrastructure/deployment evidence and not counted as application verification.
- After Coze pulled `d941384`, unauthenticated route guards passed but authenticated status/dry-run returned `500` because neither Coze build path ran the migration runner. The new build contract applies checksum-managed migrations before building and preserves the fast runtime launcher; full local gates remain green.
- Coze pulled `main@172f38c5454b7fa5a708b61392c47d99e9f46461`. Migration delivery, administrator status, a non-mutating dry-run and two bounded real backfill executions pass in cloud. Durable status ends at two ready variants with no pending, processing or failed rows.
- Canvas project reads remain healthy and stable, but the runtime explicitly reports `assetGraphMode=legacy`; it therefore cannot provide the required thumbnail projection proof. Existing Chrome tabs could not be claimed for screenshot/Console evidence.
- **Decision: BACKFILL CLOUD-ACCEPTED; ADMIN-003 REMAINS CONDITIONAL.** A controlled `asset-v3` projection/reload/original-fallback/S3-recovery run and approved rollback are required before `V588-PROVIDER-001`. `stable` remains unchanged.

## 2026-08-21 readiness after `99d226a4` shadow reconciliation

- Exact Coze source, build and runtime health are verified for `main@99d226a4fa9a1ffe7425e241963f110ec8609055`; `stable` remains `52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- Asset shadow comparison is fully aligned at `6/6`, with zero mismatch, unmigrated, orphan, invalid or failed/missing-checkpoint records. The prior projection-drift release blocker is closed.
- Current data still contains 46 ready and two missing media records, with two missing placements. The doctor therefore correctly reports `releaseReady=false`, `switchAuthorized=false` and blocker `non-ready-current-media`.
- All 17 enabled providers are configuration-ready, but the shared task-event backend remains unconfigured and clients use durable polling. Neither fact is converted into proof of unexecuted paid-provider workflows.
- Authenticated Chrome retained six projects and 48 images and produced zero fresh Console Error/Warning after the deployment settled.
- **Decision: CURRENT SHADOW ACCEPTANCE PASSED / OVERALL RELEASE REMAINS CONDITIONAL.** Do not enable `asset-v3` or start the next donor absorption item by bypassing the two-media doctor blocker. Keep V5.8.8 read-only and `stable` untouched.

## 2026-08-21 readiness correction after physical media probe

- Direct database facts confirm two current versions and two active placements marked `missing`. One is an empty chat-only placeholder; one is an expired Canvas proxy URL. Neither has a storage key or recovery source.
- Browser probes found a third active current version marked `ready` that uses the same expired proxy URL and returns HTTP 404. The earlier `46 ready / 2 missing` summary is therefore accurate only as database state, not as physical media availability.
- The related completed task retains provider/model/prompt metadata but only the expired proxy URL, so exact-byte automatic recovery is unavailable. Regeneration would be a new creative result and cannot be treated as transparent recovery.
- **Decision: NOT READY FOR `asset-v3`.** First close V588-BUG-005 with a deterministic durability gate and an audited administrator remediation path. Do not delete, regenerate or rewrite historical content silently.

## 2026-08-21 V588-BUG-005 durability gate

| Item | Status | Remaining proof |
|---|---|---|
| Deterministic false-ready detection | VERIFIED LOCALLY | Empty or internal proxy-only current media without durable storage/recovery is counted for both current versions and active placements. |
| Release fail-closed behavior | VERIFIED LOCALLY | Either aggregate adds `non-durable-ready-media`; `asset-v3` cannot be authorized. |
| PostgreSQL and repository regression | VERIFIED | `489/489` files and `2992/2992` tests passed with zero skips; validate and build `115/115` passed. |
| Exact Coze deployment | VERIFIED ON `e809f5c` | Coze retained `shadow` and `stable`; build and HTTP health passed. Authenticated readiness reports `falseReadyCurrentVersions=1`, `falseReadyActivePlacements=2` and `non-durable-ready-media`. The unsafe version has two active placements. |
| Historical data remediation | NOT PERFORMED | One empty chat placeholder and two Canvas placements on the shared expired proxy remain. Choose replace, regenerate or archive explicitly. |
| Protected baseline gate | BLOCKED BY STALE BASELINE | Sixteen previously accumulated source-drift entries require an authorized baseline refresh; no allowlist was weakened. |
| Release decision | CONDITIONAL / ASSET-V3 BLOCKED | Exact-SHA cloud proof is complete and current shadow remains usable. Promotion is still prohibited until explicit historical media remediation and the remaining thumbnail/recovery acceptance are complete. |

## 2026-08-22 Task 6 safe-archive readiness decision

**FUNCTIONAL LOCAL GATES PASSED / GOVERNANCE BLOCKED / NOT PUSHED.** Production source remains `86b8e176b2dcb88e3bf4d43ae19c64dc05dc9f54`; test-contract correction `aca74ea33bbaa92eac2566edf502e46656dfcd74` makes no production change. On a migrated PostgreSQL 18.4 database, focused `97/97`, affected `77/77`, and full `492 files / 3066 tests` pass with zero failures and zero skips.

Supporting gates: validate passed; lint passed with `0 errors / 988 warnings`; build passed with `116/116` static pages; whitespace check passed. The protected baseline is independently blocked by `23` unapproved accumulated source-drift paths despite preserving all `38` protected feature IDs, paths, evidence contracts, and refs. Therefore no main push, cloud request, billing action, archive, replacement, regeneration, deletion, or `asset-v3` mode change is authorized until a dedicated baseline authorization review closes that governance gate.

`origin/stable` was fetched and remains `52f7c601ed150769e15d06fb435c6e360e28c9e7`; donor `J:\无界云端0820\pnpm-lock.yaml` remains SHA-256 `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`. Cloud archive, idempotent retry, and `asset-v3` acceptance are **UNVERIFIED**.

## 2026-08-22 protected-baseline authorization decision

**LOCAL GOVERNANCE GATE PASSED / CLOUD ACCEPTANCE NOT STARTED.** The administrator approved exact-path authorization. Commit `34391fbda9ee2dfe7c32c103c1418d0b59361dcb` records 23 paths and their verified source commits, forbids broad directory grants in regression tests, and changes no business code.

The focused gate test passes `7/7`; the actual protected-baseline command passes `38/38` identities with zero warnings and zero blockers. Fresh final verification passes `492/492` files and `3067/3067` tests, validate, full lint (`0` errors / `988` warnings), production build `116/116`, and whitespace checks. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` and the donor lock digest remain unchanged. Only a normal fast-forward push to `main` remains before Coze may pull the candidate. No cloud archive POST or `asset-v3` mode change is authorized by this result.

## 2026-08-22 S4-BUG-014 本地发布结论

- 历史媒体候选覆盖、覆盖不完整失败关闭、健康当前版本保留、并发幂等、事务回滚和 doctor 同口径对账均在隔离 PostgreSQL 上通过。
- 最新完整门禁为：受影响 `108/108`；全仓 `492/492` 文件、`3090/3090` 测试且 0 skip；TypeScript 通过；ESLint `0 error / 988` 条历史 warning；构建 `116/116`；保护基线和空白检查通过。
- 授权清单现在包含 25 个实际审阅的精确路径，其中新增 `media-health.ts` 与 `recovery-media.ts`；未授权 `src/lib/asset-core/` 或其他宽泛目录。
- `stable` 前后均为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`；V5.8.8 donor 未改动。
- **结论：允许建立 `main` 候选并进行云端只读验收，但尚未达到发布通过。** 云端归档 POST、幂等重试、缩略图投影/回退/S3 恢复及 `asset-v3` 切换仍未获验证；归档必须在操作时再次确认。

## 2026-08-22 S4-BUG-014 云端只读发布门禁

- Coze 已精确运行 `main@04a7a9104a96ae74325a76776e831c0e567e362b`，`stable` 未变化，构建与端口健康通过，运行模式为 `shadow`。
- 管理员 Chrome 两轮只读验收完全一致：`4` 个版本、`4` 个活跃 placement、`coverage.complete=true`、`uncoveredBlockingPlacements=0`；其中明确包含 `1` 个非当前坏版本。
- readiness 保持 `releaseReady=false`、`switchAuthorized=false`，迁移和影子对账均为 `6/6`，媒体 blocker 未被隐藏；Console Error/Warning 为 `0/0`。
- **结论：Task 7 通过，但整体仍不具备发布通过条件。** 必须先获得操作时确认，执行一次受控软归档和同 key 幂等重试，再验证 doctor、缩略图投影、刷新恢复、原图回退和 S3 恢复；当前禁止切换 `asset-v3`。

## 2026-08-22 S4-BUG-014 软归档发布门禁

- 管理员已对 Task 7 的 4 个精确候选授权软归档。首次请求成功归档 `4 versions / 4 placements`，同 key 字节级重放复用同一 remediationId；数据库只存在 1 条 ledger 与 1 条 audit。
- 四个版本行均保留并标记不可恢复，四个 placement 为软删除；积分和退款事件均为 0，未创建供应商任务，未发生物理删除。
- 归档后两轮 readiness 均为 `releaseReady=true`、`switchAuthorized=true`、blockers `[]`；候选发现均为 0，迁移和 shadow 项目对账均为 `6/6`。
- Coze 当前进程的管理员 origin 已纠正为带 `-5000` 的精确预览域名，但项目级持久化环境变量仍需在 Coze 设置中修正；仅写 `.env.local` 无法覆盖继承的进程环境。该项属于部署配置风险。
- Coze 工作区存在空提交 `7912fd92948dce96852b6ba57046391ff2386932`，其 tree 与 `origin/main@04a7a9104a96ae74325a76776e831c0e567e362b` 完全一致，不得推送；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- **结论：历史媒体软归档门禁通过，但本任务没有启用 `asset-v3`。** 下一独立发布门禁仍是受控的缩略图投影、刷新恢复、原图回退、S3 恢复和回退验证；正式 V5.8.8 选择性吸收可按既定顺序从 `V588-UI-001` 开始，不得跳到供应商或覆盖当前控制器。

## 2026-08-22 V588-UI-001 本地发布准备度

- 首个 UI 吸收叶子已按 RED、最小接入、聚焦回归、全量回归和生产构建完成本地验证。
- 新叶子只接收状态和命令回调，不拥有画布控制器或工具会话；当前三大工作区、任务、账务、Asset Graph 和供应商适配均未改变。
- 本地证据为 `2988` 项全仓测试通过、TypeScript 通过、Lint `0 error / 988` 条历史 warning、构建 `116/116`、保护基线 0 blocker。
- **发布判定：有条件通过。** 条件是 Coze 拉取最终 exact SHA 后完成 Google Chrome 真实交互与 Console 验证；在此之前不进入下一 UI 项。

## 2026-08-22 V588-UI-001 云端发布判定

- Coze 代码树、生产构建和 HTTP 健康均对应 `main@986f128006c246b400f116da7fb3a5b4c02f0a6c`；本地环境空提交没有代码差异，`stable` 未变化。
- 已登录 Google Chrome 真实验证缩放、重置、三态网格、连线显隐、图层、版本历史、面板互斥和 AI 引擎弹窗；所有状态转换符合当前控制器契约。
- 新鲜 Console Error/Warning 为 0，无原生弹窗；视觉证据未发现工具栏错位、遮挡、裁切或叠加。
- **发布判定：V588-UI-001 通过并完成吸收。** 该判定只覆盖首个叶组件，不代表整个 V5.8.8 UI 批次完成，也不授权 `asset-v3` 切换。下一发布门禁为 `V588-UI-002` 的 RED、最小接入、本地全量回归和云端验收。

## 2026-08-22 V588-UI-002 本地发布准备度

- 命令面板已完成 RED、最小接入、聚焦回归和全量本地门禁；没有替换当前 Canvas 控制器，也没有删改既有入口。
- 本地证据：聚焦 `18/18`、全仓 `3004/3004`；TypeScript 通过；Lint `0 error / 988` 条历史 warning；构建 `116/116`；保护基线 `38/38`、0 blocker。
- `18` 个 PostgreSQL 文件共 `105` 项测试因本机未配置隔离库而明确跳过；本项不涉及持久化与账务，仍保留该环境事实。
- 实现来源提交为 `8acb3c9`，新增路径已精确授权；`stable@52f7c601`、donor 和 `shadow` 边界未改变。
- **发布判定：有条件通过。** 条件是 Coze exact-tree、生产构建/HTTP 健康及已登录 Google Chrome 全交互和 Console 验收；通过前不得标记吸收或进入 `V588-UI-003`。

## 2026-08-22 V588-UI-002 云端发布判定

- 最终候选 `main@1681b2b80a5afdbb23c710616a3b9cd99fd47e71` 已由 Coze 精确拉取；构建退出码 `0`、5000 端口监听、首页 HTTP `200`，`stable@52f7c601` 与 `WUJIE_ASSET_GRAPH_MODE=shadow` 未变化。
- 命令面板在最终 SHA 上完成 Google Chrome `30/30` 项真实交互，包含最终修复的图层与版本历史入口、面板互斥、输入保护、状态恢复和视觉检查。
- 新鲜 Console Error/Warning、`[CanvasToolSession]` 错误及浏览器原生弹窗均为 `0`；截图未见裁切、错位或不可读叠加。
- **发布判定：V588-UI-002 通过并完成吸收。** 该结论只覆盖命令面板叶组件；整体发布仍受已登记的 `asset-v3` 投影/回退等独立门禁约束。下一发布门禁为 `V588-UI-003` 的 RED 与最小接入。

## 2026-08-22 V588-UI-003 小地图发布判定

- 最终云端验收提交为 `main@efe5e4f16ac3c8a0c7ed6b8fc73cba48af6fd6b2`。本地已完成 RED、最小接入、聚焦回归、全仓 TypeScript、零错误 ESLint、生产构建和保护基线；全仓 Vitest 为 `499` 个文件（`481` 通过、`18` 跳过）和 `3143` 个测试（`3038` 通过、`105` 跳过）。跳过项为未配置 `POSTGRES_TEST_DATABASE_URL` 的既有真实 PostgreSQL 门禁，不计为通过。
- Coze 工作区与 `origin/main` 精确一致，Next.js `16.2.11` 生产构建为 `116/116` 页面、退出码 `0`，首页和鉴权健康接口 HTTP `200`；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- 发布契约为：桌面默认关闭；偏好键 `wujie.canvas.minimap.open.v1`；宽度 `<768px` 或可用宽度 `<560px` 隐藏；关闭态零小地图遍历/投影；点击导航保持 zoom；矩形无缩略图/网络；工具按钮与命令面板入口、暗色/黑白主题和右侧面板避让均受本地回归保护。
- Google Chrome「用户1」复用现有标签页完成 26/26 项真实交互和响应式矩阵。300 节点真实拖动画布与小地图导航均保持节点完整、zoom 不变；最终健康窗口 Console error/warning、`[CanvasToolSession]` 错误、原生弹窗和失败网络请求均为 `0`。机器证据及截图位于 `docs/testing/evidence/v588-ui-003-cloud-2026-08-22.*`。
- **发布判定：V588-UI-003 通过并完成吸收。** 该判定只覆盖小地图叶能力、大画布空闲同步修复和对应云端验收；整体发布仍受 PostgreSQL 专项及其他独立未验证项约束。下一唯一吸收项为 `V588-UI-004`。

## 2026-08-23 V588-UI-004 本地发布准备度

- 六个展示叶和入口完整性已完成本地 RED -> GREEN；375/768/1440 与 reduced-motion 的 E2E 矩阵已建立并补齐 768px 编辑面板循环。
- 本地门禁：聚焦 `65/65`、全仓 `3075 passed / 105 PostgreSQL-gated skipped`、TypeScript、零错误 Lint、生产构建 `116/116`、保护基线和空白检查通过；独立复审 `0/0/0`。
- 本地缺少 E2E 凭据与 PostgreSQL，Playwright 实际结果为 `2 skipped`；不能据此宣称布局、动作或浏览器错误门禁通过。
- **发布判定：有条件通过。** 独立审查已为 `0/0/0`，`main` 普通快进且 `stable` 未变；剩余条件为 Coze exact SHA 运行健康，以及现有 Google Chrome 标签页中的全矩阵和 Console/网络/dialog 零错误证据。
- `main` 普通快进和 `stable` 不变已关闭；当前唯一 UI004 阻塞为 Coze 拉取/运行健康与 Google Chrome 云端矩阵。Chrome 能发现正确现有标签，但接管项目页和预览页均超时，不能据此宣称云端通过。

## 2026-08-23 V588-UI-004 远程图片编辑修复发布判定

- 修复前 Coze `362d350` 的真实 Google Chrome 证据确认擦除、蒙版和调色无法读取 Pear CDN 图片；这是 UI004 云端矩阵中的 P1，不是模型不可用或错误选择素材。
- 修复候选 `main@3becee8b54d9cc6320b137c4070e129cbed06ffe` 已通过安全下载、图片源、编辑面板、全仓 TypeScript、全仓零错误 ESLint、`3086` 项 Vitest 和生产构建；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变。
- 105 个 PostgreSQL 集成/并发用例仍因本机无隔离库跳过；本次改动不触及数据库或账务，但跳过事实不计为通过。
- **发布判定：有条件通过，仅允许作为 `main` 云端验收候选。** 必须由 Coze 拉取 exact `3becee8`，重新构建并在同一 Google Chrome 项目图片上证明 `/api/image/source` HTTP 200、三处图片自然尺寸非零、擦除/蒙版可绘制、调色预览可见、其余五个面板无回归，并确认新鲜 Console/网络/dialog 门禁后，才能关闭 UI004。

## 2026-08-23 V588-UI-004 最终发布判定

- 精确云端候选为 `main@8c936cac777f5b05cfb381c73e929c13a5341efd`，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰；干净生产构建、5000 端口、根路由和新图片代理路由均已实际核对。
- Google Chrome 仅复用已打开的 Coze 项目页和预览页，未使用 360，未新建标签。擦除、蒙版和调色均以真实 Pear 图片完成源图加载验证；擦除/蒙版笔迹、调色滑杆和可见预览已通过。
- 浏览器新鲜 Console error/warning 和原生 dialog 均为 0；本次不创建付费编辑任务，未更改任务、供应商、积分或退款逻辑。
- **UI004 专项发布判定：通过。** 全平台仍为有条件通过，因 `POSTGRES_TEST_DATABASE_URL` 缺失导致的 105 项真实 PostgreSQL 集成/并发测试仍未验证。

## 2026-08-23 V588-SAFETY-001 发布判定

- exact 云端提交为 `main@d968ad3448c9a3202f462959baaa89dab5f471cd`，Coze 干净构建、根路由、鉴权健康和 8 个实际引用静态资源均通过；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- 真实大图明确触发同步 WASM，预算日志、成功终态、结果节点、SVG 实际下载和并发健康均有机器证据；未使用 AI 管线成功结果冒充 fallback 验证。
- 预算后的 `627x418=262086` 不超过 `262144`，输出仍保留原始逻辑尺寸 `1536x1024`。80 次并发健康探针全部 HTTP 200，浏览器新鲜 Console error/warning 和 dialog 为 0。
- **V588-SAFETY-001 专项发布判定：通过并完成吸收。** 全平台仍为有条件通过：105 项 PostgreSQL 集成/并发测试及其他业务未验证项继续保留。下一唯一吸收项为 `V588-AUTH-001`。

## 2026-08-23 V588-AUTH-001 发布判定

- 本地实现提交为 `b0cd946f`；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。认证持久化、旧凭据精确迁移、跨进程副本锁、真实注销和页面卸载时 SSE 清理已完成最小修复。
- 真实 PostgreSQL 认证门禁、全仓测试、API 测试、回归测试、Doctor、TypeScript、零错误 Lint 和生产构建均通过；已执行测试无失败。最终生产浏览器管理员/普通用户矩阵为 `10/10`，覆盖 Chromium、Firefox、WebKit 和移动端。
- 全仓仍有 `113` 项非认证 PostgreSQL 环境测试跳过；API 有 `3` 项、回归有 `8` 项环境测试跳过，这些不计为通过。隔离夹具没有真实付费供应商配置，因此图像/视频生成、取消、积分扣除与退款一致性不能由本次认证矩阵替代。
- **专项发布判定：本地通过，云端有条件通过。** 必须先把最终 main 精确 SHA 拉取到 Coze，在现有 Google Chrome 标签页复验管理员和普通用户登录、刷新、三个工作区、退出及退出后数据隔离，且确认新鲜 Console/网络错误门禁，才能将 `V588-AUTH-001` 标记为已吸收。
- **全平台发布判定仍为有条件通过。** 本次关闭本地认证 P0，不代表其余 PostgreSQL、付费供应商、任务取消和账务终态门禁已经关闭。

## 2026-08-24 V588-AUTH-001 云端发布判定

- exact candidate：`main@42e540bd5aa552f10af0e12240546993bda3e91a`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- Coze 生产构建退出码 0，5000 端口由 `next start` 提供服务，根路由与 12/12 静态脚本均 HTTP 200。
- 冷启动后已存在管理员 session 保持有效，项目 8 个、图片 447 张正常恢复；认证、管理员用户、项目读取与项目写同步接口均业务成功，未再出现 `AUTH_CONFIGURATION_UNAVAILABLE`。
- 本次缺陷所需本地 TDD、真实 PostgreSQL 和全仓门禁通过；非认证 PostgreSQL 默认跳过项、普通用户云端重复矩阵和真实 secret 轮换仍保留为独立边界。
- **发布结论：有条件通过。** V588-AUTH-001 可标为“已吸收（同 secret 云端冷启动已验证）”，但不得声称真实 secret 轮换或整个产品发布门禁全部通过。

## 2026-08-24 GPT Image 2 原生透明 PNG 发布判定

- 隔离候选基于 `origin/main@6102572bc6ff90e20ef522c79bc5c0b846f7cde7`，`stable` 未触碰。所有主要生图入口已统一接入背景输出合同，透明请求固定为 PNG；不支持透明的模型会在扣费和供应商提交前明确拒绝。
- 结果端不信任文件名或供应商声明，而是逐张解码验证 Alpha 通道。伪透明棋盘格和全不透明 PNG 会返回明确状态；系统不会静默调用去背景或制造第二次任务和扣费。
- 本地全仓 Vitest `3337 passed / 114 PostgreSQL-gated skipped / 0 failed`；TypeScript、零错误 ESLint、生产构建和空白检查通过。构建暴露的字境 API 非法辅助导出已通过独立任务存储模块最小修复并回归。
- 真实付费 Playwright 测试已定义并覆盖五个浏览器项目，但本地缺少真实凭据、精确 GPT Image 2 提供商配置与付费开关，未调用真实供应商。因此没有用 Mock 或静态合同冒充真实 Alpha 结果。
- **专项发布判定：本地通过、云端有条件通过。** 必须部署精确候选后完成真实 GPT Image 2 请求、任务终态、画布落图、下载 PNG Alpha 字节、`n>1` 逐张结果和单次扣费证据，才可标记专项发布通过。
- **全平台发布判定仍为有条件通过。** `114` 项 PostgreSQL 专项及其他已登记业务未验证项不因本次透明输出功能而自动关闭。

## 2026-08-24 V588-PROVIDER-005 Task 11 发布判断

**结论：不通过。** 当前只能判定为本地候选，不能发布或标记“已吸收”。

已取得的证据：

- doctor、TypeScript、Lint、全仓 Vitest、API 回归、组件/库回归、生产构建、保护基线与空白检查均退出 0。
- 全仓 `3372` 项通过；API `716` 项通过；组件/库回归 `2407` 项通过；生产构建 `116/116`。
- 管理员能力编辑、精确目录、扣费前拒绝和五类前端消费端已有自动化合同。

仍阻止发布的证据缺口：

- 本项能力并发持久化已在一次性 PostgreSQL 18 隔离集群 `1/1` 通过；全仓其他 PostgreSQL 专项的默认跳过仍保持独立未验证，不能由本项替代。
- 未提供本地真实登录凭据，Chromium/Firefox/WebKit 的能力 E2E 共 9 项跳过。
- 未执行真实付费图像、视频、一次扣费、非法请求零扣费和任务终态核验。
- 未形成 Coze exact-SHA、管理员重启持久化、五入口、稳定域名、Console、Network、Trace 与截图证据。

 只有 Task 12 全部证据闭环且 P0/P1 为 0，才可把本项改为“通过”。

## 2026-08-24 原生透明 PNG 与能力矩阵合并发布判定

- 原生透明 PNG 已先进入 `main@36a986fcb74b2d16313a349600a4022c71b482e0`，随后把 `V588-PROVIDER-005` 重放并解决冲突，当前本地候选为 `93253e6f981a2c6cc4403c9c5615e7044c7db62e`。透明字段、Alpha 验证、精确供应商模型路由和能力准入同时存在。
- 新鲜本地证据：联合专项 `126/126`（另 1 项 PostgreSQL 环境跳过），全仓 `3419 passed / 116 PostgreSQL-gated skipped / 0 failed`，TypeScript、Doctor、零错误 Lint、`116/116` 构建和保护门禁通过。
- `origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 与只读 V5.8.8 donor 均未变化。
- **发布判定：有条件通过，仅允许普通快进进入 `main` 作为云端验收候选。** Coze exact-SHA、管理员保存/重启、普通用户五入口、真实 GPT Image 2 Alpha、真实图像/视频、单次扣费和非法请求零副作用仍是阻塞项；本地通过不等于云端专项通过。

## 2026-08-24 Coze 最终候选运行判定

- 当前发布候选已从“等待 Coze exact-SHA”推进为：Coze `main`、本地 `main` 与 GitHub `origin/main` 均精确为 `0adbd5ee5b8e32e3987ddf0ccb9f09dd816f5f4d`。
- 云端生产构建退出码 `0`；5000 端口最新监听 PID `2547`；根路由、认证健康接口和 HTML 引用的全部 `11` 个静态资源均为 HTTP `200`。
- `origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 与只读 V5.8.8 donor 未变化；没有数据库迁移、账号、供应商或业务数据变更。
- **当前结论仍为有条件通过，不建议发布。** 原因不再是部署版本或静态资源，而是现有 Google Chrome 标签重新接管超时，导致真实 Alpha、能力矩阵、任务终态和账务证据尚未取得。不得把基础设施健康扩大解释为 Stage 4 全通过。

## 2026-08-24 `4711501b` 发布准备度复核

- GitHub 和本地 `main` 已对齐 `4711501bdeb059a16d404184ef38c0956a57fb06`，`stable` 保持 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- 干净工作树完整本地门禁通过：Doctor、TypeScript、零错误 ESLint、生产构建和 `3420` 项 Vitest；`116` 项 PostgreSQL 专项因缺少隔离库跳过，继续视为未验证。
- 当前 Coze 预览返回 `instance_not_found`，Chrome 页面控制动作超时；新候选尚未取得 exact-SHA 运行、真实 Alpha、逐张回图和账务证据。
- **发布判定：有条件通过，仅限本地集成候选；云端发布不通过。** 不允许用旧 `0adbd5ee` 的运行证据替代 `4711501b`，也不允许在 Stage 4 关闭前把原生透明 PNG 或 `V588-PROVIDER-005` 标记为已吸收。

## 2026-08-24 `4e99aa33` 尺寸映射修复发布判断

- 云端旧候选真实证明 Pear `gpt-image-2` 的 `1K` 被错误写入 `size`，使透明 `n=2` 在任务创建与扣费前返回 400；该问题不是供应商不可用。
- 本地修复、TDD、严格类型检查、改动文件零错误 Lint、真实 E2E 发现和生产构建均通过；GitHub `main` 已包含 `4e99aa33`，`stable` 未变化。
- Coze 项目标签在 Google Chrome 中可枚举，但标签接管连续超时；因此尚未拉取新提交，也没有取得 Alpha、逐张回图、任务终态和账务证据。
- **发布判定：不通过。** 当前只能作为云端验收候选；Coze exact SHA 与真实付费闭环完成前，不得发布或宣称原生透明 PNG 已通过。

## 2026-08-24 S4-BUG-017 空白尺寸归一化发布判断

- Coze 已精确运行 `3c8fd1ca` 并通过构建、启动、首页和鉴权健康检查；现有 Google Chrome 预览页也已强制刷新并保留管理员登录。
- 同一真实 Pear `gpt-image-2` 透明双图请求仍在能力准入阶段被空白 `size` 拒绝，证明 S4-BUG-016 的前端映射修复尚不足以形成可发布闭环；拒绝发生在任务和扣费之前。
- 空白可选尺寸已在统一数据边界归一化；本地聚焦、全仓、严格类型、零错误 Lint 和 `116/116` 构建通过，未修改模型授权、供应商配置、任务状态或账务语义。
- **发布判定：不通过。** 新修复提交、Coze exact-SHA、真实透明 `n=2` 两任务、逐张回填、两份 Alpha、恰好两笔扣费和无隐藏 RemoveBG 全部取得证据前，不得关闭 Stage 4。

## 2026-08-24 Stage 4 透明生成与能力持久化发布判断

- 真实 Pear `gpt-image-2` 透明 `n=2` 已形成两个唯一任务、逐张回填、两份真实 Alpha PNG 与恰好两笔扣费证据；无隐藏 RemoveBG 或重复账务。本项从未验证改为云端通过。
- 管理员能力持久化在同一云端验收中暴露 P1：历史 `selected_models JSONB` 与新代码 `TEXT[]` 编码不兼容，接口曾错误返回成功。修复提交 `d56844b4` 已通过 PostgreSQL 双结构和全仓门禁，但尚未在 Coze 保存、刷新、重启后复验。
- **发布判定仍为不通过。** 当前不再由透明生成阻塞，而由管理员能力持久化云端复验、普通用户五入口、非法参数零副作用、真实视频及原计划未关闭项阻塞。

## 2026-08-24 管理员能力持久化关闭后的发布判断

- `main@22a24c0f` 已在 Coze 对图像与视频能力字段完成保存、整页刷新、沙箱重启和原值恢复；历史 JSONB 与当前字段编码兼容性获得真实云端证据。
- 稳定供应商抽样为 `PearAPI 图像` 与 `Apimart视频`，所有临时字段均已恢复为空；未调用虚宝、4SAPI 或 FHLAPI 模型，也未改变供应商启停、密钥、授权或账务。
- **管理员能力持久化 P1 已关闭，但 Stage 4 发布判定仍为不通过。** 剩余发布阻塞为普通用户五入口、非法能力请求的零任务/零扣费证据，以及一次真实 APIMART/Pear 视频终态和单次扣费。

## 2026-08-24 视频完成态修复后的发布判断

- 真实 Pear 视频任务已证明供应商链路能完成且账务只扣一次，但旧部署在最终投影阶段显示 `MEDIA_UNAVAILABLE`，属于 P1 用户结果不可用，不是供应商模型不可用。
- 本地最小修复、两轮独立复审整改与全量门禁已通过：聚焦 `42/42`、扩展视频回归 `87/87`、全仓 `528 files / 3445 tests`、TypeScript、Lint `0 errors / 970 historical warnings`、Next.js `116/116`。构建边界同时排除本地 `_refs-*` 只读参考仓库和 `.playwright-cli` 缓存，未把这些目录纳入产品或提交。
- **发布判定仍为不通过。** 新候选完成 Coze exact-SHA 拉取、历史卡片/新任务播放、刷新恢复、下载与单次扣费复验之前，S4-BUG-018 不得关闭；普通用户五入口和非法能力零副作用仍独立阻塞。

## 2026-08-25 视频播放控件修复后的发布判断

- `main` 与 `origin/main` 已精确为 `fb6741853272b43a4e36e046511900f031ab758f`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未修改。
- 历史视频在上一云端候选已完成真实媒体加载，但播放按钮被画布指针捕获。新提交以失败测试和一行事件隔离修复；全量 `3446` 项 Vitest、TypeScript、零错误专项 Lint 与 `116/116` 构建通过。
- Chrome、扩展、原生通信和现有标签枚举诊断均正常，但 Coze 项目页与预览页仍由旧控制会话占用，重新接管持续超时。因此 `fb674185` 尚未被 Coze 拉取，播放时间推进、刷新恢复、下载哈希和无重复扣费均未取得新候选证据。
- **发布判定仍为不通过。** Stage 4 继续停留在视频云端最终验收、普通用户五入口和非法能力零副作用；不得开始新的 V5.8.8 donor 吸收项。

## 2026-08-25 视频下载云端关闭后的发布判断

- `main@f19ab16441c8ef632124fb12afb1d94ad2200d2f` 已在 Coze 完成构建、精确 PID 重启、HTTP 健康与 Google Chrome 真实回归；`stable@52f7c601...` 保持只读。
- 历史视频完成媒体加载、播放时间推进、刷新恢复和真实 MP4 下载；下载文件为 783,768 字节、`ftyp/isom`、SHA-256 `30E6CF78...A6927B5C`，没有下载 404 或 `Download failed` 控制台错误。
- 本地视频专项、TypeScript、零错误专项 Lint 与生产构建通过；全仓仍有 1 项既存源指纹超时，117 项 PostgreSQL 门禁未执行。下载动作前未单独采集积分快照，故不把无新增扣费扩大为独立账务通过。
- **发布判定仍为不通过。** 视频展示、播放、刷新与下载不再是当前发布阻塞；剩余阻塞为普通用户五入口、非法能力请求零任务/零扣费、PostgreSQL 专项及既有未关闭项。Stage 4 未整体完成，不能开始新的 donor 吸收项。

## 2026-08-25 Stage 4 能力目录专项关闭后的发布判断

- 普通用户五入口和非法能力前置拒绝已在 Coze `main@1ec32f49` 的 Google Chrome 真实会话通过；非法 `n=5` 请求没有新增应用任务、积分流水或累计消耗。
- 结合此前已关闭的管理员能力持久化、Pear 原生透明 PNG `n=2`、逐张回填、真实 Alpha、两笔准确扣费，以及 Pear 视频终态/播放/刷新/下载，`V588-PROVIDER-005` 的云端吸收条件已满足。
- 本轮没有修改生产代码；融图数量菜单的初始失败由未关闭的视频浮层造成，复核后功能正常，避免了基于误报的回归性修复。
- **当前发布判定仍为有条件通过，不是全平台正式发布通过。** Stage 4 能力目录专项已关闭并允许进入下一 donor RED；全平台仍保留 `117` 项 PostgreSQL 环境门禁及既有未关闭业务/安全项，不能由本专项扩大解释为全平台无 Bug。
- 下一项固定为 `V588-PROVIDER-001` 的只读精确模型映射差异与失败测试；继续只改 `main`，不触碰 `stable`。

## 2026-08-25 V588-PROVIDER-001 关闭后的发布判断

- `main@3c597cd9a4c14dfeb851ad06670c49b3158a7d49` 已完成本地 RED/GREEN、全量回归、生产构建和 Coze exact-SHA 运行验证；Google Chrome 普通用户图像与视频目录精确名称断言 `5/5` 通过。
- 该变更只影响缺少管理员/供应商显示名时的 fallback 映射；管理员名称优先、精确 `providerId + modelId` 授权、能力目录、任务和账务边界均未改变。
- 云端稳定重载后的 Console error/warning 为 `0/0`，原生弹窗为 `0`；服务切换期的单次 `502` 同步 warning 已单独保留，不能算作稳定窗口错误，也没有被删除。
- **专项判定：V588-PROVIDER-001 可发布并已吸收。全平台仍为有条件通过。** 现有 `117` 项 PostgreSQL 环境门禁和既有未关闭业务/安全项仍然存在；本次无付费生成，不证明供应商任务或账务链路。`stable` 与 donor 继续只读。
- 下一实施边界为 `V588-CHAT-001` 至 `V588-CHAT-004`，必须分别按失败测试、最小接入、全量回归和云端验证执行；当前不能标记任何一项已引入。

## 2026-08-25 V588-CHAT-001 本地吸收后的发布判断

- `717f3eab` 与 `29ef29b4` 已完成共享严格 SSE 解析器和 `simple-chat` 三入口最小接入；未引入 donor 的会话、任务、同步或不安全原始 URL 桥接，也未改变供应商、模型、积分和媒体所有权。
- 本地 RED/GREEN、关联 `56/56`、全仓 `3485` 项断言、TypeScript、零错误 ESLint、`116/116` 构建和 `38/38` 受保护功能门禁通过；`117` 项 PostgreSQL 测试因缺少完整隔离库继续明确跳过。
- **专项判定：本地有条件通过，云端尚未验收。全平台仍为有条件通过。** 当前不能把本地流解析覆盖扩大为真实供应商流、CanvasEditor 定点替换或 Deep Research 终态通过；Coze 三入口和浏览器健康证据完成前不得进入 `V588-CHAT-002`。

## 2026-08-25 Simple Chat 模型菜单加固后的发布判断

- V5.8.8 的顶部栏层叠修复已按当前架构选择性吸收；当前实现还补齐任务级模型单一数据源、精确模型快照和失效历史图片隔离，没有复制 donor 的旧会话所有权。
- 本地聚焦 `43/43`、全仓 `3508/3508` 已执行断言、TypeScript、零错误 Lint、Next.js `116/116` 构建、保护基线与空白检查均通过；`117` 项 PostgreSQL 专项因缺少隔离数据库保持未验证。独立复审确认运行时 Critical/Important 为 `0/0`，文档证据已更新为最终候选结果。
- **专项判定：模型菜单子项已在 Coze Google Chrome 通过。** `main@9a3fcb63` 的桌面、412px、375px、320px 均证明两个列表位于视口内、可滚动和可点选；320px 二次裁切缺陷已由失败测试和最小修复关闭。模型请求一致性与三入口流式终态仍未完成，因此 `V588-CHAT-001` 整体不关闭，全平台维持有条件通过。
- 部署切换后的首次刷新再次进入 `ChunkLoadError` 全局错误边界；确认当前 chunk 已 200 后第二次刷新恢复。该问题不推翻菜单通过结论，但 `S3-BUG-032` 应按复发证据重新保持开放，正式发布仍需原子切换或旧静态资源保留策略。

## 2026-08-25 Simple Chat 错误终态加固后的发布判断

- CanvasEditor 与 Deep Research 丢失供应商 `type:error` 的问题已按 RED/GREEN 最小修复；普通对话逻辑、精确 `providerId + modelId`、会话所有权和账务均未改变。
- 本地聚焦 `14/14`、Simple Chat 相关 `102/102`、全仓 `3513/3513` 已执行测试、TypeScript、零错误 Lint、Next.js `116/116` 构建和保护基线 `38/38` 通过；`117` 项 PostgreSQL 专项仍因缺少隔离数据库未执行。
- **专项判定仍为本地有条件通过，V588-CHAT-001 不关闭。** 必须先将新提交部署到 Coze，并完成普通对话、CanvasEditor、Deep Research 三条真实 APIMart 链路及浏览器健康证据。全平台继续维持有条件通过。

## 2026-08-25 V588-CHAT-001 云端发布判断

- Coze `main@e0c091dd` 已由 Google Chrome 普通账号完成 APImart 真实验收；普通对话、CanvasEditor 局部修改、Deep Research 均使用精确 `providerId + modelId`，各只有一次请求并取得 HTTP 200、SSE `done` 与真实 UI 终态。
- CanvasEditor 证明选区外文本不变；Deep Research 证明阶段提示会进入最终报告；新会话不会继续携带历史损坏图片。模型菜单不被消息遮挡，Console error/warning 和原生弹窗均为 0。
- 云端没有人为制造供应商失败；真实错误保真和迟到流隔离仍以本地自动化证据为准。该边界已写入机器报告，不把成功路径扩大为未执行的故障注入。
- **专项判定：V588-CHAT-001 通过并允许进入 V588-CHAT-002。全平台仍为有条件通过。** `117` 项 PostgreSQL 环境门禁、部署期旧 chunk 保留及其他既有未关闭项不因本专项通过而自动关闭；`stable` 继续只读。

## 2026-08-25 V588-CHAT-002 本地发布判断

- 消息级 `streaming/completed/failed`、版本化冻结上下文、刷新中断恢复、普通/联网/Deep Research 原位重试及 CanvasEditor 冻结选区重试已完成最小接入。
- 应用内同一消息 ID、同一响应 ID、同一附件引用和同一幂等键已由自动化验证；API 会向上游透传稳定键，但不能据此承诺所有第三方文本供应商执行严格 exactly-once。
- 聚焦 `71/71`、全仓已执行断言 `3531/3531`、TypeScript、零错误 ESLint 和 Next.js `116/116` 构建通过；`117` 项 PostgreSQL 专项因缺少隔离测试库继续未验证。
- **专项判定：本地有条件通过，云端尚未验收。全平台仍为有条件通过。** Coze 必须完成真实可控失败、原位重试、刷新恢复、Deep Research 单 Artifact、CanvasEditor 单成功版本及 Console/网络证据后，才能把 V588-CHAT-002 标记为已吸收。

## 2026-08-25 V588-CHAT-002 首轮云端故障注入判断

- Coze 已运行包含 `origin/main@7bf1cc3c` 的干净 `main@8096833c`，生产构建、116 个静态页、5000 进程和三个健康路由均通过；`stable` 未触碰。
- 短时离线可稳定得到单一失败消息和专用重试入口。修复前会放大的遥测递归已在最终候选上消失：`/api/client-error=0`，只有聊天、审计、用户同步各 1 次失败尝试，本次控制台时间窗为 `0 error / 0 warning`。
- 普通原位重试在上一候选已有同消息成功、单请求与幂等 Header 证据；本次最终候选已点击重试，但 Chrome 控制连接在供应商等待期间超时，未取得完成 UI 和请求快照，因此不能用代码等价推断代替最终候选实测。
- **专项判定：部分云端通过，全平台仍为有条件通过。** `V588-CHAT-002-BUG-002` 可关闭；`V588-CHAT-002-BUG-001` 仍需补齐普通终态、Deep Research 单 Artifact、CanvasEditor 单版本和刷新中断恢复，完成前不得进入 `V588-CHAT-003`。

## 2026-08-26 V588-CHAT-002 刷新中断发布判断

- 真实 Chrome 刷新测试确认旧云端构建存在 P1：请求只提交一次、消息已入库，但刷新后回到项目第一条旧任务，目标助手消息至少 238 秒保持 `streaming`。
- 本地已用失败测试锁定任务身份缺口，并最小增加 `taskId` URL 持久化与精确恢复；关联 Simple Chat 回归 `33/33` 通过。
- 完整本地门禁已通过：全仓 `541` 个文件、`3535` 项已执行测试通过；`20` 个文件、`117` 项 PostgreSQL 专项因缺少隔离库跳过；TypeScript、ESLint `0 errors / 967 historical warnings`、Next.js `116/116` 构建、证据清单与空白检查均通过。
- **专项判定：本地候选通过，但当前仍不通过云端关闭门禁。** 必须提交 `main`、Coze 精确拉取和同场景再次刷新，证明同一任务显示单一可重试失败或已完成终态，才可关闭该缺陷。`stable` 与 V5.8.8 donor 继续只读。

## 2026-08-26 V588-CHAT-002 刷新中断首次新云端复验判断

- `da1f5c4` 已证明精确任务身份恢复：同一 Chrome 标签刷新前后 URL、项目、任务和测试标记保持一致，没有回到旧对话，也没有重复请求或重复消息。
- 发布门禁仍未关闭：数据库中的助手消息继续为 `streaming`，只有页面展示层显示可重试失败。该状态违反“服务器终态必须可恢复且可审计”的验收条件。
- 第二轮最小修复把中断恢复提前到项目装载边界；本地 `3536` 条已执行测试、类型、零错误 Lint 和 `116/116` 构建通过，`117` 条 PostgreSQL 隔离测试仍明确跳过。
- **专项判定：不通过云端关闭门禁。** 必须部署第二轮候选，并用同一刷新场景确认 PostgreSQL 持久状态为 `failed` 或合法 `completed`、消息和请求仍各一份。全平台继续为有条件通过，`stable` 与 donor 只读。

## 2026-08-26 V588-CHAT-002 刷新中断第二候选发布判断

- `origin/main@3ecd2f9b` 的代码树 `eb205aae` 已在 Coze 生产构建运行，健康路由与 12 个静态资源全部通过；`stable@52f7c601` 未变化。
- 历史遗留任务和全新 APImart `deepseek-v4-flash` 流式任务都证明：同一任务身份在刷新后保留，服务器权威助手状态收敛到 `failed`，错误可重试，部分正文、单一用户消息和单一助手消息均可恢复。
- **专项判定：V588-CHAT-002-BUG-003 通过。全平台仍为有条件通过。** V588-CHAT-002 尚有 Deep Research 单 Artifact、联网重试和第三方 exactly-once 能力边界，不能因刷新缺陷关闭而整体宣布完成；PostgreSQL 隔离测试的 117 项跳过及部署期旧 chunk 门禁也继续保留。

## 2026-08-26 V588-CHAT-002 最新发布判断

- 联网模式的真实离线失败、单一原位重试、冻结模型配对、相同幂等键、HTTP 200 完成终态和消息唯一性已经由 Google Chrome 与服务器权威快照证明，联网子项可关闭。
- Deep Research 完成态真实暴露“正文完成但 Artifact 为 0”的 P1 缺陷；`main@90772d42` 已按 RED/GREEN 最小修复，并通过全量测试、TypeScript、零错误 Lint 和生产构建。
- Coze 沙箱现为 `instance_not_found`，未运行 `90772d42`。因此不能用本地通过替代刷新前后单一 Artifact 的云端证据。
- **专项判定：候选代码本地有条件通过，V588-CHAT-002 与全平台仍为有条件通过。** 云端恢复后必须精确部署 `90772d42` 并完成同任务刷新前后 UI、服务器 Artifact 数量及浏览器健康复验。

## 2026-08-26 V588-CHAT-002 Deep Research Artifact 最终发布判断

- Coze `main-fix@1572a222` 已包含 `90772d42`，构建与 5001 健康检查通过；`stable@52f7c601` 和 V5.8.8 donor 保持只读。
- APImart `deepseek-v4-flash` 的真实 Deep Research 报告已进入 `completed`；刷新前后 UI 与服务器均只保存同一个 `msg_1787715525319-research` Artifact，消息数量保持 2，Console error/warning 和原生弹窗均为 0。
- 4 个 Simple Chat 受保护源码路径已用各自真实实现提交完成精确来源登记；来源校验 `7/7`，保护门禁 `38/38` 且 0 warning，没有目录级放行。
- **专项判定：V588-CHAT-002 应用侧通过，允许按吸收清单进入 V588-CHAT-003。全平台仍为有条件通过。** PostgreSQL 隔离测试的 117 项跳过、部署期旧 chunk 和其他既有未关闭项不因本专项通过而自动关闭；第三方供应商 exactly-once 仅在供应商明确支持时才能声明。

## 2026-08-27 V588-CHAT-003 本地候选发布判断

- 任务基线为 `9e05cf0881d0d64af4ba96311837885ac77b3c33`，最终复审修复后的本地实现候选为 `5663441a30c279d5a696235020dae5d47cc0703d`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未修改。
- 修复前阶段完整门禁通过：全仓 Vitest `3906 passed / 118 skipped / 0 failed`，API `765 passed / 3 skipped / 0 failed`，回归 `2887 passed / 10 skipped / 0 failed`，Next.js 构建完成 `116` 个静态页面/路由。跳过测试没有被计为通过。
- 独立 Task 8 复审为 Spec COMPLIANT、Task quality APPROVED，Critical/Important/Minor `0/0/0`；复审后聚焦合同 `13/13`、保护基线 `38/38`、TypeScript 与目标 ESLint 通过。
- Playwright 仅发现五项目共 `70` 项，没有真实执行。由于缺少本地真实浏览器凭据、专用次账号和 `POSTGRES_TEST_DATABASE_URL`，真实浏览器矩阵、跨账号隔离与 PostgreSQL 并发保持 `UNVERIFIED`。
- 全分支终审发现 1 个 Critical 旧服务端存储键迁移缺陷；`5663441a` 保留历史 `data_key='chat_simple_projects'` 和按用户 advisory lock，并把旧数组 revision `0` 在原行升级为 revision `1`。
- 修复专项 RED `2 failed / 10 passed`；GREEN 单元 `12/12`、Simple Chat API `28/28`，`ts-check`、目标 ESLint、保护基线 `38/38` 与 `git diff --check` 通过。PostgreSQL 迁移和并发测试 `2/2 skipped`，原因是缺少 `POSTGRES_TEST_DATABASE_URL`，不得宣称通过。
- 窄范围复审为 Ready to merge: Yes，Critical/Important/Minor `0/0/0`。
- **专项判定：V588-CHAT-003 本地候选完成 / 云端待验 / 未吸收；全平台仍为有条件通过。** Coze 尚未拉取和运行精确候选，真实项目/任务操作、多标签冲突、删除不复活、离线恢复、账号隔离、退出前同步及 PostgreSQL 最终快照均无云端证据。不得据此宣称云端通过，也不得提前进入 `V588-CHAT-004`；其他既有未关闭项继续保留。

## 2026-08-27 V588-CHAT-003 构建修复发布判断

- `e64edbbe` 在 Coze 真实构建失败，原因是云端嵌套工作树被 TypeScript 重复纳入；因此该 SHA 不具备 Coze 可部署性，不能进入业务验收。
- `11abb548` 已用真实目录形态夹具证明 TypeScript、ESLint 和 Git 边界隔离，完整本地门禁通过且无业务源码改动。
- **专项判定：本地构建候选通过，云端发布仍为有条件通过。** 必须先完成 GitHub/Coze 精确 SHA、构建、启动、健康与静态资源复验，再执行 V588-CHAT-003 业务矩阵；`stable` 保持只读。

## 2026-08-27 V588-CHAT-003 Coze 构建关闭后的发布判断

- `origin/main@48c2ad3f` 已完成 Coze 生产构建与启动，Build ID `8Iztiwokck9HEnxplOf78`；`/`、`/simple-chat`、`/api/auth/me` 与 12 个静态资源均为 HTTP 200，数据库配置存在。
- Coze 平台生成的本地元数据提交与 `origin/main` 代码树一致，不进入 GitHub；后续部署同步使用 `fetch + reset --hard origin/main`，不触碰 `stable`，也不使用 `git clean` 清理运行数据。
- **专项判定：构建阻断关闭，允许继续 `V588-CHAT-003` 云端业务矩阵。Stage 4 已验收且不再作为进行项；全平台仍为有条件通过，不能把构建健康扩大解释为项目同步、并发冲突或 PostgreSQL 已通过。**

## 2026-08-27 V588-CHAT-003 首轮业务矩阵发布判断

- 普通对话完成、同步状态、刷新恢复、项目与任务重命名已取得真实 Chrome 证据，且没有 Console error/warning 或原生弹窗。
- `V588-CHAT-003-BUG-001` 已由 `b92998dafd289a433232eb72cddacef32a53ea28` 完成云端回归：首次进入工作台、未点击聊天页签时即显示真实 `2` 个项目，进入页签后计数仍为 `2`，Console 与原生弹窗均为 0。
- **专项判定：仪表盘计数缺陷已关闭，但 `V588-CHAT-003` 整项仍为有条件通过 / 未吸收。** 删除不复活、离页冲刷、多标签冲突、跨账号隔离和 PostgreSQL 并发仍未闭环；禁止跳入 `V588-CHAT-004`，`stable` 继续只读。
- 已同步专用任务的深链恢复及“工作台”返回路径也已通过：历史标记唯一、同步状态正确，路由没有绕回登录页或无限画布。未同步写入的离页冲刷仍不得据此标记通过。

## 2026-08-27 V588-CHAT-003 PostgreSQL 发布判断

- 全新 PostgreSQL 18.4 首轮门禁真实暴露核心用户表前置迁移缺失，完整结果为 `558/570` 文件通过、`3935/4029` 测试通过、`87` 失败、`7` 跳过；该结果已登记，未隐藏或放宽。
- `f923b98fd51088c68ad2390052634f2d013fbdc6` 以可追加迁移补齐基线，并把核心表初始化缓存绑定到数据库 URL；没有改写已发布迁移、降低授权校验或触碰 `stable`。
- 最终真实 PostgreSQL 全仓为 `570/570` 文件、`4030/4030` 测试通过，失败和跳过均为 `0`；Doctor、TypeScript、零错误 Lint、构建 `116/116`、保护基线与空白检查均通过。
- **专项判定：本地 PostgreSQL 门禁通过，整体仍为有条件通过。** 必须先将精确候选推送 `main`、由 Coze 拉取并完成冷启动、认证、Simple Chat 历史项目恢复和浏览器健康复验；删除不复活、未同步离页冲刷、多标签冲突和跨账号隔离仍保持未关闭。

### Coze 冷启动复验后的发布判断

- `main@4793f602` 已在 Coze 完成受控迁移、构建与启动，Build ID `ff5BAPW-3ycPVraxauIYN`；三个健康路由和 11 个静态资源全部 200，`stable` 未变化。
- 专用 Simple Chat 项目、精确任务、唯一消息标记、模型、“已同步”及仪表盘 `2` 个项目均在 Google Chrome 刷新后恢复。
- 首次返回工作台出现一次同步 502 警告，后续操作未复现且无数据丢失。该警告不被隐藏，也不足以单独证明持续性故障。
- **专项判定：V588-CHAT-003 的 PostgreSQL 与精确 SHA 冷启动门禁通过；整项仍为有条件通过。** 删除不复活、未同步离页冲刷、多标签冲突和跨账号隔离尚未全部取证，不能进入 V588-CHAT-004。

### 删除/离页边界与 Simple Chat 页面完整性发布判断

- 专用空任务删除后刷新与重新进入均未复活；严格 `pagehide` 测试中的唯一用户消息在立即离页后完成服务器同步并在再次刷新后保持唯一。两项云端边界通过。
- 严格离页没有恢复助手生成，当前只能证明“用户写入不丢失”，不能证明“供应商任务离页续跑”；多标签和跨账号仍受现有环境约束未验证。
- 新发现 `V588-CHAT-003-BUG-003`：关闭的图像模型列表仍占约 `2415px` 几何高度，导致隐藏滚动容器自动滚动 `518px`，侧栏、顶部栏和历史消息离开可视区。数据没有缺失，Console 也没有报错。
- 两处关闭态改为 `hidden` 的最小修复已通过 RED/GREEN、Simple Chat `493/493`、全仓已执行项 `3912/3912`、TypeScript、零错误 Lint、`116/116` 构建和 `38/38` 保护门禁。
- `main@483ee0ce` 已在 Coze 精确构建运行；Chrome 证明关闭菜单时根容器 `scrollHeight=clientHeight=863`、`scrollTop=0`，输入框聚焦不再偏移。两个菜单打开后仍位于消息上方，图像菜单内部滚动有效。Console 无应用 error/warning，原生弹窗为 0。
- **专项判定：页面完整性缺陷已云端关闭，全平台仍为有条件通过。** `V588-CHAT-003` 尚有多标签、跨账号和离页后助手任务续跑边界未验证；不得把本次布局通过扩大解释为整项吸收，`stable` 保持只读。

### V588-CHAT-003 最终云端发布判断

- 原始同步规格不要求后台聊天任务队列。离页中断的前台流式助手消息在刷新后收敛为唯一 `failed + retryable`，用户消息仍唯一且已同步，符合既有恢复合同；该行为不再被误写为未验证的后台续跑能力。
- 复用两个现有 Google Chrome 标签完成真实并发：不同任务自动合并，同一任务并发修改保留远端版本并生成明确“冲突副本”，两端刷新后的任务集合和同步状态完全一致。
- 从普通用户 `canvas-user` 切换到真实管理员 `Mr.joker` 后，普通用户专用项目均不可见；管理员只读取自己的项目。应用 Console error/warning 为 `0/0`，没有原生错误弹窗。
- 本项此前已通过真实 PostgreSQL 全仓 `570/570 files / 4030/4030 tests`、Coze 精确冷启动、项目/任务 CRUD、刷新恢复、删除不复活、离页冲刷和页面完整性门禁。
- **专项判定：V588-CHAT-003 通过并完成吸收，允许进入 V588-CHAT-004。全平台总发布结论仍为“有条件通过”**，因为其他清单项、部署旧 chunk 及非本项未验证能力不随本项关闭而自动通过。机器证据：`docs/testing/evidence/v588-chat-003-final-cloud-matrix-2026-08-27.json`。

## 2026-08-27 V588-CHAT-004 首轮云端发布判断

- 精确候选 `main@3f0564429ae100448d17343b5d18ccf58b933e9d` 已在 Coze 构建、重启并由 Google Chrome 验收；`stable` 未触碰。
- 文本、托管图片、同用户跨项目、已有导入工作流追加、重复消费、刷新恢复、来源追踪和既有画布转移均有真实云端正向证据；畸形参数安全拒绝也已验证。
- 带既有连线的普通工作流已通过追加前后及刷新快照，名称、节点、连线和 80% 视图保持。
- 普通账号向自有项目转交成功；向管理员项目的真实云端交接 API 返回 HTTP 403 与 `FORBIDDEN`，服务端授权边界通过。
- URL-only 未托管媒体尚无真实云端证据。
- **专项判定：V588-CHAT-004 为本地候选完成 / 云端部分通过 / 未吸收；全平台继续“有条件通过”。** URL-only 剩余边界关闭前不得进入下一吸收项，也不得把当前已管理素材链路扩大解释为所有历史媒体通过。

## 2026-08-27 V588-CHAT-004 最终发布判断

- URL-only 旧格式样本由正式版本化同步接口创建并在验收后清理，没有直接数据库注入或 Mock。
- Google Chrome 用户1真实证明：未托管历史图片不能“添加到画布”；发送到节点模式时只保留文本，不产生图片节点或画布图片。
- 解析接口返回 `images=[]` 与 `UNMANAGED_IMAGE_SKIPPED`，响应、目标工作流和目标项目均不含外部 URL；服务端解析器不存在远程下载调用。
- 重复转交与刷新没有重复节点，测试数据已清理；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- **专项判定：V588-CHAT-004 通过并完成吸收，允许进入清单中的下一独立叶项。全平台发布结论仍为“有条件通过”**，因为 `NODE-003` 及其他既有未关闭项不会随本项自动关闭。机器证据：`docs/testing/evidence/v588-chat-004-final-cloud-matrix-2026-08-27.json`。
## 2026-08-28 V588-STABILITY-002 发布判断

- 本地候选完成：受控媒体、用户级模型授权、显式模型不回退、45 秒总截止、严格输出、持久幂等、数据库租约接管、`after()` 托管结算、PSD 专用事务超时和客户端单付费请求均已进入当前主线架构。
- 最终本地门禁为专项 `131/131`、全仓 `4068 passed / 119 skipped / 0 failed`、TypeScript、目标文件零警告 ESLint 与 Next.js 117 页生产构建通过；八轮独立复审最终无 Critical/Important。
- 真实 PostgreSQL 并发门禁未执行，因为没有配置专用 `POSTGRES_TEST_DATABASE_URL`；生产数据库不会被冒充为测试库。
- Coze 尚未拉取精确候选，未取得真实 PearAPI/APIMART 视觉调用、同键复用、积分变化、失败退款和 PSD 下载文件证据。
- **专项结论：有条件通过 / 本地候选完成 / 云端未吸收。** 云端矩阵关闭前不得将 `V588-STABILITY-002` 标为“已吸收”，也不得提前开始 `V588-ADMIN-004`。
- 全平台总发布结论继续为：**有条件通过**。

## 2026-08-28 V588-STABILITY-002 图片预览入口云端关闭发布增量

- 真实 Coze Chrome 复现表明：`4c7dc72d` 首次选中图片时 DOM 目标切换，旧 `MouseEvent.detail` 双击判断无法打开图片预览，阻断 Pro/Studio PSD 入口。
- `main@6bea240f` 已以 pointer-up 序列识别完成最小修复；聚焦 `16/16`、全仓 `4071 passed / 119 skipped / 0 failed`、TypeScript 和 `117/117` 构建通过。
- 当前 Google Chrome 扩展可以发现 Coze 项目页和预览页，但页面级读取与操作持续超时，因此尚未让 Coze 拉取精确提交，也没有真实双击后的预览弹窗证据。
- **专项结论保持：有条件通过 / 云端未吸收。** 不得用本地回归替代 Coze UI，也不得在图片预览入口未关闭前执行付费 PSD 分析并宣称全链路通过。
## 2026-08-28 V588-STABILITY-002 图片预览入口发布增量

- Coze 精确运行包含双击修复的 `main@2e1e21e`，生产运行树已确认；`stable` 与只读 donor 未变化。
- Google Chrome 真实图片单击选择、双击单次打开预览、关闭预览、拖动不误开及撤销恢复均通过；PSD Pro 入口可见；Console error/warning 与原生弹窗均为 0。
- “预览必须同时显示 Pro/Studio 两个按钮”不是已批准规格：本项明确不调整导出 UI，当前预览 `PSD` 按钮固定执行 Pro，Studio 属于既有 PSD 编辑器导出能力。
- **专项结论仍为有条件通过。** 图片预览入口阻断已关闭，但真实供应商分析、一次扣费、同键重放、失败退款和 PostgreSQL 并发终态证据仍是发布门禁。

## 2026-08-28 V588-STABILITY-002 PostgreSQL 发布增量

- 本地已用全新 PostgreSQL 18.4 隔离库执行 PSD 幂等、扣费、终态竞争和退款一致性测试；全仓数据库运行 `587/587 files`、`4193/4193 tests`，失败和跳过均为 0。
- 新测试已加入 GitHub `postgres-concurrency` 工作流，质量契约 `12/12` 通过；后续提交不能在遗漏该门禁的情况下通过契约测试。
- 本地默认约 4 GiB Node 堆构建 OOM，8 GiB 堆构建通过 `117/117`。因此源码可构建已有证据，但默认堆资源风险仍需保留，不能描述成所有构建环境无条件通过。
- 受保护基线检查确认 38 个功能 ID、受保护组件路径和证据合同均存在，但旧基线 `7fdc0108` 到当前 `HEAD` 的 18 个历史源码漂移仍未进入允许清单，因此门禁保持 BLOCK；本轮差异未修改这些生产源码，也未放宽门禁。
- **专项结论继续为有条件通过 / 未吸收。** 本地 PostgreSQL 门禁已关闭；云端真实 Pro PSD、供应商结果、一次扣费、同键重放、失败退款和下载文件仍未关闭，不能进入 `V588-ADMIN-004`。

## 2026-08-28 V588-STABILITY-002 Pro PSD 真实复现增量

- Google Chrome 已实际点击图片预览 `PSD`：旧云端提交缺少幂等 Header，主接口 400、兼容接口 501；随后下载的是本地回退 PSD，不是供应商成功，未观察到可计费 taskId。
- 本地候选已把入口接到共享异步分层客户端，移除 15 秒截断，按图层原始尺寸物化持久化 URL 并保留偏移；共享客户端失败后不会再发起第二个远程任务。该修改没有触碰认证、模型目录、画布状态、`stable` 或 V5.8.8 donor。
- 完整回归为 `588/588 files`、`4195/4195 tests`，真实 PostgreSQL 无跳过；TypeScript、零错误 ESLint 和 8 GiB 生产构建 `117/117` 通过。
- **专项结论仍为有条件通过 / 未吸收。** 必须先推送 `main`、由 Coze 拉取并重测真实供应商、一次扣费、进度、下载图层和错误反馈；同键重放及失败退款继续独立保留。

## 2026-08-28 V588-STABILITY-002 Pro PSD 本地终审发布增量

- 可计费分层入口已具备按源独立恢复记录、WebCrypto 摘要、Web Locks 跨标签互斥、代次防旧写、provider/model 冻结和 taskId 直连恢复；缺少任一关键浏览器能力时失败关闭到本地 PSD，不会在无法证明幂等时调用供应商。
- 远程裁剪图层使用真实源尺寸和单次绝对偏移；编辑器显示、命中和最终 PSD 组装口径一致，Studio 远程路径保留阴影与效果组。
- 最终聚焦回归 `10 files / 80 tests`；全仓真实 PostgreSQL 为 `588/588 files`、`4213/4213 tests`，失败与跳过均为 0；发布级 Lint 与 TypeScript 检查均退出 0。8 GiB 堆生产构建以 `0` 退出，webpack 编译约 `13.7min`，静态页面 `117/117` 生成；约 4 GiB 默认堆的既有 OOM 资源约束仍保留。
- 独立代码复审未发现 P0/P1 阻断，但这不是云端供应商成功证据。
- **发布结论保持“有条件通过 / 未吸收”。** 只有 Coze 拉取精确新 SHA 后，真实 Pro PSD 证明应用 taskId、同任务恢复、供应商阶段、最终图层、一次扣费、同键重放和失败退款，才能关闭本项。

## 2026-08-28 ac8e826b 云端部署准备度增量

- Coze 已精确运行 `main@ac8e826b34f91649c47cefd504d9d6664ee12eb8`，代码树与 `origin/main` 一致；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- 生产构建退出码 `0`，Build ID `VALgz1-sdVe-tiy5Jz8yU`；5000 PID `4372`。根路由、Simple Chat、鉴权及 11 个静态资源均通过。
- Google Chrome 已登录预览可恢复节点模式和画布，真实图片双击预览与 `PSD` 入口已走到付费提交前。元素拆解“可编辑图层”只作探索，不作为本项付费验收入口。重启窗口的同步 502 后续已恢复，不存在当前持续错误证据。
- **发布结论仍为有条件通过。** 远程 ZIP Range、PSD 提取、远程图层、一次扣费、同键重放和失败一次退款仍未执行；V588-STABILITY-002 不得标记已吸收，也不得进入 `V588-ADMIN-004`。
- 机器证据：`docs/testing/evidence/v588-stability-002-ac8e826b-cloud-deploy-2026-08-28.json`。

## 2026-08-28 Pear 真实失败回退后的发布结论

- 真实付费任务已证明：应用任务可建立、远端 taskId 可持久化、供应商失败可收敛到本地回退、PSD 可下载、一次扣费与一次退款一致。
- 本次 Pear 没有返回制品 URL，故 `ac8e826b` 的 1 MiB Range 下载、ZIP 主 PSD 选择、远程图层提取仍未获得云端成功证据。
- 下载到的 `Image_pro (3).psd` 是可解析的本地回退文件，不是远程 Pear 制品；不得用它把 V588-STABILITY-002 标记为已吸收。
- **发布结论保持“有条件通过”。** 当前不是代码回归失败证据，而是供应商本次任务失败导致成功路径仍未闭环；在真实 ZIP 成功前不进入 `V588-ADMIN-004`。

## 2026-08-28 Pear 失败诊断发布增量

- 当前 Pear `image-layered` 请求和轮询协议已与官方文档逐项核对，没有通过改端点或重试来掩盖供应商失败。
- 新候选会保留供应商 `error.code/type/param/message`，并在智能回退完成后继续保留诊断；敏感响应体、密钥和图片内容不会进入任务结果。
- 本地全仓非 PostgreSQL 4099 项、TypeScript、ESLint 和 8 GiB 堆 `117/117` 生产构建通过；默认约 4 GiB 构建 OOM 的资源约束仍保留。
- **发布结论继续为“有条件通过”。** 该补丁可以提升部署后的故障归因，但不能替代远程 ZIP/PSD 成功、同键重放和显式取消退款的真实云端证据；`V588-STABILITY-002` 仍未吸收。

## 2026-08-28 ca356477 云端发布增量

- Coze 已精确运行 `main@ca3564779685be52f1dc13b8f0106f27095647f9`；代码树与 `origin/main` 一致，`stable` 与 V5.8.8 donor 未触碰。
- 两组 Pear 非付费专项 `23/23`、生产构建、单服务启动、三个健康路由和 `11/11` 静态资源通过。Google Chrome 干净刷新后登录项目恢复且 Console error/warning 为 `0/0`。
- 本次部署没有提交真实 Pear 任务。结构化错误只能在下一次自然供应商失败时确认；远程 ZIP Range、非 depth 主 PSD、远程图层、同键重放和显式取消退款仍缺真实证据。
- **发布结论继续为“有条件通过”。** `V588-STABILITY-002` 仍未达到吸收完成条件，不能开始 `V588-ADMIN-004`。
- 机器证据：`docs/testing/evidence/v588-stability-002-ca356477-cloud-deploy-2026-08-28.json`。

## 2026-08-28 ca356477 云端同键重放发布增量

- 历史失败回退任务以相同摘要和幂等键重放后返回同一应用 taskId；同键数据库记录仍仅 `1` 条。
- 重放前后余额 `403` 不变，唯一扣费/退款流水及 Pear 远端 taskId 均不变，未观察到重复供应商任务或重复账务。
- **发布结论继续为“有条件通过”。** 云端同键重放门禁已关闭，但远程 ZIP/PSD 成功、至少 2 个远程可编辑图层、真实结构化自然失败与显式取消一次退款仍未满足，因此 `V588-STABILITY-002` 仍未吸收，不能开始 `V588-ADMIN-004`。
- 机器证据：`docs/testing/evidence/v588-stability-002-ca356477-idempotency-replay-2026-08-28.json`。

## 2026-08-28 a50fcbeb 取消竞态发布增量

- `a50fcbeb73803b9886bab2ec82327c1e8f5bb209` 已关闭客户端任务注册窗口：取消不再抢先中止未知 taskId 的提交；响应不确定时复用原幂等键、图片、引擎及冻结后的 provider/model（含空目标）。
- 外部卸载与前台取消复用同一 Promise；只在取消失败后串行 keepalive 重试，成功后主动 abort 原轮询。`completed/failed/timeout` 不再伪装为 `cancelled`。
- 本地质量门禁：全仓 `4117/4239` 通过、`122` 项因缺隔离 PostgreSQL 测试库跳过、`0` 失败；ESLint 0 error、TypeScript 通过、最终生产构建退出码 0、`117/117` 页面完成；独立代码复审 Critical/Important 均为 0。
- `origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。Range 三项并行加固已经在祖先提交 `ac8e826b` 中，无需再次合并；其余四个旧候选分支不满足直接合并条件。
- **发布结论保持“有条件通过”。** 当前提交适合作为 Coze 验收候选，但在 exact-SHA、真实提交后立即取消/关闭、单次扣费与最多一次退款、远程 ZIP/PSD 成功前，`V588-STABILITY-002` 仍不得标记已吸收。

## 2026-08-29 Pear 图层顺序候选发布结论

- Pear 默认 ZIP 不是本次最终失败根因：真实任务已进入 `downloading-psd` 后的 `checking-quality`，证明 ZIP 与主 PSD 解析链路已经运行。
- 云端取得 taskId 后立即取消已收敛为唯一 `cancelled`，积分净变化为 0；真实 ZIP 任务的质量失败也退款回基线。
- 本地已修正 Pear PSD 从上到下堆栈被错误正向绘制的问题；独立复审发现的混合来源边界也已通过新增 RED/GREEN 关闭，本地分层顺序保持不变。全仓 `4154` 项通过、`122` 项 PostgreSQL 环境门禁跳过、0 失败；8 GiB 生产构建完成 `117/117`。
- **发布结论仍为“有条件通过”。** 候选可推送 `main` 并进入 Coze 验收，但在真实任务 `completed/ready`、至少 2 个远程可编辑图层、一次成功扣费和刷新恢复通过前，不得把 Pear 分层或 `V588-STABILITY-002` 标为已吸收。

## 2026-08-29 `940a0b7f` 云端运行门禁

- Coze、GitHub 与本地 `main` 已精确一致为 `940a0b7fdabd9327b75d3b8963c5eee4ec3b0f8c`；生产构建、单实例启动、三个 HTTP 健康端点、`11/11` 静态资源和 `53/53` 非付费分层专项通过。
- 现有 Google Chrome 标签刷新后保持登录并可进入 Pear 可编辑图层入口；本轮没有创建真实 Pear 任务，没有扣费或退款。
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 与只读 V5.8.8 donor 均未变化。
- **发布结论仍为“有条件通过”。** exact-SHA 阻塞已解除，但远程成功终态、2+ 可编辑图层、成功账务和同键零重复仍缺真实证据；`V588-ADMIN-004` 暂不启动。

## 2026-08-29 Pear 远程图层成功增量

- `main@940a0b7f` 的真实 Pear `Image-Layered` 任务已从 5% 进入 UI `completed/100%`，并打开包含 5 个图层的 PSD 编辑器。独立选择、显隐和隐藏校正层后仍保留底层重建画面的验证通过。
- 这关闭了 BUG-007 的云端质量误拒绝：真实 ZIP/主 PSD 已能越过质量门禁并形成实际可操作图层，不再停在 `LAYER_QUALITY_FAILED`。
- 同时发现 P2 BUG-008：完成任务对象强制保持元素拆解浮层可见。该问题已按 RED -> 最小修复完成本地 `64/64` 专项回归；全仓 `4154 passed / 122 PostgreSQL-gated skipped / 0 failed`、TypeScript、零错误 ESLint 和 `117/117` 生产构建通过，但尚未部署。
- **发布结论保持“有条件通过”。** 尚缺成功任务的数据库一次扣费且不退款证据、PSD 导出、图层拖动和 BUG-008 云端回归；这些边界关闭前不把整个 `V588-STABILITY-002` 扩大为完整发布通过。

## 2026-08-29 Pear 成功结论纠正增量

- 管理员云任务与账务数据确认，所谓成功任务实际是 `failed/LAYER_QUALITY_FAILED/refunded`；先前显示的 5 层不能再归因于该 Pear 任务。
- ZIP 下载、主 PSD 选择和 PSD 解析已通过，但 Pear 将 `3504x2336` 输入输出为 `1280x1280`，生产质量门禁正确拒绝，远程完整还原尚未通过。
- 已定位并最小修复旧 `psdEditorInitialResult` 串用问题；专项 `8/8`、分层聚焦矩阵 `44/44`、全仓 `4155 passed / 122 PostgreSQL-gated skipped / 0 failed`，TypeScript、零错误 ESLint 与 `117/117` 生产构建均通过。云端回归仍未完成。
- **发布结论仍为“有条件通过”，V588-STABILITY-002 不得关闭，也不得进入 V588-ADMIN-004。**

## 2026-08-29 V588-STABILITY-002 `90231c70` 发布判定增量

- **通过：** BUG-009 已在 Coze Google Chrome 真实图片入口关闭，旧 PSD 分层结果不会串入新图片编辑器。
- **未验证：** BUG-008 仍缺“完成父任务存在时关闭浮层、任务对象不丢失、重新打开可读状态”的云端证据。
- **成本边界：** 当前管理员定价为 Pear `Image-Layered=60`、Pear `gpt-image-2=60` 积分/图；未沿用历史 15 积分假设，也未为补证据擅自提交新任务。
- **结论不变：** V588-STABILITY-002 尚不能标记整体吸收，暂不得进入 `V588-ADMIN-004`。

## 2026-08-29 `805e695d` 发布判定增量

- BUG-008 已在 Coze Google Chrome 完成态真实关闭：面板可关闭，PSD 编辑器不随之关闭，关闭编辑器后重开仍保留 `completed · 100%`。
- 精确 SHA、构建、健康端点和专项门禁通过；Coze 全量测试仍有 2 项 `auth-login-configuration` 环境域名断言失败，因此不得表述为“全量自动化通过”。
- 新增 P2 BUG-010：完成态重开面板被画布媒体遮挡。Pear 远程成功终态、远程图层编辑/保存/导出及成功账务仍未关闭。
- **发布结论维持“有条件通过”。** BUG-008 可移出阻塞表，但 `V588-STABILITY-002` 仍未整体吸收，也暂不进入 `V588-ADMIN-004`。

## 2026-08-29 BUG-010 本地候选修复

- 完成态元素拆解面板已脱离画布 `overflow-clip` 层叠上下文，本地专项、全量测试、类型、Lint 与生产构建全部通过。
- 全量测试仍有 `122` 项 PostgreSQL 专项因未配置隔离测试库而跳过，不能据此宣称数据库并发与账务门禁已闭环。
- **发布结论仍为“有条件通过”。** BUG-010 只有在新提交部署后通过 Google Chrome 视觉回归才可最终关闭；Pear 远程成功、编辑/保存/导出与账务矩阵仍保持未验证。

## 2026-08-29 `b0eefdf4` 发布判定增量

- BUG-010 已通过 Coze Google Chrome 初始态、完成态和完成态重开视觉验收，任务状态、PSD 编辑器独立性和 Portal 层级均有原始截图与结构化证据，现可从开放缺陷移除。
- 本次关闭不包含 Pear 远程成功、真实扣费/退款、远程图层编辑/保存/刷新或 PSD 导出；积分只读探针超时，未作账务通过声明。
- **发布结论维持“有条件通过”。** `V588-STABILITY-002` 仍需关闭 Coze 域名测试合同与远程 Pear/账务矩阵后才能整体吸收。

## 2026-08-29 Coze 域名测试合同发布增量

- 已确认失败来自测试继承 `COZE_PROJECT_DOMAIN_DEFAULT`，而不是登录业务退化；测试隔离后，在外部注入 Coze 风格域名的环境中 `37/37` 通过，公网 HTTPS 跳转契约仍保留。
- 全量测试、TypeScript 和 Lint 通过；本机生产构建受 Node 堆内存限制未取得成功终态，不能表述为完整构建门禁通过。Coze 仍需在自身环境运行该测试后才能关闭部署侧证据。
- **发布结论保持“有条件通过”。** 该测试修复不需要改变运行时代码，但 `V588-STABILITY-002` 仍受远程 Pear 成功、图层编辑/保存/刷新、PSD 导出与真实账务矩阵阻塞。

## 2026-08-29 `4d0ee0d7` 云端发布判定增量

- Coze 原生环境已证明登录域名契约 `37/37`、TypeScript、Lint、生产构建、健康端点和静态资源全部通过；此前环境域名断言失败不再是发布阻塞。
- Google Chrome 预览页在新 Build ID 上完成强制刷新；本轮未修改业务源码、数据库、账号、环境变量或供应商配置，也未创建付费任务。
- **发布结论仍为“有条件通过”。** `V588-STABILITY-002` 还必须取得 Pear 远程 PSD 制品、编辑/保存/刷新、导出文件和真实一次扣费/退款证据，完成前不进入 `V588-ADMIN-004`。

## 2026-08-29 `2166f032` Pear 精确目标路由发布增量

- 已关闭一个新的 P1 本地缺陷：元素拆解父请求此前未携带用户获授权的 Pear `providerId + Image-Layered`，导致所有“可编辑图层”测试都可能静默使用本地 fallback，历史两层完成态不能作为 Pear 成功证据。
- 当前提交以共享模型目录解析器补齐精确目标，没有修改管理员授权、供应商配置、积分价格、ZIP 下载、PSD 解析或终态转换；聚焦 `98/98`、全仓 `4159 passed / 122 skipped / 0 failed`、TypeScript 和 Lint 通过。
- 本机 12 GiB Node 堆生产构建已完成，webpack `16.9` 分钟、TypeScript 通过、静态页面 `117/117`，Build ID `BEGTUtSa2MLS18fd4_yW6`；默认/8 GiB 内存边界仍是部署容量风险。Coze 尚未拉取本候选，因此不得宣称 Pear 已调用或 ZIP/PSD 编辑链路已通过。
- **发布结论维持“有条件通过”。** 先完成 Coze exact-SHA、生产构建和现有 Google Chrome 的请求路由/远程图层/导出/账务闭环，再判断 `V588-STABILITY-002` 是否可以吸收；当前不得进入 `V588-ADMIN-004`。

## 2026-08-29 `128ec13b` 来源可追溯门禁发布增量

- Coze 已证明 `89c2f12c` 的功能专项、类型、Lint、构建、启动和静态资源健康，但全量测试因受保护来源提交不属于干净 `main` 历史而出现 1 项失败；因此该版本不能声明全量门禁通过。
- `128ec13b` 将 30 条来源授权迁移到 `main` 可达的等价提交，并新增永久可达性断言。授权路径数量未增加，业务代码和 `stable` 未修改。
- 本地全量测试恢复为 `4159 passed / 122 PostgreSQL-gated skipped / 0 failed`，TypeScript 与 Lint 通过；Coze 仍需精确拉取该提交并证明干净检出全量零失败。
- 独立的受保护基线发布脚本仍阻止 41 个未授权业务文件；它们不能因来源可达性修复而自动获准。
- **发布结论保持“有条件通过”。** 在 Coze 干净检出回归、41 条业务漂移审计、Pear 远程编辑/保存/导出和真实账务矩阵完成前，不关闭 `V588-STABILITY-002`，不进入 `V588-ADMIN-004`。

## 2026-08-29 `bf8d8623` 保护基线关闭增量

- 此前阻断发布的 41 个生产源码漂移已逐文件完成来源与 blob 审计，并以精确路径授权；没有扩大到目录、通配符或未来文件。
- 本地 `check:protected-baseline` 已从 41 个阻断恢复为未授权漂移 `0`、警告 `0`；聚焦测试 `16/16`，全量测试 `4160 passed / 122 PostgreSQL-gated skipped / 0 failed`，TypeScript 与 Lint 通过。
- 业务源码树未变化，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- **发布结论仍为“有条件通过”。** 保护基线本地阻断已关闭，但 Coze 必须对最终提交完成干净检出、全量测试、生产构建和健康检查；隔离 PostgreSQL 专项及 Pear 远程编辑/保存/导出和真实账务矩阵仍未关闭。

### 最终本地构建补充

`main@51a313717df4edb30dc4758b78c476242b7667cf` 已完成 12 GiB 堆生产构建：webpack `14.0` 分钟、TypeScript `65` 秒、静态页面 `117/117`、Build ID `I9uo73xu5yg9CivYsHhRj`、退出码 `0`。该证据关闭本地构建缺口，但不能替代 Coze 最终提交验证或 PostgreSQL/Pear 真实链路。

## 2026-08-29 Coze 最终发布门禁增量

- `c3bfc812` 已在 Coze 干净检出中完成精确 SHA/tree/stable 校验、聚焦测试、保护基线、TypeScript、Lint、全量 Vitest、生产构建、单实例启动、三个健康端点、静态资源和 Google Chrome 稳定态回归。
- 保护基线相关 BUG-012/013 已从“本地通过、云端待验”更新为双端关闭；没有通过跳过失败测试、扩大白名单或修改 `stable` 制造通过。
- **发布结论仍为“有条件通过”。** 当前剩余条件是隔离 PostgreSQL 专项，以及 `V588-STABILITY-002` 中 Pear 真实远程图层编辑/保存/刷新、PSD 导出和成功/失败/取消账务一致性；完成前不进入 `V588-ADMIN-004`。

## 2026-08-29 Pear smart 回退发布判定增量

- 隔离 PostgreSQL 并发门禁已在本机真实 PostgreSQL 18.4 中以 `5/5` 通过，不再作为完全未执行项；Coze 业务库未被当作测试库使用。
- 唯一真实 Pear 任务已证明 ZIP、安全下载、主 PSD 提取和解析可用；远程图层质量门禁仍失败，系统退款后交付本地两层。
- 失败结算为一次扣除、一次退款、净积分 0；但成功任务“不退款且只扣一次”仍无证据。
- 新增 P1 计费配置问题：管理员显示 60，真实服务端回退价格 15。新增 P2 终态表达问题：`completed/ready` 未直观区分远程成功与本地 fallback。
- **发布结论维持“有条件通过”。** 在价格单一权威源、Pear 远程质量成功、数据库图层文档保存/刷新恢复和 PSD 导出闭环前，不关闭 `V588-STABILITY-002`。

## 2026-08-29 坐标与计价候选修复发布增量

- BUG-014 的本地价格目录已与权威 `segment=15` 结算源对齐；部署后仍需管理员页面和只读接口共同证明显示 15，不能用本地测试替代云端验收。
- BUG-007 中由 `1254x1254` 源图直接比较 `1280x1280` PSD 造成的越界误报已在本地修复；质量阈值未放宽，Pear 本次错误人物图层制品仍会被拒绝并退款。
- 聚焦、全量测试、TypeScript 与零错误 ESLint 已通过；通用 PostgreSQL 套件仍因没有 `POSTGRES_TEST_DATABASE_URL` 跳过，独立 PostgreSQL 18.4 并发证据 `5/5` 不扩大为全部数据库场景通过。
- 12 GiB 生产构建已完成：webpack `14.3` 分钟、TypeScript `65` 秒、静态页面 `117/117`、Build ID `WijIlExen98XOqjcSti5T`；默认 4 GiB 堆不足继续作为部署容量风险，不记为源码构建失败。
- 受保护源码门禁只授权本轮计价路由精确路径及来源提交，门禁未授权漂移 `0`、警告 `0`；没有使用目录或通配授权。
- 数据库图层文档持久化目前只有经批准方向的设计规格，尚未实施，不得把设计文档表述为功能完成。
- **发布结论仍为“有条件通过”。** Coze 精确部署后的计价/坐标回归、Pear 远程成功、smart 回退明确提示、图层保存/刷新和 PSD 导出仍是关闭 `V588-STABILITY-002` 的条件。

## 2026-08-29 `c79cd0fe` 云端发布增量

- 精确 SHA、保护基线、专项、类型、Lint、12 GiB 构建、单一 5000 服务、三个健康端点和静态资源均通过。
- `Image-Layered` 管理员显示价已在真实云端 UI 与权威结算统一为 `15/次`；应用侧 PSD 坐标归一也已进入云端构建并由专项覆盖。
- 本增量结论为 **有条件通过**，不是全平台发布通过：Pear 远程制品仍未取得可接受成功态，smart 回退披露、图层文档持久化、成功不退款账务和 PSD 导出仍开放。
- 稳定刷新仍记录 1 条项目同步 `502` warning，需要归入既有同步可靠性治理，不得写成“没有 Console warning”。

## 2026-08-29 smart 回退披露候选发布增量

- BUG-015 已在本地按 RED -> GREEN 关闭：退款事实来自持久化 `creditStatus`，父任务不再丢失回退诊断，UI 同时校验实际本地引擎、回退原因和已退款状态后才显示退款文案。
- 最终聚焦 `3 files / 41 tests`、扩展 `30 files / 227 tests`、全仓 `4171 passed / 122 PostgreSQL-gated skipped / 0 failed` 通过；TypeScript、完整 Lint `0 errors / 961 historical warnings` 与构建版 Lint通过。旧版终态父任务只通过纯存储快照投影已终态子任务证据，不领取 lease、不推进任务、不回写不可变终态；子任务过期或仍在处理时保留原完成结果。初次执行、部分完成、状态卡和任一分支重试统一显示中性退款回退说明。
- 保护脚本已修复大规模未跟踪文件导致的 `ENOBUFS` 假通过；当前脏工作树会诚实阻断既有工具产物，发布判断必须采用提交后的干净候选门禁。二次复核后的 12 GiB 生产构建通过：webpack `9.9` 分钟、TypeScript `45` 秒、静态页面 `117/117`、Build ID `ZJo5NS6MxxuKE1ppzZHNq`。
- **发布结论仍为“有条件通过”。** BUG-015 还需 Coze exact-SHA 与 Google Chrome 界面验收；Pear 远程质量成功、图层文档持久化、成功不退款账务和 PSD 导出继续开放。

## 2026-08-29 `2d3c2582` 云端发布判定增量

- Coze exact-SHA、干净工作区、131 项专项、保护基线、TypeScript、Lint、生产构建、单实例启动、三个健康端点与 `11/11` 静态资源均通过。
- Google Chrome 非付费冒烟确认登录、选图、元素拆解面板和稳定态 Console；没有创建 Pear 任务或账务流水。
- 历史 completed 父任务的退款回退文案尚未在真实 UI 中观察到，原因是入口默认打开新任务配置面板且直接任务 JSON 被扩展拦截。此项保持未验证，不以自动化合同替代真实界面证据。
- **发布结论继续为“有条件通过”。** `V588-STABILITY-002` 尚未整体完成；下一业务项仍为 `002-C` 数据库图层文档持久化，同时保留历史披露 UI、Pear 远程成功、成功不退款账务和 PSD 导出门禁。

## 2026-08-29 `002-C` 本地发布判定增量

- 数据库图层文档已完成 schema、存储、鉴权 API、浏览器客户端、编辑器接线和元素拆解冻结来源；不再是设计文档或 React 内存临时状态。
- 本地候选 `245517c1` 已通过隔离 PostgreSQL CAS、全仓 `4348/4348` 零跳过、TypeScript、双 Lint、118 页生产构建和干净保护基线，独立终审 APPROVED。
- **专项发布结论：本地通过、云端待验。全平台仍为有条件通过。** 在 Coze exact-SHA、Chrome 保存/刷新恢复、真实 `8BPS` 导出及 Pear 成功账务闭环前，不关闭 `V588-STABILITY-002`，不进入 `V588-ADMIN-004`。

## 2026-08-29 `002-C` 云端部分验收与 Pear 请求合同发布增量

- `18adea` 已完成 Coze exact-SHA、构建和健康门禁；真实 Chrome 证明图层文档可创建，并可保存重命名、显隐和锁定修改。
- 关闭重开、页面刷新、移动、排序、导出模式与最终 `8BPS` 文件仍无完整浏览器证据，因此 `002-C` 不能关闭。
- `9e4d945e` 已按当前 Pear 模型专页删除过期 `prompt: "."`，相关 85 项测试通过；该修复降低协议偏差，但尚未部署、尚未证明远程制品质量成功。
- `9e4d945e` 后新鲜全仓门禁为 `4225 passed / 123 PostgreSQL-gated skipped / 0 failed`、完整 ESLint `0 errors / 961 historical warnings`。生产构建在默认 4 GiB Node 堆上 OOM，改用 `NODE_OPTIONS=--max-old-space-size=8192` 后完整通过（webpack `10.7` 分钟、TypeScript `47` 秒、静态页面 `118/118`）。因此代码候选可进入 Coze 验收，但默认本地构建内存需求必须保留为工程约束，PostgreSQL 跳过项仍不能计作本轮通过。
- **发布结论保持“有条件通过”。** `002-B` 远程质量、`002-C` 恢复/导出、`002-D` 成功账务和 `002-E` 云端取消/失败仍是进入 `V588-ADMIN-004` 前的阻塞项。

## 2026-08-30 BUG-018/019 发布判定增量

- 已在本地关闭完成态 PSD 编辑器无重开入口，以及侧栏已选重叠图层拖动错误对象两项缺陷；实现不创建任务、不调用供应商、不改变积分、退款或质量门禁。
- 聚焦 `45/45`、全仓 `4230 passed / 123 PostgreSQL-gated skipped / 0 failed`、TypeScript、完整 Lint、保护基线与 8 GiB 生产构建均通过；PostgreSQL 跳过项仍保持未验证。
- **发布结论仍为“有条件通过”。** BUG-018/019 需完成 Coze exact-SHA、沙箱重启后的既有 Chrome 标签强制刷新与真实交互回归；Pear 远程质量成功、成功一次扣费零退款、最终 PSD `8BPS` 和取消账务矩阵均未关闭。

## 2026-08-30 `8cd07e1f` 云端 PSD 交互判定增量

- Coze exact-SHA、生产构建、单实例和健康路由已通过。资源核对发现 Chrome 曾继续运行旧 webpack 包；标签页级真实重载后已切换到服务器当前构建。
- BUG-019 已在 Google Chrome 真实关闭：侧栏选中的重叠元素层单独移动，整图校正层坐标不变，测试位移已还原并持久化。
- BUG-018 仅关闭“整页刷新后从图片工具栏重开同一 5 层文档”部分；完成态任务卡按钮仍缺新父任务现场，不得标记全通过。
- **发布结论继续为“有条件通过”。** 本次消除了一个真实 PSD 交互阻塞，也暴露出云端验收必须校验实际静态资源哈希；Pear 远程成功质量、一次扣费零退款、最终 `8BPS` 导出及取消/失败账务矩阵仍开放。

## 2026-08-30 `002-C` 云端关闭判定增量

- Google Chrome 已完成图层移动、排序、显隐、锁定、重命名、导出模式切换、自动保存、关闭重开和整页刷新恢复；测试顺序、坐标与模式均已恢复原值。
- 最终工作室 PSD 已实际落盘，签名 `8BPS`，并由 `ag-psd` 解析为 `3504×2336` 与 5 个编辑图层；顺序、元素 2 的 `589,416` 和校正层的 `0,0` 与保存文档一致。
- **`002-C` 核心云端验收关闭。发布结论仍为“有条件通过”。** 剩余阻塞集中在 Pear 远程质量成功、成功任务一次扣费零退款、完成态卡片按钮和取消/失败账务矩阵；本地 fallback 导出不能替代这些证据。

## 2026-08-30 完成态父任务水合候选发布增量

- BUG-018 剩余的“刷新后完成卡片消失”已按 RED -> GREEN 在本地关闭。当前项目恢复采用用户/项目/任务类型精确查询，兼容旧任务，且通过 abort 与请求代次阻止旧恢复覆盖新提交或跨项目污染。
- 恢复链路为只读：不调用 Pear、不新建元素拆解任务、不产生扣费或退款。首轮独立审查的 3 项 Important 与 1 项 Minor 已全部关闭，终审 APPROVED。
- 聚焦 `175/175`、全仓 `4244 passed / 123 PostgreSQL-gated skipped / 0 failed`、TypeScript、零错误 ESLint、干净候选保护基线和 8 GiB 生产构建 `118/118` 通过。PostgreSQL 跳过项仍不得计作本轮通过。
- **发布结论维持“有条件通过”。** 候选可推送 `main` 进入 Coze 非付费验收；只有历史 completed 父任务卡片、同任务编辑器重开及零新请求/零账务证据成立后，BUG-018 才能云端关闭。`002-B`、`002-D`、`002-E` 状态不变。

## 2026-08-30 完成态父任务水合发布判定增量

- `origin/main@3b47dfb7` 的业务 tree 已在 Coze 通过专项、全量、保护基线、TypeScript、Lint、生产构建、单实例和健康检查；`stable@52f7c60` 未触碰。
- Google Chrome 已证明历史 completed 父任务卡在整页重载后恢复，“打开编辑器”两次进入同一 5 层、同一来源和同一已保存文档。控制台新增 error/warning 为 `0/0`。
- 只读数据库与积分流水审计证明窗口内新任务、扣费和退款均为 `0`。由于服务日志不记录 path/method，HTTP 方法级网络证据仍明确写为不可直接验证；该观测限制不推翻零业务副作用证据，也不扩张成供应商链路通过。
- **BUG-018 可以云端关闭，整体发布结论仍为“有条件通过”。** `002-B` Pear 远程质量、`002-D` 成功任务一次扣费零退款和 `002-E` 云端失败/取消账务仍未关闭；完成前不得进入 `V588-ADMIN-004`。

## 2026-08-30 `5f6e84b1` Pear 真实制品发布判定增量

- Coze、GitHub 与本地 `main` 精确一致；`stable` 未触碰。异步提交、ZIP 安全下载、主 PSD 选择、`8BPS`、PSD 解析、质量门禁和失败退款已取得三组真实云端证据。
- 三个远程制品均因内容语义不匹配、缺少透明主体或重建误差过高被拒绝。应用没有放宽质量门禁，smart 回退正确交付本地结果并退款；两组有精确一扣一退流水，第三组也确认一扣一退计数。
- 当前请求合同与 Pear 官方专页一致，不能通过改接口、盲目重试或接受错误单层 PSD 来制造通过。远程优质分层成功仍是供应商能力/适用素材阻塞。
- **发布结论继续为“有条件通过”。** `002-B` 仅部分通过，`002-D` 成功任务一次扣费零退款仍未验证，`002-E` 只关闭云端失败退款部分，显式取消与迟到终态仍开放。在官方场景受控肖像取得合格远程结果前，不进入 `V588-ADMIN-004`。

## 2026-08-30 `c5d39b11` Pear 肖像质量修复发布判定增量

- 受控肖像真实 Pear 制品证明供应商可输出 23 个语义图层；此前远程结果被回退的直接根因是应用侧坐标归一和透明底色比较错误，不是 ZIP、MIME、安全下载、PSD 提取或模型只会输出单层。
- 新候选没有降低质量阈值，只修正比较坐标和 Alpha 合成语义。同一制品离线重放由 score `22` 提升为 `98`，MAE 由 `0.7844` 降为 `0.0158`，越界率由 `0.1739` 降为 `0`。
- 本地代码、专项、全仓、TypeScript、Lint 和 `118/118` 生产构建均通过；123 项 PostgreSQL 隔离测试因本轮没有专用测试库而明确跳过，仍不得计作通过。
- **发布结论保持“有条件通过”。** 当前候选可以推送 `main` 进入 Coze 真实验收；在 `002-B` 远程成功、`002-D` 一扣零退和 `002-E` 显式取消/迟到终态完成前，不关闭 `V588-STABILITY-002`，不进入 `V588-ADMIN-004`。

## 2026-08-30 `a2b1a850` 元素拆解文案发布增量

- 已关闭“可编辑图层模式仍显示生成拆解板”的本地 P3；改动仅涉及显示文案、稳定动作标识与 E2E 定位，不触碰任务和账务链路。
- 本地契约、TypeScript、构建版 Lint 与空白检查通过；完整生产构建沿用前一 P1 候选结果，推送前仍需在最终 tree 上重跑。
- **发布结论不变：有条件通过。** Coze 拉取后先做三模式非付费文案冒烟，再执行 `002-B/002-D/002-E`。

## 2026-08-30 `d9b9c402` 最终本地候选发布增量

- 最终代码树已执行新鲜全仓回归：`4247 passed / 123 PostgreSQL-gated skipped / 0 failed`；跳过的隔离 PostgreSQL 专项不计入通过。
- TypeScript、构建版 Lint、空白检查、12 GiB 生产构建 `118/118` 与干净候选保护基线 `38/38 / 0 drift / 0 warnings` 均退出 `0`。生产构建耗时为 Webpack `11.6` 分钟、TypeScript `53` 秒。
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 仍为受保护稳定基线；本候选仅准备推送 `main`。
- **发布结论仍为“有条件通过”。** 本地门禁允许进入 Coze 验收，但不替代 `002-B` Pear 远程成功、`002-D` 一扣零退和 `002-E` 显式取消/迟到终态证据。

## 2026-08-30 Pear ZIP 瞬时超时修复发布增量

- 最新云端真实任务证明业务请求、异步 Pear 任务、拆解板分支和退款回退均可运行，但图层分支因单次远程 ZIP 下载超时未取得 Pear 成功终态。
- 本地候选只增加一次受限的瞬时网络重试；不调整 60 秒单次超时、128 MiB 上限、安全下载规则、质量阈值、扣费或退款状态机。
- 新鲜门禁为 `4248 passed / 123 PostgreSQL-gated skipped / 0 failed`、TypeScript 通过、ESLint `0 errors / 961 warnings`、生产构建 `118/118`、保护功能 `38/38`、空白检查通过。
- **发布结论保持“有条件通过”。** 可以推送 `main` 并进入 Coze 真实复验；`002-B`、`002-D` 与 `002-E` 在取得新云端证据前继续开放，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 不得触碰。

## 2026-08-30 `c15ba26a` 云端复验发布增量

- 新构建已在 Coze 正常启动并由 Google Chrome 加载。元素拆解三模式及“生成可编辑图层”动作文案云端通过，异步应用任务能快速建立。
- 本轮 Pear 在制品产生前返回“当前服务暂不可用”，应用回退本地 3 层并精确披露原因；账务为唯一 `-15` 与唯一 `+15`，余额回到 `388`。
- 这次失败不是 ZIP MIME、安全下载、PSD 提取、质量门禁或本次新增下载重试的反证，因为远程制品 URL 尚未产生；也不能据此声称远程成功。
- **发布结论仍为“有条件通过”。** `002-B` 远程 23+ 图层成功、`002-D` 成功任务一扣零退和 `002-E` 显式取消/迟到终态仍开放；`V588-STABILITY-002` 不关闭，暂不进入 `V588-ADMIN-004`。

## 2026-08-30 Pear 延后验证发布增量

- Pear 远程质量成功、成功账务和显式取消仍未验证，不能列为发布通过能力。
- 本轮官方合同复核通过，但真实任务没有创建：Chrome 控制断连，独立 API 登录为 401，所有外部副作用均为零。
- 按用户决定，Pear 不再阻断 V5.8.8 其余吸收；产品继续保留 smart/local 回退与质量门禁。该调整不改变全平台“有条件通过”结论。
- 下一吸收项为 `V588-ADMIN-004`，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 继续只读。

## 2026-08-30 `V588-ADMIN-004` 候选判定增量

- 管理员用户读取已从错误的逐用户静默降级改为固定三次权威批量查询；用户 CRUD、密码、模型授权、积分扣费、充值、支付、项目写入和审计写入均未修改。
- 聚焦 `21/21`、TypeScript、ESLint `0 errors`、保护功能 `38/38` 和生产构建 `118/118` 已通过；默认 4 GiB 构建 OOM、8 GiB 构建通过，属于需持续观察的构建资源门槛。
- **本地候选可进入 Coze 验收，但发布结论保持“有条件通过”。** 关闭本项还需要 exact-SHA 部署后，在同一管理员会话中证明四处总用户数一致、逐用户积分/项目一致、真实活动时间可刷新恢复且 Console 无新增错误。
- Pear `002-B/002-D/002-E` 保持后期 `DEFERRED / UNVERIFIED`，不再阻断本项，也没有被本项误标为通过。`stable` 和 donor 未触碰。
- 最终全仓复跑 `4259 passed / 123 PostgreSQL-gated skipped / 0 failed`；跳过项仍不计作通过。机器证据：`docs/testing/evidence/v588-admin-004-local-20260830.json`。

## 2026-08-30 `V588-ADMIN-004` 云端候选补充

- Coze exact-SHA、测试、构建、单实例与健康检查通过；底层数据库投影一致。
- 因未取得管理员 Cookie 下四接口真实响应，本项不能标记完整云端关闭，当前为 **数据层通过 / HTTP 与 UI 待补证**。

## 2026-08-30 `V588-PROVIDER-002` 候选判定增量

- 管理员授权写入已补服务端精确目录门禁，歧义和无效授权在任何用户写入或成功审计前失败；普通非模型更新不读取目录。
- UI 明确区分保存失败与保存后刷新失败；未改变选择器布局、空数组“不限”语义、任务路由、供应商调用或积分账务。
- 本地 `4275 passed / 123 PostgreSQL-gated skipped / 0 failed`、TypeScript、零错误构建版 Lint和 `118/118` 生产构建通过。
- **发布结论仍为“有条件通过”。** 候选完成治理和推送后，必须在 Coze 管理员会话验证唯一裸键迁移、歧义/无效拒绝、普通用户模型可见与刷新恢复；`stable` 保持只读。

## 2026-08-30 `V588-PROVIDER-002` 停用目录候选增量

- 旧云端的真实管理员保存仍失败：停用供应商模型被前端列出并随整批提交，后端 400 拒绝后界面回滚。该结果证明原写入门禁有效，同时暴露前后端目录不一致。
- `95b489be` 只让管理员授权选项排除停用供应商，不改 API Key、启停状态、用户持久化、模型路由、任务或积分。
- 本地全仓 `4276 passed / 123 PostgreSQL-gated skipped / 0 failed`，TypeScript、零错误 Lint、8 GiB 构建 `118/118` 和干净保护基线通过。
- **发布结论保持“有条件通过”。** 候选可推送 `main` 进入 Coze 复验；部署前不得把管理员有效保存或普通用户模型可见性标记为云端通过，`stable@52f7c60` 保持只读。

## 2026-08-30 `V588-PROVIDER-002` 历史存储兼容候选增量

- 旧云端有效授权请求已经越过模型目录门禁，但历史 JSONB 模型列使认证仓库返回 500；该问题与供应商模型可用性无关。
- 候选仅在 PostgreSQL 明确的数据类型错误时执行一次 JSON 编码兼容写入，未更改登录、角色、密码、任务、供应商调用或积分账务。
- 本地全量自动化为 `4278 passed / 123 PostgreSQL-gated skipped / 0 failed`，生产构建 `118/118`，保护功能 `38/38`。
- **发布结论仍为“有条件通过”。** 可以推送 `main` 进入 Coze 精确 SHA 复验；新版本返回 200、刷新持久化和恢复“不限”完成前，不得把管理员授权或普通用户可见性标记为通过。`stable` 保持只读。

## 2026-08-30 `318fe2d7` 云端验收增量

- 管理员模型授权对历史 JSONB 用户列的写入、刷新持久化和恢复“不限”均已在真实 Google Chrome 中闭环，两个 POST 均为 200。
- Coze 全仓 `4278 passed / 123 PostgreSQL-gated skipped / 0 failed`，Build ID `lEWsTeQvojTosQpVCD7M6`，服务 PID `8185`；首页、独立聊天和认证端点为 200。
- **本项发布状态升级为管理员链路通过。全平台结论仍为“有条件通过”**，因为普通用户实际可见性、隔离 PostgreSQL 套件及既有 Pear 后期验证项仍开放。
- 首次服务替换后的延迟分块 500 需要继续作为部署可靠性问题观察；稳定后强刷和 34 个静态资源检查均通过。

## 2026-08-30 `V588-ADMIN-004` 最后活动候选增量

- 四个管理员业务接口与三个页面的用户总数、积分和项目投影已在真实管理员会话中只读一致，先前“只做数据库复算、没有认证 HTTP”的证据缺口已经关闭。
- 同轮发现并稳定复现 P2：API 的有效 `last_login` 被 UI 硬编码 `-` 覆盖。候选只恢复权威字段显示，未改认证、用户写入、项目、积分、任务或账务。
- `main@a9956bc5` 已通过 `4279 passed / 123 PostgreSQL-gated skipped / 0 failed`、TypeScript、零错误 Lint、保护基线和 `118/118` 构建，并已推送 GitHub；Coze 精确 SHA 尚未确认。
- **全平台结论仍为“有条件通过”。** `V588-ADMIN-004` 只有在 Coze 真实显示最后活动日期、刷新恢复且 Console 无新增错误后才能完整关闭；隔离 PostgreSQL 与 Pear 后期验证项继续明确开放。

## 2026-08-31 `V588-ADMIN-004` 仪表盘边界候选增量

- 旧云端 UI 的 `0 / - / 从未` 已定位为组件边界丢字段，而非管理员 API、数据库投影或认证回归；候选只恢复三个权威字段的传递。
- `main@a27e33be` 已通过 `4280 passed / 123 PostgreSQL-gated skipped / 0 failed`、TypeScript、零错误构建版 Lint、`118/118` 生产构建和保护基线 `38/38 / 0 drift / 0 warnings`，并已推送 GitHub；`stable` 与 donor 均未触碰。
- Chrome 自动化当前只能枚举现有标签，任何页面读取或刷新均超时；扩展、原生通信、Chrome 进程诊断均通过。由于禁止创建新标签或窗口，本轮没有 Coze 拉取、沙箱重启或云端 UI 结果。
- **全平台结论继续为“有条件通过”。** 本地候选具备部署资格，但 `V588-ADMIN-004-BUG-003` 与整项吸收仍为 Coze 待验；隔离 PostgreSQL 和 Pear 后期项继续开放。

## 2026-08-31 `fa857e44` 云端验收检查点

- **当前结论：有条件通过，不是全平台发布通过。** 云端精确候选构建成功，Chrome 首次强刷后的管理员三字段实际恢复，四管理页面总用户数一致，积分与项目数据未改变。
- 本轮已完成 Coze 同步、测试、构建、单一服务启动和首次真实 UI 验证，不再沿用上轮“未拉取、没有云端 UI 结果”的状态。业务实现仍为 `a27e33be`，运行候选为 `fa857e44328cb20f80cf2ab6194d0c1db127283b`。
- Chrome 采集最后一组网络正文时断线。运营总览响应正文、再次刷新持久显示、完整新鲜日志和 post-done 最终 tree 尚未取得，因此 `V588-ADMIN-004` 不提前关闭。3 个 Coze 注入脚本的 CSP 拦截单独保留，不以放宽 CSP 消除告警。
- 隔离 PostgreSQL 的 123 个跳过测试、普通用户模型可见性、Pear `002-B/002-D/002-E` 后期验证项保持开放。管理员正向显示不能代替这些证据。
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰；本轮仅新增报告，不需要为了文档提交重复云端构建。证据：`docs/testing/evidence/v588-admin-004-fa857e44-cloud-20260831.json`。
