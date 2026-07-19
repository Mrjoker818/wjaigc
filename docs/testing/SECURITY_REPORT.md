# 安全测试报告

## 2026-07-20 Production dependency audit

- `pnpm audit --prod --json --registry=https://registry.npmjs.org` completed against 710 production dependencies.
- Result: 0 critical, 0 high, 0 moderate, 0 low, and 0 informational vulnerabilities reported by the official npm registry.
- The configured local `npmmirror` registry does not implement the audit endpoint, so the first audit invocation failed before dependency analysis. The official-registry result above is the authoritative audit evidence for this run.
- This is a package-vulnerability result only. It does not close any cloud configuration, authentication, storage, or AI-provider acceptance item.

## 2026-07-19 P0 repair: public media route data disclosure and stored SVG execution

### SEC-018 / P0: Public media endpoint read private persistent files and served active SVG

- Location: `GET /api/serve-upload/[...path]`, with writable inputs in `POST /api/upload` and `POST /api/save-image`.
- Evidence: the route searched the entire data root after `uploads/`, while `system/users.json`, `system/api-providers.json`, and the auth secret reside under that root. It served unknown extensions as bytes and `.svg` as `image/svg+xml`. The two write paths accepted SVG or arbitrary multipart filename extensions.
- Impact: unauthenticated disclosure of user/provider configuration and credentials stored in the persistent volume, plus same-origin stored-XSS through uploaded SVG.
- Fix: reject non-media and private-root requests before storage access; preserve public image/video/3D assets; return legacy SVG only as a download with `X-Content-Type-Options: nosniff`; validate bytes and MIME types across direct upload, multipart persistence, data URLs, and fetched persistence inputs.
- Verification: red-first public-media contract failed on route isolation, SVG response headers, upload SVG acceptance, and save-image validation. It now passes. Full API suite: 48 files / 112 tests; component/library suite exited 0; TypeScript and production build passed.
- Deployment status: fixed locally; cloud verification pending. Do not treat the P0 as closed until anonymous private-path requests return 404 and normal PNG/generation/SVG-download flows are exercised on the synchronized preview.

## 2026-07-19 P1 repair: video downloader SSRF policy convergence

### SEC-019 / P1: Inconsistent video URL validation could reach private or link-local hosts

- Locations: `src/lib/api-validator.ts`, `src/app/api/video/download/route.ts`, `src/app/api/video/tools/route.ts`, `src/app/api/video/extract-frame/route.ts`, and `src/app/api/video/extract-frames/route.ts`.
- Evidence: red-first tests showed that `http://127.0.0.1`, `https://169.254.169.254`, `https://[fe80::1]`, and `https://localhost` passed the generic `videoUrl` validation. Selected authenticated endpoints then use those values in server-side `fetch` calls.
- Impact: an authenticated user could use video processing as an SSRF primitive against server-local or link-local services. Authentication reduces exposure but is not an adequate network boundary.
- Fix: a shared `isSafeVideoSource` policy now admits only clean `/uploads/` or `/api/serve-upload/` paths and public HTTP(S) URLs, and all four downloader routes invoke it before network/file work.
- Verification: red-first focused tests now pass (4 files / 37 assertions). The deployment acceptance probe remains required; no external system was subjected to attack testing.
- Latest cloud status: the signed-in same-origin loopback probe returned Coze backend `502` before application handling. This is a deployment availability blocker, not a successful SSRF rejection; SEC-019 remains unverified in cloud.

## 2026-07-19 P1 repair: recharge order authorization and GET side effects

### SEC-017 / P1: Recharge order endpoint allowed anonymous and cross-user reads

- Location: `GET /api/recharge/[orderId]`.
- Evidence: the handler performed an order-ID-only database query and returned order metadata and `payLink` without session or ownership validation. Its QR fallback also wrote `payment_config` during a GET request.
- Impact: order-status and amount disclosure to anyone who obtains an ID, payment-link disclosure, and a state-changing endpoint vulnerable to cross-site invocation.
- Fix: require a valid session before database work; bind non-admin reads to `user_id`; retain explicit administrator access; never persist configuration from GET.
- Verification: red-first ownership contract covers anonymous-before-DB rejection, owner-scoped SQL, and no GET write. Full API suite passed 47 files / 107 tests; regression suite passed 93 files / 442 tests; TypeScript and production build passed.
- Deployment status: fixed locally; cloud verification pending. Verify 401/404/owner/admin behavior against the synchronized preview before closing the finding.

## 2026-07-19 P1 repair: professional upscale authorization

### SEC-016 / P1: Anonymous callers could trigger remote, local, and AI upscale processing

- Location: `POST /api/image/upscale-pro`.
- Evidence: the route parsed the untrusted body before any authentication check, then could fetch a supplied image URL, invoke cloud upscalers or fal.ai, run local ONNX/Sharp work, trigger AI enhancement, and persist a result. The unused `getSessionUser` import did not protect the handler.
- Impact: anonymous CPU/GPU/provider spending, remote-fetch abuse, and unowned output persistence.
- Fix: use `requireApiAuthOrReject` as the first handler operation, before body parsing or processing.
- Verification: the shared high-risk authorization contract was extended with this route, failed first with exactly this missing path, then passed. `pnpm lint --quiet` and `pnpm ts-check` passed.
- Deployment status: fixed locally; cloud verification pending. Anonymous requests must return 401 before parsing `imageUrl`; a signed-in image-toolbar upscale must still finish and persist normally.

## 2026-07-19 P0 repair: project archive export authorization

### SEC-015 / P0: Anonymous callers could download source and full project archives

- Location: `src/app/api/export-project/route.ts`
- Evidence: both GET and POST accepted archive scopes, including `full`, and called the tar creation path without authentication.
- Impact: source/configuration disclosure plus unauthorized access to uploaded/generated assets.
- Fix: require an administrator before scope handling or archive creation in both methods.
- Verification: red-first dual-method contract plus route-level anonymous GET/POST tests pass (3 files / 5 assertions).
- Deployment status: fixed locally, cloud verification pending.

## 2026-07-19 P1 repair: expensive media and AI route authorization

### SEC-014 / P1: Anonymous callers could invoke TTS, image processing, document fetches, FFmpeg, and AI processing

- Location: audio generation, color adjustment, knowledge extraction, layered decomposition, scene generation, and both video frame extraction routes.
- Evidence: the high-risk route contract failed with exactly these seven handlers, each parsing JSON before identity verification.
- Impact: unaccounted provider costs, CPU/disk use, remote-fetch exposure, and unowned output creation.
- Fix: require the shared authenticated/internal-request gate before body parsing in all seven POST handlers.
- Verification: the expanded red-first high-risk contract passes after the repair; targeted ESLint and TypeScript checks pass.
- Deployment status: fixed locally, cloud verification pending.

## 2026-07-19 P1 repair: image persistence internal-auth migration

### SEC-013 / P1: Image persistence trusts caller-controlled local/internal headers

- Location: `src/app/api/save-image/route.ts`
- Evidence: `x-internal-call: true` and local-looking Host values bypassed session authentication before accepting multipart/data/remote media and storing it locally or in S3.
- Impact: unowned storage writes and remote-media fetching through a privileged persistence route if an attacker can reach the endpoint through a proxy or local-origin path.
- Fix: remove both caller-controlled bypasses and require `requireApiAuthOrReject` before parsing the request. Every direct server persistence caller now adds verified `getInternalRequestHeaders`; delayed worker persistence uses the explicit `system-save-image` internal identity, and request-scoped callers retain their signed-in user identity.
- Verification: the red-first authorization/caller-inventory contract now passes. A runtime persistence-helper regression verifies signed headers on data and remote image results. Focused compatibility regression passed 5 files / 39 assertions; API suite passed 44 files / 100 assertions; component/library regression, lint, and TypeScript checks passed.
- Status: **fixed locally; cloud verification pending**. The release gate remains failed until anonymous rejection and authenticated generation/workflow/image/video/refinement persistence are verified in the synchronized cloud preview.

## 2026-07-19 P1 repair: upload authentication bypass

### SEC-012 / P1: Caller-controlled headers bypassed image-upload authentication

- Location: `src/app/api/upload/route.ts`
- Evidence: `x-internal-call: true` or a local-looking `Host` header skipped session authentication before multipart parsing and file persistence.
- Impact: a request routed through a proxy or exposed local endpoint could create unowned stored files without a user identity.
- Fix: remove the legacy bypass and require the common authenticated/internal-request gate before parsing multipart data.
- Verification: red-first authorization contract passes after the repair, together with cache/high-risk route contracts (3 files / 3 assertions); targeted ESLint error check and TypeScript checks passed.
- Deployment status: fixed locally, cloud verification pending.

## 2026-07-19 P1 repair: image cache proxy authentication

### SEC-011 / P1: Anonymous callers could trigger remote image retrieval and storage

- Location: `src/app/api/cache-image/route.ts`
- Evidence: the POST handler accepted `imageUrl`, passed it to remote `fetch`, then wrote the resulting bytes to the deployment filesystem and optional S3 backup without checking request identity.
- Impact: anonymous outbound bandwidth, storage, and cache-key consumption. Existing URL validation did not compensate for the missing identity boundary.
- Fix: enforce the shared authenticated/internal-request gate before JSON parsing, validation, or remote retrieval. Normal browser callers retain cookie-based authentication.
- Verification: the new handler-order contract failed before the guard and then passed. Combined SVG/video/cache contracts passed: 4 files / 4 assertions; targeted ESLint error check and TypeScript checks passed.
- Deployment status: fixed locally, cloud verification pending.

## 2026-07-19 P1 repair: video download proxy authentication

### SEC-010 / P1: Anonymous users could read allowed local videos or use the video proxy

- Location: `src/app/api/video/download/route.ts`
- Evidence: the GET handler performed local file resolution or remote HTTPS fetches solely from the `url` query parameter, without a request identity check.
- Impact: anonymous use of a media-proxy endpoint and potential access to otherwise unlinked local video paths.
- Fix: enforce the shared authenticated/internal-request gate before reading query input or any file/network operation; existing source-path and private-network checks remain in place.
- Verification: red-first route contract and media-toolbar video regression passed (2 files / 12 assertions); ESLint error check and TypeScript checks passed.
- Deployment status: fixed locally, cloud verification pending.

## 2026-07-19 P1 repair: video post-production request authentication

### SEC-009 / P1: Anonymous callers could initiate FFmpeg processing

- Location: `src/app/api/video/tools/route.ts`
- Evidence: the public handler accepted action and video URL payloads, then downloaded media and invoked FFmpeg without an identity check.
- Impact: anonymous callers could consume CPU, disk, temporary storage, and outbound bandwidth through video conversion operations.
- Fix: apply the shared session/internal-request guard before JSON parsing.
- Verification: red-first authorization contract passes after the repair; high-risk API and media-toolbar regression contracts also passed (3 files / 13 assertions). ESLint error check and TypeScript checks passed.
- Deployment status: fixed locally, cloud verification pending.

## 2026-07-19 P1 repair: SVG tracing request authentication

### SEC-008 / P1: Anonymous callers could start SVG vectorization work

- Location: `src/app/api/svg-trace/route.ts`
- Evidence: the POST handler parsed user input and entered credit/vectorization preparation before any request identity check. Its existing session lookup was used only to decide whether to charge credits.
- Impact: an unauthenticated caller could cause image retrieval and CPU-intensive vectorization without an accountable user.
- Fix: make the shared authenticated/internal-request gate the first POST operation. Browser and signed internal Agent requests retain supported authentication paths.
- Verification: handler-scoped regression test first failed and now passes. Together with the existing high-risk route contract: 2 files / 2 assertions passed; ESLint error check and TypeScript checks passed. This source file has 14 pre-existing ESLint warnings, none added by this repair.
- Deployment status: fixed locally, cloud verification pending.

## 2026-07-19 P1 repair: local image service startup authorization

### SEC-007 / P1: Unauthenticated request could trigger a local image-service start

- Location: `src/app/api/image/start-services/route.ts`
- Evidence: the public POST handler reached the fixed `spawn('iopaint', ...)` operation without checking a session or role. No application caller uses this endpoint, so normal image editing is unaffected by restricting it.
- Impact: an unauthenticated caller could consume server process and model resources or repeatedly trigger operational work.
- Fix: require an authenticated request, then enforce the administrator role before the first service health check or process spawn.
- Verification: the new contract test failed before the guard and passes after it. It ran with the existing high-risk API route contract: 2 files / 2 assertions passed; targeted ESLint and TypeScript checks passed.
- Deployment status: fixed locally, cloud verification pending.

## 2026-07-19 P0 repair: recovery operation authorization

### SEC-006 / P0: Public fallback key protected destructive recovery operations

- Location: `src/app/api/recover-images/route.ts`
- Evidence: the route accepted any authenticated identity and a repository-visible literal recovery key before allowing scan, recovery, and S3 synchronization. Targeted `filename` input also reached recovery file handling without a traversal guard.
- Impact: a normal signed-in user with the known key could initiate administrative restoration work and potentially access unintended filesystem paths.
- Fix: recovery now requires an administrator role for both GET and POST. The legacy/shared key path was removed, and targeted recovery rejects absolute, drive-qualified, null-byte, and traversal paths.
- Verification: `src/__tests__/api/recover-images-admin-contract.test.ts` failed first (3 failures) and passes after the repair. Combined with the high-risk authorization contract: 2 files / 4 assertions passed; targeted ESLint and TypeScript checks passed.
- Deployment status: fixed locally, cloud verification pending. Do not mark this issue closed until an administrator and a non-administrator session are exercised against the deployed route.

## 2026-07-18 生产依赖复扫

`pnpm audit --prod --json --registry=https://registry.npmjs.org` 已归档至 `test-results/npm-audit-prod-final-20260718.json`：`0 critical / 0 high / 5 moderate / 1 low`。本轮升级了 Next、相关 AWS SDK、OpenAI/Coze SDK 等生产依赖，并对间接依赖使用精确覆盖；对应版本锁定由 `dependency-security-contract.test.ts` 保护。

剩余中低风险依赖涉及构建工具链、ExcelJS 间接依赖与 Next 的 PostCSS 路径，尚未盲目跨主版本强制覆盖。它们不构成“无风险”结论，发布前仍应在干净环境复扫并完成构建门禁。

生成时间：2026-07-17
基线：`da4c37e` 加本轮未提交修改
范围：Next.js 16 / React 19 / TypeScript 路由、认证、文件与代理、支付/积分、客户端存储和依赖审计。未对非本项目外部系统进行攻击性测试。

## 结论

当前不能给出“安全通过”。本地已修复 1 个 P1 授权缺口，但云端匿名复验仍返回业务 `400` 而不是 `401`，说明修复尚未部署；依赖漏洞扫描、云端安全响应头、真实跨站验证仍未完成。

## 本地已修复，待部署

### SEC-001 / P1：工作流执行允许配置降级为匿名调用

- 位置：[workflow execute](../../src/app/api/workflow/execute/route.ts:134)
- 证据：此前只在 `MANDATORY_API_AUTH === 'true'` 时拒绝未认证调用，工作流可能执行模型任务。
- 影响：部署漏配环境变量时，匿名请求可能消耗模型资源并读取/操作任务。
- 修复：改用 `requireApiAuthOrReject`，未认证请求固定返回 401。
- 回归：`src/__tests__/api/high-risk-route-auth-contract.test.ts` 先稳定失败，修复后通过；`pnpm ts-check`、`pnpm lint --quiet`、483/483 测试和生产构建通过。
- 云端证据：2026-07-17，未携带凭据的 `POST /api/workflow/execute` 返回 `400 {"error":"缺少 executionId"}`，未在参数校验前拒绝匿名调用。必须部署本地修复并复验固定返回 401 后才能关闭此 P1。

## 未修复/待验证

### SEC-002 / P2：流程图下载产物使用宽松 Mermaid 安全级别

- 位置：[flowchart generate](../../src/app/api/flowchart/generate/route.ts:38)
- 证据：生成的可下载 HTML 引入第三方 Mermaid CDN，配置 `securityLevel: 'loose'` 并把渲染 SVG 写入 `innerHTML`。
- 影响：用户打开由不可信 Mermaid 内容生成的下载文件时，可能扩大本地 HTML/脚本注入风险。
- 建议：优先使用 Mermaid 的严格安全级别、清理 SVG，并改为受控/固定版本资源；修改前需验证图表兼容性。

### SEC-003 / P2：应用代码中未发现统一的安全响应头

- 位置：[next.config.ts](../../next.config.ts:1)、[proxy.ts](../../src/proxy.ts:30)
- 证据：未发现 CSP、`X-Content-Type-Options`、点击劫持防护、`Referrer-Policy` 或 `Permissions-Policy` 的应用级设置。
- 影响：若 Coze 边缘层未补充这些头，XSS、内容嗅探和嵌入防护会较弱。
- 建议：先在云端抓取实际响应头；确认平台未设置后，以兼容所需图片、模型与 CDN 的最小 allowlist 增加头策略。

### SEC-004 / P2：用户自配供应商密钥保存在浏览器 localStorage

- 位置：[universal-api-manager](../../src/lib/universal-api-manager.ts:14)、[client-crypto](../../src/lib/client-crypto.ts:1)
- 证据：API Key 经过浏览器侧 AES-GCM 包装后保存；加密盐和派生材料同样由浏览器可读状态构成，代码也允许加密失败时保存明文回退。
- 影响：XSS 或本机浏览器受控时，用户自配密钥可被取出；这不是服务端管理员密钥泄漏证据。
- 建议：生产默认改为服务端密钥托管，明确提示仅可在本机模式保存用户密钥，并移除明文回退。

### SEC-005 / 未验证：依赖漏洞审计

- 证据：镜像审计端点不存在；官方 npm 审计端点在 120 秒内超时。
- 影响：无法得出依赖零漏洞结论。
- 解除条件：在可用网络环境使用可信 registry 重新运行 `pnpm audit --prod --json`，归档原始结果。

## 正向检查

## 2026-07-19 Dependency Audit Closure

- The official production audit was rerun with `pnpm audit --prod --json --registry=https://registry.npmjs.org` after the lockfile update. Result: `0 critical / 0 high / 0 moderate / 0 low` across 710 production dependencies.
- `exceljs@4.4.0` previously resolved `uuid@8.3.2`, which the official audit reported as `CVE-2026-41907` (moderate). `package.json` now constrains the transitive package through `pnpm.overrides.uuid: 11.1.1`; `pnpm-lock.yaml` and `pnpm why uuid` both resolve `exceljs -> uuid@11.1.1`.
- The dependency contract was red first, then passed after the override. The GitHub Actions quality workflow now runs the same official production audit before the build gate, so new production advisories fail CI rather than being left to a manual sweep.
- This closes the local dependency-audit verification gap only. Cloud security acceptance and the remaining explicitly listed application risks are still pending.

## 2026-07-19 Dependency Audit Remediation

- `pnpm audit --prod --json --registry=https://registry.npmjs.org` now reports **0 critical, 0 high, 0 low, and 1 moderate** production vulnerability, down from 0 critical, 0 high, 1 low, and 5 moderate.
- Patched by lockfile-constrained overrides: `@babel/core` 7.29.6, `postcss` 8.5.20, `brace-expansion` 1.1.13 and 2.0.3. `drizzle-kit` was moved from production dependencies to development dependencies because application source imports `drizzle-orm`, not the CLI.
- The dependency policy was red-tested first and is now green in `src/__tests__/lib/dependency-security-contract.test.ts` (2/2). Full `test:api` (50 files / 116 tests), `test:regression`, lint, TypeScript, and production build completed successfully after the lockfile update.
- Remaining `uuid@8.3.2` is supplied through `exceljs@4.4.0`. The advisory affects `uuid` APIs `v3`, `v5`, and `v6` only when callers provide invalid external buffers; the installed ExcelJS code path uses `uuid.v4()`. It is retained as a documented moderate residual risk rather than forcing an incompatible major override into ExcelJS. Review it whenever ExcelJS publishes a compatible update or the application begins using affected UUID APIs.

## 2026-07-20 P0 legacy authentication secret rotation

- Commit `3a70a634` restored cloud login by allowing the source-visible legacy authentication constant to become the active production session-signing key and by falling back to it when no secret was available. That creates a session-forgery risk and failed the existing production security contract.
- The local candidate no longer signs with that public value. When the database still contains it, the server generates a cryptographically random 48-byte replacement, persists it before signing, and keeps the legacy value only in password-hash migration logic. If persistence fails and no environment/file secret exists, production authentication fails closed.
- `pnpm doctor` was also restored from an unconditional-success command. Coze startup now runs the real checker in `--startup` mode: secrets and bootstrap credentials remain visible warnings for an existing database-backed deployment, while database/runtime failures still stop startup. Strict `--production` release checks remain unchanged.
- Red-green evidence: `server-auth-legacy-rotation.test.ts`, `server-auth-production-security.test.ts`, `doctor-production-auth-contract.test.ts`, and `coze-production-preview-contract.test.ts`.
- Cloud closure is pending. The first deployment of this candidate may invalidate sessions signed by the legacy key; a fresh saved-credential login and direct-domain refresh are required before closing the P0 item.

- 会话 cookie 在服务端认证层使用 HTTP-only、SameSite 和生产环境 Secure 配置。
- `/api/proxy-3d-model` 需要认证，并对 URL 协议、私网地址和域名进行限制；`Access-Control-Allow-Origin: *` 仍需要结合真实跨域请求验证。
- 已有测试覆盖支付路由、任务所有权、管理员用户审计和高风险路由授权的一部分场景。
