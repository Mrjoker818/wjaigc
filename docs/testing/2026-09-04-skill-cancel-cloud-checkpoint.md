# Skill 历史恢复与取消云端验收检查点

## 18:11 后新增真实产图验收

### 18:23 本地恢复候选（未发布）

18:31更新：新增skill-placement-restore-postgres.test.ts三项真实数据库组合测试：同版本同放置恢复并通过实际adopt完整性检查，快照仅1图；并发恢复不重复；跨用户/超保留期仍拒绝。与原PG对账共11项通过。恢复projectRevision遗漏断言先失败后修复，CanvasWorkspace在当前项目与未abort条件下推进修订号并仅清除该entity删除标记。新增接线测试属于源码契约，不冒充完整React端到端。最新7文件86测试通过、0跳过；类型检查exit0。

旧候选全量会话61492启动于18:26，因追加复现修订号缺口主动Ctrl+C退出1，未产生可用最终全量报告，无残留vitest进程。全仓Lint曾exit0，943历史警告，发生在修订号补丁之前，最终候选须复跑。PG集群output/postgres-skill-history-20260904已正常停止。本轮不推送；剩余最终全量、构建、云端同一蛋糕资产恢复验证及Task12其余项。

- 新增三个用例先得到3失败/18通过，验证显式恢复缺失、普通投影复活已删除记录、恢复拒绝仍返回引用。
- 本地改动仅Skill元数据传递、transfer响应新增placementStatus、Skill客户端调用既有restore端点。未改资产迁移/校验/账务规则。
- 历史恢复设置显式标识，首次生成不设置；trashed仅在显式恢复场景允许调用restore，响应必须匹配同asset/version/placement且active后才返回。
- 定向4文件64项通过；pnpm ts-check、定向ESLint、git diff --check均exit0。未把mock端点验证当PostgreSQL集成证据。
- 未完成：真实PG传送-删除-恢复-保存组合回归，修订号/并发边界、transfer状态API契约、恢复响应异常测试、最终全量/构建与云端重验。未推送、未通知Coze拉取候选。

- 一次提交美食Skill，run `164afb05-baf2-41ff-bd8c-204278291429`，估价62；从需求规划进入成品交付并完成。
- 真实图像模型：APImart imgae / `api_1778430731224_533e09a` / `gpt-image-2`；编排：APImartLLM / `api_1778428130626_2qpg71v` / `gemini-3.1-flash-lite-preview`。子任务 `async-1788516683965-0-0jmyqb`，供应商任务 `task_01M1NYDQEBP39DK7GPP4FGMDV3`。
- 1254x1254草莓蛋糕真实落图，原三图保留。首次刷新仍四图；已完成历史再次打开未增加第五张。
- 正常UI确认PNG下载后，本机文件 `C:/Users/Administrator/Downloads/wujie_20260904_340_image.png` 存在，2218107字节，已打开视觉确认。SHA256 `081f485482857b9fad5f846c316ed6c3292969ebfc7eebda13fe7c584570db60`。
- 18:14:31同期单SQL快照：父任务completed/charged/run.completed，父消费1笔-62、退款0、余额22；子任务not-applicable/cost0并引用父消费。旧取消run刷新后仍仅一笔退款。此前processing/pending报告使用早期快照，已排除为状态不一致Bug。
- 删除本轮蛋糕节点后，再点同一历史恢复，出现LEGACY_MIGRATION_INTEGRITY_CONFLICT；刷新后仅三图。该删除后恢复链路不通过，已登记SKILL-HISTORY-20260904-04。资产和版本仍存在，放置被软删除，未丢供应商成品文件。
- 本轮产图、首次落图/刷新、PNG下载、正常完成账务取得证据；不能据此关闭删除后恢复、多结果完整恢复、运行中取消及完整Task12。未更改业务代码或云端数据以绕过缺陷。

- 日期：2026-09-04，数据库核验时间 18:07:31 CST。
- 候选：main `f2b673ce2da9af29caed4d9f6b42faff11ce7907`。
- Coze 合并 HEAD：`814644e333ef4bfaddc269561e755253a815734f`。
- 源码树：`ef92f31b20b2ac4174a246727b16efaf471c8335`，与候选一致。
- Coze 回执：构建退出 0、119/119 页面；BuildID `5fQ8WkybhKg8bhtBuB9Ix`，唯一 5000 PID 17845，asset-v3。云端测试 5049 通过、159 缺隔离 PostgreSQL 跳过；跳过不算通过。
- 浏览器：Google Chrome 用户1，extensionInstanceId `2b86e09b-4e88-427d-ae91-6970d48621d8`。仅使用现有标签，未操作360。
- 预览：`https://62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.coze.site/`。
- 项目：`project_1787549625844_nfmso3ts9`。

## 已执行真实操作

1. 在画布 AI 聊天的21项 Skills 中打开美食摄影风格图。
2. 从新运行记录入口打开旧任务 `bdb9e4dc-be49-450b-b04c-8ac168441c07`，观察原暂停状态及失败步骤。
3. 正常 UI 仅点击一次取消。前端进入已取消，代码 `AGENT_RUN_CANCELLED`，取消和重试控件移除。
4. 本轮恢复连接后再次读取并截图确认该状态。
5. 通过 Coze 对真实数据库进行只读 SELECT 核验，无直接账务写入、补偿或充值。
6. 对同一预览标签调用重新加载，登录和原项目保留，三张原图仍在。再次打开相同 Skill，原任务仍显示已取消。

## 账务证据

| 项目 | 只读查询结果 |
|---|---|
| status | cancelled |
| credit_status | refunded |
| terminal_event_type | run.cancelled |
| 消费 | 1笔，-62，`ctx_charge_77daf77dfc94910b533385e17186d3e4` |
| 退款 | 1笔，+62，`ctx_refund_ee535e20df8c46075397c7bdd9cafcfe` |
| 查询报告的关联子消费 | 0笔 |
| 余额 | 22 → 84 |
| 总充值 / 总使用 | 4382 / 4298 |
| 最后事件 | sequence 6，run.cancelled，1788516175348 |

截至查询时间，取消之后无新的 completed 事件。这不是对未来迟到回调的无限期保证，也不是完整并发退款专项结论。子消费证据来自 Coze 按 task_id/reference_id 的只读查询，尚非所有独立子任务关联方式的全面审计。

## 证据与验收边界

### 接续检查：浏览器控制与候选补丁审查

#### 本轮时序复现与最小修复

- 最终收尾：复审新增“旧restore提交前发生恢复再删除”已由真实PG先RED后GREEN；新Skill携带placementRevision，既有restore事务锁内检查expectedPlacementRevision，拒绝已变更记录，无数据迁移。HTTP路由的版本转发、409映射、非法版本400另有测试。
- 最终新候选完整测试668文件/5231通过、0失败/0跳过，会话57684退出0，证据`output/skill-history-revision-full-20260904.json`。全仓Lint0错误/943警告，类型与38项保护门禁通过。隔离PG已停止，审查子智能体已关闭，无遗留本地测试会话。
- 中途本地PG漏传端口导致的失败报告`output/skill-history-race-full-20260904.json`完整保留：5062通过/144失败/18跳过，连接55489被拒；不是产品代码故障。已显式指定55489并确认pg_isready后执行上述最终全量，不隐藏失败。
- 当前未提交推送，未做本候选生产构建，Chrome仍Debugger unattached。下一步核对最终版本前置条件、构建，再提交main及受控云端同步验收；不重跑已成功的真实产图/扣费/下载，不触碰stable。

- 生产拒绝回调回归：`output/skill-history-retry-red-20260904.json` 为1失败/2通过；修复后相关5文件35项通过，证据 `output/skill-history-retry-green-20260904.json`。
- 生产接收与落图回调回归：`output/skill-history-late-insertion-red-20260904.json` 为3失败/1通过；旧修订响应、图片加载期间删除、本地删除代际变化都会错误继续落图。
- 最小修改：显式历史恢复失败不自动重试；在最终同步插入前检查当前项目修订及目标图片删除代际，通过后才清除目标删除标记。普通投影重试和正常恢复仍通过。
- 最新3文件20项通过，证据 `output/skill-history-race-green-20260904.json`；类型exit0、定向ESLint0错误/57现存警告。全量重新执行中，会话18625，输出 `output/skill-history-race-full-20260904.json`，不可引用上一候选5217项作为新补丁完整结果。
- 此处是受控时序的源码回调执行测试，不是完整React生命周期、真实Chrome多标签或供应商验收；不宣称这些未执行项通过。独立复审进行中，候选未推送。

- 用户报告连接恢复后，重新枚举到 Google Chrome `用户1`，浏览器 ID `3`，扩展实例 `2b86e09b-4e88-427d-ae91-6970d48621d8`。
- 已有 Coze 项目标签 `1727126621` 和原项目预览标签 `1727126531` 均返回 `Debugger unattached`。仅可枚举标签，实际控制未恢复；没有刷新、发送拉取指令、新建标签或操作浏览器 ID `2`。
- 独立只读审查提出两项待复现风险：显式历史恢复在响应丢失后自动重试，可能撤销用户较新的删除；迟到的恢复响应可能清除较新的删除标记。两项属于代码推导，尚无本轮可执行时序复现证据，不能登记为已修复。
- 当前候选补丁仍未提交或推送；不得用串行恢复测试通过代替上述时序测试。已结束审查子智能体。
- 本地最终 Lint 日志 `output/skill-placement-restore-final-lint-20260904.log` 显示 0 errors / 943 warnings；本轮 `pnpm ts-check` 退出 0。
- 全量会话46643已退出0，`output/skill-placement-restore-final-full-20260904.json` 显示5217项通过、0失败、0跳过。隔离PostgreSQL已正常停止。该候选尚缺上述两项时序风险的复现测试、生产构建和云端恢复持久化验收，不可推送或判定修复完成。
- 重置浏览器控制内核后，按相同扩展实例重新识别Google Chrome，项目页仍返回 `Debugger unattached`。浏览器短ID由3变为2，必须按扩展实例及标签URL识别，不能沿用旧短ID。

- 当前对话工具结果保留 Chrome 页面 AX、取消状态截图、Coze 查询回执及重新加载后的运行记录。
- 本检查点尚未导出完整本地 screenshot/video/trace/network 证据包；不得据此称全量证据交付完成。
- 本次未创建新付费任务、未调用供应商、未重复取消、未修改业务源码、账号或账本，未操作 stable。
- Task12 仍未完成：新 Skill 的真实产图、画布落图、多输出恢复、保存下载及新任务账务仍待验收。不能把此旧暂停任务取消成功替代运行中取消或完整任务链验证。
- 本检查点结论：旧任务历史可达、正常取消、一次退款与刷新后的取消状态得到正向证据；总体验收仍不通过，待余项闭环。
