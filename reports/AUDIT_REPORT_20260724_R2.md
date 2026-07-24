# 无界AI 全面审计报告 R2

**审计时间**: 2026-07-24  
**审计类型**: 只读检测（不修改任何源代码）  
**项目版本**: v3.8.0  
**扫描范围**: 178 个 API Route、87 个 API 目录、全量前端组件、构建配置、日志

---

## 执行摘要

| 等级 | 问题数 | 说明 |
|------|--------|------|
| P0 严重 | 2 | 构建直接失败 / 运行时中断风险 |
| P1 高危 | 3 | 安全响应头完全缺失 / securityLevel 松散设置 / 生产环境鉴权不一致 |
| P2 中等 | 5 | 配置过于宽松 / 内存泄漏风险 / 非最佳实践 |
| P3 低危 | 4 | 代码质量 / 可维护性 |
| 正常 | 多处 | 以下各节均逐一标注 |

---

## 一、构建健康（P0）

### 1.1 @napi-rs/canvas webpack 编译失败（P0·CRITICAL）

**来源**: `/app/work/logs/bypass/app.log`，明确记录 "Build failed because of webpack errors"

**错误链**:
```
@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node
  ← psd-builder.ts
    ← task-worker.ts
      ← src/app/api/ai-psd/create/route.ts
```

**根因**: `.node` 原生二进制模块被 webpack 当作普通 JS 解析，触发 "Module parse failed: Unexpected character '\u007f'"（ELF 魔数）。

**当前 `serverExternalPackages` 已包含的包**（next.config.ts line 7–14）:
```
wasm_vtracer, aws-sdk, langchain, @langchain/*, coze-coding-dev-sdk,
@huggingface/*, onnxruntime-node, dotenv
```
**缺失**：`@napi-rs/canvas` 未列入。

**影响**: 生产环境 `.next` 目录可能构建不完整，部分包含 `ai-psd` 的代码路径在生产环境中不可用。

**建议修复**（仅供参考，本轮不改代码）:
在 `next.config.ts` 的 `serverExternalPackages` 数组中追加 `'@napi-rs/canvas'`，并在 webpack externals 中添加对应处理。

---

### 1.2 生产构建目录状态（P0·WARN）

**来源**: app.log 显示 Build failed，`.next` 目录状态存疑。

**影响**: 若当前部署依赖旧构建，`ai-psd` 相关功能在新部署后可能失效。

---

## 二、安全响应头（P1）

### 2.1 完全缺失 HTTP 安全响应头（P1·HIGH）

**来源**: `next.config.ts` — 全文无 `headers()` 配置函数。

**缺失项**:

| 响应头 | 作用 | 风险 |
|--------|------|------|
| `Content-Security-Policy` | 限制资源加载来源，防 XSS | 无 CSP 则任意脚本可注入 |
| `X-Frame-Options` | 防点击劫持 | 可被嵌入 iframe 伪装 |
| `X-Content-Type-Options: nosniff` | 防 MIME 嗅探 | 浏览器可能错误解析响应 |
| `Referrer-Policy` | 控制 Referer 头泄漏 | URL 含 token 时泄漏 |
| `Permissions-Policy` | 关闭不需要的浏览器 API | 摄像头/麦克风滥用 |
| `Strict-Transport-Security` | 强制 HTTPS | 中间人降级 |

**建议**: 在 `next.config.ts` 中添加 `headers()` 配置，对所有页面路径 `'/(.*)'` 注入上述头部。

---

### 2.2 Mermaid securityLevel: 'loose'（P1·HIGH）

**来源**: `src/app/api/flowchart/generate/route.ts:40`

```js
mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
const code = ${JSON.stringify(mermaidCode)};
```

**问题**:
- `securityLevel: 'loose'` 允许 Mermaid 图表中嵌入任意 HTML/JS（即 Mermaid 官方文档中明确标注的"不安全"模式）。
- `mermaidCode` 来自 LLM 生成，LLM 输出理论上可被提示注入控制，从而在 Mermaid 图中嵌入恶意 HTML。
- 生成的 HTML 页面通过 `container.innerHTML = result.svg` 直接插入 DOM。

**注意**: `mermaidCode` 已用 `JSON.stringify` 包裹（字符串安全），`showError` 已改用 `textContent`（已有防护）。但 `securityLevel: 'loose'` 本身允许图表节点中的标签直接渲染为 HTML，风险来自 **LLM 生成的 Mermaid 代码本身**，而非 `mermaidCode` 变量注入。

**建议**: 改为 `securityLevel: 'strict'`（默认值），除非有明确的富文本节点需求。

---

### 2.3 API 路由鉴权覆盖不均匀（P1·MEDIUM）

**扫描结果**: 178 个 `route.ts` 文件中，仅 **31 个**含 `requireAdminUser` 或 `getRequestUser`。

**已有鉴权的路由**（10个示例）:
- `admin/users`、`admin/apis`、`admin/settings`、`admin/op-log`
- `export-project`、`admin/backups`

**疑似缺少鉴权的高风险路由**（仅列举）:
- `POST /api/generate` — 消耗 API 额度，无明显用户绑定检查
- `POST /api/video/generate` — 同上
- `POST /api/image-to-3d` — 同上
- `POST /api/agent-edit` — 调用 LLM 循环，费用高

**说明**: 部分路由可能通过 middleware 或内部 `findProviderForModel` 间接做了隔离，本次未全量读取每个路由文件，此项为**疑似**，需逐一核实。

**建议**: 对所有消耗外部 API 额度的路由（generate/video/3d/agent/workflow/edit 系列）添加用户身份验证，防止未授权调用。

---

## 三、Next.js 配置问题（P2）

### 3.1 images.remotePatterns 允许全部 HTTPS 域名（P2·MEDIUM）

**来源**: `next.config.ts:41–45`

```ts
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '*', pathname: '/**' },
  ],
},
```

**问题**: `hostname: '*'` 使 `<Image>` 组件可代理任意 HTTPS 域名的图片，攻击者可构造链接让服务端代理任意第三方图片，形成 **SSRF（服务端请求伪造）** 的潜在向量，同时增加带宽开销。

**建议**: 列举实际需要的域名白名单（如 `*.amazonaws.com`、`*.coze.site`、`blob.vercel-storage.com` 等），禁止通配符。

---

### 3.2 Turbopack 已禁用（P2·INFO）

**来源**: `next.config.ts` 注释

```
// 禁用 turbopack，避免 HMR "Router action" error
```

**问题**: 开发体验回退到 webpack，HMR 速度较慢。该问题为已知的 Turbopack 兼容性 bug，建议持续跟进 Next.js 版本更新。

---

### 3.3 proxyTimeout 600s + proxyClientMaxBodySize 50MB（P2·INFO）

**来源**: `next.config.ts`

这是为了支持大图/视频上传而设置的，配置合理，但：
- 600s 超时窗口下若上游 API 卡住，占用服务端连接资源。
- 50MB body 上限应确保上传接口本身有文件类型和大小二次校验（见 §5.1 结论：已有）。

---

## 四、内存泄漏风险（P2）

### 4.1 URL.createObjectURL — chat-area.tsx（已修复 ✅）

**扫描结果**: `src/components/simple-chat/chat-area.tsx` 共 7 处 `createObjectURL`，均配对了 `revokeObjectURL`，无泄漏。

```
line 975 createObjectURL → line 980 revokeObjectURL  ✅
line 1023/1038/1047/.../1065/1074 均同轮配对         ✅
```

---

### 4.2 URL.createObjectURL — 其他组件（待关注 P2）

**文件及位置**:

| 文件 | createObjectURL 次数 | revokeObjectURL 次数 | 状态 |
|------|----------------------|----------------------|------|
| `scene-studio-panel.tsx` | 2 | 未检测到对应 revoke | ⚠️ 疑似泄漏 |
| `display3d-panel.tsx` | 4 (lines 497/670/702/714) | 未检测到 | ⚠️ 疑似泄漏 |
| `audio-player.tsx` | 1 (line 144) | 未检测到 | ⚠️ 疑似泄漏 |

**影响**: 长时间使用（大量上传/切换3D模型/播放音频）导致浏览器内存持续增长，最终可能导致页面崩溃。

**建议**: 在 `useEffect` cleanup 函数中或使用完毕后调用 `URL.revokeObjectURL(blobUrl)`。

---

### 4.3 setInterval 清理（P2·MEDIUM）

| 文件 | 行号 | 是否有 clearInterval |
|------|------|----------------------|
| `brand-kit-panel.tsx` | ~915 (QR 倒计时 + readModel) | readModel 所在 useEffect 有 `return () => clearInterval(interval)` ✅；QR timer 需确认 |
| `dashboard-view.tsx` | ~439 | 需确认 useEffect cleanup |
| `video-generation-panel.tsx` | ~1676 (progressTimer) | line 1745 + 1773 均调用 `clearInterval(progressTimer)` ✅ |
| `infinite-canvas.tsx` | 多处 | 已有 `activeIntervalsRef` 统一追踪 + unmount 清理 ✅ |

**结论**: video-generation-panel 和 infinite-canvas 已处理。`dashboard-view.tsx` 的 setInterval 需人工复查是否在 useEffect 中返回了 cleanup。

---

## 五、输入验证与 XSS（P2/P3）

### 5.1 文件上传类型校验（正常 ✅）

- `src/app/api/upload/route.ts:45` — 使用 `getSafeRasterImageExtension(file.type)` 白名单校验
- `src/app/api/save-image/route.ts` — 使用 `safeMedia.extension/mimeType` 校验
- `src/app/api/simple-chat/upload-file/route.ts` — 按 type/ext 分支处理

**结论**: 文件上传类型校验覆盖完善。

---

### 5.2 innerHTML 使用（P3·LOW）

| 文件 | 行号 | 内容 | 风险 |
|------|------|------|------|
| `simple-chat/chat-area.tsx` | 1086 | `toast.innerHTML = \`<span>...已添加${imageUrls.length}张图片...</span>\`` | imageUrls.length 为数字，无 XSS 风险，但使用 innerHTML 属于非最佳实践 |
| `ui/chart.tsx` | 83 | `dangerouslySetInnerHTML` 注入主题 CSS | color 来自配置对象非用户输入，shadcn 标准写法，可接受 |
| `flowchart/generate/route.ts` | 48/53 | `container.innerHTML = result.svg` | SVG 来自 Mermaid 渲染，结合 §2.2 securityLevel:loose 有潜在风险 |
| `lib/user-manager.ts` | 1805 | 导出 HTML 时 img onerror 行内 innerHTML | 仅用于导出文件，非页面渲染，风险可控 |

**建议**: `chat-area.tsx:1086` 改用 `toast.textContent` 或封装组件；其余可接受。

---

### 5.3 命令注入（正常 ✅）

**文件**: `src/app/api/export-project/route.ts:165`

```ts
execSync(findCmd)  // findCmd = PROJECT_ROOT + EXCLUDE_COMMON 常量拼接
```

- `findCmd` 由服务端常量组成，不含任何用户输入
- GET 入口有 `requireAdminUser` 鉴权保护（line 181–184）

**结论**: 风险可控。

---

## 六、代码质量（P3）

### 6.1 console.log 滞留（P3·LOW）

**扫描结果**: API 路由层（`src/app/api/`）共存在 **322 处** `console.log` 调用。

**问题**: 生产环境 console.log 会写入服务端日志，在请求密集时造成性能开销，并可能意外输出敏感信息（参数/URL/用户 ID）。

**建议**: 统一使用 `op-log.ts` 的结构化日志函数（`logOpSuccess/logOpError/logOpWarn`），移除调试性 console.log；或引入日志级别控制（`LOG_LEVEL=debug` 环境变量）。

---

### 6.2 TypeScript any 类型（P3·LOW）

**扫描结果**: `src/app/api/` 共 **3 处** `: any` 显式标注，数量极少。

**结论**: TypeScript 类型覆盖整体良好。

---

### 6.3 @ts-ignore / @ts-expect-error 抑制（正常 ✅）

**扫描结果**: 全量 API 路由 + 组件目录中，**0 处**使用 `@ts-ignore` 或 `@ts-expect-error`。

**结论**: 无类型抑制，类型健康度高。

---

### 6.4 性能优化覆盖（P3·INFO）

| 组件 | useMemo/useCallback/memo 数量 | 评估 |
|------|-------------------------------|------|
| `infinite-canvas.tsx` | 111 处 | 覆盖充分 ✅ |
| `node-editor.tsx` | 64 处 | 覆盖较好 ✅ |
| `chat-panel.tsx` | 30 处 | 基本覆盖 ✅ |

**代码分割**: `src/app/page.tsx` 对 `CanvasWorkspace` 使用了 `dynamic()` + `Suspense`，首屏加载有优化。

---

## 七、环境变量与配置（P3）

### 7.1 缺失环境变量警告（P3·INFO）

**来源**: app.log

```
WARN: APIMART_API_KEY 未配置
WARN: GEMINI_API_KEY 未配置
WARN: object-storage 凭证需验证
```

**说明**: 这些均为可选配置，系统有降级逻辑，不影响核心功能。但在生产部署时建议通过 CI/CD 配置检查确保必要变量已注入。

---

### 7.2 构建摘要（参考）

**来源**: app.log

```
32 passed, 7 warnings, 0 failed
```

32 项静态检查通过，7 项警告（环境变量类）。

---

## 八、汇总问题清单

| # | 等级 | 文件/位置 | 问题描述 | 建议操作 |
|---|------|-----------|----------|----------|
| 1 | P0 | `next.config.ts` + `psd-builder.ts` | `@napi-rs/canvas` 未加入 serverExternalPackages，生产构建失败 | 追加到 serverExternalPackages |
| 2 | P0 | `.next/` 目录 | 生产构建可能不完整 | 修复 #1 后重新 `pnpm build` |
| 3 | P1 | `next.config.ts` | 完全缺失安全响应头（CSP/X-Frame/HSTS等） | 添加 headers() 配置 |
| 4 | P1 | `flowchart/generate/route.ts:40` | `mermaid securityLevel: 'loose'` 允许 HTML 注入 | 改为 `'strict'` |
| 5 | P1 | 178个 route.ts 中仅31个有鉴权 | 高成本 API 路由（generate/video/3d/agent）可能无用户验证 | 逐一审查并添加 getRequestUser |
| 6 | P2 | `next.config.ts:41` | `images.remotePatterns hostname:'*'` 允许代理任意 HTTPS 域名 | 改为域名白名单 |
| 7 | P2 | `scene-studio-panel.tsx` | URL.createObjectURL 疑似无对应 revoke（2处） | 添加 revokeObjectURL |
| 8 | P2 | `display3d-panel.tsx` | URL.createObjectURL 疑似无对应 revoke（4处） | 添加 revokeObjectURL |
| 9 | P2 | `audio-player.tsx:144` | URL.createObjectURL 疑似无对应 revoke | 添加 revokeObjectURL |
| 10 | P2 | `dashboard-view.tsx:439` | setInterval 是否有 useEffect cleanup 需人工确认 | 确认并补 clearInterval |
| 11 | P3 | `src/app/api/` 全量 | 322 处 console.log，生产日志噪声大 | 改用结构化 op-log |
| 12 | P3 | `chat-area.tsx:1086` | toast.innerHTML 含模板字符串（风险低，非最佳实践） | 改用 textContent/JSX |
| 13 | P3 | `next.config.ts` 注释 | Turbopack 禁用导致开发 HMR 较慢 | 跟进 Next.js 版本升级 |
| 14 | P3 | `.env` / 部署配置 | APIMART/GEMINI/对象存储未配置警告 | 在 CI/CD 中补全 |

---

## 九、已验证正常项

以下项目经本次扫描确认无问题，不需要处理：

- **文件上传类型校验**: upload/save-image/simple-chat 均有白名单校验 ✅
- **命令注入 (execSync)**: findCmd 为常量拼接 + 管理员鉴权 ✅
- **chat-area.tsx Blob revoke**: 7处 createObjectURL 均配对 revokeObjectURL ✅
- **video-generation-panel progressTimer**: clearInterval 已覆盖 ✅
- **infinite-canvas.tsx setInterval**: activeIntervalsRef 统一管理 ✅
- **chart.tsx dangerouslySetInnerHTML**: shadcn 标准主题注入，非用户输入 ✅
- **TypeScript @ts-ignore**: 全量0处 ✅
- **TypeScript any**: 仅3处，覆盖极小 ✅
- **代码分割**: dynamic() + Suspense 已应用于主工作台 ✅
- **pnpm 静态检查**: 32 passed, 0 failed ✅

---

*报告生成于 2026-07-24 | 仅检测不修改 | 下一步修复建议见各节"建议"字段*
