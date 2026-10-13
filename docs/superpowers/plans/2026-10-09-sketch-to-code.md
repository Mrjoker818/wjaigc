# 手绘草图转代码实施计划

## 2026-10-13 受控交付授权（覆盖下方历史 Git／Coze 边界）

用户已明确允许：完成交付检查后，仅提交本轮升级相关代码、测试和必要文档并同步 GitHub main，由 Coze 拉取；先在项目页核对来源与构建，再在新的独立 Edge 预览页真实验收。不动 stable，不提交无关用户文件、密钥或本地运行产物，不强制推送，不正式部署。该范围内无需再次确认。完整依据见[范围决策](../specs/2026-09-27-upgrade-goal-scope-decisions.md)顶部2026-10-13条目。

下方“Git写／Coze边界不变”属于当时检查点，已被上述限定授权覆盖；未授权的付费、业务数据库、实体设备及正式发布范围仍不扩大。既有本地证据及其 SHA-256 审计入口见[分层验证记录](../../testing/2026-10-09-sketch-to-code-acceptance.md)顶部“受控交付与本地证据索引”；这些本地链接不保证在 GitHub／Coze 可打开，不提交整套本机证据来补齐它们。已关闭的代码批次和原回归不重复执行；Stage7 延期未验收，Pear 取消、PSD 核心保留。

## 2026-10-12 当前执行状态（后续证据优先，旧检查框不重新派发）

三处最小业务修复与直接相关测试已完成代码限定复审，Critical/Important/Minor均为0；最终冻结源码的29文件隔离相关回归1040/1040、严格六路径检查、新构建完整类型检查及封口追踪审计均通过。三处修复包括合法Token补扣结果接收、丢ACK后已完成任务恢复、历史完成子任务之后的后续取消和重试停止保护。顺序及late/in-flight失效窗口均先真实RED再最小GREEN，不清失效标记绕过保护，受权恢复仍走原status。首轮4旧恢复测试失败和一次新增测试unknown展开类型检查失败均保留，不把重跑通过当作已查明其根因；类型补注只改一行静态声明，最终版本已独立重新验证。该结果仅为当前三处修补的本地代码/相关回归与构建门，不代表当前无过滤全仓CI、新真实DB/Edge/供应商/S3/真机/Coze同树或发布门关闭。旧及所有新封存证据保留；业务库/安装/付费/Coze/Git写/部署/F:同步边界不变。目标保持active，第七项继续延期，Pear取消而PSD核心保留。

[本次三处最小修复的最终限定验收证明](../../../.superpowers/sdd/2026-10-09-sketch-to-code/task6-three-seams-retry-cache-loss-final-verification-20261012.json)（最终BUILD_ID `unverified-e5c5e06808437554b462549c207d20cd`；不是Git/Coze同树或发布通过）。

历史检查点（本批修补前，以顶部新状态为准）：2026-10-12最终整批静态独审已完成90/90，C0/I3/M0，未批准交付；三项新缺口为合法Token补扣结果接收、完成任务原nonce恢复、历史完成子任务之后的活动任务取消。主控已核对源码，随后只读复现前两项原客户端行为，见[限定复现证据](../../../.superpowers/sdd/2026-10-09-sketch-to-code/task6-客户端两项只读行为复现-20261012.json)；仅模拟公开JSON和内存执行，未运行真实路由/数据库/Edge，第三项仍仅静态确认，三项均未修复。当前先明确这三处最小业务修补/对应测试及新隔离验收范围，再做针对性RED/GREEN和原审查员复核；不重开已闭阶段，不把原绿色CI/旧封存构建当作无缺陷或新程序通过。完整结论见[最终整批独审](../../../.superpowers/sdd/2026-10-09-sketch-to-code/task6-最终整批独审结论-20261012.md)。

当前Task1绘图、Task2安全HTML、Task3原任务/账务/资产及Formal HTTP、Task4画布接入、Task5节点接入均已有各自代码限定审查闭环，不能按下方早期未勾选项重新开发。Task6已有修补后隔离构建、原独立MPE数据库回归、原无过滤完整回归（1085文件/13521通过/9原条件跳过/native0），以及分批原生Edge/HTTP/PG证据；并非所有原生/云端/真机/发布门禁关闭。

当前逐项完成/未完成清单统一见[分层验证记录](../../testing/2026-10-09-sketch-to-code-acceptance.md)顶部“2026-10-12 当前验收清单”。原节点/绘图/故障浏览器证据按其实际源码检查点记录；后续当前源码验证与10月12日两个限定缺口单列，不继承成全部重测。

执行顺序：只补清单中点名的未验项与最终独审/交付；不重复已闭代码批次、完整CI、构建或历史浏览器矩阵。真实模型/付费上限、S3、实体设备、Coze来源和最终发布条件未具备时明确未验，不用mock替代、不擅自部署。Obsidian实际在F:的单文件同步仍待明确范围，项目内清单已原位更新。第七项继续延期，Pear取消、PSD核心保留；四个开源协作项目的研究仍在其余工作之后。

下文检查框及逐轮状态为原计划/历史检查点，保留失败与审查轨迹；本段与验证记录顶部为当前入口，不把旧“尚未接入”当新任务。



> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成整体第八项的画布草图窗口、双阶段远程视觉、安全HTML交付与ai-sketch-to-code节点，不等待延期协作项。

**Architecture:** 绘图历史和安全界面编译器使用独立纯函数；绘图renderer及抽屉只投影其状态。生成服务复用管理员模型、任务/积分、项目与资产权威链；画布与节点调用同一入口，不引入新的任务/存储来源。

**Tech Stack:** Next.js 16、React 19、TypeScript、Pointer Events、Canvas 2D、现有任务/模型/资产服务、Vitest、Testing Library、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-09-sketch-to-code-design.md`

## Global Constraints

- 第七项DEFERRED/未验收；整体1–6及已闭分享不重做，Pear取消、PSD核心保留。
- 其余项目完成后才研究第七项：候选参考为tldraw、AFFiNE、Dim0、Yjs；当前不重启协作重试或切换架构。顺序和研究边界以 `docs/superpowers/specs/2026-09-27-upgrade-goal-scope-decisions.md` 的2026-10-09新增决定为准。
- 只修改main，不动stable，不暂存/还原六份用户SDD文件和无关变更；未授权发布或扩大浏览器安全访问。
- 不依赖本地GPU，不新建模型/积分/媒体/项目/任务权威，不绕过协作文档权威，不覆盖原素材。
- 8色、3档粗细、50步历史、200笔/2048点每笔、逻辑1024×768、最大边长2048。
- providerId+modelId冻结；HTML由受校验界面树白名单编译，iframe空sandbox，预览和下载同一安全内容。
- 所有生产行为先RED再最小GREEN；mock、旧产物或本地结果不能冒充真实供应商/当前生产/Coze验收。

## Task 1：不可变绘图历史和PNG重放

**Files:** Create `src/lib/sketch-to-code/drawing.ts`、`src/lib/sketch-to-code/render.ts`；Test `src/__tests__/lib/sketch-to-code-drawing.test.ts`、`src/__tests__/lib/sketch-to-code-render.test.ts`。

**Interfaces:** `SketchPoint`、`SketchStroke`、`SketchDocument`、`SketchHistory`；`createSketchHistory(width?,height?)`、`appendSketchStroke(history,stroke)`、`undoSketch(history)`、`redoSketch(history)`、`clearSketch(history)`；renderer接收同一SketchDocument与CanvasRenderingContext2D，export函数返回PNG data URL。

- [x] 写并实跑历史、非法输入与外部可变引用的RED。

```ts
const history = appendSketchStroke(createSketchHistory(), {
  id: 'stroke-1', tool: 'pen', color: '#111827', width: 2, points: [{ x: 10, y: 20 }],
});
expect(undoSketch(history).present.strokes).toHaveLength(0);
expect(redoSketch(undoSketch(history)).present).toEqual(history.present);
expect(undoSketch(clearSketch(history)).present).toEqual(history.present);
```

- [x] 实现不可变历史与有界输入，原测试转GREEN；清空可撤销、新分支清redo，输入对象后续变化不影响历史。
- [x] renderer测试真实操作序列：pen=source-over、eraser=destination-out，导出白纸使用destination-over；单点绘制圆点，失效context明确报错。实跑两文件，记录原生退出和JSON。

2026-10-09限定交付：初始缺模块RED为收集失败，20+5实际GREEN；独审追加稀疏数组和继承虚线边界。首轮dash间隔8小于10px圆头笔覆盖范围，26PASS/2FAIL保留；改为真实可见间隔40后3FAIL/25PASS/native1。仅按索引拒绝空洞、重放前归一化dash/offset后两文件28PASS/0skip/native0，五新增路径严格ESLint0。同席只读复审确认2Important闭合、无新增Critical/Important，仅批准内核+renderer；UI/AI/第八项尚未完成。结果见 `output/playwright/semantic-target-source-20261004/stage8-drawing-render-review-green-20261009.json`。

## Task 2：安全界面树编译器

**Files:** Create `src/lib/sketch-to-code/html.ts`；Test `src/__tests__/lib/sketch-to-code-html.test.ts`、`src/__tests__/lib/sketch-to-code-browser.test.ts`。

**Interfaces:** `SketchUiNode`是有界静态控件树，`SketchUiStyle`仅含结构化有界布局/字体/颜色；`compileSketchHtml(tree:unknown):string`严格校验后输出带CSP的完整HTML；`SKETCH_PREVIEW_SANDBOX = ''`。

- [x] 实跑RED测试组覆盖文本`<script>`/事件伪装、CSS URL、rawHTML、未知tag、过深/过大树、远程资源、非法颜色/尺寸与非有限值。缺模块初轮仅收集失败；throw占位实现的行为RED为38项7FAIL/31PASS，不将负向用例被无条件throw满足算作安全实现。

```ts
expect(compileSketchHtml({ type: 'text', text: '<img src=x onerror=alert(1)>' }))
  .toContain('&lt;img');
expect(() => compileSketchHtml({ type: 'script', text: 'alert(1)' })).toThrow();
expect(() => compileSketchHtml({ type: 'text', style: { rawCss: 'url(https://x.test)' } })).toThrow();
```

- [x] 最小实现递归白名单、HTML转义与生成样式，不接受任意HTML/CSS字符串。正文节点最多200、最大深度12、文本总量64KiB、完整HTML最多256KiB。
- [x] 独立Chromium测试夹具装入严格空sandbox，验证脚本阻断、外部资源未到网络路由、表单未提交；保留可见布局、中文与静态控件，Blob下载与iframe源逐字节相同。此为编译器/浏览器边界，不是产品抽屉、用户Edge或Coze验收。

2026-10-09限定交付：43项编译器测试、2项真实浏览器测试。首轮浏览器失败因CSP拒绝也会产生request事件；实际requestfailed=`csp`、路由处理计数0，只更正观测断言而未放松安全。独审提出checkbox/radio静态状态、跨子树全局节点预算、实际空sandbox属性；4FAIL/39PASS/native1后控件disabled、三个默认字段只在省略时生效，真实200/201跨树和`.click()`补验。相关4文件73PASS/native0，原2Important/1Minor已只读复核关闭，无新增C/I。原失败全部保留。

## Task 3：远程双阶段服务及已有任务/计费接入

**Files:** Create `src/lib/sketch-to-code/generation.ts`、`provider.ts`、`configured-dependencies.ts`、`src/app/api/sketch-to-code/route.ts`；Test `src/__tests__/lib/sketch-to-code-generation.test.ts`、`sketch-to-code-provider.test.ts`、`src/__tests__/api/sketch-to-code.test.ts`。必要的任务类型/结果适配限定修改 `src/lib/task-registry.ts` 与现有异步结果解析，不另设任务Map。

**Interfaces:** `SketchCodeInput={projectId,imageDataUrl,instruction,providerId,modelId,idempotencyKey}`；纯计算服务`generateSketchCode(value,dependencies,context)`返回`SketchCodeDraft={analysis,html}`，通过明确的`analyze(image,instruction,binding,signal)`和`reconstruct(analysis,binding,signal)`实现两阶段。正式路由复用原任务/计费/资产权威组成`SketchCodeResult={analysis,html,previewAssetId,htmlAssetId}`；start返回taskId，status/cancel沿用既有任务接口，计算快照不是发布许可。

- [x] 仅计算内核完成：实际PNG CPU完整解码、4MiB/2048边长、精确冻结模型、分析与界面JSON/schema/UTF8预算、每阶段60秒、取消后迟到兑现/拒绝不推进下一阶段、立即清理自身计时器/监听器。远程、项目授权与模型目录为注入夹具，未接HTTP、业务库、扣费或资产发布。

当前计算测试40PASS；新增清理回归分别对遗漏clearTimeout及removeEventListener做受控mutation，均6FAIL/34skip/native1，正确实现随后逐字恢复。新增真实坏IDAT但有效头/CRC样本、4MiB临界PNG、200/201分析数组及两阶段256KiB/+1字节边界。缺模块RED仅为收集失败，后加测试属于回归补强；不能冒所有40条均先断言RED，也不能用计算内核结果关闭本Task3。与Task1/2组合5文件113PASS/0FAIL/0skip/native0；见`stage8-review-combined-green-20261009.json`。限定只读复核关闭1Important/2Minor、无新增C/I/M；新增五路径strictlint原生0，完整非增量noEmit types/session89173原生0。正式route/HTTP/计费/资产发布与真实供应商仍未验收。

上述40/113为先前计算快照，不是最新组合。现新增`prepareSketchCode`：完整验证后才交出冻结快照和compute闭包，不先调用供应商；后续正式任务使用自己的AbortSignal。新增7项行为RED为7FAIL/40条件未选择/native1，最小拆分后完整计算47PASS/native0。项目授权仍只是读快照，不授予发布许可；闭包也不是一次执行租约。

- [x] 配置模型HTTP适配实现：默认引用原项目授权、resolveTaskModel和findProviderById；限同步视觉chat-completions，两个POST冻结服务端凭据/端点/精确模型，不重发、不重定向、不fallback。实际回归为本地原生HTTP；授权、目录及凭据配置用注入夹具，不冒真实业务库/供应商。

HTTP当前41项覆盖两阶段、准备时零HTTP、准备后配置变更、401/403/404/429/503原错误与密钥脱敏、JSON完整结束/响应模型、UTF8/1MiB实际字节限额、取消连接及迟到体清理。初始22项行为RED/早期非JSON头1项timeout RED及复核修正RED全部保留；原3Important/1Minor只读关闭。prepare复核新增授权对象在模型解析期间可改写：个人/文档两项实际RED后，授权返回立即复制冻结，返回并校验同一副本；原1Important只读关闭，无新增C/I/M。计算现在49项；最新6文件163PASS/0FAIL/0skip/native0（session19726），五变化路径strictlint0，最后改动后完整非增量noEmit types/session66632原生0。正式API/原子扣费/资产/用户界面与真实供应商仍未完成。

- [x] 实际读取现有 `resolveTaskModel`、API授权、任务注册/终态、积分幂等及资产提交合同。内部受理引用原 `createBillableTask` 与同事务权限锁，草图类型接入原终态退款策略；正式API、worker和原子资产交付仍未完成。
- [x] 执行控制接续（仅此接缝）：新增 `src/lib/sketch-to-code/execution.ts` 和行为测试，复用原持久租约、取消与原子终态退款；过期同步任务不重发，无publisher时计算前拒绝。fix1限域扩展原退款入口的opt-in锁后DB时间/身份栅栏及真实PG测试，旧调用者不变。100项执行行为、11文件380项及两PG文件42项分别通过/native0，strictlint/fulltypes0；独审I1/I2/M1关闭，新C0/I0/M0。证据和边界见本计划SDD的 `task-3-execution-fix1-review.md`、`progress.md`。独立PG已停止，日志保留。正式publisher/资产/API/Token仍待接入，不关闭整个Task 3。
- [x] 内部持久化受理及原账务合同限域验证：30项接缝测试、17项独立真实PG测试；PNG先验证、精确模型、原扣费前权限锁、重放先读原任务/旧价格、原子重复受理/唯一退款和迟到终态保护。真实PG使用完整原迁移及随机schema，不是业务库或供应商实测。
- [x] 原资产事务 publication 与当前受权 HTML 读取（仅此接缝）：保存同项目草图 PNG 与受限编译 HTML 逻辑 AssetVersion，复用原任务完成与原项目授权；按次不新增扣退，重复/迟到/撤权/未知 COMMIT 保持安全边界。来源树保留已校验 uiTree；fix1 合法深度12样式来源与 completed 重放最后锁后 DB-time 均经真实 RED→GREEN。最新13文件408项、完整publication PG46项为两个独立命令，各native0；五修补路径strictlint与全根非增量types0；同一Boyle复核关闭I1/I2，新C0/I0/M0。主控审计53650 schema/连接均0后停止，仅保留日志/集群。证据 stage8-publication-authorized-read-review-green-20261009.json，SHA256 3030f80570baaa0e07766c081f4c4430544ba7cb88da8b94b8622e3b31a3288a；本计划SDD task-3-publication-fix1-review.md。此前380/42执行、405/43候选均为历史，不能代替当前源码验证；正式API/下载HTTP头、Token、UI/placement/node仍未接通，不关闭Task3。原读权为owner/current editor，viewer-only未实现/未验证，不扩大冻结公开分享。

2026-10-09最新限域证据：14文件271PASS/0FAIL/0skip/native0，含Stage8原163、受理30、PG17及既有计费/定价/终态61项。结果为`stage8-admission-terminal-review-green-20261009.json`，原生主控会话27335；六变化路径strictlint0，最后测试夹具改动后完整非增量noEmit types/session16501原生0。Bacon只读复核关闭原2Important、最终C0/I0/M0，批准仅内部受理，不关闭Task3。原定价宽松读取会吞错、新定价阻断重放的7FAIL/1PASS/22未选择/native1全部保留；初始queued不能由原入口退款的真实PG RED，改为平台原processing状态后，唯一退款已验证。重复取消会更新原任务updated_at，夹具仅对重复取消比较排除此字段；迟到完成仍逐字段比较完整快照，账务/身份/结果/资产未放宽。正式API、worker恢复/资产发布及Token实际结算未完成。
- [x] 真实usage采集（仅纯数据接缝）：真实本地HTTP报告两阶段计数，严格每phase每方向10M/合计20M、缺失与0区分、descriptor复制/冻结与draft保留。当前14文件546PASS/native0、八路径strictlint和全根fresh types0；Poincare spec/quality Approved C0/I0/M2。早期Node路径和一次无关brief读取两Minor在ledger保留，最终全分支审查仍须看；不称流程零偏差。receipt stage8-token-usage-review-green-20261009.json SHA2A0BBC9E4D109BBF39BB3DE800A39BAF20F8092C1518D7F33B2CE3BEFD940C3F；原账务/pub保护，Token422在检查点仍关。本证据不是持久Token结算、PG或完整Task3，后续source改变后为历史检查点。
- [x] 原账本Token原子结算（仅内部接缝）：原14路径/11原snapshot/有效41保护与三路径fix1完成；最终18文件661unit、四文件164真实PG（Token76/原46+25+17）、strictlint3与fresh types均native0。Halley同席复核关闭I1/I2，新C0/I0/M0、Spec/Quality Approved。主控53651审计test schema/其他连接0，stop0/status3/PID不存在，日志和集群保留。限定证明`stage8-token-settlement-review-green-20261009.json`；不新价格/任务/账本权威，不代表正式HTTP、Task3/Stage8或付费供应商通过。下面旧13/10/42派发及候选失败记录为历史，不覆盖当前限定关闭。

当前Token接续的实证裁定：首批5核心PG已通过，但四文件候选为91PASS/3FAIL/native1，types原生2，两局部类型问题由同一实施者修。余额近INTEGER上限使成功返差额和全退款都不能入账时，严格保留deferred/原预扣/无副作用，须补容量恢复后原回收唯一退款，不冒已完成；原admissionPG两条过时合法Token422预期另经主控全字节snapshot/SHA后允许更新，17用例/非法配置与其他15断言保留。当前14允许路径/11原snapshot/41有效保护；原13/10/42是派发历史，不覆盖原baseline。精确例外见本计划SDD contract/amendment，非共享生产账本扩大。正式HTTP候选17路径合同已准备，待Token独审后派发，尚无route/HTTP验收；不重复前置接缝或提前第七项研究。
- [ ] RED：匿名、错项目/权限、无视觉能力、客户端API密钥、非法PNG、超限、两阶段非JSON/超时/取消、重试换模型、重复idempotencyKey、迟到结果、失败唯一退款。

```ts
// 匿名请求必须在解析供应商和扣费之前被原API授权入口拒绝。
const response = await POST(new NextRequest('http://127.0.0.1/api/sketch-to-code', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectId: 'not-owned', providerId: 'p1', modelId: 'm1' }),
}));
expect(response.status).toBe(401);
```
- [x] 两阶段HTTP接缝使用server冻结的providerId+modelId，模型内容按原schema解析后编译HTML；保留安全原错误/请求身份，不隐式换模型，不发起自身API递归请求。此勾选只代表接缝，不代表正式任务/扣费/资产或真实供应商验收。
- [ ] 完整相关测试GREEN及限定复核后，记录mock与真实供应商边界；真实供应商费用/配置不足时保持未验收，不调用无关免费fallback冒充成功。

## Task 4：画布抽屉与交付入口

**Files:** Create `src/components/sketch-to-code-panel.tsx`、`src/__tests__/components/sketch-to-code-panel.test.tsx`；限定Modify `src/components/infinite-canvas.tsx` 和现有底部工具动作目录；Test `tests/e2e/sketch-to-code.spec.ts`。

**Interfaces:** `SketchToCodePanel({projectId,onClose,onAddResult})`，`onAddResult(result:SketchCodeResult):Promise<void>`连接现有项目AssetVersion/placement路径。内部使用Task1历史/renderer、Task2安全HTML、Task3接口。

- [ ] RED覆盖底部入口/关闭、所有颜色/粗细/笔擦、坐标缩放、撤销/重做/清空、空草图拒绝、模型绑定、取消及重试、预览/下载/添加结果；旧鼠标/触摸/滚轮/输入框/撤销合同保持。

```ts
// 使用已登录的原浏览器夹具，在普通测试项目中操作真实底部入口。
await page.getByRole('button', { name: '草图转代码', exact: true }).click();
const panel = page.getByRole('dialog', { name: '草图转代码', exact: true });
await expect(panel.getByRole('button', { name: '画笔', exact: true })).toBeVisible();
await expect(panel.getByRole('button', { name: '橡皮擦', exact: true })).toBeVisible();
await expect(panel.getByRole('button', { name: '生成代码', exact: true })).toBeDisabled();
```
- [ ] lazy抽屉最小接入，防止抽屉滚动缩放主画布。生成中显示阶段和取消，失败保留草图，不能自动二次扣费。
- [ ] 添加result走现有项目资产/版本入口；普通项目和已有协作项目分别验证，协作不可用时明确失败，不降级覆盖legacy项目数据。
- [ ] 原生Edge独立页面及375px窄屏验绘图、PNG下载、安全预览、HTML下载和普通项目刷新恢复；不验Coze项目右侧iframe。

## Task 5：节点模式复用同一服务

**Files:** Modify `src/lib/workflow-engine.ts`、`src/components/node-editor.tsx`、`src/app/api/workflow/execute/route.ts` 的必要分支；Test `src/__tests__/lib/sketch-to-code-workflow.test.ts`、现有工作流执行测试、Task4浏览器文件。

**Interfaces:** 新NodeType `ai-sketch-to-code`；图片和prompt端口；配置包含明确providerId/modelId；请求仍由 `buildNodeExecutionRequest` 构建，指向 `/api/sketch-to-code`；输出包含安全HTML与已有资产引用，不另立付费/任务权威。

- [ ] RED验证节点目录、属性/端口类型、图片/说明上游传递、冻结模型、真实dispatch/status/cancel、输出预览/导出。未知HTML结果不能误当图片URL。

```ts
const node = createWorkflowNode('ai-sketch-to-code', 0, 0);
node.config = { projectId: 'project-a', providerId: 'vision-provider', model: 'vision-model' };
const request = buildNodeExecutionRequest(node, { image: 'sketch-png-input', prompt: '还原这个页面布局' });
expect(request?.endpoint).toBe('/api/sketch-to-code');
expect(request?.body.providerId).toBe('vision-provider');
expect(request?.body.modelId).toBe('vision-model');
```
- [ ] 最小节点接入，与画布使用同一服务和结果格式；执行日志保留阶段/原错误/任务身份，取消和重试沿用Task3幂等合同。
- [ ] 实跑工作流回归与浏览器原上下游用例；图生图、Skills、聊天、导出及其他节点不得减少。

## Task 6：其余平台回归和分层交付

**Files:** 原位更新当前master、协作ledger、Obsidian看板及此计划；新增 `docs/testing/2026-10-09-sketch-to-code-acceptance.md` 记录证据，而非复制历史任务清单。

- [ ] 检查本轮diff/保护/旧入口/依赖，全类型和代码检查；默认完整测试及独立PG/计费验证按本地隔离合同执行，原失败与未验项保留。
- [ ] 当前源码隔离生产构建、完整marker/严格NFT/实际API产物、原生启动与浏览器验收；不使用本轮修前生产产物代替。
- [ ] 整体1–6受影响部分与新第八项回归；第七项仍延期，Pear仍取消。真实供应商、S3、实体设备等未取得证据须单列，不把mock/模拟窄屏当真机/云端成功。
- [ ] 独立复核后只关闭有实际证据的任务；完成其余部分的交付清单明确第七项剩余和无法承诺全平台发布的边界。未授权的发布/部署不执行。

## 后续研究：第七项多人协作（其余项目完成后）

此节不是当前第八项开发任务，也不把延期协作验收列为Task 6的前置；仅在其余项目完成后进入。原第七项失败、权限和验收门禁保留。

- [ ] 阅读tldraw、AFFiNE、Dim0、Yjs官方仓库、文档及许可证，核对实际同步服务、客户端接入和持久化实现，不凭项目宣传或库名推断运行架构。
- [ ] 对比多人并发、断线重连、刷新恢复、权限撤销、在线状态、图片资源及部署入口；明确当前故障属于传输链路还是协作数据层。
- [ ] 提出与现有项目/资产/任务/积分权威兼容的最小接入候选，列出接入成本、许可限制、验证方式及停止条件；不在研究阶段自动替换、安装或部署。
# 2026-10-09 Token 独审 fix1/5 最新检查点

本节下述“未批准/仍运行”为旧round1检查点，已由末尾“Token fix1已批准”覆盖；原失败和审查证据不删除。

最后固定候选637 unit/135真实PG与strictlint/fresh types原生0，但Halley独审C0/I2/M0未批准：回滚后全退款前需要重新持锁核验当前项目grant与原consume。主控已核实原terminate支持options.client，仅准execution源/对应unit/TokenPG三路径修补，原55当前pin冻结为三raw snapshots/52保护，另15原历史证据保护；Epicurus同handle继续，不新派重复实施者或改共享financial。

原全部637/135证据及round1审查保留为未验收候选，修补后须独立真实交错RED/GREEN、同client锁后DB-time/lease/deadline与unknown保护、完整固定source验证及同Halley复核。53651仍运行待最终审计停止。正式HTTP17合同已就绪但未派发，UI/placement/node/当前平台/build/独立Edge未完成；第七项官方开源协作研究仅在其余项目完成后进行。本段不关闭Task3/Stage8或整体目标。

## Token fix1已批准（仅此接续关闭）

新f2证据为661unit/164真实PG/strictlint3/fresh types原生0，全部原637unit/135PG名称和multiplicity保留；三raw snapshot/52source/15history保护经主控及同一Halley复核。两条真实旧生产交错RED与全部夹具/f1类型失败保留；仅I1/I2和三fix delta获Approved C0/I0/M0。主控已审计并停止唯一53651/system7694645594810926408，未删除文件。生命周期仅cluster manifest有预期变化，其他51source及15history不变。Epicurus/Halley已关闭。

以上为Token闭合时点：当时仅勾选内部Token，正式HTTP17候选、UI/placement、节点与其余验收未做；当前接口限定关闭以以下最新检查点为准，历史不删除。

## 正式HTTP18限定批准，进入Task4

- [x] 正式start/poll/cancel/document的TDD代码门禁及单独Spec/Quality复核：27文件862PASS/零skip、18 strictlint、全根fresh types均native0；90当前pins/72有效保护/旧poll12断言区一致。660原Token案例名称不变，1合法safe-message需求改名显式映射、全661 multiplicity保留；旧poll51原案例保持。
- [x] McClintock独审Approved C0/I0/M0，主控停源回读及限定关闭`stage8-formal-http-review-green-20261009.json`；不代表Task3/Stage8、native HTTP生命周期、真实provider/S3或产品Edge通过。
- [x] Task4单批16路径范围冻结：8原字节snapshot、8原absent、102保护；只复用原绘图/编译器、模型目录及资产权威，不修改Task3或重开第七项。详细执行以本计划SDD `task-4-canvas-contract.md`与baseline为准；该勾选只是前置冻结，不是Task4实现或验收。

后续Task4画布/placement、Task5节点、Task6隔离构建及其余平台回归仍按原顺序。第七项研究仅在其余完成之后，整体目标active。

