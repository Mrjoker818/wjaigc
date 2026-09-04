# Skill 步骤显示云端复验

测试时间：2026-09-04 07:50 起（北京时间）。
环境：Google Chrome 用户1，现有 Coze 项目 7671964106919837702；预览域名 62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.coze.site。

## 版本与连接

- Coze 最终报告称源码树 39e1efa9 匹配 main@593f9f45，业务修复 e43a12fe，Build ID 为 to80Dr09VceukIA3ltXSx；这些是报告证据，不等于独立进程版本证明。
- 报告声称 628 文件通过、27 跳过，却写总计644，存在算术不一致；原始测试统计尚需核对，不重跑或重复构建。
- 已在现有 Google Chrome 预览标签页通过 Page.reload(ignoreCache:true) 强制刷新。Mr.joker 管理员保持登录，项目仪表盘显示10项目、453图片。
- 点击已有10图项目进入画布，并从画布 AI 聊天打开21项 Skills；未进入独立智能对话。

## 真实任务

- 项目：project_1786341961637_hxc3szbke。
- runId：6b1b53b7-99ed-43aa-84a7-7fc17737f91c。
- Skill：preset-food-photography，美食摄影风格图。
- 输入：草莓蛋糕、西式甜点、45度角、温暖自然光、餐饮菜单摄影。
- 估算：62积分。仅一次创建，POST /api/skill-runs 返回201，reused=false、charged=true。
- 创建时间：2026-09-03T23:50:31.812Z。
- 图像绑定：api_1778430731224_533e09a / gpt-image-2。
- 编排绑定：api_1778428130626_2qpg71v / gemini-3.1-flash-lite-preview。
- CDP网络请求身份：7220.508（创建）、7220.530（阶段事件）、7220.581（首次暂停完整事件）、7220.636（重试后完整事件）。这些不是应用requestId。

## 实际结果

1. 冻结步骤列表真实显示：需求规划执行中、成品交付待执行。
2. 需求规划成功返回文本；成品交付失败。UI显示需求规划已完成、成品交付失败，父状态已暂停，出现“从失败步骤重试”。截图已在本次对话展示。
3. 点击一次“从失败步骤重试”：同一runId产生sequence6 run.resumed，generation=1、nextStepId=conversation-2；未重新执行需求规划。
4. sequence7和8均出现该步骤tool.started，其中7的toolId为conversation-2，8为generate_image。是否属于冗余事件待检查，未据此直接修改。
5. sequence9再次run.paused，pauseReason=execution-error。没有成品图片。
6. 暂停事件未携带具体错误原因，当前不能归因于供应商或程序。任务保留暂停用于定位，未继续重试；真实账务、退款及资产版本成功链路未验收。

## 判定

步骤显示及失败步骤重试入口取得真实正向证据；整个Skill成品链路不通过。不可把本次结果写为Skill全部通过。
后续从此runId核查服务端错误及供应商任务，不重复创建父任务。未修改业务源码、未触碰stable、未新增浏览器标签页。

## 根因核查进展

- 已在原 Coze 对话发送一次只读核查，要求查询此run、关联子任务、供应商任务身份、脱敏错误和扣费退款，不允许修改或重试。实际观察到其开始查询cloud_tasks和wujie_agent_events；尚未读到最终结果，项目页随后Debugger unattached。不得因观察中断重新发送诊断或重启。
- 本地确定的错误可观测性缺口：executor.ts把捕获的error传入pauseForRetry；service.ts中该回调仅解构stepId/executionFence并调用pauseAgentRun，未传递error。因此事件缺少具体错误信息有明确代码依据，但不是成品生成失败根因的证明。
- 尚未修改任何业务代码。下一步读取原云端诊断结果，再以可复现证据决定最小修复边界。

## 08:05 重连后取得云端报告

- 原Coze只读诊断已完成，未重复发送。日志07:50:42显示APImart返回400 / invalid_quality：This model only supports auto, low, medium or high quality (got: 1K).
- 报告关联的本地子taskId为async-1788479438773-0-yjwar2；不能把这个本地任务号冒充供应商远端任务号。
- 本地源码核实来源：step-registry.ts的executeGenerationStep调用generate_image时没有传quality；chat-tools.ts的executeGenerateImage以(args.quality as string) || '1K'作为默认值。因此不是Skill预设显式传入，也不是管理员配置错误。
- 错误随后被泛化为“上游服务暂时不可用，正在自动重试”，与参数400不匹配，误导了故障分类。
- 第二次generation1的供应商请求未取得证据；报告也称其未提交即暂停。不得写成供应商两次拒绝已独立验证。
- 账务报告为父任务一次-62，交易ctx_charge_a715dc0b2d120da4e5e01668425b3fd8，余额144，无退款。父任务仍暂停/processing，不是失败终态，因此无退款本身不足以判定退款缺陷。子任务完整账务仍待验证。
- 报告修正测试文件总数为655=628+27；其中关于本地681文件及Playwright范围的推断没有依据，不采纳。
- 最小修复调查边界：精确provider/model能力下质量与分辨率的默认值分离、参数错误原始原因保留、错误暂停详情。不得改供应商配置、登录或直接改账本。
