# Task12：画布图片 Skill 估算失败证据

## 2026-09-06 08:56 后续根因与真实数据库回归

最终本地门禁：生产构建退出0，119/119页面，BuildID `24_t3PODbMPtk0D9ZY3Y7`；沿用本地命令8GB堆，编译14.2分钟，无Coze环境修改。与全量5332/5332、类型和Lint结果共同支持提交main用于测试沙箱同步，但不证明云端闭环。后文“构建尚未完成”是运行中记录，以本段最终结果为准。

Coze 只读诊断已完成（NODE_EXIT=0）：项目归属与来源版本均有效，目标杯图的 active placement 使用裸 `projectId`，而新请求使用 `canvas:projectId`。同项目有 1 条规范 ID 的画布 placement 和 3 条裸项目 ID 的画布 placement。现有 legacy-migration 也明确接受这两个项目级别名。因此 a1ad44e1 只修正聊天 session 串用，未完整解决历史画布资产兼容问题；不得再次把这一部署标记为修复闭环。

最小增量在 `authorizeAgentContext` 中优先精确匹配请求 ID，再匹配同项目的另一合法 Canvas ID。仍使用原始 owner、project、version、entity 和 active 查询条件；其他工作区、自定义 session 及其他项目不扩展。无历史数据回填，无数据库迁移，无登录或账务修改。

回归：12 项别名单元用例中，修复前 2 失败、10 通过；修复后 12 通过。本轮另以真实 PostgreSQL 18、现有迁移及真实资产 service/storage 执行隔离 schema 集成测试，验证裸 ID placement 的规范请求授权成功、错误用户/项目/工作区及已删除 placement 拒绝，并逐字段比较查询前后 placement 不变。第一次集成测试因测试夹具只写 trashed、遗漏 deleted_at 而违反现有约束；补全夹具删除时间后通过，未更改生产约束。

2026-09-06 08:56 聚焦运行：5 个文件、47/47 通过，0 跳过。TypeScript、全仓构建版 ESLint 退出 0。38 项保护基线检查通过（此检查输出比较 HEAD，尚需新提交后再核验）。随后全量回归开启本地隔离 PostgreSQL，676 个文件、5332/5332 通过、0 失败、0 跳过；真实数据库服务测试后已停止。报告 `output/task12-canvas-alias-full-20260906.json`，SHA256 `8A3BE42CB64C728D9DDEE537B44A74BEAF934FA8D2DF1B88916A9769C0D4FA11`。生产构建与新版云端复验尚未完成，不宣称已关闭。

Chrome 本轮已在正确用户1现有标签页实际点击打开原4图项目、AI聊天及21项Skills；没有提交生成任务或扣费。此连接证据不替代上述业务估算与生成验收。

## 最新云端复验：仍未通过

2026-09-06 08:22:42，Coze回执已同步a1ad44e1，merge HEAD `63e09e30c82410fe0a4c47fb35c0e94da7a5ec94`，tree `08271d1fcfca44409d86695a034f302f3770109b`，TS/38保护/119页构建退出0；BuildID `hxHtO_YaljIVb6B9mXAG3`，唯一5000 PID7550启动08:19:11。随后正确Google Chrome现有预览通过CDP Page.reload(ignoreCache:true)强刷，自动登录，原4图保留。

同一杯图自然3504×2336已加载，选中后进入画布AI聊天/Skills/Mockup，以相同输入估算一次。请求 `34604.5167` 已正确携带 `workspaceId=canvas:project_1787549625844_nfmso3ts9`，sourceVersion仍 `364dd089-09f1-5f94-901b-cfe9c58c6243`，冻结APImart原provider/model配对。但仍HTTP404，业务错误 `AGENT_CONTEXT_NOT_FOUND`，requestId `aaec11f0-a211-9303-8307-f0990c2295f1`，timestamp `2026-09-06T00:22:42.923Z`。不能将本地契约测试通过视作此Bug关闭；尚需真实资产/placement数据核验。

已在Coze发送一次精确只读诊断并看到执行回复：查当前账号项目归属、目标version存在性、active placement的workspace及状态，若不存在则查同项目精确媒体路径。禁止回填/改授权/改数据/构建/生成/扣退。未点击运行Skill，无新付费任务。下一步只读取这次诊断，不重复派发或重新构建。

## 真实复现

- 日期：2026-09-06（北京时间）；首个响应时间 `2026-09-05T23:36:28.635Z`。
- 环境：现有 Google Chrome 用户1、独立 Coze 测试预览；业务部署候选 `6407ec0c`，非 stable。
- 项目：`project_1787549625844_nfmso3ts9`。
- 选择画布中蓝色陶瓷杯原图，打开 AI聊天 → Skills → 样机展示(Mockup)，填写设计内容和载体，点击“估算积分”。
- 连续两次返回 HTTP404，页面明确显示 `Agent context not found`。
- 浏览器请求ID：`34604.2260`、`34604.2276`。
- 未点击“运行 Skill”，未提交本轮生成任务。

## 关键请求字段

```json
{
  "skillId": "preset-mockup-showcase",
  "skillVersion": 1,
  "surface": "canvas",
  "projectId": "project_1787549625844_nfmso3ts9",
  "workspaceId": "session-1786347587770",
  "sourceVersionIds": ["364dd089-09f1-5f94-901b-cfe9c58c6243"],
  "modelBindings": {
    "orchestrator": {"providerId":"api_1778428130626_2qpg71v","modelId":"gemini-3.1-flash-lite-preview"},
    "image": {"providerId":"api_1778430731224_533e09a","modelId":"gpt-image-2"}
  }
}
```

## 首次响应

```json
{"success":false,"code":"AGENT_CONTEXT_NOT_FOUND","message":"Agent context not found","requestId":"0966f9ec-6598-9be3-9138-d8331564f1b4","retryable":false,"timestamp":"2026-09-05T23:36:28.635Z"}
```

## 根因调查状态

当前 `chat-panel.tsx` 的 `buildCanvasSkillRequest` 使用 `currentSessionId || canvas:projectId` 作为 workspaceId；真实请求确实提交聊天session，而非画布workspace。`authorizeAgentContext` 必须精确查找 owner/project/workspace/workspaceId/version 对应的有效 placement，找不到时返回上述错误。其他画布 Agent 路径使用 `canvas:${projectId}`。

因此聊天会话ID被误用为画布工作区ID是首要假设，尚需核对该真实版本的数据库placement或通过等价存储契约测试确认。不得通过删除归属检查、跨工作区任意查找或修改历史资产数据来规避错误。

## 结论

### 本地修复增量

已通过执行组件真实请求回调的测试确认工作区串用：两个非空会话用例失败，空会话通过。随后仅修改 `chat-panel.tsx` 的 workspaceId 及相关Hook依赖；三个用例通过真实 `authorizeAgentContext` 的画布placement匹配，相关估算API/组件聚焦共17项通过。TypeScript、改动文件ESLint通过，38项保护门禁通过。

全仓：5319项中5153通过、0失败、166跳过。随后启用本地隔离PostgreSQL 18（127.0.0.1:55492），对所有含跳过项的测试文件补验172/172通过、0跳过，含166项补验与6项同文件已通过项。隔离库已停止，不连接云端数据库。

生产构建：默认约4GB堆因OOM失败；仅本地命令设置 `NODE_OPTIONS=--max-old-space-size=8192` 后重跑退出0，119/119页面，BuildID `-hhcQ1jQOYxilEiYES-Nz`。未更改Coze配置。保留既有localstorage-file和本地数据目录警告。

机器报告：
- `output/task12-workspace-full-20260906.json`，SHA256 `473DC030E1A558149831132E35429C7F85C785E8FE963639AE2DA90722AEF949`。
- `output/task12-workspace-pg-supplement-20260906.json`，SHA256 `CA7C5B7CB1228A4FDD80D766A717BB914C801C87EFE44DC1473EEA48877076E3`。

本地门禁已通过，云端仍待此新修复部署后同图复验；不把本地通过视作云端通过。

新增待修问题：画布带原图 Skill 在估算阶段受阻，暂定P1。真实模型生成、暂停恢复、成功账务验收未开始，不得标记通过。当前保存的是网络与DOM文字证据；完整录像、Trace和本地截图尚未取得。
