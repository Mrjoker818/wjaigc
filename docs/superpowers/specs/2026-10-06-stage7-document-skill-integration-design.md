# 第七项：共享 Skill 完整交付接入设计

## 目标与授权

这是原 Yjs 协作 Task8C 的剩余集成，不是新增 Skill 功能或新目标。共享编辑者在自己的运行记录中执行既有 Skill，结果保存到项目的规范资产空间，通过实际聊天/画布 UI 整批交付；CPU 多平台导出、合规报告、视频结果与显式历史恢复使用同一权限边界。原21个 Skill 的内容、质量门禁、模型冻结、任务与计费不重写。

人类已授权后续自行选择最优方案、无需重复确认；只在 main 本地实施，无 stage/commit/push、Coze 同步、安装、付费或部署。复用原 James/Descartes 和既有物理验证副本，不新建任务、席位或 worktree。Pear 已移出，PSD 核心保留。六份平铺用户 SDD、stable、原始供体、真实业务数据库和既有媒体读取核心不改。

## 已核对的入口缺口

- `canvas-client.ts` 的完成图片、Brief 视频、多平台图片，以及 `multi-platform-export-client.ts` 的 manifest/ZIP 仍通过私人 `/api/assets` 预读。
- `step-registry.ts` 的默认尺寸读取按 actor 查资产；规范协作结果属于项目 owner，会得到空尺寸，不能通过删除质量门禁解决。
- CPU 导出 source-reader、持久化图片/manifest/ZIP、重试素材加载与 lineage 验证仍使用 actor 的私人项目空间。合规报告的素材读取、保存和下载路由存在同一接缝。
- 普通 Skill 完成后的聊天 effect 仍逐输出调用 projection coordinator；必须改变实际调用方，不只新增整批 helper。
- 既有 document-media-batch 仅确认 live 规范摆放或导入私人版本。CPU 产生的 owner 规范版本尚未摆放时没有路径。已删结果不能借 attach 重新出现；历史恢复现有本地删除 journal 不能覆盖另一个编辑者删除、刷新丢 journal 的情形。

## 方案比较与决定

选择运行记录绑定的服务端适配层，复用 `AssetService`、`createAssetStorageTransaction`、现有受管字节读取、document-assets 命令及 batch receipt。另两个方案——扩大 `/api/assets` 的私人权限、复制一套协作存储/任务状态机——分别破坏私人隔离和增加双重权威，不采用。

这是一条依赖紧密的链路，作为一个实施/审查批次交付。内部按失败复现、服务端、实际 UI、恢复、集中验证顺序实现；不为每个接缝另建审查任务。

## 服务端运行作用域

新增 `src/lib/skill-runtime/document-assets.ts`，负责唯一的 run/actor/project 绑定和 scoped 资产适配。运行来源从 `cloud_tasks`、既有 run.created/输出事件、`readTaskPublicationAccess` 和 `readTaskPublicationIntent` 获得，不信任请求携带 owner、role、URL、sourceTrace 或自报输出 IDs。

读操作先证明当前调用者拥有该运行，运行是实际 Skill agent-run，projectId 精确一致；无协作 publication 才能选择原私人路径。数据库错误、历史协作关闭、成员撤销、错项目不能降级私人路径。共享读再校验当前 actor、owner、项目、文档开关和编辑成员；历史结果可在重新授权后由用户主动读取，但旧任务写权不会因此恢复。

生产写适配在真实 step operation 内创建，以 actor/run/project/step/requestDigest/sourceVersionIds/executionFence 为界。必须核对父任务冻结 publication、owner 和 grantGeneration，数据库执行 lease 的 owner/generation/paused/completed 状态，以及当前权限。不能只凭 AsyncLocalStorage/header 或初始 admission 写入。当前真正执行者仍是 task.user_id、积分主体和事件主体；仅内部 AssetService 的项目资产 namespace 取经过核实的 owner。

复用 AssetService 的版本/父边/幂等实际写入。以受控 AssetStorage 包装在同一 client 的短事务中执行：图写共享 gate → task/publication/lease → 项目 → 当前授权/source CAS → 原 AssetService 回调 → 再验授权/fence/source → COMMIT。不得在 SQL 锁内执行 Sharp、文件、S3 或远端 API。source 完整身份/元数据先冻结，实际字节完整性沿用 source-reader，写前复验防止读取后来源改变。异常 COMMIT 不提前返回内存 receipt；保留文件并由既有 idempotency/cleanup 恢复判定。

适配只暴露当前运行需要的 readable reference、版本读取、创建版本/原子创建、幂等查询。创建必须绑定当前 run/step 的既有 idempotency、metadata/sourceTrace 和父版本集合；任意调用方不能将 owner 字符串当权力。私有 AssetService 默认行为及 `/api/assets` 不改。CPU retry 的 readonly repository 也由同一运行作用域提供，不能回到 actor 私人查询。

## 生产消费者

`step-registry.ts` 在每个 step/recovery 的真实 run 身份下取适配：普通生成/恢复的尺寸质量检查读取规范版本；MPE 注入实际 readSources、persistImage、loadPersistedImages、persistArtifacts；合规注入素材 reader、report asset service，并让报告下载路由以同一 fresh-authorized scope 查询。保留字节/MIME/尺寸/校验和、报告 canonical JSON/来源 trace、ZIP 命名/预算、partial-success/retry 以及模型冻结的原校验。

`service.ts` 的 retry admission 校验以 lineage 的实际 sourceRunId 和当前 actor/project 的运行记录获得只读作用域，再复用原 lineage 判定。新运行保存仍受新父任务授权与 lease 约束，不复活旧 lease。Brief 视频继续使用实际 child task 的既有发布/恢复，不新建视频任务状态机；只统一最终视频 reference 与历史读取。

## HTTP 与客户端读合同

新增 `GET /api/skill-runs/[runId]/assets?projectId=...&assetVersionId=...`。最多100个 distinct version IDs，只返回该运行权威输出的精确版本；来源素材、另一个运行/项目、伪造 metadata 无法扩展输出集合。返回 actor/run/project 绑定以及 references 和 placement state（live / unplaced / deleted）；文档/ZIP 制品不因非 image 被静默丢弃。deleted 结果读取不产生任何摆放。

现有资产 reference、manifest/ZIP 下载行为保留；合规报告路由继续 session auth 与 canonical/checksum/trace 校验，改为授权 scope 查询。这里不新增公共匿名结果下载服务，不重构全站文件网关。

客户端 `canvas-client.ts`、`multi-platform-export-client.ts` 和 `MultiPlatformExportDrawer.tsx` 使用 runId/projectId 绑定的 resolver。Workspace 显式传入当前 document/personal authority；document 请求失败不能调用 `/api/assets` 或发送 private transfer。历史 GET 应使用 observeOnly，素材读取不触发任务恢复或再次生成。私人项目仍使用原流程。

## 整批画布交付

扩展现有 import-batch 请求，仅新增可选 `skillRunId` 及显式 restoration CAS；旧请求的解析、digest、receipt 和私人导入行为不变。run 分支验证整批 IDs 是该运行实际 image/video 输出：已 live 的规范版本 confirm；合法尚未摆放的 CPU 规范版本 attach 同一版本，不复制文件/资产；被删版本只有显式 restore 才可恢复。

整批所有新 ready attach、恢复摆放、Yjs 更新与 root receipt 共用一个最终事务。预备能力一次覆盖目标所有版本、当前 live 文档以及恢复标注的 mask/overlay 引用，延续 opaque PreparedDocumentAssets/full identity 校验；不能循环打开每个输出的独立事务或伪造 capability。复用现有 acquireKeys 单 session 锁容量修复、排序锁顺序、512MiB/100项预算及 unknown COMMIT 处理。

在现有 batch_manifest v1 内为 skill 分支增加严格解析的运行/意图/模式绑定；旧 v1 manifest 仍按旧 exact schema 读取。root 仍为 batch-root，source_kind 仍 NULL，不新建结果 receipt 表或任务状态。新 attach/restore 的 child 记录是实际已有 document command 记录，必须与 root/运行/version 绑定。重放要求当前授权和完整 durable receipt，不能用旧 receipt 自动复活后来再次删除的摆放。

Chat 普通 Skill 的实际完成 effect 一次加载所有有效图片并一次调用整批插入；projection coordinator 以整批版本集合去重，失败后允许同 key 重试，成功才标记 complete。导出 Drawer 保留手动“加入画布”，不改成自动添加；Brief 保留单个真实视频入口。Workspace 继续等待 canonical sequence 和实际投影后 ACK，不本地 append。

所有异步边界守住 actor/project/history epoch、document/session 身份、mount、AbortSignal 和 writable authority；切用户/项目/断连后迟到结果不能写旧或新画布。重复 effect、并发历史点击、刷新重放不重复 placement/版本/积分。

## 显式受控历史恢复

客户端仅发送 skillRunId、目标 versionId、原 placementId、expectedRemovalSequence 与显式 restore 意图，不发送可信 removeSnapshot、owner 或 annotationRecords。服务端读取该项目/版本/摆放的实际 durable remove_snapshot，严格解析并核对当前 SQL trashed 摆放、Yjs tombstone/version、删除序号及 frozen snapshot identity。没有可信删除记录或来源变化则冲突，不退回普通 attach。

恢复是新的当前编辑命令，不是恢复父任务执行：当前权限准入冻结并在最终事务再验。新 placement/annotation IDs 由服务端生成，保留旧 tombstone 不覆盖旧身份。复用现有文档事务的 canonical validation/sequence/notify，将可信 snapshot 的几何、metadata、仍存活 group 的成员绑定及 annotations 一起保存；已经删除的 group 不复活，已更改的旧标注/版本/删除来源冲突不覆盖。使用 `restoreCanvasDocumentAnnotationIdentity` 的既有身份变换，不自行复制另一套恢复规则。

`document-store.ts` 增加只接受 opaque server restoration capability 的内部事务接缝，复用 persistDocumentCandidate，不接受任意回调/raw Yjs snapshot。资产准备必须同时覆盖恢复 mask/overlay。完整 restore 元数据与 batch receipt 同 COMMIT；前端不再做半成功后额外 metadata 拼接。刷新、另一个编辑者删除、重试/未知 ACK 均由真实 durable receipt 恢复；普通完成 effect 不隐式 restore。原本地 Ctrl+Z 删除 journal 流程保持。

## 验证与不属于本批的门禁

先在原候选上复现实际 other-owner 尺寸/CPU export 和实际 UI 逐项/私人预读问题，保留 native 失败；新增模块未解析、test harness 导入失败不是业务 RED。最终测试包括真实 PG 的编辑者来源→CPU transform→owner 规范父边/manifest/ZIP→整批命令→Yjs→删除/跨进程恢复，演员账务不变，以及当前授权撤销/重新授权、错项目/运行、source/fence 变化、末项失败整批回滚、未知 COMMIT、并发重放与迟到 UI 隔离。

原生 PG/账务/资产/文档不可 mock；远端 provider 用既有受控假服务器，禁止付费。UI 验证覆盖实际 Chat/Workspace callbacks 与 Drawer 生命周期，不只测试新 helper 或源码字符串存在。一次集中相关回归与变更 lint/非增量 TypeScript；失败按环境/合同/生产分类，连续相同假设失败改路径，20分钟无新证据切最小复现。

本批通过只能关闭这条8C共享 Skill 交付链；8D、8E、内部 Task9、整体草图、全配置回归、当前构建、正确 Coze/WebSocket101、多实例/重启/触屏/付费与发布仍保持未验证，不能用测试数量冒充总体百分比。
