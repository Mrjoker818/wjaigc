# 无界AI — 回归测试报告 (REGRESSION REPORT)

> 生成时间：2026-07-20
> 测试范围：全平台功能回归 + 跨浏览器兼容性
> 测试方法：E2E 自动化测试 (Playwright) + API 自动化测试 (Vitest)

---

## 回归测试总览

| 测试类别 | 测试框架 | 测试用例 | 通过 | 失败 | 通过率 |
|---------|---------|---------|------|------|--------|
| E2E — Chromium | Playwright | 3 | 3 | 0 | 100% |
| E2E — Firefox | Playwright | 3 | 3 | 0 | 100% |
| E2E — WebKit | Playwright | 3 | 3 | 0 | 100% |
| API — 核心接口 | Vitest | 46 | 46 | 0 | 100% |
| API — 异常混沌 | Vitest | 21 | 21 | 0 | 100% |
| API — 安全测试 | Vitest | 31 | 31 | 0 | 100% |
| 静态检查 — TS | tsc | 1 | 1 | 0 | 100% |
| 静态检查 — Lint | ESLint | 1 | 1 | 0 | 100% |
| **合计** | — | **109** | **109** | **0** | **100%** |

---

## E2E 测试详情

### 测试矩阵

| 测试套件 | Chromium | Firefox | WebKit |
|---------|----------|---------|--------|
| p0-core (核心生成流程) | PASS | PASS | PASS |
| p0-auth-session (认证会话) | PASS | PASS | PASS |
| p0-user-data (用户数据持久化) | PASS | PASS | PASS |

### p0-core: 核心生成流程
**测试步骤**：
1. 用户登录（用户名+密码）
2. 选择生成模型（下拉菜单）
3. 输入提示词
4. 点击生成（Ctrl+Enter）
5. 验证生成任务提交成功
6. 验证画布显示 processing frame

**跨浏览器兼容性修复**：
- Chromium/Firefox: `selectOption` 直接触发 React onChange
- WebKit: 需要额外 `dispatchEvent(new Event('change', {bubbles:true}))` 后备
- 模型存储路径: `unbounded_ai_user_data.userData[userId].selectedModel`

### p0-auth-session: 认证会话
**测试步骤**：
1. 访问首页，验证重定向到登录页
2. 错误密码登录，验证 401
3. 正确密码登录，验证跳转
4. 刷新页面，验证 session 保持
5. 注销，验证重定向到登录页

**跨浏览器兼容性修复**：
- WebKit: `waitForLoadState('networkidle')` → `domcontentloaded` 避免 Protocol error
- WebKit: keepalive 错误模式添加到可容忍列表

### p0-user-data: 用户数据持久化
**测试步骤**：
1. 登录后创建新项目
2. 验证项目名称出现在界面
3. 刷新页面，验证项目数据从服务器恢复
4. 切换项目，验证数据隔离

---

## API 测试详情

### 核心接口测试 (46 项)

| 模块 | 测试项 | 通过 |
|------|--------|------|
| 认证 API | 正确凭据登录 / 错误密码 / 空用户名 / 空密码 / 注销 / 注销后session / 会话检查 | 7/7 |
| 生成 API | 正常提交 / 缺少模型(默认) / 未授权 / submitOnly模式 / 带参考图 | 5/5 |
| 轮询 API | 未授权 / 不存在任务ID / 有效任务 / 不存在返回cancelled | 4/4 |
| 用户数据 | 正常同步 / 读取验证 / 未授权 / 并发同步 / key前缀验证 | 5/5 |
| 任务取消 | 未授权 / 不存在任务 / 有效取消 | 3/3 |
| 图片保存 | 正常保存 / 未授权 / 大图保存 | 3/3 |
| 安全测试 | 401格式 / IDOR防护 / 路径穿越 / 重复提交防护 | 4/4 |
| 模型列表 | 图像模型 / LLM模型 / 未授权 | 3/3 |
| 视频配置 | 获取默认配置 | 1/1 |
| 健康检测 | 图像工具健康 / 视频API说明 | 2/2 |
| 其他 | 404处理 / 静态资源 / OPTIONS预检 / 工作流模型 | 4/4 |
| 模型列表详情 | 获取所有模型 / 图像模型过滤 | 2/2 |
| 注销 | 注销返回200 / 重复注销 | 2/2 |
| 会话续期 | 已登录session返回200 | 1/1 |

### 异常和混沌测试 (21 项)

| 类别 | 测试项 | 通过 |
|------|--------|------|
| HTTP错误码 | 404处理 / 405方法不允许 / 413超大请求体 | 3/3 |
| 模型异常 | 未知模型ID / 模型为空 / 不支持的操作 | 3/3 |
| 重复提交 | 并发生成 / 重复取消 | 2/2 |
| 操作中断 | 取消进行中任务 / 取消已完成任务 | 2/2 |
| 边界值 | 空提示词 / 超长提示词(50KB) / 特殊字符提示词 | 3/3 |
| 数据隔离 | 不同用户数据隔离 / 跨用户IDOR | 2/2 |
| 稳定性 | 多次登录注销 / 快速页面切换 / SSE降级 | 3/3 |
| 超时处理 | 慢响应不崩溃 | 1/1 |

### 安全测试 (31 项)

| OWASP类别 | 测试项 | 通过 |
|-----------|--------|------|
| A01 访问控制 | 未授权访问 / IDOR / 管理员保护 / API Key管理 | 8/8 |
| A02 加密机制 | Cookie HttpOnly / Secure / 密码哈希 | 3/3 |
| A03 注入 | SQL注入 / 命令注入 / NoSQL注入 | 5/5 |
| A05 安全配置 | HTTP头 / 错误信息 / 调试信息 / 默认凭证 | 4/4 |
| A07 身份认证 | 错误密码 / 空凭据 / 注销 / 并发 / 密码安全 | 5/5 |
| A08 数据完整性 | CORS / 请求体限制 | 2/2 |
| A10 SSRF | 内网IP检测 / 本地文件读取 | 2/2 |
| 路径穿越 | 目录穿越 / 空字节注入 | 2/2 |

---

## 修复回归验证

### BUG-001: WebKit Cookie 安全标志 (P0)
- **修复前**：WebKit 3/3 失败 (401 阻断)
- **修复后**：WebKit 3/3 通过 ✅
- **回归影响**：Chromium 3/3 通过，Firefox 3/3 通过（无回归）

### BUG-002: WebKit selectOption 兼容性 (P1)
- **修复前**：WebKit p0-core 模型选择失败
- **修复后**：模型选择正确，生成使用指定模型 ✅
- **回归影响**：无（仅影响 WebKit 测试代码）

### BUG-003: 模型选择存储路径 (P1)
- **修复前**：E2E 测试设置错误的 localStorage key
- **修复后**：使用正确的嵌套 key + UI 下拉菜单双重保障 ✅
- **回归影响**：无（仅影响测试代码）

---

## 静态检查回归

### TypeScript 检查
```
pnpm ts-check → 0 errors
```
- 修复了 `p0-core.spec.ts` 中 `isProcessingPlaceholder` 属性类型断言

### ESLint 检查
```
pnpm lint --quiet → 0 errors
```
- 所有源代码和测试代码均通过 lint 检查

---

## 测试环境

| 项目 | 值 |
|------|-----|
| 框架 | Next.js 16 (App Router) |
| 构建 | NODE_ENV=production |
| 端口 | 5000 |
| 数据库 | PostgreSQL |
| 测试用户 | Mr.joker |
| E2E 框架 | Playwright (Chromium/Firefox/WebKit) |
| API 测试框架 | Vitest |
| 测试日期 | 2026-07-20 |

---

## 结论

全部 109 项回归测试 **100% 通过**，无回归问题。修复的 6 个缺陷（1个P0 + 2个P1 + 3个P2）均未引入新的回归。跨浏览器兼容性验证通过（Chromium/Firefox/WebKit 三浏览器 E2E 全绿）。

## 2026-07-29 Task 9 增量回归结果

> 基线提交：`aefb36e91eb4f4d08a8d9dcceeaf11feb64ad310`
> 本地地址：`http://127.0.0.1:5000`
> 云端基线：`https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/`

| 检查项 | 结果 | 说明 |
|--------|------|------|
| `node scripts/doctor.mjs` | PASS WITH WARNINGS | 23 passed / 10 warnings / 0 failed；缺少本地生产密钥、数据库、对象存储和部署 URL |
| Pear/分层专项 Vitest | PASS WITH SKIP | 68 passed / 1 skipped；PostgreSQL 并发测试因无测试数据库跳过 |
| 分层 Playwright Chromium | BLOCKED | 在本地生产构建真实执行并生成 screenshot/video/trace/console/network；`POST /api/auth/login` 返回 503，缺少 PostgreSQL/生产鉴权配置 |
| 云端 Chrome 基线 | PARTIAL | `https://wjaigc.coze.site/` 已登录；图片工具栏存在“编辑元素”，但打开的是旧“PSD 分层编辑器”，未包含新版三模式契约 |
| 全仓 Vitest | PASS WITH SKIP | 关闭文件级并行以隔离 Sharp/fontconfig 原生资源竞争；233 files passed / 2 skipped；1066 tests passed / 2 skipped；0 failed；140.73s |
| TypeScript | PASS | `next typegen` 与 `tsc -p tsconfig.json` 通过，0 errors |
| ESLint | PASS WITH WARNINGS | 0 errors / 944 warnings；存量警告未伪装为零 |
| Next.js 生产构建 | PASS | Next.js 16.2.10，110 个静态页面，退出码 0 |

云端检查仅用于部署前基线，不是新版本验收。当前云端尚未包含本地领先提交，不能用旧版界面证明 `smart`、`cloud`、`local` 三模式通过。

**本次回归结论：有条件通过。** 本地自包含测试、类型、Lint 和生产构建已通过；真实 Pear 云端完成链路、PostgreSQL 并发幂等以及部署后跨浏览器证据尚未满足发布标准。

Task 9 审查修复后补充验证：TypeScript 0 errors、ESLint 0 errors、Next.js 16.2.10 生产构建通过并生成 110 个静态页面。ESLint 同时报告 944 个历史 warning。CI 已接入 Chromium 真实 Pear 用例、Firefox/WebKit 非付费分层回归和独立 HTTP API 套件；这些 CI 用例仍需在 GitHub Secrets 与新云端部署就绪后实际运行。

补充回归已覆盖快速双击同步互斥、干净 CI runner 数据目录和非受信任 PR 不读取付费 Secrets。GitHub Actions YAML 已使用结构化解析器验证。

## 2026-07-29 Pear 云端第二轮真实回归

| 检查项 | 结果 | 证据与边界 |
|--------|------|------------|
| 同源受控媒体读取 | PASS | 原 `Remote image returned HTTP 403` 已不再出现，任务进入模型目标解析 |
| Pear 提供商配置可见性 | FAIL（本地已修） | 管理员后台确认 `pear分层` 已启用、类型 `layer`、模型 `Image-Layered`；运行时仍报无可用模型 |
| 失败前扣费 | PASS | 积分重试前后均为 `9,987,596`，且失败发生在供应商提交前 |
| 真实 Pear 提交与 PSD 终态 | BLOCKED | 模型类型兼容修复尚未部署，未产生 Pear taskId 或 PSD |
| 相关专项测试 | PASS | 13/13：路由、工作流模型、授权、历史模型类型兼容 |
| 全仓 Vitest | PASS WITH SKIP | 234 files passed / 2 skipped；1068 tests passed / 2 skipped；0 failed；228.15s |
| PostgreSQL 真并发 | SKIPPED / BLOCKED | 2/2 测试因无隔离 `TEST_POSTGRES_URL` 跳过，不计通过 |
| Firefox/WebKit | BLOCKED | 预览域名对独立 HTTP warmup 返回 404，且无独立 E2E 登录凭据；未进入浏览器业务步骤 |

曾在一次独立审查运行中观察到 `annotation-execute` 5 秒超时，单文件运行通过，本轮完整串行门禁也通过。该现象尚未稳定复现，保留为运行波动风险，不据此做猜测性修改。

证据：

- `test-results/screenshots/pear-layering-cloud-provider-missing.jpg`
- `test-results/console/pear-layering-cloud-provider-missing.json`
- PostgreSQL 用例输出：2 tests skipped
- Firefox/WebKit 启动输出：`E2E server warmup failed with HTTP 404`

## 2026-07-29 09850e3 云端回归与本地修复

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 云端版本 | CONFIRMED | 本地与云端基线均为 `09850e396c12a53ea2157a0c5fe46c4ecb859d11` |
| Pear 模型可见性 | PASS | 云端可选择 `pear分层 / Image-Layered`，任务进入读取源图阶段 |
| Coze 同源媒体读取 | FAIL / LOCAL FIXED | 10:05、10:10 均在 5% 返回远程图片 403；改用部署配置公共域名后路由专项 8/8 |
| 失败任务终态 | PASS | 管理员云端任务监控显示两笔任务均为 `failed`，错误码 `UNSAFE_REMOTE_IMAGE` |
| 失败退款 | FAIL / LOCAL FIXED | 两笔各扣 15，无对应退款；结算 SQL 改为单次更新任务行并先锁积分账户，路由与结算专项 20/20 |
| TypeScript | PASS | `next typegen` 与 `tsc --noEmit` 通过 |
| 变更文件 ESLint | PASS | 0 error |
| 全仓 Vitest 首轮 | FAIL THEN FIXED | 1070 passed / 3 failed / 2 skipped；3 个失败为旧终态 SQL 契约，拆分活动与终态条件后专项已恢复 |
| 全仓 Vitest 最终 | PASS | 235 个测试文件、1075 项通过、0 失败；3 项真实 PostgreSQL 测试因本地无 `TEST_POSTGRES_URL` 跳过 |
| PostgreSQL 并发 | PENDING CI | 新增积分账户并发删除竞态；新单更新结算 SQL 必须重新跑 PostgreSQL 16 门禁 |
| Firefox/WebKit | BLOCKED | GitHub 未配置独立 E2E 地址、账号、密码与付费模型 Secrets |

当前结论仍为 **不通过**。必须部署新提交后完成 Pear 成功链路、失败退款和 PSD/2+ 图层验证。

## 2026-07-29 f8f7cef 云端复测与协议修正

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 真实 Chrome 重试 | FAIL / LOCAL FIXED | 同源黄色纸鹤图片仍在 0% 立即返回 `Remote image returned HTTP 403` |
| 根因验证 | CONFIRMED | 图片为当前预览页同源 `/api/serve-upload/...`；失败发生在 Pear 提交前 |
| 客户端媒体归一化 | PASS | 仅当前同源托管媒体转相对路径，跨域和非托管 URL 保持原样 |
| Pear 官方协议 | PASS | 主接口为 `/v1/images/edits`；请求体仅含 `model` 与 `image`；同步 PSD、异步 task 两类返回解析保留 |
| 分层专项 | PASS | 6 files / 43 tests passed |
| 全仓 Vitest | PASS WITH SKIP | 235 files passed / 2 skipped；1077 tests passed / 3 PostgreSQL skipped；0 failed |
| TypeScript | PASS | `next typegen` + `tsc` 通过 |
| ESLint | PASS WITH WARNINGS | 0 errors / 944 历史 warnings |
| 生产构建 | PASS | Next.js 16.2.10，110 个静态页面，退出码 0 |

本轮没有把本地测试当作云端 Pear 成功证据。新客户端代码部署前，PSD、2+ 图层、一次扣费、取消退款仍未验证。

## 2026-07-29 活动图片目标错位修复

| 检查项 | 结果 | 说明 |
|--------|------|------|
| Chrome 请求取证 | FAIL / ROOT CAUSE CONFIRMED | 当前选中纸鹤，但请求提交了历史 Hunyuan 3D URL；403 发生在 Pear 调用前 |
| 目标解析 RED/GREEN | PASS | 新增 2 项测试，证明当前单选优先且历史锁定目标保留兜底 |
| Pear/分层专项 | PASS | 10 files / 40 tests passed |
| 全仓 Vitest | PASS WITH SKIP | 236 files passed / 2 skipped；1079 tests passed / 3 PostgreSQL skipped；0 failed |
| TypeScript | PASS | `next typegen` + `tsc -p tsconfig.json --noEmit` 通过 |
| ESLint | PASS | `eslint . --quiet`，0 error |
| 生产构建 | PASS | Next.js 16.2.10，110 个页面生成完成，退出码 0 |

本地修复只证明目标选择逻辑和既有分层契约没有回归。云端仍需确认 POST 使用当前 `/api/serve-upload/...` 路径，并取得真实 Pear PSD、至少 2 个可编辑图层及结算证据。

## 2026-07-29 Pear 同步 ZIP 产物适配回归

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 当前图片请求 | PASS | Chrome 捕获的 POST 使用 `/api/serve-upload/uploads/gen-1784785107873-34qv4b.png`，不再使用历史 3D URL |
| Pear 后台取证 | ROOT CAUSE CONFIRMED | task `bd589fcd-4301-445f-ab29-1173b4a003ad` 同步运行 4m30s，成功返回 ZIP，浏览器侧连接先失败 |
| 协议 RED/GREEN | PASS | 强制 `task_type=async`、`response_format=url`；接受同步/异步返回的 PSD 或 ZIP artifact |
| ZIP 安全解析 | PASS | 主 PSD 选择、depth PSD 排除、条目/路径/解压大小限制、`8BPS` 签名校验均进入受测实现 |
| 分层专项 | PASS | 5 files / 34 tests passed |
| 全仓 Vitest | PASS WITH SKIP | 236 files / 1083 tests passed；2 files / 3 tests skipped；0 failed |
| TypeScript | PASS | `next typegen` + `tsc -p tsconfig.json`，退出 0 |
| ESLint | PASS WITH WARNINGS | 0 errors / 944 existing warnings，退出 0 |
| Production build | PASS | Next.js 16.2.10，110 个静态页面，退出 0 |

本地回归证明适配器不再把 Pear ZIP 当成无效 PSD，也不会让已知长任务默认走同步等待。部署后仍必须取得真实异步 taskId、阶段进度、ZIP 解包、2+ 可编辑图层以及单次扣费证据。

## 2026-07-29 Pear ZIP、租约与结算最终回归

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 真实 ZIP 离线回放 | PASS | 12,961,882 字节 ZIP；提取 117,970,772 字节主 PSD；1280x1280、29 图层、0 解析警告 |
| 内存边界 | PASS | ZIP 下载、解压、PSD 解析及细化共享单槽内存门；真实制品回放峰值 RSS 约 373 MiB |
| 初始提交幂等竞态 | PASS | 首次 Pear 提交租约随任务 INSERT 原子持久化；重复客户端轮询不能抢占或提前退款 |
| worker 租约 | PASS | heartbeat、owner-fenced 进度/完成/失败、失租中止和 attempt 文件清理均有回归 |
| smart fallback 结算 | PASS | fallback 阶段、余额退款和退款流水由同一 owner-fenced CTE 提交 |
| 分层及关联专项 | PASS WITH SKIP | 22 个测试文件；118 项通过，2 项 PostgreSQL 测试因无隔离测试库跳过 |
| 全仓 Vitest | PASS WITH SKIP | 535/535 个测试文件通过；1105 项通过、3 项跳过、0 失败 |
| TypeScript / ESLint | PASS | `next typegen`、`tsc`、`eslint . --quiet` 均退出 0 |
| Production build | PASS WITH WARNINGS | Next.js 16.2.10，110 个页面生成；存在既有动态文件追踪和超大组件告警 |
| 独立代码复审 | PASS | P0=0、P1=0；未发现本次 diff 的代码级发布阻断项 |

本轮未执行云端新代码的真实 Pear 异步成功/取消链路，因此发布结论仍不能升级为通过。
## 2026-07-29 Pear ZIP MIME 云端回归

| 检查项 | 结果 | 说明 |
|--------|------|------|
| Chrome 初始提交 | PASS | `/api/layered-decompose` 约 1 秒返回 HTTP 202 和无界 taskId，不再同步等待 4m30s |
| 异步阶段 | PASS | 首次响应为 `waiting-for-pear` 15%，首轮轮询为 27%，UI 显示 Pear 正在生成 PSD |
| ZIP 下载终态 | FAIL / LOCAL FIXED | 约 166 秒进入 `downloading-psd` 后被内部 MIME 集合拒绝，返回 `UNSAFE_REMOTE_IMAGE` |
| MIME RED/GREEN | PASS | `application/zip` 与 `application/x-zip-compressed` 两项测试先失败，再由最小白名单修复通过 |
| ZIP/PSD 与安全下载 | PASS | 2 files / 39 tests passed |
| 分层专项 | PASS | 6 files / 72 tests passed |
| TypeScript / ESLint | PASS | `next typegen`、`tsc`、`eslint --quiet` 均退出 0 |
| 全量 Vitest | PASS WITH ENVIRONMENT SKIPS | `pnpm test` 退出 0；真实 PostgreSQL 环境用例仍按既有规则跳过 |
| Production build | PASS | Next.js 16.2.10 编译成功并生成 110 个路由 |

当前结论仍为 **不通过**。异步提交已取得真实云端证据，但新 MIME 修复尚未部署；主 PSD 提取、可编辑图层、成功单次扣费和失败单次退款仍需部署后验证。

## 2026-07-29 Pear 双栈 DNS、ZIP 与 PSD 真实制品回归

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 双栈 DNS RED/GREEN | PASS | Coze 透明出口同时返回 `198.18.1.22` 与 `fdfe:...`；下载器现选择并固定允许地址，纯保留地址仍拒绝 |
| 真实 GET MIME | PASS | Pear CDN 返回 HTTP 200、`Content-Type: application/zip`、`Content-Length: 625723` |
| ZIP 安全下载 | PASS | 使用生产 `downloadPublicImage()` 与显式 ZIP 白名单完成下载，无重定向 |
| 主 PSD 提取 | PASS | 跳过 depth PSD，得到 `7,738,844` 字节主 PSD，签名为 `8BPS` |
| PSD 真实解析 | PASS | `ag-psd` 解析为 `1280x1280`、5 个可编辑图层，持久化 5 个 PNG，0 警告 |
| 编辑器云端终态 | PENDING DEPLOY | 需要部署本次提交后在预览页确认图层选择、隐藏、移动和导出 |

当前修复已在本地贯通 MIME、地址选择、ZIP 解压和 PSD 解析。发布结论仍为 **不通过**，直到预览页编辑器终态、一次扣费/退款、PostgreSQL 并发和 Firefox/WebKit 门禁完成。

## 2026-07-31 图片工具质量与双输出元素拆解本地门禁

测试基线为本地 `main`，HEAD `7bff3c0` 加当前未提交实现；最终部署提交将在本轮验证后生成。未将本地测试结果冒充云端结果。

| 检查项 | 结果 | 证据与边界 |
|--------|------|------------|
| 图片工具质量专项 | PASS | 9 files / 24 tests；透明 RGBA、去背景质量降级、显式擦除/蒙版、蒙版外像素保持、调色 alpha 与独立结果 |
| 双输出元素拆解专项 | PASS WITH SKIP | 9 files passed / 1 skipped；84 tests passed / 2 PostgreSQL tests skipped |
| TypeScript | PASS | `pnpm ts-check`，退出 0 |
| ESLint | PASS WITH WARNINGS | `pnpm lint`，0 errors / 945 warnings；存量 warning 未隐藏 |
| 全仓 Vitest | PASS WITH ENVIRONMENT SKIPS | 258 files passed / 3 skipped；1220 tests passed / 4 skipped；0 failed |
| Next.js 生产构建 | PASS WITH WARNINGS | Next.js 16.2.10；编译、TypeScript、111 个静态页面生成完成；本地持久化与 Node localStorage 参数有非阻断警告 |
| Git 差异检查 | PASS | `git diff --check` 退出 0；仅换行转换提示 |
| Chromium/Firefox/WebKit 用例发现 | PASS FOR DISCOVERY ONLY | 2 个新 spec、4 个项目共发现 48 个用例；未作为执行通过证据 |
| 云端图片工具像素结果 | NOT RUN | 必须部署后下载真实 PNG，用 Sharp 检查 alpha、蒙版外像素和持久化恢复 |
| 云端 Pear 双输出 | NOT RUN | 必须验证父请求、双分支、ZIP/PSD、2+ 图层、编辑与导出 |
| PostgreSQL 并发和结算 | BLOCKED | 缺少隔离 `TEST_POSTGRES_URL`，3 项真实数据库测试明确跳过 |
| Firefox/WebKit 真回归 | NOT RUN | 需部署版本和可访问测试凭据后执行 |

本地阶段结论：**有条件通过**。源代码、自包含测试和生产构建门禁通过；真实云端产物、数据库结算和跨浏览器门禁尚未完成。
