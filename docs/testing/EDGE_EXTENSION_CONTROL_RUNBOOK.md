# Edge 扩展控制运行手册

## 已确认环境

- Edge 配置：`Default`。
- ChatGPT 扩展 ID：`odlomjlbamekndcpllcnffbgeohgkmjh`。
- 扩展版本：`1.26.901.11451`。
- 扩展只有一份，未发现禁用原因；Manifest 包含 `debugger`、`tabs`、`webNavigation` 等权限。
- Manifest 声明的扩展动作快捷键：`Ctrl+Shift+Period`。

## `Debugger unattached` 的判定

标签页仍能被枚举、标题和 URL 仍存在，只能证明扩展后台与浏览器实例在线，不能证明该标签已附着。只有 `getTab` 成功返回页面 AX/DOM 才能视为可控。

本项目实测表明连接按标签页绑定。不要把已经附着的 Coze 项目标签跨域导航成独立预览地址；跨域导航后可能保留标签 ID，但调试绑定丢失并返回 `Debugger unattached`。

## 固定操作方式

1. 保留两个独立标签：Coze 项目页和无界预览页，禁止互相跨域复用。
2. 在需要控制的目标标签前台触发 ChatGPT 扩展；可先尝试 `Ctrl+Shift+Period`，然后确认扩展显示已连接。
3. 分别附着项目页和预览页，不以其中一个标签已连接推断另一个也已连接。
4. 沙箱重启后只刷新原项目页；服务启动后在原预览标签忽略缓存刷新，不使用项目标签跳转到预览地址。
5. 每次动作前重新读取 AX/DOM。出现 `Debugger unattached` 时停止业务操作，不把控制故障登记为产品 Bug，也不重复同步、构建、生成或扣费。
6. 项目页已附着而独立预览未附着时，可以只读检查项目内嵌预览；涉及下载、跨域文件和完整网络证据时仍以独立预览标签为准。

## Task12 当前续接点

Coze 已运行节点下载候选 tree `0714a4fb60642d97480b79c4b8ddb401d378fffd`，Build ID `8azEpZi5iO7cDWIokIr9a`。下一次预览标签附着后，从既有三节点工作流的完成 Skill 成品开始：打开预览、点击“下载预览图片”、捕获下载完成事件并核验文件；禁止重新同步或重新构建该业务候选。
