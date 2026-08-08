# 人物精修大师 Ultimate 实施报告

## 已完成

- 接入图片浮动工具栏、图片右键菜单、画布底部工具栏三处入口。
- 新增一键修复、专业修复、候选排序与批量 URL 修复界面。
- 新增人物、人脸、左右手、身体、脚部、头发、服装和人机交互区域的检测数据契约。
- 新增自动蒙版规格；专业模式可传入手动蒙版 URL 或 data URL 覆盖自动蒙版。
- 默认锁定身份、发型、服装、姿态、背景、文字、Logo 和产品；候选未通过蒙版外保护校验不能被选中。
- 新增 `/api/human/analyze`、`/api/human/repair`、`/api/human/task/:id`、`/api/human/select`。
- 所有候选和确认结果保存为新图片版本，源图不覆盖。
- 新增 `ai-human-repair` 工作流节点。
- Mock Provider 用于无密钥测试；真实调用通过既有 `/api/image-edit` 路由完成。

## Provider 与环境变量

- `HUMAN_AI_ENGINE_MODE=mock`：强制 Mock Provider，适用于 CI。
- `HUMAN_AI_ALLOW_FLUX_BODY=true`：允许大范围身体/脚部修复选择 FLUX；默认仍使用 GPT Image 编辑路径。
- 真实模式需要在 UI/节点指定已由管理员配置的图像编辑模型和 Provider；密钥继续由现有 Provider 配置管理，不能写入前端或本模块环境变量。
- `pnpm human:smoke-test` 默认跳过；只有设置 `HUMAN_AI_SMOKE_TEST=true`、`HUMAN_AI_SMOKE_IMAGE_URL`、`HUMAN_AI_SMOKE_MODEL` 与 `HUMAN_AI_SMOKE_SESSION_COOKIE` 时才会提交一次真实人脸精修任务。

## 已验证

- `pnpm human:virtual-test`：通过，验证 8 类目标、自动蒙版、保护提示、候选排序与失败候选过滤。
- `pnpm lint`：通过。
- `pnpm ts-check`：通过。
- `pnpm test`：58 个测试文件、312 项测试通过。
- `pnpm build`：通过，构建识别 96 个页面和全部 `/api/human/*` 路由。

## 验收步骤

1. 选择一张人物图片，分别从浮动工具栏、右键菜单和底部工具栏打开“人物精修大师”。
2. 点击“检测人物”，确认人脸、左右手等区域与评分出现。
3. 使用一键修复，确认候选结果作为新图片添加到画布，原图保持不变。
4. 使用专业修复，勾选单独部位、调整强度和候选数，并传入手动蒙版验证覆盖自动蒙版。
5. 选择已配置 GPT Image 编辑模型后，执行真实人脸/手部修复；检查文字、Logo、产品和蒙版外区域保持不变。
6. 在节点模式添加“人物智能修复”并连接图片输入，确认可提交人物修复任务。

## 限制与云端验收项

- 当前无本地登录会话及真实模型密钥，真实 Provider 的视觉质量、异步模型回调和积分扣费需要在扣子环境验证。
- 内置 Mock 检测器只验证流程契约，不代表真实人脸/手部定位质量；接入真实 VLM/人体检测服务时应替换为同一 `HumanAnalysis` 契约的适配器。
- 付费模型 smoke test 默认关闭，不会进入 CI。
