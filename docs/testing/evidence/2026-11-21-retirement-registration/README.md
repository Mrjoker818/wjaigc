# 四条纯源码路径的正式退役证据

此目录仅支持 2026-11-21 用户明确授权的四条纯源码退役登记。它不是运行验收，不宣称旧 API/事件兼容等价，不处理任何其他历史数据、任务、账务、工作流或迁移 hold。

正式记录：`docs/testing/baselines/production-acceptance-review-2026-11-11.json` 的四条新增 additionalPaths；精确允许项位于 `protected-baseline-allowed-paths.json`。原 160 项及父线程新增记录保留。

| 精确退役路径 | 删除父 blob | 当前相关职责 |
| --- | --- | --- |
| src/lib/video-director/index.ts | 6ec92951c7a89d83d3ebefd37cb8df409ab49f8e | 直接导入现存 director-styles / continuity 等具体模块 |
| src/lib/video-director/model-capabilities.ts | 5147db1bad7867d1b31e2c9dcbbd800c389f3d2f | drama-models 的目录能力映射及 shot-runner 的参数选择 |
| src/lib/video-director/reference-binding.ts | fa19c94c6a33b5392346d6a2ff083dcbf3373231 | continuity 的引用类型与 shot-runner 的参考图构造 |
| src/lib/video-panel-events.ts | 75c43fea075c0149b895bccabf82811e03a85b63 | /video 路由与 platform-switcher；旧事件兼容退役 |

四条均由可从审核 HEAD 到达的真实删除提交 `9c8249e9fef309b55152060ce412160ef80456b0` 删除，其实际父提交为 `738ed3c835fb7a0d602cc17019788460b1e2537b`。现工作树、HEAD 和索引均无这些路径，未恢复源码或创建空 stub。

`retirement-proof.json` 保存逐路径具体原因、当前替代职责、无独立历史义务的审查依据、实际删除父源码全文，以及原 proposed-registration 中各路径的完整历史快照。父线程已复制的原审查 JSON/Markdown 通过 docs 路径及哈希引用；历史快照中原 output 字符串仅为原文留存，不是当前证据读取依赖。当前已不存在的 prompt-compiler 不作为替代文件；未把它加入本次退役或 allowlist。

## 严格记录语义

仅允许上述四条精确路径使用 `disposition: retired`、`reviewedBlob: null`、`retirement.schemaVersion: 1`。普通 additionalPaths 仍需 reviewed 和 40 位非空 blob；空 blob 对象也不能表示当前不存在。

`tests/unit/production-acceptance-review-records.spec.ts` 将检查：删除 commit 可从 HEAD 到达；指定 parent 是真实 parent；parent:path 是匹配 blob；parent→commit 的该路径状态为精确 D；删除 commit、HEAD、索引和文件系统均无该路径（包括悬空 symlink）；替代路径存在；具体原因、用户退役意图和无本路径数据/账务义务说明完整；docs 证据非忽略路径、文件 SHA-256 和逐路径 JSON pointer 与元数据匹配。

该语义不接受任意缺文件、目录通配、大小写变体、未审路径、孤立或未实际删除的提交，也不删除保护 ID 或放宽 workflow 基门禁。若未来恢复任一文件，退役契约会失败，必须重新审查，不能沿用 null 登记。

证据目录为非忽略、可随父线程变更纳入版本的 docs 文件；本任务未执行 Git add/commit/push，CI 使用时应连同正式记录、unit 契约一并纳入父线程提交。

本次定点结果与执行日志位于 `output/canvas-chat-audit/ci-20261121/retirement-registration/`；这些运行日志不是本证据或正式记录的 CI 依赖。有限结果为 25 个退役契约用例通过，原两条聚合测试未运行，未宣称其他当前失配或发布 hold 已解除。

