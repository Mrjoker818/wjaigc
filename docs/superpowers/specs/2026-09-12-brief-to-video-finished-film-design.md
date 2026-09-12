# Brief 到视频成片完整链路设计

## 1. 背景与定位

“Brief 到视频成片”是 Lovart 增量工作流中的 Task 9。它不是新的独立视频生成器，也不替代现有视频面板，而是把需求补齐、脚本规划、用户确认、远程视频生成、结果资产化和跨工作区恢复串成一个可追踪的统一 Skill Run。

本设计采用已确认的方案 1：一次远程视频任务交付一条最终成片。视频时长严格服从所选模型能力，不通过本地拼接伪造 30 秒能力，不增加本地 GPU 服务，也不建立第二套供应商任务状态机。

## 2. 目标

- 用户从结构化 Brief 得到可审阅的脚本与镜头方案。
- 用户确认方案后才提交远程视频模型。
- 文生视频、单首帧图生视频和首尾帧视频共用同一流程。
- 精确冻结 `providerId + modelId`、能力快照、输入版本和积分预估。
- 复用统一 Skill Runtime 的幂等、暂停、恢复、取消、重试、退款和事件能力。
- 最终视频创建独立 `kind: 'video'` AssetVersion，不覆盖来源图片。
- Canvas、Workflow 和 Simple Chat 共享同一个 Run、任务、积分与结果版本，同时保持入口和用户群体差异。
- 页面刷新、沙箱重启和跨会话后仍能恢复审批点、远程任务和最终结果。

## 3. 非目标

- 不在本地生成视频、插帧、补帧、配音或执行神经渲染。
- 不使用 FFmpeg 将多个镜头拼接成长视频。
- 不绕过模型能力目录提交未声明的比例、分辨率或时长。
- 不把 Canvas Skills 目录复制到独立智能对话页面。
- 不修改现有视频生成面板、视频编辑、视频延长、抽帧和下载入口的行为。
- 不创建新的供应商任务表、积分流水表或 AssetVersion 实现。

## 4. 工作流定义

内置 Skill ID 为 `preset-brief-to-video-film`，版本从 `1` 开始。

允许执行表面为 `canvas`、`workflow` 和 `simple-chat`；目录展示表面仅为 `canvas` 和 `workflow`。Simple Chat 通过明确的自然语言意图调用，不在其 16 项独立 Skill 目录中显示。

流程包含两个顺序步骤：

1. `plan-film`：使用冻结的 orchestrator 模型生成结构化脚本、镜头意图、运镜、节奏、画面约束和最终视频提示词。
2. `generate-film`：用户批准计划后，使用冻结的 video 模型调用现有 `/api/video/generate` 异步任务链，等待终态并投影视频 AssetVersion。

`plan-film` 完成后必须进入可恢复审批暂停点。未经同一用户在同一项目内明确批准，`generate-film` 不得开始。

## 5. 结构化输入

输入字段如下：

| 字段 | 类型 | 约束 |
|---|---|---|
| `brief` | text | 必填，1～4000 字符 |
| `goal` | select | 必填：品牌认知、产品转化、活动传播、内容叙事 |
| `audience` | text | 必填，1～500 字符 |
| `platform` | select | 必填：通用、抖音、小红书、B站、YouTube、Instagram |
| `style` | text | 可选，默认“电影感、主体清晰、运动自然” |
| `callToAction` | text | 可选，最长 300 字符 |
| `durationSeconds` | select | 必填，只显示当前视频模型支持值 |
| `aspectRatio` | select | 必填，只显示当前视频模型支持值 |
| `resolution` | select | 可选，只显示当前模型支持值 |
| `startFrame` | image | 可选，绑定受管 AssetVersion |
| `endFrame` | image | 可选，绑定受管 AssetVersion；没有首帧时禁止单独设置 |
| `negativeConstraints` | text | 可选，最长 1000 字符 |
| `generateAudio` | boolean | 仅模型能力明确支持时可用 |

来源图片必须属于当前用户和当前项目。零张来源按 `text-to-video` 执行，一张按 `image-to-video` 执行，两张按 `first-last-frame` 执行。能力目录不支持对应模式时，估价和创建 Run 均失败关闭，不静默降级到其他模式或供应商。

能力驱动的三个 `select` 字段通过通用 `SkillInputField.capabilityOptions` 元数据声明 `modelRole: 'video'` 以及 `durationSeconds / aspectRatio / resolution` 字段名。客户端和服务端均从同一冻结模型能力快照生成选项；静态 `options` 不作为权威范围。

## 6. 结构化脚本与审批

脚本输出使用 `brief-to-video-plan-v1`：

```ts
interface BriefToVideoPlanV1 {
  schemaId: 'brief-to-video-plan-v1';
  title: string;
  logline: string;
  durationSeconds: number;
  aspectRatio: string;
  scenes: Array<{
    order: number;
    timeRange: string;
    visual: string;
    camera: string;
    action: string;
    textOverlay?: string;
  }>;
  finalVideoPrompt: string;
  negativePrompt: string;
  factualConstraints: string[];
}
```

运行时为步骤增加通用审批配置，而不是按 Skill ID 特判：

```ts
interface SkillApprovalCheckpoint {
  kind: 'user-approval';
  outputSchemaId: 'brief-to-video-plan-v1';
  nextStepId: string;
  allowRevision: true;
}
```

脚本步骤通过质量门禁后，运行时写入 `run.paused`，原因码为 `SKILL_APPROVAL_REQUIRED`，保存计划 checksum、下一步骤和 generation。审批接口必须校验用户、项目、Run revision、generation 和 checksum。

用户可执行三种动作：

- `approve`：冻结当前计划并从 `generate-film` 恢复。
- `revise`：提交不超过 2000 字符的修改要求，生成新的计划版本和 checksum，再次暂停等待批准。
- `cancel`：进入 `cancelled`，仅结算已经完成的规划步骤，视频步骤退款一次。

重复批准同一 revision 必须返回同一恢复结果；旧 revision、旧 checksum 或跨用户批准返回 409/404，不触发视频任务。

## 7. 视频执行适配

新增通用 Skill 视频步骤适配器 `video_generate`，不得通过前端 `chat-tools.ts` 的默认模型上下文提交。适配器从 Run 冻结数据读取：

- video `providerId + modelId`
- 模型能力快照
- 批准后的 `finalVideoPrompt`
- 比例、分辨率、时长、音频开关
- 受权威 AssetVersion 解析出的首帧和尾帧
- 当前用户、项目、workspace、Run、step 和 generation

适配器调用现有 `/api/video/generate`，传递 Skill operation 的数据库幂等键。收到远程 `taskId` 后立即持久化 accepted 状态，再使用现有任务恢复与轮询逻辑等待终态。

若连接在远程是否接单未知时中断，步骤进入不可盲重试的 `SKILL_SUBMISSION_UNKNOWN`；用户必须先核对原任务。不得重新选择供应商或创建第二个远程任务。

## 8. 任务、积分与终态

执行前预估包括 orchestrator 规划成本和所选视频模型在当前时长下的成本。Run 创建时按现有统一 Skill Runtime 预扣总额。

- 规划完成后取消：保留规划成本，只退款未执行的视频成本。
- 视频提交失败且供应商明确未接单：视频步骤退款一次。
- 视频 accepted 后取消：调用现有供应商取消能力；最终退款按权威任务终态结算。
- 远程完成晚于 `failed/cancelled/timeout`：记录迟到审计，不得覆盖终态或创建资产。
- 成功：只扣一次，无退款。
- 相同用户、相同幂等键、相同请求摘要返回同一 Run；同键不同摘要返回 409。

所有错误保留 `requestId`、Run ID、内部 taskId、远程 taskId、providerId、modelId、原始安全错误摘要和 `retryable`，不得记录 API Key、Token 或完整隐私图片。

## 9. 结果与资产

成功结果使用 `brief-to-video-result-v1`：

```ts
interface BriefToVideoResultV1 {
  schemaId: 'brief-to-video-result-v1';
  runId: string;
  planChecksum: string;
  videoAssetVersionId: string;
  sourceAssetVersionIds: string[];
  providerId: string;
  modelId: string;
  remoteTaskId?: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution?: string;
  thumbnailUrl?: string;
}
```

视频任务的现有投影器创建 `kind: 'video'` AssetVersion，并把首帧、尾帧来源版本作为父版本。Skill 结构化输出只引用 AssetVersion ID，不把临时供应商 URL 当作长期结果。缩略图存在时按现有媒体链路保存；没有缩略图时允许播放器使用视频首帧，不伪造图片资产。

原素材、原 Placement 和历史版本均不可修改。刷新恢复必须解析相同 Run 和相同 `videoAssetVersionId`，不得重复投影。

## 10. 三工作区交互

### 10.1 无限画布

入口位于无限画布 AI 对话的 Skills 面板。结构化表单显示 Brief、平台、目标、能力驱动的视频参数和首尾帧。规划完成后在原位置显示脚本审批卡；批准后显示真实服务端进度。成功视频以新节点加入画布，可播放、下载和查看来源。

### 10.2 节点模式

复用现有 `ai-skill` 节点。输入图片端口分别绑定首帧和尾帧，属性面板选择 orchestrator 与 video 模型。等待审批时节点显示“等待确认”，Workflow 暂停下游执行；批准后恢复同一 Run，下游 `output-video` 节点接收 `videoAssetVersionId`。

### 10.3 独立智能对话

不增加 Skill 目录项。仅当用户明确表达“根据 Brief 生成最终视频/成片”且参数足够时触发意图适配器；缺少 Brief、平台、时长、比例或视频模型时逐项追问。规划结果以审批卡呈现，成功后显示同一视频 AssetVersion，并可通过现有工作区交接返回画布。

## 11. UI 与可访问性

- 使用现有 Skill 输入组件、进度组件和结果卡视觉变量，并增加可复用的脚本审批卡；不创建新的中央浮窗。
- Canvas 面板继续贴合 AI 对话区域；节点属性保持现有密度；Simple Chat 结果卡不显示 Canvas 专用工具。
- 能力选项变化时保留仍合法的值，非法值立即清除并要求重新选择。
- “批准生成”显示本次视频步骤将消耗的积分；取消按钮与批准按钮不得重叠。
- 375px 下单列显示，按钮最小触控高度 40px，模型菜单和审批卡不得被对话内容遮挡。
- 减少动态效果模式下关闭非必要过渡动画，但不隐藏状态变化。

## 12. 安全与资源边界

- Brief 4000 字符、修改要求 2000 字符、负面约束 1000 字符、最多两张受管来源图片。
- 请求体沿用 Skill Run 256KB 上限和对象深度、键数、数组长度限制。
- 图片读取统一经过 AssetService 与安全媒体读取器；不接受任意公网图片 URL 直通供应商。
- 远程视频结果进入资产前执行受控下载或稳定 URL 持久化策略，校验 MIME、签名、字节上限和超时。
- 审批、恢复、取消和下载均校验 owner + project + Run/AssetVersion 归属。
- 日志不得包含完整 Brief 中的敏感内容，只记录摘要和 checksum。

## 13. 测试策略

### 13.1 单元与组件

- 输入解析、能力驱动选项、模式推导、计划 schema 与 checksum。
- 审批 revision/checksum、重复批准、跨用户批准和修改后再次暂停。
- 视频适配器精确 provider/model、幂等键、首尾帧映射和 unknown submission。
- 结果 schema、视频 AssetVersion 父版本和刷新恢复。
- Canvas、Workflow、Simple Chat 的目录隔离与审批 UI。

### 13.2 API 与 PostgreSQL

- 20 次并发创建只产生一个 Run 和一个视频任务。
- 批准与取消竞态只允许一个权威终态。
- 规划后取消只退款视频步骤一次。
- accepted 后取消、超时、失败和迟到完成不重复扣退、不创建迟到资产。
- 沙箱重启后从同一 operation/remote task 恢复。

### 13.3 浏览器与云端

- Chromium、Firefox、WebKit 和 375px 验证表单、审批、取消、刷新恢复和布局。
- Coze exact commit 使用稳定供应商进行一次真实成功成片和一次可控取消。
- 核对远程 taskId、内部 taskId、Run、积分流水和视频 AssetVersion 一一对应。
- 实际播放视频、下载文件并校验字节、MIME、签名、时长和分辨率。
- 保存 screenshot、video、trace、Console、Network 和机器可读证据；宿主噪声与应用错误分开记录。

## 14. 发布与回滚

功能标志 `BRIEF_TO_VIDEO_SKILL_ENABLED` 默认关闭。先完成本地、隔离 PostgreSQL 和跨浏览器门禁，再在 Coze 测试账号开启。云端成功、取消、账务、资产和恢复证据齐全后才允许默认开启。

回滚只关闭功能标志和目录入口，不删除 Skill Run、任务、积分流水或 AssetVersion。历史结果仍可读取和下载。`stable` 保持只读。

## 15. 完成标准

- Canvas、Workflow 和 Simple Chat 均能通过各自交互方式运行同一 Skill。
- 脚本审批前没有视频任务；审批后只创建一个远程任务。
- 视频参数全部来自所选模型能力范围。
- 成功生成一条可播放、可下载、可刷新恢复的视频成片。
- 成功仅扣费一次；取消/失败/超时最多退款一次；迟到结果不覆盖终态。
- 最终视频具有独立 AssetVersion、正确父版本和完整来源追踪。
- 现有 29 个 Canvas/Workflow Skills 全部保留，新增本 Skill 后 Canvas/Workflow 为 30 项；Simple Chat 目录继续为 16 项。现有视频功能和入口没有丢失。
- 本地全量门禁、隔离 PostgreSQL、四浏览器矩阵、Coze exact commit 与真实供应商证据全部通过。
- Obsidian 阶段看板和中文测试报告同步更新；云端证据不足时只能标记 `CLOUD UNVERIFIED`。
