# Brief 到视频成片阶段看板

## 当前状态

- 基线：`main@cca721e5444094eb33079b923c3625f06cc10f0c`；二次复审修复基于 `b128ba5adfb81c86a6473305bc47a515b7d1e9cd`。
- 当前结论：`LOCAL BLOCKED / CLOUD UNVERIFIED`。
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 只读；六个用户保护文件保持未暂存。
- 审查前本地通过数字均标记为历史作废，不用于当前候选判断。

## 规格 1 至 15

| 规格节 | 当前实现与证据 | 状态 |
|---:|---|---|
| 1-4 | 产品边界与两步规划、审批后生成合同已实现 | 定向合同通过 |
| 5 | Brief、受众、目标、平台、时长、比例、分辨率与首尾帧能力校验 | 定向合同通过 |
| 6 | `brief-to-video-plan-v1`、修改、批准身份与 checksum | 定向合同通过 |
| 7 | 视频 provider/model/mode 冻结及请求适配 | 定向合同通过 |
| 8 | 父 Run 预付、视频 child 零成本、取消与终态 CAS | 当前 PostgreSQL 环境未复验 |
| 9 | `brief-to-video-result-v1`、`videoAssetVersionId` 与父版本合同 | 本地合同存在；真实资产未验证 |
| 10 | 浏览器 UI 使用稳定标识断言 Canvas/Workflow/Simple Chat `30/30/16`；原 29 项清单继续保留 | 自动化已实现；矩阵环境阻塞 |
| 11 | 375px 模型菜单、点击、左右边界、重叠和纵向可达性 | 自动化已实现；本轮未进入业务链，不能声称通过 |
| 12 | 鉴权、归属、事件 JSON、脱敏与资源边界 | 定向合同通过 |
| 13 | 单元、组件、API、PostgreSQL、四浏览器与六类哈希制品 | `LOCAL BLOCKED`：PostgreSQL 与浏览器证据缺失 |
| 14 | 功能标志受控，stable 不变，可关闭标志回滚 | 已准备 |
| 15 | 云端 exact commit、成功/取消、真实资产与账务闭环 | `CLOUD UNVERIFIED` |

## 二次复审进度

- [x] Simple Chat 等待本次新增且不同 runId 的审批卡。
- [x] E2E spec 从 UI 明确断言 `30/30/16`。
- [x] manifest 强制六类制品并逐文件校验哈希。
- [x] 云端 `exactCommit` 绑定 doctor 的预期候选。
- [x] 清理报告与看板中的冲突状态；规格第 13 节改为阻塞。
- [ ] 在具备隔离 PostgreSQL 的环境重跑四浏览器矩阵并生成四份完整 manifest。
- [ ] 在云端 exact commit 完成真实成功与可控取消，回填 Run、task、交易、资产父版本和视频制品字段。

## 下一动作

父级门禁在具备隔离数据库的环境运行专项与浏览器矩阵；云端证据完整前保持 `LOCAL BLOCKED / CLOUD UNVERIFIED`。
