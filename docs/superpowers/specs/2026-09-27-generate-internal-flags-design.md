# 普通生成内部执行标记信任边界

## 在总目标中的位置

Task8Cb3i1 是普通生成完整协作接入的前置修复，不是该入口整体完成。3f 批次、3g 语言修图、3h 第三方生成的已关闭工作不重做。普通非 submitOnly 的调用前原子计费/任务创建、完整请求冻结、逐输出恢复、原始协议与响应兼容仍必须交付；本子项不以一个参数校验代替那些要求。

只修改本地 main，不提交、推送、安装、改业务数据库、调用供应商、同步 Coze 或部署；stable/供体/用户原修改只读。Pear 分层验证移出范围，PSD 保留。

## 现状与根因假设

`generate/route.ts` 从 JSON 直接读取 `_skipCredits` 与 `_skipCloudTaskPersistence`，后续分别控制扣费与持久化。`api-auth.ts` 已将认证来源区分为 cookie、desktop-token、internal，但普通生成未将上述标记绑定到来源。协作 submitOnly 有局部拒绝，不覆盖普通生成、私有项目与旧 wrapper。

`poll-task/route.ts` 的恢复请求及 generate 内旧 wrapper 使用真实 `getInternalRequestHeaders` 携带两个布尔 true。Skill 的 strict/prepaid 另有父执行围栏，不能因为新增入口检查而失效。该假设需用真实 POST、真实 api-auth 加离线依赖观察先获得 RED。

## 方案比较与选择

1. 选择：在已认证且 JSON 已解析后、项目授权/模型查找/媒体转换前做集中检查。使用认证返回的 `source`，不再检查或信任客户端自行传入的 internal/strict header。
2. 不选：只在 document 分支拒绝。其余入口仍可跳过账务，且未来改分支会再次漏检。
3. 不选：删除内部标记或强制所有请求重新扣费。现有恢复和 Skill 子任务会重复扣费，违反统一账务要求。

## 精确合同

- 认证失败仍返回原 401，不被标记错误覆盖。
- 任一标记存在且不是 boolean（含 null、字符串、数字、数组、对象），返回 HTTP 400，`success:false`、`code:GENERATION_INVALID_INTERNAL_FLAGS`、中文错误、`retryable:false`。
- 两标记未提供或为 false：允许继续原流程，不能自行打开跳过能力。
- 任一标记为 true 且 `authResult.source !== 'internal'`：返回 HTTP 400，`success:false`、`code:GENERATION_INTERNAL_FLAGS_FORBIDDEN`、中文错误、`retryable:false`。浏览器管理员、cookie、desktop-token 同样适用。
- 内部认证成功、标记类型正确：保留原标记组合与后续行为；不新增任务、不改变计费、不替代已有 Skill prepaid/fence 验证。
- 所有拒绝均发生在项目授权、模型查找、媒体下载/保存、计费、任务创建/注册及 after 派发前。
- 不修改供应商协议、输出数量、taskIds、directImageUrls、prompt 增强、fallback、持久化或取消算法。

## 测试与证据要求

新行为测试调用真实 POST 与真实认证来源解析；只替换会读业务数据或调用外部网络的边界，禁止真实供应商请求。用离线固定 secret 测 valid internal、缺/错 secret+有效 cookie、仅伪造 header、未登录401，以及 desktop bearer。明确无效请求没有下游副作用。

覆盖两个标记分别 true/组合、非布尔畸形值、普通/管理员浏览器、submitOnly true/false 与旧 wrapper 开关、unscoped/personal/document 路由意图。正常 false/缺省及真实内部恢复请求必须有进入原流程的正例；不是仅测试自己写的假 guard。现有 Agent prepaid 消费者测试继续通过，伪造 strict 的原测试移除与其意图无关的 skip 标记，保留 MODEL_PROVIDER_MISMATCH 与零外呼断言。

独立审查通过和限定回归完成后才能关闭 3i1；完整 PG/云端/全程序/发布仍在原 Task9。这个测试不冒充真实扣费、退款或恢复成功。
