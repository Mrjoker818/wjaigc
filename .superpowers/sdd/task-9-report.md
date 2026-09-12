# Task 9 实现报告

## 结果

已在 `main@9b9177102e811c22e723a1726a22c079bad9f2f8` 对应分叉工作区完成 Simple Chat 的 Brief 到视频成片意图式调用。提交信息为 `feat: invoke brief videos from simple chat`，本报告随该提交保存。

## 改动

- 新增确定性 `parseSimpleChatBriefVideoIntent(message, attachments, capabilities)`：仅匹配“Brief/脚本 + 视频/成片 + 生成/制作/产出”的明确组合。
- 按 Brief、平台、时长、比例、视频模型顺序逐项追问，并支持跨多轮持续补参；普通视频讨论不触发。
- 从用户可用视频能力目录解析精确 `providerId + modelId`，拒绝能力外时长、比例和来源模式。
- 附件只接受当前消息已登记并经服务端归属校验的受管 AssetVersion，最多两张，依次绑定首帧和尾帧。
- 以 `surface: 'simple-chat'` 创建同一个 `preset-brief-to-video-film` Skill Run，冻结当前聊天模型为 orchestrator、明确指定的视频模型为 video binding；重复 Run 不重复 dispatch。
- 新增 Simple Chat 同 Run 卡片，复用现有脚本审批卡、成片卡和事件投影；审批、修改、取消均调用同一 Skill Run 控制 API，审批后重启同 Run 事件订阅。
- 返回画布传递原视频 AssetVersion，由现有资产 transfer 语义仅创建或恢复 Placement，不创建替代资产。
- 禁止客户端通过 `skillId` 直接选择隐藏 Brief 视频 Skill；Simple Chat 独立目录仍为 16 项且不显示该 Skill。

## TDD 证据

### RED 1

命令：

```bash
pnpm exec vitest run src/__tests__/lib/simple-chat-brief-video-intent.test.ts src/__tests__/components/simple-chat-brief-to-video.test.tsx src/__tests__/api/simple-chat-brief-to-video.test.ts
```

结果：失败，退出码 1。意图适配器与卡片模块不存在，API 明确意图仍落入普通聊天并返回 400，符合预期 RED。

### GREEN 1

同一命令结果：3 个测试文件、9 个测试全部通过。

### RED/GREEN 2：多轮逐项追问

命令：

```bash
pnpm exec vitest run src/__tests__/api/simple-chat-brief-to-video.test.ts
```

RED：4 个测试中 1 个失败，跨五轮补参时返回 400。最小修复后 GREEN：4/4 通过。

### RED/GREEN 3：同 Run 取消与审批后刷新

命令：

```bash
pnpm exec vitest run src/__tests__/components/simple-chat-brief-to-video.test.tsx
```

RED：取消未调用 Skill Run PATCH；修复后 3/3 通过。随后新增审批后刷新断言，RED 显示事件 hook 未收到刷新版本；最小修复后 3/3 通过。

## 完整回归

Brief 指定命令：

```bash
pnpm exec vitest run src/__tests__/lib/simple-chat-brief-video-intent.test.ts src/__tests__/components/simple-chat-brief-to-video.test.tsx src/__tests__/api/simple-chat-brief-to-video.test.ts src/__tests__/api/simple-chat-skill-scope.test.ts src/__tests__/components/simple-chat-skill-isolation.test.tsx
```

结果：5 个测试文件、60 个测试全部通过。

补充兼容回归包含既有批量导出测试：8 个测试文件、77 个测试全部通过。

静态检查：

- `pnpm ts-check`：通过。
- `pnpm lint`：退出码 0，0 error；仓库已有 948 条 warning，本次改动未引入 lint error。
- 本任务文件限定 `git diff --check`：通过。

## 自审

- 明确意图之外不会加载视频能力目录或创建 Skill Run。
- 追问链只在上一条助手消息是本功能固定追问时延续，不会由普通回复重新激活旧任务。
- 来源版本、模型绑定、surface、项目和 workspace 均进入同一权威 Run 请求。
- 审批、修改、取消、事件恢复和结果读取均引用同一 `runId`。
- Simple Chat 目录隔离测试确认仍为 16 项，隐藏 Brief Skill 不能直接选择。
- 初始记录的 7 个受保护用户文件 SHA-256 在实现后逐一复核，均未变化；未暂存这些文件，未触碰 `stable`。

## 关注点

- 全仓 `git diff --check` 会被用户已有的 task-2/task-3 文档尾部空行变更阻断；限定本任务文件后通过，按约束未修改这些受保护文件。
- 全仓 lint 保留 948 条既有 warning，退出码为 0，不影响本任务门禁。

## 独立审查修复（2026-09-13）

提交信息：`fix: preserve brief video canvas placements`。

### 改动

- 视频返回画布改用 `/api/assets/batch-transfer`，明确请求 `canvas-video`、`canvas:{projectId}` 与 `restoreDeletedPlacements: true`；同项目返回继续校验并保留原视频 AssetVersion，已删除 Placement 由批量 transfer 事务恢复。
- Asset Core 增加 `canvas-video` 实体类型，并让画布快照的创建、删除、恢复和查询同时覆盖图片与视频 Placement。
- Simple Chat bridge 保留受管引用的 `kind`，视频重建为带 `mediaType: 'video'`、`videoUrl` 和 `entityType: 'canvas-video'` 的可播放节点，不创建资产副本。
- Brief 缺参追问后允许用户直接粘贴裸正文；该兼容仅在上一条助手消息是固定 Brief 追问时生效，普通对话仍不触发。
- Skill Run history 透传冻结步骤的权威 `cost`，审批卡从同一 Run 的 `generate-film` 步骤显示预计积分。
- 视频模型改为精确解析：完整 `providerId/modelId` 优先，裸 `modelId` 仅在能力目录中唯一时采用。

### RED / GREEN

RED：

```bash
pnpm vitest run src/__tests__/lib/simple-chat-brief-video-intent.test.ts src/__tests__/api/simple-chat-brief-to-video.test.ts src/__tests__/components/brief-to-video-approval-card.test.tsx src/__tests__/api/workspace-batch-transfer.test.ts src/__tests__/components/simple-chat-asset-transfer.test.ts
```

结果：退出码 1；5 个测试文件均失败，共 6 个失败、42 个通过。失败分别证明裸 Brief 未续接、同名/公共前缀模型误匹配、审批卡无 Run estimate、`canvas-video` 被拒绝、返回仍使用单项 transfer、bridge 仍生成图片节点。

GREEN：同一命令结果 5 个测试文件、48 个测试全部通过。

### 完整回归

Task 9 指定套件加 asset transfer、batch transfer、canvas bridge、视频审批卡及 Placement 恢复相关套件：12 个测试文件通过、1 个数据库套件跳过；146 个测试通过，9 个因未配置 PostgreSQL 跳过。补跑 `skill-runtime-executor.test.ts`：49/49 通过。合计 195 个测试通过。

- `pnpm ts-check`：退出码 0。
- changed-files `pnpm exec eslint --quiet ...`：退出码 0。
- 本任务文件 `git diff --check`：通过；全仓检查仍仅命中受保护用户文档的既有 EOF 空行。
- Simple Chat 目录隔离回归通过：保持 16 项且不显示 Brief Skill。

### 自审与关注点

- 返回路径的幂等键、entityId 和源 AssetVersion 保持稳定；再次返回会命中原 trashed Placement 并在同一批量事务中恢复为 active。
- 视频节点语义由权威 Asset `kind` 恢复，Placement 使用 `canvas-video`，画布快照查询同时覆盖两类 canvas entity。
- 9 个 PostgreSQL Placement 恢复测试因当前环境无数据库而跳过；对应 API、服务语义和 bridge 回归均已通过。
- 未修改或暂存受保护文件，未触碰 `stable`。

## 第二轮复审修复（2026-09-13）

提交信息：`fix: restore legacy canvas video snapshots`。

### 改动

- `restoreCanvasPlacementSnapshot` 同时读取 AssetVersion 与 Asset kind；当 Asset kind 为 video 或 Placement 为 `canvas-video` 时，重建 `mediaType: 'video'`、当前版本 `videoUrl`，并按项目既有 `videoThumbnailUrl → thumbnailUrl → poster url` 语义保留缩略图。
- legacy 项目快照刷新后仍保持 poster 与真实视频 URL 分离；`canvas-image` 继续沿用原恢复形态。
- historical media remediation 将 `canvas-image` 与 `canvas-video` 都纳入快照同步删除，Placement shadow 状态与 legacy canvas snapshot 一并清理，避免 ghost video。

### TDD 与验证

RED：

```bash
pnpm exec vitest run src/__tests__/lib/asset-storage-canvas-restore.test.ts src/__tests__/lib/historical-media-remediation.test.ts
```

结果：退出码 1；3 个失败、20 个通过。失败证明视频恢复把 mp4 写入 poster `url`、保留旧 `videoUrl`，且 remediation 不识别 `canvas-video`。

GREEN：同一命令 2 个测试文件、23 个测试全部通过。

相关 asset storage、remediation、project reader、canvas shadow 与 Task 9 回归：16 个测试文件、284 个测试全部通过。

- `pnpm ts-check`：退出码 0。
- changed-files `pnpm exec eslint --quiet ...`：退出码 0。
- 本轮文件 `git diff --check`：通过。

### 关注点

- 本轮相关测试全部执行，无跳过项。
- 受保护文件保持原哈希且未暂存；未触碰 `stable`。
