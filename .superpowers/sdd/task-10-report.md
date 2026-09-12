# Task 10 实现报告

## 结果

Task 10 本地实现、四项目 Playwright、隔离 PostgreSQL 与发布门禁资料已完成。当前判定为 `DONE_WITH_CONCERNS / LOCAL PASS / CLOUD UNVERIFIED`。未修改或暂存六个用户保护文件，未触碰 `stable`。

## 实现

- 新增四项目 Brief 到视频 E2E 与 helper，使用运行级隔离账号、项目、数据库和受控本地视频供应商。
- 自动保存 screenshot、video、trace、Console、Network、machine evidence 和带 SHA-256 的 manifest，路径为 `test-results/brief-to-video/<candidate>/<project>/Brief/retry-0/`。
- doctor 增加功能标志、数据库表、视频能力和本地/云端证据检查；保护基线增加 Brief Skill 合同。
- 修复端到端暴露的七项运行时问题：可选字段 JSON、冻结审批 checkpoint、结构化前序输出、内部视频鉴权、预付视频 child 接纳、Simple Chat 时长类型、审批错误码。
- 新增功能清单、Bug 台账、回归报告、发布判断、未验证清单、阶段看板和机器证据聚合 JSON。

## TDD 记录

1. Playwright 初始 `--list` 因 helper 不存在 RED；helper 与 spec 最小落地后可枚举四项目。
2. doctor/保护基线合同测试因缺少 Brief 检查 RED；实现后 `20/20` GREEN。
3. PostgreSQL 指定命令因缺少专用配置 RED；新增配置后真实执行 `2/2` GREEN。
4. 可选输入、冻结 checkpoint、结构化前序、共享鉴权、视频 child 接纳和 Simple Chat 参数分别先增加失败回归，再完成最小实现。
5. 移动 E2E 发现审批暂停被写为 `SKILL_EXECUTION_FAILED`；安全错误单测 `1 failed / 7 passed` RED，固定公开哨兵后 `8/8` GREEN，移动端和四项目矩阵随后通过。

## 已验证

- 需求指定专项：11 个文件，`75/75 PASS`，0 failed，0 skipped。
- 隔离 PostgreSQL 审批与 20 路并发：`2/2 PASS`，0 skipped。
- 预付视频 child、取消和终态竞态：`15/15 PASS`。
- 最终四项目 Playwright：`4/4 PASS`，同一候选树完成。
- Canvas 文生视频、首帧、首尾帧在审批前均无视频提交；修改后批准只产生一个精确 provider/model/mode/5秒/9:16 请求。
- 取消与刷新恢复、Workflow 审批前无下游提交、Simple Chat 明确意图及 16 项目录隔离、375px 三个审批控件均通过。

## 当前未验证

- 未按约束创建或接管 Chrome 标签，Coze 尚未部署最终 exact commit。
- 未执行真实供应商成功和可控取消，故没有可声明的真实 remote task、视频文件、视频 AssetVersion、父版本和积分交易证据。
- 本地受控供应商只返回 processing 并由测试取消；其证据只能支持本地控制流和请求合同，不能支持 `CLOUD PASS`。

## 最终门禁

- 专项：11 个文件，`75/75` 通过，0 失败，0 跳过。
- browser matrix：Chromium、Firefox、WebKit、Mobile Chromium 共 `4/4` 通过，耗时 2.8 分钟；移动项目视口宽度为 375px。
- 隔离 PostgreSQL：审批与并发 `2/2`、预付视频回归 `15/15`，合计 `17/17` 通过。
- `pnpm run doctor`：54 passed、14 warnings、0 failed、2 blocked。`postgres-test-database` 因该命令未注入 `POSTGRES_TEST_DATABASE_URL` 被准确标为 blocked；Task 10 专用真库已由上方 `17/17` 单独验证。`brief-to-video-cloud-evidence` 因无云端证据被准确标为 blocked。
- `pnpm run lint:build`：退出 0。
- `pnpm run ts-check`：首次精确发现 helper 的两个 `this` 类型错误；最小修复后定向重跑退出 0。
- `pnpm test`：唯一一次全仓运行得到 `6130 passed / 190 conditional skipped / 4 failed`。四项失败均为本任务扩展合同后的旧断言；最小修复后仅重跑对应 4 个文件，`39/39` 通过。按检查点约束未再次运行全仓，因此不把它写成“修复后全仓全绿”。
- `pnpm run check:protected-baseline`：38 个保护 ID、组件路径、证据合同和引用均通过；最终命令仍被 3 个用户保护文件的既有脏状态阻断。另两项 Task 路径和本任务 PostgreSQL 配置已补充精确授权，但按约束未重复全门禁。该项记为 `BLOCKED`，不记为通过。
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm run build`：退出 0；Turbopack 编译、TypeScript、120 个静态页面和 build trace 清理完成。保留 55 条动态文件追踪警告及本地数据目录警告。

## 最终判断

本地功能、专项真库、四浏览器矩阵、类型、Lint 与生产构建具备候选提交条件。由于云端/真实供应商未验证、保护门禁受 3 个用户保护文件既有脏状态阻断，且修复后未重复全仓长测试，最终状态为 `DONE_WITH_CONCERNS`，不得声明 `CLOUD PASS / CLOSED`。

## 独立审查后续（CHANGES REQUIRED）

独立审查原文要点：Critical 0 / Important 3 / Minor 1。Important 分别为三工作区 E2E 未形成真实 UI 完整链、规格数量误写为 29 而非 30、doctor 与机器证据未绑定最终候选且云端字段不完整；Minor 为进度文档仍写“全量门禁待执行”和“按钮可点击”等缺乏对应证据的表述。

### 本轮 TDD 检查点

1. 新增审查合同后首次运行：`5 failed / 19 passed`。失败精确对应目录仅 28、helper 仍偏 API、Workflow/移动端断言缺失、doctor 证据弱、进度表述失真。
2. Canvas 视频模型 UI 合同先 RED：ChatPanel 没有加载/选择/绑定 video descriptor；最小实现后 `2/2` GREEN。
3. Canvas 单图来源映射先 RED：一个选中版本被复制到首帧和尾帧；改为按图片字段顺序消费来源后 `3/3` GREEN。
4. candidate SHA 防伪测试先 RED：错误 SHA 仍被接受；聚合、manifest、machine evidence 统一校验 provenance 派生 SHA 后 GREEN。
5. 当前定向命令 `pnpm exec vitest run ...` 为 `32/32`，E2E 四项目 `--list` 为 `4`，`pnpm exec tsc --noEmit --incremental false` 退出 0。

### 当前状态修正

- 规格目录为 Canvas `30`、Workflow `30`、Simple Chat `16`；原 29 个 Canvas/Workflow ID 逐项保留，Brief 为新增第 30 项，flag 关闭不隐藏原 29 项。
- 新 E2E 使用浏览器 UI 创建 Canvas 三种模式；Workflow 覆盖审批、恢复下游、`output-video` 与 `videoAssetVersionId`；Simple Chat 覆盖审批卡、修改、取消、刷新恢复和返回画布；审批前均直接查询数据库确认无视频 child。
- 375px 覆盖模型菜单选择、真实点击、左右边界、控件重叠和纵向可达性。
- 复审后的专项、browser matrix 和 full gate 尚待各执行一次，审查前旧结果不冒充新候选结果。真实云端/供应商仍为 `CLOUD UNVERIFIED`。

### 复审后最终执行记录

- 专项一次：15 个文件、`106/106 PASS`，0 failed，0 skipped。
- 隔离 PostgreSQL 一次：命令退出 0，但 `2/2 skipped`；当前进程没有 `POSTGRES_TEST_DATABASE_URL`，本机 PostgreSQL 虽监听 55432，现有认证凭据不可用，因此记为 `BLOCKED`，不写成通过。
- browser matrix 一次：Chromium、Firefox、WebKit、Mobile Chromium 均在 fixture 初始化时以 `BLOCKED: isolated PostgreSQL is required for Brief-to-video E2E` 结束，`0 passed / 4 blocked-as-failed`。未进入三工作区业务断言，旧 `4/4` 不得替代本轮结果。
- full gate 一次：doctor `29 passed / 14 warnings / 0 failed / 9 blocked`、退出 0；`ts-check` 退出 0；`lint:build` 退出 0；全仓 Vitest `6142 passed / 190 skipped / 1 failed`；protected baseline 的 38 项合同通过但门禁退出 1；build 退出 0，检查 222 个 trace 并清除 16810 条本地制品引用。
- 全仓唯一失败为旧 `stage-4-inventory.test.ts` 未加入 MPE/Brief 两个实际目录 ID；按检查点要求仅修该断言并定向重跑，相关 4 文件 `29/29` GREEN，不重复全仓。
- protected baseline 首次额外阻塞新 evidence helper，补充精确 Task 10 授权后重跑；最终只剩 `.superpowers/sdd/task-1-review.md`、`task-2-review.md`、`task-3-brief.md` 三个用户保护脏文件，故仍为 `BLOCKED`，未修改或暂存它们。

### 候选与结论

- 候选 provenance：预期父提交 `7a669f20fd195448aaf3bf630814177defb1b617`；`src=3cf99a62c6e591f941d84ac98fa5f7e073a515b0`、`tests=9b87853bac04ebc42b91cd5091817800de30e628`、`scripts=18172b42975de6c0df567ebdeee666caa6a510ec`；派生 candidate SHA `ddada611d22ce61daaa4f88176a754f87b6206d7dfd21ffd7302551e4f348128`。
- 最终状态为 `DONE_WITH_CONCERNS`：代码专项、类型、Lint 与构建通过；新 browser matrix、隔离 PostgreSQL、保护工作树和真实云端链仍阻塞，不声明 `LOCAL PASS` 或 `CLOUD PASS`。
