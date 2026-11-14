# Task 7 只读画布证据发布协议

Task 7 的证据运行是追加式、不可复用的。每次矩阵运行必须先执行初始化命令，获得唯一的 `run ID` 和随机 `nonce`；桌面与移动端命令共享这组三元绑定（commit、run ID、nonce），但不得重新初始化同一个 run ID。

发布器以独占创建 `promoted/<commit>/<run-id>/` 作为唯一胜者声明，并永久保留 `owner.json`。随后写入并复核 8 条原始记录和 `manifest.json`，最后才独占写入 `complete.json`。只有同时满足下列条件的目录才是最终证据：

- `complete.json` 存在并通过 schema、commit、run ID、nonce、owner 与 manifest SHA-256 校验；
- 目录只能包含 `owner.json`、`manifest.json`、`complete.json` 和 `records/`；
- 8 条记录的文件名、身份、原始字节、摘要和重算语义均与 manifest 完全一致；
- manifest 中的原生 contextmenu 合成统计来自原始长按记录，`native=false` 只是观测结果，不是失败。

## 中断与恢复

初始化后失败或发布中断的 run 永久视为已消耗。发布器不会删除、移动、改名或“解锁”任何已创建的 owner/claim 路径；没有有效 `complete.json` 的目录只是不可变的 incomplete 审计痕迹，绝不能手工补齐、复用或再次晋级。

恢复流程只有一个：选择全新的 run ID，重新执行初始化，再让桌面与移动矩阵使用新返回的 nonce，最后运行 finalizer。不要删除旧 owner，不要运行隔离/解锁脚本；项目已移除这类命令，避免路径替换竞态导致误删他人的声明。

典型流程：

```powershell
$commit = git rev-parse HEAD
$runId = "task7-round5-20260920-001"
$init = pnpm exec tsx scripts/init-read-only-canvas-share-evidence.ts --run-id $runId --commit $commit | ConvertFrom-Json
$env:TASK7_EVIDENCE_RUN_ID = $runId
$env:TASK7_EVIDENCE_COMMIT = $commit
$env:TASK7_EVIDENCE_NONCE = $init.executionNonce
# 依次运行 desktop 与 mobile Playwright 矩阵；两次命令共享上述绑定。
pnpm exec tsx scripts/finalize-read-only-canvas-share-evidence.ts --run-id $runId --commit $commit --nonce $init.executionNonce
```

初始化和 finalizer 都会拒绝 HEAD 不一致、tracked/index dirty 以及任何未忽略的 untracked 文件。`output/` 下被 Git 忽略的证据目录不影响该门禁。

## 生产构建的补充检查

对隔离的 `next start` 应用运行严格请求检查时，将 `E2E_BASE_URL` 指向该应用，并将 `WUJIE_SHARE_NETWORK_BUILD_DIR` 指向启动时使用的、已封存的 `.next` 目录。负向用例及桌面、移动矩阵按分享页的构建清单核对静态路径，继续逐项检查公开接口、请求方法、来源和主页面身份。此模式将结果写入独立的 Playwright 附件，不会写入或晋级旧的八条记录。

生产构建的允许下载场景使用 `read-only-canvas-share-real-video.spec.ts`，因为 Chromium 的原生下载不会经过页面模拟路由。该用例在 Chromium 和 WebKit 使用 PostgreSQL 的真实分享令牌及原生 MP4，验证点击、下载路径和完整文件校验和。使用 `--reporter=list,json` 或 `--reporter=line`，不保留含令牌的追踪、截图或录屏。

运行前设置 `E2E_SHARE_VIDEO_LOCAL_GATE=1`、`E2E_SHARE_VIDEO_DATABASE_URL`，并提供与该隔离应用匹配的 `E2E_STAGE4_RUN_ID`、专用 `WUJIE_DATA_DIR` 和测试管理员。由隔离环境启动器生成 32 位小写十六进制 `E2E_SHARE_VIDEO_RUN_NONCE`，在专用数据库的 `wujie_qa_share_video_identity(nonce TEXT PRIMARY KEY)` 放入唯一一行同值，且在独占的 `WUJIE_DATA_DIR/uploads` 放入 `qa-share-gate-<nonce>.png`（可用 `tests/fixtures/tiny-test.png`）。用例核对数据库、该文件的真实 HTTP 读回和运行构建后才登录、写合成素材。分享最长有效三分钟，正常结束时立即撤销。
