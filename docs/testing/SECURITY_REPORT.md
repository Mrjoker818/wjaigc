# 安全测试报告

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

- 会话 cookie 在服务端认证层使用 HTTP-only、SameSite 和生产环境 Secure 配置。
- `/api/proxy-3d-model` 需要认证，并对 URL 协议、私网地址和域名进行限制；`Access-Control-Allow-Origin: *` 仍需要结合真实跨域请求验证。
- 已有测试覆盖支付路由、任务所有权、管理员用户审计和高风险路由授权的一部分场景。
