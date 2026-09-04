# Skill 需求交付与保存时序修复

## 范围

基线main@8237f5b6。仅修复现有Skill内核及转入画布后的保存时序，不新增目录、不重做Stage4、不改登录和账务规则。21个Canvas/Workflow技能与16个Simple Chat技能继续隔离，stable不触碰。

## 缺陷与证据

### SKILL-CONTEXT-20260904-01：交付步骤丢失需求

- P1，真实Chrome任务1c56c864-0b28-4e10-8b72-b15371c19adf要求草莓蛋糕，规划正确，成品却为面食。
- 失败测试证明生图适配器实际只收到render，未包含dish/purpose或上游规划。
- 修复：新任务冻结版本化执行上下文；前序持久化文本与输入字段进入提示词和步骤摘要；同组并行/未来结果隔离；旧任务不改摘要，重复create复用原run.created。
- 120项专项通过，含21个预设；云端成品语义仍待验，不把output-present当成语义检查。

### SKILL-SNAPSHOT-20260904-02：快照不能写入真实事件存储

- P1，本地未发布变更中发现。真实PostgreSQL专项16项中4项失败，错误为AGENT_EVENT_PAYLOAD_REJECTED。
- 根因：预设字段显式含defaultValue:undefined，直接存入快照触发现有严格JSON安全校验。存储替身未覆盖此条件。
- 修复：按字段构造快照，仅保存已定义的可选值。没有放宽事件安全校验。
- 修复后同一真实数据库专项16/16通过；准入测试新增真实快照安全校验。

### SKILL-SAVE-20260904-03：旧快照误清理尚未确认的新转入素材

- P1，云端保存接口曾返回500/LEGACY_MIGRATION_INTEGRITY_CONFLICT，10:07仍有新Console警告。
- 真实PostgreSQL稳定复现：先生成已完成checkpoint，写入服务器transfer placement，再处理不含新图的旧快照；新placement变成trashed，后续adoptManagedCanvasMapping报同样错误。
- 这是相同故障机制的本地实证；云端原失败请求未完整取回，不宣称已经逐字段重建云端全部时序。
- 最小修复：对具有服务器写入source_version_id、idempotency_key、request_digest且尚未进入checkpoint的transfer，不因旧快照中缺席就清理。首次确认后的正常删除、已有孤立数据清理、显式删除、归属/版本/跨项目校验保持不变。
- 58项专项通过，其中17项真实PostgreSQL，包含首次确认后删除仍可软删除的断言。
- 不自动恢复历史trashed记录，避免误恢复用户主动删除的素材。云端既有失败样本须先只读核对，再做单样本受控恢复或另用干净测试项目，不批量改数据。

## 隔离数据库

- PostgreSQL18，127.0.0.1:55489，数据库wujie_skill_test，仅本机临时测试。
- 数据目录output/postgres-skill-20260904，未连接云端数据库。测试结束已通过pg_ctl正常停止，未安装系统服务。
- 下次复验可复用此隔离目录；不得因缺失环境变量继续重复报告“没有可用PostgreSQL”。仍须明确配置TEST_POSTGRES_URL与POSTGRES_TEST_DATABASE_URL，并将PGDATABASE_URL/DATABASE_URL指向同一个本机测试库。
- 原始失败日志：output/skill-context-postgres.log、output/skill-save-race-postgres-red-v2.log。
- 原始通过日志：output/skill-context-postgres-fixed.log、output/skill-save-race-postgres-fixed.log。

## 发布状态

### 独立复核补充

- 复核发现：替换素材后若使用已更新的 checkpoint 作为历史确认记录，旧 transfer 素材可能无法正常软删除。
- 已保留不可变的原 previousMappings 用于清理判定，未放宽归属、版本或删除校验。
- 真实 PostgreSQL alias 回归先失败（7通过、1失败），修复后专项58/58通过，包含17项真实数据库测试。日志：output/skill-save-alias-postgres-red.log、output/skill-save-alias-postgres-fixed.log。
- 独立只读复核确认此边界已闭环，未发现新增阻断；不等同于云端验收通过。
- Chrome browser 11 的现有项目页、预览页可枚举，但接管预览页仍返回 Debugger unattached。未操作360、未新建标签页、未重复提交付费任务。
- 全仓 lint 为0错误、943警告。最后映射修复后的类型检查仍需确认；正在运行的全量测试启动早于该末次修改，不能直接作为最终固定版本发布证明。

早期全量output/skill-context-save-final-test.log启动早于末次映射清理修复，仅作为历史记录。随后固定业务源码的最终全量于10:36:36启动，498.14秒完成：4956通过、144跳过，630个文件通过、27个文件跳过，退出码0，日志output/skill-context-save-release-test.log。跳过项不能算通过。最终lint为0错误/943警告；末次修复后的类型检查与38项保护基线通过，隔离PostgreSQL已正常停止。生产构建退出0（编译14分钟、构建内类型检查60秒、119静态页面），Build ID为7WAUKm_srtdb-ibxfmskj；7个业务源码哈希核对一致。构建中2条Node localstorage路径警告保留在日志内。候选具备本地验证证据，可进入隔离云端测试；Coze重建和Chrome真实语义/保存恢复验收尚未完成，当前结论仍为不通过发布验收。
