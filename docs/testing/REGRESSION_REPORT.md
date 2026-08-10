# 无界AI — 回归测试报告 (REGRESSION REPORT)

> [!IMPORTANT]
> **2026-08-08 最新回归状态：全量测试仍有 5 个历史失败，不能视为全量通过。**
> Stage 0 新增专项测试 15/15 通过，没有新增全量测试失败；详细证据见 `docs/testing/STAGE_0_COMPLETION_REPORT.md`。

> 生成时间：2026-07-20
> 测试范围：全平台功能回归 + 跨浏览器兼容性
> 测试方法：E2E 自动化测试 (Playwright) + API 自动化测试 (Vitest)

---

## 2026-08-02 云端 Chrome：专业创作多图生成回归

| 场景 | 结果 | 关键验证点 |
|------|------|------------|
| 专业创作 x3 | 通过 | 3 个独立占位任务；首张先显示；最终仅 3 张结果。 |
| 专业创作 x4 | 通过 | 4 个独立占位任务；最终仅 4 张结果，无重复写入或空白框。 |
| 供应商归属 | 通过 | 全部结果显示 `gpt-image-2 / PearAPI 图像`。 |
| 刷新恢复 | 通过 | 保留 `projectId`，项目恢复后画布中 7 张刚生成图均存在。 |
| 浏览器异常 | 通过 | 任务开始、处理中、完成和刷新恢复阶段均未捕获 console `error` 或 `warn`。 |

本次使用真实已登录 Chrome 与真实 Pear `gpt-image-2` 供应商任务，未使用 Mock。

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

## 2026-08-02 供应商任务可靠性回归

测试基线：工作树 `fix/provider-generation-reliability`，提交基线 `501a188` 加本轮未提交改动。

| 检查项 | 结果 | 证据 |
|------|------|------|
| 图像多输出专项 | PASS | 每张输出一个 durable 子任务、独立 slot、取消与逐张回填；专项 83 项通过。 |
| 视频同步/异步终态 | PASS | 同步视频 URL 直接完成；远端 ID 持久化后才进入内存轮询；失败/取消走原子退款。 |
| 视频重启边界 | PASS WITH SAFE FALLBACK | 未取得远端 ID 的持久化视频任务不会误轮询本地 ID，会终止并单次退款。 |
| 3D 事件流契约 | PASS | 断言已规范化换行符，仍验证关闭 `EventSource` 在失败回调之前。 |
| 全仓 Vitest | PASS WITH ENVIRONMENT SKIPS | `pnpm test`：295 files passed、1335 tests passed、3 files / 4 tests skipped、0 failed。 |
| TypeScript | PASS | 本轮代码完成后的 `pnpm ts-check` 已通过。 |
| ESLint | PASS WITH WARNINGS | 本轮代码完成后的 `pnpm lint`：0 errors / 949 warnings；warning 为存量，未静默隐藏。 |
| 生产构建 | PASS | 本轮代码完成后的 `pnpm build` 退出 0。 |

未执行或不能替代的项目：真实 PostgreSQL 多实例并发、真实供应商逐张图像返回/扣费退款、真实视频供应商同步与异步返回、已部署 Chrome/Firefox/WebKit 回归。

## 2026-08-02 多图生成真实云端回归与后续修复

| 检查项 | 结果 | 证据 |
|------|------|------|
| Pear `n=2` 真实提交 | PASS | 同一请求创建两个独立子任务：`async-1785669800411-0-j3ne6f`、`async-1785669800501-1-ezl1j5`。 |
| 两张结果逐张返回 | PASS | 两个不同 Pear CDN PNG URL 分别完成保存，时间不同；未将供应商结果误判为失败。 |
| UI 结果归并 | FAIL / LOCAL FIXED | 部署版本将两张结果重复为四层并在 `(0,0)` 重叠；已建立 RED/GREEN 回归并改为按结果 ID 去重的槽位归并。 |
| 供应商显示归属 | FAIL / LOCAL FIXED | 真实请求选 Pear，但 UI 显示 FHL；已在缺少 `providerName` 时保留显式 `providerId`。 |
| 定向回归 | PASS | 3 files / 11 tests passed。 |
| TypeScript | PASS | `pnpm ts-check` 退出 0。 |
| ESLint | PASS WITH WARNINGS | `pnpm lint`：0 errors / 949 warnings，均为既有存量。 |
| 全仓 Vitest | PASS WITH ENVIRONMENT SKIPS | 296 files / 1340 tests passed，3 files / 4 PostgreSQL tests skipped，0 failed。 |

### 2026-08-02 部署产物核对

`6eb061a93b43f60743f827a00fb1b8a94e4abd4d` 已推送至 GitHub `main`。部署后通过公开静态产物核对发现：

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 云端核心画布动态模块 | PASS | `https://wjaigc.coze.site/_next/static/chunks/1211.1104380f59eeaf6e.js` 与本地 `6eb061a` 构建的同名文件 SHA-256 均为 `27CB4FBBB762827E31EA757E78BFF3AE6912CE60FD8332504ADB3B603B1F6C48`。 |
| 槽位归并产物 | PASS | 云端模块包含已完成占位替换与结果 ID 去重路径。 |
| 供应商回填产物 | PASS | 云端模块包含 `providerName || providerId` 回退路径。 |
| 已登录 Chrome 真实 UI 回归 | BLOCKED | Chrome 进程、扩展和 native-host 检查均通过；但读取已登录预览标签、截图和控制台日志均在 30 秒内超时，无法取得浏览器交互证据。 |

### 2026-08-02 Pear `n=2` 云端修复验收

在同一 Chrome 用户会话中创建空项目 `project_1785672740345_w0o09zyjz`，选择 `Gpt Image 2 · PearAPI 图像`，设定 `3:4 / 2 张 / 高清`，并提交提示词“金色机械猫头鹰”。快速创作编译器所选 `deepseek-v4-flash / APImartLLM` 未给出可用编译结果，但产品正确降级为原始提示词，未阻断图像生成。

| 验收项 | 结果 | 真实证据 |
|--------|------|----------|
| 编译器不可用降级 | PASS | 面板显示“专业提示词编译暂不可用，已按原始需求提交图像生成”，随后进入生图，不将 LLM 供应商不可用误报为 Pear 图像模型错误。 |
| Pear `n=2` 最终结果数 | PASS | DOM 仅有两张猫头鹰图片；项目同步日志为 `project_1785672740345_w0o09zyjz ... canvasImages: 2`。 |
| 重复与重叠 | PASS | 结果 URL 分别为 `gen-1785673016023-ol4seq.png` 和 `gen-1785673016017-w0aer2.png`；位置分别为 `(810,232)` 与 `(1130,232)`，没有 `(0,0)` 追加或重复层。 |
| 供应商徽标 | PASS | 两张图均显示 `gpt-image-2 / PearAPI 图像`，没有 FHL 误标。 |
| 浏览器错误与弹窗 | PASS | Console `error`/`warn` 为空，未发现 JavaScript dialog。 |

结论：BUG-025 与 BUG-026 已取得真实云端 Chrome 通过证据。该结果不解除 PostgreSQL 并发结算、单子任务取消、`n=3/4`、真实视频及 Firefox/WebKit 等其余发布门禁。

### 2026-08-02 项目刷新恢复 BUG-027 本地修复

真实 Chrome 已稳定复现：项目 `project_1785672740345_w0o09zyjz` 成功保存两张 Pear 结果后，在画布直接刷新会回到“我的项目”；仪表盘仍显示该项目有 2 张图片。故障是当前项目路由状态缺失，不是项目数据或图片保存失败。

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 失败复现 | PASS | 刷新前为画布；刷新后 URL 仍为 `/?e2e=6eb061a`，页面为仪表盘；项目卡片仍显示 2 张图片。 |
| URL 回归测试 | PASS | 新增 `project-workspace-url.test.ts`，先验证模块缺失导致 RED，再实现并通过。 |
| 修复行为 | PASS（本地） | 成功 `loadProjectById()` 后使用 `history.replaceState` 写入 `projectId`，保留 `e2e` 等无关查询参数并移除 `view=dashboard`。 |
| 定向回归 | PASS | `project-workspace-url.test.ts` 与 `canvas-project-reopen-contract.test.ts` 共 4/4 通过。 |
| 全量质量门禁 | PASS WITH ENVIRONMENT SKIPS | Vitest 297 files / 1341 tests 通过；3 files / 4 PostgreSQL 环境用例跳过；TypeScript、生产构建通过；ESLint 0 error / 949 历史 warning。 |
| 部署后 Chrome 验收 | PENDING | 需要将本次修复部署后，用同一已保存项目刷新，确认 URL 含 `projectId` 且保持画布。 |
| Production build | PASS | `pnpm build` 退出 0，Next.js 16.2.10 生成 111 个路由；仅有既有 localStorage 路径警告。 |

结论：供应商多任务提交与逐张返回已取得真实证据；画布归并与供应商归属修复尚未部署，当前发布结论仍为**不通过**。

## 2026-08-02 供应商子任务取消与供应商归属修复（待部署）

测试基线：工作树 `fix/provider-generation-reliability`，基线提交 `cd0084f` 加本轮未提交修复。

| 检查项 | 结果 | 证据 |
|------|------|------|
| 单槽取消失败复现 | FAIL（已复现） | 云端专业创作 `n=2` 中取消第一个槽位后，`async-1785677224469-0-v7lzrk` 和 `async-1785677224475-1-lv1r88` 均被轮询为 `completed`。 |
| 前端取消接线 | PASS（本地） | 进度卡片取消统一通过 `taskEventsClient.cancelTask(taskId)`；仅在后端确认成功后才删除占位框。 |
| durable 取消/退款终态 | PASS（本地） | `cancel-task.test.ts` 覆盖数据库条件式取消、终态保护和一次性退款。 |
| 供应商名称规范化 | PASS（本地） | 持久化任务以 `providerId` 为主反查展示名，历史 `FHL图像模型` 不能覆盖 Pear ID。 |
| 专项回归 | PASS | 5 files / 22 tests passed：取消 UI 契约、取消 API、逐张回填、轮询持久化恢复、展示名解析。 |
| 全仓 Vitest | PASS WITH ENVIRONMENT SKIPS | `pnpm test`：299 files / 1348 tests passed；3 files / 4 PostgreSQL 环境用例 skipped；0 failed。 |
| TypeScript | PASS | `pnpm ts-check` 退出 0。 |
| ESLint | PASS WITH WARNINGS | `pnpm lint`：0 errors / 949 warnings；没有新增 lint error。 |
| 生产构建 | PASS | `pnpm build`：Next.js 16.2.10 完成编译、类型检查与 111 个路由构建。 |
| 云端真实取消、退款、迟到完成 | PENDING DEPLOY | 必须部署后提交 Pear `n=2`，取消一个槽位，确认 `/api/cancel-task` 成功、仅幸存槽位完成、被取消槽位不被迟到结果覆盖，并核对一扣一退账务流水。 |

本阶段不把本地契约测试当作真实供应商结算通过证据。发布结论仍为 **不通过**，直到上述部署验证、PostgreSQL 并发与跨浏览器回归完成。

## 2026-08-02 云端单槽取消复验失败与二次修复（待部署）

测试基线：云端为 GitHub `main` 的 `98ba6c2`；本地工作树为 `fix/provider-generation-reliability`，包含待随本次提交部署的最小修复。

| 检查项 | 结果 | 证据 |
|------|------|------|
| Pear `n=2` 单槽取消 | FAIL（云端） | 在项目 `project_1785676375816_qvjpfv81z` 提交两个槽位 `async-1785680404674-0-wa2qo6`、`async-1785680404748-1-7ruits`。5% 时取消第一个槽位，页面短暂只保留一个卡片；重新打开项目后仍出现两张机械怀表结果。 |
| 供应商展示归属 | PASS（同次观察） | 两张实际结果均显示 `gpt-image-2 / PearAPI 图像`，未出现旧 FHL 名称。 |
| 失败证据 | CAPTURED | `test-results/screenshots/cloud-cancel-n2-2026-08-02.png`；Chrome Console 持续轮询两个 taskId，证明被隐藏槽位没有完成持久化取消。 |
| 取消冲突回归（RED） | PASS | 新用例先在旧行为下失败：预期 `409`，实际取得 `200`。 |
| 取消冲突回归（GREEN） | PASS | `cancel-task.test.ts` 7/7 通过：数据库终态转换未成功时返回 `409`，不调用内存取消。 |
| 供应商可靠性组合回归 | PASS | `cancel-task`、渐进回填、取消 UI 契约、云任务存储、输出数量共 5 files / 35 tests 通过。 |
| TypeScript | PASS | `pnpm ts-check` 退出 0。 |
| 全量测试、Lint、构建 | PASS WITH KNOWN LIMITS | `pnpm test`：299 files / 1349 tests 通过，3 files / 4 PostgreSQL 并发用例因无隔离数据库跳过；`pnpm lint`：0 errors / 949 warnings；`pnpm build`：111 条路由构建完成。 |
| 自动保存快照配额 | NEW P2 | 项目恢复 Console 重复出现 `wujie_autosave_snapshots_v1` 的 `QuotaExceededError`，已登记为 BUG-031，未与本次 P1 修复混合。 |

结论：`98ba6c2` 未通过真实单槽取消门禁。新的本地状态机修复必须先完成全量门禁、推送与部署，然后以同一真实 Pear `n=2` 场景重新验证“仅幸存槽位落图、取消槽位不回写、账务一次扣费/一次退款”。

## 2026-08-02 底部图像生成器多图槽位与显式提供商路由

测试基线：工作树 `fix/provider-generation-reliability`，待提交源码；云端此前部署版本已针对 Pear `gpt-image-2` / 数量 2 稳定复现。

| 检查项 | 结果 | 证据 |
|------|------|------|
| 失败复现：单占位框 | PASS（已复现） | 底部图像生成器设置数量 2 后，旧云端仅显示一个处理框，不能代表两个可取消子任务。 |
| 失败复现：显式 Pear 路由风险 | PASS（已复现） | 旧客户端路径可丢失明确提供商约束，历史真实观察中出现 Pear 选择与 FHL 标识/路由不一致。 |
| 每槽位独立处理框契约 | PASS（本地） | `infinite-canvas-direct-generation-contract.test.ts` 断言每个 `slots` 返回值创建一张带 `processing.taskId` 的画布卡片。 |
| 旧包装器隔离 | PASS（本地） | `generationChannel: "canvas-direct"` 不再进入 `WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER` 外层包装分支。 |
| 显式提供商不跨路由 | PASS（本地） | `generate-explicit-provider-contract.test.ts` 断言显式 provider 缺失凭证时直接失败，不能选择候选列表中无关提供商。 |
| 定向回归 | PASS | 6 files / 30 tests passed。 |
| TypeScript | PASS | `pnpm ts-check` exit 0。 |
| ESLint | PASS WITH WARNINGS | `pnpm lint` exit 0；0 errors / 949 historical warnings。 |
| 全量 Vitest | PASS WITH ENVIRONMENT SKIPS | 301 files / 1354 tests passed；3 files / 4 PostgreSQL 环境测试 skipped。 |
| 生产构建 | PASS | `pnpm build` exit 0；Next.js 16.2.10 构建完成 111 条路由。 |
| 云端 Chrome 验收 | PENDING DEPLOY | 当前“云端已部署”发生在本地新修复推送之前；需要推送、拉取并重新部署后执行。 |

本轮结论：本地回归通过，但完整平台发布结论仍为 **不通过**。不得用构建成功替代真实 `n=2` 子任务取消、账务一次性结算和提供商归属验收。

## 2026-08-02 云端证据：canvas-direct 多槽位与终态解锁

| 验证项 | 结果 | 证据 |
|------|------|------|
| Canvas-direct `n=2` 槽位创建 | 通过 | Chrome 同时出现 `生成图片 1/2`、`生成图片 2/2` 两个独立处理框，各自有取消入口。 |
| 渐进式供应商回填 | 通过 | 两个不同的 Pear CDN PNG URL 返回到画布，证明显式 `PearAPI 图像 / gpt-image-2` 产生了两个真实输出。 |
| 所有可见结果完成后解锁生成器 | 失败，BUG-034 | 两个处理框均消失、两个结果均可见后，提交按钮仍禁用并显示“生成中…”。 |
| 根因回归 | 本地通过 | 新增 RED/GREEN 契约，要求 `success` 和 `succeeded` 与 `completed` 一样结束槽位。 |
| 定向可靠性回归 | 通过 | 6 文件 / 31 测试，覆盖输出数量、显式供应商路由、幂等、取消 API、取消 UI 与 canvas-direct 槽位。 |
| 全量质量门禁 | 通过但含环境跳过 | Vitest 301 files / 1355 tests passed；3 个 PostgreSQL 专用文件 / 4 项跳过；TypeScript 通过；ESLint 0 errors / 949 historical warnings；生产构建完成 111 条路由。 |

结论：云端已证明多槽位实现生效，但 BUG-034 说明该部署版本未通过连续生成门禁。必须部署本次终态归一化修复，之后再尝试单槽取消场景。
## 2026-08-02 Provider Generation Reliability Follow-up

| Check | Result | Evidence |
|---|---|---|
| Provider ID is persisted separately from the display label | PASS (local) | 6 direct-generation contract assertions passed. |
| Recovery polling ignores fresh in-memory placeholders | PASS (local) | `resumed-task-polling.test.ts` passed. |
| Cancellation is isolated per canvas task slot | PASS (local) | 4 cancellation contract assertions plus 7 cancel API tests passed. |
| Autosave snapshots do not retain raw data/blob image payloads | PASS (local) | 2 quota contract assertions passed. |
| Full regression | PASS WITH ENVIRONMENT SKIPS | `pnpm test`: 302 files / 1359 tests passed; 3 PostgreSQL files / 4 tests skipped because an isolated test database is not configured. |
| Deployment evidence | PENDING | Must repeat a real Pear `n=2` flow, cancel exactly one slot, verify provider attribution, refresh recovery, ledger settlement, and browser console. |

## 2026-08-03 Cloud Regression: provider attribution failure reproduced

| Check | Result | Evidence |
|---|---|---|
| Direct submission route | PASS | `/api/generate` sent `providerId: api_1780630178347_rjqlmam`, `model: gpt-image-2`, `n: 2`, `generationChannel: canvas-direct`. |
| Two durable slots | PASS | Two distinct task IDs were created and independently polled with the same Pear provider ID. |
| Provider attribution after completion | FAIL, BUG-037 | Both results returned from Pear CDN, but final poll payloads carried empty `providerName` and canvas cards displayed FHL. |
| Browser console | PASS | No error-level console entries were observed during this run. |
| Cancellation timing | UNVERIFIED | Both 1K tasks completed before a single cancel action could be issued; no cancellation outcome is claimed from this run. |

The follow-up patch preserves the configured provider when the completion response omits or blanks provider metadata. Local focused regression is green; deployment verification remains required.

## 2026-08-03 BUG-037 Local Verification Gate

| Check | Result | Evidence |
|---|---|---|
| Empty completion provider metadata regression | PASS (local) | `infinite-canvas-direct-generation-contract.test.ts` asserts that blank `providerName` falls back to the selected provider label. The test was observed failing before the non-empty guard was implemented. |
| Full Vitest suite | PASS WITH ENVIRONMENT SKIPS | `pnpm test`: 302 test files / 1360 tests passed; 3 PostgreSQL-specific files / 4 tests skipped because no isolated `TEST_POSTGRES_URL` is configured. |
| TypeScript | PASS | `pnpm ts-check` exited 0. |
| ESLint | PASS WITH HISTORICAL WARNINGS | `pnpm lint` exited 0 with 0 errors and 949 existing warnings. |
| Production build | PASS | `pnpm build` completed compilation, TypeScript validation, and 111 routes. |
| Cloud verification | PENDING DEPLOYMENT | The deployed `2270162` build cannot contain this local BUG-037 patch until it is pushed and redeployed. |
## 2026-08-03 Deployed Provider and Cancellation Check

| Check | Result | Evidence |
|---|---|---|
| Provider attribution | PASS (cloud) | A fresh direct-canvas Pear `gpt-image-2` `n=2` run completed two cobalt-blue cup cards, both labelled `PearAPI 图像`. |
| Independent task slots | PASS (cloud) | Two visible cards appeared at `processing 0%`, each with a separate Cancel action. |
| Single-slot cancellation | FAIL, BUG-038 | Cancel was clicked on the first slot while both were processing. Both tasks subsequently completed. |
| Server error visibility | PASS (local), pending deployment | The cancellation client now preserves an API `error` field as the UI-facing message. Focused suite: 14 tests passed. |

The cancellation failure is an application release blocker, not a provider failure: the Pear provider completed both tasks normally.

## 2026-08-03 Canvas Reference/Fusion Group Regression

| Check | Result | Evidence |
|---|---|---|
| Modifier gesture enters group creation before image drag | PASS (local) | `canvas-group-gesture-contract.test.ts` verifies the root pointer-down path dispatches Alt to reference groups and Ctrl/Cmd to fusion groups. |
| Blank-canvas long press restores panning | PASS (local) | The same contract verifies timer setup, movement cancellation, and pan activation. |
| Group titles remain draggable | PASS (local) | Ordinary and generation-group headers now use pointer capture. |
| Empty prompt group generation | PASS (local) | A selected model is sufficient; reference/fusion fallback prompts are used when the user has not typed an instruction. |
| Reference content recognition | PASS (local wiring) | The group action calls `/api/vision-prompt`, persists descriptions by image ID, and reuses them in the corresponding generation request. |
| Parallel group isolation | PASS (local) | Generation metadata is invocation-local rather than stored in a shared ref. |
| Full regression | PASS WITH ENVIRONMENT SKIPS | `pnpm test`: 303 files / 1367 tests passed; 3 PostgreSQL-specific files / 4 tests skipped because no isolated `TEST_POSTGRES_URL` is configured. |
| TypeScript / lint / build | PASS WITH HISTORICAL WARNINGS | `pnpm ts-check` and `pnpm build` passed; `pnpm lint` reported 0 errors and 949 existing warnings. |
| Cloud browser evidence | PENDING DEPLOYMENT | Validate Alt and Ctrl/Cmd grouping, title dragging, reference recognition, reference generation, fusion generation, and a persisted project reload. |

## 2026-08-03 Group Control Regression Gate

| Check | Result | Evidence |
|---|---|---|
| Image-group interaction boundary | PASS (local) | `data-toolbar="image-group"` prevents the root canvas `pointerdown` handler from consuming Collapse and Close actions. |
| Reference/fusion interaction boundary | PASS (local) | `data-toolbar="generation-group"` preserves model-menu clicks until their own click handler commits the selected model. |
| Pointer-drag compatibility | PASS (local contract) | Existing title drag handles still use pointer capture; the fix only short-circuits the root pointer-down start handler for control-originated events. |
| Focused regression | PASS | 6 test files / 24 tests: group gestures, image dragging, progressive generation, generation reconciliation, batch construction, and progressive polling contract. |
| Full local gate after BUG-040 | PASS WITH ENVIRONMENT SKIPS | `pnpm ts-check`, `pnpm lint` (0 errors / 949 historical warnings), `pnpm test` (303 files / 1368 tests passed; 3 PostgreSQL files / 4 tests skipped without `TEST_POSTGRES_URL`), and `pnpm build` all passed. |
| Cloud browser acceptance | PENDING DEPLOYMENT | Validate image/reference/fusion Collapse and Close, select a group model, generate, drag the title, save, and refresh. |

This gate does not claim provider generation or billing acceptance. The next real `n=2` browser run must use an enabled provider and prove separate task slots and progressive result arrival after group controls are confirmed.

## 2026-08-03 Group Zoom and Fidelity Gate

| Check | Result | Evidence |
|---|---|---|
| Scaled group configuration menus | PASS (local) | Aspect ratio, resolution, quality, and output-count use `CanvasScaledMenuSelect` within the canvas transform tree. |
| Independent reference categories | PASS (local) | `buildGroupReferenceRequestControls` preserves `style: 85` and `subject: 20` independently instead of collapsing both to `85`. |
| Full fusion preservation contract | PASS (local) | Every fusion source receives all six categories at `100` and strict request strength `0.05`. |
| Reference-description alignment | PASS (local) | Blank descriptions are retained as placeholders so source image indexes do not shift. |
| Verification | PASS WITH ENVIRONMENT SKIPS | TypeScript, ESLint error gate, full Vitest (305 files / 1374 tests passed; 3 PostgreSQL files / 4 tests skipped), and production build passed. |
| Cloud acceptance | PENDING DEPLOYMENT | Verify menu scaling at two zoom levels, per-category reference behavior, fusion preservation, and a real `n=2` request. |

## 2026-08-03 Image Generator Reference-Constraint Gate

| Check | Result | Evidence |
|---|---|---|
| Reference description positional alignment | PASS (local) | Empty descriptions remain placeholders, so reference #2 can never be attached to reference #1. |
| Per-reference category ownership | PASS (local) | The compiler emits numbered reference blocks; style/composition on reference #1 and subject/detail on reference #2 are not merged. |
| Model-language adaptation | PASS (local) | Chinese-native provider/model IDs produce Chinese constraints; English-native IDs produce English constraints; unknown IDs receive compact bilingual constraints internally. |
| Durable async task recovery | PASS (local) | Both generation submission payload forms persist `referenceCategoryStrengths`. |
| Focused generation suite | PASS | 6 files / 23 tests passed. |
| Full local quality gate | PASS WITH ENVIRONMENT SKIPS | `pnpm ts-check`, `pnpm test` (307 files / 1,380 tests passed; 3 PostgreSQL files / 4 tests skipped), and `pnpm build` passed. `pnpm lint` exited 0 with 949 historical warnings. |
| Cloud acceptance | PENDING DEPLOYMENT | Use an enabled Chinese-native image model and an enabled English-native image model with two reference images, different selected categories, and a successful generated result for each. |

## 2026-08-03 Reference/Fusion Error Transparency Gate

| Check | Result | Evidence |
|---|---|---|
| Missing provider route preflight | PASS (local) | A generation group with a selected model but no `providerId` is stopped before `/api/generate`, with a visible model-selection recovery message. |
| Provider/task failure visibility | PASS (local) | The group polling loop retains terminal task detail instead of replacing it with `生成失败，请检查模型和API配置`. |
| Nested polling payload compatibility | PASS (local) | `result.message` is recognized when top-level `error` is absent. |
| Focused regression | PASS | 2 files / 5 tests for failure-message behavior; 4 group/reference-chain files / 18 tests passed. |
| TypeScript | PASS | `pnpm ts-check` completed successfully. |
| Cloud acceptance | PENDING DEPLOYMENT | Submit one real reference-group request with an enabled provider and save the returned status/error, request ID, provider ID, and model ID. |

## 2026-08-03 Shared Reference-Image Transport Gate

| Check | Result | Evidence |
|---|---|---|
| Reference payload ordering | PASS | RED/GREEN route contract requires `requestBody.image` to be assigned before `filterRequestForModel()` creates the submitted body. |
| Bottom generator forwarding | PASS (code-path trace) | `GenerationPanel` forwards `referenceImages` through `GenerationParams`; `CanvasWorkspace` submits `{ ...params }` to `/api/generate`, so it uses the same repaired server path as reference/fusion groups. |
| Provider endpoint compatibility | PASS (local) | The capability layer now receives `image` and `image_urls` after reference normalization, allowing `/images/edits` to receive its required image input and preserving fallback reference inputs. |
| Full local quality gate | PASS WITH ENVIRONMENT SKIPS | `pnpm test`: 309 files / 1,386 tests passed; 3 PostgreSQL files / 4 tests skipped without `TEST_POSTGRES_URL`. `pnpm ts-check`, `pnpm lint` (0 errors / 949 historical warnings), `pnpm build`, and protected-file self-check (8/8) passed. |
| Cloud acceptance | PENDING DEPLOYMENT | Submit one bottom-generator reference request and one canvas reference-group request using enabled configured models. Each must reach a provider task without `Missing required parameter: image`; retain any subsequent exact provider response. |

## 2026-08-03 Provider/Model Routing Consistency Gate

| Check | Result | Evidence |
|---|---|---|
| Stale model selection recovery | PASS (local) | The generator reconciles a stale persisted `providerId::modelId` against `/api/models?type=image` and writes the valid replacement into both existing local-storage caches. |
| Explicit provider/model validation | PASS (local) | `/api/generate` rejects a provider/model combination not configured on the requested provider with `MODEL_PROVIDER_MISMATCH` before generation-batch creation and credit/task persistence. |
| Generation recovery and idempotency regression | PASS (local) | Focused suite: 9 files / 55 tests passed, including progressive polling, recovery lease, idempotency, and resumed-task polling. |
| Full local quality gate | PASS WITH ENVIRONMENT SKIPS | `pnpm ts-check`, `pnpm lint` (0 errors / 949 historical warnings), `pnpm test` (311 files / 1,389 tests passed; 3 PostgreSQL files / 4 tests skipped without `TEST_POSTGRES_URL`), and `pnpm build` passed. |
| Coze browser acceptance | PENDING DEPLOYMENT | Verify that the visible selected model exactly matches the `providerId` and `model` in `/api/generate`; then verify a valid configured request reaches a provider task and a deliberately stale pair is rejected before task creation or charge. |

This gate closes one confirmed application-routing defect. It does not yet classify all future provider failures: a real deployment test must retain the provider response, app task ID, remote task ID, and terminal transition timing before attributing a failure to the provider or to Wujie.

## 2026-08-04 RemoveBG and Layer Artifact Gate

| Check | Result | Evidence |
|---|---|---|
| Dedicated RemoveBG routing | PASS (local) | Dedicated `removebg` providers are kept out of generic image-generation candidates and are invoked through the dedicated adapter. Explicit provider selection has priority and user model authorization is checked. |
| RemoveBG output and billing contract | PASS (local) | Both action aliases use `image_remove_bg`; successful dedicated results return provider/model/engine metadata and persist RGBA plus alpha mask. `ai` and `ai-only` do not silently fall back to CPU. |
| Pear layered artifact handling | PASS (local) | Pear submission requests asynchronous URL results; PSD and ZIP artifacts are accepted; ZIP entry count, path, MIME, decompressed size, PSD signature, primary/depth selection, and legacy persisted URL compatibility are covered. |
| Focused RemoveBG suites | PASS | 3 files / 17 assertions passed. |
| Focused Pear/layer suites | PASS | 5 files / 50 assertions passed. |
| Full regression | PASS WITH ENVIRONMENT SKIPS | `pnpm test`: 320 files / 1,435 tests passed; 3 PostgreSQL-specific files / 4 tests skipped because no isolated PostgreSQL URL is configured. |
| Production build | PASS | `pnpm build`: Next.js 16.2.10 compiled, type checked, generated 112 static pages, and collected all dynamic routes. |
| Cloud browser acceptance | PENDING DEPLOYMENT | Real provider output, alpha quality, Pear ZIP download/extraction/editor opening, PostgreSQL terminal transitions, and billing/refund records require the deployed environment. |

The four task-durability source-order contracts now use branch-scoped whitespace-tolerant matching rather than fixed indentation. They still assert that durable database writes occur before in-memory completion or polling publication; no production task-state logic was relaxed.

---

## 2026-08-05 Acceptance Chain (`7d88625`)

| Check | Result |
|-------|--------|
| `pnpm install --frozen-lockfile` | PASS (restored pruned nested `safe-buffer`; local page returns 200) |
| `pnpm doctor` | 23 passed / 10 environment warnings / 0 failed |
| `pnpm lint` | 0 errors / 951 legacy warnings |
| `pnpm ts-check` | PASS |
| `pnpm test` | 1,479 passed / 4 skipped / 0 failed |
| `pnpm test:api` | 335 passed / 3 skipped / 0 failed |
| `pnpm test:regression` | 1,104 passed / 1 skipped / 0 failed |
| `pnpm build` | PASS |
| Playwright login-entry contract | 8 cases; 6/8 on first run, isolated reruns pass (Chromium flake) |
| Paid P0 E2E | BLOCKED (credentials, paid-generation env, and local DB not configured) |
| Cloud smoke | BLOCKED (preview returns 404 `instance_not_found`) |

## 2026-08-09 Stage 1 Task 8 gate update

| Check | Result | Evidence |
|---|---|---|
| Release-gate contract | PASS | 3/3 tests validate real E2E inputs, manual external CI, and exact source allowlisting. |
| Protected functionality | PASS WITH WARNING | 38/38 protected feature IDs remain; no missing literal component or evidence path. Baseline metadata SHA requires later refresh. |
| Stage 1 E2E discovery | PASS | Chromium, Chromium 1080p, Firefox, and WebKit each discover the non-mocked task/billing journey. |
| PostgreSQL focused suite | BLOCKED | 6 local contract tests pass; 3 authoritative database tests skip explicitly without `POSTGRES_TEST_DATABASE_URL`. |
| Real provider and accounting | NOT EXECUTED | Requires exact deployment SHA, real account, exact provider/model, paid approval, and database ledger access. |

No Stage 1 completion claim is made. The next evidence run must retain the uploaded `playwright-report/` and `test-results/` artifacts.

## 2026-08-09 Stage 1 real PostgreSQL gate

| Check | Result | Evidence |
|---|---|---|
| Doctor PostgreSQL capability probe | PASS | PostgreSQL 18 on loopback port `55432`; connection, DDL, transactions, unique indexes, and advisory locks verified. |
| Core schema completeness | PASS | RED/GREEN test proves `wujie_audit_log` is created before additive migrations. |
| Advisory lock encoding | PASS | Lock identity contains no NUL and distinguishes ambiguous string tuples. |
| Authoritative PostgreSQL suites | PASS | 3 files / 9 tests, including 20-way cold-start idempotency, 20-way paid idempotency, terminal races, one charge, and at-most-one refund. |
| Focused task/billing regression | PASS | 4 files / 77 tests. |
| TypeScript | PASS | `pnpm ts-check`. |
| Changed-file ESLint | PASS WITH HISTORICAL WARNINGS | 0 errors; 5 pre-existing warnings in untouched regions of `db-storage.ts`. |

This closes the local PostgreSQL evidence gap. It does not replace exact-deployment browser, provider, ledger, cancellation, timeout, or rollback evidence.

## 2026-08-10 Durable generation server-kickoff regression

| Check | Result | Evidence |
|---|---|---|
| RED reproduction | PASS | The new suite failed before implementation because no server-owned kickoff existed. |
| Per-slot kickoff | PASS | Unique task IDs are posted independently to the authenticated internal `/api/poll-task` route. |
| Partial kickoff failure isolation | PASS | One failed internal request does not prevent later slots from being awakened. |
| Charge-before-start ordering | PASS | Source contract proves kickoff is scheduled only after every atomic slot charge succeeds; charge failure returns before scheduling. |
| Lease and billing regression | PASS | 11 focused files / 108 tests passed, including recovery lease, terminal persistence, cancellation billing, and batch identity. |
| TypeScript / ESLint / build | PASS | TypeScript passed; ESLint reported 0 errors and 960 historical warnings; Next.js production build passed. |
| Full Vitest | PASS WITH EXPLICIT SKIPS | Full suite exited 0. PostgreSQL suites requiring `POSTGRES_TEST_DATABASE_URL` remained explicitly skipped in this workstation run. |

The browser remains a progress observer and compatibility fallback. It is no longer the required trigger for the first provider submission.

## 2026-08-10 Cloud probe and internal-auth follow-up

| Check | Result | Evidence |
|---|---|---|
| No-browser-poll probe on `9392b50` | FAIL | Paid task `async-1786318164491-0-etn2wk` remained `processing` at progress 0; `updatedAt` did not move and `remoteTaskId` never became a provider task ID. |
| Probe cleanup | PASS | The failed probe was cancelled and its 60 credits were refunded once, restoring the pre-probe balance. |
| Legacy zombie cleanup | PASS | The three known synthetic tasks reached `cancelled/refunded`; balances changed `220 -> 280 -> 340 -> 400`, and a repeated cancel produced no duplicate refund. |
| Root-cause regression | PASS LOCALLY | RED/GREEN test proves `/api/poll-task` accepts a signed internal user without a browser cookie and looks up the durable task under that user. |
| Focused authentication/lease suite | PASS | 6 files / 47 tests. |
| Full Vitest | PASS WITH EXPLICIT SKIPS | Exit 0; authoritative suites requiring `POSTGRES_TEST_DATABASE_URL` were explicitly skipped on this workstation. |
| TypeScript / ESLint | PASS WITH HISTORICAL WARNINGS | TypeScript passed; ESLint reported 0 errors and 960 historical warnings. |
| Production build | PASS | Next.js 16.2.10 production build generated 112 static pages and completed successfully. |

This follow-up is not a cloud pass. The new exact commit must be deployed before repeating the no-browser-poll probe and the progressive paid `n=1/2/3/4` run.

## 2026-08-10 Recovery-backoff follow-up

| Check | Result | Evidence |
|---|---|---|
| No-browser-poll probe on `8bf0e20` | FAIL | Task `async-1786322172707-0-uzo191` stayed `processing` at 0% for more than 31 minutes with 120 credits pending. The selected and actual route both remained PearAPI `gpt-image-2`, so this is an application recovery defect rather than a provider/model mismatch. |
| Deterministic root cause | CONFIRMED | The first authenticated internal poll returned HTTP 200 with `recoveryPending: true`, `reason: recent-update`, and an approximately three-second retry delay. The one-shot helper exited instead of retrying after the durable-task freshness backoff. |
| RED/GREEN regression | PASS LOCALLY | A new fake-timer test requires three internal polls across `recoveryPending -> processing -> completed`; it failed with one call before the repair and passes with three calls after it. |
| Focused generation/cancellation suite | PASS | 5 files / 43 tests passed. |
| Full local gates | PASS WITH DECLARED LIMITS | TypeScript passed; ESLint exited 0 with 960 historical warnings; full Vitest exited 0 with PostgreSQL environment skips declared; production build generated 112 pages. |

This is not deployed acceptance. The paid `8bf0e20` task must first reach a stable cancelled/failed terminal state with exactly one refund, then the new exact commit must prove server-owned `n=1` completion before any larger paid batch is attempted.

## 2026-08-10 Coze cloud generation acceptance

| Check | Result | Evidence |
|---|---|---|
| Stale probe cleanup | PASS | `async-1786322172707-0-uzo191` reached `cancelled/refunded`; 120 credits returned and balance restored to 400. |
| Durable `n=1` without browser poll | PASS | `async-1786328158112-0-c83jkr` returned in 1.016s and completed with one image, `charged/60`, with zero client `/api/poll-task` calls. |
| Canvas `n=2` | PASS | Two unique slots returned in 941ms; both completed with images and independent 60-credit charges. |
| Canvas `n=3` progressive completion | PASS | Three unique slots returned in 814ms. Slots 2 and 3 completed at 10:22:33 and 10:22:36 while slot 1 remained processing until 10:22:45. |
| Canvas `n=4` | PASS | Four unique slots returned in 1.007s; all completed with images and independent 60-credit charges. |
| Chrome admin task monitor | PASS | The real UI showed the `4/4`, `3/4`, `2/4`, and `1/4` rows as completed, attributed to PearAPI `gpt-image-2`, each `charged / 60`. |
| Exact runtime Git SHA | UNVERIFIED | Coze displayed internal snapshot `bb27e1a` and a generic latest-main pull record, but did not print `7baa4f9`; behavior alone is not used as SHA proof. |
| Direct-task credit metadata | PASS | Real Pear `gpt-image-2` task `direct-1786341342235-0-8pta21` completed with one image. Balance delta and transaction were -60; persisted `creditCost` and `billing.cost` were both 60 with charged status. Candidate commit `aa0b1cf`; exact runtime SHA remains unverified. |

Machine-readable evidence: `docs/testing/evidence/stage-1-cloud-generation-2026-08-10.json`.

BUG-051 reconciliation evidence: `docs/testing/evidence/bug-051-cloud-credit-reconciliation-2026-08-10.json`.

## 2026-08-10 three-browser and cancellation checkpoint

| Check | Result | Evidence |
|---|---|---|
| Chromium paid `n=1/2/3/4` | PASS WITH TEST-FLOW CORRECTION | Ten real Pear images reached the canvas and survived refresh. The old test attempted logout directly from canvas; a separate non-paid regression now returns to `工作台` before logout and passes. |
| Firefox paid `n=1/2/3/4` | PASS | Two tests passed; ten images, task terminal states, billing, canvas refresh, workbench return, and logout completed. |
| WebKit paid `n=1/2/3/4` | PASS | Two tests passed; the HTTPS secure-cookie login path and the same paid canvas flow completed. |
| Browser artifacts | PASS | Each browser has a completed Manifest, four request IDs, screenshot, Console log, network log, and task-billing record under `test-results/evidence/runtime-unverified-candidate-aa0b1cf/`. |
| Real cancel and late-result isolation | PASS | Task `async-1786343121430-0-6e583w` charged 60, cancelled twice, refunded once, restored the balance, and remained cancelled after 50 seconds. |
| Ledger transaction linkage | FAIL ON DEPLOYED CANDIDATE; PASS LOCALLY | BUG-052: deployed task/transaction IDs were null. The local SQL fix passes 46 unit tests and an isolated PostgreSQL 18 audit-linkage test. |
