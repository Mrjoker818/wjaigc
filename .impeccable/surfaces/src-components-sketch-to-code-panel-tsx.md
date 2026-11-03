---
version: 1
slug: "src-components-sketch-to-code-panel-tsx"
primary_target: "src/components/sketch-to-code-panel.tsx"
related_targets: ["src/lib/sketch-to-code/image-client.ts","src/lib/sketch-to-code/image-placement-client.ts"]
---

# Task9：现有草图抽屉的双模式接线

本轮真人已确认双模式和自主最优实施。不是新目标或设计重做。Task8 原账务、权限、资产和结果读取门仍保留；UI 候选不代表最终默认入口或真实验收完成。

## Direction contract

访客模式 Operate，现有界面本地扩展、代码驱动，不创建新视觉世界或生成设计图片。

THESIS：用户画草图并输入关键词，清楚选择生图或代码；模式切换不产生费用、不丢输入、不偷偷取消任务。

OWN-WORLD：继承现有专业深色/单色抽屉、系统字型、金色主操作与已有绘图控件，不改全局 PRODUCT.md、DESIGN.md 或既有主题。

STORY：原始笔迹始终可撤销和下载；图像模式明确视觉 LLM 与图像模型，代码模式保持自己的单视觉绑定及安全 HTML。

FIRST VIEWPORT：顶部双模式按钮，左侧原绘图区，右侧关键词及模型选择，主操作在选择之后；窄屏上下排列、不横溢，结果区显示各自状态和费用。

FORM：现有抽屉局部扩展，seed 不适用；签名交互是切换模式仍保留同一绘图与两份任务状态，没有装饰动画。

FINISH：unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 最小写集与接口

并行客户端段只写新增 image-client.ts、image-placement-client.ts 及直接新测试；复用原 SketchScope/SketchInsert/SketchTransform、Task7 图像合同/报价合同，不修改旧 client/placement/HTML安全设施。导出 SketchImageTask（双 provider/model、原 task/project、状态/phase、progress、reserve/pricing、completed 四 refs/managed URLs/analysis/actualCredits、reconcile/dispatch/refund 标记）、SketchImageClient(scope,fetcher?,timeoutMs?)，start(input,reconcile=false)、poll(taskId)、cancel(taskId)、image(taskId)=>Promise<Blob>、stop()，公开 input/task/admissionUnknown/scope。仅 fresh 原 nonce 可 start；未知 admission 原 nonce 重放核对，不改变 payload，不重复付费；已知任务仅 poll。取消未知不改 cancelled，409 原 poll 恢复；关闭/切项目/权限失效停止读并拒绝迟到，不假装取消服务端。原 completed admission bare receipt 应按待核对处理，只有 protected poll 的全部关联结果可用；双绑定和价格必须精确，合法净费超过预留或部分返差不能拒绝；禁止原 PNG/remote/private 作为结果。

createSketchImagePanelSession(scope) 返回 client、instruction、visionSelection、imageSelection、aspectRatio（默认4:3）、可选 size/quality、可选 placement；不另建绘图状态。SketchImagePlacement(task,scope,insert,fetcher?,transform?) 只沿原受权 managed asset 查询/原 transfer 幂等/同项目回读放置新增生成图，保留原输入资产和笔迹，不覆盖或跨项目。个人 legacy 放置保留当前门；延期的 document 协作不启用。实际受权 task result 先复核，再只放置原 imageAssetVersionId，独立 entity/nonce 可重放；unknown transfer 不换 nonce，也不重复插入。下载 fresh protected poll 后受限读取实际 managed bytes，32MiB、PNG/JPEG/WebP，scope/截止/晚到控制保留；远端 managed URL 不发 actor header 或本地 credential。

并行 UI 段只改 sketch-to-code-panel.tsx、新 sketch-dual-mode-panel.test.tsx 与原 panel 测试必要测试夹具模式声明（不改旧断言）。新增可选 imageSession prop；只有主控已接通并传入受审 imageSession 时初始 image，否则旧 code 回归保持。复用旧 session.history 全部笔迹，分别保留两模式说明、选择、task/result/reconcile/cancel状态。明确两菜单来自 Task7 sketchImageModels，不默选、不同 provider 同名不串。图像完成可以受权预览/按真实格式下载和 SketchImagePlacement.add；代码继续原安全 iframe 空 sandbox 和受权 HTML 下载。两client在真正关闭/失权时 stop；模式切换仅暂停当前读取，不执行cancel/start，不用一个模式的 task 清除另一个。

主控负责画布 session/insert 接线、workflow 新节点与旧节点区分、最终 detector/Edge 两轮以内视觉审查、集中回归/Git/Coze；其他执行者不改这些写集或任何台账。各段 callable RED→GREEN、新相关测试与原受影响测试、精确 lint/type、独立限定 review；不复跑旧已闭全矩阵，不调用业务 DB/外部模型/付费/安装/Coze/Git/浏览器。

现有 Impeccable context 已由主控运行一次；PRODUCT.md 旧 Register 忽略、旧 schema 只记录不修理。该技能限制为继承本抽屉，不允许审美重做或额外确认轮。主控已读 SKILL/new-work/operate/craft-floor，执行者如涉及 UI 自行按 skill 完整读所需文件，不为主控代读，也不重复 context。
