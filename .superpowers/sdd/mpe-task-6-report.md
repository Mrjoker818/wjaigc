# Task 6 实施报告

## 结论

状态：**本地 GREEN；PostgreSQL 真实并发验证阻塞；未推送。**

- 开始基线：`main@3fae296f0411c588c1bfc427c14edddddb7c5dc6`
- 目标提交信息：`feat: execute recoverable batch exports`
- 仅修改当前 `main` 工作区，未创建分支或 worktree，未触碰 `stable`。
- 保持既有 21 个 Skill 身份不变；新增内置 `preset-multi-platform-export@1`。
- 本功能不绑定模型、不估算或扣除积分。

## 范围与批准边界

实现范围遵循 Task6 简报、总计划以及 Task1-5 的既有契约。为实现 terminal partial success 的新尝试语义，经用户批准，将直接修改范围最小扩展至：

- retry route 对应的运行时服务路径；
- run request、Agent frozen request 与事件类型；
- manifest、artifacts 与 structured output；
- 对应 API、投影和 PostgreSQL 并发测试。

扩展仅用于 `preset-multi-platform-export` 的 `SKILL_PARTIAL_SUCCESS -> 新 Run` 契约，没有扩展其他业务。

## TDD 证据

先建立失败测试，再实现生产代码。

初始 RED：目标 preset 与 executor 模块不存在，目录注册、执行与恢复测试按预期失败。第二轮 RED 共 4 项失败，分别覆盖：

1. 客户端伪造 lineage 字段未被拒绝；
2. terminal partial-success 仍走旧 paused retry 路径；
3. 新尝试错误扩大重试集合；
4. 新制品拒绝复用旧 Run 的成功 AssetVersion。

以上失败均已通过最小实现转为 GREEN。

## 已实现合同

### Preset 与目录

- 注册 `multi_platform_export` local step。
- Canvas、Workflow 可见并可执行。
- Simple Chat 可授权但不显示目录入口。
- `MULTI_PLATFORM_EXPORT_ENABLED` 关闭时不进入目录；历史 Run 仍可恢复。

### 执行与恢复

- 执行队列固定两个 worker，并发严格不超过 2。
- abort 后不再领取新任务。
- 每个条目真正完成或失败后才发布进度。
- 产物身份包含 source、preset、version、filename，避免错误复用。
- 普通恢复仅补缺失项，复用 Task5 已持久化产物。
- ZIP 失败保留已生成图片，并形成 partial structured output。

### Partial Success 与新尝试

- 部分成功先持久化 structured output、`asset.created`、`tool.completed`，再写 terminal `run.failed / SKILL_PARTIAL_SUCCESS`。
- 部分成功绝不写 `run.completed`。
- 普通 Skill 的 paused step retry 行为保持不变。
- 仅当权威旧 Run 为指定 preset、terminal failed 且错误码为 `SKILL_PARTIAL_SUCCESS` 时创建新 Run。
- retry 请求体严格拒绝额外客户端字段；lineage、失败项快照和复用版本均由服务端从旧 Run 权威证据重建。
- 新 Run 固化 `rootRunId`、`retryOfRunId`、attempt、失败项和复用版本，并纳入 canonical digest。
- 重试只处理旧失败项；旧成功 AssetVersion 经用户、项目、来源、preset、版本、文件名、metadata 与 digest 校验后复用。
- 新 manifest/ZIP 属于新 Run，完整记录复用成功、新成功和仍失败项。
- 新 Run 使用新 runId；retry route 以派生幂等键防止重复点击创建多个尝试。
- 旧 Run 不追加、不覆盖。

## 本地验证结果

### Task6 与相关 Skill 回归

```text
17 个测试文件
272 个测试通过
0 失败
```

覆盖批量导出执行、partial terminal、retry lineage、manifest/artifacts、preset/catalog、run request、continuation、storage 与 Skill API。

### Task1/Task5/事件存储回归

```text
8 个测试文件
102 个测试通过
0 失败
```

覆盖 Asset Service、二进制持久化、structured output、事件终态 fence、admission gate、成本估算、local step 与资产核心类型。

### 静态门禁

```text
pnpm ts-check：通过，退出码 0
目标 ESLint：通过，退出码 0
```

本轮相关验证合计：`374` 个测试通过。

## PostgreSQL 专项状态

新增独立配置 `vitest.mpe-postgres.config.ts` 与命令 `pnpm test:mpe:postgres`。默认本地套件明确排除该测试文件，防止缺少数据库时被静默算作通过。

当前环境没有 `TEST_PGDATABASE_URL`。实际执行专项目标后得到退出码 1，并明确报错：

```text
TEST_PGDATABASE_URL is required. Do not point it at PGDATABASE_URL or a production database.
```

因此 PostgreSQL 并发、唯一创建者、manifest/ZIP 持久化和零账务断言当前标记为**阻塞/未验证**，不是跳过或通过。提供专用隔离测试库后必须重新执行该命令。

## 保护与提交约束

以下既有脏文件不属于 Task6 提交，未暂存、未修改其内容：

- `.superpowers/sdd/mpe-progress.md`
- `.superpowers/sdd/progress.md`
- `.superpowers/sdd/task-1-brief.md`
- `.superpowers/sdd/task-1-review.md`
- `.superpowers/sdd/task-2-brief.md`
- `.superpowers/sdd/task-2-review.md`
- `.superpowers/sdd/task-3-brief.md`

本报告受 SDD 目录忽略规则覆盖，将仅对本文件使用强制暂存。提交完成后不执行 push。

## 复审整改（2026-09-09）

基于 `50f337bf` 的复审结论为 `NEEDS_FIXES`。本轮继续采用 TDD，先补充失败测试，再实施最小范围修复。

### RED 证据

首轮复审测试结果：`6` 项失败、`102` 项通过。失败分别证明：

1. partial retry route 创建新 Run 后没有调用执行调度；
2. Workflow 客户端仍轮询旧 Run；
3. React hook 没有切换到服务端返回的新 Run；
4. ZIP 失败覆盖了已有图片失败；
5. retry 幂等键不是固定长度派生；
6. retry 返回缺少权威 root/attempt lineage。

### GREEN 实现

- retry route 仅在取得权威新 Run 后调用 `dispatchSkillRunExecution`，并以 dispatch fence 的真实结果填充 `startedStepIds`；重复 retry 复用同一新尝试且不重复执行。
- route 返回新 `runId`、`rootRunId` 与 `attempt`；普通 paused retry 仍保持原 Run 语义。
- React hook 在 terminal partial retry 后切换 active Run，并重建事件/轮询观察；Workflow 客户端同样跟随响应中的新 Run ID。
- partial retry 幂等键改为基于 `rootRunId/sourceRunId/attempt` 的 SHA-256 固定长度派生，连续重试不会累积增长。
- ZIP 打包失败追加到既有 `failures`；混合图片失败与 ZIP 失败时，仅重试图片缺失项并重新打包，manifest 保留完整失败历史。
- 两个目录契约测试固定验证原有 28 项身份，并通过功能开关与 catalog surfaces 单独验证可选批量导出 Skill，避免脆弱的“全部启用固定数组”断言。
- PostgreSQL 专项测试改为通过生产 Skill Service 创建真实本地 Run，覆盖并发幂等、dispatch fence、缺失项恢复、partial retry 幂等、真实 AssetVersion 与零积分账本。

### 复审回归证据

```text
Task6 + client/workflow + 目录 + Task1/5 + API/event：
28 个测试文件，461 个测试通过，0 失败

pnpm ts-check：退出码 0
目标 ESLint：退出码 0
```

PostgreSQL 专用命令已在未设置隔离库的当前环境实际执行：

```text
pnpm test:mpe:postgres：退出码 1
TEST_PGDATABASE_URL is required for this dedicated Task 6 integration test.
```

因此真实 PostgreSQL 并发、恢复和积分账本断言仍为**阻塞/未验证**；该失败符合专用命令设计，不计入默认套件通过数，也不标记为跳过。

## 第二轮复审整改（2026-09-09）

第二轮复审剩余两项 Important。本轮以 `d4ae202a` 为父提交继续修复，不 amend、不 push。

### 目录契约 RED/GREEN

修复前实际执行两个旧目录契约：`2` 项失败、`26` 项通过。失败原因是旧测试把全部定义固定为 28 项，且把关闭状态的可选 export Skill 与公开目录混为一体。

修复后：

- 显式锁定原有 28 项 ID、顺序和身份不变；
- 单独验证 `preset-multi-platform-export` 关闭时不出 Canvas/Workflow 公开目录；
- 开启后仅追加到 Canvas/Workflow；
- Simple Chat 保留执行授权，但始终不显示目录入口；
- 两个旧目录契约共 `30/30` 通过；
- Task6、客户端/Workflow、目录、Task1/5、API/Event 扩展回归共 `491/491` 通过。

### Protected baseline 精确授权

仓库授权格式为纯“精确路径字符串数组”，不支持在单项中附加原因、计划或审查提交。本报告承担审计说明；门禁脚本、测试逻辑和匹配规则均未修改，也没有新增目录级通配。

授权理由统一为：多平台批量导出 Task1-6 计划实际生产路径或专用测试配置，已经过对应 Task 实现与复审；本轮仅登记门禁列出的缺口。对应最近审查提交如下：

- 预设/API/运行设置：`cf13bcf6`、`cc45e1c8`、`865adafb`；
- 规划/schema/naming/types：`4ca25b04`、`71c02a4e`；
- 来源读取与图像转换：`b5e5775f`、`e3f9aa26`、`f53429dc`；
- 产物持久化、跨资产父链和恢复：`8180a77a`、`5fa138f1`、`ae5df194`；
- 清理 outbox、租约、S3/serve-upload/instrumentation：`a3ea794a`、`6ef6d6a4`；
- Task6 executor、manifest、preset、PostgreSQL 配置及复审修正：`50f337bf`、`d4ae202a`。

精确新增路径为三项 MPE migration、两项 preset API、serve-upload 路由、instrumentation、四项 asset binary/cleanup 路径、image-tools file、十项 `src/lib/multi-platform-export/*` 文件、runtime-settings、s3-storage、Skill preset、专用 Vitest 配置、本报告及 Task1-6 自身的 `.superpowers/sdd/mpe-progress.md`。后者仅授权已经进入 Task1-6 历史提交的计划记录；其当前工作区内容不暂存、不提交。六个其他既有脏 SDD 文件没有登记。

由于保护门禁会扫描工作区，首次执行时临时 stash 七个既有脏 SDD 文件，并通过 CLI 精确豁免 `mpe-progress.md`；执行后立即恢复，恢复前后 diff SHA-256 均为：

```text
D82B76EAD4E505F215D13F7621544478E26B484D3F3C14368E1D08B0280673BC
```

随后在提交 `691270b2` 的干净 detached worktree 中以原始命令复验，门禁 RED 且唯一阻断为历史已提交的 `.superpowers/sdd/mpe-progress.md` 尚未登记。该路径属于 Task1-6 本计划记录，不属于六个其他既有脏 SDD 文件，因此按精确路径补入授权；不修改门禁逻辑、不增加通配，也不提交其当前工作区 diff。补录后再次运行原始命令，结果为 38/38、0 未授权源码漂移、0 warning、退出码 0；六个脏 SDD 文件恢复前后 diff SHA-256 均为 `F9476C217B84031226F06A8CA9BDA5814F75F60570F303C6388F0D91F0251A2C`。

### 全量测试事实

`pnpm test` 已完整运行，结果为：

```text
690 个文件通过，34 个环境项跳过，2 个文件失败
5865 个测试通过，184 个 PostgreSQL 环境项跳过，8 个测试失败
```

8 个失败全部集中在既有 Canvas Chat 模型角色契约：

- `chat-panel-skill-runtime.test.tsx`：旧源码字符串断言仍要求 `roles.add('orchestrator')`；
- `chat-panel-skill-workspace.test.ts`：其 VM 测试沙箱没有注入当前源码使用的 `requiredSkillModelRoles` / `skillStepModelRole`。

这些文件不属于 Task6 修改集，Task6 定向回归为 0 失败；本轮不掩盖失败，也不越界修改其生产路径或测试夹具。
