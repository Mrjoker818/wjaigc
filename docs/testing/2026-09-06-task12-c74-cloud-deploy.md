# Task12 c74 候选云端同步与运行证据

日期：2026-09-06，Asia/Shanghai。

## 范围

本轮只同步并启动节点成品下载候选，不重新执行已经通过的本地测试，不创建 Skill、不调用供应商、不扣费、不退款，不触碰 `stable`。

## Coze 同步前状态

- 项目：`7671964106919837702`
- 工作区：`/workspace/projects`
- 分支：`main`
- 原 HEAD：`f478b8af0049c8e9f625671047c3da42576adbf8`
- 原 tree：`ed6f0c4c4ac35520dab99b77b221281390757daf`
- 工作区干净，无活动 `next build` / `pnpm build` 进程。
- 5000 端口只有一个旧 `next-server`，PID `1974`。

## 精确同步

- 目标 GitHub 提交：`c74a6cf904eec34dcea758bbef428292c589a0b3`
- 目标 tree：`0714a4fb60642d97480b79c4b8ddb401d378fffd`
- 使用普通 `git fetch origin main` 和 `git merge --no-edit`，没有 `reset`、`clean` 或覆盖文件。
- Coze 合并 HEAD：`8a0ca32f2145c0241291b85eb18232100ede422c`
- 合并后 tree：`0714a4fb60642d97480b79c4b8ddb401d378fffd`，与目标精确一致。

## 云端门禁与启动

- `pnpm ts-check`：退出 0。
- `pnpm check:protected-baseline`：退出 0；该门禁通过后才进入构建。
- 唯一一次 `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`：退出 0，`119/119` 页面生成完成。
- Build ID：`8azEpZi5iO7cDWIokIr9a`。
- 第一次重启命令因沙箱没有可用的 `fuser` PID 输出而安全停止，旧 PID `1974` 未被终止，也没有产生第二个监听实例。
- 随后使用 `ss` 精确提取唯一 PID，停止旧 PID `1974`，启动新服务；新 5000 监听 PID `3128`。
- `http://127.0.0.1:5000/`：HTTP 200，`Content-Type: text/html; charset=utf-8`。

## 预览增量

- 复用现有 Edge 标签并忽略缓存刷新，没有创建浏览器标签。
- 管理员会话保持登录，五张画布图片恢复。
- 节点模式恢复 `3` 个节点，已有 `Skill 执行` 节点状态为“完成”，蛋糕成品图片仍存在。
- 成品 URL 与历史证据一致：`https://getapib.org/f/image/7887573024302815-6b0c2960-74b5-43ce-996f-f068c9dbd43d-image_6XKNMB10D2W5GFNF7P16EA3ZCV_0.png`。
- 在点击成品打开新下载弹窗前，Edge 扩展返回 `Debugger unattached`。因此本轮不能把按钮存在、下载开始、文件字节数或可解码性标记为通过。

## 判定

`COZE EXACT-TREE / CLOUD BUILD / SINGLE SERVICE PASS`。

Task12 仍未完成。剩余只包括：真实节点成品下载交付；新任务在租约未过期时暂停后立即恢复且不重复提交/扣费；历史取消任务的精确归属和唯一扣退关联；最终 Console、Network、Trace、截图和任务身份归档。

## 节点成品独立交付物校验

- 在 Edge 控制通道未附着期间，直接读取既有 Skill 节点所引用的同一远程成品 URL，没有重新提交 Skill 或调用供应商。
- HTTP 状态 `200`，`Content-Type: image/png`，文件大小 `2,097,743` 字节。
- SHA-256：`A4F21DBC161EE9C8C4141CB84549A22A7B87A47D5901F049C4F58D0816EF8586`。
- PNG 文件签名正确；Sharp 在 `100,000,000` 像素上限下完成全像素解码，结果为 `1254 x 1254`、sRGB、3 通道，解码缓冲区 `4,717,548` 字节。
- 该证据只证明节点引用的远程成品真实、可下载且可解码；不证明页面“下载预览图片”按钮已触发浏览器下载，也不替代下载完成事件与浏览器 Network/Trace 证据。
