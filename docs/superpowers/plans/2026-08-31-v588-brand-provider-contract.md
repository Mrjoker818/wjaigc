# 品牌电商精确供应商请求契约修复

> 执行要求：使用 executing-plans 按任务推进。延续已批准的 V5.8.8 选择性吸收及精确 provider/model 约束，不扩展 UI 或后端架构。

**目标：** 修复已在真实 React 组件隔离测试中复现的品牌供应商选择丢失问题；完整云端验收仍独立保留。

**架构：** 保留品牌面板和设置组件以及现有后端 API；前端维持模型/供应商配对状态，请求传后端已存在的 `providerId`。复用 `resolvePersistedModelSelection` 处理旧选择，不引入第二套模型目录。

**技术栈：** React 19、TypeScript、Vitest、Testing Library。

## 边界

- 基线 main@05e8e721；仅 main，stable 和 V5.8.8 donor 只读。
- 不修改品牌模板、布局、后端执行器、认证、用户权限、积分或供应商配置。
- 不把隔离网络响应计作真实生成成功；原 Chrome 云端结果、计费及刷新仍必须验证。
- 只处理品牌的 OBS-001；字境与精修回退观察保持独立，不一并重写。

## 任务与验证

- [x] 阅读真实 API 契约与调用方。品牌请求当前使用 imageProviderId，而后端读取 providerId。
- [x] 新增 `src/__tests__/components/brand-ecommerce-provider-selection.test.tsx`，直接渲染真实父/子组件，仅隔离网络边界；初始环境 localStorage 错误单列保留。
- [x] 初始 4 项业务断言 RED 已复现：提交字段、同名切换、旧存储恢复、React 菜单键冲突。
- [x] 补单模板重试、歧义旧模型及品牌资产读写 RED，8 项业务断言全部失败；保留所有失败日志，不删除失败用例。
- [x] 在 `brand-ecommerce-panel.tsx` 将批量生成/重试的字段改为 `providerId`，配对更新状态及回调依赖；恢复旧 JSON、精确键和唯一裸键，歧义时要求重新选择且不改旧数据。
- [x] 在 `BrandSettingsForm.tsx` 让选项同时携带模型和供应商，菜单键/高亮/回显按两者匹配；保存格式同时保留 model/providerId 和精确 modelId，避免旧值覆盖新选择。
- [x] 运行专项：`pnpm exec vitest run src/__tests__/components/brand-ecommerce-provider-selection.test.tsx src/__tests__/lib/model-defaults.test.ts src/__tests__/api/provider-result-stores.test.ts`，3 文件 36/36，0 跳过。
- [x] TypeScript、lint:build、608文件4446项完整自动化（隔离 PostgreSQL、零跳过）通过；同src树的独立检出默认堆构建118/118、退出0，保护38/38通过。原目录4GB构建OOM及8GB主动终止原件保留，不改云端配置。
- [x] 独立只读审查确认本次未发现新增缺陷；两项旧问题另列：单模板重试收尾、LLM 供应商成对切换。本次不宣称整品牌功能通过。
- [x] 在既有干净验证检出执行保护门禁：38 个功能均在，两个本次组件触发未登记漂移；仅登记这两个已批准路径，不新增目录通配、不改功能清单或放宽其他规则。
- [x] 更新 Bug/回归/验收断点和 Obsidian，明确本地与云端各自状态；机器证据为 docs/testing/evidence/v588-provider-003-brand-contract-20260831.json。
- [ ] 原 Google Chrome 验证：Pear 与 APImart 同名模型分别提交、单模板重试、任务真实供应商和落图、保存刷新。连接未恢复前不得标完整关闭。

## 自查

范围仅两个现有前端组件，后端字段已存在，无数据库迁移或新依赖。保留请求输入、模板数、变体数和用户历史数据；歧义不静默换供应商。测试失败原件、实际生成结果与未验证边界分别记录。
