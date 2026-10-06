# 工作流图像编辑节点合同实施计划

**2026-10-02 节点 Skill 模型授权接缝（统一运行内核局部，非 Task C/D 关闭）：** 真实工作流启动在缺少 image 模型角色、或该角色提供商不属于本人授权时仍创建父任务的两例先 RED（均返回 200）；启动前现复用 Skill Run 的完整角色和模型能力授权，把规范 `providerId/modelId` 写入父执行图，无法授权则 422 且零父任务/外部请求。为免完整 Skill 请求模块扩大全站 NFT，把共同授权提为轻量模块；第一次构建审计曾退化到 84 宽、586825 引用，最终源码构建 exit0/121 页，严格 NFT exit1 但回到 83 宽／24 配置／24 根文档／582984 引用，保护基线仍 exit1 且新增模块令 BLOCK 由 28 增至 29。最终源码隔离真库工作流 39/39、Skill 授权单测 44/44、相邻工作流路由 59/59、TypeScript/目标 ESLint 通过；测试库 `0|0|0` 后停止。仅防止新父任务带未授权 Skill 模型进入执行；服务端版本化 Skill 定义/复杂媒体不可变快照、工作流编辑 Task C/D、三工作区读回、全站/正确预览/真实付费与发布仍开放，不扩保护许可、不提交/推送/部署。Pear 排除、PSD 核心保留。

**2026-10-02 媒体预备后撤权竞态接续（Task D 局部，未关闭）：** 原隔离真 PostgreSQL 竞态用例加入第三种顺序：已接受供应商结果并准备公开媒体、发布事务未锁原任务前撤销编辑权。结算为 `denied`、原任务 `failed/refunded`、唯一消费/退款、零输出且所有权预备媒体已清；先前取消及删除失败两轮仍保留。六份相关文件同次 **78/78**、TypeScript 和目标 ESLint exit0；本轮仅测试变更，不重跑构建/NFT/保护基线，沿用上轮红灯。私有 `media/<taskId>/<slot>-<sha>` 在不可变清单之前写入；并发接受者可能在本次清单写失败时使用同一媒体，因此不能直接删除本次创建对象。安全 GC 仍须以任务终态、并发接受栅栏和精确对象身份另立合同，不以这轮撤权测试关闭无清单孤儿。专用库 `0|0|0` 后停止 55492；相反锁顺序、真实多实例/杀进程、全站/正确预览/真实付费及发布开放。仅本地脏 `main`，无提交／推送／Coze／部署，`stable` 未动，Pear 排除、PSD 保留。

**2026-10-02 预备媒体删除失败持久重试接续（Task D 局部，未关闭）：** 将原真库“预备后取消”用例在相同权威任务/来源/接受结果下运行两轮：正常清理，以及 S3 精确导出键删除失败。后者在真实取消终态、零输出时保留 S3 对象，`wujie_asset_cleanup_outbox` 持久 `pending`；恢复受控 S3 后 drain 标记 `completed` 并删除无引用对象，本地预备文件已经按所有权删除。再为已发布版本写入迟到清理记录，outbox drain 因资产版本引用保留对象。初次测试夹具因非十六进制摘要失败，修正后定向与六份相关文件同次 **78/78**；TypeScript、目标 ESLint exit0。仅测试增强、无产品源码变更；本轮不重跑构建/NFT/保护基线，继续沿用上轮门禁红灯。专用库 `0|0|0` 后停止 55492。S3 与 outbox 同时不可用仍无法保证持久清理，私有接受媒体无清单孤儿、真实跨实例/杀进程、全站/正确预览/真实付费与发布也开放；仅本地脏 `main`，无提交／推送／Coze／部署，`stable` 未动，Pear 排除、PSD 保留。

**2026-10-02 未发布预备媒体所有权清理接续（Task D 局部，未关闭）：** 原接受结果取消竞态再加入“受管 `exports` 文件已预备、发布写事务尚未拿任务锁”顺序；真 PostgreSQL 先 RED 证实真实取消后任务终态且输出为零，但新 S3 对象仍残留。`settleAcceptedWorkflowEditTask` 现对确认未提交引用的预备文件调用 `PersistedAssetFile.cleanup()`；准备失败和发布 COMMIT 前失败同样清理，成功发布 COMMIT 一经发出则保留文件等待权威读回，避免未知回执误删。原竞态 GREEN；最终 COMMIT 已生效但回执丢失用例另断言受管 S3 与本地文件仍存在，定向 1/1。产品变更后五份相关文件同次 **60/60**，TypeScript、目标 ESLint exit0；生产构建 exit0、121/121 页、41 条警告。严格 NFT exit1（235 路由／83 宽／24 含配置／24 含根文档／582918 引用），保护基线 exit1（38 身份保留、28 未批准路径）；专用库 `0|0|0` 后停止 55492。清理失败虽沿用现有 outbox 记录和诊断日志，本轮**未验证**该失败的持久重试；私有接受媒体无清单孤儿、未知 COMMIT 长时失联、真实多实例/杀进程、全站/正确预览/真实付费及发布也未关闭。仅本地脏 `main`，无提交／推送／Coze／部署，`stable` 未动，Pear 排除、PSD 保留。

**2026-10-02 接受结果与取消竞态接续（Task D 局部，未关闭）：** 隔离真 PostgreSQL 新增真实取消路由竞态用例，覆盖取消先赢时 `cancelled/refunded`、一次退款、无输出且迟到完成不复活，以及完成事务先持锁时取消须等其提交并返回 409、`completed/charged`、唯一输出。初版夹具错误监听 `client.query` 导致超时，改为监听取消路由使用的 `pool.query`，并用 taskId 限定屏障；这不是产品缺陷修复。来源真库 14/14，来源及四份相邻文件同次 **60/60**，TypeScript 和目标 ESLint exit0；本轮没有产品源码变更，未重跑构建/NFT/保护基线/预览，沿用此前 NFT 与保护基线红灯。失败夹具留下的两个精确测试 schema 已核名删除，隔离库 test schema／public 表／其他会话 `0|0|0` 后停止 55492。真实多实例／杀进程、撤权与取消交错、孤儿媒体、全站／正确预览／真实付费及发布仍开放。仅本地脏 `main`，无提交／推送／Coze／部署；`stable` 未动，Pear 排除、PSD 保留。

> 本轮校验口径：相关源码、测试、迁移及本计划仍是未跟踪文件；`git diff --check` 的 exit0 不覆盖它们。已另用目标 ESLint 与逐文件尾随空白扫描核对，完整 Git 保护许可仍为 BLOCK。

**2026-10-02 拒收标记 COMMIT 回执丢失接续（Task D 局部，未关闭）：** 将上一轮真库用例拆为两个独立故障：退款 COMMIT 生效前失败，以及拒收标记 COMMIT 已生效但回执丢失。后一场景先 RED 发现原连接被回滚后仍以可复用方式归还连接池；现发出 COMMIT 后若回执不确定即丢弃原连接，保持首调 `pending`，由新连接轮询读回原标记、核私有接受清单明确不存在后按同一原任务失败并只退款一次。两例定向 RED→GREEN；来源真库及相邻四文件同次 **68/68**，TypeScript、目标 ESLint、逐文件尾随空白扫描通过；生产构建 exit0、121/121 页、44 条追踪警告。严格 NFT exit1（235 路由／83 宽／24 配置／24 根文档／582918 引用），保护基线 exit1（38 身份保留、28 未批准路径）。隔离库 test schema／public 表／其他会话 `0|0|0` 后停止 55492。仅证明同进程故障注入及内存清空；拒收标记写入或 COMMIT 生效前失败、真实杀进程／多实例、接受／拒收与取消竞态、孤儿媒体、全站／正确预览／真实付费及发布仍开放。仅本地脏 `main`，无提交／推送／Coze／部署，`stable` 未动；Pear 排除、PSD 核心保留。

**2026-10-02 拒收退款提交前失败的持久接续（Task D 局部，未关闭）：** 隔离真 PostgreSQL＋真实 `/api/poll-task` 先 RED：无效供应商图片的退款 `COMMIT` 在生效前失败，清空进程内编辑状态后，已收费原任务仍 `processing`。现先将只允许 `WORKFLOW_EDIT_ACCEPTANCE_REJECTED` 的拒收意图持久写入原工作流编辑意图行，再尝试原任务原子退款；轮询只在冻结身份匹配且私有接受清单明确不存在时重试。故障首次返回 `pending`，随后轮询 HTTP 200 `failed`、唯一退款、零输出，重复完成 `terminal`；S3 读取不确定仍待核对。定向 RED→GREEN，最终来源真库与四份相邻文件同次 **67/67**，TypeScript、目标 ESLint、限定 diff check 通过；生产构建 exit0、121/121 页、40 条追踪警告。严格 NFT exit1（235 路由／83 宽／24 配置／24 根文档／582918 引用），保护基线 exit1（38 身份保留、28 未批准路径，含本轮迁移）。只验证同进程清空内存的真库故障注入；拒收标记本身写入／回执失败、真实杀进程与多实例、接受／拒收并发、取消竞态、孤儿媒体、全站／正确预览／真实付费与发布均开放。仅本地脏 `main`，无提交／推送／Coze／部署，`stable` 未动；Pear 排除、PSD 核心保留。

**2026-10-02 无接受清单退款终态 COMMIT 回执丢失接续（Task C/D 局部，未关闭）：** 隔离真 PostgreSQL 对私有媒体写入失败、清单明确不存在的原收费编辑任务注入“退款 COMMIT 已生效但客户端回执丢失”，先 RED 见首次误回 `pending`；现释放不可信连接，以新连接按冻结身份、`WORKFLOW_EDIT_ACCEPTANCE_REJECTED`、`failed/refunded` 和零输出检查点核实，只有一致才回 `rejected`，重复完成仍不二次退款。定向 RED→GREEN；来源真库及四份相邻文件同次 **67/67**，TypeScript、目标 ESLint、限定 diff check 通过；最终源码生产构建 exit0、121/121 页、40 条追踪警告。严格 NFT exit1（235 路由／83 宽／24 配置／24 根文档／582893 引用），保护基线 exit1（38 身份保留、27 未批准路径）。这只覆盖 COMMIT 已生效但回执丢失的本地注入；提交前失败、真实断线／多实例、取消竞态、孤儿媒体、全站／正确预览／真实付费及发布仍开放。仅本地脏 `main`，无提交／推送／Coze／部署，`stable` 未动；Pear 排除、PSD 核心保留。

**2026-10-02 撤权退款终态 COMMIT 回执丢失接续（Task C/D 局部，未关闭）：** 隔离真 PostgreSQL 先 RED 复现：来源撤权后，接受的供应商结果在原任务上完成 `failed/refunded` 提交，但回执丢失时首次结算误回 `pending`。现释放旧连接，按冻结任务身份、预期撤权错误、已退款状态和零输出检查点读回；只有一致时回 `denied`，不再次退款。定向 RED→GREEN；来源真库及相邻四文件同次 **63/63**，TypeScript、目标 ESLint、限定 diff check 通过；最终源码生产构建 exit0、121/121 页、42 条追踪警告。严格 NFT exit1（235 路由／83 宽／24 配置／24 根文档／582893 引用），保护基线 exit1（38 身份保留、27 未批准路径）。隔离库 test schema／public 表／其他会话 `0|0|0` 后停止 55492。**未覆盖**无接受清单时独立退款路径的未知回执、提交前失败、真实断线／跨实例、取消竞态、孤儿媒体和全站／正确预览／真实付费。仅本地脏 `main`，未提交／推送／Coze／部署，`stable` 未动。

**2026-10-02 输出终态 COMMIT 回执丢失接续（Task C/D 局部，未关闭）：** 隔离真 PostgreSQL 在写 `workflow-output` 检查点后让最终 `COMMIT` 实际成功、再丢失客户端回执，先 RED 见服务误回 `pending`；现释放不可信连接，以新连接按原 taskId、冻结来源和全部受管输出读回，只有检查点与完成状态一致才回 `completed`，否则仍待核对。定向 RED→GREEN 后，来源真库与相邻四文件同次 **62/62**，TypeScript、目标 ESLint、限定 diff check 通过；最终源码生产构建 exit0、121/121 页、42 条追踪警告。严格 NFT exit1（235 路由／83 宽／24 配置／24 根文档／582893 引用），保护基线 exit1（38 身份保留、27 未批准路径）。专用库 test schema／public 表／其他会话 `0|0|0` 后停止 55492。**仅覆盖 COMMIT 已生效但回执丢失的本地注入**；提交前失败、退款终态回执丢失、真实断线/另一实例、取消撤权竞态、孤儿媒体和全站／正确预览／真实付费仍未验证。仅本地脏 `main`，无提交／推送／Coze／部署，`stable` 未动。

**2026-10-02 接受失败退款接续（Task D 局部，未关闭）：** 隔离真 PostgreSQL 新增两条 RED→GREEN：供应商返回伪图片，以及私有媒体写入失败且受控 S3 明确无接受清单。原行为均在来源仍有效时保持 `processing/charged`；现先查同 taskId 的已接受清单，若存在则按原结果恢复，若明确不存在则同事务失败并退款一次；清单读取不确定时仍待核对，不据此退款。直接/远端调用者区分“来源失效”和“结果不可接受”的错误。当前来源真库与相邻 4 文件同次 **61/61**，TypeScript、目标 ESLint、限定 diff check 通过；生产构建 exit0、121/121 页、39 条追踪警告。严格 NFT 仍 exit1（235 路由／83 宽／24 配置／24 根文档／582893 引用），保护基线 exit1（38 身份保留、27 未批准路径）。专用库确认 test schema／public 表／其他连接 `0|0|0` 后停止 55492。**未证明**私有清单写入回执未知、S3 读不可用后的自动终态、取消撤权并发、输出事务未知 COMMIT、孤儿媒体清理、真实多实例与杀进程、全站／正确预览／真实付费及发布；仅本地脏 `main`，无提交／推送／Coze／部署，`stable` 未动。

## 2026-10-02 同步结果接受恢复接续（按 RED→GREEN 顺序）

**2026-10-02 Task C 本地候选进展（尚未关闭 Task C/D）：** 原真 PostgreSQL 故障用例扩为双图、受控 S3 私有清单与媒体、终态首次连接失败、进程内编辑状态清除、同 taskId 轮询恢复；先 RED 证实无清单，再 RED 证实有清单仍 `processing`，最终该用例 GREEN。`completeWorkflowEditTask` 现在先接受全部供应商图片，再按数据库冻结身份回读；轮询可从接受清单恢复。新路径在最终短事务复核来源、写 owner 的逐图资产版本／放置／唯一输出检查点并完成原收费任务，公开结果只含受管 URL；来源撤权可确定性退款，旧已完成任务投影保持兼容。整份来源真库 8/8；私有接受／S3 相邻单测 45/45；TypeScript、目标 ESLint、限定 diff check exit0。生产构建 exit0、121/121 页、41 条追踪警告；严格 NFT 仍 exit1（235 路由／83 宽／24 配置／24 根文档／582893 引用），保护基线 exit1（38 身份保留、27 未批准路径）。相邻四文件首轮 98 pass/1 fail，失败仅旧静态源码字符串断言；删去该脆弱断言后原文件单跑 6/6，**四文件尚未同次复跑**。仍需接受写失败的确定性结算、事务输出失败／未知 COMMIT 注入、取消与撤权竞态、孤儿媒体清理、真实另一实例及真实杀进程、全站／正确预览／真实付费验证；不得据本地候选放行。仅脏 `main`，无提交／推送／Coze／部署，`stable` 未动。

本计划对应 `docs/superpowers/specs/2026-10-01-workflow-image-edit-contract-design.md` 的“同步结果接受与发布的恢复边界”。保持原完整图像编辑目标，不以局部存储测试关闭原 `recovers an accepted direct workflow edit after terminal DB outage and worker loss` 真库 RED。

- [x] **Task A：私有 S3 传输边界。** 在 `src/lib/s3-storage.ts` 提供 `putWorkflowEditAcceptanceObject(taskId, bytes)`／`readWorkflowEditAcceptanceObject(taskId)` 和 `putWorkflowEditAcceptedMedia(taskId,index,bytes,mimeType)`／`readWorkflowEditAcceptedMedia(taskId,index,sha256,mimeType)`。先在 `src/__tests__/lib/s3-workflow-edit-acceptance.test.ts` RED，再验证条件写入、64 KiB 清单、20 MiB 单图、MIME／对象版本／长度／SHA-256、非法键零传输。当前仅此原语通过，不改任务状态。
- [x] **Task B：受控接受清单（本地实现与受控边界验证，不等于产品恢复）。** 新建 `src/lib/collaboration/workflow-edit-acceptance.ts`：输入包含原 taskId、actorId、请求摘要、冻结 providerId/modelId 和编辑结果；逐张有界读取、完整解码，再先存私有媒体，最后不可覆盖写清单；回读按精确身份与全部媒体校验，不存原始 URL／data URL／API Key。覆盖同键冲突、第二图缺失、伪图、媒体或清单写入失败、修改请求摘要及伪装为 providerId 的 URL。`/api/edit` 文档工作流在收费和外部 POST 前调用真实私有写入—读回—清理探针；真 PostgreSQL 的存储不可用用例证明 503／零任务／零消费／零异步回调。实际云桶和跨实例仍未验证，Task C/D 不因此关闭。
- [ ] **Task C：同任务恢复和原子发布。** 扩展原 `tests/integration/workflow-edit-source-postgres.test.ts` 的数据库故障／内存丢失 RED，使其以受控 S3 模拟真实共享对象；在 `src/lib/collaboration/workflow-edit-terminal.ts`、`workflow-edit-output.ts`、`src/app/api/edit/route.ts`、`src/app/api/poll-task/route.ts` 接入接受/回读。恢复须先锁定原收费任务及冻结意图、核清单与来源，再准备受管媒体，最终一个短事务同时写唯一 owner 输出检查点和任务终态；不能复用旧“先完成、后投影”路径。断言原 taskId、供应商 POST 一次、消费一次、无原始 URL、唯一资产版本、取消和撤权不复活。
- [ ] **Task D：故障和发布门禁。** 隔离 PostgreSQL 补 S3 清单已存在但终态 COMMIT 回执未知、取消/撤权竞态、接受写入失败、媒体清理失败、另一实例接手及真实杀进程；再跑相邻整份回归、TypeScript、ESLint、生产构建、严格 NFT、保护基线和正确预览。未通过的门禁保留 RED，禁止推送／Coze／部署；`stable` 不动。所有临时测试库按精确隔离身份核空后停止。

**本轮证据：** 新 S3 原语及公开路由隔离测试 10/10；相邻三文件首轮 52/53（旧视频测试默认 5 秒超时），单跑延长上限通过；最终仅传输层签名/摘要边界下三文件同次 54/54（20 秒上限）。最终非增量 TypeScript 与两路径 ESLint `--quiet` exit0，完整 `pnpm build` exit0、121/121 页、40 条追踪警告。三次生产构建的严格 NFT 均 exit1；最终 235 路由／83 宽／24 含配置／24 含根文档／582820 全路由引用，较本轮起点 582847 减少 27。保护基线最终 exit1，38 个功能身份保留、26 个未批准路径；无推送或部署许可。未跑原真库 RED 的 GREEN，不能宣称工作流故障已修复。

**2026-10-02 Task B 接续证据：** 接受服务和探针按定向失败测试接入；最新两份私有接受测试同次 20/20，随后第二图缺失用例精确增强后单文件 7/7。隔离真 PostgreSQL 的文档工作流预收费用例先 200／已建任务 RED，再 503／零任务／零消费 GREEN；整份真库最终 7 pass／1 fail，唯一失败仍是原始同步结果在终态 DB 故障＋进程内存丢失后轮询返回 `processing`，**产品恢复合同仍 RED**。非增量 TypeScript、目标 ESLint 通过；最新产品源码生产构建 exit0、121/121 页、42 警告；严格 NFT exit1（235 路由／83 宽／24 配置／24 根文档／582886 引用，比 Task A 末 +66），保护基线 exit1（38 身份保留、27 未批准路径）。隔离测试库 test schema／public 表／其他会话 `0|0|0` 后停止 55492。没有实际云桶、真实另一实例、全仓回归、正确预览或真实付费验证；未提交、推送、Coze 或部署，`stable` 未动。下一步 Task C 将接受清单接到实际结果到达、轮询恢复及任务完成＋唯一 owner 输出的同事务，不能以服务模块存在冒充已恢复。

2026-10-02 同步直返结果终态写库故障已在隔离真 PostgreSQL 中形成**明确 RED，未修复**：新增 `recovers an accepted direct workflow edit after terminal DB outage and worker loss`，构造本人已扣费且冻结文档来源的 `edit` 子任务，给终态服务传入受控供应商图片结果，单次注入数据库连接失败后清除进程内编辑状态，再经真实 `/api/poll-task` 读回。当前未重发供应商请求，但返回 `processing` 而非受管 `completed`（本例 1 failed / 7 skipped）；TypeScript、目标 ESLint／限定 diff check 通过。服务在 DB 不可用时返回 `pending`，同步结果未留下可按 taskId 跨进程回读的接受身份；这不是延长内存缓存或直接退款能满足的结果恢复。后继实现须先证实在本部署可用的**共享持久介质**，供应商结果到达后先验证并持久化受控媒体／taskId 绑定的接受记录，再在数据库恢复时按原 taskId、冻结请求和当前来源授权结算并发布唯一 owner 版本；取消／撤权不能被迟到记录复活，重复轮询不得重发供应商或重复扣费，未知 COMMIT 须按同一检查点读回。还需单独覆盖结果接受记录写入失败、进程真实退出／另一实例恢复、媒体清理和完成／发布原子边界。未证明共享介质前不宣称跨实例恢复；本轮没有产品修复、全仓回归或发布许可。专用 55492 测试库 schema／public 表／其他连接 `0|0|0` 后已停止；未触业务库、Coze 或 `stable`。

2026-10-02 工作流语言修图撤权终态结算局部闭环（**本地候选，整体未放行**）：隔离 PostgreSQL 与真实 `/api/edit`、`/api/poll-task` 先 RED 复现供应商返回后来源已撤权仍 `completed/charged`，远端轮询还可能交付原始 URL；现将工作流子任务终态的来源复核、完成或确定性拒绝退款置于同一短事务。直返与远端成功在撤权时均 `failed/refunded`，消费／退款各一次、无工作流输出；重复轮询不再重复退款。恢复授权的正向控制组仍发布 owner 的受管 `workflow-output`。最新同次相邻真库 2 文件 **44/44**，本轮 `pnpm ts-check` exit0，`pnpm build` exit0、121/121 页、41 条 Turbopack 警告；严格 NFT exit1（235 路由、84 宽、25 含配置、26 含根文档），保护基线 exit1（24 个未批准路径）。全仓 `git diff --check` exit1，原因是三份既有用户 SDD 文档末尾空行；本次功能相关路径的限定 diff check exit0。专用库确认 test schema／public 表／其他连接 `0|0|0`，随后停止 55492。**未解决**：同步供应商结果在终态写库不可用且进程退出时缺可恢复的接受结果身份；完成先于媒体发布时的撤权竞态、真实多实例／断线、三工作区读回、全站／正确预览／真实付费与发布门禁也未闭环。不得以 44/44 或构建成功宣称全合同完成；仅本地脏 `main`，无提交／推送／Coze／部署，`stable` 未碰，Pear 排除、PSD 核心保留。

2026-10-02 旧版文档工作流语言修图来源无歧义迁移（**本地候选、未发布**）：真实 `/api/edit`＋隔离 PostgreSQL 先 RED 复现旧请求仅带 `assetWorkspace='workflow'`、项目和规范图片 URL 时已建收费任务但工作流意图为零；现由服务器查询本人有编辑权项目 owner 下唯一活跃 ready 的 `workflow-input` 放置，推导来源实体／版本／工作流，以稳定合成节点 ID 复用既有收费意图与 `workflow-output` 发布，收费事务内重查唯一性。唯一来源完成后真实 `/api/poll-task` 不返回供应商原始 URL，owner 受管输出落盘；找不到来源、同 URL 两活跃放置或显式父版本提示冲突均收费前 400、零新增任务／消费。另以 RED→GREEN 保留旧请求显式空父版本数组的兼容性；个人项目分支未改。最新来源真库 6/6；此前同轮父子相邻文件与来源文件同次 43/43，但在空数组微调前，不能当最新同次结果；最新 `pnpm ts-check`、目标 ESLint、diff check、`pnpm build` exit0，121/121 页面，构建仍有 43 条宽追踪警告。最新严格 NFT exit1（235 路由／84 宽／25 含配置／26 含根文档），保护基线 exit1（23 未批准路径）。专用测试库 schema／public 表／其他会话 `0|0|0` 后已停 55492。独立审查席位已满，未取得独审；真实 HTTP、多实例插入竞争、真实供应商／付费、三工作区读回、撤权终态结算／唯一退款、全站回归、正确预览和发布门禁仍开放。仅本地脏 `main`，无提交／推送／Coze／部署；`stable` 未碰，Pear 排除、PSD 核心保留。

2026-10-02 工作流语言修图父→子→轮询→受管版本的本地真路由单链（**外部供应商与内部签名为受控边界，非云端／真实付费验收**）：新增隔离 PostgreSQL 集成用例，真实 `/api/workflow/execute` 运行 `input-image → ai-edit`，将 owner 的规范资产版本绑定 `workflow-input`，真实 `/api/edit` 以编辑者本人建立收费子任务并在同一事务冻结工作流、节点、来源版本和放置。用 `completeCloudTask` 模拟远端完成后，暂时撤销来源放置，真实 `/api/poll-task` 返回 202，父任务持久等待且只记原子 taskId；恢复放置后状态查询让同一子任务轮询返回 200，父节点完成结果只含 owner 的受管 `workflow-output` URL。断言编辑提交恰好一次、轮询含 202 与 200、编辑者一笔消费、输出版本归 owner、来源版本未被覆盖、父结果无原始提供商 URL。初始 RED 422 来自夹具提供商缺 `isEnabled`，随后父节点失败来自本机缺内部签名配置；补齐测试替身后业务单链通过，不把这两项环境／夹具失败称为产品修复。最终两份相邻真库同次 42/42，`pnpm ts-check`、目标 ESLint `--quiet`、目标 diff check exit0。专用库 test schema／public 表／其他会话 `0|0|0` 后停 55492。本轮只改集成测试，未重跑产品构建或严格门禁；上轮构建通过、NFT 与保护基线红灯沿用，不得视为本轮重验。仍需旧无身份文档工作流迁移、撤权终态结算／一次退款矩阵、真实 HTTP 服务／多实例／供应商完成、三工作区读回、全站／正确预览／真实付费和发布验证。仅本地脏 `main`，无提交、推送、Coze 或部署；Pear 排除，PSD 核心保留。

2026-10-02 已接受编辑子任务的发布待核对父任务局部恢复（**仍非真实父子完整单链**）：隔离 PostgreSQL 父任务恢复测试先 RED，子 `edit` 已完成但 `/api/poll-task` 返回 202 `publication-pending` 时，父任务节点未持久记录等待状态。执行器原设置待发布标记后仍在 10 分钟轮询循环中；现在该标记退出当前循环，把原 taskId 和 `running/publication-pending` 写入父任务并结束本轮，下一次状态查询在租约下重新轮询已接受子任务，不重发 `/api/edit`，受管 URL 出现后父任务完成。定向真库 RED→GREEN；最终父子检查点真库 37/37、工作流编辑来源真库 4/4、相邻路由单测 62/62，`pnpm ts-check`、目标 ESLint `--quiet`、目标 diff check exit0。生产 `pnpm build` exit0、121/121 页、47 条 Turbopack 追踪警告；BUILD_ID 与完成标记相同，均为 `unverified-0dbc088d39176c8e49dbb26bb71f1ae3`。严格 NFT exit1（235 路由／84 宽），保护基线 exit1（23 未批准路径）。专用测试库 `test_%` schema／public 表／其他会话 `0|0|0` 后停 55492。父任务和检查点为真库，子轮询为受控替身；旧无身份工作流来源迁移、真实父→真实 `/api/edit`→真实 `/api/poll-task`→受管版本单链、撤权结算／唯一退款矩阵、三工作区读回、全站／正确预览／真实付费与发布仍未验证。仅本地脏 `main` 候选，无提交／推送／Coze／部署；Pear 排除，PSD 核心保留。

2026-10-02 完成编辑任务的工作流交付栅栏（**非完整父任务恢复**）：真实 `/api/poll-task` 在完成的收费编辑任务来源放置已撤销时先 RED（200 且交付供应商原始 URL），现本人轮询先以冻结意图尝试专用发布，仅在受管 `workflow-output` 检查点及来源复核可读时构造唯一受管 URL 的 `completed`，否则 202 `publication-pending`、不泄露原始结果。真实 `/api/edit` 新任务没有 `workflow:` 会话时，完成投影误走画布，真库先 RED 后改为任何 `edit` 都先核工作流意图；新工作流任务持久化 `assetWorkspace='workflow'` 标记，在意图行意外缺失时不得回退通用画布或原始 URL，真库 200→202 RED→GREEN。来源文件与云任务相邻 33/33、四个工作流／轮询单测文件 75/75、TypeScript、目标 ESLint／diff check exit0；最终源码 `pnpm build` exit0、121/121 页、45 条宽追踪警告。严格 NFT exit1（235 路由／84 宽），保护基线 exit1（23 精确路径）；隔离库 test schema／public 表／其他会话 `0|0|0` 后停止 55492。后继必须处理旧无身份文档工作流来源迁移、真实父子单链、202 时父任务持久暂停／安全恢复、撤权／失败结算与一次退款、三工作区读回；全站／正确预览／真实付费和发布继续未通过。仅本地 `main`；未提交／推送／Coze／部署，Pear 排除、PSD 核心保留。

2026-10-02 工作流编辑结果发布局部纵切（**未完成父子整链或三工作区**）：隔离真 PostgreSQL 先 RED 确认完成的本人收费 `edit` 任务没有 `workflow-output`。新增冻结意图对应的专用输出检查点；完成任务投影复核 owner／编辑权、原 `workflow-input` 的版本／放置／规范 URL，验证并持久化结果字节，再事务性写 owner 资产、ready 版本、节点 `workflow-output` 放置、唯一检查点与任务 `assetProjection`，原素材不覆盖。模拟 PostgreSQL 已提交但丢失 COMMIT 回执，先 RED 报 `WORKFLOW_EDIT_OUTPUT_PENDING`，后从精确检查点读回同一版本；重复投影不再新增输出。新增迁移外键使历史缺意图表夹具需先删输出表。最终相邻真库／单测 33/33、`pnpm ts-check`、目标 ESLint／diff check exit0；`pnpm build` exit0、121/121 页、45 条宽追踪警告。严格 NFT exit1（235 路由／84 宽），保护基线 exit1（23 未批准路径）。中断测试留下的 3 个仅限专用库 `test_workflow_edit_output_*` schema 已按精确名称清除，test schema／public 表／其他会话 `0|0|0` 后停 55492。剩余：真实父执行至真路由再到输出的单链、旧无身份工作流请求的迁移、撤权／并发／失败媒体／恢复矩阵、投影失败时 poll 与父状态不可交付原始 URL、三工作区读回和全站／正确预览／真实付费／发布门禁。仅本地 `main` 候选，未提交、推送、Coze 或部署；Pear 排除，PSD 核心保留。

2026-10-02 真实 `/api/edit` 工作流收费来源局部接线（**未完成工作流发布**）：隔离真 PostgreSQL 首先 RED 复现带完整文档工作流身份的请求 200 建本人收费子任务并有一笔消费，但 `wujie_workflow_edit_publications` 零行。路由现将完整 workflow/node/sourceEntity/版本/placement 身份传已有 `createBillableTask.workflowPublication`，同事务准备/冻结来源并写意图；真实路由来源整份 3/3。父执行器提交语言编辑原无 workspace/workflow/node 字段，连线主图原无上游 sourceEntity，两处独立 RED→GREEN；相邻工作流 81/81、`pnpm ts-check`、目标 ESLint `--quiet`、目标 diff check 通过。构建 exit0、121/121 页、43 条宽追踪警告；严格 NFT exit1（235 路由/84 宽）、保护基线 exit1（21 未批准路径）。仍需完整父子真库单链、旧无身份兼容请求无歧义迁移；远端结果尚未受控媒体收养或写 `workflow-output` 资产版本。此接线不是 Task 2 完成或三工作区/发布许可。下一步先真父请求与旧请求迁移，随后安全媒体/唯一发布检查点及恢复验证。无提交、推送、Coze 或部署，Pear 排除、PSD 核心保留。

2026-10-01 擦除发送前身份真库 RED（**尚未修复，不得放行**）：新增真实签名工作流 AI 擦除请求的并发屏障，首个供应商 `/images/generations` POST 挂起时，隔离 PostgreSQL 实际为同键 `cloud_tasks=0`、消费流水=1（目标均为 1）；测试失败于业务断言而非网络或超时。根因经路由追踪是 legacy `consumeCredits` 在先，`autoTrySubmitImageTask` 发送在中，异步 `persistSubmittedImageTask` 仅在回执后，直返则直接返回图片。对照已修扩图原子准入确认不能复用其后置任务 ID 语义；旧扩图并发控制组本轮 1/1，`pnpm ts-check`、测试文件 ESLint 通过。新增测试使来源文件现有 108 项仍是上一轮范围，本轮整份不全绿（新增 1 RED），不得误报 109/109。设计边界与分期草案见 `docs/superpowers/specs/2026-10-01-workflow-image-edit-contract-design.md` 顶部及 `docs/superpowers/plans/2026-10-01-durable-inpaint-task-admission.md`；下一步从原子收费身份、阶段检查点、直返/异步持久后处理直到取消/恢复做一条完整纵切，不以单纯内存锁或提前调用旧 `persistSubmittedImageTask` 冒充修复。未修改产品路径，未验正确预览/真实付费/全站发布；Pear 排除、PSD 核心保留。

2026-10-01 图像编辑原子准入接续复核（**范围校正，非十动作验收**）：当前 `/api/image-edit` 的普通扩图已在供应商 POST 前通过 `createBillableTask` 创建本地 `image-edit-*` 身份，并将远端 ID 作为 `remoteTaskId`；隔离真 PostgreSQL 重跑并发同键、未知提交与直返结果恢复 4/4，整份来源 **108/108**。因此下方“扩图主竞态仍 RED／主路由尚未接入”仅是历史阶段，不应重新实施。当前实质缺口转向 `inpaint` 的 AI 擦除／蒙版：路由仍先在 legacy 路径 `consumeCredits`，之后调用 `autoTrySubmitImageTask`，异步擦除仅在供应商返回远端 ID 后 `persistSubmittedImageTask`；已有擦除用例只覆盖回执后的 handoff/退款，未覆盖回执前双发、同步直返、响应未知或重启后的受管结果。下一纵切应先为真实签名工作流擦除／蒙版请求建立隔离真库并发 RED，检查**供应商回执前**一条本地任务、一次消费和一次发送；再沿现有原子准入、供应商阶段检查点、远端 ID 分离、受控轮询/合成与唯一终态事务接线，保留本地擦除及 AI 失败兜底语义。不能只改 `persistSubmittedImageTask` 的调用时机，或用内存锁隐藏双发。该复核没有证明擦除／蒙版修复，也未运行正确预览或真实付费；Pear 排除、PSD 核心保留。

2026-10-01 循环旧连线及后续轮次恢复局部补正，**仍非完整恢复/发布批准**：正常执行对无 `out-loop` 的历史连线会采用非 `out-done` 出边作为循环体，重启恢复却仅认 `out-loop`，使已接受双槽子任务的父任务停在 `processing`。隔离真 PostgreSQL 以第 2 轮旧出边先 RED，修后标准第 1 轮与旧连线第 2 轮均按原子 taskId 轮询、零重提交并完成；相邻 5 文件 **136/136**、TypeScript、目标 ESLint/diff check exit0。生产构建 exit0、121/121 页、46 条 Turbopack 警告，BUILD_ID/完成标记同为 `unverified-e7fd33be901535465910e33d2a9164a1`；严格 NFT exit1（235 路由／84 宽），保护基线 exit1（18 路径 BLOCK）。专用 localhost PostgreSQL 的 test schema/public 表/其他会话 `0|0|0` 后停止 55492。恢复父图由真库夹具构造，生成/轮询是受控替身；真实杀进程、轮次之间无已接受子任务的崩溃、并发/取消/撤权、账务与受管结果版本、三工作区、全站回归、正确预览和真实付费仍未验。无提交、推送、Coze 或部署；Pear 排除、PSD 核心保留。

2026-10-01 循环生成子任务的受控重启接续，**仍非完整恢复/发布批准**：此前父任务虽保存已接受 ID，但循环成功结果让重启执行器跳过循环，状态接口亦只会唤醒普通编辑子任务。隔离真 PostgreSQL 先 RED 证实接受子任务时无 `loopResume` 游标、持久父图与双槽子任务不能在状态查询后继续；现接受前设置当前轮次/节点游标并随子 ID 写父任务，状态接口按冻结图和游标抢租，由同一执行器只轮询原 `generate-async` ID，完成后合并结果。错误工作流 `messageId`/幂等身份的反向用例零轮询、父失败。相邻 5 文件 **135/135**、TypeScript、目标 ESLint/diff check exit0；生产构建 exit0、121/121 页、44 条 Turbopack 警告，BUILD_ID/完成标记同为 `unverified-7e39fe2dcf3e110a7fc77bec8c0d17be`。严格 NFT exit1（235 路由／84 宽），保护基线 exit1（18 路径 BLOCK）。测试的恢复父图为真库构造、生成/轮询接口为受控替身，不是实际杀进程、真实供应商或账务验证；后续循环轮次、旧连接形状、进程并发、取消/撤权及受管结果版本仍开放，全站回归、正确预览和真实付费未验。无提交、推送、Coze 或部署；Pear 排除，PSD 核心保留。

2026-10-01 循环异步生成子任务局部补正，**仍非 Task 3 或集成批准**：隔离 PostgreSQL 的真实工作流父任务先 RED 复现循环 `/api/generate` 拿到 taskId 后无子检查点；单张与双槽两例现先把全部已接受的 `generate-async` ID 按循环轮次／槽位写入父任务，再轮询至所有槽位终态，才合并图片。第三例先 RED 复现一槽成功、一槽失败仍误报父任务完成，现父子均失败并保留原错误。三例 RED→GREEN，最终相邻 5 文件 **133/133**、`pnpm ts-check`、目标 ESLint／diff check exit0；`pnpm build` exit0、121/121 页、46 条 Turbopack 警告，BUILD_ID 与完成标记同为 `unverified-74e197f0ecdc636fe72bce25a83ad88e`。严格 NFT exit1（235 路由／84 宽），保护基线 exit1（18 精确路径 BLOCK）。专用 localhost 库 `test_%` schema／public 表／其他会话 `0|0|0` 后正常停止 55492，临时目录保留。测试采用真实父任务／隔离真库，但生成与轮询接口为受控替身，**未证明真实供应商、子任务收费身份或跨进程续跑**；循环重启续跑、动态多槽身份回读、受管结果版本发布、三工作区与全站/正确预览/真实付费仍开放。无提交、推送、Coze、业务库或部署；Pear 排除，PSD 核心保留。

2026-10-01 循环体冻结模型与失败态局部补正（**仍非完整工作流合同**）：`getNodeInputs` 并不从普通连线复制 `model`，实际风险是循环变量替换可在发送前改写模型，且循环体显式供应商失效后仍可能按模型／功能切换提供商；循环子 API 返回 `{success:false}` 还会被父任务误报完成。三条隔离 PostgreSQL 真实路由用例先 RED（200 启动／父任务 completed），现已配置模型含循环变量时启动前 422／零父任务／零发送，固定模型保留提示词循环变量；循环发送时显式供应商必须仍可用，否则子节点失败且不回退；非成功 API 回应写入失败子结果并使父任务失败，不继续发送后续迭代。相邻 **5 文件/130 项**、TypeScript、目标 ESLint／diff check 通过。生产构建 exit0、121/121 页、44 条 Turbopack 警告，BUILD_ID／完成标记同为 `unverified-5661e69699abbe10f96d9cc7e18cc2b8`；严格 NFT exit1（235 路由／84 宽），保护基线 exit1（38 身份保留／18 精确路径 BLOCK）。专用 localhost 库 `test_%` schema／public 表／其他会话 `0|0|0` 后已停止 55492，临时目录保留。复审席位仍满，无独立结论。**未完成**可变模型的服务端预解析／版本化冻结、无静态模型与 Skill 角色冻结、循环异步生成子 taskId 的检查点／真实轮询／重启恢复、子图重试、受管媒体与结果发布；全站 Vitest、正确预览与真实付费未验。仅本机候选，无提交／推送／Coze／部署；Pear 排除、PSD 核心保留。

2026-10-01 嵌套子图启动边界局部补正（**仍未获集成／发布批准**）：顶层只有 `subgraph` 时原先不要求父执行图，内嵌收费 `ai-generate` 可发送且父图缺席；内层未知字段或不存在的显式供应商仍建父任务。隔离 PostgreSQL 三条真实路由用例先 RED（无父图／返回 200），现将子图纳入启动候选，对解析出的每一层子图递归核对节点字段、媒体与凭据边界，并递归冻结已配置模型／供应商；合法子图在父图中存结构化子图、执行副本用同一模型对，非法子图于父任务入库和供应商发送前返回 422。相邻 5 文件 **127/127**、TypeScript、目标 ESLint／diff check 通过。生产构建 exit0、121/121 页、45 条 Turbopack 警告，BUILD_ID／完成标记同为 `unverified-c9dd002b54ed8c033e2a0904d45f6d85`；严格 NFT exit1（235 路由／84 宽），保护基线 exit1（38 功能身份保留／18 精确路径 BLOCK）。专用 localhost 库的 test schema／public 表／其他会话 `0|0|0` 后已停止 55492，临时目录保留。复审席位已满，未取得独立审查结论。**未完成**动态／循环输入覆盖模型、Skill 角色冻结、子图重试与嵌套子任务检查点、受管媒体、版本化不可变图、完整恢复与结果发布；全站 Vitest、正确预览和真实付费未验。仅本机候选，不提交／推送／Coze／部署；Pear 当前范围排除，PSD 核心保留。

2026-10-01 父图权威重试局部补正（**仍未获集成批准**）：上一段仅拦截模型对变更，重试仍从客户端 `body.nodes/connections` 取实际节点，提示词、节点类型或连线可在父执行图不变时再次发有费请求。三种真实路由行为均先 RED（200 且第二次发送），现对有父执行图的重试比较节点执行配置和入边；不一致返回 409 `WORKFLOW_RETRY_GRAPH_CHANGED`、无第二次发送，实际重试使用父图节点/连线。原始复合模型键会与父图规范化身份比较，未改图的控制组继续 200 并使用原提示词/供应商。相邻 5 文件 **124/124**、TypeScript、目标 ESLint exit0；最终源码生产构建 exit0、121/121 页、43 条 Turbopack 警告，BUILD_ID/完成标记同为 `unverified-66e6372ee9a87ecf8215b5c954d25623`。严格 NFT exit1（235 路由、84 宽），保护基线 exit1（38 身份保留、18 路径 BLOCK）；专用 localhost 库 `test_%` schema/public 表/其他会话 `0|0|0` 后停止 55492。旧无图历史重试仍走兼容路径；有图重试若需改变提示词/配置，应另建版本化执行而非悄然改原父图，但版本化重试尚未实现。嵌套子图、动态模型、受管媒体、完整恢复/发布、全站 Vitest、正确预览和真实付费仍开放；不提交/推送/Coze/部署。

2026-10-01 静态模型身份局部补正（**未获集成批准**）：父工作流原先先存客户端执行图，实际执行才注入 `providerId`／规范化复合模型；显式供应商不存在仍可建父任务，失效后通用模型查询还可能回退另一供应商，单节点重试亦可用新请求体替换模型。隔离 PostgreSQL 两条启动测试和一条失效后发送测试分别先 RED 后 GREEN：启动前对已配置模型解析并写入候选父图，同一规范化图的副本用于首发；显式供应商不可用在父任务/发送前 422，启动后失效则节点失败且不回退发送。重试改供应商/模型的真实路由行为先 200 后 409，零第二次发送。相邻 5 文件 **120/120**、TypeScript、目标 ESLint／diff check exit0；生产构建 exit0、121/121 页、43 条 Turbopack 警告，BUILD_ID／完成标记同为 `unverified-3d9faf5f6ed363efdc2bc65c4b0cfdc2`。严格 NFT exit1（235 路由、84 宽）；保护基线 38 身份保留但 18 路径 BLOCK。专用 localhost PostgreSQL 的 test schema/public 表/其他会话 `0|0|0` 后已停止 55492。**未覆盖**无静态模型节点、动态／循环覆盖模型、Skill 模型角色、嵌套子图、重试其他配置变更、下游提供商并发改配、独立版本化不可变快照和结果版本发布；全站 Vitest、正确预览、真实付费、Coze 未验。不提交／推送／部署，不因本段通过放行。

2026-10-01 发送前准入扩展（**本地局部候选，非完整工作流合同**）：继 Skill／编辑启动门禁后，隔离 PostgreSQL 再先 RED 证明普通 `ai-generate` 可 200 执行却无父执行图，且图像生成、视频生成、Agent 和分镜节点的未知配置字段仍可被接受。已将候选快照和 422 拒绝统一扩展到 `ai-*`、`agent-*` 与 `storyboard-sequence`；合法图像生成保留 200 并在父任务记录候选图，不安全图在父任务和供应商请求之前拒绝。上述节点的全部默认配置字段诊断均可按当前字段规则快照。相邻 5 文件 **165/165**、TypeScript、目标 ESLint／diff check 通过；最新源码生产构建 exit0、121/121 页、45 条 Turbopack 警告，BUILD_ID／完成标记均为 `unverified-6fc745250412234bfd91ea5e45c71134`。严格 NFT exit1（235 路由、84 宽），保护基线 exit1（18 路径 BLOCK）。专用 localhost 库核对 `test_%` schema／public 表／其他连接 `0|0|0` 后停止 55492。**仍未实现**嵌套图内付费节点的统一判定、有效内嵌媒体的受管准备、版本化服务端 schema 与独立不可变快照、冻结供应商身份、完整恢复及三工作区结果版本；现有文档媒体上传仅适用已启用协作文档，不能直接替换个人／旧项目工作流输入。全站 Vitest、正确预览和真实付费未验，不提交／推送／部署；Pear 排除、PSD 核心保留。

2026-10-01 新有费图启动准入局部候选（**不是统一收费门禁或不可变快照**）：真实 PostgreSQL 先 RED 复现未声明 Skill 输入／模型角色、编辑节点内嵌图片／凭据／未知元数据等 7 类不安全图仍返回 200、创建父任务并进入执行；现对启动范围包含 `ai-skill`、`ai-edit` 或 `ai-color-adjust` 的新任务，在候选图无法冻结时于父任务入库和任何供应商请求之前返回 422 `WORKFLOW_EXECUTION_GRAPH_UNSAFE`。真库断言无父工作流行、零 `fetch`，合法部分 Skill 输入及普通编辑继续原路径；相邻 5 文件 **160/160**、TypeScript、目标 ESLint、目标 diff check 通过。最新源码生产构建 exit0、121/121 页，BUILD_ID／完成标记均为 `unverified-cd684a5397e5227fa710d554881d69dd`，43 条 Turbopack 警告；严格 NFT exit1（235 路由、84 宽），保护基线 exit1（18 路径 BLOCK）。专用 localhost 库确认 `test_%` schema／public 表／其他连接为 `0|0|0` 后停止 55492。**仍开放：**其他可能收费节点的统一准入、有效内嵌媒体转受管版本、独立不可变 schema／摘要快照、完整重启续跑与输出版本发布；本地直接媒体输入目前可能被 422 拒绝，尚无等价准备路径。全站 Vitest、正确预览及真实付费未验，不提交／推送／部署；Pear 专项排除、PSD 核心保留。

2026-10-01 Skill 动态输入快照局部候选（**不是完整受控执行图**）：隔离 PostgreSQL 使用真实内置 Skill 节点先 RED 复现未声明的嵌套 `inputValues.hiddenPayload` 和未知 `modelBindings.hiddenPayload` 进入父执行图；现仅对含 Skill 节点的启动快照加载当前用户可执行的对应版本定义，复用 Skill 输入解析器校验已提供字段，并限定模型绑定为该 Skill 所需角色的 `providerId/modelId` 字符串。合法的部分输入仍可等待上游连线；单元 RED→GREEN 修正“缺省上游 dataset 被提前规范化拒绝”及“显式空必填字段被误放行”，全部启用内置工作流 Skill 的空部分输入诊断无失败。相邻 5 文件 **160/160**、TypeScript、目标 ESLint 通过。**边界：**普通用户文本、已声明的复杂数据集、实际媒体版本及输出并未变成独立不可变受控快照；当前图仍在父 JSON 中，未知/内嵌输入可使图缺席，而新的有费工作流尚未统一在发送前 fail-closed。下一步仍是服务端版本化 schema＋受管媒体引用＋事务性冻结及恢复，不能把此校验或定向测试等同 Task 3 完成。最新源码 `pnpm build` exit0，BUILD_ID/完成标记同为 `unverified-8e35394aa66c5bfd6e8d318c78a432dd`；严格 NFT exit1（235 路由、84 宽），保护基线 exit1（18 路径 BLOCK）。专用 localhost 库核对 `test_%` schema/public 表/其他连接 `0|0|0` 后停止 55492，临时目录保留。全站 Vitest、正确预览和真实付费未验；不提交/推送/部署。

2026-10-01 执行图字段边界追加（**局部候选，不是最终快照合同**）：隔离真 PostgreSQL 新增两类未知字段复现，`config.clientMetadata` 与节点顶层 `clientMetadata` 原样进入父任务均先 RED；现在按已知节点/端口/连线形状及节点属性字段＋少量执行身份字段核对，未知字段使自动图快照缺席，原子任务身份仍保留。工作流真库文件 **13/13**、相邻 4 文件 **106/106**、`pnpm ts-check` 与目标 ESLint 通过。该白名单复用了 UI 属性定义，只是防止未知字段原样落盘；它不是版本化服务端执行 schema，也未验证 Skill 动态 `inputValues` 的字段和值、受管媒体或任意自由文本。下一实施单元须在付费提交前冻结受控快照/媒体引用并对无法冻结的新图 fail-closed；对既有无图已接受任务走受控待核对，不盲目重 POST。最新源码 `pnpm build` exit0，BUILD_ID/完成标记同为 `unverified-929420f7da624b42a6323e900c81edbc`；严格 NFT exit1（235 路由、84 宽），保护基线 exit1（18 路径 BLOCK）。专用 localhost 库核对 `test_%` schema/public 表/其他连接 `0|0|0` 后停止 55492，临时目录保留。未运行全站 Vitest、正确预览或真实付费；不提交、推送或部署。Pear 专项排除当前目标。

2026-10-01 接续复核（**局部 RED→GREEN，整体未获集成批准**）：独立复审指出执行图启发式过滤可漏掉提示词中部的 `data:image/...;base64,` 和通用 `headers` 凭据；新增两条隔离 PostgreSQL 用例均先 RED（父任务原样存图），收紧显式检查后 GREEN。无安全执行图但已有单一普通编辑子 taskId 时，真库用例确认可轮询原子任务终态、保留 ID 并暂停等待受控结果核对；异工作流子身份原先会让父任务永远 `running`，新增真库 RED→GREEN 后不轮询错子任务，父任务 CAS 暂停并保留检查点。相邻 4 文件 **104/104**、`pnpm ts-check`、目标 ESLint 和目标 diff check 通过。**仍未解决**：启发式检测无法证明任意自由文本/未知配置不含凭据；没有受控且不可变的图/媒体引用时，不能安全地自动恢复完整图；循环、多实例、撤权、输出资产版本发布及三工作区均未验。当前源码 `pnpm build` exit0，BUILD_ID 与完成标记同为 `unverified-2a14dad28f864e48283be9ea381cec9f`；严格 NFT exit1（235 路由、84 宽），保护基线 exit1（18 路径 BLOCK）。该候选不提交、推送、部署或调用真实供应商；专用 localhost 库核对 `test_%` schema/public 表/其他连接为 `0|0|0` 后已停止 55492，临时目录保留。Pear 专项排除当前目标，PSD 核心保留。

2026-10-01 本轮收尾补证：最终源码 `pnpm build` exit0，`BUILD_ID` 与 `WUJIE_BUILD_COMPLETE` 均为 `unverified-282f5245b0d8a686a48146fa159d2926`；严格 NFT 仍 exit1（235 路由、84 宽），保护基线仍 exit1（18 路径 BLOCK）。专用 localhost PostgreSQL 核对 `test_%` schema、public 表、其他连接为 `0|0|0` 后停止 55492；临时目录保留。构建通过不消除下段独立复审的执行图与敏感数据阻断；正确预览、真实付费、全站 Vitest 未验，不提交、推送或部署。

2026-10-01 普通编辑子任务重启接续（**受控单节点局部 GREEN，独立复审未批准集成**）：真 PostgreSQL 先 RED 证实父任务已保存 edit 子 taskId，但未保存普通执行图，重启后的 `status` 只返回 `processing`。现对有限大小、启发式筛掉显式凭据/内嵌图的图冻结启动快照；持久父任务在缓存缺失时抢租、核对子任务本人/项目/消息/幂等键/类型，只轮询原 taskId 而不重复 POST。真库单节点恢复先 RED 后 GREEN，错误归属用例经移除校验反向验证会误报完成；租约换主后旧工作器写成功的竞态也真库 RED→GREEN，父任务 `updateCloudTask` 现在原子核对恢复租约 owner。最终定向 4 文件 **101/101**、`pnpm ts-check`、目标 ESLint 与目标 diff check exit0。**不能将此视为完整恢复：**独立只读复审指出，含 data URL/凭据/过大值时整个图被省略，已接受有费子任务仍可能重启后卡住；启发式扫描不能证明任意客户端图无敏感内容。循环体恢复、租约交接后的新工作器继续、撤权、受控结果媒体/资产版本发布、三工作区仍未验。下一步先设计可恢复且受控的执行图/媒体引用，或在无法取得快照时建立不丢子身份的受控待核对路径；不得以仅对干净单节点成功的测试关闭 Task 3。本段代码是未提交本地候选，独立复审有 1 Critical/2 Important，其中租约项已补真库；其余两项保持开放。最终构建重跑和专用库收尾以本段后续补记为准；不推送/部署/真实付费。

2026-10-01 当前接续（**普通扩图局部 GREEN，整体未放行**）：真实 `/api/image-edit` 扩图现于供应商 POST 前用现有收费事务原子建立本地 `image-edit-*` 任务；同键并发只发一次，远端 ID 与本地身份分离，未知发送维持原任务待核对、不盲退款。隔离 PostgreSQL 已覆盖并发、顺序取消、失败轮询、未知发送和重启时的扩图尺寸。新增重启缺口先 RED：供应商接受检查点已有远端 ID，但 `remote_task_id` 写回丢失后，轮询永久返回处理中。只读复审指出真实崩溃还会留下 30 分钟有效租约，原修复无法及时补写；真库补充有效旧租约 RED→GREEN：本人轮询对相同 `outpaint-submit` 已接受回执仅做 revision／终态栅栏的本地远端 ID 补写，不夺租约、不重发／重扣；远端查询仍等原租约失效并遵守退避。最终源码的隔离 PostgreSQL 来源整份 **104/104**、相邻轮询／恢复 4 文件 **32/32**，TypeScript、定向 ESLint 和目标 diff check exit0。先前下述“主竞态仍 RED／主路由尚未接入”是历史阶段结论，**不代表当前源码**。同步直返已接受但完成写盘中断、仅有 `started` 的未知回执人工核对、未发送前的过期结算、其他图像编辑动作、文档工作流结果发布与跨工作区恢复仍开放；正确预览与真实付费未验，不提交／推送／部署。

同轮发布门禁补证：`pnpm build` exit0，`WUJIE_BUILD_COMPLETE` 与 BUILD_ID 一致，但标记为 `unverified-*`，编译有 42 条 Turbopack 警告；严格 `node scripts/audit-build-traces.mjs --strict` exit1（235 路由、84 宽追踪），`pnpm check:protected-baseline` exit1（38 功能身份均在、17 精确源码路径 BLOCK）。构建通过不等于发布许可。专用 localhost PostgreSQL 测试库在 `test_%` schema／public 表／其他连接均为 0 后停止 55492；未触碰业务库或真实供应商。完整全站测试、正确预览和真实付费仍未验证。

2026-10-01 发送前本地身份的轮询前提（**局部 GREEN，主路由尚未接入**）：为即将使用的 `image-edit` 原子准入任务增加真库路由回归：已收费、本地任务尚无远端 ID、超过普通恢复退避时，不得把本地 ID 送供应商，也不得误退款。旧路由在此时进入供应商查询并因找不到提供商回 400（RED）；现仅对标记为 `ordinary-outpaint` 且无远端 ID 的任务返回 `processing/recoveryPending`，待后续按持久阶段核对。目标真库 1/1，连同现有异步 outpaint 收费／取消控制组共 3/3；相邻轮询 51/51、TypeScript 与目标 ESLint exit0。**当前真实 outpaint 提交仍走旧“远端 ID 到手后建任务”流程；此保护只对新身份生效，不修复并发重复发送，也不是永久待核对的完整恢复策略。** 下一步把发送前原子准入、供应商阶段 checkpoint、接受回执写回和唯一结算连成一个真实路由纵切，再使并发 RED 转 GREEN；未跑全源或全站回归。

2026-10-01 原子准入前置防线（**局部 GREEN，主竞态仍 RED**）：`createBillableCloudTask` 的已有同键任务重放原先只对普通 `image-edit` 比对请求摘要，同摘要跨 `generate` 类型或跨项目仍可能错误复用。隔离 PostgreSQL 新增跨类型／跨项目用例先 RED 后 GREEN；现对涉及 `image-edit` 的重放同时核对任务类型与项目，冲突拒绝，不新增消费或任务。目标真库 1/1、相邻存储／工作流 59/59、TypeScript 与目标 ESLint exit0。来源整份最终 **99/100**，唯一失败是下段并发同键 outpaint 测试：供应商回执前只有扣费、尚无任务，故未做到发送前原子准入。此处不代表并发竞态修复或整体放行；未跑修后全站构建、云端预览和真实付费。

2026-10-01 并发同键下一接缝（**RED 已确认，未修复，不得放行**）：新增真实 `/api/image-edit` 签名工作流请求＋隔离 PostgreSQL 回归 `admits concurrent same-key outpaint only once before the provider accepts a task`。测试让首笔供应商 POST 停在回执前，再发同键第二笔；连续两轮都实际出现 **2 次供应商发送**（合同要求 1 次），首笔随后因重复任务持久化失败返回 500。该测试当前故意为红，整份来源文件由 98 项增至 99 项；不能把此前 98/98 继续当作当前源码全绿。`pnpm ts-check` 与目标 diff check 通过。专用测试库核 `test_%` schema、public 表、其他会话均为 0。根因：普通 `outpaint` 等路径先做非锁定的重放查询，再走独立扣费／外部 POST，只有取得远端 taskId 后才插入 `cloud_tasks`，任务唯一约束来得太晚；失败补偿不能撤销已发出的第二个供应商任务。

下一实施单元必须在发送前通过现有 `createBillableTask` 原子建立本地子任务身份、一次扣费及严格的本人／项目／入口／请求摘要重放；远端 taskId 作为该子任务的 `remoteTaskId`，接受回执与供应商阶段写盘后才允许按同一本地 taskId 轮询。并发第二笔须立即复用该任务的处理中状态，绝不发第二个 POST。对回执未知、崩溃、撤销和失败须保留原任务并通过原键核对／唯一结算，不能用内存互斥、会话锁跨外部 IO、盲退款或无条件重发替代。现有普通子任务轮询与重启恢复仍把 `taskId`/远端 ID 视作同一个，需要先分离并以真库 RED→GREEN 覆盖同步直返、异步接受、未知提交、取消与重启；再扩到所有有费图像编辑动作，不能只修这条 outpaint 用例。

状态：**执行草案，非可直接逐条执行的最终计划**。范围跨动作路由、文档资产发布和普通异步子任务恢复三个独立边界；尤其 Task 2 的事务/恢复接缝尚待真库 RED 与代码审查选定。实施前分别细化成自包含的子计划，补齐精确接口、代码步骤和每步 GREEN 断言；不得把本草案中 Task 1 的路由改动单独当成文档工作区可用或发布许可。

2026-10-01 限定修后复审与再修，**局部候选未获集成批准**：Hooke 只读复审指出三项 Important。其一，子任务取消后父任务 CAS 冲突仍可能回 `cancelled`；其二，缓存未命中的暂停/终态写入缺 revision，会覆盖较新检查点；其三，`/api/image-edit` 多个异步分支未持久化 `projectId/messageId/idempotencyKey`，内部调用还需一起核对 `sessionUser` 与认证 actor 的计费归属。前两项分别新增真实路由 RED→GREEN：内存父终态写盘失败回 409 `unconfirmed`、缓存未命中的暂停与终态写入均携带读取时 revision，冲突不报告成功；最终工作流路由 37/37、TypeScript/目标 ESLint/限定 diff check exit0。隔离 PostgreSQL 相邻旧链路在修后源码重新通过 3/3；专用库 test schema/public 表/其他会话 0 后停止 55492，但这三项**不覆盖**新增两处取消方 CAS 竞态，当前只由存储桩注入验证。**第三项尚未改动**：不能放松子任务归属校验或把内部请求改成免费；需先以真实 `/api/image-edit` 请求＋隔离 PostgreSQL 复现工作流身份与收费，再在完整事务/持久化边界接线。下方 build exit0 是复审前源码，修后未重新构建；提交中取消、普通图重启、三工作区发布和完整发布门禁仍开放。

2026-10-01 复审后局部补正，**仍非取消链路验收**：同项目但异工作流的子任务误取消先在真实路由 RED（200），现按父 `executionId` 下的 `sourceEntityId`、子任务 `messageId` 与 `workflow:${sourceEntityId}` 幂等键共同核对，不符就暂停且不发取消请求；子任务已 `completed/failed/timeout` 时也从旧误报父取消改为暂停待核对。工作流路由最终 34/34。隔离 PostgreSQL 另先 RED 复现外部实例已暂停时，旧执行器迟到结果覆盖为 `completed` 且内存 status 仍报 `running`；增加父任务 revision CAS、发现已变更则停止写盘并让状态 API 回读数据库。真库最终 3/3，类型检查及目标 ESLint exit0；专用库检查 test schema/public 表/其他会话均 0 后停止 55492，临时目录保留。最终源码生产构建 exit0、121/121 页、41 条 Turbopack 警告，BUILD_ID 与完成标记相同且为 `unverified-*`；严格 NFT exit1（235 路由/84 宽），保护基线保留 38 身份但 17 精确路径 BLOCK。**未解决**：子提交中尚无 taskId 的取消竞态、取消方 CAS 失败与冲突恢复、`/api/image-edit` 部分持久子任务缺可验证归属字段、普通图不可变快照/重启免重 POST、真实付费唯一退款与输出版本发布。跨实例栅栏只覆盖已测试的外部暂停→迟到写盘交错，不得外推为完整多实例取消。全站 Vitest、Coze 正确预览与正式发布未验证；独立限定修后复审正在进行。

2026-10-01 普通编辑子任务取消局部候选：父执行器原先仅转发分层与 Skill Run 的取消，已写盘的 `/api/edit`／`/api/image-edit` 子 taskId 不被取消；晚到轮询结果还会写成功节点。真实路由用例先 RED 复现无子取消、再 RED 复现晚到节点成功，现逐一以已认证本人身份核对同项目子任务、调用既有 `/api/cancel-task` 并要求确认后才终态取消父任务；取消拒绝或网络异常另经 RED→GREEN 使父任务保持 `paused` 和明确错误，晚到结果不覆盖。工作流执行范围 29/29；隔离真 PostgreSQL 通过真实子任务取消路由及父任务写盘 2/2（其中新取消用例确认子 `cancelled`、父 `cancelled` 且晚到结果未成功）。本轮尚未证明提交请求与取消并发时子 ID 尚未返回的竞态、跨实例父写盘 fencing、真实付费唯一退款、重启续跑或工作流资产发布；不能把此局部结果称为取消/恢复完整验收。最终类型、ESLint、构建与独立复审结果以本段后续更新为准。

2026-10-01 循环子任务检查点补正：同一编辑节点在循环中多次提交时，旧 `activeChildTasks[nodeId]` 会覆盖先前已接受的子 taskId；真实执行路径的两次循环行为测试先 RED 见到只剩第二项，现以已有稳定 `sourceEntityId=executionId:nodeId:loop:index` 作检查点键，普通节点则为 `executionId:nodeId`。工作流执行范围 26/26、隔离真 PostgreSQL 父任务检查点 1/1、`pnpm ts-check`、目标 ESLint 均 exit0；真库复核 test schema/public 表/其他会话均 0 后停止 55492，临时集群目录保留。本轮未跑全量回归或构建。只修复父记录的每次尝试身份，不代表重启免重 POST：普通工作流图当前不写不可变执行快照，`restorePausedWorkflowExecution` 要求 `executionGraph`，而现仅含 `ai-skill` 时保存该图；`status` 恢复也只启动 `ai-skill`。`/api/workflow/save` 的用户可变工作流副本不能直接冒充启动时图。下一阶段须设计受控且不可变的执行图引用/快照（不得把 API Key 和原始 base64 图写进父任务），恢复时按已接受 `sourceEntityId` 轮询原子任务并续跑下游，覆盖循环、多实例租约、撤权与取消。不能把本次 26/26 当作 Task 3 完成。

2026-10-01 普通编辑子任务身份局部候选：父执行器在 `/api/edit`、`/api/image-edit` 单一子 taskId 接受后、首次轮询前写 `activeChildTasks` 检查点，写入失败停止该次轮询；已完成的节点结果保留原 taskId。两条新增行为测试分别 RED→GREEN；另一个 RED→GREEN 保证意外多子 ID 响应在无完整检查点时不轮询、不误报成功。最终整份工作流执行范围 25/25；专用隔离 PostgreSQL 真实父任务测试 1/1 在最后源码重跑，确认轮询未完成前已写盘、完成结果含原 taskId、子提交一次。TypeScript 与目标 ESLint 通过；最终生产构建 exit0、121/121 页、43 条 Turbopack 警告、BUILD_ID 与完成标记一致但为 `unverified-*`；严格 NFT 235 路由/84 宽、exit1；保护基线 17 精确路径 BLOCK。真库清理核 test schema/public 表/其他连接均 0，55492 临时集群停止。此处仅证明同进程提交后的检查点写入和结果身份，**未证明**重启后读取该检查点、免重 POST 恢复、取消同步、受控结果媒体发布或三工作区共享版本；旧兼容文档请求仍可能先收费而无工作流资产发布。不得将此局部候选标成 Task 3 完成。

2026-10-01 新增底层候选：`createBillableCloudTask` 已增加**可选**工作流编辑意图，在同一事务内锁当前编辑授权、项目、活跃 `workflow-input` placement、ready 图片版本并核对规范 URL；任务与扣费同事务写一对一意图，重放按冻结的工作流/节点/来源/模型/摘要拒绝冲突。隔离 PostgreSQL 先 RED 观察伪 URL 仍扣 5 积分、同键换节点仍被复用，后 GREEN；相邻 4 文件/90 项、TypeScript、目标 ESLint 通过。**尚未接入 `/api/edit` 和工作流父执行器**，旧显式 `assetWorkspace='workflow'` 路径仍按历史兼容行为运行；输出媒体收养、发布检查点、未知 COMMIT 的原键核对恢复、子 taskId 恢复及完整动作/云端验收仍开放。此局部意图不是完整 Task 2，更不是发布许可。

同日独立只读复审后，新增三条真库 RED→GREEN：库中相对规范 URL 遇请求同路径异主机时原可借调用方 `origin` 错误相等，现拒绝绝对跨站输入；冻结上游 `workflow-input` 实体 ID 并在锁内比对，换实体不能同键重放；COMMIT 已提交但回执丢失时抛 `WORKFLOW_EDIT_COMMIT_UNKNOWN`，原任务与意图、一次消费可读回。随后再 RED→GREEN 处理意图表尚未建成时的旧 `edit` 同键重放。最终来源与相邻单元 4 文件/90 项、TypeScript、目标 ESLint、生产构建 121/121 通过；最终构建仍有 40 条 Turbopack 警告，严格 NFT exit 1（235 路由、84 宽），保护基线 17 个精确路径 BLOCK。限定只读复审未见本原子准入候选仍有 Critical/Important，但审查者未运行真库。复审关于“必须等于资产 current_version_id”的建议暂不采纳：现有工作流服务允许把历史版本显式绑定为活跃输入 placement，权威是锁定的实体/placement/version 身份；父执行图校验仍待接线。以上只补本地候选，不能抹掉旧兼容请求和输出发布缺口。

2026-10-01 局部证据：普通异步子任务提交响应的 `HTTP 200 + success:false` 已在真实工作流 POST/状态查询中先 RED（父任务误报 `completed`）后 GREEN（父任务 `failed` 并保留原始错误）。独立复审无 Critical/Important，提出的成功 taskId→轮询控制组已补并通过；三份相邻 Vitest 48/48、`pnpm ts-check` 和目标 ESLint exit 0，`git diff --check` exit 0；保护基线仍有 15 条既有精确源码漂移 BLOCK。此改动只封闭一个失败响应分支，**不代表**默认 `ai-edit`/调色路由、文档来源与发布、子 taskId 恢复或本计划 Task 3 完成。

2026-10-01 节点构建器局部 RED→GREEN：默认语言修图及调色路由/字段、显式扩展控制组、未知动作拒绝，定向四项。普通节点、重试与循环体对 `ai-edit` 四动作及调色均要求声明项目；无项目直发/循环显式动作先 RED 后 GREEN。循环中的语言编辑与显式扩展均经子任务提交/轮询；异步和同步 `HTTP 200 + success:false` 均记失败。隔离 PostgreSQL 实测新节点请求在文档项目缺父版本时返回 400、零消费、零供应商发送；旧 `/api/edit` 显式 `assetWorkspace='workflow'` 兼容路径仍会收费执行却无画布发布记录，必须迁移并保留原有功能，不能当成三工作区共享。已加真实工作流提交体的 provider/model pair 控制组，但尚未做真实个人项目编辑提交、可信文档来源与版本发布、普通子 taskId 恢复及浏览器验收。隔离真库使用全新临时 PostgreSQL 实例并按既有 fixture 的固定库名/端口运行；此例外不适用于业务库。

2026-10-01 蒙版请求局部 RED→GREEN：`erase/mask` 原先既缺 `editMode/maskImage`，`ai-edit` 也没有可连接的 `in-mask` 端口。已增加端口、缺蒙版发送前错误 `WORKFLOW_EDIT_MASK_REQUIRED`、有效蒙版请求字段；测试覆盖真实节点端口和 `ai-removebg.out-mask → ai-edit.in-mask` 连线输入。旧保存节点的端口在初始加载/外部更新/水合时补齐，不改原传入对象。相邻六份 Vitest 89/89，`pnpm ts-check`、目标 ESLint、目标 `git diff --check` exit 0。保护基线门禁再次确认 38 个功能 ID、保护路径与证据合同存在，但有 15 条既有未批准源码漂移，exit 1；不得据此发布。此项只修纯构建器、端口及旧节点加载，未验证蒙版的受权版本/安全媒体、文档费用与发布、子任务恢复或浏览器链。

2026-10-01 文档编辑者输入绑定局部 RED→GREEN：隔离 PostgreSQL 原先对有授权的编辑者返回 `ASSET_NOT_FOUND`，因为项目资产按所有者存储。现仅在该错误下读取当前文档授权并以实际所有者解析版本、绑定 `workflow-input`；测试覆盖权威 URL 覆盖伪 URL、来源 placement 不变、工作流 placement 所有者正确及撤权后零新绑定。此项只修输入解析，授权不是收费/发布事务内屏障；`task-projector` 的 actor=owner 假设与画布专属的任务发布/媒体导入仍阻挡结果版本。下一独立子计划应先给出工作流发布意图与回读身份、同事务收费准入、受控媒体收养、撤权/未知 COMMIT 恢复的精确接口和真库 RED，再改 `/api/edit`；不能用当前输入测试宣称 Task 2 完成。

2026-10-01 来源身份传递局部 RED→GREEN：真实连线的工作流图片结果已有 `assetVersionId/placementId`，此前 `ai-edit`/调色的子请求丢失该二元组。构建器现仅在有完整二元组时附带 `assetParentVersionIds/assetSourcePlacementId` 候选；上游新版本会覆盖节点旧配置，版本单独到达不会与旧 placement 拼成伪配对。语言编辑、调色、扩展及 URL-only 控制组先 RED 后 GREEN；这两个字段**仍由客户端可提交**，当前 `/api/edit` 与 `/api/image-edit` 尚未将其当作工作流文档事务准入，不能据此放行、收费或发布。接缝选型及后继锁/媒体/检查点合同见设计稿“文档工作流发布接缝裁定”。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `ai-edit` 与 `ai-color-adjust` 节点按各自动作进入真实编辑接口，并在文档/个人项目中维持可信来源、一次收费、恢复与结果版本合同。

**Architecture:** 节点构建器只作确定性动作/字段映射；工作流执行器用当前 actor 和项目重新确认上游资产身份；既有 `/api/edit` 与 `/api/image-edit` 子任务仍是唯一账务和终态权威。文档结果只有实际发布到项目资产版本后才成为跨工作区引用，父工作流不以公开 URL 或自身完成状态冒充子任务成功。

**Tech Stack:** Next.js 16、TypeScript 5、Vitest、PostgreSQL 隔离测试、Playwright Chrome。

**Spec:** `docs/superpowers/specs/2026-10-01-workflow-image-edit-contract-design.md`，并沿用 `docs/superpowers/specs/2026-09-28-image-edit-source-and-quote-decision.md` 的十动作来源/冻结报价裁定。

## Global Constraints

- 只改本地 `main`；`stable`、V5.8.8 donor 与业务 PostgreSQL 只读，不复制 donor 整文件。
- 不新增图像编辑队列、收费流水权威或客户端免费标记；Pear 分层验证排除当前目标，PSD 核心保留。
- 每个产品行为先实际 RED，再最小 GREEN；外部供应商只用受控替身，真库须使用 loopback 专用库并核对四数据库环境变量一致。新测试库用 `wujie_bridge_test_` 前缀；既有 `canvas-edit-route-postgres` fixture 只接受固定 `wujie_yjs_task8cb3g_20260927` 库名和 55492 端口，故仅可在新建、独立的临时 PostgreSQL 实例中使用，绝不可指向业务库。
- 不用“单元 26/26”证明节点接口已可用；保护基线、严格 NFT、独立复审、正确 Chrome 预览与真实付费各自独立验收。未获发布许可不提交、推送或部署。

## 2026-10-01 局部进展：内部异步编辑任务的本人身份与顺序重放

真实 `/api/image-edit` 工作流内部签名请求原先以 Cookie 用户计费／记录任务；无 Cookie 时可能漏扣或记错人。现改用鉴权结果中的 actor，并把项目、会话、消息、幂等键和已收费用写入同一子任务；同进程轮询失败时注册表也持有费用，供现有任务退款路径使用。擦除的服务器轮询交接不再二次注册任务，避免清空已存费用；真库先 RED 见 `creditCost` 消失，后 GREEN 核原任务一次消费、一次失败退款。通用异步任务在扣费／发送前按本人、同键、请求摘要与 `edit` 入口核对已持久任务；同请求返回原 taskId，不同请求返回 409。CPU 去背景与 302 放大保留各自专用重放／发布路径。

隔离 PostgreSQL 先 RED 复现重复供应商发送、错人／漏扣及同进程失败未退款，再 GREEN：最终来源整份 **98/98**、相邻 API **146/146**；`pnpm ts-check`、定向 ESLint `--quiet`、目标 diff check 均 exit0。测试数据库最终复核 `test_%` schema 0、public 表 0、其他会话 0 后停止 55492；临时集群目录与测试媒体保留。限定只读复审认可擦除二次注册失费问题关闭，但**并发同键请求仍可能在首个任务持久化前同时发送／扣费**；普通子 taskId 重启恢复、工作流文档发布、完整十动作、全站构建／保护门禁、正确预览、真实付费和云端多实例均未关闭。本段只在本地脏 `main` 候选，未提交、推送或部署；Pear 专项继续排除，PSD 核心保留。

### 2026-10-01 扩图直返恢复与保存边界增量

- 普通 `outpaint` 的已收费本地任务现在持久记录供应商接受的直返 URL／远端 ID；提交者在结果保存期间续租，轮询者仅在取得恢复租约后下载、按冻结尺寸处理并以租约条件完成，不重新 POST、不再扣费。直返 URL 与远端 ID 同时存在时优先恢复直返结果，避免误查不可轮询的远端任务。
- 真 PostgreSQL 测试先 RED 后 GREEN：直返保存失败后的同任务恢复、31 秒保存期间租约续期、失败退避、双字段接受回执。独立审查再发现毫秒时间戳 S3 对象键可碰撞；新增并发 RED 后改为 UUID 键，保存边界单测 **3/3**，覆盖卡住的下载／S3 上传及迟到下载不能继续上传。UUID 增量后的最终源码再跑来源整份 **108/108**；`pnpm ts-check`、定向 ESLint `--quiet`、`pnpm build` 均 exit0，构建生成 **121/121** 页面，完成标记与 Build ID 一致。S3 并发为受控单测，不冒充真实对象存储集成验收。
- 独立测试库终了核对 `test_% schema/public tables/other sessions = 0|0|0`，随后停止 55492；未访问业务库。发布门禁仍红：严格 NFT `235` 路由、`84` 宽追踪、`25` 条含 `next.config.ts`；保护基线 38 个功能标识保留，但 **18** 条未授权源码路径阻断。尚未提交、推送、部署或运行真实付费／正确 Chrome 预览。此增量仅关闭已复现的扩图直返竞态，不代表工作流图像编辑全链完成。

---

### Task 1：确定性动作路由和请求形状

**Files:**
- Modify: `src/lib/workflow-engine.ts:812-817,2036-2048,2149-2159`
- Test: `src/__tests__/lib/workflow-engine.test.ts`

**Interfaces:** Consumes `WorkflowNode` 与 `getNodeInputs` 的 `imageUrl/maskUrl/assetVersionId`；produces `buildNodeExecutionRequest(node, inputs)` 的 `{ endpoint, method, body }`，不执行收费或网络。

- [ ] **Step 1: 写两个独立行为 RED。** 默认 `ai-edit` 与 `ai-color-adjust` 的输入主图为 `/api/serve-upload/source.png`、显式模型 `provider-a::gpt-image-2`。手写期望：两者 `endpoint='/api/edit'`、`body.image` 是原图、`body.imageUrl` 与 `body.action` 均不存在、`body.providerId='provider-a'`、`body.model='gpt-image-2'`；调色 prompt 含三个输入数值。另以显式 `extend` 期望仍走 `/api/image-edit`、`action='extend'`。

```ts
const request = buildNodeExecutionRequest(makeNode('edit', 'ai-edit'), { imageUrl: '/api/serve-upload/source.png' });
expect(request).toMatchObject({ endpoint: '/api/edit', body: { image: '/api/serve-upload/source.png' } });
expect(request?.body).not.toHaveProperty('action');
```

- [ ] **Step 2: 运行 RED。** `pnpm exec vitest run src/__tests__/lib/workflow-engine.test.ts -t 'routes workflow language edit'`。应失败于实际 `endpoint='/api/image-edit'` 或缺 `body.image`，不能以测试导入错误充当 RED。
- [ ] **Step 3: 最小映射。** 对 `action='edit'` 和调色构建 `/api/edit` 请求，主图字段为 `image`；其余三动作仍按各自合同留 `/api/image-edit`。显式 provider/model pair 保持一致；无模型时不要把空字符串传入 `/api/edit`。未知 action 抛明确错误，不发送网络。

```ts
const isLanguageEdit = (config.action || 'edit') === 'edit';
return isLanguageEdit
  ? { endpoint: '/api/edit', method: 'POST', body: { image: config.imageUrl, prompt: config.prompt, ...(config.model ? { model: config.model } : {}), ...(config.providerId ? { providerId: config.providerId } : {}) } }
  : { endpoint: '/api/image-edit', method: 'POST', body: { action: config.action, imageUrl: config.imageUrl, prompt: config.prompt } };
```

- [ ] **Step 4: GREEN 与相邻回归。** 目标测试和完整 `workflow-engine.test.ts` 均通过；复查 `erase/mask` 不能在没有有效蒙版时误报成功，Task 3 专门处理这条分支。

### Task 2：工作流子任务的文档来源与发布准入

**Files:**
- Modify: `src/app/api/workflow/execute/route.ts:1348-1428,421-449`
- Add: `src/lib/collaboration/workflow-edit-admission.ts`（工作流来源准入；复用现有资产服务，不把画布 projection 当作工作流 projection）
- Inspect/modify only after tests identify the chosen publication seam: `src/lib/collaboration/task-publication.ts`, `src/lib/collaboration/task-publication-intent.ts`, `src/lib/collaboration/task-publication-output.ts`, `src/lib/collaboration/document-media-import.ts`
- Modify: `src/app/api/edit/route.ts:413-426,620-645,814-823`
- Test: `tests/integration/workflow-input-binding-postgres.test.ts`
- Test: 新建 `tests/integration/workflow-edit-source-postgres.test.ts`

**Interfaces:** Consumes已认证 `actorUserId/projectId/workflowId` 与上游真实 `assetVersionId/placementId/imageUrl`；produces经服务器确认的子编辑请求和持久发布意图。不得用节点 JSON 自报的版本 ID 作为授权结论。

- [ ] **Step 1: 真库 RED。** 新测试在文档项目建受权图版本和 `workflow-input` placement，分别运行合法编辑、伪 URL、跨项目版本、撤权、换版；旧代码合法语言编辑返回 action 400，伪来源若改投 `/api/edit` 则可能越过画布准入。断言拒绝时子任务/消费流水/供应商请求均为零，合法来源只发一次。保留个人项目旧 URL 控制组。

```ts
expect(forged.status).toBe(403);
expect((await query("SELECT count(*)::int AS n FROM wujie_credit_transactions WHERE user_id='workflow-editor' AND type='consume'")).rows[0].n).toBe(0);
```

- [ ] **Step 2: 服务端来源 GREEN。** 在工作流执行器中按项目访问类型区分 document/personal；document 使用权威资产版本、当前 placement、规范 URL 和授权代次复验，缺版本直接 409；在 `/api/edit` 收费事务和发送/终态再次复验，不凭工作流父状态跳过。personal 仍走原接口鉴权和收费。受控媒体准备只接收已经落盘并绑定请求的蒙版或版本。**来源准入未接通前，文档编辑节点必须 fail closed；Task 1 的路由 GREEN 不可单独宣称文档可用。**
- [ ] **Step 3: 确定并实现工作流发布接缝。** 先用源码与真库 RED 确认 `task-publication.ts`/`task-publication-intent.ts` 的画布 placement、projection 假设和 `document-media-import.ts` 的任务输出能力；选择“子任务冻结授权→受控导入工作流资产版本”的最小接缝，并记录具体事务/恢复边界。不得仅把 `CanvasTaskPublicationInput.workspace` 放宽为联合类型、只设置 `assetWorkspace='workflow'`、或把画布 placement 冒作工作流 placement。新增的文档结果必须是同项目资产版本，父节点引用它；COMMIT 回执不确定时重读同任务，不删除可能已发布媒体、不重复收费。若该接缝无法满足原有发布原子性，停在 fail-closed，并将实现拆为独立受保护阶段。
- [ ] **Step 4: 真库回归。** `pnpm exec vitest run tests/integration/workflow-edit-source-postgres.test.ts tests/integration/workflow-input-binding-postgres.test.ts`；另覆盖编辑者本人扣费、同键重放、撤权后终态失败/一次退款与原图 SHA 不变。

### Task 3：蒙版、擦除、扩展及异步结果

**Files:**
- Modify: `src/lib/workflow-engine.ts:2036-2048`
- Modify: `src/app/api/workflow/execute/route.ts:421-449,1986-2050,2188-2257` 及父任务结果持久化/恢复分支
- Test: `src/__tests__/lib/workflow-engine.test.ts`
- Test: `tests/integration/workflow-edit-source-postgres.test.ts`

**Interfaces:** Consumes `maskUrl` 及上游来源身份；produces `maskImage` 绑定的 `/api/image-edit` 请求或发送前拒绝，以及父节点中同一子 taskId/版本的最终结果。

- [ ] **Step 1: 分动作 RED。** 无蒙版的 `erase/mask` 在供应商/收费前拒绝；合法蒙版走 `maskImage`，扩展走 `extend`；未知动作也在发送前拒绝。`HTTP 200` 且 `success:false` 必须失败；202 子任务、同步直返和重启轮询均期望同一任务与最终版本，取消后迟到结果不得覆盖。
- [ ] **Step 2: GREEN。** 为蒙版复用文档受权版本或绑定 actor/project/request 的受限持久媒体准备；构建器传目标路由实际接受的字段。普通编辑子任务首次返回 taskId 时将 taskId/幂等身份持久化到父执行检查点（目前仅分层路径有 `activeLayerTasks`）；恢复先按该身份查询、仅轮询已接受任务，不重新 POST；失败保留原始错误及任务身份。同步响应须同时检查 HTTP 与 `success` 字段。
- [ ] **Step 3: 账务与结果回归。** 真库断言一次消费、失败/取消唯一退款、同键重放无第二次供应商提交；主图和蒙版的资产引用分别存在，父节点不把临时公开 URL 误作已发布版本。

### Task 4：门禁和交付

**Files:**
- Modify: `docs/testing/2026-09-28-image-edit-consumer-inventory.md`
- Modify: `J:/无界本地版/projects/_obsidian_wujie/11-阶段进度看板.md`（仅有阶段级结论时）

- [ ] **Step 1: 新鲜全链验证。** 真 PostgreSQL 双用户双项目矩阵；`pnpm ts-check`、目标 ESLint、相关完整 Vitest、`pnpm build`、`pnpm check:protected-baseline` 和严格 NFT 审计逐项记录真实 exit。构建通过不等于 NFT/保护通过。
- [ ] **Step 2: 独立审查与正确预览。** 审查精确源码变动及来源/收费/终态竞态；仅门禁允许时在正确 Chrome 预览页验证节点两类编辑、取消、刷新恢复和三个工作区对同一版本的读取。真实供应商/付费另按当次已批准上限与可核账环境执行；不可验证则记 `UNVERIFIED`。
- [ ] **Step 3: 中文留证。** 更新消费者清单、实施记录和阶段看板，分别列本地、云端、收费、发布门禁；不把 Pear 延期项或 PSD 替代输出加入当前验收。
