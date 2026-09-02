# 无界画布与节点模式 Skill 作用域设计

## 1. 背景

无界当前存在两套面向不同用户群体的 Skill 目录：

- 无限画布 AI 对话面板内的 21 个创作 Skills，面向视觉创作、画布资产和生成任务；
- 独立智能对话页面 `/simple-chat` 内的 16 个办公与通用对话 Skills，面向独立会话、知识工作和通用助手场景。

Stage 4 已建立 Canvas、Workflow、Simple Chat 可复用的 Agent Runtime，但共享运行时不等于共享产品目录。若直接把画布 Skills 迁入独立智能对话，会混淆用户定位、污染界面，并让 Skill 获得不应存在的画布上下文权限。

本设计补充并收紧 Stage 4 的 Skill 边界：**21 个画布 Skills 只在无限画布和节点模式出现，独立智能对话继续使用自己的 Skill 体系。**

## 2. 目标

1. 保留现有 21 个画布 Skills，数量、标识、名称和能力不得减少。
2. 同一批画布 Skills 可从无限画布 AI 对话面板和节点模式调用。
3. 独立智能对话继续保留现有 16 个 Skills，不展示或调用画布 Skills。
4. 三个工作区只共享任务、模型、积分、幂等、取消、事件和资产版本等底层运行能力。
5. 前端目录过滤与服务端执行授权同时生效，防止仅靠隐藏按钮形成越权入口。
6. 迁移期间保持旧画布 Skill 数据兼容，不删除用户已有配置和使用记录。

## 3. 非目标

- 不合并无限画布 AI 对话和 `/simple-chat` 的界面。
- 不把独立智能对话的 16 个 Skills 转换为画布节点。
- 不重写现有 Agent Runtime、积分账务或云任务状态机。
- 不在本阶段改变 Skill 的文案、提示词质量、UI 风格或业务输出效果。
- 不删除现有工作区入口、底部工具栏入口或节点类型。

## 4. 产品边界

### 4.1 无限画布

无限画布 AI 对话面板展示全部 21 个画布 Skills。Skill 可读取经过授权的当前项目、选中节点、选中图片、引用图片和画布资产版本，并把结果写回当前画布。

### 4.2 节点模式

节点模式复用同一份画布 Skill 定义，不复制第二套名称、提示词或参数。每个 Skill 可创建为 Skill 节点，通过标准节点输入接收提示词、图片、参考图和上游结果，并通过标准节点输出交付图片、文本、任务和资产版本。

节点模式只复用 Skill 定义与执行入口，节点位置、端口、连线、执行日志和撤销重做仍由 Workflow 管理。

### 4.3 独立智能对话

`/simple-chat` 只加载独立智能对话的 16 个办公与通用 Skills。它不展示画布 Skill，不接受画布 Skill ID，也不因为共享 Agent Runtime 自动获得画布选择、节点或项目资产上下文。

独立智能对话与画布之间已有的受控资产发送、结果回传和返回工作台能力继续保留，但这些是显式跨工作区操作，不等于 Skill 目录互通。

## 5. 领域模型

新增统一的 Skill 定义契约，建议放置于独立的 Skill 领域模块，而不是继续散落在大型组件中：

```ts
type SkillSurface = 'canvas' | 'workflow' | 'simple-chat';

interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  allowedSurfaces: readonly SkillSurface[];
  inputSchema: SkillInputSchema;
  outputSchema: SkillOutputSchema;
  version: number;
}
```

作用域固定如下：

```text
画布 21 Skills      allowedSurfaces = [canvas, workflow]
独立对话 16 Skills  allowedSurfaces = [simple-chat]
```

`allowedSurfaces` 是授权字段，不是展示提示。客户端可据此过滤目录，服务端必须在创建运行前再次验证。

用户自定义画布 Skill 默认继承 `[canvas, workflow]`，不得自动进入 `/simple-chat`。独立智能对话未来新增的自定义 Skill 默认继承 `[simple-chat]`。跨目录复制必须是未来单独设计的显式操作，本阶段不提供。

## 6. 组件边界

### 6.1 Skill Catalog

负责：

- 保存画布 21 Skills 和独立对话 16 Skills 的规范定义；
- 按 `surface` 返回允许的目录；
- 校验 Skill ID、版本、输入和输出；
- 为旧本地存储记录提供只读兼容与迁移。

Catalog 不负责模型调用、扣费、任务轮询或 UI 状态。

### 6.2 Skill Runtime Adapter

负责把 Skill 定义转换为现有 Agent Runtime 请求：

- 固定真实 `providerId + modelId`；
- 附加用户、项目、会话和来源资产版本；
- 生成用户级幂等键和规范化请求摘要；
- 将 Skill 输入映射到已有工具注册表；
- 将运行事件投影为画布进度或节点执行日志。

Runtime Adapter 不维护第二套任务状态。任务终态、取消、退款和恢复继续以现有 Agent Runtime 与数据库状态为准。

### 6.3 Canvas Adapter

把当前画布选区、图片引用和项目资产转换为 Skill 输入；执行成功后创建新资产版本并写回画布。旧结果不得覆盖来源资产，除非 Skill 明确定义为替换型操作且用户确认。

### 6.4 Workflow Adapter

把节点字段和上游端口转换为同一 Skill 输入结构；把 Skill 输出转换为节点输出。画布调用和节点调用对相同输入应生成等价的业务请求，不维护两份提示词拼装逻辑。

### 6.5 Simple Chat Adapter

只接受 `allowedSurfaces` 包含 `simple-chat` 的 Skill。收到画布 Skill ID 时返回稳定的作用域错误，不静默降级到普通聊天，也不替换成名称相近的独立对话 Skill。

## 7. 数据流

### 7.1 无限画布

```text
用户选择画布 Skill
  -> Catalog 按 canvas 过滤并读取定义
  -> Canvas Adapter 收集受控画布上下文
  -> 服务端再次验证 canvas 作用域
  -> Skill Runtime Adapter 创建 Agent Run
  -> Agent Runtime 执行、计费、发出进度事件
  -> Canvas Adapter 写入结果资产版本
  -> 画布显示结果并保留来源关系
```

### 7.2 节点模式

```text
用户创建 Skill 节点
  -> Catalog 按 workflow 提供同一份 21 Skill 定义
  -> Workflow 校验端口并收集上游输入
  -> 服务端再次验证 workflow 作用域
  -> Skill Runtime Adapter 创建 Agent Run
  -> Agent Runtime 执行并推送事件
  -> Workflow Adapter 写入节点输出和执行日志
  -> 下游节点接收结果
```

### 7.3 独立智能对话

```text
用户打开 /simple-chat
  -> Catalog 只返回 simple-chat 目录
  -> 画布 Skill 不进入 UI
  -> 伪造画布 Skill ID 的请求被服务端拒绝
```

## 8. 权限与错误处理

服务端在执行前依次验证：

1. 用户登录状态；
2. Skill 是否存在且版本有效；
3. 当前产品表面是否在 `allowedSurfaces` 中；
4. 项目、图片和资产版本是否属于当前用户；
5. `providerId + modelId` 是否对当前用户授权且能力匹配；
6. 输入结构、文本长度、图片数量和总请求体大小；
7. 幂等键是否与规范化请求摘要一致。

作用域错误使用稳定错误码，例如：

```json
{
  "success": false,
  "code": "SKILL_SURFACE_FORBIDDEN",
  "message": "此 Skill 不适用于当前工作区",
  "retryable": false
}
```

错误不得被吞掉或改写为泛化的“稍后再试”。运行失败、取消和超时沿用现有任务终态与原子结算逻辑。

## 9. 兼容与迁移

1. 先把 21 个内置画布 Skills 提取为规范 Catalog，保持原 ID 不变。
2. 读取旧 `chat-skills` 和服务端 `chat_skills` 时补齐 `[canvas, workflow]`，不修改独立对话数据。
3. 无限画布先切换到 Catalog，UI 和现有操作保持不变。
4. 节点模式增加 Skill 节点适配器，直接引用同一 Catalog。
5. `/simple-chat` 增加目录隔离和服务端拒绝测试，但不迁移其 16 个 Skills。
6. 新旧路径短期并行时只允许一个执行入口扣费，旧路径作为兼容读取层，不能重复创建任务。

## 10. 测试设计

### 10.1 目录与契约测试

- Canvas 目录恰好包含现有 21 个内置 Skill ID；
- Workflow 目录包含同一组 21 个 ID；
- Simple Chat 目录不包含任何画布 Skill ID；
- Simple Chat 原有 16 个 Skill ID、名称和入口保持不变；
- 受保护 Skill 数量和入口数量没有减少。

### 10.2 服务端授权测试

- `canvas` 可执行画布 Skill；
- `workflow` 可执行画布 Skill；
- `simple-chat` 请求画布 Skill 返回 `SKILL_SURFACE_FORBIDDEN`；
- Canvas 或 Workflow 请求独立对话 Skill 同样被拒绝；
- 伪造前端参数不能绕过作用域、模型或资产所有权验证。

### 10.3 运行时测试

- 画布与节点对相同 Skill、相同输入生成等价的规范请求；
- 并发重复提交只创建一个任务并只扣费一次；
- 取消、失败和超时只结算一次；
- 页面刷新后可恢复进度和终态；
- 旧 Skill 数据迁移后仍可使用且使用记录不丢失。

### 10.4 真实浏览器回归

- 无限画布 AI 对话面板逐项显示 21 个 Skills；
- 至少选择一个文本 Skill 和一个图片 Skill 完成真实运行并回写画布；
- 节点模式可创建 Skill 节点、连线、运行并把结果传给下游；
- `/simple-chat` 只显示其原有 Skills，搜索也不能检出画布 Skills；
- 三个工作区之间导航、模型选择、积分显示和历史记录不串状态；
- Chromium 为主门禁，Firefox 和 WebKit 执行核心目录与运行回归。

## 11. 发布与回滚

- 仅在 `main` 实施和验证，不修改 `stable`。
- 使用服务端开关控制 Canvas Catalog 和 Workflow Skill 节点接入；关闭开关时回退到旧画布读取路径。
- 回滚不得删除新格式数据；旧客户端应能忽略新增作用域字段。
- 云端验收前必须记录 Git Commit、部署地址、测试账号、模型、任务 ID、积分前后值、截图、Trace、Console 和 Network 证据。

## 12. 验收标准

只有同时满足以下条件才可标记完成：

1. 21 个画布 Skills 在无限画布与节点模式均可见、可执行；
2. 21 个画布 Skills 在 `/simple-chat` 中完全不可见且不可越权调用；
3. 独立智能对话原有 16 个 Skills 无删除、无重命名、无行为回归；
4. 画布和节点共用一份 Skill 定义及一套运行时结算，不产生重复任务或重复扣费；
5. 本地测试、构建和三浏览器核心回归通过；
6. Coze 最新 `main` 部署完成真实登录、执行、积分和结果回写验收；
7. `stable` 分支保持不变。
