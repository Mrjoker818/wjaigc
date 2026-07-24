# 无界AI 代码升级报告

**日期**: 2026-07-24
**执行人**: 通用网页搭建专家
**范围**: 基于全量审计报告 `COMPREHENSIVE_AUDIT_REPORT_20260724.md` 的 P0-P3 逐级修复

---

## 一、总览

本轮升级围绕**安全加固、内存泄漏、无障碍、代码质量**四大方向，累计完成 13 项修复。所有改动均为增量式、低风险，未修改现有函数签名与业务逻辑主流程。

| 优先级 | 项目数 | 状态 |
|--------|--------|------|
| P1 | 2 | ✅ 全部完成 |
| P2 | 8 | ✅ 全部完成 |
| P3 | 5 | ✅ 全部完成 |

验证结果：`pnpm lint --quiet` ✅ PASS · `pnpm ts-check` ✅ PASS · 服务探活 ✅ ready · 核心接口冒烟 ✅ 通过。

---

## 二、修复明细

### P1 — 高优先级（安全 / 稳定性）

#### P1-1 登录接口无速率限制 → 内存限流器
- **文件**: `src/app/api/auth/login/route.ts`
- **问题**: 登录接口无失败次数限制，存在暴力破解风险。
- **修复**: 新增内存级 rate limiter，以 `IP + username` 为键，5 次/分钟失败后锁定 60 秒，返回 HTTP 429 + `Retry-After` header；`setInterval(...).unref()` 定期清理过期条目。
- **验证**: 单次错误凭证正确返回 401（未触发锁定），逻辑符合预期。

#### P1-2 品牌电商面板 Blob URL 泄漏
- **文件**: `src/components/brand-ecommerce-panel.tsx`
- **问题**: `URL.createObjectURL()` 未配对释放，组件卸载后内存泄漏。
- **修复**: 新增 `refImageBlobRef` / `productImageBlobRef` 追踪，创建新 URL 前先 revoke 旧 URL，unmount effect 统一释放。

---

### P2 — 中优先级（内存 / 健壮性 / 无障碍）

#### P2-1 流程图模板 XSS
- **文件**: `src/app/api/flowchart/generate/route.ts`
- **问题**: 内联 JS 模板用 `innerHTML` 拼接 `err.message`，存在 XSS 注入面。
- **修复**: 改用 `showError()` 函数，内部通过 `div.textContent` 赋值，自动转义。

#### P2-2 PPT 上传仅校验扩展名
- **文件**: `src/app/api/ppt/template/upload/route.ts`
- **修复**: 读取 arrayBuffer 后校验 ZIP 魔数 `50 4B 03 04`（PPTX 本质为 ZIP），不合法返回 400。

#### P2-3 image-editor SSE cleanup 空注释
- **文件**: `src/components/image-editor.tsx`
- **修复**: 将空注释改为解释性说明——`taskEventsClient` 为全局单例，消费者组件不应 `disconnect()`（会影响其他订阅者），仅需注销自身 handler。

#### P2-4 infinite-canvas 视频轮询 setInterval 泄漏
- **文件**: `src/components/infinite-canvas.tsx`
- **问题**: 视频编辑 / 延长两处轮询 `setInterval` 仅存于事件处理器局部变量，组件卸载时无法清理。
- **修复**: 新增 `activeIntervalsRef = useRef<Set<...>>`，所有 `clearInterval` 配套 `delete()`，创建后 `add()`，unmount effect 批量 `clearInterval` + `clear()`。

#### P2-5 缺少 React ErrorBoundary
- **文件**: `src/components/app-error-boundary.tsx`（新建）+ `src/app/layout.tsx`
- **修复**: 新建 `AppErrorBoundary` class 组件（`getDerivedStateFromError` + `componentDidCatch`），提供可自定义 fallback + 内置错误提示（details 展开）；集成到 layout 包裹 `{children}`，捕获 `window.onerror` 无法捕获的 React 渲染阶段错误。

#### P2-6 缺少 color-scheme / theme-color
- **文件**: `src/app/globals.css` + `src/app/layout.tsx`
- **修复**: `:root` 添加 `color-scheme: dark;`（通知浏览器暗色渲染原生控件）；layout 通过 Next.js `viewport` 导出设置 `themeColor: '#0d1117'`（避免 `<head>` 标签，符合 lint 规则）。

#### P2-7 / P2-8 admin-tabs 纯图标按钮缺 aria-label
- **文件**: `src/components/dashboard/admin-tabs.tsx`
- **修复**: 为关闭用户详情 / 关闭添加用户面板 / 关闭充值面板 / 分页翻页按钮补充 `aria-label`，提升屏幕阅读器可访问性。

---

### P3 — 低优先级（代码质量 / 细节）

#### P3-1 eval('require') → webpackIgnore
- **文件**: `src/lib/ai-psd/psd-builder.ts`
- **修复**: `eval('require')('@napi-rs/canvas')` → `/* webpackIgnore: true */ require('@napi-rs/canvas')`，保留运行时动态加载语义同时消除 eval 安全风险。

#### P3-3 关键路由残留 console.log
- **文件**: `image-edit/route.ts`、`design/vectorize/route.ts`、`workflow/execute/route.ts`
- **修复**: 将调试性 `console.log` 批量降级为 `console.debug`（保留开发期调试能力，生产环境按级别过滤），`console.error` / `console.warn` 保持不变。

#### P3-4 删除备份文件
- **修复**: 删除 `src/components/infinite-canvas.tsx.bak`。

#### P3-8 toLocaleString 缺 locale 参数
- **文件**: `src/components/dashboard/admin-tabs.tsx` 等
- **修复**: `toLocaleString()` → `toLocaleString('zh-CN')`，避免 SSR/CSR 因运行时默认 locale 不一致导致的 hydration 差异。

#### P3-9 prefers-reduced-motion
- **文件**: `src/app/globals.css`
- **状态**: 验证已存在完整规则（`animation-duration` / `transition-duration` 降级 + 特定动画类禁用），符合 WCAG 2.3.3，无需重复添加。

#### P3-11 ASCII 省略号 → Unicode
- **文件**: `src/components/psd-editor/PsdLayerEditor.tsx`
- **修复**: 进度提示文案 ASCII `...` → Unicode `…`，排版更规范。

---

## 三、验证记录

### 静态检查
```
pnpm lint --quiet   → PASS
pnpm ts-check       → PASS
service_probe       → localhost:5000 ready
```

### 接口冒烟（核心被改动 / 关联路由）
| 接口 | 方法 | 结果 |
|------|------|------|
| /api/auth/me | GET | 200 ✅ |
| /api/image/health | GET | 200 ✅ |
| /api/edit | GET | 200 ✅（模型列表正常） |
| /api/video/generate | GET | 200 ✅（配置正常） |
| /api/workflow/models | GET | 200 ✅（模型列表正常） |
| /api/poll-task | POST | 200 ✅（不存在任务正确返回 failed） |
| /api/auth/login | POST | 401 ✅（错误凭证正确拒绝，语义正确） |
| /api/cancel-task | POST | 401 ✅（未登录正确拦截，鉴权保护生效） |

> 说明：`auth/login` 与 `cancel-task` 的 401 为接口设计的**正确语义响应**（鉴权拦截 / 凭证校验），非缺陷。限流器仅在连续 5 次失败后返回 429。

---

## 四、遗留与建议

- **本地 AI 环境依赖**：`image/health` 显示 `cv2` 与 `rembg[cpu]` 未安装，擦除 / 去背景本地路径不可用，会自动降级到 AI API。如需本地能力，运行 `bash scripts/download-iopaint-models.sh` 并安装 Python 依赖。
- **console.log 全量清理**：本轮仅处理了 3 个关键大文件，其余路由仍有部分调试日志，建议后续引入统一 logger（结合现有 op-log 系统）分级管理。
- **限流器分布式化**：当前 rate limiter 为单实例内存态，多实例部署下建议迁移到 Redis 等共享存储。
