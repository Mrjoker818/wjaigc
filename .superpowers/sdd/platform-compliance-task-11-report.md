# Task11 本地实施与门禁报告

## 结论

状态：**R2 本地通过，云端未验证**。

R2 的两个 P2 审查项均已关闭。项目删除协调器会回收属于已删除项目、且没有任何活动引用的 `document`、Workflow 报告、PSD、视频等资产；仍活动项目中的无 placement 资产、跨用户资产及仍有活动 placement 的共享资产保持 `active`。Chromium 生产态 E2E 已从干净候选提交重新执行，并生成绑定真实 commit、tree SHA、清洁状态及 SHA-256 校验和的新证据。

## R2 返修

- 测试先行：单元 RED 为 1 失败/40 通过；真实 PostgreSQL 合并 RED 为 2 失败/48 通过。
- 最小修复后，删除项目相关单元与 PostgreSQL 回归 50/50 通过。
- 全量测试首次运行发现 API 路由仍断言旧单参数契约：703/704 文件、5805/5806 测试通过。同步该测试预期后，相关 PostgreSQL 回归 70/70 通过，最终全量测试 5806/5806 通过。
- Canvas 与 Workflow 对同三张受管图片执行同一合规 Skill，并逐图断言相同 `ruleSetDigest`。
- Workflow 合规报告输出真实连接到下游条件节点，执行终态证明报告摘要被下游消费。
- 每张图片均生成 `document` AssetVersion，并验证来源版本、预览和下载。
- Simple Chat 完成 16 项隔离断言，不暴露或复用 Canvas 专属 Skill。

## 干净候选 E2E

| 项目 | 结果 |
|---|---|
| 被测提交 | `020339c8978f8c4e6fec63874490187c80a88e6b` |
| 被测 tree | `b4b9a9e5209324605b23789a16719a7e988309fb` |
| 产品树状态 | `productTreeClean=true`，`productStatus=[]` |
| Chromium 生产态 E2E | 退出码 0，1/1 通过，测试 12.7 秒，总耗时 14.9 秒 |
| Canvas / Workflow | 三张图片、六份报告 AssetVersion、逐图 digest 一致、下游消费均通过 |
| Simple Chat | 16 项隔离通过 |
| 受控 provider | 8 次调用：6 次视觉评估、2 次编排 |
| 证据校验 | 7/7 文件 SHA-256 独立复算一致 |

精确证据目录：

`test-results/stage-4-baseline/evidence/020339c8978f8c4e6fec63874490187c80a88e6b/task11r2final2/chromium/Canvas-Workflow-Simple-Chat/retry-0/repeat-0/`

证据包含 `final.png`、`video.webm`、`trace.zip`、`console.json`、`network.json`、`source-state.json`、`platform-compliance-local-production.json` 及 `evidence-manifest.json`；`console.json` 为空数组。首次以同一候选取证时，5018 进程遗漏 `DEPLOY_RUN_PORT=5018`，Workflow 内部请求默认访问 5000 并出现 `ECONNREFUSED`；该失败证据未重命名或冒充通过。补齐运行环境、重建一次性数据库后，以新 run ID `task11r2final2` 成功取证。

## 最终门禁

| 命令 | 退出码 | 结果 |
|---|---:|---|
| Task11 Chromium 生产态 E2E | 0 | 1/1 通过 |
| `pnpm ts-check` | 0 | 通过 |
| `pnpm lint` | 0 | 0 errors，943 warnings |
| `pnpm run lint:build` | 0 | 通过 |
| `pnpm test` | 0 | 704/704 测试文件、5806/5806 测试通过 |
| `pnpm run check:protected-baseline` | 0 | 38/38 保护项通过，0 warning |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` | 0 | Webpack 12.7 分钟，TypeScript 54 秒，119/119 页面生成成功 |

## 提交与边界

- `f3dcb7debc01e025975dbf2036410be3121cff63`：删除项目资产生命周期最小修复及测试。
- `5d3ffa3112988dab34d6a2218af5f159061ef1cf`：证据清单与干净源码绑定。
- `020339c8978f8c4e6fec63874490187c80a88e6b`：同步 API 路由测试的新参数契约，也是最终 E2E 与门禁候选。
- 本报告将在门禁后以仅文档提交追加；因此最终 HEAD 的完整 Git tree 会因本报告变化而不同，但被测产品代码、测试代码及构建输入与 `020339c8` 完全一致，证据仍精确绑定该干净候选。
- 5018 生产服务、55511 一次性 PostgreSQL、受控 provider、R2 临时数据库和 data 目录均已停止并删除；未发现遗留的 repair14-20 进程或目录。
- 未推送，未修改 `stable`，未纳入既有 6 个无关 SDD 文件。

## 剩余风险

1. 本报告只证明一次性 PostgreSQL 与受控 provider 下的本地 Chromium 生产态链路，不证明 Coze 或真实第三方 provider 的云端行为。
2. `pnpm lint` 仍有 943 条历史 warning，但本轮没有新增 lint error。
3. 云端部署、真实供应商计费及多浏览器验收不属于本次 Step1-2 本地通过结论。
