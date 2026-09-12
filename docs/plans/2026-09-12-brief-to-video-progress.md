# Brief 到视频成片阶段看板

## 检查点

- 需求基线：`main@cca721e5444094eb33079b923c3625f06cc10f0c`，只修改 `main` 候选，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 只读。
- 当前结论：`LOCAL PASS / CLOUD UNVERIFIED`。
- 功能约束：`BRIEF_TO_VIDEO_SKILL_ENABLED` 继续显式控制；审批前不得提交视频；父 Run 负责账务，视频 child 为零成本。
- 证据身份：`task10-candidate-tree-final`；最终提交哈希在提交后以 Git commit 为准，本地证据不改写为云证据。

## 规格 1 至 15 映射

| 规格节 | 实现与门禁 | 状态 |
|---:|---|---|
| 1-3 | 产品定位、目标与非目标沿用正式规格；未新增时间线编辑器或新视频协议 | 已实现 |
| 4 | 两步 Skill：结构化规划、审批后视频生成 | 已实现 |
| 5 | Brief、目标、受众、平台、时长、比例、分辨率、首尾帧及负面约束按能力校验 | 已实现并专项通过 |
| 6 | `brief-to-video-plan-v1`、`planChecksum`、修改和批准身份绑定 | 已实现；20 路审批竞争通过 |
| 7 | 精确冻结视频 provider/model/mode，首尾帧与能力参数进入同一请求 | 已实现；受控供应商验证 |
| 8 | 预付父 Run、零成本视频 child、取消及终态 CAS | 已实现；PostgreSQL 竞态通过 |
| 9 | `brief-to-video-result-v1`、`videoAssetVersionId` 与来源父版本合同 | 本地合同通过；真实视频资产未验证 |
| 10 | Canvas、Workflow、Simple Chat 共用 Run，目录边界 29/29/16 | 本地 E2E 与组件/API 通过 |
| 11 | 审批、修改、取消控件；375px 可见、可点击、不越界 | Mobile Chromium 通过 |
| 12 | 鉴权、来源归属、事件 JSON、错误脱敏和资源边界 | 回归通过 |
| 13 | 单元、组件、API、PostgreSQL、四项目 Playwright 与哈希证据 | `LOCAL PASS` |
| 14 | 功能标志受控，`stable` 不动；回滚可关闭功能标志 | 已准备 |
| 15 | exact commit 云端成功/取消、真实资产和账务闭环 | `CLOUD UNVERIFIED` |

## 本地数字

- 指定专项项：`75/75`。
- PostgreSQL 审批与并发：`2/2`，0 skipped。
- PostgreSQL 预付账务回归：`15/15`。
- Playwright：`4/4`，项目为 Chromium、Firefox、WebKit、Mobile Chromium 375px。
- 全量发布门禁：待文档完成后按“专项 -> browser matrix -> full gate”各执行一次并回填报告。

## 唯一下一动作

提交最终候选后，在现有 Coze 浏览器标签部署该 exact commit，完成一次真实成功和一次可控取消，回填 Run、remote task、交易、视频 AssetVersion、父版本及云端制品哈希；此前不得标记 `CLOUD PASS / CLOSED`。
