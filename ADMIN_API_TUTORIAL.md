# 无界AI — 管理员添加 API 中转站模型教程

## 一、4SAPI 中转站（https://4sapi.com）

### 支持的模型类型

| 类型 | 模型 ID | 显示名称 | 协议 |
|------|---------|----------|------|
| **图像生成** | `gemini-3.1-flash-image-preview` | Nano Banana 2 | Gemini 图像 (chat/completions) |
| **图像生成** | `gemini-3-pro-image-preview` | Nano Banana 2 Pro | Gemini 图像 (chat/completions) |
| **图像生成** | `gemini-2.5-flash-image-preview` | Nano Banana | Gemini 图像 (chat/completions) |
| **图像生成** | `gpt-image-2` | GPT Image 2 | 标准 OpenAI (images/generations) |
| **图像生成** | `gpt-image-2-c` | GPT Image 2 Chat | 标准 OpenAI (images/generations) |
| **图像生成** | `gpt-image-1.5` | GPT Image 1.5 | 标准 OpenAI (images/generations) |
| **LLM 聊天** | `gpt-5.5` | GPT-5.5 | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gpt-5.4` | GPT-5.4 | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gpt-5.1` | GPT-5.1 | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gpt-5` | GPT-5 | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gpt-5-mini` | GPT-5 Mini | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gpt-5-nano` | GPT-5 Nano | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gpt-4.1` | GPT-4.1 | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gpt-4.1-mini` | GPT-4.1 mini | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gpt-4o` | GPT-4o | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `deepseek-v4-pro` | DeepSeek V4 Pro | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `deepseek-r1` | DeepSeek R1 | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gemini-2.5-flash` | Gemini 2.5 Flash | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gemini-2.5-pro` | Gemini 2.5 Pro | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `claude-sonnet-4-6` | Claude 4.6 Sonnet | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `grok-4` | Grok 4 | 标准 OpenAI (chat/completions) |

### 4SAPI 特殊说明

1. **Gemini 图像模型**：4SAPI 的 Gemini 图像模型不支持标准 `/images/generations` 端点，系统会自动识别并切换到 `/chat/completions` 路径（Gemini 图像协议），无需手动配置。
2. **GPT Image 2**：支持标准 `/images/generations`，但**不支持** `/images/edits` 的 JSON 模式。系统已自动适配，通过 `/images/generations` + `image` + `mask` 字段实现蒙版修图。
3. **模型可用性**：部分模型可能在当前 Token 分组下不可用（返回 503 或 "No available channel"），这取决于 4SAPI 后台渠道配置。

### 4SAPI 添加步骤

1. 管理员登录 → 点击左侧"管理员"按钮
2. 在 API 管理面板点击"添加 API"
3. 填写：
   - **名称**：`4SAPI 图像`（图像模型）或 `4SAPI LLM`（聊天模型）
   - **Base URL**：`https://4sapi.com/v1`
   - **API Key**：你的 4SAPI API Key
   - **API 类型**：`图像模型` 或 `LLM 模型`
4. 点击"识别模型"按钮，系统自动获取可用模型列表
5. 勾选需要启用的模型，点击保存
6. （可选）对于 Gemini 图像模型，如系统未自动识别协议，可在提供商高级设置中手动选择协议为"Gemini 图像 (chat/completions)"

---

## 二、PearAPI 中转站（https://api.pearapi.ai）

### 支持的模型类型

| 类型 | 模型 ID | 显示名称 | 协议 |
|------|---------|----------|------|
| **图像生成** | `nano-banana` | Nano Banana | 标准 OpenAI (images/generations) |
| **图像生成** | `nano-banana-2` | Nano Banana 2 | 标准 OpenAI (images/generations) |
| **图像生成** | `nano-banana-2-4k` | Nano Banana 2 4K | 标准 OpenAI (images/generations) |
| **图像生成** | `nano-banana-pro` | Nano Banana Pro | 标准 OpenAI (images/generations) |
| **图像生成** | `nano-banana-pro-4k` | Nano Banana Pro 4K | 标准 OpenAI (images/generations) |
| **图像生成** | `gpt-image-2` | GPT Image 2 | 标准 OpenAI (images/generations) |
| **图像生成** | `gpt-image-2-2k` | GPT Image 2 2K | 标准 OpenAI (images/generations) |
| **图像生成** | `gpt-image-2-4k` | GPT Image 2 4K | 标准 OpenAI (images/generations) |
| **图像生成** | `jimeng-5.0` | 即梦 5.0 | 标准 OpenAI (images/generations) |
| **LLM 聊天** | `gpt-5.5` | GPT-5.5 | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gpt-5.4` | GPT-5.4 | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gpt-5-nano` | GPT-5 Nano | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `deepseek-v4-pro` | DeepSeek V4 Pro | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `gemini-2.5-flash-preview-05-20` | Gemini 2.5 Flash | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `claude-sonnet-4-6` | Claude 4.6 Sonnet | 标准 OpenAI (chat/completions) |
| **LLM 聊天** | `kimi-k2.5` | Kimi K2 | 标准 OpenAI (chat/completions) |

### PearAPI 特殊说明

1. **Nano Banana 系列**：这是 PearAPI 对 Google Gemini 图像模型的适配名称。PearAPI 已在其后端将 Gemini 模型适配为 OpenAI 兼容格式，因此无需使用 Gemini 图像专用协议，直接走标准 `/images/generations` 即可。
2. **模型命名对应关系**：
   - `nano-banana` = Gemini 2.5 Flash Image
   - `nano-banana-2` = Gemini 3.1 Flash Image
   - `nano-banana-pro` = Gemini 2.5 Pro Image
   - `nano-banana-2-4k` = Gemini 3.1 Flash Image 4K 版
   - `nano-banana-pro-4k` = Gemini 2.5 Pro Image 4K 版
3. **4K 模型**：4K 模型生成的图片分辨率更大（最大 4096px），base64 数据约 10-20MB，生成时间较长（30秒~2分钟），请耐心等待。
4. **图片比例和质量**：系统会根据所选 Nano Banana 模型自动调整可用的图片比例和质量档位：
   - 标准版：支持 1K (1024px) 质量
   - 2K 版：支持 1K / 2K 质量
   - 4K 版：支持 1K / 2K / 4K 质量
5. **response_format**：PearAPI 的 Nano Banana 模型需要 `response_format: b64_json` 参数，系统已自动附加。

### PearAPI 添加步骤

1. 管理员登录 → 点击左侧"管理员"按钮
2. 在 API 管理面板点击"添加 API"
3. 填写：
   - **名称**：`PearAPI 图像`（图像模型）或 `PearAPI LLM`（聊天模型）
   - **Base URL**：`https://api.pearapi.ai/v1`
   - **API Key**：你的 PearAPI API Key
   - **API 类型**：`图像模型` 或 `LLM 模型`
4. 点击"识别模型"按钮，系统自动获取可用模型列表
5. 勾选需要启用的模型，点击保存
6. PearAPI 的所有模型均使用标准 OpenAI 协议，无需手动配置协议类型

---

## 三、两个平台对比

| 特性 | 4SAPI | PearAPI |
|------|-------|---------|
| **Base URL** | `https://4sapi.com/v1` | `https://api.pearapi.ai/v1` |
| **Gemini 图像** | 需要 Gemini 图像专用协议 | 已适配，标准 OpenAI 协议 |
| **GPT Image 2** | 标准协议 | 标准协议 |
| **4K 图像** | 不支持 | 支持 (nano-banana-*-4k) |
| **ChatGPT LLM** | GPT-5.5/5.4/5.1/5/4.1/4o | GPT-5.5/5.4/5-nano |
| **其他 LLM** | DeepSeek/Gemini/Claude/Grok | DeepSeek/Gemini/Claude/Kimi |
| **模型总数** | ~198 | ~30 |
| **自动协议识别** | 支持 | 支持 |

---

## 四、常见问题

### Q: 添加后图像生成失败怎么办？
A: 检查以下几点：
1. API Key 是否正确且余额充足
2. 模型是否在当前 Token 分组下可用（部分模型可能需要更高权限分组）
3. 4SAPI 的 Gemini 图像模型是否自动切换到了"Gemini 图像"协议（管理员面板可查看）

### Q: Nano Banana 4K 生成超时？
A: 4K 图片 base64 数据约 10-20MB，生成时间通常 30秒~2分钟。如果超时，可改用 2K 或标准版本。

### Q: 4SAPI 的 GPT Image 2 蒙版修图为什么不能用？
A: 4SAPI 的 `/images/edits` 端点要求 `multipart/form-data` 格式，系统已自动适配为通过 `/images/generations` + `image` + `mask` 字段实现，功能等价。

### Q: 如何手动设置协议？
A: 在管理员面板 → 点击提供商 → 高级设置 → `compatProfile` 字段可手动选择：
- `auto`：自动识别（推荐）
- `openai`：标准 OpenAI 协议
- `gemini-image`：Gemini 图像专用协议（chat/completions 生图）
- `apimart`：APImart 格式
- `openai-async`：OpenAI 异步轮询格式
