# 无界AI全平台测试计划

> 版本: v1.0 | 生成时间: 2026-07-20 | 基于测试计划 Word 文档

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
