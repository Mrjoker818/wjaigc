# Task12：画布图片 Skill 估算失败证据

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
