# V588-MEDIA-001 Task 9 本地实施报告

## 结论

- 状态：`LOCAL PASS / CLOUD UNVERIFIED`
- 基线：`main@74716cb99e3972d27c9fac7fd4aa22c0f1130d83`
- 首个失败合同提交：`0afeccd8`
- 复审修复提交：`b1c87276`、`244ee15d`、`65601afc`
- 最终门禁候选：`65601afc63025ae9eb3173910befaa693fe8f99d`
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未修改，donor 未修改，用户既有 dirty 文件未触碰。
- 本阶段未执行 Coze、真实供应商调用或云端浏览器验收。

## 独立复审 3 Important 修复

1. E2E 不再用 `Promise.all` 冒充逐槽返回：`n=2` 顺序轮询并要求观察到“首槽已完成、另一槽仍未终态”，首张结果还会在真实 `page` 中加载并可见。
2. 取消只接受权威 `cancelled`：继续轮询确认终态，采样拒绝迟到结果，并核对自身账务流水恰好一次消费、一次退款、净额为零。
3. 预览、下载、256/512 缩略图均实际发起 HTTP 请求，校验状态、MIME、字节与 Sharp 尺寸；AssetVersion 仅在数据库已证明 `asset_version_id + owner_id` 归属且缩略图 ready 后投影。
4. 新增限流、UTC 日配额、同键异摘要 409、吊销凭据、跨用户隔离和原登录/画布/图像/视频入口兼容规格。
5. 成功态证据采集器会自动保存 screenshot、video、trace、console、network 和机器 manifest，并记录 requestId、gatewayRequestId、taskId 与脱敏账务流水。`request` 保留 API 边界，`page` 承担真实 UI 流程。
6. 新增门禁记录器，原样保存 stdout/stderr、命令、commit、起止时间、退出码和 SHA-256。证据索引同时保留失败轮次与最终通过轮次，禁止只展示成功结果。

## TDD 证据

- 合同 RED：`3 failed / 0 passed`，提交为 `0afeccd8`。
- AssetVersion 所有权投影 RED：`1 failed / 12 passed`；最小实现后 GREEN 为 `13/13`。
- Windows 门禁记录器 RED：Node 25 直接启动 pnpm 出现 `spawn EINVAL`；改为解析 pnpm JS 入口后 GREEN。
- 保护基线 RED：`244ee15d` 轮次 exit 1，原因是新门禁脚本未进入精确白名单；仅授权该脚本路径后 `65601afc` 轮次 `38/38`、0 drift、0 warning、exit 0。

## 最终本地门禁

| 门禁 | 结果 |
|---|---|
| Doctor 专项 | 2 文件，`24/24`，0 failed，0 skipped，exit 0 |
| 媒体网关专项 | 21 文件，`338/338`，0 failed，0 skipped，exit 0 |
| 全仓 Vitest | 803 文件，`6750/6750`，0 failed，0 skipped，931.18 秒，exit 0 |
| TypeScript | `pnpm ts-check`，exit 0 |
| 构建版 ESLint | `pnpm lint:build`，exit 0 |
| 保护基线 | `38/38`，0 drift，0 warning，exit 0 |
| 生产构建 | `120/120` 页面，exit 0 |
| E2E 规格发现 | 7 个逻辑场景，11 个项目展开为 77 项，exit 0；未执行云端 |

所有 PostgreSQL 条件测试均连接一次性非管理员 PostgreSQL 18.4 实例真实执行，未 skip。测试后已确认 55443 无监听、临时账户不存在、数据目录和日志均不存在。构建保留 55 条 Turbopack 动态文件追踪 warning，原始 stderr 已归档；该风险未通过隐藏警告或猜测性重构处理。

## 证据

- 最终证据目录：`docs/testing/evidence/v588-media-gateway-task9-review-65601afc/`
- 历史失败目录：`docs/testing/evidence/v588-media-gateway-task9-review-244ee15d/`
- 证据索引：`docs/testing/evidence/v588-media-gateway-task9-review-65601afc/evidence-index.json`
- 索引 SHA-256：`209b0fddf2d8ebc3c92d8b8b63f9fca7da8bf7714ea5dffa62f2f11537df2fb7`

## 未关闭项

Coze exact commit、默认关闭兼容、PearAPI/APIMart 真实图像与视频、逐槽到达时间、真实取消退款、AssetVersion/缩略图资源、刷新恢复及浏览器成功态制品仍为 `pending`。本地规格和 PostgreSQL 证据不能冒充云端证据，因此 Task 9 仍不得标记为 `CLOUD PASS`，也不得更新 `stable`。
