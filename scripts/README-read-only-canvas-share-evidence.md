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
