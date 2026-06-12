# Logo Generator Skill

为任何品牌或业务生成专业的 Logo 创意方向和提示词。

## 快速开始

1. 提供品牌名称和描述被品牌化内容的简报
2. 可选指定 Logo 类型、目标受众、偏好风格和目标平台
3. 获得完整的创意包：方向、符号概念、视觉系统说明和平台专用提示词
4. 可选择直接生成 Logo 图像

## 功能特点

- **多类型支持**：公司、品牌、产品、文创、活动、广告、App、子品牌 Logo
- **平台就绪提示词**：Universal、GPT Image、Midjourney、Flux、Ideogram 变体
- **直接图像生成**：按请求渲染精美的品牌系统展示板 Logo
- **参考感知**：从参考中提取设计系统而不复制
- **迭代优化**：通过 `revision_notes` 修订，保留有用方向
- **专业输出格式**：brand-system-board、identity-board、standalone-logo、square-avatar、transparent-asset

## 输入参数

| 字段 | 必填 | 说明 |
|------|------|------|
| `brand_name` | 是 | 品牌/公司/产品名称 |
| `brief` | 是 | 品牌化内容及其上下文描述 |
| `logo_type` | 否 | Logo 类型（省略时自动推断） |
| `audience` | 否 | 目标受众 |
| `preferred_style` | 否 | 视觉风格偏好 |
| `reference_style` | 否 | 视觉参考描述 |
| `output_layout` | 否 | 渲染布局格式（默认：brand-system-board） |
| `target_platform` | 否 | 强调哪个平台的提示词 |
| `render_image` | 否 | 是否直接生成图像 |
| `revision_notes` | 否 | 迭代反馈 |
| `output_language` | 否 | 响应语言（zh-CN 或 en） |

## 输出

- **Logo 方向**：定位、氛围、配色、字体、构图
- **符号概念**：核心隐喻、图标形式、负空间、替代路线
- **视觉系统说明**：组合方式、单色行为、小尺寸行为、使用说明
- **品牌系统展示板布局**：编号模块网格布局规范
- **最终提示词**：平台专用提示词变体
- **生成 Logo**：当 `render_image` 为 true 且图像工具可用时

## 许可证

MIT
