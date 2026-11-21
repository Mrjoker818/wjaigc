# drama 组逐路径只读审查

审查 HEAD：`29f7e2df5cb53619c2f5401fa587fbea7882b079`。47 条（44 在场、3 删除），7 条 hold，40 条静态未发现阻断；整体 **hold**。

仅写本目录 review-drama.json / review-drama.md；未改源码、基线、other 记录、远端或 Git。未运行测试、构建、数据库或供应商。

本组 previousReviewedBlob 全部为空：逐条读当前文件并查引入提交；已删除文件读实际删除 diff。每条都记录当前 blob 和该路径最后变更 sourceCommit；没有只换 hash 盖章。

已有 CI 日志是历史证据：checkout 为 `26e021b97bfd92d36210e287ad71f363ff51abb9`，本地对象缺失，无法比对当前 blob，未 fetch。日志的成功标记不构成本次或当前 HEAD 的测试通过。JSON 保留每条原始日志行与源测试路径。

## 需阻断/暂缓的边界

### D01 [P1] 长文改编绕过当前用户的精确聊天模型授权

证据性质：confirmed-source。

route 调 dramaPlannerConfig() 没有 selection.user；该函数无 selection 时选系统 chat 提供商的首模型且跳过 isModelAssignedToUser。已有视频权限但无该聊天模型权限的普通用户仍可把长文发给该模型。config 后续冻结正确但授权前提缺失。

位置：`src/app/api/drama/adapt/route.ts:108-113`；`src/components/drama/drama-adapt-form.tsx:24-26`；`src/lib/drama/draft.ts:21-34`。

解除条件：改编请求/服务端接通当前 user 和精确 providerId+modelId；补 route 级无授权/撤权/错供应商/非首模型用例，不能只靠目录或 hash。

### D02 [P1] 导入剪辑的归属、真实媒体和持久化证据不足

证据性质：hold-unverified-boundary。

保存调用不接 userId/projectId；helper 只写本地 drama-clips 并返回公共媒体 URL。普通媒体 serving 分支没有 owner 校验，音频分支才单独验证 owner。测试模拟保存，且只用 ftyp 头作为成功媒体。可确认缺少这些绑定，但尚未证明产品要求私有媒体或运行盘能跨部署保留，所以 hold，不能写成已确认跨用户漏洞或冷启动通过。

位置：`src/app/api/drama/clip/route.ts:25-30`；`src/lib/server-data-root.ts:171-189`；`src/app/api/serve-upload/[...path]/route.ts:97-125`；`src/__tests__/api/drama-clip-route.test.ts:22-38`。

解除条件：明确媒体共享/隐私契约并给 owner 或显式共享规则、真实 clip 可解码及目标部署重启/重发版可恢复证据；负责人决定修复方式。

### D03 [P1] 恢复图片回执缺少原始输入版本，可能覆盖新编辑

证据性质：confirmed-source-missing-binding。

原始 prompt/ratio/referenceImages 仅发给 generate，不写入操作检查点或输入快照。重开待回执项目后用户可改描述/参考图，再点恢复；结果只按 target.entityId/view 附回并 applied=true，无版本比较。与视频 take/配音的输入版本保护不一致。不会重复扣费是已存在保护，但不能证明该图仍符合当前输入。

位置：`src/lib/drama/production-state.ts:12-20`；`src/lib/drama/production-image-client.ts:64-78`；`src/components/drama/use-drama-workbench.ts:328-350`；`src/components/drama/use-drama-workbench.ts:754-757`。

解除条件：保留图片提交输入或稳定 snapshot；恢复时只匹配原版本，过期结果留历史/要求显式采用；补 reload+改输入+恢复、手动另选图+晚到、删除目标的测试。

### D04 [P2] 润色迟到响应会覆盖等待期间的手动编辑

证据性质：confirmed-source。

polish busy 只禁用润色按钮，提示词及镜头字段仍可编辑；回包仅检查 controller.aborted，直接覆盖当前 shot 对应字段。dropUndo 只清撤回状态，不中止请求也不校验输入版本。父层 keyed shot 挡住跨镜头复用，但挡不住同镜头后续编辑。

位置：`src/components/drama/drama-shot-language.tsx:31-49`；`src/components/drama/drama-inspector.tsx:104-119`。

解除条件：输入变更中止/废弃旧请求或按提交时快照做比较；补发起润色后手动编辑再返回的组件时序用例。

### D05 [P2] 素材弹窗缓存未随项目 scope 作废

证据性质：hold-unverified-lifecycle。

projectId 变化只开启新读取，旧 others 仍参与 images 且可点击；无 projectId 的 list 查询是所有本人短剧。深链进入时 projectId 可晚于 record 到达。换 dramaId 父层 key 会重挂载，故没有把所有切换都断言成跨项目混入；仍缺同 record 项目晚到的验证，hold。

位置：`src/components/drama/drama-library-picker.tsx:34-55`；`src/components/drama/drama-library-picker.tsx:79-85`；`src/components/drama/drama-workbench.tsx:50-71`；`src/lib/drama/store.ts:36-43`。

解除条件：按 projectId/dramaId 绑定缓存并使旧缓存不可选；补 projectId 从 undefined 变为目标项目且新请求挂起/失败的组件用例，排除非目标项目素材。

## 已核实的例外与范围

- 部分改编以 completed + adaptedParts/totalParts 保存真实已完成剧本；drama-workbench.tsx:146-147 有部分失败提示，未误报为完全无提示。
- legacy 媒体无快照被视为 current、单集包失败仍保留原URL、未知报价可显式按实际价格开始，均在现有源码/测试明确；列为限制，不能拿它们证明新产物或扣费验收。
- 待估价 `pending:*` 仅为估价构造引用计数，不是图像生成假成功产物；未见本组固定演示结果伪装生成完成。
- 只读上下文包括精确模型选择、owner-scoped store、计费终态/回执及媒体存储，不审批另一组路径。

## 逐路径记录

### `src/app/api/drama/adapt/route.ts`

- 判定：**hold**；阻断：是。
- currentBlob：`f45ff219943d708e443ff19a71d2f9702daadc92`
- sourceCommit：`77be21c147abb930831ae85457b8d3ecc2434dc8`
- 引入提交：`aa1cb94eece5d2d47fd0ddd152d4560f3ca9aa31`
- 实际变化：新增按段后台改编；登录/视频平台、项目访问校验后冻结一个 LLM config，按段合并并保存到当前用户名下。
- 已读位置：85-107 登录、平台、project 授权；108-129 系统模型配置与后台任务；49-73 部分失败及终态。
- 风险/边界：D01：无 user/精确模型选择的系统默认调用越过用户聊天模型授权。部分成功标 completed 有 adaptedParts/totalParts，前端 146-147 有部分失败提示，不能称完全无提示的假成功；任务及互斥 Map 为进程内，重启续跑未证实。
- 判定理由：长文改编绕过当前用户的精确聊天模型授权
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-adapt.test.ts:58-74`：mock start/poll 的完整/部分结果及失败；未覆盖本 route 的模型授权。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10395`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-planner-selection.test.ts:20-30`：显式选择被撤销时拒绝，但无参数系统调用仍能选择首模型。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232259.log:5396`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5356`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/app/api/drama/clip/route.ts`

- 判定：**hold**；阻断：是。
- currentBlob：`5798cbd79fc896eeabb7e8851b1b924c427a0a4a`
- sourceCommit：`26e8815f3f6effc6f6285e7e05ca41f07cdd17af`
- 引入提交：`26e8815f3f6effc6f6285e7e05ca41f07cdd17af`
- 实际变化：新增免费视频文件导入；登录和视频平台前置，48MB、MIME 与头部签名检查后写 drama-clips。
- 已读位置：17-30 输入检查、落盘、返回 URL。
- 风险/边界：D02：没有 owner/project 绑定，saveImageFile 只写本地公共目录；现有测试用仅 ftyp 头的字节当 MP4，不证明真实可播放、私有归属或冷启动可恢复。
- 判定理由：导入剪辑的归属、真实媒体和持久化证据不足
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/api/drama-clip-route.test.ts:22-52`：检查头部与平台，模拟 saveImageFile，不是实际媒体/持久化测试。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:9547`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/app/api/drama/import-script/route.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`8d25428f4894c41ac3ae6be5425646bdae2505cd`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增已有剧本纯预览导入；先鉴权、按实际流限制请求体，再解析 JSON/单个 TXT/DOCX 文件并校验文档。
- 已读位置：19-35 chunked 请求硬上限；38-80 预览无保存/生成，结构与类型错误明确返回。
- 风险/边界：未发现以模型或演示数据填充解析失败；不涉及计费/退款。真实服务上传负载本次未执行。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/api/drama-import-script-route.test.ts:7-35`：预览调用 store/planner 即抛错；原文、multipart、401/403、坏输入与无长度超限。
    未在已读原始日志定位到该测试文件的成功执行记录。
  - `src/__tests__/lib/drama-script-file.test.ts:17-60`：TXT/DOCX 的边界测试源码；未运行。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231934.log:7235`，记载 10 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/app/api/drama/music/route.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`683ca01900819a75d33caaf6d75bce2197d56892`
- sourceCommit：`523c66ab1e3230dc38fe70c83025789e7c3715f2`
- 引入提交：`91f0c935a81afb661d52081347e57ebd560e5989`
- 实际变化：新增 MP3/WAV 背景音乐上传，后续重用 audio-upload 的内容识别；实际音频存储使用 auth.userId。
- 已读位置：15-36 鉴权、格式、25MB 和错误处理。
- 风险/边界：DB_ONLY 下 generated-audio-storage.ts:159-172 在 owner_id 下保存，写入未确认会失败；route 测试模拟存储，不等于本次数据库验证。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/api/drama-music-route.test.ts:37-65`：断言格式内容优先、ownerId 传递、损坏文件和视频平台拒绝。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10418`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/app/api/drama/take-receipt/route.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`3f7455054bad6bdc71b84388132aa8cc70563d63`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增原始图像/视频回执只读恢复；先按 owner+服务端构造幂等 key，未找到才按原 source identity 精确查询旧记录。
- 已读位置：11-34 严格 identity 与媒体白名单；53-75 owner/type/provider/model 校验、歧义及 pending。
- 风险/边界：不生成、不改账；refunded 不被当成可以重发；供应商内部 payload 不出接口。旧数据库查询集成契约存在，但本次不执行数据库，CI 原始日志未证明此集成在当前树执行。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/api/drama-take-receipt-route.test.ts:36-127`：覆盖本地退款仍 pending、错 owner/type/model/provider、白名单、401/403、错误保密。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5540`，记载 28 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/api/drama-receipt-storage-contract.test.ts:11-24`：数据库契约源码存在；仅定位，未执行。
    未在已读原始日志定位到该测试文件的成功执行记录。

### `src/app/api/drama/voice-sample/route.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`349d662964a67826ecb373f5ef949aa2049475ac`
- sourceCommit：`523c66ab1e3230dc38fe70c83025789e7c3715f2`
- 引入提交：`523c66ab1e3230dc38fe70c83025789e7c3715f2`
- 实际变化：新增角色声音样本上传；格式与字节数、实际 ffprobe 时长先检查，再使用当前 userId 存储。
- 已读位置：14-38 鉴权、15MB、2–15 秒（+0.5 秒容差）、存储；39-43 解码或存储失败。
- 风险/边界：时长允许到 15.5 秒而文案为 15 秒；route 测试模拟 probe/存储，真实 ffprobe 依赖的可用性本次未验证。失败不返回 success。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/api/drama-voice-sample-route.test.ts:14-60`：探测/存储 mock，断言 ownerId、过长/过短/损坏/无权限。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10439`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-audio-upload.test.ts:17-27`：有真实 ffmpeg/ffprobe 条件执行用例；本次未运行。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232176.log:6554`，记载 1 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6532`，记载 1 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/drama/drama-adapt-form.tsx`

- 判定：**hold**；阻断：是。
- currentBlob：`75714910ebc46c0e538cc7a2f592137c0645dc4a`
- sourceCommit：`524e8604a54b94e624b27c494149e918371132aa`
- 引入提交：`aa1cb94eece5d2d47fd0ddd152d4560f3ca9aa31`
- 实际变化：新增长文改编表单，约计集数、风格/比例、提交与后台进度文案。
- 已读位置：16-27 提交仅文字、风格、比例、时长；64-69 按 busy 防双击、进度文案。
- 风险/边界：D01 的前端入口也未提供/传递授权 planner 选择；按钮不扣站内积分不代表可绕过模型权限。集数为约数，与服务端分段可能不同。
- 判定理由：长文改编绕过当前用户的精确聊天模型授权
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-adapt.test.ts:19-74`：分段及 client mock，不能证明此表单的精确模型授权。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10395`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/components/drama-source-workflow.test.tsx:53-72`：保留改编入口；没有改编模型授权负向用例。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:1129`，记载 18 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/drama/drama-autopilot.tsx`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`8f98e65f232fd26f0ef18d3260cb34255a3437f6`
- sourceCommit：`ae8bd86c62ad401b63457ae34015139810279e01`
- 引入提交：`95463b354695de31a1703a9e2d522634bddf954f`
- 实际变化：新增一键成片清点、报价、分阶段选择、余额和停止提示。
- 已读位置：24-36 分阶段价格；46-67 引用已报价 episode，执行上层 runAutopilot；118-143 已提交扣费、未知报价显式说明。
- 风险/边界：未知价格允许经显式按钮按实际价格开始，并有红字说明；属于显式产品选择，未判为隐蔽 fallback。报价版本由 production-version 和 hook 再核验；实际扣退费不在此 UI。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/components/drama-workbench.test.tsx:169-191`：余额不足不能开始。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:8019`，记载 15 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-autopilot.test.ts:74-97`：选中阶段计价、未定价、报价覆盖范围。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232259.log:5359`，记载 6 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5319`，记载 6 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/drama/drama-library-picker.tsx`

- 判定：**hold**；阻断：是。
- currentBlob：`80ff6463c51605caf0031824698efcc3779bdcb4`
- sourceCommit：`d5d00933ef721cc2b4865f8379996eec3c2808ad`
- 引入提交：`d5d00933ef721cc2b4865f8379996eec3c2808ad`
- 实际变化：新增从当前画布、短剧与最多 8 个同项目短剧挑选已有图片。
- 已读位置：34-55 others 缓存、scope 依赖、异步读取和合并；79-85 列表可直接选用。
- 风险/边界：D05：scope 改变/重新打开时不清空旧 others，成功新读返回之前旧列表仍可选；空 projectId 查询全部本人项目。父层换 dramaId 有 key 重挂载，故不声称任意跨剧切换一定泄漏；同 record 绑定项目晚到的边界未证实。
- 判定理由：素材弹窗缓存未随项目 scope 作废
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/components/drama-workbench.test.tsx:235-259`：同项目正常选图与回画布，不覆盖项目晚到/请求挂起。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:8019`，记载 15 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-library.test.ts:29-69`：纯列表收集/去重，不测试组件 scope 生命周期。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5574`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/drama/drama-planner-picker.tsx`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`08fee72cc9d148b2e7aec44f0c992cb0ff28b10c`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增使用已授权聊天模型目录的 providerId::modelId 编剧选择；持久化到 doc.planner。
- 已读位置：9-24 精确选项、不可用旧值保留、无自动换供应商。
- 风险/边界：UI 目录不是服务端授权；配套 /api/drama/plan:51-64 确实传 auth.user 给 dramaPlannerConfig，显式非法选择不降级。改编接口是 D01 的单独缺口。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-planner-selection.test.ts:16-30`：精确非首模型、禁用/错供应商/撤权、无授权默认。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232259.log:5396`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5356`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/components/drama-script-source.test.tsx:51-65`：再生剧本发送所选 planner 并在结果保留。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232259.log:6053`，记载 8 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:6003`，记载 8 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/drama/drama-production-status.tsx`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`f379e4c5119fd00fa451c60d8cb69bc4181ef619`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增暂停制作/未确认图片及视频回执状态和显式恢复入口。
- 已读位置：11-24 仅从 doc 状态展示，不自行提交生成。
- 风险/边界：恢复路径 hook:747-770 只查询原任务及保存，不调用付费提交；图片恢复如何绑定当前输入仍受 D03 限制，此 UI 自身未新增自动重发。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-production-state.test.ts:6-19`：检查点序列化和暂停，不是完整 UI 测试。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4518`，记载 2 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-production-image.test.ts:8-39`：原任务查询/保存恢复，不重发。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7978`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/drama/drama-readiness.tsx`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`fe833fcc09fec2468f44147fa384550c7e69868b`
- sourceCommit：`e04700bd51ee618aa70c3701dd6190384eaaf63f`
- 引入提交：`e04700bd51ee618aa70c3701dd6190384eaaf63f`
- 实际变化：新增镜头、徽章、整集就绪展示，复用纯检查函数并提供跳转。
- 已读位置：11-20 检查来源；73-100 整集缺口展示。
- 风险/边界：只展示，最终阻断依赖生产 hook/成片模块；零镜头会显示所有镜头就绪，不能把这句 UI 当成可渲染证据。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-readiness.test.ts:30-73`：必填/建议、时长比例、配音陈旧、任务编号。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17348`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/components/drama-final-currency.test.tsx:44-52`：过期选用视频阻断渲染。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231934.log:7363`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/drama/drama-shot-language.tsx`

- 判定：**hold**；阻断：是。
- currentBlob：`2a3462bfd8acf6b6dedac443bf3a19853db0fb17`
- sourceCommit：`3ce1e75ea3ce7fe1546258beedb2596019b32a76`
- 引入提交：`9c8249e9fef309b55152060ce412160ef80456b0`
- 实际变化：新增镜头语言编辑和通过所选剧本文档调用润色、撤回的 hook。
- 已读位置：31-49 异步润色后直接覆盖 shotId 对应字段；58-64 撤回仅恢复提交时字段快照；95-112 手动编辑字段。
- 风险/边界：D04：等待模型时手动编辑仍可进行；回包只检查 abort、不比较输入，旧响应会覆盖新描述/运镜。现有 parser/route 测试没有覆盖这种并发编辑。
- 判定理由：润色迟到响应会覆盖等待期间的手动编辑
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-engine.test.ts:234-257`：镜头语言拼接、润色消息和解析。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8826`，记载 23 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/api/drama-plan-estimate-route.test.ts:79-94`：润色正常/坏 JSON/镜头不存在，无 UI 时序用例。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17175`，记载 8 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/drama/drama-source-form.tsx`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`1c8aa16ae0c0903dc20285579c566ca0a38e99cc`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增独立已有剧本入口，预览后显式保存；输入变化作废预览、超时取消、未知保存结果引导列表核对。
- 已读位置：18-27 预览契约校验；55-87 取消/超时/过期响应保护；122-137 未确认保存禁止重复；192-215 显式预览和创建。
- 风险/边界：本文件不调用 AI 模型和计费；saveUnknown 阻止表单内自动重复保存。真实数据库创建未执行。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/components/drama-source-workflow.test.tsx:74-225`：输入作废、迟到响应、取消、超时、保存双击/不明结果。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:1129`，记载 18 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/api/drama-import-script-route.test.ts:15-35`：预览不保存/不调用模型。
    未在已读原始日志定位到该测试文件的成功执行记录。

### `src/components/drama/drama-task-panel.tsx`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`d41ad072a2e4d0e979b4d9b6af4dc1bb97709730`
- sourceCommit：`9a8a194b60573187a648bfa1a457e0da19383827`
- 引入提交：`e04700bd51ee618aa70c3701dd6190384eaaf63f`
- 实际变化：新增任务列表、点击定位、Esc/外点关闭；后续提交将 status live region 放到按钮外恢复可访问名称。
- 已读位置：13-24 任务集合与事件清理；29-43 accessible name、只跳转不生成。
- 风险/边界：显示临时工作集合，不是数据库权威任务账单；重开恢复状态由 production-status 提供。未发现虚假 completed。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-readiness.test.ts:60-73`：任务名称、镜头定位、渲染进度、空态。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17348`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/drama/drama-voice-sample.tsx`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`56552083f04d3d49a87126d0dcf766afca164e58`
- sourceCommit：`407366818ef101b7fecc9dde5b122d0aac9f4174`
- 引入提交：`523c66ab1e3230dc38fe70c83025789e7c3715f2`
- 实际变化：新增角色音频上传/替换/移除、时长预览，以及每镜头参考音频使用条件说明。
- 已读位置：19-29 上传错误明确提示；68-89 根据能力/说话者/图像条件决定样本说明。
- 风险/边界：只保存真实上传返回值；不支持音频或没有参考图时明确说明。上传过程没有 AbortController，离开页面的晚到更新风险未做运行验证；不据此声称视频供应商已验收。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/api/drama-voice-sample-route.test.ts:38-60`：上传服务契约与 ownerId。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10439`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-engine.test.ts:183-219`：协议音频能力、说话者样本、schema 回环。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8826`，记载 23 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/drama/mention-textarea.tsx`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`7246837e1d736732ca256e9a735215840c051401`
- sourceCommit：`cdc21aba22908f3872bd7eebb467b972cf797b85`
- 引入提交：`cdc21aba22908f3872bd7eebb467b972cf797b85`
- 实际变化：新增角色/道具 @ 补全和键盘选取，选择后仅报告选中候选。
- 已读位置：27-49 激活、插入、按键；54-76 文本和 listbox 展示。
- 风险/边界：不执行模型/网络；渲染普通文本，不注入 HTML。候选插入为程序拼接，可能超过 maxLength，后端 schema 仍会拒绝；未找到直接组件键盘时序测试。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-mentions.test.ts:22-60`：最长名匹配、插入 caret、合并及 prompt 去 @；间接辅助函数测试。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4463`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/components/simple-chat/drama-draft-card.tsx`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`448718d6d5e17b7d1ea0186105637a6d444277a9`
- sourceCommit：`6a72de52cb892aeda4df4c5761bd27de0ab02078`
- 引入提交：`49ad29351ace5a557d3cb31500694b8f11902b34`
- 实际变化：新增已保存短剧草稿卡和携带 projectId/dramaId 的视频工作台链接。
- 已读位置：5-21 纯展示和 platformHref 跳转。
- 风险/边界：草稿已保存文案依赖上游真实返回，组件不会自己校验项目存在；目标 loadDramaProject/store 仍按当前 owner 查询。无生成/退款操作。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/components/drama-draft-card.test.tsx:12-39`：坏草稿拒绝、消息同步、链接指向视频工作台。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:9554`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/access.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`0423807038be3575eb02c72200c11605ecfdee95`
- sourceCommit：`77be21c147abb930831ae85457b8d3ecc2434dc8`
- 引入提交：`77be21c147abb930831ae85457b8d3ecc2434dc8`
- 实际变化：新增视频平台门禁共享函数。
- 已读位置：5-10 platformsForUser 决策 403。
- 风险/边界：仅产品权限，不替代模型授权与 owner 校验；空 productType 沿用既有平台默认许可，属于 platform-routes 契约。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/api/drama-take-receipt-route.test.ts:100-105`：鉴权/视频门禁在读取前。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5540`，记载 28 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/api/drama-import-script-route.test.ts:26-28`：无登录/无视频权限返回。
    未在已读原始日志定位到该测试文件的成功执行记录。

### `src/lib/drama/adapt.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`622d645e66abea9146a5ce49962cdd5a3833b88d`
- sourceCommit：`aa1cb94eece5d2d47fd0ddd152d4560f3ca9aa31`
- 引入提交：`aa1cb94eece5d2d47fd0ddd152d4560f3ca9aa31`
- 实际变化：新增长文切块、逐集 JSON 提示和跨段 cast/location/prop 合并、ID 冲突重命名。
- 已读位置：16-30 分段且不丢尾部；52-74 JSON/沿用人物约束；90-119 合并及场次引用重写。
- 风险/边界：这是结构与提示助手，不是授权层；不提供固定成功数据，解析失败交给 planner/route。首集结果结构需由调用处 parseDramaProject 校验。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-adapt.test.ts:19-55`：段落/句末/短尾、已有实体提示、ID 冲突与引用重写。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10395`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/audio-upload.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`ee2f0a04a23dec0ed3426611760434207244e39f`
- sourceCommit：`b4e06d39b2f03bbb3b146e2c22890a3842f363e6`
- 引入提交：`523c66ab1e3230dc38fe70c83025789e7c3715f2`
- 实际变化：新增内容签名及从 ffprobe 包时间戳计算时长，修复 stdin 无 format duration。
- 已读位置：7-11 MP3/WAV 识别；18-42 pipe 协议白名单、15秒超时、错误返回 null。
- 风险/边界：固定程序和固定参数、只喂 stdin；无文件路径或网络下载 fallback。ffprobe 不可用时 fail-closed。未执行二进制。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-audio-upload.test.ts:17-27`：条件执行的真实 MP3/WAV 时长及无效数据；源码已读，本次未跑。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232176.log:6554`，记载 1 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6532`，记载 1 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/autopilot.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`e521408fc9bc7203792c779c70e4044eb7a5986c`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`95463b354695de31a1703a9e2d522634bddf954f`
- 实际变化：新增分阶段缺口计划、报价汇总、剩余工作覆盖与完成计数；使用版本有效的视频/配音。
- 已读位置：39-63 真实缺口；107-140 缺价为 undefined、版本和集合覆盖。
- 风险/边界：withinQuote 在提供 snapshot 时精确比较；legacy quote 无 snapshot 仅集合覆盖。待估价 pending:* 图仅在 hook:592-618 构造估价输入，未作为真实图片结果写入。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-autopilot.test.ts:41-97`：仅当前集缺口、不能图生视频则不买关键帧、计价/报价覆盖。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232259.log:5359`，记载 6 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5319`，记载 6 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-production-version.test.ts:317-349`：报价完整模型/输入绑定及生成进度。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:16750`，记载 80 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/bible-images.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`5b67cd6149f78b2cd72ba615de871abf5c0b23e2`
- sourceCommit：`29d5a43f41ab2948c21ba0b0461cb9bb1eddf871`
- 引入提交：`fc8d09907cfe3a5bb1a58499b677a7447283f1b5`
- 实际变化：新增四视角设定图与每槽历史、恢复历史时交换当前图并保持既有锁图。
- 已读位置：21-39 字段读取和旧别名；42-63 替换、去重、8张历史上限。
- 风险/边界：锁图保持原引用是明确行为；历史可能淘汰最早版本，非任务回执；不生成占位数据。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-bible-images.test.ts:22-61`：历史顺序、锁不变、恢复、去重/上限、schema 回环。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232176.log:6497`，记载 6 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6475`，记载 6 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-cast-views.test.ts:30-57`：四视角各自历史、导出和参考图顺序。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5581`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/chat-handoff.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`9eb417715dfb18c724ac327f32ee9ae54792ce6f`
- sourceCommit：`3b6dc57ecdf9cdae70a9a7e12f53d08b9ca8793c`
- 引入提交：`6a72de52cb892aeda4df4c5761bd27de0ab02078`
- 实际变化：新增以原剧本拼接 Markdown、带回跳 ID 的单次聊天交接，限制长度/10分钟有效期。
- 已读位置：22-61 明确截断提示；64-88 单次消费及严格 ID 校验。
- 风险/边界：调用方用 sessionStorage（simple-chat/page.tsx:392）；内容截断有明确标记。交接本身不是项目授权，回跳依赖 owner-scoped 读取；无后台自动回写。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-chat-handoff.test.ts:44-92`：集号、场景、长文提示、单次消费、过期/错误拒绝。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232176.log:6496`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6474`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/export-client.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`fa81de457ee1c53b35fe61a1452ed036caa1b242`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`09994ef5273f82dd2ad14a3e4fa8b0b0244560fa`
- 实际变化：新增单集包并扩展整项目 selected/history 包；限制每文件/总字节、流式下载、缺失清单、显式完整性、用户浏览器侧生成。
- 已读位置：35-65 实际流上限；69-130 整项目缺失声明；147-197 单集缺失兼容。
- 风险/边界：complete 代表引用已取回，不证明媒体可解码/当前版本；单集包允许不完整但明确列 missing，与整项目严格导入不同。没有服务端任意 URL 下载。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-project-archive.test.ts:153-196`：危险URL/缺失报告、流上限、单集兼容。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7341`，记载 21 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-export.test.ts:51-61`：缺少下载保留清单。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4456`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/export.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`b3fe355787c5993f933809b5c4b748f46d29e3b3`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`09994ef5273f82dd2ad14a3e4fa8b0b0244560fa`
- 实际变化：新增 SRT/CSV/素材清单，扩展整项目素材引用。
- 已读位置：9-32 文件名与 CSV 公式防护；36-55 镜头表；65-118 单集/项目素材收集。
- 风险/边界：导出使用 activeTake/currentVoiceover 保留选用素材，未按完整快照过滤过期媒体；属于归档而非当前有效性证明，调用方不得据此盖成片就绪章。缺失单集/字幕返回空。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-export.test.ts:30-48`：字幕、CSV 防公式、转义、媒体去重、文件名。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4456`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-project-archive.test.ts:49-61`：历史保留与任务句柄移除。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7341`，记载 21 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/import-client.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`47e3c670df3ab0d49d16d8da64d00b3a4cdd08f2`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`26e8815f3f6effc6f6285e7e05ca41f07cdd17af`
- 实际变化：新增在浏览器把 ZIP 媒体重新上传并创建本人新项目；扩展实际解压预算/路径检查和整项目不完整拒绝。
- 已读位置：60-87 实际解压上限；90-121 目录/清单预检查；123-165 重新上传、失败阻断、去句柄再创建。
- 风险/边界：整项目任何媒体失败不创建；旧单集包继续允许保留原地址并返回 failed，现有测试明确这一兼容行为。后端各上传/项目接口决定 owner。本次不运行上传。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-project-archive.test.ts:198-270`：重新映射、危险路径、伪造解压大小、失败不创建。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7341`，记载 21 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-package.test.ts:105-119`：legacy 部分失败仍建项目并保留原 URL。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:4491`，记载 7 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/library.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`d88154a3e34a0f83cac09f728c44c9140f17da20`
- sourceCommit：`a8a428ef71aca1a795cf00aed6703756eea29dcb`
- 引入提交：`d5d00933ef721cc2b4865f8379996eec3c2808ad`
- 实际变化：新增从已有画布/剧本提取媒体，跳过未保存/恢复中占位，名称与 URL 去重。
- 已读位置：34-52 画布状态过滤；56-84 剧本真实字段；91-104 去重。
- 风险/边界：这些纯函数不提供项目/owner 隔离，依赖上层查询；列出 completed 历史媒体并不表示其输入版本当前有效。storedUrl 接受 // 开头，本文件无服务端取址。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-library.test.ts:29-69`：真实图片/视频、占位/不可用排除、名称优先/去重、chat 引用。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5574`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/mentions.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`3bb084f4b9c69296b6be23ee71e20027b1cb09ca`
- sourceCommit：`cdc21aba22908f3872bd7eebb467b972cf797b85`
- 引入提交：`cdc21aba22908f3872bd7eebb467b972cf797b85`
- 实际变化：新增 @人物/道具解析、最长匹配、保留原关联、补全输入位置。
- 已读位置：23-39 按已知候选解析；54-63 合并不移除；67-85 caret 和插入。
- 风险/边界：未知名称保留 @，没有把未知身份自动变成资产；重名时优先第一个候选，是确定性但非唯一身份的 UX 限制。没有模型权限职责。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-mentions.test.ts:22-60`：最长名、顺序、去 @、不移除旧ID、caret、生成 prompt。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4463`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/package.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`b1993dae1c94a028030fe3cca02d4d6e9d9924c2`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`26e8815f3f6effc6f6285e7e05ca41f07cdd17af`
- 实际变化：新增/扩展制作包契约、逐引用完整性、selected/history 模式、任务句柄剥离、路径验证及 URL remap 后版本重绑定。
- 已读位置：43-85 去任务/保留成品；107-119 路径拒绝；158-187 清单一致性；190-206 只重绑定证明原本 current 的输出。
- 风险/边界：保留历史文件不是伪成功；不完整项目包拒绝，legacy 单集包另有兼容语义。重绑定只比较输入，不能替代文件字节/权限校验；导入上传由服务端独立验证。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-project-archive.test.ts:49-118`：剥离句柄、保留原文/历史、opaque 快照不变当前。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7341`，记载 21 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-project-archive.test.ts:227-270`：路径/缺引用/解压预算/失败不创建。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7341`，记载 21 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-version-boundaries.test.ts:12-20`：current remap 重绑定且 stale history 仍过期。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232259.log:5370`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5330`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/polish.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`231f34012c87969edbddf6f16bcf096cffc0c7f8`
- sourceCommit：`9c8249e9fef309b55152060ce412160ef80456b0`
- 引入提交：`9c8249e9fef309b55152060ce412160ef80456b0`
- 实际变化：新增单镜头导演润色消息和 JSON 结果解析。
- 已读位置：34-56 必须找到真实镜头；66-81 无有效 prompt 抛可重试错误。
- 风险/边界：不使用原文/固定示例冒充结果；模型 shotSize/cameraMotion 只截断未枚举校验，UI 保留额外值，可能降低质量但不是模型授权 fallback。并发覆盖问题在 D04 的客户端。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-engine.test.ts:244-257`：上下文消息及坏 JSON 拒绝。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8826`，记载 23 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/api/drama-plan-estimate-route.test.ts:79-94`：正常润色、无 prompt 502、无镜头400。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17175`，记载 8 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/production-image-client.ts`

- 判定：**hold**；阻断：是。
- currentBlob：`93e51542c77a7d003cd2bd21d4036cdec927ecfe`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增提交前持久化图片操作、精确 provider::model 请求，未知结果保留原操作；原回执查询与产物保存分阶段。
- 已读位置：18-61 原回执恢复/轮询/保存；64-94 durable checkpoint、幂等 key、单次提交。
- 风险/边界：D03：付费请求的 prompt/aspectRatio/references 没有进入 persisted operation，无法在重开恢复时证明结果仍对应当前输入；已保存旧结果可按 entityId 直接覆盖当前槽。正确的不重发机制不能解决输入版本丢失。
- 判定理由：恢复图片回执缺少原始输入版本，可能覆盖新编辑
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-production-image.test.ts:8-39`：超时、停止、持久化失败不提交、产物保存恢复、未知不重发；无输入变更恢复测试。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7978`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/production-state.ts`

- 判定：**hold**；阻断：是。
- currentBlob：`6791991178b6a524629f9987bbb17fb5548f6255`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增持久化制作阶段、图片操作 schema、未结回执集合及500上限不驱逐原回执。
- 已读位置：5-20 checkpoint/image schema；27-36 保留未结回执。
- 风险/边界：D03：schema 只有模型与 target 等身份，没有图片生成输入/版本绑定。既有 stored/applied 布尔值无法区分结果过时或用户已另选图片。
- 判定理由：恢复图片回执缺少原始输入版本，可能覆盖新编辑
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-production-state.test.ts:6-19`：序列化、保留 sourceURL、暂停阶段；没有过期输入/晚到覆盖契约。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4518`，记载 2 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/production-version.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`6713644b062c677792c30197de123717413c0591`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增 canonical SHA-256 输入版本，覆盖模型/脚本/镜头/图像/声音/前镜头依赖、成片/报价版本、导入重绑定。
- 已读位置：101-153 实际镜头/声音输入；156-180 选中 take 和旧数据兼容；198-264 成片/报价；267-283 重绑定。
- 风险/边界：新快照严格比较且过期选中 take 不偷换历史；无快照 legacy 仍可 current 是现有明确兼容测试，不能证明旧媒体与当前参数一致。此例外已记录，不当成执行通过或安全证明。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-production-version.test.ts:185-226`：新输入变更失效、保留历史、legacy 与 sourceChanged。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:16750`，记载 80 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-production-version.test.ts:317-403`：报价完整输入与过期视频/音色阻断。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:16750`，记载 80 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-version-boundaries.test.ts:12-51`：重绑定、追加正文、前镜头、长度上限、旧可选字段。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232259.log:5370`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5330`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/readiness.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`32cccfb0aedb99eb6828217a6500d27931d934fd`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`e04700bd51ee618aa70c3701dd6190384eaaf63f`
- 实际变化：新增镜头模型/提示/时长/比例/参考图/当前 take/声音的检查及编号。
- 已读位置：40-86 真实数据和能力检查；97-114 汇总和标签。
- 风险/边界：duration/ratio/ref/voiceover 是建议，video/model/prompt 必须；显式 still 是用户选择的图动效，非失败时假视频 fallback。授权依赖目录和服务端，本文件不自行选供应商。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-readiness.test.ts:30-73`：必需项、仅警告项、能力、时长、声音、任务标签。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17348`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-production-version.test.ts:364-403`：不使用过期前镜头、stale selected video 不 ready。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:16750`，记载 80 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/receipt-client.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`7866483f6880e3be12a27f2fda428f502c5790ff`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增仅按原 shot/take/model/provider 查询回执，精确解开 catalog 前缀，独立标记生成/取回/积分状态。
- 已读位置：4-14 refunded 与未知提交区分；38-63 固定原身份，不重发；64-88 完成缺产物/失败/超时分离。
- 风险/边界：不凭本地退款推断上游未接收；正常失败允许上层处理，未知保持 submitted/retryable false；未实现或调用自动退款。错误模式识别仍依赖服务端错误文本，实际供应商异常未执行。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-shot-receipt-recovery.test.ts:87-166`：错供应商拒绝、固定原身份、已知任务不 fetch、未知不重发、完成无产物区分。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232176.log:6300`，记载 20 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6277`，记载 20 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/api/drama-take-receipt-route.test.ts:36-46`：退款仍 pending 和返回白名单。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5540`，记载 28 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/script-file.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`72aa884d720da62ffc5df8ed1b76e0a8b4020f8c`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增 UTF-8 TXT 和 DOCX 受限读取；先检查 ZIP 头/路径/条目/大小/重叠/加密/ZIP64 并实际受限解压，再由 mammoth 取纯文本。
- 已读位置：26-88 预检查和 native inflate cap；91-120 文件类型/UTF8/内容上限。
- 风险/边界：不用解压目录或远端读取；DOCX 警告展示，失败抛错误不返回演示内容。运行时 mammoth/zip/真实攻击样本本次未执行。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-script-file.test.ts:1-60`：测试源码含 UTF8/DOCX 及 forged size/ZIP64/path 边界；仅只读源码证据。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231934.log:7235`，记载 10 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/shot-language.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`c613e1366e461013631dae60657890a1d23ea350`
- sourceCommit：`9c8249e9fef309b55152060ce412160ef80456b0`
- 引入提交：`9c8249e9fef309b55152060ce412160ef80456b0`
- 实际变化：新增景别/运镜表与真实被选择字段的 prompt 文本，排除旧默认占位 medium/static。
- 已读位置：9-24 占位过滤与正文拼接。
- 风险/边界：明确占位值不会当用户意图发出；其他自定义值保留，没有固定镜头结果冒充成功。不处理授权/计费。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-engine.test.ts:234-257`：已选镜头语言顺序与占位过滤、润色结果。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8826`，记载 23 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/source-script.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`27f060e2751fc089bf70fb0077692e25840466b5`
- sourceCommit：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 引入提交：`4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`
- 实际变化：新增确定性剧本源解析、UTF16 range、角色/台词提取及单集重解析/旧素材归档。
- 已读位置：44-54 上限和空输入；72-139 原文场次/台词位置；156-180 原文保留；184-227 一对一场次复核及过期标记。
- 风险/边界：不编造外貌或镜头；不明确结构发 warning，删除场次素材保留归档不并入当前成片。规则解析有歧义，需人工复核，非模型失败 fallback。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-source-script.test.ts:1-126`：源文本、偏移、分集/分场、重解析与归档测试源码。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232259.log:5296`，记载 8 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5256`，记载 8 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-source-review-boundaries.test.ts:8-30`：移除角色仍保留对白身份、手动摘要/静默角色保持、过长对白不能截断成功。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:9548`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/task-list.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`4127a2a2bb6195d027d7505e9ca1ba8ae6c06c5a`
- sourceCommit：`e04700bd51ee618aa70c3701dd6190384eaaf63f`
- 引入提交：`e04700bd51ee618aa70c3701dd6190384eaaf63f`
- 实际变化：新增把正在运行镜头/关键帧/配音/渲染集合整理为可定位列表。
- 已读位置：25-37 仅消费现有 sources，无请求和终态推断。
- 风险/边界：不应当作权威积分流水或 durable 回执列表；没有任务时返回空。找不到镜头明确标已删除。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-readiness.test.ts:60-73`：编号、尾帧、删除镜头、渲染进度与空列表。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17348`，记载 4 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/drama/voiceover.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`34c7392b8497f0576c66be4ebbf5bc02e713e6fa`
- sourceCommit：`233c5e905f2551737283b9556e6701daa5461be8`
- 引入提交：`233c5e905f2551737283b9556e6701daa5461be8`
- 实际变化：新增说话者/音色默认、按台词判定旧配音有效的纯函数。
- 已读位置：16-28 speaker/voice 默认与旧文本判定。
- 风险/边界：首出场角色/alloy 是明确声音默认，不是生成模型 fallback；currentVoiceover 仅比较文本，完整新输入有效性另在 production-version.isVoiceoverCurrent，导出仍保留旧素材。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-voiceover.test.ts:31-87`：默认/指定说话者、旧台词失效、audio 请求与403。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7947`，记载 6 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-production-version.test.ts:229-258`：完整音色/样本快照与旧文本兼容。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:16750`，记载 80 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/simple-chat-drama-draft.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`65712e2899d99f4dd4a7ea791a3222e6f3c7e382`
- sourceCommit：`49ad29351ace5a557d3cb31500694b8f11902b34`
- 引入提交：`49ad29351ace5a557d3cb31500694b8f11902b34`
- 实际变化：新增聊天草稿卡的严格轻量元数据读取。
- 已读位置：14-21 严格 ID、长度和类型。
- 风险/边界：只验证形状，不凭 dramaId 存在断言 owner；真实访问需目标接口校验。标题上限120小于剧本文档200，超长有效草稿可能不显示卡片，属兼容风险。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/components/drama-draft-card.test.tsx:12-39`：非法ID/空标题/错误对象拒绝及链接。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:9554`，记载 3 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/video-director/index.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`null — HEAD 已删除`
- sourceCommit：`9c8249e9fef309b55152060ce412160ef80456b0`
- 引入提交：`dc5983d916fa61cfe44bd827fd2636cc61b8117a`
- 删除前 blob：`6ec92951c7a89d83d3ebefd37cb8df409ab49f8e`（只作删除 diff 证据）。
- 实际变化：删除旧导演模块聚合导出，保留被使用的具体 prompt-compiler/director-styles 模块。
- 已读位置：删除提交 9c8249e9fef309b55152060ce412160ef80456b0 的完整删除 diff 已读；HEAD 中不存在，currentBlob=null；已搜索 src/tests 无目标导入残留。
- 风险/边界：不能把不存在文件填旧 blob 放行；需在外部 Stage0 路径保护中按真实迁移评审，此处不修改基线。仅确认本路径删除及新 drama 依赖上下文，未审批 other 组入口。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-engine.test.ts:116-294`：新的参考图/音频/镜头语言参数路径。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8826`，记载 23 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-mentions.test.ts:52-60`：生成请求明确去 @。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4463`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/video-director/model-capabilities.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`null — HEAD 已删除`
- sourceCommit：`9c8249e9fef309b55152060ce412160ef80456b0`
- 引入提交：`dc5983d916fa61cfe44bd827fd2636cc61b8117a`
- 删除前 blob：`5147db1bad7867d1b31e2c9dcbbd800c389f3d2f`（只作删除 diff 证据）。
- 实际变化：删除旧协议级静态导演能力默认表及兼容导出，视频制作改走 drama shot-runner 的模型能力。
- 已读位置：删除提交 9c8249e9fef309b55152060ce412160ef80456b0 的完整删除 diff 已读；HEAD 中不存在，currentBlob=null；已搜索 src/tests 无目标导入残留。
- 风险/边界：不能把不存在文件填旧 blob 放行；需在外部 Stage0 路径保护中按真实迁移评审，此处不修改基线。仅确认本路径删除及新 drama 依赖上下文，未审批 other 组入口。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-engine.test.ts:116-294`：新的参考图/音频/镜头语言参数路径。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8826`，记载 23 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-mentions.test.ts:52-60`：生成请求明确去 @。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4463`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/video-director/reference-binding.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`null — HEAD 已删除`
- sourceCommit：`9c8249e9fef309b55152060ce412160ef80456b0`
- 引入提交：`dc5983d916fa61cfe44bd827fd2636cc61b8117a`
- 删除前 blob：`fa19c94c6a33b5392346d6a2ff083dcbf3373231`（只作删除 diff 证据）。
- 实际变化：删除旧 reference-binding 兼容再导出及参考文本拼接助手，保留具体 prompt-compiler 引用类型。
- 已读位置：删除提交 9c8249e9fef309b55152060ce412160ef80456b0 的完整删除 diff 已读；HEAD 中不存在，currentBlob=null；已搜索 src/tests 无目标导入残留。
- 风险/边界：不能把不存在文件填旧 blob 放行；需在外部 Stage0 路径保护中按真实迁移评审，此处不修改基线。仅确认本路径删除及新 drama 依赖上下文，未审批 other 组入口。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/drama-engine.test.ts:116-294`：新的参考图/音频/镜头语言参数路径。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8826`，记载 23 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-mentions.test.ts:52-60`：生成请求明确去 @。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4463`，记载 5 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/video-reference-audio.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`99be33fe8ab06a6bf7a5b6163618172be59c057a`
- sourceCommit：`523c66ab1e3230dc38fe70c83025789e7c3715f2`
- 引入提交：`523c66ab1e3230dc38fe70c83025789e7c3715f2`
- 实际变化：新增按已知视频协议+精确模型标识给参考音频数量，未知组合为0。
- 已读位置：10-24 大小/时长常量及协议白名单。
- 风险/边界：这里只做能力识别，trim/lowercase 不是授权；实际 provider/model 授权在视频接口，referenceAudios 先能力校验再按 auth.userId 转供应商 URL（video/generate:385-474）。未联系供应商验证在线规格。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/video-reference-audio.test.ts:28-98`：未知协议/型号拒绝、Pear/APIMart 数量及图音互斥、签名owner/过期。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279411-136721232176.log:6493`，记载 8 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6471`，记载 8 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。
  - `src/__tests__/lib/drama-engine.test.ts:183-219`：说话者音频和请求图参考。
    历史原始日志：`output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8826`，记载 23 tests，commit `26e021b97bfd92d36210e287ad71f363ff51abb9`；不作为当前 HEAD 通过结论。

### `src/lib/video-task-polling.ts`

- 判定：**reviewed-no-blocker**；阻断：否（限静态评审）。
- currentBlob：`1e97dd85a14436634c95c84a9edc90ac8da862b7`
- sourceCommit：`e56358e6f894c2d7003bb1e16425cb9edac5a155`
- 引入提交：`dc5983d916fa61cfe44bd827fd2636cc61b8117a`
- 实际变化：保留400次/20分钟轮询上限，新增稳定标签替换尾部状态避免无限累加。
- 已读位置：1-9 达上限的纯判定；12-21 保留前缀重建状态。
- 风险/边界：只给轮询/文案边界，不改任务失败/退款；未发现调用本助手即把超时伪装完成。未在现有日志定位到该测试文件，不能称已执行。
- 判定理由：已读本路径具体源码/删除 diff 与相关调用/测试证据，未发现本路径新增阻断；仅静态评审，不是运行验收、测试通过或精确 allowlist 写入。
- 现有测试证据（**本次均未运行**）：
  - `src/__tests__/lib/video-task-polling.test.ts:10-26`：399/400次、20分钟阈值、重复轮询标签不增长。
    未在已读原始日志定位到该测试文件的成功执行记录。

## 收尾核验

- HEAD 未变：`29f7e2df5cb53619c2f5401fa587fbea7882b079`；47 项互不重复且与 other 无重叠。
- drama 范围工作树与固定 HEAD 无差异，44 项当前 blob 匹配；3 项为真实删除。
- 两个输出路径经 git check-ignore 确认 ignored；不改 allowlist/Stage0 基线，不因静态未发现阻断自动授权。
- 仅核验记录完整性与文件身份；没有跑测试，不能声明测试通过。
