# Brief 到视频成片阶段看板

## 当前状态

- 最终云端候选：`main@15ee74a5038653a6701a881f9d938e73d1ac9abd`，Coze 同树合并提交 `60ee04f9`，Build ID `5KEqWBNmGIO0eIURT6veG`。
- 当前结论：`LOCAL PASS / CLOUD PASS / CLOSED`。
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 只读；六个用户保护文件保持未暂存。
- 审查前本地通过数字均标记为历史作废，不用于当前候选判断。

## 规格 1 至 15

| 规格节 | 当前实现与证据 | 状态 |
|---:|---|---|
| 1-4 | 产品边界与两步规划、审批后生成合同已实现 | 定向合同通过 |
| 5 | Brief、受众、目标、平台、时长、比例、分辨率与首尾帧能力校验 | 定向合同通过 |
| 6 | `brief-to-video-plan-v1`、修改、批准身份与 checksum | 定向合同通过 |
| 7 | 视频 provider/model/mode 冻结及请求适配 | 定向合同通过 |
| 8 | 父 Run 预付、视频 child 零成本、取消与终态 CAS | 父级隔离 PostgreSQL `2/2 PASS` |
| 9 | `brief-to-video-result-v1`、`videoAssetVersionId` 与父版本合同 | 云端真实 AssetVersion `87fd800d-...` 已验证 |
| 10 | 浏览器 UI 使用稳定标识断言 Canvas/Workflow/Simple Chat `30/30/16`；原 29 项清单继续保留 | 四浏览器同轮通过；Simple Chat 云端成功与取消通过 |
| 11 | 375px 模型菜单、点击、左右边界、重叠和纵向可达性 | Mobile Chromium 自动化通过 |
| 12 | 鉴权、归属、事件 JSON、脱敏与资源边界 | 定向合同通过 |
| 13 | 单元、组件、API、PostgreSQL、四浏览器与六类哈希制品 | 最终专项、真 PostgreSQL、全仓与四浏览器门禁通过 |
| 14 | 功能标志受控，stable 不变，可关闭标志回滚 | 云端标志开启，`stable@52f7c601` 未触碰 |
| 15 | 云端 exact commit、成功/取消、真实资产与账务闭环 | `CLOUD PASS` |

## 二次复审进度

- [x] Simple Chat 等待本次新增且不同 runId 的审批卡。
- [x] E2E spec 从 UI 明确断言 `30/30/16`。
- [x] manifest 强制六类制品并逐文件校验哈希。
- [x] 云端 `exactCommit` 绑定 doctor 的预期候选。
- [x] 清理报告与看板中的冲突状态；规格第 13 节改为阻塞。
- [x] 父级隔离 PostgreSQL 真实执行 `2/2 PASS`。
- [x] 最终四浏览器矩阵 `4/4`，四份 manifest 与六类制品哈希已生成。
- [x] 云端 exact commit 完成真实成功与可控取消，Run、task、交易、AssetVersion 和视频制品字段已回填。
- [x] 剩余 P2 已收尾：取消卡片无需刷新即时更新；重复 modelId 显示精确候选并采用最后一次明确回答。

## 下一动作

本阶段已关闭，不再重复执行。后续进入总计划下一阶段；Task12 的成功成片、资产、账务、取消即时反馈和重复模型选择均已有对应证据或明确的云端不适用说明。
