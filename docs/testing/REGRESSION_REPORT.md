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

## 2026-08-10 BUG-052 deployed regression

| Check | Result | Evidence |
|---|---|---|
| Real Chrome submit and cancel | PASS | One new Pear `gpt-image-2-4k` slot was created and its new cancel control was used. |
| Stable terminal state | PASS | `async-1786354360647-0-rhvubs` remained `cancelled` at the final 18:12 CST check. |
| Task billing state | PASS | `creditStatus=refunded`, `creditCost=120`, with non-empty charged/refunded transaction IDs. |
| One charge / one refund | PASS | One -120 consume transaction and one +120 refund transaction matched the IDs persisted on the task. |
| Balance restoration | PASS | 378 -> 258 -> 378. |
| Task correlation | PASS | The refund description contains `async-1786354360647-0-rhvubs`; isolated PostgreSQL coverage separately proves both structured `task_id` and `reference_id` columns. |
| Runtime identity | PASS | Coze runtime `d531ce6` directly parents GitHub `main@32139c5`; the only local delta is the Coze startup environment loader. |

BUG-052 is closed. Timeout-specific deployed behavior and rollback rehearsal remain outside this regression result.

## 2026-08-10 timeout probe attempt 1

The first deterministic timeout attempt did **not** pass the timeout gate. Coze disconnected the delayed external provider before the application timeout. Task `async-1786357844914-0-s1t99g` therefore settled as `failed/refunded`, not `timeout`. Billing remained correct: one -140 charge, one +140 refund, and balance restoration from 238 to 378. The temporary provider was deleted and confirmed absent.

This run is retained as negative evidence and exposed BUG-053: the terminal failed task still displayed a retrying label/error. A valid timeout acceptance still requires a Coze-local delayed provider that keeps the socket open past the application deadline, so the application AbortController owns the timeout transition.

## 2026-08-10 timeout probe attempt 2 and BUG-054

A Coze-local delayed provider kept the upstream connection open long enough to exercise the application deadline. Paid task `async-1786358975492-0-mq23bl` remained `processing/pending` after 666 seconds, retaining 280 credits instead of reaching `timeout/refunded`. Manual cancellation then produced exactly one refund and restored the balance from 98 to 378; the temporary provider was removed.

The failure is reproducible and is not a provider/model mismatch. Recovery requests were each granted a fresh timeout window, with no absolute deadline based on the original durable task creation time. A minimal TDD repair now checks a 10-minute `createdAt` deadline before recovery backoff and lease acquisition, aborts the active execution, and settles through the existing conditional terminal/refund path.

Local verification passes: focused deadline tests 19/19, broader task suite 7 files / 100 tests, TypeScript, ESLint with 0 errors and 960 historical warnings, full Vitest, and the 112-page production build. This remains **pending deployed acceptance**; the cloud must prove automatic `timeout/refunded`, one charge/one refund, and no late completion.

## 2026-08-10 BUG-054 deployed timeout acceptance

| Check | Result | Evidence |
|---|---|---|
| Fast wrapper response | PASS | The paid durable slot returned in 1.219s with task `async-1786366442668-0-dzxu9y`; the client did not wait for the provider response. |
| Absolute deadline | PASS | The task changed from `processing/pending` to `timeout/refunded` at 602.934s from its original durable `createdAt`. |
| One-time billing | PASS | Balance `378 -> 238 -> 378`; exactly one -140 consume and one +140 refund matched the transaction IDs stored on the task. |
| Late-result isolation | PASS | The provider's delayed body was scheduled after 900s. At 1132.6s and after a Coze sandbox restart, the task remained `timeout/refunded`, `updatedAt` was unchanged, and the ledger still contained two related rows. |
| Cleanup | PASS | Temporary provider `api_1786366406082_izjuy5a` was deleted and confirmed absent; the local heartbeat server and public tunnel were stopped. |
| Runtime SHA | UNVERIFIED | GitHub candidate is `104b140`; the user confirmed the latest pull, but Coze did not expose an independently verifiable runtime SHA in this run. |
| Residual label state | OPEN P2 | BUG-053 persists: the terminal timeout row retained the retrying label although status, error, refund, and balance were correct. |

Machine-readable evidence: `docs/testing/evidence/bug-054-cloud-timeout-acceptance-2026-08-10.json`.

## 2026-08-10 Stage 1 core-v2 to legacy rollback rehearsal

| Check | Result | Evidence |
|---|---|---|
| Runtime provenance | PASS | Cloud `HEAD=413cb46d29083a17cc2b9a29d3fedf5c31cf131d`; read-only fetch resolved `origin/main=104b140ed8189d22e14330dae78b17b3abb200c5`. The only non-`.env` diff was the known Coze launcher change in `scripts/coze-start.sh`; business source matches GitHub main. |
| Core-v2 admission | PASS | Tasks `agent-1786370677352-kjnqfj` and `agent-1786371202567-z7urgq` persisted `mode=core-v2` and `handlerVersion=task-core-v2`. |
| Rollback operation | PASS | Only `.env` changed from `core-v2` to `legacy`; no checkout, pull, business-source edit, data migration, or stable-branch operation occurred. Preview restarted as PID 2227 and returned HTTP 200. |
| Legacy admission after rollback | PASS | Task `agent-1786371761478-elb9d1` persisted `mode=legacy` and `handlerVersion=legacy`. |
| Old-task compatibility | PASS | Both core-v2 tasks remained readable with identical IDs, terminal states, handler versions, charge IDs, refund IDs, and revisions after rollback. |
| Billing consistency | PASS | Each of three probes produced one -12 consume and one +12 refund. Balance remained `378`; no duplicate charge or refund appeared. |
| Data safety | PASS | No task migration was performed. Existing rows were interpreted from their saved `handlerVersion`; no task was duplicated or rewritten. |

The upstream APImartLLM model returned 500 for all three minimal probes. That provider outcome is not counted as a successful content-generation result, but it is sufficient for the rollback boundary because both execution modes reached durable terminal settlement and exact one-time refund. BUG-053 remains open at P2 for stale retry wording on terminal rows.

Machine-readable evidence: `docs/testing/evidence/stage-1-core-v2-legacy-rollback-2026-08-10.json`.

## 2026-08-11 Stage 2 Checkpoint B cloud reproduction

Three transfer directions passed in Coze `shadow`: Canvas to embedded chat, Canvas to workflow, and workflow output to Canvas. The fourth direction, standalone chat to a selected Canvas, created exactly one database placement but failed media rendering.

The provider response contained a valid origin-relative image URL. The application failed to resolve it before persistence, then stored the raw path as a ready AssetVersion. A focused RED test reproduced the parser defect; the minimal fix resolves direct image URLs against `Response.url`. Fresh gates pass: compatibility 16/16, related 60/60, Task 6 57/57, Task 5 64/64, Task 4 108/108, TypeScript, full Vitest, protected baseline 38/38, ESLint 0 errors / 957 warnings, and the 114-page production build.

This is **local candidate evidence only**. Checkpoint B remains open until the exact commit is deployed and Chrome proves that a new standalone-chat result renders in the target Canvas. BUG-056 and BUG-057 remain open. Six PostgreSQL integration groups were skipped because `POSTGRES_TEST_DATABASE_URL` is not configured.

## 2026-08-11 Stage 2 Checkpoint B cloud closure

The candidate is now proven in Coze `shadow`. Runtime commit `ff0242e2` directly parents GitHub `main@846c0c4e`; the only runtime delta is the established Coze launcher adapter. A fresh real Gpt Image 2 result persisted to `/api/serve-upload/uploads/gen-1786455914641-nimwmk.png` and visibly rendered in the selected Canvas.

The generated AssetVersion is `ready` with `image/png`. The target project contains one `canvas-image` placement for that version after two Add-to-Canvas clicks, proving idempotent retry. Together with the three previously passed directions, all four Checkpoint B transfer paths pass. BUG-055 is closed; BUG-056 and BUG-057 remain open. Machine-readable evidence: `docs/testing/evidence/stage-2-checkpoint-b-cloud-2026-08-11.json`.

## 2026-08-11 Stage 2 Task 7 local closure

Commit `12a9026eaf35e60410f775ae59f10c5d7eabe769` implements completed-task projection to immutable asset versions across image, edit, Agent, annotation, video, 3D, workflow, embedded chat, and standalone chat completion boundaries. Replays reuse existing versions; non-completed and late results cannot create active placements; projection write failures retain the completed task and record retryable `projection_pending` audit state.

The extended Task 7 suite passed `84` tests and skipped `4` PostgreSQL-only tests. The final 3D/workflow security set passed `23/23`; `pnpm ts-check`, full `pnpm test`, full ESLint (`0 errors / 957 historical warnings`), the `114/114` production build, and the protected baseline (`38/38`, zero warnings) all exited successfully. Independent review R6 returned `APPROVED` with no findings.

The four skipped PostgreSQL tests remain **UNVERIFIED**, not passed, because `POSTGRES_TEST_DATABASE_URL` is unavailable. Coze `shadow` deployment and real completed-task projection evidence are also pending. `asset-v3` remains disabled.

## 2026-08-12 Stage 2 Task 8 local closure

Task 8 adds placement-aware trash/restore, media-health recovery, orphan dry-run governance, and compatibility wiring for the existing administrator recovery route. Shared assets remain active while another active placement exists; the final placement may trash the asset, but physical S3/local purge is explicitly disabled.

The final focused command covered lifecycle rules, recovery governance, Canvas batch deletion, authorization, the administrator route contract, and five PostgreSQL concurrency bodies. Result: `72 passed / 5 skipped`; all five skips are caused by the missing isolated PostgreSQL URL and remain UNVERIFIED. Fresh repository gates also passed: `pnpm ts-check`, full `pnpm test` (`2074 passed / 35 environment-skipped`), full ESLint (`0 errors / 957 historical warnings`), production build, protected baseline (`38/38`, zero warnings), and `git diff --check`.

Review waves reproduced and closed exact-path cross-match, stale candidate, lock-order, partial batch-delete, recovery-attempt, bounded serialization-retry, terminal purge fail-open facts, batch path traversal, and GET mutation defects. After `90cad2e`, final whole-branch re-review returned `APPROVED` with Critical/Important/Minor `0/0/0`. No code was pushed and no cloud action or physical deletion was performed because Checkpoint C requires real PostgreSQL evidence.

An isolated local PostgreSQL 18 cluster subsequently executed the previously skipped Task 8 lifecycle suite: `5/5` passed. The first PostgreSQL-enabled whole-repository run found one Task 7 isolation failure because the cloud-task table initialization Promise outlived a dropped test schema. The failure reproduced independently as `1 passed / 1 failed`; `c563efd` binds initialization caching to the active database/search-path connection string. Focused GREEN was `59/59`, and the second PostgreSQL-enabled whole-repository run passed `2105` tests with four separate `TEST_POSTGRES_URL` suites skipped. No Task 7-8 or S1 billing/state/rollback PostgreSQL test remained skipped.

## 2026-08-12 Stage 2 Checkpoint C cloud reproduction and local candidate

Coze `shadow` on GitHub `main@f8bb57c` completed a real Pear `gpt-image-2-4k` generation, but database inspection disproved lifecycle correctness. The Canvas request omitted `projectId`, no matching project cloud task existed, and shadow synchronization created separate legacy graph identities for the processing placeholder and completed result. Delete persisted after reload and physical purge remained disabled, but media recovery stayed durably `recovering`.

BUG-063 was reproduced with source and database evidence, then repaired with TDD. The Canvas request now carries the effective project, direct and asynchronous results use projector-compatible `${taskId}:${outputIndex}` identities, processing placeholders are excluded from the graph, autosave adopts an existing task projection, every Canvas delete entry point uses placement-first deletion, and shared graph rows use consistent version-before-placement locks. The focused affected regression passes `48/48`; `pnpm ts-check` passes. Full Vitest, ESLint, build, and protected-baseline results must be freshly appended before push.

This is local candidate evidence only. **Checkpoint C remains NOT PASSED** until the exact candidate is deployed in `shadow` and a fresh real generation proves one project-owned task, one authoritative version, one placement, idempotent autosave, and persistent delete. BUG-064 remains open because recovery has not reached `ready` or a terminal failure. Evidence: `docs/testing/evidence/stage-2-checkpoint-c-cloud-reproduction-2026-08-12.json`.

Final candidate gates on 2026-08-12: affected Canvas/asset regression `51/51`; TypeScript passed; ESLint completed with `0 errors / 957 historical warnings`; full Vitest `2083 passed / 35 environment-skipped / 0 failed` (`2118` total); production build generated `116/116` pages; protected baseline retained `38/38` feature IDs with no unapproved source drift; `git diff --check` passed. The 35 skipped tests include the current-candidate Stage 2 PostgreSQL projection/lifecycle and billing concurrency bodies because `POSTGRES_TEST_DATABASE_URL` is not configured, so they remain explicitly unverified.

## 2026-08-12 BUG-064 durable media recovery local closure

The repaired recovery path now admits one owner/project/asset/version/placement-scoped attempt, executes the worker through Next.js `after()`, and polls the database-authoritative terminal. PostgreSQL leases serialize concurrent requests, expired workers are fenced, and a result cannot overwrite a newer current version. Recovered bytes are published under an attempt-isolated `/api/serve-upload/recovery/{version}/{attempt}.{ext}` URL and are resolved only through the exact database URL and storage key or exact durable local path. Every read validates size, raster MIME signature, and SHA-256; recovery misses cannot fall through to basename, source-map, or unrelated local-file guessing.

The final PostgreSQL-enabled full run passed `402/402` test files and `2160/2160` tests with zero failures and zero skips. TypeScript passed; ESLint returned `0 errors / 957 historical warnings`; production build compiled and generated `116/116` pages; protected baseline retained `38/38` feature IDs; `git diff --check` passed. Independent final review returned `APPROVED` with no P0/P1/P2 findings. The earlier JSON-reporter run terminated before writing a report and was not counted; the diagnostic rerun with four workers completed successfully and retained its log under untracked `output/`.

This is local evidence only. Coze remains on `main@4bbe6db` until the candidate is pushed and pulled. **Checkpoint C remains NOT PASSED** until one real cloud generation, authoritative projection, delete/reload, and missing-media recovery reach a verified terminal in `shadow`. Task 9, `asset-v3`, and physical purge remain disabled.
## 2026-08-12 Stage 2 Checkpoint C cloud closure

Coze pulled GitHub `main@1344dec33f93fc9d8a19baeaf9ed251c28176f5f`; runtime commit `6965f28ceb57650af0f87f10d6509603949f0eff` differs only by the existing `scripts/coze-start.sh` deployment adaptation. Runtime gates remained `WUJIE_ASSET_GRAPH_MODE=shadow`, `WUJIE_TASK_CORE_MODE=legacy`, persistent root `/space/wujie-data`, and physical purge disabled. Authenticated Chrome recovered the known missing asset, rendered it, and retained it after reload. Database verification confirmed one succeeded attempt, one artifact, one active placement, zero GC candidates, and a ready current version. **Checkpoint C: PASS.** Task 9 is now the only permitted Stage 2 task; Tasks 1-8 must not be repeated.

## 2026-08-13 Stage 2 Task 9 local matrix and release gates

- Coze reported pull baseline `4bbe6db`; a fresh remote fetch shows GitHub `origin/main@1344dec`, with `4bbe6db` as its ancestor. The Task 9 branch is based on `1344dec`; no remote commit was overwritten and `stable` was not touched.
- The first shared-account multi-project run exposed test-fixture contamination: opening one browser profile allowed background project synchronization to consume another profile's copy-on-write fixture. Re-seeding a fresh run-owned user/project set for each browser removed the contamination without changing product behavior.
- Real production-server Playwright results: Chromium `10/10`, Chromium 1920x1080 `10/10`, Firefox `10/10`, WebKit `10/10`, mobile Chromium `10/10`; total `50/50`. The two specs cover legacy read-only open, first copy-on-write save, real image upload, placement trash/restore, missing-media recovery, reload recovery, embedded chat, workflow return, standalone chat transfer, and shared-reference deletion isolation.
- Task 9 browser testing reproduced and closed BUG-065, BUG-066, and BUG-067 with RED/GREEN tests. Failure artifacts include screenshot, video, trace, Console, network, request IDs, and task records under `test-results/evidence/`.
- Real PostgreSQL full run: `410` test files passed, `2258` tests passed, `3` files / `4` tests skipped under separate legacy `TEST_POSTGRES_URL` gates. Stage 2 storage/lifecycle/projection/billing tests, including concurrent restore collision, executed against isolated PostgreSQL and passed.
- Fresh gates: API and regression suites passed; ESLint `0 errors / 959 historical warnings`; TypeScript passed; Doctor exit `0`; production build exit `0` with `116` application routes; `git diff --check` passed.
- This is local `shadow` candidate evidence. Controlled cloud `asset-v3` switch and rollback to `legacy` remain unexecuted, so Stage 2 is not complete and no release-pass claim is made.

## 2026-08-13 Stage 2 Task 9 final candidate rerun

- Coze has confirmed its current pull at `4bbe6db`; that SHA is an ancestor of both the Task 9 candidate and `origin/main@1344dec`. It is a cloud baseline, not the final candidate SHA.
- Final review found and closed BUG-068, BUG-069, and BUG-070: standalone generation now receives its real placement identity, bridge consumption is idempotent, and managed Canvas delete/restore updates graph, legacy snapshot, and project revision transactionally. A lost-response retry returns the original delete revision even after another session advances the project.
- The post-fix focused unit/API/PostgreSQL suite passed `48/48`; the full PostgreSQL-enabled `pnpm test` completed with exit `0`; `pnpm test:api` and `pnpm test:regression` also completed with exit `0`.
- A first browser rerun was intentionally rejected because the local production server omitted `WUJIE_ASSET_GRAPH_MODE=shadow`: legacy saves returned HTTP 200 but correctly lacked `assetGraphUpdates`. After restarting the same build with `shadow`, task core `legacy`, and physical purge disabled, no business-code change was needed.
- Each browser then received a newly seeded user/project set. Chromium, 1920x1080 Chromium, Firefox, WebKit, and mobile Chromium each passed `10/10`, total `50/50`. The shared-user fixture attempt that consumed another profile's copy-on-write fixture is retained as invalid test-environment evidence and is not counted as a product failure or pass.
- Evidence audit found `108` recent manifests and `0` missing screenshot/video/trace/Console/network/task files. `playwright-report/index.html` was regenerated by the final mobile run.
- Final gates: Doctor exit `0`; ESLint `0 errors / 959 warnings`; TypeScript exit `0`; protected baseline `38/38` with no unapproved source drift; production build exit `0` with `116` application routes; `git diff --check` passes. Independent final review is `APPROVED` with no Critical, Important, or Minor findings.
- Verdict remains **CONDITIONAL**: this candidate may be pushed to `main` only. Coze must pull the exact new SHA in `shadow`, complete the cloud comparison, then perform the controlled test-only `asset-v3` switch and prove rollback to `legacy`. `stable` and physical purge remain untouched.

The verified implementation was subsequently fast-forward pushed to `main@644a0809658d500d9e3815c14771dd10581f0998` from `1344dec33f93fc9d8a19baeaf9ed251c28176f5f`. Remote `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged. This push does not close the cloud gates; Coze must now pull the current main tip and provide exact-SHA `shadow` evidence.

## 2026-08-13 BUG-071 asset-v3 history lifecycle regression

- Coze on base `3bd2850` proved managed delete succeeded but Ctrl+Z did not restore the image. The environment was rolled back to `legacy` without changing the original identity tuple.
- TDD added lifecycle compensation, snapshot commitment, restored-ID suppression cleanup, and a real browser scenario covering delete, undo, redo, second undo, identity lookup, and reload.
- The first local browser attempt failed at login with HTTP 503 because the isolated production server omitted `WUJIE_ADMIN_PASSWORD`; this was a fixture configuration failure and remains retained.
- The first five-profile run passed four profiles but failed Firefox after reload. Network evidence proved restore and identity GET succeeded before a stale snapshot removed the placement. Binding the post-history snapshot to the lifecycle transition closed that race.
- Final focused tests pass `11/11`; Chromium, Chromium 1080p, Firefox, WebKit, and mobile Chromium pass `5/5`. The final PostgreSQL-enabled full regression passes `413/413` files and `2273/2273` tests with zero failures or skips. Production build generates `116/116` routes.

## 2026-08-13 Stage 2 Task 9 cloud closure

- Source candidate: GitHub `main@81fe303e73ba2f50d2ca0a6ed7201c5977758231`. Coze retained only its deployment adapter/change-card lineage; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` was not changed.
- Authenticated Chrome passed the controlled `asset-v3` lifecycle on project `project_1786500304299_8vix1z45f`: delete removed the image, Ctrl+Z restored it, Ctrl+Shift+Z removed it again, a second Ctrl+Z restored it, and reload preserved the 800x534 Pear image.
- PostgreSQL identity after reload: asset `559c7f48-04f1-544e-8ec5-3c23ba4fb975`, ready version `66621b79-77c2-561f-966f-0c9870ba168a`, Canvas placement `696446c1-3278-5548-9427-3290ca3ea1a5` active. One chat-attachment and one workflow-input placement remained active on the same asset/version.
- Exact-candidate `shadow` comparison matched the compatibility projection: 5 legacy projects, one Canvas image in the controlled project, three active cross-workspace placements, zero owner/project mismatch, zero non-ready active reference, and zero GC candidates.
- Rollback was proven after both controlled modes. Final Coze runtime is `legacy` asset mode, `legacy` task core, physical purge disabled; `/` and `/api/auth/me` return 200 and the project image remains visible without a new login prompt.
- **Stage 2 Task 9: PASS. Stage 2: COMPLETE.** This conclusion is limited to the Stage 2 asset/version graph and does not mark later Canvas, node/Agent, business-tool, administrator, user, payment, or whole-platform work complete.

## 2026-08-13 Stage 3 Task 4 selection and gesture regression

- TDD introduced a pure Canvas selection controller plus React adapter. Focused selection, wiring, group-gesture and image-drag contracts pass `34/34` after independent review closed touch jitter, group-cancel and Ctrl/Meta routing regressions.
- The fresh whole-repository rerun passes `411/411` executed test files and `2291/2291` executed tests. Twelve PostgreSQL-gated files containing 44 tests remain explicitly skipped because `POSTGRES_TEST_DATABASE_URL` is not configured. ESLint reports `0 errors / 966 historical warnings`.
- Local production Chromium Task 4 acceptance passes `3/3`: exact single/reverse-box selection, pointercancel rollback without persistence, and image drag with zoom/reset/reload persistence.
- After a clean 15-project reseed, the complete Stage 3 Chromium spec passes `5/6`. One-node persistence, delete/undo/redo and 100-node pan pass. The 300-node run fails only the fixed input P95 gate: `50.2ms` versus `<=50ms` (preceding runs `56.8ms` and `62.8ms`); FPS is `57.18`, disappeared frames `0`, unclickable time `0`.
- Fresh supporting gates: TypeScript exit `0`; full Vitest `411` files / `2288` passed / `44` skipped; ESLint `0 errors / 966 historical warnings`; production build `116/116`; `git diff --check` exit `0`. The `12` skipped files are PostgreSQL-gated and are not counted as passes.
- The protected-feature gate confirms `38/38` feature identities, source paths and evidence contracts are present. It still blocks Stage 3 production-source drift because the current allowlist/baseline update is scheduled later in the approved plan; this is not represented as a clean release gate.
- **Task 4 verdict: PASS LOCALLY FOR ITS FUNCTIONAL SCOPE. Stage 3 verdict: NOT COMPLETE.** Task 5 is next and not started; S3-BUG-004, external browser profiles, exact-SHA cloud validation and rollback remain open.

## 2026-08-13 Stage 3 Task 5 command and history regression

- TDD introduced immutable Canvas commands, a 50-step controller, explicit pointer transactions, history-skip task projection, placement-aware delete/restore, and exact reorder/group inverses.
- Five independent review waves reproduced and closed queue conflict loss, concurrent membership rebase, processing-node geometry filtering, first generation-group drag drift, cross-project queued edits and late in-flight undo/redo contamination.
- Focused final regression: `9` files, `56/56` tests. TypeScript passes. PostgreSQL-enabled full Vitest: `428/428` files and `2374/2374` tests, zero failures and zero skips.
- Fresh production Chromium Task 5 E2E passes `3/3`: delete/undo/redo, batch delete as one step with layer-order restoration, and move/resize as one step each.
- Final-build full Chromium remains `7/8`. The only failure is S3-BUG-004: 300-node input P95 `52.3ms` versus the fixed `<=50ms` gate after an earlier `72.5ms` run; disappeared frames `0`, unclickable duration `0`. No threshold was changed.
- Protected features remain `38/38`, but the release gate intentionally blocks `24` accumulated Stage 3 source drifts until the later approved baseline task.
- **Task 5 verdict: PASS LOCALLY FOR ITS FUNCTIONAL SCOPE. Stage 3 verdict: NOT COMPLETE.** Task 6 has not started.

## 2026-08-13 Stage 3 Task 6 task projection regression

- A single pure projector now maps task events to Canvas commands. Workspace SSE/poll/recovery and infinite-Canvas completion no longer retain separate state-writing authority; provider submission and billing paths were not changed.
- Focused regression passes `48/48`, covering n=1/2/3/4, resumed terminal events without revision, duplicate/late events, stale server placeholders, ordinary-image isolation, media readiness and stable task-slot order.
- The production Chromium `n=4` scenario passes `1/1`: completion arrives `3,1,4,2`, visible slot order remains `1,2,3,4`, no status-card duplicate remains, and project sync plus reload preserves four real PNG results.
- Fresh full Vitest: `430` files total, `418` passed and `12` environment-skipped; `2351` tests passed and `44` skipped, with zero failures. TypeScript, ESLint and `git diff --check` exit 0; production build generates `116/116` routes.
- After reseeding all 15 controlled projects, the complete Stage 3 Chromium suite is `7/8`; the only failure is S3-BUG-004 at 300 nodes, input P95 `87.8ms` versus `<=50ms`. The threshold and assertions remain unchanged. A preceding reused-fixture run is retained but excluded from product status.
- Protected-feature evidence remains `38/38`, but the gate blocks `27` accumulated Stage 3 source drifts pending the later ordered baseline task. **Task 6 passes locally for its functional scope; Stage 3 remains incomplete. Task 7 has not started.**

## 2026-08-13 Stage 3 Task 7 persistence regression

- TDD added a persistence scheduler and permanent contracts for latest-wins batching, single-flight writes, project cancellation epochs, signature deduplication, retry, pending media, immediate-task yielding and prepared-only unload handling. Focused regression passes `35/35`.
- PostgreSQL-enabled full Vitest exits `0`. TypeScript, error-only ESLint, full ESLint (`0 errors / 966 historical warnings`), whitespace checks and the production build (`116/116`) pass.
- Fresh production Chromium runs the save/refresh grep `2/2`. The 300-node case records average `56.79 FPS`, input P95 `21.8ms`, longest task `90ms`, longest save task `0ms`, zero disappeared frames and zero unclickable time. Durable coordinates, dimensions, z-order and processing state match after refresh.
- The protection gate retains `38/38` protected feature identities, paths and contracts. It intentionally blocks `29` accumulated Stage 3 source drifts pending the ordered approval task.
- **Task 7 verdict: PASS LOCALLY FOR ITS FUNCTIONAL SCOPE. Stage 3 verdict: NOT COMPLETE.** S3-BUG-004's full 300-node pan/input gate, external browser matrix, cloud exact-SHA and rollback remain open; Task 8 has not started.

## 2026-08-13 Stage 3 Task 8 tool-session regression

- TDD added permanent contracts for registry completeness, duplicate IDs, entry-point authorization, source locking, no-selection rejection, close events, host interaction boundaries, placement classes and Infinite Canvas wiring. Focused regression passes `32/32`.
- A fresh production server executed the mutually exclusive session flow in all configured profiles: Chromium, Chromium 1920x1080, Firefox, WebKit and mobile Chromium pass `5/5`. The flow opens Agent by shortcut, replaces it with brand ecommerce, closes by Escape, opens erase on a selected image, then verifies ChatCanvas prompt interaction and Escape cleanup.
- Firefox consistently did not decode the historical 155-byte Stage 3 PNG although the media endpoint returned HTTP 200, `image/png`, 155 bytes and the Canvas card remained visible. This tool-session test therefore asserts stable card visibility, not media decoding; the limitation is retained in `UNVERIFIED_ITEMS.md` rather than counted as a media pass.
- PostgreSQL-enabled full Vitest exits `0`. API regression is `477/477`; its three separately keyed element-board/Pear PostgreSQL concurrency tests pass `3/3`; component/lib regression is `1759/1759`. TypeScript, `git diff --check` and the `116/116` production build pass; ESLint reports `0 errors / 966 historical warnings`; Doctor reports `43/11/0/0`.
- All `38/38` protected feature identities remain. The default gate intentionally blocks `32` accumulated Stage 3 source drifts; the exact reviewed 32-path scope gate passes with one historical commit warning. No baseline was silently rewritten.
- **Task 8 verdict: PASS LOCALLY FOR ITS FUNCTIONAL SCOPE. Stage 3 verdict: NOT COMPLETE.** Progress is `9/11`, approximately `82%`. Task 9 has not started; S3-BUG-004, the full Stage 3 external-browser matrix, cloud exact-SHA and rollback remain open.

## 2026-08-14 Stage 3 Task 9 component-boundary regression

- TDD added source contracts for workspace effect ownership, render-only `CanvasSurface`, session-only `CanvasToolHost`, protected-panel reachability and Canvas lifecycle teardown. Initial RED was `3 failed / 2 passed`; a second RED captured the anonymous wheel-listener leak.
- `CanvasWorkspace` now injects the shared task-poll transport. Nine existing poll paths retain their request payload, response parsing, cancellation signal and terminal behavior while `InfiniteCanvas` no longer directly calls `/api/poll-task`.
- The erase/mask editor wheel listener now has stable attach/detach identity. Unmount aborts tracked annotation/generation requests, clears intervals/timers, cancels RAFs and releases pointer capture.
- Focused boundary plus Canvas command/session/selection/viewport/cancellation regression passes `58/58`. Fresh full Vitest passes `422` files and `2376` executed tests with `12` files / `44` tests explicitly environment-skipped; separately enabled PostgreSQL suites pass `46/46` plus `4/4`.
- TypeScript and production build pass. Full ESLint reports `0 errors / 965 historical warnings`, one fewer warning than Task 8, and `git diff --check` passes.
- **Task 9 verdict: PASS LOCALLY FOR ITS FUNCTIONAL SCOPE. Stage 3 verdict: NOT COMPLETE.** Progress is `10/11`, approximately `91%`. Task 10 has not started; S3-BUG-004, full five-browser Stage 3 coverage, cloud exact-SHA and rollback remain open.

## 2026-08-14 Stage 3 Task 10 local and browser gate regression

- Controlled fixture audit confirms `15` unique isolated projects: five profiles each with exact `1`, `100` and `300` node projects, with zero foreign run IDs.
- The fresh production legacy matrix passes `60/60`. Shadow and canvas-v2 representative matrices each pass `15/15`; their JUnit output reports zero failures and errors.
- Desktop Chromium performance closes S3-BUG-004 without changing thresholds: 1280x720 at 300 nodes is `54.62 FPS / 34.3ms P95`; 1920x1080 is `55.31 FPS / 21.6ms P95`. Both have zero disappeared frames and zero unclickable time.
- TDD retained failures for resize pointer capture, button-focused WebKit undo and the protected-endpoint CI startup probe. Focused Canvas contracts pass `39/39`, WebKit repeat passes `10/10`, and workflow/release contracts pass `15/15` after minimal fixes.
- The evidence fixture now writes screenshot, video, trace, console, network and JSON metrics in mode/run/browser/test/retry/repeat-specific directories. Runtime console/page errors and non-benign network failures fail otherwise passing tests.
- Fresh local gates exited 0: Doctor, TypeScript, ESLint (`0 errors / 965 historical warnings`), PostgreSQL-enabled full Vitest, API (`110 files / 480 tests`), component/lib regression, production build (`116/116`), YAML parse and `git diff --check`.
- **Task 10 local verdict: PASS. Stage 3 verdict: NOT COMPLETE.** The controlled local database has no provider configuration, so real paid generation/billing/refund cannot be claimed. Main push, GitHub Actions, Coze exact-SHA shadow, isolated canvas-v2 and mandatory legacy rollback remain open.

## 2026-08-14 Stage 3 Task 10 independent-review hardening

- Independent review first found a cross-user emergency-snapshot risk, stale server revision recovery, blob layout rollback, resize immediate-save omission, a permanently hung audit queue, and evidence that could be attributed to a dirty `HEAD` without a content fingerprint. All P0/P1 findings were reproduced with failing tests before repair.
- Snapshot v3 now binds owner and server project revision. Logout clears recovery records. Pending data URLs remain recoverable; blob URLs use a durable server URL while retaining the newest recovered geometry. Resize commits enter the immediate persistence path.
- `beforeunload` now protects pending media before any storage write. Ordinary snapshots attempt local recovery and beacon independently; either channel is sufficient, and a double failure triggers the browser leave guard instead of being swallowed.
- Small audit records start immediately and use navigation-safe beacon delivery with bounded-fetch fallback; large records remain response-aware and time-bounded. This removed the retained Chromium/mobile `/api/user-data/record net::ERR_ABORTED` evidence. Application-level beacon receipts remain an explicit P2 limitation.
- Quick-create model loading now uses a stable authorization signature. The retained WebKit RED contained two model-request access-control page errors; the exact rerun passes `1/1` with zero evidence-gate error.
- Evidence identity now includes a dirty-worktree content fingerprint, including untracked file content. Every passing attempt requires its own screenshot, video, trace, Console and network artifacts.
- Focused hardening regression currently passes `9` files / `88` tests. Production browser evidence after the hardening includes the five-profile move/resize/undo/redo/immediate-reload flow `5/5`, final WebKit merge-window `1/1`, and final Chromium immediate-reload `1/1`.
- Retained environment failure: the first rebuilt local server omitted `WUJIE_ADMIN_PASSWORD` and login returned 503. The same source passed after the required production variable was supplied; this is recorded as environment evidence, not a product pass or product defect.
- The first final full run correctly failed `1` authentication-bootstrap source contract after the recovery-aware `storedProject -> targetProject` split. Runtime workflow hydration was present; S3-TEST-002 updated the contract to protect ordering rather than the old local variable shape. Focused rerun is `11/11`, and the same PostgreSQL-enabled full command then exits `0`.
- Fresh post-review gates: Doctor `43/11/0/0`; TypeScript; ESLint `0 errors / 965 historical warnings`; PostgreSQL-enabled full Vitest exit `0`; API `110 files / 480 tests`; component/lib regression exit `0`; production build `116/116`; YAML parse, exact Stage 3 allowlist, stable SHA and whitespace checks pass.
- **Verdict remains CONDITIONAL / Stage 3 not complete.** P0/P1 are zero locally. Open P2 items are audit application-level receipt and cross-session authorization refresh. Exact committed-source browser evidence, GitHub Actions, Coze provider/billing evidence and `shadow -> canvas-v2 -> legacy` remain required.

## 2026-08-14 Stage 3 immutable-main representative evidence

- The protected-path bootstrap was fast-forwarded first as `d9fde3a0f36b7ca8532591e8b098e4dfb1ac40f6`; the complete Stage 3 candidate then passed the trusted-parent gate and reached `main@e61bdedb9443d8b2ee164539ed21ed48bf0b4b90`. Remote `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged.
- The first exact-build browser attempt returned login HTTP 503 because the local test secret was shorter than the production-required 32 characters. The API error body identified the configuration fault; no Canvas assertion ran and the failure evidence remains retained.
- After correcting only the isolated test environment, four tests finished their browser work but the runner reached the 300-second outer limit. S3-TEST-003 reproduced a video teardown deadlock. TDD RED was `1 failed / 9 passed`; the minimal context-close ordering fix passes `10/10` and the Stage 3 focused set passes `100/100`.
- The evidence fix was fast-forwarded to `main@afa65eb103bd8fa08d669d4680d068d2c565d341`. A clean production build from that exact commit passed the Chromium and WebKit merge-window plus move/resize/undo/redo/immediate-reload representative set `4/4` in 35.1 seconds.
- Immutable evidence is under `test-results/stage-3-baseline/evidence/afa65eb103bd8fa08d669d4680d068d2c565d341/legacy/task10-e61bded-20260814/afa65eb-immutable-representative/`. Every test contains `final.png`, `video.webm`, `trace.zip`, `console.json` and `network.json`; geometry tests also contain both metrics JSON files.
- There are zero Console errors/page errors and zero non-benign network failures. Each test records one existing data-isolation cleanup warning; network files contain only permitted page-close aborts for `/api/task-events` and, in one Chromium case, `/api/activity`. These observations are retained instead of being reported as empty logs.
- **Local immutable-main verdict: PASS. Stage 3 verdict: NOT COMPLETE.** GitHub Actions, Coze exact-SHA `shadow`, isolated `canvas-v2`, real provider/billing checks and mandatory return to `legacy` remain unverified.

## 2026-08-14 Stage 3 CI gate repair regression

- The first GitHub run for `afa65eb` supplied useful RED evidence: PostgreSQL concurrency passed, while the Stage 3 browser job stopped at `wujie_users` before browser startup and the static job stopped on `6 moderate / 15 high` production advisories. The real-P0 browser job separately reported missing required secrets and remains an external blocker.
- S3-TEST-004 locks the workflow order as build -> start canonical production schema -> seed. A new isolated PostgreSQL database then seeded one user and 15 mode/profile projects and passed the two representative Chromium cases `2/2`.
- The production dependency contract passes `4/4` and verifies both patched versions and the narrow `pptxgenjs@4.0.1` hook. A generated presentation has a valid ZIP signature and non-empty payload. `pnpm audit --prod` now returns zero at every severity.
- Sharp 0.35 required type-only `Metadata` and `OverlayOptions` imports. Focused layer/upscale regression passes `18/18`; the production build remains `116/116` routes.
- Fresh candidate gates: TypeScript exit 0; ESLint exit 0; API `110/110` files and `480/480` tests; full Vitest exit 0; frozen install, YAML and whitespace checks pass.
- **Verdict: PASS LOCALLY FOR THE CI REPAIR CANDIDATE / STAGE 3 NOT COMPLETE.** A trusted-parent allowlist bootstrap, immutable GitHub Actions rerun, repository secret configuration and Coze three-mode/provider/billing evidence remain required.

## 2026-08-14 Stage 3 immutable CI follow-up

- On `main@0ac9068`, protected baseline, Stage 1, PostgreSQL concurrency and the complete static/tests/API/production-audit/build path pass. This closes S3-SEC-001 on immutable main.
- Legacy failed during seed because the table existed before background migration added `product_type`. Shadow and canvas-v2 seeded but each failed all 60 cases at login HTTP 503 because the generated auth secret was 28 characters. No Canvas behavior assertion executed in those failures.
- S3-TEST-004 now waits for exact seed-required columns instead of HTTP timing. Unit RED/GREEN is `3 failed / 14 passed -> 17/17`; real PostgreSQL delayed-column evidence waited 566ms.
- S3-TEST-005 permanently renders the Stage 3 job's minimum secret and requires at least 32 characters. Correctly scoped RED was `expected 18 >= 32`; combined fixture/release GREEN is `29/29` and YAML parses.
- **Verdict: LOCAL REPAIR PASS / IMMUTABLE CI RERUN REQUIRED.** Real P0 remains externally blocked by repository Secrets; Coze three-mode and billing evidence remain open.

## 2026-08-14 Stage 3 `c381d50` immutable matrix result

- `main@c381d5066359edc66531bf830a9c71a124a660fc` passed protected baseline, Stage 1, PostgreSQL concurrency, Doctor, TypeScript, ESLint, full unit/integration, API, production dependency audit and production build.
- S3-TEST-004 and S3-TEST-005 are closed on immutable main: legacy, shadow and canvas-v2 all completed clean-schema seeding, authenticated, and entered the five-browser Canvas matrix.
- The three mode jobs executed `180` browser cases: legacy `53/60`, shadow `53/60`, canvas-v2 `54/60`; combined `160 passed / 20 failed`. This is real RED evidence and does not qualify Stage 3 as complete.
- Failures consolidate into S3-TEST-006 merge-window observability, S3-BUG-017 hosted Chromium performance, and one S3-BUG-018 shadow WebKit immediate-reload geometry rollback. Thresholds remain unchanged.

## 2026-08-14 Stage 3 post-`c381d50` failure classification

- S3-TEST-006 reproduced locally and is closed by waiting for the exact asynchronous projects-sync GET after virtual-time advancement. No product merge code changed. The corrected scenario passes all five browser profiles `5/5`.
- The hosted performance failure remains open. The probe no longer rescans the full Canvas DOM for every monitored node on every frame; local Chromium and Chromium 1080p still pass all six fixed 100/300-node pan and save gates, with 56.85-58.88 FPS and zero continuity failures. Only a new immutable hosted run can validate the observer-cost hypothesis.
- Shadow WebKit immediate-reload rollback did not reproduce on the correctly configured local shadow production server: the exact scenario passes once plus five consecutive repeats (`6/6`). No speculative product persistence change was made.
- TypeScript passes after the test-harness changes. Generated Playwright output remains ignored and is not included in the candidate.
- **Verdict remains NOT COMPLETE.** The immutable three-mode matrix, real-P0 Secrets, Coze exact-SHA modes and rollback remain required.
- `real-p0-browser` still fails closed at configuration because required repository Secrets are absent. Paid providers and billing/refund were not executed and are not marked passed.
- **Verdict: NOT READY / ROOT-CAUSE TRIAGE IN PROGRESS.** Coze validation and Stage 4/5 remain prohibited.

## 2026-08-14 Stage 3 post-CI Canvas history and evidence closure

- GitHub Actions run `31797149839`, attempt 2 remains immutable RED: shadow `54/60`, legacy `56/60`, canvas-v2 `53/60`. Real P0 still fails closed because required repository Secrets are absent.
- The merge-window scenario now waits for its exact project-sync response. Evidence uses one narrowly tested lifecycle-abort classifier, and the performance probe caches monitored DOM pairs without weakening continuity assertions.
- A fresh local `canvas-v2` matrix initially produced four cascading failures: Firefox and mobile Chromium restored a two-node batch delete only briefly, then the next project projection returned to 98 nodes; the following 100-node cases inherited that state.
- Trace/network evidence separated two causes: the committed undo did not supersede a queued 98-node snapshot, and restored IDs retained deletion tombstones outside `asset-v3`. Both boundaries are now corrected.
- TDD retained source RED `1/21` and browser RED `4/4` after the first partial fix. Final focused Firefox/mobile passes `4/4`; a clean reseed followed by all five profiles passes `60/60` in 454.9 seconds.
- Fresh gates: TypeScript, ESLint and full Vitest exit `0`; PostgreSQL layer/annotation/element-board concurrency passes `4/4`; production build passes `116/116`.
- **Verdict: LOCAL CANDIDATE PASS / STAGE 3 NOT COMPLETE.** Immutable CI, real-P0 Secrets, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, paid providers and authoritative billing/refund evidence remain required.

## 2026-08-14 Stage 3 independent-review persistence barrier

- Independent read-only review found one P1: an immediate flush for a signature already saved by idle persistence could be deduplicated before the server durability barrier.
- Permanent TDD covers both completed-idle and in-flight-idle promotion. RED was `2 failed / 9 passed`; the focused persistence/Canvas/evidence set passes `50/50` after tracking server-flushed signatures separately.
- The rebuilt production matrix `final-local-matrix-p1-barrier-20260814` passes all five profiles `60/60` with unchanged functional, continuity and performance gates. A stricter teardown-only abort-filter experiment failed the evidence gate while business assertions completed; it was rejected because task-event/activity lifecycle cancellation also occurs during normal page operation.
- **Local verdict remains PASS; Stage 3 remains NOT COMPLETE.** Immutable CI, Coze exact-SHA rollout/rollback and real provider billing/refund evidence are still mandatory.

## 2026-08-15 Stage 3 Task 10 CI RED persistence and evidence closure

- The CI reproduction exposed S3-BUG-021: periodic and immediate project writes could race at one revision, an older success could adopt newer mutable state as its authoritative base, and debounced autosave stopped after a 409. TDD first retained the missing conflict retry as RED, then introduced one per-session sync queue, request-payload-bound adoption and one bounded GET/rebase/retry for autosave. Explicit forced flush still fails closed on conflict.
- Legacy Canvas project writes now use the same PostgreSQL revision compare-and-swap boundary without enabling Asset Graph reconciliation. Reload recovery keeps the latest source snapshot and rebuilds the unload beacon even when the ordinary snapshot was already saved.
- S3-TEST-008 closes an evidence loophole: sync abort recovery now requires a later successful request with the same canonical SHA-256 body digest; timestamps and digests are retained. A 409 is accepted only when a later project sync succeeds.
- Fresh production `canvas-v2` execution `local-final-candidate-r5-20260815` is retained as RED `58/60`. The first Chromium delete/undo case lost Ctrl+Z after the deleted DOM committed; the next move/resize case cascaded because that shared project remained empty. The other four browser profiles passed `48/48`, and all mandatory artifacts remain in the execution directory.
- The preceding exact-candidate `r3` run retained one mobile failure (`59/60`). Three reproductions and pointer diagnostics proved its geometric card center was covered by the right-panel collapse button (`pointerdown` target button, no Canvas image ID), while the image remained partly off-screen. The regression now selects a visible, unobstructed image pixel and a hittable resize handle; a clean three-repeat mobile check passes `3/3`, followed by the full `r4` matrix `60/60`. No Canvas production behavior or threshold was changed for this test-harness correction.
- Historical checkpoint: S3-BUG-022 was first narrowed to dependency-driven listener replacement and a `useLayoutEffect` candidate passed `22/22`. Exact legacy reproduction on `74268eb` later proved listener turnover still existed; the final stable-listener RED/GREEN evidence is recorded in the latest section below.

## 2026-08-15 Immutable `a372e9e` Actions classification

- GitHub Actions run `31866500220`, attempt 2, completed all three five-browser Canvas jobs. Shadow passed `55/60`, canvas-v2 `57/60`, and legacy `55/60`; all `13` failures were unchanged desktop-Chromium performance assertions. Firefox, WebKit and mobile Chromium functional flows passed, and the earlier immediate-reload geometry failure did not recur.
- Hosted performance remains RED without threshold changes: representative 100-node FPS values were `54.02`, `54.44` and `52.78` against `>=55`; 1080p 300-node FPS values were `38.29`, `41.67` and `39.3` against `>=45`; input P95 reached `50.6ms` and `72.1ms`; save long tasks reached `124ms` and `139ms` against `<=100ms`.
- Controlled local repeats on the exact source retained the original budgets and passed every captured performance assertion: desktop 100-node FPS `57.38-58.04`, 300-node FPS `54.79-57.67`, longest save task at most `50ms`, disappeared frames `0`, unclickable duration `0`. This does not override the hosted RED; S3-BUG-017 remains open for environment/application-cost isolation.
- S3-TEST-009 was reproduced from the first-attempt shadow Firefox artifact: a duplicate sync aborted after an exact-digest request had already returned 200. The filter now accepts either temporal ordering only for an exact canonical digest match. Focused tests pass `3/3`, real shadow Firefox passes `1/1`, and unrelated/failed requests remain fatal.
- S3-TEST-010 closes Windows-only CRLF source-contract failures. The Canvas selection contract passes `12/12`, focused tests pass `15/15`, and fresh full Vitest passes `426 files / 2448 tests` with `44` environment-gated PostgreSQL tests explicitly skipped in that generic command.
- Fresh code gates pass: TypeScript; ESLint `0 errors / 969 historical warnings`; full Vitest `426 files / 2447 tests` with `12 files / 44 tests` environment-skipped; production build; and isolated PostgreSQL `14 files / 54 tests` for terminal races, projection, idempotency, charge/refund, annotation, layer decomposition and element board concurrency.
- **Local candidate verdict: PASS FOR THIS CLOSURE. Stage 3 verdict: NOT COMPLETE.** A new immutable GitHub Actions matrix, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, real paid provider execution and one-time billing/cancel/refund evidence remain mandatory.

## 2026-08-15 S3-TEST-011 local five-browser closure

- TDD proved the FPS sampler mixed six RAF intervals with the wider automation action duration: the controlled sample was RED at `6 FPS` and GREEN at the mathematically consistent `62.5 FPS` after using the first-to-last RAF span.
- No product Canvas code, threshold or assertion category changed. Total action duration, input P95, generic/save long tasks, image decode/visibility, hit testing, disappeared frames and unclickable duration remain independently collected and enforced.
- A fresh production shadow performance subset passed `6/6`. The full Chromium, Chromium 1080p, Firefox, WebKit and mobile Chromium matrix then passed `60/60` in `local-frame-span-full-20260815`.
- Desktop Chromium evidence: 100-node FPS `58.61-58.64`; 300-node FPS `55.30-56.78`; input P95 `16.4-24.1ms`; longest save task `0-51ms`; disappeared frames `0`; unclickable time `0`.
- **Local verdict: PASS. Immutable verdict: PENDING.** The historical GitHub RED remains valid for its old sampler; S3-BUG-017 closes only after a new committed SHA passes legacy, shadow and canvas-v2 hosted jobs.

## 2026-08-15 `c4c02a9` immutable RED and local repair candidate

- GitHub Actions run `31870799781` is retained as RED: legacy `57/60`, shadow `59/60`, canvas-v2 `56/60`. Static/tests and PostgreSQL concurrency passed; real P0 failed closed because required repository Secrets are absent.
- Legacy WebKit restored the final undo in the DOM but emitted no matching save POST. TDD proved the scheduler deduplicated a later immediate revision when its content cycled back to an older server-flushed signature. Revision-aware immediate durability is now `13/13` GREEN while idle content deduplication remains intact.
- Hosted performance analysis did not lower thresholds. Non-shadow pan now computes only its active engine; shadow still computes and compares both. Reverse-box preview no longer rerenders the full Canvas on every move, and the evidence sampler schedules the next RAF before executing the same continuity probes.
- Fresh local gates after the repairs: focused `47/47`; full Vitest `428 files / 2454 passed`, `12 files / 44 PostgreSQL-gated skipped`; TypeScript exit 0; ESLint exit 0; build `116/116`; exact trusted protected-source gate `38/38` with no unapproved drift.
- The local machine has no isolated PostgreSQL service, so the exact legacy WebKit database flow cannot be represented honestly here. **Verdict: LOCAL CODE GATES PASS / IMMUTABLE BROWSER VERDICT PENDING.**

## 2026-08-15 Stage 3 follow-up after immutable run `31873152403`

- Immutable source: `main@30fdedc793cf66d45863b01725186f85d681fd0a`.
- Retained RED: canvas-v2 `54/60`, legacy `56/60`, shadow `54/60`; hosted performance budgets and WebKit immediate-reload durability failed.
- New TDD GREEN: Canvas autosave recovery, pan virtualization, direct box-selection visuals, selection wiring, immediate autosave wiring, UserManager synchronization, persistence scheduler and Canvas command suites pass `132/132`.
- Repository GREEN: ESLint error gate, TypeScript, full Vitest `2458` passed, production build `116/116`, and `git diff --check`.
- Explicitly not verified locally: `44` PostgreSQL-gated tests, the immutable three-mode browser rerun, real provider/accounting P0, and Coze rollout/rollback.
- Verdict remains **NOT READY** until the new exact commit passes immutable browser evidence.

## 2026-08-15 stable Canvas shortcut listener regression

- Immutable run `31875413077` is retained as RED: canvas-v2 `56/60`, shadow `56/60`, legacy `53/60`. No retry or local pass replaces that evidence.
- Exact unmodified legacy reproduction passed `10/12`; delete/undo failed and polluted the following move/resize fixture. Trace and database state confirmed the delete persisted while the immediate Ctrl+Z never entered Canvas history.
- The first queued-command candidate was rejected and reverted after it moved the loss to the final undo. The final minimal fix keeps one DOM listener attached for the component lifetime and updates only a ref containing current handlers.
- TDD: stable-listener contract RED `1/23`, GREEN `23/23`; command plus selection contracts `35/35`. Fresh production legacy Chromium passes `12/12`; mobile history/continuity passes `4/4`.
- Full repository gate: `428` test files / `2461` tests passed, `44` PostgreSQL-gated tests explicitly skipped, ESLint and TypeScript exited 0, build completed `116/116`, protected features remained `38/38`.
- **Regression verdict: local fix passes; Stage 3 remains NOT READY.** A new immutable three-mode run, Coze exact-SHA `shadow -> canvas-v2 -> legacy`, and real provider billing/cancel/refund evidence are still required.

## 2026-08-15 direct-pan and immediate-save candidate after run `31878749102`

- The immutable source `main@9d8e7bf73c694d8220472c19e4bad85607da63db` remains RED: legacy, shadow and canvas-v2 each passed `57/60`. One legacy save sample reached `156ms`; hosted desktop FPS still missed unchanged budgets.
- TDD added direct-pan ownership, runtime state-setter and viewport synchronization contracts before production changes. The first independent review rejected the candidate because pointerdown still published React state and competing pointers could replace or terminate the active pan. The repaired implementation keeps begin ref-only, rejects a second pointer and accepts move/up/cancel only from the authoritative owner; the follow-up independent review returned `APPROVED`. Short Space/hand movement remains off parent React state while culling synchronization still enters React state for long movement. Immediate Canvas persistence records its audit only after the authoritative project sync settles.
- `translate3d` and a `content-visibility` removal were measured separately and rejected. The latter produced a concrete 1080p/300-node `60.2ms` P95 failure, so neither experiment remains in the candidate.
- Fresh production execution `local-owner-safe-legacy-full-20260815` passes all five browser profiles `60/60`. Chromium/1080p 100-node pan is `57.42/57.42 FPS`, 300-node pan is `54.82/54.26 FPS`, input P95 is at most `40.1ms`, with zero save long task, zero disappeared frames and zero unclickable duration.
- Full verification passes: focused `8 files / 78 tests`; `441/441` test files and `2512/2512` tests against an isolated PostgreSQL database with no skips; TypeScript; ESLint `0 errors / 973 historical warnings`; production build `116/116`; reviewed protected-feature/source gate `38/38`; and `git diff --check`.
- **Verdict: LOCAL REGRESSION PASS / IMMUTABLE VERDICT PENDING.** This does not close S3-BUG-017 or authorize Stage 4/5. The exact committed SHA must pass all three hosted modes before Coze rollout.

## 2026-08-16 Coze stale app-shell chunk regression

- Exact Coze source `main@fc190b1214f7ec5a1c3588b2be31a87db29f2337` built and started, but authenticated Google Chrome reached the global error boundary with `Loading chunk 5504 failed`.
- The missing hashed chunk returned HTTP 500 while `/` returned HTTP 200 with a one-year `s-maxage` and `X-Nextjs-Cache: HIT`. This preserves the real deployment failure and rejects the false inference that a root 200 means the UI is healthy.
- A RED/GREEN source contract now requires the authenticated root layout to render dynamically. The production build reports both `/` and `/simple-chat` as dynamic, and a real local production request returns `no-store, private, max-age=0` instead of long-lived shared caching.
- Full local gates pass against isolated PostgreSQL 18: `441/441` files, `2521/2521` tests, zero skipped; TypeScript passes; ESLint is `0 errors / 973 warnings`; production build and the `38/38` protected-feature gate pass.
- Coze then synchronized exact `main@9a6363f021f7197b3aa5a9cf834c0c1c0419cb67`. Fresh authenticated Chrome tabs loaded both the dashboard and `/simple-chat` without the global error boundary or `Loading chunk`; the current HTML references 11 static assets and all 11 return HTTP 200. The old `5504` chunk is no longer referenced, and the external root response is now private `no-store`.
- **Verdict: CLOUD REGRESSION PASS FOR S3-BUG-032.** Stage 3 Task 10 remains active: the historical blank project thumbnail is still visible, GitHub immutable workflows remain billing-blocked, and hosted Canvas plus real-P0 evidence are still required. This does not authorize Stage 4/5 or any change to `stable`.

## 2026-08-15 Space-pan hot-path candidate after immutable run `31884790226`

- Stage 0/1 run `31884789686` passed. Quality run `31884790226` retained a real RED result: static and PostgreSQL jobs passed, real-P0 failed closed on missing repository Secrets, and desktop performance left legacy at `57/60`, shadow at `58/60` and canvas-v2 at `57/60`. No threshold or evidence assertion was relaxed.
- TDD proved that Space keydown still published parent React state before the compositor-only pointer path. The first RED/GREEN cycle was `2 failed / 33 passed -> 46/46`. Independent review then identified focus-loss stickiness; a second `3 failed / 35 passed` cycle added repeat-key, blur, hidden-document and unmount behavior. The final focused set is `4 files / 49 tests`, and independent review is `APPROVED` with no Critical or Important finding.
- Fresh production Chromium performance passes `4/4`: 100/300 nodes are `58.34/58.33 FPS`, 1080p 100/300 nodes are `59.01/57.51 FPS`, input P95 is at most `27.5ms`, and save/disappearance/clickability failures are zero.
- The first full five-profile run ended `58/60`. One desktop history test was blocked by an open workspace panel and one mobile case inherited a dirty shared fixture. After deterministic database reseeding, the exact failed cases passed `2/2`; no business-code workaround was added. An intermittent local Next static-asset 500 was retained as deployment evidence; after a clean server restart, all `60/60` probed static assets returned 200.
- Final local gates pass: PostgreSQL-enabled Vitest `441/441 files, 2517/2517 tests`; TypeScript; ESLint `0 errors / 973 historical warnings`; production build `116/116`; exact protected feature/source gate `38/38`; whitespace check; and independent review.
- **Verdict: LOCAL REGRESSION PASS / IMMUTABLE VERDICT PENDING.** Stage 3 Task 10 remains active until the new exact SHA passes all three hosted modes and the real-P0, Coze sequence and provider/accounting evidence are closed.

## 2026-08-15 immutable result for `main@3e46150`

- Stage 0/1 run `31887634672` passed completely. Quality run `31887632360` passed PostgreSQL concurrency/settlement and the complete static/test/audit/build job.
- Three-mode functional coverage remained intact, but performance stayed RED: legacy `59/60`, shadow `58/60`, canvas-v2 `56/60`. Exact misses were legacy 1080p/100 `53.89 FPS`; shadow 1080p 100/300 `51.03/41.92 FPS`; canvas-v2 Chromium/100 `45.36 FPS`, Chromium/300 input P95 `60.9ms`, and 1080p 100/300 `48.78/40.74 FPS`.
- No functional, continuity, history, persistence, save-budget, disappeared-image or unclickable-frame assertion failed. This narrows the next diagnosis to hosted desktop pan rendering/input cost rather than a broad Canvas regression.
- Real-P0 failed closed on missing repository Secrets and paid-test controls before installing browsers. It remains an external release blocker and cannot be replaced by local or Mock evidence.
- **Verdict: IMMUTABLE RED / STAGE 3 TASK 10 REMAINS ACTIVE.** Do not enter Coze mode switching or Stage 4/5.

## 2026-08-15 local candidate after pointer-up root-cause isolation

- A production diagnostic isolated the remaining cost to pointer-up reconciliation: move frames stayed near `57-60 FPS`, while the 300-node commit produced a `131-136ms` long task. The diagnostic file was removed after evidence collection and is not part of the candidate.
- TDD added a permanent runtime contract and changed only the viewport publication boundary. Refs, shadow comparison, compositor transform and cancel snapback remain immediate; React viewport publication is marked as a transition.
- With a clean PostgreSQL reset before every mode, legacy, shadow and canvas-v2 each pass `60/60` across five browser profiles (`180/180`). Lowest FPS is `56.89`, highest input P95 is `20ms`, and all continuity, selection, history, persistence, save and 100/300-node assertions pass without threshold changes.
- Fresh gates: focused Canvas `55/55`; full Vitest `438 passed / 3 skipped files`, `2514 passed / 4 skipped tests`; TypeScript; ESLint `0 errors / 973 warnings`; production build `116/116`; whitespace check.
- **Verdict: LOCAL REGRESSION PASS / IMMUTABLE VERDICT PENDING.** Stage 3 Task 10 remains active; this evidence does not authorize Coze mode switching or Stage 4/5.

## 2026-08-15 immutable result for `main@3535268`

- Stage 0/1 `31891554685` passed. Quality `31891554677` passed PostgreSQL concurrency/settlement and all static, test, API, dependency-audit and production-build gates.
- Canvas remained performance RED: canvas-v2 `56/60`, legacy `57/60`, shadow `57/60`. The lowest observed desktop FPS was `37.65`; the highest input P95 was `76.5ms`. All functional, continuity, history, persistence, save, disappeared-image and unclickable-frame checks passed.
- This disproves the hypothesis that deferring pointer-up React publication alone is sufficient on Hosted runners. The next diagnosis is restricted to work shared by pointer-move/compositing across all three modes.
- **Verdict: IMMUTABLE RED / STAGE 3 TASK 10 REMAINS ACTIVE.** Real-P0 Secrets, Coze sequence and provider/accounting remain blocked; Stage 4/5 stay prohibited.

## 2026-08-15 direct-pan pointer-ownership candidate

- TDD proved the missing pointer-capture contract RED before production code changed, then GREEN in the focused `55/55` Canvas set.
- A production browser assertion passes all five profiles (`5/5`): the viewport owns the pointer during direct pan and releases it at pointer-up; existing Space/focused-button behavior and compositor transform movement remain intact.
- The first short-ID desktop performance run passed `3/4`; Chromium/300 missed only input P95 at `54.5ms` while FPS was `55.70` and continuity failures were zero. Three exact repeats passed `3/3` with P95 at most `28.7ms` and FPS at least `56.23`.
- An earlier long temporary run ID caused a locator-only failure because Canvas alt text is intentionally truncated to 60 characters. Reseeding with the established short-ID fixture contract removed that test-fixture collision; no product code was changed for it.
- Fresh full gates pass: Vitest `438 files / 2514 tests`, separately gated PostgreSQL concurrency `3 files / 4 tests`, TypeScript, ESLint `0 errors / 973 historical warnings`, and production build `116/116`.
- A final post-correction production run passes pointer ownership `5/5` and desktop performance `4/4`; FPS is `57.66-58.73`, input P95 `17.3-19.5ms`, and save/disappeared/unclickable metrics are zero.
- **Verdict: LOCAL CANDIDATE, NOT A RELEASE PASS.** The cold input outlier is retained and immutable legacy/shadow/canvas-v2 evidence decides whether the candidate closes the hosted regression.

## 2026-08-16 immutable `2509fcf` result and hover-hot-path candidate

- Immutable Stage 0/1 run `31895277670` passed. Quality run `31895277650` passed its static, full-test, API, dependency-audit, build and PostgreSQL jobs; real-P0 failed closed on the same ten missing authorized Secrets/paid controls.
- The three Canvas modes remained RED: canvas-v2 `56/60`, shadow `57/60`, legacy `57/60`. Exact hosted FPS misses were canvas-v2 Chromium/100 `53.47`, Chromium 1080p/100 `51.85`, Chromium 1080p/300 `43.98`; shadow `54.61/52.14/39.66`; legacy `54.15/53.15/41.89`. Fixed `55/45 FPS`, `50ms` input and `100ms` save limits were unchanged.
- Canvas-v2 WebKit also timed out once while waiting for the retained merge marker after reload. The exact production WebKit flow passed once plus three consecutive repeats (`4/4` total), so no timeout or business persistence change was made without stable reproduction.
- TDD then isolated per-image hover state churn during pan. A first implementation that disabled media hit testing was rejected because it produced `3133.3-5650ms` unclickable evidence, despite strong FPS. The corrected implementation leaves `pointer-events:auto`, marks only the pan lifecycle and suppresses hover React publications while that pointer owns the viewport.
- Focused runtime/source contracts pass `33/33`; five-browser behavior passes `5/5`. Canvas-v2 desktop performance passed `4/4` plus a repeated `12/12`, with combined FPS `57.81-59.08`, input P95 `10.8-33.4ms`, save `0ms`, disappeared `0`, unclickable `0`. Shadow passes `4/4` at `57.82-58.76 FPS`. Legacy retained one `57.7ms` P95 outlier, then the exact Chromium/300 case passed `3/3` at `18.4-29.2ms`.
- Fresh repository gates pass: PostgreSQL-enabled Vitest `441/441 files, 2520/2520 tests`, TypeScript, ESLint `0 errors / 973 warnings`, production build `116/116`, and whitespace validation.
- **Verdict: LOCAL REGRESSION PASS / IMMUTABLE VERDICT PENDING.** Stage 3 remains Task 10; Coze mode switching and Stage 4/5 are not authorized.

## 2026-08-16 immutable `b4ad786` result and projection-only visibility candidate

- Stage 0/1 run `31898199259` passed. Quality run `31898199267` passed static/tests/build and PostgreSQL concurrency. Real-P0 failed closed on the same ten missing authorized URL/account/model/paid controls.
- Hosted canvas-v2 and legacy each passed `57/60`; shadow passed `54/60`. The missed desktop thresholds were not changed. Shadow also retained one Chromium reverse-box input outlier and one WebKit merge-window deletion fluctuation.
- The new TDD candidate removes the redundant per-card `content-visibility:auto` while retaining RBush render projection as the visibility authority. No pointer events, feature routes, task states, persistence or accounting code changed.
- The current production build passes canvas-v2 `16/16`, shadow `4/4` and legacy `4/4`; FPS is `57.21-59.06`, input P95 at most `30.6ms`, and save/disappeared/unclickable evidence is zero. Exact functional repeats pass Chromium reverse-box `3/3` and WebKit merge-window deletion `3/3`.
- Full local gates pass: PostgreSQL-enabled Vitest `441 files / 2520 tests`, TypeScript, ESLint `0 errors / 973 warnings`, production build `116/116` and the focused Canvas set `41/41`.
- An older baseline had rejected this same CSS removal after a `60.2ms` local input sample. That evidence remains valid historical risk; this candidate is not accepted until the new immutable three-mode matrix passes.
- **Verdict: LOCAL CANDIDATE, NOT RELEASE-READY.** Stage 3 remains Task 10 (`10/11`); Stage 4/5 and Coze mode switching remain blocked.

## 2026-08-16 real Pear generation, cancellation and quick-create fallback candidate

- Source under real browser test: `main@e9efd5d8dee8ab06f91ab6d5eb81c6c815391284`. A Pear `gpt-image-2` request completed in about 25 seconds, added one `1536 x 1024` image to Canvas and charged exactly 60 credits (`138 -> 78`, cumulative usage `3122 -> 3182`). This is positive provider-routing and single-charge evidence, not a cancellation pass.
- The immediately following real cancellation reproduced a P0 failure: processing continued, a late image was accepted about 40 seconds later, and the 60-credit charge remained (`78 -> 18`, cumulative usage `3182 -> 3242`). Evidence is retained at `test-results/screenshots/stage3-cancel-late-result-failure-e9efd5d.png`.
- TDD isolated the cancellation defect to a durable generation slot temporarily marked memory-only in the registry. The new regression was RED before the change and GREEN `15/15`; the related task/state/projection suite is `190 passed / 1 PostgreSQL-gated skipped`.
- Quick Create now treats a Coze proxy-level HTTP 404 as a transport failure only when no terminal business code was received. Its RED/GREEN regression and broader focused suite pass `36/36`; the production route table still contains `/api/quick-create/compile`.
- Fresh local release gates after both source changes: full Vitest `429 files passed / 12 skipped`, `2478 tests passed / 44 skipped`; TypeScript exit 0; ESLint exit 0 with `0 errors / 973 historical warnings`; production build completes `113` static pages; protected-source gate passes `38/38`; whitespace check has no errors. Every skip is explicitly tied to missing `POSTGRES_TEST_DATABASE_URL`.
- **Verdict: LOCAL CODE GATES PASS / CLOUD REGRESSION PENDING.** The deployed exact SHA must prove cancelled terminal state, late-result rejection, one refund only and quick-create fallback. GitHub Actions runs `31916152862` and `31916152867` remain infrastructure-unexecuted due billing; they are neither product passes nor failures.

## 2026-08-16 Coze regression on `main@2cefe59`

- Quick Create transport fallback activated in the real Coze UI and submitted the raw prompt to Pear successfully. The generated task used `gpt-image-2`; this is positive cloud evidence for the fallback path.
- Cancellation failed before the API boundary. Task `async-1786873074765-0-9um5aa` completed after `39.16s`, entered Canvas, charged exactly 120 credits once, and produced no refund. PostgreSQL and audit logs contain no `/api/cancel-task` request for that task.
- Code inspection shows the visible cancel buttons allowed `pointerdown` to reach the Canvas drag handler, which captured the pointer before `click`. A RED/GREEN regression now requires both buttons to stop pointer propagation; cancellation/API/client focused tests pass `23/23`.
- Fresh local gates pass: Vitest `429 files / 2479 tests`, with `12 files / 44 PostgreSQL-only tests` explicitly skipped; TypeScript exit 0; ESLint exit 0 with `0 errors / 973 historical warnings`; production build `113/113`; protected features `38/38`; whitespace check clean.
- **Verdict: P0 REMAINS OPEN / SECOND LOCAL CANDIDATE.** GitHub Actions billing is bypassed only for execution flow; it is not treated as passing evidence. A new Coze exact-SHA paid cancellation/refund run is still required.

## 2026-08-16 Coze cancellation closure on `main@9e6cfb0`

- Coze synchronized exact `main@9e6cfb066bfe05a64fbd210873a3758cf2b3225d`. Authenticated Google Chrome submitted a real Pear `gpt-image-2` Quick Create task and displayed its processing-card cancel control.
- Clicking cancel produced the expected client boundary logs from processing-card intent through `/api/cancel-task`, removed the card immediately, returned terminal `cancelled`, and displayed `任务已被取消`. After 50 seconds, no late green-star test image entered Canvas.
- The authenticated cancellation API was then called again for the exact task `async-1786874691821-0-gqs5y2`. It returned HTTP 200 and the same durable `cancelled` task instead of creating a new task or terminal transition.
- The credits API proves one `-120` consume and exactly one `+120` refund; balance returned `18 -> 138`. After the repeated cancel, the refund-row count for the task remained one. UI evidence is retained at `docs/testing/evidence/s3-bug-033-repeat-cancel-refund-idempotency.png`.
- A fresh isolated PostgreSQL 18 cluster then supplied both `POSTGRES_TEST_DATABASE_URL` and `TEST_POSTGRES_URL`. Full Vitest executed `441/441` files and `2523/2523` tests with zero skips. The run includes atomic task billing, terminal-state races, rollback, task projection, annotation, element-board and Pear layer-decomposition concurrency. Machine-readable evidence: `docs/testing/evidence/s3-bug-033-local-postgres-2026-08-16.json`.
- **Verdict: S3-BUG-033 CLOUD AND LOCAL POSTGRESQL REGRESSION PASS.** This closes the reproduced cancellation/accounting P0. Billing-blocked GitHub Actions remain unexecuted rather than passed, and Stage 3 remains Task 10 (`10/11`).

## 2026-08-16 exact-SHA Canvas media stability regression

- Candidate `0a34c73479d46e8dff85e3c033a9200765291454` stabilizes unchanged image rendering and closes the source rollback race without changing Canvas coordinates, selection, history, persistence, providers or billing.
- The permanent sampler now listens to native image `load` events and `src` mutations for nodes known to be complete before measurement. Desktop Chromium fails if any monitored node reloads or rewrites its source during pan.
- Fresh isolated PostgreSQL matrices pass canvas-v2 `60/60`, legacy `60/60` and shadow `60/60` across Chromium, Chromium 1080p, Firefox, WebKit and mobile Chromium (`180/180`). All 30 pan samples report zero disappeared frames, zero unclickable time and zero monitored media events.
- Desktop Chromium metrics across all modes: minimum `55.62 FPS`, maximum input P95 `43.9ms`; fixed gates remain `55/45 FPS`, `50ms` input P95 and `100ms` save overlap.
- Full local gates pass: `441/441` Vitest files, `2527/2527` tests, TypeScript, production build `113/113`, ESLint `0 errors / 973 historical warnings`, protected features `38/38` and whitespace.
- **Verdict: EXACT-SHA LOCAL THREE-MODE REGRESSION PASS.** GitHub Actions executed zero steps because of account billing, so immutable hosted evidence remains unverified and Stage 3 stays at Task 10 (`10/11`).
## 2026-08-18 Stage 4 Task 4 final local regression

- Candidate source: `codex/wj-stable-s4` based on `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`.
- Full PostgreSQL-enabled Vitest: `476/476` files, `2920/2920` tests, zero failures and zero skips.
- API: `117/117` files, `582/582` tests.
- Component/lib regression: `320/320` files, `2063/2063` tests.
- Production browser matrix: `15/15` across Chromium, Chromium 1080p, Firefox, WebKit and mobile Chromium.
- Fixed performance threshold retained: three Chromium 1080p 100-node samples were `56.70`, `57.15` and `55.62 FPS`; P95 stayed below `17 ms`.
- Console/PageError, unexpected HTTP failures, disappeared frames and unclickable duration: zero in the final matrix.
- TypeScript, Doctor, production build (`113` routes), protected baseline (`38/38`) and whitespace checks passed.
- ESLint: `0 errors / 988 historical warnings`; warnings were not hidden or converted to ignores.

Result: local Stage 4 Task 4 regression **passed**. This does not replace Coze exact-SHA or unavailable GitHub-hosted evidence.

## 2026-08-20 S4-BUG-008 project workflow persistence regression

- Authenticated Google Chrome on Coze `main@2557d67` proved the defect at both boundaries: standalone workflow save returned HTTP 200 and Workflow Hub reopened one node, while project reload followed by direct node-mode entry restored zero nodes.
- TDD began RED (`2 failed / 4 passed`) and now passes the focused workflow suite (`6/6`) plus related project recovery, autosave, UI and sync coverage (`81/81`).
- Fresh full gates pass: Vitest `2852 passed / 70 explicitly PostgreSQL-gated skipped`, TypeScript, production build (`113` routes), whitespace check and ESLint `0 errors / 988 historical warnings`.
- Coze pulled exact `main@016e5d2feb98cb0377fc0475389b10b914c1020f`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged. The first build was terminated by sandbox memory pressure and briefly left the prior runtime on port 5000, so that attempt was retained as failed deployment evidence rather than counted as a product pass. Coze subsequently completed the production build and restarted the service.
- In authenticated Google Chrome profile `用户1`, a fresh one-node workflow save returned HTTP 200 from `/api/workflow/save`, followed by HTTP 200 project-sync requests containing `metadata.workflow` and the same `input-image` node. After a full reload, direct node-mode entry restored `1 节点 · 0 连线` without using Workflow Hub. A clean final reload/entry window contained zero fresh Console Error/Warning or uncaught exception.
- **Verdict: EXACT-SHA COZE GOOGLE CHROME REGRESSION PASS FOR S4-BUG-008.** This closes only project workflow save/reload persistence; PostgreSQL-only, immutable Actions and broader Stage 4 release gates remain unchanged.

## 2026-08-20 Stage 4 cross-workspace and renderer rollout regression

- Testing used authenticated Google Chrome profile `用户1` on the isolated Coze preview. Workspace HEAD was `e097e82aef9221c6cfa2feea781a08f3d44246c8`; its business runtime was equivalent to `016e5d2feb98cb0377fc0475389b10b914c1020f`. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` was not modified.
- A canonical Canvas asset version `66621b79-77c2-561f-966f-0c9870ba168a` was dragged into node mode. `POST /api/assets/transfer` returned HTTP 200 for `workflow-input`. The connected input/output workflow completed `5/5`.
- Clicking the normalized output's `发送到智能对话` navigated to `/simple-chat?projectId=s3zk7z3gmsoo15gz`. A second `POST /api/assets/transfer` returned HTTP 200 for `chat-result`, and the page visibly rendered `工作流结果已返回：图片输出` with the blue-cup image. Evidence: `docs/testing/evidence/stage4-workflow-chat-return-2026-08-20.png`.
- A legacy green-cup Canvas image had no asset identity. Its workflow executed, but output-to-chat failed closed with `输出缺少规范素材版本，无法发送到智能对话`. This is retained as S4-BUG-009, not counted as a cross-workspace pass.
- The standalone-chat front half could not invoke the image tool because the only authorized chat provider, APImartLLM, returned upstream `get_channel_failed`. No image-provider task was created and no image-generation charge is claimed.
- Renderer rollout used the same saved project and no rebuild: `legacy -> shadow -> react-flow-v2 -> legacy`. Shadow exposed the legacy surface plus an inert probe with `data-in-sync=true`. React Flow v2 rendered and dragged the node, but a selected React Flow node did not populate the property panel; S4-BUG-010 remains open. The sandbox was restored to server-delivered `legacy` with HTTP 200.

## 2026-08-20 S4-BUG-009 and S4-BUG-010 local repair

- TDD retained two independent RED cases: historical images had no adoption-before-transfer path, and clicking a real React Flow node left `选中节点查看属性` visible.
- S4-BUG-009 now uses a session-owned, transactional legacy adoption endpoint before canonical workflow transfer. Unknown images and client-supplied owner fields fail closed; the Canvas receives the resulting IDs without polluting undo history.
- S4-BUG-010 now projects React Flow node/pane clicks into domain `selection.set` commands. React Flow drag remains locally controlled and still commits only at drag end.

## 2026-08-20 React Flow v2 selection cloud pass and S4-BUG-011 local repair

- Coze's business tree was equivalent to `main@c99fb7270e1dc81343733675b2b18d9935499ff9`. A transient missing-chunk screen was not counted as product evidence: the root and current `9205` chunk both subsequently returned HTTP 200, while the adoption route returned the expected GET 405.
- In authenticated Google Chrome, forced `react-flow-v2` rendered exactly one React Flow surface and no legacy surface. Node click selected the domain node and populated the property panel; blank-pane click cleared both selections; Console Error/Warning remained zero. S4-BUG-010 selection behavior therefore passes its cloud gate.
- Editing `名称` and immediately clicking Save exposed a new reproducible persistence failure: the UI displayed `已保存`, but reload restored the old label. This evidence is retained as S4-BUG-011 rather than hidden under the selection pass.
- RED first expected `renamed before save` but the save request contained `drag source`. The minimal fix serializes `wfRef.current`, writes `label` at the top level and makes top-level-only node merges null-safe.
- Fresh local evidence passes focused `4/4`, related Stage 4 `83/83`, full Vitest `2858 passed / 70 PostgreSQL-gated skipped`, TypeScript, ESLint with zero errors, production build `114/114` and whitespace validation.
- The isolated Coze runtime was restored to `legacy` and root HTTP 200. **Verdict: S4-BUG-010 CLOUD PASS; S4-BUG-011 LOCAL PASS / EXACT-CANDIDATE CLOUD RETEST REQUIRED.**

- Focused tests pass `8/8`; the expanded asset/workflow regression passes `87/87`; full Vitest passes `462` files and `2857` tests with `70` explicitly PostgreSQL-gated skips. TypeScript, production build, whitespace and ESLint `0 errors / 988 historical warnings` pass.
- **Verdict: LOCAL REGRESSION PASS, CLOUD ACCEPTANCE PENDING.** No Coze or real PostgreSQL success is inferred from mocked route tests; `legacy` remains the delivered renderer until the exact pushed SHA is retested in Google Chrome.
- Fresh browser logs for the renderer interaction contained no Console Error/Warning. This does not waive the two functional defects.
- **Verdict: NORMALIZED `CANVAS -> WORKFLOW -> CHAT` PASS; FULL STAGE 4 CHAIN AND REACT FLOW V2 ROLLOUT NOT PASSED.**

## 2026-08-20 S4-BUG-011 exact-business-tree cloud closure

- Coze commit `bdd1122b818783a7c74972184e5f90676610ea37` cleanly cherry-picked `main@5a5ee387a49ad592e0f3a80f7de69bbf5de6dbd4`; `git diff --quiet origin/main -- .` returned 0 and `stable` remained `52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- The Coze production build exited 0 and generated `114/114` pages. The candidate first started in `react-flow-v2` and returned HTTP 200.
- Authenticated Google Chrome selected the one restored node, changed its name to `图片输入 · S4云端5a5`, clicked Save immediately after the edit, observed `已保存`, fully reloaded the page and restored that exact value. Blank-pane click then cleared both the React Flow selection and property panel.
- The test value was restored to `图片输入`, saved and confirmed after another full reload. No test residue remains in the project.
- Console history retained expected 404/502 warnings from the deliberate build downtime. After the candidate started, no new Console Error/Warning appeared and no global error boundary rendered.
- Forced rollback started `legacy` with HTTP 200. The reloaded node page exposed `data-workflow-legacy-surface=true`, had zero React Flow surfaces and retained `1 节点 · 0 连线`.
- **Verdict: S4-BUG-010 AND S4-BUG-011 EXACT-BUSINESS-TREE COZE GOOGLE CHROME PASS.** S4-BUG-009 historical adoption and Stage 4 provider/accounting evidence remain open.

## 2026-08-20 S4-BUG-009 historical asset cloud closure

- The authenticated legacy Canvas loaded five existing images. The green-cup record `gen-ph-1786870574533-0-udi5ds` initially lacked canonical IDs in the client workflow payload.
- Dragging that historical image to empty node space issued `POST /api/assets/adopt-canvas-image` with only `projectId + imageId`. HTTP 200 returned asset `00f43bc6-6bef-55de-be8f-55aa5c155a74`, version `d4e3cb84-6fb9-5cd0-9baf-a902a3da8ac3` and Canvas placement `000d7289-6ae9-51a8-96f2-2af8cd9a7a94`.
- The client then issued the canonical `workflow-input` transfer with that exact version. HTTP 200 created placement `836ce9f3-cdaf-437d-9335-5a5e1c1563eb`. The request body for workflow execution contained the canonical IDs, one connection and the intended historical image URL; execution completed `3/3`.
- Sending the output to standalone chat issued a `chat-result` transfer with the same version and returned placement `2988d36b-fa29-4eba-9ab7-f9859986ba70`. Chat visibly rendered `工作流结果已返回：图片输出` and `/api/serve-upload/uploads/gen-1786870615869-42tmc8.png`.
- Replaying the exact workflow-return intent returned the same placement with `reused: true`. A full project reload retained the canonical IDs in the historical image drag payload, proving the identity write-back survived hydration.
- Test state was restored to five Canvas images and the original one empty workflow node. The generated output node/image and one transient upload file created during interaction targeting were removed. Fresh Console Error/Warning count was zero.
- **Verdict: S4-BUG-009 REAL COZE POSTGRESQL + GOOGLE CHROME PASS.** Stage 4 provider charge/cancel/refund evidence remains open and is not inferred from this non-billable pass-through workflow.

## 2026-08-20 Stage 4 real-provider cancellation and UI regression

- Authenticated Google Chrome submitted Pear `gpt-image-2` task `async-1787237343655-0-ehq3d9` through the professional generation panel and clicked the visible cancel control about 10.5 seconds later.
- The terminal poll returned `cancelled`; after 73,895 ms no matching result entered Canvas. PostgreSQL-backed credits evidence contained one `-60` charge and one `+60` refund, restoring balance `138`. Repeating cancellation returned the same terminal task and retained exactly one refund.
- The run also exposed S4-BUG-012: `success=false/retryable=false/status=cancelled` entered the generic failure branch before the dedicated cancellation branch, producing one Console Error and a `生成失败` toast despite correct business cancellation.
- TDD was RED for branch precedence, toast severity and red failure styling. The narrow local repair is GREEN across `5 files / 39 tests`; full Vitest passes `2860` tests with `70` PostgreSQL-only tests explicitly skipped. TypeScript, ESLint and production build (`114/114`) pass.
- Evidence: `docs/testing/evidence/stage4-provider-cancel-accounting-cloud-2026-08-20.json` and `docs/testing/evidence/stage4-provider-cancel-cloud-2026-08-20.png`.
- **Verdict: BUSINESS CANCELLATION/ACCOUNTING PASS ON DEPLOYED SOURCE; UI FIX LOCAL PASS / CLOUD RETEST REQUIRED.** Direct provider-side remote-task cancellation is not claimed because a distinct provider task ID was not available.

## 2026-08-20 S4-BUG-013 terminal-placeholder persistence regression

- Rebuilding and reloading the production runtime exposed a previously cancelled and refunded task as a fresh 1% Canvas placeholder. The authoritative task remained `cancelled`; only the project placement snapshot was stale.
- Backward tracing proved task terminal projection and the dedicated processing-placeholder predicate were correct. The generic Canvas placement predicate still retained every placeholder and was used by autosave, unload and user-project serialization.
- TDD reproduced the bug before the fix (`1 failed / 12 passed`). The minimal persistence-boundary change then passed focused task projection/persistence tests (`41/41`) and the expanded autosave, project-reopen, server-sync and damaged-media matrix (`109/109`).
- Fresh full gates pass: Vitest `463 files / 2861 tests`, with `15 files / 70 PostgreSQL-gated tests` explicitly skipped; TypeScript exit 0; ESLint exit 0 with `0 errors / 988 historical warnings`; production build `114/114`.
- **Verdict: LOCAL FIX PASS / STAGE 4 STILL OPEN.** Push the candidate to `main`, pull/build it in Coze, prove the cancelled frame disappears and remains absent after a second reload, then run the exact-candidate PostgreSQL multi-instance suite.

## 2026-08-21 Stage 4 cloud acceptance closure

- GitHub `main@8490fc14ec313000da37475627b4a101c8ecb546` filters terminal task placeholders before Canvas hydration while retaining the unfiltered snapshot in the hydration guard, which schedules one cleanup save instead of suppressing it.
- The Coze business tree matched GitHub `main`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged.
- Authenticated Google Chrome exposed three stale tabs for the same project during the first investigation. Their concurrent autosave explained the rapid project-revision growth and the apparent resurrection. After every surviving preview loaded the current source and only one project tab remained, the authoritative server snapshot returned `target=null` twice, at revisions `5295` and `5305`, with seven retained images.
- Focused regression passed `52/52`; full non-PostgreSQL Vitest passed `463 files / 2862 tests`, with the `70` PostgreSQL-gated tests explicitly skipped in that run. The immediately preceding isolated PostgreSQL 18 candidate gate passed `2931/2931` with zero skips. TypeScript, ESLint (`0 errors / 988 historical warnings`) and production build (`114/114`) passed.
- **Verdict: STAGE 4 CLOUD ACCEPTANCE PASS.** The terminal placeholder is absent from durable project state and remains absent after subsequent revisions. V5.8.8 may now be frozen and analyzed strictly as a read-only donor; no Stage 4 business suite is repeated.

## 2026-08-21 V588-ADMIN-001 local regression

- RED tests reproduced fabricated zero-call provider health, fabricated `99%` model success, malformed configuration rows and missing nullable-rate UI handling.
- The narrow projection repair passed focused `4/4` and related administrator regression `8/8`.
- Full Vitest passed `465 files / 2866 tests`; `15 files / 70` PostgreSQL-only tests were explicitly skipped because `POSTGRES_TEST_DATABASE_URL` is absent. TypeScript passed, ESLint exited 0 with `0 errors / 988 historical warnings`, and production build completed `114/114` routes.
- The donor snapshot remained read-only and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` was not modified.
- **Verdict: LOCAL REGRESSION PASS / CLOUD PENDING.** Stage 4 is not being repeated; this is the first selective V5.8.8 absorption item.

## 2026-08-21 V588-ADMIN-001 cloud API regression

- The exact deployed candidate is `main@1ba98f776b0c19141a9f05343ce7bb23d0c50fb2`.
- Authenticated administrator API verification returned HTTP 200 with explicit unavailable coverage and no model/provider rows, proving the deployed backend no longer manufactures usage health.
- Browser installation, extension and native-host diagnostics passed, and the two pre-existing Chrome tabs were listed. Both tabs timed out when page control was requested, so no screenshot, visible empty-state assertion or Console capture was produced.
- The no-new-tab constraint is authoritative: subsequent acceptance must refresh and reuse the existing Coze project and preview tabs only. A disconnected sandbox is refreshed on the existing project page before a hard refresh of the existing preview page.
- **Verdict: CLOUD API PASS / CHROME UI UNVERIFIED.** Evidence: `docs/testing/evidence/v588-admin-001-cloud-api-2026-08-21.json`.

## 2026-08-21 V588-ADMIN-001 cloud UI closure

- Chrome control was reconnected without creating another tab. The existing Coze project page had no sandbox-disconnect dialog, and the existing preview page completed a hard refresh while preserving the administrator session.
- Visible UI contracts passed: one model empty state, one provider empty state, zero `99%` labels and no fabricated provider status rows.
- Fresh Console Error/Warning count after the hard refresh and dashboard navigation was zero.
- Screenshot evidence: `docs/testing/evidence/v588-admin-001-cloud-ui-2026-08-21.png`.
- **Verdict: V588-ADMIN-001 LOCAL + CLOUD PASS.** The item is absorbed and `V588-ADMIN-002` is now the next authorized RED test.

## 2026-08-21 V588-ADMIN-002 local regression

- RED reproduced one false negative in the donor authorization test: the current `assets/orphans` route has an explicit `getRequestUser + role` guard, but the donor contract did not recognize that reviewed pattern.
- The minimal integration is test-only. It freezes all 24 administrator routes, accepts only the shared guard and two explicitly reviewed manual guard contracts, and fails on route-set drift or an unguarded route.
- Representative runtime assertions now prove unauthenticated orphan scans return `401`, non-admin scans return `403`, and both paths avoid invoking the media-health service.
- Focused tests passed `6/6`; the administrator regression group passed `26/26`. Full Vitest passed `466 files / 2868 tests`, with `15 files / 70` PostgreSQL-only tests explicitly skipped. TypeScript, ESLint (`0 errors / 988 historical warnings`) and production build (`114/114`) passed.
- **Verdict: LOCAL REGRESSION PASS / CLOUD PENDING.** No production business code changed. Push the exact candidate to `main`, pull it into Coze and verify representative administrator and unauthenticated route behavior before closing the item.

## 2026-08-21 V588-ADMIN-002 cloud closure

- Coze pulled exact `main@d220479214a88b45fcd3a9520d220b864d19cb28`; its worktree was clean, port 5000 remained HTTP 200 without rebuild/restart, and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged.
- A credential-free request to `/api/admin/assets/orphans` returned HTTP `401` and `{"error":"Authentication required"}`.
- Authenticated Google Chrome reused the same two existing tabs. Refreshing the administrator operations dashboard retained visible real summary data and both expected empty-state projections. Fresh Console Error/Warning count was zero.
- Evidence: `docs/testing/evidence/v588-admin-002-cloud-api-2026-08-21.json` and `docs/testing/evidence/v588-admin-002-cloud-ui-2026-08-21.png`.
- **Verdict: V588-ADMIN-002 LOCAL + CLOUD PASS.** The repository-wide route contract is absorbed; `V588-ADMIN-003` is the next authorized RED item.

## 2026-08-21 V588-ADMIN-003 local regression

- Donor behavior was reproduced as an architecture mismatch before implementation: it depended on a raw uploads scan and process-local lock. The current-line RED suite instead required asset-graph discovery, durable leases, exact lease-owner settlement and administrator guards.
- The additive migration creates one 256/512 WebP variant per exact asset version. The worker uses current safe-image, Sharp pixel-limit, server-data-root and S3 boundaries; the S3 key mirrors the public media-gateway path so an instance restart can recover the same thumbnail.
- Canvas hydration projects only ready variants, prefers 512 over 256, preserves old thumbnails when none are ready and safely falls back during the narrow pre-migration deployment interval without hiding unrelated database failures.
- Focused thumbnail/admin/Canvas regression passed `57/57`. Related asset/media regression passed `245/245`; 27 PostgreSQL cases were explicitly skipped. Full non-PostgreSQL Vitest passed `2895/2895`, with `72` PostgreSQL-only tests explicitly skipped in that run.
- TypeScript passed; ESLint completed with `0 errors / 988 historical warnings`; production build completed `115/115` routes.
- A fresh isolated PostgreSQL 18.4 cluster supplied both repository database gates. The dedicated suite passed `2/2`, followed by the full repository at `487/487` files and `2967/2967` tests with zero failures and zero skips. It proves migration checksums, exact version/size uniqueness, concurrent claim exclusion, lease recovery and stale-worker rejection without regressing existing asset, task, billing, annotation, element-board or layer-decomposition concurrency. Evidence: `docs/testing/evidence/v588-admin-003-local-postgres-2026-08-21.json`.
- GitHub `main@d941384f3f7abb5c0b7a67d71686e4ebfee24da8` contains the candidate and `stable` remains unchanged. Coze first returned platform `instance_not_found`, then recovered on an older build where the route still returns the Next.js not-found page. No migration, backfill or Canvas behavior is inferred from either response. Evidence: `docs/testing/evidence/v588-admin-003-cloud-probe-2026-08-21.json`.
- Coze subsequently pulled `d941384`. Credential-free GET/POST returned `401`, proving the route and guards are live. Administrator login returned `200`, but authenticated GET, dry-run and GET returned `500`, proving the additive migration was absent; no real batch was run.
- Deployment TDD reproduced the missing build step in both Coze scripts. Both now execute checksum-managed migrations before `next build` when a database URL is configured, while the cold-start launcher remains unchanged. Focused deployment/migration/protection/route tests pass `21/21`; full non-PostgreSQL regression passes `2898/2898`; TypeScript, zero-error ESLint, shell syntax and build `115/115` pass.
- Coze pulled `main@172f38c5454b7fa5a708b61392c47d99e9f46461`. The migrated route returned administrator status `200`; dry-run discovered 10 candidates and kept all counts at zero. Two `limit=1` executions each completed one candidate, ending at `ready=2`, `pending=0`, `processing=0`, `failed=0`. This closes the migration-delivery defect and proves bounded cloud execution.
- Project synchronization was read twice with stable revision `5354`, `6` projects and `48` images. Both responses reported `assetGraphMode=legacy` and `canvasKernelMode=legacy`, so zero `thumbnailUrl` projections are expected; variant projection is intentionally active only in `asset-v3`.
- The existing Chrome project/preview tabs were discovered, but two claim attempts timed out. No new tab or another browser was used. Screenshot, Console, controlled `asset-v3` projection, media reload/original fallback and S3 recovery remain unverified.
- **Verdict: BACKFILL CLOUD PASS / ADMIN-003 PARTIAL.** Do not start `V588-PROVIDER-001` until the controlled projection and recovery evidence closes.

## 2026-08-21 V588-ADMIN-003 shadow reconciliation cloud regression

- Coze built and started exact `main@99d226a4fa9a1ffe7425e241963f110ec8609055`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged and the runtime stayed in `WUJIE_ASSET_GRAPH_MODE=shadow`.
- The fresh administrator readiness request returned HTTP 200 (`requestId=6a330ba2-48bf-9529-af7d-16257ea64248`). All six legacy projects match all six graph projects; mismatch, unmigrated, orphan and checkpoint-error counters are zero.
- Authenticated Google Chrome preserved six projects and 48 images. A settled reload produced zero fresh Console errors and zero warnings. No manual `/api/user-data/sync` mutation was used to manufacture parity.
- The two historical missing media/placement records remain explicit. Therefore `releaseReady=false`, `switchAuthorized=false` and `asset-v3` promotion stays blocked; the current shadow-mode acceptance is not being misreported as full media readiness.
- Evidence: `docs/testing/evidence/stage4-asset-shadow-reconciliation-cloud-2026-08-21.json` and `docs/testing/evidence/stage4-asset-shadow-reconciliation-cloud-2026-08-21.jpg`.
- **Verdict: SHADOW RECONCILIATION PASS / ASSET-V3 PROJECTION STILL CONDITIONAL.** The prior `shadow-projection-drift` blocker is closed. The next unique verification concerns the two missing historical media records, not a repeat of the completed Stage 4 browser matrix.

## 2026-08-21 V588-BUG-005 local durability-gate regression

- RED first proved that a current AssetVersion could be counted as release-safe while its only media locator was an expired `/v1/images/proxy/...` path with no durable storage or recovery source.
- The minimal change adds two read-only PostgreSQL aggregates for false-ready current versions and active placements. It adds blocker `non-durable-ready-media` and exposes aggregate counts only; it does not fetch remote media or reveal record details.
- A temporary local PostgreSQL false-ready record made `npm run doctor` emit `asset-media WARN` with `falseReadyCurrent=1`; cleanup ran in `finally` and left no test residue.
- Focused unit and PostgreSQL regression passed. The final full run passed `489/489` files and `2992/2992` tests with zero failures and zero skips. `pnpm validate`, TypeScript, zero-error ESLint, production build `115/115`, and `git diff --check` passed.
- `pnpm check:protected-baseline` remains blocked by 16 source-drift entries accumulated since the older protected baseline. All 38 protected feature IDs, component paths, evidence contracts and refs are present. The allowlist was not weakened to manufacture a pass.
- Coze then pulled exact `main@e809f5c105d6e42d584a38ae217d7791c7864759`, retained `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` and `shadow`, reported a clean worktree, passed production build and served port 5000/public root with HTTP 200.
- Authenticated Google Chrome returned readiness HTTP 200 with `falseReadyCurrentVersions=1`, `falseReadyActivePlacements=2` and blocker `non-durable-ready-media`. The placement count is correctly independent: the one false-ready current version is referenced by two active Canvas placements.
- The deployment retained `6` projects, `48` Canvas images, migration `6/6` and shadow parity `6/6`. A clean reload after deployment produced zero fresh Console errors and zero fresh warnings.
- **Verdict: LOCAL + EXACT-SHA COZE GOOGLE CHROME PASS.** Detection is closed; historical media remediation remains deliberately open, so `asset-v3` stays blocked.

## 2026-08-22 Task 6 historical-media safe-archive local gates

- Production source remains `86b8e176b2dcb88e3bf4d43ae19c64dc05dc9f54`; test-contract correction `aca74ea33bbaa92eac2566edf502e46656dfcd74` changes no production code. Final evidence used migrated PostgreSQL 18.4 at loopback-only `127.0.0.1:55436/wujie_safe_archive_task6_0822`, with all four repository PostgreSQL URL variables populated.
- The old Task 4 concurrency assertion was preserved as RED evidence, then aligned with the approved Task 5 restore guard. Archive succeeds first; overlapping restore rejects exact `ASSET_MEDIA_UNRECOVERABLE`; Asset/placements/snapshot/revision/ledger/audit prove no partial restore.
- Focused exact command passed `7 files / 97 tests`; affected exact command passed `9 files / 77 tests`. Full `pnpm test` passed `492/492` files and `3066/3066` tests with zero failures and zero skips.
- `pnpm validate` passed (TypeScript plus quiet ESLint); `pnpm lint` passed with `0 errors / 988 warnings`; `pnpm build` passed with `116/116` static pages and includes `/api/admin/assets/remediation`; `git diff --check` passed.
- `pnpm check:protected-baseline` failed with `23` unapproved source-drift blockers, while its `38` feature IDs, protected component paths, evidence contracts, and refs all passed. The allowlist was not changed.
- Functional local evidence passes. The protected-baseline governance gate remains blocked by 23 accumulated source paths even though all `38/38` protected identities and contracts are present; no allowlist was changed. Cloud archive, idempotent retry, and `asset-v3` acceptance remain **UNVERIFIED**. Evidence: `docs/testing/evidence/v588-admin-003-safe-archive-local-2026-08-21.json`.

## 2026-08-22 protected-baseline authorization regression

- The approved change authorizes only the 23 independently traced files. No directory-wide `migrations/`, `scripts/`, `src/app/api/admin/`, `src/app/api/assets/`, `src/components/dashboard/`, `src/lib/`, or `src/lib/asset-core/` grant was added.
- TDD RED first failed on the missing provenance manifest. A second RED proved three proposed source mappings did not touch their declared files; those mappings were corrected from repository history.
- Commit `34391fbda9ee2dfe7c32c103c1418d0b59361dcb` adds the exact command grants, the 23-entry machine-readable provenance manifest, and a permanent Git-history regression test.
- Focused test passes `7/7`; the fresh full PostgreSQL-enabled run passes `492/492` files and `3067/3067` tests with zero failures and zero skips. Validate, full lint (`0` errors / `988` warnings), build (`116/116`), protected baseline and whitespace checks pass.
- This closes only the local governance blocker. Cloud archive, cloud idempotent retry and `asset-v3` acceptance remain **UNVERIFIED** and require the planned exact-SHA cloud sequence.

## 2026-08-22 S4-BUG-014 历史媒体覆盖本地闭环

- 真实 PostgreSQL RED 证明活动 placement 引用非当前坏版本时，旧候选发现会漏报发布 blocker；修复后当前与非当前坏版本均进入稳定候选集。
- 归档覆盖门禁采用 PostgreSQL advisory 读写锁：归档独占等待上限为 5 秒，普通业务写入使用共享门禁并等待归档结束，不用通用 500 牺牲正常写入。
- 并发同 key 复用同一 remediation；同 key 不同请求返回冲突；Canvas 快照或审计失败会回滚 Asset、版本、placement、revision、ledger 和 audit。
- 精确授权测试从 25 次串行 Git 子进程改为一次批量来源查询，保持逐路径来源断言；执行时间由 13.6 秒降至 0.4 秒，没有增加测试超时。
- 受影响矩阵通过 `6` 个文件、`108/108`；带隔离 PostgreSQL 的全仓通过 `492/492` 个文件、`3090/3090` 项测试，0 failure、0 skip。
- TypeScript 通过；ESLint 为 `0 error / 988` 条历史 warning；生产构建完成 `116/116`；保护基线确认 38 个功能完整、25 条精确授权、0 blocker；`git diff --check` 通过。
- **结论：本地回归通过。** 尚未推送 `main`，未执行云端归档，未切换 `asset-v3`。机器证据：`docs/testing/evidence/s4-bug-014-local-postgres-2026-08-22.json`。

## 2026-08-22 S4-BUG-014 云端只读闭环

- Coze 项目页证明 `HEAD/origin/main=04a7a9104a96ae74325a76776e831c0e567e362b`、`origin/stable=52f7c601ed150769e15d06fb435c6e360e28c9e7`、构建成功、5000 端口 HTTP 200，资产模式保持 `shadow`。
- Google Chrome 管理员会话连续两轮读取 auth、remediation 和 production readiness；两轮候选 ID、摘要、placement ID、数量与 readiness 子集逐字段完全一致。
- remediation 为 `4 versions / 4 active placements / 3 current / 1 non-current`，覆盖为 `4/4`、`complete=true`、`uncovered=0`。这直接证明 S4-BUG-014 的非当前坏版本覆盖缺口已在云端关闭。
- readiness 仍保留 `releaseReady=false`、`switchAuthorized=false`、两个媒体 blocker、迁移 `6/6` 和影子项目 `6/6`；修复没有削弱 doctor 或偷偷启用 `asset-v3`。
- 新鲜 Console Error/Warning 为 `0/0`。机器证据：`docs/testing/evidence/s4-bug-014-cloud-readonly-2026-08-22.json`，截图同名 `.png`。
- **结论：Task 7 云端只读验收通过。** 未执行归档 POST；Task 8 仍需管理员针对这 4 个精确候选进行操作时确认。

## 2026-08-22 S4-BUG-014 云端软归档闭环

- 操作前重新确认的候选集与 Task 7 完全一致：`4 versions / 4 active placements / 3 current / 1 non-current`，覆盖 `4/4` 且无未覆盖 blocker。
- Coze 进程最初继承了缺少 `-5000` 的 `COZE_PROJECT_DOMAIN_DEFAULT`，安全路由按设计两次返回 `403 ADMINISTRATOR_ORIGIN_INVALID`，数据库无写入。修正当前进程的精确预览 origin 后，管理员会话恢复为合法同源写入。
- 首次归档请求返回 HTTP 200，requestId `12314534-c08e-90b8-ae25-5d3a59de9f0f`，remediationId `remediation_d0af6963-97ed-4ebf-9da3-a5d63dbcf603`，归档 4 个版本与 4 个 placement。
- 使用相同请求体和幂等键 `4fafacab-7aaa-45e0-a34e-1f1637fec300` 重放，requestId `c473242a-f3c9-95f7-85ee-cc315cc36c53`，返回相同 remediationId、`reused=true`，项目 revision 保持 `5718`。
- PostgreSQL 只读核验确认 ledger `1`、audit `1`、软删除 placement `4`、不可恢复版本 `4`、版本行保留 `4`；同一时间窗积分与退款事件均为 `0`。未调用供应商、未物理删除媒体。
- 归档后连续两轮 remediation 均为 `0 candidates / 0 active placements`；readiness 均为 `releaseReady=true`、`switchAuthorized=true`、blockers `[]`，迁移 `6/6`、shadow 对账 `6/6`。运行模式仍为 `shadow`，本任务没有执行模式切换。
- **结论：S4-BUG-014 云端软归档与幂等回归通过。** 证据：`docs/testing/evidence/s4-bug-014-cloud-archive-2026-08-22.json` 和 `.png`。`asset-v3` 投影、刷新恢复、原图回退与 S3 恢复仍是独立验收项。

## 2026-08-22 V588-UI-001 首个叶组件本地回归

- RED 先复现底部缩放与辅助控制仍全部内联在 `InfiniteCanvas`，且不存在受当前控制器约束的独立展示叶子。
- 最小实现仅提取 `CanvasZoomCluster`。缩放上下限、重置视图、网格轮换、连线开关、图层/历史互斥、工具会话和 AI 引擎弹窗仍由父组件回调控制。
- 聚焦回归通过 `7 files / 64 tests`；全仓通过 `475 files / 2988 tests`，`18 files / 105` 个 PostgreSQL 环境测试明确跳过。本项未触及持久化、任务、账务或供应商代码。
- TypeScript 通过；ESLint `0 errors / 988 warnings`；生产构建 `116/116`；保护基线保留 `38/38` 功能且 0 blocker；`git diff --check` 通过。
- GitHub 已依次接收治理前置 `cf65a65` 和实现 `c808e50`，`stable@52f7c60` 未变化。
- **结论：本地回归通过，云端待验。** Coze 必须拉取包含来源记录的最终提交，并在已登录 Google Chrome 中逐项验证缩小、放大、重置、网格、连线、图层、历史和 AI 引擎，确认图层/历史互斥及新鲜 Console Error/Warning 为 0。

## 2026-08-22 V588-UI-001 云端回归闭环

- Coze 本地环境提交 `0e16ea0` 的父提交和代码树均精确对应 `origin/main@986f128006c246b400f116da7fb3a5b4c02f0a6c`；工作区干净，生产构建退出码为 0，5000 端口根路径 HTTP 200。`stable@52f7c601` 保持不变。
- Google Chrome“用户1”在第一方预览页成功保持管理员会话并打开包含真实图片的项目。内嵌 iframe 登录不持久化被归类为 Coze 第三方 Cookie 上下文限制，不是无界账号或登录代码回归。
- 缩放真实变化为 `90% -> 75% -> 90%`；独立重置验证为 `69% -> 90%`。网格完整循环 `点阵 -> 线条 -> 空白 -> 点阵`，连线完成 `显示 -> 隐藏 -> 显示`。
- 图层打开后版本历史保持关闭；打开版本历史会关闭图层；重新打开图层会关闭版本历史。两个面板都能回到关闭状态。AI 引擎设置显示“放大引擎选择”，并能通过关闭按钮退出。
- 最终回归时间截点 `2026-08-22T04:31:52.874Z` 后的新鲜 Console Error/Warning 为 `0`，无浏览器原生弹窗。视觉截图确认工具栏未被右侧面板遮挡，也没有错位、裁切或叠加。
- **结论：V588-UI-001 云端回归通过。** 证据：`docs/testing/evidence/v588-ui-001-cloud-2026-08-22.json` 和 `.png`。

## 2026-08-22 V588-UI-002 命令面板本地回归

- 按 TDD 先得到预期 RED：组件、工具簇入口、父画布接线和输入焦点保护缺失；最小 GREEN 后，聚焦套件为 `3 files / 18 tests` 全部通过。
- 新组件只负责过滤、焦点、键盘/鼠标交互和渲染；画布状态、视图动作、选择、工具会话及图层/历史互斥仍归当前 `InfiniteCanvas`。
- 全仓 Vitest 通过 `477 files / 3004 tests`；`18 files / 105 tests` 因 `POSTGRES_TEST_DATABASE_URL` 未配置而明确跳过。本项不改变持久化或账务，因此不以跳过结果冒充 PostgreSQL 通过。
- TypeScript 通过；ESLint 退出 0，保持 `0 errors / 988 historical warnings`；生产构建完成 `116/116`；保护基线保留 `38/38` 功能且 0 blocker；`git diff --check` 通过。
- 精确源码来源为 `8acb3c9`；`CanvasCommandPalette.tsx` 已加入逐文件授权和来源校验，不存在目录级放行。`stable@52f7c601` 与 donor 未变化。
- **结论：本地回归通过，云端未验证。** Coze 必须拉取最终 `main`，并在现有 Google Chrome 标签页验证入口、快捷键、搜索、导航、执行、关闭、输入保护、命令动作、图层/历史互斥和新鲜 Console。

## 2026-08-22 V588-UI-002 云端缺陷修复与全量复验

- Coze 首轮真实测试复现命令面板“打开图层面板”和“打开版本历史”关闭弹层但不打开目标面板，Console 出现 `CANVAS_TOOL_ENTRY_POINT_UNSUPPORTED:*:shortcut`；根因是两个工具未在注册表声明 `shortcut` 入口。
- 新增注册表失败测试后，仅补充两个入口声明。RED 精确失败于 `layer-order:shortcut`；GREEN 聚焦套件通过 `4 files / 26 tests`。
- 修复后全仓 Vitest 通过 `477 files / 3005 tests`；`18 files / 105 tests` 因本机缺少 `POSTGRES_TEST_DATABASE_URL` 明确跳过。本项不触及持久化或账务。
- TypeScript、ESLint、生产构建 `116/116`、保护基线 `38/38` 和 `git diff --check` 均通过。候选已推送为 `main@1681b2b80a5afdbb23c710616a3b9cd99fd47e71`，`stable@52f7c601` 未变。
- Coze exact-SHA 构建退出码 `0`，5000 端口监听，首页 HTTP `200`；Google Chrome 最终 SHA 交互矩阵 `30/30` 通过，图层/历史互斥正确，最终状态已恢复。
- 测试时间截点后的 Console Error/Warning 与 `[CanvasToolSession]` 错误均为 `0`。证据：`docs/testing/evidence/v588-ui-002-cloud-2026-08-22.json` 和 `.png`。
- **结论：V588-UI-002 云端回归通过并完成吸收。** 下一项为 `V588-UI-003`，不得重复本项或跳过 RED。

## 2026-08-22 V588-UI-003 小地图云端回归

- Task 1 的 RED 证明当前代码缺少 `CanvasMinimap` 模块、父画布接线和工具簇入口，并同时执行精确 TypeScript 门禁；独立审查为 `0/0/0`。
- Task 2 叶组件最终 `14` 个测试与 `pnpm ts-check` 通过；极端有限坐标和 `x + width` 溢出均固定为永久回归，独立审查为 `0/0/0`。Task 3 聚焦回归为 `6` 个文件、`27` 个测试通过，独立审查为 `0/0/0`。
- 全仓 TypeScript 通过；ESLint 为 `0 errors / 988` 条历史 warning，本项新增 warning 为 `0`。全仓 Vitest 为 `499` 个文件（`481` 通过、`18` 跳过）和 `3143` 个测试（`3038` 通过、`105` 跳过）；跳过项仅为未配置 `POSTGRES_TEST_DATABASE_URL` 的既有真实 PostgreSQL 集成/并发门禁，不计为通过。
- Next.js `16.2.11` 生产构建生成 `116/116` 页面并以退出码 `0` 完成；干净 HEAD 保护基线为 `38/38`，未授权源码漂移 `0`、warning `0`；`git diff --check` 通过。
- 云端验收提交为 `efe5e4f16ac3c8a0c7ed6b8fc73cba48af6fd6b2`；Coze、`origin/main` 与本地提交精确一致，构建退出码 `0`、首页和鉴权健康接口 HTTP `200`。`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`、donor 均未变。
- 仅复用 Google Chrome「用户1」的现有标签页完成 26/26 项矩阵：默认关闭、工具按钮、命令、关闭按钮、偏好恢复、两组响应式阈值、主题、面板避让、空态、100/300 节点、真实拖动和导航保持 `46%` zoom 均通过。最终健康窗口 Console error/warning、`[CanvasToolSession]` 错误与原生弹窗均为 `0`，网络全部 `200`；两个 30 秒空闲窗口没有画布/项目同步 POST。
- **结论：V588-UI-003 已吸收，云端验证通过。** 机器证据为 `docs/testing/evidence/v588-ui-003-cloud-2026-08-22.json`。PostgreSQL 集成门禁仍因缺少 `POSTGRES_TEST_DATABASE_URL` 单独列为未验证；下一唯一项为 `V588-UI-004`。

## 2026-08-23 V588-UI-004 本地回归

- 六个展示叶及父级接线完成，抽取后的三个源码合同改为读取真实所有者；本次修复不改变运行时业务逻辑。
- UI004 聚焦矩阵通过 `13 files / 65 tests`，所有权修复回归通过 `3 files / 14 tests`；独立复审为 `Critical/Important/Minor = 0/0/0`。
- 全仓 Vitest 共 `507` 个文件、`3180` 项测试：`489` 个文件、`3075` 项通过；`18` 个文件、`105` 项因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过。
- TypeScript 通过；ESLint `0 errors / 987` 条历史 warning；Next.js `16.2.11` 生产构建通过；保护基线 `38/38` 且 0 warning；`git diff --check` 通过。
- Chromium 生产 E2E 已定义 375x812、768x900、1440x900、底部抽屉、图片工具栏、8 个编辑入口和 reduced-motion；独立审查后补齐 768px 编辑面板循环。
- 本地没有 E2E 凭据与 PostgreSQL，实际命令结果为 `2 skipped`，没有执行登录后的布局动作，也没有生成可当作通过依据的浏览器证据。该矩阵必须在 Coze exact SHA 的现有 Google Chrome 标签页执行。
- **结论：功能、独立审查与 `main` 推送通过 / 发布仍有条件。** Coze exact SHA 和 Google Chrome 云端矩阵完成前，V588-UI-004 不标记为已吸收。
- GitHub 已普通快进到实现候选 `be96c59d2d4dec6bbe510c3b7fd0de59ef092e0b`，`stable` 未变。Google Chrome 正确列出 Coze 项目页和云端预览页，但接管两个现有标签均超时；未使用 360、未新建标签，故 Coze exact SHA 与云端矩阵仍保持未验证。

## 2026-08-23 V588-UI-004 云端首轮与远程图片 CORS 修复

- Coze 已精确运行 `main@362d350ecbb552f27ad51be0782f228f49fd2391`，生产构建和 HTTP 健康通过；已登录 Google Chrome 在真实五图项目完成 UI004 首轮矩阵。
- 1440x900 底部抽屉和 375x812 图片紧凑工具栏可用；放大、SVG、去背景配置、扩展和裁切面板可打开。擦除、蒙版明确显示源图加载失败，调色预览自然尺寸为 `0x0`。
- 同一 Pear CDN 图片在画布中自然尺寸为 `1536x1024`、`crossOrigin=null`；三个失败入口使用 `crossOrigin=anonymous`。Asset API 返回相同远程 URL，根因确认是上游无 CORS Header，不是图片不存在、选择错图或模型不可用。
- TDD 新增鉴权同源图片读取端点，复用现有 SSRF 安全下载器；只改变擦除/蒙版与调色预览的展示源，不改变任务、供应商和账务。候选已推送为 `main@3becee8b54d9cc6320b137c4070e129cbed06ffe`，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变。
- 本地最终门禁：聚焦 `50/50`、源图合同 `19/19`、全仓 `491 files / 3086 tests` 通过；`105` 个 PostgreSQL 专项因缺少隔离库跳过；TypeScript、零错误 ESLint、生产构建 `116` 路由和空白检查通过。
- **结论：修复前云端问题与根因已确认，修复候选本地回归通过；修复后云端仍未验证。** Google Chrome 主实例当前可发现但无法交互，360 实例已识别并排除。证据：`docs/testing/evidence/v588-ui-004-remote-image-cors-2026-08-23.json`。

## 2026-08-23 V588-UI-004 云端最终回归

- Coze 已精确运行 `main@8c936cac777f5b05cfb381c73e929c13a5341efd`，`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变；干净生产构建确认 `/api/image/source` 进入路由清单，5000 端口 PID `1774`，根路由 HTTP 200，未登录图片代理正确返回 401 JSON。
- 同一 Pear CDN 真实图片在擦除与蒙版面板均加载为 `1536x1024`，真实笔迹可将提交按钮从禁用切换为可用。
- 首次代理修复后又稳定复现调色预览渲染框只有 `1x0.66px`；根因是 `NextImage width={1} height={1}` 与 `max-w/max-h` 的组合不会放大布局框。RED 用例先失败，然后仅改为相对预览容器内 `NextImage fill`。
- 最终云端调色预览自然尺寸 `1536x1024`，渲染尺寸 `291x162.8125`；亮度滑杆从 0 调到 2 后计算样式立即变为 `brightness(1.01)`。新鲜 Console error/warning 为 0，JavaScript dialog 为 0。
- 本地最终门禁：相关 `14/14`，TypeScript 通过，ESLint 零错误，全仓 `491 files / 3087 tests` 通过，`105` 项 PostgreSQL 专项因无隔离库跳过，生产构建 `116` 页面/路由通过。
- **结论：V588-UI-004 远程图片编辑与调色预览已在云端关闭，可标记为已吸收。** PostgreSQL 隔离库门禁仍是独立未验证项，不因本结论改成通过。

## 2026-08-23 V588-SAFETY-001 WASM SVG 像素预算回归

- RED 首先证明同步 WASM 路径没有独立像素预算；最小实现只在 `runWasmVTracer()` 的 raw RGBA 解码前调用纯函数，通用 3072/4096 预处理上限和其他矢量引擎保持不变。
- 本地聚焦回归 `14/14`；全仓 `492` 个文件、`3099` 项测试通过，`105` 项 PostgreSQL 专项因未配置 `POSTGRES_TEST_DATABASE_URL` 跳过且不计通过。TypeScript、ESLint 零错误、生产构建 `116/116`、保护基线和空白检查通过。
- Coze 工作区、`origin/main` 与 exact `d968ad3448c9a3202f462959baaa89dab5f471cd` 一致，干净生产构建退出码 `0`；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- Google Chrome 仅复用现有标签页，对真实 `1536x1024` Pear 图片明确选择 `WASM / 快速 / 全彩矢量化`。服务端日志确认同步输入缩至 `627x418`，面积 `262086 <= 262144`，约 `10.245s` 完成并生成可选择的 `1536x1024` 结果节点。
- 同期每 500ms 的首页健康探针共 `80` 次，全部 HTTP 200，平均 `6.002ms`、P95 `8.163ms`、最大 `13.152ms`；浏览器 Console error/warning 与原生 dialog 均为 0。
- SVG 下载弹层可选择 SVG 并确认。自动化的 download 事件监听超时，但本地实际文件为 `4726` 字节，SHA-256 为 `B9AE35800CADD344850D13ADB890517C7312B8FB4BB3C9073D17785A132B8B95`，逻辑尺寸 `1536x1024`、内部 `viewBox=0 0 627 418`。
- **结论：V588-SAFETY-001 云端回归通过并完成吸收。** 本结论只覆盖同步 WASM 大图预算；Python VTracer、其他矢量引擎和 PostgreSQL 专项不随本项自动通过。下一唯一项为 `V588-AUTH-001`。

## 2026-08-23 V588-AUTH-001 本地回归

- TDD 先复现认证密钥读取失败与缺失值混淆、跨进程副本覆盖、`simple-chat` 假注销及退出同步无限等待；实现提交 `b0cd946f` 只修改认证持久化、退出边界、SSE 卸载和默认媒体依赖。
- 真实 PostgreSQL 聚焦通过 `7 files / 63 tests`，包含 `8` 项实际数据库集成/并发用例，覆盖事务锁竞争、新数据目录副本、旧文件迁移、`ON CONFLICT DO NOTHING` 胜者保持及密钥环并发。
- 全仓 Vitest 通过 `503 files / 3286 tests`，明确跳过 `19 files / 113 tests`；API 回归 `123 files / 701 tests`，另有 `2 files / 3 tests` 跳过；业务回归 `350 files / 2336 tests`，另有 `2 files / 8 tests` 跳过。所有已执行测试失败数均为 0。
- `pnpm doctor`、`pnpm ts-check`、`pnpm lint:build` 和 `pnpm build` 均通过；Next.js `16.2.11` 完成 `116/116` 页面生成。目标 ESLint 为 `0 errors`，保留 `9` 条既有 warning。
- 最终生产构建浏览器矩阵 `10/10` 通过，覆盖 Chromium、Firefox、WebKit、1080p 和移动端下管理员/普通用户的错误密码、正确登录、刷新保持、画布/仪表盘/独立聊天导航、注销及注销后数据隔离。
- 两轮独立复审最终均为 `Critical/Important/Minor = 0/0/0`。首轮浏览器 503 来自测试夹具错误继承 `FILE_ONLY`，改用规定的 `DB_PLUS_FILE` 环境后同一代码通过，没有用业务代码绕过配置错误。
- **结论：V588-AUTH-001 本地回归通过。** Coze 尚未拉取精确提交并重复云端会话矩阵，因此不能标记为云端通过；付费生成、取消和退款链路也不在本项验收范围。

## 2026-08-24 V588-AUTH-001 历史密钥环云端闭环

- Coze 旧候选真实复现：登录成功并设置 Cookie 后，冷启动只读 `/api/session` 返回 503 `AUTH_CONFIGURATION_UNAVAILABLE`，项目同步返回 500；Cookie 已发送，故不是密码、浏览器 Cookie 或登录按钮问题。
- RED 先锁定 JSONB 中“一层历史 JSON 字符串”兼容边界，并证明双重编码与畸形输入仍必须拒绝。真实 PostgreSQL 回归确认数据库驱动返回一层字符串。
- `main@42e540bd5aa552f10af0e12240546993bda3e91a` 只在持久化读取边界解一层 JSON，随后继续严格校验；没有修改登录宽松度、账号、Cookie、数据库内容、环境变量或 `stable`。
- 本地新鲜门禁：认证 `141/141`、真实 PostgreSQL `10/10`、全仓 `503` 文件/`3293` 项通过、doctor、TypeScript、Lint 与 `116` 路由生产构建均退出 0；默认全仓中的 `19` 文件/`115` 项非认证 PostgreSQL 门禁保持明确跳过。
- Coze 精确拉取并生产重启后，Google Chrome 冷刷新仍进入管理员工作台；`/api/session`、`/api/admin/users`、项目读取与项目同步均 HTTP 200 且业务成功，Console error/warning 为 `0/0`。
- **结论：V588-AUTH-001 的同 secret 部署、历史密钥环兼容和冷启动会话保持通过。** 真实云端 secret 轮换未执行，不扩大为完全发布通过。证据：`docs/testing/evidence/v588-auth-001-coze-2026-08-24.json`。

## 2026-08-24 GPT Image 2 原生透明 PNG 本地回归

- 基线为 `origin/main@6102572bc6ff90e20ef522c79bc5c0b846f7cde7`，在隔离分支 `feat/native-transparent-generation` 实施，未修改 `stable`。
- 所有主要生图入口已使用统一背景输出合同：主图像生成面板、快速创作、参考图组、融图组、图生图、场景、贴纸、全景、六面体、工作流图像节点、聊天与 Agent。透明模式固定输出 PNG，不支持透明输出的模型会在扣费和供应商提交前返回明确错误，不静默换模型或自动发起第二次去背景任务。
- 完成结果会逐张解码检查真实 Alpha 通道；棋盘格背景不会被视为透明。供应商返回不透明图片时保留原图，并给出“用户确认后另行去背景、单独计费”的下一步提示。
- 新增和相关聚焦回归均通过；全仓 Vitest 为 `532` 个文件，其中 `513` 个通过、`19` 个跳过；共 `3451` 项测试，其中 `3337` 项通过、`114` 项跳过，失败数为 0。跳过项均保持为隔离 PostgreSQL 环境门禁，不计为通过。
- `pnpm ts-check` 通过；`pnpm lint` 退出码为 0，结果为 `0 errors / 991 historical warnings`；Next.js `16.2.11` 生产构建成功并生成完整路由表；`git diff --check` 通过。
- 构建阶段复现字境生成路由非法导出 `getFontDesignResult`。根因是 Next.js Route Handler 不允许导出辅助函数；任务缓存已最小迁移到 `src/lib/font-design-task-store.ts`，轮询回归 `2/2` 和生产构建均通过，字境任务行为未改变。
- Playwright 真实付费用例已建立，并确认可被 Chromium、Chromium 1080p、Firefox、WebKit、移动 Chromium 五个项目发现。由于本地未配置真实登录凭据、精确 `providerId::gpt-image-2` 和付费开关，本轮没有调用真实供应商，也没有生成可作为云端 Alpha 验收的截图、下载文件或任务证据。
- **结论：代码与本地回归通过，发布判定为有条件通过。** 关闭条件是部署精确候选后，使用真实 GPT Image 2 完成透明请求、任务终态、画布结果、下载文件 Alpha 字节与单次扣费验证。

## 2026-08-24 V588-PROVIDER-005 Task 11 本地回归

- 统一能力目录已覆盖精确 `providerId + modelId`、管理员结构化编辑、图像/参考图组/融图组/节点/视频消费端，以及图像和视频的扣费前准入。
- 配置持久化 RED 稳定复现“更新 A 会写回 B”的陈旧快照问题；最小修复后能力单测 `7/7`。
- 随后用 PostgreSQL 18 一次性隔离集群执行真实往返。首轮先发现测试缺少 `server-only` 装配；修正后第二轮发现生产代码把 JSON 数组写入 `TEXT[]`，返回 PostgreSQL `22P02`。仅改为由 `pg` 直接编码字符串数组后，同一真实并发测试 `1/1` 通过；临时数据库服务已停止。
- Task 10 架构拆分后，全量首次暴露 4 个旧测试契约：3 个仍把下游图像能力要求在 Agent 编排聊天模型上，1 个仍按裸模型名推断批注能力。修正测试夹具与源码合同后聚焦 `47/47`，未放宽生产授权。
- `pnpm doctor`、`pnpm ts-check`、`pnpm lint` 均退出 0；ESLint 为 `0 error / 970` 条历史 warning。
- `pnpm test`：`516` 文件通过、`3372` 项通过；`20` 文件、`116` 项跳过。
- `pnpm test:api`：`125` 文件通过、`716` 项通过；`2` 文件、`3` 项 PostgreSQL 并发测试跳过。
- `pnpm test:regression`：`361` 文件通过、`2407` 项通过；`3` 文件、`9` 项 PostgreSQL 测试跳过。
- 生产构建生成 `116/116` 页面与路由；保护基线先阻断 41 条累计认证/能力源码漂移，逐文件核对来源提交后合同 `7/7`、保护门禁 `38/38` 且 0 warning/0 blocker；没有目录级授权。
- Playwright 能识别 15 个三浏览器用例；启动本地服务后执行 Chromium/Firefox/WebKit，因缺少真实登录凭据共 9 项明确跳过。付费测试还要求 `E2E_ENABLE_PAID_GENERATION`，未以 Mock 冒充真实成功。
 - **结论：本地静态、自动化与本项 PostgreSQL 候选通过，但 V588-PROVIDER-005 发布验收仍不通过。** 阻塞项是三浏览器真实账号五入口、真实同名模型跨供应商、付费图像/视频、非法请求零扣费和 Coze exact-SHA 证据。

## 2026-08-24 原生透明 PNG 与 V588-PROVIDER-005 联合集成回归

- `feat/native-transparent-generation` 已进入 `main@36a986fcb74b2d16313a349600a4022c71b482e0`；`V588-PROVIDER-005` 在该基线上重新集成为候选 `93253e6f981a2c6cc4403c9c5615e7044c7db62e`，没有用旧候选覆盖透明输出链路。
- 联合专项覆盖服务端透明输出规范化、逐图 Alpha 校验、能力准入、管理员能力编辑和五类消费端，结果为 `126 passed / 1 PostgreSQL-gated skipped / 0 failed`。
- 全仓 Vitest 为 `3419 passed / 116 PostgreSQL-gated skipped / 0 failed`；TypeScript、Doctor、ESLint `0 errors / 970 historical warnings`、Next.js `116/116` 构建、保护基线 `38/38` 和 `git diff --check` 通过。
- PostgreSQL 跳过项未计为通过；真实 GPT Image 2、真实视频、积分与供应商任务均未在本地伪造。
- **结论：本地代码集成与自动化回归通过，云端验收未完成。** 只有 Coze exact-SHA、真实 Alpha 文件、五入口能力一致性、真实付费任务及零副作用拒绝均取得证据后，才能把专项改为通过。

## 2026-08-24 最终候选 Coze 构建与运行验收

- GitHub、本地和 Coze 的 `main` 已精确对齐 `0adbd5ee5b8e32e3987ddf0ccb9f09dd816f5f4d`。Coze 原有 `87a13761` 是无文件差异的同步空提交，已先保留为 `coze-backup-87a13761`，再在干净工作区将 `main` 对齐 `origin/main`；没有覆盖业务修改。
- `origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`，未切换、合并、重置或推送。V5.8.8 donor 保持只读。
- Coze 使用 `WUJIE_ASSET_GRAPH_MODE=shadow pnpm build` 完成 Next.js `16.2.11` 生产构建，退出码为 `0`。旧 PID `1614` 正常退出后，以 `WUJIE_ASSET_GRAPH_MODE=shadow pnpm exec next start -p 5000 -H 0.0.0.0` 启动；监听进程 PID 为 `2547`。
- 环回健康检查：`/` 为 HTTP `200`，`/api/auth/me` 为 HTTP `200` 且返回匿名会话；HTML 实际引用的 `10` 个 JavaScript 与 `1` 个 CSS 静态资源全部为 HTTP `200`。
- 现有 Google Chrome 项目页的内嵌预览已刷新到最新服务，并可进入无限画布登录页。随后扩展重新绑定两个现有标签时持续超时；没有新建标签、没有切换到 360，也没有用非浏览器结果冒充真实 UI 通过。
- **结论：Coze exact-SHA、构建、启动、HTTP 与静态资源通过；Stage 4 业务验收仍未完成。** 管理员能力持久化、普通用户五入口、真实 GPT Image 2 Alpha、透明多图逐张回填、真实图像/视频、单次扣费及非法请求零副作用仍须在同一现有 Google Chrome 预览标签闭环。

## 2026-08-24 原生透明 PNG 最终候选本地门禁与云端阻塞复核

- 原生透明 PNG 功能分支已进入并推送 `main@4711501bdeb059a16d404184ef38c0956a57fb06`；本地与 `origin/main` 精确一致，`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。
- 新增真实付费 E2E 合同覆盖 `n=2` 两个独立任务、第二槽延迟时第一张先进入画布、两张 PNG 分别验证 Alpha、恰好两笔生图扣费，以及余额和累计使用量与交易成本一致。该用例未使用模拟供应商结果冒充云端通过。
- 干净工作树本地门禁：Doctor、TypeScript、ESLint `0 errors / 970 historical warnings`、Next.js `16.2.11` 生产构建均通过；全仓 Vitest 退出码 `0`，为 `526 files / 3420 tests passed`。另有 `20 files / 116 tests` 因未配置 `POSTGRES_TEST_DATABASE_URL` 明确跳过，不计为通过。
- 现有 Google Chrome 仅复用 Coze 项目页和预览页，没有新建标签、没有使用 360。浏览器运行、扩展安装/启用及 Native Host 清单诊断均通过，但接管、DOM 快照和刷新动作均超时。
- 云端预览公开请求返回 HTTP `404`、`error_code=instance_not_found`、`request_id=5aa43080-27e1-9b90-8fe1-b8f9364e9529`，证明当前沙箱实例不存在；因此不能把旧候选 `0adbd5ee` 的云端运行证据继承给 `4711501b`。
- **结论：本地候选通过，Stage 4 云端验收仍受环境阻塞。** 沙箱恢复并精确拉取 `4711501b` 后，必须重新完成透明 `n=2` 逐张回填、两份 Alpha 字节、任务终态和恰好两笔扣费验证。机器证据：`docs/testing/evidence/stage4-transparent-final-candidate-blocked-2026-08-24.json`。
