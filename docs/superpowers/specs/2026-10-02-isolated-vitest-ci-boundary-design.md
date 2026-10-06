# 隔离 Vitest CI 数据库边界设计

日期：2026-10-02。范围：两个普通全量测试作业的数据库连接准入，不改变产品数据库、测试断言或 E2E 环境。

## 问题与目标

`quality.yml` 的 `static-and-tests` 作业继承 `PGDATABASE_URL` 密钥，却直接执行 `pnpm test`，没有 `POSTGRES_TEST_DATABASE_URL`。`stage-0-quality.yml` 的 `stage-1-local-gates` 也直接执行全量测试。部分测试使用真实 PostgreSQL，另一些在缺少测试库时跳过；所以当前命令既不能证明完整回归，也不能证明不会误连业务库。

第一阶段目标是让这两个全量测试步骤在载入任何测试前确定：`DATABASE_URL`、`PGDATABASE_URL`、`POSTGRES_TEST_DATABASE_URL`、`TEST_POSTGRES_URL` 完全相同，且 URL 为显式端口的 `127.0.0.1` PostgreSQL 专用 `wujie_bridge_test_*` 数据库。错误、缺失或不一致必须退出非零，不输出连接串或凭据。通过后才执行原 Vitest 全量范围，不排除测试文件。

## 方案选择

1. 仅给 CI 填测试 URL：改动少，但变量误配仍可能把测试导向继承的业务库；不采用。
2. **专用本机 PostgreSQL 服务＋入口前置守卫**：测试步骤覆盖四个 URL，入口再次独立校验；推荐。
3. 立即拆多套 Vitest 配置并迁移所有硬编码守卫：最终仍需要，但本阶段无法先解决误连风险；后续单独实施。

## 边界与数据流

两个作业各自启动 `postgres:16-alpine`，服务自身创建 `wujie_bridge_test_ci`。全量测试步骤设置四个相同 URL，并执行 `pnpm test:ci`。入口脚本先校验环境，验证通过才以当前 Node 运行项目已有 Vitest CLI，原参数透传；Vitest 子进程只继承已核对的环境。默认 Vitest 范围已包含 `src/__tests__/api`，因此移除同作业中继承业务密钥的重复 `pnpm test:api` 步骤，不减少测试覆盖。脚本不运行迁移、不创建或删除数据库，不读取业务密钥，也不改变普通开发用 `pnpm test`。

本机与 CI 必须使用独立测试库；即使 `PGDATABASE_URL` 存在，缺少专用 `POSTGRES_TEST_DATABASE_URL` 仍失败。URL 禁止查询串、片段、默认端口与非本机主机，避免 `search_path`、SSL 和端口别名绕过。错误只报告类别，不打印连接串。真实数据库由服务提供，测试自身的 schema 隔离和清理仍按现有助手执行。

## 验证和非目标

先以子进程测试证明无 URL、别名不一致、远端/普通库、查询串均在 Vitest 启动前被拒；合法专用 URL 能执行 Vitest 的版本探针。然后检查 CI 两处全量命令和服务配置，运行目标测试、TypeScript/ESLint 与差异检查。

这不是全站回归完成声明：旧 `image-edit-model-execution.test.ts` 的持久任务合同、少数写死库名/端口/用户的测试及不同平台数据根路径仍待迁移。两个 CI 作业即使获得服务，也可能因这些真实失败保持红灯；不得跳过、改成宽松匹配或用本阶段的入口测试代替全量套件。
