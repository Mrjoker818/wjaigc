# Task12：画布图片 Skill 估算失败证据

## 2026-09-06 恢复租约修复全仓回归

最终构建补充：`pnpm build` 退出0，119/119页面，BuildID `qODy_KTeI8k1tbnsf48An`，日志 `output/task12-resume-lease-build-20260906.log`。下文“构建仍运行中”为过程记录，已结束。本地门禁支持提交main供独立测试沙箱验收，不代表云端任务已恢复。

本轮全仓 Vitest 退出 0：5333 项中 5321 通过、0 失败、12 跳过。跳过项使用旧变量 `TEST_POSTGRES_URL`，主运行仅设置了 `POSTGRES_TEST_DATABASE_URL`；随后对这四个文件设置正确变量，使用同一本地隔离 PostgreSQL 补跑，12/12 通过、0 跳过。两次运行合计验证全部 5333 项，不将首次跳过伪记为通过。新增测试同时确认旧执行器写回被拒绝、重复恢复事件不释放新租约。

证据：`output/task12-resume-lease-full-20260906.json`（SHA256 `DAA733471DFE18C02344F3C7AA6DB78E84BA14DD1DE5D2A3F6CD65321173EE9B`）及 `output/task12-resume-lease-pg-supplement-20260906.json`。最新 `pnpm ts-check` 退出 0；本地 PostgreSQL 已停止。生产构建仍运行中，尚未提交推送。

用户反馈 Coze 已执行完毕后，本轮重新枚举 Edge 实例7并接管原项目标签321231289，实际返回 `Debugger unattached`。未读取新回执、未重新发送指令、未创建付费任务。云端精确租约与同任务最终交付仍未验证，Task12 不标记完成。

## 2026-09-06 10:20 真实数据库复现恢复租约缺陷并最小修复

Coze补充回执确认：下游操作4条，conversation-2图像操作accepted，provider_task_id=`async-1788658961858-0-v0sdyl`，attempt_count=1；精确反查只存在此一条子任务。子任务processing/progress10，remote_task_id=`task_01M1T63PPQ2SKGSV8ZTMP0N02V`，provider为APImart图像/gpt-image-2，credit_status=not-applicable。并非之前推断的子任务未落库或重复生成。三份服务日志无命中，原始异常文本仍未知；远端当前状态也不能仅凭本地processing断言。

源码定位：pause清除父execution lease却不清子operation lease；旧worker的release受父paused/generation fence拒绝。恢复prepare仅在子租约过期后接管（默认10分钟），claimed=false时只读等待约2秒后抛错。generation本身不改变operationKey。

新增真实PostgreSQL回归`reclaims an accepted child immediately after pause and resume without resubmitting`，调用真实prepare/markSubmitted/markAccepted/pause/release/resume/prepare。修复前按预期失败：claimed=false、attempts=1，原providerTaskId仍在。该机制缺陷已真实复现；云端精确lease_expires_at的最后一次只读查询已发送，但读取时浏览器再度未附着，回执尚未取得。

最小修复仅在成功resume/retry控制事务更新父fence后，按run/owner/project清除accepted且已有provider_task_id的子操作租约；保留status、provider_task_id、幂等身份及response，不清submitted不确定状态，不生成第二个任务，不改积分流水。现有paused任务也可经恢复走此逻辑。

本地10:20验证：三个测试文件35/35通过、0跳过，包含真实PostgreSQL事件/账务/取消竞争测试；pnpm ts-check通过；两个修改TS文件ESLint退出0。本地隔离PostgreSQL已停止。尚未执行本候选全仓回归/生产构建，未提交推送，未部署，Task12仍不通过。不得将35项通过替代全平台门禁或远端原任务完成。

## 2026-09-06 Edge 取证与诊断纠偏

10:10 左右重连后，Edge 新连接实例7成功接管原项目321231289和预览321231288；预览已登录且DOM有四张原图。项目页实际测量压缩按钮宽度0、pointer-events:none，确认不是可见等待状态。已在原Coze对话填写、核对并Enter发送一次补充只读诊断；消息已出现、输入清空，Coze明确回复开始只读诊断并读取event-storage.ts，当前生成中。覆盖下文“未发送”。不重发、不构建、不生成、不退款；两标签均markHandoff保留后续控制。下一步读取本次关联查询结果。

后续纠正：Obsidian 同日 08:15 的记录已明确 Coze 的“上下文压缩中”可能是宽度为 0 的隐藏 DOM 控件。本轮只检查文本存在，未验证可见性，因此下文“压缩期间”的判断应降为未验证，不能据此继续等待。现有项目页 Ctrl+Shift+R 后，DOM 读取及重新 getTab 均返回 `Debugger unattached`，可确认的是刷新后的调试附着丢失，不是 Coze 构建或压缩阻塞。未发送补充诊断。

本地排查另确认：skillStepRequestDigest 和 createAgentDownstreamOperationIdentity 均不将 generation/leaseOwner 纳入稳定摘要，因此“恢复代次递增本身导致新幂等键”的假设不成立；仍需查真实 operation 行和步骤输入，不能据此排除其他恢复错误。

用户授权改用 Edge 后，现有项目标签 321231289 可连续读取；独立预览标签 321231288 接管返回 `Debugger unattached`。这是标签级附着差异，不应记录为整个 Edge 不可连接。项目页当前显示“上下文压缩中”，未再次派发构建或生成任务。

已读取 Coze 对 run `f856bc01-6521-4204-9ed2-558316604418` 的只读回执（报告 NODE_EXIT=0）：一次 consume -62、零退款；主任务 processing/pending；事件 sequence 5 为用户暂停、6 为恢复、9 为 execution-error 暂停。此回执尚未独立核验 SQL 原始输出，不等同完整账务验收。

回执声称“重复请求供应商”和“子任务没有落库”，证据不足，暂不采纳。`tool.started` 只证明步骤启动；需求规划文本完成不证明图像模型完成。尤其按父任务 `canvas-skill:` 幂等键前缀查询 cloud_tasks，不能排除独立子任务存在。

本地代码核验：`src/lib/agent-runtime/event-storage.ts` 在 `wujie_agent_downstream_operations` 中按 task_id/owner_id/project_id 存储操作，包含 step_id、operation_key、provider_task_id、status、submission_error；`src/lib/skill-runtime/prepaid-generation.ts` 将 operation.provider_task_id 关联 child.id，并校验 child.result.skillBillingProvenance 和独立操作幂等键。后续必须按此链路查询，不得继续使用父幂等键前缀作否定证据。

待补充只读查询：限定本 run、admin_mr_joker、当前项目，读取 downstream operations 的状态/步骤/子任务 ID/脱敏提交错误，再依精确子任务 ID 读取 cloud_tasks 的状态、remote_task_id、脱敏错误和计费来源；结合 09:42:37 至 09:43:15 日志判断实际失败位置。禁止输出密钥、完整提示词或媒体内容，禁止写数据、重试、退款、重新构建。当前未发送此补充请求，避免在 Coze 压缩期间排入重复指令。

## 2026-09-06 09:42 云端授权复验通过，成品恢复仍失败

正确 Google Chrome 用户1（扩展75943eef、现有项目页1727128516、预览1727128520）已实际恢复连续交互。Coze本次回执：合并HEAD `3728c69e8e1bc9b1d9d5e345706e810a09c6b6d1`，tree `016ed87c57123ac62995e1b3bbc36e0d62f809b3` 与f8e0d753一致，工作区/diff空，TS/38保护/119页面构建退出0，BuildID `i_c2JcUETk2iq_BPnJa04`，5000 PID2860启动09:34:16。未重复同步或构建。

现有预览Ctrl+Shift+R后仍自动登录Mr.joker；打开原四图项目，精确选中原杯图（natural3504×2336，sourceVersion `364dd089-09f1-5f94-901b-cfe9c58c6243`）。09:42:24估算请求 `31572.276` 返回200，requestId `7d749a9e-9986-91c8-8ac1-031041b2d3b1`。实际JSON为minimum=maximum=62，conversation-1=2、conversation-2=60；冻结orchestrator `api_1778428130626_2qpg71v/gemini-3.1-flash-lite-preview`、image `api_1778430731224_533e09a/gpt-image-2`。请求workspaceId仍为规范canvas:projectId。因此同来源授权404在本场景已获得云端修复证据；不是仅凭HTTP200，界面也展示预计62积分。

仅点击一次运行Skill，POST `31572.294` 返回201，run `f856bc01-6521-4204-9ed2-558316604418`，创建09:42:37。规划完成后成品步骤执行中。随后执行一次暂停、一次继续：

- 暂停响应 `31572.337`：accepted=true，sequence5，run.paused，01:42:53.290Z，resumeFromStepId=conversation-2，leaseOwner为空；界面已暂停且规划仍完成。
- 恢复响应 `31572.354`：accepted=true，sequence6，run.resumed，01:43:05.673Z，generation1，dispatch.started=true，仍为同一run及conversation-2。
- 后续列表响应 `31572.369`：同run状态paused，规划completed、成品failed，无AssetVersion，creditStatus=pending，creditCost62；页面仅显示SKILL_EXECUTION_FAILED及泛化失败提示。Console error/warn本次读取为空。

实际页面截图已输出到本对话，显示四张原图、选中杯图、暂停状态与成品失败。不能把暂停/恢复接口受理视作恢复成功，也不能凭pending推断已扣费或已退款。原始供应商原因、子任务身份和实际账务待只读诊断；未重试、未取消、未创建第二个run。Task12整体仍不通过。

已向同一Coze对话发送一次精确只读诊断：只查询该run事件、步骤、关联供应商任务、lease/终态及严格关联积分流水；禁止写数据、改代码、构建、生成或退款。恢复后读取这次诊断回执，不重复派发。

## 2026-09-06 08:56 后续根因与真实数据库回归

最终本地门禁：生产构建退出0，119/119页面，BuildID `24_t3PODbMPtk0D9ZY3Y7`；沿用本地命令8GB堆，编译14.2分钟，无Coze环境修改。与全量5332/5332、类型和Lint结果共同支持提交main用于测试沙箱同步，但不证明云端闭环。后文“构建尚未完成”是运行中记录，以本段最终结果为准。

Coze 只读诊断已完成（NODE_EXIT=0）：项目归属与来源版本均有效，目标杯图的 active placement 使用裸 `projectId`，而新请求使用 `canvas:projectId`。同项目有 1 条规范 ID 的画布 placement 和 3 条裸项目 ID 的画布 placement。现有 legacy-migration 也明确接受这两个项目级别名。因此 a1ad44e1 只修正聊天 session 串用，未完整解决历史画布资产兼容问题；不得再次把这一部署标记为修复闭环。

最小增量在 `authorizeAgentContext` 中优先精确匹配请求 ID，再匹配同项目的另一合法 Canvas ID。仍使用原始 owner、project、version、entity 和 active 查询条件；其他工作区、自定义 session 及其他项目不扩展。无历史数据回填，无数据库迁移，无登录或账务修改。

回归：12 项别名单元用例中，修复前 2 失败、10 通过；修复后 12 通过。本轮另以真实 PostgreSQL 18、现有迁移及真实资产 service/storage 执行隔离 schema 集成测试，验证裸 ID placement 的规范请求授权成功、错误用户/项目/工作区及已删除 placement 拒绝，并逐字段比较查询前后 placement 不变。第一次集成测试因测试夹具只写 trashed、遗漏 deleted_at 而违反现有约束；补全夹具删除时间后通过，未更改生产约束。

2026-09-06 08:56 聚焦运行：5 个文件、47/47 通过，0 跳过。TypeScript、全仓构建版 ESLint 退出 0。38 项保护基线检查通过（此检查输出比较 HEAD，尚需新提交后再核验）。随后全量回归开启本地隔离 PostgreSQL，676 个文件、5332/5332 通过、0 失败、0 跳过；真实数据库服务测试后已停止。报告 `output/task12-canvas-alias-full-20260906.json`，SHA256 `8A3BE42CB64C728D9DDEE537B44A74BEAF934FA8D2DF1B88916A9769C0D4FA11`。生产构建与新版云端复验尚未完成，不宣称已关闭。

Chrome 本轮已在正确用户1现有标签页实际点击打开原4图项目、AI聊天及21项Skills；没有提交生成任务或扣费。此连接证据不替代上述业务估算与生成验收。

## 最新云端复验：仍未通过

2026-09-06 08:22:42，Coze回执已同步a1ad44e1，merge HEAD `63e09e30c82410fe0a4c47fb35c0e94da7a5ec94`，tree `08271d1fcfca44409d86695a034f302f3770109b`，TS/38保护/119页构建退出0；BuildID `hxHtO_YaljIVb6B9mXAG3`，唯一5000 PID7550启动08:19:11。随后正确Google Chrome现有预览通过CDP Page.reload(ignoreCache:true)强刷，自动登录，原4图保留。

同一杯图自然3504×2336已加载，选中后进入画布AI聊天/Skills/Mockup，以相同输入估算一次。请求 `34604.5167` 已正确携带 `workspaceId=canvas:project_1787549625844_nfmso3ts9`，sourceVersion仍 `364dd089-09f1-5f94-901b-cfe9c58c6243`，冻结APImart原provider/model配对。但仍HTTP404，业务错误 `AGENT_CONTEXT_NOT_FOUND`，requestId `aaec11f0-a211-9303-8307-f0990c2295f1`，timestamp `2026-09-06T00:22:42.923Z`。不能将本地契约测试通过视作此Bug关闭；尚需真实资产/placement数据核验。

已在Coze发送一次精确只读诊断并看到执行回复：查当前账号项目归属、目标version存在性、active placement的workspace及状态，若不存在则查同项目精确媒体路径。禁止回填/改授权/改数据/构建/生成/扣退。未点击运行Skill，无新付费任务。下一步只读取这次诊断，不重复派发或重新构建。

## 真实复现

- 日期：2026-09-06（北京时间）；首个响应时间 `2026-09-05T23:36:28.635Z`。
- 环境：现有 Google Chrome 用户1、独立 Coze 测试预览；业务部署候选 `6407ec0c`，非 stable。
- 项目：`project_1787549625844_nfmso3ts9`。
- 选择画布中蓝色陶瓷杯原图，打开 AI聊天 → Skills → 样机展示(Mockup)，填写设计内容和载体，点击“估算积分”。
- 连续两次返回 HTTP404，页面明确显示 `Agent context not found`。
- 浏览器请求ID：`34604.2260`、`34604.2276`。
- 未点击“运行 Skill”，未提交本轮生成任务。

## 关键请求字段

```json
{
  "skillId": "preset-mockup-showcase",
  "skillVersion": 1,
  "surface": "canvas",
  "projectId": "project_1787549625844_nfmso3ts9",
  "workspaceId": "session-1786347587770",
  "sourceVersionIds": ["364dd089-09f1-5f94-901b-cfe9c58c6243"],
  "modelBindings": {
    "orchestrator": {"providerId":"api_1778428130626_2qpg71v","modelId":"gemini-3.1-flash-lite-preview"},
    "image": {"providerId":"api_1778430731224_533e09a","modelId":"gpt-image-2"}
  }
}
```

## 首次响应

```json
{"success":false,"code":"AGENT_CONTEXT_NOT_FOUND","message":"Agent context not found","requestId":"0966f9ec-6598-9be3-9138-d8331564f1b4","retryable":false,"timestamp":"2026-09-05T23:36:28.635Z"}
```

## 根因调查状态

当前 `chat-panel.tsx` 的 `buildCanvasSkillRequest` 使用 `currentSessionId || canvas:projectId` 作为 workspaceId；真实请求确实提交聊天session，而非画布workspace。`authorizeAgentContext` 必须精确查找 owner/project/workspace/workspaceId/version 对应的有效 placement，找不到时返回上述错误。其他画布 Agent 路径使用 `canvas:${projectId}`。

因此聊天会话ID被误用为画布工作区ID是首要假设，尚需核对该真实版本的数据库placement或通过等价存储契约测试确认。不得通过删除归属检查、跨工作区任意查找或修改历史资产数据来规避错误。

## 结论

### 本地修复增量

已通过执行组件真实请求回调的测试确认工作区串用：两个非空会话用例失败，空会话通过。随后仅修改 `chat-panel.tsx` 的 workspaceId 及相关Hook依赖；三个用例通过真实 `authorizeAgentContext` 的画布placement匹配，相关估算API/组件聚焦共17项通过。TypeScript、改动文件ESLint通过，38项保护门禁通过。

全仓：5319项中5153通过、0失败、166跳过。随后启用本地隔离PostgreSQL 18（127.0.0.1:55492），对所有含跳过项的测试文件补验172/172通过、0跳过，含166项补验与6项同文件已通过项。隔离库已停止，不连接云端数据库。

生产构建：默认约4GB堆因OOM失败；仅本地命令设置 `NODE_OPTIONS=--max-old-space-size=8192` 后重跑退出0，119/119页面，BuildID `-hhcQ1jQOYxilEiYES-Nz`。未更改Coze配置。保留既有localstorage-file和本地数据目录警告。

机器报告：
- `output/task12-workspace-full-20260906.json`，SHA256 `473DC030E1A558149831132E35429C7F85C785E8FE963639AE2DA90722AEF949`。
- `output/task12-workspace-pg-supplement-20260906.json`，SHA256 `CA7C5B7CB1228A4FDD80D766A717BB914C801C87EFE44DC1473EEA48877076E3`。

本地门禁已通过，云端仍待此新修复部署后同图复验；不把本地通过视作云端通过。

新增待修问题：画布带原图 Skill 在估算阶段受阻，暂定P1。真实模型生成、暂停恢复、成功账务验收未开始，不得标记通过。当前保存的是网络与DOM文字证据；完整录像、Trace和本地截图尚未取得。
