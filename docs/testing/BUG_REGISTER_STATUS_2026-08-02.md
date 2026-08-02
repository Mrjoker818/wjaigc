# Bug Register Status Addendum - 2026-08-02

This addendum preserves the original browser evidence in `BUG_REGISTER_2026-08-02.md` and records the current local remediation state without changing historical observations.

| Bug ID | Previous status | Current local status | Closure condition |
| --- | --- | --- | --- |
| `AUD-20260802-001` | Open: requested/actual provider route was not auditable | Fixed locally with `GenerationRouteAudit`; deployment verification pending | Real fallback task keeps requested route, actual route and fallback reason in task monitor, canvas and reopened project |
| `AUD-20260802-002` | Open: Quick Create state may outlive a project switch | Pending targeted reproduction | Add a stable project-switch regression before source change |
| `AUD-20260802-003` | Open: reopened canvas can be blank with persisted offscreen node | Fixed locally with persisted normalized view state and fit-to-content reset; deployment verification pending | Paste/upload -> move -> resize -> reload -> reopen -> reset keeps the image visible |
| `AUD-20260802-004` | New: explicit 302 upscale failure hid supplier semantics and risked ambiguous fallback after billing | Fixed locally with typed provider failure, durable settlement/refund and AI-only exact-302 mode; deployment verification pending | Validate success and rejection paths for both configured 302 models, including one charge/refund only |
| `AUD-20260729-PEAR-ZIP` | Existing: Pear layer model returned ZIP rather than a directly usable PSD | Fixed locally with async request mode and bounded ZIP-to-primary-PSD extraction; deployment verification pending | Pear task reaches editable PSD canvas with visible real layers and no duplicate charge |

## Evidence Files

- Source and regression changes: current Git worktree.
- Local gate evidence: `REGRESSION_REPORT_2026-08-02.md`.
- Required cloud evidence: `UNVERIFIED_ITEMS_2026-08-02.md`.
- Release decision: `RELEASE_READINESS_REPORT_2026-08-02.md`.
