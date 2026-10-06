# 图像编辑执行模型身份设计

## 目标与完整链路位置

将 `/api/image-edit` 的实际执行与获准模型精确绑定，覆盖 erase、mask、inpaint、extend、outpaint、upscale、removebg、remove_background、multi_angle、display_decompose 全部入口。这是完整编辑链路的执行路由阶段，不是重复 Task8Cb3j1 项目权限检查，也不是完整协作编辑验收。

完整终态仍要求：统一服务器 actor 与本人计费；数据库父任务/lease/operation 证明后的预付继承；同一权威 task 的提交、恢复、退款；素材来源冻结与逐次复验；主体图和可选蒙版各自稳定身份；UI/三工作区/撤销及云端验收。不得以本阶段关闭上述义务。Pear 分层验证继续排除，现有 PSD 核心保留。

## 方案比较与决定

1. **采用：抽出请求级模型执行计划，并让现有执行分支消费它。** 复用管理员模型目录与授权规则；先校验，再收费，执行与轮询保持同一精确模型身份。保留已有协议和图像处理分支，供后续持久任务执行器迁移。
2. 不采用直接复制整条 route 新建第二套执行器：会复制协议、计费与 fallback 缺陷，维护两套状态。
3. 不采用仅在入口检查 providerId：旧的专用模型插队、视觉 fallback、轮询裸模型重查与质量增强仍可能越过检查。

用户已授权自主执行和 main-only。本轮无需再次确认，不提交、不部署、不安装，不更改业务配置或数据库。

## 本阶段绑定合同

### 1. 一次请求的配置与用户授权快照

新增 server-only `src/lib/task-core/image-edit-model-plan.ts`。输入为真实认证 user、source、请求 action/model/providerId/upscaleModel；读取服务器管理员模型配置。内部认证必须按认证 userId 读取真实 managed user，不能把内部头构造的全权限或 role 当作模型授权事实。cookie/desktop 使用认证所得用户；不使用二次 Cookie 身份决定模型权限。用户缺失/禁用返回 403。

复用 `getConfiguredModelsForProviders` 和 `resolveTaskModelCatalogResultFromSnapshot`，使用同一 providers 快照生成可见精确键，保留既有唯一裸键迁移/歧义拒绝语义，不另写简化授权逻辑。候选必须 enabled、存在于已启用模型列表、凭证完整且 action 类型匹配。upscaler 只参与 upscale，removebg 只参与去背景；image/imageEdit 类型为通用图像候选，chat/vlm 仅为辅助视觉候选。universal/general 按每个 model 的有效类型，而不是整个 provider 类型决定。

### 2. 请求选择与错误

`providerId::modelId` 与独立 providerId 冲突返回 400 `IMAGE_EDIT_MODEL_PROVIDER_MISMATCH`；非法非字符串模型/provider/upscaleModel（包括对象）返回 400 `IMAGE_EDIT_INVALID_MODEL_SELECTION`。缺省 model 仍兼容既有默认值；upscaleModel 是放大动作的实际选择，允许旧 UI 同时传通用 model，不以通用 model 冒充放大身份。已有 302 别名映射和 SeedVR2 未验证拒绝保持。

显式 providerId（含复合键）只允许该 provider 的选定模型；不存在/未启用/不匹配拒绝，未授权返回 403 `IMAGE_EDIT_MODEL_NOT_AUTHORIZED`，不自动切换。没有显式 provider 时保留自动选择，但只在授权且匹配 action 的候选中选择，按精确 providerId+modelId 去重，不能按裸模型名误合并两个供应商。无候选返回 400 `IMAGE_EDIT_MODEL_UNAVAILABLE`；不使用游离环境 API Key 绕过管理员配置和用户授权。

模型配置读取异常必须失败关闭，返回脱敏 503 `IMAGE_EDIT_MODEL_PLAN_UNAVAILABLE`。所有这些拒绝在积分扣除、任务登记、媒体读取和供应商请求之前发生；原项目准入仍在模型规划之前。

真实配置读取须使用显式严格只读模式：配置了数据库则数据库为唯一权威，空表是空配置，读取失败不能回退旧文件；没有配置数据库时只读文件，ENOENT为空配置，损坏/不可读/非法结构为异常。严格模式不触发配置迁移；其他既有调用默认兼容行为不变。测试须经过真实两层读取函数，只在SQL/文件IO边界注入故障，不能只把顶层配置函数mock成抛错。

### 3. 实际执行消费，不只入口校验

候选计划包含规范 modelId/providerId、服务器端凭证、baseUrl、必要协议参数与 provider 快照；凭证仅请求内使用，不将新计划写日志/JSON响应/任务描述符。

移除 route 的旧候选构建与 env fallback。专用去背景选择必须是已授权的那一个模型，不能到执行时用 selectedModel/列表首项覆盖；自动模式可有多个精确专用候选。视觉描述与图像 fallback 必须消费已授权快照，不重新枚举管理员全部模型。显式选择下图像 fallback 不得切供应商/模型，辅助视觉只能使用已准入辅助模型。

`autoTrySubmitImageTask` 的结果携带真实 providerId（以及已有协议元数据），所有选择 usedCandidate、持久任务审计和轮询按该精确身份；不能用 `.find(c => c.model === usedModel)` 或裸模型全局重查。比例重试的失败集合也按精确身份。异步擦除轮询必须使用提交候选的凭证和 profile，不重新找同名供应商。

放大后的 `enhanceViaAI` 增加可选的服务器内部已准入目标参数；image-edit 必须传入计划中可用于图像增强的精确目标，没有此类目标就返回已有放大结果，不重查未授权供应商。该 helper 的其他旧调用保持兼容，不扩大到全项目重构。新参数不来自请求体。

### 4. 与下一阶段的边界

本阶段不替换 cookie-only 收费身份：旧 Agent 内部调用可能已在父任务收费，直接改为 auth.user 会双扣；不能把这个缺陷称为完成。下一段必须将普通本人收费和数据库证明的父任务预付一起接入原子 task admission。旧无父 task 链接的 Agent 预付不能伪造证明，须迁移父入口。

本阶段请求快照不是跨进程持久冻结。后续持久执行必须保存去密描述符、来源及输出角色，供应商提交不确定时不自动重发，恢复只读 checkpoint；本阶段不宣称解决所有未知提交重试。主体图 revision 和辅助 mask 的派生资产要使用明确的不同 publication 角色，不能用全局 revision 使蒙版覆盖原图资产头。

## 验收矩阵

- 真实 route RED：显式 A::model 加 provider B；无效/禁用 provider；未授权选择（含真实内部 actor 与冲突 Cookie）；旧 route 应暴露先扣费/选错模型，而不是测试导入错误。
- 规划行为：十 action 类型、exact/复合键、非法字段、默认/专用模型、同名跨供应商、授权唯一/歧义裸键、缺用户/disabled、缺凭证/禁用配置、配置异常、env Key 不能补授权；真实模型目录算法，仅存储与外部 IO 替身。
- 实际供应商边界：显式 A 失败时 B 零请求；自动 A/B 同名且 A 明确能力拒绝时 B 可执行，持久身份和轮询凭证属于 B；专用 removebg 只发送获准模型而非 provider 默认模型；视觉 fallback/增强不能重读未授权配置。协议兼容与真实分支返回结果同时断言，不能只测 mock 存在。
- 原 j1 项目拒绝矩阵保持真实 PG，合法项目的旧扣费停点因先规划而调整 fixture，不削弱拒绝断言或伪造总通过。
- 受影响完整回归、非增量 TypeScript、定向 ESLint、独立规范与质量审查；全仓/build/云端另列未验证。
