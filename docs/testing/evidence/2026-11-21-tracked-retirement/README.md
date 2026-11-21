# Tracked retirement V2 — stage 1 RED contract candidates

这些是版本化的非敏感源码证据候选和隔离契约用例，不是canonical登记、历史交付或运行验收；不自动执行迁移/清理/重新付费，不声明物理保全、账务销账或退款完成。

retirement-proof.json逐项绑定38个exactpaths、真实删除commit/parent/blob、当前缺失观察、替代不等价及旧来源；historical-obligations.json保留17项具体历史风险与21项旧契约/关联责任，全部tracked-preserved-pending且physicalDataPreservation/physicalInventory未验证。source-origins.json保留38条完整旧record、原160来源元组与原286授权快照；原canonical/allowlists/权限文件均未修改。

本阶段仅向tests/unit/production-acceptance-review-records.spec.ts追加用例。原文件前18679字节不改，SHA-256 d87fb20b0664cc8b3a88f89b1e0f7ec0153573b87426afedd0aab69b8051fa7d；原assertAdditionalEntry函数摘要 02cb900fa0d5e534f1de7876ac144c6f98d3d77b59d8194ab25a7b38668724bb，实现和V1全部原用例未改。

新名称过滤：tracked retirement V2 contract。新增27例：1例真实160/286来源快照约束，1例逐项调用现有validator验证38个合法V2，23例非法元数据/来源/历史/声明，以及2例缺失证明/恢复路径。每个负例先要求合法基线被同一个旧validator接受；部分反例同步伪造proof/ledger并重算摘要，不能只靠期望JSON镜像或摘要不一致拒绝。

测试中Reflect.apply只用于把运行时V2 JSON送入现有V1签名；没有实现V2 guard、绕过validator、any/ts-ignore或修改公共types。追加的originalRecord仅是独立before-image fixture oracle，旧validator尚未消费它；没有修改repositoryRetirementProof。

静态预期：旧validator会在首个合法V2路径src/app/api/workflow/image-actions/route.ts的“Retirement is exact-path only”断言拒绝；这正是父线程应观测的RED，不是导入/缺文件失败。本代理未执行任何测试、类型检查、lint、诊断、Git、DB、网络或业务；没有实际RED结果，唯一执行入口由父线程掌握。

现有四条pure V1的exactpath、纯退役证据及既有正负例原样保留。原160来源/286权限不变；Stage4当前血缘、原草图与14积分、旧云任务/S3和历史恢复交付仍另行pending，不新增恢复DAG前置条件。
