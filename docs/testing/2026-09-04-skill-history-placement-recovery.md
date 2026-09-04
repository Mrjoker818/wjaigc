# Skill 历史结果恢复：本地修复与云端待验收

## 范围与基线

- 缺陷：`SKILL-HISTORY-20260904-04`，Task12验收中发现的P1。
- 本地与2026-09-04本轮重新fetch确认的GitHub main基线：`f2b673ce2da9af29caed4d9f6b42faff11ce7907`。
- 只修复Skill历史结果与现有资产恢复入口的接入边界，不重做Stage4，不改账本、账号、供应商或数据库结构。
- `stable`保持`52f7c601ed150769e15d06fb435c6e360e28c9e7`，未操作。

## 真实问题

APImart美食Skill已完成真实蛋糕图生成，第一次落图、刷新、下载正常。删除本轮结果后从运行历史恢复，画布短暂出现图片并提示`LEGACY_MIGRATION_INTEGRITY_CONFLICT`，刷新后图片消失。

原因是固定幂等transfer复用已删除placement，却未显式恢复活动状态。既有完整性校验拒绝该失效引用是正确行为，不能移除校验解决。

## 最小修复

1. transfer返回放置状态；普通投影不得自动恢复已删除结果。
2. 用户从历史显式恢复时，调用既有restore入口，复用原资产、版本及placement。
3. 恢复失败不自动重试，避免提交已完成但响应丢失后，重复恢复用户再次删除的内容。
4. 图片尺寸加载完成、同步插入前重新校验修订号和目标删除代际，校验通过才清除目标删除标记。
5. 新Skill恢复携带transfer读取的PostgreSQL行版本；既有restore事务取得行锁后匹配可选`expectedPlacementRevision`，不匹配返回409 `ASSET_PLACEMENT_CONFLICT`。新客户端缺少版本时拒绝静默降级，旧入口仍兼容。

未新增生成调用或扣费调用，没有数据迁移，也不批量恢复历史图片。

## 测试证据

| 验证 | 结果与证据 |
|---|---|
| 显式恢复自动重试 | 生产回调执行：先1失败/2通过，最小修复后通过；`output/skill-history-retry-red-20260904.json` |
| 迟到响应/尺寸加载期间删除/本地删除 | 生产接收与落图回调执行：先3失败/1通过，修复后通过；`output/skill-history-late-insertion-red-20260904.json` |
| 恢复提交前另一页面已恢复再删除 | 真实隔离PG交错：先失败，版本前置条件后通过；`output/skill-history-delete-cycle-red-20260904.json`、`output/skill-history-delete-cycle-green-20260904.json` |
| HTTP边界 | 版本转发、409冲突、非法版本400、原入口兼容通过 |
| 最终完整测试 | 668文件，5231通过、0失败、0跳过，真实隔离PG包含；`output/skill-history-revision-full-20260904.json` |
| 类型检查 | `pnpm ts-check`退出0 |
| 全仓Lint | 退出0，0错误/943历史警告；`output/skill-history-revision-lint-20260904.log` |
| 功能保护 | 38项通过；`output/skill-history-revision-protection-20260904.log` |
| 生产构建 | 会话85442退出0，编译12.4分钟、构建内TypeScript52秒，Build ID `dpG6DGhjQK1vCcu58Q6oI`；日志 `output/skill-history-revision-build-20260904.log` |

测试JSON SHA256：`EA5760FE7F5D7A1B519E20128D5C34EC70F699D94781C964122057794C7F2761`。

构建日志SHA256：`70A0915861FE4081BA08087DC38FF1EDDE0C10C51ADD3B02108A928F15A0D600`。仅为本地构建结果，不代表Coze已部署。

保留一次测试基础设施失败：漏传pg_ctl端口使集群监听5432、测试连接55489，导致5062通过/144失败/18跳过。原报告`output/skill-history-race-full-20260904.json`未删除；显式55489重启并pg_isready通过后完成上表最终全量。不得将该失败归咎于云端程序。

## 未验证与发布状态

- 最终限定增量只读复审未发现确定缺陷或Skill版本漏传。普通画布撤销仍保持旧可选前置条件行为，不能宣称所有恢复入口都已获得新版本保护；该边界不在本次Skill修复中整体改写。审查子智能体已关闭。

- 本地回调执行测试不是完整React页面或真实Chrome多标签操作；PG传输适配是进程内调用真实服务与数据库，不能称完整HTTP端到端。
- 当前候选尚未在Coze部署，Chrome调试通道仍未附着；不能把本地通过写成云端问题已修复。
- 云端必须使用既有蛋糕资产验证删除、历史恢复、保存、刷新和下载；不重复付费生成、不重复取消已退款旧run。
- 仍需确认恢复不新增任务、消费、退款或版本；原有三张图片保留。
- 当前Task12与全平台目标均未完成，发布结论暂为不通过；不进入下一业务阶段。
