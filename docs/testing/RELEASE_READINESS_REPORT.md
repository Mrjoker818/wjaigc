# 无界AI — 发布就绪报告 (RELEASE READINESS REPORT)

> [!IMPORTANT]
> **2026-08-08 最新状态覆盖：当前整体发布结论为“不通过”。**
> 本文件下方 2026-07-20 的“100% 通过、可投入生产”仅是历史快照，不能覆盖后续已登记的未闭环缺陷、5 个基线测试失败、4 个 ESLint 错误、PostgreSQL 并发/账务阻塞和云端运行 SHA 未确认。
> 最新 Stage 0 证据见 `docs/testing/STAGE_0_COMPLETION_REPORT.md` 与 `docs/testing/UNVERIFIED_ITEMS_STAGE_0.md`。

> 生成时间：2026-07-20
> 版本：v3.8.0
> 测试周期：全平台真实用户测试、缺陷扫描与统一修复

---

## 执行摘要

无界AI平台经过 13 阶段全平台测试，累计执行 **121 项测试用例（119 项执行）**，覆盖功能盘点（103项功能矩阵）、健康检查（36项）、E2E 跨浏览器测试（Chromium/Firefox/WebKit）、API 核心接口测试、异常混沌测试、OWASP 安全测试和静态代码扫描。发现并修复 **6 个缺陷**（1个P0 + 2个P1 + 3个P2），**100% 修复率**，**100% 测试通过率**。

**发布建议：✅ 准备就绪，可投入生产环境发布。**

---

## 测试覆盖矩阵

| 阶段 | 测试类型 | 用例数 | 通过 | 失败 | 状态 |
|------|---------|--------|------|------|------|
| 1 | 功能盘点 (FUNCTION_INVENTORY) | 103 | 103 | 0 | ✅ 完成 |
| 2 | 测试基础设施 | — | — | — | ✅ 完成 |
| 3 | 健康检查 (doctor) | 36 | 31 | 0 | ✅ 完成 (5项环境警告) |
| 4 | 静态代码扫描 | 2 | 2 | 0 | ✅ 完成 |
| 5 | API 核心接口测试 | 46 | 46 | 0 | ✅ 完成 |
| 6 | E2E 跨浏览器测试 (P0) | 9 | 9 | 0 | ✅ 完成 |
| 6+ | E2E 补充测试 (Flow B/D/E) | 12 | 12 | 0 | ✅ 完成 |
| 7 | 异常和混沌测试 | 21 | 21 | 0 | ✅ 完成 |
| 8 | OWASP 安全测试 | 31 | 31 | 0 | ✅ 完成 |
| 11 | CI 质量门禁 (GitHub Actions) | — | — | — | ✅ 已配置 |
| 12 | 可观测性 (requestId + 错误监控) | — | — | — | ✅ 已实现 |
| **合计** | — | **121** | **119** | **0** | **✅ 全通过** |

---

## 缺陷修复统计

| 级别 | 发现 | 修复 | 修复率 | 阻断发布 |
|------|------|------|--------|---------|
| P0 (阻断) | 1 | 1 | 100% | 否 |
| P1 (严重) | 2 | 2 | 100% | 否 |
| P2 (一般) | 3 | 3 | 100% | 否 |
| P3 (轻微) | 0 | 0 | — | 否 |
| **合计** | **6** | **6** | **100%** | **否** |

### 关键修复

1. **BUG-001 (P0)**: WebKit 安全 Cookie 导致 401 — 修复 `login/route.ts` 和 `logout/route.ts` 中 localhost 的 `secure` 标志
2. **BUG-002 (P1)**: WebKit selectOption 不触发 React onChange — 添加 dispatchEvent 后备
3. **BUG-003 (P1)**: 模型选择存储路径不一致 — 修正 E2E 测试 localStorage key

---

## 跨浏览器兼容性

| 浏览器 | E2E 测试 | 通过率 | 备注 |
|--------|---------|--------|------|
| Chromium | 3/3 | 100% | 基准浏览器 |
| Firefox | 3/3 | 100% | 无兼容性问题 |
| WebKit | 3/3 | 100% | 修复1个P0 + 2个P1后通过 |

---

## 安全评估

| OWASP 类别 | 测试项 | 通过率 | 风险等级 |
|-----------|--------|--------|---------|
| A01 访问控制 | 8 | 100% | 低 |
| A02 加密机制 | 3 | 100% | 低 |
| A03 注入 | 5 | 100% | 低 |
| A05 安全配置 | 4 | 100% | 低 |
| A07 身份认证 | 5 | 100% | 低 |
| A08 数据完整性 | 2 | 100% | 低 |
| A10 SSRF | 2 | 100% | 低 |
| 路径穿越 | 2 | 100% | 低 |

**安全结论**：未发现 P0/P1 安全漏洞。所有受保护 API 有认证检查，数据库使用参数化查询，文件操作有路径穿越防护。

---

## 功能验证清单

### 核心功能 ✅
- [x] 用户认证（登录/注销/会话保持）
- [x] 图像生成（提示词→提交→轮询→显示）
- [x] 模型选择（下拉菜单切换）
- [x] 用户数据持久化（项目创建/保存/恢复）
- [x] 跨用户数据隔离

### 异常处理 ✅
- [x] HTTP 404/405/413 错误正确处理
- [x] 未授权请求返回 401
- [x] 重复提交防护
- [x] 任务取消机制
- [x] 超大请求体处理
- [x] 特殊字符提示词处理

### 安全防护 ✅
- [x] SQL 注入防护（参数化查询）
- [x] XSS 防护（React 自动转义）
- [x] CSRF 防护（SameSite Cookie）
- [x] 路径穿越防护
- [x] IDOR 防护
- [x] SSRF 防护（私有 IP 检测）
- [x] 命令注入防护

---

## 代码质量

| 指标 | 结果 |
|------|------|
| TypeScript 严格检查 | 0 错误 |
| ESLint 检查 | 0 错误 |
| 空 catch 块 | 0 |
| eval/Function 使用 | 0 |
| 硬编码密钥 | 0 |
| SQL 字符串拼接 | 0 |

---

## 已知限制与建议

### 非阻断建议（可在后续版本改进）
1. **请求体大小限制**：建议添加全局请求体大小限制（1MB），防止资源耗尽
2. **登录速率限制**：建议为 `/api/auth/login` 添加速率限制（5次/分钟）
3. **CSP 头**：建议添加 Content-Security-Policy 响应头
4. **Cookie SameSite**：生产环境建议使用 `sameSite: 'strict'`

### 测试覆盖说明
- 移动端测试已取消（平台无移动端界面）
- 视频生成/3D模型/工作流等高级功能未纳入本次自动化测试范围（需API Key配额）
- 建议后续版本补充这些功能的 E2E 测试

---

## 测试文件清单

| 文件 | 类型 | 用例数 |
|------|------|--------|
| `tests/e2e/p0-core.spec.ts` | E2E | 3 (×3浏览器 = 9) |
| `tests/e2e/p0-auth-session.spec.ts` | E2E | 3 (×3浏览器 = 9) |
| `tests/api/core-api.test.ts` | API | 46 |
| `tests/api/chaos-test.test.ts` | API | 21 |
| `tests/api/security-test.test.ts` | API | 31 |

### 文档清单

| 文件 | 说明 |
|------|------|
| `docs/testing/BUG_REGISTER.md` | 缺陷登记表（6个缺陷） |
| `docs/testing/SECURITY_REPORT.md` | 安全测试报告（OWASP Top 10） |
| `docs/testing/REGRESSION_REPORT.md` | 回归测试报告（109项全通过） |
| `docs/testing/RELEASE_READINESS_REPORT.md` | 发布就绪报告（本文件） |

---

## 最终结论

| 评估维度 | 结果 | 状态 |
|---------|------|------|
| 功能完整性 | 所有核心功能正常 | ✅ |
| 跨浏览器兼容 | Chromium/Firefox/WebKit 全通过 | ✅ |
| 安全性 | OWASP Top 10 全通过 | ✅ |
| 代码质量 | TS/Lint 零错误 | ✅ |
| 缺陷修复 | 6/6 修复 (100%) | ✅ |
| 回归测试 | 109/109 通过 (100%) | ✅ |

### 发布决策：✅ 批准发布

无界AI v3.8.0 已通过全平台测试验证，所有 P0/P1 缺陷已修复，109 项自动化测试 100% 通过，安全评估无阻断问题。**建议批准生产环境发布。**

## 2026-07-29 Pear 混合分层发布复核

此前 v3.8.0 的历史结论不适用于当前 v4.0.0 工作区。当前复核基于 Pear 混合分层 Task 1-9 提交链及本轮已提交的回归门禁修复，具体版本以同一工作区的 `git log` 为准。

### 当前门禁

| 门禁 | 状态 | 证据 |
|------|------|------|
| Doctor | 有条件通过 | 23 passed / 10 warnings / 0 failed |
| TypeScript | 已通过 | `next typegen` + `tsc`，0 errors |
| ESLint | 有条件通过 | 0 errors / 944 warnings |
| Pear/分层专项测试 | 有条件通过 | 68 passed / 1 PostgreSQL skip |
| 生产构建 | 已通过 | Next.js 16.2.10，110 静态页面 |
| 全仓测试 | 有条件通过 | 文件级串行门禁；233 files passed / 2 skipped；1066 tests passed / 2 skipped；0 failed；140.73s |
| Chromium 本地分层冒烟 | 阻塞 | 已生成完整 Playwright 证据；登录 API 因本地缺少数据库/鉴权配置返回 503 |
| Chromium 真实 Pear | 未验证 | 当前部署未包含本地提交，且 E2E provider/model 变量未配置 |
| Firefox/WebKit 分层回归 | 未验证 | 本地缺少真实登录凭据 |
| PostgreSQL 并发幂等 | 未验证 | 无独立测试数据库 |

### 发布决策：不通过

## 2026-08-02 供应商任务可靠性门禁

本轮已完成本地代码与自动化回归，**不等同于线上发布验收**。

### 已完成

1. 图像 `n > 1` 改为每张图片一个独立、可恢复、可取消的持久化子任务。
2. 前端可按槽位接收完成结果，不再等待整批供应商任务全部结束。
3. 视频同步 URL 响应、异步远端 ID 持久化、终态原子结算与取消退款已纳入同一任务模型。
4. 全仓 Vitest 通过：1335 通过、4 个 PostgreSQL 环境用例明确跳过、0 失败。

### 仍阻断正式发布

1. 未在已部署环境用真实付费模型验证图像 `n=2/3/4`：必须证明每张先完成先上画布、每个任务只扣费一次。
2. 未在已部署环境验证取消其中一个图像子任务：必须证明只取消/退款该子任务，其他结果不受影响。
3. 未验证真实视频供应商的同步结果、异步轮询、刷新恢复和失败/取消账务流水。
4. 缺少隔离 `TEST_POSTGRES_URL`，4 个真实数据库并发/幂等测试尚未运行。
5. Firefox/WebKit 对新增核心流程尚未取得真实浏览器证据。

### 发布决策：不通过

## 2026-07-29 Pear 分层最终本地门禁

### 已完成

1. Pear `Image-Layered` 强制异步 URL 响应，兼容直接 PSD 与 ZIP 制品。
2. 真实 ZIP 在本地成功提取主 PSD并解析出 29 个可编辑图层。
3. 提交期租约、heartbeat、worker owner fence、取消清理和共享内存门已进入自动化回归。
4. smart fallback 的阶段切换、积分恢复和退款流水已合并为单条数据库事务。
5. 全仓 535/535 个测试文件通过；1105 项通过、0 失败、3 项跳过。
6. TypeScript、ESLint `--quiet`、Next.js 生产构建均退出 0。
7. 独立代码复审确认本次修改 P0=0、P1=0。

### 仍阻断

1. 新提交尚未部署到 Coze，未证明云端初始 POST 快速返回、异步阶段完整推进并打开 2+ 图层编辑器。
2. 缺少隔离 `TEST_POSTGRES_URL`，2 项 PostgreSQL 并发用例被明确跳过；一次扣费、一次退款和终态竞争尚缺真实数据库证据。
3. Firefox/WebKit 的真实登录、分层、保存和恢复链路尚未执行。
4. 生产构建仍有既有动态文件追踪和超大 `infinite-canvas.tsx` 告警，当前非编译阻断，但应另行治理。

### 发布决策：不通过

允许推送本地修复供云端部署和下一轮验收；在上述三项真实环境门禁解除前，不建议正式发布。

## 2026-07-29 Pear ZIP 适配后的发布门禁

本地代码门禁已通过：分层专项 34/34、全仓 1083 项已执行测试通过、TypeScript 0 error、ESLint 0 error（944 条存量 warning）、Next.js 生产构建退出 0。

已确认 Pear 实际产物为包含主 PSD 与 depth PSD 的 ZIP，且同步模式耗时 4m30s。当前修复改为异步任务并安全提取主 PSD，但尚未部署到云端，因此不能把 Pear 后台的“成功”视为无界编辑器链路成功。

### 发布决策：不通过

解除门禁必须同时满足：

1. 初始 `/api/layered-decompose` POST 快速返回无界 taskId。
2. 任务依次进入 `submitting-pear`、`waiting-for-pear`、`downloading-psd`。
3. ZIP 主 PSD 成功解析，编辑器显示至少 2 个可编辑图层。
4. 单个成功任务仅扣费一次；失败或取消仅退款一次。
5. PostgreSQL 并发门禁和 Firefox/WebKit 回归取得真实执行证据。

## 2026-07-29 活动图片目标修复后的门禁

- 已确认云端 403 的直接输入不是当前选中图片，而是遗留 `editImageId` 指向的过期 Hunyuan 3D 预览地址；Pear 在该次请求中没有被调用。
- 本地已改为当前单选优先，历史编辑目标仅作无单选时的兜底；新增回归测试并完成全仓测试、类型、Lint 和生产构建。
- 真实 Pear 成功、PSD 2+ 图层、一次扣费、失败或取消的一次退款、PostgreSQL 并发以及 Firefox/WebKit 仍未完成。

### 发布决策：不通过

允许部署此最小修复以解除下一轮云端验证阻塞，但在真实 Pear 与结算门禁完成前，不建议对外宣称分层功能可商用。

## 2026-07-29 f8f7cef 复测后的门禁

- 已确认动态 Coze 预览域名下，同源托管图片仍可能绕过服务端托管路径识别并收到 403。
- 已在浏览器提交源头限定改写当前同源托管媒体，未扩大服务端信任边界。
- 已按 Pear 2026-07-27 文档收紧 `/v1/images/edits` 请求体。
- 全仓 1077 项已执行测试、TypeScript、ESLint 和生产构建通过；3 项 PostgreSQL 测试明确跳过。

**发布决策仍为不通过。** 新提交必须部署后取得 Pear PSD、至少 2 个可编辑图层、准确扣费以及取消退款一致性证据；Firefox/WebKit 仍受 E2E Secrets 阻塞。

发布阻断原因：

1. 新分层版本尚未部署，云端只验证到旧 PSD 编辑器入口。
2. 真实 Pear `/v1/images/edits` -> task -> PSD -> 2+ 可编辑图层链路没有部署后证据。
3. PostgreSQL 多实例并发幂等、一次扣费和一次退款仍缺少真实数据库验证。
4. Firefox/WebKit 分层回归和凭据化 HTTP API 套件尚未在目标部署运行。

在这些项目完成前，不推送“可发布”结论，不把跳过测试或旧云端页面计为通过。

## 2026-07-29 当前发布门禁更新

### 已解除

1. 云端同源 `/api/serve-upload/...` 图片不再在 Pear 提交前报 403。
2. 供应商提交前失败的积分保持 `9,987,596`，本次未发生错误扣费。
3. 本地模型类型兼容修复及相关 13 项测试通过。
4. 全仓 Vitest 本轮 1068 项已执行测试全部通过，2 项真实 PostgreSQL 测试明确跳过。

### 仍阻断

1. `server-api-config` 的历史模型类型兼容修复尚未部署，真实 Pear task、PSD 下载与 2+ 可编辑图层仍未验证。
2. 无隔离 `TEST_POSTGRES_URL`，数据库唯一约束、一次扣费、一次退款与迟到完成拒绝尚未在真实 PostgreSQL 并发下证明。
3. Coze 预览域名对独立 Playwright warmup 返回 404，且本地没有 E2E 用户凭据，Firefox/WebKit 未进入真实登录与分层步骤。
4. 一次全仓审查曾出现无法稳定复现的 Sharp 相关 5 秒超时，需继续观察 CI 重复运行结果。

### 发布决策：不通过

当前可以推送本地最小修复供云端部署，但不能宣称 Pear 分层链路或跨浏览器门禁已经完成。

## 2026-07-29 09850e3 后续发布门禁

### 新确认的阻断

1. Coze 代理把外部域名保留在 `Origin`，导致当前部署把同源受控媒体当作远程图片回抓并收到 403。
2. 10:05 与 10:10 两个失败任务各扣 15 积分，任务虽进入 `failed`，但无退款流水，属于 P0 错误扣费。

### 本地修复状态

- 生产路由仅信任部署配置 `COZE_PROJECT_DOMAIN_DEFAULT`，不信任客户端 `Origin`、`Host` 或 `x-forwarded-host`；非生产仅额外允许本机回环地址。
- 失败结算先锁定候选任务和积分账户，再只更新一次 `cloud_tasks`；余额回补和退款流水仍处于同一 SQL 语句。
- TypeScript、变更文件 ESLint、路由与结算专项测试均通过。

### 发布前必须完成

1. GitHub PostgreSQL 16 并发 job 重新通过。
2. 云端部署新提交后，真实 Pear 成功返回 PSD 与至少 2 个可编辑图层。
3. 真实制造一个安全的失败场景，证明只扣一次且只退一次。
4. 核对并补偿已确认的历史错误扣费。
5. Firefox/WebKit Secrets 配置完成后执行真实跨浏览器回归。

### 发布决策：不通过
## 2026-07-29 Pear ZIP MIME 修复后的发布门禁

### 已解除

1. 云端 `/api/layered-decompose` 初始 POST 已真实验证快速返回 HTTP 202 与应用 taskId。
2. Pear 调用已真实进入异步 `waiting-for-pear` 阶段，浏览器不再因 4m30s 同步等待而 `Failed to fetch`。
3. 本地已补齐仅供显式允许调用方使用的 ZIP MIME 安全集合，HTML、脚本及其他非白名单类型仍被拒绝。
4. 分层专项、TypeScript、ESLint、全量 Vitest 和生产构建均通过。

### 仍阻断

1. ZIP MIME 修复尚未部署到 Coze，真实 ZIP 下载、主 PSD 提取和 2+ 可编辑图层尚未通过。
2. 本次失败任务的积分退款和 Pear 侧单次扣费需要在管理员流水中核对。
3. 缺少隔离 `TEST_POSTGRES_URL`，多实例幂等、终态竞争和一次性退款仍缺真实数据库证据。
4. Firefox/WebKit 核心流程仍未执行。

### 发布决策：不通过

允许推送此最小修复并部署复测；在真实编辑器图层、结算一致性、PostgreSQL 并发与跨浏览器门禁全部取得证据前，不标记为可发布。

## 2026-07-29 Pear 双栈 DNS 修复后的发布门禁

### 已解除

1. 已确认 Coze/沙箱 DNS 同时返回允许的透明出口 IPv4 与不可用保留 IPv6。
2. 安全下载器现只固定到明确允许的解析地址，不再因未使用的保留 IPv6 误拒绝整个域名。
3. 真实 Pear ZIP 已通过生产下载器，主 PSD 成功提取并通过 `8BPS` 校验。
4. 真实主 PSD 已由项目 `ag-psd` 解析为 `1280x1280`、5 个可编辑图层、0 警告。

### 仍阻断

1. 本次提交尚需推送、部署后在预览页证明编辑器真实显示并可操作 5 个图层。
2. 成功任务单次扣费以及失败/取消单次退款尚需数据库流水证据。
3. PostgreSQL 多实例并发与 Firefox/WebKit 回归仍未完成。

### 发布决策：不通过

允许部署本次最小修复执行预览页终态回归；不得把本地真实制品回放等同于云端编辑器通过。

## 2026-07-31 两份质量计划本地完成门禁

本轮对应：

1. `2026-07-30-image-toolbar-editing-quality.md`
2. `2026-07-30-dual-element-decomposition.md`

### 已通过

- 图片工具专项 24/24。
- 双输出元素拆解专项 84 项通过，2 项 PostgreSQL 用例明确跳过。
- 全仓 1220 项已执行测试通过，0 失败，4 项真实 PostgreSQL 环境测试跳过。
- TypeScript 退出 0。
- ESLint 0 errors / 945 warnings。
- Next.js 16.2.10 生产构建退出 0，111 个静态页面完成。
- `git diff --check` 退出 0。

### 仍阻断正式发布

1. 新实现尚需推送并由 Coze 拉取部署，未取得本次提交的真实云端 Chrome 证据。
2. 移除背景、擦除、蒙版、调色尚需下载真实 PNG 并进行 alpha 与像素检查。
3. 双输出元素拆解尚需证明 `board`、`layers`、`both`、部分完成、分支重试和项目恢复。
4. Pear 链路尚需证明 ZIP 下载、主 PSD 提取、2+ 可编辑图层、选择/隐藏/移动/导出。
5. 缺少隔离 PostgreSQL 测试库，一次扣费、一次退款、迟到完成拒绝和多实例幂等没有真实数据库证据。
6. Firefox/WebKit 尚未执行本次新增流程。

### 发布决策：不通过

允许推送已验证的本地源码供 Coze 部署验收；在云端产物、PostgreSQL 结算与跨浏览器门禁完成前，不标记为可商用发布。

## 2026-08-02 更新：多图画布归并

新增两个 P1：

1. BUG-025：真实 Pear `n=2` 结果在画布批次收尾时重复持久化，导致 2 张显示为 4 层并重叠。
2. BUG-026：选定 Pear 的 `gpt-image-2` 结果在轮询没有返回展示名时被 UI 误标为 FHL。

两项均已在本地通过定向回归、完整 Vitest（296 files / 1340 tests passed，4 个 PostgreSQL 用例按环境规则跳过）、TypeScript、Lint 和生产构建，但尚未部署复验。因此发布结论保持为 **不通过**。

## 2026-08-02 更新：真实子任务取消与供应商归属

GitHub `main` 已推送提交 `7a003b69f3291bff1991563b0843e4ee1c4e1aba`。该提交关闭两个已稳定复现的本地实现缺陷：

1. 多图进度卡片取消只删除 UI、不取消供应商任务。
2. 轮询终态中的旧供应商名称覆盖保存的实际 `providerId`。

本地质量门禁：定向 5 files / 22 tests、全仓 299 files / 1348 tests 均通过；3 files / 4 PostgreSQL 环境用例跳过；TypeScript 与生产构建通过；ESLint 为 0 error / 949 存量 warning。

### 仍阻断

1. 必须部署 `7a003b6` 后，在真实 Pear `n=2` 任务中取消一个槽位，确认请求命中 `/api/cancel-task`、仅一个槽位终态为 `cancelled`、幸存槽位正常完成、迟到结果不能回写。
2. 管理员账务流水需证明取消槽位只退款一次，幸存槽位只扣费一次。
3. 缺少隔离 `TEST_POSTGRES_URL`，多实例幂等与并发退款仍不能作为真实数据库通过项。
4. Firefox/WebKit 核心任务回归仍未执行。

### 发布决策：不通过

本轮可以部署进行真实验收，但在取消与结算证据补齐前，不得将平台标记为可发布。

## 2026-08-02 最新发布门禁：云端取消复验未通过

GitHub `main` 的 `98ba6c2` 已部署并执行真实 Chrome 复验，但 Pear `n=2` 场景取消一个槽位后，刷新同一项目仍恢复两张结果。该行为说明取消接口在数据库终态竞争失败时向 UI 报告了错误的成功状态。

本地已建立失败回归并完成最小修复：持久化任务必须先条件式进入 `cancelled`，只有转换成功后才允许内存取消和 UI 移除；如果 `completed` 已先取得终态，接口返回 `409` 并保留槽位。当前修复将随本次提交推送，随后仍需部署与真实验收。

仍阻断发布：

1. 本次修复已完成新的全量 Vitest、Lint 与生产构建；云端真实复验仍待部署后执行。
2. 云端复验必须核对取消槽位不回写、幸存槽位完成、供应商账务仅扣一次且取消槽位仅退一次。
3. `BUG-031` 的本地自动保存配额异常尚未修复。
4. 隔离 PostgreSQL 并发结算与 Firefox/WebKit 核心回归仍缺少真实证据。

### 发布决策：不通过

在新提交部署并取得上述 P1 真实证据前，不能将当前版本标记为可商用发布。

## 2026-08-02 发布门禁更新：底部图像生成器修复待部署验收

### 本地已满足

1. 底部图像生成器在 `n > 1` 时请求 durable 子任务槽位，而非等待一个旧批处理外层任务。
2. 每个可见处理框都绑定真实 `taskId`，因此统一取消入口可先调用后端取消，再决定是否移除 UI。
3. 显式选择的 provider/model 在服务端不可用时会得到明确错误，不会偷偷改用另一个提供商。
4. 质量门禁通过：定向 30 测试、全量 1354 测试、TypeScript、ESLint（0 error）和生产构建均已执行。

### 仍阻断发布

1. 本次修复尚未推送并重新部署，因此没有新版云端真实浏览器证据。
2. 必须验证 Pear `n=2` 立即出现两个处理框；取消一个后只取消一个，另一个可完成；刷新后取消结果不会回写。
3. 必须在管理员账务中核对完成槽位只扣一次、取消槽位只退款一次。
4. PostgreSQL 多实例并发/幂等/退款测试仍因缺少隔离 `TEST_POSTGRES_URL` 跳过。
5. Firefox 与 WebKit 的核心付费任务回归仍未执行。
6. BUG-031 的本地自动保存配额异常仍未修复。

### 发布决策：不通过

可以推送此最小修复供 Coze 部署验收；在上述真实验收与阻断项解除之前，不得将整体平台标注为可发布。

## 2026-08-02 发布门禁更新：BUG-034

云端 `canvas-direct n=2` 真实测试已证明两个耐久槽位与两个不同 Pear 输出能够创建和回填，但同时发现所有可见槽位完成后，生成器仍被锁定为“生成中…”。该 P1 已以先失败后通过的回归测试锁定，并完成最小的终态归一化修复。

**当前发布决策仍为：不通过。**

重新评估前必须完成：

1. 部署本次终态归一化提交。
2. Chrome 真实验证 `n=2` 完成后无需刷新即可再次提交。
3. 新建一轮 `n=2` 后立即取消其中一个槽位，并让另一个槽位完成。
4. 保存 `/api/cancel-task`、迟到结果拒绝与一次扣费/一次退款的账务证据。
5. 完成既有 PostgreSQL 并发及 Firefox/WebKit 验证。
## 2026-08-02 Release Gate Update

The local reliability patch is ready for deployment verification, not release approval.

- Local gate: `pnpm test` passed with 302 test files and 1359 tests; 4 PostgreSQL-dependent tests remain skipped without `TEST_POSTGRES_URL`.
- New P1 changes: provider identity is no longer derived from a display label; only restored placeholders use recovery polling; each direct-generation slot now has independent cancellation control.
- New P2 change: autosave snapshots are compacted and storage writes evict oldest snapshots before giving up.

**Decision: Not approved for release yet.** The deployed application must provide real browser and billing evidence for a Pear `n=2` run where one slot is cancelled and the other completes.

## 2026-08-03 Cloud Finding: provider attribution remains a P1 release blocker

The deployed `2270162` build created and completed two real Pear tasks with the correct request provider ID, but displayed the completed cards as FHL because the provider returned an empty `providerName`. This is recorded as BUG-037 and fixed locally with a non-empty-field guard.

The current release decision remains **Not approved**. The next deployed verification must prove all of the following in one run:

1. Pear `n=2` results remain labeled Pear when task completion metadata is empty.
2. One still-processing slot can be cancelled without affecting the other slot.
3. A cancelled slot cannot reappear after a refresh.
4. The billing ledger records exactly one charge for the successful slot and no duplicate charge or refund.

## 2026-08-03 Local Gate Update

The BUG-037 patch has passed the local regression, full Vitest suite, TypeScript check, ESLint error gate, and production build. This is not cloud acceptance evidence. The release decision remains **Not approved** until the deployed build proves provider attribution, per-slot cancellation, refresh recovery, and billing settlement with real provider tasks.
## 2026-08-03 Cloud Retest

BUG-037 is verified in the deployed direct-canvas generator: fresh Pear `n=2` output cards retained the Pear label.

The same live test reproduced a P1 cancellation failure. A first-slot cancellation click at `processing 0%` did not cancel either slot. The next deployment carries an observability-only repair that surfaces the server's exact rejection reason; it does not claim cancellation success. The release decision remains **Not approved**.

## 2026-08-03 Canvas Group Fix Gate

The reference/fusion-group repair has passed local regression, TypeScript, lint error gating, and production build. It is deployable for cloud acceptance, but it does not close the release gate by itself.

- Added P1 BUG-039 coverage for grouping gestures, group dragging, default generation, reference analysis, and concurrent-group metadata isolation.
- Local verification: `pnpm test` passed with 303 files / 1367 tests; `pnpm ts-check` and `pnpm build` passed; ESLint has 0 errors and 949 historical warnings.
- Required cloud acceptance: create both group types from real images, use a real vision-model recognition request, run reference and fusion generation with a configured provider, drag a group, save, and refresh.

**Release decision remains: Not approved.** Existing P1 cancellation and billing-ledger acceptance items, PostgreSQL concurrency evidence, cross-browser verification, and the new group workflow acceptance must be completed before an overall release approval.

## 2026-08-03 Group Control Regression Update

BUG-040 was reproduced in the deployed canvas: image-group, reference-group, and fusion-group controls were intercepted by the root canvas pointer-down handler before their click action could run. The local fix introduces explicit interaction boundaries for both group container types and is covered by a RED/GREEN regression test.

Local evidence: focused canvas and progressive-generation suite passed 24 assertions. The complete local gate also passed: TypeScript, ESLint error gate (`0` errors / `949` historical warnings), `303` test files / `1368` tests, and the production build. Three PostgreSQL-specific test files remain skipped because no isolated `TEST_POSTGRES_URL` is configured. This is not release acceptance evidence. The deployment must be checked against the pushed commit before using it for the paid `n > 1` acceptance flow.

**Release decision: Not approved.** P1 provider cancellation/refund evidence, PostgreSQL concurrency, cross-browser coverage, group-control cloud acceptance, and the next exact-build `n=2` progressive-return verification remain open.

## 2026-08-03 Group Fidelity Update

The deployed `072cd6f` build exposed two additional group issues: native setting menus ignored canvas zoom, and the six reference controls were not retained as independent generation constraints. The next local patch renders configuration menus inside the scaled canvas and preserves per-category strengths through the generation API. Fusion mode now requires every source image's style, composition, scene, color, subject, and detail at full strength.

Local quality gates passed, but the release decision remains **Not approved** until the exact deployed commit is visually verified and completes a real image-to-image `n=2` run.

## 2026-08-03 Image Generator Reference-Constraint Update

The image-generator panel deliberately remains different from canvas reference/fusion groups: each reference image may select up to two semantic categories and retains one image-wide strength. This update repairs the server-side interpretation without changing that approved UI.

- The server now binds descriptions, categories, and strengths to their exact numbered source image.
- Constraint language is chosen internally from the selected provider/model: Chinese-native models receive Chinese instructions, English-native models receive English instructions, and unknown providers receive a compact bilingual fallback.
- Durable asynchronous tasks retain `referenceCategoryStrengths`, preventing recovery from silently degrading a request.
- Local checks passed: focused generation suite 23 assertions; full suite 1,380 passing tests; TypeScript and production build passed; lint has 0 errors and 949 historical warnings.

**Release decision remains: Not approved.** The deployed build still needs paid real-provider acceptance for two-reference generation on enabled Chinese-native and English-native models, together with the existing cancellation, refund, PostgreSQL concurrency, and cross-browser blockers.

## 2026-08-03 Reference/Fusion Group Failure-Visibility Update

BUG-044 is fixed locally and covered by focused regression tests, but it is not cloud-accepted yet. This change intentionally does not treat a real provider rejection as an application success: it makes the rejection visible so the provider capability, request shape, or configuration can be diagnosed from evidence.

The overall release decision remains **Not approved** until the deployed reference-group workflow proves that a bound enabled provider can complete a real image-to-image request, or returns an actionable and correctly attributed failure without leaving the group stuck.

## 2026-08-03 Shared Reference-Image Transport Update

The cloud error `Missing required parameter: image` was traced to a shared application request-construction defect, not to `gpt-image-2-4k` or any individual model. The bottom image generator and canvas reference/fusion groups all converge on `/api/generate`; capability filtering previously captured a request body before reference images were attached.

The repair now attaches and normalizes `image` plus `image_urls` first, then filters and adapts the exact provider request. Local RED/GREEN regression, full Vitest (309 files / 1,386 tests), TypeScript, lint error gating, production build, and protected-file checks passed.

**Release decision remains: Not approved.** This fixes the common transport blocker locally, but paid cloud acceptance must prove successful submission from both the bottom generator and a canvas reference group. PostgreSQL concurrency, cancellation/refund, and cross-browser gates remain open.

## 2026-08-03 Routing Consistency Update

The Coze browser capture exposed a P1 Wujie routing error: the model selector visibly displayed one configured option while the submitted request paired the selected provider with an unconfigured stale model. This could surface as `fetch failed` and be mistaken for a provider outage.

The local repair is verified by new RED/GREEN regression contracts, the focused generation/recovery suite, TypeScript, lint error gating, full Vitest, and production build. It is **not cloud accepted yet**. Release remains **Not approved** until the exact deployed commit proves:

1. UI selection, persisted selection, and `/api/generate` provider/model fields always agree.
2. An invalid explicit pair is rejected before task creation and charging.
3. A valid configured provider task reaches a terminal state with retained provider evidence.
4. Browser/proxy interruption after submission is reconciled through the durable task rather than misreported as an immediate provider failure.

## 2026-08-04 Local Gate Update

Dedicated RemoveBG production wiring and Pear PSD/ZIP artifact handling have passed their focused suites and the complete local test/build gate. The complete Vitest run passed 320 files and 1,435 tests. Four PostgreSQL concurrency tests remain skipped because this workstation has no isolated PostgreSQL test URL. The Next.js production build completed successfully and generated 112 static pages.

**Release decision remains: Not approved.** Local evidence cannot close the following production boundaries:

1. A real dedicated RemoveBG provider must return a non-constant alpha result through each supported response format and preserve the selected provider/model metadata.
2. A real Pear `Image-Layered` request must return quickly with an application task ID, progress through asynchronous phases, download the ZIP, select the non-depth PSD, and open editable layers.
3. PostgreSQL must prove concurrent idempotency, conditional terminal transitions, one charge, and at-most-one refund under completion/cancel/failure races.
4. Login, model catalog, reference/fusion groups, `n > 1` progressive return, canvas, node mode, ChatCanvas, and both toolbars require an exact-build Chrome smoke regression after deployment.

No local test result is being used as a substitute for those deployed acceptance checks.

---

## 2026-08-05 Local Acceptance Status (`7d88625`)

All local gates pass: unit/API/regression suites, TypeScript, ESLint (0 errors), and production build. Deployed acceptance remains blocked: the exact-build cloud smoke needs a running Coze sandbox, and the credit-consuming P0 generation E2E needs explicit environment credentials plus paid-generation approval.

**Verdict: 有条件通过 (conditional)** - pending deployed acceptance checks for auth, model catalog, canvas/node/ChatCanvas, both toolbars, `n > 1` progressive generation, and PostgreSQL billing consistency.

## 2026-08-09 Stage 1 decision

**Decision: Not passed. Do not merge or release Stage 1 as complete.**

The release infrastructure can now collect non-mocked, exact-build evidence, but the evidence itself is incomplete. Local TypeScript, the Stage 1 contract, E2E discovery, and the 38-feature protection gate pass. Release remains blocked by inherited full lint/test failures, missing isolated PostgreSQL, missing paid three-browser provider evidence, and missing cancellation/refund/rollback proof.

The authoritative detail is `docs/testing/STAGE_1_COMPLETION_REPORT.md`. CI must not treat the external evidence job as optional for a Stage 1 release decision.

## 2026-08-09 Stage 1 PostgreSQL update

The local isolated-database blocker is now closed. A loopback-only PostgreSQL 18 instance exposed two real defects before passing the gate: the missing `wujie_audit_log` base table and an illegal NUL byte in the advisory-lock identity. Both were reproduced, covered by failing tests, fixed minimally, and reverified.

- Doctor: 22 passed / 12 warnings / 0 failed / 0 blocked for the supplied test database.
- PostgreSQL suites: 3 files / 9 tests passed, 0 skipped.
- Focused task and billing regression: 4 files / 77 tests passed.
- TypeScript passed; changed-file ESLint has 0 errors.

**Release decision remains Not passed.** Exact-deployment paid generation in Chromium, Firefox, and WebKit; deployed cancellation/timeout/late-result ledger evidence; rollback rehearsal; and inherited full-repository lint/test blockers remain open.

## 2026-08-10 P0 durable-generation update

BUG-050 is fixed locally: charged durable image slots now receive a server-owned kickoff through the existing lease-protected recovery route, without waiting for a browser poll. Focused concurrency/billing tests, TypeScript, ESLint error gating, the full Vitest suite, and the production build pass.

**Release decision remains Not passed.** The exact cloud commit must still prove that `n=1/2/3/4` starts without browser polling, returns each image progressively, records one charge per slot, creates no duplicate provider task under concurrent browser/server wakeup, and refunds each cancelled legacy zombie task at most once.

### 2026-08-10 cloud probe correction

The first deployed server-kickoff candidate (`9392b50`) did not pass its no-browser-poll probe. Its signed internal request reached `/api/poll-task`, but that route only recognized a browser session cookie and therefore looked for the paid task as `anonymous`. The probe task was cancelled and refunded once; the three historical zombie tasks were also cancelled and refunded exactly once each.

Unified request authentication is now covered locally by a RED/GREEN regression test, the focused suite passes 47 tests, the full Vitest suite exits 0 with the PostgreSQL environment skips declared, and the production build passes.

**Release decision remains Not passed.** The internal-auth follow-up is not yet deployed. Server-owned first submission, concurrent wakeup idempotency, progressive paid `n=1/2/3/4`, and exact deployed ledger evidence remain release blockers.

### 2026-08-10 recovery-backoff correction

The deployed internal-auth follow-up `8bf0e20` also failed its no-browser-poll acceptance. Task `async-1786322172707-0-uzo191` remained at 0% for more than 31 minutes with 120 credits pending because the server kickoff stopped after the recovery route returned a successful but non-terminal `recoveryPending` response during the normal fresh-task backoff window.

The kickoff now keeps driving the durable task through bounded recovery and processing responses until a terminal state. The exact failure sequence has RED/GREEN regression coverage, and all local TypeScript, lint error, Vitest, protected-feature, and production-build gates pass after the reviewed source file is added to the exact Stage 1 allowlist.

**Release decision remains Not passed.** This repair has not yet been deployed. The stale paid task requires one-time cancellation/refund evidence, and a fresh `n=1` no-browser-poll probe must reach a provider-backed terminal state before `n=2/3/4` testing resumes.

### 2026-08-10 Coze acceptance result

The server-owned kickoff and progressive slot behavior now pass in the Coze sandbox. The stale 120-credit probe was cancelled and refunded once. A new durable `n=1` completed without browser polling, and canvas-shaped `n=2/3/4` requests returned unique per-slot task IDs quickly. All ten canvas slots completed with images and independent 60-credit charges; `n=3` provided direct evidence that faster slots completed before the slowest sibling.

**Release decision remains Not passed.** BUG-051 is now closed in the updated Coze runtime: real task `direct-1786341342235-0-8pta21` completed with one image, deducted 60 credits, and persisted matching charged costs of 60 in both cloud-task fields. The exact runtime Git SHA was not exposed by Coze, canvas hydration/save-refresh/download still need a browser-visible run, and Firefox/WebKit paid evidence remains open.

## 2026-08-10 latest Stage 1 disposition

- Chromium, Firefox, and WebKit real paid `n=1/2/3/4` generation now have completed browser artifacts. Canvas result hydration and refresh persistence passed in all three engines.
- Real cancellation, repeated cancellation, late-result isolation, one-time refund, and balance restoration passed for task `async-1786343121430-0-6e583w`.
- That cancellation exposed BUG-052: correct money movement existed without durable task-to-ledger transaction IDs. The fix is locally green, including a real isolated PostgreSQL 18 test, but is not yet accepted on the deployed runtime.
- Current verdict remains **Not passed**. Remaining blockers are BUG-052 cloud acceptance, timeout-specific deployed proof, `core-v2 -> legacy` rollback rehearsal, and exact runtime SHA identity.

## 2026-08-10 BUG-052 and deployment-identity update

- BUG-052 is closed in the deployed Coze preview. Real task `async-1786354360647-0-rhvubs` persisted matching non-empty charge/refund transaction IDs, produced one charge and one refund, restored the original balance, and remained cancelled.
- Runtime identity is independently established: running Coze commit `d531ce65` directly parents GitHub `main@32139c5`; its only local delta is the environment-loading block in `scripts/coze-start.sh`.
- Current verdict remains **Not passed**. The remaining Stage 1 blockers are the timeout-specific deployed proof and the `core-v2 -> legacy` rollback rehearsal. No Stage 2 work may begin before those gates are resolved or explicitly recorded as blocked.

## 2026-08-10 BUG-054 absolute-timeout update

- A Coze-local delayed-provider probe validly reproduced the timeout defect: task `async-1786358975492-0-mq23bl` was still `processing/pending` after 666 seconds with 280 credits held.
- Manual cancellation refunded exactly once and restored the balance; this cleanup is not timeout acceptance.
- The local candidate now enforces one absolute 10-minute recovery deadline from the durable task `createdAt`, aborts execution, and uses the database conditional terminal/refund path.
- Local focused, full-test, TypeScript, ESLint, and production-build gates pass.
- Current verdict remains **Not passed**. BUG-054 requires exact-deployment cloud acceptance, followed by the `core-v2 -> legacy` rollback rehearsal. Stage 2 remains prohibited.

## 2026-08-10 BUG-054 cloud gate closure

- BUG-054 is closed by a real paid Coze run. Task `async-1786366442668-0-dzxu9y` automatically reached `timeout/refunded` 602.934 seconds after its durable creation time.
- Billing was exactly once: balance `378 -> 238 -> 378`, one -140 consume, one +140 refund, and both transaction IDs persisted on the task.
- At 1132.6 seconds, after the 900-second delayed response window and a sandbox restart, status, `updatedAt`, balance, and the two-row ledger remained unchanged.
- Temporary provider cleanup passed. Exact runtime SHA was not independently exposed in this run and remains a declared provenance limitation.
- Current verdict remains **Not passed**. The only remaining Stage 1 completion action is the documented `core-v2 -> legacy` rollback rehearsal. BUG-053 remains an open P2 terminal-label defect; Stage 2 remains prohibited.

## 2026-08-10 Stage 1 final gate

- The `core-v2 -> legacy` cloud rollback rehearsal passed on the current GitHub `main@104b140` business source. Coze `HEAD=413cb46d` differs only by the reviewed `.env` loading change in `scripts/coze-start.sh`.
- Before rollback, two paid Agent probes persisted `handlerVersion=task-core-v2`. After changing only `.env` and restarting, a new probe persisted `handlerVersion=legacy`.
- Existing core-v2 task IDs, terminal states, revisions, charge IDs, and refund IDs remained unchanged and readable after rollback. No data migration occurred.
- All three probes had exactly one 12-credit consume and one 12-credit refund; balance stayed at 378. No duplicate task, charge, or refund was observed.
- **Stage 1 verdict: PASS.** All Stage 1 P0/P1 task-and-billing gates are closed. BUG-053 remains an open P2 presentation defect and must stay registered.
- **Whole-program release verdict: CONDITIONAL / NOT YET FINAL.** Later WJ-STABLE stages have not been executed in this task. Stage 2 was not started and `stable@a53da24` was not touched.

Evidence: `docs/testing/evidence/stage-1-core-v2-legacy-rollback-2026-08-10.json`.

## 2026-08-11 Stage 2 Checkpoint B status

- Three of four required workspace-transfer paths pass in the Coze `shadow` runtime.
- Standalone chat to Canvas is blocked by BUG-055: a provider-relative result URL was stored as a ready AssetVersion and rendered as `MEDIA_LOAD_FAILED`.
- BUG-055 is fixed and fully gated locally, but cloud deployment and real Chrome revalidation are still pending. BUG-056 (reference-image data URL decoding) and BUG-057 (stale generating label) remain open.
- Six PostgreSQL integration suites remain unverified locally without `POSTGRES_TEST_DATABASE_URL`.
- **Current Stage 2 verdict: NOT PASSED.** Task 7 must not start until Checkpoint B is closed in cloud `shadow`. `asset-v3` remains prohibited and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only.

## 2026-08-11 Stage 2 Checkpoint B closure

- All four required transfer directions now pass in the Coze `shadow` runtime, including a fresh paid standalone-chat generation rendered in the selected Canvas.
- BUG-055 is closed with controlled media persistence and database-backed idempotency evidence.
- **Checkpoint B verdict: PASS.** Task 7 may begin. This does not mean Stage 2 or the whole program is release-ready.
- BUG-056 and BUG-057 remain open. Six local PostgreSQL integration suites remain unverified without `POSTGRES_TEST_DATABASE_URL`; `asset-v3` remains prohibited and stable remains read-only.

## 2026-08-11 Stage 2 Task 7 local decision

- Task 7 is locally complete at `12a9026eaf35e60410f775ae59f10c5d7eabe769`; independent review R6 is approved with zero findings and all available local gates pass.
- Completed tasks now project idempotently to immutable versions and placements without changing task/billing terminal authority. Projection failure is recoverable and does not turn a completed generation into a failed or recharged task.
- Workflow 3D internal authentication, ownership, provider/model binding, per-attempt idempotency, and long-submit timeout are covered by permanent regressions.
- **Stage 2 remains NOT PASSED.** Task 8, real isolated PostgreSQL concurrency, Checkpoint C cloud `shadow` validation, and final multi-workspace E2E/rollback are still incomplete. `asset-v3` must remain disabled and `stable` remains protected.

## 2026-08-12 Stage 2 Task 8 local decision

- Task 8 is locally implemented at `b969c87..90cad2e`; task review and final whole-branch re-review are approved with 0/0/0 findings, and all available local gates pass.
- Trash/restore is placement-aware, media recovery is exact-path and fail-closed, orphan scans default to deterministic dry-run, and physical purge remains disabled.
- The five PostgreSQL lifecycle tests now pass in an isolated local PostgreSQL 18 database. PostgreSQL-enabled full Vitest passes `2105` tests; four unrelated suites remain skipped under their separate `TEST_POSTGRES_URL` gate.
- Coze has not pulled this Task 8 branch and no cloud `shadow` lifecycle proof exists.
- **Stage 2 verdict remains NOT PASSED.** Checkpoint C is technically eligible for a `main`-only push but cloud `shadow` proof and Task 9 are still pending; `asset-v3` remains prohibited; GitHub `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only.

## 2026-08-12 Checkpoint C cloud decision

- Real Coze `shadow` testing found BUG-063: Canvas generation was not project-bound and shadow reconciliation duplicated placeholder/result identities. The local candidate repairs the request, identity, adoption, deletion, and lock boundaries with focused `48/48` regression and passing TypeScript.
- BUG-064 remains open: clicking media recovery can render a source image while durable availability remains `recovering`; no worker terminal transition is proven.
- **Checkpoint C verdict: NOT PASSED. Task 9 must not start.** Deploy the exact BUG-063 candidate in `shadow` and rerun lifecycle evidence; keep `asset-v3` and physical purge disabled. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only.
- Final candidate local gates passed: affected regression `51/51`, full Vitest `2083 passed / 35 environment-skipped / 0 failed`, TypeScript, ESLint (`0 errors / 957 historical warnings`), production build (`116/116` pages), and protected baseline (`38/38`, no unapproved source drift). This does not override the open BUG-064 or the missing current-candidate PostgreSQL concurrency evidence.

## 2026-08-12 Checkpoint C repaired candidate decision

- BUG-064 is closed locally: recovery now has an authorized durable worker, PostgreSQL lease/fencing, exact validated S3 or durable-local delivery, database-authoritative polling, and explicit retryable versus unrecoverable terminals.
- Current-candidate PostgreSQL evidence is complete. The final repository run passed `402/402` files and `2160/2160` tests with zero failures and zero skips, including all Stage 2 lifecycle/projection and billing concurrency tests.
- TypeScript, production build (`116/116`), ESLint (`0 errors / 957 historical warnings`), protected baseline (`38/38`), and `git diff --check` pass. Independent final review is `APPROVED` with no P0/P1/P2 findings.
- **Checkpoint C verdict remains NOT PASSED pending cloud evidence.** Coze currently runs base `4bbe6db`; after a `main`-only push, deploy the exact candidate in `shadow` and prove generation projection, delete/reload, and media recovery. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`, `asset-v3`, and physical purge remain untouched/disabled.
## 2026-08-12 Stage 2 Checkpoint C final decision

- GitHub candidate: `main@1344dec33f93fc9d8a19baeaf9ed251c28176f5f`.
- Coze runtime: `6965f28ceb57650af0f87f10d6509603949f0eff`, direct parent `1344dec`, with only the approved deployment adapter difference.
- Cloud lifecycle evidence: missing media recovered to ready, survived reload, one succeeded attempt, one physical artifact, one active placement, zero GC candidates.
- Safety controls: `shadow`, task core `legacy`, durable `/space/wujie-data`, physical purge disabled, `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` untouched.
- **Checkpoint C verdict: PASS.** Stage 2 itself is not yet complete; Task 9 multi-browser/cross-workspace E2E, doctor gates, controlled `asset-v3` test switch and proven legacy rollback remain required.

## 2026-08-13 Stage 2 Task 9 local decision

- Local browser acceptance is complete for five profiles: `50/50` Stage 2 lifecycle and cross-workspace tests passed against a production server with isolated PostgreSQL and per-browser controlled fixtures.
- Full Vitest passed `410` files / `2258` tests. Four non-Stage-2 tests remain visibly skipped behind the separate `TEST_POSTGRES_URL` variable; they are not counted as passes.
- ESLint has `0 errors / 959 historical warnings`; TypeScript, Doctor, production build, and whitespace checks pass.
- BUG-065, BUG-066, and BUG-067 are closed locally with permanent regression coverage. Their exact candidate still requires Coze `shadow` verification.
- **Current verdict: CONDITIONALLY PASS FOR A MAIN-ONLY CANDIDATE PUSH; STAGE 2 NOT COMPLETE.** The final blockers are exact-SHA Coze shadow comparison, a controlled test-only `asset-v3` run, and a proven rollback to `legacy`. Physical purge remains disabled and `stable` remains read-only.

## 2026-08-13 Stage 2 Task 9 final candidate decision

- BUG-068 through BUG-070 are closed locally with permanent unit, API, PostgreSQL, and browser regression coverage. Independent final review is `APPROVED` with no remaining review finding.
- Fresh production-browser evidence is `50/50` across Chromium, 1920x1080 Chromium, Firefox, WebKit, and mobile Chromium. Every browser used a separate controlled user/project fixture set; failed environment-misconfiguration and shared-fixture attempts are excluded from pass counts and remain visible in evidence.
- Final local gates pass: full PostgreSQL-enabled test command, API suite, regression suite, TypeScript, Doctor, production build, protected baseline `38/38`, and whitespace checks. ESLint reports `0 errors / 959 historical warnings`.
- Coze currently reports `4bbe6db`, which predates this final candidate. Therefore no cloud result can yet validate BUG-065 through BUG-070.
- **Verdict: CONDITIONALLY PASS FOR MAIN-ONLY PUSH; STAGE 2 NOT COMPLETE.** Required remaining order is exact-SHA Coze `shadow` comparison, controlled test-only `asset-v3`, then verified rollback to `legacy`. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only and physical purge remains disabled.

Post-decision update: the implementation candidate was fast-forward pushed to `main@644a0809658d500d9e3815c14771dd10581f0998`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged. Release status is still conditional because Coze has not yet pulled and validated this candidate in `shadow`.

## 2026-08-13 BUG-071 release decision

The controlled cloud `asset-v3` run exposed a P1 delete/undo persistence defect, so Stage 2 was correctly kept open and Coze was returned to `legacy`. The local candidate now synchronizes placement lifecycle and the authoritative project snapshot, compensates partial failure, and passes the five-profile production-browser reload matrix. The current verdict remains **CONDITIONAL**: push to `main` only, have Coze pull the exact new SHA, verify the same controlled `asset-v3` sequence, then prove rollback to `legacy`. `stable` remains read-only and physical purge remains disabled.

## 2026-08-13 Stage 2 final release decision

Coze validated GitHub source `main@81fe303e73ba2f50d2ca0a6ed7201c5977758231` in authenticated Chrome. BUG-071's delete/undo/redo/undo/reload sequence passed in controlled `asset-v3`; PostgreSQL preserved one authoritative Canvas placement plus the intended chat and workflow references on the same ready version. Exact-candidate `shadow` comparison reported no owner/project drift, no non-ready active reference, and no GC candidate. Both controlled modes were rolled back successfully.

**Stage 2 verdict: PASS / COMPLETE.** The deployed test environment finishes in `WUJIE_ASSET_GRAPH_MODE=legacy`, `WUJIE_TASK_CORE_MODE=legacy`, with physical purge disabled. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains untouched. The whole-program verdict remains **CONDITIONAL / NOT FINAL** because Stages 3 and later, along with the separately registered business-module and payment gates, are outside this Stage 2 closure.

## 2026-08-13 Stage 3 Task 4 readiness decision

- Selection and image-drag behavior is locally closed for the Task 4 scope: focused `34/34` and production Chromium `3/3` pass, including real Ctrl add/remove multi-selection, reverse box selection, group/image cancel rollback and reload-persistent drag coordinates. Independent re-review is `APPROVED`.
- The fresh repository rerun passes `411` executed files / `2291` executed tests; `12` PostgreSQL-gated files / `44` tests remain explicitly skipped. ESLint is `0 errors / 966 historical warnings`, TypeScript passes, and the production build generates `116/116` routes.
- The clean-fixture full Stage 3 Chromium scenario is `5/6`. The open P1 is the 300-node input-delay gate (`50.2ms`, required `<=50ms`; preceding runs `56.8ms` and `62.8ms`). No disappeared or unclickable frame was recorded.
- TypeScript, full Vitest (`411` files / `2288` passed / `44` skipped), the `116/116` production build and whitespace checks pass. ESLint is `0 errors / 966 historical warnings`. The `12` PostgreSQL-gated files and four non-default browser profiles remain unverified in this task.
- All `38/38` protected features remain present, but the release gate correctly blocks production-source drift until the later Stage 3 protected-baseline task updates the approved allowlist/metadata.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `5/11` tasks, approximately `45%`. Task 5 command/history transactions has not started. No Task 4 change is authorized for `stable`, and no cloud deployment claim is made.

## 2026-08-13 Stage 3 Task 5 readiness decision

- Task 5 code and focused browser scope pass locally. Final review found no P0/P1, focused tests are `56/56`, production Chromium Task 5 E2E is `3/3`, and PostgreSQL-enabled full Vitest is `2374/2374` with no skips.
- The final-build full Chromium Stage 3 scenario is still `7/8`. S3-BUG-004 remains open P1 because 300-node input P95 is `52.3ms` against the non-negotiable `<=50ms` gate after an earlier `72.5ms` run, despite zero disappeared frames and zero unclickable time.
- All `38/38` protected feature identities remain present. The gate still blocks `24` expected Stage 3 source drifts until the plan-authorized baseline update; this is not a release pass.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `6/11`, approximately `55%`. Task 6 has not started. Nothing is pushed or deployed, `stable` remains untouched, and no cloud claim is made.

## 2026-08-13 Stage 3 Task 6 readiness decision

- Task projection is locally closed: focused `48/48` and the production Chromium progressive-slot scenario `1/1` pass, including out-of-order `n=4` completion, stable slot identity/order, project sync and reload persistence.
- Fresh full Vitest has zero failures (`2351` passed, `44` environment-skipped). TypeScript, ESLint and whitespace checks pass. Production build generates `116/116` routes.
- Release gates remain open: after a clean 15-project reseed, the full Stage 3 Chromium run is `7/8` because 300-node input P95 is `87.8ms` versus `<=50ms`; four external browser profiles and cloud exact-SHA/rollback are unverified.
- All `38/38` protected feature identities and required evidence contracts remain present. The protected baseline still blocks `27` accumulated Stage 3 source drifts until its ordered approval task.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `7/11`, approximately `64%`. Task 7 persistence scheduling has not started. Nothing is pushed or deployed, and `stable` remains untouched.

## 2026-08-13 Stage 3 Task 7 readiness decision

- Non-blocking project persistence is locally closed for Task 7: focused regression `35/35`, PostgreSQL-enabled full Vitest exit `0`, TypeScript, ESLint and the `116/116` production build pass.
- Production Chromium save/refresh is `2/2`. The 300-node save sample meets the fixed save budget with `0ms` longest save task and preserves coordinates, size, z-order and processing state after refresh; no disappeared or unclickable frame was recorded.
- This save-specific sample does not close S3-BUG-004's full 300-node pan/input P95 gate. External browsers, cloud exact-SHA and rollback remain unverified.
- All `38/38` protected identities, paths and evidence contracts remain, while the gate correctly blocks `29` accumulated Stage 3 source drifts until its ordered approval task.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `8/11`, approximately `73%`. Task 8 is next and has not started. Nothing is pushed or deployed, and `stable` remains untouched.

## 2026-08-13 Stage 3 Task 8 readiness decision

- Tool registration and session exclusivity are locally closed for the Task 8 scope: focused `32/32` and production-browser `5/5` pass across the configured desktop/mobile profiles.
- Full local gates pass with real PostgreSQL enabled: full Vitest exit `0`, API `477/477` plus PostgreSQL concurrency `3/3`, component/lib `1759/1759`, TypeScript, Doctor `43/11/0/0`, and production build `116/116`. ESLint is `0 errors / 966 historical warnings`.
- Protected feature identity remains `38/38`. The default baseline gate correctly blocks `32` accumulated Stage 3 source drifts; an explicit reviewed 32-path scope gate passes. This is not a production-baseline approval.
- The five-profile evidence proves only the Task 8 mutual-exclusion flow. It does not replace the full Task 0-7 cross-browser matrix, S3-BUG-004's 300-node input gate, cloud exact-SHA verification or `canvas-v2 -> legacy` rollback.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `9/11`, approximately `82%`. Task 9 is next and has not started. Nothing is pushed or deployed, and `stable` remains untouched.

## 2026-08-14 Stage 3 Task 9 readiness decision

- Component boundaries are locally closed for Task 9: workspace owns task polling, `CanvasSurface` remains render/controller-only, `CanvasToolHost` remains session/panel-only, and protected tool panels remain reachable through the compatibility facade.
- Focused regression is `58/58`; fresh full Vitest is `422` passed files / `2376` passed tests with environment-gated tests separately verified against PostgreSQL (`46/46` plus `4/4`). TypeScript, production build and whitespace checks pass; ESLint is `0 errors / 965 historical warnings`.
- Task 9 does not supply the complete Stage 3 browser/performance/release evidence. S3-BUG-004's fixed 300-node input P95 gate, full five-browser matrix, exact-SHA Coze verification and `canvas-v2 -> legacy` rollback remain open.
- Protected features remain governed by the unchanged baseline. The accumulated Stage 3 source drift must continue to block the default release gate until the ordered Task 10 approval step; this Task does not silently rewrite that baseline.
- **Release verdict remains NOT READY / Stage 3 in progress.** Progress is `10/11`, approximately `91%`. Task 10 is next and has not started. Nothing is pushed or deployed, and `stable` remains untouched.

## 2026-08-14 Stage 3 Task 10 local readiness decision

- The complete local legacy browser matrix is `60/60`; representative shadow and canvas-v2 matrices are `15/15` each. Desktop Chromium meets the unchanged 100/300-node FPS and P95 thresholds with zero disappearing frames and zero unclickable time.
- S3-BUG-004, S3-BUG-011, S3-BUG-012, S3-BUG-013 and S3-TEST-001 are closed locally with retained RED/GREEN evidence and permanent contracts. All `38/38` protected capabilities remain present.
- Local static, test, PostgreSQL, API, regression and build gates exit 0. ESLint retains `965` historical warnings and adds no error; the build emits `116/116` routes.
- The isolated database has no real API provider configuration. Consequently, paid image generation, task billing, cancellation/refund consistency and provider-returned media are not locally verified. This is an explicit external evidence gap, not a mock pass.
- **Release verdict: CONDITIONAL / NOT READY FOR STAGE 3 COMPLETION.** The candidate still requires main-only publication, GitHub Actions execution, Coze exact-SHA shadow evidence, isolated canvas-v2 verification and mandatory rollback to legacy. `stable` remains read-only and unchanged.

## 2026-08-14 Stage 3 Task 10 post-review readiness decision

- Independent review found no remaining P0 after owner/revision-bound recovery was added. All review P1 findings are now closed locally: resize immediate save, blob geometry recovery, WebKit model-request churn, local-storage/beacon channel isolation, and double-failure leave confirmation.
- Fresh production-browser evidence after these repairs includes five profiles `5/5` for move, resize, one-step undo/redo and immediate reload; WebKit merge-window `1/1`; Chromium final immediate-reload `1/1`. Evidence gates found no unexpected Console or network errors in the passing attempts.
- Focused hardening regression passes `88/88`. The post-review whole-repository rerun now passes with PostgreSQL enabled; API is `480/480`, component/lib regression exits `0`, TypeScript passes, ESLint is `0 errors / 965 historical warnings`, Doctor is `43/11/0/0`, and the production build generates `116/116` pages.
- Two non-P0/P1 limitations remain explicit: small beacon audit records lack an application-level receipt, and external administrator authorization changes require a refresh signal or page reload. Backend authorization remains authoritative.
- The first governance bootstrap push must exclude `.github/workflows/quality.yml`; only files authorized by the old trusted baseline may enter the bootstrap commit. The complete candidate may be pushed only after the new allowlist exists in the trusted parent commit.
- The first whole-repository rerun exposed S3-TEST-002, a stale source contract for explicit-project workflow hydration. The runtime behavior was intact; the contract now protects the recovery-aware ordering and passes `11/11`, followed by a clean full rerun.
- **Release verdict remains CONDITIONAL / NOT READY FOR STAGE 3 COMPLETION.** Local P0/P1 count is zero, but committed-source browser evidence, main publication, GitHub Actions, Coze exact-SHA provider/billing evidence, isolated canvas-v2 and mandatory legacy rollback remain open. Remote `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` is unchanged and must remain untouched.

## 2026-08-14 Stage 3 main and immutable browser evidence

- Governance bootstrap `d9fde3a` and the complete candidate were pushed as non-force fast-forwards. The verified code/test candidate is `main@afa65eb103bd8fa08d669d4680d068d2c565d341`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` is unchanged.
- S3-TEST-003 was found after publication: the evidence fixture waited for video before context closure and deadlocked teardown. Contract RED was `1/10`; GREEN is `10/10`, and the focused regression is `100/100`.
- A production build from the exact commit passes Chromium/WebKit merge-window deletion and move/resize/undo/redo/immediate reload `4/4`. Every test has screenshot, video, trace, Console and Network evidence; Console errors/page errors and non-benign network failures are zero.
- **Release verdict remains CONDITIONAL / STAGE 3 NOT COMPLETE.** Local and main evidence is closed; GitHub Actions, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, real provider generation and real charge/refund evidence remain required.

## 2026-08-14 Stage 3 CI repair readiness decision

- The current GitHub candidate is not yet releasable: the prior run proved PostgreSQL concurrency but exposed clean-schema seed order and production dependency-audit blockers. The real-P0 browser workflow also lacks its required repository secrets.
- The local repair candidate closes the first two blockers without changing Canvas, provider or billing behavior. A clean isolated PostgreSQL bootstrap plus Chromium `2/2` passes, and the production audit changes from `6 moderate / 15 high` to zero vulnerabilities.
- Fresh static/API/full-test/build evidence exits 0. The Sharp changes are type-only compatibility imports required by the patched dependency and are covered by layer/upscale regression.
- **Release verdict remains CONDITIONAL / STAGE 3 NOT COMPLETE.** Publication requires the trusted-parent governance sequence and a green immutable CI rerun. Paid P0 must remain blocked until real secrets are configured; Coze `shadow -> canvas-v2 -> legacy` and real charge/refund evidence are still mandatory.

### Immutable CI follow-up

- `0ac9068` proves the dependency, static, API, full-test, production-build and PostgreSQL-concurrency gates on GitHub. The overall workflow remains red for evidence-infrastructure reasons, not a passing release.
- The next repair waits for additive core columns and supplies a production-valid CI auth secret. Both have retained RED/GREEN and do not change Canvas, provider, billing or application auth policy.
- **Verdict remains CONDITIONAL / STAGE 3 NOT COMPLETE.** A new immutable CI run must execute all three Canvas matrices; the separately missing real-P0 Secrets and all Coze gates remain blocking.

### `c381d50` immutable matrix decision

- All three mode jobs now reach Canvas assertions, closing the schema/auth infrastructure blockers. Static, API, audit, build, PostgreSQL and Stage 0/1 jobs pass.
- The Canvas matrix is red: `160/180` passed. Open blockers are hosted Chromium performance, an unobserved periodic-sync boundary in the merge-window test, and one shadow WebKit immediate-reload geometry rollback.
- The 55/45 FPS and 100ms save thresholds are not weakened. Coze deployment is deferred until these failures are classified and repaired with retained RED/GREEN evidence.
- **Release verdict: NOT READY.** Real-P0 Secrets, real provider/billing evidence, Coze `shadow -> canvas-v2 -> legacy`, and the open matrix failures remain blocking.

### Post-`c381d50` local classification

- Merge-window synchronization now has an explicit request boundary and passes all five local browser profiles. This closes the local evidence defect without modifying Canvas merge behavior.
- Hosted performance thresholds remain exactly 55/45 FPS and 100ms. The candidate removes full-DOM rescans from the measurement observer; six local desktop Chromium performance cases pass, but immutable hosted evidence is still mandatory.
- Shadow WebKit immediate reload passes the exact scenario six consecutive local runs. Because the immutable run failed once, this remains a rerun-required item rather than a claimed closure.
- **Readiness remains NOT READY.** A new immutable matrix must confirm these classifications; real-P0 configuration and Coze `shadow -> canvas-v2 -> legacy` remain blocking.

## 2026-08-14 Stage 3 latest local candidate readiness

- Candidate base is `main@820b33d669e529e90f61837314b164b3a2119675` on `codex/wj-stable-s3`; `origin/main` matched that base before this uncommitted candidate. `stable` was not checked out or modified.
- Local production `canvas-v2` five-profile matrix passes `60/60` after a clean 15-project reseed. The Firefox/mobile batch-delete undo followed by 100-node continuity passes `4/4` in focused order.
- Production build passes `116/116`; TypeScript, ESLint, full Vitest and three PostgreSQL concurrency files (`4/4`) exit `0`.
- S3-BUG-019, S3-BUG-020 and S3-TEST-007 are locally closed with retained RED/GREEN evidence. The post-review execution `final-local-matrix-p1-barrier-20260814` passes `60/60`. S3-BUG-017 and S3-BUG-018 still require a new immutable hosted run.
- GitHub Actions run `31797149839`, attempt 2 remains RED. The real-P0 job is blocked by missing required Secrets; no mock or skip is accepted as closure.
- **Conclusion: CONDITIONAL / NOT READY.** Do not enter Stage 4/5. Commit/push only the reviewed `main` candidate, then require immutable CI and Coze exact-SHA `shadow -> canvas-v2 -> legacy`, including real provider and billing/refund evidence.

## 2026-08-15 Stage 3 CI RED closure readiness

- S3-BUG-021 and S3-TEST-008 are closed locally with permanent regression coverage. Project sync is serialized, legacy writes use database revision CAS, autosave performs one bounded conflict rebase/retry, and evidence no longer treats an unrelated later request as recovery.
- The rebuilt production `canvas-v2` five-profile matrix `local-final-candidate-r5-20260815` is RED `58/60`, not `60/60`. One Chromium delete/undo failed and one later case cascaded. The other four profiles passed `48/48`; the failure remains retained with Trace, video, Console and network evidence.
- Historical checkpoint: moving the listener to commit-phase `useLayoutEffect` narrowed the input gap and passed its source contract, but exact legacy reproduction on `74268eb` later disproved it as a complete fix. The latest readiness section records the component-lifetime stable-listener candidate and its fresh RED/GREEN evidence.
- The retained `r3` mobile RED was classified from pointer evidence as a covered geometric test point, not waived as flakiness. The unobstructed-point regression passes three consecutive mobile executions before the full `r4` matrix; no business threshold was relaxed.
- This result is local candidate evidence based on `main@f6f40ccbd23e8ee4855717a24e3dca4885475f51` plus the documented worktree patch. It is not yet an immutable GitHub commit or Coze deployment result.
- **Release decision: NOT READY / Stage 3 remains in Task 10.** Required next gates are a main-only fast-forward, immutable GitHub Actions three-mode matrix, Coze exact-SHA `shadow -> canvas-v2 -> legacy` rollout/rollback, and real provider billing/cancel/refund proof. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only.

## 2026-08-15 `a372e9e` immutable run decision

- GitHub Actions run `31866500220`, attempt 2, proves schema setup, authentication and all `180` Canvas cases executed. Static/tests and PostgreSQL concurrency passed. The real-P0 job correctly failed closed because required repository Secrets are absent.
- The three Canvas jobs remain RED solely on `13` desktop-Chromium performance assertions: shadow `55/60`, canvas-v2 `57/60`, legacy `55/60`. No disappeared frame or unclickable-duration regression was reported, but FPS, input P95 and longest-save-task budgets are release gates and cannot be waived.
- S3-BUG-018 no longer blocks after the immutable rerun passed the immediate-reload flow and isolated local shadow Chromium 1080p passed `10/10`. S3-BUG-017 remains OPEN P1 because two hosted attempts missed unchanged commercial thresholds even though exact-source local repeated samples pass.
- S3-TEST-009 and S3-TEST-010 are locally closed with narrow regression tests; neither changes Canvas business behavior or performance thresholds. A new immutable run is required for the evidence-filter commit.
- **Release decision remains NOT READY.** Stage 3 Task 10 stays active; Stage 4/5 remain prohibited. Required closure is hosted performance isolation/fix, new immutable Actions, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, and real provider charge/cancel/refund evidence. `stable` remains untouched.

## 2026-08-15 corrected performance-window decision

- S3-TEST-011 is locally closed: FPS now uses the same first-to-last RAF observation window as its frame count instead of the broader Playwright action duration. Fixed commercial thresholds were not changed.
- Fresh production shadow evidence passes the complete five-profile Canvas matrix `60/60`; both desktop Chromium profiles meet 100/300-node FPS, input P95 and 300-node save budgets with zero disappeared frames and zero unclickable duration.
- This is still an uncommitted local candidate. It does not retroactively turn runs `31866500220` or `31869145512` green and does not satisfy the missing real-P0 credentials, Coze exact-SHA rollout/rollback or real billing/cancel/refund evidence.
- **Release decision: NOT READY.** Next ordered gate is full repository verification, main-only non-force push, then a new immutable three-mode Actions run. `stable` and Stage 4/5 remain prohibited.

## 2026-08-15 post-`c4c02a9` repair readiness

- `c4c02a9` is not a passing immutable candidate. Actions run `31870799781` preserved three-mode RED evidence and exposed one legacy WebKit durability race plus hosted performance margin failures.
- S3-BUG-023 and the S3-BUG-017 hot-path follow-up are locally repaired under TDD. No business feature, Canvas threshold, shadow comparison or continuity assertion was removed.
- Available local gates pass: focused `47/47`, full Vitest `2454` passed, TypeScript, ESLint, production build `116/116`, exact source allowlist and `38/38` protected features. PostgreSQL-gated local tests remain explicitly unverified in this generic environment.
- **Release decision remains NOT READY.** The next commit must be pushed only to `main` and must pass the immutable legacy/shadow/canvas-v2 matrix. Real-P0 Secrets, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, provider generation and authoritative charge/cancel/refund evidence remain blocking. `stable` and Stage 4/5 remain prohibited.

## 2026-08-15 readiness after immutable run `31873152403`

- `main@30fdedc793cf66d45863b01725186f85d681fd0a` is not releasable: canvas-v2 and shadow each passed `54/60`; legacy passed `56/60`.
- The run confirmed three independent blockers rather than one generic flake: hosted desktop performance margin, synchronous immediate-save cost, and a WebKit one-revision unload recovery race.
- The second repair candidate has permanent RED/GREEN coverage and passes local lint, TypeScript, `2458` Vitest tests and the `116/116` route production build. No threshold, continuity assertion or protected product feature was removed.
- PostgreSQL browser concurrency is not available on this workstation and remains an explicit external gate. The real-P0 job still fails closed because required repository Secrets are absent.
- **Decision: NOT READY / remain in Stage 3 Task 10.** Publish only to `main`, keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged, and require a new immutable three-mode matrix before any Coze rollout or Stage 4/5 work.

## 2026-08-15 readiness after immutable run `31875413077`

- `main@74268ebaa14c6843cfdd91e08e32e478ad5347a8` is not releasable: canvas-v2 and shadow each passed `56/60`; legacy passed `53/60`.
- Exact local legacy reproduction separated S3-BUG-022 from hosted performance noise. A dependency-driven DOM keyboard listener was replaced during delete/restore commits and could drop rapid Ctrl+Z input.
- The final candidate keeps one stable DOM proxy listener and updates its current behavior through a ref. Fresh legacy Chromium passes `12/12`, mobile focused regression passes `4/4`, and the unchanged local performance budgets pass.
- Repository gates pass locally, but `44` PostgreSQL tests remain environment-skipped in the generic run. Real-P0 still lacks required Secrets, and no cloud charge/refund proof has been produced.
- **Decision: NOT READY / Stage 3 Task 10 remains active.** Push only a reviewed fast-forward to `main`; do not modify `stable`, do not start Stage 4/5, and require a new immutable three-mode matrix before Coze rollout.
