# Task12 原任务恢复云端实测

时间：2026-09-06 11:21-11:25（Asia/Shanghai）。

## 环境和范围

- 本地main：`d82861129cc42ca5720525c5c227ee34eaf44c40`。
- 已读取Coze同步报告：merge HEAD `f478b8af0049c8e9f625671047c3da42576adbf8`，tree `ed6f0c4c4ac35520dab99b77b221281390757daf`，BuildID `azQ6fkBkTaje29NXyuyvz`。
- 浏览器：用户授权的Edge，实例8，既有预览标签321231288。未使用360或新建标签。
- 预览：`https://62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.coze.site/?projectId=project_1787549625844_nfmso3ts9`。
- run：`f856bc01-6521-4204-9ed2-558316604418`；Skill：`preset-mockup-showcase@1`。

## 实际操作和结果

1. 通过CDP `Page.reload(ignoreCache:true)` 强刷，登录自动恢复，原四图可见。
2. 打开AI聊天、Skills技能库、样机展示(Mockup)、原运行记录。确认已暂停，需求规划完成，成品交付失败，错误SKILL_EXECUTION_FAILED。
3. 仅点击一次“从失败步骤重试”，没有点击“运行Skill”。
4. `POST /api/skill-runs/{runId}/retry` 返回200；实际JSON为 `{"accepted":true,"startedStepIds":["conversation-2"],"scheduledStepIds":["conversation-2"]}`。浏览器requestId：`9480.679`。
5. 页面随后显示原run已完成，两个步骤均已完成。生成蓝色杯子真实进入画布，原四图保留。截图已输出到本对话工具证据；未声称本地截图文件已保存。
6. `GET /api/skill-runs/{runId}`（requestId `9480.694`）返回业务状态completed，creditStatus charged，creditCost62，qualityEvents含output-present=true；updatedAt=1788665005933。此处不把charged推断为只消费一次。
7. 再次强刷后画布保留五图。DOM实际读取新结果图片naturalWidth/naturalHeight均1254，源图片仍保留。
8. 本轮Console error/warn采样为空；不是全时段无错误证明。

## 资产关联证据

`GET /api/assets?projectId=...&assetVersionId=b4f6a698-de60-47e0-bd37-95f3eb5a17b5` 返回200（requestId `9480.695`）：

- assetId：`03ff88cf-f479-49f2-abf9-14e4c58a598a`。
- assetVersionId：`b4f6a698-de60-47e0-bd37-95f3eb5a17b5`。
- sourceTrace.runId：与原run完全相同。
- sourceVersionIds：`364dd089-09f1-5f94-901b-cfe9c58c6243`，对应原蓝杯素材。
- image绑定：`api_1778430731224_533e09a / gpt-image-2`。
- orchestrator绑定：`api_1778428130626_2qpg71v / gemini-3.1-flash-lite-preview`。
- 结果URL：`https://getapib.org/f/image/7629273944121323-02a8ea77-aaa0-49d6-9687-1126957a6765-image_538PY4T6QY7S4TCG859DCZPAFR_0.png`。
- 刷新后图片src与该资产URL完全相同，可正常解码，并非原项目蛋糕图。

## 尚未验证

以下列表为11:25时的缺口；账务和浏览器下载终态由下方11:40增量覆盖，文件落盘位置及离线解码尚未核验。

- 只扣费一次、成功无退款的数据库流水及原供应商子任务唯一性，不能由前端charged字段替代。
- 本结果下载文件、节点模式和独立对话中的本版本对应验收。
- 新任务即时暂停/恢复的完整竞态验收。本轮为旧任务在租约自然到期后恢复，不单独证明10分钟租约未过期时的恢复修复已在真实云端通过；该竞态已有本地真实PG测试证据。
- 成品与原图杯型并非完全一致，不能把output-present质量门禁等同于高保真Mockup质量合格。

## 唯一续接点

### Edge 12：剩余查询回执与旧节点大图验收

用户重开Edge后，复用项目标签321231559、预览标签321231607，未创建新标签。实际读到上一条“Task12剩余只读证据核验”用户消息与完整回执，查询快照2026-09-06T03:53:09.317Z、NODE_EXIT=0，确认已送达且已完成，禁止重发。

- 历史取消run `67bfbf02-4b7c-4e13-9594-c7afec9648b0` 在指定owner+project范围rows=0，按id计数为1。未查询实际归属或账务，不能作为本用户本项目取消退款证据；必须先从授权测试记录定位正确归属，不猜测。
- 完成run f856bc01：execution lease owner为空，completed_at=1788665005975，paused_at=0；成品步骤及generate_image操作均completed，lease_owner为空、lease_expires_at=0。
- 另一个root/conversation-1操作仍prepared，owner非空、旧租约1788659557643已过期。此字段不符合“全部下游操作均完成释放”的宽泛表述，需要核对规划步骤的操作收尾语义，暂不能宣称所有操作都已释放。
- 成品b4f6a698：mime_type=image/png，byte_size=1695497，1254×1254，与浏览器下载完成字节数吻合。
- Coze已承认先前“未过期接管”论断错误，但其“修复使过期接管正确”的新因果推断仍不是验证证据；只采纳查询字段，未过期即时恢复仍待真实测试。

随后进入原五图项目→节点模式，精确单击旧蛋糕切片URL，成功出现alt=预览大图。实际DOM原始1254×1254，容器80vw×80vh，当前约1529.59×708.80，object-fit:contain；截图显示完整蛋糕切片且没有变形。大图单击关闭有效。此路径真实通过，覆盖上轮双击不打开的疑点，不修复预览点击逻辑。

大图弹窗仅有图片及关闭按钮；关闭后右键成品只见批注修改、复制、副本、断开连线、删除节点，无下载。当前节点预览/右键的内置下载路径仍未闭环，不能以画布蓝杯下载代替旧节点成品下载验收。本轮没有执行生成、重试、取消或新增扣费。

### Edge 11 重连后的节点成品交互复验

11:53 本地专项增量：只扩展 `src/__tests__/components/node-editor-skill-node.test.tsx` 的预览用例，增加pointerDown→mouseDown→pointerUp→mouseUp→click序列，保留原click用例及禁止重新提交任务的断言。`pnpm exec vitest run src/__tests__/components/node-editor-skill-node.test.tsx` 实际34/34通过、0跳过，退出0；该文件ESLint退出0。这是jsdom组件测试，API返回为测试夹具，不是浏览器真实鼠标/布局/供应商验收，不能关闭云端预览下载项。生产业务源码未变更。

同轮再次读取原Coze标签的DOM及截图均返回Debugger unattached；没有重发待核对指令，没有开启新标签，没有重启或重新付费执行。

补充核对：当前源码 `WorkflowLegacyNodeCard.tsx:797` 的预览约定是单击，经 `node-editor.tsx:3278` 传入 `setImagePreviewUrl`，不是专用双击行为。随后单击尝试在CDP派发前超时，DOM返回Debugger unattached，不能记录成单击业务失败。现有 `node-editor-skill-node.test.tsx:27` 只用fireEvent.click验证弹窗和尺寸，不覆盖真实pointer序列，也不覆盖下载；`node-editor.tsx:3967` 图片弹窗仅有图片与关闭按钮，没有下载按钮。仍需真实单击闭环后判断是否存在事件问题，不能凭连接故障改代码。

同一Edge实例项目页短暂恢复，已填写并逐字回读新的“Task12剩余只读证据核验”指令：只核对历史取消run `67bfbf02-4b7c-4e13-9594-c7afec9648b0` 的归属和任务级账务关联，以及完成run `f856bc01-6521-4204-9ed2-558316604418` 的completed_at/lease/MIME/字节数字段。Enter返回后快照仍是旧报告，再读时附着中断；新消息是否送达尚未确认。下一轮先查消息和输入框，不重复发送。未要求拉取、构建、重启或写数据库。

- 复用用户已有预览标签 321231495，未新建标签。成功读取画布五张图片，点击“节点模式”后进入三节点工作流，证明本次连接可以实际操作，并非仅能枚举标签。
- 选中已有“Skill 执行”节点，状态为完成，参数为美食摄影风格图、草莓奶油蛋糕，模型选择为 APImart。没有重新执行工作流或创建付费任务。
- 节点中蛋糕切片缩略图实际可见，DOM显示约171.52×171.52像素；图片URL为 `https://getapib.org/f/image/7887573024302815-6b0c2960-74b5-43ce-996f-f068c9dbd43d-image_6XKNMB10D2W5GFNF7P16EA3ZCV_0.png`。
- 双击该图片后，DOM仍为原节点属性界面，没有大图弹窗，也未出现下载入口。图片父元素具有cursor-pointer样式。这里只记录双击路径无结果，尚未确认实现约定的其他触发路径，不能据此宣布整个预览能力不存在。
- 本轮Console error/warn采样为空；工具内已显示截图，但未保存为本地证据文件，不虚报截图文件路径。
- 下一步核对节点预览的约定触发方式并复现，继续补即时暂停恢复与取消退款关联证据。Task12未完成。

### 11:40 增量：账务回执已读、PNG下载完成

Edge重启后实例10，用户新开的项目标签321231454成功读取原查询最终报告（NODE_EXIT=0）。没有再次发送查询或生成请求。报告中脱敏数据库字段如下：

- 父任务status=completed、credit_status=charged、credit_cost=62、refunded_transaction_id为空，updated_at=1788665005933。
- 同run下游操作仍4行，conversation-2/generate_image由accepted变completed，attempt_count 1变2，provider_task_id仍为 `async-1788658961858-0-v0sdyl`。
- 按provenance.runId查到唯一子任务，status=completed、progress=100；原remote_task_id `task_01M1T63PPQ2SKGSV8ZTMP0N02V` 对应行数1，没有新子任务。
- 严格关联原run的消费仅1行，amount=-62，时间仍为原预付时刻1788658957453；退款0行。
- 本AssetVersion availability=ready、task_id挂原子任务，provider/model及sourceVersionIds/sourceTrace.runId匹配；资产active、current_version_id匹配。

这是已读取的Coze只读查询报告证据，未独立直连云端数据库。报告声称“接管未过期租约”不成立：旧租约01:52 UTC到期，本次恢复03:23 UTC，已自然过期。只接受其查询字段，不接受该因果推断。

在用户新开预览标签321231495进入原五图项目，精确选择本次杯子资产URL，来源标签显示原run；展开更多工具→下载→PNG格式→确认下载。CDP记录：

- suggestedFilename：`wujie_20260906_625_image.png`。
- guid：`9bf5ff88-7aa4-4dae-9335-34fdf9d647e3`。
- Page.downloadWillBegin sequence102，Page.downloadProgress sequence109 state=completed。
- receivedBytes=totalBytes=1695497。
- 浏览器Console error/warn本轮采样为空。

下载完成事件为正向证据。Windows默认Downloads目录近5分钟未发现该文件，实际保存路径及文件离线像素解码尚未核验；不得虚构本地路径。事件读取truncated=true，因此不声称完整网络日志无丢失，但已捕获这一下载的开始到完成事件。

续接只做剩余验收：文件定位/解码、即时暂停恢复竞态、跨工作区及Task12原清单其他缺口；不再重复此run账务查询或恢复，不触碰stable。

### 11:28 增量：只读查询已确认送达

Edge实例9读取原项目对话：上次查询文本不在消息中，输入框为空。随后重新填写原只读指令，逐字回读一致后Enter；页面出现该用户消息以及Coze已展开1个步骤、核对父子任务与账务范围的执行文字。本次已送达，后续禁止再次发送，只读取这条查询结果。

同时在原预览精确按资产URL选择蓝杯新结果，来源标签确认run f856bc01；展开图片工具栏的更多工具，看到下载按钮。点击下载超时，后续DOM未附着，未确认下载菜单或文件。不得将这次点击标成下载成功，也不得未经核对就重复触发。

已在原Coze项目页填写并回读“仅做Task12恢复后的只读验收”指令，限定同owner/project/run，查询父子任务、原remoteTaskId、消费/退款、资产关联，不写数据、不构建、不生成。Enter操作超时，随后DOM未附着，是否送达未知。下一轮先检查现有对话和输入框，禁止盲目重发。

本轮状态：原任务恢复、结果落图、资产身份和画布刷新恢复得到真实正向证据；Task12整体仍未完成。

## 12:58 本地节点结果下载修复门禁

- 云端旧 Skill 节点预览已经真实通过，但弹窗和右键菜单均没有下载入口，因此按测试先行建立失败用例，不把画布图片下载替代为节点结果下载。
- 最小实现仅修改节点结果预览弹窗：新增“下载预览图片”按钮；同源或允许跨域的资源直接下载；远程资源直接读取失败时，通过既有 `/api/save-image` 持久化后再下载；失败时显示明确提示。没有触发工作流执行、Skill 重试或积分接口。
- RED 证据：新增下载按钮断言后，聚焦用例因按钮不存在失败；新增远程资源回退断言后，因未调用持久化路径失败。
- GREEN 证据：`src/__tests__/components/node-editor-skill-node.test.tsx` 为 `35/35` 通过，覆盖单击、真实鼠标事件序列、直接下载、远程持久化回退以及禁止重新提交任务。
- 全量回归：`645 passed / 31 skipped` 测试文件，`5167 passed / 168 skipped` 测试，退出码 0。跳过项为缺少 `POSTGRES_TEST_DATABASE_URL` 的条件测试，不冒充本轮真库通过；Task12 既有隔离 PostgreSQL 证据保持有效。
- TypeScript 退出码 0；保护基线 `38/38` 通过且无漂移；修改测试文件 ESLint 退出码 0；`node-editor.tsx` ESLint 退出码 0，保留 15 条历史 warning，无新增 error。
- 首次与全量测试并发的 4 GiB 构建发生 OOM；测试释放后使用进程级 `NODE_OPTIONS=--max-old-space-size=8192` 单独重跑，生产构建退出码 0，`119/119` 页面生成成功。该环境变量未写入仓库或云端配置。
- 当前仍不可关闭节点下载验收：实现提交推送并由 Coze 精确同步、重启沙箱、强刷现有 Edge 预览后，必须捕获真实下载完成事件并核对文件字节数；不得仅凭按钮出现判定通过。

## 历史取消 Run 只读账务审计入口

- 新增 `scripts/task12-skill-run-audit.sql`，使用方式为 `psql "$PGDATABASE_URL" -v run_id='uuid' -f scripts/task12-skill-run-audit.sql`。
- 脚本首先按 `runId` 发现真实 `user_id + project_id`，再读取父任务、执行租约、事件、下游操作、`skillBillingProvenance` 子任务、父任务绑定的消费/退款流水、账务基数及结果 AssetVersion/placement。
- 全程位于 `BEGIN TRANSACTION READ ONLY` 与 `ROLLBACK` 之间，不包含数据写入或结构变更语句；不会通过猜测 owner/project 排除真实记录。
- 测试先因 SQL 文件不存在按预期失败，最小实现后 `src/__tests__/scripts/task12-skill-run-audit.test.ts` 为 `1/1` 通过；全量回归 `646` 个测试文件通过、`31` 个 PostgreSQL 条件文件跳过，`5168` 项通过、`168` 项跳过、`0` 失败。`pnpm ts-check`、该测试 ESLint、`git diff --check` 和保护门禁 `38/38 / 0 drift / 0 warnings` 均退出 0。
- 本机 `POSTGRES_TEST_DATABASE_URL`、`PGDATABASE_URL`、`DATABASE_URL` 均未设置，因此本轮没有执行真库查询。历史取消 Run 的精确扣退关联仍为未验证，待 Coze 终端或专用只读数据库连接执行脚本后才能关闭。
