# V588-STABILITY-002 分层回退披露设计

## 目标

当智能元素拆解中的 Pear 分层未通过质量门禁、系统已完成退款并切换本地分层时，界面必须明确显示“Pear 未通过质量门禁，已退款并使用本地分层”，不能把父任务的 `completed` 误解为 Pear 远端成功。

## 数据边界

- `layer-decomposition` 子任务以数据库中的 `creditStatus` 为退款事实来源，并继续返回既有的 `fallbackReason`、`providerError` 和 `result.engine`。
- `element-decomposition` 父任务只负责完整投影子任务证据，不推断退款、不重新查询账务、不改变任务状态机。
- 客户端分支响应显式携带 `creditStatus`、`fallbackReason` 和 `providerError`。
- UI 仅在 `result.engine === 'local'`、存在 `fallbackReason` 且 `creditStatus === 'refunded'` 时使用“已退款”文案；其他本地执行或回退情况使用不含退款承诺的状态文案。

## 界面行为

- 可编辑图层分支卡片显示实际执行引擎。
- 已退款的 Pear 回退显示醒目的琥珀色说明：`Pear 未通过质量门禁，已退款并使用本地分层`。
- 完成 Toast 使用同一事实口径；父任务完成不再覆盖该提示为笼统的“元素拆解完成”。
- `providerError.message` 和 `fallbackReason` 仅作为可查看的诊断原因，不暴露密钥、令牌或完整上游响应。

## 不变约束

- 不调整 MAE、重复层、空层、越界层等质量门禁阈值。
- 不修改扣费、退款、取消、终态竞争和幂等状态机。
- 不发起新的付费 Pear 任务完成本地实现验证。
- `stable` 分支保持不变，修改只进入 `main`。

## 验证

- 服务测试证明子任务退款与回退元数据可穿过父任务响应。
- UI 契约测试证明分支卡片与完成 Toast 都明确披露回退。
- 聚焦测试、TypeScript、Lint、全量测试、构建全部通过后才提交。
- 云端只验证精确提交、静态资源、界面文案和既有任务展示；新的付费 Pear 成功链路留在后续专门验收。
