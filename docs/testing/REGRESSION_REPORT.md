# 回归测试报告

## 2026-07-19 Current local regression: passed, cloud acceptance pending

| Gate | Result |
| --- | --- |
| Source baseline | Code baseline `73ccc02 fix: require authentication for uploads`, plus the locally verified save-image internal-auth migration awaiting its dedicated commit. It includes the selected-image delete stacking repair and eight high-risk API authorization regressions. |
| API suite | Passed: `pnpm test:api` completed 44 files / 100 assertions, including cache-image, upload, and save-image authorization contracts. |
| Full unit/component/API suite | Passed: `pnpm test` exited 0. Local DB fallback messages are expected by the exercised fallback contracts and do not demonstrate production database health. |
| Component and library regression | Passed: `pnpm test:regression` completed with exit code 0. |
| Type safety and lint | Passed: `pnpm ts-check` and `pnpm lint --quiet`. ESLint emitted no errors; Babel noted the oversized `infinite-canvas.tsx` transformation. |
| Production build | Passed: `pnpm build` exited 0 after 141 seconds. Webpack compilation, TypeScript, 97 static pages, and build traces completed. |
| Test-environment limitation | Local regression has no production database configuration. The server-auth fallback tests intentionally emit missing-database logs while exercising their degraded path; this is not cloud database-health evidence. |
| Cloud acceptance | Pending: the preview still served the older selected-image container class (`z-20`) after the reported update. It must synchronize `73ccc02` or later before deletion, recovery, local-service, SVG, video, cache, and upload authorization checks can be closed. |
| Release decision | **Not approved**. P0 upload/download evidence, cloud P1 acceptance, production database/storage/model health, and full multi-browser core E2E remain incomplete. |

### Cloud recheck after reported update

The Chrome cloud preview still returned the old selected-image ancestor class `absolute group z-10 z-20` and stable reproduction again showed `删除` opening the `美陈拆解` dialog. Evidence: `test-results/screenshots/cloud-p1-delete-opens-display-decompose-20260719.png` and `test-results/console/cloud-p1-delete-opens-display-decompose-20260719.json`. Therefore `BUG-20260719-024` remains **open**, and this preview must not be treated as running `04927ee` or later.

## 2026-07-19 Cloud P0 authentication regression: passed

| Check | Result |
| --- | --- |
| Authenticated refresh | Passed: `/api/session` responses were HTTP 200 and the existing Chrome session reached `我的项目`. |
| Anonymous isolation | Passed: logout reached `选择入口`; the anonymous page contained zero `图像生成器` buttons. |
| Login | Passed: the canvas login form accepted Chrome-stored credentials and restored the admin dashboard. |
| Persistence | Passed for this flow: project/asset counters stayed at 15 / 183 across logout and relogin. |
| Admin data | Passed after async completion: users 6, providers 14, templates 12. The corresponding admin APIs returned successful non-empty payloads. |
| Residual | P2 BUG-20260719-023 remains: one caught project-sync fetch error was logged during logout despite successful final state. |

## 2026-07-19 Anonymous entry isolation and Webpack preview regression

| Gate | Result |
| --- | --- |
| Browser E2E | Passed 4/4: Chromium, Firefox, WebKit, and mobile Chromium navigated from `/` to the canvas login form. |
| Anonymous workspace isolation | Passed: the test explicitly verifies that `图像生成器` is absent before authentication. |
| Test reliability | Passed: Playwright global setup warms the server by awaiting `GET /`; no test adds a fixed sleep or suppresses an asynchronous failure. |
| Focused tests | Passed 12/12: auth-session, auth-bootstrap, and preview-build command contracts. |
| Static gates | Passed: `pnpm ts-check` and `pnpm lint --quiet`. |
| Cloud acceptance | Pending: the cloud preview must synchronize the new Webpack dev command and be retested in the existing Chrome session. |

## 2026-07-19 Cloud Next Flight execution blocker

| Check | Result |
| --- | --- |
| Latest source adoption | Passed: the cloud `src_app_page` chunk contains `getInitialProjectId` and no longer imports `next/navigation`. |
| Cloud client startup | Failed P1: six `self.__next_f.push(...)` scripts exist in DOM but `window.__next_f` is undefined; React has no mount markers and `/api/session` is never requested. |
| Local contrast | Passed: the exact source under local `next dev` has an active Flight queue, React mount markers, a dismissed auth shell, and `/api/session` requests. |
| Conclusion | The blocker is the Coze preview script-execution/deployment layer, before application authentication logic. |
| Required acceptance | After cloud remediation, reload in existing Chrome session and require a Flight queue, React mount marker, hidden auth shell, and `/api/session` request before continuing P0 writes. |

## 2026-07-19 First-commit router isolation (pending cloud verification)

| Gate | Result |
| --- | --- |
| Cloud recheck after root-layout isolation | Failed P1: the shell was still visible after nine seconds; all application chunks loaded, but no `/api/session` request was observed. |
| Regression first | The auth contract failed while the page imported `next/navigation`; it passes after removing the unused router hooks and reading `projectId` once from `window.location.search`. |
| Local dev-browser coverage | Passed 4/4 in Chromium, Firefox, WebKit, and mobile Chromium against `next dev`. |
| Full local gates | Passed: targeted 9-test contract, TypeScript, lint, production build (97 routes), and full Vitest. |
| Cloud acceptance | Unverified until this revision is synchronized and a logged-in Chrome reload both requests `/api/session` and removes the auth shell. |

## 2026-07-19 Root-layout hydration isolation (pending cloud verification)

| Gate | Result |
| --- | --- |
| Cloud diagnostic before fix | Failed P1: the deployed shell stayed visible. All client chunks loaded successfully, but the browser issued zero `/api/session` or other application API requests in nine seconds. |
| Regression first | A root-layout contract failed while `src/app/layout.tsx` declared `'use client'`; it passes after the document root is server-rendered and `OperationAuditClient` remains isolated as a client child. |
| Local development E2E | Passed 4/4 in the same `next dev` mode used by the preview: Chromium, Firefox, WebKit, and mobile Chromium reached the login form. |
| Local production gates | Passed: targeted contract (9 tests), TypeScript, lint, optimized build (97 routes), and full Vitest. |
| Cloud acceptance | Pending synchronization of this revision. A signed-in Chrome reload must dismiss the auth shell and issue the expected session request before P0 paid generation can resume. |

Cloud evidence is archived at `test-results/screenshots/cloud-p1-auth-shell-still-visible-after-5ff1845-20260719.png`, `test-results/console/cloud-p1-auth-shell-still-visible-after-5ff1845-20260719.json`, and `test-results/network/cloud-p1-auth-shell-network-after-5ff1845-20260719.json`.

## 2026-07-19 Auth-bootstrap hydration repair (pending cloud verification)

| Gate | Result |
| --- | --- |
| Regression first | A source contract asserting a pre-workspace `authChecked` gate failed before implementation and passes after it. |
| Local production E2E | Passed 4/4: Chromium, Firefox, WebKit, and mobile Chromium all reach the anonymous login form through the real production server. |
| Full test suite | Passed: 130 test files / 528 tests. |
| Build quality gates | Passed: `pnpm ts-check`, `pnpm lint --quiet`, and `pnpm run build` (97 routes). |
| Cloud P1 acceptance | Unverified until the synchronized preview reload proves `data-testid="auth-loading-shell"` disappears in the existing logged-in Chrome session. |

The patch does not increase request timeouts or suppress errors. It limits the initial hydration tree to the authentication shell until the existing session check settles, then mounts the normal workspace. A cloud pass is required before this P1 can be closed or any P0 paid-generation flow resumes.

## 2026-07-18 本地 P0 匿名入口跨浏览器回归

- 环境：本地 Next.js 开发服务器 `http://127.0.0.1:5011`；未注入登录账号、模型密钥、数据库或云端支付配置。
- 执行：`E2E_BASE_URL=http://127.0.0.1:5011 pnpm exec playwright test tests/e2e/p0-login-ui-contract.spec.ts`，Chromium、Firefox、WebKit 与移动 Chromium 串行执行。
- 结果：4/4 通过。匿名访问者可进入首页、选择无限画布入口，并看到用户名和密码登录表单。
- 证据：`test-results/screenshots/20260718-local-p0-login-contract__*`、`test-results/videos/20260718-local-p0-login-contract__*`、`test-results/traces/20260718-local-p0-login-contract__*`，以及更新后的 `playwright-report/`、`test-results/junit.xml`。
- 范围限制：本结果只验证真实浏览器 UI 入口；不证明云端认证、文件上传、模型生成、项目恢复、下载或积分结算。那些项目继续列为未验证。

## 2026-07-18 云端管理数据可观测性回归

- 云端实际管理员会话中，项目/资产仍可从本地状态显示，但供应商、用户和任务统计变为 0；刷新后不恢复。Console 同时记录项目同步 `500/502`，因此此状态不能解释为“没有配置”。
- 修复前，管理页将非 2xx、业务失败和网络异常显示为空列表；修复后显示“供应商配置加载失败”“云端任务记录加载失败”或“发布前自检加载失败”，并提供重试，不再丢弃已知数据。
- `dashboard-admin-load-error-contract.test.ts` 已先红后绿，`pnpm ts-check` 与 `pnpm lint --quiet` 通过。云端后端恢复后，必须用真实管理员会话复验错误提示、配置恢复和任务记录。

## 2026-07-18 构建网络依赖回归

- 修复前，`pnpm build` 因 `next/font/google` 拉取 Geist 字体失败而退出码为 1，错误链为 `fonts.gstatic.com` 请求失败后 Turbopack 内部字体模块无法解析。
- 新增 `root-layout-font-contract.test.ts`，先失败再通过，约束根布局不得重新引入 `next/font/google`。
- 修复后 `pnpm build` 退出码 0，完成 97 个静态页面生成；`pnpm ts-check` 与 `pnpm lint --quiet` 均通过。

## 2026-07-18 云端恢复终态与高频轮询复验

- 历史真实任务 `async-1784362294335-88ydio` 已返回 `completed / 100%` 和生成图片地址；画布重开后保留结果。积分概览新增且仅新增一条 `-6` 的 Lite 消费流水，确认恢复路径没有重复结算。
- 新提交的真实任务 `async-1784381325092-zkypoi` 已产生一条新的 `-6` 流水，但任务监控当前仍为 `processing / 10%`；这不是结果丢失的证据，终态、结果入画布和刷新恢复仍待验证。
- 对该新任务已稳定捕获 SSE 断开时的轮询节流缺陷：至少 79 次 `POST /api/poll-task` 以约 76–269ms 间隔返回 `processing`。登记为 BUG-20260718-013。
- 本地已以先红后绿测试接入 `waitForTaskPollInterval`：`page-task-polling-wiring.test.ts` 与 `task-polling-wait.test.ts` 共 3/3 通过，`pnpm ts-check`、`pnpm lint --quiet` 通过。云端尚未同步本修复，不能据此声称云端已修复。
- 证据：`test-results/screenshots/cloud-p1-recovery-c7ee167-completed-20260718.png`、`test-results/screenshots/cloud-p1-new-task-processing-20260718.png`、`test-results/screenshots/cloud-p1-generation-polling-busy-loop-20260718.png` 及同名 network/console JSON。

## 2026-07-18 `f9a2835` 云端恢复复验

- 云端 Chrome 已登录会话重新打开最新项目后，`/api/tasks/recover` 返回历史任务 `async-1784362294335-88ydio`，首次 `/api/poll-task` 返回业务成功 `processing / 10%`，证明 BUG-20260718-010 与 BUG-20260718-011 的恢复匹配和供应商重新提交路径已生效。
- 随后页面保持 `processing 10%`，网络未再出现 `/api/poll-task`。已稳定定位为恢复 effect 被自身 `images` 进度更新清理；登记为 BUG-20260718-012。
- 证据：`test-results/screenshots/cloud-p1-recovery-f9-processing-stall-20260718.png`、`test-results/network/cloud-p1-recovery-f9-network-20260718.json`、`test-results/console/cloud-p1-recovery-f9-processing-stall-20260718.json`。

## 2026-07-18 `c7ee167` 云端恢复复验

- 同一已扣费历史任务重新打开后，页面从持久化的 `processing 10%` 继续轮询，并连续产生 3 次 `/api/poll-task` 请求，证明 BUG-20260718-012 的轮询生命周期修复已在云端生效。
- 三次请求都返回 `502 {"detail":"无法连接到后端服务"}`；页面正确保留任务，不伪造成功或失败结果。该云端后端连通性阻塞使任务终态、结果保存和积分补偿无法验证。
- 证据：`test-results/screenshots/cloud-p1-recovery-c7ee167-gateway-502-20260718.png`、`test-results/network/cloud-p1-recovery-c7ee167-gateway-502-20260718.json`、`test-results/console/cloud-p1-recovery-c7ee167-gateway-502-20260718.json`。

## 2026-07-18 重开画布任务恢复回归

- 云端复现表明：重新打开项目后，真实待处理占位框保持 `submitting 5%`，且没有 `/api/poll-task` 请求。
- 修复会在提交时持久化任务 ID 和项目 ID；旧任务仅在提示词和规范化模型精确唯一匹配时恢复，避免误绑其他任务。
- 本地验证：目标恢复套件 24/24、全量 121 文件 / 504 用例、`pnpm lint --quiet`、`pnpm ts-check`、`pnpm build` 均通过。
- 在云端将 `async-1784362294335-88ydio` 恢复为终态并完成新付费任务、刷新恢复前，此项仍为 P1 未关闭。

## 2026-07-18 submitOnly 恢复与计费云端复现

- 云端真实任务 `async-1784362294335-88ydio` 成功创建，但连续轮询返回业务错误 `400`，UI 停在 `submitting 5%`；这次结果为失败证据，不计为生成或计费通过。
- 根因已由持久化数据流定位：外层记录被保存为默认 `generate`，恢复代码因类型不匹配跳过重新提交，误将本地包装 ID 轮询给供应商。
- 本地先红后绿回归 17/17、`pnpm ts-check` 通过。此次变更尚未云端验证，因此 P1 与发布结论均未关闭。

## 2026-07-18 新建用户画布登录回归

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 云端预览、管理员已登录会话 | 管理员“添加用户”创建启用的普通用户；以无限画布入口提交用户名、密码与 `productType=canvas` | 失败，稳定返回 `401`；同一凭据在不传产品入口时返回 `200`，确认不是用户名或密码错误 | `cloud-e2e-account-created-20260718.png`、`p0-auth-session-{chromium,firefox,webkit,mobile-chromium}.json`、Playwright trace/video |
| 本地隔离存储 | `createManagedUser` 后以 `productType=canvas` 调用 `authenticateUser` | 修复前返回 `null`；修复后通过，返回普通用户及 `productType: canvas,chat` | `pnpm exec vitest run src/__tests__/lib/server-auth-production-security.test.ts`，4/4 通过 |

云端结论仍为未验证：修复仅影响部署后的新建用户，必须在云端同步后创建新的隔离测试用户，并运行四浏览器真实登录/刷新/退出回归。现有测试账号在修复部署前创建，不能用于证明默认权限已生效。

## 2026-07-18 普通用户会话 Console 回归

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 云端预览、修复后新建的普通用户 | Chromium、Firefox、WebKit 与移动 Chromium 执行登录 → 刷新 → 退出 | 身份链路均成功；Firefox 全通过。Chromium、WebKit 和移动 Chromium因两次 `POST /api/admin/user-folder` 返回 401 而被 Console 门禁阻断 | `test-results/console/p0-auth-session-*.json`、`test-results/network/p0-auth-session-*.json`、`.playwright-output/` 中的截图、录像和 Trace |
| 本地隔离测试 | 普通用户调用 `UserManager.upsertUserFromServer` | 修复前访问管理员端点；修复后仅访问 `/api/user-data/sync?key=projects` | `pnpm exec vitest run src/__tests__/lib/user-manager-admin-folder.test.ts`，1/1 通过 |

云端同步此修复后，复用当前隔离账号重新执行四浏览器 `p0-auth-session`；只有四项目均无 Console error 后，才能关闭 BUG-20260718-006。

## 2026-07-18 云端 Chrome 已登录会话 P0 实测

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`，Chrome 已登录管理员会话 | 新建隔离项目，不触碰既有 6 个项目 | 通过：创建后仪表盘显示 7 个项目 | `cloud-p0-canvas-entry-20260718.png` |
| 同上 | 选择 `豆包5.0Lite`（`api_1778430731224_533e09a::doubao-seedream-5-0-lite`），比例 `1:1`，数量 `x1`，提交最小提示词 | 通过：任务经过 `submitting 5%` 后返回真实图片；画布标注 `APImart imgae`、`2048 × 2048` | `cloud-p0-before-generate-20260718.png`、`cloud-p0-task-state-20260718.png` |
| 同上 | 画布缩放 | 通过：`100%` 变为 `120%` | Chrome DOM 记录 |
| 同上 | 刷新、从仪表盘重新打开最新项目 | 通过：项目中保留 1 张生成图；资产数由 174 增至 175 | `cloud-p0-before-reload-20260718.png` |
| 同上 | 选中图片后键盘 `Delete` | 通过：图片计数由 1 变为 0 | Chrome DOM 记录 |
| 同上 | 上传、鼠标拖动、节点工具栏点击下载 | 未验证为业务通过：Chrome 扩展拒绝 `filechooser.setFiles`；拖动未改变 DOM 几何；下载点击未产生扩展可观察到的 download event。均已归档，不能用作产品失败或通过结论。 | `cloud-p0-upload-filechooser-blocked-20260718.png`、`cloud-p0-node-move-20260718.png`、`cloud-p0-download-state-20260718.png` |
| 同上 | 匿名 `POST /api/workflow/execute`（`action=status`） | 通过：返回 `401 {"error":"Authentication required"}`，认证在业务查询前被拒绝 | 终端 HTTP 探针，2026-07-18，部署后复验 |
| 同上 | 已登录会话退出登录 | 通过：执行退出后进入“选择入口”，页面显示“请联系管理员创建新账户并授权对应功能”；归档 Console 未见 `/api/activity` 或 401 | `cloud-p0-logout-20260718.png`、`cloud-p0-logout-20260718.json` |

## 2026-07-18 云端 Chrome 第二轮 P0 实测

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 当前预览地址，Chrome 已登录管理员会话 | 新建第 8 个隔离项目并刷新会话 | 通过：刷新后仍为管理员会话；项目数由 7 变为 8 | `cloud-p0-logged-in-project-20260718.png`、Chrome DOM |
| 同上 | 底部“图片上传”→文件选择器写入 PNG | 未验证为业务失败：控制层返回 `Not allowed`，不能据此判断产品上传入口异常 | `cloud-p0-upload-filechooser-not-allowed-20260718.png`、`cloud-p0-upload-filechooser-not-allowed-20260718.json` |
| 同上 | 剪贴板粘贴 1×1 与 256×256 无敏感 PNG | 通过：图片实际保存到画布；项目资产数最终由 175 增至 178 | `cloud-p0-paste-result-20260718.png`、刷新后 DOM 图片尺寸 |
| 同上 | 选中 256×256 图片、拖动、缩小画布 | 通过：矩形从 `(704,175.5)` 移至 `(774,225.5)`；画布比例从 `200%` 变为 `167%` | Chrome DOM 记录 |
| 同上 | 选中 1×1 图片后键盘 `Delete` | 即时 UI 通过但持久化不通过：DOM 图片数 1→0；后续异步操作后图片重新出现并在刷新后保留 | BUG-20260718-004，`cloud-p0-generation-submitted-20260718.png`、`cloud-p0-project-restored-20260718.png` |
| 同上 | `豆包5.0Lite`，`1:1`、`x1`、最小中文提示词真实生成 | 通过：任务显示 `submitting 5%`，完成后回到画布，结果标注 `doubao-seedream-5-0-lite / APImart imgae / 2048×2048` | `cloud-p0-before-real-generation-20260718.png`、`cloud-p0-generation-submitted-20260718.png`、`cloud-p0-generation-after-wait-20260718.png` |
| 同上 | 刷新后从“刚刚”创建的隔离项目重新打开 | 部分通过：三张图片均恢复，真实生成结果已持久化；同时证实已删除节点回流 | `cloud-p0-project-restored-20260718.png` |
| 同上 | 选择生成结果并点击“下载” | 未验证：按钮被真实点击，但 Chrome 控制层未给出 download event，不能作为下载通过或失败 | Chrome DOM，控制层 download event 为 `not-observed` |
| 同上 | 账户菜单退出登录 | 通过：回到“选择入口”；Console 无 `/api/activity` 或 401，但仍有 `DashboardView` key 警告 | `cloud-p0-real-logout-20260718.png`、`cloud-p0-real-logout-20260718.json` |

## 2026-07-18 删除状态第二次隔离复现

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 当前预览地址，Chrome 已登录管理员会话 | 新建第 9 个隔离项目；粘贴 32×32 PNG 后按 `Delete` | 通过：删除后画布无该图片 | Chrome DOM；后续复核图片清单 |
| 同上 | 粘贴 256×256 PNG，选择 `豆包5.0Lite`、`1:1`、`x1` 后发起真实生成 | 通过：任务完成后仅有 256×256 上传图和 2048×2048 生成图 | `cloud-delete-repro-before-reload-20260718.png` |
| 同上 | 返回项目列表并重新打开显示“2 张图片”的刚创建项目 | 未复现删除回流：DOM 仅包含 256×256 上传图与 2048×2048 生成图；32×32 已删除图未出现 | `cloud-delete-repro-after-reopen-20260718.png`、`cloud-delete-repro-after-reopen-20260718.json` |

## 2026-07-18 原生上传与下载控制通道复验

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 当前预览地址，Chrome 已登录管理员会话 | 底部“图片上传”选择无敏感 48×32 PNG | 未验证为产品失败：按钮已触发原生选择链路，但控制通道在 `fileChooser.setFiles` 阶段返回 `Not allowed`，尚未到达上传业务请求 | `cloud-p0-native-upload-not-allowed-20260718.png`、`cloud-p0-native-upload-not-allowed-20260718.json` |
| 同上 | 选中真实生成结果，展开图片工具栏并点击“下载” | 未验证为产品失败：下载按钮真实点击后，控制通道 10 秒内没有收到 `download` 事件；不能把“未观察到事件”推导为下载未执行 | `cloud-p0-download-event-not-observed-20260718.png`、`cloud-p0-download-event-not-observed-20260718.json` |

## 2026-07-18 已登录会话刷新与项目恢复复验

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 当前预览地址，Chrome 已登录管理员会话 | 刷新页面并等待身份校验完成 | 通过：回到管理员仪表盘，显示 `Mr.joker / 管理员`、9 个项目和 180 张图片 | `cloud-p0-session-refresh-project-restore-20260718.png`、`cloud-p0-session-refresh-project-restore-20260718.json` |
| 同上 | 打开刚创建且显示“2 张图片”的隔离项目 | 通过：恢复 256×256 上传图与 2048×2048 真实生成图 | `cloud-p0-session-refresh-project-restore-20260718.png`、`cloud-p0-session-refresh-project-restore-20260718.json` |

## 执行记录

| 时间 | Git Commit | 版本 | 地址 | 浏览器 | 套件 | 结果 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 待执行 | `da4c37e` | `2.5.0` | 待提供 `E2E_BASE_URL` | 待执行 | P0真实用户链路 | 未验证 | `test-results/` 待生成 |
| 2026-07-17 | `da4c37e` | `2.5.0` | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/` | Chrome（既有登录会话） | 预览页加载、画布/生成表单可见性、医生远程可达性 | 部分通过 | Chrome DOM证据显示画布、上传入口、图像模型、提示词和生成按钮存在；上传自动化超时，未声称上传或生成通过 |
| 2026-07-17 | `da4c37e` | `2.5.0` | 默认本地地址（未实际导航） | Chromium/Firefox/WebKit/移动 Chromium | `pnpm test:e2e:p0` | 阻塞，4/4失败 | `playwright-report/index.html`、`test-results/junit.xml`、`test-results/screenshots/`、`test-results/videos/`、`test-results/traces/`；失败原因为缺少真实测试环境变量，未将其算作业务失败或通过 |
| 2026-07-17 | 本地未提交修复 | `2.5.0` | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/` | HTTP 匿名请求 | 工作流执行授权 | 失败（云端未部署修复） | 匿名 `POST /api/workflow/execute` 返回 `400 {"error":"缺少 executionId"}`，预期应为 401；请求无用户凭据且未创建任务 |
| 2026-07-17 | 本地未提交测试改进 | `2.5.0` | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/` | Chromium/Firefox/WebKit/移动 Chromium | P0-AUTH-ENTRY-001 匿名登录入口 | 通过，4/4 | 以单 worker 顺序执行。四个浏览器均完成“选择入口→无限画布→登录表单”；截图、视频、Trace、Console、Network 和 JUnit 已归档。首轮并发下 Chromium 的失败证据保留为隔离风险，未登记为稳定产品 Bug |
| 2026-07-17 | 本地未提交修复 | `2.5.0` | 本地源码 | 操作审计单元回归 | 退出后审计 401 | 通过 | 先增加 `/api/auth/logout` 不应触发客户端审计的失败断言，再排除认证端点；`pnpm exec vitest run src/__tests__/lib/operation-audit.test.ts` 为 2/2 通过。云端实测仍待部署后复验 |
| 2026-07-17 | `da4c37e` 云端版本 | `3.9.0` | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/` | Chromium | P0-AUTH-001 真实登录 | 阻塞 | 在隔离浏览器输入历史临时账号后，`POST /api/auth/login` 返回 401，页面显示登录失败。Trace、视频、截图、Console 和 Network 已归档；不将无效凭据误报为应用通过或代码缺陷 |
| 2026-07-18 | `258d510` | `3.9.0` | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/` | Chrome（用户完成登录） | P0 画布、生成、恢复、退出 | 部分通过；删除异常待独立复验 | 真实粘贴上传、移动、缩放、生成、刷新恢复、退出通过；文件选择器与下载为控制层未验证。首轮删除回流异常在第二个全新隔离项目中未复现，保留为 BUG-20260718-004 观察项 |

## 基线校验

- `pnpm run doctor -- --url=https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`：3 项通过、9 项警告、0 项失败。警告均为本机未注入生产密钥、数据库、对象存储及模型凭据；仅证明 `/api/auth/me` 可达，不能据此推导云端数据库、对象存储、登录或模型数据链路健康。
- `pnpm ts-check`：2026-07-18 当前提交通过（退出码 0）。
- `pnpm exec playwright test tests/e2e/p0-core.spec.ts --list`：4个浏览器项目均已发现测试用例。
- `pnpm lint`：首次为 1 error / 929 warnings；修复 P0生成路由的 `prefer-const` 后，2026-07-18 `pnpm lint --quiet` 再次通过。warning 仍是历史存量，未被隐藏或清除；Babel 对超大 `infinite-canvas.tsx` 的样式降级提示不属于 ESLint error。
- `pnpm test`：2026-07-18 运行结果为 117 个测试文件、483 个测试通过；本机无数据库时出现预期回退日志，因此数据库链路仍未验证。
- `pnpm build`：2026-07-18 通过，耗时 78.7 秒。构建提示本地 `data` 目录不会在重部署后持久化，并有 Node `--localstorage-file` 无有效路径的 warning；两者未导致构建失败，但需在云端部署环境单独验证。
- 工作流鉴权修复后复验（2026-07-17）：`pnpm ts-check`、`pnpm lint --quiet`、`pnpm test`（117 个测试文件、483 个测试）以及 `pnpm build` 均通过；最新生产构建耗时 76 秒。2026-07-18 云端匿名 HTTP 探针也返回预期 401。该结果不能替代真实账号、存储和模型调用验证。
- `pnpm audit --prod --json`：未验证，镜像端点不存在、官方端点超时，详见 `SECURITY_REPORT.md`。
- 本轮新增回归：`pnpm exec vitest run src/__tests__/lib/operation-audit.test.ts` 为 2/2 通过；`pnpm lint --quiet`（排除自动生成 Playwright 报告后）与 `pnpm ts-check` 通过；`pnpm test` 为 117 个测试文件、483 个测试通过。测试环境没有数据库连接，因此输出中的本地存储回退日志不能作为数据库链路证据。
- 证据留存复验：Playwright 临时输出已移至 `.playwright-output/`，执行 `E2E_RUN_ID=20260717-p0-auth-entry` 的四浏览器匿名入口用例后，归档脚本新增 12 个视频/Trace/截图文件；`test-results/` 同时保留此前 Chromium 登录失败的证据，未再被新运行清空。

## 当前结论


## 2026-07-18 submitOnly 云端恢复回归（本地）

- RED：新增恢复提交参数与积分补偿契约后，两个断言按预期失败。
- GREEN：定向 `vitest` 26/26 通过；`pnpm ts-check` 通过；涉及文件 ESLint 通过。
- 全量：`pnpm test` 通过，118 个测试文件、494 条测试；`pnpm lint --quiet` 与 `pnpm build` 通过。
- 待验证：当前云端尚未包含本次未推送修改，真实 Chrome 生图、刷新恢复和取消退款必须在云端同步后重新执行并归档证据。

### 2026-07-18 `9026dcc` 云端真实生成恢复复验

| 环境 | Git Commit | 浏览器/账号 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/` | `9026dcc` | Chrome，既有 `Mr.joker / 管理员` 登录会话 | 精确选择 `api_1778430731224_533e09a::doubao-seedream-5-0-lite`，`1:1`、`x1`，提交真实付费图像生成；刷新；从项目列表重开最新项目 | 通过：任务短暂显示 `submitting 5%` 后完成；项目卡片显示红色立方体缩略图；重开项目后结果图、提示词、模型/供应商标记及 `2048 × 2048` 尺寸均存在。 | `test-results/screenshots/cloud-p0-generation-stalled-after-9026dcc-20260718.png`、`test-results/screenshots/cloud-p0-generation-recovered-after-9026dcc-20260718.png`、`test-results/console/cloud-p0-generation-recovered-after-9026dcc-20260718.json` |

说明：页面刷新会回到“我的项目”仪表盘；该导航行为不是任务丢失。没有在本次已成功任务上执行取消或构造供应商失败，因此退款原子性仍为未验证。

### 2026-07-18 `submitOnly` 计费数据流复验（本地）

- RED：`generate-idempotency-contract.test.ts` 新增断言后失败，证明 `consumeCredits` 出现在 `submitOnly` 任务持久化之后。
- GREEN：扣费移入 `submitOnly` 分支，外层任务持久化前完成；任务持久化失败或并发冲突会立即按已扣成本退款。定向任务恢复套件 4 文件 / 24 测试通过，`pnpm ts-check` 通过；目标 ESLint 为 0 error / 20 个既有 warning。
- 云端实证：修复前的真实豆包 Lite 任务没有新增 7 月 18 日 -6 流水，符合代码路径；必须在云端同步后复验扣费和余额变化，才能关闭 BUG-20260718-009。

已执行 Chrome 已登录会话的真实 P0 操作，并保留截图和 Console 证据；不能将其替代为独立凭据驱动的 Chromium、Firefox、WebKit 和移动 Chromium 全链路。首轮删除持久化异常在第二次隔离实测中未复现，尚不具备稳定缺陷的证据；文件选择器/下载、独立登录及跨浏览器完整链路仍未获得可审计证据，因此发布结论仍为不通过。

## 2026-07-18 云端独立普通用户会话复验（已部署）

| 环境 | Git Commit | 浏览器 | 流程 | 结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/` | `8248852`（含此前 `bb91262`） | Chromium、Firefox、WebKit、移动 Chromium | 无限画布入口登录 → 仪表盘 → 刷新保持会话 → 退出登录 | 4/4 通过。每个浏览器均收到包含用户 ID 的成功登录响应；刷新后仍为已登录状态；退出后回到“选择入口”；Console 无 error，Network 无普通用户对 `/api/admin/user-folder` 的 401。 | `test-results/screenshots/p0-auth-session-{chromium,firefox,webkit,mobile-chromium}.png`；对应 `console/`、`network/` JSON；归档 ID `20260718-p0-auth-session-cloud-green` 下的 video/trace/screenshot；`playwright-report/index.html` |

该项关闭 BUG-20260718-005 和 BUG-20260718-006 的云端部署验证缺口，但不覆盖原生文件上传、真实付费图像生成、下载与项目恢复的独立账号全链路。

## 2026-07-18 云端健康检查复验

`pnpm run doctor -- --url=https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/` 最终结果为 `3 passed / 9 warnings / 0 failed`，其中远程 `/api/auth/me` 返回 200。首次同命令出现 `fetch failed` 后，DNS 解析与 `curl -I` 均返回正常，未修改代码再次执行即通过，记录为瞬时终端网络连通波动，而非已确认应用缺陷。9 项警告均是本地未注入云端密钥、数据库、对象存储和发布安全变量；该检查不证明云端依赖健康，也不解除 P0 原生上传、真实生成、保存恢复和下载的验证缺口。

## 2026-07-18 submitOnly 远端恢复分流回归

| 项目 | 结果 |
| --- | --- |
| RED | 恢复后的 `generate-async` 含 `remoteTaskId` 时，帮助器不存在且本地任务早返回未排除它；定向 2 项断言失败。 |
| GREEN | `shouldPollRemoteAsyncGenerateTask` 明确区分本地包装任务与供应商任务；定向 3 文件 / 19 用例通过。 |
| API 回归 | `pnpm test:api`：36 文件 / 89 用例通过。 |
| 全量回归 | `pnpm test`：退出码 0；本机无数据库连接的回退日志保留为未验证事项。 |
| 静态门禁 | `pnpm ts-check`、`pnpm lint --quiet`、`git diff --check`：退出码 0。 |
| 构建 | 首次超时已定位为构建脚本内的隐式安装。脚本修复后 `pnpm build` 于 85.2 秒完成 97 个页面，退出码 0；仍有 5 条 Turbopack NFT 警告与 2 条 Node 本地存储路径警告。 |
| 云端 | 当前云端仍可复现 `processing 10%`；修复尚未部署，不得以本地回归替代真实验证。 |

## 2026-07-18 认证初始化项目同步回归

| 项目 | 结果 |
| --- | --- |
| RED | 项目同步没有超时，认证初始化在 `upsertUserFromServer` 后再次同步；两项契约测试失败。 |
| GREEN | 同步被限制为 8 秒、一次重试；认证启动不再进行重复等待。定向 3 文件 / 5 用例通过。 |
| 全量门禁 | `pnpm test` 127 文件 / 515 用例、`pnpm ts-check`、`pnpm lint --quiet`、`pnpm build`（97 页面）退出码均为 0。 |
| 云端 | 待同步后重新刷新已登录 Chrome，遮罩必须在最多两次有界同步后关闭，并保留项目/会话可用性。 |
# 2026-07-19 Cloud Resume Regression Addendum

| Check | Result | Evidence |
| --- | --- | --- |
| Logged-in preview reload | Failed | Authentication overlay remains after a 12 second condition wait. |
| Same-origin session API | Passed only as a diagnostic | CDP fetch returns `200`, `success: true`, and a user. It is not a substitute for the UI workflow. |
| Application session request during reload | Failed | Captured network trace has no application `/api/session` request. |
| P0 upload through logout | Blocked | The visible overlay prevents real user interaction. No paid generation was submitted. |

Artifacts: `test-results/screenshots/cloud-p0-auth-overlay-resumed-20260719.png` and `test-results/console/cloud-p0-auth-overlay-resumed-20260719.json`.

## 2026-07-19 Deployment Runtime Repair (Pending Cloud Sync)

- Red: `src/__tests__/scripts/coze-production-preview-contract.test.ts` failed because the `[dev]` section used `pnpm run dev` and no production build.
- Green: `.coze` now uses `pnpm run build` and `pnpm run start` for the cloud preview; the contract test passes.
- Gates: `pnpm lint --quiet`, `pnpm ts-check`, and `pnpm run build` passed. The build produced 97 routes and retained three non-failing Next NFT tracing warnings for follow-up.
- Required next evidence: a cloud sync, a fresh logged-in Chrome reload with no auth overlay, then the complete real P0 workflow.

## 2026-07-19 Coze preview startup regression correction

- New cloud evidence: the production-style `[dev]` change failed at startup with `sh: 1: next: not found` (exit code `1`).
- Root cause: the preview build command invoked `next build` before the locked JavaScript dependencies had been installed.
- Corrected source contract: `[dev]` now runs `pnpm install --frozen-lockfile` and `pnpm run dev`; `[deploy]` retains `pnpm run build` and `pnpm run start`.
- Local evidence: `pnpm install --frozen-lockfile` completed successfully, including the optional post-install tool preparation; `coze-production-preview-contract.test.ts` passed.
- Status: cloud deployment verification is still pending. The correction prevents the known configuration regression in source, but is not proof that the current Coze preview has adopted it.

## 2026-07-19 Cloud availability recheck (commit `95b9afd`)

| Check | Result | Evidence |
| --- | --- | --- |
| Local API contract suite | Passed: 36 files / 89 tests | `pnpm test:api` exited 0 on the source workspace. This is local contract evidence only. |
| Cloud doctor | Failed: 2 pass / 9 warnings / 1 failure | `pnpm run doctor -- --url=<preview>` received HTTP 502 from `/api/auth/me`. |
| Independent read-only cloud probes | Failed | `/`, `/api/auth/me`, and `/api/session` each returned HTTP 502; see `test-results/network/cloud-health-502-20260719.json`. |
| Authenticated P0 persistence regression | Not executed | The cloud gateway/backend was unavailable. No login, paid generation, persistence, download, or logout action was attempted. |

Conclusion: this is an external preview availability blocker, not evidence for a source-level change. It blocks the required real-browser regression for BUG-20260719-019 and BUG-20260719-021. The next valid run must first observe a healthy root response plus a valid authenticated session response, then repeat generate -> logout -> Chrome-saved-credential relogin with the full evidence set.

## 2026-07-19 Real persistence regression recheck

| Check | Result | Evidence |
| --- | --- | --- |
| Preview availability | Recovered | Root, `/api/auth/me`, and `/api/session` returned 200; `doctor` reported 3 passed / 9 warnings / 0 failed. |
| APImart image generation | Passed | One authorized `doubao-seedream-5-0-lite` x1 request reached the completed state with an 800 x 800 canvas image. |
| Dashboard before logout | Passed | The new project and image raised the count to 15 projects / 184 assets. |
| Logout and Chrome-saved-credential relogin | Failed (P1) | Authentication succeeded, but the count regressed to 15 projects / 183 assets. |
| Source regression | Passed locally | A deferred project-sync test was red before the follow-up change and is green after `logout()` awaits the sync before sending `/api/auth/logout`. |
| Local quality gates | Passed | Focused test: 3/3; `pnpm test:regression`: 92 files / 436 tests; `pnpm ts-check`; `pnpm lint --quiet`; `pnpm build`: 97 routes. |

The real cloud result refines BUG-20260719-019: starting a keepalive sync is insufficient when logout invalidates the server session concurrently. The follow-up source fix is pending cloud deployment; the bug remains P1 until the same real-browser flow keeps the 184-asset count after relogin.

## 2026-07-19 Production-preview bootstrap check

| Check | Result | Evidence |
| --- | --- | --- |
| Preview runtime contract | Passed | Red first against the `next dev` configuration; green after requiring locked install plus build and `next start`. |
| Locked install and production build | Passed | `pnpm install --frozen-lockfile` and `pnpm run build` completed; build generated 97 routes. |
| Focused P1 regression | Passed | 12 Vitest assertions for session timeout, bootstrap ordering, deployment configuration, and logout ordering. |
| Anonymous production login entry | Passed | Playwright 4/4 across Chromium, Firefox, WebKit, and mobile Chromium. |
| Cloud acceptance | Unverified | The cloud preview must synchronize this revision; the overlay and the project-persistence flow require real Chrome evidence. |

## 2026-07-19 Full local regression after preview bootstrap change

| Check | Result | Evidence |
| --- | --- | --- |
| Full Vitest suite | Passed | `pnpm test` completed with 130 test files and 527 tests passing. |
| API suite | Passed | `pnpm test:api` completed with 36 test files and 89 tests passing. |
| Local doctor | Passed with expected environment warnings | 2 passed, 10 warnings, 0 failed; the warnings identify absent local release secrets, provider keys, database, and object storage rather than production acceptance. |
| Cloud P0/P1 acceptance | Unverified | The current cloud preview still reports a development runtime (`next-devtools` and Turbopack HMR in the document). Do not use these local results as cloud-release proof. |

## 2026-07-19 Cloud resynchronization authentication check

| Check | Result | Evidence |
| --- | --- | --- |
| Preview health endpoint | Passed | `pnpm run doctor -- --url=<preview>` received HTTP 200 from `/api/auth/me`; doctor reported 3 passed, 9 local-environment warnings, 0 failed. |
| Preview runtime | Failed release prerequisite | The cloud HTML still includes `next-devtools`, Turbopack HMR, and Coze Console Bridge scripts. The production preview configuration from `4c0015b` is not active. |
| Authenticated Chrome reload | Failed (P1) | The full canvas rendered behind `正在验证身份...`; the unique overlay remained visible after an explicit hidden-state wait, so no write or paid action was attempted. |
| Evidence | Archived | `test-results/screenshots/cloud-p1-auth-overlay-after-4c0015b-20260719.png` and `test-results/console/cloud-p1-auth-overlay-after-4c0015b-20260719.json`. The captured warnings are from the injected Console Bridge, not an application JavaScript error. |

The synchronized source alone is insufficient. The cloud preview must restart using the `[dev]` build script and `pnpm run start`; only then may the authenticated P0 generation, persistence, download, and logout flows continue.

## 2026-07-19 Canvas hover-toolbar regression

| Check | Result | Evidence |
| --- | --- | --- |
| Cloud reproduction | Failed before fix | Clicking the visible image hover-toolbar `删除` control opened `美陈拆解` and retained the image because the controls overlapped at the same stacking level. |
| Source regression | Passed | `pnpm test:regression` passed 92 files / 440 assertions, including the new `canvas-toolbar-floating-windows.test.ts` contract requiring the hover toolbar at `z-[60]`. |
| Local quality checks | Passed | Targeted ESLint on `src/components/infinite-canvas.tsx` and `pnpm ts-check` both passed. |
| Cloud closure | Pending synchronization | Re-run selection -> hover delete -> reopen project in Chrome after `cd8c90d` is active. The image must be removed, no `美陈拆解` panel may open, and deletion must persist. |
