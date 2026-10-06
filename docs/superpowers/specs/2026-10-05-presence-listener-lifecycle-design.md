# WebSocket 共享数据库监听生命周期设计

## 依据、范围与状态

本设计服务于整体第七项的WebSocket前置，不新增Yjs能力。沿用2026-10-05第七项顺序约束，Pear移出、PSD核心保留。用户已授权后续按最优方案执行，无需逐步确认；仍不得以该授权绕过源码保护、云端身份或发布门禁。

设计建立时生产代码尚未采用本设计，依据为922/924/925诊断。现已实现共享owner及subscribe/Room/gateway接入候选：原持锁退出、survivor、跨gateway、真实LISTEN失败重连和unsubscribe失败排空控件通过；完整965为修补错误快照前的220PASS，不能替代最终候选。967复现新retain清空旧pending close错误，最小快照修补后968 owner九项通过，同席限定C0/I0/M0后969再冻结；970最终34文件220PASS/零skip/native0，最终非增量tsc及七路径strictlint native0，记录见973报告/974有限审计。925/924原失败保留；8秒是当时观察预算，不称永久等待已证明。本设计不关闭完整WS、网络故障、发布或云端门禁。

实际受控故障：在同一个真实listener checkout上，先排队被独立advisory lock阻塞的原生SQL，再排队原生LISTEN。未替换SQL结果、未使用假计时器；这不是LISTEN命令本身取得advisory lock。客户真实open、lease已提交、完整backend身份和实际TCP均被观察。

## 修前根因（历史依据）

`presence-leases.ts`的subscribePresence先登记callback/timer，再等待ensureListener。ensureListener等待getPool.connect和LISTEN完成，直到完成后才发布可关闭的listener。`presence-gateway.ts`的joinRoom等待ready后才取得release回调。这样已经取得的共享checkout、注册的callback/timer和等待ready的房间之间没有一条可在初始化中途关闭的完整所有权链。

当前unsubscribe只调用client.release(true)，不等待实际transport结束。普通关闭单次PASS不能消除924观察到的竞态。

## 方案比较及选定方案

| 方案 | 影响 | 结论 |
|---|---|---|
| 进程共享listener epoch，订阅有独立token，最后token回收epoch | 保留一个共享LISTEN连接；可拥有初始化、断连、退休、重连的完整生命周期 | 采用 |
| 每Room单独建立listener | 放大连接占用，改变现有共享语义，可能耗尽max5业务池 | 不采用 |
| 只给现有LISTEN加Promise.race/超时返回 | 原生SQL和迟到checkout仍存在，可能假称关闭或隐藏错误 | 不采用 |

## 资源边界和接口

新增`src/lib/collaboration/presence-listener.ts`，只管理进程共享LISTEN连接，不管理租约、票据、文档、用户或积分。`presence-leases.ts`继续管理project→callback集合和reconcile timer，转发实际数据库通知。

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

retain同步返回token，必须先拥有释放入口再开始等待连接。每个token只关闭自己的订阅；首Room不拥有整个共享连接。无token时退休当前epoch；仍有token时不得取消其连接或正在初始化的LISTEN。

外部兼容接口仅追加可选第四参数：

```ts
export async function subscribePresence(
  projectId: string,
  onChange: () => void | Promise<void>,
  reconcileIntervalMs = 15_000,
  signal?: AbortSignal,
): Promise<() => Promise<void>>;
```

旧三参数调用保持可用及reconcile降级，不另造任务状态机。现代Room传入自己的controller.signal。signal中途取消时，该订阅从callback集合移除、timer停止并拥有token.close；若最后订阅退出，调用方须等待epoch的真实退休，不能只返回取消异常。若仍有其他订阅，则取消自己的ready等待，但不能等待整个共享连接寿命结束。

## Epoch及取消规则

1. epoch不可变身份，状态依序为acquiring→listening→retiring→closed。同一epoch有controller、ready和completion三个独立归属；ready表示初始化尝试终态，不等于连接全寿命终态。
2. acquired checkout通过现有withPresenceConnection持有完整backend身份及取消回收。operation需保持至监听停止，不能在LISTEN完成后提前释放checkout。
3. 最后token退出时停止重连timer、取消该epoch、唤醒operation的监听停止等待，并等待completion。操作错误和取消/释放错误都保留；PresenceConnectionCleanupError必须向Room及gateway.close传播。
4. 真实断连只影响该epoch。处理器按epoch身份判断，不允许旧epoch的finally清空新epoch。新连接只能在旧epoch退休后建立，仍有token时按原1000ms重连节奏恢复。
5. 原生pool.connect没有AbortSignal参数。取消不能遗弃它：10,000ms原池连接等待限制保持；若checkout迟到，必须立即销毁并等实际关闭，不派发身份SQL或LISTEN。未跑真实迟到checkout/池耗尽控件前，不能宣称acquisition边界已闭合。
6. 不调用业务pool.end，不降低pool.max，不结束无关健康连接；server SQL退休须验证完整身份，不只根据PID判断。
7. listener正常闲置退出也等待真实transport终态，修复release返回与TCP close之间的竞态。

## Gateway接入

Room controller仍不绑定首客户端。gateway.close先关闭准入，再取消该gateway拥有的Room初始化与刷新，随后等待既有升级/加入/清理所有权。另一个gateway的活跃Room仍拥有独立token，不受影响。

单客户端在初始化期间物理关闭也必须释放其RoomClient引用；若最后成员退出，取消Room的订阅初始化；若还有成员则只取消当前客户端的ready等待。release函数须在await ready之前建立，正常、关闭、失败三个路径复用同一幂等Promise，避免连接尚未取得release入口时遗留Room。

unsubscribe失败不能跳过已开始的refresh排空，需allSettled保留两者错误。本设计不借机重写renew/leave/maintenance或补693；这些保持独立开放项。

## 验收条件

- 持锁pipeline在独立locker仍持锁时，gateway.close真正终态、目标backend不再活动、listener TCP已关闭、提交的租约已正常清理；无关checkout身份/SQL42保持，pool仍可用。
- 首token/首Room/一个gateway关闭，其他订阅继续接收真实PG通知；不重建仍健康的listener。
- 最后token关闭期间的新retain等待旧epoch退休后建立新连接，旧finally/断连事件不能覆盖它。
- 原生pool队列等待后取消、迟到checkout、10,000ms超时，均没有越过取消边界的实际LISTEN，没有遗弃producer或连接。
- 真listener后台被终止后仍按旧合同行为重连；关闭期间不再重连，不残留timer/callback。
- 真实控制连接边界故障保持原错误与实际SQL错误，不能给出成功关闭；测试仅针对已核验具体连接身份处理预期取消错误，其他拒绝均失败。
- 现有leases/WebSocket/room/post-join/server生命周期相关规格全部通过；修后冻结、类型/lint、源码保护、本地构建及云端验收分别留证。

以上未验条件全部保持OPEN；不能用旧204PASS、测试辅助修补或本设计文件关闭整体WebSocket、第七项、merge或发布。
