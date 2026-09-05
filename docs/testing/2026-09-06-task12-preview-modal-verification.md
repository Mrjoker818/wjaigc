# Task12 节点大图预览修复验证

日期：2026-09-06，Asia/Shanghai。业务基线：main `3d72f464c3572b444e75602f619b0f8f24cc2534`；本报告验证其工作树中的TEST-SKILL-011最小修复，不证明整个Task12完成。

## 修复边界

仅为 `src/components/node-editor.tsx` 图片预览弹窗添加确定的80vw/80vh容器及100%/contain图片尺寸。保留原有关闭方式、图片来源、节点数据及执行链路；没有改登录、模型、积分、退款和资产持久化。

## 真实云端发现

既有Google Chrome预览中，节点Skill切片蛋糕图片可见，点击后遮罩出现但大图未正常展示。云端源码tree为5507aff6。后续像素测量时Chrome再次Debugger unattached，不能补造云端测量结果。此前画布下载的整只蛋糕是另一资源，不能当作该Skill节点的下载验收。

## 本地门禁

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| TDD | 新测试先失败（1失败/32通过），修复后33/33通过 | 本对话命令回执；node-editor-skill-node.test.tsx |
| 全仓Vitest | 673文件，5304通过、0失败、12跳过 | output/preview-modal-full-20260906.json |
| PostgreSQL补验 | 原跳过12项全部通过，0跳过 | output/preview-modal-postgres-supplement-20260906.json |
| 类型检查 | 退出0，含新增浏览器用例的最终类型复核 | output/preview-modal-final-typecheck-20260906.log |
| ESLint构建门禁 | 退出0 | output/preview-modal-lint-20260906.log |
| 保护基线 | 38项通过，无未批准漂移 | 本对话check:protected-baseline回执 |
| 生产构建 | 退出0，119/119页面，编译16.1分钟 | output/preview-modal-build-20260906.log |
| BuildID | uMTJ7VMeTVPmlRpihy8qe | .next/BUILD_ID |
| 本地Chrome真实布局 | 2/2通过，横/竖图共六组视口验证 | output/preview-layout-e2e-20260906-attempt5.log |

全仓JSON SHA256：`BFE508601B59BD3362C076EB46068C6BF0B6ECCD28394779EC85F00AB06A531E`。不得把全仓原报告写为“零跳过”；正确表述为5304项通过加12项独立真库补验。

## 浏览器验证边界

在独立本地生产服务 `http://127.0.0.1:5018` 和测试库上，通过真实Google Chrome打开节点图片预览。测试图片明确为纯色布局夹具，不调用真实供应商、不扣云端积分。

覆盖1280x800、375x812、320x640视口，分别使用1200x600横图和600x1200竖图；断言图片解码、弹窗边界、实际显示尺寸、截图中的非空像素区域与原始纵横比，以及关闭行为。它不等于完整移动端验收。

- 固化HTML报告：`output/preview-modal-playwright-20260906/index.html`，内含六张截图和视频附件。
- 长期证据根：`test-results/stage-4-baseline/evidence/3d72f464c3572b444e75602f619b0f8f24cc2534-worktree-7836c46a4955/preview0906e/chromium/`。
- 每条用例的retry-0/repeat-0下包含source-state.json、final.png、trace.zip、video.webm、console.json、network.json。
- 两条用例通过现有Console/Network证据门禁；原始日志与Trace只本地保存，不提交用户会话资料。

保留的前置失败：Windows PowerShell编码/原生命令警告处理、占位资产夹具导致项目准备500、图片悬浮预览层拦截错误定位器、属性缩略图与弹窗同名导致严格定位失败。修正的都是本地启动器或测试夹具/定位器；没有删除失败记录、强制点击或修改业务接口来使测试通过。各次日志保留在output，浏览器失败证据保留在各次runId目录。

本地临时5018服务和55492 PostgreSQL均已停止，测试数据未删除。独立只读审查未发现阻断性回归；其浏览器可见性缺口已由上述布局测试补验。组件测试对禁止提交URL的断言仍较窄，不能用于全账务安全结论。

## 未完成

### 01:52 后云端增量

在正确Google Chrome用户1的既有Coze项目页实际读取6407ec0c同步最终回执：合并HEAD为54b2396d0f750b962048c1193c99dc860d6a953b，tree为087af0599666f56ba9a88b018ea9ef4d127dd0e8，与目标一致；工作区及目标diff为空。Coze报告TS_EXIT=0、38项保护通过、BUILD_EXIT=0、119/119页面，BuildID=NypF6FFogarLXdxjioHsG，唯一5000 PID=3210、启动01:21:04，GET首页200。日志路径/tmp/6407ec0c-build.log与/tmp/6407ec0c-build-exit.txt。此为浏览器读到的Coze回执，非独立下载全部原始日志。

现有预览页Mr.joker管理员已登录；发出Ctrl+Shift+R后打开原4图项目project_1787549625844_nfmso3ts9，进入原3节点工作流，点击已完成Skill节点。真实截图显示完整草莓切片蛋糕大图，居中且未拉伸，原节点缩略图仍在遮罩下可见。截图与AX原始回执在本对话工具记录中，未生成新任务或扣费。本次不独立证明快捷键确实绕过所有缓存，但云端新弹窗行为与修复吻合。

TEST-SKILL-011的大图可见性取得云端正向证据。随后读取DOM原图URL、naturalWidth和显示矩形时Debugger unattached，因此准确尺寸、同资产下载、关闭交互及完整网络/Trace仍未补齐，不把截图当成这些项通过，也不将整个Task12关闭。不重复发送6407ec0c同步或重复构建。

TEST-SKILL-011后续仅补上述尚缺证据，不重复部署及首次打开。Chrome长期脱附原因未解决。Task12的新任务租约结算、媒体元数据、暂停恢复、失败重试、准确资产下载与账务等未验证项不因本次布局回归而关闭。

结论：本地最小修复门禁通过，可推送main供测试沙箱同步；全平台发布结论仍为不通过。
