# 只读画布分享实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 subagent-driven-development（推荐）或 executing-plans 按任务逐项执行。本计划中的步骤使用复选框跟踪。

**目标：** 在 main 分支实现方案 A 的匿名只读画布分享：所有者创建绑定项目修订、画布视口和 AssetVersion 的不可变快照，匿名用户通过高熵令牌查看；分享可过期、撤销，默认禁止下载，媒体始终经过服务端受控读取。

**架构：** 新增独立 Canvas Share 领域层、数据库表和公开安全投影。创建时在 AssetCore 写保护边界内读取权威项目修订与当前 canvas placement，验证每个 AssetVersion 的 ready 状态和受控媒体目的地，然后在一个事务内写入分享主记录与快照 item。所有者 API 复用当前会话认证；公开 API 只接受令牌和作用域 item ID，不接受客户端媒体 URL。查看器使用独立的 SharedCanvasViewer 只读渲染边界，复用几何和媒体渲染原语，但不挂载编辑器状态机。

**技术栈：** Next.js 16 App Router、React 19、TypeScript、PostgreSQL、现有 AssetStorage/AssetCore、Vitest、Playwright、Tailwind CSS 4。

**规格：** [2026-09-19-read-only-canvas-share-design.md](J:/无界本地版/projects/_upstream-wjaigc-restore/docs/superpowers/specs/2026-09-19-read-only-canvas-share-design.md)

## 全局约束

- 只在 J:/无界本地版/projects/_upstream-wjaigc-restore 的 main 分支实施；绝不检出、修改或合并 stable，不复制 V5.8.8 donor 文件。
- 当前工作树中已有的 .superpowers/sdd/ 六个文档改动属于用户既有修改，实施时不覆盖、不清理、不加入本功能提交；每次提交只暂存本任务明确新增或修改的文件。
- Asset、AssetVersion、WorkspacePlacement、项目修订和受控媒体恢复是唯一事实源；不建立第二套资产状态机，不把项目 JSON、任务、供应商、模型、提示词、API Key、账务或存储 key 放入公开投影。
- Simple Chat 分享、工作流入口和现有媒体网关保持独立；不修改 wujie_shared_conversations 及其查看器。
- 公开分享默认由 WUJIE_CANVAS_SHARE_ENABLED 关闭。开关关闭时所有者接口返回稳定的 CANVAS_SHARE_DISABLED，匿名接口返回统一失效页语义；在本地、真 PostgreSQL、浏览器和云端证据完成前不得默认打开。
- 原始令牌只在创建成功响应的短生命周期中出现；数据库、日志、操作记录、错误响应、客户端持久化和埋点只允许出现哈希或脱敏摘要。
- pending-persist、missing、recovering、unrecoverable、data:、blob:、没有受控存储目的地的媒体，以及没有明确安全预览适配器的元素，均阻止创建，不得静默跳过。
- 所有实现任务先写失败测试，再写最小实现，再运行目标测试和现有回归测试；没有真实证据的结论标记为“未验证”。

---

## 任务 1：建立数据库契约、领域类型和令牌边界

**文件：**

- 新增 migrations/20260919_read_only_canvas_shares.sql
- 新增 src/lib/canvas-share/types.ts
- 新增 src/lib/canvas-share/errors.ts
- 新增 src/lib/canvas-share/token.ts
- 新增 src/__tests__/lib/canvas-share-token.test.ts
- 新增 src/__tests__/lib/canvas-share-schema.test.ts
- 新增 tests/integration/canvas-share-schema-postgres.test.ts

### 1.1 RED：先锁定表结构和令牌安全行为

- [ ] 在 canvas-share-token.test.ts 写测试：生成令牌使用至少 32 字节密码学随机值并输出 URL-safe 字符；同一原始令牌的哈希稳定；不同令牌的哈希不同；测试断言原始令牌不出现在哈希字符串、序列化记录和错误对象中。
- [ ] 在 canvas-share-schema.test.ts 写测试：CanvasShareStatus 只允许 active、revoked、expired；策略更新只能包含 expiresAt 和 allowDownload；快照字段和 item 字段没有可变项目 JSON 或公开内部 ID 类型。
- [ ] 在 PostgreSQL 集成测试中读取迁移并断言两张表、token_hash 唯一约束、状态约束、到期索引、owner/project 索引、share/item 关联索引存在；插入不合规状态、负素材尺寸、空 token hash 必须失败。
- [ ] 运行 pnpm vitest run src/__tests__/lib/canvas-share-token.test.ts src/__tests__/lib/canvas-share-schema.test.ts tests/integration/canvas-share-schema-postgres.test.ts，确认新测试在实现前失败；没有 POSTGRES_TEST_DATABASE_URL 时，PostgreSQL 测试必须明确显示跳过原因而不是伪造通过。

### 1.2 GREEN：完成领域契约和迁移

- [ ] 在迁移中创建 wujie_canvas_shares：id、owner_id、project_id、project_revision、token_hash、title、status、expires_at、allow_download、viewport、snapshot_digest、view_count、last_viewed_at、created_at、revoked_at，并用 PostgreSQL CHECK 约束状态、修订号、标题长度和时间关系。
- [ ] 在同一迁移中创建 wujie_canvas_share_items：id、share_id、placement_id、asset_id、asset_version_id、entity_type、asset_kind、transform、安全显示元数据、mime_type、width、height、byte_size、checksum、availability、sort_order、created_at；为 share_id + id、share_id + sort_order、asset_version_id 建立索引。
- [ ] 在 types.ts 定义 CanvasShareRecord、CanvasShareItemRecord、CanvasShareViewport、CanvasSharePolicyPatch、CanvasSharePublicDocument、CanvasSharePublicItem 和稳定错误码联合类型；公开类型不出现 owner/project/placement/asset/version/task/provider/model/prompt/key/url 字段。
- [ ] 在 errors.ts 实现带 code、HTTP status 和安全中文 message 的 CanvasShareError，至少覆盖 CANVAS_SHARE_DISABLED、CANVAS_SHARE_UNAUTHORIZED、CANVAS_SHARE_NOT_FOUND、CANVAS_SHARE_MEDIA_NOT_READY、CANVAS_SHARE_PROJECT_CONFLICT、CANVAS_SHARE_UNSUPPORTED_ELEMENT、CANVAS_SHARE_DOWNLOAD_DISABLED、CANVAS_SHARE_POLICY_CONFLICT 和 CANVAS_SHARE_MEDIA_UNAVAILABLE。
- [ ] 在 token.ts 实现 createCanvasShareToken()、hashCanvasShareToken(token)、redactCanvasShareToken(token)；只用 node:crypto 的随机源和 SHA-256，不接受客户端自带 token 作为创建结果，不把原始 token 写入日志。
- [ ] 重新运行任务 1 的 Vitest 与 PostgreSQL 测试，确认表约束和安全契约通过；再运行 pnpm ts-check，确保领域类型可被后续服务导入。

### 1.3 回归和提交

- [ ] 运行 pnpm test:api 和 pnpm lint:build，确认新领域目录没有改变既有 API 和 lint 行为。
- [ ] 用 git diff --check 检查迁移和 TypeScript 文件；只暂存任务 1 文件，提交 feat: 建立只读画布分享数据库契约。

## 任务 2：实现不可变快照构建、媒体准备检查和事务存储

**文件：**

- 修改 src/lib/asset-core/storage.ts
- 修改 src/lib/asset-core/canvas-project-sync.ts
- 新增 src/lib/asset-core/managed-media-read.ts
- 新增 src/lib/canvas-share/canonical-json.ts
- 新增 src/lib/canvas-share/snapshot.ts
- 新增 src/lib/canvas-share/storage.ts
- 新增 src/lib/canvas-share/service.ts
- 新增 src/__tests__/lib/canvas-share-snapshot.test.ts
- 新增 tests/integration/canvas-share-snapshot-postgres.test.ts

### 2.1 RED：锁定修订、placement、AssetVersion 和媒体门禁

- [ ] 在 canvas-share-snapshot.test.ts 为快照依赖创建内存 fake，测试服务端忽略请求体中的 owner、revision、assetVersion 和 URL，只从 actor/project 查询权威数据。
- [ ] 写测试覆盖：项目修订、归一化 viewport、active canvas placement、精确 AssetVersion 和冻结 transform 写入快照；项目后续变更不会改变已生成的快照对象或摘要。
- [ ] 写参数化测试覆盖 pending-persist、missing、recovering、unrecoverable、data:、blob:、空 storage key 且非受控相对 URL，以及未经适配的 entity type，全部抛出对应稳定错误；任一 item 失败时不返回部分 items。
- [ ] 写测试覆盖 canonical JSON 的键排序、数组顺序和数值规范化，确认相同快照摘要稳定，不把 raw URL、prompt、provider 或 metadata 中的私有字段带入摘要输入。
- [ ] 在 PostgreSQL 集成测试中并发启动“创建分享”和“修改项目 placement/revision”，断言共享写保护边界下要么拿到一致旧修订快照，要么返回 CANVAS_SHARE_PROJECT_CONFLICT，不产生半成品主记录。
- [ ] 运行 pnpm vitest run src/__tests__/lib/canvas-share-snapshot.test.ts tests/integration/canvas-share-snapshot-postgres.test.ts，确认实现前失败。

### 2.2 GREEN：复用 AssetCore 事实源并写入快照

- [ ] 在 storage.ts 为 AssetCore 事务增加 listActiveCanvasPlacements(ownerId, projectId)，按 created_at, id 稳定排序并只返回 workspace_kind = canvas、entity_type 为 canvas-image 或 canvas-video 且 placement、asset、version 归属一致的记录；不把客户端 project JSON 当作数据源。
- [ ] 在 canvas-project-sync.ts 暴露可接收同一 SQL client 的项目修订读取函数；生产创建流程使用 withAssetCoreTransaction 与 lockAssetGraphWriteGate(client, shared)，在同一事务内读取修订和 placement，避免先读修订再写分享的竞态。
- [ ] 在 managed-media-read.ts 提供服务端专用的 readManagedAssetVersionBytes 和 getManagedAssetMediaDescriptor：只允许已验证的本地 data root、精确 S3 storage key 或 /api/serve-upload/ 受控相对路径；禁止调用 image-source-map 回源外部 URL，禁止解析任意客户端 URL；限制 MIME、字节数、Range 和视频并发读取。
- [ ] 在 snapshot.ts 实现 buildCanvasShareSnapshot({ ownerId, projectId, requestedViewport })：读取权威 project revision，枚举 placement，加载精确 asset/version，验证 ready 与受控媒体，规范化 viewport，生成只读安全显示元数据、canonical digest 和 item sort order；对不支持的 canvas 元素抛出 CANVAS_SHARE_UNSUPPORTED_ELEMENT。
- [ ] 在 storage.ts 实现事务内 insertCanvasShare(record, items)、listCanvasShares(ownerId, projectId)、findCanvasShareForOwner(ownerId, shareId)、findCanvasShareByTokenHash(tokenHash)、updateCanvasSharePolicy(...)、revokeCanvasShare(...)、incrementCanvasShareView(...)；插入主记录和 items 必须同一事务完成。
- [ ] 在 service.ts 实现 createCanvasShare、listCanvasShares、patchCanvasSharePolicy、revokeCanvasShare、readPublicCanvasShare 的依赖注入边界，服务层负责生命周期、过期判断、策略不可变性和稳定错误码，路由层不直接拼 SQL。

### 2.3 回归和提交

- [ ] 运行任务 2 的目标测试、pnpm test:regression、pnpm ts-check 和 pnpm lint:build。
- [ ] 检查测试数据库中失败创建没有残留 share/item，检查数据库行和日志内容均不包含 raw token 或 source URL。
- [ ] 只暂存任务 2 文件，提交 feat: 构建只读画布分享不可变快照。

## 任务 3：实现所有者 API 和生命周期策略

**文件：**

- 新增 src/app/api/canvas-shares/route.ts
- 新增 src/app/api/canvas-shares/[shareId]/route.ts
- 新增 src/app/api/canvas-shares/[shareId]/revoke/route.ts
- 新增 src/lib/canvas-share/request.ts
- 新增 src/__tests__/api/canvas-shares-owner.test.ts
- 新增 tests/integration/canvas-share-owner-postgres.test.ts

### 3.1 RED：定义 HTTP 和授权行为

- [ ] 在 API 测试中 mock getSessionUser、feature flag、Canvas Share service，覆盖未登录、开关关闭、缺少 projectId、非法 expiresAt、超出标题长度和非法 JSON body 的稳定状态码与中文错误码。
- [ ] 写测试证明 POST /api/canvas-shares 只使用当前会话 user.id；请求体中的 ownerId、projectRevision、assetVersionId、mediaUrl 和伪造 items 不会传入服务层。
- [ ] 写测试覆盖 GET 只能列当前用户指定项目的分享；PATCH 只能修改尚未过期分享的有效期与 allowDownload；不能修改 title、revision、viewport、digest、items；跨用户和跨项目统一为授权错误。
- [ ] 写测试覆盖 revoke 幂等、过期不可重新激活、并发策略更新产生明确冲突、创建成功只返回一次 raw share URL 而列表永不返回 raw token。
- [ ] 运行 pnpm vitest run src/__tests__/api/canvas-shares-owner.test.ts tests/integration/canvas-share-owner-postgres.test.ts，确认实现前失败。

### 3.2 GREEN：接入当前认证、CSRF/CORS 和服务层

- [ ] 在 request.ts 用 Zod 或现有项目校验工具解析 CreateCanvasShareRequest、PatchCanvasShareRequest 和 projectId/query；只接受安全标题、30 天默认有效期、明确的 allowDownload，不接受任何资产或媒体关系字段。
- [ ] 在 route.ts 实现 POST 和 GET：调用 getSessionUser(request)，复用现有管理 API 的请求保护方式，传入当前 user.id，创建成功返回 shareUrl、shareId、expiresAt、allowDownload、snapshot 的最小所有者结果；raw token 不进入持久化状态。
- [ ] 在 [shareId]/route.ts 实现 PATCH，用 owner_id = sessionUser.id 条件读取并更新策略；将不存在、跨用户、已撤销、已过期分别映射为安全且不泄露存在性的错误语义。
- [ ] 在 revoke/route.ts 实现 POST 并保证重复撤销不改变 digest、items 或 createdAt；记录脱敏操作事件，不记录 token、私有媒体地址或项目 JSON。
- [ ] 在服务层为有效分享设置 Cache-Control: private, no-store 语义所需的响应数据边界；对所有者接口禁止匿名写入，不扩展 Simple Chat 路由。

### 3.3 回归和提交

- [ ] 运行 owner API 目标测试、pnpm test:api、pnpm ts-check 和 pnpm lint:build。
- [ ] 用 PostgreSQL 查询验证过期、撤销、策略更新和幂等行为，确认没有第二条 active 记录被重复创建请求覆盖。
- [ ] 只暂存任务 3 文件，提交 feat: 增加只读画布分享所有者 API。

## 任务 4：接入所有者创建和分享管理界面

**文件：**

- 新增 src/components/canvas-share/create-dialog.tsx
- 新增 src/components/canvas-share/manage-panel.tsx
- 新增 src/components/canvas-share/share-api-client.ts
- 修改 src/components/canvas-workspace.tsx
- 修改 src/components/dashboard/dashboard-view.tsx
- 新增 src/__tests__/components/canvas-share-owner-ui.test.tsx

### 4.1 RED：锁定入口、信息和保护行为

- [ ] 在组件测试中断言画布项目标题栏/项目菜单提供“分享画布”，项目管理列表每行提供“管理分享”，创建弹窗提供“管理已有分享”；单张图片工具栏、Simple Chat 和 Workflow 不出现该项目级入口。
- [ ] 写测试断言创建弹窗展示项目名、将绑定的修订、素材数量、媒体检查结果、30 天默认有效期、默认关闭下载和不可变提示；创建中禁用重复提交。
- [ ] 写测试断言成功态仅提供复制完整链接、打开查看器和前往管理；失败态把 CANVAS_SHARE_PROJECT_CONFLICT、CANVAS_SHARE_MEDIA_NOT_READY、CANVAS_SHARE_UNSUPPORTED_ELEMENT 映射为中文下一步动作，不显示供应商 JSON。
- [ ] 写测试断言管理列表按创建时间倒序显示状态、修订、素材数、有效期、下载策略、查看次数、最近访问；撤销需要二次确认并显示不可恢复说明；策略编辑不能出现快照字段输入框。
- [ ] 运行 pnpm vitest run src/__tests__/components/canvas-share-owner-ui.test.tsx，确认实现前失败。

### 4.2 GREEN：在现有项目表面挂载轻量 UI

- [ ] 在 share-api-client.ts 封装 owner API 的 createCanvasShare、listCanvasShares、patchCanvasSharePolicy、revokeCanvasShare；客户端只在成功创建的内存回调中持有 raw URL，不写 localStorage、项目 JSON 或错误上报。
- [ ] 在 create-dialog.tsx 使用现有 dialog、toast、主题和无障碍模式；预览信息来自服务端创建前检查结果，不由客户端自行拼接 AssetVersion、URL 或 revision。
- [ ] 在 manage-panel.tsx 实现复制、打开、策略更新、撤销和失效状态展示；复制失败提供可访问的手动选择文本，不打印 URL 到 console。
- [ ] 在 canvas-workspace.tsx 的项目标题/项目菜单挂载创建入口，并把当前项目 ID、名称和当前画布视口作为展示上下文传入；不要修改图片操作工具栏、任务触发器、保存调度器或聊天回调。
- [ ] 在 dashboard-view.tsx 的“我的项目”项目行更多菜单增加管理入口；入口调用 owner API 获取当前用户数据，不直接读取其他用户 projectId；从创建弹窗跳转管理面板时保留现有 dashboard/canvas 导航语义。
- [ ] 运行组件测试和 pnpm test:regression，确认资产库删除、项目打开、重命名、收藏、Simple Chat 和 Workflow 入口无变化。

### 4.3 回归和提交

- [ ] 运行 pnpm ts-check、pnpm lint:build 和现有 dashboard/canvas 相关组件测试。
- [ ] 检查 UI 文案、键盘焦点、Escape 关闭、复制反馈和窄宽度弹窗布局；所有新增用户文案使用中文。
- [ ] 只暂存任务 4 文件，提交 feat: 增加画布分享所有者管理界面。

## 任务 5：实现公开安全投影、受控媒体和下载接口

**文件：**

- 新增 src/app/api/public/canvas-shares/[token]/route.ts
- 新增 src/app/api/public/canvas-shares/[token]/media/[itemId]/route.ts
- 新增 src/app/api/public/canvas-shares/[token]/media/[itemId]/download/route.ts
- 新增 src/lib/canvas-share/public-projection.ts
- 新增 src/lib/canvas-share/public-rate-limit.ts
- 新增 src/__tests__/api/canvas-shares-public.test.ts
- 新增 tests/integration/canvas-share-public-postgres.test.ts

### 5.1 RED：先锁定匿名安全边界

- [ ] 在公开 API 测试中断言有效 token 能返回 title、创建时间/修订标签、归一化 viewport、作用域 item ref、asset kind、MIME、宽高、安全显示文本、transform 和受控相对媒体地址。
- [ ] 写字段泄漏测试：响应深度遍历不得出现 owner、user、project、placement、asset、version、task、provider、model、prompt、API Key、账务、storage key、raw URL 或完整项目 JSON 的键和值。
- [ ] 写生命周期测试：随机 token、错误 token、关闭开关、revoked、expired、item 不属于 share、跨 share item、媒体不可用、下载关闭分别不能读取元数据或媒体；所有失效链接归一为查看器可识别的失效语义。
- [ ] 写下载测试：allowDownload=false 时预览仍不带附件下载头且 download 路由拒绝；开启后只能读取该 share 的 item，并设置安全的附件文件名、MIME、nosniff 和不可共享缓存。
- [ ] 写 IDOR/SSRF 测试：客户端传入任意 itemId、assetId、URL、Range 或 source URL 都不能改变服务端查询；测试 mock fetch 断言公开媒体路径不会访问外部地址。
- [ ] 运行 pnpm vitest run src/__tests__/api/canvas-shares-public.test.ts tests/integration/canvas-share-public-postgres.test.ts，确认实现前失败。

### 5.2 GREEN：投影和媒体读取分离实现

- [ ] 在 public-projection.ts 实现 projectCanvasShareForPublic(record, items) 白名单映射；只生成公开字段，内部 item ID 转换为 share 作用域引用，禁止透传 JSONB metadata。
- [ ] 在 public metadata route 中按 token 哈希查找分享，并在单次读取中检查 active、expiresAt、item 数量和快照 digest；访问计数用原子 SQL 更新，不返回查看者身份和 owner 数据。
- [ ] 在 media route 中按 token + itemId 查询快照 item，再核对保存的 AssetVersion、project、owner 和受控媒体描述符；使用 managed-media-read.ts 读取字节，绝不回退到客户端 URL 或旧 serve-upload 的外部 sourceUrl 恢复逻辑。
- [ ] 为图片、视频和已有安全 preview adapter 的媒体提供正确 Content-Type、Content-Length、X-Content-Type-Options: nosniff、Cache-Control: private, no-store；不支持的 asset kind 返回“内容暂不可用”而不是猜测 MIME。
- [ ] 在 download route 再次校验分享有效和 allowDownload，设置安全 Content-Disposition: attachment；默认禁止下载不能只靠隐藏按钮实现。
- [ ] 在 public-rate-limit.ts 复用现有限流/请求窗口模式，按脱敏 token 摘要、item scope 和 IP 设置 metadata/media/download 边界，超限返回稳定错误且不记录 raw token；对视频 Range 和总字节数使用统一限制。
- [ ] 所有 public route 设置 X-Robots-Tag: noindex, nofollow, noarchive，失败响应不回显 SQL、文件路径、供应商响应和完整 URL。

### 5.3 回归和提交

- [ ] 运行 public API 目标测试、任务 2/3 的生命周期测试、pnpm test:api、pnpm ts-check 和 pnpm lint:build。
- [ ] 以两个用户和两个分享 item 做 PostgreSQL IDOR 回归；撤销后立即重复请求元数据、预览和下载，确认每次都被服务端阻断。
- [ ] 只暂存任务 5 文件，提交 feat: 增加只读画布分享公开安全投影。

## 任务 6：实现独立只读查看器和公开页面

**文件：**

- 新增 src/app/shared/canvas/[token]/page.tsx
- 新增 src/app/shared/canvas/[token]/shared-canvas-client.tsx
- 新增 src/components/canvas-share/shared-canvas-viewer.tsx
- 新增 src/components/canvas-share/shared-canvas-toolbar.tsx
- 新增 src/components/canvas-share/shared-media-preview.tsx
- 新增 src/__tests__/components/shared-canvas-viewer.test.tsx
- 新增 tests/e2e/read-only-canvas-share.spec.ts

### 6.1 RED：锁定查看器只读交互

- [ ] 在组件测试中断言首次加载显示骨架，不把空白画布当作成功；有效数据渲染标题栏、修订标签、主视口、只读工具栏、媒体和允许时的下载动作。
- [ ] 写测试断言平移、缩放、适应画面、当前比例和全屏只改变内存 viewport；点击媒体只产生本地焦点或打开预览，不显示编辑工具栏、不修改 placement、不发保存/生成/聊天请求。
- [ ] 写测试断言无效、撤销、过期和 feature flag 关闭统一显示“分享不存在或已失效”；单个媒体失败保留 transform 占位并显示“此内容暂不可用”，其他媒体继续显示。
- [ ] 写测试断言图片 alt、视频 playsInline/静音默认、Escape 关闭预览、中文按钮名称、键盘焦点和 prefers-reduced-motion 行为。
- [ ] 运行 pnpm vitest run src/__tests__/components/shared-canvas-viewer.test.tsx，确认实现前失败。

### 6.2 GREEN：隔离编辑器状态机并接入 public API

- [ ] 在 shared-canvas-client.tsx 只调用 /api/public/canvas-shares/[token]，处理加载、失效、网络错误和请求追踪标识；不要导入 CanvasWorkspace、生成面板、编辑面板、聊天面板、项目保存 hook 或任务注册器。
- [ ] 在 shared-canvas-viewer.tsx 使用服务端 viewport 作为初始视口和边界；实现 pointer events 的本地平移、双指 pinch、双击 fit/zoom、键盘缩放和全屏，所有状态保存在组件内。
- [ ] 在 shared-media-preview.tsx 根据公开 assetKind/MIME 渲染图片和 inline muted video；下载按钮调用专用 download URL，永不直接使用公开响应中不存在的内部或原始 URL。
- [ ] 在 shared-canvas-toolbar.tsx 提供适应、缩小、放大、比例、全屏和条件下载，点击区不小于 44px；工具栏带 data-toolbar=shared-canvas，避免与编辑器选择器混淆。
- [ ] 页面 metadata 设置 noindex；页面不注入 owner/project 内部 ID，不创建 indexedDB/localStorage 项目状态，不请求模型、积分、生成、保存或供应商端点。
- [ ] 运行组件测试和 pnpm ts-check，做一次 rg 检查查看器导入列表，确保没有编辑器写入模块依赖。

### 6.3 回归和提交

- [ ] 运行 pnpm lint:build、相关 API 测试和现有 tests/e2e/p0-core.spec.ts 的受保护入口回归。
- [ ] 只暂存任务 6 文件，提交 feat: 增加只读画布分享查看器。

## 任务 7：完成移动端手势、响应式工具栏和浏览器矩阵

**文件：**

- 修改 src/components/canvas-share/shared-canvas-viewer.tsx
- 修改 src/components/canvas-share/shared-canvas-toolbar.tsx
- 新增 tests/e2e/read-only-canvas-share-mobile.spec.ts
- 修改 playwright.config.ts（仅在现有项目矩阵中增加分享页覆盖，不改变既有 browser project 名称）

### 7.1 RED：先写跨浏览器和窄视口证据测试

- [ ] 在 read-only-canvas-share.spec.ts 用 route fixture 提供匿名分享 JSON、图片和视频响应，并用 request 监听断言打开查看器不发生成、编辑、删除、保存、积分、模型或供应商请求。
- [ ] 覆盖 Chromium、Firefox、WebKit 的桌面场景：打开有效分享、fit/zoom、平移、媒体预览、失效态、下载关闭和下载开启；保存 console、network、trace、截图并关联测试标题。
- [ ] 在移动测试中覆盖 320、375、393 宽度和至少一个横屏上下文；验证单指平移、双指 pinch、双击 fit/zoom、底部工具栏、安全区、视频 inline、无横向溢出和长按不打开编辑菜单。
- [ ] 断言下载关闭时按钮不存在且接口拒绝，打开时按钮存在并调用 download path；断言项目原始页面的既有编辑器测试仍通过。
- [ ] 运行 pnpm exec playwright test tests/e2e/read-only-canvas-share.spec.ts tests/e2e/read-only-canvas-share-mobile.spec.ts --reporter=line，确认实现前失败。

### 7.2 GREEN：完成 Pointer Events 和移动布局

- [ ] 复用查看器的 Pointer Events 状态，不新增与主画布冲突的触摸状态机；单指只更新 viewport，双指只更新 scale/anchor，媒体对象不可拖动。
- [ ] 在 320/375/393 下使用底部紧凑 toolbar、env(safe-area-inset-bottom) 和最小 44px 点击区；窄屏隐藏非核心修订长文案但保留中文无障碍名称，不改变服务端布局坐标。
- [ ] 为 touch-action、user-select、overscroll-behavior 设置只读查看器范围内的样式；长按不触发项目上下文菜单，Escape/返回手势能关闭媒体预览。
- [ ] 为 reduced motion 禁用不必要过渡；视频保持 playsInline、默认静音且不自动播放声音；无法安全预览的媒体显示占位。
- [ ] 重新运行桌面和移动 Playwright 测试，保存每个 browser/viewport 的证据文件，逐项记录未验证项而不改写为通过。

### 7.3 回归和提交

- [ ] 运行 pnpm test:e2e:p0、pnpm test:e2e:stage-2、新分享矩阵、pnpm ts-check 和 pnpm lint:build。
- [ ] 只暂存任务 7 文件，提交 test: 覆盖只读画布分享桌面与移动端。

## 任务 8：整合安全、数据库、保护基线和发布开关

**文件：**

- 新增 tests/integration/canvas-share-concurrency-postgres.test.ts
- 新增 src/__tests__/lib/canvas-share-security-regression.test.ts
- 新增 docs/testing/read-only-canvas-share-evidence.md
- 修改 docs/testing/baselines/protected-baseline-allowed-paths.json（只在保护基线检查确实要求时加入本功能路径）
- 修改 docs/testing/TEST_PLAN.md

### 8.1 RED：补齐规格中的最终验证门禁

- [ ] 在并发 PostgreSQL 测试中覆盖重复创建、重复撤销、并发策略更新、过期检查竞态、媒体读取与撤销同时发生；断言没有越权、半成品和 digest 改写。
- [ ] 在安全回归测试中扫描 public JSON、日志捕获、错误响应和测试 artifact，断言不存在 raw token、storage key、原始供应商 URL、prompt、task/provider/model/API Key、用户或项目内部标识。
- [ ] 在证据文档中为 API/数据库、浏览器/移动端、云端验收列出可复现命令、测试数据、exact commit、运行模式、迁移版本和“未验证”字段；先写失败门禁清单再填实测结果。
- [ ] 运行 pnpm check:protected-baseline，确认允许路径检查没有意外扩大；若基线脚本拒绝新增受保护路径，只允许按脚本输出做最小路径更新并保留审计说明。

### 8.2 GREEN：打开发布所需的证据链但保持默认关闭

- [ ] 将 feature flag、迁移版本、owner/public API、controlled media、查看器和测试 fixture 的版本写入证据文档；记录当前 main exact commit 与 origin/main 差异，不把未推送当作云端通过。
- [ ] 运行完整本地门禁：pnpm test、pnpm validate、pnpm migrate 的迁移检查、任务 7 Playwright 矩阵、现有 P0/Stage 2/Stage 3/Stage 4 回归和 pnpm check:protected-baseline。
- [ ] 使用真实 POSTGRES_TEST_DATABASE_URL 重新运行所有 Canvas Share PostgreSQL 测试；没有真实数据库时，在证据文档和最终报告中明确标记“未验证”。
- [ ] 只在本地、真库和浏览器门禁全部有证据后准备 Coze/GitHub main 云端验收；云端运行 Commit、迁移和运行模式必须精确匹配，云端不能使用未提交工作树。
- [ ] 云端验收按固定顺序记录：匿名有效链接、默认无下载、显式下载、撤销、过期、项目后续编辑不改变旧快照、媒体失效占位、320/375/393 窄视口；任何无法真实执行的项目保持“未验证”。

### 8.3 回归、文档和提交

- [ ] 更新 J:/无界本地版/projects/_obsidian_wujie/11-阶段进度看板.md，只记录本功能实际完成的门禁与证据，不重复已关闭的 V5.8.8 media gateway Task 9。
- [ ] 更新 J:/无界本地版/projects/_obsidian_wujie/memory/MEMORY.md 或其对应入口，记录最终计划/实现提交、云端 commit、未验证项和下一阶段，不把 secret、raw token 或媒体 URL 写入记忆。
- [ ] 运行 git status --short，确认六个既有 .superpowers/sdd/ 改动仍在且未被暂存，确认没有 stable 工作树变化；运行 git diff --check。
- [ ] 只暂存任务 8 文件和经用户明确批准的阶段文档，提交 test: 完成只读画布分享发布门禁；如云端验收尚未完成，不在提交信息或报告中声称云端通过。

## 实施完成标准

- [ ] 数据库迁移可重复执行，主记录与 items 原子写入，token 仅存哈希，快照 digest、revision、viewport 和 AssetVersion 不可被策略更新改写。
- [ ] 所有者只能管理自己的分享；跨用户项目、share、item、媒体和下载请求全部被服务端隔离；撤销和过期即时阻断 metadata、preview、download。
- [ ] 默认下载关闭且由服务端 download route 强制执行；开启下载后仍只允许该分享作用域 item，公开响应没有私有字段和任意 URL。
- [ ] 查看器完全只读，桌面和 320/375/393 移动场景具备 pointer/pinch/preview/fullscreen/失效态证据；打开分享不触发生成、保存、积分、模型或供应商请求。
- [ ] Simple Chat、Workflow、主画布编辑器和已有媒体 gateway 的既有测试通过；feature flag 在所有证据完成前保持关闭。
- [ ] 每个“通过”结论都能关联到 exact main commit、测试命令、迁移版本和输出 artifact；缺失条件明确写为“未验证”。

## 执行方式

本计划只定义实施步骤，当前不修改业务代码。开始执行时，优先使用 subagent-driven-development 将任务 1–8 按依赖顺序分派并在每个任务后做审查；也可以使用 executing-plans 在当前会话逐项执行。执行前不得修改 stable，不得跳过失败测试、真库验证或浏览器证据。
