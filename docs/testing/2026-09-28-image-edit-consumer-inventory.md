# 图像编辑十动作调用者清单（2026-09-28）

> 2026-10-01 接续：工作流无效 `edit` 动作已有[专门设计](../superpowers/specs/2026-10-01-workflow-image-edit-contract-design.md)和[实施计划](../superpowers/plans/2026-10-01-workflow-image-edit-contract.md)。局部实现让语言修图/调色走 `/api/edit`、擦除/蒙版/扩展留在 `/api/image-edit`；擦除/蒙版现有 `in-mask` 端口并传 `editMode/maskImage`，缺蒙版发送前拒绝。普通/重试/循环编辑缺声明项目拒绝，循环编辑走提交与轮询。但文档工作区的可信来源/发布与普通异步任务恢复尚未实现，下表不得读成三工作区交付完成。

本清单只核对当前本地源码的数据流，不等于入口已迁移、来源已获授权或端到端通过。检索范围为 `src/` 中非测试的 `/api/image-edit` 字面引用，并沿工作流构建器、转发器和服务端准入函数核对实际请求。2026-10-01 复核特别区分**可达的按钮处理器**与仅留在源码中的旧回调：元素拆解当前走独立父任务 API，旧 `display_decompose→removebg` 回调未挂按钮。`action` 的公开十值为 `inpaint/outpaint/extend/remove_background/removebg/upscale/multi_angle/display_decompose/erase/mask`；服务端将 `extend→outpaint`、`erase/mask→inpaint`，但不接受 `edit`（`src/app/api/image-edit/route.ts:632-637`）。

| 消费者与实际动作 | 请求中的来源、范围与身份 | 当前性质及后继缺口 |
| --- | --- | --- |
| 无限画布放大：`upscale` 报价预览及确认 | `resolveCanvasUpscaleSource` 将文档项目和现有 `assetVersionId` 写入 `projectId/assetParentVersionIds`；无版本文档图明确停下，个人旧路径保留；确认携报价令牌和幂等键 | 已在 UI 请求体绑定文档版本，但只覆盖明确选择的 302 报价，不能外推到其他动作/工作区；相邻真实组件测试见 `canvas-document-upscale-entry.test.tsx`。 |
| 无限画布去背景：`infinite-canvas.tsx:9331-9543`，`remove_background` | 文档模式要求 `projectId` 和原图 `assetVersionId`、本地引擎；报价请求与确认请求带 `assetParentVersionIds`、选中实体和投影意图，确认带同一幂等键/报价令牌。个人模式保留旧请求。 | 仅文档 CPU/local 纵切有来源、报价、双角色发布与恢复的本地候选证据；AI 分支、其他动作和三工作区未据此验收。不能再写成“所有去背景请求均无版本”。 |
| 无限画布其余可达的 `/api/image-edit` POST：`multi_angle`、`inpaint`、`outpaint` | 仍以 `imageUrl` 发送，`inpaint` 的 `maskImage` 是画布 base64 蒙版；未见这几条请求体绑定文档项目/父版本或可信父证明。 | 文档画布发起时仍不能据此认作受权来源与协作发布；各自的来源、蒙版与账务合同继续待验。 |
| 无限画布元素拆解当前按钮：`infinite-canvas.tsx:10004-10135,17815-17816` | `handleDisplayDecomposeConfirm` 冻结项目、源图 ID、注释版本、URL 与尺寸；`createResolvedElementDecompositionRequest` 后向 `/api/element-decompose` 提交幂等父任务，按任务 ID 轮询板/图层分支。服务端 `verifyOwnedSource` 对照本人项目中的注释源版本和受管 URL。 | 这是独立父任务/分支合同，不是 `/api/image-edit` 的两次 POST，也不证明其板分支已是通用资产版本/三工作区共享结果。透明背景是父请求的板/图层选项；Pear 分层验证排除当前目标。 |
| 留存但未挂按钮的旧回调：`infinite-canvas.tsx:9845-9970` | `handleDisplayDecomposeLegacy` 中确有 `display_decompose→removebg`，第二段以第一段公开 `resultUrl` 为源；仅 `void handleDisplayDecomposeLegacy`，按钮绑定的是另一回调。 | 不应把这段静态源码当成当前画布用户链的待修入口。若未来重新开放旧入口，必须先设计受权的输出身份/版本与同键收费合同，不能只把公开 URL 当来源。 |
| 贴纸助手：`sticker-assistant-panel.tsx:257`，`remove_background` | `imageUrl`、模型 pair、RemoveBG 模型；无项目/版本/父证明 | 旧个人或未限定路径；先确认源图是用户输入还是前一生成任务结果，再设计受权导入。 |
| Agent 工具：`agent-edit-execution-service.ts:1239-1271`，`removebg` | `finalImageUrl`、模型 pair；内部请求头使用当前 actor，步骤有自己的幂等键；未向图像编辑传项目/来源版本/可信父预付证明 | Agent 的步骤追踪不自动等于图像编辑子任务的父付费授权或文档来源。 |
| 画布内 AI 对话工具：`/api/chat` 调用 `chat-tools.ts` 的 `removebg/upscale/extend` | `context.userId` 内部认证头及可选幂等键；图片由 `normalizeImageUrl` 取得；`ToolContext` 虽有 `projectId`，这三份请求体均未转发版本或项目 | 这是画布内嵌对话的旧图像编辑路径，不能误归为独立 `/api/simple-chat/chat`；后者当前只暴露 `generate_image` 工具并走 `/api/generate`，不直接调用这三种编辑动作。把会话项目存在误当来源授权会造成目标偏移。 |
| 人工精修：`human-repair-service.ts:313-341`，`inpaint` | `input.sourceImageUrl`、生成或手工 `maskImage`；可带内部用户头，未传项目/版本/父证明 | 蒙版为本地 data URL，尚非绑定 actor/project/request 的可恢复媒体准备。 |
| 工作流节点：`workflow-engine.ts` 的 `ai-edit/ai-removebg/ai-color-adjust` | 默认语言修图/调色输出 `/api/edit` 的 `image/prompt/model/providerId`，显式 `erase/mask/extend` 仍输出 `/api/image-edit` 的 `imageUrl/action`；`erase/mask` 由 `in-mask` 接收 `maskUrl` 并传 `editMode/maskImage`，无蒙版发送前拒绝。执行器补工作流项目作用域和子请求幂等头，但请求仍未绑定受权父版本。 | 默认动作不再误投十动作路由；无项目的四种 `ai-edit` 动作和调色在发送前失败，循环体编辑会等待子 taskId 终态。隔离 PostgreSQL 证明新文档节点缺父版本时 400/零消费，**不是**合法文档节点可用证明。旧显式 `assetWorkspace='workflow'` 的直接兼容调用仍可收费而无项目发布，尚待迁移；擦除/蒙版的受权蒙版来源、费用及发布仍未完成。 |
| Photoshop CEP 代理：`creative/photoshop/route.ts:23-31,38-51,116-132`，`mask/remove_background/upscale` | 转发 `payload.image/mask` 为 `imageUrl/maskImage`，仅转发 `Authorization` 请求头；请求体无项目/版本/父证明 | 代理先认证，但子请求是否能以具体凭证形式重新认证需单独验证；不能把 Photoshop 文档层当无界项目版本。`layer_decompose` 实际走 `/api/segment-elements`，不属于此路由。 |
| 三条放大兼容路由：`image/upscale/route.ts:65-78`、`upscayl/route.ts:53-64`、`image/upscale-pro/route.ts:878-898` | AI 分支直接调用 `image-edit` handler，保留原请求头；前两条展开原请求体，因此可保留显式项目/版本；`upscale-pro` 明确转发两字段 | 已有隔离 PG 两入口单任务/一次扣费及第三入口异步回退证据；不能据此宣称 Cookie/桌面/父预付/取消全矩阵完成。CPU 路径不是该 handler 的调用。 |

仅字面登记、非直接提交：`canvas-action-executor.ts:238-339` 的动作端点表当前在 `src/` 无调用点，且 `crop/color_adjust/add_text/composite` 标注为本地或返回不被本清单当作真实 POST；`dashboard-view.tsx:3999`、`creative/health/route.ts:40` 是说明/健康条目；`operation-audit.ts:5`、任务恢复/轮询及 `task-core` 中的路由字面量是审计或身份匹配。工作流实际网络发起点由节点构建器决定，不把三个 endpoint 字符串误算成三处独立 fetch。

`canvas-edit-admission.ts` 已有可借用的文档准入模式：按有序父版本解析来源，对 `body.image + referenceImages` 逐项做同源精确比较，随后原子发布路径可再复核授权与来源。`image-edit` 当前字段则是 `imageUrl + maskImage`；`image-edit-source-admission.ts` 在文档访问且 `action=upscale/removebg/remove_background` 时校验**一个**父版本和规范 URL，其余动作原样返回 URL。去背景只有显式 CPU/local 纵切具备后续锁内复验、终态与双角色发布，不能外推到 AI 分支。不可直接复用不同字段名，也不可把蒙版 data URL 当作资产版本；其余动作仍需逐动作的多来源顺序、媒体准备、执行前/恢复后复验与最终发布屏障。

下一批应以**当前可达消费者**为准：文档 `remove_background` 的伪 URL/撤权零净收费已有隔离真库纵切证据，不再重复立同一 RED；向其 AI 分支及其他动作扩展前，先补对应来源、账务与发布合同。工作流 `edit` 无效分支另做独立真实请求验证与路由决策，避免在来源修复中混入另一合同。仍须完成按显式 pair、自动候选、配置免费及可信父预付的账本基线；本清单不勾整个 Task 1，也不解除保护基线或发布门禁。Pear 分层验证不参与当前目标，PSD 核心保留。
