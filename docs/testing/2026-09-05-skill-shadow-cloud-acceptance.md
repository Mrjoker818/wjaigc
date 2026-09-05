# Skill历史同步与尺寸修复云端验收

测试时间：2026-09-05 07:10（Asia/Shanghai）。

候选提交：`db3f9ca6283b905d920c9d57051b9825e438eae4`。
源码tree：`63d5cddc9fe4e60565f9a7ea338426f7ecca5fd2`。
环境：Google Chrome用户1，隔离Coze预览域名`62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.coze.site`。

## 执行证据

- Coze原同步消息已返回完成：报告tree精确匹配、diff为空、38项保护通过、类型通过、构建退出0、119页面、Build ID `YHN6AjZ3TopH1sETOTtNW`。此项属于Coze执行报告；本轮未独立重读构建日志或完整云端HEAD。
- 在现有Chrome预览标签执行两次忽略缓存刷新，使用已有Mr.joker登录会话进入原四图项目；未新增供应商任务。
- 首次GET projects（request `28392.244`）HTTP200、success=true、assetGraphMode=shadow，包含明确删除身份。
- 首次POST projects（request `28392.253`）HTTP200、success=true、projectRevision=7873；原先LEGACY_MIGRATION_INTEGRITY_CONFLICT未再出现。
- 第二次刷新GET projects（request `28392.425`）HTTP200、success=true、revision=7875，返回10个项目和9条删除身份；随后POST projects（request `28392.448`）HTTP200、success=true、revision=7876。
- 项目`project_1787549625844_nfmso3ts9`四张图片均保留。原始尺寸分别1024×1024、768×1152、1920×1088、1254×1254；蛋糕显示几何仍420×420。
- 项目`project_1786341961637_hxc3szbke`返回10张图片；已删除entity `canvas-skill:1c56c864-0b28-4e10-8b72-b15371c19adf:71b202ac-173e-41c9-92bb-6867e5d6e3a5`不存在于快照。
- Chrome截图实际显示四张图片内容。捕获的Console error/warn为空。

本地证据目录：`output/skill-shadow-cloud-20260905/`，包含`refresh-network-summary.json`、`four-images-restored.png`、`console.json`。网络记录只保留选定业务字段，无凭据与图片base64。

## 结论与范围

### 07:12 补充取证

Coze通过现有命令工具返回：云端HEAD `043a2fab74fe7047f26de72ba9ac3150dc760227`，tree仍精确为`63d5cddc9fe4e60565f9a7ea338426f7ecca5fd2`，git status与对目标提交diff均为空。当前Build ID `ijLPt_2B-8g4tUX5sWqhK`，5000唯一监听PID2129，启动时间2026-09-05 07:07:55。旧`/tmp/build.log`已清理，`/tmp/build-exit.txt`为空，因此旧构建退出码仅有历史Coze报告，原始日志仍未验证。当前Build ID替代上方历史构建标识，不把不同启动时点混为同一产物。

刷新后从画布AI聊天进入Skills，打开“美食摄影风格图”，选择既有run `164afb05-baf2-41ff-bd8c-204278291429`：最终显示“已完成”，步骤“需求规划”“成品交付”均为已完成，四张图片仍保留。点击后短暂出现“正在排队”和取消按钮，随后被真实完成状态替换；记录为历史加载状态的界面观察，未执行取消，尚未判断是否需要修正。新增证据`coze-readonly-build-verification.txt`与`history-restored.txt`。

本次shadow旧删除节点过滤、项目批量同步、历史图片尺寸补全及刷新持久化回归通过。浏览器连接阻塞已解除。

### 后续节点验收与连接变化

上述连接恢复仅描述当时状态。后续重连复核可列出正确 Chrome 用户1的项目页与预览页，但读取两个现有标签均返回 `Debugger unattached`。没有新建标签、进入360或重复发送构建指令。

连接中断前执行过一次节点 Skill：`exec-1788563625891-8hct7l`，最终因需要62积分而余额22积分失败。此项未证明真实供应商产图、单次扣费或退款。节点入口缺少执行前费用预估已通过本地代码交叉核对，登记为 `SKILL-NODE-ESTIMATE-20260905-01`。节点测试的截图和独立网络归档尚未补齐；前面的刷新与尺寸证据不用于替代节点测试证据。

这不等于统一Skill内核或全平台验收完成。本轮未重复付费产图、取消退款或下载；未执行新一轮删除后历史恢复操作；云端构建原始日志仍缺失。保留此前证据，不能将这些未执行项写成本轮通过。
