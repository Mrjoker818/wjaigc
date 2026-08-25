# Simple Chat Task 7 本地与模型菜单云端验收报告

## 范围

- 日期：2026-08-25
- 分支：`main`
- 已验证实现提交：`f1cf67b3fcda16d03c35a5dca5a05317b9ab6bc3`
- 受保护分支：`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`，未修改
- V5.8.8 donor：只读参考，未复制其会话所有权、同步逻辑或原始 URL 存储桥接
- 云端状态：模型菜单已在 Coze exact SHA 的 Google Chrome 关闭；三入口流式终态仍待验

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

模型菜单子项已经云端关闭；Simple Chat 三入口流式终态尚未关闭，全平台仍为有条件通过。

## 320px 复现与第二次最小修复

- 首轮云端候选 `912eaa46` 在桌面、412px、375px 正常，但 320x568 下图像模型按钮位于换行后的偏置位置，`right-0` 仍以按钮容器为坐标系，296px 菜单左边界落到约 `-26px`。
- 新增 `resolveSimpleChatModelMenuLayout()`，只根据按钮矩形与当前视口计算菜单宽度、相对 left、展开方向和最大高度；没有修改模型目录、供应商、任务、积分或聊天持久化。
- RED 覆盖 320px 真实按钮坐标、桌面右对齐和底部空间不足时向上展开；GREEN 为 3 files / 14 tests。相关 Simple Chat 回归为 16 files / 100 tests；TypeScript、零错误 Lint、生产构建 116/116 和提交后的保护基线 38/38 均通过。
- 全仓首轮为 3510 passed / 117 PostgreSQL-gated skipped / 1 个既有 `stage-3-source-state` 20 秒负载超时；该文件单独重跑 2/2、13.92 秒通过。没有放宽超时，也不把首轮全仓写成全绿。

## Coze Google Chrome 证据

| 项目 | 结果 |
|---|---|
| 云端提交 | `9a3fcb63d732a0f8cf572be4741ec93585c8f400`，`origin/stable@52f7c601...` 未触碰 |
| 云端构建 | exit 0，PID 1370；`/`、`/simple-chat`、`/api/auth/me` 为 200；12 个静态资源均为 200 |
| 320x568 | 图像菜单 `left=12/right=308/width=296/height=253.74`；聊天菜单 `left=12/right=308/width=296` |
| 375x667 | 聊天菜单 `43..363`；图像菜单 `12..332`，无横向裁切 |
| 412x915 | 聊天菜单 `80..400`；图像菜单 `41.3..361.3`，无横向裁切 |
| 1440x900 | 聊天菜单 `306.7..626.7`；图像菜单 `712..1032`，保持 320px 桌面宽度 |
| 交互 | 图像菜单 23 个 option，`overflow-y:auto`、`scrollHeight=1290/clientHeight=382`；聊天菜单 4 个 option；点选首项后两个菜单均 `aria-expanded=false` |
| Console | 服务切换首次刷新记录一次 chunk 3230 加载失败；确认同一 chunk 已 200 后第二次刷新成功，之后没有新增 error/warning |

首次刷新异常属于既有部署资源切换问题的复发证据，不影响菜单布局结论，但阻止把整个平台标记为完全通过。
