# 无界AI UI/UX 诊断报告

## 一、诊断范围与方法

### 1.1 诊断范围
- 核心画布组件：`infinite-canvas.tsx` (~12,000行)
- 生成面板：`generation-panel.tsx`、`video-generation-panel.tsx`
- 聊天面板：`chat-panel.tsx` (~6,000行)
- 编辑器：`image-editor.tsx`、`agent-editor.tsx`、`node-editor.tsx`
- 品牌系统：`brand-kit-panel.tsx`、`brand-ecommerce/*`
- 工作流：`font-design-panel.tsx`、`display3d-panel.tsx`
- UI基础库：`components/ui/*.tsx` (shadcn/ui)

### 1.2 诊断维度
- **视觉一致性**：颜色、圆角、阴影、字体
- **布局规范**：间距、对齐、z-index层级
- **交互反馈**：hover、focus、loading、error状态
- **功能窗口定位**：居中、偏移、可拖拽
- **下拉菜单一致性**：样式、动画、位置

---

## 二、发现的问题清单

### P0级问题（严重影响用户体验）

#### P0-1：主题系统不统一（双主题混乱）
**位置**：全局70+组件
**问题**：存在两套主题系统（`gold`黑金主题 + `monochrome`单色主题），但各组件实现不一致：
- 部分组件使用 `isMonochrome` 条件切换（如`image-editor.tsx`）
- 部分组件直接使用硬编码色值 `#1a1a1a`、`#d4af37`（如`chat-panel.tsx`）
- 部分组件依赖 `globals.css` CSS变量（如`generation-panel.tsx`）
- shadcn/ui 组件使用 `--background`、`--foreground` 语义变量，但业务组件未对齐

**影响**：
- 切换主题时部分组件样式不变化
- 同一页面出现多种风格混杂，视觉割裂感强
- 维护困难，每新增组件需手动定义30+主题变量

**建议修复**：
1. 统一到 Tailwind v4 `@theme` + CSS变量系统
2. 定义两套完整主题变量：`gold-*`（黑金）和 `mono-*`（单色蓝）
3. 所有组件使用语义化变量，禁用硬编码色值

---

#### P0-2：z-index层级混乱（弹窗遮挡问题）
**位置**：全局50+处 `z-[数字]` 和 `absolute/fixed` 定位
**问题**：
- z-index取值无统一规范：`z-20`、`z-50`、`z-[60]`、`z-[100]`、`z-[200]`、`z-[201]`、`z-[211]` 混用
- 弹窗层级定义不一致：
  - Dialog组件：`z-[201]`
  - DropdownMenu：`z-50`
  - ContextMenu：`z-50`
  - Toast/通知：`z-[60]`
  - Dashboard侧边栏：`z-[200]`
- 下拉菜单可能被同级弹窗遮挡

**影响**：
- 用户打开多个弹窗时顺序混乱
- 下拉菜单有时不可见（被其他元素遮挡）
- 右键菜单在特定状态下无法触发

**建议修复**：
建立统一z-index层级规范：
```
z-10: 悬浮提示（tooltip）
z-20: 下拉菜单（dropdown）
z-30: 右键菜单（context-menu）
z-40: 普通弹窗（popover）
z-50: 模态框（modal/dialog）
z-60: 通知/Toast（toast）
z-100: 全屏遮罩（overlay）
z-200: 系统级组件（sidebar/admin-panel）
```

---

#### P0-3：功能窗口不居中且定位不一致
**位置**：`infinite-canvas.tsx`、`image-editor.tsx`、`agent-editor.tsx`、`node-editor.tsx`
**问题**：
- 编辑器窗口（语言修图/Agent编排/图生图）使用 `fixed` 定位但偏移不一致
- 语言修图面板：`top-[10%] left-[10%]`（偏移屏幕左上）
- Agent编辑器：未居中，偏右偏下
- 图生图浮动面板：跟随图片位置，可能超出屏幕
- NodeEditor侧边栏：`fixed right-0`，遮挡画布

**影响**：
- 编辑器位置不固定，用户需寻找窗口
- 小屏幕设备窗口可能超出可视区域
- 多窗口同时打开时位置重叠

**建议修复**：
1. 统一窗口居中定位：`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`
2. 侧边栏改为可拖拽抽屉（Drawer），允许用户调整位置
3. 小窗口（图生图）跟随图片但智能检测边界，超出时居中

---

### P1级问题（影响体验但可容忍）

#### P1-1：下拉菜单样式不一致
**位置**：`chat-panel.tsx`、`generation-panel.tsx`、`dashboard-view.tsx`、`brand-ecommerce/*.tsx`
**问题**：
- 不同下拉菜单使用不同样式：
  - Chat表情选择器：`bg-white/[0.03] backdrop-blur-xl`
  - 模型选择下拉：`bg-[#1a1a1a] border-white/10`
  - Dashboard下拉：`bg-[#1a1a2e]`（与`#1a1a1a`色值不同）
  - shadcn Select：使用 `bg-popover` 变量
- 圆角不一致：`rounded-lg`（8px）、`rounded-xl`（12px）、`rounded-md`（6px）混用
- 阴影不一致：`shadow-lg`、`shadow-xl`、`shadow-2xl` 混用

**影响**：
- 视觉风格不统一，用户感知混乱
- 品牌调性不一致

**建议修复**：
统一下拉菜单样式规范：
```css
/* 标准下拉菜单 */
.dropdown-menu {
  bg-[#1a1a1a] /* 或 bg-popover */
  border-white/[0.08]
  rounded-xl (12px)
  shadow-xl
}
```

---

#### P1-2：Loading状态展示不一致
**位置**：`infinite-canvas.tsx`、`generation-panel.tsx`、`video-generation-panel.tsx`
**问题**：
- Processing Frame：使用进度条+百分比（黑金风格）
- 生成面板：使用 `Loader2` 旋转图标
- 视频生成：使用 `Loader2` + 文字提示
- Agent编辑器：使用进度条+执行步骤
- 缺少统一Loading组件

**影响**：
- 用户无法快速识别当前状态
- 视觉风格不一致

**建议修复**：
创建统一Loading组件 `UnifiedLoading.tsx`：
- 模式1：进度条+百分比（用于长时间任务）
- 模式2：旋转图标+文字（用于短时等待）
- 模式3：骨架屏（用于数据加载）

---

#### P1-3：Hover/Focus状态不一致
**位置**：全局按钮、输入框、卡片
**问题**：
- 按钮 hover：有的使用 `hover:bg-[#2a2a2a]`，有的使用 `hover:opacity-80`
- Focus ring：有的使用 `focus:ring-2 focus:ring-[#d4af37]/30`，有的无focus状态
- 卡片hover：有的放大，有的改变背景色，有的无hover效果
- shadcn组件已定义focus状态，但业务组件未遵循

**影响**：
- 键盘导航用户无法识别焦点位置
- 无障碍体验不达标

**建议修复**：
定义统一hover/focus规范：
```css
/* 按钮 */
.btn:hover { bg-[#2a2a2a] }
.btn:focus-visible { ring-2 ring-[#d4af37]/30 }

/* 输入框 */
.input:focus { ring-2 ring-[#d4af37]/30 outline-none }

/* 卡片 */
.card:hover { shadow-lg transform-scale-102 }
```

---

#### P1-4：圆角规范混乱
**位置**：全局100+处 `rounded-*`
**问题**：
- 圆角值混乱：`rounded`（4px）、`rounded-md`（6px）、`rounded-lg`（8px）、`rounded-xl`（12px）、`rounded-2xl`（16px）、`rounded-full` 混用
- 同类型元素圆角不一致：
  - 按钮：有时 `rounded-lg`，有时 `rounded-xl`
  - 输入框：有时 `rounded-lg`，有时 `rounded-md`
  - 卡片：有时 `rounded-xl`，有时 `rounded-lg`

**影响**：
- 视觉细节不精致，显得随意

**建议修复**：
建立圆角规范：
```
rounded-xs (2px): 标签、徽章
rounded-sm (4px): 小按钮、芯片
rounded-md (6px): 输入框、小卡片
rounded-lg (8px): 按钮、列表项
rounded-xl (12px): 卡片、面板、下拉菜单
rounded-2xl (16px): 弹窗、侧边栏
rounded-full: 圆形按钮、头像
```

---

#### P1-5：间距规范不一致
**位置**：全局 `px-* py-* gap-*`
**问题**：
- padding值混乱：`px-1`、`px-1.5`、`px-2`、`px-2.5`、`px-3`、`px-4`、`px-6` 混用
- gap值混乱：`gap-0.5`、`gap-1`、`gap-1.5`、`gap-2`、`gap-3`、`gap-4` 混用
- 同类型组件间距不一致

**建议修复**：
建立间距规范（基于4px基数）：
```
xs: 4px (p-1, gap-1)
sm: 8px (p-2, gap-2)
md: 12px (p-3, gap-3)
lg: 16px (p-4, gap-4)
xl: 24px (p-6, gap-6)
2xl: 32px (p-8, gap-8)
```

---

### P2级问题（细节优化）

#### P2-1：工具栏图标大小不一致
**位置**：`infinite-canvas.tsx` 底部工具栏、顶部图片工具栏
**问题**：
- 底部工具栏图标：`w-4 h-4`（16px）
- 顶部图片工具栏图标：`w-5 h-5`（20px）
- 右键菜单图标：`w-4 h-4`

**建议修复**：统一图标尺寸 `w-4 h-4`

---

#### P2-2：文字大小层级混乱
**位置**：全局 `text-*`
**问题**：
- 使用了过多的文字大小：`text-[8px]`、`text-[9px]`、`text-[10px]`、`text-[11px]`、`text-xs`（12px）、`text-sm`（14px）、`text-base`（16px）
- 同类型元素文字大小不一致

**建议修复**：
建立文字层级：
```
text-xs (12px): 标签、时间戳
text-sm (14px): 按钮文字、列表项
text-base (16px): 正文、标题
text-lg (18px): 大标题
text-xl (20px): 面板标题
```

---

#### P2-3：动画/过渡效果不一致
**位置**：全局 `transition-*`、`animate-*`
**问题**：
- 过渡时长混乱：`duration-200`、`duration-300`、`duration-500` 混用
- 动画类型不一致：有的使用 `fade-in`，有的使用 `slide-in`，有的无动画
- shadcn组件已定义标准动画，但业务组件未遵循

**建议修复**：
统一动画规范：
- 过渡时长：`duration-200`（快速交互）、`duration-300`（面板切换）
- 动画类型：`fade-in-0`（淡入）、`slide-in-from-top-2`（下滑）

---

#### P2-4：空状态/错误状态缺失
**位置**：多个面板
**问题**：
- 空画布：无空状态提示
- 聊天历史空：无空状态设计
- 品牌资产空：无引导用户添加资产

**建议修复**：
设计统一空状态组件 `EmptyState.tsx`：
- 图标 + 文字 + 操作按钮
- 引导用户下一步操作

---

## 三、问题优先级排序

| 优先级 | 问题 | 影响范围 | 修复难度 |
|--------|------|----------|----------|
| P0-1 | 主题系统不统一 | 70+组件 | 高（需重构） |
| P0-2 | z-index层级混乱 | 50+处 | 中（需批量修改） |
| P0-3 | 功能窗口不居中 | 10+组件 | 低（统一定位） |
| P1-1 | 下拉菜单样式不一致 | 20+处 | 低 |
| P1-2 | Loading状态不一致 | 10+组件 | 中 |
| P1-3 | Hover/Focus不一致 | 全局 | 中 |
| P1-4 | 圆角规范混乱 | 100+处 | 低（批量替换） |
| P1-5 | 间距规范不一致 | 全局 | 中（需审计） |
| P2-1 | 图标大小不一致 | 工具栏 | 低 |
| P2-2 | 文字大小混乱 | 全局 | 低 |
| P2-3 | 动画效果不一致 | 全局 | 低 |
| P2-4 | 空状态缺失 | 多面板 | 中 |

---

## 四、修复建议汇总

### 4.1 立即修复（P0）
1. **统一主题系统**：
   - 创建 `src/styles/themes.ts` 定义两套完整主题变量
   - 所有组件使用 `useTheme()` Hook获取主题变量
   - 禁用硬编码色值 `#1a1a1a`、`#d4af37`

2. **统一z-index层级**：
   - 创建 `src/lib/z-index.ts` 定义层级常量
   - 所有组件引用常量而非直接写数字

3. **统一窗口定位**：
   - 编辑器窗口统一居中
   - 侧边栏改为可拖拽抽屉

### 4.2 短期修复（P1）
1. 创建统一组件：`UnifiedDropdown`、`UnifiedLoading`、`UnifiedEmptyState`
2. 批量替换圆角/间距为规范值
3. 添加focus状态审计脚本

### 4.3 长期维护
1. 建立UI规范文档（类似 DESIGN.md）
2. 代码提交前进行UI一致性检查
3. 定期UI审计

---

## 五、总结

无界AI目前存在的主要UI/UX问题集中在**视觉一致性**和**交互规范**两方面。核心问题是主题系统未统一，导致70+组件各自实现主题逻辑，出现风格混杂。其次是z-index和定位混乱，影响弹窗交互体验。

建议优先修复P0级问题（主题统一+z-index规范），再逐步统一P1级交互元素（下拉菜单、Loading、hover/focus状态），最后优化P2级细节（图标、文字、动画）。

预计修复工作量：
- P0修复：3-5天
- P1修复：5-7天
- P2修复：持续迭代