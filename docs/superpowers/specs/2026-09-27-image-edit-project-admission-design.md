# 图像编辑接入：项目准入边界

## 目标与完整范围

Task8Cb3j1 将真实 `/api/image-edit` POST 接入现有项目权限策略，所有编辑动作在供应商配置、图片读取、扣费、任务登记前完成授权。它是后续完整图像编辑原子接入的必要步骤，不是图像编辑、协作阶段或整个平台完成。

其后仍须接通：统一认证身份与可信已付费父任务证明、模型/费用/来源冻结、原子任务与 publication、执行 lease、逐次提交恢复、取消唯一退款、来源最终复验、多结果（含可选蒙版）发布和真实 UI。视频、Skill 继承、三工作区、撤销、草图及发布门禁继续开放。Pear 分层验证按范围决定排除；PSD 核心保留。

## 源码依据与方案选择

- 当前 route 的 `requireApiAuthOrReject` 支持 Cookie、桌面令牌和可信内部请求，但随后重新调用 Cookie-only `getSessionUser`；当前没有项目准入。
- Agent 编辑执行服务的 remove_background 已在付费父任务下调用此 route，使用内部请求头但未携带项目或显式预付证明。直接将 `sessionUser` 全部换成统一 actor 会改变其计费，可能二次扣费。
- `getTrustedRequestAgentExecutionFence` 只证明内部认证和头部结构；并未锁定数据库父任务、execution lease 或 operation，不能单独当作免付费授权。
- 既有 `authorizeGenerationProject` 已提供真实 PostgreSQL 项目/owner/editor/global-switch 校验，且只返回当时的准入事实，不能替代最终发布事务。

比较三种方案：仅替换 session 身份不能解决项目越权且会改变子任务计费；一次重写整个大路由把多种协议、收费和执行模型耦合到一次交付；选择先交付所有动作共用准入，再完成可信计费与 durable 执行。不得因此缩减最终范围，也不新建第二套权限规则。

## j1 行为合同

1. 保留真实统一认证，匿名请求在解析 JSON 前返回 401。认证后解析 JSON，非对象/null/数组或非法 JSON 返回 400，`code: IMAGE_EDIT_INVALID_REQUEST`、中文错误，不泄露解析栈。
2. 对完整对象调用 `authorizeGenerationProject({actorUserId: authResult.userId, projectId: body.projectId})`。只取服务器认证 actor；body 的 userId、ownerId、projectAccess、skip、伪造 grant 等不提供授权。内部 secret 认证优先于 Cookie 时必须使用内部 actor 授权。
3. 授权位置必须在 Cookie 二次读取、model/provider 查询、图片/文件读取、任何积分计算/消费/退款、任务登记/持久化、后台派发及外部网络之前。计时和 requestId 初始化不算业务副作用。
4. 复用原错误合同：非法 projectId 为 400/GENERATION_PROJECT_INVALID；外国/未知/归档项目、非 editor、撤权、禁用账号/owner、协作开关关闭或文档状态不一致为 403/GENERATION_PROJECT_FORBIDDEN；数据库不可用为 503/GENERATION_PROJECT_UNAVAILABLE。错误体只包含 success:false、code、error。权限错误直接返回，不进入旧通用异常退款分支。
5. undefined/null/空 projectId 保持既有 unscoped；本人普通项目/唯一合法 legacy 项目/活跃协作 owner/editor 继续到原动作流程。不把 unscoped 当作媒体读取或共享发布授权。
6. 十个当前 action（erase/mask/upscale/extend/removebg/inpaint/outpaint/remove_background/multi_angle/display_decompose）共用上述入口，不只覆盖 302 放大。保留现有 action 参数校验与响应。
7. j1 不改二次 session、旧积分/模型/执行协议、来源处理、现有子任务和客户端请求；不会以 `internal` 等同 `prepaid`。现有问题明确留给下一完整计费接入，不以 j1 测试证明收费正确。

## 测试与证据

调用真实 POST、真实 api-auth、真实 authorizeGenerationProject 和隔离 PostgreSQL。仅凭证存储及下游模型、媒体、账务/任务边界使用离线替身；负例检查没有抵达这些边界，不代表替身证明实际结算。所有网络默认拒绝，不读取业务库和真实图片，不调用模型。

先在原 route 上写非法/外国项目与下游零副作用测试，保留实际失败，再最小接线。矩阵覆盖三种认证、内部优先于 Cookie、body 授权伪造、全部 action、非法 body/project、真实权限撤回/重授及状态变化、数据库缺表异常脱敏、unscoped 与正常项目继续到原动作/积分边界。授权事务在后续调用前释放连接。

旧编辑和 302 合同、已有项目准入真实 PG 测试、非增量 TypeScript 与变更文件 ESLint 必须运行；不得通过修改既有测试断言适配。全仓、构建、云端未运行则明确未验证。

## 执行边界

仅本地 main，保留 dirty 和七保护文件；不 stage/commit/push，不创建分支/worktree，不触碰 stable/donor/.env，不安装，不接业务库/供应商/付费/Coze/部署。复用原隔离测试库 `127.0.0.1:55492/wujie_yjs_task8cb3i2_20260927`，每例独立 schema、串行执行、禁止同时运行同库测试；不启停 PostgreSQL，不清理旧数据/媒体。所有 shell 首句加载本计划 `task-8cb3i2-environment.ps1`。用户已授权无需逐步确认，按此自主裁定执行；不重复建立已关闭任务。

自审：无新权限体系；外部非对象请求可控拒绝；认证与计费身份差异已显式保留为后继义务；不把当时准入升级为来源/发布授权；scope 与错误合同一致。
