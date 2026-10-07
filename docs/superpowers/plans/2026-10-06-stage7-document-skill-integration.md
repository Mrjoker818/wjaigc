# 共享 Skill 完整交付 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划是原协作计划的集成补充，继续原 SDD ledger 与原两个席位，不另开 workspace/ledger。

**Goal:** 共享编辑者使用既有 Skill 后，图片、CPU 导出、报告和视频结果正确保存/读取，在实际 UI 整批交付并能显式受控恢复。

**Architecture:** 一个数据库运行记录绑定的 document-skill 资产适配层复用 AssetService。CPU 与远端结果统一授权读取，整批 attach/restore 复用现有 document command、Yjs 事务与 batch receipt，不建立第二套存储或计费状态机。

**Tech Stack:** 现有 Next.js/React/TypeScript、PostgreSQL、Yjs、Sharp、Vitest/jsdom；无新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-06-stage7-document-skill-integration-design.md`

## Global Constraints

仅 main 本地，无 stage/commit/push/Coze/付费/部署/安装；stable/供体、六份平铺用户 SDD、真实业务库、managed-media-read 核心不动。只复用原 James/Descartes 和原物理验证副本；已闭1–6/Lovart/只读分享不重做；Pear移出、PSD核心保留。DB出错/协作关闭/成员撤销不能 private fallback。真实 actor 始终为任务/账务/事件主体，owner 仅为经过验证的资产 namespace。无原始URL/字节/processing/账本写入Yjs。每次写前重新核对当前授权、source identity 与真实execution fence；不得降低质量/预算/退款/终态门禁。

---

### Task 1397: 共享 Skill 运行到成品交付的集中集成

**执行边界（本 brief 随行）：** 仅 main 本地，无 stage/commit/push/Coze/付费/部署/安装；stable/供体、六份平铺用户 SDD、真实业务库、managed-media-read 核心不动。只复用原 James/Descartes 和原物理验证副本；已闭1–6/Lovart/只读分享不重做；Pear移出、PSD核心保留。DB出错/协作关闭/成员撤销不能 private fallback。真实 actor 始终为任务/账务/事件主体，owner 仅为经过验证的资产 namespace。无原始URL/字节/processing/账本写入Yjs。每次写前重新核对当前授权、source identity 与真实execution fence；不得降低质量/预算/退款/终态门禁。

**先读设计：** `docs/superpowers/specs/2026-10-06-stage7-document-skill-integration-design.md`。本批是完整链路，不得仅交付一个容易通过的 resolver/helper。原1396 fix1已获 Spec✅/Quality Approved；不重做其测试、报告或 patch 恢复。原 M1 初始化/负例日志噪音继续披露，不扩生产日志范围；1394历史先RED流程偏差不洗白。

**Files / 职责：**

- Create `src/lib/skill-runtime/document-assets.ts`：可信 run/actor/project scope、生产 writer/retry reader 适配与 readonly 输出解析。
- Create `src/app/api/skill-runs/[runId]/assets/route.ts`：当前鉴权/项目精确绑定、最多100个版本的运行输出查询。
- Modify `src/lib/skill-runtime/step-registry.ts`、`service.ts`：普通质量尺寸、CPU export/合规及 retry 的实际接线；Brief保留原任务恢复，只换最终共享版本读取。
- Modify `src/lib/multi-platform-export/artifacts.ts`：必要的 scoped retry/version repository 注入；不得复制原持久化/清理/ZIP算法。`source-reader.ts`、`executor.ts` 已有 dependencies，优先使用，不为同义接口改动。
- Modify `src/app/api/skill-reports/[runId]/[stepId]/route.ts`：以运行作用域读规范报告/来源，保留校验。`report-asset.ts`已有 assetService 注入，优先使用。
- Modify `src/lib/skill-runtime/canvas-client.ts`、`multi-platform-export-client.ts`、`src/components/skill-runtime/MultiPlatformExportDrawer.tsx`、`src/components/chat-panel.tsx`、`src/components/canvas-workspace.tsx`：run绑定resolver、整批实际调用与epoch/abort隔离。
- Modify `src/lib/collaboration/document-media-batch-request.ts`、`document-media-batch.ts`、`document-media-batch-client.ts`：兼容旧请求/receipt的skill ready attach与显式restore分支，不改私人权限。
- Modify `src/lib/collaboration/document-asset-validation.ts`、`document-store.ts`：多个目标/恢复mask-overlay的opaque准备及已有canonical持久化上的server-only restore接缝。
- Create `src/lib/collaboration/document-skill-restoration.ts`：可信删除snapshot准备/CAS/opaque能力，仅由服务端真实删除记录产生。
- Tests create `tests/integration/document-skill-delivery-postgres.test.ts`、`src/__tests__/api/skill-run-assets.test.ts`、`src/__tests__/components/document-skill-delivery-behavior.test.tsx`；extend既有skill-runtime、canvas/export-client、Drawer及media-batch测试。先 `rg --files` 获得真实旧测试名，不猜路径。新测试同文件按权限/CPU/整批/恢复描述分组，不另建微任务。
- 可在上述模块目录新增职责单一的直接辅助文件，但先列入修前baseline与report，不扩到8D/workflow、WebSocket重构、私人资产API、全局鉴权或媒体读取核心。若必须越过这些边界，反馈具体NEEDS_CONTEXT与替代实现，不能随意扩大范围。

**Interfaces / 同一 Task 内生产与消费合同：**

```ts
interface SkillAssetResolutionInput {
  actorUserId: string; projectId: string; runId: string;
  assetVersionIds: readonly string[]; signal?: AbortSignal;
}
type SkillPlacementState =
  | { kind: 'live'; placementId: string }
  | { kind: 'unplaced' }
  | { kind: 'deleted'; placementId: string; removalSequence: number };
interface SkillAssetResolution {
  actorUserId: string; projectId: string; runId: string;
  references: Array<WorkspaceAssetReference & { placementState?: SkillPlacementState }>;
}
// WorkspaceAssetReference 使用现有 asset-core/types，不造同名第二种引用。
// 实际 GET query 为重复 assetVersionId，服务端严格去重/数量/成员校验。
declare function resolveSkillRunAssets(input: SkillAssetResolutionInput): Promise<SkillAssetResolution>;

// 原 DocumentMediaBatchRequest 加可选 skillRunId；每项仅新增以下显式 CAS。
interface SkillRestorationRequest {
  placementId: string; expectedRemovalSequence: number;
}
// item.restore?: SkillRestorationRequest。整批 root digest 绑定run、意图和完整项顺序。
// 文档分支不能接受用户owner/snapshot/URL作为权力。
```

生产 scope factory 接收实际 step 的 actor/run/project/step/requestDigest/sourceVersionIds/executionFence/signal；只导出限定的 asset/version 方法，用实际 PoolClient+createAssetStorageTransaction 复用 AssetService。接口参数完整记录在新增模块类型及report；禁止 any 或按对象形状冒充opaque能力。readonly scope 不要求旧lease有效，但当前run拥有者和共享权限必须有效；执行CPU保存要求冻结grant+真实lease同时有效。手动历史恢复为新用户命令，不重新运行/收费。

- [ ] **Step 1：修前冻结与实际失败复现。** 保存所有计划写集 main/clone 的原始UTF8字节与哈希（已存在dirty内容是baseline，不是HEAD）；ref/index、六平铺SDD及原1396报告包单独保护。复用`J:/无界本地版/projects/_tmp_e2e/wujie-stage7-current-build-gEZUx9`的node_modules/.next，不先restore再hydrate。使用现有1396 fix1 runner的private env、资源身份、停止和审计合同，派生本批唯一runner，不另写一套测试框架。

  实际RED至少包括：现有默认尺寸resolver处理editor的owner输出得到空尺寸；实际MPE registry执行editor→owner来源被private read/write拒绝；实际完成UI当前逐输出/私人预读不能给出整批交付；被删历史结果拒绝而不是完成显式受控恢复。使用实际已存在入口作为RED，新增文件missing/加载失败不算。新增service/API后再补完整通过/负控制，不能回填先RED。示例断言语义：

```ts
expect(completed.media[0]).toMatchObject({ width: 2, height: 2 });
expect(exported.imageAssetVersionIds).toHaveLength(2);
expect(await assetOwner(exported.imageAssetVersionIds[0])).toBe(projectOwnerId);
expect(await parentVersions(exported.imageAssetVersionIds[0])).toEqual([sourceVersionId]);
expect(batchCalls).toHaveLength(1);
expect(batchCalls[0].references.map(item => item.assetVersionId)).toEqual(allExpectedOutputIds);
expect(privateAssetReads).toHaveLength(0);
```

  上述 assetOwner/parentVersions 是新PG测试内对真实表的只读夹具，不mock生产；batchCalls来自实际Chat/Workspace callback边界，不能直接调用新helper冒充实际UI。

- [ ] **Step 2：实现可信scope与生产消费者。** 从实际父task/publication/created事件冻结身份，读取current document权限；scope使用现有AssetService writer，不实现新的INSERT资产引擎。每个SQL写事务在已有graph gate后读取task/publication/lease，再锁project，回调前后核对frozen grant/source/fence。文件与Sharp全部在锁外。将registry默认元数据与MPE依赖接到scope；合规reader/persist/download同scope；retry admission读取真实sourceRunId，继承原lineage检查。私人模式保留；发生共享拒绝/数据库错误绝不切私人路径。

```ts
// 实际生产接线的结构；上述方法由document-assets.ts同Task实现并明确类型。
const scope = await createSkillDocumentAssetScope({
  actorUserId: step.actorUserId, projectId: step.projectId, runId: step.runId,
  stepId: step.step.id, requestDigest: step.requestDigest,
  sourceVersionIds: request.sourceVersionIds,
  executionFence: step.operation.executionFence, signal: step.signal,
});
return executeMultiPlatformExportStep(step, {
  readSources: scope.readExportSources,
  persistImage: scope.persistExportImage,
  loadPersistedImages: scope.loadPersistedExportImages,
  persistArtifacts: scope.persistExportArtifacts,
  onProgress, ...(request.retryLineage ? { retryLineage: request.retryLineage } : {}),
});
```

  `createSkillDocumentAssetScope`在私人分支提供原依赖委托，在document分支提供限定facade；`onProgress`沿用registry实际事件/fence实现，不改变事件/账务主体。scope方法委托现有source-reader/artifacts，不能复制算法。create/find/resolve接口只允许符合当前run绑定的actor/project/idempotency/metadata/parent集合。

- [ ] **Step 3：扩展真实整批事务和受控恢复。** server-run分支仅对实际输出允许unplaced ready canonical attach；复用existing executeDocumentAssetCommandInTransaction，目标资产不复制。对restore从真实remove_snapshot及当前tombstone准备opaque能力，提前准备全部目标/media/annotation引用；最终再验run/current grant/source/delete CAS。恢复新placement及新annotation，保留旧tombstone，不复活已删group，几何/metadata/group/annotation/Yjs/root receipt同COMMIT。现有batch_manifest v1的skill分支严格解析，旧schema与digest不改。未知COMMIT只读durable完整ACK，原key重试，禁止新key补写。普通attach看到删除结果必须拒绝。

- [ ] **Step 4：贯通实际UI。** GET运行结果/制品resolver绑定run/project，历史素材读取observeOnly；Drawer传入共享resolver并保留manifest/run/schema/checksum验证。普通Chat完成effect一次整批投影，不循环独立写；Workspace传skillRunId/explicit restore CAS，等待documentSequence与canonical projection后成功。epoch/actor/project/signal/document/mount变化丢弃late result；成功前不标完成、不本地append。私人项目/独立聊天原模式保持，MPE仍手动加入，Brief单视频不被image过滤丢弃。

- [ ] **Step 5：一次集中验证与交付。** 一个新private PG集群只用55496/本批隔离库和私有媒体；5010/55494及旧25404/27476当前缺席，before/after保持缺席，不重启原服务。复用已安装Node24.19/PG18/ffprobe固定路径，禁止安装。完整新PG文件覆盖真实CPU owner父边/manifestZIP、合规下载、质量尺寸、整批末项失败0部分提交、重放/并发/unknownCOMMIT/新进程恢复、他人删除snapshot/metadata恢复、错run/project/version、撤销/重授权/fence/source变化及本人账务不变。实际UI行为测试与现有canvas/export/Skill/报告/batch消费者完整相关文件集中运行，精确列文件/实际assertion总数，零skip/pending/todo才可称该组通过。

  runner沿用runNative和private guard；test过滤仅用于初始RED，最终相关文件不筛选。最后变更TS ESLint、`tsc --noEmit --incremental false`及runner语法，保留原生日志/JSON/退出码/失败。SQL末检、PGstop、owned进程身份/port/pidfile消失必须实证；磁盘保留审计不能称全部清理。20分钟无新证据换最小复现；同一假设被推翻两次不做第三次同式实验。

  交付同SDD `task-1397-report.md`、`task-1397-review-package.md`（本批baseline到after的精确增量，含before/after字节封存/正反重建证明）；不把整个dirty工作区当本批diff。报告含Status/commits none、实际命令和全部native结果、RED先后、覆盖矩阵、最终pins、资源终态、仍未验证。原Descartes一次Spec+Quality集中审查，控制器独核后才关闭本批。完整8C/8D/8E/Task9/草图/full/build/Coze/发布不因此关闭。

## 自审与衔接

单Task的scope→CPU/输出读取→batch/restore→实际UI共享run/actor/project契约；依赖都在同批定义，无跨Task名称漂移。所有设计章节分别由Step1–5覆盖；新HTTP或module missing不作为业务RED；guarded storage仅内部委托，无私人权限扩张。保留原账务、质量、partial retry、历史命令和共享文档不可原地复活约束。此补充计划由原协作ledger引用，生成brief指定原目录，不创建平铺SDD或另一份进度权威。
