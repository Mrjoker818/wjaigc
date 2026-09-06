# Lovart 第二批内容与商品工作流设计

## 1. 目标

在第一批 Lovart 营销工作流已经有条件关闭的基础上，新增三个当前缺失的真实工作流：

1. YouTube/B站缩略图
2. Pinterest 图钉
3. CSV/JSON 批量 SKU 商品素材

三个工作流继续复用统一 Skill Runtime，不创建第二套任务、积分、供应商或资产状态机。它们只进入无限画布 AI 对话面板和节点模式；根据已确认的产品边界，独立 `/simple-chat` 保持现有 16 项专用 Skills，不混入画布创作 Skills。

## 2. 基线与约束

- 权威基线为 GitHub `main@0622aa48c3d19007e94292166a888238de17df43`。
- 只修改 `main`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持只读。
- 第一批三项营销 Skills、统一 Skill Runtime、Task12 和 Stage4 已冻结，不重复实现。
- 不删除、改名或改变现有 24 项 Canvas/Workflow Skills 和 16 项 Simple Chat Skills 的行为。
- 只允许管理员配置的远程编排、图像和视觉模型；不引入本地 GPU 服务。
- 输出始终创建新的 AssetVersion，不覆盖来源版本。
- 每项先 RED 测试、最小实现、聚焦回归、全量回归，再进入 Coze 云端真实验收。

## 3. 方案选择

### 方案 A：三个独立 Skill，共用统一运行内核（采用）

每个场景拥有独立输入合同和步骤，但共同使用现有目录、授权、模型冻结、报价、任务、取消退款、AssetVersion、恢复和质量门禁。批量 SKU 只补充一个通用的持久数据集扇出能力。

优点是职责清晰、可独立报价和回滚、失败影响范围小；代价是需要为动态数据行增加通用运行时合同。

### 方案 B：一个“内容批量工厂”综合 Skill（不采用）

入口较少，但输入复杂、平台规则互相污染，单项失败与积分解释困难。

### 方案 C：扩展第一批“全渠道活动素材包”（不采用）

改动较小，但会改变已冻结 Skill 的版本与报价合同，也不能自然表达每个 SKU 的独立状态。

## 4. Skill 定义

### 4.1 YouTube/B站缩略图

- ID：`preset-video-platform-thumbnails`
- 名称：`YouTube/B站缩略图`
- 分类：`marketing`
- 工作区：`canvas`、`workflow`
- 来源图片：1 至 6 张受管 AssetVersion

结构化输入：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `sourceImages` | images | 是 | 1–6，绑定来源版本 |
| `videoTitle` | text | 是 | 视频标题或核心主题 |
| `subject` | text | 是 | 主体与人物/产品身份 |
| `audience` | text | 是 | 目标观众 |
| `hook` | text | 是 | 点击动机，不得虚构事实 |
| `brandTone` | text | 否 | 默认“醒目、清晰、可信” |
| `headline` | text | 否 | 封面短文案；空值时由编排步骤提出 |
| `faceEmphasis` | boolean | 否 | 默认 `false` |
| `negativeConstraints` | text | 否 | 默认禁止水印、乱码和无关文字 |

固定步骤：

1. `thumbnail-plan`：编排模型生成平台差异、短标题与视觉层级方案。
2. `youtube-thumbnail`：图像模型生成 16:9 YouTube 版本。
3. `bilibili-thumbnail`：图像模型生成 16:9 B站版本。

后两步并行，每步只交付一个新 AssetVersion。提示词必须保留来源主体身份，同时区分 YouTube 的强对比远距离识别和 B站的中文信息层级；不得在前端承诺模型无法稳定绘制的精确文字，生成文字须由质量说明标记为“需人工校对”。

### 4.2 Pinterest 图钉

- ID：`preset-pinterest-pins`
- 名称：`Pinterest 图钉`
- 分类：`marketing`
- 工作区：`canvas`、`workflow`

结构化输入：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `sourceImages` | images | 是 | 1–6，绑定来源版本 |
| `topic` | text | 是 | 内容主题 |
| `audience` | text | 是 | 目标受众 |
| `goal` | select | 是 | 收藏、访问、购买、品牌认知 |
| `style` | text | 否 | 默认“编辑感、可收藏、层级清晰” |
| `callToAction` | text | 否 | 默认不生成虚假优惠或稀缺信息 |
| `seriesCount` | select | 是 | 2、3，默认 3 |
| `negativeConstraints` | text | 否 | 默认禁止水印、乱码和无关文字 |

固定步骤：

1. `pin-plan`：生成内容支柱、视觉连续性和行动路径。
2. `pin-hero`：2:3 主图钉。
3. `pin-detail`：2:3 细节/步骤型图钉。
4. `pin-conversion`：2:3 转化型图钉；当 `seriesCount=2` 时由通用条件合同跳过，而不是创建后取消任务。

该 Skill 引入通用、声明式步骤条件：`when: { input: 'seriesCount', includes: ['3'] }`。条件在创建 Run 时编译进不可变快照；被跳过步骤写入 `skipped` 事件，不估价、不创建供应商任务、不扣费。

### 4.3 CSV/JSON 批量 SKU 商品素材

- ID：`preset-batch-sku-assets`
- 名称：`批量 SKU 商品素材`
- 分类：`commerce`
- 工作区：`canvas`、`workflow`
- 单次最大 20 行，默认并发 3，避免供应商和积分突发。

结构化输入：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `sourceImages` | images | 是 | 1–6，绑定来源版本 |
| `rows` | dataset | 是 | 1–20 行，SKU 唯一 |
| `platform` | select | 是 | 通用电商、淘宝/天猫、京东、Amazon |
| `assetType` | select | 是 | 主图、卖点图、场景图 |
| `aspectRatio` | select | 是 | 1:1、4:5、3:4，默认 1:1 |
| `brandTone` | text | 否 | 默认沿用来源图片和品牌信息 |
| `negativeConstraints` | text | 否 | 默认禁止虚构参数、优惠、认证、销量和评价 |

每行允许的字段：

- `sku`：必填，1–64 字符，批次内唯一。
- `name`：必填，1–200 字符。
- `sellingPoints`：可选，最多 1,000 字符。
- `variant`：可选，规格、颜色或容量，最多 200 字符。
- `headline`：可选，最多 120 字符。
CSV 首行必须使用上述字段名。整批共享本次已授权的 1–6 张来源图片，不允许在 CSV 行中重新声明来源版本。未知列、重复 SKU、空行、公式开头值、超过 20 行、保留对象键和超长字段在报价前拒绝。

固定与动态步骤：

1. `sku-plan`：编排模型检查数据完整性并输出批次规则，不补造商品事实。
2. `sku-creative`：按 `rows` 通用扇出，每行形成一个持久子步骤，ID 为 `sku-creative:<rowDigest>`。

运行时新增通用 `fanOut` 合同：

```ts
interface SkillStepFanOut {
  inputKey: string;
  itemAlias: string;
  keyField: string;
  maximumItems: number;
  concurrency: number;
}
```

该合同不是 SKU ID 特判。Run 创建时将已校验数据集按原顺序编译成不可变子步骤快照，报价按真实行数计算。每行拥有独立 operation、幂等摘要、任务状态、AssetVersion 和失败原因；重试只重跑失败行，取消只结算尚未完成行，完成行不重复扣费。

## 5. CSV/JSON 输入交互

现有 `dataset` 文本域继续兼容 JSON 数组，并增加同一控件内的 `.csv`/`.json` 文件导入，不增加新的业务弹窗。

- 浏览器只读取用户显式选择的文件，不上传原始文件。
- CSV 使用直接依赖 `papaparse` 与 `@types/papaparse`；不使用正则或 `split(',')`。
- 导入后显示前 5 行表格预览、总行数和字段错误。
- 前端解析只用于即时反馈，服务端仍重新校验规范化 JSON，前端结果不是信任边界。
- 文件最大 512 KiB；JSON 与 CSV 最终都转为同一 `Record<string, unknown>[]`。

## 6. 数据流与状态

1. Canvas 或 Workflow 从动态目录加载 Skill 定义。
2. 客户端提交结构化输入和受管来源版本 ID。
3. 服务端完成输入、来源权限、模型能力和数据集验证。
4. 报价器根据条件步骤和扇出行数计算真实最大费用，冻结 providerId + modelId。
5. Run 快照持久化后才预扣积分并开始步骤。
6. 静态并行步骤和数据集扇出步骤复用现有持久 operation、Agent 适配器和 AssetVersion 投影。
7. 事件流逐步返回单项成功或失败，前端不等待整批结束才显示结果。
8. 刷新后从持久事件恢复相同顺序、状态、成品和错误。

合法终态保持现有定义。`skipped` 仅用于创建 Run 时由已冻结输入计算出的条件跳过，不允许把运行失败改写成跳过。

## 7. 计费、取消与重试

- 编排步骤和实际图像子步骤逐项计价，报价必须等于真实可执行步骤总和。
- 同一用户、Skill、版本、输入摘要和幂等键只创建一个 Run。
- SKU 行使用父 Run ID、步骤 ID、行摘要共同构成 operation 唯一身份。
- 成功一项即持久结算一项；批次部分失败不回滚已交付成品。
- 失败或取消只退款未成功结算的预扣金额，退款状态通过数据库条件终态转换保证一次性。
- 单项重试复用原 operation 身份并增加 attempt，不重复扣除已完成项。
- 迟到完成不得覆盖 failed/cancelled/timeout 终态。

## 8. 质量门禁

三个 Skills 均执行：

- `output-present`
- `expected-count`
- 来源版本可追踪
- 输出为新的 AssetVersion

第二批新增通用元数据门禁：

- `image-dimensions-known`：资产必须记录可读宽高。
- `aspect-ratio-match`：允许 1% 像素取整误差。

SKU 批次额外验证每个完成行恰好产生一个结果；平台文案和图中文字只做风险提示，不以 OCR 结果自动判定业务成功，避免模型文字能力不稳定造成错误退款。

## 9. 兼容与保护

- `LOVART_MARKETING_SKILLS` 保留既有三项定义摘要；第二批放入独立 `content-commerce-presets.ts`。
- 目录按“旧 21 + 第一批 3 + 第二批 3”组成 Canvas/Workflow 27 项；Simple Chat 保持 16 项。
- 条件步骤和扇出能力进入通用类型、输入解析、报价、执行和恢复路径，禁止按新 Skill ID 在执行器中分支。
- 不添加底部工具栏入口；沿用 Canvas AI 对话中的 Skills 和 Workflow `ai-skill` 节点。
- 不修改管理员已有模型配置，不自动切换供应商。

## 10. 测试与验收

### 10.1 定义与输入

- 三项 ID、字段、默认值、步骤、比例和最大数量准确。
- 旧 24 项定义摘要不变，Canvas/Workflow 为 27，Simple Chat 为 16。
- CSV/JSON 同值生成同一规范化数据和摘要。
- 非法 CSV、未知列、重复 SKU、公式值、超长字段、超过 20 行和越权来源在报价前拒绝。

### 10.2 执行与账务

- YouTube/B站产生两个独立结果。
- Pinterest 计数 2 时不创建第三任务，计数 3 时产生三个结果。
- SKU 每行一个持久 operation；结果逐项进入画布/节点。
- 并发重复提交只产生一个 Run 和一组子任务。
- 部分失败只重试失败行；取消一次退款；迟到结果不覆盖终态。
- 刷新恢复保持顺序、进度、错误和已完成结果。

### 10.3 门禁

- 聚焦单元、API、组件、隔离 PostgreSQL 并发和 Chromium E2E 通过。
- TypeScript、ESLint、保护基线、全仓测试和生产构建退出 0。
- `stable` SHA 不变。

### 10.4 云端真实验收

Coze 精确部署候选后，在现有浏览器标签中：

1. Canvas 运行 YouTube/B站缩略图，验证两个成品、精确模型、积分和刷新恢复。
2. Workflow 运行 Pinterest 三图钉，验证三节点结果和继续连线。
3. Canvas 导入至少 3 行 CSV，其中制造一个受控可恢复失败，验证逐项回图和只重试失败行。
4. 取消一个批量 SKU Run，验证只退款未完成项且迟到终态被拒绝。
5. 验证 Simple Chat 仍为 16 Skills。
6. 保存截图、Console、Network、事件、AssetVersion 和积分流水证据。

无法安全制造的生产故障必须进入 `UNVERIFIED_ITEMS.md`，不得以本地夹具冒充云端通过。

## 11. 非目标

- Amazon 合规检查、Brief 到视频、多平台批量尺寸和命名导出属于第三批，不在本批实现。
- 不引入本地 GPU、OCR 训练、版式编辑器或第二套 CSV 数据库。
- 不改变第一批 Skills 的定义、报价和云端验收结论。
