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
