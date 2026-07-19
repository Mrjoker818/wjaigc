# 缺陷登记册
## BUG-20260719-038: Public media route exposed private data-root files and active SVG content

| Field | Record |
| --- | --- |
| Severity | P0, fixed locally; cloud verification pending |
| Module | `GET /api/serve-upload/[...path]`, `POST /api/upload`, and `POST /api/save-image` |
| Stable reproduction | The public file route searched both `{dataRoot}/uploads` and the whole `dataRoot`. Since user records and provider configuration are stored under `{dataRoot}/system`, requests such as `/api/serve-upload/system/users.json` and `/api/serve-upload/system/api-providers.json` reached local reads without authentication. The route also returned stored `.svg` files as `image/svg+xml`; upload/save-image accepted SVG or a multipart filename-derived extension. |
| Expected | Only known media and 3D asset extensions may be public. `system/` and `users/` are never public. Uploaded image bytes must match a safe raster MIME allowlist, and existing SVG downloads must not execute as same-origin documents. |
| Root cause | A compatibility fallback treated the entire persistent data directory as a public media root, while the persistence APIs trusted supplied MIME types and filename extensions. |
| Fix | Validate public paths before any filesystem/S3/source-map operation; block private roots and non-media extensions; add `nosniff`; force legacy SVG to download as octet-stream attachment. A shared media validator now verifies JPEG/PNG/GIF/WebP/BMP/AVIF and supported video signatures, derives safe filenames, and is used by upload plus all save-image ingress paths. |
| Regression | Red-first `public-media-access-contract.test.ts` failed on four security assertions, then passed. Full API: 48 files / 112 tests; component/library regression exited 0; TypeScript and production build passed. Lint: 0 errors, 927 historical warnings. |
| Cloud acceptance | Pending: anonymous `system/users.json` and `system/api-providers.json` requests must return 404 without body disclosure; a normal PNG upload, a generated image persistence operation, and an SVG export download must remain usable. |

## BUG-20260719-037: Recharge order detail endpoint exposed order data without ownership checks

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | `GET /api/recharge/[orderId]` |
| Stable reproduction | A request with any order ID reached `SELECT * FROM wujie_recharge_orders WHERE id = $1` without a session check, then returned amount, payment status, expiry, note, and payment link. When the configured direct link was absent, the same GET request decoded a QR URL and wrote payment configuration. |
| Expected | Anonymous callers receive 401 before database/configuration access. Ordinary users can read only orders where `user_id` matches their session; administrators retain read access. GET must not mutate payment configuration. |
| Root cause | The recharge page route was considered a public payment page even though normal order creation and status APIs already require a signed-in user and ownership. |
| Fix | Authenticate before order parsing or database access; scope ordinary-user SQL by `user_id`; keep administrator lookup explicit; remove the payment-config write from the GET fallback. |
| Regression | Red-first `recharge-order-ownership.test.ts` failed for anonymous access, missing ownership SQL, and a GET-side configuration write, then passed. Full API: 47 files / 107 tests; component/library regression: 93 files / 442 tests; TypeScript and production build passed. |
| Cloud acceptance | Pending: anonymous order read must be 401, a different signed-in user must receive 404, the owner must load their recharge page, and an administrator must retain review access. |

## BUG-20260719-036: Selected-image delete activates the overlapping display-decompose action

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | Infinite canvas selected-image toolbar |
| Environment | Logged-in Coze Chrome preview, 2026-07-19 Asia/Shanghai; source baseline `44c7f8f`. |
| Stable reproduction | Open the existing one-image test project, select the red-cube image, then click the unique visible `删除` button. The image remains and the `美陈拆解` panel opens instead. |
| Expected | The selected-image delete affordance removes the selected image and saves the project. It must not invoke any image-processing action. |
| Actual | `document.elementFromPoint()` at the semantic delete button's center resolves to the selected-image toolbar's `美陈拆解` button. The selected image has `z-[60]`, but the two independently rendered toolbars occupy the same anchor position. |
| Root cause | The hover quick-action toolbar and selected-image toolbar overlapped. The hover delete stayed in the DOM while the selected toolbar captured pointer input. |
| Fix | Hide hover quick actions while their image is selected; add an explicit, test-addressable delete control to the selected-image toolbar, using the existing persisted `applyImageChanges` path. |
| Regression | Red-first `canvas-toolbar-floating-windows.test.ts` failed on the missing selected-state guard and delete action, then passed. Full API: 46 files / 104 tests; component/library regression: 93 files / 442 tests; TypeScript and production build passed. |
| Cloud acceptance | Pending another synchronized cloud deployment: click delete, confirm no `美陈拆解` panel opens, confirm the image disappears, then reopen the project and confirm it remains deleted. |

## BUG-20260719-035: Professional image upscale accepted unauthenticated expensive work

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | `POST /api/image/upscale-pro` |
| Stable reproduction | Adding only this route to the shared high-risk authorization contract failed with the path as the sole missing authorization boundary. The handler called `request.json()` before any session or signed internal-request validation. |
| Expected | Before accepting an image URL or starting cloud/local/AI upscale processing, require a signed-in user or verified internal request. |
| Root cause | An unused `getSessionUser` import suggested an intended check, but no authentication call occurred in the handler. |
| Fix | Replace the unused import with `requireApiAuthOrReject` and invoke it before the `try` block and `request.json()`. |
| Regression | The red-first shared contract failed with exactly `src/app/api/image/upscale-pro/route.ts`, then passed. Targeted ESLint and TypeScript checks passed. |
| Cloud acceptance | Pending. An anonymous request must receive 401 before media processing; an authenticated image-toolbar upscale must complete and persist without a 401. |

## Deployment observation: 2026-07-19

- The logged-in Coze Chrome preview was inspected again after a reported synchronization. Its visible feature entries and zero captured console errors show that it is functioning, but its selected image still renders `absolute group z-10 z-20` instead of the `z-[60]` required by the delete-toolbar correction in `ec149a3`.
- This is deployment evidence, not a new source defect: retain BUG-20260719-024 as open pending cloud acceptance. Do not mark the delete regression passed until the preview runs `c702d01` or a descendant and the delete/reopen workflow is executed on that bundle.


## BUG-20260719-034: Expensive media and AI processing routes lacked an authentication boundary

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | `POST /api/audio/generate`, `/api/image/color-adjust`, `/api/knowledge/extract-text`, `/api/layered-decompose`, `/api/scene-studio/generate`, `/api/video/extract-frame`, and `/api/video/extract-frames` |
| Stable reproduction | The shared high-risk authorization contract was extended with the seven routes and failed, because every handler parsed untrusted request input before proving a request identity. The affected paths can call third-party TTS/image models, fetch remote media/documents, run Sharp or FFmpeg, write files, or start AI decomposition/generation. |
| Expected | A browser user must have a session, or a server caller must provide the verified internal-request signature, before JSON parsing, remote fetches, file writes, FFmpeg, or model usage. |
| Root cause | The endpoints had input validation but did not consistently use the common mandatory authentication boundary. |
| Fix | Add `requireApiAuthOrReject` as the first operation of each POST handler, before `request.json()` and any resource-consuming work. |
| Regression | `high-risk-route-auth-contract.test.ts` failed with exactly these seven route files and passes after the repair. Targeted contract suite: 3 files / 5 assertions passed; targeted ESLint and TypeScript checks passed. |
| Cloud acceptance | Pending. For each user-facing path, verify a signed-in canvas user completes a normal operation without a new 401; anonymous calls must return 401 before input parsing or provider work. |

## BUG-20260719-033: Project source and full-asset archives were anonymously downloadable

| Field | Record |
| --- | --- |
| Severity | P0, fixed locally; cloud verification pending |
| Module | `GET` and `POST /api/export-project` |
| Stable reproduction | `GET /api/export-project?scope=full` or a POST body with `scope=full` reached `createTarGz` without an authenticated user. The `full` archive may include project source, configuration, user uploads, generated images, and exports. |
| Expected | Only an administrator or verified internal administrator request may inspect archive metadata or create/download any project export. |
| Root cause | The developer-oriented export endpoint was exposed without the existing administrator authorization helper. |
| Fix | Both GET and POST call `requireAdminUser` before reading scope or creating an archive and return 403 otherwise. |
| Regression | The red-first GET/POST source-order contract failed twice before the repair and passes afterward. A route-level test now calls both anonymous methods and proves each returns 403 before archive generation. Targeted suite: 3 files / 5 assertions passed. |
| Cloud acceptance | Pending. An anonymous request and ordinary-user session must be rejected; an administrator needs a controlled successful export test without exposing it to non-administrators. |

## BUG-20260719-032: Image persistence route trusted forgeable local/internal headers

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | `POST /api/save-image` and server-to-server image persistence callers |
| Environment | Source commit `4901d25`, 2026-07-19 Asia/Shanghai. |
| Stable reproduction | The route bypassed session authentication for a request that provided `x-internal-call: true` or a Host beginning with `localhost`/`127.0.0.1`, before accepting multipart/data/remote image content and writing to local/S3 storage. |
| Expected | Browser users must have a session. Internal callers must use `getInternalRequestHeaders` with the server-only shared secret; caller-controlled Host values and bare headers may not bypass authentication. |
| Root cause | A legacy development shortcut was retained while server-side generation, Agent, workflow, brand/refine, scene, upscale, video, and quality-enhance paths called the HTTP persistence endpoint. |
| Fix | Remove the caller-controlled bypass and require `requireApiAuthOrReject(request)` before body parsing. Migrate all direct server persistence callers to signed `getInternalRequestHeaders`; delayed background persistence uses the explicit internal worker identity `system-save-image` with administrator role, while request-scoped Agent/generation calls retain the authenticated user identity. The shared compatibility layer no longer imports server-only authentication; its server-side result persistence moved to `persist-result-image.ts`. |
| Regression | The new red-first contract initially failed on the bypass and unsigned caller inventory. It now passes, including the no-bare-header check. A runtime helper regression verifies both data-URL and remote-result persistence send signed headers. Focused compatibility regression: 5 files / 39 assertions passed. Full API suite: 44 files / 100 assertions passed. Component/library regression, targeted ESLint error check, and TypeScript checks passed. |
| Cloud acceptance | Pending. Verify anonymous `POST /api/save-image` is rejected before media parsing, then run a signed-in real image generation, workflow result persistence, video generation/extension, refinement, and upscale result save without new 401 failures. |

## BUG-20260719-031: Upload route trusted forgeable internal-call headers

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | `POST /api/upload` |
| Environment | Source baseline `390a485`, 2026-07-19 Asia/Shanghai. |
| Stable reproduction | The handler skipped session authentication whenever a request sent `x-internal-call: true` or a `Host` starting with `localhost`/`127.0.0.1`, then accepted multipart file content for persistent storage. |
| Expected | Uploads require a signed-in user or the established signed internal-request protocol; a client-controlled Host or arbitrary header must never bypass authentication. |
| Root cause | A legacy local-development shortcut bypassed the shared authorization layer. Repository search found browser upload callers only, so no server caller relies on the shortcut. |
| Fix | Replace the bespoke bypass with `requireApiAuthOrReject(request)` before `formData()` parsing. |
| Regression | `upload-auth-contract.test.ts` failed first because the bypass was present, then passed. It ran with cache-image and high-risk-route contracts: 3 files / 3 assertions passed; targeted ESLint error check and `pnpm ts-check` passed. |
| Cloud acceptance | Pending deployment. An anonymous multipart POST must return 401 and a signed-in user must complete a real image upload. |

## BUG-20260719-030: Image cache proxy accepted unauthenticated remote-fetch requests

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | `POST /api/cache-image` |
| Environment | Source baseline `f2ab701`, 2026-07-19 Asia/Shanghai. |
| Stable reproduction | The route accepted an arbitrary validated `imageUrl`, then fetched and wrote the image to application/S3 storage without checking request identity. Both `ImagePreview` and `stable-image-url` call it from normal signed-in browser sessions. |
| Expected | Only a signed-in user or a verified internal application request may invoke remote image caching. |
| Root cause | The route had input and partial private-address checks but omitted the common API authorization boundary. |
| Fix | Call `requireApiAuthOrReject(request)` before parsing `imageUrl`, validating it, or fetching remote content. |
| Regression | `cache-image-auth-contract.test.ts` first failed because the guard was absent, then passed. It ran with SVG and video high-risk route contracts: 4 files / 4 assertions passed; targeted ESLint error check and `pnpm ts-check` passed. |
| Cloud acceptance | Pending deployment. An anonymous POST must return 401 before URL parsing/fetching. A signed-in user must still be able to persist a provider result or cross-origin preview image. |

## BUG-20260719-029: Video download proxy lacked an authentication boundary

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | `GET /api/video/download` |
| Environment | Source commit `4cb699c`, 2026-07-19 Asia/Shanghai. |
| Stable reproduction | The endpoint accepted a URL query and could read an allowed local file or proxy an external HTTPS response without checking the caller's identity. |
| Expected | Video download and proxying are available only to authenticated users or verified internal callers. |
| Root cause | The route implemented source/path checks but omitted the common API authentication layer. |
| Fix | Add `requireApiAuthOrReject(request)` before reading `url` or touching local/remote media. |
| Regression | `video-download-auth-contract.test.ts` failed before the change and passes afterward. It ran with media-toolbar video contracts: 2 files / 12 assertions passed; ESLint error check and `pnpm ts-check` passed. |
| Cloud acceptance | Pending deployment. Verify anonymous=401 and a signed-in canvas user can still download an owned generated video. |

## BUG-20260719-028: Video post-production accepted unauthenticated FFmpeg work

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | `POST /api/video/tools` |
| Environment | Source commit `c09bd79`, 2026-07-19 Asia/Shanghai. |
| Stable reproduction | The POST handler parsed processing instructions and could download video, create temporary files, and invoke FFmpeg without checking request identity. |
| Expected | Every video post-production action requires a signed-in user session or verified internal request before parsing the job body. |
| Root cause | The route independently enforced URL and numeric constraints but omitted the shared API authentication gate. |
| Fix | Add `requireApiAuthOrReject(req)` before the handler's `try` block and body parsing. |
| Regression | `video-tools-auth-contract.test.ts` failed before the change and passes afterward. It ran with high-risk route and media-toolbar contracts: 3 files / 13 assertions passed; ESLint error check and `pnpm ts-check` passed. |
| Cloud acceptance | Pending deployment. An anonymous request must return 401; an authenticated canvas user must retain video extraction/compression UI behavior. |

## BUG-20260719-027: SVG tracing accepted unauthenticated expensive requests

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | `POST /api/svg-trace` |
| Environment | Source commit `0aef48b`, 2026-07-19 Asia/Shanghai. |
| Stable reproduction | The handler parsed `imageUrl`, then proceeded into credit and vectorization setup without checking the request identity. The operation can fetch an image and run local/Python/WASM vectorization. |
| Expected | A request must prove a user session or the application internal request signature before body processing and resource consumption. |
| Root cause | SVG tracing had its own optional `getSessionUser` call solely for credits, but did not use the shared mandatory authentication gate. |
| Fix | Add `requireApiAuthOrReject(req)` as the first operation in the POST handler. This keeps browser sessions and signed internal Agent calls working through the common authenticator. |
| Regression | `svg-trace-auth-contract.test.ts` failed before the change and passes after it. Together with the high-risk route contract: 2 files / 2 assertions passed; ESLint error check and `pnpm ts-check` passed. |
| Cloud acceptance | Pending deployment. An anonymous request must return 401 before any fetch or processing; signed-in SVG tracing needs a real-image success/failure result without a new auth error. |

## BUG-20260719-026: Local image-service startup route lacked authorization

| Field | Record |
| --- | --- |
| Severity | P1, fixed locally; cloud verification pending |
| Module | `POST /api/image/start-services` |
| Environment | Source commit `9a925a1`, 2026-07-19 Asia/Shanghai. |
| Stable reproduction | The route accepted any POST request and could run `spawn('iopaint', ...)` to start a local AI service. Repository search found no user-facing caller, so it is an operations-only endpoint. |
| Expected | Only an administrator session or authenticated trusted internal administrator request may initiate a server-local service. |
| Root cause | The route was introduced as a health/start convenience endpoint without routing through the established API authentication layer. |
| Fix | Add `requireApiAuthOrReject`, then enforce `userRole === 'admin'` before any health check or subprocess start. |
| Regression | `image-start-services-auth-contract.test.ts` failed before the change and passes afterward. Together with the high-risk route contract: 2 files / 2 assertions passed; targeted ESLint and `pnpm ts-check` passed. |
| Cloud acceptance | Pending deployment. Verify unauthenticated=401, ordinary user=403, administrator=200/503 without exposing process details. |

## BUG-20260719-025: Image recovery endpoint accepted a public fallback key

| Field | Record |
| --- | --- |
| Severity | P0, fixed locally; cloud verification pending |
| Module | `POST` / `GET` `/api/recover-images` |
| Environment | Source commit `ec149a3`, 2026-07-19 Asia/Shanghai. |
| Stable reproduction | The route required any authenticated user but then accepted the literal fallback recovery key `wujie-recovery-2024`. A caller with that public repository value could run scan, recovery, or S3 synchronization; `filename` was also passed to file operations without a traversal guard. |
| Expected | Only an authenticated administrator or trusted internal administrator request can use recovery operations, and a targeted filename remains inside the recovery root. |
| Root cause | Progressive API authentication was mistaken for administrator authorization, then supplemented with an insecure static shared key. |
| Fix | Remove the fallback/key-based path. Both handlers now require `userRole === 'admin'`; targeted recovery rejects absolute, drive-qualified, null-byte, and traversal paths before file access. |
| Regression | `recover-images-admin-contract.test.ts` was red with 3 failures before the change and green afterward. It verifies two administrator guards, absence of the public key/body key, and a traversal rejection contract. It ran with the high-risk authorization contract: 2 files / 4 assertions passed; targeted ESLint and `pnpm ts-check` passed. |
| Cloud acceptance | Pending deployment of the next commit. A non-admin authenticated session must receive 403; the administrator session must receive 400 for `filename=../x`, without starting a recovery. |

## BUG-20260719-023: Logout synchronization records a transient client fetch error

| Field | Record |
| --- | --- |
| Severity | P2, open |
| Module | `UserManager.logout` project synchronization |
| Environment | Coze cloud preview, Chrome, commit `b906a15`, 2026-07-19 Asia/Shanghai. |
| Reproduction | In the authenticated dashboard, open the user menu and choose logout. `/api/auth/logout` returns 200 and the page reaches the anonymous entry, but Chrome records one caught `[Sync] syncToServer error: TypeError: Failed to fetch` from the console bridge. |
| Evidence | `test-results/console/cloud-p0-auth-login-logout-relogin-b906a15-20260719.json`; matching network evidence. |
| Confirmed facts | Project-sync responses recorded in the same flow returned 200. Relogin restored the same 15 projects and 183 images. |
| Root cause | Not yet isolated. The browser error is emitted before the successful logout completion, so it must not be silenced or treated as an accepted success condition. |
| Required next step | Reproduce with request-level timing and trace the failing `syncToServer` fetch boundary before any code change. |

## BUG-20260719-021 closure: Cloud authentication startup and anonymous workspace isolation

| Field | Record |
| --- | --- |
| Severity | P1, fixed and cloud-verified |
| Verified commit | `b906a15 fix: isolate anonymous login from canvas startup` |
| Cloud result | A signed-in refresh requested `/api/session` with HTTP 200 and returned to the dashboard. Logout reached the anonymous `选择入口`; the `图像生成器` button count was 0 before login. Canvas login and Chrome-stored-credential relogin restored the dashboard. |
| Data check | Project and asset counters remained 15 and 183 before and after logout/relogin. Administrator counters settled to users 6, API providers 14, and templates 12; their APIs all returned successful non-empty payloads. |
| Evidence | `test-results/screenshots/cloud-p0-auth-login-logout-relogin-b906a15-20260719.png`, matching console and network JSON. |

## BUG-20260719-022: Anonymous users mounted the full canvas before the login entry

| Field | Record |
| --- | --- |
| Severity | P1 |
| Module | Authentication bootstrap / canvas entry |
| Environment | Local Webpack preview, commit pending after `ebfc699`; Chromium, Firefox, WebKit, and Pixel 7 emulation. |
| Stable reproduction | Open `/` with no `wujie_session` cookie. `/api/session` returns `{ success: true, user: null }`. Before this repair, the complete canvas mounted before the login panel, so Firefox could not reach the entry within five seconds and the canvas toolbar was present to an anonymous visitor. |
| Root cause | `LoginPanel` was rendered at the end of the workspace tree. Once `authChecked` became true, React had to mount the canvas and all heavyweight panels before committing the login layer. |
| Fix | Return `LoginPanel` directly when `authChecked` is true and `currentUser` is absent. The workspace is now mounted only after a session user exists. |
| Regression | `p0-login-ui-contract.spec.ts` now asserts both the entry and the absence of the `图像生成器` button before login. Playwright warms the server by waiting for a real homepage response, not a fixed sleep. |
| Evidence | `test-results/screenshots/p0-login-ui-contract-{chromium,firefox,webkit,mobile-chromium}.png`, matching console/network JSON, Playwright video, trace, HTML report, and JUnit report. |
| Result | Fixed locally: four browser projects passed. Cloud acceptance remains pending after GitHub synchronization. |

## INFRA-20260719-002: Coze preview renders Next Flight scripts without executing them

| Field | Record |
| --- | --- |
| Severity | P1 external deployment blocker |
| Environment | Coze preview after GitHub commit `ea8575f` was confirmed in the served `src_app_page` chunk; authenticated Chrome session. |
| Stable reproduction | Reload the preview. The six inline scripts containing `self.__next_f.push(...)` are present in the DOM, but `window.__next_f` is `undefined`, document/html/body contain no React mount markers, and no `/api/session` request occurs after nine seconds. |
| Contrast control | The same source run locally with `next dev` has `window.__next_f` as an object, React markers on document/html/body, a dismissed auth shell, and `/api/session` requests in the same nine-second measurement window. |
| Root cause | The preview layer is not executing the parser-provided Next Flight inline startup scripts. This occurs before `CanvasApp`, authentication effects, API calls, or provider logic can execute. The response also continues to expose Turbopack development-runtime assets despite `.coze` specifying locked install, build, and `next start`. |
| Required external remediation | Redeploy/restart the Coze preview using the repository `.coze` `[dev]` build script plus `pnpm run start`, or correct the preview proxy so that the original Next HTML response is parser-executed rather than reinserted as inert DOM. |
| Evidence | `test-results/screenshots/cloud-p1-flight-scripts-not-executed-after-ea8575f-20260719.png`, matching console and network JSON files. |
| Release status | P1 remains open. Do not run paid generation, persistence, download, or logout regression until a Chrome reload has a React mount marker, `window.__next_f`, and a real `/api/session` request. |

## BUG-20260719-021 update 2: remove Next navigation subscriptions from the first client commit

| Field | Record |
| --- | --- |
| Environment | Coze preview, logged-in Chrome session, source commit `623e2d5` deployed. |
| Stable reproduction | The root-layout isolation was present, but after reload the auth shell remained visible for nine seconds. Client chunks loaded and no runtime exception or loading failure occurred; no `/api/session` request was sent. |
| Narrowed cause | The remaining first-render dependencies were an unused `useRouter()` call and `useSearchParams()` subscription inside `CanvasApp`. In the injected dev preview, that Next navigation subscription can prevent the client tree from committing, so no effect can begin the session request. |
| Fix | Remove both Next navigation hooks from this initial path. `getInitialProjectId()` reads `window.location.search` exactly once into a ref; the first render remains the same auth shell on server and client. The obsolete `Suspense` wrapper is removed with the router subscription. |
| Regression | Red-first auth contract now requires no `next/navigation` import, one-time browser query parsing, and an auth effect without `searchParams`. Targeted contract, TypeScript, lint, `next dev` Playwright 4/4, optimized build, and full Vitest passed locally. |
| Cloud acceptance | Pending synchronization. Chrome must show an `/api/session` network request and a hidden auth shell before P0 generation, persistence, or logout tests are resumed. |

## BUG-20260719-021 update: cloud client does not start auth effect after shell-only deployment

| Field | Record |
| --- | --- |
| Environment | Coze preview, logged-in Chrome session, source commit `5ff1845` deployed. |
| New stable evidence | The new `auth-loading-shell` asset was present in the cloud bundle. After reload it remained visible for nine seconds. Chrome CDP recorded 113 network events: all required client chunks returned 200, no runtime exception or loading failure occurred, and zero application `/api/*` requests were issued. |
| Conclusion | This is not the already-fixed unstable `useSearchParams` dependency loop. The authentication effect is not being committed at all in the injected preview runtime. |
| Root cause under test | `src/app/layout.tsx` was a client root that hydrated the document `<html>` and `<body>`. Coze development preview injects bridge scripts at that document level, creating a hydration boundary vulnerable to external DOM injection before the application subtree mounts. |
| Fix | Remove the unnecessary root `'use client'` directive. `OperationAuditClient` remains an explicitly imported client child, so request auditing is retained while the document root is server-rendered. |
| Evidence | `test-results/screenshots/cloud-p1-auth-shell-still-visible-after-5ff1845-20260719.png`, `test-results/console/cloud-p1-auth-shell-still-visible-after-5ff1845-20260719.json`, and `test-results/network/cloud-p1-auth-shell-network-after-5ff1845-20260719.json`. |
| Regression / acceptance | Red-first source contract now verifies a server root plus isolated audit client. Targeted contract, TypeScript, lint, local `next dev` Playwright 4/4, production build, and full Vitest passed before deployment. Cloud Chrome acceptance remains required after synchronization. |

## BUG-20260719-021: Auth loading shell remains visible after cloud session bootstrap

| Field | Record |
| --- | --- |
| Severity | P1 release blocker |
| Module | `CanvasApp` authentication bootstrap in `src/app/page.tsx` |
| Stable reproduction | Reload a signed-in Chrome session in the Coze preview. The complete canvas and toolbars render behind the unique `正在验证身份...` overlay, which remains visible after an explicit 12-second hidden-state wait. |
| Root cause | The initial client hydration mounted the complete workspace while the bounded session request was unresolved. In the injected preview runtime this made the authentication state transition unreliable even though the current session code was deployed. |
| Fix | Render only `data-testid="auth-loading-shell"` until `authChecked` resolves, then mount the canvas, dashboard, or login surface. Existing hook order and the eight-second session timeout are unchanged. |
| Regression | The source contract was red before the guard and green after it. Local production Playwright passed 4/4 on Chromium, Firefox, WebKit, and mobile Chromium. Full Vitest passed 130 files / 528 tests; TypeScript, lint, and production build passed. |
| Cloud acceptance | Pending. Reload the synchronized signed-in Chrome session and prove the loading shell disappears before any paid P0 action. Then repeat generate -> save -> logout -> Chrome-saved-credential relogin for BUG-20260719-019. |

## INFRA-20260719-001: Cloud preview transient backend unavailability

| Field | Record |
| --- | --- |
| Severity | P1 release blocker |
| Module | Cloud preview deployment / backend connectivity |
| Environment | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`, 2026-07-19 Asia/Shanghai, commit `1713ab6` |
| Reproduction | Run `pnpm run doctor -- --url=https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`; request preview root directly. |
| Expected | Auth health endpoint and preview UI are reachable for logged-in P0 validation. |
| Actual | First probe: `/api/auth/me` returned HTTP `502`; root returned `{ "detail": "无法连接到后端服务" }`. A later probe recovered to `200`. |
| Evidence | Doctor output and direct HTTP response from this run. |
| Root cause | Not yet attributable from the application repository; retained as a deployment reliability observation. |
| Code change | None. |
| Regression result | Do not close until repeated deployment probes are stable. The active user-facing blocker is recorded separately in BUG-20260718-016. |

## 2026-07-18 BUG-20260718-014：云端管理数据失败被伪装成空数据

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 云端后端可用性、管理员 API 管理与任务监控 |
| 稳定复现 | 当前 Chrome 已登录管理员会话中，项目列表仍显示 11 个项目和 182 张图片，但 API 管理显示 0 个供应商、0 个用户、任务监控为空。点击“刷新列表”和“刷新自检”后状态不变。Console 连续记录项目同步 `500/502`。 |
| 实际影响 | 当前无法安全提交真实模型任务、确认已有任务终态或验证积分。原 UI 将所有失败清空成“暂无API提供商 / 暂无云端任务记录”，会误导管理员认为配置被删除。 |
| 根因 | `DashboardView` 对 `/api/admin/apis`、`/api/admin/cloud-tasks` 和 `/api/admin/production-readiness` 的非 2xx / 业务失败 / 网络异常均清空数据或置空，未保留错误状态；云端后端的实际 500/502 仍需部署环境恢复。 |
| 修复 | 新增三类加载错误状态及重试入口，保留已加载数据。供应商、任务监控与发布自检在失败时明确显示 HTTP/业务/网络错误，不再伪装为空数据。 |
| 回归 | 先红后绿：新增 `dashboard-admin-load-error-contract.test.ts`。目标测试、`pnpm ts-check`、`pnpm lint --quiet` 通过；全量回归和构建待本次提交前执行。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-provider-config-zero-20260718.png`、`test-results/console/cloud-p1-provider-config-zero-20260718.json`。本地可观测性修复完成；云端 500/502 为外部 P1 阻塞，未关闭。 |

## 2026-07-18 INFRA-20260718-007：生产构建依赖外部 Google 字体网络

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 构建与部署可靠性 |
| 稳定复现 | `pnpm build` 在请求 `fonts.gstatic.com` 的 Geist 字体失败后，Turbopack 报字体内部模块无法解析，生产构建退出码为 1。 |
| 根因 | `src/app/layout.tsx` 使用 `next/font/google`，把全局字体加载绑定到构建时外部网络；而项目 CSS 已有完整本地系统字体回退链。 |
| 修复 | 移除远程 Geist 导入及变量注入，根布局保留 `antialiased`，继续使用 `globals.css` 的中英文字体栈。 |
| 回归 | 先红后绿：新增 `root-layout-font-contract.test.ts`，修复前断言失败；修复后通过。`pnpm ts-check`、`pnpm lint --quiet` 通过，`pnpm build` 于 2026-07-18 退出码 0。 |
| 状态 | 本地已修复并验证，已随 `6c2185c` 推送；待云端同步验证。 |

## 2026-07-18 BUG-20260718-013：SSE 断开时图像生成轮询绕过节流

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 无限画布图像生成、任务轮询与积分安全 |
| 环境 / 前置条件 | 云端预览、Chrome 已登录 `Mr.joker`；模型 `doubao-seedream-5-0-lite`，单张 `1:1` 任务 `async-1784381325092-zkypoi`。 |
| 稳定复现 | 提交真实生成后，任务稳定处于 `processing / 10%`。网络证据记录至少 79 次 `POST /api/poll-task`，相邻请求间隔约 76–269ms；每次均为业务成功 JSON，但状态仍是 `processing`。 |
| 预期 / 实际 | 预期在 SSE 断开时按模型估算时间执行正常轮询间隔（本任务应为 800ms），并仅在终态 SSE 事件到达时提前唤醒。实际为 SSE 未连接分支立即 resolve，循环跳过定时器，形成高频轮询。 |
| 根因 | 两处图像生成循环均以 `Promise.race` 等待计时器或 SSE；当 `taskEventsClient.isConnected()` 为 false 时，SSE promise 同步完成，导致 race 立即返回。 |
| 修复 | 两处循环统一调用 `waitForTaskPollInterval`。该帮助器在 SSE 未连接时只等待计时器，在连接时仅由匹配任务的 `completed`、`failed`、`cancelled` 事件提前结束。 |
| 回归 | 先红后绿：新增 `src/__tests__/components/page-task-polling-wiring.test.ts`，修复前因页面未接入 helper 失败；修复后与 `src/__tests__/lib/task-polling-wait.test.ts` 共 3/3 通过。`pnpm ts-check`、`pnpm lint --quiet` 已通过；全量回归待本次提交前执行。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-generation-polling-busy-loop-20260718.png`、`test-results/network/cloud-p1-generation-polling-busy-loop-20260718.json`、`test-results/console/cloud-p1-generation-polling-busy-loop-20260718.json`。本地修复完成，待推送、云端同步及真实间隔复验；未关闭。 |

### 云端恢复链路复验更新

历史任务 `async-1784362294335-88ydio` 已由云端 `POST /api/poll-task` 返回 `completed / 100%`，并返回可访问的生成图地址；重新打开项目可见蓝色立方体结果。积分概览同时出现一次 `-6` 的 `doubao-seedream-5-0-lite` 流水，余额和累计消耗各精确变化 6。该证据关闭 BUG-20260718-010、BUG-20260718-011 与 BUG-20260718-012 的“历史任务恢复、持续轮询和单次结算”范围；不替代 BUG-20260718-013 的节流复验，也不替代新任务的终态验证。

## 2026-07-18 BUG-20260718-012：恢复任务仅轮询一次

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 无限画布图像生成恢复 |
| 稳定复现 | 云端 `f9a2835` 重新打开含 `async-1784362294335-88ydio` 的项目。恢复接口返回该任务后，首次 `/api/poll-task` 业务成功并返回 `processing / 10%`；页面随后保持 `processing 10%`，未继续发出 `/api/poll-task`。 |
| 根因 | 恢复轮询 effect 依赖 `images`。首次轮询更新进度会触发 React 清理函数，将局部 `cancelled` 设为 true；任务 ID 已被记入已启动集合，新 effect 又跳过该任务，因此循环只执行一次。 |
| 修复 | 使用项目级 generation token 作为唯一取消边界，不再因进度刷新取消轮询；任务 ID 集合仍保证同一任务只启动一个循环。 |
| 回归 | 先红后绿：`src/__tests__/lib/resumed-task-polling.test.ts` 2/2 通过；`pnpm ts-check` 与 `pnpm lint --quiet` 通过。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-recovery-f9-processing-stall-20260718.png`、`test-results/network/cloud-p1-recovery-f9-network-20260718.json`、`test-results/console/cloud-p1-recovery-f9-processing-stall-20260718.json`。待推送和云端终态复验，未关闭。 |

### 云端复验更新（`c7ee167`）

恢复同一任务后，浏览器连续发出至少 3 次 `/api/poll-task`，证明“仅轮询一次”已修复；但每次均收到 `502 {"detail":"无法连接到后端服务"}`，页面保持 `processing 10%`。这是云端网关到后端服务的可用性阻塞，尚不能判定供应商结果、任务终态或退款。证据：`test-results/screenshots/cloud-p1-recovery-c7ee167-gateway-502-20260718.png`、`test-results/network/cloud-p1-recovery-c7ee167-gateway-502-20260718.json`、`test-results/console/cloud-p1-recovery-c7ee167-gateway-502-20260718.json`。

## 2026-07-18 BUG-20260718-011：重开画布后任务无法恢复

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 无限画布图像生成恢复 |
| 稳定复现 | Chrome 云端项目刷新并重新打开后，真实待处理占位框保持 `submitting 5%`，浏览器没有发出 `/api/poll-task` 请求。 |
| 根因 | 占位框未持久化后端返回的 `taskId`；生成请求也未传递 `projectId`，因此恢复 API 无法关联旧云端任务和画布。 |
| 修复 | 首轮轮询前持久化每个 `taskId`；提交携带 `projectId`；恢复接口仅返回脱敏字段；旧无归属任务仅在提示词和规范化模型完全一致且唯一时绑定。 |
| 安全约束 | 歧义、缺少提示词或模型、失败、取消的任务均不猜测或绑定。 |
| 回归 | 先红后绿：`canvas-task-placeholders.test.ts`、`legacy-task-recovery.test.ts`、`page-task-placeholder-persistence-contract.test.ts`、`task-recovery-route-contract.test.ts`；全量 121 文件 / 504 用例通过。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-recovery-not-resumed-20260718.png`、`test-results/console/cloud-p1-recovery-not-resumed-20260718.json`。本地修复已验证，待云端部署复验。 |

## 2026-07-18 BUG-20260718-010：submitOnly 恢复任务类型错误

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 无限画布图像生成、云端任务恢复、积分结算 |
| 稳定复现 | Chrome 已登录 `Mr.joker` 会话选择 `doubao-seedream-5-0-lite`、`1:1`、`x1`，提交“蓝色玻璃立方体”。外层任务 `async-1784362294335-88ydio` 保持 `submitting 5%`，连续 4 次 `/api/poll-task` 返回业务错误 `查询任务状态失败: 400`。 |
| 实际 / 根因 | `submitOnly` 任务持久化时未传 `type: 'generate-async'`，恢复分支仅对该类型重新提交供应商任务；错误类型被当作普通远程任务，导致将本地 `async-*` 包装 ID 发给供应商轮询。 |
| 修复 | `src/app/api/generate/route.ts` 明确持久化 `generate-async`；`src/app/api/poll-task/route.ts` 以“有恢复载荷且远程 ID 仍等于外层 ID”为恢复条件，并把旧记录兼容注册为 `generate-async`。 |
| 回归 | 先红后绿：`src/__tests__/lib/async-generate-task.test.ts`、`generate-idempotency-contract.test.ts` 与 `poll-task-recovery-lease-contract.test.ts` 共 17/17 通过；`pnpm ts-check` 通过；目标 ESLint 为 0 error / 36 个历史 warning。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-submitonly-credit-submitted-20260718.png`、`cloud-p1-submitonly-credit-poll-error-20260718.png`、`test-results/network/cloud-p1-submitonly-credit-poll-diagnostics-20260718.json`。待云端部署后恢复当前已扣费任务并复验新任务的 -6 流水，未关闭。 |

## 2026-07-18 云端 P0 真实验证补充

| ID | 等级 | 模块 | 状态 | 证据与结论 |
| --- | --- | --- | --- | --- |
| BUG-20260718-001 | P2 | Chrome 自动化适配 | 已定位，非业务代码缺陷 | 云端图片顶部工具栏的 `删除` DOM 绑定为 `onImagesChange(images.filter(...))`；Chrome 扩展自动化执行该按钮点击两次均命中相邻的“美陈拆解”。此现象记录为浏览器自动化坐标/缩放适配风险，不能作为产品删除功能失败。键盘 `Delete` 的即时删除已另由 BUG-20260718-004 跟踪其持久化回流问题。截图：`test-results/screenshots/cloud-p0-delete-opens-display-decompose-20260718.png`。 |
| BUG-20260718-002 | P2 | 云端控制台质量 | 待后续处理 | 云端开发预览出现 React hydration mismatch 与 `DashboardView` 缺少列表 key 的 Console Error；账户菜单还显示“加入于 Invalid Date”。Hydration 信息来源于 Coze Console Bridge，不能在无独立浏览器复现前归因为产品；`DashboardView` key 和日期展示均需后续修复。证据：`test-results/console/cloud-p0-real-logout-20260718.json`。 |
| BUG-20260718-003 | P1 | 工作流执行鉴权 | 已修复并在云端复验 | GitHub `16c5900` 的 `requireApiAuthOrReject` 已部署。对当前预览地址匿名 `POST /api/workflow/execute`（`action=status`、虚拟 `executionId`）返回 `401 {"error":"Authentication required"}`；认证已先于业务查询执行。 |
| BUG-20260718-004 | P2（观察项） | 无限画布删除持久化 | 未稳定复现，持续观察 | 首次隔离项目中曾观察到：1×1 PNG 经 `Delete` 后，在后续生成和刷新后回流。2026-07-18 第二个全新隔离项目按相同步骤执行“粘贴 32×32 PNG → `Delete` → 粘贴 256×256 PNG → 真实生成 → 返回项目列表 → 重新打开”后，项目稳定为 256×256 上传图与 2048×2048 生成图两张，已删除的 32×32 图未回流。该异常尚不能作为稳定产品缺陷或触发猜测性修复。证据：`cloud-p0-generation-submitted-20260718.png`、`cloud-p0-project-restored-20260718.png`、`cloud-delete-repro-before-reload-20260718.png`、`cloud-delete-repro-after-reopen-20260718.png`、`cloud-delete-repro-after-reopen-20260718.json`。下一步：用独立浏览器/凭据重复该序列；仅在稳定复现后，先添加失败回归测试再定位竞争写入。 |
| BUG-20260718-005 | P1 | 管理员新建用户登录 | 本地已修复，待云端部署复验 | 管理员界面创建启用的普通用户后，以无限画布入口登录，真实云端 `POST /api/auth/login` 在请求含 `productType: "canvas"` 时稳定返回 `401`；移除该字段即返回 `200`。跨 Chromium、Firefox、WebKit 与移动 Chromium 的 `p0-auth-session` 自动化均在同一点失败。证据：`test-results/screenshots/cloud-e2e-account-created-20260718.png`、`test-results/console/p0-auth-session-*.json`、`test-results/network/p0-auth-session-*.json`、Playwright trace/video。 | 根因：登录页始终提交当前产品入口；`createManagedUser` 未收到产品字段时持久化为空，认证层将其判定为无画布权限。修复：`src/lib/server-auth.ts` 对未指定产品权限的新建用户默认写入 `canvas,chat`，显式空值仍保留禁用语义。新增 `server-auth-production-security.test.ts` 回归用例，先红后绿；云端需同步后新建独立账号复验。 |
| BUG-20260718-006 | P1 | 普通用户会话控制台错误 | 本地已修复，待云端部署复验 | 修复 BUG-005 后创建新的真实普通用户，`p0-auth-session` 在 Firefox 通过，但 Chromium、WebKit 和移动 Chromium 均稳定在 Console 出现两次 `/api/admin/user-folder` 的 `401`。网络日志证明登录、用户数据同步、刷新和退出均成功；失败仅来自客户端越权请求。 | 根因：`UserManager` 对普通用户登录、服务端用户写回及本地创建无条件调用管理员专用的建目录端点。修复：移除客户端建目录副作用；服务端 `createManagedUser` 继续负责管理员创建用户时的目录初始化。新增 `user-manager-admin-folder.test.ts`，先失败后通过。 |

## 规则

每个缺陷先有稳定复现与证据，再做最小范围修复；修复后必须保留失败回归用例并执行模块和全量回归。严重级别：P0（安全/数据/核心不可用/错误扣费）、P1（核心链路失败）、P2（特定场景功能问题）、P3（UI/文案/轻微交互）。

## 2026-07-18 BUG-20260718-015：已恢复的图像任务被本地任务分支永久拦截

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 无限画布图像生成、任务恢复、积分结算 |
| 环境 / 前置条件 | 云端预览 `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`；Chrome 已登录 `Mr.joker / 管理员`；`api_1778430731224_533e09a::doubao-seedream-5-0-lite`、`1:1`、`x1`。 |
| 稳定复现 | 真正提交一张付费 Lite 图像后，画布持续显示 `processing 10%` 超过 5 分钟；刷新页面后回到项目列表，进行中任务未在当前画布自动呈现终态。 |
| 根因 | `/api/poll-task` 恢复分支已将供应商真实任务 ID 持久化到 `generate-async` 包装任务，但下游 `LOCAL_TASK_TYPES` 将所有 `generate-async` 直接返回本地进度，阻止后续对供应商的真实轮询。 |
| 修复 | 新增 `shouldPollRemoteAsyncGenerateTask`：仅无真实远端任务 ID 的包装任务走本地等待；已恢复并含真实远端 ID 的任务继续进入通用供应商轮询、终态持久化与积分路径。 |
| 回归 | 先红后绿：`async-generate-task.test.ts` 和 `poll-task-recovery-lease-contract.test.ts` 新增断言，修复前 2 项失败、修复后定向 19/19 通过；`pnpm test:api` 36 文件 / 89 用例、`pnpm test`、`pnpm ts-check`、`pnpm lint --quiet` 均通过。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-lite-generation-stuck-after-cloud-update-20260718.png`、`test-results/console/cloud-p1-lite-generation-stuck-after-cloud-update-20260718.json`。本地修复待推送和云端同步后的真实付费任务复验；不得关闭。 |

## 2026-07-18 INFRA-20260718-008：默认生产构建超时

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 发布构建门禁 |
| 复现 | 当前依赖升级后的 `pnpm build` 在 244 秒内没有产生完成结果，命令由测试超时终止。 |
| 影响 | 未获得当前工作树的默认生产构建成功证据，不能作为可发布版本。 |
| 根因 / 修复 | `build` 脚本把依赖安装和构建混为同一步，安装阶段阻塞后从未进入 Next 构建。新增 `build-command-contract.test.ts`，并将脚本改为纯 `next build`；依赖安装应在构建前显式执行。 |
| 回归 / 状态 | 先红后绿：脚本契约修复前失败、修复后通过；`pnpm build` 在 85.2 秒完成 97 个页面，退出码 0。构建仍有 5 条 Turbopack NFT 动态文件追踪 warning 与 2 条 Node 本地存储路径 warning，未阻断但需后续收敛。 |

## 2026-07-18 BUG-20260718-016：认证初始化被项目同步无限阻塞

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 云端首页、会话恢复、项目同步 |
| 稳定复现 | 云端 Chrome 预览页刷新后，完整画布已渲染但固定身份遮罩“正在验证身份...”在 30 秒内不消失，用户无法操作。此前页面还出现过 `Internal Server Error`；同一时段无 Cookie 的远程 `/api/auth/me` 健康探针可返回 200。 |
| 根因 | 会话成功后 `upsertUserFromServer` 串行等待项目同步；该同步请求无超时，且页面启动阶段再次等待同一同步。任何云端同步请求挂起都会使 `authChecked` 永远为 false。 |
| 修复 | 项目同步请求使用 8 秒 `AbortSignal.timeout`、默认只重试一次；认证启动移除第二次阻塞式同步。失败仍保留既有本地项目回退和 30 秒周期同步。 |
| 回归 | 先红后绿：新增 `auth-bootstrap-project-sync-contract.test.ts` 两项断言。定向 5/5、全量 127 文件 / 515 用例、`pnpm ts-check`、`pnpm lint --quiet`、`pnpm build`（97 页面）均通过。 |
| 状态 | 本地修复待推送和云端 Chrome 刷新复验；不能因页面底层 DOM 已出现而标记为通过。证据：`cloud-p0-auth-verification-stuck-20260718.png`、同名 Console JSON。 |

### 2026-07-18 云端复验更新

真实 Chrome 已登录会话在部署预览地址刷新后仍显示固定遮罩 `正在验证身份...`。针对该明确 UI 状态连续等待约 21 秒仍未完成；底层无限画布和生成面板虽已渲染，所有操作仍被遮罩阻止。控制台仅包含 Coze Console Bridge 的 parent-origin 警告，未出现应用 JavaScript error。Chrome CDP 网络观察通道未捕获认证或项目同步请求，不能据此判断接口成功或失败。该结果不能关闭 BUG-20260718-016，也不能进行会消耗积分的生成测试。

新增证据：`test-results/screenshots/cloud-p1-auth-overlay-still-blocking-after-0290bdc-20260718.png` 与 `test-results/console/cloud-p1-auth-overlay-still-blocking-after-0290bdc-20260718.json`。需要确认云端实际构建包含 Git 提交 `0290bdc`，随后重新执行已登录 Chrome 复验。

### 2026-07-18 本地二次修复

根因进一步收敛为：即便同步请求设置了超时，`upsertUserFromServer()` 仍同步等待它完成，认证遮罩仍会受项目同步、重试或响应体读取阻塞。修复将项目同步改为后台启动，保留 8 秒请求上限，并给后台结果增加账户 ID 防护，防止延迟的旧账户同步覆盖当前账户。画布登录回调中重复的同步等待已移除。

回归：先新增失败约束，再通过 `auth-bootstrap-project-sync-contract.test.ts` 和 `user-manager-admin-folder.test.ts` 的 5 项定向测试；其中包含“同步 Promise 未解决时登录立即返回”的行为测试。`pnpm ts-check`、`pnpm lint --quiet`、全量 `pnpm test` 与 `pnpm build` 均已通过。此修复仍必须在云端 Chrome 中复验遮罩消失后，才可关闭 BUG-20260718-016。

### 2026-07-18 云端部署后二次复现与第三次修复

云端静态资源已确认含认证与项目同步解耦补丁，但已登录 Chrome 刷新后认证遮罩仍连续约 21 秒可见。控制台仍只有 Coze Console Bridge parent-origin 警告，未给出应用异常；这证明项目同步不是唯一阻塞点。

进一步根因：认证初始化最先调用的 `/api/auth/me` 没有超时。即使后续同步不再阻塞，只要该请求或响应体停住，`authChecked` 永远不会置为完成。修复为认证探针加入 8 秒 `AbortSignal.timeout`，保留现有 catch 分支的会话清理和登录页降级。新增失败回归 `bounds the authenticated-session probe so a hung response cannot keep the UI blocked`，修复后 `auth-bootstrap-project-sync-contract.test.ts` 4/4、`pnpm ts-check` 和 `pnpm lint --quiet` 通过。

新增证据：`test-results/screenshots/cloud-p1-auth-overlay-still-blocking-after-69da406-20260718.png`、`test-results/console/cloud-p1-auth-overlay-still-blocking-after-69da406-20260718.json`。必须在包含本次修复的新云端构建中复验遮罩消失，之后才可提交真实生成任务。

### 2026-07-18 Chrome 客户端拦截复现与第四次修复

`wujie_session` Cookie 在云端预览域名中仍有效（未读取 Cookie 内容），但在同一已登录 Chrome 中直接访问 `/api/auth/me` 与 `/api/connector/auth/me` 都稳定返回 `net::ERR_BLOCKED_BY_CLIENT`。随后画布页面固定显示“正在验证身份...”，模型下拉框为空；底层组件虽渲染，但遮罩使其不可操作。这说明此前的 8 秒超时并不能规避当前浏览器客户端对认证路径的拦截。

最小修复：新增同源只读 `/api/session`，直接复用既有会话处理器；画布认证、独立智能对话页与任务 SSE 的会话预检全部改用该中性路径。先红后绿：`auth-bootstrap-project-sync-contract.test.ts` 与 `task-events-client.test.ts` 定向 7/7 通过。待完整门禁和云端 Chrome 部署复验后才可关闭 BUG-20260718-016。新增证据：`test-results/screenshots/cloud-p1-image-model-options-empty-after-auth-20260718.png`、`test-results/console/cloud-p1-image-model-options-empty-after-auth-20260718.json`。

### 2026-07-18 会话请求悬挂根因与第五次修复

云端已部署 `/api/session` 且静态前端资源已引用该路径，但已登录 Chrome 刷新后遮罩仍持续存在。Chrome CDP 记录到主页和静态资源请求，却没有任何页面内 `/api/*` 会话请求；运行时资源记录也为空。结合此前 `ERR_BLOCKED_BY_CLIENT`，这证明当前浏览器环境可在请求到达网络层前令 `fetch` 长期悬挂，单独使用 `AbortSignal.timeout` 不能保证 Promise 结算。

修复：新增 `fetchSessionPayload`，通过独立计时器将“请求 + JSON 解析”整体置入 `Promise.race`，超时时主动 abort 并拒绝，确保页面必然关闭认证加载态。画布、独立智能对话页和 SSE 会话预检共用该实现。先红后绿：新增 `auth-session.test.ts` 用永久悬挂的 `fetch` 复现，定向 8/8 与类型检查通过。云端仍需同步此修复并以 Chrome 重新验证。新增证据：`test-results/screenshots/cloud-p1-auth-overlay-no-session-network-before-fetch-race-20260718.png`、`test-results/console/cloud-p1-auth-overlay-no-session-network-before-fetch-race-20260718.json`。

### 2026-07-19 客户端缓存水合解耦

部署会话超时修复后，页面内 `/api/session` 在当前 Chrome 中可真实返回 `200` 且包含已登录用户，但遮罩仍存在。认证路径仍在首次渲染前 `await userMgr.upsertUserFromServer(data.user)`；这把仅用于本地项目缓存的水合置于会话可操作性之前。

首次部署后云端遮罩仍存在，进一步确认无项目入口在状态提交前仍同步调用 `UserManagerCore.getInstance()`；当前用户的大型本地画布缓存可使该初始化阻塞 React 对 `authChecked` 的提交。将调用包进 `setTimeout(0)` 后，真实 Chrome 仍在 12 秒内保持遮罩，证明依赖同一认证 effect 的事件循环时序不足以构成通过证据。缓存水合被拆至独立 effect 后，Chrome 网络记录仍没有应用自身的 `/api/session` 请求；认证请求超时后的失败分支还会同步执行 `UserManagerCore.getInstance().logout()`，同样会在 `setAuthChecked(true)` 前卡住。

修复：无 `projectId` 的正常入口立即使用服务端用户设置 `currentUser`、`authChecked` 和工作台视图，不在认证 effect 中创建 `UserManagerCore`。新增独立的已认证后 effect，待工作台实际渲染后再创建管理器并水合项目缓存；认证失败时也先设置未登录 UI 与 `authChecked`，再在独立 effect 中异步清理本地会话。带 `projectId` 的恢复流程仍保持原有完整水合语义。先红后绿：`auth-bootstrap-project-sync-contract.test.ts` 新增“无项目会话先可交互、缓存水合和失败清理均位于独立认证后 effect”约束；与 `auth-session`、用户同步测试共 9/9 通过，类型检查通过。待完整门禁与云端 Chrome 部署复验。新增云端证据：`test-results/screenshots/cloud-p1-auth-after-fetch-race-20260719.png`。

### 2026-07-19 已部署复验：客户端水合仍未开始

提交 `1713ab6` 已由云端 `src_app_page_tsx_1gecvfk._.js` 资源确认包含本次认证清理代码；页面和所有已观察到的 Next chunk 均返回 `200`。已登录 Chrome 中，直接同源调用 `/api/session` 返回 `200`、`success: true` 且含用户 ID。尽管接口与补丁均可用，页面仍保留一个可见的“正在验证身份...”遮罩；刷新网络记录没有应用自身的 `/api/session` 请求，DOM 也没有 React hydration attachment。该证据表明本次阻塞位于云端客户端启动/水合阶段，而不是会话 API、项目同步或本地缓存清理。

本轮不进行猜测性业务代码改动。下一步必须先针对“页面 bundle 成功加载但 React 水合未开始”建立最小、可自动验证的复现路径，或获取云端运行时的启动日志；在此之前 BUG-20260718-016 保持 P1 未关闭。证据：`test-results/screenshots/cloud-p1-auth-overlay-1713ab6-deployment-check-20260719.png`、`test-results/console/cloud-p1-auth-overlay-1713ab6-deployment-check-20260719.json`。

### 2026-07-19 独立匿名 Chromium 最小复现

使用云端地址运行 `E2E_BASE_URL=<preview> pnpm exec playwright test tests/e2e/p0-login-ui-contract.spec.ts --project=chromium`，不使用账号、不给服务端写入数据。测试在等待“选择入口”5 秒后失败；失败截图仍是“正在验证身份...”。Playwright 的可访问性快照显示完整服务端渲染的无限画布、工具栏与生成面板，但没有登录入口；网络证据只记录字体请求，没有应用 `/api/*` 请求；Console 仅有 Coze Console Bridge 的 parent-origin 警告以及 `[HMR] connected`。这稳定证明故障不依赖当前已登录 Chrome 会话，也不是 API 返回业务失败。

失败产物已通过 `pnpm test:artifacts` 归档，ID 为 `20260719-cloud-anonymous-hydration-failure`，包含截图、视频与 Trace；运行时原始附件仍保留在 `.playwright-output/`。此失败测试必须保持可见，直到云端匿名入口和已登录会话均完成水合并通过后才可关闭 BUG-20260718-016。

### 2026-07-19 本地同提交对照

使用相同工作树与相同 `tests/e2e/p0-login-ui-contract.spec.ts`，在本地 `next dev --port 5012` 完成 Chromium、Firefox、WebKit 与移动 Chromium 的 4/4 通过（单 worker 串行，约 30.4 秒）。该对照不使用云端账号、API Key 或 Mock，证明当前源码的匿名认证入口在标准 Next 运行时能够完成客户端水合并显示登录界面。

因此本 BUG 的当前归因收敛为：Coze 预览运行环境与页面客户端启动的集成问题。云端首页额外加载 `coze-space/page-editor-general-web`、Console Bridge、History Bridge 等注入脚本，而本地同一 Next 运行时不加载这些脚本。此差异是后续云端运行时日志/平台配置排查的首要方向；不得据此关闭 P1，也不得将本地通过结果替代云端验收。

配置审计补充：当前地址为 `.dev.coze.site`，项目 `.coze` 的 `[dev]` 配置执行 `pnpm run dev`，即 `next dev -p 5000`；只有 `[deploy]` 配置才执行 `pnpm run build` 与 `pnpm run start`。所以本次已稳定复现的是**开发预览**客户端启动阻塞。正式部署必须另行给出可访问地址并从干净会话执行完整 P0 验收；开发预览恢复前也不能用于后续真实积分测试。

## 2026-07-18 云端部署复验结案补充

| Bug ID | 云端复验 | 结果 | 证据 | 结案范围 |
| --- | --- | --- | --- | --- |
| BUG-20260718-005 | 新建的独立普通账号，以 `canvas` 产品入口完成登录、刷新与退出 | 已修复并云端通过，四浏览器 4/4 通过 | 归档 ID `20260718-p0-auth-session-cloud-green`；`test-results/screenshots/p0-auth-session-*.png`；同名 Console/Network JSON；`playwright-report/index.html` | 默认 `canvas,chat` 产品权限已在云端生效；不代表旧账号的显式权限配置被迁移。 |
| BUG-20260718-006 | 同一独立普通账号完成登录、刷新与退出，并审查 Console/Network | 已修复并云端通过，四浏览器 4/4 通过 | 同上；Network 未出现 `/api/admin/user-folder` 401，Console 无 error | 普通用户会话不再调用管理员目录端点；不替代其他业务模块的权限回归。 |

## 2026-07-18 测试基础设施风险

| ID | 等级 | 模块 | 状态 | 根因、修复与回归 |
| --- | --- | --- | --- | --- |
| INFRA-20260718-001 | P1 | P0 真实图像生成 E2E | 已修复，真实生成待授权执行 | 云端图像模型下拉框中存在跨供应商的同名显示标签，原用例使用 `selectOption({ label })`，可能静默选择 FHL、虚宝或其他同名提供商，导致测试结果不能证明目标供应商。修复为只接受精确的 `providerId::modelId` 选项值并使用 `selectOption({ value })`；非复合值立即失败。`pnpm ts-check` 与 `pnpm exec playwright test tests/e2e/p0-core.spec.ts --list` 于 2026-07-18 通过。 |

## 当前登记

| Bug ID | 级别 | 模块 | 状态 | 复现与证据 | 根因/修复 | 回归结果 |
| --- | --- | --- | --- | --- | --- | --- |
| BUG-20260717-001 | P1 | 节点编辑器 | 已修复，待云端回归 | 真实Chrome拖动节点后 React 报错“Cannot update a component while rendering a different component”；提交 `da4c37e` 前本地复现 | `setWf` updater 中同步调用父组件状态更新；改为 revision effect 延迟同步 | 云端拖动复测无 React warning；仍需纳入本轮统一证据 |
| BUG-20260717-002 | P1 | 工作流执行授权 | 已修复并云端通过 | 云端匿名 `POST /api/workflow/execute`（`action=status`、虚构 executionId）此前返回 `400 {"error":"缺少 executionId"}`，证明认证检查未先于业务参数检查执行 | `src/app/api/workflow/execute/route.ts` 改用 `requireApiAuthOrReject`；`high-risk-route-auth-contract.test.ts` 先失败后通过 | 目标测试、`pnpm ts-check`、`pnpm lint --quiet`、483/483 测试及生产构建通过；2026-07-18 云端匿名请求固定返回 401 |
| BUG-20260717-003 | P2 | 退出登录后的操作审计 | 云端实测通过，仍有独立浏览器回归项 | 四浏览器匿名入口实测的 Console/Network 证据中，`POST /api/auth/logout` 后出现 `POST /api/activity` 的 401；根因是全局 fetch 审计在会话清除后仍记录退出请求 | `shouldAuditClientRequest('/api/auth/logout', 'POST')` 先失败；排除 `/api/auth/` 和 `/api/connector/auth/` 的客户端二次审计，避免无会话审计请求 | `operation-audit.test.ts` 通过；2026-07-18 已登录云端会话退出后页面回到“选择入口”，归档 Console 未见 `/api/activity` 或 401；仍需独立浏览器 Network trace 作为正式多浏览器回归证据 |
| INFRA-20260717-001 | P1 | 多浏览器E2E | 已排除 | 安装阶段曾提示 Windows WebKit 运行库缺失 | 随后 `pnpm test:e2e:p0` 已实际启动 WebKit 项目并执行到环境前置检查，说明该提示未阻断当前浏览器启动 | 不作为发布阻塞；WebKit真实业务流程仍待凭据后验证 |
| INFRA-20260717-002 | P1 | Chrome上传自动化 | 已定位为控制通道限制，待独立浏览器复验 | 已登录云端项目中，底部“图片上传”按钮已触发选择链路；2026-07-18 再次使用 48×32 无敏感 PNG 时，失败点固定在控制通道的 `fileChooser.setFiles`，返回 `Not allowed`，未到达上传业务请求 | 当前 Chrome 扩展会话不允许自动写入原生文件选择器；尚未形成业务缺陷复现 | 用独立 Playwright 浏览器或人工录屏执行相同入口，再判断产品上传是否通过；证据：`cloud-p0-native-upload-not-allowed-20260718.png`、`cloud-p0-native-upload-not-allowed-20260718.json` |
| INFRA-20260717-003 | P1 | 依赖漏洞扫描 | 阻塞 | `pnpm audit --prod --json` 的镜像审计端点不存在；官方端点请求超时 | 注册表/网络不可用，未获得漏洞清单 | 恢复可用审计端点后重新扫描；不得视为零漏洞 |
| INFRA-20260717-004 | P2 | P0 多浏览器测试隔离 | 已缓解，持续观察 | 首次四项目并发执行时 Chromium 进入已认证画布而其余浏览器显示登录入口；Chromium 单独重复 3 次和单 worker 四浏览器复验均通过，未形成稳定产品复现 | 真实账号和项目的多浏览器并发会放大云端会话、localStorage 或异步认证状态竞争 | Playwright 默认 `workers=1`，顺序执行四浏览器；下一次携带真实凭据的 P0 全链路需验证不再出现跨浏览器状态污染 |
| INFRA-20260717-005 | P2 | Playwright 产物与 ESLint | 本地已修复 | 生成 `playwright-report/` 后，`pnpm lint --quiet` 扫描第三方压缩报告代码并报 159 项错误 | `eslint.config.mjs` 未忽略 Playwright 报告和测试证据目录 | 精确忽略 `playwright-report/**`、`test-results/**`；重新执行 `pnpm lint --quiet` 通过，源码和测试目录仍受检查 |
| INFRA-20260717-006 | P2 | Playwright 证据留存 | 本地已修复 | `outputDir=test-results` 会在每次 Playwright 执行前清理前一轮视频和 Trace，导致审计证据被覆盖 | 临时运行产物和长期归档共用一个目录 | 临时输出改为 `.playwright-output/`，归档脚本以运行 ID 将视频/Trace/截图复制到 `test-results/`；四浏览器重跑后新增 12 个归档文件且此前 Chromium 登录失败证据仍保留 |

## 新缺陷模板

| 字段 | 内容 |
| --- | --- |
| Bug ID / 标题 / 等级 |  |
| 模块 / 环境 / Git Commit / 浏览器 |  |
| 前置条件 / 精确复现步骤 |  |
| 预期结果 / 实际结果 |  |
| 截图 / 视频 / Trace / Console / Network / 服务端日志 |  |
| requestId / taskId |  |
| 根因 / 修复文件 / 修复方案 |  |
| 新增测试 / 回归结果 |  |

## 2026-07-19 Resume Verification

### INFRA-20260719-002: Cloud preview root and authentication endpoints return HTTP 502

| Field | Detail |
| --- | --- |
| Severity / module | P1 / Coze preview backend or gateway availability |
| Environment | Preview URL `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`; source commit `95b9afd` |
| Reproduction | Run `pnpm run doctor -- --url=<preview>` and issue unauthenticated read-only GET requests to `/`, `/api/auth/me`, and `/api/session`. |
| Actual | Doctor received HTTP 502 from `/api/auth/me`; each independent endpoint probe also returned HTTP 502. |
| Evidence | `test-results/network/cloud-health-502-20260719.json` |
| Scope decision | External deployment blocker. No source-level change is justified until the preview backend is reachable and the application request/response chain can be observed. |
| Required recovery evidence | Root returns 200, `/api/auth/me` returns 200 or 401, `/api/session` returns a valid session response in the logged-in Chrome profile, then repeat P0 and BUG-20260719-019 browser regression. |

### 2026-07-19 Cloud recovery observation (not a defect record yet)

| Field | Evidence |
| --- | --- |
| Environment | Coze development preview, authenticated `Mr.joker` administrator Chrome session, source commit `6592e9b` |
| Reproduction | Open a persisted image project, reload the page, then inspect the restored dashboard and browser console. |
| Observed | Authentication persisted and the project card with its `55 张图片` count returned. The preview navigated to the project dashboard rather than restoring the active canvas. Two `loadProjectsFromServer` timeout errors were emitted by the Coze Console Bridge. |
| Classification | Investigation only. The project data was present after reload, and the reported timeout source is a Coze-injected bridge. It is not yet a stable product defect or a basis for code changes. |
| Evidence | `test-results/screenshots/cloud-auth-session-refresh-20260719.png`; `test-results/console/cloud-auth-session-refresh-20260719.json` |

### BUG-20260719-019: Generated asset count regresses after logout and saved-credential relogin

| Field | Detail |
| --- | --- |
| Severity / module | P1 / cloud project and asset persistence |
| Environment | Coze development preview; Chrome session for `Mr.joker`; source commit `6592e9b` |
| Reproduction | Create a new project; select `api_1778430731224_533e09a::doubao-seedream-5-0-lite` (APImart imgae); submit one 1:1 image; wait for the canvas result; reload and reopen the saved project; log out; log in again with Chrome-saved credentials. |
| Expected | The persisted project and its generated asset remain consistent after a new authenticated session. The project and asset counters must not regress. |
| Actual | The completed result initially increased dashboard counters from 13 projects / 183 assets to 14 projects / 184 assets. After logout and successful relogin, the dashboard still reported 14 projects but only 183 assets. No browser console error was reported. |
| Evidence | `test-results/screenshots/cloud-p0-apimart-generation-success-20260719.png`; `test-results/screenshots/cloud-p0-relogin-asset-count-mismatch-20260719.png`; matching console JSON files. |
| Root-cause status | Unresolved. Do not change business code until a source-level persistence contract test reproduces the counter/result divergence. |
| Required regression | A failing integration test must cover creation, completed task persistence, fresh-session reload, project image count and asset-library count consistency. |

### BUG-20260719-019 resolution update

| Field | Detail |
| --- | --- |
| Root cause | `updateProject` used a two-second debounced server sync. `logout()` cancelled that timer and cleared the authenticated user without submitting the latest project payload. The dashboard could therefore show localStorage state before logout and stale server state after relogin. |
| Fix | `UserManager.logout()` now starts an immediate, keepalive-enabled project sync while the session is still valid, then clears the timer and local session state. |
| Regression | `src/__tests__/lib/user-manager-logout-sync.test.ts` was red before the change because no project-sync POST was sent. It is green after the change and asserts that the generated image is included in the submitted payload. |
| Cloud status | Source fix complete. The issue remains P1 pending a synchronised cloud Chrome run that repeats generate -> logout -> relogin and verifies that the asset count remains unchanged. |

#### 2026-07-19 real cloud recheck and root-cause refinement

| Field | Detail |
| --- | --- |
| Reproduction | Cloud health recovered (`/`, `/api/auth/me`, and `/api/session` returned 200). In Chrome, create a new project, generate one APImart `doubao-seedream-5-0-lite` 1:1 image, confirm the dashboard reaches 15 projects / 184 assets, then log out and log in with the Chrome-saved credential. |
| Actual | Relogin succeeded but the dashboard regressed to 15 projects / 183 assets. This is a stable real-user P1 reproduction, not an HTTP-only result. |
| Evidence | `test-results/screenshots/cloud-p1-persistence-submit-20260719.png`, `cloud-p1-persistence-generated-20260719.png`, `cloud-p1-persistence-relogin-regression-20260719.png`, and matching console JSON files. |
| Refined root cause | The first patch initiated `syncToServer(true)` but did not await it. `logout()` then immediately called `/api/auth/logout`; the remote session could be invalidated before the project-sync POST completed. |
| Follow-up fix | `UserManager.logout()` is now asynchronous and awaits the authenticated project sync before sending server logout. The canvas logout handler awaits `userMgr.logout()` before clearing UI state. |
| Permanent regression | `user-manager-logout-sync.test.ts` now holds the project-sync response pending and proves that `/api/auth/logout` cannot start until the sync resolves. It was red before the follow-up fix and green afterward. |
| Current status | Source follow-up fix is locally verified but not yet cloud-verified. The tested cloud bundle cannot be proven to contain this follow-up commit; rerun the exact Chrome flow after sync before closing P1. |

### BUG-20260719-021: First project cannot sync after an explicit empty server project response

| Field | Detail |
| --- | --- |
| Severity / module | P1 / project persistence for first-time users |
| Reproduction | A logged-in user receives `{ success: true, value: [] }` from `/api/user-data/sync?key=projects`, creates a first project, and waits for the normal sync debounce. |
| Actual | The empty-response branch returned success but left `_serverSyncReady` false, so the scheduled sync was blocked and the first project remained local-only. |
| Fix | Mark a successfully loaded empty project list as server-sync-ready. The branch does not upload or overwrite data by itself. |
| Regression | `src/__tests__/lib/user-manager-logout-sync.test.ts` was red with zero project-sync POSTs and is green after asserting that the first project is included in the POST payload. |
| Cloud status | Pending real first-project save/reload verification after deployment. |

### BUG-20260719-020: Account profile displays an invalid join date

| Field | Detail |
| --- | --- |
| Severity / module | P3 / account profile UI |
| Reproduction | Sign in as `Mr.joker`, open the profile menu from the dashboard avatar. |
| Expected | A valid formatted account creation date, or an explicit unavailable-state message. |
| Actual | The profile menu renders `加入于 Invalid Date`. |
| Evidence | Chrome DOM snapshot from the authenticated P0 run on 2026-07-19. |
| Root-cause status | Unresolved. Add a focused date-normalization test before changing the profile formatter. |

| Field | Evidence |
| --- | --- |
| Bug ID / severity | BUG-20260718-016 / P1 |
| Environment | Coze development preview `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`; logged-in Chrome session; source baseline `1713ab6` |
| Reproduction | Reload the preview, wait on the visible `正在验证身份...` overlay, then inspect the rendered DOM and same-origin session response. |
| Expected | Authentication initialization sends `/api/session`, then removes the overlay and permits canvas interaction. |
| Actual | The complete SSR canvas is present behind the overlay. After a 12 second state wait, the overlay remains visible. CDP same-origin `/api/session` returns `200`, `success: true`, and a user, but the reload network trace contains no application `/api/session` request. |
| Evidence | `test-results/screenshots/cloud-p0-auth-overlay-resumed-20260719.png`; `test-results/console/cloud-p0-auth-overlay-resumed-20260719.json` |
| Scope decision | No business-code change in this run. The evidence does not yet isolate a source-level defect: the session endpoint and bundled UI are reachable, while the preview client does not execute the authentication initialization fetch. |
| Regression status | Failed cloud P0 gate. Upload, generation, save/reload, download, and logout were not attempted because the overlay blocks user interaction. |

### 2026-07-19 Deployment Runtime Fix Pending Cloud Verification

The root-cause investigation found that `.coze` was introduced in `dc5983d` and explicitly ran the Coze preview with `pnpm run dev`. Its build phase only installed dependencies and did not create production output. The failing preview was the only environment that combined this development runtime with the three Coze-injected bridge scripts.

The minimal fix changes the `[dev]` runtime to `pnpm run build` followed by `pnpm run start`, matching the existing `[deploy]` server mode. `src/__tests__/scripts/coze-production-preview-contract.test.ts` was written first and failed against the old configuration, then passed after the change. `pnpm lint --quiet`, `pnpm ts-check`, and `pnpm run build` also passed. This is not a cloud closure: BUG-20260718-016 remains P1 until the synchronised preview completes a real Chrome reload without the authentication overlay.

### 2026-07-19 Deployment configuration correction

The subsequent Coze startup evidence reported `sh: 1: next: not found` while the `[dev]` section ran `pnpm run build` followed by `pnpm run start`. This invalidates the preceding runtime change as a deployment remedy: a preview build command cannot assume dependencies already exist. The corrected contract now installs the locked dependencies first with `pnpm install --frozen-lockfile`, then starts the development preview with `pnpm run dev`; the `[deploy]` section remains the only production `build` + `start` path. The revised contract test and a real `pnpm install --frozen-lockfile` completed successfully on the source workspace. Cloud adoption and an authenticated Chrome reload remain required before closing BUG-20260718-016.

### 2026-07-19 Preview runtime follow-up

The cloud home document was fetched again and the active `src_app_page_tsx_1gecvfk._.js` chunk contains the current `fetchSessionPayload()` and no-project `setAuthChecked(true)` code. The source is therefore deployed; the failing preview still runs `next dev` with Coze editor, Console Bridge, History Bridge, Next DevTools, and Turbopack/HMR injection.

The corrected minimal deployment fix replaces the two separate dev commands with `scripts/coze-preview-build.sh`. It performs `pnpm install --frozen-lockfile` and then `pnpm run build`; the `[dev]` run command is `pnpm run start`. The configuration test was red before this change and green afterward. On the source workspace, the locked install, production build, `ts-check`, `lint --quiet`, and 12 focused auth/config/logout tests passed. The production server also passed the anonymous login-entry E2E in Chromium, Firefox, WebKit, and mobile Chromium (4/4).

This is not a cloud closure. After synchronization, the existing Chrome session must reload without the authentication overlay and then repeat the project-persistence logout/relogin flow before BUG-20260718-016 or BUG-20260719-019 can close.

### BUG-20260719-017: Existing administrator rejected after redeploy when only a persisted auth secret exists

| Field | Detail |
| --- | --- |
| Severity / module | P1 / authentication and deployment persistence |
| Reproduction | Seed an active `Mr.joker` record and a valid `system/auth-secret`, set `COZE_PROJECT_ENV=PROD`, then omit `WUJIE_AUTH_SECRET` and `NEXTAUTH_SECRET`. Call `authenticateUser` with the matching password. |
| Expected | Existing accounts continue authenticating from the protected persisted secret; a first production deployment without any secret remains blocked. |
| Actual | `authSecret()` threw `Production authentication secret is not configured` before checking the persisted database/file secret, so the stored password hash was never verified. |
| Root cause | The production guard introduced in `796d84e` preceded the recovery branches despite the code's stated redeploy persistence contract. |
| Fix | Check environment, database and protected file secrets in that order; only throw after all three sources are absent. The known legacy static secret remains disallowed as a current signing secret. |
| Regression | `server-auth-production-security.test.ts` was first red with the exact persisted-account scenario, then green. `auth-login-configuration.test.ts` stays green, preserving the 503 response for a genuinely unconfigured first deployment. |
| Cloud status | Pending: the corrected source must be synchronised, then the existing Chrome `Mr.joker` account must complete a real login and refresh. |

### BUG-20260719-018: Windows line endings caused a false canvas-toolbar regression failure

| Field | Detail |
| --- | --- |
| Severity / module | P3 / regression test infrastructure |
| Reproduction | Run `canvas-toolbar-floating-windows.test.ts` from a CRLF checkout. The production source is unchanged from `200a30b`, but LF-only multi-line string assertions fail. |
| Root cause | The source reader compared raw file contents to LF-only literals without normalizing platform line endings. |
| Fix / regression | Normalize CRLF to LF in the test reader. The targeted six assertions and the complete `pnpm test:regression` suite pass after the change. |

## 2026-07-18 云端生成恢复与积分补偿

| 字段 | 记录 |
| --- | --- |
| Bug ID / 等级 | BUG-20260718-007 / P1 |
| 模块 | 无限画布图像生成、`submitOnly` 云端任务恢复、积分 |
| 环境 | 云端预览 `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`；Chrome 已登录管理员会话；本地提交基线 `1bf1386` |
| 稳定复现 | 新建隔离项目，选择精确值 `api_1778430731224_533e09a::doubao-seedream-5-0-lite`，比例 `1:1`、数量 `x1`，提交“红色玻璃立方体、白色背景”提示词。任务停在 `submitting 5%` 超过四分钟；刷新并从仪表盘重开项目后，同一占位任务仍停在该状态。 |
| 预期 / 实际 | 预期任务必须进入供应商提交、完成或明确失败并完成积分结算。实际外层 `async-*` 任务已持久化，但请求结束后 fire-and-forget 内部请求在云端运行时未继续执行，导致没有供应商任务 ID、没有终态。 |
| 证据 | `test-results/screenshots/cloud-p0-generation-stalled-20260718.png`；`test-results/console/cloud-p0-generation-stalled-20260718.json`。Console 仅有 Coze Console Bridge 警告，未将其误判为业务根因。 |
| 根因 | `src/app/api/generate/route.ts` 在 `submitOnly` 返回后依赖进程内后台 fetch；`src/app/api/poll-task/route.ts` 将外层本地任务直接视为“继续处理中”，无法从持久化请求恢复实际供应商提交。积分成本只在内存任务中保存，重启后失败/取消没有可靠退款依据。 |
| 修复文件 | `src/app/api/generate/route.ts`、`src/app/api/poll-task/route.ts`、`src/app/api/cancel-task/route.ts`、`src/lib/async-generate-task.ts`、`src/lib/cloud-task-persistence.ts`、`src/lib/cloud-task-storage.ts`。 |
| 修复方式 | 持久化经白名单过滤的提交参数与实际积分成本；默认禁用不可靠的进程内后台 worker；首个轮询请求取得持久化租约后恢复一次供应商提交，随后改用真实供应商任务 ID 轮询；恢复提交、供应商失败、空结果和跨重启取消均按持久化成本退款。退款在同一数据库 CTE 中原子更新任务状态、余额和退款流水，任务的 `credit_status='pending'` 只能被结算一次。 |
| 新增测试 | 先红后绿：`generate-idempotency-contract.test.ts`、`poll-task-recovery-lease-contract.test.ts`、`async-generate-task.test.ts`、`cloud-task-storage.test.ts`。定向 26/26 通过；全量 `pnpm test` 为 118 文件 / 494 测试通过；`pnpm ts-check`、全量 `pnpm lint --quiet` 与生产 `pnpm build` 均通过。 |
| 当前状态 | 本地修复完成，待推送、云端同步后使用当前 Chrome 已登录账号再次执行真实付费生成、刷新恢复和取消退款验证。未完成此项前不得关闭本 BUG 或宣布发布通过。 |

### 2026-07-18 云端复验更新（取代上表“当前状态”）

`9026dcc` 已同步到云端预览。使用 Chrome 中已登录的 `Mr.joker / 管理员` 会话，以精确模型值 `api_1778430731224_533e09a::doubao-seedream-5-0-lite`、`1:1`、`x1` 真实提交“红色玻璃立方体”任务。UI 先显示 `submitting 5%`，随后真实结果写入项目；浏览器刷新进入项目列表后，最新项目卡片显示结果缩略图；重新进入项目可见同一结果图、原始提示词、`doubao-seedream-5-0-lite`、`APImart imgae` 与 `2048 × 2048` 元数据。证据：`test-results/screenshots/cloud-p0-generation-stalled-after-9026dcc-20260718.png`、`test-results/screenshots/cloud-p0-generation-recovered-after-9026dcc-20260718.png`、对应 `test-results/console/` JSON。

BUG-20260718-007 的“任务恢复、完成和刷新恢复”范围已修复并云端通过；恢复失败退款和跨重启取消退款仍未验证，继续作为独立 P1 验证缺口，不能据此宣称积分补偿已通过。

| Bug ID | 等级 | 模块 | 状态 | 稳定证据 | 后续动作 |
| --- | --- | --- | --- | --- | --- |
| BUG-20260718-008 | P2 | DashboardView / SSR hydration | 已复现，待 P0/P1 关闭后修复 | 同一 Chrome 会话刷新项目列表三次均出现 React `Each child in a list should have a unique key`（`DashboardView`）及 hydration mismatch；不影响本次生成完成，但违反“无未处理 Console Error”发布门禁。 | 建立最小复现测试后，修正列表 key 与服务端/客户端不稳定属性；在 Chromium、Firefox、WebKit 回归。 |
| BUG-20260718-009 | P1 | 无限画布 `submitOnly` 图像计费 | 本地已修复，待云端付费回归 | Chrome 真实提交 `doubao-seedream-5-0-lite` 后生成结果已保存；积分规则页面明确该模型为每张 6 积分，但云端积分概览的最新流水仍停在 7 月 17 日，没有本次消费。静态数据流复现：`src/app/api/generate/route.ts` 在 `if (submitOnly)` 内持久化并返回任务，而 `consumeCredits` 位于该分支之后，无法执行。 | 将 `submitOnly` 的扣费放到同一分支内、持久化任务之前；将成本持久化到 `cloud_tasks`；持久化失败或并发冲突即时退款。先红后绿新增 `generate-idempotency-contract.test.ts`，定向 24/24 通过。云端同步后需以同一模型再跑一次，确认新增 -6 流水与余额变化。 |

### BUG-20260719-024: Image hover-toolbar delete action is occluded by display-decompose action

| Field | Detail |
| --- | --- |
| Severity / module | P1 / infinite canvas image selection and deletion |
| Environment | Coze preview, logged-in `Mr.joker` session, source baseline `b906a15` |
| Reproduction | Generate an image, reopen the persisted project, select the image, then click the visible hover-toolbar button whose title is `删除`. |
| Expected | The selected image is removed from the canvas. |
| Actual | The image remains. The `美陈拆解` panel opens instead. DOM bounds showed the delete button at `x=1013,y=197.5,w=24,h=24`, overlapping the main toolbar's `美陈拆解` action at `x=1001.43,y=190.5,w=82,h=28`. |
| Evidence | `test-results/screenshots/cloud-p0-delete-opens-display-decompose-b906a15-20260719.png`; `test-results/console/cloud-p0-delete-opens-display-decompose-b906a15-20260719.json`; `test-results/screenshots/cloud-p1-hover-delete-stacking-failure-20260719.png`; `test-results/console/cloud-p1-hover-delete-stacking-failure-20260719.json` |
| Root cause | The first fix raised the hover toolbar itself, but its transformed image-container ancestor remained `z-20`. The main selected-image toolbar lives in a sibling `z-50` stacking context, so pointer events still reached display-decompose. |
| Fix | `src/components/infinite-canvas.tsx`: retain the hover toolbar at `z-[60]` and raise the selected image container itself from `z-20` to `z-[60]`. |
| Regression status | The new selected-container contract was red before the second fix and green afterward. `canvas-toolbar-floating-windows.test.ts` passes 7/7; targeted ESLint and TypeScript checks pass. `tests/e2e/p0-core.spec.ts` continues to exercise hover-delete before its existing canvas manipulation assertions. A cloud Chrome recheck is required after the fix is synchronized; do not close this P1 before the actual delete action removes the image and the deletion survives a reopen. |

### BUG-20260719-039: Video source validation allowed SSRF targets in selected media routes

| Field | Detail |
| --- | --- |
| Severity / module | P1 / video download, video tools, and video frame extraction |
| Reproduction | Submit a signed-in video URL pointing to `127.0.0.1`, `169.254.169.254`, `[fe80::1]`, or `localhost`. Before the repair, the generic video validator accepted it; several video routes then fetched it server-side. |
| Expected | User-controlled video URLs must be either a safe platform media path or a public HTTP(S) origin. Private, loopback, and link-local targets must be rejected before any fetch or file operation. |
| Actual | The generic `videoUrl` branch checked only a prefix. Download and post-production routes each implemented incomplete, divergent private-host lists, while the single-frame extractor had no source guard. |
| Root cause | URL policy was duplicated rather than shared; one code path did not include cloud-metadata/link-local address ranges. |
| Fix | Added `isSafeVideoSource` to `src/lib/api-validator.ts`; it validates platform media paths, rejects traversal segments, and blocks loopback, RFC1918, zero, and link-local targets. Applied it to `/api/video/download`, `/api/video/tools`, `/api/video/extract-frame`, and `/api/video/extract-frames`. |
| Regression | The focused suite failed first with five failures, then passed: 37 tests across the URL validator, downloader/tool authorization contracts, and new route-wide source-security contract. Cloud route verification remains pending deployment. |

### BUG-20260719-040: Batch video frames were saved outside the media-serving storage contract

| Field | Detail |
| --- | --- |
| Severity / module | P1 / video batch frame extraction |
| Reproduction | Submit `/api/serve-upload/<video>` to `POST /api/video/extract-frames`. The route returned `/api/serve-upload/video-frames/<frame>.jpg` but wrote the frame into `public/api/serve-upload/video-frames`, a directory the serving route does not read. The same route only attempted to read relative video URLs from `public/`, missing persisted cloud media. |
| Expected | Returned frame URLs and their source videos must resolve through the same persistent, authorization-protected media storage used by `/api/serve-upload`. |
| Root cause | The route bypassed the shared data-root convention and mixed a Next static directory with API-served URLs. |
| Fix | `extract-frames` now writes frames to `getServerDataRoot()/uploads/video-frames` and resolves `/api/serve-upload/` and `/uploads/` sources from the persistent data root before its legacy public fallback. |
| Regression | The new contract was red for output storage, then red for persisted-source reads, and is green with 2 assertions. `pnpm test:api` passes 50 files / 116 tests; `pnpm test:regression` passes 93 files / 446 tests. |
| Cloud status | Pending synchronization and a signed-in real video extraction run. |

### BUG-20260719-041: Coze preview backend returned 502 for core authenticated operations

| Field | Detail |
| --- | --- |
| Severity / module | P0 / cloud deployment availability |
| Environment | Coze preview `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`; signed-in Chrome session; GitHub `main` at `a656fed`. |
| Stable reproduction | Open the cloud canvas, select APImart `豆包5.0Lite`, submit one 1:1 test generation. The UI creates a `submitting 5%` placeholder and then removes it without a result. `pnpm run doctor -- --url=<preview>` also receives HTTP 502 from `/api/auth/me`. |
| Expected | Authenticated session, project synchronization, and image generation reach the deployed application and return business responses. |
| Actual | Browser console records `[生成] API HTTP错误: 502`; project load and sync repeatedly report 502. The doctor health probe fails with `deployment-url: /api/auth/me responded 502`. No canvas image is created. |
| Evidence | `test-results/screenshots/cloud-generate-502-a656fed-20260719.png`; `test-results/console/cloud-generate-502-a656fed-20260719.json`; doctor output from 2026-07-19. |
| Root-cause status | Deployment/runtime unavailable before business behavior can be observed. This record does not attribute the 502 to a source defect without backend logs. |
| Local production control | On the same `a656fed` source tree, `pnpm run start` reached `Ready` on port 5000 and `GET /api/auth/me` returned HTTP 200 with `{"success":true,"user":null}`. This rules out a general Next production-route startup failure in the audited source; it does not replace cloud verification. |
| Release impact | Blocks all cloud P0 validation that requires projects or model tasks: upload persistence, selection/delete, save/reload, download, and video extraction. |
| Next action | Restore the Coze backend proxy/application service, verify `/api/auth/me` returns a valid authenticated response, then repeat the exact real-browser flow. |

### BUG-20260719-042: Missing internal secret turned protected API requests into 500 errors

| Field | Detail |
| --- | --- |
| Severity / module | P1 / shared API authentication |
| Stable reproduction | Start the production build without `INTERNAL_API_SECRET`, `WUJIE_AUTH_SECRET`, or `NEXTAUTH_SECRET`, then send anonymous `POST /api/generate {}`. Before the repair, `getRequestUser()` resolved the internal-worker secret before checking whether the request was internal. The missing secret threw and the route returned 500. |
| Expected | A request without a valid browser, desktop, or signed internal identity must receive the standard 401 rejection. Missing internal-worker credentials must not make public or anonymous requests throw. |
| Root cause | The shared authenticator eagerly resolved the internal secret for every request, even though only requests carrying `x-internal-request` need it. |
| Fix | Resolve the internal secret only for declared internal requests and treat lookup failure as unauthenticated. Browser-session and desktop-token checks remain available after a rejected internal attempt. |
| Regression | Red-first `api-auth-internal-request.test.ts` failed with `auth secret unavailable`; it now passes 5/5, covering anonymous and forged-internal requests. `pnpm test:api`, `pnpm test:regression`, `pnpm lint --quiet`, `pnpm ts-check`, and `pnpm build` passed. |
| Production evidence | A fresh local `pnpm run start` served anonymous `POST /api/generate` as HTTP 401 with `{"error":"Authentication required"}`. |
| Cloud status | Pending. The Coze preview currently returns 502 before the route runs, so this must be rechecked after backend restoration. |

### BUG-20260719-024 cloud recheck update

| Field | Detail |
| --- | --- |
| Environment | Coze preview, signed-in Chrome session, user-reported cloud update on 2026-07-19. |
| Actual | Clicking the only visible `删除` control retained the image and opened `美陈拆解`. `elementsFromPoint` at the delete button center identified the selected-image main toolbar's display-decompose action as the hit target. The cloud DOM did not expose the expected `selected-image-delete` control from the current source. |
| Evidence | `test-results/screenshots/cloud-selected-delete-before-cca44cd-20260719.png`; `test-results/screenshots/cloud-selected-delete-after-cca44cd-20260719.png`; `test-results/console/cloud-selected-delete-dom-cca44cd-20260719.json`. |
| Status | Failed cloud P1 acceptance. Do not close this issue until the deployed UI exposes an unoccluded delete action and deletion survives reopening the project. |

### 2026-07-19 Cloud recheck after reported update (BUG-20260719-041 remains open)

| Field | Detail |
| --- | --- |
| Git / preview | `origin/main` head `afa640d`; Coze preview `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`; existing signed-in Chrome `Mr.joker` session. |
| Reproduction | Open the interactive infinite canvas, retain the selected APImart `豆包5.0Lite` model, prompt `P0 regression test image: a single small red cube on a plain white background`, then click `开始生成`. |
| Actual | The UI created a `submitting 5%` 800x800 processing frame, then removed it without a generated image. Chrome console recorded `[生成] API HTTP错误: 502 Object` at `2026-07-19T10:21:41.872Z`. Project load/sync also repeatedly logged server-returned 502 responses. |
| Scope conclusion | The authenticated entry and canvas UI are interactive, so the prior authentication-overlay blocker is not reproduced in this session. The core server request path is still unavailable. This is a deployment/backend availability failure until Coze application/proxy logs identify the source; no source code change is justified by a gateway response alone. |
| Evidence | Chrome screenshot and console transcript captured at `2026-07-19T10:21`; the screenshot shows the empty canvas after failed submission. |
| Release impact | P0 remains open. Image result persistence, manipulation, save/reload, download, logout regression, video extraction, and public-media acceptance cannot be marked passed while same-origin core API calls return 502. |
