# V588 WebSocket 在线状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有项目权限之上交付真实同源 WebSocket 在线状态，并为 Yjs 留下独立的成员授权边界。

**Architecture:** 默认关闭时保留当前 Next 启动路径；开启时由同源 Node 入口将普通 HTTP 交给 Next，仅将精确在线状态路径交给 `ws`。Next API 签发一次性票据，PostgreSQL 成员/票据/租约是权限与在线状态权威，WebSocket 只广播在线事件，不传画布内容。

**Tech Stack:** Next.js 16.2.11、React 19、TypeScript、`ws` 8.21.1、PostgreSQL、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-24-v588-websocket-presence-design.md`

## Global Constraints

最新集中收口（1210–1213）：1211受控延迟真实末次projection，原两retry业务断言结束后各仍有一条completion未结算，完整九案2FAIL/7PASS/零skip/native1；失败出口仍先排空后清schema。仅compliance测试观察singleton的真实start/completion/failure-record链并在返回前释放gate、allSettled排空，生产及原报告/账务/授权断言不改。strict lint、非增量tsc原生0及同席限定C0/I0/M0后，1212九案9PASS/零skip/native0、19.93秒，3664输入零mismatch、primary0/0、PGstop0，55496/pidfile已消失。只关闭两夹具清理生命周期问题。1213准备按实际1012文件集合精确分组并另跑MPE，清单/语法检查不是全量通过；事实以后续原生运行及JSON终态为准。后续完整覆盖/独立MPE→当前源码构建→真实Next→正确Coze，1189/1190失败绑定未绕过。第七项及发布OPEN，许可不扩、原服务/stable保持，无安装/付费/同步/部署。详细证据只看 docs/superpowers/plans/2026-10-05-stage7-batch-closure-v1.md，既定顺序、Pear移出/PSD保留不变；下方旧检查点仅历史。

最新生产控制连接检查点（640–651）：641四新增RED/原七PASS；642强化后两案actual stream.closed=false、两案原control错误丢失。最小生产修补分别聚合操作/end错误，end同步throw仍destroy具体stream并等待close、清deadline，643十一PASS。首strictlint的no-this-alias/native1保留，等645终态29文件160PASS后只改collector；648在649前冻结54输入，649最终29文件160PASS/零skip/native0/147.75秒、六路径strictlint/非增量tsc终态0、冻结到终态零mismatch。647同席限定关闭两生产具体缺陷及collector Minor，无新增C/I，不等于整个deadline/WS关闭。646源码保护仍62BLOCK/allowlist未扩；650专库有限READ ONLY样本保持、隔离schema/其他非idle为0，原5010/55494/main/stable/index及.next保持。下一先补false termination/操作先结算release竞态，再checkout/身份采样/TLS网络/COMMIT/101后维护等；修后完整构建/正式身份/全平台/Coze门禁仍OPEN。详651报告。顺序仍只读分享已闭→WebSocket前置（当前）→8C剩余→8D剩余→8E→内部Task9→整体第八项草图；后继冻结，已闭1–6/Lovart/分享不重做，Pear移出/PSD保留。下方旧“最新/当前/进行中”均属历史时点。

最新限定检查点（631–639）：原生产错误聚合/SQL观察两项I已获限定关闭；新测试回收身份及body＋cleanup错误两项I经632四真实RED/三PASS→633七PASS及639同席复审限定关闭，无新增C/I。634在635前冻结54输入；635终态29文件156PASS/零skip/native0/144.95秒，六路径strictlint/非增量tsc终态0，冻结到终态零mismatch。相对629只改新增测试，不扩大生产或功能范围。636源码保护仍62BLOCK，allowlist未扩；637专库有限READ ONLY样本保持、隔离schema/其他非idle为0，原服务/main/stable/index及.next保持。当前生产control end双故障、release竞态、checkout/网络/COMMIT/101后维护及修后完整构建/正式身份/全平台与Coze门禁仍OPEN。下一先补生产control操作/end双失败，不以测试helper修补代替；详638报告和639审查。顺序锁定：只读分享已闭→WebSocket前置（当前）→8C剩余→8D剩余→8E→内部Task9→整体第八项草图；新Yjs/8D/8E/草图仍冻结，整体1–6/Lovart/分享不重做，Pear移出、PSD保留。以下旧“最新/当前/进行中”仅属历史时点。

最新升级前 SQL 修补检查点（605–620）：测试辅助原两项 I 已由同席复审限定关闭；606双失败RED→607/608三个控件PASS，609共享预算退化实败并撤回，610仍9PASS/两原生产RED。生产首轮612只销毁TCP虽close返回但原waiter仍1，原失败保留；改为升级级5秒宽限取消、精确backend身份核验及独立限时控制连接确认服务端终止后，614过滤两业务PASS/九skip，615在616前冻结53输入，616完整28文件148PASS/零skip/native0/135.71秒；四生产strictlint和非增量tsc主控均观察native0。生产独审仍进行中，尚不关闭完整deadline/WS阶段。618同旧590基线保护仍62BLOCK（含新增helper）、allowlist未扩；620专库READ ONLY有限样本及schema/非idle条件保持，原5010/55494、main/stable/空index和原.next未动。本次修后完整构建/严格NFT/真实Next与正式Git身份未新验，旧581–584仅属修前历史；pending checkout/网络/COMMIT/二次成员复验故障及101后维护等待等未验边界仍OPEN。下一先收独审及这些WS前置，不推进新的Yjs/8D/8E/草图。只读分享和整体1–6/Lovart不重做，Pear移出/PSD保留；详621报告。下文旧“最新/当前”均属历史时点。

604同席诊断测试复审C0/I2：恢复辅助累计期限及双失败错误保留仍OPEN；先收测试辅助欠项/真实控件，再实现生产deadline，不放行后继。详情600/604报告及顺序记录顶部。

最新 SQL 关闭截止诊断见 `docs/testing/2026-10-05-stage7-sequence-gates.md` 顶部及600报告：602强化后六PASS/两真实持锁RED/零skip/native1，生产未改，deadline仍OPEN。诊断超期backend恢复支路尚未实跑，下一步必须拥有该升级的取消与真实连接回收，不得仅race返回或结束共享pool；后继仍冻结，下方均属历史受验时点。

最新真实 Next 自然退出检查点（573–591）：当前3641源码物理副本逐SHA核对，581四步完整构建/native0，582严格NFT0（235路由/230393引用/67宽，配置/根文档污染0），583实际产物两文件15PASS。584真实Next无DB烟测HTTP200、拒绝401/403、幂等close/端口重绑定及自然退出native0、watchdog=false；不是成功101/云端/OS信号。587诊断控制10PASS，589私有读写及九回退拦截控制PASS；guard仅覆盖三已知回退根的所列FS接口，不称全文件系统沙箱。590保护仍61BLOCK，591专库READ ONLY限定计数/sequence保持；旧失败及无DB/Yjs/安装尝试失败警告保留。先补WS剩余信号/SQL永久等待deadline、源码准入/全量业务/正式Git身份及Coze101/多实例/重启，再8C剩余→8D→8E→内部Task9→整体8；后继仍冻结，已闭切片不重做、Pear移出/PSD保留。详情见593报告、594同席审查；本条以下“最新/当前”均属历史时点。

最新数据目录竞态修补检查点（550–570）：先补WebSocket前置，不推进新的Yjs/8D/8E或整体第八项。551/552真实双worker探针同名删除触发ENOENT与回退，越界写被夹具阻断；独占随机探针最小修补后563三文件7PASS。562漏close受控变异确实FAIL并精确撤回；564在565前冻结51输入，565终态28文件143PASS/native0，566严格lint及567非增量tsc native0/空stdout/noTee。同席限定复审C0/I0/M0，只收口本次并发探针缺陷，不关闭WS或第七项。详 `docs/testing/2026-10-05-stage7-sequence-gates.md` 及571报告、572审查。

531构建虽四步0，却实际三次回退已有 `/space/wujie-data`，不称隔离成功或业务数据未触碰；549是PASS而非RED，546–548为夹具加载失败。所有旧“最新/当前”段落仅属历史检查点。修后完整构建/真实Next自然退出与诊断helper I/M、61保护BLOCK、正式Git身份/全量业务/Coze101/多实例/重启等仍OPEN；只读分享和已闭1–6/Lovart不重做，Pear移出、PSD保留。


**最新初始化失败清理检查点（467起）：** 本轮只补 WS-I3 中已取得资源在 document factory/maintenance 同步抛错后的清理所有权。468六真实监听/定时器业务RED、二prepare失败control PASS；统一缓存close owner后469默认八PASS。470在471前冻结40输入，471二十文件124PASS/native0；473 strictlint 0error/6unused warning/native1保留。等471/472终态后仅测试参数显式void；475两路径strictlint native0/空stdout/noTee，476在477前重新冻结40输入，477终态20文件124PASS/0skip/99.46秒/native0、478非增量tsc native0空stdout/noTee，484当前默认入口八PASS/native0。Peirce同席只读复核C0/I0/M0，限定关闭本轮具体初始化缺陷；最终native由主控观察，不冒审查席实跑。

479保护仍60BLOCK/native1，许可清单未扩；480专用55494 READ ONLY/on，限定公共计数/四sequence不变、非系统schema0。原5010/55494、main/stable/index/旧构建保持，未安装/付费/Coze/stage/commit/push/部署。真实Next/OS信号、SQL永久等待deadline、upgraded raw drain及HTTP-Next双清理失败矩阵、当前准入/全量业务/正式Git构建身份、Coze101/多实例/重启仍OPEN，继续先补WS前置，不后移内部Task9；新的Yjs/8D/8E/整体8草图仍冻结，现有8C只必要安全收尾，完整Task1/2/3/8C不闭。已闭1–6/Lovart/只读分享不重做，Pear移出、PSD保留。470/471和458/459均按历史受验身份保留；详482中文报告、481审查和483有限来源核验。


**最新升级前 SQL/socket 检查点（442起）：** 本轮只修 WS-I4 的升级前授权及 raw socket 关闭所有权。443真PG/TCP四RED；444四断言PASS却有一uncaught/native1，不能记GREEN；445明确票据借出连接断连错误后修补，447四PASS。独审初次I2/M1，455额外成员SQL RED、456三RED/三PASS；修后457默认六PASS。458在459启动前冻结39输入，459终态19文件116PASS/0skip/97.09秒/native0；460非增量tsc与461三路径strictlint native0/空stdout/noTee。Averroes同席只读复审C0/I0/M0，限定关闭这三个具体问题，不授予阶段/merge许可。

462保护仍60BLOCK/native1、许可清单未扩；463专用55494 READ ONLY/on，限定公共计数/四sequence不变，非系统schema0。原5010/55494、main/stable/index及旧构建标记保持。真实Next/OS信号、永久等待SQL deadline、WS-I3未验矩阵、当前源码准入/全量业务/正式构建身份与Coze101/多实例/重启仍OPEN；下一步先收这些WS前置，不后移Yjs内部Task9。新Yjs/8D/8E/整体8草图冻结；既有8C只必要安全修补，完整Task1/2/3/8C仍OPEN。只读分享/已闭1–6/Lovart不重做，Pear移出、PSD保留。448/449与旧435/436保留为历史，不冒当前候选；详465中文报告、464审查、466有限来源核验。


**最新生产 CLI 信号检查点（419起）：** 本轮只补生产入口的 runtime/信号清理所有权。421六业务RED/一原启动失败control PASS后最小修补；422七PASS。独审发现重复信号测试盲区，432补强八PASS，433临时提前移除listener变异一FAIL/七筛选skip；精确撤回后434默认八PASS。435的38个candidate在436启动前冻结，436终态18文件110PASS/0skip/90.96秒/native0，437非增量tsc与438五路径strictlint native0/空stdout。Erdos同席复核关闭本轮Important/Minor，仅支持受控Next下CLI具体缺陷限定关闭；不提供merge或阶段许可。

真实Next、OS/POSIX信号、启动永久等待deadline及既有WS-I3剩余边界仍未验；下一优先WS-I4升级前SQL/socket等待合同，之后当前源码准入/业务全量/正式构建身份与Coze101/多实例/重启。440保护仍60BLOCK/exit1、allowlist未扩；439专用55494 READ ONLY限定公共计数/四sequence不变、非系统schema0。原5010/55494保持，未改stable/业务55432、未安装/付费/Coze/提交部署；新Yjs/8D/8E/草图冻结。435继承的frozenBefore424字段不得作为最终时点证据，详441；423/435原件保留。详情见430中文报告、429审查与431有限来源核验。

**最新生命周期检查点（389–418）：** WS-I3 的 Next/HTTP 具体实现缺陷完成390五RED→391修补；独审发现顺序/admission盲区后，399两RED→400四文件21PASS，410默认入口timeout RED→411八PASS。最终418在412启动前冻结34输入，412终态17文件102PASS/0skip/81.75秒/native0，413非增量tsc与414两路径strictlint native0/空stdout。Aristotle同席末复审C0/I0，仅关闭本轮已审具体缺陷；真实Next、upgraded raw回收、初始化throw与双错误矩阵仍未证。WS-I2信号退出、WS-I4升级前SQL、保护407的60BLOCK、修后完整构建/正式Git身份及Coze101/多实例/重启仍OPEN。355/357/359仍为修前副本，后继Yjs/8D/8E/草图冻结。详情见406中文报告和405审查记录；下文旧“当前”仅属历史检查点。

**最新检查点（370–387）：** 本轮仅修复 WebSocket 启动隔离 WS-I1，376 两案实际 RED 后最小条件导入，378 三文件16PASS；379 当前矩阵15文件93PASS/0skip/native0，380 非增量类型检查与381两路径 strict lint native0。Singer 同席限定复审 C0/I0/M0，只关闭 WS-I1；WS-I2–I4、保护384的60BLOCK、修后全量业务/正式构建身份及云端101/多实例/重启仍OPEN。355/357/359属于352**修前副本**，不再代表修后当前源码；372/373是修前保守导入图与优先级，不是运行故障或准入许可。前置不闭不推进新Yjs、8D/8E或草图；详情见 `docs/testing/2026-10-05-stage7-sequence-gates.md` 与386报告。下方早期“当前”口径均为当时检查点。

- 2026-10-05本轮350–361补当前Git可见源码副本完整构建/NFT诊断及全仓quietlint；原.next不动，未提交副本unverified身份不冒充正式exact-main。保护60BLOCK与业务全仓、Coze101/真实云端多实例/服务重启仍OPEN，详360及权威顺序记录；不据局部诊断勾Task7全关闭。

- 2026-10-05顺序纠正：本阶段云端101、多实例/重启是后继Yjs推进的前置，不再后移到Yjs内部Task9冒称顺序恢复。当前执行合同见 `docs/testing/2026-10-05-stage7-sequence-gates.md`；现有8C仅安全收尾，新的8D/8E/草图冻结。旧本地和构建证据须重新绑定当前源码身份，不重复已闭功能。
- 只改 `main`，保留现有六份用户 `.superpowers/sdd` 工作树修改；`stable`、V5.8.8 donor 只读。
- `WUJIE_PRESENCE_ENABLED` 默认关闭；匿名 Canvas Share token 不提供在线房间资格。
- 仅显示 presence，不传画布/节点/聊天内容；Yjs 编辑权限另设门禁。
- 票据单次、30 秒有效，数据库只存哈希；心跳建议 15 秒，租约 45 秒。
- 默认启动、原有 HTTP、静态资源、Build ID、现有所有入口不得退化。
- 每项先 RED、最小 GREEN、聚焦/真库/全量回归，再做 exact-main Coze Chrome 验证；真实无法验证的一律标记 `UNVERIFIED`。
- Coze 不能透传同源 upgrade 时 fail-stop，不能以 SSE/轮询替代完成。

## 文件职责图

| 文件 | 唯一职责 |
| --- | --- |
| `scripts/presence-server.ts` | Next 同源 HTTP/upgrade 入口，不含业务权限 SQL |
| `src/lib/collaboration/presence-schema.ts` | 帧与输入的 Zod 合同、常量 |
| `src/lib/collaboration/presence-members.ts` | 所有者/成员资格读写与撤销 |
| `src/lib/collaboration/presence-tickets.ts` | 随机票据、哈希、原子消费 |
| `src/lib/collaboration/presence-leases.ts` | PostgreSQL 租约、聚合、过期清理、通知 |
| `src/lib/collaboration/presence-gateway.ts` | `ws` 连接生命周期、节流、快照广播 |
| `src/lib/collaboration/presence-client.ts` | 浏览器票据请求、连接、退避重连和项目切换 |
| `src/components/collaboration/presence-indicator.tsx` | 画布在线状态与成员管理展示 |

---

### Task 1: 同源 upgrade 能力与默认启动兼容门禁

**Files:**
- Create: `scripts/presence-server.ts`
- Create: `src/__tests__/scripts/presence-server-contract.test.ts`
- Modify: `package.json`
- Modify: `scripts/coze-start.sh`

**Interfaces:**
- Produces: `resolvePresenceEnabled(value: string | undefined): boolean`、`isPresenceUpgradePath(pathname: string): boolean`、`startPresenceServer({ port, dev, onUpgrade })`；`onUpgrade(req, socket, head)` 只收到精确 `/api/collaboration/presence`；开发态其他 upgrade 委托 Next handler。
- Task 5 注入真实 gateway；默认关闭不进入本启动入口。

- [ ] **Step 1: 写失败测试。** 断言默认 `coze-start.sh` 仍执行 Next，只有精确开关 `true` 才执行 presence server；在线状态升级只到目标回调，开发态 `/_next/webpack-hmr` 升级交给 Next，生产态未知升级拒绝；普通 HTTP 返回原 Next 页面、`/_next/static` 和健康端点可用。

```ts
expect(resolvePresenceEnabled(undefined)).toBe(false);
expect(resolvePresenceEnabled('true')).toBe(true);
expect(isPresenceUpgradePath('/api/collaboration/presence')).toBe(true);
expect(isPresenceUpgradePath('/api/collaboration/presence/other')).toBe(false);
```

- [ ] **Step 2: 运行 RED。** `pnpm exec vitest run src/__tests__/scripts/presence-server-contract.test.ts --reporter=dot`，应因入口/导出缺失失败。
- [ ] **Step 3: 最小 GREEN。** `createServer(nextHandler)` 后仅精确路径调用 `onUpgrade`；开发态其他 upgrade 调用 `app.getUpgradeHandler()`，生产态未知 upgrade 拒绝；`pnpm start` 保持原样，新增 `start:presence`/`dev:presence`，Coze 启动仅在开关 true 时选新入口。将已安装的 `tsx` 从开发依赖移到生产依赖并同步锁文件，启动用 `./node_modules/.bin/tsx scripts/presence-server.ts`；不得清理 `.next` 或修改构建标记逻辑。

```js
export function isPresenceUpgradePath(pathname) {
  return pathname === '/api/collaboration/presence';
}
```

- [ ] **Step 4: 运行 GREEN 与兼容测试。** 目标测试加现有 `coze-start-production-contract`、`coze-start-build-identity`；观察真实 HTTP/静态资源与 build marker。
- [ ] **Step 5: 先做本地能力探针。** 在独立本地进程以测试专用无业务握手核实普通 Next HTTP 与同源 upgrade 可共存；Coze 真实 5000 透传留到 Task 7 exact-main 阶段验证，不把本地结果扩大为云端通过。
- [ ] **Step 6: 仅暂存本任务文件并提交。** `git diff --check` 后提交 `feat: establish same-origin presence upgrade entry`；不得加入六份用户文件。

### Task 2: 项目在线成员资格

**Files:**
- Create: `migrations/20260924_project_presence.sql`
- Create: `src/lib/collaboration/presence-members.ts`
- Create: `src/__tests__/lib/presence-members.test.ts`
- Create: `tests/integration/presence-members-postgres.test.ts`
- Create: `src/app/api/collaboration/members/route.ts`
- Create: `src/__tests__/api/collaboration-members.test.ts`

**Interfaces:**
- Produces: `assertPresenceMember(actorUserId: string, projectId: string): Promise<void>`；`grantPresenceMember(ownerId: string, projectId: string, memberUserId: string): Promise<void>`；`revokePresenceMember(...): Promise<void>`。
- Task 3/5 只调用资格函数，不查询匿名分享表。

- [ ] **Step 1: 写 RED。** 真库断言所有者可进入、非成员不可进入、禁用用户不可进入、不同 owner/project 的同名 ID 不串房间；重复邀请幂等，撤销后立即拒绝；成员 API 需要登录、同源且仅 owner 可改。

```ts
await expect(assertPresenceMember('outsider', projectId))
  .rejects.toMatchObject({ code: 'PRESENCE_FORBIDDEN' });
await grantPresenceMember(ownerId, projectId, memberId);
await expect(assertPresenceMember(memberId, projectId)).resolves.toBeUndefined();
```

- [ ] **Step 2: 运行 RED。** `pnpm exec vitest run src/__tests__/lib/presence-members.test.ts tests/integration/presence-members-postgres.test.ts src/__tests__/api/collaboration-members.test.ts --reporter=dot`，真库须显式设置独立 `POSTGRES_TEST_DATABASE_URL`，不能指向业务库。
- [ ] **Step 3: 最小 GREEN。** 迁移增加 `wujie_project_presence_members`（项目+owner+member 唯一、`active/revoked`）；先验 `wujie_projects(id,owner_id,status='active')` 和 `wujie_users(id,status)`。Owner 是隐式成员；成员仅获 presence，不扩大现有资产 API 权限。API 使用 `getSessionUser` 与现有同源变更校验。
- [ ] **Step 4: 聚焦、迁移二次运行和提交。** 真库同时验证约束、跨账号隔离和重复执行安全；`pnpm ts-check`、`pnpm lint:build`、`git diff --check` 通过后只提交本任务文件。

### Task 3: 一次性 WebSocket 票据

**Files:**
- Modify: `migrations/20260924_project_presence.sql`
- Create: `src/lib/collaboration/presence-tickets.ts`
- Create: `src/app/api/collaboration/presence-ticket/route.ts`
- Create: `src/__tests__/lib/presence-tickets.test.ts`
- Create: `tests/integration/presence-tickets-postgres.test.ts`
- Create: `src/__tests__/api/presence-ticket.test.ts`

**Interfaces:**
- Produces: `issuePresenceTicket(userId: string, projectId: string): Promise<string>`；`consumePresenceTicket(rawTicket: string): Promise<{ userId: string; projectId: string } | null>`。
- Task 5 调用 `consumePresenceTicket`，随后再次调用 `assertPresenceMember`。

- [ ] **Step 1: 写 RED。** 票据随机性、哈希存储、30 秒有效、同一票据并发消费只成功一次、过期/跨项目/撤销后拒绝；API 不缓存、不记录 raw ticket、不接受跨源 POST。

```ts
const raw = await issuePresenceTicket(userId, projectId);
const consumed = await Promise.all([
  consumePresenceTicket(raw), consumePresenceTicket(raw),
]);
expect(consumed.filter(Boolean)).toHaveLength(1);
```

- [ ] **Step 2: 运行 RED。** 对上述三个文件 `pnpm exec vitest run ... --reporter=dot`，确认失败来自缺少实现而非数据库误连接。
- [ ] **Step 3: 最小 GREEN。** `randomBytes(32).toString('base64url')`，SHA-256 哈希存库，`UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING` 原子消费；签发前复核成员资格；响应 `Cache-Control: no-store`，禁止 URL/query 传票据。
- [ ] **Step 4: 真库、静态泄漏扫描和提交。** 跑聚焦与 API 回归，检查日志/错误/数据库不含 raw；`pnpm validate` 后提交本任务文件。

### Task 4: 权威在线租约与多实例收敛

**Files:**
- Modify: `migrations/20260924_project_presence.sql`
- Create: `src/lib/collaboration/presence-leases.ts`
- Create: `src/lib/collaboration/presence-schema.ts`
- Create: `src/__tests__/lib/presence-leases.test.ts`
- Create: `tests/integration/presence-leases-postgres.test.ts`

**Interfaces:**
- Produces: `joinPresence(input: { connectionId: string; userId: string; projectId: string; instanceId: string }): Promise<PresenceSnapshot>`；`renewPresence(connectionId: string): Promise<boolean>`；`leavePresence(connectionId: string): Promise<void>`；`readPresenceSnapshot(projectId: string): Promise<PresenceSnapshot>`；`subscribePresence(projectId: string, onChange: () => void): Promise<() => void>`。
- `PresenceSnapshot = { projectId: string; sequence: number; participants: Array<{ userId: string; displayName: string; lastSeenAt: string }> }`；事件不含资产或账号私密字段。

- [ ] **Step 1: 写 RED。** 两标签同用户合并、不同用户独立、续租、45 秒过期、正常退出、进程崩溃后清理、通知丢失后周期快照、跨项目隔离、序号递增与多实例并发。

```ts
await joinPresence({ connectionId: 'a', userId, projectId, instanceId: 'one' });
await joinPresence({ connectionId: 'b', userId, projectId, instanceId: 'two' });
expect((await readPresenceSnapshot(projectId)).participants).toHaveLength(1);
```

- [ ] **Step 2: 运行 RED。** 聚焦单元与独立 PostgreSQL 集成测试。
- [ ] **Step 3: 最小 GREEN。** `wujie_presence_leases` 保存连接/项目/用户/实例/到期；数据库事务内更新项目 sequence，`LISTEN/NOTIFY` 只唤醒，读取权威快照后广播；TTL 清理与成员撤销都使快照更新。按 15 秒心跳、45 秒租约实现，不把进程 Map 当事实源。
- [ ] **Step 4: 真库故障注入、迁移重复运行和提交。** 断开监听连接、终止一个测试网关实例，证明 TTL 与重连收敛；聚焦、类型/Lint、diff check 通过后提交本任务文件。

### Task 5: WebSocket 协议、安全和资源界限

**Files:**
- Create: `src/lib/collaboration/presence-gateway.ts`
- Modify: `scripts/presence-server.ts`
- Modify: `package.json` and `pnpm-lock.yaml` only if `@types/ws` is not already available as an explicit dev dependency
- Create: `src/__tests__/lib/presence-gateway.test.ts`
- Create: `tests/integration/presence-websocket-postgres.test.ts`

**Interfaces:**
- Produces: `handlePresenceUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>`。
- 只接受精确同源 Origin 与协议 `wujie-presence-v1` + 单次票据；连接后调用 Task 3/4 的函数。

- [ ] **Step 1: 写 RED。** 无/重放/过期票据、跨源、非成员、撤销、二进制帧、超限消息、每人连接上限、背压；合法连接收到快照，两个实例收到同一成员变更；关闭标志时 upgrade 失败且普通 HTTP 不变。

```ts
const first = await connectWithTicket(rawTicket);
expect(first.snapshot.participants).toHaveLength(1);
await expect(connectWithTicket(rawTicket)).rejects.toMatchObject({ status: 401 });
```

- [ ] **Step 2: 运行 RED。** 在独立临时 HTTP/PG 服务运行聚焦；不要连接 Coze 业务库。
- [ ] **Step 3: 最小 GREEN。** `WebSocketServer({ noServer: true, maxPayload: 1024 })`；升级前严格检查路径/Origin/静态协议/票据并复核资格；只发送名单、序号和连接状态；慢客户端断开，心跳和退避由协议控制；日志不含票据/Cookie。
- [ ] **Step 4: 运行聚焦、完整 API/脚本回归和提交。** 另测普通 `/api/auth/me`、画布分享公开路由、`/_next/static` 未被升级监听截获。

### Task 6: 画布 UI 和浏览器生命周期

**Files:**
- Create: `src/lib/collaboration/presence-client.ts`
- Create: `src/components/collaboration/presence-indicator.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Create: `src/__tests__/lib/presence-client.test.ts`
- Create: `src/__tests__/components/presence-indicator.test.tsx`
- Create: `tests/e2e/presence-online.spec.ts`

**Interfaces:**
- Produces: `useProjectPresence(projectId: string | null)`，只返回 `status: 'disabled'|'connecting'|'online'|'unavailable'` 与安全参与者列表；项目切换、卸载和退出登录关闭旧 socket。
- 所有者成员管理调用 Task 2 API；匿名只读分享不导入此客户端。

- [ ] **Step 1: 写 RED。** 票据获取失败显示不可用、同用户两标签合并、断线有界重连、旧项目事件丢弃、关闭后零重连、窄屏不遮挡工具栏、分享页不出现在线 UI。

```ts
expect(screen.getByRole('status', { name: '在线状态' })).toHaveTextContent('连接中');
await switchProject('project-b');
expect(oldSocket.close).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: 运行 RED。** 聚焦 client/component 测试，确认不是测试环境假失败。
- [ ] **Step 3: 最小 GREEN。** 票据只存在内存，浏览器以 `wss:`/`ws:` 同源连接；指数退避带抖动且页面隐藏/登出可清理；画布标题区接独立组件，不改 16K 行画布状态机；移动端紧凑显示。
- [ ] **Step 4: 运行聚焦、E2E 与提交。** 本地两账号两浏览器真实 socket 验证在线/离线/撤销和 Console/Network；无真实账号时只记受控测试通过。

### Task 7: 完整门禁、云端验证与阶段收口

**Files:**
- Modify: `docs/testing/baselines/protected-baseline-allowed-paths.json`（只登记本阶段精确源码路径）
- Create: `docs/testing/v588-websocket-presence-evidence.md`
- Modify: 项目 Obsidian `16-V5.8.8选择性吸收.md` 与 `11-阶段进度看板.md`

**Interfaces:**
- Produces: 精确 `main` 源码树、构建标记、浏览器/真库/云端证据及未验证清单；不触发 Yjs 阶段自动通过。

- [ ] **Step 1: 保护基线 RED→GREEN。** 先运行 `pnpm check:protected-baseline` 捕获仅本阶段新增路径，再逐项登记，无目录通配符；重跑需 0 drift。
- [ ] **Step 2: 全量本地。** 独立 PostgreSQL 完整迁移后运行 `pnpm exec vitest run --testTimeout 30000 --reporter=dot`、`pnpm validate`、`pnpm build`；计数、失败和跳过均如实记录，临时库仅用于测试并停止。
- [ ] **Step 3: 多浏览器。** Chromium/Firefox/WebKit、320/375/393px 两用户两项目，在真实 socket 下验证切换、掉线、恢复、权限撤销、匿名分享隔离和 HTTP 兼容；保存 Trace、Console、Network 与错误。
- [ ] **Step 4: Coze exact-main。** 核对 `HEAD^{tree}`、Build ID、完成标记、唯一 5000 进程和同源 101 upgrade；隔离账号/库验证成员、重连、撤销和多实例/重启失效。若代理不支持或 CI 未执行，标 `UNVERIFIED` 并停止发布结论。
- [ ] **Step 5: 更新中文证据、Obsidian 并复审。** 按通过范围关闭 WebSocket presence 单阶段；保留 Yjs、草图转代码、Pear、真实付费取消/唯一退款及总体发布门禁为开放项；`stable` 不动。
