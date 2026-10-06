# 隔离 Vitest CI 数据库边界实施计划

> 执行方式：本会话逐步实施，先 RED、再最小实现、再验证；正式发布仍受全量回归和云端验收约束。

**目标：** 两个 CI 全量测试作业在载入测试前拒绝业务库/不一致 URL，并只对独立本机 PostgreSQL 执行未缩减的 Vitest 范围。

**架构：** 由 `scripts/run-isolated-vitest.mjs` 承担纯环境准入与 Vitest 子进程启动。GitHub Actions 的各作业使用独立 PostgreSQL 服务，测试步骤覆盖四个连接变量；普通 `pnpm test` 不改动。

**技术栈：** Node.js ESM、Vitest、GitHub Actions PostgreSQL service。

**设计：** `docs/superpowers/specs/2026-10-02-isolated-vitest-ci-boundary-design.md`。

## 全局约束

- 不触碰 `stable`、业务库、真实供应商、Coze 或正式部署。
- 不跳过任何默认 Vitest 文件；不把 CI 作业启动前的外部失败称作测试失败。
- URL 校验先于 Vitest 的任何模块加载，错误不输出连接串。

## 任务 1：入口脚本的可执行安全合同

文件：新增 `src/__tests__/scripts/run-isolated-vitest.test.ts`、`scripts/run-isolated-vitest.mjs`；修改 `package.json`。

- [x] 写子进程测试：缺专用 URL、四变量不一致、远端主机、普通库名、查询串均非零退出，输出不含凭据；合法专用 URL 运行一份小型真实 Vitest 测试文件。
- [x] 运行新测试并确认因入口缺失而 RED，不把导入错误当产品失败。
- [x] 实现入口：逐一校验四变量相同，URL 协议、主机、显式端口、库名、查询串与片段；成功后使用 `process.execPath` 执行本项目 Vitest CLI，参数原样透传，状态码透传。
- [x] 在 `package.json` 添加 `test:ci` 指向该入口；重跑新测试至 GREEN。`vitest run --version` 实际会启动套件，故已将合法探针改为两项真实测试，不能再使用版本参数作为空跑探针。

## 任务 2：两处 CI 作业接入

文件：修改 `.github/workflows/quality.yml` 与 `.github/workflows/stage-0-quality.yml`；必要时扩充任务 1 的脚本合同测试。

- [x] 先增加合同测试：解析两个工作流，确认全量测试步骤使用 `pnpm test:ci`、四 URL 相同且为本机专用库，并配置 PostgreSQL 服务；旧工作流 2/2 RED。
- [x] 两作业各自增加 `postgres:16-alpine` 服务与健康检查；仅在全量测试步骤设置四个相同 URL 并调用新入口。
- [x] 移除 `quality` 作业内重复且未受守卫保护的 `pnpm test:api` 步骤；默认全量配置仍包含 API 测试，该重复步骤先 RED 后 GREEN。
- [x] 目标合同及相邻旧合同 30/30、`pnpm validate` 与限定差异检查 exit0；测试步骤显式覆盖作业级 `PGDATABASE_URL` 密钥。独立代码审查席已满，未取得独审结论。

## 任务 3：全量回归接续证据

- [x] 在本机隔离数据库上实际运行 `pnpm test:ci --bail 1`（四别名同指专用 loopback 库）；14 项通过，旧 `image-edit-model-execution.test.ts` 首项仍为 HTTP 202 对旧预期 500，余下 957 文件未执行。
- [ ] 下一阶段迁移：把旧模型执行测试改为真实持久任务合同；统一其余写死库名／端口／用户和平台数据根守卫。不得跳过、弱化断言或把当前结果标为全量通过。
- [x] 更新 Obsidian 阶段看板，明确入口安全、剩余测试和未发布边界。

## 当前验收边界

本阶段只证明全量测试入口的数据库准入及 CI 静态接线；本地全量仍红，保护基线也仍红。GitHub Actions 当前作业没有实际执行证据，且历史存在 runner 在首个 step 前被账单/额度阻断。不要将配置测试通过写成 CI 通过或发布批准。

## 2026-10-02 接续：首个历史库夹具迁移

- [x] 命令行仅诊断性排除旧图像编辑测试后，真库全量于画布通用生成旧固定库名／媒体根守卫失败；该排除没有进入配置或 CI。
- [x] 故障代理的当前四别名基础库、临时 schema URL 接受测试先 RED 后 GREEN；错误库和运行时别名不一致仍拒绝。
- [x] 仓库外专用媒体根守卫测试先 RED 后 GREEN；仓库内现有标记目录用去掉检查的变异复测证明测试能抓到越界。
- [x] 两处 CI 全量步骤创建并覆盖 runner 临时媒体根；工作流合同先 RED 后 GREEN。
- [x] 隔离 PostgreSQL 下画布通用生成路由和准入两文件完整 **167/167**；`pnpm ts-check`、定向 ESLint 与保护基线重新核对，保护基线仍 36 路径 BLOCK。
- [ ] 继续迁移旧图像编辑测试的持久任务合同及其余历史固定库／平台媒体守卫；不跳过测试，不把当前两文件结果外推全站。
- [ ] 在相同候选上完成未缩减全量 Vitest、严格构建追踪、保护基线、正确预览、真实账务与发布验收。
