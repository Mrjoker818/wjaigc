# 无界AI全平台测试计划

> 版本: v1.0 | 生成时间: 2026-07-20 | 基于测试计划 Word 文档

## WJ-STABLE-001 Stage 0 补充

Stage 0 只建立版本基线、受保护功能目录、兼容样本、证据格式和发布门禁，不修改供应商、任务、积分、认证、画布、节点或聊天业务行为。

浏览器冒烟 `tests/e2e/stage-0-evidence.spec.ts` 仅验证：

1. 部署地址可以返回页面文档。
2. 最终页面与目标部署地址同源。
3. 页面主体存在。
4. 首屏没有未捕获 `pageerror`。

该冒烟不验证登录、生成、扣费、保存、支付、PostgreSQL 并发、对象存储或供应商结果。云端运行 SHA 无法由 `E2E_DEPLOYMENT_COMMIT` 确认时，即使页面可打开也必须记录为 `blocked`。

证据目录：

```text
test-results/evidence/<commit>/<featureId>/<browser>/<timestamp>/
```

执行示例：

```powershell
$env:E2E_BASE_URL = "https://www.wjaigc.top/"
$env:E2E_ALLOW_BLOCKED = "true"
pnpm exec playwright test tests/e2e/stage-0-evidence.spec.ts --project=chromium
```

---

## 测试范围

对"无界AI全聚合AI工具平台"进行完整的黑盒测试、白盒测试、接口测试、真实浏览器端到端测试、异常测试、安全检查和回归测试。

## 测试策略

### 测试金字塔

```
        /\
       /  \     E2E 测试 (21项, 3浏览器)
      /    \    浏览器: Chromium / Firefox / WebKit
     /------\   
    /        \  API 测试 (98项)
   /          \ 工具: Vitest + fetch
  /------------\
 /              \ 静态扫描 (2项)
/________________\ 工具: tsc + eslint
```

### 测试类型覆盖

| 测试类型 | 工具 | 用例数 | 覆盖范围 |
|---------|------|--------|---------|
| 静态代码扫描 | TypeScript + ESLint | 2 | 全量源码 |
| API 接口测试 | Vitest | 46 | 登录/生成/轮询/同步/取消/保存/注销/安全/并发 |
| 异常混沌测试 | Vitest | 21 | HTTP错误码/模型异常/重复提交/中断/边界值/稳定性 |
| 安全测试 | Vitest | 31 | OWASP Top 10 |
| E2E 浏览器测试 | Playwright | 21 | Chromium/Firefox/WebKit |
| 健康检查 | doctor.mjs | 36 | 环境/数据库/存储/依赖/端口 |

### 浏览器矩阵

| 浏览器 | 分辨率 | 核心流程 | 上传 | 画布操作 | 模块遍历 |
|--------|--------|---------|------|---------|---------|
| Chromium | 1280x720 | ✅ | ✅ | ✅ | ✅ |
| Firefox | 1280x720 | ✅ | — | — | — |
| WebKit | 1280x720 | ✅ | — | — | — |
| Chromium HD | 1920x1080 | — | — | — | — |

## 环境要求

```
Node.js: >= 24
pnpm: >= 8
Playwright: 1.60+
Vitest: 4.1+
```

## 环境变量

```bash
E2E_BASE_URL=http://127.0.0.1:5000
E2E_TEST_USERNAME=<测试用户名>
E2E_TEST_PASSWORD=<测试密码>
E2E_GENERATION_MODEL=<providerId::modelId>
E2E_ENABLE_PAID_GENERATION=false  # 仅审批后开启
```

## 执行命令

```bash
# 健康检查
pnpm doctor

# 静态检查
pnpm ts-check && pnpm lint

# API 测试
E2E_BASE_URL=... npx vitest run tests/api/

# E2E 测试 (Chromium)
E2E_BASE_URL=... npx playwright test --project=chromium

# 全量 E2E
E2E_BASE_URL=... npx playwright test

# 构建
pnpm build
```

## CI 质量门禁

GitHub Actions 工作流: `.github/workflows/ci.yml`
- 触发: push/PR 到 main
- 门禁: TypeScript → ESLint → API测试 → E2E(Chromium) → 构建
- P0/P1 失败禁止合并

## 发布通过标准

- [x] P0 问题数量为 0
- [x] P1 问题数量为 0
- [x] 核心 E2E 测试通过率 100%
- [x] 全量自动化测试通过
- [x] Chromium、Firefox、WebKit 核心流程通过
- [x] 没有未处理的 Console Error
- [x] 没有未处理的 Promise 异常
- [x] 登录、上传、生成、保存、刷新恢复、下载流程通过
- [x] 每个菜单模块都有测试结果
- [x] 修复后的 Bug 都有永久回归测试
- [x] 所有未验证项目被明确列出

---

## V5.8.8 只读画布分享发布门禁

详细证据与诚实边界见 `docs/testing/read-only-canvas-share-evidence.md`。本功能在以下全部条件完成前保持 `WUJIE_CANVAS_SHARE_ENABLED` 默认关闭：

1. 公开 JSON、日志、错误体和测试 artifact 的私密字段扫描通过。
2. 使用真实 `POSTGRES_TEST_DATABASE_URL` 完成 schema、快照、owner/public 生命周期和并发竞态测试。
3. Chromium 桌面及 320/375/393 移动矩阵、no-write 网络门禁通过。
4. Firefox / WebKit 功能矩阵取得真实证据。
5. P0、Stage 2、Stage 3、Stage 4 与完整本地测试没有回归。
6. 云端仅对已推送的 exact main commit 验收，不接受未提交 worktree 或合成 fixture 代替。

本地核心命令：

```bash
pnpm exec vitest run src/__tests__/lib/canvas-share-security-regression.test.ts tests/integration/canvas-share-concurrency-postgres.test.ts
pnpm check:protected-baseline
pnpm test
pnpm validate
```

真库命令必须显式设置隔离的 `POSTGRES_TEST_DATABASE_URL`；环境变量缺失时 PostgreSQL 用例的 skip 只表示“未验证”，不表示通过。云端验收顺序固定为：匿名有效链接、默认无下载、显式下载、撤销、过期、旧快照不可变、媒体失效占位、320/375/393。
