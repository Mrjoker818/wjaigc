# Task 6 实施报告 — 独立只读画布分享查看器

日期：2026-09-20

## 结果

已按 Task 5 的公开投影契约实现独立分享页、客户端加载边界、只读查看器、只读工具栏、媒体预览、组件测试和基础 Playwright 夹具。查看器只读取公开 metadata 与其受控媒体路径，不挂载编辑器状态机，不持久化浏览器项目状态，也不发出写请求。

功能开关保持原有默认关闭状态；未修改 stable、donor、ledger，也未实现 Task 7/8。

## TDD 证据

### RED

1. 首次先新增 `src/__tests__/components/shared-canvas-viewer.test.tsx`，运行：

   `pnpm vitest run src/__tests__/components/shared-canvas-viewer.test.tsx`

   结果：失败；测试套件无法解析尚不存在的 `@/app/shared/canvas/[token]/page`，0 项测试收集。这证明测试在实现前为红。

2. 基础 Chromium 首次冒烟发现真实 Pointer Events 缺陷：画布捕获从工具栏冒泡的 `pointerdown`，导致浏览器点击放大按钮后比例仍为 100%。先增加回归测试 `does not let canvas pointer capture intercept toolbar controls`，单独运行得到 1 failed / 20 passed；随后让画布手势忽略 `[data-toolbar]`，GREEN 为 21/21。

### GREEN

- 页面 metadata 声明 noindex/nofollow/noarchive，服务端页面不注入 token、owner、project 或其他内部标识。
- 客户端只通过当前路由 token 请求 `GET /api/public/canvas-shares/[token]`，校验 Task 5 schema，并区分骨架、有效态、统一失效态和安全网络错误态。
- 公开 `mediaPath`/`downloadPath` 仅允许严格的 tokenless `media/csr_...` 形式，并相对带尾斜杠 metadata 基址解析；拒绝绝对 URL、scheme-relative、父目录、根路径、非 `media/` 路径、query/hash。
- 查看器以服务端 viewport 初始化，只在组件本地维护 pan、pinch/zoom、fit、比例、fullscreen、媒体焦点与预览状态；媒体对象不可拖动或编辑。
- 单媒体失败保留 transform slot 并显示“此内容暂不可用”，不会隐藏其他媒体。
- 图片使用公开 alt 文本；视频 `playsInline`、`muted`、无自动播放；预览支持 Escape 关闭与焦点恢复。
- 工具栏按钮至少 44px、可换行、使用安全区与 `dvh`，并保留 visible focus 和 reduced-motion 行为。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| Task 6 组件 + Task 5 public API + public PostgreSQL integration | 100 passed，2 skipped；PostgreSQL 两项因未配置 `POSTGRES_TEST_DATABASE_URL` 跳过 |
| `pnpm test:regression` | 562 files passed，6 files skipped；4953 tests passed，25 skipped |
| `pnpm ts-check` | 通过；Next route typegen 与 TypeScript 检查退出码 0 |
| `pnpm lint:build` | 通过；ESLint 退出码 0 |
| Chromium 基础 Playwright | 2/2 passed：有效公开快照只读请求、统一失效态 |
| 静态 import/request scan | 无编辑、生成、聊天、保存、任务注册、localStorage/IndexedDB 依赖；运行时代码仅发现一个 metadata `fetch`，方法为 GET |
| staged diff check | 提交前运行 `git diff --cached --check`，要求退出码 0 |

## 安全、无障碍与响应式自审

- 不展示服务端原始错误或 raw token；仅接受 `req_[a-f0-9]{16}` 格式的请求标识。
- raw token 仅作为当前公开 route 的授权路径上下文使用，不写 JSON、日志或存储。
- 下载动作同时受公开策略与严格 `downloadPath` 校验控制；默认不显示。
- 所有新增用户文案与可访问名称为中文；图标为 Lucide SVG，装饰图标从可访问树隐藏。
- 画布视口可键盘聚焦，缩放/fit/fullscreen 都有按钮替代手势；预览具有 dialog 语义、关闭按钮、Escape 与焦点恢复。
- 使用现有主题 token、44px 控件、窄宽换行、safe-area、`100dvh` 和 reduced-motion 分支；没有引入独立视觉系统。

## 浏览器与人工验证边界

- 已验证：本机 Next 开发服务 + Chromium 的两条基础夹具，桌面有效态、放大、图片预览/Escape、请求只读和失效态。
- 未验证：Firefox、WebKit、320/375/393 移动矩阵、横屏、真实双指 pinch、真实 fullscreen 切换、真实视频播放、下载文件内容、手工视觉/对比度/大字号检查。这些不在本任务中声明通过；完整矩阵属于 Task 7。
- 未验证：真实 PostgreSQL public integration；缺少 `POSTGRES_TEST_DATABASE_URL`。
- 本地开发服务报告数据库、Python/本地 AI 模型未配置；这些对被路由夹具拦截的基础查看器测试是非致命环境限制。

## 变更文件

- `src/app/shared/canvas/[token]/page.tsx`
- `src/app/shared/canvas/[token]/shared-canvas-client.tsx`
- `src/components/canvas-share/shared-canvas-viewer.tsx`
- `src/components/canvas-share/shared-canvas-toolbar.tsx`
- `src/components/canvas-share/shared-media-preview.tsx`
- `src/__tests__/components/shared-canvas-viewer.test.tsx`
- `tests/e2e/read-only-canvas-share.spec.ts`
- `.superpowers/sdd/2026-09-19-read-only-canvas-share/task-6-report.md`

## 提交

- 基线 HEAD：`007d687dea0df9821661c28bf062565fba029f37`
- 提交信息：`feat: 增加只读画布分享查看器`
- 本报告随同上述提交；最终提交 SHA 需在提交生成后读取，记录在任务最终回报中（提交内容无法自引用其自身 SHA）。
