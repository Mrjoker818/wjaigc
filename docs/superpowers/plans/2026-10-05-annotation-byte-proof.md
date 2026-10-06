# 8C 原 Task2：旧图片证明贯穿完整执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for this tightly coupled task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接通缺MIME原图的实际证明、本人费用、派发、持久恢复和规范发布，不重做读取基础。

**Architecture:** 服务端读取能力由WeakMap签发；既有publication_intent保存有界证明，原SQL锁只做身份/指纹复验，媒体解码留锁外。登记MIME及私人旧路径保留。

**Tech Stack:** TypeScript、Node crypto、现有managed reader、PostgreSQL、Vitest、publication_intent严格Zod。

**Spec:** `docs/superpowers/specs/2026-10-05-annotation-byte-proof-design.md`

## Global Constraints

- 第七项顺序已按 `docs/testing/2026-10-05-stage7-sequence-gates.md` 纠正：WebSocket前置优先，冻结新的Yjs能力及8D/8E/草图；本计划已存在候选仅做必要缺陷修复、回归及独审，不把安全收尾当前置通过或阶段推进。
- 仅main原地，stable只读；不stage/commit/push/部署/Coze/浏览器/安装/服务重启/付费。
- 原资产、版本、文件、账本不修写；不免费内部请求、不全局放宽MIME、不信任JSON能力。
- 读前后短SQL快照与媒体I/O分离，既有32MiB/2读/64MiB/30秒预算不放宽。
- D893原全链路测试保持不变；原Task1/2/3、8C及发布只有各自完整证据才可关闭。

## 原 Task2 的单个紧耦合接入任务

**Files:** Create `src/lib/annotation-image-byte-proof.ts`、`tests/integration/annotation-byte-proof-postgres.test.ts`；Modify `src/lib/collaboration/task-publication-intent.ts`、`task-publication.ts`、`task-publication-output.ts`、`src/app/api/edit/route.ts`。原D893及其他旧控制只读。独审为侧车，无并行实现，因为上述接口共享准入和持久格式。

**Interfaces:** `prepareAnnotationImageByteProof(source:AuthorizedAnnotationSource, signal?:AbortSignal):Promise<PreparedAnnotationImageByteProof|undefined>`；`annotationImageByteProof(handle, source):AnnotationImageByteProof`；`assertAnnotationImageBytes(handle, source, bytes:Buffer, mimeType:string):void`；`verifyFrozenAnnotationImageByteProof(proof, actorId, ownerId, projectId):Promise<void>`。Prepared类型为WeakMap能力；serialized类型由既有intent的严格schema定义，客户端proposal不接受。

- [x] **Step 1：保存准确修前控制并运行原业务RED。** 复制四已有生产文件到307专属副本（第五条为新证明模块），记录D893、读取304候选/原控制、refs及空index；以显式55494隔离testDB运行 `pnpm exec vitest run tests/integration/annotation-legacy-media-contract-postgres.test.ts --reporter=verbose`。308实际3PASS/1NULL409业务RED、exit1、11.53s；登记PNG控制成功，原断言不改。
- [ ] **Step 2：持久schema与证明。** 在annotationEditSource增加可选严格byteProof（六格式、32MiB、SHA/身份字段），解析后冻结。NULL原图读前后完整指纹/实际managed读取/授权复验签发WeakMap；typed原路径返回undefined。新真库fixture调用 `expect(annotationImageByteProof(handle!, source!)).toMatchObject({mimeType:'image/png',actorUserId:'editor',ownerId:'owner',assetVersionId:'version-shared'})`；`expect(()=>annotationImageByteProof(structuredClone(handle!),source!)).toThrow()`，不同合法字节也拒绝。
- [ ] **Step 3：实际收费与派发接线。** edit认证后生成能力附在server-only CanvasTaskPublicationInput；prepare在clone前读能力，只有对应NULL父版本可有条件通过。冻结byteProof/sourceSnapshot/requestDigest，replay完全比较；worker在loadedImage.buffer进入模型前调用assertAnnotationImageBytes。
- [ ] **Step 4：完成/恢复接线。** prepareTaskPublication先读取原持久intent、释放连接、验证原proof实际字节，然后开启原事务再次匹配证明及来源全行身份；assertTaskPublication保持无媒体I/O，最终原事务复验不删。原D893四案再次运行，必须4PASS，完整202/一次本人-7/无退款/一次canonical/原版本与原文件不变全部实际执行。
- [ ] **Step 5：失败注入与重放/恢复。** 真PG新增来源锁等待变更、合法文件替换、proof/请求摘要失配、grant撤销、JSON能力伪造与非终态重放，逐案断言供应商调用数、任务/consume/refund/command/媒体/源行前后；持久恢复调用原prepareTaskPublication，不用worker正案代替恢复。精确transport与after为离线边界，不称真实付费。
- [ ] **Step 6：准确回归和独审。** 原D893、新proofPG、旧edit/source冻结/原decoder/share/读取等相关完整suite，非增量tsc、五改动生产+新PGtest strictlint、保护基线及前后SHA/限定公共READ ONLY计数各自记录。用307修前候选生成准确增量交独立Spec/Quality，失败不扩allowlist，不把局部4PASS当全仓或8C验收。
- [ ] **Step 7：同步真实结论。** 原Task2和七权威文档/Obsidian同步已执行与未验范围；历史304冻结验证器保留，不改写旧清单接纳新源码。WebSocket欠项不能再后移；其前置关闭后才继续8C剩余→8D剩余→8E→内部Task9→总体8。Pear移出PSD保留，goal ACTIVE，无提交步骤。

## 自审

### 2026-10-05 当前安全收尾终态（不勾关闭原Task2）

WS前置新证据：350–361原源码3629逐SHA副本构建诊断native0，357本轮新产物strictNFT native0，356全仓quietlint0、359两文件15PASS；正式Git身份/当前保护60BLOCK/业务全仓/Coze101多实例重启仍OPEN。副本不是已提交发布树、与旧322不同环境不宣称优化。现有I2–I7/原M1/fault不因构建通过关闭；不新增本计划能力，详细360及权威顺序记录。

初审C0/I7/M1；335同席两轮限定复审仅关闭预读FOR SHARE无超时I1本体及新增锁测试try/finally偏晚M，整体Spec/Quality仍未通过，原席已终态关闭。I2–I7/原M1与fault回收矩阵保持OPEN。328两锁真实RED→最小5行生产修补→329两GREEN，331修后四套53PASS为345小改前；345只两测试严格解析/异常清理，343当前三套16PASS/0skip/57.76秒/native exit0。333 TS2571和342漏配隔离环境guard拒绝均保留，不当产品RED；340非增量tsc/341两test strictlint均终态0空stdout/noTee，332全候选十条旧warning仍exit1。原D893/旧NULL409冲突断言不改，319旧五套239PASS/1冲突/exit1不隐藏。

接续转回WebSocket前置：344现有14文件89PASS不等于云端/全仓，347保护仍60BLOCK，不扩许可；current-candidate完整构建身份/NFT、Coze101/多实例/服务重启仍OPEN。原Task1/2/3和8C仍OPEN，先修候选安全问题不能被解释成新的阶段推进。当前事实见权威顺序记录及335/340–348原件；旧324/325保持历史，不覆写SHA接纳新源码。

proof只在已有媒体读取与任务生命周期之间接缝，不另建授权/任务/费用系统。schema、收费、worker和恢复共享同一版本字段，所以一个紧耦合任务，不把helper完成重新定义为完整Task2完成。路径明确、原全链路断言固定，失败注入和全范围回归仍必做。
