# 协作文档画布上传入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文件选择与拖入在协作文档模式经受权媒体命令取得真实资产版本并出现在画布，旧个人上传保持原样。

**Architecture:** `InfiniteCanvas` 仅分流原始 `File[]`，`CanvasWorkspace` 持有项目/协作文档上下文及提交后刷新；独立客户端函数编码并发送现有 upload API，服务端仍独占鉴权、媒体校验和 placement 创建。响应不确定时保留同一幂等身份，绝不回退到 legacy 图片写入。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Vitest、现有 PostgreSQL 文档媒体导入 API。

**Spec:** `docs/superpowers/specs/2026-09-28-canvas-document-upload-entry-design.md`

**2026-09-28 候选状态：** 请求模块、选择/拖入分流及父工作区串行提交已接入；SHA-256 文件身份修正了同元数据异内容重试冲突，批次内重复文件去重，未知文档权限 fail closed。混合批次逐文件分类并保留有效文件，上传过程显示 loading toast。真实 `InfiniteCanvas` 组件事件现覆盖选择、拖入、权限未定、拒绝后不回退以及个人旧上传五案；本轮请求/相邻媒体/桥接/路由合同合计 137/137，类型检查、目标 ESLint 和隔离环境生产构建（121 静态页）exit0，构建仍有 42 条宽 NFT 警告。原服务端独立 PostgreSQL 上传合同 151/151 来自上一测试批次。隔离浏览器已确认选择/拖入走文档 upload API、版本图显示及刷新恢复，模拟 403 不回退，未授权账户 GET/POST 均 403。后续项目切换实测暴露旧文档图片持久化到空个人项目；已定位异步加载过程中 hydration 使用过时项目 ID 被文档保护拦截，最小修正后从 6 图文档切换至新建空项目、延时与刷新均维持目标 0 图、来源 6 图。修后又验证在途 upload 回执跨项目：旧文档 6→7、目标空项目仍 0，刷新维持 0。已有两个隔离测试项目受修前缺陷污染，保留原样作证据，不冒充修复后的通过数据。已入项目只读成员 UI 和取消仍缺；本地 presence 启动依赖 Next baseline 预加载临时绕过。保护门禁仍有 4 个精确漂移 BLOCK（其中 1 个是本候选新模块），因此不放行、不提交/部署。

**同日较新进展（覆盖上段“取消仍缺”的泛称）：** 用户可在画布文档上传中点击“停止等待”，浏览器中止本批次等待，保留不确定请求的幂等重试身份；这不是服务端确认取消，服务端取消语义仍未实现。新增三条中止边界测试先 RED 后 GREEN；下文有浏览器证据。最近一次相邻 7 suite 186/186、ts-check exit0、定向 ESLint 0 error/6 warning，生产 build exit0/121 静态页但宽 NFT 警告变为 45；保护门禁仍同四项精确 BLOCK。此更新不把前段历史数值改写为最新通过。

**同日审查续修（覆盖上一段局部候选状态）：** 独立审查指出刷新媒体期间“停止等待”仍被 30 秒刷新期限牵制，及文件预处理期间连接转不可写仍可能 POST。两项经 3 个新测试先 RED（3 failed/16 passed）后 GREEN（19/19）；等待刷新现在可由同一 AbortSignal 立即结束，可写状态在发送前、回执后和刷新确认后复核，未确认的同图幂等意图保留。相邻 7 suite 177/177（与前次186的套件集合不同）、真实隔离 PostgreSQL 151/151、ts-check exit0、定向 ESLint 0 error/6既有warning、生产 build exit0/121 页；仍有 45 条宽 NFT 警告和保护门禁同四项 BLOCK。二次独立限定复审未见新的 Critical/Important；本地修正不能冒充服务端取消或云端验收。

## Global Constraints

- 仅现有 dirty `main`，不改 `stable`，不提交/推送/部署/真实供应商或业务数据库；用户已明确后续方案无需逐次确认，与本计划的频繁 commit 模板冲突时以用户约束为准。
- 不改变 `collectCanvasDocumentPatches` 对无版本图片的拒绝；不能用 URL、客户端自报 owner、伪造版本或 `onAddImages` 写协作文档。
- 真库只用现有隔离环境 `task-8cb3i2-environment.ps1`；验证与候选源码路径必须准确记录，保护门禁不以通配符放宽。
- 原文件大小上限、MIME、鉴权、项目权限和幂等回放由现有服务端保持权威。

---

### Task 1: 浏览器文档上传请求合同

**Files:**
- Create: `src/lib/collaboration/document-canvas-upload.ts`
- Test: `src/__tests__/lib/document-canvas-upload.test.ts`

**Interfaces:**
- Consumes: `File`、`projectId`、`idempotencyKey`、`transform` 和浏览器 `fetch`。
- Produces: `uploadDocumentCanvasFile(input): Promise<{ placementId: string; assetVersionId: string; documentSequence: number; assetReference: RegisteredWorkspaceAssetReference }>`；拒绝异常 MIME/尺寸/响应。

- [ ] **Step 1: 写行为测试。** 用真实 `File` 内容和可检查的 fake fetch 证明请求地址、原始二进制、`Content-Type`、UTF-8 base64url 元数据中仅有项目/键/文件名/attach transform；200 响应必须完整，403/409/413/503 和畸形 200 不返回“成功”。
- [ ] **Step 2: 跑 `pnpm vitest run src/__tests__/lib/document-canvas-upload.test.ts`，确认 RED 来自缺少请求行为而非导入错误。**
- [ ] **Step 3: 最小实现。** 使用 `TextEncoder` + `btoa` 编码短 JSON，MIME 仅允许 PNG/JPEG/WebP/GIF/AVIF/BMP，文件名依 MIME 生成安全扩展名，`body: file` 原样传输；响应校验 `placementId/assetVersionId/documentSequence/assetReference` 后返回。
- [ ] **Step 4: 聚焦 GREEN，随后验证现有 `collaboration-document-media-import` 单测与真库上传合同。**

### Task 2: 文件入口分流与确认后刷新

**Files:**
- Modify: `src/components/infinite-canvas.tsx`（上传 Props、选择文件与拖入处理）
- Modify: `src/components/canvas-workspace.tsx`（协作文档提交、重试键、媒体刷新）
- Test: `src/__tests__/components/canvas-document-upload-entry.test.tsx` 或同等真实交互测试；如大组件难以渲染，应测真实抽取的上传控制器调用，而非搜索源码文本。

**Interfaces:**
- Consumes: Task 1 `uploadDocumentCanvasFile` 和现有 `collaborativeCanvas.refreshMedia({projectId,documentSequence})`。
- Produces: `onUploadFiles?: (files: File[]) => Promise<void>`；文档模式两文件入口只走此回调，非文档模式保持 `onAddImages`。

- [ ] **Step 1: 写行为 RED。** 文档选择/拖入的文件不得经过 data URL 和 `onAddImages`；获 200 且刷新确认后显示服务端版本；拒绝或回执不确定时不产生 legacy 图；切换项目时不跨项目展示；个人模式原行为不变。
- [ ] **Step 2: 实现父工作区提交。** 仅 `authority=document` 且 status=`saved|pending` 进入；用本地图片尺寸计算 transform；每操作以项目+文件指纹保存会话幂等键，成功刷新确认才清；连续上传按顺序处理并显示成功/失败反馈。刷新失败提示已提交待同步，保留键，不再次建图。
- [ ] **Step 3: 最小改动子组件。** 两入口仅在文档模式调用 `onUploadFiles`，回调不存在或拒绝只提示，不把文件落入旧路径；个人模式走原 FileReader/压缩流程。
- [ ] **Step 4: 验证。** 聚焦组件测试、相邻 Yjs 桥接与媒体同步测试、隔离 PG 文档上传，`pnpm ts-check`、目标 ESLint、保护门禁；记录未通过项，不勾完整跨工作区目标。

### Task 3: 真实浏览器和发布边界

**Files:**
- Update: `.superpowers/sdd/2026-09-25-v588-yjs-canvas-collaboration/progress.md`
- Update: `J:/无界本地版/projects/_obsidian_wujie/11-阶段进度看板.md`

**Interfaces:** 使用当前正确预览页/本地隔离账号与项目；不使用旧正式部署页或业务数据库做测试种子。

- [ ] **Step 1: 在隔离项目验证选择和拖入、刷新恢复、项目切换、取消/异常响应，以及文档读者无编辑权；检查网络请求确为文档 upload API。**
- [ ] **Step 2: 保护基线、完整类型/构建/相关测试与独立审查通过后再更新阶段看板；门禁仍红时只记录局部候选，不提交/部署。**

**浏览器局部证据（隔离环境，非 Coze/正式部署）：** `http://127.0.0.1:5109` 使用数据库 `wujie_canvas_upload_browser_20260928` 与项目 `project_1790562888952_7eqdhdps6`。管理员在选择器上传 `annotation-source.png` 后文档 sequence=1，拖入 `tiny-test.png` 后 sequence=2、两条 versioned placement，刷新后仍为 2 图且状态“已保存”；网络两次 `POST /api/collaboration/document-assets/upload` 均 200、无 `/api/save-image`。模拟该上传 API 返回 `403 DOCUMENT_FORBIDDEN` 后保持 sequence=2/2 图、无 legacy 写入。另一隔离账户（非项目成员）实际 `GET /api/collaboration/document-project` 和 `POST /api/collaboration/document-assets/upload` 均 403；管理员再读仍是 sequence=2/2 图。该账户不是已入项目的只读成员，因此不能把这两项称为“只读成员 UI”通过。浏览器 trace 保留在 `.playwright-cli/traces/trace-1790563033959.trace`；模拟 403 已撤销拦截。项目切换与处理中取消尚未在浏览器中验证，Task 3 不勾完成。

**项目切换缺陷 RED→局部 GREEN：** 第二次隔离浏览器探针先保持文档 upload 请求在路由门上，切至 `empty-canvas` 后放行；页面错误显示原项目 5 图，随后 `/api/user-data/sync?key=projects` 实证目标项目被持久化 5 图。即使没有在途请求，从原文档 6 图切到另一个新建 0 图项目 `project_1790564063954_g9pvlwnse` 也复现持久化 6 图。临时诊断日志显示 `loadProjectById` 读到目标 0 图，但 hydration 的 `historyProjectIdRef` 仍指旧文档而被 `routeCanvasWorkspaceChange` 阻止；下一步自动保存以目标项目 ID 写入旧图片。仅在两个项目加载分支、调用 hydration 前重新绑定目标 ID，诊断日志随后删除。修后从 6 图文档切至新的空项目 `project_1790564344370_co9ac74t2`，页面、服务器值、延时重读及整页刷新后均为 0 图，来源仍 6 图。第二段 trace 在 `.playwright-cli/traces/trace-1790563774418.trace`；其中失败探针的一次 file chooser 中断和补偿上传导致原文档增加测试图片，故不能将两次 trace 的计数拼接为同一基线。当时尚未重验在途回执，结果由下段独立 trace 补证；完整 Task 3 仍未勾选。

**修后在途回执局部 GREEN：** 新 trace `.playwright-cli/traces/trace-1790565060856.trace`。开始前来源文档 `project_1790562888952_7eqdhdps6` 为 sequence6/6 图，目标 `project_1790564344370_co9ac74t2` 为 0 图。浏览器真实源图构造有效 PNG File，经画布 drop 入口发起文档 upload；Playwright 路由门保持 POST 不返回，先经“工作台”切到目标项目（URL 确认为目标），再放行 POST。上传 200 后来源 sequence7/7 图、目标 legacy 数据仍 0 图，目标 DOM 0 图且整页刷新后仍 0 图。因服务端已接收，来源增加一图是预期，不能将这项说成取消。目标是个人旧项目，文档查询返回 `409 DOCUMENT_PROJECT_NOT_ENABLED` 并在控制台反复显示资源错误；此响应与目标 0 图一致，但该轮不视为只读成员 UI/取消/无控制台错误通过。Task 3 仍未完成，发布门禁仍红。

**协作开关只读态局部 GREEN（非只读成员）：** 另启同一隔离库/媒体根、`WUJIE_YJS_ENABLED=false` 的本地预览；管理员读原文档 `/api/collaboration/document-project` 为 200、`readOnly=true`、sequence7/7 图，画布显示“协作文档只读”。浏览器从画布真实 drop 入口投递有效 PNG，记录到 0 次 `/api/collaboration/document-assets/upload` POST，并收到“协作文档暂不可写，请检查连接和编辑权限”；服务端 sequence7/7 图与 DOM 7 图保持不变。Trace `.playwright-cli/traces/trace-1790565399701.trace`。当前 `document-access.ts` 只有 owner/受邀 editor/未授权三种项目关系，`readOnly` 来自全局写入开关关闭；这不证明存在“已入项目的只读成员”角色，不能以此次测试关闭该验收项。要不要增加该角色须另按完整权限设计裁定，不在上传入口测试中暗中扩大授权模型。处理中取消及发布门禁仍开放。

**浏览器停止等待 RED→局部 GREEN：** 新增 `DocumentCanvasUploadError('cancelled')` 和 AbortSignal 检查；预先中止不得发 POST、在途中止保留 intent 且不刷新、200 到达后但刷新前中止不得把它当作当前画布成功。新增三测试在修前 3 failed/13 passed，修后 16/16 passed；真实浏览器修前在路由门暂缓 upload 时 loading toast 无按钮。修后 trace `.playwright-cli/traces/trace-1790565787628.trace`：同一隔离文档 sequence7/7 图，真实 drop 发 POST，路由门暂缓；loading toast 有“停止等待”按钮。点击后提示“已发出的图片可能仍在服务端处理”，此次被路由门 abort 的请求未到服务端，sequence/DOM 均保持 7，sessionStorage 中同名同内容文件的 intent 仍 1 条。再次拖入该文件后真正 POST 成功，sequence/DOM 增至 8，确认后 intent 0 条。尝试从 CLI 测试环境用 `atob` 解码请求头时因该环境没有 `atob` 报错，不能据此称浏览器直接证明两次请求头键值相同；定向单测证明保留与重放身份。浏览器 abort 只停止客户端等待，不能保证已经送达的服务端事务回滚，故本项不记为“服务端取消通过”。本地 app/浏览器结束后停止；不触及 Coze 或真实供应商。

## 自查

本计划只覆盖本地 File 的两个现有入口；URL/任务生成结果与旧历史图片的独立导入仍由完整图像编辑计划推进。Pear 不在本验收范围，PSD 核心不变。
