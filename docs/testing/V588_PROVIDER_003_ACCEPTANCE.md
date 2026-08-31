# PROVIDER-003 业务验收断点

更新时间：2026-08-31 15:02（Asia/Shanghai）。本文件记录当前断点，不新增吸收范围。

## 结论

**未完成云端验收，不宣称整个吸收项通过。** 路由拆分已实现，禁止再次搬运；本轮只读核验，没有修改源码、重跑旧全量门禁或发起供应商任务。

- 本地及远端 main：`84b7ef35a92aa343d2fe910d935eeae3e637f674`。
- 源码树：`36cd4c05b00de577eb2a61a7996802e7ff683368`。
- stable：`52f7c601ed150769e15d06fb435c6e360e28c9e7`，未修改。
- 已验云端源码候选：`10bcc899612f3bb2122913b8191bf1f0b70744f4`；main 的后续变化仅为文档，不要求为本记录重新构建。
- 原项目：`https://code.coze.cn/p/7671964106919837702/preview`。
- 原预览：`https://62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.coze.site/`。

## 本轮只读证据

使用 TypeScript AST 比较拆分提交前、拆分提交后与当前工作区的 GET/POST 函数体，统一 CRLF/LF 后，5 个文件的 7 个处理函数全部相同。此检查只证明处理函数没有因拆分被重写，不证明供应商调用、扣费或结果落图成功。

| 文件 | 拆分提交 | 处理函数 | 比较结果 |
| --- | --- | --- | --- |
| `src/app/api/brand-ecommerce/route.ts` | `6a9efa5e` | POST | 相同 |
| `src/app/api/refine-engine/route.ts` | `6a9efa5e` | GET、POST | 相同 |
| `src/app/api/font-design/plan/route.ts` | `c4b49293` | GET、POST | 相同 |
| `src/app/api/font-design/prompt/route.ts` | `c4b49293` | POST | 相同 |
| `src/app/api/font-design/generate-image/route.ts` | `c4b49293` | POST | 相同 |

首轮打印比较未统一换行，品牌当前函数被误报为不同；`git diff 6a9efa5e HEAD -- src/app/api/brand-ecommerce/route.ts` 为空，规范化换行后相同。该工具比较误差保留，不登记为程序 Bug。

既有 11 项专项及 193 个路由 AST 导出门禁继续引用 `evidence/v588-batch-a-status-reconciliation-20260831.json`，本轮没有重复执行，也不计入新增测试数。原始 RED 日志仍未完整关联。

## Chrome 连接断点

成功列出原 Google Chrome 项目页和预览页，并曾返回原预览接管句柄；随后读取页面超时，正确连接消失。没有取得当前页面截图、业务请求或结果，不能据此说登录失败、沙箱断线或功能不可用。

诊断确认 Google Chrome 正在运行，扩展已启用，原生连接组件配置正确。未新建标签页、未操作 360、未发送 Coze 拉取指令、未刷新或重启服务、未修改账号。恢复原连接后继续下表，不重做 PROVIDER-002、Stage 4 或 Pear 分层延期项。

## 待复现观察，不计入已验证 Bug

| 编号 | 静态事实 | 影响与验收边界 |
| --- | --- | --- |
| V588-PROVIDER-003-OBS-001 | 品牌面板 `brand-ecommerce-panel.tsx:378` 提交 `imageProviderId`；路由 `brand-ecommerce/route.ts:485` 读取 `providerId`，504 行将其传入选择器 | 显式供应商可能丢失。git blame 显示两侧均来自原基线 `dc5983d9`，不是拆分引入。下一次核对品牌 UI 的精确选择、实际提交体和任务供应商；发现字段丢失先建立最小失败测试，不重复付费 |
| V588-PROVIDER-003-OBS-002 | `font-design/generate-image/route.ts:181` 在明确 providerId 后仍加入其他提供商；无匹配时采用全部可用图像提供商 | 明确指定的供应商失败后可能被静默替换；原逻辑来自 `dc5983d9`。负向边界先用本地隔离测试，不通过停用真实供应商制造故障，不使用 FHL/4S/虚宝 |
| V588-PROVIDER-003-OBS-003 | `refine-engine/route.ts:388` 的选择器在 providerId 不匹配时回退到模型查找，最终查找任意图像提供商 | 可能不符合精确选择约束；是否能经当前真实授权入口触发未验证，不宣称权限漏洞已复现 |

## 剩余真实验收

| 入口 | UI 链路 | 必须取得的业务证据 | 状态 |
| --- | --- | --- | --- |
| 品牌电商 | 原画布底部入口 → 真实模板 → Pear/APImart 精确模型 → 一个模板及测试商品描述 → 提交 → 结果添加画布 | `/api/brand-ecommerce`、`/api/poll-task`；真实 taskId、供应商及结果 URL；图片可见、保存刷新、计费记录。当前 UI 固定每模板 2 变体，不能当作单张统计 | 未验证 |
| 精修引擎 | 原画布底部入口 → 实际可加载的测试图片 → 预设和精确模型 → 标准精修 → 结果添加画布 | 来源图正确；`/api/refine-engine`；同步结果或异步 taskId/终态；原图未被意外替换，结果可加载并保存刷新 | 未验证 |
| 字境大师 | 原画布底部入口 → 风格库 → 测试文字与预设 → 方案/提示词 → 精确模型 → 单张生成 → 结果添加画布 | `/api/font-design/plan`、`/prompt`、`/generate-image` 及 `/api/poll-task`；独立结果存储有效，成品可见并可恢复 | 未验证 |

三项都捕获截图、Console、网络状态和原生弹窗。未生成的录像或 Trace 不得标成已交付。不能用 HTTP 200、taskId 或供应商开始处理代替结果成功。失败需区分配置、供应商和程序边界；取消及退款缺证时继续标未验证。

只在稳定复现后执行“失败测试 → 最小修复 → 专项与全量回归 → 云端复验”；不重写这三个业务系统，不更改 stable、认证配置、用户权限、供应商配置或账务数据。
