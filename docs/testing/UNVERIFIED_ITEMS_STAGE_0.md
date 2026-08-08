# Stage 0 未验证与阻塞项

## 2026-08-08 质量门禁补充

- 全量 Vitest：1489 通过、5 失败、4 跳过；失败项与 Stage 0 开始前基线一致，没有新增失败。
- ESLint：4 errors、962 warnings；4 个 error 均位于 Stage 0 未修改的现有业务文件。
- TypeScript、doctor、生产构建、S0 专项 15 项测试和保护基线门禁通过。
- PostgreSQL 并发测试仍因缺少隔离数据库而跳过。
- Chromium 云端可达性证据仍为 `BLOCKED`，原因是云端运行 Commit 无法确认。

> 计划：`WJ-STABLE-001`
> 阶段：Stage 0 版本与功能冻结
> 结论边界：测试基础设施通过不等于平台业务通过

## 必须保持未验证

| 范围 | 状态 | 原因 | 解除条件 |
| --- | --- | --- | --- |
| 云端运行 Git SHA | 阻塞 | 页面未提供可信运行版本证明时，不能假定与本地或 GitHub HEAD 一致 | 部署环境提供可核验 SHA，或响应头/版本接口返回构建提交 |
| 真实供应商图像生成 | 未验证 | Stage 0 不调用付费供应商 | 使用精确 `providerId::modelId` 完成真实生成并保存任务证据 |
| 真实供应商视频生成 | 未验证 | Stage 0 不调用付费供应商 | 完成同步/异步视频任务、终态、下载与账务验证 |
| Pear PSD/ZIP 分层 | 未验证 | Stage 0 不执行远程分层 | 完成异步提交、ZIP 安全下载、主 PSD 提取和图层编辑验证 |
| PostgreSQL 并发幂等 | 阻塞 | 缺少隔离测试数据库 | 提供隔离 PostgreSQL，执行并发重复、终态竞争和退款测试 |
| 积分扣费与退款 | 未验证 | 无真实失败/取消/超时结算证据 | 同 taskId 证明最多一次扣费与一次退款 |
| 支付回调与冲正 | 未验证 | 缺少隔离支付环境和可信回调 | 完成签名回调、重复回调、驳回和冲正测试 |
| 对象存储持久化 | 未验证 | Stage 0 未上传隐私素材 | 使用测试桶验证上传、读取、删除和刷新恢复 |
| 管理员完整操作 | 未验证 | Stage 0 不使用管理员凭据修改数据 | 在隔离账号和测试数据下完成真实浏览器验证 |
| Chromium 业务 E2E | 未验证 | Stage 0 冒烟只验证可达性 | 完成登录、上传、生成、保存、刷新、下载、退出 |
| Firefox/WebKit 业务 E2E | 未验证 | 尚未执行真实跨浏览器业务链路 | 使用同一部署和隔离账号执行核心流程 |
| 安全与混沌测试 | 未验证 | Stage 0 不主动攻击或中断外部系统 | 在授权测试环境执行 OWASP 与故障注入 |

## 已知基线失败

Stage 0 开始前 `pnpm test` 已存在 5 个失败测试，详见：

`docs/testing/baselines/2026-08-08-baseline.json`

这些问题未在 Stage 0 内通过修改业务代码处理，必须在后续对应阶段建立复现测试后逐项修复。

## 2026-08-08 Chromium 真实可达性证据

- 部署地址：`https://www.wjaigc.top/`
- 测试工具：Playwright Chromium
- 视口：`1280 × 720`
- 测试代码提交：`f0ef3a969565b6406e42f04fbd1f065870fc3830`
- 云端运行提交：未确认
- 结果：`blocked`
- 页面文档：可达
- 未捕获 `pageerror`：0
- 网络记录：17 项
- 业务任务：未发起

证据目录已生成于：

```text
test-results/evidence/f0ef3a969565b6406e42f04fbd1f065870fc3830/identity.session/chromium/
```

本次还记录到：

1. APM Plus 外部脚本被当前 CSP 的 `script-src` 拒绝，浏览器产生 Console error。
2. 前端输出 `[DataIsolation] loadData: removed 2 cross-user projects from user admin_mr_joker` 警告。

两项均未在 Stage 0 修改业务代码。前者应在安全头与监控阶段判断是允许该 APM 域名，还是移除无效脚本；后者需要在用户数据隔离阶段核对数据来源与清理行为。
