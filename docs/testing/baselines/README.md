# 无界稳定内核基线

本目录保存 `WJ-STABLE-001` 升级计划使用的可审计基线。基线的目的不是证明当前程序没有缺陷，而是固定升级开始时的真实版本、受保护范围和已知失败，防止后续升级覆盖现有功能，或把历史问题误判为新回归。

## 当前基线

- 远程仓库：`https://github.com/Mrjoker818/wjaigc.git`
- 远程分支：`origin/main`
- 受保护门禁基线提交：`7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`
- 历史 Stage 0 证据快照：`69ba94ef6bde041293ad9609ec76285d3e287a7f`
- 软件版本：`4.0.0`
- 门禁基线协调时间：`2026-08-17T00:00:00+08:00`
- 实施分支：`codex/wj-stable-s0`
- 实施范围：Stage 0 测试基础设施、功能保护清单、证据规范和发布门禁

历史 Stage 0 采样时，以下业务源码范围与当时的 `origin/main` 完全一致；当前受保护门禁固定比较 `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`，并继续要求全部 38 个受保护功能 ID 存在：

```text
src/
package.json
pnpm-lock.yaml
```

验证命令：

```powershell
git diff --exit-code origin/main -- src package.json pnpm-lock.yaml
```

## 已知基线失败

首次全量执行 `pnpm test` 的结果为：

- 测试文件：322 通过、5 失败、3 跳过
- 测试用例：1474 通过、5 失败、4 跳过
- PostgreSQL 并发专项：因缺少隔离测试数据库而阻塞

5 个失败分别位于：

1. `src/__tests__/lib/api-compatibility.test.ts`
2. `src/__tests__/lib/pear-layer-adapter.test.ts`
3. `src/__tests__/components/image-tool-request-integrity.test.ts`
4. `src/__tests__/lib/upscale-onnx-model.test.ts`
5. `src/__tests__/lib/video-api-parsing.test.ts`

这些失败是 Stage 0 修改业务代码前已经存在的事实。本阶段只登记、保护和报告，不通过修改供应商、任务、积分、画布或其他业务链路来掩盖失败。后续阶段必须逐项建立复现证据并修复。

## 工作区纪律

- 所有实施在独立 worktree 中完成。
- 不提交 `.playwright-cli/`、`.worktrees/`、`_refs-*`、`output/`、`playwright-report/` 或 `test-results/` 的临时内容。
- 每个阶段完成后同步更新 Obsidian 的“无界计划”目录。
- 只有完成阶段验证的检查点才允许推送 GitHub。
- 未经真实浏览器、真实数据库或真实云端验证的能力只能标记为“未验证”或“阻塞”。
