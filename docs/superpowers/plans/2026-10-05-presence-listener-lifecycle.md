# WebSocket共享LISTEN生命周期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关闭共享listener在初始化、最后订阅退出及重连期间的资源所有权缺口，保留其他Room和健康业务连接。

**Architecture:** 一个进程共享listener owner，token独立引用，epoch拥有ready及completion；最后token退出才退休epoch。Room取消不能冒充整个进程取消；共享listener的原生checkout由既有withPresenceConnection持有。原生连接生产者不可遗弃。

**Tech Stack:** TypeScript、Node.js、pg、ws、Vitest、显式隔离PostgreSQL。

**Spec:** `docs/superpowers/specs/2026-10-05-presence-listener-lifecycle-design.md`。

## 执行节奏调整（2026-10-05 用户要求加速）

不再将每个局部控件当作一个完整收尾批次：集中完成owner、subscribe及Room/gateway接缝，以原持锁关闭RED转绿为关键结果；然后一次完整相关回归、同席集中独审及统一记录。只有新增源码、具体失败或审查问题才触发必要的重验，不重复已闭阶段或无变更矩阵。

当前方案已有真实证据支持，不因耗时换成遗弃原生生产者、跳过回收或弱化断言的方案。951接入时误删仍被bumpSequence使用的原常量/类型，导致四FAIL，已恢复；952实际回收断言通过但原生取消拒绝仍使清理FAIL，原失败保留。953严格按确切pipeline、实际57P01确认、独立锁仍held、完整backend消失、TCP退休及健康SQL断言归属预期取消，四PASS。955/956完整矩阵217PASS/1FAIL，暴露全局旧回收错误阻止下一epoch；958实际RED后最小恢复guard，959两文件12PASS。960校准同Room成员真正取得release的前置条件，两PASS。961去掉refresh等待变异实际FAIL，准确恢复后962专项PASS；963真实LISTEN初始化SQL错误、退休、重连和通知专项PASS。964/965完整220PASS但未覆盖独审发现的pending close错误竞态；967真实RED后同步错误快照修补，968 owner九PASS、同席限定C0/I0/M0。新增fallback测试no-this-alias已准确校正。969再冻结60输入/34路径，970最终220PASS/零skip/native0/389.13秒；最终非增量tsc与七路径strictlint native0。971保护63BLOCK保持；972专库READ ONLY有限样本及隔离条件保持。阶段前置、错误保留和发布边界不变。

后续批次先集中专项与同席源审查，消除具体C/I后才跑昂贵完整矩阵；已启动的矩阵按原句柄观察终态，运行中不修改冻结源码。完整回归后的无源码变更不重复运行。统一记录一次，已闭阶段不重做。

## Global Constraints

- 整体第七项仍在WebSocket前置；不新增Yjs、8D/8E或整体第八项草图。Pear移出、PSD核心保留。
- 仅在main工作树编辑；stable、六份human平面SDD、保护许可清单和原活动.next不修改。不stage/commit/push、不安装、不付费、不同步/部署Coze。
- 真实数据库仅`127.0.0.1:55494/wujie_bridge_test_ownerui_20261003`；必须在schema创建前校验主机、端口和库名。测试用隔离schema；业务55432不接触。
- 当前池max5、连接等待10000ms、闲置30000ms保持；原重连1000ms保持；不调用业务pool.end、不建立每Room独立LISTEN。
- 原异常、RED、首lint失败和已关闭切片都保留；原925 native1，旧915的204PASS不是新增listener规格通过。
- 主控唯一编辑者，复用同一只读审查席。已授权最优方案，按内联executing-plans执行，不新开人类任务、不重复派工。

## 文件结构

| 路径 | 职责 |
|---|---|
| `src/lib/collaboration/presence-listener.ts`（新增） | 共享连接epoch、token、真实checkout退休、重连 |
| `src/lib/collaboration/presence-leases.ts` | 保留project callback/reconcile，接入token；不重写renew/leave/maintenance |
| `src/lib/collaboration/presence-gateway.ts` | Room初始化中途释放、signal接入、unsubscribe与refresh共同排空 |
| `tests/integration/presence-listener-shutdown-postgres.test.ts` | 已有真实pipeline RED、普通退出、callback错误控件，扩充网关接入边界 |
| `tests/integration/presence-listener-owner-postgres.test.ts`（新增） | 两token共享、真实迟到checkout、epoch退休/重连/错误传播 |

## Task 1：验证器错误归属与业务RED

**Files:** `tests/integration/presence-listener-shutdown-postgres.test.ts`。

**Interfaces:** 消费真实pg Client.query及Pool.query callback；产出`verifyListenerShutdown(blockListener: boolean, callbackFault?: Error): Promise<void>`。

- [x] 原生LISTEN前队列真实advisory_xact_lock，在独立locker未释放时检查关闭Promise、完整backend身份和实际TCP。922持锁FAIL，普通PASS。
- [x] 924真实SQL314及Pool callback先成功交付再抛原fault；旧allSettled忽略rejected，控件实际FAIL。
- [x] 保留全部拒绝，聚合body/cleanup；先登记initial message、再等待真实open；独立锁仍held需实际SQL断言。925普通及错误控件PASS，业务持锁FAIL。

实际排空代码：

```ts
const settled = await within(
  Promise.allSettled([...operations, ...callbacks, ...upgrades]),
  12_000, 'native observations',
);
const errors = settled.flatMap(result =>
  result.status === 'rejected' ? [result.reason as unknown] : [],
);
if (errors.length > 0) {
  throw new AggregateError(errors, 'Actual listener observation or delivery failed');
}
```

- [x] 生产取消实现后，保留所有native拒绝；只有在业务断言已证明具体listener退休、独立锁仍持有且该checkout身份一致时，才能把**该pipeline**原生取消拒绝登记为预期。953另要求实际PG57P01确认及完整backend消失；其他query、callback或cleanup错误始终失败。
- [x] 同席实际读源确认清理I、101 M、client/identity配对M限定关闭，927指纹一致；928仍2PASS/1业务RED。下一进入Task2，不把辅助控件PASS当业务修好。

## Task 2：进程共享listener owner

**Files:** 新增`src/lib/collaboration/presence-listener.ts`及`tests/integration/presence-listener-owner-postgres.test.ts`。

**Interfaces:** 消费`withPresenceConnection(signal: AbortSignal | undefined, operation)`；产出下列精确接口，Task3只依赖这些接口。

```ts
export interface PresenceListenerToken {
  readonly ready: Promise<void>;
  close(): Promise<void>;
}
export interface PresenceListenerOwner {
  retain(signal?: AbortSignal): PresenceListenerToken;
}
export function createPresenceListenerOwner(
  onProjectChange: (projectId: string) => void,
): PresenceListenerOwner;
```

- [x] 写两token真库控件：相同owner.retain两次，等待ready；实际PG仅一条LISTEN会话。关闭第一token并真实pg_notify，第二token仍收到project通知且原listener完整身份保持。关闭第二token后该listener实际TCP结束，无关健康checkout SQL42及身份保持。
- [x] 写连接迟到控件：占满实际pool checkout再retain，确认实际pool.waitingCount增加；取消token后释放一个真实checkout，验证该迟到checkout零SQL、已退休且预采样完整身份消失。另测原10000ms超时；943八PASS，945去guard变异抓到身份SELECT，946准确恢复后PASS。
- [x] 执行新测试，确认935为缺少owner实现，而非环境故障；不是五个业务断言已证明。四显式数据库变量齐全。
- [x] 实现不可变epoch。每个epoch初始化controller、ready、completion及监听停止gate；completion覆盖从pool.connect到TCP退休全寿命。使用`withPresenceConnection(epoch.controller.signal, async client => { ... })`的operation先实际LISTEN，再等待停止gate；该operation结束前不得释放checkout。以下状态表是强制分支，不只检查状态文本：

| 条件 | 实际动作 | 等待归属 |
|---|---|---|
| 首token加入 | 创建epoch并开始真实checkout/LISTEN | token.ready观察初始化，epoch.completion观察全寿命 |
| 非末token退出 | 删除该token、取消其ready等待 | 不abort epoch、不等待剩余订阅寿命 |
| 末token退出 | 清重连timer，abort epoch，唤醒停止gate | close缓存并返回实际completion |
| checkout迟到且已取消 | 不派发身份SQL或LISTEN，退休具体checkout | await实际原生生产者/transport |
| 真listener断连且token仍在 | 旧epoch完整退休后1000ms重连 | 新epoch不复用旧identity |
| 旧epoch finally/旧断连 | 仅当current===epoch才清current | 禁止覆盖新epoch |
| 退休中有新token | 先观察旧completion，再创建新epoch | 不并行建两个共享listener |

- [x] ready失败降级保持旧reconcile能力：普通LISTEN不可用时初始化尝试结束，仍有订阅则重连；实际清理不确定性须传播PresenceConnectionCleanupError，不以降级吞掉。963实际22012错误与完整身份/TCP、重连通知通过；967旧关闭错误被新retain擦除真实RED，关闭时快照修补后968九PASS，旧失败Promise及原cause保留。
- [x] 写真实终止旧listener、关闭时禁止重连及退休过程中新增token控件；以真实后端身份、通知和TCP证明，不断言mock次数。新增实际control connect边界故障原错误传播及初始化中首token退出survivor控件。
- [x] 运行owner规格及已有leases listener重连/抛错callback规格，确认全部原生终态。Task2由同席限定复审，不提供整体阶段许可。

## Task 3：订阅及Room初始化中途取消接入

**Files:** 修改`presence-leases.ts`、`presence-gateway.ts`；扩充`presence-listener-shutdown-postgres.test.ts`、原room/WebSocket测试。

**Interfaces:** 消费Task2的`PresenceListenerOwner`、`PresenceListenerToken`；subscribePresence追加可选signal，旧三参数调用保持。

```ts
subscribePresence(projectId, onChange, reconcileIntervalMs, room.controller.signal);
// 关闭准入后，取消此gateway自己的Room；不能结束其他gateway的token。
for (const room of rooms.values()) room.controller.abort();
```

- [x] subscribe先取得token与幂等close入口，再await token.ready。close先移除本project callback、清本timer，再await token.close；失败不保留callback/timer。signal侦听器也由同一close回收，不生成未观察的finally拒绝。
- [x] Room在await selected.ready之前建立release所有权，并登记客户端物理退出路径。单客户端退出只删其引用；最后成员才取消Room订阅。已有成员或其他gateway的Room不被首客户端信号绑定。
- [x] unsubscribe和refresh排空使用下列真实等待规则，拒绝原因不得丢弃：

```ts
const settled = await Promise.allSettled([
  selected.unsubscribe ? selected.unsubscribe() : Promise.resolve(),
  selected.refreshing,
]);
const errors = settled.flatMap(result =>
  result.status === 'rejected' ? [result.reason as unknown] : [],
);
if (errors.length > 0) throw new AggregateError(errors, 'Room unsubscribe and refresh failed');
```

- [x] gateway.close在关闭准入后取消自己的Room初始化，仍等待已登记升级/加入/lease cleanup；未知清理错误进入原close Aggregate，不阻断其他资源排空。
- [x] 925原持锁控件应在独立lock仍held时完成真实退休；不得通过主动提前解锁、扩大8秒观察预算或删TCP断言取绿。普通TCP竞态也应由同一owner完成合同解决。
- [x] 增加两个实际gateway共享listener控件，一个gateway关闭后另一gateway继续接收真实通知；再覆盖初始化中途仅首客户端退出、最后客户端退出和unsubscribe故障仍排空refresh。
- [x] 全部listener/leases/room/WebSocket/post-join相关规格GREEN后，复用同席审查准确生产before差异，不把整脏diff当新增。

## Task 4：当前候选证据、记录与前置接续

**Files:** 本计划、设计、第七项顺序/WS证据/两个协作计划和Obsidian看板；新增独立编号原始日志及有限审计。

- [x] 从914.tests保留原31路径，追加shutdown、owner、peer三个listener测试路径；实际60源码/依赖/测试输入、34测试路径运行前冻结，不能沿用920/915身份；最终候选还须与错误快照修补后的源码一致。
- [x] 四变量显式绑定后运行相关完整矩阵，不改名失败日志、不把筛选skip当零skip。运行句柄返回live时只观察同一handle，不重新启动。

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55494/wujie_bridge_test_ownerui_20261003'
$env:DATABASE_URL=$env:POSTGRES_TEST_DATABASE_URL
$env:PGDATABASE_URL=$env:POSTGRES_TEST_DATABASE_URL
$env:TEST_POSTGRES_URL=$env:POSTGRES_TEST_DATABASE_URL
$taskOld=Get-Content 'output/playwright/semantic-target-source-20261004/stage7-room-budget-final-freeze-914.json' -Raw | ConvertFrom-Json
$taskPaths=@($taskOld.tests)+@('tests/integration/presence-listener-shutdown-postgres.test.ts','tests/integration/presence-listener-owner-postgres.test.ts','tests/integration/presence-listener-peer-postgres.test.ts')
node node_modules/vitest/vitest.mjs run @taskPaths --reporter=dot
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

- [x] 严格lint实际改动的owner/leases/gateway及相关测试；源码保护检查仍按原allowlist运行，逐路径准入欠项不得以新增许可隐藏。修后完整构建/严格NFT/正式Git身份另设实际门禁，不竞争原.next。
- [x] 最后测试/类型终态后，专库BEGIN READ ONLY查原有限样本、schema及其他non-idle；重哈希实际冻结输入、六human/AGENTS/allowlist、旧证据、原refs/index/服务/build markers。有限审计不等于全库无写或全平台验收。
- [x] 更新五处顶部同一口径，保留所有旧历史。独审席完成后关闭；overall goal继续active，直到完整目标实证完成。
- [ ] 后续renew/leave/maintenance与未知COMMIT交付合同已由Task5/6限定验证；693自然根因仍未验证，源码准入/正式构建和云端门禁保持开放，不直接跳Yjs。只读分享及已闭整体1–6不重做。

## 自检与实施方式

设计的共享引用、初始化取消、迟到checkout、重连旧epoch、物理TCP、错误保留均已有真实控件及同席限定审查。Task1–3及Task4已勾选仅指本listener合同和记录，不是Yjs同名Task、完整WS或第七项关闭。最终证据见973报告/974有限审计；后继续期、退出、维护及发布门禁继续开放，已闭不重做。

按用户站立授权选定内联executing-plans：主控唯一编辑、同席只读审查，不另开任务或安装运行时；进入Task2前先完成Task1审查。此计划不产生commit、部署或merge许可。

## Task 5：101后续期、退出与维护关闭集中批次

本批次从实际源码定位到同类所有权缺口：renew各SQL没有signal，gateway leave调用没有signal，maintenance stop只等待原生SQL且吞周期异常。选择沿用withPresenceConnection，不修改连接helper、共享owner、池容量或原始重连/心跳配置；拒绝仅Promise.race返回、结束全局池或按Room重复建连接。未知COMMIT/693及正式发布门禁另有未闭合同，不以本批次替代。

**Files:** 修改`src/lib/collaboration/presence-leases.ts`、`presence-gateway.ts`、`presence-tickets.ts`；新增`tests/integration/presence-post-join-drain-postgres.test.ts`。主控唯一编辑、同席只读集中审查，不提交或创建worktree。

**Interfaces:**

```ts
renewPresence(connectionId: string, signal?: AbortSignal): Promise<boolean>;
expirePresenceLeases(batchSize?: number, signal?: AbortSignal): Promise<number>;
pruneExpiredPresenceTickets(batchSize?: number, signal?: AbortSignal): Promise<number>;
startPresenceMaintenance(intervalMs?: number): () => Promise<void>;
```

旧调用保持兼容。signal必须覆盖renew的查租约、成员复验、成员失效leave及UPDATE事务；expire/prune覆盖原生checkout与全部SQL。取消发生后不另派ROLLBACK到被取消的checkout，实际回收交由已有helper。

- [x] 新真实四分支控件：renew以独立users表锁阻塞成员复验，leave以独立租约行锁阻塞DELETE，expire/prune分别独立表锁阻塞原查询。真实票据/101/首帧建立完成后才锁定gateway分支；maintenance正常执行真实周期。完整backend身份配对具体Client、查询timeout保持0，持锁者在断言完成前不解锁。

```ts
expect(settledBeforeUnlock).toBe(true);
expect(targetClient.connection.stream.closed).toBe(true);
expect(exactBackendCount).toBe(0);
expect(independentLockStillHeld).toBe(true);
expect(healthyAnswer).toBe(42);
```

renew预期gateway正常关闭并实际leave后lease0；被锁leave须拒绝gateway.close且保留真实SQL错误，不能把未删除租约冒成功；maintenance主动取消持锁SQL也须向stop报告真实错误，具体连接退休后不得继续prune或启动新周期。真实DB错误仅由body证明的exact target/exact error豁免于测试观测清理，其余错误全部保留。

- [x] 运行该四分支，确认RED实际来自SQL/TCP/关闭未终态，不是类型/环境/夹具失败。始终仅专库55494，四变量绑定；先ROLLBACK独立locker再排空所有真实生产者，body及cleanup错误聚合。
- [x] renew增加可选signal，各入口沿用withPresenceConnection；gateway每client单独renew controller，cleanup abort它，不影响其他client/gateway。leave采用新controller及5000ms deadline，finally清timer并等待helper实际退休；错误进入原close Aggregate。

```ts
const leaveController = new AbortController();
const deadline = setTimeout(() => leaveController.abort(), 5_000);
owned.push(leavePresence(connectionId, leaveController.signal).finally(() => clearTimeout(deadline)));
```

- [x] maintenance每周期独立controller；stop先关闭准入/interval，缓存同一个close Promise，abort周期并等待其真实pending。运行时普通失败仍允许后续周期重试；关闭中的原错误不吞，CleanupError锁存且停止新周期，并由stop返回。expire/prune使用相同周期signal，取消后禁止进入下一个SQL阶段。

```ts
stopping = true;
clearInterval(timer);
const owned = pending;
controller?.abort();
closing = Promise.resolve(owned).then(() => { if (cleanupFailure) throw cleanupFailure; });
```

- [x] 四分支GREEN及原leases/tickets/WebSocket控件通过；新增正常停止、后台CleanupError锁存/stop原错误与实际健康连接护栏按具体证据补充，不用mock次数当行为。982原三文件24PASS，精确原生helper终态和额外SQL错误豁免强化见982c/982e；最终985b相关35文件226PASS/0FAIL/0skip/native0。
- [x] 同席集中读actual before差异及失败/成功日志；具体C/I关闭后冻结原60输入加新test、原34路径加新test。首985因类型TS2367已中止/native1并保留日志；仅联合类型修正的JS逐字相同见983b。类型/四路径strictlint/改动路径空白全部0后984b重新冻结，985b最终完整矩阵405.28秒。保护清单不扩；源码准入与完整构建/NFT仍开放。今后快速静态检查前置，不在已知失败候选上等完昂贵矩阵。
- [x] 终态后专库READ ONLY有限样本/隔离、main/stable/index/原服务与构建标记及冻结SHA核验，统一五处当前口径和本计划；已闭listener不重做，继续未知COMMIT/693与发布门禁，goal保持active。详988报告/989有限审计/990保存后回读；任何检查失败须撤销本记录的完成口径，不代替全部Stage7或发布验收。

自检：signal接口参数顺序一致，三个现有文件承担各自边界，不新增生产辅助接口供测试使用。四个持锁分支对应明确缺陷；正常行为与错误保留另由原规格和新增真实护栏验证。用户要求加速不免除错误、TCP与真实SQL证据。

## Task 6：未知 COMMIT 与历史取消竞态集中收口

**Files:** `src/lib/collaboration/presence-leases.ts`；新增 `tests/integration/presence-uncertain-commit-postgres.test.ts`；若真实证据确认历史693是测试控制窗口耗尽，则只调整原 `presence-connection-postgres.test.ts` 的同步顺序，不改生产1秒取消控制期限。主控唯一编辑，同席只读审查，保留旧失败日志。

设计选择：加入者在发送 COMMIT 前接管不确定提交的租约补偿责任；确认成功但回执丢失也必须用现有 fresh-controller / exact-connection-id 删除。COMMIT 原生失败且实际回滚时补偿应无副作用；INSERT 前失败不得删除其他连接的既有租约。补偿失败保留原提交错误和真实删除错误，不伪造成功。控制只在真实 SQL 已完成后破坏结果交付，明确不冒充自然网络丢包。

- [x] 真实专库建立成功租约/独立健康借用护栏，再对真实 COMMIT 结果交付施加故障；992为3FAIL/2PASS，确认两个残留租约与补偿删除原错误未保留的RED。五案覆盖有/无signal、真实延迟触发器COMMIT拒绝、既有connectionId冲突和真实DELETE失败。
- [x] 沿用原补偿 helper，只在发送COMMIT前接管不确定提交责任；验证零误删、原错误保留、序号与独立健康借用不被干扰。994原四文件66PASS，collector修正后999五新案/两竞态共7PASS，25仅过滤skip。
- [x] 限定证明并修正夹具控制窗口：993在真实second checkout后人为延迟交付1100ms，原控制期限耗尽，1FAIL/26过滤skip；准备连接和身份改到abort前，两参数仍要求原42、实际TCP退出/原backend0、未提前结算/归还及独立checkout持续健康。没有改变生产1秒控制期限。693自然失败的历史根因仍未直接复现，保持未验证，不把受控同类机制冒充自然同因。
- [x] 同席1001限定C0/I0/M0；首lint单个no-this-alias保留996，等994终态后只改exact Client Set。最终类型/三路径strictlint/当前tracked路径空白native0后1003冻结62输入/36路径，1004一次完整相关回归36文件232PASS/0FAIL/0skip/native0/412.95秒；只观察原91351句柄，运行中输入未改。
- [x] 最终1005专库READ ONLY有限公共样本保持、隔离schema/其他non-idle0；1007有限核验/1008保存回读及五处统一口径，旧证据保留。本合同不替代源码准入、正式构建/NFT、云端和Yjs后续；Pear按用户取消，不复活；overall goal保持active。任何有限核验失败必须撤销本项完成口径。

Task6限定收口见1006报告；1009只读准入差异整理为24tracked+39untracked、相对373只新增store/connection/listener三路径，原60路径SHA保持；不是63个功能故障，也不是准入批准。后续集中源码准入与构建，不继续把已闭合的连接边界拆成重复任务。693自然根因与自然提交网络故障未直接模拟保持单独未验证，不冒整体WS完成。

加速边界：一次限定修复批次，不重复已闭listener/整体1–6，不扩大连接池/重连/心跳期限，不重复开审查席、安装、提交、部署或付费调用。

## Task 7：当前候选源码准入与构建集中门禁

本批不再增补已闭生命周期分支。1009已确认原60未准入路径SHA与373一致，当前只多store、connection、listener三个路径；源码审查和准入批准必须分开。先复用唯一Schrodinger席，对这三个完整模块及其宿主接缝做路径风险审查，同时由主控取得最新程序构建实证。原63保护BLOCK仍为未准入，任何审查通过不自动改白名单或获得提交/发布许可。

**Files:** 只追加本计划/五处当前记录及新编号诊断证据；不改生产源码、依赖、迁移、六human SDD或保护清单。新诊断脚本从501/504/516机械复制，仅替换本批manifest/result文件名并规范CRLF/末尾空白，复用581私有目录guard与515真实Next子进程。复制与依赖操作均只落独占 `_tmp_e2e/wujie-stage7-current-build-*`，不建立Git worktree、不安装、不竞争原.next。

**Interfaces/commands:**

```powershell
node output/playwright/semantic-target-source-20261004/stage7-postfix-current-source-1010.mjs snapshot --after-probe-fix
# 1011 manifest给出独占directory及已有physical dependencySource。
# 校验source/target均在指定_tmp_e2e且node_modules非共享junction后，robocopy /E /COPY:DAT /DCOPY:DAT /R:0 /W:0 /XJ。
node output/playwright/semantic-target-source-20261004/stage7-postfix-current-source-1010.mjs verify --after-probe-fix
node output/playwright/semantic-target-source-20261004/stage7-postfix-build-runner-1013.mjs --after-probe-fix
$taskCopy=(Get-Content output/playwright/semantic-target-source-20261004/stage7-postfix-build-snapshot-1011.json -Raw | ConvertFrom-Json).directory
node scripts/audit-build-traces.mjs --project-root $taskCopy --strict
# 在1011独占directory，用WUJIE_VERIFY_CURRENT_BUILD_TRACE=1执行以下两实际产物规格。
node node_modules/vitest/vitest.mjs run src/__tests__/scripts/audit-build-traces.test.ts src/__tests__/scripts/build-completion-marker.test.ts --no-file-parallelism --reporter=dot
node output/playwright/semantic-target-source-20261004/stage7-postfix-real-next-runner-1017.mjs --after-probe-fix
```

`$taskCopy`只从保存并校验的1011 manifest读取，禁止手编路径、复用578旧产物或将unverified标记冒成正式Git exact-tree。构建runner只保留系统必需环境变量，DB/API密钥/Python/pip不继承；581 guard仍只覆盖明确三类回退根和所列FS接口，不是全文件系统沙箱。任何后台句柄live只观察原句柄，不因观察超时重启。

- [x] 先核对1003冻结62输入及1007/1008最终记录、refs/index/原服务和旧.next；三个旧诊断原脚本/guard/子进程哈希留证，生成新编号机械副本并验证逻辑相同，不覆写旧证据。已有579物理依赖只复用复制来源，不把旧构建当当前源码结果。
- [x] 建立新源码快照，逐SHA核对当前Git可见输入与物理副本、无密钥/数据/.git/旧.next，原package/lock身份保持；复制依赖失败立即终止后继，不安装补救或扩大环境。
- [x] 当前candidate执行真实clear→next→prune→seal四步骤，观察原生终态；失败先保留证据并做根因诊断，不以旧581成功覆盖。通过后执行严格NFT及两套实际产物规格，分别记录wide/config/rootDocs，严格NFT不等于包体/内存预算通过。
- [x] 最新产物运行真实Next无DB烟测：200首页、同源缺票401/异源403、幂等close、端口重新绑定、自然exit0且watchdog=false。此边界不证明成功101、真实账号/业务/Coze或OS信号。
- [x] 对store/connection/listener完整模块做同席只读路径风险审查及当前证据映射，不重跑232无变化矩阵；仍未验合同和其他60准入路径各自保留。三路径审查不自动准入、不得扩白名单隐藏BLOCK。
- [x] 构建/烟测终态后1019再次验证3653物理源码输入、随后62运行输入和63路径SHA，均无漂移；之后才更新五处同口径与Obsidian，保留全部旧失败。本项只记录已观察的输入保持和记录更新；最终有限审计结果须以1023/1024实测为准，不由复选框替代。目标保持active，正式Git来源、全部63源码准入、全平台/云端门禁仍开放。

自检：本批仅将既有诊断流程用于Task5/6后的最新源码，不重做旧构建或旧WS规格来冒完成。三个机械副本不新增行为；若审查或实际执行暴露具体新缺陷，才启用systematic-debugging/TDD修复，不泛化添加测试出口或新任务状态机。

本批已取得当前候选四阶段构建0、严格NFT0（235路由/230529引用/67wide/config/rootDocs0）、两套实际产物2文件15PASS、真实Next无DB200/401/403/幂等关闭/端口重绑定/自然exit0（watchdog=false）。详细限制及全部警告见1022；3653快照验证在本计划/当前记录编辑之前完成，因此最终只允许这些明确文档变化，62运行输入不能漂移。

同席完整三模块风险审查C0/I0/M1，M1为store缓存清理注释不一致并延期；不改行为或伪写M0。为并行利用本次构建等待，已在同席追加不同的14路径P1鉴权/发布只读风险组，尚未返回部分不计审查通过；不扩白名单，不新增编辑者。原63未准入与剩余合同保持开放。

当前启动钩子仍后台尝试pip安装SVG依赖，本次无pip失败、没有成功安装；无DB工作器drain/Yjs重复导入/localstorage警告都保留。这些部署边界另行定位，不靠补装/重跑已闭连接矩阵掩盖。本轮无DB测试/SQL，新有限审计不能借旧1005样本冒当前DB核验。

后续1025–1046风险修补记录：上述14路径审查已返回C0/I2/M0；两项历史报价/Token计费风险经私有真实RED、最小生产修补和限定复审关闭。另修正回归测试的跨schema目录查询，最终九文件111PASS/零skip/native0，76输入冻结保持；詳1044及1045/1046。它们是源码准入发现的风险，不新增listener功能Task、不重开已闭连接矩阵。1014/1018构建烟测现在属于计费修补前的历史候选，不能证明修补后的完整构建；本批真实DB测试仅在明确专库隔离schema，1041为当前有限只读核验。17/63完整风险读取、余46及63准入/正式来源/全平台/云端仍开放；原store注释M1延期。五处当前口径已经更新，先集中剩余风险再统一构建，目标active。

后续1047–1062集中风险修补：主控22与同席24完整读取返回后，63路径风险阅读覆盖完成，但同席C1/I6/M1未关闭、批准仍0。Vision登录/失败退款与payment保存false三项具体缺陷先真实RED→最小修补，83输入冻结后四文件23PASS/零skip/native0、严格lint/类型检查0、同席限定各C0/I0/M0；详1060/1061/1062。首要下一风险是Vision直接读取非公开文件，随后批量资源生命周期、持久化与输入校验，再统一新候选构建。不是新listener Task，不重跑无变更232/111矩阵，不借旧1014/1018构建冒当前通过。

后续1064–1074：上述Vision私有读取C1已通过实际文件RED、真实PG收费前拒绝控件、最小共享规则与限定复审关闭；91输入冻结后七文件88PASS/零skip/native0，lint/tsc0。其余I6/M1仍OPEN，不是新listener功能Task或全第七项通过。下一优先子进程超时/退出/EPIPE及输入边界，后结果持久化/校验，再统一新构建；详1073/1074，63BLOCK/批准0保持，已闭阶段不重跑。

后续1076–1093：Upscayl提前結算/管道错误两原I与测试observer复审I1均有真实RED和最小修补闭合，最终107输入冻结后八文件73PASS/零skip/native0，最新strictlint/非增量tsc0及限定复审C0/I0/M0。不是新listener功能Task，也不是全第七项关闭；原剩余I4/M1开放、63BLOCK/批准0保持。下一HTTP输入下载时限/大小与取消，再持久化/几何校验；详1086/1092/1093。保持已闭阶段不重跑、后续统一新构建。

后续1095–1106：HTTP输入实际无限等待/超限积累及错误连接经真RED和最小单模块修补闭合；配置NaN复审I1也经1100真RED收口，1105新增C0/I0/M0。最终1101九文件80PASS/零skip/native0，最新strictlint/非增量tsc0，1103当前108输入有限身份，1104仍63BLOCK/批准0。原剩余重要风险三项（removeBG文件身份/workflow旧落盘清理/annotation几何）及本地map Minor保持OPEN；store注释Minor另延期。下一集中这三项再统一最新构建/正确预览，不是全第七项关闭或新的listener任务；详1105/1106，goal active。

后续1108–1140：三个重要风险本批经真RED/最小修补及1139限定复审闭合。复审I3与后续错误引用I1都保留原结论并真RED后修，最终新增C0/I0/M0；1128八文件99PASS、1135七控件PASS、strictlint/最新1137非增量TSC0。115输入最终见1141，1138专库有限READ ONLY/schema0；1122仍63BLOCK/批准0，allowlist不扩。当前仍WebSocket前置，不重跑已闭阶段，不关全第七项。下一本地绝对路径map合法/私有双控件后统一新构建/正确预览；store注释另延期，详1140，goal active。

后续1142–1157：Windows绝对路径map原Minor经真11RED→20GREEN及1147限定C0/I0/M0闭合，1146五文件66PASS，lint/tsc0（空stdout/noTee）。最新3659文件物理副本四步构建0、严格NFT0（67宽仍保留）、实际产物14PASS、真实Next无DB200/401/403及close/端口重绑定/自然退出0；1156构建后原源码/副本逐SHA0mismatch，116输入及八守护/原服务/refs/index/.next保持。本轮无SQL/安装/付费/Coze写入；1155仍63BLOCK/批准0，不扩大allowlist。下一模块批量源码准入→一次集成全量回归→正式Git/正确Coze成功101、多实例、重启与发布门禁；停止无变化单点矩阵，不关完整第七项。store注释另延期，顺序冻结、Pear移出/PSD保留，goal active，详1157。
