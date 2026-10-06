# 协作文档媒体命令的完整已登记结果引用

日期：2026-09-27。属于原协作Task8Cb的完成写回依赖；不是新目标。

## 问题与选择

现有真实上传、任务采纳和无任务版本转入都已共同提交资产、摆放、Yjs与幂等结果，但只返回placementId、assetVersionId、documentSequence。后续`WorkspaceAssetReference`消费者需要assetId、entityId、url；不能把三个字段强转成完整引用，亦不能从供应商URL或当前已换版摆放拼出伪历史结果。

采用：在原授权事务和最终写入事务内，按持久命令保存的asset_id/asset_version_id/placement_id及owner/project联查规范资产、版本和摆放，返回`RegisteredWorkspaceAssetReference`。不采用事务外无授权补查；不重复运行旧owner-only投影器；不新建结果权威表或任务状态机。

## 合同

- `DocumentMediaImportResult extends DocumentAssetCommandResult`，新增必填`assetReference: RegisteredWorkspaceAssetReference`。必有assetId、assetVersionId、placementId、entityId、url；kind使用真实资产image/video。旧三个顶层字段保留。仅媒体import三入口升级，原ready attach/remove/replace结果合同不变。
- 以持久命令行的资产和版本为历史结果身份，不能采用placement当前asset_id/asset_version_id；其后发生合法replace或remove，重放仍返回原命令版本及原placement/entity，无新增写入、媒体读取/复制、任务或扣费。不把历史ACK描述为当前仍显示。
- 命令、资产、版本、摆放必须精确匹配授权owner/project；version.asset_id必须等于命令asset_id；placement必须是同项目canvas精确两个别名。placement的当前kind/version可能已被合法replace改变，不据当前entity_type推导历史kind。注册实体ID与placementId是不同字段，禁止互相替代。
- 单条SQL读取使用LEFT JOIN或等价显式方法区分“无命令”与“命令存在但引用破损”。后者必须拒绝，不得重走创建、返回不完整引用、使用供应商URL或退回URL-only成功。缺失/错配/空必需字段、非法kind均`DOCUMENT_MEDIA_CONFLICT`；SQL异常沿现有固定错误脱敏，不泄露路径、SQL或凭据。
- 历史命令查询不添加当前placement active/当前version相等的条件，否则合法删除或换版会误判。也不新增物理媒体读或当前文件可用性探测来否定已经提交的历史命令；既有当前项目授权、冻结代次与请求摘要仍必须检查。旧命令没有额外快照列，同样由规范身份联查，无需迁移或回填。
- 新导入在原最终事务完成命令INSERT和source digest更新后读取同一规范引用，验证成功才COMMIT；读取失败回滚资产/摆放/文档/结果并清理未提交文件。禁止COMMIT之后才首次校验返回引用。
- 同键重放、上传读完body后的再次授权、COMMIT确认丢失后的持久查询都复用此读取。实际COMMIT后恢复查不到/失败/撤权，仍不ACK、保留可能已引用的文件；不能删掉已提交媒体。授权仍贯穿8Cb3b的冻结代次，锁序不变。
- 三真实POST无需接收任何新请求字段；依原spread输出完整结果、private/no-store/Vary Cookie不变。身份仍仅来自session，body自报reference/owner/URL仍拒绝。

## 验证与边界

先以真实PG、真实上传/任务采纳POST证明当前缺少引用的行为RED；不得以缺类型/导出/迁移冒充RED。真实规范行作为独立期望核验实体与摆放不同。覆盖三来源图片/视频、owner/editor、并发同键、跨来源key、替换后历史重放/删除后重放、破损跨owner/project行、引用读取失败前回滚、实际COMMIT丢ACK恢复、恢复失败保留媒体、撤权再授权不升级和账务不变。

最终完整运行直接受影响的document-media-import与task-publication-import两个PG文件、新PG文件和现有HTTP/request消费者，并执行非增量tsc、定向ESLint、保护基线。失败与修复阶段分别留证，不把重叠计数相加。新测试允许任意显式localhost测试库，媒体根须产品导入前唯一mkdtemp隔离并恢复env；只清理本测试自己的已验证绝对路径和schema。

用户已授权自主选择执行方案，故不重复确认。只改main、不stage/commit/push/云端/付费/部署；保留七保护文件、stable、旧残留与既有日志。Pear排除。下一仍须冻结布局/替换意图及父系、统一task/output命令并接入自动完成/恢复真实消费者、全UI/撤销/三工作区、全平台与发布门禁；本项绝不替代它们。
