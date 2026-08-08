# 无界AI共享稳定内核升级设计

> 计划编号：`WJ-STABLE-001`  
> 状态：已完成对话评审，等待书面规格复核  
> 设计基线：Git `69ba94ef6bde041293ad9609ec76285d3e287a7f`  
> 设计日期：2026-08-08  
> 当前阶段：只建立设计、约束和实施门禁，不修改业务代码

## 1. 总目标

在完整保留无界现有功能、三个特色工作区和旧项目数据的前提下，建立共享稳定内核，使无界达到可持续迭代、任务可信、画布流畅、功能真实可用、升级可验证和故障可回退的商业级受控状态。

六项不可变结果：

1. 现有功能不得丢失或被无声隐藏。
2. 无限画布、节点模式和独立智能对话必须保留，并继续服务不同用户群体。
3. 三个工作区采用“完全互通”策略，素材、结果和上下文可以受控流转。
4. 所有编辑采用 A1 不可覆盖版本策略，原始素材不会被结果覆盖。
5. 核心任务、积分、退款、恢复和模型路由必须以持久化事实为准。
6. 未经本地、数据库、浏览器和云端真实验证的版本不得判定为正式可发布版本。

## 2. 当前判断与设计边界

当前无界是 Next.js 16、React 19、TypeScript、PostgreSQL 构成的模块化单体，具有多供应商生成、无限画布、节点工作流、独立聊天、图片编辑、视频、3D、PSD/SVG、专业业务面板、管理员和积分支付等广泛能力。

产品功能范围接近 L4，但公共架构、数据一致性、任务终态、跨入口复用和发布门禁仍处于约 L3.5。当前主要矛盾不是功能不足，而是功能增长快于公共内核和质量体系收敛。

本设计不做以下事情：

- 不全量重写无界。
- 不一次性更换无限画布引擎。
- 不以删除节点、工具或入口换取性能。
- 不在公共链路收敛前继续复制新的供应商调用实现。
- 不把视觉改版与业务架构迁移混成一次大提交。
- 不把供应商不可用直接归为程序缺陷，也不把程序参数错误归因于供应商。

## 3. 三个工作区的产品边界

### 3.1 无限画布

面向视觉创作和素材组织用户，保留自由布局、图片组、参考图组、融图组、批注、图片工具栏、底部工具栏、专业面板、任务结果、历史和项目恢复。

### 3.2 节点模式

面向专业工作流用户，保留现有节点类型、连线语义、AI建图、执行、素材引用、预设、导入、日志、撤销重做和工作流保存。

### 3.3 独立智能对话

面向低门槛自然语言用户，保留普通对话、图片理解、附件、记忆、分享、模型比较、深度研究和 Agent。独立聊天与无限画布内聊天是不同入口，不能混淆页面、路由或数据口径。

### 3.4 完全互通

三个工作区共享素材身份、素材版本和任务事实，但保留独立布局、交互和历史。跨工作区操作通过受控服务完成：

```typescript
sendVersionToWorkspace({
  projectId,
  assetVersionId,
  targetWorkspace,
  placementHint,
});

createDerivedTask({
  sourceVersionIds,
  targetWorkspace,
  operation,
  providerId,
  modelId,
  parameters,
});
```

目标闭环：

```text
智能对话生成
-> 发送到无限画布
-> 画布编辑产生新版本
-> 发送到节点模式
-> 节点处理产生新版本
-> 返回智能对话
-> 查看完整来源关系
```

## 4. 功能零丢失机制

### 4.1 受保护功能目录

现有页面、API、工具、按钮、菜单、节点类型、Agent 工具、管理员模块和数据能力必须使用稳定 `featureId` 登记。例如：

```json
{
  "featureId": "canvas.image.remove-background",
  "name": "移除背景",
  "workspace": "canvas",
  "entrances": ["image-floating-toolbar", "image-context-menu"],
  "api": ["/api/image-edit"],
  "actions": ["removebg"],
  "resultKinds": ["image", "mask"],
  "preservesOriginal": true
}
```

发布候选与基线比较时，以下任一变化均阻止发布：

- `featureId`、入口、路由、节点类型或 Agent 工具减少。
- 按钮存在但事件未绑定，或打开错误面板。
- 权限范围意外缩小，普通用户看不到管理员已授权模型。
- 选择的供应商模型与实际提交路由不一致。
- 结果类型、原图保护或保存恢复语义被改变。

### 4.2 界面与项目基准

迁移前保存三个工作区的全页、工具栏、面板、右键菜单、节点类型、管理员菜单截图，以及 DOM 入口、可访问性树和关键操作录像。

准备固定兼容样本：单图、100图压力、图片组、参考图组、融图组、批注、视频、3D、PSD、节点工作流、智能对话历史、失败和取消任务。每次迁移必须验证可打开、内容数量一致、媒体有效、位置一致、可继续编辑、可保存并再次打开。

## 5. 统一数据契约与版本图

### 5.1 统一项目

```typescript
interface UnifiedProject {
  id: string;
  ownerId: string;
  name: string;
  status: 'active' | 'archived' | 'trashed';
  workspaces: {
    canvas?: WorkspaceReference;
    workflow?: WorkspaceReference;
    chat?: WorkspaceReference;
  };
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}
```

### 5.2 素材与不可覆盖版本

```typescript
type AssetKind =
  | 'image'
  | 'video'
  | 'model-3d'
  | 'psd'
  | 'svg'
  | 'document'
  | 'audio';

interface Asset {
  id: string;
  projectId: string;
  ownerId: string;
  kind: AssetKind;
  currentVersionId: string;
  status: 'active' | 'trashed';
  createdAt: string;
}

interface AssetVersion {
  id: string;
  assetId: string;
  parentVersionIds: string[];
  source: {
    workspace: 'canvas' | 'workflow' | 'chat';
    projectId: string;
    entityId?: string;
    action: string;
  };
  file: {
    url: string;
    mimeType: string;
    width?: number;
    height?: number;
    byteSize?: number;
    checksum?: string;
  };
  generation?: {
    taskId: string;
    providerId: string;
    modelId: string;
    parameters: Record<string, unknown>;
    prompt?: string;
    referenceVersionIds?: string[];
  };
  billingTransactionId?: string;
  createdBy: string;
  createdAt: string;
}
```

单输入编辑有一个父版本，融图和多参考图可有多个父版本。失败、取消和超时任务不产生有效当前版本。迟到结果进入隔离记录，不覆盖终态或当前版本。删除工作区节点只删除引用，不直接删除素材。

### 5.3 工作区放置

```typescript
interface WorkspacePlacement {
  id: string;
  workspaceId: string;
  assetVersionId: string;
  entityType:
    | 'canvas-image'
    | 'workflow-input'
    | 'workflow-output'
    | 'chat-attachment'
    | 'chat-result';
  transform?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    zIndex: number;
  };
  metadata?: Record<string, unknown>;
}
```

素材有效性与画布坐标分离，避免节点移动影响原文件、删除一处引用误删其他入口、同一图片跨工作区重复上传，以及媒体失效被误表现为普通空白框。

### 5.4 旧项目兼容

使用版本化读取器，不做打开即破坏性转换：

```text
schemaVersion 1 -> LegacyProjectReader
schemaVersion 2 -> TransitionalProjectReader
schemaVersion 3 -> UnifiedProjectReader
```

旧项目原样读取；用户首次产生新修改时才写入新结构；转换失败继续使用旧读取器；没有通过固定旧项目样本测试前，不得删除旧字段或读取器。

## 6. 统一任务、模型与账务核心

### 6.1 模型能力目录

所有入口只通过 `providerId + modelId + capabilities` 获取模型能力，包括比例、尺寸、质量、数量、参考图、蒙版、视频时长、协议、同步或异步模式、输出格式和审核限制。UI 不直接理解 Pear、302、APIB、4S 等协议差异。

任务同时记录：

```typescript
requestedRoute: { providerId: string; modelId: string };
actualRoute: {
  providerId: string;
  modelId: string;
  fallbackReason?: string;
};
```

显式选择的路由不可在凭据或参数异常时静默降级到其他供应商。

### 6.2 数据库权威状态机

```text
created -> queued -> submitting -> processing -> persisting -> completed
             |          |             |             |
             +----------+-------------+-------------+-> failed/cancelled/timeout
```

禁止 `failed/cancelled/timeout -> completed`，禁止同一任务重复结算，禁止内存、SSE、轮询或前端状态覆盖数据库终态。取消和超时必须向底层工作发出 `AbortSignal`；迟到结果只能记录，不能复活任务。

### 6.3 多图逐张返回

一次用户操作对应一个批次，每张图片是独立槽位和任务：

```typescript
interface GenerationSlot {
  slotIndex: number;
  taskId: string;
  status: TaskStatus;
  assetVersionId?: string;
  error?: UnifiedError;
}
```

供应商每完成一张，立即持久化并创建版本，通过 SSE 回填对应槽位；其他槽位继续运行。不得等整批全部完成后统一返回，也不得把多个供应商任务折叠为一个前端结果。

### 6.4 幂等与积分

任务创建、扣费、退款和重复请求使用 PostgreSQL 原子规则。幂等键至少绑定 `userId + idempotencyKey + requestDigest`；同键同请求返回同一任务，同键不同请求返回冲突。退款根据数据库最终终态执行一次性状态转换，不依赖组件或进程内 Map。

### 6.5 统一错误契约

```typescript
interface UnifiedError {
  code: string;
  message: string;
  source: 'client' | 'wujie' | 'provider' | 'database' | 'storage' | 'network';
  providerCode?: string;
  httpStatus?: number;
  retryable: boolean;
  requestId: string;
  taskId?: string;
  userAction?: string;
}
```

界面区分供应商审核拒绝、模型参数不支持、无界组装错误、网络中断、云端超时但上游仍执行、存储失败、积分不足和模型未授权。不得再使用浏览器原生弹窗暴露供应商原始 JSON。

## 7. 无限画布与 Agent 内核

### 7.1 画布职责拆分

保持现有渲染和功能，逐步拆分为：

```text
Canvas Renderer
Viewport Controller
Selection Controller
Canvas Commands
History Controller
Task Projection
Project Persistence
Tool Registry
Tool Session
Feature Panels
```

每次只抽取一个职责并保留行为测试，不同时修改无关 UI 或业务链路。画布和节点模式共享业务命令与素材版本，不强制共享渲染引擎。

### 7.2 共享 Agent 运行时

普通对话、画布聊天和节点 Agent 使用同一执行内核，通过不同上下文适配器接入。Agent 只能调用受控工具：

```text
list_project_assets
inspect_asset_version
create_generation_task
create_edit_task
send_version_to_workspace
create_workflow_from_intent
run_workflow
get_task_status
cancel_task
```

每个工具具备权限和模型授权检查、参数校验、幂等键、积分预估、确认边界、取消信号和审计记录。Agent 不直接修改工作区内部 React 状态。

## 8. UI、交互与动效系统

### 8.1 设计原则

UI 升级不是全量换皮，而是建立统一、可预测、可访问、可回归的交互内核。三个工作区保留各自密度和操作方式，共享设计令牌、图标、表单、弹窗、任务反馈和错误规范。

优先级：

```text
功能可用与状态可信
> 交互效率与布局稳定
> 可访问性与响应式
> 视觉一致性
> 非必要视觉特效
```

### 8.2 工具栏和面板

- 底部工具栏使用贴合底部的抽屉式工具面板，支持分类、搜索、最近使用和固定工具。
- 图片浮动工具栏根据可用空间自动翻转、压缩或分页，不超出视口、不被侧栏遮挡。
- 图标与名称居中对齐，统一图标尺寸、44px 最小点击区和至少 8px 间距。
- 使用 Lucide 图标和工具提示，不用文字圆角块替代熟悉图标。
- 面板统一标题栏、关闭、折叠、拖动、最小化、恢复和焦点行为。
- 禁止卡片嵌套卡片；工具面板保持紧凑、工作导向，避免营销式大标题。
- 模型选择后，只显示该模型真实支持的比例、尺寸、质量、数量和时长。

### 8.3 状态与反馈

统一展示排队、提交、生成、上传、逐张完成、失败、取消、超时、退款和重试。错误靠近触发位置显示，同时保留 `requestId` 和可执行动作。所有按钮有默认、悬停、按下、焦点、加载、禁用和错误状态。

### 8.4 动效边界

必要动效用于解释状态和空间关系：

- 抽屉和面板切换：150-240ms。
- 工具选中：颜色和背景状态变化。
- 素材跨工作区发送：短暂空间连续提示。
- 拖放落点：明确目标高亮。
- 节点执行：受控流向和阶段进度。
- 多图任务：每张结果独立回填。

禁止大面积粒子、持续背景动画、昂贵模糊滤镜、所有按钮弹跳、阻塞操作的过场、通过动画宽高引发布局重排。支持 `prefers-reduced-motion`；低性能和高节点场景自动降低非必要动效。

### 8.5 UI 发布门禁

- 受保护入口保留率 100%。
- 工具按钮绑定率 100%。
- 1366x768 和 1920x1080 不错位、不遮挡、不叠加、不超出视口。
- 键盘焦点、Escape、返回和关闭行为正确。
- 无浏览器原生业务错误弹窗。
- 动效不导致画布明显掉帧。
- Chromium、Firefox、WebKit 视觉和交互回归通过。
- UI 变更不得改变模型路由、任务数量、积分或保存语义。

## 9. 六阶段实施路线

### 阶段 0：版本收口与功能冻结

确认 GitHub、本地和云端提交一致；建立功能目录、界面证据和旧项目样本；整理补丁和未提交文件；暂停新增业务功能。

完成标准：能明确回答云端 Commit；功能有唯一 `featureId`；入口有截图或 DOM 证据；不再靠历史对话判断功能是否丢失。

### 阶段 1：稳定任务与账务核心

统一模型能力、供应商适配、任务状态、逐张回图、取消超时、幂等、扣费退款、错误归因和刷新恢复。

完成标准：`n=1/2/3/4` 真实通过；每张独立返回；终态唯一；同一幂等请求只扣一次；PostgreSQL 并发测试通过；三个工作区共享任务事实。

### 阶段 2：素材与版本图

建立 `Asset`、`AssetVersion` 和 `WorkspacePlacement`；实现跨工作区发送、父子来源、回收站、孤立媒体处理、空白图片框修复和旧项目兼容。

### 阶段 3：无限画布稳定内核

拆分视口、选择、命令、历史、任务投影和工具注册；分级加载图片；解决平移消失、拖动、缩放、撤销、重置视图、保存阻塞和工具定位；保留全部入口。

### 阶段 4：节点模式与智能对话

节点模式先建立 React Flow 验证层，再逐步迁移拖动、连线、选择和视口；智能对话拆分普通对话、图像理解和 Agent；完成三工作区互通。

### 阶段 5：业务工具质量提升

按顺序闭环：图像生成与参考图、去背景、擦除与蒙版、调色、放大、批注、元素拆解与 PSD、视频、3D、人物精修、品牌和专业工具、管理员、用户、积分、充值与支付。

每项必须覆盖正常、供应商拒绝、超时、取消、重试、退款、保存恢复、连续第二次操作、三工作区传递和三浏览器回归。

## 10. 测试和性能门禁

### 10.1 六层测试

```text
L1 静态产品契约
L2 单元测试
L3 组件与交互测试
L4 API与PostgreSQL集成测试
L5 Chromium/Firefox/WebKit真实浏览器E2E
L6 云端真实供应商、对象存储和账务验收
```

本地编译、Lint、单元测试或 HTTP 200 都不能代替真实业务成功。缺少 PostgreSQL 隔离测试库或真实供应商条件时，相关项必须标记“未验证”或“阻塞”，不能标记通过。

### 10.2 登录保护

每次候选版本都验证入口、正确登录、刷新保持、三个工作区进出、退出、错误密码、会话超时和鉴权接口超时。任何“正在验证身份”永久卡住或登录入口失效均阻止部署，即使改动看似与登录无关。

### 10.3 性能目标

无限画布：空画布 2 秒内可交互；缓存项目 3 秒内打开；100 节点平移平均不低于 55 FPS；300 节点不低于 45 FPS；拖动和缩放输入延迟 P95 不高于 50ms；图片消失帧和不可点击时间均为 0；保存主线程阻塞不超过 100ms。

节点模式：100 节点拖动不低于 55 FPS，300 节点缩放不低于 45 FPS，500 节点无持续冻结，100 节点自动布局不超过 1 秒，50 步撤销重做正确。

智能对话：2 秒内可交互，100 条消息滚动稳定，切换会话不超过 500ms，Agent 首次进度反馈不超过 1 秒，附件上传不阻塞输入。

## 11. 发布、回退与治理

### 11.1 固定发布顺序

```text
本地修改和完整验证
-> 提交并推送 GitHub
-> 记录 Commit SHA
-> Coze 部署标签页拉取和构建
-> 确认运行 Commit
-> 强制刷新和健康检查
-> 核心冒烟
-> 真实供应商与账务验证
-> 发布结论
```

云端临时修复必须回写 GitHub。不得在 Coze 对话框中把临时代码当正式部署，不得在未确认 Commit 时开始版本验收。

### 11.2 回退

保留 `current` 和 `previous-stable` 两个已验证版本。功能迁移使用 `legacy`、`core-v2-shadow`、`core-v2` 开关。任务保存 `handlerVersion`，旧任务继续由旧处理器解释。数据库优先只新增表和字段，破坏性删除至少延后一个稳定周期。

### 11.3 需求和缺陷治理

需求分为 `CORE`、`BUG`、`ENH`、`NEW`、`RESEARCH`。只有 P0、阻塞当前阶段的 P1、云端无法启动、登录完全不可用、数据迁移风险、安全泄漏和错误扣费允许插队。其他问题登记后进入对应阶段。

缺陷状态：

```text
发现 -> 待复现 -> 已复现 -> 根因确认 -> 测试已建立
-> 修复中 -> 本地通过 -> 云端待验 -> 云端通过 -> 已关闭
```

同一问题再次出现时重开原缺陷并标记“回归”，分析原测试为何未拦截。

### 11.4 文档事实源

- 仓库：工程事实、正式设计、计划、契约、测试和发布报告。
- Obsidian：长期目标、阶段路线、决策日志、进度和风险。
- GitHub：Commit、分支、CI、Release 和 Tag。
- 对话：协作过程，关键决定必须回写正式文档。

优先级：当前用户明确决定 > 已确认正式设计 > 已批准实施计划 > 当前代码和测试 > Obsidian 记录 > 历史对话。

旧报告如果与后续真实证据冲突，只作为历史证据，不能作为当前发布结论。例如旧 `docs/testing/RELEASE_READINESS_REPORT.md` 的“可投入生产”判断已被后续缺陷与未闭环验证推翻。

## 12. 阶段完成和最终成功标准

单个阶段只有在代码任务、功能保护、本地测试、P0/P1、旧项目、性能、云端 Commit、真实浏览器、真实供应商、账务证据、文档同步和回退方案全部满足后，才可标记完成。受外部条件阻塞时只能标记“有条件完成”。

最终成功要求：

- 受保护功能和旧项目兼容率均为 100%。
- P0 和 P1 为 0。
- 无永久生成中、重复扣费退款、恢复风暴、登录卡死和持续空白框。
- 三工作区完整互通并保留来源关系。
- 无限画布和节点模式达到性能指标。
- 全量 CI、三浏览器、PostgreSQL 并发和云端供应商链路通过。
- 每个修复有永久回归测试，部署 Commit 可追踪，具备可执行回退。

## 13. 实施前门禁

开始业务代码实施前必须依次完成：

1. 本设计写入仓库并完成自检。
2. 同步 Obsidian“无界计划”。
3. 建立可读的受保护功能清单和机器可读基线方案。
4. 建立计划编号、决策日志和阶段看板。
5. 用户审阅并批准本书面规格。
6. 为六个阶段分别生成可独立交付的详细实施计划。
7. 用户审阅实施计划。
8. 创建隔离升级分支或工作树。
9. 从阶段 0 开始实施。

第 7 步完成前，不修改业务代码。

## 14. 规格自检结果

- 占位符：无 `TBD`、`TODO` 或未定义完成项。
- 一致性：三个工作区、A1 版本策略、功能零丢失、数据库权威任务、UI 渐进升级和六阶段路线无冲突。
- 范围：本设计是总纲，实施时必须拆分为阶段 0-5 六份计划，不能作为一次性大改执行。
- 歧义：UI 特效明确为受控增强；旧报告明确不覆盖新证据；云端未验证明确不能标记完成。
