# V588-PROVIDER-002 精确模型授权写入门禁实施计划

> 依据：`docs/superpowers/specs/2026-08-30-v588-provider-002-exact-model-authorization-design.md`
>
> 约束：V5.8.8 donor 与 `stable` 全程只读；只修改 `main`；严格 RED -> 最小实现 -> 专项回归 -> 全量回归 -> exact-SHA 云端验收。

## 任务 1：建立纯规范化器 RED 测试

- [x] 新建 `src/__tests__/lib/admin-model-authorization.test.ts`。
- [x] 覆盖唯一裸键迁移、多供应商同名歧义、无效/禁用精确键、命名空间错误、畸形/非字符串输入、稳定去重和空数组。
- [x] 运行该测试并保存旧代码缺少模块/行为的 RED 输出，不修改生产代码。

验证：

```powershell
pnpm exec vitest run src/__tests__/lib/admin-model-authorization.test.ts
```

## 任务 2：实现纯规范化器

- [x] 新建 `src/lib/admin-model-authorization.ts`。
- [x] 只消费公开 `ModelInfo[]`，不读取数据库、网络或私有凭证。
- [x] 输出精确 `providerId::modelId` 数组、迁移记录或结构化歧义/无效错误。
- [x] 运行任务 1 测试转绿并执行 `git diff --check`。

## 任务 3：建立管理员 API 写入边界 RED 测试

- [x] 新建 `src/__tests__/api/admin-model-authorization.test.ts`。
- [x] Mock `getPublicModelCatalogSnapshot()`、`updateManagedUser()` 与 `dbAddAuditLog()`。
- [x] 证明旧 API 对歧义与无效授权会写入，记录稳定 RED。
- [x] 覆盖唯一裸键迁移、chat/image 共用一次快照、无模型字段零目录读取、非管理员目录读取前拒绝。

验证：

```powershell
pnpm exec vitest run src/__tests__/api/admin-model-authorization.test.ts
```

## 任务 4：接入管理员 API 最小门禁

- [x] 修改 `src/app/api/admin/users/route.ts`。
- [x] 仅当 update 请求包含模型授权字段时读取一次公开目录快照。
- [x] 任一字段失败时返回 409/400，确保用户更新和成功审计均为零调用。
- [x] 成功时只把规范化精确键写入，并在脱敏审计中记录迁移数量。
- [x] 保留 `undefined` 不更新、`[]` 不限的既有语义。
- [x] 运行任务 1、3 与既有管理员用户专项。

## 任务 5：建立并补齐管理员界面反馈合同

- [x] 扩展 `src/__tests__/components/dashboard-model-authorization-contract.test.ts`，先证明当前回调未检查 HTTP/业务失败。
- [x] 修改 `src/components/dashboard/dashboard-view.tsx`：仅成功刷新，成功/歧义/无效/网络失败均有明确 toast。
- [x] 不改变授权选择器布局、选项来源和空数组行为。
- [x] 运行组件合同测试转绿。

## 任务 6：专项与全量回归

- [x] 运行新纯函数、API、组件测试。
- [x] 回归管理员用户投影、密码审计、模型目录、普通用户目录、生成面板授权合同与任务精确路由。
- [x] 运行 TypeScript、构建版 Lint、全仓测试与 8 GiB 生产构建。
- [x] 披露所有跳过项；失败不得删除、屏蔽或扩大白名单。
- [x] 以实现提交为来源登记新生产文件的精确路径后，在干净候选工作树重跑保护基线。

```powershell
pnpm exec vitest run src/__tests__/lib/admin-model-authorization.test.ts src/__tests__/api/admin-model-authorization.test.ts src/__tests__/components/dashboard-model-authorization-contract.test.ts src/__tests__/api/admin-user-projection.test.ts src/__tests__/api/admin-users-password-audit.test.ts src/__tests__/api/models-configured-catalog.test.ts src/__tests__/api/models-defaults.test.ts src/__tests__/lib/task-model-catalog.test.ts
pnpm check:protected-baseline
pnpm ts-check
pnpm lint:build
pnpm test
$env:NODE_OPTIONS='--max-old-space-size=8192'; pnpm build
git diff --check
```

## 任务 7：记录、提交与云端真实验收

- [x] 更新 V5.8.8 吸收清单、Bug 登记、回归报告、发布准备报告和未验证项。
- [x] 创建本地机器可读证据，包含 base/head/tree、测试统计、构建、保护基线和 `stable` 哈希。
- [x] 原候选已只推送 `main` 并在 `318fe2d7` Coze 验证，`origin/stable` 未变化；2026-08-31 空数组补丁另行记录，不重复原候选流程。
- [x] 原候选 `318fe2d7` 已完成 Coze 拉取、单一 5000 重启和原 Google Chrome 标签强刷；新补丁已在 `f91ada6b` 完成构建重启与两次强刷，不重复部署。
- [x] 管理员有效精确授权保存、关闭重开保持、恢复“不限”：`318fe2d7` 真实 UI 和 POST 证据已取得。
- [x] 管理员唯一裸键迁移：2026-08-31 Chrome 真实请求 `24252.14545` 提交 `nano-banana-2-lite`，200/success；关闭重开与刷新读取 `24252.14624`，持久化为 Pear 精确键；成功审计记录 image 迁移 1 次。
- [x] 管理员歧义拒绝：Chrome 请求 `24252.14445` 返回 `409 MODEL_ASSIGNMENT_AMBIGUOUS`、候选 6；复读整个用户不变，操作日志没有新增成功记录。较早一次 Coze 沙箱 500 另行保留，不当作授权结果。
- [x] 管理员无效授权拒绝：Chrome 请求 `24252.14237` 返回 `400 MODEL_ASSIGNMENT_INVALID`；强刷后复读整个用户不变，成功审计新增 0。不是以旧版本正常保存失败的 RED 代替。
- [ ] 普通用户三个工作区目录、刷新/重启保持：2026-08-31真实普通用户登录已完成，目录57/57、画布图像23/23；节点发现BUG-005，独立聊天两种菜单和刷新/重启仍待验，不能用管理员或模拟身份替代。
- [x] 管理员成功/失败提示、即时勾选状态与本轮新鲜浏览器健康：2026-08-31 11:19四类提示完成稳定截图和无遮挡断言，失败原值保持；强刷后的Runtime异常/原生弹窗0，3条平台CSP拦截单列。录像与Trace未生成，不将此专项称为完整E2E证据包。
- [x] 到目前为止未为本项创建真实供应商任务或扣费，未修改支付、积分和供应商配置；后续仍维持此约束。

完成标准：本地与云端证据均闭环后，才把 `V588-PROVIDER-002` 标记为已吸收。

## 2026-08-31：真实数据库双结构补证

- [x] 建立仅监听 `127.0.0.1:55439` 的全新临时 PostgreSQL 18.4 集群；不连接 Coze 数据库，不改现有数据库服务。
- [x] 执行此前 123 个环境跳过项，并新增 TEXT[] / JSONB 真库测试。全量 RED 为 `4408 passed / 1 failed / 0 skipped`；聚焦重复 RED 为 `18 passed / 1 failed`，同一失败均是 JSONB 空数组变为对象。
- [x] 只调整既有模型授权序列化尝试顺序，不修改 SQL、用户/密码 CAS 条件、登录流程、目录授权语义或账务。
- [x] 聚焦 8 文件 / 85 测试通过，管理员读投影专项 3 项通过；独立审查未发现 Critical / Important，两个 Minor 测试补证建议已补入。
- [x] 最终全仓 606 文件 / 4413 测试、0 跳过；静态检查、构建 118/118、干净保护基线 38/38 通过。临时数据库停止、测试 schema 剩余 0。源码提交 `bd9655b88ec037a0ebb6891addaba19a8280240f`；证据 `docs/testing/evidence/v588-admin-provider-postgres-20260831.json`。
- [x] 新补丁 `main@f91ada6b` 已构建重启并强刷，管理员会话和只读投影正常。记录：`docs/testing/evidence/v588-f91ada6b-coze-sync-20260831.json`；不重复此部署与本轮数据库门禁。
- [ ] 普通用户三个工作区可见性继续未验证，不得用本地结果代替。

## 2026-08-31 验收范围复核

本节是已批准规格的追溯核对，不是新功能或追加改造。07:55 复核时三类管理员边界仍开放；10:20 后已取得真实服务端、持久化与审计证据并逐项勾选。普通用户及界面反馈缺口继续保留，本地全量通过不替代它们。

| 工作区 | 当前真实代码入口 | 必须核对的集合 | 当前证据等级 |
|---|---|---|---|
| 无限画布图像生成 | `generation-panel.tsx:353` -> `useTaskModelCatalog('image')` -> `/api/models?type=image` | 已授权图像模型的 `providerId::modelId`、供应商显示名、选定值与刷新后值 | 静态接线已核对；普通用户当前云端 UI 未验证 |
| 节点模式 | `canvas-workspace.tsx:483` -> `useTaskModelCatalog('all')` -> 传入 `NodeEditor` 的 `taskModelOptions`；`node-editor.tsx:1431` 分出图像/聊天选项 | 同一个精确键集合按模型实际类型筛选，不把 `/api/workflow/models` HTTP 200 当成节点 UI 已消费 | 静态接线已核对；普通用户当前云端 UI 未验证 |
| 独立智能对话 | `simple-chat/chat-area.tsx:515` 与 `:604` 分别加载 `/api/models?type=chat`、`type=image` | 两个模型菜单独立验证精确键与供应商，不能只检查聊天菜单或画布聊天窗口 | 静态接线已核对；普通用户当前云端 UI 未验证 |

服务端 `src/lib/task-core/model-catalog.ts` 的普通用户路径先检查状态和功能权限，再应用图像/聊天授权。空模型数组“不限”不等于忽略功能权限，也不要求普通用户目录无条件等于管理员所有类型目录。当前 Chrome 仍为管理员，未通过代登录、令牌替换或密码重置绕过此缺口。

### 10:25 云端边界补证与恢复

脱敏证据：`docs/testing/evidence/v588-provider-002-admin-cloud-20260831.json`。原始响应和截图含账号资料，仅本地保存并记录哈希。授权测试已恢复原图像/聊天“不限”，刷新复读为 `[]`；账号、角色、功能权限、积分与项目数不变。三次边界请求均来自现有管理员 UI，只有待测试授权字段被替换，未模拟服务端响应。

Coze 本次平台自动构建恢复后，原 Chrome 预览于 10:14:39 强刷，管理员会话保持；未手动重复构建、未新建标签、未使用 360。临时拦截以 `Fetch.enable({patterns:[]})` 清空且已暂停请求均继续完成。三项后端通过不等于整个 PROVIDER-002 完成，剩余项按上方未勾选条目执行，不重新部署既有源码。

## 任务 8：已批准管理员反馈的漏接修复

2026-08-31 10:27 与 10:29 在正确 Chrome 原预览真实复现：服务端分别返回 400/409，勾选保持原值，但错误提示不显示。根因是 `CanvasWorkspace` 的 dashboard 提前返回分支未挂载任何 `Toaster`；画布分支已有通知容器，却不会在仪表盘渲染。此项补齐原规格“管理员界面反馈”，不是新设计或扩大业务范围。

- [x] 保存两种真实拒绝响应、连续可见 DOM 和截图，刷新复读原权限仍为不限。
- [x] 在现有组件合同测试中新增 TS AST 断言；RED 为 dashboard 通知容器 0 个，期望 1 个（1 failed / 5 passed）。
- [x] 只在 dashboard 返回片段增加同样式 `Toaster`，保持画布原容器、回调、授权、登录和账务不变。
- [x] 管理员/目录专项 8 文件、61 测试通过；TypeScript 通过。
- [x] 新生产候选全量 606 文件/4414 测试通过，0 跳过；Lint 与独立审查通过，隔离 PostgreSQL 测试残留 0、已停止。
- [x] 源码候选 `da6c036c` 干净保护基线 38/38、无漂移与 warning；没有更改保护白名单。
- [x] 生产构建退出 0，118/118 页面，Build ID `dNZjIQhoe13uW-4oz8Ubf`；保留两条 Node localstorage 路径 warning，不隐藏或关闭检查。
- [x] main-only候选 `865f61b7` 已由正确Coze项目拉取，专项6/6、保护38/38、118/118构建、单一5000 PID3586；Build ID `TmG3umX1DqmLPP46PXs2x`。仅使用Google Chrome原标签，最后11:13:13强刷完成。
- [x] 四类提示真实可见、失败勾选和已存值保持、原不限恢复；刷新后管理员会话与应用资源健康。原件8份哈希见 `docs/testing/evidence/v588-provider-002-toast-cloud-20260831.json`，仅关闭BUG-004，普通用户三工作区仍待验。

本项没有重新开放 Stage 4。全量测试中的历史模块是本次新源码的防回归，不是重做旧阶段或重复部署文档。

## 任务 9：普通用户节点精确选择增量

本项来自原三工作区验收，未新增工作区或更改授权语义。用户亲自重置后已正常登录，不能再把普通用户凭据列为当前阻塞。

- [x] 保存真实普通用户session与57项模型目录的脱敏核对；画布图像菜单23/23，选中Pear精确键。
- [x] 在同一Chrome原预览重复复现节点卡片同名模型冲突，保存截图与选中值；未运行生成或扣费。
- [x] 建立菜单、属性、LLM请求与旧项目执行的RED；只修改两个节点组件，复用既有精确键解析器。
- [x] 补充已撤销模型和歧义LLM负向覆盖，最新节点专项6文件89测试通过。
- [x] 源码042356cb冻结后全仓607文件4431/4431、0跳过，TypeScript/Lint、构建118/118、干净保护38/38通过；中间全仓4429/4429独立保留。隔离数据库残留0且已停止。
- [x] 源码042356cb已只推送main，远端复读匹配；stable仍为52f7c601未变化。中文证据随主线交付，不为纯文档再构建。
- [ ] 新候选Coze同步完成后，原Chrome预览强刷，复验节点两处选择一致、保存恢复与LLM精确键。
- [ ] 继续独立simple-chat聊天与图像两个菜单、刷新与同密钥重启；不得提前关闭PROVIDER-002。

执行范围复核：当前服务端start忽略startNodeId/tailNodeId，按传入全部nodes执行，因此本次消歧守卫必须覆盖整个请求体。节点RUN子图语义单独登记为历史观察，不在本次静默改执行图或扩大批次B。
