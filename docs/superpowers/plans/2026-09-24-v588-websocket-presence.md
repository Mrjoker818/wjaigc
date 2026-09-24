# V588 WebSocket 在线状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有项目权限之上交付真实同源 WebSocket 在线状态，并为 Yjs 留下独立的成员授权边界。

**Architecture:** 默认关闭时保留当前 Next 启动路径；开启时由同源 Node 入口将普通 HTTP 交给 Next，仅将精确在线状态路径交给 `ws`。Next API 签发一次性票据，PostgreSQL 成员/票据/租约是权限与在线状态权威，WebSocket 只广播在线事件，不传画布内容。

**Tech Stack:** Next.js 16.2.11、React 19、TypeScript、`ws` 8.21.1、PostgreSQL、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-24-v588-websocket-presence-design.md`

## Global Constraints

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
- Produces: `resolvePresenceEnabled(value: string | undefined): boolean`、`isPresenceUpgradePath(pathname: string): boolean`、`startPresenceServer({ port, dev, onUpgrade })`；`onUpgrade(req, socket, head)` 只收到精确 `/api/collaboration/presence`。
- Task 5 注入真实 gateway；默认关闭不进入本启动入口。

- [ ] **Step 1: 写失败测试。** 断言默认 `coze-start.sh` 仍执行 Next，只有精确开关 `true` 才执行 presence server；非目标 upgrade 不进入回调，普通 HTTP 返回原 Next 页面、`/_next/static` 和健康端点可用。

```ts
expect(resolvePresenceEnabled(undefined)).toBe(false);
expect(resolvePresenceEnabled('true')).toBe(true);
expect(isPresenceUpgradePath('/api/collaboration/presence')).toBe(true);
expect(isPresenceUpgradePath('/api/collaboration/presence/other')).toBe(false);
```

- [ ] **Step 2: 运行 RED。** `pnpm exec vitest run src/__tests__/scripts/presence-server-contract.test.ts --reporter=dot`，应因入口/导出缺失失败。
- [ ] **Step 3: 最小 GREEN。** `createServer(nextHandler)` 后仅精确路径调用 `onUpgrade`；拒绝其他 upgrade；`pnpm start` 保持原样，新增 `start:presence`/`dev:presence`，Coze 启动仅在开关 true 时选新入口。将已安装的 `tsx` 从开发依赖移到生产依赖并同步锁文件，启动用 `./node_modules/.bin/tsx scripts/presence-server.ts`；不得清理 `.next` 或修改构建标记逻辑。

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
