# Brief 到视频成片完整链路实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在统一 Skill Runtime 上实现“Brief → 结构化脚本 → 用户审批 → 单个远程视频任务 → 视频 AssetVersion”的完整链路，并让 Canvas、Workflow 和 Simple Chat 共享同一运行结果。

**Architecture:** 新增独立 `brief-to-video` 领域模块和两个通用 Skill 工具适配器：结构化脚本规划、远程视频生成。规划步骤使用运行时通用审批 checkpoint 暂停，批准后沿同一 Run/generation 恢复；视频提交继续复用 `/api/video/generate`、现有任务核心、积分和 AssetVersion 投影，不建立第二套状态机。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5、PostgreSQL、统一 Skill/Agent Runtime、现有视频供应商兼容层、Vitest 3、Playwright。

## Global Constraints

- 只修改并推送 `main`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 永久只读。
- V5.8.8 只作只读供体，不复制整文件或另建框架。
- 一个 Run 只允许一个最终远程视频任务；不做本地生成、插帧或 FFmpeg 拼接。
- 视频参数必须来自冻结 `providerId + modelId` 的能力快照；不支持的模式、比例、分辨率和时长失败关闭。
- 审批前不得提交视频任务；审批必须绑定 owner、project、Run revision、generation 和 plan checksum。
- 成功只扣费一次；取消、失败、超时最多退款一次；迟到完成不得覆盖终态或创建资产。
- 最终视频创建新的 `kind: 'video'` AssetVersion，不覆盖来源、Placement 或历史版本。
- Canvas/Workflow 现有 29 项全部保留，新增后为 30 项；Simple Chat 目录保持 16 项，不显示 Canvas Skill。
- 所有测试先 RED、再最小实现、再聚焦与扩大回归；云端证据不足时只写 `CLOUD UNVERIFIED`。

---

### Task 1: 建立 Brief、计划、结果和能力字段合同

**Files:**
- Create: `src/lib/brief-to-video/types.ts`
- Create: `src/lib/brief-to-video/schema.ts`
- Modify: `src/lib/skill-runtime/types.ts`
- Test: `src/__tests__/lib/brief-to-video-schema.test.ts`
- Test: `src/__tests__/lib/skill-capability-input.test.ts`

**Interfaces:**
- Produces: `BriefToVideoInput`、`BriefToVideoPlanV1`、`BriefToVideoResultV1`。
- Produces: `parseBriefToVideoInput()`、`parseBriefToVideoPlan()`、`parseBriefToVideoResult()`、`canonicalBriefToVideoPlanJson()`。
- Produces: `SkillInputField.capabilityOptions?: { modelRole: 'video'; field: 'durationSeconds' | 'aspectRatio' | 'resolution' }`。

- [x] **Step 1: 写严格输入、计划和结果失败测试**

```ts
expect(() => parseBriefToVideoInput({ ...valid, brief: '' })).toThrow('BRIEF_VIDEO_BRIEF_INVALID');
expect(() => parseBriefToVideoInput({ ...valid, endFrame: 'end-v1', startFrame: '' })).toThrow('BRIEF_VIDEO_END_FRAME_REQUIRES_START');
expect(() => parseBriefToVideoPlan({ ...plan, scenes: [] })).toThrow('BRIEF_VIDEO_PLAN_SCENES_INVALID');
expect(parseBriefToVideoResult(result).videoAssetVersionId).toBe('video-v1');
```

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-schema.test.ts src/__tests__/lib/skill-capability-input.test.ts`

Expected: FAIL，领域模块和 capability 元数据尚不存在。

- [x] **Step 3: 实现无未知字段的解析器和规范化 JSON**

```ts
export interface SkillCapabilityOptions {
  modelRole: 'video';
  field: 'durationSeconds' | 'aspectRatio' | 'resolution';
}

export function canonicalBriefToVideoPlanJson(value: unknown): string {
  return JSON.stringify(parseBriefToVideoPlan(value));
}
```

限制 Brief 4000、修改要求 2000、负面约束 1000、最多两张来源图片；所有 ID、数组、场景和字符串均设置确定上限。

- [x] **Step 4: 运行聚焦测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-schema.test.ts src/__tests__/lib/skill-capability-input.test.ts`

Expected: PASS，0 skipped。

```bash
git add src/lib/brief-to-video src/lib/skill-runtime/types.ts src/__tests__/lib/brief-to-video-schema.test.ts src/__tests__/lib/skill-capability-input.test.ts
git commit -m "feat: define brief to video contracts"
```

### Task 2: 注册默认关闭的 Skill 与能力驱动参数

**Files:**
- Create: `src/lib/skill-runtime/brief-to-video-preset.ts`
- Create: `src/lib/brief-to-video/capabilities.ts`
- Modify: `src/lib/skill-runtime/catalog.ts`
- Modify: `src/lib/skill-runtime/step-compiler.ts`
- Modify: `src/lib/skill-runtime/storage.ts`
- Modify: `src/lib/runtime-settings.ts`
- Modify: `src/components/skill-runtime/SkillInputFields.tsx`
- Test: `src/__tests__/lib/brief-to-video-preset.test.ts`
- Test: `src/__tests__/components/skill-video-capability-fields.test.tsx`
- Test: `src/__tests__/scripts/skill-runtime-inventory.test.ts`

**Interfaces:**
- Produces: `LOVART_BRIEF_TO_VIDEO_SKILLS`，ID `preset-brief-to-video-film`。
- Produces: `resolveVideoCapabilityFieldOptions(descriptor, field)`。
- Produces: `RuntimeSettings.briefToVideoSkillEnabled`，读取 `BRIEF_TO_VIDEO_SKILL_ENABLED`，默认 `false`。

- [x] **Step 1: 写目录、表面隔离和动态选项失败测试**

```ts
expect(listSkills('canvas')).toContainEqual(expect.objectContaining({ id: 'preset-brief-to-video-film' }));
expect(listSkills('workflow')).toContainEqual(expect.objectContaining({ id: 'preset-brief-to-video-film' }));
expect(listSkills('simple-chat')).not.toContainEqual(expect.objectContaining({ id: 'preset-brief-to-video-film' }));
expect(resolveVideoCapabilityFieldOptions(descriptor, 'durationSeconds')).toEqual(['5', '10', '15']);
```

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-preset.test.ts src/__tests__/components/skill-video-capability-fields.test.tsx src/__tests__/scripts/skill-runtime-inventory.test.ts`

Expected: FAIL，Skill、功能标志和动态字段尚未注册。

- [x] **Step 3: 实现两步骤 Skill 和能力字段**

```ts
steps: [
  { id: 'plan-film', toolId: 'brief_video_plan', modelRole: 'orchestrator', execution: 'sequential', approvalCheckpoint: { kind: 'user-approval', outputSchemaId: 'brief-to-video-plan-v1', nextStepId: 'generate-film', allowRevision: true } },
  { id: 'generate-film', toolId: 'video_generate', modelRole: 'video', execution: 'sequential', qualityGateIds: ['output-present'] },
]
```

`allowedSurfaces` 为三工作区，`catalogSurfaces` 仅 Canvas/Workflow。功能关闭时不进入新运行目录，但历史 Run 仍可读取。

- [x] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-preset.test.ts src/__tests__/components/skill-video-capability-fields.test.tsx src/__tests__/scripts/skill-runtime-inventory.test.ts`

Expected: PASS；现有 29/29/16 基线无减少，新标志开启时为 30/30/16。

```bash
git add src/lib/skill-runtime/brief-to-video-preset.ts src/lib/brief-to-video/capabilities.ts src/lib/skill-runtime/catalog.ts src/lib/skill-runtime/step-compiler.ts src/lib/skill-runtime/storage.ts src/lib/runtime-settings.ts src/components/skill-runtime/SkillInputFields.tsx src/__tests__
git commit -m "feat: register brief to video skill"
```

### Task 3: 实现结构化脚本规划适配器

**Files:**
- Create: `src/lib/brief-to-video/planner.ts`
- Modify: `src/lib/skill-runtime/structured-output.ts`
- Modify: `src/lib/skill-runtime/step-registry.ts`
- Modify: `src/lib/agent-runtime/tool-registry.ts`
- Test: `src/__tests__/lib/brief-to-video-planner.test.ts`
- Test: `src/__tests__/lib/skill-brief-video-plan-adapter.test.ts`

**Interfaces:**
- Produces: `buildBriefToVideoPlanPrompt(input)`。
- Produces: `parseBriefToVideoPlanResponse(response)`。
- Registers: `brief_video_plan` Skill adapter and `brief-to-video-plan-v1` structured output schema。

- [x] **Step 1: 写 JSON、SSE、围栏文本和非法计划失败测试**

```ts
expect(parseBriefToVideoPlanResponse(jsonResponse)).toEqual(expectedPlan);
expect(parseBriefToVideoPlanResponse(sseResponse)).toEqual(expectedPlan);
expect(() => parseBriefToVideoPlanResponse('{"scenes":[]}')).toThrow('BRIEF_VIDEO_PLAN_SCENES_INVALID');
expect(adapterOutput.structured?.schemaId).toBe('brief-to-video-plan-v1');
```

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-planner.test.ts src/__tests__/lib/skill-brief-video-plan-adapter.test.ts`

Expected: FAIL，规划器和 adapter 尚不存在。

- [x] **Step 3: 实现有界结构化解析与冻结 orchestrator 调用**

规划请求只使用 Run 冻结的 orchestrator binding；响应体沿用统一 AbortSignal、超时和最大字节读取。解析失败返回安全错误 `BRIEF_VIDEO_PLAN_INVALID`，不得降级成自由文本后继续视频步骤。

- [x] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-planner.test.ts src/__tests__/lib/skill-brief-video-plan-adapter.test.ts src/__tests__/lib/skill-runtime-executor.test.ts`

Expected: PASS，既有 chat/compliance/local adapters 无回归。

```bash
git add src/lib/brief-to-video/planner.ts src/lib/skill-runtime/structured-output.ts src/lib/skill-runtime/step-registry.ts src/lib/agent-runtime/tool-registry.ts src/__tests__/lib/brief-to-video-planner.test.ts src/__tests__/lib/skill-brief-video-plan-adapter.test.ts
git commit -m "feat: plan structured brief videos"
```

### Task 4: 增加通用用户审批 checkpoint

**Files:**
- Create: `src/lib/skill-runtime/approval.ts`
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/lib/skill-runtime/executor.ts`
- Modify: `src/lib/skill-runtime/service.ts`
- Modify: `src/lib/skill-runtime/continuation.ts`
- Modify: `src/app/api/skill-runs/[runId]/route.ts`
- Modify: `src/components/skill-runtime/use-skill-run.ts`
- Test: `src/__tests__/lib/skill-runtime-approval.test.ts`
- Test: `src/__tests__/api/skill-run-approval.test.ts`
- Test: `src/__tests__/integration/skill-run-approval-postgres.test.ts`

**Interfaces:**
- Produces: `SkillApprovalCheckpoint` and persisted `SkillApprovalStateV1`。
- Produces: `approveSkillRunPlan()`、`reviseSkillRunPlan()`。
- Extends: `PATCH /api/skill-runs/:runId` actions `approve` and `revise`。

- [x] **Step 1: 写暂停、重复批准、旧 revision 和跨用户 RED 测试**

```ts
expect(afterPlan.status).toBe('paused');
expect(afterPlan.error?.code).toBe('SKILL_APPROVAL_REQUIRED');
expect(await approveTwice(sameRevision)).toEqual({ firstDispatches: 1, secondDispatches: 0 });
await expect(approveAsOtherUser()).rejects.toMatchObject({ code: 'SKILL_RUN_NOT_FOUND' });
await expect(approveOldChecksum()).rejects.toMatchObject({ code: 'SKILL_APPROVAL_CONFLICT' });
```

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-approval.test.ts src/__tests__/api/skill-run-approval.test.ts`

Expected: FAIL，当前 PATCH 仅支持 pause/resume/cancel。

- [x] **Step 3: 实现数据库条件式审批和恢复**

审批状态绑定 `runId + revision + generation + planChecksum`。`approve` 原子写入批准事件并只派发一次下一步骤；`revise` 记录受限修改要求、增加 generation 并重新运行规划步骤。审批前 executor 不允许越过 checkpoint。

- [x] **Step 4: 运行单元/API/隔离 PostgreSQL 测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-approval.test.ts src/__tests__/api/skill-run-approval.test.ts`

Run: `pnpm exec vitest run --config vitest.skill-postgres.config.ts src/__tests__/integration/skill-run-approval-postgres.test.ts`

Expected: 两组均 PASS，20 次并发批准只派发一次。

```bash
git add src/lib/skill-runtime/approval.ts src/lib/skill-runtime/types.ts src/lib/skill-runtime/executor.ts src/lib/skill-runtime/service.ts src/lib/skill-runtime/continuation.ts src/app/api/skill-runs/[runId]/route.ts src/components/skill-runtime/use-skill-run.ts src/__tests__
git commit -m "feat: add skill approval checkpoints"
```

### Task 5: 接入精确冻结的视频任务与恢复

**Files:**
- Create: `src/lib/brief-to-video/video-adapter.ts`
- Create: `src/lib/brief-to-video/video-recovery.ts`
- Modify: `src/lib/skill-runtime/run-request.ts`
- Modify: `src/lib/agent-runtime/service.ts`
- Modify: `src/lib/agent-runtime/types.ts`
- Modify: `src/lib/skill-runtime/executor.ts`
- Modify: `src/lib/skill-runtime/step-registry.ts`
- Modify: `src/lib/skill-runtime/cost-estimator.ts`
- Modify: `src/lib/skill-runtime/billing-authorization.ts`
- Modify: `src/lib/skill-runtime/prepaid-generation.ts`
- Modify: `src/lib/skill-runtime/execution-error.ts`
- Modify: `src/app/api/video/generate/route.ts`
- Test: `src/__tests__/lib/brief-to-video-video-adapter.test.ts`
- Test: `src/__tests__/lib/brief-to-video-billing.test.ts`
- Test: `src/__tests__/integration/brief-to-video-concurrency-postgres.test.ts`

**Interfaces:**
- Produces: `executeBriefToVideoStep(step, context)`。
- Produces: `recoverBriefToVideoOperation(operation, context)`。
- Registers: `video_generate` adapter and recovery handler。

- [x] **Step 1: 写精确模型、参数能力和幂等提交 RED 测试**

```ts
expect(submit.providerId).toBe('pear-video');
expect(submit.model).toBe('pear-video::video-model');
expect(submit.duration).toBe(10);
expect(submit.idempotencyKey).toBe(operation.idempotencyKey);
expect(fallbackProviderLookup).not.toHaveBeenCalled();
```

同时覆盖 text-to-video、image-to-video、first-last-frame、不支持参数 400、响应头后卡住、accepted 后断线和 `SKILL_SUBMISSION_UNKNOWN`。

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-video-adapter.test.ts src/__tests__/lib/brief-to-video-billing.test.ts`

Expected: FAIL，Skill Runtime 尚无视频步骤 adapter。

- [x] **Step 3: 实现现有视频 API 的同任务适配**

只从冻结 binding 构造 `/api/video/generate` 请求，传递 project/session/Run provenance 和 operation idempotency key。accepted taskId 先持久化再轮询；恢复从同一远程 taskId 继续，不重新 POST。

- [x] **Step 4: 实现步骤级结算与迟到终态保护**

规划取消只保留规划成本；未执行视频步骤退款一次。accepted 后取消、失败、超时使用数据库条件终态；迟到 completed 仅写审计。

- [x] **Step 5: 运行聚焦和 PostgreSQL 并发测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-video-adapter.test.ts src/__tests__/lib/brief-to-video-billing.test.ts src/__tests__/lib/skill-runtime-execution-error.test.ts`

Run: `pnpm exec vitest run --config vitest.skill-postgres.config.ts src/__tests__/integration/brief-to-video-concurrency-postgres.test.ts`

Expected: PASS；20 次同键只有一个 Run、一个子任务、一次扣费，取消最多一次退款。

```bash
git add src/lib/brief-to-video src/lib/skill-runtime/step-registry.ts src/lib/skill-runtime/cost-estimator.ts src/lib/skill-runtime/billing-authorization.ts src/lib/skill-runtime/execution-error.ts src/__tests__
git commit -m "feat: execute brief video tasks"
```

### Task 6: 资产化视频结果和结构化输出

**Files:**
- Create: `src/lib/brief-to-video/result.ts`
- Modify: `src/lib/skill-runtime/structured-output.ts`
- Modify: `src/lib/skill-runtime/executor.ts`
- Modify: `src/lib/workflow-skill-execution.ts`
- Modify: `src/lib/skill-runtime/canvas-client.ts`
- Test: `src/__tests__/lib/brief-to-video-result.test.ts`
- Test: `src/__tests__/lib/workflow-brief-to-video.test.ts`
- Test: `src/__tests__/lib/canvas-brief-to-video-projection.test.ts`

**Interfaces:**
- Produces: `buildBriefToVideoResult()` and schema `brief-to-video-result-v1`。
- Produces: Canvas/Workflow projections containing `videoAssetVersionId`。

- [x] **Step 1: 写父版本、幂等投影和迟到结果 RED 测试**

```ts
expect(videoVersion.kind).toBe('video');
expect(videoVersion.parentVersionIds).toEqual(['start-v1', 'end-v1']);
expect(secondProjection.version.id).toBe(firstProjection.version.id);
expect(lateCancelledProjection).toMatchObject({ created: false, audited: true });
```

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-result.test.ts src/__tests__/lib/workflow-brief-to-video.test.ts src/__tests__/lib/canvas-brief-to-video-projection.test.ts`

Expected: FAIL，结果 schema 和工作区投影尚不存在。

- [x] **Step 3: 实现同一视频 AssetVersion 投影**

使用现有视频 task projector 建立版本；结构化结果只保存稳定 AssetVersion ID、计划 checksum、冻结模型与远程任务身份。Canvas 和 Workflow 读取同一版本，不复制远程 URL。

- [x] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-result.test.ts src/__tests__/lib/workflow-brief-to-video.test.ts src/__tests__/lib/canvas-brief-to-video-projection.test.ts src/__tests__/lib/asset-task-projector.test.ts`

Expected: PASS，现有图片、文档和视频投影无回归。

```bash
git add src/lib/brief-to-video/result.ts src/lib/skill-runtime/structured-output.ts src/lib/skill-runtime/executor.ts src/lib/workflow-skill-execution.ts src/lib/skill-runtime/canvas-client.ts src/__tests__
git commit -m "feat: project finished video assets"
```

### Task 7: 实现 Canvas 审批与成片结果 UI

**Files:**
- Create: `src/components/skill-runtime/BriefToVideoApprovalCard.tsx`
- Create: `src/components/skill-runtime/BriefToVideoResultCard.tsx`
- Modify: `src/components/skill-runtime/SkillRunProgress.tsx`
- Modify: `src/components/skill-runtime/SkillRunHistory.tsx`
- Modify: `src/components/chat-panel.tsx`
- Test: `src/__tests__/components/brief-to-video-approval-card.test.tsx`
- Test: `src/__tests__/components/chat-panel-brief-to-video.test.tsx`

**Interfaces:**
- Produces: approval/revision/cancel controls using `useSkillRun()`。
- Produces: playable/downloadable finished-video result card。

- [x] **Step 1: 写 UI 状态、积分和 375px RED 测试**

```tsx
expect(screen.getByRole('button', { name: '批准生成' })).toBeEnabled();
expect(screen.getByText('视频步骤预计 120 积分')).toBeVisible();
expect(screen.getByRole('button', { name: '修改脚本' })).toBeEnabled();
expect(screen.getByRole('button', { name: '取消任务' })).toBeEnabled();
expect(screen.queryByText('生成中')).not.toBeInTheDocument();
```

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/brief-to-video-approval-card.test.tsx src/__tests__/components/chat-panel-brief-to-video.test.tsx`

Expected: FAIL，审批卡和结果卡尚不存在。

- [x] **Step 3: 实现 Canvas 表单、审批、真实进度和结果卡**

审批前显示计划，不显示虚假视频进度。批准后仅使用服务器事件；结果卡使用稳定 AssetVersion 播放和下载。布局复用 Skill 视觉变量，375px 单列且按钮高至少 40px。

- [x] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/__tests__/components/brief-to-video-approval-card.test.tsx src/__tests__/components/chat-panel-brief-to-video.test.tsx src/__tests__/components/chat-panel-skill-runtime.test.tsx`

Expected: PASS；现有 Skill、工具栏和对话输入无回归。

```bash
git add src/components/skill-runtime/BriefToVideoApprovalCard.tsx src/components/skill-runtime/BriefToVideoResultCard.tsx src/components/skill-runtime/SkillRunProgress.tsx src/components/skill-runtime/SkillRunHistory.tsx src/components/chat-panel.tsx src/__tests__/components
git commit -m "feat: review brief video plans on canvas"
```

### Task 8: 接入 Workflow 节点审批与下游视频投影

**Files:**
- Modify: `src/components/node-editor.tsx`
- Modify: `src/lib/skill-runtime/workflow-client.ts`
- Modify: `src/lib/workflow-skill-execution.ts`
- Test: `src/__tests__/components/node-editor-brief-to-video.test.tsx`
- Test: `src/__tests__/api/workflow-brief-to-video.test.ts`

**Interfaces:**
- Consumes: generic approval state and `brief-to-video-result-v1`。
- Produces: Workflow node status `waiting-approval` as a UI projection of paused Run, not a new task terminal。
- Produces: downstream `videoAssetVersionId` and `videoUrl` resolved from the authorized version。

- [x] **Step 1: 写双图片端口、暂停下游和恢复 RED 测试**

```tsx
expect(skillNode.inputs).toEqual(expect.arrayContaining(['startFrame', 'endFrame']));
expect(projected.status).toBe('waiting-approval');
expect(downstream.execute).not.toHaveBeenCalled();
expect(afterApproval.output.videoAssetVersionId).toBe('video-v1');
```

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/node-editor-brief-to-video.test.tsx src/__tests__/api/workflow-brief-to-video.test.ts`

Expected: FAIL，Workflow 尚未映射审批暂停和视频结果。

- [x] **Step 3: 实现节点属性、审批和下游等待**

复用 `ai-skill` 节点，分别绑定首尾帧；暂停时 Workflow 保持可恢复而不执行下游。批准后恢复同一 Run，并向 `output-video` 或数据消费者投影同一 AssetVersion。

- [x] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/__tests__/components/node-editor-brief-to-video.test.tsx src/__tests__/api/workflow-brief-to-video.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/api/workflow-skill-execution.test.ts`

Expected: PASS，现有 Workflow Skills 和普通节点无回归。

```bash
git add src/components/node-editor.tsx src/lib/skill-runtime/workflow-client.ts src/lib/workflow-skill-execution.ts src/__tests__/components/node-editor-brief-to-video.test.tsx src/__tests__/api/workflow-brief-to-video.test.ts
git commit -m "feat: run brief videos in workflows"
```

### Task 9: 接入 Simple Chat 的意图式调用

**Files:**
- Create: `src/lib/brief-to-video/simple-chat-intent.ts`
- Create: `src/components/simple-chat/brief-to-video-card.tsx`
- Modify: `src/components/simple-chat/chat-area.tsx`
- Modify: `src/app/api/simple-chat/chat/route.ts`
- Test: `src/__tests__/lib/simple-chat-brief-video-intent.test.ts`
- Test: `src/__tests__/components/simple-chat-brief-to-video.test.tsx`
- Test: `src/__tests__/api/simple-chat-brief-to-video.test.ts`
- Test: `src/__tests__/api/simple-chat-skill-scope.test.ts`

**Interfaces:**
- Produces: `parseSimpleChatBriefVideoIntent(message, attachments, capabilities)`。
- Produces: `needs_clarification | ready`，ready 创建 `surface: 'simple-chat'` 的同一 Skill Run。

- [ ] **Step 1: 写明确意图、缺参追问和目录隔离 RED 测试**

```ts
expect(parseIntent('根据这份 Brief 生成最终视频', context)).toMatchObject({ kind: 'needs_clarification' });
expect(parseIntent(completeMessage, context)).toMatchObject({ kind: 'ready', skillId: 'preset-brief-to-video-film' });
expect(simpleChatCatalog).toHaveLength(16);
expect(simpleChatCatalog.some(skill => skill.id === 'preset-brief-to-video-film')).toBe(false);
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-brief-video-intent.test.ts src/__tests__/components/simple-chat-brief-to-video.test.tsx src/__tests__/api/simple-chat-brief-to-video.test.ts`

Expected: FAIL，意图适配器和卡片尚不存在。

- [ ] **Step 3: 实现确定性意图、逐项追问和同 Run 卡片**

只有“Brief/脚本 + 视频/成片 + 生成”明确组合才触发。附件必须先转为受管 AssetVersion；计划、审批和成片卡复用同一 Run API。返回画布仅创建或恢复 Placement，不复制资产。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-brief-video-intent.test.ts src/__tests__/components/simple-chat-brief-to-video.test.tsx src/__tests__/api/simple-chat-brief-to-video.test.ts src/__tests__/api/simple-chat-skill-scope.test.ts src/__tests__/components/simple-chat-skill-isolation.test.tsx`

Expected: PASS，Simple Chat 目录仍为 16 项。

```bash
git add src/lib/brief-to-video/simple-chat-intent.ts src/components/simple-chat/brief-to-video-card.tsx src/components/simple-chat/chat-area.tsx src/app/api/simple-chat/chat/route.ts src/__tests__
git commit -m "feat: invoke brief videos from simple chat"
```

### Task 10: 完成跨工作区、账务和发布门禁

**Files:**
- Create: `tests/e2e/brief-to-video-finished-film.spec.ts`
- Create: `tests/helpers/brief-to-video.ts`
- Modify: `scripts/doctor.mjs`
- Modify: `src/__tests__/fixtures/skill-runtime-presets.baseline.json`
- Modify: `docs/testing/FUNCTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Create: `docs/testing/evidence/brief-to-video-task9-<date>.json`
- Create: `docs/plans/2026-09-12-brief-to-video-progress.md`

**Interfaces:**
- Produces: Playwright evidence under `test-results/brief-to-video/<commit>/<project>/`。
- Produces: machine-readable cloud evidence with Run/task/transaction/AssetVersion IDs and hashes。

- [ ] **Step 1: 写四浏览器本地 E2E**

覆盖 Canvas 文生视频、首帧、首尾帧；计划审批前零视频请求；修改计划；批准；取消；刷新恢复；Workflow 下游；Simple Chat 意图与 16 项目录隔离。失败自动保留 screenshot、video、trace、Console 和 Network。

- [ ] **Step 2: 运行专项测试**

Run: `pnpm exec vitest run src/__tests__/lib/brief-to-video-schema.test.ts src/__tests__/lib/brief-to-video-preset.test.ts src/__tests__/lib/brief-to-video-planner.test.ts src/__tests__/lib/skill-runtime-approval.test.ts src/__tests__/lib/brief-to-video-video-adapter.test.ts src/__tests__/lib/brief-to-video-billing.test.ts src/__tests__/lib/brief-to-video-result.test.ts src/__tests__/components/brief-to-video-approval-card.test.tsx src/__tests__/components/chat-panel-brief-to-video.test.tsx src/__tests__/components/node-editor-brief-to-video.test.tsx src/__tests__/components/simple-chat-brief-to-video.test.tsx`

Expected: PASS，0 failed，0 skipped。

- [ ] **Step 3: 运行隔离 PostgreSQL 与浏览器矩阵**

Run: `pnpm exec vitest run --config vitest.skill-postgres.config.ts src/__tests__/integration/skill-run-approval-postgres.test.ts src/__tests__/integration/brief-to-video-concurrency-postgres.test.ts`

Run: `$env:BRIEF_TO_VIDEO_SKILL_ENABLED='true'; pnpm exec playwright test tests/e2e/brief-to-video-finished-film.spec.ts --project=chromium --project=firefox --project=webkit --project=mobile-chromium`

Expected: 所有项目 PASS；375px 无遮挡、溢出和不可点击控件。

- [ ] **Step 4: 运行全量发布门禁**

Run: `pnpm run doctor`

Run: `pnpm run ts-check`

Run: `pnpm run lint:build`

Run: `pnpm test`

Run: `pnpm run check:protected-baseline`

Run: `$env:NODE_OPTIONS='--max-old-space-size=8192'; pnpm run build`

Expected: 全部退出码 0；条件测试仅允许因明确缺失隔离 PostgreSQL 配置跳过，并单独记录。

- [ ] **Step 5: 提交并仅推送 main**

```bash
git add src tests scripts docs/testing docs/plans docs/superpowers/plans/2026-09-12-brief-to-video-finished-film.md
git commit -m "feat: deliver brief to video workflow"
git push origin main
```

确认 `HEAD == origin/main` 且 `origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。

- [ ] **Step 6: Coze exact commit 云端验收**

仅在现有浏览器标签中让 Coze 拉取 exact commit、构建、单实例重启并强制刷新预览。使用稳定视频供应商完成一次真实成功和一次可控取消，核对：

- 审批前无视频子任务、批准后只有一个子任务。
- `providerId + modelId`、能力参数、远程 taskId 和 Run 精确一致。
- 成片可播放、可下载，文件 MIME、签名、时长和分辨率有效。
- 视频 AssetVersion、首尾帧父版本、Canvas/Workflow/Simple Chat 恢复一致。
- 成功一次扣费；取消最多一次退款；迟到终态不覆盖。
- 新鲜 Console、Network、Trace、截图、录像和机器证据完整。

只有上述全部真实通过后，Task 9 才登记为 `CLOUD PASS / CLOSED`；否则列出精确未验证项。

## Final Review Gate

- [ ] 逐条映射设计规格 1～15 节，不得遗漏审批、能力、账务、资产或三工作区要求。
- [ ] 搜索计划与实现中的未完成标记、空壳和跳过标记；业务实现结果必须为 0。
- [ ] 核对 `brief-to-video-plan-v1`、`brief-to-video-result-v1`、`planChecksum`、`videoAssetVersionId` 在所有层名称一致。
- [ ] 核对现有 29 个 Canvas/Workflow Skills、16 个 Simple Chat Skills 和全部视频入口没有减少。
- [ ] 核对六个 `.superpowers/sdd/` 用户修改未被暂存、提交、覆盖或格式化。
- [ ] 核对 Obsidian 阶段看板包含计划、约束、exact commit、验证结果和唯一下一动作。
- [ ] 没有 Coze exact commit、真实视频、账务和 AssetVersion 证据时，不得宣布完成。
