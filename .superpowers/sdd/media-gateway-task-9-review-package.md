# V588-MEDIA-001 Task 9 本地复审包

## 复审范围

- 基线：`74716cb99e3972d27c9fac7fd4aa22c0f1130d83`
- Doctor/E2E 提交：`2b19d3f6`
- 全仓隔离修复提交：`a8d7f3bb`
- 生产代码改动：仅 `scripts/doctor.mjs`；其余为测试、E2E 规格和保护来源治理。

## 必查证据

1. Doctor RED `3 failed / 20 passed` 与 GREEN `24/24` 是否构成真实先失败后通过。
2. 网关关闭是否只给 warning；开启是否对数据库和三张迁移表失败关闭；输出是否脱敏。
3. Playwright 5 个用例是否由云端开关保护，且没有把 `--list` 冒充执行通过。
4. 专项 `327/327` 和全仓 `6745/6745` 是否均为 0 skip，PostgreSQL 是否使用非管理员临时实例。
5. 五条门禁是否全部 exit 0；构建 53 条 warning 是否在报告中保留。
6. 云端所有字段是否仍为 `pending`，`stable` 与 donor 是否未触碰。

## 当前判定

控制端自检未发现 P0/P1 本地失败。正式独立复审与云端验收尚未执行，因此只允许结论 `LOCAL PASS / CLOUD UNVERIFIED`。
