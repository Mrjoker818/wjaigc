# Other 组逐路径只读评审

固定 HEAD `29f7e2df5cb53619c2f5401fa587fbea7882b079`，tree `5b8a6aae374a19bb3a7dd63e1631ec67de8971d9`；GitHub 两次运行使用同树的 `26e021b97bfd92d36210e287ad71f363ff51abb9`。当前未提交并行修复不在审阅版本内。

共 **113 路径：44 条静态审阅未见阻断，69 条 hold**；44 条中含此前真实评审的 5 条 F02 引用。无测试执行，无源码、基线、允许清单或远端写入。仅更新本目录独立报告。

| 去重来源 | other 路径 | 内容 |
| --- | ---: | --- |
| Stage0 精确路径未授权 | 43 | 42 个当前文件 + 1 个删除路径 |
| 旧 review-record blob 失配 | 70 | 32 个修改文件 + 38 个删除路径 |
| 合计 | 113 | 两组无交集；drama 的 47 条未纳入本评审 |

69 条 hold 分为：11 条可定位的当前源码行为、41 条退役/历史数据或任务确认、17 条契约或整合证据待确认。此分类不等于 69 个新回归；缺旧评审 blob 的路径也不等于本次新功能。

原评审记录的 **160 条 entries、67 条 additionalPaths 及全部历史说明完整嵌入 JSON 的 historicalRecordSnapshot**，逐项历史出处另留在 historicalEntries；不覆盖原 source/sourceCommit/sourceBlob。原记录显式 disposition=hold 为 0，说明文字中的既有保留意见仍完整保留。本报告的所有 hold 均保留。

## 优先整合事项

- **#14** [src/app/api/omp-agent/route.ts](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/src/app/api/omp-agent/route.ts:267>)：OMP：扣费后五类错误直接 return，绕过退款。 见逐项依据；未运行复现。
- **#13** [src/app/api/image-to-3d/route.ts](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/src/app/api/image-to-3d/route.ts:729>)：3D：启用 provider 下未对请求 model 做 selectedModels 精确校验。 见逐项依据；未运行复现。
- **#11** [src/app/api/design/vectorize/route.ts](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/src/app/api/design/vectorize/route.ts:232>)：矢量化：全局删除 width/height 会改坏子图形；另有匿名调用与媒体读取边界缺口。 见逐项依据；未运行复现。
- **#10** [src/app/api/auth/register/route.ts](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/src/app/api/auth/register/route.ts:29>)：注册：每次未锁定检查先删计数，连续失败难以累计到锁定阈值。 见逐项依据；未运行复现。
- **#7** [scripts/coze-start.sh](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/scripts/coze-start.sh:19>)：Coze：仅 Supabase HTTP binding 可被当作数据库绑定，但 pg 无连接串；安装失败兜底也未冻结锁文件。 见逐项依据；未运行复现。
- **#28** [src/components/canvas-workspace.tsx](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/src/components/canvas-workspace.tsx:311>)：画布：挂载即删用户节点预设/片段/执行状态，缺保留或导出安排。 见逐项依据；未运行复现。
- **#15** [src/app/api/poll-task/route.ts](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/src/app/api/poll-task/route.ts:2624>)：视频：静音失败只 warn，后续仍可将原音轨作为成功产物保存。 见逐项依据；未运行复现。
- **#51** [src/lib/api-error-translate.ts](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/src/lib/api-error-translate.ts:112>)：错误文案：含中文的原始 JSON 可越过通用兜底返回。 见逐项依据；未运行复现。
- **#113** [tests/e2e/stage-4-node-chat-agent.spec.ts](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/tests/e2e/stage-4-node-chat-agent.spec.ts>)：Stage4：删工作流测试时连带删掉仍有效的 chat→canvas 血缘/刷新恢复覆盖。 见逐项依据；未运行复现。

## 登记契约与证据边界

已读取 [tests/unit/production-acceptance-review-records.spec.ts](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/tests/unit/production-acceptance-review-records.spec.ts>)、[src/__tests__/scripts/stage-1-release-gate-contract.test.ts](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/src/__tests__/scripts/stage-1-release-gate-contract.test.ts>) 和 [scripts/check-protected-baseline.mjs](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/scripts/check-protected-baseline.mjs>)。Stage0 按精确路径授权；review-record 另验当前 blob。Stage1 按 src/ 单文件路径授权，受保护 literal path 缺失又是独立阻断。本报告不自动解除任何门禁。

整合登记应包含 `path / previousReviewedBlob / currentBlob / sourceCommit / disposition / change / risk / testEvidence / blocking / reason / historicalEntries / minimalValidation`。原 entries 保持 160 条历史出处；additionalPaths 当前测试只接受 reviewed 与非空 40 位 reviewedBlob，因此 **hold 或删除路径不可机械追加进去**。删除路径的 currentBlob=null，空 blob 仅用于展示删除 diff，不能伪称当前文件版本。应先决定对应退役及登记契约。完整格式见 JSON.registrationContract。

所有实际测试证据仅引用已有失败作业日志，按原结果保留 pass/fail/skip；套件通过不代表新增边界或真实供应商/生产部署已通过。空证据表示本次未取得结果。大段历史删除文件查看了实际删除 diff 的职责与关键分支，未声称完整认证旧执行器，统一保留 hold。跨组 drama 内部实现由另一人负责。

- [运行 44863279442](https://github.com/Mrjoker818/wjaigc/actions/runs/44863279442)：completed/failure，attempt 1，最后更新 2026-11-21T04:17:08Z。只读 gh GET，无重跑。
- [运行 44863279411](https://github.com/Mrjoker818/wjaigc/actions/runs/44863279411)：completed/failure，attempt 1，最后更新 2026-11-21T04:25:44Z。只读 gh GET，无重跑。

## 逐项记录

### 1. .dockerignore — reviewed

`currentBlob=054f5c1f7483b2e88b893f51f97d6c9631c8f9a9` · `sourceCommit=83a19b79e9c42d9a58bd15b9a25490a3abd22313`

旧评审 blob：`0552f9c835664c08f4f4ae74338a82fd155ba402`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：新增排除src/__tests__、public/uploads、配置导出JSON/zip与tsbuildinfo。
- **风险**：低；减少包内开发数据和凭据导出，不替代包扫描；应与镜像/运行时依赖自举同验。
- **阻断**：本次静态审阅未见。已读旧blob→HEAD完整9行新增diff；43例deploy-package-guard仅是相关合成包测试。
- **已有证据**：[44863279442-136721231942.log:8933](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8933>) `✓ src/__tests__/scripts/deploy-package-guard.test.ts (43 tests) 1331ms`。
- **最小验证/确认**：仅核对发布包追踪清单中 tests/uploads/导出的设置JSON/压缩包均不进入包；deploy-package-guard 43项仅为合成证据。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 2. .github/workflows/quality.yml — reviewed

`currentBlob=5b057b53563c65e098e46d7207fa4ae2d52201f3` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`29d1f6059e8697ffc80ee5e351c0fa5150ac54f1`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：除行尾变化外，语义上只删除Stage4两个workflow renderer环境变量；12分片、needs聚合及DB隔离未放宽。
- **风险**：低；最终10/12分片失败由聚合正确拒绝，Stage4成功元数据不等价于旧workflow场景仍有覆盖。
- **阻断**：本次静态审阅未见。完整diff已检查，行尾噪音单独区分；与节点模式移除一致。
- **已有证据**：[44863279442-136721232111.log:5344](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5344>) `❯ src/__tests__/scripts/isolated-vitest-workflow.test.ts (43 tests | 24 failed) 9034ms`；[44863279442-136721232118.log:4655](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:4655>) `✓ src/__tests__/scripts/quality-workflow-contract.test.ts (12 tests) 15ms`。
- **最小验证/确认**：仅核对移除renderer环境变量后保留的Stage4用例不再读取它；12分片和PostgreSQL门禁仍被保留。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 3. AGENTS.md — reviewed

`currentBlob=af80a38a0be2e85149b79e6d4dd7794d6460436f` · `sourceCommit=83a19b79e9c42d9a58bd15b9a25490a3abd22313`

旧评审 blob：`29ba1bd83c65d89e5beb4668ebb73c2b2a40cea3`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：更新Coze打包/开发沙箱DB强制条件、依赖自举、就绪输出、FFmpeg固定包、迁移需显式许可。
- **风险**：低；文档描述不是生产数据库可用性证据，Supabase-only启动问题随实现hold而非文档声称已验证。
- **阻断**：本次静态审阅未见。已逐行核对4增3删diff；保留迁移安全边界。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：逐段核对Coze生产/沙箱例外与迁移opt-in文档是否对应当前脚本；不启动服务。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 4. package.json — reviewed

`currentBlob=08f7e39606d629e5a94e19e6e81d66dbb378c168` · `sourceCommit=7a5d913431a1fa21bfbf1ce7bb0a0d1c1e53e9ac`

旧评审 blob：`fa7d7613ba5f1fadedfe5367566ced5571073ffa`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：新增build:coze webpack入口及@noble/hashes1.8.0，删除@xyflow/react依赖。
- **风险**：中；锁文件匹配，旧节点依赖去除；常规CI build不是Coze webpack真实部署验收。
- **阻断**：本次静态审阅未见。实际manifest diff已读；新增脚本沿用clear/prune/seal链。
- **已有证据**：[44863279442-136721231942.log:8933](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8933>) `✓ src/__tests__/scripts/deploy-package-guard.test.ts (43 tests) 1331ms`。
- **最小验证/确认**：仅在Coze负责人整合后核对build:coze调用webpack、noble版本和已删除xyflow无剩余依赖；本轮不构建。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 5. pnpm-lock.yaml — reviewed

`currentBlob=f12725bd0017dda9c7b8cfb3d1d2623dc9013602` · `sourceCommit=4e4e262ff32d9aa518d6d51a1e1e8673c19f1275`

旧评审 blob：`ec30451d9b9f1b7133d982ba22b64d769e15f120`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：lock importer增加@noble/hashes并删除xyflow及专用d3拖拽/selection/zoom依赖快照。
- **风险**：低；未改其他库版本，仍需frozen install；CI相关安装/构建成功仅支持依赖一致性。
- **阻断**：本次静态审阅未见。已读完整lock diff；依赖削减与节点功能移除相符。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：仅核对pnpm包声明/锁文件解析一致及xyflow/d3移除范围；不安装依赖或更新lock。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 6. scripts/coze-deploy-build.sh — hold

`currentBlob=2e2d93907e86314f4e78ce217a0ffbdd2b7b9c77` · `sourceCommit=7a5d913431a1fa21bfbf1ce7bb0a0d1c1e53e9ac`

旧评审 blob：`3c8be03fd661d4eb954e852c293ac2c42c605376`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：默认跳过迁移，只有WUJIE_RUN_MIGRATIONS=1执行；识别split/Supabase绑定；改用build:coze。
- **风险**：中；迁移防误触有效；真实webpack Coze产物兼容/无PG但Supabase信号下显式迁移仍未证实。
- **阻断**：是。hold：负责人正在单独处理生产兼容；43例合成脚本测试不能作为真实Coze构建通过凭据。
- **已有证据**：[44863279442-136721231942.log:8933](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8933>) `✓ src/__tests__/scripts/deploy-package-guard.test.ts (43 tests) 1331ms`。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 7. scripts/coze-start.sh — hold

`currentBlob=bd8d067219fb42787c920c9db6d4c069db647ec7` · `sourceCommit=d5ea8853c8e8a170d8a63b234e3177161acf31ce`

旧评审 blob：`1caf76b26df58584d7ba9a8dc89dd26994b0d043`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：打包PROD才硬性检查绑定；新增依赖自举与ignore-scripts重试；仅Supabase信号也启用DB_ONLY。
- **风险**：高；db-client.getConnectionString仍只接受PG URL/split，只有Supabase时guard通过后首次getPool必失败；重试install还丢失frozen-lockfile。
- **阻断**：是。hold：已读50增3删diff并追到db-client.ts:62-89；合成next stub不能证明账号PG可用。
- **已有证据**：[44863279442-136721231942.log:8933](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8933>) `✓ src/__tests__/scripts/deploy-package-guard.test.ts (43 tests) 1331ms`。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 8. scripts/verify-deploy-package.mjs — reviewed

`currentBlob=52a6bdca8d67463607b114cb571e5cd2200b4160` · `sourceCommit=83a19b79e9c42d9a58bd15b9a25490a3abd22313`

旧评审 blob：`0d77284ce32fc016d7f0a548d418e41008d168c3`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：包检查新增assets/wujie-api-settings-*.json文件名拒绝，不读取/打印凭据正文。
- **风险**：低；只防特定命名导出，不宣称扫描任意秘密；与dockerignore双层防护。
- **阻断**：本次静态审阅未见。完整12行新增diff已读；无来源或账号行为变化。
- **已有证据**：[44863279442-136721231942.log:8933](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8933>) `✓ src/__tests__/scripts/deploy-package-guard.test.ts (43 tests) 1331ms`。
- **最小验证/确认**：仅使用虚构文件名验证wujie-api-settings-*.json打包拒绝规则，不读取真实设置文件。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 9. src/__tests__/scripts/deploy-package-guard.test.ts — reviewed

`currentBlob=174144fb62a40a2eef5497b86bb35b349554a28b` · `sourceCommit=7a5d913431a1fa21bfbf1ce7bb0a0d1c1e53e9ac`

旧评审 blob：`60f4dd32a9ed2972eff98c95639a5118d7af08f5`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：新增迁移显式许可矩阵、packaged PROD/split/Supabase及缺node_modules自举用例，build命令期待切换Coze。
- **风险**：中；43例为fake-bin/next合成入口测试，尤其Supabase-only例只断言启动stub而非真正PG读写。
- **阻断**：本次静态审阅未见。已读113增5删diff；测试本身可审，但不能用作Supabase数据库可用性凭据。
- **已有证据**：[44863279442-136721231942.log:8933](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8933>) `✓ src/__tests__/scripts/deploy-package-guard.test.ts (43 tests) 1331ms`。
- **最小验证/确认**：仅验证这43项测试覆盖fake-next/打包筛选/迁移opt-in，真实生产数据库启动交由Coze验收。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 10. src/app/api/auth/register/route.ts — hold

`currentBlob=a14553b16267cb0780f3afb8cb3243e826de691f` · `sourceCommit=77be21c147abb930831ae85457b8d3ecc2434dc8`

旧评审 blob：`无`。引入：`3c0f19d1bdb93cf3ef77eaf19eb0e9a9fd627656` (feat(auth): 新增用户注册系统，支持防恶意注册与开关控制)。

- **变化**：注册默认产品改为canvas,video,chat；完整读取现有注册开关/输入校验/用户创建/session cookie与限流代码。
- **风险**：高；checkRegisterRateLimit会删除lockedUntil=0的失败记录，下一次recordRegisterFailure又从0计数，无法达到5次阈值。
- **阻断**：是。hold：具体控制流缺陷，尚无注册端点限流通过证据；需单IP连续5次失败的最小验证。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 11. src/app/api/design/vectorize/route.ts — hold

`currentBlob=6c50b5b4637861f11ead2b01b42eb50737510ff8` · `sourceCommit=40980aecbc62c3c26d4a2b61b5416a1699922b38`

旧评审 blob：`无`。引入：`dc5983d916fa61cfe44bd827fd2636cc61b8117a` (fix: V62 canvas stability and toolbar provider routing)。

- **变化**：无previousReviewedBlob，读968行矢量化API；多策略管线/LLM/multipart/JSON/本地endpoint，失败明确返回raster wrapper editable=false。
- **风险**：高；输入到文件读取/HTTP fetch缺少明确目录边界与私网重定向约束；normalizeVectorSvg全局删除width/height会损坏rect/图形尺寸；各上游策略未统一SVG安全判定。 路由仅在存在sessionUser时扣费，没有未登录拒绝分支；proxy也不负责身份鉴权，需封堵匿名调用上游。
- **阻断**：是。hold：完整当前源已读；格式校验不能授权任意本地相对路径和网络目标，亦不能证明所有SVG输出已安全归一化。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：定向验证带../的uploads路径、私网/重定向源、含rect尺寸SVG归一化；不读取真实敏感文件，未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 12. src/app/api/image-edit/route.ts — hold

`currentBlob=ba81ba4e87e477f753bdaa070fa20e66f3469b89` · `sourceCommit=40980aecbc62c3c26d4a2b61b5416a1699922b38`

旧评审 blob：`76d850102bfa2ed22502acdcf24a35c6ee3c016d`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：退款新增每请求唯一reference供三处路径复用；Pear real-esrgan限制输入≤1024；错误出口改toUserFacingError。
- **风险**：中；退款reference没有替代跨请求幂等；错误脱敏继承api-error-translate中文JSON漏出问题。
- **阻断**：是。hold：精确diff已读；需与F51错误边界整改联合确认，账务不以hash盖章。
- **已有证据**：[44863279442-136721231853.log:1777](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:1777>) `✓ tests/integration/image-edit-302-identity-postgres.test.ts (28 tests) 15366ms`；[44863279442-136721231853.log:2254](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:2254>) `✓ src/__tests__/api/image-edit-model-execution.test.ts (38 tests) 471ms`；[44863279442-136721231853.log:8177](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:8177>) `✓ src/__tests__/lib/image-edit-provider-boundary.test.ts (140 tests) 571ms`；[44863279442-136721231934.log:5865](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231934.log:5865>) `✓ tests/integration/image-edit-inpaint-admission-postgres.test.ts (7 tests) 3962ms`；[44863279442-136721231934.log:7278](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231934.log:7278>) `✓ src/__tests__/components/image-edit-source-render-contract.test.ts (2 tests) 4ms`；[44863279442-136721231942.log:1963](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:1963>) `✓ tests/integration/image-edit-auxiliary-provider-postgres.test.ts (102 tests) 182035ms`；[44863279442-136721231942.log:9568](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:9568>) `✓ src/__tests__/api/image-edit-mode-routing.test.ts (3 tests) 2ms`；[44863279442-136721231984.log:5374](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5374>) `✓ src/__tests__/components/image-edit-error-contract.test.ts (1 test) 2ms`；[44863279442-136721232042.log:2008](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:2008>) `✓ tests/integration/image-edit-provider-phase-postgres.test.ts (80 tests) 21849ms`；[44863279442-136721232049.log:2270](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:2270>) `❯ tests/integration/image-edit-document-source-postgres.test.ts (101 tests | 1 failed) 88339ms`；[44863279442-136721232049.log:7849](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7849>) `✓ src/__tests__/lib/image-edit-model-plan.test.ts (37 tests) 27ms`；[44863279442-136721232111.log:5171](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5171>) `✓ src/__tests__/api/image-edit-project-admission.test.ts (108 tests) 7503ms`；[44863279442-136721232118.log:1786](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:1786>) `✓ tests/integration/canvas-image-edit-publication-postgres.test.ts (59 tests) 59985ms`；[44863279442-136721232118.log:4639](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:4639>) `✓ src/__tests__/lib/image-edit-publication-output.test.ts (28 tests) 20ms`。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 13. src/app/api/image-to-3d/route.ts — hold

`currentBlob=9a3aaa79417e865087ac7b400ad9adc15b8cedc3` · `sourceCommit=40980aecbc62c3c26d4a2b61b5416a1699922b38`

旧评审 blob：`无`。引入：`dc5983d916fa61cfe44bd827fd2636cc61b8117a` (fix: V62 canvas stability and toolbar provider routing)。

- **变化**：无previousReviewedBlob，读1460行3D四提供商/本地适配；认证、管理员开关、core-v2计费幂等、异步receipt与真实结果。
- **风险**：高；resolveServerProvider按启用id取密钥但model沿用请求，无selectedModels检查，找不到provider还保留请求配置；图片本地读与外部下载缺有界授权。
- **阻断**：是。hold：完整当前源已读；精确模型授权不能确认，多图每项URL及本地endpoint亦缺统一受控边界。
- **已有证据**：[44863279442-136721231853.log:17535](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17535>) `✓ src/__tests__/api/image-to-3d-performance-wiring.test.ts (2 tests) 2ms`；[44863279442-136721232049.log:7998](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7998>) `✓ src/__tests__/api/image-to-3d-task-admission-contract.test.ts (6 tests) 3ms`；[44863279442-136721232049.log:8000](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:8000>) `✓ src/__tests__/api/image-to-3d-workflow-security-contract.test.ts (2 tests) 2ms`。
- **最小验证/确认**：定向验证启用provider下未选择model、禁用/不存在provider、未授权本地endpoint和越界媒体；不用真实供应商/敏感文件，未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 14. src/app/api/omp-agent/route.ts — hold

`currentBlob=a699a037205d960cc821a2f02ca49641c648735a` · `sourceCommit=40980aecbc62c3c26d4a2b61b5416a1699922b38`

旧评审 blob：`无`。引入：`dc5983d916fa61cfe44bd827fd2636cc61b8117a` (fix: V62 canvas stability and toolbar provider routing)。

- **变化**：无previousReviewedBlob，读433行OMP生成API；Web或desktop认证、模板、LLM JSON/SSE、解析与按请求退款编号。
- **风险**：高；扣费后无provider/无model、上游非OK、空回复及超时均直接return绕过外层退款；模型无用户精确授权，provider失败可静默换首个。
- **阻断**：是。hold：扣费267行之后288/297/358/385/409行错误return未走416行退款；这不是仅新增refundReference即可解决的问题。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：模拟上述5种已扣费错误结果验证一次退款；未授权provider/model拒绝且不扣费；未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 15. src/app/api/poll-task/route.ts — hold

`currentBlob=4be866b426536420c244c724a41ea0fbe8bddec0` · `sourceCommit=aa1cb94eece5d2d47fd0ddd152d4560f3ca9aa31`

旧评审 blob：`27a0a27f406fffd417e108f30b6314a05c6987db`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：删除workflow edit发布补偿/结果投影分支；Pear静音后处理、随机UUID文件名、错误文案及视频进度标签。
- **风险**：高；静音失败仅warn后仍保存有声视频；历史workflow任务发布恢复分支被移除。
- **阻断**：是。hold：generateAudio=false不能在静音失败时保证输出无声，且旧任务退役证据缺失。
- **已有证据**：[44863279442-136721231994.log:4374](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4374>) `✓ src/__tests__/api/poll-task-recovery-lease-contract.test.ts (14 tests) 18ms`。
- **最小验证/确认**：定向模拟stripVideoAudioTrack异常，要求失败/显式告警而非无提示成功；用旧workflow已受理任务验证完成/退款去向，未运行。
- **审阅方式**：已读previousReviewedBlob到HEAD blob的实际diff。

### 16. src/app/api/public/media/[...parts]/route.ts — reviewed

`currentBlob=37732171f1fa0651117e7055725b1fa36aa1917a` · `sourceCommit=523c66ab1e3230dc38fe70c83025789e7c3715f2`

旧评审 blob：`无`。引入：`2051fbccd31a682ce8664190ac54333f4e2569c2` (Give providers signed public links to managed media)。

- **变化**：新增签名媒体GET/HEAD，先验path/TTL及魔数再读本地/S3；generated-audio分支按ownerId读取。
- **风险**：中；匿名capability需短TTL与签名保密；读取整文件做HEAD有资源成本，不等于泄露授权。
- **阻断**：本次静态审阅未见。已读当前73行及9例public-media-link、8例public-media-access相关结果；未发真实链接。
- **已有证据**：[44863279442-136721231853.log:17483](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17483>) `✓ src/__tests__/api/public-media-access-contract.test.ts (8 tests) 3ms`；[44863279442-136721231984.log:5311](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5311>) `✓ src/__tests__/lib/public-media-link.test.ts (9 tests) 8ms`。
- **最小验证/确认**：定向验证无签名/过期/错path拒绝，HEAD与GET一致，音频owner约束；不访问真实用户媒体。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 17. src/app/api/simple-chat/chat/route.ts — hold

`currentBlob=798cc66a94b840209183dd5f7a61515ae66a6877` · `sourceCommit=9323d97352515812c60a5cd5909cb5fd487a5d17`

旧评审 blob：`891c7fd4b53923540895fedb9360f759ac5e1609`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：强制显式聊天/图像模型；最多3轮联网工具循环、每轮幂等key，图像最多4并行请求；工作计划与短剧草稿接入，媒体转供应商可读URL。
- **风险**：高；上游原始detail仍会经describeUpstreamChatError暴露；多图计费上限由模型tool calls触发；drama执行链需独立评审。
- **阻断**：是。hold：全部语义diff已读，依赖第75/80项及drama评审；流取消仅客户端断连是否中止付费工具执行尚无证据。
- **已有证据**：[44863279442-136721231853.log:17352](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17352>) `✓ src/__tests__/lib/simple-chat-image-params.test.ts (11 tests) 7ms`；[44863279442-136721232057.log:10425](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10425>) `✓ src/__tests__/lib/simple-chat-upstream.test.ts (6 tests) 4ms`；[44863279442-136721232057.log:10472](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10472>) `✓ src/__tests__/lib/simple-chat-tools.test.ts (3 tests) 3ms`。
- **最小验证/确认**：定向覆盖混合错误脱敏、无明确多图意图的多调用、断流后是否继续生成；汇合drama结论，未运行。
- **审阅方式**：已读previousReviewedBlob到HEAD blob的实际diff。

### 18. src/app/api/video/director/diagnose/route.ts — reviewed

`currentBlob=7fb18db1b6e2811ff7915cb1a22c1039b0e89622` · `sourceCommit=9c8249e9fef309b55152060ce412160ef80456b0`

旧评审 blob：`无`。引入：`dc5983d916fa61cfe44bd827fd2636cc61b8117a` (fix: V62 canvas stability and toolbar provider routing)。

- **变化**：失败诊断端点把failureType/issueType/issue统一为静态lookup，返回建议与上下文并明确尚无视频分析。
- **风险**：低；无模型请求、无持久化，未鉴权只返回公开静态建议及调用者自己输入；异常仍原样message。
- **阻断**：本次静态审阅未见。54行全读；未找到本端点已执行专用测试，不能声称通过。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：定向确认diagnose只返回静态建议，并明确没有声称实际视频分析或调用供应商。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 19. src/app/api/video/extract-frames/route.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=9c8249e9fef309b55152060ce412160ef80456b0`

旧评审 blob：`51f5579b8cb439c4b804e27e062f471389882dc2`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除多帧抽取API（fps/keyframes/uniform/first-last），含鉴权、FFmpeg及临时目录清理。
- **风险**：旧调用方可能仍调用复数extract-frames；单帧extract-frame不是等价替代。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对旧入口调用与新video/tools抽帧模式、上限、返回格式；不运行FFmpeg。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 20. src/app/api/video/tools/route.ts — hold

`currentBlob=f3d9698913071ecef700ff56a22ed2d384568fa9` · `sourceCommit=6a85d629ff913c839ff8c374eab8ff2d55f580db`

旧评审 blob：`84e47209558a86f057d3a7878f3d9bb0fcc9e35c`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：内嵌150MB有界下载器迁到video-media-io；拼接由concat -an改为probe+buildRenderPlan保留音轨/补静音。
- **风险**：中高；下载安全边界和音视频时间线依赖新公共helper与drama render。
- **阻断**：是。hold：本项diff已读；drama render由另一评审负责，本项未代其确认，需汇合其结论再决定接口放行。
- **已有证据**：[44863279442-136721231994.log:4430](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4430>) `✓ src/__tests__/api/video-tools-frame-time-and-source-read.test.ts (10 tests) 619ms`。
- **最小验证/确认**：仅验证大小限制、私网/重定向源与有声+无声多片段拼接；等待drama render评审，未运行。
- **审阅方式**：已读previousReviewedBlob到HEAD blob的实际diff。

### 21. src/app/api/workflow/execute/route.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`1a212705aeb8e6b27b9c9913d9e52bb348186dcb`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除整个工作流执行API：start/status/cancel、DAG调度、租约恢复、accepted edit续跑及CPU图片retry。
- **风险**：高；已受理/计费旧任务的查询、取消及发布恢复入口一并消失。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：先取旧processing/publication-pending任务只读清单并确认终态/退款去向；不得自动迁移。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 22. src/app/api/workflow/image-actions/route.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`5b3dda0c8fb8fda51470e70dedeb151079e5f818`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除CPU九宫格image-actions API及48MiB/10秒入站限制、严格schema、幂等发布和错误映射。
- **风险**：旧客户端的unknown操作失去同operationId重试/对账入口。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认旧grid operation及临时产物无待确认COMMIT；核对旧客户端响应，未运行。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 23. src/app/canvas/page.tsx — reviewed

`currentBlob=bd4119f6e4ec83b9770b5908974e81ed9e3ad000` · `sourceCommit=a92adf9d81faf9ec48cb94466599ceb35b2b86f5`

旧评审 blob：`无`。引入：`a92adf9d81faf9ec48cb94466599ceb35b2b86f5` (Give canvas, video and chat their own addresses and a switcher between them)。

- **变化**：新增/canvas别名复用根page，不复制业务实现。
- **风险**：低；权限仍依赖workspace既有session/platform路由，别名本身不绕过校验。
- **阻断**：本次静态审阅未见。当前2行全读并核对platform-routes；无专用别名运行证据。
- **已有证据**：[44863279442-136721231994.log:4458](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4458>) `✓ src/__tests__/lib/platform-routes.test.ts (7 tests) 5ms`。
- **最小验证/确认**：仅核对/canvas别名与带projectId刷新恢复，平台未授权的跳转仍由宿主控制。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 24. src/app/chat/layout.tsx — reviewed

`currentBlob=3cd90aae083db1a9bf86411cdd42b9d842e5394d` · `sourceCommit=a92adf9d81faf9ec48cb94466599ceb35b2b86f5`

旧评审 blob：`无`。引入：`a92adf9d81faf9ec48cb94466599ceb35b2b86f5` (Give canvas, video and chat their own addresses and a switcher between them)。

- **变化**：新增/chat layout包Providers并声明智能对话metadata。
- **风险**：低；与旧simple-chat共享provider，无独立权限降级。
- **阻断**：本次静态审阅未见。当前12行全读；无专用layout已执行证据。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：仅核对/chat布局包装children、主题及高度不遮挡原聊天入口；需要时做单页窄屏检查。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 25. src/app/chat/page.tsx — reviewed

`currentBlob=0890f0ee19c3b6fd8a039c5493828ce8cc8df942` · `sourceCommit=a92adf9d81faf9ec48cb94466599ceb35b2b86f5`

旧评审 blob：`无`。引入：`a92adf9d81faf9ec48cb94466599ceb35b2b86f5` (Give canvas, video and chat their own addresses and a switcher between them)。

- **变化**：新增/chat page直接重导出simple-chat/page。
- **风险**：低；兼容旧入口，登录检查仍在被导出页面。
- **阻断**：本次静态审阅未见。当前1行全读；平台路由相关测试不等价于完整别名E2E。
- **已有证据**：[44863279442-136721231994.log:4458](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4458>) `✓ src/__tests__/lib/platform-routes.test.ts (7 tests) 5ms`。
- **最小验证/确认**：仅核对/chat与/simple-chat同一页面模块、会话上下文和查询参数承接。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 26. src/app/video/page.tsx — reviewed

`currentBlob=94854abc937ca0a3433e0a43eb8acf63d8f49450` · `sourceCommit=a92adf9d81faf9ec48cb94466599ceb35b2b86f5`

旧评审 blob：`无`。引入：`a92adf9d81faf9ec48cb94466599ceb35b2b86f5` (Give canvas, video and chat their own addresses and a switcher between them)。

- **变化**：新增/video别名复用根page，由workspace path选择drama模式。
- **风险**：低；不审drama内部，入口映射由同组platform-routes维护。
- **阻断**：本次静态审阅未见。当前2行全读；只引用平台路由测试，不宣称drama已验收。
- **已有证据**：[44863279442-136721231994.log:4458](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4458>) `✓ src/__tests__/lib/platform-routes.test.ts (7 tests) 5ms`。
- **最小验证/确认**：仅核对/video进入宿主drama模式及未授权video账号回退；内部drama行为等另一评审。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 27. src/components/brand-ecommerce/BrandAssetManager.tsx — reviewed

`currentBlob=05c7bd7dc5d53ac68334f6697909517528788402` · `sourceCommit=994f8a274134f4e372cf9c4491ac43d43c74147f`

旧评审 blob：`873ac7f24ce86db5612e28916c17ee62332ca44f`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：BrandAssetManager移除全桌面44px下限，改共享touch-button/field-targets。
- **风险**：低；样式变更不影响保存/应用逻辑，coarse和窄屏仍需44px。
- **阻断**：本次静态审阅未见。逐行1换1diff已读；相关mobile可见性测试不能替代全部桌面场景。
- **已有证据**：[44863279442-136721232118.log:3768](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:3768>) `✓ src/__tests__/components/brand-assets-mobile-visibility-native.test.tsx (4 tests) 4198ms`。
- **最小验证/确认**：仅核对资产弹层新增touch target类在触屏生效、收藏/归档回调不变。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 28. src/components/canvas-workspace.tsx — hold

`currentBlob=b78149cb75918bfb5912082b434499b5a2bcbab0` · `sourceCommit=e0658f0c7cb9494595cb44471ba984bdeeb9a6dc`

旧评审 blob：`a1fb879319760b5d054376485655f285b1a43d17`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除节点/工作流中心及原视频提交轮询/文档发布；改三平台和短剧回画布；新增挂载时清除旧节点localStorage及服务端确认后新建项目。
- **风险**：高；clearRetiredNodeModeStorage无导出/迁移即删除用户预设、prompt snippets和执行状态；原metadata保留及旧视频/工作流恢复链撤销。
- **阻断**：是。hold：逐blob审阅具体新增和删除diff；清理用户本地数据与旧任务退役尚无保留/授权依据，drama内部由另一人审核。
- **已有证据**：[44863279442-136721231984.log:6001](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:6001>) `✓ src/__tests__/components/canvas-workspace-new-project-hydration.test.ts (6 tests) 498ms`；[44863279442-136721231994.log:4458](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4458>) `✓ src/__tests__/lib/platform-routes.test.ts (7 tests) 5ms`；[44863279442-136721232057.log:10453](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10453>) `✓ src/__tests__/components/canvas-workspace-place-film-contract.test.ts (3 tests) 5ms`；[44863279442-136721232111.log:5710](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5710>) `✓ src/__tests__/components/canvas-workspace-session-revalidation-contract.test.ts (1 test) 2ms`。
- **最小验证/确认**：先确认旧预设/片段保留或导出方案；旧任务/项目恢复、跨账号切换时待放置素材的作用域做定向验证，未运行。
- **审阅方式**：已读previousReviewedBlob到HEAD blob的实际diff。

### 29. src/components/canvas/CanvasHelpModal.tsx — hold

`currentBlob=2a1ed2d7bc9d5a8a77ddc614768f9de2dbde3fc5` · `sourceCommit=9c8249e9fef309b55152060ce412160ef80456b0`

旧评审 blob：`da8b58e3ee7bffc9e3a3801d55e028dc60189c48`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：帮助图卡删除擦除/蒙版/移除背景/编辑元素说明，视频入口改短剧；仍列节点编辑器。
- **风险**：低但信息不一致：节点实现已删除，帮助底栏表仍宣称节点编辑器可达。
- **阻断**：是。hold：实际diff保留了已不存在节点项；需同步帮助文案与产品移除决策。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 30. src/components/dashboard/admin-tabs.tsx — reviewed

`currentBlob=6e228141eaaae01b99bca4701848807b7cd7967f` · `sourceCommit=994f8a274134f4e372cf9c4491ac43d43c74147f`

旧评审 blob：`cea45330fada8172b9bdefdbf49db41f8dcb722c`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：用户管理新增desktop compact类/16px checkbox/32px actions及video产品选项；通用按钮改touch scope。
- **风险**：中；仅布局及产品枚举，操作handler未替换；需要桌面/触屏分流确认。
- **阻断**：本次静态审阅未见。已读全部changed hunks（长class重复部分单独复核），未发现新增权限逻辑。
- **已有证据**：[44863279442-136721232042.log:6554](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6554>) `✓ src/__tests__/components/dashboard-responsive.test.tsx (26 tests) 10066ms`；[44863279442-136721232118.log:4649](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:4649>) `✓ src/__tests__/components/tool-panel-control-density.test.ts (3 tests) 1880ms`。
- **最小验证/确认**：仅核对管理员tab的紧凑按钮/checkbox触屏目标与video角色控件；无须重跑账号大套。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 31. src/components/dashboard/data-manager-tab.tsx — reviewed

`currentBlob=e5e3fb4423040cf1106dc51e7644912a6ec9c8de` · `sourceCommit=994f8a274134f4e372cf9c4491ac43d43c74147f`

旧评审 blob：`46571c8415611ddefa51046d0c634b69896ae75a`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：数据管理弹窗全局按钮44px改touch-button-targets。
- **风险**：低；保留max-height、overflow、theme及事件，桌面密度改变不应当作移动不可达。
- **阻断**：本次静态审阅未见。完整1换1diff已读；无本路径特定已执行结果不写通过。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：仅核对数据管理弹层touch类与原导入导出操作边界；不导入真实数据。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 32. src/components/dashboard/desktop-admin-tab.tsx — reviewed

`currentBlob=0bb499a59921160c22e12af95573acd4174f85ea` · `sourceCommit=994f8a274134f4e372cf9c4491ac43d43c74147f`

旧评审 blob：`93c1f2d34f5deea046ae843f8d16cc70e40246fe`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：管理员AlertDialog按钮44px改touch scope，焦点恢复回调不变。
- **风险**：低；仅class变更，不扩展删除权限或行为。
- **阻断**：本次静态审阅未见。完整1换1diff已读。
- **已有证据**：[44863279442-136721232042.log:6554](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6554>) `✓ src/__tests__/components/dashboard-responsive.test.tsx (26 tests) 10066ms`。
- **最小验证/确认**：仅核对桌面管理弹层触屏尺寸及原操作回调；不修改用户设置。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 33. src/components/help-guide.tsx — reviewed

`currentBlob=767067b7b614a1cec3d547d05284e13bf02906ee` · `sourceCommit=9c8249e9fef309b55152060ce412160ef80456b0`

旧评审 blob：`16468376417f2dccb8c14ea939c48d6770c1de4e`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：帮助导航删除node-editor章节，视频改短剧制作，快捷键/画布工具说明同步。
- **风险**：低；不审drama实现；文本可能仍有旧功能残留需按入口表审查。
- **阻断**：本次静态审阅未见。21增57删具体diff已读，节点专章和快捷键撤下，无测试通过宣称。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：逐项核对帮助删除节点章节后其余导航有效，视频描述与已确认的短剧范围相符。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 34. src/components/image-preview.tsx — reviewed

`currentBlob=7f697978fba48a55f15a358ebcd591a86b8c6e5a` · `sourceCommit=994f8a274134f4e372cf9c4491ac43d43c74147f`

旧评审 blob：`a3989add471889cb0e2620d8f69a49aa00615a6e`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：图片预览全域44px按钮下限改touch-button-targets，焦点ring/缩放布局保留。
- **风险**：低；实际移动/3D长按未在本diff修复，不承诺其验收。
- **阻断**：本次静态审阅未见。完整1换1diff已读。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：仅核对预览弹层按钮触屏目标及下载入口可达；不执行大图导出。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 35. src/components/infinite-canvas.tsx — hold

`currentBlob=d00284d702baf01c447ff65a003689367aa4f263` · `sourceCommit=e0658f0c7cb9494595cb44471ba984bdeeb9a6dc`

旧评审 blob：`a7e5aa45c081776fafb6ed1dfb4f196e5cf7a2e8`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：PNG编码与弹窗复用已审F02；复制清除原placement身份；批注提示同步；全景补占位终态；移除擦除/蒙版/编辑元素与视频编辑延长，模型目录筛工具。
- **风险**：高；可见功能撤回范围广；复制清除身份后受控采纳/删除原图互不影响需证据；批注版本边界承接第50项。
- **阻断**：是。hold：全部语义diff已读；F02仅证明PNG/下载范围，不能为删除功能及批注版本行为背书。
- **已有证据**：[44863279442-136721231853.log:17349](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17349>) `✓ src/__tests__/lib/canvas-toolbar-layout.test.ts (6 tests) 4ms`；[44863279442-136721231934.log:7249](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231934.log:7249>) `✓ src/__tests__/components/canvas-toolbar-entry-manifest.test.ts (7 tests) 20ms`；[44863279442-136721231942.log:4006](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:4006>) `✓ src/__tests__/components/canvas-panorama-dp-native.test.tsx (11 tests) 40975ms`；[44863279442-136721231942.log:8981](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8981>) `✓ src/__tests__/components/canvas-toolbar-floating-windows.test.ts (17 tests) 1877ms`；[44863279442-136721232049.log:7840](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7840>) `✓ src/__tests__/components/annotation-controller.test.ts (16 tests) 8ms`；[44863279442-136721232057.log:10475](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10475>) `✓ src/__tests__/lib/mobile-canvas-toolbar.test.ts (1 test) 2ms`；[44863279442-136721232118.log:3565](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:3565>) `✓ src/__tests__/components/canvas-toolbar-available-width-native.test.tsx (10 tests) 36365ms`；[44863279442-136721232118.log:7223](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:7223>) `✓ src/__tests__/components/canvas-png-download-bounds.test.tsx (10 tests) 1670ms`。
- **最小验证/确认**：确认功能移除范围；定向验证复制后删除不删原件、全景终态、批注版本变化；浏览器失败归因见原CI报告，未运行。
- **审阅方式**：已读previousReviewedBlob到HEAD blob的实际diff。

### 36. src/components/node-editor.tsx — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`361cf33d3958b04dfe5dc7e8c5e30453190d74f6`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除6418行节点编辑器，含导入导出、预设、文档模式、执行/retry恢复、批注与拖拽同步。
- **风险**：高；不是单纯展示移除，未导出节点数据及执行恢复UI一同退役。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认节点预设/导出保留和旧任务查看方式；结合canvas-workspace本地数据清理hold。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 37. src/components/platform/platform-switcher.tsx — reviewed

`currentBlob=09b016836e71d32438df14e8a8fd70d3a28f1133` · `sourceCommit=a92adf9d81faf9ec48cb94466599ceb35b2b86f5`

旧评审 blob：`无`。引入：`a92adf9d81faf9ec48cb94466599ceb35b2b86f5` (Give canvas, video and chat their own addresses and a switcher between them)。

- **变化**：平台切换真实a链接，携project/dramaId；普通点击可应用内切换，修饰键保留浏览器行为。
- **风险**：低；当前平台点击在检查修饰键前preventDefault，Ctrl点当前tab不能新开，属于轻微交互余量。
- **阻断**：本次静态审阅未见。当前38行全读；平台权限从调用方platforms过滤，未自授平台。
- **已有证据**：[44863279442-136721231994.log:4458](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4458>) `✓ src/__tests__/lib/platform-routes.test.ts (7 tests) 5ms`。
- **最小验证/确认**：定向验证当前平台、其它平台、带项目切换及Ctrl/Meta点击的导航行为；不把切换器当API鉴权。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 38. src/components/quick-create-panel.tsx — hold

`currentBlob=d6199d1a69f27e7313d644d3b9f469668563fcb9` · `sourceCommit=9c8249e9fef309b55152060ce412160ef80456b0`

旧评审 blob：`无`。引入：`4bfce97b8493937458d8db6198a23b13559c9bc3` (feat: 完成 P0 快速创作入口与视频延长路由)。

- **变化**：无previousReviewedBlob，读927行快速创作；识别用途和参数、模型临时覆盖、上传参考图、编译状态及短剧跳转。
- **风险**：中；上传最多4但叠加选中画布图可传5张，和界面“最多4张”不一致；异步上传无账号/项目切换作用域。
- **阻断**：是。hold：referenceImages合并selected+uploaded未最终限4，需确认上游数量/作用域契约。
- **已有证据**：[44863279442-136721231853.log:17542](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17542>) `✓ src/__tests__/components/quick-create-fallback-contract.test.ts (1 test) 2ms`；[44863279442-136721232118.log:4730](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:4730>) `✓ src/__tests__/components/quick-create-project-scope-contract.test.ts (1 test) 2ms`。
- **最小验证/确认**：4张上传+选中图、上传中切换项目/账号、失效模型override做定向用例；未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 39. src/components/simple-chat/chat-area.tsx — hold

`currentBlob=07ab1238e97d7935d009f06bb1f798f8dc129781` · `sourceCommit=e0658f0c7cb9494595cb44471ba984bdeeb9a6dc`

旧评审 blob：`e741b4ead8502659b048c468045ff44002499727`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：自动skill/工作计划/推理/短剧卡片、PDF真实响应校验，编辑/重生成复用原请求并新建幂等key，停止按钮AbortController；移除旧工作流返回消费。
- **风险**：高；停止当前流并非保证已提交远端付费任务取消；旧回传链接失去消费/持久化逻辑；PDF子范围可引用F02。
- **阻断**：是。hold：全部语义diff已读；需明确停止后任务和扣费状态、旧回传链接退役处理，等待drama独立结论。
- **已有证据**：[44863279442-136721231984.log:5312](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5312>) `✓ src/__tests__/api/simple-chat-pdf-prompt.test.ts (6 tests) 104ms`；[44863279442-136721232049.log:8028](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:8028>) `✓ src/__tests__/components/simple-chat-pdf-output.test.tsx (30 tests) 1404ms`；[44863279442-136721232111.log:5691](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5691>) `✓ src/__tests__/components/simple-chat-regenerate-stop.test.ts (4 tests) 3ms`；[44863279442-136721232118.log:4737](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:4737>) `❯ src/__tests__/workflow-return-concurrent-messages.test.tsx (25 tests | 14 failed) 15739ms`。
- **最小验证/确认**：定向验证停止时已受理图片任务、切任务后迟到流、旧workflow返回链接；未运行。
- **审阅方式**：已读previousReviewedBlob到HEAD blob的实际diff。

### 40. src/components/simple-chat/skill-trace-card.tsx — reviewed

`currentBlob=b488ce6d3ff60e580af23c92478a3bc0a2513968` · `sourceCommit=e0658f0c7cb9494595cb44471ba984bdeeb9a6dc`

旧评审 blob：`无`。引入：`4a8b726aeaa4856f3b0e58cb378a9fe7bcfecde3` (feat(simple-chat): 自动技能 picks a preset skill per request from /ppt-style commands, the composer select or keywords, and the reply shows which skill answered)。

- **变化**：18 additions/7 deletions。PDF独立4阶段与生成状态/错误prop；数据可解析不再等于PDF已生成，非PDF仍用原SKILL_FILE_STEPS/deriveSkillFileSteps。
- **风险**：低。纯展示不产生网络/存储写入；React文本插值转义错误。完成状态依赖调用方：本次验证只到MIME+%PDF-头及触发下载，不等于浏览器落盘已完成；状态未持久化，刷新后重新显示待生成。
- **阻断**：本次静态审阅未见。引用本会话已完成的F02实际diff及测试审查，blob未变。
- **已有证据**：[44863279442-136721232049.log:8028](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:8028>) `✓ src/__tests__/components/simple-chat-pdf-output.test.tsx (30 tests) 1404ms`。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：prior actual F02 review。先前 F02 真实记录见 JSON.priorReview；本轮未重复审查。

### 41. src/components/simple-chat/work-plan-card.tsx — reviewed

`currentBlob=6e055719816833d2f55468bf27c58d21ded656cf` · `sourceCommit=f078f749f7a103bc27f10a00a5b8de4060b63a0c`

旧评审 blob：`无`。引入：`c549a5f7630480be0a5fc7d50946726d942e62e4` (feat(simple-chat): work mode with a step plan read from the reply, edit re-runs in place)。

- **变化**：工作计划卡从模型真实步骤标题派生进度；完成但未输出步骤时隐藏，不伪造已执行动作。
- **风险**：低；是文本进度不是工具执行证明；步骤跳过/待回复状态单独显示。
- **阻断**：本次静态审阅未见。85行全读；derive由chatgpt-work-mode11例覆盖，卡片专用运行证据另查。
- **已有证据**：[44863279442-136721232042.log:6468](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6468>) `✓ src/__tests__/lib/chatgpt-work-mode.test.ts (11 tests) 8ms`。
- **最小验证/确认**：仅验证计划四步标题/进行中/未完成回复的展示，确认状态不是实际执行凭据。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 42. src/components/ui/dropdown-menu.tsx — reviewed

`currentBlob=e56ff8304bf165e22cefe002869d23165e96eccd` · `sourceCommit=994f8a274134f4e372cf9c4491ac43d43c74147f`

旧评审 blob：`无`。引入：`dc5983d916fa61cfe44bd827fd2636cc61b8117a` (fix: V62 canvas stability and toolbar provider routing)。

- **变化**：Radix菜单封装，highlight/open统一menu颜色及子项图标继承，portal层级400。
- **风险**：低；封装保留Radix键盘/焦点属性及props，视觉和触屏表现仍须浏览器验证。
- **阻断**：本次静态审阅未见。已读当前257行及引入记录，未发现阻断性逻辑变更。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：若需要浏览器验证，只查键盘上下移动、子菜单焦点及highlight颜色继承。 本轮未执行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 43. src/components/ui/select.tsx — reviewed

`currentBlob=a70cca8bfd6347d2d153eb2ba288275caf9da361` · `sourceCommit=994f8a274134f4e372cf9c4491ac43d43c74147f`

旧评审 blob：`无`。引入：`dc5983d916fa61cfe44bd827fd2636cc61b8117a` (fix: V62 canvas stability and toolbar provider routing)。

- **变化**：Radix Select封装，trigger尺寸、portal定位及highlight文字图标色继承。
- **风险**：低；依赖Radix行为，未新增选择状态或网络调用。
- **阻断**：本次静态审阅未见。已读190行当前文件及引入记录；不将组件源码视为浏览器验收。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：若需要浏览器验证，只查Select键盘选择、滚动和选中项highlight的文字/图标可读性。 本轮未执行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 44. src/components/video-edit-panel.tsx — hold

`currentBlob=null (deleted)` · `sourceCommit=9c8249e9fef309b55152060ce412160ef80456b0`

旧评审 blob：`336c172e1ab3f6d0466e936d0fc0172470ceeb83`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除视频编辑/延长面板、固定源会话key、播放器和提交loading/错误反馈。
- **风险**：视频编辑与延长能力从画布撤回；短剧入口不证明覆盖两种旧能力。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认编辑/延长的产品退役范围及已生成视频可查看/下载；未运行。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 45. src/components/workflow-hub.tsx — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`c355e6ae90efafb2cc75a48234dc498f797b9628`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除工作流中心的已保存列表、导入导出、预设、收藏/更新保存及回滚。
- **风险**：用户已有工作流失去查看/导出入口，与删除本地预设一起有数据可达性风险。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认已有工作流只读导出/保留安排，不能仅更新源码允许清单。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 46. src/components/workflow/WorkflowContextMenu.tsx — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`6572c778dadf935a0b7f9ad49ad77979c0b51a24`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除节点/画布上下文菜单的复制、粘贴、删除、连接操作及焦点/触屏关闭处理。
- **风险**：低到中；随节点UI退役合理，但旧消费者或可访问页面残留尚未证明清空。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认没有可访问节点页面/引用该菜单，结合整组退役批准；未运行。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 47. src/components/workflow/WorkflowLibraryContent.tsx — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`6e60f6fc2a6e29dbd5d15b88a378e7f8bb68790c`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除素材/提示词/预设库展示，独立搜索、失败预览空态及44px使用按钮。
- **风险**：低；该组件自身无授权/持久化，移除影响内容入口可达性。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认预设与提示词仍可从保留功能访问/导出，并确认节点退役；未运行。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 48. src/components/workflow/WorkflowPortTargets.tsx — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`d0eaf8e27b6d90fe32e8ff0a377e77595b821dfb`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除屏幕空间44px端口命中层及冲突端口fallback列表集成。
- **风险**：低；仅节点渲染交互，不能把其删除解释为移动端门禁已通过。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认节点渲染器无剩余可达使用点；不重跑移动全套。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 49. src/features/annotations/node-annotation-workspace.tsx — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`741a037349868d68f895cfa87977d951aac151b5`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除节点批注工作区、模型选择、pointer取消/捕获及生成节点回调。
- **风险**：中；画布批注仍存活，不能因此移除通用批注版本/作用域保障。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认节点批注退役及画布批注替代边界，参照第50项版本hold。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 50. src/features/annotations/use-annotation-controller.ts — hold

`currentBlob=3db6b063602452e765aa14efb66179fc1ca2e7f6` · `sourceCommit=67b252d4f666c2f215b57fc0519b4a09c0484e9b`

旧评审 blob：`无`。引入：`6a0b5cd90ea30a0099358699b9dba96f579a9be1` (feat(annotations): 安装 ChatCanvas 融合批注 r4 升级包)。

- **变化**：独立批注控制器支持五类手势、10条上限、ref即时同步、源迁移及跨图片清空。
- **风险**：高；sourcesMatch明确忽略versionId，同一imageId新版本可沿用旧批注/源锁，异步语义识别回调也无请求源token。
- **阻断**：是。hold：需证明版本切换/延迟语义识别不会把旧几何应用到新图；707行当前源已读，不靠文件摘要放行。
- **已有证据**：[44863279442-136721231853.log:16829](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:16829>) `✓ tests/integration/annotation-source-postgres.test.ts (11 tests) 2352ms`；[44863279442-136721232042.log:6208](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6208>) `✓ src/__tests__/lib/annotation-source-unavailable.test.ts (37 tests) 39ms`；[44863279442-136721232049.log:7840](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7840>) `✓ src/__tests__/components/annotation-controller.test.ts (16 tests) 8ms`。
- **最小验证/确认**：定向验证同imageId不同versionId及识别期间切图后迟到结果；未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 51. src/lib/api-error-translate.ts — hold

`currentBlob=f823e798514af2930626663c7258fccb1940f860` · `sourceCommit=15a7a970e47ed84a05c52cac7c7fde022e37b1c9`

旧评审 blob：`无`。引入：`dc5983d916fa61cfe44bd827fd2636cc61b8117a` (fix: V62 canvas stability and toolbar provider routing)。

- **变化**：新增错误分类中文化及toUserFacingError最终兜底。
- **风险**：高；兜底遇含中文原始JSON仍原样返回，诸如中文错误+敏感属性会越过startsWith/API英文判定。
- **阻断**：是。hold：118行当前文件全读，4例现有测试仅证明列出案例；未证明所有JSON或混合文字脱敏。
- **已有证据**：[44863279442-136721232057.log:10459](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10459>) `✓ src/__tests__/lib/api-error-translate.test.ts (4 tests) 2ms`。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 52. src/lib/api-validator.ts — hold

`currentBlob=bf637d24b4972dce9b5296fd371f96bc8ee6a82f` · `sourceCommit=856f4204ec4e0b59aed303de84c357c487b746c6`

旧评审 blob：`无`。引入：`dc5983d916fa61cfe44bd827fd2636cc61b8117a` (fix: V62 canvas stability and toolbar provider routing)。

- **变化**：新增通用schema包装、基础图像/视频URL及请求字段校验。
- **风险**：高；视频URL私网判定未涵盖IPv4映射IPv6/ULA等；包装器对JSON null直接按key取值也可能抛错。
- **阻断**：是。hold：不能把当前URL格式过滤当作完整SSRF防线；需确认下游网络边界并补边界输入验证。
- **已有证据**：[44863279442-136721231934.log:7219](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231934.log:7219>) `✓ src/__tests__/lib/api-validator.test.ts (34 tests) 4ms`。
- **最小验证/确认**：定向验证映射IPv6/ULA/重定向/解析到私网及JSON null，核对实际发起网络请求的二次校验；未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 53. src/lib/apimart-video-models.ts — reviewed

`currentBlob=944317077f7627197acbed4f50a59a489af1d596` · `sourceCommit=93fd690c1efdca663799405130bb2b4808a086c2`

旧评审 blob：`无`。引入：`93fd690c1efdca663799405130bb2b4808a086c2` (Add the remaining documented APIMart video models with vendor prices)。

- **变化**：APIMart视频模型静态注册表，逐型号约束时长、比例、分辨率、输入数量及操作。
- **风险**：中；静态能力表需要供应商协议证据，无法由表本身证明线上型号支持。
- **阻断**：本次静态审阅未见。已读161行当前表及引入记录；限于本地注册逻辑可审阅，未宣称供应商实测。
- **已有证据**：[44863279442-136721231942.log:8935](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8935>) `✓ src/__tests__/lib/apimart-video-contract.test.ts (42 tests) 14ms`。
- **最小验证/确认**：只对照apimart-video-contract中各型号字段约束，不发真实付费请求；能力表变更需供应商快照。 本轮未执行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 54. src/lib/canvas-chat-history.ts — reviewed

`currentBlob=dc9132e28636be9539b47bfc1c4293707626ac7c` · `sourceCommit=6385865a3652f056616d1dd990db4245be5388c4`

旧评审 blob：`无`。引入：`6385865a3652f056616d1dd990db4245be5388c4` (Fix chat regenerate and add stop generation)。

- **变化**：聊天历史按消息数/图片窗口裁剪，从用户轮次起始；恢复附件asset/version/placement并定位最后轮次。
- **风险**：低；裁剪不改原数组，但limit=0时slice(-0)会取全量，调用方应使用正限额。
- **阻断**：本次静态审阅未见。88行全读；新增路径历史引入另列，相关history测试是否执行按日志。
- **已有证据**：[44863279442-136721231984.log:5350](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5350>) `✓ src/__tests__/lib/canvas-chat-history.test.ts (6 tests) 3ms`。
- **最小验证/确认**：定向验证当前任务历史筛选/裁剪以及limit=0语义；调用者需要明确0是空集还是无限。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 55. src/lib/canvas-download-popup.tsx — reviewed

`currentBlob=512e73a26c7cb9479e6faaaae96cbd78527aa930` · `sourceCommit=e0658f0c7cb9494595cb44471ba984bdeeb9a6dc`

旧评审 blob：`无`。引入：`e0658f0c7cb9494595cb44471ba984bdeeb9a6dc` (fix: recover chat snapshots and correct canvas exports and credit refresh)。

- **变化**：新增65行：下载面板portal到body，按自身尺寸限制在画布与visualViewport交集，避开顶部/底部工具栏；ResizeObserver与viewport事件重排并清理，隔离pointer/mouse/click/wheel。
- **风险**：中，真实浏览器布局边界。CI的10例中2例几何检查由jsdom测量替身提供；原生Edge3例被环境开关跳过。手机底部112px为固定预留，visualViewport offset/软键盘及画布仅平移不resize的行为未获这次CI原生证据。
- **阻断**：本次静态审阅未见。引用本会话已完成的F02实际diff及测试审查，blob未变。
- **已有证据**：[44863279442-136721232118.log:7223](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:7223>) `✓ src/__tests__/components/canvas-png-download-bounds.test.tsx (10 tests) 1670ms`；[44863279442-136721231942.log:9485](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:9485>) `↓ src/__tests__/components/canvas-export-offline-edge.test.ts (3 tests | 3 skipped)`。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：prior actual F02 review。先前 F02 真实记录见 JSON.priorReview；本轮未重复审查。

### 56. src/lib/canvas-png-export.ts — reviewed

`currentBlob=9f7565761d9938495e3a83a0afbc4b86ee7608e3` · `sourceCommit=e0658f0c7cb9494595cb44471ba984bdeeb9a6dc`

旧评审 blob：`无`。引入：`e0658f0c7cb9494595cb44471ba984bdeeb9a6dc` (fix: recover chat snapshots and correct canvas exports and credit refresh)。

- **变化**：新增34行：读取真实字节→createImageBitmap解码→原尺寸透明canvas→image/png toBlob；拒绝解码失败/空或非PNG结果，finally释放bitmap并清空canvas。直接和CORS代理分支都使用该函数。
- **风险**：中，原尺寸解码和重编码占用浏览器内存，无像素上限/取消；超大图仍可能耗尽内存。CI采用native codec适配createImageBitmap/toBlob，未等价验证全部浏览器原生实现；EXIF/ICC等未在这些例中断言。
- **阻断**：本次静态审阅未见。引用本会话已完成的F02实际diff及测试审查，blob未变。
- **已有证据**：[44863279442-136721232118.log:7223](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:7223>) `✓ src/__tests__/components/canvas-png-download-bounds.test.tsx (10 tests) 1670ms`；[44863279442-136721231942.log:9485](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:9485>) `↓ src/__tests__/components/canvas-export-offline-edge.test.ts (3 tests | 3 skipped)`。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：prior actual F02 review。先前 F02 真实记录见 JSON.priorReview；本轮未重复审查。

### 57. src/lib/chat-canvas-action.ts — reviewed

`currentBlob=715c223d3bba03228b2d10bd91d70258f42d6d7a` · `sourceCommit=3fd9d9c649075c0d8743bb9b8424d018531076d3`

旧评审 blob：`3aa04e845f4bf4bab50674d0102fdcb8af92c2c0`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：ChatCanvas action枚举/标签/映射移除erase/remove_bg，保留放大扩展裁切调色图生图。
- **风险**：低；与工具入口移除一致，不调用旧操作。
- **阻断**：本次静态审阅未见。完整1增5删diff已读；旧擦除用例失败不能要求恢复已退役入口。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：只验证聊天指令表不再发布erase/remove_bg，剩余upscale/extend/img2img与画布入口相符。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 58. src/lib/chat-generation-controls.ts — reviewed

`currentBlob=17a54a1d5708a1c57a2fe9239c05cb89197686e1` · `sourceCommit=a75f6535380fceb7f6c6efd2c0c4cafc6c3917ca`

旧评审 blob：`无`。引入：`801eaeb370cb2ec65a98b2483d81a624e954965b` (feat: 保存文件变更)。

- **变化**：推断模型思考能力；仅显式偏好启用推理/预算，统一effort及速度档降级提示。
- **风险**：中；模型名推断有误分类边界，提供商真实接受字段仍依赖协议适配。
- **阻断**：本次静态审阅未见。已读202行及引入记录；未发现默认强制高预算，现有日志证据范围见下。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：定向验证无显式偏好不发预算，模型不支持effort/速度档时降级提示正确；不调用模型。 本轮未执行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 59. src/lib/chatgpt-work-mode.ts — reviewed

`currentBlob=172cd9b744e58f722a900df7ccb2e36c61f1b35f` · `sourceCommit=f078f749f7a103bc27f10a00a5b8de4060b63a0c`

旧评审 blob：`无`。引入：`c549a5f7630480be0a5fc7d50946726d942e62e4` (feat(simple-chat): work mode with a step plan read from the reply, edit re-runs in place)。

- **变化**：四步工作计划、goal/title/step数量限制及按文本进度更新。
- **风险**：低；步骤状态来自模型文本，并非工具执行或真实审批凭据。
- **阻断**：本次静态审阅未见。已读119行及引入记录；仅审阅展示计划契约。
- **已有证据**：[44863279442-136721232042.log:6468](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6468>) `✓ src/__tests__/lib/chatgpt-work-mode.test.ts (11 tests) 8ms`。
- **最小验证/确认**：只验证goal/title长度、最多8步以及步骤标题/结束状态解析，说明其不是工具执行结果。 本轮未执行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 60. src/lib/cloud-task-storage.ts — hold

`currentBlob=ea81ad24f61f8fb51bcec20d13fc76933eae069f` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`7c866aa91ebbe457612fe443aa3c842e04345a4a`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：账务创建删除workflowPublication scope/intent/prepare/persist及commit-unknown处理；canvas路径保留。
- **风险**：高；旧已扣费workflow edit的replay/提交未知保护整体撤掉，不能仅凭UI退役确认历史账务任务安全。
- **阻断**：是。hold：已读67删完整diff；需明确旧任务收尾/对账策略与针对旧记录最小PG证据。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 61. src/lib/collaboration/yjs-singleton.ts — reviewed

`currentBlob=a3b01e4b80217398953c058991465ba60b66c6ee` · `sourceCommit=83a19b79e9c42d9a58bd15b9a25490a3abd22313`

旧评审 blob：`无`。引入：`83a19b79e9c42d9a58bd15b9a25490a3abd22313` (fix(deploy): allow sandboxed start without DB binding, add presence ready logs)。

- **变化**：以globalThis.__wujieYjsSingleton缓存require(yjs)，避免打包别名双实例。
- **风险**：中；避免instanceof分裂，但不同Yjs版本同进程共享同key需版本一致；本次未跑真实prod双入口。
- **阻断**：本次静态审阅未见。当前25行全读；日志证据不足处不宣称打包双入口已验证。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：仅验证多个模块取得相同Yjs实例并核对发布包只有一个兼容版本；本轮不重新构建。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 62. src/lib/element-decomposition/board-executor.ts — hold

`currentBlob=7bea1543a7505af495e856cf58b7a4e69b1ec456` · `sourceCommit=76d3bb830a5724f1fc41e10fa72cf211bd2b30d7`

旧评审 blob：`无`。引入：`2abb94ab04e1dbe66a07e892ce086bd2351ab920` (feat: improve image editing and dual element decomposition)。

- **变化**：元素板任务提交/轮询/取消，固定provider+model，15分钟期限、幂等完成与持久化。
- **风险**：中高；取消先请求提供商，授权失效或上游取消异常时本地终止/退费可能不能完成。
- **阻断**：是。hold：现有源码能定位取消前置依赖，但缺少上游取消失败时本地任务终态及计费证据。
- **已有证据**：[44863279442-136721232042.log:6476](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6476>) `✓ src/__tests__/lib/element-board-provider-client.test.ts (3 tests) 24ms`；[44863279442-136721232049.log:7375](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7375>) `✓ src/__tests__/lib/element-board-executor.test.ts (10 tests) 17ms`。
- **最小验证/确认**：定向验证上游取消抛错/不支持、提交后撤销模型授权时本地取消与退费；未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 63. src/lib/element-decomposition/board-result.ts — hold

`currentBlob=f373b0705fcb5ace5f583db08d03ce73edb5b1d4` · `sourceCommit=76d3bb830a5724f1fc41e10fa72cf211bd2b30d7`

旧评审 blob：`无`。引入：`76d3bb830a5724f1fc41e10fa72cf211bd2b30d7` (Fix element decomposition board: quality gate, model selection, deadline and error display)。

- **变化**：元素板产物解码、尺寸/透明度检查、源图SHA排重及按摘要保存产物。
- **风险**：中；源图回显仅比较原始字节摘要，同像素重编码可绕过；灰底模式透明度不作为硬门槛。
- **阻断**：是。hold：需确认“非原图回显”的契约是否要求像素级判定；目前不能给重新编码原图放行。
- **已有证据**：[44863279442-136721232049.log:7375](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7375>) `✓ src/__tests__/lib/element-board-executor.test.ts (10 tests) 17ms`。
- **最小验证/确认**：补同一像素不同编码产物、透明模式不足透明区、灰底模式定向断言；未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 64. src/lib/element-decomposition/board-task.ts — hold

`currentBlob=d13f9f571530ae059e6054328405fd68272b94d5` · `sourceCommit=76d3bb830a5724f1fc41e10fa72cf211bd2b30d7`

旧评审 blob：`无`。引入：`2abb94ab04e1dbe66a07e892ce086bd2351ab920` (feat: improve image editing and dual element decomposition)。

- **变化**：创建幂等任务、扣费、同步或异步提交、保存远端任务及失败退费。
- **风险**：高；上游已接受但本地receipt保存失败/进程中断的恢复窗口需实际证明，不能仅凭幂等key推定只扣一次。
- **阻断**：是。hold：未取得远端受理后本地更新失败/重启的对账恢复证据。
- **已有证据**：[44863279442-136721231934.log:7234](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231934.log:7234>) `✓ src/__tests__/lib/element-board-task.test.ts (4 tests) 11ms`；[44863279442-136721232118.log:4692](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:4692>) `✓ src/__tests__/lib/element-board-idempotency.test.ts (2 tests) 15ms`。
- **最小验证/确认**：定向故障注入上游受理后持久化失败及重启重放，核对单次计费/重复远端任务；未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 65. src/lib/input-validation.ts — reviewed

`currentBlob=48098ab1b5f55891997348e120535300f052a8fa` · `sourceCommit=856f4204ec4e0b59aed303de84c357c487b746c6`

旧评审 blob：`无`。引入：`dc5983d916fa61cfe44bd827fd2636cc61b8117a` (fix: V62 canvas stability and toolbar provider routing)。

- **变化**：集中URL/图像/比例/模型名/尺寸/strength等格式与数值校验。
- **风险**：低；这些是格式约束，不构成目标主机授权或密钥有效性验证。
- **阻断**：本次静态审阅未见。已读160行及引入记录；明确校验能力边界，无单凭格式即授权的结论。
- **已有证据**：[44863279442-136721232057.log:10225](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10225>) `✓ src/__tests__/lib/input-validation.test.ts (60 tests) 5ms`。
- **最小验证/确认**：定向验证尺寸8192、有限strength、非法比例/模型字符；这些格式用例不替代网络权限测试。 本轮未执行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 66. src/lib/model-type-classification.ts — hold

`currentBlob=d4394598e3ae89c0047b565565efb12dd3baa73c` · `sourceCommit=93fd690c1efdca663799405130bb2b4808a086c2`

旧评审 blob：`无`。引入：`9ce1404bb401dd8d4f9c805b88f7f2d5959877f0` (fix: align dashboard and 302 model keys)。

- **变化**：提供商类型优先及模型名推断，302别名归一化、模型授权namespace和配置列表。
- **风险**：中高；selectedModels为空时回退discoveredModels，若调用层以此作授权会放大可用模型。
- **阻断**：是。hold：349行已读；需要确认所有使用者将“发现”与“已授权”区分，不能仅凭此列表证明selectedModels精确授权。
- **已有证据**：[44863279442-136721232057.log:10419](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10419>) `✓ src/__tests__/lib/admin-model-authorization.test.ts (10 tests) 4ms`；[44863279442-136721232111.log:5442](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5442>) `✓ src/__tests__/components/dashboard-model-authorization-contract.test.ts (6 tests) 109ms`；[44863279442-136721232118.log:4666](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232118.log:4666>) `✓ src/__tests__/api/admin-model-authorization.test.ts (5 tests) 13ms`。
- **最小验证/确认**：空selectedModels但有discoveredModels时API应拒绝未授权精确组合；只需定向权限用例，未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 67. src/lib/pear-image-models.ts — reviewed

`currentBlob=2904aef689a5f4e820473bfd2f06d62878b03620` · `sourceCommit=caf958450ab60da148de3183bb309aa1f5f65188`

旧评审 blob：`5fc5d531d62230db88c38ab4a624d824abbad826`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：Pear image模型登记outputFormats/GIF范围；图像工具小写枚举及real-esrgan1024限制。
- **风险**：中；纯参数表，供应商在线规格变化未作本轮外部核验；不能说live提供商通过。
- **阻断**：本次静态审阅未见。具体33增1删diff已读，参数约束可审；live兼容仅保留为未验证。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：仅验证GIF输入格式、图像工具枚举及Real-ESRGAN 1024尺寸映射，不发供应商请求。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 68. src/lib/pear-video-models.ts — reviewed

`currentBlob=2b3e4a6918b51ae6d85be2ecf0464006992b2e79` · `sourceCommit=523c66ab1e3230dc38fe70c83025789e7c3715f2`

旧评审 blob：`77d50c4834e55d1fd8b5038913b9925f2b32860b`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：Pear video增加audio上限，Seedance2.0限定720P、mini音频10。
- **风险**：中；说明引用live错误但本轮无账单/提供商验证，不把注释当实测。
- **阻断**：本次静态审阅未见。完整6增2删diff已读，47例pear-video-contract为本地契约证据。
- **已有证据**：[44863279442-136721231984.log:5090](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5090>) `✓ src/__tests__/lib/pear-video-contract.test.ts (47 tests) 18ms`。
- **最小验证/确认**：仅验证每型号参考音频数量和720P限制，与47项Pear契约结果对照；不声称线上实测。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 69. src/lib/platform-routes.ts — reviewed

`currentBlob=f664a52aaa17377b1161d2b900c3bcbefd306a34` · `sourceCommit=77be21c147abb930831ae85457b8d3ecc2434dc8`

旧评审 blob：`无`。引入：`a92adf9d81faf9ec48cb94466599ceb35b2b86f5` (Give canvas, video and chat their own addresses and a switcher between them)。

- **变化**：canvas/chat/video路由和平台可见性、项目上下文及workspace地址规范化。
- **风险**：中；空/未知权限归一化后默认全部平台，需沿用角色授权层；路由可见性不能替代API鉴权。
- **阻断**：本次静态审阅未见。已读107行及引入记录，未发现本层新增越权写入。
- **已有证据**：[44863279442-136721231994.log:4458](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4458>) `✓ src/__tests__/lib/platform-routes.test.ts (7 tests) 5ms`。
- **最小验证/确认**：定向验证空/未知平台权限的默认语义、projectId/dramaId保留和dashboard地址；API权限另验。 本轮未执行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 70. src/lib/provider-audio-url.ts — reviewed

`currentBlob=a4ac3de58623208b23e5df19c0a2321d793d0488` · `sourceCommit=523c66ab1e3230dc38fe70c83025789e7c3715f2`

旧评审 blob：`无`。引入：`523c66ab1e3230dc38fe70c83025789e7c3715f2` (feat(drama): character voice samples sent as reference audio to Seedance video models)。

- **变化**：仅owner可读的本站音频可转S3预签名或签名公网URL，不内联；无公网地址失败。
- **风险**：中；并行全量读音频有资源成本，签名URL是能力凭据需TTL保密。
- **阻断**：本次静态审阅未见。45行全读；generated-audio底层由既有实现，未扩审drama资产组。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：定向验证生成音频owner不匹配拒绝、S3/签名URL优先且不inline；不读取真实音频。 本轮未执行。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 71. src/lib/provider-media-url.ts — reviewed

`currentBlob=b6acd2698e72355e4ba6b13e558985b9d6875806` · `sourceCommit=2051fbccd31a682ce8664190ac54333f4e2569c2`

旧评审 blob：`无`。引入：`2051fbccd31a682ce8664190ac54333f4e2569c2` (Give providers signed public links to managed media)。

- **变化**：本地媒体优先S3预签名，再公共签名URL，再受限inline；外部URL原样传递。
- **风险**：中；依赖调用者先做所有权及外部源授权，不能作为通用URL授权器。
- **阻断**：本次静态审阅未见。已读126行及引入记录；已有旧localhost预期失败不证明新逻辑本身出错，相关失败证据如实保留。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：仅用合成媒体验证S3→签名→inline优先级和20MB限制，核对调用者已做所有权检查。 本轮未执行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 72. src/lib/public-media-link.ts — reviewed

`currentBlob=adaf08450a2c3aa59855771cbc25c964ed930a61` · `sourceCommit=523c66ab1e3230dc38fe70c83025789e7c3715f2`

旧评审 blob：`无`。引入：`2051fbccd31a682ce8664190ac54333f4e2569c2` (Give providers signed public links to managed media)。

- **变化**：媒体path/扩展名白名单、有效期HMAC签名、音频用户名摘要约束及常量时间验签。
- **风险**：中；持有签名者在有效期内可访问，secret和公共origin配置由部署方保证。
- **阻断**：本次静态审阅未见。已读133行及引入记录；已有9+8相关用例结果仅覆盖列出边界。
- **已有证据**：[44863279442-136721231853.log:17483](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17483>) `✓ src/__tests__/api/public-media-access-contract.test.ts (8 tests) 3ms`；[44863279442-136721231984.log:5311](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5311>) `✓ src/__tests__/lib/public-media-link.test.ts (9 tests) 8ms`。
- **最小验证/确认**：定向验证签名过期/篡改/禁用目录及音频用户名摘要；生产secret轮换由部署方验证。 本轮未执行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 73. src/lib/s3-storage.ts — hold

`currentBlob=79119641fc3d2daeb964411799cf0e9963f1d61a` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`ebf62e6782b13bc3ebda884d4ada438c27a3e837`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：剔除private/workflow-edit的受理凭据、只写一次媒体、按ETag/VersionId精确读及存储探针API；其余差异主要行尾。
- **风险**：高；旧私有受理凭据和媒体仍可能存在，重启后读取/恢复入口随之消失。
- **阻断**：是。hold：逐blob实际diff并忽略行尾复核，需旧已计费workflow任务退役与私有对象保留/恢复方案。
- **已有证据**：[44863279442-136721231984.log:4457](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:4457>) `✓ src/__tests__/lib/s3-storage-bounded-read.test.ts (32 tests) 280ms`。
- **最小验证/确认**：以一个已受理未发布旧任务及已有private对象演练只读对账；不做自动迁移，未运行。
- **审阅方式**：已读previousReviewedBlob到HEAD blob的实际diff。

### 74. src/lib/simple-chat-auto-skill.ts — hold

`currentBlob=56d92568c768fe4472f171a8699d851c19f29537` · `sourceCommit=4a8b726aeaa4856f3b0e58cb378a9fe7bcfecde3`

旧评审 blob：`无`。引入：`4a8b726aeaa4856f3b0e58cb378a9fe7bcfecde3` (feat(simple-chat): 自动技能 picks a preset skill per request from /ppt-style commands, the composer select or keywords, and the reply shows which skill answered)。

- **变化**：按显式slash/手选/关键词/追问选预设skill，文件步骤按JSON代码块解析状态推导。
- **风险**：中；JSON可解析仅表示数据块存在，不证明schema合法或文件已成功生成，UI“可以下载”需以产物为准。
- **阻断**：是。hold：140行已读，当前deriveSkillFileSteps在JSON.parse成功即标记四步完成，尚无产物成功回执。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：有效JSON但错误schema、文件生成异常时不得显示可以下载；定向测试未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 75. src/lib/simple-chat-image-params.ts — hold

`currentBlob=137bc4a911fce4a8e3602173111c60c5ce29fac2` · `sourceCommit=7966d8718f78612da95b90af867e732fe9e849b2`

旧评审 blob：`无`。引入：`7966d8718f78612da95b90af867e732fe9e849b2` (feat(simple-chat): several images per turn, sizes fitted to the image model, earlier reference images)。

- **变化**：从文本提取像素/比例/分辨率/质量和张数，映射模型支持参数并提示降级，最多4张任务。
- **风险**：中；模型返回多个generate_image调用可在用户未指定数量时生成多张（上限4），每张计费需产品许可。
- **阻断**：是。hold：234行已读，单调用复制数量由用户决定，多调用直接slice最多4仍可由模型增加张数；需确认计费授权契约。
- **已有证据**：[44863279442-136721231853.log:17352](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231853.log:17352>) `✓ src/__tests__/lib/simple-chat-image-params.test.ts (11 tests) 7ms`。
- **最小验证/确认**：用户未指定张数但模型给4次工具调用时验证实际批准数量与计费；未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 76. src/lib/simple-chat-pdf-output.ts — reviewed

`currentBlob=45b48f25fcd7d9d7aae8d66144959a8b6d3bd2a3` · `sourceCommit=e0658f0c7cb9494595cb44471ba984bdeeb9a6dc`

旧评审 blob：`无`。引入：`e0658f0c7cb9494595cb44471ba984bdeeb9a6dc` (fix: recover chat snapshots and correct canvas exports and credit refresh)。

- **变化**：新增68行：统一查找第一个合法PDF fenced JSON，支持6种操作输入与0基页码，忽略解释性/无效JSON；把文件数据就绪与端点生成状态分开。
- **风险**：低至中，客户端结构校验，不是服务端授权/URL安全边界。只要求操作必要字段；页码是否存在、模板字段、源PDF可读性及最终文档有效性仍由端点负责。只能声称数据结构可用，不能声称6种操作端到端都被验证。
- **阻断**：本次静态审阅未见。引用本会话已完成的F02实际diff及测试审查，blob未变。
- **已有证据**：[44863279442-136721232049.log:8028](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:8028>) `✓ src/__tests__/components/simple-chat-pdf-output.test.tsx (30 tests) 1404ms`；[44863279442-136721231984.log:5312](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5312>) `✓ src/__tests__/api/simple-chat-pdf-prompt.test.ts (6 tests) 104ms`。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：prior actual F02 review。先前 F02 真实记录见 JSON.priorReview；本轮未重复审查。

### 77. src/lib/simple-chat-sync-client.ts — reviewed

`currentBlob=a0f321208f277484a4e49d04e0088efee814b8f0` · `sourceCommit=e0658f0c7cb9494595cb44471ba984bdeeb9a6dc`

旧评审 blob：`9ff2f52dde49649130d861ab1f91f79556d50779`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：初始化按账号隔离缓存，GET权威读取前阻断POST，重放期间版本竞争重试及预期actor头。
- **风险**：中；异步持久化/账号切换边界敏感，失败缓存只能同账号恢复。
- **阻断**：本次静态审阅未见。已逐blob读完整diff；新增账号可见性与写入闸门，现有测试结果仅覆盖日志列出案例。
- **已有证据**：[44863279442-136721232057.log:4454](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:4454>) `✓ src/__tests__/lib/simple-chat-sync-client.test.ts (71 tests) 1260ms`。
- **最小验证/确认**：仅验证换账号时旧缓存不可见、权威GET完成前不POST、初始化期间新本地操作不会丢失。 本轮未执行。
- **审阅方式**：已读previousReviewedBlob到HEAD blob的实际diff。

### 78. src/lib/simple-chat-sync-read-error.ts — reviewed

`currentBlob=c755c74cd0b9d88b36e895c51a101aaf98d3804c` · `sourceCommit=e0658f0c7cb9494595cb44471ba984bdeeb9a6dc`

旧评审 blob：`无`。引入：`e0658f0c7cb9494595cb44471ba984bdeeb9a6dc` (fix: recover chat snapshots and correct canvas exports and credit refresh)。

- **变化**：新增28行：专用快照校验错误；诊断仅输出过滤后的field或5位SQLSTATE，42P01/42703归schema，其余SQLSTATE归storage-error，未知为unexpected。接到读取路由的服务端日志。
- **风险**：低。只做诊断不改变HTTP恢复/授权决策；不传递message、stack、detail、query、table或快照值。字段为内部验证器生成且经过128字符格式过滤；requestId由既有请求ID模块约束。
- **阻断**：本次静态审阅未见。引用本会话已完成的F02实际diff及测试审查，blob未变。
- **已有证据**：[44863279442-136721231994.log:4525](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231994.log:4525>) `✓ src/__tests__/lib/simple-chat-sync-read-error.test.ts (4 tests) 3ms`；[44863279442-136721232111.log:5177](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232111.log:5177>) `✓ src/__tests__/api/simple-chat-user-data-sync.test.ts (32 tests) 1375ms`；[44863279442-136721232049.log:7847](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:7847>) `✓ src/__tests__/lib/simple-chat-sync-server.test.ts (18 tests) 13ms`。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：prior actual F02 review。先前 F02 真实记录见 JSON.priorReview；本轮未重复审查。

### 79. src/lib/simple-chat-tools.ts — reviewed

`currentBlob=dea6784594c33113d1a8cc57fc8310ae477b61fa` · `sourceCommit=ac94934b09ad7cb3c87808dc8db53655b80e4eee`

旧评审 blob：`无`。引入：`ac94934b09ad7cb3c87808dc8db53655b80e4eee` (feat(simple-chat): web_search tool rounds with numbered sources, and the model's reasoning)。

- **变化**：封装SearchClient联网检索、http(s)引用格式、编号与reasoning delta提取。
- **风险**：中；SDK错误文本与搜索摘要仍需调用边界控制长度/脱敏，不代表执行任意来源URL请求。
- **阻断**：本次静态审阅未见。已读107行及引入记录；上游错误返回另在simple-chat-upstream-error项hold，不重复判定。
- **已有证据**：[44863279442-136721232057.log:10472](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232057.log:10472>) `✓ src/__tests__/lib/simple-chat-tools.test.ts (3 tests) 3ms`。
- **最小验证/确认**：只验证2次补搜上限所需的查询/编号、非法来源URL过滤、SDK错误边界以及reasoning三种delta格式。 本轮未执行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 80. src/lib/simple-chat-upstream.ts — hold

`currentBlob=9a1dc680e88d43272dbafda1ceb9c9027a5e11cf` · `sourceCommit=a75f6535380fceb7f6c6efd2c0c4cafc6c3917ca`

旧评审 blob：`无`。引入：`a75f6535380fceb7f6c6efd2c0c4cafc6c3917ca` (fix(simple-chat): send image tool calls with the /api/generate contract, read memories, explain relay errors)。

- **变化**：提取tool宽高比兼容映射与上游错误说明；不导出HTTP route额外函数。
- **风险**：中；rawBody detail仅截200字不脱敏，JSON中文/英文可回传提供商详细信息。
- **阻断**：是。hold：41行全读；需明确调用方错误边界保证过滤，不能因中文提示包装视为脱敏。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：参考已嵌入priorReview的定向验证与限制；本轮不重跑。
- **审阅方式**：current HEAD source read; introduction commit queried。

### 81. src/lib/vendor-pricing.ts — hold

`currentBlob=12558bae347060eaab61f384c37e60f3c0a06fab` · `sourceCommit=93fd690c1efdca663799405130bb2b4808a086c2`

旧评审 blob：`无`。引入：`7949b14c2e95465142093ad53e6bf9abc94309c9` (Price Pear and APIMart models at vendor price x1.01 in credits)。

- **变化**：按供应商族/型号配置图像视频单价，含分辨率、声音、输入图片加价，乘1.01与固定汇率7.3取整积分。
- **风险**：高；静态价格/汇率取2026-11-16，未知tier退默认，名义时长计费需与供应商实际账单核对。
- **阻断**：是。hold：258行表和公式已读，不能把表注释或本地算式测试当作当前供应商价格/实际账单证据。
- **已有证据**：[44863279442-136721232042.log:6463](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6463>) `✓ src/__tests__/lib/vendor-pricing.test.ts (7 tests) 13ms`。
- **最小验证/确认**：负责人确认价格快照来源/生效日与无时长模型计费约定；对默认/未知tier及参考图加价做小范围对账，未运行。
- **审阅方式**：已读当前HEAD文件并追查引入commit。

### 82. src/lib/video-api.ts — hold

`currentBlob=6918098f3a57137addc29d03a935b1e3e9fa0298` · `sourceCommit=523c66ab1e3230dc38fe70c83025789e7c3715f2`

旧评审 blob：`2e0c6faa1834d054f58827fb9a83c8818285b793`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：新增APIMart型号字段矩阵、角色参考图合并、首尾帧互斥、参考音频及Pear移除不支持seed/negative_prompt。
- **风险**：中高；不同供应商字段和计费时长范围广，适配单元用例并非真实上游接受证据。
- **阻断**：是。hold：已读全部语义diff；参考音频把首尾帧改作参考图属可见行为变化，需用户意图/协议确认；无真实供应商调用证据。
- **已有证据**：[44863279442-136721231942.log:8935](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231942.log:8935>) `✓ src/__tests__/lib/apimart-video-contract.test.ts (42 tests) 14ms`；[44863279442-136721231984.log:5090](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721231984.log:5090>) `✓ src/__tests__/lib/pear-video-contract.test.ts (47 tests) 18ms`；[44863279442-136721232042.log:6471](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232042.log:6471>) `✓ src/__tests__/lib/video-reference-audio.test.ts (8 tests) 7ms`。
- **最小验证/确认**：定向覆盖有音频+首尾帧、互斥素材、nominal duration、分辨率大小写与声音参数；不发真实付费请求，未运行。
- **审阅方式**：已读previousReviewedBlob到HEAD blob的实际diff。

### 83. src/lib/video-panel-events.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=9c8249e9fef309b55152060ce412160ef80456b0`

旧评审 blob：`无`。引入：`dc5983d916fa61cfe44bd827fd2636cc61b8117a` (fix: V62 canvas stability and toolbar provider routing)。

- **变化**：移除wujie:open-video-panel事件桥；当前HEAD无路径，读删除父提交6行并追查引入记录。
- **风险**：低到中；旧快捷键/插件事件调用不再打开视频面板。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对现存事件调用方及新短剧入口承接；未运行。
- **审阅方式**：HEAD absence checked; introduction queried; deletion-parent source read and git diff parent blob -> empty blob。

### 84. src/lib/workflow-background.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`57aea862c89b05a2e89cd97b5f73ed5cb088a89b`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：删除1行observeWorkflowBackground恒等Promise转发。
- **风险**：低；自身没有持久化副作用；随整个执行API退役，但原review条目仍指向旧blob。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：仅在整组退役确认后记录删除；不得用empty blob当当前文件hash。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 85. src/lib/workflow-engine.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`f3704eab1a1edf33bc0037de7c90295e56be8af7`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除工作流类型/端口/模型角色、DAG/条件/循环/子图、节点请求构建、AI/ComfyUI导入及预设布局。
- **风险**：高；残留消费者/历史序列化数据兼容性不能由类型文件消失推定已解决。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对当前import失败和旧工作流导出保留；整组退役结论须覆盖引擎数据格式。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 86. src/lib/workflow-file.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`d81440ecf29d992951c188777e72bf6245066521`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除工作流图schema/唯一ID/端口连线校验和原生/Comfy前端/API格式导入器。
- **风险**：中；已有导出JSON失去读入或转换工具。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认原有JSON保留与只读导出/转换路线；无需跑模型。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 87. src/lib/workflow-image-action-request.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`a5946ac4488db2aee3e7c35bbf47e959ddeda97c`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除Zod严格grid请求解析、64格上限、目标去重与源项目一致性约束。
- **风险**：中；解析层随API删除可退役，但任何残留grid执行不可绕过这些约束。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认image-actions已关闭且无另一路保留相同执行；未运行。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 88. src/lib/workflow-image-actions.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`ee7a11a7ef2d5445f6dbe4b87c7e59a81a3590a6`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除64格shape校验及整数边界无重叠像素分区纯函数。
- **风险**：低；后续若复用九宫格必须保留奇数尺寸/全像素契约。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认无残留crop调用；若新入口替代，只验奇数尺寸分区和64格边界。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 89. src/lib/workflow-image-batch.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`9848b77c1a60d1ed668cce8c2bbe59c449661cba`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除同外层事务内创建asset/version/placement批次、完整锁集合和父版本授权。
- **风险**：高；旧grid批量操作的原子性和回执恢复实现被移除。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认无待确认批次，旧receipt只读对账不能创建第二批资产。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 90. src/lib/workflow-image-document-publication.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`805cd89383962f470851a6aa1989473b058a6d21`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除文档grid发布，Yjs回执与派生资产同连接COMMIT及新连接读回unknown处理。
- **风险**：高；已提交但未确认的文档批次缺少恢复/暂存文件保留判定入口。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：以旧unknown receipt确认document sequence/全部tiles后再决定清理；未运行。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 91. src/lib/workflow-image-document-runtime-publication.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`725dfb52f21dc16709e92ecdc7a01f8b63d248f1`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除文档单格运行发布、写入前权限预检、COMMIT后取消优先级及fresh read恢复。
- **风险**：高；旧运行单格COMMIT不确定时可能无法确认哪份文件应保留。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对旧单格receipt与document sequence，禁止凭取消即删除已提交文件。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 92. src/lib/workflow-image-execution-fence.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`8ad2c04b1b033e7c63d0478f61c5d6c5c75e0cc3`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除FOR UPDATE锁父task、revision/leaseOwner/attempt及数据库clock_timestamp有效租约fence。
- **风险**：高；若任何旧执行器仍在跑，失去本层防陈旧worker写入保障。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认旧worker停止/租约到期与所有写入入口关闭，再批准删除。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 93. src/lib/workflow-image-graph.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`31373a82acfce2d4ba90779eea15f4f7f15aaafd`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除已发布grid回执到图的严格匹配、图片抽取计划与prepared tiles构图。
- **风险**：中；旧客户端未知状态缺少同operation/asset/placement绑定的安全恢复。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认旧图操作无未消费回执，禁止用未经验证的tiles拼回旧图。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 94. src/lib/workflow-image-grid-client.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`a5f87b3fac75b411e51ede26af244e452681dd30`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除按actor/project/workflow/authority分区、可恢复unknown操作的grid客户端。
- **风险**：中高；浏览器已持久化待确认operation的恢复界面消失。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对旧recovery journal保留/导出，升级不得静默重发切分。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 95. src/lib/workflow-image-grid.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`9f0323519b6d37ae92f61c14cd360d223dd859e7`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除CPU裁格：32MiB输入、40MP、256MiB输出、64格、30秒、单解码及取消清理。
- **风险**：中；已有裁格替代若存在需重新证明同等资源上限。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对替代入口范围；只需边界/取消小用例，不做大图全套。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 96. src/lib/workflow-image-input-execution.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`59e2531b09b52b90544ffe82d511df8c95ebe455`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除按actor解析源、identity/reference或grid cell准备，按personal/document权限分派发布。
- **风险**：高；旧运行的source授权与最终发布路由整体退役。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对旧任务冻结source与发布结果的可读/终止安排。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 97. src/lib/workflow-image-media.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`304119dcf7efb84af9fd5aeb305596cda6f29b60`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除受授权实际媒体读取、opaque proof、摘要身份及最终事务内重新校验项目/源锁。
- **风险**：高；任何残留导入入口不能以旧snapshot代替实时授权。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认所有该能力使用者关闭；对旧已准备媒体仅只读核对所有权/版本，不写新资产。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 98. src/lib/workflow-image-preparation.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`4470a29f359ed9fe3661327fcdb7c38d46e8420a`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除opaque preparation能力、单任务预算/120秒时限、暂存媒体与unknown-COMMIT下保留/清理判定。
- **风险**：高；遗留staging文件清理不能把未确认提交误作失败。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：先对账旧staging和最终asset receipt，明确保留清理责任；本轮禁止删文件。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 99. src/lib/workflow-image-publication.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`b1ebfabd82a524250ec90925c23c0fd374ef7513`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除personal grid的同事务父版本/全tiles发布、锁定回执重放、COMMIT不确定fresh read及保留文件集。
- **风险**：高；旧操作重放/确认入口消失，错误清理可丢已提交产物。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：只读核对旧operation对应全部asset/version/placement，不允许重复创建。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 100. src/lib/workflow-image-receiver.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`64120aa066ef2b6f08ca09f61fb5893e3dfe6002`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除identity/grid上游输入元数据和唯一连线、端口类型、上游结果血缘选择器。
- **风险**：中；旧图metadata仍存储时不应直接当成普通不受控URL。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认旧metadata不再执行或有明确拒绝；保留导出数据出处。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 101. src/lib/workflow-image-reference-runtime.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`29ed1846c469841a1a443e4e0a08bff61026adb7`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除引用型input节点结果、父任务锁/fence、durable source及不可变receipt/checkpoint原子发布。
- **风险**：高；旧零拷贝引用任务未确认回执无法再安全恢复。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对旧reference checkpoint与父task终态，不能重新生成替代原引用。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 102. src/lib/workflow-image-retry-admission.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`aeff6c9c8a07fa48cf19c086fb871d3b9c97aa06`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除明确零费用CPU retry admission、不可重开祖先约束、锁定图与幂等子任务COMMIT恢复。
- **风险**：高；已受理CPU retry可能失去查询/恢复；不能通过新付费任务替代。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认旧retry标记零扣费及父子终态/receipt一致，不自动重开祖先。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 103. src/lib/workflow-image-retry-view.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`cc43ac05047144f1a26e9004b2dfd89a56c39675`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除浏览器retry root/context/node映射、pending/active确认及终态snapshot解析。
- **风险**：中；升级丢失浏览器原retry映射可能导致用户无法定位已提交操作。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：保留旧重试journal并明确查询方式；未运行。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 104. src/lib/workflow-image-runtime-publication.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`ac5a4c9e694b8d8a51ee82c208b94ac57b0daccb`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除运行期单格的稳定logical operation、目标slot、父checkpoint/fence及personal发布回执。
- **风险**：高；续租替换与已提交checkpoint的历史恢复责任未证明完结。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对旧logical operation与最终asset receipt、revision，确认不再有陈旧worker。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 105. src/lib/workflow-image-source-options.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`12e22bc1353c7103a92eda1ec822f47fdac8ac99`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除上传/URL/画布/上游四种图片源选项常量。
- **风险**：低；纯展示常量，但与旧图序列化source值共同退役。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认旧source值仅保留导出且不被错误解释成另一来源。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 106. src/lib/workflow-image-source.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`4a293cba8dd1b88ddb1a15ce1644b9c44de0d329`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除按actor与project/workspace/entity冻结上下文解析源，单源及grid transform授权。
- **风险**：高；旧源引用若仍被消费需要相同身份解析，不可把transform当已执行产物。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对旧输入引用无继续执行入口；明确只读导出中的transform语义。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 107. src/lib/workflow-image-terminal-receipt.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`bfbceae6775a683b20db1865a8adefcbc90e0af5`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除completed CPU retry不可变媒体回执验证，以及running checkpoints只读恢复检查。
- **风险**：高；删除的是不写入的历史验证路径，旧终态可验证性随之消失。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：保留/替代历史receipt只读验证方式；先核对零费用和完整媒体清单，不重跑模型。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 108. src/lib/workflow-presets.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`d9167f091c4a7f4b7abd1da690dd2535cd1186d1`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除工作流预设目录及端口合法校验/自动布局创建函数。
- **风险**：低到中；系统预设和用户自建预设不同；系统表删除不能授权清除用户localStorage。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认系统预设退役，用户预设另按第28项保留/导出。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 109. src/lib/workflow-renderer/legacy-mobile-pointer.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`4b46459e3b718c0c46bea52acff36baccd5d2ef3`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除旧节点触屏控制器：指针捕获、拖拽/双指缩放、端口连接、取消回滚及stale scope清理。
- **风险**：中；交互能力仅在节点退役后可一起撤回，不能削弱仍保留画布手势。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：核对本函数无保留画布消费者；不宣称五浏览器通过。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 110. src/lib/workflow-renderer/legacy-port-targets.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`a477eed7fe8f6cb2079154b1069d0249466f6cd2`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除44px端口无重叠/遮挡分区，不能安全命中的端口退列表。
- **风险**：低；仅节点的触屏辅助目标。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认节点入口均退役，若复用需保留碰撞fallback小用例。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 111. src/lib/workflow-renderer/minimap-pointer.ts — hold

`currentBlob=null (deleted)` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`00145069ae70b4664fbccfa4cb689d3fd3fdaa12`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：移除minimap pointer匹配、丢捕获清理及触屏小数坐标保留。
- **风险**：低；仅旧节点小地图，保留画布若引用则构成缺失模块。
- **阻断**：是。hold：实际删除diff已审；旧功能退役/历史数据或任务保留的对应确认尚缺，不能以新hash盖章。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：确认无存活引用/小地图入口；不重跑全套。
- **审阅方式**：git diff previousReviewedBlob -> empty blob (HEAD path absent); 删除职责及关键分支摘读；退役未确认，hold。

### 112. src/lib/workspace-panel-layout.ts — reviewed

`currentBlob=9d0e0ac1d222eebb841293320a7a448752c10ed3` · `sourceCommit=c2a180121557a38cfff9a239041d3a082fbfea2f`

旧评审 blob：`b3776d35514115c1d51ded7e02ed05871eb9d92b`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：共享面板增加maxWidth480和min(480px,100vw)，避免手机扣掉左工具栏挤压。
- **风险**：低；宽度常量不执行保存或请求。
- **阻断**：本次静态审阅未见。完整6行新增diff已读，mobile-workspace-panel3例为相关结构证据。
- **已有证据**：[44863279442-136721232049.log:8009](<C:/Users/Administrator/.codex/worktrees/wujie-production-acceptance/_upstream-wjaigc-restore/output/canvas-chat-audit/ci-20261121/44863279442-136721232049.log:8009>) `✓ src/__tests__/components/mobile-workspace-panel.test.ts (3 tests) 2ms`。
- **最小验证/确认**：仅验证窄屏min(480px,100vw)与折叠轨宽、底栏安全区，结合已有3项布局契约。 本轮未执行。
- **审阅方式**：previousReviewedBlob→currentBlob actual diff。

### 113. tests/e2e/stage-4-node-chat-agent.spec.ts — hold

`currentBlob=5e35e5f8c838b46edd8ad124886e2e48b02c3c4c` · `sourceCommit=20b4fd5e0e0499a1e55512a62d132b38d4b2c6a9`

旧评审 blob：`d7697d4b581428b5e8f234fd3583ac44b523e91b`。历史原条目完整保留于 JSON.historicalEntries。

- **变化**：删除3项Stage4工作流E2E及renderer性能/模式门禁依赖，保留普通聊天/vision/agent用例。
- **风险**：高；整段chat→canvas→workflow→chat测试被删，连带移除仍在用的chat→canvas血缘/刷新/移动持久化覆盖。
- **阻断**：是。hold：563行删除diff全读；节点退役可以解释工作流断言删除，不能解释所有保留产品链路证据消失。
- **已有证据**：未取得与本项直接对应的已执行结果；未写“已通过”。
- **最小验证/确认**：把chat→canvas的托管血缘、placement、移动刷新恢复保留成独立小范围浏览器用例；本轮未执行。
- **审阅方式**：已读previousReviewedBlob到HEAD blob的实际diff。

## 完整性核对

113/113 与 assignments.other 精确一致、无重复，与 drama 零交集；HEAD/tree、assignment 与原 review-record 摘要未变化；160 条历史 entries 内容比对一致；全部 currentBlob 与固定 HEAD 对应；所引日志行逐条核验。源码/基线/允许清单无本轮写入，当前基线工作区变更列表为空；本轮仅静态阅读与只读 gh 状态查询。


## 线程结束补记

注册限流 #10：父线程已真实复现并最小修复，未锁定 lockedUntil=0 的记录不再每请求删除计数；用户报告 3 tests red→green，证据为 auth-register-limit logs。本线程据此登记为父线程已修复，未重复审查或运行测试。原 29f7e2df 版本的逐项结论和 44/69 统计保留，未据此审批未提供的新提交。

本线程只读评审已结束，不等待其他修复。其余 hold 保留；raw_schema 恢复与 RLS 不在本线程业务修复范围。
