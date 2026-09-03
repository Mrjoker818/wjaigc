# 统一 Skill 运行内核 Task 11 检查点

时间：2026-09-03
本地基线：`main@f028844f34cfe670a3340cf31acdf49393315e30`
远端基线：`origin/main@2faeec0b632befdd6bb34319b15a2b131d9cbcb0`

## 边界

- 本轮只处理 Task 11：作用域清单、精确保护授权、全量回归和三浏览器 E2E 证据入口。
- Canvas 与 Workflow 共用 21 个 Skills；Simple Chat 保持独立的 16 个 Skills，交集为 0。
- 未修改供应商、积分、任务状态机或业务页面实现。
- 未推送 GitHub，未触碰只读 `stable`。

## 已完成

- 新增作用域清单永久测试，并先确认缺少 `skillCatalogs` 时为 RED，再最小实现为 GREEN。
- `stage-4-inventory` 明确输出 Canvas 21、Workflow 21、Simple Chat 16，并验证节点类型含 `ai-skill`。
- 为 Task 9 的四个生产文件增加逐文件、可追溯的保护授权；没有新增目录通配授权。
- 新增 Canvas/Workflow 同源目录及 Simple Chat 隔离的 Playwright 用例；Canvas 和节点模式都会使用受控供应商真实提交并等待完成，并核对 Skill ID、版本、独立 Run 身份和结果 AssetVersion 血缘。
- Playwright 为本专项使用独立输出目录，并保留失败截图、录像和错误上下文。
- 四轮独立审查发现并关闭七项测试可信度问题：Workflow 清单必须按 surface 独立推导、Skill E2E 不复用 100 节点压力夹具、干净浏览器需初始化精确图像模型、跨界面证据需核对版本与 AssetVersion 血缘、localStorage 必须在有效 origin 初始化、Canvas 编排模型必须固定到受控供应商、清单必须验证真实 `allowedSurfaces` 绑定并忽略注释。七项均以 RED/GREEN 契约固定。

## 验证结果

- Task 11 清单与保护测试：16/16 通过。
- Skill 运行时扩大回归：14 个文件、148/148 通过。
- 全仓 Vitest：626 个文件通过、27 个文件条件跳过；4895 项通过、142 项 PostgreSQL 条件跳过、0 失败。
- TypeScript：通过。
- ESLint `--quiet`：0 错误。
- 生产构建：退出码 0，119/119 页面生成完成。
- `git diff --check`：通过，仅有 Windows 行尾提示。

## 明确阻塞

- 本地生产服务已成功启动并用于专项 E2E。三浏览器共 6 条用例均在隔离数据库前置条件处停止，唯一阻塞为缺少 `E2E_STAGE4_DATABASE_URL`；因此没有执行真实 UI 业务断言，不能标记为通过。
- 失败证据位于 `test-results/skill-runtime/playwright-output/`，包含 Chromium、Firefox、WebKit 的截图、录像和错误上下文；`playwright-report/index.html` 已生成。
- 142 项 PostgreSQL 测试因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过，不能用内存回归代替真库并发证明。
- 用户保留的 `.playwright-cli/`、参考仓库和无关计划已写入本仓库的本地 `.git/info/exclude`，文件没有删除或提交，也没有扩大版本库白名单。直接工作树保护脚本现为 38 项完整、0 未授权漂移、0 警告。

## 结论

Task 11 的代码和测试基础设施已经完成，本地非数据库门禁全部通过；完整 Task 11 仍为“有条件完成”，等待隔离 PostgreSQL 后执行三浏览器真实断言。Task 12 尚未开始。
