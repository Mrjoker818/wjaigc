# 协作项目所有者入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过真实用户入口交付所有者启用、按账号邀请、撤销和受邀进入项目，保留既有权限与项目权威。

**Architecture:** 在现有 document-enable、editors、document-project 接口上补足只读状态和账号名称授权。新增独立管理对话框，复用项目菜单、保存同步和画布深链；视频预检独立修复，不改任务/积分系统。

**Tech Stack:** Next.js 16、React 19、TypeScript、Zod、PostgreSQL、Vitest、现有 Dialog 与 Playwright。

**Spec:** `docs/superpowers/specs/2026-10-03-collaboration-owner-entry-design.md`

## Global Constraints

- 只在当前 main 工作树执行，保留用户已有改动，stable 只读。
- 当前全量 CI 会话 43017 未终止前不修改产品或测试源码；句柄失联时先核实进程及持久日志，不盲目重启。
- 先 RED 后实现；测试用独立 loopback PostgreSQL 专库及仓库外媒体根，不连接业务库。
- 旧 memberUserId 授权合同保留，新 memberName 与其严格互斥；不按名称模糊搜索、不公开账号枚举。
- 共享项目不写入编辑者私人项目列表；原只读分享继续保留。
- Pear 专项排除，PSD 核心保留；不新增本地 GPU 或第二套任务账务。
- 全量 CI、保护基线与实际业务验收未关闭前不提交整棵脏树、不推送、不部署、不发付费请求。每任务只审查自己的明确路径。

## Task 1：所有者只读协作状态

**Files:**

- Create: `src/lib/collaboration/document-owner-status.ts`
- Modify: `src/app/api/collaboration/document-enable/route.ts`
- Test: `src/__tests__/api/collaboration-document-enable.test.ts`
- Create: `tests/integration/document-owner-status-postgres.test.ts`

**Interfaces:**

```ts
export interface DocumentOwnerStatus {
  projectId: string;
  featureEnabled: boolean;
  enabled: boolean;
  currentRevision: number;
}
export async function readDocumentOwnerStatus(
  ownerId: string, projectId: string,
): Promise<DocumentOwnerStatus>;
```

- [ ] 增加真实状态服务的失败测试。沿用 `withIsolatedPostgres` 建用户、旧 projects 快照及修订键，断言尚无资产图项目仍返回 enabled=false；查询前后文档、资产与修订行相同。新增别人的项目、停用用户、trashed 图项目、设置已启用但文档缺失的拒绝用例。

```ts
const before = await query('SELECT * FROM wujie_user_data ORDER BY user_id, data_key');
const status = await readDocumentOwnerStatus('owner-a', 'legacy-a');
expect(status).toMatchObject({ projectId: 'legacy-a', enabled: false, currentRevision: 3 });
expect((await query('SELECT * FROM wujie_user_data ORDER BY user_id, data_key')).rows)
  .toEqual(before.rows);
```

- [ ] 路由新增 GET 失败测试：只允许一个 projectId 参数，重复及未知参数 400、未登录 401、非所有者 403、权威冲突 409；功能关闭仍能读取状态。运行 `pnpm exec vitest run src/__tests__/api/collaboration-document-enable.test.ts tests/integration/document-owner-status-postgres.test.ts`，确认行为断言 RED，不接受环境/导入错误冒充 RED。
- [ ] 实现一次 repeatable-read 快照的只读事务。核验 active 所有者、唯一本人旧项目、现有图项目状态、设置/文档一致性，再读现有 `PROJECT_REVISION_DATA_KEY`；不复用会触发迁移的写接口。代码返回上面接口；GET 使用 private/no-store 与 Vary Cookie，保留原 POST。
- [ ] 原命令复跑并运行 `pnpm ts-check`、目标文件 ESLint；限定 diff 自审，无迁移/更新语句、無宽泛错误伪成功。只记录本任务证据，不宣称协作完成。

## Task 2：账号名称邀请与旧授权兼容

**Files:**

- Modify: `src/lib/collaboration/document-access.ts`
- Modify: `src/app/api/collaboration/editors/route.ts`
- Test: `src/__tests__/api/collaboration-editors.test.ts`
- Test: `tests/integration/document-access-postgres.test.ts`

**Interfaces:**

```ts
export async function grantDocumentEditorByName(
  ownerId: string, projectId: string, memberName: string,
): Promise<void>;
// 原 grantDocumentEditor(ownerId, projectId, memberUserId) 不改外部合同。
```

- [ ] 真库失败测试创建 unique、duplicate、disabled、自身及陌生账号；非所有者优先被拒绝，新按名称入口在未启用或缺文档时拒绝。既有 ID 启用前授权用例继续保留。

```ts
await expect(grantDocumentEditorByName('owner-a', 'project-a', 'Editor'))
  .rejects.toMatchObject({ code: 'DOCUMENT_INVITEE_INVALID' });
expect((await query('SELECT * FROM wujie_project_document_editors')).rows).toEqual([]);
```

- [ ] 路由失败测试分别提交 `{projectId, memberName}`、同时有 name/id、空名称及客户端 ownerId；断言合法名称调用新函数，其余 400 且零授权调用。运行 `pnpm exec vitest run src/__tests__/api/collaboration-editors.test.ts tests/integration/document-access-postgres.test.ts` 确认 RED。
- [ ] 同一事务内先锁定并验证所有者，再验证文档启用/完整，再精确查 active name。只有唯一且非本人才执行原 INSERT/ON CONFLICT 授权逻辑；提取事务内共享写函数，禁止通过重新调用公共函数开启第二事务。账号无效统一返回 400 DOCUMENT_INVITEE_INVALID，权限错误仍403。
- [ ] POST 使用两个 strict 对象的 Zod union；DELETE 保留原 ID schema。真库补并发重复授权、撤销后再授与代次增长，断言重复活跃授权不增长。复跑原命令、类型及目标 lint，检查旧 ID 路径仍通过。

## Task 3：保存与身份作用域客户端

**Files:**

- Create: `src/lib/collaboration/document-owner-client.ts`
- Create: `src/__tests__/lib/document-owner-client.test.ts`
- Read: `src/lib/user-manager.ts`（不重构其现有保存机制）

**Interfaces:**

```ts
export interface OwnerClientScope { userId: string; projectId: string; generation: number; }
export interface SavedOwnerProject { projectId: string; expectedRevision: number; }
export interface OwnerProjectSync {
  flushProjectsToServerWithConflictRecovery(): Promise<{ projectIdMap: Record<string, string> }>;
  getProjectSyncRevision(): number;
}
export async function saveOwnerProject(
  projectId: string, sync: OwnerProjectSync,
): Promise<SavedOwnerProject>;
```

- [ ] 使用可控 Promise 写 RED：flush 未完成前启用 HTTP 零次；保存返回 ID 映射后仅使用映射 ID 与保存后的修订号；保存失败零启用。项目/账号/代次改变后迟到保存或 HTTP 结果必须丢弃，不刷新新项目。

```ts
sync.flushProjectsToServerWithConflictRecovery.mockResolvedValue({ projectIdMap: { temp: 'stored' } });
sync.getProjectSyncRevision.mockReturnValue(8);
expect(await saveOwnerProject('temp', sync)).toEqual({ projectId: 'stored', expectedRevision: 8 });
```

- [ ] 运行 `pnpm exec vitest run src/__tests__/lib/document-owner-client.test.ts` 确认 RED；实现等待保存及映射/修订返回。HTTP 封装保留服务器错误码，不把非 JSON、401/409、断网转换成成功。AbortController 与作用域检查协作，不能仅依赖 abort。
- [ ] 对未知 mutation 结果提供读回，不自动重新授权/启用。原命令 GREEN、类型及目标 lint，明确该模块不改私人项目集合、不自动发起生成或账务请求。

## Task 4：项目菜单与协作管理对话框

**Task 3 本地接续证据（2026-10-03）：** 保存/作用域/HTTP客户端13项先RED后GREEN，含不确定启用按映射后的projectId读回且不重复POST；与enable/editors路由同次38/38，类型及两路径ESLint通过。此处仅为客户端合同，真实界面接入与加载失败、切项目/关闭焦点验收由Task 4完成，不能替代浏览器证据。

**Files:**

- Create: `src/components/dashboard/project-collaboration-dialog.tsx`
- Modify: `src/components/dashboard/project-actions-menu.tsx`
- Modify: `src/components/dashboard/dashboard-view.tsx`
- Create: `src/__tests__/components/project-collaboration-dialog.test.tsx`
- Read: `src/components/canvas-workspace.tsx`（复用已有 projectId 深链）

**Interfaces:**

```ts
export interface ProjectCollaborationDialogProps {
  open: boolean;
  userId: string;
  projectId: string;
  projectName: string;
  returnFocusTarget: HTMLButtonElement | null;
  onOpenChange: (open: boolean) => void;
}
// 菜单新增 onManageCollaboration(returnFocusTarget: HTMLButtonElement): void。
```

- [ ] React Testing Library 行为 RED：菜单可打开对话框，读取失败可重试；featureEnabled=false 不出现可执行启用按钮；未启用先保存再启用，已启用展示成员并按名称邀请；撤销、复制失败、401/409、关闭/切项目迟到结果逐项断言。

```tsx
await user.click(screen.getByRole('menuitem', { name: '管理协作' }));
expect(screen.getByRole('dialog', { name: /管理协作/ })).toBeVisible();
expect(screen.queryByLabelText('用户 ID')).not.toBeInTheDocument();
```

- [ ] 运行 `pnpm exec vitest run src/__tests__/components/project-collaboration-dialog.test.tsx src/__tests__/lib/document-owner-client.test.ts` 确认 RED。读取匹配 UI 技能后实现对话框，不重设计整个仪表盘；复用 Dialog、项目菜单焦点返回与现有样式。名称/成员操作状态独立，等待中禁重复操作。
- [ ] 启用成功等待 `userManager.loadProjectsFromServer(0, userId)`；读回失败显示“已启用，项目刷新失败”及重试，不重新启用。生成同站点 projectId 登录链接，成功写剪贴板才提示已复制。
- [ ] 上述测试 GREEN，原分享与菜单相邻测试不退化；375px 键盘/触控、Escape 与关闭后焦点验收。独立自审 actor/project/generation 检查，不把编辑者 workspace 写入私人列表。

## Task 5：视频项目启用与双用户实际验收

**Task 5 视频真库 RED（2026-10-03）：** 新增 `tests/integration/document-enable-video-postgres.test.ts`，真实受管MP4/WebM与混合项目启用3项均在最终 `assertProjectAssetVersion` 的媒体descriptor检查处失败，非环境/导入错误。损坏、缺失、图片伪装MP4和越界4项已拒绝，不能把它们计为新增安全修复。前置预检跳过video，且 `fileForImage` 只接受image验证数据，导致待迁移video版本缺mime/byte_size；只换inspector不足。后续需纳入 `src/lib/asset-core/legacy-migration.ts` 的协作显式opt-in视频验证与元数据消费接缝，默认图片/其他调用方合同不改，并另补默认兼容控制组及已就绪video控制组；视频尺寸不能从客户端伪造。该拓展属于原视频启用验收的必要接缝，不新增任务账务或GPU。

**视频接续预检纠正（2026-10-03）：** 当前共享 `prepareVerifiedLegacyProjectMedia` 明确跳过 `inferAssetKind(image) !== 'image'`，并仅以 kind=image 调用inspector、验证image MIME。因此不能只替换bridge的inspector就宣称待迁移视频可启用；须先用真实视频用例定位最终迁移的元数据消费合同，再决定协作专用有界预检或经过完整调用方回归的共享合同扩展。此前“video分支null”只是接口现状，不是已证实的唯一故障根因。

**Task 4 首轮本地证据（2026-10-03）：** 菜单与管理对话框已接入dashboard；首七项控件行为RED→GREEN，补读取重试、401/409、映射ID复制、迟到启用/关闭和Escape焦点控制。与旧分享及客户端同次60/60，修正ref静态违规后类型/四路径ESLint/diff检查通过。仍需复杂身份/重开竞态与真实375px和双用户浏览器验收，不据此勾选Task 8D/8E。

**Files:**

- Modify: `src/lib/collaboration/document-project-bridge.ts`
- Create: `src/lib/collaboration/document-enable-media.ts`
- Test: `tests/integration/document-project-bridge-postgres.test.ts`
- Create: `src/__tests__/lib/document-enable-media.test.ts`
- Create: `tests/browser/collaboration-owner-entry.spec.ts`
- Update: `docs/testing/v588-yjs-collaboration-evidence.md`
- Update: 仓库外 Obsidian `11-阶段进度看板.md`

**Interfaces:**

```ts
import type { InspectManagedLegacyMedia } from '@/lib/asset-core/legacy-migration';
export const inspectDocumentEnableMedia: InspectManagedLegacyMedia;
```

- [ ] 使用已有 tiny-valid.mp4/WebM 夹具和真实受管存储写失败用例：有效待迁移视频启用、图视频混合项目，已有就绪资产单独控制组；损坏/缺失/伪 MIME/越界来源拒绝且零文档变化。运行 `pnpm exec vitest run tests/integration/document-project-bridge-postgres.test.ts src/__tests__/lib/document-enable-media.test.ts` 确认有效视频行为 RED。
- [ ] 将图片检查与有界视频读取封装为 inspector；只读受管来源并按现有 `validateRecoveredSourceMedia` 合同验证字节，复用实际元数据工具。没有 ffprobe 时沿用合法可选尺寸合同，不从客户端补造尺寸。保留最终迁移事务的版本/来源/修订核验及原子失败。
- [ ] 定向 GREEN、原 bridge/access/editor 回归、静态检查；测试完整后关闭专库并核验无连接及残留 schema，不能删除仍由全量 CI 使用的库。
- [ ] 浏览器使用两个账号，通过真实菜单启用、账号邀请、复制链接进入原项目；不得预写 editor 行。验证图/视频显示、双方改动与刷新读回、撤销后的拒绝、切项目迟到响应、未授权第三账号以及旧匿名分享只读。保持私人项目列表不出现共享副本。
- [ ] 对同一项目继续核验节点及独立对话的权威版本，账本及原文件不变；未具备链路的项保持开放。运行当前准确源树的全量 CI、保护基线、生产构建与严格追踪审计，修复真实失败，不批量白名单或跳过旧功能。
- [ ] 将限定/真实/未验证证据分别更新中文证据与看板。仅本地通过不得勾选 Coze、真实付费、实体设备、独立复审或整个 Task 8D/8E；按既有门禁顺序进入正确预览验收。

## 自审与执行方式

2026-10-03 节点选材真实闭环：主人新建input-image节点→来源canvas→画布选图，真实assets/transfer后JSON编辑器只读核对config：原assetId854cc705-03a3-412b-890f-da314f422d73、原assetVersionId ed3f9064-5e6e-4dd2-a91d-458f4122c4c0，新的workflow placement8f34dc54-047c-4eb2-9a83-05abee90a125。实库版本仍1，canvas/workflow两placement同资产版本；未执行工作流。原生打开simple-chat，新建默认对话自动同步，目标画布下拉可选empty-canvas；仅选择目标不是素材进入聊天，输入@无素材选择器。本轮源码定位chat-area附件登记及workflow返回入口，尚未实际完成已有素材到独立聊天，不将三工作区标通过。主人CLI当前tab1独立聊天（未发送@草稿）；tab0节点JSON编辑器保持，editor独立会话仍画布。无付费/部署。

2026-10-03 位置权威诊断闭环：两真实账号各自GET document-project均200/sequence2，projection与canvasImages均670/350，图片ID、版本ed3f9064-5e6e-4dd2-a91d-458f4122c4c0及placement0d571b88-e732-4a55-b392-459ebbefb7f7相同。主人GET user-data/sync?key=projects同样返回670/350及同身份。readOwnerProjectsWithDocuments明确以文档位置覆盖asset graph旧transform；单查placement不是协作位置权威，因此不应为使表值相同而增加第二套写入。主人真实点击节点模式，工作流入口保留且内容窗口出现1项PNG；尚未核对节点选材版本及独立聊天读回，不能关闭三工作区验收。未修改产品源码、未部署。

本轮实库补查empty-canvas资产1/版本1，未因拖动增加版本；placement.transform仍为上传时590/310，而刷新后的协作画布为670/350。不能据此声称三工作区位置投影一致，下一步核对Yjs权威文档与placement投影的更新合同，区别设计中的文档权威与真实遗漏。

2026-10-03 双账号真实媒体同步补证：在线资格是独立授权；主人实际“管理在线成员”邀请测试editor后，第二端显示2人在线。主人通过真实canvas-image-upload-input上传既有100×100 PNG夹具（CLI文件chooser未捕获，改原生setInputFiles，未绕过上传处理）。两端加载同一图片ID 4caf7e8d-39dc-4513-a056-975459e6e648，left590/top310且图片naturalWidth有效。editor原生鼠标拖动+80/+40，主人无需刷新同步为left670/top350且已保存；editor刷新后同ID/位置/加载/已保存保留。仅图片上传、反向拖动与一次刷新局部E2E，不是完整视频/编辑/撤销/撤权/三工作区验收，不关闭Task8D/E。

2026-10-03 隔离网关接入：启动器增加仅固定测试库/媒体根的--resume（检查真实目录与测试owner，不重跑迁移），启用presence、精确localhost Origin并调用既有presence-server。首次实际启动在监听前因Next AsyncLocalStorage未初始化exit1；预加载next/dist/server/node-environment后新session47375仍live，5010/PID11140。旧普通Next两个确认PID停止，未删库或媒体。第二账号权威document-project GET200、document-ticket POST200，浏览器文档状态“已保存”；多人写同步尚未测试。在线状态presence-ticket403仍存在，presence-members是独立成员检查，不能把document-editor授权自动当presence授权或直接插表绕过。启动器ESLint quiet exit0，非全站/发布验收；Yjs重复导入警告仍在。当前CLI网关绑定0.0.0.0，应后继改测试调用startLivePresenceServer明确loopback。主人会话导航后需重新确认登录状态。

2026-10-03 真实UI推进：同服务改用localhost预览，启用POST200、状态/成员GET200；实库empty-canvas文档1/settings1。管理员UI新建第二测试用户后按精确名称邀请，成员列表及实库唯一active授权一致。独立Edge会话wujie-editor-ui-20261003真实登录并进入空画布，但状态同步不可用；服务presence-ticket503，隔离启动器缺WUJIE_PRESENCE_ENABLED且使用普通Next开发服务，网关未接入。尚未验证权威文档读回或双端同步。继续修正隔离测试运行方式，保留现有库/媒体/授权，不重建或重复启用；Task8D/E不关闭。

2026-10-03 来源拒绝根因已复现：当前安装的 NextURL `parseURL` 将 loopback IP 规范化为 localhost。直接构造真实 NextRequest 得到浏览器 Origin `http://127.0.0.1:5010`、nextUrl.origin `http://localhost:5010`，现有开发来源严格等值判断因此拒绝。5010 仍由原 PID24336 监听，未重启或重复启用。下一步仅为隔离启动器明确配置精确公共 Origin 并验证受控恢复方式；不得放宽产品 CSRF，双账号验收仍未通过。

2026-10-03 实际 Edge 本地菜单验收已开始：独立库 `wujie_bridge_test_ownerui_20261003`、外部临时媒体根、仅本机5010开发服务；测试账号真实表单登录并打开项目菜单/管理协作。首次启用POST403/`DOCUMENT_REQUEST_INVALID`对应来源校验拒绝，DB document/settings0/0；没有重复写请求或预插成员。具体Origin mismatch未确认，先检查/补明确本地配置，不能放宽安全检查。应用工具session77321/CLI会话wujie-owner-ui-20261003保持用于下一步（恢复须重新核对），Task8D/E不关闭；独立库和媒体根待流程结束后精确清理。隔离启动脚本`run-owner-collaboration-local.mjs`静态ESLint通过，但其完整启动/隔离守卫仍需专门复核，不是发布启动器。

2026-10-03 inspector 边界：新增真实 MP4、硬链接、两项并发占用及失败释放；父目录链接替换先 RED，再补初读与复核逐级 lstat。测试根复用生产缓存合同，避免每例换根误检。最终四份42/42、类型/两路径 ESLint/diff check通过，schema/连接0/0。256MiB累计预算/取消超时仍未专项覆盖；后续实际菜单 E2E 使用独立本地库，既有Task7浏览器用例不能替代Task8D/E验收。

2026-10-03 视频来源竞态：S3 ETag 替换控制先 RED（应拒绝却成功启用），增加模块内 WeakMap 来源身份复核，预检后及文档写入前再核原对象/文件身份；较晚替换控制确认事务图回滚。最终三份真库39/39、类型/三路径 ESLint/diff check通过、schema/连接0/0；S3受控替身，非云端。持久不可变身份、本地/父目录竞态专项、预算、旧public/后缀键及双账号三工作区未完，不关闭Task5。

2026-10-03 未映射历史视频 S3 接入：真库迁移 `legacy-s3` 先 RED 于本地 ENOENT，再以原路径精确 S3 键、冻结对象身份、分块有界读和真实二进制验证接入；只协作 opt-in 写入 verified storageKey，不写缓存或搜索相似键。元数据从验证字节快照获取。无身份/超限/损坏控制拒绝且资产图不变。最终三份真库37/37、类型/三路径 ESLint/diff check通过，schema/连接0/0；S3网络受控、非真实云端。旧 public/哈希后缀旧键、跨阶段源身份竞态和预算专项及真实双账号/三工作区仍开放，Task 5不关闭。

2026-10-03 视频复用负控制：来源替换、MIME 错配和版本不存在拒绝启用且原资产图整行不变；已有权威 S3 storageKey 视频通过受控 Head 元数据检查，无对象身份拒绝，原版本不变且不写本地缓存。最终本文件 14/14、类型/定向 ESLint/diff check 通过，schema/其他连接 0/0。S3 未真实字节读取，因此仅启用边界证据；下一步未映射历史视频的有界恢复、旧 public、竞态/预算及双账号浏览器，禁止据此重写已可用 S3 就绪启用或关闭 Task 5。

2026-10-03 就绪视频控制补正：首次映射正常，已完成 migration checkpoint 场景真实 RED 为 `LEGACY_MEDIA_PERSIST_FAILED`。修为协作 opt-in 在完整身份、服务端 ready 和来源 URL 相同时复用原版本描述；最终权限门禁不变。测试补齐既有视频/转移迁移，最终三份真库 28/28、类型/定向 ESLint/diff check 通过，测试 schema/其他连接 0/0。原版本整行和文档 version/placement 身份有断言；S3/旧 public、变更来源负控制、竞态/预算及真实浏览器仍开放，不关闭 Task 5。

2026-10-03 Task 5 局部执行证据：真实视频三项 RED 后接入显式 `verifyManagedVideos` 与只读视频 inspector，首轮桥接/视频 18/18。自审新增默认迁移尺寸控制先 RED（1920×1080 丢为 null），限定 opt-in 后，视频/桥接/旧迁移三份真库 26/26、类型检查和五路径 ESLint quiet 通过。尚缺已就绪视频、S3/旧 public、竞态/预算、真实双账号与三工作区验收；上述 Task 5 复选框不关闭，不宣称完整视频支持或发布完成。

状态、名称邀请、保存竞态、UI 及视频分别对应设计要求；旧 ID 授权、只读分享、编辑者私人列表和三工作区验收均有独立保留项。内联执行，每任务完成后限定审查；未提交整棵工作树。当前只完成设计与计划，所有实施复选框保持未勾选。
