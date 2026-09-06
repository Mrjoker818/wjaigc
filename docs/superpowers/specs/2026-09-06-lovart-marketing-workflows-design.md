# Lovart 营销增量工作流第一批设计

日期：2026-09-06
状态：已批准，待实施
适用分支：`main`
只读基线：V5.8.8 donor、`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`

## 1. 目标

在已经完成云端验收的统一 Skill Runtime 上增加三项真实营销工作流：

1. 广告 A/B 变体
2. 再营销素材
3. 全渠道活动素材包

三项工作流必须交付可追踪的最终图片资产，而不是只输出快捷提示词。它们复用现有项目、模型目录、任务、积分、幂等、退款、AssetVersion、暂停、恢复、取消、重试和历史能力。

## 2. 不可破坏边界

- 保留现有 21 个 Canvas/Workflow Skills 的 ID、版本、输入、步骤、入口和行为。
- 新 Skill 仅允许 `canvas` 与 `workflow`，不进入独立 `/simple-chat` 的 16 个 Skills 目录。
- 不修改 Stage 4 画布内核、登录、管理员模型配置、积分流水规则或既有供应商任务状态机。
- 不复制 V5.8.8 整文件，不修改 `stable`。
- 不使用本地 GPU；图像生成仅调用管理员授权的远程模型。
- 不覆盖用户原始素材。所有结果创建新的 AssetVersion，并保留来源版本、Skill、步骤和冻结模型信息。

## 3. 方案选择

采用“目录定义 + 现有运行内核”的增量方案：

- 新建独立的营销增量 Skill 定义模块，避免继续扩大旧版 `canvas-presets.ts`。
- `catalog.ts` 合并旧 21 项与新增 3 项，Canvas 与 Workflow 得到完全相同的 24 项目录。
- 为全渠道输入补充通用 `multi-select` 字段类型，复用 `options` 与 `maximumItems` 做前后端一致校验；不使用无法校验的逗号文本代替。
- 规划执行使用现有 `chat`；成品执行复用现有 `img2img` 供应商链路，并在 Skill 步骤注册表增加受控适配器。适配器只接受当前用户、项目和工作区已授权的 AssetVersion URL，不接受客户端任意 URL。
- 规划步骤顺序执行；同一批成品步骤可使用相同 `parallelGroup` 并行执行。
- 每个生成步骤使用 `output-present` 质量门禁。不得把无 AssetVersion 的文本回复记为成品。

不采用以下方案：

- 将三项工作流写回旧 `RAW_CANVAS_PRESET_SKILLS`：会继续放大遗留文件并混淆旧 21 项基线。
- 新建营销专用执行器或账务表：会产生第二套任务与结算状态机。
- 一次实施全部九项 Lovart 工作流：批量数据集、视频和导出各有独立安全与交付边界，不应与第一批混合。

## 4. 共用输入与输出

### 4.1 共用输入

每项 Skill 使用现有结构化字段：

- `sourceImages`：图片，必填，最多 6 张。来自画布选择或节点上游图片；至少一张真实进入供应商参考图参数。
- `campaignName`：活动名称，必填。
- `product`：产品或服务，必填。
- `audience`：目标受众，必填。
- `sellingPoints`：核心卖点，必填。
- `tone`：品牌调性，默认“清晰、可信、具有行动感”。
- `aspectRatio`：生成比例，默认由具体工作流决定。
- `negativeConstraints`：禁止内容，可选。

输入缺少必填项时，沿用统一 Skill Runtime 的校验结果，不创建任务、不扣积分。模型绑定必须由执行前目录精确冻结为 `providerId + modelId`。`sourceImages` 只保存 AssetVersion ID，并必须与去重后的 `sourceVersionIds` 同序一致；服务端再按当前用户、项目、工作区和 AssetVersion 重新授权并解析规范 URL。客户端传入的图片 URL 不作为权威输入，也不得直接进入供应商请求。

首批不暴露 `brandKit` 输入。当前 Skill Runtime 只把它当作字符串 ID，尚未形成按用户授权、冻结内容快照并注入执行上下文的闭环；在该闭环完成前显示此字段会形成空壳。首批品牌约束由 `tone`、`sellingPoints`、`negativeConstraints` 和已授权来源图承担，Brand Kit 接入另行设计和验收。

### 4.2 共用输出

- 规划文本：受众、信息层级、视觉方向和交付矩阵。
- 图片 AssetVersion：每个成品步骤至少一个，带完整来源追踪。
- 运行历史：步骤进度、终态、错误、任务身份、积分与重试记录。
- 画布：结果作为新图片加入，不替换来源图片。
- 节点模式：结果写回同一个 `ai-skill` 节点，可继续传递给下游节点。

第一批不负责 ZIP 打包、平台文件命名和批量尺寸导出；这些属于后续“多平台批量尺寸和命名导出”工作流。

## 5. 工作流定义

### 5.1 广告 A/B 变体

Skill ID：`preset-ad-ab-variants`

新增输入：

- `objective`：转化目标，选项为认知、点击、加购、购买、留资。
- `channel`：投放渠道，选项为信息流、搜索展示、社交媒体、电商站内。
- `hypothesis`：希望验证的假设，可选。

步骤：

1. `plan`：编排模型输出唯一变量原则、受众洞察、A/B 假设和变体矩阵。
2. `variant-a`：生成基准创意，默认强调核心利益点。
3. `variant-b`：生成挑战创意，只改变规划中声明的主要测试变量。

质量要求：固定交付 A、B 两个独立 AssetVersion；每个变体的提示词必须写明变体编号、测试变量、受众、渠道、比例与已输入的品牌约束。首批不提供大于两张的动态变体数，避免引入未经设计的条件步骤执行语义。

### 5.2 再营销素材

Skill ID：`preset-retargeting-creative`

新增输入：

- `funnelStage`：漏斗阶段，选项为浏览未点击、点击未加购、加购未购买、老客复购。
- `objection`：主要顾虑，可选。
- `offer`：优惠或行动理由，可选。
- `urgency`：紧迫程度，选项为无、温和、明确，默认温和。

步骤：

1. `diagnose`：分析漏斗阶段、用户顾虑、可信证据和不可使用的夸大表达。
2. `proof`：生成以证据、口碑或功能解释为核心的素材。
3. `benefit`：生成以未完成利益和使用场景为核心的素材。
4. `offer`：在用户确实提供优惠时生成行动素材；未提供优惠时不得虚构折扣。

质量要求：固定交付证据型、利益型、行动型三个独立 AssetVersion；不得编造价格、折扣、销量、认证或用户评价；所有成品必须保留相同产品身份和来源视觉特征。没有优惠时，行动型素材使用非价格行动理由。

### 5.3 全渠道活动素材包

Skill ID：`preset-omnichannel-campaign`

新增输入：

- `channels`：`multi-select` 目标渠道，默认“小红书、微信、Instagram、电商站内”，最多 6 项，候选为小红书、微信、微博、抖音、Instagram、Facebook、电商站内、品牌官网和邮件。
- `campaignMessage`：统一主张，必填。
- `callToAction`：行动文案，必填。
- `visualAnchor`：必须保持一致的视觉锚点，可选。

步骤：

1. `campaign-plan`：编排模型建立主视觉、内容层级、渠道矩阵和一致性规则。
2. `master-key-visual`：生成活动主视觉。
3. `social-adaptation`：生成社交渠道适配创意。
4. `commerce-adaptation`：生成电商渠道适配创意。
5. `owned-media-adaptation`：生成品牌自有渠道适配创意。

质量要求：所有适配图共享活动主张、产品身份、品牌色和视觉锚点；渠道差异只体现在信息密度、构图与行动区。第一批输出创意资产，不冒充精确像素尺寸打包。

## 6. 运行与错误处理

- 估价必须覆盖所有实际启用的生成步骤，确认后才允许执行。
- 成品步骤必须通过受控 `img2img` 适配器把来源 AssetVersion 解析为规范 URL；供应商支持多参考图时发送全部已授权图片，模型能力上限不足时在提交前明确拒绝，不能静默丢弃或换模型。
- 并行步骤分别拥有独立 operation key、幂等键和远程 taskId。
- 单步失败必须保留供应商原始错误摘要和任务身份；父 Run 进入可重试状态。
- 从失败步骤重试不得重跑已完成步骤，不得重复扣除已完成步骤费用。
- 取消必须中止未提交或进行中的子任务；已扣未交付部分按现有数据库终态规则退款一次。
- 迟到结果不得覆盖 cancelled、failed 或 timeout 终态。
- 页面刷新后从持久 Run 与 AssetVersion 恢复进度和成品，不依赖 React 内存缓存。

## 7. UI 与入口

- Canvas AI 对话的 Skills 面板新增三个营销 Skill 卡片，沿用现有搜索、分类、推荐和“我的 Skills”布局。
- 节点模式 `ai-skill` 下拉目录同步出现三项，不增加新的节点类型。
- 输入继续使用共用 `SkillInputFields`，进度继续使用 `SkillRunProgress` 和 `SkillRunHistory`。
- 不增加底部工具栏按钮，避免工具栏继续膨胀。
- `/simple-chat` 不显示这三项，且服务端必须拒绝以 `surface=simple-chat` 执行。

## 8. 测试与验收

### 8.1 TDD 基线

先增加失败测试，至少覆盖：

- 旧 21 项 ID、版本和定义摘要完全不变。
- Canvas 与 Workflow 从 21 项增至 24 项且顺序稳定。
- Simple Chat 保持 16 项，与 Canvas/Workflow 交集仍为 0。
- 三项 Skill 输入、默认值、范围、步骤、并行组、模型角色和质量门禁准确。
- 超量图片、超量渠道或非法枚举值在任务创建前拒绝。
- `multi-select` 拒绝重复项、未知选项、非字符串项和超过 `maximumItems` 的数组，并在前端提供复选框组，不要求用户手写分隔符。
- 精确 provider/model 冻结、估价、多子任务幂等、部分失败重试、取消退款和迟到结果隔离。
- Canvas 与 Workflow 产生新的 AssetVersion，不覆盖来源版本。
- 刷新后恢复运行和成品。

### 8.2 回归门禁

- 三项新 Skill 聚焦单元、API、组件、PostgreSQL 并发测试通过。
- 现有统一 Skill Runtime 专项全部通过。
- 21 项旧 Canvas Skills 与 16 项 Simple Chat Skills 保护基线通过。
- TypeScript、构建版 ESLint、生产构建和全仓回归通过。
- `stable` SHA 在实施前后完全一致。

### 8.3 云端真实验收

Coze 精确拉取新 `main` 并重启后，使用现有浏览器页面验证：

- Canvas 和 Workflow 各运行至少一项新 Skill。
- 精确模型/供应商、估价、唯一扣费、AssetVersion、画布入图、保存刷新恢复成立。
- 完成一次并行步骤部分失败后的原位重试。
- 完成一次进行中取消并证明只退款一次、迟到结果不覆盖。
- Console、Network 和持久事件证据保存；无法取得的证据明确记为未验证。

## 9. 后续批次

第一批关闭后再进入：

- 第二批：YouTube/B站缩略图、Pinterest 图钉、CSV/JSON 批量 SKU 商品素材。
- 第三批：Amazon 等平台合规检查、Brief 到视频成片、多平台批量尺寸和命名导出。

每一批单独设计、TDD、回归和云端验收，不用第一批的通过结论替代后续验证。
