# V5.8.8 WebSocket 在线状态：Task 7 本地门禁证据

> 状态：本地保护基线、全量 Vitest、类型/Lint 与生产构建通过；严格 NFT 审计失败。浏览器完整矩阵、Coze 同源 `101`、GitHub CI 与正式发布均未验证。本文只记录受控测试环境，不包含账号密码、票据、Cookie 或业务数据。

## 候选范围与边界

- 当前受验源码：本地 `main@a593d7395a2be6d4c58a0315734c543f3ea27aa1`，尚未推送至 `origin/main@773545781787a317f295a995837c31c3a8e8a642`。
- `origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未改；六份用户 `.superpowers/sdd` 工作树修改未纳入本阶段。
- 默认 `WUJIE_PRESENCE_ENABLED` 关闭；本地受控测试才启用真实同源 WebSocket。匿名只读分享不授予项目在线房间资格；在线状态不承载画布内容或 Yjs 文档。
- 受验构建的 `.next/BUILD_ID` 与 `.next/WUJIE_BUILD_COMPLETE` 均为 `unverified-640bfba5ba475de1bb2ccd68c5d3cbe0`。原因是工作树含既有用户修改，不能把此标记解释为干净 exact-tree 云端身份。

## 2026-09-24 本地验证

| 门禁 | 实际结果 | 结论 |
| --- | --- | --- |
| `pnpm check:protected-baseline` | 初次 16 条精确源码路径阻断；只登记这 16 条后，38 个基线功能标识保留、无未授权漂移、0 警告，exit 0 | 本地通过；授权文件本次提交 |
| 隔离 PostgreSQL 全量 `pnpm exec vitest run --testTimeout 30000 --reporter=dot --silent` | 专用 localhost 测试库；850 文件、7294 测试通过，0 失败，exit 0 | 本地通过，不代替生产库验收 |
| `pnpm validate` | TypeScript 生成与检查、ESLint `--quiet`，exit 0 | 本地通过 |
| `pnpm build` | Next.js 16.2.11 构建 exit 0；静态页面 121/121；清理 239 份 trace、20810 条本地 artifact 引用 | 本地构建通过，不等于可发布 |
| `node scripts/audit-build-traces.mjs --strict` | 227 条 API 路由、965157 条累计文件引用、215 条宽追踪；exit 1 | **发布门禁阻断** |
| 本地三浏览器 presence 用例 | 两账号、邀请/撤销、在线人数、真实 socket 和 320px；Chromium/Firefox/WebKit 3/3 | 受控范围通过，不覆盖完整 Task 7 矩阵 |

## 尚未关闭

1. 严格 NFT 审计仍失败：不能以构建 exit 0、局部追踪收敛或清理脚本输出代替全站打包稳定性证明。
2. Task 7 完整浏览器矩阵仍缺两项目切换、320/375/393px 全组合、掉线恢复、匿名分享隔离、HTTP 兼容及 Trace/Console/Network 证据。
3. Coze `HEAD^{tree}`、Build ID、完成标记、唯一 5000 进程、同源 `101`、成员重连/撤销及多实例重启失效未对当前候选验证；目前不推送、不部署。
4. GitHub Actions 外部门禁、真实付费取消与唯一退款、Pear 延期项、Yjs、手绘草图转代码和全平台正式发布仍分别开放，不随在线状态局部通过而关闭。

下一步应先继续收敛严格 NFT 的共享动态文件追踪边界，保留真实读写与持久化行为；随后补完整浏览器矩阵，并在门禁满足时做 Coze exact-main 验收。若 Coze 代理无法透传同源 upgrade，按规格 fail-stop，不能以 SSE/轮询替代 WebSocket 完成。

## 2026-09-25 两项目刷新恢复与管理员缓存补证

- 本地候选仍从 `main@a9a61983` 开始，未推送。测试先在旧实现的 Chromium、Firefox、WebKit 上稳定复现：自定义管理员名称下，A→B→A 后刷新，画布项目 ID 变空；服务端刷新前已有 A/B，浏览器随后把项目同步覆盖成默认演示数据。根因是客户端只按默认管理员名称查找，误插入同一固定 ID 的管理员并覆盖缓存项目。
- 新增 4 项边界用例，分别覆盖自定义管理员项目保留、同名普通用户不被提权、仅缺用户列表时保留已有项目、重复管理员固定 ID 合并；逐项先见 RED，再最小修复。该文件最终 5/5 通过。独立只读复审对这些边界及第二项目客户端恢复未发现剩余 Important/Critical；复审本身未运行测试。
- 最终浏览器用例在新建 localhost PostgreSQL 测试库应用 29 项迁移后运行：Chromium、Firefox、WebKit **3/3**，各自验证两账号邀请/撤销、A/B 切换与房间隔离、无权用户对 B 的票据 403、A/B 服务端保存、刷新后客户端实际重新打开两个项目、断开重连，以及 320/375/393px 弹窗边界；页面异常 0。该证据只覆盖受控本地矩阵，不能外推到 Coze 代理或真实多实例云端。
- 最终 `pnpm validate` exit 0；`pnpm build` exit 0、静态页 121/121、239 份 trace 清理 20831 条本地引用；隔离真库全量 Vitest **850 文件/7298 项通过、0 失败、exit 0**。当前两份构建身份均为 `unverified-0f7dd98ed46e0bbf344dde2dda25da54`，因六份既有用户文档脏改，不能当作干净 exact-tree 身份。
- 严格 NFT 审计仍 **exit 1：227 路由、965371 累计引用、215 条宽追踪**。Coze exact-main 同源 `101`、云端成员撤销/重连、GitHub Actions、真实付费取消唯一退款和正式部署仍未验收；不推送、不部署，也不把本次本地 3/3 算作 Task 7 总闭环。
