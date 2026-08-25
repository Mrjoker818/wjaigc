# Simple Chat Task 7 本地完成报告

## 范围

- 日期：2026-08-25
- 分支：`main`
- 已验证实现提交：`f1cf67b3fcda16d03c35a5dca5a05317b9ab6bc3`
- 受保护分支：`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`，未修改
- V5.8.8 donor：只读参考，未复制其会话所有权、同步逻辑或原始 URL 存储桥接
- 云端状态：待 Coze exact SHA 的 Google Chrome 真实验收

## 问题与最小修复

1. 顶部栏缺少足够高的父层叠上下文，长对话可覆盖聊天和图像模型菜单。
2. 固定 `w-80` 在 320px/375px 视口可能横向溢出。
3. 历史任务只保存 model 或 provider、或保存失效组合时，无法形成当前目录中的精确可提交配对。
4. CanvasEditor 迟到流虽然可被丢弃，但任务切换同批 effect 曾可能把任务 A 的旧消息写入任务 B。
5. 浏览器门禁的页面延迟 `/api/user-data/sync` POST 可能覆盖测试清理后的真实账号数据。

修复保持当前任务为模型单一数据源；仅在目录加载后解析合法精确配对；菜单使用父层级、子层级、内部滚动和窄屏宽度约束；CanvasEditor 以 projectId + taskId 隔离流，并以 `messagesTaskId` 阻止旧消息跨任务回写；Playwright 在播种前拦截页面发起的聊天项目写请求，直接测试请求仍可执行快照、播种和恢复。

## TDD 证据

- 首轮 RED：4 个文件中 6 项失败、17 项通过，精确暴露缺失解析器、残缺配对、迟到 CanvasEditor 结果、固定菜单宽度、缺少 320/375 门禁和测试数据写保护。
- 消息所有权 RED：定向用例 1 项失败，证明任务 B 曾收到任务 A 的消息。
- 保护报告路径 RED：1 项失败、6 项通过；随后本轮只增加 `.superpowers/sdd/task-simple-chat-7-report.md` 这一精确文件，没有新增目录级授权。历史清单中的既有授权不属于本轮改动。
- 最终聚焦 GREEN：8 个文件、43 项通过。

## 最终本地门禁

| 门禁 | 结果 |
|---|---|
| 聚焦回归 | 8 files / 43 tests passed |
| 全仓 Vitest | 536 files passed / 20 skipped；3508 tests passed / 117 skipped；0 failed |
| PostgreSQL 专项 | 缺少 `POSTGRES_TEST_DATABASE_URL`，20 files / 117 tests 明确跳过，不计为通过 |
| TypeScript | `pnpm ts-check` exit 0 |
| ESLint | `pnpm lint:build` exit 0，0 errors；仅有超大 Canvas 文件的既有 Babel 提示 |
| 生产构建 | `pnpm build` exit 0；Next.js 116/116 静态页生成完成 |
| 保护基线 | 38/38 功能 ID，0 warnings，exit 0 |
| 独立复审 | 运行时 Critical/Important 0/0；证据文档已按最终候选更新 |

## 未验证

- 本机缺少真实 E2E 凭据和对应服务环境，Playwright 浏览器业务门禁没有冒充通过。
- Coze 必须拉取最终 `main`，在现有 Google Chrome 标签完成桌面、412px、375px、320px 长对话菜单、精确请求配对、CanvasEditor 跨任务/跨项目、普通对话和 Deep Research 验收。
- 117 项 PostgreSQL 集成/并发测试仍需独立测试数据库，禁止使用生产库替代。

## 判定

本地候选通过，可进入云端验收；Simple Chat 专项尚未云端关闭，全平台仍为有条件通过。
