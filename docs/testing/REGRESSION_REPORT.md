# 无界AI — 回归测试报告 (REGRESSION REPORT)

## 2026-09-10 多平台批量导出 Task10 最终本地门禁

本轮以 `main@8a58ca2f` 为工作树基线完成 Task10 本地收尾。全仓 Vitest 绑定隔离 PostgreSQL `wujie_stage4_task12final`，`740` 个测试文件、`6157/6157` 通过，0 失败、0 跳过。Playwright 在 Chromium、Firefox、WebKit、375px Mobile Chromium 上 `16/16` 通过，JUnit 为 16 tests / 0 failures / 0 skipped，证据含 17 张截图、48 个视频和 16 个 Trace。

原 Webpack 生产构建在优化阶段出现原生内存异常；Turbopack 首次复核又暴露 Windows 中文代码框架字符边界 panic。最小修复保留运行时中文提示，使用等价 Unicode 源码转义，并增加构建后 NFT 清理器。最终 `pnpm build` 生成 `120/120` 页面，222 个 NFT 清单中 `.tmp`、`output`、Playwright 和测试证据引用为 0。生产服务真实调用 `/api/svg-trace` 返回 200、引擎 `wasm-vtracer`，确认 WASM 功能未因构建器切换丢失。TypeScript、Doctor、全仓构建版 ESLint 均退出 0。判定：`LOCAL PASS / CLOUD UNVERIFIED`。

## 2026-09-06 Task12 暂停恢复子任务租约修复

真实PostgreSQL先复现accepted子任务在暂停恢复后无法立即接管，再最小修复成功恢复事务清除旧子租约；保留原provider_task_id与账务。全仓5321通过、0失败、12因旧数据库变量跳过；补齐TEST_POSTGRES_URL后四个文件12/12通过，合计覆盖5333项。新增回归确认旧执行器写回拒绝、重复恢复不抢占新租约。类型检查、构建版Lint退出0；生产构建退出0、119/119页面、BuildID `qODy_KTeI8k1tbnsf48An`。机器证据及哈希见同日Task12专项记录。云端同一原任务恢复与交付仍未验证。

## 2026-09-06 Task12 历史 Canvas ID 兼容增量

最终补充：生产构建退出0、119/119页面、BuildID `24_t3PODbMPtk0D9ZY3Y7`。全量机器报告SHA256 `8A3BE42CB64C728D9DDEE537B44A74BEAF934FA8D2DF1B88916A9769C0D4FA11`。本地门禁通过，云端仍待新提交同步后同图验收。

Coze只读诊断证明 a1ad44e1 后仍404的原因：同项目画布placement并存裸项目ID与canvas:项目ID。本轮仅在授权适配器中兼容这两个Canvas项目级ID，保留用户、项目、版本、实体和active边界，无历史数据修改。别名单元测试先2失败/10通过，修复后12通过；聚焦47/47通过（含真实PostgreSQL集成）。全仓676文件、5332/5332通过、0失败、0跳过；TypeScript和全仓构建版ESLint退出0。生产构建待结束，云端新候选未验收。证据及全量报告哈希见专项记录，不重开已关闭阶段。

## 2026-09-06 Task12 画布素材归属补修

TEST-SKILL-012：真实 Chrome 两次估算返回404，组件把聊天session误作画布workspace。最小修复固定为 `canvas:${projectId}`，不改后端授权。失败测试2失败/1通过，修复后3通过；提交前再次执行组件/估算接口17/17通过。全仓报告5153通过、0失败、166跳过；隔离PostgreSQL补验172/172通过（含166项原跳过与6项重叠），类型、改动文件Lint及38项保护门禁通过。默认堆构建OOM已保留；本地8GB堆重跑119/119退出0，不修改云端配置。证据、哈希及范围见[专项记录](2026-09-06-task12-canvas-source-context-failure.md)。云端估算与新任务成功仍待新版部署后验收。

TEST-SKILL-011同一成品已在云端确认自然尺寸1254×1254及关闭交互；同资产下载和完整Trace仍待验，不重复生成。

## 2026-09-06 Task12 大图预览增量

TEST-SKILL-011本地最小修复：节点专项33/33；全仓5304通过/0失败/12跳过，原跳过12项在隔离PostgreSQL全部补验通过；类型、Lint构建门禁、38保护通过；119/119生产构建退出0（BuildID uMTJ7VMeTVPmlRpihy8qe）。本地Google Chrome横/竖图两条真实布局测试通过，覆盖六组视口/像素比例检查；不代表真实供应商或全平台验收。证据与前置失败详见[本轮报告](2026-09-06-task12-preview-modal-verification.md)。云端新版复验仍未完成。

## 2026-09-05 Task12 AssetVersion 真实尺寸补修

真实 1254×1254 Skill 成品对应 AssetVersion 宽高为空，已通过失败测试确认元数据在任务终态和资产投影之间丢失。最小修复在事务外复用安全媒体输入与 Sharp 像素门禁采集真实 MIME、字节数和宽高，并让投影器按 URL 精确保留字段；读取失败只降级为无尺寸，不覆盖供应商成功终态。

投影保真、元数据采集、旧持久化、原子完成顺序和终态结算聚焦回归 66/66。随后在全新 PostgreSQL 18 隔离集群补充真实 PNG 投影断言，全仓 `5314/5314` 通过、0 失败、0 跳过、0 todo；数据库确认并发终态只产生一个版本/placement，版本为 `1254×1254`、`image/png`。报告 `output/task12-image-lease-postgres-full-20260905.json`，SHA-256 `FA9FE6E6358B37F87AA43069D2843EC35B5F4D4FF937E2E9521636F9CA9EE651`；类型和目标 Lint 通过，测试集群已停止。Coze 新任务、缩略图、预览和下载仍未验证，结论为 **LOCAL POSTGRES PASS / CLOUD UNVERIFIED**。

## 2026-09-05 Task12 原生 Skill 租约结算补修

云端真实成功任务暴露父任务已完成但执行租约 `completed_at=0`。新增失败单测证明原生 Skill 自行终态化后，适配器再次写合成 `tool.completed` 会被终态保护拒绝并跳过租约结算；最小修复后 same-task 18/18，通过 Skill 执行器、事件围栏和预付轮询等聚焦回归共 73/73，TypeScript 通过。

真实 PostgreSQL 成功链路已在全新隔离集群执行：租约与投影两文件 `8/8` 通过，随后全仓 `5314/5314` 通过、0 失败、0 跳过。租约用例覆盖 `completed_at>0`、一次供应商调用、一次消费和无重复提交；报告与哈希同上。结论升级为 **LOCAL POSTGRES PASS / CLOUD UNVERIFIED**，Coze 新成功 run 尚未复验，不得把本轮结果写成 Task12 已完成。

## 2026-09-04 Skill shadow恢复最终候选

最后两项审查修复之后，完整Vitest5253通过、0失败、0跳过，含真实隔离PostgreSQL，报告`output/skill-shadow-release-full-20260904.json`。类型检查及38功能保护通过；全仓lint0错误944警告。默认4GB构建OOM退出134，确认本机容量后以仅进程级8GB堆重试完整退出0，119/119页面，日志`output/skill-shadow-release-build-8gb-20260904.log`。保留失败及全部RED证据，不把本地测试冒充Chrome云端通过。详情见[最新修复记录](2026-09-04-skill-history-placement-recovery.md)。

## 2026-09-04 Skill 真实数据库回归

120项上下文/准入/恢复专项通过。新建仅监听127.0.0.1:55489的隔离PostgreSQL18后，先得到快照序列化4项失败、保存时序1项失败，均已保留原始日志并最小修复；独立审查补充旧映射替换后清理测试，先失败再通过。最终保存/账务/隔离专项58项通过，其中17项使用真实PostgreSQL。末次业务修复后固定源码全量回归为4956通过、144跳过、0失败（630文件通过、27文件跳过，498.14秒）；跳过项不算通过。最终lint为0错误/943警告，类型检查与38功能保护门禁通过。生产构建退出0，119静态页面，7个业务源码哈希核对一致；云端验收尚待确认。详情：[本轮修复记录](2026-09-04-skill-context-save-repair.md)、[固定源码证据](evidence/skill-context-save-release-20260904.json)。

## 2026-09-03 Skill 终态与 ADMIN-003 云端续验

- 当前 `main@3ac51515` 未覆盖 `8e997ebf` 的 Skill 修复；组件与服务专项重新执行为 `2 files / 58 tests passed / 0 failed`。
- 云端暂停 run `dba325df-0466-4c14-b620-3a714b592bd7` 的事件明确为 `run.paused / execution-error`，失败步骤 `conversation-2` 投影为 `failed`。对该 run 发送通用 resume 得到 400 `SKILL_RUN_REQUEST_INVALID`，复读后仍为 paused，证明后端不会绕过“从失败步骤重试”。
- 云端取消 run `14879240-7fd5-4a8d-9c50-16fabc06feb7` 为 `cancelled/refunded`，活动步骤投影为 `cancelled`，`processing` 子步骤数量为 0。
- `V588-ADMIN-003` 非数据库聚焦回归为 `8 files / 54 tests passed`。随后新建本机隔离 PostgreSQL 18 临时库，原跳过的 2 项真实通过：checksum migration 与 version-size 唯一约束成立，并发 claim 不重复且旧租约不能完成新租约持有的记录；未连接业务数据库。云端运行 `asset-v3`，453 个受管图片均 ready。5 个受控批次共回填 41 个变体，全部 completed、0 failed/0 skipped，ready 从 2 增至 43，项目投影缩略图从 1 增至 20。20/20 缩略图、20/20 带重试参数的 URL、20/20 对应原图均返回 200，类型分别为 WebP 与 PNG。
- **判定：缩略图生成与基本交付 CLOUD PASS，Google Chrome UI 仍待验。** 现有正确 Chrome 标签可枚举，但控制通道未附着；没有改用 360 或新建标签，也没有执行批量回填、历史软归档或供应商任务。证据：[skill-admin003-cloud-followup-20260903.json](evidence/skill-admin003-cloud-followup-20260903.json)。

## 2026-09-02 `V588-CREDITS-OBS-001` 积分可观测性回归

- 既有 Google Chrome 管理员会话真实显示 6 个用户、总充值 8560、总消费 4210、系统结余 5110；分类为图像 90%、聊天 0%、视频 4%、其他 6%，合计精确 100%，历史 137% 已不再复现。
- 流量口径为消费 6408、退款 2198、充值 8560、补偿 760；`6408 - 2198 = 4210`。最近流水的消费/退款/充值/补偿标签及正负号均正确，未发现本轮账务数值错误。
- 新增 RED 证明“系统结余”副标题错误地描述为“充值 − 消耗”；最小修复仅改为“当前用户余额合计”，不修改任何账务计算或写入。
- 聚焦 2 文件 8 项、TypeScript、定点零错误 Lint、全仓 `598 files / 4505 tests passed / 0 failed` 和生产构建 `118/118` 通过。`133` 项隔离 PostgreSQL 专项因缺少专用测试库明确跳过，继续作为发布阻塞证据。
- **当前判定：分类与流水 CLOUD PASS；副标题 LOCAL PASS / CLOUD PENDING。** 证据：`docs/testing/evidence/v588-credits-obs-cloud-20260902.json`。

## 2026-09-01 PROVIDER-003 真实超时与阶段关闭

Coze `f02550ba` 源码树使用受控公网 HTTPS 首字节延迟探针执行真实字境请求。任务 `font-design-1788276674834-20fbur` 在 `15078ms` 后稳定进入 `timeout/MODEL_TIMEOUT/refunded`；60 积分恰好一扣一退，余额 `328 -> 268 -> 328`，累计消耗保持 `3992`。45 秒后复读仍为 `timeout/revision=1`，无图片、无新增流水，证明迟到结果不能覆盖终态。临时供应商已删除，探针进程已停止。

结合已记录的真实非 JSON、正向生成、同键重放、取消和精确路由证据，`V588-PROVIDER-003` 的业务验收关闭并进入 `V588-ADMIN-003`。这不等于全平台发布通过：133 项隔离 PostgreSQL 测试、字境完整 Chrome 录像/Trace 仍在发布级未验证清单。证据：[v588-provider-003-controlled-fault-cloud-20260901.json](evidence/v588-provider-003-controlled-fault-cloud-20260901.json)。

## 2026-09-01 PROVIDER-003 受控真实 HTTP 非 JSON 增量

在 Coze `f02550ba` 源码树上创建一次可清理的临时图像供应商，显式冻结 `providerId + gpt-image-2` 并让真实公网 HTTP 端点返回 HTML 404。字境任务 `font-design-1788275881139-boz4vr` 最终为 `failed/ALL_PROVIDERS_FAILED/refunded`，保留上游 HTML 错误摘要；60 积分恰好一扣一退，余额 `328 -> 268 -> 328`，`totalUsed` 保持 3992，无图片结果。该临时供应商的删除请求无异常完成。

随后第一次准备超时探针时，创建临时供应商请求遇到 Coze `instance_not_found`。该次没有可确认 taskId，仍只作为环境中断；后续使用可审计的公网首字节延迟探针取得了上方真实超时闭环。

## 2026-09-01 PROVIDER-003 Coze 真实路由与结算增量

Coze HEAD `ff0b5042` 与 `origin/main@f02550ba` 的 tree 完全一致，构建 ID `MTObh3wZMhxo-_4Q_hSBy`。云端门禁为 595 个测试文件、4492 项通过；25 个文件中的 133 项 PostgreSQL 专项明确跳过；TypeScript、Lint `0/0`、保护基线和 `118/118` 构建通过。

真实业务证据覆盖：品牌辅助选定 APImart LLM 后成功返回六类内容，显式缺失供应商和未授权模型均在扣费前 400 拒绝；字境 APImart 图像任务 27 秒完成并准确扣 60 积分，同键重放复用同一任务且无第二次扣费；另一真实字境任务取消后准确退回 60 积分，60 秒后没有迟到完成覆盖；精修既有完成及取消任务的精确供应商身份和账务终态复核一致。`gpt-image-2-4k` 在取消样本中按既有别名规则规范化为 `gpt-image-2`，不应误报为供应商失配。

结论为**云端增量有条件通过**，不是 `V588-PROVIDER-003` 整体通过。真实上游超时、非 JSON/畸形响应、隔离 PostgreSQL 并发和字境 Chrome UI 仍未验证。证据：[v588-provider-003-f02550ba-cloud-api-20260901.json](evidence/v588-provider-003-f02550ba-cloud-api-20260901.json)。

## 2026-09-01 PROVIDER-003 后台任务与退款一致性本地回归

`V588-PROVIDER-003-BUG-010` 已按真实失败合同完成 RED -> GREEN。品牌电商和字境生图改为以 `cloud_tasks` 为权威：用户级幂等键与请求摘要原子创建任务，完成态使用条件式 CAS，失败、取消和超时统一执行持久化终态与一次退款；本地后台任务在轮询恢复时区分正常宽限期与重启后的超时孤儿任务。字境异步供应商结果不再被误写为 completed，持久化上下文不包含 API Key；同进程完成结果保留准确的供应商和模型身份。4K 等别名计价继续使用用户选择的原始模型，规范化 ID 只用于供应商调用。

TDD 过程中先得到缺少幂等键、缺少持久化结算、字境结果身份丢失、API Key 落盘和 4K 计价回归的失败证据，再逐项最小修正。独立复审又稳定暴露凭据进入公开任务结果、品牌/字境终态策略覆盖不全、摘要不足、重放重置内存状态、字境精确模型配对缺失和非法幂等键 500；补充合同后分别得到 RED，再完成最小修复。复审聚焦套件 `67/67`、受影响矩阵 `308/308`、精修防回归 `68/68` 通过；新鲜全仓为 `595` 个测试文件、`4488` 项通过、0 失败，`25` 个文件中的 `133` 项 PostgreSQL 专项因未配置隔离测试库跳过。`pnpm ts-check` 退出 0；`pnpm lint` 为 `0 errors / 951 historical warnings`；`NODE_OPTIONS=--max-old-space-size=8192 pnpm build` 退出 0并生成 `118/118` 页面。

本地结果不替代真库与云端验收。仍需在隔离 PostgreSQL 和 Coze exact-SHA 上证明并发同键只建一任务/只扣一次、同键不同摘要冲突、失败/取消/超时只退款一次、迟到完成不能覆盖终态、重启孤儿任务可结算，以及 Google Chrome 中的任务、流水和 Console/网络证据。

## 2026-09-01 PROVIDER-003 精确路由回归

在品牌、精修、字境三个真实 API 路由建立 7 项 RED，覆盖显式供应商不存在、模型不属于供应商、字境显式供应商失败后偷换供应商。最小实现后聚焦 4 个测试文件 `62/62` 通过；首次全仓运行发现旧复合模型键和未选模型兼容回归 3 项失败，修正后第二次全仓新鲜执行为 `593` 个文件通过、`4466` 项通过、0 失败，25 个文件中的 `133` 项 PostgreSQL 专项明确跳过。

新鲜门禁：`pnpm ts-check` 退出 0；`pnpm lint` 为 0 error / 951 historical warnings；`NODE_OPTIONS=--max-old-space-size=8192 pnpm build` 编译成功并生成 `118/118` 静态页面；干净检出 `main@14b058fc` 的保护门禁保留全部 38 个功能、0 漂移、0 warning。首次全仓 3 项失败及其修正未隐藏。

本结果只证明本地精确路由和兼容合同。品牌/字境后台异步失败退款、133 项真实 PostgreSQL 并发、Coze exact-SHA、真实供应商结果与浏览器证据未通过，详见 `V588-PROVIDER-003-BUG-010` 和 [机器证据](evidence/v588-provider-003-exact-routing-local-20260901.json)。

## 2026-09-01 品牌辅助失败提示本地回归

`V588-PROVIDER-003-BUG-008` 已完成可重复 RED→GREEN：HTTP 502 且业务 `success:false` 的三类辅助响应在旧代码中无可见提示，新增回归首先稳定失败；最小实现同时检查 HTTP 与业务状态、保留后端错误，并允许并发三项中的部分成功继续落入字段。修复后组件 `14/14`、品牌相关 `39/39` 通过。

Fresh 全量门禁为 `592` 个测试文件、`4459` 项通过、0 失败；25 个文件中的 133 项 PostgreSQL 专项因未配置隔离测试库跳过。`pnpm ts-check` 通过；ESLint `0 errors / 956 historical warnings`；8 GiB 生产构建 `118/118`；提交 `1e58c84e` 的干净隔离工作树保护门禁 `38/38`、0 未批准漂移、0 warning。脏工作区首次保护检查被既有 `.playwright-cli` 与两个只读参考仓库拦截，该失败未隐藏，未删除或放宽这些文件；干净候选结果才作为有效门禁。

云端真实点击只证明修复前失败无提示。随后根 URL 与三类品牌辅助探针先返回 HTTP 502；`origin/main@2ff2ce4a` 推送后，用户确认的三类请求及根页、`/api/auth/me` 又统一返回 Coze 网关 `404 instance_not_found`，没有进入应用，更没有访问 APImart 或产生扣费。因此不能归因 APImart，也不能冒充候选云端通过。证据：[v588-provider-003-brand-assist-error-surface-local-20260901.json](evidence/v588-provider-003-brand-assist-error-surface-local-20260901.json)。

## 2026-09-01 品牌辅助聊天端点本地回归

云端真实网络体已经证明 BUG-005 的精确配对生效，同时揭示 BUG-007：APImart 聊天模型被错误送到 `/images/generations`。新增路由级 RED 稳定复现端点错误；最小实现只把品牌辅助请求改为 `/chat/completions`，不触碰品牌生图或全局 APImart 图像协议。GREEN 后相关 `38/38`，全仓 `592` 个文件、`4458` 项通过，0 失败；25 个文件中的 133 项因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过。TypeScript 通过，Lint 为 `0 errors / 956 historical warnings`，8 GiB 生产构建生成 `118/118` 页面，干净候选保护基线 `38/38`、0 漂移、0 警告。真实辅助成功响应仍待云端部署复验。

## 2026-09-01 品牌 AI 辅助供应商/模型精确配对本地回归

`V588-PROVIDER-003-BUG-005` 已按两个既有前端组件的最小边界完成 RED→GREEN。相同模型 ID 存在于多个聊天供应商时，菜单 key、高亮、显示、选择与持久化均使用精确配对；三类并发辅助请求从同一次点击快照提交相同 `llmProviderId + llmModel`。歧义旧裸键要求用户重选且不静默改写；缺少 `providerId` 的目录模型不再显示辅助按钮，避免退回后端隐式选供应商。图像供应商选择与品牌生成合同保持不变。

验证结果：专项 `13/13`、品牌相关 `68/68`、第二次全仓 `591` 个文件与 `4457` 项测试通过，0 失败；25 个文件中的 133 项 PostgreSQL 测试因未配置隔离测试库跳过。首次全仓运行中 `psd-export-layer-decomposition` 的旧竞态用例发生一次 5 秒超时；精确单项随后通过，完整 PSD 文件连续 3 次均为 `15/15`，第二次全仓也包含该文件并通过，故记录为资源调度抖动而非稳定回归，原失败未删除。`pnpm ts-check` 通过，ESLint `0 error / 956 warnings`，8 GB Node 堆生产构建生成 `118/118` 页面；干净隔离工作树中的保护基线 `38/38`、0 漂移、0 警告。当前结论为**本地通过、云端待验**，证据：[v588-provider-003-brand-assist-pair-local-20260901.json](evidence/v588-provider-003-brand-assist-pair-local-20260901.json)。

## 2026-09-01 精修浮窗与取消云端回归

- GitHub `main`：`6256612113ce46a9a747f96c98dc7997c3601e9b`
- Coze 合并 HEAD：`7a346a7e683e4a8a3e0566a7fc42b61ca732097a`
- 源码树：`3724394a119bd88add5c12860e021d578b3ff48f`
- Build ID：`PMkNKUEGZAzQrFZK4IUh8`
- 云端门禁：精修专项 `53/53`、保护基线 `38/38`、构建路由 `118/118`
- 浮窗：`2048×991` 视口中提交按钮底边 `962.2px`，完整可见且可点击
- 取消：任务 `refine-1788241634736-ob26or` 最终 `cancelled`，12 积分存在一条扣费和一条退款事务
- 迟到结果：取消后等待超过 90 秒，界面未转为完成，画布仍为 8 张图片，无新增精修结果

本专项结论：**通过**。这只证明精修面板异步增高、单次取消、退款和迟到结果隔离，不替代其他工具、并发取消、PostgreSQL 全套、Firefox/WebKit 或全平台发布验收。证据：[v588-refine-cancel-62566121-cloud-20260901.json](evidence/v588-refine-cancel-62566121-cloud-20260901.json)。

## 2026-09-01 精修浮窗异步增高回归

真实 Chrome/CDP 先证明 `dc701c57` 在异步模型/预设加载后仍会把开始按钮推到 `2048×935` 视口之外，并证明该次点击没有发出精修 POST、没有任务及扣费。随后新增组件 RED 用例，原实现因未注册 `ResizeObserver` 失败；最小实现监听面板自身尺寸变化并复用既有约束函数后转绿。

最新本地证据：精修生命周期、浮窗位置、精修终态及取消接口合计 `53/53`；TypeScript 通过；ESLint `0 error / 956 warnings`；全仓 `591` 个文件、`4452` 项通过，`133` 项隔离 PostgreSQL 测试因未配置专用数据库跳过；8GB Node 堆生产构建成功生成 `118/118` 页面。标准保护门禁在脏工作区被未跟踪浏览器证据目录干扰，干净检出复跑尚待提交后执行，不能用当前 `42347` 条非源码路径噪声替代保护结论。

## 2026-09-01 方案A前端取消与浮窗本地回归

新增8项精修组件生命周期和8项浮窗纯函数测试，均按RED→GREEN执行；与精修异步终态、取消API合并后53/53通过。最终全仓为591个测试文件通过、4452项通过、0失败；25个文件中的133项因未配置隔离`POSTGRES_TEST_DATABASE_URL`而明确跳过，不计作通过。TypeScript通过；ESLint为0错误、956条历史warning；生产构建首次在默认4GB Node堆OOM，使用8GB后编译成功并生成118/118页面。

本地已验证：提交期取消只补发一次、服务端确认前不伪报取消、取消拒绝后继续真实终态、取消后迟到完成不覆盖、嵌套错误可见、模拟进度定时器清理、浮窗桌面/窄屏/缩放/拖动约束及非数值比例无`NaN`。尚未验证：新提交在Coze的真实取消、数据库终态、一次退款和迟到供应商结果；因此本节是本地候选，不替代云端证据。

## 2026-09-01 精修取消云端尝试

真实Chrome只提交一次APImart `gpt-image-2`精修；`/api/refine-engine`立即HTTP 500并返回Coze平台结构`no sandbox ID found for taskID`。未取得应用taskId、未出现取消按钮、未调用`/api/cancel-task`，所以本次结果为`BLOCKED_NOT_EXECUTED`，不是取消成功或失败。UI错误呈现同时失败：面板跳到空结果页，未显示可理解错误，Console出现`Unexpected response: Object`。刷新项目页触发沙箱启动，随后按规则强刷原预览页却稳定复现`ERR_BLOCKED_BY_CLIENT`。没有重复任务或业务代码修改；权威扣费/退款证据仍待可用云端环境。机器证据见`evidence/refine-cancel-cloud-20260901.json`。

## 2026-09-01 方案A修复回归

**08:25真实增量：** Coze develop库原始行确认新精修为`completed/100`、charged 12、远端ID及扣费事务精确关联，退款0、余额4794；原只读消息未重发。原1254×1254成品仍在画布，PNG实际下载落盘1185536字节，哈希已记录，操作后Console错误/警告0。方案A正向链路通过；真实失败/取消/超时退款及竞争、远端原始响应、录像Trace仍未验，浮窗越界BUG-003未修复。未新增模型任务、扣费、构建或业务修改，最新证据见[方案A报告](REFINE_DURABLE_FIX_2026-09-01.md)。

**最终门禁：614文件、4569/4569通过，0失败、0跳过；TypeScript通过；Lint 0错误/956历史警告；38类保护通过；118页构建通过。** 证据索引：`evidence/refine-durable-fix-20260901.json`。本地隔离PostgreSQL已停止，云端实际结果未被本地结果替代。

原精修任务缺行RED已转绿；新增恢复、原供应商锁定、多图与超时消费者契约均先失败后修复。53项专项、12项真实隔离PostgreSQL测试通过；后者包含既有11项并发回归，不以缺少另一测试环境变量的跳过结果冒充通过。没有修改现有面板和登录流程。完整门禁及失败原件索引见[方案A实施记录](REFINE_DURABLE_FIX_2026-09-01.md)。Coze已同步相同tree/src tree、53专项及38保护通过，118页构建/3730服务回执已读；Chrome登录恢复、4806余额、源图与APImart选择已实测。平台自动交付后JS 500及控制断连阻止后续付费提交，真实精修结果与账务仍未验证，原成功品牌/优化任务不重复执行。

## 2026-09-01 精修异步断点复现（修复前）

新增原路由跨层回归 `refine-async-terminal-contract.test.ts`，最终6项3通过3失败、0跳过；任务缺持久化、creditCost未挂接和完成交付失败稳定复现。原终态守卫在测试存储补齐后正常交付，已取消任务不被迟到结果覆盖。新增测试ESLint及TypeScript通过，但业务仍未修复，当前工作区不是全量绿色；没有重跑旧全仓、重新构建或新付费请求。V5.8.8也缺该入口持久化，不吸收其先返回结果后尽力保存的旧逻辑。详细证据和待确认边界见[精修异步诊断](REFINE_ASYNC_TERMINAL_DIAGNOSIS_2026-08-31.md)。

## 2026-08-31 23:48 云端真实验收

3daa1043已由同一Coze任务完成同步/构建/重启，正确Chrome强刷后canvas-user登录和图片恢复正常。五接口7项真实负向请求均400且有明确错误，前后3条流水/4880余额不变。品牌APImart任务55秒完成2图，第一张先返回，保存后5图变7图、强刷结果保留，仅扣60；提示词大师APImartLLM成功、扣2。精修有效提交后返回“任务终态已变更”，扣12未见退款，登记V588-TOOLS-BUG-002，尚未修复，新增付费任务暂停。当前余额4806。

**结论不通过。** 字境仅入口/空输入及API拒绝，放大仅参数拒绝，成功效果/失败退款仍未验。未重跑既有4546项或重复同步；没有完整录像/Trace及最终Console，初始网络缓冲截断保留。详见[云端报告](TOOL_MINIMAL_CLOUD_2026-08-31.md)，不得把下方此前“云端未执行”作为最新状态。

## 2026-08-31 五接口最小修复回归

用户批准后实施，不重做历史诊断：同组59项由22通过/37失败转为59通过；初次扩展专项121项通过，独立审查后永久新增用例共76项。最终全仓612文件4546/4546通过、0跳过，类型/构建118页/保护38类通过，Lint 0错误/956历史警告。首轮全仓1项PSD测试等待竞态与中间测试基础设施错误均保留；PSD仅修改测试等待同一UI状态，没有改生产组件。业务源码仅5路由；详细证据见[实施记录](TOOL_MINIMAL_FIX_2026-08-31.md)与`evidence/tool-minimal-fix-20260831.json`。真实云端本轮未执行，不以隔离账务替身当真实退款证明。

## 2026-08-31 跨工具原路由与节点契约复现

新增放大/提示词优化，以及原工作流构建器串接原放大POST的测试，两版最终36项两次均12通过24失败、工具错误0。包含缺输入不扣费、异常退款与数字倍率可达对照。OBS-008/009取得各自证据后合并BUG-006；新增节点字符串倍率冲突BUG-001（P1）。首轮14项标准库导入隔离错误及中间4项donor导入隔离错误保留，非产品缺陷；不能把人工引擎异常500的对照通过说成放大成功。完整结果/18源码/6原件哈希见`evidence/tool-preflight-20260831.json`，解读见[跨工具审计](TOOL_PREFLIGHT_AUDIT_2026-08-31.md)。没有真实浏览器/数据库/供应商请求、无业务源码修改；原4470门禁不重跑、不覆盖本次失败。

## 2026-08-31 全工具覆盖补录

本轮仅静态审计与文档更新，未新增真实供应商测试。`test:inventory`刷新38保护大类、4页面、202路由、175组件、51节点、7 Agent工具、23媒体动作。AST逐按钮核对19个底部工具，清单首轮6个空格命名不匹配保留；按真实标签修正后无遗漏或重复。详细证据/边界见[全工具矩阵](TOOL_COVERAGE_MATRIX_2026-08-31.md)及`evidence/tool-coverage-20260831.json`。未重跑4470业务门禁，也未把品牌历史成功扩展为全工具通过。OBS-008/009只记录关联静态风险，未修复。

## 2026-08-31 预校验扣费隔离审计

执行当前/donor原完整POST及原credits辅助，两次完整18项均7通过/11失败；当前5项拒绝仍扣费、donor4项同类失败及2项返回500。SQL/认证/供应商边界隔离，网络/任务0，不是真实数据库或浏览器测试。首轮donor9项导入隔离错误保留，不计业务失败；修正测试边界后工具错误0。统一BUG-006，未修复；不重跑或覆盖旧4470通过记录。详见`V588_PROVIDER_003_PREFLIGHT_AUDIT.md`和`evidence/v588-provider-003-preflight-20260831.json`。

## 2026-08-31 21:53 品牌前端异常注入回归

正确Chrome原预览实际执行4个用例：首次402、重试402、非JSON 502、连接中断。前端收尾/原模板/完整或安全提示4项通过；英文网络提示另列OBS-007。四个请求均在浏览器Request阶段截断，不是4次真实API失败，更不是付费生成；不改真实账户余额制造失败。清除拦截后强刷，5图/2个新APImart标签、余额4880/3条流水均保持。BUG-002/003前端限定范围有条件通过，后端失败/退款仍未验。源码未变，不重跑4470门禁。网络缓冲截断、无录像/完整Trace及retry-402短暂截图保留；证据见`evidence/v588-provider-003-brand-negative-20260831.json`。以下连接失败和完全未验为历史。

## 2026-08-31 21:41 供应商隔离行为探针

新增只读验证：对当前main与只读V5.8.8执行相同7项原源码片段，共14项，12失败/2自动选择对照通过，两次完整输出一致、exit 1。结果不是全量门禁回归，不改写先前4470/4470原记录；证明其测试覆盖之外仍有配对问题。品牌辅助菜单/请求缺供应商升格BUG-005，字境/精修/品牌图像显式选择回退分别对应OBS-002/003/006。无真实网络、数据库、任务或扣费，不作浏览器/越权验收。证据`evidence/v588-provider-003-selection-probes-20260831.json`。原Chrome读取/重新接管超时，BUG-002/003新版负向场景仍未执行；没有重复成功生成或修改业务源码。

## 2026-08-31 21:28 品牌云端增量（当前）

fac43cbf已在正确Coze同步，合并c6b8cabb的tree/src tree匹配，Build ID D12Ets9rxSINh8SeuecwS；Coze报告32项专项、保护38/38、构建118/118通过。重启强刷后，Google Chrome原标签普通用户只提交一次APImart品牌任务ecom-1788182668572-7rblj5，47秒返回两张1254×1254，第一张提前显示。完成后改选Pear再入画布，新2图仍为APImart；真实项目保存5图与再次强刷恢复通过。BUG-004关闭，BUG-002/003新版负向场景未验。新增-60流水，余额4880；不等同于并发/退款验证。

24份原件哈希见`evidence/v588-provider-003-brand-cloud-20260831.json`。6段未截断业务窗口586事件、品牌POST1次、HTTP错误/已采集Console error/warn/Runtime异常/原生弹窗0；3条Coze脚本加载失败和既有积分NaN日期保留。首次加载采集截断、完整录像/Trace缺失，Coze报告13条本地依赖启动error，不宣称全程零错误。无新业务代码，本地4470项门禁不重复运行；全平台仍不通过。下方均为历史。

## 2026-08-31 品牌生命周期增量（历史本地门禁）

BUG-002/003/004源码9b2e8d5f已最小实现。独立基线20项新增测试18失败2通过；审查3处候选边界补4项RED后修复，最终5文件60项专项通过。**全量610文件4470/4470，0失败/跳过；类型、lint:build、保护38/38、118/118构建均退出0。** Build ID dNGo__zwtAR9eRFCqW_sO；隔离PostgreSQL已停止，中断留下2个测试schema已清理，剩余0。首轮11环境跳过、两个中间中止、各RED和夹具修正记录均保留。新候选尚未云端验证，不把本地测试算作真实API通过。证据：`evidence/v588-provider-003-brand-lifecycle-20260831.json`。

范围与实际断点统一维护在 `V588_PROVIDER_003_ACCEPTANCE.md`；下方20:20及更早记录为历史，不再按“未批准/未写测试”执行。

## 2026-08-31 20:20 当前增量

普通用户登录后已执行一次APImart品牌真实生成：ecom-1788178465802-0cblix，54秒，两张1254×1254，第一张在第二变体生成时已可见。一次添加画布后真实服务端复读与强刷均为3张，余额5,000→4,940，一条-60流水。本次8断言7通过1失败，新增供应商落图标签BUG-004；不与旧检查简单累加独立功能数。17份原件、580条网络事件及哈希见 `evidence/v588-provider-003-funded-apimart-20260831.json`。3条加载失败原始errorText为空，已采集Runtime/Console错误0、检查时无原生弹窗；无完整录像/Trace。只续未闭环项，不重复门禁或部署。

### 20:10 已完成的登录恢复

已通过管理员正常 UI 仅重置一次专用测试密码，并用新密码成功登录 `canvas-user`；密码只交付当前对话。普通用户仪表盘项目1/图片1、自身余额5,000，重置前后模型授权勾选相同。两张截图、两份DOM及哈希见 `evidence/v588-provider-003-user-restored-20260831.json`。登录与充值阻塞解除，没有提交供应商任务或修改源码；品牌真实结果仍未验。自身流水时间显示NaN的观察单列V588-CREDITS-OBS-002，不掩盖且不误判为扣费故障。

### 20:03 历史前置检查

正确 Google Chrome 原预览已恢复控制。新增3项前置核验通过：管理员正常登录及身份显示、测试账号余额与API一致、筛选后充值流水显示已完成。余额5,000、累计充值5,000、累计消耗0；代理充值0次、供应商新提交0次。当前退出管理员后仍是登录页，待测试账号会话，不用管理员替代普通用户验收。两张截图、两份DOM、一份筛选响应及哈希见 `evidence/v588-provider-003-credit-confirmed-20260831.json`。无录像/完整Trace；原品牌8项结果未因此改为通过。未改业务源码、不重复本地门禁或部署。

## 2026-08-31 18:10 Chrome真实品牌验收记录（历史）

- 正确Google Chrome原标签已恢复；Coze只读审计已读，tree/src tree仍对应98b6505d，平台同树重建Build ID prPBC-WqUj6VbG503mNY9。未重复同步、构建或本地4446项门禁，业务源码零改动。
- 8项检查：5通过（普通用户会话、Pear请求配对、APImart请求配对、APImart强刷字段、首次积分拒绝收尾），2失败（重试生命周期/模板身份、错误文字可读性），1阻塞（真实生成结果及后续保存/账务）。5次新POST全部真实402、无taskId，不计作5次成功生图。
- 重试失败2/2：正确供应商身份保留，但templateIds变为error，收到402后仍计时/按钮禁用，升级原OBS-004为BUG-002。原JSON截断提示登记BUG-003；均未修复。两次已用现有取消按钮停止假加载，未执行后台任务取消或退款验证。
- 新网络原件1027条去重事件含5条402、3条Coze注入资源失败和1条SSE取消；Console后段实录2条402资源error及1条应用error。早段未完整采集，不能宣称全程无错误。没有模拟结果、录像或完整Trace。截图两次超时、旧响应缓存缺失和游标筛选校正保留；最终按已观察requestId精确关联。
- 旧15:55未知提交因日志轮换/内存存储仍不可追溯，没有重发旧商品。余额0/品牌资产表0不能替代任务或扣费证明。最新证据与哈希在evidence/v588-provider-003-cloud-partial-20260831.json；下方16:03截图缺字段、连接不可用为历史，现已补证。整体结论仍不通过，未重开Stage4或PROVIDER-002。

## 2026-08-31 品牌图像供应商契约增量

- 基线main@05e8e721，源码树1a96fb9ab3e68243c53055ee963dee7e3ed5bf80。仅两个品牌组件最小修复；8项真实组件断言RED后专项36/36，新增用例不以模拟响应冒充真实生图。
- 新全量608文件4446/4446、0失败/跳过、退出0；独立PostgreSQL 18.4残留schema 0且已停止。类型及lint:build通过，变更文件0错误，警告13降至11；独立审查未发现本次新增缺陷，原重试收尾/LLM配对问题单列OBS-004/005。
- 原工作区默认4GB构建OOM、8GB重试主动终止，两份日志保留；相同src树与依赖的独立检出使用默认堆完整构建通过，118/118，退出0，Build ID WijQX292REV_i-p1mFp2L。未改构建规则或云端配置，未唯一定位原目录的具体影响文件。
- 功能保护38/38通过；首次两个组件未登记的阻断保留，仅增加本次两个精确批准路径，无目录通配或规则放宽。
- 16:03云端更新：98b6505d已在隔离Coze完成一次合并、专项8/8、保护38/38、118/118构建与重启，tree/src tree匹配；Build ID -RKRR5RMVc7od3z2_TDDr。原Chrome强刷后普通用户可用，品牌菜单Pear/APImart身份区分有DOM原件；APImart刷新保持有操作观察但截图未显示字段，需补证。首次chunk500/两条Console error保留，后续强刷可打开并不等于根因已修复。品牌提交控制超时，POST/taskId/扣费未知，未重复提交。三入口结果和账务均未闭环，录像/Trace未生成。云端原件哈希见 evidence/v588-provider-003-cloud-partial-20260831.json；本地门禁不重跑，PROVIDER-002/Stage4不重开。

## 2026-08-31 15:02 只读核对

PROVIDER-003 的 5 个路由、7 个 GET/POST 处理函数在拆分前、拆分后和当前源码间 AST 内容一致；首轮换行差异误判已单列。没有重跑旧全量门禁，新增云端业务测试数为 0，三个业务入口均未验证。Chrome 原连接失效，不把连接错误计作业务失败。完整断点及三个静态观察见 `V588_PROVIDER_003_ACCEPTANCE.md`，机器记录见 `evidence/v588-provider-003-readonly-audit-20260831.json`。没有修改业务源码或发起付费任务，以下 PROVIDER-002 验收结果继续有效。

## 2026-08-31 14:44 最新验收

- **PROVIDER-002专项通过，BUG-006关闭。** 新候选10bcc899已在正确Coze项目完成一次同步、54项专项、38项保护和118页构建；Build ID 4OF-bNvWAYIDbN_rSX47M、PID4223，未重复本地4438项全量门禁。
- Google Chrome原标签完成9项真实检查：普通用户重启会话、23/4模型精确目录、APImart/Pear两次选择保存刷新、临时选择退出和直接刷新、6条消息完全不变、画布Pear恢复、节点4节点1连线与Pear/Deepseek精确键恢复。未运行供应商任务或扣费。
- 最后14:43:55强刷：15个应用资源200，HTTP失败0，Console错误/警告、未捕获异常、原生弹窗均0；3条Coze注入脚本CSP拦截保留，不降低安全策略。各新候选验证窗口无事件截断，基线早期截断不隐瞒。
- 一次点击CDP派发前超时、一次跨刷新旧响应正文缓存失效单列为测试工具问题；先确认未点击再重试，以当前真实恢复GET复读模型。Coze认证来源7维相同不等于密钥逐字节证明，真实旧会话重启保持证据独立保存。
- 中文脱敏证据：`docs/testing/evidence/v588-provider-002-selection-cloud-20260831.json`，16份本地原件哈希。截图、网络和Console证据存在，未生成录像或完整Trace，不据此批准全平台发布。本轮业务源码零变更，不再部署纯证据提交。

## 历史记录：2026-08-31 13:10之后

- 88e77ed6在正确Coze项目完成17/17专项、38/38保护、118/118构建及单一5000服务重启；tree/src tree一致，Build ID BVKiKpGenK8DxHL6o_4cP、PID4427，11个页面静态资源200。这些是Coze报告，另有Google Chrome真实UI证据。
- 普通用户session role=user保持、目录57项与冻结基线精确一致。节点两图像菜单23/23、LLM4项，Pear/APImart双向切换后保存刷新保持，BUG-005菜单缺陷关闭；没有工作流RUN或供应商任务。
- 独立聊天的4项聊天、23项图像菜单可见且可选择，聊天Gemini2.5Pro刷新保持；图像APImart/Pear两次刷新均回AILINK，新增BUG-006，不能记通过。
- BUG-006只改chat-area选择状态与保存边界，新增7项组件回归。最终专项4文件54/54、0跳过；独立复审无保留Critical/Important。初始jsdom夹具错误、定位修正及真实断言RED日志均保留，不隐藏失败。
- 源码6f653d3b完整回归607文件4438/4438、0失败/跳过，直接Vitest进程退出0；118/118生产构建退出0，Build ID uqfJ0pErfsr9BNlyeVuFb。TypeScript与lint:build通过，变更文件0错误，chat-area既有warning由40变为39。隔离PostgreSQL测试残留0且已停止。
- 首轮全量JSON成功但外层进程退出1，原因未确认，保留原件；未改测试、未跳过，直接调用相同Vitest完整复验取得退出0。原工作区保护脚本包含既有未跟踪证据/参考库的41513项漂移也保留；没有删除用户文件或放宽白名单，在6f653d3b干净检出验证38/38、0漂移/警告。
- 新源码6f653d3b已推送GitHub main并复读一致，stable仍为52f7c601未动。云端复验未完成：原Google Chrome标签可枚举，接管先返回连接失效、诊断后重试超时；没有改用360、新建标签或发送重复Coze指令。仅待新候选同步、原预览强刷和既定验收，不重跑已完本地门禁。
- 本轮初始网络事件被截断，不能宣称完整网络零错误；后续dev日志读取为空。未生成录像/完整Trace，无taskId、无扣费。旧下文“节点新云端待验”已由本增量覆盖。

## 2026-08-31 普通用户模型目录与节点选择增量

- 普通用户已真实登录，role=user；目录57/57、画布图像菜单23/23。没有模拟普通用户身份或提交供应商任务。
- 节点同名选择冲突复现为BUG-005；RED8失败1通过，属性增补RED1失败9通过。独立审查补出旧项目直接执行裸键风险，新增3失败12通过后最小补齐提交副本消歧，不改已保存项目。
- 新全量回归使用仅监听127.0.0.1:55439的独立临时PostgreSQL，不访问云端或业务库；冻结候选607文件4431/4431通过、0跳过，残留schema 0且服务已停止。类型检查曾发现测试误用Testing Library的exact选项，已移除；失败日志保留。
- Coze断线弹窗及404单列环境中断；独立聊天、刷新/同密钥重启、录像/Trace仍待验。已完成管理员通知不重复。
- 冻结专项6文件89/89通过；构建版Lint退出0，直接检查三个变更文件为0错误/15条既有node-editor警告（基线相同，未隐藏或扩展规则）。源码042356cb生产构建退出0、118/118，Build ID为YDFfcIfnEmvlYYqVKDr4r；干净候选保护38/38、0漂移/警告。审查核对当前后端执行全部传入节点，因此保留全请求消歧，最终无保留Critical/Important；RUN子图范围历史风险单列V588-NODE-OBS-001，不混入本次已修复项。
- 完整脱敏证据及14份原件哈希见`docs/testing/evidence/v588-provider-002-node-selection-20260831.json`。新修复云端未部署验收；Chrome能列出正确原标签，但接管/读取持续超时，本地扩展与连接清单检查正常。不以本地通过替代云端通过，不为重获退出码重复构建。

## 2026-08-31 11:19 管理员通知云端验收完成

- 正确Google Chrome已有项目/预览标签完成 `main@865f61b7` 同步、构建重启和强刷，未操作360或新建标签。Coze报告tree/src tree匹配，Build ID `TmG3umX1DqmLPP46PXs2x`、5000 PID `3586`，专项6/6、保护38/38、构建118/118；交付后平台短版本 `7e4de55` 单独记录，不追逐元数据重建。
- 四类真实界面反馈通过：有效授权200、非法授权400、同名冲突409、单次POST网络中断。后两种服务端响应是真实后端返回；网络中断明确为受控故障注入。失败保持原勾选及存储值，最终图像/聊天授权恢复不限，角色、功能权限、积分和项目数不变。
- 初次截图早于通知动画或合成帧更新，未据此判定视觉通过。补充opacity=1、屏幕内且无遮挡检查，再逐帧截图并人工查看，最终四种提示文字都真实出现。共12条记录包含恢复与视觉复核，不计成12类不同功能；最终复读 `24252.17121` 仍保持原不限授权、积分与项目数。
- 11:13:13强刷的196条网络/运行时事件未截断，20个应用静态资源200；`/api/session` 实际返回success=true、role=admin，页面同时保持原管理员。Runtime控制台error/warning、异常与原生弹窗0；3条Coze注入外部脚本被CSP拦截单列，不隐藏，也不放宽CSP。
- **V588-PROVIDER-002-BUG-004通过并关闭。** 普通用户三工作区与刷新/重启仍未验证，录像/Trace未生成；整个吸收项及全平台发布不能据此通过。本轮未改业务源码、不重跑已完成本地全量、不创建供应商任务。证据与8份原件哈希见 `docs/testing/evidence/v588-provider-002-toast-cloud-20260831.json`。

下方较早检查点保留历史，不覆盖11:19结论。

## 2026-08-31 管理员通知漏挂载修复增量

`V588-PROVIDER-002-BUG-004` 云端 RED：无效授权请求 `24252.15195` 返回 400，歧义请求 `24252.15247` 返回 409，均无可见提示；原勾选保持，刷新复读仍是不限。没有模拟服务器响应。原始证据含账号资料仅本地保存，哈希和范围见 `docs/testing/evidence/v588-provider-002-toast-20260831.json`。

仪表盘通知容器 AST 合同先失败（5 通过/1 失败），补挂与画布一致的 Toaster 后专项 8 文件/61 测试通过。新源码 `da6c036c` 全量 606 文件/4414 测试通过，0 失败、0 跳过；隔离 PostgreSQL 测试残留 0 且已停止，TypeScript、lint:build、保护 38/38 通过，独立审查无发现。生产构建退出 0、118/118，Build ID `dNZjIQhoe13uW-4oz8Ubf`；两条 Node localstorage 路径 warning 保留。云端修复后未验证，Chrome 在构建结束后的重试仍接管超时。没有改认证、授权规则、供应商或账务。下方 10:25“无源码修改”只描述当时的服务端补证，不覆盖本次新修复。

## 2026-08-31 10:25 管理员模型授权边界增量

基线 `f91ada6b`，Google Chrome 既有正确 Coze 标签，未新建标签或操作 360。三个服务端检查通过：非法键 400/`MODEL_ASSIGNMENT_INVALID`、歧义裸键 409/`MODEL_ASSIGNMENT_AMBIGUOUS`、唯一裸键迁移为 Pear 精确键并持久化。前两项刷新复读整个用户完全不变，成功审计新增 0；迁移与恢复不限各新增 1 条成功审计。已恢复原用户图像/聊天不限，账号、角色、功能权限、积分和项目数不变。

这是真实 UI 请求加边界载荷替换后的真实云端响应，不是 Mock；只替换 `updates.imageModels`，没有代登录。期间一次 Coze `500 no sandbox ID found for taskID` 保留为基础设施失败，平台自动恢复后于 10:14:39 强刷原预览再验。完整 Coze 报告 HEAD `0fb594d8adf3f1b4397af489227355d0a5dfe9a7`，src tree 与基线一致，恢复后 Build ID `zumr8lQmGFdKeQvwxfbT6`、PID `2704`；没有人工重复构建。

**仍未验证：** 普通用户三工作区模型目录、刷新/重启保持；管理员 toast/即时勾选状态；本轮完整新鲜 Console/原生弹窗矩阵。未生成录像/Trace，因此不宣布完整 E2E 或整个吸收项通过。临时请求拦截已清空、暂停请求已继续。脱敏明细与三份本地原件哈希：`docs/testing/evidence/v588-provider-002-admin-cloud-20260831.json`。本轮仅更新记录，未修改业务源码、未重跑已完成全量门禁。

## 2026-08-31 07:55 Chrome 管理员投影验收完成

- `main@f91ada6b` 已完成生产构建 118/118 和重启。最后完整 Coze 报告 HEAD `735a4152bdcdc1fafb5d4f71ffef5a9824c3b27c` 的 tree/src tree 与 GitHub 目标匹配；Build ID `7y0nSmEYApVG3YwpZQeRI`、5000 PID `36266`。报告后出现的元数据短版本 `0fb594d` 如实记录，不将未读取的完整 SHA 冒充已核对版本，也不追逐元数据重复重建。
- 在既有 Google Chrome 标签真实点击用户、积分、数据、运营四页，均为 6 用户。读取页面实际请求的 6 份业务响应并逐用户比对，积分 6/6、项目数 6/6、有效活动日期 6/6；未修改数据。
- 07:47:32 与 07:51:35（北京时间）两次强刷，第二次在最后服务重启后执行；会话仍为管理员，用户字段保持一致。最后刷新采集未截断，Console error/warn 0、未捕获异常 0、原生弹窗 0。首次网络日志曾截断已如实保留；3 条 CSP 拦截来自平台注入外部脚本，未削弱 CSP。
- **ADMIN-004 通过并关闭。** 普通用户模型目录仍未验证：当前登录表单自动填充管理员，等待同一标签的普通用户登录；不使用管理员或模拟身份替代。
- **新增 V588-CREDITS-OBS-001，P2 未修复。** 统计分析图像类别显示 137%，分类总额 5878 与占比分母 3932 不同；仅证明只读统计口径问题，不宣称实际错误扣费。
- 截图、接口正文、网络和 Coze DOM 原件保存在本地，含用户资料不上传；脱敏汇总及 10 份 SHA-256 见 `docs/testing/evidence/v588-f91ada6b-coze-sync-20260831.json`。本轮未重跑已完成本地门禁、未修改业务源码、未创建付费任务。

## 2026-08-31 07:46 历史同步断点

- 已在 Google Chrome 既有正确 Coze 项目页发送并观察 `main@f91ada6b` 对齐，完整 tree 和 src tree 匹配。旧 `fa857e44` 的 post-done tree 已补齐，不再列为缺失。
- 新候选云端原始统计：专项 50/50；全仓 582 文件通过、24 文件跳过，4281 测试通过、132 PostgreSQL 测试跳过、0 失败，退出 0。类型、lint:build 和保护 38/38 通过。
- 云端缺少隔离数据库的 132 项仍为未执行，本地真 PostgreSQL 4413/4413 的证据独立保留。没有重复本地全量或修改业务源码。
- 后续读取时 Chrome 控制再次中断；已按支持流程重连但未恢复页面接管。构建、重启、强刷和新页面验收不能标成通过；恢复后只读现有 Coze 任务结果，不重新拉取或补跑已完成门禁。
- 证据：`docs/testing/evidence/v588-f91ada6b-coze-sync-20260831.json`。下方较早增量只作历史追溯。

## 2026-08-31 吸收清单只读复核

- 基线 `main@121b05620809e24a13777bc3f5291b9da9203e89`，生产源码未修改。没有重跑 4413 项全量或生产构建。
- 当前 193 个 `route.ts` 的 AST 导出合同 1/1；既有结果存储、字境常量与权威轮询专项 10/10。两份原始 JSON 报告及哈希记入 `v588-batch-a-status-reconciliation-20260831.json`。
- `6a9efa5e`、`c4b49293` 均为已验证云端候选 `fa857e44` 的祖先，证明拆分已合并且曾构建部署；这不是品牌/精修/字境真实生图成功证据。
- 已对齐 WASM 历史编号、认证冷启动和媒体软归档记录。只纠正证据范围，不补造原始 RED、浏览器动作或结果。
- Chrome 运行、扩展启用与本地 host 清单检查均通过，但原项目页的可见 DOM 读取仍超时；新补丁未拉取、未验收。

## 当前增量：2026-08-31 真 PostgreSQL 补证

- 范围为 `V588-ADMIN-004` 与 `V588-PROVIDER-002-BUG-003`，不是重开 Stage 4。
- 两次 RED 均证明 JSONB 空模型列表被存为对象：全量 `4408 passed / 1 failed`，聚焦 `18 passed / 1 failed`。
- 仅交换模型数组编码尝试顺序后，最终完整 Vitest 为 **606 文件 / 4413 测试通过，0 失败、0 跳过**；19 项本专项真库测试包含 JSONB/TEXT[]、空/NULL、并发 CAS、密码条件独立拒绝和管理员只读查询边界。
- TypeScript、构建版 Lint 和最终变更文件 Lint 均退出 0。临时 PostgreSQL 已停止，随机测试 schema 剩余 0；没有使用业务库。
- 生产构建退出 0，118/118 页面生成；干净候选 `bd9655b88ec037a0ebb6891addaba19a8280240f` 的保护基线 38/38、0 漂移、0 warning。云端管理员最后只读证据、新编码补丁与普通用户可见性仍未验证。本地真库测试不替代这些证据。
- 机器记录：`docs/testing/evidence/v588-admin-provider-postgres-20260831.json`。下方旧日期“最新状态”均为历史，不覆盖本增量。

> [!IMPORTANT]
> **2026-08-08 最新回归状态：全量测试仍有 5 个历史失败，不能视为全量通过。**
> Stage 0 新增专项测试 15/15 通过，没有新增全量测试失败；详细证据见 `docs/testing/STAGE_0_COMPLETION_REPORT.md`。

> 生成时间：2026-07-20
> 测试范围：全平台功能回归 + 跨浏览器兼容性
> 测试方法：E2E 自动化测试 (Playwright) + API 自动化测试 (Vitest)

---

## 2026-08-02 云端 Chrome：专业创作多图生成回归

| 场景 | 结果 | 关键验证点 |
|------|------|------------|
| 专业创作 x3 | 通过 | 3 个独立占位任务；首张先显示；最终仅 3 张结果。 |
| 专业创作 x4 | 通过 | 4 个独立占位任务；最终仅 4 张结果，无重复写入或空白框。 |
| 供应商归属 | 通过 | 全部结果显示 `gpt-image-2 / PearAPI 图像`。 |
| 刷新恢复 | 通过 | 保留 `projectId`，项目恢复后画布中 7 张刚生成图均存在。 |
| 浏览器异常 | 通过 | 任务开始、处理中、完成和刷新恢复阶段均未捕获 console `error` 或 `warn`。 |

本次使用真实已登录 Chrome 与真实 Pear `gpt-image-2` 供应商任务，未使用 Mock。

---

## 回归测试总览

| 测试类别 | 测试框架 | 测试用例 | 通过 | 失败 | 通过率 |
|---------|---------|---------|------|------|--------|
| E2E — Chromium | Playwright | 3 | 3 | 0 | 100% |
| E2E — Firefox | Playwright | 3 | 3 | 0 | 100% |
| E2E — WebKit | Playwright | 3 | 3 | 0 | 100% |
| API — 核心接口 | Vitest | 46 | 46 | 0 | 100% |
| API — 异常混沌 | Vitest | 21 | 21 | 0 | 100% |
| API — 安全测试 | Vitest | 31 | 31 | 0 | 100% |
| 静态检查 — TS | tsc | 1 | 1 | 0 | 100% |
| 静态检查 — Lint | ESLint | 1 | 1 | 0 | 100% |
| **合计** | — | **109** | **109** | **0** | **100%** |

---

## E2E 测试详情

### 测试矩阵

| 测试套件 | Chromium | Firefox | WebKit |
|---------|----------|---------|--------|
| p0-core (核心生成流程) | PASS | PASS | PASS |
| p0-auth-session (认证会话) | PASS | PASS | PASS |
| p0-user-data (用户数据持久化) | PASS | PASS | PASS |

### p0-core: 核心生成流程
**测试步骤**：
1. 用户登录（用户名+密码）
2. 选择生成模型（下拉菜单）
3. 输入提示词
4. 点击生成（Ctrl+Enter）
5. 验证生成任务提交成功
6. 验证画布显示 processing frame

**跨浏览器兼容性修复**：
- Chromium/Firefox: `selectOption` 直接触发 React onChange
- WebKit: 需要额外 `dispatchEvent(new Event('change', {bubbles:true}))` 后备
- 模型存储路径: `unbounded_ai_user_data.userData[userId].selectedModel`

### p0-auth-session: 认证会话
**测试步骤**：
1. 访问首页，验证重定向到登录页
2. 错误密码登录，验证 401
3. 正确密码登录，验证跳转
4. 刷新页面，验证 session 保持
5. 注销，验证重定向到登录页

**跨浏览器兼容性修复**：
- WebKit: `waitForLoadState('networkidle')` → `domcontentloaded` 避免 Protocol error
- WebKit: keepalive 错误模式添加到可容忍列表

### p0-user-data: 用户数据持久化
**测试步骤**：
1. 登录后创建新项目
2. 验证项目名称出现在界面
3. 刷新页面，验证项目数据从服务器恢复
4. 切换项目，验证数据隔离

---

## API 测试详情

### 核心接口测试 (46 项)

| 模块 | 测试项 | 通过 |
|------|--------|------|
| 认证 API | 正确凭据登录 / 错误密码 / 空用户名 / 空密码 / 注销 / 注销后session / 会话检查 | 7/7 |
| 生成 API | 正常提交 / 缺少模型(默认) / 未授权 / submitOnly模式 / 带参考图 | 5/5 |
| 轮询 API | 未授权 / 不存在任务ID / 有效任务 / 不存在返回cancelled | 4/4 |
| 用户数据 | 正常同步 / 读取验证 / 未授权 / 并发同步 / key前缀验证 | 5/5 |
| 任务取消 | 未授权 / 不存在任务 / 有效取消 | 3/3 |
| 图片保存 | 正常保存 / 未授权 / 大图保存 | 3/3 |
| 安全测试 | 401格式 / IDOR防护 / 路径穿越 / 重复提交防护 | 4/4 |
| 模型列表 | 图像模型 / LLM模型 / 未授权 | 3/3 |
| 视频配置 | 获取默认配置 | 1/1 |
| 健康检测 | 图像工具健康 / 视频API说明 | 2/2 |
| 其他 | 404处理 / 静态资源 / OPTIONS预检 / 工作流模型 | 4/4 |
| 模型列表详情 | 获取所有模型 / 图像模型过滤 | 2/2 |
| 注销 | 注销返回200 / 重复注销 | 2/2 |
| 会话续期 | 已登录session返回200 | 1/1 |

### 异常和混沌测试 (21 项)

| 类别 | 测试项 | 通过 |
|------|--------|------|
| HTTP错误码 | 404处理 / 405方法不允许 / 413超大请求体 | 3/3 |
| 模型异常 | 未知模型ID / 模型为空 / 不支持的操作 | 3/3 |
| 重复提交 | 并发生成 / 重复取消 | 2/2 |
| 操作中断 | 取消进行中任务 / 取消已完成任务 | 2/2 |
| 边界值 | 空提示词 / 超长提示词(50KB) / 特殊字符提示词 | 3/3 |
| 数据隔离 | 不同用户数据隔离 / 跨用户IDOR | 2/2 |
| 稳定性 | 多次登录注销 / 快速页面切换 / SSE降级 | 3/3 |
| 超时处理 | 慢响应不崩溃 | 1/1 |

### 安全测试 (31 项)

| OWASP类别 | 测试项 | 通过 |
|-----------|--------|------|
| A01 访问控制 | 未授权访问 / IDOR / 管理员保护 / API Key管理 | 8/8 |
| A02 加密机制 | Cookie HttpOnly / Secure / 密码哈希 | 3/3 |
| A03 注入 | SQL注入 / 命令注入 / NoSQL注入 | 5/5 |
| A05 安全配置 | HTTP头 / 错误信息 / 调试信息 / 默认凭证 | 4/4 |
| A07 身份认证 | 错误密码 / 空凭据 / 注销 / 并发 / 密码安全 | 5/5 |
| A08 数据完整性 | CORS / 请求体限制 | 2/2 |
| A10 SSRF | 内网IP检测 / 本地文件读取 | 2/2 |
| 路径穿越 | 目录穿越 / 空字节注入 | 2/2 |

---

## 修复回归验证

### BUG-001: WebKit Cookie 安全标志 (P0)
- **修复前**：WebKit 3/3 失败 (401 阻断)
- **修复后**：WebKit 3/3 通过 ✅
- **回归影响**：Chromium 3/3 通过，Firefox 3/3 通过（无回归）

### BUG-002: WebKit selectOption 兼容性 (P1)
- **修复前**：WebKit p0-core 模型选择失败
- **修复后**：模型选择正确，生成使用指定模型 ✅
- **回归影响**：无（仅影响 WebKit 测试代码）

### BUG-003: 模型选择存储路径 (P1)
- **修复前**：E2E 测试设置错误的 localStorage key
- **修复后**：使用正确的嵌套 key + UI 下拉菜单双重保障 ✅
- **回归影响**：无（仅影响测试代码）

---

## 静态检查回归

### TypeScript 检查
```
pnpm ts-check → 0 errors
```
- 修复了 `p0-core.spec.ts` 中 `isProcessingPlaceholder` 属性类型断言

### ESLint 检查
```
pnpm lint --quiet → 0 errors
```
- 所有源代码和测试代码均通过 lint 检查

---

## 测试环境

| 项目 | 值 |
|------|-----|
| 框架 | Next.js 16 (App Router) |
| 构建 | NODE_ENV=production |
| 端口 | 5000 |
| 数据库 | PostgreSQL |
| 测试用户 | Mr.joker |
| E2E 框架 | Playwright (Chromium/Firefox/WebKit) |
| API 测试框架 | Vitest |
| 测试日期 | 2026-07-20 |

---

## 结论

全部 109 项回归测试 **100% 通过**，无回归问题。修复的 6 个缺陷（1个P0 + 2个P1 + 3个P2）均未引入新的回归。跨浏览器兼容性验证通过（Chromium/Firefox/WebKit 三浏览器 E2E 全绿）。

## 2026-07-29 Task 9 增量回归结果

> 基线提交：`aefb36e91eb4f4d08a8d9dcceeaf11feb64ad310`
> 本地地址：`http://127.0.0.1:5000`
> 云端基线：`https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/`

| 检查项 | 结果 | 说明 |
|--------|------|------|
| `node scripts/doctor.mjs` | PASS WITH WARNINGS | 23 passed / 10 warnings / 0 failed；缺少本地生产密钥、数据库、对象存储和部署 URL |
| Pear/分层专项 Vitest | PASS WITH SKIP | 68 passed / 1 skipped；PostgreSQL 并发测试因无测试数据库跳过 |
| 分层 Playwright Chromium | BLOCKED | 在本地生产构建真实执行并生成 screenshot/video/trace/console/network；`POST /api/auth/login` 返回 503，缺少 PostgreSQL/生产鉴权配置 |
| 云端 Chrome 基线 | PARTIAL | `https://wjaigc.coze.site/` 已登录；图片工具栏存在“编辑元素”，但打开的是旧“PSD 分层编辑器”，未包含新版三模式契约 |
| 全仓 Vitest | PASS WITH SKIP | 关闭文件级并行以隔离 Sharp/fontconfig 原生资源竞争；233 files passed / 2 skipped；1066 tests passed / 2 skipped；0 failed；140.73s |
| TypeScript | PASS | `next typegen` 与 `tsc -p tsconfig.json` 通过，0 errors |
| ESLint | PASS WITH WARNINGS | 0 errors / 944 warnings；存量警告未伪装为零 |
| Next.js 生产构建 | PASS | Next.js 16.2.10，110 个静态页面，退出码 0 |

云端检查仅用于部署前基线，不是新版本验收。当前云端尚未包含本地领先提交，不能用旧版界面证明 `smart`、`cloud`、`local` 三模式通过。

**本次回归结论：有条件通过。** 本地自包含测试、类型、Lint 和生产构建已通过；真实 Pear 云端完成链路、PostgreSQL 并发幂等以及部署后跨浏览器证据尚未满足发布标准。

Task 9 审查修复后补充验证：TypeScript 0 errors、ESLint 0 errors、Next.js 16.2.10 生产构建通过并生成 110 个静态页面。ESLint 同时报告 944 个历史 warning。CI 已接入 Chromium 真实 Pear 用例、Firefox/WebKit 非付费分层回归和独立 HTTP API 套件；这些 CI 用例仍需在 GitHub Secrets 与新云端部署就绪后实际运行。

补充回归已覆盖快速双击同步互斥、干净 CI runner 数据目录和非受信任 PR 不读取付费 Secrets。GitHub Actions YAML 已使用结构化解析器验证。

## 2026-07-29 Pear 云端第二轮真实回归

| 检查项 | 结果 | 证据与边界 |
|--------|------|------------|
| 同源受控媒体读取 | PASS | 原 `Remote image returned HTTP 403` 已不再出现，任务进入模型目标解析 |
| Pear 提供商配置可见性 | FAIL（本地已修） | 管理员后台确认 `pear分层` 已启用、类型 `layer`、模型 `Image-Layered`；运行时仍报无可用模型 |
| 失败前扣费 | PASS | 积分重试前后均为 `9,987,596`，且失败发生在供应商提交前 |
| 真实 Pear 提交与 PSD 终态 | BLOCKED | 模型类型兼容修复尚未部署，未产生 Pear taskId 或 PSD |
| 相关专项测试 | PASS | 13/13：路由、工作流模型、授权、历史模型类型兼容 |
| 全仓 Vitest | PASS WITH SKIP | 234 files passed / 2 skipped；1068 tests passed / 2 skipped；0 failed；228.15s |
| PostgreSQL 真并发 | SKIPPED / BLOCKED | 2/2 测试因无隔离 `TEST_POSTGRES_URL` 跳过，不计通过 |
| Firefox/WebKit | BLOCKED | 预览域名对独立 HTTP warmup 返回 404，且无独立 E2E 登录凭据；未进入浏览器业务步骤 |

曾在一次独立审查运行中观察到 `annotation-execute` 5 秒超时，单文件运行通过，本轮完整串行门禁也通过。该现象尚未稳定复现，保留为运行波动风险，不据此做猜测性修改。

证据：

- `test-results/screenshots/pear-layering-cloud-provider-missing.jpg`
- `test-results/console/pear-layering-cloud-provider-missing.json`
- PostgreSQL 用例输出：2 tests skipped
- Firefox/WebKit 启动输出：`E2E server warmup failed with HTTP 404`

## 2026-07-29 09850e3 云端回归与本地修复

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 云端版本 | CONFIRMED | 本地与云端基线均为 `09850e396c12a53ea2157a0c5fe46c4ecb859d11` |
| Pear 模型可见性 | PASS | 云端可选择 `pear分层 / Image-Layered`，任务进入读取源图阶段 |
| Coze 同源媒体读取 | FAIL / LOCAL FIXED | 10:05、10:10 均在 5% 返回远程图片 403；改用部署配置公共域名后路由专项 8/8 |
| 失败任务终态 | PASS | 管理员云端任务监控显示两笔任务均为 `failed`，错误码 `UNSAFE_REMOTE_IMAGE` |
| 失败退款 | FAIL / LOCAL FIXED | 两笔各扣 15，无对应退款；结算 SQL 改为单次更新任务行并先锁积分账户，路由与结算专项 20/20 |
| TypeScript | PASS | `next typegen` 与 `tsc --noEmit` 通过 |
| 变更文件 ESLint | PASS | 0 error |
| 全仓 Vitest 首轮 | FAIL THEN FIXED | 1070 passed / 3 failed / 2 skipped；3 个失败为旧终态 SQL 契约，拆分活动与终态条件后专项已恢复 |
| 全仓 Vitest 最终 | PASS | 235 个测试文件、1075 项通过、0 失败；3 项真实 PostgreSQL 测试因本地无 `TEST_POSTGRES_URL` 跳过 |
| PostgreSQL 并发 | PENDING CI | 新增积分账户并发删除竞态；新单更新结算 SQL 必须重新跑 PostgreSQL 16 门禁 |
| Firefox/WebKit | BLOCKED | GitHub 未配置独立 E2E 地址、账号、密码与付费模型 Secrets |

当前结论仍为 **不通过**。必须部署新提交后完成 Pear 成功链路、失败退款和 PSD/2+ 图层验证。

## 2026-07-29 f8f7cef 云端复测与协议修正

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 真实 Chrome 重试 | FAIL / LOCAL FIXED | 同源黄色纸鹤图片仍在 0% 立即返回 `Remote image returned HTTP 403` |
| 根因验证 | CONFIRMED | 图片为当前预览页同源 `/api/serve-upload/...`；失败发生在 Pear 提交前 |
| 客户端媒体归一化 | PASS | 仅当前同源托管媒体转相对路径，跨域和非托管 URL 保持原样 |
| Pear 官方协议 | PASS | 主接口为 `/v1/images/edits`；请求体仅含 `model` 与 `image`；同步 PSD、异步 task 两类返回解析保留 |
| 分层专项 | PASS | 6 files / 43 tests passed |
| 全仓 Vitest | PASS WITH SKIP | 235 files passed / 2 skipped；1077 tests passed / 3 PostgreSQL skipped；0 failed |
| TypeScript | PASS | `next typegen` + `tsc` 通过 |
| ESLint | PASS WITH WARNINGS | 0 errors / 944 历史 warnings |
| 生产构建 | PASS | Next.js 16.2.10，110 个静态页面，退出码 0 |

本轮没有把本地测试当作云端 Pear 成功证据。新客户端代码部署前，PSD、2+ 图层、一次扣费、取消退款仍未验证。

## 2026-07-29 活动图片目标错位修复

| 检查项 | 结果 | 说明 |
|--------|------|------|
| Chrome 请求取证 | FAIL / ROOT CAUSE CONFIRMED | 当前选中纸鹤，但请求提交了历史 Hunyuan 3D URL；403 发生在 Pear 调用前 |
| 目标解析 RED/GREEN | PASS | 新增 2 项测试，证明当前单选优先且历史锁定目标保留兜底 |
| Pear/分层专项 | PASS | 10 files / 40 tests passed |
| 全仓 Vitest | PASS WITH SKIP | 236 files passed / 2 skipped；1079 tests passed / 3 PostgreSQL skipped；0 failed |
| TypeScript | PASS | `next typegen` + `tsc -p tsconfig.json --noEmit` 通过 |
| ESLint | PASS | `eslint . --quiet`，0 error |
| 生产构建 | PASS | Next.js 16.2.10，110 个页面生成完成，退出码 0 |

本地修复只证明目标选择逻辑和既有分层契约没有回归。云端仍需确认 POST 使用当前 `/api/serve-upload/...` 路径，并取得真实 Pear PSD、至少 2 个可编辑图层及结算证据。

## 2026-07-29 Pear 同步 ZIP 产物适配回归

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 当前图片请求 | PASS | Chrome 捕获的 POST 使用 `/api/serve-upload/uploads/gen-1784785107873-34qv4b.png`，不再使用历史 3D URL |
| Pear 后台取证 | ROOT CAUSE CONFIRMED | task `bd589fcd-4301-445f-ab29-1173b4a003ad` 同步运行 4m30s，成功返回 ZIP，浏览器侧连接先失败 |
| 协议 RED/GREEN | PASS | 强制 `task_type=async`、`response_format=url`；接受同步/异步返回的 PSD 或 ZIP artifact |
| ZIP 安全解析 | PASS | 主 PSD 选择、depth PSD 排除、条目/路径/解压大小限制、`8BPS` 签名校验均进入受测实现 |
| 分层专项 | PASS | 5 files / 34 tests passed |
| 全仓 Vitest | PASS WITH SKIP | 236 files / 1083 tests passed；2 files / 3 tests skipped；0 failed |
| TypeScript | PASS | `next typegen` + `tsc -p tsconfig.json`，退出 0 |
| ESLint | PASS WITH WARNINGS | 0 errors / 944 existing warnings，退出 0 |
| Production build | PASS | Next.js 16.2.10，110 个静态页面，退出 0 |

本地回归证明适配器不再把 Pear ZIP 当成无效 PSD，也不会让已知长任务默认走同步等待。部署后仍必须取得真实异步 taskId、阶段进度、ZIP 解包、2+ 可编辑图层以及单次扣费证据。

## 2026-07-29 Pear ZIP、租约与结算最终回归

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 真实 ZIP 离线回放 | PASS | 12,961,882 字节 ZIP；提取 117,970,772 字节主 PSD；1280x1280、29 图层、0 解析警告 |
| 内存边界 | PASS | ZIP 下载、解压、PSD 解析及细化共享单槽内存门；真实制品回放峰值 RSS 约 373 MiB |
| 初始提交幂等竞态 | PASS | 首次 Pear 提交租约随任务 INSERT 原子持久化；重复客户端轮询不能抢占或提前退款 |
| worker 租约 | PASS | heartbeat、owner-fenced 进度/完成/失败、失租中止和 attempt 文件清理均有回归 |
| smart fallback 结算 | PASS | fallback 阶段、余额退款和退款流水由同一 owner-fenced CTE 提交 |
| 分层及关联专项 | PASS WITH SKIP | 22 个测试文件；118 项通过，2 项 PostgreSQL 测试因无隔离测试库跳过 |
| 全仓 Vitest | PASS WITH SKIP | 535/535 个测试文件通过；1105 项通过、3 项跳过、0 失败 |
| TypeScript / ESLint | PASS | `next typegen`、`tsc`、`eslint . --quiet` 均退出 0 |
| Production build | PASS WITH WARNINGS | Next.js 16.2.10，110 个页面生成；存在既有动态文件追踪和超大组件告警 |
| 独立代码复审 | PASS | P0=0、P1=0；未发现本次 diff 的代码级发布阻断项 |

本轮未执行云端新代码的真实 Pear 异步成功/取消链路，因此发布结论仍不能升级为通过。
## 2026-07-29 Pear ZIP MIME 云端回归

| 检查项 | 结果 | 说明 |
|--------|------|------|
| Chrome 初始提交 | PASS | `/api/layered-decompose` 约 1 秒返回 HTTP 202 和无界 taskId，不再同步等待 4m30s |
| 异步阶段 | PASS | 首次响应为 `waiting-for-pear` 15%，首轮轮询为 27%，UI 显示 Pear 正在生成 PSD |
| ZIP 下载终态 | FAIL / LOCAL FIXED | 约 166 秒进入 `downloading-psd` 后被内部 MIME 集合拒绝，返回 `UNSAFE_REMOTE_IMAGE` |
| MIME RED/GREEN | PASS | `application/zip` 与 `application/x-zip-compressed` 两项测试先失败，再由最小白名单修复通过 |
| ZIP/PSD 与安全下载 | PASS | 2 files / 39 tests passed |
| 分层专项 | PASS | 6 files / 72 tests passed |
| TypeScript / ESLint | PASS | `next typegen`、`tsc`、`eslint --quiet` 均退出 0 |
| 全量 Vitest | PASS WITH ENVIRONMENT SKIPS | `pnpm test` 退出 0；真实 PostgreSQL 环境用例仍按既有规则跳过 |
| Production build | PASS | Next.js 16.2.10 编译成功并生成 110 个路由 |

当前结论仍为 **不通过**。异步提交已取得真实云端证据，但新 MIME 修复尚未部署；主 PSD 提取、可编辑图层、成功单次扣费和失败单次退款仍需部署后验证。

## 2026-07-29 Pear 双栈 DNS、ZIP 与 PSD 真实制品回归

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 双栈 DNS RED/GREEN | PASS | Coze 透明出口同时返回 `198.18.1.22` 与 `fdfe:...`；下载器现选择并固定允许地址，纯保留地址仍拒绝 |
| 真实 GET MIME | PASS | Pear CDN 返回 HTTP 200、`Content-Type: application/zip`、`Content-Length: 625723` |
| ZIP 安全下载 | PASS | 使用生产 `downloadPublicImage()` 与显式 ZIP 白名单完成下载，无重定向 |
| 主 PSD 提取 | PASS | 跳过 depth PSD，得到 `7,738,844` 字节主 PSD，签名为 `8BPS` |
| PSD 真实解析 | PASS | `ag-psd` 解析为 `1280x1280`、5 个可编辑图层，持久化 5 个 PNG，0 警告 |
| 编辑器云端终态 | PENDING DEPLOY | 需要部署本次提交后在预览页确认图层选择、隐藏、移动和导出 |

当前修复已在本地贯通 MIME、地址选择、ZIP 解压和 PSD 解析。发布结论仍为 **不通过**，直到预览页编辑器终态、一次扣费/退款、PostgreSQL 并发和 Firefox/WebKit 门禁完成。

## 2026-07-31 图片工具质量与双输出元素拆解本地门禁

测试基线为本地 `main`，HEAD `7bff3c0` 加当前未提交实现；最终部署提交将在本轮验证后生成。未将本地测试结果冒充云端结果。

| 检查项 | 结果 | 证据与边界 |
|--------|------|------------|
| 图片工具质量专项 | PASS | 9 files / 24 tests；透明 RGBA、去背景质量降级、显式擦除/蒙版、蒙版外像素保持、调色 alpha 与独立结果 |
| 双输出元素拆解专项 | PASS WITH SKIP | 9 files passed / 1 skipped；84 tests passed / 2 PostgreSQL tests skipped |
| TypeScript | PASS | `pnpm ts-check`，退出 0 |
| ESLint | PASS WITH WARNINGS | `pnpm lint`，0 errors / 945 warnings；存量 warning 未隐藏 |
| 全仓 Vitest | PASS WITH ENVIRONMENT SKIPS | 258 files passed / 3 skipped；1220 tests passed / 4 skipped；0 failed |
| Next.js 生产构建 | PASS WITH WARNINGS | Next.js 16.2.10；编译、TypeScript、111 个静态页面生成完成；本地持久化与 Node localStorage 参数有非阻断警告 |
| Git 差异检查 | PASS | `git diff --check` 退出 0；仅换行转换提示 |
| Chromium/Firefox/WebKit 用例发现 | PASS FOR DISCOVERY ONLY | 2 个新 spec、4 个项目共发现 48 个用例；未作为执行通过证据 |
| 云端图片工具像素结果 | NOT RUN | 必须部署后下载真实 PNG，用 Sharp 检查 alpha、蒙版外像素和持久化恢复 |
| 云端 Pear 双输出 | NOT RUN | 必须验证父请求、双分支、ZIP/PSD、2+ 图层、编辑与导出 |
| PostgreSQL 并发和结算 | BLOCKED | 缺少隔离 `TEST_POSTGRES_URL`，3 项真实数据库测试明确跳过 |
| Firefox/WebKit 真回归 | NOT RUN | 需部署版本和可访问测试凭据后执行 |

本地阶段结论：**有条件通过**。源代码、自包含测试和生产构建门禁通过；真实云端产物、数据库结算和跨浏览器门禁尚未完成。

## 2026-08-02 供应商任务可靠性回归

测试基线：工作树 `fix/provider-generation-reliability`，提交基线 `501a188` 加本轮未提交改动。

| 检查项 | 结果 | 证据 |
|------|------|------|
| 图像多输出专项 | PASS | 每张输出一个 durable 子任务、独立 slot、取消与逐张回填；专项 83 项通过。 |
| 视频同步/异步终态 | PASS | 同步视频 URL 直接完成；远端 ID 持久化后才进入内存轮询；失败/取消走原子退款。 |
| 视频重启边界 | PASS WITH SAFE FALLBACK | 未取得远端 ID 的持久化视频任务不会误轮询本地 ID，会终止并单次退款。 |
| 3D 事件流契约 | PASS | 断言已规范化换行符，仍验证关闭 `EventSource` 在失败回调之前。 |
| 全仓 Vitest | PASS WITH ENVIRONMENT SKIPS | `pnpm test`：295 files passed、1335 tests passed、3 files / 4 tests skipped、0 failed。 |
| TypeScript | PASS | 本轮代码完成后的 `pnpm ts-check` 已通过。 |
| ESLint | PASS WITH WARNINGS | 本轮代码完成后的 `pnpm lint`：0 errors / 949 warnings；warning 为存量，未静默隐藏。 |
| 生产构建 | PASS | 本轮代码完成后的 `pnpm build` 退出 0。 |

未执行或不能替代的项目：真实 PostgreSQL 多实例并发、真实供应商逐张图像返回/扣费退款、真实视频供应商同步与异步返回、已部署 Chrome/Firefox/WebKit 回归。

## 2026-08-02 多图生成真实云端回归与后续修复

| 检查项 | 结果 | 证据 |
|------|------|------|
| Pear `n=2` 真实提交 | PASS | 同一请求创建两个独立子任务：`async-1785669800411-0-j3ne6f`、`async-1785669800501-1-ezl1j5`。 |
| 两张结果逐张返回 | PASS | 两个不同 Pear CDN PNG URL 分别完成保存，时间不同；未将供应商结果误判为失败。 |
| UI 结果归并 | FAIL / LOCAL FIXED | 部署版本将两张结果重复为四层并在 `(0,0)` 重叠；已建立 RED/GREEN 回归并改为按结果 ID 去重的槽位归并。 |
| 供应商显示归属 | FAIL / LOCAL FIXED | 真实请求选 Pear，但 UI 显示 FHL；已在缺少 `providerName` 时保留显式 `providerId`。 |
| 定向回归 | PASS | 3 files / 11 tests passed。 |
| TypeScript | PASS | `pnpm ts-check` 退出 0。 |
| ESLint | PASS WITH WARNINGS | `pnpm lint`：0 errors / 949 warnings，均为既有存量。 |
| 全仓 Vitest | PASS WITH ENVIRONMENT SKIPS | 296 files / 1340 tests passed，3 files / 4 PostgreSQL tests skipped，0 failed。 |

### 2026-08-02 部署产物核对

`6eb061a93b43f60743f827a00fb1b8a94e4abd4d` 已推送至 GitHub `main`。部署后通过公开静态产物核对发现：

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 云端核心画布动态模块 | PASS | `https://wjaigc.coze.site/_next/static/chunks/1211.1104380f59eeaf6e.js` 与本地 `6eb061a` 构建的同名文件 SHA-256 均为 `27CB4FBBB762827E31EA757E78BFF3AE6912CE60FD8332504ADB3B603B1F6C48`。 |
| 槽位归并产物 | PASS | 云端模块包含已完成占位替换与结果 ID 去重路径。 |
| 供应商回填产物 | PASS | 云端模块包含 `providerName || providerId` 回退路径。 |
| 已登录 Chrome 真实 UI 回归 | BLOCKED | Chrome 进程、扩展和 native-host 检查均通过；但读取已登录预览标签、截图和控制台日志均在 30 秒内超时，无法取得浏览器交互证据。 |

### 2026-08-02 Pear `n=2` 云端修复验收

在同一 Chrome 用户会话中创建空项目 `project_1785672740345_w0o09zyjz`，选择 `Gpt Image 2 · PearAPI 图像`，设定 `3:4 / 2 张 / 高清`，并提交提示词“金色机械猫头鹰”。快速创作编译器所选 `deepseek-v4-flash / APImartLLM` 未给出可用编译结果，但产品正确降级为原始提示词，未阻断图像生成。

| 验收项 | 结果 | 真实证据 |
|--------|------|----------|
| 编译器不可用降级 | PASS | 面板显示“专业提示词编译暂不可用，已按原始需求提交图像生成”，随后进入生图，不将 LLM 供应商不可用误报为 Pear 图像模型错误。 |
| Pear `n=2` 最终结果数 | PASS | DOM 仅有两张猫头鹰图片；项目同步日志为 `project_1785672740345_w0o09zyjz ... canvasImages: 2`。 |
| 重复与重叠 | PASS | 结果 URL 分别为 `gen-1785673016023-ol4seq.png` 和 `gen-1785673016017-w0aer2.png`；位置分别为 `(810,232)` 与 `(1130,232)`，没有 `(0,0)` 追加或重复层。 |
| 供应商徽标 | PASS | 两张图均显示 `gpt-image-2 / PearAPI 图像`，没有 FHL 误标。 |
| 浏览器错误与弹窗 | PASS | Console `error`/`warn` 为空，未发现 JavaScript dialog。 |

结论：BUG-025 与 BUG-026 已取得真实云端 Chrome 通过证据。该结果不解除 PostgreSQL 并发结算、单子任务取消、`n=3/4`、真实视频及 Firefox/WebKit 等其余发布门禁。

### 2026-08-02 项目刷新恢复 BUG-027 本地修复

真实 Chrome 已稳定复现：项目 `project_1785672740345_w0o09zyjz` 成功保存两张 Pear 结果后，在画布直接刷新会回到“我的项目”；仪表盘仍显示该项目有 2 张图片。故障是当前项目路由状态缺失，不是项目数据或图片保存失败。

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 失败复现 | PASS | 刷新前为画布；刷新后 URL 仍为 `/?e2e=6eb061a`，页面为仪表盘；项目卡片仍显示 2 张图片。 |
| URL 回归测试 | PASS | 新增 `project-workspace-url.test.ts`，先验证模块缺失导致 RED，再实现并通过。 |
| 修复行为 | PASS（本地） | 成功 `loadProjectById()` 后使用 `history.replaceState` 写入 `projectId`，保留 `e2e` 等无关查询参数并移除 `view=dashboard`。 |
| 定向回归 | PASS | `project-workspace-url.test.ts` 与 `canvas-project-reopen-contract.test.ts` 共 4/4 通过。 |
| 全量质量门禁 | PASS WITH ENVIRONMENT SKIPS | Vitest 297 files / 1341 tests 通过；3 files / 4 PostgreSQL 环境用例跳过；TypeScript、生产构建通过；ESLint 0 error / 949 历史 warning。 |
| 部署后 Chrome 验收 | PENDING | 需要将本次修复部署后，用同一已保存项目刷新，确认 URL 含 `projectId` 且保持画布。 |
| Production build | PASS | `pnpm build` 退出 0，Next.js 16.2.10 生成 111 个路由；仅有既有 localStorage 路径警告。 |

结论：供应商多任务提交与逐张返回已取得真实证据；画布归并与供应商归属修复尚未部署，当前发布结论仍为**不通过**。

## 2026-08-02 供应商子任务取消与供应商归属修复（待部署）

测试基线：工作树 `fix/provider-generation-reliability`，基线提交 `cd0084f` 加本轮未提交修复。

| 检查项 | 结果 | 证据 |
|------|------|------|
| 单槽取消失败复现 | FAIL（已复现） | 云端专业创作 `n=2` 中取消第一个槽位后，`async-1785677224469-0-v7lzrk` 和 `async-1785677224475-1-lv1r88` 均被轮询为 `completed`。 |
| 前端取消接线 | PASS（本地） | 进度卡片取消统一通过 `taskEventsClient.cancelTask(taskId)`；仅在后端确认成功后才删除占位框。 |
| durable 取消/退款终态 | PASS（本地） | `cancel-task.test.ts` 覆盖数据库条件式取消、终态保护和一次性退款。 |
| 供应商名称规范化 | PASS（本地） | 持久化任务以 `providerId` 为主反查展示名，历史 `FHL图像模型` 不能覆盖 Pear ID。 |
| 专项回归 | PASS | 5 files / 22 tests passed：取消 UI 契约、取消 API、逐张回填、轮询持久化恢复、展示名解析。 |
| 全仓 Vitest | PASS WITH ENVIRONMENT SKIPS | `pnpm test`：299 files / 1348 tests passed；3 files / 4 PostgreSQL 环境用例 skipped；0 failed。 |
| TypeScript | PASS | `pnpm ts-check` 退出 0。 |
| ESLint | PASS WITH WARNINGS | `pnpm lint`：0 errors / 949 warnings；没有新增 lint error。 |
| 生产构建 | PASS | `pnpm build`：Next.js 16.2.10 完成编译、类型检查与 111 个路由构建。 |
| 云端真实取消、退款、迟到完成 | PENDING DEPLOY | 必须部署后提交 Pear `n=2`，取消一个槽位，确认 `/api/cancel-task` 成功、仅幸存槽位完成、被取消槽位不被迟到结果覆盖，并核对一扣一退账务流水。 |

本阶段不把本地契约测试当作真实供应商结算通过证据。发布结论仍为 **不通过**，直到上述部署验证、PostgreSQL 并发与跨浏览器回归完成。

## 2026-08-02 云端单槽取消复验失败与二次修复（待部署）

测试基线：云端为 GitHub `main` 的 `98ba6c2`；本地工作树为 `fix/provider-generation-reliability`，包含待随本次提交部署的最小修复。

| 检查项 | 结果 | 证据 |
|------|------|------|
| Pear `n=2` 单槽取消 | FAIL（云端） | 在项目 `project_1785676375816_qvjpfv81z` 提交两个槽位 `async-1785680404674-0-wa2qo6`、`async-1785680404748-1-7ruits`。5% 时取消第一个槽位，页面短暂只保留一个卡片；重新打开项目后仍出现两张机械怀表结果。 |
| 供应商展示归属 | PASS（同次观察） | 两张实际结果均显示 `gpt-image-2 / PearAPI 图像`，未出现旧 FHL 名称。 |
| 失败证据 | CAPTURED | `test-results/screenshots/cloud-cancel-n2-2026-08-02.png`；Chrome Console 持续轮询两个 taskId，证明被隐藏槽位没有完成持久化取消。 |
| 取消冲突回归（RED） | PASS | 新用例先在旧行为下失败：预期 `409`，实际取得 `200`。 |
| 取消冲突回归（GREEN） | PASS | `cancel-task.test.ts` 7/7 通过：数据库终态转换未成功时返回 `409`，不调用内存取消。 |
| 供应商可靠性组合回归 | PASS | `cancel-task`、渐进回填、取消 UI 契约、云任务存储、输出数量共 5 files / 35 tests 通过。 |
| TypeScript | PASS | `pnpm ts-check` 退出 0。 |
| 全量测试、Lint、构建 | PASS WITH KNOWN LIMITS | `pnpm test`：299 files / 1349 tests 通过，3 files / 4 PostgreSQL 并发用例因无隔离数据库跳过；`pnpm lint`：0 errors / 949 warnings；`pnpm build`：111 条路由构建完成。 |
| 自动保存快照配额 | NEW P2 | 项目恢复 Console 重复出现 `wujie_autosave_snapshots_v1` 的 `QuotaExceededError`，已登记为 BUG-031，未与本次 P1 修复混合。 |

结论：`98ba6c2` 未通过真实单槽取消门禁。新的本地状态机修复必须先完成全量门禁、推送与部署，然后以同一真实 Pear `n=2` 场景重新验证“仅幸存槽位落图、取消槽位不回写、账务一次扣费/一次退款”。

## 2026-08-02 底部图像生成器多图槽位与显式提供商路由

测试基线：工作树 `fix/provider-generation-reliability`，待提交源码；云端此前部署版本已针对 Pear `gpt-image-2` / 数量 2 稳定复现。

| 检查项 | 结果 | 证据 |
|------|------|------|
| 失败复现：单占位框 | PASS（已复现） | 底部图像生成器设置数量 2 后，旧云端仅显示一个处理框，不能代表两个可取消子任务。 |
| 失败复现：显式 Pear 路由风险 | PASS（已复现） | 旧客户端路径可丢失明确提供商约束，历史真实观察中出现 Pear 选择与 FHL 标识/路由不一致。 |
| 每槽位独立处理框契约 | PASS（本地） | `infinite-canvas-direct-generation-contract.test.ts` 断言每个 `slots` 返回值创建一张带 `processing.taskId` 的画布卡片。 |
| 旧包装器隔离 | PASS（本地） | `generationChannel: "canvas-direct"` 不再进入 `WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER` 外层包装分支。 |
| 显式提供商不跨路由 | PASS（本地） | `generate-explicit-provider-contract.test.ts` 断言显式 provider 缺失凭证时直接失败，不能选择候选列表中无关提供商。 |
| 定向回归 | PASS | 6 files / 30 tests passed。 |
| TypeScript | PASS | `pnpm ts-check` exit 0。 |
| ESLint | PASS WITH WARNINGS | `pnpm lint` exit 0；0 errors / 949 historical warnings。 |
| 全量 Vitest | PASS WITH ENVIRONMENT SKIPS | 301 files / 1354 tests passed；3 files / 4 PostgreSQL 环境测试 skipped。 |
| 生产构建 | PASS | `pnpm build` exit 0；Next.js 16.2.10 构建完成 111 条路由。 |
| 云端 Chrome 验收 | PENDING DEPLOY | 当前“云端已部署”发生在本地新修复推送之前；需要推送、拉取并重新部署后执行。 |

本轮结论：本地回归通过，但完整平台发布结论仍为 **不通过**。不得用构建成功替代真实 `n=2` 子任务取消、账务一次性结算和提供商归属验收。

## 2026-08-02 云端证据：canvas-direct 多槽位与终态解锁

| 验证项 | 结果 | 证据 |
|------|------|------|
| Canvas-direct `n=2` 槽位创建 | 通过 | Chrome 同时出现 `生成图片 1/2`、`生成图片 2/2` 两个独立处理框，各自有取消入口。 |
| 渐进式供应商回填 | 通过 | 两个不同的 Pear CDN PNG URL 返回到画布，证明显式 `PearAPI 图像 / gpt-image-2` 产生了两个真实输出。 |
| 所有可见结果完成后解锁生成器 | 失败，BUG-034 | 两个处理框均消失、两个结果均可见后，提交按钮仍禁用并显示“生成中…”。 |
| 根因回归 | 本地通过 | 新增 RED/GREEN 契约，要求 `success` 和 `succeeded` 与 `completed` 一样结束槽位。 |
| 定向可靠性回归 | 通过 | 6 文件 / 31 测试，覆盖输出数量、显式供应商路由、幂等、取消 API、取消 UI 与 canvas-direct 槽位。 |
| 全量质量门禁 | 通过但含环境跳过 | Vitest 301 files / 1355 tests passed；3 个 PostgreSQL 专用文件 / 4 项跳过；TypeScript 通过；ESLint 0 errors / 949 historical warnings；生产构建完成 111 条路由。 |

结论：云端已证明多槽位实现生效，但 BUG-034 说明该部署版本未通过连续生成门禁。必须部署本次终态归一化修复，之后再尝试单槽取消场景。
## 2026-08-02 Provider Generation Reliability Follow-up

| Check | Result | Evidence |
|---|---|---|
| Provider ID is persisted separately from the display label | PASS (local) | 6 direct-generation contract assertions passed. |
| Recovery polling ignores fresh in-memory placeholders | PASS (local) | `resumed-task-polling.test.ts` passed. |
| Cancellation is isolated per canvas task slot | PASS (local) | 4 cancellation contract assertions plus 7 cancel API tests passed. |
| Autosave snapshots do not retain raw data/blob image payloads | PASS (local) | 2 quota contract assertions passed. |
| Full regression | PASS WITH ENVIRONMENT SKIPS | `pnpm test`: 302 files / 1359 tests passed; 3 PostgreSQL files / 4 tests skipped because an isolated test database is not configured. |
| Deployment evidence | PENDING | Must repeat a real Pear `n=2` flow, cancel exactly one slot, verify provider attribution, refresh recovery, ledger settlement, and browser console. |

## 2026-08-03 Cloud Regression: provider attribution failure reproduced

| Check | Result | Evidence |
|---|---|---|
| Direct submission route | PASS | `/api/generate` sent `providerId: api_1780630178347_rjqlmam`, `model: gpt-image-2`, `n: 2`, `generationChannel: canvas-direct`. |
| Two durable slots | PASS | Two distinct task IDs were created and independently polled with the same Pear provider ID. |
| Provider attribution after completion | FAIL, BUG-037 | Both results returned from Pear CDN, but final poll payloads carried empty `providerName` and canvas cards displayed FHL. |
| Browser console | PASS | No error-level console entries were observed during this run. |
| Cancellation timing | UNVERIFIED | Both 1K tasks completed before a single cancel action could be issued; no cancellation outcome is claimed from this run. |

The follow-up patch preserves the configured provider when the completion response omits or blanks provider metadata. Local focused regression is green; deployment verification remains required.

## 2026-08-03 BUG-037 Local Verification Gate

| Check | Result | Evidence |
|---|---|---|
| Empty completion provider metadata regression | PASS (local) | `infinite-canvas-direct-generation-contract.test.ts` asserts that blank `providerName` falls back to the selected provider label. The test was observed failing before the non-empty guard was implemented. |
| Full Vitest suite | PASS WITH ENVIRONMENT SKIPS | `pnpm test`: 302 test files / 1360 tests passed; 3 PostgreSQL-specific files / 4 tests skipped because no isolated `TEST_POSTGRES_URL` is configured. |
| TypeScript | PASS | `pnpm ts-check` exited 0. |
| ESLint | PASS WITH HISTORICAL WARNINGS | `pnpm lint` exited 0 with 0 errors and 949 existing warnings. |
| Production build | PASS | `pnpm build` completed compilation, TypeScript validation, and 111 routes. |
| Cloud verification | PENDING DEPLOYMENT | The deployed `2270162` build cannot contain this local BUG-037 patch until it is pushed and redeployed. |
## 2026-08-03 Deployed Provider and Cancellation Check

| Check | Result | Evidence |
|---|---|---|
| Provider attribution | PASS (cloud) | A fresh direct-canvas Pear `gpt-image-2` `n=2` run completed two cobalt-blue cup cards, both labelled `PearAPI 图像`. |
| Independent task slots | PASS (cloud) | Two visible cards appeared at `processing 0%`, each with a separate Cancel action. |
| Single-slot cancellation | FAIL, BUG-038 | Cancel was clicked on the first slot while both were processing. Both tasks subsequently completed. |
| Server error visibility | PASS (local), pending deployment | The cancellation client now preserves an API `error` field as the UI-facing message. Focused suite: 14 tests passed. |

The cancellation failure is an application release blocker, not a provider failure: the Pear provider completed both tasks normally.

## 2026-08-03 Canvas Reference/Fusion Group Regression

| Check | Result | Evidence |
|---|---|---|
| Modifier gesture enters group creation before image drag | PASS (local) | `canvas-group-gesture-contract.test.ts` verifies the root pointer-down path dispatches Alt to reference groups and Ctrl/Cmd to fusion groups. |
| Blank-canvas long press restores panning | PASS (local) | The same contract verifies timer setup, movement cancellation, and pan activation. |
| Group titles remain draggable | PASS (local) | Ordinary and generation-group headers now use pointer capture. |
| Empty prompt group generation | PASS (local) | A selected model is sufficient; reference/fusion fallback prompts are used when the user has not typed an instruction. |
| Reference content recognition | PASS (local wiring) | The group action calls `/api/vision-prompt`, persists descriptions by image ID, and reuses them in the corresponding generation request. |
| Parallel group isolation | PASS (local) | Generation metadata is invocation-local rather than stored in a shared ref. |
| Full regression | PASS WITH ENVIRONMENT SKIPS | `pnpm test`: 303 files / 1367 tests passed; 3 PostgreSQL-specific files / 4 tests skipped because no isolated `TEST_POSTGRES_URL` is configured. |
| TypeScript / lint / build | PASS WITH HISTORICAL WARNINGS | `pnpm ts-check` and `pnpm build` passed; `pnpm lint` reported 0 errors and 949 existing warnings. |
| Cloud browser evidence | PENDING DEPLOYMENT | Validate Alt and Ctrl/Cmd grouping, title dragging, reference recognition, reference generation, fusion generation, and a persisted project reload. |

## 2026-08-03 Group Control Regression Gate

| Check | Result | Evidence |
|---|---|---|
| Image-group interaction boundary | PASS (local) | `data-toolbar="image-group"` prevents the root canvas `pointerdown` handler from consuming Collapse and Close actions. |
| Reference/fusion interaction boundary | PASS (local) | `data-toolbar="generation-group"` preserves model-menu clicks until their own click handler commits the selected model. |
| Pointer-drag compatibility | PASS (local contract) | Existing title drag handles still use pointer capture; the fix only short-circuits the root pointer-down start handler for control-originated events. |
| Focused regression | PASS | 6 test files / 24 tests: group gestures, image dragging, progressive generation, generation reconciliation, batch construction, and progressive polling contract. |
| Full local gate after BUG-040 | PASS WITH ENVIRONMENT SKIPS | `pnpm ts-check`, `pnpm lint` (0 errors / 949 historical warnings), `pnpm test` (303 files / 1368 tests passed; 3 PostgreSQL files / 4 tests skipped without `TEST_POSTGRES_URL`), and `pnpm build` all passed. |
| Cloud browser acceptance | PENDING DEPLOYMENT | Validate image/reference/fusion Collapse and Close, select a group model, generate, drag the title, save, and refresh. |

This gate does not claim provider generation or billing acceptance. The next real `n=2` browser run must use an enabled provider and prove separate task slots and progressive result arrival after group controls are confirmed.

## 2026-08-03 Group Zoom and Fidelity Gate

| Check | Result | Evidence |
|---|---|---|
| Scaled group configuration menus | PASS (local) | Aspect ratio, resolution, quality, and output-count use `CanvasScaledMenuSelect` within the canvas transform tree. |
| Independent reference categories | PASS (local) | `buildGroupReferenceRequestControls` preserves `style: 85` and `subject: 20` independently instead of collapsing both to `85`. |
| Full fusion preservation contract | PASS (local) | Every fusion source receives all six categories at `100` and strict request strength `0.05`. |
| Reference-description alignment | PASS (local) | Blank descriptions are retained as placeholders so source image indexes do not shift. |
| Verification | PASS WITH ENVIRONMENT SKIPS | TypeScript, ESLint error gate, full Vitest (305 files / 1374 tests passed; 3 PostgreSQL files / 4 tests skipped), and production build passed. |
| Cloud acceptance | PENDING DEPLOYMENT | Verify menu scaling at two zoom levels, per-category reference behavior, fusion preservation, and a real `n=2` request. |

## 2026-08-03 Image Generator Reference-Constraint Gate

| Check | Result | Evidence |
|---|---|---|
| Reference description positional alignment | PASS (local) | Empty descriptions remain placeholders, so reference #2 can never be attached to reference #1. |
| Per-reference category ownership | PASS (local) | The compiler emits numbered reference blocks; style/composition on reference #1 and subject/detail on reference #2 are not merged. |
| Model-language adaptation | PASS (local) | Chinese-native provider/model IDs produce Chinese constraints; English-native IDs produce English constraints; unknown IDs receive compact bilingual constraints internally. |
| Durable async task recovery | PASS (local) | Both generation submission payload forms persist `referenceCategoryStrengths`. |
| Focused generation suite | PASS | 6 files / 23 tests passed. |
| Full local quality gate | PASS WITH ENVIRONMENT SKIPS | `pnpm ts-check`, `pnpm test` (307 files / 1,380 tests passed; 3 PostgreSQL files / 4 tests skipped), and `pnpm build` passed. `pnpm lint` exited 0 with 949 historical warnings. |
| Cloud acceptance | PENDING DEPLOYMENT | Use an enabled Chinese-native image model and an enabled English-native image model with two reference images, different selected categories, and a successful generated result for each. |

## 2026-08-03 Reference/Fusion Error Transparency Gate

| Check | Result | Evidence |
|---|---|---|
| Missing provider route preflight | PASS (local) | A generation group with a selected model but no `providerId` is stopped before `/api/generate`, with a visible model-selection recovery message. |
| Provider/task failure visibility | PASS (local) | The group polling loop retains terminal task detail instead of replacing it with `生成失败，请检查模型和API配置`. |
| Nested polling payload compatibility | PASS (local) | `result.message` is recognized when top-level `error` is absent. |
| Focused regression | PASS | 2 files / 5 tests for failure-message behavior; 4 group/reference-chain files / 18 tests passed. |
| TypeScript | PASS | `pnpm ts-check` completed successfully. |
| Cloud acceptance | PENDING DEPLOYMENT | Submit one real reference-group request with an enabled provider and save the returned status/error, request ID, provider ID, and model ID. |

## 2026-08-03 Shared Reference-Image Transport Gate

| Check | Result | Evidence |
|---|---|---|
| Reference payload ordering | PASS | RED/GREEN route contract requires `requestBody.image` to be assigned before `filterRequestForModel()` creates the submitted body. |
| Bottom generator forwarding | PASS (code-path trace) | `GenerationPanel` forwards `referenceImages` through `GenerationParams`; `CanvasWorkspace` submits `{ ...params }` to `/api/generate`, so it uses the same repaired server path as reference/fusion groups. |
| Provider endpoint compatibility | PASS (local) | The capability layer now receives `image` and `image_urls` after reference normalization, allowing `/images/edits` to receive its required image input and preserving fallback reference inputs. |
| Full local quality gate | PASS WITH ENVIRONMENT SKIPS | `pnpm test`: 309 files / 1,386 tests passed; 3 PostgreSQL files / 4 tests skipped without `TEST_POSTGRES_URL`. `pnpm ts-check`, `pnpm lint` (0 errors / 949 historical warnings), `pnpm build`, and protected-file self-check (8/8) passed. |
| Cloud acceptance | PENDING DEPLOYMENT | Submit one bottom-generator reference request and one canvas reference-group request using enabled configured models. Each must reach a provider task without `Missing required parameter: image`; retain any subsequent exact provider response. |

## 2026-08-03 Provider/Model Routing Consistency Gate

| Check | Result | Evidence |
|---|---|---|
| Stale model selection recovery | PASS (local) | The generator reconciles a stale persisted `providerId::modelId` against `/api/models?type=image` and writes the valid replacement into both existing local-storage caches. |
| Explicit provider/model validation | PASS (local) | `/api/generate` rejects a provider/model combination not configured on the requested provider with `MODEL_PROVIDER_MISMATCH` before generation-batch creation and credit/task persistence. |
| Generation recovery and idempotency regression | PASS (local) | Focused suite: 9 files / 55 tests passed, including progressive polling, recovery lease, idempotency, and resumed-task polling. |
| Full local quality gate | PASS WITH ENVIRONMENT SKIPS | `pnpm ts-check`, `pnpm lint` (0 errors / 949 historical warnings), `pnpm test` (311 files / 1,389 tests passed; 3 PostgreSQL files / 4 tests skipped without `TEST_POSTGRES_URL`), and `pnpm build` passed. |
| Coze browser acceptance | PENDING DEPLOYMENT | Verify that the visible selected model exactly matches the `providerId` and `model` in `/api/generate`; then verify a valid configured request reaches a provider task and a deliberately stale pair is rejected before task creation or charge. |

This gate closes one confirmed application-routing defect. It does not yet classify all future provider failures: a real deployment test must retain the provider response, app task ID, remote task ID, and terminal transition timing before attributing a failure to the provider or to Wujie.

## 2026-08-04 RemoveBG and Layer Artifact Gate

| Check | Result | Evidence |
|---|---|---|
| Dedicated RemoveBG routing | PASS (local) | Dedicated `removebg` providers are kept out of generic image-generation candidates and are invoked through the dedicated adapter. Explicit provider selection has priority and user model authorization is checked. |
| RemoveBG output and billing contract | PASS (local) | Both action aliases use `image_remove_bg`; successful dedicated results return provider/model/engine metadata and persist RGBA plus alpha mask. `ai` and `ai-only` do not silently fall back to CPU. |
| Pear layered artifact handling | PASS (local) | Pear submission requests asynchronous URL results; PSD and ZIP artifacts are accepted; ZIP entry count, path, MIME, decompressed size, PSD signature, primary/depth selection, and legacy persisted URL compatibility are covered. |
| Focused RemoveBG suites | PASS | 3 files / 17 assertions passed. |
| Focused Pear/layer suites | PASS | 5 files / 50 assertions passed. |
| Full regression | PASS WITH ENVIRONMENT SKIPS | `pnpm test`: 320 files / 1,435 tests passed; 3 PostgreSQL-specific files / 4 tests skipped because no isolated PostgreSQL URL is configured. |
| Production build | PASS | `pnpm build`: Next.js 16.2.10 compiled, type checked, generated 112 static pages, and collected all dynamic routes. |
| Cloud browser acceptance | PENDING DEPLOYMENT | Real provider output, alpha quality, Pear ZIP download/extraction/editor opening, PostgreSQL terminal transitions, and billing/refund records require the deployed environment. |

The four task-durability source-order contracts now use branch-scoped whitespace-tolerant matching rather than fixed indentation. They still assert that durable database writes occur before in-memory completion or polling publication; no production task-state logic was relaxed.

---

## 2026-08-05 Acceptance Chain (`7d88625`)

| Check | Result |
|-------|--------|
| `pnpm install --frozen-lockfile` | PASS (restored pruned nested `safe-buffer`; local page returns 200) |
| `pnpm doctor` | 23 passed / 10 environment warnings / 0 failed |
| `pnpm lint` | 0 errors / 951 legacy warnings |
| `pnpm ts-check` | PASS |
| `pnpm test` | 1,479 passed / 4 skipped / 0 failed |
| `pnpm test:api` | 335 passed / 3 skipped / 0 failed |
| `pnpm test:regression` | 1,104 passed / 1 skipped / 0 failed |
| `pnpm build` | PASS |
| Playwright login-entry contract | 8 cases; 6/8 on first run, isolated reruns pass (Chromium flake) |
| Paid P0 E2E | BLOCKED (credentials, paid-generation env, and local DB not configured) |
| Cloud smoke | BLOCKED (preview returns 404 `instance_not_found`) |

## 2026-08-09 Stage 1 Task 8 gate update

| Check | Result | Evidence |
|---|---|---|
| Release-gate contract | PASS | 3/3 tests validate real E2E inputs, manual external CI, and exact source allowlisting. |
| Protected functionality | PASS WITH WARNING | 38/38 protected feature IDs remain; no missing literal component or evidence path. Baseline metadata SHA requires later refresh. |
| Stage 1 E2E discovery | PASS | Chromium, Chromium 1080p, Firefox, and WebKit each discover the non-mocked task/billing journey. |
| PostgreSQL focused suite | BLOCKED | 6 local contract tests pass; 3 authoritative database tests skip explicitly without `POSTGRES_TEST_DATABASE_URL`. |
| Real provider and accounting | NOT EXECUTED | Requires exact deployment SHA, real account, exact provider/model, paid approval, and database ledger access. |

No Stage 1 completion claim is made. The next evidence run must retain the uploaded `playwright-report/` and `test-results/` artifacts.

## 2026-08-09 Stage 1 real PostgreSQL gate

| Check | Result | Evidence |
|---|---|---|
| Doctor PostgreSQL capability probe | PASS | PostgreSQL 18 on loopback port `55432`; connection, DDL, transactions, unique indexes, and advisory locks verified. |
| Core schema completeness | PASS | RED/GREEN test proves `wujie_audit_log` is created before additive migrations. |
| Advisory lock encoding | PASS | Lock identity contains no NUL and distinguishes ambiguous string tuples. |
| Authoritative PostgreSQL suites | PASS | 3 files / 9 tests, including 20-way cold-start idempotency, 20-way paid idempotency, terminal races, one charge, and at-most-one refund. |
| Focused task/billing regression | PASS | 4 files / 77 tests. |
| TypeScript | PASS | `pnpm ts-check`. |
| Changed-file ESLint | PASS WITH HISTORICAL WARNINGS | 0 errors; 5 pre-existing warnings in untouched regions of `db-storage.ts`. |

This closes the local PostgreSQL evidence gap. It does not replace exact-deployment browser, provider, ledger, cancellation, timeout, or rollback evidence.

## 2026-08-10 Durable generation server-kickoff regression

| Check | Result | Evidence |
|---|---|---|
| RED reproduction | PASS | The new suite failed before implementation because no server-owned kickoff existed. |
| Per-slot kickoff | PASS | Unique task IDs are posted independently to the authenticated internal `/api/poll-task` route. |
| Partial kickoff failure isolation | PASS | One failed internal request does not prevent later slots from being awakened. |
| Charge-before-start ordering | PASS | Source contract proves kickoff is scheduled only after every atomic slot charge succeeds; charge failure returns before scheduling. |
| Lease and billing regression | PASS | 11 focused files / 108 tests passed, including recovery lease, terminal persistence, cancellation billing, and batch identity. |
| TypeScript / ESLint / build | PASS | TypeScript passed; ESLint reported 0 errors and 960 historical warnings; Next.js production build passed. |
| Full Vitest | PASS WITH EXPLICIT SKIPS | Full suite exited 0. PostgreSQL suites requiring `POSTGRES_TEST_DATABASE_URL` remained explicitly skipped in this workstation run. |

The browser remains a progress observer and compatibility fallback. It is no longer the required trigger for the first provider submission.

## 2026-08-10 Cloud probe and internal-auth follow-up

| Check | Result | Evidence |
|---|---|---|
| No-browser-poll probe on `9392b50` | FAIL | Paid task `async-1786318164491-0-etn2wk` remained `processing` at progress 0; `updatedAt` did not move and `remoteTaskId` never became a provider task ID. |
| Probe cleanup | PASS | The failed probe was cancelled and its 60 credits were refunded once, restoring the pre-probe balance. |
| Legacy zombie cleanup | PASS | The three known synthetic tasks reached `cancelled/refunded`; balances changed `220 -> 280 -> 340 -> 400`, and a repeated cancel produced no duplicate refund. |
| Root-cause regression | PASS LOCALLY | RED/GREEN test proves `/api/poll-task` accepts a signed internal user without a browser cookie and looks up the durable task under that user. |
| Focused authentication/lease suite | PASS | 6 files / 47 tests. |
| Full Vitest | PASS WITH EXPLICIT SKIPS | Exit 0; authoritative suites requiring `POSTGRES_TEST_DATABASE_URL` were explicitly skipped on this workstation. |
| TypeScript / ESLint | PASS WITH HISTORICAL WARNINGS | TypeScript passed; ESLint reported 0 errors and 960 historical warnings. |
| Production build | PASS | Next.js 16.2.10 production build generated 112 static pages and completed successfully. |

This follow-up is not a cloud pass. The new exact commit must be deployed before repeating the no-browser-poll probe and the progressive paid `n=1/2/3/4` run.

## 2026-08-10 Recovery-backoff follow-up

| Check | Result | Evidence |
|---|---|---|
| No-browser-poll probe on `8bf0e20` | FAIL | Task `async-1786322172707-0-uzo191` stayed `processing` at 0% for more than 31 minutes with 120 credits pending. The selected and actual route both remained PearAPI `gpt-image-2`, so this is an application recovery defect rather than a provider/model mismatch. |
| Deterministic root cause | CONFIRMED | The first authenticated internal poll returned HTTP 200 with `recoveryPending: true`, `reason: recent-update`, and an approximately three-second retry delay. The one-shot helper exited instead of retrying after the durable-task freshness backoff. |
| RED/GREEN regression | PASS LOCALLY | A new fake-timer test requires three internal polls across `recoveryPending -> processing -> completed`; it failed with one call before the repair and passes with three calls after it. |
| Focused generation/cancellation suite | PASS | 5 files / 43 tests passed. |
| Full local gates | PASS WITH DECLARED LIMITS | TypeScript passed; ESLint exited 0 with 960 historical warnings; full Vitest exited 0 with PostgreSQL environment skips declared; production build generated 112 pages. |

This is not deployed acceptance. The paid `8bf0e20` task must first reach a stable cancelled/failed terminal state with exactly one refund, then the new exact commit must prove server-owned `n=1` completion before any larger paid batch is attempted.

## 2026-08-10 Coze cloud generation acceptance

| Check | Result | Evidence |
|---|---|---|
| Stale probe cleanup | PASS | `async-1786322172707-0-uzo191` reached `cancelled/refunded`; 120 credits returned and balance restored to 400. |
| Durable `n=1` without browser poll | PASS | `async-1786328158112-0-c83jkr` returned in 1.016s and completed with one image, `charged/60`, with zero client `/api/poll-task` calls. |
| Canvas `n=2` | PASS | Two unique slots returned in 941ms; both completed with images and independent 60-credit charges. |
| Canvas `n=3` progressive completion | PASS | Three unique slots returned in 814ms. Slots 2 and 3 completed at 10:22:33 and 10:22:36 while slot 1 remained processing until 10:22:45. |
| Canvas `n=4` | PASS | Four unique slots returned in 1.007s; all completed with images and independent 60-credit charges. |
| Chrome admin task monitor | PASS | The real UI showed the `4/4`, `3/4`, `2/4`, and `1/4` rows as completed, attributed to PearAPI `gpt-image-2`, each `charged / 60`. |
| Exact runtime Git SHA | UNVERIFIED | Coze displayed internal snapshot `bb27e1a` and a generic latest-main pull record, but did not print `7baa4f9`; behavior alone is not used as SHA proof. |
| Direct-task credit metadata | PASS | Real Pear `gpt-image-2` task `direct-1786341342235-0-8pta21` completed with one image. Balance delta and transaction were -60; persisted `creditCost` and `billing.cost` were both 60 with charged status. Candidate commit `aa0b1cf`; exact runtime SHA remains unverified. |

Machine-readable evidence: `docs/testing/evidence/stage-1-cloud-generation-2026-08-10.json`.

BUG-051 reconciliation evidence: `docs/testing/evidence/bug-051-cloud-credit-reconciliation-2026-08-10.json`.

## 2026-08-10 three-browser and cancellation checkpoint

| Check | Result | Evidence |
|---|---|---|
| Chromium paid `n=1/2/3/4` | PASS WITH TEST-FLOW CORRECTION | Ten real Pear images reached the canvas and survived refresh. The old test attempted logout directly from canvas; a separate non-paid regression now returns to `工作台` before logout and passes. |
| Firefox paid `n=1/2/3/4` | PASS | Two tests passed; ten images, task terminal states, billing, canvas refresh, workbench return, and logout completed. |
| WebKit paid `n=1/2/3/4` | PASS | Two tests passed; the HTTPS secure-cookie login path and the same paid canvas flow completed. |
| Browser artifacts | PASS | Each browser has a completed Manifest, four request IDs, screenshot, Console log, network log, and task-billing record under `test-results/evidence/runtime-unverified-candidate-aa0b1cf/`. |
| Real cancel and late-result isolation | PASS | Task `async-1786343121430-0-6e583w` charged 60, cancelled twice, refunded once, restored the balance, and remained cancelled after 50 seconds. |
| Ledger transaction linkage | FAIL ON DEPLOYED CANDIDATE; PASS LOCALLY | BUG-052: deployed task/transaction IDs were null. The local SQL fix passes 46 unit tests and an isolated PostgreSQL 18 audit-linkage test. |

## 2026-08-10 BUG-052 deployed regression

| Check | Result | Evidence |
|---|---|---|
| Real Chrome submit and cancel | PASS | One new Pear `gpt-image-2-4k` slot was created and its new cancel control was used. |
| Stable terminal state | PASS | `async-1786354360647-0-rhvubs` remained `cancelled` at the final 18:12 CST check. |
| Task billing state | PASS | `creditStatus=refunded`, `creditCost=120`, with non-empty charged/refunded transaction IDs. |
| One charge / one refund | PASS | One -120 consume transaction and one +120 refund transaction matched the IDs persisted on the task. |
| Balance restoration | PASS | 378 -> 258 -> 378. |
| Task correlation | PASS | The refund description contains `async-1786354360647-0-rhvubs`; isolated PostgreSQL coverage separately proves both structured `task_id` and `reference_id` columns. |
| Runtime identity | PASS | Coze runtime `d531ce6` directly parents GitHub `main@32139c5`; the only local delta is the Coze startup environment loader. |

BUG-052 is closed. Timeout-specific deployed behavior and rollback rehearsal remain outside this regression result.

## 2026-08-10 timeout probe attempt 1

The first deterministic timeout attempt did **not** pass the timeout gate. Coze disconnected the delayed external provider before the application timeout. Task `async-1786357844914-0-s1t99g` therefore settled as `failed/refunded`, not `timeout`. Billing remained correct: one -140 charge, one +140 refund, and balance restoration from 238 to 378. The temporary provider was deleted and confirmed absent.

This run is retained as negative evidence and exposed BUG-053: the terminal failed task still displayed a retrying label/error. A valid timeout acceptance still requires a Coze-local delayed provider that keeps the socket open past the application deadline, so the application AbortController owns the timeout transition.

## 2026-08-10 timeout probe attempt 2 and BUG-054

A Coze-local delayed provider kept the upstream connection open long enough to exercise the application deadline. Paid task `async-1786358975492-0-mq23bl` remained `processing/pending` after 666 seconds, retaining 280 credits instead of reaching `timeout/refunded`. Manual cancellation then produced exactly one refund and restored the balance from 98 to 378; the temporary provider was removed.

The failure is reproducible and is not a provider/model mismatch. Recovery requests were each granted a fresh timeout window, with no absolute deadline based on the original durable task creation time. A minimal TDD repair now checks a 10-minute `createdAt` deadline before recovery backoff and lease acquisition, aborts the active execution, and settles through the existing conditional terminal/refund path.

Local verification passes: focused deadline tests 19/19, broader task suite 7 files / 100 tests, TypeScript, ESLint with 0 errors and 960 historical warnings, full Vitest, and the 112-page production build. This remains **pending deployed acceptance**; the cloud must prove automatic `timeout/refunded`, one charge/one refund, and no late completion.

## 2026-08-10 BUG-054 deployed timeout acceptance

| Check | Result | Evidence |
|---|---|---|
| Fast wrapper response | PASS | The paid durable slot returned in 1.219s with task `async-1786366442668-0-dzxu9y`; the client did not wait for the provider response. |
| Absolute deadline | PASS | The task changed from `processing/pending` to `timeout/refunded` at 602.934s from its original durable `createdAt`. |
| One-time billing | PASS | Balance `378 -> 238 -> 378`; exactly one -140 consume and one +140 refund matched the transaction IDs stored on the task. |
| Late-result isolation | PASS | The provider's delayed body was scheduled after 900s. At 1132.6s and after a Coze sandbox restart, the task remained `timeout/refunded`, `updatedAt` was unchanged, and the ledger still contained two related rows. |
| Cleanup | PASS | Temporary provider `api_1786366406082_izjuy5a` was deleted and confirmed absent; the local heartbeat server and public tunnel were stopped. |
| Runtime SHA | UNVERIFIED | GitHub candidate is `104b140`; the user confirmed the latest pull, but Coze did not expose an independently verifiable runtime SHA in this run. |
| Residual label state | OPEN P2 | BUG-053 persists: the terminal timeout row retained the retrying label although status, error, refund, and balance were correct. |

Machine-readable evidence: `docs/testing/evidence/bug-054-cloud-timeout-acceptance-2026-08-10.json`.

## 2026-08-10 Stage 1 core-v2 to legacy rollback rehearsal

| Check | Result | Evidence |
|---|---|---|
| Runtime provenance | PASS | Cloud `HEAD=413cb46d29083a17cc2b9a29d3fedf5c31cf131d`; read-only fetch resolved `origin/main=104b140ed8189d22e14330dae78b17b3abb200c5`. The only non-`.env` diff was the known Coze launcher change in `scripts/coze-start.sh`; business source matches GitHub main. |
| Core-v2 admission | PASS | Tasks `agent-1786370677352-kjnqfj` and `agent-1786371202567-z7urgq` persisted `mode=core-v2` and `handlerVersion=task-core-v2`. |
| Rollback operation | PASS | Only `.env` changed from `core-v2` to `legacy`; no checkout, pull, business-source edit, data migration, or stable-branch operation occurred. Preview restarted as PID 2227 and returned HTTP 200. |
| Legacy admission after rollback | PASS | Task `agent-1786371761478-elb9d1` persisted `mode=legacy` and `handlerVersion=legacy`. |
| Old-task compatibility | PASS | Both core-v2 tasks remained readable with identical IDs, terminal states, handler versions, charge IDs, refund IDs, and revisions after rollback. |
| Billing consistency | PASS | Each of three probes produced one -12 consume and one +12 refund. Balance remained `378`; no duplicate charge or refund appeared. |
| Data safety | PASS | No task migration was performed. Existing rows were interpreted from their saved `handlerVersion`; no task was duplicated or rewritten. |

The upstream APImartLLM model returned 500 for all three minimal probes. That provider outcome is not counted as a successful content-generation result, but it is sufficient for the rollback boundary because both execution modes reached durable terminal settlement and exact one-time refund. BUG-053 remains open at P2 for stale retry wording on terminal rows.

Machine-readable evidence: `docs/testing/evidence/stage-1-core-v2-legacy-rollback-2026-08-10.json`.

## 2026-08-11 Stage 2 Checkpoint B cloud reproduction

Three transfer directions passed in Coze `shadow`: Canvas to embedded chat, Canvas to workflow, and workflow output to Canvas. The fourth direction, standalone chat to a selected Canvas, created exactly one database placement but failed media rendering.

The provider response contained a valid origin-relative image URL. The application failed to resolve it before persistence, then stored the raw path as a ready AssetVersion. A focused RED test reproduced the parser defect; the minimal fix resolves direct image URLs against `Response.url`. Fresh gates pass: compatibility 16/16, related 60/60, Task 6 57/57, Task 5 64/64, Task 4 108/108, TypeScript, full Vitest, protected baseline 38/38, ESLint 0 errors / 957 warnings, and the 114-page production build.

This is **local candidate evidence only**. Checkpoint B remains open until the exact commit is deployed and Chrome proves that a new standalone-chat result renders in the target Canvas. BUG-056 and BUG-057 remain open. Six PostgreSQL integration groups were skipped because `POSTGRES_TEST_DATABASE_URL` is not configured.

## 2026-08-11 Stage 2 Checkpoint B cloud closure

The candidate is now proven in Coze `shadow`. Runtime commit `ff0242e2` directly parents GitHub `main@846c0c4e`; the only runtime delta is the established Coze launcher adapter. A fresh real Gpt Image 2 result persisted to `/api/serve-upload/uploads/gen-1786455914641-nimwmk.png` and visibly rendered in the selected Canvas.

The generated AssetVersion is `ready` with `image/png`. The target project contains one `canvas-image` placement for that version after two Add-to-Canvas clicks, proving idempotent retry. Together with the three previously passed directions, all four Checkpoint B transfer paths pass. BUG-055 is closed; BUG-056 and BUG-057 remain open. Machine-readable evidence: `docs/testing/evidence/stage-2-checkpoint-b-cloud-2026-08-11.json`.

## 2026-08-11 Stage 2 Task 7 local closure

Commit `12a9026eaf35e60410f775ae59f10c5d7eabe769` implements completed-task projection to immutable asset versions across image, edit, Agent, annotation, video, 3D, workflow, embedded chat, and standalone chat completion boundaries. Replays reuse existing versions; non-completed and late results cannot create active placements; projection write failures retain the completed task and record retryable `projection_pending` audit state.

The extended Task 7 suite passed `84` tests and skipped `4` PostgreSQL-only tests. The final 3D/workflow security set passed `23/23`; `pnpm ts-check`, full `pnpm test`, full ESLint (`0 errors / 957 historical warnings`), the `114/114` production build, and the protected baseline (`38/38`, zero warnings) all exited successfully. Independent review R6 returned `APPROVED` with no findings.

The four skipped PostgreSQL tests remain **UNVERIFIED**, not passed, because `POSTGRES_TEST_DATABASE_URL` is unavailable. Coze `shadow` deployment and real completed-task projection evidence are also pending. `asset-v3` remains disabled.

## 2026-08-12 Stage 2 Task 8 local closure

Task 8 adds placement-aware trash/restore, media-health recovery, orphan dry-run governance, and compatibility wiring for the existing administrator recovery route. Shared assets remain active while another active placement exists; the final placement may trash the asset, but physical S3/local purge is explicitly disabled.

The final focused command covered lifecycle rules, recovery governance, Canvas batch deletion, authorization, the administrator route contract, and five PostgreSQL concurrency bodies. Result: `72 passed / 5 skipped`; all five skips are caused by the missing isolated PostgreSQL URL and remain UNVERIFIED. Fresh repository gates also passed: `pnpm ts-check`, full `pnpm test` (`2074 passed / 35 environment-skipped`), full ESLint (`0 errors / 957 historical warnings`), production build, protected baseline (`38/38`, zero warnings), and `git diff --check`.

Review waves reproduced and closed exact-path cross-match, stale candidate, lock-order, partial batch-delete, recovery-attempt, bounded serialization-retry, terminal purge fail-open facts, batch path traversal, and GET mutation defects. After `90cad2e`, final whole-branch re-review returned `APPROVED` with Critical/Important/Minor `0/0/0`. No code was pushed and no cloud action or physical deletion was performed because Checkpoint C requires real PostgreSQL evidence.

An isolated local PostgreSQL 18 cluster subsequently executed the previously skipped Task 8 lifecycle suite: `5/5` passed. The first PostgreSQL-enabled whole-repository run found one Task 7 isolation failure because the cloud-task table initialization Promise outlived a dropped test schema. The failure reproduced independently as `1 passed / 1 failed`; `c563efd` binds initialization caching to the active database/search-path connection string. Focused GREEN was `59/59`, and the second PostgreSQL-enabled whole-repository run passed `2105` tests with four separate `TEST_POSTGRES_URL` suites skipped. No Task 7-8 or S1 billing/state/rollback PostgreSQL test remained skipped.

## 2026-08-12 Stage 2 Checkpoint C cloud reproduction and local candidate

Coze `shadow` on GitHub `main@f8bb57c` completed a real Pear `gpt-image-2-4k` generation, but database inspection disproved lifecycle correctness. The Canvas request omitted `projectId`, no matching project cloud task existed, and shadow synchronization created separate legacy graph identities for the processing placeholder and completed result. Delete persisted after reload and physical purge remained disabled, but media recovery stayed durably `recovering`.

BUG-063 was reproduced with source and database evidence, then repaired with TDD. The Canvas request now carries the effective project, direct and asynchronous results use projector-compatible `${taskId}:${outputIndex}` identities, processing placeholders are excluded from the graph, autosave adopts an existing task projection, every Canvas delete entry point uses placement-first deletion, and shared graph rows use consistent version-before-placement locks. The focused affected regression passes `48/48`; `pnpm ts-check` passes. Full Vitest, ESLint, build, and protected-baseline results must be freshly appended before push.

This is local candidate evidence only. **Checkpoint C remains NOT PASSED** until the exact candidate is deployed in `shadow` and a fresh real generation proves one project-owned task, one authoritative version, one placement, idempotent autosave, and persistent delete. BUG-064 remains open because recovery has not reached `ready` or a terminal failure. Evidence: `docs/testing/evidence/stage-2-checkpoint-c-cloud-reproduction-2026-08-12.json`.

Final candidate gates on 2026-08-12: affected Canvas/asset regression `51/51`; TypeScript passed; ESLint completed with `0 errors / 957 historical warnings`; full Vitest `2083 passed / 35 environment-skipped / 0 failed` (`2118` total); production build generated `116/116` pages; protected baseline retained `38/38` feature IDs with no unapproved source drift; `git diff --check` passed. The 35 skipped tests include the current-candidate Stage 2 PostgreSQL projection/lifecycle and billing concurrency bodies because `POSTGRES_TEST_DATABASE_URL` is not configured, so they remain explicitly unverified.

## 2026-08-12 BUG-064 durable media recovery local closure

The repaired recovery path now admits one owner/project/asset/version/placement-scoped attempt, executes the worker through Next.js `after()`, and polls the database-authoritative terminal. PostgreSQL leases serialize concurrent requests, expired workers are fenced, and a result cannot overwrite a newer current version. Recovered bytes are published under an attempt-isolated `/api/serve-upload/recovery/{version}/{attempt}.{ext}` URL and are resolved only through the exact database URL and storage key or exact durable local path. Every read validates size, raster MIME signature, and SHA-256; recovery misses cannot fall through to basename, source-map, or unrelated local-file guessing.

The final PostgreSQL-enabled full run passed `402/402` test files and `2160/2160` tests with zero failures and zero skips. TypeScript passed; ESLint returned `0 errors / 957 historical warnings`; production build compiled and generated `116/116` pages; protected baseline retained `38/38` feature IDs; `git diff --check` passed. Independent final review returned `APPROVED` with no P0/P1/P2 findings. The earlier JSON-reporter run terminated before writing a report and was not counted; the diagnostic rerun with four workers completed successfully and retained its log under untracked `output/`.

This is local evidence only. Coze remains on `main@4bbe6db` until the candidate is pushed and pulled. **Checkpoint C remains NOT PASSED** until one real cloud generation, authoritative projection, delete/reload, and missing-media recovery reach a verified terminal in `shadow`. Task 9, `asset-v3`, and physical purge remain disabled.
## 2026-08-12 Stage 2 Checkpoint C cloud closure

Coze pulled GitHub `main@1344dec33f93fc9d8a19baeaf9ed251c28176f5f`; runtime commit `6965f28ceb57650af0f87f10d6509603949f0eff` differs only by the existing `scripts/coze-start.sh` deployment adaptation. Runtime gates remained `WUJIE_ASSET_GRAPH_MODE=shadow`, `WUJIE_TASK_CORE_MODE=legacy`, persistent root `/space/wujie-data`, and physical purge disabled. Authenticated Chrome recovered the known missing asset, rendered it, and retained it after reload. Database verification confirmed one succeeded attempt, one artifact, one active placement, zero GC candidates, and a ready current version. **Checkpoint C: PASS.** Task 9 is now the only permitted Stage 2 task; Tasks 1-8 must not be repeated.

## 2026-08-13 Stage 2 Task 9 local matrix and release gates

- Coze reported pull baseline `4bbe6db`; a fresh remote fetch shows GitHub `origin/main@1344dec`, with `4bbe6db` as its ancestor. The Task 9 branch is based on `1344dec`; no remote commit was overwritten and `stable` was not touched.
- The first shared-account multi-project run exposed test-fixture contamination: opening one browser profile allowed background project synchronization to consume another profile's copy-on-write fixture. Re-seeding a fresh run-owned user/project set for each browser removed the contamination without changing product behavior.
- Real production-server Playwright results: Chromium `10/10`, Chromium 1920x1080 `10/10`, Firefox `10/10`, WebKit `10/10`, mobile Chromium `10/10`; total `50/50`. The two specs cover legacy read-only open, first copy-on-write save, real image upload, placement trash/restore, missing-media recovery, reload recovery, embedded chat, workflow return, standalone chat transfer, and shared-reference deletion isolation.
- Task 9 browser testing reproduced and closed BUG-065, BUG-066, and BUG-067 with RED/GREEN tests. Failure artifacts include screenshot, video, trace, Console, network, request IDs, and task records under `test-results/evidence/`.
- Real PostgreSQL full run: `410` test files passed, `2258` tests passed, `3` files / `4` tests skipped under separate legacy `TEST_POSTGRES_URL` gates. Stage 2 storage/lifecycle/projection/billing tests, including concurrent restore collision, executed against isolated PostgreSQL and passed.
- Fresh gates: API and regression suites passed; ESLint `0 errors / 959 historical warnings`; TypeScript passed; Doctor exit `0`; production build exit `0` with `116` application routes; `git diff --check` passed.
- This is local `shadow` candidate evidence. Controlled cloud `asset-v3` switch and rollback to `legacy` remain unexecuted, so Stage 2 is not complete and no release-pass claim is made.

## 2026-08-13 Stage 2 Task 9 final candidate rerun

- Coze has confirmed its current pull at `4bbe6db`; that SHA is an ancestor of both the Task 9 candidate and `origin/main@1344dec`. It is a cloud baseline, not the final candidate SHA.
- Final review found and closed BUG-068, BUG-069, and BUG-070: standalone generation now receives its real placement identity, bridge consumption is idempotent, and managed Canvas delete/restore updates graph, legacy snapshot, and project revision transactionally. A lost-response retry returns the original delete revision even after another session advances the project.
- The post-fix focused unit/API/PostgreSQL suite passed `48/48`; the full PostgreSQL-enabled `pnpm test` completed with exit `0`; `pnpm test:api` and `pnpm test:regression` also completed with exit `0`.
- A first browser rerun was intentionally rejected because the local production server omitted `WUJIE_ASSET_GRAPH_MODE=shadow`: legacy saves returned HTTP 200 but correctly lacked `assetGraphUpdates`. After restarting the same build with `shadow`, task core `legacy`, and physical purge disabled, no business-code change was needed.
- Each browser then received a newly seeded user/project set. Chromium, 1920x1080 Chromium, Firefox, WebKit, and mobile Chromium each passed `10/10`, total `50/50`. The shared-user fixture attempt that consumed another profile's copy-on-write fixture is retained as invalid test-environment evidence and is not counted as a product failure or pass.
- Evidence audit found `108` recent manifests and `0` missing screenshot/video/trace/Console/network/task files. `playwright-report/index.html` was regenerated by the final mobile run.
- Final gates: Doctor exit `0`; ESLint `0 errors / 959 warnings`; TypeScript exit `0`; protected baseline `38/38` with no unapproved source drift; production build exit `0` with `116` application routes; `git diff --check` passes. Independent final review is `APPROVED` with no Critical, Important, or Minor findings.
- Verdict remains **CONDITIONAL**: this candidate may be pushed to `main` only. Coze must pull the exact new SHA in `shadow`, complete the cloud comparison, then perform the controlled test-only `asset-v3` switch and prove rollback to `legacy`. `stable` and physical purge remain untouched.

The verified implementation was subsequently fast-forward pushed to `main@644a0809658d500d9e3815c14771dd10581f0998` from `1344dec33f93fc9d8a19baeaf9ed251c28176f5f`. Remote `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged. This push does not close the cloud gates; Coze must now pull the current main tip and provide exact-SHA `shadow` evidence.

## 2026-08-13 BUG-071 asset-v3 history lifecycle regression

- Coze on base `3bd2850` proved managed delete succeeded but Ctrl+Z did not restore the image. The environment was rolled back to `legacy` without changing the original identity tuple.
- TDD added lifecycle compensation, snapshot commitment, restored-ID suppression cleanup, and a real browser scenario covering delete, undo, redo, second undo, identity lookup, and reload.
- The first local browser attempt failed at login with HTTP 503 because the isolated production server omitted `WUJIE_ADMIN_PASSWORD`; this was a fixture configuration failure and remains retained.
- The first five-profile run passed four profiles but failed Firefox after reload. Network evidence proved restore and identity GET succeeded before a stale snapshot removed the placement. Binding the post-history snapshot to the lifecycle transition closed that race.
- Final focused tests pass `11/11`; Chromium, Chromium 1080p, Firefox, WebKit, and mobile Chromium pass `5/5`. The final PostgreSQL-enabled full regression passes `413/413` files and `2273/2273` tests with zero failures or skips. Production build generates `116/116` routes.

## 2026-08-13 Stage 2 Task 9 cloud closure

- Source candidate: GitHub `main@81fe303e73ba2f50d2ca0a6ed7201c5977758231`. Coze retained only its deployment adapter/change-card lineage; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` was not changed.
- Authenticated Chrome passed the controlled `asset-v3` lifecycle on project `project_1786500304299_8vix1z45f`: delete removed the image, Ctrl+Z restored it, Ctrl+Shift+Z removed it again, a second Ctrl+Z restored it, and reload preserved the 800x534 Pear image.
- PostgreSQL identity after reload: asset `559c7f48-04f1-544e-8ec5-3c23ba4fb975`, ready version `66621b79-77c2-561f-966f-0c9870ba168a`, Canvas placement `696446c1-3278-5548-9427-3290ca3ea1a5` active. One chat-attachment and one workflow-input placement remained active on the same asset/version.
- Exact-candidate `shadow` comparison matched the compatibility projection: 5 legacy projects, one Canvas image in the controlled project, three active cross-workspace placements, zero owner/project mismatch, zero non-ready active reference, and zero GC candidates.
- Rollback was proven after both controlled modes. Final Coze runtime is `legacy` asset mode, `legacy` task core, physical purge disabled; `/` and `/api/auth/me` return 200 and the project image remains visible without a new login prompt.
- **Stage 2 Task 9: PASS. Stage 2: COMPLETE.** This conclusion is limited to the Stage 2 asset/version graph and does not mark later Canvas, node/Agent, business-tool, administrator, user, payment, or whole-platform work complete.

## 2026-08-13 Stage 3 Task 4 selection and gesture regression

- TDD introduced a pure Canvas selection controller plus React adapter. Focused selection, wiring, group-gesture and image-drag contracts pass `34/34` after independent review closed touch jitter, group-cancel and Ctrl/Meta routing regressions.
- The fresh whole-repository rerun passes `411/411` executed test files and `2291/2291` executed tests. Twelve PostgreSQL-gated files containing 44 tests remain explicitly skipped because `POSTGRES_TEST_DATABASE_URL` is not configured. ESLint reports `0 errors / 966 historical warnings`.
- Local production Chromium Task 4 acceptance passes `3/3`: exact single/reverse-box selection, pointercancel rollback without persistence, and image drag with zoom/reset/reload persistence.
- After a clean 15-project reseed, the complete Stage 3 Chromium spec passes `5/6`. One-node persistence, delete/undo/redo and 100-node pan pass. The 300-node run fails only the fixed input P95 gate: `50.2ms` versus `<=50ms` (preceding runs `56.8ms` and `62.8ms`); FPS is `57.18`, disappeared frames `0`, unclickable time `0`.
- Fresh supporting gates: TypeScript exit `0`; full Vitest `411` files / `2288` passed / `44` skipped; ESLint `0 errors / 966 historical warnings`; production build `116/116`; `git diff --check` exit `0`. The `12` skipped files are PostgreSQL-gated and are not counted as passes.
- The protected-feature gate confirms `38/38` feature identities, source paths and evidence contracts are present. It still blocks Stage 3 production-source drift because the current allowlist/baseline update is scheduled later in the approved plan; this is not represented as a clean release gate.
- **Task 4 verdict: PASS LOCALLY FOR ITS FUNCTIONAL SCOPE. Stage 3 verdict: NOT COMPLETE.** Task 5 is next and not started; S3-BUG-004, external browser profiles, exact-SHA cloud validation and rollback remain open.

## 2026-08-13 Stage 3 Task 5 command and history regression

- TDD introduced immutable Canvas commands, a 50-step controller, explicit pointer transactions, history-skip task projection, placement-aware delete/restore, and exact reorder/group inverses.
- Five independent review waves reproduced and closed queue conflict loss, concurrent membership rebase, processing-node geometry filtering, first generation-group drag drift, cross-project queued edits and late in-flight undo/redo contamination.
- Focused final regression: `9` files, `56/56` tests. TypeScript passes. PostgreSQL-enabled full Vitest: `428/428` files and `2374/2374` tests, zero failures and zero skips.
- Fresh production Chromium Task 5 E2E passes `3/3`: delete/undo/redo, batch delete as one step with layer-order restoration, and move/resize as one step each.
- Final-build full Chromium remains `7/8`. The only failure is S3-BUG-004: 300-node input P95 `52.3ms` versus the fixed `<=50ms` gate after an earlier `72.5ms` run; disappeared frames `0`, unclickable duration `0`. No threshold was changed.
- Protected features remain `38/38`, but the release gate intentionally blocks `24` accumulated Stage 3 source drifts until the later approved baseline task.
- **Task 5 verdict: PASS LOCALLY FOR ITS FUNCTIONAL SCOPE. Stage 3 verdict: NOT COMPLETE.** Task 6 has not started.

## 2026-08-13 Stage 3 Task 6 task projection regression

- A single pure projector now maps task events to Canvas commands. Workspace SSE/poll/recovery and infinite-Canvas completion no longer retain separate state-writing authority; provider submission and billing paths were not changed.
- Focused regression passes `48/48`, covering n=1/2/3/4, resumed terminal events without revision, duplicate/late events, stale server placeholders, ordinary-image isolation, media readiness and stable task-slot order.
- The production Chromium `n=4` scenario passes `1/1`: completion arrives `3,1,4,2`, visible slot order remains `1,2,3,4`, no status-card duplicate remains, and project sync plus reload preserves four real PNG results.
- Fresh full Vitest: `430` files total, `418` passed and `12` environment-skipped; `2351` tests passed and `44` skipped, with zero failures. TypeScript, ESLint and `git diff --check` exit 0; production build generates `116/116` routes.
- After reseeding all 15 controlled projects, the complete Stage 3 Chromium suite is `7/8`; the only failure is S3-BUG-004 at 300 nodes, input P95 `87.8ms` versus `<=50ms`. The threshold and assertions remain unchanged. A preceding reused-fixture run is retained but excluded from product status.
- Protected-feature evidence remains `38/38`, but the gate blocks `27` accumulated Stage 3 source drifts pending the later ordered baseline task. **Task 6 passes locally for its functional scope; Stage 3 remains incomplete. Task 7 has not started.**

## 2026-08-13 Stage 3 Task 7 persistence regression

- TDD added a persistence scheduler and permanent contracts for latest-wins batching, single-flight writes, project cancellation epochs, signature deduplication, retry, pending media, immediate-task yielding and prepared-only unload handling. Focused regression passes `35/35`.
- PostgreSQL-enabled full Vitest exits `0`. TypeScript, error-only ESLint, full ESLint (`0 errors / 966 historical warnings`), whitespace checks and the production build (`116/116`) pass.
- Fresh production Chromium runs the save/refresh grep `2/2`. The 300-node case records average `56.79 FPS`, input P95 `21.8ms`, longest task `90ms`, longest save task `0ms`, zero disappeared frames and zero unclickable time. Durable coordinates, dimensions, z-order and processing state match after refresh.
- The protection gate retains `38/38` protected feature identities, paths and contracts. It intentionally blocks `29` accumulated Stage 3 source drifts pending the ordered approval task.
- **Task 7 verdict: PASS LOCALLY FOR ITS FUNCTIONAL SCOPE. Stage 3 verdict: NOT COMPLETE.** S3-BUG-004's full 300-node pan/input gate, external browser matrix, cloud exact-SHA and rollback remain open; Task 8 has not started.

## 2026-08-13 Stage 3 Task 8 tool-session regression

- TDD added permanent contracts for registry completeness, duplicate IDs, entry-point authorization, source locking, no-selection rejection, close events, host interaction boundaries, placement classes and Infinite Canvas wiring. Focused regression passes `32/32`.
- A fresh production server executed the mutually exclusive session flow in all configured profiles: Chromium, Chromium 1920x1080, Firefox, WebKit and mobile Chromium pass `5/5`. The flow opens Agent by shortcut, replaces it with brand ecommerce, closes by Escape, opens erase on a selected image, then verifies ChatCanvas prompt interaction and Escape cleanup.
- Firefox consistently did not decode the historical 155-byte Stage 3 PNG although the media endpoint returned HTTP 200, `image/png`, 155 bytes and the Canvas card remained visible. This tool-session test therefore asserts stable card visibility, not media decoding; the limitation is retained in `UNVERIFIED_ITEMS.md` rather than counted as a media pass.
- PostgreSQL-enabled full Vitest exits `0`. API regression is `477/477`; its three separately keyed element-board/Pear PostgreSQL concurrency tests pass `3/3`; component/lib regression is `1759/1759`. TypeScript, `git diff --check` and the `116/116` production build pass; ESLint reports `0 errors / 966 historical warnings`; Doctor reports `43/11/0/0`.
- All `38/38` protected feature identities remain. The default gate intentionally blocks `32` accumulated Stage 3 source drifts; the exact reviewed 32-path scope gate passes with one historical commit warning. No baseline was silently rewritten.
- **Task 8 verdict: PASS LOCALLY FOR ITS FUNCTIONAL SCOPE. Stage 3 verdict: NOT COMPLETE.** Progress is `9/11`, approximately `82%`. Task 9 has not started; S3-BUG-004, the full Stage 3 external-browser matrix, cloud exact-SHA and rollback remain open.

## 2026-08-14 Stage 3 Task 9 component-boundary regression

- TDD added source contracts for workspace effect ownership, render-only `CanvasSurface`, session-only `CanvasToolHost`, protected-panel reachability and Canvas lifecycle teardown. Initial RED was `3 failed / 2 passed`; a second RED captured the anonymous wheel-listener leak.
- `CanvasWorkspace` now injects the shared task-poll transport. Nine existing poll paths retain their request payload, response parsing, cancellation signal and terminal behavior while `InfiniteCanvas` no longer directly calls `/api/poll-task`.
- The erase/mask editor wheel listener now has stable attach/detach identity. Unmount aborts tracked annotation/generation requests, clears intervals/timers, cancels RAFs and releases pointer capture.
- Focused boundary plus Canvas command/session/selection/viewport/cancellation regression passes `58/58`. Fresh full Vitest passes `422` files and `2376` executed tests with `12` files / `44` tests explicitly environment-skipped; separately enabled PostgreSQL suites pass `46/46` plus `4/4`.
- TypeScript and production build pass. Full ESLint reports `0 errors / 965 historical warnings`, one fewer warning than Task 8, and `git diff --check` passes.
- **Task 9 verdict: PASS LOCALLY FOR ITS FUNCTIONAL SCOPE. Stage 3 verdict: NOT COMPLETE.** Progress is `10/11`, approximately `91%`. Task 10 has not started; S3-BUG-004, full five-browser Stage 3 coverage, cloud exact-SHA and rollback remain open.

## 2026-08-14 Stage 3 Task 10 local and browser gate regression

- Controlled fixture audit confirms `15` unique isolated projects: five profiles each with exact `1`, `100` and `300` node projects, with zero foreign run IDs.
- The fresh production legacy matrix passes `60/60`. Shadow and canvas-v2 representative matrices each pass `15/15`; their JUnit output reports zero failures and errors.
- Desktop Chromium performance closes S3-BUG-004 without changing thresholds: 1280x720 at 300 nodes is `54.62 FPS / 34.3ms P95`; 1920x1080 is `55.31 FPS / 21.6ms P95`. Both have zero disappeared frames and zero unclickable time.
- TDD retained failures for resize pointer capture, button-focused WebKit undo and the protected-endpoint CI startup probe. Focused Canvas contracts pass `39/39`, WebKit repeat passes `10/10`, and workflow/release contracts pass `15/15` after minimal fixes.
- The evidence fixture now writes screenshot, video, trace, console, network and JSON metrics in mode/run/browser/test/retry/repeat-specific directories. Runtime console/page errors and non-benign network failures fail otherwise passing tests.
- Fresh local gates exited 0: Doctor, TypeScript, ESLint (`0 errors / 965 historical warnings`), PostgreSQL-enabled full Vitest, API (`110 files / 480 tests`), component/lib regression, production build (`116/116`), YAML parse and `git diff --check`.
- **Task 10 local verdict: PASS. Stage 3 verdict: NOT COMPLETE.** The controlled local database has no provider configuration, so real paid generation/billing/refund cannot be claimed. Main push, GitHub Actions, Coze exact-SHA shadow, isolated canvas-v2 and mandatory legacy rollback remain open.

## 2026-08-14 Stage 3 Task 10 independent-review hardening

- Independent review first found a cross-user emergency-snapshot risk, stale server revision recovery, blob layout rollback, resize immediate-save omission, a permanently hung audit queue, and evidence that could be attributed to a dirty `HEAD` without a content fingerprint. All P0/P1 findings were reproduced with failing tests before repair.
- Snapshot v3 now binds owner and server project revision. Logout clears recovery records. Pending data URLs remain recoverable; blob URLs use a durable server URL while retaining the newest recovered geometry. Resize commits enter the immediate persistence path.
- `beforeunload` now protects pending media before any storage write. Ordinary snapshots attempt local recovery and beacon independently; either channel is sufficient, and a double failure triggers the browser leave guard instead of being swallowed.
- Small audit records start immediately and use navigation-safe beacon delivery with bounded-fetch fallback; large records remain response-aware and time-bounded. This removed the retained Chromium/mobile `/api/user-data/record net::ERR_ABORTED` evidence. Application-level beacon receipts remain an explicit P2 limitation.
- Quick-create model loading now uses a stable authorization signature. The retained WebKit RED contained two model-request access-control page errors; the exact rerun passes `1/1` with zero evidence-gate error.
- Evidence identity now includes a dirty-worktree content fingerprint, including untracked file content. Every passing attempt requires its own screenshot, video, trace, Console and network artifacts.
- Focused hardening regression currently passes `9` files / `88` tests. Production browser evidence after the hardening includes the five-profile move/resize/undo/redo/immediate-reload flow `5/5`, final WebKit merge-window `1/1`, and final Chromium immediate-reload `1/1`.
- Retained environment failure: the first rebuilt local server omitted `WUJIE_ADMIN_PASSWORD` and login returned 503. The same source passed after the required production variable was supplied; this is recorded as environment evidence, not a product pass or product defect.
- The first final full run correctly failed `1` authentication-bootstrap source contract after the recovery-aware `storedProject -> targetProject` split. Runtime workflow hydration was present; S3-TEST-002 updated the contract to protect ordering rather than the old local variable shape. Focused rerun is `11/11`, and the same PostgreSQL-enabled full command then exits `0`.
- Fresh post-review gates: Doctor `43/11/0/0`; TypeScript; ESLint `0 errors / 965 historical warnings`; PostgreSQL-enabled full Vitest exit `0`; API `110 files / 480 tests`; component/lib regression exit `0`; production build `116/116`; YAML parse, exact Stage 3 allowlist, stable SHA and whitespace checks pass.
- **Verdict remains CONDITIONAL / Stage 3 not complete.** P0/P1 are zero locally. Open P2 items are audit application-level receipt and cross-session authorization refresh. Exact committed-source browser evidence, GitHub Actions, Coze provider/billing evidence and `shadow -> canvas-v2 -> legacy` remain required.

## 2026-08-14 Stage 3 immutable-main representative evidence

- The protected-path bootstrap was fast-forwarded first as `d9fde3a0f36b7ca8532591e8b098e4dfb1ac40f6`; the complete Stage 3 candidate then passed the trusted-parent gate and reached `main@e61bdedb9443d8b2ee164539ed21ed48bf0b4b90`. Remote `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged.
- The first exact-build browser attempt returned login HTTP 503 because the local test secret was shorter than the production-required 32 characters. The API error body identified the configuration fault; no Canvas assertion ran and the failure evidence remains retained.
- After correcting only the isolated test environment, four tests finished their browser work but the runner reached the 300-second outer limit. S3-TEST-003 reproduced a video teardown deadlock. TDD RED was `1 failed / 9 passed`; the minimal context-close ordering fix passes `10/10` and the Stage 3 focused set passes `100/100`.
- The evidence fix was fast-forwarded to `main@afa65eb103bd8fa08d669d4680d068d2c565d341`. A clean production build from that exact commit passed the Chromium and WebKit merge-window plus move/resize/undo/redo/immediate-reload representative set `4/4` in 35.1 seconds.
- Immutable evidence is under `test-results/stage-3-baseline/evidence/afa65eb103bd8fa08d669d4680d068d2c565d341/legacy/task10-e61bded-20260814/afa65eb-immutable-representative/`. Every test contains `final.png`, `video.webm`, `trace.zip`, `console.json` and `network.json`; geometry tests also contain both metrics JSON files.
- There are zero Console errors/page errors and zero non-benign network failures. Each test records one existing data-isolation cleanup warning; network files contain only permitted page-close aborts for `/api/task-events` and, in one Chromium case, `/api/activity`. These observations are retained instead of being reported as empty logs.
- **Local immutable-main verdict: PASS. Stage 3 verdict: NOT COMPLETE.** GitHub Actions, Coze exact-SHA `shadow`, isolated `canvas-v2`, real provider/billing checks and mandatory return to `legacy` remain unverified.

## 2026-08-14 Stage 3 CI gate repair regression

- The first GitHub run for `afa65eb` supplied useful RED evidence: PostgreSQL concurrency passed, while the Stage 3 browser job stopped at `wujie_users` before browser startup and the static job stopped on `6 moderate / 15 high` production advisories. The real-P0 browser job separately reported missing required secrets and remains an external blocker.
- S3-TEST-004 locks the workflow order as build -> start canonical production schema -> seed. A new isolated PostgreSQL database then seeded one user and 15 mode/profile projects and passed the two representative Chromium cases `2/2`.
- The production dependency contract passes `4/4` and verifies both patched versions and the narrow `pptxgenjs@4.0.1` hook. A generated presentation has a valid ZIP signature and non-empty payload. `pnpm audit --prod` now returns zero at every severity.
- Sharp 0.35 required type-only `Metadata` and `OverlayOptions` imports. Focused layer/upscale regression passes `18/18`; the production build remains `116/116` routes.
- Fresh candidate gates: TypeScript exit 0; ESLint exit 0; API `110/110` files and `480/480` tests; full Vitest exit 0; frozen install, YAML and whitespace checks pass.
- **Verdict: PASS LOCALLY FOR THE CI REPAIR CANDIDATE / STAGE 3 NOT COMPLETE.** A trusted-parent allowlist bootstrap, immutable GitHub Actions rerun, repository secret configuration and Coze three-mode/provider/billing evidence remain required.

## 2026-08-14 Stage 3 immutable CI follow-up

- On `main@0ac9068`, protected baseline, Stage 1, PostgreSQL concurrency and the complete static/tests/API/production-audit/build path pass. This closes S3-SEC-001 on immutable main.
- Legacy failed during seed because the table existed before background migration added `product_type`. Shadow and canvas-v2 seeded but each failed all 60 cases at login HTTP 503 because the generated auth secret was 28 characters. No Canvas behavior assertion executed in those failures.
- S3-TEST-004 now waits for exact seed-required columns instead of HTTP timing. Unit RED/GREEN is `3 failed / 14 passed -> 17/17`; real PostgreSQL delayed-column evidence waited 566ms.
- S3-TEST-005 permanently renders the Stage 3 job's minimum secret and requires at least 32 characters. Correctly scoped RED was `expected 18 >= 32`; combined fixture/release GREEN is `29/29` and YAML parses.
- **Verdict: LOCAL REPAIR PASS / IMMUTABLE CI RERUN REQUIRED.** Real P0 remains externally blocked by repository Secrets; Coze three-mode and billing evidence remain open.

## 2026-08-14 Stage 3 `c381d50` immutable matrix result

- `main@c381d5066359edc66531bf830a9c71a124a660fc` passed protected baseline, Stage 1, PostgreSQL concurrency, Doctor, TypeScript, ESLint, full unit/integration, API, production dependency audit and production build.
- S3-TEST-004 and S3-TEST-005 are closed on immutable main: legacy, shadow and canvas-v2 all completed clean-schema seeding, authenticated, and entered the five-browser Canvas matrix.
- The three mode jobs executed `180` browser cases: legacy `53/60`, shadow `53/60`, canvas-v2 `54/60`; combined `160 passed / 20 failed`. This is real RED evidence and does not qualify Stage 3 as complete.
- Failures consolidate into S3-TEST-006 merge-window observability, S3-BUG-017 hosted Chromium performance, and one S3-BUG-018 shadow WebKit immediate-reload geometry rollback. Thresholds remain unchanged.

## 2026-08-14 Stage 3 post-`c381d50` failure classification

- S3-TEST-006 reproduced locally and is closed by waiting for the exact asynchronous projects-sync GET after virtual-time advancement. No product merge code changed. The corrected scenario passes all five browser profiles `5/5`.
- The hosted performance failure remains open. The probe no longer rescans the full Canvas DOM for every monitored node on every frame; local Chromium and Chromium 1080p still pass all six fixed 100/300-node pan and save gates, with 56.85-58.88 FPS and zero continuity failures. Only a new immutable hosted run can validate the observer-cost hypothesis.
- Shadow WebKit immediate-reload rollback did not reproduce on the correctly configured local shadow production server: the exact scenario passes once plus five consecutive repeats (`6/6`). No speculative product persistence change was made.
- TypeScript passes after the test-harness changes. Generated Playwright output remains ignored and is not included in the candidate.
- **Verdict remains NOT COMPLETE.** The immutable three-mode matrix, real-P0 Secrets, Coze exact-SHA modes and rollback remain required.
- `real-p0-browser` still fails closed at configuration because required repository Secrets are absent. Paid providers and billing/refund were not executed and are not marked passed.
- **Verdict: NOT READY / ROOT-CAUSE TRIAGE IN PROGRESS.** Coze validation and Stage 4/5 remain prohibited.

## 2026-08-14 Stage 3 post-CI Canvas history and evidence closure

- GitHub Actions run `31797149839`, attempt 2 remains immutable RED: shadow `54/60`, legacy `56/60`, canvas-v2 `53/60`. Real P0 still fails closed because required repository Secrets are absent.
- The merge-window scenario now waits for its exact project-sync response. Evidence uses one narrowly tested lifecycle-abort classifier, and the performance probe caches monitored DOM pairs without weakening continuity assertions.
- A fresh local `canvas-v2` matrix initially produced four cascading failures: Firefox and mobile Chromium restored a two-node batch delete only briefly, then the next project projection returned to 98 nodes; the following 100-node cases inherited that state.
- Trace/network evidence separated two causes: the committed undo did not supersede a queued 98-node snapshot, and restored IDs retained deletion tombstones outside `asset-v3`. Both boundaries are now corrected.
- TDD retained source RED `1/21` and browser RED `4/4` after the first partial fix. Final focused Firefox/mobile passes `4/4`; a clean reseed followed by all five profiles passes `60/60` in 454.9 seconds.
- Fresh gates: TypeScript, ESLint and full Vitest exit `0`; PostgreSQL layer/annotation/element-board concurrency passes `4/4`; production build passes `116/116`.
- **Verdict: LOCAL CANDIDATE PASS / STAGE 3 NOT COMPLETE.** Immutable CI, real-P0 Secrets, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, paid providers and authoritative billing/refund evidence remain required.

## 2026-08-14 Stage 3 independent-review persistence barrier

- Independent read-only review found one P1: an immediate flush for a signature already saved by idle persistence could be deduplicated before the server durability barrier.
- Permanent TDD covers both completed-idle and in-flight-idle promotion. RED was `2 failed / 9 passed`; the focused persistence/Canvas/evidence set passes `50/50` after tracking server-flushed signatures separately.
- The rebuilt production matrix `final-local-matrix-p1-barrier-20260814` passes all five profiles `60/60` with unchanged functional, continuity and performance gates. A stricter teardown-only abort-filter experiment failed the evidence gate while business assertions completed; it was rejected because task-event/activity lifecycle cancellation also occurs during normal page operation.
- **Local verdict remains PASS; Stage 3 remains NOT COMPLETE.** Immutable CI, Coze exact-SHA rollout/rollback and real provider billing/refund evidence are still mandatory.

## 2026-08-15 Stage 3 Task 10 CI RED persistence and evidence closure

- The CI reproduction exposed S3-BUG-021: periodic and immediate project writes could race at one revision, an older success could adopt newer mutable state as its authoritative base, and debounced autosave stopped after a 409. TDD first retained the missing conflict retry as RED, then introduced one per-session sync queue, request-payload-bound adoption and one bounded GET/rebase/retry for autosave. Explicit forced flush still fails closed on conflict.
- Legacy Canvas project writes now use the same PostgreSQL revision compare-and-swap boundary without enabling Asset Graph reconciliation. Reload recovery keeps the latest source snapshot and rebuilds the unload beacon even when the ordinary snapshot was already saved.
- S3-TEST-008 closes an evidence loophole: sync abort recovery now requires a later successful request with the same canonical SHA-256 body digest; timestamps and digests are retained. A 409 is accepted only when a later project sync succeeds.
- Fresh production `canvas-v2` execution `local-final-candidate-r5-20260815` is retained as RED `58/60`. The first Chromium delete/undo case lost Ctrl+Z after the deleted DOM committed; the next move/resize case cascaded because that shared project remained empty. The other four browser profiles passed `48/48`, and all mandatory artifacts remain in the execution directory.
- The preceding exact-candidate `r3` run retained one mobile failure (`59/60`). Three reproductions and pointer diagnostics proved its geometric card center was covered by the right-panel collapse button (`pointerdown` target button, no Canvas image ID), while the image remained partly off-screen. The regression now selects a visible, unobstructed image pixel and a hittable resize handle; a clean three-repeat mobile check passes `3/3`, followed by the full `r4` matrix `60/60`. No Canvas production behavior or threshold was changed for this test-harness correction.
- Historical checkpoint: S3-BUG-022 was first narrowed to dependency-driven listener replacement and a `useLayoutEffect` candidate passed `22/22`. Exact legacy reproduction on `74268eb` later proved listener turnover still existed; the final stable-listener RED/GREEN evidence is recorded in the latest section below.

## 2026-08-15 Immutable `a372e9e` Actions classification

- GitHub Actions run `31866500220`, attempt 2, completed all three five-browser Canvas jobs. Shadow passed `55/60`, canvas-v2 `57/60`, and legacy `55/60`; all `13` failures were unchanged desktop-Chromium performance assertions. Firefox, WebKit and mobile Chromium functional flows passed, and the earlier immediate-reload geometry failure did not recur.
- Hosted performance remains RED without threshold changes: representative 100-node FPS values were `54.02`, `54.44` and `52.78` against `>=55`; 1080p 300-node FPS values were `38.29`, `41.67` and `39.3` against `>=45`; input P95 reached `50.6ms` and `72.1ms`; save long tasks reached `124ms` and `139ms` against `<=100ms`.
- Controlled local repeats on the exact source retained the original budgets and passed every captured performance assertion: desktop 100-node FPS `57.38-58.04`, 300-node FPS `54.79-57.67`, longest save task at most `50ms`, disappeared frames `0`, unclickable duration `0`. This does not override the hosted RED; S3-BUG-017 remains open for environment/application-cost isolation.
- S3-TEST-009 was reproduced from the first-attempt shadow Firefox artifact: a duplicate sync aborted after an exact-digest request had already returned 200. The filter now accepts either temporal ordering only for an exact canonical digest match. Focused tests pass `3/3`, real shadow Firefox passes `1/1`, and unrelated/failed requests remain fatal.
- S3-TEST-010 closes Windows-only CRLF source-contract failures. The Canvas selection contract passes `12/12`, focused tests pass `15/15`, and fresh full Vitest passes `426 files / 2448 tests` with `44` environment-gated PostgreSQL tests explicitly skipped in that generic command.
- Fresh code gates pass: TypeScript; ESLint `0 errors / 969 historical warnings`; full Vitest `426 files / 2447 tests` with `12 files / 44 tests` environment-skipped; production build; and isolated PostgreSQL `14 files / 54 tests` for terminal races, projection, idempotency, charge/refund, annotation, layer decomposition and element board concurrency.
- **Local candidate verdict: PASS FOR THIS CLOSURE. Stage 3 verdict: NOT COMPLETE.** A new immutable GitHub Actions matrix, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, real paid provider execution and one-time billing/cancel/refund evidence remain mandatory.

## 2026-08-15 S3-TEST-011 local five-browser closure

- TDD proved the FPS sampler mixed six RAF intervals with the wider automation action duration: the controlled sample was RED at `6 FPS` and GREEN at the mathematically consistent `62.5 FPS` after using the first-to-last RAF span.
- No product Canvas code, threshold or assertion category changed. Total action duration, input P95, generic/save long tasks, image decode/visibility, hit testing, disappeared frames and unclickable duration remain independently collected and enforced.
- A fresh production shadow performance subset passed `6/6`. The full Chromium, Chromium 1080p, Firefox, WebKit and mobile Chromium matrix then passed `60/60` in `local-frame-span-full-20260815`.
- Desktop Chromium evidence: 100-node FPS `58.61-58.64`; 300-node FPS `55.30-56.78`; input P95 `16.4-24.1ms`; longest save task `0-51ms`; disappeared frames `0`; unclickable time `0`.
- **Local verdict: PASS. Immutable verdict: PENDING.** The historical GitHub RED remains valid for its old sampler; S3-BUG-017 closes only after a new committed SHA passes legacy, shadow and canvas-v2 hosted jobs.

## 2026-08-15 `c4c02a9` immutable RED and local repair candidate

- GitHub Actions run `31870799781` is retained as RED: legacy `57/60`, shadow `59/60`, canvas-v2 `56/60`. Static/tests and PostgreSQL concurrency passed; real P0 failed closed because required repository Secrets are absent.
- Legacy WebKit restored the final undo in the DOM but emitted no matching save POST. TDD proved the scheduler deduplicated a later immediate revision when its content cycled back to an older server-flushed signature. Revision-aware immediate durability is now `13/13` GREEN while idle content deduplication remains intact.
- Hosted performance analysis did not lower thresholds. Non-shadow pan now computes only its active engine; shadow still computes and compares both. Reverse-box preview no longer rerenders the full Canvas on every move, and the evidence sampler schedules the next RAF before executing the same continuity probes.
- Fresh local gates after the repairs: focused `47/47`; full Vitest `428 files / 2454 passed`, `12 files / 44 PostgreSQL-gated skipped`; TypeScript exit 0; ESLint exit 0; build `116/116`; exact trusted protected-source gate `38/38` with no unapproved drift.
- The local machine has no isolated PostgreSQL service, so the exact legacy WebKit database flow cannot be represented honestly here. **Verdict: LOCAL CODE GATES PASS / IMMUTABLE BROWSER VERDICT PENDING.**

## 2026-08-15 Stage 3 follow-up after immutable run `31873152403`

- Immutable source: `main@30fdedc793cf66d45863b01725186f85d681fd0a`.
- Retained RED: canvas-v2 `54/60`, legacy `56/60`, shadow `54/60`; hosted performance budgets and WebKit immediate-reload durability failed.
- New TDD GREEN: Canvas autosave recovery, pan virtualization, direct box-selection visuals, selection wiring, immediate autosave wiring, UserManager synchronization, persistence scheduler and Canvas command suites pass `132/132`.
- Repository GREEN: ESLint error gate, TypeScript, full Vitest `2458` passed, production build `116/116`, and `git diff --check`.
- Explicitly not verified locally: `44` PostgreSQL-gated tests, the immutable three-mode browser rerun, real provider/accounting P0, and Coze rollout/rollback.
- Verdict remains **NOT READY** until the new exact commit passes immutable browser evidence.

## 2026-08-15 stable Canvas shortcut listener regression

- Immutable run `31875413077` is retained as RED: canvas-v2 `56/60`, shadow `56/60`, legacy `53/60`. No retry or local pass replaces that evidence.
- Exact unmodified legacy reproduction passed `10/12`; delete/undo failed and polluted the following move/resize fixture. Trace and database state confirmed the delete persisted while the immediate Ctrl+Z never entered Canvas history.
- The first queued-command candidate was rejected and reverted after it moved the loss to the final undo. The final minimal fix keeps one DOM listener attached for the component lifetime and updates only a ref containing current handlers.
- TDD: stable-listener contract RED `1/23`, GREEN `23/23`; command plus selection contracts `35/35`. Fresh production legacy Chromium passes `12/12`; mobile history/continuity passes `4/4`.
- Full repository gate: `428` test files / `2461` tests passed, `44` PostgreSQL-gated tests explicitly skipped, ESLint and TypeScript exited 0, build completed `116/116`, protected features remained `38/38`.
- **Regression verdict: local fix passes; Stage 3 remains NOT READY.** A new immutable three-mode run, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, and real provider billing/cancel/refund evidence are still required.

## 2026-08-15 direct-pan and immediate-save candidate after run `31878749102`

- The immutable source `main@9d8e7bf73c694d8220472c19e4bad85607da63db` remains RED: legacy, shadow and canvas-v2 each passed `57/60`. One legacy save sample reached `156ms`; hosted desktop FPS still missed unchanged budgets.
- TDD added direct-pan ownership, runtime state-setter and viewport synchronization contracts before production changes. The first independent review rejected the candidate because pointerdown still published React state and competing pointers could replace or terminate the active pan. The repaired implementation keeps begin ref-only, rejects a second pointer and accepts move/up/cancel only from the authoritative owner; the follow-up independent review returned `APPROVED`. Short Space/hand movement remains off parent React state while culling synchronization still enters React state for long movement. Immediate Canvas persistence records its audit only after the authoritative project sync settles.
- `translate3d` and a `content-visibility` removal were measured separately and rejected. The latter produced a concrete 1080p/300-node `60.2ms` P95 failure, so neither experiment remains in the candidate.
- Fresh production execution `local-owner-safe-legacy-full-20260815` passes all five browser profiles `60/60`. Chromium/1080p 100-node pan is `57.42/57.42 FPS`, 300-node pan is `54.82/54.26 FPS`, input P95 is at most `40.1ms`, with zero save long task, zero disappeared frames and zero unclickable duration.
- Full verification passes: focused `8 files / 78 tests`; `441/441` test files and `2512/2512` tests against an isolated PostgreSQL database with no skips; TypeScript; ESLint `0 errors / 973 historical warnings`; production build `116/116`; reviewed protected-feature/source gate `38/38`; and `git diff --check`.
- **Verdict: LOCAL REGRESSION PASS / IMMUTABLE VERDICT PENDING.** This does not close S3-BUG-017 or authorize Stage 4/5. The exact committed SHA must pass all three hosted modes before Coze rollout.

## 2026-08-16 Coze stale app-shell chunk regression

- Exact Coze source `main@fc190b1214f7ec5a1c3588b2be31a87db29f2337` built and started, but authenticated Google Chrome reached the global error boundary with `Loading chunk 5504 failed`.
- The missing hashed chunk returned HTTP 500 while `/` returned HTTP 200 with a one-year `s-maxage` and `X-Nextjs-Cache: HIT`. This preserves the real deployment failure and rejects the false inference that a root 200 means the UI is healthy.
- A RED/GREEN source contract now requires the authenticated root layout to render dynamically. The production build reports both `/` and `/simple-chat` as dynamic, and a real local production request returns `no-store, private, max-age=0` instead of long-lived shared caching.
- Full local gates pass against isolated PostgreSQL 18: `441/441` files, `2521/2521` tests, zero skipped; TypeScript passes; ESLint is `0 errors / 973 warnings`; production build and the `38/38` protected-feature gate pass.
- Coze then synchronized exact `main@9a6363f021f7197b3aa5a9cf834c0c1c0419cb67`. Fresh authenticated Chrome tabs loaded both the dashboard and `/simple-chat` without the global error boundary or `Loading chunk`; the current HTML references 11 static assets and all 11 return HTTP 200. The old `5504` chunk is no longer referenced, and the external root response is now private `no-store`.
- **Verdict: CLOUD REGRESSION PASS FOR S3-BUG-032.** Stage 3 Task 10 remains active: the historical blank project thumbnail is still visible, GitHub immutable workflows remain billing-blocked, and hosted Canvas plus real-P0 evidence are still required. This does not authorize Stage 4/5 or any change to `stable`.

## 2026-08-15 Space-pan hot-path candidate after immutable run `31884790226`

- Stage 0/1 run `31884789686` passed. Quality run `31884790226` retained a real RED result: static and PostgreSQL jobs passed, real-P0 failed closed on missing repository Secrets, and desktop performance left legacy at `57/60`, shadow at `58/60` and canvas-v2 at `57/60`. No threshold or evidence assertion was relaxed.
- TDD proved that Space keydown still published parent React state before the compositor-only pointer path. The first RED/GREEN cycle was `2 failed / 33 passed -> 46/46`. Independent review then identified focus-loss stickiness; a second `3 failed / 35 passed` cycle added repeat-key, blur, hidden-document and unmount behavior. The final focused set is `4 files / 49 tests`, and independent review is `APPROVED` with no Critical or Important finding.
- Fresh production Chromium performance passes `4/4`: 100/300 nodes are `58.34/58.33 FPS`, 1080p 100/300 nodes are `59.01/57.51 FPS`, input P95 is at most `27.5ms`, and save/disappearance/clickability failures are zero.
- The first full five-profile run ended `58/60`. One desktop history test was blocked by an open workspace panel and one mobile case inherited a dirty shared fixture. After deterministic database reseeding, the exact failed cases passed `2/2`; no business-code workaround was added. An intermittent local Next static-asset 500 was retained as deployment evidence; after a clean server restart, all `60/60` probed static assets returned 200.
- Final local gates pass: PostgreSQL-enabled Vitest `441/441 files, 2517/2517 tests`; TypeScript; ESLint `0 errors / 973 historical warnings`; production build `116/116`; exact protected feature/source gate `38/38`; whitespace check; and independent review.
- **Verdict: LOCAL REGRESSION PASS / IMMUTABLE VERDICT PENDING.** Stage 3 Task 10 remains active until the new exact SHA passes all three hosted modes and the real-P0, Coze sequence and provider/accounting evidence are closed.

## 2026-08-15 immutable result for `main@3e46150`

- Stage 0/1 run `31887634672` passed completely. Quality run `31887632360` passed PostgreSQL concurrency/settlement and the complete static/test/audit/build job.
- Three-mode functional coverage remained intact, but performance stayed RED: legacy `59/60`, shadow `58/60`, canvas-v2 `56/60`. Exact misses were legacy 1080p/100 `53.89 FPS`; shadow 1080p 100/300 `51.03/41.92 FPS`; canvas-v2 Chromium/100 `45.36 FPS`, Chromium/300 input P95 `60.9ms`, and 1080p 100/300 `48.78/40.74 FPS`.
- No functional, continuity, history, persistence, save-budget, disappeared-image or unclickable-frame assertion failed. This narrows the next diagnosis to hosted desktop pan rendering/input cost rather than a broad Canvas regression.
- Real-P0 failed closed on missing repository Secrets and paid-test controls before installing browsers. It remains an external release blocker and cannot be replaced by local or Mock evidence.
- **Verdict: IMMUTABLE RED / STAGE 3 TASK 10 REMAINS ACTIVE.** Do not enter Coze mode switching or Stage 4/5.

## 2026-08-15 local candidate after pointer-up root-cause isolation

- A production diagnostic isolated the remaining cost to pointer-up reconciliation: move frames stayed near `57-60 FPS`, while the 300-node commit produced a `131-136ms` long task. The diagnostic file was removed after evidence collection and is not part of the candidate.
- TDD added a permanent runtime contract and changed only the viewport publication boundary. Refs, shadow comparison, compositor transform and cancel snapback remain immediate; React viewport publication is marked as a transition.
- With a clean PostgreSQL reset before every mode, legacy, shadow and canvas-v2 each pass `60/60` across five browser profiles (`180/180`). Lowest FPS is `56.89`, highest input P95 is `20ms`, and all continuity, selection, history, persistence, save and 100/300-node assertions pass without threshold changes.
- Fresh gates: focused Canvas `55/55`; full Vitest `438 passed / 3 skipped files`, `2514 passed / 4 skipped tests`; TypeScript; ESLint `0 errors / 973 warnings`; production build `116/116`; whitespace check.
- **Verdict: LOCAL REGRESSION PASS / IMMUTABLE VERDICT PENDING.** Stage 3 Task 10 remains active; this evidence does not authorize Coze mode switching or Stage 4/5.

## 2026-08-15 immutable result for `main@3535268`

- Stage 0/1 `31891554685` passed. Quality `31891554677` passed PostgreSQL concurrency/settlement and all static, test, API, dependency-audit and production-build gates.
- Canvas remained performance RED: canvas-v2 `56/60`, legacy `57/60`, shadow `57/60`. The lowest observed desktop FPS was `37.65`; the highest input P95 was `76.5ms`. All functional, continuity, history, persistence, save, disappeared-image and unclickable-frame checks passed.
- This disproves the hypothesis that deferring pointer-up React publication alone is sufficient on Hosted runners. The next diagnosis is restricted to work shared by pointer-move/compositing across all three modes.
- **Verdict: IMMUTABLE RED / STAGE 3 TASK 10 REMAINS ACTIVE.** Real-P0 Secrets, Coze sequence and provider/accounting remain blocked; Stage 4/5 stay prohibited.

## 2026-08-15 direct-pan pointer-ownership candidate

- TDD proved the missing pointer-capture contract RED before production code changed, then GREEN in the focused `55/55` Canvas set.
- A production browser assertion passes all five profiles (`5/5`): the viewport owns the pointer during direct pan and releases it at pointer-up; existing Space/focused-button behavior and compositor transform movement remain intact.
- The first short-ID desktop performance run passed `3/4`; Chromium/300 missed only input P95 at `54.5ms` while FPS was `55.70` and continuity failures were zero. Three exact repeats passed `3/3` with P95 at most `28.7ms` and FPS at least `56.23`.
- An earlier long temporary run ID caused a locator-only failure because Canvas alt text is intentionally truncated to 60 characters. Reseeding with the established short-ID fixture contract removed that test-fixture collision; no product code was changed for it.
- Fresh full gates pass: Vitest `438 files / 2514 tests`, separately gated PostgreSQL concurrency `3 files / 4 tests`, TypeScript, ESLint `0 errors / 973 historical warnings`, and production build `116/116`.
- A final post-correction production run passes pointer ownership `5/5` and desktop performance `4/4`; FPS is `57.66-58.73`, input P95 `17.3-19.5ms`, and save/disappeared/unclickable metrics are zero.
- **Verdict: LOCAL CANDIDATE, NOT A RELEASE PASS.** The cold input outlier is retained and immutable legacy/shadow/canvas-v2 evidence decides whether the candidate closes the hosted regression.

## 2026-08-16 immutable `2509fcf` result and hover-hot-path candidate

- Immutable Stage 0/1 run `31895277670` passed. Quality run `31895277650` passed its static, full-test, API, dependency-audit, build and PostgreSQL jobs; real-P0 failed closed on the same ten missing authorized Secrets/paid controls.
- The three Canvas modes remained RED: canvas-v2 `56/60`, shadow `57/60`, legacy `57/60`. Exact hosted FPS misses were canvas-v2 Chromium/100 `53.47`, Chromium 1080p/100 `51.85`, Chromium 1080p/300 `43.98`; shadow `54.61/52.14/39.66`; legacy `54.15/53.15/41.89`. Fixed `55/45 FPS`, `50ms` input and `100ms` save limits were unchanged.
- Canvas-v2 WebKit also timed out once while waiting for the retained merge marker after reload. The exact production WebKit flow passed once plus three consecutive repeats (`4/4` total), so no timeout or business persistence change was made without stable reproduction.
- TDD then isolated per-image hover state churn during pan. A first implementation that disabled media hit testing was rejected because it produced `3133.3-5650ms` unclickable evidence, despite strong FPS. The corrected implementation leaves `pointer-events:auto`, marks only the pan lifecycle and suppresses hover React publications while that pointer owns the viewport.
- Focused runtime/source contracts pass `33/33`; five-browser behavior passes `5/5`. Canvas-v2 desktop performance passed `4/4` plus a repeated `12/12`, with combined FPS `57.81-59.08`, input P95 `10.8-33.4ms`, save `0ms`, disappeared `0`, unclickable `0`. Shadow passes `4/4` at `57.82-58.76 FPS`. Legacy retained one `57.7ms` P95 outlier, then the exact Chromium/300 case passed `3/3` at `18.4-29.2ms`.
- Fresh repository gates pass: PostgreSQL-enabled Vitest `441/441 files, 2520/2520 tests`, TypeScript, ESLint `0 errors / 973 warnings`, production build `116/116`, and whitespace validation.
- **Verdict: LOCAL REGRESSION PASS / IMMUTABLE VERDICT PENDING.** Stage 3 remains Task 10; Coze mode switching and Stage 4/5 are not authorized.

## 2026-08-16 immutable `b4ad786` result and projection-only visibility candidate

- Stage 0/1 run `31898199259` passed. Quality run `31898199267` passed static/tests/build and PostgreSQL concurrency. Real-P0 failed closed on the same ten missing authorized URL/account/model/paid controls.
- Hosted canvas-v2 and legacy each passed `57/60`; shadow passed `54/60`. The missed desktop thresholds were not changed. Shadow also retained one Chromium reverse-box input outlier and one WebKit merge-window deletion fluctuation.
- The new TDD candidate removes the redundant per-card `content-visibility:auto` while retaining RBush render projection as the visibility authority. No pointer events, feature routes, task states, persistence or accounting code changed.
- The current production build passes canvas-v2 `16/16`, shadow `4/4` and legacy `4/4`; FPS is `57.21-59.06`, input P95 at most `30.6ms`, and save/disappeared/unclickable evidence is zero. Exact functional repeats pass Chromium reverse-box `3/3` and WebKit merge-window deletion `3/3`.
- Full local gates pass: PostgreSQL-enabled Vitest `441 files / 2520 tests`, TypeScript, ESLint `0 errors / 973 warnings`, production build `116/116` and the focused Canvas set `41/41`.
- An older baseline had rejected this same CSS removal after a `60.2ms` local input sample. That evidence remains valid historical risk; this candidate is not accepted until the new immutable three-mode matrix passes.
- **Verdict: LOCAL CANDIDATE, NOT RELEASE-READY.** Stage 3 remains Task 10 (`10/11`); Stage 4/5 and Coze mode switching remain blocked.

## 2026-08-16 real Pear generation, cancellation and quick-create fallback candidate

- Source under real browser test: `main@e9efd5d8dee8ab06f91ab6d5eb81c6c815391284`. A Pear `gpt-image-2` request completed in about 25 seconds, added one `1536 x 1024` image to Canvas and charged exactly 60 credits (`138 -> 78`, cumulative usage `3122 -> 3182`). This is positive provider-routing and single-charge evidence, not a cancellation pass.
- The immediately following real cancellation reproduced a P0 failure: processing continued, a late image was accepted about 40 seconds later, and the 60-credit charge remained (`78 -> 18`, cumulative usage `3182 -> 3242`). Evidence is retained at `test-results/screenshots/stage3-cancel-late-result-failure-e9efd5d.png`.
- TDD isolated the cancellation defect to a durable generation slot temporarily marked memory-only in the registry. The new regression was RED before the change and GREEN `15/15`; the related task/state/projection suite is `190 passed / 1 PostgreSQL-gated skipped`.
- Quick Create now treats a Coze proxy-level HTTP 404 as a transport failure only when no terminal business code was received. Its RED/GREEN regression and broader focused suite pass `36/36`; the production route table still contains `/api/quick-create/compile`.
- Fresh local release gates after both source changes: full Vitest `429 files passed / 12 skipped`, `2478 tests passed / 44 skipped`; TypeScript exit 0; ESLint exit 0 with `0 errors / 973 historical warnings`; production build completes `113` static pages; protected-source gate passes `38/38`; whitespace check has no errors. Every skip is explicitly tied to missing `POSTGRES_TEST_DATABASE_URL`.
- **Verdict: LOCAL CODE GATES PASS / CLOUD REGRESSION PENDING.** The deployed exact SHA must prove cancelled terminal state, late-result rejection, one refund only and quick-create fallback. GitHub Actions runs `31916152862` and `31916152867` remain infrastructure-unexecuted due billing; they are neither product passes nor failures.

## 2026-08-16 Coze regression on `main@2cefe59`

- Quick Create transport fallback activated in the real Coze UI and submitted the raw prompt to Pear successfully. The generated task used `gpt-image-2`; this is positive cloud evidence for the fallback path.
- Cancellation failed before the API boundary. Task `async-1786873074765-0-9um5aa` completed after `39.16s`, entered Canvas, charged exactly 120 credits once, and produced no refund. PostgreSQL and audit logs contain no `/api/cancel-task` request for that task.
- Code inspection shows the visible cancel buttons allowed `pointerdown` to reach the Canvas drag handler, which captured the pointer before `click`. A RED/GREEN regression now requires both buttons to stop pointer propagation; cancellation/API/client focused tests pass `23/23`.
- Fresh local gates pass: Vitest `429 files / 2479 tests`, with `12 files / 44 PostgreSQL-only tests` explicitly skipped; TypeScript exit 0; ESLint exit 0 with `0 errors / 973 historical warnings`; production build `113/113`; protected features `38/38`; whitespace check clean.
- **Verdict: P0 REMAINS OPEN / SECOND LOCAL CANDIDATE.** GitHub Actions billing is bypassed only for execution flow; it is not treated as passing evidence. A new Coze exact-SHA paid cancellation/refund run is still required.

## 2026-08-16 Coze cancellation closure on `main@9e6cfb0`

- Coze synchronized exact `main@9e6cfb066bfe05a64fbd210873a3758cf2b3225d`. Authenticated Google Chrome submitted a real Pear `gpt-image-2` Quick Create task and displayed its processing-card cancel control.
- Clicking cancel produced the expected client boundary logs from processing-card intent through `/api/cancel-task`, removed the card immediately, returned terminal `cancelled`, and displayed `任务已被取消`. After 50 seconds, no late green-star test image entered Canvas.
- The authenticated cancellation API was then called again for the exact task `async-1786874691821-0-gqs5y2`. It returned HTTP 200 and the same durable `cancelled` task instead of creating a new task or terminal transition.
- The credits API proves one `-120` consume and exactly one `+120` refund; balance returned `18 -> 138`. After the repeated cancel, the refund-row count for the task remained one. UI evidence is retained at `docs/testing/evidence/s3-bug-033-repeat-cancel-refund-idempotency.png`.
- A fresh isolated PostgreSQL 18 cluster then supplied both `POSTGRES_TEST_DATABASE_URL` and `TEST_POSTGRES_URL`. Full Vitest executed `441/441` files and `2523/2523` tests with zero skips. The run includes atomic task billing, terminal-state races, rollback, task projection, annotation, element-board and Pear layer-decomposition concurrency. Machine-readable evidence: `docs/testing/evidence/s3-bug-033-local-postgres-2026-08-16.json`.
- **Verdict: S3-BUG-033 CLOUD AND LOCAL POSTGRESQL REGRESSION PASS.** This closes the reproduced cancellation/accounting P0. Billing-blocked GitHub Actions remain unexecuted rather than passed, and Stage 3 remains Task 10 (`10/11`).

## 2026-08-16 exact-SHA Canvas media stability regression

- Candidate `0a34c73479d46e8dff85e3c033a9200765291454` stabilizes unchanged image rendering and closes the source rollback race without changing Canvas coordinates, selection, history, persistence, providers or billing.
- The permanent sampler now listens to native image `load` events and `src` mutations for nodes known to be complete before measurement. Desktop Chromium fails if any monitored node reloads or rewrites its source during pan.
- Fresh isolated PostgreSQL matrices pass canvas-v2 `60/60`, legacy `60/60` and shadow `60/60` across Chromium, Chromium 1080p, Firefox, WebKit and mobile Chromium (`180/180`). All 30 pan samples report zero disappeared frames, zero unclickable time and zero monitored media events.
- Desktop Chromium metrics across all modes: minimum `55.62 FPS`, maximum input P95 `43.9ms`; fixed gates remain `55/45 FPS`, `50ms` input P95 and `100ms` save overlap.
- Full local gates pass: `441/441` Vitest files, `2527/2527` tests, TypeScript, production build `113/113`, ESLint `0 errors / 973 historical warnings`, protected features `38/38` and whitespace.
- **Verdict: EXACT-SHA LOCAL THREE-MODE REGRESSION PASS.** GitHub Actions executed zero steps because of account billing, so immutable hosted evidence remains unverified and Stage 3 stays at Task 10 (`10/11`).
## 2026-08-18 Stage 4 Task 4 final local regression

- Candidate source: `codex/wj-stable-s4` based on `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`.
- Full PostgreSQL-enabled Vitest: `476/476` files, `2920/2920` tests, zero failures and zero skips.
- API: `117/117` files, `582/582` tests.
- Component/lib regression: `320/320` files, `2063/2063` tests.
- Production browser matrix: `15/15` across Chromium, Chromium 1080p, Firefox, WebKit and mobile Chromium.
- Fixed performance threshold retained: three Chromium 1080p 100-node samples were `56.70`, `57.15` and `55.62 FPS`; P95 stayed below `17 ms`.
- Console/PageError, unexpected HTTP failures, disappeared frames and unclickable duration: zero in the final matrix.
- TypeScript, Doctor, production build (`113` routes), protected baseline (`38/38`) and whitespace checks passed.
- ESLint: `0 errors / 988 historical warnings`; warnings were not hidden or converted to ignores.

Result: local Stage 4 Task 4 regression **passed**. This does not replace Coze exact-SHA or unavailable GitHub-hosted evidence.

## 2026-08-20 S4-BUG-008 project workflow persistence regression

- Authenticated Google Chrome on Coze `main@2557d67` proved the defect at both boundaries: standalone workflow save returned HTTP 200 and Workflow Hub reopened one node, while project reload followed by direct node-mode entry restored zero nodes.
- TDD began RED (`2 failed / 4 passed`) and now passes the focused workflow suite (`6/6`) plus related project recovery, autosave, UI and sync coverage (`81/81`).
- Fresh full gates pass: Vitest `2852 passed / 70 explicitly PostgreSQL-gated skipped`, TypeScript, production build (`113` routes), whitespace check and ESLint `0 errors / 988 historical warnings`.
- Coze pulled exact `main@016e5d2feb98cb0377fc0475389b10b914c1020f`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged. The first build was terminated by sandbox memory pressure and briefly left the prior runtime on port 5000, so that attempt was retained as failed deployment evidence rather than counted as a product pass. Coze subsequently completed the production build and restarted the service.
- In authenticated Google Chrome profile `用户1`, a fresh one-node workflow save returned HTTP 200 from `/api/workflow/save`, followed by HTTP 200 project-sync requests containing `metadata.workflow` and the same `input-image` node. After a full reload, direct node-mode entry restored `1 节点 · 0 连线` without using Workflow Hub. A clean final reload/entry window contained zero fresh Console Error/Warning or uncaught exception.
- **Verdict: EXACT-SHA COZE GOOGLE CHROME REGRESSION PASS FOR S4-BUG-008.** This closes only project workflow save/reload persistence; PostgreSQL-only, immutable Actions and broader Stage 4 release gates remain unchanged.

## 2026-08-20 Stage 4 cross-workspace and renderer rollout regression

- Testing used authenticated Google Chrome profile `用户1` on the isolated Coze preview. Workspace HEAD was `e097e82aef9221c6cfa2feea781a08f3d44246c8`; its business runtime was equivalent to `016e5d2feb98cb0377fc0475389b10b914c1020f`. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` was not modified.
- A canonical Canvas asset version `66621b79-77c2-561f-966f-0c9870ba168a` was dragged into node mode. `POST /api/assets/transfer` returned HTTP 200 for `workflow-input`. The connected input/output workflow completed `5/5`.
- Clicking the normalized output's `发送到智能对话` navigated to `/simple-chat?projectId=s3zk7z3gmsoo15gz`. A second `POST /api/assets/transfer` returned HTTP 200 for `chat-result`, and the page visibly rendered `工作流结果已返回：图片输出` with the blue-cup image. Evidence: `docs/testing/evidence/stage4-workflow-chat-return-2026-08-20.png`.
- A legacy green-cup Canvas image had no asset identity. Its workflow executed, but output-to-chat failed closed with `输出缺少规范素材版本，无法发送到智能对话`. This is retained as S4-BUG-009, not counted as a cross-workspace pass.
- The standalone-chat front half could not invoke the image tool because the only authorized chat provider, APImartLLM, returned upstream `get_channel_failed`. No image-provider task was created and no image-generation charge is claimed.
- Renderer rollout used the same saved project and no rebuild: `legacy -> shadow -> react-flow-v2 -> legacy`. Shadow exposed the legacy surface plus an inert probe with `data-in-sync=true`. React Flow v2 rendered and dragged the node, but a selected React Flow node did not populate the property panel; S4-BUG-010 remains open. The sandbox was restored to server-delivered `legacy` with HTTP 200.

## 2026-08-20 S4-BUG-009 and S4-BUG-010 local repair

- TDD retained two independent RED cases: historical images had no adoption-before-transfer path, and clicking a real React Flow node left `选中节点查看属性` visible.
- S4-BUG-009 now uses a session-owned, transactional legacy adoption endpoint before canonical workflow transfer. Unknown images and client-supplied owner fields fail closed; the Canvas receives the resulting IDs without polluting undo history.
- S4-BUG-010 now projects React Flow node/pane clicks into domain `selection.set` commands. React Flow drag remains locally controlled and still commits only at drag end.

## 2026-08-20 React Flow v2 selection cloud pass and S4-BUG-011 local repair

- Coze's business tree was equivalent to `main@c99fb7270e1dc81343733675b2b18d9935499ff9`. A transient missing-chunk screen was not counted as product evidence: the root and current `9205` chunk both subsequently returned HTTP 200, while the adoption route returned the expected GET 405.
- In authenticated Google Chrome, forced `react-flow-v2` rendered exactly one React Flow surface and no legacy surface. Node click selected the domain node and populated the property panel; blank-pane click cleared both selections; Console Error/Warning remained zero. S4-BUG-010 selection behavior therefore passes its cloud gate.
- Editing `名称` and immediately clicking Save exposed a new reproducible persistence failure: the UI displayed `已保存`, but reload restored the old label. This evidence is retained as S4-BUG-011 rather than hidden under the selection pass.
- RED first expected `renamed before save` but the save request contained `drag source`. The minimal fix serializes `wfRef.current`, writes `label` at the top level and makes top-level-only node merges null-safe.
- Fresh local evidence passes focused `4/4`, related Stage 4 `83/83`, full Vitest `2858 passed / 70 PostgreSQL-gated skipped`, TypeScript, ESLint with zero errors, production build `114/114` and whitespace validation.
- The isolated Coze runtime was restored to `legacy` and root HTTP 200. **Verdict: S4-BUG-010 CLOUD PASS; S4-BUG-011 LOCAL PASS / EXACT-CANDIDATE CLOUD RETEST REQUIRED.**

- Focused tests pass `8/8`; the expanded asset/workflow regression passes `87/87`; full Vitest passes `462` files and `2857` tests with `70` explicitly PostgreSQL-gated skips. TypeScript, production build, whitespace and ESLint `0 errors / 988 historical warnings` pass.
- **Verdict: LOCAL REGRESSION PASS, CLOUD ACCEPTANCE PENDING.** No Coze or real PostgreSQL success is inferred from mocked route tests; `legacy` remains the delivered renderer until the exact pushed SHA is retested in Google Chrome.
- Fresh browser logs for the renderer interaction contained no Console Error/Warning. This does not waive the two functional defects.
- **Verdict: NORMALIZED `CANVAS -> WORKFLOW -> CHAT` PASS; FULL STAGE 4 CHAIN AND REACT FLOW V2 ROLLOUT NOT PASSED.**

## 2026-08-20 S4-BUG-011 exact-business-tree cloud closure

- Coze commit `bdd1122b818783a7c74972184e5f90676610ea37` cleanly cherry-picked `main@5a5ee387a49ad592e0f3a80f7de69bbf5de6dbd4`; `git diff --quiet origin/main -- .` returned 0 and `stable` remained `52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- The Coze production build exited 0 and generated `114/114` pages. The candidate first started in `react-flow-v2` and returned HTTP 200.
- Authenticated Google Chrome selected the one restored node, changed its name to `图片输入 · S4云端5a5`, clicked Save immediately after the edit, observed `已保存`, fully reloaded the page and restored that exact value. Blank-pane click then cleared both the React Flow selection and property panel.
- The test value was restored to `图片输入`, saved and confirmed after another full reload. No test residue remains in the project.
- Console history retained expected 404/502 warnings from the deliberate build downtime. After the candidate started, no new Console Error/Warning appeared and no global error boundary rendered.
- Forced rollback started `legacy` with HTTP 200. The reloaded node page exposed `data-workflow-legacy-surface=true`, had zero React Flow surfaces and retained `1 节点 · 0 连线`.
- **Verdict: S4-BUG-010 AND S4-BUG-011 EXACT-BUSINESS-TREE COZE GOOGLE CHROME PASS.** S4-BUG-009 historical adoption and Stage 4 provider/accounting evidence remain open.

## 2026-08-20 S4-BUG-009 historical asset cloud closure

- The authenticated legacy Canvas loaded five existing images. The green-cup record `gen-ph-1786870574533-0-udi5ds` initially lacked canonical IDs in the client workflow payload.
- Dragging that historical image to empty node space issued `POST /api/assets/adopt-canvas-image` with only `projectId + imageId`. HTTP 200 returned asset `00f43bc6-6bef-55de-be8f-55aa5c155a74`, version `d4e3cb84-6fb9-5cd0-9baf-a902a3da8ac3` and Canvas placement `000d7289-6ae9-51a8-96f2-2af8cd9a7a94`.
- The client then issued the canonical `workflow-input` transfer with that exact version. HTTP 200 created placement `836ce9f3-cdaf-437d-9335-5a5e1c1563eb`. The request body for workflow execution contained the canonical IDs, one connection and the intended historical image URL; execution completed `3/3`.
- Sending the output to standalone chat issued a `chat-result` transfer with the same version and returned placement `2988d36b-fa29-4eba-9ab7-f9859986ba70`. Chat visibly rendered `工作流结果已返回：图片输出` and `/api/serve-upload/uploads/gen-1786870615869-42tmc8.png`.
- Replaying the exact workflow-return intent returned the same placement with `reused: true`. A full project reload retained the canonical IDs in the historical image drag payload, proving the identity write-back survived hydration.
- Test state was restored to five Canvas images and the original one empty workflow node. The generated output node/image and one transient upload file created during interaction targeting were removed. Fresh Console Error/Warning count was zero.
- **Verdict: S4-BUG-009 REAL COZE POSTGRESQL + GOOGLE CHROME PASS.** Stage 4 provider charge/cancel/refund evidence remains open and is not inferred from this non-billable pass-through workflow.

## 2026-08-20 Stage 4 real-provider cancellation and UI regression

- Authenticated Google Chrome submitted Pear `gpt-image-2` task `async-1787237343655-0-ehq3d9` through the professional generation panel and clicked the visible cancel control about 10.5 seconds later.
- The terminal poll returned `cancelled`; after 73,895 ms no matching result entered Canvas. PostgreSQL-backed credits evidence contained one `-60` charge and one `+60` refund, restoring balance `138`. Repeating cancellation returned the same terminal task and retained exactly one refund.
- The run also exposed S4-BUG-012: `success=false/retryable=false/status=cancelled` entered the generic failure branch before the dedicated cancellation branch, producing one Console Error and a `生成失败` toast despite correct business cancellation.
- TDD was RED for branch precedence, toast severity and red failure styling. The narrow local repair is GREEN across `5 files / 39 tests`; full Vitest passes `2860` tests with `70` PostgreSQL-only tests explicitly skipped. TypeScript, ESLint and production build (`114/114`) pass.
- Evidence: `docs/testing/evidence/stage4-provider-cancel-accounting-cloud-2026-08-20.json` and `docs/testing/evidence/stage4-provider-cancel-cloud-2026-08-20.png`.
- **Verdict: BUSINESS CANCELLATION/ACCOUNTING PASS ON DEPLOYED SOURCE; UI FIX LOCAL PASS / CLOUD RETEST REQUIRED.** Direct provider-side remote-task cancellation is not claimed because a distinct provider task ID was not available.

## 2026-08-20 S4-BUG-013 terminal-placeholder persistence regression

- Rebuilding and reloading the production runtime exposed a previously cancelled and refunded task as a fresh 1% Canvas placeholder. The authoritative task remained `cancelled`; only the project placement snapshot was stale.
- Backward tracing proved task terminal projection and the dedicated processing-placeholder predicate were correct. The generic Canvas placement predicate still retained every placeholder and was used by autosave, unload and user-project serialization.
- TDD reproduced the bug before the fix (`1 failed / 12 passed`). The minimal persistence-boundary change then passed focused task projection/persistence tests (`41/41`) and the expanded autosave, project-reopen, server-sync and damaged-media matrix (`109/109`).
- Fresh full gates pass: Vitest `463 files / 2861 tests`, with `15 files / 70 PostgreSQL-gated tests` explicitly skipped; TypeScript exit 0; ESLint exit 0 with `0 errors / 988 historical warnings`; production build `114/114`.
- **Verdict: LOCAL FIX PASS / STAGE 4 STILL OPEN.** Push the candidate to `main`, pull/build it in Coze, prove the cancelled frame disappears and remains absent after a second reload, then run the exact-candidate PostgreSQL multi-instance suite.

## 2026-08-21 Stage 4 cloud acceptance closure

- GitHub `main@8490fc14ec313000da37475627b4a101c8ecb546` filters terminal task placeholders before Canvas hydration while retaining the unfiltered snapshot in the hydration guard, which schedules one cleanup save instead of suppressing it.
- The Coze business tree matched GitHub `main`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged.
- Authenticated Google Chrome exposed three stale tabs for the same project during the first investigation. Their concurrent autosave explained the rapid project-revision growth and the apparent resurrection. After every surviving preview loaded the current source and only one project tab remained, the authoritative server snapshot returned `target=null` twice, at revisions `5295` and `5305`, with seven retained images.
- Focused regression passed `52/52`; full non-PostgreSQL Vitest passed `463 files / 2862 tests`, with the `70` PostgreSQL-gated tests explicitly skipped in that run. The immediately preceding isolated PostgreSQL 18 candidate gate passed `2931/2931` with zero skips. TypeScript, ESLint (`0 errors / 988 historical warnings`) and production build (`114/114`) passed.
- **Verdict: STAGE 4 CLOUD ACCEPTANCE PASS.** The terminal placeholder is absent from durable project state and remains absent after subsequent revisions. V5.8.8 may now be frozen and analyzed strictly as a read-only donor; no Stage 4 business suite is repeated.

## 2026-08-21 V588-ADMIN-001 local regression

- RED tests reproduced fabricated zero-call provider health, fabricated `99%` model success, malformed configuration rows and missing nullable-rate UI handling.
- The narrow projection repair passed focused `4/4` and related administrator regression `8/8`.
- Full Vitest passed `465 files / 2866 tests`; `15 files / 70` PostgreSQL-only tests were explicitly skipped because `POSTGRES_TEST_DATABASE_URL` is absent. TypeScript passed, ESLint exited 0 with `0 errors / 988 historical warnings`, and production build completed `114/114` routes.
- The donor snapshot remained read-only and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` was not modified.
- **Verdict: LOCAL REGRESSION PASS / CLOUD PENDING.** Stage 4 is not being repeated; this is the first selective V5.8.8 absorption item.

## 2026-08-21 V588-ADMIN-001 cloud API regression

- The exact deployed candidate is `main@1ba98f776b0c19141a9f05343ce7bb23d0c50fb2`.
- Authenticated administrator API verification returned HTTP 200 with explicit unavailable coverage and no model/provider rows, proving the deployed backend no longer manufactures usage health.
- Browser installation, extension and native-host diagnostics passed, and the two pre-existing Chrome tabs were listed. Both tabs timed out when page control was requested, so no screenshot, visible empty-state assertion or Console capture was produced.
- The no-new-tab constraint is authoritative: subsequent acceptance must refresh and reuse the existing Coze project and preview tabs only. A disconnected sandbox is refreshed on the existing project page before a hard refresh of the existing preview page.
- **Verdict: CLOUD API PASS / CHROME UI UNVERIFIED.** Evidence: `docs/testing/evidence/v588-admin-001-cloud-api-2026-08-21.json`.

## 2026-08-21 V588-ADMIN-001 cloud UI closure

- Chrome control was reconnected without creating another tab. The existing Coze project page had no sandbox-disconnect dialog, and the existing preview page completed a hard refresh while preserving the administrator session.
- Visible UI contracts passed: one model empty state, one provider empty state, zero `99%` labels and no fabricated provider status rows.
- Fresh Console Error/Warning count after the hard refresh and dashboard navigation was zero.
- Screenshot evidence: `docs/testing/evidence/v588-admin-001-cloud-ui-2026-08-21.png`.
- **Verdict: V588-ADMIN-001 LOCAL + CLOUD PASS.** The item is absorbed and `V588-ADMIN-002` is now the next authorized RED test.

## 2026-08-21 V588-ADMIN-002 local regression

- RED reproduced one false negative in the donor authorization test: the current `assets/orphans` route has an explicit `getRequestUser + role` guard, but the donor contract did not recognize that reviewed pattern.
- The minimal integration is test-only. It freezes all 24 administrator routes, accepts only the shared guard and two explicitly reviewed manual guard contracts, and fails on route-set drift or an unguarded route.
- Representative runtime assertions now prove unauthenticated orphan scans return `401`, non-admin scans return `403`, and both paths avoid invoking the media-health service.
- Focused tests passed `6/6`; the administrator regression group passed `26/26`. Full Vitest passed `466 files / 2868 tests`, with `15 files / 70` PostgreSQL-only tests explicitly skipped. TypeScript, ESLint (`0 errors / 988 historical warnings`) and production build (`114/114`) passed.
- **Verdict: LOCAL REGRESSION PASS / CLOUD PENDING.** No production business code changed. Push the exact candidate to `main`, pull it into Coze and verify representative administrator and unauthenticated route behavior before closing the item.

## 2026-08-21 V588-ADMIN-002 cloud closure

- Coze pulled exact `main@d220479214a88b45fcd3a9520d220b864d19cb28`; its worktree was clean, port 5000 remained HTTP 200 without rebuild/restart, and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged.
- A credential-free request to `/api/admin/assets/orphans` returned HTTP `401` and `{"error":"Authentication required"}`.
- Authenticated Google Chrome reused the same two existing tabs. Refreshing the administrator operations dashboard retained visible real summary data and both expected empty-state projections. Fresh Console Error/Warning count was zero.
- Evidence: `docs/testing/evidence/v588-admin-002-cloud-api-2026-08-21.json` and `docs/testing/evidence/v588-admin-002-cloud-ui-2026-08-21.png`.
- **Verdict: V588-ADMIN-002 LOCAL + CLOUD PASS.** The repository-wide route contract is absorbed; `V588-ADMIN-003` is the next authorized RED item.

## 2026-08-21 V588-ADMIN-003 local regression

- Donor behavior was reproduced as an architecture mismatch before implementation: it depended on a raw uploads scan and process-local lock. The current-line RED suite instead required asset-graph discovery, durable leases, exact lease-owner settlement and administrator guards.
- The additive migration creates one 256/512 WebP variant per exact asset version. The worker uses current safe-image, Sharp pixel-limit, server-data-root and S3 boundaries; the S3 key mirrors the public media-gateway path so an instance restart can recover the same thumbnail.
- Canvas hydration projects only ready variants, prefers 512 over 256, preserves old thumbnails when none are ready and safely falls back during the narrow pre-migration deployment interval without hiding unrelated database failures.
- Focused thumbnail/admin/Canvas regression passed `57/57`. Related asset/media regression passed `245/245`; 27 PostgreSQL cases were explicitly skipped. Full non-PostgreSQL Vitest passed `2895/2895`, with `72` PostgreSQL-only tests explicitly skipped in that run.
- TypeScript passed; ESLint completed with `0 errors / 988 historical warnings`; production build completed `115/115` routes.
- A fresh isolated PostgreSQL 18.4 cluster supplied both repository database gates. The dedicated suite passed `2/2`, followed by the full repository at `487/487` files and `2967/2967` tests with zero failures and zero skips. It proves migration checksums, exact version/size uniqueness, concurrent claim exclusion, lease recovery and stale-worker rejection without regressing existing asset, task, billing, annotation, element-board or layer-decomposition concurrency. Evidence: `docs/testing/evidence/v588-admin-003-local-postgres-2026-08-21.json`.
- GitHub `main@d941384f3f7abb5c0b7a67d71686e4ebfee24da8` contains the candidate and `stable` remains unchanged. Coze first returned platform `instance_not_found`, then recovered on an older build where the route still returns the Next.js not-found page. No migration, backfill or Canvas behavior is inferred from either response. Evidence: `docs/testing/evidence/v588-admin-003-cloud-probe-2026-08-21.json`.
- Coze subsequently pulled `d941384`. Credential-free GET/POST returned `401`, proving the route and guards are live. Administrator login returned `200`, but authenticated GET, dry-run and GET returned `500`, proving the additive migration was absent; no real batch was run.
- Deployment TDD reproduced the missing build step in both Coze scripts. Both now execute checksum-managed migrations before `next build` when a database URL is configured, while the cold-start launcher remains unchanged. Focused deployment/migration/protection/route tests pass `21/21`; full non-PostgreSQL regression passes `2898/2898`; TypeScript, zero-error ESLint, shell syntax and build `115/115` pass.
- Coze pulled `main@172f38c5454b7fa5a708b61392c47d99e9f46461`. The migrated route returned administrator status `200`; dry-run discovered 10 candidates and kept all counts at zero. Two `limit=1` executions each completed one candidate, ending at `ready=2`, `pending=0`, `processing=0`, `failed=0`. This closes the migration-delivery defect and proves bounded cloud execution.
- Project synchronization was read twice with stable revision `5354`, `6` projects and `48` images. Both responses reported `assetGraphMode=legacy` and `canvasKernelMode=legacy`, so zero `thumbnailUrl` projections are expected; variant projection is intentionally active only in `asset-v3`.
- The existing Chrome project/preview tabs were discovered, but two claim attempts timed out. No new tab or another browser was used. Screenshot, Console, controlled `asset-v3` projection, media reload/original fallback and S3 recovery remain unverified.
- **Verdict: BACKFILL CLOUD PASS / ADMIN-003 PARTIAL.** Do not start `V588-PROVIDER-001` until the controlled projection and recovery evidence closes.

## 2026-08-21 V588-ADMIN-003 shadow reconciliation cloud regression

- Coze built and started exact `main@99d226a4fa9a1ffe7425e241963f110ec8609055`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged and the runtime stayed in `WUJIE_ASSET_GRAPH_MODE=shadow`.
- The fresh administrator readiness request returned HTTP 200 (`requestId=6a330ba2-48bf-9529-af7d-16257ea64248`). All six legacy projects match all six graph projects; mismatch, unmigrated, orphan and checkpoint-error counters are zero.
- Authenticated Google Chrome preserved six projects and 48 images. A settled reload produced zero fresh Console errors and zero warnings. No manual `/api/user-data/sync` mutation was used to manufacture parity.
- The two historical missing media/placement records remain explicit. Therefore `releaseReady=false`, `switchAuthorized=false` and `asset-v3` promotion stays blocked; the current shadow-mode acceptance is not being misreported as full media readiness.
- Evidence: `docs/testing/evidence/stage4-asset-shadow-reconciliation-cloud-2026-08-21.json` and `docs/testing/evidence/stage4-asset-shadow-reconciliation-cloud-2026-08-21.jpg`.
- **Verdict: SHADOW RECONCILIATION PASS / ASSET-V3 PROJECTION STILL CONDITIONAL.** The prior `shadow-projection-drift` blocker is closed. The next unique verification concerns the two missing historical media records, not a repeat of the completed Stage 4 browser matrix.

## 2026-08-21 V588-BUG-005 local durability-gate regression

- RED first proved that a current AssetVersion could be counted as release-safe while its only media locator was an expired `/v1/images/proxy/...` path with no durable storage or recovery source.
- The minimal change adds two read-only PostgreSQL aggregates for false-ready current versions and active placements. It adds blocker `non-durable-ready-media` and exposes aggregate counts only; it does not fetch remote media or reveal record details.
- A temporary local PostgreSQL false-ready record made `npm run doctor` emit `asset-media WARN` with `falseReadyCurrent=1`; cleanup ran in `finally` and left no test residue.
- Focused unit and PostgreSQL regression passed. The final full run passed `489/489` files and `2992/2992` tests with zero failures and zero skips. `pnpm validate`, TypeScript, zero-error ESLint, production build `115/115`, and `git diff --check` passed.
- `pnpm check:protected-baseline` remains blocked by 16 source-drift entries accumulated since the older protected baseline. All 38 protected feature IDs, component paths, evidence contracts and refs are present. The allowlist was not weakened to manufacture a pass.
- Coze then pulled exact `main@e809f5c105d6e42d584a38ae217d7791c7864759`, retained `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` and `shadow`, reported a clean worktree, passed production build and served port 5000/public root with HTTP 200.
- Authenticated Google Chrome returned readiness HTTP 200 with `falseReadyCurrentVersions=1`, `falseReadyActivePlacements=2` and blocker `non-durable-ready-media`. The placement count is correctly independent: the one false-ready current version is referenced by two active Canvas placements.
- The deployment retained `6` projects, `48` Canvas images, migration `6/6` and shadow parity `6/6`. A clean reload after deployment produced zero fresh Console errors and zero fresh warnings.
- **Verdict: LOCAL + EXACT-SHA COZE GOOGLE CHROME PASS.** Detection is closed; historical media remediation remains deliberately open, so `asset-v3` stays blocked.

## 2026-08-22 Task 6 historical-media safe-archive local gates

- Production source remains `86b8e176b2dcb88e3bf4d43ae19c64dc05dc9f54`; test-contract correction `aca74ea33bbaa92eac2566edf502e46656dfcd74` changes no production code. Final evidence used migrated PostgreSQL 18.4 at loopback-only `127.0.0.1:55436/wujie_safe_archive_task6_0822`, with all four repository PostgreSQL URL variables populated.
- The old Task 4 concurrency assertion was preserved as RED evidence, then aligned with the approved Task 5 restore guard. Archive succeeds first; overlapping restore rejects exact `ASSET_MEDIA_UNRECOVERABLE`; Asset/placements/snapshot/revision/ledger/audit prove no partial restore.
- Focused exact command passed `7 files / 97 tests`; affected exact command passed `9 files / 77 tests`. Full `pnpm test` passed `492/492` files and `3066/3066` tests with zero failures and zero skips.
- `pnpm validate` passed (TypeScript plus quiet ESLint); `pnpm lint` passed with `0 errors / 988 warnings`; `pnpm build` passed with `116/116` static pages and includes `/api/admin/assets/remediation`; `git diff --check` passed.
- `pnpm check:protected-baseline` failed with `23` unapproved source-drift blockers, while its `38` feature IDs, protected component paths, evidence contracts, and refs all passed. The allowlist was not changed.
- Functional local evidence passes. The protected-baseline governance gate remains blocked by 23 accumulated source paths even though all `38/38` protected identities and contracts are present; no allowlist was changed. Cloud archive, idempotent retry, and `asset-v3` acceptance remain **UNVERIFIED**. Evidence: `docs/testing/evidence/v588-admin-003-safe-archive-local-2026-08-21.json`.

## 2026-08-22 protected-baseline authorization regression

- The approved change authorizes only the 23 independently traced files. No directory-wide `migrations/`, `scripts/`, `src/app/api/admin/`, `src/app/api/assets/`, `src/components/dashboard/`, `src/lib/`, or `src/lib/asset-core/` grant was added.
- TDD RED first failed on the missing provenance manifest. A second RED proved three proposed source mappings did not touch their declared files; those mappings were corrected from repository history.
- Commit `34391fbda9ee2dfe7c32c103c1418d0b59361dcb` adds the exact command grants, the 23-entry machine-readable provenance manifest, and a permanent Git-history regression test.
- Focused test passes `7/7`; the fresh full PostgreSQL-enabled run passes `492/492` files and `3067/3067` tests with zero failures and zero skips. Validate, full lint (`0` errors / `988` warnings), build (`116/116`), protected baseline and whitespace checks pass.
- This closes only the local governance blocker. Cloud archive, cloud idempotent retry and `asset-v3` acceptance remain **UNVERIFIED** and require the planned exact-SHA cloud sequence.

## 2026-08-22 S4-BUG-014 历史媒体覆盖本地闭环

- 真实 PostgreSQL RED 证明活动 placement 引用非当前坏版本时，旧候选发现会漏报发布 blocker；修复后当前与非当前坏版本均进入稳定候选集。
- 归档覆盖门禁采用 PostgreSQL advisory 读写锁：归档独占等待上限为 5 秒，普通业务写入使用共享门禁并等待归档结束，不用通用 500 牺牲正常写入。
- 并发同 key 复用同一 remediation；同 key 不同请求返回冲突；Canvas 快照或审计失败会回滚 Asset、版本、placement、revision、ledger 和 audit。
- 精确授权测试从 25 次串行 Git 子进程改为一次批量来源查询，保持逐路径来源断言；执行时间由 13.6 秒降至 0.4 秒，没有增加测试超时。
- 受影响矩阵通过 `6` 个文件、`108/108`；带隔离 PostgreSQL 的全仓通过 `492/492` 个文件、`3090/3090` 项测试，0 failure、0 skip。
- TypeScript 通过；ESLint 为 `0 error / 988` 条历史 warning；生产构建完成 `116/116`；保护基线确认 38 个功能完整、25 条精确授权、0 blocker；`git diff --check` 通过。
- **结论：本地回归通过。** 尚未推送 `main`，未执行云端归档，未切换 `asset-v3`。机器证据：`docs/testing/evidence/s4-bug-014-local-postgres-2026-08-22.json`。

## 2026-08-22 S4-BUG-014 云端只读闭环

- Coze 项目页证明 `HEAD/origin/main=04a7a9104a96ae74325a76776e831c0e567e362b`、`origin/stable=52f7c601ed150769e15d06fb435c6e360e28c9e7`、构建成功、5000 端口 HTTP 200，资产模式保持 `shadow`。
- Google Chrome 管理员会话连续两轮读取 auth、remediation 和 production readiness；两轮候选 ID、摘要、placement ID、数量与 readiness 子集逐字段完全一致。
- remediation 为 `4 versions / 4 active placements / 3 current / 1 non-current`，覆盖为 `4/4`、`complete=true`、`uncovered=0`。这直接证明 S4-BUG-014 的非当前坏版本覆盖缺口已在云端关闭。
- readiness 仍保留 `releaseReady=false`、`switchAuthorized=false`、两个媒体 blocker、迁移 `6/6` 和影子项目 `6/6`；修复没有削弱 doctor 或偷偷启用 `asset-v3`。
- 新鲜 Console Error/Warning 为 `0/0`。机器证据：`docs/testing/evidence/s4-bug-014-cloud-readonly-2026-08-22.json`，截图同名 `.png`。
- **结论：Task 7 云端只读验收通过。** 未执行归档 POST；Task 8 仍需管理员针对这 4 个精确候选进行操作时确认。

## 2026-08-22 S4-BUG-014 云端软归档闭环

- 操作前重新确认的候选集与 Task 7 完全一致：`4 versions / 4 active placements / 3 current / 1 non-current`，覆盖 `4/4` 且无未覆盖 blocker。
- Coze 进程最初继承了缺少 `-5000` 的 `COZE_PROJECT_DOMAIN_DEFAULT`，安全路由按设计两次返回 `403 ADMINISTRATOR_ORIGIN_INVALID`，数据库无写入。修正当前进程的精确预览 origin 后，管理员会话恢复为合法同源写入。
- 首次归档请求返回 HTTP 200，requestId `12314534-c08e-90b8-ae25-5d3a59de9f0f`，remediationId `remediation_d0af6963-97ed-4ebf-9da3-a5d63dbcf603`，归档 4 个版本与 4 个 placement。
- 使用相同请求体和幂等键 `4fafacab-7aaa-45e0-a34e-1f1637fec300` 重放，requestId `c473242a-f3c9-95f7-85ee-cc315cc36c53`，返回相同 remediationId、`reused=true`，项目 revision 保持 `5718`。
- PostgreSQL 只读核验确认 ledger `1`、audit `1`、软删除 placement `4`、不可恢复版本 `4`、版本行保留 `4`；同一时间窗积分与退款事件均为 `0`。未调用供应商、未物理删除媒体。
- 归档后连续两轮 remediation 均为 `0 candidates / 0 active placements`；readiness 均为 `releaseReady=true`、`switchAuthorized=true`、blockers `[]`，迁移 `6/6`、shadow 对账 `6/6`。运行模式仍为 `shadow`，本任务没有执行模式切换。
- **结论：S4-BUG-014 云端软归档与幂等回归通过。** 证据：`docs/testing/evidence/s4-bug-014-cloud-archive-2026-08-22.json` 和 `.png`。`asset-v3` 投影、刷新恢复、原图回退与 S3 恢复仍是独立验收项。

## 2026-08-22 V588-UI-001 首个叶组件本地回归

- RED 先复现底部缩放与辅助控制仍全部内联在 `InfiniteCanvas`，且不存在受当前控制器约束的独立展示叶子。
- 最小实现仅提取 `CanvasZoomCluster`。缩放上下限、重置视图、网格轮换、连线开关、图层/历史互斥、工具会话和 AI 引擎弹窗仍由父组件回调控制。
- 聚焦回归通过 `7 files / 64 tests`；全仓通过 `475 files / 2988 tests`，`18 files / 105` 个 PostgreSQL 环境测试明确跳过。本项未触及持久化、任务、账务或供应商代码。
- TypeScript 通过；ESLint `0 errors / 988 warnings`；生产构建 `116/116`；保护基线保留 `38/38` 功能且 0 blocker；`git diff --check` 通过。
- GitHub 已依次接收治理前置 `cf65a65` 和实现 `c808e50`，`stable@52f7c60` 未变化。
- **结论：本地回归通过，云端待验。** Coze 必须拉取包含来源记录的最终提交，并在已登录 Google Chrome 中逐项验证缩小、放大、重置、网格、连线、图层、历史和 AI 引擎，确认图层/历史互斥及新鲜 Console Error/Warning 为 0。

## 2026-08-22 V588-UI-001 云端回归闭环

- Coze 本地环境提交 `0e16ea0` 的父提交和代码树均精确对应 `origin/main@986f128006c246b400f116da7fb3a5b4c02f0a6c`；工作区干净，生产构建退出码为 0，5000 端口根路径 HTTP 200。`stable@52f7c601` 保持不变。
- Google Chrome“用户1”在第一方预览页成功保持管理员会话并打开包含真实图片的项目。内嵌 iframe 登录不持久化被归类为 Coze 第三方 Cookie 上下文限制，不是无界账号或登录代码回归。
- 缩放真实变化为 `90% -> 75% -> 90%`；独立重置验证为 `69% -> 90%`。网格完整循环 `点阵 -> 线条 -> 空白 -> 点阵`，连线完成 `显示 -> 隐藏 -> 显示`。
- 图层打开后版本历史保持关闭；打开版本历史会关闭图层；重新打开图层会关闭版本历史。两个面板都能回到关闭状态。AI 引擎设置显示“放大引擎选择”，并能通过关闭按钮退出。
- 最终回归时间截点 `2026-08-22T04:31:52.874Z` 后的新鲜 Console Error/Warning 为 `0`，无浏览器原生弹窗。视觉截图确认工具栏未被右侧面板遮挡，也没有错位、裁切或叠加。
- **结论：V588-UI-001 云端回归通过。** 证据：`docs/testing/evidence/v588-ui-001-cloud-2026-08-22.json` 和 `.png`。

## 2026-08-22 V588-UI-002 命令面板本地回归

- 按 TDD 先得到预期 RED：组件、工具簇入口、父画布接线和输入焦点保护缺失；最小 GREEN 后，聚焦套件为 `3 files / 18 tests` 全部通过。
- 新组件只负责过滤、焦点、键盘/鼠标交互和渲染；画布状态、视图动作、选择、工具会话及图层/历史互斥仍归当前 `InfiniteCanvas`。
- 全仓 Vitest 通过 `477 files / 3004 tests`；`18 files / 105 tests` 因 `POSTGRES_TEST_DATABASE_URL` 未配置而明确跳过。本项不改变持久化或账务，因此不以跳过结果冒充 PostgreSQL 通过。
- TypeScript 通过；ESLint 退出 0，保持 `0 errors / 988 historical warnings`；生产构建完成 `116/116`；保护基线保留 `38/38` 功能且 0 blocker；`git diff --check` 通过。
- 精确源码来源为 `8acb3c9`；`CanvasCommandPalette.tsx` 已加入逐文件授权和来源校验，不存在目录级放行。`stable@52f7c601` 与 donor 未变化。
- **结论：本地回归通过，云端未验证。** Coze 必须拉取最终 `main`，并在现有 Google Chrome 标签页验证入口、快捷键、搜索、导航、执行、关闭、输入保护、命令动作、图层/历史互斥和新鲜 Console。

## 2026-08-22 V588-UI-002 云端缺陷修复与全量复验

- Coze 首轮真实测试复现命令面板“打开图层面板”和“打开版本历史”关闭弹层但不打开目标面板，Console 出现 `CANVAS_TOOL_ENTRY_POINT_UNSUPPORTED:*:shortcut`；根因是两个工具未在注册表声明 `shortcut` 入口。
- 新增注册表失败测试后，仅补充两个入口声明。RED 精确失败于 `layer-order:shortcut`；GREEN 聚焦套件通过 `4 files / 26 tests`。
- 修复后全仓 Vitest 通过 `477 files / 3005 tests`；`18 files / 105 tests` 因本机缺少 `POSTGRES_TEST_DATABASE_URL` 明确跳过。本项不触及持久化或账务。
- TypeScript、ESLint、生产构建 `116/116`、保护基线 `38/38` 和 `git diff --check` 均通过。候选已推送为 `main@1681b2b80a5afdbb23c710616a3b9cd99fd47e71`，`stable@52f7c601` 未变。
- Coze exact-SHA 构建退出码 `0`，5000 端口监听，首页 HTTP `200`；Google Chrome 最终 SHA 交互矩阵 `30/30` 通过，图层/历史互斥正确，最终状态已恢复。
- 测试时间截点后的 Console Error/Warning 与 `[CanvasToolSession]` 错误均为 `0`。证据：`docs/testing/evidence/v588-ui-002-cloud-2026-08-22.json` 和 `.png`。
- **结论：V588-UI-002 云端回归通过并完成吸收。** 下一项为 `V588-UI-003`，不得重复本项或跳过 RED。

## 2026-08-22 V588-UI-003 小地图云端回归

- Task 1 的 RED 证明当前代码缺少 `CanvasMinimap` 模块、父画布接线和工具簇入口，并同时执行精确 TypeScript 门禁；独立审查为 `0/0/0`。
- Task 2 叶组件最终 `14` 个测试与 `pnpm ts-check` 通过；极端有限坐标和 `x + width` 溢出均固定为永久回归，独立审查为 `0/0/0`。Task 3 聚焦回归为 `6` 个文件、`27` 个测试通过，独立审查为 `0/0/0`。
- 全仓 TypeScript 通过；ESLint 为 `0 errors / 988` 条历史 warning，本项新增 warning 为 `0`。全仓 Vitest 为 `499` 个文件（`481` 通过、`18` 跳过）和 `3143` 个测试（`3038` 通过、`105` 跳过）；跳过项仅为未配置 `POSTGRES_TEST_DATABASE_URL` 的既有真实 PostgreSQL 集成/并发门禁，不计为通过。
- Next.js `16.2.11` 生产构建生成 `116/116` 页面并以退出码 `0` 完成；干净 HEAD 保护基线为 `38/38`，未授权源码漂移 `0`、warning `0`；`git diff --check` 通过。
- 云端验收提交为 `efe5e4f16ac3c8a0c7ed6b8fc73cba48af6fd6b2`；Coze、`origin/main` 与本地提交精确一致，构建退出码 `0`、首页和鉴权健康接口 HTTP `200`。`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`、donor 均未变。
- 仅复用 Google Chrome「用户1」的现有标签页完成 26/26 项矩阵：默认关闭、工具按钮、命令、关闭按钮、偏好恢复、两组响应式阈值、主题、面板避让、空态、100/300 节点、真实拖动和导航保持 `46%` zoom 均通过。最终健康窗口 Console error/warning、`[CanvasToolSession]` 错误与原生弹窗均为 `0`，网络全部 `200`；两个 30 秒空闲窗口没有画布/项目同步 POST。
- **结论：V588-UI-003 已吸收，云端验证通过。** 机器证据为 `docs/testing/evidence/v588-ui-003-cloud-2026-08-22.json`。PostgreSQL 集成门禁仍因缺少 `POSTGRES_TEST_DATABASE_URL` 单独列为未验证；下一唯一项为 `V588-UI-004`。

## 2026-08-23 V588-UI-004 本地回归

- 六个展示叶及父级接线完成，抽取后的三个源码合同改为读取真实所有者；本次修复不改变运行时业务逻辑。
- UI004 聚焦矩阵通过 `13 files / 65 tests`，所有权修复回归通过 `3 files / 14 tests`；独立复审为 `Critical/Important/Minor = 0/0/0`。
- 全仓 Vitest 共 `507` 个文件、`3180` 项测试：`489` 个文件、`3075` 项通过；`18` 个文件、`105` 项因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过。
- TypeScript 通过；ESLint `0 errors / 987` 条历史 warning；Next.js `16.2.11` 生产构建通过；保护基线 `38/38` 且 0 warning；`git diff --check` 通过。
- Chromium 生产 E2E 已定义 375x812、768x900、1440x900、底部抽屉、图片工具栏、8 个编辑入口和 reduced-motion；独立审查后补齐 768px 编辑面板循环。
- 本地没有 E2E 凭据与 PostgreSQL，实际命令结果为 `2 skipped`，没有执行登录后的布局动作，也没有生成可当作通过依据的浏览器证据。该矩阵必须在 Coze exact SHA 的现有 Google Chrome 标签页执行。
- **结论：功能、独立审查与 `main` 推送通过 / 发布仍有条件。** Coze exact SHA 和 Google Chrome 云端矩阵完成前，V588-UI-004 不标记为已吸收。
- GitHub 已普通快进到实现候选 `be96c59d2d4dec6bbe510c3b7fd0de59ef092e0b`，`stable` 未变。Google Chrome 正确列出 Coze 项目页和云端预览页，但接管两个现有标签均超时；未使用 360、未新建标签，故 Coze exact SHA 与云端矩阵仍保持未验证。

## 2026-08-23 V588-UI-004 云端首轮与远程图片 CORS 修复

- Coze 已精确运行 `main@362d350ecbb552f27ad51be0782f228f49fd2391`，生产构建和 HTTP 健康通过；已登录 Google Chrome 在真实五图项目完成 UI004 首轮矩阵。
- 1440x900 底部抽屉和 375x812 图片紧凑工具栏可用；放大、SVG、去背景配置、扩展和裁切面板可打开。擦除、蒙版明确显示源图加载失败，调色预览自然尺寸为 `0x0`。
- 同一 Pear CDN 图片在画布中自然尺寸为 `1536x1024`、`crossOrigin=null`；三个失败入口使用 `crossOrigin=anonymous`。Asset API 返回相同远程 URL，根因确认是上游无 CORS Header，不是图片不存在、选择错图或模型不可用。
- TDD 新增鉴权同源图片读取端点，复用现有 SSRF 安全下载器；只改变擦除/蒙版与调色预览的展示源，不改变任务、供应商和账务。候选已推送为 `main@3becee8b54d9cc6320b137c4070e129cbed06ffe`，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变。
- 本地最终门禁：聚焦 `50/50`、源图合同 `19/19`、全仓 `491 files / 3086 tests` 通过；`105` 个 PostgreSQL 专项因缺少隔离库跳过；TypeScript、零错误 ESLint、生产构建 `116` 路由和空白检查通过。
- **结论：修复前云端问题与根因已确认，修复候选本地回归通过；修复后云端仍未验证。** Google Chrome 主实例当前可发现但无法交互，360 实例已识别并排除。证据：`docs/testing/evidence/v588-ui-004-remote-image-cors-2026-08-23.json`。

## 2026-08-23 V588-UI-004 云端最终回归

- Coze 已精确运行 `main@8c936cac777f5b05cfb381c73e929c13a5341efd`，`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变；干净生产构建确认 `/api/image/source` 进入路由清单，5000 端口 PID `1774`，根路由 HTTP 200，未登录图片代理正确返回 401 JSON。
- 同一 Pear CDN 真实图片在擦除与蒙版面板均加载为 `1536x1024`，真实笔迹可将提交按钮从禁用切换为可用。
- 首次代理修复后又稳定复现调色预览渲染框只有 `1x0.66px`；根因是 `NextImage width={1} height={1}` 与 `max-w/max-h` 的组合不会放大布局框。RED 用例先失败，然后仅改为相对预览容器内 `NextImage fill`。
- 最终云端调色预览自然尺寸 `1536x1024`，渲染尺寸 `291x162.8125`；亮度滑杆从 0 调到 2 后计算样式立即变为 `brightness(1.01)`。新鲜 Console error/warning 为 0，JavaScript dialog 为 0。
- 本地最终门禁：相关 `14/14`，TypeScript 通过，ESLint 零错误，全仓 `491 files / 3087 tests` 通过，`105` 项 PostgreSQL 专项因无隔离库跳过，生产构建 `116` 页面/路由通过。
- **结论：V588-UI-004 远程图片编辑与调色预览已在云端关闭，可标记为已吸收。** PostgreSQL 隔离库门禁仍是独立未验证项，不因本结论改成通过。

## 2026-08-23 V588-SAFETY-001 WASM SVG 像素预算回归

- RED 首先证明同步 WASM 路径没有独立像素预算；最小实现只在 `runWasmVTracer()` 的 raw RGBA 解码前调用纯函数，通用 3072/4096 预处理上限和其他矢量引擎保持不变。
- 本地聚焦回归 `14/14`；全仓 `492` 个文件、`3099` 项测试通过，`105` 项 PostgreSQL 专项因未配置 `POSTGRES_TEST_DATABASE_URL` 跳过且不计通过。TypeScript、ESLint 零错误、生产构建 `116/116`、保护基线和空白检查通过。
- Coze 工作区、`origin/main` 与 exact `d968ad3448c9a3202f462959baaa89dab5f471cd` 一致，干净生产构建退出码 `0`；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- Google Chrome 仅复用现有标签页，对真实 `1536x1024` Pear 图片明确选择 `WASM / 快速 / 全彩矢量化`。服务端日志确认同步输入缩至 `627x418`，面积 `262086 <= 262144`，约 `10.245s` 完成并生成可选择的 `1536x1024` 结果节点。
- 同期每 500ms 的首页健康探针共 `80` 次，全部 HTTP 200，平均 `6.002ms`、P95 `8.163ms`、最大 `13.152ms`；浏览器 Console error/warning 与原生 dialog 均为 0。
- SVG 下载弹层可选择 SVG 并确认。自动化的 download 事件监听超时，但本地实际文件为 `4726` 字节，SHA-256 为 `B9AE35800CADD344850D13ADB890517C7312B8FB4BB3C9073D17785A132B8B95`，逻辑尺寸 `1536x1024`、内部 `viewBox=0 0 627 418`。
- **结论：V588-SAFETY-001 云端回归通过并完成吸收。** 本结论只覆盖同步 WASM 大图预算；Python VTracer、其他矢量引擎和 PostgreSQL 专项不随本项自动通过。下一唯一项为 `V588-AUTH-001`。

## 2026-08-23 V588-AUTH-001 本地回归

- TDD 先复现认证密钥读取失败与缺失值混淆、跨进程副本覆盖、`simple-chat` 假注销及退出同步无限等待；实现提交 `b0cd946f` 只修改认证持久化、退出边界、SSE 卸载和默认媒体依赖。
- 真实 PostgreSQL 聚焦通过 `7 files / 63 tests`，包含 `8` 项实际数据库集成/并发用例，覆盖事务锁竞争、新数据目录副本、旧文件迁移、`ON CONFLICT DO NOTHING` 胜者保持及密钥环并发。
- 全仓 Vitest 通过 `503 files / 3286 tests`，明确跳过 `19 files / 113 tests`；API 回归 `123 files / 701 tests`，另有 `2 files / 3 tests` 跳过；业务回归 `350 files / 2336 tests`，另有 `2 files / 8 tests` 跳过。所有已执行测试失败数均为 0。
- `pnpm doctor`、`pnpm ts-check`、`pnpm lint:build` 和 `pnpm build` 均通过；Next.js `16.2.11` 完成 `116/116` 页面生成。目标 ESLint 为 `0 errors`，保留 `9` 条既有 warning。
- 最终生产构建浏览器矩阵 `10/10` 通过，覆盖 Chromium、Firefox、WebKit、1080p 和移动端下管理员/普通用户的错误密码、正确登录、刷新保持、画布/仪表盘/独立聊天导航、注销及注销后数据隔离。
- 两轮独立复审最终均为 `Critical/Important/Minor = 0/0/0`。首轮浏览器 503 来自测试夹具错误继承 `FILE_ONLY`，改用规定的 `DB_PLUS_FILE` 环境后同一代码通过，没有用业务代码绕过配置错误。
- **结论：V588-AUTH-001 本地回归通过。** Coze 尚未拉取精确提交并重复云端会话矩阵，因此不能标记为云端通过；付费生成、取消和退款链路也不在本项验收范围。

## 2026-08-24 V588-AUTH-001 历史密钥环云端闭环

- Coze 旧候选真实复现：登录成功并设置 Cookie 后，冷启动只读 `/api/session` 返回 503 `AUTH_CONFIGURATION_UNAVAILABLE`，项目同步返回 500；Cookie 已发送，故不是密码、浏览器 Cookie 或登录按钮问题。
- RED 先锁定 JSONB 中“一层历史 JSON 字符串”兼容边界，并证明双重编码与畸形输入仍必须拒绝。真实 PostgreSQL 回归确认数据库驱动返回一层字符串。
- `main@42e540bd5aa552f10af0e12240546993bda3e91a` 只在持久化读取边界解一层 JSON，随后继续严格校验；没有修改登录宽松度、账号、Cookie、数据库内容、环境变量或 `stable`。
- 本地新鲜门禁：认证 `141/141`、真实 PostgreSQL `10/10`、全仓 `503` 文件/`3293` 项通过、doctor、TypeScript、Lint 与 `116` 路由生产构建均退出 0；默认全仓中的 `19` 文件/`115` 项非认证 PostgreSQL 门禁保持明确跳过。
- Coze 精确拉取并生产重启后，Google Chrome 冷刷新仍进入管理员工作台；`/api/session`、`/api/admin/users`、项目读取与项目同步均 HTTP 200 且业务成功，Console error/warning 为 `0/0`。
- **结论：V588-AUTH-001 的同 secret 部署、历史密钥环兼容和冷启动会话保持通过。** 真实云端 secret 轮换未执行，不扩大为完全发布通过。证据：`docs/testing/evidence/v588-auth-001-coze-2026-08-24.json`。

## 2026-08-24 GPT Image 2 原生透明 PNG 本地回归

- 基线为 `origin/main@6102572bc6ff90e20ef522c79bc5c0b846f7cde7`，在隔离分支 `feat/native-transparent-generation` 实施，未修改 `stable`。
- 所有主要生图入口已使用统一背景输出合同：主图像生成面板、快速创作、参考图组、融图组、图生图、场景、贴纸、全景、六面体、工作流图像节点、聊天与 Agent。透明模式固定输出 PNG，不支持透明输出的模型会在扣费和供应商提交前返回明确错误，不静默换模型或自动发起第二次去背景任务。
- 完成结果会逐张解码检查真实 Alpha 通道；棋盘格背景不会被视为透明。供应商返回不透明图片时保留原图，并给出“用户确认后另行去背景、单独计费”的下一步提示。
- 新增和相关聚焦回归均通过；全仓 Vitest 为 `532` 个文件，其中 `513` 个通过、`19` 个跳过；共 `3451` 项测试，其中 `3337` 项通过、`114` 项跳过，失败数为 0。跳过项均保持为隔离 PostgreSQL 环境门禁，不计为通过。
- `pnpm ts-check` 通过；`pnpm lint` 退出码为 0，结果为 `0 errors / 991 historical warnings`；Next.js `16.2.11` 生产构建成功并生成完整路由表；`git diff --check` 通过。
- 构建阶段复现字境生成路由非法导出 `getFontDesignResult`。根因是 Next.js Route Handler 不允许导出辅助函数；任务缓存已最小迁移到 `src/lib/font-design-task-store.ts`，轮询回归 `2/2` 和生产构建均通过，字境任务行为未改变。
- Playwright 真实付费用例已建立，并确认可被 Chromium、Chromium 1080p、Firefox、WebKit、移动 Chromium 五个项目发现。由于本地未配置真实登录凭据、精确 `providerId::gpt-image-2` 和付费开关，本轮没有调用真实供应商，也没有生成可作为云端 Alpha 验收的截图、下载文件或任务证据。
- **结论：代码与本地回归通过，发布判定为有条件通过。** 关闭条件是部署精确候选后，使用真实 GPT Image 2 完成透明请求、任务终态、画布结果、下载文件 Alpha 字节与单次扣费验证。

## 2026-08-24 V588-PROVIDER-005 Task 11 本地回归

- 统一能力目录已覆盖精确 `providerId + modelId`、管理员结构化编辑、图像/参考图组/融图组/节点/视频消费端，以及图像和视频的扣费前准入。
- 配置持久化 RED 稳定复现“更新 A 会写回 B”的陈旧快照问题；最小修复后能力单测 `7/7`。
- 随后用 PostgreSQL 18 一次性隔离集群执行真实往返。首轮先发现测试缺少 `server-only` 装配；修正后第二轮发现生产代码把 JSON 数组写入 `TEXT[]`，返回 PostgreSQL `22P02`。仅改为由 `pg` 直接编码字符串数组后，同一真实并发测试 `1/1` 通过；临时数据库服务已停止。
- Task 10 架构拆分后，全量首次暴露 4 个旧测试契约：3 个仍把下游图像能力要求在 Agent 编排聊天模型上，1 个仍按裸模型名推断批注能力。修正测试夹具与源码合同后聚焦 `47/47`，未放宽生产授权。
- `pnpm doctor`、`pnpm ts-check`、`pnpm lint` 均退出 0；ESLint 为 `0 error / 970` 条历史 warning。
- `pnpm test`：`516` 文件通过、`3372` 项通过；`20` 文件、`116` 项跳过。
- `pnpm test:api`：`125` 文件通过、`716` 项通过；`2` 文件、`3` 项 PostgreSQL 并发测试跳过。
- `pnpm test:regression`：`361` 文件通过、`2407` 项通过；`3` 文件、`9` 项 PostgreSQL 测试跳过。
- 生产构建生成 `116/116` 页面与路由；保护基线先阻断 41 条累计认证/能力源码漂移，逐文件核对来源提交后合同 `7/7`、保护门禁 `38/38` 且 0 warning/0 blocker；没有目录级授权。
- Playwright 能识别 15 个三浏览器用例；启动本地服务后执行 Chromium/Firefox/WebKit，因缺少真实登录凭据共 9 项明确跳过。付费测试还要求 `E2E_ENABLE_PAID_GENERATION`，未以 Mock 冒充真实成功。
 - **结论：本地静态、自动化与本项 PostgreSQL 候选通过，但 V588-PROVIDER-005 发布验收仍不通过。** 阻塞项是三浏览器真实账号五入口、真实同名模型跨供应商、付费图像/视频、非法请求零扣费和 Coze exact-SHA 证据。

## 2026-08-24 原生透明 PNG 与 V588-PROVIDER-005 联合集成回归

- `feat/native-transparent-generation` 已进入 `main@36a986fcb74b2d16313a349600a4022c71b482e0`；`V588-PROVIDER-005` 在该基线上重新集成为候选 `93253e6f981a2c6cc4403c9c5615e7044c7db62e`，没有用旧候选覆盖透明输出链路。
- 联合专项覆盖服务端透明输出规范化、逐图 Alpha 校验、能力准入、管理员能力编辑和五类消费端，结果为 `126 passed / 1 PostgreSQL-gated skipped / 0 failed`。
- 全仓 Vitest 为 `3419 passed / 116 PostgreSQL-gated skipped / 0 failed`；TypeScript、Doctor、ESLint `0 errors / 970 historical warnings`、Next.js `116/116` 构建、保护基线 `38/38` 和 `git diff --check` 通过。
- PostgreSQL 跳过项未计为通过；真实 GPT Image 2、真实视频、积分与供应商任务均未在本地伪造。
- **结论：本地代码集成与自动化回归通过，云端验收未完成。** 只有 Coze exact-SHA、真实 Alpha 文件、五入口能力一致性、真实付费任务及零副作用拒绝均取得证据后，才能把专项改为通过。

## 2026-08-24 最终候选 Coze 构建与运行验收

- GitHub、本地和 Coze 的 `main` 已精确对齐 `0adbd5ee5b8e32e3987ddf0ccb9f09dd816f5f4d`。Coze 原有 `87a13761` 是无文件差异的同步空提交，已先保留为 `coze-backup-87a13761`，再在干净工作区将 `main` 对齐 `origin/main`；没有覆盖业务修改。
- `origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`，未切换、合并、重置或推送。V5.8.8 donor 保持只读。
- Coze 使用 `WUJIE_ASSET_GRAPH_MODE=shadow pnpm build` 完成 Next.js `16.2.11` 生产构建，退出码为 `0`。旧 PID `1614` 正常退出后，以 `WUJIE_ASSET_GRAPH_MODE=shadow pnpm exec next start -p 5000 -H 0.0.0.0` 启动；监听进程 PID 为 `2547`。
- 环回健康检查：`/` 为 HTTP `200`，`/api/auth/me` 为 HTTP `200` 且返回匿名会话；HTML 实际引用的 `10` 个 JavaScript 与 `1` 个 CSS 静态资源全部为 HTTP `200`。
- 现有 Google Chrome 项目页的内嵌预览已刷新到最新服务，并可进入无限画布登录页。随后扩展重新绑定两个现有标签时持续超时；没有新建标签、没有切换到 360，也没有用非浏览器结果冒充真实 UI 通过。
- **结论：Coze exact-SHA、构建、启动、HTTP 与静态资源通过；Stage 4 业务验收仍未完成。** 管理员能力持久化、普通用户五入口、真实 GPT Image 2 Alpha、透明多图逐张回填、真实图像/视频、单次扣费及非法请求零副作用仍须在同一现有 Google Chrome 预览标签闭环。

## 2026-08-24 原生透明 PNG 最终候选本地门禁与云端阻塞复核

- 原生透明 PNG 功能分支已进入并推送 `main@4711501bdeb059a16d404184ef38c0956a57fb06`；本地与 `origin/main` 精确一致，`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- 新增真实付费 E2E 合同覆盖 `n=2` 两个独立任务、第二槽延迟时第一张先进入画布、两张 PNG 分别验证 Alpha、恰好两笔生图扣费，以及余额和累计使用量与交易成本一致。该用例未使用模拟供应商结果冒充云端通过。
- 干净工作树本地门禁：Doctor、TypeScript、ESLint `0 errors / 970 historical warnings`、Next.js `16.2.11` 生产构建均通过；全仓 Vitest 退出码 `0`，为 `526 files / 3420 tests passed`。另有 `20 files / 116 tests` 因未配置 `POSTGRES_TEST_DATABASE_URL` 明确跳过，不计为通过。
- 现有 Google Chrome 仅复用 Coze 项目页和预览页，没有新建标签、没有使用 360。浏览器运行、扩展安装/启用及 Native Host 清单诊断均通过，但接管、DOM 快照和刷新动作均超时。
- 云端预览公开请求返回 HTTP `404`、`error_code=instance_not_found`、`request_id=5aa43080-27e1-9b90-8fe1-b8f9364e9529`，证明当前沙箱实例不存在；因此不能把旧候选 `0adbd5ee` 的云端运行证据继承给 `4711501b`。
- **结论：本地候选通过，Stage 4 云端验收仍受环境阻塞。** 沙箱恢复并精确拉取 `4711501b` 后，必须重新完成透明 `n=2` 逐张回填、两份 Alpha 字节、任务终态和恰好两笔扣费验证。机器证据：`docs/testing/evidence/stage4-transparent-final-candidate-blocked-2026-08-24.json`。

## 2026-08-24 S4-BUG-016 云端复现与本地修复回归

- Coze `78f9d2f6` 已恢复，Google Chrome 管理员会话、新建项目和 23 个图像模型目录均正常；精确选择 Pear `gpt-image-2`、透明 PNG 与 `x2`。
- 首次提交和显式补选 `1:1 / 1K / x2` 后的第二次提交均被同一业务错误拦截：“尺寸格式无效”。两次都没有任务槽、供应商任务或扣费，故没有重复提交风险。
- 数据流定位证明专业面板把目录中的 `1K` 写为 `size`，而后端只接受像素尺寸或比例；修复前 RED 明确收到 `size: "1K" / resolution: undefined`。
- `main@4e99aa33` 最小修复后，组件回归、模型目录/能力准入联合回归 `32/32`，严格 TypeScript、改动文件零错误 ESLint、2 项真实 E2E 发现和 `116/116` 生产构建通过。
- **结论：S4-BUG-016 本地关闭，云端未关闭。** Coze 项目标签接管本身连续超时，无法拉取并证明 exact SHA；下一次云端只提交一个 `n=2` 批次，并继续核验两张真实 Alpha PNG、逐张回填、两个唯一 taskId、恰好两笔扣费和无隐藏 RemoveBG 任务。

## 2026-08-24 S4-BUG-017 云端二次复现与本地回归

- Coze 已通过现有 Google Chrome 项目页精确拉取并运行 `main@3c8fd1ca80947b1a81cd2f2356d0093ad70a8b59`；生产构建退出码 0，根路由与 `/api/auth/me` 均为 200，`origin/stable@52f7c601...` 未触碰。
- 预览页强制刷新后，管理员会话和专业生成面板正常。精确选择 Pear `gpt-image-2`，设置 `1:1 / 1K / 透明 PNG / x2` 并只提交一次，业务在任务创建前返回“所选模型不支持当前参数：size”；没有任务、供应商调用或扣费。
- 数据流证明前端已把 `1K` 正确写入 `resolution`，但同时保留 `size: ""`；后端能力准入把空字符串当作显式尺寸，形成 S4-BUG-016 之后的第二个独立根因。
- TDD 首先得到 2 个预期 RED；统一空白尺寸归一化后，聚焦 `19/19`、严格 TypeScript、改动文件零错误 Lint、全仓 `3423/3423` 和 Next.js `116/116` 生产构建通过。`116` 项 PostgreSQL 门禁跳过继续标为未验证。
- **结论：S4-BUG-017 本地修复通过，云端未关闭。** 必须提交并让 Coze 拉取新候选，再执行同一单次付费任务；不得重试制造重复任务，也不得用本地测试代替真实 Alpha 和账务证据。

## 2026-08-24 透明 PNG 双图云端闭环与供应商能力持久化修复

- Coze `main@a2705680` 上只提交一次 Pear `gpt-image-2 / 1:1 / 1K / transparent / PNG / x2`，生成两个不同任务；第一槽完成时第二槽仍为处理中，随后第二槽独立完成，证明逐张返回而非整批等待。
- 两个下载结果均为 `1254x1254` 四通道 PNG，最小 Alpha 为 0、最大 Alpha 为 255；SHA-256 分别为 `3490a3e...0098` 与 `573cb06a...72c`。画布展示、下载字节和视觉透明背景一致。
- 积分从 273 降为 153，累计使用从 3547 增为 3667；新增记录恰好两笔、每笔 60，均为图像生成，没有隐藏 RemoveBG、重复任务或额外退款。S4-BUG-017 及原生透明 `n=2` 云端链路据此关闭。
- 后续管理员持久化验收稳定发现独立 P1：云端历史 `selected_models JSONB` 表无法接受 `pg` 的数组字面量，且失败被上层吞掉。修复 `d56844b4` 同时兼容新 `TEXT[]` 与历史 `JSONB`，并使权威写入失败返回真实错误。
- 新鲜本地证据：真实 PostgreSQL 18 双结构 `2/2`、聚焦 `12/12`、干净全仓 `3426/3426`、TypeScript、`116/116` 生产构建、保护门禁及零错误 Lint 均通过；`117` 项其余 PostgreSQL 门禁仍明确跳过。
- **结论：透明双图、逐张回填和账务已云端通过；管理员能力持久化仅本地修复，仍须部署 `d56844b4` 后完成保存、刷新、重启和恢复原值。**

## 2026-08-24 管理员供应商能力持久化云端回归

- Coze、本地与 GitHub 已精确运行 `main@22a24c0fa2b837957c98469985c17af4b15e91ef`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- 历史 `selected_models JSONB` 路径使用不调用模型的禁用供应商完成 `maxOutputs: 空 -> 3`；保存、整页刷新和沙箱重启后均回读 `3`，随后恢复为空并重新读取确认。
- 稳定供应商补充覆盖 `PearAPI 图像` 与 `Apimart视频`：前者 `maxOutputs: 空 -> 3`，后者最大时长 `空 -> 12`；两者均在整页刷新后保持，并已恢复原值。
- 三个临时字段最终均为空；未改 API Key、供应商启停、模型授权、任务或积分。重启后 Console error/warning 为 `0/0`，无浏览器原生错误弹窗。
- **结论：V588-PROVIDER-005-BUG-003 云端回归通过。** Stage 4 仍由普通用户五入口、非法能力请求零副作用与真实视频任务/账务证据阻塞。

## 2026-08-24 S4-BUG-018 视频终态本地回归

- 真实 Pear `doubao-seedance-2-0-mini-260615` 5 秒任务约 6 分钟完成，余额 `653 -> 403`，仅新增一笔 `-250` 已完成扣费；旧部署却把结果卡标成 `MEDIA_UNAVAILABLE`，且恢复按钮无可见效果。
- 首轮 RED 共 7 项；首轮独立代码审查后再新增 8 项 RED，覆盖 Asset V3 视频类型水合、旧项目迁移主媒体 URL、完成态缩略图捷径、恢复轮询和无海报可播放卡片。最终复审又稳定复现无 `mediaType` 旧视频、持久化地址不同步和坏海报不降级 3 个边界，并以 4 项 RED 固化。
- 最终聚焦 `42/42`、扩展视频回归 `87/87`；全仓 Vitest `528 files / 3445 tests` 通过，`20 files / 117 tests` 因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过；TypeScript、Lint `0 errors / 970 historical warnings`、`git diff --check` 与 Next.js `116/116` 生产构建通过。
- 当前只能判定“本地回归通过”。Coze 拉取新 exact SHA 后仍须证明真实视频可播放、刷新恢复、下载成功及一次扣费；旧部署失败证据不能替代修复后云端通过。

## 2026-08-25 S4-BUG-018 播放交互补充回归

- Coze `main@ebf611ea` 的历史 5 秒视频已真实恢复为 `<video>`：媒体 URL 可访问，`readyState=4`、`duration=5`、`error=null`，页面不存在 `MEDIA_UNAVAILABLE`。该证据关闭“视频被当作缺失媒体”的展示分支，但不自动证明播放交互通过。
- Google Chrome 稳定复现可见播放浮层点击后 `playingVideoId` 不变化。事件追踪确认画布根节点在浮层 `pointerdown` 时启动图片拖动并捕获指针，后续 `click` 被重定向到画布；视频浮层缺少其他工具按钮已有的指针隔离。
- 新增回归先 RED，随后仅在播放浮层增加 `onPointerDown={(e) => e.stopPropagation()}`，提交并推送 `main@fb6741853272b43a4e36e046511900f031ab758f`。没有改动视频 URL、供应商、能力、任务、扣费或图片拖动逻辑。
- 聚焦画布/视频矩阵 `47/47`；最终全仓 `528 files / 3446 tests` 通过，`20 files / 117 tests` 因缺少完整 `POSTGRES_TEST_DATABASE_URL` 跳过；TypeScript、改动文件零错误 Lint、Next.js `116/116` 构建和 `git diff --check` 通过。
- **结论：本地回归通过 / 云端最终验收待执行。** Coze 尚未拉取 `fb674185`；Chrome 扩展仍可枚举正确“用户1”的现有项目页和预览页，但旧控制会话占用导致接管超时。不得把本地结果或 `ebf611ea` 的静态媒体加载结果扩大为播放、下载和账务通过。

## 2026-08-25 视频播放、首次下载与托管 MP4 云端闭环

- `bce42584` 与 `f1c5d386` 先后修复视频播放浮层指针隔离、未选中悬停下载首次点击的 React 选择态竞态；Coze 上已证明首次点击立即出现唯一 MP4 选项和“确认下载”。
- 同轮真实操作发现独立 `S4-BUG-019`：下载确认请求 404。TDD 证明视频实际写入 `{dataRoot}/uploads/video/...`，下载路由只查旧目录；`f19ab164` 仅对齐托管目录候选。
- 本地聚焦 `23/23`、全部视频 `58/58`、TypeScript、改动文件零错误 Lint 和 `116/116` 构建通过。全仓业务断言 `3447` 项通过，`117` 项 PostgreSQL 门禁跳过；既存源指纹测试发生一次 20 秒超时，未修改等待阈值。
- Coze、GitHub 与本地精确为 `main@f19ab16441c8ef632124fb12afb1d94ad2200d2f`，`stable@52f7c601...` 未触碰；云端 PID `1309`、`shadow`，首页与 `/api/auth/me` 均 200。
- Google Chrome 真实验证：历史视频 5 秒、`readyState=4`、播放时间推进；未选中首次悬停下载弹窗立即打开；确认后生成 783,768 字节 MP4，`ftyp/isom`，SHA-256 `30E6CF788AFE737A94EDF6F1E501DC15A16F11ECA869EBD8A1A67A56A6927B5C`；下载错误日志为 0；刷新后仍可播放。
- **结论：S4-BUG-018 的媒体展示/播放/刷新和 S4-BUG-019 的下载链路已云端通过。** 本轮未在下载动作前单独采集积分快照，因此“不新增扣费”不作为独立账务实测关闭项；Stage 4 仍由普通用户五入口、非法能力零副作用和其余既有门禁阻塞。

## 2026-08-25 普通用户五入口与非法能力零副作用云端回归

- 版本：Coze、本地和 `origin/main` 为 `1ec32f49c651b8f18aa47df382435cede650523a`；运行时代码为 `f19ab16441c8ef632124fb12afb1d94ad2200d2f`；`stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- 普通账号 `canvas-user` 的五入口结果全部通过：底部图像生成器、参考图组、融图组、节点模式图像生成节点、视频生成器。Pear 与 APIMART 的比例、尺寸/分辨率、质量、数量及时长按精确供应商模型目录变化。
- 融图数量菜单在关闭视频生成器覆盖浮层后正常展开 `1-4张`，并成功切换到 `4张`；此前失败是测试前置状态错误，不是生产回归。
- 真实登录会话提交 Pear `gpt-image-2 / n=5`，收到 HTTP 400 和 `MODEL_CAPABILITY_MISMATCH`。请求前后数据库三项均未变化：任务 `83 -> 83`、积分流水 `108 -> 108`、累计使用 `3917 -> 3917`。
- 普通用户画布上的“用户管理”入口没有暴露管理员系统，点击后进入普通用户项目仪表盘。该入口命名仍有 P3 可理解性问题，但没有权限扩大。
- **结论：V588-PROVIDER-005 的普通用户五入口与应用侧非法能力零副作用通过，Stage 4 该专项关闭。** 第三方供应商后台独立计数未在本轮 Google Chrome 标签中直接取证，继续按证据边界说明，不把推断写成第三方审计通过。
- 证据：`docs/testing/evidence/s4-ordinary-five-entry-and-admission-2026-08-25.json` 与同名 PNG。

## 2026-08-25 V588-PROVIDER-001 模型显示映射云端回归

- 本地实现提交为 `3c597cd9a4c14dfeb851ad06670c49b3158a7d49`。新增精确模型映射并改为最长模式优先，避免 `gpt-image-2`、`nano-banana-2`、`kling-v3` 等较短模式遮蔽 4K、Lite、Omni 等更精确型号。
- RED/GREEN 为 `26/26`，关联回归 `59/59`；全仓 `3474` 项业务断言通过，`117` 项真实 PostgreSQL 门禁因缺少完整隔离库跳过。TypeScript、改动文件零错误 ESLint、空白检查与 Next.js `116/116` 构建通过。
- Coze 精确拉取并构建 `3c597cd9`，运行 PID `3471`、根路由 HTTP `200`、持久化模式 `DB_ONLY`。`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- Google Chrome 普通用户真实目录断言 `5/5` 通过：Pear `gpt-image-2-4k`、Pear `nano-banana-2-lite`、APIMART `kling-v3-omni`、AIlink `happyhorse-1.0`、APIMART Grok Imagine 1.5 视频别名均显示为各自精确名称；管理员/供应商名称优先级仍保持。
- 干净重载后的 10 秒观察窗口 Console error/warning 为 `0/0`，原生弹窗为 `0`。本轮没有提交生成或扣除积分。
- **回归结论：V588-PROVIDER-001 通过。** 证据位于 `docs/testing/evidence/v588-provider-001-*cloud-2026-08-25.*`。

## 2026-08-25 V588-CHAT-001 严格 SSE 本地回归

- 运行时代码提交为 `717f3eab`（共享严格 SSE 解析器）和 `29ef29b4`（普通对话、CanvasEditor 修图、Deep Research 三入口接线）。V5.8.8 donor、`stable` 和会话/任务所有权均未修改。
- RED 证据包括解析器目标模块缺失的 1 个预期失败套件，以及三入口仍使用手写解析逻辑的 `2/2` 接线合同失败；GREEN 后解析器 `9/9`、解析器与接线合同 `11/11`、关联回归 `56/56` 通过。
- 解析器覆盖 LF/CR/CRLF、任意网络分块、分裂 UTF-8、多行 `data`、尾事件、注释、`event/id`、`[DONE]`、回调异常、旧请求取消和严格畸形 JSON。非空、非 `[DONE]` 的错误 JSON 会返回稳定协议错误，不再静默跳过。
- 接线回归修复 CanvasEditor 参数角色错位，并兼容服务端实际发送的 `text` 正文事件；保留现有 AssetVersion 传输、业务事件分支和旧请求取消边界。
- 全仓为 `532` 个文件通过、`20` 个 PostgreSQL 文件因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过；`3485` 项断言通过、`117` 项跳过。TypeScript、零错误 ESLint、Next.js `116/116` 构建、`git diff --check` 和 `38/38` 受保护基线门禁通过。
- **回归结论：本地通过 / 云端未验证。** Coze 仍需在精确新 `main` 上完成普通对话流式、CanvasEditor 定点替换、Deep Research 阶段/引用、严格错误态、Console、网络和重复请求检查；当前不得写为云端通过。

## 2026-08-25 Simple Chat 模型菜单与请求上下文本地回归

- V5.8.8 的有效菜单修复已选择性吸收：顶部栏建立 `relative z-50` 层叠上下文，聊天和图像模型列表保持 `z-[100]`、内部滚动和点击控制；没有引入 donor 的重复模型本地状态。
- 模型选择改为当前任务的单一数据源，精确 `providerId + modelId` 原子更新；普通对话、CanvasEditor 和 Deep Research 均在请求开始时冻结同一模型快照，延迟返回不能覆盖新任务。
- 聚焦回归为 `8 files / 43 tests` 全通过，覆盖精确模型配对、跨任务/跨项目迟到流、任务切换消息所有权、菜单布局和浏览器门禁契约。浏览器门禁覆盖桌面、412px、375px、320px 长对话的 hit-test、滚动和点选，并拦截测试页面的真实聊天项目写回；因本机缺少真实 E2E 凭据与服务环境，真实 Playwright 执行仍属于云端待验，未写成通过。
- 全仓 Vitest 为 `536 passed / 20 skipped files`，业务断言 `3508 passed / 117 skipped`；跳过项均为缺少 `POSTGRES_TEST_DATABASE_URL` 的真实 PostgreSQL 专项。`pnpm ts-check`、`pnpm lint:build`、Next.js `116/116` 构建、`git diff --check` 和保护基线门禁均通过。
- **回归结论：本地通过 / Coze Google Chrome 菜单子项已验。** 实际请求模型组合与三入口流式终态继续独立待验。

## 2026-08-25 Simple Chat 模型菜单 Coze Google Chrome 回归

- 首轮 `main@912eaa46` 真实验证发现第二个缺陷：320x568 下图像模型按钮换行并右移，按钮容器的 `right-0` 使 296px 菜单左边界约为 `-26px`。该失败先保留，再增加纯布局 RED；没有用截图缩放或隐藏溢出来掩盖。
- 最小修复提交为 `9a3fcb63d732a0f8cf572be4741ec93585c8f400`。Coze 构建退出码 0，PID 1370；`/`、`/simple-chat`、`/api/auth/me` 和 HTML 引用的 12 个静态资源均为 200；`origin/stable@52f7c601...` 未改变。
- 真实边界：320px 两菜单均为 `left=12/right=308/width=296`；375px 为聊天 `43..363`、图像 `12..332`；412px 为聊天 `80..400`、图像 `41.3..361.3`；1440px 保持 320px 桌面宽度并位于视口内。
- 图像列表有 23 个 option，`overflow-y:auto`，`scrollHeight=1290/clientHeight=382`；聊天列表有 4 个 option。两列表的首项可点击，点击后 `aria-expanded=false`。
- 服务替换后的首次刷新出现一次 chunk 3230 加载失败和全局错误边界；同一 chunk 随后 HTTP 200，第二次刷新成功，之后没有新增 Console error/warning。该证据作为 `S3-BUG-032` 部署切换期复发保留。
- 机器可读证据：`docs/testing/evidence/v588-chat-model-menu-cloud-2026-08-25.json`。
- **回归结论：菜单遮挡、320px 裁切、内部滚动和点选关闭通过。** 模型实际请求配对、普通对话、CanvasEditor 和 Deep Research 不由本次布局验证代替。

## 2026-08-25 Simple Chat 三入口错误终态本地回归

- 在开始真实 APIMart 验收前，以组件级真实 SSE 流稳定复现两个遗漏：CanvasEditor 丢弃 `type:error` 后误报“AI 未返回内容”，Deep Research 丢弃同一事件后把阶段提示保留为最终消息。
- 根因位于 `chat-area.tsx` 的业务事件分派，不在共享 SSE 解析器或供应商。普通对话已有同类错误分支，因此最小修复只补齐 CanvasEditor 与 Deep Research，不改变模型路由、会话隔离、任务和账务。
- RED 为 `2 failed / 12 passed`；GREEN 为聚焦 `14/14`、Simple Chat 相关 `16 files / 102 tests`。全仓为 `537 files / 3513 tests` 通过，`20 files / 117` 项 PostgreSQL 专项因缺少隔离测试库跳过；TypeScript、零错误 Lint、生产构建 `116/116`、保护基线 `38/38` 和空白检查通过。
- **回归结论：本地通过 / 云端待验。** 仍须在 Coze 精确新提交上使用 Google Chrome 和 APIMart，分别验证普通对话、CanvasEditor、Deep Research 的真实请求配对、终态、请求次数、Console、网络和原生弹窗；不得仅凭本地事件注入关闭 V588-CHAT-001。

## 2026-08-25 V588-CHAT-001 Coze APIMart 云端回归

- 候选与运行页：`main@e0c091dddb729d7a7569971c0c29b5e0391f2f13`，Google Chrome“用户1”，普通账号 `canvas-user`，`/simple-chat`。
- 普通对话：一次 `/api/simple-chat/chat`，精确 `api_1778428130626_2qpg71v + deepseek-v4-flash`，HTTP 200 SSE，精确标记渲染并收到 `done`；请求中没有历史损坏图片。
- CanvasEditor：局部选区 `CHAT_001` 被替换为 `CANVAS_OK`，结果 `V588_CANVAS_OK_1787662837500` 与预期完全一致，选区外文本未变化；一次请求、HTTP 200、SSE `done`。
- Deep Research：一次 `/api/simple-chat/deep-research`，同一模型配对，完整经历计划、搜索、写作并在约 40.8 秒后 `done`；报告与标记真实显示。
- 模型下拉在 2048x991 视口可见，`z-index=100`，采样命中菜单自身；新会话无历史 base64 污染；三链路后 Console error/warning `0`、原生弹窗 `0`、重复请求 `0`。
- 本轮只验证真实成功路径。供应商错误传播与跨任务迟到写入由此前 RED/GREEN 和 Simple Chat `102/102` 覆盖，未冒充云端故障注入。
- **结论：V588-CHAT-001 云端回归通过。** 证据见 `docs/testing/evidence/v588-chat-001-apimart-cloud-2026-08-25.json` 与 PNG；可按既定顺序开始 `V588-CHAT-002`，全平台仍保持有条件通过。

## 2026-08-25 V588-CHAT-002 确定性原位重试本地回归

- 普通/联网对话、Deep Research 和 CanvasEditor 均以失败测试建立契约：失败保留原消息或原编辑快照，重试复用冻结模型、供应商、模式、附件引用、响应消息 ID 与幂等键，不插入第二组消息，不重复登记附件。
- CanvasEditor 以精确 `selectionStart/selectionEnd` 替换目标文本；失败不创建版本，重试成功只创建一个版本。跨任务和跨项目的迟到结果仍被拒绝。
- API 层统一处理幂等键：可选、1-256 字符、受限字符集；Header/正文冲突返回 `409 IDEMPOTENCY_KEY_CONFLICT`，非法值返回 `400 IDEMPOTENCY_KEY_INVALID`。Deep Research 规划和报告分别使用稳定派生键。
- 聚焦套件 `7 files / 71 tests` 全通过；`pnpm ts-check` 通过；`pnpm lint` 为 `0 errors / 967 warnings`；第三次全仓回归为 `540 passed / 20 skipped files`、`3531 passed / 117 skipped tests`；`pnpm build` 退出 0 并生成 `116/116` 页面。
- `117` 项跳过均因未配置 `POSTGRES_TEST_DATABASE_URL` 或 `TEST_POSTGRES_URL`，没有记为通过。第二次全量中的 `stage-3-source-state` 超时经聚焦计时确认是 Windows/Git 同步操作预算过紧，测试预算调整为 45 秒；第三次全量实际用时约 11.1 秒并通过，没有修改业务超时。
- **回归结论：本地通过 / Coze 故障注入与刷新恢复待验。** 应用级确定性重试成立；第三方文本供应商严格 exactly-once 不作保证，全平台继续保持有条件通过。

## 2026-08-25 V588-CHAT-002 云端离线故障注入补充

- `origin/main@7bf1cc3c` 已合并到 Coze `main@8096833c`；生产构建退出 0、静态页 `116/116`、Build ID `tdM5XK103XE0zLAP7oe4X`，5000 服务 PID `1218`，`/`、`/simple-chat`、`/api/auth/me` 均为 200；`stable@52f7c601` 未变化。
- Google Chrome“用户1”在新对话中选择 `Deepseek V4 Flash · APImartLLM`，对唯一标记执行短时离线注入。界面只生成一组用户/助手消息，助手进入明确失败态并显示专用“重试”按钮。
- 本次网络窗口共 6 个事件、3 个请求尝试：聊天 1、操作审计 1、用户数据同步 1；三者均按预期离线失败。`/api/client-error` 为 0，没有再形成 `/api/client-error <-> /api/activity` 递归；同一时间窗 Console error/warning 为 `0/0`。
- 在线“重试”点击已经发出，但等待 APIMart 终态时 Chrome 控制连接超时，最终 UI 与本次请求快照未重新取得。为避免重复调用，没有再次点击或伪写通过；上一候选 `b76f62af` 已证明普通原位重试可在同一消息成功并携带单一应用幂等键，但最终候选仍需补齐终态证据。
- **回归结论：遥测递归云端通过；V588-CHAT-002 整体仍为部分通过。** Deep Research、CanvasEditor、刷新中断和最终候选普通重试仍未关闭。证据见 `docs/testing/evidence/v588-chat-002-7bf1cc3c-cloud-2026-08-25.json`。

## 2026-08-26 V588-CHAT-002 最终候选补充验收

- Google Chrome“用户1”在同一 `7bf1cc3c` 云端构建中新建对话并选择 `Deepseek V4 Flash · APImartLLM`。普通对话使用标记 `V588_CHAT_002_FINAL_1787676333063` 执行短时离线注入，失败态只有 1 条用户消息、1 条失败助手消息和 1 个专用“重试”按钮。
- 恢复在线后只点击一次“重试”。CDP 记录只有 1 个 `POST /api/simple-chat/chat`，请求固定为 `providerId=api_1778428130626_2qpg71v`、`modelId=deepseek-v4-flash`，Header 与正文复用同一 `simple-chat-retry:iji5m7v5mt8wbh6b:ig5aj1bs` 幂等键。最终界面只有 1 条用户消息和 1 条精确标记答案，失败文本与重试按钮均消失。
- **普通对话原位重试云端通过。** 这关闭了最终候选的完成 UI、请求快照、冻结模型配对和单请求证据缺口；不扩大为第三方供应商严格 exactly-once 保证。
- Deep Research 使用标记 `V588_RESEARCH_RETRY_1787676416161` 重复相同故障注入：先得到 1 条失败助手消息和 1 个“重试”按钮，再单击一次重试并在同一消息位置真实流出研究报告。长流期间 Chrome 标签控制锁未释放，未能取得明确完成态、请求快照和 Artifact 数量；随后服务器同步探针返回 200，但标记尚未进入 `chat_simple_projects` 权威快照。
- **Deep Research 仍为部分通过。** 不把部分正文当作完成，不重复提交；CanvasEditor、刷新中断恢复及单一 Artifact/版本仍未关闭。证据已增补至 `docs/testing/evidence/v588-chat-002-7bf1cc3c-cloud-2026-08-25.json`。

## 2026-08-26 V588-CHAT-002 CanvasEditor 云端失败重试与选区契约修复

- Google Chrome“用户1”在现有 `/simple-chat` 标签打开写作画布，正文为“前缀原文后缀”，只选中“原文”。短时离线提交后，行内错误精确显示 `Failed to fetch`，选区、修改指令和正文均保留，版本仍为 `1`，专用“重试修改”按钮只有 `1` 个。
- 恢复网络后只点击一次重试。浏览器记录只有 `1` 个 `POST /api/simple-chat/chat`，HTTP `200`，精确使用 `api_1778428130626_2qpg71v + deepseek-v4-flash` 和同一 `simple-chat-canvas-edit:*` 幂等键；版本只增加到 `2`，错误与重试入口消失，Console error/warning 为 `0/0`。因此失败快照、冻结模型配对、单请求和单成功版本成立。
- 云端结果实际为“前缀原文 + 新标记 + 后缀”，未严格替换旧选区。根因不是重试状态，而是选区请求只发送片段，系统提示却仍要求“输出修改后的完整文本”，契约互相矛盾。
- 新增集成 RED 后，以最小改动把选区编辑提示改为“只输出修改后的选中文本片段”，全文编辑契约不变。修复提交为 `e0ec998d28a2bad0fc27981220bff42fb9a390d7`；专项 `6 files / 39 tests`、全仓 `541 files / 3533 tests`、TypeScript、零错误 Lint 和 Next.js `116/116` 构建通过。`20 files / 117` 项 PostgreSQL 专项仍因缺少隔离测试库跳过。
- 受保护基线功能与证据合同均存在，但脚本被 4 个此前未批准漂移路径阻塞；本次新增的 `chat-area.tsx` 不在阻塞列表。未擅自扩大白名单。
- **回归结论：CanvasEditor 确定性重试云端通过，选区输出质量已本地修复 / 新提交云端待验。** 在 Coze 拉取 `e0ec998d` 并得到精确替换结果前，不关闭 CanvasEditor 整项；刷新中断恢复和 Deep Research 完成态仍保持未验证。

## 2026-08-26 CanvasEditor 选区契约修复部署确认

- GitHub `origin/main@2c508bad71e423b18bfa503d6277156e344c1b36` 已合并到 Coze `main@05f1d7e73cec190827852f3300a00871bce9a475`；两者文件树一致，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- Coze 生产构建退出码为 `0`，静态页为 `116/116`，新 Build ID 为 `5v4rvNIC6-MWnYjJ5HWaz`；5000 服务已从旧 PID `283` 切换到新 PID `2266`。
- 公网 `/` 与 `/simple-chat` 均返回 HTTP `200`。`/simple-chat` 加载的 17 个脚本中，`/_next/static/chunks/app/simple-chat/page-d9e8ae829a1f734c.js` 精确包含“只输出修改后的选中文本片段”，证明 `e0ec998d` 的契约修复已进入真实云端构建。
- Chrome 扩展、浏览器进程和本地通信清单均正常，但沙箱重启后现有预览标签的页面级控制连续超时；因此本轮没有再次提交模型请求，也没有把部署资源证据冒充为交互通过。
- **回归结论：部署内容通过 / 认证交互仍待验。** 仍需在同一 Google Chrome 预览标签恢复控制后，证明选区结果精确为“前缀 + 新片段 + 后缀”，并完成刷新中断恢复；在此之前 V588-CHAT-002 不关闭。

## 2026-08-26 V588-CHAT-002 刷新中断真实失败与本地修复

- Google Chrome“用户1”在新对话中选择 `Deepseek V4 Flash · APImartLLM`，只提交一次标记 `V588_REFRESH_RECOVERY_1787699148730`；输入清空且发送控件进入禁用状态后约 6.6 秒刷新同一标签页。
- 刷新后没有永久加载，但页面回到了该项目第一条旧对话，目标标记可见数为 0。数据库证明目标任务并未丢失：只有 1 条用户消息和 1 条助手消息，助手带完整冻结上下文和幂等键，但在最终探针时仍为 `streaming`。
- 审计表只有 1 条 `/api/simple-chat/chat`、HTTP 200、232ms；Console error/warning 为 `0/0`，原生弹窗为 0。因此失败不来自重复请求或供应商模型不可用，而是前端任务身份恢复错误。
- 根因是 URL 只持久化 `projectId`，初始化函数固定选择项目第一条任务。按 TDD 新增精确任务恢复与 URL 接线测试，旧代码 `2 failed / 2 passed`；最小接入 `taskId` 后目标 `4/4`、关联 `5 files / 33 tests` 通过。
- 完整本地门禁为：`541` 个测试文件、`3535` 项已执行测试全部通过；`20` 个文件、`117` 项 PostgreSQL 专项因缺少隔离库跳过；TypeScript、ESLint `0 errors / 967 historical warnings`、Next.js `116/116` 构建、证据清单和空白检查通过。
- **回归结论：旧云端失败 / 本地修复和完整门禁通过 / 新云端复验待完成。** 本轮不能关闭 V588-CHAT-002；机器证据见 `docs/testing/evidence/v588-chat-002-refresh-interruption-cloud-2026-08-26.json`。

## 2026-08-26 V588-CHAT-002 刷新中断首次新云端复验与第二轮修复

- Coze 运行树与 `origin/main@da1f5c4` 完全一致，Build ID `tHz1tu9I_gsWmHxNeCb6J`；`stable@52f7c601` 未触碰。
- Google Chrome 在任务 `58r009tjmt9e9yqn` 只提交一次标记 `V588_REFRESH_RECOVERY_FIXED_1787706573819`，响应开始后 5 秒刷新同一标签页。刷新前后 URL 均精确保留 `projectId + taskId`，标记仍可见，页面显示唯一“上次请求中断，可重试”和一个重试按钮。
- PostgreSQL 与审计证明只有 1 条用户消息、1 条助手消息、1 次 `/api/simple-chat/chat`，HTTP 200、268ms；但权威 `chat_simple_projects` 中助手状态仍为 `streaming`。因此精确任务恢复通过，数据库终态持久化失败。
- 根因是装载边界仍把服务器项目的原始 `streaming` 写入父状态，恢复逻辑只作用于 ChatArea 展示状态。按 TDD 新增项目树装载归一化测试，旧实现 `1 failed / 4 passed`；最小新增 `recoverInterruptedSimpleChatProjects()` 并在状态写入前调用。
- 第二轮本地门禁：目标 `12/12`，Simple Chat `18 files / 122 tests`，全仓 `541 files / 3536 tests` 全部已执行项通过；`20 files / 117 tests` 因缺少隔离 PostgreSQL 测试库跳过。TypeScript、ESLint `0 errors / 967 historical warnings` 与 Next.js `116/116` 构建通过。
- **回归结论：首次新云端部分失败 / 第二轮本地修复通过 / 新部署待验。** 未取得 PostgreSQL `failed` 或合法 `completed` 前不得关闭 V588-CHAT-002-BUG-003。机器证据见 `docs/testing/evidence/v588-chat-002-refresh-recovery-fixed-cloud-2026-08-26.json`。

## 2026-08-26 V588-CHAT-002 刷新中断第二候选云端关闭

- Coze 最终运行树 `eb205aae` 与 `origin/main@3ecd2f9b` 一致，Build ID `6W73gy7XRcKPuZE8k4DQR`、PID `1308`；`/`、`/simple-chat`、`/api/auth/me` 和 12 个 HTML 引用静态资源全部返回 200，`origin/stable@52f7c601` 未触碰。
- 先刷新首次候选遗留任务 `58r009tjmt9e9yqn`：UI 为单一“上次请求中断，可重试”，服务器 `chat_simple_projects` 同步结果为 1 条用户消息、1 条助手消息，助手已持久化为 `failed` 且 `retryable=true`，证明装载边界归一化确实回写了权威状态。
- 再新建任务 `j1ek6ayjmt9gip4e`，选择 APImart `deepseek-v4-flash`，响应真实流出标记 `V588_REFRESH_RECOVERY_FRESH_1787710278255` 与正文后 5 秒刷新。刷新前后 URL 的 `projectId + taskId` 完全一致；刷新后部分正文保留，只出现一个重试入口，服务器仍严格为 1 条用户消息与 1 条助手消息，助手终态 `failed`。
- 浏览器 Console error/warning 为 `0/0`，原生弹窗为 0。作为供应商对照，APImart Gemini 通道的 `get_channel_failed` 被明确展示并持久化为失败，没有被当成刷新恢复产品缺陷。
- **回归结论：V588-CHAT-002-BUG-003 云端关闭。** 本结论不扩大到第三方 exactly-once、联网模式或 Deep Research 单 Artifact；V588-CHAT-002 整项仍为部分通过。机器证据见 `docs/testing/evidence/v588-chat-002-refresh-recovery-second-candidate-cloud-2026-08-26.json` 与 PNG。

## 2026-08-26 V588-CHAT-002 联网重试关闭与 Deep Research Artifact 候选

- Google Chrome“用户1”对联网任务 `kmvx7l7gmt9h7o60` 执行标签级离线故障注入。首次请求得到明确 `Failed to fetch`，界面只有 1 张失败卡和 1 个“重试”按钮；恢复在线后只点击一次重试。
- 初始与重试正文保持同一消息、APImart `api_1778428130626_2qpg71v + deepseek-v4-flash`、`webSearch=true` 和幂等键。重试 HTTP 200；服务器快照严格为 1 条用户消息、1 条搜索消息、1 条 `completed` 助手消息。Console error/warning 与原生弹窗为 0。**联网原位重试子项关闭。**
- 同场 Deep Research 任务 `m210yfr7mt9gvgiy` 已真实 `completed`，服务器只有一组消息且正文长度 1733，但 Artifacts 面板在刷新前已经显示“暂无 Artifacts”。这不是刷新丢失，而是 Artifact 从未进入消息持久状态。
- 按 RED -> 最小修复，`90772d42` 统一以 `messages[].artifacts` 为唯一来源，并在精确助手消息上幂等写入稳定研究 Artifact。目标 `19/19`、全仓 `3536` 项已执行测试、TypeScript、零错误 Lint 和 `116` 页生产构建通过；117 项 PostgreSQL 隔离测试仍跳过。
- **回归结论：联网模式通过；Deep Research Artifact 本地通过 / 云端待验。** Coze 当前返回 `instance_not_found`，候选尚未运行；刷新前后单一 Artifact 与服务器快照未取得前，V588-CHAT-002 仍不关闭。

## 2026-08-26 V588-CHAT-002 Deep Research 单 Artifact 云端关闭

- Coze `main-fix@1572a222863063c44c079be89bbdc27182768b63` 已包含最小运行时修复 `90772d4257c13e495b3884329a7801168db972ac`，生产构建退出码为 0，5001 入口健康检查为 HTTP 200；`stable@52f7c601` 与 V5.8.8 donor 未变化。
- Google Chrome“用户1”在同一任务 `11tvkeffmt9jnh88` 使用 APImart `deepseek-v4-flash` 完成研究报告。服务器权威快照只有 2 条消息，助手消息 `msg_1787715525319` 为 `completed`，正文长度 1437。
- 刷新前 Artifacts 面板与服务器均严格为 1 条；刷新同一 `projectId + taskId` 后仍严格为 1 条，Artifact ID 始终为 `msg_1787715525319-research`，没有重复消息或重复 Artifact。
- 刷新前后 Console error/warning 为 `0/0`，原生弹窗为 0。**回归结论：V588-CHAT-002-BUG-004 云端关闭，V588-CHAT-002 应用侧验收完成。** 第三方文本供应商是否严格支持幂等键仍是能力边界，不作为应用完成态的虚假保证。
- 发布保护门禁补齐 4 个已审实现的精确路径与真实来源提交；来源校验 `7/7`、保护特征 `38/38`、警告 0。未增加目录级授权。
- 机器证据：`docs/testing/evidence/v588-chat-002-deep-research-artifact-cloud-2026-08-26.json`、`v588-chat-002-deep-research-artifact-cloud-pre-refresh-2026-08-26.png`、`v588-chat-002-deep-research-artifact-cloud-post-refresh-2026-08-26.png`。

## 2026-08-27 V588-CHAT-003 本地候选回归

- 基线为 `9e05cf0881d0d64af4ba96311837885ac77b3c33`，最终复审修复后的候选为 `5663441a30c279d5a696235020dae5d47cc0703d`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持只读且未变化。
- 修复前阶段完整门禁中，全仓 Vitest 为 `3906 passed / 118 skipped / 0 failed`；API 为 `765 passed / 3 skipped / 0 failed`；回归为 `2887 passed / 10 skipped / 0 failed`。这些是三套门禁各自的结果，不相加为新的测试总数；跳过项不计为通过。
- Next.js 构建完成 `116` 个静态页面/路由。复审后聚焦合同 `13/13`、保护基线 `38/38`、TypeScript 与目标 ESLint 通过。
- Playwright 仅执行发现：五个项目合计 `70` 项，`chromium`、`chromium-1080p`、`firefox`、`webkit`、`mobile-chromium` 各 `14` 项；未执行真实浏览器场景。
- 全分支终审发现 1 个 Critical 旧服务端存储键迁移缺陷；`5663441a` 保留历史 `data_key='chat_simple_projects'`、按用户 advisory lock，并将旧数组 revision `0` 在原行升级为 revision `1`。
- 修复专项 RED 为 `2 failed / 10 passed`；GREEN 后单元 `12/12`、Simple Chat API `28/28`，`ts-check`、目标 ESLint、保护基线 `38/38` 与 `git diff --check` 通过。PostgreSQL 迁移和并发测试因缺少 `POSTGRES_TEST_DATABASE_URL` 为 `2/2 skipped`，不计为通过。
- 窄范围复审为 Ready to merge: Yes，Critical/Important/Minor `0/0/0`。
- **回归结论：本地候选完成 / 云端待验 / 未吸收。** 真实浏览器、跨账号隔离、PostgreSQL 迁移和并发保持 `UNVERIFIED`。Coze 未运行精确候选，故不得将本地结果扩大为云端通过或 `V588-CHAT-003` 已吸收；全平台继续为有条件通过。

## 2026-08-27 V588-CHAT-003 Coze 构建阻断修复

- Coze 已把 `/workspace/projects` 精确对齐 `origin/main@e64edbbe`，源码树一致且 `stable@52f7c601` 未变化；生产构建在 TypeScript 阶段被根目录内保留的 `worktrees/main-fix` 重复源码阻断。
- 通过本地嵌套同名脚本夹具稳定复现目录边界，再按 RED -> 最小修复统一隔离 Git、TypeScript 和 ESLint 的 `.worktrees/`、`worktrees/`。
- 修复提交 `11abb548` 的目标契约 `6/6`、TypeScript、零错误 Lint、保护门禁 `38/38`、带嵌套夹具的生产构建 `116/116` 通过；全仓为 `3909 passed / 119 skipped / 0 failed`，PostgreSQL 跳过项不计为通过。
- **回归结论：构建根因本地关闭 / Coze 待复验。** 在 GitHub 推送、Coze 精确拉取、构建和 5000 健康完成前，V588-CHAT-003 的浏览器业务矩阵仍未开始，状态保持未吸收。

## 2026-08-27 V588-CHAT-003 Coze 构建关闭

- GitHub 与本地候选均为 `48c2ad3fd262d933ac08ab18f389e320e192d634`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- Coze 清理无关嵌套工作树后，生产构建退出码 `0`，Build ID `8Iztiwokck9HEnxplOf78`；根页、Simple Chat、认证健康接口和 12 个静态资源均为 HTTP 200。
- **回归结论：V588-CHAT-003-BUILD-001 已关闭。** 这只解除构建前置条件，不代表 `V588-CHAT-003` 业务矩阵通过；真实项目同步、冲突、删除、账号隔离、离页冲刷及 PostgreSQL 证据继续保持未验证。

## 2026-08-27 V588-CHAT-003 首轮云端业务回归

- 专用项目 `sodi90k3mtaqb72j`、任务 `b4h25r5tmtaqckwr` 使用 APImart `Deepseek V4 Flash` 完成普通对话；助手唯一标记刷新前后均为 `1`，同步状态均为“已同步”，任务重命名刷新后保留。
- 云端真实失败为工作台初始“智能对话 0”；点击页签后数据源正确返回 `2` 个项目，证明失败位于仪表盘加载时机，不在同步 API 或数据库数据内容。
- `V588-CHAT-003-BUG-001` RED 为 `1 failed / 9 passed`，GREEN 为 `10/10`；相关同步 `348/348`、全仓 `3910 passed / 119 skipped / 0 failed`，TypeScript、零错误 Lint、保护门禁 `38/38` 和生产构建 `116/116` 通过。
- **回归结论：普通对话、刷新恢复、项目/任务重命名通过；仪表盘计数候选本地通过、云端待验。** 多标签、删除、跨账号、离线及 PostgreSQL 仍不得标记通过。

### 仪表盘计数修复云端复验

- `b92998dafd289a433232eb72cddacef32a53ea28` 部署后，在既有 Google Chrome 业务标签页强制刷新；未进入“智能对话”页签前，侧栏首次渲染已直接显示“智能对话 2”。
- 进入页签后仍显示 `2 个对话项目`：默认项目 `16` 个对话，`V588-CHAT-003-CLOUD-20260827` 为 `2` 个对话；前后计数一致。
- Console error/warning 为 `0`，浏览器原生弹窗为 `0`；截图为 `docs/testing/evidence/v588-chat-003-dashboard-count-cloud-postfix-2026-08-27.png`。
- **回归结论：`V588-CHAT-003-BUG-001` 云端关闭。** 此结论只覆盖仪表盘初始计数；删除不复活、多标签、跨账号与 PostgreSQL 并发仍保持未验证。

### 专用任务恢复与返回工作台路径复验

- 直接恢复 `projectId=sodi90k3mtaqb72j&taskId=b4h25r5tmtaqckwr` 后，APImart `Deepseek V4 Flash`、同步状态“已同步”和唯一助手标记均正确恢复；标记可见计数为 `1`。
- 点击“工作台”期间以 50 ms 采样 URL，唯一地址仅为当前 `simple-chat` 和最终 `/?view=dashboard`，未经过登录页或无限画布；最终仪表盘继续显示“智能对话 2”，且无原生弹窗。
- 证据为 `docs/testing/evidence/v588-chat-003-task-restore-cloud-2026-08-27.jpg`。此项关闭的是已同步任务恢复和返回路径，不能代替“存在未同步写入时离页冲刷”的专项测试。

## 2026-08-27 V588-CHAT-003 全新 PostgreSQL 迁移与全仓回归

- 在一次性 PostgreSQL 18.4 隔离集群上启用全部数据库测试变量。首次完整执行稳定复现 `12` 个测试文件失败：`558/570` 文件通过，`3935/4029` 项通过，另有 `87` 项失败、`7` 项跳过。
- 根因不是 V588-CHAT-003 业务同步算法本身，而是全新库缺少 `wujie_users` 前置迁移，导致后续认证增量迁移回滚；同时发现核心表初始化 Promise 未按数据库 URL 隔离，以及两组 PostgreSQL 测试夹具没有遵循当前迁移/聊天模型合同。
- `f923b98fd51088c68ad2390052634f2d013fbdc6` 增加最早核心用户表迁移，保持已发布迁移不可变；初始化缓存按数据库 URL 绑定。生产 Agent 授权与数据所有权逻辑未放宽。
- 修复后迁移相关专项 `12 files / 97 tests` 全部通过；完整真实 PostgreSQL 全仓 `570/570` 文件、`4030/4030` 测试通过，失败与跳过均为 `0`。
- `pnpm doctor`、`pnpm ts-check`、`pnpm lint:build`、Next.js 生产构建 `116/116`、保护基线 `38/38` 和空白检查通过。Lint 仅输出大文件转译提示，没有错误。
- **回归结论：V588-CHAT-003 的本地 PostgreSQL 迁移与并发阻塞已关闭。** Coze 尚未运行包含该提交的精确 `main`，因此云端冷启动迁移、认证和历史项目恢复继续待验；删除、未同步离页、多标签与跨账号边界也未因此自动关闭。

### Coze 精确 SHA 冷启动与历史数据回归

- Coze 已精确对齐 `main@4793f602161d389eaf28bd8ecbc98ddbeb8df7d8`，tree 为 `035017ebe6f8cca1a7aab06c926447428885f35c`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰，工作区干净。
- 项目管理迁移与 `pnpm build` 退出码为 0，Build ID `ff5BAPW-3ycPVraxauIYN`；5000 PID `2939`。根页、Simple Chat、认证接口和 11 个 HTML 静态资源均为 HTTP 200。
- Google Chrome“用户1”刷新现有预览标签后，专用 `projectId=sodi90k3mtaqb72j`、`taskId=b4h25r5tmtaqckwr` 精确恢复；历史标记严格 1 次、状态“已同步”、模型 `Deepseek V4 Flash`，无原生弹窗。
- 工作台首次渲染直接显示“智能对话 2”，专用项目仍为 2 个任务；没有经过登录页或无限画布。首次返回工作台捕获一次 `[Sync] syncToServer: server returned 502`，随后进入对话项目和再次恢复精确任务均无新增 Console error/warning，数据未丢失。
- **回归结论：本地 PostgreSQL 与 Coze 冷启动/恢复边界通过，保留一次未复现的重启后同步 502 观察项。** V588-CHAT-003 仍需关闭删除不复活和未同步离页；多标签与跨账号因既定环境约束继续未验证。

### 删除、离页冲刷与页面完整性增量回归

- 专用空任务 `dx41teo2mtaqb72j` 删除后，经真实 Chrome 刷新、返回工作台和重新进入项目均未复活；专用项目任务数从 `2` 稳定为 `1`，保留任务与历史标记均未受影响。删除不复活边界通过。
- 严格离页标记 `V588_CHAT_003_PAGEHIDE_20260827_C` 提交后立即浏览器后退到工作台；重新进入同一任务时用户消息严格 1 条，先显示“正在同步”后收敛为“已同步”，再次刷新仍严格 1 条。未同步用户写入的 `pagehide` 冲刷通过。
- 立即离页后该标记没有助手回复，说明用户消息持久化通过，但供应商生成任务不会在离页后续跑。该行为单列为待定义/待验边界，不能被误写成“助手任务恢复通过”。
- 云端页面不完整稳定定位为关闭的模型列表仍贡献约 `2415px` 高度，使根容器从 `863px` 撑到 `2484px` 并自动滚动 `518px`。TDD 修复仅把两处关闭态改为 `hidden`；RED `1 failed / 4 passed`，GREEN `5/5`。
- 修复后本地 Simple Chat 为 `493/493`，全仓非 PostgreSQL运行 `3912/3912` 已执行项通过；TypeScript、零错误 Lint、生产构建 `116/116` 和保护基线 `38/38` 通过。119 项数据库专项跳过没有计为通过，同候选先前真实 PostgreSQL `4030/4030` 证据继续有效。
- `main@483ee0ce` 已在 Coze 构建并启动。Chrome 强制刷新后页面根容器为 `863/863/0`（clientHeight/scrollHeight/scrollTop），输入框聚焦后不变；两个关闭菜单高度为 0。聊天菜单正常展开，图像菜单有界显示并内部滚动，侧栏、顶部栏和历史消息全程可见。
- 修复后截图为 `docs/testing/evidence/v588-chat-003-simple-chat-hidden-menu-overflow-cloud-after-2026-08-27.png`；Console 无应用 error/warning，原生弹窗为 0。
- **回归结论：删除不复活、未同步用户写入离页冲刷和页面完整性缺陷均已云端通过。** 多标签、跨账号和离页后助手任务续跑仍未关闭。

### 双标签冲突、账号隔离与中断终态最终回归

- 原始 `V588-CHAT-003` 规格不包含后台聊天任务队列。严格离页后的助手消息按既有恢复合同收敛为单一 `failed + retryable`，标记 `V588_CHAT_003_PAGEHIDE_20260827_C`、唯一重试按钮和“已同步”在刷新后保持；该项通过，不再误列为“后台续跑待验”。
- 未新建 Chrome 标签页，而是临时复用现有 Coze 项目标签作为第二业务标签。两标签同版本并发新增不同任务，刷新后均得到 `3` 个任务；同一任务并发重命名后，两端一致显示 `V588-TASK-CONFLICT-B` 与 `V588-TASK-CONFLICT-A（冲突副本）`，总任务数为 `4`。
- 同一 Chrome 标签从 `canvas-user` 切换为真实管理员 `Mr.joker` 后，普通用户两个专用项目均不可见，管理员只读取到自己的 1 个默认项目，且同步状态为“已同步”。
- 两个业务标签应用 Console error/warning 均为 `0/0`，无原生错误弹窗；项目标签随后恢复到 Coze 项目页。
- **回归结论：V588-CHAT-003 云端矩阵通过并完成吸收。** 证据为 `docs/testing/evidence/v588-chat-003-final-cloud-matrix-2026-08-27.json` 及同目录两张新增 PNG。下一项进入 `V588-CHAT-004`，不重复 Stage 4 或 CHAT-003。

## 2026-08-27 V588-CHAT-004 首轮云端回归

- Coze `main@3f0564429ae100448d17343b5d18ccf58b933e9d` 构建成功并重新启动 5000；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- 文本空工作流为 `1` 节点，重复转交和刷新后仍为 `1`；托管图片消息导入后为 `2` 节点，刷新后仍为 `2`；已有工作流从 `1` 节点追加到 `3`，刷新后仍为 `3`。
- 节点图片真实显示，节点属性包含 chat project、model、provider 与时间；“添加到画布”真实出现目标图片，刷新并重新选中后来源徽标仍存在。
- 受控普通工作流基线为“新工作流、2 节点、1 连线、80%”；转交后为 4 节点、1 连线、80%，两个 `CHAT004` 基线节点和名称均保留，刷新后完全一致。
- 普通账号 `canvas-user` 新建并同步自有画布后，文本消息转交得到 1 节点、0 连线；对管理员项目的真实云端交接 API 返回 HTTP 403 与 `FORBIDDEN`，未暴露或修改管理员项目。
- 畸形交接参数未触发工作区解析或素材转移请求，已有工作流不变。本轮已执行流程的 Console error/warning 为 `0`，完成后的 URL 不含原始媒体地址。
- **回归结论：CHAT-004 已执行项通过，整项仍未吸收。** 未验证项仅剩 URL-only 未托管历史媒体。另发现独立 `NODE-003` 预设入口失效，不归入 CHAT-004 已通过链路。证据见 `docs/testing/evidence/v588-chat-004-cloud-matrix-partial-2026-08-27.json`。

## 2026-08-27 V588-CHAT-004 URL-only 最终云端回归

- 通过正式 `chat_simple_projects` CAS 同步接口创建单一 URL-only 旧格式消息，没有直接数据库注入或 Mock；Google Chrome 用户1真实显示禁用的“添加到画布”和可用的“发送到节点模式”。
- 目标项目基线为 1 节点、0 连线、0 图片；首次转交后为 2 个 `input-text` 节点、0 连线、0 图片，项目数据不含测试外部 URL。
- 解析 API 实测 HTTP 200、178 ms、`images=[]`、`warnings=[UNMANAGED_IMAGE_SKIPPED]`，响应不含外部 URL；解析器没有远程读取路径。
- 重复转交并刷新后仍为 2 节点、0 图片；测试对话项目已以 revision 28 -> 29 的 CAS 写入清理，复查剩余 0 项。
- **回归结论：V588-CHAT-004 的 11 项云端矩阵全部通过并完成吸收。** `NODE-003` 仍是独立 P2，不因本项关闭而自动修复；全平台总发布状态继续“有条件通过”。证据：`docs/testing/evidence/v588-chat-004-final-cloud-matrix-2026-08-27.json`。
## 2026-08-28 V588-STABILITY-002 本地回归

| 门禁 | 结果 | 证据 |
|---|---|---|
| PSD 专项与关联安全/账务测试 | 通过 | `8` 个核心文件、`131` 项通过；PostgreSQL 并发专项因缺少隔离库明确跳过 |
| TypeScript | 通过 | `next typegen && tsc -p tsconfig.json` 退出码 0 |
| 全仓 ESLint | 有条件通过 | `0 errors / 964 warnings`；均为历史存量 |
| 本次修改/新增 TypeScript 文件 ESLint | 通过 | `--max-warnings 0`，零错误、零警告 |
| 全仓 Vitest | 通过 | `565` 文件通过、`21` 跳过；`4068` 项通过、`119` 跳过；零失败 |
| 生产构建 | 通过 | Next.js 16.2.11 webpack 编译、TypeScript、117 个静态页生成和构建追踪完成 |
| 差异完整性 | 通过 | `git diff --check` 无空白错误；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化 |

回归范围覆盖请求流体积、非法字段、幂等键、data URL、跨用户资产、符号链接逃逸、MIME/字节/像素、模型授权、显式不回退、自动候选去重、总截止、JSON/SSE 预算、持久任务复用、租约过期接管、晚到租约清理、终态重放、结算重试、鉴权顺序、错误码和客户端单请求。八轮独立复审最终无 Critical/Important。当前不能把本地结果扩大为真实 PostgreSQL 或 Coze 通过。

## 2026-08-28 V588-STABILITY-002 图片双击入口本地回归

| 门禁 | 结果 | 证据 |
|---|---|---|
| 失败复现 | 通过 | Coze `4c7dc72d` 中首次选中导致 DOM 目标切换，真实 Chrome 双击只选中、不打开预览；新增 helper 合同修复前 RED |
| 聚焦回归 | 通过 | `canvas-selection` 与画布接线合同共 `16/16` 通过 |
| TypeScript | 通过 | `pnpm ts-check` 退出码 0 |
| 改动文件 ESLint | 有条件通过 | 0 errors；`infinite-canvas.tsx` 保留 18 条历史 warning，无新增 warning |
| 全仓 Vitest | 通过 | `565` 文件通过、`21` 跳过；`4071` 项通过、`119` 跳过；零失败 |
| 生产构建 | 通过 | Next.js 生产构建及 `117/117` 静态页面/路由通过 |
| 分支边界 | 通过 | `main@6bea240f` 已推送；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化 |

本轮只修复图片预览入口的跨重渲染双击识别，不改 PSD 分析、供应商、积分、任务或导出逻辑。Coze 精确 SHA、真实双击 UI 和后续付费 PSD 链路仍待云端证据。
## 2026-08-28 V588-STABILITY-002 图片预览云端回归

- Coze 运行 `main@2e1e21e2856e91e6bf1ed1af83aed68610d35c8c`；该提交包含 `6bea240f` 双击修复，代码树为 `9647c2951b8d128e3cdd20d29b5202472bbd29f7`，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变。
- Google Chrome 复用现有预览标签，在轻量项目加载 1 张 `3504 x 2336` 真实图片。单击只选择；双击一次打开且只打开一个图片预览；关闭后预览消失。真实拖动 `24 x 16px` 未误开预览，`Ctrl+Z` 后坐标差恢复为 `0 x 0`。
- 预览可见 `PNG / SVG / PSD` 导出入口。当前 `PSD` 按钮调用既有 Pro 导出；本专项规格不调整导出 UI，因此没有把 Studio 独立按钮作为本轮通过条件。
- 浏览器 Console error/warning `0/0`，原生弹窗为 0。截图和机器结果保存在 `docs/testing/evidence/v588-stability-002-image-preview-cloud-2026-08-28.*`。
- **回归判定：图片预览入口 PASS；V588-STABILITY-002 整项仍为 CONDITIONAL。** 付费 Pro PSD、同键重放、账务和 PostgreSQL 竞争仍未执行。

## 2026-08-28 V588-STABILITY-002 PostgreSQL 并发回归

| 门禁 | 结果 | 证据 |
|---|---|---|
| PSD PostgreSQL 专项 | 通过 | 全新隔离库中 `3/3`：相同请求并发、同键异摘要、四终态竞争与退款一致性 |
| 关联数据库矩阵 | 通过 | PSD、批注、Pear 分层、元素拆解、服务与路由共 `11 files / 92 tests`，0 失败、0 跳过 |
| 全仓真实 PostgreSQL | 通过 | `587/587 files`、`4193/4193 tests`，0 失败、0 跳过，495.37 秒 |
| CI 永久门禁 | 通过 | 工作流契约先 RED `11/12`，加入 PSD 数据库测试后 GREEN `12/12` |
| TypeScript | 通过 | `pnpm ts-check` 退出码 0 |
| ESLint | 通过 | `pnpm lint:build` 退出码 0；没有新增 error |
| 生产构建 | 有条件通过 | 默认约 4 GiB Node 堆 OOM；8 GiB 堆完成编译、TypeScript、`117/117` 静态页面和构建追踪 |

数据库证据关闭了“本地没有真实 PostgreSQL”的旧缺口，但不代表云端第三方供应商或生产账务已经通过。真实 Pro PSD、同键重放、失败退款和最终文件仍保留为云端门禁。机器证据：`docs/testing/evidence/v588-stability-002-postgres-local-2026-08-28.json`。

## 2026-08-28 Pro PSD 异步分层客户端回归

| 检查项 | 结果 | 证据 |
|---|---|---|
| 云端旧链路复现 | 失败已确认 | `/api/layered-decompose` HTTP 400 `LAYER_IDEMPOTENCY_INVALID`；旧回退 HTTP 501；无供应商 taskId |
| 下载文件辨识 | 通过但仅属回退 | `Image_pro.psd` 为有效 `8BPS`，`3504 x 2336`、9 个组/图层；不得记为供应商成功 |
| TDD RED/GREEN | 通过 | RED 覆盖持久客户端、15 秒截断、URL 图层物化、裁剪图层尺寸/偏移和禁止第二远程任务；GREEN 专项矩阵 `34/34` |
| PostgreSQL 账务竞态 | 通过 | 隔离 PostgreSQL 18.4 下 `5/5`，无跳过 |
| 全仓测试 | 通过 | `588/588 files`、`4195/4195 tests`、0 失败、0 跳过，耗时 `617.98s` |
| TypeScript / ESLint | 通过 | `pnpm ts-check`、`pnpm lint:build` 均为退出码 0 |
| 生产构建 | 通过（资源条件） | `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`，117/117 路由；编译约 14.4 分钟 |

本轮只证明修复候选在本地完整通过。Coze 尚未拉取该候选，因此真实供应商任务、一次扣费、进度阶段与最终远端图层 PSD 仍需部署后重测。

## 2026-08-28 Pro PSD 耐久客户端终审回归

- 入口已统一到共享异步分层客户端；不再保留裸请求、15 秒截断或第二条远程付费回退。
- 浏览器可计费提交要求 WebCrypto、localStorage 与 Web Locks 同时可用。每张源图维护独立恢复记录，幂等键按代次稳定生成；模糊响应沿用原键，成功或明确终态才推进下一代。
- provider/model 在首次提交前冻结；服务器返回 taskId 后立即持久化。模块重载直接恢复该 taskId，跨标签旧代写入不能覆盖新任务。
- 远程裁剪图层的源尺寸与绝对偏移贯穿适配器、Canvas 命中、检查器和最终 PSD 组装，避免双重偏移或拉伸；Studio 路径保留阴影与效果组。
- 聚焦矩阵 `10 files / 80 tests` 通过；全仓在全新 PostgreSQL 18.4 隔离库下为 `588 files / 4213 tests` 全部通过，失败与跳过均为 0；`pnpm lint:build`、`pnpm ts-check` 均退出 0。
- 8 GiB 堆生产构建以 `0` 退出：webpack 编译约 `13.7min`，TypeScript 完成，静态页面 `117/117` 生成；约 4 GiB 默认堆的既有 OOM 资源约束仍保留。
- **回归结论：本地代码、真实数据库并发和恢复合同通过；云端仍为未吸收。** 旧云端 400 + 本地回退证据继续有效，不能替代部署后真实 provider task、一次扣费、同键重放、失败退款和最终 PSD 图层证据。

## 2026-08-28 ac8e826b 云端部署与付费前回归

| 检查项 | 结果 | 证据 |
|---|---|---|
| Git 精确对齐 | 通过 | `HEAD=origin/main=ac8e826b34f91649c47cefd504d9d6664ee12eb8`；tree 均为 `b05448edae7126ac0833c28f2ee552c9c200c320`；`stable@52f7c601` 未变 |
| Coze 生产构建 | 通过 | 退出码 0，Build ID `VALgz1-sdVe-tiy5Jz8yU` |
| 单服务启动 | 通过 | `scripts/coze-start.sh`，5000 PID `4372` |
| 路由与静态资源 | 通过 | `/`、`/simple-chat`、`/api/auth/me` 均 200；11 个 JS/CSS 失败 0 |
| 已登录预览恢复 | 通过 | Chrome 现有标签恢复节点模式、画布与项目数据，真实图片可选择 |
| Pro PSD 入口 | 通过到提交前 | 双击真实图片打开预览，`PSD` 按钮可见且可用；30 秒静置窗口项目同步成功，新增 Console error/warning `0/0`；未点击付费按钮 |
| 重启瞬时同步 502 | 已观察并恢复 | 重启窗口产生警告，随后读取与同步连续成功；最新窗口无应用 Error |
| Pear ZIP/PSD 终态 | 未执行 | 等待付费动作时确认，不能标记通过 |

本次机器证据为 `docs/testing/evidence/v588-stability-002-ac8e826b-cloud-deploy-2026-08-28.json`。回归结论仍为“有条件通过”：部署前缀已关闭，但真实 Pear 远程图层、同键重放和云端账务终态尚未关闭。

## 2026-08-28 ac8e826b 真实 Pear 失败回退回归

- 真实 Pro PSD 点击已执行，应用任务 `layer_bde7c937-ecdb-4fee-b901-54c834aeb1f0` 快速建立并绑定 Pear 任务 `6bbcd3f8-1d11-41be-8866-40fba1bfb479`；浏览器没有同步请求超时或原生错误弹窗。
- Pear 本次在制品生成前返回“任务处理失败，请稍后重试”，数据库没有 `remoteArtifactUrl`，因此没有进入 ZIP Range 下载与主 PSD 提取阶段。
- `smart` 模式原子切换到本地回退并完成：唯一扣费 `-15`、唯一退款 `+15`，最终余额净变化为 0；任务为 `completed/ready/refunded`。
- 本地回退下载文件 `25,495,074` 字节，SHA-256 `73731e7a...ffdb711`，`8BPS` 可解析，尺寸 `3504 x 2336`，5 个顶层项、共 11 个组/图层。
- **回归判定：失败回退 PASS，远程 Pear 成功路径 UNVERIFIED。** 不能把可打开的本地 PSD 当作 ZIP 下载修复通过证据；仍需一次供应商真实产出 ZIP 的独立验收。

## 2026-08-28 Pear 失败可观测性本地回归

- 官方接口复核确认当前提交与轮询协议正确；本次真实失败更符合供应商任务终态，不应猜测性切换接口或制造第二次付费提交。
- 两项回归先稳定 RED：官方 `error.code/type/param` 被适配器丢弃；智能回退完成后诊断被最终结果覆盖。最小实现后两项转绿，既有 21 项并发与适配器回归未回退。
- 分层全矩阵 `5 files / 55 tests` 通过；全仓非 PostgreSQL `566 files / 4099 passed / 122 skipped / 0 failed`。跳过项均因本轮未配置隔离 `POSTGRES_TEST_DATABASE_URL`，不计作通过；此前同日真实 PostgreSQL 全仓证据继续有效，但不由本次运行重复声明。
- `pnpm ts-check`、`pnpm lint` 均通过。默认约 4 GiB Node 堆在 webpack 优化阶段 OOM；`NODE_OPTIONS=--max-old-space-size=8192` 后编译约 12.7 分钟，TypeScript 和 `117/117` 页面生成完成。
- **回归判定：Pear 失败诊断本地 PASS；远程成功路径仍 UNVERIFIED。** 本修复仅提升错误归因，不把供应商失败改写为应用失败，也不关闭 ZIP Range、主 PSD、远程图层、同键重放或取消退款门禁。

## 2026-08-28 ca356477 Coze 云端回归增量

- Coze 精确对齐 `main@ca3564779685be52f1dc13b8f0106f27095647f9`，tree 为 `2e6030b31c1b1a4399275bf51919daa28b0eae53`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- 云端非付费专项 `23/23` 通过；生产构建退出码 `0`，Build ID `xzK65dcSQKxZk2kJiNVk0`，三个健康路由和 `11/11` 静态资源通过。
- Google Chrome 强制刷新后节点项目恢复，工作流工具栏可见；新刷新窗口 Console error/warning `0/0`。重启过程短暂项目同步 502 已在后续同步成功并经干净刷新排除为当前持续故障。
- **结论：`ca356477` 部署和非付费诊断门禁通过。** 本轮未触发真实 Pear 任务，不证明真实结构化错误、ZIP Range、主 PSD、远程图层、同键重放或显式取消退款。
- 证据：`docs/testing/evidence/v588-stability-002-ca356477-cloud-deploy-2026-08-28.json`、`docs/testing/evidence/v588-stability-002-ca356477-cloud-refresh-2026-08-28.png`。

## 2026-08-28 ca356477 云端同键重放回归

- Google Chrome 复用现有已登录预览标签，以完全相同的请求体、请求摘要和幂等键重放图片分层。HTTP `202` 返回同一应用任务 `layer_bde7c937-ecdb-4fee-b901-54c834aeb1f0`，没有进入新的供应商等待阶段。
- 重放后只读审计证明：同键任务数仍为 `1`，用户余额仍为 `403`，扣费与退款流水各仍为 `1`，交易 ID 和 Pear 远端 taskId 均未变化。
- **回归判定：云端应用侧同键重放 PASS。** 远程 ZIP Range、主 PSD、远程可编辑图层、自然失败结构化错误和显式取消退款仍为 `UNVERIFIED`；专项整体继续有条件通过。
- 机器证据：`docs/testing/evidence/v588-stability-002-ca356477-idempotency-replay-2026-08-28.json`。

## 2026-08-28 a50fcbeb 方案 C 本地回归

- 以 `main@bd6cb16a` 为基线按 RED → GREEN 修复 PSD 分层提交注册与取消竞态，形成实现提交 `a50fcbeb73803b9886bab2ec82327c1e8f5bb209`。
- 16 条真实组件状态测试覆盖：taskId 返回前取消/关闭、重复点击、前台取消期间卸载、taskId 前后卸载、网络响应丢失、401/409 恢复、成功目标与空目标冻结、终态竞争、取消失败重试和 keepalive。
- 最终 provider/model 解析结果连同“已解析为空”状态进入冻结快照；挂载和卸载恢复均复用同一幂等键与同一请求体。取消 Promise 在关闭、重复点击和外部卸载之间共享，避免并发重复 DELETE。
- 最终专项 `26/26`，分层与安全下载矩阵 `168 passed / 2 skipped`，全仓 `4117 passed / 122 PostgreSQL-gated skipped / 0 failed`；TypeScript、目标 ESLint、`git diff --check` 和 8 GiB 生产构建通过，构建生成 `117/117` 页面。
- 并行 Range 加固三部分已在 `ac8e826b` 进入当前 main，且是 `a50fcbeb` 的祖先，不再重复合并。其他并行候选均落后当前 main 或缺少 PostgreSQL/Coze/真实供应商证据，本轮不合并。
- **回归判定：本地方案 C PASS，云端显式取消与退款仍 UNVERIFIED。** 不以本地 mock 或构建替代 Coze 真实任务、账务和远程 ZIP 证据。

## 2026-08-29 Pear ZIP、取消退款与图层顺序回归

- Coze 精确运行 `3bdfe334` 后，任务 `layer_bc4b0371-956c-40b7-8c0d-00b726c9e666` 在取得应用 taskId 后立即取消，最终唯一 `cancelled/LAYER_TASK_CANCELLED`；余额和累计使用在前后均为 `403/3917`。该证据关闭“取得 taskId 后立即取消与退款”，不扩大为响应前关闭/卸载。
- 第二个真实任务 `layer_be958ed4-b5d4-4afa-865d-f960a4fd8c85` 快速返回应用 taskId，并越过供应商等待、ZIP 下载和主 PSD 提取，进入 `checking-quality`；最终因 `LAYER_QUALITY_FAILED` 退款回基线。由此确认 ZIP 默认输出已被处理，编辑器失败点位于应用重建质量门禁。
- `ag-psd` 明确规定图层为 Photoshop 从上到下顺序、绘制需反向。首轮两个 RED 分别复现质量门禁误判和 25% 像素被背景覆盖；独立复审又以第三个 RED 复现 Pear 与本地重建层混合时的同类覆盖。最终规则反转 Pear 原始层、保持本地普通层顺序，并让重建修正/参考层最后绘制。
- 绘制顺序专项 `9/9`，覆盖纯 Pear、Pear 与本地修正层混合、隐藏 Pear 层，以及纯本地图层顺序保持。
- 最终分层矩阵 `75/75`；全仓 `4154 passed / 122 PostgreSQL-gated skipped / 0 failed`；TypeScript、零错误 ESLint 通过。8 GiB 构建在 webpack `15.8` 分钟后完成 TypeScript、`117/117` 静态页面和追踪。
- **回归结论：ZIP 下载与主 PSD 提取已取得真实证据，图层顺序修复仅本地通过。** 在 Coze 部署新提交并打开至少 2 个可编辑远程图层前，Pear 成功终态和 `V588-STABILITY-002` 继续为未关闭。

## 2026-08-29 `940a0b7f` Coze 部署与非付费回归

- Coze 已精确对齐 `HEAD=origin/main=940a0b7fdabd9327b75d3b8963c5eee4ec3b0f8c`，tree 均为 `671817ee823aeb690c8ed8067372090f71d65583`；工作区干净，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- 7 个 Pear 分层专项文件共 `53/53` 通过，未触发真实供应商任务。生产构建退出码 `0`，Build ID `TUepofVA2ahBpz5Izw2Fj`，5000 PID `4332`；三个健康端点和 `11/11` HTML 引用静态资源均成功。
- Google Chrome 复用既有预览标签刷新后保持管理员登录，工作区、画布图片和“元素拆解 → 可编辑图层”入口均可访问；没有新建标签，也未使用 360 浏览器。
- **回归判定：exact-SHA 部署 PASS，Pear 成功链路仍 UNVERIFIED。** 只有一次经明确扣费授权的真实任务达到 `completed/ready`、打开至少 2 个远程可编辑图层并通过账务审计后，才关闭本项。
- 机器证据：`docs/testing/evidence/v588-stability-002-940a0b7f-cloud-deploy-2026-08-29.json`。

## 2026-08-29 `940a0b7f` 真实 Pear 成功与浮层关闭回归

- 经 15 积分明确授权，Google Chrome 在既有标签只提交一次 `Pear / Image-Layered / cloud` 任务；状态由 `processing · 5%` 收敛到 `completed · 100%`，PSD 编辑器自动打开。
- 编辑器显示 5 个云端图层：校正层、两个元素层、主体和背景。主体/背景可独立选择，主体可独立显隐；隐藏 `reconstruction/correction` 后杯子画面仍由底层图层呈现，排除了“只有整图覆盖层”的伪成功。
- 同一流程稳定复现完成后元素拆解浮层无法关闭。RED 契约测试先得到 `1 failed / 6 passed`；将显示条件从任务对象解耦后 `7/7` 通过，扩展 Pear/分层矩阵 `64/64` 通过。
- 最终本地门禁：全仓 `572 files / 4154 passed / 122 PostgreSQL-gated skipped / 0 failed`；TypeScript 通过；ESLint `0 errors / 961 historical warnings`；8 GiB 生产构建完成 `117/117` 页面。
- **回归判定：Pear ZIP 到 5 个可编辑图层的云端成功路径通过；BUG-008 本地通过、云端待验。** PSD 下载、真实图层拖动和数据库一次扣费/零退款仍未验证。
- 机器证据：`docs/testing/evidence/v588-stability-002-940a0b7f-cloud-deploy-2026-08-29.json`。

## 2026-08-29 Pear 云端终态纠正与旧 PSD 状态回归

- 管理员云任务响应推翻了上一节的“远程成功”判断：对应任务 `layer_be958ed4-b5d4-4afa-865d-f960a4fd8c85` 实际为 `failed/checking-quality`，扣除 15 后唯一退款，净积分为 0；上一节仅保留为当时的 UI 观察记录，不再作为通过证据。
- 同一制品的 ZIP、非 `_depth` 主 PSD、`8BPS` 解析和 6 个像素图层均通过，说明 ZIP 链路可用。生产质量门禁离线复现为：源图 `3504x2336`、PSD `1280x1280`、MAE `0.7853434784673393`、得分 `21`，失败来自供应商改变尺寸/比例，不是解压或图层顺序。
- 新增 BUG-009 RED：全局关闭和直接重新打开 PSD 编辑器时会残留旧 `initialResult`。仅补两处清理后单文件 `8/8`、分层聚焦矩阵 `44/44`、全仓 `4155 passed / 122 PostgreSQL-gated skipped / 0 failed`；TypeScript、零错误 ESLint 和 `117/117` 生产构建通过。
- **回归判定：Pear ZIP/主 PSD 消费 PASS；远程完成、图层编辑、成功扣费 FAIL/UNVERIFIED；旧结果串用本地 GREEN、云端待验。**
- 机器证据：`docs/testing/evidence/v588-stability-002-pear-audit-correction-2026-08-29.json`。

## 2026-08-29 `128ec13b` 干净 main 来源追溯回归

- Coze 在 `89c2f12c` 的干净检出中真实复现唯一全量失败：来源授权引用的 `9a9fb8b` 不在 `main` 历史；同轮专项 `96/96`、TypeScript、Lint、生产构建和健康检查均通过。
- 本地 RED 增加来源必须属于 `HEAD` 祖先链的永久断言，随后识别出共 30 条不可达记录；29 条按相同文件 blob 映射，`generation-panel.tsx` 映射到同作者时间和标题的 `cce434a1`。
- 修复后来源不可达计数为 `0`，聚焦门禁 `7/7`，V5.8.8 清单与证据测试 `8/8`；全仓 `572` 个文件通过、`4159` 项通过、`122` 项 PostgreSQL 专项明确跳过、`0` 失败。
- TypeScript 与构建版 Lint 通过。业务源码、数据库、账号、供应商配置和 `stable` 均未修改。
- `check:protected-baseline` 仍报告 41 个既有未授权业务漂移，维持阻止发布；该项必须按路径审计，不能通过本次来源修复顺带放行。
- **本地判定：BUG-012 PASS；Coze 干净检出回归 PENDING。**

## 2026-08-29 V588-STABILITY-002 `90231c70` 云端增量

- Coze 已精确运行 `main@90231c70f7dacca43eb5e8ccd688c8204d12f3fe`，tree `a6dbe58d477112b7f2d0df205892efb0b34b428e`，Build ID `6-RXcDf1VQ8054PNXPhF5`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- Google Chrome 先在单图项目复验，再进入 7 图项目依次选择 `3504 x 2336` 蓝色杯子和 `1254 x 1254` 紫色立方体。两次打开“编辑元素”均只显示干净初始态，旧图层计数为 `0`；Console error/warning `0/0`，无原生弹窗。BUG-009 云端关闭。
- 本次未调用供应商、未创建新任务、未扣积分。机器证据：`docs/testing/evidence/v588-stability-002-90231c70-bug-009-cloud-2026-08-29.json` 与同名前缀 PNG。
- BUG-008 仍未关闭：验收必须由真实完成态父任务驱动；空面板关闭不计。当前 Pear 分层与 Pear GPT Image 2 定价均为 `60` 积分/图。

## 2026-08-29 `805e695d` BUG-008 云端完成态回归

- Coze 精确运行 `main@805e695d9a621bf1b1f6505cd28e5818416c573b`，tree `2d1fdf737d2e201dc63e56af763a2d1f7af2d1c2`，Build ID `tRbCDehbN-Px9OoY0qHRH`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变。
- 云端专项 `45/45`、TypeScript、Lint、构建、三个健康端点和 `11/11` 静态资源通过。全量测试为 `570 passed / 2 failed / 22 skipped`；2 项失败属于 Coze 域名环境下的 `auth-login-configuration` 断言，未隐藏也未标为全量通过。
- Google Chrome 真实执行零积分“可编辑图层”，PSD 编辑器显示 `主体/背景` 两层；关闭元素面板不关闭编辑器，关闭编辑器后重开元素面板仍显示 `completed · 100%`。
- **回归判定：BUG-008 PASS。** 同轮新增 P2 BUG-010：完成态重开面板视觉上被画布媒体遮挡；数据未丢失，但 UI 不可接受，单独保持开放。
- 机器证据：`docs/testing/evidence/v588-stability-002-805e695d-bug-008-cloud-2026-08-29.json`。本轮 Chrome 截图已用于视觉判断但未成功导出本地文件，BUG-010 修复验收必须补齐 PNG。

## 2026-08-29 BUG-010 本地回归

- 先以测试稳定复现元素拆解面板仍位于画布裁剪上下文，随后将面板最小改为 `createPortal(..., document.body)`。
- `element-decomposition-ui`：`10/10`；元素拆解专项：`46/46`；全量 Vitest：`572` 个文件、`4157` 项通过、`122` 项 PostgreSQL 专项明确跳过、`0` 失败。
- TypeScript、构建版 Lint、生产构建均通过；`git diff --check` 通过。
- **本地判定：PASS。云端判定：PENDING。** 尚需新 SHA 部署后的 Google Chrome 无遮挡截图、关闭/重开与 Console/网络回归。

## 2026-08-29 `b0eefdf4` BUG-010 云端回归

- Coze 精确对齐 `main@b0eefdf4cfc4c8e8ca9ef0ae2c4e236d26100f0e`，tree `85358ca47fd0dfee0f469800bd2643574498503f`；`stable@52f7c601` 未变。
- 云端专项 `46/46`、TypeScript、Lint、生产构建、`/`、`/simple-chat`、`/api/auth/me` 和 `11/11` 静态资源通过。
- Google Chrome 初始态、完成态和完成态重开三轮视觉检查均完整无遮挡；完成状态 `completed · 100%` 保留，PSD 编辑器保持独立关闭行为并显示 `主体/背景` 两层。
- DOM 实测浮层父节点为 `BODY`、不在画布 viewport 内、`z-index=200`。**BUG-010 云端回归 PASS。**
- 证据：`docs/testing/evidence/v588-stability-002-b0eefdf4-bug-010-cloud-2026-08-29.json` 及同前缀三张 PNG。账务探针超时，未把视觉通过扩张为账务通过。

## 2026-08-29 Coze 域名测试合同本地回归

- 使用外部 `COZE_PROJECT_DOMAIN_DEFAULT=preview.example.dev.coze.site` 运行登录契约测试，修复前稳定得到 `3 failed / 34 passed`，失败均为测试硬编码 localhost 与正确公网重定向不一致。
- `beforeEach` 隔离宿主域名后，同一命令 `37/37` 通过；专用公网域名与 Secure Cookie 用例仍通过，没有修改登录路由、凭据、Cookie 或会话逻辑。
- 仓库回归：Vitest `572` 个文件、`4157` 项通过、`122` 项 PostgreSQL 专项跳过；TypeScript、构建版 Lint、`git diff --check` 通过。
- 生产构建第一次在约 4 GB Node 堆上限 OOM；8 GB 重试在约 7.74 GB 工作集仍未完成并被人工终止。**本地测试合同判定 PASS；生产构建与 Coze 原生环境复验仍 PENDING。**

## 2026-08-29 `4d0ee0d7` Coze 域名测试合同云端回归

- Coze `HEAD=origin/main=4d0ee0d7178a7d8c1326e1834fe4d62ee86326d5`，工作树干净；`origin/stable=52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- 在 Coze 原生公开域名环境执行登录契约测试，`37/37` 通过；TypeScript、构建版 Lint 和 8 GB 生产构建均以退出码 0 完成，Build ID `aSKtExrAPjz-iBkM5RZmg`。
- 重启后 `/`、`/simple-chat`、`/api/auth/me` 均为 200，HTML 引用静态资源 `11/11`；Google Chrome 现有预览标签刷新完成并显示入口页。
- **云端判定：PASS。** 此门禁从未验证项移除；机器证据：`docs/testing/evidence/v588-stability-002-4d0ee0d7-auth-domain-cloud-2026-08-29.json`。

## 2026-08-29 `2166f032` 元素拆解 Pear 精确路由本地回归

- RED 先证明元素拆解父请求不会为 layers 分支解析当前用户获授权的 Pear `Image-Layered`，UI 也没有等待解析后再提交。
- GREEN 后，`createResolvedElementDecompositionRequest()` 在需要远程图层且缺少显式目标时只读 `/api/workflow/models?type=layer`，并把解析到的 `providerId + modelId` 冻结进父请求；显式 pair、仅物料板、本地引擎和 smart 回退边界均有回归。
- 聚焦回归共 10 文件 `98/98`；全仓 `572` 个文件、`4159` 项通过、`122` 项因缺少隔离 PostgreSQL 测试库跳过、`0` 失败；TypeScript 和构建版 Lint 通过。
- 8 GiB 首轮在工作集约 `8.17 GB` 时未完成；使用 12 GiB Node 堆重新执行同一 `pnpm build` 后，webpack `16.9` 分钟编译成功，TypeScript 通过，静态页面 `117/117`，Build ID `BEGTUtSa2MLS18fd4_yW6`。**本地功能与生产构建 PASS；云端行为 PENDING。**
- 云端验收必须在同一次操作中区分：请求目标路由、Pear 异步任务、ZIP/主 PSD、编辑器图层和账务；本地两层 fallback 不得冒充 Pear 成功。

## 2026-08-29 `51a31371` 最终本地生产构建

- 在保护基线精确授权和中文证据均进入 `main` 后，对精确提交 `51a313717df4edb30dc4758b78c476242b7667cf` 使用 12 GiB Node 堆执行完整 `pnpm build`。
- webpack `14.0` 分钟编译成功，TypeScript `65` 秒通过，静态页面 `117/117`，最终退出码 `0`，Build ID `I9uo73xu5yg9CivYsHhRj`。
- 构建期间峰值工作集约 `9.35 GB`，证明默认较小内存仍属于部署容量风险；不应通过缩小检查范围掩盖。
- **最终本地构建 PASS；Coze 干净检出、构建和健康检查仍 PENDING。**

## 2026-08-29 `bf8d8623` 保护基线精确授权回归

- RED 测试先从固定保护基线到 `HEAD` 枚举生产源码漂移，稳定返回 41 个未授权路径。
- 每个路径均完成四项核验：来源提交属于 `main` 祖先链、来源提交修改该路径、来源 blob 等于当前 blob、授权为单一精确路径；结果 `41/41`、失败 `0`。
- GREEN 后聚焦 V5.8.8 门禁 `16/16`；`pnpm check:protected-baseline` 确认 38 个特征 ID 保留、未授权源码漂移 `0`、警告 `0`。
- TypeScript 与构建版 Lint 通过；全量 Vitest 为 `572` 个文件、`4160` 项通过、`122` 项 PostgreSQL 专项因缺少隔离测试库明确跳过、`0` 失败。
- 本次没有生产源码变化，因此复用此前相同业务源码树的本地与 Coze 构建证据；最终发布提交仍必须在 Coze 干净检出中重新执行生产构建和健康检查。
- **本地发布门禁 PASS；Coze 最终提交 PENDING。**

## 2026-08-29 `c3bfc812` Coze 干净 main 完整回归

- Coze 精确对齐 `HEAD=origin/main=c3bfc8123c956b186d0b61beb0bbdc72e92ee673`、tree `b3180959aa35518c013f67409b94339b8619d1a3`，工作区干净，`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- 聚焦门禁 `16/16`，保护基线未授权漂移 `0`、警告 `0`；TypeScript 与 Lint 退出 `0`；全量 Vitest `572` 个文件通过、`0` 失败、`22` 个 PostgreSQL 门禁文件跳过、`4160` 项通过。
- 12 GiB 堆生产构建退出 `0`，Build ID `SuXRLPDiMNsGcudgsyzah`；`scripts/coze-start.sh` 启动单一 5000 PID `17019`。
- `/`、`/simple-chat`、`/api/auth/me` 均为 `200`，静态资源 `11/11`。Google Chrome 稳定态二次刷新后完整工作台可见，边界后 Console `0/0`，无原生弹窗。
- **干净 main 来源追溯与保护基线云端回归 PASS。** PostgreSQL 隔离并发与 Pear 付费编辑/保存/导出账务矩阵仍保持独立未验证，不被本结论扩大覆盖。

## 2026-08-29 唯一 Pear 付费任务与 smart 回退权威回归

- Google Chrome“用户1”在既有标签只提交一次 `Pear / Image-Layered`；任务 `layer_a328d329-ebcb-45f1-8098-53ff27b5a139` 快速进入 `processing · 27%`，没有重复提交。
- Pear 用时 `268555 ms` 返回真实 ZIP；安全下载、ZIP MIME、非 depth 主 PSD 提取和 PSD 解析均已越过。Pear 图层随后因 `RECONSTRUCTION_ERROR_HIGH, DUPLICATE_LAYER_RATIO_HIGH, OUT_OF_BOUNDS_LAYERS_PRESENT` 未通过质量门禁。
- 离线复现将应用问题与供应商问题拆开：源图 `1254x1254` 对 PSD `1280x1280` 造成越界率 `1`，归一到 PSD 坐标后越界率为 `0`；但 MAE 仍为 `0.7125`、重复率为 `0.8621`，29 层大量使用人物部件名，不能通过放宽质量门禁解决。
- smart 模式自动退款并执行本地回退，父任务最终为 `completed/ready/100%`，但实际交付引擎为 `local`、图层为 `背景/主体` 两层；不得把该终态表述为 Pear 远程成功。
- 账务为唯一 `-15` 和唯一 `+15`，余额 `403 -> 388 -> 403`，净积分 0；本轮关闭真实失败退款的一次性证据。
- 新发现价格不一致：管理员预检显示 60，权威任务实际按 15 结算。数据库配置没有 provider/model 专属价格，服务端回退固定 `segment=15`。
- **回归判定：ZIP/PSD 消费 PASS，失败退款 PASS；Pear 远程可编辑成功 FAIL，成功不退款账务与编辑/保存/刷新/导出仍 UNVERIFIED。**
- 机器证据：`docs/testing/evidence/v588-stability-002-pear-smart-fallback-2026-08-29.json`。

## 2026-08-29 Pear 坐标与管理员计价本地回归

- 计价 RED 证明 `Image-Layered` 被管理员目录按普通图片模型显示为 60，而权威 `segment` 结算为 15；GREEN 后 layer 模型目录统一返回 `billingCategory=edit`、`credits=15`、`unit=per-call`。
- 坐标 RED 证明质量门禁缺少源图到 PSD 文档坐标空间的归一化；GREEN 后，同宽高比的 `1254x1254 -> 1280x1280` 会在安全像素限制内归一，不同宽高比不会被强制拉伸。
- 服务层永久回归确认质量门禁与重建检查使用同一归一化源图，避免一个阶段修复、另一个阶段继续误报。
- 聚焦回归 `7 files / 58 tests`；全量 Vitest `572 files / 4163 passed / 122 PostgreSQL-gated skipped / 0 failed`；`pnpm ts-check` 与 `pnpm lint` 均退出 `0`，Lint 为 `0 error / 961 warning`。
- 默认约 4 GiB Node 堆按预期 OOM，8 GiB 在高内存回收阶段停止；按仓库既有 12 GiB 基线重跑后 webpack `14.3` 分钟、TypeScript `65` 秒、静态页面 `117/117`、Build ID `WijIlExen98XOqjcSti5T`、退出码 `0`。
- 受保护计价路由只增加单文件精确来源授权；永久门禁 `8/8`，`pnpm check:protected-baseline` 为未授权漂移 `0`、警告 `0`。
- **本地判定：应用侧坐标误报与管理员价格不一致 PASS。** 远程 Pear 制品质量仍 FAIL；本轮没有再次创建付费任务，也没有把本地 fallback 当作 Pear 成功。

## 2026-08-29 `c79cd0fe` Pear 坐标与计价云端回归

- Coze 精确运行 `main@c79cd0fea3003d5c97f92957de577fcf41d89b7c`、tree `69d703a6329839bb5bd4b272ce505b2b7a70b931`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- 云端分层/保护专项 `70/70`、保护基线 `0` 未授权/`0` 警告、TypeScript、Lint、12 GiB 生产构建和 `11/11` 静态资源通过；Build ID `wj8pRWQN7qQibcQoiHsXy`，5000 PID `4417`，三个健康路由均为 `200`。
- Google Chrome 管理员页面真实显示 `pear分层 / Image-Layered / 每次 / 15`，关闭管理员目录 60 与权威任务 15 不一致的问题。
- 坐标归一逻辑已在云端同一提交的专项测试通过；本轮不重复付费，因此只证明应用侧误报已部署，不能把历史 Pear 错误制品改写为远程成功。
- 稳定刷新后出现 `0` error、`1` 条项目同步 `502` warning，作为独立可靠性观察保留。证据：`docs/testing/evidence/v588-stability-002-c79cd0fe-pricing-coordinate-cloud-2026-08-29.json`。

## 2026-08-29 Pear smart 回退披露本地回归

- 服务与 UI 两个 RED 先稳定复现父任务丢失退款/回退证据以及完成态无披露，结果为 `2 failed / 27 passed`；初次最小实现后同组 `29/29` 通过。
- 两轮独立复核共发现六项兼容与治理缺口：升级前终态父任务缺少披露元数据、非质量失败误报、分支重试提示绕过、历史读取可推进子任务、拆解板重试漏披露，以及保护脚本在大输出时可能假通过。每项均先补 RED 再最小修复。历史终态改用纯存储快照，只投影已终态子任务；子任务过期或仍在处理时保留原父任务结果。最终聚焦 `3 files / 41 tests` 通过。
- 重新执行的扩展 Pear、ZIP/PSD、元素拆解、客户端、UI、PSD 编辑器与保护门禁矩阵共 `30 files / 227 tests` 全通过。
- 全量 Vitest 为 `572 files passed / 22 skipped`、`4171 tests passed / 122 PostgreSQL-gated skipped / 0 failed`；本轮没有配置隔离 PostgreSQL 测试库，跳过项不计作通过。
- `pnpm ts-check`、完整 `pnpm lint`（`0 errors / 961 historical warnings`）和 `pnpm lint:build` 通过。保护脚本已修复默认约 1 MiB 缓冲溢出被吞掉的问题；当前包含既有 `.playwright-cli`、参考仓库和 SDD 文档的脏工作树会如实阻断，不能再写成“0 未授权漂移”。提交后的干净候选门禁另行执行。
- 二次复核后的 12 GiB 生产构建通过：webpack `9.9` 分钟、TypeScript `45` 秒、静态页面 `117/117`、Build ID `ZJo5NS6MxxuKE1ppzZHNq`、退出码 `0`。
- **本地判定：BUG-015 PASS。** 不降低质量阈值、不改变账务状态机、不重复付费；Coze exact-SHA、现有 Google Chrome 界面文案与既有回退任务展示仍待验。

## 2026-08-29 `2d3c2582` smart 回退披露云端回归

- Coze 已精确运行 `main@2d3c258202dec59bdfea9aa36f5df16319f7468d`、tree `3d6fa270832e0bfde8e3e0082abaa0409afddfa2`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变。
- 云端专项 `131/131`、保护基线 38 项/0 警告/0 未授权、TypeScript、构建版 Lint 和 12 GiB 生产构建通过；Build ID `m5wMb_9pluExcucjbglti`，PID `4147`，三个健康端点 200，静态资源 `11/11`。
- Google Chrome 复用既有标签且保持登录，正确选择历史紫色立方体并打开元素拆解配置面板；Console error/warning `0/0`，没有原生弹窗或明显布局异常。
- 旧任务披露文案没有在新任务配置面板自动出现；直接历史任务 JSON 导航被 Chrome 扩展拦截。本轮未触发付费任务，因此不把该项写成通过。
- **回归判定：Coze 运行与非付费 Chrome 冒烟 PASS；BUG-015 历史终态 UI 披露仍 UNVERIFIED。**

## 2026-08-29 `002-C` 图层文档持久化本地回归

- RED 稳定复现保存中再编辑丢失、旧来源完成污染、创建/恢复失败静默丢失、409 重载失效、导出旧快照、外部卸载绕过保存和非 keepalive 在途请求风险；均以最小实现转为 GREEN。
- 隔离 PostgreSQL 18.4 在 `127.0.0.1:55434` 新建一次性测试库；相同 revision 的两个并发 PATCH 恰好一个成功。生产数据库未使用。
- 分层专项 `94/94`；图层文档 API/客户端/验证 `47/47`；全仓带两类 PostgreSQL 变量运行 `600 files / 4348 tests / 0 failed / 0 skipped`。
- `pnpm ts-check`、`pnpm lint:build`、完整 ESLint `0 errors / 961 historical warnings`、Next.js 16.2.11 生产构建及静态页面 `118/118` 通过。
- 干净提交 `245517c1` 保护基线为 `38/38` 功能、0 未授权漂移、0 warning；独立终审为 APPROVED，Critical/Important/Minor 均为 0。
- **回归判定：`002-C` 本地 PASS，云端 UNVERIFIED。** 不把本地通过扩大为 Pear 成功、真实账务或全阶段发布通过。

## 2026-08-29 `18adea` 图层文档云端部分回归与 `9e4d945e` Pear 合同回归

- Coze exact-SHA、生产构建、单实例启动和健康路由均通过；Google Chrome 已在真实编辑器完成图层重命名、隐藏、锁定和自动保存。
- 本次 Pear 任务快速返回应用 taskId，供应商执行期间保持异步进度，最终远程制品被质量门禁拒绝并退款，本地 fallback 打开 5 层编辑器；UI 正确披露实际本地引擎和退款。不能把 5 层写成远程 Pear 成功。
- Chrome 控制通道随后在同一预览标签持续超时，因此移动、排序、关闭重开、刷新恢复和 PSD 导出保留为未验证，不以已有自动化替代真实浏览器证据。
- Pear 专用文档与旧请求体对比形成 RED：`1 failed / 8 passed`，只因多出 `prompt: "."`。`9e4d945e` 删除该字段后单文件 `9/9`、分层矩阵 `85/85`，TypeScript、精确 Lint和保护基线通过。
- 新鲜全仓回归为 `600 files`：`577 passed / 23 PostgreSQL-gated skipped / 0 failed`，共 `4225 passed / 123 skipped / 0 failed`；跳过项不计作通过。完整 ESLint 为 `0 errors / 961 historical warnings`。默认 4 GiB Node 堆的生产构建因 OOM 退出 `134`，仅提高到 8 GiB 后同一 `pnpm build` 完整通过，Next.js 编译 `10.7` 分钟、TypeScript `47` 秒、静态页面 `118/118`、最终退出码 `0`。
- **回归判定：`002-C` CLOUD PARTIAL；BUG-017 LOCAL PASS；`002-B/D/E` 不变。**

## 2026-08-30 PSD 完成态重开与精确图层拖动本地回归

- Chrome 真实缺陷证据表明：完成态元素拆解关闭 PSD 编辑器后没有恢复入口；侧栏选中重叠底层后，画布仍拖动视觉顶层。
- 两项均先建立失败测试。完成态重开通过纯客户端载荷解析恢复同一父任务、源图版本和既有图层，不调用拆解服务；图层命中只在当前选择可见、未锁定且包含指针时优先，否则保持旧顶层与锁定阻挡语义。
- 最终聚焦回归 `45/45`；全仓为 `577 files passed / 23 PostgreSQL-gated skipped / 0 failed`、`4230 tests passed / 123 skipped / 0 failed`。跳过项不计作通过。
- TypeScript、完整 ESLint、保护基线和 8 GiB 生产构建通过；构建生成 `118/118` 静态页面。独立复审未发现 Critical、Important 或 P2 问题。
- **本地判定：BUG-018/019 PASS；云端判定：PENDING。** 必须按“Coze 拉取 exact-SHA → 沙箱重启 → 既有 Chrome 预览标签强制刷新”的顺序验证，且重开不得产生新的 Pear 任务或账务。

## 2026-08-30 `8cd07e1f` PSD 真实重载与拖动云端回归

- Coze 已按 exact-SHA 运行 `8cd07e1f`，源代码树为 `40f3d6ffea93b46ae7da0bd6a10082a2b6c4a62d`；`stable` 未修改。
- 首轮拖动看似仍命中整图校正层，但资源核对证明服务器新入口使用 `webpack-5a113952c3414a17.js`，Chrome 标签实际仍运行旧 `webpack-a832e364079383cd.js`。此前快捷键刷新未让该标签切换构建，因此该结果不作为新代码失败证据。
- 使用现有 Chrome 标签执行标签页级真实重载后，加载资源切换到 `webpack-5a113952c3414a17.js`。从图片工具栏重新打开已保存的 5 层文档，证明整页刷新后的文档恢复路径可用。
- 在重载后的编辑器中选择“元素 2”，于整图校正层重叠区域拖动：元素坐标 `589,416 → 745,520`，整图校正层保持 `0,0`。随后反向拖动将元素恢复到 `589,416`，等待状态回到“已保存”，再次选择整图校正层仍为 `0,0`。
- 本轮没有启动新的 Pear/供应商任务，也没有执行付费操作。BUG-019 云端关闭；BUG-018 的“工具栏重开已保存文档”通过，但完成态任务卡按钮仍因父任务状态未跨整页水合而保留为未验证。
- **回归判定：BUG-019 CLOUD PASS；BUG-018 CLOUD PARTIAL。** 后续部署验收必须核对浏览器实际资源哈希，不能只依赖快捷键刷新动画或页面肉眼变化。

## 2026-08-30 `002-C` 排序、模式与 PSD 导出云端回归

- 在同一 5 层文档中临时交换“元素 2 / 元素 1”显示顺序，并将导出模式从“工作室”切换为“专业”；等待“已保存”，关闭编辑器并从图片工具栏重开后，顺序和模式均准确恢复。
- 随后恢复原顺序 `reconstruction/correction → 元素 2 → 元素 1 → 主体 → 背景` 和“工作室”模式；再次关闭、整页真实重载、重开文档后仍保持恢复值。
- 真实点击“导出 PSD”后界面进入“导出完成 / PSD 文件已下载”。下载文件 `图片_studio_edited.psd` 大小 `14,089,648` 字节，签名 `8BPS`，SHA-256 为 `6264C9B75597CD437732CFC339AE28DEEB36467851F52BB9766075187B3379E0`。
- `ag-psd` 实际解析文件：画布 `3504×2336`，编辑组 5 层，元素 2 为 `left=589, top=416, right=2668, bottom=1890`，校正层为 `0,0,3504,2336`，顺序和最终持久化文档一致。
- Chrome 下载事件捕获等待 120 秒未返回，但 UI 已完成且文件在 `03:58:20+08:00` 实际落盘，因此登记为测试工具事件漏报，不登记为产品导出失败。
- **回归判定：`002-C` 云端核心闭环 PASS。** 当前证据来自本地 fallback 图层文档，只关闭持久化与导出，不证明 Pear 远程质量或成功账务。

## 2026-08-30 完成态元素拆解父任务水合本地回归

- RED 先稳定复现刷新后完成卡片丢失、旧任务项目身份不可恢复、迟到恢复覆盖新提交和项目切换污染。
- 修复只增加项目绑定的父任务持久化与精确只读恢复；兼容旧任务 `result.request.projectId`，使用稳定数据库排序，并通过 AbortController 与请求代次隔离切换、新提交和卸载竞态。恢复不提交供应商、不创建任务、不触发积分。
- 首轮独立审查的 3 项 Important 与 1 项 Minor 均补回归后关闭，终审 APPROVED；聚焦 `12 files / 175 tests` 通过。
- 新鲜全仓为 `577 files passed / 23 skipped`、`4244 tests passed / 123 PostgreSQL-gated skipped / 0 failed`；跳过项不计作通过。TypeScript、零错误 ESLint、干净候选保护基线 `38/38 / 0 drift / 0 warnings` 及 8 GiB 生产构建 `118/118` 均通过。
- **回归判定：BUG-018 父任务水合 LOCAL PASS / CLOUD PENDING。** 云端需要复用历史 completed 任务验证卡片和按钮，不得用新付费任务代替。

## 2026-08-30 `3b47dfb7` 完成态父任务水合云端回归

- Coze 运行 tree `eeabd8124a4580e1a5548e79d31cfc544d58bec0` 与 `origin/main@3b47dfb75d1b1413d7691306c6ae700d9e39f4c4` 一致；专项 `151/151`、全量 `4244 passed / 123 skipped / 0 failed`、保护基线 `0` 未授权/`0` 警告、TypeScript、构建版 Lint 和生产构建均通过，Build ID `CM0KUE0QU2Gj8zQ4GIuYr`。
- Google Chrome 在同一预览标签真实整页重载两次。每次选择 `canvas image / 3504x2336` 并打开元素拆解后，均出现历史 `completed · 100%` 父任务卡、“实际引擎：本地分层”、退款回退说明和“打开编辑器”。
- “打开编辑器”恢复同一 5 层、同一来源尺寸、同一历史重命名“元素 1-云端持久化验收”和“已保存”；第二次打开的 `0 层/正在恢复` 仅为约 6 秒的明确加载态，最终终态稳定为 5 层。验证窗口 Console error/warning `0/0`。
- 云端只读审计确认窗口内新父任务 `0`、积分流水 `0`、扣费 `0`、退款 `0`，也未观察到供应商调用。`app.log` 不含 HTTP path/method，故不能直接声称捕获到“只有 GET、没有 POST”；本报告只据数据库、账务与未点击生成按钮判定恢复链路零业务副作用。
- **回归判定：BUG-018 云端 PASS；V588-STABILITY-002 继续 CONDITIONAL。** 剩余顺序为 `002-B` Pear 远程质量成功、`002-D` 成功一次扣费零退款、`002-E` 云端失败/取消账务矩阵。证据：`docs/testing/evidence/v588-stability-002-3b47dfb7-completed-parent-cloud-2026-08-30.json` 与同前缀两张 PNG。

## 2026-08-30 `5f6e84b1` Pear 三组真实制品回归

- Coze 沙箱运行 `main@5f6e84b1`；元素拆解恢复专项 `138/138`、全仓 `4245 passed / 123 PostgreSQL-gated skipped / 0 failed`、TypeScript、构建版 Lint、保护基线和生产构建通过。
- 三个真实 Pear 任务均进入异步轮询并返回 ZIP；主 PSD 已安全下载、排除 `_depth.psd`、通过 `8BPS` 校验并被解析。ZIP/MIME/下载器/解压/PSD 解析不再是阻塞项。
- 青绿色圆环两次与橙色锥体一次均未得到合格远程层：`front hair`、缺透明主体、`topwear` 单层分别触发质量拒绝。现有质量门禁正确阻止错误制品进入编辑器。
- 两组任务取得精确一扣一退流水，第三组确认一扣一退计数，全部净积分 `0`；未观察到重复任务、重复扣费或重复退款。显式取消仍未执行。
- **回归判定：应用 ZIP/PSD/质量/失败退款 PASS；Pear 远程质量 FAILED/OPEN；成功账务 UNVERIFIED。** 不能把本地 fallback 的 `completed` 作为 Pear 远程成功。机器证据：`docs/testing/evidence/v588-stability-002-pear-cloud-audit-20260830.json`。

## 2026-08-30 `c5d39b11` 受控肖像质量坐标修复回归

- Google Chrome 真实提交受控肖像后，Pear 异步任务返回 ZIP；主 PSD 为 `1280×1280`、23 个语义图层，ZIP、主/深度 PSD 哈希及 `8BPS` 均已记录。旧云端版本最终错误回退为本地 3 层并产生一扣一退，净积分 `0`。
- 同一真实制品经旧生产门禁重放为 score `22`、MAE `0.78438576795`、越界率 `0.17391304348`；根因是不同宽高比源图未归一到 PSD 坐标，以及透明缺口未在共同底色上比较。
- 两项 RED 测试先得到 `2 failed / 3 passed`。最小修复后，同一制品按透明 contain 归一并在白色底比较，得到 23 层、score `98`、MAE `0.01583404022`、越界率 `0`、零告警；没有放宽质量阈值。
- 聚焦分层 `12 files / 128 passed`；全仓 `577 files passed / 23 PostgreSQL-gated skipped`、`4246 tests passed / 123 skipped / 0 failed`；TypeScript、构建版 Lint、空白检查和生产构建 `118/118` 全部通过。
- **回归判定：本地候选 PASS / Coze PENDING。** `002-B/002-D` 只有在新提交部署后，同类肖像真实得到 `engine=pear`、23+ 图层、唯一扣费且零退款时才能关闭。证据：`docs/testing/evidence/v588-stability-002-pear-portrait-audit-20260830.json`。

## 2026-08-30 `a2b1a850` 元素拆解动作文案回归

- RED 契约先证明“可编辑图层”模式仍使用“生成拆解板”静态文案；修复前 `1 failed / 16 passed`。
- 三种模式现在分别显示“生成拆解板 / 生成可编辑图层 / 生成拆解板与图层”，处理中分别显示对应状态；按钮新增稳定 `data-action`，E2E 不再依赖可变中文文案。
- 单文件 `17/17`、TypeScript、构建版 Lint 和空白检查通过。该改动不修改 `outputMode`、供应商请求、质量门禁、任务状态或积分。
- **回归判定：本地 PASS / Coze 非付费 UI 待验。** 不需要为本项单独创建 Pear 任务。

## 2026-08-30 `d9b9c402` 最终候选门禁

- 最终候选包含 Pear 肖像质量归一修复与元素拆解三模式动作文案修复；没有修改质量阈值、任务状态机、供应商账务或 `stable`。
- 全仓 Vitest 为 `577 files passed / 23 PostgreSQL-gated skipped / 0 failed`、`4247 tests passed / 123 skipped / 0 failed`；跳过项继续明确记为未验证。
- 12 GiB Node 堆生产构建退出 `0`：Webpack `11.6` 分钟、TypeScript `53` 秒、静态页面 `118/118`。
- 干净 detached 候选的受保护基线为 `38/38`、未授权漂移 `0`、警告 `0`；主工作树保留的 `.playwright-cli` 与两个只读参考仓库未删除、未提交。
- **回归判定：本地候选 PASS / 云端业务验收 PENDING。** 下一步固定为推送 `main`、Coze 拉取精确 SHA、沙箱重启、现有 Google Chrome 预览页真实重载，然后执行非付费文案检查和 Pear 成功/取消账务验证。

## 2026-08-30 Pear ZIP 瞬时超时恢复回归

- `main@022428f7` 云端真实双输出任务中，拆解板成功，Pear 图层分支在远程制品分块下载阶段因 `Remote image download timed out` 退款并回退本地；积分 `403 → 388` 只保留拆解板分支的 15 积分成本。
- RED 测试先稳定证明一次瞬时超时会直接失败；最小修复仅对 `timeout/ECONNRESET/ETIMEDOUT/socket hang up` 重试一次，并保留取消、安全下载、MIME、体积、ZIP 路径和 PSD 签名门禁。
- 聚焦下载回归 `47/47`、分层矩阵 `98/98`；全仓 `4248 passed / 123 PostgreSQL-gated skipped / 0 failed`，TypeScript、ESLint 零错误、12 GiB 构建 `118/118`、保护功能 `38/38` 与空白检查通过。
- **回归判定：本地 PASS / Coze PENDING。** 本轮修复只提高瞬时网络故障恢复能力；尚未证明新版本真实 Pear 成功、一次扣费零退款或显式取消终态。

## 2026-08-30 `c15ba26a` Pear 云端复验

- Coze 精确部署 `c15ba26a`（tree `a9ab5756`，Build ID `PuHHsUcTBLF7Ysrso9BjH`），预览页静态资源已与新构建一致；`stable` 未触碰。
- Google Chrome 在现有项目中选择 `768×1152` 受控肖像，切换“可编辑图层”后动作按钮正确显示“生成可编辑图层”，只提交一次。任务快速进入 `processing · 27%`，证明初始应用请求不再同步阻塞至浏览器断线。
- 本轮 Pear 在返回制品前报告“当前服务暂不可用，请稍后重试”。应用完成原子退款并回退本地 3 层，UI 正确披露实际引擎和失败原因；没有伪装为 Pear 成功。
- 管理员流水证明 15:28 唯一扣除 `15`，15:29 唯一退回 `15`，余额 `388 → 373 → 388`，净变化 `0`。普通失败退款一致性再次通过。
- **回归判定：动作文案 PASS、异步提交 PASS、失败回退及一扣一退 PASS；Pear 远程成功 UNVERIFIED。** 因为没有生成远程制品，本轮没有执行 ZIP 下载重试、主 PSD 提取或远程图层编辑；显式取消也未执行。证据：`docs/testing/evidence/v588-stability-002-c15ba26a-pear-cloud-20260830.json`。

## 2026-08-30 Pear 最终复验中止与后续顺序

- 官方文档和当前适配器合同一致；本轮没有发现可通过修改请求体解决的新问题。
- Google Chrome 控制在读取现有预览页时持续断开；独立 API 探针因登录 HTTP 401 在提交前停止。本轮零应用任务、零 Pear 任务、零扣费、零退款。
- **回归判定：Pear 远程成功仍为 UNVERIFIED / DEFERRED。** 不把测试工具或登录阻塞误写成供应商失败，也不把历史本地制品回放扩大为云端通过。
- 按用户决定解除其对后续吸收项的顺序阻断，下一项进入 `V588-ADMIN-004`；Pear 保留为后期验证点。

## 2026-08-30 `V588-ADMIN-004` 本地回归增量

- 首轮 RED：投影模块不存在；API 未执行权威 SQL、没有覆盖状态、查询失败仍返回 200；共享类型不接受毫秒活动时间。共 7 个预期失败，既有密码审计保持通过。
- 规格复核 RED：第三条活动查询只覆盖审计表，没有覆盖全部 `wujie_user_data.updated_at`；新增断言稳定复现后改为单条 UNION 聚合，查询总数仍为 3。
- 最终聚焦回归：`6 files / 21 tests / 0 failed`。覆盖项目数据形状、缺行用户、最大活动时间、100 用户固定查询数、403 无查询、数据库未配置与查询失败关闭。
- TypeScript 通过；完整 ESLint 为 `0 errors / 961 historical warnings`；保护基线 `38/38`、未授权漂移 `0`、warning `0`；`git diff --check` 通过。
- 默认 4 GiB Node 堆在 Webpack 阶段 OOM；同一代码以 8 GiB 堆完成编译、TypeScript、`118/118` 静态页面和路由收集。该资源事实单独记录，不归因于管理员投影或 Pear。
- 隔离 PostgreSQL 测试没有 `POSTGRES_TEST_DATABASE_URL` 时继续列为跳过，不能写成通过。
- 最终全仓复跑为 `580 files passed / 23 skipped`、`4259 tests passed / 123 skipped / 0 failed`，耗时 `400.39s`。机器证据：`docs/testing/evidence/v588-admin-004-local-20260830.json`。

## 2026-08-30 `V588-ADMIN-004` Coze exact-SHA 增量

- `main@3bded1de` 在 Coze 精确对齐，tree `827d0e20`；`stable@52f7c60` 未变化。专项 `28/28`、全仓 `4259 passed / 123 skipped / 0 failed`、保护基线、TypeScript、构建版 Lint、生产构建与三个健康端点通过。
- 数据库只读复算确认总用户数 6，积分、项目数组长度和活动最大值与投影逻辑一致；没有修改数据制造通过。
- **回归判定：CLOUD DATA PASS / AUTHENTICATED HTTP UNVERIFIED。** 缺少同一管理员 Cookie 对四接口的真实响应，因此管理员 UI 与 HTTP 合同仍保留补证项。

## 2026-08-30 `V588-PROVIDER-002` 精确授权写入门禁本地回归

- 保留当前更先进的 `task-core/model-catalog` 和 `/api/models`，没有复制 donor 目录或执行器。
- RED 稳定证明旧 API 会接受歧义裸键和无效精确键，且管理员界面不检查失败响应。最小实现后，唯一裸键升级为精确键；歧义返回 409，无效/错误命名空间返回 400，失败零写入、零成功审计。
- 管理员界面仅在保存成功后刷新；保存成功但刷新失败使用独立警告，不再误报保存失败。
- 专项 `59/59`；新鲜全仓 `582 files passed / 23 PostgreSQL-gated skipped`、`4275 passed / 123 skipped / 0 failed`；TypeScript、构建版 Lint、空白检查和 8 GiB 生产构建 `118/118` 通过。
- **回归判定：LOCAL PASS / CLOUD PENDING。** 新生产文件将以实现提交 `e455ea8c` 的精确路径登记保护来源；云端真实管理员保存与普通用户可见性尚未执行。

## 2026-08-30 `V588-PROVIDER-002` 停用供应商目录对齐回归

- Google Chrome 真实网络证据证明，旧云端点击事件和 POST 均正常；失败来自停用供应商模型仍被前端加入整批授权，后端按公开目录正确返回 400 / `MODEL_ASSIGNMENT_INVALID`。
- 新测试先以 `1 failed / 4 passed` 复现目录不一致；最小实现仅过滤 `isEnabled === false` 的授权选项，随后专项 `20/20` 通过。
- 最终全仓为 `582 files passed / 23 PostgreSQL-gated skipped`、`4276 passed / 123 skipped / 0 failed`；TypeScript、零错误构建版 Lint、8 GiB 生产构建 `118/118` 通过。
- 干净 detached 工作树在 `95b489be` 通过保护基线：`38/38`、`0` 未授权漂移、`0` 警告。原工作目录中的历史 `.playwright-cli` 与两个只读参考仓库未删除、未纳入候选。
- **回归判定：LOCAL PASS / CLOUD PENDING。** 旧云端失败不冒充新候选通过；必须 exact-SHA 部署后重做可逆授权保存和普通用户可见性。

## 2026-08-30 `V588-PROVIDER-002` 历史模型列兼容回归

- Google Chrome 在 `main@580a3701` 真实证明停用供应商已从授权目录移除；有效 Pear 精确授权请求不再被 400 拒绝，但在历史 JSONB 用户列写入时返回 500。
- RED/GREEN 测试覆盖 JSONB 类型不匹配的一次兼容重试，并新增无关数据库错误绝不重试的边界；现代 TEXT[] 首选路径及原子 CAS 条件保持不变。
- 聚焦 `46/46`；新鲜全仓 `4278 passed / 123 PostgreSQL-gated skipped / 0 failed`；TypeScript、零错误构建版 Lint、8 GiB 生产构建 `118/118`、保护功能 `38/38` 与空白检查通过。
- **回归判定：LOCAL PASS / CLOUD PENDING。** 缺少隔离 PostgreSQL 库和新候选云端真实 200/持久化证据，不能提前关闭。

## 2026-08-30 `318fe2d7` 历史模型列云端回归

- Coze exact-SHA、全仓零失败、保护门禁、生产构建和三个健康端点通过；Google Chrome 强刷后检查 34 个已加载 JS/CSS，全部返回 200。
- 管理员有效单模型授权保存返回 200，关闭重开后持久化为未选；恢复“不限”再次返回 200，关闭重开后全部模型恢复选中，测试未留下权限变更。
- **回归判定：管理员授权写入 CLOUD PASS。** 普通用户实际模型可见性和隔离 PostgreSQL 双模式测试仍保持 UNVERIFIED。
- 首次仪表盘导航的 `5504` 分块 500 在服务稳定后强刷恢复，作为部署缓存可靠性证据保留，不冒充认证回归失败或完整关闭。

## 2026-08-30 `V588-ADMIN-004` 最后活动显示回归

- 已登录 Google Chrome 的真实只读补证关闭了原四接口缺口：认证、用户、积分、用户数据和仪表盘接口均为 HTTP 200，四处用户总数均为 6；`admin_mr_joker=388 积分/10 项目`、`canvas-user=0/1` 与各管理页面一致。
- API 为 6 个用户返回有效 `last_login`，但旧界面 6 行均显示 `-`。这稳定复现了独立的前端投影缺陷，未把它误判为数据库无数据。
- RED 为 `3 passed / 1 failed`；最小渲染修复后聚焦 `3 files / 12 tests` 通过。最终全仓为 `582 files passed / 23 skipped`、`4279 tests passed / 123 PostgreSQL-gated skipped / 0 failed`。
- TypeScript、构建版 Lint、精确保护基线和 8 GiB 生产构建 `118/118` 均通过；代码已进入 `main@a9956bc5`，`stable` 未变化。
- **回归判定：统计/积分/项目 CLOUD PASS；最后活动 LOCAL + GITHUB PASS / COZE PENDING。** 必须部署精确提交并在真实管理员用户列表看到日期后才能关闭本项。Pear 后期项保持 `DEFERRED / UNVERIFIED`。

## 2026-08-31 `V588-ADMIN-004` 仪表盘边界回归

- 在 Coze 旧候选中进一步确认，缺陷不只影响最后活动：管理员用户列表的积分、项目数和最后登录全部退化为回退值，而 API 与其他管理页仍保持真实数据。
- 新增组件边界 RED 后，证明 `dashboard-view.tsx` 的用户映射丢弃三个权威字段；最小 GREEN 仅透传 `credits / project_count / last_login`，没有扩大到业务重构。
- 聚焦 `13/13`；新鲜全仓 `4280 passed / 123 PostgreSQL-gated skipped / 0 failed`；TypeScript、构建版 Lint、8 GiB 生产构建 `118/118` 和干净保护基线均退出 `0`。
- 候选 `main@a27e33be` 已推送，`stable@52f7c601` 未变化。Google Chrome 安装、扩展启用、原生通信和进程诊断通过，但既有 Coze 标签的页面交互仍超时；按约束未新建标签或窗口。
- **回归判定：LOCAL + GITHUB PASS / COZE PENDING。** 只有 Coze exact-SHA、真实 UI 数值、刷新恢复与 Console 健康全部取得证据后，才能将 BUG-003 和 `V588-ADMIN-004` 整体关闭。

## 2026-08-31 `fa857e44` 云端 UI 正向验收

- Coze 已执行本次精确 main 候选的专项 `13/13`、全仓 `4280 passed / 123 PostgreSQL-gated skipped / 0 failed`、TypeScript、构建版 Lint、38 项保护门禁和 `118/118` 生产构建。`test_run` 对预期 stderr 的误判与 Vitest 实际退出 0、零失败统计分开记录；没有删测试或吞异常。
- 同一个 Google Chrome 预览标签已在服务重启后清缓存强刷并保持管理员登录。用户管理的三字段恢复；积分、数据和运营总览均能真实打开并显示 6 个用户。
- users / credits overview / user-images 已取得真实 HTTP 200 和业务内容；逐用户余额、项目与日期通过页面和接口人工逐行核对。运营总览 UI 总数为 6，但响应正文采集时连接断开，不伪造该响应证据或自动比对结果。
- 首次强刷后的网络事件另有 3 个 Coze 注入脚本 CSP 拦截。已定位外部脚本来源，未放宽安全策略，也不将其混入应用 API 失败。
- **回归判定：有条件通过，尚未完整关闭。** 只剩最终再次刷新、运营总览响应正文、完整新鲜浏览器日志及 Coze post-done tree 补证。已完成的云端拉取、全量测试和构建不重做；没有业务代码变更时不重复本地全仓构建。
- 证据：`docs/testing/evidence/v588-admin-004-fa857e44-cloud-20260831.json`。截图含用户资料，仅保留本地，公开证据使用匿名序号与核对结论。
## 2026-09-02 `V588-ADMIN-003` asset-v3 受控切换与回滚

- Google Chrome 真实验证 asset-v3：10 个项目/453 张图片可读，512/256 WebP 与 1254 原图均能 HTTP 200 并解码；画布实际渲染缩略图，选择、下载入口和刷新恢复正常，9 节点状态哈希刷新前后一致，新鲜 Console error/warning 为 0。
- 显式回滚 shadow 后用户数据哈希仍一致，但门禁由 `11/11` 降为 `9/11`，两个压力项目出现 `checkpoint-schema-mismatch`。媒体仍为 `462 ready / 0 missing`，因此这是检查点一致性回归，不是图片丢失。
- TDD 最小修复将项目有效 schema 与 completed checkpoint schema 纳入快速路径校验，可使下一次保存走既有原子 reconciliation 并修复旧检查点。
- 验证：专项 `68/68`；全仓 `4504 passed / 133 PostgreSQL-gated skipped / 0 failed`；TypeScript、0-error Lint、保护基线和生产构建 `118/118` 通过。
- 云端已部署 `main@3cf87dc8`；Coze `HEAD 8a280f15` 与目标 tree `0f56f794` 精确一致，工作区干净，`stable@52f7c601` 未变化。
- 修复后的 shadow 首检、asset-v3 切换、最终 shadow 回滚三次均保持 `11/11`，462 个媒体全部 ready，0 missing/recovering/unrecoverable；历史 `checkpoint-schema-mismatch` 未复发。
- Google Chrome 两次刷新均加载画布，6 个 Stage 1 媒体和 2 个金色透明资产计数一致，刷新后新增 Console error/warning 为 0。
- **判定：CHECKPOINT DRIFT CLOUD PASS / ADMIN-003 CONDITIONAL。** S3 真实恢复、缺失缩略图浏览器原图回退与隔离 PostgreSQL 并发仍未验证，不得写为整个 ADMIN-003 或全平台通过。

## 2026-09-02 Unified Skill Runtime Task 6 持久调度纠偏

- 候选：`main@3de4b08e`；`stable@52f7c601` 未变化。
- 组合专项 `127/127`；全仓 Vitest `4744 passed / 142 skipped / 0 failed`；TypeScript 通过；ESLint `0 errors / 950 warnings`；保护基线 `38/38 / 0 warnings`。
- 默认约 4 GiB Node 堆生产构建 OOM；8 GiB 重跑成功并生成 `119/119` 静态页。该环境差异已保留，不掩盖首次失败。
- 步骤计费、持久文本/净化 HTML/资产、并行重试集合、首次与恢复 DB 租约、受控 `dispatch_error`、取消和旧 generation 围栏均通过本地回归。
- 最终独立评审：Critical/Important/Minor `0/0/0`，结论 `APPROVED`。
- **判定：LOCAL PASS WITH DATABASE CONDITION。** 6 项新增 PostgreSQL 竞态测试及其他数据库环境套件因缺少专用测试库跳过；未做云端真实执行与浏览器验收。

## 2026-09-03 Unified Skill Runtime Task 11 本地回归

- 候选：`main@366b90b2d66a2b1a524e11ad879a76ed82cf350c`；远端推送前基线为 `origin/main@2faeec0b`；`stable@52f7c601` 未变化。
- 目录门禁：Canvas `21`、Workflow `21`、Simple Chat `16`；Canvas/Workflow 身份与版本一致，Simple Chat 与画布目录交集为 `0`。
- 四轮独立审查发现的七项测试可信度缺口均已按 RED/GREEN 关闭，包括真实 surface 接线、空工作流夹具、受控图像与编排模型、版本/AssetVersion 血缘及有效 origin 初始化。
- 最终本地结果：清单与保护 `16/16`，运行时扩大回归 `148/148`，全仓 `626 files passed / 27 files skipped`、`4895 passed / 142 PostgreSQL-gated skipped / 0 failed`；TypeScript、零错误 ESLint、`git diff --check`、保护门禁 `38/38 / 0 drift / 0 warnings` 和 8 GiB 生产构建 `119/119` 通过。
- 本地生产服务可以启动。Chromium、Firefox、WebKit 的 6 条专项用例均因缺少 `E2E_STAGE4_DATABASE_URL` 在隔离数据库门禁处停止，已保留截图、录像和错误上下文，未冒充业务通过。
- **回归判定：LOCAL PASS / DATABASE AND CLOUD UNVERIFIED。** 下一步仅执行 Task 12 推送、Coze exact-tree、真库与 Google Chrome 验收，不重复 Task 8-11。

## 2026-09-03 统一 Skill Task 12 Coze/Chrome 增量

- Coze 已普通合并 `origin/main@366b90b2`；运行 tree `ee1648ca` 精确一致，`origin/stable@52f7c601` 未变化。
- Coze 通过聚焦 `14/14`、保护基线 `6/6`、TypeScript、零错误 ESLint、Vitest `2785 + 1088` 与 `119/119` 构建；PostgreSQL 项因缺少隔离库继续跳过。Build ID `Fy1oaJhiRjviq5WXmj4YR`，唯一服务 PID `41123`，模式 `asset-v3`，三个 HTTP 入口均为 200。
- Google Chrome 真实验证：管理员仪表盘正常；已有 3 图片项目可加载；Canvas 为 21 Skills；Workflow 下拉为同一 21 Skills；`/simple-chat` 为独立 16 Skills，未出现 Canvas 目录项。
- 服务切换后的首次项目进入出现一次 `Loading chunk 5900 failed`；重新加载当前构建后恢复。该现象保留为部署缓存风险。
- **回归判定：DEPLOYMENT AND CATALOG SCOPE PASS / RUNTIME AND ACCOUNTING UNVERIFIED。** 未执行付费 Skill、暂停恢复、取消退款、失败重试、AssetVersion 与完整浏览器证据采集。

## 2026-09-03 统一 Skill 真库与跨浏览器最终本地回归

- 基于 `main@b81eb845` 的候选增量关闭了 Agent 父子任务围栏、Workflow 内部产品授权传递及移动端节点属性抽屉三项真实缺陷。
- 隔离 PostgreSQL 已执行 Skill Runtime、Pear 分层、批注和元素拆解并发套件，覆盖 20 路同键请求、单任务/单扣费、一次退款、取消优先和迟到完成拒绝。
- 全仓 Vitest：`653 files passed / 5042 tests passed / 0 failed / 0 skipped`。
- 浏览器专项：Chromium、Chromium 1080p、Firefox、WebKit、Mobile Chromium 共 `10/10` 通过；证据保存在 `test-results/stage-4-baseline/evidence/` 和 Playwright 输出目录。
- 工程门禁：TypeScript 通过；ESLint `0 errors / 943 warnings`；保护基线 `38/38 / 0 drift / 0 warnings`；8 GiB 生产构建 `119/119` 通过。webpack 编译耗时 14.5 分钟，作为构建性能观察项保留。
- 初次 E2E 启动曾分别因缺少隔离变量、错误管理员凭据而在前置门禁停止；改用既有 run-scoped 测试账号后重新执行并取得上述真实通过，前置失败没有被删除或伪装为产品失败。
- **回归判定：本地、真库和跨浏览器通过；最新 Coze 候选待验。** Chrome 扩展当前只能枚举现有标签，页面接管返回 `Debugger unattached`。

## 2026-09-03 统一 Skill 云端实跑与状态修复回归

- Google Chrome 顶层预览真实确认 Canvas `21`、Workflow `21`、Simple Chat 独立 `16`；管理员积分页显示用户 6、充值 8560、消耗 4210、余额合计 5110，副标题为“当前用户余额合计”。`V588-CREDITS-OBS-001` 的 UI 剩余条件关闭。
- “美食摄影风格图”真实估价为 62 积分。编排模型和图像模型的 requested/actual providerId、modelId 均一致；图像子任务因真实上游不可用失败，不是隐式换供应商。
- 取消请求被接受，Run 为 `cancelled`、账务为 `refunded`，余额仍为 5110，证明本次真实取消没有净扣费；同时复现错误暂停通用恢复与终态步骤仍 processing 两项缺陷。
- 两项修复均按 RED/GREEN 完成。聚焦 `58/58`，Skill 扩大回归 `298/298`，全仓 `626 files / 4903 tests` 通过；`27 files / 143 tests` 因缺少隔离 PostgreSQL 明确跳过，0 失败。
- TypeScript、零错误 ESLint、保护门禁 `38/38 / 0 drift / 0 warnings` 通过。默认约 4 GiB Node 堆构建 OOM 被保留；8 GiB 重跑成功，生成 `119/119` 页面。
- **回归判定：本地修复通过 / 新部署云端待验。** 真实 Skill 成功产出与 AssetVersion 仍受图像上游失败阻塞；PostgreSQL 跳过项不计为通过。

## 2026-09-03 `8e997ebf` Coze 部署门禁

- Coze 已普通合并 `origin/main@8e997ebf772d15510a85ef47d1a2b63be6b0a60c`；运行 `HEAD tree b2c1211c` 与目标提交 tree 精确一致，工作树 clean。
- `origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化，未使用 `main-fix`，未修改业务源码或持久化数据。
- 云端门禁通过：保护基线 `6/6`、Skill 聚焦 `272/272`、全量 `613` 文件与 `4345` 测试、补充长测试、TypeScript、零错误 ESLint、生产构建 `119/119`。
- `17` 项 PostgreSQL 条件测试因没有隔离测试库明确跳过，未使用生产库冒充测试库。
- 新 Build ID 为 `gZ8JEWqrmTL1DArgB7pSr`；唯一 5000 服务 PID `17363`，`WUJIE_ASSET_GRAPH_MODE=asset-v3`；`/`、`/simple-chat`、`/api/auth/me` 均为 HTTP 200。
- Google Chrome 强制刷新后管理员会话和项目画布正常，Canvas Skills 入口可打开并进入真实 Skill 参数表单。填写参数时扩展控制连接脱离，尚未取得“错误暂停仅显示失败步骤重试”和“取消终态无 processing 步骤”的新部署 UI 证据。
- **回归判定：COZE EXACT-TREE / BUILD / SERVICE PASS；CHROME STATE-MACHINE PENDING。** 不进入下一批开发，先补齐两个状态缺陷的云端真实复验。

## 2026-09-05 Task12 生产模式跨浏览器补验

- 基于 `main@fc775804` 的测试门禁候选，生产构建通过，生成 `119/119` 页面；本机需 16 GiB 进程堆，默认 4 GiB 构建 OOM 继续记录为工程资源风险。
- Chromium、Firefox、WebKit 的 Canvas/Workflow 21 Skills 同源运行及 Simple Chat 16 Skills 隔离共 `6/6` 通过。
- Canvas 成品预览、AssetVersion 精确读取、图片浮动工具栏 PNG 下载及下载文件 `1x1 image/png` 元数据通过；生产模式 Console 失败为 0。
- 暂停/继续、失败步骤重试、历史恢复和 API 控制专项 `57/57` 通过；证据过滤器新增精确请求摘要恢复约束，未知或未恢复的 POST 中断仍失败关闭。
- **回归判定：LOCAL PRODUCTION / THREE-BROWSER PASS；LATEST COZE RUNTIME PENDING。** 尚不关闭 Task12。
## 2026-09-05 Task12 最终本地候选门禁复核

- 候选提交：`ff338cef6803de36dd9597858b6c0bf9210868f1`，分支 `main`，`stable` 未触碰。
- Task12 专项：14 个测试文件，`224/224` 通过，0 失败，0 跳过；覆盖 Skill Runtime、节点模式、运行请求、质量与 UI 接线。
- 工程门禁：`pnpm ts-check` 通过；构建版 ESLint 退出 0；保护基线 `38/38` 通过且无漂移；生产构建退出 0，`119/119` 页面生成成功。
- 生产构建记录：Webpack 编译约 13.9 分钟，TypeScript 约 55 秒；构建期间保留了本地存储路径警告，未隐藏。
- 云端阻塞：现有 Google Chrome 预览标签可枚举，但接管返回 `Debugger unattached`，因此本轮未执行 Coze 拉取、沙箱重启、真实 Skill 运行、暂停/恢复、失败重试、取消退款、预览/下载及新鲜 Console/Network/Trace 采集。
- 判定：`LOCAL PASS / CLOUD UNVERIFIED`。Task12 不能标记完成；不能把本地测试结果当作云端业务通过。

## 2026-09-06 Task12 节点结果下载本地回归

- Edge 云端实测确认旧 Skill 节点预览可打开，但没有节点结果下载入口。该缺口先以组件测试稳定复现，再做最小修复。
- 聚焦测试 `35/35` 通过；全量 `645 passed / 31 skipped` 测试文件、`5167 passed / 168 skipped` 测试，退出码 0。跳过项为缺少隔离 PostgreSQL 地址的条件套件。
- TypeScript、保护基线 `38/38` 和生产构建 `119/119` 通过。修改测试文件 ESLint 退出 0；业务文件无新增 error，保留 15 条历史 warning。
- 判定：`LOCAL PASS / CLOUD DOWNLOAD PENDING`。必须推送并在 Coze 精确同步后，用现有 Edge 预览捕获节点下载完成事件；按钮存在不能替代文件交付证据。

## 2026-09-06 Task12 c74 云端部署增量

- Coze `/workspace/projects` 从 `main@f478b8af` 普通合并到 `8a0ca32f`，`HEAD^{tree}=0714a4fb60642d97480b79c4b8ddb401d378fffd`，与 GitHub `c74a6cf` 精确一致。
- 云端 TypeScript、保护基线和唯一一次生产构建退出 0，`119/119` 页面完成，Build ID `8azEpZi5iO7cDWIokIr9a`。
- 旧 5000 PID `1974` 已停止，新唯一监听 PID `3128`；首页 HTTP 200、HTML Content-Type 正确。
- Edge 忽略缓存刷新后，五图画布、三节点工作流及完成的 Skill 蛋糕成品均恢复。点击成品前控制通道脱附，下载事件和文件验证仍未完成。
- 判定：`CLOUD DEPLOY PASS / DOWNLOAD INTERACTION PENDING`。没有重新生成、扣费、退款或修改 `stable`。

## 2026-09-06 Task12 Edge 节点下载静默失败修复

- 云端 Edge 真实点击节点成品“下载预览图片”后，按钮从 downloading 返回 idle，但 30 秒内没有下载事件，默认下载目录也没有新文件；该问题已按 P1 稳定复现。
- 根因为 `<a download>` 点击后同步回收 Blob URL。最小修复仅把回收延迟 1 秒，不改 Skill 执行、任务状态、供应商、AssetVersion 或账务逻辑。
- RED：两个预览交互用例均证明同步回收仍发生；GREEN：聚焦组件测试 `35/35` 通过，覆盖 click、完整鼠标序列、延迟回收、远程持久化降级及禁止重新提交任务。
- TypeScript、修改文件零错误 ESLint、保护基线 `38/38 / 0 drift / 0 warnings`、`git diff --check` 均通过。
- 判定：`LOCAL FIX PASS / EDGE CLOUD RETEST PENDING`。必须部署新提交后取得真实文件交付证据才能关闭。

## 2026-09-06 Task12 Edge 节点下载云端关闭

- Coze 已同步 `main@5d0ff529d1f4e7f46569cd76cc9a8619a795e289`，云端 merge HEAD `8a97a3906b6f140327c003d6f9d06eac7cd3129c`，`HEAD^{tree}=978337059083dd18e91d3916e14343ea08d21d50`，与目标 tree 精确一致；`origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- 云端 TypeScript、保护基线、修改文件 ESLint、聚焦测试 `35/35` 和唯一一次 8 GiB 生产构建均退出 0；Build ID `f069Xcr3gFH-uPeIC_oNT`，唯一 5000 PID `3879`，首页 HTTP 200。
- Edge 强刷后进入同一项目节点模式，完成态美食 Skill 的 `1254x1254` 草莓蛋糕成品可见；打开预览并连续点击两次下载，实际 Edge 下载目录 `D:\QQDownload` 分别生成 `wujie-workflow-result (1).png` 和 `(2).png`，每个 `2,097,743` 字节。
- 最新文件 SHA-256 `A4F21DBC161EE9C8C4141CB84549A22A7B87A47D5901F049C4F58D0816EF8586`，PNG 签名 `89504E470D0A1A0A`；Sharp 成功解码为 `1254x1254`、3 通道 sRGB PNG。浏览器应用日志无新增 error，仅 Coze 宿主 SDK 一条无关 warning。
- 本地全量新鲜回归：`646 passed / 31 PostgreSQL-gated skipped` 测试文件，`5168 passed / 168 skipped` 测试，退出码 0。跳过项明确源于缺少 `POSTGRES_TEST_DATABASE_URL`，不冒充云端账务验证。
- **判定：TASK12-BUG-001 CLOUD PASS。** Task12 仍未关闭；剩余为未过期租约内即时暂停/恢复、同一用户项目取消任务的一次扣退关联，以及最终 Network/Trace 证据归档。

## 2026-09-06 Task12 最终云端运行验收

- Edge 在当前管理员与项目中真实完成 Workflow Skill：`c2f77b18-166b-4385-b728-fded5a619e9c` 两步完成、质量门禁通过、单扣 62，生成 `AssetVersion 0dd3a7e6-a809-431e-bfd9-1b34590145c1`。
- Canvas Skill `a8eaa0c0-6fe2-4b6d-a260-908b65891226` 在成品步骤运行中手动暂停，约 10 秒后立即恢复；同一 Run 最终完成，规划步骤只执行一次。关联图像子任务仅一个：`async-1788679873911-0-xfl2ug`，远端任务仅一个：`task_01M1TT1WJK0M3XJC030M8TAVCC`，`attemptCount=1`，子任务不扣费；父任务仅一笔 62 积分消费。
- 暂停恢复任务冻结 APImart `gemini-3.1-flash-lite-preview` 与 `gpt-image-2`，最终生成 `1254x1254 image/png`、`2,405,033` 字节及 `AssetVersion 1e00771a-8e63-4b05-a1d0-0583f22ce9dc`。
- 当前归属取消样本 `cbf85a8f-72ff-40e7-a4fa-778fead81498` 进入 `cancelled`，成品步骤同步取消，资产版本为空；消费流水 `ctx_charge_85fb29b0123ea8161c94c3d48698d2ea` 为 `-62`，退款流水 `ctx_refund_9e40cd8d507eb9fd9da8cf96617fc3e7` 为 `+62`，净额 0。40 秒后复查仍为取消、无新资产、无迟到完成。
- 最终 Console error/warning 为 `0/0`。CDP 重新采集四个 Skill/Agent/积分审计请求，均 HTTP 200；Agent 持久事件序列提供暂停、恢复、完成、取消的时间线。现有扩展控制 Edge 无法事后生成独立 Playwright `trace.zip`，不伪造该文件；限制已写入机器可读证据。
- 证据：[task12-edge-cloud-final-20260906.json](evidence/task12-edge-cloud-final-20260906.json)。
- **判定：TASK12 CLOUD PASS。** 统一 Skill Runtime 的 Task12 已按当前清单关闭；这不代表十五阶段全平台测试总目标完成，也不关闭其余供应商、支付或全平台未验证项。

## 2026-09-06 Lovart 营销增量工作流 Task 6 本地门禁

- 当前本地候选：`main@6595c6b0b3f14f00ddc9be80963f9f25e5c8bdfc`；`origin/main` 仍为 `143e44e9`，本地 ahead 2，未 push。`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持只读且未变化。
- 目录保护：旧 Canvas `21` 与 Workflow `21` 未丢失，新增 `3` 项后两者均为 `24`；Simple Chat 仍为独立 `16`，营销 Skill 不进入 Simple Chat。
- 权威聚焦门禁：8 files，`110 passed / 0 failed / 0 skipped`，退出 0。
- TypeScript：`pnpm ts-check` 退出 0，Next route types 与 `tsc` 通过。
- ESLint：`pnpm lint` 退出 0，`0 errors / 943 warnings`；另有 Babel 对超过 500KB 的 `infinite-canvas.tsx` 样式降级提示。
- 全量 Vitest：681 files 中 `650 passed / 31 skipped / 0 failed`；5441 tests 中 `5272 passed / 169 skipped / 0 failed`，退出 0。
- PostgreSQL：Task 4 已在隔离 PostgreSQL 18 上取得营销执行真并发 `23/23`；本轮全量环境没有 `POSTGRES_TEST_DATABASE_URL`，因此 169 项条件测试跳过，不能把本轮结果写成全仓真库通过。
- 构建：默认约 4 GiB Node 堆在 Mark-Compact 后 OOM，退出 1/134；随后使用项目既有 `NODE_OPTIONS=--max-old-space-size=8192`，webpack 13.8 分钟编译、TypeScript 61 秒，`119/119` 页面生成，退出 0。
- 保护与 Git：38 个功能 ID、组件路径、证据合同和引用均通过，零未授权生产漂移、`0 warning(s)`，保护命令退出 0；`git diff --check` 退出 0。
- 浏览器：Task 5 本地 Chromium 用例因缺少数据库变量和运行服务形成 `1 skipped` 证据；本轮按约束未操作浏览器，不能写成 Chromium E2E 通过。
- `6595c6b0` 只修改测试/合同与精确保护授权，没有生产业务源码变化。因此 TypeScript、Lint、默认 4 GiB OOM 与 8 GiB `119/119` 构建引用同一生产代码候选的上一轮证据，没有重复消耗构建。
- **回归判定：LOCAL GATES PASS / EXTERNAL ACCEPTANCE UNVERIFIED。** 本地门禁已收口；Chromium、真实 provider、Coze 与真实浏览器营销链路仍未验证。

## 2026-09-06 Lovart 营销工作流最终本地候选回归

- 修复 `LOVART-WORKFLOW-001`：Workflow Skill 现在基于服务端权威项目、工作流和节点身份，为合法 Canvas AssetVersion 幂等建立 `workflow-input` placement；拒绝项目伪造，URL-only 旧输入保持兼容且不创建 placement。
- Workflow 聚焦回归 `39/39`；隔离 PostgreSQL Skill 并发套件 `10/10`，覆盖同键归并、一次扣费/退款、取消及终态竞争。
- 本地 Chromium E2E `1/1`：Canvas/Workflow 同为 `24/24` Skills；Canvas 产出 2 个结果与 2 个 AssetVersion；Workflow 节点成功产出 2 个 AssetVersion，预览、下载与最终证据门禁可用。
- Stage 4 证据过滤器按 TDD 增加已恢复同步冲突边界：仅同 URL、同 `requestDigest` 且一秒内后续 2xx 的 `/api/user-data/sync` 409 可被识别为恢复；不同摘要、无成功重试或其他 409 继续失败关闭。过滤器 `40/40`、最终相关聚焦回归 `127/127`。
- 全仓 PostgreSQL 回归：`679 passed / 4 skipped` 测试文件，`5459 passed / 12 conditional skipped / 0 failed`。跳过项保持显式，未计作通过。
- 工程门禁：TypeScript 通过；ESLint `0 errors / 943 warnings`；保护基线 `38/38 / 0 drift / 0 warnings`；生产构建退出 0，Webpack 编译约 12.5 分钟并生成 `119/119` 页面。
- 业务候选已提交并推送：`main@ba2049ad975e641c4d60835d2966fc49aa11fa4b`；推送后 `HEAD == origin/main`，`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- **回归判定：LOCAL + POSTGRESQL + LOCAL CHROMIUM PASS / COZE AND REAL PROVIDER UNVERIFIED。**

## 2026-09-07 Lovart Canvas 来源图片一致性回归

- Coze 旧候选真实复现：画布图片已选中且浮动工具栏可见，但“广告 A/B 变体”的必填来源字段仍显示“尚未选择来源图片”，显示状态与提交时临时注入的来源版本不一致。
- 按 RED/GREEN 做最小修复：来源版本收集和结构化字段绑定集中到 `canvas-source-inputs.ts`，表单、估价和执行共用同一份 `canvasSkillInputValues`；没有托管 AssetVersion 时在请求前显示明确错误。
- 新鲜本地证据：聚焦 `58/58`，扩大相关回归 `152/152`；全仓 `652 passed / 32 skipped` 测试文件，`5304 passed / 171 conditional skipped / 0 failed`。条件跳过源于本轮未设置 `POSTGRES_TEST_DATABASE_URL`，不计作真库通过。
- TypeScript 退出 0；ESLint `0 errors / 943 warnings`；保护基线 `38/38 / 0 drift / 0 warnings`；干净 `.next` 后生产构建退出 0，webpack 约 12.5 分钟并生成 `119/119` 页面。Windows 构建峰值内存较高，属于工程资源风险，不隐藏。
- **回归判定：LOCAL FIX PASS / COZE REAL FLOW PENDING。** 下一步只部署本候选并继续 Task 6 Step 6；Task 1-5 和 Task12 不重复执行。

## 2026-09-07 Lovart Canvas 营销下拉默认值回归

- Coze `4786e59b` 已证明 `LOVART-CANVAS-002` 的托管来源绑定生效：选择一张 `AssetVersion` 图片后，广告 A/B 面板显示“已选择 1 张来源图片”。
- 同一次真实估价发现 `LOVART-CANVAS-003`：营销目标和投放渠道虽在下拉框视觉显示首项，请求仍返回 `SKILL_INPUT_REQUIRED: objective`。
- RED：营销预设合同 `1 failed / 17 passed`，精确证明三个必填下拉项缺少 `defaultValue`。
- GREEN：权威定义补齐 A/B 的 `objective=认知`、`channel=信息流` 和再营销的 `funnelStage=浏览未点击`；扩大相关回归 `94/94`。
- 新鲜全仓门禁：`652 passed / 32 skipped` 测试文件，`5304 passed / 171 conditional skipped / 0 failed`；TypeScript、构建版 ESLint、保护基线 `38/38` 和差异检查退出 0。171 项因缺少隔离 PostgreSQL 变量而跳过，不计作通过。
- 生产构建：8 GiB Node 堆退出 0，Webpack 约 12.8 分钟、TypeScript 53 秒，生成 `119/119` 页面；保留本地数据目录不可跨部署的构建警告。
- **回归判定：LOCAL FIX PASS / NEW COZE DEPLOYMENT PENDING。** 尚不能把显示默认值或本地测试替代真实估价、扣费、双成品与恢复证据。

## 2026-09-07 Lovart Task 6 云端核心链路回归

- 云端候选为 `main@da15f30dadec04431746de3052b341ec027be96d`，`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- Canvas A/B Run `2a02c94e-fd50-4411-a0dc-4d9a151bc547` 使用 APImart `gpt-image-2` 完成，报价与单次扣费 122；两个成品分别建立 AssetVersion `fa3f6d04...`、`864c0cc9...`，原来源节点保留，刷新后两个成品继续存在。
- 取消 Run `22a9ca2f-8d29-43fb-9895-1e677a61392d` 只退款一次 122，余额恢复；五分钟后仍为 cancelled/refunded，资产为空且没有迟到完成事件。
- Workflow 执行 `exec-1788719062341-j29rg5` 对应全渠道 Run `73d8c047-4d48-4690-87fd-f2a58f759b3d`。固定 APImart 编排模型 `gemini-3.1-flash-lite-preview` 与图像模型 `gpt-image-2`；5/5 步骤、4/4 质量门禁和 4 个 AssetVersion 完成，单次扣费 242，余额为 8410。
- 该 Workflow 在 Coze `instance_not_found` 和沙箱重建后从持久化状态恢复为 completed，UI 显示 `执行完成 3/3`，Skill 节点显示完成及成品预览；没有重新创建 Run 或重复扣费。
- `/simple-chat` 云端 DOM 为 16 Skills，三项营销 Skill 匹配数为 0，作用域隔离通过。
- 生产环境无安全故障注入条件，单步失败后的云端精确重试未执行；本地确定性故障夹具新鲜重跑 `42/42` 通过，覆盖只执行 `variant-b` 和并行组未完成 sibling，不冒充云端通过。
- 新鲜 Console 仍包含 Coze bridge CSP 与历史远程图片 CORS 错误，不能满足“Console 0 error”发布条件。
- **回归判定：TASK 6 CLOUD CORE PASS / CONTROLLED SINGLE-STEP FAILURE UNVERIFIED。** Step 6 尚未完全关闭，Step 7 不启动。

## 2026-09-07 Lovart 第二批 Task 8 本地与真库门禁

- 在一次性 PostgreSQL 18 空白测试库完成批量内容电商真并发：20 次相同请求只产生一个 Run 和一次消费；三行 SKU 各有独立 operation；成功结果按编译顺序恢复；取消后保留成功行，只对两个未完成图像步骤退款 `14`，重复取消和迟到结果均不能改写终态。
- 修复直接执行/恢复式调用未编译动态 `fanOut` 定义的问题；显式冻结定义不受影响。旧并发用例同步收紧为“部分退款后保持 charged，并精确断言退款金额”。
- 新增与旧 Skill PostgreSQL 专项 `13/13`；目录合同 `11/11`，Canvas/Workflow 为 `27/27`，Simple Chat 独立为 `16`，三个第二批 Skill 未进入执行器特判。
- 全仓真库回归：`1502/1502` suites、`5516/5516` tests，0 失败、0 跳过。TypeScript 通过；ESLint `0 errors / 943 warnings`；保护基线 `38/38`、零漂移、0 warning；`git diff --check` 通过。
- 生产构建退出 0：Webpack 约 12.4 分钟、TypeScript 约 56 秒、静态页面 `119/119`。构建需要 8 GiB Node 堆，继续作为工程资源风险记录。
- GitHub 已推送 `main@1008555f2122682824ae5d8c8a3e84183d264ed4`，推送后 `HEAD == origin/main`；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- **回归判定：LOCAL + ISOLATED POSTGRESQL + GITHUB MAIN PASS / COZE REAL PROVIDER UNVERIFIED。** Task 8 Step 1-5 已关闭；Coze Canvas、Workflow、批量 SKU、取消退款和浏览器证据仍需执行。

## 2026-09-07 Lovart 第二批 Task 8 云端首轮与修复候选

- Coze 已运行与 `main@bcdcfe50fb3acc079ff8e586a58525a72fd0f80a` 同源码树，Build ID `wBB36Y68vT1AEnuDvQxrv`，端口 5000 唯一进程和首页 HTTP 200 已核对。
- Edge 真实运行 Canvas“YouTube/B站缩略图”：APImart `gemini-3.1-flash-lite-preview` 文本规划成功；Pear `gpt-image-2` 两个图像子任务因上游暂时不可用持续重试，未取得成品和 AssetVersion。
- 真实取消证明父级消费 122、退款 120、最终净消费 2；同时稳定复现 `LOVART-CONTENT-002/003`。
- 本地 TDD：聚焦 `45/45`，Task 8 扩大聚焦 `97/97`。
- 新鲜全仓：`658 passed / 33 skipped` 测试文件，`5344 passed / 174 conditional skipped / 0 failed`；跳过项主要需要专用隔离 PostgreSQL，未冒充通过。
- `pnpm ts-check`、`pnpm lint:build` 均退出 0；8 GiB Node 堆生产构建退出 0，Webpack 约 12.1 分钟、TypeScript 54 秒、静态页面 `119/119`。
- 结论：修复候选可进入 `main` 与 Coze 复验；在固定比例、子任务取消、Pear 成功输出、Workflow Pinterest、三行 SKU、刷新恢复及最终浏览器证据闭环前，Task 8 仍为“有条件通过”。

## 2026-09-07 Lovart Task 8 第二轮云端取消回归

- Coze `main@8bc083315aa4e8f4bebfae02d4c313726cd57247` 已真实运行 Canvas“YouTube/B站缩略图”。Run `5b7dda8a-57fb-4991-a2f3-d7cf46903570` 的两个持久化子任务均提交 `aspectRatio=16:9`，关闭缩略图比例错误。
- 同一真实取消中，父 Run 为 `cancelled`，文本步骤完成、两个图像步骤未完成；消费 122、退款 120，净消费 2。子任务仍为 `processing`，再次 PATCH 取消返回 HTTP 500，稳定证明首版子取消 SQL 没有生效。
- 云端原始行已核对：父子 `userId=admin_mr_joker`、`projectId=project_1787549625844_nfmso3ts9` 一致；子任务类型 `generate-async`、`creditStatus=not-applicable`、`creditCost=0`，provenance 精确指向父 Run。因此不是模型不可用或数据不满足业务条件。
- 二次 TDD 将取消拆为“权威父任务验证 + 直接条件更新子任务”，RED 为 `2 failed / 11 passed`，GREEN 聚焦 `58/58`。新鲜全仓 `5346 passed / 174 conditional skipped / 0 failed`；TypeScript、构建版 ESLint 退出 0。
- 本机 4 GiB 构建确定性 OOM；12 GiB 重试因耗时超过十分钟被人工终止，当前二次候选没有新的生产构建通过声明。上一提交 `8bc08331` 已有云端真实构建，本次仅涉及取消 SQL 与回归测试，但仍需由 Coze 新构建验证。
- **回归判定：缩略图 16:9 CLOUD PASS；子任务取消 SECOND LOCAL CANDIDATE PASS / CLOUD PENDING。** Pinterest、CSV、Pear 成功成品与最终证据仍未关闭。

## 2026-09-07 Lovart Task 8 第三轮云端取消与模型持久化回归

- Coze 精确运行 `main@eae0952521f74e652ac8754e9b9a489233588716`，`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持不变。
- Canvas“YouTube/B站缩略图”Run `6701d85c-33e8-47aa-a3d1-799fd1477c30` 的两个持久化图像子任务 `async-1788742244699-0-r53i65`、`async-1788742244717-0-rs2mo3` 均进入 `cancelled`；类型为 `generate-async`、`creditStatus=not-applicable`、`creditCost=0`，迟到结果未建立 AssetVersion。
- 父 Run 最终为 `cancelled`。消费流水 `-122`，退款流水 `+120`，净消费为已完成文本规划步骤的 `2` 积分；没有重复消费或重复退款。由此关闭 `LOVART-CONTENT-003` 的云端子任务取消与部分退款边界。
- 同轮稳定复现 `LOVART-CONTENT-004`：浏览器历史 `wujie_selected_model` 仅保存 `apiProvider` 时，Canvas Skill 表单虽可填写，但估价与执行不会发出请求；临时迁移为 `providerId + compositeKey` 后，估价 HTTP 200、Run HTTP 201，证明根因位于前端持久化兼容读取。
- 本地按 RED/GREEN 新增统一解析器，同时兼容 `providerId` 和旧 `apiProvider`，并在新写入中持久化 `providerId + compositeKey`。模型默认值、Canvas Skill 表单与相关运行时扩大回归共 `145/145` 通过；`pnpm ts-check`、`pnpm lint:build`、保护基线 `38/38` 和 `git diff --check` 通过。8 GiB Node 堆生产构建退出 0，Webpack 12.2 分钟、TypeScript 56 秒、静态页面 `119/119`。
- Coze 已精确部署 `main@536277f5737043444a6d4914007c094c3b0b9ff0`。浏览器仅写入旧字段 `model + modelName + apiProvider` 后刷新，不补写 `providerId/compositeKey`；估价请求 HTTP 200，创建请求 HTTP 201，并精确绑定 Pear `gpt-image-2`。创建 Run `f46a23ea-aa72-400f-98ef-78f50bf832bd` 后立即取消，取消请求 HTTP 200，投影终态为 `cancelled`。
- 本轮证据截图为 `.playwright-cli/page-2026-09-07T01-22-49-727Z.png`，SHA-256 `4FC3DEDE4E8A97D11EBD232C8DFC7834342C8BBD0FCE3FA11DA01A017F0783D9`；控制台仍含历史 Coze CSP 与远程媒体 CORS 噪声，不能据此宣称 Console 全净。
- **回归判定：子任务取消与部分退款 CLOUD PASS；旧模型持久化兼容 CLOUD PASS，`LOVART-CONTENT-004` 关闭。** Pinterest、三行 SKU、Pear 成功成品与最终浏览器证据仍未关闭。

## 2026-09-07 Lovart Task 8 Workflow Pinterest 云端回归

- Coze `main@536277f5737043444a6d4914007c094c3b0b9ff0` 使用既有 Workflow Skill 节点运行 `preset-pinterest-pins`；估价 HTTP 200 为 182 积分，工作流执行 `exec-1788744493217-a3hz52` 和 Run `49e568bc-5193-4afa-b7cd-bf7d6f596f8a` 最终均为 `completed`，实扣 182。
- 四个具体步骤“制定图钉系列方案、主图钉、细节图钉、转化图钉”全部完成；三个结果分别建立 AssetVersion `8a33d282-...`、`c9627204-...`、`9b942493-...`，来源版本均保持 `919e5c53-...`，模型绑定均为 APImart `gpt-image-2`。
- 三张远程成品在浏览器内逐张读取尺寸均为 `1024×1536`，严格为 `2:3`；节点属性在完成后继续保留 image/prompt/task 输出端口。
- `POST /api/workflow/save` 返回 HTTP 200。整页刷新并重新进入节点模式后，Skill 节点仍恢复为“完成”，保留 Pinterest、来源图片、输入参数、精确模型绑定和 Run；预览可打开，下载生成 `.playwright-cli/wujie-workflow-result.png`（SHA-256 `76AEEC3...2134`）。
- 截图、录像、Trace 和 Network 哈希详见 `docs/testing/evidence/lovart-content-commerce-task8-workflow-pinterest-20260907.json`。控制台仍含远程媒体 CORS 错误，故本轮只判定 Pinterest 业务链路通过，不宣称 Console clean。
- **回归判定：Workflow Pinterest CLOUD PASS。** Canvas 三行 SKU、Pear 缩略图成功成品和最终 Console 风险仍未关闭。

## 2026-09-07 Lovart Task 8 Canvas SKU 与缩略图云端回归

- Canvas `批量 SKU 商品素材` 导入三行 CSV，页面按 `SKU-A → SKU-B → SKU-C` 显示；估价与实扣均为 182。Run `de408a76-1176-4e38-b7f4-c04eac6011fb` 的规划和三个图像步骤全部完成，按编译顺序建立三个独立 AssetVersion。
- 三张 SKU 成品均在浏览器读取为 `1254×1254`，三个图像步骤分别通过 `output-present`、`image-dimensions-known`、`aspect-ratio-match`；来源版本和 APImart `gpt-image-2` / APImartLLM `gemini-3.1-flash-lite-preview` 绑定保持一致。
- 沙箱中途丢失后重新启动，持久化恢复继续轮询第三个供应商任务并完成父 Run。整页刷新后画布结果和运行记录恢复；PNG 下载为 `.playwright-cli/wujie-20260907-913-image.png`，尺寸 `1254×1254`。
- Canvas `YouTube/B站缩略图` 改用本轮稳定的 APImart 供应商。Run `b4d19e97-e46e-4275-a29d-4213298be2fc` 在约 65 秒内完成规划与两个图像步骤，建立两个 AssetVersion，估价与实扣均为 122；两张成品均为 `1672×941`，符合供应商像素取整后的 `16:9`。
- 缩略图整页刷新后，两张结果、completed 运行记录、来源版本和模型绑定均恢复；PNG 下载尺寸 `1672×941`。SKU 与缩略图的截图、录像、Trace、Network 和下载哈希分别见 `lovart-content-commerce-task8-canvas-batch-sku-20260907.json` 与 `lovart-content-commerce-task8-canvas-thumbnails-20260907.json`。
- Console 仍有 `getapib.org` / Pear 历史与当前远程媒体 CORS 错误；生产环境没有安全故障注入开关，因此没有通过破坏真实供应商配置制造失败行，相关两项继续留在未验证清单。
- **回归判定：Task 8 云端核心业务链路 CLOUD PASS；阶段有条件通过。** Pear 专用成功链路、受控失败行精确重试和 Console CORS 治理不冒充通过。

## 2026-09-09 Lovart 平台素材合规 Task 11 云端目录隔离增量

- GitHub 与本地均为 `main@2093c70cfbb2046049717106275e917feadff511`；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- Coze 已完成同源码树构建与重启：合并 HEAD `7864d7c5c6b60b51d4f28360736ce4e47de86bdb`，云端聚焦与扩大回归分别为 `62/62`、`307/307`，生产构建生成 `119/119` 页面。
- Edge 在已登录的独立 `/simple-chat` 页面打开 Skill 目录，DOM 精确统计为 `16` 项；“平台素材合规检查”匹配数为 `0`，证明画布专用 Skill 未泄漏到独立智能对话页面。
- 无限画布已配置 APImartLLM `gpt-4o` 显式视觉能力，并完成三张受管图片、Amazon/US/main、商品事实和中文报告参数填写；估价显示 `32` 积分，尚未提交付费运行。
- 切换无限画布验收时 Edge 扩展返回 `Debugger unattached`。因此逐图报告、document AssetVersion、冻结 provider/model、实扣、取消退款、Workflow 下游、JSON/HTML 下载和刷新恢复仍未取得新鲜云端证据。
- **回归判定：TASK 11 CLOUD CATALOG ISOLATION PASS / PAID EXECUTION PENDING。** 不提前关闭 Task 11，不更新 Obsidian 阶段结论。

## 2026-09-09 Lovart 平台素材合规 Task 11 首次真实运行增量

- 生产 API 只读恢复扫描为 HTTP 200：32 个项目图片引用全部存在，缺失为 0；当前无可直接复用的 S3 缺失样本。
- 三张受管图片的合规 Skill 估价 HTTP 200，固定 32 积分；orchestrator 与 vision 均冻结 APImartLLM `gpt-4o`。
- 创建请求 HTTP 201，Run ID `42ac7d13-b473-450d-a3f3-3323942a5b0d`。没有重放或创建第二个 Run。
- 运行期间 Coze 预览实例变为边缘层 404，连续 12 次约 56 秒仍未恢复；登录、身份、列表和 Run 详情均不可达，故终态、报告、资产和账务尚不能核对。
- 后续三次探针取得更精确的平台响应：HTTP 404、`error_code=instance_not_found`，明确说明目标 sandbox 实例不存在；Coze 项目壳仍为 HTTP 200。请求没有进入无界应用或供应商，不能登记为业务失败。
- Edge 扩展 1.26.901.11451 的后台进程和标签枚举正常，但现有项目页与预览页均无法完成调试附着，返回 `Debugger unattached`。恢复时必须先由项目页重新初始化沙箱，再刷新预览，并优先读取原 Run。
- **回归判定：REAL CREATE PASS / COZE INSTANCE LOST / TERMINAL AND BILLING UNVERIFIED。** 恢复后只读取同一 Run，不重新扣费。

## 2026-09-10 多平台批量导出 Task10 本地回归

- 基线：`main@8a58ca2fe91272c108dadfe014fd7a90ba0c6a2a`；候选为该基线上的 Task10 工作树，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- 最终原子批量传输增量后的专项单元、API、组件与 PostgreSQL 回归为 `103/103` 通过。
- 最终增量前一轮全仓 Vitest 为 `736 passed / 4 skipped` 个测试文件，`6134 passed / 13 conditional skipped / 0 failed`；该结果不冒充最终增量后的新鲜全仓门禁。
- 本地 Playwright 最近一次完整四项目轮次为 `15/16`；Firefox 最后一项因 Next 开发服务器 `_next/static/chunks/main-app.js` 未加载失败，随后隔离重跑通过，但不能写成同一轮 `16/16`。
- 证据目录：`test-results/multi-platform-export/working-tree-final-2/`，共 140 个文件，包含 JUnit、HTML 报告、截图、录像、Trace、Console 与 Network 记录。
- 最终增量后 TypeScript 和 quiet ESLint 均退出 0；完整 ESLint 为 `0 errors / 945 historical warnings`。
- 全量 Playwright 聚合入口已执行，但 Stage 3 与 Stage 4 具有互斥的隔离账号/环境前置，加载阶段停止；已登记 `MPE-TEST-001`，没有把该入口写成通过。
- 生产冷构建在 32 GiB Node 堆下运行 45 分钟仍停留于 webpack 优化阶段；复用纯缓存后重试 10 分钟仍无阶段输出，均受控终止且未产生可声明的生产构建。
- **回归判定：LOCAL CODE GATES PASS / PRODUCTION BUILD, CLEAN BROWSER MATRIX AND CLOUD PENDING。**
