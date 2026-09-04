# Skill 云端重连实测记录

## 环境
- 日期：2026-09-04，Asia/Shanghai。
- Google Chrome扩展：2b86e09b-4e88-427d-ae91-6970d48621d8，浏览器9，原标签1727126156；未操作360或新建标签。
- 预览：https://62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.coze.site/
- 目标源码：8237f5b6e9fb2b6c9c8fc7873ae68c291fbea0b4。
- Coze新对话7报告：HEAD 70331b93165466d3cc56e815157b720092968c12，tree 3180e4ac7f22a84c6e3029a728a184f0da20c06f与目标一致；stable未动；4925通过/143跳过；119/119页面构建成功；Build ID Tcr1E5Xe8YRKXC_fdnzah，PID17104，asset-v3。此段是读取Coze报告，不是独立终端核验。

## 实测证据
- 重启后在原标签恢复预览，已登录；21项画布Skill可打开。
- 美食摄影参数：草莓蛋糕、西式甜点、45度角、温暖自然光、餐饮菜单摄影，交付单张成品不覆盖原图。
- 仅提交一次，POST /api/skill-runs 返回201，requestId 21712.158，reused=false，charged=true。
- runId：1c56c864-0b28-4e10-8b72-b15371c19adf；创建时间2026-09-04T01:34:02.396Z。
- 绑定：APImart gpt-image-2；编排gemini-3.1-flash-lite-preview。
- GET结果requestId 21712.260：status=completed，两个步骤completed，output-present=true，creditCost=62，creditStatus=charged。
- 资产版本：71b202ac-173e-41c9-92bb-6867e5d6e3a5。
- 新图1254×1254，独立节点进入画布，原图仍可见。截图保存在本对话工具证据中。
- 成品文件请求/api/serve-upload/uploads/gen-1788485678777-7st1m3.png返回200。

## 不通过项
1. 内容传递/质量：输入草莓蛋糕，规划输出也描述草莓蛋糕，但截图中新图为一碗面食。目前只能确认语义不匹配，根因待追踪，不能直接归责供应商。output-present门禁未检测语义一致性。
2. 项目保存：/api/user-data/sync出现至少三次500（21712.265、21712.277、21712.285）。读取21712.285响应为{"success":false,"error":"LEGACY_MIGRATION_INTEGRITY_CONFLICT"}。未确认刷新恢复，不进行破坏性重置。
3. 捕获两次net::ERR_FAILED（21712.259、21712.266），尚未定位对应资源，不视为无异常。

## 结论
不通过。质量参数修复后的提交、任务完成、资产创建与落图取得正向证据；成品语义、保存链路不通过。独立账务核验、刷新恢复、下载未验证。未重复运行旧暂停任务，未追加生图，未修改业务代码或stable。

## 后续根因排查与失败测试
- `canvas-presets.ts` 将旧assistant示例回复直接转换为成品步骤的`promptTemplate`，美食成品模板没有菜品变量。
- `step-registry.ts` 的`promptForStep`只编译当前模板；未传递完整结构化输入或已完成规划。`executor.ts`收集持久化outputs，但没有将它们传入后续步骤，也没有纳入步骤请求摘要。
- 2026-09-04 09:47运行`pnpm exec vitest run src/__tests__/lib/skill-runtime-step-registry-lineage.test.ts`：2项失败。输入有strawberry cake及restaurant menu，实际提交提示词只有render。证明缺口在请求构造，不是模型是否支持草莓。
- 修复必须覆盖结构化需求、上游已完成步骤、暂停恢复后的持久化输出及幂等请求摘要，不能仅给美食模板硬编码菜品；所有21个预设需契约回归。
- 保存冲突仍需独立定位。`transferCanvasSkillAsset`使用正确的`canvas:${projectId}`，不能仅凭Skill run的session workspace就认定转移目标错误。禁止删除冲突数据或放宽归属门禁。
- 本轮只补失败测试，未改生产代码；失败测试保留未跳过，未提交或推送。浏览器随后报告browser9不可用，未尝试新建标签或改用360，未重复付费任务。

## 保存冲突续查
- 后续只读报告提供了新图canvas placement为trashed的线索，但没有保留原始失败请求的全部字段，不能确定是哪条归属断言失败。报告中的“未扣费”不能采纳：本地真实schema使用credit_transactions.task_id/reference_id及cloud_tasks.id，需要按正确字段查询；不能用查不到记录覆盖POST charged=true。
- 10:07:03预览页Console再次捕获两条`[Sync] syncToServer: server returned 500`（UTC 02:07:03.569）。因此保存问题仍在，不能以Coze报告“无新错误”标为已修复。
- `handleAddEmbeddedChatImage`给出embedded-chat备用ID，但`handleAddImages`优先调用`canvasEntityIdForTransferredReference`采用服务端entityId。因此不能看到备用ID就判定它与placement必然不一致。
- `sanitizeWorkspaceAssetReference`保留entityId，服务端transfer响应也包含entityId；尚无证据支持“字段被清洗丢失”。
- Chrome已重连为browser10，同一正确扩展；原项目标签1727126152的“新对话7”已收到只读取证指令并开始执行。要求核对本run的checkpoint/资产/版本/placement、具体失败分支及父子任务收费记录；不拉取、不重启、不修改源码或数据、不调用供应商。未重复同步或生成。等待该同一指令结果，不重发。

## 已批准修复的本地进度
- 用户已明确批准上下文修正规格；以下覆盖上文“未改生产代码”的历史状态。
- 新任务冻结executionContextVersion=1、系统指令与输入字段；执行器将完整文本需求、前序已完成文本和当前步骤组合，并纳入步骤摘要。同组并行与未来输出隔离。
- 旧快照不自动升级，新快照恢复缺失或版本非法时明确失败，不重新读取最新目录替代。
- 21个画布预设的文本字段保留契约全部通过；含执行器、API准入、恢复及适配器在内119项专项通过，TypeScript通过。
- Lint为0错误/943历史警告；新文件按批准规格登记后38功能保护门禁通过。没有删除测试或放宽归属、扣费保护。
- 全量测试进行中；构建、推送与本次修复的云端语义验收尚未进行。Google Chrome11原预览1727126156已读取，未新建标签、未操作360、未追加扣费。

## 本轮结束检查点
- 全量测试10:09:05启动，454.35秒完成，退出0：630文件通过/27跳过，4955项通过/143跳过/0失败。原始日志：`output/skill-context-full-test.log`。
- 全量执行期间审查发现旧任务重复create可能尝试写入新版快照，先增加失败测试再修复：复用持久化run.created，摘要不一致仍拒绝，不改变扣费函数。最终120项专项通过，TypeScript及修改文件ESLint通过；保护门禁再次通过。
- 上述全量启动早于最后的兼容保护，因此不是最终固定源码的整套发布验收。最终全量、生产构建、云端语义与保存恢复仍未完成，不能推送为已验收版本。
- 本地main及origin/main均8237f5b6，当前改动未提交；origin/stable仍52f7c601，不触碰。没有后台测试进程遗留。
- 项目标签1727126152重新接管及刷新均提示调试未附着；同一Chrome的预览标签可读取。属于项目标签控制问题，不等于整个沙箱或Chrome断线。没有重复发送Coze指令。
- 保存500后续只读取证需使用`cloud_tasks.id`与`wujie_credit_transactions.task_id/reference_id`；不能按错误的ref_id字段推断未扣费。`trashStaleCanvasPlacements`会软删除不在当前映射中的画布placement，是需核对时序的线索，不是已确认根因，尚未改其保护逻辑。
